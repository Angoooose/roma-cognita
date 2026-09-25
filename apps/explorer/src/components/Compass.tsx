import type { RomeMap } from '@roman-map/engine'
import { useEffect, useRef } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * The compass: a needle that points to north however the map is turned (right-drag),
 * beside the timeline in the bottom-right corner. Pressing it turns the map back to
 * north up. The needle is written straight to the DOM each frame, not through React
 * state, since a turn changes it every frame.
 */
export function Compass({ map }: { map: RomeMap }) {
  const needle = useRef<SVGGElement>(null)

  useEffect(() => {
    let raf = 0
    let shown = NaN
    const tick = () => {
      const h = map.view.heading
      if (h !== shown) {
        shown = h
        // The view faces `h`, so north stands `h` degrees anticlockwise of up.
        needle.current?.setAttribute('transform', `rotate(${-h} 12 12)`)
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [map])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => map.view.resetHeading()}
          aria-label="Turn the map to north"
          className="grid size-10 place-items-center rounded-lg border border-rule bg-background/90 text-foreground shadow-plate backdrop-blur-sm transition-colors outline-none select-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
            <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--rule)" />
            <g ref={needle}>
              <polygon points="12,3 15,12 9,12" fill="var(--primary)" />
              <polygon points="12,21 15,12 9,12" fill="currentColor" opacity="0.35" />
            </g>
          </svg>
        </button>
      </TooltipTrigger>
      <TooltipContent>North up</TooltipContent>
    </Tooltip>
  )
}
