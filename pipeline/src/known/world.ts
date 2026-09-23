/**
 * The known world as authored (data/known-world.yaml): its ring, and the atoms that run
 * on past it. Read by the known-world bake (build.ts) and by label placement, which
 * must both see only the part of such an atom that lies inside the ring.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pc, { type MultiPolygon } from 'polygon-clipping'
import { parse } from 'yaml'
import { DATA_DIR } from '../load.ts'

export type LonLat = [number, number]

export interface KnownWorld {
  ring: LonLat[]
  /** Atoms drawn on past the ring, which the ring cuts rather than extends. */
  beyond: Set<string>
}

export function readKnownWorld(): KnownWorld {
  const raw = parse(readFileSync(join(DATA_DIR, 'known-world.yaml'), 'utf8')) as {
    ring: LonLat[]
    beyond?: string[]
  }
  return { ring: raw.ring, beyond: new Set(raw.beyond ?? []) }
}

type Geometry =
  | { type: 'Polygon'; coordinates: LonLat[][] }
  | { type: 'MultiPolygon'; coordinates: LonLat[][][] }

/**
 * An atom's polygons, as lon/lat rings: cut to the ring if the atom runs on past it,
 * whole otherwise. The cut is straight in lon/lat, as the bake draws the ring.
 */
export function knownPolygons(known: KnownWorld, id: string, geom: Geometry): LonLat[][][] {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
  if (!known.beyond.has(id)) return polys
  return pc.intersection(polys as MultiPolygon, [[known.ring]]) as LonLat[][][]
}
