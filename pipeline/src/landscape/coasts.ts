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
  // --- Italy -------------------------------------------------------------------

  {
    id: 'tiber-mouth',
    label: 'The Tiber mouth at Ostia',
    z: 12,
    hull: [
      // North of the Tiber: the Roman coast crossed what became Claudius's basin, dug
      // from AD 42 partly out into the sea; placed ~300 m inside the 2nd-century line.
      [12.258, 41.779],
      // Salomon et al. 2023 fig. 1, "coastline 2nd c. CE (?)", georeferenced on
      // Trajan's hexagon and the Ostia castrum, and set a little landward for 50 BCE.
      [12.2585, 41.7715],
      [12.264, 41.764],
      [12.271, 41.7576],
      // The mouth: core ISF-1 has river-mouth sands of 455–220 BCE (Salomon et al. 2018 fig. 7).
      [12.275, 41.7535],
      // Core TB-1: shoreface until the 2nd–1st century BCE, seafront buildings from its end.
      [12.2778, 41.7506],
      // Between the wall of 63–58 BCE (Porta Marina) and the 2nd–3rd-century coast (Salomon 2018 fig. 1).
      [12.2855, 41.7497],
      [12.296, 41.7478],
      // Ours: south-east along the via Severiana, closing on the modern beach at Castel
      // Fusano, where the delta's growth since has been least.
      [12.315, 41.738],
      [12.345, 41.715],
      // Out over the sea and back.
      [12.34, 41.69],
      [12.2, 41.72],
      [12.1, 41.9],
      // Ours: north of the Claudian basin the Roman coast is unmapped here. It is drawn
      // behind the modern one, as the barrier in front of the Maccarese lagoon, closing
      // on the modern beach north of Fregene as the delta's northern wing thins out.
      [12.17, 41.905],
      [12.2, 41.875],
      [12.222, 41.845],
      [12.236, 41.815],
      [12.245, 41.795],
    ],
    view: { west: 12.12, south: 41.68, east: 12.36, north: 41.92 },
    method: { kind: 'sea', maxHeight: 12 },
    why:
      'Everything seaward of the 50 BCE shore was sea, whatever it stands at now: the beach ridges of Isola Sacra, ' +
      'Fiumicino and Lido di Ostia were built after it. So the threshold only keeps the hull’s loose ends off higher ' +
      'ground, and is set above the dunes.',
    minIslandKm2: 1,
    sites: [
      { name: 'Ostia theatre', at: [12.2912, 41.7537], prov: 'on land, 0.5 km from the Roman shore', expect: 'shore' },
      { name: 'Portus, Trajan’s basin', at: [12.264, 41.7788], prov: 'built after the window, partly out at sea', expect: 'shore' },
    ],
  },

  {
    id: 'stagno-di-maccarese',
    label: 'The Maccarese lagoon',
    z: 12,
    // Behind the Roman barrier (tiber-mouth's coast, kept ~400 m clear of it), inland to
    // the edge of the 19th-century marsh at 12.26–12.28° E; from Portus north to
    // Maccarese (Di Rita et al. 2010, as summarised). The outline between is ours: the
    // DEM of the reclaimed estate and the airport shows no basin to follow.
    hull: [
      [12.25, 41.793],
      [12.243, 41.812],
      [12.23, 41.842],
      [12.214, 41.866],
      [12.232, 41.872],
      [12.255, 41.858],
      [12.272, 41.835],
      [12.278, 41.81],
      [12.272, 41.793],
    ],
    method: { kind: 'polygon' },
    surface: 'sea',
    why: 'Brackish from the 9th–8th century BCE and open in the window; an extent from the sources, not a survey.',
    minIslandKm2: 0,
    sites: [],
  },
  {
    id: 'stagno-di-ostia',
    label: 'The Ostia lagoon',
    z: 12,
    // East of Ostia, inside the edge of the 19th-century lagoon (Salomon et al. 2018
    // fig. 1): about 41.745–41.77° N, 12.30–12.33° E. Rounded by us.
    hull: [
      [12.3, 41.752],
      [12.312, 41.746],
      [12.328, 41.748],
      [12.334, 41.758],
      [12.33, 41.768],
      [12.316, 41.771],
      [12.303, 41.764],
    ],
    method: { kind: 'polygon' },
    surface: 'sea',
    why:
      'A marsh in the earlier first millennium BCE, then kept open to the sea, probably for the salt works (Vittori et al. ' +
      '2015), so drawn as water; the Campus Salinarum Romanarum.',
    minIslandKm2: 0,
    sites: [],
  },
  {
    id: 'arno-coast',
    label: 'The coast at Pisa',
    z: 12,
    hull: [
      // Ours: the old coast closing on the modern one north of the Serchio, towards
      // Viareggio, as the Arno's and Serchio's growth since thins out.
      [10.235, 43.92],
      [10.27, 43.88],
      [10.305, 43.82],
      // The innermost "ancient" shoreline of Pasquinucci 2014 fig. 2 (after Mazzanti
      // 2003), at the Serchio (Auser) mouth; scale from Pisa and Livorno.
      [10.3205, 43.771],
      [10.33, 43.73],
      // The Arno mouth at San Piero a Grado, the Roman river landing: 20 stades from Pisa
      // by water (Strabo 5.2.5), and 4.7 km on the ground.
      [10.34, 43.685],
      // Kaniewski et al. 2018 fig. 8A ("Roman period"), georeferenced on core PP3 and
      // Livorno: the barrier in front of the Portus Pisanus lagoon, and its inlet.
      [10.3505, 43.633],
      [10.3511, 43.6017],
      [10.3447, 43.5844],
      // Santo Stefano ai Lupi; then the rocky Livorno terrace, where the coast is stable.
      [10.3346, 43.5729],
      [10.3082, 43.551],
      // Out over the sea and back.
      [10.25, 43.54],
      [10.15, 43.7],
      [10.15, 43.92],
    ],
    method: { kind: 'sea', maxHeight: 12 },
    why:
      'The coast was nearly still from the 8th to the 2nd century BCE and began to build out in the 2nd–1st; about 7 km ' +
      'has been added off the Arno since (Pasquinucci 2014). Everything seaward of the line was sea, whatever the dunes ' +
      'of San Rossore and Tombolo stand at now, so the threshold only keeps the loose ends off higher ground.',
    minIslandKm2: 1,
    sites: [
      { name: 'Pisa', at: [10.3966, 43.723], prov: 'Piazza dei Miracoli; 20 stades up the Arno (Strabo 5.2.5)', expect: 'land' },
      { name: 'San Piero a Grado', at: [10.345, 43.68], prov: 'the Roman landing at the Arno mouth', expect: 'shore' },
    ],
    view: { west: 10.18, south: 43.53, east: 10.45, north: 43.93 },
  },
  {
    id: 'portus-pisanus',
    label: 'The Portus Pisanus lagoon',
    z: 12,
    // Kaniewski et al. 2018 fig. 8A: open water about 43.594–43.627° N, 10.355–10.394° E,
    // between the Coltano rise and the Livorno hills, opening to the sea at the inlet
    // (arno-coast's vertex at 43.6017°). Rounded by us, clear of the barrier.
    hull: [
      [10.3535, 43.6017],
      [10.358, 43.612],
      [10.366, 43.624],
      [10.38, 43.628],
      [10.393, 43.621],
      [10.395, 43.606],
      [10.386, 43.595],
      [10.37, 43.592],
      [10.358, 43.596],
    ],
    method: { kind: 'polygon' },
    surface: 'sea',
    why: 'The sheltered lagoon formed about 200 BCE (Kaniewski et al. 2018) and was Pisa’s harbour.',
    minIslandKm2: 0,
    sites: [],
  },
  {
    id: 'po-delta-coast',
    label: 'The Po delta coast',
    z: 11,
    hull: [
      // Ours: south of Classe the old coast closes on the modern one towards Cervia.
      [12.33, 44.28],
      [12.28, 44.33],
      // Cirelli 2013 fig. 2 (Ravenna and Classe in the early Empire), schematic.
      [12.2496, 44.3638],
      [12.24, 44.387],
      [12.2183, 44.41],
      [12.2175, 44.428],
      // The Etruscan–Roman ridge IIIe near Taglio della Baiona and Bellocchio (Ciabatti 1966,
      // as reproduced in the ISPRA notes to sheet 205, Comacchio, fig. 13).
      [12.21, 44.505],
      [12.223, 44.5825],
      // The Augustan shore on which the Comacchio ship was wrecked at the end of the 1st
      // century BCE: the ridge arcing Lagosanto–Comacchio–Porto Garibaldi (sheet 205 notes p. 118).
      [12.245, 44.677],
      // Ciabatti's ridge V, "cordone romano – inizio era volgare", north to Rosolina.
      [12.217, 44.7045],
      [12.198, 44.7365],
      [12.178, 44.7745],
      [12.204, 44.9115],
      [12.23, 45.021],
      [12.24, 45.07],
      // Ours: Brondolo, closing on the modern coast at Chioggia.
      [12.28, 45.19],
      [12.3, 45.23],
      // Out round the modern delta and back.
      [12.45, 45.25],
      [12.8, 45.05],
      [12.8, 44.75],
      [12.5, 44.3],
      [12.4, 44.25],
    ],
    method: { kind: 'sea', maxHeight: 10 },
    why:
      'Ciabatti’s beach ridges date the coast; everything seaward of the Roman ridge is later land: the lobes of the Po di ' +
      'Goro, Tolle and Pila, most of it after the Porto Viro cut of 1604. The ground there has subsided and much of it is ' +
      'below sea level, so the flood reaches all of it; the threshold is above the embankments. Landward of the ridge the ' +
      'modern valli are not ancient water (see valli-di-comacchio).',
    minIslandKm2: 2,
    sites: [
      { name: 'Ravenna', at: [12.199, 44.418], prov: 'the town, on its islands in the lagoon', expect: 'land' },
      { name: 'Comacchio', at: [12.185, 44.694], prov: 'on the Augustan ridge', expect: 'shore' },
      { name: 'Adria', at: [12.056, 45.053], prov: 'reached the sea by canals (Strabo 5.1.8), ~14 km', expect: 'land' },
    ],
    view: { west: 12.0, south: 44.25, east: 12.75, north: 45.25 },
  },
  {
    id: 'ravenna-lagoon',
    label: 'The Ravenna lagoon',
    z: 12,
    // Cirelli 2013 fig. 2: open water west and south of the town and between Ravenna and
    // Classe, about 44.38–44.42° N, 12.19–12.23° E, opening to the sea at the Classe
    // harbour mouth. Rounded by us, keeping the town dry.
    hull: [
      [12.19, 44.386],
      [12.21, 44.38],
      [12.228, 44.382],
      [12.2385, 44.388],
      [12.232, 44.396],
      [12.222, 44.408],
      [12.206, 44.41],
      [12.19, 44.403],
    ],
    method: { kind: 'polygon' },
    surface: 'sea',
    why: 'Schematic: Cirelli’s figure is a sketch of the early Empire, and Classe’s harbour is Augustan, at the end of the window.',
    minIslandKm2: 0,
    sites: [],
  },

  // --- modern lagoons that were land -------------------------------------------

  {
    id: 'valli-di-comacchio',
    label: 'The Valli di Comacchio (land in the window)',
    z: 11,
    // Round the modern valli west of the Augustan ridge, from the Reno to Comacchio, and
    // clear of that ridge's sea (po-delta-coast).
    hull: [
      [11.96, 44.56],
      [12.19, 44.56],
      [12.205, 44.6],
      [12.21, 44.66],
      [12.19, 44.683],
      [12.12, 44.7],
      [11.96, 44.68],
    ],
    method: { kind: 'polygon' },
    why:
      'Roman villas at Agosta and Dosso dei Sassi stand on what is now the lagoon floor: the valli formed as the delta ' +
      'subsided after antiquity (ISPRA sheet 205 notes). Removing them draws the ground as land.',
    minIslandKm2: 0,
    sites: [],
  },
  {
    id: 'grado-lagoon',
    label: 'The Grado lagoon (land in the window)',
    z: 11,
    // Round the eastern lagoon between Aquileia's plain and the Grado barrier, from the
    // Natissa to the Isonzo; the Marano lagoon to the west existed and is left alone.
    hull: [
      [13.27, 45.7],
      [13.3, 45.745],
      [13.42, 45.745],
      [13.51, 45.72],
      [13.52, 45.69],
      [13.43, 45.686],
      [13.39, 45.678],
      [13.33, 45.682],
    ],
    method: { kind: 'polygon' },
    why:
      'The Grado lagoon is post-Roman: in the Roman period it was mostly dry land, with a harbour at San Gottardo now 500 m ' +
      'offshore at −4 m (Donda et al. 2025). The Marano lagoon to the west had existed for five thousand years.',
    minIslandKm2: 0,
    sites: [],
  },

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
