/**
 * 账号管理 API（仅终端管理员）
 * - GET  /                   列出所有账号（姓名/ID/头像/邮箱/身份）
 * - PUT  /:id                修改账号（姓名/ID/头像/身份）
 * - POST /:id/avatar         上传头像（替代指定账号的头像）
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const User = require('../../models/User');

const VALID_ROLES = ['user', 'admin', 'terminal_admin'];

// 头像存储（复用用户头像目录）
const avatarDir = path.join(__dirname, '../../../uploads/avatars');
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: avatarDir,
    filename: (req, file, cb) => {
      // 用目标账号的 ID 命名（与用户自助上传保持一致）
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `${req.params.id}${ext}`);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// GET / 列出所有账号
router.get('/', async (req, res) => {
  try {
    const list = await User.find({})
      .select('id nickname email avatar role disabled')
      .sort({ id: 1 })
      .lean();
    res.json({ list });
  } catch (error) {
    console.error('List accounts error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /:id 修改账号（姓名 / ID / 头像 / 身份）
router.put('/:id', async (req, res) => {
  try {
    const { nickname, email, id, avatar, role, disabled } = req.body;
    const user = await User.findOne({ id: req.params.id });
    if (!user) {
      return res.status(404).json({ error: '账号不存在' });
    }

    // 姓名
    if (nickname !== undefined) {
      if (typeof nickname !== 'string' || !nickname.trim()) {
        return res.status(400).json({ error: '姓名不能为空' });
      }
      user.nickname = nickname.trim();
    }

    // 邮箱
    if (email !== undefined) {
      const newEmail = String(email).trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(newEmail)) {
        return res.status(400).json({ error: '邮箱格式不正确' });
      }
      if (newEmail !== user.email) {
        const conflict = await User.findOne({ email: newEmail, _id: { $ne: user._id } });
        if (conflict) {
          return res.status(409).json({ error: `邮箱 ${newEmail} 已被其他账号占用` });
        }
        user.email = newEmail;
      }
    }

    // ID
    if (id !== undefined && String(id).trim() !== user.id) {
      const newId = String(id).trim();
      if (!newId) {
        return res.status(400).json({ error: 'ID 不能为空' });
      }
      const conflict = await User.findOne({ id: newId });
      if (conflict) {
        return res.status(409).json({ error: `ID ${newId} 已被其他账号占用` });
      }
      user.id = newId;
    }

    // 头像
    if (avatar !== undefined) {
      if (typeof avatar !== 'string' || !avatar.trim()) {
        return res.status(400).json({ error: '头像不能为空' });
      }
      user.avatar = avatar.trim();
    }

    // 身份
    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({ error: '无效的身份' });
      }
      // 安全保护：不允许把最后一个终端管理员降级，避免系统失去管理能力
      if (role !== 'terminal_admin' && user.role === 'terminal_admin') {
        const termCount = await User.countDocuments({ role: 'terminal_admin' });
        if (termCount <= 1) {
          return res.status(400).json({ error: '系统至少保留一个终端管理员，无法降级该账号' });
        }
      }
      user.role = role;
    }

    // 禁用 / 恢复
    if (disabled !== undefined) {
      const wantDisabled = !!disabled;
      if (wantDisabled && user.role === 'terminal_admin') {
        // 安全保护：不允许禁用最后一个终端管理员（与降级一致）
        const termCount = await User.countDocuments({ role: 'terminal_admin', disabled: { $ne: true } });
        if (termCount <= 1) {
          return res.status(400).json({ error: '系统至少保留一个可用的终端管理员，无法禁用该账号' });
        }
      }
      user.disabled = wantDisabled;
    }

    await user.save();
    res.json({ user: user.toJSON() });
  } catch (error) {
    console.error('Update account error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /:id/avatar 上传头像（替目标账号换头像）
router.post('/:id/avatar', avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'avatar file is required' });
    }
    const user = await User.findOne({ id: req.params.id });
    if (!user) {
      return res.status(404).json({ error: '账号不存在' });
    }
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    user.avatar = avatarUrl;
    await user.save();
    res.json({ avatar: avatarUrl });
  } catch (error) {
    console.error('Upload account avatar error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /:id/password 修改账号密码
// 需要再次输入操作者（当前终端管理员）的正确密码才能修改，防止误改/盗改
router.put('/:id/password', async (req, res) => {
  try {
    const { password, currentPassword } = req.body || {};
    const target = await User.findOne({ id: req.params.id });
    if (!target) {
      return res.status(404).json({ error: '账号不存在' });
    }
    // 验证操作者本人当前密码
    if (!currentPassword || !(await req.user.comparePassword(String(currentPassword)))) {
      return res.status(403).json({ error: '当前密码不正确，无法修改' });
    }
    // 新密码校验
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: '新密码至少 6 位' });
    }
    target.password = password;
    await target.save();
    res.json({ ok: true });
  } catch (error) {
    console.error('Change account password error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
