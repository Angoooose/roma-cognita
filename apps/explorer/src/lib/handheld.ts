/** How long "Link copied" is shown before the button reads as it did. */
const COPIED_MS = 2000

/**
 * Resolves once the map is wanted: at once on a computer, and never on a phone or
 * tablet, where the frontispiece stays as the handheld plate (index.html, splash.css)
 * and sends the link on to a computer. Nothing of the map is fetched there.
 */
export function mapWanted(): Promise<void> {
  const splash = document.getElementById('splash')
  const send = splash?.querySelector<HTMLButtonElement>('.handheld-note .send')
  if (!splash?.classList.contains('handheld') || !send) return Promise.resolve()

  const url = location.href
  const share = typeof navigator.share === 'function'
  if (!share) send.textContent = 'Copy the link'
  let timer = 0
  send.addEventListener('click', async () => {
    if (share) {
      // Dismissing the share sheet rejects; there is nothing to say about it.
      await navigator.share({ title: document.title, url }).catch(() => {})
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      send.textContent = 'Link copied'
      clearTimeout(timer)
      timer = window.setTimeout(() => (send.textContent = 'Copy the link'), COPIED_MS)
    } catch {
      // No clipboard: the address bar holds the same link.
    }
  })
  return new Promise(() => {})
}
