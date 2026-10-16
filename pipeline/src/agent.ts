/**
 * The User-Agent for every fetch the pipeline makes, optionally naming the script that
 * makes it. Public services (Wikimedia, Overpass among them) ask every script to say
 * who runs it and how to reach them, so the contact comes from the environment —
 * ROMA_COGNITA_CONTACT, set in the gitignored .env.local at the repo root — and is
 * never written into the code.
 */
export function userAgent(script?: string): string {
  const contact = process.env.ROMA_COGNITA_CONTACT?.trim()
  const parts = ['non-commercial historical atlas', script, contact].filter(Boolean)
  return `roma-cognita/0.1 (${parts.join('; ')})`
}

/** Warns, once, when the fetch will go out without a contact. */
export function warnIfNoContact(service: string) {
  if (!process.env.ROMA_COGNITA_CONTACT?.trim()) {
    console.warn(
      `  no ROMA_COGNITA_CONTACT set (in .env.local): ${service} is being asked without a contact address`,
    )
  }
}
