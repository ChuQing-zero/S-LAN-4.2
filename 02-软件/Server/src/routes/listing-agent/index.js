/**
 * 上架代理 API — 桌面自动化控制台
 * 截图/点击/输入/OCR/流程执行
 * 安全: 全部路由需登录 (auth) — 这些接口可控制宿主机鼠标键盘/截屏
 */
const express = require('express')
const router = express.Router()
const sc = require('./screen')
const { executeSteps, replaceVariables, abortExecution, isAborted } = require('./executor')
const auth = require('../../middleware/auth')

router.use(auth)

// 配置名白名单: 仅允许字母/数字/中文/下划线/连字符, 防止路径穿越
function validName(n) {
  return typeof n === 'string' && /^[A-Za-z0-9_\-\u4e00-\u9fa5]{1,64}$/.test(n)
}

// ==================== 状态 ====================
router.get('/status', async (req, res) => {
  try {
    const size = await sc.getScreenSize()
    res.json({ ok: true, engine: 'listing-agent', screen: size })
  } catch (e) {
    res.json({ ok: true, engine: 'listing-agent', screen: { width: 0, height: 0 }, warning: e.message })
  }
})

router.get('/screen-size', async (req, res) => {
  try {
    const size = await sc.getScreenSize()
    res.json(size)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/mouse-position', async (req, res) => {
  try {
    const pos = await sc.getMousePos()
    res.json(pos)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ==================== 操作 ====================
router.post('/click-at', async (req, res) => {
  const { x, y, button, clicks } = req.body
  if (x == null || y == null) return res.status(400).json({ error: '需要 x, y' })
  const nx = Number(x), ny = Number(y), nc = Number(clicks || 1)
  if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nc)) {
    return res.status(400).json({ error: 'x, y, clicks 必须为数字' })
  }
  try {
    const result = await sc.clickAt(nx, ny, button || 'left', nc)
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/input-text', async (req, res) => {
  const { text, x, y } = req.body
  if (!text) return res.status(400).json({ error: '需要 text' })
  try {
    const result = await sc.inputText(text, x, y)
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/press-key', async (req, res) => {
  const { key } = req.body
  if (!key) return res.status(400).json({ error: '需要 key' })
  try {
    const result = await sc.pressKey(key)
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/screenshot', async (req, res) => {
  try {
    const img = await sc.captureScreen()
    res.json({ success: true, image: img })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/scroll', async (req, res) => {
  const { clicks } = req.body
  try {
    const result = await sc.scroll(clicks || 0)
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ==================== 流程执行 ====================
router.post('/execute', async (req, res) => {
  try {
    const { name, steps, variables } = req.body
    if (!steps || !Array.isArray(steps)) {
      return res.status(400).json({ error: '需要 steps 数组' })
    }
    const logs = []
    // batchId 有就按批次隔离终止信号（面板自己跑的没这个字段，落空串那一槽）
    const runKey = (req.body && req.body.batchId) || ''
    const result = await executeSteps(steps, (msg) => { logs.push(msg) }, variables || {}, runKey)
    res.json({ ...result, logs, flow_name: name || 'unnamed' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ==================== 终止执行 ====================
// 带 {batchId} 就只停那一批；不带就停「没有批次标识」的那些（这个面板自己起的）。
router.post('/execute/stop', (req, res) => {
  const runKey = (req.body && req.body.batchId) || ''
  abortExecution(runKey)
  res.json({
    ok: true, batchId: runKey || null,
    message: runKey
      ? ('终止信号已发送（批次 ' + runKey + '），流程将在当前步骤完成后停止')
      : '终止信号已发送，流程将在当前步骤完成后停止',
  })
})

router.get('/execute/status', (req, res) => {
  res.json({ aborted: isAborted((req.query && req.query.batchId) || '') })
})

// ==================== 流程配置 (JSON文件存储) ====================
const fs = require('fs')
const path = require('path')
const CONFIG_DIR = path.join(__dirname, '../../config/listing-flows')

try { fs.mkdirSync(CONFIG_DIR, { recursive: true }) } catch (_) {}

router.get('/configs', (req, res) => {
  try {
    const files = fs.readdirSync(CONFIG_DIR).filter(f => f.endsWith('.json'))
    const configs = files.map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, f), 'utf-8'))
      return { name: data.name || f.replace('.json', ''), platform: data.platform, steps: (data.steps || []).length }
    })
    res.json(configs)
  } catch (e) {
    res.json([])
  }
})

router.get('/configs/:name', (req, res) => {
  try {
    const fp = path.join(CONFIG_DIR, req.params.name + '.json')
    if (!fs.existsSync(fp)) return res.status(404).json({ error: '配置不存在' })
    res.json(JSON.parse(fs.readFileSync(fp, 'utf-8')))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.put('/configs/:name', (req, res) => {
  try {
    if (!validName(req.params.name)) return res.status(400).json({ error: '配置名不合法' })
    // 改名处理: 删除旧文件
    const oldName = req.body.oldName;
    if (oldName && oldName !== req.params.name && validName(oldName)) {
      const oldFp = path.join(CONFIG_DIR, oldName + '.json');
      if (fs.existsSync(oldFp)) fs.unlinkSync(oldFp);
    }
    const fp = path.join(CONFIG_DIR, req.params.name + '.json')
    fs.writeFileSync(fp, JSON.stringify({ ...req.body, name: req.params.name }, null, 2), 'utf-8')
    res.json({ ok: true, name: req.params.name })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.delete('/configs/:name', (req, res) => {
  try {
    if (!validName(req.params.name)) return res.status(400).json({ error: '配置名不合法' })
    const fp = path.join(CONFIG_DIR, req.params.name + '.json')
    if (fs.existsSync(fp)) fs.unlinkSync(fp)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
