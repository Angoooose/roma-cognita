/**
 * Prints the water channels the coast build would draw, row by row across a box: for
 * each row, the centre and width of every run of water. The canal centrelines in
 * canals.ts are read off this output over the OSM land polygons; run it again to
 * re-read them against a newer extract.
 *
 *   npm run canals:probe -w pipeline -- <west> <south> <east> <north> <rowStep>
 *
 * Rows are 50 m apart; `rowStep` prints every nth. Runs of 60 km or more (open sea) are
 * left out.
 */
import { projection } from '@roma-cognita/world'
import { CACHE_DIR } from '../load.ts'
import { fillPolygons } from '../water/raster.ts'
import { ensureUnzipped, keepLand, readRings, SOURCES } from '../water/sources.ts'

const STEP = 50
const OPEN_SEA = 60_000

const [west, south, east, north, rowStep] = process.argv.slice(2).map(Number)
if ([west, south, east, north, rowStep].some((n) => !Number.isFinite(n))) {
  throw new Error('usage: probe-canal.ts <west> <south> <east> <north> <rowStep>')
}

const land = await readRings(ensureUnzipped(CACHE_DIR, SOURCES.land.zip), keepLand)
const [x0, y0] = projection.forward(west, south)
const [x1, y1] = projection.forward(east, north)
const width = Math.ceil((x1 - x0) / STEP)
const height = Math.ceil((y1 - y0) / STEP)
const rings = land.rings.filter(
  (r) => r.maxX > x0 && r.minX < x1 && r.maxY > y0 && r.minY < y1,
)
const mask = new Uint8Array(width * height)
fillPolygons(rings, { x0, y0, step: STEP, width, height }, mask)

for (let row = 0; row < height; row += rowStep) {
  const runs: string[] = []
  let c = 0
  while (c < width) {
    if (mask[row * width + c]) {
      c++
      continue
    }
    const start = c
    while (c < width && !mask[row * width + c]) c++
    const metres = (c - start) * STEP
    if (metres < OPEN_SEA) {
      const [lon, lat] = projection.inverse(x0 + ((start + c) / 2) * STEP, y0 + row * STEP)
      runs.push(`${lon.toFixed(4)},${lat.toFixed(4)} w=${metres}`)
    }
  }
  console.log(row, runs.join(' | '))
}
