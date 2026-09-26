import { ROOT } from '@roma-cognita/world'
import { inside, type Ring } from './raster.ts'

/** Rings bucketed on a coarse grid so a tile only looks at rings near it. */
export class RingIndex {
  private cells = new Map<number, Ring[]>()
  private readonly n = 64
  private readonly cell = ROOT.size / this.n

  constructor(rings: Ring[]) {
    for (const r of rings) {
      const [c0, r0] = this.cellOf(r.minX, r.minY)
      const [c1, r1] = this.cellOf(r.maxX, r.maxY)
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const k = row * this.n + col
          let list = this.cells.get(k)
          if (!list) this.cells.set(k, (list = []))
          list.push(r)
        }
      }
    }
  }

  private cellOf(x: number, y: number): [number, number] {
    const c = Math.floor((x - ROOT.x) / this.cell)
    const r = Math.floor((y - ROOT.y) / this.cell)
    return [Math.max(0, Math.min(this.n - 1, c)), Math.max(0, Math.min(this.n - 1, r))]
  }

  query(minX: number, minY: number, maxX: number, maxY: number): Ring[] {
    const [c0, r0] = this.cellOf(minX, minY)
    const [c1, r1] = this.cellOf(maxX, maxY)
    const seen = new Set<Ring>()
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        for (const r of this.cells.get(row * this.n + col) ?? []) {
          if (r.maxX < minX || r.minX > maxX || r.maxY < minY || r.minY > maxY) continue
          seen.add(r)
        }
      }
    }
    return [...seen]
  }

  /** Is the point inside any ring's polygon (even-odd within each polygon)? */
  contains(x: number, y: number): boolean {
    return inside(this.query(x, y, x, y), x, y)
  }
}
