/**
 * Bakes the political layer (DESIGN.md §7.3):
 *
 * - `build/politics/{level}/{i}/{j}.webp`: the atom field on the terrain quadtree. Each
 *   texel holds the pair of atoms either side of the nearest boundary and the signed
 *   distance to it — enough for the shader to draw fills, antialiased borders and a
 *   glow at any zoom without ever sampling an atom id between texels.
 * - `build/politics/index.json`: which tiles were written, the label of every uniform
 *   one, and each written tile's palette (local slot → atom label).
 * - `build/politics/data.json`: atoms, polities, claims, relations and sources — the
 *   time series the engine turns into per-year colour tables, and what the inspector
 *   shows on a click.
 *
 * Tiles are addressed like terrain nodes and share their texel grid; deeper terrain
 * reads a window of its MAX_LEVEL ancestor. Atom outlines are ~1 km (simplified at
 * 0.01° in cicero-map), so 431 m texels at level 6 already carry all they know.
 *
 * Needs the coast mask (npm run water -w pipeline): land and sea come from it, so a
 * fill stops exactly where the drawn coast does.
 *
 *   npm run politics -w pipeline
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'
import { DATA_RECT, TILE_TEXELS, tileRect } from '@roman-map/world'
import { formatYear, type Endpoint } from '@roman-map/schema'
import { loadDataset } from '../load.ts'
import { edgesTouch, inside, type Ring } from '../water/raster.ts'
import { RingIndex } from '../water/ring-index.ts'
import { projectRing } from '../water/sources.ts'
import type { AtomRings, PoliticsJob, PoliticsResult, ShoreTile } from './bake-worker.ts'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const OUT = join(ROOT_DIR, 'build/politics')
const WATER = join(ROOT_DIR, 'build/water')

const MAX_LEVEL = 6
/** Reach of the distance field, in texels: 21 km at level 6, room for a wide glow close in. */
const DISTANCE_TEXELS = 48
const SUPERSAMPLE = 2
/** Label 0 is land no atom covers. */
const UNCLAIMED = 0
/**
 * The open sea. 2047 so every label is an exact half float (the engine carries labels
 * in half-float textures, exact to 2048); atoms are 1…2046.
 */
const SEA = 2047
/** Index value of a tile that was written. */
const BAKED = 0xffff

type LabelledRing = Ring & { label: number }

async function main() {
  const t0 = Date.now()
  const data = loadDataset()
  if (data.atoms.length > SEA - 1) throw new Error(`${data.atoms.length} atoms; labels stop at ${SEA - 1}`)
  if (!existsSync(join(WATER, 'index.json'))) throw new Error('no coast mask: run npm run water -w pipeline first')
  const water = JSON.parse(readFileSync(join(WATER, 'index.json'), 'utf8')) as {
    maxLevel: number
    distanceTexels: number
    codes: string[]
  }
  const waterCodes = water.codes.map((b) => new Uint8Array(Buffer.from(b, 'base64')))
  if (water.maxLevel < MAX_LEVEL) throw new Error(`coast mask stops at level ${water.maxLevel}`)

  // Labels follow atoms.yaml order; data.json records the mapping.
  const rings: LabelledRing[] = []
  let polygon = 0
  data.atoms.forEach((atom, k) => {
    const geom = data.geometry.atoms.get(atom.id)
    if (!geom) throw new Error(`atom ${atom.id} has no geometry`)
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
    for (const poly of polys) {
      const id = polygon++
      for (const ring of poly) rings.push({ ...projectRing(ring, id, Infinity), label: k + 1 })
    }
  })
  const index = new RingIndex(rings)
  console.log(`${data.atoms.length} atoms, ${rings.length} rings`)

  const pool = new Pool(Math.max(1, availableParallelism() - 2))
  const levels: Uint16Array[] = []
  const palettes: Record<string, number[]> = {}
  const writes: Promise<void>[] = []
  let written = 0
  let bytes = 0
  for (let level = 0; level <= MAX_LEVEL; level++) {
    const n = 2 ** level
    const grid = new Uint16Array(n * n).fill(SEA)
    const parent = levels[level - 1]
    const tl = Date.now()
    let baked = 0
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const { x0, y0, size } = tileRect({ level, i, j })
        if (x0 > DATA_RECT.maxX || x0 + size < DATA_RECT.minX) continue
        if (y0 > DATA_RECT.maxY || y0 + size < DATA_RECT.minY) continue
        // A uniform parent has no boundary within twice this level's clamp of it.
        if (parent) {
          const p = parent[(j >> 1) * (n >> 1) + (i >> 1)]
          if (p !== BAKED) {
            grid[j * n + i] = p
            continue
          }
        }
        const step = size / (TILE_TEXELS - 1)
        const m = (DISTANCE_TEXELS + 1) * step
        const rect = [x0 - m, y0 - m, x0 + size + m, y0 + size + m] as const
        const here = index.query(...rect) as LabelledRing[]
        const shore: ShoreTile[] = []
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = i + di
            const jj = j + dj
            const code = ii < 0 || jj < 0 || ii >= n || jj >= n ? 0 : waterCodes[level][jj * n + ii]
            const file = join(WATER, `${level}/${ii}/${jj}.webp`)
            shore.push(code === 2 && existsSync(file) ? { code, file } : { code })
          }
        }
        // Settled without a bake: open sea, or land with no outline edge near it.
        if (!edgesTouch(here, ...rect)) {
          if (shore.every((s) => s.code === 0)) continue
          if (shore.every((s) => s.code === 1 || s.code === 3)) {
            const cx = x0 + size / 2
            const cy = y0 + size / 2
            const labels = [...new Set(here.map((r) => r.label))]
            grid[j * n + i] =
              labels.find((l) => inside(here.filter((r) => r.label === l), cx, cy)) ?? UNCLAIMED
            continue
          }
        }
        const atoms = new Map<number, Ring[]>()
        for (const r of here) {
          let list = atoms.get(r.label)
          if (!list) atoms.set(r.label, (list = []))
          list.push(r)
        }
        const job: Omit<PoliticsJob, 'id'> = {
          x0,
          y0,
          step,
          atoms: [...atoms].map(([label, rs]): AtomRings => ({ label, rings: rs })),
          shore,
          shoreTexels: water.distanceTexels,
          distanceTexels: DISTANCE_TEXELS,
          supersample: SUPERSAMPLE,
          unclaimed: UNCLAIMED,
          sea: SEA,
        }
        grid[j * n + i] = BAKED
        writes.push(
          pool.run(job).then((r) => {
            if ('uniform' in r) {
              grid[j * n + i] = r.uniform
              return
            }
            const file = join(OUT, `${level}/${i}/${j}.webp`)
            mkdirSync(dirname(file), { recursive: true })
            writeFileSync(file, r.image)
            palettes[`${level}/${i}/${j}`] = r.palette
            baked++
            written++
            bytes += r.image.length
          }),
        )
        while (pool.backlog > 64) await new Promise((r) => setTimeout(r, 20))
      }
    }
    await Promise.all(writes)
    levels.push(grid)
    console.log(`level ${level}: ${baked} tiles, ${((Date.now() - tl) / 1000).toFixed(1)} s`)
  }
  await pool.close()

  writeFileSync(
    join(OUT, 'index.json'),
    JSON.stringify({
      _comment:
        'Political field tiles. levels[level] is base64 of a little-endian uint16 grid, 2^level × 2^level, row j north from the root, column i east: the label of a uniform tile, or 65535 for a tile written as {level}/{i}/{j}.webp. In a written tile, channel 0 and 1 are palette slots of the lower and higher label either side of the nearest boundary, and channel 2 the signed distance to that boundary on a square-root scale — with u = v / 127.5 - 1, it decodes to texels as sign(u) * u² * distanceTexels, positive on the higher label\'s side. Both labels equal means no boundary within the clamp. Image row 0 is the north edge.',
      texels: TILE_TEXELS,
      maxLevel: MAX_LEVEL,
      distanceTexels: DISTANCE_TEXELS,
      unclaimed: UNCLAIMED,
      sea: SEA,
      levels: levels.map((g) => Buffer.from(g.buffer).toString('base64')),
      palettes,
    }),
  )
  writeFileSync(join(OUT, 'data.json'), JSON.stringify(timeSeries(data)))
  console.log(`wrote ${written} tiles, ${(bytes / 1e6).toFixed(1)} MB, in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
}

/** What the engine needs to colour the map for a year and to explain a click. */
function timeSeries(data: ReturnType<typeof loadDataset>) {
  const end = (e: Endpoint) => ({ year: e.year, text: e.text })
  const preferred = (id: string) =>
    data.names.find((n) => n.target.kind === 'polity' && n.target.id === id && n.preferred)?.text ??
    data.names.find((n) => n.target.kind === 'polity' && n.target.id === id)?.text ??
    id
  const years = data.claims.flatMap((c) => [c.from.year, c.to.year])
  const window = [Math.min(...years), Math.max(...years)]
  return {
    _comment:
      'Years are astronomical (1 BCE = 0). Atom labels are 1-based positions in `atoms`; 0 is unclaimed land, `sea` the open sea.',
    window,
    windowText: window.map((y) => formatYear(y)),
    sea: SEA,
    atoms: data.atoms.map((a) => ({ id: a.id, evidence: a.evidence, confidence: a.confidence })),
    polities: data.polities.map((p) => ({
      id: p.id,
      kind: p.kind,
      name: preferred(p.id),
      // Dated preferred names, for a polity renamed inside the window; the engine picks by year.
      names: data.names
        .filter((n) => n.target.kind === 'polity' && n.target.id === p.id && n.preferred)
        .map((n) => ({ text: n.text, from: n.from.year, to: n.to.year })),
      ruler: p.ruler,
    })),
    claims: data.claims.map((c) => ({
      atom: c.atom,
      polity: c.polity,
      relation: c.relation,
      from: end(c.from),
      to: end(c.to),
      confidence: c.confidence,
      review: c.review,
      sources: c.sources,
      note: c.note,
    })),
    relations: data.relations.map((r) => ({
      polity: r.polity,
      type: r.type,
      of: r.of,
      from: end(r.from),
      to: end(r.to),
    })),
    sources: Object.fromEntries(data.sources.map((s) => [s.id, { citation: s.citation, url: s.url }])),
  }
}

class Pool {
  private idle: Worker[] = []
  private workers: Worker[] = []
  private waiting: [PoliticsJob, (r: PoliticsResult) => void][] = []
  private pending = new Map<number, (r: PoliticsResult) => void>()
  private nextId = 1

  constructor(size: number) {
    for (let k = 0; k < size; k++) {
      const w = new Worker(new URL('./bake-worker.ts', import.meta.url))
      w.on('message', (r: PoliticsResult) => {
        this.pending.get(r.id)!(r)
        this.pending.delete(r.id)
        const next = this.waiting.shift()
        if (next) this.send(w, ...next)
        else this.idle.push(w)
      })
      w.on('error', (e) => {
        console.error(e)
        process.exit(1)
      })
      this.workers.push(w)
      this.idle.push(w)
    }
  }

  get backlog() {
    return this.waiting.length
  }

  run(job: Omit<PoliticsJob, 'id'>): Promise<PoliticsResult> {
    return new Promise((resolve) => {
      const full = { ...job, id: this.nextId++ }
      const w = this.idle.pop()
      if (w) this.send(w, full, resolve)
      else this.waiting.push([full, resolve])
    })
  }

  private send(w: Worker, job: PoliticsJob, resolve: (r: PoliticsResult) => void) {
    this.pending.set(job.id, resolve)
    w.postMessage(job)
  }

  close() {
    return Promise.all(this.workers.map((w) => w.terminate()))
  }
}

await main()
