import * as THREE from 'three/webgpu'
import { MapCamera, type CameraState } from './camera/MapCamera.ts'
import { TerrainTiles } from './terrain/TerrainTiles.ts'
import { terrainTextures, terrainUniforms } from './terrain/material.ts'
import { PoliticalLayer, politicsUniforms, type PoliticalHit } from './politics/PoliticalLayer.ts'

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
  frame: FrameStats = { frameMs: 0, fps: 0, drawCalls: 0, triangles: 0 }
  private resizeObserver: ResizeObserver
  private lastTime = performance.now()
  private dirty = true

  static async create(container: HTMLElement, opts: RomeMapOptions) {
    const map = new RomeMap(container, opts)
    await Promise.all([map.renderer.init(), loadBiome(), map.politics.load()])
    map.renderer.setAnimationLoop(() => map.tick())
    return map
  }

  private container: HTMLElement

  private constructor(container: HTMLElement, opts: RomeMapOptions) {
    this.container = container
    this.renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: opts.forceWebGL })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setClearColor('#1E3150')
    container.appendChild(this.renderer.domElement)
    Object.assign(this.renderer.domElement.style, { display: 'block', width: '100%', height: '100%' })

    this.view = new MapCamera(this.renderer.domElement, opts.camera)
    this.view.onChange = () => (this.dirty = true)
    this.scene.add(this.terrain.group)

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

  private tick() {
    const now = performance.now()
    const dt = now - this.lastTime
    this.lastTime = now

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

    const vpPx = this.container.clientHeight * this.renderer.getPixelRatio()
    this.terrain.update(this.view.camera, vpPx)

    const t0 = performance.now()
    this.renderer.render(this.scene, this.view.camera)
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
    this.politics.setYear(year, opts)
    this.dirty = true
  }

  /** What is under a client (CSS pixel) position: the atom and the claim on it this year. */
  async pick(clientX: number, clientY: number): Promise<PoliticalHit | null> {
    const p = this.view.ground(clientX, clientY)
    return p ? this.politics.pick(p.x, p.y) : null
  }

  /** True once every visible tile is drawn at its own detail — used by screenshots. */
  get idle() {
    return this.terrain.idle && !this.dirty
  }

  dispose() {
    this.renderer.setAnimationLoop(null)
    this.resizeObserver.disconnect()
    this.terrain.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * The climate texture, loaded before the first tile so every tile is built with it.
 * Its channels are weights, not colours: no colour management, no premultiplication.
 * A missing file (the pipeline was not run) leaves the humid-temperate default.
 */
async function loadBiome() {
  try {
    const res = await fetch('/biome/biome.png')
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
    terrainTextures.biome = tex
  } catch {
    // Keep the default.
  }
}
