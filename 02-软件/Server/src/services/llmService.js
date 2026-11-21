/**
 * 方舟大模型服务 — 使用 ARK Responses HTTP API
 *
 * API: POST https://ark.cn-beijing.volces.com/api/v3/responses
 * Auth: Bearer {apiKey}（无需 HMAC 签名）
 */
const axios = require('axios');
const config = require('../config');

const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3/responses';

/**
 * 使用大模型从 OCR 文字中提取卡牌编号
 * @param {string} ocrText - OCR 识别出的全部文字
 * @returns {Promise<string[]>} 卡牌编号数组，如 ["QCAC-JP059", "SAST-CN071"]
 */
async function extractCardCodes(ocrText) {
  const systemPrompt = [
    '你是游戏王卡牌编号提取工具。',
    '规则：',
    '1. 只输出符合 XXXX-XXNNNN 格式的卡牌编号（如 QCAC-JP059、SAST-CN071）',
    '2. 每行一个编号，不要序号、不要逗号、不要解释',
    '3. 如果没有匹配的卡牌编号，输出空字符串',
    '4. 绝对不要输出任何多余文字、标点、符号',
  ].join('\n');

  const response = await axios.post(
    ARK_BASE_URL,
    {
      model: config.ark.model,
      input: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `以下是从卡牌图片OCR识别出的文字：\n${ocrText}\n\n请提取其中所有的卡牌编号。`,
        },
      ],
    },
    {
      headers: {
        'Authorization': `Bearer ${config.ark.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  // 解析 ARK Responses API 响应
  // 格式: output[0].content[0].text (message type in output array)
  const data = response.data;
  const messageOutput = data?.output?.find((o) => o.type === 'message');
  const content =
    messageOutput?.content?.[0]?.text ||
    data?.output?.[0]?.content?.[0]?.text ||
    data?.choices?.[0]?.message?.content ||
    '';

  const rawCode = content.trim();

  if (!rawCode) {
    return [];
  }

  // 按行分割，过滤空行和无效格式
  const cardCodes = rawCode
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter(
      (line) =>
        /^[A-Z]+-[A-Z]{2}\d+$/i.test(line) ||
        /^[A-Z0-9]+-[A-Z]{2}\d+$/i.test(line)
    );

  return cardCodes;
}

module.exports = { extractCardCodes };
