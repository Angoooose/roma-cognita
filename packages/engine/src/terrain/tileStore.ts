/**
 * Reads baked tiles that are either loose files or entries in a pack
 * (packages/world/src/pack.ts), for the height worker.
 *
 * Tiles above the pack level are `{base}/{level}/{i}/{j}.{ext}`. Deeper ones are
 * byte ranges of `{base}/pack/{i}/{j}.pack`: the pack's head is fetched once and kept,
 * then each tile is its own range request. A server that ignores Range answers 200 with
 * the whole file on that first fetch; since `get` always awaits the head first, that
 * whole file is cached by url and every tile after it is sliced from memory, with no
 * request of its own. A server that honours Range never fills this cache — true partial
 * reads are already cheap.
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
/** Total bytes of whole-file bodies kept across all packs; far more than one viewport needs. */
const BODY_BYTE_LIMIT = 64 << 20

export class TileStore {
  private heads = new Map<string, Promise<Map<string, PackEntry> | null>>()
  private bodies = new Map<string, Uint8Array>()
  private bodyBytes = 0
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
    const url = this.packUrl(address)
    const body = this.bodies.get(url)
    if (body) return body.subarray(entry.offset, entry.offset + entry.length)
    return range(url, entry.offset, entry.length)
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
        let res = await fetchRange(url, 0, PACK_HEAD_GUESS)
        if (!res || res.bytes.length < 8) return null
        if (res.whole) this.cacheBody(url, res.bytes)
        const need = packHeadLength(res.bytes)
        if (need === null) return null
        if (need > res.bytes.length) {
          res = await fetchRange(url, 0, need)
          if (!res) return null
          if (res.whole) this.cacheBody(url, res.bytes)
        }
        return res.bytes.length >= need ? readPackHead(res.bytes) : null
      })().catch(() => null)
      if (this.heads.size >= HEAD_LIMIT) this.heads.delete(this.heads.keys().next().value!)
    }
    this.heads.set(url, h)
    return h
  }

  private cacheBody(url: string, bytes: Uint8Array) {
    if (this.bodies.has(url)) return
    while (this.bodyBytes + bytes.length > BODY_BYTE_LIMIT && this.bodies.size > 0) {
      const oldest = this.bodies.keys().next().value!
      this.bodyBytes -= this.bodies.get(oldest)!.length
      this.bodies.delete(oldest)
    }
    this.bodies.set(url, bytes)
    this.bodyBytes += bytes.length
  }
}

interface RangeResult {
  bytes: Uint8Array
  /** True when the server ignored Range and sent the whole file (status wasn't 206). */
  whole: boolean
}

async function fetchRange(
  url: string,
  offset: number,
  length: number,
): Promise<RangeResult | null> {
  const res = await fetch(url, {
    headers: { Range: `bytes=${offset}-${offset + length - 1}` },
  })
  if (!res.ok) return null
  const bytes = new Uint8Array(await res.arrayBuffer())
  return { bytes, whole: res.status !== 206 }
}

/** `length` bytes from `offset`, or fewer at the end of the file; null if missing. */
async function range(
  url: string,
  offset: number,
  length: number,
): Promise<Uint8Array | null> {
  const res = await fetchRange(url, offset, length)
  if (!res) return null
  // 206 is the range itself; otherwise the server sent the whole file.
  return res.whole ? res.bytes.subarray(offset, offset + length) : res.bytes
}
