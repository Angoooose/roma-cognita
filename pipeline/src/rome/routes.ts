/**
 * The recorded streets whose course is drawn from the evidence rather than traced
 * along one modern street (DESIGN.md §7.7): the rest of a street whose first stretch
 * alone is mapped, and streets the sources place by what was found of them and by
 * the ground they crossed.
 *
 * Each is a line through stops, and each stop is a piece of evidence:
 *
 * - `sitar`: a piece of the street's paving that an excavation found, by its number
 *   in SITAR (data/geometry/rome-sitar.geojson). The street runs along it, end to end.
 * - `at`: a point the sources fix — a gate, the end of a mapped stretch, a street
 *   corner Platner & Ashby name.
 * - `onto`: where it meets another recorded street: the point of that street
 *   nearest `at`, or nearest the next stop.
 *
 * Between stops a street takes the easiest way over the ground, as the streets of
 * the valleys did, keeping off the monuments; or, where the finds lie on one line,
 * runs straight. Every line here is drawn lighter than a surveyed one. The finds are
 * SITAR's (CC BY-SA 4.0); which streets there were and where they ran is Platner &
 * Ashby's, checked against Digital Augustan Rome.
 */

type LonLat = [number, number]

export interface Stop {
  at?: LonLat
  sitar?: number
  onto?: string
  /** How the street goes on to the next stop: by the easiest ground, or straight. */
  next?: 'ground' | 'straight'
  /** Metres to stop short of this, the last stop: the front of a temple, not its steps. */
  short?: number
  what: string
}

export interface Route {
  id: string
  lines: Stop[][]
}

/** In order: a street a later one runs `onto` comes first. */
export const ROUTES: Route[] = [
  {
    id: 'vicus-tuscus',
    lines: [
      [
        {
          at: [12.4851771, 41.8913924],
          what: 'the south end of its mapped stretch, between the Basilica Iulia and the temple of Castor (OSM way/998877106)',
        },
        {
          at: [12.4821, 41.8875],
          what: 'the forum Boarium, by the north-west end of the Circus Maximus: it ran "south along the west side of the Palatine" to "the forum Boarium and circus Maximus" (Platner & Ashby, Vicus Tuscus, pp. 579–580)',
        },
      ],
    ],
  },
  {
    id: 'vicus-iugarius',
    lines: [
      [
        {
          at: [12.4840476, 41.8921193],
          what: 'the south-west end of its mapped stretch, by the temple of Saturn (OSM way/1000529940)',
        },
        {
          at: [12.4819, 41.8909],
          what: 'the Porta Carmentalis, "very near the intersection of the present Via della Consolazione and the Via della Bocca della Verità" (Platner & Ashby, Porta Carmentalis, pp. 405–406)',
        },
      ],
    ],
  },
  {
    id: 'argiletum',
    lines: [
      [
        {
          at: [12.4856769, 41.892955],
          what: 'the north-east end of its mapped stretch, between the Curia and the Basilica Aemilia (OSM way/1000529923)',
        },
        {
          onto: 'clivus-suburanus',
          at: [12.4940061, 41.8948526],
          what: 'the Subura, "connected with the forum by the Argiletum, and continued eastward … by the Clivus Suburanus" (Platner & Ashby, Subura, pp. 500–501): where the Clivus Suburanus begins',
        },
      ],
    ],
  },
  {
    id: 'vicus-longus',
    lines: [
      [
        {
          onto: 'argiletum',
          what: 'the Subura, from which the valley between the Viminal and the Quirinal runs north (Platner & Ashby, Subura, pp. 500–501)',
        },
        {
          sitar: 8782,
          next: 'straight',
          what: "its paving under the Banca d'Italia, from Lanciani's Forma Urbis sheet 16 (SITAR 8782): found \"on a line that crosses the via Nazionale at an angle of twenty degrees near the Banca d'Italia, at various points between the bank and the baths of Diocletian, a distance of one kilometre\" (Platner & Ashby, vici, p. 575)",
        },
        {
          onto: 'alta-semita',
          at: [12.4972491, 41.9064742],
          what: 'the Alta Semita "inside the porta Collina, very near where the via Quintino Sella runs into the via Venti Settembre" (Platner & Ashby, vici, p. 575; OSM way/27434109)',
        },
      ],
    ],
  },
  {
    id: 'clivus-publicius',
    lines: [
      [
        {
          onto: 'vicus-tuscus',
          at: [12.4821, 41.8875],
          what: 'the forum Boarium, "near the west end of the circus Maximus and the porta Trigemina" (Platner & Ashby, cliva, p. 124)',
        },
        {
          at: [12.4834, 41.88325],
          short: 20,
          what: 'past the temple of Diana: it "must have extended across the Aventine in a southerly direction … past the temple of Diana" (Platner & Ashby, cliva, p. 124). It goes on to the Vicus Piscinae Publicae, which nobody places, so it is drawn only to the temple',
        },
      ],
    ],
  },
  {
    id: 'street-from-porta-capena',
    lines: [
      [
        {
          at: [12.491, 41.884],
          what: 'the Porta Capena, where the Via Appia left the city (Platner & Ashby, Porta Capena, p. 405)',
        },
        {
          sitar: 16624,
          what: "the Appia's paving at the gate, on Parker and Gori's plan of the excavation (SITAR 16624)",
        },
        {
          sitar: 16983,
          what: 'a paved street 5.77 m wide with footways, under the Via di S. Gregorio, whose republican level was raised some 4 m in the early empire (SITAR 16983)',
        },
        {
          onto: 'sacra-via',
          what: 'the Sacra Via at the head of the valley, below the Velia',
        },
      ],
    ],
  },
]
