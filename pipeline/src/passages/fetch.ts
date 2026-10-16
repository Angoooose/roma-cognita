/**
 * Records the passages each ancient text's English page has an anchor for, so a
 * citation can link to the passage and not just the work (works.ts says which pages).
 * The pages are fetched once and cached under .cache/sources/passages/; what they
 * hold is written to data/passages.json, which is committed: every build
 * reads it, and a re-fetch that moves an anchor shows up as a diff.
 *
 *   npm run passages:fetch -w pipeline              (cached pages are reused)
 *   npm run passages:fetch -w pipeline -- --refresh (download them all again)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { userAgent } from '../agent.ts'
import { compareRef, parseRef } from './passage.ts'
import { allWorks, pageUrl, type Work } from './works.ts'
import { CACHE_DIR, DATA_DIR } from '../load.ts'

export const CACHE = join(CACHE_DIR, 'passages')
export const INDEX = join(DATA_DIR, 'passages.json')

/** Each anchor on the page in page order, with the text up to the next. */
export function anchors(html: string, w: Work): { id: string; text: string }[] {
  const re =
    w.site === 'attalus'
      ? /<A [^>]*NAME="([^"]+)"/gi
      : /class="pSelector" id=['"]?([^'" >]+)/g
  const found = [...html.matchAll(re)]
  return found.map((m, i) => ({
    id: m[1].replace(/\.$/, ''),
    text: html.slice(m.index + m[0].length, found[i + 1]?.index ?? html.length),
  }))
}

/**
 * The references a page has a place for, each with the anchor that holds it: the
 * anchor's own reference, or the sections printed inside it (works.ts).
 */
export function passages(html: string, w: Work): [ref: string, anchor: string][] {
  const out = new Map<string, string>()
  for (const { id, text } of anchors(html, w)) {
    if (w.strip && !w.strip.test(id)) continue
    const parts = id.replace(w.strip ?? /^$/, '').split('.')
    if (w.drop !== undefined) parts.splice(w.drop, 1)
    if (!parseRef(parts.join('.'))) continue
    const refs = w.inline
      ? [...text.matchAll(/\[(\d+)\]/g)].map((m) =>
          w.inline === 'book' ? `${parts[0]}.${m[1]}` : m[1],
        )
      : [parts.join('.')]
    for (const r of refs) if (!out.has(r)) out.set(r, id)
  }
  return [...out].sort((a, b) => compareRef(parseRef(a[0])!, parseRef(b[0])!))
}

/** Where a page is cached, by the key the anchor index files it under. */
export const pageFile = (key: string) =>
  join(CACHE, `${key.replace(/[^a-z0-9]+/gi, '-')}.html`)

async function page(key: string, w: Work, refresh: boolean): Promise<string> {
  const file = pageFile(key)
  if (!refresh && existsSync(file)) return readFileSync(file, 'utf8')
  const res = await fetch(pageUrl(w), { headers: { 'User-Agent': userAgent() } })
  if (!res.ok) throw new Error(`${pageUrl(w)}: HTTP ${res.status}`)
  const html = await res.text()
  writeFileSync(file, html)
  // One page at a time, with a pause: these are small scholarly sites.
  await new Promise((r) => setTimeout(r, 1000))
  return html
}

async function main() {
  const refresh = process.argv.includes('--refresh')
  mkdirSync(CACHE, { recursive: true })
  const index: Record<string, { page: string; passages: string[] }> = {}
  for (const [key, w] of allWorks()) {
    const found = passages(await page(key, w, refresh), w)
    if (!found.length) throw new Error(`${key}: no anchors found on ${pageUrl(w)}`)
    // "16.2.10" where the anchor is the reference, "14.64 14.4.3" where it is not.
    index[key] = {
      page: pageUrl(w),
      passages: found.map(([r, a]) => (r === a ? r : `${r} ${a}`)),
    }
    console.log(
      `${key.padEnd(26)} ${String(found.length).padStart(5)} passages  ${pageUrl(w)}`,
    )
  }
  writeFileSync(INDEX, JSON.stringify(index, null, 1) + '\n')
  console.log(`wrote ${INDEX}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
