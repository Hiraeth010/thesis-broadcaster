const APP = 'http://localhost:3031'
const state = document.getElementById('state')
const body = document.getElementById('body')

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function load() {
  let data
  try {
    data = await (await fetch(`${APP}/api/extension/candidates`)).json()
  } catch {
    state.innerHTML = `<span class="bad">thesis broadcaster isn't running.</span> Start it, then reopen this.`
    body.innerHTML = ''
    return
  }

  const { candidates, learned } = data

  if (learned?.pattern) {
    state.innerHTML = `<span class="ok">Learned.</span> Theses you post on fomo broadcast automatically.`
    body.innerHTML = `
      <div class="card">
        <div class="path">${esc(learned.pattern)}</div>
        <div class="path">field: ${esc(learned.field)}</div>
      </div>
      <button id="forget">Forget and relearn</button>
      <div class="sub" style="margin-top:8px">
        Use this if fomo changes and theses stop going out.
      </div>`
    document.getElementById('forget').onclick = async () => {
      await fetch(`${APP}/api/extension/forget`, { method: 'POST' })
      load()
    }
    return
  }

  state.innerHTML = `Not learned yet. Post a thesis on fomo, then pick it below.`

  if (!candidates.length) {
    body.innerHTML = `<div class="empty">
      Nothing seen yet.<br />Post a thesis on fomo with this tab open,<br />then reopen this popup.
    </div>`
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
        await fetch(`${APP}/api/extension/learn`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pattern: c.pattern, field: f.path }),
        })
        load()
      }
      body.append(el)
    }
  }
}

load()
