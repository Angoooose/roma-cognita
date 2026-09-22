import type { RomeMap } from '@roman-map/engine'

/**
 * `?debug=1`. Frame timing cannot be measured from a headless browser, so the page
 * measures itself — this is how the old SVG map found its contour-layer bottleneck.
 */
export function mountDebug(map: RomeMap) {
  const el = document.createElement('div')
  el.className = 'debug'
  document.body.appendChild(el)

  const tick = () => {
    const f = map.frame
    const t = map.terrain.stats
    const [lon, lat] = map.view.lonLat
    const s = map.view.state
    el.textContent = [
      `${map.backend}   ${f.fps.toFixed(0)} fps   render ${f.frameMs.toFixed(1)} ms`,
      `draws ${f.drawCalls}   tris ${(f.triangles / 1000).toFixed(0)}k`,
      `tiles drawn ${t.drawn}  ready ${t.ready}  loading ${t.loading}  queued ${t.queued}`,
      `deepest level ${t.maxLevelDrawn}`,
      `at ${lon.toFixed(3)}, ${lat.toFixed(3)}   ${(s.distance / 1000).toFixed(0)} km   pitch ${s.pitch.toFixed(0)}°`,
      `${map.view.metresPerPixel.toFixed(0)} m/px`,
    ].join('\n')
    requestAnimationFrame(tick)
  }
  tick()
}
