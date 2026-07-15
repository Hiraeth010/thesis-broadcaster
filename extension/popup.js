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
  if (!candidates.length) {
    body.innerHTML = `<div class="empty">
      Nothing seen yet.<br />Post a thesis on fomo with this tab open,<br />then reopen this popup.
    </div>${openOptions}`
    wire()
    return
  }

  body.innerHTML = ''
  for (const c of candidates) {
    for (const f of c.fields.slice(0, 3)) {
      const el = document.createElement('div')
      el.className = 'card'
      el.innerHTML = `
        <div class="quote">“${esc(f.value.slice(0, 160))}${f.value.length > 160 ? '…' : ''}”</div>
        <div class="path">${esc(c.pattern)} · ${esc(f.path)}</div>
        <div class="row" style="margin-top:8px">
          <span class="muted">${new Date(c.at).toLocaleTimeString()}</span>
          <button class="primary">This is my thesis</button>
        </div>`
      el.querySelector('button').onclick = async () => {
        await send('learn', { pattern: c.pattern, field: f.path })
        load()
      }
      body.append(el)
    }
  }
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
