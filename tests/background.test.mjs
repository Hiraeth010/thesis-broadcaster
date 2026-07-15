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

console.log('\nA new swap alerts automatically\n')
const NEW = 'sigNew2222222222222222222222222222222222222'
rpcSigs = [{ signature: NEW, err: null }]
await send({ type: 'pollNow' })
state = await send({ type: 'getState' })
check('trade recorded', state.trades.length === 1)
check('status alerted', state.trades[0]?.status === 'alerted', state.trades[0]?.status)
check('BUY parsed from the rpc tx', state.trades[0]?.side === 'BUY')
check('alert posted to discord', discordPosts.length === 1)
check('alert carries NO contract address', !discordPosts[0].fields.some((f) => f.name === 'CA'))
check('alert carries the referral link (discord is free)', discordPosts[0].footer?.text === 'https://fomo.family/r/hiraeth')

console.log('\nA thesis from fomo posts separately, with the CA\n')
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
check('a SECOND discord message, not an edit', discordPosts.length === 2)
check('thesis post carries the CA', discordPosts[1].fields.some((f) => f.name === 'CA' && f.value.includes(PUNCH)))
check('thesis text is in the post', discordPosts[1].description === 'Reflexive floor while the story is still being told.')

const r2 = await send(observed)
check('the same thesis twice does not double-post', r2?.broadcast === false && discordPosts.length === 2, JSON.stringify(r2))

const r3 = await send({
  type: 'observed',
  payload: { method: 'POST', url: 'https://abc.prod-edge.fomo.family/v2/profile/bio', body: { body: 'an unrelated bio field long enough to be prose' }, at: Date.now() },
})
check('an unrelated endpoint is ignored', r3?.broadcast === false && discordPosts.length === 2)

console.log('\nSecrets never reach the UI\n')
state = await send({ type: 'getState' })
check('webhook url is blanked', state.settings.discord.webhookUrl === '')
check('but reported as configured', state.settings.configured['discord.webhookUrl'] === true)

await send({ type: 'saveSettings', patch: { discord: { webhookUrl: '' } } })
const after = await send({ type: 'getState' })
check('re-saving blank does not clobber the stored secret', after.settings.configured['discord.webhookUrl'] === true)
check('channels still report discord enabled', after.channels.discord === true)

console.log('\nToken name, clickable CA, and byline\n')

check('headline uses the real symbol, not the mint', discordPosts[0].title.includes('Pnut'), discordPosts[0].title)
check(
  'the token name is shown',
  discordPosts[0].fields.some((f) => f.name === 'Token' && f.value === 'Peanut the Squirrel'),
  JSON.stringify(discordPosts[0].fields)
)
check('the alert links to the chart', discordPosts[0].url.includes('dexscreener.com/solana/' + PUNCH))
check('the tx is still reachable', discordPosts[0].fields.some((f) => f.value.includes('solscan.io/tx/')))

const ca = discordPosts[1].fields.find((f) => f.name === 'CA')
check('the CA is clickable', ca.value.includes('](https://dexscreener.com/solana/' + PUNCH + ')'), ca.value)
check('and still copyable as inline code', ca.value.includes('`' + PUNCH + '`'), ca.value)

await send({ type: 'saveSettings', patch: { fomoUsername: '@hiraeth' } })
rpcSigs = [{ signature: 'sigThird333333333333333333333333333333333', err: null }]
await send({ type: 'pollNow' })
check('posts carry the fomo username', discordPosts.at(-1).author?.name === '@hiraeth', JSON.stringify(discordPosts.at(-1).author))

const { composeX } = await import('../extension/lib/broadcast/x.js')
const xTrade = {
  side: 'BUY',
  asset: { mint: PUNCH, amount: 41666.67, symbol: 'Pnut', name: 'Peanut the Squirrel' },
  quote: { amount: 250, symbol: 'USDC' },
  thesis: 'Reflexive floor.',
}
const xThesis = composeX(xTrade, 'thesis', '', '@hiraeth')
check('X carries the byline', xThesis.includes('@hiraeth'), xThesis)
check('X carries the CA', xThesis.includes(PUNCH))
check('X has NO link — a link costs 13x more', !/https?:\/\//.test(xThesis), xThesis)
check('X still fits 280', xThesis.length <= 280, String(xThesis.length))

console.log('\nLearning posts the thesis you just pointed at\n')
{
  // Reproduces the real report: fomo posts theses to prod-api.fomo.family/trades/comment
  // with the text in `comment`. Previously the thesis used to TEACH it was
  // silently dropped, because matching only fires on the NEXT request.
  await send({ type: 'forget' })
  const before = discordPosts.length

  rpcSigs = [{ signature: 'sigLearn44444444444444444444444444444444', err: null }]
  await send({ type: 'pollNow' })
  check('a fresh trade to attach to', discordPosts.length === before + 1)

  const comment = {
    type: 'observed',
    payload: {
      transport: 'fetch',
      method: 'POST',
      url: 'https://prod-api.fomo.family/trades/comment',
      body: { tradeId: 'abc123', comment: 'Reflexive floor while the story is still being told.' },
      at: Date.now(),
    },
  }
  const seen = await send(comment)
  check('nothing broadcasts before it is taught', seen.broadcast === false)

  const cands = (await send({ type: 'getState' })).candidates
  const c = cands.find((x) => x.pattern === 'prod-api.fomo.family/trades/comment')
  check('the real fomo endpoint is offered as a candidate', Boolean(c), JSON.stringify(cands.map((x) => x.pattern)))
  check('with `comment` as the field', c?.fields?.some((f) => f.path === 'comment'))

  const learned = await send({ type: 'learn', pattern: c.pattern, field: 'comment' })
  check('teaching it ALSO posts that thesis', learned.broadcast === true, JSON.stringify(learned))
  check('a thesis message actually went out', discordPosts.length === before + 2)
  check('and it carries the CA', discordPosts.at(-1).fields.some((f) => f.name === 'CA'))
  check('and the thesis text', discordPosts.at(-1).description?.includes('Reflexive floor'))
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

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
