import { useState, useEffect, useContext } from 'react'
import { context } from '../../App'
import styles from './AnimeBox.module.css'

export function AnimeBox({ anime }) {
  const [imgSrc, setImgSrc] = useState(anime.thumbnail)
  const { setPage, setAnimeId, setAnimeName, setAnimeEnded, setAnimeMaxEps, setAnimeImage } = useContext(context)
  const isMovie = anime.type === 'MOVIE'

  useEffect(() => {
    if (!anime.thumbnail) {
      setImgSrc('/assets/qiqi.png')
    } else {
      setImgSrc(anime.thumbnail)
    }
  }, [anime.thumbnail])

  async function selectAnime() {
    setAnimeId(anime._id)
    setAnimeName(anime.name)
    setAnimeImage(imgSrc)
    setAnimeMaxEps(anime.subEpisodes)
    setAnimeEnded(anime.ended)
    setPage('episodes')
  }

  return (
    <div className={styles.container}>
      <div className={styles.imageWrapper}>
        <img className={styles.img} src={imgSrc} alt={anime.name} onClick={() => selectAnime()} />
        <div className={styles.overlay}>
          <span className={styles.episodes}>
            {isMovie ? 'Movie' : `Ep ${anime.subEpisodes}`}
          </span>
          <span className={styles.score}>{anime.type}</span>
        </div>
      </div>
      <div className={styles.title}>{anime.name}</div>
    </div>
  )
}
