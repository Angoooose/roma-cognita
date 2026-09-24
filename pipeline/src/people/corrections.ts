/**
 * Corrections to DPRR, each one stated, reasoned and checked. DESIGN §1.6: every
 * build prints what it overrode.
 *
 * Each correction names the cached value it expects to find. If DPRR has since fixed
 * the value, or changed it to something else, the build says the correction is out of date
 * rather than silently overwriting whatever is there now.
 *
 * Values are in DPRR's own numbering (−30 is 30 BCE), because they replace DPRR's
 * values before the build converts them.
 */

export interface Correction {
  table: 'posts' | 'statuses'
  /** The assertion's DPRR id. */
  id: number
  field: 'start' | 'end'
  expect: string
  value: string
  why: string
}

export const CORRECTIONS: Correction[] = [
  // Three post ranges whose end lost its minus sign: every post in DPRR is
  // Republican, and each of these reads as a BCE range once the sign is restored.
  {
    table: 'posts',
    id: 7431,
    field: 'end',
    expect: '30',
    value: '-30',
    why: 'Sex. Appuleius (16a): a range 60–30 BCE with the end sign dropped',
  },
  {
    table: 'posts',
    id: 7447,
    field: 'end',
    expect: '30',
    value: '-30',
    why: 'L. Caecina: a range 60–30 BCE with the end sign dropped',
  },
  {
    table: 'posts',
    id: 7556,
    field: 'end',
    expect: '95',
    value: '-95',
    why: 'M. Opimius (8): a range 99–95 BCE with the end sign dropped',
  },
  // Of the four statuses that run into CE, three are right (Augustus to 14 CE,
  // Asinius Pollio to 4 CE, Sempronius Atratinus to 7 CE). Maecenas is not.
  {
    table: 'statuses',
    id: 334,
    field: 'end',
    expect: '8',
    value: '-8',
    why: 'C. Maecenas died in 8 BCE (Dio 55.7), not 8 CE',
  },
]

/**
 * DPRR's inverse table (`RelationshipInverse`) says, for a relationship and the sex
 * of the *other* person, what the other person is: A *father of* B, B male → B *son
 * of* A. Four of its rows give a male inverse for a female grandchild, and nine types
 * have no rows at all, so their pairs could not be merged. These rows replace or add
 * to it, by DPRR's own relationship names.
 */
export interface InverseCorrection {
  type: string
  /** The sex of the other person. */
  sex: 'male' | 'female'
  inverse: string
  /** `fix` replaces a wrong DPRR row; `add` supplies a missing one. */
  kind: 'fix' | 'add'
}

export const INVERSE_CORRECTIONS: InverseCorrection[] = [
  { type: 'grandfather of', sex: 'female', inverse: 'granddaughter of', kind: 'fix' },
  { type: 'grandmother of', sex: 'female', inverse: 'granddaughter of', kind: 'fix' },
  {
    type: 'great grandfather of',
    sex: 'female',
    inverse: 'great granddaughter of',
    kind: 'fix',
  },
  {
    type: 'great grandmother of',
    sex: 'female',
    inverse: 'great granddaughter of',
    kind: 'fix',
  },

  { type: 'stepbrother of', sex: 'male', inverse: 'stepbrother of', kind: 'add' },
  { type: 'stepbrother of', sex: 'female', inverse: 'stepsister of', kind: 'add' },
  { type: 'stepsister of', sex: 'male', inverse: 'stepbrother of', kind: 'add' },
  { type: 'stepsister of', sex: 'female', inverse: 'stepsister of', kind: 'add' },
  { type: 'halfbrother of', sex: 'male', inverse: 'halfbrother of', kind: 'add' },
  { type: 'halfbrother of', sex: 'female', inverse: 'halfsister of', kind: 'add' },
  { type: 'adoptive sister of', sex: 'male', inverse: 'adoptive brother of', kind: 'add' },
  { type: 'adoptive sister of', sex: 'female', inverse: 'adoptive sister of', kind: 'add' },
  { type: 'great uncle of', sex: 'male', inverse: 'great nephew of', kind: 'add' },
  { type: 'great nephew of', sex: 'male', inverse: 'great uncle of', kind: 'add' },
  { type: 'great niece of', sex: 'male', inverse: 'great uncle of', kind: 'add' },
  {
    type: 'adopted grandson of',
    sex: 'male',
    inverse: 'adoptive grandfather',
    kind: 'add',
  },
  {
    type: 'adoptive grandfather',
    sex: 'male',
    inverse: 'adopted grandson of',
    kind: 'add',
  },
  {
    type: 'adoptive grandmother of',
    sex: 'male',
    inverse: 'adopted grandson of',
    kind: 'add',
  },
  // DPRR has no "great aunt", "adopted granddaughter" or "adopted great grandson",
  // so those inverses stay missing, and the build reports the pairs it cannot merge.
]
