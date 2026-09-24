import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  formatYear,
  parseEraString,
  type DprrProvince,
  type OfficeRole,
  type PersonId,
} from '@roman-map/schema'
import {
  activeSpan,
  applyCorrections,
  collapseRelationships,
  displayName,
  dprrYear,
  fullName,
  type RelationshipAssertion,
} from '../src/people/build.ts'
import { joinGovernors, unattestedYears } from '../src/people/governors.ts'
import { classifyOffices } from '../src/people/offices.ts'

describe('dprrYear', () => {
  it('reads DPRR’s BCE years as astronomical ones', () => {
    // DPRR writes Cicero's consulship as −63; that is 63 BCE, astronomical −62.
    expect(dprrYear('-63')).toBe(-62)
    expect(formatYear(dprrYear('-63'))).toBe('63 BCE')
    expect(dprrYear('-1')).toBe(0)
    expect(formatYear(dprrYear('-1'))).toBe('1 BCE')
  })

  it('keeps CE years as they are', () => {
    expect(dprrYear('14')).toBe(14)
  })

  it('refuses a year zero, which DPRR’s numbering does not have', () => {
    expect(() => dprrYear('0')).toThrow()
    expect(() => dprrYear('')).toThrow()
    expect(() => dprrYear('c. 63')).toThrow()
  })
})

describe('names', () => {
  it('builds the short form, dropping an unknown praenomen', () => {
    expect(displayName({ praenomen: 'M.', nomen: 'Tullius', cognomen: 'Cicero' })).toBe(
      'M. Tullius Cicero',
    )
    expect(displayName({ praenomen: '-.', nomen: 'Sulpicius', cognomen: 'Galba' })).toBe(
      'Sulpicius Galba',
    )
    expect(displayName({ nomen: 'Tullia' })).toBe('Tullia')
  })

  it('strips the code and RE number from the full nomenclature, keeping an alternative name’s', () => {
    expect(
      fullName('TULL2072 M. Tullius (29) M. f. M. n. Cor. Cicero', 'TULL2072', '29'),
    ).toBe('M. Tullius M. f. M. n. Cor. Cicero')
    expect(
      fullName(
        'CAEC2347 Q. Caecilius (99) Q. f. Q. n. Fab. Metellus Pius Scipio = P. Cornelius (352) Scipio Nasica',
        'CAEC2347',
        '99',
      ),
    ).toBe(
      'Q. Caecilius Q. f. Q. n. Fab. Metellus Pius Scipio = P. Cornelius (352) Scipio Nasica',
    )
    expect(fullName('TULL3928  Tullia (60)', 'TULL3928', '60')).toBe('Tullia')
  })
})

describe('activeSpan', () => {
  it('prefers the span of dated assertions', () => {
    expect(activeSpan([-62, -105, -42], { from: '-106', to: '-43' })).toEqual({
      from: -105,
      to: -42,
      basis: 'assertions',
    })
  })

  it('falls back to DPRR’s era only when both ends are BCE', () => {
    expect(activeSpan([], { from: '-125', to: '-80' })).toEqual({
      from: -124,
      to: -79,
      basis: 'era',
    })
    // A zero end is not a year; a positive end may be CE or a lost minus sign.
    expect(activeSpan([], { from: '-100', to: '0' })).toBeUndefined()
    expect(activeSpan([], { from: '-125', to: '25' })).toBeUndefined()
  })
})

describe('applyCorrections', () => {
  const tables = () => ({
    posts: [{ post: 'http://x/entity/PostAssertion/7556', start: '-99', end: '95' }],
    statuses: [],
  })

  it('applies a correction whose expected value is present', () => {
    const t = tables()
    const report = applyCorrections(t, [
      { table: 'posts', id: 7556, field: 'end', expect: '95', value: '-95', why: 'sign' },
    ])
    expect(t.posts[0].end).toBe('-95')
    expect(report.applied).toHaveLength(1)
  })

  it('reports a correction as out of date, and changes nothing, once the value differs', () => {
    const t = tables()
    t.posts[0].end = '-95'
    const report = applyCorrections(t, [
      { table: 'posts', id: 7556, field: 'end', expect: '95', value: '-96', why: 'sign' },
    ])
    expect(t.posts[0].end).toBe('-95')
    expect(report.stale).toEqual([expect.objectContaining({ found: '-95' })])
  })
})

describe('collapseRelationships', () => {
  // DPRR ids: 5 father of, 12 son of, 13 daughter of, 20 mother of, 30 married to.
  const INVERSE: Record<string, number> = {
    '5|male': 12,
    '5|female': 13,
    '12|male': 5,
    '12|female': 20,
    '13|male': 5,
    '20|male': 12,
    '30|male': 30,
    '30|female': 30,
  }
  const SEX: Record<string, 'male' | 'female'> = {
    'dprr:2072': 'male',
    'dprr:4078': 'female',
    'dprr:3928': 'female',
    'dprr:3940': 'female',
  }
  const rel = (
    id: number,
    person: PersonId,
    type: number,
    related: PersonId,
    extra?: string,
  ): RelationshipAssertion => ({
    id,
    person,
    related,
    type,
    uncertain: false,
    source: 1,
    ...(extra ? { extra } : {}),
    citations: [],
    notes: [],
  })
  const collapse = (list: RelationshipAssertion[]) =>
    collapseRelationships(
      list,
      (p) => SEX[p],
      (t, s) => INVERSE[`${t}|${s}`],
    )

  it('merges a pair into one edge, in the direction DPRR’s editors wrote', () => {
    // Cicero son of Helvia (generated), Helvia mother of Cicero (written).
    const { edges, report } = collapse([
      rel(1, 'dprr:2072', 12, 'dprr:4078', 'Autogenerated by add_inverse'),
      rel(2, 'dprr:4078', 20, 'dprr:2072'),
    ])
    expect(edges).toEqual([
      expect.objectContaining({
        a: 'dprr:4078',
        type: 20,
        b: 'dprr:2072',
        inverse: 12,
        assertions: [1, 2],
      }),
    ])
    expect(edges[0].notes).toEqual([])
    expect(report.merged).toBe(2)
  })

  it('takes the inverse from the sex of the other person', () => {
    // Cicero father of Tullia → Tullia daughter of Cicero, not son of.
    const { edges } = collapse([
      rel(1, 'dprr:2072', 5, 'dprr:3928'),
      rel(2, 'dprr:3928', 13, 'dprr:2072'),
    ])
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ type: 5, inverse: 13 })
  })

  it('keeps two different relationships between the same pair apart', () => {
    // Married to and divorced from Terentia are two facts, not one.
    const { edges } = collapse([
      rel(1, 'dprr:2072', 30, 'dprr:3940'),
      rel(2, 'dprr:3940', 30, 'dprr:2072'),
      rel(3, 'dprr:2072', 31, 'dprr:3940'),
    ])
    expect(edges.map((e) => e.type).sort()).toEqual([30, 31])
  })

  it('keeps an assertion with no mirror, and folds a repeat into the edge it repeats', () => {
    const { edges, report } = collapse([
      rel(1, 'dprr:2072', 5, 'dprr:3928'),
      rel(2, 'dprr:3928', 13, 'dprr:2072'),
      rel(3, 'dprr:2072', 5, 'dprr:3928'),
      rel(4, 'dprr:4078', 20, 'dprr:3928'), // no mirror, and no inverse for a female child
    ])
    expect(edges).toHaveLength(2)
    expect(edges[0].assertions).toEqual([1, 2, 3])
    expect(report).toMatchObject({ merged: 2, duplicates: 1, unmatched: 1 })
    expect(report.noInverse).toEqual(new Set(['20/female']))
  })

  it('folds a relationship stated twice as two pairs into one edge', () => {
    const { edges, report } = collapse([
      rel(1, 'dprr:2072', 5, 'dprr:3928'),
      rel(2, 'dprr:3928', 13, 'dprr:2072'),
      rel(3, 'dprr:2072', 5, 'dprr:3928'),
      rel(4, 'dprr:3928', 13, 'dprr:2072'),
    ])
    expect(edges).toHaveLength(1)
    expect(edges[0].assertions).toEqual([1, 2, 3, 4])
    expect(report).toMatchObject({ merged: 2, duplicates: 2 })
  })
})

describe('classifyOffices', () => {
  const tree = [
    { id: 1, name: 'Magisterial Posts' },
    { id: 3, name: 'consul', parent: 1 },
    { id: 121, name: 'consul designatus', parent: 3 },
    { id: 214, name: 'Promagisterial Posts' },
    { id: 197, name: 'proconsul', parent: 214 },
    { id: 190, name: 'proquaestor', parent: 214 },
    { id: 218, name: 'repulsae', parent: 1 },
    { id: 254, name: 'repulsa (cos.)', parent: 218 },
    { id: 999, name: 'something new', parent: 1 },
  ]

  it('takes the nearest rule up the tree', () => {
    const roles = classifyOffices(tree)
    expect(roles.get(3)).toBe('command')
    expect(roles.get(121)).toBe('magistracy')
    expect(roles.get(197)).toBe('command')
    expect(roles.get(190)).toBe('staff')
    expect(roles.get(254)).toBe('candidacy')
  })

  it('leaves an office no rule reaches as other, for the build to report', () => {
    expect(classifyOffices(tree).get(999)).toBe('other')
  })
})

// Against the real build, when there is one: the facts the phase is built on.
const BUILD = resolve(import.meta.dirname, '../../build/people')
describe.skipIf(!existsSync(join(BUILD, 'manifest.json')))('build/people', () => {
  const read = <T>(name: string): T =>
    JSON.parse(readFileSync(join(BUILD, `${name}.json`), 'utf8'))
  const persons = read<{ id: string; name: string; en?: { label?: string } }[]>('persons')
  const posts = read<
    {
      person: string
      office: number
      from: { year: number }
      provinces: { id: number }[]
    }[]
  >('posts')
  const authorities = read<{
    offices: { id: number; name: string; role: string }[]
    provinces: { id: number; name: string }[]
  }>('authorities')
  const office = (id: number) => authorities.offices.find((o) => o.id === id)!

  it('has Cicero consul in 63 BCE', () => {
    const cicero = persons.find((p) => p.id === 'dprr:2072')!
    expect(cicero.name).toBe('M. Tullius Cicero')
    const consul = posts.filter(
      (p) => p.person === 'dprr:2072' && office(p.office).name === 'consul',
    )
    expect(consul.map((p) => formatYear(p.from.year))).toEqual(['63 BCE'])
  })

  it('tells Cicero the governor of Cilicia from his staff, in 51 BCE', () => {
    const cilicia = authorities.provinces.find((p) => p.name === 'Cilicia')!.id
    const in51 = posts.filter(
      (p) => p.from.year === -50 && p.provinces.some((x) => x.id === cilicia),
    )
    const role = (person: string) =>
      in51.filter((p) => p.person === person).map((p) => office(p.office).role)
    expect(role('dprr:2072')).toEqual(['command'])
    expect(role('dprr:2216')).toEqual(['staff']) // his brother Quintus, legatus
  })

  it('classifies every office that has a post', () => {
    const used = new Set(posts.map((p) => p.office))
    expect(authorities.offices.filter((o) => used.has(o.id) && o.role === 'other')).toEqual(
      [],
    )
  })
})

describe('joinGovernors', () => {
  const post = (
    id: number,
    office: number,
    from: number,
    to: number,
    province: number,
  ) => ({
    id,
    person: `dprr:${id}` as PersonId,
    office,
    from: { year: from, uncertain: false },
    to: { year: to, uncertain: false },
    uncertain: false,
    provinces: [{ id: province, uncertain: false }],
    source: 1,
    citations: [],
  })
  const names: Record<number, string> = {
    1: 'Cilicia',
    2: 'Cyprus',
    3: 'repetundae',
    4: 'Nowhere',
  }
  const roles: Record<number, OfficeRole> = { 10: 'command', 11: 'staff', 12: 'magistracy' }
  const table = [
    {
      dprr: 'Cilicia',
      kind: 'territory',
      polities: [{ polity: 'cilicia' }],
      confidence: 'certain',
      review: 'draft',
    },
    {
      dprr: 'Cyprus',
      kind: 'territory',
      polities: [
        { polity: 'cilicia', from: parseEraString('58 BCE'), to: parseEraString('48 BCE') },
      ],
      confidence: 'probable',
      review: 'draft',
    },
    {
      dprr: 'repetundae',
      kind: 'court',
      polities: [],
      confidence: 'certain',
      review: 'draft',
    },
  ] as DprrProvince[]
  const join = (posts: ReturnType<typeof post>[]) =>
    joinGovernors(
      posts,
      (id) => names[id],
      (o) => roles[o],
      table,
      new Set(['cilicia']),
      new Set(Object.values(names)),
    )

  it('spreads a post over its years, for command and staff only', () => {
    const { records } = join([
      post(1, 10, -51, -50, 1),
      post(2, 11, -50, -50, 1),
      post(3, 12, -50, -50, 1),
    ])
    expect(records.map((r) => [r.post, r.year, r.role])).toEqual([
      [1, -51, 'command'],
      [1, -50, 'command'],
      [2, -50, 'staff'],
    ])
  })

  it('keeps the province each year came from, for a post that names several', () => {
    const two = {
      ...post(1, 10, -50, -50, 1),
      provinces: [1, 2].map((id) => ({ id, uncertain: false })),
    }
    const { records } = join([two])
    // Cyprus counts for Cilicia in 50 BCE too: two rows, one from each province.
    expect(records.map((r) => [r.polity, r.province])).toEqual([
      ['cilicia', 1],
      ['cilicia', 2],
    ])
  })

  it('marks everyone an uncertain join brings as uncertain there', () => {
    const doubtful = table.map((t) =>
      t.dprr === 'Cilicia'
        ? { ...t, polities: [{ polity: 'cilicia', confidence: 'uncertain' as const }] }
        : t,
    )
    const { records } = joinGovernors(
      [post(1, 10, -50, -50, 1)],
      (id) => names[id],
      (o) => roles[o],
      doubtful,
      new Set(['cilicia']),
      new Set(Object.values(names)),
    )
    expect(records.map((r) => r.uncertain)).toEqual([true])
  })

  it('joins a dated territory only inside its dates', () => {
    // 60–55 BCE in Cyprus (−59…−54) counts for Cilicia only from 58 BCE (−57).
    const { records } = join([post(1, 10, -59, -54, 2)])
    expect(records.map((r) => r.year)).toEqual([-57, -56, -55, -54])
  })

  it('never puts a court on the map, and reports names the table lacks', () => {
    const { records, report } = join([post(1, 10, -50, -50, 3), post(2, 10, -50, -50, 4)])
    expect(records).toEqual([])
    expect(report.unlisted).toEqual(new Map([['Nowhere', 1]]))
  })

  it('finds the years with nobody in command', () => {
    const { records } = join([post(1, 10, -51, -50, 1), post(2, 11, -49, -49, 1)])
    const years = new Map([['cilicia', new Set([-52, -51, -50, -49])]])
    expect(unattestedYears(years, records)).toEqual(new Map([['cilicia', [-52, -49]]]))
  })
})
