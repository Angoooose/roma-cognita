/**
 * Reads baked tiles that are either loose files or entries in a pack
 * (packages/world/src/pack.ts), for the height worker.
 *
 * Tiles above the pack level are `{base}/{level}/{i}/{j}.{ext}`. Deeper ones are
 * byte ranges of `{base}/pack/{i}/{j}.pack`: the pack's head is fetched once and kept,
 * then each tile is its own range request. A server that ignores Range (it answers 200
 * with the whole file) still works, only slower.
 */
import {
  PACK_HEAD_GUESS,
  packHeadLength,
  packKey,
  packOf,
  readPackHead,
  type PackEntry,
  type TileAddress,
} from '@roma-cognita/world'

const HEAD_LIMIT = 256

export class TileStore {
  private heads = new Map<string, Promise<Map<string, PackEntry> | null>>()
  private base: string
  private ext: string
  private packLevel: number

  constructor(base: string, ext: string, packLevel: number) {
    this.base = base
    this.ext = ext
    this.packLevel = packLevel
  }

  /** Whether a tile at or below the pack level was written. */
  async has(address: TileAddress): Promise<boolean> {
    if (address.level < this.packLevel) return true
    const head = await this.head(address)
    return !!head?.has(packKey(address))
  }

  /** A tile's bytes, or null if it was not written or could not be read. */
  async get(address: TileAddress): Promise<Uint8Array | null> {
    const { level, i, j } = address
    if (level < this.packLevel) {
      const res = await fetch(`${this.base}/${level}/${i}/${j}.${this.ext}`)
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
    }
    const head = await this.head(address)
    const entry = head?.get(packKey(address))
    if (!entry) return null
    return range(this.packUrl(address), entry.offset, entry.length)
  }

  private packUrl(address: TileAddress) {
    const p = packOf(address)
    return `${this.base}/pack/${p.i}/${p.j}.pack`
  }

  private head(address: TileAddress) {
    const url = this.packUrl(address)
    let h = this.heads.get(url)
    if (h) {
      this.heads.delete(url)
    } else {
      h = (async () => {
        let bytes = await range(url, 0, PACK_HEAD_GUESS)
        if (!bytes || bytes.length < 8) return null
        const need = packHeadLength(bytes)
        if (need === null) return null
        if (need > bytes.length) bytes = await range(url, 0, need)
        return bytes && bytes.length >= need ? readPackHead(bytes) : null
      })().catch(() => null)
      if (this.heads.size >= HEAD_LIMIT) this.heads.delete(this.heads.keys().next().value!)
    }
    this.heads.set(url, h)
    return h
  }
}

/** `length` bytes from `offset`, or fewer at the end of the file; null if missing. */
async function range(
  url: string,
  offset: number,
  length: number,
): Promise<Uint8Array | null> {
  const res = await fetch(url, {
    headers: { Range: `bytes=${offset}-${offset + length - 1}` },
  })
  if (!res.ok) return null
  const buf = new Uint8Array(await res.arrayBuffer())
  // 206 is the range itself; 200 means the server sent the whole file.
  return res.status === 206 ? buf : buf.subarray(offset, offset + length)
}
