/**
 * Which of DPRR's post ranges are windows rather than tenures. DPRR uses a range for
 * two things: the years a post was held throughout (a priesthood from 82 to 77, a
 * lieutenant from 75 to 72), and the years within which a post was held at some point
 * that no source fixes (a tribunate "between 99 and 87", a proconsulship of Sicily
 * "date uncertain", which DPRR stores as 264–31). A window drawn as a tenure says a man
 * held office for a century, and puts him in a province every year of it, so the build
 * marks each window `sometime` and nothing reads one as years in office.
 *
 * Two tests, in order:
 *
 * - **An office held a year at a time.** DPRR gives each year of an office renewed or
 *   prorogued a post of its own (a proconsulship held four years is four posts), so for
 *   the magistracies, commands, commissions and quaestorships, a post spanning several
 *   years is always a window.
 * - **The rest, by name.** A priesthood, a seat in the Senate or a lieutenancy really
 *   is held for years, so for these offices a range is a tenure unless listed below.
 *   Each entry names the range it expects, so a later fetch that redates the post
 *   says so instead of being marked on our word about the old one.
 */
import type { OfficeRole } from '@roma-cognita/schema'

/** Roles whose offices DPRR records a year at a time. */
const YEARLY_ROLES = new Set<OfficeRole>([
  'command',
  'magistracy',
  'commission',
  'candidacy',
])
/** Staff offices that are yearly all the same: a quaestor served a year, renewed as proquaestor. */
const YEARLY_OFFICES = new Set(['quaestor', 'proquaestor'])

export interface Window {
  /** The post's DPRR id. */
  id: number
  /** The range in DPRR's own numbering (−31 is 31 BCE), as the cache holds it. */
  expect: [string, string]
  /** DPRR's own words for the date, from its summary of the person. */
  why: string
}

/** Posts of offices held for years whose range is a window, each read from DPRR's summary. */
export const WINDOWS: Window[] = [
  // The Senate: membership is for life, but these ranges are DPRR's era, not a seat.
  { id: 7680, expect: ['-509', '-31'], why: 'sen. date uncertain' },
  { id: 7692, expect: ['-509', '-31'], why: 'sen. date uncertain' },
  { id: 7872, expect: ['-509', '-31'], why: 'sen. date uncertain' },
  { id: 11068, expect: ['-200', '-50'], why: 'sen. C3-C1?' },
  { id: 7883, expect: ['-200', '-1'], why: 'sen. C2-C1?' },
  { id: 9634, expect: ['-200', '-101'], why: 'sen.? C2' },
  { id: 9248, expect: ['-200', '-101'], why: 'sen.? C2' },
  { id: 7733, expect: ['-100', '-31'], why: 'sen. C1' },
  { id: 9095, expect: ['-125', '-101'], why: 'sen. late C2?' },
  { id: 9243, expect: ['-125', '-100'], why: 'sen. late C2?' },
  { id: 7900, expect: ['-100', '-76'], why: 'sen. early C1' },
  { id: 7651, expect: ['-88', '-78'], why: 'sen. Sullan period?' },
  { id: 7890, expect: ['-79', '-70'], why: 'sen. 70s' },
  { id: 9524, expect: ['-43', '-31'], why: 'sen. before 31' },
  // Under a commander.
  { id: 8345, expect: ['-100', '-75'], why: 'leg. early C1' },
  { id: 7522, expect: ['-43', '-31'], why: 'tr. mil. under 2nd triumvirate?' },
  { id: 7898, expect: ['-43', '-31'], why: 'tr. mil. (triumviral period)' },
  // Equestrian functions.
  { id: 9516, expect: ['-100', '-76'], why: 'eq. R.? late C2/C1' },
  { id: 9503, expect: ['-60', '-30'], why: 'eq. R.? C1?' },
  // Priesthoods dated only by century.
  { id: 9159, expect: ['-400', '-301'], why: 'pont. C4?' },
  { id: 9979, expect: ['-300', '-201'], why: 'vates? C3?' },
  { id: 9993, expect: ['-200', '-151'], why: 'III vir aed. refic. C2?' },
  { id: 9777, expect: ['-100', '-49'], why: 'haruspex? C1?' },
  { id: 10167, expect: ['-50', '-31'], why: 'sacerdos Isidis late Republic' },
]

export interface WindowReport {
  /** Listed windows whose post no longer has the range they expect, or is gone. */
  stale: { window: Window; found?: [string, string] }[]
}

/**
 * A test for whether a post's range is a window, given each post's DPRR id, office
 * role and name, and its range as DPRR wrote it. Checks the list against the posts as
 * it is built, reporting entries that are out of date.
 */
export function windowTest(
  posts: { id: number; start: string; end: string }[],
  list: Window[] = WINDOWS,
): {
  isWindow: (post: {
    id: number
    start: string
    end: string
    role: OfficeRole
    office: string
  }) => boolean
  report: WindowReport
} {
  const range = new Map(posts.map((p) => [p.id, [p.start, p.end] as [string, string]]))
  const listed = new Set<number>()
  const report: WindowReport = { stale: [] }
  for (const w of list) {
    const found = range.get(w.id)
    if (found && found[0] === w.expect[0] && found[1] === w.expect[1]) listed.add(w.id)
    else report.stale.push({ window: w, ...(found ? { found } : {}) })
  }
  return {
    isWindow: (p) => {
      if (p.start === p.end) return false
      if (YEARLY_ROLES.has(p.role) || YEARLY_OFFICES.has(p.office.trim())) return true
      return listed.has(p.id)
    },
    report,
  }
}
