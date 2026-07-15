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

/** Posts the initial alert. Returns per-channel results carrying a message ref. */
export async function sendAll(trade) {
  const results = {}
  await Promise.all(
    Object.entries(channels).map(async ([name, ch]) => {
      results[name] = await run(name, () => ch.send(trade))
    })
  )
  return results
}

/**
 * Updates an already-sent alert with the thesis. Channels that were never sent
 * (skipped or failed) get a fresh send instead of an edit.
 */
export async function editAll(trade) {
  const results = {}
  await Promise.all(
    Object.entries(channels).map(async ([name, ch]) => {
      const prior = trade.results?.[name]
      results[name] = prior?.ok
        ? await run(name, () => ch.edit(trade, prior.ref))
        : await run(name, () => ch.send(trade))
    })
  )
  return results
}
