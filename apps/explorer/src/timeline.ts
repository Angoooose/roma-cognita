import type { RomeMap } from '@roman-map/engine'

/**
 * The timeline: one quiet strip along the bottom of the map (DESIGN.md §8.3). Drag or
 * click the track, or use ← → (shift for five years), to move through the data's
 * window. Every change cross-fades on the map.
 */
export function mountTimeline(map: RomeMap, onChange: (year: number) => void) {
  const span = map.politics.window
  if (!span) return
  const [first, last] = span

  const el = document.createElement('div')
  el.className = 'timeline'
  el.innerHTML = `
    <button class="step" data-step="-1" aria-label="Previous year">‹</button>
    <div class="track" role="slider" tabindex="0" aria-label="Year"
         aria-valuemin="${first}" aria-valuemax="${last}">
      <div class="rail"></div>
      <div class="ticks"></div>
      <div class="thumb"><span class="year"></span></div>
    </div>
    <button class="step" data-step="1" aria-label="Next year">›</button>`
  document.body.appendChild(el)

  const track = el.querySelector<HTMLElement>('.track')!
  const thumb = el.querySelector<HTMLElement>('.thumb')!
  const label = el.querySelector<HTMLElement>('.year')!
  const ticks = el.querySelector<HTMLElement>('.ticks')!

  // A tick every five years, labelled every ten.
  for (let y = first; y <= last; y++) {
    const bce = 1 - y
    if (bce % 5 !== 0) continue
    const t = document.createElement('span')
    t.className = bce % 10 === 0 ? 'tick major' : 'tick'
    t.style.left = `${((y - first) / (last - first)) * 100}%`
    if (bce % 10 === 0) t.dataset.label = `${bce}`
    ticks.appendChild(t)
  }

  const show = (year: number) => {
    thumb.style.left = `${((year - first) / (last - first)) * 100}%`
    label.textContent = formatYear(year)
    track.setAttribute('aria-valuenow', `${year}`)
    track.setAttribute('aria-valuetext', formatYear(year))
  }
  const go = (year: number) => {
    year = Math.max(first, Math.min(last, Math.round(year)))
    if (year === map.year) return
    map.setYear(year, { animate: true })
    show(year)
    onChange(year)
  }
  show(map.year)

  const fromPointer = (e: PointerEvent) => {
    const r = track.getBoundingClientRect()
    return first + ((e.clientX - r.left) / r.width) * (last - first)
  }
  track.addEventListener('pointerdown', (e) => {
    track.setPointerCapture(e.pointerId)
    go(fromPointer(e))
  })
  track.addEventListener('pointermove', (e) => {
    if (track.hasPointerCapture(e.pointerId)) go(fromPointer(e))
  })
  for (const b of el.querySelectorAll<HTMLButtonElement>('.step')) {
    b.addEventListener('click', () => go(map.year + Number(b.dataset.step)))
  }
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return
    const step = e.shiftKey ? 5 : 1
    if (e.key === 'ArrowLeft') go(map.year - step)
    else if (e.key === 'ArrowRight') go(map.year + step)
    else return
    e.preventDefault()
  })
}

/** Astronomical → `63 BCE`. */
export function formatYear(y: number) {
  return y <= 0 ? `${1 - y} BCE` : `${y} CE`
}
