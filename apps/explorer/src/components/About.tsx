import { Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Fleuron, Section } from '@/components/Marks.tsx'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const REPOSITORY = 'https://github.com/Angoooose/roma-cognita'

/**
 * The title block's last row, and the plate it opens: what the map is, where it
 * stands, how far to trust it (DESIGN.md §1, §7.7), and whose work it is drawn from (§6; data/README.md, "People"). Unlike the legend it is a dialog: it
 * is read on its own, not beside the map.
 */
export function About({ years }: { years: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center gap-2 rounded-md px-3 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60 [&_svg]:size-4"
        >
          <Info className="text-muted-foreground transition-colors group-hover:text-primary" />
          <span className="transition-colors group-hover:text-primary">About</span>
        </button>
      </DialogTrigger>
      <DialogContent className="paper flex max-h-[min(720px,calc(100vh-4rem))] flex-col gap-0 p-0 sm:max-w-xl">
        <header className="px-8 pt-7 pb-5 text-center">
          <div className="caps mb-2 text-xs text-muted-foreground">About</div>
          <DialogTitle className="font-heading text-2xl leading-tight font-semibold tracking-[0.16em]">
            Roma Cognita
          </DialogTitle>
          <DialogDescription className="figures mt-1 text-base text-muted-foreground italic">
            the Roman world, {years}
          </DialogDescription>
          <Fleuron className="mx-auto mt-5 w-40" />
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-6 px-8 pb-8 text-[0.9375rem] leading-relaxed">
            <p className="text-base">
              A map of the late Roman Republic, from the Gracchi in 133 BCE to Augustus’s
              settlement in 27. As you move through the years, provinces and kingdoms change
              hands, roads appear as they’re built, and each province shows who governed it.
            </p>

            <Section title="Where it stands">
              <p>
                It’s a work in progress. The provinces, client kingdoms, neighbouring
                powers, towns and roads cover the whole period. All 4,876 people in the
                Digital Prosopography of the Roman Republic are in, but the ones it doesn’t
                cover, like the client kings, aren’t yet. Zoom right into Rome and a 3D
                model of the city rises out of the ground. Some of the landscape is still
                modern, mostly river courses and a scatter of small lakes, and it’s being
                corrected bit by bit. It’s made for desktop browsers.
              </p>
            </Section>

            <Section title="How far to trust it">
              <div className="space-y-3">
                <p>
                  The map only shows what the sources support. A frontier the sources leave
                  vague is shaded without a hard line, and uncertain claims are fainter.
                  Where nobody knows how far a kingdom reached, only its capital is marked.
                  Everything has dates, so a road only shows up once it was built.
                </p>
                <p>
                  Rome is the exception. Its known buildings are placed and built from their
                  sources, and where a building’s form is unknown it’s a typical temple of
                  the period. Nobody can map the ordinary houses, tombs and farmland in
                  between, so those are generated to give a sense of the city. They’re drawn
                  plainer, and the legend marks them as illustrative.
                </p>
              </div>
            </Section>

            <Section title="Drawn from">
              <ul className="space-y-1">
                <Source href="https://romanrepublic.ac.uk" licence="CC BY-NC 4.0">
                  Digital Prosopography of the Roman Republic, <em>people</em>
                </Source>
                <Source href="https://pleiades.stoa.org" licence="CC BY 3.0">
                  Pleiades, <em>places</em>
                </Source>
                <Source href="https://itiner-e.org" licence="CC BY 4.0">
                  Itiner-e, <em>roads</em>
                </Source>
                <Source href="https://www.wikidata.org" licence="CC0">
                  Wikidata, <em>English names</em>
                </Source>
                <Source href="https://www.hydrosheds.org" licence="CC BY 4.0">
                  HydroSHEDS, <em>rivers and lakes</em>
                </Source>
                <Source href="https://osmdata.openstreetmap.de" licence="ODbL">
                  OpenStreetMap, <em>coastline</em>
                </Source>
                <Source href="https://emodnet.ec.europa.eu" licence="CC BY 4.0">
                  EMODnet, <em>the European seabed</em>
                </Source>
                <Source href="https://www.gebco.net" licence="Public domain">
                  GEBCO, <em>the seabed beyond</em>
                </Source>
                <Source href="https://mapterhorn.com" licence="Various open">
                  Mapterhorn, <em>terrain</em>
                </Source>
                <Source href="https://www.naturalearthdata.com" licence="Public domain">
                  Natural Earth, <em>land</em>
                </Source>
                <Source
                  href="https://doi.org/10.6084/m9.figshare.21789074"
                  licence="CC BY 4.0"
                >
                  Köppen–Geiger (Beck et al., 2023), <em>climate</em>
                </Source>
                <Source
                  href="https://www.archeositarproject.it/en/piattaforma/open-data/"
                  licence="CC BY-SA 4.0"
                >
                  SITAR, <em>the archaeological map of Rome</em>
                </Source>
              </ul>
              <p className="mt-3 text-sm text-muted-foreground">
                The territory outlines are original, drawn from the frontiers in the cited
                scholarship. The Barrington Atlas and Broughton’s{' '}
                <em>Magistrates of the Roman Republic</em> are cited, not copied. Every work
                the map cites, ancient and modern, is in the{' '}
                <a
                  href="/sources"
                  target="_blank"
                  rel="noopener"
                  className="text-foreground underline underline-offset-2 transition-colors hover:text-primary"
                >
                  Index of Sources
                </a>
                .
              </p>
            </Section>

            <p className="border-t border-rule/70 pt-4 text-center text-sm text-balance text-muted-foreground italic">
              Its code is released under the MIT licence, its own data under CC&nbsp;BY-SA&nbsp;4.0.
            </p>
          </div>
        </ScrollArea>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="absolute top-3.5 left-3.5" asChild>
              <a href={REPOSITORY} target="_blank" rel="noopener" aria-label="View on GitHub">
                <GitHubMark />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>View on GitHub</TooltipContent>
        </Tooltip>
      </DialogContent>
    </Dialog>
  )
}

/** GitHub's mark, drawn here since lucide carries no brand icons. */
function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.1.9 2.2v3.3c0 .3.1.7.8.6A12 12 0 0 0 12 .3" />
    </svg>
  )
}

/** A source, set as the index sets a name: the work, a dotted leader, its licence. */
function Source({
  href,
  licence,
  children,
}: {
  href: string
  licence?: string
  children: ReactNode
}) {
  return (
    <li className="flex items-baseline gap-2">
      <a
        href={href}
        target="_blank"
        rel="noopener"
        className="underline-offset-2 transition-colors hover:text-primary hover:underline"
      >
        {children}
      </a>
      {licence && (
        <>
          <span
            className="mx-0.5 min-w-4 flex-1 border-b border-dotted border-foreground/30"
            aria-hidden
          />
          <span className="caps shrink-0 text-[0.6875rem] text-muted-foreground">
            {licence}
          </span>
        </>
      )}
    </li>
  )
}
