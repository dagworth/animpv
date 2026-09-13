import axios from 'axios'
import crypto from 'crypto'

const ALLANIME_API = 'https://api.allanime.day/api'
const ALLANIME_BASE = 'https://allanime.day'
const AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
const REFR = 'https://youtu-chan.com'

// Fallback values from AllAnime's JS build — update when site rotates keys
const FALLBACK_MASK = 'b1a9a4d051988f1b1b12dbb747439d9bd64b09ea17835600a7eaa4de87c1ad87'
const FALLBACK_PART_B = 'k7DLdv5SGiuEyGUtcncl5wQOR7r4aenLfDV3AOBKlAU='
const FALLBACK_EPOCH = 4128
const FALLBACK_QUERY_HASH = 'd405d0edd690624b66baba3068e0edc3ac90f1597d898a1ec8db4e5c43c00fec'

function deriveKey(maskHex: string, partB: string): Buffer {
  const mask = Buffer.from(maskHex, 'hex')
  const secret = Buffer.from(partB, 'base64')
  return Buffer.from(mask.map((b, i) => b ^ secret[i]))
}

let _cryptoCache: { key: Buffer; epoch: number; queryHash: string; expiresAt: number } | null =
  null

async function fetchCrypto(): Promise<{ key: Buffer; epoch: number; queryHash: string }> {
  if (_cryptoCache && _cryptoCache.expiresAt > Date.now()) {
    return _cryptoCache
  }
  try {
    const siteResp = await axios.get('https://allanime.day', {
      headers: { 'User-Agent': AGENT },
      timeout: 8000
    })
    const html: string = siteResp.data
    const aaMatch = html.match(/window\.__aaCrypto\s*=\s*(\{.*?\})/)
    if (!aaMatch) throw new Error('no __aaCrypto')
    const aa = JSON.parse(aaMatch[1])
    const key = deriveKey(FALLBACK_MASK, aa.partB ?? FALLBACK_PART_B)
    const epoch: number = aa.epoch ?? FALLBACK_EPOCH
    const queryHash = FALLBACK_QUERY_HASH
    const expiresAt = Math.max(
      (aa.switchAt ?? 0) + (aa.graceMs ?? 0),
      Date.now() + 3_600_000
    )
    _cryptoCache = { key, epoch, queryHash, expiresAt }
    return { key, epoch, queryHash }
  } catch {
    return {
      key: deriveKey(FALLBACK_MASK, FALLBACK_PART_B),
      epoch: FALLBACK_EPOCH,
      queryHash: FALLBACK_QUERY_HASH
    }
  }
}

export interface PlayableSource {
  provider: string
  quality: string
  sourceUrl: string
  isM3U8: boolean
  referrer?: string
}

function decryptAES(ciphertextB64: string, key: Buffer): string {
  try {
    const buffer = Buffer.from(ciphertextB64, 'base64')
    const iv = buffer.subarray(1, 13)
    const tag = buffer.subarray(buffer.length - 16)
    const ciphertext = buffer.subarray(13, buffer.length - 16)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return decrypted.toString('utf8')
  } catch (e) {
    console.error('AES-GCM Decryption failed:', e)
    return ''
  }
}

function generateAaReq(key: Buffer, epoch: number, queryHash: string): string {
  // ts truncated to 5-minute window in milliseconds, matching AllAnime's protocol
  const ts = Math.floor(Date.now() / 300_000) * 300_000
  const payload = JSON.stringify({ v: 1, ts, epoch, qh: queryHash })
  const iv = crypto.createHash('sha256').update(`${epoch}:${queryHash}:${ts}`).digest().subarray(0, 12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([0x01]), iv, encrypted, tag]).toString('base64')
}

function decodeXorUrl(hexUrl: string): string {
  if (!hexUrl.startsWith('--')) return hexUrl
  const hexStr = hexUrl.slice(2)
  let decoded = ''
  for (let i = 0; i < hexStr.length; i += 2) {
    const hexChar = hexStr.slice(i, i + 2)
    decoded += String.fromCharCode(parseInt(hexChar, 16) ^ 56)
  }
  return decoded.replace(/\/clock$/, '/clock.json')
}

export async function getEpisodeData(
  showId: string,
  episodeString: string | number,
  logger?: (msg: string) => void
): Promise<PlayableSource[]> {
  logger!(`getting sources for ${showId}, episode ${episodeString}...`)

  const epStr = String(episodeString)
  const query_vars = JSON.stringify({ showId, translationType: 'sub', episodeString: epStr })

  const { key, epoch, queryHash } = await fetchCrypto()
  const aaReq = generateAaReq(key, epoch, queryHash)
  const query_ext = JSON.stringify({
    persistedQuery: { version: 1, sha256Hash: queryHash },
    aaReq
  })

  const headers = {
    'User-Agent': AGENT,
    Referer: REFR,
    Origin: REFR
  }

  let responseData: any = null

  logger!(`sending GET request with aaReq token`)
  try {
    const apqUrl = `${ALLANIME_API}?variables=${encodeURIComponent(query_vars)}&extensions=${encodeURIComponent(query_ext)}`
    const getResp = await axios.get(apqUrl, { headers })
    responseData = getResp.data
  } catch (e) {
    logger!(`request failed, screenshot logs and report`)
    return []
  }

  let targetPayload =
    responseData?.data?.tobeparsed ||
    responseData?.data?.episode?.sourceUrls ||
    responseData?.tobeparsed
  let sources: any[] = []

  if (Array.isArray(targetPayload)) {
    sources = targetPayload
  } else if (typeof targetPayload === 'string') {
    const decrypted = decryptAES(targetPayload, key)
    try {
      const cleanStr = decrypted.replace(/\0/g, '')
      const parsed = JSON.parse(cleanStr)
      sources =
        parsed.episode?.sourceUrls || parsed.data?.episode?.sourceUrls || parsed.sourceUrls || []
    } catch (e) {
      logger!(`failed parsing target payload, probably also screenshot and send to me`)
      return []
    }
  }

  logger!(`got ${sources.length} sources`)

  const playableSources: PlayableSource[] = []

  for (const source of sources) {
    logger!(`checking ${source.sourceUrl}`)
    if (!source.sourceUrl) continue

    let sourceName = source.sourceName || 'Unknown'
    let finalUrl = source.sourceUrl

    if (finalUrl.startsWith('--')) {
      finalUrl = decodeXorUrl(finalUrl)
    } else if (finalUrl.includes('tobeparsed=')) {
      finalUrl = decryptAES(finalUrl.split('tobeparsed=')[1], key)
    }

    if (!finalUrl) continue

    //need to do html scraping
    if (finalUrl.includes('mp4upload')) {
      try {
        const embedResponse = await axios.get(finalUrl, {
          headers: { 'User-Agent': AGENT, Referer: REFR }
        })

        //src: "https://.../video.mp4"
        const srcMatch = embedResponse.data.match(/src:\s*["']([^"']+)["']/)

        if (srcMatch && srcMatch[1]) {
          playableSources.push({
            provider: sourceName,
            quality: 'Direct/MP4',
            sourceUrl: srcMatch[1],
            isM3U8: srcMatch[1].includes('.m3u8'),
            referrer: 'https://www.mp4upload.com'
          })
        }
      } catch (err) {
        logger!(`failed to scrape mp4upload`)
      }
      continue
    }

    // i will need to implement yt dlb or let mpv do it
    if (finalUrl.includes('tools.fast4speed.rsvp') || finalUrl.includes('youtube.com')) {
      playableSources.push({
        provider: sourceName,
        quality: 'Adaptive/Stream',
        sourceUrl: finalUrl,
        isM3U8: finalUrl.includes('.m3u8'),
        referrer: REFR
      })
      continue
    }

    try {
      const fullUrl = finalUrl.startsWith('http') ? finalUrl : `https://${ALLANIME_BASE}${finalUrl}`
      const linkResponse = await axios.get(fullUrl, { headers })
      const linksArray =
        linkResponse.data?.links || (Array.isArray(linkResponse.data) ? linkResponse.data : null)

      if (linksArray) {
        for (const stream of linksArray) {
          const isSharepoint = sourceName.toLowerCase().includes('sharepoint')

          playableSources.push({
            provider: sourceName,
            quality: stream.resolutionStr || 'Auto',
            sourceUrl: stream.link,
            isM3U8: stream.link.includes('.m3u8') || !!stream.hls,
            referrer: isSharepoint ? undefined : REFR
          })
        }
      }
    } catch (err: any) {
      logger!(`failed parsing stream for ${sourceName}`)
    }
  }

  return playableSources
}

export async function getEpisodesList(showId: string) {
  const query = `
        query ($showId: String!) {
            show(_id: $showId) {
                availableEpisodesDetail
            }
        }
    `

  const payload = {
    variables: {
      showId: showId
    },
    query: query
  }

  const headers = {
    'Content-Type': 'application/json',
    Referer: 'https://allmanga.to/',
    'User-Agent': AGENT
  }

  try {
    const response = await axios.post('https://api.allanime.day/api', payload, { headers })

    const data = response.data?.data?.show?.availableEpisodesDetail

    if (!data) {
      console.error('No episode data found for showId:', showId)
      return null
    }

    return data.sub
  } catch (e) {
    console.error('could not fetch episodes: ', e)
    return null
  }
}

export async function searchAnime(query: string) {
  const payload = {
    variables: {
      search: {
        // allowUnknown: false,
        // allowAdult: false,
        query: query
      },
      limit: 20,
      page: 1,
      translationType: 'sub',
      countryOrigin: 'ALL'
    },
    extensions: {
      persistedQuery: {
        version: 1,
        sha256Hash: 'a24c500a1b765c68ae1d8dd85174931f661c71369c89b92b88b75a725afc471c'
      }
    }
  }

  const headers = {
    'Content-Type': 'application/json',
    Referer: 'https://allmanga.to/',
    // "Origin": "https://allmanga.to",
    'User-Agent': AGENT
  }

  try {
    const response = await axios.post('https://api.allanime.day/api', payload, { headers })
    return response.data.data.shows.edges
  } catch (e) {
    console.error('could not do query search: ', e)
  }
}
