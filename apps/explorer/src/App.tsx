import { useEffect } from 'react'
import { DebugOverlay } from '@/components/DebugOverlay.tsx'
import { Inspector } from '@/components/Inspector.tsx'
import { MapView } from '@/components/MapView.tsx'
import { PersonPanel } from '@/components/PersonPanel.tsx'
import { Search } from '@/components/Search.tsx'
import { Timeline } from '@/components/Timeline.tsx'
import { readParams } from '@/lib/params.ts'
import { dismissSplash } from '@/lib/splash.ts'
import { usePeople } from '@/peopleStore.ts'
import { useExplorer } from '@/store.ts'

const params = readParams()

export function App() {
  const ready = useExplorer((s) => s.map !== null)
  const loadPeople = usePeople((s) => s.load)
  // The people are not needed for the first frame: fetch them once the map is up.
  useEffect(() => {
    if (ready && !params.bare) loadPeople()
  }, [ready, loadPeople])
  useEffect(() => {
    if (ready) dismissSplash()
  }, [ready])
  return (
    <>
      <MapView camera={params.camera} forceWebGL={params.forceWebGL} year={params.year} />
      {ready && !params.bare && (
        <>
          {/* The left column: the title block, with the index and the legend, and beneath
              it, apart, whoever has been opened. */}
          <div className="pointer-events-none fixed top-4 bottom-4 left-4 z-10 flex flex-col items-start gap-3">
            <Search />
            <PersonPanel />
          </div>
          <Inspector />
          <Timeline />
        </>
      )}
      {ready && params.debug && <DebugOverlay />}
    </>
  )
}
