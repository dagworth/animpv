import { AnimeBox } from '../AnimeBox/AnimeBox'
import styles from './ShowList.module.css'

export default function ShowList({ results }) {
  if (results.length === 0) return null

  return (
    <div className={styles.list}>
      {results.map((anime) => (
        <AnimeBox key={anime._id} anime={anime} />
      ))}
    </div>
  )
}
