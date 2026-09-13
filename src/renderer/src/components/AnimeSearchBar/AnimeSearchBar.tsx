import { useState, useEffect } from 'react'
import styles from './AnimeSearchBar.module.css'

export default function AnimeSearchBar({ setResults }) {
  const [query, setQuery] = useState('')

  useEffect(() => {
    const l = localStorage.getItem('last_search')
    const lr = localStorage.getItem('last_search_results')
    if (l) setQuery(l)
    if (lr) {
      try {
        const cached = JSON.parse(lr)
        // allanime-shaped results carry no type, drop them instead of rendering blanks
        setResults(cached.every((anime: any) => anime?.type) ? cached : [])
      } catch (e) {
        console.error('bad json')
      }
    }
  }, [])

  const handleSearch = async () => {
    const data = await window.api.api_searchAnime(query)
    console.log(data)
    localStorage.setItem('last_search', query)
    localStorage.setItem('last_search_results', JSON.stringify(data))
    setResults(data)
  }

  return (
    <div>
      <input
        className={styles.input}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            handleSearch()
          }
        }}
        placeholder="search anime..."
      />
    </div>
  )
}
