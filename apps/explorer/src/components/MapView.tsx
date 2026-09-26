import { type CameraState, RomeMap } from '@roma-cognita/engine'
import { useEffect, useRef } from 'react'
import { useExplorer } from '@/store.ts'

interface Props {
  camera: CameraState
  forceWebGL: boolean
  year: number
}

/**
 * Owns the engine: creates it in a full-window container on mount and disposes it on
 * unmount. The engine is framework-free (DESIGN.md §9); this is the thin wrapper.
 * Props are read once, at creation.
 */
export function MapView({ camera, forceWebGL, year }: Props) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let map: RomeMap | undefined
    let cancelled = false
    RomeMap.create(container.current!, { camera, forceWebGL }).then((m) => {
      if (cancelled) return m.dispose()
      map = m
      m.setYear(year)
      useExplorer.getState().attach(m)
      // For the screenshot harness and the console.
      Object.assign(window, { map: m })
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
