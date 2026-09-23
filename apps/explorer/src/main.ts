import { MapCamera, RomeMap } from '@roman-map/engine'
import { mountDebug } from './debug.ts'
import { mountInspector } from './inspector.ts'
import { mountTimeline } from './timeline.ts'

/**
 * URL parameters, so any view can be linked and screenshotted:
 *   ?at=<lon>,<lat>&km=<distance>&pitch=<deg>   the camera
 *   ?webgl=1                                    force the WebGL2 fallback
 *   ?debug=1                                    frame-rate and tile readout
 *   ?year=63BCE                                 the year shown (default: 63 BCE)
 *   ?bare=1                                     no timeline or inspector
 */
const params = new URLSearchParams(location.search)
const [lon, lat] = (params.get('at') ?? '12.5,41.9').split(',').map(Number)
const km = Number(params.get('km') ?? 1400)
const pitch = Number(params.get('pitch') ?? 0)

const map = await RomeMap.create(document.getElementById('map')!, {
  camera: MapCamera.fromLonLat(lon, lat, km, pitch),
  forceWebGL: params.has('webgl'),
})

map.setYear(parseYear(params.get('year') ?? '63BCE'))
if (!params.has('bare')) {
  const inspector = mountInspector(map)
  mountTimeline(map, () => inspector.refresh())
}

if (params.has('debug')) mountDebug(map)

// For the screenshot harness and the console.
Object.assign(window, { map })

/** `63BCE`, `63 BCE`, `14CE` → astronomical (1 BCE = 0). */
function parseYear(s: string): number {
  const m = /^(\d+)\s*(BCE|BC|CE|AD)?$/i.exec(s.trim())
  if (!m) return -62
  const n = Number(m[1])
  return /^(CE|AD)$/i.test(m[2] ?? '') ? n : 1 - n
}
