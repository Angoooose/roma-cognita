import { useEffect, useRef } from 'react'
import { useExplorer } from '@/store.ts'

/**
 * `?debug=1`. Frame timing cannot be measured from a headless browser, so the page
 * measures itself — this is how the old SVG map found its contour-layer bottleneck.
 * Written straight to the DOM each frame, not through React state.
 */
export function DebugOverlay() {
  const map = useExplorer((s) => s.map)
  const el = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!map) return
    let raf = 0
    const tick = () => {
      const f = map.frame
      const t = map.terrain.stats
      const [lon, lat] = map.view.lonLat
      const s = map.view.state
      el.current!.textContent = [
        `${map.backend}   ${f.fps.toFixed(0)} fps   render ${f.frameMs.toFixed(1)} ms`,
        `draws ${f.drawCalls}   tris ${(f.triangles / 1000).toFixed(0)}k`,
        `tiles drawn ${t.drawn}  ready ${t.ready}  loading ${t.loading}  queued ${t.queued}`,
        `deepest level ${t.maxLevelDrawn}`,
        `at ${lon.toFixed(3)}, ${lat.toFixed(3)}   ${(s.distance / 1000).toFixed(0)} km   pitch ${s.pitch.toFixed(0)}°   heading ${map.view.heading.toFixed(0)}°`,
        `${map.view.metresPerPixel.toFixed(0)} m/px`,
      ].join('\n')
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [map])

  return (
    <div
      ref={el}
      className="pointer-events-none fixed top-3 left-3 rounded-md bg-black/80 px-2.5 py-2 font-mono text-[11px] leading-snug whitespace-pre text-white tabular-nums"
    />
  )
}
