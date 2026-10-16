import { Check, Copy, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'

export type Mode = 'light' | 'dark'
type Overrides = Record<string, string>

/** Colour tokens worth tuning by eye. Each mode keeps its own overrides. */
const COLOURS: { token: string; label: string }[] = [
  { token: '--background', label: 'Background' },
  { token: '--card', label: 'Card' },
  { token: '--popover', label: 'Popover' },
  { token: '--foreground', label: 'Ink' },
  { token: '--muted-foreground', label: 'Muted ink' },
  { token: '--primary', label: 'Primary' },
  { token: '--primary-foreground', label: 'On primary' },
  { token: '--accent', label: 'Hover' },
  { token: '--gold', label: 'Gold' },
  { token: '--destructive', label: 'Destructive' },
]

/** Numeric tokens, with how to write them back. */
const RANGES = [
  { token: '--radius', label: 'Corner radius', min: 0, max: 12, step: 0.5, unit: 'px' },
  {
    token: '--grain-opacity',
    label: 'Paper grain',
    min: 0,
    max: 0.2,
    step: 0.005,
    unit: '',
  },
  {
    token: '--tracking-caps',
    label: 'Capital tracking',
    min: 0,
    max: 0.3,
    step: 0.01,
    unit: 'em',
  },
] as const

const STORE = 'playground-overrides'

function load(): Record<Mode, Overrides> {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? '')
    if (v?.light && v?.dark) return v
  } catch {}
  return { light: {}, dark: {} }
}

function save(v: Record<Mode, Overrides>) {
  try {
    localStorage.setItem(STORE, JSON.stringify(v))
  } catch {}
}

/** The value the stylesheet gives `token` in the current mode, as a hex or number. */
function computed(token: string) {
  const root = document.documentElement
  const inline = root.style.getPropertyValue(token)
  root.style.removeProperty(token)
  const v = getComputedStyle(root).getPropertyValue(token).trim()
  if (inline) root.style.setProperty(token, inline)
  return v
}

function toPx(v: string) {
  return v.endsWith('rem') ? parseFloat(v) * 16 : parseFloat(v)
}

/**
 * Live token editor. Overrides go on <html> as inline custom properties, so every
 * component (and every portal) picks them up; "Copy CSS" gives the block to paste
 * into index.css.
 */
export function Tuner({ mode }: { mode: Mode }) {
  const [all, setAll] = useState(load)
  const [copied, setCopied] = useState(false)
  // Re-read the stylesheet's defaults whenever the mode flips.
  const [defaults, setDefaults] = useState<Overrides>({})
  const overrides = all[mode]

  useEffect(() => {
    const root = document.documentElement
    for (const t of [...COLOURS.map((c) => c.token), ...RANGES.map((r) => r.token)])
      root.style.removeProperty(t)
    const d: Overrides = {}
    for (const { token } of COLOURS) d[token] = computed(token)
    for (const { token } of RANGES) d[token] = computed(token)
    setDefaults(d)
    for (const [t, v] of Object.entries(all[mode])) root.style.setProperty(t, v)
    save(all)
  }, [all, mode])

  const set = (token: string, value: string) =>
    setAll((a) => ({ ...a, [mode]: { ...a[mode], [token]: value } }))

  const reset = () => setAll((a) => ({ ...a, [mode]: {} }))

  const copy = async () => {
    const block = (m: Mode) => {
      const entries = Object.entries(all[m])
      if (!entries.length) return ''
      return `${m === 'light' ? ':root' : '.dark'} {\n${entries.map(([t, v]) => `  ${t}: ${v};`).join('\n')}\n}\n`
    }
    const css = block('light') + block('dark') || '/* No overrides yet */'
    await navigator.clipboard.writeText(css)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  const count = Object.keys(overrides).length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {COLOURS.map(({ token, label }) => {
          const value = overrides[token] ?? defaults[token] ?? '#000000'
          const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'
          return (
            <label key={token} className="group flex cursor-pointer items-center gap-2">
              <span className="relative size-6 shrink-0 overflow-hidden rounded-sm border border-rule">
                <span className="absolute inset-0" style={{ background: value }} />
                <input
                  type="color"
                  value={hex}
                  onChange={(e) => set(token, e.target.value)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-sm">
                  {label}
                  {overrides[token] && <span className="text-gold"> •</span>}
                </span>
                <span className="block font-mono text-[10px] text-muted-foreground uppercase">
                  {value}
                </span>
              </span>
            </label>
          )
        })}
      </div>
      <Separator />
      <div className="space-y-4">
        {RANGES.map((r) => {
          const raw = overrides[r.token] ?? defaults[r.token] ?? '0'
          const n = r.unit === 'px' ? toPx(raw) : parseFloat(raw)
          return (
            <div key={r.token} className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label className="caps text-[0.6875rem] text-muted-foreground">
                  {r.label}
                </Label>
                <span className="figures text-xs text-muted-foreground">
                  {+n.toFixed(3)}
                  {r.unit}
                </span>
              </div>
              <Slider
                min={r.min}
                max={r.max}
                step={r.step}
                value={[n]}
                onValueChange={([v]) => set(r.token, `${v}${r.unit}`)}
              />
            </div>
          )
        })}
      </div>
      <Separator />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={copy}>
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied' : 'Copy CSS'}
        </Button>
        <Button size="sm" variant="ghost" onClick={reset} disabled={!count}>
          <RotateCcw />
          Reset {mode === 'light' ? 'parchment' : 'ink'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground italic">
        {count ? `${count} override${count > 1 ? 's' : ''} in this mode. ` : ''}Saved in
        this browser; paste the copied block into{' '}
        <code className="not-italic">index.css</code> to keep it.
      </p>
    </div>
  )
}
