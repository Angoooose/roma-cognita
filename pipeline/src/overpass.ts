/**
 * OpenStreetMap through the Overpass API, for the fetchers that name their elements
 * in their records' locators (rome/fetch.ts, rivers/fetch.ts).
 */
import { userAgent } from './agent.ts'

const OVERPASS = 'https://overpass-api.de/api/interpreter'

export interface Element {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
  geometry?: { lat: number; lon: number }[]
  members?: {
    type: 'node' | 'way' | 'relation'
    role: string
    geometry?: { lat: number; lon: number }[]
  }[]
}

/** The public server turns queries away when it is busy; it asks callers to back off. */
export async function overpass(
  q: string,
  agent: string,
  tries = 5,
): Promise<{ elements: Element[] }> {
  for (let i = 1; ; i++) {
    const res = await fetch(OVERPASS, {
      method: 'POST',
      headers: { 'User-Agent': userAgent(agent) },
      body: new URLSearchParams({ data: q }),
    })
    const body = await res.text()
    if (res.ok && body.startsWith('{')) return JSON.parse(body)
    if (i === tries) throw new Error(`Overpass: ${res.status} ${body.slice(0, 400)}`)
    console.log(`Overpass busy (${res.status}), retrying in ${10 * i} s`)
    await new Promise((r) => setTimeout(r, 10_000 * i))
  }
}
