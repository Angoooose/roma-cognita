import * as THREE from 'three/webgpu'
import {
  abs,
  clamp,
  cos,
  float,
  floor,
  fract,
  Fn,
  hash,
  If,
  int,
  ivec2,
  length,
  max,
  min,
  mix,
  select,
  sin,
  smoothstep,
  texture,
  textureLoad,
  uniform,
  uniformArray,
  vec2,
  vec3,
} from 'three/tsl'
import { seededNoise } from '../terrain/noise.ts'
import { css, planTextures, planUniforms, plateUV, reachAt } from './shading.ts'

/**
 * The country round the model of Rome (DESIGN.md §7.7), painted onto the terrain
 * when the map is zoomed right into the city: the farmland outside the wall, its
 * lanes and hedges, and the recorded gardens, groves and burial ground, from the
 * land-use field the pipeline bakes (pipeline/src/rome/fields.ts, plate-2).
 *
 * It is set in summer, as the model is: the grain ripe or cut, the fallow ploughed,
 * the pasture dry, and the watered gardens, vines and meadows green. Like the
 * generated houses it is illustrative, and plainer than what is recorded. It is
 * painted under the rivers and roads, and reaches beyond the board (`fieldsMask`),
 * fading out into the map's own ground.
 *
 * It comes in only once the model stands and the view is well inside the city
 * (`FIELDS_MPP`): further out it would be a patch of country unlike the rest of
 * Italy's. Its plots are drawn as the map's own ground there, lighter or darker,
 * yellower or greener (`REFERENCE`), so where they thin out towards the edge the one
 * runs into the other, plot by plot (`keepPlot`); and zooming in, they come up out
 * of it all together (`reveal`).
 */
export const fieldUniforms = {
  /** How far beyond everything on the plan the country is drawn, metres. */
  reach: uniform(1350),
  /**
   * How far the fields have come in, 0 … 1: set per frame from the view's scale
   * (`fieldsRevealAt`), one for the whole view, as the model's rise is, so on a
   * tilted view the fields and the trees standing in them come in together.
   */
  reveal: uniform(0),
  /** plate-2's clamps, metres: the distance to a plot's edge, and to a lane. */
  edgeClamp: uniform(6),
  laneClamp: uniform(10),
  /**
   * The recorded grounds, by index (from 1): first year, last year, the index of a
   * ground it was laid out over (0 for none), and its kind (`GROUND`).
   */
  grounds: uniformArray(
    Array.from({ length: 16 }, () => new THREE.Vector4(1, 0, 0, 0)),
    'vec4',
  ),
}

/** What the land is used for (pipeline fields.ts `LAND`). */
const LAND = {
  garden: 1,
  vines: 2,
  olives: 3,
  orchard: 4,
  grain: 5,
  stubble: 6,
  fallow: 7,
  pasture: 8,
  meadow: 9,
  scrub: 10,
  open: 11,
  recorded: 12,
}
/** A recorded ground's kind (PlanLayer sets `grounds` from plan.json). */
export const GROUND = { garden: 0, grove: 1, burial: 2 }
/** The rows of olives and orchard trees, metres (pipeline fields.ts `ROWS_M`). */
const ROWS_M = { olives: 9, orchard: 7 }

type F = THREE.Node<'float'>
type V3 = THREE.Node<'vec3'>
const hex = (h: string) => {
  const c = new THREE.Color(h)
  return vec3(c.r, c.g, c.b)
}

/** The map's ground round Rome, as the terrain draws it: what the colours below are lit against. */
const REFERENCE = new THREE.Color('#9D9964')
/** The summer palette, muted towards the map's ground so the model stays the subject. */
const P = {
  gardenGreen: hex('#76884C'),
  gardenBlue: hex('#6C8058'),
  gardenEarth: hex('#8F7B5A'),
  vineEarth: hex('#AD9E72'),
  vine: hex('#6E7C45'),
  dryGrass: hex('#AEA476'),
  olive: hex('#838B69'),
  orchardGrass: hex('#9DA269'),
  fruit: hex('#5F7545'),
  grain: hex('#C8B67C'),
  grainGreen: hex('#BDB477'),
  stubble: hex('#CEC196'),
  fallow: hex('#A8926F'),
  furrow: hex('#978062'),
  pasture: hex('#ABA671'),
  meadow: hex('#97A266'),
  scrub: hex('#8E8D5E'),
  scrubBush: hex('#6D7148'),
  open: hex('#B0A97A'),
  lawn: hex('#90A064'),
  walk: hex('#CBBE9A'),
  groveFloor: hex('#7F8A58'),
  burial: hex('#A89B7E'),
  pit: hex('#72664F'),
  hedge: hex('#6F6F49'),
  lane: hex('#C8BA93'),
}

/** The legend's swatches for the country (ModelLayer `MODEL_KEY`). */
export const FIELD_KEY = {
  fields: ['#C8B67C', '#76884C', '#AD9E72'],
  garden: '#90A064',
}

/**
 * The scale (m per CSS px) the fields come in between: none at the first, where the
 * model has just come to stand (ModelLayer `MODEL_MPP`), all of them by the second.
 */
const FIELDS_MPP: [number, number] = [8, 4]

/** How far the fields have come in at a scale, m per CSS px (`fieldUniforms.reveal`). */
export function fieldsRevealAt(mpp: number) {
  const [none, all] = FIELDS_MPP
  const t = Math.min(1, Math.max(0, (none - mpp) / (none - all)))
  return t * t * (3 - 2 * t)
}
/**
 * How the country thins out towards its edge (`thinAt`), metres: over the last
 * stretch of its reach, and of the plate's grid.
 */
const THIN_REACH_M: [number, number] = [1000, 60]
const THIN_PLATE_M: [number, number] = [700, 60]
/** How soft one plot's own fade is, as a share of the thinning (`keepPlot`). */
const PLOT_SOFT = 0.12

/** Metres from a plane point to the nearest edge of the plate's grid. */
function toPlateEdge(mx: F, my: F) {
  const uv = plateUV(mx, my)
  return min(
    min(uv.x, float(1).sub(uv.x)).mul(planUniforms.plateSize.x),
    min(uv.y, float(1).sub(uv.y)).mul(planUniforms.plateSize.y),
  )
}

/**
 * How far out the country reaches at a plane point, at any zoom from the board's in:
 * out to `reach` beyond everything on the plan, fading over its last 450 m and at the
 * edges of the plate's grid. The plan's roads out of the gates run on as far
 * (shading.ts `planShading`), so they hand over to the map's where it ends. `pxM`
 * must be taken outside a branch.
 */
export function countryMask(mx: F, my: F, pxM: F) {
  const zoom = float(1)
    .sub(smoothstep(18, 26, css(pxM)))
    .mul(planUniforms.enabled)
    .mul(planUniforms.loaded)
  const far = float(1).sub(
    smoothstep(fieldUniforms.reach.sub(450), fieldUniforms.reach.sub(50), reachAt(mx, my)),
  )
  return zoom.mul(far).mul(smoothstep(0, 300, toPlateEdge(mx, my)))
}

/** 0 well inside the country … 1 at its edge, by its reach and the plate's grid. */
function thinAt(mx: F, my: F) {
  const r = fieldUniforms.reach
  return max(
    smoothstep(r.sub(THIN_REACH_M[0]), r.sub(THIN_REACH_M[1]), reachAt(mx, my)),
    smoothstep(THIN_PLATE_M[0], THIN_PLATE_M[1], toPlateEdge(mx, my)),
  )
}

/**
 * How much of the country is drawn at a plane point: from `FIELDS_MPP` in, out to
 * where it has thinned away (`thinAt`), plot by plot (`keepPlot`).
 */
export function fieldsMask(mx: F, my: F) {
  const shown = fieldUniforms.reveal.greaterThan(0).and(thinAt(mx, my).lessThan(1))
  return select(shown, float(1), float(0))
    .mul(planUniforms.enabled)
    .mul(planUniforms.loaded)
}

/**
 * Whether a plot is drawn, 0 … 1: each has its own draw (`id`, from what it is and
 * the lie of its rows, which neighbours rarely share), and drops out once the
 * thinning passes it. So towards its edge the country trails off plot by plot, as an
 * engraved map's does towards its margin, rather than ending in a soft outline. And
 * all of it as far as the fields have come in (`reveal`).
 */
function keepPlot(id: F, mx: F, my: F) {
  const thin = thinAt(mx, my)
  const drop = hash(id).mul(1 - PLOT_SOFT)
  return float(1)
    .sub(smoothstep(drop, drop.add(PLOT_SOFT), thin))
    .mul(fieldUniforms.reveal)
}

/**
 * The country over the terrain's `colour` at plane position (`mx`, `my`), metres,
 * under the rivers and roads. `pxM` is metres per device pixel, taken outside any
 * branch.
 */
export function fieldShading(colour: V3, mx: F, my: F, pxM: F) {
  const mask = fieldsMask(mx, my)
  return Fn(() => {
    const out = vec3(colour).toVar()
    If(mask.greaterThan(0), () => {
      out.assign(mix(out, fieldsOver(out, mx, my, pxM), mask))
    })
    return out
  })()
}

/**
 * How much a tree of the model's standing on the country at a plane point shows: its
 * plot's own (`keepPlot`), so the olives and orchards come in with the fields they
 * stand in, rather than drawing the plots on the map's plain ground before them. Those
 * inside the wall and in the recorded gardens and groves always stand.
 */
export function plotShown(mx: F, my: F) {
  const uv = plateUV(mx, my)
  const cell = clamp(
    floor(uv.mul(planUniforms.plateTexels)),
    vec2(0),
    planUniforms.plateTexels.sub(1),
  )
  const raw = textureLoad(
    planTextures.plate[2],
    ivec2(int(cell.x), int(cell.y)),
  ) as unknown as THREE.Node<'vec4'>
  const code = floor(raw.r.mul(255).add(0.5))
  const use = floor(code.div(16))
  const g8 = floor(raw.g.mul(255).add(0.5))
  const keep = keepPlot(code.mul(256).add(g8).add(7), mx, my)
  return select(use.equal(0).or(use.equal(LAND.recorded)), float(1), keep)
}

/**
 * 1 where a recorded ground stands in the year shown: the plan keeps its trodden
 * earth off it inside the wall (Maecenas' gardens over the rampart).
 */
export function groundStanding(mx: F, my: F) {
  const uv = plateUV(mx, my)
  const cell = min(floor(uv.mul(planUniforms.plateTexels)), planUniforms.plateTexels.sub(1))
  const raw = textureLoad(
    planTextures.plate[2],
    ivec2(int(cell.x), int(cell.y)),
  ) as unknown as THREE.Node<'vec4'>
  const code = floor(raw.r.mul(255).add(0.5))
  const use = floor(code.div(16))
  const g = fieldUniforms.grounds.element(
    int(code.sub(use.mul(16))),
  ) as unknown as THREE.Node<'vec4'>
  const year = planUniforms.year
  return select(
    use.equal(LAND.recorded).and(year.greaterThanEqual(g.x)).and(year.lessThanEqual(g.y)),
    float(1),
    float(0),
  )
}

function fieldsOver(colour: V3, mx: F, my: F, pxM: F) {
  const uv = plateUV(mx, my)
  const lin = texture(planTextures.plate[2], uv).level(float(0))
  // The distances are stored signed by side (pipeline fields.ts), so interpolated
  // they cross zero on the line itself and it draws unbroken; their size is the
  // distance.
  const signed = (v: F) => v.mul(255).sub(128).div(127)
  const toEdge = abs(signed(lin.b)).mul(fieldUniforms.edgeClamp)
  const toLane = abs(signed(lin.a)).mul(fieldUniforms.laneClamp)
  // What the land is comes from the nearest texel, looked up a step inside the plot
  // from its nearest edge — down the slope of the interpolated distance — so a plot's
  // edge runs straight across the texels rather than stepping along them. A plot's
  // edge is the hedge field's; a block's the lane field's, which along a block edge
  // that is not a lane stands `NOT_A_LANE_M` (pipeline fields.ts) further out.
  const at = (dx: number, dy: number) =>
    texture(planTextures.plate[2], plateUV(mx.add(dx), my.add(dy))).level(float(0))
  const [e0, e1, e2, e3] = [at(1.5, 0), at(-1.5, 0), at(0, 1.5), at(0, -1.5)]
  const slope = (pick: (v: THREE.Node<'vec4'>) => F) =>
    vec2(
      abs(signed(pick(e0))).sub(abs(signed(pick(e1)))),
      abs(signed(pick(e2))).sub(abs(signed(pick(e3)))),
    )
  const toward = (g: THREE.Node<'vec2'>) => g.div(max(length(g), 1e-4))
  const byHedge = float(3.2).sub(toEdge)
  const byBlock = clamp(float(3.2 + 4).sub(toLane), 0, 3.2)
  const inward = select(
    byHedge.greaterThan(0),
    toward(slope((v) => v.b)).mul(byHedge),
    toward(slope((v) => v.a)).mul(byBlock),
  )
  const cell = min(
    floor(plateUV(mx.add(inward.x), my.add(inward.y)).mul(planUniforms.plateTexels)),
    planUniforms.plateTexels.sub(1),
  )
  const raw = textureLoad(
    planTextures.plate[2],
    ivec2(int(cell.x), int(cell.y)),
  ) as unknown as THREE.Node<'vec4'>
  const code = floor(raw.r.mul(255).add(0.5))
  const use = floor(code.div(16))
  const tone = code.sub(use.mul(16))

  // The rows' frame, in metres from the grid's north-west corner (the pipeline's). A
  // recorded ground carries the farmland it was laid out over, and its rows' direction
  // in 16 steps.
  const g8 = floor(raw.g.mul(255).add(0.5))
  const keep = keepPlot(code.mul(256).add(g8).add(7), mx, my).toVar()
  const isRecorded = use.equal(LAND.recorded)
  const a = select(isRecorded, g8.sub(floor(g8.div(16)).mul(16)).div(16), g8.div(256)).mul(
    Math.PI,
  )
  // Taken into variables before the branches below: a node first built inside one
  // branch is out of scope in the next.
  const px = mx.sub(planUniforms.plateOrigin.x).toVar()
  const py = my.sub(planUniforms.plateOrigin.y).toVar()
  const ru = px
    .mul(cos(a))
    .add(py.mul(sin(a)))
    .toVar()
  const rv = px
    .mul(sin(a))
    .negate()
    .add(py.mul(cos(a)))
    .toVar()
  const aa = pxM.mul(0.7).toVar()
  const t = tone.div(15).toVar()

  /** Bands `duty` of each `spacing` wide across `q`, fading to their share when too fine to draw. */
  const stripes = (q: F, spacing: number, duty: number) => {
    const d = abs(fract(q.div(spacing)).sub(0.5)).mul(spacing)
    const band = float(1).sub(
      smoothstep(
        float((duty * spacing) / 2).sub(aa),
        float((duty * spacing) / 2).add(aa),
        d,
      ),
    )
    return mix(
      float(duty),
      band,
      float(1).sub(smoothstep(spacing * 0.2, spacing * 0.55, pxM)),
    )
  }
  /** Round spots of radius `r` on a lattice `spacing` apart, fading to their share. */
  const spots = (spacing: number, r: number) => {
    const d = length(
      vec2(fract(ru.div(spacing)).sub(0.5), fract(rv.div(spacing)).sub(0.5)),
    ).mul(spacing)
    const spot = float(1).sub(smoothstep(float(r).sub(aa), float(r).add(aa), d))
    const share = (Math.PI * r * r) / (spacing * spacing)
    return mix(float(share), spot, float(1).sub(smoothstep(r * 0.4, r * 1.2, pxM)))
  }
  /** A soft mottle, to take the flatness off a field, fading out when too fine. */
  const mottle = (scale: number, seed: number) =>
    seededNoise(vec2(px, py).div(scale), seed).mul(
      float(1).sub(smoothstep(scale * 0.3, scale, pxM)),
    )

  const look = vec3(0, 0, 0).toVar()
  const kind = use.toVar()
  // A recorded ground in a year it does not stand shows the ground it was laid out
  // over, if that stood then, or pasture.
  const groundKind = float(-1).toVar()
  If(use.equal(LAND.recorded), () => {
    const slot = (k: THREE.Node<'int'>) =>
      fieldUniforms.grounds.element(k) as unknown as THREE.Node<'vec4'>
    const g = slot(int(tone))
    const year = planUniforms.year
    const now = year.greaterThanEqual(g.x).and(year.lessThanEqual(g.y))
    const p = slot(int(g.z))
    const then = g.z
      .greaterThan(0)
      .and(year.greaterThanEqual(p.x))
      .and(year.lessThanEqual(p.y))
    groundKind.assign(select(now, g.w, select(then, p.w, float(-1))))
    // Outside its years, the farmland it was laid out over, before and after (the
    // burial ground, cleared by about 35 BCE, goes back to the country round it).
    kind.assign(select(groundKind.lessThan(0), floor(g8.div(16)), float(LAND.recorded)))
  })

  If(kind.equal(LAND.garden), () => {
    // Beds a little over a metre and a half wide, green between paths of earth; the
    // crops vary plot by plot.
    const green = mix(P.gardenGreen, P.gardenBlue, t)
    look.assign(mix(mix(P.gardenEarth, green, 0.55), green, stripes(rv, 3.2, 0.62)))
  })
    .ElseIf(kind.equal(LAND.vines), () => {
      // Rows of vines about two metres apart, trained low, the earth between them bare.
      look.assign(mix(P.vineEarth, P.vine, stripes(rv, 2.2, 0.32).mul(0.7)))
    })
    .ElseIf(kind.equal(LAND.olives), () => {
      // The shade of each tree's crown on the dry grass: under the model's own trees
      // close in, and the trees themselves further out.
      look.assign(mix(P.dryGrass, P.olive, spots(ROWS_M.olives, 2.7).mul(0.6)))
    })
    .ElseIf(kind.equal(LAND.orchard), () => {
      look.assign(mix(P.orchardGrass, P.fruit, spots(ROWS_M.orchard, 2.2).mul(0.6)))
    })
    .ElseIf(kind.equal(LAND.grain), () => {
      // Ripe, or a little behind; sown broadcast, so no rows, only the wind's mottle.
      const base = mix(P.grain, P.grainGreen, t.mul(0.6))
      look.assign(base.mul(float(1).add(mottle(14, 51).mul(0.035))))
    })
    .ElseIf(kind.equal(LAND.stubble), () => {
      look.assign(mix(P.stubble, P.grain, stripes(ru, 1.6, 0.25).mul(0.35)))
    })
    .ElseIf(kind.equal(LAND.fallow), () => {
      look.assign(mix(P.fallow, P.furrow, stripes(rv, 0.9, 0.35).mul(0.6)))
    })
    .ElseIf(kind.equal(LAND.pasture), () => {
      look.assign(P.pasture.mul(float(1).add(mottle(9, 52).mul(0.05))))
    })
    .ElseIf(kind.equal(LAND.meadow), () => {
      // Mown in swathes.
      look.assign(mix(P.meadow, P.pasture, stripes(ru, 5, 0.5).mul(0.3)))
    })
    .ElseIf(kind.equal(LAND.scrub), () => {
      const bush = smoothstep(0.25, 0.45, mottle(4, 53))
      look.assign(mix(P.scrub, P.scrubBush, bush))
    })
    .ElseIf(kind.equal(LAND.open), () => {
      // Grass kept short by use, greener in the hollows and worn paler in patches,
      // at two scales, so it reads as ground and not as a flat patch.
      const worn = mottle(40, 54).mul(0.5).add(mottle(9, 57).mul(0.5))
      look.assign(mix(P.meadow, P.open, float(0.55).add(worn.mul(0.6))))
    })
    .Else(() => {
      // A recorded ground: a garden's lawns within a walk round its edge, a grove's
      // shaded floor, the burial ground's bare earth and pits.
      // Gravel walks across the lawns, 45 metres apart, on the lie of the ground it
      // was laid out over; the cypresses along its edge mark the boundary.
      const walk = max(stripes(ru, 45, 0.06), stripes(rv, 45, 0.06)).mul(0.7)
      const lawn = P.lawn.mul(float(1).add(mottle(8, 56).mul(0.05)))
      const garden = mix(lawn, P.walk, walk.mul(0.6))
      // The burial ground: rough, trodden grass over the pits, bare where they are.
      const rough = mix(P.pasture, P.burial, float(0.5).add(mottle(10, 55).mul(0.6)))
      const burial = mix(rough, P.pit, spots(9, 1.6).mul(0.55))
      look.assign(
        select(
          groundKind.equal(GROUND.grove),
          P.groveFloor,
          select(groundKind.equal(GROUND.burial), burial, garden),
        ),
      )
    })

  // Each plot a shade its own, muted a quarter of the way to the map's ground so the
  // patchwork stays quiet under the model. It is drawn as the map's ground, lit as it
  // is, taken from `REFERENCE` towards the plot's own colour: where the terrain is
  // greener or darker, so are the fields, and they thin out into it without an edge.
  const ref = vec3(REFERENCE.r, REFERENCE.g, REFERENCE.b)
  look.assign(mix(look, ref, 0.25))
  const shade = float(0.975).add(t.mul(0.05))
  const lit = clamp(vec3(colour).div(ref), 0.5, 1.6).toVar()
  const ground = look.mul(shade).mul(lit).toVar()

  // Hedges and walls between plots, a metre wide; lanes of trodden earth three wide,
  // fading to a hint when narrower than a pixel or two.
  const hedgeW = max(float(0.55), pxM.mul(0.6))
  const hedge = float(1)
    .sub(smoothstep(hedgeW.sub(aa), hedgeW.add(aa), toEdge))
    .mul(mix(float(0.55), float(0.15), smoothstep(0.6, 3, pxM)))
  // Neither on open ground nor in a recorded one while it stands, whose edge the
  // lane field carries only to keep it smooth (pipeline fields.ts); out of its years
  // its plots' hedges and lanes show.
  const plotted = select(kind.equal(LAND.open).or(kind.equal(LAND.recorded)), 0, 1)
  ground.assign(mix(ground, P.hedge.mul(lit), hedge.mul(plotted)))
  // Never wider than the lane field's offset along block edges that are not lanes.
  const laneW = clamp(pxM.mul(0.8), 1.5, 3)
  const lane = float(1)
    .sub(smoothstep(laneW.sub(aa), laneW.add(aa), toLane))
    .mul(mix(float(0.85), float(0.35), smoothstep(1.5, 6, pxM)))
  ground.assign(mix(ground, P.lane.mul(lit), lane.mul(plotted)))
  return select(use.equal(0), colour, mix(colour, ground, keep))
}
