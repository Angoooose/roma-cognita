/**
 * What each DPRR office *was*, for our purposes. The question this
 * answers first is "who governed this province in this year": a province's posts
 * include the governor's legates and quaestors, and only the holder of imperium is
 * the governor. The other roles let the person panel group a career sensibly.
 *
 * This is our judgement, not DPRR's, so it is ours to change. It works by DPRR's own
 * office tree (`hasParent`): a rule names an office or a branch of the tree, and the
 * most specific rule wins. An office no rule reaches is `other`, and the build lists
 * it, so a new office in a later fetch cannot slip through unclassified.
 */
import type { OfficeRole } from '@roma-cognita/schema'

/** Office or branch name → role. Checked from the office itself up to the root. */
const RULES: Record<string, OfficeRole> = {
  // Magistracies with imperium, and the extraordinary commands.
  consul: 'command',
  praetor: 'command',
  dictator: 'command',
  'magister equitum': 'command',
  interrex: 'command',
  'decemvir consulari imperio legibus scribundis': 'command',
  'tribunus militum consulari potestate': 'command',
  'triumvir rei publicae constituendae': 'command',
  // Elected but not yet in office: a career step, not a command.
  'consul designatus': 'magistracy',
  'praetor designatus': 'magistracy',
  'magister equitum designatus': 'magistracy',
  'quaestor designatus': 'magistracy',
  'tribunus plebis designatus': 'magistracy',

  // Promagistrates hold imperium, so they are governors; a proquaestor is still
  // the governor's quaestor. A legatus or quaestor *pro praetore* was granted
  // praetorian imperium and could run a province.
  'Promagisterial Posts': 'command',
  proquaestor: 'staff',
  'legatus pro quaestore ': 'staff', // DPRR's name has the trailing space

  // Civil magistracies without a provincial command.
  aedilis: 'magistracy',
  censor: 'magistracy',
  'tribunus plebis': 'magistracy',
  'praefectus urbi': 'magistracy',
  moneyer: 'magistracy',
  vigintisexvir: 'magistracy',
  // Quaestors served a consul or governor, or the treasury at Rome. The province
  // decides which; either way a quaestor is never the governor.
  quaestor: 'staff',

  repulsae: 'candidacy',

  // Under a commander.
  'legatus (lieutenant)': 'staff',
  // An unspecified legatus is most often a lieutenant in DPRR's provincial entries.
  legatus: 'staff',
  'military positions': 'staff',

  // Envoys and the Senate's commissions.
  'legatus (ambassador)': 'commission',
  'legatus (envoy)': 'commission',
  'colonial commissioners': 'commission',
  'land commissioner': 'commission',
  'special commissioners': 'commission',
  'judicial roles': 'commission',
  'food supply': 'commission',
  'public works': 'commission',
  'curator - unspecified': 'commission',
  'duovir - unspecified': 'commission',
  'triumvir - unspecified': 'commission',
  'praefectus Capuam Cumas': 'commission',

  Priesthoods: 'priesthood',
  Distinctions: 'distinction',
  'senator - office unknown': 'distinction',
  'matrona imagini dedicandi': 'distinction',
  'Equestrian Functions': 'equestrian',
}

export interface OfficeNode {
  id: number
  name: string
  parent?: number
}

/** The role of every office, by id, following each up DPRR's tree to the nearest rule. */
export function classifyOffices(offices: OfficeNode[]): Map<number, OfficeRole> {
  const byId = new Map(offices.map((o) => [o.id, o]))
  const roles = new Map<number, OfficeRole>()
  for (const office of offices) {
    let role: OfficeRole = 'other'
    const seen = new Set<number>()
    for (
      let o: OfficeNode | undefined = office;
      o && !seen.has(o.id);
      o = byId.get(o.parent!)
    ) {
      seen.add(o.id)
      const rule = RULES[o.name]
      if (rule) {
        role = rule
        break
      }
    }
    roles.set(office.id, role)
  }
  return roles
}
