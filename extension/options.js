const list = document.getElementById('list')
const channelsEl = document.getElementById('channels')
const setupBody = document.getElementById('setup-body')
const statusCard = document.getElementById('statusCard')

let lastKey = ''
let lastStatusKey = ''
let settingsRendered = false

const send = (type, payload = {}) => chrome.runtime.sendMessage({ type, ...payload })

const fmt = (n) =>
  !Number.isFinite(n) || n === 0 ? '0'
  : Math.abs(n) < 0.0001 ? n.toExponential(2)
  : n.toLocaleString('en-US', { maximumSignificantDigits: 6 })

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function ago(ts) {
  if (!ts) return 'never'
  const s = Math.round((Date.now() - ts) / 1000)
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`
}

// ---- setup ------------------------------------------------------------------

// Secret fields are never populated with the real value. A blank box on a
// configured secret means "leave it alone", so nothing can round-trip a display
// value back over the stored one.
function field(id, label, value, { type = 'text', hint, isSet, placeholder = '' } = {}) {
  const secret = type === 'password'
  const ph = secret && isSet ? 'configured — leave blank to keep' : placeholder
  return `
    <label for="${id}">${label}${secret && isSet ? ' <span class="ok">✓</span>' : ''}</label>
    <input id="${id}" type="${type}" value="${secret ? '' : esc(value)}" placeholder="${esc(ph)}" />
    ${hint ? `<div class="hint">${hint}</div>` : ''}
  `
}

function renderSetup(s, DEFAULT_RPC) {
  const set = s.configured ?? {}
  setupBody.innerHTML = `
    ${field('wallet', 'Your wallet address', s.wallet, {
      hint: 'Swaps from this wallet trigger a broadcast.',
    })}
    ${field('fomoUsername', 'Your fomo username (optional)', s.fomoUsername, {
      hint: 'Shown on every post so people know whose call it is. Just your handle.',
    })}
    ${field('referralLink', 'Referral link', s.referralLink)}
    <div class="switch" style="gap:14px; flex-wrap:wrap">
      <span class="hint" style="margin:0">add it to:</span>
      <label style="margin:0"><input type="checkbox" id="ref.discord" ${s.referralChannels?.discord ? 'checked' : ''} /> Discord</label>
      <label style="margin:0"><input type="checkbox" id="ref.telegram" ${s.referralChannels?.telegram ? 'checked' : ''} /> Telegram</label>
      <label style="margin:0"><input type="checkbox" id="ref.x" ${s.referralChannels?.x ? 'checked' : ''} /> X <span class="bad">(+$0.185/post)</span></label>
    </div>
    <div class="hint">
      Free on Discord and Telegram. On X a post with a link costs $0.200 instead of
      $0.015, so it's off there by default.
    </div>

    <details style="margin-top:14px">
      <summary>Solana connection</summary>
      ${field('rpcUrl', 'RPC endpoint', s.rpcUrl, {
        placeholder: DEFAULT_RPC,
        hint: `Blank uses the public default (${DEFAULT_RPC}). Paste your own Helius/QuickNode/Triton URL here to use it instead.`,
      })}
      ${field('heliusApiKey', 'Helius API key', s.heliusApiKey, {
        type: 'password', isSet: set['heliusApiKey'],
        hint: 'Alternative to a full URL — a free key from helius.dev. Ignored if an RPC endpoint is set above.',
      })}
      ${field('pollMinutes', 'Check every (minutes)', s.pollMinutes, {
        hint: "Chrome won't allow less than 1.",
      })}
      <div class="hint">
        <span class="bad">Not api.mainnet-beta.solana.com</span> — it refuses browser
        extensions with a 403.
      </div>
    </details>

    <label>Discord</label>
    ${field('discord.webhookUrl', 'Webhook URL', s.discord.webhookUrl, {
      type: 'password', isSet: set['discord.webhookUrl'],
      hint: 'Server Settings → Integrations → Webhooks → New Webhook',
    })}

    <label>Telegram</label>
    <div class="grid">
      <div>${field('telegram.botToken', 'Bot token', s.telegram.botToken, {
        type: 'password', isSet: set['telegram.botToken'], hint: 'From @BotFather',
      })}</div>
      <div>${field('telegram.chatId', 'Chat id', s.telegram.chatId, {
        hint: 'Add the bot to your channel as admin, post once, then Find.',
      })}</div>
    </div>
    <div class="actions">
      <button id="discover">Find my channels</button>
      <span class="status" id="discover-status"></span>
    </div>

    <details style="margin-top:14px">
      <summary>X — optional, and it costs money</summary>
      <div class="hint" style="margin:8px 0 4px">
        <span class="bad">X has no free tier since Feb 2026.</span> It bills per post:
        <b>$0.015</b>, or <b>$0.200</b> if the post contains a link — roughly
        <b>$0.03–$0.40 per trade</b> once the alert and thesis both go out.
        Discord and Telegram are free; most people should just use those.
        Bring your own app from developer.x.com, so the bill is yours.
      </div>
      <div class="grid">
        <div>${field('x.apiKey', 'API key', s.x.apiKey, { type: 'password', isSet: set['x.apiKey'] })}</div>
        <div>${field('x.apiSecret', 'API secret', s.x.apiSecret, { type: 'password', isSet: set['x.apiSecret'] })}</div>
        <div>${field('x.accessToken', 'Access token', s.x.accessToken, { type: 'password', isSet: set['x.accessToken'] })}</div>
        <div>${field('x.accessSecret', 'Access secret', s.x.accessSecret, { type: 'password', isSet: set['x.accessSecret'] })}</div>
      </div>
    </details>

    <div class="actions">
      <button class="primary" id="save">Save</button>
      <span class="status" id="save-status"></span>
    </div>
  `

  const get = (id) => setupBody.querySelector(`#${CSS.escape(id)}`)

  setupBody.querySelector('#save').onclick = async () => {
    const status = setupBody.querySelector('#save-status')
    status.textContent = 'saving…'

    // A custom RPC host isn't in host_permissions, so the service worker's fetch
    // would be CORS-blocked. Ask for it here, while we still have the click.
    const custom = get('rpcUrl').value.trim()
    if (custom) {
      try {
        const origin = new URL(custom).origin + '/*'
        const granted = await chrome.permissions.request({ origins: [origin] })
        if (!granted) {
          status.innerHTML = `<span class="bad">need permission for ${esc(origin)} to use that RPC</span>`
          return
        }
      } catch {
        status.innerHTML = `<span class="bad">that RPC URL doesn't look valid</span>`
        return
      }
    }
    // Blank secret box = unchanged (background ignores ''), so a saved key is
    // never clobbered by re-saving the form.
    await send('saveSettings', {
      patch: {
        wallet: get('wallet').value.trim(),
        fomoUsername: get('fomoUsername').value.trim(),
        referralLink: get('referralLink').value.trim(),
        referralChannels: {
          discord: get('ref.discord').checked,
          telegram: get('ref.telegram').checked,
          x: get('ref.x').checked,
        },
        heliusApiKey: get('heliusApiKey').value.trim(),
        rpcUrl: get('rpcUrl').value.trim(),
        pollMinutes: Number(get('pollMinutes').value) || 1,
        discord: { webhookUrl: get('discord.webhookUrl').value.trim() },
        telegram: {
          botToken: get('telegram.botToken').value.trim(),
          chatId: get('telegram.chatId').value.trim(),
        },
        x: {
          apiKey: get('x.apiKey').value.trim(),
          apiSecret: get('x.apiSecret').value.trim(),
          accessToken: get('x.accessToken').value.trim(),
          accessSecret: get('x.accessSecret').value.trim(),
        },
      },
    })
    status.textContent = 'saved'
    settingsRendered = false
    load({ force: true })
  }

  setupBody.querySelector('#discover').onclick = async () => {
    const status = setupBody.querySelector('#discover-status')
    status.textContent = 'looking…'
    const token = get('telegram.botToken').value.trim()
    const r = await send('discoverChat', { botToken: token })
    if (!r?.ok) return void (status.textContent = r?.reason ?? 'failed')
    if (!r.chats?.length) return void (status.textContent = 'no chats seen — post in the channel first')
    get('telegram.chatId').value = r.chats[0].id
    status.textContent = `found ${r.chats.map((c) => c.title).join(', ')}`
  }

  settingsRendered = true
}

// ---- status -----------------------------------------------------------------

function renderStatus(state, { force = false } = {}) {
  const { status, settings } = state

  if (!settings.wallet) {
    statusCard.innerHTML = `
      <div class="row"><span class="tag sell">NOT WATCHING</span>
        <span class="title">Add your wallet address below to start</span></div>
      <div class="meta">Nothing will broadcast until a wallet is set.</div>`
    lastStatusKey = 'unset'
    return
  }

  const bad = Boolean(status.lastError)
  const learned = settings.learn?.pattern

  // Only rebuild on meaningful change; the "checked Xs ago" label updates in
  // place so a refresh can't fight the user.
  const key = [settings.wallet, status.lastError, learned].join('|')
  if (!force && key === lastStatusKey) {
    const el = statusCard.querySelector('#pollAgo')
    if (el) el.textContent = `checked ${ago(status.lastPollAt)}`
    return
  }
  lastStatusKey = key

  statusCard.innerHTML = `
    <div class="row">
      <span class="tag ${bad ? 'sell' : 'buy'}">${bad ? 'ERROR' : 'WATCHING'}</span>
      <span class="title">${settings.wallet.slice(0, 6)}…${settings.wallet.slice(-4)}</span>
      <span class="status" id="pollAgo">checked ${ago(status.lastPollAt)}</span>
    </div>
    <div class="meta">
      ${bad ? `<span class="bad">${esc(status.lastError)}</span>` : `rpc ${esc(status.rpc)}`}
    </div>
    <div class="meta">
      thesis from fomo:
      ${learned ? '<span class="ok">connected</span>' : '<span class="muted">not set up — see the extension popup on fomo</span>'}
    </div>
    <div class="actions">
      <button id="testRpc">Test connection</button>
      <button id="pollNow">Check now</button>
      <span class="status" id="rpcStatus"></span>
    </div>`

  statusCard.querySelector('#testRpc').onclick = async () => {
    const el = statusCard.querySelector('#rpcStatus')
    el.textContent = 'checking…'
    const r = await send('checkRpc')
    el.innerHTML = r?.ok
      ? `<span class="ok">connected — slot ${r.slot} in ${r.ms}ms</span>`
      : `<span class="bad">${esc(r?.reason)}</span>`
  }
  statusCard.querySelector('#pollNow').onclick = async () => {
    const el = statusCard.querySelector('#rpcStatus')
    el.textContent = 'checking…'
    await send('pollNow')
    el.textContent = 'done'
    load({ force: true })
  }
}

// ---- trades -----------------------------------------------------------------

function resultLine(results) {
  if (!results) return ''
  return Object.entries(results)
    .map(([k, v]) => {
      const cls = v.ok ? 'ok' : v.skipped ? '' : 'bad'
      const word = v.ok ? 'sent' : v.skipped ? 'off' : 'failed'
      return `<span class="${cls}">${k}: ${word}</span>`
    })
    .join(' · ')
}

/**
 * A thesis that went out — what you wrote, on what, and where it landed. Trades
 * without a thesis aren't shown: nothing was broadcast, so there's nothing to
 * report.
 */
function render(t) {
  const el = document.createElement('div')
  el.className = 'card'
  const verb = t.side === 'BUY' ? 'Bought' : 'Sold'
  const failed = t.status === 'failed'

  el.innerHTML = `
    <div class="row">
      <span class="tag ${failed ? 'sell' : 'buy'}">${failed ? 'FAILED' : 'POSTED'}</span>
      <span class="title">${esc(t.asset.symbol)}</span>
      <span class="status">${t.enrichedAt ? new Date(t.enrichedAt).toLocaleString() : ''}</span>
    </div>
    <div class="quote">${esc(t.thesis)}</div>
    <div class="meta">
      ${verb} ${fmt(t.asset.amount)} ${esc(t.asset.symbol)} for ${fmt(t.quote.amount)} ${esc(t.quote.symbol)} ·
      <a href="https://dexscreener.com/solana/${esc(t.asset.mint)}" target="_blank" rel="noreferrer">chart</a> ·
      <a href="https://solscan.io/tx/${esc(t.signature)}" target="_blank" rel="noreferrer">tx</a>
    </div>
    ${t.thesisResults ? `<div class="meta">${t.thesisPosts > 1 ? `sent ×${t.thesisPosts} — ` : ''}${resultLine(t.thesisResults)}</div>` : ''}
  `

  // Only offered when something actually failed — a retry button on a delivered
  // post is just an invitation to spam the channel twice.
  if (!failed) return el

  const actions = document.createElement('div')
  actions.className = 'actions'
  const retry = document.createElement('button')
  retry.className = 'primary'
  retry.textContent = 'Retry'
  const status = document.createElement('span')
  status.className = 'status'

  retry.onclick = async () => {
    retry.disabled = true
    status.textContent = 'sending…'
    const r = await send('postThesis', { id: t.id, thesis: t.thesis })
    if (r?.error) {
      status.textContent = r.error
      retry.disabled = false
      return
    }
    load({ force: true })
  }

  actions.append(retry, status)
  el.append(actions)
  return el
}

// ---- main -------------------------------------------------------------------

async function load({ force = false } = {}) {
  const state = await send('getState')
  if (!state) return

  const on = Object.entries(state.channels).filter(([, v]) => v).map(([k]) => k)
  channelsEl.textContent = on.length ? `channels: ${on.join(', ')}` : 'no channels configured'

  if (!settingsRendered) renderSetup(state.settings, state.defaultRpc)
  renderStatus(state, { force })

  // Only trades with a thesis. A swap on its own is never broadcast, so it has
  // no place in a list of what went out.
  const theses = state.trades.filter((t) => t.thesis?.trim() && t.status !== 'dismissed')

  const key = theses.map((t) => `${t.id}:${t.status}:${t.thesisPosts ?? 0}`).join('|')
  if (!force && key === lastKey) return
  lastKey = key

  if (!theses.length) {
    list.innerHTML = `<div class="empty">
      Nothing broadcast yet.<br />
      Write a thesis on fomo and it appears here.
    </div>`
    return
  }
  list.innerHTML = ''
  for (const t of theses) list.append(render(t))
}

load()
setInterval(load, 5000)
