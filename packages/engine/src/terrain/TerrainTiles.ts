import * as THREE from 'three/webgpu'
import { DATA_RECT, ROOT, TILE_TEXELS } from '@roman-map/world'
import { createTerrainMaterial } from './material.ts'
import type { TileJob, TileResult } from './heightWorker.ts'

/**
 * A quadtree of terrain tiles over the Albers plane.
 *
 * Selection is by screen-space texel size: a tile splits while one of its texels would
 * cover more than about a pixel. That keeps texel density roughly constant on screen at
 * every zoom and tilt, which is what makes the relief read the same at any scale.
 *
 * While a tile is loading, its nearest loaded ancestor stands in for it. Detail
 * therefore only ever arrives — the map never goes blank while zooming — which is the
 * "zooming in adds detail, never removes it" rule applied to loading.
 */

const TEXELS = TILE_TEXELS
/** Mesh segments per side. Lighting is per-texel, so the mesh can be coarser. */
const SEGMENTS = 64
const MAX_LEVEL = 11
/** Split while a texel would cover more than this many device pixels. */
const SPLIT_TEXEL_PX = 1.25
const WORKERS = 4
const MAX_IN_FLIGHT = 12
const GPU_TILE_LIMIT = 220

type State = 'idle' | 'loading' | 'ready'

interface Node {
  key: string
  level: number
  i: number
  j: number
  x0: number
  y0: number
  size: number
  state: State
  mesh?: THREE.Mesh
  textures?: THREE.DataTexture[]
  minHeight: number
  maxHeight: number
  lastUsed: number
  parent?: Node
  children?: Node[]
}

export interface TerrainStats {
  drawn: number
  ready: number
  loading: number
  queued: number
  maxLevelDrawn: number
}

export class TerrainTiles {
  readonly group = new THREE.Group()
  private root: Node
  private geometry = createGridGeometry(SEGMENTS)
  private workers: Worker[] = []
  private jobs = new Map<number, Node>()
  private nextJob = 1
  private queue: Node[] = []
  private frame = 0
  private frustum = new THREE.Frustum()
  private box = new THREE.Box3()
  private projScreen = new THREE.Matrix4()
  stats: TerrainStats = { drawn: 0, ready: 0, loading: 0, queued: 0, maxLevelDrawn: 0 }

  constructor() {
    this.root = makeNode(0, 0, 0, undefined)
    for (let i = 0; i < WORKERS; i++) {
      const w = new Worker(new URL('./heightWorker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (e: MessageEvent<TileResult>) => this.onResult(e.data)
      this.workers.push(w)
    }
  }

  /** Nothing loading, nothing queued, and every selected tile drawn at its own level. */
  get idle() {
    return this.jobs.size === 0 && this.queue.length === 0 && this.settled
  }
  private settled = false

  update(camera: THREE.PerspectiveCamera, viewportPx: number) {
    this.frame++
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.projScreen)
    const focalPx = viewportPx / (2 * Math.tan((camera.fov * Math.PI) / 360))

    // The queue is rebuilt from the current view every frame. Keeping requests from
    // earlier frames loads every intermediate level passed through on a fast zoom, and
    // the tiles actually on screen wait behind them.
    this.queue = []
    const selected: Node[] = []
    this.select(this.root, camera.position, focalPx, selected)

    // Stand-ins: a tile that is not ready yet is drawn by its nearest ready ancestor,
    // and an ancestor standing in hides any of its descendants that happen to be ready.
    const draw = new Set<Node>()
    let settled = true
    for (const node of selected) {
      if (node.state !== 'ready') {
        settled = false
        this.enqueue(node)
      }
      let d: Node | undefined = node
      while (d && d.state !== 'ready') d = d.parent
      if (d) draw.add(d)
    }
    for (const node of draw) {
      for (let a = node.parent; a; a = a.parent) {
        if (draw.has(a)) {
          draw.delete(node)
          break
        }
      }
    }
    this.settled = settled

    let maxLevelDrawn = 0
    for (const child of this.group.children) child.visible = false
    for (const node of draw) {
      node.mesh!.visible = true
      node.lastUsed = this.frame
      maxLevelDrawn = Math.max(maxLevelDrawn, node.level)
    }

    this.pump(camera.position)
    this.evict()

    let ready = 0
    for (const child of this.group.children) if (child.userData.ready) ready++
    this.stats = {
      drawn: draw.size,
      ready,
      loading: this.jobs.size,
      queued: this.queue.length,
      maxLevelDrawn,
    }
  }

  private select(node: Node, eye: THREE.Vector3, focalPx: number, out: Node[]) {
    if (!intersectsData(node)) return
    const zMax = node.state === 'ready' ? node.maxHeight * 1.5 + 10 : 6000
    const zMin = node.state === 'ready' ? Math.min(node.minHeight * 1.5, 0) - node.size * 0.01 : -500
    this.box.min.set(node.x0, node.y0, zMin)
    this.box.max.set(node.x0 + node.size, node.y0 + node.size, zMax)
    if (!this.frustum.intersectsBox(this.box)) return

    const dist = Math.max(1, this.box.distanceToPoint(eye))
    const texelPx = (node.size / (TEXELS - 1) / dist) * focalPx
    if (texelPx > SPLIT_TEXEL_PX && node.level < MAX_LEVEL) {
      node.children ??= split(node)
      for (const child of node.children) this.select(child, eye, focalPx, out)
      // Ancestors on the path to the view load first (the queue is coarse-first), so a
      // fast zoom gets a sharper stand-in at every step instead of one long blur.
      this.enqueue(node)
      return
    }
    out.push(node)
  }

  private enqueue(node: Node) {
    if (node.state === 'idle') this.queue.push(node)
  }

  private pump(eye: THREE.Vector3) {
    if (this.queue.length === 0) return
    // Coarse first, so there is always something to stand in; then nearest first.
    this.queue.sort((a, b) => a.level - b.level || distTo(a, eye) - distTo(b, eye))
    while (this.jobs.size < MAX_IN_FLIGHT && this.queue.length) {
      const node = this.queue.shift()!
      const id = this.nextJob++
      node.state = 'loading'
      this.jobs.set(id, node)
      const job: TileJob = { id, level: node.level, i: node.i, j: node.j }
      // Route neighbours to the same worker so they share its source-tile cache.
      const w = hash(node.level, Math.floor(node.x0 / (node.size * 4)), Math.floor(node.y0 / (node.size * 4)))
      this.workers[w % WORKERS].postMessage(job)
    }
  }

  private onResult(r: TileResult) {
    const node = this.jobs.get(r.id)
    if (!node) return
    this.jobs.delete(r.id)
    const terrain = dataTexture(r.terrain, THREE.RGBAFormat)
    const water = dataTexture(r.water, THREE.RGFormat)
    const material = createTerrainMaterial(terrain, water, TEXELS, node.size * 0.01)
    const mesh = new THREE.Mesh(this.geometry, material)
    mesh.position.set(node.x0, node.y0, 0)
    mesh.scale.set(node.size, node.size, 1)
    mesh.frustumCulled = false
    mesh.visible = false
    mesh.userData.ready = true
    this.group.add(mesh)

    node.mesh = mesh
    node.textures = [terrain, water]
    node.minHeight = r.minHeight
    node.maxHeight = r.maxHeight
    node.state = 'ready'
    node.lastUsed = this.frame
  }

  private evict() {
    const ready: Node[] = []
    walk(this.root, (n) => {
      if (n.state === 'ready') ready.push(n)
    })
    if (ready.length <= GPU_TILE_LIMIT) return
    ready.sort((a, b) => a.lastUsed - b.lastUsed)
    for (const n of ready.slice(0, ready.length - GPU_TILE_LIMIT)) {
      // Never evict the top of the tree: it is the stand-in of last resort.
      if (n.level <= 2 || n.lastUsed === this.frame) continue
      this.group.remove(n.mesh!)
      ;(n.mesh!.material as THREE.Material).dispose()
      for (const t of n.textures!) t.dispose()
      n.mesh = n.textures = undefined
      n.state = 'idle'
    }
  }

  dispose() {
    for (const w of this.workers) w.terminate()
    walk(this.root, (n) => {
      if (n.mesh) (n.mesh.material as THREE.Material).dispose()
      for (const t of n.textures ?? []) t.dispose()
    })
    this.geometry.dispose()
  }
}

function makeNode(level: number, i: number, j: number, parent: Node | undefined): Node {
  const size = ROOT.size / 2 ** level
  return {
    key: `${level}/${i}/${j}`,
    level,
    i,
    j,
    x0: ROOT.x + i * size,
    y0: ROOT.y + j * size,
    size,
    state: 'idle',
    minHeight: 0,
    maxHeight: 0,
    lastUsed: 0,
    parent,
  }
}

function split(n: Node): Node[] {
  const [l, i, j] = [n.level + 1, n.i * 2, n.j * 2]
  return [
    makeNode(l, i, j, n),
    makeNode(l, i + 1, j, n),
    makeNode(l, i, j + 1, n),
    makeNode(l, i + 1, j + 1, n),
  ]
}

function dataTexture(data: Uint16Array, format: THREE.PixelFormat) {
  const tex = new THREE.DataTexture(data, TEXELS, TEXELS, format, THREE.HalfFloatType)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.generateMipmaps = false
  tex.colorSpace = THREE.NoColorSpace
  tex.needsUpdate = true
  return tex
}

function walk(n: Node, fn: (n: Node) => void) {
  fn(n)
  if (n.children) for (const c of n.children) walk(c, fn)
}

function intersectsData(n: Node) {
  return (
    n.x0 < DATA_RECT.maxX &&
    n.x0 + n.size > DATA_RECT.minX &&
    n.y0 < DATA_RECT.maxY &&
    n.y0 + n.size > DATA_RECT.minY
  )
}

function distTo(n: Node, eye: THREE.Vector3) {
  const cx = n.x0 + n.size / 2 - eye.x
  const cy = n.y0 + n.size / 2 - eye.y
  return cx * cx + cy * cy
}

function hash(a: number, b: number, c: number) {
  return Math.abs((a * 73856093) ^ (b * 19349663) ^ (c * 83492791))
}

/**
 * A unit grid in (u, v) with a skirt: an extra ring of vertices along the edge whose z
 * is -1, which the material pushes down by the tile's skirt depth. Skirts hide the
 * hairline cracks where tiles of different levels meet, and with a mostly top-down
 * camera they are never seen side-on.
 */
function createGridGeometry(segments: number) {
  const n = segments + 1
  const positions: number[] = []
  const uvs: number[] = []
  const index: number[] = []
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      positions.push(c / segments, r / segments, 0)
      uvs.push(c / segments, r / segments)
    }
  }
  for (let r = 0; r < segments; r++) {
    for (let c = 0; c < segments; c++) {
      const a = r * n + c
      index.push(a, a + 1, a + n, a + 1, a + n + 1, a + n)
    }
  }
  // Walk the perimeter once, anticlockwise, dropping a skirt vertex under each.
  const ring: number[] = []
  for (let c = 0; c < segments; c++) ring.push(c)
  for (let r = 0; r < segments; r++) ring.push(r * n + segments)
  for (let c = segments; c > 0; c--) ring.push(segments * n + c)
  for (let r = segments; r > 0; r--) ring.push(r * n)
  const base = positions.length / 3
  for (const v of ring) {
    positions.push(positions[v * 3], positions[v * 3 + 1], -1)
    uvs.push(uvs[v * 2], uvs[v * 2 + 1])
  }
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k]
    const b = ring[(k + 1) % ring.length]
    const sa = base + k
    const sb = base + ((k + 1) % ring.length)
    index.push(a, sa, b, b, sa, sb)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(index)
  return g
}
