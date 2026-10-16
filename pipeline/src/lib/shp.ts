/**
 * A minimal random-access shapefile reader for the derivations: it uses the .shx
 * index and each record's bounding box to parse only the records that touch a
 * lon/lat box. The shapefile package reads a whole file front to back, which for
 * OSM land polygons (1.3 GB) or HydroLAKES (1.1 GB) is minutes per region; this
 * reads a region's records in a second or two.
 *
 * Only what the derivations need: Polygon (5) and PolyLine (3) shapes, and
 * numeric/character DBF fields by name.
 */
import { closeSync, openSync, readFileSync, readSync } from 'node:fs'
import type { Bbox } from './dem.ts'

export interface ShpRecord {
  /** 0-based record number, which is also the DBF row. */
  index: number
  /** Rings (polygons) or parts (lines), as [lon, lat] positions. */
  parts: [number, number][][]
}

function intersects(a: Bbox, xmin: number, ymin: number, xmax: number, ymax: number) {
  return xmax >= a.west && xmin <= a.east && ymax >= a.south && ymin <= a.north
}

/** Every Polygon/PolyLine record whose bounding box touches `bbox`. */
export function readShp(path: string, bbox: Bbox): ShpRecord[] {
  const shx = readFileSync(path.replace(/\.shp$/, '.shx'))
  const count = (shx.length - 100) / 8
  const fd = openSync(path, 'r')
  const head = Buffer.alloc(44)
  const out: ShpRecord[] = []
  try {
    for (let i = 0; i < count; i++) {
      const offset = shx.readInt32BE(100 + i * 8) * 2
      const length = shx.readInt32BE(100 + i * 8 + 4) * 2
      if (length < 36) continue // null shape
      readSync(fd, head, 0, 44, offset)
      const type = head.readInt32LE(8)
      if (type !== 3 && type !== 5) continue
      const [xmin, ymin, xmax, ymax] = [12, 20, 28, 36].map((o) => head.readDoubleLE(o))
      if (!intersects(bbox, xmin, ymin, xmax, ymax)) continue
      const body = Buffer.alloc(length)
      readSync(fd, body, 0, length, offset + 8)
      const numParts = body.readInt32LE(36)
      const numPoints = body.readInt32LE(40)
      const starts: number[] = []
      for (let p = 0; p < numParts; p++) starts.push(body.readInt32LE(44 + p * 4))
      starts.push(numPoints)
      const base = 44 + numParts * 4
      const parts: [number, number][][] = []
      for (let p = 0; p < numParts; p++) {
        const part: [number, number][] = []
        for (let k = starts[p]; k < starts[p + 1]; k++) {
          part.push([body.readDoubleLE(base + k * 16), body.readDoubleLE(base + k * 16 + 8)])
        }
        parts.push(part)
      }
      out.push({ index: i, parts })
    }
  } finally {
    closeSync(fd)
  }
  return out
}

/** Reads the named DBF fields for the given rows. Numbers come back as numbers. */
export function readDbf(
  path: string,
  rows: number[],
  fields: string[],
): Map<number, Record<string, number | string>> {
  const fd = openSync(path, 'r')
  const out = new Map<number, Record<string, number | string>>()
  try {
    const h = Buffer.alloc(32)
    readSync(fd, h, 0, 32, 0)
    const headerLen = h.readUInt16LE(8)
    const recordLen = h.readUInt16LE(10)
    const desc = Buffer.alloc(headerLen)
    readSync(fd, desc, 0, headerLen, 0)
    const layout = new Map<string, { at: number; len: number; type: string }>()
    let at = 1 // deletion flag
    for (let o = 32; o + 32 <= headerLen && desc[o] !== 0x0d; o += 32) {
      const name = desc.subarray(o, o + 11).toString('latin1').replace(/\0.*$/, '')
      const type = String.fromCharCode(desc[o + 11])
      const len = desc[o + 16]
      layout.set(name, { at, len, type })
      at += len
    }
    for (const f of fields) if (!layout.has(f)) throw new Error(`${path}: no field ${f}`)
    const rec = Buffer.alloc(recordLen)
    for (const row of rows) {
      readSync(fd, rec, 0, recordLen, headerLen + row * recordLen)
      const r: Record<string, number | string> = {}
      for (const f of fields) {
        const { at, len, type } = layout.get(f)!
        const s = rec.subarray(at, at + len).toString('latin1').trim()
        r[f] = type === 'N' || type === 'F' ? Number(s) : s
      }
      out.set(row, r)
    }
  } finally {
    closeSync(fd)
  }
  return out
}
