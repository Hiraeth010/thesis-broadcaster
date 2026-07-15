import * as discord from './discord.js'
import * as telegram from './telegram.js'
import * as x from './x.js'

const channels = { discord, telegram, x }

async function run(name, fn) {
  try {
    return await fn()
  } catch (err) {
    return { ok: false, reason: `${name}: ${err.message}` }
  }
}

/**
 * Posts to every configured channel. `variant` is 'alert' (the trade landed) or
 * 'thesis' (a fresh post carrying the reasoning and the CA). Each call is a new
 * message — nothing is edited in place.
 */
export async function sendAll(trade, variant = 'alert') {
  const results = {}
  await Promise.all(
    Object.entries(channels).map(async ([name, ch]) => {
      results[name] = await run(name, () => ch.send(trade, variant))
    })
  )
  return results
}
