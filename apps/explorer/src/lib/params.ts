import { type CameraState, MapCamera, type MapRef } from '@roma-cognita/engine'
import type { PersonId } from '@roma-cognita/schema'
import { formatYear, parseYear } from './year.ts'

/**
 * URL parameters, so any view can be linked and screenshotted:
 *   ?at=<lon>,<lat>&km=<distance>&pitch=<deg>   the camera
 *   &heading=<deg>                              the way it faces (default: north)
 *   ?year=63BCE                                 the year shown (default: 63 BCE)
 *   ?show=polity:rome, ?show=place:roma         the inspector open on a thing
 *   ?person=dprr:2072                           the person panel open on someone
 *   ?webgl=1                                    force the WebGL2 fallback
 *   ?debug=1                                    frame-rate and tile readout
 *   ?bare=1                                     no timeline or inspector
 *
 * The view (camera, year, show, person) is written back as it changes, so the address
 * is always a link to what is on screen. The switches are read only.
 */
const DEFAULT_AT = [12.5, 41.9] as const
const DEFAULT_KM = 1400
const DEFAULT_YEAR = '63BCE'

export function readParams() {
  const params = new URLSearchParams(location.search)
  const [lon, lat] = (params.get('at') ?? DEFAULT_AT.join(',')).split(',').map(Number)
  const km = Number(params.get('km') ?? DEFAULT_KM)
  const pitch = Number(params.get('pitch') ?? 0)
  const heading = Number(params.get('heading') ?? 0)
  return {
    camera: MapCamera.fromLonLat(lon, lat, km, pitch, heading),
    /** Whether the address set the camera, which then wins over framing `show`. */
    cameraSet: params.has('at'),
    forceWebGL: params.has('webgl'),
    debug: params.has('debug'),
    bare: params.has('bare'),
    year: parseYear(params.get('year') ?? DEFAULT_YEAR),
    show: parseRef(params.get('show')),
    person: parsePerson(params.get('person')),
  }
}

export interface ViewPatch {
  camera?: { lonLat: [number, number]; state: CameraState }
  year?: number
  show?: MapRef | null
  person?: PersonId | null
}

// Changes gather here and go to the address together once they stop coming: a pan or
// a scrub of the timeline is one write, not one a frame. Safari refuses more than
// about a hundred history calls in thirty seconds.
let pending: Record<string, string | null> = {}
let timer: ReturnType<typeof setTimeout> | undefined
const SETTLE_MS = 250

export function writeParams(patch: ViewPatch) {
  if (patch.camera) Object.assign(pending, cameraParams(patch.camera))
  if (patch.year !== undefined) {
    const y = formatYear(patch.year).replace(' ', '')
    pending.year = y === DEFAULT_YEAR ? null : y
  }
  if (patch.show !== undefined) {
    pending.show = patch.show && `${patch.show.kind}:${patch.show.id}`
  }
  if (patch.person !== undefined) pending.person = patch.person
  clearTimeout(timer)
  timer = setTimeout(flush, SETTLE_MS)
}

// Replaced, not pushed: the browser's back button leaves the map rather than stepping
// back through every view on the way.
function flush() {
  const url = new URL(location.href)
  for (const [k, v] of Object.entries(pending)) {
    if (v === null) url.searchParams.delete(k)
    else url.searchParams.set(k, v)
  }
  pending = {}
  // `:` and `,` are left as they are, so `show=polity:rome` and `at=12.5,41.9` read.
  url.search = url.searchParams.toString().replace(/%3A/g, ':').replace(/%2C/g, ',')
  if (url.href !== location.href) history.replaceState(history.state, '', url)
}

// Rounded to about ten metres and three figures of distance: close enough to come back
// to the same view, short enough to paste.
function cameraParams({ lonLat: [lon, lat], state }: NonNullable<ViewPatch['camera']>) {
  const at = `${round(lon, 4)},${round(lat, 4)}`
  const km = Number((state.distance / 1000).toPrecision(3))
  const pitch = Math.round(state.pitch)
  const heading = Math.round(state.heading ?? 0)
  const home = at === DEFAULT_AT.join(',') && km === DEFAULT_KM
  return {
    at: home ? null : at,
    km: home ? null : String(km),
    pitch: pitch ? String(pitch) : null,
    heading: heading ? String(heading) : null,
  }
}

function round(n: number, places: number) {
  return Number(n.toFixed(places))
}

function parseRef(v: string | null): MapRef | null {
  const m = v && /^(place|polity):([a-z0-9-]+)$/.exec(v)
  return m ? { kind: m[1] as MapRef['kind'], id: m[2] } : null
}

function parsePerson(v: string | null): PersonId | null {
  return v && /^(dprr:\d+|ours:[a-z0-9-]+)$/.test(v) ? (v as PersonId) : null
}
