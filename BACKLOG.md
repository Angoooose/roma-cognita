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
