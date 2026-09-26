# Roman world map — design

A GPU-rendered, game-quality interactive map of the Roman world with a timeline.
Imperator: Rome is the bar for how it should _feel_; the Barrington Atlas is the
bar for what it may _claim_. The Cicero project will be its first consumer, but
the map is a general-purpose package and knows nothing about Cicero.

Status: draft, September 2026.

---

## 1. Principles

1. **Accuracy first. Nothing is drawn that the data does not support.** Where
   the evidence is weak the drawing says so: a frontier the sources leave vague
   is drawn soft, and a kingdom whose extent nobody knows is drawn as a seat,
   not a guessed polygon. _The source's silence is not evidence._ One
   exception, kept apart and marked: the generated city of the model of Rome
   (§7.7).
2. **Everything is dated.** A record without a date range cannot take part in
   the timeline, so it does not ship. (A physical feature is dated too: "always"
   is a date range.)
3. **Every visual element encodes something.** Colour means politics, texture
   means physical ground, and a dashed line means uncertainty. There is no
   decoration for its own sake. This is what keeps the map from looking
   vibe-coded.
4. **Zooming in adds detail and never removes it.**
5. **Build small, structure for growth.** v1 is one period. Growing it means
   adding rows, never changing the schema or the renderer.
6. **Builds report their own doubt.** Every build prints what it could not
   confirm, what it moved and what it overrode.

---

## 2. Scope of v1

| Decision       | v1                                                                                                                            | Grows to                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Time window    | **133–27 BCE**, the Gracchi to Augustus's settlement                                                                          | any year; schema is open              |
| Frame          | **10°W–50°E, 22°N–58°N**: Ireland/Portugal to the Persian Gulf, Upper Egypt to Scotland; data carries a few degrees of margin | wider by config                       |
| Zoom           | continental → **regional** (towns, roads, villas, ~50 m/px)                                                                   | city-plan level is a separate product |
| Neighbours     | Parthia, Germania, Dacia, Britannia, Arabia: named, roughly bounded, not curated town by town                                 | curated as needed                     |
| Platform       | **desktop browsers only**, mouse and trackpad                                                                                 | —                                     |
| Licence stance | **non-commercial**; our data released under **CC BY-SA 4.0**                                                                  | —                                     |

Non-commercial use opens up share-alike and non-commercial sources (FABDEM,
DARE). Every record carries its sources' licences, so if the project ever goes
commercial the build can be re-run without them.

---

## 3. Architecture

```
roman-map/
  DESIGN.md
  data/                 hand-authored records (YAML) + geometry (GeoJSON) — the moat
  pipeline/             ingest, validate, bake — Node/TS, GDAL CLI for rasters
  packages/
    world/              projection, frame and tile addressing, shared by pipeline and engine
    schema/             zod schemas + TS types, shared by pipeline and engine
    engine/             the renderer and its public API (three.js)
  apps/
    explorer/           first consumer: the map, a timeline, an inspector
```

npm workspaces, TypeScript, Vite. Cicero either becomes `apps/cicero` or
imports `packages/engine` from its own repo; it plugs in through the same API
as the explorer (§9) either way.

**Flow:** `data/` + external sources → `pipeline` (validate → join → bake) →
`build/` outputs (textures, tiles, JSON) → `engine` → apps.

**Stack, from the research (September 2026):**

- **three.js WebGPURenderer.** It falls back to WebGL2 automatically, which
  matters because ~5% of desktop users, mostly on Linux Firefox, still lack
  WebGPU. Shaders are written once in **TSL** and compile to WGSL or GLSL.
  Rejected: Cesium, MapLibre, Mapbox and deck.gl (too little control over the
  look, and built for a globe or Web Mercator); Bevy/wasm (too costly on the
  web); raw WebGPU (we would rebuild tiling and text for no gain).
- **Text:** msdf-atlas-gen bakes MTSDF atlases at build time, and harfbuzzjs
  shapes the text. Slug is the upgrade path for very large type: its patent
  was dedicated to the public domain in March 2026 and the reference shaders
  are MIT/Apache.
- **Lines:** instanced segment quads (Rye Terrell's technique), with a
  cumulative-distance attribute for dashes.

---

## 4. Projection and the world plane

**Albers equal-area conic, standard parallels 30°N and 50°N, central meridian
20°E, origin latitude 40°N.** Everything is pre-projected offline into a flat
world plane in metres, and the engine never sees lon/lat except at its API
boundary. The map is a plane, as in a game. There is no globe.

Scale error along parallels, computed for the candidates:

| parallels   | worst in frame   | worst in Mediterranean core (32–46°N) |
| ----------- | ---------------- | ------------------------------------- |
| 30 / 46     | 7.7% at 58°N     | 1.0%                                  |
| **30 / 50** | **5.0% at 58°N** | **1.5%**                              |
| 28 / 52     | 4.0% at 58°N     | 2.2%                                  |

30/50 is the compromise: Scotland pays a little so the core stays tight.
Because every output is pre-projected, **this decision is frozen once the
pipeline ships.** Changing it means rebuilding every file.

A known trap: d3-geo and polygon-clipping disagree on ring winding. The
pipeline normalises winding once, at ingest, and asserts it.

---

## 5. Data model

The core idea: **geometry once, time as a table.** Shapes are drawn once; everything that changes over time is a dated
row that refers to them.

### 5.1 Entities

| Entity             | What it is                                                                                                     | Key fields                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `source`           | A citable work or dataset                                                                                      | id, citation, url, licence                                                |
| `atom`             | Ground that is never subdivided at any date the data covers. It carries geometry and no politics.              | id, geometry, evidence (`surveyed` / `derived` / `schematic`), splitFrom? |
| `polity`           | A political unit, independent of ground: a province, a client kingdom, Parthia, a tribe                        | id, kind, dated names, parent relations                                   |
| `claim`            | **The time series.** Atom × polity × relation × interval                                                       | atom, polity, relation, interval, sources, confidence                     |
| `relation`         | A polity-to-polity link over time, e.g. a client kingdom is _client of_ Rome                                   | from, to, type, interval                                                  |
| `seat`             | A polity drawn as its capital because its extent is unknown                                                    | polity, place, interval                                                   |
| `place`            | A located thing: a settlement, fort, sanctuary or pass. Joined to Pleiades.                                    | id, pleiades, location, kind, interval, prominence over time              |
| `name`             | A dated, language-tagged name for a place, polity or feature                                                   | target, text, lang, interval, preferred?                                  |
| `route`            | A road segment, from Itiner-e                                                                                  | geometry, class, built interval, sources                                  |
| `landscape-change` | A dated correction to modern physical geography: add or remove water, marsh, reservoir removal, a river course | geometry, op, interval, sources                                           |
| `feature`          | Physical named features: rivers, mountains, capes, seas                                                        | geometry, names                                                           |

Claim `relation` values: `province`, `citizen-territory`, `client`, `allied`,
`independent`, `occupied` (e.g. the Parthian invasion of Syria in 40 BCE). Map
modes are just different joins over this table: owner, top-level power,
province status, and so on.

### 5.2 Time

- **Authoring format: explicit era strings.** `"63 BCE"`, `"14 CE"`, or a
  range `"c. 81 BCE"`. The build converts them to **astronomical integers**
  (1 BCE = 0, 43 BCE = −42), so arithmetic across the era boundary is correct.
  Nobody ever types a sign.
  - Writing −43 for 43 BCE and calling it "astronomical" is a real ambiguity.
    It is harmless while the window is entirely BCE, and stops being harmless
    the moment the window grows.
- **Fuzzy intervals.** Each endpoint is either a year or
  `{ earliest, latest }`. The renderer takes the midpoint by default, and the
  inspector shows the range.
- **Open ends.** `"before 133 BCE"` means the record starts before the window,
  and is distinct from an unknown start.
- **Precision:** v1 works in whole years. The schema allows month/day with a
  `calendar` tag (`roman-republican` / `julian`) for later. Cicero's letters
  are dated to the day, and the pre-45 BCE Roman calendar drifted months out of
  step with the seasons.

### 5.3 Uncertainty and review, as two separate fields

Confidence and review state are separate fields, never one scale:

- `confidence: certain | probable | uncertain`. How firmly the sources support
  the claim. **This is drawn.**
- `review: verified | draft | needs-check`. The state of our work on it.
  **This is reported by the build, never drawn.**

Every historical record needs at least one `sources` entry: a source id plus a
locator (page, map number, fragment). A `note` field holds reasoning that
should survive.

### 5.4 Identity

- **Pleiades IDs** wherever a record corresponds to a Pleiades place.
- Otherwise **our own stable slugs** (`hispania-citerior`). Never array
  positions, and never IDs from upstream files. AWMC OBJECTIDs are not stable
  across releases.
- Territory geometry is **authored, not ingested** (September 2026): each atom
  is built by `npm run atoms -w pipeline` from the frontier its sources name —
  vertices at places (with Pleiades ids), legs along rivers (HydroRIVERS) or
  ranges (the DEM), clipped to land — so no upstream id is ever needed.

### 5.5 Atoms across a growing time span

Within one window an atom is "ground that never subdivides _during the
window_". A longer span will need atoms to split: a province divided, a
kingdom partitioned. The rule is **finest common subdivision**. When a new
boundary is needed, the atom is split into children with `splitFrom: parent`,
and claims on the parent are rewritten onto the children by a migration script
the build can verify. Atoms never overlap: the build cuts every earlier atom out
of each outline, and the validator asserts it.

### 5.6 Authoring format

- Records are **YAML**, one file per entity type, split further by region once
  a file grows large. YAML allows comments, multi-line notes, and reads well
  in diffs.
- Geometry is **GeoJSON** in lon/lat, keyed by the same ids.
- Everything is validated against `packages/schema`.
- **The build fails on any of these:**
  - a claim referencing a missing atom or polity;
  - overlapping claims on one atom with the same relation layer;
  - an interval with end before start;
  - a record with no source;
  - an atom set that does not cover the land it came from.
- It lives in git for v1. An editing tool (a map-side inspector that writes
  YAML) is planned once hand-editing hurts, not before.

---

## 6. Sources

| Layer                   | Source                                                                                                                                                                  | Licence                                                           | Notes                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Terrain (runtime)       | **Mapterhorn** `planet.pmtiles`, Terrarium encoding                                                                                                                     | various open; **terms of the hosted file unverified**             | 30 m global, finer in parts of Italy and Spain. Web Mercator, reprojected by the engine (§7.1). Fallback: AWS Terrain Tiles.                                 |
| Terrain (offline bakes) | Copernicus GLO-30; **FABDEM** (bare earth) now allowed                                                                                                                  | Copernicus licence; CC BY-NC-SA                                   | Used for ambient occlusion and texture-shading bakes                                                                                                         |
| Bathymetry              | **EMODnet DTM 2024** (~115 m) over the European seas, **GEBCO_2026** (15″, ~460 m) elsewhere, baked offline (§7.2)                                                      | CC BY 4.0; public domain with attribution                         | Drives the shallows. AWS Terrain Tiles were used at runtime until September 2026: ~1–2 km at sea, and they drew the Caspian as a flat −28 m slab.            |
| Coastline, modern       | OSM land polygons, split edition (osmdata.openstreetmap.de)                                                                                                             | ODbL                                                              | Natural Earth 10m is too coarse at 50 m/px                                                                                                                   |
| Lakes                   | **HydroLAKES v1.0** (≥ 0.05 km²)                                                                                                                                        | CC BY 4.0                                                         | Reservoirs (type 2) are dropped, which removes Nasser, Atatürk, Assad and similar automatically                                                              |
| Coastline, ancient      | Our `landscape-change` records; AWMC period patches as seed                                                                                                             | ours; ODbL                                                        | AWMC's `roman_open_water` layer is 2 polygons (Miletus, Ephesus) and its Hellenistic layer 5 (adding Utica). Checked 2026-09-22.                             |
| Places                  | **Pleiades**; DARE as a cross-check                                                                                                                                     | CC BY 3.0; CC BY-SA 3.0                                           | Importance is curated by us                                                                                                                                  |
| Territory geometry      | **Our own outlines**, authored from the frontiers the cited scholarship names: rivers along HydroRIVERS, ranges along the Mapterhorn DEM, clipped to Natural Earth land | ours (CC BY-SA); public domain; HydroRIVERS **licence to verify** | Rebuilt September 2026 (`pipeline/src/atoms`). AWMC's `roman_empire_bce_60` was dropped: one unnamed Roman extent, coarse, cut with straight lines, and ODbL |
| Region and people names | AWMC `regional_names_linework`                                                                                                                                          | ODbL                                                              | Baselines give size and angle                                                                                                                                |
| Rivers                  | AWMC river lines (Barrington); HydroRIVERS for minor                                                                                                                    | ODbL; **licence to verify**                                       | Modern courses corrected at deltas                                                                                                                           |
| Roads                   | **Itiner-e**                                                                                                                                                            | CC BY 4.0                                                         | Only dated segments ship. Construction date kept per feature, so a road never draws before it was built.                                                     |
| Surface textures        | ambientCG, Poly Haven                                                                                                                                                   | CC0                                                               | Rock, scree, sand, soil, scrub                                                                                                                               |
| Aridity / biome         | Köppen–Geiger (Beck et al.)                                                                                                                                             | **licence to verify**                                             | Modern climate as a proxy for desert versus green; used coarsely                                                                                             |
| Reference only          | Barrington Atlas, Broughton MRR, Talbert                                                                                                                                | ©                                                                 | Cited, never copied                                                                                                                                          |

ODbL is share-alike but it is not CC BY-SA: a database derived from ODbL data
must itself be released under ODbL, so ODbL-derived layers (the OSM coast
mask, AWMC names) keep their licence and are credited separately. The territory
outlines are clipped to public-domain Natural Earth land for that reason. The
attribution screen is generated from the `source` registry.

### 6.1 Landscape changes, the v1 list

These are changes visible at regional scale, each digitised from a published
reconstruction. Each record starts at `review: draft` or `needs-check`.

- **Silted bays and deltas:**
  - the Latmian Gulf (Miletus, Priene, Myus, Heraclea);
  - Ephesus and the Cayster;
  - the Tiber mouth (Ostia);
  - the Po delta (Ravenna, Adria, Spina);
  - the Arno (Pisa);
  - Aquileia's lagoon;
  - the Gulf of Utica and the Bagradas;
  - Thermopylae and the Malian Gulf;
  - the Nile branches and Lake Mareotis;
  - the Rhône mouth;
  - the Ebro delta, mostly post-Roman land to be removed.
- **Modern reservoirs to remove:** Lake Nasser, Atatürk, Keban, Assad, and the
  largest Spanish and Anatolian reservoirs.
- **Drained water to restore:** the Fucine Lake, Lake Copais, the Pontine
  Marshes.
- **Persian Gulf head:** the ancient shoreline is debated, so it is drawn with
  `confidence: uncertain` and a soft edge.

Sea level was about −1.35 m in the central Mediterranean (Lambeck 2004), which
is invisible at regional scale. It is not applied globally, because local
tectonics dominate.

---

## 7. Rendering

### 7.1 Terrain

- **A quadtree of heightmap tiles in the Albers plane**, CDLOD-style, with
  geomorphing between levels. A top-down strategy camera with limited tilt
  keeps this simple.
- **Reprojection:** a worker fetches the Mercator Terrarium tiles covering an
  Albers tile, resamples them into an Albers heightmap, and caches the result.
  The GPU only ever sees plane-space tiles.
- Mesh: a regular grid per tile (Martini or RTIN later, if the vertex budget
  bites).
- **Lighting in the shader:** light from several directions, plus a baked
  ambient-occlusion and texture-shading overlay at low zoom for mountain
  structure.
- **Materials:** CC0 detail textures blended by masks derived from data, not
  painted:
  - **rock** from slope;
  - **bare ground** from elevation;
  - **green versus arid** from the aridity/biome layer;
  - **sand** from distance to coast.

  The masks describe physical ground only. There are no invented fields or
  forests. Centuriation drawn from real survey data is a later, evidenced
  exception. The one place farmland is drawn is round the model of Rome (§7.7),
  close in, keyed as illustrative like its houses.

- **Floodplains are records, not a runtime derivation.** Irrigated floodplain
  colour matters only where a great river crosses dry land: the Nile valley and
  delta, the Fayum, the Mesopotamian alluvium, Susiana. Each is a sourced
  `kind: floodplain` feature.
  - Its geometry is derived offline from terrain: height above authored
    channel lines (the seven ancient delta branches included), clipped to a
    loose authored outline.
  - It is baked into channel 1 of the coast mask.
  - Rejected: computing height above the nearest HydroRIVERS channel at
    runtime. The modern delta has one channel, so the delta came out lopsided;
    the reach cut-off drew straight edges; and every zoom level gave a
    slightly different answer, so the edges jumped as tiles swapped.
  - Rejected: modern land-cover data, which is anachronistic (20th-century
    irrigation schemes).

### 7.2 Water

- **The land/water mask is a signed distance field of the coast**, built by
  `npm run water -w pipeline` (`pipeline/src/water/`):
  - **Inputs:** OSM land polygons minus HydroLAKES (no reservoirs). The
    `landscape-change` records will be applied here per year once they exist.
  - **Layout:** tiles use the terrain quadtree's own addresses and texel grid,
    for levels 0–10. Texels are 27 m at level 10; the deepest terrain (level 11,
    13.5 m) reads a window of its level-10 ancestor. The mask stopped at level 8
    (108 m) until September 2026, and at full zoom that rounded every harbour
    mole, spit and islet into a blob next to 15 m relief.
  - **Encoding:** distance is clamped to ±16 texels, quantised to 8 bits, and
    stored as lossless WebP (~5 KB per tile).
  - **Skipped tiles:** tiles with no shore are not written. `index.json`
    records, for levels 0–8, whether each is all land or all water. Below that
    a tile is simply written or not: an unwritten one has no shore within
    reach, so its ancestor's field already describes it.
  - **Packs:** levels 0–5 are loose files. Every tile from level 6 down lives
    in the pack of its level-6 ancestor (`packages/world/src/pack.ts`), read
    with HTTP range requests. A static host counts files (Cloudflare Pages
    allows 20k), and levels 9–10 alone are hundreds of thousands of tiles.
  - **What it gives the shader:** from one field, a crisp antialiased coast at
    any zoom (the edge is where the field crosses zero, found to sub-texel
    precision), a screen-space shore rim, and a hairline of ink. It is also why
    land below sea level (Qattara, the Jordan valley) is no longer drawn as sea.
- **Depth is baked too** (`npm run depth -w pipeline`, `pipeline/src/depth/`),
  after the coast mask, whose tile codes say which tiles are dry:
  - **Sources:** EMODnet DTM 2024 (~115 m) wherever it reaches, which is every
    European sea; GEBCO_2026 elsewhere (the Red Sea's east, the Gulf, the
    Caspian). EMODnet is fetched in 2° chunks from its WCS into `.cache`.
  - **Sea under the source's land.** Neither source's shore agrees with OSM's;
    GEBCO's can sit half a kilometre off. Where the mask says sea but a source
    says land, depth read 0 and drew a turquoise fringe unrelated to the sea
    floor. So each source's sea is carried a short way under its land (1.8 km
    EMODnet, 3.7 km GEBCO) before sampling.
  - **Smoothed by depth.** EMODnet is a patchwork of surveys, and each
    footprint and track line leaves a straight-edged step: coloured by depth,
    the open sea read as a grid of boxes that appeared tile by tile on zooming
    in. The bake blurs the depth with a radius that grows with it — 100 m in
    the shallows, 1 km from 400 m down — so shelves, banks and channels keep
    their shape and the survey seams offshore go. Land does not drag the blur
    shallower (normalised convolution), tiles are sampled with an apron so
    neighbours agree, and every level blurs by the same metres, so a coarse
    tile standing in for finer ones shows the same sea.
  - **Surfaces:** depth is measured from the local water surface. The Caspian
    (−28 m) and the Dead Sea (−430 m) are listed with their modern levels.
  - **Layout:** levels 0–5 sample the GEBCO halving that matches their texel.
    Level 6 (431 m) and below average the fine source over each texel. Levels
    7 and 8 are written only where they differ from the tile above by more than
    1 m + 3%, in water shallower than 600 m; the open sea reads a window of
    level 6.
  - **Encoding:** √depth in 1/32 steps (0.15 m at 6 m, 4 m at 5,000 m), gradient
    predictor, deflate (`packages/world/src/depth.ts`). A byte per texel bands
    the shallows ramp; this is ~30 KB for a level-8 tile full of shelf.
  - **Not tied to the shore distance.** A runtime limit (floor falling no
    faster than 1:2 from the drawn coast) was tried and removed: the shore
    distance is clamped at 16 mask texels, a reach that differs between tiles
    with coast and without, so it capped whole coastal tiles at ~215 m and drew
    a lighter rectangle round every island.
- **Shading** (`packages/engine/src/terrain/water.ts`) keeps the paper tier's
  contrast far out and adds detail only as it becomes resolvable:
  - **Colour from depth** in exponential steps, as light falls off in water:
    sand showing through the first few metres, turquoise over the shelf, a mid
    blue on the slope, navy in the basins. Lakes are told apart from sea by
    their surface height and take a flat colour.
  - **Surface:** four octaves of noise (1.6 km, 250 m, 60 m, 15 m)
    perturb a normal lit by the map's north-west light, with a warm glint and a
    sky sheen that grow as the camera tilts. The noise repeats every 256 cells
    and each tile gets its offset into that period in double precision: world
    kilometres over a 15 m wavelength overflow float32 and drew the ripples on
    a grid. Value noise, warped octave by octave, with a sine-free hash, since
    both plain value noise and a sin hash showed straight lines close in. The
    noise is baked once into a tileable texture (value and gradient, four
    texels a cell), so an octave is one read rather than eight hashes.
  - **Cost:** the surface and surf sit behind branches that only water pixels,
    close enough in to show them, take; an octave finer than a pixel is
    skipped. Measured September 2026 against the commit before any of this
    (paired, Retina, M-series): +0.1 ms a frame inland, +0.3–1 ms over water
    (4–13%). The arithmetic noise, unbranched, had cost up to 25%.
  - **Surf in metres:** lines 28 m apart over the last ~120 m of gently
    shelving shores (not cliffs), broken by noise, with foam at the water's
    edge: the engraver's waterlining, read as surf. A darker band of wet sand
    runs along low, flat shores.
  - **Nothing moves.** Drifting swell and rolling surf were built and taken
    out (September 2026): motion is a game's idiom, it pulls the eye from what
    the map is about, and a still map only needs drawing when something
    changes.
  - **The overview rim** (a few pixels of shallows along every coast) is kept
    only far out. It is measured in the camera's metres per pixel: measured in
    the field's own derivative, it drew a square around every islet smaller
    than a mask texel.

### 7.3 Politics: the atom field

Built in September 2026 (`npm run politics -w pipeline`,
`packages/engine/src/politics/`). It follows the Imperator technique, splitting
_where_ from _who_, with one change: borders come from a distance field, not
from vector lines.

- **Offline, the atom field.** Tiles on the terrain quadtree, levels 0–6, with
  431 m texels at level 6. The atom outlines are ~1 km, so level 6 already holds
  everything they know. Each texel stores:
  - the pair of atoms either side of the nearest boundary;
  - the signed distance to that boundary, reaching 48 texels, on a square-root
    scale: fine near the line, coarse where only the glow reads it.

  Land and sea come from the coast mask, so a fill stops exactly where the drawn
  coast does. The sea takes its nearest land's label, so a fill reaches the
  coast at any texel size. Also handled:
  - slivers between the atom outlines' Natural Earth coast and OSM's;
  - small islands no outline covers;
  - gaps left between neighbouring outlines.

  Each of these goes to the nearest atom. Any other land is unclaimed, label 0.
  The result is about 1,000 tiles, 3.4 MB, baked in about 20 s.

- **Runtime, who held it.** Two 2048×3 tables, `from` and `to`, one column per
  atom:
  - row 0: fill colour and coverage;
  - row 1: polity, power, evidence, and a sea flag;
  - row 2: border ink, and a client flag.

  `setYear` rewrites one table and cross-fades between the two. It never
  rebuilds a tile.

- **Colour by power** (decided 2026-09-22). A polity takes the colour of the
  power it answers to, found by following `province-of`, `client-of` and
  similar links up to the top. Provinces are small, stable shifts of that
  colour. Client kingdoms are the colour washed towards parchment. Uncertain
  claims draw fainter. Colours are style, in `politics/palette.ts`, not data.
- **Borders are drawn in the terrain shader from the field.** This replaces the
  earlier plan of vector segments. The shader:
  - takes labels from the nearest texel, never interpolated;
  - interpolates distance from the four texels around, each re-expressed
    against the nearest texel's pair so no phantom line appears midway between
    two boundaries.

  Drawing in the terrain pass means borders sit on the relief at any tilt with
  nothing to z-fight, and one field gives the line, its antialiasing and the
  glow. What shows is decided per pixel, per year:
  - nothing between two atoms of one polity;
  - a light line between provinces of one power;
  - a full border plus glow between powers, around a client kingdom, or where
    claimed land meets unclaimed;
  - nothing on water.

- **Evidence styling.**
  - A schematic boundary has no hard line and no glow: a faint, wide soft band,
    with the fill fading in across the zone. It reads as a region's margin, not
    a frontier.
  - The "dashed core" of the first plan needs an along-line coordinate the
    field does not have, so it was dropped.
- **Zoom tiers (§7.6).**
  - The fill runs from 82% at the overview to 10% close in.
  - The glow stays at 70%, sized in pixels and capped at 15 km. The contrast
    between a strong edge band and a lighter interior is what makes a border
    read.
- **Picking** reads the level-6 tile on the CPU: plane position → atom →
  claim(year). There is no GPU readback. It ignores relief, so a steep tilt can
  mis-pick near a border.

### 7.4 Lines and points

Roads, rivers and borders were to share one instanced line renderer. In the end
all three are painted into the terrain in its own shader pass (§7.1, §7.3), so they
sit on the relief at any tilt.

**Roads were built in September 2026** (`npm run roads -w pipeline`,
`packages/engine/src/roads`). The source is Itiner-e, static version 2024, CC BY 4.0.
What matters about it:

- **The coordinates are EPSG:3395.** The source's GeoJSON is ellipsoidal World
  Mercator, not EPSG:4326, and is unprojected with an iterated latitude.
- **Only dated roads are drawn.** A segment is kept only when the source dates
  its construction to 27 BCE or earlier (`pipeline/src/roads/dating.ts`, ported
  and moved to astronomical years):
  - `Cons_per_e`, the Roman builder, outranks `Lower_Date`, the older route;
  - the latest bound of a range decides.

  That leaves the Republican trunk network as historians name it. An undated road
  cannot take part in a time series, so it is dropped, not drawn faintly.

- **Corrections to its dating** (`data/road-corrections.yaml`, decided 2026-09-26).
  Itiner-e leaves some of the oldest roads out of Rome undated, and dates the
  Salaria by a later paving ("Late Republic (72–30 BCE)"), so zoomed out they were
  missing round the city. Where the sources show a road in use in the window, a
  record dates every segment of that Itiner-e line from then, with its sources, and
  the build prints each line it corrected: the Salaria (Livy 7.9.6), the Nomentana
  (3.52.3), the Labicana (4.41.8), the Latina (Platner & Ashby, pp. 564–565), the
  Ostiensis (its paving of 260–240 BCE, SITAR 4707) and the Praenestina (a milestone
  of the 2nd century BCE). That makes 419 lines. The Portuensis (Claudian), the
  Ardeatina (unattested in the window) and the road to Veii (no bridge to it) stay
  undated.

- **Each segment keeps its first year**, and the shader shows it only from then,
  so a road built in 46 does not draw at 68 BCE.
- **The tile field** holds, per texel, the distance to the nearest road, plus
  one exact integer packing its year, class and certainty. At a tie between two
  roads, the older one wins, so a junction never waits on the newer road.
- **Style** (reworked 2026-09-22; a bare hairline read as unfinished): a cased
  road, the atlas symbol.
  - A cream core between fine dark edges, 3.2 CSS px wide for main roads and
    2.4 for secondary. It is the same language as the settlement names: light
    type with a dark halo.
  - Main roads appear from 900 m/px and secondary from 400, never at the
    overview.
  - Certainty sets the strength: surveyed 100%, conjectured 80%, hypothetical
    55%.
  - Dashes were considered and set aside. They need an along-road coordinate
    per texel, which half floats cannot hold at close zoom.

**Points were built in September 2026** (`packages/engine/src/labels/PlaceLayer.ts`).
Settlements and seats are screen-sized: each is anchored to its place and offset in
pixels by the vertex shader. The anchor stands on the ground — its height from
Mapterhorn at z10, baked into places.json, times the terrain's vertical
exaggeration — so a tilted view does not slide a hill town's marker off its hill.
Rome's monuments stand on the model's ground and, while the model stands, rise with
it to the top of their building (or, where it is not drawn, of the roofs round it),
so each marker sits on its temple's roof.

- **Markers** are drawn in pixels, like engraved symbols: fixed stroke widths, one
  pixel of antialiasing, no halo discs (reworked 2026-09-22, after the first
  version read as a generic web map).
  - A town is a small ink dot with a paper hairline.
  - A capital (provincial or royal seat) is a fine ring round a dot, with paper
    between them.
  - Rome has a second, finer ring.
  - A kingdom drawn as its capital (`seats.yaml`) is a diamond in its power's
    colour, outlined in ink.
- **What shows** (also reworked 2026-09-22; the first version crowded the
  overview):
  - Rome shows at every scale. Tier 1 appears from 3,000 m/px, then 1,500, 800
    and 400 for tiers 2–4.
  - Seats name their kingdom from 1,700 m/px in. Further out, the territory
    colours carry it.
- **Faces:**
  - Capitals are set in Cinzel in mixed case, whose lowercase are small
    capitals, tracked +6%.
  - Towns are set in EB Garamond Medium; Regular breaks up at 15 px.
  - A seat is lettered first with its kingdom's name in Cinzel capitals. Its
    city follows in Garamond once the zoom would show that city anyway.
  - Sizes are 18–15 px, Rome 19.
- **Names keep to the land.** The pipeline measures, on the coast mask, how much
  land lies under a name on each side of its place, at five scales, and
  placement tries land sides first.
- **One style everywhere** (decided 2026-09-22): settlement names are light
  type (`#F3EBDA`) with a soft dark halo, 2.4 px wide, over land or sea. The
  hierarchy it gives: territories are dark capitals printed on the land,
  settlements are light type above it, seas are gold italic.
  - Light reads over busy relief, where dark ink sinks into it.
  - Dark everywhere was tried and read worse.
  - Choosing light or dark per name, by the ground under it, was also tried. It
    read as random: neighbours differed, and names flipped as the zoom crossed
    a threshold.
- **Rome** is set at 19 px against 18 for the other great cities. Its double
  ring and Cinzel capitals carry its weight, not size (22 px was tried and
  looked oversized).
- **Knockout.** Where Rome's name is set over territory lettering, that
  lettering fades to a ghost inside a box around the name, as a printer cuts a
  territory name back around a city. The box is a screen rectangle, updated
  every frame, and applies to land lettering only.
- **Collision** is greedy by rank (tier, then status). Each name tries its
  record's `labelSide` and the land-first order. Territory and sea lettering
  are obstacles. Only Rome may be set over them: a map without Rome is wrong,
  a crowded one only crowded.
  - It re-runs when the scale changes by more than 4%, or the tilt, the size or
    the year changes. A pan never triggers it.
  - Names fade in and out over 220 ms.
- **Picking:** a click within 10 px of a visible marker, or on its name, opens
  the place, ahead of the territory under it.

### 7.5 Labels

Territory and water names were built in September 2026 (`pipeline/src/labels`,
`packages/engine/src/labels`). Settlement names are in §7.4.

- **Fonts** are baked to MSDF atlases by `npm run fonts -w pipeline`
  (msdf-bmfont-xml): Cinzel for land and EB Garamond italic for water, both
  OFL. The licence texts ship beside the atlases.
  - Latin only for now. Polytonic Greek and harfbuzz shaping come with Greek
    names. Until then, kerning comes from the atlas's own pair table.
- **Glyph layout is ours.** Each glyph is centred on the path at its own arc
  length and turned to the path's tangent there.
  - There is one mesh per typeface, rebuilt only when the year changes.
  - Names are sized in metres, so they grow with the land they name, and each
    fades in and out by its cap height in pixels.
  - Land names are dark ink with a faint paper halo; water names are gold on
    the sea (§8.1).
- **Territory names are placed offline, per distinct territory** (a polity plus
  the set of atoms it holds, so once per claim change, not per year):
  - rasterise the union and keep its largest piece;
  - distance-transform it;
  - take the principal axis weighted by depth²;
  - walk the ridge, the deepest cell in each slice across the axis (after
    Barrault; Krumpe & Mendel 2020);
  - fit a depth-weighted parabola and flatten it until it stays inside;
  - take the largest capitals whose centred text fits the curve and never sits
    on ground thinner than the letters need, then open the tracking to fill
    about 72% of the curve.
- **No name tilts more than 35° from horizontal, plus 10° of bend at its ends**
  (decided 2026-09-22, after Aegyptus came out almost vertical). The axis is
  clamped, every angle in range is tried, and the one giving the largest letters
  wins. Tall, narrow lands get a name across them, not one the reader has to
  turn their head for. Everything reads left to right.
- **Water names** follow courses placed by hand (`pipeline/src/labels/seas.ts`),
  stored as the sea records' line geometry, and are sized to fill 90% of the
  course.
- **Not yet built:**
  - collision among territory names themselves (they sit inside their
    territories and have not needed it; settlements avoid them, §7.4);
  - two-line names;
  - thinning labels by the ink on the plate.

### 7.6 Zoom tiers

| Tier          | Scale                         | What it looks like                                                                                                            |
| ------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Paper**     | whole frame                   | Flat political colour, the unfinished sketch beyond the known world, a dark sea with gold italic sea names, almost no terrain |
| **Political** | a region of the Mediterranean | Political colour over lit relief (terrain shows through as light and shade), large curved names, borders, main roads          |
| **Terrain**   | a province or smaller         | Materials, glowing borders instead of full fills, roads, settlements, physical names, the shore band and foam                 |

The tiers crossfade continuously with camera distance. They are never hard
switches.

**Beyond the known world** (`data/known-world.yaml`, c. 63 BCE) the map stops
claiming anything at every tier. The colour ends at a ragged wash edge and what
is left is an unfinished sketch in ink on paper: the coast with a few offshore
lines, rivers, contours on the high ground, and the 5° graticule. The lines give
out one kind at a time, like a pen running dry, until only paper and graticule
remain; the paper runs on past the terrain data, so the data's edge never shows.
Every line is drawn from the same physical data as the coloured map. The known
world is the union of the ring, every atom and a 150 km reach round every place,
so it never leaves out something the rest of the data draws.

### 7.7 The model of Rome

**Built in September 2026** (`data/places/rome.yaml`, `pipeline/src/rome`,
`packages/engine/src/rome`). Zoomed right into Rome, a model of the city rises out
of the map's own terrain: below ~18 m/px it starts to rise, and it stands by 10. It is the one exception to §2's "city-plan
level is a separate product": a capital drawn in detail is normal in an atlas, and
nobody expects every town to get the same.

**It is also the one exception to §1** (decided 2026-09-24). A plan drawn only
from what is sourced was sparse and read as a data overlay. So the model shows
what nobody can map building by building — the houses and blocks of flats between
the monuments — as a clearly generic, generated fabric. It is drawn plainer and
more muted than the known buildings, so the eye reads it as a backdrop, and the
legend keys it as illustrative. Realism goes into the known buildings first. What is
known and what is generated are kept apart:

- **Known**, from the records (every one dated and sourced, like any place):
  - **Each built as itself** (decided 2026-09-24). Every known building has a
    design (`pipeline/src/rome/designs.ts` and `designs/`): its type, its size,
    its columns, its stairs and the way it faced, as its sources give them for
    68–27 BCE, with those sources in the design's note. The engine knows how each
    type is put together (`architecture.ts`, `monuments.ts`); the design says
    which building it is. So the Capitol's temple is a Tuscan temple with three
    rows of six columns, three cellae and a gilded roof; Castor's the Metellan
    octastyle with its speakers' tribunal and side stairs; Vesta's a ring of
    twenty Ionic columns on three steps; Pompey's theatre a cavea of three
    arcaded storeys with Venus Victrix's temple at its top; the Circus Caesar's,
    with its one-storey shop arcade, timber upper tiers and the euripus. The
    research behind each is summarised in its record's note.
    - **Placing.** A design stands on its record's surveyed outline (its box and
      axis) unless it gives a centre, a size and a bearing of its own: where the
      outline is of a later rebuilding (Castor's Augustan podium, Concord's
      Tiberian one) or there is none. Where it gives none of them, the monument is
      placed as its point says, facing downhill.
    - **Where Platner & Ashby are superseded** (the Largo Argentina, the Forum
      Boarium, the Circus Flaminius, the Palatine's temples, the Late Republican
      phases of the Forum) the designs follow Digital Augustan Rome and the
      Digitales Forum Romanum, which give the modern literature, and the
      Sovrintendenza and Musei Capitolini for what the excavations found.
    - **Where nothing is known of a building's form** — most of the temples on the
      Aventine, the Quirinal and the Esquiline — it is the typical mid-Republican
      temple (`DEFAULT_TEMPLE`): four Tuscan columns across a deep porch on a
      podium with a flight across its front, 14 by 24 m, after Vitruvius 4.7 and
      the Largo Argentina's Temple C. Buildings with no remains whose form is a
      published hypothesis (the Curia Hostilia, the Basilica Porcia) are drawn to
      it, and their records say so.
    - **On a slope** a design may stand as a terrace on its highest or middle
      ground, its foundations running down to the lowest (`level`): the Area
      Capitolina and its temples, and the Tabularium, whose substructure rises
      from the Forum's ground to the saddle's.
    - **Its site levelled** (decided 2026-09-25). Each designed building's site is
      cut and filled level in the ground everything stands on (`ground.png`, model.ts),
      the larger first, so a temple in a forum stands on the forum: at the mean of the
      ground under it, or its lowest where it was cut into a slope (Caesar's forum,
      cut into the Arx behind a peperino wall "12 m high", Platner & Ashby, p. 227), or
      its highest where it was built out as a terrace. A walk 3 m wide runs round it
      at its level; beyond, ground within a metre or two of the level eases back over
      10 m, and where the site is cut more than 1.2 m into rising ground a retaining
      wall of squared tufa holds the ground back. Over falling ground its own walls
      and podium stand on foundations down to the ground. The terrain over the model's
      board is drawn on a grid of about 5 m (512 segments a tile, from level 9;
      `TerrainTiles.ts`) so it follows the levelled ground; at the map's usual 38 m
      its big triangles cut through the buildings.
    - **Bridges run bank to bank** (decided 2026-09-25): each spans the water it
      crosses along its axis on the plan's river (dry gaps under 45 m joined, as a
      pier or an islet is), its sourced arches scaled to that width, and its deck
      comes down to the ground at each end and rises over the arches. The build
      reports a bridge whose water differs from its design by more than a quarter.
    - **The Tiber Island's ship** is a travertine embankment on the island's own
      shore, rising towards its downstream end as a ship's sides rise to the stern,
      with the relief of Aesculapius' staff near it.
    - **No street under a building.** Where a recorded or main street's line crosses
      a monument's footprint it stops at its edge (plate.ts), except over the bridges,
      the island and the open squares.
    - Proportions a source does not give are Vitruvius' rules of thumb: a column
      seven diameters high for the Tuscan, nine for the Ionic, ten for the
      Corinthian; an entablature about a quarter of the column; a pediment a
      ninth of its width high.
  - **Their stone** is the one Platner & Ashby give for the window (`STONE_OF`,
    model.ts), and changes with the year where a building was refaced in it:
    - marble for Saturn from Plancus's rebuilding (42 BCE), the Regia from
      Calvinus's (36 BCE), Venus Genetrix, the Basilica Julia, Palatine Apollo,
      Sosius's Apollo from 34 BCE and the round temple by the Tiber;
    - travertine for the Mausoleum of Augustus and the tomb of Bibulus;
    - the rest white stucco over tufa or peperino, the Republic's usual finish.
      Rome's first marble temple was Metellus's of 146 BCE (Iuppiter Stator,
      p. 304), and Augustus "found it built of brick and left it in marble"
      ([Suetonius, Augustus 28.3](https://penelope.uchicago.edu/Thayer/E/Roman/Texts/Suetonius/12Caesars/Augustus*.html#28.3)).
      So the marble city is Augustan, and the model does not anticipate it.
    - Where an article's marble belongs to a later rebuilding (Castor, Concord,
      Vesta, the Basilica Aemilia, the Curia), it is not taken.
  - The Forum square, paved in Monte Verde tufa at the Sullan level and in
    travertine from Caesar's relaying (Forum Romanum, pp. 232–233), taken as 44
    BCE. The travertine that survives is Augustan.
    - **Level** (decided 2026-09-25): its paving lies at 13.5 m by the Lacus
      Iuturnae (SITAR 17854, 17890), and the street at the Argiletum's mouth at 13.9 m,
      but today's ground, smoothed, rises 11 m across it to the Capitol's foot. So
      the square, the Comitium with it, is cut and filled to its paving's level
      before any site, easing back to the ground round it over 30 m, and the
      buildings on it (those round it, and what stands inside its outline) stand at
      that level; behind Concord and Saturn the Capitol's slope rises to the
      Tabularium.
    - **Painted on the ground** (plate-0 green, `shading.ts`), not laid as a slab
      over it: its outline, a fine dark edge as the streets have, the stone of the
      year, and close in the joints of its slabs, in rows along its length (from
      Caesar's rostra to his temple, which face each other down it), each row's
      joints staggered and each slab a shade apart. The slabs' size (rows 1.5 m
      wide, slabs 3 m long) is illustrative, not a survey's. The streets that cross
      the square run on its paving, so they are not drawn over it.
  - **The years 44–27 BCE** (decided 2026-09-24), when the window was carried to
    27 BCE. Everything dated in them changes the model in its year:
    - Caesar's rostra from 44 BCE, the old rostra given up; the Curia Hostilia,
      rebuilt by Faustus Sulla after the fire of 52, pulled down in 44; the
      Curia Julia rising from 44 and standing from 29, with Victory on its gable;
      the Divus Iulius rising from 42 and standing from 29 on its platform with
      the altar's niche; Plancus's Saturn rising from 42; the Regia in marble
      from 36; the Basilica Paulli standing from 34;
    - on the Palatine, Octavian's unfinished house of two peristyles until 36 BCE,
      then Apollo's temple rising and, from 28, standing in marble over the Circus
      with the portico of the Danaids before it; the hut of Romulus burnt in 38;
    - in the Campus Martius, the Theatre of Marcellus's foundations from 44 on
      the site Caesar cleared (the temple of Pietas gone), the Saepta Julia's
      porticoes by 36, Sosius's Apollo rising from 34, and the Mausoleum's drum
      and ring walls rising from 28;
    - the Aqua Julia and the Tepula on the Marcia's arcade from 33 (below);
      Agrippa's dolphins on the Circus's axis from 33; the Circus, Ceres and Spes
      burnt in 31; Cornificius's Diana rising from 32; the Pons Sublicius wrecked
      in 32; the wall round Juno Lucina's grove from 41.
    - Left out, and why, in BACKLOG.md: the Pantheon (begun in 27, finished in
      25), the Amphitheatre of Statilius Taurus and the Porticus Octavia of 168
      BCE (sites unknown), the Actian arch (doubted), Jupiter Feretrius (tiny, its
      site unknown).
  - The aqueducts (`aqueducts.ts`). Only the Marcia's arcade stood above ground
    near Rome: the Appia and the Anio Vetus ran underground into the city
    (Frontinus 1.5–1.6), and are recorded but not drawn. The Marcia is drawn for
    about 9 km, as Frontinus gives it: out of the ground at Capannelle by the
    seventh milestone, on substructures, then on arches past Roma Vecchia, Tor
    Fiscale and Porta Furba, along the line of the Via del Mandrione to just
    outside the later Porta Maggiore, north to the Porta Tiburtina and along the
    Via Marsala, then underground again to pass under the agger (Frontinus 1.7;
    Ashby 1935, pp. 129–148). Where it goes into or comes out of the ground, the
    masonry slopes into a bank of earth over the channel. Beyond it, the low
    grassy spoil heaps round its shafts, one every two actus (71 m, Vitruvius
    8.6.3), trail off and fade out within about 260 m. Whatever of the
    model runs to the edge of its ground fades out with it. Its terminal
    reservoir, whose site "is difficult to fix" (Ashby p. 149), is not drawn.
    - Its line joins its surveyed remains (OpenStreetMap), following
      OpenStreetMap's reconstruction of the route between them, which is tagged
      approximate. Its channel is at the levels Ashby surveyed (62.1 m at Tor
      Fiscale to 52.6 m at the Via Castro Pretorio), interpolated between them.
    - Where the channel stands more than an arch's height over the ground, it runs
      on an arcade. Where it is lower it runs on a solid wall, and where it goes
      below ground only the heads of its shafts show.
    - The arcade is built as Ashby measured the Republican work: arches of 5.4 m
      between piers 2.4 m wide and 3.25 m long; piers of reddish tufa; voussoirs,
      imposts and a string-course of grey peperino; spandrels of yellow tufa; and
      the Marcia's channel of red tufa under overhanging cover slabs.
    - It stands from 140 BCE, when the water reached the Capitol, and is shown
      under construction from 144. From 33 BCE Agrippa carried the Tepula and the
      Julia on it, "Julia topmost; next below is Tepula; then Marcia" (Frontinus
      1.19). Their channels are stacked on the Marcia's from that year. Where the
      Tepula ran before is unknown, so it is not drawn earlier.
    - A click on the arcade opens the Marcia.
  - **The Servian Wall** (decided 2026-09-25; `servian.ts`, model.ts `WALL`,
    `wall.ts`), on SITAR's reconstruction of its whole course (codice PA 19694,
    made for the 2017 "Roma medio repubblicana" conference from the surveyed
    remains, archive plans, historic maps and studies of the terrain): the middle
    of its band, smoothed a little, following the hills' brows round the Arx, the
    Quirinal, the Caelian and both Aventines, and bent through the Porta
    Caelimontana's surveyed blocks in the Arch of Dolabella. Between the Capitol and
    the Aventine it runs inland from the Porta Carmentalis to the Porta Trigemina,
    leaving the river outside (SITAR, after Coarelli); the older view had the river
    close the circuit, and Wiseman (2021) argues the line changed in 212 BCE.
    - **As it was built**, from the remains and the sources: a curtain of squared
      pale Grotta Oscura tufa 3.8 m thick, laid dry in courses of two Roman feet,
      end-out and side-out by turns (painted on, `SKIN.ashlar`), with patches of the
      darker Anio tufa of the first century's repairs; each face running down to
      the ground on its side, its walk 7.5 m over its ground or a little over the
      hill behind where it crowns a brow, rising and falling in long runs. No top of
      it survives: the battlemented parapet is a reconstruction, as Strabo's "wall
      with towers" on the agger and Livy's repairs of walls and towers allow.
    - **The agger** from the Porta Collina to the Porta Esquilina, where the flat
      plateau gave the wall no brow: its ditch about 30 m wide and 9 m deep cut into
      the ground in front of it (Dionysius 9.68) and its earth bank 10 m high behind
      it (Middleton), crossed by causeways and cut through at its gates, with towers
      along it every ~36 m.
    - **Thirteen gates**, placed by their surveyed remains or SITAR's sites (after
      Coarelli and the Lexicon): each a passage 3.6 m wide between two bastions
      standing out in front, and behind it a court closing in to an inner arch,
      after the plans of the Porta Collina, Viminalis and Sanqualis. Those whose
      site is unknown or disputed (Ratumena, Flumentana, Lavernalis, Querquetulana)
      are not drawn.
    - Houses keep 3 m from its inner face and off the agger's bank, and the ground
      at its foot outside is kept open for 12 m. By 27 BCE the city pressed against
      it ("now commonly", Livy 1.44) and Maecenas's gardens covered the agger's
      cemetery from about 35 BCE; neither is drawn yet.
    - The known buildings placed only roughly that would stand on it (Juno Moneta,
      Luna) are moved in off it; the wall is the better known.
  - The Tiber on OpenStreetMap's course, and the streets and roads (§ below)
    paved on the ground.
- **Generated**, seeded so every build is the same (`city.ts`, model.ts). The
  method follows procedural city modelling, and the forms follow what Rome's fabric
  is known to have been (the sources are catalogued in data/sources.yaml):
  - **Streets in a hierarchy.** The recorded streets stay. A main street runs from
    each gate to the Forum by the cheapest way over the ground, shunning
    slopes and preferring the recorded streets (Emilien et al. 2012; Galin et al.
    2011), so the main streets follow the valleys and merge as they near the
    centre. Where a main street's way runs along a recorded street, the recorded
    street is the street, and the main street is only what leaves it.
  - **Local streets grown, not cut** (`growth.ts`, decided 2026-09-24). A town that
    grew was not divided from above: each lane was laid off one already there and
    took its line from its neighbours. So the lanes grow out from the Forum:
    - along every street, a block's side apart, a lane may leave it square on
      either side; those nearest the Forum are laid first, and each lane laid may
      branch in its turn (Weber et al. 2009);
    - a lane follows one field of directions over the city (Chen et al. 2008):
      along the contours where the ground slopes, and elsewhere square or parallel
      to the streets round it, the recorded ones weighing most. So the blocks of a
      quarter line up and the quarters turn with the hills;
    - a lane that comes near a street runs on to meet it, one near a junction ends
      in it, and one leaving a street opposite another carries it on across, so
      streets cross and continue rather than meeting in staggered ends (Weber et
      al. 2009; Courtat et al. 2011);
    - none is laid alongside another nearer than a block's depth;
    - a dead end near a street runs on to it; a short stub is taken away; about a
      third of the rest are kept as blind alleys;
    - the excavated pieces of street that belong to no recorded street (SITAR) are
      laid first and run on along their line, so the lanes pass where streets were
      found;
    - a block still more than 1.7 times its quarter's length is cut across the
      middle, through a junction on its long side where there is one.

    Blocks are what is left between the streets: 32–42 by 55–80 m in the valleys
    (Cosa's and Pompeii's), larger on the hills and round the houses of the rich,
    varying smoothly over the city; on a slope, shallower terraces. The streets are
    of three widths, so the network reads: the main and recorded streets 7 m, the
    lanes 3–4.4 m, and a lane rising more than 1 in 8 a flight of steps 2 m wide
    (decided 2026-09-24). Rome was
    "casually built upon … rather than regularly planned" (Livy 5.55), with "narrow,
    twisting lanes" (Tacitus, _Annals_ 15.38); Pompeii's streets are mostly 2–4 m
    wide (Poehler 2017).

  - **Plots from the street to the middle of the block** (decided 2026-09-24).
    Every 2 m of a block belongs to the street frontage nearest it, so a plot runs
    from its street back to the middle of the block, up to 26 m, where it meets
    the plots behind: the block is split between its streets as a straight
    skeleton splits it (Vanegas et al. 2012), however ragged its outline, and is
    built solid. Where plots meet at the middle or cross at a cramped corner, the
    one laid first keeps the ground and the other is cut back.
    - **A corner plot is one plot.** At a corner turning between 55° and 125° it
      fronts both streets and belongs to the one that matters more (a main or
      recorded street), or the longer frontage, as a corner plot belongs to one
      street (Conzen's town-plan analysis; Emilien et al. 2012). Sharper or more
      open corners are left to the plots either side.
    - **Plots come in series.** Along a street a run of two to seven plots is of
      one width, now and then a double one, then another run begins: plots laid
      out together, as Conzen found them.
    - **Yards behind, courts only in large buildings** (decided 2026-09-24, from
      how the rooms were lit). A plot up to 17 m deep, one or two rooms lit from
      the street, is built to its back: the rows of shops with rooms over them of
      the Via Anicia plan and of Cicero's letters. On a deeper plot the building
      fills its front 12–17 m and the back of the plot is its yard; the yards of
      plots back to back make one open, irregular yard in the middle of the block,
      as back land is (Conzen). A yard shallower than 5 m is built over. Of the
      runs of three deep plots or more, three in ten are one building round a
      court 6–9 m deep, its end plots its wings: the courtyard blocks of the
      Marble Plan. So the valleys read as closed rows round a few yards, not a
      light-well in every building. How the inside of a Republican block was used
      is not recorded; this is inference from how rooms were lit, the Marble Plan
      two centuries on, and Pompeii.
    - **Atrium houses** stand in the quarters of the rich (a third of their plots)
      and now and then on the hills. A house takes the front of its plot, about as
      deep as it is wide (17–26 m), its garden behind. Its rooms stand in ranges
      round the atrium, roofed and falling inward to the opening over its pool:
      the opening is a quarter to a third as wide as the atrium (Vitruvius 6.3.6),
      about a fifth of the house's width, not an open court. So the quarters of
      the rich are more open than the valleys, in their gardens.
    - A tree stands only in open ground of 150 m² or more, few in the crowded
      quarters and more in the gardens of the rich: a light-well is not a garden,
      and the people of Rome grew "images of gardens" in their windows (Pliny,
      _Natural History_ 19.59).
  - **Buildings, not lots.** A run of one to five neighbouring lots of flats along
    a street is one building, as the blocks of flats on the Marble Plan take several
    shops' frontage, and it may run on round a gentle bend in the street (up to
    35°), never round a corner. A building has one height, one wash and one
    weathering of its tiles, and a low tiled roof (a pitch of about 20°) with its
    ridge along the middle of the strip, so a row makes one long roof, hipped at the
    block's corners.
    - Heights follow a smooth pattern across the city, some 200 m across, within
      the quarter's range: a stretch of street is of a height, and the change comes
      between stretches. Every building on a main or recorded street stands a
      storey higher, never lower, in runs two plots longer, so the street's
      frontage reads as one; a courtyard building's range behind its court is a
      storey lower; and a quarter of the other buildings step a storey up or down
      from the pattern.
    - a lone narrow deep lot sometimes turns its gable to the street;
    - one building in sixteen has a flat terrace;
    - an atrium house's ranges fall inward to its court, as a compluviate atrium's
      roof did (Vitruvius 6.3).
    - Nothing narrower than 4 m or shallower than 6 m (a room and its walls) is
      built, and no lot with a corner sharper than 25°: those are left as yard or
      street. An atrium house needs a lot 17 m across for ranges round a court, and
      on a smaller one is a single house.

    A storey is 3 m over a 3.8 m ground floor of shops. Walls are washed in a
    narrow range with a few ochres and reds, and the tiles are weathered, lighter
    or darker, browner or redder.

  - **Quarters.**
    - The valleys (the Subura, the Velabrum): flats of three to five storeys on
      lots 6–11 m wide. Cicero's Rome is "raised up and hanging" on its upper
      floors (_De lege agraria_ 2.96).
    - The hills: two or three storeys on wider lots.
    - Within 300 m of the Palatine, the Velia, the Carinae, the Quirinal and the
      Caelian: atrium houses on lots 16–26 m wide, four ranges round a court (the
      front one of two storeys), among flats built only 14 m deep with yards
      behind, as rich and poor stood side by side on the Marble Plan.
    - Low ground near the river: warehouses on lots 30–60 m long.
    - The top of the Palatine: great houses round their courts, of one or two
      storeys, and hardly a block of flats — the houses "sprang up all over the
      hill", and no Republican source puts flats there (Platner & Ashby,
      Palatinus, p. 378).
  - The slopes too steep to build on are left to scattered trees.
  - The houses are plain stucco in a narrow range of washes under one terracotta,
    varied a little lot by lot: plainer than the known buildings. Atrium houses
    are a paler render, warehouses bare tufa.
  - The monuments, the Forum, and ground too steep or wet are kept clear; so are
    the Capitol's summits and the Asylum between them, sacred ground where
    nobody lived ("ne quis patricius in arce aut Capitolio habitaret", Livy
    6.20.13), each as far as the ground stays near its top, the Asylum with its
    two groves; and the Forum Boarium between its temples and the Ara Maxima,
    the cattle market, whose limits are not known. The recorded streets and the generated main streets are
    paved in basalt, as Rome's streets were from 174 BCE (Livy 41.27), so the
    main network shows from far off; the lanes are trodden earth.
  - About 17,500 lots in all. The regional catalogues of the 4th century CE
    count some 46,000 blocks of flats and 1,790 houses in the imperial city.
  - A thinner suburb of detached houses lines the roads out of the gates, up to
    ~450 m, with a few near the wall, clear of its foot and the agger's ditch.
  - None of it is a claim about any building. The records, the inspector and
    search know only the monuments.
- **The country round the city** (decided 2026-09-25: it replaced groves scattered
  on a noise, which drew a wooded country Rome's plain was not). The land outside
  the wall was farmed hard, and the model shows it as farmland, gardens and tombs
  (`pipeline/src/rome/fields.ts`, `packages/engine/src/rome/fields.ts`). It is
  painted on the ground, so it stays quiet under the model, with a little of it
  raised close in. It reaches ~1.35 km beyond everything on the plan, past the
  board's own edge, and fades out into the map's ground.
  - **Known**: the gardens and groves the sources place (kinds `garden`, `grove`
    and `cemetery` in rome.yaml, with Platner & Ashby's and Richardson's pages):
    Lucullus' on the Pincian, Caesar's across the Tiber, Sallust's, Maecenas' on the
    Esquiline over the old burial ground, the groves of Furrina and the Camenae.
    Their outlines are drawn by hand from the bounds their sources give
    (`data/geometry/rome-grounds.geojson`, each saying what it follows), and are
    approximate. Each stands for its own years: a garden laid out within the window
    shows the farmland it replaced until then, and takes the houses on its ground
    when it comes; once the burial ground is cleared, about 35 BCE, the farmland
    round it runs on over it. A garden is lawn crossed by gravel walks, its trees
    scattered and its edge lined with cypresses; a grove a looser stand of holm oaks. Pompey's gardens, which
    nobody can place, are a point only.
  - **Generated**, seeded, following what the sources say the land near the city
    was used for (Varro, _On Agriculture_ 1.16.3; Cato, _On Agriculture_ 7–8;
    Morley 1996, ch. 4):
    - **Lanes and plots.** Blocks between lanes (a Voronoi of jittered points
      ~230 m apart, the ground pushed about a little so the lanes bend) face the
      nearest road, and are cut into strips running back from it, so every plot
      has a frontage: 12–26 m wide near the city, 35–80 m far out. About half the
      block edges are lanes of trodden earth, the rest only a hedge between plots.
      The distances to the lanes and hedges are stored signed, by the side of the
      line a texel is on, so the line crosses zero between texel centres and draws
      unbroken however close the camera comes (an unsigned distance on a 4 m grid
      never reaches zero between centres, and a 3 m lane broke into dashes).
    - **What each plot grows** is drawn by distance from the wall: market gardens
      and orchards close in, vines and olives in the middle ground, grain, stubble,
      fallow and pasture beyond. Vines and olives take the slopes, vines the ones
      turned to the sun; gardens the watered low ground and the roads; meadow the
      Tiber's flats, which flood; scrub what is too steep to plough. Half the plots
      of a block share its main use, so a farm reads as one.
    - **Summer**, as the model's light is: the grain ripe or cut, the fallow being
      ploughed, the pasture dry, the gardens, vines and meadows green. Vines in rows
      about two metres apart, garden beds, olives on a 9 m grid and fruit trees on
      a 7 m one, ploughed furrows, mown swathes — each fading to its average colour
      when too fine to draw. The palette is muted a quarter of the way to the map's
      ground.
    - **Raised close in**: olives and fruit trees on the same rows the ground is
      painted with, within 1.6 km of the wall; scattered trees on the scrub;
      farmsteads here and there, ranges round a yard square to their plot (Varro
      1.13); and tombs along the roads out of the gates, an altar, a façade or a
      drum as the known tombs are built, thickest near the gates (burial in the
      city was forbidden: Cicero, _Laws_ 2.58; Purcell 1987).
    - The Campus Martius north of the Saepta is left open grass (Strabo 5.3.8),
      from the river to the Via Flaminia, and the ground round the monuments
      outside the wall open too.
  - No umbrella pines outside the gardens: the pine skyline that says "Rome" now
    is mostly later planting.
- **The timeline** moves the known buildings. One not yet built, or gone, is not
  shown. One being built stands cut off at two-fifths of its height, open to the
  sky as works rising are (or as far as its design says the works had got: the
  Theatre of Marcellus only its foundations); one burnt is a roofless shell cut at
  seven-tenths, blackened towards its top (decided 2026-09-24: squashing them to a
  third of their height made columns stubby). The
  generated city stands throughout, except on the site of a monument begun within
  the window: there houses stand until that year (Caesar's forum went up on the
  houses he bought).

**The ground** (`plate.ts`, `rome/shading.ts`) is the map's own terrain, with only
what the city adds drawn on it:

- The terrain is laid on the Mapterhorn heights smoothed over ~45 m (`ground.png`),
  and lit and given its rock by their slope — the light with the slope drawn up
  twice, so the hills read — so the surface model's modern
  buildings do not show, and the model stands on it exactly. Over the Capitol it
  is smoothed over ~14 m instead, so its steep brows and its summits stand nearer
  their height. The relief is today's, except in the valleys where excavations
  found the ancient ground, and the agger's ditch and bank.
- **The ancient valley floors** (`ground.ts`, decided 2026-09-24). Since antiquity
  the valleys have filled up. Where SITAR records the height of ground walked on
  then (`rome-levels.geojson`, from its excavated levels), the valley floor is set
  to it. Each correction cites the pieces whose levels give its height:
  - the Forum valley at the mouth of the Argiletum, 13.9 m above the sea (a street
    and a lane later under Caesar's forum, in use until 101 and 55 BCE: SITAR
    16681, 16671);
  - the Forum's square, 13.5 m (its paving and a street of the early 2nd century
    CE, a ceiling for the Republican level: 17854, 17890);
  - the valley of the Colosseum, 16.2 m (the square and street of 7 BCE–64 CE, a
    ceiling: 15456, 15428);
  - the Via Appia inside and at the Porta Capena, 13.0 and 11.3 m (its paving of
    312 BCE: 17004, 16624);
  - the Via Flaminia at the foot of the Capitol, 13.2 m (220 BCE–50 CE: 6627,
    6628).

  The model's ground there is 22–29 m, so the floors fall 9–15 m; part of that is
  the smoothed surface model's own error, since the Forum is excavated to near its
  ancient level today. A correction follows its valley: from its point it runs out
  over ground no more than 12 m above the floor, round the hills, up to 450 m, and
  lowers the floor by the whole change and the valley's sides less, to nothing 12
  m up. So the valleys from the Capitol to the Porta Capena deepen round the
  Palatine, which stands higher for it. Where no valley floor was excavated — the
  Subura, the Circus' valley, the valleys of the north — the terrain is as it is.
  Hillsides and the Velia are left out, where the terrain model is too uncertain to
  measure against; the Velia stood higher before the cut of 1932. SITAR's 1924
  contours cover only the open ground of the south, where today's terrain is close
  to them, and are not used. A building on a slope steps with it: where the ground
  rises more than 2.2 m from a plot's street to its back, the building is two or
  three parts, each on its own ground, fewer storeys going up the slope and more
  going down.

- Inside the walls, the ground between the houses is trodden earth: the
  terrain's colour pulled most of the way to it, its relief kept.
- Close in, a ground mesh over the same heights draws only the model's shadows.
  Beyond it the terrain carries them baked: each footprint swept away from the
  sun. Only what stands through the whole window casts a baked shadow.
- The Tiber is drawn in the map's river colour on its real course, in place of
  the coarse HydroRIVERS line, crossfading to that line a few hundred metres
  beyond everything on the plan so the river never breaks.
- The city's streets show only while they can be drawn at their width; the map's
  roads give way to them then, and draw instead when zoomed out. The streets end
  with the board, but the roads out of the gates run on as far as the country
  round the city (`fieldsMask`), and the map's roads give way to them there too, so
  a road does not stop short in the fields: past the Aurelian gates the two are the
  same Itiner-e line, and one fades into the other where the fields fade into the
  map's ground (decided 2026-09-26).
- The earth, the smoothed lighting and the baked shadows come in as the model
  rises, so zoomed out Rome is ordinary terrain like any other town.

**Streets and roads** (`streets.ts`) are paved ways on the ground, in basalt
(decided 2026-09-26): the censors of 174 BCE had the city's streets paved in it,
"vias sternendas silice in urbe" (Livy 41.27.5), and the Via Appia in 293 BCE from
the temple of Mars outside the Porta Capena to Bovillae (Livy 10.47.4). It is a warm grey, weathered and dusty,
not black, so the city stays light; close in, the joints of its polygonal blocks
are drawn, about 0.7 m across, a size that is illustrative. The lanes between are
trodden earth. They are:

- the Forum and Palatine streets from OpenStreetMap's paths on the excavated
  paving;
- five streets traced along the modern streets Platner & Ashby identify them with,
  cut to within the walls: the Alta Semita, the Vicus Patricius, the Clivus
  Suburanus, the Vicus Cuprius and the Clivus Argentarius;
- streets drawn from the evidence (`routes.ts`), where no one modern street
  carries them: the rest of the Vicus Tuscus, the Vicus Iugarius and the
  Argiletum beyond their surveyed first stretches; the Vicus Longus; the Clivus
  Publicius; and the street from the Porta Capena up the valley under the Via di
  S. Gregorio (decided 2026-09-24). Each is a line through its evidence:
  - the pieces of its paving that excavations found, from SITAR, the
    Soprintendenza's archaeological GIS (`sitar.ts`, CC BY-SA 4.0, the project's
    own licence), cited by number: the Vicus Longus runs along the stretch
    Lanciani mapped under the Banca d'Italia, and straight on "on a line that
    crosses the via Nazionale at an angle of twenty degrees" for "one kilometre"
    to the Alta Semita, as Platner & Ashby have it;
  - the points the sources fix: gates, the ends of the surveyed stretches, the
    street corners Platner & Ashby name, the temple of Diana the Clivus Publicius
    passed;
  - and between them the easiest way over the ground, off the monuments and the
    river: a cheapest path over a 3 m grid where a step costs its length and more
    on a slope, in sixteen directions, smoothed. So a street keeps to its valley
    and climbs a hill across the slope.

  They are drawn lighter, as the traced streets are. Digital Augustan Rome's
  plan of 14 CE is read for which streets there were and roughly where; since it
  carries no licence, none of its drawing is copied. The streets it places only
  by a point, knows only from imperial sources (the Clivus Scauri), or ties to a
  street since renamed or rebuilt (the Clivus Orbius) are still left to the
  generated streets;

- the pieces of excavated street that belong to no recorded street, 110 in and
  round the walls that may have stood in 68–27 BCE (most dated only "Roman"),
  are kept in `data/geometry/rome-sitar.geojson` for the generated streets to
  follow;
- the Via Flaminia along the Corso, which "coincides absolutely" with it;
- **the consular roads out of the gates** (`roads.ts`, decided 2026-09-26). Zoomed
  out, the map drew its roads into Rome; zoomed in, the board hides the map's roads
  and drew only the Appia and the Tiburtina, as Itiner-e's lines ruled to a gate
  (Itiner-e runs every road inside the later Aurelian Wall straight to the Forum),
  so the rest vanished at the walls. Now eleven roads run from the gate each left by,
  or the Pons Aemilius, out past the board's edge, each a line through stops as the
  streets drawn from the evidence are:
  - the gate (servian.ts) and the sources' fixed points — the later Aurelian gates,
    which stand on the older roads; the forks; the bridges;
  - SITAR's reconstructions of three courses, as narrow bands whose middle line is
    taken: the Flaminia from the Porta Fontinalis to the Ponte Milvio (16890), the
    Appia's first mile "between the 4th and the 1st century BCE" (19681) and the
    Latina's line (19682). The two part about 550 m from the Porta Capena, the
    Latina to the left as Strabo has it (5.3.9); Platner & Ashby put the fork at
    830 m;
  - the pieces of their paving that excavations found, wherever they lie, fetched by
    number into `data/geometry/rome-roads.geojson`;
  - and then Itiner-e's line, from where it keeps to the ancient road (within a few
    metres of the modern road that follows it, outside the Aurelian gates), so the
    board's road meets the map's where one gives way to the other. The Aurelia
    alone does not: Itiner-e's comes in through the Vatican plain, another road, and
    the Aurelia is drawn to the board's edge along the Via Aurelia Antica.

  The roads: the Appia and the Latina from the Porta Capena; the Ostiensis from the
  Porta Trigemina, with its branch from the Porta Raudusculana; the Praenestina and
  the Labicana together from the Porta Esquilina to their fork at the tomb of
  Eurysaces; the Tiburtina from the Porta Esquilina (its gate disputed, so drawn
  lighter); the Salaria and the Nomentana from the Porta Collina; the Flaminia; and
  over the Pons Aemilius the Aurelia, up the Janiculum, and the Campana along the
  right bank. Left out: the Ardeatina (unattested in the window, its start
  disputed), the Laurentina, the Vitellia, the Triumphalis and Cornelia (no bridge
  before Nero's), the Collatina and the road from the Porta Viminalis (nothing found
  within 4 km). The suburb's houses, the tombs and the plots of the country face
  these roads, so they line each one; Itiner-e's lines into the middle of the city
  are no longer roads the plots face.

**The look** is a photograph of a model city on a table (`ModelLayer.ts`,
`miniature.ts`):

- matte materials: the known monuments in their stone, the houses plainer
  stucco under terracotta, the wall tufa, the trees muted green;
- a low sun from the north-west, the terrain's light direction, casting real
  shadows across roofs and streets. The shadow map is fitted to the view each
  frame, so its texels stay near a metre;
- a bright sky and bounce light that keep the shaded walls light;
- a wash of relief over the whole model, as an illustrated map shades its hills:
  the smoothed ground lit from the north-west with its slope drawn up twice, at
  half strength and never darker than 70%, so slopes turned from the light fall a
  little darker and hilltops a little lighter. It helps the seven hills read from
  straight above, where the roofs cover most of the ground. It was stronger (four
  times, 90%, down to 45%) while the valleys lay at today's height; with the
  valley floors at their ancient depth the real slopes and their shadows do most
  of the work, and the stronger wash turned roofs on the slopes muddy;
- walls darkening a little where they meet the ground, and everything darkening
  where the model overshadows itself: a grid of the height of what stands in each
  2 m cell, blurred over about 10 m and 30 m, against which a narrow street, a
  courtyard or the foot of a wall under a taller neighbour sees less of the sky.
  The grid is built again when the year changes, as buildings come and go. The
  ground between the houses darkens with it, the narrow streets most;
- a little warm haze with distance, so the near streets stand out from the roofs
  behind them;
- the generated houses' walls and roofs painted on in the shader, drawn only while
  they are a few pixels across and fading to their average beyond:
  - on the street front, a ground floor of shops, each a room open to the street
    across most of its width, or an atrium house's door with shops either side,
    as the street fronts of Pompeii and Herculaneum (Wallace-Hadrill 1994; Ellis
    2018); warehouses a wide door;
  - small windows on the floors above, one every 2.4–3 m on the flats, few on a
    house's front, which looked in on its atrium;
  - a darker dado along the foot of the wall, now and then red; the shade of the
    eaves along the top;
  - tiled roofs, as Rome was from the war with Pyrrhus (Pliny, _Natural History_
    16.36): rows of cover tiles down the slope about half a metre apart, tiles a
    little lighter or darker one by one, the ridge tiles and the eaves' edge.
    Where the doors and windows fall is generated, as the lots are: illustrative,
    not of any building. The camera comes in to 250 m over the city, where they can
    be seen;
- tilted, a tilt-shift: the top and bottom of the frame out of focus, as a
  close-range photograph of a model is, with a touch more contrast and colour.
  It is a pass over the whole frame, run only while the model stands and the
  view is tilted.

Heights scale with the terrain's vertical exaggeration, and the model grows out
of the ground as the zoom comes in, between 18 and 10 m/px.

**The legend** keys the model while it stands: marble, stucco over tufa,
travertine, and the houses as illustrative, with a line saying that only the named
buildings are from the records and the houses show how crowded the city was, not
where any house stood.

**Names** are few:

- the hills in widely spaced capitals, which recede as the zoom reaches their
  buildings;
- the quarters and the Tiber in italic;
- the monuments from 4 m/px, set as the towns are: light type with a dark halo,
  which reads over the model's roofs where dark ink sank into them.

Streets are not lettered. A click inside a monument's outline opens it, or inside the footprint drawn for one with no outline.

**Closer zoom**: over the city the camera may come to 700 m (~0.4 m/px) against
4 km elsewhere, easing back over 1.5 km outside it.

---

## 8. Visual direction

**Reference:** Imperator: Rome, as a direction to be inspired by, not a thing to
copy. What we take from it:

- **Three maps in one**, one per zoom tier (§7.6), with smooth transitions.
- **Typography carries the map:**
  - one serif family in caps, generous tracking, set along each territory's
    shape and sized to it;
  - dark ink printed onto the map with no boxes, crossing rivers and borders
    freely;
  - sea names in a second voice: italic, warm gold, on dark water.
- **Water as a deliberate contrast:** deep saturated navy with a bright
  shallows band.
- **Restrained colour:** muted political pastels and a few earthy terrain
  families, tied together by one dark ink.
- **Close-up detail comes from texture, not from data density.**

**What we do not take:**

- Its invented province grid and anachronistic names.
- Fields everywhere. (Round the model of Rome, §7.7, the farmland is drawn close
  in, keyed as illustrative.)
- 3D models and unit markers. (The model of Rome, §7.7, is the one exception: a
  museum model of the capital, not game pieces.)
- A heavy game interface.
- Its fonts or art, which are licensed to Paradox.

### 8.1 First palette (draft, to be tuned against screenshots)

| Token          | Hex                                                  | Use                                                                  |
| -------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| `sea-deep`     | `#1E3150`                                            | open sea                                                             |
| `sea-shallow`  | `#3E8C98`                                            | shallows band                                                        |
| `parchment`    | `#D8D2C4`                                            | what client kingdoms' colour is washed towards                       |
| `paper`        | `#D9CFB8`                                            | the sheet beyond the known world, browning towards `#CDBE9E` far out |
| `ground-arid`  | `#D6A774`                                            | desert, steppe                                                       |
| `ground-green` | `#7C8848`                                            | fertile lowland                                                      |
| `rock`         | `#8C8378`                                            | high and steep ground                                                |
| `ink`          | `#2A241E`                                            | type, borders, roads                                                 |
| `ink-sea`      | `#B48C48`                                            | sea names                                                            |
| political      | 12–16 muted pastels, lightness 60–75%, chroma capped | assigned per polity, stable across years                             |

### 8.2 Type

- **Land names:** Cinzel, or a comparable open Trajan-derived capital face,
  tracked +8% to +40% depending on how much room the label has.
- **Water and secondary names:** EB Garamond italic.
- **Settlements:** EB Garamond small caps. Built in Regular, mixed case, for
  now: small caps need OpenType shaping (harfbuzz), not a fake from scaled
  capitals.
- **Language:** Latin nominative by default. The Greek-speaking east keeps
  Greek forms where only Greek is attested. It is not silently latinised; this
  is carried over.

### 8.3 Discipline

- A written style spec (this section, grown) comes before shader work.
- **Side-by-side screenshot checks at each zoom tier, against the references.**
  Every change must move towards them rather than add something.
- The interface is minimal and quiet: a timeline, an inspector and a legend.
  No default component-library look.
- **The interface theme is an engraved atlas** (decided 2026-09-23;
  `apps/explorer/src/index.css`). The panels are printed matter laid over the
  map, in the map's own inks:
  - two modes: **parchment** (the sheet: paper, dark ink, Rome's red deepened
    to carry cream type) and **ink & gold** (the sea's voice: warm near-black,
    cream type, the sea names' gold);
  - Cinzel for inscriptions (titles, buttons, small labels), EB Garamond for
    the book; lining figures for years in tables;
  - ornament is hairlines, a double rule round each panel, a faint paper grain
    and one seat diamond: on the selected row of a list and the divider. The
    timeline is an engraved ruler, not a progress bar: nothing is filled, and
    the year is a gold index mark on the line. Confidence badges are dashed
    when uncertain, as the map's lines are.
  - The panels follow the reader's system theme.
  - The timeline is a slim strip in the bottom-right corner (decided
    2026-09-23), 40 px in both states, that never moves: it always shows the
    year and opens its ruler beside it. Only its toggle opens or closes it.
  - The legend is a row of the title block, under the index (decided
    2026-09-24). Its key opens beside the title block, over the map, set in
    short columns (Rome's colours, the kinds of doubt, the map's marks) so it
    is no taller than the block: it never moves and never covers the person
    panel. It is not a dialog: the map and timeline stay live while it is
    open, and only its row closes it. It starts closed, and the reader's
    choice is remembered.
  - The title block's last row is the preface (decided 2026-09-24), named as
    an atlas names its front matter. It opens the one dialog in the interface:
    what the map is, where it stands, how to use it, how far to trust it (§1,
    with Rome's generated fabric as the exception, §7.7) and whose work it is
    drawn from (§6), read on its own rather than beside the map. It is written
    plainly and without a narrator: no "we" or "I". On hover, and
    while the legend is open, a row's icon takes its text's colour.
  - Search is the atlas's index (decided 2026-09-23). The top-left corner holds
    the plate's title block, the map's name and the years it covers in the
    double rule, with "Index of names ⌘K" under it. Each result is its map
    mark, its name, a dotted leader and what it belongs to (`Province of
Roma`); what is not on the map in the year shown is greyed with its years,
    and going to it moves the timeline to the first. With nothing typed it
    offers the year's largest polities and its great cities. The map stays
    sharp behind it under a thin paper wash.
  - Italic is kept to short phrases. Tooltips and notes are upright: Garamond
    italic thins out over a sentence, and light-on-dark type at 13 px breaks
    up the way Regular did on the map (§7.4).
  - `/playground.html` shows the interface over screenshots of the three
    tiers, a specimen of every component, and a live token editor.
  - shadcn components are ours once themed. Nine carry edits beyond the tokens
    (badge, button, card, command, dialog, dropdown-menu, select, skeleton,
    slider): never re-add them with `shadcn add --overwrite`.

---

## 9. Engine API (for the explorer and Cicero)

```ts
const map = await createRomeMap(canvas, { data: '/data', year: '63 BCE' })

map.setYear('49 BCE', { animate: true })
map.flyTo({ kind: 'place', id: 'roma' }) // or a polity; entries() lists them
map.setMode('political') // 'political' | 'physical' | 'status' | ...

map.on('hover', (e) => e.hits) // places, atoms → claims(year), routes
map.on('click', (e) => e.hits)
map.on('yearchange', (year) => {})

// App-owned layers go into the same renderer, with the same time filtering
map.addLayer({
  id: 'letters',
  kind: 'points' | 'lines' | 'arcs',
  features, // lon/lat + interval + style
})
```

The engine is framework-free. A thin React wrapper lives in the explorer app.

---

## 10. Hosting and budgets

- **Terrain** comes from Mapterhorn's hosted file, with AWS Terrain Tiles as a
  fallback. The hosted file's terms and rate limits are unverified and must be
  checked before launch.
- **Everything else is ours and small:** the atom field, claims, vectors,
  fonts, textures and baked overlays. The target is **under ~200 MB total**,
  which ships with the app on any static host. Cloudflare Pages limits each
  file to 25 MiB, and allows 20k files on the free plan.
- Local development needs no hosting at all.
- R2 or Source Cooperative only if the project outgrows that.
- **Budgets:**
  - 60 fps at 1440p on an M1-class laptop;
  - first frame under 5 MB transferred;
  - scrubbing the year never drops a frame.

---

## 11. Plan

**M0: foundations.** Agree this doc, scaffold the repo, write
`packages/schema`.

Then **two tracks in parallel:**

**Track A: basemap spike (Italy only).** The aim is to prove the technology
and the look; polish comes later.

1. Terrain quadtree from Mapterhorn tiles, reprojected to Albers, lit.
2. Water: coast SDF and bathymetry shallows.
3. Material masks and CC0 detail textures.
4. Zoom-tier crossfade.

Exit when screenshots at all three tiers sit credibly beside the references,
it holds 60 fps, and WebGPU and WebGL2 give matching output.

**Track B: data model and first dataset.**

1. Schema and validator, including the era-string time parser.
2. A first dataset in the new model: 68–43 BCE (done September 2026).
3. Extend the data to 133–27 BCE and the full frame, including Parthia and the
   neighbours. The neighbours were added in September 2026, and the window was
   carried forward to 27 BCE the same month (68–27, `data/README.md` decisions
   17–21); the years 133–69 remain.
4. The first 10 `landscape-change` records.
5. Pipeline outputs: the atom field (built; borders come from it, see §7.3) and the
   claims table.

**M2: merge.** The political layer on the basemap with the year scrubber:
crossfades, glow borders, vector borders, and one curved area label.

**M3: labels, roads and places** in full.

**M4: explorer polish, then Cicero integration.**

---

## 12. Risks and open questions

- **The hosted terrain file's terms and zoom ceiling** are unverified. If it
  fails, we bake our own Albers terrain tiles for the frame, which means taking
  on hosting.
- **Whether 3DTilesRendererJS works with WebGPURenderer** is unverified. We may
  write our own tile manager, which is likely simpler for a flat plane anyway.
- **Curved labels** are the highest-craft component. Budget for iteration.
- **Neighbour extents** (Parthia, Germania, Arabia) have weak evidence. The
  default is seats and soft schematic zones, never confident polygons.
- **Licences to verify:** HydroRIVERS, Köppen–Geiger, Mapterhorn's hosted file.
- **Curation effort dominates engineering.** Plan the data work as the main
  job, not as a side task.
