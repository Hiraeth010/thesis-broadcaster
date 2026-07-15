import { TwitterApi } from 'twitter-api-v2'
import { getSettings } from '../settings.js'
import { contractAddress, headline } from './format.js'

const LIMIT = 280

function client() {
  const { x } = getSettings()
  if (!x.apiKey || !x.apiSecret || !x.accessToken || !x.accessSecret) return null
  return new TwitterApi({
    appKey: x.apiKey,
    appSecret: x.apiSecret,
    accessToken: x.accessToken,
    accessSecret: x.accessSecret,
  })
}

/**
 * Builds within X's 280 chars by trimming the thesis rather than the CA — the
 * CA is the actionable part of a thesis post, so it must survive intact.
 */
export function composeX(trade, variant, referralLink) {
  const isThesis = variant === 'thesis'
  const fixed = [headline(trade)]
  if (isThesis) fixed.push(`CA: ${contractAddress(trade)}`)
  if (referralLink) fixed.push(referralLink)

  const fixedText = fixed.join('\n\n')
  const thesis = isThesis ? trade.thesis?.trim() : ''
  if (!thesis) return fixedText.slice(0, LIMIT)

  const room = LIMIT - fixedText.length - 2 // the blank line before the thesis
  if (room < 12) return fixedText.slice(0, LIMIT)

  const body = thesis.length <= room ? thesis : `${thesis.slice(0, room - 1)}…`
  return [fixed[0], body, ...fixed.slice(1)].join('\n\n')
}

export async function send(trade, variant = 'alert') {
  const api = client()
  if (!api) return { ok: false, skipped: true, reason: 'x not configured' }

  const { referralLink } = getSettings()
  try {
    const { data } = await api.v2.tweet(composeX(trade, variant, referralLink))
    return { ok: true, ref: data?.id ?? null }
  } catch (err) {
    return { ok: false, reason: `x: ${err.message}` }
  }
}
