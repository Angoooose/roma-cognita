/**
 * data/geometry/landscape-changes.geojson is written by more than one generator (the
 * canals, the ancient coasts). Each owns the ids it writes: a generator replaces its
 * own features and keeps everyone else's, so re-running one never wipes another's.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from '../load.ts'

export const LANDSCAPE_SHAPES = join(DATA_DIR, 'geometry/landscape-changes.geojson')

export interface LandscapeShape {
  type: 'Feature'
  id: string
  properties: {
    derivation: string
    /** For ancient water: whether it was sea (the engine lays the ground at sea level) or a lake. */
    surface?: 'sea' | 'lake'
    /** For ancient sea: the distance it shelves over to full depth, km, where wider than the usual 4. */
    shelfKm?: number
  }
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown }
}

/**
 * Writes `features` into the shared file. Features of `owned` ids that are not in
 * `features` are dropped, so a generator can retire a shape; everything else is kept.
 * Features are sorted by id, so the file diffs cleanly whichever generator ran last.
 */
export function writeLandscapeShapes(
  features: LandscapeShape[],
  owned: Iterable<string> = [],
) {
  const replaced = new Set([...owned, ...features.map((f) => f.id)])
  const kept: LandscapeShape[] = existsSync(LANDSCAPE_SHAPES)
    ? (
        JSON.parse(readFileSync(LANDSCAPE_SHAPES, 'utf8')).features as LandscapeShape[]
      ).filter((f) => !replaced.has(f.id))
    : []
  const all = [...kept, ...features].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
  writeFileSync(
    LANDSCAPE_SHAPES,
    `${JSON.stringify({ type: 'FeatureCollection', features: all })}\n`,
  )
  console.log(`wrote ${features.length} of ${all.length} shapes to ${LANDSCAPE_SHAPES}`)
}
