/**
 * The index of sources, as the pipeline bakes it (`npm run sources -w pipeline`,
 * build/sources/index.json). Loaded once, before the page is drawn; `DATA` and `BY_ID`
 * are set from then on.
 */
import type { SourceEntry, SourceKind, SourcesIndex } from '@roma-cognita/schema'

export type Source = SourceEntry
export type Kind = SourceKind

export let DATA: SourcesIndex
export let BY_ID: Map<string, Source>

export async function loadSources(): Promise<void> {
  const res = await fetch('/sources/index.json')
  if (!res.ok) throw new Error(`build/sources/index.json: ${res.status}`)
  DATA = await res.json()
  BY_ID = new Map(DATA.sources.map((s) => [s.id, s]))
}

export const KINDS: Kind[] = ['ancient', 'modern', 'dataset']

/** An astronomical year as the data writes it: 0 is 1 BCE. */
export function era(y: number): string {
  return y <= 0 ? `${1 - y} BCE` : `${y} CE`
}

/** An ancient work's title without its author: "Caesar, De Bello Gallico" → "De Bello Gallico". */
export function title(s: Source): string {
  if (s.kind !== 'ancient') return s.citation
  const i = s.citation.indexOf(', ')
  return i < 0 ? s.citation : s.citation.slice(i + 2)
}
