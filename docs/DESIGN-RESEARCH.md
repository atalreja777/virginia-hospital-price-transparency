# Design research — Awwwards field notes

Source: Awwwards winners galleries (Sites of the Day, Honorable Mentions) filtered
to the categories this project actually lives in: Data Visualization, Typography,
Clean, Minimal, Storytelling. ~30 winners examined, plus live visits.

## What juries actually reward

Awwwards tags every winner with the specific *elements* that earned the award.
Across the sample, the same categories repeat:

| Element category | Frequency | Applies here as |
|---|---|---|
| Scroll-driven reveal | very high | Charge-vs-price gap assembling as you scroll |
| Page transition | very high | Search → results → hospital, no white flash |
| Preloader / intro | high | First paint while the code index loads |
| Mouse / hover microinteraction | high | Price rows, map pins, chart bars |
| Editorial chart ("Stats") | high | The legislator-facing statistics |
| Footer animation | high | Sources + methodology footer |
| Map / list / hybrid navigation | medium | The core results screen |

## Stack the winners use

GSAP appears in nearly every motion-led winner. Three.js/WebGL for hero moments.
Barba.js for transitions. Lenis for smooth scroll. Frameworks split across
Next.js, Nuxt, Astro.

The single most relevant winner is **Redesigning Trust / Level2** — tagged
"Dashboard & Design System", Clean, Flat Design, Data Visualization, Forms and
Input, built with **React + Next.js + Tailwind**. A data tool won without WebGL
spectacle. That validates the approach: restraint plus craft, not 3D for its own sake.

## Color

Winners run 1–2 colour palettes. Recorded grounds: `#08090D`, `#060403`,
`#000000`, single accents like `#00AA54`, `#F3AFCC`. The lesson is restraint —
a near-black ground and exactly one accent reads as authoritative. For a
government audience that matters more than colour variety.

## Typography

Large scale contrast, tight tracking on display type, neo-grotesk faces.
The AI in Design Report 2026 sets its title as a solid black slab with
very tight heavy grotesk at enormous size. Editorial charts pair a big
number with a small label — exactly the pattern for "6.5× price spread".

## Patterns lifted, per site

- **Resider** (`resider.ca`, Data Viz + Real Estate) — the results screen blueprint.
  Styled dark map on the left, scrollable result cards on the right, price pills
  as map markers, numeric clustering at low zoom, compact filter chips across the
  top, and a "search as I move the map" toggle. Directly transferable to hospitals.
- **The Grid to the Page** (`consider.digital/story`) — "Anatomy of a Web Page,
  exploded on scroll". Scroll-driven explanation of an invisible system. This is
  the model for teaching deductible → coinsurance → out-of-pocket max.
- **AI in Design Report 2026** (`stateofaidesign.com`) — a research report as an
  editorial experience: chapter structure, editorial charts, motion carrying the
  argument. The model for the statistics section.
- **SSTR** (`sstr.tech`) — Clean, Minimal, Typography, Data Visualization on Astro
  + GSAP + Barba. Proof that industrial data can look composed.
- **Where the Shadow Fell** — scientific data as narrative.

## Decisions for this build

1. React + Vite + Tailwind. Static output, no server, deploys to GitHub Pages.
2. Near-black ground, one accent. No decorative colour.
3. Motion earns its place: scroll reveals, shared-element transitions, hover
   feedback. No WebGL spectacle — this is a tool people use when they are worried
   about a bill.
4. MapLibre GL with free tiles. No API key, so the site cannot break on a
   billing or quota failure.
5. Respect `prefers-reduced-motion` throughout. A price-transparency tool used by
   sick people must not force animation on anyone.
