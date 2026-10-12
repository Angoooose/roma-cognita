/**
 * A snapshot of data/ for the sources-view mockups: real counts, taken once by a
 * throwaway script, not a build step. `written` (when each ancient author wrote) is
 * rough and unresearched, there only to try the timeline on.
 */
import raw from './demo-data.json'

export type Kind = 'ancient' | 'modern' | 'dataset'
export type Confidence = 'certain' | 'probable' | 'uncertain'

export interface Passage {
  locator: string
  quote: string | null
  records: string[]
}

export interface Source {
  id: string
  kind: Kind
  citation: string
  url: string | null
  author: string
  /** Astronomical years (1 BCE = 0). */
  written: { from: number; to: number; eyewitness: boolean } | null
  records: number
  cites: number
  quoted: number
  passages: number
  byType: Record<string, number>
  /** History records (claims, polities, relations) that cite nothing else. */
  sole: number
  /** History records in force each year, `first` to `last`. */
  coverage: number[]
  atoms: string[]
  conf: Record<Confidence, number>
  passageList: Passage[]
}

export interface Demo {
  first: number
  last: number
  frame: { w: number; h: number }
  totals: {
    sources: number
    byKind: Record<Kind, number>
    records: number
    citations: number
    quoted: number
    located: number
    hist: number
    single: number
    noAncient: number
    conf: Record<Confidence, number>
    review: Record<string, number>
  }
  sources: Source[]
  links: { a: string; b: string; n: number }[]
  strip: ({ year: number } & Record<Confidence, number>)[]
  fragile: { type: string; label: string; source: string; conf: Confidence }[]
  atoms: Record<string, string>
}

export const DATA = raw as unknown as Demo
export const BY_ID = new Map(DATA.sources.map((s) => [s.id, s]))
export const KINDS: Kind[] = ['ancient', 'modern', 'dataset']
export const KIND_LABEL: Record<Kind, string> = {
  ancient: 'Ancient texts',
  modern: 'Modern scholarship',
  dataset: 'Datasets',
}
export const CONFIDENCES: Confidence[] = ['certain', 'probable', 'uncertain']

/** An astronomical year as the data writes it: 0 is 1 BCE. */
export function era(y: number): string {
  return y <= 0 ? `${1 - y} BCE` : `${y} CE`
}

/** The work's title without its author: "Caesar, De Bello Gallico" → "De Bello Gallico". */
export function title(s: Source): string {
  if (s.kind !== 'ancient') return s.citation
  const i = s.citation.indexOf(', ')
  return i < 0 ? s.citation : s.citation.slice(i + 2)
}

/** A modern citation shortened to author and year: "Broughton 1951–1986". */
export function short(s: Source): string {
  if (s.kind === 'ancient') return s.citation
  const year = s.citation.match(/\b(1[89]\d\d|20\d\d)(–\d{4})?\b/)?.[0]
  const who = s.citation
    .split(/,|\(/)[0]
    .replace(/^([A-Z]\.\s?)+/, '')
    .trim()
  return year ? `${who} ${year}` : who
}

/** One author's works together: Cicero's speeches and letters as one witness. */
export interface Author {
  name: string
  works: Source[]
  written: { from: number; to: number; eyewitness: boolean }
  records: number
  coverage: number[]
}

export function authors(): Author[] {
  const map = new Map<string, Author>()
  for (const s of DATA.sources) {
    if (s.kind !== 'ancient' || !s.written || !s.records) continue
    const a = map.get(s.author) ?? {
      name: s.author,
      works: [] as Source[],
      written: { ...s.written },
      records: 0,
      coverage: new Array(s.coverage.length).fill(0),
    }
    a.works.push(s)
    a.written.from = Math.min(a.written.from, s.written.from)
    a.written.to = Math.max(a.written.to, s.written.to)
    a.records += s.records
    s.coverage.forEach((n, i) => (a.coverage[i] += n))
    map.set(s.author, a)
  }
  return [...map.values()]
}
