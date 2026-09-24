/**
 * A citation's locator, as a link to the passage in an English translation
 * (works.ts says where, fetch.ts recorded the anchors each page has).
 *
 * A locator can cite several places ("16.2.10, 16.2.16") or a range ("34–41"); the
 * link goes to the first place cited, at the start of its range. Where the page has
 * no anchor for the exact reference it lands on the chapter's first ("Pompey 34" on
 * 34.1) or the nearest one before it in the same chapter or letter (Att. 5.21.9 on
 * 5.21.8), and never in a different one: a link that opens on the wrong letter is
 * worse than none.
 *
 * Pleiades is the one dataset cited this way: its locator names the place's page.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WORKS, pageUrl, type Work } from './works.ts'

/** A reference split into its parts: "36.17a" is [[36, ''], [17, 'a']]. */
type Ref = [number, string][]

export function parseRef(s: string): Ref | undefined {
  const parts = s.split('.').map((p) => /^(\d+)([a-z]?)$/.exec(p))
  return parts.every((m) => m) ? parts.map((m) => [Number(m![1]), m![2]]) : undefined
}

export function compareRef(a: Ref, b: Ref): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = a[i][0] - b[i][0] || (a[i][1] < b[i][1] ? -1 : a[i][1] > b[i][1] ? 1 : 0)
    if (d) return d
  }
  return a.length - b.length
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 }
function roman(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]]
    n += v < (ROMAN[s[i + 1]] ?? 0) ? -v : v
  }
  return n
}

/**
 * The part of a work a locator names, and the reference it starts at: "Mithr. 114"
 * is Appian's Mithridatic Wars at 114; "5.22 ("Cirta…")" is 5.22; "book 3" is 3;
 * "VII–VIII" is 7.
 */
export function readLocator(
  locator: string,
  parts: string[] = [],
): { part?: string; ref: string } | undefined {
  let s = locator.split(',')[0].replace(/\(.*$/, '').trim()
  // The longest part name first: "Cato Minor" before a "Cato" there might be.
  const part = [...parts]
    .sort((a, b) => b.length - a.length)
    .find((p) => s.startsWith(`${p} `))
  if (part) s = s.slice(part.length).trim()
  else if (parts.length) return undefined
  s = s.replace(/^[A-Za-z]+\s+(?=\d)/, '') // "book 3", "Geography 1–2"
  if (/^[IVXLC]+\b/.test(s)) s = String(roman(/^[IVXLC]+/.exec(s)![0]))
  const ref = /^\d+[a-z]?(\.\d+[a-z]?)*/.exec(s)?.[0]
  return ref ? { part, ref } : undefined
}

type Index = Record<string, { page: string; passages: string[] }>
let index: Map<string, { page: string; refs: [Ref, string, string][] }> | undefined

function load() {
  if (index) return index
  const file = join(dirname(fileURLToPath(import.meta.url)), 'passages.json')
  const raw: Index = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  index = new Map(
    Object.entries(raw).map(([key, { page, passages }]) => [
      key,
      {
        page,
        refs: passages.map((p) => {
          const [ref, anchor = ref] = p.split(' ')
          return [parseRef(ref)!, ref, anchor] as [Ref, string, string]
        }),
      },
    ]),
  )
  return index
}

/** The anchor on a page for a reference, by the rules at the top of this file and works.ts. */
export function findAnchor(
  refs: [Ref, string, string][],
  ref: string,
  { exact = false, unit }: Pick<Work, 'exact' | 'unit'> = {},
): string | undefined {
  const want = parseRef(ref)
  if (!want) return undefined
  const same = (r: Ref, n: number) =>
    r.length >= n && want.slice(0, n).every((p, i) => compareRef([p], [r[i]]) === 0)
  const hit = refs.find(([r]) => compareRef(r, want) === 0)
  if (hit) return hit[2]
  if (exact) return undefined
  // Cited by chapter and anchored by section: the chapter's first section.
  const within = refs.find(([r]) => same(r, want.length))
  if (within) return within[2]
  // Anchored more coarsely than cited: the last anchor before it in the same unit,
  // or, cited ahead of the unit's first ("14.1" before the first "[n]"), that one.
  const shared = Math.min(unit ?? want.length - 1, want.length)
  let before: string | undefined
  for (const [r, , anchor] of refs) {
    if (!same(r, shared)) continue
    if (compareRef(r, want) > 0) return before ?? anchor
    before = anchor
  }
  return before
}

function work(
  source: string,
  locator?: string,
): { w: Work; key: string; ref?: string } | undefined {
  const e = WORKS[source]
  if (!e) return undefined
  if (!('parts' in e))
    return { w: e, key: source, ref: locator ? readLocator(locator)?.ref : undefined }
  const read = locator ? readLocator(locator, Object.keys(e.parts)) : undefined
  return read?.part
    ? { w: e.parts[read.part], key: `${source} ${read.part}`, ref: read.ref }
    : undefined
}

/** The page for a work as a whole, when it has one page (Appian and Plutarch have many). */
export function workUrl(source: string): string | undefined {
  const e = WORKS[source]
  return e && !('parts' in e) ? pageUrl(e) : undefined
}

/** A link to the passage a locator cites, or nothing when we can't find it. */
export function passageUrl(source: string, locator?: string): string | undefined {
  // Not a text but the gazetteer: "places/727142, 727169" is the first place's page.
  if (source === 'pleiades') {
    const id = locator && /^places\/(\d+)/.exec(locator)?.[1]
    return id ? `https://pleiades.stoa.org/places/${id}` : undefined
  }
  const found = locator ? work(source, locator) : undefined
  if (!found?.ref) return undefined
  const { w, ref } = found
  if (w.site === 'perseus') {
    const parts = ref.split('.').slice(0, w.levels!.length)
    return `${pageUrl(w)}:${parts.map((p, i) => `${w.levels![i]}=${p}`).join(':')}`
  }
  const page = load().get(found.key)
  const anchor = page && findAnchor(page.refs, ref, w)
  return anchor ? `${page.page}#${anchor}` : undefined
}
