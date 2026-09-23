/**
 * The depth tile codec, shared by the bake (pipeline/src/depth) and the engine's reader.
 *
 * A tile is TILE_TEXELS² sea depths. Each is stored as u = round(√(−depth) · DEPTH_K):
 * the root spends precision where the eye does — 0.15 m steps at 6 m, 0.8 m at 160 m,
 * 4 m at 5,000 m — and fits 11 bits over the whole region. Eight bits were not enough:
 * the shallows ramp spans ~150 m of depth, and a byte of it bands.
 *
 * Codes are then run through the gradient predictor (left + up − up-left, as in PNG's
 * Paeth family and lossless JPEG), zigzagged, and written one byte each, with 255
 * escaping a following u16. Bathymetry is smooth, so almost every residual is a byte,
 * and deflate over those bytes is ~3–4× smaller than over raw u16s. Deflate itself is
 * the caller's (node's zlib in the bake, DecompressionStream in the browser), so this
 * file needs neither.
 */
import { TILE_TEXELS } from './frame.ts'

/** Code units per √metre. */
export const DEPTH_K = 32

const N = TILE_TEXELS

export function depthToCode(depth: number) {
  return Math.round(Math.sqrt(Math.max(0, -depth)) * DEPTH_K)
}

export function codeToDepth(u: number) {
  const r = u / DEPTH_K
  return -r * r
}

/** Tile of depths (m, ≤ 0, row 0 south) → predictor bytes, ready to deflate. */
export function encodeDepthTile(depths: Float32Array): Uint8Array {
  const u = new Int32Array(N * N)
  for (let k = 0; k < u.length; k++) u[k] = depthToCode(depths[k])
  const out = new Uint8Array(N * N * 3)
  let n = 0
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const k = r * N + c
      const res = u[k] - predict(u, r, c)
      const z = res >= 0 ? res * 2 : -res * 2 - 1
      if (z < 255) out[n++] = z
      else {
        out[n++] = 255
        out[n++] = z & 0xff
        out[n++] = z >> 8
      }
    }
  }
  return out.slice(0, n)
}

/** Predictor bytes (after inflate) → depths (m, ≤ 0, row 0 south). */
export function decodeDepthTile(bytes: Uint8Array): Float32Array {
  const u = new Int32Array(N * N)
  let n = 0
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      let z = bytes[n++]
      if (z === 255) {
        z = bytes[n] | (bytes[n + 1] << 8)
        n += 2
      }
      const res = z & 1 ? -(z + 1) / 2 : z / 2
      u[r * N + c] = predict(u, r, c) + res
    }
  }
  const out = new Float32Array(N * N)
  for (let k = 0; k < out.length; k++) out[k] = codeToDepth(u[k])
  return out
}

function predict(u: Int32Array, r: number, c: number) {
  if (r === 0) return c === 0 ? 0 : u[c - 1]
  if (c === 0) return u[(r - 1) * N]
  const k = r * N + c
  return u[k - 1] + u[k - N] - u[k - N - 1]
}
