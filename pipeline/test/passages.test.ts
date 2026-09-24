import { describe, expect, it } from 'vitest'
import { passages } from '../src/passages/fetch.ts'
import {
  findAnchor,
  parseRef,
  passageUrl,
  readLocator,
  workUrl,
} from '../src/passages/passage.ts'

/** A ToposText page with these anchors, each holding `text`. */
const topos = (...ids: [string, string?][]) =>
  ids
    .map(([id, text = '']) => `<div class="pSelector" id=${id}><p>${text}</p></div>`)
    .join('\n')

/** An anchor list as the index holds it, from "ref" or "ref anchor" strings. */
const refs = (...ps: string[]) =>
  ps.map((p) => {
    const [ref, anchor = ref] = p.split(' ')
    return [parseRef(ref)!, ref, anchor] as Parameters<typeof findAnchor>[0][number]
  })

describe('readLocator', () => {
  it('takes the first reference, at the start of its range', () => {
    expect(readLocator('16.2.10, 16.2.16, 16.2.18')).toEqual({ ref: '16.2.10' })
    expect(readLocator('34–41, 65–77')).toEqual({ ref: '34' })
    expect(readLocator('36.17a–19')).toEqual({ ref: '36.17a' })
  })

  it('reads past notes, book words and roman book numbers', () => {
    expect(readLocator('5.22 ("Cirta Sittianorum cognomine")')).toEqual({ ref: '5.22' })
    expect(readLocator('book 3')).toEqual({ ref: '3' })
    expect(readLocator('2.43 M')).toEqual({ ref: '2.43' })
    expect(readLocator('VII–VIII')).toEqual({ ref: '7' })
    expect(readLocator('XV')).toEqual({ ref: '15' })
  })

  it('names the part of a work in many parts, and needs one', () => {
    const parts = ['Cato Minor', 'C. Gracch.', 'Mithr.', 'BC']
    expect(readLocator('Cato Minor 34–38', parts)).toEqual({
      part: 'Cato Minor',
      ref: '34',
    })
    expect(readLocator('C. Gracch. 11', parts)).toEqual({ part: 'C. Gracch.', ref: '11' })
    expect(readLocator('BC 1.108–115', parts)).toEqual({ part: 'BC', ref: '1.108' })
    expect(readLocator('Lucullus 12', parts)).toBeUndefined()
  })
})

describe('findAnchor', () => {
  it('takes the reference itself', () => {
    expect(findAnchor(refs('16.2.9', '16.2.10', '16.2.11'), '16.2.10')).toBe('16.2.10')
  })

  it('takes the first section of a chapter cited whole', () => {
    expect(findAnchor(refs('33.4', '34.1', '34.3'), '34')).toBe('34.1')
  })

  it('takes the last anchor before it in the same unit', () => {
    expect(findAnchor(refs('5.21.8', '5.21.10'), '5.21.9')).toBe('5.21.8')
    expect(findAnchor(refs('14.69 14.4.4', '14.77 14.4.5'), '14.74')).toBe('14.4.4')
  })

  it('never lands in another chapter', () => {
    expect(findAnchor(refs('16.1.30', '16.3.1'), '16.2.10')).toBeUndefined()
  })

  it('never lands in another letter, printed in order of date', () => {
    const letters = refs('5.20', '5.21.8', '13.72', '13.74')
    expect(findAnchor(letters, '13.73', { unit: 2 })).toBeUndefined()
    expect(findAnchor(letters, '5.21.9', { unit: 2 })).toBe('5.21.8')
    expect(findAnchor(letters, '5.20.1', { unit: 2 })).toBe('5.20')
  })

  it("takes a unit's first anchor for a reference ahead of it", () => {
    expect(findAnchor(refs('13.395 13.15.4', '14.4 14.1.2', '14.8 14.1.3'), '14.1')).toBe(
      '14.1.2',
    )
  })

  it('compares lettered chapters in order', () => {
    expect(findAnchor(refs('36.17.3', '36.17a', '36.18.1'), '36.17a')).toBe('36.17a')
  })

  it('wants the fragment itself when asked to be exact', () => {
    expect(findAnchor(refs('2.42', '2.45'), '2.43', { exact: true })).toBeUndefined()
  })
})

describe('passages', () => {
  it('reads each anchor as the reference it carries', () => {
    expect(passages(topos(['1.1.1'], ['1.1.2'], ['17a.']), { page: 1 })).toEqual([
      ['1.1.1', '1.1.1'],
      ['1.1.2', '1.1.2'],
      ['17a', '17a'],
    ])
  })

  it("drops Appian's chapter group and strips a prefix", () => {
    expect(
      passages(topos(['3.15'], ['1.7']), { page: 1, drop: 0 }).map(([r]) => r),
    ).toEqual(['7', '15'])
    expect(
      passages(topos(['1.1.7'], ['4.7.54']), { page: 1, drop: 1 }).map(([r]) => r),
    ).toEqual(['1.7', '4.54'])
    expect(passages(topos(['JCa.22'], ['praef']), { page: 1, strip: /^JCa\./ })).toEqual([
      ['22', 'JCa.22'],
    ])
  })

  it('reads the sections printed inside old chapters', () => {
    const html = topos(
      ['14.4.3', '[64] Which thing… [65] And'],
      ['14.4.4', '[69] But when'],
    )
    expect(passages(html, { page: 1, inline: 'book' })).toEqual([
      ['14.64', '14.4.3'],
      ['14.65', '14.4.3'],
      ['14.69', '14.4.4'],
    ])
    expect(
      passages(topos(['5', '[11] that in… [12] See']), { page: 1, inline: 'bare' }),
    ).toEqual([
      ['11', '5'],
      ['12', '5'],
    ])
  })

  it("reads attalus.org's named anchors", () => {
    const html = '<A CLASS="green" NAME="2.43M">{2.43M}</A> <A NAME="2.41">[2.41]</A>'
    expect(passages(html, { page: '', site: 'attalus', strip: /M$/ })).toEqual([
      ['2.43', '2.43M'],
    ])
  })
})

describe('passageUrl', () => {
  it('links into the recorded pages', () => {
    expect(passageUrl('strabo', '16.2.10, 16.2.16')).toBe(
      'https://topostext.org/work/144#16.2.10',
    )
    expect(passageUrl('appian', 'Mithr. 114')).toBe('https://topostext.org/work/496#17.114')
    expect(passageUrl('sallust-hist', '2.43 M')).toBe(
      'https://www.attalus.org/translate/sallust.html#2.43M',
    )
  })

  it("puts Perseus's passage in the address", () => {
    expect(passageUrl('caesar-bc', '1.34–36, 2.1–22')).toBe(
      'https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.02.0076:book=1:chapter=34',
    )
  })

  it("links a Pleiades locator to the first place's page", () => {
    expect(passageUrl('pleiades', 'places/727142, 727169')).toBe(
      'https://pleiades.stoa.org/places/727142',
    )
    expect(passageUrl('pleiades', 'the gazetteer')).toBeUndefined()
  })

  it("links an OpenStreetMap locator to the first element's page", () => {
    expect(passageUrl('osm-rome', 'way/112675404, way/105281824')).toBe(
      'https://www.openstreetmap.org/way/112675404',
    )
    expect(passageUrl('osm-rome', 'relation/1841081')).toBe(
      'https://www.openstreetmap.org/relation/1841081',
    )
    expect(passageUrl('osm-rome', 'the Forum')).toBeUndefined()
  })

  it("links a Platner & Ashby locator to its article on LacusCurtius", () => {
    const base =
      'https://penelope.uchicago.edu/Thayer/E/Gazetteer/Places/Europe/Italy/Lazio/Roma/Rome/_Texts/PLATOP*'
    expect(passageUrl('platner-ashby', 'Pons Fabricius, p. 400')).toBe(`${base}/Pons_Fabricius.html`)
    expect(passageUrl('platner-ashby', 'Vesta#aedes, pp. 556–559')).toBe(`${base}/Vesta.html#aedes`)
    expect(passageUrl('platner-ashby', 'p. 400')).toBeUndefined()
  })

  it('gives nothing for a work we have no page for, or no locator', () => {
    expect(passageUrl('broughton-mrr', 'vol. II')).toBeUndefined()
    expect(passageUrl('strabo')).toBeUndefined()
    expect(workUrl('strabo')).toBe('https://topostext.org/work/144')
    expect(workUrl('appian')).toBeUndefined()
  })
})
