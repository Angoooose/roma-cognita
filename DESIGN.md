# Roman world map — design

A GPU-rendered, game-quality interactive map of the Roman world with a timeline.
Imperator: Rome is the bar for how it should _feel_; the Barrington Atlas is the
bar for what it may _claim_. The Cicero project will be its first consumer, but
the map is a general-purpose package and knows nothing about Cicero.

Status: draft, September 2026. Supersedes `cicero-map/` as a codebase, not as
a body of knowledge — that repo's README and NOTES record hard-won decisions
and traps, and this design carries most of them forward.

---

## 1. Principles

1. **Accuracy first. Nothing is drawn that the data does not support.** Where
   the evidence is weak the drawing says so: a frontier the sources leave vague
   is drawn soft, and a kingdom whose extent nobody knows is drawn as a seat,
   not a guessed polygon. Carried over from `cicero-map`: _the source's silence
   is not evidence._
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

| Decision       | v1                                                                  | Grows to                    |
| -------------- | ------------------------------------------------------------------- | --------------------------- |
| Time window    | **133–27 BCE**, the Gracchi to Augustus's settlement                | any year; schema is open    |
| Frame          | **10°W–50°E, 22°N–58°N**: Ireland/Portugal to the Persian Gulf, Upper Egypt to Scotland; data carries a few degrees of margin | wider by config             |
| Zoom           | continental → **regional** (towns, roads, villas, ~50 m/px)         | city-plan level is a separate product |
| Neighbours     | Parthia, Germania, Dacia, Britannia, Arabia: named, roughly bounded, not curated town by town | curated as needed           |
| Platform       | **desktop browsers only**, mouse and trackpad                       | —                           |
| Licence stance | **non-commercial**; our data released under **CC BY-SA 4.0**        | —                           |

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
    schema/             zod schemas + TS types, shared by pipeline and engine
    engine/             the renderer and its public API (three.js)
  apps/
    explorer/           first consumer: the map, a timeline, an inspector
```

npm workspaces, TypeScript, Vite. Cicero either becomes `apps/cicero` or
imports `packages/engine` from its own repo; it plugs in through the same API
as the explorer (§9) either way.

**Flow:** `data/` + external sources → `pipeline` (validate → join → bake) →
`dist/` build outputs (textures, tiles, JSON) → `engine` → apps.

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

| parallels | worst in frame   | worst in Mediterranean core (32–46°N) |
| --------- | ---------------- | ------------------------------------- |
| 30 / 46   | 7.7% at 58°N     | 1.0%                                  |
| **30 / 50** | **5.0% at 58°N** | **1.5%**                            |
| 28 / 52   | 4.0% at 58°N     | 2.2%                                  |

30/50 is the compromise: Scotland pays a little so the core stays tight.
Because every output is pre-projected, **this decision is frozen once the
pipeline ships.** Changing it means rebuilding every file.

Carried-over trap: d3-geo and polygon-clipping disagree on ring winding
(`cicero-map` README, "Ring winding"). The pipeline normalises winding once, at
ingest, and asserts it.

---

## 5. Data model

The core idea is carried over from `cicero-map`: **geometry once, time as a
table.** Shapes are drawn once; everything that changes over time is a dated
row that refers to them.

### 5.1 Entities

| Entity             | What it is                                                                                                | Key fields |
| ------------------ | --------------------------------------------------------------------------------------------------------- | ---------- |
| `source`           | A citable work or dataset                                                                                 | id, citation, url, licence |
| `atom`             | Ground that is never subdivided at any date the data covers. It carries geometry and no politics.         | id, geometry, evidence (`surveyed` / `derived` / `schematic`), splitFrom? |
| `polity`           | A political unit, independent of ground: a province, a client kingdom, Parthia, a tribe                   | id, kind, dated names, parent relations |
| `claim`            | **The time series.** Atom × polity × relation × interval                                                  | atom, polity, relation, interval, sources, confidence |
| `relation`         | A polity-to-polity link over time, e.g. a client kingdom is _client of_ Rome                              | from, to, type, interval |
| `seat`             | A polity drawn as its capital because its extent is unknown                                               | polity, place, interval |
| `place`            | A located thing: a settlement, fort, sanctuary or pass. Joined to Pleiades.                               | id, pleiades, location, kind, interval, prominence over time |
| `name`             | A dated, language-tagged name for a place, polity or feature                                              | target, text, lang, interval, preferred? |
| `route`            | A road segment, from Itiner-e                                                                             | geometry, class, built interval, sources |
| `landscape-change` | A dated correction to modern physical geography: add or remove water, marsh, reservoir removal, a river course | geometry, op, interval, sources |
| `feature`          | Physical named features: rivers, mountains, capes, seas                                                   | geometry, names |

Claim `relation` values: `province`, `citizen-territory`, `client`, `allied`,
`independent`, `occupied` (e.g. the Parthian invasion of Syria in 40 BCE). Map
modes are just different joins over this table: owner, top-level power,
province status, and so on.

### 5.2 Time

- **Authoring format: explicit era strings.** `"63 BCE"`, `"14 CE"`, or a
  range `"c. 81 BCE"`. The build converts them to **astronomical integers**
  (1 BCE = 0, 43 BCE = −42), so arithmetic across the era boundary is correct.
  Nobody ever types a sign.
  - This fixes a real ambiguity in `cicero-map`, which calls −43
    "astronomical" but means 43 BCE. It was harmless there because the window
    was entirely BCE. It stops being harmless the moment the window grows.
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

`cicero-map` folded a review state into its confidence scale (`check`). Here
they are separate:

- `confidence: certain | probable | uncertain`. How firmly the sources support
  the claim. **This is drawn.**
- `review: verified | draft | needs-check`. The state of our work on it.
  **This is reported by the build, never drawn.**

Every historical record needs at least one `sources` entry: a source id plus a
locator (page, map number, fragment). A `note` field holds reasoning that
should survive, in the style of `cicero-map`'s `_comment`s.

### 5.4 Identity

- **Pleiades IDs** wherever a record corresponds to a Pleiades place.
- Otherwise **our own stable slugs** (`hispania-citerior`). Never array
  positions, and never IDs from upstream files. AWMC OBJECTIDs are not stable
  across releases.
- Upstream geometry is matched **by seed point**, and the build fails loudly on
  ambiguity. This is carried over, and it is the right bargain.

### 5.5 Atoms across a growing time span

In `cicero-map` an atom was "ground that never subdivides _during the
window_". A longer span will need atoms to split: a province divided, a
kingdom partitioned. The rule is **finest common subdivision**. When a new
boundary is needed, the atom is split into children with `splitFrom: parent`,
and claims on the parent are rewritten onto the children by a migration script
the build can verify. Atoms never overlap, and the build asserts that their
union equals the land they came from.

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

### 5.7 Migration

`cicero-map/data/*.json` is the first real test of this model. That means
atoms, cuts, shapes, polities, control, seats and places, all already sourced.
Migrating it proves the schema before new curation starts.

---

## 6. Sources

| Layer                  | Source                                              | Licence           | Notes |
| ---------------------- | --------------------------------------------------- | ----------------- | ----- |
| Terrain (runtime)      | **Mapterhorn** `planet.pmtiles`, Terrarium encoding | various open; **terms of the hosted file unverified** | 30 m global, finer in parts of Italy and Spain. Web Mercator, reprojected by the engine (§7.1). Fallback: AWS Terrain Tiles. |
| Terrain (offline bakes) | Copernicus GLO-30; **FABDEM** (bare earth) now allowed | Copernicus licence; CC BY-NC-SA | Used for ambient occlusion and texture-shading bakes |
| Bathymetry             | **EMODnet DTM 2024**; GEBCO 2026 outside it          | CC BY 4.0; PD     | Drives the shallow-water band |
| Coastline, modern      | OSM land polygons (osmdata.openstreetmap.de)        | ODbL              | Natural Earth 10m is too coarse at 50 m/px |
| Coastline, ancient     | Our `landscape-change` records; AWMC period patches as seed | ours; ODbL  | AWMC's `roman_open_water` layer is 2 polygons (Miletus, Ephesus) and its Hellenistic layer 5 (adding Utica). Checked 2026-09-22. |
| Places                 | **Pleiades**; DARE as a cross-check                  | CC BY 3.0; CC BY-SA 3.0 | Importance is curated by us |
| Territory geometry     | AWMC `roman_empire_bce_60` + our own shapes          | ODbL              | As in `cicero-map` |
| Region and people names | AWMC `regional_names_linework`                      | ODbL              | Baselines give size and angle |
| Rivers                 | AWMC river lines (Barrington); HydroRIVERS for minor | ODbL; **licence to verify** | Modern courses corrected at deltas |
| Roads                  | **Itiner-e**                                         | CC BY 4.0         | Only dated segments ship. Construction date kept per feature, which fixes `cicero-map`'s oldest open bug. |
| Surface textures       | ambientCG, Poly Haven                                | CC0               | Rock, scree, sand, soil, scrub |
| Aridity / biome        | Köppen–Geiger (Beck et al.)                          | **licence to verify** | Modern climate as a proxy for desert versus green; used coarsely |
| Reference only         | Barrington Atlas, Broughton MRR, Talbert            | ©                 | Cited, never copied |

ODbL and CC BY-SA are compatible with our CC BY-SA 4.0 release. The
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
  exception.

### 7.2 Water

- **The land/water mask is a signed distance field of the coast**, baked in
  tiles from OSM land polygons with the `landscape-change` records applied for
  the current year. One field gives a crisp coast at any zoom, the shallow band,
  and shore foam.
- Depth comes from EMODnet, baked to a ~1 km texture over the frame. Depth
  drives the ramp from deep navy to turquoise shallows.
- Specular glint and slow normal-map ripples. No foam at low zoom.

### 7.3 Politics: the atom ID texture

This is the Imperator: Rome technique (documented by Intel), applied to our
atoms.

- **Offline:** rasterise the atoms into an ID texture over the frame (R16UI,
  nearest filtering, no mipmaps). 8192 px across the frame is ~0.6 km/px.
- **Runtime:** a `claims` texture holds atom → polity per year, and a `palette`
  texture holds polity → colour. Scrubbing the year rewrites one row of a few
  thousand texels. A fade binds two year rows and `mix()`es between them.
- **Soft border glow:** a jump-flood distance field of owner changes at quarter
  resolution, recomputed only for the regions that changed, and on scrub-end
  rather than during a drag.
- **Crisp border lines are vectors, not bitmap edges.** They are extracted
  offline from the atom polygons. Each segment is tagged with the atom on each
  side, and the vertex shader hides it when both sides share an owner that
  year. Line style comes from `evidence`/`confidence`:
  - surveyed boundaries are drawn solid;
  - schematic ones are drawn as a soft band with a dashed core. This is carried
    over.

  **This is also the fix for the ID texture's resolution limit.** Fills and
  glows are soft, so 0.6 km/px never shows. The crisp edge is a vector line,
  and the coast edge comes from the SDF.
- **Picking:** the engine keeps a CPU copy of the ID texture. A click resolves
  plane → atom → claims(year) with no GPU readback.

### 7.4 Lines and points

Roads, rivers and borders use one instanced line renderer. Every feature
carries `from`/`to` years as vertex attributes, and the shader hides it outside
the current year: filtering is a uniform change, not a rebuild. Points
(settlements, seats) use instanced sprites with the same attributes.

### 7.5 Labels

- **Fonts** are baked to MTSDF atlases: Latin, polytonic Greek, and small
  caps. **Shaping** uses harfbuzzjs in a worker.
- **Glyph layout is ours:** one instanced draw call for all glyphs. Each glyph
  instance carries its anchor, angle, size, colour, label id, year range and
  zoom range.
- **Curved area labels are computed offline, per distinct territory shape:**
  - approximate the medial axis, prune the spurs and pick the main path
    (Barrault; Krumpe & Mendel 2020);
  - fit an arc or spline and flip it if it would read upside down;
  - set tracking so the text fills 60–80% of the path.

  Territory shapes change only at claim boundaries, so this runs per unique
  configuration, not per year.
- **Collision** is greedy by priority over a grid index, with per-glyph boxes.
  It re-runs on zoom or year change, never per frame, and cross-fades
  MapLibre-style. Carried over: thin labels by the ink on the plate, not by
  zoom tier alone.

### 7.6 Zoom tiers

| Tier      | Scale              | What it looks like |
| --------- | ------------------ | ------------------ |
| **Paper** | whole frame        | Flat political colour, pale parchment beyond the known world, a dark sea with gold italic sea names, almost no terrain |
| **Political** | a region of the Mediterranean | Political colour over lit relief (terrain shows through as light and shade), large curved names, borders, main roads |
| **Terrain** | a province or smaller | Materials, glowing borders instead of full fills, roads, settlements, physical names, the shore band and foam |

The tiers crossfade continuously with camera distance. They are never hard
switches.

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
- Fields everywhere.
- 3D models and unit markers.
- A heavy game interface.
- Its fonts or art, which are licensed to Paradox.

### 8.1 First palette (draft, to be tuned against screenshots)

| Token          | Hex       | Use |
| -------------- | --------- | --- |
| `sea-deep`     | `#1E3150` | open sea |
| `sea-shallow`  | `#3E8C98` | shallows band |
| `parchment`    | `#D8D2C4` | beyond the known world (paper tier) |
| `ground-arid`  | `#D6A774` | desert, steppe |
| `ground-green` | `#7C8848` | fertile lowland |
| `rock`         | `#8C8378` | high and steep ground |
| `ink`          | `#2A241E` | type, borders, roads |
| `ink-sea`      | `#B48C48` | sea names |
| political      | 12–16 muted pastels, lightness 60–75%, chroma capped | assigned per polity, stable across years |

### 8.2 Type

- **Land names:** Cinzel, or a comparable open Trajan-derived capital face,
  tracked +8% to +40% depending on how much room the label has.
- **Water and secondary names:** EB Garamond italic.
- **Settlements:** EB Garamond small caps.
- **Language:** Latin nominative by default. The Greek-speaking east keeps
  Greek forms where only Greek is attested. It is not silently latinised; this
  is carried over.

### 8.3 Discipline

- A written style spec (this section, grown) comes before shader work.
- **Side-by-side screenshot checks at each zoom tier, against the references.**
  Every change must move towards them rather than add something.
- The interface is minimal and quiet: a timeline, an inspector and a legend.
  No default component-library look.

---

## 9. Engine API (for the explorer and Cicero)

```ts
const map = await createRomeMap(canvas, { data: '/data', year: '63 BCE' })

map.setYear('49 BCE', { animate: true })
map.flyTo({ lon: 12.48, lat: 41.89, zoom: 'terrain' })
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
- **Everything else is ours and small:** the ID texture, claims, vectors,
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
2. Migrate `cicero-map/data` into the new model.
3. Extend the data to 133–27 BCE and the full frame, including Parthia and the
   neighbours.
4. The first 10 `landscape-change` records.
5. Pipeline outputs: the atom ID texture, the border segments and the
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
