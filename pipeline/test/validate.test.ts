import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { DATA_DIR, loadDataset, readDataset } from '../src/load.ts'
import { checkDataset, doubts } from '../src/rules.ts'
import { validate } from '../src/validate.ts'

/** A counter-clockwise square: a valid RFC 7946 exterior. */
const square = (x: number, y: number) => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + 1, y],
      [x + 1, y + 1],
      [x, y + 1],
      [x, y],
    ],
  ],
})

const src = [{ source: 'mrr' }]
const ok = { sources: src, confidence: 'certain', review: 'draft' }

/** The smallest dataset that exercises every file and passes clean. */
function base() {
  return {
    sources: [
      { id: 'mrr', kind: 'modern', citation: 'Broughton, MRR' },
    ] as Record<string, unknown>[],
    atoms: [
      {
        id: 'north',
        evidence: 'surveyed',
        construction: [{ method: 'box', bbox: [10, 44, 11, 45] }],
        ...ok,
      },
      {
        id: 'south',
        evidence: 'schematic',
        construction: [
          {
            method: 'outline',
            edge: [[10, 43], { at: [11, 43], via: 'curve' }, { at: [11, 44], note: 'a river mouth' }, [10, 44]],
          },
        ],
        ...ok,
      },
    ] as Record<string, unknown>[],
    polities: [
      {
        id: 'rome',
        kind: 'state',
        names: [{ text: 'Roma', preferred: true }],
        from: 'before 100 BCE',
        to: 'after 1 CE',
        ...ok,
      },
      {
        id: 'prov',
        kind: 'province',
        names: [{ text: 'Provincia', preferred: true }],
        from: '100 BCE',
        to: 'after 1 CE',
        ...ok,
      },
      {
        id: 'regnum',
        kind: 'kingdom',
        names: [{ text: 'Regnum', preferred: true }],
        from: 'before 100 BCE',
        to: '51 BCE',
        ...ok,
      },
    ] as Record<string, unknown>[],
    claims: [
      {
        atom: 'north',
        polity: 'prov',
        relation: 'province',
        from: '100 BCE',
        to: 'after 1 CE',
        ...ok,
      },
      {
        atom: 'south',
        polity: 'regnum',
        relation: 'client',
        from: 'before 100 BCE',
        to: '51 BCE',
        ...ok,
      },
      {
        atom: 'south',
        polity: 'prov',
        relation: 'province',
        from: '50 BCE',
        to: 'after 1 CE',
        ...ok,
      },
    ] as Record<string, unknown>[],
    relations: [
      {
        polity: 'prov',
        type: 'province-of',
        of: 'rome',
        from: '100 BCE',
        to: 'after 1 CE',
        ...ok,
      },
      {
        polity: 'regnum',
        type: 'client-of',
        of: 'rome',
        from: 'before 100 BCE',
        to: '51 BCE',
        ...ok,
      },
    ] as Record<string, unknown>[],
    seats: [
      { polity: 'regnum', place: 'caput', from: 'before 100 BCE', to: '51 BCE', ...ok },
    ] as Record<string, unknown>[],
    places: [
      {
        id: 'caput',
        kind: 'settlement',
        location: [10.5, 43.5],
        names: [{ text: 'Caput', preferred: true }],
        from: 'before 100 BCE',
        to: 'after 1 CE',
        prominence: 2,
        ...ok,
      },
    ] as Record<string, unknown>[],
    geometry: {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'north', properties: {}, geometry: square(10, 44) },
        { type: 'Feature', id: 'south', properties: {}, geometry: square(10, 43) },
      ],
    } as { type: string; features: Record<string, unknown>[] },
  }
}

type Fixture = ReturnType<typeof base>
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function write(f: Fixture): string {
  const dir = mkdtempSync(join(tmpdir(), 'roma-cognita-data-'))
  dirs.push(dir)
  const { geometry, ...files } = f
  for (const [name, rows] of Object.entries(files)) {
    writeFileSync(join(dir, `${name}.yaml`), stringify(rows))
  }
  mkdirSync(join(dir, 'geometry'))
  writeFileSync(join(dir, 'geometry/atoms.geojson'), JSON.stringify(geometry))
  return dir
}

function run(mutate: (f: Fixture) => void = () => {}) {
  const f = base()
  mutate(f)
  const { dataset, issues } = readDataset(write(f))
  const all = [...issues, ...checkDataset(dataset)]
  return {
    dataset,
    errors: all.filter((i) => i.level === 'error'),
    warnings: all.filter((i) => i.level === 'warning'),
  }
}

const rules = (issues: { rule: string }[]) => issues.map((i) => i.rule)

describe('the base fixture', () => {
  it('is clean', () => {
    const { errors, warnings } = run()
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it('arrives time-normalised', () => {
    const { dataset } = run()
    const c = dataset.claims[0]
    expect(c.from).toMatchObject({ year: -99, open: null })
    expect(c.to).toMatchObject({ year: 1, open: 'after' })
    expect(dataset.places[0].prominence).toEqual([
      expect.objectContaining({
        value: 2,
        from: expect.objectContaining({ open: 'before' }),
      }),
    ])
    expect(dataset.names.find((n) => n.text === 'Regnum')?.to.year).toBe(-50)
  })
})

describe('references', () => {
  it('fail on a claim to a missing atom or polity', () => {
    const { errors } = run((f) => {
      f.claims[0].atom = 'nowhere'
      f.claims[1].polity = 'nobody'
    })
    expect(rules(errors)).toEqual(
      expect.arrayContaining(['missing-atom', 'missing-polity']),
    )
  })

  it('fail on an unknown source id', () => {
    const { errors } = run((f) => {
      f.claims[0].sources = [{ source: 'hearsay' }]
    })
    expect(rules(errors)).toContain('missing-source')
  })

  it('warn on a passage the translation has no place for', () => {
    const { warnings } = run((f) => {
      f.sources.push({ id: 'strabo', kind: 'ancient', citation: 'Strabo, Geography' })
      f.claims[0].sources = [{ source: 'strabo', locator: '16.2.10' }]
      f.claims[1].sources = [{ source: 'strabo', locator: '16.99.1' }]
    })
    expect(warnings.filter((w) => w.rule === 'unlinked-passage')).toHaveLength(1)
  })

  it('fail on a seat at a missing place', () => {
    const { errors } = run((f) => {
      f.seats[0].place = 'atlantis'
    })
    expect(rules(errors)).toContain('missing-place')
  })

  it('fail when two atoms overlap', () => {
    const { errors } = run((f) => {
      f.geometry.features[1].geometry = square(10, 43.5)
    })
    expect(rules(errors)).toContain('atom-overlap')
  })

  it('fail on an outline leg that is not a known way of drawing a frontier', () => {
    const { errors } = run((f) => {
      ;(f.atoms[1].construction as { edge: unknown[] }[])[0].edge[1] = { at: [11, 43], via: 'wall' }
    })
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('sources', () => {
  it('are required on every historical record', () => {
    const { errors } = run((f) => {
      f.claims[0].sources = []
      delete f.polities[1].sources
    })
    expect(errors.filter((e) => e.rule === 'schema')).toHaveLength(2)
  })

  it('must state a licence when they are datasets', () => {
    const { errors } = run((f) => {
      f.sources.push({ id: 'ne', kind: 'dataset', citation: 'Natural Earth' })
      f.atoms[0].sources = [{ source: 'ne' }]
    })
    expect(errors.map((e) => e.message).join()).toMatch(/licence/)
  })
})

describe('time', () => {
  it('rejects a signed year, the ambiguity the era strings remove', () => {
    const { errors } = run((f) => {
      f.claims[0].from = -99
      f.claims[1].from = '-99'
    })
    expect(errors.filter((e) => e.rule === 'schema')).toHaveLength(2)
    expect(errors.map((e) => e.message).join()).toMatch(/era explicitly/)
  })

  it('fails an interval that ends before it starts', () => {
    const { errors } = run((f) => {
      f.relations[0].to = '101 BCE'
    })
    expect(rules(errors)).toContain('end-before-start')
  })

  it('fails a fuzzy interval that cannot be read forwards under any reading', () => {
    const { errors } = run((f) => {
      f.places[0].from = { earliest: '60 BCE', latest: '50 BCE' }
      f.places[0].to = { earliest: '70 BCE', latest: '61 BCE' }
    })
    expect(rules(errors)).toContain('end-before-start')
  })
})

describe('overlapping claims', () => {
  it('fail in the same layer', () => {
    const { errors } = run((f) => {
      f.claims[2].from = '51 BCE'
    })
    expect(rules(errors)).toContain('claim-overlap')
  })

  it('may abut', () => {
    // The base fixture has regnum to 51 and prov from 50 on "south".
    expect(rules(run().errors)).not.toContain('claim-overlap')
  })

  it('are allowed across layers: occupation does not end a holding', () => {
    const { errors } = run((f) => {
      f.claims.push({
        atom: 'north',
        polity: 'regnum',
        relation: 'occupied',
        from: '60 BCE',
        to: '55 BCE',
        ...ok,
      })
    })
    expect(rules(errors)).not.toContain('claim-overlap')
  })

  it('warn when an open end could run into a later claim', () => {
    const { errors, warnings } = run((f) => {
      f.claims[1].to = 'after 52 BCE'
      f.relations[1].to = 'after 52 BCE'
      f.polities[2].to = 'after 52 BCE'
      f.seats[0].to = 'after 52 BCE'
    })
    expect(errors).toEqual([])
    expect(rules(warnings)).toContain('may-overlap')
  })

  it('fail for two relations of one polity to another at once', () => {
    const { errors } = run((f) => {
      f.relations.push({
        polity: 'regnum',
        type: 'allied-to',
        of: 'rome',
        from: '60 BCE',
        to: '55 BCE',
        ...ok,
      })
    })
    expect(rules(errors)).toContain('relation-overlap')
  })
})

describe('atoms and geometry', () => {
  it('fail when an atom has no shape, or a shape has no atom', () => {
    const { errors } = run((f) => {
      f.geometry.features[1].id = 'elsewhere'
    })
    expect(rules(errors)).toEqual(
      expect.arrayContaining(['missing-geometry', 'orphan-geometry']),
    )
  })

  it('fail on a clockwise exterior: winding is owned by the pipeline and asserted', () => {
    const { errors } = run((f) => {
      const g = square(10, 44)
      g.coordinates[0].reverse()
      f.geometry.features[0].geometry = g
    })
    expect(errors.map((e) => e.message).join()).toMatch(/exterior is clockwise/)
  })

  it('fail on projected coordinates', () => {
    const { errors } = run((f) => {
      f.geometry.features[0].geometry = {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1e6, 0],
            [1e6, 1e6],
            [0, 0],
          ],
        ],
      }
    })
    expect(errors.map((e) => e.message).join()).toMatch(/not lon\/lat/)
  })

  it('warn when a label anchor falls outside its atom', () => {
    const { warnings } = run((f) => {
      f.atoms[0].anchor = { at: [20, 20] }
    })
    expect(rules(warnings)).toContain('anchor-outside')
  })
})

describe('consistency warnings', () => {
  it('warn when a client claim has no client-of relation behind it', () => {
    const { warnings } = run((f) => {
      f.relations.splice(1, 1)
    })
    expect(rules(warnings)).toContain('relation-missing')
  })

  it('warn when a claim runs outside its polity', () => {
    const { warnings } = run((f) => {
      f.polities[1].from = '90 BCE'
    })
    expect(rules(warnings)).toContain('outside-polity')
  })
})

describe('the doubt report', () => {
  it('lists needs-check and uncertain records', () => {
    const f = base()
    f.claims[0].review = 'needs-check'
    f.claims[0].note = 'Migration review: this is doubtful. And more.'
    f.claims[1].confidence = 'uncertain'
    const { dataset } = readDataset(write(f))
    const d = doubts(dataset)
    expect(d.needsCheck).toEqual([
      {
        where: expect.stringContaining('claims.yaml#1'),
        why: 'Migration review: this is doubtful.',
      },
    ])
    expect(d.uncertain.map((x) => x.where)).toEqual([
      expect.stringContaining('claims.yaml#2'),
    ])
    expect(d.notChecked.length).toBeGreaterThan(0)
  })
})

describe('loading', () => {
  it('reads split files under <entity>/', () => {
    const f = base()
    const dir = write(f)
    mkdirSync(join(dir, 'claims'))
    writeFileSync(
      join(dir, 'claims/east.yaml'),
      stringify([
        {
          atom: 'north',
          polity: 'regnum',
          relation: 'occupied',
          from: '60 BCE',
          to: '59 BCE',
          ...ok,
        },
      ]),
    )
    expect(readDataset(dir).dataset.claims).toHaveLength(4)
  })

  it('refuses to hand a build a dataset with schema errors', () => {
    const f = base()
    f.claims[0].relation = 'vassal'
    expect(() => loadDataset(write(f))).toThrow(/claims\.yaml#1/)
  })
})

describe('validate', () => {
  it('fails with a report on errors', () => {
    const f = base()
    f.claims[0].atom = 'nowhere'
    const r = validate(write(f))
    expect(r.errors).toBeGreaterThan(0)
    expect(r.report).toMatch(/^FAIL/m)
  })

  it('passes the real data in data/', () => {
    const r = validate(DATA_DIR)
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([])
    expect(r.report).toMatch(/NEEDS CHECK/)
  })
})

describe('physical features and their shapes', () => {
  const always = { from: 'before 100 BCE', to: 'after 1 CE', ...ok }
  const line = { type: 'LineString', coordinates: [[10.2, 44.2], [10.8, 44.8]] }
  const records = () => [
    { id: 'plain-green', kind: 'floodplain', names: [{ text: 'Campus', preferred: true }], ...always },
    { id: 'flumen', kind: 'river', names: [{ text: 'Flumen', preferred: true }], ...always },
    { id: 'mons', kind: 'mountain', names: [{ text: 'Mons', preferred: true }], ...always },
  ]
  const shapes = () => [
    { type: 'Feature', id: 'plain-green', properties: { derivation: 'test' }, geometry: square(10, 44) },
    { type: 'Feature', id: 'flumen', properties: { discharge: 120 }, geometry: line },
  ]

  function runFeatures(
    mutate: (r: Record<string, unknown>[], s: Record<string, unknown>[]) => void = () => {},
  ) {
    const recs: Record<string, unknown>[] = records()
    const geo: Record<string, unknown>[] = shapes()
    mutate(recs, geo)
    const dir = write(base())
    writeFileSync(join(dir, 'features.yaml'), stringify(recs))
    writeFileSync(
      join(dir, 'geometry/features.geojson'),
      JSON.stringify({ type: 'FeatureCollection', features: geo }),
    )
    const { dataset, issues } = readDataset(dir)
    const all = [...issues, ...checkDataset(dataset)]
    return { dataset, errors: all.filter((i) => i.level === 'error') }
  }

  it('load clean, keyed by id, with discharge on the river line', () => {
    const { dataset, errors } = runFeatures()
    expect(errors).toEqual([])
    expect(dataset.geometry.features.get('flumen')?.properties?.discharge).toBe(120)
    expect(dataset.geometry.features.get('plain-green')?.geometry.type).toBe('Polygon')
  })

  it('accept floodplain as a feature kind', () => {
    const { dataset } = runFeatures()
    expect(dataset.features.map((f) => f.kind)).toContain('floodplain')
  })

  it('fail when a floodplain or river has no shape', () => {
    const { errors } = runFeatures((_, s) => s.splice(0, 2))
    expect(errors.filter((e) => e.rule === 'missing-geometry')).toHaveLength(2)
  })

  it('fail when the shape is the wrong kind of geometry', () => {
    const { errors } = runFeatures((_, s) => {
      s[0].geometry = line
      s[1].geometry = square(12, 44)
    })
    expect(errors.filter((e) => e.rule === 'geometry-kind')).toHaveLength(2)
  })

  it('fail on a shape for a feature kind that takes none', () => {
    const { errors } = runFeatures((_, s) => {
      s.push({ type: 'Feature', id: 'mons', properties: null, geometry: square(14, 44) })
    })
    expect(rules(errors)).toContain('geometry-kind')
  })

  it('fail on an orphan shape', () => {
    const { errors } = runFeatures((_, s) => {
      s.push({ type: 'Feature', id: 'nowhere', properties: null, geometry: line })
    })
    expect(rules(errors)).toContain('orphan-geometry')
  })

  it('fail on clockwise exteriors (RFC 7946)', () => {
    const { errors } = runFeatures((_, s) => {
      const g = square(10, 44)
      g.coordinates[0].reverse()
      s[0].geometry = g
    })
    expect(errors.map((e) => e.message).join()).toMatch(/exterior is clockwise/)
  })

  it('reject unknown shape properties and a non-positive discharge', () => {
    const { errors } = runFeatures((_, s) => {
      s[1].properties = { discharge: -5, colour: 'blue' }
    })
    expect(rules(errors)).toContain('geojson')
  })
})
