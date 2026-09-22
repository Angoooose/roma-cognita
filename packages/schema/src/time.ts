/**
 * Time, as authored and as computed.
 *
 * Authors write explicit era strings — `63 BCE`, `14 CE`, `c. 81 BCE` — and
 * never a sign. The build converts them to astronomical integers, where 1 BCE
 * is 0 and 43 BCE is −42, so that subtraction across the era boundary is
 * correct: 1 BCE to 1 CE is one year, not two. cicero-map wrote −43 for 43 BCE
 * and called it astronomical; that was harmless while the window was all BCE,
 * and is exactly the ambiguity this module exists to remove.
 *
 * Every interval is inclusive of both ends, in whole years (DESIGN §5.2).
 *
 * An endpoint is one of:
 *
 * - a year, optionally marked circa (`c. 81 BCE`). Circa is a flag carried to
 *   the inspector, never silently dropped: it is the author saying the year is
 *   conventional.
 * - a fuzzy range `{ earliest, latest }`. The renderer takes the midpoint; the
 *   inspector shows the range.
 * - an open end: `before 68 BCE` as a start, `after 43 BCE` as an end. It
 *   means "in force at that year, and extending beyond it in that direction by
 *   an amount this record does not state". It is a bound, not a guess — see
 *   data/README.md — and it is distinct from an unknown date, which the schema
 *   does not allow at all (a record without a date cannot take part in the
 *   timeline).
 * - a dated day, `{ year, month?, day?, calendar }`. v1 works in whole years;
 *   the shape exists so Cicero's letters can be dated to the day later without
 *   a schema change. The pre-45 BCE Roman calendar drifted months out of step
 *   with the seasons, so a day is meaningless without saying which calendar.
 */
import { z } from 'zod'

/** An astronomical year: 1 BCE = 0, 43 BCE = −42, 14 CE = 14. */
export type Year = number

export type Era = 'BCE' | 'CE'

export type Calendar = 'roman-republican' | 'julian'

export interface Endpoint {
  /** The value the renderer uses: the year, the midpoint of a range, or an open end's bound. */
  year: Year
  /** Earliest possible value; null when the end is open in that direction. */
  earliest: Year | null
  /** Latest possible value; null when the end is open in that direction. */
  latest: Year | null
  circa: boolean
  /** `before` only ever appears on a start, `after` only on an end. */
  open: 'before' | 'after' | null
  month?: number
  day?: number
  calendar?: Calendar
  /** The authored form, normalised, for messages and round-tripping. */
  text: string
}

export interface Interval {
  from: Endpoint
  to: Endpoint
}

export class EraParseError extends Error {}

const YEAR = /^(c\.\s+)?([1-9]\d*)\s+(BCE|CE)$/
const OPEN = /^(before|after)\s+(.+)$/

/** `43 BCE` → −42. Throws on a year of zero, which no era has. */
export function toAstronomical(n: number, era: Era): Year {
  if (!Number.isInteger(n) || n < 1) {
    throw new EraParseError(`era years start at 1; got ${n} ${era}`)
  }
  return era === 'BCE' ? 1 - n : n
}

/** −42 → `43 BCE`, 14 → `14 CE`. */
export function formatYear(year: Year, opts: { circa?: boolean } = {}): string {
  if (!Number.isInteger(year)) throw new EraParseError(`not a whole year: ${year}`)
  const s = year <= 0 ? `${1 - year} BCE` : `${year} CE`
  return opts.circa ? `c. ${s}` : s
}

/**
 * Parses a single era year, with an optional circa marker.
 *
 * Deliberately strict: `BCE`/`CE` only, exactly `c. ` for circa, no signs, no
 * `BC`/`AD`. A data file that says the same thing four ways is a data file that
 * will one day say two different things.
 */
export function parseEraYear(input: string): { year: Year; circa: boolean } {
  const s = input.trim()
  const m = YEAR.exec(s)
  if (!m) {
    const hint = /^-?\d+$/.test(s)
      ? ' — write the era explicitly, e.g. "43 BCE"; never a bare or signed number'
      : ' — expected e.g. "63 BCE", "14 CE" or "c. 81 BCE"'
    throw new EraParseError(`cannot read "${input}" as a year${hint}`)
  }
  return { year: toAstronomical(Number(m[2]), m[3] as Era), circa: Boolean(m[1]) }
}

function yearEndpoint(year: Year, circa: boolean): Endpoint {
  return {
    year,
    earliest: year,
    latest: year,
    circa,
    open: null,
    text: formatYear(year, { circa }),
  }
}

/** Parses `63 BCE`, `c. 81 BCE`, `before 133 BCE` or `after 27 BCE`. */
export function parseEraString(input: string): Endpoint {
  const s = input.trim().replace(/\s+/g, ' ')
  const open = OPEN.exec(s)
  if (open) {
    const bound = open[1] as 'before' | 'after'
    const { year, circa } = parseEraYear(open[2])
    // "before c. 70 BCE" stacks two kinds of vagueness and cannot be drawn any
    // differently from "before 70 BCE"; refuse it rather than carry noise.
    if (circa) throw new EraParseError(`"${input}": an open end cannot also be circa`)
    return {
      year,
      earliest: bound === 'before' ? null : year,
      latest: bound === 'after' ? null : year,
      circa: false,
      open: bound,
      text: `${bound} ${formatYear(year)}`,
    }
  }
  const { year, circa } = parseEraYear(s)
  return yearEndpoint(year, circa)
}

export type EndpointInput =
  | string
  | { earliest: string; latest: string; circa?: boolean }
  | { year: string; month?: number; day?: number; calendar: Calendar }

/** The midpoint of a fuzzy range, halves rounded towards the later year. */
const midpoint = (a: Year, b: Year) => Math.round((a + b) / 2)

export function parseEndpoint(input: EndpointInput): Endpoint {
  if (typeof input === 'string') return parseEraString(input)
  if ('earliest' in input) {
    const a = parseEraYear(input.earliest)
    const b = parseEraYear(input.latest)
    if (b.year < a.year) {
      throw new EraParseError(`range ${input.earliest}–${input.latest} runs backwards`)
    }
    const circa = Boolean(input.circa || a.circa || b.circa)
    return {
      year: midpoint(a.year, b.year),
      earliest: a.year,
      latest: b.year,
      circa,
      open: null,
      text: `${formatYear(a.year)}–${formatYear(b.year)}${circa ? ' (c.)' : ''}`,
    }
  }
  const { year, circa } = parseEraYear(input.year)
  const e = yearEndpoint(year, circa)
  if (input.day !== undefined && input.month === undefined) {
    throw new EraParseError(`${input.year}: a day needs a month`)
  }
  return { ...e, month: input.month, day: input.day, calendar: input.calendar }
}

/** Back to the authoring form. Round-trips everything `parseEndpoint` accepts. */
export function formatEndpoint(e: Endpoint): EndpointInput {
  if (e.open) return `${e.open} ${formatYear(e.year)}`
  if (e.earliest !== null && e.latest !== null && e.earliest !== e.latest) {
    return {
      earliest: formatYear(e.earliest),
      latest: formatYear(e.latest),
      ...(e.circa ? { circa: true } : {}),
    }
  }
  if (e.calendar) {
    return {
      year: formatYear(e.year),
      ...(e.month !== undefined ? { month: e.month } : {}),
      ...(e.day !== undefined ? { day: e.day } : {}),
      calendar: e.calendar,
    }
  }
  return formatYear(e.year, { circa: e.circa })
}

/** Lowest year the endpoint could stand for; −∞ for `before`. */
export const lowest = (e: Endpoint) => e.earliest ?? -Infinity
/** Highest year the endpoint could stand for; +∞ for `after`. */
export const highest = (e: Endpoint) => e.latest ?? Infinity

/** True when the interval is in force in `year`, by the renderer's reading. */
export const contains = (i: Interval, year: Year) =>
  i.from.year <= year && year <= i.to.year

/** Whether two intervals share a year, by the renderer's reading of each endpoint. */
export const overlaps = (a: Interval, b: Interval) =>
  a.from.year <= b.to.year && b.from.year <= a.to.year

/** Whether two intervals *could* share a year under some reading of their fuzzy or open ends. */
export const mayOverlap = (a: Interval, b: Interval) =>
  lowest(a.from) <= highest(b.to) && lowest(b.from) <= highest(a.to)

// --- zod ---------------------------------------------------------------------

const CalendarSchema = z.enum(['roman-republican', 'julian'])

const EndpointInputSchema = z.union([
  z.string(),
  z.strictObject({
    earliest: z.string(),
    latest: z.string(),
    circa: z.boolean().optional(),
  }),
  z.strictObject({
    year: z.string(),
    month: z.number().int().min(1).max(12).optional(),
    day: z.number().int().min(1).max(31).optional(),
    calendar: CalendarSchema,
  }),
])

const endpoint = (role: 'start' | 'end') =>
  EndpointInputSchema.transform((input, ctx): Endpoint => {
    try {
      const e = parseEndpoint(input)
      if (role === 'start' && e.open === 'after') {
        ctx.addIssue({
          code: 'custom',
          message: `a start cannot be "after …"; give a range { earliest, latest } instead`,
        })
        return z.NEVER
      }
      if (role === 'end' && e.open === 'before') {
        ctx.addIssue({
          code: 'custom',
          message: `an end cannot be "before …"; give a range { earliest, latest } instead`,
        })
        return z.NEVER
      }
      return e
    } catch (err) {
      ctx.addIssue({ code: 'custom', message: (err as Error).message })
      return z.NEVER
    }
  })

/** A start endpoint: a year, a range, or `before <year>`. */
export const StartSchema = endpoint('start')
/** An end endpoint: a year, a range, or `after <year>`. */
export const EndSchema = endpoint('end')

/** The `from`/`to` pair every dated record carries. */
export const intervalFields = { from: StartSchema, to: EndSchema }
