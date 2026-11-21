// 豆包视觉识别引擎
// 钥匙由后端统一管理（后台管理页配置），前端不再持有任何 key / URL / 模型常量。
// 调用后端代理 /v1/api/vision/doubao-recognize（base64 dataURL），换钥匙/换URL一处生效。

import { doubaoRecognize } from '@/api/index.js'

export default {
  key: 'doubao',
  label: '豆包视觉',

  async recognize(filePath, options = {}) {
    const o = typeof options === 'string' ? {} : (options || {})
    const source = o.source || 'single'
    const keyId = o.keyId || undefined

    // 压缩大图（手机拍照可能数MB，API拒绝）
    const dataUrl = await new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const maxW = 2048, maxH = 2048
        let w = img.width, h = img.height
        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h)
          w = Math.round(w * ratio), h = Math.round(h * ratio)
        }
        const canvas = document.createElement('canvas')
        canvas.width = w, canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.7))
      }
      img.onerror = () => {
        // 压缩失败：直接读原始文件转 dataURL
        fetch(filePath).then(r => r.blob()).then(blob => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result || '')
          reader.onerror = () => resolve('')
          reader.readAsDataURL(blob)
        }).catch(() => resolve(''))
      }
      img.src = filePath
    })

    if (!dataUrl) throw new Error('图片读取失败')

    // 提示词由后端按「当前生效方案」拼 —— 这里只报"我是哪个版本"。
    // promptId 只有批量识别会传（锁定整批用同一套，不受中途切换影响）。
    const body = await doubaoRecognize({
      image: dataUrl,
      source,
      versionId: o.versionId,
      versionName: o.versionName,
      versionLang: o.versionLang,
      rarity: o.rarity || undefined,
      promptId: o.promptId || undefined,
      ...(keyId ? { keyId } : {}),
    })

    return {
      cardCode: body.cardCode,
      recognized: body.recognized,
      promptKey: body.promptKey,
      cost: { tokens: body.tokens || 0, total: body.costYuan || 0, engine: 'doubao' }
    }
  }
}
