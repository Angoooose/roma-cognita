/**
 * The seven Nile branches of the delta as they stood in the late Republic, authored
 * as waypoints with the provenance of every coordinate. The derivation turns these
 * into lines (derive-floodplains.ts) and they are then the delta's channels for
 * the height-above-channel computation — which is what makes the delta floodplain
 * fan across the whole triangle instead of hugging the one modern channel
 * HydroRIVERS carries.
 *
 * Order and names follow Strabo 17.1.18, west to east: Canopic, Bolbitine,
 * Sebennytic, Phatnitic, Mendesian, Tanitic, Pelusiac. Herodotus 2.17 has the
 * river split at Kerkasoros into the Pelusiac (east), the Canopic (west) and the
 * "straight" Sebennytic; the Saitic (= Tanitic) and Mendesian leave the
 * Sebennytic; the Bolbitine and Bucolic (= Phatnitic) mouths "were dug".
 *
 * How each leg is drawn (`via`, from the previous waypoint to this one):
 * - `spline` — a centripetal Catmull–Rom curve through the waypoints. It passes
 *   through every waypoint, so a site said to lie on a branch lies on its line.
 *   Between waypoints the course is our interpolation, not evidence.
 * - `rosetta` — follows the modern Rosetta branch (HydroRIVERS). Used where the
 *   ancient branch is taken to have run in the modern channel.
 * - `trace` — the least-cost path through the DEM between the two waypoints,
 *   which runs down the modern channel's water surface. Used for the modern
 *   Damietta branch, which HydroRIVERS does not carry.
 *
 * Provenance tags: `pleiades:<id>` — the Pleiades representative point, as in the
 * 22 Sept 2026 dump; `modern:<name>` — a modern town or channel point from general
 * knowledge, approximate to ~1 km; `ours` — a routing point we chose, with the
 * reason in `why`. Mouths are placed where reconstructions put them; the line is
 * then trimmed where it leaves modern land (sea or lagoon), because the coast has
 * moved and the map's coast is modern.
 */
import type { Confidence } from '@roma-cognita/schema'
import type { Pt } from '../lib/grid.ts'

export interface Waypoint {
  at: Pt
  prov: string
  via?: 'spline' | 'rosetta' | 'trace'
  why?: string
}

export interface Branch {
  id: string
  confidence: Confidence
  /** m³/s, display width only. */
  discharge: number
  /** The branch this one leaves: its first waypoint is snapped onto that branch's line. */
  joinsFrom?: string
  waypoints: Waypoint[]
}

/** Herodotus 2.15, 2.17: the river divides at Kerkasoros. */
const KERKASOROS: Waypoint = { at: [31.21826, 30.084523], prov: 'pleiades:727142' }
const ATHRIBIS: Waypoint = {
  at: [31.18425, 30.4707015],
  prov: 'pleiades:727078',
  why: 'Tell Atrib at Benha, on the modern Damietta branch',
}
const SEBENNYTOS: Waypoint = { at: [31.239982, 30.9641295], prov: 'pleiades:727227' }
/**
 * Where the Canopic leaves the modern Rosetta line. It must do so upstream of
 * Naukratis' latitude, since Naukratis (on the Canopic, Herodotus 2.179) lies west
 * of the Rosetta and south of Sais. The exact point is our choice.
 */
const CANOPIC_SPLIT: Waypoint = {
  at: [30.78, 30.8],
  prov: 'ours',
  via: 'rosetta',
  why: 'snapped to the modern Rosetta branch south of Naukratis’ latitude',
}
const BUBASTIS: Waypoint = { at: [31.5110853352, 30.5723823112], prov: 'pleiades:727088' }

export const BRANCHES: Branch[] = [
  {
    id: 'nile-canopic-branch',
    confidence: 'probable',
    discharge: 600,
    waypoints: [
      KERKASOROS,
      CANOPIC_SPLIT,
      { at: [30.5919, 30.9005], prov: 'pleiades:727169', why: 'Naukratis' },
      {
        at: [30.192032, 31.13965],
        prov: 'pleiades:727221',
        why: 'Schedia, where the Alexandria canal left the Canopic; Pleiades puts its Kanobikos river record (727138) here',
      },
      {
        at: [30.128889, 31.312778],
        prov: 'pleiades:727120',
        why: 'Herakleion-Thonis at the Canopic mouth, now under Abu Qir Bay; trimmed at the modern shore',
      },
    ],
  },
  {
    id: 'nile-bolbitine-branch',
    joinsFrom: 'nile-canopic-branch',
    confidence: 'probable',
    discharge: 250,
    waypoints: [
      { ...CANOPIC_SPLIT, via: undefined },
      {
        at: [30.36, 31.47],
        prov: 'modern:Rosetta mouth',
        via: 'rosetta',
        why: 'the modern Rosetta branch to its mouth; the Rosetta promontory is largely post-antique accretion, so the ancient mouth lay some km inland',
      },
    ],
  },
  {
    id: 'nile-sebennytic-branch',
    confidence: 'uncertain',
    discharge: 500,
    waypoints: [
      KERKASOROS,
      { ...ATHRIBIS, via: 'trace' },
      { ...SEBENNYTOS, via: 'trace' },
      {
        at: [31.16, 31.2],
        prov: 'ours',
        why: 'north-west across the Sebennytes Kato nome (Pleiades label 727223 at 31.14, 31.36)',
      },
      { at: [31.1, 31.45], prov: 'ours', why: 'towards the Burullus lagoon' },
      {
        at: [31.07, 31.58],
        prov: 'modern:Burullus outlet',
        why: 'the Sebennytic mouth is usually placed at the lagoon outlet; trimmed at the lagoon shore',
      },
    ],
  },
  {
    id: 'nile-phatnitic-branch',
    joinsFrom: 'nile-sebennytic-branch',
    confidence: 'probable',
    discharge: 350,
    waypoints: [
      SEBENNYTOS,
      { at: [31.38, 31.04], prov: 'modern:Mansura', via: 'trace' },
      {
        at: [31.812588, 31.417068],
        prov: 'pleiades:727235',
        via: 'trace',
        why: 'Tamiathis (Damietta)',
      },
      {
        at: [31.844, 31.523],
        prov: 'pleiades:727198',
        via: 'trace',
        why: 'Phatnitikon Stoma; the Phatnitic is taken as the lower modern Damietta branch',
      },
    ],
  },
  {
    id: 'nile-mendesian-branch',
    joinsFrom: 'nile-sebennytic-branch',
    confidence: 'uncertain',
    discharge: 250,
    waypoints: [
      ATHRIBIS,
      {
        at: [31.355543, 30.682989],
        prov: 'pleiades:727146',
        why: 'Tell el-Moqdam (Leontopolis); our routing puts the branch past it',
      },
      { at: [31.51741, 30.956115], prov: 'pleiades:727156', why: 'Mendes' },
      { at: [31.75, 31.18], prov: 'ours', why: 'north-east towards the lagoon' },
      {
        at: [31.9910675085, 31.3118654156],
        prov: 'pleiades:727157',
        why: 'Mendesion Stoma — Pleiades precision "related" (it borrows the Tanitic lake’s point), so this is a position in the Manzala lagoon, not a located mouth',
      },
    ],
  },
  {
    id: 'nile-tanitic-branch',
    joinsFrom: 'nile-pelusiac-branch',
    confidence: 'uncertain',
    discharge: 250,
    waypoints: [
      {
        at: [31.56, 30.63],
        prov: 'ours',
        why: 'leaves the Pelusiac below Bubastis, the reading of the eastern-delta reconstructions (Bietak 1975); others derive it from the Mendesian',
      },
      { at: [31.620556, 30.734257], prov: 'pleiades:727196', why: 'Pharbaithos' },
      { at: [31.8836195624, 30.9754528374], prov: 'pleiades:727236', why: 'Tanis' },
      { at: [32.05, 31.13], prov: 'ours' },
      {
        at: [32.18, 31.24],
        prov: 'modern:el-Gamil outlet',
        why: 'the Tanitic mouth is usually put near the Manzala outlet at el-Gamil (Toussoun 1922); trimmed at the lagoon shore',
      },
    ],
  },
  {
    id: 'nile-pelusiac-branch',
    confidence: 'probable',
    discharge: 600,
    waypoints: [
      KERKASOROS,
      {
        at: [31.3308260017, 30.2924725049],
        prov: 'pleiades:727147',
        why: 'Tell el-Yahudiya',
      },
      BUBASTIS,
      {
        at: [31.8228926667, 30.7863139],
        prov: 'pleiades:727080',
        why: 'Avaris/Pi-Ramesses (Tell el-Dab‘a–Qantir), located on the Pelusiac by Bietak 1975',
      },
      {
        at: [32.1734853333, 30.8600223333],
        prov: 'pleiades:727103',
        why: 'Daphnai, "Daphnae of Pelusium" (Herodotus 2.30)',
      },
      { at: [32.5473404, 31.0427587], prov: 'pleiades:727192', why: 'Pelusium' },
      { at: [32.5824, 31.062], prov: 'pleiades:727191', why: 'Pelousiakon Stoma' },
    ],
  },
]
