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
     * Ancient land that is sea now: today's sea inside the hull, reached a little onto
     * the land so no sliver of the modern shore survives between the two coasts.
     */
    | { kind: 'sea-to-land' }
  /**
   * For water: whether the engine lays its ground at sea level (`sea`) or leaves the
   * lake bed as it is (`lake`). A `sea` shore is sea and a `lake` shore a lake unless
   * this says otherwise; a polygon is ancient land unless it says it is water.
   */
  surface?: 'sea' | 'lake'
  why: string
  /**
   * Ancient land that the terrain cannot tell from the water around it — a town whose
   * ground is now buried under the same silt as the bay — kept dry whatever it stands
   * at. Each ring says where it comes from.
   */
  land?: Pt[][]
  /**
   * For an uncertain shore across a belt of flats: the distance the water shelves over
   * to full depth, km, instead of the usual 4. The coast is still one line; the water
   * off it stays pale and shallow for this far.
   */
  shelfKm?: number
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

  // --- the Aegean ---------------------------------------------------------------

  {
    id: 'latmian-gulf',
    label: 'The Latmian Gulf',
    z: 11,
    hull: [
      // The Maeander delta front at the turn of the eras: the seaward edge of the "±0"
      // band in Brückner et al. 2017 fig. 1 (after Müllenhoff 2005), read against Priene,
      // Miletus, Myus and Herakleia. From the foot of Mykale beside Priene south-west
      // down the lobe's north-west edge…
      [27.2898, 37.6582],
      [27.265, 37.6277],
      [27.2639, 37.5883],
      // …to its tip, 2.8 km north of the Miletus theatre…
      [27.2668, 37.5552],
      // …and back north-east along its south-east edge to the Latmos side at Myus.
      [27.2862, 37.5826],
      [27.3293, 37.6083],
      [27.3816, 37.626],
      [27.3948, 37.6055],
      [27.4314, 37.6104],
      // Loose: round the head of the gulf and the Bafa basin over the Latmos hills, and
      // back west over the hills behind Miletus and out to sea.
      [27.47, 37.63],
      [27.64, 37.57],
      [27.64, 37.42],
      [27.3, 37.4],
      [27.08, 37.44],
      [27.08, 37.69],
      [27.27, 37.69],
    ],
    method: { kind: 'sea', maxHeight: 6 },
    land: [
      // The Milesian peninsula, from Kalabaktepe north to Humeitepe, between the Theatre
      // Harbour and the Lion Harbour; outline ours, from the city plan. Its streets lie
      // under 1–4 m of the same silt as the gulf, so the terrain cannot find it.
      [
        [27.262, 37.515],
        [27.268, 37.528],
        [27.273, 37.5355],
        [27.2795, 37.5395],
        [27.2865, 37.5355],
        [27.2915, 37.526],
        [27.29, 37.513],
      ],
    ],
    why:
      'The gulf south of the delta lobe, Bafa included, was open sea in the window and filled between 0 and 300 CE. The ' +
      'plain it left stands at 1–4 m, and the hills round it and Lade (99 m) well above, so the threshold clears the silt ' +
      'and nothing else. Miletus itself is buried in the same silt and is kept dry by hand. The figure’s line is for the ' +
      'turn of the eras; for 50 BCE it would sit 0.3–0.5 km further inland, less than its own error.',
    minIslandKm2: 0.5,
    sites: [
      { name: 'Miletus theatre', at: [27.2779, 37.53], prov: 'on the Theatre Harbour', expect: 'shore' },
      { name: 'Lade', at: [27.223, 37.531], prov: 'on the island, until the Late Roman period (Brückner et al. 2017)', expect: 'shore' },
      { name: 'Priene', at: [27.296, 37.6613], prov: 'cut off from the open sea by the 90s BCE (Brückner et al. 2014); 40 stades from it by Strabo’s day (12.8.17)', expect: 'land' },
      { name: 'Myus', at: [27.4259, 37.5987], prov: 'the site (OSM); 30 stades up from the mouth (Strabo 14.1.10)', expect: 'shore' },
      { name: 'Herakleia', at: [27.5398, 37.5052], prov: 'the site (OSM); "a small town with an anchorage" (Strabo 14.1.8)', expect: 'shore' },
    ],
    view: { west: 27.08, south: 37.4, east: 27.65, north: 37.7 },
  },
  {
    id: 'ephesus-coast',
    label: 'The coast at Ephesus',
    z: 12,
    hull: [
      // Ours: from the hills on the north side of the Cayster valley straight across the
      // plain to Syrie (Kuru Tepe)…
      [27.345, 38.003],
      [27.3558, 37.9746],
      // …then halfway between Stock et al. 2013 fig. 1's "1st c. BC" shore and its
      // "0 AD/BC" delta front (graticule corrected on the Artemision and Ayasuluk;
      // cross-checked on Kraft et al. 2007 fig. 12), south to Panayırdağ.
      [27.347, 37.968],
      [27.342, 37.963],
      [27.338, 37.957],
      [27.34, 37.951],
      [27.3512, 37.9485],
      // Loose: along the foot of Panayırdağ and Bülbüldağ, then out to sea and back.
      [27.345, 37.935],
      [27.32, 37.915],
      [27.2, 37.91],
      [27.2, 38.02],
      [27.34, 38.02],
    ],
    method: { kind: 'sea', maxHeight: 10 },
    why:
      'Between those two dated lines the delta advanced about 1.5 km, so a single date is loose here; the Hellenistic ' +
      'harbour west of the theatre lies seaward of the line and so is water, as it was, dredged.',
    minIslandKm2: 0.3,
    sites: [
      { name: 'Artemision', at: [27.3636, 37.9498], prov: 'about 1.3 km from open water by 50 BCE (Kraft et al. 2007)', expect: 'land' },
      { name: 'Ephesus theatre', at: [27.3419, 37.941], prov: 'above the harbour', expect: 'shore' },
    ],
    view: { west: 27.2, south: 37.9, east: 27.4, north: 38.02 },
  },
  {
    id: 'malian-gulf',
    label: 'The Malian Gulf at Thermopylae',
    z: 12,
    hull: [
      // Kraft et al. 1987 fig. 14 (480 BCE; scale bar, tied to the middle gate), north
      // shore on the Othrys side…
      [22.5408, 38.9111],
      // …the head of the gulf moved 1.5 km east of the 480 BCE line for 50 BCE, at the
      // steady rate that gives Vouvalidis et al. 2010's 8–10 km since 480…
      [22.503, 38.8954],
      [22.469, 38.8741],
      [22.463, 38.8576],
      [22.469, 38.8313],
      [22.495, 38.8165],
      // …and the pass: 0.25 km off the 480 BCE shore at the west, middle (Kolonos) and
      // east gates, for the strip of marsh and shoal in front of the cliff that the
      // Roman army could stage on in 191 BCE (Livy 36.15–18).
      [22.4987, 38.8097],
      [22.5366, 38.799],
      [22.564, 38.8031],
      [22.5976, 38.8105],
      // Ours: east along the foot of Kallidromon, where the plain in front is later too,
      // to the modern coast past Molos, then out to sea.
      [22.64, 38.815],
      [22.7, 38.806],
      [22.76, 38.8],
      [22.8, 38.84],
      [22.72, 38.9],
      [22.62, 38.93],
    ],
    // High enough for the travertine at the pass, which stands ~20 m over the 480 BCE surface (Kraft et al. 1987).
    method: { kind: 'sea', maxHeight: 30 },
    why:
      'Seaward of the line all the ground is later: the Spercheios plain and the travertine under the pass. So the ' +
      'threshold is set above the travertine, and the line does the work.',
    minIslandKm2: 0.5,
    sites: [
      { name: 'Thermopylae, middle gate', at: [22.5366, 38.7968], prov: 'the Kolonos, by the Leonidas monument', expect: 'shore' },
      { name: 'Lamia', at: [22.434, 38.899], prov: 'on the hills above the gulf’s head', expect: 'land' },
    ],
    view: { west: 22.4, south: 38.77, east: 22.82, north: 38.95 },
  },

  // --- Africa and Egypt ---------------------------------------------------------

  {
    id: 'gulf-of-utica',
    label: 'The Gulf of Utica',
    z: 11,
    hull: [
      // Delile et al. 2015 fig. 1 (its corner coordinates): the rocky tip of Cap Farina,
      // then the foot of Jebel Ennadhour west past Ghar el-Melh, with open bay in front:
      // the lagoon and its barrier did not yet exist.
      [10.276, 37.178],
      [10.17, 37.166],
      [10.111, 37.152],
      [10.056, 37.135],
      [10.04, 37.119],
      // Pleuger et al. 2019 fig. 7 panel 2 ("2600 BC–1st c. AD"), tied to its cores: the
      // bay's north-west, west and south-west shores…
      [10.022, 37.099],
      [10.011, 37.083],
      [10.014, 37.071],
      [10.03, 37.064],
      [10.05, 37.062],
      // …Utica's north face, Lézine's ancient coastline (Delile fig. 2's graticule)…
      [10.061, 37.059],
      // …the north tip of the Kalaat el-Andalous ridge, and Castra Cornelia, "a straight
      // ridge projecting into the sea" 4 km east of Utica (Caesar, BC 2.24).
      [10.09, 37.063],
      [10.12, 37.06],
      // Ours: the southern compartment's coast, with no dated figure; then the west end
      // of Sebkhet Ariana, a lagoon open to the Gulf of Tunis until about 1300 BP (Ben
      // Mosbah et al., fig. 7B), and the rock at Gammarth.
      [10.16, 36.98],
      [10.17, 36.93],
      [10.284, 36.915],
      // Out to sea and back.
      [10.4, 36.93],
      [10.4, 37.2],
    ],
    method: { kind: 'sea', maxHeight: 8 },
    why:
      'The Bagradas has since filled the bay: in the window the whole northern compartment was open sea from Utica to ' +
      'Jebel Ennadhour, and its delta was only beginning to push into it; the corridor between Utica and Kalaat el-Andalous ' +
      'was emerging from the 1st century BCE, and is drawn as the shallow water it still mostly was. The plain stands at ' +
      '2–5 m; the ridges well above.',
    minIslandKm2: 0.5,
    sites: [
      { name: 'Utica', at: [10.062, 37.056], prov: '"washed by the sea on one side" (Livy 29.35)', expect: 'shore' },
    ],
    view: { west: 9.98, south: 36.9, east: 10.32, north: 37.2 },
  },
  {
    id: 'lake-mareotis',
    label: 'Lake Mareotis',
    z: 11,
    // Round the eastern Maryut basin, between the Alexandria ridge and the ridges to the
    // south, from Marea (29.66° E) to the Canopic canal: Crépy & Boussac 2021 fig. 7. West
    // of Marea the basins were separate and filled only by winter rain, and are left out.
    hull: [
      [29.66, 31.02],
      [29.66, 31.12],
      [29.8, 31.155],
      [29.95, 31.18],
      [30.06, 31.17],
      [30.12, 31.1],
      [30.08, 31.0],
      [29.88, 30.98],
    ],
    method: { kind: 'lake', level: 0, seed: [29.9, 31.13] },
    surface: 'sea',
    why:
      'Fed from the Canopic branch by canals and cut off from the sea, "more than 150 stades wide and under 300 long" ' +
      '(Strabo 17.1.7). Its bed has been reclaimed and pumped below sea level; the lake is drawn to 0 m, which gives the ' +
      'main basin east of Marea.',
    minIslandKm2: 0.5,
    sites: [],
    view: { west: 29.6, south: 30.95, east: 30.15, north: 31.22 },
  },
  {
    id: 'canopic-coast',
    label: 'The Canopic coast, now under Aboukir Bay',
    z: 11,
    // Flaux et al. 2021 fig. 1, "coastline in Antiquity" (tied to Taposiris, Marea,
    // Qaitbay and Heracleion): from Eastern Canopus past Heracleion–Thonis at the Canopic
    // mouth, 6.5–7 km off today's shore, along the promontory; then round the bay inside
    // the modern shore, which the method follows.
    hull: [
      [30.09, 31.336],
      [30.129, 31.313],
      [30.165, 31.29],
      [30.203, 31.261],
      [30.21, 31.24],
      [30.13, 31.25],
      [30.075, 31.3],
      [30.07, 31.335],
    ],
    method: { kind: 'sea-to-land' },
    why:
      'Canopus stood on dry land in the window and sank by the 8th century CE; Heracleion had partly collapsed about ' +
      '100 BCE and was declining (Goddio). The promontory has been eroded since.',
    minIslandKm2: 0,
    sites: [],
  },
  {
    id: 'alexandria-heptastadion',
    label: 'The harbours either side of the Heptastadion',
    z: 12,
    // The broad modern tombolo between the city and Ras el-Tin was harbour water on both
    // sides of the Heptastadion, the causeway to Pharos (about 1.3 km; Strabo 17.1.6):
    // its ends, inferred to ±0.3 km, at 31.207° N 29.877° E and 31.198° N 29.892° E. Two
    // strips, west (Eunostos) and east (the Great Harbour), leaving the causeway dry.
    hull: [
      [29.8655, 31.2005],
      [29.8745, 31.2058],
      [29.8895, 31.1972],
      [29.883, 31.1935],
      [29.8705, 31.1965],
    ],
    method: { kind: 'polygon' },
    surface: 'sea',
    why: 'Uncertain in outline: the causeway silted into the tombolo after antiquity, and the modern city covers it.',
    minIslandKm2: 0,
    sites: [],
  },
  {
    id: 'alexandria-great-harbour',
    label: 'The Great Harbour east of the Heptastadion',
    z: 12,
    hull: [
      [29.8795, 31.2082],
      [29.8865, 31.2105],
      [29.8995, 31.2035],
      [29.894, 31.1995],
    ],
    method: { kind: 'polygon' },
    surface: 'sea',
    why: 'As alexandria-heptastadion, on the causeway’s other side.',
    minIslandKm2: 0,
    sites: [],
  },
  {
    id: 'toshka-lakes',
    label: 'The Toshka lakes (modern)',
    z: 9,
    // A box round the lakes in the Toshka depression and nothing else that is water;
    // the Nile and Lake Nasser lie east of it.
    hull: [
      [30.3, 22.4],
      [31.5, 22.4],
      [31.5, 23.6],
      [30.3, 23.6],
    ],
    method: { kind: 'polygon' },
    why: 'Filled after 1998 by Lake Nasser’s spillway; HydroLAKES types them as natural lakes, so the reservoir filter keeps them.',
    minIslandKm2: 0,
    sites: [],
  },

  // --- Gaul and Spain -------------------------------------------------------------

  {
    id: 'rhone-saint-ferreol',
    label: 'The Saint-Ferréol lobe, now eroded',
    z: 12,
    // Vella et al. 2005 fig. 5, lobe 1 (Lambert II étendu, converted): the pointed lobe
    // of the Petit Rhône active at 50 BCE, reaching 2–3 km beyond today's coast near
    // Saintes-Maries, where fourteen Roman wrecks of 50 BCE–50 CE stranded on its bar;
    // then back along the inside of the modern beach.
    hull: [
      [4.37, 43.441],
      [4.401, 43.425],
      [4.449, 43.43],
      [4.497, 43.441],
      [4.533, 43.447],
      [4.535, 43.46],
      [4.37, 43.465],
    ],
    method: { kind: 'sea-to-land' },
    why: 'The lobe’s tip has been eroded since the Petit Rhône’s mouth moved; what is sea there now was land then.',
    minIslandKm2: 0,
    sites: [],
  },
  {
    id: 'rhone-east-coast',
    label: 'The coast east of the Petit Rhône',
    z: 11,
    hull: [
      // The east end of the Saint-Ferréol lobe (Vella et al. 2005 fig. 5)…
      [4.533, 43.447],
      // …the Ulmet lobe's beach ridge at Cabane Rouge, 832–764 BCE (core, their table 3)…
      [4.6601, 43.4627],
      // …ours, from there to the Marais de Fos, whose peat is dated 305 BCE–2 CE before a
      // marine incursion (core): the Grand Rhône plain in front is mostly post-medieval.
      [4.75, 43.465],
      [4.84, 43.46],
      [4.9417, 43.4363],
      // Out to sea and back.
      [4.96, 43.36],
      [4.54, 43.34],
    ],
    method: { kind: 'sea', maxHeight: 5 },
    why:
      'East of the Petit Rhône the Beauduc spit, Piémanson and the Grand Rhône’s mouth are later than the window. The ' +
      'Camargue stands at 0–2 m, so the threshold only has to clear its dunes. The line east of Cabane Rouge is inferred, ' +
      'to ±3 km.',
    minIslandKm2: 0.5,
    sites: [],
    view: { west: 4.5, south: 43.33, east: 4.98, north: 43.5 },
  },
  {
    id: 'ebro-delta',
    label: 'The Ebro delta, before it grew',
    z: 11,
    hull: [
      // Ours: the mainland coast north of the delta, roughly as today (L'Ampolla).
      [0.71, 40.81],
      // Nienhuis et al. 2017 fig. 1 (after Canicio & Ibáñez 1999), the "start growth"
      // stage, read against the modern delta on the same frame: the cusp's north
      // shoulder, its tip at the river mouth, and its south shoulder.
      [0.688, 40.762],
      [0.706, 40.717],
      [0.607, 40.654],
      // Ours: the mainland coast south of it at Sant Carles, roughly as today.
      [0.585, 40.62],
      // Out round the modern delta and back.
      [0.6, 40.54],
      [0.95, 40.54],
      [0.95, 40.82],
    ],
    method: { kind: 'sea', maxHeight: 6 },
    why:
      'The delta was small and cuspate until at least 3000 BP and began to grow fast about 2100 BP; the Riet Vell lobe, ' +
      'the Fangar and Banya spits and the Alfacs enclosure are all later. The delta plain stands at 0–4 m.',
    minIslandKm2: 1,
    sites: [
      { name: 'Amposta', at: [0.58, 40.708], prov: 'the maximum Holocene flooding reached it; 10–12 km from the Roman mouth', expect: 'land' },
    ],
    view: { west: 0.5, south: 40.52, east: 0.95, north: 40.85 },
  },
  {
    id: 'lacus-rubresus',
    label: 'Lacus Rubresus, the Narbonne lagoon',
    z: 12,
    hull: [
      // Salel 2014's map "vers 550 / 50 av. n. ère" (after Faïsse et al.), fitted to
      // Narbonne, Port-la-Nautique, Peyriac, Pech Maho, Saint-Martin and Sainte-Lucie:
      // the west shore, the north shore at Port-la-Nautique and at the Aude mouth…
      [2.976, 43.138],
      [3.002, 43.146],
      [3.024, 43.126],
      // …under La Clape…
      [3.041, 43.143],
      [3.063, 43.143],
      [3.088, 43.134],
      [3.114, 43.128],
      // …the barrier, landward of today's, north to south…
      [3.12, 43.134],
      [3.097, 43.11],
      [3.079, 43.085],
      [3.066, 43.054],
      [3.055, 43.027],
      // …and the west shore back north.
      [2.948, 43.049],
      [2.953, 43.096],
    ],
    method: { kind: 'sea', maxHeight: 3 },
    why:
      'One lagoon joining Bages–Sigean, Ayrolle and Gruissan, "very broad but admitting the sea by a narrow mouth" ' +
      '(Mela 2.81–82), with Saint-Martin and Sainte-Lucie islands in it; the Aude plain has filled its northern arm since. ' +
      'The map is schematic, to about 1.5 km.',
    minIslandKm2: 0.3,
    sites: [
      { name: 'Narbo Martius', at: [3.003, 43.184], prov: 'above the lake (Strabo 4.1.6)', expect: 'land' },
    ],
  },

  // --- the Persian Gulf -----------------------------------------------------------

  {
    id: 'persian-gulf-head',
    label: 'The head of the Persian Gulf',
    z: 9,
    hull: [
      // Ours throughout, and uncertain to 15–25 km: no study dates a line here. It takes
      // Juba's 50 miles from Charax to the sea (Pliny 6.138–140) along the channel, and
      // reads Hansman's Chaldean Lakes behind it as marsh, not sea. From the Kuwait side…
      [47.9, 30.1],
      // …the head of the Khor al-Zubair, the Euphrates' separate mouth…
      [47.75, 30.3],
      // …north of Abadan, across the Tigris–Karun estuary…
      [48.0, 30.25],
      [48.3, 30.3],
      [48.6, 30.36],
      // …the head of the Khor Musa, at the south edge of the Shadegan flats…
      [48.9, 30.55],
      [49.2, 30.52],
      [49.5, 30.4],
      // …to Hendijan, where the coast was near today's, closing on it past the town.
      [49.7, 30.28],
      [49.85, 30.15],
      // Out into the Gulf, and back up the Khor Abdullah, leaving Bubiyan and Warbah
      // outside: they already existed about 4000 BP (Reinink-Smith & Carter 2022).
      [49.85, 29.8],
      [48.6, 29.72],
      [48.35, 29.95],
      [48.15, 30.02],
      [47.97, 30.05],
    ],
    method: { kind: 'sea', maxHeight: 3 },
    // The belt of tidal and salt flats every study describes, drawn as shallows 20 km deep.
    shelfKm: 20,
    why:
      'The Khuzestan coast was stable from 5500 BP and began to build out only about 2500 BP (Heyvaert & Baeteman 2007), ' +
      'and the Shatt al-Arab’s delta is later still, so the Fao peninsula, Abadan and the flats south of Shadegan were sea or ' +
      'tidal flat. Every study describes a belt of flats and marsh tens of km wide rather than a sharp coast; the map draws ' +
      'one line inside that belt. The ground here stands at 0–2 m.',
    minIslandKm2: 5,
    sites: [
      { name: 'Charax Spasinou', at: [47.578, 30.895], prov: 'Jebel Khayyaber; 50 miles from the sea in Juba’s day', expect: 'land' },
    ],
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
