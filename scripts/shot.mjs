// Screenshots of the map, for checking a visual change and comparing before with after.
//
//   npm run shot -- <view…> [options]
//
// A view is a name from VIEWS below, `name=<query>` for any other, or a bare query
// (`at=12.4823,41.8925&km=0.3&pitch=55`, see apps/explorer/src/lib/params.ts). Each is
// saved as <out>/<prefix>-<name>.png once the map has drawn it: every visible tile at
// its own detail and, close in, the model of Rome built.
//
//   --out <dir>       where the pictures go (default: $TMPDIR/roma-cognita-shots)
//   --prefix <text>   put before each name, e.g. before / after (default: shot)
//   --year <year>     for views that don't set one, e.g. 40BCE
//   --size <w>x<h>    the window in CSS px (default: 1400x900)
//   --scale <n>       device pixels per CSS px (default: 1)
//   --ui              keep the timeline and inspector (default: the map alone, ?bare=1)
//   --webgl           the WebGL2 fallback rather than WebGPU
//   --url <url>       use a running dev server rather than starting one from this checkout
//                     (a built copy only puts the engine on `window.map` with debug=1 in the view)
//   --timeout <s>     how long to wait for a view to draw before taking it anyway (default: 60)
//   --list            print the named views
//
// With no --url it starts its own dev server from this checkout, so a worktree is
// pictured as it is and not as whatever holds port 5180. It uses the installed Google
// Chrome, which draws WebGPU headless on macOS.

import os from 'node:os'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'

const ROOT = path.resolve(import.meta.dirname, '..')

/** The views kept for comparing like with like. The city's are tilted and close. */
const VIEWS = {
  // The three zoom tiers (DESIGN.md §7.6).
  world: 'at=18,40&km=4200',
  italy: 'at=12.5,41.9&km=900',
  latium: 'at=12.6,41.85&km=90',
  // The city at large, towards the wall.
  city: 'at=12.4990,41.8990&km=1.1&pitch=55&heading=20',
  // From straight overhead, the grain of blocks and streets.
  plan: 'at=12.4930,41.8950&km=0.45&pitch=0',
  forum: 'at=12.4855,41.8925&km=0.3&pitch=55&heading=330',
  'forum-julium': 'at=12.48336,41.89266&km=0.12&pitch=50&heading=40',
  palatine: 'at=12.4870,41.8895&km=0.4&pitch=50&heading=330',
  capitol: 'at=12.4828,41.8935&km=0.3&pitch=50&heading=200',
  subura: 'at=12.4950,41.8960&km=0.32&pitch=55&heading=20',
  aventine: 'at=12.4820,41.8830&km=0.35&pitch=55&heading=10',
  'tiber-island': 'at=12.47733,41.89004&km=0.07&pitch=50&heading=110',
  'campus-martius': 'at=12.4760,41.8990&km=0.6&pitch=55&heading=0',
}

/** The address's parameters (params.ts), to tell a bare query from a named one. */
const PARAMS = [
  'at',
  'km',
  'pitch',
  'heading',
  'year',
  'show',
  'person',
  'bare',
  'debug',
  'webgl',
]

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', default: path.join(os.tmpdir(), 'roma-cognita-shots') },
    prefix: { type: 'string', default: 'shot' },
    year: { type: 'string' },
    size: { type: 'string', default: '1400x900' },
    scale: { type: 'string', default: '1' },
    ui: { type: 'boolean', default: false },
    webgl: { type: 'boolean', default: false },
    url: { type: 'string' },
    timeout: { type: 'string', default: '60' },
    list: { type: 'boolean', default: false },
  },
})

if (opts.list || positionals.length === 0) {
  for (const [name, query] of Object.entries(VIEWS)) console.log(name.padEnd(16), query)
  if (!opts.list) console.log('\nnpm run shot -- <view…> [options]; see scripts/shot.mjs')
  process.exit(opts.list ? 0 : 1)
}

const views = positionals.map((arg, i) => {
  if (arg in VIEWS) return { name: arg, query: VIEWS[arg] }
  // `name=<query>` when what comes before the first = isn't itself a parameter.
  const [head, ...rest] = arg.split('=')
  if (rest.length > 1 && !PARAMS.includes(head))
    return { name: head, query: rest.join('=') }
  if (rest.length) return { name: `view${i + 1}`, query: arg }
  console.error(`No view called "${arg}". Named views:`, Object.keys(VIEWS).join(', '))
  process.exit(1)
})

const [width, height] = opts.size.split('x').map(Number)
const timeoutMs = Number(opts.timeout) * 1000
await mkdir(opts.out, { recursive: true })

let server
let base = opts.url
if (!base) {
  const { createServer } = await import('vite')
  server = await createServer({
    root: path.join(ROOT, 'apps/explorer'),
    configFile: path.join(ROOT, 'apps/explorer/vite.config.ts'),
    logLevel: 'error',
    server: { port: 5300, strictPort: false },
  })
  await server.listen()
  base = server.resolvedUrls.local[0]
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
})

let failed = false
try {
  for (const { name, query } of views) {
    const params = new URLSearchParams(query)
    if (opts.year && !params.has('year')) params.set('year', opts.year)
    if (!opts.ui) params.set('bare', '1')
    if (opts.webgl) params.set('webgl', '1')

    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: Number(opts.scale),
    })
    page.on('pageerror', (e) => console.error(`${name}: page error:`, e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') console.error(`${name}: console:`, m.text())
    })

    const started = Date.now()
    await page.goto(new URL(`/?${params}`, base).href)
    const drawn = await page
      .waitForFunction(
        () => {
          const map = window.map
          if (!map || document.getElementById('splash')) return false
          // Close in, the model of Rome is part of the picture; it loads in a worker.
          const close = map.view.state.distance < 30_000
          return map.idle && (!close || map.model.ready)
        },
        null,
        { timeout: timeoutMs, polling: 250 },
      )
      .then(() => true)
      .catch(() => false)
    // A few more frames for anything that eases in once the data is there.
    await page.waitForTimeout(1200)

    const file = path.join(opts.out, `${opts.prefix}-${name}.png`)
    await page.screenshot({ path: file })
    const s = ((Date.now() - started) / 1000).toFixed(0)
    if (drawn) console.log(`${file}  (${s} s)`)
    else {
      failed = true
      console.log(`${file}  (not fully drawn after ${opts.timeout} s; taken anyway)`)
    }
    await page.close()
  }
} finally {
  await browser.close()
  await server?.close()
}
process.exit(failed ? 2 : 0)
