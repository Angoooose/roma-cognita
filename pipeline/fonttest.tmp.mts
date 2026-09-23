import sharp from 'sharp'
import { readFileSync } from 'node:fs'
const [name, text] = [process.argv[2], process.argv[3]]
const meta = JSON.parse(readFileSync(`build/fonts/${name}.json`, 'utf8'))
const { data, info } = await sharp(`build/fonts/${name}.png`).raw().toBuffer({ resolveWithObject: true })
const S = 3 // output px per atlas px
const chars = new Map(meta.chars.map((c: any) => [c.id, c]))
let pen = 10
const H = meta.common.lineHeight * S + 20
const W = 3000
const out = Buffer.alloc(W * H, 255)
for (const ch of text) {
  const c: any = chars.get(ch.codePointAt(0)!)
  if (!c) { pen += 20 * S; continue }
  for (let y = 0; y < c.height * S; y++) for (let x = 0; x < c.width * S; x++) {
    const ax = c.x + x / S, ay = c.y + y / S
    const x0 = Math.floor(ax - 0.5), y0 = Math.floor(ay - 0.5), tx = ax - 0.5 - x0, ty = ay - 0.5 - y0
    const px = (xx: number, yy: number, k: number) => data[((Math.min(info.height-1,Math.max(0,yy))) * info.width + Math.min(info.width-1,Math.max(0,xx))) * info.channels + k]
    const s = [0, 1, 2].map((k) => (px(x0, y0, k) * (1 - tx) + px(x0 + 1, y0, k) * tx) * (1 - ty) + (px(x0, y0 + 1, k) * (1 - tx) + px(x0 + 1, y0 + 1, k) * tx) * ty)
    const med = Math.max(Math.min(s[0], s[1]), Math.min(Math.max(s[0], s[1]), s[2])) / 255
    const v = Math.min(1, Math.max(0, (med - 0.5) * meta.distanceField.distanceRange * S + 0.5))
    const X = Math.round(pen + (c.xoffset * S) + x), Y = 10 + c.yoffset * S + y
    if (X < W && Y < H) out[Y * W + X] = Math.min(out[Y * W + X], Math.round(255 * (1 - v)))
  }
  pen += c.xadvance * S
}
await sharp(out, { raw: { width: W, height: H, channels: 1 } }).extract({ left: 0, top: 0, width: Math.min(W, Math.ceil(pen) + 20), height: H }).png().toFile(process.argv[4])
