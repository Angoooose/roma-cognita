/**
 * Finds each citation's quote in the text it was copied from (research/README.md),
 * so a quote never rests on whoever wrote it down.
 *
 * Where the text is:
 * - an ancient work we link into (passages/works.ts): the page passages:fetch cached,
 *   cut to the passage the locator names, with a passage of slack either side, since
 *   a translation's paragraphing doesn't always follow the standard numbering;
 * - anything else: the citation's `url`, or failing that its source's, as fetched
 *   into .cache/sources/quoted/ by
 *
 *     npm run quotes:fetch -w pipeline              (cached texts are reused)
 *     npm run quotes:fetch -w pipeline -- --refresh (download them all again)
 *     npm run quotes:fetch -w pipeline -- <url>     (one text, printed: copy quotes from it)
 *
 *   PDFs are read with pdf.js, so nothing needs installing beyond npm's.
 *
 * A quote matches when its words appear in order, ignoring case, accents,
 * punctuation, bare numbers (section and footnote marks) and words a scan broke
 * at a line end; `…` is a cut, and the pieces must appear in that order. A text
 * not downloaded is reported, never failed: a fresh clone has no cache.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Source, SourceRef } from '@roma-cognita/schema'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { loadDataset } from './load.ts'
import { userAgent } from './people/agent.ts'
import { anchors, pageFile } from './passages/fetch.ts'
import { findAnchor, pageIndex, rangeEnd, work } from './passages/passage.ts'

const ROOT_DIR = resolve(import.meta.dirname, '../..')
const QUOTED = join(ROOT_DIR, '.cache/sources/quoted')

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…',
}

/** A page's words, without its markup. */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
}

/** Words only: lower case, no accents, no punctuation, no bare numbers. */
export function normalise(s: string): string {
  const words = s
    // A word a scan broke at a line end ("king- dom") is one word.
    .replace(/(\p{L})-\s+(\p{Ll})/gu, '$1$2')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !/^\d+$/.test(w))
  // Padded, so a piece only ever matches whole words.
  return ` ${words.join(' ')} `
}

/** Whether the quote's pieces appear in the text (or the text already normalised), in order. */
export function quoteIn(quote: string, text: string | { normalised: string }): boolean {
  const hay = typeof text === 'string' ? normalise(text) : text.normalised
  let from = 0
  for (const piece of quote.split(/…|\.\.\./).map(normalise)) {
    if (!piece.trim()) continue
    const at = hay.indexOf(piece, from)
    if (at < 0) return false
    from = at + piece.length - 1
  }
  return true
}

export type QuoteCheck =
  | { status: 'found' }
  | { status: 'not-found'; in: string }
  | { status: 'unread'; why: string }

/** Each cached page, split at its anchors, read once. */
const pages = new Map<string, { id: string; text: string }[] | null>()

/** The passage a locator names in a work we link into, or why it can't be had. */
function passageText(ref: SourceRef): { text: string; in: string } | { why: string } {
  const found = work(ref.source, ref.locator)
  if (!found?.ref) return { why: `no passage for ${ref.source} ${ref.locator ?? ''}` }
  const { w, key, ref: start } = found
  if (w.site === 'perseus') return { why: `${key} is read on Perseus, which isn't cached` }
  const idx = pageIndex(key)
  if (!pages.has(key)) {
    const file = pageFile(key)
    pages.set(key, existsSync(file) ? anchors(readFileSync(file, 'utf8'), w) : null)
  }
  const blocks = pages.get(key)
  if (!idx || !blocks) return { why: `${key} not downloaded: npm run passages:fetch -w pipeline` }
  const first = findAnchor(idx.refs, start, w)
  if (!first) return { why: `no passage for ${ref.source} ${ref.locator}` }
  const last = findAnchor(idx.refs, rangeEnd(ref.locator!, start), w) ?? first
  const i = blocks.findIndex((b) => b.id === first)
  const j = Math.max(i, blocks.findIndex((b) => b.id === last))
  if (i < 0) return { why: `${key} has changed since passages:fetch; fetch it again` }
  const text = blocks
    .slice(Math.max(0, i - 1), j + 2)
    .map((b) => htmlText(b.text))
    .join(' ')
  return { text, in: `${idx.page}#${first}` }
}

const quotedFile = (url: string) =>
  join(QUOTED, `${createHash('sha256').update(url).digest('hex').slice(0, 16)}.txt`)

/** The address a citation's text is fetched from, when it isn't a passage we link into. */
function textUrl(ref: SourceRef, source: Source | undefined): string | undefined {
  return ref.url ?? (work(ref.source, ref.locator) ? undefined : source?.url)
}

const checked = new WeakMap<SourceRef, QuoteCheck>()

/** Each downloaded text, normalised once: a scanned book is quoted from many times. */
const texts = new Map<string, { normalised: string }>()
function downloaded(file: string) {
  let t = texts.get(file)
  if (!t) texts.set(file, (t = { normalised: normalise(readFileSync(file, 'utf8')) }))
  return t
}

/** Finds a citation's quote in its text. Call only for citations with a quote. */
export function checkQuote(ref: SourceRef, source: Source | undefined): QuoteCheck {
  const memo = checked.get(ref)
  if (memo) return memo
  let out: QuoteCheck
  const url = textUrl(ref, source)
  if (url) {
    const file = quotedFile(url)
    out = !existsSync(file)
      ? { status: 'unread', why: `${url} not downloaded: npm run quotes:fetch -w pipeline` }
      : quoteIn(ref.quote!, downloaded(file))
        ? { status: 'found' }
        : { status: 'not-found', in: url }
  } else if (work(ref.source, ref.locator)) {
    const p = passageText(ref)
    out =
      'why' in p
        ? { status: 'unread', why: p.why }
        : quoteIn(ref.quote!, p.text)
          ? { status: 'found' }
          : { status: 'not-found', in: p.in }
  } else {
    out = { status: 'unread', why: `${ref.source}: no url to read the quote in` }
  }
  checked.set(ref, out)
  return out
}

/** A PDF's text, page by page, read with pdf.js. */
export async function pdfText(body: Uint8Array): Promise<string> {
  const task = getDocument({ data: body, verbosity: 0 })
  const doc = await task.promise
  const pages: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const { items } = await (await doc.getPage(n)).getTextContent()
    pages.push(items.map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : ' ') : '')).join(''))
  }
  await task.destroy()
  return pages.join('\n\n')
}

/** A downloaded page or PDF as plain text, or why it couldn't be read. */
async function asText(body: Buffer, type: string): Promise<string | { why: string }> {
  if (type.includes('pdf') || body.subarray(0, 5).toString() === '%PDF-') {
    try {
      return await pdfText(new Uint8Array(body))
    } catch (err) {
      return { why: `a PDF pdf.js couldn't read: ${(err as Error).message}` }
    }
  }
  const text = body.toString('utf8')
  return type.includes('html') || /^\s*</.test(text) ? htmlText(text) : text
}

/** Downloads a text into the cache, or reads it from there, as the validator will see it. */
async function download(url: string, refresh: boolean): Promise<string | { why: string }> {
  const file = quotedFile(url)
  if (!refresh && existsSync(file)) return readFileSync(file, 'utf8')
  const res = await fetch(url, { headers: { 'User-Agent': userAgent() } })
  if (!res.ok) return { why: `HTTP ${res.status}` }
  const text = await asText(Buffer.from(await res.arrayBuffer()), res.headers.get('content-type') ?? '')
  if (typeof text === 'string') {
    mkdirSync(QUOTED, { recursive: true })
    writeFileSync(file, text)
  }
  return text
}

async function main() {
  const refresh = process.argv.includes('--refresh')
  // One address: print its text, so a quote can be copied from exactly what is checked.
  const one = process.argv.slice(2).find((a) => !a.startsWith('--'))
  if (one) {
    const text = await download(one, refresh)
    if (typeof text !== 'string') throw new Error(`${one}: ${text.why}`)
    process.stdout.write(text)
    return
  }
  const ds = loadDataset()
  const sources = new Map(ds.sources.map((s) => [s.id, s]))
  const refs = [
    ...ds.atoms, ...ds.polities, ...ds.claims, ...ds.relations, ...ds.seats,
    ...ds.places, ...ds.routes, ...ds.roadCorrections, ...ds.landscapeChanges,
    ...ds.features, ...ds.names,
  ].flatMap((r) => r.sources)
  const urls = new Set(
    refs.filter((r) => r.quote).flatMap((r) => textUrl(r, sources.get(r.source)) ?? []),
  )
  let fetched = 0
  for (const url of urls) {
    if (!refresh && existsSync(quotedFile(url))) continue
    const text = await download(url, true)
    if (typeof text !== 'string') {
      console.warn(`${url}: ${text.why}`)
      continue
    }
    fetched++
    console.log(`${String(text.length).padStart(9)} chars  ${url}`)
    // One at a time, with a pause: these are small scholarly sites.
    await new Promise((r) => setTimeout(r, 1000))
  }
  console.log(`${urls.size} texts quoted from, ${fetched} downloaded`)
}

if (process.argv[1] === import.meta.filename) await main()
