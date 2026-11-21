/**
 * 带鉴权的 fetch — 自动附加 Bearer token
 * 用法与原生 fetch 相同: authFetch(url, options)
 */
export function authFetch(url, options = {}) {
  const token = uni.getStorageSync('token') || ''
  const headers = { ...(options.headers || {}) }
  if (token && !headers['Authorization'] && !headers['authorization']) {
    headers['Authorization'] = 'Bearer ' + token
  }
  return fetch(url, { ...options, headers })
}

export default authFetch
