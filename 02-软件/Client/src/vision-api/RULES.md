# 视觉API引擎对接规则

> 每次添加新的识别API必须阅读本规则，确保接口统一、选择器自动生效。

---

## 一、目录结构

```
vision-api/
  RULES.md              ← 本文件
  registry.js           ← 引擎注册表
  EngineSelector.vue    ← 选择器UI组件（无需修改）
  engines/
    doubao/index.js     ← 豆包视觉
    backend-ocr/index.js ← 后端OCR
    新引擎/index.js     ← 新建的引擎放这里
```

---

## 二、引擎文件规范

每个引擎必须 export default 一个对象，包含以下字段：

```js
export default {
  key: '引擎唯一key',        // 字母数字横杠，如 'my-api'
  label: '显示名称',         // 在选择器中显示，如 '我的API'

  /**
   * 识别函数 — 必须实现
   * @param {string} filePath  - 图片路径（data: URL 或临时文件路径）
   * @param {object} options   - { prompt, versionId, ... }
   * @returns {Promise<{ cardCode: string, cost?: { tokens?: number, total?: number, ... } }>}
   */
  async recognize(filePath, options) {
    // 1. 读取图片转 base64（如需要）
    // 2. 调用API
    // 3. 返回 { cardCode, cost }
    return { cardCode: '', cost: {} }
  }
}
```

### 返回值规范

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `cardCode` | string | ✅ | 识别出的卡牌编号，如 `QCAC-JP001`，失败返回空字符串 |
| `cost` | object | 否 | 消耗信息，会显示在API栏 |
| `cost.tokens` | number | 否 | Token消耗量（豆包类API） |
| `cost.total` | number | 否 | 总费用（后端OCR类API） |

---

## 三、注册引擎

编辑 `registry.js`：

```js
// 1. import
import myEngine from './engines/新引擎/index.js'

// 2. 加入 engines 数组
export const engines = [doubao, backendOcr, myEngine]
```

**完成！** 无需修改任何其他文件。

---

## 四、API密钥管理

密钥统一通过 `.env` 环境变量管理，在引擎代码中读取：

```js
const API_KEY = import.meta.env.VITE_MY_API_KEY || '默认值'
const API_URL = import.meta.env.VITE_MY_API_URL || 'https://默认地址'
```

环境变量命名规范：`VITE_` 前缀 + 大写下划线。

---

## 五、图片 base64 转换工具

如果API需要 base64 格式图片，引擎内部自行处理：

```js
// data: URL → 纯base64
if (filePath.startsWith('data:')) {
  base64 = filePath.split(',')[1]
}
// 远程blob URL → base64（仅H5环境）
else {
  base64 = await new Promise((resolve, reject) => {
    fetch(filePath).then(r => r.blob()).then(blob => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result.split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(blob)
    }).catch(reject)
  })
}
```

---

## 六、验证

1. 构建通过：`npx uni build -p h5`
2. 选择器自动出现新选项
3. 拍照识别正常返回卡牌编号
4. 模式切换后偏好保留
