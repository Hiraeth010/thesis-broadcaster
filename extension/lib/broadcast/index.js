import * as discord from './discord.js'
import * as telegram from './telegram.js'
import * as x from './x.js'

const channels = { discord, telegram, x }

/**
 * Posts to every configured channel. `variant` is 'alert' (the trade landed) or
 * 'thesis' (a fresh post carrying the reasoning and the CA). Each call is a new
 * message — nothing is edited in place.
 */
export async function sendAll(settings, trade, variant = 'alert') {
  const results = {}
  await Promise.all(
    Object.entries(channels).map(async ([name, ch]) => {
      try {
        results[name] = await ch.send(settings, trade, variant)
      } catch (err) {
        results[name] = { ok: false, reason: `${name}: ${err.message}` }
      }
    })
  )
  return results
}

export const anyOk = (results) => Object.values(results).some((r) => r.ok)
