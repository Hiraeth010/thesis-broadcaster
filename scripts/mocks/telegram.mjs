import { createServer } from 'node:http'

// Stands in for api.telegram.org, validating requests against the documented
// Bot API contract rather than just accepting anything. Catches wrong method
// names, bad payload shapes, unescaped HTML and missing fields — everything
// short of proving live Telegram accepts it.

const VALID_TOKEN = '7654321098:AAF-mockTokenForLocalVerification_xyz'
const CHANNEL_ID = -1001987654321
let messageId = 1000
const sent = []

const ok = (res, result) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ok: true, result }))
}
const err = (res, code, description) => {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error_code: code, description }))
}

// Telegram only allows these tags in parse_mode=HTML.
const ALLOWED_TAGS = /<\/?(b|i|u|s|a|code|pre|tg-spoiler|blockquote)(\s[^>]*)?>/g

function validateHtml(text) {
  const stripped = text.replace(ALLOWED_TAGS, '')
  // Any angle bracket left over means unescaped user content: real Telegram
  // rejects this with "can't parse entities".
  if (/[<>]/.test(stripped)) return 'unescaped < or > outside allowed tags'
  const opens = [...text.matchAll(/<(b|i|u|s|a|code|pre)(?:\s[^>]*)?>/g)].map((m) => m[1])
  const closes = [...text.matchAll(/<\/(b|i|u|s|a|code|pre)>/g)].map((m) => m[1])
  if (opens.length !== closes.length) return 'unbalanced tags'
  return null
}

createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const m = req.url.match(/^\/bot([^/]+)\/(\w+)$/)
    if (!m) return err(res, 404, 'Not Found')
    const [, token, method] = m

    if (token !== VALID_TOKEN) return err(res, 401, 'Unauthorized')

    const p = body ? JSON.parse(body) : {}

    if (method === 'getUpdates') {
      return ok(res, [
        { update_id: 1, my_chat_member: { chat: { id: CHANNEL_ID, title: 'Alpha Calls', type: 'channel' } } },
        { update_id: 2, channel_post: { chat: { id: CHANNEL_ID, title: 'Alpha Calls', type: 'channel' } } },
      ])
    }

    if (method === 'sendMessage') {
      if (!p.chat_id) return err(res, 400, 'Bad Request: chat_id is empty')
      if (!p.text) return err(res, 400, 'Bad Request: message text is empty')
      if (p.text.length > 4096) return err(res, 400, 'Bad Request: message is too long')
      if (String(p.chat_id) !== String(CHANNEL_ID)) {
        return err(res, 400, 'Bad Request: chat not found')
      }
      if (p.parse_mode === 'HTML') {
        const bad = validateHtml(p.text)
        if (bad) return err(res, 400, `Bad Request: can't parse entities: ${bad}`)
      }
      const id = ++messageId
      sent.push({ id, text: p.text })
      console.log(`[sendMessage] id=${id} parse_mode=${p.parse_mode}\n${p.text}\n---`)
      return ok(res, { message_id: id, chat: { id: CHANNEL_ID }, text: p.text })
    }

    return err(res, 404, `Not Found: method not found (${method})`)
  })
}).listen(3097, () => console.log('mock telegram on :3097'))
