/**
 * Where each ancient text we cite can be read in English, and how that page numbers
 * it. A citation's locator ("16.2.10", "Mithr. 114") becomes a link to the passage
 * itself: fetch.ts records the anchors each page actually has, and passage.ts finds
 * the one the locator points into.
 *
 * Almost everything is on ToposText (topostext.org), which has an English translation
 * of every work here but Sallust's Histories, with an anchor on each passage. Its
 * anchors don't always carry the reference we cite, so each work says how to read
 * one:
 *
 * - `drop`: Appian's anchors put the old Loeb chapter group in front of the standard
 *   chapter ("3.15" is Mithr. 15, "1.1.7" is BC 1.7); drop that part.
 * - `strip`: a prefix or suffix around the reference ("JCa.22", "Fam.13.73", "70.e").
 * - `inline`: the anchors are old chapters, and the sections we cite are printed in
 *   the text as "[64]" — most of Cicero's speeches by modern § (the Philippics are
 *   anchored by § already), Josephus' Antiquities by Niese's numbers under Whiston's
 *   chapters. `book` puts the anchor's first part in front of each ("14.4.3" holding
 *   "[64]" is 14.64).
 * - `unit`: how many leading parts the anchor it lands on must share with the
 *   reference, when there is none for the reference itself. By default all but the
 *   last: a section missing from Strabo 16.2 lands on the one before it in 16.2.
 *   Cicero's letters are printed in order of date, so the letter before by number is
 *   another letter, likely pages away: only a section of the same letter will do.
 * - `exact`: a fragment number, where the one before is a different fragment and
 *   no place to land.
 *
 * ToposText's Civil War is book 3 alone, so Caesar's Civil War is read on Perseus,
 * which puts the passage in the address itself (`levels`) and needs no anchors.
 */

export interface Work {
  /** A ToposText work number, or the page on another site. */
  page: number | string
  /** How the page marks its anchors, when it is not ToposText. */
  site?: 'attalus' | 'perseus'
  /** Perseus: the name of each part of a reference in the address, book first. */
  levels?: string[]
  drop?: number
  strip?: RegExp
  inline?: 'book' | 'bare'
  unit?: number
  exact?: boolean
}

/** A source with one page, or one per part: Appian's wars, Plutarch's lives. */
export type WorkEntry = Work | { parts: Record<string, Work> }

export const WORKS: Record<string, WorkEntry> = {
  strabo: { page: 144 },
  herodotus: { page: 22 },
  pausanias: { page: 213 },
  appian: {
    parts: {
      'Mithr.': { page: 496, drop: 0 },
      'Ill.': { page: 613, drop: 0 },
      'Celt.': { page: 876 },
      'Syr.': { page: 497, drop: 0 },
      'Pun.': { page: 880 },
      'Hisp.': { page: 878 },
      BC: { page: 498, drop: 1 },
    },
  },
  plutarch: {
    parts: {
      Pompey: { page: 183 },
      Crassus: { page: 193 },
      Caesar: { page: 184 },
      'Cato Minor': { page: 655 },
      'C. Gracch.': { page: 196 },
      Antony: { page: 180 },
      Brutus: { page: 181, strip: /^Brut\./ },
      Marius: { page: 194 },
      Sulla: { page: 182 },
      Lucullus: { page: 192 },
      Sertorius: { page: 191 },
    },
  },
  'josephus-aj': { page: 526, inline: 'book' },
  'josephus-bj': { page: 566 },
  'cassius-dio': { page: 219 },
  'pliny-nh': { page: 148 },
  'caesar-bg': { page: 683 },
  'caesar-bc': {
    page: 'https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.02.0076',
    site: 'perseus',
    levels: ['book', 'chapter'],
  },
  'bellum-alexandrinum': { page: 645 },
  'bellum-africum': { page: 646 },
  'suetonius-iul': { page: 202, strip: /^JCa\./ },
  'suetonius-aug': { page: 202, strip: /^Aug\./ },
  'cicero-att': { page: 785, strip: /^Att\./, unit: 2 },
  'cicero-fam': { page: 136, strip: /^Fam\./, unit: 2 },
  'cicero-verr': { page: 131 },
  'cicero-pis': { page: 712, inline: 'bare' },
  'cicero-font': { page: 696, inline: 'bare' },
  'cicero-arch': { page: 703, inline: 'bare' },
  'cicero-sest': { page: 709, inline: 'bare' },
  'cicero-deiotaro': { page: 719, inline: 'bare' },
  'cicero-phil': { page: 720 },
  velleius: { page: 727 },
  'livy-per': { page: 658, strip: /\.e$/ },
  eutropius: { page: 684 },
  'res-gestae': { page: 614 },
  florus: { page: 559 },
  'tacitus-ann': { page: 200 },
  'jordanes-getica': { page: 744 },
  'sallust-jug': { page: 659 },
  justin: { page: 226 },
  'sallust-hist': {
    page: 'https://www.attalus.org/translate/sallust.html',
    site: 'attalus',
    strip: /M$/,
    exact: true,
  },
}

/** The address of a work's page. */
export function pageUrl(w: Work): string {
  return typeof w.page === 'number' ? `https://topostext.org/work/${w.page}` : w.page
}

/** Every page with anchors to record, once, by the key the anchor index files it under. */
export function allWorks(): [string, Work][] {
  const out: [string, Work][] = []
  for (const [id, e] of Object.entries(WORKS)) {
    if ('parts' in e)
      for (const [part, w] of Object.entries(e.parts)) out.push([`${id} ${part}`, w])
    else out.push([id, e])
  }
  return out.filter(([, w]) => w.site !== 'perseus')
}
