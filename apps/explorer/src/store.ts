import type { PlaceHit, PoliticalHit, RomeMap } from '@roman-map/engine'
import { create } from 'zustand'

export type Inspected =
  { kind: 'place'; hit: PlaceHit } | { kind: 'territory'; hit: PoliticalHit }

interface ExplorerState {
  /** Set once the engine has loaded; null before then and after unmount. */
  map: RomeMap | null
  /** Mirrors `map.year` (astronomical, 1 BCE = 0) so components re-render on change. */
  year: number
  /** What the inspector shows, and the client point it was picked at. */
  inspected: Inspected | null
  inspectedAt: { x: number; y: number } | null

  attach(map: RomeMap | null): void
  /** Moves to a year within the data's window, cross-fading, and re-reads the inspector. */
  goToYear(year: number): void
  inspect(x: number, y: number): Promise<void>
  closeInspector(): void
}

// Picks are async; only the latest one may land.
let pickSeq = 0

export const useExplorer = create<ExplorerState>()((set, get) => ({
  map: null,
  year: 0,
  inspected: null,
  inspectedAt: null,

  attach(map) {
    set({ map, year: map?.year ?? 0, inspected: null, inspectedAt: null })
  },

  goToYear(year) {
    const { map, inspected, inspectedAt } = get()
    const span = map?.politics.window
    if (!map || !span) return
    year = Math.max(span[0], Math.min(span[1], Math.round(year)))
    if (year === map.year) return
    map.setYear(year, { animate: true })
    set({ year: map.year })
    // The panel follows the timeline: the same spot, read for the new year.
    if (inspected && inspectedAt) get().inspect(inspectedAt.x, inspectedAt.y)
  },

  async inspect(x, y) {
    const { map } = get()
    if (!map) return
    const seq = ++pickSeq
    const hit = await map.pick(x, y)
    if (seq !== pickSeq) return
    if (hit && 'place' in hit) {
      set({ inspected: { kind: 'place', hit: hit.place }, inspectedAt: { x, y } })
    } else if (hit?.territory.claim && hit.territory.polity) {
      set({ inspected: { kind: 'territory', hit: hit.territory }, inspectedAt: { x, y } })
    } else {
      set({ inspected: null, inspectedAt: null })
    }
  },

  closeInspector() {
    pickSeq++
    set({ inspected: null, inspectedAt: null })
  },
}))
