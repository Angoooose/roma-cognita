/**
 * Float32 → IEEE half. Half floats because they are filterable on every WebGPU and
 * WebGL2 device, where 32-bit float textures need an optional feature. At 4,000 m the
 * height step is 2 m, which the shading never sees — it reads the gradient channels.
 */
const f32 = new Float32Array(1)
const u32 = new Uint32Array(f32.buffer)

export function toHalf(value: number): number {
  f32[0] = value
  const x = u32[0]
  const sign = (x >>> 16) & 0x8000
  let exp = ((x >>> 23) & 0xff) - 127 + 15
  let mant = x & 0x7fffff
  if (exp <= 0) {
    if (exp < -10) return sign
    mant = (mant | 0x800000) >> (1 - exp)
    return sign | ((mant + 0x1000) >> 13)
  }
  if (exp >= 31) return sign | 0x7c00
  mant += 0x1000
  if (mant & 0x800000) {
    mant = 0
    exp += 1
    if (exp >= 31) return sign | 0x7c00
  }
  return sign | (exp << 10) | (mant >> 13)
}
