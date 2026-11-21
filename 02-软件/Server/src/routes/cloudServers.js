const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

// GET /v1/api/cloud-servers — 云端服务器列表
router.get('/', auth, async (req, res) => {
  res.json({ list: [] })
})

// POST /v1/api/cloud-servers — 添加云端服务器
router.post('/', auth, async (req, res) => {
  const { name, url } = req.body
  if (!name || !url) return res.status(400).json({ error: 'name and url are required' })
  res.status(201).json({ name, url })
})

// POST /v1/api/cloud-servers/test — 测试连接
router.post('/test', auth, async (req, res) => {
  res.json({ ok: true })
})

module.exports = router
