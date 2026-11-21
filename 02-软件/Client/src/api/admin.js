import adminRequest from './admin-request.js'
import config from '@/config/index.js'

// ============ 管理员登录 ============
export const adminLogin = (data) => adminRequest.post('/auth/admin/login', data)

// ============ 版本配置 ============

/**
 * 获取所有版本的配置
 * @returns {Promise<{ data: VersionConfig[] }>}
 */
export const getAllVersionConfigs = () => adminRequest.get('/admin/version-config')

/**
 * 获取单个版本的配置
 * @param {number} versionId
 * @returns {Promise<VersionConfig>}
 */
export const getVersionConfig = (versionId) =>
  adminRequest.get('/admin/version-config/' + versionId)

/**
 * 创建或更新版本配置
 * @param {number} versionId
 * @param {Object} data - { rarities, grades, defaultRarity, defaultGrade }
 * @returns {Promise<VersionConfig>}
 */
export const updateVersionConfig = (versionId, data) =>
  adminRequest.put('/admin/version-config/' + versionId, data)

// ============ 版本管理 ============

/**
 * 更新版本信息（名称、语言、logo）
 */
export const updateVersion = (versionId, data) =>
  adminRequest.put('/admin/versions/' + versionId, data)

/**
 * 上传版本 Logo
 * @returns {Promise<{ logoUrl: string }>}
 */
export const uploadVersionLogo = (versionId, filePath) => {
  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: config.apiBaseUrl + '/admin/versions/' + versionId + '/logo',
      filePath,
      name: 'image',
      header: {
        'Authorization': 'Bearer ' + (uni.getStorageSync('adminToken') || '')
      },
      success: (res) => {
        try {
          const data = JSON.parse(res.data)
          resolve(data)
        } catch (e) {
          reject(new Error('解析响应失败'))
        }
      },
      fail: reject
    })
  })
}

/**
 * 新增版本
 */
export const createVersion = (data) =>
  adminRequest.post('/admin/versions', data)

/**
 * 删除版本
 */
export const deleteVersion = (versionId) =>
  adminRequest.delete('/admin/versions/' + versionId)
