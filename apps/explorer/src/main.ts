import { MapCamera, RomeMap } from '@roman-map/engine'
import { mountDebug } from './debug.ts'

/**
 * URL parameters, so any view can be linked and screenshotted:
 *   ?at=<lon>,<lat>&km=<distance>&pitch=<deg>   the camera
 *   ?webgl=1                                    force the WebGL2 fallback
 *   ?debug=1                                    frame-rate and tile readout
 */
const params = new URLSearchParams(location.search)
const [lon, lat] = (params.get('at') ?? '12.5,41.9').split(',').map(Number)
const km = Number(params.get('km') ?? 1400)
const pitch = Number(params.get('pitch') ?? 0)

const map = await RomeMap.create(document.getElementById('map')!, {
  camera: MapCamera.fromLonLat(lon, lat, km, pitch),
  forceWebGL: params.has('webgl'),
})

if (params.has('debug')) mountDebug(map)

// For the screenshot harness and the console.
Object.assign(window, { map })
