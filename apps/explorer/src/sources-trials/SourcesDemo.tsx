import { Moon, Sun } from 'lucide-react'
import { useEffect, useLayoutEffect, useState } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Constellation } from './Constellation.tsx'
import { Folio } from './Folio.tsx'
import { Footprints } from './Footprints.tsx'
import { Index } from './Index.tsx'
import { Ledger } from './Ledger.tsx'
import { Witnesses } from './Witnesses.tsx'

/**
 * The trials the sources page was chosen from (it became the book index and entries,
 * /sources), kept for the ideas not yet taken up. They read a snapshot of data/
 * taken once (demo-data.json), with dates of writing guessed, not researched.
 */
const VARIANTS = {
  index: { label: 'Index', note: 'the catalogue' },
  witnesses: { label: 'Witnesses', note: 'two timelines' },
  folio: { label: 'Folio', note: 'one source' },
  footprints: { label: 'Footprints', note: 'small maps' },
  constellation: { label: 'Constellation', note: 'cited together' },
  ledger: { label: 'Ledger', note: 'the evidence' },
} as const
type Variant = keyof typeof VARIANTS

/** `#folio`, or `#folio:strabo` for one source's page. */
function fromHash(): { variant: Variant; source?: string } {
  const [v, source] = location.hash.slice(1).split(':')
  return { variant: v in VARIANTS ? (v as Variant) : 'index', source }
}

/** Mockups of a sources page: one switcher, several ways of putting the sources first. */
export function SourcesDemo() {
  const [{ variant, source }, setView] = useState(fromHash)
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.body.style.overflow = 'auto'
  }, [dark])

  useEffect(() => {
    const follow = () => setView(fromHash())
    addEventListener('hashchange', follow)
    return () => removeEventListener('hashchange', follow)
  }, [])

  const go = (v: Variant, id?: string) => {
    location.hash = id ? `${v}:${id}` : v
    scrollTo(0, 0)
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-rule bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-4 px-6 py-3">
          <div className="mr-auto leading-none">
            <a
              href="/sources"
              className="font-heading text-lg font-semibold tracking-[0.14em]"
            >
              Sources
            </a>
            <div className="text-xs text-muted-foreground italic">
              trials, before the index of sources
            </div>
          </div>
          <nav className="flex flex-wrap gap-1">
            {(Object.keys(VARIANTS) as Variant[]).map((v) => (
              <button
                key={v}
                onClick={() => go(v)}
                className={`rounded-md px-3 py-1.5 text-left leading-tight transition-colors ${
                  v === variant
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                <div className="font-heading text-[0.8rem] tracking-[0.06em]">
                  {VARIANTS[v].label}
                </div>
                <div className="text-[0.7rem] italic">{VARIANTS[v].note}</div>
              </button>
            ))}
          </nav>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={dark ? 'dark' : 'light'}
            onValueChange={(v) => v && setDark(v === 'dark')}
            aria-label="Mode"
          >
            <ToggleGroupItem value="light" aria-label="Parchment">
              <Sun />
            </ToggleGroupItem>
            <ToggleGroupItem value="dark" aria-label="Ink and gold">
              <Moon />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-6 py-8">
        {variant === 'index' && <Index />}
        {variant === 'witnesses' && <Witnesses />}
        {variant === 'folio' && <Folio key={source} initial={source} />}
        {variant === 'footprints' && <Footprints />}
        {variant === 'constellation' && <Constellation />}
        {variant === 'ledger' && <Ledger />}
      </main>
    </div>
  )
}
