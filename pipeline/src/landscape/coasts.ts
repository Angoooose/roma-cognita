/**
 * The ancient shores the coast derivation (derive-coasts.ts) draws: where the sea,
 * a lagoon or a lake stood in the map's window and stands no longer. Each is the
 * shape of one `add-water` or `remove-water` record in data/landscape-changes.yaml,
 * which holds its dates, sources and confidence; this file holds only what the
 * derivation needs, and says where every authored vertex comes from.
 *
 * **Hulls.** A hull's landward side is the ancient shore — the delta front or
 * beach-ridge line of about 50 BCE — read from the published reconstructions its
 * comments cite, to the precision they give (a kilometre or so at best). Its other
 * sides are loose: they run out over the modern sea, or up onto hillsides the terrain
 * threshold keeps dry anyway. So the reconstruction sets how far the water reached,
 * and the terrain sets its shape along the valley sides, where the modern DEM is
 * better evidence than a redrawn figure.
 *
 * **Thresholds.** `maxHeight` is the highest modern ground the ancient water covered.
 * It is the height of the plain at the old delta front, not a sea level: the alluvium
 * has built up since, so ground that was open water two thousand years ago now stands
 * a few metres above the sea. It is set by looking at the previews (does the edge
 * sit at the foot of the valley sides?), and is argued in each shore's `why`.
 *
 * One landscape for the whole window: each shore is drawn as it stood around 50 BCE
 * (the middle of the Republic's last century), and a shore that moved within the
 * window says so in its record's note.
 */
import type { Pt } from '../features/grid.ts'

export interface Shore {
  /** The landscape-change record this is the shape of. */
  id: string
  label: string
  /** Mapterhorn zoom: z11 is ~30–40 m/px at these latitudes. */
  z: number
  hull: Pt[]
  method:
    | { kind: 'sea'; maxHeight: number }
    | { kind: 'lake'; level: number; seed: Pt }
    /** The hull as the shape: ancient land where there is now sea, or water too uncertain for the terrain to shape. */
    | { kind: 'polygon' }
  /**
   * For water: whether the engine lays its ground at sea level (`sea`) or leaves the
   * lake bed as it is (`lake`). A `sea` shore is sea and a `lake` shore a lake unless
   * this says otherwise; a polygon is ancient land unless it says it is water.
   */
  surface?: 'sea' | 'lake'
  why: string
  /** Arms of water narrower than this are cut off, m: modern drains cut below the old level. */
  narrowestM?: number
  /** Enclosed rises smaller than this are drowned: towns, levees and spoil on the surface model. */
  minIslandKm2: number
  /** Where the sources put a place: in the water, on land, or on the shore. Reported, not enforced. */
  sites: { name: string; at: Pt; prov: string; expect: 'water' | 'land' | 'shore' }[]
  /** A published figure for the area of water that is land today, to compare against. */
  expectKm2?: { label: string; range: [number, number] }
  /** The preview's box; the hull's when omitted. */
  view?: { west: number; south: number; east: number; north: number }
}

export const SHORES: Shore[] = [
  // --- lakes drained since ------------------------------------------------------

  {
    id: 'lacus-fucinus',
    label: 'Fucine Lake (Lacus Fucinus)',
    z: 11,
    // The whole closed basin: the mountains round it are well above any lake level.
    hull: [
      [13.38, 41.92],
      [13.72, 41.92],
      [13.72, 42.11],
      [13.38, 42.11],
    ],
    method: { kind: 'lake', level: 668, seed: [13.55, 42.0] },
    why:
      'A closed karst basin that drained only through swallow-holes until Claudius cut his tunnel (AD 52), after the window; ' +
      'Caesar planned to drain it (Suetonius, Iul. 44). Its surface moved with the seasons and the decades: depths recorded ' +
      'between 1783 and 1861 put it at about 660–673 m over a floor near 650 m. 668 m is a middling high stand: the villages ' +
      'that stood on its shore (Avezzano 674 m, Ortucchio on its spur 665 m) sit at the water’s edge, and it gives an area ' +
      'close to the 140 km² recorded at the lake’s largest.',
    minIslandKm2: 0.2,
    sites: [
      { name: 'Avezzano', at: [13.44, 42.03], prov: 'the Incile, where the tunnel begins', expect: 'shore' },
      { name: 'Marruvium', at: [13.625, 42.005], prov: 'San Benedetto dei Marsi; the Marsi’s lakeside town', expect: 'shore' },
      { name: 'Ortucchio', at: [13.645, 41.955], prov: 'on a lakeside spur', expect: 'shore' },
      { name: 'lake centre', at: [13.55, 42.0], prov: 'the basin floor, 651 m', expect: 'water' },
    ],
    expectKm2: { label: 'the lake at its largest, about 140 km² (1816)', range: [100, 150] },
  },
  {
    id: 'lake-copais',
    label: 'Lake Copais (Kopais)',
    z: 11,
    hull: [
      [22.93, 38.35],
      [23.32, 38.35],
      [23.32, 38.55],
      [22.93, 38.55],
    ],
    method: { kind: 'lake', level: 97, seed: [23.1, 38.45] },
    why:
      'A seasonal lake and reed fen in a closed basin drained by swallow-holes towards Larymna; the Minyan dykes had long ' +
      'failed, and Strabo (9.2.16–18) says it changed greatly with the seasons, round a circuit of 380 stades. The bed lies ' +
      'at about 92 m and the water ranged from 92 to 97 m before it overflowed westward (Knauss’s reconstruction, as ' +
      'modelled by the NTUA group). 97 m, the top of that range, gives 235 km², against the 241 km² reclaimed by 1931; ' +
      'at 95 m the lake stops well short of Orchomenos, whose plain stands higher than the eastern bed because the drained ' +
      'peat there has shrunk. Even at 97 m Orchomenos is 2 km from the water: the western arm was fen more than lake.',
    minIslandKm2: 0.2,
    sites: [
      { name: 'Orchomenos', at: [22.975, 38.49], prov: 'on the western shore', expect: 'shore' },
      { name: 'Haliartos', at: [23.1, 38.38], prov: 'on the southern shore', expect: 'shore' },
      { name: 'lake centre', at: [23.1, 38.45], prov: 'the bed, 90 m', expect: 'water' },
    ],
  },
  {
    id: 'lake-boibeis',
    label: 'Lake Boibeis (Karla)',
    z: 11,
    hull: [
      [22.65, 39.38],
      [22.97, 39.38],
      [22.97, 39.62],
      [22.74, 39.62],
      // The north-west side is ours: the Larissa plain beyond it is as low as the lake bed,
      // and was the Peneios's flood ground that fed the lake, not the lake.
      [22.66, 39.55],
    ],
    method: { kind: 'lake', level: 49, seed: [22.82, 39.48] },
    why:
      'A shallow lake on the flat floor of the eastern Thessalian basin, fed by the Peneios in flood and drained in 1962; ' +
      'its area swung with the seasons, from a few tens of km² to about 180. The floor lies at 42–46 m and is so flat that ' +
      'every metre of level adds or takes away a hundred km², so the level is a middle choice (49 m), not a measurement. ' +
      'The lake is certain; its outline is not.',
    minIslandKm2: 0.2,
    sites: [],
    expectKm2: { label: 'the lake’s seasonal range, about 40–180 km²', range: [40, 180] },
  },
  {
    id: 'lake-moeris',
    label: 'Lake Moeris (the Fayum lake)',
    z: 10,
    // The Fayum floodplain's hull (features/regions.ts), which keeps out the Wadi Rayan
    // depression and its modern drainage lakes, with its north side moved out over the
    // desert: that hull runs along the lake's north shore to keep the lake out.
    hull: [
      [31.12, 29.45],
      [31.1, 29.58],
      [30.92, 29.62],
      [30.55, 29.62],
      [30.3, 29.56],
      [30.2, 29.45],
      [30.3, 29.35],
      [30.45, 29.3],
      [30.53, 29.15],
      [30.6, 29.03],
      [30.7, 29.0],
      [30.8, 29.1],
      [30.88, 29.2],
      [30.93, 29.27],
      [31.04, 29.36],
    ],
    method: { kind: 'lake', level: -2, seed: [30.6, 29.47] },
    // The drains that run into Qarun from the south (el-Wadi, el-Bats) are cut below −2 m.
    narrowestM: 500,
    surface: 'sea',
    why:
      'Lake Qarun now stands near −43 m; the Ptolemaic lake stood near −2 m after the reclamation under Ptolemy II, the ' +
      'level usually given (Ball 1939; Caton-Thompson & Gardner 1934 — to check), which is the lower bound the Fayum ' +
      'floodplain was derived from. So the lake here is exactly the ground that floodplain leaves out, and the two meet. ' +
      'Its surface is laid at sea level, two metres out: near enough for a lake the map draws with the sea’s colours, as ' +
      'it draws the Caspian.',
    minIslandKm2: 0.5,
    sites: [
      { name: 'Soknopaiou Nesos', at: [30.6689, 29.5335], prov: 'pleiades:737053; above the north shore', expect: 'shore' },
    ],
  },
]
