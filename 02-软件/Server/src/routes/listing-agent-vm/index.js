/**
 * VM 上架代理 API — ADB 自动化控制台
 * 对应 PC 版 listing-agent/index.js, 使用 ADB 命令替代 pyautogui
 * 安全: 全部路由需登录 (auth) — 这些接口可控制安卓模拟器
 */
const express = require('express')
const router = express.Router()
const sc = require('./screen')
const { executeSteps, replaceVariables, abortExecution, isAborted } = require('./executor')
const auth = require('../../middleware/auth')
const { 读设置, 写设置 } = require('../../services/appSettings')
const fs = require('fs')
const path = require('path')

router.use(auth)

// 配置名白名单: 防止路径穿越
function validName(n) {
  return typeof n === 'string' && /^[A-Za-z0-9_\-\u4e00-\u9fa5]{1,64}$/.test(n)
}

const CONFIG_DIR = path.join(__dirname, '../../config/listing-flows-vm')

// ==================== 设置 ====================
// 「一键上架」那套的运行时参数（目前只有「连续失败熔断」一条）。
// 挂在面板路由下是因为**入口就是面板** —— auto-listing 的 ⚙设置 跳的就是 panel-vm。
// 真正的读写在 services/appSettings.js：默认值、取值范围都在那儿，这里只做转发。
router.get('/settings', async (req, res) => {
  try {
    res.json(await 读设置())
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.put('/settings', async (req, res) => {
  try {
    await 写设置(req.body)
    // 回读一遍再返回 —— 传进来的可能被夹到边界上（比如 10000 → 999），
    // 前端要拿这个**实际生效**的数回去刷新输入框，不是拿它自己填的那个。
    res.json({ ok: true, 设置: await 读设置() })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ==================== 状态 ====================
router.get('/status', async (req, res) => {
  try {
    const connected = sc.ensureConnected()
    res.json({ ok: connected, engine: 'listing-agent-vm', mode: 'adb' })
  } catch (e) {
    res.json({ ok: false, engine: 'listing-agent-vm', error: e.message })
  }
})

router.get('/status/detail', async (req, res) => {
  try {
    const connected = sc.ensureConnected()
    // ADB Keyboard — 检查是否为当前激活的输入法
    const curIme = sc.adb('shell settings get secure default_input_method')
    const adbKeyboard = curIme.includes('com.android.adbkeyboard')
    // Clipper 检测
    const pkgList = sc.adb('shell pm list packages')
    const clipper = pkgList.includes('ca.zgrs.clipper')
    res.json({ ok: connected, adbKeyboard, clipper })
  } catch (e) {
    res.json({ ok: false, adbKeyboard: false, clipper: false, error: e.message })
  }
})

router.get('/mouse-position', async (req, res) => {
  res.json({ x: 0, y: 0 })
})

// ==================== 流程配置 (读 VM 专属目录) ====================
router.get('/flows', (req, res) => {
  try {
    if (!fs.existsSync(CONFIG_DIR)) return res.json([])
    const files = fs.readdirSync(CONFIG_DIR).filter(f => f.endsWith('.json'))
    const configs = files.map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, f), 'utf-8'))
      return { name: data.name || f.replace('.json', ''), desc: data.desc || '', file: f, steps: (data.steps || []).length }
    })
    res.json(configs)
  } catch (e) { res.json([]) }
})

router.get('/flows/:name', (req, res) => {
  try {
    const name = req.params.name
    if (!fs.existsSync(CONFIG_DIR)) return res.status(404).json({ error: 'not found' })
    for (const f of fs.readdirSync(CONFIG_DIR)) {
      if (!f.endsWith('.json')) continue
      const data = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, f), 'utf-8'))
      if (data.name === name || f === name || f.replace('.json', '') === name) return res.json(data)
    }
    res.status(404).json({ error: 'not found' })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/configs', (req, res) => {
  try {
    if (!fs.existsSync(CONFIG_DIR)) return res.json([])
    const files = fs.readdirSync(CONFIG_DIR).filter(f => f.endsWith('.json'))
    const configs = files.map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, f), 'utf-8'))
      return { name: data.name || f.replace('.json', ''), platform: data.platform, steps: (data.steps || []).length }
    })
    res.json(configs)
  } catch (e) { res.json([]) }
})

router.get('/configs/:name', (req, res) => {
  try {
    const fp = path.join(CONFIG_DIR, req.params.name + '.json')
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'not found' })
    res.json(JSON.parse(fs.readFileSync(fp, 'utf-8')))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.put('/configs/:name', (req, res) => {
  try {
    if (!validName(req.params.name)) return res.status(400).json({ error: '配置名不合法' })
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true })
    // 改名处理
    const oldName = req.body.oldName
    if (oldName && oldName !== req.params.name && validName(oldName)) {
      const oldFp = path.join(CONFIG_DIR, oldName + '.json')
      if (fs.existsSync(oldFp)) fs.unlinkSync(oldFp)
    }
    const fp = path.join(CONFIG_DIR, req.params.name + '.json')
    fs.writeFileSync(fp, JSON.stringify({ ...req.body, name: req.params.name }, null, 2), 'utf-8')
    res.json({ ok: true, name: req.params.name })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.delete('/configs/:name', (req, res) => {
  try {
    if (!validName(req.params.name)) return res.status(400).json({ error: '配置名不合法' })
    const fp = path.join(CONFIG_DIR, req.params.name + '.json')
    if (fs.existsSync(fp)) fs.unlinkSync(fp)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ==================== 操作 ====================
router.post('/click-at', async (req, res) => {
  try {
    const { x, y } = req.body
    sc.clickAt(Math.round(x), Math.round(y))
    res.json({ ok: true, x, y })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/input-text', async (req, res) => {
  try {
    const { text, x, y } = req.body
    sc.inputText(text, x ? Math.round(x) : 0, y ? Math.round(y) : 0)
    res.json({ ok: true, text })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/press-key', async (req, res) => {
  try {
    sc.pressKey(req.body.key || 'enter')
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/screenshot', async (req, res) => {
  try {
    const fp = path.join(__dirname, '..', '..', '..', '..', 'Storage', 'cache', 'screen_vm.png')
    const ok = sc.screenshot(fp)
    res.json({ ok, file: fp })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/scroll', async (req, res) => {
  try {
    sc.scroll(req.body.clicks || -500)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ==================== 流程执行 ====================
router.post('/execute', async (req, res) => {
  try {
    const { name, steps, variables } = req.body
    console.time('[VM-EXECUTE] ' + name)
    console.log('[VM-EXECUTE] 收到请求 name=' + name + ' steps=' + (steps||[]).length + ' vars=' + JSON.stringify(variables))
    sc.ensureConnected()
    // 确保ADB键盘为激活输入法 (ime set不生效, 改用settings)
    sc.adb('shell settings put secure default_input_method com.android.adbkeyboard/.AdbIME')
    // 预处理: 展开嵌套步骤、处理 compare/jump/setvar
    const flatSteps = []
    const stepIndex = {}
    let idx = 0

    // 展开步骤直传 executor (runtime 处理 compare/jump/setvar/compute)
    for (const step of (steps || [])) {
      const type = step.type || step.stepType || 'click'
      const action = (step.actions && step.actions.length > 0) ? step.actions[0] : null
      const ax = action ? action.x : step.x
      const ay = action ? action.y : step.y
      const atext = action ? action.text : step.text
      flatSteps.push({
        type,
        x: ax, y: ay,
        text: atext,
        keyword: step.keyword || (action ? action.keyword : null),
        ocrPrompt: step.ocrPrompt || (action ? action.ocrPrompt : null),
        duration: step.stepDuration || step.duration || 0.5,
        desc: step.desc || step.name || `步骤${flatSteps.length+1}`,
        compareVar: step.compareVar, compareRightVar: step.compareRightVar,
        compareOp: step.compareOp, compareValue: step.compareValue,
        trueJump: step.trueJump, falseJump: step.falseJump,
        jumpTo: step.jumpTo,
        leftVar: step.leftVar, rightVar: step.rightVar, template: step.template,
        actions: (step.actions && step.actions.length > 0) ? step.actions : (action ? [action] : []),
        scroll_clicks: action ? (action.scroll_clicks || step.scroll_clicks) : (step.scroll_clicks || -500),
        _varName: step._varName, _actions: step._actions,
        x1: step.x1 || (action ? action.x1 : null), y1: step.y1 || (action ? action.y1 : null),
        x2: step.x2 || (action ? action.x2 : null), y2: step.y2 || (action ? action.y2 : null),
        ms: step.ms || (action ? action.ms : null),
      })
    }

    // 执行。batchId 有就按批次隔离终止信号（面板自己跑的没这个字段，落空串那一槽）
    const runKey = (req.body && req.body.batchId) || ''
    const result = await executeSteps(flatSteps, (msg) => {
      // 可通过 WebSocket 推日志, 这里暂存
      if (!res._logs) res._logs = []
      res._logs.push(msg)
    }, variables, runKey)

    console.timeEnd('[VM-EXECUTE] ' + name)
    res.json({
      success: result.success,
      aborted: result.aborted,
      variables,
      logs: res._logs || [],
      message: result.message,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/dump', (req, res) => {
  try {
    const r = sc.dumpUI()
    res.json(r)
  } catch (e) {
    res.json({ ok: false, elements: [], error: e.message })
  }
})

// 终止执行。带 {batchId} 就只停那一批；不带就停「没有批次标识」的那些 ——
// 也就是这个面板自己起来的执行（见 executor.js 里 _aborted 那张表的说明）。
router.post('/execute/stop', (req, res) => {
  const runKey = (req.body && req.body.batchId) || ''
  abortExecution(runKey)
  res.json({ ok: true, batchId: runKey || null, message: runKey ? ('已发送终止信号（批次 ' + runKey + '）') : '已发送终止信号' })
})

module.exports = router
