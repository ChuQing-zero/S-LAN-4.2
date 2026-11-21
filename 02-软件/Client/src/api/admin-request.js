import config from '@/config/index.js'

// 管理员错误消息 → 中文翻译
const ERROR_ZH = {
  'Invalid admin password': '管理员密码错误',
  'Unauthorized': '管理员未授权，请重新登录',
  'Internal server error': '服务器内部错误，请稍后重试',
  'Version config not found': '版本配置不存在',
}

const t = (msg) => ERROR_ZH[msg] || msg

// 管理员 401 未授权处理
const handleUnauthorized = () => {
  uni.removeStorageSync('adminToken')
  uni.removeStorageSync('adminUser')
  uni.showToast({ title: '登录已过期，请重新登录', icon: 'none', duration: 2000 })
  setTimeout(() => {
    uni.reLaunch({ url: '/pages/login/login' })
  }, 2000)
}

const adminRequest = (options) => {
  return new Promise((resolve, reject) => {
    const adminToken = uni.getStorageSync('adminToken') || ''
    uni.request({
      url: config.apiBaseUrl + options.url,
      method: options.method || 'GET',
      data: options.data ? JSON.parse(JSON.stringify(options.data)) : undefined,
      header: {
        ...(adminToken ? { 'Authorization': 'Bearer ' + adminToken } : {}),
        'Content-Type': 'application/json',
        ...options.header
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
        } else if (res.statusCode === 401) {
          // 管理员登录页的 401 是正常业务错误，不要清除存储
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
        } else if (res.statusCode === 403) {
          // 非管理员访问，静默失败
          reject(new Error('Forbidden'))
        } else {
          const errMsg = res.data?.error || ''
          const err = t(errMsg) || `请求失败 (${res.statusCode})`
          // 404 不弹 toast，让调用方自行处理
          if (res.statusCode !== 404) {
            uni.showToast({ title: err, icon: 'none' })
          }
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
    return adminRequest({ url: url + query, method: 'GET' })
  },
  post: (url, data) => adminRequest({ url, method: 'POST', data }),
  put: (url, data) => adminRequest({ url, method: 'PUT', data }),
  delete: (url) => adminRequest({ url, method: 'DELETE' })
}
