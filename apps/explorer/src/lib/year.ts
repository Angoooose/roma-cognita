/** Astronomical → `63 BCE`. */
export function formatYear(y: number) {
  return y <= 0 ? `${1 - y} BCE` : `${y} CE`
}

/** `63BCE`, `63 BCE`, `14CE` → astronomical (1 BCE = 0). */
export function parseYear(s: string): number {
  const m = /^(\d+)\s*(BCE|BC|CE|AD)?$/i.exec(s.trim())
  if (!m) return -62
  const n = Number(m[1])
  return /^(CE|AD)$/i.test(m[2] ?? '') ? n : 1 - n
}

/** A range of astronomical years: `58–51 BCE`, `49 BCE – 14 CE`, or one year. */
export function formatSpan([a, b]: [number, number]) {
  if (a === b) return formatYear(a)
  if (a <= 0 && b <= 0) return `${1 - a}–${formatYear(b)}`
  return `${formatYear(a)} – ${formatYear(b)}`
}
