import { DebugOverlay } from '@/components/DebugOverlay.tsx'
import { Inspector } from '@/components/Inspector.tsx'
import { Legend } from '@/components/Legend.tsx'
import { MapView } from '@/components/MapView.tsx'
import { Search } from '@/components/Search.tsx'
import { Timeline } from '@/components/Timeline.tsx'
import { readParams } from '@/lib/params.ts'
import { useExplorer } from '@/store.ts'

const params = readParams()

export function App() {
  const ready = useExplorer((s) => s.map !== null)
  return (
    <>
      <MapView camera={params.camera} forceWebGL={params.forceWebGL} year={params.year} />
      {ready && !params.bare && (
        <>
          <Inspector />
          <Legend />
          <Search />
          <Timeline />
        </>
      )}
      {ready && params.debug && <DebugOverlay />}
    </>
  )
}
