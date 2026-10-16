/**
 * When an Itiner-e road segment was built, in astronomical years (1 BCE = 0).
 *
 * Checked against all 259 distinct `Cons_per_e` values in the source. Years come
 * out astronomical (43 BCE is −42), converted here, once, at the edge.
 *
 * Itiner-e maps the network at its maximum extent, ca. 150 CE. Three fields matter,
 * and they do not mean the same thing:
 *
 *   Cons_per_e   Who built or paved the *Roman* road, as free text with a date in
 *                parentheses — "Manius Aquilius (129-126 BCE)". Populated on 3,191
 *                of 14,769 segments, and the only one dense enough to be worth reading.
 *   Lower_Date   The earliest the *route* is attested, which for a road laid over an
 *                older track is centuries before the Roman one. Gratiana–Histria
 *                carries Lower_Date −514 and Cons_per_e "Trajan (98-117 CE)": a Greek
 *                coastal route Trajan paved. Written with BCE negative, no year zero.
 *   Low_Date_E   A margin in years on Lower_Date, not a second bound.
 *
 * Cons_per_e wins wherever it is present: a road Trajan built is not a road Cicero
 * could travel, whatever older path it followed. 9999 is the source's "unknown".
 */
import { toAstronomical } from '@roma-cognita/schema'

const UNKNOWN = 9999

/** Attributions with no parenthesised date, spelled out rather than guessed at. [earliest, latest], astronomical. */
const NAMED_PERIODS: Record<string, [number, number]> = {
  'Julius Caesar': [toAstronomical(58, 'BCE'), toAstronomical(44, 'BCE')],
  Augustus: [toAstronomical(27, 'BCE'), 14],
  Nabatean: [toAstronomical(400, 'BCE'), 106],
  Byzantine: [330, 1453],
  'Tetrarchy or later': [293, 1453],
}

/**
 * [earliest, latest] from a parenthesised date range, astronomical.
 *
 * The vocabulary mixes eras inside one range — "Augustus-Nerva (12 BCE-98 CE)" — so
 * an era marker binds to the number it follows, and a bare number inherits from the
 * next marker to its right: "129-126 BCE" is both BCE, "193-324 CE" both CE.
 */
export function parsePeriod(text: string | null | undefined): [number, number] | null {
  if (!text) return null
  const inner = text.match(/\(([^)]*)\)/)?.[1]
  if (!inner) return NAMED_PERIODS[text.trim()] ?? null
  const tokens = [...inner.matchAll(/(\d+)\s*(BCE|BC|CE|AD)?/gi)].map((m) => ({
    value: Number(m[1]),
    era: m[2] ? (/^(BCE|BC)$/i.test(m[2]) ? 'BCE' : 'CE') : null,
  }))
  if (!tokens.length) return null
  let era: 'BCE' | 'CE' = 'CE'
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].era) era = tokens[i].era as 'BCE' | 'CE'
    else tokens[i].era = era
  }
  const years = tokens.map((t) =>
    t.value === 0 ? 0 : toAstronomical(t.value, t.era as 'BCE' | 'CE'),
  )
  return [Math.min(...years), Math.max(...years)]
}

export interface SegmentDates {
  Cons_per_e?: string | null
  Lower_Date?: number | null
  Low_Date_E?: number | null
}

/**
 * The first year the map may draw the segment, or null if the source cannot date it.
 *
 * The *latest* bound of a construction range decides: "Late Republic (72-30 BCE)"
 * yields 30 BCE, because the road may postdate every year before that and the map
 * must not claim otherwise. Without an attribution, Lower_Date plus its margin shows
 * the route existed by then — evidence of existence, never of absence.
 */
export function firstYear(p: SegmentDates): number | null {
  const built = parsePeriod(p.Cons_per_e)
  if (built) return built[1]
  const lower = p.Lower_Date
  if (lower == null || Math.abs(lower) === UNKNOWN) return null
  const margin =
    p.Low_Date_E != null && Math.abs(p.Low_Date_E) !== UNKNOWN ? p.Low_Date_E : 0
  const year = lower + margin
  // Source years have no zero: −514 is 514 BCE.
  return year < 0 ? year + 1 : year
}
