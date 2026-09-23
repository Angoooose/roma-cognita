import * as THREE from 'three/webgpu'

/**
 * Political colour, by power (DESIGN.md §8.1): every polity takes the colour of the
 * power it answers to, so the Roman world reads as one thing at a glance. Polities of
 * one power are told apart by small, stable shifts of that colour; client kingdoms are
 * the power's colour washed towards parchment, so they read as Roman-aligned but not
 * Roman-governed.
 *
 * Colours are a style decision, not data: they live here, not in data/. A polity's
 * shade is a hash of its id, so it never changes when another polity is added.
 */

/** Powers with a chosen colour. Anything else takes one from `FALLBACK` by hash. */
const POWERS: Record<string, string> = {
  rome: '#AE4A42',
}

/** Muted, mid-light hues for independent powers, chosen to sit apart from Rome's red. */
const FALLBACK = ['#B98F4A', '#5E8C84', '#7A6A96', '#8E9A52', '#5A7398', '#A0734F', '#9A6A7E']

const PARCHMENT = new THREE.Color('#D8D2C4')

export interface PolityStyle {
  /** Fill, linear RGB. */
  fill: THREE.Color
  /** Border ink, linear RGB: the power's colour, very dark. */
  line: THREE.Color
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

export function powerColour(power: string): THREE.Color {
  return new THREE.Color(POWERS[power] ?? FALLBACK[Math.floor(hash(power) * FALLBACK.length)])
}

/**
 * The style of `polity` when it answers to `power`. `client` washes the colour out;
 * the power's own core territory (Italia for Rome) is the undiluted colour.
 */
export function polityStyle(polity: string, power: string, opts: { client: boolean; core: boolean }): PolityStyle {
  const base = powerColour(power)
  const fill = base.clone()
  if (!opts.core) {
    // Provinces: a small, stable step in hue and lightness from the power's colour.
    const a = hash(polity) * 2 - 1
    const b = hash(`${polity}/l`) * 2 - 1
    offsetHSL(fill, a * 0.018, -0.04, 0.035 + b * 0.045)
  }
  if (opts.client) offsetHSL(fill.lerp(PARCHMENT, 0.38), 0, -0.02, 0)
  const line = base.clone()
  const hsl = { h: 0, s: 0, l: 0 }
  line.getHSL(hsl, THREE.SRGBColorSpace)
  line.setHSL(hsl.h, Math.min(1, hsl.s * 0.9), hsl.l * 0.32, THREE.SRGBColorSpace)
  return { fill, line }
}

/** HSL steps measured in sRGB, where they look even; three's own works in linear. */
function offsetHSL(c: THREE.Color, h: number, s: number, l: number) {
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl, THREE.SRGBColorSpace)
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return c.setHSL((hsl.h + h + 1) % 1, clamp(hsl.s + s), clamp(hsl.l + l), THREE.SRGBColorSpace)
}
