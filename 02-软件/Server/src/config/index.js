require('dotenv').config();

const WEAK_SECRETS = ['change-me-in-env-file', 'lans-local-secret-key-2026', ''];
const jwtSecret = process.env.JWT_SECRET || '';
if (WEAK_SECRETS.includes(jwtSecret)) {
  console.error('❌ [安全] JWT_SECRET 缺失或为默认弱密钥, 拒绝启动。');
  console.error('   请在 Server\\.env 中设置随机字符串 (如 openssl rand -hex 32 生成)。');
  process.exit(1);
}

module.exports = {
  port: process.env.SERVER_PORT || process.env.PORT || 4002,
  jwtSecret,
  jwtExpiresIn: '7d',
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:28018/s-lan-local',

  // 火山引擎 IAM 凭证（OCR 识别、余额查询）
  // 支持两种环境变量名：VOLC_ACCESSKEY / VOLC_AK，VOLC_SECRETKEY / VOLC_SK
  volcengine: {
    accessKeyId: process.env.VOLC_ACCESSKEY || process.env.VOLC_AK || '',
    secretKey: process.env.VOLC_SECRETKEY || process.env.VOLC_SK || '',
  },

  // 方舟大模型（Doubao 提取卡牌编号）
  ark: {
    apiKey: process.env.ARK_API_KEY || '',
    model: process.env.ARK_MODEL || process.env.ARK_EP_ID || '',
  },
};
