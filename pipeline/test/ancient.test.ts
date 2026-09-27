import { describe, expect, it } from 'vitest'
import { TILE_TEXELS } from '@roma-cognita/world'
import { ancientChannel } from '../src/water/ancient.ts'
import type { Ring } from '../src/water/raster.ts'

function square(x0: number, y0: number, x1: number, y1: number, polygon: number): Ring {
  return {
    xy: new Float64Array([x0, y0, x1, y0, x1, y1, x0, y1]),
    minX: x0,
    minY: y0,
    maxX: x1,
    maxY: y1,
    polygon,
    areaKm2: Infinity,
  }
}

/** Channel 2 of the texel at plane (x, y) in a tile at the origin with 100 m texels. */
function bake(sea: Ring[]) {
  const out = new Uint8Array(TILE_TEXELS * TILE_TEXELS * 3)
  const land = [square(-50_000, -50_000, 50_000, 50_000, 0)]
  ancientChannel({ reach: 4000, sea, land, lakes: [], removeWater: [], addWater: sea }, 0, 0, 100, out)
  // Image row 0 is the tile's north edge.
  return (x: number, y: number) => out[((TILE_TEXELS - 1 - y / 100) * TILE_TEXELS + x / 100) * 3 + 2]
}

describe('the ancient sea channel', () => {
  const bay = [square(5000, 5000, 15_000, 15_000, 1)]

  it('is 0 away from ancient sea, and ramps from the shore to full at the reach', () => {
    const at = bake(bay)
    expect(at(2000, 10_000)).toBe(0)
    expect(at(5500, 10_000)).toBeGreaterThan(1)
    expect(at(5500, 10_000)).toBeLessThan(60)
    expect(at(7000, 10_000)).toBeGreaterThan(at(5500, 10_000))
    expect(at(10_000, 10_000)).toBe(255)
  })

  it('reads 1 just outside the edge, so flattening reaches the drawn shore', () => {
    const at = bake(bay)
    expect(at(4900, 10_000)).toBe(1)
  })

  it('shelves more gently where a shape says so', () => {
    const steep = bake(bay)
    const flats = bake([{ ...bay[0], shelf: 16_000 }])
    // 1.5 km in: a quarter of the way down a 4 km shelf, a sixteenth of a 16 km one.
    expect(flats(6500, 10_000)).toBeLessThan(steep(6500, 10_000) / 3)
    expect(flats(6500, 10_000)).toBeGreaterThan(1)
  })

  it('measures to land left standing inside it, not only to its edge', () => {
    // An island is a hole in the shape, as derive-coasts writes it: a second ring of the same polygon.
    const at = bake([...bay, square(9500, 9500, 10_500, 10_500, 1)])
    expect(at(10_000, 10_000)).toBe(0)
    expect(at(11_500, 10_000)).toBeLessThan(at(13_000, 13_000))
  })
})
