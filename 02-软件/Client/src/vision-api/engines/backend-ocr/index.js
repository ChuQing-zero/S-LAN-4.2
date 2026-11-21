// 后端OCR识别引擎
// 调用本地后端 /v1/api/vision/recognize（OCR + 正则 + LLM兜底）

import { recognizeCardByBackend } from '@/api/index.js'

export default {
  key: 'backend-ocr',
  label: '后端OCR',

  async recognize(filePath, options = {}) {
    const result = await recognizeCardByBackend(filePath, options.versionId || '1')
    return {
      cardCode: result.card_code_list?.[0] || '',
      cost: {
        total: result.cost?.total || 0,
        extractionMethod: result.extraction_method || 'unknown',
        engine: 'backend-ocr'
      }
    }
  }
}
