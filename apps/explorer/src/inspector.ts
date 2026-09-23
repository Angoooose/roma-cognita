import type { PlaceHit, PoliticalHit, RomeMap } from '@roman-map/engine'
import { formatYear } from './timeline.ts'

/**
 * The inspector: click the map, and it says who held that ground in the year shown,
 * on what footing, how sure we are, and where that comes from. Every claim on the map
 * can be traced to a source from here — the point of drawing confidence at all.
 */
export function mountInspector(map: RomeMap) {
  const el = document.createElement('aside')
  el.className = 'inspector'
  el.hidden = true
  document.body.appendChild(el)

  let last: { x: number; y: number } | null = null
  let shownAt: { x: number; y: number } | null = null

  const close = () => {
    el.hidden = true
    shownAt = null
  }

  const renderPlace = ({ place: p, status, seatOf }: PlaceHit) => {
    const what = [status ? status[0].toUpperCase() + status.slice(1) : 'Settlement']
    if (seatOf) what.push(`seat of ${seatOf.name}`)
    el.innerHTML = `
      <button class="close" aria-label="Close">×</button>
      <h2>${esc(p.name)}</h2>
      <p class="standing">${esc(what.join(', '))}</p>
      <dl>
        <dt>Confidence</dt><dd class="conf ${p.confidence}">${p.confidence}</dd>
        ${p.pleiades ? `<dt>Pleiades</dt><dd><a href="https://pleiades.stoa.org/places/${esc(p.pleiades)}" target="_blank" rel="noopener">${esc(p.pleiades)}</a></dd>` : ''}
      </dl>
      ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}
      <h3>Sources</h3>
      <ul class="sources">${p.sources
        .map(
          (s) =>
            `<li>${esc(s.citation)}${s.locator ? `, <span class="loc">${esc(s.locator)}</span>` : ''}</li>`,
        )
        .join('')}</ul>
      <p class="meta">${esc(p.id)} · ${formatYear(map.year)}${p.review !== 'verified' ? ` · ${esc(p.review)}` : ''}</p>`
    el.hidden = false
    el.querySelector('.close')!.addEventListener('click', close)
  }

  const render = (hit: PoliticalHit | null) => {
    if (!hit?.claim || !hit.polity) {
      el.hidden = true
      return
    }
    const c = hit.claim
    const overlord = hit.power && hit.power.id !== hit.polity.id ? hit.power.name : null
    el.innerHTML = `
      <button class="close" aria-label="Close">×</button>
      <h2>${esc(hit.polity.name)}</h2>
      <p class="standing">${esc(standing(c.relation, overlord))}</p>
      <dl>
        <dt>Held</dt><dd>${esc(c.from.text)} – ${esc(c.to.text)}</dd>
        <dt>Confidence</dt><dd class="conf ${c.confidence}">${c.confidence}</dd>
        ${hit.polity.ruler ? `<dt>Ruler</dt><dd>${esc(hit.polity.ruler)}</dd>` : ''}
      </dl>
      ${c.note ? `<p class="note">${esc(c.note)}</p>` : ''}
      <h3>Sources</h3>
      <ul class="sources">${hit.sources
        .map(
          (s) =>
            `<li>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.citation)}</a>` : esc(s.citation)}${
              s.locator ? `, <span class="loc">${esc(s.locator)}</span>` : ''
            }</li>`,
        )
        .join('')}</ul>
      <p class="meta">${esc(hit.atom)} · ${formatYear(map.year)}${c.review !== 'verified' ? ` · ${esc(c.review)}` : ''}</p>`
    el.hidden = false
    el.querySelector('.close')!.addEventListener('click', close)
  }

  const inspect = async (x: number, y: number) => {
    shownAt = { x, y }
    const hit = await map.pick(x, y)
    if (hit && 'place' in hit) renderPlace(hit.place)
    else render(hit?.territory ?? null)
  }

  // A click is a press and release without a drag; a drag pans the map.
  const canvas = map.renderer.domElement
  canvas.addEventListener('pointerdown', (e) => {
    last = e.button === 0 && !e.shiftKey ? { x: e.clientX, y: e.clientY } : null
  })
  canvas.addEventListener('pointerup', (e) => {
    if (!last || Math.hypot(e.clientX - last.x, e.clientY - last.y) > 4) return
    inspect(e.clientX, e.clientY)
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close()
  })

  return {
    /** Re-reads the same spot for a new year, so the panel follows the timeline. */
    refresh() {
      if (shownAt && !el.hidden) inspect(shownAt.x, shownAt.y)
    },
  }
}

function standing(relation: string, overlord: string | null) {
  const of = overlord ? ` of ${overlord}` : ''
  switch (relation) {
    case 'province':
      return `Province${of}`
    case 'citizen-territory':
      return `Citizen territory${of}`
    case 'client':
      return `Client kingdom${of}`
    case 'allied':
      return `Allied${overlord ? ` to ${overlord}` : ''}`
    case 'occupied':
      return `Occupied`
    default:
      return 'Independent'
  }
}

function esc(s: string) {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  )
}
