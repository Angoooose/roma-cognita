/**
 * Finding a baked coast-mask tile on disk, for the builds that read the mask (politics,
 * labels). Tiles above PACK_LEVEL are loose `{level}/{i}/{j}.webp` files; the rest are
 * entries in the pack of their PACK_LEVEL ancestor (packages/world/src/pack.ts).
 */
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs'
import { join } from 'node:path'
import {
  PACK_LEVEL,
  packHeadLength,
  packKey,
  packOf,
  readPackHead,
  type PackEntry,
  type TileAddress,
} from '@roma-cognita/world'

/** Where a tile's encoded bytes are: a whole file, or a byte range of a pack. */
export interface TileSource {
  file: string
  offset?: number
  length?: number
}

/** Looks tiles up under `dir`, reading each pack's head once. */
export function coastTiles(dir: string) {
  const heads = new Map<string, Map<string, PackEntry> | null>()

  function head(file: string) {
    if (heads.has(file)) return heads.get(file)!
    let entries: Map<string, PackEntry> | null = null
    if (existsSync(file)) {
      const fd = openSync(file, 'r')
      try {
        const first = Buffer.alloc(8)
        readSync(fd, first, 0, 8, 0)
        const length = packHeadLength(first)
        if (length === null) throw new Error(`${file} is not a tile pack`)
        const bytes = Buffer.alloc(length)
        readSync(fd, bytes, 0, length, 0)
        entries = readPackHead(bytes)
      } finally {
        closeSync(fd)
      }
    }
    heads.set(file, entries)
    return entries
  }

  /** The tile's source, or null where none was written. */
  return function find(address: TileAddress): TileSource | null {
    if (address.level < PACK_LEVEL) {
      const file = join(dir, `${packKey(address)}.webp`)
      return existsSync(file) ? { file } : null
    }
    const p = packOf(address)
    const file = join(dir, `pack/${p.i}/${p.j}.pack`)
    const entry = head(file)?.get(packKey(address))
    return entry ? { file, offset: entry.offset, length: entry.length } : null
  }
}

/** A tile's encoded bytes. */
export function readTile(source: TileSource): Buffer {
  if (source.offset === undefined) return readFileSync(source.file)
  const fd = openSync(source.file, 'r')
  try {
    const bytes = Buffer.alloc(source.length!)
    readSync(fd, bytes, 0, source.length!, source.offset)
    return bytes
  } finally {
    closeSync(fd)
  }
}
