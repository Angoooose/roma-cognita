/**
 * npm run derive-floodplains -w pipeline
 *
 * Derives the floodplain polygons of data/geometry/features.geojson from terrain,
 * and writes the authored Nile delta branches beside them. Run offline, once,
 * whenever a hull, a threshold or a branch waypoint changes; the output is
 * committed and validated like any other geometry. The records that own these
 * shapes — names, dates, sources, reasoning — are in data/features.yaml.
 *
 * For each region in regions.ts:
 *
 *  1. Mosaic Mapterhorn terrain (Terrarium, z10, ~70 m) over the hull's box.
 *  2. Rasterise the modern land (OSM land polygons), the natural lakes
 *     (HydroLAKES ≥ 1 km²), the hull, and the hulls of earlier regions.
 *  3. Channels: modern main stems from HydroRIVERS, or — for the delta — the
 *     seven ancient branches, built here from delta-branches.ts.
 *  4. Channel datum: along each channel, the floodplain surface beside it (the
 *     30th percentile of the DEM within ~800 m — see channelSurface for why not
 *     the water), a running median over ~2.7 km and a running minimum downstream.
 *  5. HAND: every pixel minus the surface of its nearest channel pixel; keep
 *     ground at most `maxHeight` above it. (Or, for the Fayum, an elevation band.)
 *  6. Clean: majority smoothing (σ ≈ 1 px), drop specks, fill enclosed gaps —
 *     villages and towns stand up on the DSM — then clip to land and cut lakes.
 *  7. Vectorise with marching squares (d3-contour), simplify (Douglas–Peucker,
 *     60 m, in the equal-area plane), rewind to RFC 7946, write lon/lat.
 *
 * It prints its own doubt: the area of every region beside the published
 * figures it should be near, the thresholds, where the check sites fell, and
 * anything that looked wrong. Previews go to --preview <dir> (default: the
 * scratchpad path below, or FLOODPLAIN_PREVIEW_DIR).
 *
 *   npm run derive-floodplains -w pipeline                 all regions
 *   npm run derive-floodplains -w pipeline -- nile-delta   regions whose id contains it
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { contours } from 'd3-contour'
import { projection } from '@roma-cognita/world'
import type { AreaGeometry } from '@roma-cognita/schema'
import { rewindRFC7946, ringProblems } from '../geo.ts'
import { DATA_DIR } from '../load.ts'
import { BRANCHES, type Branch } from './delta-branches.ts'
import { type Bbox, type Raster, lonLatToPixel, pixelMetres, pixelToLonLat, readDem } from './dem.ts'
import {
  type Pt,
  blur,
  catmullRom,
  components,
  fillRings,
  leastCostPath,
  linePixels,
  minFilter,
  nearestSeed,
  simplifyIndices,
} from './grid.ts'
import { type Overlay, renderPreview } from './preview.ts'
import { REGIONS, type Region } from './regions.ts'
import { type Channel, readLakes, readLand, readRivers } from './sources.ts'

const OUT = join(DATA_DIR, 'geometry/features.geojson')
const SIMPLIFY_M = 60
const argv = process.argv.slice(2)
const previewFlag = argv.indexOf('--preview')
const PREVIEW_DIR =
  previewFlag >= 0
    ? argv[previewFlag + 1]
    : (process.env.FLOODPLAIN_PREVIEW_DIR ??
      '/private/tmp/claude-501/-Users-angus-Documents-GitHub-claude/1a178eb0-273d-4d69-9b0a-3a6d43e7f9d5/scratchpad/floodplains')
const filters = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--preview')

const doubts: string[] = []
const T0 = Date.now()
const tick = (what: string) => console.log(`  [${((Date.now() - T0) / 1000).toFixed(0)} s] ${what}`)
const doubt = (s: string) => {
  doubts.push(s)
  console.log(`  DOUBT: ${s}`)
}

// --- helpers -----------------------------------------------------------------

const bboxOf = (pts: Pt[], margin = 0): Bbox => ({
  west: Math.min(...pts.map((p) => p[0])) - margin,
  east: Math.max(...pts.map((p) => p[0])) + margin,
  south: Math.min(...pts.map((p) => p[1])) - margin,
  north: Math.max(...pts.map((p) => p[1])) + margin,
})

const toPx = (dem: Raster, [lon, lat]: Pt): Pt => {
  const [x, y] = lonLatToPixel(dem.z, lon, lat)
  return [x - dem.x0, y - dem.y0]
}
const toLonLat = (dem: Raster, [x, y]: Pt): Pt => pixelToLonLat(dem.z, x + dem.x0, y + dem.y0)
const centre = (dem: Raster, p: number): Pt => [(p % dem.width) + 0.5, Math.floor(p / dem.width) + 0.5]

/** Area of one pixel in km², by row. */
const rowAreas = (dem: Raster) =>
  Float64Array.from({ length: dem.height }, (_, j) => (pixelMetres(dem.z, dem.y0 + j + 0.5) / 1000) ** 2)

function maskArea(mask: Uint8Array, dem: Raster, rows = rowAreas(dem)) {
  let a = 0
  for (let p = 0; p < mask.length; p++) if (mask[p]) a += rows[(p / dem.width) | 0]
  return a
}

function rasterise(dem: Raster, rings: Pt[][]): Uint8Array {
  const m = new Uint8Array(dem.width * dem.height)
  fillRings(m, dem.width, dem.height, rings.map((r) => r.map((p) => toPx(dem, p))))
  return m
}

/** Nearest index on a polyline (by vertex) to a point. */
function nearestVertex(line: Pt[], p: Pt): number {
  let best = 0
  let bd = Infinity
  line.forEach(([x, y], k) => {
    const d = (x - p[0]) ** 2 + (y - p[1]) ** 2
    if (d < bd) (bd = d), (best = k)
  })
  return best
}

/** Planar (Albers, equal-area) distance in km between lon/lat points. */
const kmBetween = (a: Pt, b: Pt) => {
  const [ax, ay] = projection.forward(a[0], a[1])
  const [bx, by] = projection.forward(b[0], b[1])
  return Math.hypot(ax - bx, ay - by) / 1000
}

function running<T extends number>(values: T[], half: number, f: (w: number[]) => number): number[] {
  return values.map((_, k) => f(values.slice(Math.max(0, k - half), k + half + 1)))
}
const median = (w: number[]) => {
  const s = [...w].sort((a, b) => a - b)
  return s[s.length >> 1]
}

// --- delta branches ----------------------------------------------------------

interface BuiltBranch {
  branch: Branch
  px: Pt[]
  lonlat: Pt[]
  /**
   * Per vertex: is the segment ending here our interpolation between sites (a spline
   * leg) rather than a channel that exists on the ground (a Rosetta or traced leg)?
   * The map draws the two differently, so a guess never looks like a survey.
   */
  recon: boolean[]
  trimmedKm: number
}

/** A pixel near `p` on the lowest ground (the water surface of a modern channel). */
function snapLow(dem: Raster, p: Pt, radius = 15): number {
  const [x, y] = p
  let best = -1
  let bv = Infinity
  for (let j = Math.floor(y) - radius; j <= Math.floor(y) + radius; j++) {
    for (let i = Math.floor(x) - radius; i <= Math.floor(x) + radius; i++) {
      if (i < 0 || j < 0 || i >= dem.width || j >= dem.height) continue
      const v = dem.data[j * dem.width + i] + 0.02 * Math.hypot(i - x, j - y)
      if (v < bv) (bv = v), (best = j * dem.width + i)
    }
  }
  return best
}

function buildBranches(dem: Raster, land: Uint8Array): BuiltBranch[] {
  const bbox = bboxOf(REGIONS.find((r) => r.id === 'nile-delta-floodplain')!.hull)
  const rosettaChains = readRivers('af', bbox, 500)
  const rosetta = rosettaChains.sort((a, b) => b.line.length - a.line.length)[0].line.map((p) => toPx(dem, p))
  // Cost for tracing modern channels: cheap on the lowest ground within ~800 m.
  const low = minFilter(dem.data, dem.width, dem.height, 12)
  const cost = new Float32Array(dem.data.length)
  for (let p = 0; p < cost.length; p++) cost[p] = 1 + 30 * Math.max(0, dem.data[p] - low[p])

  const built = new Map<string, BuiltBranch>()
  const order = [...BRANCHES].sort((a, b) => (a.joinsFrom ? 1 : 0) - (b.joinsFrom ? 1 : 0))
  // Parents before children, however the list is written.
  const pending = [...order]
  while (pending.length) {
    const k = pending.findIndex((b) => !b.joinsFrom || built.has(b.joinsFrom))
    if (k < 0) throw new Error('delta branches: a joinsFrom cycle or unknown parent')
    const b = pending.splice(k, 1)[0]
    const wps = b.waypoints.map((w) => ({ ...w, px: toPx(dem, w.at) }))
    if (b.joinsFrom) {
      const parent = built.get(b.joinsFrom)!.px
      wps[0].px = parent[nearestVertex(parent, wps[0].px)]
    }
    const line: Pt[] = [wps[0].px]
    const recon: boolean[] = [false]
    const push = (pts: Pt[], guessed: boolean) => {
      for (const p of pts) {
        line.push(p)
        recon.push(guessed)
      }
    }
    let cur = wps[0].px
    for (let k = 1; k < wps.length; ) {
      const via = wps[k].via ?? 'spline'
      if (via === 'rosetta') {
        const i0 = nearestVertex(rosetta, cur)
        const i1 = nearestVertex(rosetta, wps[k].px)
        const seg = i0 <= i1 ? rosetta.slice(i0, i1 + 1) : rosetta.slice(i1, i0 + 1).reverse()
        push(seg, false)
        cur = seg[seg.length - 1]
        k++
      } else if (via === 'trace') {
        const s = snapLow(dem, cur)
        const t = snapLow(dem, wps[k].px)
        const [si, sj] = [s % dem.width, (s / dem.width) | 0]
        const [ti, tj] = [t % dem.width, (t / dem.width) | 0]
        const pad = 60
        const path = leastCostPath(cost, dem.width, s, t, [
          Math.max(0, Math.min(si, ti) - pad),
          Math.max(0, Math.min(sj, tj) - pad),
          Math.min(dem.width - 1, Math.max(si, ti) + pad),
          Math.min(dem.height - 1, Math.max(sj, tj) + pad),
        ]).map((p) => centre(dem, p))
        const keep = simplifyIndices(path, 0.75).map((i) => path[i])
        push(keep, false)
        cur = keep[keep.length - 1]
        k++
      } else {
        const run: Pt[] = [cur]
        while (k < wps.length && (wps[k].via ?? 'spline') === 'spline') run.push(wps[k++].px)
        const curve = catmullRom(run, 16)
        push(curve.slice(1), true)
        cur = run[run.length - 1]
      }
    }
    // Trim the mouth where it leaves modern land: the coast and the lagoons are modern.
    let end = line.length - 1
    const onLand = ([x, y]: Pt) => {
      const i = Math.floor(x)
      const j = Math.floor(y)
      return i >= 0 && j >= 0 && i < dem.width && j < dem.height && land[j * dem.width + i] === 1
    }
    while (end > 1 && !onLand(line[end])) end--
    const trimmed = line.slice(end)
    const px = line.slice(0, end + 1)
    const lonlat = px.map((p) => toLonLat(dem, p))
    let trimmedKm = 0
    for (let k = 1; k < trimmed.length; k++)
      trimmedKm += kmBetween(toLonLat(dem, trimmed[k - 1]), toLonLat(dem, trimmed[k]))
    built.set(b.id, { branch: b, px, lonlat, recon: recon.slice(0, end + 1), trimmedKm })
  }
  return BRANCHES.map((b) => built.get(b.id)!)
}

// --- one region --------------------------------------------------------------

interface Result {
  region: Region
  geometry: AreaGeometry
  branches: BuiltBranch[]
  areaKm2: number
}

/**
 * The floodplain surface beside a channel: at each channel pixel, the 30th
 * percentile of the DEM within ~800 m, then a running median along the channel
 * (~2.7 km) and a running minimum downstream.
 *
 * Not the water surface. A modern channel's water in the DEM sits several metres
 * below its banks, while an ancient branch that no longer carries water has no
 * such trench; measuring from the water would put the modern channels' floodplain
 * metres "higher" than the ancient branches' and the delta would come out
 * lopsided again. The ground beside the channel is the same datum for both.
 */
const SURFACE_RADIUS_PX = 20
const SURFACE_PERCENTILE = 0.5
function channelSurface(dem: Raster, pixels: number[]): number[] {
  const w = dem.width
  const r = SURFACE_RADIUS_PX
  const win: number[] = []
  const raw = pixels.map((p) => {
    const i = p % w
    const j = (p / w) | 0
    win.length = 0
    for (let dj = -r; dj <= r; dj += 2)
      for (let di = -r; di <= r; di += 2) {
        if (di * di + dj * dj > r * r) continue
        const ii = i + di
        const jj = j + dj
        if (ii >= 0 && jj >= 0 && ii < w && jj < dem.height) win.push(dem.data[jj * w + ii])
      }
    win.sort((a, b) => a - b)
    return win[Math.floor(win.length * SURFACE_PERCENTILE)]
  })
  const smooth = running(raw, 20, median)
  for (let k = 1; k < smooth.length; k++) smooth[k] = Math.min(smooth[k], smooth[k - 1])
  return smooth
}

async function deriveRegion(region: Region, previous: Region[]): Promise<Result> {
  console.log(`\n${region.id} — ${region.label}`)
  const bbox = bboxOf(region.hull, 0.05)
  const dem = await readDem(bbox, region.z, console.log)
  const n = dem.width * dem.height
  const rows = rowAreas(dem)

  tick('DEM read')
  const land = rasterise(dem, readLand(bbox))
  const lakes = readLakes(bbox)
  const lake = rasterise(dem, lakes.flatMap((l) => l.rings))
  for (let p = 0; p < n; p++) if (lake[p]) land[p] = 0
  const hull = rasterise(dem, [region.hull])
  for (const r of previous) {
    const other = rasterise(dem, [r.hull])
    for (let p = 0; p < n; p++) if (other[p]) hull[p] = 0
  }
  console.log(`  hull ${maskArea(hull, dem, rows).toFixed(0)} km² after earlier regions; ${lakes.length} lakes ≥ 1 km² cut`)

  tick('land, lakes, hulls rasterised')
  // Channels.
  const channels: { label: string; px: Pt[]; style: Overlay['channels'][number]['style'] }[] = []
  let branches: BuiltBranch[] = []
  for (const spec of region.channels) {
    if (spec.kind === 'delta-branches') {
      branches = buildBranches(dem, land)
      for (const b of branches)
        channels.push({ label: b.branch.id, px: b.px, style: b.branch.confidence })
    } else {
      const lines = readRivers(spec.region, bbox, spec.minQ)
      for (const c of lines) {
        const pieces = clipLine(c, spec.clip)
        for (const piece of pieces) channels.push({ label: c.label, px: piece.map((p) => toPx(dem, p)), style: 'modern' })
      }
    }
  }
  if (!channels.length && region.method.kind === 'hand') throw new Error(`${region.id}: no channels`)

  const seedPixels: number[] = []
  const seedHeight: number[] = []
  for (const c of channels) {
    const pix = linePixels(c.px, dem.width, dem.height)
    if (pix.length < 2) continue
    const surf = channelSurface(dem, pix)
    seedPixels.push(...pix)
    seedHeight.push(...surf)
  }

  tick(`${channels.length} channels, ${seedPixels.length} channel pixels`)
  // Candidate floodplain.
  const cand = new Uint8Array(n)
  let hand: Float32Array | null = null
  if (region.method.kind === 'hand') {
    const { nearest } = nearestSeed(dem.width, dem.height, Int32Array.from(seedPixels))
    hand = new Float32Array(n)
    const slope = region.method.maxSlope !== undefined ? slopeOf(dem) : null
    const maxSlope = region.method.maxSlope ?? Infinity
    for (let p = 0; p < n; p++) {
      const s = nearest[p]
      hand[p] = s < 0 ? Infinity : dem.data[p] - seedHeight[s]
      if (hull[p] && land[p] && hand[p] <= region.method.maxHeight && (!slope || slope[p] <= maxSlope))
        cand[p] = 1
    }
    if (slope && region.method.closeKm) {
      const r = (region.method.closeKm * 1000) / pixelMetres(dem.z, dem.y0 + dem.height / 2)
      const closed = close(cand, dem.width, dem.height, r)
      for (let p = 0; p < n; p++)
        cand[p] = closed[p] && hull[p] && land[p] && hand[p] <= region.method.maxHeight ? 1 : 0
    }
  } else {
    const { min, max } = region.method
    for (let p = 0; p < n; p++) {
      const h = dem.data[p]
      if (hull[p] && land[p] && h >= min && h <= max) cand[p] = 1
    }
  }
  const rawArea = maskArea(cand, dem, rows)
  tick('candidate')

  // Clean.
  const mask = majority(cand, dem)
  const speckPx = (km2: number, p: number) => km2 / rows[(p / dem.width) | 0]
  let specks = 0
  components(mask, dem.width, dem.height, 1, (pix, count) => {
    if (count < speckPx(region.clean.minSpeckKm2, pix[0])) {
      for (const p of pix) mask[p] = 0
      specks++
    }
  })
  let holes = 0
  let biggestKept = 0
  components(mask, dem.width, dem.height, 0, (pix, count, edge) => {
    if (edge) return
    if (count < speckPx(region.clean.maxHoleKm2, pix[0])) {
      for (const p of pix) mask[p] = 1
      holes++
    } else biggestKept = Math.max(biggestKept, count * rows[(pix[0] / dem.width) | 0])
  })
  for (let p = 0; p < n; p++) if (!land[p] || !hull[p]) mask[p] = 0
  components(mask, dem.width, dem.height, 1, (pix, count) => {
    if (count < speckPx(region.clean.minSpeckKm2, pix[0])) for (const p of pix) mask[p] = 0
  })
  const areaPx = maskArea(mask, dem, rows)
  console.log(
    `  raw ${rawArea.toFixed(0)} km² → cleaned ${areaPx.toFixed(0)} km² (${specks} specks dropped, ${holes} gaps filled; largest gap kept ${biggestKept.toFixed(1)} km²)`,
  )

  tick('cleaned')
  const geometry = vectorise(mask, dem)
  tick('vectorised')
  const areaKm2 = geometryArea(geometry)

  // --- doubt ---
  const m = region.method
  console.log(
    `  method: ${m.kind === 'hand' ? `HAND ≤ ${m.maxHeight} m${m.maxSlope ? `, slope ≤ ${(m.maxSlope * 100).toFixed(3)}%` : ''}` : `elevation ${m.min} m to ${m.max} m`}; clean: specks < ${region.clean.minSpeckKm2} km², gaps < ${region.clean.maxHoleKm2} km²`,
  )
  console.log(`  area ${areaKm2.toFixed(0)} km² (polygon, equal-area) — ${geometry.coordinates.length} polygons`)
  for (const pub of region.published) {
    const verdict = areaKm2 < pub.lowKm2 ? 'BELOW' : areaKm2 > pub.highKm2 ? 'ABOVE' : 'within'
    console.log(
      `    vs ${pub.label}: ${pub.lowKm2}–${pub.highKm2} km² → ${verdict}${pub.checked ? '' : ' (figure not checked against the work)'}`,
    )
    if (verdict !== 'within') doubt(`${region.id}: area ${areaKm2.toFixed(0)} km² is ${verdict} ${pub.label} (${pub.lowKm2}–${pub.highKm2})`)
  }
  const polys = geometry.coordinates as Pt[][][]
  const verdicts = region.sites.map((s) => {
    const inside = polys.some(([outer, ...hs]) => inRing(s.at, outer) && !hs.some((h) => inRing(s.at, h)))
    const dist = inside ? 0 : Math.min(...polys.flatMap((poly) => poly.map((r) => distToRing(s.at, r))))
    const [x, y] = toPx(dem, s.at)
    const p = Math.floor(y) * dem.width + Math.floor(x)
    const h = dem.data[p]
    const hh = hand ? hand[p] : NaN
    const got = inside ? 'in' : dist <= 1.5 ? 'edge' : 'out'
    const ok = got === s.expect || (s.expect === 'edge' && dist <= 3) || (got === 'edge' && s.expect !== 'out')
    const line = `${s.name}: ${inside ? 'inside' : `${dist.toFixed(1)} km outside`}; ground ${h.toFixed(1)} m${hand ? `, ${hh.toFixed(1)} m above channel` : ''} (expected ${s.expect})`
    console.log(`    site ${ok ? '  ' : '✗ '}${line}`)
    if (!ok) doubt(`${region.id}: ${line}`)
    return { name: s.name, at: s.at, verdict: inside ? '✓' : `${dist.toFixed(1)} km` }
  })
  for (const b of branches) {
    if (b.trimmedKm > 0.5) console.log(`    ${b.branch.id}: mouth trimmed ${b.trimmedKm.toFixed(1)} km at the modern shore`)
    for (const w of b.branch.waypoints) {
      if (w.via === 'trace' || w.via === 'rosetta') continue
      const d = Math.min(...b.lonlat.map((q) => kmBetween(q, w.at)))
      if (d > 1) console.log(`    ${b.branch.id}: waypoint ${w.prov} is ${d.toFixed(1)} km from the line (snapped or trimmed)`)
    }
  }

  // --- previews ---
  if (PREVIEW_DIR) {
    mkdirSync(PREVIEW_DIR, { recursive: true })
    const overlay: Overlay = {
      polygons: polys,
      hull: region.hull,
      channels: channels.map((c) => ({ line: c.px.map((p) => toLonLat(dem, p)), style: c.style })),
      sites: verdicts,
      caption: [
        `${region.label} — ${m.kind === 'hand' ? `HAND ≤ ${m.maxHeight} m${m.maxSlope ? `, slope ≤ ${(m.maxSlope * 100).toFixed(3)}%` : ''}` : `${m.min}…${m.max} m`}`,
        `${areaKm2.toFixed(0)} km²; published ${region.published.map((p) => `${p.lowKm2}–${p.highKm2}`).join(', ')}`,
      ],
    }
    const views = region.views ?? [bboxOf(region.hull)]
    for (const [k, v] of views.entries()) {
      const file = join(PREVIEW_DIR, `${region.id}${views.length > 1 ? `-${k + 1}` : ''}.png`)
      await renderPreview(dem, v, overlay, file)
      console.log(`  preview ${file}`)
    }
  }
  return { region, geometry, branches, areaKm2 }
}

/** Morphological closing by radius r px: dilate, then erode, by exact distance. */
function close(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const r2 = r * r
  const on: number[] = []
  for (let p = 0; p < mask.length; p++) if (mask[p]) on.push(p)
  const d1 = nearestSeed(width, height, Int32Array.from(on)).dist2
  const dilated = new Uint8Array(mask.length)
  const off: number[] = []
  for (let p = 0; p < mask.length; p++) {
    if (d1[p] <= r2) dilated[p] = 1
    else off.push(p)
  }
  const d2 = nearestSeed(width, height, Int32Array.from(off)).dist2
  const out = new Uint8Array(mask.length)
  for (let p = 0; p < mask.length; p++) out[p] = dilated[p] && d2[p] > r2 ? 1 : 0
  return out
}

/** Rise over run of the terrain smoothed over ~1 km, by central differences ±1 km. */
function slopeOf(dem: Raster): Float32Array {
  const r = 15
  const sm = blur(dem.data, dem.width, dem.height, r)
  const out = new Float32Array(sm.length)
  const w = dem.width
  for (let j = 0; j < dem.height; j++) {
    const run = 2 * r * pixelMetres(dem.z, dem.y0 + j)
    const ju = Math.max(0, j - r)
    const jd = Math.min(dem.height - 1, j + r)
    for (let i = 0; i < w; i++) {
      const dx = sm[j * w + Math.min(w - 1, i + r)] - sm[j * w + Math.max(0, i - r)]
      const dy = sm[jd * w + i] - sm[ju * w + i]
      out[j * w + i] = Math.hypot(dx, dy) / run
    }
  }
  return out
}

function clipLine(c: Channel, clip?: Bbox): Pt[][] {
  if (!clip) return [c.line]
  const out: Pt[][] = []
  let cur: Pt[] = []
  for (const p of c.line) {
    const inside = p[0] >= clip.west && p[0] <= clip.east && p[1] >= clip.south && p[1] <= clip.north
    if (inside) cur.push(p)
    else if (cur.length) out.push(cur), (cur = [])
  }
  if (cur.length >= 2) out.push(cur)
  return out.filter((l) => l.length >= 2)
}

/** Majority smoothing: blur the 0/1 mask at σ ≈ 1 px and keep > ½. Removes pixel noise, keeps shape. */
function majority(mask: Uint8Array, dem: Raster): Uint8Array {
  const f = new Float32Array(mask.length)
  for (let p = 0; p < mask.length; p++) f[p] = mask[p]
  const b = blur(f, dem.width, dem.height, 1)
  const out = new Uint8Array(mask.length)
  for (let p = 0; p < mask.length; p++) out[p] = b[p] > 0.5 ? 1 : 0
  return out
}

function vectorise(mask: Uint8Array, dem: Raster): AreaGeometry {
  // Crop to the mask with a margin so the contour closes inside the grid.
  let i0 = dem.width
  let j0 = dem.height
  let i1 = -1
  let j1 = -1
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue
    const i = p % dem.width
    const j = (p / dem.width) | 0
    i0 = Math.min(i0, i)
    i1 = Math.max(i1, i)
    j0 = Math.min(j0, j)
    j1 = Math.max(j1, j)
  }
  if (i1 < 0) throw new Error('empty floodplain')
  const pad = 2
  const w = i1 - i0 + 1 + 2 * pad
  const h = j1 - j0 + 1 + 2 * pad
  const values = new Float32Array(w * h)
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) values[(j - j0 + pad) * w + (i - i0 + pad)] = mask[j * dem.width + i]
  const smooth = blur(values, w, h, 1)
  const [mp] = contours().size([w, h]).thresholds([0.5])(smooth as unknown as number[])
  const polys: Pt[][][] = []
  for (const poly of mp.coordinates as Pt[][][]) {
    const rings: Pt[][] = []
    for (const [ri, ring] of poly.entries()) {
      const ll = ring.map(([x, y]) => toLonLat(dem, [x + i0 - pad, y + j0 - pad]))
      const s = simplifyRing(ll)
      if (s.length < 4) continue
      const a = Math.abs(ringArea(s))
      if (ri === 0 && a < 0.5) break // an exterior too small after simplifying: drop the polygon
      if (ri > 0 && a < 0.5) continue
      rings.push(s)
    }
    if (rings.length) polys.push(rings)
  }
  const g = rewindRFC7946({ type: 'MultiPolygon', coordinates: polys } as AreaGeometry)
  const problems = ringProblems(g)
  if (problems.length) throw new Error(`vectorised geometry is unsound: ${JSON.stringify(problems.slice(0, 3))}`)
  return g
}

const round = (v: number) => Math.round(v * 1e5) / 1e5

function simplifyRing(ring: Pt[]): Pt[] {
  const planar = ring.map(([lon, lat]) => projection.forward(lon, lat) as Pt)
  const keep = simplifyIndices(planar, SIMPLIFY_M)
  const out: Pt[] = []
  for (const k of keep) {
    const p: Pt = [round(ring[k][0]), round(ring[k][1])]
    const last = out[out.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
  }
  if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push(out[0])
  return out
}

/** Signed area in km² in the equal-area plane. */
function ringArea(ring: Pt[]): number {
  let s = 0
  const p = ring.map(([lon, lat]) => projection.forward(lon, lat))
  for (let k = 0; k + 1 < p.length; k++) s += p[k][0] * p[k + 1][1] - p[k + 1][0] * p[k][1]
  return s / 2 / 1e6
}

function geometryArea(g: AreaGeometry): number {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  let a = 0
  for (const poly of polys) poly.forEach((r, i) => (a += (i === 0 ? 1 : -1) * Math.abs(ringArea(r as Pt[]))))
  return a
}

function inRing([x, y]: Pt, ring: Pt[]): boolean {
  let hit = false
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[i + 1]
    if (y0 > y !== y1 > y && x < ((x1 - x0) * (y - y0)) / (y1 - y0) + x0) hit = !hit
  }
  return hit
}

function distToRing(p: Pt, ring: Pt[]): number {
  const [px, py] = projection.forward(p[0], p[1])
  let best = Infinity
  const q = ring.map(([lon, lat]) => projection.forward(lon, lat))
  for (let k = 0; k + 1 < q.length; k++) {
    const [ax, ay] = q[k]
    const [bx, by] = q[k + 1]
    const dx = bx - ax
    const dy = by - ay
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
    best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy))
  }
  return best / 1000
}

// --- main --------------------------------------------------------------------

interface OutFeature {
  type: 'Feature'
  id: string
  properties: Record<string, unknown>
  geometry: unknown
}

async function main() {
  const selected = REGIONS.filter((r) => !filters.length || filters.some((f) => r.id.includes(f)))
  const results: Result[] = []
  for (const region of selected) {
    const previous = REGIONS.slice(0, REGIONS.indexOf(region))
    results.push(await deriveRegion(region, previous))
  }

  // Merge into the existing file so a partial run only replaces what it derived.
  const existing: OutFeature[] = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).features : []
  const replaced = new Map<string, OutFeature>(existing.map((f) => [f.id, f]))
  const stamp = new Date().toISOString().slice(0, 10)
  for (const r of results) {
    const m = r.region.method
    replaced.set(r.region.id, {
      type: 'Feature',
      id: r.region.id,
      properties: {
        derivation: `derive-floodplains ${stamp}: ${m.kind === 'hand' ? `HAND ≤ ${m.maxHeight} m${m.maxSlope ? `, slope ≤ ${(m.maxSlope * 100).toFixed(3)}%` : ''}` : `elevation ${m.min}–${m.max} m`}, Mapterhorn z${r.region.z}, simplified ${SIMPLIFY_M} m`,
      },
      geometry: r.geometry,
    })
    for (const b of r.branches) {
      // One part per run of channel or interpolation, sharing the vertex where they meet.
      const parts: { guessed: boolean; lonlat: Pt[] }[] = []
      for (let k = 1; k < b.lonlat.length; k++) {
        const last = parts[parts.length - 1]
        if (last && last.guessed === b.recon[k]) last.lonlat.push(b.lonlat[k])
        else parts.push({ guessed: b.recon[k], lonlat: [b.lonlat[k - 1], b.lonlat[k]] })
      }
      replaced.set(b.branch.id, {
        type: 'Feature',
        id: b.branch.id,
        properties: {
          discharge: b.branch.discharge,
          reconstructed: parts.map((p) => p.guessed),
          derivation: `derive-floodplains ${stamp}: authored waypoints (pipeline/src/features/delta-branches.ts)`,
        },
        geometry: {
          type: 'MultiLineString',
          coordinates: parts.map((p) => thinLine(p.lonlat)),
        },
      })
    }
  }
  const order = [...REGIONS.map((r) => r.id), ...BRANCHES.map((b) => b.id)]
  const features = [...replaced.values()].sort(
    (a, b) => (order.indexOf(a.id) + 1 || 1e9) - (order.indexOf(b.id) + 1 || 1e9),
  )
  writeFileSync(OUT, `${JSON.stringify({ type: 'FeatureCollection', features })}\n`)
  console.log(`\nwrote ${OUT} (${features.length} features)`)

  console.log('\nSUMMARY')
  for (const r of results) {
    const m = r.region.method
    console.log(
      `  ${r.region.id.padEnd(26)} ${r.areaKm2.toFixed(0).padStart(7)} km²   ${m.kind === 'hand' ? `HAND ≤ ${m.maxHeight} m${m.maxSlope ? `, slope ≤ ${(m.maxSlope * 100).toFixed(3)}%` : ''}` : `${m.min}…${m.max} m`}`,
    )
  }
  // Totals over everything in the file, including regions this run did not derive.
  const areaOf = (id: string) => {
    const f = features.find((x) => x.id === id)
    return f ? geometryArea(f.geometry as AreaGeometry) : 0
  }
  const egypt = ['nile-valley-floodplain', 'nile-delta-floodplain', 'fayum-floodplain'].map(areaOf)
  const total = egypt.reduce((a, b) => a + b, 0)
  console.log(
    `  Egypt (valley ${egypt[0].toFixed(0)} + delta ${egypt[1].toFixed(0)} + Fayum ${egypt[2].toFixed(0)}): ${total.toFixed(0)} km² vs c. 22,000–34,000 km² for ancient cultivable land (the range usually cited from Butzer 1976 — not checked)`,
  )
  if (egypt.every((a) => a > 0) && (total < 22000 || total > 34000))
    doubt(`Egypt total ${total.toFixed(0)} km² outside 22,000–34,000`)
  console.log(`\nDOUBTS (${doubts.length})`)
  for (const d of doubts) console.log(`  ${d}`)
  console.log('\nNOT CHECKED')
  console.log('  the DEM is a surface model (Copernicus GLO-30 in Mapterhorn): towns stand up; gaps under maxHoleKm2 are filled, larger cities are not')
  console.log('  ancient river courses other than the delta branches: HAND is measured from modern channels')
  console.log('  the published figures are ranges as commonly cited and have not been checked against the works (see each region)')
}

/** Line vertices rounded to ~1 m and thinned where the spline oversampled (≤ 30 m apart). */
function thinLine(line: Pt[]): Pt[] {
  const planar = line.map(([lon, lat]) => projection.forward(lon, lat) as Pt)
  return simplifyIndices(planar, 15).map((k) => [round(line[k][0]), round(line[k][1])] as Pt)
}

await main()
