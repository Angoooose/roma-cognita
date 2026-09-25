import * as THREE from 'three/webgpu'
import { frameRect, projection } from '@roman-map/world'

/**
 * A strategy-map camera: a ground target, a distance, a tilt, and a heading. North is up
 * unless the reader turns the map, and the compass turns it back. Right-drag (a
 * two-finger click-and-drag on a trackpad) turns it sideways and tilts it up and down;
 * in Safari a two-finger twist turns it too.
 *
 * Panning and zooming are anchored to the ground point under the cursor, so the place
 * you grabbed stays under your hand. That is the difference between a map that feels
 * physical and one that feels like a viewport sliding over a picture.
 */

export interface CameraState {
  /** Ground target in plane metres. */
  x: number
  y: number
  /** Distance from target along the view ray, metres. */
  distance: number
  /** Tilt from straight down, degrees. */
  pitch: number
  /** The compass bearing the view faces, degrees clockwise from north; 0 is north up. */
  heading?: number
}

const MIN_DISTANCE = 4_000
const MAX_DISTANCE = 7_500_000
const MAX_PITCH = 55
const FOV = 30

/**
 * The ground target stays over the frame, so the camera can look into the cloud bank at
 * the edge of the known world but never fly past it into the empty plane beyond.
 */
const BOUNDS = frameRect(0)

export class MapCamera {
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 10, 1e8)
  state: CameraState
  onChange?: () => void
  /**
   * How close the camera may come over a ground point, metres. MIN_DISTANCE everywhere
   * but where a layer has detail finer than the terrain's: the plan of Rome lets it in
   * about three times closer (RomeMap). It should vary smoothly, so a pan never jumps.
   */
  minDistanceAt: (x: number, y: number) => number = () => MIN_DISTANCE
  private flight: Flight | null = null
  private turn: Turn | null = null
  private raycaster = new THREE.Raycaster()
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  private ndc = new THREE.Vector2()
  private hit = new THREE.Vector3()

  private el: HTMLElement

  constructor(el: HTMLElement, initial: CameraState) {
    this.el = el
    this.state = { heading: 0, ...initial }
    this.apply()
    this.bind()
  }

  static fromLonLat(
    lon: number,
    lat: number,
    distanceKm: number,
    pitch = 0,
    heading = 0,
  ): CameraState {
    const [x, y] = projection.forward(lon, lat)
    return { x, y, distance: distanceKm * 1000, pitch, heading }
  }

  /** The heading, degrees clockwise from north, in (-180, 180]. */
  get heading() {
    return this.state.heading ?? 0
  }

  get lonLat() {
    return projection.inverse(this.state.x, this.state.y)
  }

  /** Ground metres per CSS pixel at the target — the number the zoom tiers key on. */
  get metresPerPixel() {
    const h = this.el.clientHeight || 1
    return (2 * this.state.distance * Math.tan((FOV * Math.PI) / 360)) / h
  }

  resize(width: number, height: number) {
    this.camera.aspect = width / height
    this.apply()
  }

  apply() {
    this.state.x = clamp(this.state.x, BOUNDS.minX, BOUNDS.maxX)
    this.state.y = clamp(this.state.y, BOUNDS.minY, BOUNDS.maxY)
    this.state.distance = clamp(
      this.state.distance,
      this.minDistanceAt(this.state.x, this.state.y),
      MAX_DISTANCE,
    )
    this.state.heading = wrap(this.heading)
    const { x, y, distance, pitch } = this.state
    const p = (pitch * Math.PI) / 180
    const h = (this.heading * Math.PI) / 180
    const c = this.camera
    // The camera stands back from the target against the way it faces.
    const back = distance * Math.sin(p)
    c.position.set(x - back * Math.sin(h), y - back * Math.cos(h), distance * Math.cos(p))
    // Looking straight down with north up is the identity rotation; tilting is a turn
    // about x, and heading a turn about z after it. Building it directly avoids lookAt's
    // degenerate up vector at pitch 0.
    c.rotation.set(p, 0, -h, 'ZXY')
    c.near = Math.max(10, distance * 0.02)
    c.far = distance * 30
    c.updateProjectionMatrix()
    c.updateMatrixWorld()
    this.onChange?.()
  }

  /** The camera distance at which the target shows `mpp` ground metres per CSS pixel. */
  distanceFor(mpp: number) {
    const h = this.el.clientHeight || 1
    return (mpp * h) / (2 * Math.tan((FOV * Math.PI) / 360))
  }

  /**
   * Moves to a ground target and distance, eased. Zoom runs in log space, and a long
   * jump rises high enough to see both ends on the way, so the reader keeps their
   * bearings. Grabbing or scrolling the map cancels it.
   */
  flyTo(to: { x: number; y: number; distance: number }) {
    const from = { ...this.state }
    const tx = clamp(to.x, BOUNDS.minX, BOUNDS.maxX)
    const ty = clamp(to.y, BOUNDS.minY, BOUNDS.maxY)
    const target = {
      x: tx,
      y: ty,
      distance: clamp(to.distance, this.minDistanceAt(tx, ty), MAX_DISTANCE),
    }
    const l0 = Math.log(from.distance)
    const l1 = Math.log(target.distance)
    // Both ends in view means their separation within most of the visible ground height.
    const sep = Math.hypot(target.x - from.x, target.y - from.y)
    const peak = Math.log(
      Math.min(MAX_DISTANCE, sep / (1.6 * Math.tan((FOV * Math.PI) / 360))),
    )
    const rise = Math.max(0, peak - Math.max(l0, l1))
    // Longer for a longer journey, in screens crossed and in zoom: tuned by eye.
    const screens = sep / Math.max(from.distance, target.distance)
    const ms = clamp(550 + 220 * Math.log2(1 + screens) + 90 * Math.abs(l1 - l0), 550, 1800)
    this.flight = { start: performance.now(), ms, from, to: target, l0, l1, rise }
  }

  /** Turns the map back to north up, eased, the short way round. */
  resetHeading() {
    const from = this.heading
    if (from === 0) return
    this.turn = {
      start: performance.now(),
      ms: clamp(250 + 2.5 * Math.abs(from), 250, 700),
      from,
    }
  }

  /** Advances a flight or a turn; true while one is running. */
  step(now: number) {
    const turning = this.stepTurn(now)
    const f = this.flight
    if (!f) return turning
    const t = Math.min(1, (now - f.start) / f.ms)
    const u = t * t * t * (t * (t * 6 - 15) + 10)
    this.state.x = f.from.x + (f.to.x - f.from.x) * u
    this.state.y = f.from.y + (f.to.y - f.from.y) * u
    this.state.distance = Math.exp(f.l0 + (f.l1 - f.l0) * u + f.rise * 4 * u * (1 - u))
    if (t >= 1) this.flight = null
    this.apply()
    return true
  }

  private stepTurn(now: number) {
    const r = this.turn
    if (!r) return false
    const t = Math.min(1, (now - r.start) / r.ms)
    this.state.heading = r.from * (1 - t * t * (3 - 2 * t))
    if (t >= 1) this.turn = null
    this.apply()
    return true
  }

  /** The point on the plane (z = 0) under a client position. Ignores relief. */
  ground(clientX: number, clientY: number): THREE.Vector3 | null {
    const r = this.el.getBoundingClientRect()
    this.ndc.set(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.ndc, this.camera)
    return this.raycaster.ray.intersectPlane(this.plane, this.hit)?.clone() ?? null
  }

  private bind() {
    const el = this.el
    let anchor: THREE.Vector3 | null = null
    let turning = false
    let lastX = 0
    let lastY = 0

    el.addEventListener('contextmenu', (e) => e.preventDefault())
    el.addEventListener('pointerdown', (e) => {
      this.flight = null
      this.turn = null
      el.setPointerCapture(e.pointerId)
      turning = e.button === 2 || e.shiftKey
      lastX = e.clientX
      lastY = e.clientY
      anchor = turning ? null : this.ground(e.clientX, e.clientY)
    })
    el.addEventListener('pointermove', (e) => {
      if (!el.hasPointerCapture(e.pointerId)) return
      if (turning) {
        // Dragging right turns the view right, as a head turns, about the target.
        this.state.heading = this.heading + (e.clientX - lastX) * 0.3
        this.state.pitch = clamp(
          this.state.pitch + (lastY - e.clientY) * 0.25,
          0,
          MAX_PITCH,
        )
        lastX = e.clientX
        lastY = e.clientY
        this.apply()
        return
      }
      if (!anchor) return
      const p = this.ground(e.clientX, e.clientY)
      if (!p) return
      this.state.x += anchor.x - p.x
      this.state.y += anchor.y - p.y
      this.apply()
    })
    el.addEventListener('pointerup', (e) => el.releasePointerCapture(e.pointerId))

    // Safari's trackpad twist. Its pinch also arrives as ctrl+wheel, which zooms below,
    // so only the rotation is read here. Twisting clockwise turns the map clockwise.
    let twistFrom = 0
    el.addEventListener('gesturestart', (e) => {
      e.preventDefault()
      this.flight = null
      this.turn = null
      twistFrom = this.heading
    })
    el.addEventListener('gesturechange', (e) => {
      e.preventDefault()
      this.state.heading = twistFrom - ((e as Event & { rotation?: number }).rotation ?? 0)
      this.apply()
    })

    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        this.flight = null
        const before = this.ground(e.clientX, e.clientY)
        // Trackpad pinches arrive as ctrl+wheel with small deltas; mice as large ones.
        const k = e.ctrlKey ? 0.01 : 0.0015
        this.state.distance = clamp(
          this.state.distance * Math.exp(e.deltaY * k),
          this.minDistanceAt(this.state.x, this.state.y),
          MAX_DISTANCE,
        )
        this.apply()
        const after = this.ground(e.clientX, e.clientY)
        if (before && after) {
          this.state.x += before.x - after.x
          this.state.y += before.y - after.y
          this.apply()
        }
      },
      { passive: false },
    )
  }
}

interface Turn {
  start: number
  ms: number
  /** The heading it turns from, to 0. */
  from: number
}

interface Flight {
  start: number
  ms: number
  from: CameraState
  to: { x: number; y: number; distance: number }
  /** Log distances at the ends, and how far above both the path rises midway. */
  l0: number
  l1: number
  rise: number
}

/** Degrees into (-180, 180]. */
function wrap(deg: number) {
  const d = ((deg % 360) + 360) % 360
  return d > 180 ? d - 360 : d
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}
