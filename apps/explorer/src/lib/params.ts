import { MapCamera } from '@roman-map/engine'
import { parseYear } from './year.ts'

/**
 * URL parameters, so any view can be linked and screenshotted:
 *   ?at=<lon>,<lat>&km=<distance>&pitch=<deg>   the camera
 *   ?webgl=1                                    force the WebGL2 fallback
 *   ?debug=1                                    frame-rate and tile readout
 *   ?year=63BCE                                 the year shown (default: 63 BCE)
 *   ?bare=1                                     no timeline or inspector
 */
export function readParams() {
  const params = new URLSearchParams(location.search)
  const [lon, lat] = (params.get('at') ?? '12.5,41.9').split(',').map(Number)
  const km = Number(params.get('km') ?? 1400)
  const pitch = Number(params.get('pitch') ?? 0)
  return {
    camera: MapCamera.fromLonLat(lon, lat, km, pitch),
    forceWebGL: params.has('webgl'),
    debug: params.has('debug'),
    bare: params.has('bare'),
    year: parseYear(params.get('year') ?? '63BCE'),
  }
}
