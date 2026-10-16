/**
 * Preview PNGs of the atoms over a hillshade, so a frontier can be judged against
 * the ground it claims to follow (a river, a crest) before it ships. Each atom is
 * filled in a colour hashed from its id and labelled; authored vertices are dots,
 * those that name a Pleiades place ringed.
 *
 *   npm run atoms:preview -w pipeline              every region
 *   npm run atoms:preview -w pipeline -- africa    one region
 *
 * Writes .cache/atoms-preview/<region>.png.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { DATA_DIR, ROOT_DIR, readDataset } from '../load.ts'
import { lonLatToPixel, pixelMetres, readDem, type Bbox } from '../lib/dem.ts'
import type { Pt } from '../lib/grid.ts'
import { vertexOf } from './legs.ts'

const OUT = join(ROOT_DIR, '.cache/atoms-preview')

export const REGIONS: Record<string, Bbox & { z: number }> = {
  world: { west: -11, south: 22, east: 50, north: 53, z: 4 },
  iberia: { west: -10, south: 35.5, east: 4.5, north: 44.2, z: 6 },
  gaul: { west: -5.5, south: 42, east: 10, north: 52, z: 6 },
  italy: { west: 6, south: 36.5, east: 19.5, north: 47.5, z: 6 },
  balkans: { west: 13, south: 36, east: 30, north: 46.5, z: 6 },
  anatolia: { west: 25.5, south: 34.5, east: 42, north: 42.5, z: 6 },
  levant: { west: 32, south: 28, east: 40.5, north: 37.5, z: 6 },
  africa: { west: -10.5, south: 29, east: 12, north: 37.8, z: 6 },
  libya: { west: 10, south: 28, east: 26, north: 34, z: 6 },
  fazzan: { west: 10.5, south: 24.5, east: 16.5, north: 28.5, z: 7 },
  egypt: { west: 24.5, south: 22.5, east: 36, north: 32, z: 6 },
  pontic: { west: 27, south: 40, east: 42, north: 48, z: 6 },
  east: { west: 36, south: 29, east: 50, north: 43.5, z: 5 },
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}
const colour = (id: string) =>
  `hsl(${Math.floor(hash(id) * 360)},${45 + Math.floor(hash(`${id}s`) * 30)}%,52%)`
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

async function render(name: string, view: Bbox & { z: number }) {
  const { dataset } = readDataset(DATA_DIR)
  const geo = JSON.parse(
    readFileSync(join(DATA_DIR, 'geometry/atoms.geojson'), 'utf8'),
  ) as {
    features: { id: string; geometry: { type: string; coordinates: Pt[][][] } }[]
  }
  const dem = await readDem(view, view.z)
  const [vx0, vy0] = lonLatToPixel(dem.z, view.west, view.north)
  const [vx1, vy1] = lonLatToPixel(dem.z, view.east, view.south)
  const ox = Math.floor(vx0 - dem.x0)
  const oy = Math.floor(vy0 - dem.y0)
  const W = Math.floor(vx1 - vx0)
  const H = Math.floor(vy1 - vy0)
  const img = Buffer.alloc(W * H * 3)
  const at = (i: number, j: number) => dem.data[(oy + j) * dem.width + ox + i]
  for (let j = 0; j < H; j++) {
    const cell = pixelMetres(dem.z, dem.y0 + oy + j)
    for (let i = 0; i < W; i++) {
      const k = (j * W + i) * 3
      const v = at(i, j)
      if (v === 0) {
        ;((img[k] = 170), (img[k + 1] = 188), (img[k + 2] = 205))
        continue
      }
      const dzdx =
        ((at(Math.min(W - 1, i + 1), j) - at(Math.max(0, i - 1), j)) / (2 * cell)) * 4
      const dzdy =
        ((at(i, Math.min(H - 1, j + 1)) - at(i, Math.max(0, j - 1))) / (2 * cell)) * 4
      const shade = Math.max(
        0,
        (1 - dzdx + dzdy) / Math.sqrt(3 * (1 + dzdx * dzdx + dzdy * dzdy)),
      )
      const base = 90 + 150 * shade
      ;((img[k] = Math.min(255, base)),
        (img[k + 1] = Math.min(255, base * 0.97)),
        (img[k + 2] = Math.min(255, base * 0.9)))
    }
  }
  const P = ([lon, lat]: Pt) => {
    const [px, py] = lonLatToPixel(dem.z, lon, lat)
    return [px - vx0, py - vy0] as const
  }
  const d = (ring: Pt[]) =>
    `M${ring
      .map((p) =>
        P(p)
          .map((v) => v.toFixed(1))
          .join(','),
      )
      .join('L')}Z`
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
  const labels: string[] = []
  for (const f of geo.features) {
    const polys =
      f.geometry.type === 'Polygon'
        ? [f.geometry.coordinates as unknown as Pt[][]]
        : (f.geometry.coordinates as unknown as Pt[][][])
    svg += `<path d="${polys.map((p) => p.map(d).join(' ')).join(' ')}" fill="${colour(f.id)}" fill-opacity="0.42" fill-rule="evenodd" stroke="#222" stroke-width="1"/>`
    // Label on the largest piece's vertex mean — rough, but this is a review plate.
    const big = polys.reduce((a, b) => (b[0].length > a[0].length ? b : a))
    const [cx, cy] = big[0].reduce(
      ([x, y], p) => [x + p[0] / big[0].length, y + p[1] / big[0].length],
      [0, 0],
    )
    const [lx, ly] = P([cx, cy])
    if (lx > 0 && ly > 0 && lx < W && ly < H)
      labels.push(
        `<text x="${lx.toFixed(0)}" y="${ly.toFixed(0)}" font-family="Helvetica" font-size="12" text-anchor="middle" fill="#000" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(f.id)}</text>`,
      )
  }
  for (const atom of dataset.atoms)
    for (const part of atom.construction) {
      if (part.method !== 'outline') continue
      for (const v of part.edge.map(vertexOf)) {
        const [x, y] = P(v.at)
        if (x < 0 || y < 0 || x > W || y > H) continue
        svg += v.pleiades
          ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="none" stroke="#000" stroke-width="1.5"/>`
          : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.8" fill="#000"/>`
      }
    }
  svg += labels.join('')
  svg += `<text x="8" y="20" font-family="Helvetica" font-size="15" fill="#000" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(`atoms — ${name}`)}</text></svg>`
  mkdirSync(OUT, { recursive: true })
  const file = join(OUT, `${name}.png`)
  await sharp(img, { raw: { width: W, height: H, channels: 3 } })
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toFile(file)
  console.log(file)
}

const only = process.argv.slice(2)
for (const [name, view] of Object.entries(REGIONS))
  if (!only.length || only.includes(name)) await render(name, view)
