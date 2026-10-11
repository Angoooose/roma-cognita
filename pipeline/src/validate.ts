/**
 * npm run data:validate
 *
 * Loads data/, checks every record against packages/schema and every
 * cross-record rule in rules.ts, and prints its own doubt (DESIGN §1.6): what
 * the data marks as needing a check, what it is uncertain of, and what this
 * validator does not check at all.
 * Exits non-zero on any error; warnings and doubts never fail the build.
 *
 *   npm run data:validate               the report
 *   npm run data:validate -- --quiet    errors and warnings only
 *   npm run data:validate -- <dir>      validate another data directory
 */
import { resolve } from 'node:path'
import { DATA_DIR, readDataset, type Issue } from './load.ts'
import { checkDataset, doubts, evidence, type Doubt } from './rules.ts'

export interface ValidationResult {
  issues: Issue[]
  errors: number
  warnings: number
  report: string
}

const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? '' : 's'}`

function section(title: string, lines: string[]): string {
  return lines.length ? `\n${title}\n${lines.map((l) => `  ${l}`).join('\n')}\n` : ''
}

const doubtLines = (ds: Doubt[]) =>
  ds.map((d) => (d.why ? `${d.where}\n    ${d.why}` : d.where))

function issueLines(issues: Issue[]): string[] {
  // Grouped by rule so a hundred of one mistake reads as one mistake.
  const byRule = new Map<string, Issue[]>()
  for (const i of issues) byRule.set(i.rule, [...(byRule.get(i.rule) ?? []), i])
  return [...byRule].flatMap(([rule, group]) => [
    `[${rule}] ×${group.length}`,
    ...group.map((i) => `  ${i.where}: ${i.message}`),
  ])
}

export function validate(
  dir: string = DATA_DIR,
  opts: { quiet?: boolean } = {},
): ValidationResult {
  const { dataset, issues: loadIssues } = readDataset(dir)
  const issues = [...loadIssues, ...checkDataset(dataset)]
  const errors = issues.filter((i) => i.level === 'error')
  const warnings = issues.filter((i) => i.level === 'warning')
  const d = doubts(dataset)
  const e = evidence(dataset)

  let out = `data:validate — ${dir}\n`
  out += `\n${Object.entries(d.counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`)
    .join(', ')}`
  if (d.claimYears)
    out += `\ndated claim endpoints fall within ${d.claimYears}; the rest are open ends`
  out += `\nevidence: ${e.backed} records backed by quotes, ${e.partly} partly, ${e.unresearched} not yet, ${e.datasets} from datasets alone`
  out += '\n'

  out += section(`ERRORS (${errors.length})`, issueLines(errors))
  out += section(`WARNINGS (${warnings.length})`, issueLines(warnings))
  if (!opts.quiet) {
    out += section(
      `NEEDS CHECK — review: needs-check (${d.needsCheck.length})`,
      doubtLines(d.needsCheck),
    )
    out += section(
      `UNCERTAIN — confidence: uncertain (${d.uncertain.length})`,
      doubtLines(d.uncertain),
    )
    out += section('NOT CHECKED', [
      ...(e.quotes.unread
        ? [
            `quotes whose text isn't downloaded (${e.quotes.unread} of ${e.quotes.unread + e.quotes.found}): run npm run passages:fetch and npm run quotes:fetch -w pipeline`,
          ]
        : []),
      ...d.notChecked,
    ])
  }
  out += `\n${errors.length ? 'FAIL' : 'OK'}: ${plural(errors.length, 'error')}, ${plural(warnings.length, 'warning')}, ${d.needsCheck.length} needing a check\n`

  return { issues, errors: errors.length, warnings: warnings.length, report: out }
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  const args = process.argv.slice(2)
  const quiet = args.includes('--quiet')
  const dir = args.find((a) => !a.startsWith('--'))
  const result = validate(dir ? resolve(process.cwd(), dir) : DATA_DIR, { quiet })
  process.stdout.write(result.report)
  process.exitCode = result.errors ? 1 : 0
}
