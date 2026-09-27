/**
 * Prints the modern ground height (Mapterhorn) at lon/lat points, and the lowest and
 * highest ground in a box: for setting a shore's threshold or a lake's level.
 *
 *   npx tsx pipeline/src/landscape/probe-height.ts 13.55,42.00 13.44,42.03
 *   npx tsx pipeline/src/landscape/probe-height.ts --box 13.40,41.92,13.70,42.10
 */
import { lonLatToPixel, readDem } from '../features/dem.ts'

const args = process.argv.slice(2)
const z = 11
if (args[0] === '--box') {
  const [west, south, east, north] = args[1].split(',').map(Number)
  const dem = await readDem({ west, south, east, north }, z)
  const [x0, y0] = lonLatToPixel(z, west, north)
  const [x1, y1] = lonLatToPixel(z, east, south)
  const hs: number[] = []
  for (let y = Math.ceil(y0); y < y1; y++)
    for (let x = Math.ceil(x0); x < x1; x++) hs.push(dem.data[(y - dem.y0) * dem.width + (x - dem.x0)])
  hs.sort((a, b) => a - b)
  const q = (f: number) => hs[Math.floor(f * (hs.length - 1))].toFixed(1)
  console.log(`min ${q(0)}  p1 ${q(0.01)}  p5 ${q(0.05)}  p25 ${q(0.25)}  median ${q(0.5)}  p75 ${q(0.75)}  max ${q(1)}`)
} else {
  for (const a of args) {
    const [lon, lat] = a.split(',').map(Number)
    const dem = await readDem({ west: lon - 0.001, south: lat - 0.001, east: lon + 0.001, north: lat + 0.001 }, z)
    const [x, y] = lonLatToPixel(z, lon, lat)
    console.log(`${a}: ${dem.data[Math.floor(y - dem.y0) * dem.width + Math.floor(x - dem.x0)].toFixed(1)} m`)
  }
}
