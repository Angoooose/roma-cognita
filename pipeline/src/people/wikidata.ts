/**
 * English names for DPRR people, from Wikidata (CC0). DPRR names people the way
 * Broughton does — `M. Tullius (29) M. f. M. n. Cor. Cicero` — and nobody searches
 * for that; they search for "Cicero", "Pompey", "Mark Antony". Wikidata's P6863
 * (Digital Prosopography of the Roman Republic ID) joins the two, and its English
 * label, description and aliases are the names readers actually use.
 *
 *   tsx pipeline/src/people/wikidata.ts
 *
 * What the source is like:
 *
 * - P6863 values are DPRR's bare numeric person id as a string ("2072" is Cicero,
 *   DPRR code TULL2072), not the code. Anything else is counted and skipped.
 * - Two queries, not one per person: WDQS is shared and rate-limited (at times to
 *   one request a minute), so the fetch honours 429 / Retry-After and waits.
 *   Aliases go in their own query; joined to the rest they multiply the rows.
 * - A DPRR id is occasionally claimed by more than one item — usually a duplicate
 *   stub beside the well-known item. The one with more sitelinks wins, then the
 *   lower Q-number; losers are recorded in the cache. An item with several P6863
 *   values maps each of them (DPRR itself sometimes splits one person in two).
 *
 * Output: .cache/sources/dprr/wikidata.json, keyed by DPRR id, with the fetch date.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { userAgent, warnIfNoContact } from '../agent.ts'
import { CACHE_DIR } from '../load.ts'

const OUT = join(CACHE_DIR, 'dprr/wikidata.json')
const ENDPOINT = 'https://query.wikidata.org/sparql'

export interface WikidataPerson {
  qid: string
  label?: string
  description?: string
  aliases: string[]
  /** Commons file name from P18. */
  image?: string
}

interface Cache {
  source: string
  license: string
  fetched: string
  /** Items that lost a DPRR id to another item, by DPRR id. */
  collisions: Record<string, { kept: string; dropped: string[] }>
  people: Record<string, WikidataPerson>
}

// Labels and descriptions are read straight from rdfs:label / schema:description:
// the label service would fall back to other languages, and we want English or nothing.
const MAIN_QUERY = `
SELECT ?item ?id ?label ?description ?image ?sitelinks WHERE {
  ?item wdt:P6863 ?id .
  OPTIONAL { ?item rdfs:label ?label FILTER(LANG(?label) = "en") }
  OPTIONAL { ?item schema:description ?description FILTER(LANG(?description) = "en") }
  OPTIONAL { ?item wdt:P18 ?image }
  OPTIONAL { ?item wikibase:sitelinks ?sitelinks }
}`

const ALIAS_QUERY = `
SELECT ?item ?alias WHERE {
  ?item wdt:P6863 [] ; skos:altLabel ?alias FILTER(LANG(?alias) = "en")
}`

type Binding = Record<string, { value: string } | undefined>

async function sparql(query: string): Promise<Binding[]> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'User-Agent': userAgent(),
        Accept: 'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ query }),
    })
    if (res.ok)
      return ((await res.json()) as { results: { bindings: Binding[] } }).results.bindings
    // Throttled or briefly down: wait as told (default a minute) and try again.
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      const wait = Number(res.headers.get('retry-after')) || 60
      console.warn(`  WDQS ${res.status}; retrying in ${wait}s (attempt ${attempt})`)
      await res.body?.cancel()
      await new Promise((r) => setTimeout(r, (wait + 1) * 1000))
      continue
    }
    throw new Error(`WDQS ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
}

const qidOf = (uri: string) => uri.slice(uri.lastIndexOf('/') + 1)
const qnum = (qid: string) => Number(qid.slice(1))
/** Commons file name from a Special:FilePath URL. */
const fileOf = (uri: string) => decodeURIComponent(uri.slice(uri.lastIndexOf('/') + 1))

/** Fetches every item with P6863 and writes .cache/sources/dprr/wikidata.json (with a fetch date). */
export async function fetchWikidata(): Promise<void> {
  warnIfNoContact('Wikidata')
  const fetched = new Date().toISOString()
  const main = await sparql(MAIN_QUERY)
  const aliasRows = await sparql(ALIAS_QUERY)

  type Item = WikidataPerson & { sitelinks: number; ids: Set<number> }
  const items = new Map<string, Item>()
  let irregular = 0
  for (const b of main) {
    const qid = qidOf(b.item!.value)
    let it = items.get(qid)
    if (!it) {
      it = { qid, aliases: [], sitelinks: 0, ids: new Set() }
      items.set(qid, it)
    }
    const raw = b.id!.value.trim()
    if (/^\d+$/.test(raw)) it.ids.add(Number(raw))
    else irregular++
    if (b.label) it.label = b.label.value
    if (b.description) it.description = b.description.value
    if (b.sitelinks) it.sitelinks = Number(b.sitelinks.value)
    // Several P18 values give several rows; keep the alphabetically first so reruns agree.
    if (b.image) {
      const file = fileOf(b.image.value)
      if (!it.image || file < it.image) it.image = file
    }
  }
  for (const b of aliasRows) {
    const it = items.get(qidOf(b.item!.value))
    if (it && !it.aliases.includes(b.alias!.value)) it.aliases.push(b.alias!.value)
  }

  const claims = new Map<number, Item[]>()
  for (const it of items.values()) {
    it.aliases.sort()
    for (const id of it.ids) claims.set(id, [...(claims.get(id) ?? []), it])
  }

  const people: Cache['people'] = {}
  const collisions: Cache['collisions'] = {}
  for (const id of [...claims.keys()].sort((a, b) => a - b)) {
    const ranked = claims
      .get(id)!
      .sort((a, b) => b.sitelinks - a.sitelinks || qnum(a.qid) - qnum(b.qid))
    const { qid, label, description, aliases, image } = ranked[0]
    people[id] = { qid, label, description, aliases, image }
    if (ranked.length > 1)
      collisions[id] = { kept: qid, dropped: ranked.slice(1).map((r) => r.qid) }
  }

  const cache: Cache = {
    source: 'Wikidata, items with P6863 (DPRR ID), via query.wikidata.org',
    license: 'CC0 1.0',
    fetched,
    collisions,
    people,
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, `${JSON.stringify(cache, null, 1)}\n`)

  const all = Object.values(people)
  const multi = [...items.values()].filter((it) => it.ids.size > 1).length
  console.log(`items with P6863: ${items.size} (${multi} with several DPRR ids)`)
  console.log(`DPRR ids mapped: ${all.length}`)
  console.log(`  with English label: ${all.filter((p) => p.label).length}`)
  console.log(`  with English description: ${all.filter((p) => p.description).length}`)
  console.log(`  with English aliases: ${all.filter((p) => p.aliases.length).length}`)
  console.log(`  with image: ${all.filter((p) => p.image).length}`)
  console.log(`ids claimed by several items: ${Object.keys(collisions).length}`)
  if (irregular) console.log(`non-numeric P6863 values skipped: ${irregular}`)
  console.log(`wrote ${OUT}`)
}

/** Reads the cached file; keyed by DPRR numeric id (e.g. 2072 for Cicero). Throws with a helpful message if the cache is missing. */
export function readWikidata(): Map<number, WikidataPerson> {
  if (!existsSync(OUT)) {
    throw new Error(
      `${OUT} is missing; run \`tsx pipeline/src/people/wikidata.ts\` to fetch it`,
    )
  }
  const cache = JSON.parse(readFileSync(OUT, 'utf8')) as Cache
  return new Map(Object.entries(cache.people).map(([id, p]) => [Number(id), p]))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fetchWikidata().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
