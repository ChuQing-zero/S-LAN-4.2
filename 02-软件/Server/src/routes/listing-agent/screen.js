/**
 * 桌面自动化封装 — 截图/鼠标/键盘
 * 鼠标点击用 PowerShell + Win32 API（跟 pyautogui 同样原理）
 */
const { execSync } = require('child_process')
const path = require('path')
const clickerPs1 = path.join(__dirname, 'clicker.ps1')

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

/** 点击坐标 */
async function clickAt(x, y, button = 'left', clicks = 1) {
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${clickerPs1}" -x ${x} -y ${y} -clicks ${clicks}`, { timeout: 10000 })
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
}

async function doubleClick(x, y) { return clickAt(x, y, 'left', 2) }

async function tripleClick(x, y) {
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${clickerPs1}" -x ${x} -y ${y} -clicks 3`, { timeout: 10000 })
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
}

async function inputText(text, x, y) {
  const t = String(text || '')
  try {
    if (x != null && y != null) execSync(`powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x},${y})"`, { timeout: 5000 })
    // 先设剪贴板再 Ctrl+V（比 SendKeys 快且不会漏字符）
    execSync(`powershell -NoProfile -Command "Set-Clipboard -Value '${t.replace(/'/g, "''")}'"`, { timeout: 5000 })
    await sleep(100)
    execSync(`powershell -NoProfile -Command "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^v')"`, { timeout: 5000 })
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
}

async function pressKey(key) {
  // 严格白名单: 只允许预定义按键, 未命中直接拒绝 (防命令注入)
  const map = {
    'enter': '{ENTER}', 'backspace': '{BACKSPACE}', 'tab': '{TAB}', 'escape': '{ESC}',
    'space': ' ', 'delete': '{DELETE}', 'ctrl+v': '^v',
    'up': '{UP}', 'down': '{DOWN}', 'left': '{LEFT}', 'right': '{RIGHT}',
    'home': '{HOME}', 'end': '{END}', 'pageup': '{PGUP}', 'pagedown': '{PGDN}',
    'f1': '{F1}', 'f2': '{F2}', 'f3': '{F3}', 'f4': '{F4}', 'f5': '{F5}',
    'f6': '{F6}', 'f7': '{F7}', 'f8': '{F8}', 'f9': '{F9}', 'f10': '{F10}',
    'f11': '{F11}', 'f12': '{F12}', 'insert': '{INSERT}', 'printscreen': '{PRTSC}',
  }
  const k = map[String(key || '').toLowerCase()]
  if (!k) return { success: false, error: '不支持的按键: ' + key }
  try {
    execSync(`powershell -NoProfile -Command "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('${k}')"`, { timeout: 5000 })
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
}

async function scroll(clicks) {
  const n = Number(clicks)
  if (!Number.isFinite(n) || Math.abs(n) > 1000) return { success: false, error: 'clicks 无效' }
  try {
    const dir = n < 0 ? 'down' : 'up'
    execSync(`powershell -NoProfile -Command "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('{${dir} ${Math.abs(Math.round(n))}}')"`, { timeout: 5000 })
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
}

async function drag(x1, y1, x2, y2) {
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${clickerPs1}" -x ${x1} -y ${y1} -clicks 0`, { timeout: 5000 })
    // 按住左键移动... PowerShell 实现较复杂，暂时用移动+点击替代
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${clickerPs1}" -x ${x2} -y ${y2} -clicks 1`, { timeout: 5000 })
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
}

async function captureScreen(region) {
  try { const s = require('screenshot-desktop'); return (await s({ format: 'png' })).toString('base64') } catch (_) { return '' }
}

async function getScreenSize() {
  try {
    const out = execSync('powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height"', { timeout: 5000 }).toString().trim()
    const [w, h] = out.split('\r\n').map(Number)
    return { width: w || 1920, height: h || 1080 }
  } catch (_) { return { width: 1920, height: 1080 } }
}

async function getMousePos() {
  try {
    const out = execSync('powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $p=[System.Windows.Forms.Cursor]::Position; Write-Output $p.X; Write-Output $p.Y"', { timeout: 5000 }).toString().trim()
    const [x, y] = out.split('\r\n').map(Number)
    return { x: x || 0, y: y || 0 }
  } catch (_) { return { x: 0, y: 0 } }
}

function waitMs(ms) { return new Promise(r => setTimeout(r, ms)) }

module.exports = {
  isAvailable: () => true, clickAt, doubleClick, tripleClick,
  inputText, pressKey, scroll, drag,
  captureScreen, getScreenSize, getMousePos, waitMs
}
