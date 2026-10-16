import type { RomeMap } from '@roma-cognita/engine'
import { formatYear } from '@/lib/year.ts'

/**
 * How much coarser than its own detail the terrain may be when the frontispiece goes:
 * one level, every tile at worst magnified twice. That reads as the finished map and
 * comes in about half the time of full detail, which sharpens in moments after.
 */
const LAG_LEVELS = 1
/** Longest the frontispiece waits on the terrain, so a stalled tile never strands it. */
const MAX_WAIT_MS = 15000
/**
 * The ruler's engraving, by stage: the bundle having run, the data the first frame
 * needs arriving, then the terrain covering the view.
 */
const BUNDLE = 0.1
const DATA = 0.6
const TERRAIN = 0.3
/** How far the engraving may drift past what has loaded, so a long wait never stands still. */
const DRIFT = 0.06
const DRIFT_PER_S = 0.015
/** How quickly the engraving closes on where it should be, per second; quicker once loaded. */
const EASE = 3
const EASE_DONE = 12
/** How long the index and year are shown on the finished ruler before the map. */
const HOLD_MS = 650

const splash = document.getElementById('splash')
const ruler = splash?.querySelector<HTMLElement>('.ruler')
const scale = ruler?.querySelector<SVGElement>('.scale')
const yearText = splash?.querySelector<HTMLElement>('.year')
const still = matchMedia('(prefers-reduced-motion: reduce)').matches

let loaded = 0
let map: RomeMap | null = null
let finished = false
let arrived = false
let drawn = 0
let reached = BUNDLE
let reachedAt = performance.now()
let frameAt = performance.now()
const started = performance.now()

/**
 * Starts engraving the frontispiece's ruler (index.html, splash.css) as the map loads,
 * and sets the index, unseen till then, on `year`, astronomical: the one the map opens at.
 */
export function startSplash(year: number) {
  if (!ruler || !yearText) return
  const first = 1 - Number(ruler.dataset.first)
  const last = 1 - Number(ruler.dataset.last)
  const at = (Math.min(last, Math.max(first, year)) - first) / (last - first)
  ruler.style.setProperty('--at', String(at))
  yearText.textContent = formatYear(year)
  requestAnimationFrame(frame)
  // Where animation frames never run, as in a background tab.
  setTimeout(finish, MAX_WAIT_MS)
}

/** The share of the data the first frame needs that has loaded (RomeMapOptions.onProgress). */
export function splashProgress(share: number) {
  loaded = share
}

/**
 * Hands the frontispiece the map, once it exists. It goes once the first view has
 * drawn: every tile in it loaded at near its own detail, so the reader never sees bare
 * sea while the terrain comes in.
 */
export function dismissSplash(m: RomeMap) {
  map = m
}

function frame(now: number) {
  if (!scale || !splash?.isConnected) return
  const dt = Math.min(0.1, (now - frameAt) / 1000)
  frameAt = now
  if (!finished && (map?.drawnWithin(LAG_LEVELS) || now - started > MAX_WAIT_MS)) finish()

  const progress = BUNDLE + DATA * loaded + TERRAIN * (map?.coverage(LAG_LEVELS) ?? 0)
  if (progress > reached) {
    reached = progress
    reachedAt = now
  }
  const drift = Math.min(DRIFT, ((now - reachedAt) / 1000) * DRIFT_PER_S)
  const goal = finished ? 1 : Math.min(0.97, reached + drift)
  drawn += (goal - drawn) * (still ? 1 : 1 - Math.exp(-(finished ? EASE_DONE : EASE) * dt))
  if (goal - drawn < 0.002) drawn = goal
  scale.style.setProperty('--drawn', String(drawn))
  if (drawn === 1) arrive()
  else requestAnimationFrame(frame)
}

/** Loaded: the engraving runs to the ruler's end, then the index is set down. */
function finish() {
  if (finished) return
  finished = true
  // Where animation frames never run, the engraving never ends on its own.
  setTimeout(arrive, 600)
}

/** The index and the year are set on the finished ruler, then the frontispiece fades. */
function arrive() {
  if (!splash || arrived) return
  arrived = true
  scale?.style.setProperty('--drawn', '1')
  splash.classList.add('fonts', 'arrived')
  setTimeout(() => {
    splash.classList.add('gone')
    splash.addEventListener('transitionend', () => splash.remove(), { once: true })
    // Where transitions never run, as in a background tab.
    setTimeout(() => splash.remove(), 1000)
  }, HOLD_MS)
}
