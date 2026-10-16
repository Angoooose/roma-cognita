import { type CameraState, type MapRef, RomeMap } from '@roma-cognita/engine'
import { useEffect, useRef } from 'react'
import { writeParams } from '@/lib/params.ts'
import { useExplorer } from '@/store.ts'

interface Props {
  camera: CameraState
  /** Expose the engine as `window.map`, for the screenshot harness and the console. */
  debug: boolean
  forceWebGL: boolean
  /** The share of the first frame's data loaded, as it arrives. */
  onProgress?: (loaded: number) => void
  /** A thing to open the inspector on, and whether to fly to it rather than keep `camera`. */
  show: MapRef | null
  flyToShow: boolean
  year: number
}

/**
 * Owns the engine: creates it in a full-window container on mount and disposes it on
 * unmount. The engine is framework-free (DESIGN.md §9); this is the thin wrapper.
 * Props are read once, at creation.
 */
export function MapView({
  camera,
  debug,
  forceWebGL,
  onProgress,
  show,
  flyToShow,
  year,
}: Props) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let map: RomeMap | undefined
    let cancelled = false
    RomeMap.create(container.current!, { camera, forceWebGL, onProgress }).then((m) => {
      if (cancelled) return m.dispose()
      map = m
      m.setYear(year)
      useExplorer.getState().attach(m)
      if (show) useExplorer.getState().open(show, { fly: flyToShow })
      m.onCamera = () =>
        writeParams({ camera: { lonLat: m.view.lonLat, state: m.view.state } })
      if (import.meta.env.DEV || debug) Object.assign(window, { map: m })
    })
    return () => {
      cancelled = true
      if (!map) return
      useExplorer.getState().attach(null)
      map.dispose()
    }
  }, [])

  return <div ref={container} className="fixed inset-0 touch-none bg-[#1e3150]" />
}
