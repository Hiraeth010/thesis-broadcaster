import { contractAddress, headline, referralFor } from '../format.js'

const LIMIT = 280
const ENDPOINT = 'https://api.twitter.com/2/tweets'

// twitter-api-v2 is Node-only, so OAuth 1.0a is signed here with Web Crypto.
// Hand-rolled crypto is exactly where silent bugs live, so signOAuth1 is
// exported and checked against X's own published test vector — see
// tests/oauth1.test.mjs.

function pct(s) {
  return encodeURIComponent(String(s)).replace(
    /[!*'()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  )
}

async function hmacSha1Base64(key, message) {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

export function signatureBaseString(method, url, params) {
  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${pct(k)}=${pct(params[k])}`)
    .join('&')
  return `${method.toUpperCase()}&${pct(url)}&${pct(paramString)}`
}

/**
 * Returns the OAuth 1.0a Authorization header value.
 * `extraParams` covers query/form params; a JSON body is NOT signed, which is
 * why POST /2/tweets only signs the oauth_* set.
 */
export async function signOAuth1({ method, url, creds, oauthParams, extraParams = {} }) {
  const params = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: oauthParams?.nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(oauthParams?.timestamp),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  }

  const base = signatureBaseString(method, url, { ...params, ...extraParams })
  const signingKey = `${pct(creds.apiSecret)}&${pct(creds.accessSecret)}`
  const signature = await hmacSha1Base64(signingKey, base)

  const header = { ...params, oauth_signature: signature }
  const value =
    'OAuth ' +
    Object.keys(header)
      .sort()
      .map((k) => `${pct(k)}="${pct(header[k])}"`)
      .join(', ')

  return { signature, header: value, base }
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

  const room = LIMIT - fixedText.length - 2
  if (room < 12) return fixedText.slice(0, LIMIT)

  const body = thesis.length <= room ? thesis : `${thesis.slice(0, room - 1)}…`
  return [fixed[0], body, ...fixed.slice(1)].join('\n\n')
}

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function send(settings, trade, variant = 'alert') {
  const creds = settings.x
  if (!creds.apiKey || !creds.apiSecret || !creds.accessToken || !creds.accessSecret) {
    return { ok: false, skipped: true, reason: 'x not configured' }
  }

  const text = composeX(trade, variant, referralFor(settings, 'x'))
  const { header } = await signOAuth1({
    method: 'POST',
    url: ENDPOINT,
    creds,
    oauthParams: { nonce: randomNonce(), timestamp: Math.floor(Date.now() / 1000) },
  })

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: header, 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = json?.detail ?? json?.title ?? JSON.stringify(json).slice(0, 160)
      return { ok: false, reason: `x ${res.status}: ${detail}` }
    }
    return { ok: true, ref: json?.data?.id ?? null }
  } catch (err) {
    return { ok: false, reason: `x: ${err.message}` }
  }
}
