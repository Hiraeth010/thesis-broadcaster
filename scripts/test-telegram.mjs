import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '../src/paths.js'

/**
 * Verifies the Telegram channel against the documented Bot API contract.
 *
 *   npm run test:telegram            mock — no token needed, no messages sent
 *   npm run test:telegram -- --live  real Telegram; POSTS TO YOUR CHANNEL
 *
 * The mock validates payload shape, HTML escaping and error handling. Only
 * --live proves Telegram itself accepts what we send.
 */
const live = process.argv.includes('--live')

const MOCK_TOKEN = '7654321098:AAF-mockTokenForLocalVerification_xyz'
const MOCK_CHAT = -1001987654321
const MINT = '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump'

const configPath = join(dataDir, 'config.json')
const backup = existsSync(configPath) ? readFileSync(configPath, 'utf8') : null
const restore = () => {
  if (backup) writeFileSync(configPath, backup)
  else rmSync(configPath, { force: true })
}

let mock
if (!live) {
  process.env.TELEGRAM_API_BASE = 'http://localhost:3097'
  mock = spawn(process.execPath, [join(import.meta.dirname, 'mocks', 'telegram.mjs')], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise((r) => setTimeout(r, 1200))
}

// Imported after TELEGRAM_API_BASE is set, since config.js reads it once.
const { send, discoverChatId } = await import('../src/broadcast/telegram.js')
const { getSettings, saveSettings } = await import('../src/settings.js')

const token = live ? getSettings().telegram.botToken : MOCK_TOKEN
const chat = live ? getSettings().telegram.chatId : String(MOCK_CHAT)

if (live && (!token || !chat)) {
  console.error('\n--live needs a bot token and chat id configured in Setup first.\n')
  process.exit(1)
}

const trade = {
  signature: 'sigTelegramTest',
  timestamp: Date.now(),
  side: 'BUY',
  source: 'JUPITER',
  asset: { mint: MINT, amount: 41666.67, symbol: '2qEH…pump' },
  quote: { mint: 'USDC', amount: 250, symbol: 'USDC' },
  price: 0.006,
  thesis: '',
}

let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`) }
}

try {
  console.log(`\nTelegram verification (${live ? 'LIVE — posting to your channel' : 'mock'})`)

  console.log('\n1. discoverChatId finds the channel')
  saveSettings({ telegram: { botToken: token, chatId: '' } })
  const found = await discoverChatId(token)
  check('returns ok', found.ok, found.reason ?? '')
  if (!live) check('finds the channel id', found.chats?.[0]?.id === MOCK_CHAT)

  console.log('\n2. bad token rejected cleanly')
  const bad = await discoverChatId('0000:invalid')
  check('ok=false', !bad.ok)
  check('reason mentions 401', /401/.test(bad.reason ?? ''), bad.reason)

  saveSettings({ telegram: { botToken: token, chatId: chat } })

  console.log('\n3. alert post carries no CA')
  const alert = await send(trade, 'alert')
  check('sent', alert.ok, alert.reason ?? '')
  check('returns a message id', typeof alert.ref === 'number')

  console.log('\n4. thesis post is a NEW message with the CA')
  const thesis = await send({ ...trade, thesis: 'Reflexive floor while the story is being told.' }, 'thesis')
  check('sent', thesis.ok, thesis.reason ?? '')
  check('different message id (not an edit)', thesis.ref !== alert.ref)

  console.log('\n5. HTML-breaking thesis is escaped, not rejected')
  const nasty = { ...trade, thesis: 'shorting <b>everything</b> & "risk" > reward <script>alert(1)</script>' }
  const esc = await send(nasty, 'thesis')
  check('accepted (escaping worked)', esc.ok, esc.reason ?? '')

  if (!live) {
    console.log('\n6. wrong chat id surfaces the real error')
    saveSettings({ telegram: { botToken: token, chatId: '-100999999' } })
    const wrong = await send(trade, 'alert')
    check('ok=false', !wrong.ok)
    check('says chat not found', /chat not found/.test(wrong.reason ?? ''), wrong.reason)
  }

  console.log('\n7. unconfigured telegram is skipped, not failed')
  saveSettings({ telegram: { botToken: null, chatId: '' } })
  const skipped = await send(trade, 'alert')
  check('skipped=true', skipped.skipped === true)

  console.log(`\n${pass} passed, ${fail} failed`)
  if (!live) console.log('mock only — run with --live to prove Telegram accepts it.\n')
  else console.log('')
} finally {
  restore()
  mock?.kill()
}

process.exit(fail ? 1 : 0)
