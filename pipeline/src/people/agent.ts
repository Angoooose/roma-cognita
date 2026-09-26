/**
 * The User-Agent for the one-off fetches from DPRR and Wikidata. Wikimedia asks every
 * script to say who runs it and how to reach them, so the contact comes from the
 * environment — ROMA_COGNITA_CONTACT, set in the gitignored .env.local at the repo root —
 * and is never written into the code.
 */
export function userAgent(): string {
  const contact = process.env.ROMA_COGNITA_CONTACT?.trim()
  return `roma-cognita/0.1 (non-commercial historical atlas${contact ? `; ${contact}` : ''})`
}

/** Warns, once, when the fetch will go out without a contact. */
export function warnIfNoContact(service: string) {
  if (!process.env.ROMA_COGNITA_CONTACT?.trim()) {
    console.warn(
      `  no ROMA_COGNITA_CONTACT set (in .env.local): ${service} is being asked without a contact address`,
    )
  }
}
