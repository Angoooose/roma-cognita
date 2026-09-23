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
| Bathymetry             | **EMODnet DTM 2024** (~115 m) over the European seas, **GEBCO_2026** (15″, ~460 m) elsewhere, baked offline (§7.2) | CC BY 4.0; public domain with attribution | Drives the shallows. AWS Terrain Tiles were used at runtime until September 2026: ~1–2 km at sea, and they drew the Caspian as a flat −28 m slab. |
| Coastline, modern      | OSM land polygons, split edition (osmdata.openstreetmap.de) | ODbL      | Natural Earth 10m is too coarse at 50 m/px |
| Lakes                  | **HydroLAKES v1.0** (≥ 0.05 km²)                     | CC BY 4.0         | Reservoirs (type 2) are dropped, which removes Nasser, Atatürk, Assad and similar automatically |
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
  - **At runtime** the worker also stops the floor falling faster than 1:2 from
    the drawn coast, since at a cliff the first texel of 110 m bathymetry is
    already tens of metres deep.
- Depth drives the ramp from deep navy to turquoise shallows. Lakes are told
  apart from sea by their surface height and take a flat colour.
- Specular glint and slow normal-map ripples. No foam at low zoom.

### 7.3 Politics: the atom field

Built in September 2026 (`npm run politics -w pipeline`,
`packages/engine/src/politics/`). It follows the Imperator technique, splitting
*where* from *who*, with one change: borders come from a distance field, not
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
  - gaps left where cicero-map differenced neighbouring outlines.

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
cicero-map's work on it is carried over:
- **The coordinates are EPSG:3395.** The source's GeoJSON is ellipsoidal World
  Mercator, not EPSG:4326, and is unprojected with an iterated latitude.
- **Only dated roads are drawn.** A segment is kept only when the source dates
  its construction to 27 BCE or earlier (`pipeline/src/roads/dating.ts`, ported
  and moved to astronomical years):
  - `Cons_per_e`, the Roman builder, outranks `Lower_Date`, the older route;
  - the latest bound of a range decides.

  That leaves 405 lines: the Republican trunk network as historians name it. An
  undated road cannot take part in a time series, so it is dropped, not drawn
  faintly.
- **Each segment keeps its first year**, and the shader shows it only from then.
  This fixes cicero-map's oldest bug, which drew roads built in 46 at 68 BCE.
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
Settlements and seats are screen-sized: each is anchored to its place on the plane
and offset in pixels by the vertex shader.

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
2. Migrate `cicero-map/data` into the new model.
3. Extend the data to 133–27 BCE and the full frame, including Parthia and the
   neighbours.
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
