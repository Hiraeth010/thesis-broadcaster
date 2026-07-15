import { config } from '../config.js'
import { plainText } from './format.js'

// X posting needs OAuth 1.0a request signing and a paid Basic tier (~$100/mo
// for ~3k posts). Deliberately left unimplemented until the Discord/Telegram
// path is proven — wire in `twitter-api-v2` here when the tier is paid for.
export async function send(trade) {
  if (!config.x.apiKey || !config.x.accessToken) {
    return { ok: false, skipped: true, reason: 'X credentials not set' }
  }

  return {
    ok: false,
    skipped: true,
    reason: 'X posting not implemented yet — needs paid Basic tier + OAuth 1.0a signing',
    preview: plainText(trade).slice(0, 280),
  }
}
