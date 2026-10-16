# Roma Cognita — design

A GPU-rendered, game-quality interactive map of the Roman world with a timeline.
Imperator: Rome is the bar for how it should _feel_; the Barrington Atlas is the
bar for what it may _claim_.

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
5. **Build small, structure for growth.** The map covers one period. Growing
   it means adding rows, never changing the schema or the renderer.
6. **Builds report their own doubt.** Every build prints what it could not
   confirm, what it moved and what it overrode.

---

## 2. Scope

| Decision    | Now                                                                                                                           | Grows to                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Time window | **133–27 BCE**, the Gracchi to Augustus's settlement                                                                          | any year; schema is open              |
| Frame       | **10°W–50°E, 22°N–58°N**: Ireland/Portugal to the Persian Gulf, Upper Egypt to Scotland; data carries a few degrees of margin | wider by config                       |
| Zoom        | continental → **regional** (towns, roads, villas, ~50 m/px)                                                                   | city-plan level is a separate product |
| Neighbours  | Parthia, Germania, Dacia, Britannia, Arabia: named, roughly bounded, not curated town by town                                 | curated as needed                     |
| Platform    | **desktop browsers only**, mouse and trackpad                                                                                 | —                                     |
| Licences    | code **MIT**; `data/` **CC BY-SA 4.0**, except `data/geometry/rome.geojson`, which is **ODbL** (drawn from OpenStreetMap)     | —                                     |

Every record carries its sources' licences, and the attribution is generated
from them. The one non-commercial source, the Digital Prosopography of the Roman
Republic (CC BY-NC 4.0), feeds only the people layer. It cannot be merged into
CC BY-SA data, so it is kept out of `data/`: it is fetched and built locally
(`pipeline/src/people/`), with its licence beside it (the "People" section of
[data/README.md](data/README.md)).

---

## 3. Architecture

```
roma-cognita/
  DESIGN.md
  data/                 hand-authored records (YAML) + geometry (GeoJSON) — the moat
  pipeline/             ingest, validate, bake — Node/TS
  packages/
    world/              projection, frame and tile addressing, shared by pipeline and engine
    schema/             zod schemas + TS types, shared by pipeline and engine
    engine/             the renderer and its public API (three.js)
  apps/
    explorer/           the map, a timeline, an inspector
```

npm workspaces, TypeScript, Vite. Anything else that wants the map imports
`packages/engine` and plugs in through the same API as the explorer (§9).

**Flow:** `data/` + external sources → `pipeline` (validate → join → bake) →
`build/` outputs (textures, tiles, JSON) → `engine` → apps.

**Stack:**

- **three.js WebGPURenderer.** It falls back to WebGL2 automatically, which
  matters because ~5% of desktop users, mostly on Linux Firefox, still lack
  WebGPU. Shaders are written once in **TSL** and compile to WGSL or GLSL.
  Rejected: Cesium, MapLibre, Mapbox and deck.gl (too little control over the
  look, and built for a globe or Web Mercator); Bevy/wasm (too costly on the
  web); raw WebGPU (we would rebuild tiling and text for no gain).
- **Text:** msdf-bmfont-xml bakes MSDF atlases at build time, and the glyph
  layout is ours (§7.5).
- **Lines:** roads, rivers and borders are painted into the terrain in its own
  shader pass (§7.3, §7.4), so they sit on the relief at any tilt.

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
Because every output is pre-projected, **this decision is frozen.** Changing it
means rebuilding every file.

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
- **Precision:** the map works in whole years. The schema allows month/day with a
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
- Territory geometry is **authored, not ingested**: each atom
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
- It lives in git, edited by hand. An editing tool (a map-side inspector that
  writes YAML) waits until hand-editing hurts.

---

## 6. Sources

| Layer              | Source                                                                                                                                                                  | Licence                                                           | Notes                                                                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terrain            | **Mapterhorn** hosted tiles, Terrarium-encoded WebP to z12, mostly Copernicus GLO-30 in these regions                                                                   | various open; **terms of the hosted file unverified**             | 30 m global, finer in parts of Italy and Spain. Web Mercator, reprojected by the engine (§7.1). Also fetched and cached offline for the derivations (§6.1, §7.1). |
| Bathymetry         | **EMODnet DTM 2024** (~115 m) over the European seas, **GEBCO_2026** (15″, ~460 m) elsewhere, baked offline (§7.2)                                                      | CC BY 4.0; public domain with attribution                         | Drives the shallows                                                                                                                                               |
| Coastline, modern  | OSM land polygons, split edition (osmdata.openstreetmap.de)                                                                                                             | ODbL                                                              | Natural Earth 10m is too coarse at 50 m/px                                                                                                                        |
| Lakes              | **HydroLAKES v1.0** (≥ 0.05 km²)                                                                                                                                        | CC BY 4.0                                                         | Reservoirs (type 2) are dropped, which removes Nasser, Atatürk, Assad and similar automatically                                                                   |
| Coastline, ancient | Our `landscape-change` records: shores read off published reconstructions, filled over the Mapterhorn terrain (§6.1)                                                    | ours                                                              | AWMC's period layers were checked and not used: a handful of coarse, uncited polygons (`roman_open_water` is 2, Miletus and Ephesus)                              |
| Places             | **Pleiades**                                                                                                                                                            | CC BY 3.0                                                         | Importance is curated by us                                                                                                                                       |
| Territory geometry | **Our own outlines**, authored from the frontiers the cited scholarship names: rivers along HydroRIVERS, ranges along the Mapterhorn DEM, clipped to Natural Earth land | ours (CC BY-SA); public domain; HydroRIVERS **licence to verify** | `pipeline/src/atoms`. AWMC's `roman_empire_bce_60` was not used: one unnamed Roman extent, coarse, cut with straight lines, and ODbL                              |
| Rivers             | **HydroRIVERS v1.0**, sized by discharge; the Tiber's line from OpenStreetMap (§7.7)                                                                                    | **licence to verify**; ODbL                                       | Modern courses; where the Roman course differed, that is a `landscape-change` record                                                                              |
| Roads              | **Itiner-e**                                                                                                                                                            | CC BY 4.0                                                         | Only dated segments ship. Construction date kept per feature, so a road never draws before it was built.                                                          |
| Aridity / biome    | Köppen–Geiger 1991–2020, 1 km (Beck et al. 2023)                                                                                                                        | CC BY 4.0                                                         | Modern climate as a proxy for desert versus green; used coarsely                                                                                                  |
| People             | Digital Prosopography of the Roman Republic; Wikidata                                                                                                                   | CC BY-NC 4.0; CC0                                                 | Built locally, never written into `data/` (§2)                                                                                                                    |
| Reference only     | Barrington Atlas, Broughton MRR, Talbert                                                                                                                                | ©                                                                 | Cited, never copied                                                                                                                                               |

ODbL is share-alike but it is not CC BY-SA: a database derived from ODbL data
must itself be released under ODbL, so ODbL-derived layers (the OSM coast
mask, the OpenStreetMap outlines in `data/geometry/rome.geojson`) keep their
licence and are credited separately. The territory
outlines are clipped to public-domain Natural Earth land for that reason. The
attribution screen is generated from the `source` registry.

### 6.1 Landscape changes

These are changes visible at regional scale, each digitised from a published
reconstruction, and each reviewed like any record (`review`, §5.3).

**How a shore is made** (`npm run derive-coasts -w pipeline`,
`pipeline/src/landscape/`). Almost none of this exists as data, so each shore
is read off a dated figure in a published study, georeferenced against the
named sites on it, to the kilometre or so the figure supports. That line is
the landward side of an authored hull; the hull's other sides run out over the
sea or up hillsides. The derivation then floods today's terrain from the sea,
inside the hull, through ground no higher than a threshold: the figure says how
far the water reached, and the terrain gives its shape along the valley sides.
The same flood from a seed below a level draws a drained lake. Where the terrain
cannot help it gives way to the author: a lagoon whose basin the reclaimed
ground no longer shows is an outline (`polygon`); a town buried in the same silt
as its bay (Miletus) is kept dry by hand; land that has sunk since (Canopus,
the Saint-Ferréol lobe) is today's sea inside the hull. Every vertex says where
it comes from in `coasts.ts`, and every record in `landscape-changes.yaml`
cites its figures. Each run prints the areas and whether check sites (Ostia's
theatre, Priene, Lade, Utica…) fall on the water, the shore or the land where
the sources put them; its previews are the review surface.

**Drawn:** the Fucine Lake, Copais, Boibeis and the Fayum's Lake Moeris; the
Tiber mouth and its two lagoons, the Arno and Portus Pisanus, the Po delta and
the Ravenna lagoon; the Latmian Gulf, Ephesus, the Malian Gulf; the Gulf of
Utica, Lake Mareotis, the Canopic promontory and Alexandria's harbours; the
Rhône east of the Petit Rhône and the Saint-Ferréol lobe; the Ebro; the
Narbonne lagoon; the head of the Persian Gulf. Returned to land: the Valli di
Comacchio, the Grado lagoon and the Toshka lakes. Modern reservoirs (Nasser, Atatürk, Keban, Assad and the
like) go with HydroLAKES' reservoir type (§6).

- **Checked and not moved:** Aquileia's coast does not move at this scale. The
  Pontine Marshes are not drawn as water: drained enough by the Republic to be
  marsh and farmland.
- **Persian Gulf head:** the ancient shoreline is debated, so it is drawn with
  `confidence: uncertain`, at a middle line, with 20 km of shallows off it for
  the belt of flats the studies describe (`shelfKm`).

Sea level was about −1.35 m in the central Mediterranean (Lambeck 2004), which
is invisible at regional scale. It is not applied globally, because local
tectonics dominate.

---

## 7. Rendering

### 7.1 Terrain

- **A quadtree of heightmap tiles in the Albers plane.** A top-down strategy
  camera with limited tilt keeps this simple.
- **Reprojection:** a worker fetches the Mercator Terrarium tiles covering an
  Albers tile, resamples them into an Albers heightmap, and caches the result.
  The GPU only ever sees plane-space tiles.
- **Mesh:** a regular grid per tile, 64 segments a side, since lighting is per
  texel. Over the model of Rome deep tiles get a denser grid, up to 512 segments
  (about 5 m), so the ground follows its levelled sites (§7.7).
- **Lighting in the shader:** light from several directions, the north-west
  carrying it.
- **Ground colour** comes from data, not painting
  (`packages/engine/src/terrain/material.ts`):
  - **the colour family** (temperate, desert, steppe, dry summer, cold) from the
    climate texture (§6), baked by `npm run biome -w pipeline`;
  - **rock** from slope, and **snow** from height, lower where the climate is
    cold;
  - **deserts** paler on sand seas and darker and redder on rough ground, from
    the slope alone;
  - **wet sand** along low, flat shores;
  - noise at three scales (~60 km, ~6 km, ~600 m) so flat colour never reads as
    flat, moving only within the family the climate picked.

  The ground describes physical ground only. There are no invented fields or
  forests. Centuriation drawn from real survey data would be an evidenced
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
  - **Inputs:** OSM land polygons minus HydroLAKES (no reservoirs), then the
    `remove-water` and `add-water` records (§6.1), which win over both. One
    landscape for the whole window: each shore is drawn as it stood about 50 BCE.
  - **Channel 2 is ancient sea:** inside an `add-water` shape whose surface was
    the sea, how far each texel lies from its edge, to 4 km (further where a
    shape shelves more gently). The modern plain under an old bay stands a few
    metres up, and everything that reads height would have drawn it as a lake on
    today's relief — flat lake colour, no surf, the furrows in the water. So the
    terrain worker lays that ground at sea level wherever channel 0 says water
    (an island keeps its hill), and gives it a depth from the distance: a gentle
    ramp to 12 m, not a reconstruction, with the baked bathymetry winning where
    it is deeper so the old bay's mouth has no seam. The distance is in metres,
    not texels, so every level encodes the same ramp.
  - **Layout:** tiles use the terrain quadtree's own addresses and texel grid,
    for levels 0–10. Texels are 27 m at level 10; the deepest terrain (level 11,
    13.5 m) reads a window of its level-10 ancestor. Anything coarser (108 m at
    level 8) rounds every harbour mole, spit and islet into a blob next to 15 m
    relief.
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
    precision), a screen-space shore rim, and a hairline of ink. Land below sea
    level (Qattara, the Jordan valley) is land, because the mask, not the
    height, says what is water.
- **Depth is baked too** (`npm run depth -w pipeline`, `pipeline/src/depth/`),
  after the coast mask, whose tile codes say which tiles are dry:
  - **Sources:** EMODnet DTM 2024 (~115 m) wherever it reaches, which is every
    European sea; GEBCO_2026 elsewhere (the Red Sea's east, the Gulf, the
    Caspian). EMODnet is fetched in 2° chunks from its WCS into `.cache`.
  - **Sea under the source's land.** Neither source's shore agrees with OSM's;
    GEBCO's can sit half a kilometre off. Where the mask says sea but a source
    says land, depth would read 0 and draw a turquoise fringe unrelated to the
    sea floor. So each source's sea is carried a short way under its land (1.8 km
    EMODnet, 3.7 km GEBCO) before sampling.
  - **Smoothed by depth.** EMODnet is a patchwork of surveys, and each
    footprint and track line leaves a straight-edged step: coloured by depth,
    the open sea would read as a grid of boxes appearing tile by tile on zooming
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
  - **Not tied to the shore distance.** A runtime limit on the floor (falling
    no faster than 1:2 from the drawn coast) does not work: the shore distance is
    clamped at 16 mask texels, a reach that differs between tiles with coast and
    without, so it caps whole coastal tiles at ~215 m and draws a lighter
    rectangle round every island.
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
    both plain value noise and a sin hash show straight lines close in. The
    noise is baked once into a tileable texture (value and gradient, four
    texels a cell), so an octave is one read rather than eight hashes.
  - **Cost:** the surface and surf sit behind branches that only water pixels,
    close enough in to show them, take; an octave finer than a pixel is
    skipped. Measured against the same terrain without them (paired, Retina,
    M-series): +0.1 ms a frame inland, +0.3–1 ms over water (4–13%), where the
    same noise computed unbranched cost up to 25%.
  - **Surf in metres:** lines 28 m apart over the last ~120 m of gently
    shelving shores (not cliffs), broken by noise, with foam at the water's
    edge: the engraver's waterlining, read as surf. A darker band of wet sand
    runs along low, flat shores.
  - **Nothing moves.** No drifting swell or rolling surf: motion is a game's
    idiom, it pulls the eye from what the map is about, and a still map only
    needs drawing when something changes.
  - **The overview rim** (a few pixels of shallows along every coast) is kept
    only far out. It is measured in the camera's metres per pixel: measured in
    the field's own derivative, it would draw a square around every islet
    smaller than a mask texel.

### 7.3 Politics: the atom field

`npm run politics -w pipeline`, `packages/engine/src/politics/`. It follows the Imperator technique, splitting
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

- **Colour by power.** A polity takes the colour of the
  power it answers to, found by following `province-of`, `client-of` and
  similar links up to the top. Provinces are small, stable shifts of that
  colour. Client kingdoms are the colour washed towards parchment. Uncertain
  claims draw fainter. Colours are style, in `politics/palette.ts`, not data.
- **Borders are drawn in the terrain shader from the field**, not as vector
  segments. The shader:
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
  - There is no dashed line: a dash needs an along-line coordinate the field
    does not have.
- **Zoom tiers (§7.6).**
  - The fill runs from 82% at the overview to 10% close in.
  - The glow stays at 70%, sized in pixels and capped at 15 km. The contrast
    between a strong edge band and a lighter interior is what makes a border
    read.
- **Picking** reads the level-6 tile on the CPU: plane position → atom →
  claim(year). There is no GPU readback. It ignores relief, so a steep tilt can
  mis-pick near a border.

### 7.4 Lines and points

Roads, rivers and borders are all painted into the terrain in its own shader
pass (§7.1, §7.3), so they sit on the relief at any tilt.

**Roads** (`npm run roads -w pipeline`, `packages/engine/src/roads`). The source
is Itiner-e, static version 2024, CC BY 4.0. What matters about it:

- **The coordinates are EPSG:3395.** The source's GeoJSON is ellipsoidal World
  Mercator, not EPSG:4326, and is unprojected with an iterated latitude.
- **Only dated roads are drawn.** A segment is kept only when the source dates
  its construction to 27 BCE or earlier (`pipeline/src/roads/dating.ts`, in
  astronomical years):
  - `Cons_per_e`, the Roman builder, outranks `Lower_Date`, the older route;
  - the latest bound of a range decides.

  That leaves the Republican trunk network as historians name it. An undated road
  cannot take part in a time series, so it is dropped, not drawn faintly.

- **Corrections to its dating** (`data/road-corrections.yaml`).
  Itiner-e leaves some of the oldest roads out of Rome undated, and dates the
  Salaria by a later paving ("Late Republic (72–30 BCE)"), which would leave them
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
- **Style:** a cased road, the atlas symbol; a bare hairline reads as
  unfinished.
  - A cream core between fine dark edges, 3.2 CSS px wide for main roads and
    2.4 for secondary. It is the same language as the settlement names: light
    type with a dark halo.
  - Main roads appear from 900 m/px and secondary from 400, never at the
    overview.
  - Certainty sets the strength: surveyed 100%, conjectured 80%, hypothetical
    55%.
  - No dashes: they need an along-road coordinate per texel, which half floats
    cannot hold at close zoom.

**Points** (`packages/engine/src/labels/PlaceLayer.ts`).
Settlements and seats are screen-sized: each is anchored to its place and offset in
pixels by the vertex shader. The anchor stands on the ground — its height from
Mapterhorn at z10, baked into places.json, times the terrain's vertical
exaggeration — so a tilted view does not slide a hill town's marker off its hill.
Rome's monuments stand on the model's ground and, while the model stands, rise with
it to the top of their building (or, where it is not drawn, of the roofs round it),
so each marker sits on its temple's roof.

- **Markers** are drawn in pixels, like engraved symbols: fixed stroke widths, one
  pixel of antialiasing, no halo discs, which read as a generic web map.
  - A town is a small ink dot with a paper hairline.
  - A capital (provincial or royal seat) is a fine ring round a dot, with paper
    between them.
  - Rome has a second, finer ring.
  - A kingdom drawn as its capital (`seats.yaml`) is a diamond in its power's
    colour, outlined in ink.
- **What shows**, kept sparse so the overview is not crowded:
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
- **One style everywhere:** settlement names are light
  type (`#F3EBDA`) with a soft dark halo, 2.4 px wide, over land or sea. The
  hierarchy it gives: territories are dark capitals printed on the land,
  settlements are light type above it, seas are gold italic.
  - Light reads over busy relief, where dark ink sinks into it.
  - Dark everywhere reads worse.
  - Choosing light or dark per name, by the ground under it, reads as random:
    neighbours differ, and names flip as the zoom crosses a threshold.
- **Rome** is set at 19 px against 18 for the other great cities. Its double
  ring and Cinzel capitals carry its weight, not size (22 px looks
  oversized).
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

Territory and water names: `pipeline/src/labels`, `packages/engine/src/labels`.
Settlement names are in §7.4.

- **Fonts** are baked to MSDF atlases by `npm run fonts -w pipeline`
  (msdf-bmfont-xml): Cinzel for land and EB Garamond italic for water, both
  OFL. The licence texts ship beside the atlases.
  - The atlases are Latin, with the diacritics transliterated forms use.
    Kerning comes from the atlas's own pair table; polytonic Greek would need
    OpenType shaping (harfbuzz).
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
- **No name tilts more than 35° from horizontal, plus 10° of bend at its ends**,
  or a tall land such as Aegyptus would be lettered almost vertically. The axis is
  clamped, every angle in range is tried, and the one giving the largest letters
  wins. Tall, narrow lands get a name across them, not one the reader has to
  turn their head for. Everything reads left to right.
- **Water names** follow courses placed by hand (`pipeline/src/labels/seas.ts`),
  stored as the sea records' line geometry, and are sized to fill 90% of the
  course.
- **Not built:**
  - collision among territory names themselves (they sit inside their
    territories and have not needed it; settlements avoid them, §7.4);
  - two-line names;
  - thinning labels by the ink on the plate.

### 7.6 Zoom tiers

| Tier          | Scale                         | What it looks like                                                                                                            |
| ------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Paper**     | whole frame                   | Flat political colour, the unfinished sketch beyond the known world, a dark sea with gold italic sea names, almost no terrain |
| **Political** | a region of the Mediterranean | Political colour over lit relief (terrain shows through as light and shade), large curved names, borders, main roads          |
| **Terrain**   | a province or smaller         | Ground colour, glowing borders instead of full fills, roads, settlements, physical names, the shore band and foam             |

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

`data/places/rome.yaml`, `pipeline/src/rome`, `packages/engine/src/rome`. Zoomed
right into Rome, a model of the city rises out of the map's own terrain: below
~14 m/px it starts to rise, and it stands by 8. It is the one exception to §2's
"city-plan level is a separate product": a capital drawn in detail is normal in an
atlas, and nobody expects every town to get the same.

**It is also the one exception to §1.** A plan drawn only from what is sourced is
sparse and reads as a data overlay. So the model shows what nobody can map
building by building — the houses and blocks of flats between the monuments — as a
clearly generic, generated fabric. It is drawn plainer and more muted than the
known buildings, so the eye reads it as a backdrop, and the legend keys it as
illustrative. Realism goes into the known buildings first. What is known and what
is generated are kept apart:

- **Known**, from the records (every one dated and sourced, like any place):
  - **Each built as itself.** Every known building has a design
    (`pipeline/src/rome/designs.ts` and `designs/`): its type, its size, its
    columns, its stairs and the way it faced, as its sources give them for 133–27
    BCE, with those sources in the design's note. The engine knows how each type
    is put together (`architecture.ts`, `monuments.ts`); the design says which
    building it is. So the Capitol's temple is a Tuscan temple with three rows of
    six columns, three cellae and a gilded roof; Castor's the Metellan octastyle
    with its speakers' tribunal and side stairs; Vesta's a ring of twenty Ionic
    columns on three steps; Pompey's theatre a cavea of three arcaded storeys
    with Venus Victrix's temple at its top.
    - **Placing.** A design stands on its record's surveyed outline (its box and
      axis) unless it gives a centre, a size and a bearing of its own: where the
      outline is of a later rebuilding (Castor's Augustan podium, Concord's
      Tiberian one) or there is none. Where it gives none of them, the monument is
      placed as its point says, facing downhill.
    - **Where Platner & Ashby are superseded** (the Largo Argentina, the Forum
      Boarium, the Circus Flaminius, the Palatine's temples, the Late Republican
      phases of the Forum) the designs follow Digital Augustan Rome and the
      Digitales Forum Romanum for the modern literature, and the Sovrintendenza
      and Musei Capitolini for what the excavations found.
    - **Where nothing is known of a building's form** — most of the temples on the
      Aventine, the Quirinal and the Esquiline — it is the typical mid-Republican
      temple (`DEFAULT_TEMPLE`): four Tuscan columns across a deep porch on a
      podium with a flight across its front, 14 by 24 m, after Vitruvius 4.7 and
      the Largo Argentina's Temple C. Buildings with no remains whose form is a
      published hypothesis (the Curia Hostilia, the Basilica Porcia) are drawn to
      it, and their records say so.
    - Proportions a source does not give are Vitruvius' rules of thumb: a column
      seven diameters high for the Tuscan, nine for the Ionic, ten for the
      Corinthian; an entablature about a quarter of the column; a pediment a
      ninth of its width high.
    - **On a slope** a design may stand as a terrace on its highest or middle
      ground, its foundations running down to the lowest (`level`): the Area
      Capitolina and its temples, and the Tabularium.
    - **Its site levelled.** Each designed building's site is cut and filled level
      in the ground everything stands on (`ground.png`, model.ts), the larger
      first, so a temple in a forum stands on the forum: at the mean of the ground
      under it, or its lowest where it was cut into a slope (Caesar's forum, cut
      into the Arx behind a peperino wall "12 m high", Platner & Ashby, p. 227), or
      its highest where it was built out as a terrace. A walk 3 m wide runs round
      it at its level; beyond, the ground eases back over 10 m, and where the site
      is cut more than 1.2 m into rising ground a retaining wall of squared tufa
      holds it back. The terrain over the model's board is drawn on a grid of
      about 5 m (§7.1) so it follows the levelled ground.
    - **No street under a building.** Where a recorded or main street's line
      crosses a monument's footprint it stops at its edge (plate.ts), except over
      the bridges, the island and the open squares.
  - **Bridges are built as their sources give them, and the river fitted to
    them** (bridges.ts). The plan's river is OpenStreetMap's, the Tiber inside
    its 1870s–1900s embankment walls, so a bridge scaled to it would be the wrong
    size. Each bridge stands at its sourced size over the middle of the water on
    its axis, and the river's banks are moved to meet its abutments, cut back or
    made up; the build reports how far each bank moved. Its deck clears its
    arches' crowns and comes down on ramps at 22% to level approaches, every
    change of grade rounded as a road over a hump is, and the ground is fitted to
    the bridge, not the bridge to the ground. Its footprint, which keeps the
    houses off, runs the length of its approaches. The Cestius' arch rises 0.3 of
    its span, like the bridge's surviving form: its rise is not recorded, so this
    is a judgement.
  - **The Tiber Island's ship** is a travertine embankment on the island's own
    shore, smoothed of the modern embankment's steps and drawn to a point at the
    prow downstream (island.ts, which gives the river's outline too, so the water,
    the ground and the wall keep to one shore), with a parapet rising towards the
    prow as a ship's sides do and the relief of Aesculapius' staff near it.
    Behind it the island is level, 5 m over the water; the embankment lays the
    island's top itself, since the terrain's cells are too coarse to hold an edge
    at the wall.
  - **Their stone** is the one Platner & Ashby give for the window (`STONE_OF`,
    model.ts), and changes with the year where a building was refaced in it:
    marble for Saturn from Plancus's rebuilding (42 BCE), the Regia from 36 BCE,
    Venus Genetrix, the Basilica Julia, the two temples of Apollo and the round
    temple by the Tiber; travertine for the Mausoleum of Augustus and the tomb of
    Bibulus; the rest white stucco over tufa or peperino, the Republic's usual
    finish. Augustus "found it built of brick and left it in marble"
    ([Suetonius, Augustus 28.3](https://penelope.uchicago.edu/Thayer/E/Roman/Texts/Suetonius/12Caesars/Augustus*.html#28.3)),
    so the marble city is Augustan, and the model does not anticipate it: where
    an article's marble belongs to a later rebuilding (Castor, Concord, Vesta, the
    Basilica Aemilia, the Curia), it is not taken.
  - **The Forum square**, paved in Monte Verde tufa at the Sullan level and in
    travertine from Caesar's relaying (Forum Romanum, pp. 232–233), taken as 44
    BCE. Its paving lies at 13.5 m (SITAR 17854, 17890), but today's smoothed
    ground rises 11 m across it, so the square and the Comitium are cut and filled
    to that level before any site, and the buildings on it stand there. It is
    painted on the ground (`shading.ts`), not laid as a slab: its outline, the
    stone of the year, and close in the joints of its slabs in rows along its
    length, a size that is illustrative, not a survey's.
  - **Through the window**, everything dated changes the model in its year. Each
    change is in its record's dates and note and its design's `phases`, with its
    sources: the archaic Castor until L. Metellus's of 117; the Comitium
    (`comitium`), rings of low tufa steps round a paved floor, until Sulla's
    curia of 80 took its north side; Jupiter's archaic temple until the fire of
    83, a burnt shell, then Catulus's rising from 81; the Largo Argentina paved
    over after the fire of 111, its older podia standing lower from then;
    Caesar's rostra, curia and forum; Apollo's temple on the Palatine; the
    Theatre of Marcellus's foundations and the Mausoleum rising from 28. A
    building may be part-built more than once (Jupiter's: burnt, then rising), so
    each spell of its `condition` is shown as itself (model.ts `dates`,
    buildModel.ts).
    - A design whose site was open ground before it (`open`: a platform, an
      estate) keeps the generated houses off it in the years before; otherwise
      houses stand on a later monument's site until it is begun (Caesar's forum
      went up on the houses he bought).
    - What was researched and left out, and why, is listed in the header of
      `data/places/rome.yaml`: among them the Pantheon (begun in 27, finished in
      25), the Amphitheatre of Statilius Taurus and the Porticus Octavia of 168
      BCE (sites unknown), the Actian arch (doubted).
  - **The aqueducts** (`aqueducts.ts`). Only the Marcia's arcade stood above
    ground near Rome: the Appia and the Anio Vetus ran underground into the city
    (Frontinus 1.5–1.6), and are recorded but not drawn. The Marcia is drawn for
    about 9 km, as Frontinus gives it, from Capannelle by the seventh milestone
    to the agger (Frontinus 1.7; Ashby 1935, pp. 129–148).
    - Its line joins its surveyed remains (OpenStreetMap), following
      OpenStreetMap's reconstruction of the route between them, which is tagged
      approximate. Its channel is at the levels Ashby surveyed (62.1 m at Tor
      Fiscale to 52.6 m at the Via Castro Pretorio), interpolated between them.
      Where the channel stands more than an arch's height over the ground it runs
      on an arcade; lower, on a solid wall; below ground only the spoil heaps
      round its shafts show, one every two actus (71 m, Vitruvius 8.6.3).
    - The arcade is built as Ashby measured the Republican work: arches of 5.4 m
      between piers 2.4 m wide; piers of reddish tufa; voussoirs, imposts and a
      string-course of grey peperino; spandrels of yellow tufa; the channel of red
      tufa under overhanging cover slabs.
    - It stands from 140 BCE, when the water reached the Capitol, and is shown
      under construction from 144. From 33 BCE Agrippa carried the Tepula and the
      Julia on it, "Julia topmost; next below is Tepula; then Marcia" (Frontinus
      1.19), so their channels are stacked on the Marcia's from that year. Where
      the Tepula ran before is unknown, so it is not drawn earlier.
  - **The Servian Wall** (`servian.ts`, model.ts `WALL`, `wall.ts`), on SITAR's
    reconstruction of its whole course (codice PA 19694, from the surveyed
    remains, archive plans, historic maps and studies of the terrain): the middle
    of its band, following the hills' brows. Between the Capitol and the Aventine
    it runs inland from the Porta Carmentalis to the Porta Trigemina, leaving the
    river outside (SITAR, after Coarelli); the older view had the river close the
    circuit.
    - **As it was built**, from the remains and the sources: a curtain of squared
      pale Grotta Oscura tufa 3.8 m thick, laid dry in courses of two Roman feet
      (painted on, `SKIN.ashlar`), with patches of the darker Anio tufa from 87,
      when the consuls "repaired the walls" (Appian, Civil Wars 1.66); its walk
      7.5 m over its ground. No top of it survives: the battlemented parapet is a
      reconstruction, as Strabo's "wall with towers" and Livy's repairs of walls
      and towers allow.
    - **The agger** from the Porta Collina to the Porta Esquilina, where the flat
      plateau gave the wall no brow: its ditch about 30 m wide and 9 m deep
      (Dionysius 9.68) and its earth bank 10 m high behind it (Middleton), with
      towers along it every ~36 m.
    - **Thirteen gates**, placed by their surveyed remains or SITAR's sites: each
      a passage 3.6 m wide between two bastions, and behind it a court closing in
      to an inner arch, after the plans of the Porta Collina, Viminalis and
      Sanqualis. Those whose site is unknown or disputed are not drawn.
    - Houses keep 3 m from its inner face and off the agger's bank, and the
      ground at its foot outside is kept open for 12 m. Known buildings placed
      only roughly that would stand on it (Juno Moneta, Luna) are moved in off
      it; the wall is the better known.
  - The Tiber on OpenStreetMap's course, from above the Ponte Milvio to the
    Magliana, and the streets and roads (below) paved on the ground.
- **Generated**, seeded so every build is the same (`city.ts`, model.ts). The
  method follows procedural city modelling, and the forms follow what Rome's
  fabric is known to have been (the sources are catalogued in data/sources.yaml):
  - **Streets in a hierarchy.** The recorded streets stay. A main street runs
    from each gate to the Forum by the cheapest way over the ground, shunning
    slopes and preferring the recorded streets (Emilien et al. 2012; Galin et al.
    2011), so the main streets follow the valleys and merge as they near the
    centre.
  - **Local streets grown, not cut** (`growth.ts`). A town that grew was not
    divided from above: each lane was laid off one already there and took its
    line from its neighbours. So the lanes grow out from the Forum:
    - along every street, a block's side apart, a lane may leave it square on
      either side, those nearest the Forum first, and each may branch in its turn
      (Weber et al. 2009);
    - a lane follows one field of directions over the city (Chen et al. 2008):
      along the contours where the ground slopes, and elsewhere square or parallel
      to the streets round it. So the blocks of a quarter line up and the
      quarters turn with the hills;
    - lanes snap to streets and junctions near them, and carry on across a street
      opposite one another, so streets cross rather than meeting in staggered
      ends (Weber et al. 2009; Courtat et al. 2011); about a third of dead ends
      are kept as blind alleys;
    - the excavated pieces of street that belong to no recorded street (SITAR) are
      laid first, so the lanes pass where streets were found.

    Blocks are what is left between the streets: 32–42 by 55–80 m in the valleys
    (Cosa's and Pompeii's), larger on the hills, shallower terraces on a slope.
    The main and recorded streets are 7 m wide, the lanes 3–4.4 m, and a lane
    rising more than 1 in 8 is a flight of steps. Rome was "casually built upon …
    rather than regularly planned" (Livy 5.55), with "narrow, twisting lanes"
    (Tacitus, _Annals_ 15.38); Pompeii's streets are mostly 2–4 m wide (Poehler
    2017).

  - **Plots from the street to the middle of the block.** Every 2 m of a block
    belongs to the street frontage nearest it, so a plot runs back to the middle
    of the block, up to 26 m: the block is split between its streets as a
    straight skeleton splits it (Vanegas et al. 2012), and is built solid.
    - **A corner plot is one plot**, belonging to the street that matters more,
      as Conzen's town-plan analysis finds; and **plots come in series**: along a
      street a run of two to seven plots is of one width, then another run
      begins.
    - **Yards behind, courts only in large buildings**, from how the rooms were
      lit. A plot up to 17 m deep, one or two rooms lit from the street, is built
      to its back: the rows of shops with rooms over them of the Via Anicia plan
      and of Cicero's letters. A deeper plot's building fills its front 12–17 m,
      and the yards of plots back to back make one irregular yard in the middle of
      the block. Three in ten runs of deep plots are one building round a court,
      the courtyard blocks of the Marble Plan. How the inside of a Republican
      block was used is not recorded; this is inference from how rooms were lit,
      the Marble Plan two centuries on, and Pompeii.
    - **Atrium houses** stand in the quarters of the rich and now and then on the
      hills: ranges round an atrium roofed and falling inward to its opening, a
      quarter to a third of the atrium's width (Vitruvius 6.3.6), not an open
      court, a garden behind.
    - A tree stands only in open ground of 150 m² or more: a light-well is not a
      garden, and the people of Rome grew "images of gardens" in their windows
      (Pliny, _Natural History_ 19.59).
  - **Buildings, not lots.** A run of one to five neighbouring lots of flats along
    a street is one building, as the blocks of flats on the Marble Plan take
    several shops' frontage. A building has one height, one wash and one
    weathering of its tiles, and a low tiled roof with its ridge along the strip,
    so a row makes one long roof.
    - Heights follow a smooth pattern across the city, some 200 m across, within
      the quarter's range; buildings on a main or recorded street stand a storey
      higher, so the street's frontage reads as one.
    - A building on a slope steps with it: where the ground rises more than 2.2 m
      from a plot's street to its back, it is two or three parts, each on its own
      ground.
    - A storey is 3 m over a 3.8 m ground floor of shops.
  - **Quarters.** The valleys (the Subura, the Velabrum): flats of three to five
    storeys on lots 6–11 m wide; Cicero's Rome is "raised up and hanging" on its
    upper floors (_De lege agraria_ 2.96). The hills: two or three storeys on
    wider lots. Near the Palatine, the Velia, the Carinae, the Quirinal and the
    Caelian: atrium houses among flats, as rich and poor stood side by side on the
    Marble Plan. Low ground near the river: warehouses. The top of the Palatine:
    great houses and hardly a block of flats, since no Republican source puts
    flats there (Platner & Ashby, Palatinus, p. 378).
  - The houses are plain stucco in a narrow range of washes under one terracotta:
    plainer than the known buildings.
  - The monuments, the Forum, and ground too steep or wet are kept clear; so are
    the Capitol's summits and the Asylum, sacred ground where nobody lived (Livy
    6.20.13), and the Forum Boarium, the cattle market.
  - About 17,500 lots in all. The regional catalogues of the 4th century CE
    count some 46,000 blocks of flats and 1,790 houses in the imperial city.
  - **The suburb on the country's plots.** A thinner suburb lines the roads out
    of the gates. A suburban building takes a plot of the fields (fields.ts
    `plotAt`): its front at the plot's road end, the rest left to its crop, so
    the buildings keep the plots' lines and face the roads. Within ~320 m of a
    gate they are rows of shops; then houses and workshops with walled yards;
    beyond ~650 m farmsteads, ranges round a yard (Varro 1.13). In the Emporium
    (model.ts) a grid of blocks square to the Porticus Aemilia holds the kinds a
    river port's warehouse quarter had on the Marble Plan and at Ostia:
    storerooms round courts, long ranges, timber and stone yards ("inter
    lignarios", Livy 35.41.10). No building comes within 8 m of a road's line,
    and tombs stand 7.5 m back. Which plots are built, and as what, is generated:
    illustrative, not of any building.
  - **The city growing** (`GROWTH` and `GROWN` in model.ts), read from the texts,
    the modern literature and SITAR's dated remains of houses, warehouses and
    tombs (queried from its WFS). Each generated house and tomb has a first year
    as well as a last; a stretch of suburb has a share built that rises with the
    year, and each try draws one number, built from the year the share passes
    it, so a house once built stays. Every share and reach is inferred; the
    direction of each change is sourced:
    - **Inside the wall** the city was full by 133: private houses of the 2nd
      century BCE are found in every quarter excavated (SITAR), and Livy has
      three-storey blocks in 218 (21.62.3). Nothing there is thinned, except the
      Capitol's slopes, half of whose houses come only after the priests' land
      was sold in 89 BCE (Orosius 5.18.27), and Caesar's forum, whose houses go
      when the land was bought in 54 (Cicero, Letters to Atticus 4.16.8). Heights
      do not change with the year: the texts show blocks growing taller but give
      no numbers by date.
    - **Outside it** the texts that describe a suburb without a break are
      Augustan (Dionysius 4.13.3–5; Strabo 5.3.7–8); the law of about 45 BCE
      speaks of "continuous habitation" within a mile (Tabula Heracleensis). The
      suburb was "less evenly distributed" than a ring (Digital Augustan Rome), so
      it grows road by road where the remains put it: the Appia's first mile; the
      Emporium filling with warehouses, a fifth of its ground in 133 to
      seven-tenths from 50; outside the Porta Esquilina and along the Labicana and
      Praenestina; houses by the Porta Collina, but tombs only along the Salaria,
      Nomentana and Tiburtina; the Trastevere bridgehead; houses against the
      wall's outer face by the gates, late. The Campus west of the Flaminia is
      left open (Caesar's plan to build over it came to nothing: Cicero, Letters
      to Atticus 13.33a.1), and so is the Caelian beyond the wall.
    - **The tombs** along the roads thicken, ×0.4 of the most in 133, ×0.6 by
      80, ×1.0 by 45, as SITAR's dated tombs within 4 km do (17 before 133, 45 in
      133–81, 58 in 80–28).
  - None of it is a claim about any building. The records, the inspector and
    search know only the monuments.
- **The country round the city.** The land outside the wall was farmed hard, and
  the model shows it as farmland, gardens and tombs, not woodland
  (`pipeline/src/rome/fields.ts`, `packages/engine/src/rome/fields.ts`). It is
  painted on the ground, so it stays quiet under the model, with a little of it
  raised close in. It reaches ~1.35 km beyond everything on the plan and thins
  out plot by plot into the map's ground. It shows only once the model stands
  (see **Zooming in** below).
  - **Known**: the gardens and groves the sources place (kinds `garden`, `grove`
    and `cemetery` in rome.yaml): Lucullus' on the Pincian, Caesar's across the
    Tiber, Sallust's, Maecenas' on the Esquiline over the old burial ground, the
    groves of Furrina and the Camenae. Their outlines are drawn by hand from the
    bounds their sources give (`data/geometry/rome-grounds.geojson`), and are
    approximate. Each stands for its own years. Pompey's gardens, which nobody
    can place, are a point only.
  - **Generated**, seeded, following what the sources say the land near the city
    was used for (Varro, _On Agriculture_ 1.16.3; Cato, _On Agriculture_ 7–8;
    Morley 1996, ch. 4):
    - **Lanes and plots.** Blocks between lanes (a Voronoi of jittered points
      ~230 m apart) face the nearest road, and are cut into strips running back
      from it, so every plot has a frontage: 12–26 m wide near the city, 35–80 m
      far out. The distances to the lanes and hedges are stored signed, so the
      line crosses zero between texel centres and draws unbroken however close
      the camera comes; an unsigned distance on a 4 m grid would break a 3 m lane
      into dashes.
    - **What each plot grows** is drawn by distance from the wall: market gardens
      and orchards close in, vines and olives in the middle ground, grain,
      fallow and pasture beyond. Vines and olives take the slopes, meadow the
      Tiber's flats, scrub what is too steep to plough. Half the plots of a block
      share its main use, so a farm reads as one.
    - **Summer**, as the model's light is: the grain ripe or cut, the pasture
      dry, the gardens, vines and meadows green; vine rows, olive and fruit-tree
      grids and furrows each fading to its average colour when too fine to draw.
    - **Raised close in**: olives and fruit trees on the painted rows, within 1.6
      km of the wall; farmsteads; and tombs along the roads out of the gates,
      thickest near the gates (burial in the city was forbidden: Cicero, _Laws_
      2.58; Purcell 1987).
    - The Campus Martius north of the Saepta is left open grass (Strabo 5.3.8).
  - No umbrella pines outside the gardens: the pine skyline that says "Rome"
    today is mostly later planting.
- **The timeline** moves the known buildings. One not yet built, or gone, is not
  shown. One burnt is a roofless shell cut at seven-tenths, blackened towards its
  top (squashing it in height would make its columns stubby).
- **Building sites** (`rome/works.ts`). A temple being built rises through its
  works, from the year they began to its dedication, a course of two Roman feet
  at a time, each part in its own share of the years:
  - The records say when works began and ended, almost never how far they had
    got in a given year. So the share each part takes is a convention, the same
    for every temple, drawn from how Roman builders worked, not a record of any
    one:
    | share     | what goes up                                                                                                  | why                                                                                 |
    | --------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
    | 0–0.08    | the site dug, travertine footings under its walls and column lines                                            | the Augustan podium of Castor (Platner & Ashby, Aedes Castoris)                     |
    | 0.08–0.28 | the podium's core, concrete in lifts inside tufa, a bed at each course                                        | the same; the core and its walls rise together, the walls its formwork              |
    | 0.28–0.55 | the cella's walls in peperino, stepped back as they rise, and the columns, drum by drum, some ahead of others | Mars Ultor's peperino cella lined with marble (P&A, Forum Augustum); Vitruvius 10.2 |
    | 0.55–0.68 | the entablature, an open ring of blocks until the roof closes it                                              | capitals finished in the yard, then lifted                                          |
    | 0.68–0.78 | the roof: its timbers, then its tiles from the eaves up                                                       | Vitruvius 4.2.1                                                                     |
    | 0.78–0.90 | the pediment's figures; the palm on the crane                                                                 | set while the scaffold stands (Pliny NH 36.13); the Haterii relief                  |
    | 0.90–1    | the podium faced in marble, the steps laid, the scaffold and crane gone                                       | the surfaces most easily spoilt go on last                                          |
  - Round it, for the years each is needed: a free-standing scaffold of poles
    round the cella's flanks and back (a marble face takes no putlog holes; J.-P.
    Adam, _Roman Building_, 1994, pp. 145–156); a crane of two legs worked by a
    treadwheel (Vitruvius 10.2.1–3; the Haterii relief); and the yard before its
    front, with tufa seasoning in stacks (Vitruvius 2.7.5), drums, a roughed
    capital, heaps of lime and sand, roof timbers and tiles. Left out, as not
    attested: wheelbarrows, decked planking, turning jibs, cranes worked by
    cranks.
  - **Every type works in the same seven stages** (ground, base, walls, upper,
    roof, finish, facing; `Stages`), each type with its own shares of them:
    round temples, basilicas (`BASILICA_WORKS`, the clerestory left open for
    light, Vitruvius 5.1.6–7), senate houses (`CURIA_WORKS`), theatres
    (`THEATRE_WORKS`, the seating and outer arcade rising together as one
    structure of radial walls and vaults, on deep foundations, Vitruvius 5.3.3),
    porticoes and forums (`PORTICUS_WORKS`, the court as the yard), and every
    other type (`GENERAL_WORKS`, rising a course at a time). The Mausoleum has no
    scaffold: its rings were raised with the earth between them filled in, each
    fill the floor for the next lift, "instead of scaffolding" (its excavators,
    2021). A bridge has none either.
  - **Timber centering** stands under a third of a storey's arches at a time,
    moved along as the work goes (J.-P. Adam, _Roman Building_, pp. 357–358). No
    Roman picture of it survives, so its sizes are a guess.
  - **Rebuilding.** A record's works span may say what of the old building they
    `kept`: `footings`, its `podium`, or its `walls`, each only where a source
    says so; left out, the works start from bare ground. The first year is spent
    clearing the ruin. Each burnt or building span of a record is its own, so a
    temple burnt one year and rebuilt from the next stands as a shell and then
    rises (the Capitol's, burnt in 83 BCE and rebuilt on the old foundations,
    Dionysius of Halicarnassus 4.61.4).
  - **Being finished**: work a source puts on a building after its dedication. A
    temple stands whole, the scaffold still round its cella; the span runs to the
    last year a source puts work on it (the Capitol's to 62 BCE: Suetonius,
    _Divus Iulius_ 15). The inspector's Fabric lane hatches it more sparsely than
    building.
  - Works still going on when the map ends get as far as their design says
    (`progress`): the Theatre of Marcellus only its foundations by 27 BCE, the
    Mausoleum a third of its height.
  - Works are dated only where the sources date them (the Pons Fabricius in 62
    BCE, CIL VI 1305; Venus Genetrix from its vow at Pharsalus in 48 to its
    dedication in 46; Pompey's theatre from his triumph of 61 to 55). Where no
    source dates them, the building appears in its first year.

**The ground** (`plate.ts`, `rome/shading.ts`) is the map's own terrain, with only
what the city adds drawn on it:

- The terrain is laid on the Mapterhorn heights smoothed over ~45 m
  (`ground.png`; ~14 m over the Capitol, so its brows and summits keep their
  height), so the surface model's modern buildings do not show, and the model
  stands on it exactly. It is lit with its slope drawn up twice, so the hills
  read.
- **The ancient valley floors** (`ground.ts`). Since antiquity the valleys have
  filled up. Where SITAR records the height of ground walked on then
  (`rome-levels.geojson`), the valley floor is set to it, each correction citing
  the excavated pieces whose levels give its height: the Forum valley and the
  Argiletum's mouth (13.5–13.9 m), the valley of the Colosseum, the Via Appia at
  the Porta Capena and the Via Flaminia at the foot of the Capitol. The model's
  ground there is 22–29 m, so the floors fall 9–15 m. A correction follows its
  valley, over ground no more than 12 m above the floor and up to 450 m out,
  lowering the floor fully and the valley's sides less. Where no valley floor
  was excavated the terrain is as it is; hillsides and the Velia are left out,
  where the terrain model is too uncertain to measure against.
- Inside the walls, the ground between the houses is trodden earth: the
  terrain's colour pulled most of the way to it, its relief kept.
- Close in, a ground mesh over the same heights draws only the model's shadows.
  Beyond it the terrain carries them baked: each footprint swept away from the
  sun. Only what stands through the whole window casts a baked shadow.
- The Tiber is drawn in the map's river colour as OpenStreetMap's outline of its
  water, across the whole plate's grid. The map's line of it is OpenStreetMap's
  centreline (`tiber` in features.yaml, drawn in place of HydroRIVERS'), so the
  water hands over to the line by zoom without a break.
- The city's streets show only while they can be drawn at their width; the map's
  roads give way to them then. The roads out of the gates run on as far as the
  country round the city (`countryMask`), and past the Aurelian gates they are
  the same Itiner-e line as the map's, so one fades into the other where the
  fields fade into the map's ground.

**Streets and roads** (`streets.ts`) are paved in basalt: the censors of 174 BCE
had the city's streets paved in it (Livy 41.27.5), and the Via Appia was paved
from 293 BCE (Livy 10.47.4). It is a warm grey, not black, so the city stays
light; close in, the joints of its polygonal blocks are drawn, a size that is
illustrative. The lanes are trodden earth. The streets are:

- the Forum and Palatine streets from OpenStreetMap's paths on the excavated
  paving;
- five streets traced along the modern streets Platner & Ashby identify them
  with: the Alta Semita, the Vicus Patricius, the Clivus Suburanus, the Vicus
  Cuprius and the Clivus Argentarius;
- streets drawn from the evidence (`routes.ts`) where no one modern street
  carries them: the Vicus Tuscus, the Vicus Iugarius and the Argiletum beyond
  their surveyed stretches, the Vicus Longus, the Clivus Publicius, and the
  street up the valley from the Porta Capena. Each is a line through the pieces
  of its paving that excavations found (SITAR, cited by number; `sitar.ts`), the
  points the sources fix (gates, street corners, the temples they passed), and
  between them the cheapest path over the ground, off the monuments and the
  river, so a street keeps to its valley and climbs a hill across the slope.
  They are drawn lighter, as the traced streets are. Digital Augustan Rome's
  plan of 14 CE is read for which streets there were and roughly where; since it
  carries no licence, none of its drawing is copied;
- the 110 excavated pieces of street that belong to no recorded street, kept in
  `data/geometry/rome-sitar.geojson` for the generated streets to follow;
- **the consular roads out of the gates** (`roads.ts`). Itiner-e runs every road
  inside the later Aurelian Wall straight to the Forum, so its lines cannot be
  the roads the gates opened on. Eleven roads run from their gates, or the Pons
  Aemilius, out past the board's edge, each a line through the gate
  (servian.ts), the sources' fixed points (the later Aurelian gates, the forks,
  the bridges), SITAR's reconstructions of the Flaminia, the Appia and the
  Latina, and the excavated pieces of their paving
  (`data/geometry/rome-roads.geojson`), then Itiner-e's line from where it keeps
  to the ancient road. Left out: roads unattested in the window or with no
  bridge to them (the Ardeatina, the Triumphalis and Cornelia, and others). The
  suburb's houses, the tombs and the plots of the country face these roads.

**The look** is a photograph of a model city on a table (`ModelLayer.ts`,
`miniature.ts`):

- matte materials: the known monuments in their stone, the houses plainer
  stucco under terracotta, the wall tufa, the trees muted green;
- a low sun from the north-west, the terrain's light direction, casting real
  shadows across roofs and streets, the shadow map fitted to the view each frame
  so its texels stay near a metre; a bright sky and bounce light keep the shaded
  walls light;
- a light wash of relief over the whole model, as an illustrated map shades its
  hills, so the seven hills read from straight above, where the roofs cover most
  of the ground. It is light because the valley floors at their ancient depth
  give real slopes and shadows; a stronger wash turns roofs on the slopes muddy;
- everything darkening where the model overshadows itself: a grid of the height
  of what stands in each 2 m cell, blurred over about 10 m and 30 m, against
  which a narrow street, a courtyard or the foot of a wall under a taller
  neighbour sees less of the sky, rebuilt when the year changes;
- a little warm haze with distance;
- the generated houses' walls and roofs painted on in the shader, drawn only
  while they are a few pixels across: shops open to the street on the ground
  floor, as the street fronts of Pompeii and Herculaneum (Wallace-Hadrill 1994;
  Ellis 2018), small windows above, a darker dado, and tiled roofs, as Rome's
  were from the war with Pyrrhus (Pliny, _Natural History_ 16.36). Where the
  doors and windows fall is generated, as the lots are;
- tilted, a tilt-shift: the top and bottom of the frame out of focus, as a
  close-range photograph of a model is, run only while the model stands and the
  view is tilted.

Heights scale with the terrain's vertical exaggeration.

**Zooming in**, the city comes in first and the country round it last, so that
Rome never looks like a patch of different ground in Italy's:

- **From ~70 m/px to 50** the city fades in as a picture of the model drawn from
  straight overhead (`rome/portrait.ts`, ModelLayer `paint`), in its sun and its
  shadows, drawn again for each year's buildings: only the city, its suburb and
  its known gardens, on the map's own ground. Further out Rome is ordinary
  terrain like any other town.
- **From 14 m/px to 8** the model rises out of that picture, which fades out
  under it, so the city only ever stands in 3D once its buildings are a few
  pixels high. The earth, the smoothed lighting and the baked shadows come in
  with it.
- **From 8 m/px to 4**, once it stands, the country comes in (`FIELDS_MPP`),
  evenly over the whole view: the fields, and the olives, orchards and baked
  shadows standing on them, together. Towards the country's edge its plots drop
  out one by one into the map's ground.

**The legend** keys the model while it stands: marble, stucco over tufa,
travertine, and the houses as illustrative, with a line saying that only the
named buildings are from the records and the houses show how crowded the city
was, not where any house stood.

**Names** are few: the hills in widely spaced capitals bowed over each hill's
long axis, as the engraved plans set them; the quarters and the Tiber in italic;
the monuments from 1.5 m/px, set as the towns are, in light type with a dark halo,
which reads over the model's roofs where dark ink sinks into them. The hills and
quarters are fainter, so they stay behind the monuments' names. They come in
turns as the zoom comes in, so that no view carries every layer at once: the hills
alone to about 2.5 m/px, then the quarters as the hills recede, then the
monuments. Streets are not lettered. A click inside a monument's outline opens
it, or inside the footprint drawn for one with no outline.

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

### 8.1 Palette

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

- **Land names:** Cinzel, an open Trajan-derived capital face,
  tracked +8% to +40% depending on how much room the label has.
- **Water and secondary names:** EB Garamond italic.
- **Settlements:** EB Garamond Medium, mixed case (§7.4). True small caps
  would need OpenType shaping (harfbuzz), and a fake from scaled capitals is
  not used.
- **Language:** Latin nominative by default. The Greek-speaking east keeps
  Greek forms where only Greek is attested. It is not silently latinised; this
  is carried over.

### 8.3 Discipline

- A written style spec (this section) comes before shader work.
- **Side-by-side screenshot checks at each zoom tier, against the references.**
  Every change must move towards them rather than add something.
- The interface is minimal and quiet: a timeline, an inspector and a legend.
  No default component-library look.
- **The interface theme is an engraved atlas** (`apps/explorer/src/index.css`).
  The panels are printed matter laid over the map, in the map's own inks:
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
  - The timeline is a slim strip in the bottom-right corner, 40 px in both
    states, that never moves: it always shows the year and opens its ruler
    beside it. Only its toggle opens or closes it.
  - The legend is a row of the title block, under the index. Its key opens
    beside the title block, over the map, set in short columns (Rome's colours, the kinds of doubt, the map's marks) so it
    is no taller than the block: it never moves and never covers the person
    panel. It is not a dialog: the map and timeline stay live while it is
    open, and only its row closes it. It starts closed, and the reader's
    choice is remembered.
  - The title block's last row is the preface, named as an atlas names its
    front matter. It opens the one dialog in the interface: what the map is, where it stands, how to use it, how far to trust it (§1,
    with Rome's generated fabric as the exception, §7.7) and whose work it is
    drawn from (§6), read on its own rather than beside the map. It is written
    plainly and without a narrator: no "we" or "I". On hover, and
    while the legend is open, a row's icon takes its text's colour.
  - Search is the atlas's index. The top-left corner holds the plate's title
    block, the map's name and the years it covers in the
    double rule, with "Index of names ⌘K" under it. Each result is its map
    mark, its name, a dotted leader and what it belongs to (`Province of
    Roma`); what is not on the map in the year shown is greyed with its years,
    and going to it moves the timeline to the first. With nothing typed it
    offers the year's largest polities and its great cities. The map stays
    sharp behind it under a thin paper wash.
  - Italic is kept to short phrases. Tooltips and notes are upright: Garamond
    italic thins out over a sentence, and light-on-dark type at 13 px breaks
    up as Garamond Regular does on the map (§7.4).
  - `/playground.html` shows the interface over screenshots of the three
    tiers, a specimen of every component, and a live token editor.
  - shadcn components are ours once themed. Nine carry edits beyond the tokens
    (badge, button, card, command, dialog, dropdown-menu, select, skeleton,
    slider): never re-add them with `shadcn add --overwrite`.

---

## 9. Engine API

```ts
const map = await RomeMap.create(container, { camera })

map.setYear(-48, { animate: true }) // astronomical years (§5.2); 49 BCE
map.flyTo({ kind: 'place', id: 'roma' }) // or a polity; entries() lists them
map.setFocus('parthia') // bring a polity forward; null clears it

const hit = await map.pick(clientX, clientY) // { place } | { territory }: the claim this year
const all = await map.entries() // everything searchable, named for the year shown
map.shows(ref, year) // whether a place or polity is on the map in a year
map.onModel = (shown) => {} // the model of Rome (§7.7) has risen or sunk back
```

The engine is framework-free: it owns a canvas inside the container it is given,
and apps drive it through these methods. A thin React wrapper lives in the
explorer app.

---

## 10. Hosting and budgets

- **Terrain** comes from Mapterhorn's hosted tiles at runtime.
- **Everything else is ours and small:** the atom field, claims, vectors,
  fonts and baked overlays, served as static files with the app. Static hosts
  limit file size and count (Cloudflare Pages: 25 MiB a file, 20k files on the
  free plan), which is why the deep tiles are packed (§7.2).
- Local development needs no hosting at all.
- **Budgets:**
  - 60 fps at 1440p on an M1-class laptop;
  - first frame under 5 MB transferred;
  - scrubbing the year never drops a frame.

---

## 11. Risks and open questions

- **The hosted terrain's terms and rate limits** are unverified. If they fail
  us, the answer is to bake our own Albers terrain tiles for the frame, which
  means taking on hosting.
- **HydroRIVERS' licence** is to verify (data/sources.yaml).
- **Neighbour extents** (Parthia, Germania, Arabia) have weak evidence. The
  default is seats and soft schematic zones, never confident polygons.
- **Curation effort dominates engineering.** The data work is the main job,
  not a side task. What looks wrong or rests on weak ground is listed in
  data/DOUBTS.md.
