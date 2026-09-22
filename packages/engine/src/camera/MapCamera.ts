import * as THREE from 'three/webgpu'
import { projection } from '../geo/frame.ts'

/**
 * A strategy-map camera: a ground target, a distance, and a tilt. No heading — north is
 * up, as on every map this one is compared against.
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
}

const MIN_DISTANCE = 4_000
const MAX_DISTANCE = 9_000_000
const MAX_PITCH = 55
const FOV = 30

export class MapCamera {
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 10, 1e8)
  state: CameraState
  onChange?: () => void
  private raycaster = new THREE.Raycaster()
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  private ndc = new THREE.Vector2()
  private hit = new THREE.Vector3()

  private el: HTMLElement

  constructor(el: HTMLElement, initial: CameraState) {
    this.el = el
    this.state = { ...initial }
    this.apply()
    this.bind()
  }

  static fromLonLat(lon: number, lat: number, distanceKm: number, pitch = 0): CameraState {
    const [x, y] = projection.forward(lon, lat)
    return { x, y, distance: distanceKm * 1000, pitch }
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
    const { x, y, distance, pitch } = this.state
    const p = (pitch * Math.PI) / 180
    const c = this.camera
    c.position.set(x, y - distance * Math.sin(p), distance * Math.cos(p))
    // Looking straight down with north up is the identity rotation; tilting is a turn
    // about x. Building it directly avoids lookAt's degenerate up vector at pitch 0.
    c.rotation.set(p, 0, 0)
    c.near = Math.max(10, distance * 0.02)
    c.far = distance * 30
    c.updateProjectionMatrix()
    c.updateMatrixWorld()
    this.onChange?.()
  }

  private ground(clientX: number, clientY: number): THREE.Vector3 | null {
    const r = this.el.getBoundingClientRect()
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
    this.raycaster.setFromCamera(this.ndc, this.camera)
    return this.raycaster.ray.intersectPlane(this.plane, this.hit)?.clone() ?? null
  }

  private bind() {
    const el = this.el
    let anchor: THREE.Vector3 | null = null
    let tilting = false
    let lastY = 0

    el.addEventListener('contextmenu', (e) => e.preventDefault())
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId)
      tilting = e.button === 2 || e.shiftKey
      lastY = e.clientY
      anchor = tilting ? null : this.ground(e.clientX, e.clientY)
    })
    el.addEventListener('pointermove', (e) => {
      if (!el.hasPointerCapture(e.pointerId)) return
      if (tilting) {
        this.state.pitch = clamp(this.state.pitch + (lastY - e.clientY) * 0.25, 0, MAX_PITCH)
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

    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        const before = this.ground(e.clientX, e.clientY)
        // Trackpad pinches arrive as ctrl+wheel with small deltas; mice as large ones.
        const k = e.ctrlKey ? 0.01 : 0.0015
        this.state.distance = clamp(
          this.state.distance * Math.exp(e.deltaY * k),
          MIN_DISTANCE,
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

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}
