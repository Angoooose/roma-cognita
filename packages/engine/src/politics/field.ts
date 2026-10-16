/**
 * The corner's distance re-expressed against the pair (lo, hi): its own value if it
 * has the same pair, otherwise its distance with the sign of whichever side of that
 * pair it is on. Pairs only change where two boundaries are equally far away, so
 * this only matters far from any line — but there, mixing distances to different
 * boundaries unconverted would draw a phantom border along the midline.
 */
export function alignDistance(
  lo: number,
  hi: number,
  clo: number,
  chi: number,
  cd: number,
) {
  if (clo === lo && chi === hi) return cd
  const own = cd > 0 ? chi : clo
  return own === hi ? Math.abs(cd) : -Math.abs(cd)
}
