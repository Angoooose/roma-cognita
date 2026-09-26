import * as THREE from 'three/webgpu'
import { DATA_RECT, ROOT, TILE_TEXELS } from '@roma-cognita/world'
import { createTerrainMaterial, type TileTextures } from './material.ts'
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
/**
 * Over the model of Rome the mesh must follow the model's ground closely, which the
 * vertex shader lays at 4 m (rome/shading.ts `groundLift`), or the ground's big
 * triangles cut through the buildings. Tiles from this level that overlap its board
 * get a denser grid, about 5 m at the deepest level.
 */
const FINE_SEGMENTS = 512
const FINE_FROM_LEVEL = 9
const MAX_LEVEL = 11
/** Split while a texel would cover more than this many device pixels. */
const SPLIT_TEXEL_PX = 1.25
const WORKERS = 4
const MAX_IN_FLIGHT = 12
const GPU_TILE_LIMIT = 220
/** How many levels below a missing tile to look for ready descendants to stand in. */
const STAND_IN_DEPTH = 3

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
  textures?: TileTextures
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
  private fineGeometry: THREE.BufferGeometry | null = null
  /** The rectangle, plane metres, where tiles take the fine grid: the model's board. */
  private fineRect: [number, number, number, number] | null = null
  /** Built with the first tile, once the shared textures it reads have loaded. */
  private material?: ReturnType<typeof createTerrainMaterial>
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
      const w = new Worker(new URL('./heightWorker.ts', import.meta.url), {
        type: 'module',
      })
      w.onmessage = (e: MessageEvent<TileResult>) => this.onResult(e.data)
      this.workers.push(w)
    }
  }

  /** Nothing loading, nothing queued, and every selected tile drawn at its own level. */
  get idle() {
    return this.jobs.size === 0 && this.queue.length === 0 && this.settled
  }
  private settled = false
  private drawn = new Set<Node>()

  /**
   * Selects, loads and shows the tiles for this view. True when the set of tiles drawn
   * changed — a tile arrived or was swapped for another level — so the map knows the
   * picture needs drawing again.
   */
  update(camera: THREE.PerspectiveCamera, viewportPx: number): boolean {
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

    // Stand-ins. A tile that is not ready yet is covered by whatever is loaded around it:
    // its ready descendants (what zooming out leaves behind — the sharpest thing we
    // have) and, underneath them, its nearest ready ancestor to fill any gaps. Taking
    // only the ancestor, as this once did, magnified a tile several levels too coarse
    // on every zoom-out: blurred terrain, rivers a kilometre wide.
    // Overlaps are settled by depth, not by hiding: coarser tiles sit a hair lower
    // (see `standInDrop` in material.ts), so wherever both are drawn the finer wins.
    const draw = new Set<Node>()
    let settled = true
    for (const node of selected) {
      if (node.state === 'ready') {
        draw.add(node)
        continue
      }
      settled = false
      this.enqueue(node)
      let a: Node | undefined = node.parent
      while (a && a.state !== 'ready') a = a.parent
      if (a) draw.add(a)
      collectReady(node, STAND_IN_DEPTH, draw)
    }
    this.settled = settled

    const changed =
      draw.size !== this.drawn.size || [...draw].some((n) => !this.drawn.has(n))
    this.drawn = draw

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
    return changed
  }

  /** Tiles over `rect` (plane metres) take the fine grid from now on, those loaded too. */
  setFineRect(rect: [number, number, number, number]) {
    this.fineRect = rect
    const visit = (n: Node) => {
      if (n.mesh) n.mesh.geometry = this.geometryFor(n)
      n.children?.forEach(visit)
    }
    visit(this.root)
  }

  private geometryFor(node: Node) {
    const r = this.fineRect
    const over =
      r &&
      node.level >= FINE_FROM_LEVEL &&
      node.x0 < r[2] &&
      node.x0 + node.size > r[0] &&
      node.y0 < r[3] &&
      node.y0 + node.size > r[1]
    if (!over) return this.geometry
    return (this.fineGeometry ??= createGridGeometry(FINE_SEGMENTS))
  }

  private select(node: Node, eye: THREE.Vector3, focalPx: number, out: Node[]) {
    if (!intersectsData(node)) return
    const zMax = node.state === 'ready' ? node.maxHeight * 1.5 + 10 : 6000
    const zMin =
      node.state === 'ready' ? Math.min(node.minHeight * 1.5, 0) - node.size * 0.01 : -500
    this.box.min.set(node.x0, node.y0, zMin)
    this.box.max.set(node.x0 + node.size, node.y0 + node.size, zMax)
    if (!this.frustum.intersectsBox(this.box)) return

    const dist = Math.max(1, this.box.distanceToPoint(eye))
    const texelPx = (node.size / (TEXELS - 1) / dist) * focalPx
    if (texelPx > SPLIT_TEXEL_PX && node.level < MAX_LEVEL) {
      // Ancestors on the view's path are in use even when not drawn: they are the
      // stand-ins in waiting. Left to age, eviction dropped them and the next frame
      // loaded them again, so a view needing near the limit never stopped loading.
      node.lastUsed = this.frame
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
      const w = hash(
        node.level,
        Math.floor(node.x0 / (node.size * 4)),
        Math.floor(node.y0 / (node.size * 4)),
      )
      this.workers[w % WORKERS].postMessage(job)
    }
  }

  private onResult(r: TileResult) {
    const node = this.jobs.get(r.id)
    if (!node) return
    this.jobs.delete(r.id)
    const textures: TileTextures = {
      terrain: dataTexture(r.terrain, THREE.RGBAFormat),
      water: dataTexture(r.water, THREE.RGBAFormat),
      politics: dataTexture(r.politics, THREE.RGBAFormat),
      roads: dataTexture(r.roads, THREE.RGFormat),
    }
    const material = (this.material ??= createTerrainMaterial(TEXELS))
    const mesh = new THREE.Mesh(this.geometryFor(node), material.material)
    mesh.onBeforeRender = () => material.bind(node, textures)
    mesh.position.set(node.x0, node.y0, 0)
    mesh.scale.set(node.size, node.size, 1)
    mesh.frustumCulled = false
    mesh.visible = false
    mesh.userData.ready = true
    this.group.add(mesh)

    node.mesh = mesh
    node.textures = textures
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
      for (const t of Object.values(n.textures!)) t.dispose()
      n.mesh = n.textures = undefined
      n.state = 'idle'
    }
  }

  dispose() {
    for (const w of this.workers) w.terminate()
    walk(this.root, (n) => {
      for (const t of Object.values(n.textures ?? {})) t.dispose()
    })
    this.material?.material.dispose()
    this.geometry.dispose()
    this.fineGeometry?.dispose()
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

function collectReady(n: Node, depth: number, out: Set<Node>) {
  if (!n.children || depth === 0) return
  for (const c of n.children) {
    if (c.state === 'ready') out.add(c)
    else collectReady(c, depth - 1, out)
  }
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
