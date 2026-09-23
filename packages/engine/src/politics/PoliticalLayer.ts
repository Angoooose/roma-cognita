import * as THREE from 'three/webgpu'
import { uniform } from 'three/tsl'
import { ROOT, TILE_TEXELS } from '@roman-map/world'
import { toHalf } from '../terrain/half.ts'
import { polityStyle } from './palette.ts'

/**
 * Who held what, when — the half of the political layer that changes with the year
 * (DESIGN.md §7.3). Terrain tiles carry only which atoms meet where; this turns the
 * claims table into per-atom colour tables for a year, which the terrain shader
 * reads. Changing the year rewrites a 2048×3 texture, never a tile.
 *
 * Two tables, `from` and `to`, and a mix between them: a year change cross-fades.
 */

/** Width of the tables: one column per label. Labels are exact in half floats to 2048. */
export const TABLE_WIDTH = 2048
/** Rows: 0 fill (linear rgb, alpha), 1 ids (polity, power, evidence, is-sea), 2 border ink (rgb, is-client). */
const ROWS = 3

function table() {
  const t = new THREE.DataTexture(
    new Uint16Array(TABLE_WIDTH * ROWS * 4),
    TABLE_WIDTH,
    ROWS,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  )
  t.minFilter = t.magFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.colorSpace = THREE.NoColorSpace
  t.needsUpdate = true
  return t
}

/** Shared by every terrain tile's material. */
export const politicsTables = { from: table(), to: table() }

export const politicsUniforms = {
  /** 0 shows `from`, 1 shows `to`. */
  mix: uniform(1),
  /** How strongly fills cover the ground; set from the zoom (§7.6). */
  fill: uniform(0.6),
  /** Border glow strength; rises as fills fade out close in. */
  glow: uniform(0.5),
  /** Master switch, for a physical-only view. */
  enabled: uniform(1),
}

// --- data.json, as written by pipeline/src/politics/build.ts ----------------------

interface End {
  year: number
  text: string
}
interface SourceRef {
  source: string
  locator?: string
}
export interface ClaimRecord {
  atom: string
  polity: string
  relation: 'province' | 'citizen-territory' | 'client' | 'allied' | 'independent' | 'occupied'
  from: End
  to: End
  confidence: 'certain' | 'probable' | 'uncertain'
  review: string
  sources: SourceRef[]
  note?: string
}
interface RelationRecord {
  polity: string
  type: 'province-of' | 'citizen-territory-of' | 'client-of' | 'allied-to' | 'subject-of'
  of: string
  from: End
  to: End
}
export interface PolityRecord {
  id: string
  kind: string
  name: string
  ruler?: string
}
interface AtomRecord {
  id: string
  evidence: 'surveyed' | 'derived' | 'schematic'
  confidence: string
}
interface PoliticsData {
  window: [number, number]
  sea: number
  atoms: AtomRecord[]
  polities: PolityRecord[]
  claims: ClaimRecord[]
  relations: RelationRecord[]
  sources: Record<string, { citation: string; url?: string }>
}

/** What the inspector shows for a point on the map. */
export interface PoliticalHit {
  atom: string
  /** The holding claim in force this year, if any. */
  claim?: ClaimRecord
  polity?: PolityRecord
  /** The top of the chain of `province-of` / `client-of` links. */
  power?: PolityRecord
  /** The chain itself, polity first. */
  chain: { polity: PolityRecord; type: RelationRecord['type'] }[]
  sources: { citation: string; url?: string; locator?: string }[]
}

const covers = (r: { from: End; to: End }, year: number) => r.from.year <= year && year <= r.to.year
const EVIDENCE = { surveyed: 0, derived: 1, schematic: 2 } as const
/** Relations that make a polity part of another power, rather than an ally of it. */
const SUBORDINATE = new Set(['province-of', 'citizen-territory-of', 'client-of', 'subject-of'])

export class PoliticalLayer {
  data: PoliticsData | null = null
  year = 0
  private polityIndex = new Map<string, number>()
  private polityById = new Map<string, PolityRecord>()
  private fade: { start: number; ms: number } | null = null
  private index: { maxLevel: number; distanceTexels: number; levels: Uint16Array[]; palettes: Record<string, number[]> } | null =
    null
  private pickTiles = new Map<string, Promise<ImageData | null>>()

  async load() {
    const [data, index] = await Promise.all([
      fetch('/politics/data.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/politics/index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
    if (index) {
      this.index = {
        ...index,
        levels: (index.levels as string[]).map((b) => new Uint16Array(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)).buffer)),
      }
    }
    if (!data) return
    this.data = data as PoliticsData
    this.data.polities.forEach((p, k) => {
      this.polityIndex.set(p.id, k + 1)
      this.polityById.set(p.id, p)
    })
    this.year = this.data.window[0]
    this.write(politicsTables.to, this.year)
    this.write(politicsTables.from, this.year)
  }

  get window(): [number, number] | null {
    return this.data?.window ?? null
  }

  /** Shows `year`; with `animate`, cross-fades from what is on screen now. */
  setYear(year: number, opts: { animate?: boolean } = {}) {
    if (!this.data) return
    year = Math.round(year)
    if (year === this.year) return
    this.year = year
    if (opts.animate) {
      // The current mix becomes the new start: copy what `to` holds into `from`.
      const from = politicsTables.from.image.data as Uint16Array
      const to = politicsTables.to.image.data as Uint16Array
      if (politicsUniforms.mix.value < 0.5) to.set(from)
      from.set(to)
      politicsTables.from.needsUpdate = true
      this.fade = { start: performance.now(), ms: 350 }
      politicsUniforms.mix.value = 0
    } else {
      this.fade = null
      politicsUniforms.mix.value = 1
    }
    this.write(politicsTables.to, year)
    if (!opts.animate) this.write(politicsTables.from, year)
  }

  /** Advances a cross-fade; true while one is running. */
  tick(now: number) {
    if (!this.fade) return false
    const t = Math.min(1, (now - this.fade.start) / this.fade.ms)
    politicsUniforms.mix.value = t * t * (3 - 2 * t)
    if (t >= 1) this.fade = null
    return true
  }

  /** The power a polity answers to in `year`, and the chain of links to it. */
  resolve(polity: string, year: number) {
    const chain: { polity: string; type: RelationRecord['type'] }[] = []
    let client = false
    let at = polity
    for (let guard = 0; guard < 8; guard++) {
      const link = this.data!.relations.find((r) => r.polity === at && SUBORDINATE.has(r.type) && covers(r, year))
      if (!link) break
      chain.push({ polity: at, type: link.type })
      if (link.type === 'client-of' || link.type === 'subject-of') client = true
      at = link.of
    }
    return { power: at, chain, client }
  }

  private holding(atom: string, year: number) {
    // Occupation is a separate layer (packages/schema claimLayer); v1 draws holdings.
    return this.data!.claims.find((c) => c.atom === atom && c.relation !== 'occupied' && covers(c, year))
  }

  private write(tex: THREE.DataTexture, year: number) {
    const d = this.data!
    const buf = tex.image.data as Uint16Array
    buf.fill(0)
    const set = (label: number, row: number, v: [number, number, number, number]) => {
      const o = (row * TABLE_WIDTH + label) * 4
      for (let k = 0; k < 4; k++) buf[o + k] = toHalf(v[k])
    }
    const seaLabel = d.sea
    set(seaLabel, 1, [0, 0, 0, 1])
    d.atoms.forEach((atom, k) => {
      const label = k + 1
      const ev = EVIDENCE[atom.evidence] ?? 2
      const claim = this.holding(atom.id, year)
      if (!claim) {
        set(label, 1, [0, 0, ev, 0])
        return
      }
      const { power, client } = this.resolve(claim.polity, year)
      const isClient = client || claim.relation === 'client'
      const style = polityStyle(claim.polity, power, {
        client: isClient,
        core: claim.polity === power || claim.relation === 'citizen-territory',
      })
      // An uncertain claim is drawn fainter: the map says less where the sources do.
      const alpha = claim.confidence === 'uncertain' ? 0.72 : 1
      set(label, 0, [style.fill.r, style.fill.g, style.fill.b, alpha])
      set(label, 1, [this.polityIndex.get(claim.polity) ?? 0, this.polityIndex.get(power) ?? 0, ev, 0])
      set(label, 2, [style.line.r, style.line.g, style.line.b, isClient ? 1 : 0])
    })
    tex.needsUpdate = true
  }

  /** The atom under a point on the plane, and what held it in the current year. */
  async pick(x: number, y: number): Promise<PoliticalHit | null> {
    const d = this.data
    const idx = this.index
    if (!d || !idx) return null
    const level = idx.maxLevel
    const size = ROOT.size / 2 ** level
    const i = Math.floor((x - ROOT.x) / size)
    const j = Math.floor((y - ROOT.y) / size)
    const n = 2 ** level
    if (i < 0 || j < 0 || i >= n || j >= n) return null
    let label = idx.levels[level][j * n + i]
    if (label === 0xffff) {
      const key = `${level}/${i}/${j}`
      const img = await this.pickTile(key)
      if (!img) return null
      const N = TILE_TEXELS
      const step = size / (N - 1)
      const c = Math.round((x - (ROOT.x + i * size)) / step)
      const r = N - 1 - Math.round((y - (ROOT.y + j * size)) / step)
      const k = (r * N + c) * 4
      const pal = idx.palettes[key]
      label = img.data[k + 2] > 127 ? pal[img.data[k + 1]] : pal[img.data[k]]
    }
    if (label === 0 || label === d.sea) return null
    const atom = d.atoms[label - 1]
    if (!atom) return null
    const claim = this.holding(atom.id, this.year)
    if (!claim) return { atom: atom.id, chain: [], sources: [] }
    const { power, chain } = this.resolve(claim.polity, this.year)
    return {
      atom: atom.id,
      claim,
      polity: this.polityById.get(claim.polity),
      power: this.polityById.get(power),
      chain: chain.map((l) => ({ polity: this.polityById.get(l.polity)!, type: l.type })).filter((l) => l.polity),
      sources: claim.sources.map((s) => ({ ...(d.sources[s.source] ?? { citation: s.source }), locator: s.locator })),
    }
  }

  private pickTile(key: string) {
    let p = this.pickTiles.get(key)
    if (!p) {
      p = fetch(`/politics/${key}.webp`)
        .then((r) => (r.ok ? r.blob() : null))
        .then(async (b) => {
          if (!b) return null
          const bmp = await createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
          const canvas = new OffscreenCanvas(bmp.width, bmp.height)
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!
          ctx.drawImage(bmp, 0, 0)
          return ctx.getImageData(0, 0, bmp.width, bmp.height)
        })
        .catch(() => null)
      this.pickTiles.set(key, p)
    }
    return p
  }
}
