/**
 * The Digital Prosopography of the Roman Republic (King's College London, CC BY-NC
 * 4.0), fetched once from its public SPARQL endpoint and cached as flat tables under
 * .cache/sources/dprr/. The build (build.ts) reads only the cache: KCL's server is
 * not our CDN, and a fetch is a deliberate act that should show up as a diff.
 *
 *   npm run people:fetch -w pipeline      (with wikidata.ts)
 *
 * Each table is one SELECT, flattened to rows of strings exactly as DPRR returns
 * them — years still in DPRR's own numbering (−63 is 63 BCE), ids still bare. All
 * interpretation happens in build.ts, so the cache is a faithful copy of what the
 * endpoint said on the day in manifest.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { userAgent } from './agent.ts'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
export const DPRR_CACHE = join(ROOT_DIR, '.cache/sources/dprr')
const ENDPOINT = 'https://romanrepublic.ac.uk/rdf/endpoint'

const PREFIX = `
PREFIX v: <http://romanrepublic.ac.uk/rdf/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>`

/** A cached row: every variable the query bound, as the endpoint's string value. */
export type Row = Record<string, string | undefined>

/**
 * The tables, by cache file name. Entity references come back as full URIs
 * (`…/entity/Person/2072`); build.ts reads the id off the end.
 */
export const QUERIES = {
  persons: `SELECT ?person ?code ?label ?praenomen ?altPraenomen ?nomen ?cognomen
      ?otherNames ?filiation ?re ?sex ?eraFrom ?eraTo ?highestOffice ?origin
      ?patrician ?nobilis ?novus ?praenomenU ?nomenU ?cognomenU ?filiationU
      ?otherNamesU ?patricianU ?page
    WHERE {
      ?person a v:Person ; v:hasDprrID ?code ; v:hasName ?label ; v:hasNomen ?nomen ;
        v:isSex/v:hasName ?sex ; v:hasEraFrom ?eraFrom ; v:hasEraTo ?eraTo .
      OPTIONAL { ?person v:hasPraenomen/v:Abbreviation ?praenomen }
      OPTIONAL { ?person v:hasAltPraenomen/v:Abbreviation ?altPraenomen }
      OPTIONAL { ?person v:hasCognomen ?cognomen }
      OPTIONAL { ?person v:hasOtherNames ?otherNames }
      OPTIONAL { ?person v:hasFiliation ?filiation }
      OPTIONAL { ?person v:hasReNumber ?re }
      OPTIONAL { ?person v:hasHighestOffice ?highestOffice }
      OPTIONAL { ?person v:hasOrigin ?origin }
      OPTIONAL { ?person v:isPatrician ?patrician }
      OPTIONAL { ?person v:isNobilis ?nobilis }
      OPTIONAL { ?person v:isNovus ?novus }
      OPTIONAL { ?person v:isPraenomenUncertain ?praenomenU }
      OPTIONAL { ?person v:isNomenUncertain ?nomenU }
      OPTIONAL { ?person v:isCognomenUncertain ?cognomenU }
      OPTIONAL { ?person v:isFiliationUncertain ?filiationU }
      OPTIONAL { ?person v:isOtherNamesUncertain ?otherNamesU }
      OPTIONAL { ?person v:isPatricianUncertain ?patricianU }
      OPTIONAL { ?person v:hasAssociatedWebpage ?page }
    } ORDER BY ?person`,

  posts: `SELECT ?post ?person ?office ?start ?end ?uncertain ?startU ?endU ?source
      ?original ?provinceOriginal
    WHERE {
      ?post a v:PostAssertion ; v:isAboutPerson ?person ; v:hasOffice ?office ;
        v:hasDateStart ?start ; v:hasDateEnd ?end ; v:hasSecondarySource ?source .
      OPTIONAL { ?post v:isUncertain ?uncertain }
      OPTIONAL { ?post v:isDateStartUncertain ?startU }
      OPTIONAL { ?post v:isDateEndUncertain ?endU }
      OPTIONAL { ?post v:hasOriginalText ?original }
      OPTIONAL { ?post v:hasProvinceOriginal ?provinceOriginal }
    } ORDER BY ?post`,

  postProvinces: `SELECT ?post ?province ?uncertain
    WHERE {
      ?link a v:PostAssertionProvince ; v:hasPostAssertion ?post ; v:hasProvince ?province .
      OPTIONAL { ?link v:isProvinceUncertain ?uncertain }
    } ORDER BY ?post ?province`,

  relationships: `SELECT ?assertion ?person ?related ?relationship ?uncertain ?source ?extra
    WHERE {
      ?assertion a v:RelationshipAssertion ; v:isAboutPerson ?person ;
        v:hasRelatedPerson ?related ; v:hasRelationship ?relationship ;
        v:hasSecondarySource ?source .
      OPTIONAL { ?assertion v:isUncertain ?uncertain }
      OPTIONAL { ?assertion v:hasExtraInfo ?extra }
    } ORDER BY ?assertion`,

  /** The ancient evidence for a relationship ("Eutr. VII 2.1"), and any note on it. */
  relationshipReferences: `SELECT ?assertion ?citation ?note ?source
    WHERE {
      ?assertion v:hasRelationshipReference ?ref .
      OPTIONAL { ?ref v:hasExtraInfo ?citation }
      OPTIONAL { ?ref v:hasNoteText ?note }
      OPTIONAL { ?ref v:hasSecondarySourceForNote ?source }
    } ORDER BY ?assertion ?ref`,

  /** The ancient evidence for a post or status ("Diod. XXXVIII 12."). */
  primaryReferences: `SELECT ?assertion ?citation
    WHERE { ?ref a v:PrimarySourceReference ; v:forAssertion ?assertion ; v:hasNoteText ?citation }
    ORDER BY ?assertion ?ref`,

  statuses: `SELECT ?assertion ?person ?status ?start ?end ?uncertain ?startU ?endU ?source ?original
    WHERE {
      ?assertion a v:StatusAssertion ; v:isAboutPerson ?person ; v:hasStatus ?status ;
        v:hasSecondarySource ?source .
      OPTIONAL { ?assertion v:hasDateStart ?start }
      OPTIONAL { ?assertion v:hasDateEnd ?end }
      OPTIONAL { ?assertion v:isUncertain ?uncertain }
      OPTIONAL { ?assertion v:isDateStartUncertain ?startU }
      OPTIONAL { ?assertion v:isDateEndUncertain ?endU }
      OPTIONAL { ?assertion v:hasOriginalText ?original }
    } ORDER BY ?assertion`,

  /** Life dates: birth, death, floruit and the like, each with its type. */
  lifeDates: `SELECT ?info ?person ?type ?value ?interval ?uncertain ?source ?note
    WHERE {
      ?info a v:DateInformation ; v:isAboutPerson ?person ; v:hasDateType/v:hasName ?type ;
        v:hasValue ?value .
      OPTIONAL { ?info v:hasDateInterval ?interval }
      OPTIONAL { ?info v:isUncertain ?uncertain }
      OPTIONAL { ?info v:hasSecondarySource ?source }
      OPTIONAL { ?info v:hasNotes ?note }
    } ORDER BY ?info`,

  offices: `SELECT ?office ?name ?abbreviation ?parent
    WHERE {
      ?office a v:Office ; v:hasName ?name .
      OPTIONAL { ?office v:hasAbbreviation ?abbreviation }
      OPTIONAL { ?office v:hasParent ?parent }
    } ORDER BY ?office`,

  provinces: `SELECT ?province ?name ?description ?parent
    WHERE {
      ?province a v:Province .
      OPTIONAL { ?province v:hasName ?name }
      OPTIONAL { ?province v:hasDescription ?description }
      OPTIONAL { ?province v:hasParent ?parent }
    } ORDER BY ?province`,

  relationshipTypes: `SELECT ?relationship ?name ?order
    WHERE { ?relationship a v:Relationship ; v:hasName ?name . OPTIONAL { ?relationship v:hasOrderNumber ?order } }
    ORDER BY ?relationship`,

  /** DPRR's own inverses, keyed by relationship and the sex of the other person. */
  relationshipInverses: `SELECT ?relationship ?sex ?inverse
    WHERE { ?x a v:RelationshipInverse ; v:forRelationship ?relationship ;
      v:forSex/v:hasName ?sex ; v:hasInverseRelationship ?inverse }
    ORDER BY ?relationship ?sex`,

  sources: `SELECT ?source ?abbreviation ?name ?biblio
    WHERE { ?source a v:SecondarySource ; v:hasName ?name .
      OPTIONAL { ?source v:hasAbbreviation ?abbreviation }
      OPTIONAL { ?source v:hasBiblio ?biblio } }
    ORDER BY ?source`,

  statusTypes: `SELECT ?status ?name ?abbreviation
    WHERE { ?status a v:Status ; v:hasName ?name . OPTIONAL { ?status v:hasAbbreviation ?abbreviation } }`,
} as const

export type Table = keyof typeof QUERIES

interface SparqlJson {
  head: { vars: string[] }
  results: { bindings: Record<string, { value: string }>[] }
}

async function select(query: string): Promise<Row[]> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/sparql-results+json',
      'User-Agent': userAgent(),
    },
    body: new URLSearchParams({ query: PREFIX + query }),
  })
  if (!res.ok) throw new Error(`DPRR endpoint: HTTP ${res.status} ${await res.text()}`)
  const json = (await res.json()) as SparqlJson
  return json.results.bindings.map((b) => {
    const row: Row = {}
    for (const v of json.head.vars) row[v] = b[v]?.value
    return row
  })
}

/** Runs every query in turn (the endpoint is a small academic server) and writes the cache. */
export async function fetchDprr() {
  mkdirSync(DPRR_CACHE, { recursive: true })
  const counts: Record<string, number> = {}
  for (const [table, query] of Object.entries(QUERIES)) {
    const t0 = Date.now()
    const rows = await select(query)
    writeFileSync(join(DPRR_CACHE, `${table}.json`), JSON.stringify(rows))
    counts[table] = rows.length
    console.log(
      `  ${table.padEnd(24)} ${String(rows.length).padStart(6)} rows  ${Date.now() - t0} ms`,
    )
  }
  const manifest = { endpoint: ENDPOINT, fetched: new Date().toISOString(), counts }
  writeFileSync(join(DPRR_CACHE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
}

export interface DprrManifest {
  endpoint: string
  fetched: string
  counts: Record<Table, number>
}

/** The cached tables. Throws, saying how to fetch them, if the cache is missing. */
export function readDprr(): { manifest: DprrManifest; tables: Record<Table, Row[]> } {
  const manifestPath = join(DPRR_CACHE, 'manifest.json')
  if (!existsSync(manifestPath)) {
    throw new Error(
      `no DPRR cache at ${DPRR_CACHE}: run \`npm run people:fetch -w pipeline\` first`,
    )
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as DprrManifest
  const tables = {} as Record<Table, Row[]>
  for (const table of Object.keys(QUERIES) as Table[]) {
    tables[table] = JSON.parse(readFileSync(join(DPRR_CACHE, `${table}.json`), 'utf8'))
  }
  return { manifest, tables }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`fetching DPRR from ${ENDPOINT}`)
  fetchDprr().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
