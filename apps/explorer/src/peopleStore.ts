import type { PersonId } from '@roma-cognita/schema'
import { create } from 'zustand'
import { People } from '@/lib/people.ts'

/**
 * The people layer's state, beside the map's (store.ts): the data once loaded, and the
 * person open in the left-hand panel with the trail of people opened to reach them.
 * The person is mirrored to `?person=` so a view can be linked.
 */
interface PeopleState {
  people: People | null
  /** Set if the data failed to load, so panels can say so instead of waiting. */
  failed: string | null
  /** The person shown, and the people opened before, most recent last. */
  person: PersonId | null
  trail: PersonId[]

  load(): Promise<void>
  /**
   * Opens a person. `fromPerson` is set by links inside the person panel — a relative —
   * and keeps the way back; a name found anywhere else starts afresh.
   */
  open(id: PersonId, opts?: { fromPerson?: boolean }): void
  back(): void
  close(): void
}

let loading: Promise<void> | null = null

export const usePeople = create<PeopleState>()((set, get) => ({
  people: null,
  failed: null,
  person: readPersonParam(),
  trail: [],

  load() {
    loading ??= People.load().then(
      (people) => set({ people }),
      (err: Error) => set({ failed: err.message }),
    )
    return loading
  },

  open(id, opts) {
    const { person, trail } = get()
    if (id === person) return
    set({ person: id, trail: opts?.fromPerson && person ? [...trail, person] : [] })
    writePersonParam(id)
  },

  back() {
    const { trail } = get()
    const person = trail.at(-1) ?? null
    set({ person, trail: trail.slice(0, -1) })
    writePersonParam(person)
  },

  close() {
    set({ person: null, trail: [] })
    writePersonParam(null)
  },
}))

function readPersonParam(): PersonId | null {
  const v = new URLSearchParams(location.search).get('person')
  return v && /^(dprr:\d+|ours:[a-z0-9-]+)$/.test(v) ? (v as PersonId) : null
}

// Replaced, not pushed: the browser's back button leaves the map, as it always has.
function writePersonParam(id: PersonId | null) {
  const url = new URL(location.href)
  if (id) url.searchParams.set('person', id)
  else url.searchParams.delete('person')
  history.replaceState(history.state, '', url)
}
