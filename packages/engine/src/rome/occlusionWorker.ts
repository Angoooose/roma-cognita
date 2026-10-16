import { type GridFrame, shadeGrid } from './occlusionGrid.ts'

/**
 * Builds the model of Rome's shading grid for a year off the main thread (ModelLayer
 * `Occlusion`), so moving the timeline does not stall the map while it is made. Sent
 * the tops and the grid's frame once, then a year at a time.
 */
export type OcclusionJob =
  { tops: Float32Array; frame: GridFrame } | { id: number; year: number }
export interface OcclusionResult {
  id: number
  year: number
  raw: Float32Array
  data: Uint8Array
}

let tops: Float32Array | null = null
let frame: GridFrame | null = null

self.onmessage = (e: MessageEvent<OcclusionJob>) => {
  const job = e.data
  if ('tops' in job) {
    tops = job.tops
    frame = job.frame
    return
  }
  const { raw, data } = shadeGrid(tops!, frame!, job.year)
  const out: OcclusionResult = { id: job.id, year: job.year, raw, data }
  ;(self as unknown as Worker).postMessage(out, [raw.buffer, data.buffer])
}
