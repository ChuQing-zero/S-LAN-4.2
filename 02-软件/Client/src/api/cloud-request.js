import config from '@/config/index.js'

// 错误消息 → 中文翻译
const ERROR_ZH = {
  'Unauthorized': '云端未授权，请检查连接配置',
  'Internal server error': '云端服务器内部错误',
  'Library not found': '云端库不存在',
  'Card not found': '卡牌不存在',
  'Source library not found': '源库不存在',
  'Target library not found': '目标库不存在',
  'User not found': '用户不存在',
  'name is required': '名称为必填项',
  'libraryCode is required': '库代码为必填项',
  'q is required': '搜索关键词为必填项',
  'fromCode, toCode and cardIds are required': '缺少必填参数',
  'Library already exists': '库编号已被使用，请换一个',
  'duplicate key': '库编号已存在，请换一个编号',
  'Forbidden': '无权访问该资源',
  'type must be local or cloud': '库类型必须为 local 或 cloud',
  'code is required': '卡牌编号为必填项',
  'Cloud library with same code already exists': '云端已存在同名库，请先删除或重命名',
}

const t = (msg) => {
  if (!msg) return ''
  if (ERROR_ZH[msg]) return ERROR_ZH[msg]
  // MongoDB 重复键模糊匹配
  if (msg.includes('E11000') || msg.includes('duplicate key')) return '库编号已存在，请换一个编号'
  return msg
}

// 动态获取云端服务器地址（优先用户配置 → env → 默认同本地）
const getCloudBase = () => {
  return uni.getStorageSync('cloudApiUrl')
    || config.cloudApiBaseUrl
}

// 401 未授权处理 — 用于 Token 过期场景
const handleUnauthorized = () => {
  uni.removeStorageSync('token')
  uni.removeStorageSync('user')
  uni.showToast({ title: '登录已过期，请重新登录', icon: 'none', duration: 2000 })
  setTimeout(() => {
    uni.reLaunch({ url: '/pages/login/login' })
  }, 2000)
}

const cloudRequest = (options) => {
  return new Promise((resolve, reject) => {
    const token = uni.getStorageSync('token') || ''
    uni.request({
      url: getCloudBase() + options.url,
      method: options.method || 'GET',
      data: options.data ? JSON.parse(JSON.stringify(options.data)) : undefined,
      header: {
        ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
        'Content-Type': 'application/json',
        ...options.header
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
        } else if (res.statusCode === 401) {
          // 登录页的 401 是正常业务错误，不触发未授权跳转
          const pages = getCurrentPages()
          const currentPage = pages[pages.length - 1]
          if (currentPage && currentPage.route === 'pages/login/login') {
            reject(new Error('Unauthorized'))
          } else {
            handleUnauthorized()
            reject(new Error(t(res.data?.error) || '云端未授权'))
          }
        } else {
          const errMsg = res.data?.error || ''
          const err = t(errMsg) || `云端请求失败 (${res.statusCode})`
          if (res.statusCode !== 404) {
            uni.showToast({ title: err, icon: 'none' })
          }
          reject(new Error(err))
        }
      },
      fail: (err) => {
        uni.showToast({ title: '无法连接云端服务器，请检查配置', icon: 'none' })
        reject(err)
      }
    })
  })
}

export default {
  get: (url, params) => {
    let query = ''
    if (params) {
      const qs = Object.entries(params)
        .filter(([_, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
        .join('&')
      if (qs) query = '?' + qs
    }
    return cloudRequest({ url: url + query, method: 'GET' })
  },
  post: (url, data) => cloudRequest({ url, method: 'POST', data }),
  put: (url, data) => cloudRequest({ url, method: 'PUT', data }),
  delete: (url) => cloudRequest({ url, method: 'DELETE' })
}
