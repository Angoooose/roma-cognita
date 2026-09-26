import { describe, expect, it } from 'vitest'
import { deflateSync, inflateSync } from 'node:zlib'
import {
  TILE_TEXELS,
  codeToDepth,
  decodeDepthTile,
  depthToCode,
  encodeDepthTile,
  packHeadLength,
  readPackHead,
  writePack,
} from '@roma-cognita/world'
import { extendSea } from '../src/depth/sources.ts'

const N = TILE_TEXELS

describe('depth codec', () => {
  it('round-trips within half a code step', () => {
    const depths = new Float32Array(N * N)
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        // A shelf falling into a basin, with a cliff and a flat 0 (land) corner.
        const d = c < 20 && r < 20 ? 0 : -(c * 12 + r * 3 + (c > 150 ? 2500 : 0))
        depths[r * N + c] = d
      }
    }
    const back = decodeDepthTile(inflateSync(deflateSync(encodeDepthTile(depths))))
    for (let k = 0; k < depths.length; k++) {
      const d = depths[k]
      const u = depthToCode(d)
      // One code step either side of the stored code bounds the error.
      const step = Math.abs(codeToDepth(u + 1) - codeToDepth(u))
      expect(Math.abs(back[k] - d)).toBeLessThanOrEqual(step / 2 + 1e-3)
    }
  })

  it('is fine in the shallows and coarse in the abyss', () => {
    const step = (d: number) =>
      Math.abs(codeToDepth(depthToCode(d) + 1) - codeToDepth(depthToCode(d)))
    expect(step(-6)).toBeLessThan(0.2)
    expect(step(-160)).toBeLessThan(1)
    expect(step(-5000)).toBeLessThan(5)
  })
})

describe('packs', () => {
  it('finds each tile by its address', () => {
    const tiles = [
      { address: { level: 6, i: 30, j: 21 }, bytes: new Uint8Array([1, 2, 3]) },
      { address: { level: 7, i: 61, j: 42 }, bytes: new Uint8Array([4]) },
      { address: { level: 10, i: 489, j: 340 }, bytes: new Uint8Array([5, 6]) },
    ]
    const pack = writePack(tiles)
    expect(packHeadLength(pack.subarray(0, 8))).toBe(8 + 3 * 20)
    const head = readPackHead(pack)
    for (const t of tiles) {
      const e = head.get(`${t.address.level}/${t.address.i}/${t.address.j}`)!
      expect([...pack.subarray(e.offset, e.offset + e.length)]).toEqual([...t.bytes])
    }
    expect(head.has('7/60/42')).toBe(false)
  })
})

describe('extendSea', () => {
  it('carries sea values under the land by the given number of pixels', () => {
    const w = 10
    const data = new Float32Array(w * w).fill(NaN)
    for (let r = 0; r < w; r++) for (let c = 0; c < 3; c++) data[r * w + c] = -20
    extendSea(data, w, w, 2)
    expect(data[5 * w + 3]).toBe(-20)
    expect(data[5 * w + 4]).toBe(-20)
    expect(Number.isNaN(data[5 * w + 5])).toBe(true)
  })
})
