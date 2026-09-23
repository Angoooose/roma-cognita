/** The byte encodings of the political field, shared by the bake and its tests. */

/**
 * Signed distance in texels → one byte, on a square-root scale: fine near the boundary,
 * where it places the line (1/40 texel), coarse far out, where only the glow reads it
 * (3/4 texel at the clamp). v decodes as sign(v − 127.5) · D · ((v − 127.5) / 127.5)².
 */
export function encodeDistance(d: number, D: number) {
  const u = Math.sign(d) * Math.sqrt(Math.min(1, Math.abs(d) / D))
  return Math.round(Math.max(0, Math.min(255, 127.5 + u * 127.5)))
}

/** The inverse of `encodeDistance`; the engine decodes the same way (heightWorker.ts). */
export function decodeDistance(v: number, D: number) {
  const u = v / 127.5 - 1
  return Math.sign(u) * u * u * D
}
