import * as THREE from 'three/webgpu'
import { MapCamera, type CameraState } from './camera/MapCamera.ts'
import { TerrainTiles } from './terrain/TerrainTiles.ts'
import { terrainTextures, terrainUniforms } from './terrain/material.ts'
import { PaperLayer } from './edge/PaperLayer.ts'
import { PAPER_HEX } from './edge/paper.ts'
import {
  PoliticalLayer,
  politicsUniforms,
  type PoliticalHit,
} from './politics/PoliticalLayer.ts'
import { LabelLayer, labelUniforms, setKnockouts } from './labels/LabelLayer.ts'
import { PlaceLayer, placeUniforms, type PlaceHit } from './labels/PlaceLayer.ts'
import { roadUniforms } from './roads/shading.ts'
import { PlanLayer, PLAN_MPP } from './rome/PlanLayer.ts'
import { ModelLayer, modelUniforms } from './rome/ModelLayer.ts'
import { planUniforms } from './rome/shading.ts'
import { Miniature } from './rome/miniature.ts'
import { entries, frame, hitFor, type MapRef } from './find.ts'

export interface RomeMapOptions {
  camera: CameraState
  /** Force the WebGL2 backend, to check the fallback renders the same picture. */
  forceWebGL?: boolean
}

export interface FrameStats {
  /** Smoothed CPU+submit time per frame, ms. */
  frameMs: number
  fps: number
  drawCalls: number
  triangles: number
}

/**
 * The map. Framework-free: it owns a canvas inside the container it is given, and
 * apps drive it through methods and events (DESIGN.md §9). The spike exposes only
 * the camera and the stats the debug panel needs.
 */
export class RomeMap {
  readonly renderer: THREE.WebGPURenderer
  readonly scene = new THREE.Scene()
  readonly view: MapCamera
  readonly terrain = new TerrainTiles()
  readonly politics = new PoliticalLayer()
  readonly labels = new LabelLayer()
  readonly places = new PlaceLayer()
  readonly plan = new PlanLayer()
  readonly model = new ModelLayer()
  private miniature: Miniature
  /**
   * Called when the model of Rome comes up out of the board, or goes back into it,
   * so the legend can key it (DESIGN.md §7.7).
   */
  onModel?: (shown: boolean) => void
  private modelShown = false
  /** Built in `create`, once the known-world texture it browns from has loaded. */
  private paper?: PaperLayer
  frame: FrameStats = { frameMs: 0, fps: 0, drawCalls: 0, triangles: 0 }
  private resizeObserver: ResizeObserver
  private lastTime = performance.now()
  private dirty = true

  static async create(container: HTMLElement, opts: RomeMapOptions) {
    const map = new RomeMap(container, opts)
    await Promise.all([
      map.renderer.init(),
      loadDataTextures(),
      map.politics.load(),
      map.labels.load(),
      map.places.load(),
      map.plan.load(),
      map.model.load(),
    ])
    // The plan lets the camera closer than the terrain alone would: the view asked for
    // was clamped before it loaded, so it is asked for again.
    map.view.state.distance = opts.camera.distance
    map.view.apply()
    if (map.plan.ground) map.model.buildGround(map.plan.ground)
    if (map.plan.rect) map.terrain.setFineRect(map.plan.rect)
    // Rome's monuments hang on the model's ground, and on their roofs while it stands.
    const anchorOf = map.places.anchorOf
    map.places.anchorOf = (p) =>
      (p.within === 'roma' && map.model.anchor(p.x, p.y)) || anchorOf(p)
    map.model.onShaded = () => {
      map.places.invalidate()
      map.dirty = true
    }
    map.paper = new PaperLayer()
    map.scene.add(map.paper.mesh)
    map.labels.setYear(map.politics.year, false)
    map.model.setYear(map.politics.year)
    map.renderer.setAnimationLoop(() => map.tick())
    return map
  }

  private container: HTMLElement

  private constructor(container: HTMLElement, opts: RomeMapOptions) {
    this.container = container
    this.renderer = new THREE.WebGPURenderer({
      antialias: true,
      forceWebGL: opts.forceWebGL,
    })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    // Only the model of Rome casts and takes shadows (rome/ModelLayer.ts).
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    // Past the last terrain tile: the paper the terrain fades into at the far margin, so
    // the edge of the data never shows.
    this.renderer.setClearColor(PAPER_HEX)
    container.appendChild(this.renderer.domElement)
    Object.assign(this.renderer.domElement.style, {
      display: 'block',
      width: '100%',
      height: '100%',
    })

    this.view = new MapCamera(this.renderer.domElement, opts.camera)
    this.view.onChange = () => (this.dirty = true)
    const normal = this.view.minDistanceAt(0, 0)
    this.view.minDistanceAt = (x, y) => this.plan.minDistanceAt(x, y, normal)
    this.scene.add(this.terrain.group)
    this.scene.add(this.labels.group)
    this.scene.add(this.places.group)
    this.scene.add(this.model.group)
    this.miniature = new Miniature(this.renderer, this.scene, this.view.camera)
    this.places.seatColour = (polity, year) => this.politics.colourOf(polity, year)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
  }

  get backend(): 'WebGPU' | 'WebGL2' {
    // three exposes the backend class; WebGL is the fallback when WebGPU is unavailable.
    return (this.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
      ? 'WebGPU'
      : 'WebGL2'
  }

  private resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    this.renderer.setSize(w, h, false)
    this.view.resize(w, h)
    this.dirty = true
  }

  /**
   * Runs every animation frame, but draws only when something changed: the camera, the
   * size, the year or its cross-fade, the settlements shown, or the tiles drawn. The map
   * is still — nothing on it animates on its own (DESIGN.md §7.2) — so at rest it
   * costs a few selection passes a second and no GPU work.
   */
  private tick() {
    const now = performance.now()
    this.view.step(now)

    // Relief at the overview comes from coarse texels whose slopes are nearly flat, so
    // it is pushed harder the further out we are. Tuned by eye; a style-spec number.
    const mpp = this.view.metresPerPixel
    terrainUniforms.shadeExaggeration.value = Math.min(10, Math.max(1, (mpp / 30) ** 0.45))

    // Zoom tiers (DESIGN.md §7.6), continuous in log scale: flat political colour at the
    // overview, colour over the relief at regional scale, and close in the fill all but
    // gone, the border's glow carrying it instead.
    // The glow stays strong throughout; the contrast between it and a lighter interior
    // is what makes a border read as a border.
    const tier = smoothstep(Math.log(120), Math.log(4000), Math.log(mpp))
    politicsUniforms.fill.value = 0.1 + 0.72 * tier
    politicsUniforms.glow.value = 0.7
    if (this.politics.tick(now)) this.dirty = true
    labelUniforms.metresPerPixel.value = mpp
    roadUniforms.pixelRatio.value = this.renderer.getPixelRatio()
    planUniforms.pixelRatio.value = this.renderer.getPixelRatio()
    // The terrain lays itself smooth under the model as the board comes in (18–26 m/px),
    // and the model rises out of it (rome/ModelLayer.ts).
    const board = 1 - smoothstep(Math.log(18), Math.log(26), Math.log(mpp))
    if (board !== planUniforms.flatten.value) this.dirty = true
    planUniforms.flatten.value = board
    if (this.model.update(mpp)) this.dirty = true
    planUniforms.meshShown.value = this.model.group.visible ? modelUniforms.grow.value : 0
    placeUniforms.lift.value = this.model.group.visible ? modelUniforms.grow.value : 0
    const shown = modelUniforms.grow.value > 0.5
    if (shown !== this.modelShown) {
      this.modelShown = shown
      this.onModel?.(shown)
    }
    if (this.model.group.visible) {
      const target = new THREE.Vector3(this.view.state.x, this.view.state.y, 0)
      this.model.fit(
        target,
        mpp * Math.max(this.container.clientWidth, this.container.clientHeight),
      )
    }
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    const cam = this.view.camera
    setKnockouts(this.places.knockouts(cam, w, h), w, h)
    if (
      this.places.update(
        cam,
        w,
        h,
        mpp,
        this.view.state.pitch,
        this.view.heading,
        this.politics.year,
        () => this.labels.obstacles(cam, w, h, mpp),
      )
    )
      this.dirty = true

    const vpPx = this.container.clientHeight * this.renderer.getPixelRatio()
    if (this.terrain.update(this.view.camera, vpPx)) this.dirty = true
    if (!this.dirty) return

    const dt = now - this.lastTime
    this.lastTime = now
    const t0 = performance.now()
    // The model's tilt-shift, while it stands and the view is tilted.
    const tilt = this.model.group.visible
      ? modelUniforms.grow.value *
        smoothstep(Math.log(15), Math.log(45), Math.log(Math.max(1, this.view.state.pitch)))
      : 0
    this.miniature.amount.value = tilt
    if (tilt > 0.01) this.miniature.render()
    else this.renderer.render(this.scene, this.view.camera)
    const renderMs = performance.now() - t0

    const info = this.renderer.info.render
    const a = 0.1
    this.frame = {
      frameMs: this.frame.frameMs * (1 - a) + renderMs * a,
      fps: this.frame.fps * (1 - a) + (1000 / Math.max(1, dt)) * a,
      drawCalls: info.drawCalls,
      triangles: info.triangles,
    }
    this.dirty = false
  }

  /** The year on the map, astronomical (1 BCE = 0). */
  get year() {
    return this.politics.year
  }

  /** Shows a year. `animate` cross-fades from the current one. */
  setYear(year: number, opts: { animate?: boolean } = {}) {
    const before = this.politics.year
    this.politics.setYear(year, opts)
    roadUniforms.year.value = this.politics.year
    this.model.setYear(this.politics.year)
    if (this.politics.year !== before)
      this.labels.setYear(this.politics.year, !!opts.animate)
    this.dirty = true
  }

  /**
   * Brings a polity forward on the map, by id: outlined, its colour held at every zoom,
   * the rest dimmed. Null clears it. It holds across year changes.
   */
  setFocus(polity: string | null) {
    this.politics.setFocus(polity)
    this.dirty = true
  }

  /**
   * What is under a client (CSS pixel) position: a settlement if its marker or name is
   * there, otherwise the atom and the claim on it this year.
   */
  async pick(
    clientX: number,
    clientY: number,
  ): Promise<{ place: PlaceHit } | { territory: PoliticalHit } | null> {
    const place = this.places.pick(
      this.view.camera,
      this.renderer.domElement,
      clientX,
      clientY,
    )
    if (place) return { place }
    const p = this.view.ground(clientX, clientY)
    // Close in, a click inside a monument's outline on the plan of Rome opens it.
    const monument =
      p && this.view.metresPerPixel < PLAN_MPP ? this.plan.pick(p.x, p.y, this.year) : null
    const hit = monument ? this.places.hitFor(monument, this.year) : null
    if (hit) return { place: hit }
    const territory = p ? await this.politics.pick(p.x, p.y) : null
    return territory ? { territory } : null
  }

  /** Everything the reader can search for, named for the year shown. */
  async entries() {
    this.placeAtoms ??= this.readPlaceAtoms()
    return entries(this, this.year, await this.placeAtoms)
  }

  /** The atom under each settlement, read from the field once: it does not change by year. */
  private placeAtoms?: Promise<Map<string, string | null>>
  private async readPlaceAtoms() {
    const all = this.places.all
    const atoms = await Promise.all(all.map((p) => this.politics.atomAt(p.x, p.y)))
    return new Map(all.map((p, k) => [p.id, atoms[k]]))
  }

  /** Whether `ref` is on the map in `year`: a province is not drawn before it was one. */
  shows(ref: MapRef, year: number) {
    return hitFor(this, ref, year) !== null
  }

  /** What `pick` would report for `ref` in the year shown; null if it is not on the map. */
  inspectRef(ref: MapRef) {
    return hitFor(this, ref, this.year)
  }

  /**
   * Flies to `ref` as it is in the year shown. `inset` is the CSS px along the right
   * edge a panel covers: the view is framed on the rest. False if it is not on the map.
   */
  flyTo(ref: MapRef, opts: { inset?: number } = {}) {
    const inset = opts.inset ?? 0
    const w = Math.max(1, this.container.clientWidth - inset)
    const f = frame(this, ref, this.year, w, this.container.clientHeight)
    if (!f) return false
    // The target sits mid-view; shift it so the thing sits mid the uncovered part.
    this.view.flyTo({
      x: f.x + (inset / 2) * f.mpp,
      y: f.y,
      distance: this.view.distanceFor(f.mpp),
    })
    return true
  }

  /** True once every visible tile is drawn at its own detail — used by screenshots. */
  get idle() {
    return this.terrain.idle && !this.dirty
  }

  dispose() {
    this.renderer.setAnimationLoop(null)
    this.resizeObserver.disconnect()
    this.terrain.dispose()
    this.paper?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * The climate and known-world textures, loaded before the first tile so every tile is
 * built with them. Their channels are data, not colours: no colour management, no
 * premultiplication. A missing file (the pipeline was not run) leaves the default.
 */
async function loadDataTextures() {
  await Promise.all([
    loadData('/biome/biome.png', (t) => (terrainTextures.biome = t)),
    loadData('/known/known.png', (t) => (terrainTextures.known = t)),
  ])
}

async function loadData(url: string, set: (t: THREE.Texture) => void) {
  try {
    const res = await fetch(url)
    if (!res.ok) return
    const bitmap = await createImageBitmap(await res.blob(), {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    })
    const tex = new THREE.Texture(bitmap)
    tex.colorSpace = THREE.NoColorSpace
    tex.flipY = false
    tex.premultiplyAlpha = false
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = false
    tex.needsUpdate = true
    set(tex)
  } catch {
    // Keep the default.
  }
}
