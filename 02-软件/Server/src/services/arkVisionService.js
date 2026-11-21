/**
 * 豆包（火山方舟 Ark）视觉调用服务 — 识别代理 / 钥匙测试共用
 *
 * 调用模板见 listing-agent/executor.js 的 callVisionForRow：
 * axios POST Ark Responses API，input_image 直接传 base64 dataURL，Bearer 免签名。
 */
const axios = require('axios');

const DEFAULT_TIMEOUT = 60000;

/**
 * 调 Ark 视觉模型
 * @param {object} opts
 * @param {string} opts.apiKey       钥匙明文
 * @param {string} opts.apiUrl       方舟接口地址
 * @param {string} opts.model        模型名
 * @param {string} opts.imageDataUrl 图片 dataURL（data:image/jpeg;base64,...）
 * @param {string} opts.prompt       提示词
 * @returns {Promise<{text: string, totalTokens: number, latencyMs: number}>}
 * @throws 调用失败抛 Error
 */
async function callArkVision({ apiKey, apiUrl, model, imageDataUrl, prompt }) {
  const start = Date.now();
  const res = await axios.post(
    apiUrl,
    {
      model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: imageDataUrl },
          ],
        },
      ],
    },
    {
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      timeout: DEFAULT_TIMEOUT,
    }
  );

  const data = res.data;
  const latencyMs = Date.now() - start;
  const totalTokens = data?.usage?.total_tokens || 0;

  // 解析输出文本：兼容不同模型/版本的 output 结构
  let text = '';
  const output = data?.output;
  if (Array.isArray(output)) {
    for (const o of output) {
      if (o.type === 'message' && typeof o.content === 'string') {
        text += o.content;
      } else if (o.type === 'message' && Array.isArray(o.content)) {
        for (const c of o.content) {
          if (c.type === 'output_text' && c.text) text += c.text;
          else if (c.type === 'text' && c.text) text += c.text; // 兼容旧字段
        }
      }
    }
  }

  return { text: text.trim(), totalTokens, latencyMs };
}

module.exports = { callArkVision };
