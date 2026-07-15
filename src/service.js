import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { appRoot, dataDir, packaged } from './paths.js'

// Registers the app to start automatically and keep running in the background,
// so a user doesn't have to leave a window open. Each platform gets its native
// mechanism rather than a bundled supervisor.

const LABEL = 'thesis-broadcaster'
const WIN_TASK = 'ThesisBroadcaster'

const pidPath = () => join(dataDir, 'app.pid')

export function writePidFile() {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(pidPath(), String(process.pid))
}

// Only clear the file if we own it — a restarted instance may have claimed it.
export function clearPidFile() {
  try {
    if (Number(readFileSync(pidPath(), 'utf8').trim()) !== process.pid) return
  } catch {
    return
  }
  rmSync(pidPath(), { force: true })
}

export function runningPid() {
  if (!existsSync(pidPath())) return null
  const pid = Number(readFileSync(pidPath(), 'utf8').trim())
  if (!pid || pid === process.pid) return null
  try {
    process.kill(pid, 0) // liveness probe, sends no signal
    return pid
  } catch {
    return null
  }
}

/**
 * Stops the background instance. Without this, uninstall removes autostart but
 * leaves a hidden process running with no window and no off switch — the user
 * would need Task Manager to stop it.
 */
function stopRunning() {
  const pid = runningPid()
  if (!pid) return false
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return false
  }
  // Not clearPidFile(): that only removes the file when we own it, and here we
  // are killing someone else's pid. On Windows SIGTERM is a hard terminate, so
  // the victim never runs its own exit handler to clean up.
  rmSync(pidPath(), { force: true })
  return true
}

// Running from source needs `node server.js`; the packaged build is self-contained.
// --background is an explicit signal: a hidden console is still a TTY, so
// isTTY alone would make the service think it is interactive and try to open a
// browser at every logon.
function launchCommand() {
  return packaged
    ? { exe: process.execPath, args: ['--background'] }
    : { exe: process.execPath, args: [join(appRoot, 'src', 'server.js'), '--background'] }
}

const quiet = (cmd, args) => {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() || err.message }
  }
}

// ---------- windows ----------------------------------------------------------

const vbsPath = () => join(appRoot, 'run-hidden.vbs')
const xmlPath = () => join(dataDir, 'task.xml')

// A Node SEA build is a console app: launching it directly from Task Scheduler
// flashes a terminal on every logon. WScript.Run with mode 0 starts it hidden.
//
// The third argument MUST be True (wait). With False, wscript returns instantly,
// Task Scheduler marks the task completed-successfully, and RestartOnFailure can
// never fire — the app would stay dead after a crash. Waiting makes wscript's
// exit code the task's, so a crash registers as a failure and gets restarted.
function writeVbs() {
  const { exe, args } = launchCommand()
  const parts = [exe, ...args].map((p) => `""${p}""`).join(' ')
  writeFileSync(
    vbsPath(),
    `Set sh = CreateObject("WScript.Shell")\r\n` +
      `sh.CurrentDirectory = "${appRoot}"\r\n` +
      `rc = sh.Run("${parts}", 0, True)\r\n` +
      `WScript.Quit rc\r\n`
  )
}

function windowsInstall() {
  writeVbs()
  mkdirSync(dataDir, { recursive: true })

  // Defined as XML rather than plain schtasks flags so the task also restarts
  // itself if the process dies — "always, forever" needs more than run-at-logon.
  const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Posts your trades to your channels.</Description></RegistrationInfo>
  <Triggers>
    <!-- Starts it as soon as the user logs in. -->
    <LogonTrigger><Enabled>true</Enabled></LogonTrigger>
    <!-- Self-healing, and it has to be a TimeTrigger.
         Two things that do NOT work, both verified the hard way:
           1. RestartOnFailure only retries tasks that fail to LAUNCH. An action
              exiting nonzero doesn't count (Last Result -1, no restart).
           2. Repetition on the LogonTrigger only arms when that trigger fires,
              i.e. at logon — so it never repeats within a session.
         A TimeTrigger with a past StartBoundary repeats regardless. Every minute
         it tries to run; MultipleInstancesPolicy=IgnoreNew skips while the app
         is alive, so a dead app is revived on the next tick. -->
    <TimeTrigger>
      <StartBoundary>2020-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
      <Repetition>
        <Interval>PT1M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </TimeTrigger>
  </Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>wscript.exe</Command>
      <Arguments>"${vbsPath()}"</Arguments>
      <WorkingDirectory>${appRoot}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`

  // Task Scheduler requires UTF-16LE with a BOM for /XML.
  writeFileSync(xmlPath(), '﻿' + xml, 'utf16le')

  const r = quiet('schtasks', ['/Create', '/TN', WIN_TASK, '/XML', xmlPath(), '/F'])
  if (!r.ok) return { ok: false, reason: r.out }

  const run = quiet('schtasks', ['/Run', '/TN', WIN_TASK])
  return { ok: true, startedNow: run.ok }
}

function windowsUninstall() {
  quiet('schtasks', ['/End', '/TN', WIN_TASK])
  const r = quiet('schtasks', ['/Delete', '/TN', WIN_TASK, '/F'])
  rmSync(vbsPath(), { force: true })
  rmSync(xmlPath(), { force: true })
  if (!r.ok && !/cannot find/i.test(r.out)) return { ok: false, reason: r.out }
  return { ok: true }
}

function windowsStatus() {
  const r = quiet('schtasks', ['/Query', '/TN', WIN_TASK, '/FO', 'LIST'])
  if (!r.ok) return { installed: false }
  const state = /Status:\s*(.+)/i.exec(r.out)?.[1]?.trim()
  return { installed: true, state }
}

// ---------- macos ------------------------------------------------------------

const plistPath = () => join(homedir(), 'Library', 'LaunchAgents', `com.${LABEL}.plist`)

function macInstall() {
  const { exe, args } = launchCommand()
  mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true })
  mkdirSync(dataDir, { recursive: true })

  const argXml = [exe, ...args].map((a) => `    <string>${a}</string>`).join('\n')
  writeFileSync(
    plistPath(),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>WorkingDirectory</key><string>${appRoot}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key>
  <dict><key>NO_OPEN</key><string>1</string></dict>
  <key>StandardOutPath</key><string>${join(dataDir, 'app.log')}</string>
  <key>StandardErrorPath</key><string>${join(dataDir, 'app.log')}</string>
</dict>
</plist>
`
  )

  quiet('launchctl', ['unload', plistPath()])
  const r = quiet('launchctl', ['load', '-w', plistPath()])
  if (!r.ok) return { ok: false, reason: r.out }
  return { ok: true, startedNow: true }
}

function macUninstall() {
  quiet('launchctl', ['unload', '-w', plistPath()])
  rmSync(plistPath(), { force: true })
  return { ok: true }
}

function macStatus() {
  if (!existsSync(plistPath())) return { installed: false }
  const r = quiet('launchctl', ['list', `com.${LABEL}`])
  return { installed: true, state: r.ok ? 'Running' : 'Loaded' }
}

// ---------- linux ------------------------------------------------------------

const unitPath = () => join(homedir(), '.config', 'systemd', 'user', `${LABEL}.service`)

function linuxInstall() {
  const { exe, args } = launchCommand()
  mkdirSync(join(homedir(), '.config', 'systemd', 'user'), { recursive: true })

  writeFileSync(
    unitPath(),
    `[Unit]
Description=thesis broadcaster
After=network-online.target

[Service]
Type=simple
Environment=NO_OPEN=1
WorkingDirectory=${appRoot}
ExecStart=${[exe, ...args].map((a) => `"${a}"`).join(' ')}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`
  )

  quiet('systemctl', ['--user', 'daemon-reload'])
  const r = quiet('systemctl', ['--user', 'enable', '--now', `${LABEL}.service`])
  if (!r.ok) return { ok: false, reason: r.out }
  // Without linger the service stops when the user logs out.
  quiet('loginctl', ['enable-linger', process.env.USER ?? ''])
  return { ok: true, startedNow: true }
}

function linuxUninstall() {
  quiet('systemctl', ['--user', 'disable', '--now', `${LABEL}.service`])
  rmSync(unitPath(), { force: true })
  quiet('systemctl', ['--user', 'daemon-reload'])
  return { ok: true }
}

function linuxStatus() {
  if (!existsSync(unitPath())) return { installed: false }
  const r = quiet('systemctl', ['--user', 'is-active', `${LABEL}.service`])
  return { installed: true, state: r.out.trim() || 'unknown' }
}

// ---------- dispatch ---------------------------------------------------------

const impl = {
  win32: { install: windowsInstall, uninstall: windowsUninstall, status: windowsStatus },
  darwin: { install: macInstall, uninstall: macUninstall, status: macStatus },
  linux: { install: linuxInstall, uninstall: linuxUninstall, status: linuxStatus },
}[process.platform]

export const supported = Boolean(impl)

export function install() {
  if (!impl) return { ok: false, reason: `autostart not supported on ${process.platform}` }
  return impl.install()
}

export function uninstall() {
  if (!impl) return { ok: false, reason: `autostart not supported on ${process.platform}` }
  const r = impl.uninstall()
  if (!r.ok) return r
  // Removing autostart isn't enough: the instance it already started is still
  // running, hidden, with no way for the user to stop it.
  return { ...r, stopped: stopRunning() }
}

export function status() {
  if (!impl) return { installed: false, unsupported: true }
  return impl.status()
}
