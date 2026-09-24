import * as THREE from 'three/webgpu'
import { float, Fn, floor, int, select, sub, uint, vec2 } from 'three/tsl'

/**
 * `mx_noise_float(vec3(p, seed))` for a whole-number seed, at half the price.
 *
 * The terrain's noise is three's MaterialX Perlin in 3D, with the seed as the third
 * coordinate so each seed is an independent field. A whole-number seed sits exactly on
 * a lattice plane: its fade weight towards the next plane is 0, so four of the eight
 * corners — half the hashing, which is most of the cost — are multiplied by nothing.
 * This is the same function on that plane alone: the same hash, the same gradients
 * (with the z offset 0) and the same interpolation, so it draws the same terrain. It
 * mirrors three/src/nodes/materialx/MaterialXNoise.js (mx_perlin_noise_float_1), whose
 * helpers three/tsl does not export.
 */
export function seededNoise(p: THREE.Node<'vec2'>, seed: number): THREE.Node<'float'> {
  if (!Number.isInteger(seed)) throw new Error(`seededNoise: seed ${seed} is not a whole number`)
  return perlinOnPlane(vec2(p), int(seed))
}

type U = THREE.Node<'uint'>
type I = THREE.Node<'int'>
type F = THREE.Node<'float'>

// Shift counts are ints, as in three's version; the typings want uints.
const rotl32 = Fn(([x, k]: [U, I]) =>
  x.shiftLeft(k as unknown as U).bitOr(x.shiftRight(int(32).sub(k) as unknown as U)),
).setLayout({
  name: 'rm_rotl32',
  type: 'uint',
  inputs: [
    { name: 'x', type: 'uint' },
    { name: 'k', type: 'int' },
  ],
})

/** Bob Jenkins' final mix, as mx_bjfinal. */
const bjfinal = Fn(([a0, b0, c0]: [U, U, U]) => {
  const c = uint(c0).toVar()
  const b = uint(b0).toVar()
  const a = uint(a0).toVar()
  c.bitXorAssign(b)
  c.subAssign(rotl32(b, int(14)))
  a.bitXorAssign(c)
  a.subAssign(rotl32(c, int(11)))
  b.bitXorAssign(a)
  b.subAssign(rotl32(a, int(25)))
  c.bitXorAssign(b)
  c.subAssign(rotl32(b, int(16)))
  a.bitXorAssign(c)
  a.subAssign(rotl32(c, int(4)))
  b.bitXorAssign(a)
  b.subAssign(rotl32(a, int(14)))
  c.bitXorAssign(b)
  c.subAssign(rotl32(b, int(24)))
  return c
}).setLayout({
  name: 'rm_bjfinal',
  type: 'uint',
  inputs: [
    { name: 'a', type: 'uint' },
    { name: 'b', type: 'uint' },
    { name: 'c', type: 'uint' },
  ],
})

/** mx_hash_int(x, y, z): three words seeded with the length, then the final mix. */
const hash3 = Fn(([x0, y0, z0]: [I, I, I]) => {
  const z = int(z0).toVar()
  const y = int(y0).toVar()
  const x = int(x0).toVar()
  const len = uint(uint(3)).toVar()
  const a = uint().toVar()
  const b = uint().toVar()
  const c = uint().toVar()
  a.assign(b.assign(c.assign(uint(0xdeadbeef).add(len.shiftLeft(uint(2))).add(uint(13)))))
  a.addAssign(uint(x))
  b.addAssign(uint(y))
  c.addAssign(uint(z))
  return bjfinal(a, b, c)
}).setLayout({
  name: 'rm_hash_int3',
  type: 'uint',
  inputs: [
    { name: 'x', type: 'int' },
    { name: 'y', type: 'int' },
    { name: 'z', type: 'int' },
  ],
})

/** mx_gradient_float for 3D, with the z offset 0: on the lattice plane itself. */
const gradient = Fn(([hash0, x0, y0]: [U, F, F]) => {
  const y = float(y0).toVar()
  const x = float(x0).toVar()
  const hash = uint(hash0).toVar()
  const h = uint(hash.bitAnd(uint(15))).toVar()
  const u = float(select(h.lessThan(uint(8)), x, y)).toVar()
  const v = float(
    select(h.lessThan(uint(4)), y, select(h.equal(uint(12)).or(h.equal(uint(14))), x, float(0))),
  ).toVar()
  const nu = select(h.bitAnd(uint(1)).notEqual(uint(0)), u.negate(), u)
  const nv = select(h.bitAnd(uint(2)).notEqual(uint(0)), v.negate(), v)
  return nu.add(nv)
}).setLayout({
  name: 'rm_gradient_plane',
  type: 'float',
  inputs: [
    { name: 'hash', type: 'uint' },
    { name: 'x', type: 'float' },
    { name: 'y', type: 'float' },
  ],
})

const fade = (t: F) => t.mul(t).mul(t).mul(t.mul(t.mul(6.0).sub(15.0)).add(10.0))

const perlinOnPlane = Fn(([p0, Z]: [THREE.Node<'vec2'>, I]) => {
  const p = vec2(p0).toVar()
  const X = int(floor(p.x)).toVar()
  const Y = int(floor(p.y)).toVar()
  const fx = float(p.x.sub(float(X))).toVar()
  const fy = float(p.y.sub(float(Y))).toVar()
  const s = float(fade(fx)).toVar()
  const t = float(fade(fy)).toVar()
  const v0 = float(gradient(hash3(X, Y, Z), fx, fy)).toVar()
  const v1 = float(gradient(hash3(X.add(int(1)), Y, Z), fx.sub(1.0), fy)).toVar()
  const v2 = float(gradient(hash3(X, Y.add(int(1)), Z), fx, fy.sub(1.0))).toVar()
  const v3 = float(gradient(hash3(X.add(int(1)), Y.add(int(1)), Z), fx.sub(1.0), fy.sub(1.0))).toVar()
  // mx_trilerp's near plane; its far plane is weighted by fade(0) = 0.
  const s1 = float(sub(1.0, s)).toVar()
  const t1 = float(sub(1.0, t)).toVar()
  const result = float(t1.mul(v0.mul(s1).add(v1.mul(s))).add(t.mul(v2.mul(s1).add(v3.mul(s))))).toVar()
  return result.mul(0.982)
}).setLayout({
  name: 'rm_perlin_plane',
  type: 'float',
  inputs: [
    { name: 'p', type: 'vec2' },
    { name: 'z', type: 'int' },
  ],
})
