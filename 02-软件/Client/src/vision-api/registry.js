// 视觉识别引擎注册表
// 添加新引擎：在 engines/ 下新建文件夹，放 index.js 即可，无需修改本文件

const engineModules = import.meta.glob('./engines/*/index.js', { eager: true })

export const engines = Object.values(engineModules)
  .map(mod => mod.default)
  .filter(Boolean)

/**
 * 统一识别入口
 * @param {string} engineKey - 引擎 key
 * @param {string} filePath - 图片路径
 * @param {object} options - { prompt, versionId }
 * @returns {Promise<{ cardCode: string, cost: object }>}
 */
export async function recognize(engineKey, filePath, options = {}) {
  const engine = engines.find(e => e.key === engineKey)
  if (!engine) throw new Error('未知引擎: ' + engineKey)
  return engine.recognize(filePath, options)
}
