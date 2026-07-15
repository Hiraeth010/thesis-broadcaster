const state = document.getElementById('state')
const body = document.getElementById('body')

const send = (type, payload = {}) => chrome.runtime.sendMessage({ type, ...payload })
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function load() {
  const s = await send('getState')
  if (!s) {
    state.innerHTML = `<span class="bad">Couldn't reach the extension.</span> Try reloading it.`
    return
  }

  const learned = s.settings.learn?.pattern
  const openOptions = `<button id="opts">Open dashboard</button>`

  if (!s.settings.wallet) {
    state.innerHTML = `<span class="bad">No wallet set.</span> Nothing is being watched.`
    body.innerHTML = openOptions
    wire()
    return
  }

  if (learned) {
    state.innerHTML = `<span class="ok">Connected.</span> Theses you post on fomo broadcast automatically.`
    body.innerHTML = `
      <div class="card">
        <div class="path">${esc(learned)}</div>
        <div class="path">field: ${esc(s.settings.learn.field)}</div>
      </div>
      <div class="row">
        ${openOptions}
        <button id="forget">Forget and relearn</button>
      </div>
      <div class="sub" style="margin-top:8px">Use relearn if fomo changes and theses stop going out.</div>`
    wire()
    return
  }

  state.innerHTML = `Not connected to fomo yet. Post a thesis on fomo, then pick it below.`

  const candidates = s.candidates ?? []
  const seen = s.seen ?? { total: 0, json: 0, byTransport: {}, recent: [] }

  if (!candidates.length) {
    // "Nothing yet" is useless on its own — it looks the same whether the hook
    // never ran or fomo simply doesn't send a thesis in a shape we can read.
    const transports = Object.entries(seen.byTransport ?? {})
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')

    body.innerHTML =
      seen.total === 0
        ? `<div class="card">
             <div class="bad">Nothing seen from fomo at all.</div>
             <div class="sub" style="margin-top:6px">
               Open <b>fomo.family</b> in a tab and post a thesis. If you're using the
               phone app, this can't see it — it only reads the tab in this browser.
               <br /><br />
               If you did post one on the web and this still says zero, the content
               script isn't running: reload the extension, then hard-reload the fomo tab.
             </div>
           </div>${openOptions}`
        : `<div class="card">
             <div>Saw <b>${seen.total}</b> requests from fomo (${esc(transports)}),
             <b>${seen.json}</b> with a JSON body — but none had anything that reads like a thesis.</div>
             <div class="sub" style="margin-top:6px">
               Post a thesis on fomo and reopen this. If it still finds nothing, fomo
               isn't sending it in a shape this can read — the recent traffic below is
               what to report.
             </div>
             <div class="path" style="margin-top:8px">${
               (seen.recent ?? [])
                 .slice(0, 6)
                 .map((r) => `${esc(r.transport)} ${esc(r.pattern)}${r.keys ? ' {' + esc(r.keys.join(',')) + '}' : ''}`)
                 .join('<br />')
             }</div>
           </div>${openOptions}`
    wire()
    return
  }

  const pick = (pattern, path) => async (ev) => {
    const btn = ev.currentTarget
    btn.disabled = true
    btn.textContent = 'sending…'
    const r = await send('learn', { pattern, field: path })
    // Learning also posts this thesis, so say whether it actually went out.
    state.innerHTML = r?.broadcast
      ? `<span class="ok">Connected — and that thesis just went out.</span>`
      : `<span class="ok">Connected.</span> That one didn't post (no matching trade, or already sent) — the next will.`
    setTimeout(load, 1800)
  }

  const card = (c, f, primary) => {
    const el = document.createElement('div')
    el.className = 'card'
    el.innerHTML = `
      <div class="quote">“${esc(f.value.slice(0, 160))}${f.value.length > 160 ? '…' : ''}”</div>
      <div class="path">${esc(c.pattern)} · ${esc(f.path)}</div>
      <div class="row" style="margin-top:8px">
        <span class="muted">${new Date(c.at).toLocaleTimeString()}</span>
        <button class="${primary ? 'primary' : ''}">This is my thesis</button>
      </div>`
    el.querySelector('button').onclick = pick(c.pattern, f.path)
    return el
  }

  body.innerHTML = ''

  const guesses = candidates.filter((c) => c.fields.length)
  for (const c of guesses) for (const f of c.fields.slice(0, 3)) body.append(card(c, f, true))

  if (!guesses.length) {
    const note = document.createElement('div')
    note.className = 'sub'
    note.innerHTML = `Nothing looked obviously like a thesis. If you posted one, find it below and pick it by hand.`
    body.append(note)
  }

  // The guess is only a guess — without a manual override, a thesis the
  // heuristic doesn't like can never be connected at all.
  const details = document.createElement('details')
  details.innerHTML = `<summary>Everything else fomo sent (${candidates.length})</summary>`
  for (const c of candidates) {
    for (const f of c.allFields ?? []) {
      if (c.fields.some((p) => p.path === f.path)) continue
      details.append(card(c, f, false))
    }
  }
  body.append(details)

  const foot = document.createElement('div')
  foot.innerHTML = openOptions
  body.append(foot)
  wire()
}

function wire() {
  const opts = document.getElementById('opts')
  if (opts) opts.onclick = () => chrome.runtime.openOptionsPage()
  const forget = document.getElementById('forget')
  if (forget)
    forget.onclick = async () => {
      await send('forget')
      load()
    }
}

load()
