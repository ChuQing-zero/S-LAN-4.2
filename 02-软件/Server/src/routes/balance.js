// 火山引擎余额查询 — 使用官方 SDK
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getBalance } = require('../services/billingService');

router.get('/', auth, async (_req, res) => {
  try {
    const result = await getBalance();
    res.json(result);
  } catch (e) {
    console.error('Balance error:', e.message);
    res.json({ balance: null, error: e.message });
  }
});

module.exports = router;
