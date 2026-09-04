#!/usr/bin/env bash
# Read-only export from the `hpt` Postgres DB. NEVER writes to hpt.
# Produces compact CSVs in pipeline/raw/ for the packer to turn into web shards.
set -euo pipefail
OUT="$(cd "$(dirname "$0")" && pwd)/raw"
mkdir -p "$OUT"
DB="${HPT_DB:-hpt}"

# Elective / schedulable scope. Emergency + ambulance excluded: nobody price-shops those.
#   CPT   : 5-digit, minus ER visits & critical care (99281-99292)
#   HCPCS : minus ambulance (A0xxx)
#   MS-DRG: planned inpatient stays (joint replacement, etc.)
SCOPE="ic.code_type_norm IN ('CPT','MS-DRG','HCPCS')
   AND ( ic.code_type_norm <> 'CPT'
         OR (ic.code_norm ~ '^[0-9]{5}\$' AND NOT (ic.code_norm BETWEEN '99281' AND '99292')) )
   AND ( ic.code_type_norm <> 'HCPCS' OR ic.code_norm !~ '^A0' )"

# Only in-force versions of active files, on hospital<->file links that have not
# been rejected (backend migration 0016 / SPEC D41). Items and rates carry
# file_version_id, so this join is what stops a superseded version, a retired
# file, or a wrong-hospital attribution from reaching the site.
CURRENT="JOIN file_versions fv ON fv.file_version_id = i.file_version_id
                          AND fv.is_current AND fv.parse_outcome = 'parsed'
  JOIN mrf_files m ON m.mrf_id = fv.mrf_id AND m.active
  JOIN hospital_mrfs hm ON hm.hospital_id = i.hospital_id AND hm.mrf_id = fv.mrf_id
                       AND hm.rejected_at IS NULL"

say(){ printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

psql -d "$DB" -Atc "SELECT 1 FROM information_schema.columns WHERE table_name='hospital_mrfs' AND column_name='rejected_at'" | grep -q 1 \
  || { echo "hospital_mrfs.rejected_at is missing: apply backend migration 0016 first" >&2; exit 1; }

say "1/6 hospitals"
psql -d "$DB" -v ON_ERROR_STOP=1 -c "\copy (
  SELECT hospital_id, ccn, name, address, city, state, zip, ownership, hgi_type, status,
         pos_subtype_cd, exempt_basis, status_reason
  FROM hospitals WHERE state='VA' ORDER BY hospital_id
) TO '$OUT/hospitals.csv' CSV HEADER"

say "2/6 provenance (source file per hospital)"
psql -d "$DB" -v ON_ERROR_STOP=1 -c "\copy (
  SELECT DISTINCT h.hospital_id, mf.url, mf.source_page_url,
         fv.declared_last_updated, fv.declared_version, fv.layout,
         encode(fv.content_sha256,'hex') AS sha256, fv.size_bytes, fv.first_seen_at,
         fv.declared_hospital_name, fv.attestation_confirmed
  FROM hospitals h
  JOIN hospital_mrfs hm ON hm.hospital_id = h.hospital_id
  JOIN mrf_files    mf ON mf.mrf_id = hm.mrf_id
  JOIN file_versions fv ON fv.mrf_id = mf.mrf_id AND fv.is_current
  WHERE h.state='VA' ORDER BY h.hospital_id
) TO '$OUT/sources.csv' CSV HEADER"

say "3/6 dictionaries (payers, plans, methodologies)"
psql -d "$DB" -v ON_ERROR_STOP=1 -c "\copy (
  SELECT payer_id, payer_name_raw, payer_key FROM payers ORDER BY payer_id
) TO '$OUT/payers.csv' CSV HEADER"
psql -d "$DB" -v ON_ERROR_STOP=1 -c "\copy (
  SELECT plan_id, plan_name_raw, plan_key FROM plans ORDER BY plan_id
) TO '$OUT/plans.csv' CSV HEADER"
psql -d "$DB" -v ON_ERROR_STOP=1 -c "\copy (
  SELECT methodology_id, methodology FROM methodologies ORDER BY methodology_id
) TO '$OUT/methodologies.csv' CSV HEADER"

say "4/6 canonical description per code (most common wording across VA hospitals)"
psql -d "$DB" -v ON_ERROR_STOP=1 -c "\copy (
  SELECT DISTINCT ON (code_type_norm, code_norm)
         code_type_norm, code_norm, description_raw, n_hosp, n_rows
  FROM (
    SELECT ic.code_type_norm, ic.code_norm, i.description_raw,
           count(DISTINCT i.hospital_id) AS n_hosp, count(*) AS n_rows
    FROM item_codes ic
    JOIN hospitals h ON h.hospital_id = ic.hospital_id AND h.state='VA'
    JOIN items i ON i.item_id = ic.item_id AND i.hospital_id = ic.hospital_id
    $CURRENT
    WHERE $SCOPE
    GROUP BY 1,2,3
  ) t
  ORDER BY code_type_norm, code_norm, n_hosp DESC, n_rows DESC, length(description_raw) DESC
) TO '$OUT/code_descriptions.csv' CSV HEADER"

say "5/6 item-level charges per hospital+code (gross / cash / min / max)"
psql -d "$DB" -v ON_ERROR_STOP=1 -c "\copy (
  SELECT ic.hospital_id, ic.code_type_norm, ic.code_norm, i.setting, i.billing_class,
         max(i.gross_charge)    AS gross_charge,
         max(i.discounted_cash) AS discounted_cash,
         min(i.min_negotiated)  AS min_negotiated,
         max(i.max_negotiated)  AS max_negotiated
  FROM item_codes ic
  JOIN hospitals h ON h.hospital_id = ic.hospital_id AND h.state='VA'
  JOIN items i ON i.item_id = ic.item_id AND i.hospital_id = ic.hospital_id
  $CURRENT
  WHERE $SCOPE AND i.quality_labels = '{}'
  GROUP BY 1,2,3,4,5
) TO '$OUT/charges.csv' CSV HEADER"

say "6/6 negotiated rates (the big one)"
psql -d "$DB" -v ON_ERROR_STOP=1 -c "\copy (
  SELECT DISTINCT
         ic.hospital_id, ic.code_type_norm, ic.code_norm,
         r.payer_id, r.plan_id, i.setting, r.methodology_id,
         r.negotiated_dollar
  FROM item_codes ic
  JOIN hospitals h ON h.hospital_id = ic.hospital_id AND h.state='VA'
  JOIN items i ON i.item_id = ic.item_id AND i.hospital_id = ic.hospital_id
  JOIN rates r ON r.item_id = i.item_id AND r.hospital_id = i.hospital_id
                AND r.file_version_id = i.file_version_id
  $CURRENT
  WHERE $SCOPE
    AND i.quality_labels = '{}'
    AND r.negotiated_dollar IS NOT NULL
    AND r.negotiated_dollar > 0
    AND r.quality_labels = '{}'
) TO '$OUT/rates.csv' CSV HEADER"

say "done"
ls -lh "$OUT"
