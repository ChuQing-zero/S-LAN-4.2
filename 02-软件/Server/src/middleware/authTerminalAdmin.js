const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');

/**
 * 终端管理员权限中间件（比 authAdmin 更严格）
 * 只有 role === 'terminal_admin' 才能通过。
 * 用于账号管理等不允许普通管理员操作的高危接口。
 */
const authTerminalAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, config.jwtSecret);

    const user = await User.findOne({ id: decoded.userId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 被禁用的账号不允许使用管理接口
    if (user.disabled) {
      return res.status(403).json({ error: '账号已被禁用，请联系管理员恢复' });
    }

    // 仅终端管理员可访问
    if (user.role !== 'terminal_admin') {
      return res.status(403).json({ error: 'Forbidden: Terminal admin access required' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

module.exports = authTerminalAdmin;
