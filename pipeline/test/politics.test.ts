import { describe, expect, it } from 'vitest'
import { decodeDistance, encodeDistance } from '../src/politics/encoding.ts'
import { alignDistance } from '../../packages/engine/src/politics/field.ts'

describe('political field distance encoding', () => {
  it('round-trips to within the scale step, finest near the boundary', () => {
    const D = 48
    for (const d of [-48, -20, -3, -0.5, 0, 0.3, 1, 7.5, 30, 48]) {
      const back = decodeDistance(encodeDistance(d, D), D)
      // The step of a square-root scale grows with distance: ~0.02 texel at 0, ~0.75 at D.
      const step = (2 * Math.sqrt(Math.abs(d) / D) + 1 / 127.5) * (D / 127.5)
      expect(Math.abs(back - d)).toBeLessThanOrEqual(step)
    }
  })

  it('clamps beyond the reach and keeps the sign', () => {
    expect(decodeDistance(encodeDistance(100, 48), 48)).toBeCloseTo(48, 5)
    expect(decodeDistance(encodeDistance(-100, 48), 48)).toBeCloseTo(-48, 5)
    expect(decodeDistance(encodeDistance(-0.4, 48), 48)).toBeLessThan(0)
  })
})

describe('alignDistance', () => {
  it('keeps a corner with the same pair as it is', () => {
    expect(alignDistance(3, 7, 3, 7, -2.5)).toBe(-2.5)
  })

  it('re-signs a corner with another pair by the side it is on', () => {
    // Corner inside label 7 (the chosen pair's higher side) near a boundary with 9.
    expect(alignDistance(3, 7, 7, 9, -4)).toBe(4)
    // Corner inside label 3 (the lower side) near a boundary with 1.
    expect(alignDistance(3, 7, 1, 3, 4)).toBe(-4)
  })

  it('never interpolates through zero across a midline between two boundaries', () => {
    // Texels either side of a midline in atom 7: one sees the 3|7 boundary, the
    // other the 7|9 boundary, both 10 texels away. Aligned, both read +10.
    const a = alignDistance(3, 7, 3, 7, 10)
    const b = alignDistance(3, 7, 7, 9, -10)
    expect(Math.min(a, b)).toBeGreaterThan(0)
  })
})
