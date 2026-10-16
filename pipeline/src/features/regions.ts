/**
 * The floodplain regions the derivation builds, each with an authored loose hull,
 * its channels, its threshold and the published figures its area is compared to.
 *
 * **Hulls** are deliberately generous (10–25 vertices, drawn by us over a DEM
 * preview with a graticule, never traced from any atlas). A hull says only "the
 * floodplain of this region is somewhere in here, and nothing else low is": it
 * keeps out oases, desert depressions (Tharthar, Habbaniyah, Razzaza), the Fayum
 * from the valley and the Khabur basin from the Euphrates. The edge of the plain
 * itself comes from the terrain. Where a hull edge is a real boundary — the
 * valley/delta line at Memphis, the Mesopotamia/Susiana line — it is noted.
 * Hulls run out over the sea on purpose; the coast comes from OSM land polygons.
 *
 * **Methods.**
 * - `hand`: height above the nearest channel (HAND). Every pixel takes the
 *   smoothed water-surface elevation of the nearest channel pixel; ground no
 *   more than `maxHeight` metres above it is floodplain. This is what finds the
 *   foot of the Nile cliffs and the edge of the Mesopotamian alluvium.
 * - `band`: absolute elevation between `min` and `max`. For the Fayum, which is
 *   a depression watered by gravity canals from the Bahr Yusuf and bounded below
 *   by the lake, so "height above the river" means nothing there.
 *
 * Thresholds are argued in each region's `why`. They were set by looking at the
 * previews (does the edge sit at the foot of the scarp?), not by fitting the
 * published areas; the areas are printed next to them as a check.
 *
 * **Regions exclude each other** in order: a region's floodplain is cut by the
 * hulls of the regions listed before it in `REGIONS`, so no ground is counted twice.
 */
import type { Bbox } from '../lib/dem.ts'
import type { Pt } from '../lib/grid.ts'

export type ChannelSpec =
  | {
      kind: 'hydrorivers'
      region: 'af' | 'eu'
      /** Mean discharge floor, m³/s: picks the main stems and leaves the wadis. */
      minQ: number
      /** Keep only the parts of the lines inside this box. */
      clip?: Bbox
    }
  | { kind: 'delta-branches' }

export interface Published {
  label: string
  lowKm2: number
  highKm2: number
  source: string
  /** Whether we have checked the figure against the work itself. */
  checked: boolean
}

export interface Site {
  name: string
  at: Pt
  prov: string
  /** What we expect: on the floodplain, on its desert edge, or off it. Reported, not enforced. */
  expect: 'in' | 'edge' | 'out'
}

export interface Region {
  id: string
  label: string
  /** Mapterhorn zoom: z10 is ~66–72 m/px at these latitudes. */
  z: number
  hull: Pt[]
  channels: ChannelSpec[]
  method:
    | {
        kind: 'hand'
        maxHeight: number
        /**
         * Also require the ground to be this flat (rise over run, on terrain smoothed
         * over ~1 km). Where the desert rises too gently for a height threshold to
         * find its edge — the Southern Desert beyond the Euphrates — the alluvium's
         * 1:10,000 gradient still sets it apart from a 1:1,000 pediment.
         */
        maxSlope?: number
        /**
         * With `maxSlope`: close the flat mask by this many km (dilate, then erode)
         * and keep what is also within `maxHeight`. The slope test is for the outer
         * edge only; inside the plain it would cut out every levee ridge, canal bank
         * and tell, which are the alluvium too.
         */
        closeKm?: number
      }
    | { kind: 'band'; min: number; max: number }
  why: string
  clean: {
    /** Pieces of floodplain smaller than this are dropped (km²). */
    minSpeckKm2: number
    /** Enclosed gaps smaller than this are filled (km²): villages and towns on the DSM, levee noise. */
    maxHoleKm2: number
  }
  published: Published[]
  sites: Site[]
  /** Preview panels; the hull's box when omitted. */
  views?: Bbox[]
}

const MEMPHIS_LAT = 29.8495 // Pleiades 736963

export const REGIONS: Region[] = [
  {
    id: 'fayum-floodplain',
    label: 'Fayum (Arsinoite nome)',
    z: 10,
    hull: [
      [31.12, 29.45],
      [31.1, 29.58],
      [30.92, 29.6],
      [30.8, 29.5], // round Karanis, then along the Ptolemaic lake: the north shore was desert,
      [30.55, 29.46], // out of reach of the canals (Soknopaiou Nesos stood on it)
      [30.35, 29.455],
      [30.22, 29.43],
      [30.3, 29.35],
      [30.45, 29.3], // keeps out the Wadi Rayan depression (modern drainage lakes)
      [30.53, 29.15],
      [30.6, 29.03],
      [30.7, 29.0],
      [30.8, 29.1], // the south-east edge stays west of the valley floodplain at el-Lahun
      [30.88, 29.2],
      [30.93, 29.27], // Hawara, inside the Fayum entrance
      [31.04, 29.36],
    ],
    channels: [],
    method: { kind: 'band', min: -45, max: 26 },
    why:
      'The Fayum is a depression, not a valley: cultivation runs downhill from the Bahr Yusuf inlet at el-Lahun to the lake. ' +
      'Lower bound: the lake itself. It stood near −2 m after the reclamation under Ptolemy II (Ball 1939; Caton-Thompson & Gardner 1934), ' +
      'against Lake Qarun’s −43 m now, and is drawn by the landscape change lake-moeris, which clips this band as it clips the coast; ' +
      'so the band runs down to the modern lake bed and the lake takes what was water. A band stopping at −2 m left the modern drains ' +
      'cut below that level as strips of desert through the fields. ' +
      'Upper bound: the canal command near the Lahun inlet, set so the Ptolemaic edge villages (Karanis, Bakchias, Philadelpheia, ' +
      'Theadelpheia, Dionysias, Tebtunis, Narmouthis) sit on or just outside the edge — villages were built on the desert margin above the fields.',
    clean: { minSpeckKm2: 2, maxHoleKm2: 10 },
    published: [
      {
        label: 'Ptolemaic Arsinoite cultivated land',
        lowKm2: 1200,
        highKm2: 1800,
        source: 'order of magnitude of the Ptolemaic reclamation as usually cited (Rathbone; Manning); modern Fayum farmland is c. 1,800 km²',
        checked: false,
      },
    ],
    sites: [
      { name: 'Krokodilopolis/Ptolemais Euergetis', at: [30.84, 29.315], prov: 'pleiades:736948', expect: 'in' },
      { name: 'Karanis', at: [30.9034, 29.5182], prov: 'pleiades:736932', expect: 'edge' },
      { name: 'Bakchias', at: [31.0042, 29.5369], prov: 'pleiades:736896', expect: 'edge' },
      { name: 'Philadelpheia', at: [31.0803, 29.4538], prov: 'pleiades:737008', expect: 'edge' },
      { name: 'Soknopaiou Nesos', at: [30.6689, 29.5335], prov: 'pleiades:737053', expect: 'out' },
      { name: 'Theadelpheia', at: [30.497, 29.3481], prov: 'pleiades:737081', expect: 'edge' },
      { name: 'Dionysias', at: [30.4174, 29.4064], prov: 'pleiades:736904', expect: 'edge' },
      { name: 'Narmouthis', at: [30.6419, 29.1923], prov: 'pleiades:736972', expect: 'edge' },
    ],
  },
  {
    id: 'nile-valley-floodplain',
    label: 'Nile valley, First Cataract to Memphis',
    z: 10,
    hull: [
      // west bank, south to north
      [32.78, 24.07], // just below the First Cataract (Elephantine 24.09 N)
      [32.72, 24.6],
      [32.6, 25.05],
      [32.3, 25.35],
      [32.35, 25.75],
      [32.15, 25.88],
      [31.95, 26.02],
      [31.55, 26.35],
      [31.2, 26.75],
      [30.8, 27.05],
      [30.4, 27.4],
      [30.42, 28.0],
      [30.5, 28.65],
      [30.7, 29.0], // generous: the Fayum hull, derived first, is the real line here
      [30.8, 29.3],
      [31.0, 29.6],
      [31.1, MEMPHIS_LAT], // the valley ends at Memphis, the "balance of the Two Lands"
      // east bank, north to south
      [31.45, MEMPHIS_LAT],
      [31.4, 29.3],
      [31.2, 28.8],
      [31.05, 28.2],
      [31.08, 27.6],
      [31.4, 27.25],
      [31.75, 26.95],
      [32.1, 26.55],
      [32.5, 26.3],
      [32.98, 26.25],
      [33.0, 25.5],
      [33.1, 25.0],
      [33.05, 24.5],
      [33.0, 24.07],
    ],
    channels: [{ kind: 'hydrorivers', region: 'af', minQ: 500 }],
    method: { kind: 'hand', maxHeight: 8 },
    why:
      'The flood rose some 7–8 m above low water in Upper Egypt, and the floodplain surface stands a few metres above the modern ' +
      '(regulated) river. 8 m above the smoothed water surface puts the edge at the foot of the cliffs and low desert in the previews; ' +
      'higher values climb the wadi fans and the low desert terraces.',
    clean: { minSpeckKm2: 1, maxHoleKm2: 8 },
    published: [
      {
        label: 'Valley floodplain (Aswan–Cairo), modern and ancient estimates',
        lowKm2: 9000,
        highKm2: 12500,
        source: 'Butzer 1976 treats the valley and delta separately; the valley floodplain is of the order of 10,000–12,000 km² — to verify against Butzer 1976',
        checked: false,
      },
    ],
    sites: [
      { name: 'Syene', at: [32.9015, 24.0886], prov: 'pleiades:786123', expect: 'edge' },
      { name: 'Apollonopolis Magna (Edfu)', at: [32.8724, 24.9779], prov: 'pleiades:785974', expect: 'edge' },
      { name: 'Latopolis (Esna)', at: [32.5532, 25.2937], prov: 'pleiades:786059', expect: 'in' },
      { name: 'Diospolis Magna (Thebes)', at: [32.6319, 25.6648], prov: 'pleiades:786017', expect: 'in' },
      { name: 'Tentyra', at: [32.6704, 26.1425], prov: 'pleiades:786127', expect: 'edge' },
      { name: 'Abydos', at: [31.9176, 26.1851], prov: 'pleiades:756512', expect: 'edge' },
      { name: 'Panopolis', at: [31.7452, 26.5649], prov: 'pleiades:756613', expect: 'in' },
      { name: 'Lykopolis (Asyut)', at: [31.1825, 27.1813], prov: 'pleiades:756593', expect: 'in' },
      { name: 'Antinoopolis', at: [30.881, 27.8106], prov: 'pleiades:756518', expect: 'edge' },
      { name: 'Oxyrhynchus', at: [30.6517, 28.5426], prov: 'pleiades:736983', expect: 'edge' },
      { name: 'Memphis', at: [31.255061, 29.849491], prov: 'pleiades:736963', expect: 'in' },
    ],
    views: [
      { west: 32.2, south: 24.0, east: 33.2, north: 26.35 },
      { west: 30.4, south: 26.0, east: 32.9, north: 27.9 },
      { west: 30.3, south: 27.6, east: 31.6, north: 29.9 },
    ],
  },
  {
    id: 'nile-delta-floodplain',
    label: 'Nile delta, Memphis to the sea',
    z: 10,
    hull: [
      [31.1, MEMPHIS_LAT], // shared edge with the valley
      [30.95, 30.05],
      [30.55, 30.35],
      [30.15, 30.75],
      [29.85, 31.1],
      [29.95, 31.4],
      [30.3, 31.65],
      [31.0, 31.75],
      [31.85, 31.7],
      [32.3, 31.45],
      [32.75, 31.2],
      [32.75, 30.95],
      [32.4, 30.8],
      [32.3, 30.55],
      [31.85, 30.4],
      [31.6, 30.05],
      [31.45, MEMPHIS_LAT],
    ],
    channels: [
      { kind: 'delta-branches' },
      // The single stream from Memphis to the fork at Kerkasoros.
      { kind: 'hydrorivers', region: 'af', minQ: 500, clip: { west: 30.9, south: 29.7, east: 31.6, north: 30.1 } },
    ],
    method: { kind: 'hand', maxHeight: 4 },
    why:
      'The delta falls only ~17 m from apex to sea, so a small height above the nearest of the seven branches separates the alluvium ' +
      'from the desert margins and the sand ridges (gezira) of the east. 4 m puts the edge at the break of slope onto the western ' +
      'desert and the Wadi Tumilat/Salhiya sands in the previews.',
    clean: { minSpeckKm2: 1, maxHoleKm2: 8 },
    published: [
      {
        label: 'Delta cultivable land (ancient estimates)',
        lowKm2: 12000,
        highKm2: 22000,
        source: 'Butzer 1976 on the delta’s cultivable area by period — to verify; the whole delta triangle is ~22,000 km² including lagoons',
        checked: false,
      },
    ],
    sites: [
      { name: 'Kerkasoros', at: [31.21826, 30.084523], prov: 'pleiades:727142', expect: 'in' },
      { name: 'Heliopolis', at: [31.3074812, 30.1294036], prov: 'pleiades:727117', expect: 'edge' },
      { name: 'Sais', at: [30.774367, 30.96715], prov: 'pleiades:727217', expect: 'in' },
      { name: 'Naucratis', at: [30.5919, 30.9005], prov: 'pleiades:727169', expect: 'in' },
      { name: 'Bubastis', at: [31.5110853352, 30.5723823112], prov: 'pleiades:727088', expect: 'in' },
      { name: 'Tanis', at: [31.8836195624, 30.9754528374], prov: 'pleiades:727236', expect: 'in' },
      { name: 'Mendes', at: [31.51741, 30.956115], prov: 'pleiades:727156', expect: 'in' },
      { name: 'Pelusium', at: [32.5473404, 31.0427587], prov: 'pleiades:727192', expect: 'edge' },
      { name: 'Alexandria', at: [29.9098, 31.2014], prov: 'pleiades:727070', expect: 'out' },
    ],
  },
  {
    id: 'mesopotamian-alluvium',
    label: 'Mesopotamian alluvium (Babylonia, Sumer, Characene)',
    z: 10,
    hull: [
      [42.78, 33.72], // Hit: the alluvium begins below Hit on the Euphrates…
      [43.35, 33.62],
      [43.7, 33.85],
      [43.85, 34.3], // …and below Samarra on the Tigris
      [44.1, 34.3],
      [44.5, 34.25],
      [44.95, 34.1], // Jebel Hamrin
      [45.55, 33.85], // Mandali
      [46.1, 33.25], // Badra
      [46.7, 32.8],
      [47.25, 32.45], // Zagros foothills at the Iranian border
      [47.5, 32.1],
      [47.7, 31.75], // Hawizeh marsh: from here south the line to Susiana is a boundary
      [47.8, 31.2],
      [47.95, 30.8],
      [48.1, 30.45],
      [48.6, 29.85], // out to sea past Fao
      [48.0, 29.75],
      [47.75, 30.05],
      [47.3, 30.35],
      [46.6, 30.55],
      [46.0, 30.72], // Eridu, on the edge of the alluvium
      [45.7, 30.95],
      [45.15, 31.2], // out in the desert beyond the Euphrates at Samawa
      [44.6, 31.45],
      [44.35, 31.8], // skirts the Bahr al-Najaf depression
      [44.25, 32.2], // Najaf/Kufa escarpment
      [44.05, 32.6], // Karbala: the desert edge; keeps out Razzaza
      [44.0, 32.95],
      [43.75, 33.3], // Fallujah: keeps out Habbaniyah
      [43.3, 33.42],
      [42.78, 33.6],
    ],
    channels: [{ kind: 'hydrorivers', region: 'eu', minQ: 100 }],
    method: { kind: 'hand', maxHeight: 6, maxSlope: 0.0006, closeKm: 3 },
    why:
      'The alluvium is a very flat plain on which the rivers run on their own levees, so much of it lies at or below the nearest ' +
      'channel. 6 m above the channel reaches the break onto the Western Desert and the Zagros piedmont in the previews without ' +
      'climbing the gypsum plateau between the rivers above Baghdad.',
    clean: { minSpeckKm2: 3, maxHoleKm2: 60 },
    published: [
      {
        label: 'Southern Mesopotamian alluvial plain',
        lowKm2: 50000,
        highKm2: 100000,
        source: 'no figure checked: Adams 1981 surveys only part of the plain; this is an order-of-magnitude check from its dimensions (~500 km × 150–200 km)',
        checked: false,
      },
    ],
    sites: [
      { name: 'Babylon', at: [44.425, 32.5373], prov: 'pleiades:893951', expect: 'in' },
      { name: 'Seleucia on the Tigris', at: [44.5238, 33.0979], prov: 'pleiades:894084', expect: 'in' },
      { name: 'Nippur', at: [45.2306, 32.1268], prov: 'pleiades:912910', expect: 'in' },
      { name: 'Uruk', at: [45.6391, 31.3234], prov: 'pleiades:912986', expect: 'in' },
      { name: 'Sippar', at: [44.2542, 33.0597], prov: 'pleiades:894089', expect: 'in' },
      { name: 'Eridu', at: [45.9956, 30.82], prov: 'pleiades:912845', expect: 'edge' },
      { name: 'Charax Spasinou (Jebel Khayabir)', at: [47.5628, 30.8093], prov: 'pleiades:912872', expect: 'in' },
      { name: 'Samarra', at: [43.8767, 34.2001], prov: 'pleiades:894082', expect: 'edge' },
      { name: 'Hit', at: [42.8215, 33.6436], prov: 'pleiades:894008', expect: 'edge' },
    ],
  },
  {
    id: 'susiana-plain',
    label: 'Susiana (Khuzestan plain)',
    z: 10,
    hull: [
      [47.3, 32.55],
      [47.8, 32.5],
      [48.1, 32.45], // where the Karkheh leaves the hills; its modern reservoir stays out
      [48.35, 32.55], // above Dezful, below the Dez dam
      [48.8, 32.3],
      [49.05, 31.95], // Shushtar–Masjed Soleyman foothills; the strike valleys beyond stay out
      [49.2, 31.5],
      [49.35, 31.15],
      [49.6, 30.75],
      [49.4, 30.3],
      [48.6, 29.85],
      [48.1, 30.45], // the Mesopotamian hull takes the Shatt al-Arab
      [47.8, 31.2],
      [47.5, 32.1],
    ],
    channels: [{ kind: 'hydrorivers', region: 'eu', minQ: 50 }],
    method: { kind: 'hand', maxHeight: 12 },
    why:
      'Susiana is a set of coalescing fans: the Karkheh, Dez and Karun run somewhat incised across the upper plain (near Dezful and ' +
      'Shushtar), so the threshold is higher than in Mesopotamia. 12 m reaches the foot of the Zagros foothills in the previews.',
    clean: { minSpeckKm2: 3, maxHoleKm2: 25 },
    published: [
      {
        label: 'Khuzestan lowland plain',
        lowKm2: 15000,
        highKm2: 35000,
        source: 'no ancient figure found; order of magnitude of the Khuzestan lowland from its dimensions — to verify',
        checked: false,
      },
    ],
    sites: [
      { name: 'Susa', at: [48.2535, 32.1899], prov: 'pleiades:912936', expect: 'in' },
      { name: 'Shushtar', at: [48.85, 32.05], prov: 'pleiades:912941', expect: 'edge' },
      { name: 'Dezful', at: [48.3982, 32.383], prov: 'pleiades:903015', expect: 'edge' },
    ],
  },
  {
    id: 'middle-euphrates-valley',
    label: 'Middle Euphrates valley (Syria)',
    z: 10,
    hull: [
      // north bank, west to east
      [38.6, 35.93], // below the Tabqa dam: upstream the valley is under Lake Assad
      [39.0, 36.0],
      [39.35, 35.9],
      [39.75, 35.8],
      [39.97, 35.58],
      [40.3, 35.4],
      [40.55, 35.25], // lets in only the last ~10 km of the Khabur valley above Circesium
      [40.63, 34.98],
      [40.9, 34.82],
      [41.07, 34.55],
      [41.1, 34.42], // the Syrian–Iraqi border below Abu Kamal
      // south bank, east to west
      [40.95, 34.36],
      [40.8, 34.45],
      [40.6, 34.75],
      [40.4, 34.95],
      [40.3, 35.15],
      [40.05, 35.25],
      [39.75, 35.55],
      [39.65, 35.72],
      [39.3, 35.8],
      [39.0, 35.86],
      [38.75, 35.82],
      [38.6, 35.82],
    ],
    channels: [{ kind: 'hydrorivers', region: 'eu', minQ: 100 }],
    method: { kind: 'hand', maxHeight: 8 },
    why:
      'A narrow Holocene floor between Pleistocene terraces and the plateau scarp. 8 m keeps the edge at the first terrace riser in ' +
      'the previews; the terraces themselves were dry-farmed, not flood-watered.',
    clean: { minSpeckKm2: 0.5, maxHoleKm2: 5 },
    published: [
      {
        label: 'Middle Euphrates floodplain, Tabqa–Abu Kamal',
        lowKm2: 1500,
        highKm2: 3500,
        source: 'no published figure found; a valley floor 4–12 km wide over ~350 km — order-of-magnitude check only',
        checked: false,
      },
    ],
    sites: [
      { name: 'Dura-Europos', at: [40.7299, 34.7479], prov: 'pleiades:893990', expect: 'edge' },
      { name: 'Circesium', at: [40.43, 35.1566], prov: 'pleiades:893974', expect: 'in' },
      { name: 'Zenobia', at: [39.8216, 35.6893], prov: 'pleiades:894185', expect: 'edge' },
    ],
  },
]
