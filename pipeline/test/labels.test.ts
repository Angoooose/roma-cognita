import { describe, expect, it } from 'vitest'
import type { Ring } from '../src/water/raster.ts'
import { placeLabel, textWidth, type FontMetrics } from '../src/labels/territories.ts'

// A monospaced stand-in: every glyph 0.7 em wide, caps 0.7 em tall.
const font: FontMetrics = { size: 64, advance: new Map(), kerning: new Map(), capHeight: 0.7 }
for (let c = 32; c < 127; c++) font.advance.set(c, 0.7 * 64)

function rect(x0: number, y0: number, x1: number, y1: number, turn = 0): Ring[] {
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const pts = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ].map(([x, y]) => {
    const dx = x - cx
    const dy = y - cy
    return [cx + dx * Math.cos(turn) - dy * Math.sin(turn), cy + dx * Math.sin(turn) + dy * Math.cos(turn)]
  })
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return [
    {
      xy: new Float64Array(pts.flat()),
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
      polygon: 0,
      areaKm2: Infinity,
    },
  ]
}

const slope = (path: [number, number][]) => {
  const [a, b] = [path[0], path[path.length - 1]]
  return Math.atan2(b[1] - a[1], b[0] - a[0])
}

describe('placeLabel', () => {
  it('sets a wide territory level, centred, and inside it', () => {
    const p = placeLabel(rect(0, 0, 400_000, 100_000), 'ITALIA', font)!
    expect(Math.abs(slope(p.path))).toBeLessThan(0.05)
    const [a, b] = [p.path[11], p.path[12]]
    expect((a[0] + b[0]) / 2).toBeCloseTo(200_000, -4)
    expect((a[1] + b[1]) / 2).toBeCloseTo(50_000, -4)
    // Letters fit the thickness: cap height at most 62% of the 100 km.
    expect(p.capHeight).toBeLessThanOrEqual(62_000 + 1)
    expect(p.capHeight).toBeGreaterThan(20_000)
  })

  it('reads left to right', () => {
    const p = placeLabel(rect(0, 0, 400_000, 100_000, 0.3), 'ASIA', font)!
    expect(p.path[p.path.length - 1][0]).toBeGreaterThan(p.path[0][0])
  })

  it('never tilts a name past 45°, even across a tall, narrow land', () => {
    for (const turn of [Math.PI / 2, -Math.PI / 2, Math.PI / 2.4, -Math.PI / 3]) {
      const p = placeLabel(rect(0, 0, 600_000, 120_000, turn), 'AEGYPTUS', font)!
      expect(p).not.toBeNull()
      expect(Math.abs(slope(p.path))).toBeLessThanOrEqual((45 * Math.PI) / 180 + 1e-6)
      expect(p.path[p.path.length - 1][0]).toBeGreaterThan(p.path[0][0])
    }
  })

  it('fills no more of the curve than the text needs', () => {
    const p = placeLabel(rect(0, 0, 800_000, 100_000), 'AB', font)!
    const len = Math.hypot(p.path[23][0] - p.path[0][0], p.path[23][1] - p.path[0][1])
    const text = (textWidth('AB', font, p.tracking) * p.capHeight) / font.capHeight
    expect(len).toBeCloseTo(text * 1.1, -3)
  })
})
