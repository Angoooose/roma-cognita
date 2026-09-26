import type { PersonId, PersonRecord } from '@roma-cognita/schema'
import { createContext, type ReactNode, useContext } from 'react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { knownName, type People } from '@/lib/people.ts'
import { cn } from '@/lib/utils'
import { formatSpan, formatYear } from '@/lib/year.ts'
import { usePeople } from '@/peopleStore.ts'

/** Set inside the person panel: a name there leads on from that person, with a way back. */
export const InPersonPanel = createContext(false)

/**
 * A person's name wherever it appears. Hover for who they were; click to open them in
 * the person panel. Uncertain links are printed as the map prints doubt: fainter, with
 * a query mark.
 */
export function PersonLink({
  id,
  children,
  uncertain,
  className,
}: {
  id: PersonId
  children?: ReactNode
  uncertain?: boolean
  className?: string
}) {
  const people = usePeople((s) => s.people)
  const open = usePeople((s) => s.open)
  const fromPerson = useContext(InPersonPanel)
  const person = people?.person(id)
  if (!person) return <span className={className}>{children}</span>
  return (
    <HoverCard openDelay={350} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => open(id, { fromPerson })}
          className={cn(
            'cursor-pointer text-left underline decoration-foreground/25 decoration-dotted underline-offset-[3px] transition-colors hover:text-primary hover:decoration-primary/60',
            uncertain && 'opacity-70',
            className,
          )}
        >
          {children ?? person.name}
          {uncertain && <span className="text-muted-foreground">?</span>}
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        className="paper rule-double w-72 bg-card"
      >
        <PersonPreview person={person} people={people!} />
      </HoverCardContent>
    </HoverCard>
  )
}

function PersonPreview({ person, people }: { person: PersonRecord; people: People }) {
  return (
    <div className="space-y-1">
      <div className="font-heading text-sm leading-snug font-semibold">
        {knownName(person)}
      </div>
      <div className="text-xs text-muted-foreground italic">{person.full}</div>
      <div className="figures text-xs">
        {lifeLine(people, person)}
        {person.highestOffice && <> · {person.highestOffice}</>}
      </div>
      {person.en?.description && (
        <p className="text-xs text-pretty text-foreground/80">{person.en.description}</p>
      )}
      <div className="pt-0.5 text-xs text-muted-foreground">Click to open</div>
    </div>
  )
}

/** `106–43 BCE`, `born 106 BCE`, `attested 75–43 BCE`, or nothing where nothing dates them. */
export function lifeLine(people: People, p: PersonRecord) {
  const { born, died } = people.lifespan(p.id)
  const year = (e: { year: number; bound: string }) =>
    `${e.bound === 'before' ? 'before ' : e.bound === 'after' ? 'after ' : ''}${formatYear(e.year)}`
  if (born && died && born.bound === 'on' && died.bound === 'on') {
    return formatSpan([born.year, died.year])
  }
  if (born || died) {
    return [born && `born ${year(born)}`, died && `died ${year(died)}`]
      .filter(Boolean)
      .join(', ')
  }
  if (p.active) {
    const span = formatSpan([p.active.from, p.active.to])
    return p.active.basis === 'era' ? `c. ${span}` : `attested ${span}`
  }
  return 'undated'
}
