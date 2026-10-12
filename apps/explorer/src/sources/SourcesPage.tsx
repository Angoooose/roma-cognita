import { useEffect, useState } from 'react'
import { BookEntry } from './BookEntry.tsx'
import { BookIndex } from './BookIndex.tsx'
import { BY_ID } from './data.ts'
import { setName } from './book.tsx'

/**
 * The sources page: the index of sources at /sources, and each work's entry at
 * /sources#<source id>, so the inspector can link straight to one.
 */
export function SourcesPage() {
  const [id, setId] = useState(fromHash)

  useEffect(() => {
    const follow = () => {
      setId(fromHash())
      scrollTo(0, 0)
    }
    addEventListener('hashchange', follow)
    return () => removeEventListener('hashchange', follow)
  }, [])

  useEffect(() => {
    document.title = id
      ? `${setName(BY_ID.get(id)!).name} · Index of Sources`
      : 'Index of Sources'
  }, [id])

  const open = (next: string) => {
    location.hash = next
  }
  const index = () => {
    history.pushState(null, '', location.pathname + location.search)
    setId(undefined)
    scrollTo(0, 0)
  }

  return (
    <main className="min-h-screen">
      {id ? (
        <BookEntry key={id} id={id} onOpen={open} onIndex={index} />
      ) : (
        <BookIndex onOpen={open} />
      )}
    </main>
  )
}

/** The work the address names, if it names one the index has. */
function fromHash(): string | undefined {
  const id = decodeURIComponent(location.hash.slice(1))
  return BY_ID.has(id) ? id : undefined
}
