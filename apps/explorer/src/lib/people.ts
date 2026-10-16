import type {
  Authorities,
  Governorships,
  GovernorshipRecord,
  LifeEventRecord,
  OfficeRole,
  PersonId,
  PersonRecord,
  PostRecord,
  RelationshipRecord,
  StatusRecord,
} from '@roma-cognita/schema'

/**
 * The people layer, as the app reads it: build/people/, fetched once after
 * the map's first frame and indexed for the panels. Everything here is derived from
 * DPRR (CC BY-NC 4.0) and Wikidata; the person panel credits both.
 */
export class People {
  readonly persons = new Map<PersonId, PersonRecord>()
  readonly offices = new Map<number, Authorities['offices'][number]>()
  readonly provinces = new Map<number, string>()
  readonly sources = new Map<number, Authorities['sources'][number]>()
  readonly statuses = new Map<number, string>()
  private readonly relationshipNames = new Map<number, string>()
  private readonly postsOf = new Map<PersonId, PostRecord[]>()
  private readonly postById = new Map<number, PostRecord>()
  private readonly familyOf = new Map<PersonId, RelationshipRecord[]>()
  private readonly statusesOf = new Map<PersonId, StatusRecord[]>()
  private readonly eventsOf = new Map<PersonId, LifeEventRecord[]>()
  private readonly served = new Map<string, GovernorshipRecord[]>()
  /** Each post's years in command of our polities, for the person panel's place links. */
  private readonly commandsOf = new Map<number, GovernorshipRecord[]>()
  /** Posts by office and first year, for a consul's colleague. */
  private readonly byOfficeYear = new Map<string, PostRecord[]>()
  private readonly officeByAbbreviation = new Map<string, Authorities['offices'][number]>()
  private readonly joined: Set<string>

  constructor(d: {
    persons: PersonRecord[]
    posts: PostRecord[]
    relationships: RelationshipRecord[]
    statuses: StatusRecord[]
    lifeEvents: LifeEventRecord[]
    authorities: Authorities
    governorships: Governorships
  }) {
    for (const p of d.persons) this.persons.set(p.id, p)
    for (const o of d.authorities.offices) {
      this.offices.set(o.id, o)
      if (o.abbreviation) this.officeByAbbreviation.set(o.abbreviation, o)
    }
    for (const p of d.authorities.provinces) this.provinces.set(p.id, p.name)
    for (const s of d.authorities.sources) this.sources.set(s.id, s)
    for (const s of d.authorities.statuses) this.statuses.set(s.id, s.name)
    for (const r of d.authorities.relationships) this.relationshipNames.set(r.id, r.name)
    for (const p of d.posts) {
      push(this.postsOf, p.person, p)
      this.postById.set(p.id, p)
      push(this.byOfficeYear, `${p.office}|${p.from.year}`, p)
    }
    for (const r of d.relationships) {
      push(this.familyOf, r.a, r)
      if (r.b !== r.a) push(this.familyOf, r.b, r)
    }
    for (const s of d.statuses) push(this.statusesOf, s.person, s)
    for (const e of d.lifeEvents) push(this.eventsOf, e.person, e)
    for (const g of d.governorships.records) {
      push(this.served, `${g.polity}|${g.year}`, g)
      if (g.role === 'command') push(this.commandsOf, g.post, g)
    }
    this.joined = new Set(d.governorships.polities)
  }

  static async load(base = '/people'): Promise<People> {
    const get = async <T>(name: string): Promise<T> => {
      const res = await fetch(`${base}/${name}.json`)
      if (!res.ok) throw new Error(`${base}/${name}.json: HTTP ${res.status}`)
      return res.json() as Promise<T>
    }
    const [
      persons,
      posts,
      relationships,
      statuses,
      lifeEvents,
      authorities,
      governorships,
    ] = await Promise.all([
      get<PersonRecord[]>('persons'),
      get<PostRecord[]>('posts'),
      get<RelationshipRecord[]>('relationships'),
      get<StatusRecord[]>('statuses'),
      get<LifeEventRecord[]>('lifeEvents'),
      get<Authorities>('authorities'),
      get<Governorships>('governorships'),
    ])
    return new People({
      persons,
      posts,
      relationships,
      statuses,
      lifeEvents,
      authorities,
      governorships,
    })
  }

  person(id: PersonId) {
    return this.persons.get(id)
  }

  role(post: PostRecord): OfficeRole {
    return this.offices.get(post.office)?.role ?? 'other'
  }

  officeName(post: PostRecord) {
    return this.offices.get(post.office)?.name.trim() ?? 'office unknown'
  }

  /** The consuls who took office in a year, the ordinary pair before any suffect. */
  consuls(year: number): PersonRecord[] {
    const out = new Map<PersonId, PersonRecord>()
    for (const name of ['consul', 'consul suffectus']) {
      for (const o of this.offices.values()) {
        if (o.name.trim() !== name) continue
        for (const post of this.byOfficeYear.get(`${o.id}|${year}`) ?? []) {
          const p = this.persons.get(post.person)
          if (p && !out.has(p.id)) out.set(p.id, p)
        }
      }
    }
    return [...out.values()]
  }

  // --- a province in a year -------------------------------------------------------

  /** Whether the province table joins this polity to DPRR at all. */
  isJoined(polity: string) {
    return this.joined.has(polity)
  }

  /**
   * Who governed a polity in a year, and who served under them. A governor's tenure is
   * the unbroken run of years he commanded there, so an outgoing governor sorts before
   * his successor.
   */
  governors(polity: string, year: number): { command: Service[]; staff: Service[] } {
    const rows = this.served.get(`${polity}|${year}`) ?? []
    const service = (g: GovernorshipRecord): Service => {
      const post = this.postById.get(g.post)!
      return {
        post,
        person: this.persons.get(post.person)!,
        tenure: this.tenure(polity, post.person, year, g.role),
        uncertain: g.uncertain,
      }
    }
    const byPerson = (list: Service[]) => {
      // One row per person: DPRR can list a man twice in a year (praetor and proconsul).
      const seen = new Map<PersonId, Service>()
      for (const s of list) if (!seen.has(s.person.id)) seen.set(s.person.id, s)
      return [...seen.values()].sort(
        (a, b) => a.tenure[0] - b.tenure[0] || a.person.name.localeCompare(b.person.name),
      )
    }
    return {
      command: byPerson(rows.filter((g) => g.role === 'command').map(service)),
      staff: byPerson(rows.filter((g) => g.role === 'staff').map(service)),
    }
  }

  /**
   * A polity's governors over the given years, as the Romans' fasti list them: each
   * man's unbroken years in command one term, and the years no one is attested in
   * command as gaps of their own. Two in one year (outgoing and incoming) are both kept.
   */
  fasti(polity: string, years: number[]): FastiLine[] {
    const lines: FastiLine[] = []
    const open = new Map<PersonId, Extract<FastiLine, { kind: 'term' }>>()
    for (const y of [...years].sort((a, b) => a - b)) {
      const { command } = this.governors(polity, y)
      if (!command.length) {
        const last = lines.at(-1)
        if (last?.kind === 'gap' && last.to === y - 1) last.to = y
        else lines.push({ kind: 'gap', from: y, to: y })
        continue
      }
      for (const s of command) {
        const term = open.get(s.person.id)
        if (term && term.to === y - 1) {
          term.to = y
          term.uncertain ||= s.uncertain
        } else {
          const next = {
            kind: 'term' as const,
            person: s.person,
            post: s.post,
            from: y,
            to: y,
            uncertain: s.uncertain,
          }
          lines.push(next)
          open.set(s.person.id, next)
        }
      }
    }
    return lines
  }

  private tenure(
    polity: string,
    person: PersonId,
    year: number,
    role: string,
  ): [number, number] {
    const holds = (y: number) =>
      (this.served.get(`${polity}|${y}`) ?? []).some(
        (g) => g.role === role && this.postById.get(g.post)!.person === person,
      )
    let from = year
    let to = year
    while (holds(from - 1)) from--
    while (holds(to + 1)) to++
    return [from, to]
  }

  // --- a person ---------------------------------------------------------------------

  /**
   * A career as the person panel draws it: the offices and other posts in order, the
   * commands with the ground they were held on, and the standing that ran for years
   * (the Senate, a priesthood) as lanes. A post DPRR repeats year by year, such as a
   * proconsulship renewed, is merged into one run of years.
   */
  career(id: PersonId): Career {
    const posts = this.postsOf.get(id) ?? []
    const lines: CareerLine[] = []
    const commands: Command[] = []
    const priesthoods = new Map<number, PostRecord[]>()

    const officeRuns = merge(
      posts.filter((p) => {
        const role = this.role(p)
        return (
          role !== 'priesthood' &&
          !(role === 'command' && isPromagistracy(this.officeName(p)))
        )
      }),
      (p) => `${p.office}|${this.detail(p) ?? ''}`,
    )
    for (const run of officeRuns) lines.push(this.careerLine(run))

    const commandRuns = merge(
      posts.filter(
        (p) =>
          this.role(p) === 'command' &&
          (isPromagistracy(this.officeName(p)) || this.commandsOf.has(p.id)),
      ),
      (p) => `${p.office}|${p.provinces.map((x) => x.id).join(',')}`,
    )
    for (const run of commandRuns) commands.push(this.command(run))

    for (const p of posts) if (this.role(p) === 'priesthood') push(priesthoods, p.office, p)
    for (const e of this.eventsOf.get(id) ?? []) {
      const word = EVENT_WORDS[e.type]
      if (!word) continue
      lines.push({
        kind: 'event',
        from: e.year,
        to: e.year,
        label: word,
        uncertain: e.uncertain,
        colleagues: [],
        chart: false,
      })
    }

    const standing: Lane[] = []
    const byStatus = new Map<number, StatusRecord[]>()
    for (const s of this.statusesOf.get(id) ?? []) if (s.from) push(byStatus, s.status, s)
    for (const [status, list] of byStatus) {
      const name = this.statuses.get(status) ?? 'status'
      standing.push({
        label: STATUS_WORDS[name] ?? name,
        spans: list
          .map((s) => ({
            from: s.from!.year,
            to: s.to?.year ?? s.from!.year,
            uncertain: s.uncertain,
          }))
          .sort((a, b) => a.from - b.from),
      })
    }
    for (const [office, list] of priesthoods) {
      const name = this.offices.get(office)?.name.trim() ?? 'priesthood'
      standing.push({
        label: capital(OFFICE_WORDS[name] ?? name),
        spans: list
          .map((p) => ({ from: p.from.year, to: p.to.year, uncertain: p.uncertain }))
          .sort((a, b) => a.from - b.from),
      })
    }

    const order = (a: { from: number; to: number }, b: { from: number; to: number }) =>
      a.from - b.from || a.to - b.to
    return { lines: lines.sort(order), commands: commands.sort(order), standing }
  }

  /** An office in plain English where there is a usual word for it: `tribunus plebis` → `Tribune of the plebs`. */
  officeLabel(post: PostRecord) {
    const name = this.officeName(post)
    return capital(OFFICE_WORDS[name] ?? name)
  }

  /**
   * DPRR's summary, `cos. 69`, as the panel says it: `consul 69 BCE`. Nothing where the
   * summary is not an office and a year (for a woman, DPRR names her husband).
   */
  highestOffice(p: PersonRecord) {
    const m = p.highestOffice && /^([^()]+?)\s+(\d+)$/.exec(p.highestOffice)
    if (!m) return undefined
    const name = this.officeByAbbreviation.get(m[1])?.name.trim()
    return `${name ? (OFFICE_WORDS[name] ?? name) : m[1]} ${m[2]} BCE`
  }

  /** What a line says after the office: the praetor's court, an envoy's destination. */
  private detail(post: PostRecord) {
    const names = post.provinces.map((x) => ({
      name: this.provinces.get(x.id) ?? '?',
      uncertain: x.uncertain,
    }))
    // Rome goes without saying beside a court or a praetor's jurisdiction.
    const words = names
      .filter((n) => !(names.length > 1 && n.name === 'Rome'))
      .map(
        (n) =>
          `${PROVINCE_WORDS[n.name] ?? COURT_WORDS[n.name] ?? n.name}${n.uncertain ? '?' : ''}`,
      )
    return words.length ? words.join(', ') : undefined
  }

  private careerLine(run: PostRecord[]): CareerLine {
    const first = run[0]
    const role = this.role(first)
    const base = {
      from: first.from.year,
      to: run.at(-1)!.to.year,
      uncertain: run.some((p) => p.uncertain),
      detail: this.detail(first),
      abbreviation: this.offices.get(first.office)?.abbreviation,
    }
    if (role === 'candidacy') {
      // `repulsa (pr.)`: lost an election, for the office abbreviated in brackets.
      const sought = /\((.+?)\)/.exec(this.officeName(first))?.[1]
      const office = sought ? this.officeByAbbreviation.get(sought) : undefined
      const word = office
        ? (OFFICE_WORDS[office.name.trim()] ?? office.name.trim())
        : 'office'
      return {
        ...base,
        kind: 'candidacy',
        label: `Stood for ${word}`,
        colleagues: [],
        chart: false,
      }
    }
    const name = this.officeName(first)
    const colleagues = COLLEGIAL.has(name)
      ? (this.byOfficeYear.get(`${first.office}|${first.from.year}`) ?? [])
          .filter((p) => p.person !== first.person)
          .map((p) => this.persons.get(p.person))
          .filter((p): p is PersonRecord => !!p)
      : []
    // A court read as an adjective goes before the office: `Urban praetor`.
    const court = base.detail && COURTS.has(base.detail.replace(/\?$/, ''))
    return {
      ...base,
      kind: role === 'distinction' ? 'distinction' : 'office',
      label: court
        ? capital(
            `${base.detail!.replace(/\?$/, '')} ${this.officeLabel(first).toLowerCase()}`,
          )
        : this.officeLabel(first),
      detail: court ? undefined : base.detail,
      colleagues,
      // The cursus, whatever our roles call it: a provincial quaestor is staff to his governor.
      chart: role === 'magistracy' || CURSUS.has(name),
    }
  }

  private command(run: PostRecord[]): Command {
    const first = run[0]
    // One place for each of our polities the post's provinces stand for, as the
    // inspector lists the governor: one DPRR province can stand for two (Transalpine
    // Gaul after the conquest is the old province and Gallia Comata), and two for one.
    // A province that is not ground on our map keeps DPRR's name, with no polity.
    const places: CommandPlace[] = []
    for (const x of first.provinces) {
      const records = run
        .flatMap((p) => this.commandsOf.get(p.id) ?? [])
        .filter((g) => g.province === x.id)
        .sort((a, b) => a.year - b.year)
      const name = this.provinces.get(x.id) ?? '?'
      const polities = [...new Set(records.map((g) => g.polity))]
      if (!polities.length) places.push({ name, uncertain: x.uncertain, years: [] })
      for (const polity of polities) {
        const years = records.filter((g) => g.polity === polity).map((g) => g.year)
        const seen = places.find((p) => p.polity === polity)
        if (seen) seen.years = [...new Set([...seen.years, ...years])].sort((a, b) => a - b)
        else places.push({ name, uncertain: x.uncertain, polity, years })
      }
    }
    const source = this.sources.get(first.source)
    return {
      from: first.from.year,
      to: run.at(-1)!.to.year,
      label: this.officeLabel(first),
      uncertain: run.some((p) => p.uncertain),
      places,
      source: source?.abbreviation ?? source?.name,
      citations: [...new Set(run.flatMap((p) => p.citations))],
    }
  }

  /** Birth and death where DPRR dates them. */
  lifespan(id: PersonId): { born?: LifeEventRecord; died?: LifeEventRecord } {
    const events = this.eventsOf.get(id) ?? []
    return {
      born: events.find((e) => e.type === 'birth'),
      died: events.find((e) => e.type.startsWith('death')),
    }
  }

  /** Relatives, grouped as a reader looks for them, each with what they were to this person. */
  family(id: PersonId): FamilyGroup[] {
    const me = this.persons.get(id)
    if (!me) return []
    const byOther = new Map<PersonId, Relative>()
    for (const r of this.familyOf.get(id) ?? []) {
      const otherId = r.a === id ? r.b : r.a
      const other = this.persons.get(otherId)
      if (!other) continue
      // `a` is `type` of `b`: the other person is `type` of me, or `inverse` of me.
      const name =
        r.a === id
          ? r.inverse !== null
            ? this.relationshipNames.get(r.inverse)
            : undefined
          : this.relationshipNames.get(r.type)
      const label = name
        ? kin(name)
        : // DPRR has no word for the reverse: say it from this person's side.
          `${me.sex === 'female' ? 'she' : 'he'} is ${this.relationshipNames.get(r.type)}`
      const group = GROUP_OF(name ?? this.relationshipNames.get(r.type))
      const rel = byOther.get(otherId) ?? {
        person: other,
        labels: [],
        uncertain: false,
        group,
      }
      if (!rel.labels.includes(label)) rel.labels.push(label)
      rel.uncertain ||= r.uncertain
      byOther.set(otherId, rel)
    }
    const groups = new Map<FamilyGroup['name'], Relative[]>()
    for (const rel of byOther.values()) push(groups, rel.group, rel)
    return GROUPS.filter((g) => groups.has(g)).map((g) => ({
      name: g,
      relatives: groups
        .get(g)!
        .sort((a, b) => (a.person.active?.from ?? 0) - (b.person.active?.from ?? 0)),
    }))
  }

  /** The modern works behind everything said about this person. */
  sourcesFor(id: PersonId) {
    const ids = new Set<number>()
    for (const p of this.postsOf.get(id) ?? []) ids.add(p.source)
    for (const s of this.statusesOf.get(id) ?? []) ids.add(s.source)
    for (const e of this.eventsOf.get(id) ?? [])
      if (e.source !== undefined) ids.add(e.source)
    for (const r of this.familyOf.get(id) ?? []) for (const s of r.sources) ids.add(s)
    return [...ids].map((s) => this.sources.get(s)!).filter(Boolean)
  }
}

export interface CareerLine {
  kind: 'office' | 'candidacy' | 'distinction' | 'event'
  from: number
  to: number
  /** `Tribune of the plebs`, `Stood for praetor`, `Exiled`. */
  label: string
  /** After the office, in italic: `urban`, `Gallia Transalpina`. */
  detail?: string
  uncertain: boolean
  /** The other consuls or censors of the year. */
  colleagues: PersonRecord[]
  /** DPRR's abbreviation, for the chart's label: `cos.`. */
  abbreviation?: string
  /** A magistracy, marked on the chart's line of offices. */
  chart: boolean
}

export interface CommandPlace {
  /** DPRR's name for the province; the panel says our polity's name where there is one. */
  name: string
  uncertain: boolean
  /** Our polity it stood for, if it is ground on our map. */
  polity?: string
  /** The years it did, within the post: where to take the map. */
  years: number[]
}

export interface Command {
  from: number
  to: number
  /** `Proconsul`. */
  label: string
  uncertain: boolean
  places: CommandPlace[]
  source?: string
  citations: string[]
}

export interface Lane {
  /** `Senate`, `Pontifex`. */
  label: string
  spans: { from: number; to: number; uncertain: boolean }[]
}

export interface Career {
  lines: CareerLine[]
  commands: Command[]
  standing: Lane[]
}

export type FastiLine =
  | {
      kind: 'term'
      person: PersonRecord
      post: PostRecord
      from: number
      to: number
      uncertain: boolean
    }
  | { kind: 'gap'; from: number; to: number }

export interface Service {
  post: PostRecord
  person: PersonRecord
  /** The unbroken years this person held this role in this polity. */
  tenure: [number, number]
  uncertain: boolean
}

export interface Relative {
  person: PersonRecord
  /** What they were to this person: `father`, `married`, `divorced`. */
  labels: string[]
  uncertain: boolean
  group: FamilyGroup['name']
}

const GROUPS = ['Parents', 'Spouses', 'Children', 'Siblings', 'Wider family'] as const
export interface FamilyGroup {
  name: (typeof GROUPS)[number]
  relatives: Relative[]
}

/**
 * Runs of one post held year after year: DPRR records a proconsulship renewed for four
 * years as four posts. Posts with the same key that meet or overlap become one run.
 */
function merge(posts: PostRecord[], key: (p: PostRecord) => string): PostRecord[][] {
  const groups = new Map<string, PostRecord[]>()
  for (const p of posts) push(groups, key(p), p)
  const runs: PostRecord[][] = []
  for (const list of groups.values()) {
    list.sort((a, b) => a.from.year - b.from.year)
    let run: PostRecord[] = []
    for (const p of list) {
      if (run.length && p.from.year <= run.at(-1)!.to.year + 1) run.push(p)
      else {
        if (run.length) runs.push(run)
        run = [p]
      }
    }
    if (run.length) runs.push(run)
  }
  return runs
}

/** A post held in place of a magistrate: proconsul, propraetor, legatus pro praetore. */
function isPromagistracy(name: string) {
  return /^pro|\spro\s/.test(name.toLowerCase())
}

/** Offices held two at a time, where a line names the colleague. */
const COLLEGIAL = new Set(['consul', 'censor'])

/** DPRR's office names, in the English a reader knows them by. The rest keep DPRR's word. */
const OFFICE_WORDS: Record<string, string> = {
  consul: 'consul',
  'consul suffectus': 'suffect consul',
  'consul designatus': 'consul elect',
  praetor: 'praetor',
  'praetor designatus': 'praetor elect',
  quaestor: 'quaestor',
  aedilis: 'aedile',
  'aedilis curulis': 'curule aedile',
  'aedilis plebis': 'plebeian aedile',
  'tribunus plebis': 'tribune of the plebs',
  'tribunus plebis designatus': 'tribune of the plebs elect',
  'tribunus militum': 'military tribune',
  censor: 'censor',
  dictator: 'dictator',
  'magister equitum': 'master of horse',
  interrex: 'interrex',
  proconsul: 'proconsul',
  propraetor: 'propraetor',
  proquaestor: 'proquaestor',
  legatus: 'legate',
  'legatus (lieutenant)': 'legate',
  'legatus (ambassador)': 'envoy',
  'legatus (envoy)': 'envoy',
  'legatus pro praetore': 'legate with praetorian power',
  praefectus: 'prefect',
  'praefectus classis': 'prefect of the fleet',
  'triumvir monetalis': 'moneyer',
  monetalis: 'moneyer',
  moneyer: 'moneyer',
  triumphator: 'triumph',
  'princeps senatus': 'leader of the Senate',
  ovatio: 'ovation',
  'triumvir rei publicae constituendae': 'triumvir',
  pontifex: 'pontifex',
  'pontifex maximus': 'pontifex maximus',
  augur: 'augur',
}

/** Words for a praetor's court, where DPRR gives its Latin. */
const PROVINCE_WORDS: Record<string, string> = {
  urbanus: 'urban',
  'inter peregrinos': 'peregrine',
  peregrinus: 'peregrine',
}

const COURTS = new Set(Object.values(PROVINCE_WORDS))

/** Rome's standing courts, where a praetor presided. */
const COURT_WORDS: Record<string, string> = {
  repetundae: 'extortion court',
  'de repetundis': 'extortion court',
  'de vi': 'court for violence',
  maiestas: 'treason court',
  'de maiestate': 'treason court',
  'de ambitu': 'bribery court',
  ambitus: 'bribery court',
  'de peculatu': 'embezzlement court',
  peculatus: 'embezzlement court',
  'de sicariis et veneficiis': 'murder court',
}

/** The elected offices of the cursus, each a dot on the chart. */
const CURSUS = new Set([
  'quaestor',
  'aedilis',
  'aedilis curulis',
  'aedilis plebis',
  'tribunus plebis',
  'praetor',
  'praetor suffectus',
  'consul',
  'consul suffectus',
  'censor',
  'dictator',
])

const STATUS_WORDS: Record<string, string> = {
  senator: 'Senate',
  'eques Romanus': 'Equestrian',
}

/** DPRR's life events worth a line of their own; birth and death head the panel instead. */
const EVENT_WORDS: Record<string, string> = {
  exiled: 'Exiled',
  restored: 'Restored from exile',
  recalled: 'Recalled',
  proscribed: 'Proscribed',
  extradited: 'Extradited',
  'expelled from Senate': 'Expelled from the Senate',
}

const capital = (s: string) => s[0].toUpperCase() + s.slice(1)

/** DPRR's relationship name as a word for the relative: `son of` → `son`. */
function kin(name: string) {
  return name.replace(/ (of|to|from)$/, '')
}

function GROUP_OF(name: string | null | undefined): FamilyGroup['name'] {
  const k = name ? kin(name) : ''
  if (/^(adoptive |step)?(father|mother)$/.test(k)) return 'Parents'
  if (/^(married|divorced|betrothed)$/.test(k)) return 'Spouses'
  if (/^(adopted |step)?(son|daughter)$/.test(k)) return 'Children'
  if (/^(adoptive |half|step)?(brother|sister)$/.test(k)) return 'Siblings'
  return 'Wider family'
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/** The name a reader knows: Wikidata's English label where it has one. */
export function knownName(p: PersonRecord) {
  return p.en?.label ?? p.name
}

/** Every name a person is looked up by, as one string for the index to match. */
export function searchTerms(p: PersonRecord) {
  return [
    ...new Set([
      knownName(p),
      p.name,
      p.full,
      ...(p.en?.aliases ?? []),
      ...(p.names.otherNames ? [p.names.otherNames] : []),
    ]),
  ].join(' ')
}

/**
 * How near a person's attested years come to a year, 1 within them and falling away
 * over decades outside; 0 if nothing dates them. The index orders namesakes by it.
 */
export function nearness(p: PersonRecord, year: number) {
  if (!p.active) return 0
  const off = Math.max(p.active.from - year, year - p.active.to, 0)
  return 1 / (1 + off / 10)
}

/** Whether a person is attested in a year: the index greys everyone else. */
export function activeIn(p: PersonRecord, year: number) {
  return !!p.active && p.active.from <= year && year <= p.active.to
}
