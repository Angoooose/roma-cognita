/**
 * The courses water names are lettered along: hand-placed, because a sea's name goes
 * where a cartographer puts it, not along any line in the data. Each is a few lon/lat
 * points, west to east, through open water well clear of the coast, and never
 * steeper than a name should read (territories.ts limits land names the same way).
 * Written into data/geometry/features.geojson beside the floodplains and rivers,
 * keeping whatever else is there.
 *
 *   npm run seas -w pipeline
 *
 * The records these belong to — names, sources — are the `sea`, `gulf` and `lake`
 * entries in data/features.yaml.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from '../load.ts'

type LonLat = [number, number]

export const SEA_COURSES: Record<string, LonLat[]> = {
  'oceanus-atlanticus': [
    [-9.6, 44.2],
    [-7.6, 45.3],
    [-5.6, 46.0],
  ],
  'oceanus-germanicus': [
    [1.6, 55.2],
    [4.2, 55.9],
    [6.6, 56.2],
  ],
  'mare-balearicum': [
    [0.4, 38.6],
    [2.4, 38.3],
    [4.4, 38.4],
  ],
  'mare-sardoum': [
    [5.0, 40.9],
    [6.2, 40.6],
    [7.4, 40.1],
  ],
  'mare-tyrrhenum': [
    [10.3, 40.4],
    [12.2, 39.9],
    [14.0, 39.6],
  ],
  'mare-hadriaticum': [
    [13.6, 43.8],
    [15.2, 42.9],
    [16.8, 42.0],
  ],
  'mare-ionium': [
    [16.9, 37.6],
    [18.6, 37.2],
    [20.3, 37.0],
  ],
  'mare-aegaeum': [
    [24.0, 38.9],
    [25.0, 38.6],
    [26.0, 38.1],
  ],
  'mare-libycum': [
    [19.6, 34.0],
    [22.2, 33.7],
    [24.8, 33.8],
  ],
  'mare-aegyptium': [
    [27.6, 32.6],
    [29.9, 32.8],
    [32.3, 32.8],
  ],
  'pontus-euxinus': [
    [30.8, 43.4],
    [34.0, 43.0],
    [37.2, 42.9],
  ],
  propontis: [
    [27.4, 40.72],
    [28.1, 40.8],
    [28.9, 40.78],
  ],
  'palus-maeotis': [
    [35.4, 46.0],
    [36.6, 46.2],
    [37.8, 46.3],
  ],
  'mare-hyrcanium': [
    [48.9, 42.1],
    [50.0, 41.6],
    [51.1, 40.9],
  ],
  'sinus-arabicus': [
    [34.5, 26.2],
    [35.6, 25.1],
    [36.6, 23.9],
  ],
  'sinus-persicus': [
    [49.0, 28.6],
    [50.4, 27.7],
    [51.9, 26.8],
  ],
}

const file = join(DATA_DIR, 'geometry/features.geojson')
const collection = JSON.parse(readFileSync(file, 'utf8')) as { type: string; features: { id: string }[] }
const kept = collection.features.filter((f) => !(f.id in SEA_COURSES))
const seas = Object.entries(SEA_COURSES).map(([id, line]) => ({
  type: 'Feature',
  id,
  properties: { derivation: 'pipeline/src/labels/seas.ts: label course, hand-placed' },
  geometry: { type: 'LineString', coordinates: line },
}))
writeFileSync(file, `${JSON.stringify({ type: 'FeatureCollection', features: [...kept, ...seas] })}\n`)
console.log(`wrote ${seas.length} sea courses beside ${kept.length} other features`)
