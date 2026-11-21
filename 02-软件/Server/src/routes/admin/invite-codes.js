/**
 * 邀请码管理 API（仅终端管理员）
 * - GET    /                列出全部邀请码（含是否已用/使用者/使用时间）
 * - POST   /                创建邀请码（可指定 code，或留空自动生成）
 * - PUT    /:id             更改邀请码（改 code 值，唯一性校验）
 * - DELETE /:id             删除邀请码
 */
const express = require('express');
const router = express.Router();
const InviteCode = require('../../models/InviteCode');

// 自动生成邀请码：SLAN-XXXXXX（去掉易混淆的 I/O/0/1）
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => {
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return 'SLAN-' + s;
};

// GET / 列表（最新在前）
router.get('/', async (req, res) => {
  try {
    const list = await InviteCode.find({}).sort({ createdAt: -1 }).lean();
    res.json({ list, total: list.length, used: list.filter(c => c.used).length, unused: list.filter(c => !c.used).length });
  } catch (error) {
    console.error('List invite codes error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST / 创建
router.post('/', async (req, res) => {
  try {
    let { code } = req.body || {};
    code = String(code || '').trim().toUpperCase();
    if (!code) {
      // 留空则自动生成（确保不重复）
      do {
        code = genCode();
      } while (await InviteCode.findOne({ code }));
    } else {
      const exist = await InviteCode.findOne({ code });
      if (exist) {
        return res.status(409).json({ error: `邀请码 ${code} 已存在` });
      }
    }
    const invite = await InviteCode.create({ code, used: false, usedBy: null, usedAt: null });
    res.status(201).json({ invite });
  } catch (error) {
    console.error('Create invite code error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /:id 更改邀请码（改 code 值）
router.put('/:id', async (req, res) => {
  try {
    const invite = await InviteCode.findById(req.params.id);
    if (!invite) {
      return res.status(404).json({ error: '邀请码不存在' });
    }
    let { code } = req.body || {};
    code = String(code || '').trim().toUpperCase();
    if (!code) {
      return res.status(400).json({ error: '邀请码不能为空' });
    }
    if (code !== invite.code) {
      const exist = await InviteCode.findOne({ code });
      if (exist) {
        return res.status(409).json({ error: `邀请码 ${code} 已存在` });
      }
      invite.code = code;
    }
    await invite.save();
    res.json({ invite });
  } catch (error) {
    console.error('Update invite code error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /:id 删除
router.delete('/:id', async (req, res) => {
  try {
    const invite = await InviteCode.findById(req.params.id);
    if (!invite) {
      return res.status(404).json({ error: '邀请码不存在' });
    }
    await invite.deleteOne();
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete invite code error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
