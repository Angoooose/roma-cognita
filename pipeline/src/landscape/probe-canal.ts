/**
 * Prints the water channels the coast build would draw, row by row across a box: for
 * each row, the centre and width of every run of water. This is how the canal
 * centrelines in canals.ts were read off the OSM land polygons.
 *
 *   npx tsx pipeline/src/landscape/probe-canal.ts <west> <south> <east> <north> <rowStep>
 *
 * Rows are 50 m apart; `rowStep` prints every nth. Runs of 60 km or more (open sea) are
 * left out.
 */
import { readRings, ensureUnzipped, SOURCES, keepLand } from '../water/sources.ts'
import { fillPolygons } from '../water/raster.ts'
import { projection } from '@roman-map/world'
import { join } from 'node:path'
const CACHE = join(import.meta.dirname, '../../../.cache/sources')
const land = await readRings(ensureUnzipped(CACHE, SOURCES.land.zip), keepLand)
const [x0, y0] = projection.forward(Number(process.argv[2]), Number(process.argv[3]))
const [x1, y1] = projection.forward(Number(process.argv[4]), Number(process.argv[5]))
const step = 50
const w = Math.ceil((x1 - x0) / step), h = Math.ceil((y1 - y0) / step)
const rings = land.rings.filter((r) => r.maxX > x0 && r.minX < x1 && r.maxY > y0 && r.minY < y1)
const mask = new Uint8Array(w * h)
fillPolygons(rings, { x0, y0, step, width: w, height: h }, mask)
for (let r = 0; r < h; r += Number(process.argv[6])) {
  const runs: string[] = []
  let c = 0
  while (c < w) {
    if (mask[r * w + c]) { c++; continue }
    const s = c
    while (c < w && !mask[r * w + c]) c++
    const width = (c - s) * step
    if (width < 60000) {
      const [lon, lat] = projection.inverse(x0 + ((s + c) / 2) * step, y0 + r * step)
      runs.push(`${lon.toFixed(4)},${lat.toFixed(4)} w=${width}`)
    }
  }
  console.log(r, runs.join(' | '))
}
