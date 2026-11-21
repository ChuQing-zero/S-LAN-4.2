import config from '@/config/index.js'

// 后端错误消息 → 中文翻译
const ERROR_ZH = {
  'email and password are required': '请输入邮箱和密码',
  'Invalid email or password': '邮箱或密码错误',
  'nickname, email, password and inviteCode are required': '请填写所有必填项',
  'Invalid email format': '邮箱格式不正确',
  'Email already registered': '该邮箱已被注册',
  'Invalid invite code': '邀请码无效或已被使用',
  'Internal server error': '服务器内部错误，请稍后重试',
  'Unauthorized': '未授权，请重新登录',
  'User not found': '用户不存在',
  'Library not found': '库不存在',
  'Card not found': '卡牌不存在',
  'name is required': '名称为必填项',
  'libraryCode is required': '库代码为必填项',
  'q is required': '搜索关键词为必填项',
  'fromCode, toCode and cardIds are required': '缺少必填参数',
  'Source library not found': '源库不存在',
  'Target library not found': '目标库不存在',
  'Local library not found': '本地库不存在',
  'Library already exists': '库编号已被使用，请换一个',
  'duplicate key': '库编号已存在，请换一个编号',
  'E11000': '库编号已存在，请换一个编号',
  'Forbidden': '无权访问该资源',
  'type must be local or cloud': '库类型必须为 local 或 cloud',
  'code is required': '卡牌编号为必填项',
  'Catalog entry already exists for this code': '该编号的目录条目已存在',
  'Card not found in catalog': '目录中未找到该卡牌',
  'Cloud library with same code already exists': '云端已存在同名库，请先删除或重命名',
  'Server already registered': '该服务器地址已注册',
  'name and url are required': '名称和地址为必填项',
  'url is required': '服务器地址为必填项',
}

// 翻译后端错误消息
const t = (msg) => {
  if (!msg) return ''
  if (ERROR_ZH[msg]) return ERROR_ZH[msg]
  // MongoDB 重复键模糊匹配
  if (msg.includes('E11000') || msg.includes('duplicate key')) return '库编号已存在，请换一个编号'
  return msg
}

// 401 未授权处理 — 仅用于 Token 过期场景（非登录页）
const handleUnauthorized = () => {
  uni.removeStorageSync('token')
  uni.removeStorageSync('user')
  uni.showToast({ title: '登录已过期，请重新登录', icon: 'none', duration: 2000 })
  setTimeout(() => {
    uni.reLaunch({ url: '/pages/login/login' })
  }, 2000)
}

const request = (options) => {
  return new Promise((resolve, reject) => {
    const token = uni.getStorageSync('token') || ''
    uni.request({
      url: config.apiBaseUrl + options.url,
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
          // 登录页的 401 是正常业务错误（密码错误等），不要清除存储或跳转
          const pages = getCurrentPages()
          const currentPage = pages[pages.length - 1]
          if (currentPage && currentPage.route === 'pages/login/login') {
            const err = t(res.data?.error) || '登录失败'
            uni.showToast({ title: err, icon: 'none' })
            reject(new Error(err))
          } else {
            handleUnauthorized()
            reject(new Error(t(res.data?.error) || '未授权'))
          }
        } else {
          const err = t(res.data?.error) || `请求失败 (${res.statusCode})`
          uni.showToast({ title: err, icon: 'none' })
          reject(new Error(err))
        }
      },
      fail: (err) => {
        uni.showToast({ title: '网络错误，请检查网络连接', icon: 'none' })
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
    return request({ url: url + query, method: 'GET' })
  },
  post: (url, data) => request({ url, method: 'POST', data }),
  put: (url, data) => request({ url, method: 'PUT', data }),
  delete: (url) => request({ url, method: 'DELETE' })
}
