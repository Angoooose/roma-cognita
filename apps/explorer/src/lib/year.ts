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
