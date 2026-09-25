/**
 * The course of the Servian Wall, for the plan of Rome (DESIGN.md §7.7): the
 * walled city the plan hatches, and the line of the wall between its surviving
 * stretches.
 *
 * No published course is open data, so it is reconstructed here, and every vertex
 * says where it comes from:
 *
 * - `tract`: a stretch that survives, at the centre of its OpenStreetMap outline
 *   (the stretches Pleiades lists as the wall's locations, place 103808101);
 * - `gate`: a gate Pleiades locates precisely, or that Platner & Ashby place by a
 *   landmark;
 * - `course`: a point Platner & Ashby's description puts the line through, where
 *   nothing survives.
 *
 * The whole circuit is drawn, in the plan's wall symbol, two ways:
 *
 * - **Known**: between two neighbouring `tract` or `gate` vertices less than
 *   MAX_KNOWN_M apart, solid.
 * - **Reconstructed**: every other join, lighter and broken, since a straight join
 *   over a longer gap or through a `course` point claims more than anyone knows.
 *
 * The one stretch not drawn is the river bank from below the Aventine to the Porta
 * Flumentana (the joins leaving an `alongRiver` vertex). There the Tiber was the
 * defence: Platner & Ashby have the wall running "south of the forum Boarium to the
 * Tiber again", and the river closing the circuit.
 *
 * Left out: the stretch "in the garden of the Palazzo Colonna at the west end of the
 * Quirinal" (Platner & Ashby, Murus Servii Tullii). Its place in the garden is not
 * known closely enough to join without a false kink in the Quirinal stretch.
 *
 * Vertices run clockwise from the Porta Collina, lon/lat.
 */
export type Evidence = 'tract' | 'gate' | 'course'

export interface Vertex {
  at: [number, number]
  evidence: Evidence
  what: string
  /** Moved onto the nearest point of the Tiber's outline: the wall met the river here. */
  snap?: 'river'
  /** The join from here to the next vertex is the river bank, not wall. */
  alongRiver?: true
}

/** Joins between surveyed vertices longer than this are drawn as reconstructed. */
export const MAX_KNOWN_M = 700

export const SERVIAN: Vertex[] = [
  {
    at: [12.49868, 41.90732],
    evidence: 'gate',
    what: 'Porta Collina, at the north end of the agger (Pleiades 268637493)',
  },
  {
    at: [12.50016, 41.9035],
    evidence: 'tract',
    what: 'tract in Via Gaeta (OSM way/427415216)',
  },
  {
    at: [12.50169, 41.90185],
    evidence: 'tract',
    what: 'the agger in Piazza dei Cinquecento (OSM way/112675404)',
  },
  {
    at: [12.50225, 41.89792],
    evidence: 'tract',
    what: 'tract in Piazza Manfredo Fanti (OSM way/105281824)',
  },
  {
    at: [12.50136, 41.89578],
    evidence: 'gate',
    what: 'Porta Esquilina, at the south end of the agger, where the Arch of Gallienus stands (Pleiades 29110684; Platner & Ashby, Porta Esquilina)',
  },
  {
    at: [12.50053, 41.89276],
    evidence: 'tract',
    what: 'tract in Via Mecenate (OSM way/785914787)',
  },
  {
    at: [12.503, 41.888],
    evidence: 'course',
    what: 'Porta Caelimontana, "a short distance north-west of the Lateran" (Platner & Ashby, Porta Caelimontana); from there the wall "followed the cliffs on the south-east and south" of the Caelian (Murus Servii Tullii)',
  },
  {
    at: [12.491, 41.884],
    evidence: 'gate',
    what: 'Porta Capena, on the south-west slope of the Caelian where the Via Appia left the city (Pleiades 27164982; Platner & Ashby, Porta Capena)',
  },
  {
    at: [12.4896, 41.87895],
    evidence: 'gate',
    what: 'Porta Naevia, on the Aventine (Pleiades 37637607)',
  },
  {
    at: [12.48818, 41.88054],
    evidence: 'tract',
    what: 'tract in Piazza Albania (OSM way/356989727)',
  },
  {
    at: [12.48293, 41.88026],
    evidence: 'tract',
    what: 'tract in Via di Sant’Anselmo (OSM way/120880574)',
  },
  {
    at: [12.48223, 41.8804],
    evidence: 'tract',
    what: 'second tract in Via di Sant’Anselmo (OSM way/120880575)',
  },
  {
    at: [12.4776, 41.8844],
    evidence: 'course',
    snap: 'river',
    alongRiver: true,
    what: 'the river bank below the Aventine: Porta Trigemina lay between the Aventine and the Tiber, its site undetermined (Platner & Ashby, Porta Trigemina)',
  },
  {
    at: [12.4786, 41.8896],
    evidence: 'course',
    snap: 'river',
    alongRiver: true,
    what: 'the river bank at the Forum Boarium',
  },
  {
    at: [12.4786, 41.8906],
    evidence: 'course',
    snap: 'river',
    what: 'Porta Flumentana, near the Tiber, on the stretch from the Capitol to the river; the wall "began at the Tiber, crossed the low ground to the south-west corner of the Capitol" (Platner & Ashby, Porta Flumentana; Murus Servii Tullii)',
  },
  {
    at: [12.4819, 41.8909],
    evidence: 'gate',
    what: 'Porta Carmentalis, at the south-west corner of the Capitol, "very near the intersection of the present Via della Consolazione and the Via della Bocca della Verità" (Platner & Ashby, Porta Carmentalis): the west end of today\'s Piazza della Consolazione, which carries the old street, by Via Luigi Petroselli, the old Via della Bocca della Verità (OSM way/366796437, way/116237739)',
  },
  {
    at: [12.4811, 41.8928],
    evidence: 'course',
    what: 'the west brow of the Capitol: from its south-west corner the wall "ran north-east along the edge of the cliffs of this hill" (Platner & Ashby, Murus Servii Tullii)',
  },
  {
    at: [12.4818, 41.8948],
    evidence: 'course',
    what: 'the north brow of the Capitol (the Arx), on the same line',
  },
  {
    at: [12.48469, 41.89635],
    evidence: 'tract',
    what: 'tract in Via di Santa Eufemia (Pleiades location; OSM way/152146425)',
  },
  {
    at: [12.48679, 41.89645],
    evidence: 'gate',
    what: 'Porta Sanqualis, by the Piazza Magnanapoli, where a tract survives (Platner & Ashby, Porta Sanqualis; OSM way/254653738)',
  },
  {
    at: [12.4886, 41.9035],
    evidence: 'course',
    what: 'Piazza Barberini: the wall ran "along the edge of the cliffs of this hill and the Quirinal, until it almost reached the head of the valley between the Quirinal and the Pincian" (Platner & Ashby, Murus Servii Tullii)',
  },
  {
    at: [12.49371, 41.90482],
    evidence: 'tract',
    what: 'tract in Largo di Santa Susanna (OSM way/427413247)',
  },
  {
    at: [12.49432, 41.90636],
    evidence: 'tract',
    what: 'tract in Via Carducci (OSM way/781934076)',
  },
]
