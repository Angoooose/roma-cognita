/**
 * River sizing, shared by the terrain worker (which decides which rivers a tile carries)
 * and the shader (which decides how wide each is drawn and whether it shows yet). The
 * two must agree, or rivers would pop where a tile's cut-off and the shader's fade
 * disagree.
 */

/**
 * The smallest river worth drawing when a screen pixel covers this much ground. At the
 * overview (~3 km/px) that is ~450 m³/s — the Nile, Danube, Rhône, Po, Euphrates; at
 * regional zoom (~50 m/px) it is ~2 m³/s. The shader fades a river in between this
 * discharge and twice it.
 */
export function riverMinDischarge(metresPerPixel: number) {
  return (metresPerPixel / 30) ** 1.3
}

/** The half-width a river really has, m: hydraulic geometry, width ∝ √discharge. */
export function riverHalfWidth(q: number) {
  return 3 * Math.sqrt(q)
}
