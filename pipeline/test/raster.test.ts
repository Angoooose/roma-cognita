import { describe, expect, it } from 'vitest'
import { edgesTouch, fillEvenOdd, fillPolygons, inside, signedDistance, type Ring } from '../src/water/raster.ts'

function ring(points: [number, number][], polygon = 0): Ring {
  const xy = new Float64Array(points.flat())
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  return {
    xy,
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
    polygon,
    areaKm2: Infinity,
  }
}

const square = (x0: number, y0: number, x1: number, y1: number, polygon = 0) =>
  ring(
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
    polygon,
  )

const grid = { x0: 0.5, y0: 0.5, step: 1, width: 20, height: 20 }

describe('fillEvenOdd', () => {
  it('fills the samples whose centres fall inside', () => {
    const out = new Uint8Array(400)
    fillEvenOdd([square(5, 5, 15, 15)], grid, out)
    expect(out.reduce((a, b) => a + b, 0)).toBe(100)
    expect(out[5 * 20 + 5]).toBe(1)
    expect(out[4 * 20 + 5]).toBe(0)
  })

  it('treats a nested ring as a hole whatever its winding', () => {
    const out = new Uint8Array(400)
    fillEvenOdd([square(2, 2, 18, 18), square(6, 6, 14, 14)], grid, out)
    expect(out[10 * 20 + 10]).toBe(0)
    expect(out[3 * 20 + 3]).toBe(1)
    expect(out.reduce((a, b) => a + b, 0)).toBe(16 * 16 - 8 * 8)
  })
})

describe('fillPolygons', () => {
  it('unions overlapping polygons rather than cancelling the overlap', () => {
    // Two OSM-style split pieces that overlap past their shared cut at x = 10.
    const out = new Uint8Array(400)
    fillPolygons([square(0, 0, 10.6, 20, 1), square(9.4, 0, 20, 20, 2)], grid, out)
    expect(out.every((v) => v === 1)).toBe(true)
  })

  it('still cuts holes within one polygon', () => {
    const out = new Uint8Array(400)
    fillPolygons([square(2, 2, 18, 18, 1), square(6, 6, 14, 14, 1)], grid, out)
    expect(out[10 * 20 + 10]).toBe(0)
  })
})

describe('signedDistance', () => {
  it('is positive on land, negative on water, zero between them', () => {
    const land = new Uint8Array(400)
    fillEvenOdd([square(0, 0, 10, 20)], grid, land)
    const d = signedDistance(land, 20, 20)
    // Sample columns 9 and 10 straddle the shore at x = 10.
    expect(d[10 * 20 + 9]).toBeCloseTo(0.5)
    expect(d[10 * 20 + 10]).toBeCloseTo(-0.5)
    expect(d[10 * 20 + 4]).toBeCloseTo(5.5)
    expect(d[10 * 20 + 15]).toBeCloseTo(-5.5)
  })
})

describe('edgesTouch and inside', () => {
  const r = square(5, 5, 15, 15)
  it('finds tiles the shore crosses and not ones it misses', () => {
    expect(edgesTouch([r], 0, 0, 6, 6)).toBe(true)
    expect(edgesTouch([r], 7, 7, 13, 13)).toBe(false)
    expect(edgesTouch([r], 16, 0, 20, 20)).toBe(false)
  })
  it('classifies untouched tiles by their centre', () => {
    expect(inside([r], 10, 10)).toBe(true)
    expect(inside([r], 18, 18)).toBe(false)
  })
  it('counts a point in two overlapping polygons as inside', () => {
    expect(inside([square(0, 0, 10.6, 20, 1), square(9.4, 0, 20, 20, 2)], 10, 10)).toBe(true)
  })
})
