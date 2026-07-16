// Loads the real service worker with a stubbed chrome API and stubbed network,
// then drives it the way Chrome would. This is as close to running it in the
// browser as we can get without a browser.

const store = new Map()
const alarms = []
const badges = []
let onMessage = null

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const wanted = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys ?? {})
        const out = {}
        for (const k of wanted) if (store.has(k)) out[k] = structuredClone(store.get(k))
        return out
      },
      async set(obj) {
        for (const [k, v] of Object.entries(obj)) store.set(k, structuredClone(v))
      },
    },
  },
  alarms: { async create(name, opts) { alarms.push({ name, opts }) }, onAlarm: { addListener() {} } },
  runtime: {
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener: (fn) => (onMessage = fn) },
  },
  action: {
    async setBadgeText({ text }) { if (text) badges.push(text) },
    async setBadgeBackgroundColor() {},
  },
}

// ---- network stub -----------------------------------------------------------
const WALLET = 'WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const PUNCH = '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump'
const SIG = 'sigLiveTest111111111111111111111111111111111'

const discordPosts = []
let rpcSigs = []
let tokenBalanceFails = false

const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } })

globalThis.fetch = async (url, init) => {
  const u = String(url)
  const body = init?.body ? JSON.parse(init.body) : {}

  if (u.includes('discord.com')) {
    discordPosts.push(body.embeds[0])
    return json({ id: `msg${discordPosts.length}` })
  }
  if (u.includes('lite-api.jup.ag')) return json([{ id: PUNCH, symbol: 'Pnut', name: 'Peanut the Squirrel' }])
  if (u.includes('dexscreener')) return json({ pairs: [] })
  if (body.method === 'getTokenAccountsByOwner') {
    // Deliberately NOT the swap amount: the wallet already held some, so the
    // post must report the balance, not the size of one trade.
    if (tokenBalanceFails) return new Response('gateway', { status: 504 })
    return json({
      result: {
        value: [
          { account: { data: { parsed: { info: { tokenAmount: { uiAmount: 6_000_000 } } } } } },
          { account: { data: { parsed: { info: { tokenAmount: { uiAmount: 250_000 } } } } } },
        ],
      },
    })
  }
  if (body.method === 'getSignaturesForAddress') return json({ result: rpcSigs })
  if (body.method === 'getSlot') return json({ result: 123456 })
  if (body.method === 'getTransaction') {
    return json({
      result: {
        blockTime: 1784000000,
        meta: {
          err: null,
          preBalances: [1_000_000_000], postBalances: [999_000_000],
          preTokenBalances: [
            { owner: WALLET, mint: USDC, uiTokenAmount: { uiAmount: 500 } },
            { owner: WALLET, mint: PUNCH, uiTokenAmount: { uiAmount: 0 } },
          ],
          postTokenBalances: [
            { owner: WALLET, mint: USDC, uiTokenAmount: { uiAmount: 250 } },
            { owner: WALLET, mint: PUNCH, uiTokenAmount: { uiAmount: 41666.67 } },
          ],
        },
        transaction: { message: { accountKeys: [{ pubkey: WALLET }] }, signatures: [SIG] },
      },
    })
  }
  throw new Error('unexpected fetch: ' + u)
}

await import('../extension/background.js')

const send = (msg) => new Promise((resolve) => onMessage(msg, {}, resolve))

let pass = 0
let fail = 0
const check = (n, c, d = '') => {
  if (c) { pass++; console.log(`  PASS  ${n}`) } else { fail++; console.log(`  FAIL  ${n} ${d}`) }
}

console.log('\nService worker, driven as Chrome would\n')

check('registers a message handler on load', typeof onMessage === 'function')

await send({
  type: 'saveSettings',
  patch: { wallet: WALLET, discord: { webhookUrl: 'https://discord.com/api/webhooks/1/abc' }, referralLink: 'https://fomo.family/r/hiraeth' },
})
check('an alarm is scheduled on save', alarms.some((a) => a.name === 'poll'))
check('alarm respects Chrome\'s 1-minute floor', alarms.at(-1).opts.periodInMinutes >= 1)

console.log('\nFirst poll baselines instead of backfilling\n')
rpcSigs = [{ signature: SIG, err: null }]
await send({ type: 'pollNow' })
let state = await send({ type: 'getState' })
check('no trades broadcast on first sight of a wallet', state.trades.length === 0)
check('nothing posted to discord', discordPosts.length === 0)

console.log('\nA swap is recorded but NEVER announced\n')
// Your trades are your business. Chain data is read only so a thesis can carry
// the token, amount and CA — a swap on its own must never reach a channel.
const NEW = 'sigNew2222222222222222222222222222222222222'
rpcSigs = [{ signature: NEW, err: null }]
await send({ type: 'pollNow' })
state = await send({ type: 'getState' })
check('trade recorded', state.trades.length === 1)
check('but left queued, not alerted', state.trades[0]?.status === 'queued', state.trades[0]?.status)
check('BUY parsed from the rpc tx', state.trades[0]?.side === 'BUY')
check('NOTHING was posted to discord', discordPosts.length === 0, `${discordPosts.length} posts`)

console.log('\nA thesis from fomo is the only thing that posts\n')
await send({ type: 'learn', pattern: 'abc.prod-edge.fomo.family/v2/trades/*/thesis', field: 'body' })
const observed = {
  type: 'observed',
  payload: {
    method: 'POST',
    url: 'https://abc.prod-edge.fomo.family/v2/trades/9f2a1b3c4d5e/thesis',
    body: { mint: PUNCH, body: 'Reflexive floor while the story is still being told.' },
    at: Date.now(),
  },
}
const r1 = await send(observed)
check('broadcast fired', r1?.broadcast === true, JSON.stringify(r1))
// The thesis is the FIRST message, because the swap itself sent nothing.
check('exactly one message, the thesis', discordPosts.length === 1, `${discordPosts.length} posts`)
check('thesis post carries the CA', discordPosts[0].fields.some((f) => f.name === 'CA' && f.value.includes(PUNCH)))
check('thesis text is in the post', discordPosts[0].description === 'Reflexive floor while the story is still being told.')
check('and the trade context that only chain data could give it', discordPosts[0].title.includes('Pnut'), discordPosts[0].title)

const r2 = await send(observed)
check('the same thesis twice does not double-post', r2?.broadcast === false && discordPosts.length === 1, JSON.stringify(r2))

const r3 = await send({
  type: 'observed',
  payload: { method: 'POST', url: 'https://abc.prod-edge.fomo.family/v2/profile/bio', body: { body: 'an unrelated bio field long enough to be prose' }, at: Date.now() },
})
check('an unrelated endpoint is ignored', r3?.broadcast === false && discordPosts.length === 1)

console.log('\nSecrets never reach the UI\n')
state = await send({ type: 'getState' })
check('webhook url is blanked', state.settings.discord.webhookUrl === '')
check('but reported as configured', state.settings.configured['discord.webhookUrl'] === true)

await send({ type: 'saveSettings', patch: { discord: { webhookUrl: '' } } })
const after = await send({ type: 'getState' })
check('re-saving blank does not clobber the stored secret', after.settings.configured['discord.webhookUrl'] === true)
check('channels still report discord enabled', after.channels.discord === true)

console.log('\nToken name, clickable CA, and byline\n')

const post = discordPosts[0]
check('headline uses the real symbol, not the mint', post.title.includes('Pnut'), post.title)
// The swap was 41,666.67 Pnut, but the wallet holds 6,250,000 across two token
// accounts. The post must report what's held, not what was traded.
check('headline reports HOLDINGS, not the trade size', post.title === 'Holding 6,250,000 Pnut', post.title)
check(
  'the token name is shown',
  post.fields.some((f) => f.name === 'Token' && f.value === 'Peanut the Squirrel'),
  JSON.stringify(post.fields)
)
check('the post links to fomo\'s own chart', post.url === 'https://fomo.family/tokens/solana/' + PUNCH, post.url)
check('no tx link anywhere', !JSON.stringify(post).includes('solscan.io'))
check('no dollar amounts', !JSON.stringify(post).includes('USDC'), JSON.stringify(post.fields))
check('no Bought/Sold', !/Bought|Sold/.test(JSON.stringify(post)))

const ca = post.fields.find((f) => f.name === 'CA')
check('the CA links to the fomo chart', ca.value.includes('](https://fomo.family/tokens/solana/' + PUNCH + ')'), ca.value)
check('and still copyable as inline code', ca.value.includes('`' + PUNCH + '`'), ca.value)

// A poll can't be used to trigger a post any more — only a thesis can.
await send({ type: 'saveSettings', patch: { fomoUsername: '@Hiraethh' } })
await send({
  type: 'observed',
  payload: {
    method: 'POST',
    url: 'https://abc.prod-edge.fomo.family/v2/trades/9f2a1b3c4d5e/thesis',
    body: { mint: PUNCH, body: 'Adding here, byline should show now.' },
    at: Date.now(),
  },
})
check('posts carry the fomo username', discordPosts.at(-1).author?.name === '@Hiraethh', JSON.stringify(discordPosts.at(-1).author))
check(
  'and the handle links to the fomo profile',
  discordPosts.at(-1).author?.url === 'https://fomo.family/profile/Hiraethh',
  JSON.stringify(discordPosts.at(-1).author)
)

const { composeX } = await import('../extension/lib/broadcast/x.js')
const xTrade = {
  side: 'BUY',
  asset: { mint: PUNCH, amount: 41666.67, symbol: 'Pnut', name: 'Peanut the Squirrel' },
  quote: { amount: 250, symbol: 'USDC' },
  thesis: 'Reflexive floor.',
}
const xThesis = composeX(xTrade, 'thesis', '', '@Hiraethh')
check('X carries the byline', xThesis.includes('@Hiraethh'), xThesis)
check('X carries the CA', xThesis.includes(PUNCH))
check('X has NO link — a link costs 13x more', !/https?:\/\//.test(xThesis), xThesis)
check('X still fits 280', xThesis.length <= 280, String(xThesis.length))

console.log('\nIt works out of the box — nothing to pick\n')
{
  // fomo's endpoint is known, so a fresh install must broadcast a thesis with
  // no setup at all. Making people pick it from a list was busywork.
  store.delete('settings')
  store.delete('trades')
  store.delete('cursor')
  await send({
    type: 'saveSettings',
    patch: { wallet: WALLET, discord: { webhookUrl: 'https://discord.com/api/webhooks/1/abc' } },
  })

  const fresh = await send({ type: 'getState' })
  check('a fresh install is already pointed at fomo', fresh.settings.learn.pattern === 'prod-api.fomo.family/trades/comment', JSON.stringify(fresh.settings.learn))
  check('with the right field', fresh.settings.learn.field === 'comment')

  // First poll only baselines, so a second one is needed to actually record a
  // trade for the thesis to attach to.
  rpcSigs = [{ signature: 'sigBaseline55555555555555555555555555555', err: null }]
  await send({ type: 'pollNow' })
  rpcSigs = [{ signature: 'sigDefault5555555555555555555555555555555', err: null }]
  await send({ type: 'pollNow' })
  const before = discordPosts.length
  check('a trade exists to attach a thesis to', (await send({ type: 'getState' })).trades.length === 1)

  const r = await send({
    type: 'observed',
    payload: {
      transport: 'fetch', method: 'POST',
      url: 'https://prod-api.fomo.family/trades/comment',
      body: { tradeId: 'abc123', comment: 'Zero setup: this should just post.', visibility: 'public' },
      at: Date.now(),
    },
  })
  check('a thesis broadcasts with NO picking whatsoever', r.broadcast === true, JSON.stringify(r))
  check('the message went out', discordPosts.length === before + 1)

  // Someone who hit "Forget" on an older build has an empty pattern stored.
  await send({ type: 'saveSettings', patch: { learn: { pattern: '', field: '' } } })
  const healed = await send({ type: 'getState' })
  check('an empty stored pattern falls back to the default', healed.settings.learn.pattern === 'prod-api.fomo.family/trades/comment', JSON.stringify(healed.settings.learn))

  // Reset restores the default rather than leaving it disconnected.
  await send({ type: 'forget' })
  const afterForget = await send({ type: 'getState' })
  check('reset returns to fomo\'s endpoint, not to nothing', afterForget.settings.learn.pattern === 'prod-api.fomo.family/trades/comment')
}

console.log('\nThe picker still works if fomo ever changes the endpoint\n')
{
  // The default covers today's fomo. This is the fallback: if they move the
  // thesis somewhere else, that request won't match, and picking it must both
  // learn it AND post the thesis that taught it — otherwise the first thesis
  // you write after a fomo change is silently lost.
  const before = discordPosts.length

  rpcSigs = [{ signature: 'sigLearn44444444444444444444444444444444', err: null }]
  await send({ type: 'pollNow' })
  // Recorded silently — the poll itself must post nothing.
  check('a fresh trade to attach to, with no message sent', discordPosts.length === before)

  const moved = {
    type: 'observed',
    payload: {
      transport: 'fetch',
      method: 'POST',
      url: 'https://prod-api.fomo.family/v3/thesis/create',
      body: { tradeId: 'abc123', text: 'fomo moved the endpoint and this still works.' },
      at: Date.now(),
    },
  }
  const seen = await send(moved)
  check('an unknown endpoint does not match the default', seen.broadcast === false, JSON.stringify(seen))

  const cands = (await send({ type: 'getState' })).candidates
  const c = cands.find((x) => x.pattern === 'prod-api.fomo.family/v3/thesis/create')
  check('the moved endpoint is offered as a candidate', Boolean(c), JSON.stringify(cands.map((x) => x.pattern)))
  check('with its prose field found', c?.fields?.some((f) => f.path === 'text'))

  const learned = await send({ type: 'learn', pattern: c.pattern, field: 'text' })
  check('picking it ALSO posts that thesis', learned.broadcast === true, JSON.stringify(learned))
  check('a thesis message actually went out', discordPosts.length === before + 1)
  check('and it carries the CA', discordPosts.at(-1).fields.some((f) => f.name === 'CA'))
  check('and the thesis text', discordPosts.at(-1).description?.includes('fomo moved the endpoint'))

  // Back to the default so later blocks start from the shipped behaviour.
  await send({ type: 'forget' })
}

console.log('\nOld trades stored with a short mint get healed\n')
{
  const trades = await send({ type: 'getState' })
  const id = trades.trades[0].id
  // simulate a trade stored before token resolution existed
  store.set(
    'trades',
    store.get('trades').map((t) => (t.id === id ? { ...t, asset: { ...t.asset, symbol: '2qEH…pump', name: '2qEH…pump' }, thesis: '' } : t))
  )
  const before = discordPosts.length
  const r = await send({ type: 'postThesis', id, thesis: 'healing check, long enough to be prose' })
  check('posted', r.ok === true, JSON.stringify(r))
  check('the short mint was re-resolved before posting', discordPosts.at(-1).title.includes('Pnut'), discordPosts.at(-1).title)
  check('not left as the raw mint', !discordPosts.at(-1).title.includes('…pump'), discordPosts.at(-1).title)
  check('one message sent', discordPosts.length === before + 1)
}

console.log('\nA second thesis on the same trade still posts\n')
{
  // The reported bug: matching only considered trades with NO thesis yet, so
  // once a trade had one, every later thesis silently attached to some older
  // trade or to nothing. Re-posting could never work.
  const before = discordPosts.length
  const post = (text) =>
    send({
      type: 'observed',
      payload: {
        transport: 'fetch',
        method: 'POST',
        url: 'https://prod-api.fomo.family/trades/comment',
        body: { tradeId: 'abc123', comment: text },
        at: Date.now(),
      },
    })

  const first = await post('First thesis about the trade I just made.')
  check('first thesis posts', first.broadcast === true, JSON.stringify(first))

  const second = await post('Revised call: adding here, same thesis.')
  check('a SECOND, different thesis on the same trade also posts', second.broadcast === true, JSON.stringify(second))
  check('two separate messages went out', discordPosts.length === before + 2)

  const dupe = await post('Revised call: adding here, same thesis.')
  check('but the identical text is still deduped', dupe.broadcast === false, JSON.stringify(dupe))
  check('no third message', discordPosts.length === before + 2)
}

console.log('\nA thesis still posts when the balance cannot be read\n')
{
  // The balance is a nice-to-have. If the RPC is down, the thesis must still go
  // out — just without the "Holding …" line, rather than not at all.
  tokenBalanceFails = true
  const before = discordPosts.length
  rpcSigs = [{ signature: 'sigNoBal666666666666666666666666666666666', err: null }]
  await send({ type: 'pollNow' })

  const r = await send({
    type: 'observed',
    payload: {
      method: 'POST',
      url: 'https://prod-api.fomo.family/trades/comment',
      body: { tradeId: 'zz', comment: 'Balance lookup is down but this must still post.' },
      at: Date.now(),
    },
  })
  check('the thesis still went out', r.broadcast === true, JSON.stringify(r))
  check('a message was sent', discordPosts.length === before + 1)
  check('headline degrades to the token alone', discordPosts.at(-1).title === 'Pnut', discordPosts.at(-1).title)
  check('no fabricated holding number', !/Holding/.test(discordPosts.at(-1).title))
  check('the thesis text is intact', discordPosts.at(-1).description?.includes('must still post'))
  tokenBalanceFails = false
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
