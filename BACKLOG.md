# Backlog

Work that was deliberately deferred, and why. When an item is picked up, delete
it from this list and put its reasoning in DESIGN.md or the code.

Historical questions live separately, in [data/DOUBTS.md](data/DOUBTS.md).

## Deferred

### Bake sea depth from GEBCO 2026 (Option A)

- **Decided:** 2026-09-22. Deferred until the water polish pass. The depth
  problems are at the edges of the map; materials, rivers, politics and labels
  matter more first.
- **Known broken until this is done:**
  - **Tilted turquoise blocks in the Caspian.** AWS Terrain Tiles merge two
    sources. In some tiles the Caspian is a flat −28 m surface (its water
    level) instead of real depth, and the shader reads it as shallow water. The
    block edges are AWS's own Mercator tiles seen in Albers.
  - **Mottled, blocky shallows.** In the Aegean and around islands at the
    overview, AWS depth is only ~1–2 km per pixel at sea.
- **We chose not to patch the Caspian in the meantime**, e.g. by treating flat
  −28 m readings as "depth unknown". The bake fixes it properly.
- **Plan:**
  - Download GEBCO_2026 (NetCDF, ~7 GB) into `.cache/sources/`. It is used at
    build time only and never ships.
  - Bake depth tiles on the terrain quadtree the way `pipeline/src/water`
    bakes the coast. Estimate: ~20–30 MB.
  - Read them in `heightWorker.ts` in place of the runtime AWS fetch, and drop
    the AWS source.
- **Option B (later, only if needed):** EMODnet DTM (115 m) for the
  Mediterranean and Black Sea, with GEBCO everywhere else. Worth it only if
  Mediterranean coasts still look soft up close.

### Pack the coast mask into one archive

- `build/water` is ~39k small files. That exceeds Cloudflare Pages' free-plan
  limit of 20k files.
- Pack them into a single PMTiles-style archive, read with HTTP range
  requests, before the first deploy.

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
