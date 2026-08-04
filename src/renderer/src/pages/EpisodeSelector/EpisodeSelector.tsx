import { useState, useEffect, useContext } from 'react'
import { context } from '../../App'
import { FileText } from 'lucide-react'
import { MPVLogViwer } from '../../components/MPVLogViewer/MPVLogViewer'
import { useWatchedEpisodes } from '@renderer/hooks/useWatchedEpisodes'

import styles from './EpisodeSelector.module.css'
import { useFavorites } from '@renderer/hooks/useFavorites'

export function EpisodeSelector() {
  const { animeId, animeName, animeImage, animeMaxEps, animeEnded, setPage } = useContext(context)
  const [animeEpisodes, setAnimeEpisodes] = useState<any>([])
  const [logview, setLogView] = useState<boolean>(true)
  const { watched, markWatched, markUnwatch } = useWatchedEpisodes(animeId!)
  const { favorite, toggleFavorite } = useFavorites({
    id: animeId!,
    name: animeName!,
    max_episodes: animeMaxEps,
    image: animeImage,
    ended: animeEnded
  });

  useEffect(() => {
    const l = localStorage.getItem('log_toggle')
    setLogView(l === 'true')
  }, [])

  async function playAnime(episodeId) {
    const sources = await window.api.api_getAnimeVideo(animeId!, episodeId)

    const best =
      sources.find((s) => s.isM3U8) || // m3u8 priority
      sources.find((s) => s.provider === 'S-mp4') || // fast internal mirrors
      sources.find((s) => s.provider === 'Yt-mp4') || //dnld source
      sources[0]

    if (best?.sourceUrl) {
      window.api.api_launchPlayer(best.sourceUrl)
    } else {
      console.log('source sucks')
    }
  }

  useEffect(() => {
    if (animeId) {
      async function a() {
        const data = await window.api.api_getAnimeEpisodeList(animeId!)
        setAnimeEpisodes(data)
      }
      a()
    }
  }, [animeId])

  const toggleLogView = () => {
    const newState = !logview
    setLogView(newState)
    localStorage.setItem('log_toggle', String(newState))
  }

  return (
    <div>
      <div className={styles.centerContainer}>
        <div className={styles.left}>
          <button className={styles.backButton} onClick={() => setPage('search')}>
            Back
          </button>
        </div>

        <p className={styles.title}>{animeName}</p>

        <div className={styles.right}>
          <button className={styles.starButton} onClick={toggleFavorite}>
            {favorite ? '★' : '☆'}
          </button>
          <button
            className={`${styles.logButton} ${logview ? styles.toggle : ''}`}
            onClick={() => toggleLogView()}
          >
            <FileText size={30} />
          </button>
        </div>
      </div>
      <div className={styles.episodeContainer}>
        {animeEpisodes.length > 0 ? (
          animeEpisodes.map((ep: any) => (
            <button
              key={ep}
              className={`${styles.episodeButton} ${watched[ep] ? styles.watched : ''}`}
              onClick={() => {
                playAnime(ep)
                markWatched(ep)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                markUnwatch(ep)
              }}
            >
              Episode {ep}
            </button>
          ))
        ) : (
          <p>loading</p>
        )}
      </div>
      {logview ? <MPVLogViwer /> : null}
    </div>
  )
}
