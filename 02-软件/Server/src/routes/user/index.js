const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../../middleware/auth');

// 头像存储
const avatarDir = path.join(__dirname, '../../../uploads/avatars');
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: avatarDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `${req.user.id}${ext}`);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// GET /profile - 获取用户信息
router.get('/profile', auth, (req, res) => {
  res.json({
    id: req.user.id,
    nickname: req.user.nickname,
    email: req.user.email,
    avatar: req.user.avatar,
    role: req.user.role
  });
});

// POST /avatar - 上传头像
router.post('/avatar', auth, avatarUpload.single('avatar'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'avatar file is required' });
    }
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    req.user.avatar = avatarUrl;
    req.user.save();
    res.json({ avatar: avatarUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
