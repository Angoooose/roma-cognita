import * as THREE from 'three/webgpu'
import {
  attribute,
  cameraPosition,
  clamp,
  float,
  floor,
  fract,
  fwidth,
  hash,
  max,
  mix,
  positionGeometry,
  positionLocal,
  positionWorld,
  select,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl'
import { terrainUniforms } from '../terrain/material.ts'
import type { Ground } from './PlanLayer.ts'
import {
  BASALT,
  groundAt,
  groundMeshFade,
  planUniforms,
  plateMask,
  reliefWash,
} from './shading.ts'
import { STONE } from './builder.ts'
import { COURSE } from './works.ts'
import type { BuiltModel } from './buildModel.ts'
import { FIELD_KEY, fieldsRevealAt, fieldUniforms, plotShown } from './fields.ts'
import { portraitTexture, portraitUniforms } from './portrait.ts'
import { OCC_BLUR, OCC_CELL_M, OCC_STEP_M } from './occlusionGrid.ts'
import type { OcclusionJob, OcclusionResult } from './occlusionWorker.ts'

/**
 * The model of Rome (DESIGN.md §7.7): the city as a museum model, raised out of the
 * plate when the map is zoomed right into it, from what `npm run rome -w pipeline`
 * baked (pipeline/src/rome/model.ts says what is known and what is generated).
 *
 * It is lit as a model on a table is: a low sun from the north-west, the same
 * direction as the terrain's light, casting real shadows across the roofs and the
 * streets (a shadow map fitted to the view each frame), and a soft sky. The
 * materials are matte: the known monuments in the stone they were faced with that
 * year (`STONE`), the generated houses plainer and more muted under terracotta, so
 * they read as the backdrop, the wall tufa, the trees muted green. Walls darken a
 * little where they meet the ground, as a model's do. The model stands on the map's
 * own terrain, laid on the smoothed relief; a ground mesh over it that draws only
 * shadows lets them fall on the ground too.
 *
 * Heights are ground metres (the base) plus metres above it, and the vertex shader
 * scales both by the terrain's vertical exaggeration — so the city sits on the
 * relief exactly — and the second by `grow`, so the city rises out of the plate as
 * the zoom comes in and sinks back into it going out.
 *
 * The timeline moves the known buildings: one not yet built, or gone, is sunk out of
 * sight; one being built rises through its years (works.ts); one burnt stands a
 * roofless shell; the generated city and the wall stand throughout.
 */
export const modelUniforms = {
  /** 0 flat into the ground … 1 standing. Set per frame from the scale. */
  grow: uniform(0),
  /** The year shown, astronomical. */
  year: uniform(-62),
  /**
   * 1 while the city is drawn from overhead (`paint`), with no terrain: a building
   * not standing that year, sunk out of sight under the ground otherwise, would show
   * through, so it is not drawn at all.
   */
  overhead: uniform(0),
}

/** What the distance fades the model towards: the warm, pale air of a summer day. */
const HAZE = new THREE.Color('#DCCFB8')

/**
 * The scale (m per CSS px) the model rises between: flat at the first, standing by
 * the second. Further out the city is its portrait (`paint`, portrait.ts), which it
 * rises out of, so the model is only drawn once its buildings are a few pixels high.
 * It starts after the terrain is laid smooth (18 m/px, RomeMap), so its ground mesh
 * always has the terrain's own ground just under it.
 */
export const MODEL_MPP: [number, number] = [14, 8]

/** Towards the sun: north-west, 40° up. */
const SUN = new THREE.Vector3(-0.54, 0.54, 0.64).normalize()
/** The ground mesh's grid, metres, and how far past the model it reaches. */
const GROUND_STEP_M = 10
const GROUND_PAD_M = 700
/** The portrait (`paint`): how far past the model it reaches, and its finest texel, metres. */
const PORTRAIT_PAD_M = 60
const PORTRAIT_TEXEL_M = 2
const PORTRAIT_MAX_TEXELS = 2048

/** The model's colours for its legend, as hex: the stones, and the generated houses. */
export const MODEL_KEY = {
  marble: `#${STONE.marble.face.getHexString()}`,
  stucco: `#${STONE.stucco.face.getHexString()}`,
  travertine: `#${STONE.travertine.face.getHexString()}`,
  basalt: `#${BASALT.getHexString()}`,
  house: '#DED3BE',
  roof: '#B8957F',
  /** The country round the city (fields.ts): its generated farmland, and the recorded gardens. */
  ...FIELD_KEY,
}

/** How far round a monument's point its marker looks for the top of its building, metres. */
const ANCHOR_REACH_M = 6

/**
 * How much the model overshadows itself, for its soft shading: a grid over the city
 * of the height of whatever stands in each cell, over its ground, blurred at two
 * reaches (about 10 m and 30 m across). A point lower than the blurred height round
 * it — a narrow street, a courtyard, the foot of a wall under a taller neighbour —
 * sees less of the sky and is darker (`occlusion`). Built again for each year, as
 * buildings come and go.
 */
class Occlusion {
  readonly tex: THREE.DataTexture
  readonly origin = uniform(new THREE.Vector2())
  readonly size = uniform(new THREE.Vector2())
  private worker = new Worker(new URL('./occlusionWorker.ts', import.meta.url), {
    type: 'module',
  })
  private job = 0
  private pending = new Map<number, (shown: boolean) => void>()
  private nx: number
  private ny: number
  private x0: number
  private y0: number
  private year = NaN
  /** The height of what stands in each cell, unblurred, metres over its ground. */
  private raw: Float32Array | null = null
  /** The grid's extent, plane metres: x0, y0, x1, y1. */
  readonly bounds: [number, number, number, number]

  constructor(tops: ArrayLike<number>) {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
    for (let i = 0; i < tops.length; i += 11)
      for (const k of [0, 3, 6]) {
        x0 = Math.min(x0, tops[i + k])
        x1 = Math.max(x1, tops[i + k])
        y0 = Math.min(y0, tops[i + k + 1])
        y1 = Math.max(y1, tops[i + k + 1])
      }
    const pad = OCC_CELL_M * OCC_BLUR[1] * 3
    this.x0 = x0 - pad
    this.y0 = y0 - pad
    this.nx = Math.ceil((x1 - x0 + 2 * pad) / OCC_CELL_M)
    this.ny = Math.ceil((y1 - y0 + 2 * pad) / OCC_CELL_M)
    this.tex = new THREE.DataTexture(
      new Uint8Array(this.nx * this.ny * 2),
      this.nx,
      this.ny,
      THREE.RGFormat,
      THREE.UnsignedByteType,
    )
    this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping
    this.bounds = [
      this.x0,
      this.y0,
      this.x0 + this.nx * OCC_CELL_M,
      this.y0 + this.ny * OCC_CELL_M,
    ]
    this.origin.value.set(this.x0, this.y0)
    this.size.value.set(this.nx * OCC_CELL_M, this.ny * OCC_CELL_M)
    const t = new Float32Array(tops)
    const frame = { nx: this.nx, ny: this.ny, x0: this.x0, y0: this.y0 }
    this.worker.postMessage({ tops: t, frame } satisfies OcclusionJob, [t.buffer])
    this.worker.onmessage = (e: MessageEvent<OcclusionResult>) => this.onResult(e.data)
  }

  /**
   * Builds the grid for a year, in the worker (occlusionWorker.ts): true once it is
   * shown, false if it already was, or a later year was asked for meanwhile.
   */
  build(year: number): Promise<boolean> {
    if (year === this.year) return Promise.resolve(false)
    this.year = year
    const id = ++this.job
    this.worker.postMessage({ id, year } satisfies OcclusionJob)
    return new Promise((done) => this.pending.set(id, done))
  }

  private onResult({ id, year, raw, data }: OcclusionResult) {
    const done = this.pending.get(id)
    this.pending.delete(id)
    if (year !== this.year) return done?.(false)
    this.raw = raw
    this.tex.image.data = data
    this.tex.needsUpdate = true
    done?.(true)
  }

  dispose() {
    this.worker.terminate()
    this.tex.dispose()
  }

  /** The top of whatever stands within `r` metres of a point, metres over its ground. */
  topNear(x: number, y: number, r: number) {
    if (!this.raw) return 0
    const [ci, cj] = [(x - this.x0) / OCC_CELL_M, (y - this.y0) / OCC_CELL_M]
    const n = Math.ceil(r / OCC_CELL_M)
    let top = 0
    for (let j = Math.floor(cj) - n; j <= Math.floor(cj) + n; j++)
      for (let i = Math.floor(ci) - n; i <= Math.floor(ci) + n; i++)
        if (i >= 0 && j >= 0 && i < this.nx && j < this.ny)
          top = Math.max(top, this.raw[j * this.nx + i])
    return top
  }

  /**
   * How open to the sky a point is, `up` metres over its ground: 1 open, less below
   * its neighbours, by `near` for the houses close round it and `far` for those
   * further off.
   */
  at(
    x: THREE.Node<'float'>,
    y: THREE.Node<'float'>,
    up: THREE.Node<'float'>,
    near = 0.35,
    far = 0.3,
  ) {
    const uv = vec2(x, y).sub(this.origin).div(this.size)
    const hs = texture(this.tex, uv).xy.mul(255 * OCC_STEP_M)
    const close = hs.x.sub(up).div(6).clamp(0, 1)
    const round = hs.y.sub(up).div(12).clamp(0, 1)
    return float(1).sub(close.mul(near)).sub(round.mul(far))
  }
}

export class ModelLayer {
  readonly group = new THREE.Group()
  private loaded = false
  // A bright room: the sun sets the shadows, the sky and its bounce keep the shaded
  // walls light, as a model under a window. Flat ground comes out at its own colour.
  private sun = new THREE.DirectionalLight('#FFF6EA', 2.1)
  private sky = new THREE.HemisphereLight('#EEF2F4', '#D8CBB2', 2.1)
  /** The model's extent, plane metres: x0, y0, x1, y1. */
  private extent: [number, number, number, number] = [0, 0, 0, 0]
  /** Where any of its vertices lie, plane metres: x0, y0, x1, y1. */
  private bounds: [number, number, number, number] = [0, 0, 0, 0]
  private origin: [number, number] = [0, 0]
  private waterLevel = 0
  private occlusion: Occlusion | null = null
  private ground: ((x: number, y: number) => number) | null = null
  /** Called when a year's buildings have been shaded: what stands where has changed. */
  onShaded?: () => void
  private occlusionTimer = 0
  private occlusionBuilt = false
  /** How far the view reaches, metres (`fit`), which the model's haze is measured by. */
  private viewM = uniform(1000)
  /** Round everything the model draws, plane metres, heights well past its own (`cull`). */
  private box = new THREE.Box3()
  private frustum = new THREE.Frustum()
  /** The city from overhead (`paint`), and what it is drawn with. */
  private portrait: THREE.RenderTarget | null = null
  private portraitScene = new THREE.Scene()
  private portraitCamera = new THREE.OrthographicCamera()
  private viewProjection = new THREE.Matrix4()
  /** The buildings, trees and walls: the mesh `release` lets go of the data of. */
  private buildings: THREE.Mesh | null = null

  /** Whether the model has loaded. */
  get ready() {
    return this.loaded
  }

  async load() {
    // Built in a worker (buildModel.ts), which fetches the model too.
    const worker = new Worker(new URL('./modelWorker.ts', import.meta.url), {
      type: 'module',
    })
    const built = await new Promise<BuiltModel | null>((done) => {
      worker.onmessage = (e: MessageEvent<BuiltModel | null>) => done(e.data)
      worker.onerror = () => done(null)
      worker.postMessage(null)
    })
    worker.terminate()
    if (!built) return
    const [ox, oy] = built.origin
    this.occlusion = new Occlusion(built.tops)
    const shaded = this.occlusion.build(modelUniforms.year.value)
    const geometry = new THREE.BufferGeometry()
    for (const [name, a] of Object.entries(built.mesh.attributes))
      geometry.setAttribute(
        name,
        // three's types do not list Float16Array yet, though it draws from one.
        new THREE.BufferAttribute(a.array as THREE.TypedArray, a.itemSize, a.normalized),
      )
    geometry.setIndex(new THREE.BufferAttribute(built.mesh.index, 1))
    const mesh = new THREE.Mesh(
      geometry,
      material(this.occlusion, this.viewM, new THREE.Vector2(ox, oy)),
    )
    mesh.position.set(ox, oy, 0)
    mesh.frustumCulled = false
    mesh.renderOrder = 5
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)
    this.buildings = mesh

    this.extent = built.extent
    this.bounds = built.bounds
    this.origin = [ox, oy]
    this.waterLevel = built.waterLevel
    // Its buildings, and its ground (`buildGround`) round its extent.
    const [bx0, by0, bx1, by1] = built.bounds
    const [ex0, ey0, ex1, ey1] = built.extent
    this.box.min.set(
      Math.min(bx0, ex0 - GROUND_PAD_M),
      Math.min(by0, ey0 - GROUND_PAD_M),
      -2000,
    )
    this.box.max.set(
      Math.max(bx1, ex1 + GROUND_PAD_M),
      Math.max(by1, ey1 + GROUND_PAD_M),
      4000,
    )

    // The sun casts; the shadow camera is fitted to the view (`fit`).
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(4096, 4096)
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.6
    this.sun.shadow.radius = 3
    this.group.add(this.sun, this.sun.target, this.sky)
    this.group.visible = false
    await shaded
    this.loaded = true
  }

  /**
   * The model's ground: a mesh over the smoothed relief, a little above the terrain
   * laid on the same heights, that draws nothing but the model's shadows.
   */
  buildGround(g: Ground) {
    if (!this.loaded) return
    const [ex0, ey0, ex1, ey1] = this.extent
    const [x0, y0] = [ex0 - GROUND_PAD_M, ey0 - GROUND_PAD_M]
    const nx = Math.ceil((ex1 - ex0 + 2 * GROUND_PAD_M) / GROUND_STEP_M) + 1
    const ny = Math.ceil((ey1 - ey0 + 2 * GROUND_PAD_M) / GROUND_STEP_M) + 1
    const { heights, width, height } = g
    const heightAt = (x: number, y: number) => {
      const fx = (x - g.x0) / g.texel - 0.5
      const fy = (g.y1 - y) / g.texel - 0.5
      const i = Math.max(0, Math.min(width - 2, Math.floor(fx)))
      const j = Math.max(0, Math.min(height - 2, Math.floor(fy)))
      const u = Math.min(1, Math.max(0, fx - i))
      const v = Math.min(1, Math.max(0, fy - j))
      const k = j * width + i
      return (
        (heights[k] * (1 - u) + heights[k + 1] * u) * (1 - v) +
        (heights[k + width] * (1 - u) + heights[k + width + 1] * u) * v
      )
    }
    this.ground = (x, y) => Math.max(this.waterLevel, heightAt(x, y))
    const vex = terrainUniforms.verticalExaggeration.value
    const pos = new Float32Array(nx * ny * 3)
    const nrm = new Float32Array(nx * ny * 3)
    const [ox, oy] = this.origin
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * GROUND_STEP_M
        const y = y0 + j * GROUND_STEP_M
        const k = (j * nx + i) * 3
        pos[k] = x - ox
        pos[k + 1] = y - oy
        // The river lies flat at its surface: its cut bed would catch the light.
        const z = heightAt(x, y)
        const wet = z < this.waterLevel
        pos[k + 2] = wet ? this.waterLevel : z
        if (wet) {
          nrm[k + 2] = 1
          continue
        }
        const gx = (heightAt(x + 5, y) - heightAt(x - 5, y)) * vex
        const gy = (heightAt(x, y + 5) - heightAt(x, y - 5)) * vex
        // As THREE.Vector3's normalize() works it out.
        const s = 1 / (Math.sqrt(-gx * -gx + -gy * -gy + 10 * 10) || 1)
        nrm[k] = -gx * s
        nrm[k + 1] = -gy * s
        nrm[k + 2] = 10 * s
      }
    const index = new Uint32Array((nx - 1) * (ny - 1) * 6)
    for (let j = 0, o = 0; j + 1 < ny; j++)
      for (let i = 0; i + 1 < nx; i++, o += 6) {
        const a = j * nx + i
        index.set([a, a + 1, a + nx + 1, a, a + nx + 1, a + nx], o)
      }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
    geom.setIndex(new THREE.BufferAttribute(index, 1))
    // Only the shadows: the terrain's own ground shows through it.
    const mat = new THREE.ShadowNodeMaterial({ color: '#2E2618' })
    mat.positionNode = vec3(
      positionLocal.x,
      positionLocal.y,
      positionLocal.z.mul(terrainUniforms.verticalExaggeration).add(0.25),
    )
    const pxM = fwidth(positionWorld.x)
    // Faded out before the terrain rises back to its own heights; the terrain draws
    // the model's baked shadows beyond.
    mat.opacityNode = float(0.5)
      .mul(groundMeshFade(positionWorld.x, positionWorld.y))
      .mul(plateMask(positionWorld.x, positionWorld.y, pxM))
    mat.depthWrite = false
    const mesh = new THREE.Mesh(geom, mat)
    mesh.position.set(ox, oy, 0)
    mesh.frustumCulled = false
    mesh.receiveShadow = true
    this.group.add(mesh)

    // The streets and courtyards in the shade of the houses round them (`Occlusion`):
    // the same ground, darkened where it sees less of the sky.
    if (!this.occlusion) return
    // Over the city only: the same ground's points, fewer of its cells.
    const [bx0, by0, bx1, by1] = this.occlusion.bounds
    const [i0, i1] = [
      Math.max(0, Math.floor((bx0 - x0) / GROUND_STEP_M)),
      Math.min(nx - 1, Math.ceil((bx1 - x0) / GROUND_STEP_M)),
    ]
    const [j0, j1] = [
      Math.max(0, Math.floor((by0 - y0) / GROUND_STEP_M)),
      Math.min(ny - 1, Math.ceil((by1 - y0) / GROUND_STEP_M)),
    ]
    const cityIndex = new Uint32Array(Math.max(0, j1 - j0) * Math.max(0, i1 - i0) * 6)
    for (let j = j0, o = 0; j < j1; j++)
      for (let i = i0; i < i1; i++, o += 6) {
        const a = j * nx + i
        cityIndex.set([a, a + 1, a + nx + 1, a, a + nx + 1, a + nx], o)
      }
    const city = new THREE.BufferGeometry()
    city.setAttribute('position', geom.getAttribute('position'))
    city.setIndex(new THREE.BufferAttribute(cityIndex, 1))
    const dim = new THREE.MeshBasicNodeMaterial({ color: '#2E2618', transparent: true })
    dim.positionNode = mat.positionNode
    // Mostly the narrow streets and the feet of walls; open courtyards only a little.
    const shut = float(1).sub(
      this.occlusion.at(positionWorld.x, positionWorld.y, float(0), 0.3, 0.1),
    )
    dim.opacityNode = shut
      .mul(0.7)
      .mul(modelUniforms.grow)
      .mul(groundMeshFade(positionWorld.x, positionWorld.y))
      .mul(plateMask(positionWorld.x, positionWorld.y, pxM))
    dim.depthWrite = false
    const shade = new THREE.Mesh(city, dim)
    shade.position.set(ox, oy, 0)
    shade.frustumCulled = false
    shade.renderOrder = 4
    this.group.add(shade)
  }

  /**
   * Draws the city from straight overhead into its portrait (portrait.ts), standing,
   * lit and shadowed as it is when zoomed in, for the map to show further out; called
   * once its ground is built, and again each time a year's buildings are shaded.
   */
  paint(renderer: THREE.WebGPURenderer) {
    if (!this.loaded || !this.ground) return
    // Round everything it draws: its trees reach past the extent of its buildings.
    const [ex0, ey0, ex1, ey1] = [
      Math.min(this.extent[0], this.bounds[0]),
      Math.min(this.extent[1], this.bounds[1]),
      Math.max(this.extent[2], this.bounds[2]),
      Math.max(this.extent[3], this.bounds[3]),
    ]
    const [x0, y0] = [ex0 - PORTRAIT_PAD_M, ey0 - PORTRAIT_PAD_M]
    const [w, h] = [ex1 - ex0 + 2 * PORTRAIT_PAD_M, ey1 - ey0 + 2 * PORTRAIT_PAD_M]
    const texel = Math.max(PORTRAIT_TEXEL_M, Math.max(w, h) / PORTRAIT_MAX_TEXELS)
    const [nx, ny] = [Math.ceil(w / texel), Math.ceil(h / texel)]
    // Multisampled only under WebGPU: WebGL2's fallback drew a multisampled target
    // all but empty to the terrain.
    const webgpu = !!(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
    if (!this.portrait || this.portrait.width !== nx || this.portrait.height !== ny) {
      this.portrait?.dispose()
      this.portrait = new THREE.RenderTarget(nx, ny, {
        type: THREE.HalfFloatType,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
        samples: webgpu ? 4 : 0,
      })
    }
    const [cw, ch] = [nx * texel, ny * texel]
    const [cx, cy] = [x0 + cw / 2, y0 + ch / 2]
    const cam = this.portraitCamera
    cam.left = -cw / 2
    cam.right = cw / 2
    cam.bottom = -ch / 2
    cam.top = ch / 2
    cam.near = 10
    cam.far = 8000
    cam.position.set(cx, cy, 4000)
    cam.up.set(0, 1, 0)
    cam.lookAt(cx, cy, 0)
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()

    // Standing, every mesh drawn, the sun's shadow over the whole city, no haze, and
    // at a scale the model's own fades (`plateMask`) take for close in.
    const parent = this.group.parent
    const was = {
      grow: modelUniforms.grow.value,
      meshShown: planUniforms.meshShown.value,
      pixelRatio: planUniforms.pixelRatio.value,
      reveal: fieldUniforms.reveal.value,
      viewM: this.viewM.value,
      visible: this.group.visible,
      shown: this.group.children.map((c) => c.visible),
      target: renderer.getRenderTarget(),
      clear: renderer.getClearColor(new THREE.Color()),
      alpha: renderer.getClearAlpha(),
    }
    modelUniforms.grow.value = 1
    modelUniforms.overhead.value = 1
    planUniforms.meshShown.value = 1
    planUniforms.pixelRatio.value = 1
    fieldUniforms.reveal.value = 0
    this.viewM.value = 1e6
    this.group.visible = true
    for (const c of this.group.children) c.visible = true
    // `fit` sets the shadow back to the view on the next frame.
    const half = Math.max(cw, ch) * 0.75
    const reach = half * 1.5 + 1000
    const shadow = this.sun.shadow.camera
    shadow.left = shadow.bottom = -half
    shadow.right = shadow.top = half
    shadow.near = 10
    shadow.far = reach * 2
    shadow.updateProjectionMatrix()
    this.sun.target.position.set(cx, cy, 0)
    this.sun.position.set(cx + SUN.x * reach, cy + SUN.y * reach, SUN.z * reach)
    this.sun.target.updateMatrixWorld()
    this.portraitScene.add(this.group)
    renderer.setRenderTarget(this.portrait)
    renderer.setClearColor(0x000000, 0)
    renderer.clear()
    renderer.render(this.portraitScene, cam)
    this.release(renderer)

    renderer.setRenderTarget(was.target)
    renderer.setClearColor(was.clear, was.alpha)
    parent?.add(this.group)
    modelUniforms.grow.value = was.grow
    modelUniforms.overhead.value = 0
    planUniforms.meshShown.value = was.meshShown
    planUniforms.pixelRatio.value = was.pixelRatio
    fieldUniforms.reveal.value = was.reveal
    this.viewM.value = was.viewM
    this.group.visible = was.visible
    this.group.children.forEach((c, i) => (c.visible = was.shown[i]))

    portraitTexture.value = this.portrait.texture
    portraitUniforms.origin.value.set(x0, y0)
    portraitUniforms.size.value.set(cw, ch)
    portraitUniforms.texel.value = texel
    portraitUniforms.ready.value = 1
  }

  /**
   * Where a monument's marker and name hang (labels/PlaceLayer.ts `Anchor`): on the
   * model's ground, lifted to the top of its building while the model stands — or,
   * where its building is not drawn, of the roofs round it. Null outside the model.
   */
  anchor(x: number, y: number) {
    if (!this.ground || !this.occlusion) return null
    return { ground: this.ground(x, y), lift: this.occlusion.topNear(x, y, ANCHOR_REACH_M) }
  }

  /**
   * Shows a year: the buildings of that year stand, and the shading of the ones round
   * them is built again for it, a moment after the year stops changing.
   */
  setYear(year: number) {
    modelUniforms.year.value = year
    planUniforms.year.value = year
    if (!this.occlusion) return
    clearTimeout(this.occlusionTimer)
    this.occlusionTimer = window.setTimeout(async () => {
      if (await this.occlusion?.build(year)) {
        this.occlusionBuilt = true
        this.onShaded?.()
      }
    }, 150)
  }

  /**
   * Lets go of the buildings' vertex data once it is on the GPU, which `paint` has
   * just put it on: a quarter of a gigabyte the page would otherwise hold for nothing,
   * since nothing reads it back. What is not on the GPU yet is kept.
   */
  private release(renderer: THREE.WebGPURenderer) {
    const g = this.buildings?.geometry
    if (!g) return
    const backend = renderer.backend as unknown as { has(o: object): boolean }
    for (const a of [...Object.values(g.attributes), g.index]) {
      // `count` stays as it was: three draws by it, not by the array's length. (The
      // array is typed read-only, but three reassigns it itself when it pads one.)
      if (a && a.array.length > 0 && backend.has(a))
        (a as { array: THREE.TypedArray }).array = a.array.slice(0, 0)
    }
  }

  /**
   * Fits the sun's shadow to what the camera sees round `target` (plane metres), so
   * its texels stay near a metre however close the view; called per frame while the
   * model shows.
   */
  fit(target: THREE.Vector3, viewM: number) {
    this.viewM.value = viewM
    const half = Math.min(3200, Math.max(250, viewM * 0.75))
    const cam = this.sun.shadow.camera
    cam.left = cam.bottom = -half
    cam.right = cam.top = half
    cam.near = 10
    cam.far = 8000
    cam.updateProjectionMatrix()
    this.sun.target.position.set(target.x, target.y, 0)
    this.sun.position.set(target.x + SUN.x * 3000, target.y + SUN.y * 3000, SUN.z * 3000)
    this.sun.target.updateMatrixWorld()
  }

  dispose() {
    clearTimeout(this.occlusionTimer)
    this.portrait?.dispose()
    this.occlusion?.dispose()
  }

  /**
   * Draws the model's meshes only while some of it is in `camera`'s view. It stands
   * whenever the map is zoomed in far enough (`update`), anywhere: zoomed in over
   * Athens it would otherwise be drawn, and its shadows cast, out of sight.
   */
  cull(camera: THREE.Camera) {
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.viewProjection)
    const seen = this.frustum.intersectsBox(this.box)
    for (const c of this.group.children) if ((c as THREE.Mesh).isMesh) c.visible = seen
  }

  /** Called per frame with the scale; true while the city is rising or sinking. */
  update(mpp: number) {
    // The country's fields come in after it has risen, with its trees (fields.ts).
    fieldUniforms.reveal.value = fieldsRevealAt(mpp)
    if (!this.loaded) return false
    const [flat, full] = MODEL_MPP
    const t = Math.min(1, Math.max(0, (flat - mpp) / (flat - full)))
    const grow = t * t * (3 - 2 * t)
    const changed = grow !== modelUniforms.grow.value || this.occlusionBuilt
    this.occlusionBuilt = false
    modelUniforms.grow.value = grow
    this.group.visible = grow > 0.001
    return changed
  }
}

type F = THREE.Node<'float'>

/** 1 inside [a, b], 0 outside, with edges a pixel `px` soft. */
function band(v: F, a: F | number, b: F | number, px: F) {
  const [lo, hi] = [
    typeof a === 'number' ? float(a) : a,
    typeof b === 'number' ? float(b) : b,
  ]
  return smoothstep(lo.sub(px), lo.add(px), v).mul(
    float(1).sub(smoothstep(hi.sub(px), hi.add(px), v)),
  )
}

/**
 * The walls of the generated houses, painted on (`SKIN`), after the street fronts of
 * Pompeii and Herculaneum (Wallace-Hadrill 1994; Ellis 2018; DESIGN.md §7.7): on the
 * street front a ground floor of shops, each a single room open to the street across
 * most of its width (the flats'), or a house's door with shops either side of it;
 * small windows on the floors above, few on a house's front, which looked in on its
 * atrium; a darker dado of plaster along the foot of the wall; and the shade of the
 * eaves along the top. Illustrative, not of any known building: where the doors and
 * windows fall is generated. Returns what the wall's colour is multiplied by, and
 * fades to its average as the pattern gets too fine to draw.
 */
function wallPaint(surface: F, kind: F, seed: F, along: F, len: F, top: F, up: F) {
  const px = max(fwidth(along), fwidth(up)).max(0.02)
  // Each drawn while it is a few pixels across: windows close in, shops further out.
  const detail = float(1).sub(smoothstep(0.12, 0.45, px))
  const broad = float(1).sub(smoothstep(0.4, 1.2, px))
  const id = floor(seed.mul(1000))
  const front = step(0.5, surface).mul(step(surface, 1.5))
  const flats = step(kind, 0.5)
  const house = step(0.5, kind).mul(step(kind, 1.5))
  const store = step(1.5, kind).mul(step(kind, 2.5))
  const inside = band(along, 0.5, len.sub(0.5), px)
  // Shops: bays of 3–4 m along the front, most of them open.
  const bayW = len.div(max(float(1), floor(len.div(seed.mul(0.9).add(3.2)))))
  const bay = floor(along.div(bayW))
  const inBay = along.sub(bay.mul(bayW))
  const open = step(0.25, hash(id.add(bay.mul(7)).add(1)))
  const shop = band(inBay, 0.45, bayW.sub(0.45), px)
    .mul(band(up, 0.15, 2.7, px))
    .mul(open)
  // A house's door in the middle of its front, with shops either side of a wide front.
  const door = band(along, len.mul(0.5).sub(0.75), len.mul(0.5).add(0.75), px).mul(
    band(up, 0, 2.9, px),
  )
  const houseShops = shop
    .mul(step(12, len))
    .mul(float(1).sub(band(along, len.mul(0.5).sub(3), len.mul(0.5).add(3), px)))
  // A warehouse's wide door.
  const gate = band(along, len.mul(0.5).sub(1.6), len.mul(0.5).add(1.6), px).mul(
    band(up, 0, 3.4, px),
  )
  const ground = front.mul(
    flats
      .mul(shop)
      .add(house.mul(max(door, houseShops)))
      .add(store.mul(gate)),
  )
  // Windows: storeys over the tall ground floor (city.ts), one every 2.4–3 m.
  const sz = up.sub(3.8)
  const storey = floor(sz.div(3))
  const inStorey = sz.sub(storey.mul(3))
  const winW = seed.mul(0.6).add(2.4)
  const col = floor(along.div(winW))
  const inCol = along.sub(col.mul(winW))
  const keep = select(
    front.greaterThan(0.5),
    select(house.greaterThan(0.5), float(0.8), float(0.3)),
    float(0.65),
  )
  const win = band(inCol, winW.mul(0.5).sub(0.38), winW.mul(0.5).add(0.38), px)
    .mul(band(inStorey, 0.95, store.greaterThan(0.5).select(1.5, 2.0), px))
    .mul(step(0, sz))
    .mul(step(up, top.sub(0.7)))
    .mul(step(keep, hash(id.add(col.mul(13)).add(storey.mul(101)).add(surface.mul(7)))))
  const dark = max(ground.mul(broad), win.mul(detail)).mul(inside)
  // The dado, a warmer, darker plaster to about a metre; now and then painted red.
  const red = step(0.6, hash(id.add(3)))
  const dadoCol = mix(vec3(0.9, 0.88, 0.85), vec3(0.86, 0.72, 0.64), red)
  const dado = float(1).sub(smoothstep(float(0.95).sub(px), float(0.95).add(px), up))
  // The shade under the eaves, only below them (not on a gable).
  const eaves = smoothstep(top.sub(0.9), top.sub(0.05), up).mul(step(up, top.add(0.05)))
  return mix(vec3(1), dadoCol, dado.mul(mix(0.5, 1, broad)))
    .mul(mix(float(1), float(0.3), dark))
    .mul(mix(float(1), float(0.8), eaves))
    .mul(mix(float(0.95), float(1), broad))
}

/**
 * The tiled roofs, painted on — Rome was roofed with tiles, not shingles, from the war
 * with Pyrrhus (Pliny, Natural History 16.36): the rows of round cover tiles over the
 * joints of the flat ones, running down the slope about half a metre apart, each lit
 * on one side and shaded on the other; tiles a little lighter or darker one by one,
 * as a roof is patched; the ridge tiles along the top and the shade of the eaves'
 * edge. The spacing is illustrative (flat tiles vary, roughly 0.3–0.5 m wide). Fades
 * to the plain roof as it gets too fine to draw.
 */
function roofPaint(seed: F, across: F, down: F, run: F) {
  const px = max(fwidth(across), fwidth(down)).max(0.01)
  const rows = float(1).sub(smoothstep(0.08, 0.3, px))
  const tiles = float(1).sub(smoothstep(0.15, 0.6, px))
  const lines = float(1).sub(smoothstep(0.12, 0.5, px))
  const v = fract(across.div(0.48))
  // The cover tile over each joint: lit, then in its own shade, then the flat tile.
  const cover = smoothstep(0.0, 0.12, v).mul(float(1).sub(smoothstep(0.18, 0.3, v)))
  const shade = smoothstep(0.3, 0.36, v).mul(float(1).sub(smoothstep(0.4, 0.5, v)))
  const row = float(1).add(cover.mul(0.08)).sub(shade.mul(0.16))
  const cell = floor(across.div(0.48))
    .mul(17)
    .add(floor(down.div(0.45)).mul(131))
    .add(floor(seed.mul(1000)).mul(7919))
  const patch = float(1).add(hash(cell.abs()).sub(0.5).mul(0.07))
  const ridge = float(1).sub(smoothstep(0.2, 0.35, down))
  const eave = smoothstep(run.sub(0.3), run.sub(0.1), down)
  return mix(float(1), row, rows)
    .mul(mix(float(1), patch, tiles))
    .mul(mix(float(1), float(0.82), ridge.mul(lines)))
    .mul(mix(float(1), float(0.78), eave.mul(lines)))
}

/**
 * A stuccoed wall over courses that each stand back a little from the one under it
 * (`SKIN.courses`), as the Tabularium's Forum face: 25 courses over its 15.3 m
 * (Delbrück 1907, p. 29), each one's foot a faint line of shadow under the thin
 * stucco. `height` is metres above the sea, so the courses run level. Fades to plain
 * as they get too fine to draw.
 */
function coursesPaint(height: F) {
  const px = fwidth(height).max(0.005)
  const lines = float(1).sub(smoothstep(0.05, 0.16, px))
  const course = float(15.32 / 25)
  const inRow = height.sub(floor(height.div(course)).mul(course))
  const w = px.mul(0.8).max(0.03)
  const line = float(1).sub(band(inRow, w, course, px))
  return mix(float(1), float(0.88), line.mul(lines))
}

/**
 * Squared stone laid dry in courses (`SKIN.ashlar`), as the Servian Wall's is: courses
 * of two Roman feet (0.59 m), blocks laid alternately end-out and side-out course by
 * course (Platner & Ashby, Murus Servii Tullii; Middleton 1892), each a little lighter
 * or darker; the joints a thin shadow, there being no mortar; and here and there a
 * stretch of darker, redder blocks, the Anio tufa of the repairs of the first century
 * BCE (Frank, AJA 1918), from 87 BCE. `along` is how far along the face, `height` metres above the sea,
 * so the courses run level. Fades to its average as it gets too fine to draw.
 */
function ashlarPaint(seed: F, along: F, height: F) {
  const px = max(fwidth(along), fwidth(height)).max(0.005)
  const joints = float(1).sub(smoothstep(0.06, 0.22, px))
  const blocks = float(1).sub(smoothstep(0.2, 0.8, px))
  const course = float(0.59)
  const row = floor(height.div(course))
  const inRow = height.sub(row.mul(course))
  // End-out courses show the blocks' short ends, side-out ones their long sides.
  const ends = step(0.5, fract(row.mul(0.5)))
  const len = mix(float(1.2), float(0.6), ends)
  const shift = hash(row.add(floor(seed.mul(1000)))).mul(len)
  const col = floor(along.add(shift).div(len))
  const inCol = along.add(shift).sub(col.mul(len))
  const w = px.mul(0.7).max(0.025)
  const joint = float(1).sub(
    band(inRow, w, course.sub(w), px).mul(band(inCol, w, len.sub(w), px)),
  )
  const id = row
    .mul(131)
    .add(col.mul(17))
    .add(floor(seed.mul(997)))
  const tone = float(1).add(hash(id.abs()).sub(0.5).mul(0.1))
  // The repairs, in patches some 20–40 m along and a few courses high, made when the
  // consuls "repaired the walls, and planted engines on them" in 87 BCE (Appian, Civil
  // Wars 1.66): from then only.
  const repaired = step(float(-86.5), modelUniforms.year)
  const patch = step(
    0.88,
    hash(
      floor(along.div(31))
        .add(floor(height.div(3.5)).mul(7))
        .add(floor(seed.mul(53))),
    ),
  )
    .mul(step(0.45, hash(id.abs().add(11))))
    .mul(repaired)
  const repair = mix(vec3(1), vec3(0.93, 0.86, 0.8), patch.mul(blocks))
  return repair
    .mul(mix(float(1), tone, blocks))
    .mul(mix(float(1), float(0.68), joint.mul(joints)))
}

function material(occlusion: Occlusion, viewM: F, origin: THREE.Vector2) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 })
  // Built by hand, the geometry's winding is not consistent: both faces are drawn,
  // and three turns each face's normal towards the eye.
  mat.side = THREE.DoubleSide
  const vex = terrainUniforms.verticalExaggeration
  const ground = attribute('ground', 'float')
  const up = positionLocal.z
  const years = attribute('years', 'vec4')
  const y = modelUniforms.year
  const stands = y.greaterThanEqual(years.x).and(y.lessThanEqual(years.y))
  const unfinished = y.greaterThanEqual(years.z).and(y.lessThanEqual(years.w))
  // What a face is painted with (`SKIN`, below): a tree's is only that it is one.
  const skin = attribute('skin', 'vec4')
  const surface = floor(skin.x.div(10))
  const tree = surface.greaterThan(4.5).and(surface.lessThan(5.5))
  // The country's trees grow up out of the ground with the fields they stand in
  // (fields.ts `plotShown`), so neither they nor their shadows draw the plots on the
  // map's plain ground before them; and the portrait (`paint`), shown before them,
  // is drawn without them.
  const at = positionLocal.xy.add(vec2(origin.x, origin.y))
  const planted = select(tree, plotShown(at.x, at.y), float(1))
  // Not standing this year, or a tree not yet come in: sunk well under the ground,
  // where the terrain hides it.
  const shows = stands.and(planted.greaterThan(0.01))
  const scale = select(shows, planted, float(0))
  const sink = select(shows, float(0), float(40))
  mat.positionNode = vec3(
    positionLocal.x,
    positionLocal.y,
    ground.add(up.mul(modelUniforms.grow).mul(scale)).sub(sink).mul(vex),
  )
  // Heights over the ground as built, before the model rises.
  const built = positionGeometry.z
  // Part-built (`Builder.finish`, `Builder.rise`): works in progress, or a shell left
  // by fire, are cut off at the height they had reached — open to the sky, as a
  // building going up or burnt out is — and a burnt one is blackened towards its top.
  // Works rise year by year from the height of their first year to that of their
  // last, a course of blocks at a time (works.ts `COURSE`).
  const part = attribute('part', 'vec2')
  const burnt = part.y.lessThan(-0.5)
  const span = years.w.sub(years.z).add(1)
  const done = clamp(y.sub(years.z).add(1).div(span), 0, 1)
  const risen = part.x.add(
    floor(mix(part.x, part.y, done).sub(part.x).div(COURSE).add(1e-3)).mul(COURSE),
  )
  const reached = select(done.greaterThan(0.999), part.y, risen)
  const cut = select(
    unfinished.and(part.x.lessThan(5e4)),
    select(burnt, part.x, reached).add(0.02),
    float(1e5),
  )
  // Overhead there is no terrain to hide what is sunk.
  mat.maskNode = built
    .lessThanEqual(cut)
    .and(shows.or(modelUniforms.overhead.lessThan(0.5)))
  const soot = select(
    unfinished.and(burnt),
    mix(float(0.8), float(0.45), smoothstep(0, part.x.max(1), built)),
    float(1),
  )
  // Where a wall meets the ground it darkens, as a model's does; and wherever the
  // model overshadows itself, less of the sky's light reaches. Both by its height
  // over the ground under it, which is over its own ground but for a building that
  // stands on a terrace and hangs its front over lower ground (the Tabularium).
  const over = built.max(ground.add(built).sub(groundAt(positionWorld.x, positionWorld.y)))
  const foot = mix(float(0.85), float(1), smoothstep(0, 3, over))
  const open = occlusion.at(positionWorld.x, positionWorld.y, over)
  mat.aoNode = open
  // The houses' walls and roofs, painted (`SKIN`).
  const rest = skin.x.sub(surface.mul(10))
  const kind = floor(rest)
  const seed = fract(rest).div(0.9)
  const paint = select(
    tree,
    vec3(1),
    select(
      surface.greaterThan(5.5),
      vec3(coursesPaint(ground.add(built))),
      select(
        surface.greaterThan(3.5),
        ashlarPaint(seed, skin.y, skin.z),
        select(
          surface.greaterThan(2.5),
          vec3(roofPaint(seed, skin.y, skin.z, skin.w)),
          select(
            surface.greaterThan(0.5),
            wallPaint(surface, kind, seed, skin.y, skin.z, skin.w, built),
            vec3(1),
          ),
        ),
      ),
    ),
  )
  // The relief under the city, washed over it at half strength, so the hills read
  // from above while the buildings keep their own colour and their real shadows
  // show the slopes.
  const wash = mix(float(1), reliefWash(positionWorld.x, positionWorld.y), 0.5)
  const lit = attribute('colour', 'vec3')
    .mul(paint)
    .mul(foot)
    .mul(mix(float(1), open, 0.5))
    .mul(wash)
    .mul(soot)
  // A little haze with distance, as over a real city: what is far off is paler and
  // flatter, so the near streets stand out from the roofs behind them.
  const far = smoothstep(1.2, 3.5, cameraPosition.sub(positionWorld).length().div(viewM))
  mat.colorNode = mix(lit, vec3(HAZE.r, HAZE.g, HAZE.b), far.mul(0.25))
  // Whatever runs out to the edge of the modelled ground (an aqueduct across the
  // Campagna) fades out with it, dithered, rather than stopping in a cut.
  mat.opacityNode = plateMask(positionWorld.x, positionWorld.y, fwidth(positionWorld.x))
  mat.alphaHash = true
  return mat
}
