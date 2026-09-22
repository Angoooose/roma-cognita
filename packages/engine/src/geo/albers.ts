/**
 * Albers equal-area conic on the sphere — the one projection the whole map lives in.
 *
 * Everything the engine draws is pre-projected into this plane, in metres, with x east
 * and y north (DESIGN.md §4). Lon/lat only exist at the API boundary and inside the
 * terrain worker, which has to reach back into Web Mercator source tiles.
 *
 * Spherical rather than ellipsoidal: at this scale the difference is a few hundred
 * metres of shift that nothing on the map can see, and the spherical inverse is closed
 * form, which matters because the terrain worker runs it for every texel it builds.
 */

export const EARTH_RADIUS = 6371008.8

export interface AlbersParams {
  /** Standard parallels, degrees. */
  parallels: [number, number]
  /** Central meridian, degrees. */
  lon0: number
  /** Latitude of the origin, degrees. */
  lat0: number
}

export interface Projection {
  forward(lon: number, lat: number): [number, number]
  inverse(x: number, y: number): [number, number]
  /** Written into the same array to avoid allocating in hot loops. */
  inverseInto(x: number, y: number, out: Float64Array, offset: number): void
}

const RAD = Math.PI / 180

export function albers({ parallels: [p1, p2], lon0, lat0 }: AlbersParams): Projection {
  const phi1 = p1 * RAD
  const phi2 = p2 * RAD
  const n = (Math.sin(phi1) + Math.sin(phi2)) / 2
  const C = Math.cos(phi1) ** 2 + 2 * n * Math.sin(phi1)
  const R = EARTH_RADIUS
  const rho0 = (R * Math.sqrt(C - 2 * n * Math.sin(lat0 * RAD))) / n
  const lam0 = lon0 * RAD

  function forward(lon: number, lat: number): [number, number] {
    const theta = n * (lon * RAD - lam0)
    const rho = (R * Math.sqrt(C - 2 * n * Math.sin(lat * RAD))) / n
    return [rho * Math.sin(theta), rho0 - rho * Math.cos(theta)]
  }

  function inverseInto(x: number, y: number, out: Float64Array, offset: number) {
    const dy = rho0 - y
    const rho = Math.sqrt(x * x + dy * dy)
    const theta = Math.atan2(x, dy)
    const s = (C - ((rho * n) / R) ** 2) / (2 * n)
    out[offset] = (lam0 + theta / n) / RAD
    out[offset + 1] = Math.asin(Math.max(-1, Math.min(1, s))) / RAD
  }

  const scratch = new Float64Array(2)
  function inverse(x: number, y: number): [number, number] {
    inverseInto(x, y, scratch, 0)
    return [scratch[0], scratch[1]]
  }

  return { forward, inverse, inverseInto }
}
