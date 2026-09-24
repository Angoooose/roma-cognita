/**
 * The interface follows the reader's system theme: Parchment in light, Ink & gold in
 * dark (index.css). The playground sets the class itself, to compare the two.
 */
export function followSystemTheme() {
  const dark = matchMedia('(prefers-color-scheme: dark)')
  const apply = () => document.documentElement.classList.toggle('dark', dark.matches)
  apply()
  dark.addEventListener('change', apply)
}
