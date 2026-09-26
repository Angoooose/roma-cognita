/**
 * The consular roads out of Rome on the plan (DESIGN.md §7.7): each from the gate of
 * the Servian Wall it left by, or the bridge it crossed the Tiber on, out past the
 * edge of the board, where it runs on as the map's own road (Itiner-e).
 *
 * Each is a line through stops, as the streets drawn from the evidence are (routes.ts,
 * which says what each kind of stop is): the gate, SITAR's reconstructions of its
 * course where it has made one (the Via Flaminia, the Appia's first mile, the
 * Latina), the pieces of its paving that excavations found, the points the sources
 * fix — the gates of the later Aurelian Wall, which stand on the older roads, the
 * forks, the bridges — and then Itiner-e's line, from where it keeps to the ancient
 * road. Between them, the easiest way over the ground, or straight where the sources
 * say the road ran straight.
 *
 * Which gate each road left by, and where it ran, is Platner & Ashby's and Ashby's
 * (data/sources.yaml); the finds and reconstructions are SITAR's (CC BY-SA 4.0,
 * data/geometry/rome-roads.geojson, fetched by sitar.ts); the modern roads that keep to
 * the ancient lines are OpenStreetMap's, read for where they run, not copied.
 *
 * Left out, and why: the Via Ardeatina, not attested in the window and its start
 * disputed (Platner & Ashby, Via Ardeatina, pp. 560–561); the Laurentina, known only
 * from later sources; the Via Vitellia, which nobody can place (Ashby 1927, p. 227);
 * the Triumphalis and the Cornelia, which no bridge reached from the city before
 * Nero's; the Collatina, of which nothing is found within 4 km; the road from the Porta
 * Viminalis, "of minor importance" and not traceable beyond the Porta Chiusa.
 */
import type { Stop } from './routes.ts'

export interface Road {
  /** Its record in data/places/rome.yaml. */
  id: string
  /**
   * Its line is fixed by a reconstruction, a survey or the sources along its whole
   * length on the board; otherwise drawn lighter.
   */
  known: boolean
  lines: Stop[][]
}

/** In order: a road another runs `onto` comes first. */
export const ROADS: Road[] = [
  {
    id: 'via-appia',
    known: true,
    lines: [
      [
        {
          gate: 'Porta Capena',
          what: 'the Porta Capena: "from it the Via Appia issued" (Platner & Ashby, Porta Capena, p. 405)',
        },
        {
          along: 19682,
          to: [12.4956, 41.8806],
          what: "its first stretch, which it shared with the Via Latina, on SITAR's reconstruction of the Latina's line (19682), to where SITAR's reconstruction of the Appia's first mile begins beside it",
        },
        {
          along: 19681,
          what: 'SITAR\'s reconstruction of "the first mile of the Via Appia between the 4th and the 1st century BCE", from excavations and the archive (19681): through the cutting of the Clivus Martis, "a little further north-east than the modern Via di Porta S. Sebastiano" (Platner & Ashby, Via Appia, pp. 559–560)',
        },
        {
          sitar: 12079,
          what: 'its paving and kerbs just outside the later Porta Appia, dated 312–201 BCE (SITAR 12079)',
        },
        {
          sitar: 11402,
          what: 'the squared-tufa wall that held up its embankment, dated 312–201 BCE (SITAR 11402), towards the crossing of the Almo',
        },
        {
          sitar: 22778,
          what: 'its paving by the steps of Domine Quo Vadis (SITAR 22778), where the Ardeatina later left it',
        },
        {
          itinere: 'Tarracinae-Rome',
          at: [12.503, 41.86697],
          what: 'Itiner-e\'s line, "absolutely straight … from just beyond the Almo" (Ashby 1927, p. 176)',
        },
      ],
    ],
  },
  {
    id: 'via-latina',
    known: true,
    lines: [
      [
        {
          onto: 'via-appia',
          at: [12.4956, 41.8806],
          what: '"The Latin Way begins … at the Appian Way, since near Rome it turns off from it to the left" (Strabo 5.3.9): it "branched off to the left from the via Appia 830 metres from the porta Capena" (Platner & Ashby, Via Latina, pp. 564–565)',
        },
        {
          along: 19682,
          what: "SITAR's reconstruction of its line (19682), to the later Porta Latina, along its paving in the Via di Porta Latina (SITAR 2268)",
        },
        {
          sitar: 12438,
          next: 'straight',
          what: 'its paving outside the Porta Latina (SITAR 12438): it ran straight "for the first 11 miles" (Platner & Ashby)',
        },
        {
          sitar: 9003,
          next: 'straight',
          what: 'its paving (SITAR 9003)',
        },
        {
          itinere: 'Rome-Tusculum',
          at: [12.51501, 41.8731],
          what: "Itiner-e's line, from by its paving at Via Latina 77d (SITAR 9018), along the modern Via Latina",
        },
      ],
    ],
  },
  {
    id: 'via-ostiensis',
    known: true,
    lines: [
      [
        {
          gate: 'Porta Trigemina',
          what: 'the Porta Trigemina: "the road from the porta Trigemina … is probably the original via Ostiensis" (Platner & Ashby, Via Ostiensis, pp. 565–566); where the gate stood is disputed (Porta Trigemina, p. 418), and it is drawn at SITAR\'s site',
        },
        {
          sitar: 4731,
          what: 'paving by the Arco di S. Lazzaro in the Via della Marmorata (SITAR 4731): it "kept under the north-west and south-west sides of the Aventine"',
        },
        {
          sitar: 4707,
          what: '"a piece of its pavement … found in the ditch surrounding the old Protestant cemetery in 1824" (Platner & Ashby), dated 260–240 BCE (SITAR 4707), by the later Porta S. Paolo',
        },
        {
          sitar: 22777,
          what: 'Roman paving south of the Porta S. Paolo (SITAR 22777): "the main road ran due south, and is followed by the modern road" (Platner & Ashby)',
        },
        {
          itinere: 'Rome-Ostia',
          at: [12.47731, 41.85504],
          what: 'Itiner-e\'s line; the modern road "coincided with it closely" (Ashby 1927, p. 214)',
        },
      ],
      [
        {
          gate: 'Porta Raudusculana',
          what: 'the Porta Raudusculana, from which a branch ran to the Ostiensis, "the latter (with which the Sepulcrum Cestii is orientated) falling into it a little beyond the tomb" (Platner & Ashby, Via Ostiensis)',
        },
        {
          at: [12.48143, 41.87665],
          what: 'the later Porta S. Paolo, beside the pyramid of Cestius',
        },
        {
          onto: 'via-ostiensis',
          at: [12.4803, 41.8755],
          what: 'the Ostiensis, a little beyond the pyramid',
        },
      ],
    ],
  },
  {
    id: 'via-praenestina',
    known: true,
    lines: [
      [
        {
          gate: 'Porta Esquilina',
          what: 'the Porta Esquilina: the Praenestina "began at the porta Esquilina of the Servian wall" (Platner & Ashby, Via Praenestina, pp. 566–567), and the Labicana with it (Strabo 5.3.9)',
        },
        {
          sitar: 13944,
          what: 'late Republican basalt paving, "part of the via Labicana-Praenestina in its first stretch outside the Porta Esquilina" (SITAR 13944)',
        },
        {
          sitar: 3582,
          what: 'basalt paving with a travertine kerb (SITAR 3582), by the later Porta Maggiore',
        },
        {
          at: [12.5151, 41.89127],
          what: 'the fork at the tomb of Eurysaces the baker, "which stood in the fork": the two roads "did not bifurcate until about three-quarters of a mile further on" (Ashby 1927, p. 128), "just before the Porta Praenestina" (Platner & Ashby)',
        },
        {
          itinere: 'Rome-Praeneste',
          at: [12.52726, 41.89124],
          what: 'Itiner-e\'s line, "almost due E." (Ashby 1902, p. 150), past its paving at Largo Preneste (SITAR 23992)',
        },
      ],
    ],
  },
  {
    id: 'via-labicana',
    known: true,
    lines: [
      [
        {
          onto: 'via-praenestina',
          at: [12.5151, 41.89127],
          what: 'the fork at the tomb of Eurysaces, where it left the Praenestina (Ashby 1927, p. 128; Platner & Ashby, Via Labicana, pp. 563–564)',
        },
        {
          itinere: 'Rome-Ad Bivium',
          at: [12.52472, 41.88775],
          what: "Itiner-e's line, along the modern Via Casilina, past its paving by the Marranella (SITAR 24216; Ashby 1902, pp. 220–221)",
        },
      ],
    ],
  },
  {
    id: 'via-tiburtina',
    known: false,
    lines: [
      [
        {
          gate: 'Porta Esquilina',
          what: 'the Porta Esquilina, which it "probably" left by (Platner & Ashby, Via Tiburtina, pp. 568–569), "the most probable" start (Ashby 1906, p. 86); others have it leave by the Porta Viminalis',
        },
        {
          at: [12.5103, 41.8975],
          what: "the later Porta Tiburtina, the arch that carried Augustus' aqueducts over it, with its paving just outside at Via Tiburtina Antica 26 (SITAR 21288)",
        },
        {
          itinere: 'Rome-Tibur',
          at: [12.51748, 41.90012],
          what: "Itiner-e's line, along the modern Via Tiburtina, to its bridge of cappellaccio tufa over the Marranella, dated 600–301 BCE (SITAR 19400)",
        },
      ],
    ],
  },
  {
    id: 'via-salaria',
    known: true,
    lines: [
      [
        {
          gate: 'Porta Collina',
          what: 'the Porta Collina, which it passed through (Platner & Ashby, Via Salaria, pp. 567–568): "Salariam viam incipere … a porta, quae nunc Collina" (Festus, in Ashby 1906, p. 7); "immediately outside" it the Nomentana diverged (Ashby 1927, p. 59)',
        },
        {
          at: [12.4981, 41.911],
          next: 'straight',
          what: 'the later Porta Salaria, at the Piazza Fiume, "after less than a quarter of a mile" (Ashby 1927, p. 59): "the straight road from the Porta Collina to the Porta Salaria … and so on along the line followed by the modern road" (Ashby 1906, p. 9)',
        },
        {
          itinere: 'Rome-Reate',
          at: [12.49714, 41.9181],
          what: "Itiner-e's line, along the modern Via Salaria",
        },
      ],
    ],
  },
  {
    id: 'via-nomentana',
    known: false,
    lines: [
      [
        {
          gate: 'Porta Collina',
          what: 'the Porta Collina, "immediately outside" which it left the Salaria (Platner & Ashby, Via Nomentana, p. 565)',
        },
        {
          at: [12.5016, 41.9088],
          what: 'the later Porta Nomentana, 75 m south-east of the Porta Pia, reached "to the S.E. of the present Via Venti Settembre" (Ashby 1906, pp. 38–39)',
        },
        {
          itinere: 'Rome-Nomentum',
          at: [12.51493, 41.91837],
          what: 'Itiner-e\'s line, along the modern Via Nomentana, which it kept to "winding considerably" (Ashby 1906, pp. 39–41)',
        },
      ],
    ],
  },
  {
    id: 'via-flaminia',
    known: true,
    lines: [
      [
        {
          gate: 'Porta Fontinalis',
          what: 'the Porta Fontinalis, where "later topographers" place its start (Platner & Ashby, Via Flaminia, pp. 562–563)',
        },
        {
          along: 16890,
          to: [12.4822077, 41.8966821],
          what: "SITAR's reconstruction of its course from the Porta Fontinalis to the Ponte Milvio (16890), to where the Corso takes it up",
        },
      ],
      [
        {
          at: [12.4765059, 41.9103053],
          what: 'the north end of the Corso, at the Piazza del Popolo (OSM), which "coincides absolutely with the ancient line" (Platner & Ashby)',
        },
        {
          along: 16890,
          what: 'SITAR\'s reconstruction of its course on "in an absolutely straight line to the pons Mulvius" (16890; Platner & Ashby), past its paving at Viale delle Belle Arti, dated 220 BCE (SITAR 17882)',
        },
        {
          itinere: 'Fanum Fortunae-Rome',
          at: [12.46658, 41.93655],
          what: "Itiner-e's line, from the Ponte Milvio, past the edge of the board",
        },
      ],
    ],
  },
  {
    id: 'via-aurelia',
    known: false,
    lines: [
      [
        {
          at: [12.4786, 41.8892],
          what: 'the right-bank end of the Pons Aemilius: it "led from the pons Aemilius across the low ground on the right bank of the Tiber" (Platner & Ashby, Via Aurelia, p. 561)',
        },
        {
          at: [12.4735, 41.8891],
          what: '"two arches of a viaduct belonging to it were found near S. Crisogono" (Platner & Ashby)',
        },
        {
          at: [12.4615, 41.8884],
          what: 'up the Janiculum to the later Porta Aurelia (S. Pancrazio), where it "passed through the Aurelian wall" (Platner & Ashby); its line up the hill is not known',
        },
        {
          at: [12.45748, 41.88735],
          next: 'straight',
          what: 'the modern Via Aurelia Antica, which follows it "for nearly 3 miles" (Ashby 1927, p. 225)',
        },
        {
          at: [12.45312, 41.88898],
          next: 'straight',
          what: 'the Via Aurelia Antica',
        },
        {
          sitar: 15753,
          next: 'straight',
          what: 'a stretch of the Via Aurelia Vetus (SITAR 15753)',
        },
        {
          at: [12.44288, 41.88918],
          what: 'the Via Aurelia Antica, past the edge of the board',
        },
      ],
    ],
  },
  {
    id: 'via-campana',
    known: false,
    lines: [
      [
        {
          at: [12.4786, 41.8892],
          what: 'the right-bank end of the Pons Aemilius: its first stretch was the later Via Portuensis\', which "started from the pons Aemilius" (Platner & Ashby, Via Campana, p. 561; Via Portuensis, p. 566)',
        },
        {
          sitar: 11922,
          what: 'a road running north–south, 4–5 m wide, beside a burial ground of the 1st century BCE (SITAR 11922), on the shared stretch before the Portuensis "diverged to the right into hilly country from a far older road, the Via Campana" (Ashby 1927, p. 217)',
        },
        {
          sitar: 21399,
          what: 'its paving (SITAR 21399), which keeps "to the valley of the Tiber" (Platner & Ashby, Via Portuensis)',
        },
        {
          sitar: 10390,
          what: 'the Via Campana along the foot of the slope, "at first gravelled", paved about the 1st century BCE (SITAR 10390, 10391)',
        },
        {
          sitar: 24568,
          what: 'its carriageway between tufa walls, about 3.40 m wide, with wheel ruts (SITAR 24568)',
        },
      ],
    ],
  },
]
