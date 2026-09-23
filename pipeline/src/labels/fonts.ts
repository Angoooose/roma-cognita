/**
 * Font atlases for map lettering (DESIGN.md §7.5, §8.2): multi-channel signed distance
 * fields, so one small texture draws crisp type at every size the map needs, with
 * sharp corners on Cinzel's serifs that a single-channel field would round off.
 *
 * - Cinzel: land names, in capitals.
 * - EB Garamond italic: water names.
 *
 * Both are SIL Open Font License; the licence texts ship beside the atlases. The
 * TTFs come from the google/fonts repository into .cache/sources/fonts.
 *
 *   npm run fonts -w pipeline
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error no types
import generateBMFont from 'msdf-bmfont-xml'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const CACHE = join(ROOT_DIR, '.cache/sources/fonts')
const OUT = join(ROOT_DIR, 'build/fonts')

const FONTS = [
  {
    name: 'cinzel',
    file: 'Cinzel.ttf',
    licence: 'OFL-cinzel.txt',
    url: 'https://github.com/google/fonts/raw/main/ofl/cinzel/Cinzel%5Bwght%5D.ttf',
  },
  {
    name: 'garamond-italic',
    file: 'EBGaramond-Italic.ttf',
    licence: 'OFL-ebgaramond.txt',
    url: 'https://github.com/google/fonts/raw/main/ofl/ebgaramond/EBGaramond-Italic%5Bwght%5D.ttf',
  },
]

/** Latin with the diacritics transliterated Greek and modern forms use; Greek comes with harfbuzz. */
const CHARSET =
  ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
  "-.,;:'’()&/·ÄËÏÖÜäëïöüÁÉÍÓÚáéíóúÂÊÎÔÛâêîôûĀĒĪŌŪāēīōūÆŒæœ"

/** Em size of the atlas and the field's range in atlas pixels: enough for 3 px of halo at 12 px type. */
const FONT_SIZE = 64
const DISTANCE_RANGE = 8

function bake(fontPath: string): Promise<{ png: Buffer; json: string }> {
  return new Promise((ok, fail) =>
    generateBMFont(
      fontPath,
      {
        outputType: 'json',
        fieldType: 'msdf',
        fontSize: FONT_SIZE,
        distanceRange: DISTANCE_RANGE,
        textureSize: [1024, 1024],
        charset: CHARSET,
        smartSize: true,
        pot: true,
        texturePadding: 2,
      },
      (err: Error | null, textures: { texture: Buffer }[], font: { data: string }) => {
        if (err) return fail(err)
        if (textures.length !== 1) return fail(new Error(`${fontPath}: ${textures.length} atlas pages, expected 1`))
        ok({ png: textures[0].texture, json: font.data })
      },
    ),
  )
}

mkdirSync(OUT, { recursive: true })
for (const f of FONTS) {
  const path = join(CACHE, f.file)
  if (!existsSync(path)) throw new Error(`missing ${path}; download it from ${f.url}`)
  const { png, json } = await bake(path)
  writeFileSync(join(OUT, `${f.name}.png`), png)
  // The generator names the page after its own temp file; the engine loads `${name}.png`.
  const meta = JSON.parse(json)
  meta.pages = [`${f.name}.png`]
  writeFileSync(join(OUT, `${f.name}.json`), JSON.stringify(meta))
  copyFileSync(join(CACHE, f.licence), join(OUT, `${f.name}.OFL.txt`))
  console.log(`${f.name}: ${meta.chars.length} glyphs, ${meta.common.scaleW}×${meta.common.scaleH}, ${meta.kernings.length} kerning pairs`)
}
