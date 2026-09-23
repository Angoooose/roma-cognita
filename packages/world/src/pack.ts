/**
 * Tile packs: many small baked tiles in one file, read with HTTP range requests.
 *
 * The deep levels of the coast mask and the depth pyramid are hundreds of thousands of
 * tiles, and a static host counts files (Cloudflare Pages allows 20k, at most 25 MiB
 * each). So every tile at or below PACK_LEVEL goes into the pack of its PACK_LEVEL
 * ancestor: one file per region, holding that tile and all its written descendants.
 * Levels above PACK_LEVEL stay loose files — there are few of them, and the overview
 * needs them first.
 *
 * Layout, little-endian:
 *
 *   'RMPK'  u32 entry count
 *   entries: u8 level, u8 0, u16 0, u32 i, u32 j, u32 offset, u32 length   (20 bytes)
 *   tile bytes, in entry order; offsets are from the start of the file
 *
 * A reader fetches the head (HEAD_GUESS bytes covers any pack this repo writes), then
 * each tile by its own range. A tile not in the pack was not written: the builder
 * decided it adds nothing to its ancestor.
 */
import type { TileAddress } from './frame.ts'

/** Level whose tiles each own a pack. Level 6 is 2,420 shore regions of ~110 km. */
export const PACK_LEVEL = 6

const MAGIC = 0x4b504d52 // 'RMPK'
const ENTRY_BYTES = 20

/** Enough for the header of a level-6 pack with every descendant to level 10 (341 entries). */
export const PACK_HEAD_GUESS = 8 + 341 * ENTRY_BYTES

export interface PackEntry extends TileAddress {
  offset: number
  length: number
}

/** The pack a tile at or below PACK_LEVEL lives in. */
export function packOf({ level, i, j }: TileAddress): { i: number; j: number } {
  const shift = level - PACK_LEVEL
  return { i: i >> shift, j: j >> shift }
}

export function packKey({ level, i, j }: TileAddress) {
  return `${level}/${i}/${j}`
}

/** Assembles a pack from its tiles. */
export function writePack(
  tiles: { address: TileAddress; bytes: Uint8Array }[],
): Uint8Array {
  const head = 8 + tiles.length * ENTRY_BYTES
  const total = head + tiles.reduce((s, t) => s + t.bytes.length, 0)
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, MAGIC, true)
  view.setUint32(4, tiles.length, true)
  let offset = head
  tiles.forEach(({ address, bytes }, k) => {
    const e = 8 + k * ENTRY_BYTES
    view.setUint8(e, address.level)
    view.setUint32(e + 4, address.i, true)
    view.setUint32(e + 8, address.j, true)
    view.setUint32(e + 12, offset, true)
    view.setUint32(e + 16, bytes.length, true)
    out.set(bytes, offset)
    offset += bytes.length
  })
  return out
}

/**
 * How many bytes the head needs, from its first 8; null if this is not a pack. The
 * reader uses it when a pack's head is longer than PACK_HEAD_GUESS.
 */
export function packHeadLength(first8: Uint8Array): number | null {
  const view = new DataView(first8.buffer, first8.byteOffset, 8)
  if (view.getUint32(0, true) !== MAGIC) return null
  return 8 + view.getUint32(4, true) * ENTRY_BYTES
}

/** The entries of a pack head, keyed by packKey. */
export function readPackHead(head: Uint8Array): Map<string, PackEntry> {
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const count = view.getUint32(4, true)
  const map = new Map<string, PackEntry>()
  for (let k = 0; k < count; k++) {
    const e = 8 + k * ENTRY_BYTES
    const entry = {
      level: view.getUint8(e),
      i: view.getUint32(e + 4, true),
      j: view.getUint32(e + 8, true),
      offset: view.getUint32(e + 12, true),
      length: view.getUint32(e + 16, true),
    }
    map.set(packKey(entry), entry)
  }
  return map
}
