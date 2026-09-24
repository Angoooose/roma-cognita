import { Info } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Fleuron, Section } from '@/components/Marks.tsx'
import { ScrollArea } from '@/components/ui/scroll-area'

/**
 * The title block's last row, and the plate it opens, as an atlas opens with its
 * preface: what the map is, how to read it, what it will and will not claim (DESIGN.md
 * §1), and whose work it is drawn from (§6, PEOPLE.md §2). Unlike the legend it is a
 * dialog: it is read on its own, not beside the map.
 */
export function Preface({ years }: { years: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center gap-2 rounded-md px-3 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60 [&_svg]:size-4"
        >
          <Info className="text-muted-foreground transition-colors group-hover:text-primary" />
          <span className="transition-colors group-hover:text-primary">Preface</span>
        </button>
      </DialogTrigger>
      <DialogContent className="paper flex max-h-[min(720px,calc(100vh-4rem))] flex-col gap-0 p-0 sm:max-w-xl">
        <header className="px-8 pt-7 pb-5 text-center">
          <div className="caps mb-2 text-xs text-muted-foreground">Preface</div>
          <DialogTitle className="font-heading text-2xl leading-tight font-semibold tracking-[0.16em]">
            Orbis Romanus
          </DialogTitle>
          <DialogDescription className="figures mt-1 text-base text-muted-foreground italic">
            the Roman world, {years}
          </DialogDescription>
          <Fleuron className="mx-auto mt-5 w-40" />
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-6 px-8 pb-8 text-[0.9375rem] leading-relaxed">
            <p className="text-base">
              An atlas of the last years of the Roman Republic, drawn year by year: Rome,
              its provinces and client kingdoms, the powers beyond them, the towns and the
              dated roads, and the men who governed them.
            </p>

            <Section title="Reading the map">
              <ul className="space-y-1.5">
                <Item>
                  The <em>timeline</em>, bottom right, moves the map through the years.
                </Item>
                <Item>
                  Click a province, kingdom or town to open it on the right: who held it,
                  who governed it, and on what evidence.
                </Item>
                <Item>
                  The <em>index of names</em> (⌘K) finds a place, a people or a person, and
                  goes there.
                </Item>
                <Item>
                  A person opens on the left: their career over the same ruler as the
                  timeline, their family, and their sources.
                </Item>
              </ul>
            </Section>

            <Section title="What it claims">
              <p>
                Nothing is drawn that the evidence does not support. A frontier the sources
                leave vague is drawn soft, without a line; a claim in doubt is drawn
                fainter; a kingdom whose extent nobody knows is marked by its seat, not a
                guessed outline. Everything is dated, so nothing appears before its time: a
                road is drawn only from the year it was built. The silence of the sources is
                not evidence.
              </p>
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
                <Source href="https://awmc.unc.edu" licence="ODbL">
                  Ancient World Mapping Center, <em>regions and rivers</em>
                </Source>
                <Source href="https://www.wikidata.org" licence="CC0">
                  Wikidata, <em>English names</em>
                </Source>
                <Source href="https://www.hydrosheds.org" licence="CC BY 4.0">
                  HydroLAKES, <em>lakes</em>
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
                <Source href="https://mapterhorn.com">
                  Mapterhorn, <em>terrain</em>
                </Source>
                <Source href="https://www.naturalearthdata.com" licence="Public domain">
                  Natural Earth, <em>land</em>
                </Source>
              </ul>
              <p className="mt-3 text-sm text-muted-foreground">
                The territories are our own outlines, drawn from the frontiers the cited
                scholarship names. The Barrington Atlas and Broughton’s{' '}
                <em>Magistrates of the Roman Republic</em> are cited, never copied.
              </p>
            </Section>

            <p className="border-t border-rule/70 pt-4 text-center text-sm text-muted-foreground italic">
              A non-commercial project. Our own data is released under CC BY-SA 4.0.
            </p>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

/** A point in a list, marked with the seat's diamond. */
function Item({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-[0.6em] size-1.5 shrink-0 rotate-45 bg-gold" aria-hidden />
      <span>{children}</span>
    </li>
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
