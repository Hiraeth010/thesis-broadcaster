import * as discord from './discord.js'
import * as telegram from './telegram.js'
import * as x from './x.js'

const channels = { discord, telegram, x }

export async function broadcast(trade, targets) {
  const names = targets?.length ? targets : Object.keys(channels)
  const results = {}

  await Promise.all(
    names.map(async (name) => {
      const channel = channels[name]
      if (!channel) {
        results[name] = { ok: false, reason: `unknown channel: ${name}` }
        return
      }
      try {
        results[name] = await channel.send(trade)
      } catch (err) {
        results[name] = { ok: false, reason: err.message }
      }
    })
  )

  return results
}
