/**
 * 火山引擎 OCR 文字识别服务
 *
 * 关键要点（文档要求）：
 * 1. Content-Type: application/x-www-form-urlencoded（非 JSON）
 * 2. 参数名全小写: image_base64（非 ImageBase64）
 * 3. SDK contentType='urlencode' 自动处理表单编码 + 签名
 *
 * API 文档: https://www.volcengine.com/docs/86081/1660261
 */
const { Service } = require('@volcengine/openapi');
const config = require('../config');

/**
 * 对图片 Buffer 进行 OCR 识别
 * @param {Buffer} imageBuffer - 图片二进制数据
 * @param {string} language - 识别语言，默认 zh,en,jp
 * @returns {Promise<{textList: string[], allText: string}>}
 */
async function recognizeImage(imageBuffer, language = 'zh,en,jp') {
  const imageBase64 = imageBuffer.toString('base64');

  const cvService = new Service({
    accessKeyId: config.volcengine.accessKeyId,
    secretKey: config.volcengine.secretKey,
    host: 'visual.volcengineapi.com',
    region: 'cn-north-1',
    serviceName: 'cv',
  });

  // urlencode → SDK 自动设置 Content-Type: application/x-www-form-urlencoded
  const ocrApi = cvService.createAPI('OCRNormal', {
    method: 'POST',
    contentType: 'urlencode',
    Version: '2020-08-26',
  });

  console.log('[OCR] Calling cv/OCRNormal v2020-08-26 (urlencode)');

  // 参数名必须全小写: image_base64（文档强制要求）
  const data = await ocrApi({
    image_base64: imageBase64,
    language: language,
    output_char_info: 'true',
  });

  // 检查 API 错误 (code !== 10000 为失败)
  if (data && data.code && data.code !== 10000) {
    throw new Error(`OCR API Error [${data.code}]: ${data.message || 'Unknown error'}`);
  }

  // 提取文字列表
  const textList = [];
  const resData = data?.data || {};

  // 优先使用 line_texts
  const lineTexts = resData.line_texts || [];
  if (lineTexts.length > 0) {
    lineTexts.forEach((line) => {
      const txt = line.text || '';
      if (txt) textList.push(txt);
    });
  }

  // 如果 line_texts 为空，从 chars 二维数组重建每行文字
  const chars = resData.chars || [];
  if (textList.length === 0 && chars.length > 0) {
    chars.forEach((lineChars) => {
      const lineText = lineChars
        .map((c) => c.char || '')
        .join('');
      if (lineText.trim()) textList.push(lineText);
    });
  }

  const allText = textList.join('\n');
  console.log(`[OCR] Extracted ${textList.length} text lines`);

  return {
    textList,
    allText,
    rawResponse: data,
  };
}

module.exports = { recognizeImage };
