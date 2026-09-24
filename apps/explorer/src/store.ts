import type { MapEntry, MapRef, PlaceHit, PoliticalHit, RomeMap } from '@roman-map/engine'
import { create } from 'zustand'

export type Inspected =
  { kind: 'place'; hit: PlaceHit } | { kind: 'territory'; hit: PoliticalHit }

/**
 * What the inspector is open on: a spot clicked on the map, read afresh for each year,
 * or a thing gone to by name, which stays that thing.
 */
export type Selection = { by: 'point'; x: number; y: number } | { by: 'ref'; ref: MapRef }

/** The inspector's width and its gap from the edge, CSS px, for framing beside it. */
const INSPECTOR_INSET = 300 + 16

interface ExplorerState {
  /** Set once the engine has loaded; null before then and after unmount. */
  map: RomeMap | null
  /** Mirrors `map.year` (astronomical, 1 BCE = 0) so components re-render on change. */
  year: number
  /** What the inspector shows, and what it was opened on. */
  inspected: Inspected | null
  selection: Selection | null

  attach(map: RomeMap | null): void
  /** Moves to a year within the data's window, cross-fading, and re-reads the inspector. */
  goToYear(year: number): void
  inspect(x: number, y: number): Promise<void>
  /** Flies to a search result, in the first year it is on the map if not this one, and inspects it. */
  goTo(entry: MapEntry): void
  closeInspector(): void
}

// Picks are async; only the latest one may land.
let pickSeq = 0

export const useExplorer = create<ExplorerState>()((set, get) => ({
  map: null,
  year: 0,
  inspected: null,
  selection: null,

  attach(map) {
    set({ map, year: map?.year ?? 0, inspected: null, selection: null })
  },

  goToYear(year) {
    const { map, selection } = get()
    const span = map?.politics.window
    if (!map || !span) return
    year = Math.max(span[0], Math.min(span[1], Math.round(year)))
    if (year === map.year) return
    map.setYear(year, { animate: true })
    set({ year: map.year })
    // The panel follows the timeline: the same spot, or the same thing, read for the new year.
    if (selection?.by === 'point') get().inspect(selection.x, selection.y)
    else if (selection?.by === 'ref') inspectRef(selection.ref)
  },

  async inspect(x, y) {
    const { map } = get()
    if (!map) return
    const seq = ++pickSeq
    const hit = await map.pick(x, y)
    if (seq !== pickSeq) return
    show(hit, { by: 'point', x, y })
  },

  goTo(entry) {
    const { map } = get()
    if (!map) return
    const onMap = entry.years.some(([a, b]) => a <= map.year && map.year <= b)
    if (!onMap) {
      set({ selection: null })
      get().goToYear(entry.years[0][0])
    }
    // Beside the inspector, when there is room for both.
    const inset = window.innerWidth >= 720 ? INSPECTOR_INSET : 0
    map.flyTo(entry.ref, { inset })
    inspectRef(entry.ref)
  },

  closeInspector() {
    pickSeq++
    get().map?.setFocus(null)
    set({ inspected: null, selection: null })
  },
}))

function inspectRef(ref: MapRef) {
  const { map } = useExplorer.getState()
  if (!map) return
  pickSeq++
  show(map.inspectRef(ref), { by: 'ref', ref })
}

function show(hit: Awaited<ReturnType<RomeMap['pick']>>, selection: Selection) {
  // The territory inspected is brought forward on the map; a settlement is not.
  const focus = hit && 'territory' in hit && hit.territory.claim ? hit.territory.polity?.id : undefined
  useExplorer.getState().map?.setFocus(focus ?? null)
  if (hit && 'place' in hit) {
    useExplorer.setState({ inspected: { kind: 'place', hit: hit.place }, selection })
  } else if (hit?.territory.claim && hit.territory.polity) {
    useExplorer.setState({
      inspected: { kind: 'territory', hit: hit.territory },
      selection,
    })
  } else {
    useExplorer.setState({ inspected: null, selection: null })
  }
}
