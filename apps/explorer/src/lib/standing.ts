/** A polity's footing, as the inspector and search say it: `Province of Roma`. */
export function standing(relation: string, overlord: string | null) {
  const of = overlord ? ` of ${overlord}` : ''
  switch (relation) {
    case 'province':
      return `Province${of}`
    case 'citizen-territory':
      return `Citizen territory${of}`
    case 'client':
      return `Client kingdom${of}`
    case 'allied':
      return `Allied${overlord ? ` to ${overlord}` : ''}`
    case 'occupied':
      return `Occupied`
    default:
      return 'Independent'
  }
}
