import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { People } from './people.ts'

// The panels' reading of the real build: what a reader should see for Cicero.
const BUILD = resolve(import.meta.dirname, '../../../../build/people')
const built = existsSync(join(BUILD, 'governorships.json'))

describe.skipIf(!built)('People, over build/people', () => {
  const read = (name: string) =>
    JSON.parse(readFileSync(join(BUILD, `${name}.json`), 'utf8'))
  const people = new People({
    persons: read('persons'),
    posts: read('posts'),
    relationships: read('relationships'),
    statuses: read('statuses'),
    lifeEvents: read('lifeEvents'),
    authorities: read('authorities'),
    governorships: read('governorships'),
  })
  const CICERO = 'dprr:2072' as const

  it('names each relative by what they were to him, grouped', () => {
    const family = Object.fromEntries(
      people
        .family(CICERO)
        .map((g) => [
          g.name,
          g.relatives.map((r) => `${r.person.name}: ${r.labels.join(', ')}`),
        ]),
    )
    expect(family.Parents).toEqual(expect.arrayContaining(['Helvia: mother']))
    expect(family.Siblings).toEqual(['Q. Tullius Cicero: brother'])
    expect(family.Children).toEqual(
      expect.arrayContaining(['Tullia: daughter', 'M. Tullius Cicero: son']),
    )
    // Married and divorced are two facts about one person: one row, both words.
    expect(family.Spouses).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Terentia: (married, divorced|divorced, married)$/),
      ]),
    )
  })

  it('tells his career in order, with his consulship in 63 BCE', () => {
    const { lines } = people.career(CICERO)
    const years = lines.map((l) => l.from)
    expect(years).toEqual([...years].sort((a, b) => a - b))
    expect(lines.find((l) => l.label === 'Consul')?.from).toBe(-62)
    expect(people.lifespan(CICERO).born?.year).toBe(-105)
  })

  it.skipIf(!people.isJoined('cilicia'))(
    'puts Appius Claudius before Cicero in command of Cilicia in 51 BCE, with Quintus on the staff',
    () => {
      const { command, staff } = people.governors('cilicia', -50)
      expect(command.map((s) => s.person.id)).toEqual(['dprr:2140', CICERO])
      expect(command[1].tenure).toEqual([-50, -49])
      expect(staff.map((s) => s.person.id)).toContain('dprr:2216')
    },
  )

  it('marks every office of the cursus on the chart, and names the court in English', () => {
    const lines = people.career(CICERO).lines
    const chart = lines.filter((l) => l.chart).map((l) => l.label)
    // His quaestorship in Sicily is a post under the governor, but still of the cursus.
    expect(chart).toEqual(['Quaestor', 'Plebeian aedile', 'Praetor', 'Consul'])
    expect(lines.find((l) => l.label === 'Praetor')?.detail).toBe('extortion court')
  })

  it.skipIf(!people.isJoined('cilicia'))(
    'lists the governors of Cilicia as terms, each man once for his unbroken years',
    () => {
      const years = [-52, -51, -50, -49, -48]
      const lines = people.fasti('cilicia', years)
      const cicero = lines.find((l) => l.kind === 'term' && l.person.id === CICERO)
      expect(cicero && [cicero.from, cicero.to]).toEqual([-50, -49])
      // In order, and every year accounted for, by a term or a gap.
      const starts = lines.map((l) => l.from)
      expect(starts).toEqual([...starts].sort((a, b) => a - b))
      for (const y of years) expect(lines.some((l) => l.from <= y && y <= l.to)).toBe(true)
    },
  )

  it('lists each polity a command stood for, as the inspector does', () => {
    // Sextus Pompeius's Transalpine Gaul in 43 BCE joins both halves of Gaul.
    const [c] = people.career('dprr:2254').commands.filter((c) => c.from === -42)
    expect(c.places.map((p) => p.polity)).toEqual(
      expect.arrayContaining(['gallia-transalpina', 'gallia-comata', 'sicilia']),
    )
  })

  describe('the career of Q. Caecilius Metellus Creticus', () => {
    const career = people.career('dprr:2078')
    const line = (label: string) => career.lines.filter((l) => l.label === label)

    it('merges a proconsulship renewed year by year into one command, with its ground', () => {
      expect(career.commands.map((c) => [c.label, c.from, c.to])).toEqual([
        ['Proconsul', -67, -64],
        ['Proconsul', -63, -61],
      ])
      const crete = career.commands[0].places
      expect(crete.map((p) => [p.name, p.polity])).toEqual([
        ['Crete', 'creta'],
        ['Achaea', 'macedonia'],
      ])
      // Italia is not one of our polities: named, but no link.
      expect(career.commands[1].places.map((p) => p.name)).toEqual(['Italia'])
      expect(career.commands[1].places[0].polity).toBeUndefined()
    })

    it('keeps the consulship and praetorship in the career, not among the commands', () => {
      const [consul] = line('Consul')
      expect(consul.from).toBe(-68)
      expect(consul.colleagues.map((p) => p.name)).toContain('Q. Hortensius Hortalus')
      // DPRR's two uncertain dates for one urban praetorship read as one line.
      expect(line('Urban praetor').map((l) => [l.from, l.to, l.uncertain])).toEqual([
        [-72, -71, true],
      ])
    })

    it('says a lost election in words, and leaves it off the chart', () => {
      const [lost] = line('Stood for praetor')
      expect(lost.kind).toBe('candidacy')
      expect(lost.chart).toBe(false)
    })

    it('draws the Senate and the pontificate as lanes of spans', () => {
      const lanes = Object.fromEntries(career.standing.map((l) => [l.label, l.spans]))
      expect(lanes.Senate.map((s) => [s.from, s.to, s.uncertain])).toEqual([
        [-81, -75, true],
        [-74, -48, false],
      ])
      expect(lanes.Pontifex).toHaveLength(2)
    })
  })
})
