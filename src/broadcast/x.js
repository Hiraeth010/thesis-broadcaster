import { TwitterApi } from 'twitter-api-v2'
import { getSettings } from '../settings.js'
import { headline, plainText } from './format.js'

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

function clamp(text) {
  return text.length <= LIMIT ? text : `${text.slice(0, LIMIT - 1)}…`
}

export async function send(trade) {
  const api = client()
  if (!api) return { ok: false, skipped: true, reason: 'x not configured' }

  try {
    const { data } = await api.v2.tweet(clamp(plainText(trade)))
    return { ok: true, ref: data?.id ?? null }
  } catch (err) {
    return { ok: false, reason: `x: ${err.message}` }
  }
}

/**
 * X has no edit endpoint on the API, so a thesis added after the fact posts as
 * a reply to the original alert rather than rewriting it.
 */
export async function edit(trade, ref) {
  const api = client()
  if (!api) return { ok: false, skipped: true, reason: 'x not configured' }
  if (!ref) return { ok: false, reason: 'no x post ref to reply to' }
  if (!trade.thesis?.trim()) return { ok: true, ref }

  try {
    const { data } = await api.v2.tweet({
      text: clamp(trade.thesis.trim()),
      reply: { in_reply_to_tweet_id: ref },
    })
    return { ok: true, ref, replyId: data?.id ?? null }
  } catch (err) {
    return { ok: false, reason: `x reply: ${err.message}` }
  }
}

export { headline }
