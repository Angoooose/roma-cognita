/**
 * Bakes the known world into a distance texture: how far each point of the plane is
 * from what Roman geography reached, which is where the map's colour stops and the
 * sketch begins (engine terrain/material.ts).
 *
 * The known world is the union of the ring in data/known-world.yaml, every atom's
 * outline, and a 150 km disc round every place — so it can never leave out something
 * the rest of the data draws. The exception is an atom the file lists as running on
 * `beyond` the ring: only its part inside the ring counts.
 *
 * Output: build/known/known.png, 1024² over the quadtree root, one channel: signed
 * distance to the known world's edge, 128 at the edge, 4 km per step, positive outside,
 * clamped at ±508 km. Image row 0 is the north edge, as for the biome texture.
 *
 *   npm run known -w pipeline
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { parse } from 'yaml'
import { ROOT, projection } from '@roma-cognita/world'
import { knownPolygons, readKnownWorld, type LonLat } from './world.ts'
import { ROOT_DIR, DATA_DIR } from '../load.ts'

const OUT = join(ROOT_DIR, 'build/known/known.png')

const SIZE = 1024
const KM_PER_STEP = 4
const PLACE_REACH_KM = 150

async function main() {
  const t0 = Date.now()
  const texelKm = ROOT.size / SIZE / 1000
  const inside = new Uint8Array(SIZE * SIZE)

  const known = readKnownWorld()
  fillRings([known.ring], inside)

  const atoms = JSON.parse(readFileSync(join(DATA_DIR, 'geometry/atoms.geojson'), 'utf8'))
  for (const f of atoms.features) {
    for (const rings of knownPolygons(known, f.id, f.geometry)) fillRings(rings, inside)
  }

  const places = parse(readFileSync(join(DATA_DIR, 'places.yaml'), 'utf8')) as {
    location?: LonLat
  }[]
  const r = PLACE_REACH_KM / texelKm
  for (const p of places) {
    if (!p.location) continue
    const [ci, cj] = toTexel(...p.location)
    for (let j = Math.floor(cj - r); j <= Math.ceil(cj + r); j++) {
      for (let i = Math.floor(ci - r); i <= Math.ceil(ci + r); i++) {
        if (i < 0 || j < 0 || i >= SIZE || j >= SIZE) continue
        if ((i + 0.5 - ci) ** 2 + (j + 0.5 - cj) ** 2 <= r * r) inside[j * SIZE + i] = 1
      }
    }
  }

  // Signed distance: to the nearest known texel from outside, to the nearest unknown
  // one from inside.
  const toKnown = edt(inside, 1)
  const toUnknown = edt(inside, 0)
  const out = new Uint8Array(SIZE * SIZE)
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const o = j * SIZE + i
      const km = (Math.sqrt(toKnown[o]) - Math.sqrt(toUnknown[o])) * texelKm
      out[(SIZE - 1 - j) * SIZE + i] = Math.max(0, Math.min(255, Math.round(128 + km / KM_PER_STEP)))
    }
  }
  mkdirSync(dirname(OUT), { recursive: true })
  await sharp(out, { raw: { width: SIZE, height: SIZE, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toFile(OUT)
  console.log(`wrote ${OUT} in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
}

/** Texel coordinates (fractional, j counting north) of a lon/lat. */
function toTexel(lon: number, lat: number): [number, number] {
  const [x, y] = projection.forward(lon, lat)
  return [((x - ROOT.x) / ROOT.size) * SIZE, ((y - ROOT.y) / ROOT.size) * SIZE]
}

/**
 * Even-odd scanline fill of one polygon (exterior and holes) into the mask. Edges are
 * walked in lon/lat at ≤0.25° steps before projecting, so a parallel stays an arc.
 */
function fillRings(rings: LonLat[][], mask: Uint8Array) {
  const edges: [number, number, number, number][] = []
  for (const ring of rings) {
    const pts: [number, number][] = []
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k]
      const b = ring[(k + 1) % ring.length]
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25))
      for (let s = 0; s < n; s++) {
        const t = s / n
        pts.push(toTexel(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
      }
    }
    for (let k = 0; k < pts.length; k++) {
      const [x0, y0] = pts[k]
      const [x1, y1] = pts[(k + 1) % pts.length]
      if (y0 !== y1) edges.push([x0, y0, x1, y1])
    }
  }
  for (let j = 0; j < SIZE; j++) {
    const y = j + 0.5
    const xs: number[] = []
    for (const [x0, y0, x1, y1] of edges) {
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0))
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(xs[k] - 0.5))
      const i1 = Math.min(SIZE - 1, Math.floor(xs[k + 1] - 0.5))
      for (let i = i0; i <= i1; i++) mask[j * SIZE + i] = 1
    }
  }
}

/**
 * Squared Euclidean distance, in texels², from every texel to the nearest texel whose
 * mask value is `target` (Felzenszwalb & Huttenlocher's separable transform).
 */
function edt(mask: Uint8Array, target: number): Float64Array {
  const INF = 1e20
  const d = new Float64Array(SIZE * SIZE)
  for (let o = 0; o < d.length; o++) d[o] = mask[o] === target ? 0 : INF
  const f = new Float64Array(SIZE)
  const z = new Float64Array(SIZE + 1)
  const v = new Int32Array(SIZE)
  const line = (get: (k: number) => number, set: (k: number, x: number) => void) => {
    for (let k = 0; k < SIZE; k++) f[k] = get(k)
    let n = 0
    v[0] = 0
    z[0] = -INF
    z[1] = INF
    for (let q = 1; q < SIZE; q++) {
      let s = (f[q] + q * q - (f[v[n]] + v[n] * v[n])) / (2 * q - 2 * v[n])
      while (s <= z[n]) {
        n--
        s = (f[q] + q * q - (f[v[n]] + v[n] * v[n])) / (2 * q - 2 * v[n])
      }
      n++
      v[n] = q
      z[n] = s
      z[n + 1] = INF
    }
    n = 0
    for (let q = 0; q < SIZE; q++) {
      while (z[n + 1] < q) n++
      set(q, (q - v[n]) ** 2 + f[v[n]])
    }
  }
  for (let i = 0; i < SIZE; i++)
    line(
      (k) => d[k * SIZE + i],
      (k, x) => (d[k * SIZE + i] = x),
    )
  for (let j = 0; j < SIZE; j++)
    line(
      (k) => d[j * SIZE + k],
      (k, x) => (d[j * SIZE + k] = x),
    )
  return d
}

await main()
