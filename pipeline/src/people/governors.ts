/**
 * Who governed each of our polities, year by year: DPRR's posts joined to our polities
 * through data/dprr-provinces.yaml.
 *
 * A post counts for a polity in a year when its province is a `territory` joined to
 * that polity over that year, and its office is a `command` (the governor) or `staff`
 * (his legates, quaestors and prefects). Everything else a province row holds — a
 * court, a jurisdiction at Rome, a command at sea — is not ground, and never lands in
 * a province's inspector.
 *
 * A join the table marks uncertain (Transalpine Gaul standing for Gallia Comata) makes
 * everyone it brings uncertain there: DPRR cannot say which half of Gaul a man held.
 *
 * A post held sometime within its years (PostRecord.sometime) puts no one in any one
 * of them, so it governs nothing here.
 *
 * DPRR works in whole years, so two commanders in one year is ordinary: an outgoing
 * governor and his successor. Both are kept; the app shows both.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import {
  DprrProvinceSchema,
  type DprrProvince,
  type Endpoint,
  type GovernorshipRecord,
  type OfficeRole,
  type PostRecord,
  type Year,
} from '@roma-cognita/schema'

/** Reads data/dprr-provinces.yaml, or null if it has not been written yet. */
export function readDprrProvinces(dataDir: string): DprrProvince[] | null {
  const path = join(dataDir, 'dprr-provinces.yaml')
  if (!existsSync(path)) return null
  const rows = parse(readFileSync(path, 'utf8')) as unknown[]
  return rows.map((row, i) => {
    const r = DprrProvinceSchema.safeParse(row)
    if (!r.success) {
      throw new Error(
        `dprr-provinces.yaml#${i + 1}: ${r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`,
      )
    }
    return r.data
  })
}

// An open end ("before 68 BCE") bounds nothing in its direction.
const startOf = (e: Endpoint | undefined) =>
  !e || e.open === 'before' ? -Infinity : e.year
const endOf = (e: Endpoint | undefined) => (!e || e.open === 'after' ? Infinity : e.year)

export interface GovernorReport {
  /** DPRR provinces with posts that the table does not list, and how many posts. */
  unlisted: Map<string, number>
  /** Names the table lists that DPRR does not have. */
  unknownNames: string[]
  /** Polity ids the table uses that we do not have. */
  unknownPolities: string[]
}

export function joinGovernors(
  posts: PostRecord[],
  provinceName: (id: number) => string | undefined,
  roleOf: (office: number) => OfficeRole | undefined,
  table: DprrProvince[],
  polityIds: Set<string>,
  /** Every province name DPRR has, posts or not. */
  dprrNames: Set<string>,
): { records: GovernorshipRecord[]; report: GovernorReport } {
  const byName = new Map(table.map((t) => [t.dprr, t]))
  const report: GovernorReport = {
    unlisted: new Map(),
    unknownNames: table.map((t) => t.dprr).filter((n) => !dprrNames.has(n)),
    unknownPolities: [
      ...new Set(table.flatMap((t) => t.polities.map((p) => p.polity))),
    ].filter((id) => !polityIds.has(id)),
  }

  const records: GovernorshipRecord[] = []
  for (const post of posts) {
    if (post.sometime) continue
    const role = roleOf(post.office)
    for (const link of post.provinces) {
      const name = provinceName(link.id)
      if (name === undefined) continue
      const entry = byName.get(name)
      if (!entry) {
        report.unlisted.set(name, (report.unlisted.get(name) ?? 0) + 1)
        continue
      }
      if (role !== 'command' && role !== 'staff') continue
      for (const j of entry.polities) {
        const from = Math.max(post.from.year, startOf(j.from))
        const to = Math.min(post.to.year, endOf(j.to))
        for (let year: Year = from; year <= to; year++) {
          records.push({
            polity: j.polity,
            year,
            post: post.id,
            province: link.id,
            role,
            uncertain: post.uncertain || link.uncertain || j.confidence === 'uncertain',
          })
        }
      }
    }
  }
  return { records, report }
}

/**
 * The years a province was one on our map but DPRR attests no one in command there:
 * "no governor attested" is an answer, and the build prints where it is the answer.
 */
export function unattestedYears(
  provinceYears: Map<string, Set<Year>>,
  records: GovernorshipRecord[],
): Map<string, Year[]> {
  const commanded = new Set(
    records.filter((r) => r.role === 'command').map((r) => `${r.polity}|${r.year}`),
  )
  const out = new Map<string, Year[]>()
  for (const [polity, years] of provinceYears) {
    const missing = [...years]
      .filter((y) => !commanded.has(`${polity}|${y}`))
      .sort((a, b) => a - b)
    if (missing.length) out.set(polity, missing)
  }
  return out
}
