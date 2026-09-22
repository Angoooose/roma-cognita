/**
 * The GeoJSON the data files hold: lon/lat (RFC 7946), features keyed by our
 * own ids. Only shape is checked here; winding, closure and "is this really
 * lon/lat" are the pipeline's job (pipeline/src/geo.ts), because a zod error on
 * the ten-thousandth vertex of Macedonia is not a useful message.
 */
import { z } from 'zod'
import { SlugSchema } from './common.ts'

const Position = z.tuple([z.number(), z.number()])
const Ring = z.array(Position).min(4)

export const PolygonSchema = z.strictObject({
  type: z.literal('Polygon'),
  coordinates: z.array(Ring).min(1),
})
export const MultiPolygonSchema = z.strictObject({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(Ring).min(1)).min(1),
})
export const LineStringSchema = z.strictObject({
  type: z.literal('LineString'),
  coordinates: z.array(Position).min(2),
})
export const MultiLineStringSchema = z.strictObject({
  type: z.literal('MultiLineString'),
  coordinates: z.array(z.array(Position).min(2)).min(1),
})

export const AreaGeometrySchema = z.discriminatedUnion('type', [
  PolygonSchema,
  MultiPolygonSchema,
])
export type AreaGeometry = z.infer<typeof AreaGeometrySchema>

export const AnyGeometrySchema = z.discriminatedUnion('type', [
  PolygonSchema,
  MultiPolygonSchema,
  LineStringSchema,
  MultiLineStringSchema,
])

/** A feature whose `id` is the record id it gives a shape to. */
export const keyedFeature = <G extends z.ZodType>(geometry: G) =>
  z.object({
    type: z.literal('Feature'),
    id: SlugSchema,
    properties: z.record(z.string(), z.unknown()).nullable(),
    geometry,
  })

export const keyedCollection = <G extends z.ZodType>(geometry: G) =>
  z.object({
    type: z.literal('FeatureCollection'),
    features: z.array(keyedFeature(geometry)),
  })

/** data/geometry/atoms.geojson */
export const AtomGeometrySchema = keyedCollection(AreaGeometrySchema)
export type AtomGeometry = z.infer<typeof AtomGeometrySchema>
