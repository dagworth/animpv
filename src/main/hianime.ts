import axios from 'axios'

const HIANIME_BASE = 'https://hianime.at'
const SEARCH_API = `${HIANIME_BASE}/search?keyword=`
const EPISODES_API = `${HIANIME_BASE}/api/theme/episode/list/`
const SERVERS_API = `${HIANIME_BASE}/api/theme/episode/servers?episodeId=`
const AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// The embed page ships its player config as base64(json XOR "otaku-embed-v1")
const EMBED_XOR_KEY = 'otaku-embed-v1'
// Only the ZokoAnime embed uses that config blob, the other servers ship different players
const EMBED_SERVER = 'ZokoAnime'

export interface AnimeResult {
  _id: string
  name: string
  thumbnail: string
  type: string
  subEpisodes: number
  dubEpisodes: number
  totalEpisodes: number | null
  ended: boolean
}

export interface PlayableSource {
  provider: string
  quality: string
  sourceUrl: string
  isM3U8: boolean
  referrer?: string
  subtitle?: string
}

// episode number -> internal episode id, per anime. getEpisodeData only gets the
// number over IPC, so the map from listing the episodes is kept around.
const _episodeMaps = new Map<string, Map<string, string>>()

async function hianimeGet(url: string, referrer?: string): Promise<any> {
  const headers: Record<string, string> = { 'User-Agent': AGENT }
  if (referrer) headers.Referer = referrer

  const response = await axios.get(url, { headers, timeout: 15000 })
  if (typeof response.data === 'string' && /<title>Just a moment/i.test(response.data)) {
    throw new Error('Blocked by cloudflare')
  }
  return response.data
}

function firstMatch(haystack: string, pattern: RegExp): string | null {
  const match = haystack.match(pattern)
  return match ? match[1] : null
}

function deobfuscateBlob(blob: string): string {
  const raw = Buffer.from(blob, 'base64')
  const key = Buffer.from(EMBED_XOR_KEY)
  const decoded = Buffer.alloc(raw.length)
  for (let i = 0; i < raw.length; i++) {
    decoded[i] = raw[i] ^ key[i % key.length]
  }
  return decoded.toString('utf8')
}

export async function searchAnime(query: string): Promise<AnimeResult[]> {
  let page: string
  try {
    page = await hianimeGet(`${SEARCH_API}${encodeURIComponent(query)}`)
  } catch (e) {
    console.error('could not do query search: ', e)
    return []
  }

  // the top 10 sidebar repeats the result markup, cut it off before parsing
  const body = page.split('id="main-sidebar"')[0]
  const results: AnimeResult[] = []

  for (const item of body.split('class="flw-item').slice(1)) {
    const href = firstMatch(item, /<h3 class="film-name">\s*<a href="([^"]*)"/)
    const name = firstMatch(item, /<h3 class="film-name">\s*<a[^>]*title="([^"]*)"/)
    if (!href || !name) continue

    // the slug carries the id hianime's episode api wants, e.g. "flcl-1286"
    const id = href.replace(/\/$/, '').split('/').pop()
    if (!id) continue

    const subEpisodes = firstMatch(item, /tick-sub[^>]*>(?:<i[^>]*><\/i>)?\s*([0-9]+)/)
    const dubEpisodes = firstMatch(item, /tick-dub[^>]*>(?:<i[^>]*><\/i>)?\s*([0-9]+)/)
    // tick-eps is only rendered once a show has finished airing
    const totalEpisodes = firstMatch(item, /tick-eps[^>]*>\s*([0-9]+)/)

    results.push({
      _id: id,
      name: name
        .replace(/&#039;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&'),
      thumbnail: firstMatch(item, /<img src="([^"]*)"[^>]*class="film-poster-img"/) || '',
      type: firstMatch(item, /<span class="fdi-item">([^<]*)</) || 'TV',
      subEpisodes: Number(subEpisodes ?? 0),
      dubEpisodes: Number(dubEpisodes ?? 0),
      totalEpisodes: totalEpisodes === null ? null : Number(totalEpisodes),
      ended: totalEpisodes !== null
    })
  }

  return results
}

export async function getEpisodesList(animeId: string): Promise<string[] | null> {
  let data: any
  try {
    data = await hianimeGet(`${EPISODES_API}${animeId.split('-').pop()}`)
  } catch (e) {
    console.error('could not fetch episodes: ', e)
    return null
  }

  const html: string = data?.html
  if (!html) {
    console.error('No episode data found for animeId:', animeId)
    return null
  }

  const episodes = new Map<string, string>()
  // ids from other providers have the same shape, so the slug in the link is checked too
  const item = new RegExp(
    `data-number="([^"]*)"\\s*data-id="([0-9]+)"\\s*href="[^"]*/watch/${animeId}\\?ep=`,
    'g'
  )
  for (const match of html.matchAll(item)) {
    episodes.set(match[1], match[2])
  }

  if (episodes.size === 0) {
    console.error('No episode data found for animeId:', animeId)
    return null
  }

  _episodeMaps.set(animeId, episodes)
  return [...episodes.keys()]
}

async function resolveEpisodeId(animeId: string, episode: string): Promise<string | undefined> {
  if (!_episodeMaps.has(animeId)) {
    await getEpisodesList(animeId)
  }
  return _episodeMaps.get(animeId)?.get(episode)
}

export async function getEpisodeData(
  animeId: string,
  episodeString: string | number,
  logger?: (msg: string) => void,
  mode: 'sub' | 'dub' = 'sub'
): Promise<PlayableSource[]> {
  const log = logger ?? ((): void => {})
  const episode = String(episodeString)
  log(`getting sources for ${animeId}, episode ${episode}...`)

  const episodeId = await resolveEpisodeId(animeId, episode)
  if (!episodeId) {
    log(`no episode id for episode ${episode}`)
    return []
  }

  let servers: string
  try {
    log(`fetching ${mode} servers for episode id ${episodeId}`)
    servers = (await hianimeGet(`${SERVERS_API}${episodeId}`, HIANIME_BASE))?.html
  } catch {
    log(`request failed, screenshot logs and report`)
    return []
  }

  const hash = firstMatch(
    servers ?? '',
    new RegExp(`data-type="${mode}"\\s*data-server-name="${EMBED_SERVER}"\\s*data-hash="([^"]*)"`)
  )
  if (!hash) {
    log(`no ${EMBED_SERVER} embed listed for ${mode}`)
    return []
  }

  const embedUrl = Buffer.from(hash, 'base64').toString('utf8')
  // the stream host only serves the segments to the embed site
  const referrer = embedUrl.replace(/^(https?:\/\/[^/]*).*/, '$1/')

  let config: any
  try {
    log(`reading player config from ${embedUrl}`)
    const embedPage: string = await hianimeGet(embedUrl, HIANIME_BASE)
    const blob = firstMatch(embedPage, /window\.__P="([^"]*)"/)
    if (!blob) throw new Error('no window.__P')
    config = JSON.parse(deobfuscateBlob(blob))
  } catch {
    log(`failed parsing embed config, probably also screenshot and send to me`)
    return []
  }

  const master: string | undefined = config?.src
  if (!master) {
    log(`no stream in player config`)
    return []
  }

  // several languages can be listed, the site marks the english track as default
  const subtitles: any[] = Array.isArray(config.subtitles) ? config.subtitles : []
  const subtitle: string | undefined = (subtitles.find((s) => s.default) ?? subtitles[0])?.src

  let playlist: string
  try {
    playlist = await hianimeGet(master, referrer)
  } catch {
    log(`failed fetching master playlist`)
    return []
  }

  const playableSources: PlayableSource[] = []
  const lines = playlist.split('\n').map((line) => line.trim())

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue
    const variant = lines.slice(i + 1).find((line) => line && !line.startsWith('#'))
    if (!variant) continue

    const height = firstMatch(lines[i], /RESOLUTION=[0-9]+x([0-9]+)/)
    playableSources.push({
      provider: EMBED_SERVER,
      quality: height ? `${height}p` : 'Auto',
      // quality variants are relative to the master playlist
      sourceUrl: /^https?:\/\//.test(variant)
        ? variant
        : `${master.slice(0, master.lastIndexOf('/'))}/${variant}`,
      isM3U8: true,
      referrer,
      subtitle
    })
  }

  const resolution = (source: PlayableSource): number => parseInt(source.quality) || 0
  playableSources.sort((a, b) => resolution(b) - resolution(a))

  // the master playlist itself lets the player do the switching
  playableSources.push({
    provider: EMBED_SERVER,
    quality: 'Adaptive/Stream',
    sourceUrl: master,
    isM3U8: true,
    referrer,
    subtitle
  })

  log(`got ${playableSources.length} sources`)
  return playableSources
}
