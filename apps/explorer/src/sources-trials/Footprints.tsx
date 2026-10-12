import { useState } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { DATA, type Kind, short, title } from './data.ts'
import { Footprint, Intro, kindColor, Spark } from './shared.tsx'

/**
 * Small multiples: each source's share of the known world, side by side, so the east
 * reads as Strabo's and Josephus', Gaul as Caesar's, Africa as Sallust's and Bridoux's.
 */
export function Footprints() {
  const [kind, setKind] = useState<Kind>('ancient')
  const total = Object.keys(DATA.atoms).length
  const rows = DATA.sources
    .filter((s) => s.kind === kind && s.atoms.length > 0 && s.atoms.length < total * 0.9)
    .sort((a, b) => b.atoms.length - a.atoms.length)
    .slice(0, 16)
  return (
    <div>
      <Intro title="Where each source speaks">
        The map seen through one source at a time. Each sheet inks the ground whose holder
        or outline that work is cited for. Datasets that cover everything, like the
        coastline, are left out.
      </Intro>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        className="mb-5"
        value={kind}
        onValueChange={(v) => v && setKind(v as Kind)}
      >
        <ToggleGroupItem value="ancient">Ancient texts</ToggleGroupItem>
        <ToggleGroupItem value="modern">Modern scholarship</ToggleGroupItem>
      </ToggleGroup>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {rows.map((s) => (
          <figure key={s.id} className="paper rule-double rounded-lg bg-card p-3">
            <Footprint atoms={new Set(s.atoms)} color={kindColor(s.kind)} />
            <figcaption className="mt-2 flex items-end justify-between gap-2 border-t border-rule pt-2">
              <div className="min-w-0">
                <div className="truncate font-heading text-sm tracking-[0.06em]">
                  {s.kind === 'ancient' ? s.author : short(s)}
                </div>
                <div className="truncate text-xs text-muted-foreground italic">
                  {s.kind === 'ancient' ? title(s) : `${s.records} records`}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <Spark
                  values={s.coverage}
                  width={64}
                  height={14}
                  color={kindColor(s.kind)}
                />
                <div className="figures mt-0.5 text-[11px] text-muted-foreground">
                  {s.atoms.length} of {total} grounds
                </div>
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  )
}
