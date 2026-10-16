<div align="center">

<h1>Roma Cognita</h1>

<p>
  An interactive map of the Roman world, from the Gracchi to Augustus.
  <br />
  <sub>
    <a href="https://roma.angoose.dev"><b>Open the map</b></a> ·
    <a href="#how-its-built">How it's built</a> ·
    <a href="#running-it">Running it</a> ·
    <a href="#credits">Credits</a> ·
    <a href="#licence">Licence</a>
  </sub>
</p>

<p>
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/three.js-WebGPU-000000?style=flat-square&logo=threedotjs&logoColor=white" alt="three.js" />
  <img src="https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/data-CC%20BY--SA%204.0-8B2E2E?style=flat-square" alt="Data: CC BY-SA 4.0" />
</p>

<p>
  <a href="https://roma.angoose.dev">
    <img width="3456" height="1928" alt="Roma Cognita map" src="https://github.com/user-attachments/assets/d709f66d-4759-40eb-9af0-c61b294e75c4" />
  </a>
</p>

</div>

---

Move the timeline and watch provinces change hands. Zoom from the whole Mediterranean down to single towns, roads and villas. Click a province to see who governed it that year, then follow that person's career and family.

It should feel like a strategy game, but it should only show what the historical record can back up.

- **Accuracy first.** Nothing is drawn that the sources don't support. Frontiers the evidence leaves vague are drawn soft.
- **Everything is dated.** Every place, border and person has a date range, so all of it moves with the timeline.
- **Builds report their own doubt.** Each data build lists what it couldn't confirm.

## How it's built

The map draws on open datasets, ancient texts and modern scholarship. Every border, place and person cites where it comes from. A data pipeline checks it all and bakes it into what the browser draws.

| Folder            | What's in it                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `data/`           | Hand-written records (YAML) and geometry (GeoJSON), each tied to its sources                |
| `pipeline/`       | Pulls in the open datasets, checks the data and bakes it into tiles, textures and JSON      |
| `packages/engine` | The renderer: three.js WebGPU, with a WebGL2 fallback                                       |
| `packages/schema` | The shape of every record, checked by the pipeline and shared with the app                  |
| `packages/world`  | The projection, the map frame and the tile formats, shared by the pipeline and the renderer |
| `apps/explorer`   | The map app, with its timeline and inspector                                                |

## Running it

The quickest way to see it is the [live map](https://roma.angoose.dev). To run it yourself, you need Node 24 and about 12 GB of free memory for the largest builds.

**1. Install**

```bash
npm install
```

**2. Get the source data**

The raw datasets aren't in the repo. Each build checks for what it needs in `.cache/sources/`, and if something is missing, it stops and prints where to download it. People data is fetched for you. Set `ROMA_COGNITA_CONTACT` in `.env.local` to your email first: it's sent with each request, which is polite to the servers you're fetching from. Then:

```bash
npm run people:fetch -w pipeline
```

**3. Bake the map**

Run these in order. Some steps read what earlier ones wrote:

```bash
npm run water    -w pipeline   # coasts and lakes (run first)
npm run depth    -w pipeline   # sea depths
npm run biome    -w pipeline   # climate and ground
npm run known    -w pipeline   # the edge of the known world
npm run rivers   -w pipeline
npm run roads    -w pipeline
npm run politics -w pipeline   # borders through time
npm run fonts    -w pipeline
npm run rome     -w pipeline   # the model of Rome
npm run labels   -w pipeline
npm run people   -w pipeline
npm run sources  -w pipeline   # the index of sources
```

Everything lands in `build/`. Each step prints what it couldn't confirm, so read the output.

Some of the geometry in `data/geometry/` is generated as well, by scripts you only need when changing it: `rome:fetch`, `rivers:fetch`, `derive-coasts`, `derive-floodplains`, `seas` and `canals`. Each script's header says what it writes.

**4. Start it**

```bash
npm run dev
```

The map is at `/`. Every work it cites is listed in the index of sources at `/sources`, with an entry for each at `/sources#<source id>`.

To check the hand-written data on its own, run `npm run data:validate`. It fails on any error.

To take screenshots of the map, run `npm run shot -- <view…>`, e.g. `npm run shot -- forum italy --prefix before`. It starts its own server from your checkout, waits until each view has finished drawing, and uses your installed Google Chrome. `npm run shot -- --list` lists the named views; the options are at the top of `scripts/shot.mjs`.

## Credits

Built on the work of many others.

| Source                                                                                             | What it gives the map                                                                      |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [Digital Prosopography of the Roman Republic](https://romanrepublic.ac.uk)                         | People, from King's College London                                                         |
| [Wikidata](https://www.wikidata.org)                                                               | English names for people                                                                   |
| [Pleiades](https://pleiades.stoa.org)                                                              | Ancient places                                                                             |
| [Itiner-e](https://doi.org/10.5281/zenodo.17122148)                                                | Roads of the Roman Empire                                                                  |
| [OpenStreetMap](https://www.openstreetmap.org) · [Natural Earth](https://www.naturalearthdata.com) | Coastlines                                                                                 |
| [GEBCO](https://www.gebco.net) · [EMODnet Bathymetry](https://emodnet.ec.europa.eu/en/bathymetry)  | Sea depths                                                                                 |
| [Mapterhorn](https://mapterhorn.com)                                                               | Terrain                                                                                    |
| [HydroSHEDS](https://www.hydrosheds.org)                                                           | Rivers and lakes (HydroRIVERS, HydroLAKES)                                                 |
| Köppen–Geiger (Beck et al., 2023)                                                                  | Climate                                                                                    |
| [SITAR](https://www.archeositarproject.it/en/piattaforma/open-data/)                               | The archaeological map of Rome                                                             |
| 78 ancient texts                                                                                   | History, from Caesar and Cicero to Strabo                                                  |
| More than 200 modern studies                                                                       | History, led by Broughton's _Magistrates of the Roman Republic_ and the _Barrington Atlas_ |

The full list, with each dataset's licence, is in `data/sources.yaml`.

## Licence

The code is released under the [MIT licence](LICENSE). Our data in `data/` is released under [CC BY-SA 4.0](data/LICENSE), except the geometry drawn from OpenStreetMap, which stays under the ODbL. The people come from DPRR under CC BY-NC 4.0. They are fetched and built on your machine, never stored in the repo, and the build writes DPRR's licence beside them.
