import { describe, expect, it } from 'vitest'
import { firstYear, parsePeriod } from '../src/roads/dating.ts'

// Astronomical: 129 BCE is −128.
describe('parsePeriod', () => {
  it('reads a BCE range', () => expect(parsePeriod('Manius Aquilius (129-126 BCE)')).toEqual([-128, -125]))
  it('binds era markers to the number they follow', () =>
    expect(parsePeriod('Augustus-Nerva (12 BCE-98 CE)')).toEqual([-11, 98]))
  it('lets a bare number inherit the next marker', () => expect(parsePeriod('Severans (193-324 CE)')).toEqual([193, 324]))
  it('knows the named periods', () => expect(parsePeriod('Julius Caesar')).toEqual([-57, -43]))
  it('returns null for nothing', () => expect(parsePeriod(null)).toBeNull())
})

describe('firstYear', () => {
  it('takes the latest bound of a construction range', () =>
    expect(firstYear({ Cons_per_e: 'Late Republic (72-30 BCE)' })).toBe(-29))
  it('lets the Roman builder outrank an older route', () =>
    expect(firstYear({ Cons_per_e: 'Trajan (98-117 CE)', Lower_Date: -514 })).toBe(117))
  it('falls back to Lower_Date with its margin, converted to astronomical', () =>
    expect(firstYear({ Lower_Date: -312, Low_Date_E: 0 })).toBe(-311))
  it('treats 9999 as unknown', () => expect(firstYear({ Lower_Date: 9999 })).toBeNull())
  it('dates the Via Appia to 312 BCE', () => expect(firstYear({ Cons_per_e: 'Appius Claudius Caecus (312 BCE)' })).toBe(-311))
})
