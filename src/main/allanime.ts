import axios from 'axios'

// AllAnime's API now requires a per-request encrypted "aaReq" token derived from
// a key that's scraped off their homepage, and that scraping scheme has already
// broken multiple times this year. ani-cli itself dropped AllAnime for anidb.app
// on 2026-08-01, so we do the same here instead of chasing a moving target.
const ANIDB_BASE = 'https://anidb.app'
const AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0'

const headers = { 'User-Agent': AGENT }

export interface PlayableSource {
  provider: string
  quality: string
  sourceUrl: string
  isM3U8: boolean
  referrer?: string
}

interface AnidbEpisode {
  id: number
  number: number
}

interface AnidbCard {
  _id: string
  numericId: string
  name: string
  thumbnail: string
  score: number
}

function decodeEntities(str: string): string {
  return str.replace(/&#039;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

function numericIdFromSlug(slug: string): string {
  const match = slug.match(/-(\d+)$/)
  return match ? match[1] : slug
}

async function getEpisodes(numericId: string): Promise<AnidbEpisode[]> {
  try {
    const res = await axios.get(`${ANIDB_BASE}/api/frontend/anime/${numericId}/episodes`, {
      headers
    })
    return res.data?.episodes || []
  } catch (e) {
    return []
  }
}

function parseSearchCards(html: string): AnidbCard[] {
  const chunks = html.split('<a href="https://anidb.app/anime/').slice(1)

  const cards: AnidbCard[] = []
  for (const chunk of chunks) {
    const endIdx = chunk.indexOf('</a>')
    const cardHtml = endIdx >= 0 ? chunk.slice(0, endIdx) : chunk

    const idMatch = cardHtml.match(/^([a-z0-9-]+-(\d+))"/)
    const titleMatch = cardHtml.match(/title="([^"]*)"/)
    const imgMatch = cardHtml.match(/<img src="([^"]*)"/)
    const scoreMatch = cardHtml.match(/<\/svg>\s*([\d.]+)\s*<\/span>/)

    if (!idMatch || !titleMatch) continue

    cards.push({
      _id: idMatch[1],
      numericId: idMatch[2],
      name: decodeEntities(titleMatch[1]),
      thumbnail: imgMatch ? imgMatch[1] : '',
      score: scoreMatch ? parseFloat(scoreMatch[1]) : 0
    })
  }

  return cards
}

export async function searchAnime(query: string) {
  try {
    const res = await axios.get(`${ANIDB_BASE}/browse`, {
      params: { q: query },
      headers
    })

    const cards = parseSearchCards(res.data).slice(0, 20)

    return await Promise.all(
      cards.map(async (card) => {
        const episodes = await getEpisodes(card.numericId)
        const episodeCount = episodes.length
        const lastEpisode = episodeCount ? episodes[episodeCount - 1].number : 0

        return {
          _id: card._id,
          name: card.name,
          thumbnail: card.thumbnail,
          score: card.score,
          episodeCount,
          availableEpisodes: { sub: episodeCount },
          lastEpisodeInfo: { sub: { episodeString: String(lastEpisode) } }
        }
      })
    )
  } catch (e) {
    console.error('could not do query search: ', e)
    return []
  }
}

export async function getEpisodesList(showId: string) {
  try {
    const episodes = await getEpisodes(numericIdFromSlug(showId))
    return episodes
      .map((e) => e.number)
      .sort((a, b) => a - b)
      .map(String)
  } catch (e) {
    console.error('could not fetch episodes: ', e)
    return []
  }
}

export async function getEpisodeData(
  showId: string,
  episodeString: string | number,
  logger?: (msg: string) => void
): Promise<PlayableSource[]> {
  logger!(`getting sources for ${showId}, episode ${episodeString}...`)

  const targetEpisode = Number(episodeString)
  const episodes = await getEpisodes(numericIdFromSlug(showId))
  const episode = episodes.find((e) => e.number === targetEpisode)

  if (!episode) {
    logger!(`episode ${episodeString} not found for ${showId}`)
    return []
  }

  logger!(`resolving stream for episode id ${episode.id}...`)

  try {
    const langRes = await axios.get(`${ANIDB_BASE}/api/frontend/episode/${episode.id}/languages`, {
      headers
    })
    const languages: { code: string; embed_url: string }[] = langRes.data?.languages || []
    const lang = languages.find((l) => l.code === 'jpn') || languages[0]

    if (!lang?.embed_url) {
      logger!(`no embed url found`)
      return []
    }

    const embedRes = await axios.get(lang.embed_url, { headers })
    const match = String(embedRes.data).match(/file:\s*'([^']+)'/)

    if (!match) {
      logger!(`could not extract stream url from embed page`)
      return []
    }

    logger!(`got source`)

    return [
      {
        provider: 'AniDB',
        quality: 'Auto',
        sourceUrl: match[1],
        isM3U8: true
      }
    ]
  } catch (e) {
    logger!(`failed fetching stream, plz tell me and also screenshot the logs`)
    return []
  }
}
