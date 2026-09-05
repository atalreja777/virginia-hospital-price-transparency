#!/usr/bin/env bash
# Read-only export from the `hpt` Postgres DB. NEVER writes to hpt.
#
# Everything below runs inside ONE psql session in a single REPEATABLE READ
# transaction, so charges, rates, provenance and the stage counts all describe
# the same instant of the database. Previously each \copy was its own snapshot,
# and a file that went current mid-export could show a price whose provenance
# row was already gone.
#
# Two rules this script must never break:
#   1. `rates` is a 390M-row partitioned table. EVERY statement that touches
#      rates or items carries a literal `hospital_id = ANY(ARRAY[...])` in its
#      innermost scan so Postgres prunes to those partitions. A state-level
#      subquery does not prune, and an unpruned scan blocks backend migrations.
#   2. statement_timeout is 120s, so a mistake stops in two minutes rather than
#      holding a snapshot open for an hour. The heavy per-hospital exports are
#      therefore emitted one hospital at a time.
#
# Usage:
#   ./pipeline/01_export.sh                          # whole state, one file per hospital
#   ./pipeline/01_export.sh --hospital 5913,5888     # named hospitals
#   ./pipeline/01_export.sh --limit 5                # first 5 publishing hospitals
#   ./pipeline/01_export.sh --out pipeline/out/x/raw
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO/pipeline/raw"
DB="${HPT_DB:-hpt}"
STATE="${HPT_STATE:-VA}"
HOSPITALS=""
LIMIT=""
TIMEOUT="${HPT_STATEMENT_TIMEOUT:-120s}"
ALLOW_MISSING_REJECTED="${HPT_ALLOW_MISSING_REJECTED:-0}"

while [ $# -gt 0 ]; do
  case "$1" in
    --out)      OUT="$2"; shift 2 ;;
    --hospital) HOSPITALS="${HOSPITALS:+$HOSPITALS,}$2"; shift 2 ;;
    --limit)    LIMIT="$2"; shift 2 ;;
    --state)    STATE="$2"; shift 2 ;;
    --allow-missing-rejected) ALLOW_MISSING_REJECTED=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
mkdir -p "$OUT" "$OUT/charges" "$OUT/rates" "$OUT/stage_counts"

say(){ printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
pq(){ psql -qtAX -d "$DB" -c "SET statement_timeout='$TIMEOUT';" -c "$1" | tail -n +1; }

# ---------------------------------------------------------------------------
# Source relations, defined ONCE.
#
# Today these are explicit joins keeping only rows a hospital currently
# publishes: the current, successfully parsed version of an active file whose
# link to the hospital has not been rejected, and which is not in quarantine.
# When the backend lands v_public_release_rates / v_public_release_items
# (Phase 1B) the operator sets the HPT_* variables below and nothing else in
# this script changes:
#
#   HPT_RATES_SRC='v_public_release_rates r'  HPT_RATES_WHERE=''
#   HPT_ITEMS_SRC='v_public_release_items i'  HPT_ITEMS_WHERE=''  HPT_ITEMS_REL=v_public_release_items
#
# Query bodies therefore only ever reference r.* and i.* columns.
# ---------------------------------------------------------------------------
REJECTED_PRED="AND hm.rejected_at IS NULL"
NOT_QUARANTINED="AND NOT EXISTS (SELECT 1 FROM quarantine q WHERE q.file_version_id = fv.file_version_id AND q.resolved_at IS NULL)"

# --- capability detection --------------------------------------------------
has_col(){ [ -n "$(pq "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='$1' AND column_name='$2'")" ]; }

HAS_REJECTED=0; has_col hospital_mrfs rejected_at && HAS_REJECTED=1
HAS_SOURCE_ROW_REF=0; has_col items source_row_ref && HAS_SOURCE_ROW_REF=1
HAS_GENERIC_NOTES=0;  has_col items generic_notes  && HAS_GENERIC_NOTES=1
HAS_DUP_COUNT=0;      has_col items dup_count      && HAS_DUP_COUNT=1
HAS_ENTRY_HASH=0;     has_col items entry_hash     && HAS_ENTRY_HASH=1
HAS_DERIVED_BASIS=0;  has_col rates derived_basis  && HAS_DERIVED_BASIS=1

if [ "$HAS_REJECTED" = 0 ]; then
  if [ "$ALLOW_MISSING_REJECTED" != 1 ]; then
    cat >&2 <<'MSG'

ERROR: hospital_mrfs.rejected_at does not exist in this database.

  Without it the export cannot tell a valid hospital<->file link from one the
  backend has rejected, and prices would be published under the wrong hospital.
  Run the Phase 0 backend migration that adds hospital_mrfs.rejected_at and
  teaches v_rates_current / v_items_current to honour it, then re-run this.

  For a development sample only, re-run with --allow-missing-rejected. The
  release manifest then records rejectedAtAvailable=false and 09_validate
  refuses to promote the build.

MSG
    exit 3
  fi
  echo "WARNING: hospital_mrfs.rejected_at missing; exporting WITHOUT the rejection filter (development sample only)" >&2
  REJECTED_PRED=""
fi

SRC_ROW_REF=$([ "$HAS_SOURCE_ROW_REF" = 1 ] && echo "i.source_row_ref" || echo "NULL::text AS source_row_ref")
GENERIC_NOTES=$([ "$HAS_GENERIC_NOTES" = 1 ] && echo "i.generic_notes" || echo "NULL::text AS generic_notes")
DUP_COUNT=$([ "$HAS_DUP_COUNT" = 1 ] && echo "i.dup_count" || echo "NULL::int AS dup_count")
DERIVED_BASIS=$([ "$HAS_DERIVED_BASIS" = 1 ] && echo "r.derived_basis" || echo "NULL::text AS derived_basis")

CURRENT_FILE_JOIN_R="JOIN file_versions fv ON fv.file_version_id = r.file_version_id AND fv.is_current AND fv.parse_outcome = 'parsed'
   JOIN mrf_files m ON m.mrf_id = fv.mrf_id AND m.active
   JOIN hospital_mrfs hm ON hm.hospital_id = r.hospital_id AND hm.mrf_id = fv.mrf_id $REJECTED_PRED"
CURRENT_FILE_JOIN_I="JOIN file_versions fv ON fv.file_version_id = i.file_version_id AND fv.is_current AND fv.parse_outcome = 'parsed'
   JOIN mrf_files m ON m.mrf_id = fv.mrf_id AND m.active
   JOIN hospital_mrfs hm ON hm.hospital_id = i.hospital_id AND hm.mrf_id = fv.mrf_id $REJECTED_PRED"

RATES_SRC="${HPT_RATES_SRC:-rates r $CURRENT_FILE_JOIN_R}"
ITEMS_SRC="${HPT_ITEMS_SRC:-items i $CURRENT_FILE_JOIN_I}"
RATES_WHERE="${HPT_RATES_WHERE-$NOT_QUARANTINED}"
ITEMS_WHERE="${HPT_ITEMS_WHERE-$NOT_QUARANTINED}"
ITEMS_REL="${HPT_ITEMS_REL:-items}"

# --- which hospitals -------------------------------------------------------
if [ -n "$HOSPITALS" ]; then
  IDS="$HOSPITALS"
  SCOPE_NOTE="hospitals $IDS"
elif [ -n "$LIMIT" ]; then
  IDS="$(pq "SELECT string_agg(hospital_id::text, ',' ORDER BY hospital_id) FROM (SELECT hospital_id FROM hospitals WHERE state='$STATE' ORDER BY hospital_id LIMIT $LIMIT) s")"
  SCOPE_NOTE="first $LIMIT hospitals in $STATE"
else
  IDS="$(pq "SELECT string_agg(hospital_id::text, ',' ORDER BY hospital_id) FROM hospitals WHERE state='$STATE'")"
  SCOPE_NOTE="all of $STATE"
fi
[ -n "$IDS" ] || { echo "no hospitals matched" >&2; exit 4; }

# The literal every rates/items scan carries. Nothing in this script may touch
# those tables without it.
ARR="ANY(ARRAY[$IDS])"
HOSP_PRED="h.hospital_id = $ARR"
ID_LIST="$(printf '%s' "$IDS" | tr ',' ' ')"
N_HOSP="$(printf '%s' "$ID_LIST" | wc -w | tr -d ' ')"

# ---------------------------------------------------------------------------
# Which codes are in scope.
#
# Two rules, because hospitals label their code columns inconsistently.
#
#  1. A row typed CPT / HCPCS / MS-DRG is in scope on its label, minus emergency
#     visits (CPT 99281-99292) and ambulance (HCPCS A0xxx).
#
#  2. A row under ANY other label is in scope only on the SHAPE of the code: a
#     5-digit number is a CPT, and a letter followed by four digits is HCPCS
#     Level II. Six Encompass Health rehabilitation hospitals publish every real
#     CPT they have under a column the ingester types `CDM`, and their only
#     `HCPCS`-typed column holds revenue code 270 on every row. Filtering on the
#     label alone dropped all six hospitals from the site entirely while telling
#     readers they had published nothing. Short numerics (revenue codes like 270
#     or 941) are deliberately NOT admitted this way, and neither are MS-DRG
#     shapes, which are indistinguishable from revenue codes.
#
# Rule 2 exports candidates; 02_pack.mjs admits one only when the same code also
# appears under a properly typed CPT/HCPCS column at some hospital in the
# release, so a hospital's internal chargemaster number cannot become a CPT.
# ---------------------------------------------------------------------------
SHAPE_CPT="ic.code_norm ~ '^[0-9]{5}\$' AND NOT (ic.code_norm BETWEEN '99281' AND '99292')"
SHAPE_HCPCS="ic.code_norm ~ '^[ABDEGHJKLMPQRSTVU][0-9]{4}\$' AND ic.code_norm !~ '^A0'"
SCOPE="( ( ic.code_type_norm IN ('CPT','MS-DRG','HCPCS')
          AND ( ic.code_type_norm <> 'CPT' OR ($SHAPE_CPT) )
          AND ( ic.code_type_norm <> 'HCPCS' OR ic.code_norm !~ '^A0' ) )
        OR ($SHAPE_CPT) OR ($SHAPE_HCPCS) )"

# psql's \copy is a single-line meta-command, so every fragment spliced into one
# has to be flattened first.
flatten(){ printf '%s' "$1" | tr '\n' ' ' | tr -s ' '; }
SCOPE="$(flatten "$SCOPE")"
RATES_SRC="$(flatten "$RATES_SRC")"
ITEMS_SRC="$(flatten "$ITEMS_SRC")"
RATES_WHERE="$(flatten "$RATES_WHERE")"
ITEMS_WHERE="$(flatten "$ITEMS_WHERE")"
REJECTED_PRED="$(flatten "$REJECTED_PRED")"

say "exporting $SCOPE_NOTE ($N_HOSP hospitals) -> $OUT"
echo "     rejected_at=$HAS_REJECTED source_row_ref=$HAS_SOURCE_ROW_REF generic_notes=$HAS_GENERIC_NOTES dup_count=$HAS_DUP_COUNT entry_hash=$HAS_ENTRY_HASH derived_basis=$HAS_DERIVED_BASIS"


# Staged columns: only what the per-hospital statements read. Staging r.* from
# the release view would carry URLs, hashes and names on every one of ~35M rows.
R_COLS="r.hospital_id, r.file_version_id, r.item_id, r.payer_id, r.plan_id, r.methodology_id, r.negotiated_dollar, r.negotiated_percentage, r.negotiated_algorithm, r.estimated_amount, r.median_amount, r.p10_amount, r.p90_amount, r.count_raw, r.additional_notes, r.quality_labels, r.derived_dollar$([ "$HAS_DERIVED_BASIS" = 1 ] && echo ", r.derived_basis")"
I_COLS="i.hospital_id, i.file_version_id, i.item_id, i.description_raw, i.setting, i.billing_class, i.modifiers, i.drug_unit, i.drug_type, i.gross_charge, i.discounted_cash, i.min_negotiated, i.max_negotiated, i.quality_labels$([ "$HAS_SOURCE_ROW_REF" = 1 ] && echo ", i.source_row_ref")$([ "$HAS_GENERIC_NOTES" = 1 ] && echo ", i.generic_notes")$([ "$HAS_DUP_COUNT" = 1 ] && echo ", i.dup_count")"
C_COLS="ic.hospital_id, ic.item_id, ic.code_type_norm, ic.code_norm"
SQL="$(mktemp -t hpt_export.XXXXXX).sql"
trap 'rm -f "$SQL"' EXIT

{
cat <<SQLEOF
\set ON_ERROR_STOP on
SET statement_timeout = '$TIMEOUT';
SET idle_in_transaction_session_timeout = '3600s';
-- Temp tables must exist BEFORE the read-only snapshot: CREATE is refused
-- inside a READ ONLY transaction, but INSERT into an existing temp table is
-- allowed. Shapes are copied from the source relations with WHERE false.
CREATE TEMP TABLE x_pub (hospital_id bigint NOT NULL, file_version_id bigint NOT NULL, generation integer NOT NULL, PRIMARY KEY (hospital_id, file_version_id));
CREATE TEMP TABLE x_rates AS SELECT $R_COLS FROM rates r WHERE false;
CREATE TEMP TABLE x_items AS SELECT $I_COLS FROM items i WHERE false;
CREATE TEMP TABLE x_codes AS SELECT $C_COLS FROM item_codes ic WHERE false;
CREATE INDEX ON x_rates (hospital_id, item_id);
CREATE INDEX ON x_items (hospital_id, item_id);
CREATE INDEX ON x_codes (hospital_id, item_id);
SET default_transaction_read_only = on;
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;

\echo '  snapshot'
\copy (SELECT pg_current_snapshot()::text AS snapshot, pg_snapshot_xmin(pg_current_snapshot())::text AS xmin, now()::text AS taken_at, current_setting('server_version') AS server_version) TO '$OUT/snapshot.csv' CSV HEADER

\echo '  hospitals'
\copy (SELECT h.hospital_id, h.ccn, h.name, h.address, h.city, h.state, h.zip, h.ownership, h.hgi_type, h.status, h.pos_subtype_cd, h.exempt_basis, h.status_reason FROM hospitals h WHERE $HOSP_PRED ORDER BY h.hospital_id) TO '$OUT/hospitals.csv' CSV HEADER

\echo '  sources (provenance, same filter as the prices)'
\copy (SELECT DISTINCT h.hospital_id, fv.file_version_id, mf.mrf_id, mf.url, mf.source_page_url, fv.declared_last_updated, fv.declared_version, fv.layout, encode(fv.content_sha256,'hex') AS sha256, fv.size_bytes, fv.first_seen_at, fv.declared_hospital_name, fv.attestation_confirmed FROM hospitals h JOIN hospital_mrfs hm ON hm.hospital_id = h.hospital_id $REJECTED_PRED JOIN mrf_files mf ON mf.mrf_id = hm.mrf_id AND mf.active JOIN file_versions fv ON fv.mrf_id = mf.mrf_id AND fv.is_current AND fv.parse_outcome='parsed' WHERE $HOSP_PRED AND NOT EXISTS (SELECT 1 FROM quarantine q WHERE q.file_version_id = fv.file_version_id AND q.resolved_at IS NULL) ORDER BY h.hospital_id, fv.file_version_id) TO '$OUT/sources.csv' CSV HEADER

\echo '  rejected hospital<->file links (for the validator)'
\copy (SELECT hm.hospital_id, hm.mrf_id, $([ "$HAS_REJECTED" = 1 ] && echo "hm.rejected_at, hm.rejected_reason" || echo "NULL::timestamptz AS rejected_at, NULL::text AS rejected_reason") FROM hospital_mrfs hm JOIN hospitals h ON h.hospital_id = hm.hospital_id WHERE $HOSP_PRED $([ "$HAS_REJECTED" = 1 ] && echo "AND hm.rejected_at IS NOT NULL" || echo "AND false") ORDER BY 1,2) TO '$OUT/rejected.csv' CSV HEADER

\echo '  dictionaries'
\copy (SELECT payer_id, payer_name_raw, payer_key FROM payers ORDER BY payer_id) TO '$OUT/payers.csv' CSV HEADER
\copy (SELECT plan_id, plan_name_raw, plan_key FROM plans ORDER BY plan_id) TO '$OUT/plans.csv' CSV HEADER
\copy (SELECT methodology_id, methodology FROM methodologies ORDER BY methodology_id) TO '$OUT/methodologies.csv' CSV HEADER
SQLEOF

# ---------------------------------------------------------------------------
# Stage the state's slice ONCE. rates, items and item_codes are all hash-
# partitioned by hospital_id with only primary-key indexes, so every
# per-hospital statement below would otherwise rescan an ~800 MB partition
# from disk; at five statements a hospital that is hundreds of gigabytes of
# reads for one state. Three temp tables (allowed inside a READ ONLY
# transaction), one pass each, then the loop runs against them. They live only
# for this psql session and are never written back.
# ---------------------------------------------------------------------------
ORIG_RATES_SRC="$RATES_SRC"; ORIG_ITEMS_SRC="$ITEMS_SRC"
# Two staging strategies. When the backend publishes v_publishable_version and
# version_loads (Phase 1B/1C), the publishable (hospital, version, generation)
# triples are tiny, so they are materialised first and the base tables are
# hash-joined against them in one pruned pass. Going through the release view
# directly made the planner probe the version lookup once per rate row.
has_rel(){ [ -n "$(pq "SELECT 1 FROM pg_class WHERE relname='$1'")" ]; }
if has_rel v_publishable_version && has_rel version_loads; then
  ORIG_RATES_SRC="v_public_release_rates (staged via v_publishable_version + version_loads)"
  ORIG_ITEMS_SRC="v_public_release_items (staged via v_publishable_version + version_loads)"
  STAGE_SQL="INSERT INTO x_pub SELECT p.hospital_id, p.file_version_id, vl.generation FROM v_publishable_version p JOIN version_loads vl ON vl.hospital_id = p.hospital_id AND vl.file_version_id = p.file_version_id AND vl.is_current_load WHERE p.hospital_id = $ARR;
INSERT INTO x_rates SELECT $R_COLS FROM rates r JOIN x_pub p ON p.hospital_id = r.hospital_id AND p.file_version_id = r.file_version_id AND r.load_generation = p.generation WHERE r.hospital_id = $ARR AND r.quality_labels = '{}' AND (r.negotiated_dollar > 0 OR r.derived_dollar IS NOT NULL OR r.negotiated_percentage IS NOT NULL OR r.negotiated_algorithm IS NOT NULL OR r.median_amount IS NOT NULL OR r.p10_amount IS NOT NULL OR r.p90_amount IS NOT NULL OR r.estimated_amount IS NOT NULL);
INSERT INTO x_items SELECT $I_COLS FROM items i JOIN x_pub p ON p.hospital_id = i.hospital_id AND p.file_version_id = i.file_version_id AND i.load_generation = p.generation WHERE i.hospital_id = $ARR AND i.quality_labels = '{}';"
else
  STAGE_SQL="INSERT INTO x_rates SELECT $R_COLS FROM $RATES_SRC WHERE r.hospital_id = $ARR $RATES_WHERE;
INSERT INTO x_items SELECT $I_COLS FROM $ITEMS_SRC WHERE i.hospital_id = $ARR $ITEMS_WHERE;"
fi
cat <<SQLEOF
\echo '  staging the $SCOPE_NOTE slice (one pass over each source relation)'
SET statement_timeout = '${HPT_STAGING_TIMEOUT:-2400s}';
$STAGE_SQL
INSERT INTO x_codes SELECT $C_COLS FROM item_codes ic JOIN x_items i ON i.hospital_id = ic.hospital_id AND i.item_id = ic.item_id WHERE ic.hospital_id = $ARR;
ANALYZE x_rates; ANALYZE x_items; ANALYZE x_codes;
SELECT 'staged' AS stage, (SELECT count(*) FROM x_rates) AS rates, (SELECT count(*) FROM x_items) AS items, (SELECT count(*) FROM x_codes) AS codes;
SET statement_timeout = '$TIMEOUT';
SQLEOF
RATES_SRC="x_rates r"; ITEMS_SRC="x_items i"; RATES_WHERE=""; ITEMS_WHERE=""; CODES="x_codes"

# One statement per hospital, against the staged slice.
for HID in $ID_LIST; do
  echo "\\echo '  hospital $HID'"
  echo "\\copy (SELECT i.hospital_id, i.file_version_id, i.item_id, $SRC_ROW_REF, ic.code_type_norm AS code_type, ic.code_norm AS code, i.description_raw AS description, i.setting, i.billing_class, i.modifiers, i.drug_unit, i.drug_type, i.gross_charge AS gross, i.discounted_cash AS cash, i.min_negotiated AS min_negotiated, i.max_negotiated AS max_negotiated, $GENERIC_NOTES, $DUP_COUNT FROM $ITEMS_SRC JOIN $CODES ic ON ic.item_id = i.item_id AND ic.hospital_id = i.hospital_id WHERE i.hospital_id = $HID AND ic.hospital_id = $HID AND $SCOPE AND i.quality_labels = '{}' $ITEMS_WHERE) TO '$OUT/charges/$HID.csv' CSV HEADER"
  echo "\\copy (SELECT r.hospital_id, r.file_version_id, r.item_id, ic.code_type_norm AS code_type, ic.code_norm AS code, i.setting, i.billing_class, i.modifiers, i.drug_unit, r.payer_id, r.plan_id, r.methodology_id, r.negotiated_dollar, r.negotiated_percentage, r.negotiated_algorithm, r.estimated_amount, r.median_amount, r.p10_amount, r.p90_amount, r.count_raw, r.additional_notes, $DERIVED_BASIS, array_to_string(r.quality_labels, ' ') AS quality_labels FROM $RATES_SRC JOIN $ITEMS_REL i ON i.item_id = r.item_id AND i.hospital_id = r.hospital_id AND i.file_version_id = r.file_version_id JOIN $CODES ic ON ic.item_id = i.item_id AND ic.hospital_id = i.hospital_id WHERE r.hospital_id = $HID AND i.hospital_id = $HID AND ic.hospital_id = $HID AND $SCOPE AND r.quality_labels = '{}' AND i.quality_labels = '{}' $RATES_WHERE) TO '$OUT/rates/$HID.csv' CSV HEADER"
  # Stage counts: what the hospital published, before and after each filter, so
  # "no prices" can distinguish a hospital with no file from one whose file has
  # no comparable code in it at all.
  echo "\\copy (WITH priced AS (SELECT DISTINCT r.item_id FROM $RATES_SRC WHERE r.hospital_id = $HID AND r.negotiated_dollar IS NOT NULL $RATES_WHERE), coded AS (SELECT DISTINCT ic.item_id FROM $CODES ic WHERE ic.hospital_id = $HID AND $SCOPE), it AS (SELECT count(*) AS items_total, count(*) FILTER (WHERE i.quality_labels = '{}') AS items_clean, count(*) FILTER (WHERE c.item_id IS NOT NULL) AS items_with_shoppable_code, count(*) FILTER (WHERE i.quality_labels = '{}' AND c.item_id IS NOT NULL) AS items_clean_shoppable, count(*) FILTER (WHERE i.discounted_cash IS NOT NULL) AS items_with_cash, count(*) FILTER (WHERE i.quality_labels = '{}' AND i.discounted_cash IS NOT NULL AND p.item_id IS NULL) AS cash_only_items FROM $ITEMS_SRC LEFT JOIN priced p ON p.item_id = i.item_id LEFT JOIN coded c ON c.item_id = i.item_id WHERE i.hospital_id = $HID $ITEMS_WHERE), ra AS (SELECT count(*) AS rates_total, count(*) FILTER (WHERE r.quality_labels = '{}') AS rates_clean, count(*) FILTER (WHERE r.quality_labels = '{}' AND r.negotiated_dollar IS NOT NULL) AS negotiated_dollar_rates, count(*) FILTER (WHERE r.negotiated_dollar IS NULL AND r.negotiated_percentage IS NOT NULL) AS percentage_only_rates, count(*) FILTER (WHERE r.negotiated_dollar IS NULL AND r.negotiated_percentage IS NULL AND (r.estimated_amount IS NOT NULL OR r.median_amount IS NOT NULL)) AS allowed_amount_rates, count(*) FILTER (WHERE r.negotiated_dollar IS NULL AND r.negotiated_percentage IS NULL AND r.negotiated_algorithm IS NOT NULL) AS algorithm_only_rates FROM $RATES_SRC WHERE r.hospital_id = $HID $RATES_WHERE) SELECT h.hospital_id, h.ccn, h.name, h.status, (SELECT count(*) FROM hospital_mrfs hm2 WHERE hm2.hospital_id = h.hospital_id) AS mrf_links, (SELECT count(*) FROM hospital_mrfs hm3 WHERE hm3.hospital_id = h.hospital_id $([ "$HAS_REJECTED" = 1 ] && echo "AND hm3.rejected_at IS NOT NULL" || echo "AND false")) AS mrf_links_rejected, it.*, ra.* FROM hospitals h, it, ra WHERE h.hospital_id = $HID) TO '$OUT/stage_counts/$HID.csv' CSV HEADER"
done

echo "COMMIT;"
} > "$SQL"

say "running one repeatable-read snapshot ($N_HOSP hospitals, statement_timeout=$TIMEOUT)"
psql -d "$DB" -v ON_ERROR_STOP=1 -f "$SQL"

# --- manifest fragment -----------------------------------------------------
say "manifest"
SNAP="$(tail -n +2 "$OUT/snapshot.csv" | head -1)"
{
  echo '{'
  echo "  \"stage\": \"01_export\","
  echo "  \"exportedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"database\": \"$DB\","
  echo "  \"state\": \"$STATE\","
  echo "  \"scope\": \"$SCOPE_NOTE\","
  echo "  \"hospitalIds\": [$IDS],"
  echo "  \"hospitalCount\": $N_HOSP,"
  echo "  \"statementTimeout\": \"$TIMEOUT\","
  echo "  \"snapshot\": \"$SNAP\","
  echo "  \"capabilities\": { \"rejectedAtAvailable\": $([ "$HAS_REJECTED" = 1 ] && echo true || echo false), \"sourceRowRefAvailable\": $([ "$HAS_SOURCE_ROW_REF" = 1 ] && echo true || echo false), \"genericNotesAvailable\": $([ "$HAS_GENERIC_NOTES" = 1 ] && echo true || echo false), \"dupCountAvailable\": $([ "$HAS_DUP_COUNT" = 1 ] && echo true || echo false), \"entryHashAvailable\": $([ "$HAS_ENTRY_HASH" = 1 ] && echo true || echo false), \"derivedBasisAvailable\": $([ "$HAS_DERIVED_BASIS" = 1 ] && echo true || echo false) },"
  echo "  \"ratesSource\": $(printf '%s' "$ORIG_RATES_SRC" | sed 's/"/\\"/g; s/^/"/; s/$/"/'),"
  echo "  \"itemsSource\": $(printf '%s' "$ORIG_ITEMS_SRC" | sed 's/"/\\"/g; s/^/"/; s/$/"/'),"
  echo "  \"codeScope\": $(printf '%s' "$SCOPE" | sed 's/"/\\"/g; s/^/"/; s/$/"/'),"
  echo '  "files": {'
  first=1
  while IFS= read -r f; do
    b="${f#$OUT/}"
    lines=$(( $(wc -l < "$f") - 1 ))
    sum="$(shasum -a 256 "$f" | cut -d' ' -f1)"
    bytes="$(wc -c < "$f" | tr -d ' ')"
    [ $first = 1 ] || echo ','
    first=0
    printf '    "%s": { "lines": %s, "bytes": %s, "sha256": "%s" }' "$b" "$lines" "$bytes" "$sum"
  done < <(find "$OUT" -name '*.csv' | sort)
  echo ''
  echo '  }'
  echo '}'
} > "$OUT/export_manifest.json"

say "done"
du -sh "$OUT"
