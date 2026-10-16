/**
 * The people layer as baked into build/people/ (pipeline/src/people/build.ts), shared by the pipeline
 * that writes it and the app that reads it.
 *
 * Everything here is derived from DPRR (CC BY-NC 4.0) plus Wikidata (CC0), and lives
 * only in build/. None of it is authored data, so there are no zod schemas: the
 * pipeline is the only writer, and its tests are the check.
 *
 * Years are astronomical (1 BCE = 0, 63 BCE = −62), like everywhere else in the
 * project. DPRR's own numbering has no year zero; the build converts it.
 */
import type { Year } from './time.ts'

/** `dprr:2072` is Cicero. Our own records, for people DPRR lacks, will be `ours:<slug>`. */
export type PersonId = `dprr:${number}` | `ours:${string}`

/** A year as DPRR asserts it: the value, and whether DPRR marks it uncertain. */
export interface AssertedYear {
  year: Year
  uncertain: boolean
}

export interface PersonRecord {
  id: PersonId
  /** Short display form: "M. Tullius Cicero". */
  name: string
  /** Full nomenclature, as DPRR gives it without its code or RE number: "M. Tullius M. f. M. n. Cor. Cicero". */
  full: string
  /** The Real-Encyclopädie number that tells namesakes apart: Cicero is 29, his son 30. */
  re: string
  sex: 'male' | 'female'
  names: {
    praenomen?: string
    altPraenomen?: string
    nomen: string
    cognomen?: string
    otherNames?: string
    filiation?: string
  }
  /** Name parts DPRR marks uncertain. */
  uncertainNames?: ('praenomen' | 'nomen' | 'cognomen' | 'filiation' | 'otherNames')[]
  patrician?: { uncertain: boolean }
  nobilis?: true
  novus?: true
  origin?: string
  /** DPRR's summary, as text in its own form: "cos. 63" means 63 BCE. For display only. */
  highestOffice?: string
  /**
   * The years this person is attested, from their dated posts, statuses and life
   * dates, or else DPRR's era where that is unambiguous. Absent when nothing dates
   * them: such people are reached through their relatives, never by the year filter.
   */
  active?: { from: Year; to: Year; basis: 'assertions' | 'era' }
  /** From Wikidata, where it has this person. */
  en?: {
    wikidata: string
    label?: string
    description?: string
    aliases: string[]
    image?: string
  }
  dprr: { id: number; code: string; page: string }
}

export interface PostRecord {
  id: number
  person: PersonId
  office: number
  from: AssertedYear
  to: AssertedYear
  /** DPRR is unsure the person held the post at all. */
  uncertain: boolean
  provinces: { id: number; uncertain: boolean }[]
  /** DPRR's province wording where it kept the original ("Hispania Ulterior (?)"). */
  provinceText?: string
  source: number
  /** Broughton's entry as DPRR transcribed it: "M. Tullius Cicero (29)". */
  original?: string
  /** Ancient evidence: "Diod. XXXVIII 12." */
  citations: string[]
}

/**
 * One edge per pair: `a` is `type` of `b`, and `b` is `inverse` of `a`. DPRR stores
 * most relationships twice, once each way; the build merges them.
 */
export interface RelationshipRecord {
  a: PersonId
  b: PersonId
  type: number
  /** Null where DPRR's inverse table has no entry for this type and sex. */
  inverse: number | null
  uncertain: boolean
  sources: number[]
  /** Ancient evidence: "Eutr. VII 2.1". */
  citations: string[]
  notes: string[]
  /** The DPRR assertion ids merged into this edge. */
  assertions: number[]
}

export interface StatusRecord {
  id: number
  person: PersonId
  status: number
  from?: AssertedYear
  to?: AssertedYear
  uncertain: boolean
  source: number
  original?: string
  citations: string[]
}

/** A dated event in a life: birth, death, exile, proscription. */
export interface LifeEventRecord {
  id: number
  person: PersonId
  /** DPRR's type: "birth", "death - violent", "proscribed", "exiled", "restored" … */
  type: string
  year: Year
  /** `on` the year, or `before` / `after` it. */
  bound: 'on' | 'before' | 'after'
  uncertain: boolean
  source?: number
  note?: string
}

/** Our classification of an office (pipeline/src/people/offices.ts). */
export type OfficeRole =
  | 'command'
  | 'staff'
  | 'magistracy'
  | 'commission'
  | 'priesthood'
  | 'candidacy'
  | 'distinction'
  | 'equestrian'
  | 'other'

export interface Authorities {
  offices: {
    id: number
    name: string
    abbreviation?: string
    parent?: number
    role: OfficeRole
  }[]
  provinces: { id: number; name: string; description?: string; parent?: number }[]
  relationships: { id: number; name: string; order?: number }[]
  statuses: { id: number; name: string; abbreviation?: string }[]
  sources: { id: number; name: string; abbreviation?: string; biblio?: string }[]
}

/**
 * One person serving in one of our polities in one year: DPRR's posts joined through
 * data/dprr-provinces.yaml (pipeline/src/people/governors.ts).
 */
export interface GovernorshipRecord {
  /** Our polity id. */
  polity: string
  year: Year
  post: number
  /** The DPRR province of the post that put this person here: a post can name several. */
  province: number
  /** `command`: governed it. `staff`: served under whoever did. */
  role: 'command' | 'staff'
  /** DPRR is unsure of the post or of its province. */
  uncertain: boolean
}

/** build/people/governorships.json. */
export interface Governorships {
  /** Our polities that data/dprr-provinces.yaml joins to DPRR at all: where "no governor attested" means something. */
  polities: string[]
  records: GovernorshipRecord[]
}

/** A compact row per person for the ⌘K search, so search can open before the rest loads. */
export interface SearchEntry {
  id: PersonId
  name: string
  /** Wikidata's English label, when it differs from `name`. */
  label?: string
  /** Everything else worth matching: Wikidata aliases, the full nomenclature. */
  terms: string[]
  re: string
  highestOffice?: string
  active?: [Year, Year]
}

export interface PeopleManifest {
  built: string
  dprr: { endpoint: string; fetched: string }
  wikidata?: { fetched: string }
  licence: string
  counts: Record<string, number>
}
