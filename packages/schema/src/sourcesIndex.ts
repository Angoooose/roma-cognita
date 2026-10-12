/**
 * The index of sources as baked into build/sources/index.json, shared by the pipeline
 * that writes it (pipeline/src/sources/build.ts) and the sources page that reads it
 * (apps/explorer/src/sources).
 *
 * Everything here is derived from data/: for every work in sources.yaml, what cites it,
 * where, and how firmly. There are no zod schemas: the pipeline is the only writer.
 *
 * Years are astronomical (1 BCE = 0, 63 BCE = −62), like everywhere else in the project.
 */
import type { Confidence } from './common.ts'
import type { Year } from './time.ts'

export type SourceKind = 'ancient' | 'modern' | 'dataset'

/** A part of the map built straight from a work, in code. */
export type Builds = 'people' | 'rome' | 'roads'

export interface SourcesIndex {
  /** The window the coverage arrays run over, inclusive: 133 BCE to 27 BCE. */
  first: Year
  last: Year
  totals: {
    sources: number
    byKind: Record<SourceKind, number>
    /** Records of every type, and the citations they make. */
    records: number
    citations: number
    /** Citations that name a page or passage, and those that carry their quote. */
    located: number
    quoted: number
  }
  /** Every work in sources.yaml, the most cited first. */
  sources: SourceEntry[]
  /** Two works cited by the same history records (claims, polities, relations), three times or more. */
  links: { a: string; b: string; n: number }[]
  /**
   * The atoms' outlines as SVG path data, for the entry's plate of the ground: lon/lat
   * projected equirectangular onto a 1000-wide frame over 10° W–50° E, 22° N–52° N.
   */
  atoms: Record<string, string>
}

export interface SourceEntry {
  id: string
  kind: SourceKind
  citation: string
  /** Where the work can be read: its own url, or the page works.ts reads it on. */
  url?: string
  /** The name it files under in the index: an ancient author, as the citation begins. */
  author: string
  /** Records of every type that cite it, and the citations they make. */
  records: number
  cites: number
  quoted: number
  /** Distinct places in it cited (locators). */
  passages: number
  /** Records citing it, by type: claim, polity, relation, outline, place, feature, landscape. */
  byType: Record<string, number>
  /** History records (claims, polities, relations) that cite nothing else. */
  sole: number
  /**
   * What the pipeline builds from it directly, rather than through records: `people`,
   * `rome` (the model of the city), `roads`. Read from its `usedBy` in sources.yaml.
   */
  builds: Builds[]
  /** Its dated records in force each year, `first` to `last`. */
  coverage: number[]
  /** Atoms whose holding or outline it is cited for. */
  atoms: string[]
  /** The history records it backs, by confidence. */
  conf: Record<Confidence, number>
  /** The places in it cited, each with its quote if one was read, its link, and what it backs. */
  passageList: {
    locator: string
    quote?: string
    passage?: string
    /** What the passage backs: each thing by name, with the type of its record. */
    records: { name: string; type: string }[]
  }[]
}
