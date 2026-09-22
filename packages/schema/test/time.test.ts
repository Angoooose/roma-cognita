import { describe, expect, it } from 'vitest'
import {
  EndSchema,
  StartSchema,
  formatEndpoint,
  formatYear,
  mayOverlap,
  overlaps,
  parseEndpoint,
  parseEraString,
  parseEraYear,
  toAstronomical,
  type Interval,
} from '../src/index.ts'

const iv = (
  from: Parameters<typeof parseEndpoint>[0],
  to: Parameters<typeof parseEndpoint>[0],
) => ({ from: parseEndpoint(from), to: parseEndpoint(to) }) as Interval

describe('era years to astronomical', () => {
  it('puts 1 BCE at zero and shifts every BCE year by one', () => {
    expect(toAstronomical(1, 'BCE')).toBe(0)
    expect(toAstronomical(43, 'BCE')).toBe(-42)
    expect(toAstronomical(133, 'BCE')).toBe(-132)
    expect(toAstronomical(1, 'CE')).toBe(1)
    expect(toAstronomical(14, 'CE')).toBe(14)
  })

  it('makes arithmetic across the era boundary correct', () => {
    // 1 BCE to 1 CE is one year. With historical numbering (−1 → 1) it is two.
    expect(parseEraYear('1 CE').year - parseEraYear('1 BCE').year).toBe(1)
    // Augustus: 27 BCE to 14 CE is 40 years.
    expect(parseEraYear('14 CE').year - parseEraYear('27 BCE').year).toBe(40)
  })

  it('refuses a year zero in either era', () => {
    expect(() => parseEraYear('0 BCE')).toThrow()
    expect(() => parseEraYear('0 CE')).toThrow()
  })

  it('refuses signs and bare numbers, which is the ambiguity this exists to remove', () => {
    expect(() => parseEraYear('-43')).toThrow(/era explicitly/)
    expect(() => parseEraYear('43')).toThrow(/era explicitly/)
    expect(() => parseEraYear('-43 BCE')).toThrow()
  })

  it('accepts one spelling only', () => {
    for (const bad of ['43 BC', 'AD 14', '43 bce', 'ca. 81 BCE', 'c.81 BCE', '43BCE', '']) {
      expect(() => parseEraYear(bad), bad).toThrow()
    }
    expect(parseEraYear('  43   BCE ').year).toBe(-42)
  })

  it('formats back to era strings', () => {
    expect(formatYear(0)).toBe('1 BCE')
    expect(formatYear(-42)).toBe('43 BCE')
    expect(formatYear(1)).toBe('1 CE')
    expect(formatYear(-80, { circa: true })).toBe('c. 81 BCE')
    for (const y of [-500, -133, -1, 0, 1, 2, 14, 476]) {
      expect(parseEraYear(formatYear(y)).year).toBe(y)
    }
  })
})

describe('circa', () => {
  it('is kept as a flag, not dropped', () => {
    const e = parseEraString('c. 81 BCE')
    expect(e).toMatchObject({
      year: -80,
      earliest: -80,
      latest: -80,
      circa: true,
      open: null,
    })
    expect(e.text).toBe('c. 81 BCE')
    expect(parseEraString('81 BCE').circa).toBe(false)
  })

  it('survives a round trip', () => {
    expect(formatEndpoint(parseEraString('c. 81 BCE'))).toBe('c. 81 BCE')
  })

  it('may mark a fuzzy range', () => {
    const e = parseEndpoint({ earliest: 'c. 83 BCE', latest: '81 BCE' })
    expect(e.circa).toBe(true)
  })
})

describe('fuzzy endpoints', () => {
  it('render at the midpoint and keep the range', () => {
    const e = parseEndpoint({ earliest: '83 BCE', latest: '81 BCE' })
    expect(e).toMatchObject({ year: -81, earliest: -82, latest: -80, open: null })
  })

  it('round halves towards the later year', () => {
    expect(parseEndpoint({ earliest: '84 BCE', latest: '81 BCE' }).year).toBe(-81)
  })

  it('straddle the era boundary', () => {
    const e = parseEndpoint({ earliest: '2 BCE', latest: '2 CE' })
    expect(e).toMatchObject({ earliest: -1, latest: 2, year: 1 })
  })

  it('refuse a range that runs backwards', () => {
    expect(() => parseEndpoint({ earliest: '81 BCE', latest: '83 BCE' })).toThrow(
      /backwards/,
    )
  })

  it('round-trip', () => {
    const input = { earliest: '58 BCE', latest: '50 BCE' }
    expect(formatEndpoint(parseEndpoint(input))).toEqual(input)
  })
})

describe('open ends', () => {
  it('"before" is bounded above only, and renders at its bound', () => {
    const e = parseEraString('before 133 BCE')
    expect(e).toMatchObject({ year: -132, earliest: null, latest: -132, open: 'before' })
    expect(formatEndpoint(e)).toBe('before 133 BCE')
  })

  it('"after" is bounded below only', () => {
    const e = parseEraString('after 27 BCE')
    expect(e).toMatchObject({ year: -26, earliest: -26, latest: null, open: 'after' })
  })

  it('cannot be circa as well', () => {
    expect(() => parseEraString('before c. 70 BCE')).toThrow(/circa/)
  })

  it('"before" is a start and "after" is an end, never the other way round', () => {
    expect(StartSchema.safeParse('before 68 BCE').success).toBe(true)
    expect(StartSchema.safeParse('after 68 BCE').success).toBe(false)
    expect(EndSchema.safeParse('after 43 BCE').success).toBe(true)
    expect(EndSchema.safeParse('before 43 BCE').success).toBe(false)
  })
})

describe('dated days', () => {
  it('carry month, day and calendar for later, and render as the year', () => {
    const e = parseEndpoint({
      year: '44 BCE',
      month: 3,
      day: 15,
      calendar: 'roman-republican',
    })
    expect(e).toMatchObject({ year: -43, month: 3, day: 15, calendar: 'roman-republican' })
    expect(formatEndpoint(e)).toEqual({
      year: '44 BCE',
      month: 3,
      day: 15,
      calendar: 'roman-republican',
    })
  })

  it('refuse a day without a month', () => {
    expect(() => parseEndpoint({ year: '44 BCE', day: 15, calendar: 'julian' })).toThrow()
  })
})

describe('schemas', () => {
  it('report parse failures as zod issues', () => {
    const r = StartSchema.safeParse('-43')
    expect(r.success).toBe(false)
    expect(r.error?.issues[0].message).toMatch(/era explicitly/)
  })
})

describe('overlap', () => {
  it('is inclusive at both ends', () => {
    expect(overlaps(iv('68 BCE', '50 BCE'), iv('50 BCE', '43 BCE'))).toBe(true)
    expect(overlaps(iv('68 BCE', '50 BCE'), iv('49 BCE', '43 BCE'))).toBe(false)
  })

  it('distinguishes a certain overlap from a possible one', () => {
    const a = iv('68 BCE', 'after 50 BCE')
    const b = iv('45 BCE', '43 BCE')
    expect(overlaps(a, b)).toBe(false)
    expect(mayOverlap(a, b)).toBe(true)
  })
})
