// Isolated world: the page-world hook can't reach chrome.runtime, so this
// bridges its postMessage traffic to the service worker.
// console.log, NOT console.debug — Chrome hides debug behind the "Verbose"
// level, so these were printing invisibly.
const log = (...args) => console.log('%c[TB relay]', 'color:#22c55e;font-weight:bold', ...args)

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (event.data?.source !== 'thesis-broadcaster') return

  try {
    chrome.runtime.sendMessage({ type: 'observed', payload: event.data.payload }, () => {
      // Reading lastError stops "unchecked runtime.lastError" noise, and tells
      // us the service worker never answered.
      if (chrome.runtime.lastError) log('service worker did not answer:', chrome.runtime.lastError.message)
    })
    log('forwarded', event.data.payload?.method, event.data.payload?.url)
  } catch (err) {
    // Reloading the extension invalidates this context until the tab reloads.
    // Swallowing this silently is why "nothing happens" was unexplainable.
    log('COULD NOT FORWARD —', err.message, '· reload the fomo tab (Ctrl+Shift+R)')
  }
})

log('bridge ready')
