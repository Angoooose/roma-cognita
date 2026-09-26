/**
 * Takes away the frontispiece index.html shows while the map loads (splash.css): its
 * rule is finished, then it fades to the map beneath. The map has drawn by then, so
 * the frontispiece's sea gives way to the map's own.
 */
export function dismissSplash() {
  const splash = document.getElementById('splash')
  if (!splash || splash.classList.contains('done')) return
  splash.classList.add('fonts', 'done')
  setTimeout(() => {
    splash.classList.add('gone')
    splash.addEventListener('transitionend', () => splash.remove(), { once: true })
    // Where transitions never run, as in a background tab.
    setTimeout(() => splash.remove(), 1000)
  }, 320)
}
