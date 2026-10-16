/**
 * The vector inputs of the floodplain derivation, read from the shapefiles the
 * water and river bakes already cache under .cache/sources:
 *
 * - OSM land polygons (split edition): the modern coast. Floodplain is clipped
 *   to it, so no floodplain is drawn at sea.
 * - HydroLAKES v1.0: natural lakes (reservoirs, type 2, are ignored as the water
 *   bake ignores them) of at least LAKE_KM2, subtracted from the floodplain
 *   because the map draws them as water.
 * - HydroRIVERS v1.0: modern channels, chained reach by reach along NEXT_DOWN
 *   into continuous downstream-running lines.
 *
 * HydroSHEDS regions: `af` is Africa (the Nile); the Middle East is in `eu`.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Bbox } from '../lib/dem.ts'
import { CACHE_DIR as CACHE } from '../load.ts'
import { readDbf, readShp } from '../lib/shp.ts'
import type { Pt } from '../lib/grid.ts'

const LAND = join(
  CACHE,
  'land-polygons-split-4326/land-polygons-split-4326/land_polygons.shp',
)
const LAKES = join(
  CACHE,
  'HydroLAKES_polys_v10_shp/HydroLAKES_polys_v10_shp/HydroLAKES_polys_v10.shp',
)
export const LAKE_KM2 = 1

function need(path: string) {
  if (!existsSync(path))
    throw new Error(`missing ${path} — run npm run water -w pipeline once, which unzips it`)
  return path
}

export function readLand(bbox: Bbox): Pt[][] {
  return readShp(need(LAND), bbox).flatMap((r) => r.parts)
}

export interface Lake {
  id: number
  name: string
  areaKm2: number
  rings: Pt[][]
}

export function readLakes(bbox: Bbox): Lake[] {
  const recs = readShp(need(LAKES), bbox)
  const attrs = readDbf(
    LAKES.replace(/\.shp$/, '.dbf'),
    recs.map((r) => r.index),
    ['Hylak_id', 'Lake_name', 'Lake_type', 'Lake_area'],
  )
  return recs
    .map((r) => ({ r, a: attrs.get(r.index)! }))
    .filter(({ a }) => a.Lake_type !== 2 && (a.Lake_area as number) >= LAKE_KM2)
    .map(({ r, a }) => ({
      id: a.Hylak_id as number,
      name: String(a.Lake_name),
      areaKm2: a.Lake_area as number,
      rings: r.parts,
    }))
}

export interface Channel {
  label: string
  /** Upstream to downstream. */
  line: Pt[]
}

function riversShp(region: string) {
  const dir = join(CACHE, `HydroRIVERS_v10_${region}_shp/HydroRIVERS_v10_${region}_shp`)
  need(dir)
  const shp = readdirSync(dir).find((f) => f.endsWith('.shp'))
  return join(dir, shp!)
}

/**
 * Modern channels with mean discharge ≥ minQ whose reaches touch `bbox`, chained
 * into continuous lines: each line starts at a reach no selected reach flows
 * into and follows NEXT_DOWN until it leaves the selection or joins a line
 * already walked (a confluence), where it ends on the junction point.
 */
export function readRivers(region: string, bbox: Bbox, minQ: number): Channel[] {
  const shp = riversShp(region)
  const recs = readShp(shp, bbox)
  const attrs = readDbf(
    shp.replace(/\.shp$/, '.dbf'),
    recs.map((r) => r.index),
    ['HYRIV_ID', 'NEXT_DOWN', 'DIS_AV_CMS', 'MAIN_RIV'],
  )
  const byId = new Map<number, { line: Pt[]; next: number; q: number }>()
  for (const r of recs) {
    const a = attrs.get(r.index)!
    if ((a.DIS_AV_CMS as number) < minQ) continue
    byId.set(a.HYRIV_ID as number, {
      line: r.parts[0],
      next: a.NEXT_DOWN as number,
      q: a.DIS_AV_CMS as number,
    })
  }
  const hasUpstream = new Set<number>()
  for (const v of byId.values()) if (byId.has(v.next)) hasUpstream.add(v.next)
  // Walk the biggest rivers first so a tributary is the one that ends at the confluence.
  const heads = [...byId.keys()].filter((id) => !hasUpstream.has(id))
  const walked = new Set<number>()
  const out: Channel[] = []
  const chains = heads.map((h) => {
    const ids: number[] = []
    for (
      let id: number | undefined = h;
      id !== undefined && byId.has(id);
      id = byId.get(id)!.next
    ) {
      ids.push(id)
      if (ids.length > 100000) break
    }
    return ids
  })
  chains.sort((a, b) => b.length - a.length)
  for (const ids of chains) {
    const line: Pt[] = []
    for (const id of ids) {
      const reach = byId.get(id)!
      if (walked.has(id)) {
        line.push(reach.line[0])
        break
      }
      walked.add(id)
      for (const p of reach.line) {
        const last = line[line.length - 1]
        if (!last || last[0] !== p[0] || last[1] !== p[1]) line.push(p)
      }
    }
    if (line.length >= 2) out.push({ label: `HydroRIVERS ${region} head ${ids[0]}`, line })
  }
  return out
}
