/**
 * Preview PNGs for the floodplain derivation: a hillshade computed from the same
 * DEM, with the derived polygons, the hull, the channels and the check sites on
 * top. They exist so a human (or Claude) can look at a shape before it ships.
 */
import sharp from 'sharp'
import type { Bbox, Raster } from './dem.ts'
import { lonLatToPixel, pixelMetres } from './dem.ts'
import type { Pt } from './grid.ts'

export interface Overlay {
  polygons: Pt[][][] // lon/lat
  hull: Pt[]
  channels: { line: Pt[]; style: 'modern' | 'certain' | 'probable' | 'uncertain' }[]
  sites: { name: string; at: Pt; verdict: string }[]
  caption: string[]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

export async function renderPreview(dem: Raster, view: Bbox, overlay: Overlay, file: string, maxPx = 1600) {
  const [vx0, vy0] = lonLatToPixel(dem.z, view.west, view.north)
  const [vx1, vy1] = lonLatToPixel(dem.z, view.east, view.south)
  const ox = Math.max(0, Math.floor(vx0 - dem.x0))
  const oy = Math.max(0, Math.floor(vy0 - dem.y0))
  const ex = Math.min(dem.width, Math.ceil(vx1 - dem.x0))
  const ey = Math.min(dem.height, Math.ceil(vy1 - dem.y0))
  const step = Math.max(1, Math.ceil(Math.max(ex - ox, ey - oy) / maxPx))
  const W = Math.floor((ex - ox) / step)
  const H = Math.floor((ey - oy) / step)
  const h = new Float32Array(W * H)
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) h[j * W + i] = dem.data[(oy + j * step) * dem.width + ox + i * step]
  const img = Buffer.alloc(W * H * 3)
  // Hillshade from the north-west, 3× vertical exaggeration, plus a faint hypsometric tint.
  const az = (315 * Math.PI) / 180
  const alt = (45 * Math.PI) / 180
  let lo = Infinity
  let hi = -Infinity
  for (const v of h) if (v !== 0) (lo = Math.min(lo, v)), (hi = Math.max(hi, v))
  for (let j = 0; j < H; j++) {
    const cell = pixelMetres(dem.z, dem.y0 + oy + j * step) * step
    for (let i = 0; i < W; i++) {
      const k = j * W + i
      const v = h[k]
      if (v === 0) {
        img[k * 3] = 150
        img[k * 3 + 1] = 170
        img[k * 3 + 2] = 195
        continue
      }
      const l = h[j * W + Math.max(0, i - 1)]
      const r = h[j * W + Math.min(W - 1, i + 1)]
      const u = h[Math.max(0, j - 1) * W + i]
      const d = h[Math.min(H - 1, j + 1) * W + i]
      const dzdx = ((r - l) / (2 * cell)) * 3
      const dzdy = ((d - u) / (2 * cell)) * 3
      const slope = Math.atan(Math.hypot(dzdx, dzdy))
      const aspect = Math.atan2(dzdy, -dzdx)
      const shade = Math.max(
        0,
        Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - Math.PI / 2 - aspect),
      )
      const t = (v - lo) / Math.max(1, hi - lo)
      const base = 60 + 170 * shade
      img[k * 3] = Math.min(255, base * (0.95 + 0.1 * t))
      img[k * 3 + 1] = Math.min(255, base * (0.92 + 0.05 * t))
      img[k * 3 + 2] = Math.min(255, base * (0.85 - 0.1 * t))
    }
  }
  const P = ([lon, lat]: Pt) => {
    const [px, py] = lonLatToPixel(dem.z, lon, lat)
    return `${((px - dem.x0 - ox) / step).toFixed(1)},${((py - dem.y0 - oy) / step).toFixed(1)}`
  }
  const path = (pts: Pt[], close = false) => `M${pts.map(P).join('L')}${close ? 'Z' : ''}`
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
  const polys = overlay.polygons.map((poly) => poly.map((r) => path(r, true)).join(' ')).join(' ')
  svg += `<path d="${polys}" fill="#3c8c28" fill-opacity="0.45" fill-rule="evenodd" stroke="#1d4d10" stroke-width="1"/>`
  svg += `<path d="${path(overlay.hull, true)}" fill="none" stroke="#c0392b" stroke-width="1.5" stroke-dasharray="6 4"/>`
  const colour = { modern: '#1f5fbf', certain: '#0b2f8a', probable: '#0b2f8a', uncertain: '#8a0b6a' }
  for (const c of overlay.channels) {
    const dash = c.style === 'uncertain' ? ' stroke-dasharray="5 3"' : ''
    svg += `<path d="${path(c.line)}" fill="none" stroke="${colour[c.style]}" stroke-width="${c.style === 'modern' ? 1.2 : 2}"${dash}/>`
  }
  for (const s of overlay.sites) {
    const [x, y] = P(s.at).split(',').map(Number)
    svg += `<circle cx="${x}" cy="${y}" r="3.5" fill="#000" stroke="#fff"/>`
    svg += `<text x="${x + 5}" y="${y - 4}" font-family="Helvetica" font-size="12" fill="#000" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(`${s.name} ${s.verdict}`)}</text>`
  }
  overlay.caption.forEach((line, n) => {
    svg += `<text x="8" y="${18 + n * 16}" font-family="Helvetica" font-size="13" fill="#000" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(line)}</text>`
  })
  svg += '</svg>'
  await sharp(img, { raw: { width: W, height: H, channels: 3 } })
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toFile(file)
}
