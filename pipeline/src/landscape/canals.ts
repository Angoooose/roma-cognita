/**
 * Geometry for the landscape corrections that remove modern water: the Suez and
 * Corinth canals and Lake Tharthar, written into data/geometry/landscape-changes.geojson
 * beside the other generators' shapes (see shapes.ts).
 *
 *   npx tsx pipeline/src/landscape/canals.ts
 *
 * The canals are drawn as corridors along their centrelines, and the centrelines come
 * from the coastline data itself: `probe-canal.ts` walks the OSM land polygons row by
 * row across the isthmus and prints every narrow water channel it crosses, and the
 * points below are read off that output (22 Sept 2026 OSM extract). So a correction
 * covers exactly the channel the coast build would otherwise draw, and no more:
 *
 * - The Bitter Lakes and Lake Timsah are left alone. They are not canal. Strabo
 *   (17.1.25) has the Ptolemaic canal running through the Bitter Lakes, so there was
 *   water there in our period; its extent is a separate question for a later record.
 * - Where the 2015 New Suez Canal runs beside the old one, both channels are covered.
 *
 * Corridor half-widths are generous against a 300–600 m channel so the coast build's
 * 108 m texels cannot leave a sliver, but narrow enough not to reach the lagoons
 * beside the northern canal.
 */
import { projection } from '@roma-cognita/world'
import { type LandscapeShape, writeLandscapeShapes } from './shapes.ts'

type LonLat = [number, number]

/** Suez Canal channels, each as [lon, lat] points south to north, with a half-width in m. */
const SUEZ: { name: string; halfWidth: number; line: LonLat[] }[] = [
  {
    name: 'southern section, Gulf of Suez to the Little Bitter Lake',
    halfWidth: 450,
    line: [
      [32.583, 29.955],
      [32.5866, 29.9696],
      [32.5854, 29.9879],
      [32.5818, 30.0065],
      [32.5786, 30.0251],
      [32.5755, 30.0436],
      [32.5722, 30.0622],
      [32.5715, 30.0804],
      [32.571, 30.0986],
      [32.5708, 30.1168],
      [32.5701, 30.135],
      [32.5699, 30.1532],
      [32.5697, 30.1714],
    ],
  },
  {
    name: 'eastern channel, Great Bitter Lake to Lake Timsah',
    halfWidth: 450,
    line: [
      [32.357, 30.405],
      [32.3595, 30.4197],
      [32.3545, 30.4475],
      [32.3544, 30.4747],
      [32.3485, 30.5026],
      [32.343, 30.5304],
      [32.3374, 30.5583],
      [32.3315, 30.5862],
    ],
  },
  {
    name: 'western channel south of Lake Timsah',
    halfWidth: 400,
    line: [
      [32.3458, 30.4757],
      [32.34, 30.5036],
      [32.3235, 30.5327],
      [32.3055, 30.562],
    ],
  },
  {
    name: 'western channel north of Lake Timsah',
    halfWidth: 400,
    line: [
      [32.3015, 30.5897],
      [32.3231, 30.6143],
      [32.33, 30.6407],
      [32.3363, 30.6672],
      [32.3427, 30.6936],
      [32.3443, 30.7206],
      [32.3234, 30.7502],
      [32.3176, 30.7781],
      [32.3187, 30.8051],
    ],
  },
  {
    name: 'eastern channel north of Lake Timsah (2015)',
    halfWidth: 400,
    line: [
      [32.3315, 30.5862],
      [32.335, 30.6129],
      [32.3414, 30.6394],
      [32.3475, 30.6659],
      [32.3528, 30.6924],
      [32.3443, 30.7206],
      [32.3348, 30.7489],
      [32.3272, 30.777],
      [32.3187, 30.8051],
    ],
  },
  {
    name: 'northern section to Port Said',
    halfWidth: 450,
    line: [
      [32.3187, 30.8051],
      [32.3166, 30.8597],
      [32.3147, 30.9143],
      [32.3134, 30.9568],
      [32.3117, 31.0022],
      [32.3106, 31.0386],
      [32.3097, 31.0658],
      [32.3088, 31.0931],
      [32.3078, 31.1204],
      [32.3068, 31.1567],
      [32.3058, 31.1839],
      [32.305, 31.2021],
      [32.3048, 31.2203],
      [32.305, 31.2383],
      [32.31, 31.2559],
      [32.3205, 31.2637],
    ],
  },
  {
    name: 'eastern bypass and Port Said East channels',
    halfWidth: 450,
    line: [
      [32.3092, 31.1021],
      [32.3146, 31.1196],
      [32.3198, 31.1371],
      [32.325, 31.1546],
      [32.3327, 31.1808],
      [32.3412, 31.1889],
      [32.3434, 31.1977],
      [32.3426, 31.2159],
      [32.3487, 31.2333],
    ],
  },
]

/** The Corinth Canal, cut 1881–93, between Poseidonia and Isthmia. */
const CORINTH: LonLat[] = [
  [22.9585, 37.9395],
  [23.0055, 37.9165],
]

/**
 * Lake Tharthar: a dry salt depression (Wadi Tharthar) until the 1956 flood-relief
 * diversion from the Tigris filled it. HydroLAKES types it as a lake, so the reservoir
 * filter does not catch it. The box holds the whole lake, its northern arm included,
 * and nothing else that is water; Lake Habbaniyah lies just south of it.
 */
const THARTHAR: LonLat[] = [
  [42.7, 33.42],
  [43.8, 33.42],
  [43.8, 34.62],
  [42.7, 34.62],
  [42.7, 33.42],
]

/**
 * A corridor as one capsule polygon per segment (lon/lat, RFC 7946 winding). The coast
 * build fills polygons with a union, so overlapping capsules need no merging.
 */
function corridor(line: LonLat[], halfWidth: number): LonLat[][][] {
  const out: LonLat[][][] = []
  for (let k = 0; k + 1 < line.length; k++) {
    const [ax, ay] = projection.forward(...line[k])
    const [bx, by] = projection.forward(...line[k + 1])
    const len = Math.hypot(bx - ax, by - ay) || 1
    const ux = (bx - ax) / len
    const uy = (by - ay) / len
    const ring: LonLat[] = []
    // Half circles around each end, counter-clockwise: b's cap then a's.
    for (const [cx, cy, start] of [
      [bx, by, -Math.PI / 2],
      [ax, ay, Math.PI / 2],
    ] as const) {
      for (let s = 0; s <= 8; s++) {
        const t = start + (s / 8) * Math.PI
        const dx = Math.cos(t) * ux - Math.sin(t) * uy
        const dy = Math.sin(t) * ux + Math.cos(t) * uy
        ring.push(projection.inverse(cx + dx * halfWidth, cy + dy * halfWidth))
      }
    }
    ring.push(ring[0])
    out.push([ring])
  }
  return out
}

const round = (p: LonLat): LonLat => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]

const features: LandscapeShape[] = [
  {
    type: 'Feature',
    id: 'suez-canal',
    properties: {
      derivation:
        'pipeline/src/landscape/canals.ts: corridors along channel centrelines read from probe-canal.ts over the OSM land polygons, 22 Sept 2026',
    },
    geometry: {
      type: 'MultiPolygon',
      coordinates: SUEZ.flatMap((c) => corridor(c.line, c.halfWidth)).map((p) => p.map((r) => r.map(round))),
    },
  },
  {
    type: 'Feature',
    id: 'corinth-canal',
    properties: { derivation: 'pipeline/src/landscape/canals.ts: corridor along the canal axis' },
    geometry: {
      type: 'MultiPolygon',
      coordinates: corridor(CORINTH, 150).map((p) => p.map((r) => r.map(round))),
    },
  },
  {
    type: 'Feature',
    id: 'lake-tharthar',
    properties: { derivation: 'pipeline/src/landscape/canals.ts: box around the modern lake' },
    geometry: { type: 'Polygon', coordinates: [THARTHAR] },
  },
]

writeLandscapeShapes(features)
