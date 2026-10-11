/**
 * The model of Rome (DESIGN.md §7.7): what the engine needs to build the city as a
 * museum model when the map is zoomed right into it — build/rome/ground.png,
 * model.json and model.bin.
 *
 * The model is an illustration, and the one place the atlas draws what no source
 * records (DESIGN.md §1, the exception in §7.7). It keeps the two apart:
 *
 * - **What is known** is built from the records: each monument's outline raised by
 *   its design (designs.ts: its type, size, columns and stairs, from its sources),
 *   the bridges, and the Servian Wall on its course (servian.ts, `WALL`). A temple with no
 *   design of its own is a typical one (`DEFAULT_TEMPLE`).
 * - **The city around them is generated** — houses and blocks of flats that nobody
 *   can map building by building for this period. Inside the wall city.ts lays out
 *   streets, blocks and the lots round them; the recorded streets, the monuments and
 *   the open squares are kept clear. Outside the wall a thinner suburb of detached
 *   houses.
 *   Where a monument was built within the window (Caesar's forum on the houses he
 *   bought up), houses stand on its site until the year it was begun.
 *   Beyond them the country (fields.ts): trees on the rows of its olive groves and
 *   orchards, scattered on its scrub, and in the recorded gardens and groves. All of
 *   it is seeded, so every build is the same.
 *
 * The ground under the model is the plate's smoothed relief with the river cut into
 * it (ground.png, heights in centimetres over two bytes), so the terrain can be laid
 * smooth there and everything sits on it exactly.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import polygonClipping from 'polygon-clipping'
import sharp from 'sharp'
import { projection } from '@roma-cognita/world'
import type { Place } from '@roma-cognita/schema'
import { excavatedPieces, type StreetLine } from './streets.ts'
import { layCity, LOT_KIND, ROOF } from './city.ts'
import { COURSES, layCourse } from './aqueducts.ts'
import { DEFAULT_TEMPLE, DESIGNS, type Design, planeBearing } from './designs.ts'
import { type Course, STEP_M } from './servian.ts'
import { type Fields, fieldTrees, type RecordedGround, TREE } from './fields.ts'
import { FORUM_PAVING_PIECES, levelOf } from './ground.ts'
import { ISLAND, islandAt, islandRing } from './island.ts'

type Pt = [number, number]

export interface ModelInput {
  out: string
  grid: { x0: number; y1: number; width: number; height: number; texel: number }
  raw: Float32Array
  smooth: Float32Array
  circuit: Pt[]
  /** The wall's course and gates (servian.ts). */
  course: Course
  streets: StreetLine[]
  riverRings: Pt[][]
  /** Signed distance to the river, metres, clamped (plate.ts). */
  water: Float32Array
  /** Signed distance to the hull of the plan, metres (plate.ts). */
  reach: Float32Array
  reachM: number
  outlines: { id: string; kind: string; polys: Pt[][][] }[]
  places: Map<string, Place>
  /** The country outside the wall (fields.ts), whose groves and orchards the model plants. */
  fields: Fields
  grounds: RecordedGround[]
}

/**
 * How each kind of monument is raised: the body's height and roof over it, metres,
 * and a podium under it. Typical heights for the type, not measurements — the
 * model's one liberty with the known buildings.
 */
const MASSING: Record<
  string,
  { body: number; roof: 'gable' | 'hip' | 'flat'; podium?: number }
> = {
  temple: { body: 12, roof: 'gable', podium: 4 },
  basilica: { body: 14, roof: 'hip' },
  curia: { body: 18, roof: 'gable' },
  archive: { body: 16, roof: 'flat' },
  house: { body: 8, roof: 'hip' },
  prison: { body: 5, roof: 'flat' },
  portico: { body: 8, roof: 'hip' },
  sanctuary: { body: 2, roof: 'flat' },
  fountain: { body: 1.2, roof: 'flat' },
  rostra: { body: 3.5, roof: 'flat' },
  tomb: { body: 12, roof: 'flat' },
  warehouse: { body: 9, roof: 'hip' },
}

/**
 * Temples placed by a point (the records with no outline): the size of one, width by
 * length in metres, a typical mid-Republican temple on its podium, until its design
 * (designs.ts) gives its own. Its point and the slope place it.
 */
const POINT_TEMPLE: {
  size: [number, number]
  sizes: Record<string, [number, number]>
  /** Temples whose remains fix how they lie: the direction their fronts face, radians from east. */
  facing: Record<string, number>
} = {
  size: [14, 24],
  sizes: {},
  facing: {},
}

/**
 * What the known buildings were faced with in the window, where Platner & Ashby say
 * (checked against each article, September 2026), from the year given, astronomical.
 * A building not listed, or before its first entry, is drawn in white stucco over
 * tufa or peperino, the Republic's usual finish: Rome's first marble temple was
 * Metellus's of 146 BCE (Iuppiter Stator, p. 304), and marble only became the rule
 * under Augustus. Where the article's marble is of a later rebuilding (Castor,
 * Concord, Vesta, the Basilica Aemilia, the Curia), it is not taken.
 */
const STONE_OF: Record<
  string,
  { from: number; stone: 'stucco' | 'marble' | 'travertine'; why: string }[]
> = {
  'aedes-saturni': [
    {
      from: -41,
      stone: 'marble',
      why: 'rebuilt from 42 BCE by Plancus; "the existing podium belongs to the temple of Plancus … covered with marble facing" (Aedes Saturni, p. 464)',
    },
  ],
  regia: [
    {
      from: -35,
      stone: 'marble',
      why: 'rebuilt by Domitius Calvinus in 36 BCE "of solid blocks of white marble", its walls before of cappellaccio (Regia, pp. 441–442)',
    },
  ],
  'aedes-veneris-genetricis': [
    {
      from: -100000,
      stone: 'marble',
      why: '"pycnostyle … and built of solid marble" (Forum Iulium, p. 226)',
    },
  ],
  'basilica-iulia': [
    {
      from: -100000,
      stone: 'marble',
      why: '"the entire outside of the building was constructed originally of white marble" (Basilica Julia, pp. 79–80); the description is mostly of Augustus\' rebuilding, so Caesar\'s may have differed',
    },
  ],
  'aedes-iovis-statoris-metelli': [
    {
      from: -100000,
      stone: 'marble',
      why: 'Metellus was "the first to build a temple in Rome entirely of marble" (Iuppiter Stator, p. 304)',
    },
  ],
  'aedes-martis-in-circo': [
    {
      from: -100000,
      stone: 'marble',
      why: "Hermodorus's temple of about 133 BCE, its columns of Greek marble 1.10–1.15 m thick, the second marble temple in Rome after Jupiter Stator's (Cavallero 2018, pp. 325–327)",
    },
  ],
  'aedes-apollinis-palatini': [
    {
      from: -100000,
      stone: 'marble',
      why: '"constructed of solid blocks of white Luna marble" (Aedes Apollinis Palatini, p. 17)',
    },
  ],
  'aedes-apollinis': [
    {
      from: -33,
      stone: 'marble',
      why: "Sosius's rebuilding from about 34 BCE: a superstructure of Luna marble, coloured marbles within (DAR, Apollo Medicus Sosianus)",
    },
  ],
  'aedes-herculis-olivarii': [
    {
      from: -100000,
      stone: 'marble',
      why: 'its colonnade and cella of Pentelic marble, "the blocks of the cella being solid" (Platner & Ashby, Portunium, p. 430)',
    },
  ],
  'sepulcrum-bibuli': [
    {
      from: -100000,
      stone: 'travertine',
      why: 'travertine for the visible parts, tufa behind (Platner & Ashby, Sepulcrum Bibuli, p. 477)',
    },
  ],
  'mausoleum-augusti': [
    {
      from: -100000,
      stone: 'travertine',
      why: '"faced with travertine, or, as some think, marble" (Mausoleum Augusti, p. 332)',
    },
  ],
}

/**
 * The Forum's paving: Monte Verde tufa at the Sullan level, and travertine slabs at
 * Caesar's, on which the altar of the Divus Julius was set (Forum Romanum, pp.
 * 232–233; Aedes Divi Juli, p. 287). The year of Caesar's relaying is not recorded;
 * it is taken as 44 BCE, when his works in the Forum (the Rostra, the Curia) began.
 * The travertine that survives is Augustan, Surdinus's (Forum Romanum, p. 234).
 */
const FORUM_PAVING = [
  { from: -100000, stone: 'tufa' },
  { from: -43, stone: 'travertine' },
]

/**
 * The Arx's summit and the Asylum, lon/lat and radius, metres: open ground, no houses.
 * The Asylum is the saddle between the summits, under the Piazza del Campidoglio, out
 * to the halls of the Tabularium on its Forum side.
 */
const CAPITOL_OPEN: [[number, number], number][] = [
  [[12.4835, 41.8948], 60],
  [[12.48285, 41.89325], 65],
]
/**
 * The ground between the foot of the Capitol and the Forum's head, kept open: the
 * Area Volcani, at whose level the Tabularium's substructure began (Platner & Ashby,
 * Tabularium, p. 507), and the Clivus Capitolinus climbing past Saturn and turning up
 * the hill (Clivus Capitolinus, p. 122): the ground the Tabularium's front, Concord
 * and Saturn close round.
 */
const FORUM_HEAD = ['tabularium', 'aedes-concordiae', 'aedes-saturni']
/** The Asylum's two groves, lon/lat: trees towards each summit. */
const ASYLUM_GROVES: [number, number][] = [
  [12.48238, 41.89352],
  [12.48288, 41.89308],
]

/**
 * A levelled site (`bakeModel`): the walk round a building at its level, how far
 * beyond it the ground eases back, how deep a cut, metres, needs a retaining wall, and
 * how long a run of it must be to be drawn: shorter, a stub of a wall holding nothing.
 */
const SITE = { walk: 3, ease: 10, cut: 1.2, run: 8 }
/**
 * A site cut into a hillside on some sides only (a design's `cut`): how far beyond its
 * other sides today's higher ground is taken down to its level, how steeply, as a
 * share of the distance, the hill rises again from the top of its retaining wall, and
 * that wall's thickness (the engine's, buildModel.ts), standing against the building;
 * how far in from such a wall the ground under a building built out over lower
 * ground follows the hill outside it (wider than the terrain mesh's step); and how
 * far across it, as a share of its depth from its open sides, that ground climbs from
 * its foot to its level, the hillside's top under the rest of it.
 */
const CUT = { lower: 30, rise: 0.5, wall: 1.4, inside: 10, slope: 0.6 }
/**
 * The buildings round the Forum's square: those of the Forum proper, then those of
 * the Comitium at its north-west end.
 */
const FORUM_FRONTS = [
  'aedes-saturni',
  'aedes-castoris',
  'basilica-iulia',
  'basilica-aemilia',
  'curia-iulia',
  'regia',
  'aedes-vestae',
  'aedes-divi-iulii',
  'aedes-concordiae',
  'carcer',
  'curia-hostilia',
  'rostra-vetera',
  'rostra',
]
/** The Forum's square: how far round it its level eases back to the ground, metres. */
const FORUM = { ease: 30 }

/**
 * The Servian Wall as it was built (DESIGN.md §7.7), metres:
 * - `thick`: the curtain of squared Grotta Oscura tufa, 3.5–4 m thick where it stands
 *   free (Termini; the Via di Sant'Anselmo on the Aventine), laid dry in courses of two
 *   Roman feet (Platner & Ashby, Murus Servii Tullii; Middleton 1892).
 * - `walk`: its wall-walk over the ground, where it stands free or crowns a hill's
 *   brow; nothing of its top survives anywhere, but the Aventine's stands 13–15 m on
 *   its outer face and the stretches across the valleys 8–10 m (Lanciani 1897).
 * - `parapet` over the walk, with battlements `merlon` wide every `bay`: a reasonable
 *   reconstruction, not a survival. Strabo (5.3.7) has the agger carry "a wall with
 *   towers", and the city's walls and towers were repaired in 353, 217 and 212 BCE
 *   (Livy 7.20, 22.8, 25.7).
 * - `clear`: how far the generated houses keep from its inner face, and `clearOut`
 *   from its outer face, where the ground at its foot was kept open.
 * - `gate`: half a gatehouse's length along the wall, where the curtain stops.
 * - `tower`: the agger's towers, how far apart (the spacing is not recorded).
 */
const WALL = {
  thick: 3.8,
  walk: 7.5,
  parapet: 1.8,
  merlon: 1.6,
  bay: 2.8,
  clear: 3,
  clearOut: 12,
  gate: 8,
  tower: 36,
}
/**
 * The agger on the Esquiline plateau, from the Porta Collina to the Porta Esquilina,
 * metres: in front of the wall a `berm`, then a ditch `ditch` wide and `depth` deep
 * ("more than a hundred feet broad where it is narrowest, and thirty feet deep",
 * Dionysius 9.68; the section Lanciani saw cut in 1861–62 agrees); behind it a bank of
 * earth `bank` high with a flat top `top` wide, sloping down to the city over `run`
 * (Middleton 1892, fig. 18; Platner & Ashby, Agger). It runs out over `ends` at the
 * gates at its ends; each of its gates crosses the ditch on a causeway `causeway`
 * wide either side of its road, and cuts through the bank `cut` wide.
 */
const AGGER = {
  berm: 4,
  ditch: 30,
  depth: 9,
  bank: 10,
  top: 13,
  run: 16,
  ends: 40,
  causeway: 7,
  cut: 5,
}

/** The suburb's detached houses: their spacing, the gap between them, and where they may stand. */
const FABRIC = { spacing: 9.5, gap: 1.4, streetClear: 4, monumentClear: 5, maxSlope: 0.45 }
/**
 * The sun the model is lit by (ModelLayer: north-west, 45° up), as the offset of a
 * shadow per metre of height, and the terrain's vertical exaggeration it is seen at.
 */
const SHADOW = { dx: 0.707, dy: -0.707, vex: 1.5 }
/**
 * Floats per generated building in model.bin: its lot's four corners (front left,
 * front right, back right, back left), wall height, ground, the last year it
 * stands, its kind (city.ts `LOT_KIND`), its roof (`ROOF`), its building's tone
 * (city.ts `Lot.tone`), shared by the lots of one building, and the first year it stands.
 */
const FABRIC_STRIDE = 15
/** The quarters where atrium houses gather among the flats (city.ts). */
const RICH_QUARTERS = [
  // The Cispius's foot at the head of the Subura: a house of 150–100 BCE with a
  // floor of coloured stone by S. Pudenziana, peristyle houses and aristocratic
  // painting of the mid-1st century on the Clivus Suburanus (SITAR, investigations
  // 2805, 633, 714; part 20790); Caesar's house in the Subura (Suetonius, Iulius 46).
  'mons-cispius',
  'mons-palatinus',
  'velia-roma',
  'carinae',
  'collis-quirinalis',
  'mons-caelius',
]
/**
 * Where the city is known to have grown within the window (DESIGN.md §7.7, "The city
 * growing"): in an area (`where`), a `share` of its lots of these `kinds`, chosen by
 * a hash of each lot's place so every build is the same, stands only from `from`.
 * - The Capitol's slopes, within `reach` metres of its open summits and inside the
 *   wall: "loca publica quae in circuitu Capitolii pontificibus auguribus
 *   decemviris et flaminibus in possessionem tradita erant, cogente inopia vendita
 *   sunt" (Orosius 5.18.27), the priests' land round the Capitol sold in 89 BCE (not
 *   93, as Platner & Ashby have it), and houses climbed until by 69 CE they "reached
 *   the level of the Capitol" (Tacitus, Histories 3.71). That the land had stood open
 *   is inferred from its being sold; the share is illustrative.
 */
const GROWTH: {
  where: 'capitol-slopes'
  reach: number
  share: number
  from: number
  kinds: number[]
}[] = [
  {
    where: 'capitol-slopes',
    reach: 120,
    share: 0.5,
    from: -88,
    kinds: [LOT_KIND.flats, LOT_KIND.house],
  },
]
/** The atlas's window, astronomical: 133 to 27 BCE. */
const WINDOW = [-132, -26]
/**
 * The suburb beyond the wall: houses along the roads out of the gates, as far as
 * `reach` metres from the wall and within `road` of the road, and a few against the
 * wall itself, within `wall`; and how much of each is built.
 */
const SUBURB = {
  reach: 450,
  road: 38,
  wall: 70,
  density: [0.55, 0.25],
  /** How far every part of a suburban building keeps from a road's or street's line: its drawn half-width, about 5 m, and a margin. */
  roadClear: 8,
}
/**
 * The Emporium's grid: a cell `cell` along the Porticus Aemilia and `deep` across it,
 * `street` between them; a block is a cell or two.
 */
const HORREA = { cell: 26, deep: 30, street: 6 }

/**
 * How much of a stretch of suburb is built, year by year: [astronomical year, share of
 * tries built], the share held before the first year and after the last, and straight
 * between. Each try draws one number; it is built from the first year the share
 * passes it, so a house once built stays.
 */
type Curve = [number, number][]
/**
 * The suburb as it grew, 133–27 BCE (DESIGN.md §7.7, "The city growing"; the research
 * behind it is summarised there). The texts that describe a suburb running on without
 * a break from the city (Dionysius 4.13.3–5; Strabo 5.3.7–8; Livy 1.44.4) are
 * Augustan; the one Republican witness, the law of about 45 BCE, regulates streets
 * "within a mile of Rome, where there is continuous habitation" (Tabula Heracleensis
 * ll. 20, 56). The excavations date suburban houses in only a few places (SITAR), and
 * the suburb was "less evenly distributed" than a ring round the wall (Digital
 * Augustan Rome, Continentia): built up along the Appia, in the Emporium and by the
 * bridges, thin elsewhere, with the Campus, the Caelian beyond the wall, the Vatican
 * plain and the Janiculum left to fields and tombs. Every share and reach is
 * inferred; what they rest on is said for each.
 */
const GROWN: {
  /** Houses along these roads, by distance from the wall: [out to, curve]. */
  roads: Record<string, [number, Curve][]>
  /** Areas built off the roads, lon/lat: houses, or warehouses. */
  areas: {
    id: string
    ring: [number, number][]
    curve: Curve
    kind: 'house' | 'town' | 'warehouse'
  }[]
  /** Ground kept open, lon/lat. */
  open: [number, number][][]
  /** Against the wall's outer face, within `near` metres of a gate. */
  wall: { near: number; curve: Curve }
  /** The gates beyond which no suburb stood, and how far round them. */
  bare: { gate: string; r: number }[]
  /** Tombs along the roads: how many stand, as a share of the most (at 27 BCE). */
  tombs: Curve
} = {
  roads: {
    // A settlement along the Appia's first mile: the Vicus Sulpicius, and in 54 BCE
    // the flood that swept away "a great many shops" and gardens by the temple of Mars
    // (Cicero, Letters to Quintus 3.7.1; Tusculans 1.13); the mile of the law of
    // about 45 (1,480 m).
    'via-appia': [
      [
        600,
        [
          [-132, 0.35],
          [-79, 0.45],
          [-53, 0.55],
        ],
      ],
      [
        1500,
        [
          [-132, 0.15],
          [-79, 0.25],
          [-53, 0.35],
          [-26, 0.4],
        ],
      ],
    ],
    // The Latina shares the Appia's first stretch; beyond the fork, tombs only (SITAR).
    'via-latina': [
      [
        600,
        [
          [-132, 0.35],
          [-79, 0.45],
          [-53, 0.55],
        ],
      ],
    ],
    // Houses of the 2nd century BCE 216–440 m out of the Porta Esquilina (SITAR 2555,
    // 2770, 13830, 2748), and from about 100 BCE out to 1.2 km (15365, 3182).
    'via-labicana': [
      [
        450,
        [
          [-132, 0.25],
          [-79, 0.4],
          [-59, 0.5],
        ],
      ],
      [
        1200,
        [
          [-132, 0.2],
          [-79, 0.35],
        ],
      ],
    ],
    'via-praenestina': [
      [
        450,
        [
          [-132, 0.25],
          [-79, 0.4],
          [-59, 0.5],
        ],
      ],
      [
        1200,
        [
          [-132, 0.2],
          [-79, 0.35],
        ],
      ],
    ],
    // Beyond the Porta Collina a road of tombs: houses only by the gate (SITAR: 41 of
    // the Salaria's 56 dated tombs, and no houses; DAR, Sepulcra Salaria).
    'via-salaria': [[250, [[-132, 0.25]]]],
    'via-nomentana': [[200, [[-132, 0.25]]]],
    // The Tiburtina crossed the open common of the Campus Viminalis, bounded by the
    // praetor L. Sentius's stones of about 100–75 BCE (CIL VI 31614–31615): tombs, no houses.
    'via-tiburtina': [],
    // The Flaminia: nothing dates houses on its east side, which stays as it was; on
    // its west the open Campus (below).
    'via-flaminia': [[450, [[-132, 0.55]]]],
    // Beyond the Emporium the Ostiensis ran through fields and a few tombs (SITAR).
    'via-ostiensis': [],
    // Across the river, the bridgehead quarter (below), and beyond it a thin suburb
    // along the roads (the pagus Ianiculensis; SITAR 2518).
    'via-aurelia': [[400, [[-132, 0.25]]]],
    'via-campana': [[400, [[-132, 0.25]]]],
  },
  areas: [
    // The Emporium, filled with warehouses mostly after 100 BCE: the Horrea Galbana of
    // about 100, others from about 80 (SITAR 3944, 4526), "extensively built through
    // the first half of the 1st c. B.C." (DAR, Emporium).
    {
      id: 'emporium',
      kind: 'warehouse',
      ring: [
        [12.4812, 41.888],
        [12.478, 41.887],
        [12.4735, 41.883],
        [12.4705, 41.879],
        [12.4715, 41.876],
        [12.4745, 41.875],
        [12.477, 41.8775],
        [12.4795, 41.882],
        [12.4812, 41.886],
      ],
      curve: [
        [-132, 0.2],
        [-99, 0.35],
        [-79, 0.5],
        [-49, 0.7],
      ],
    },
    // Outside the Porta Esquilina, south of the Labicana, where the excavated houses of
    // the 2nd century BCE lie (SITAR 2555, 2770, 13830, 2748).
    {
      id: 'esquiline-south',
      kind: 'house',
      ring: [
        [12.5015, 41.895],
        [12.5075, 41.895],
        [12.5085, 41.8895],
        [12.502, 41.89],
      ],
      curve: [
        [-132, 0.25],
        [-79, 0.4],
        [-59, 0.5],
      ],
    },
    // The valley between the Quirinal and the Pincian: a house of the late 2nd century
    // with fine floors (SITAR 2091, 2040).
    {
      id: 'quirinal-pincian',
      kind: 'house',
      ring: [
        [12.483, 41.901],
        [12.488, 41.901],
        [12.4885, 41.906],
        [12.483, 41.906],
      ],
      curve: [
        [-132, 0.3],
        [-79, 0.4],
      ],
    },
    // The Trastevere bridgehead: houses and flats of two or three storeys, "rather
    // modest" (DAR, Continentia), a Republican house by the bridge (SITAR 2518).
    {
      id: 'trastevere',
      kind: 'town',
      // Kept to the ground by the Pons Aemilius and the island's bridges, about 350 m in.
      ring: [
        [12.4715, 41.8925],
        [12.4765, 41.8915],
        [12.4785, 41.8885],
        [12.4775, 41.8865],
        [12.4725, 41.8862],
        [12.47, 41.8895],
      ],
      // A modest quarter in the Republic, thinner than the Emporium's.
      curve: [
        [-132, 0.18],
        [-59, 0.28],
        [-26, 0.38],
      ],
    },
  ],
  open: [
    // Monte Testaccio: the dumping of oil jars began under Augustus (DAR).
    [
      [12.4745, 41.8745],
      [12.478, 41.8745],
      [12.478, 41.8765],
      [12.4745, 41.8765],
    ],
    // The Campus west of the Flaminia, north of the Circus Flaminius: public land,
    // unbuilt in 45 (Caesar's plan "campum Martium coaedificari", Cicero, Letters to
    // Atticus 13.33a.1, came to nothing).
    [
      [12.4705, 41.8965],
      [12.4795, 41.8965],
      [12.4812, 41.905],
      [12.476, 41.911],
      [12.469, 41.906],
    ],
  ],
  // Houses backed onto the wall "now commonly" (Livy 1.44.4) and hid it "in many
  // places" (Dionysius 4.13.5): Augustan witnesses, so the change is put late; by the
  // gates only.
  wall: {
    near: 250,
    curve: [
      [-132, 0.1],
      [-59, 0.25],
      [-29, 0.45],
    ],
  },
  // The Caelian beyond the wall was tombs, the Campus Martialis and fields; its houses
  // are Augustan (DAR, Caelius Mons).
  // (Kept to 300 m, short of the Porta Capena and the Appia's first stretch.)
  bare: [{ gate: 'Porta Caelimontana', r: 300 }],
  // Of the dated tombs within 4 km, 17 begin before 133, 45 in 133–81 (most "from
  // about 100") and 58 in 80–28 (most "from about 50"): so ×0.4 in 133, ×0.6 by 80,
  // ×1.0 by 45 and ×1.2 by 27, as a share of the most.
  tombs: [
    [-132, 0.33],
    [-79, 0.5],
    [-44, 0.83],
    [-26, 1],
  ],
}

/** How far inside an area of `GROWN` its houses thin out to its edge, metres. */
const GROWN_EDGE = 80

/** The first year a draw `t` is built under `c`, or null if never: -100000 if from before the window. */
function builtFrom(c: Curve, t: number): number | null {
  if (t < c[0][1]) return -100000
  for (let k = 1; k < c.length; k++) {
    const [[y0, s0], [y1, s1]] = [c[k - 1], c[k]]
    if (t < s1) return Math.ceil(y0 + ((t - s0) / (s1 - s0)) * (y1 - y0))
  }
  return null
}
/**
 * The tombs along the roads (`bakeModel`): tried every `step` metres each side,
 * from `from` metres beyond the wall out to `reach`, with a chance of `density` that
 * falls off over `fall`; set `gap` metres behind a road's edge.
 */
const TOMBS = {
  step: 7,
  from: 40,
  reach: 2600,
  density: 0.5,
  fall: 1100,
  roadHalf: 5,
  // Clear of the road as it is drawn, which widens a little when seen from far off.
  gap: 2.5,
}
/**
 * How high the Tiber Island's level top stands over the river, metres: an
 * illustration's, not a survey's — enough for its embankment to read as one.
 */
const ISLE_TOP_M = 3
/** How far in from its shore the Tiber Island's ground rises to its top, metres. */
const ISLE_BANK_M = 16
/** How far in from its shore that bank starts: behind the embankment's face. */
const ISLE_BANK_FROM_M = 4
/** The river round the Tiber Island, level, metres against the water's level. */
const ISLE_RIVER_M = -1
/** How far apart, and how many, the samples of the ground past a bridge's ends are, metres. */
const BRIDGE_PROFILE_M = 2
const BRIDGE_PROFILE_N = 21
/** The farmsteads: tried on a grid this far apart, this share built, between these distances from the wall. */
const FARMS = { spacing: 170, share: 0.55, from: 550, reach: 2400 }

export function bakeModel(m: ModelInput) {
  const { grid: g } = m
  const rand = mulberry32(1753)
  const idx = (x: number, y: number) => {
    const c = Math.floor((x - g.x0) / g.texel)
    const r = Math.floor((g.y1 - y) / g.texel)
    return c < 0 || r < 0 || c >= g.width || r >= g.height ? -1 : r * g.width + c
  }
  const sample = (f: Float32Array, x: number, y: number, fallback = 0) => {
    const i = idx(x, y)
    return i < 0 ? fallback : f[i]
  }

  // --- the ground -------------------------------------------------------------------
  // The water surface is the river's lowest tenth under the surface model, which
  // records the water itself, within the plan (the river falls on beyond it); the bed
  // is laid 3 m below it so the terrain never shows through, with a light blur so the
  // banks are not cliffs.
  const onRiver: number[] = []
  for (let i = 0; i < m.water.length; i++)
    if (m.water[i] < -4 && m.reach[i] < m.reachM) onRiver.push(m.raw[i])
  onRiver.sort((a, b) => a - b)
  const waterLevel = onRiver[Math.floor(onRiver.length * 0.1)] ?? 8
  const cut = new Float32Array(m.smooth)
  for (let i = 0; i < cut.length; i++) {
    const t = Math.min(1, Math.max(0, (6 - m.water[i]) / 10))
    cut[i] = cut[i] * (1 - t) + Math.min(cut[i], waterLevel - 3) * t
  }
  const ground = blur(cut, g.width, g.height, 2)
  // The Tiber Island (island.ts): its top level, ISLE_TOP_M over the water, and the
  // river round it level at ISLE_RIVER_M, where its embankment's face meets the water
  // it is painted on (the river is drawn on the ground at its bed, not as a surface of
  // its own). Between them a bank ISLE_BANK_M wide rising from its shore: the
  // terrain's cells are coarser than the texels, and a step at the shore would come
  // out through the embankment's face as a slope. From the wall's years the
  // embankment lays its own top over the bank (monuments.ts `island`).
  const isle = m.places.get(ISLAND)
  const shoreAt = isle ? islandRing(m.riverRings, islandAt(isle.location)) : -1
  const isleTop = waterLevel + ISLE_TOP_M
  if (shoreAt >= 0) {
    const shore = m.riverRings[shoreAt]
    const xs = shore.map((p) => p[0])
    const ys = shore.map((p) => p[1])
    const river = waterLevel + ISLE_RIVER_M
    // Out as far as the blur carried the island's old ground into the river.
    for (let x = Math.min(...xs) - 24; x <= Math.max(...xs) + 24; x += g.texel)
      for (let y = Math.min(...ys) - 24; y <= Math.max(...ys) + 24; y += g.texel) {
        const i = idx(x, y)
        if (i < 0) continue
        // Texel centres, so each is tested once.
        const [cx, cy] = [
          g.x0 + (Math.floor((x - g.x0) / g.texel) + 0.5) * g.texel,
          g.y1 - (Math.floor((g.y1 - y) / g.texel) + 0.5) * g.texel,
        ]
        if (inRing([cx, cy], shore)) {
          const d = distToRing([cx, cy], shore) - ISLE_BANK_FROM_M
          const t = Math.min(1, Math.max(0, d / ISLE_BANK_M))
          ground[i] = river + (isleTop - river) * t * t * (3 - 2 * t)
        } else if (m.water[i] < 0) ground[i] = river
      }
  }
  const at = (x: number, y: number) => sample(ground, x, y, waterLevel)
  // The ground between the texel centres, as the terrain draws it.
  const between = (x: number, y: number) => {
    const fx = (x - g.x0) / g.texel - 0.5
    const fy = (g.y1 - y) / g.texel - 0.5
    const [c, r] = [Math.floor(fx), Math.floor(fy)]
    const [u, v] = [fx - c, fy - r]
    const h = (cc: number, rr: number) =>
      cc < 0 || rr < 0 || cc >= g.width || rr >= g.height
        ? waterLevel
        : ground[rr * g.width + cc]
    return (
      (h(c, r) * (1 - u) + h(c + 1, r) * u) * (1 - v) +
      (h(c, r + 1) * (1 - u) + h(c + 1, r + 1) * u) * v
    )
  }
  // The ground over the base of what stands in the river (the bridges): on the Tiber
  // Island its level top, which its embankment lays over the bank.
  const groundOver = (x: number, y: number) =>
    (shoreAt >= 0 && inRing([x, y], m.riverRings[shoreAt]) ? isleTop : between(x, y)) -
    (waterLevel - 2)
  const slopeAt = (x: number, y: number) =>
    Math.hypot(at(x + 4, y) - at(x - 4, y), at(x, y + 4) - at(x, y - 4)) / 8

  // --- the known buildings ------------------------------------------------------------
  const monuments: {
    id: string
    kind: string
    rings: Pt[][]
    base: number
    body: number
    roof: string
    podium: number
    approx?: boolean
    /** Its design (designs.ts), placed: centre, size across and along, and bearing once known. */
    design?: {
      d: Design
      centre: Pt
      size: Pt
      bearing: number | null
      axis: Pt
      drop: number
    }
    /** Whether it keeps the generated houses off its footprint (all but the island). */
    clear?: boolean
    /** More that its design needs from the ground: the island's shore, a bridge's banks. */
    extra?: Record<string, unknown>
  }[] = []
  const lowest = (rings: Pt[][]) => Math.min(...rings[0].map(([x, y]) => at(x, y)))
  for (const o of m.outlines) {
    const mass = MASSING[o.kind]
    if (
      !mass &&
      o.kind !== 'bridge' &&
      o.kind !== 'forum' &&
      o.kind !== 'circus' &&
      o.kind !== 'island'
    )
      continue
    for (const rings of o.polys) {
      if (o.kind === 'island') continue
      if (o.kind === 'bridge') {
        // A deck at the height of its banks over the water.
        const bank = Math.max(
          ...rings[0].map(([x, y]) => (sample(m.water, x, y, 99) > 0 ? at(x, y) : 0)),
        )
        monuments.push({
          id: o.id,
          kind: 'bridge',
          rings,
          base: waterLevel - 2,
          body: Math.max(bank, waterLevel + 8) - waterLevel + 2,
          roof: 'flat',
          podium: 0,
        })
        continue
      }
      const base = lowest(rings)
      if (o.kind === 'forum')
        monuments.push({
          id: o.id,
          kind: 'forum',
          rings,
          base,
          body: 9,
          roof: 'hip',
          podium: 0,
        })
      else if (o.kind === 'circus')
        monuments.push({
          id: o.id,
          kind: 'circus',
          rings,
          base,
          body: 11,
          roof: 'flat',
          podium: 0,
        })
      else
        monuments.push({
          id: o.id,
          kind: o.kind,
          rings,
          base,
          body: mass.body,
          roof: mass.roof,
          podium: mass.podium ?? 0,
        })
    }
  }
  // Temples the records place by a point only: a temple of a standard size (or the
  // size Platner & Ashby give) at the point, its long axis down the slope and its
  // front facing downhill, as a temple on a hillside faced out over the valley.
  // One that would stand on a surveyed monument, or in the river, is left out.
  const pointFacing = new Map<string, Pt>()
  const outlined = new Set(m.outlines.map((o) => o.id))
  const doubts: string[] = []
  for (const p of m.places.values()) {
    if (p.kind !== 'temple' || p.within !== 'roma' || outlined.has(p.id)) continue
    // One whose design places and sizes it is built from that (below).
    if (DESIGNS[p.id]?.size) continue
    const [cx, cy] = projection.forward(...p.location)
    const [w, d] = POINT_TEMPLE.sizes[p.id] ?? POINT_TEMPLE.size
    const gx = at(cx + 15, cy) - at(cx - 15, cy)
    const gy = at(cx, cy + 15) - at(cx, cy - 15)
    const fixed = POINT_TEMPLE.facing[p.id]
    const down: Pt =
      fixed !== undefined
        ? [Math.cos(fixed), Math.sin(fixed)]
        : Math.hypot(gx, gy) > 0.3
          ? [-gx, -gy]
          : [0, -1]
    const angle = Math.atan2(down[1], down[0]) - Math.PI / 2
    const ring = rect(cx, cy, w, d, angle)
    const clash = monuments.find((mo) => ring.some((q) => inRing(q, mo.rings[0])))
    if (clash) {
      doubts.push(`${p.id} would stand on ${clash.id}: left out`)
      continue
    }
    if (ring.some(([x, y]) => sample(m.water, x, y, 99) < 4)) {
      doubts.push(`${p.id} would stand in the river: left out`)
      continue
    }
    const l = Math.hypot(down[0], down[1])
    pointFacing.set(p.id, [cx + (down[0] / l) * 100, cy + (down[1] / l) * 100])
    monuments.push({
      id: p.id,
      kind: 'temple',
      rings: [ring],
      base: lowest([ring]),
      body: MASSING.temple.body,
      roof: 'gable',
      podium: MASSING.temple.podium ?? 3,
      approx: true,
    })
  }
  for (const d of doubts) console.log(`model: ${d}`)

  // Each building with a design (designs.ts) is built as itself: placed by its
  // outline's box unless the design gives its centre, size or bearing, and standing
  // on the footprint its design gives it, which keeps the houses off.
  const designed: [string, Design][] = [
    ...Object.entries(DESIGNS),
    // Every other temple of the plan is drawn as a typical one.
    ...monuments
      .filter((mo) => mo.kind === 'temple' && !DESIGNS[mo.id])
      .map((mo) => [mo.id, DEFAULT_TEMPLE] as [string, Design]),
  ]
  for (const [id, d] of designed) {
    const p = m.places.get(id)
    if (!p) throw new Error(`designs.ts: no place "${id}"`)
    const own = monuments.filter((mo) => mo.id === id)
    const largest = own
      .map((mo) => mo.rings[0])
      .sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0]
    const box = largest ? orientedBox(largest) : null
    const centre: Pt = d.at
      ? projection.forward(...d.at)
      : box
        ? [box.cx, box.cy]
        : projection.forward(...p.location)
    const bearing =
      d.bearing !== undefined ? planeBearing(d.bearing, d.at ?? p.location) : null
    let size: Pt | undefined = d.size
    if (!size && box) {
      // The box's long side runs along the building unless its front is on it.
      const across =
        bearing !== null &&
        Math.abs(Math.sin(bearing - Math.atan2(box.axis[0], box.axis[1]))) > 0.7
      size = across ? [box.long, box.short] : [box.short, box.long]
    }
    if (!size) throw new Error(`designs.ts: ${id} has no outline, so needs a size`)
    // Its depth runs along the bearing, or the box's long axis until the front is known.
    const axis: Pt = bearing !== null ? [Math.sin(bearing), Math.cos(bearing)] : box!.axis
    if (d.atLocal) {
      // `at` is a point of it off its centre: across (to the right of its front) and along.
      const [du, dv] = d.atLocal
      centre[0] -= axis[1] * du + axis[0] * dv
      centre[1] -= -axis[0] * du + axis[1] * dv
    }
    // With the shops behind its porticoes, which keep the houses off too.
    const ring = footprint(d, centre, size, axis).ring
    const rings =
      d.at || d.size || !largest ? [ring] : own.find((mo) => mo.rings[0] === largest)!.rings
    const kind = own[0]?.kind ?? p.kind
    for (const mo of own) monuments.splice(monuments.indexOf(mo), 1)
    // The island's own shore, for its embankment: the hole in the river the island is
    // (OpenStreetMap's outline of it is the modern embankments, wider than its land).
    const shore =
      kind === 'island'
        ? m.riverRings
            .filter((r) => inRing(centre, r))
            .sort((a, b) => Math.abs(ringArea(a)) - Math.abs(ringArea(b)))[0]
        : undefined
    // A bridge runs from bank to bank along its axis: walked out from its centre until
    // the ground is dry, so it meets the ground at both ends whatever its design's
    // length (the river's line here is OpenStreetMap's, not the Republic's).
    let span: { a: Pt; b: Pt } | null = null
    if (kind === 'bridge') {
      // The water along its axis, 0.5 m at a time out to 250 m either side; runs of it
      // joined across dry gaps under 45 m (a pier, an islet in the river's line, or its line broken under a
      // bridge); the run nearest its centre is what it crosses.
      const pt = (t: number): Pt => [centre[0] + axis[0] * t, centre[1] + axis[1] * t]
      const runs: [number, number][] = []
      for (let t = -250; t <= 250; t += 0.5) {
        if (sample(m.water, ...pt(t), 99) >= 0) continue
        const last = runs[runs.length - 1]
        if (last && t - last[1] < 45) last[1] = t
        else runs.push([t, t])
      }
      const gap = (r: [number, number]) =>
        r[0] <= 0 && r[1] >= 0 ? 0 : Math.min(Math.abs(r[0]), Math.abs(r[1]))
      const run = runs.sort((a, b) => gap(a) - gap(b))[0] ?? [-size[1] / 2, size[1] / 2]
      span = { a: pt(run[0]), b: pt(run[1]) }
      const L = Math.hypot(span.b[0] - span.a[0], span.b[1] - span.a[1])
      const mid: Pt = [(span.a[0] + span.b[0]) / 2, (span.a[1] + span.b[1]) / 2]
      if (Math.abs(L - size[1]) / size[1] > 0.25)
        console.log(
          `model: ${id}: the water here is ${L.toFixed(0)} m across, its design ${size[1].toFixed(0)} m; its arches are scaled to it`,
        )
      centre[0] = mid[0]
      centre[1] = mid[1]
      size = [size[0], L]
    }
    // A bridge stands on the water; the rest on the lowest ground under them, or, where
    // the design says it is a terrace built out on a slope, its highest or middle
    // ground, its foundations running down to the lowest.
    const wet = kind === 'bridge' || kind === 'island'
    const heights = rings[0].map(([x, y]) => at(x, y))
    const low = Math.min(...heights)
    const level =
      typeof d.level === 'number'
        ? d.level
        : d.level === 'top'
          ? Math.max(...heights)
          : d.level === 'mean'
            ? heights.reduce((a, b) => a + b, 0) / heights.length
            : low
    monuments.push({
      id,
      kind,
      rings,
      base: wet ? waterLevel - 2 : level,
      body: 0,
      roof: 'flat',
      podium: 0,
      approx: !outlined.has(id) || own.some((mo) => mo.approx),
      design: { d, centre, size, bearing, axis, drop: wet ? 0 : level - low },
      // The island keeps no houses off: its embankment is round its shore.
      clear: kind !== 'island',
      extra: {
        // The island's level top, and the river round it, over its base, for its
        // embankment.
        ...(kind === 'island' && {
          top: round(isleTop - (waterLevel - 2)),
          river: round(ISLE_RIVER_M + 2),
        }),
        ...(shore && {
          // Each shore point with the island's ground a few metres inland, over its base.
          outline: shore.map(([x, y]) => {
            const [dx, dy] = [centre[0] - x, centre[1] - y]
            const l = Math.hypot(dx, dy) || 1
            return [
              round(x),
              round(y),
              round(at(x + (dx / l) * 5, y + (dy / l) * 5) - (waterLevel - 2)),
            ]
          }),
        }),
        // A bridge's banks: the ground a few metres onto the land at each end, over its
        // base, where its deck comes down to meet it.
        ...(span && {
          // On the Tiber Island, its level top, which its embankment lays over the bank.
          banks: [-1, 1].map((s) => {
            const e = s < 0 ? span!.a : span!.b
            return round(groundOver(e[0] + axis[0] * s * 8, e[1] + axis[1] * s * 8))
          }),
          // And the ground along its line past each end, every BRIDGE_PROFILE_M out
          // from the water, so its deck comes down to meet it wherever it lies.
          // The lowest across its deck, so where a bank slopes across it the deck lies
          // on its low side and goes into the high one.
          profiles: [-1, 1].map((s) => {
            const e = s < 0 ? span!.a : span!.b
            const half = size[0] / 2 + 0.5
            return Array.from({ length: BRIDGE_PROFILE_N }, (_, j) => {
              const t = j * BRIDGE_PROFILE_M
              const [x, y] = [e[0] + axis[0] * s * t, e[1] + axis[1] * s * t]
              return round(
                Math.min(
                  ...[-half, 0, half].map((v) =>
                    groundOver(x + axis[1] * v, y - axis[0] * v),
                  ),
                ),
              )
            })
          }),
        }),
      },
    })
  }

  // --- the wall's course ----------------------------------------------------------------
  const ring = m.course.ring
  const N = ring.length - 1
  const pt = (i: number) => ring[((i % N) + N) % N]
  /** Outward, away from the city: the course runs counter-clockwise, the city on its left. */
  const outward = (i: number): Pt => {
    const [p, q] = [pt(i - 1), pt(i + 1)]
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
    return [(q[1] - p[1]) / L, -(q[0] - p[0]) / L]
  }
  // A building placed only roughly (by its record's point, or a disputed site) that
  // would stand on the wall is moved in off it, the wall being the better known.
  for (const mo of monuments) {
    if (!mo.approx || mo.clear === false) continue
    const r0 = mo.rings[0]
    const hits = ring.map((q, i) => (inRing(q, r0) ? i : -1)).filter((i) => i >= 0)
    if (!hits.length) continue
    const n = outward(hits[Math.floor(hits.length / 2)])
    let shift = 0
    const moved = (d: number) =>
      mo.rings.map((r) => r.map(([x, y]) => [x - n[0] * d, y - n[1] * d] as Pt))
    while (
      shift < 60 &&
      ring.some(
        (q) =>
          inRing(q, moved(shift)[0]) ||
          distToRing(q, moved(shift)[0]) < WALL.thick / 2 + WALL.clear,
      )
    )
      shift += 1
    mo.rings = moved(shift)
    if (mo.design)
      mo.design.centre = [
        mo.design.centre[0] - n[0] * shift,
        mo.design.centre[1] - n[1] * shift,
      ]
    mo.base = lowest(mo.rings)
    console.log(`model: ${mo.id} moved ${shift} m in off the wall`)
  }

  // --- the Forum's square --------------------------------------------------------------
  const locate = (ids: string[]) =>
    ids
      .map((id) => m.places.get(id))
      .filter((p): p is Place => !!p)
      .map((p) => projection.forward(...p.location))
  const forum = locate(FORUM_FRONTS.slice(0, 8))
  // Its north-west end was public ground too: the Comitium before the senate house,
  // with the old Rostra on its edge, the new Rostra, and the ground before Concord
  // and the Carcer (Platner & Ashby, Comitium). Cato bought up the last private halls
  // and shops on this side in 184 BCE for his basilica (Livy 39.44.7).
  const comitium = locate(FORUM_FRONTS.slice(8))
  // Drawn through the buildings' middles, so pushed out to take in their fronts.
  const forumHull = forum.length > 2 ? grow(hull([...forum, ...comitium]), 6) : []
  // The Forum proper: a temple on it faces its middle, and the city is laid out round it.
  const forumCore = forum.length > 2 ? hull(forum) : []
  // The square was paved level: its travertine lies at 13.5 m by the Lacus Iuturnae,
  // and the street at the Argiletum's mouth at 13.9 m (ground.ts). Today's ground,
  // smoothed, rises 11 m across it to the foot of the Capitol, so the square is cut
  // and filled to its paving's level, easing back to the ground round it over
  // `FORUM.ease`; the buildings on it stand on it (the sites, below).
  const forumLevel = levelOf(FORUM_PAVING_PIECES)
  const onForum = new Set(
    monuments
      .filter((mo) => {
        const r = mo.rings[0]
        const c: Pt = [
          r.reduce((s, q) => s + q[0], 0) / r.length,
          r.reduce((s, q) => s + q[1], 0) / r.length,
        ]
        return (
          FORUM_FRONTS.includes(mo.id) ||
          (forumHull.length > 2 && inRing(c, [...forumHull, forumHull[0]]))
        )
      })
      .map((mo) => mo.id),
  )
  if (forumHull.length > 2) {
    const ring = [...forumHull, forumHull[0]]
    const [x0, y0, x1, y1] = bounds(ring, FORUM.ease + g.texel)
    const c0 = Math.max(0, Math.floor((x0 - g.x0) / g.texel))
    const c1 = Math.min(g.width - 1, Math.ceil((x1 - g.x0) / g.texel))
    const r0 = Math.max(0, Math.floor((g.y1 - y1) / g.texel))
    const r1 = Math.min(g.height - 1, Math.ceil((g.y1 - y0) / g.texel))
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const p: Pt = [g.x0 + (c + 0.5) * g.texel, g.y1 - (r + 0.5) * g.texel]
        const k = r * g.width + c
        if (m.water[k] < 4) continue
        const d = inRing(p, ring) ? 0 : distToRing(p, ring)
        if (d >= FORUM.ease) continue
        ground[k] = forumLevel + (ground[k] - forumLevel) * smoothstep(0, FORUM.ease, d)
      }
    // What stands on the square without a site of its own stands on its paving.
    for (const mo of monuments) if (onForum.has(mo.id) && !mo.design) mo.base = forumLevel
  }

  // --- the sites, levelled -----------------------------------------------------------
  // A Roman building stood on ground cut and filled level for it — Caesar's forum cut
  // into the Capitol's slope behind a wall of peperino 12 m high (Platner & Ashby,
  // Forum Iulium, p. 227) — and the ground under the model is today's, smoothed. So
  // each designed building's site is levelled into the ground everything stands on
  // (DESIGN.md §7.7): the larger first, so a temple in a forum stands on the forum.
  // Round each, a walk `SITE.walk` wide at its level; beyond it, where the ground is
  // near the level it eases back over `SITE.ease`; where the site is cut deep into
  // rising ground a retaining wall of tufa holds it back, and where it is built out
  // over falling ground its own walls and podium stand on foundations to the ground.
  const yearsOf = (id: string) => dates(m.places.get(id)).years
  const retaining: { id: string; base: number; pts: number[][]; years: number[] }[] = []
  const sites = monuments
    .filter((mo) => mo.design && mo.clear !== false && mo.kind !== 'bridge')
    .sort((a, b) => Math.abs(ringArea(b.rings[0])) - Math.abs(ringArea(a.rings[0])))
  for (const mo of sites) {
    const d = mo.design!.d
    const cut = d.cut
    // A site cut in on some sides only: its footprint with the shops behind its
    // porticoes, which were cut into the hill with it, and which side of it each point
    // is beyond (front, right, back, left).
    const { axis } = mo.design!
    const {
      mid,
      w: sw,
      l: sl,
      ring: box,
    } = footprint(d, mo.design!.centre, mo.design!.size, axis)
    const right: Pt = [axis[1], -axis[0]]
    const ring = cut ? box : mo.rings[0]
    // How far a point is beyond each side (front, right, back, left): negative inside.
    const beyondOf = (p: Pt) => {
      const [x, y] = [p[0] - mid[0], p[1] - mid[1]]
      const [u, v] = [x * right[0] + y * right[1], x * axis[0] + y * axis[1]]
      return [v - sl / 2, u - sw / 2, -v - sl / 2, -u - sw / 2]
    }
    const sideOf = (p: Pt) => {
      const beyond = beyondOf(p)
      return beyond.indexOf(Math.max(...beyond))
    }
    const alongside = (p: Pt, side: number) => {
      const beyond = beyondOf(p)
      return beyond[(side + 1) % 4] <= 0 && beyond[(side + 3) % 4] <= 0
    }
    const outOf: Pt[] = [axis, right, [-axis[0], -axis[1]], [-right[0], -right[1]]]
    const [x0, y0, x1, y1] = bounds(
      ring,
      SITE.walk + (cut ? Math.max(SITE.ease, CUT.lower) : SITE.ease) + g.texel,
    )
    // Its level: of the ground under it now (the larger sites round it already level).
    const under: number[] = []
    for (let y = y0; y <= y1; y += g.texel)
      for (let x = x0; x <= x1; x += g.texel) if (inRing([x, y], ring)) under.push(at(x, y))
    if (!under.length) under.push(...ring.map(([x, y]) => at(x, y)))
    const lowUnder = Math.min(...under)
    // Cut and fill balanced, unless the design says it was cut in (`low`) or built out
    // as a terrace (`top`), or gives the level its excavators found.
    // On the Forum's square, the square's own level.
    const level = onForum.has(mo.id)
      ? forumLevel
      : typeof d.level === 'number'
        ? d.level
        : d.level === 'top'
          ? Math.max(...under)
          : d.level === 'low'
            ? lowUnder
            : under.reduce((a, b) => a + b, 0) / under.length
    const foot = Math.min(level, cut?.foot ?? level)
    // The ground under a building built out over lower ground, where the terrain's
    // coarse mesh is hidden inside it: a slope rising from its foot's level at its
    // open sides to its own level CUT.slope of the way across, as the hillside it was
    // set into, so that before it was built the ground reads as a slope and not a cliff;
    // and within CUT.inside of a wall cut into the hill, eased to the hill's own
    // height just outside that wall, so the mesh never dips along it.
    const underBuilt = (p: Pt) => {
      const beyond = beyondOf(p)
      const sides = cut!.sides
      const half = (i: number) => (i % 2 ? sw : sl) / 2
      const open = [0, 1, 2, 3].filter((i) => !sides[i])
      const t = Math.min(1, ...open.map((i) => -beyond[i] / (2 * half(i))))
      const slope = foot + (level - foot) * smoothstep(0, CUT.slope, t)
      let near = -1
      for (let i = 0; i < 4; i++)
        if (sides[i] && -beyond[i] < CUT.inside && (near < 0 || beyond[i] > beyond[near]))
          near = i
      if (near < 0) return slope
      const o = outOf[near]
      const reach = -beyond[near] + CUT.wall + 3
      const edge = Math.max(
        foot,
        Math.min(level, sample(before, p[0] + o[0] * reach, p[1] + o[1] * reach, level)),
      )
      return edge + (slope - edge) * smoothstep(0, CUT.inside, -beyond[near])
    }
    const before = new Float32Array(ground)
    const c0 = Math.max(0, Math.floor((x0 - g.x0) / g.texel))
    const c1 = Math.min(g.width - 1, Math.ceil((x1 - g.x0) / g.texel))
    const r0 = Math.max(0, Math.floor((g.y1 - y1) / g.texel))
    const r1 = Math.min(g.height - 1, Math.ceil((g.y1 - y0) / g.texel))
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const p: Pt = [g.x0 + (c + 0.5) * g.texel, g.y1 - (r + 0.5) * g.texel]
        const k = r * g.width + c
        if (m.water[k] < 4) continue
        const dist = inRing(p, ring) ? 0 : distToRing(p, ring)
        // Where it was cut into the hill its own back wall is the retaining wall's face:
        // no walk round it there.
        const side = sideOf(p)
        const hill = !!cut && cut.sides[side]
        // Beside its other sides the ground is only ever lowered, to its level or to the
        // ground at its foot (`cut.foot`): where it stands over lower ground its own
        // walls go down to meet it.
        if (dist === 0 && cut && foot < level) ground[k] = underBuilt(p)
        else if (cut?.street?.[side] && dist > 0 && alongside(p, side)) {
          // A street along it at its level, where today's ground is lower: raised to
          // it, and eased back down beyond; only alongside it, not past its corners.
          const out = Math.max(0, dist - SITE.walk)
          ground[k] =
            before[k] >= level
              ? Math.min(before[k], level + cut.h + out * CUT.rise)
              : level + (before[k] - level) * smoothstep(0, CUT.lower, out)
        } else if (dist <= (hill ? CUT.wall : SITE.walk))
          // Outside a building cut into a hill the ground is only ever lowered: the hill
          // meets its walls at its own height, and on its open sides it is taken down to
          // the ground at its foot.
          ground[k] = cut && dist > 0 ? Math.min(before[k], hill ? level : foot) : level
        else if (cut) {
          // Where it was cut into the hill, the hill rising from its retaining wall's top;
          // elsewhere today's higher ground, the fill of later centuries, taken down and
          // eased back.
          const out = dist - (hill ? CUT.wall : SITE.walk)
          if (hill) ground[k] = Math.min(before[k], level + cut.h + out * CUT.rise)
          else if (before[k] > foot && out < CUT.lower)
            ground[k] = foot + (before[k] - foot) * smoothstep(0, CUT.lower, out)
        } else if (dist < SITE.walk + SITE.ease) {
          // Eased back where the ground is near the level; left where it is not, for the
          // wall or the building's own foundations to meet it.
          const off = before[k] - level
          const near = Math.min(1, Math.max(0, 1 - (Math.abs(off) - 1) / 2))
          const t = 1 - (dist - SITE.walk) / SITE.ease
          ground[k] = before[k] - off * t * near
        }
      }
    mo.base = level
    mo.design!.drop = Math.max(mo.design!.drop, level - Math.min(lowUnder, foot))
    // Retaining walls: along each edge, where the ground just beyond the walk stands
    // more than `SITE.cut` over the level.
    // Each edge's right-hand normal, which points out of a ring wound anticlockwise.
    const outward = ringArea(ring) > 0 ? 1 : -1
    // Where another building stands on the ground behind, its own walls hold that
    // ground once it is begun: the wall stands only until then.
    const own = yearsOf(mo.id)
    const coverOf = (p: Pt) =>
      sites.find(
        (o) =>
          o !== mo &&
          yearsOf(o.id)[1] >= own[0] &&
          yearsOf(o.id)[0] <= own[1] &&
          inRing(p, o.rings[0]),
      )
    let run: number[][] = []
    let cover: (typeof sites)[number] | undefined
    const flush = () => {
      const years = [own[0], cover ? Math.min(own[1], yearsOf(cover.id)[0] - 1) : own[1]]
      const long = run
        .slice(1)
        .reduce((a, q, i) => a + Math.hypot(q[0] - run[i][0], q[1] - run[i][1]), 0)
      if (long >= SITE.run && years[0] <= years[1])
        retaining.push({ id: mo.id, base: round(level), pts: run, years })
      run = []
    }
    for (let i = 0; i + 1 < ring.length; i++) {
      const [a, b] = [ring[i], ring[i + 1]]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 0.5) continue
      const n: Pt = [((b[1] - a[1]) / L) * outward, (-(b[0] - a[0]) / L) * outward]
      const steps = Math.max(1, Math.round(L / 3))
      const walled = !cut || cut.sides[sideOf([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])]
      for (let k = 0; k <= steps; k++) {
        const t = k / steps
        const q: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        // Its middle: at the walk's edge, or on a cut side against the building's back.
        const face = cut ? CUT.wall / 2 : SITE.walk - 0.6
        const w: Pt = [q[0] + n[0] * face, q[1] + n[1] * face]
        const behind = (cut ? CUT.wall : SITE.walk) + 3
        const back: Pt = [q[0] + n[0] * behind, q[1] + n[1] * behind]
        const beyond = sample(cut ? ground : before, back[0], back[1], level)
        const covered = coverOf(back)
        if (covered !== cover) {
          flush()
          cover = covered
        }
        const high = cut ? Math.min(beyond - level, cut.h) : beyond - level
        if (high > SITE.cut && walled)
          run.push([round(w[0]), round(w[1]), round(high + 0.7)])
        else flush()
      }
      flush()
    }
  }

  // Known buildings standing on one another in the same years are a mistake in their
  // placing: the build says so.
  for (let i = 0; i < monuments.length; i++)
    for (let j = i + 1; j < monuments.length; j++) {
      const [a, b] = [monuments[i], monuments[j]]
      if (a.id === b.id || a.clear === false || b.clear === false) continue
      const [ya, yb] = [dates(m.places.get(a.id)).years, dates(m.places.get(b.id)).years]
      if (ya[1] < yb[0] || yb[1] < ya[0]) continue
      const inter = polygonClipping.intersection([a.rings[0]], [b.rings[0]])
      const area = inter.reduce((s, poly) => s + Math.abs(ringArea(poly[0] as Pt[])), 0)
      const least = Math.min(Math.abs(ringArea(a.rings[0])), Math.abs(ringArea(b.rings[0])))
      if (area > least * 0.04)
        console.log(
          `model: ${a.id} and ${b.id} overlap by ${Math.round((area / least) * 100)}%`,
        )
    }

  // --- the agger ---------------------------------------------------------------------
  // Where the wall crossed the flat plateau with no brow to stand on, its ditch was
  // dug in front of it and its earth heaped behind (`AGGER`): cut into the ground
  // everything stands on, and raised on it, so the houses and trees keep off them.
  const [a0, a1] = m.course.agger
  const aggerGates = m.course.gates.filter((gt) => gt.i >= a0 && gt.i <= a1)
  const g0 = ring.map(([x, y]) => at(x, y))
  {
    const pad = WALL.thick / 2 + AGGER.berm + AGGER.ditch + AGGER.top + AGGER.run + 8
    const span = ring.slice(a0, a1 + 1)
    const [bx0, by0, bx1, by1] = bounds(span, pad)
    const before = new Float32Array(ground)
    for (let y = by0; y <= by1; y += g.texel)
      for (let x = bx0; x <= bx1; x += g.texel) {
        const k = idx(x, y)
        if (k < 0) continue
        let best = { i: a0, d: Infinity }
        for (let i = a0; i <= a1; i++) {
          const d = Math.hypot(ring[i][0] - x, ring[i][1] - y)
          if (d < best.d) best = { i, d }
        }
        const i = best.i
        const n = outward(i)
        const across = (x - ring[i][0]) * n[0] + (y - ring[i][1]) * n[1]
        // Along the wall, whose direction is the outward normal turned left.
        const along = Math.abs(-(x - ring[i][0]) * n[1] + (y - ring[i][1]) * n[0])
        if (along > STEP_M) continue
        const fromEnd = Math.min(i - a0, a1 - i) * STEP_M
        const fromGate = Math.min(...aggerGates.map((gt) => Math.abs(i - gt.i) * STEP_M))
        const ends = smoothstep(0, AGGER.ends, fromEnd)
        const e = across - WALL.thick / 2 - AGGER.berm
        if (e > 0 && e < AGGER.ditch) {
          const w = ends * smoothstep(AGGER.causeway, AGGER.causeway + 10, fromGate)
          const depth = Math.min(AGGER.depth, e, AGGER.ditch - e)
          ground[k] = Math.min(before[k], before[k] - (before[k] - (g0[i] - depth)) * w)
        }
        const f = -across - WALL.thick / 2
        if (f > -1 && f < AGGER.top + AGGER.run) {
          const w = ends * smoothstep(AGGER.cut, AGGER.cut + 12, fromGate)
          const h =
            f < AGGER.top
              ? AGGER.bank
              : AGGER.bank * (1 - smoothstep(AGGER.top, AGGER.top + AGGER.run, f))
          ground[k] = Math.max(before[k], before[k] + (g0[i] + h - before[k]) * w)
        }
      }
  }

  const png = new Uint8Array(g.width * g.height * 4)
  for (let i = 0; i < ground.length; i++) {
    const cm = Math.max(0, Math.min(65535, Math.round(ground[i] * 100)))
    png[i * 4] = cm >> 8
    png[i * 4 + 1] = cm & 255
    png[i * 4 + 3] = 255
  }

  // --- the wall ------------------------------------------------------------------------
  // Along its course, every `STEP_M`: the ground just outside and just inside its
  // faces, which each face runs down to, and the height of its walk. It stands `walk`
  // over its ground where it stands free, and crowning a brow, at least a little over
  // the hill behind it; on the agger its walk is the bank's top. Smoothed along the
  // wall, so it rises and falls with the ground in long runs, not a step at a time.
  const face = WALL.thick / 2 + 1
  const sides = ring.slice(0, N).map((p, i) => {
    const n = outward(i)
    return {
      out: at(p[0] + n[0] * face, p[1] + n[1] * face),
      in: at(p[0] - n[0] * face, p[1] - n[1] * face),
      mid: at(p[0], p[1]),
    }
  })
  const rawWalk = sides.map((sd) => Math.max(sd.mid + WALL.walk, sd.in + 0.4))
  const walk = smoothCyclic(rawWalk, 3).map((v, i) => Math.max(v, sides[i].mid + 5.5))
  const nearGate = (i: number, half: number) =>
    m.course.gates.some((gt) => {
      const d = Math.min(Math.abs(i - gt.i), N - Math.abs(i - gt.i)) * STEP_M
      return d < half
    })
  // The curtain in runs between the gatehouses.
  const wall: { pts: number[][]; agger: boolean }[] = []
  {
    const start = m.course.gates[0].i
    let run: number[][] = []
    let runAgger = false
    for (let k = 0; k <= N; k++) {
      const i = (start + k) % N
      if (nearGate(i, WALL.gate) || k === N) {
        if (run.length > 1) wall.push({ pts: run, agger: runAgger })
        run = []
        runAgger = false
        continue
      }
      const p = ring[i]
      run.push([
        round(p[0]),
        round(p[1]),
        round(sides[i].out),
        round(sides[i].in),
        round(walk[i]),
      ])
      runAgger ||= i >= a0 && i <= a1
    }
  }
  const gates = m.course.gates.map((gt) => ({
    name: gt.name,
    at: gt.at.map((v) => round(v)),
    out: outward(gt.i).map((v) => Math.round(v * 1e4) / 1e4),
    ground: round(sides[gt.i % N].mid),
    walk: round(walk[gt.i % N]),
    surveyed: gt.surveyed,
  }))
  // Towers along the agger, clear of its gates.
  const towers: { at: number[]; out: number[]; ground: number; walk: number }[] = []
  for (let i = a0; i <= a1; i += Math.round(WALL.tower / STEP_M)) {
    if (nearGate(i, WALL.gate + 16)) continue
    towers.push({
      at: ring[i].map((v) => round(v)),
      out: outward(i).map((v) => Math.round(v * 1e4) / 1e4),
      ground: round(sides[i].out),
      walk: round(walk[i]),
    })
  }
  // Where the wall and its agger lie: no house, street or tree on them. Inside, the
  // wall's own width and, on the agger, the bank behind it; outside, its foot and the
  // agger's ditch.
  const wallGrid = new SegmentGrid(
    ring.slice(0, N).map((p, i) => [p, pt(i + 1)] as [Pt, Pt]),
    40,
  )
  const aggerGrid = new SegmentGrid(
    ring.slice(a0, a1).map((p, i) => [p, ring[a0 + i + 1]] as [Pt, Pt]),
    40,
  )
  const aggerBack = WALL.thick / 2 + AGGER.top + AGGER.run * 0.7
  const aggerFront = WALL.thick / 2 + AGGER.berm + AGGER.ditch + 4
  const onWall = (p: Pt) => {
    const inside = inRing(p, m.circuit)
    if (wallGrid.nearest(p).d < WALL.thick / 2 + (inside ? WALL.clear : WALL.clearOut))
      return true
    return aggerGrid.nearest(p).d < (inside ? aggerBack : aggerFront)
  }
  // The same, as outlines the generated city (city.ts) keeps off: the wall's width,
  // and on the agger the bank behind it.
  const wallBands: Pt[][] = ring.slice(0, N).map((p, i) => {
    const q = pt(i + 1)
    const n = outward(i)
    const back = i >= a0 && i < a1 ? aggerBack - WALL.clear : WALL.thick / 2
    const front = WALL.thick / 2
    const mid: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
    const c: Pt = [
      mid[0] + (n[0] * (front - back)) / 2,
      mid[1] + (n[1] * (front - back)) / 2,
    ]
    return rect(
      c[0],
      c[1],
      front + back,
      Math.hypot(q[0] - p[0], q[1] - p[1]) + 1,
      Math.atan2(q[1] - p[1], q[0] - p[0]) - Math.PI / 2,
    )
  })
  // Known buildings on the wall's line: the build says so.
  for (const mo of monuments) {
    if (mo.clear === false || mo.kind === 'bridge') continue
    const hit = ring.find((q) => inRing(q, mo.rings[0]))
    if (hit) console.log(`model: the wall runs through ${mo.id}`)
  }

  // --- where the generated city may stand ------------------------------------------------
  const inCircuit = (x: number, y: number) => inRing([x, y], m.circuit)
  const streetGrid = new SegmentGrid(
    m.streets.flatMap((l) => l.pts.slice(1).map((q, i) => [l.pts[i], q] as [Pt, Pt])),
    40,
  )
  // Monuments standing from before the window keep houses off their sites for good;
  // later ones take their site from the houses in the year they were begun.
  const clearing = monuments.filter((mo) => mo.clear !== false)
  // So do those whose design says their site was open ground before them (`open`).
  const keptOpen = (mo: (typeof monuments)[number]) =>
    yearsOf(mo.id)[0] <= WINDOW[0] || mo.design?.d.open === true
  const early = clearing.filter(keptOpen)
  const late = clearing.filter((mo) => !keptOpen(mo))
  const inside = (p: Pt, mo: (typeof monuments)[number]) =>
    inRing(p, mo.rings[0]) && !mo.rings.slice(1).some((h) => inRing(p, h))
  const monumentGrid = new SegmentGrid(
    early
      .flatMap((mo) => mo.rings)
      .flatMap((r) => r.slice(1).map((q, i) => [r[i], q] as [Pt, Pt])),
    40,
  )
  const insideMonument = (p: Pt) => early.some((mo) => inside(p, mo))
  /** The last year a house at `p` stands: the year before a later monument took its site. */
  // A garden laid out within the window (Lucullus', Maecenas') takes the houses on
  // its ground when it comes, as a monument does.
  const laidOut = m.grounds.filter((gr) => gr.years[0] > WINDOW[0])
  const until = (pts: Pt[]) =>
    Math.min(
      100000,
      ...late
        .filter((mo) => pts.some((q) => inside(q, mo)))
        .map((mo) => yearsOf(mo.id)[0] - 1),
      ...laidOut
        .filter((gr) => pts.some((q) => inRing(q, gr.ring)))
        .map((gr) => gr.years[0] - 1),
    )
  /** The last year a tree at `q` stands: until a later monument takes the ground its crown spreads over. */
  const crownUntil = ([x, y]: Pt, r = 3) =>
    until([
      [x, y],
      [x + r, y],
      [x - r, y],
      [x, y + r],
      [x, y - r],
    ])
  /**
   * The first year a house at `pts` stands (DESIGN.md §7.7, "The city growing"). The
   * city inside the wall was full by 133 BCE: private houses of the 2nd century BCE
   * are found in every quarter excavated (SITAR), and Livy already has three-storey
   * blocks in 218 (21.62.3). So a lot inside the wall stands from before the window,
   * except where a source dates the building: `GROWTH`.
   */
  const since = (pts: Pt[], kind: number) => {
    const c: Pt = [
      pts.reduce((s, q) => s + q[0], 0) / pts.length,
      pts.reduce((s, q) => s + q[1], 0) / pts.length,
    ]
    const roll = hash2(c[0], c[1])
    let from = -100000
    for (const g of growth)
      if (g.kinds.includes(kind) && g.at(c) && roll < g.share) from = Math.max(from, g.from)
    return from
  }
  // Squares no house stands in: the Forum between its buildings, the Capitol's
  // precinct round its temple, and the Circus' arena (inside its outline already).
  const open: Pt[][] = []
  // Nobody lived on the Capitol's summits: "ne quis patricius in arce aut Capitolio
  // habitaret" (Livy 6.20.13), and in practice both were sacred ground — the Area
  // Capitolina, the Arx with its Auguraculum and Juno Moneta — and so was the Asylum
  // between them, "inter duos lucos"; houses climbed the slopes only (Platner & Ashby,
  // Arx and Asylum, p. 55; Tacitus, Histories 3.71).
  // The Forum Boarium, the cattle market by the river: its limits are not known, so
  // only the ground between its temples and the Ara Maxima is kept open (Platner &
  // Ashby, Forum Boarium, pp. 224–225).
  const boarium = [
    'aedes-portuni',
    'aedes-herculis-olivarii',
    'ara-maxima-herculis',
    'aedes-fortunae-foro-boario',
    'aedes-matris-matutae',
  ]
    .map((id) => m.places.get(id))
    .filter((p): p is Place => !!p)
    .map((p) => projection.forward(...p.location))
  if (boarium.length > 2) open.push(hull(boarium))
  const head = monuments.filter((mo) => FORUM_HEAD.includes(mo.id))
  if (head.length === FORUM_HEAD.length) open.push(hull(head.flatMap((mo) => mo.rings[0])))
  // Before a precinct's gateway the ground is kept open, so it does not open onto a
  // house: 20 m out, a little wider than the gate.
  for (const mo of monuments) {
    const d = mo.design
    const gate = (d?.d as Record<string, unknown> | undefined)?.gate as number | undefined
    if (!d || !gate || !d.bearing) continue
    const sides = ((d.d as Record<string, unknown>).sides as boolean[] | undefined) ?? [
      true,
      true,
      true,
      true,
    ]
    const f: Pt = [Math.sin(d.bearing), Math.cos(d.bearing)]
    const r: Pt = [f[1], -f[0]]
    // Each side left without a portico has the gate: front, right, back, left.
    const outs: Pt[] = [f, r, [-f[0], -f[1]], [-r[0], -r[1]]]
    const half = [d.size[1] / 2, d.size[0] / 2, d.size[1] / 2, d.size[0] / 2]
    sides.forEach((has, i) => {
      if (has) return
      const n = outs[i]
      const c: Pt = [
        d.centre[0] + n[0] * (half[i] + 10),
        d.centre[1] + n[1] * (half[i] + 10),
      ]
      open.push(rect(c[0], c[1], gate + 8, 20, Math.atan2(n[1], n[0]) - Math.PI / 2))
    })
  }
  // Each is the hilltop round its point: out to `r`, as far as the ground stays
  // within a few metres of the top, so the clearing follows the hill.
  for (const [c, r] of CAPITOL_OPEN) {
    const [cx, cy] = projection.forward(...c)
    let top = -Infinity
    for (let a = 0; a < 24; a++)
      for (let d = 0; d <= r; d += 4)
        top = Math.max(
          top,
          at(
            cx + Math.cos((a / 24) * Math.PI * 2) * d,
            cy + Math.sin((a / 24) * Math.PI * 2) * d,
          ),
        )
    open.push(
      Array.from({ length: 32 }, (_, k) => {
        const a = (k / 32) * Math.PI * 2
        let d = 12
        while (
          d < r &&
          at(cx + Math.cos(a) * (d + 3), cy + Math.sin(a) * (d + 3)) > top - 9
        )
          d += 3
        return [cx + Math.cos(a) * d, cy + Math.sin(a) * d] as Pt
      }),
    )
  }
  // What the city grew into within the window, by the sources (`GROWTH`).
  const capitolTops = open.slice(-CAPITOL_OPEN.length)
  const growth = GROWTH.map((g) => ({
    ...g,
    at:
      g.where === 'capitol-slopes'
        ? (p: Pt) =>
            inCircuit(p[0], p[1]) &&
            capitolTops.some((r) => !inRing(p, [...r, r[0]]) && distToRing(p, r) < g.reach)
        : (_p: Pt) => false,
  }))
  /**
   * The point a building faces: a temple in a forum faces into it, one on the Forum's
   * edge faces the Forum, and the Capitol's temple faces south, down to the city.
   */
  const forumMiddle: Pt | null = forumCore.length
    ? [
        forumCore.reduce((s, q) => s + q[0], 0) / forumCore.length,
        forumCore.reduce((s, q) => s + q[1], 0) / forumCore.length,
      ]
    : null
  const courts = monuments.filter((mo) => mo.kind === 'forum')
  const facing = (mo: (typeof monuments)[number]): Pt => {
    const c = mo.rings[0]
      .reduce((s, q) => [s[0] + q[0], s[1] + q[1]], [0, 0])
      .map((v) => v / mo.rings[0].length) as Pt
    if (mo.id === 'aedes-iovis-capitolini') return [c[0], c[1] - 500]
    const own = pointFacing.get(mo.id)
    if (own) return own
    const court = courts.find((f) => f !== mo && inRing(c, f.rings[0]))
    if (court) {
      const r = court.rings[0]
      return [
        r.reduce((s, q) => s + q[0], 0) / r.length,
        r.reduce((s, q) => s + q[1], 0) / r.length,
      ]
    }
    return forumMiddle ?? [c[0], c[1] - 100]
  }
  const isOpen = (p: Pt) =>
    (forumHull.length && inRing(p, [...forumHull, forumHull[0]])) ||
    open.some((o) => inRing(p, [...o, o[0]]))

  // The aqueducts (aqueducts.ts): their arcades and walls keep houses and trees off
  // their line.
  const aqueducts = COURSES.map((c) => ({ course: c, runs: layCourse(c, at) }))
  const aqueductGrid = new SegmentGrid(
    aqueducts.flatMap(({ runs }) =>
      runs
        .filter((r) => r.kind !== 'shafts')
        .flatMap((r) =>
          r.pts.slice(1).map((q, i) => [r.pts[i].slice(0, 2), q.slice(0, 2)] as [Pt, Pt]),
        ),
    ),
    40,
  )
  const bandOf: number[] = []
  const aqueductBands: Pt[][] = aqueducts.flatMap(({ course, runs }, n) =>
    runs
      .filter((r) => r.kind !== 'shafts')
      .flatMap((r) =>
        r.pts.slice(1).map((q, i) => {
          const [a, b] = [r.pts[i], q]
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
          bandOf.push(n)
          return rect(
            (a[0] + b[0]) / 2,
            (a[1] + b[1]) / 2,
            course.size.width + 6,
            L + 1,
            Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.PI / 2,
          )
        }),
      ),
  )

  const allowed = (p: Pt, suburb: boolean) => {
    if (aqueductGrid.nearest(p).d < 5) return false
    if (sample(m.water, p[0], p[1], -1) < 6) return false
    if (streetGrid.nearest(p).d < FABRIC.streetClear) return false
    if (monumentGrid.nearest(p).d < FABRIC.monumentClear || insideMonument(p)) return false
    if (isOpen(p)) return false
    if (onWall(p)) return false
    if (slopeAt(p[0], p[1]) > FABRIC.maxSlope) return false
    // Nothing is built in a grove or garden that stood through the window.
    if (m.grounds.some((gr) => gr.years[0] <= WINDOW[0] && inRing(p, gr.ring))) return false
    return suburb ? !inCircuit(p[0], p[1]) : inCircuit(p[0], p[1])
  }

  // --- the generated city ------------------------------------------------------------------
  const fabric: number[] = []
  /** Trees in gardens and groves, and the years they stand (a house's, its garden's). */
  const courtyardTrees: { at: Pt; years?: number[] }[] = []
  const placed = new SpatialHash(30)
  const [bx0, by0, bx1, by1] = bounds(m.circuit, SUBURB.reach + 20)
  const lot = (
    pts: Pt[],
    h: number,
    kind: number,
    roof: number,
    tone: number,
    from?: number,
  ) => {
    fabric.push(
      ...pts.slice(0, 4).flatMap(([x, y]) => [round(x), round(y)]),
      round(h),
      round(Math.min(...pts.map((c) => at(c[0], c[1])))),
      until(pts),
      kind,
      roof,
      Math.round(tone * 1000) / 1000,
      from ?? since(pts, kind),
    )
  }

  // Inside the wall: streets, blocks and lots (city.ts).
  const city = layCity({
    circuit: m.circuit,
    gates: m.course.gates.map((gt) => gt.at),
    streets: m.streets,
    pieces: excavatedPieces(),
    forum: forumCore,
    squares: open,
    monuments: [...early.map((mo) => mo.rings[0]), ...aqueductBands, ...wallBands],
    at,
    slopeAt,
    wet: (x, y) => sample(m.water, x, y, -1) < 6,
    toRiver: (x, y) => Math.min(...m.riverRings.map((r) => distToRing([x, y], r))),
    palatine: ((p) => p && projection.forward(...p.location))(
      m.places.get('mons-palatinus'),
    ),
    richQuarters: RICH_QUARTERS.map((id) => m.places.get(id))
      .filter((p): p is Place => !!p)
      .map((p) => projection.forward(...p.location)),
    rand,
  })
  // The city is laid out round the Forum proper, then cleared off the Comitium, so
  // the ground kept open there does not reshuffle the streets across the city.
  for (const l of city.lots)
    if (!l.pts.some((q) => isOpen(q))) lot(l.pts, l.h, l.kind, l.roof, l.tone)
  // A garden's tree stands as long as its house: a monument that takes the house's
  // site takes its garden too.
  for (const q of city.gardens)
    if (!isOpen(q))
      courtyardTrees.push({ at: q, years: [since([q], LOT_KIND.house), crownUntil(q)] })

  // Outside it the suburb (`GROWN`), built on the country's own plots (fields.ts): a
  // built plot has its building at the road end — a row of shops by the gates, a
  // house, a workshop, a farmstead further out — and a walled yard or garden behind
  // it, the rest of the plot left to its crop, so the buildings keep the plots' lines
  // and face the roads. In the Emporium, warehouses round courts on a grid of their
  // own. Each plot is built from the year its share of the zone passes its draw.
  const roadSegs = new Map<string, [Pt, Pt][]>()
  for (const l of m.streets.filter((l) => l.road))
    roadSegs.set(l.id, [
      ...(roadSegs.get(l.id) ?? []),
      ...l.pts.slice(1).map((q, i) => [l.pts[i], q] as [Pt, Pt]),
    ])
  const roadGrids = new Map(
    [...roadSegs].map(([id, segs]) => [id, new SegmentGrid(segs, 40)]),
  )
  const ringOf = (r: [number, number][]) => r.map((c) => projection.forward(...c))
  const areas = GROWN.areas.map((a) => ({ ...a, pts: ringOf(a.ring) }))
  const kept = GROWN.open.map(ringOf)
  const gateAt = new Map(m.course.gates.map((gt) => [gt.name, gt.at]))
  const bare = GROWN.bare.flatMap(({ gate, r }) => {
    const at = gateAt.get(gate)
    return at ? [{ at, r }] : []
  })
  const gatePts = m.course.gates.map((gt) => gt.at)
  const toGate = (p: Pt) =>
    Math.min(...gatePts.map((g) => Math.hypot(g[0] - p[0], g[1] - p[1])))
  /** How far from the wall, truly: its grid finds only what is near it. */
  const wallDistAt = (p: Pt) => {
    const d = wallGrid.nearest(p).d
    return d < Infinity ? d : distToRing(p, m.circuit)
  }
  /** Clear of every road and street by their drawn width and a margin, all along its outline. */
  const clearOfRoads = (ring: Pt[]) =>
    ring.every((a, k) => {
      const c = ring[(k + 1) % ring.length]
      const L = Math.hypot(c[0] - a[0], c[1] - a[1])
      for (let t = 0; t <= L; t += 2.5) {
        const q: Pt = [
          a[0] + ((c[0] - a[0]) * t) / (L || 1),
          a[1] + ((c[1] - a[1]) * t) / (L || 1),
        ]
        if (streetGrid.nearest(q).d < SUBURB.roadClear) return false
      }
      return true
    })
  const fits = (ring: Pt[]) =>
    ring.every((c) => allowed(c, true)) &&
    clearOfRoads(ring) &&
    !kept.some((k) => ring.some((c) => inRing(c, k)))
  /** A lot's corners, round from the front left, and whether it can stand. */
  const put = (
    ring: Pt[],
    h: number,
    kind: number,
    roof: number,
    from: number,
    tone: number,
  ) => {
    lot(ring, h, kind, roof, tone, from)
    const c: Pt = [
      ring.reduce((s, q) => s + q[0], 0) / 4,
      ring.reduce((s, q) => s + q[1], 0) / 4,
    ]
    placed.add(c, Math.hypot(ring[0][0] - ring[2][0], ring[0][1] - ring[2][1]) / 2)
  }
  const emporiumAngle = ((d) =>
    d?.bearing !== undefined
      ? -planeBearing(d.bearing, d.at ?? m.places.get('porticus-aemilia')!.location)
      : 0)(DESIGNS['porticus-aemilia'])

  // Which zone a plot's front is in, and its curve: an area, a road's stretch, or the
  // foot of the wall by a gate.
  const zoneOf = (p: Pt, iv: number) => {
    if (inCircuit(p[0], p[1])) return null
    if (kept.some((r) => inRing(p, r))) return null
    if (bare.some((b) => Math.hypot(b.at[0] - p[0], b.at[1] - p[1]) < b.r)) return null
    const area = areas.find((a) => inRing(p, a.pts))
    if (area) {
      if (area.kind === 'warehouse' || iv > 3) return null
      const edge = Math.min(1, distToRing(p, area.pts) / GROWN_EDGE)
      return { curve: area.curve, edge, kind: area.kind, fromWall: wallDistAt(p) }
    }
    if (iv > 0) return null
    let best: { id: string; d: number } | null = null
    for (const [id, grid] of roadGrids) {
      const d = grid.nearest(p).d
      if (d < SUBURB.road + 10 && (!best || d < best.d)) best = { id, d }
    }
    const fromWall = wallDistAt(p)
    if (best) {
      const stretches = GROWN.roads[best.id] ?? [
        [SUBURB.reach, [[-132, SUBURB.density[0]]]],
      ]
      const st = stretches.find(([out]) => fromWall < out)
      return st ? { curve: st[1], edge: 1, kind: 'road' as const, fromWall } : null
    }
    if (fromWall < SUBURB.wall && toGate(p) < GROWN.wall.near)
      return { curve: GROWN.wall.curve, edge: 1, kind: 'wall' as const, fromWall }
    return null
  }

  const seenPlot = new Set<string>()
  const [ux0, uy0, ux1, uy1] = bounds(
    m.circuit,
    Math.max(
      SUBURB.reach,
      ...Object.values(GROWN.roads).flatMap((r) => r.map(([o]) => o)),
    ) + 40,
  )
  for (let y = uy0; y < uy1; y += 6)
    for (let x = ux0; x < ux1; x += 6) {
      if (inCircuit(x, y)) continue
      const P = m.fields.plotAt([x, y])
      if (P.iv > 3 || seenPlot.has(P.key)) continue
      seenPlot.add(P.key)
      // The plot's frame: `a` along the road from its left edge, `b` back from the road.
      const U0 = P.iu * P.w - P.off
      const toWorld = (a: number, b: number): Pt => [
        P.foot[0] + P.dir[0] * (U0 + a) + P.n[0] * P.s * b,
        P.foot[1] + P.dir[1] * (U0 + a) + P.n[1] * P.s * b,
      ]
      const box = (a0: number, a1: number, b0: number, b1: number): Pt[] => [
        toWorld(a0, b0),
        toWorld(a1, b0),
        toWorld(a1, b1),
        toWorld(a0, b1),
      ]
      const front0 = P.iv * P.d
      const zone = zoneOf(toWorld(P.w / 2, front0 + SUBURB.roadClear + 4), P.iv)
      if (!zone || zone.edge <= 0) continue
      const draw = hash2(P.foot[0] + P.iu * 7.3 + P.iv * 1.9, P.foot[1] + P.iu * 3.1)
      // The shares are of tries about 10 m apart along the road; a plot's frontage is
      // about two of them, so it is built if either would be.
      const plotCurve = zone.curve.map(
        ([yr, sh]) => [yr, 1 - (1 - sh) ** 2] as [number, number],
      )
      const from = builtFrom(plotCurve, draw / zone.edge)
      if (from === null) continue
      const pick = hash2(x * 0.37 + 11, y * 0.53 - 7)
      const r = mulberry32(Math.floor(draw * 1e9))
      const inPlot = (ring: Pt[]) => ring.every((c) => m.fields.plotAt(c).key === P.key)
      // Its front: on the road's row, clear of the road; deeper rows, off their front.
      const b0 =
        P.iv === 0 ? SUBURB.roadClear + (zone.kind === 'road' ? 0.5 : r() * 3) : front0 + 2
      const bMax = front0 + P.d - 1
      const nearGate = toGate(toWorld(P.w / 2, b0)) < 320
      const type =
        zone.kind === 'town'
          ? pick < 0.55
            ? 'row'
            : 'house'
          : nearGate && P.iv === 0
            ? pick < 0.6
              ? 'row'
              : 'house'
            : zone.fromWall > 650
              ? pick < 0.45
                ? 'farm'
                : pick < 0.8
                  ? 'house'
                  : 'workshop'
              : pick < 0.62
                ? 'house'
                : 'workshop'
      const tone = r()
      const parts: [Pt[], number, number, number][] = []
      if (type === 'row') {
        // Shops with rooms over them, the plot's whole frontage, so neighbours make a row.
        const depth = 9 + r() * 4
        const storeys = zone.kind === 'town' || r() < 0.4 ? 2 : 1
        parts.push([
          box(0.25, P.w - 0.25, b0, b0 + depth),
          3.8 + 3 * storeys,
          LOT_KIND.flats,
          ROOF.along,
        ])
        const yd = 6 + r() * 6
        if (b0 + depth + yd < bMax)
          parts.push([
            box(0.6, P.w - 0.6, b0 + depth, b0 + depth + yd),
            1.9,
            LOT_KIND.yard,
            ROOF.flat,
          ])
      } else if (type === 'house') {
        const bw = Math.min(P.w - 2, P.w * (0.55 + r() * 0.35))
        const a0 = 1 + r() * (P.w - 2 - bw)
        const depth = 10 + r() * 6
        const h = r() < 0.35 ? 6.8 + r() * 0.6 : 4.2 + r() * 1.2
        const rr = r()
        const roof =
          rr < 0.55 ? ROOF.along : rr < 0.8 ? ROOF.across : rr < 0.9 ? ROOF.lean : ROOF.flat
        parts.push([box(a0, a0 + bw, b0, b0 + depth), h, LOT_KIND.suburb, roof])
        // A wing at the back, at one side, a storey lower: the plan an L.
        if (r() < 0.4 && bw > 9) {
          const ww = 4 + r() * 2.5
          const left = r() < 0.5
          const [wa0, wa1] = left ? [a0, a0 + ww] : [a0 + bw - ww, a0 + bw]
          const wd = 6 + r() * 5
          parts.push([
            box(wa0, wa1, b0 + depth, b0 + depth + wd),
            Math.max(3.8, h - 2.6),
            LOT_KIND.suburb,
            ROOF.lean,
          ])
        }
        const gd = 10 + r() * 10
        if (b0 + depth + gd < bMax)
          parts.push([
            box(0.8, P.w - 0.8, b0 + depth, b0 + depth + gd),
            1.8,
            LOT_KIND.garden,
            ROOF.flat,
          ])
      } else if (type === 'workshop') {
        const bw = 6 + r() * 4
        const left = r() < 0.5
        const [a0, a1] = left ? [1, 1 + bw] : [P.w - 1 - bw, P.w - 1]
        const depth = 7 + r() * 4
        parts.push([
          box(a0, a1, b0, b0 + depth),
          4 + r(),
          LOT_KIND.suburb,
          r() < 0.5 ? ROOF.lean : ROOF.along,
        ])
        const yd = 12 + r() * 8
        const [ya0, ya1] = left ? [1 + bw, P.w - 0.8] : [0.8, P.w - 1 - bw]
        if (ya1 - ya0 > 4)
          parts.push([
            box(ya0, ya1, b0, b0 + Math.min(yd, bMax - b0)),
            1.9,
            LOT_KIND.yard,
            ROOF.flat,
          ])
      } else {
        // A farmstead: ranges round a yard, square to the plot (Varro 1.13), set back.
        const fb = b0 + 6 + r() * 6
        const fw = Math.min(P.w - 2, 18 + r() * 8)
        const fa = (P.w - fw) / 2
        const fd = 16 + r() * 8
        const rd = 5.5 + r()
        const h = 4 + r() * 1.2
        parts.push([box(fa, fa + fw, fb, fb + rd), h + 1.2, LOT_KIND.suburb, ROOF.along])
        parts.push([box(fa, fa + rd, fb + rd, fb + fd), h, LOT_KIND.suburb, ROOF.lean])
        if (r() < 0.7)
          parts.push([
            box(fa + fw - rd, fa + fw, fb + rd, fb + fd),
            h,
            LOT_KIND.suburb,
            ROOF.lean,
          ])
        parts.push([
          box(fa + rd, fa + fw - rd, fb + rd, fb + fd),
          1.9,
          LOT_KIND.yard,
          ROOF.flat,
        ])
      }
      // The buildings first: if they cannot stand, nothing does; a yard that cannot, goes.
      const buildings = parts.filter((q) => q[2] < LOT_KIND.yard)
      // The plots do not overlap, so only the plot, the ground and the roads decide.
      const ok = (ring: Pt[]) => inPlot(ring) && fits(ring)
      if (!buildings.length || !buildings.every(([ring]) => ok(ring))) continue
      for (const [ring, h, kind, roof] of parts)
        if (kind < LOT_KIND.yard || ok(ring)) put(ring, h, kind, roof, from, tone)
    }

  // The Emporium (DESIGN.md §7.7): a grid of blocks square to the Porticus Aemilia, a
  // street between each, a block one cell or two, each built as one of the kinds of
  // building a river port's warehouse quarter had — on the Marble Plan and at Ostia:
  // storerooms round a court, one or two (the Horrea Galbana has three); a long range
  // of storerooms on the street; two ranges back to back along a corridor; an open
  // yard for timber or stone, walled, with a shed ("inter lignarios", the timber
  // merchants' quarter by the Porta Trigemina, Livy 35.41.10); and a merchant's house
  // with shops on the street. Which, and how big, is generated.
  const emporium = areas.find((a) => a.kind === 'warehouse')
  if (emporium) {
    const [ex, ey] = [
      emporium.pts.reduce((s, q) => s + q[0], 0) / emporium.pts.length,
      emporium.pts.reduce((s, q) => s + q[1], 0) / emporium.pts.length,
    ]
    const [ca, sa] = [Math.cos(emporiumAngle), Math.sin(emporiumAngle)]
    const { cell, deep, street } = HORREA
    const taken = new Set<string>()
    for (let j = -16; j <= 16; j++)
      for (let i = -24; i <= 24; i++) {
        if (taken.has(`${i},${j}`)) continue
        const r = mulberry32(i * 1000 + j * 7 + 99)
        // Some blocks take the next cell along too.
        const span = r() < 0.35 && !taken.has(`${i + 1},${j}`) ? 2 : 1
        const w = cell * span + street * (span - 1)
        const d = deep
        const [u, v] = [i * (cell + street) + (w - cell) / 2, j * (deep + street)]
        const c: Pt = [ex + ca * u - sa * v, ey + sa * u + ca * v]
        if (!inRing(c, emporium.pts)) continue
        const edge = Math.min(1, distToRing(c, emporium.pts) / GROWN_EDGE)
        // The area's shares were of the old blocks, about two of these cells: a cell is
        // built if either would be, as a plot is.
        const from = builtFrom(
          emporium.curve.map(([yr, sh]) => [yr, 1 - (1 - sh) ** 2] as [number, number]),
          hash2(i * 13.1 + 5, j * 7.7 - 3) / Math.max(edge, 1e-3),
        )
        if (from === null) continue
        const at = (a: number, b: number): Pt => [
          c[0] + ca * a - sa * b,
          c[1] + sa * a + ca * b,
        ]
        // A box in the block's frame: `a` along the street, `b` across, from its middle.
        const box = (a0: number, a1: number, b0: number, b1: number): Pt[] => [
          at(a0, b0),
          at(a1, b0),
          at(a1, b1),
          at(a0, b1),
        ]
        // Each block stands back a little from its street, by its own amount.
        const [sw, sd] = [w - r() * 4, d - r() * 5]
        const whole = box(-sw / 2, sw / 2, -sd / 2, sd / 2)
        if (!fits(whole) || placed.near(c, Math.hypot(sw, sd) / 2)) continue
        for (let k = 0; k < span; k++) taken.add(`${i + k},${j}`)
        const tone = r()
        const storeys = r() < 0.4 ? 2 : 1
        const h = storeys === 2 ? 7.5 + r() * 1.5 : 4.8 + r() * 1.2
        const rd = 5.5 + r() * 3
        const [A, B] = [sw / 2, sd / 2]
        const add = (ring: Pt[], hh: number, kind: number, roof: number) =>
          put(ring, hh, kind, roof, from, tone)
        const pick = r()
        if (pick < 0.4) {
          // Storerooms round a court, or two courts with a range between them.
          add(box(-A, A, -B, -B + rd), h, LOT_KIND.warehouse, ROOF.along)
          add(box(-A, A, B - rd, B), h, LOT_KIND.warehouse, ROOF.along)
          add(box(-A, -A + rd, -B + rd, B - rd), h, LOT_KIND.warehouse, ROOF.across)
          add(box(A - rd, A, -B + rd, B - rd), h, LOT_KIND.warehouse, ROOF.across)
          if (sw > 40) {
            add(box(-rd / 2, rd / 2, -B + rd, B - rd), h, LOT_KIND.warehouse, ROOF.across)
            add(box(-A + rd, -rd / 2, -B + rd, B - rd), 0.3, LOT_KIND.yard, ROOF.flat)
            add(box(rd / 2, A - rd, -B + rd, B - rd), 0.3, LOT_KIND.yard, ROOF.flat)
          } else add(box(-A + rd, A - rd, -B + rd, B - rd), 0.3, LOT_KIND.yard, ROOF.flat)
        } else if (pick < 0.6) {
          // Two ranges back to back along a corridor open to the sky.
          const cw = 3 + r() * 2
          add(box(-A, A, -B, -cw / 2), h, LOT_KIND.warehouse, ROOF.along)
          add(box(-A, A, cw / 2, B), h, LOT_KIND.warehouse, ROOF.along)
          add(box(-A, A, -cw / 2, cw / 2), 0.3, LOT_KIND.yard, ROOF.flat)
        } else if (pick < 0.75) {
          // A long range of storerooms on the street, its yard behind.
          const dd = Math.min(sd - 6, 8 + r() * 4)
          add(box(-A, A, -B, -B + dd), h, LOT_KIND.warehouse, ROOF.lean)
          add(box(-A + 0.6, A - 0.6, -B + dd, B), 1.9, LOT_KIND.yard, ROOF.flat)
        } else if (pick < 0.9) {
          // An open yard, walled, a shed along one side and a lodge at its gate.
          const side = r() < 0.5 ? -1 : 1
          add(box(-A, A, -B, B), 2.2, LOT_KIND.yard, ROOF.flat)
          const sh = 5 + r() * 2
          add(
            box(
              -A + 1,
              A - 1,
              side < 0 ? -B + 1 : B - 1 - sh,
              side < 0 ? -B + 1 + sh : B - 1,
            ),
            4 + r(),
            LOT_KIND.warehouse,
            ROOF.lean,
          )
          const lw = 5 + r() * 3
          add(box(-A + 1, -A + 1 + lw, -sh / 2, sh / 2), 4.5, LOT_KIND.suburb, ROOF.along)
        } else {
          // A merchant's house, shops on the street, a court behind.
          const dd = 10 + r() * 3
          add(box(-A, A, -B, -B + dd), 6.8 + r() * 3, LOT_KIND.flats, ROOF.along)
          add(box(-A + 0.6, A - 0.6, -B + dd, B), 1.9, LOT_KIND.garden, ROOF.flat)
        }
      }
  }

  // --- tombs along the roads ------------------------------------------------------------
  // No one was buried or burned in the city (the Twelve Tables, in Cicero, Laws 2.58),
  // so the roads out of it were lined with tombs, thickest near the gates (Purcell
  // 1987). Generated, like the houses: an altar on its base, a façade with a door, or
  // a drum under a mound of earth, the forms the known tombs take (designs.ts), each
  // facing the road a few metres back from it.
  const roadTombs: Record<string, unknown>[] = []
  const reachOk = (p: Pt) => sample(m.reach, p[0], p[1], 1e9) < m.reachM - 150
  for (const l of m.streets.filter((s) => s.road)) {
    for (let k = 0; k + 1 < l.pts.length; k++) {
      const [a, b] = [l.pts[k], l.pts[k + 1]]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      const [ux, uy] = [(b[0] - a[0]) / (L || 1), (b[1] - a[1]) / (L || 1)]
      for (let t = 0; t < L; t += TOMBS.step)
        for (const side of [-1, 1]) {
          const on: Pt = [a[0] + ux * t, a[1] + uy * t]
          const fromWall = distToRing(on, m.circuit)
          if (inCircuit(on[0], on[1]) || fromWall < TOMBS.from || fromWall > TOMBS.reach)
            continue
          // The tombs stood thickest at the end of the window (`GROWN.tombs`): the most
          // there were, a fifth more than the curve's ×1.0 of about 45 BCE.
          if (rand() > 1.2 * TOMBS.density * Math.exp(-fromWall / TOMBS.fall)) continue
          const from = builtFrom(GROWN.tombs, rand()) ?? -26
          // Altars on their dados and façades throughout; the drums under their mounds
          // only from about 50 BCE (the Salaria's, Cornelia's of about 40–30, the
          // Casa Tonda: SITAR; DAR).
          const r = rand()
          const form = r < 0.55 ? 'altar' : r < 0.8 || from < -49 ? 'facade' : 'drum'
          const w = form === 'drum' ? 6 + rand() * 7 : 2.6 + rand() * 2.4
          const d = form === 'drum' ? w : 2.6 + rand() * 2.6
          const h =
            form === 'drum'
              ? 2.5 + rand() * 2
              : form === 'altar'
                ? 2.2 + rand() * 1.8
                : 4 + rand() * 2.5
          const back = TOMBS.roadHalf + TOMBS.gap + d / 2 + rand() * 3
          const c: Pt = [on[0] - uy * side * back, on[1] + ux * side * back]
          // Its front to the road: across it, towards the road's line.
          const angle = Math.atan2(uy, ux)
          const corners = rect(c[0], c[1], w + 1, d + 1, angle)
          if (!reachOk(c) || !corners.every((q) => allowed(q, true)) || !allowed(c, true))
            continue
          const rr = Math.hypot(w, d) / 2
          if (placed.near(c, rr + 1.5)) continue
          placed.add(c, rr)
          // Tufa and peperino under stucco at first; travertine more often from about
          // 50 BCE (SITAR's early tombs are peperino and tufa dado tombs).
          const stone =
            rand() < (from < -79 ? 0.1 : from < -49 ? 0.2 : 0.35) ? 'travertine' : 'stucco'
          roadTombs.push({
            model: 'tomb',
            form,
            h: round(h),
            centre: [round(c[0]), round(c[1])],
            size: [round(w), round(d)],
            // Radians clockwise from north, as designs.ts has it.
            bearing: round(Math.atan2(uy * side, -ux * side), 1000),
            base: round(Math.min(...corners.map((q) => at(q[0], q[1])))),
            stone,
            // The first year it stands.
            from,
          })
        }
    }
  }

  // --- farmsteads ----------------------------------------------------------------------
  // Out in the farmland, a farmhouse here and there: ranges round a yard, as Varro
  // lays out a farm's buildings (On Agriculture 1.13), square to its plot's rows.
  // Generated, like the houses.
  const FARM_USES = new Set([2, 3, 5, 6, 7, 8])
  for (let y = by0 - 1500; y < by1 + 1500; y += FARMS.spacing)
    for (let x = bx0 - 1500; x < bx1 + 1500; x += FARMS.spacing) {
      const c: Pt = [
        x + (rand() - 0.5) * FARMS.spacing * 0.8,
        y + (rand() - 0.5) * FARMS.spacing * 0.8,
      ]
      if (rand() > FARMS.share || !reachOk(c)) continue
      const fromWall = distToRing(c, m.circuit)
      if (fromWall < FARMS.from || fromWall > FARMS.reach) continue
      const i = idx(c[0], c[1])
      if (i < 0 || !FARM_USES.has(m.fields.use[i]) || m.fields.edge[i] < 3) continue
      const angle = m.fields.angle(i)
      const [ca, sa] = [Math.cos(angle), Math.sin(angle)]
      const at2 = (u: number, v: number): Pt => [
        c[0] + u * ca - v * sa,
        c[1] + u * sa + v * ca,
      ]
      // The house across the back of the yard, a barn and a byre down its sides.
      const yard = 12 + rand() * 6
      const ranges = [
        { u: 0, v: yard / 2 + 3.5, w: yard + 14, d: 7, h: 6 + rand() * 1.5 },
        { u: -(yard / 2 + 3.5), v: 0, w: 7, d: yard, h: 4.5 + rand() },
        { u: yard / 2 + 3.5, v: 0, w: 7, d: yard, h: 4.5 + rand() },
      ].filter((_, k) => k === 0 || rand() < 0.75)
      const rects = ranges.map((r) => rect(...at2(r.u, r.v), r.w, r.d, angle))
      if (!rects.every((q) => q.every((p) => allowed(p, true)))) continue
      const rr = yard / 2 + 12
      if (placed.near(c, rr)) continue
      placed.add(c, rr)
      const tone = rand()
      ranges.forEach((r, k) => lot(rects[k], r.h, LOT_KIND.suburb, ROOF.along, tone))
    }

  // --- trees -------------------------------------------------------------------------------
  // x, y, radius, ground, kind (fields.ts `TREE`), and the years it stands.
  const trees: number[] = []
  const tree = (x: number, y: number, r: number, kind: number, years = [-100000, 100000]) =>
    trees.push(round(x), round(y), round(r), round(at(x, y)), kind, years[0], years[1])
  for (const t of fieldTrees(
    m.fields,
    g,
    m.reach,
    m.reachM - 150,
    m.grounds,
    m.circuit,
    (p, inCity) =>
      (inCity || !inCircuit(p[0], p[1])) &&
      sample(m.water, p[0], p[1], -1) >= 10 &&
      !placed.near(p, 8) &&
      aqueductGrid.nearest(p).d >= 8 &&
      streetGrid.nearest(p).d >= 6 &&
      monumentGrid.nearest(p).d >= 10 &&
      !insideMonument(p) &&
      !onWall(p),
  ))
    // Until a monument begun within the window takes its ground, as a house does.
    tree(t.x, t.y, t.r, t.kind, [
      t.years[0],
      Math.min(t.years[1], crownUntil([t.x, t.y], t.r)),
    ])
  const TREE_STRIDE = 7

  // --- shadows on the board ------------------------------------------------------------------
  // Each footprint swept away from the sun by its height, filled on the plate's grid
  // with 2×2 samples a texel and softened, so the board carries the model's shadows.
  const shadow = new Float32Array(g.width * g.height)
  const cast = (foot: Pt[], h: number) => {
    const L = h * SHADOW.vex
    const swept = hull([
      ...foot,
      ...foot.map(([x, y]) => [x + SHADOW.dx * L, y + SHADOW.dy * L] as Pt),
    ])
    fill(shadow, g, [...swept, swept[0]])
  }
  // Only what stands through the whole window casts one: the shadow is baked, and
  // would outlast a house or come before a monument.
  for (let i = 0; i < fabric.length; i += FABRIC_STRIDE) {
    if (fabric[i + 10] < WINDOW[1] || fabric[i + 14] > WINDOW[0]) continue
    // A yard's or garden's low wall casts no shadow worth baking.
    if (fabric[i + 11] >= LOT_KIND.yard) continue
    const f = fabric.slice(i, i + 8)
    cast(
      [0, 2, 4, 6].map((k) => [f[k], f[k + 1]] as Pt),
      fabric[i + 8] + 2,
    )
  }
  for (const mo of early)
    if (yearsOf(mo.id)[1] >= WINDOW[1]) cast(mo.rings[0].slice(0, -1), mo.podium + mo.body)
  for (const w of wall)
    for (let k = 0; k + 1 < w.pts.length; k++) {
      const [p, q] = [w.pts[k], w.pts[k + 1]]
      cast(
        [p.slice(0, 2) as Pt, q.slice(0, 2) as Pt],
        Math.max(p[4], q[4]) + WALL.parapet - Math.min(p[2], q[2]),
      )
    }
  for (const t of roadTombs) {
    const [cx, cy] = t.centre as Pt
    const [w, d] = t.size as Pt
    cast(rect(cx, cy, w, d, -(t.bearing as number)).slice(0, 4), t.h as number)
  }
  for (let i = 0; i < trees.length; i += TREE_STRIDE) {
    const [x, y, r] = trees.slice(i, i + 3)
    // Only what stands through the whole window casts a baked shadow (above).
    if (trees[i + 5] > WINDOW[0] || trees[i + 6] < WINDOW[1]) continue
    cast(
      [0, 1, 2, 3, 4, 5].map(
        (k) => [x + Math.cos(k * 1.047) * r, y + Math.sin(k * 1.047) * r] as Pt,
      ),
      r * 2.6,
    )
  }
  const soft = blur(shadow, g.width, g.height, 0.8)

  for (const g of ASYLUM_GROVES) {
    const [gx, gy] = projection.forward(...g)
    for (let k = 0; k < 9; k++) {
      const a = k * 2.4
      const rr = 3 + (k % 3) * 5
      courtyardTrees.push({ at: [gx + Math.cos(a) * rr, gy + Math.sin(a) * rr] })
    }
  }
  const fab = new Float32Array(fabric)
  for (const {
    at: [x, y],
    years,
  } of courtyardTrees)
    tree(x, y, 2.5 + rand() * 1.5, TREE.mixed, years)
  const tre = new Float32Array(trees)
  // Where the bridges land on the Tiber Island, so its embankment opens for them: each
  // bridge end on its shore, the way onto the island, and half the deck's width, from
  // the bridge's first year. A phase of the island's design for each, carrying the
  // landings standing by then.
  const landings: { from: number; at: Pt; onto: Pt; half: number }[] = []
  if (shoreAt >= 0) {
    const shore = m.riverRings[shoreAt]
    for (const mo of monuments) {
      if (mo.kind !== 'bridge' || !mo.design) continue
      const { centre, size, axis } = mo.design
      for (const s of [-1, 1]) {
        const at: Pt = [
          centre[0] + (axis[0] * s * size[1]) / 2,
          centre[1] + (axis[1] * s * size[1]) / 2,
        ]
        if (distToRing(at, shore) > 6) continue
        const onto: Pt = [axis[0] * s, axis[1] * s]
        if (!inRing([at[0] + onto[0] * 8, at[1] + onto[1] * 8], shore)) continue
        const from = dates(m.places.get(mo.id)).years[0]
        landings.push({ from, at: [round(at[0]), round(at[1])], onto, half: size[0] / 2 })
      }
    }
  }
  const landingPhases = (phases: ({ from: number } & Record<string, unknown>)[]) => {
    const standing = (y: number) => landings.filter((l) => l.from <= y)
    const froms = [
      ...new Set([...phases.map((ph) => ph.from), ...landings.map((l) => l.from)]),
    ]
    return {
      phases: froms
        .sort((a, b) => a - b)
        .map((from) => ({
          ...Object.assign({}, ...phases.filter((ph) => ph.from <= from)),
          from,
          landings: standing(from),
        })),
    }
  }
  const bin = Buffer.concat([Buffer.from(fab.buffer), Buffer.from(tre.buffer)])
  writeFileSync(join(m.out, 'model.bin'), bin)
  writeFileSync(
    join(m.out, 'model.json'),
    JSON.stringify({
      _comment:
        'The model of Rome (pipeline/src/rome/model.ts). Plane metres; heights are ground metres above sea level, before the terrain’s vertical exaggeration. model.bin: fabric (its lot’s corners: front left, front right, back right, back left, x and y each; wall height; base; the last year it stands; kind; roof; its building’s tone; the first year it stands) × fabricCount, then trees (x, y, radius, base, kind, first year, last year) × treeCount, float32.',
      waterLevel: round(waterLevel),
      fabricCount: fab.length / FABRIC_STRIDE,
      treeCount: tre.length / TREE_STRIDE,
      river: m.riverRings.map((r) => r.map(([x, y]) => [round(x), round(y)])),
      monuments: monuments.map((mo) => ({
        ...mo,
        rings: mo.rings.map((r) => r.map(([x, y]) => [round(x), round(y)])),
        base: round(mo.base),
        faces: facing(mo).map((v) => round(v)),
        ...dates(m.places.get(mo.id)),
        stone: STONE_OF[mo.id]?.map(({ from, stone }) => ({ from, stone })),
        design: mo.design && {
          ...placedDesign(mo.design, facing(mo)),
          ...mo.extra,
          ...(mo.kind === 'island' && landingPhases(mo.design.d.phases ?? [])),
          // The water's surface over its ground, for what stands in the river.
          water: round(waterLevel - mo.base),
        },
      })),
      // The tombs along the roads, generated: designs as designs.ts gives them.
      roadTombs,
      // The Servian Wall (`WALL`): its curtain in runs between the gates, each point
      // x, y, the ground outside and inside its faces and its walk; its gates, each
      // with the way out of the city; the agger's towers; and its build.
      wall,
      gates,
      towers,
      wallBuild: WALL,
      // The retaining walls round the levelled sites: each a line along its edge at the
      // site's level, with the wall's height at each point, and its monument's years.
      retaining,
      // The aqueducts, laid out (aqueducts.ts): each channel's years, bottom to top,
      // and the course in runs of arcade, wall and shafts.
      aqueducts: aqueducts.map(({ course, runs }) => ({
        id: course.id,
        size: course.size,
        channels: course.channels.map((ch) => {
          const { burnt: _burnt, spans: _spans, ...d } = dates(m.places.get(ch.id))
          const from = Math.max(d.years[0], ch.from ?? -Infinity)
          return { id: ch.id, h: ch.h, years: [from, d.years[1]], unfinished: d.unfinished }
        }),
        runs: runs.map((r) => ({
          kind: r.kind,
          pts: r.pts.map((q) => q.map((v) => round(v))),
        })),
      })),
      // The generated streets, for reference: the main streets and the local ones.
      streets: {
        main: city.mains.map((l) => l.map(([x, y]) => [round(x), round(y)])),
        local: city.locals.map((l) => l.map(([x, y]) => [round(x), round(y)])),
      },
    }),
  )
  console.log(
    `model: ${monuments.length} buildings known, ${city.mains.length} main streets and ${city.locals.length} local ones generated, ${city.blocks} blocks, ${fab.length / FABRIC_STRIDE} buildings, ${tre.length / TREE_STRIDE} trees, the wall in ${wall.length} runs with ${gates.length} gates and ${towers.length} towers, water at ${waterLevel.toFixed(1)} m`,
  )
  // The footprints drawn for monuments with no surveyed outline, for picking.
  // The wall is picked along its course: a band its width, out one side and back.
  const wallPick: Pt[] = [
    ...ring.slice(0, N).map((p, i) => {
      const n = outward(i)
      return [p[0] + n[0] * face, p[1] + n[1] * face] as Pt
    }),
    ...ring
      .slice(0, N)
      .map((p, i) => {
        const n = outward(i)
        return [p[0] - n[0] * face, p[1] - n[1] * face] as Pt
      })
      .reverse(),
  ]
  const drawn = [
    ...monuments.filter((mo) => mo.approx).map((mo) => ({ id: mo.id, ring: mo.rings[0] })),
    ...(m.places.has('murus-servii-tullii')
      ? [{ id: 'murus-servii-tullii', ring: [...wallPick, wallPick[0]] }]
      : []),
    // An aqueduct's arcade opens the aqueduct it was built for.
    ...aqueducts.flatMap(({ course }, n) =>
      aqueductBands
        .filter((_, k) => bandOf[k] === n)
        .map((ring) => ({ id: course.id, ring })),
    ),
  ]
  // The footprints the streets are kept off (plate.ts): the known buildings, but not
  // the bridges and the island they cross, nor the open squares.
  const covered = monuments
    .filter(
      (mo) =>
        mo.clear !== false &&
        mo.kind !== 'bridge' &&
        mo.design?.d.model !== 'square' &&
        mo.design?.d.model !== 'quay',
    )
    .map((mo) => mo.rings[0])
  // The Forum's square, painted on the board (plate.ts): its outline, its paving by
  // year, and its length, from Caesar's rostra to his temple, which face each other
  // down it; its slabs are laid along it.
  const [ra, dv] = [m.places.get('rostra'), m.places.get('aedes-divi-iulii')].map(
    (p) => p && projection.forward(...p.location),
  )
  const length = ra && dv ? Math.atan2(dv[1] - ra[1], dv[0] - ra[0]) : 0
  const square = forumHull.length > 2 && {
    ring: [...forumHull, forumHull[0]],
    paving: FORUM_PAVING,
    axis: [Math.cos(length), Math.sin(length)] as Pt,
  }
  return { png, waterLevel, shadow: soft, drawn, mains: city.mains, covered, square }
}

/** ground.png: heights in centimetres, high byte red, low byte green. */
export async function writeGround(
  out: string,
  png: Uint8Array,
  width: number,
  height: number,
) {
  await sharp(png, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(join(out, 'ground.png'))
}

/**
 * When a monument stands in the model: its years, and each span within them when it
 * was building or lay burnt (the conditions that are not `standing`), in order, with
 * what works rebuilding it kept of it; the engine builds each (buildModel.ts). The
 * aqueducts' channels take the spans run together (`unfinished`). Astronomical years.
 * A building may be part-built more than once in the window — the Capitol's temple
 * standing, burnt in 83 BCE, rising again and dedicated in 69 — and each spell is its own.
 */
function dates(p: Place | undefined) {
  if (!p) return { years: [-10000, 10000], unfinished: null, burnt: false, spans: [] }
  const weak = p.condition.filter((c) => c.value !== 'standing')
  return {
    years: [p.from.year, p.to.year],
    unfinished: weak.length
      ? [Math.min(...weak.map((c) => c.from.year)), Math.max(...weak.map((c) => c.to.year))]
      : null,
    // A shell left by fire, not works in progress, when fire is all it suffered.
    burnt: weak.length > 0 && weak.every((c) => c.value === 'burnt'),
    spans: weak
      .map((c) => ({
        kind:
          c.value === 'burnt'
            ? 'burnt'
            : c.value === 'being finished'
              ? 'finishing'
              : 'works',
        years: [c.from.year, c.to.year],
        ...(c.kept && { kept: c.kept }),
      }))
      .sort((x, y) => x.years[0] - y.years[0]),
  }
}

/**
 * A design as the engine takes it (buildModel.ts `Monument.design`): its own fields, and
 * where it stands — centre and size in plane metres, and the way its front faces,
 * radians clockwise from north: the design's, or its axis towards the point it
 * faces (`facing`).
 */
function placedDesign(
  p: { d: Design; centre: Pt; size: Pt; bearing: number | null; axis: Pt; drop: number },
  faces: Pt,
) {
  const {
    why: _,
    at: __,
    size: ___,
    bearing: ____,
    atLocal: _____,
    level: ______,
    ...fields
  } = p.d
  let bearing = p.bearing
  if (bearing === null) {
    const toward =
      (faces[0] - p.centre[0]) * p.axis[0] + (faces[1] - p.centre[1]) * p.axis[1]
    const s = toward < 0 ? -1 : 1
    bearing = Math.atan2(p.axis[0] * s, p.axis[1] * s)
  }
  return {
    ...fields,
    centre: p.centre.map((v) => round(v)),
    size: p.size.map((v) => round(v)),
    bearing: Math.round(bearing * 1e4) / 1e4,
    // How far its foundations run below its ground to the lowest ground under it.
    drop: round(p.drop),
  }
}

// --- geometry helpers ---------------------------------------------------------------------

function ringArea(r: Pt[]) {
  let s = 0
  for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
  return s / 2
}

/** The smallest rectangle round a ring, by its edges' directions: centre, its long axis (a unit vector), and its sides. */
function orientedBox(r: Pt[]) {
  let best = { area: Infinity, cx: 0, cy: 0, axis: [0, 1] as Pt, long: 0, short: 0 }
  for (let i = 0; i + 1 < r.length; i++) {
    const a = Math.atan2(r[i + 1][1] - r[i][1], r[i + 1][0] - r[i][0])
    const [c, s] = [Math.cos(a), Math.sin(a)]
    const us = r.map(([x, y]) => x * c + y * s)
    const vs = r.map(([x, y]) => -x * s + y * c)
    const [u0, u1, v0, v1] = [
      Math.min(...us),
      Math.max(...us),
      Math.min(...vs),
      Math.max(...vs),
    ]
    const area = (u1 - u0) * (v1 - v0)
    if (area < best.area) {
      const [mu, mv] = [(u0 + u1) / 2, (v0 + v1) / 2]
      const alongU = u1 - u0 >= v1 - v0
      best = {
        area,
        cx: mu * c - mv * s,
        cy: mu * s + mv * c,
        axis: alongU ? [c, s] : [-s, c],
        long: Math.max(u1 - u0, v1 - v0),
        short: Math.min(u1 - u0, v1 - v0),
      }
    }
  }
  return best
}

const round = (v: number, k = 10) => Math.round(v * k) / k

/**
 * A design's footprint: its box, `size` across and along round `centre`, with the
 * shops behind its porticoes on the sides it has them (front, right, back, left).
 */
function footprint(d: Design, centre: Pt, size: Pt, axis: Pt) {
  const right: Pt = [axis[1], -axis[0]]
  const shops = (d as { shops?: { depth: number; sides: boolean[] } }).shops
  const margin = [0, 1, 2, 3].map((i) => (shops?.sides[i] ? shops.depth : 0))
  const [du, dv] = [(margin[1] - margin[3]) / 2, (margin[0] - margin[2]) / 2]
  const [w, l] = [size[0] + margin[1] + margin[3], size[1] + margin[0] + margin[2]]
  const mid: Pt = [
    centre[0] + right[0] * du + axis[0] * dv,
    centre[1] + right[1] * du + axis[1] * dv,
  ]
  return {
    mid,
    w,
    l,
    ring: rect(mid[0], mid[1], w, l, Math.atan2(axis[1], axis[0]) - Math.PI / 2),
  }
}

function rect(cx: number, cy: number, w: number, d: number, angle: number): Pt[] {
  const [c, s] = [Math.cos(angle), Math.sin(angle)]
  const pts: Pt[] = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c])
  return [...pts, pts[0]]
}

function inRing([x, y]: Pt, ring: Pt[]) {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
  )
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1])
}

/** A fixed number in [0, 1) for a place, so a seeded choice does not depend on the build's order. */
function hash2(x: number, y: number) {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return v - Math.floor(v)
}

function distToRing(p: Pt, ring: Pt[]) {
  let d = Infinity
  for (let i = 0; i + 1 < ring.length; i++)
    d = Math.min(d, segDist(p, ring[i], ring[i + 1]))
  return d
}

function bounds(ring: Pt[], pad: number): [number, number, number, number] {
  return [
    Math.min(...ring.map((p) => p[0])) - pad,
    Math.min(...ring.map((p) => p[1])) - pad,
    Math.max(...ring.map((p) => p[0])) + pad,
    Math.max(...ring.map((p) => p[1])) + pad,
  ]
}

/** A ring pushed out from its centre by `m` metres. */
function grow(ring: Pt[], m: number): Pt[] {
  const cx = ring.reduce((s, q) => s + q[0], 0) / ring.length
  const cy = ring.reduce((s, q) => s + q[1], 0) / ring.length
  return ring.map(([x, y]) => {
    const l = Math.hypot(x - cx, y - cy) || 1
    return [x + ((x - cx) / l) * m, y + ((y - cy) / l) * m]
  })
}

function hull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (list: Pt[]) => {
    const out: Pt[] = []
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0)
        out.pop()
      out.push(q)
    }
    return out.slice(0, -1)
  }
  return [...half(p), ...half([...p].reverse())]
}

/** Adds a ring's coverage to a grid, 2×2 samples a texel, capped at 1. */
function fill(f: Float32Array, g: ModelInput['grid'], ring: Pt[]) {
  const ys = ring.map((p) => p[1])
  const r0 = Math.max(0, Math.floor((g.y1 - Math.max(...ys)) / g.texel))
  const r1 = Math.min(g.height - 1, Math.ceil((g.y1 - Math.min(...ys)) / g.texel))
  for (let r = r0; r <= r1; r++)
    for (const sy of [0.25, 0.75]) {
      const y = g.y1 - (r + sy) * g.texel
      const xs: number[] = []
      for (let i = 0; i + 1 < ring.length; i++) {
        const [a, b] = [ring[i], ring[i + 1]]
        if (a[1] > y !== b[1] > y)
          xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]))
      }
      xs.sort((p, q) => p - q)
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (const sx of [0.25, 0.75]) {
          const c0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.texel - sx))
          const c1 = Math.min(g.width - 1, Math.floor((xs[k + 1] - g.x0) / g.texel - sx))
          for (let c = c0; c <= c1; c++)
            f[r * g.width + c] = Math.min(1, f[r * g.width + c] + 0.25)
        }
    }
}

/** Segments bucketed on a grid, for the nearest one to a point. */
class SegmentGrid {
  private cells = new Map<string, [Pt, Pt][]>()
  private size: number
  constructor(segs: [Pt, Pt][], size: number) {
    this.size = size
    for (const s of segs) {
      const [x0, x1] = [Math.min(s[0][0], s[1][0]), Math.max(s[0][0], s[1][0])]
      const [y0, y1] = [Math.min(s[0][1], s[1][1]), Math.max(s[0][1], s[1][1])]
      for (let i = Math.floor(x0 / size); i <= Math.floor(x1 / size); i++)
        for (let j = Math.floor(y0 / size); j <= Math.floor(y1 / size); j++) {
          const k = `${i},${j}`
          const list = this.cells.get(k) ?? []
          list.push(s)
          this.cells.set(k, list)
        }
    }
  }
  nearest(p: Pt): { d: number; seg?: [Pt, Pt] } {
    let best: { d: number; seg?: [Pt, Pt] } = { d: Infinity }
    const [ci, cj] = [Math.floor(p[0] / this.size), Math.floor(p[1] / this.size)]
    for (let i = ci - 1; i <= ci + 1; i++)
      for (let j = cj - 1; j <= cj + 1; j++)
        for (const s of this.cells.get(`${i},${j}`) ?? []) {
          const d = segDist(p, s[0], s[1])
          if (d < best.d) best = { d, seg: s }
        }
    return best
  }
}

/** Points with a radius, bucketed, for "is anything within r of here". */
class SpatialHash {
  private cells = new Map<string, [number, number, number][]>()
  private size: number
  constructor(size: number) {
    this.size = size
  }
  add(p: Pt, r: number) {
    const k = `${Math.floor(p[0] / this.size)},${Math.floor(p[1] / this.size)}`
    const list = this.cells.get(k) ?? []
    list.push([p[0], p[1], r])
    this.cells.set(k, list)
  }
  near(p: Pt, r: number) {
    const [ci, cj] = [Math.floor(p[0] / this.size), Math.floor(p[1] / this.size)]
    for (let i = ci - 2; i <= ci + 2; i++)
      for (let j = cj - 2; j <= cj + 2; j++)
        for (const [x, y, rr] of this.cells.get(`${i},${j}`) ?? [])
          if (Math.hypot(x - p[0], y - p[1]) < r + rr) return true
    return false
  }
}

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Values round a ring smoothed along it, sigma in points. */
function smoothCyclic(v: number[], sigma: number) {
  const rad = Math.ceil(sigma * 3)
  const k = Array.from({ length: 2 * rad + 1 }, (_, i) =>
    Math.exp(-((i - rad) ** 2) / (2 * sigma * sigma)),
  )
  const sum = k.reduce((a, b) => a + b, 0)
  return v.map((_, i) => {
    let s = 0
    for (let o = -rad; o <= rad; o++) s += v[(i + o + v.length) % v.length] * k[o + rad]
    return s / sum
  })
}

/** A separable Gaussian blur, sigma in texels. */
function blur(src: Float32Array, w: number, hgt: number, sigma: number) {
  const rad = Math.ceil(sigma * 3)
  const k = Array.from({ length: 2 * rad + 1 }, (_, i) =>
    Math.exp(-((i - rad) ** 2) / (2 * sigma * sigma)),
  )
  const pass = (a: Float32Array, horizontal: boolean) => {
    const b = new Float32Array(a.length)
    for (let r = 0; r < hgt; r++)
      for (let c = 0; c < w; c++) {
        let s = 0
        let ws = 0
        for (let i = -rad; i <= rad; i++) {
          const cc = horizontal ? c + i : c
          const rr = horizontal ? r : r + i
          if (cc < 0 || rr < 0 || cc >= w || rr >= hgt) continue
          s += a[rr * w + cc] * k[i + rad]
          ws += k[i + rad]
        }
        b[r * w + c] = s / ws
      }
    return b
  }
  return pass(pass(src, true), false)
}
