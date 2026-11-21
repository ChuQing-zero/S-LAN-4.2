const jwt = require('jsonwebtoken');
const config = require('../config');

const generateToken = (userId) => {
  return jwt.sign({ userId }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
};

const generateUserId = async () => {
  const User = require('../models/User');
  const last = await User.findOne({}).sort({ id: -1 }).lean();
  if (!last || !last.id) return '001';
  const num = parseInt(last.id) || 0;
  return String(num + 1).padStart(3, '0');
};

const generateLibraryId = (code) => {
  const prefix = code.substring(0, 2).toUpperCase();
  const num = code.substring(2).padStart(6, '0');
  return `${prefix}${num}`;
};

module.exports = {
  generateToken,
  generateUserId,
  generateLibraryId
};
