# Backlog

Work that was deliberately deferred, and why. When an item is picked up, delete
it from this list and put its reasoning in DESIGN.md or the code.

Historical questions live separately, in [data/DOUBTS.md](data/DOUBTS.md).

## Deferred

### Modern ponds in HydroLAKES

- Lakes now appear only once they are ~3×3 texels at the current level. That
  removed the overview speckle.
- Up close, thousands of small, largely modern steppe ponds (Ukraine, southern
  Russia) still draw as water.
- Separating natural lakes from modern ponds needs a better source or hand
  curation. It belongs with the `landscape-change` records.

### Aral Sea is drawn at its modern extent

- It is outside the frame (it only shows in the margin), but it is the
  shrunken 21st-century lake.
- Fix it with a `landscape-change` record, or by treating the margin as
  parchment in the paper tier.

### More landscape corrections

- Done: the Suez Canal, the Corinth Canal and Lake Tharthar are `remove-water`
  records (`data/landscape-changes.yaml`), applied by the coast build.
- Next batch: the Latmian Gulf, Ostia and the Tiber mouth, the Po delta, the
  Fucine Lake, Lake Copais, the Pontine Marshes, and the Nile lagoons (Mareotis,
  Manzala).
- A correction that begins or ends inside the window (the Latmian Gulf silting,
  for one) needs per-year variants of the affected mask tiles. v1 bakes one
  landscape for the whole window.

### Smooth modern cuts out of the terrain

- **Decided:** 2026-09-23, deferred.
- The canal corrections remove the *water*, but the elevation data (Copernicus
  GLO-30 via Mapterhorn) still records the dug channel and its embankments. The
  Suez Canal shows as a long straight dip with banks either side, and the
  Corinth Canal as a deep cut through the isthmus: visible in the hillshade, and
  obvious when the camera tilts.
- **Fix:** give `remove-water` records, or a new `fill-terrain` op, a terrain
  effect. Inside the corridor the worker replaces height with a surface
  interpolated from the ground on either side, feathered at the edge so the
  seam does not show. The same mechanism would flatten other modern earthworks
  if they turn out to matter: Tharthar's embankments, dams, motorway and
  railway cuts.
- Needs the corrections to reach the terrain worker, not just the coast build.
  Either bake a small "terrain patch" texture alongside the mask, or send the
  corridor polygons to the worker.

### River courses are modern

- HydroRIVERS traces today's courses from a 15″ DEM.
- The Nile delta gets its seven ancient branches as authored `river` features
  (the floodplain work). The modern Rosetta channel still draws alongside them
  until the delta's modern channels are suppressed.
- Other known differences need `river-course` records: the Po, the Euphrates
  at Babylon, and the Maeander into the Latmian Gulf.

### River precision at regional zoom

- HydroRIVERS is grid-derived (~450 m); smoothing hides the stair-steps but
  not the imprecision.
- For the rivers that matter most at regional zoom (Tiber, Arno, Po, Rhône,
  Nile), OSM waterways would be exact. Worth doing for a curated list, not
  wholesale.

### Political layer, left for later

- **Built:** fills, borders, glow, the year tables and cross-fade, the timeline
  and the click inspector (DESIGN.md §7.3).
- **Seat markers**: built (§7.4).
- **Occupation** (`relation: occupied`, e.g. Parthia in Syria in 40 BCE). The
  shader draws the holding layer only; occupation wants hatching over it.
- **Picking against relief.** Picking uses the flat plane, so at steep tilt it
  can miss by a few kilometres near a border.
- **Curved territory labels**: built (§7.5).

### Labels, left for later

- **Settlement names**: built (DESIGN §7.4). Left for later:
  - true small caps, with harfbuzz;
  - preferring the land side for coastal names; a paper halo makes them legible
    over water for now.
- **Greek.** Polytonic atlases and harfbuzz shaping, for names only attested in
  Greek.
- **Tilt parallax.** Labels are drawn at sea level with no depth test, so they
  are never hidden by relief. When the camera tilts, a name over high ground
  drifts off it by the relief's height. The fix is to lift each name to the
  ground height under it.
- **Two-line names** for compact territories with long names (Sardinia et
  Corsica, Bithynia et Pontus).
- **Heavier Cinzel.** The atlas is the variable font's default instance
  (Regular); the hairlines are thickened in the shader. A 600-weight instance
  would read better at small sizes.

### Roads, left for later

- **Built:** dated Itiner-e roads on the timeline (DESIGN §7.4).
- **Iberia and Africa are nearly roadless on the map.** That is a gap in
  Itiner-e's attributions, not in history: Republican Hispania had the coastal
  corridor and roads round Corduba, and Africa had a network around Carthage
  from 146. The legend must say so. Dating them means research per road.
- **Road names in the inspector.** `build/roads/roads.json` already carries each
  line's name, builder and source, in the order of `roads.bin`. It needs picking
  against the lines.
- **Roads under Rome's knockout.** Glyph knockouts apply to lettering only;
  roads cross names freely, as on a printed map.
