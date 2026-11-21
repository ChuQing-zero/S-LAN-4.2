import request from './request.js'
import cloudRequest from './cloud-request.js'
import config from '@/config/index.js'

// ============ 用户 ============
export const getUserProfile = () => request.get('/user/profile')
export const login = (data) => request.post('/auth/login', data)
export const register = (data) => request.post('/auth/register', data)

// ============ 游戏版本 ============
export const getVersions = () => request.get('/versions')

// ============ 库（本地） ============
export const getLocalLibraries = () => request.get('/libraries/local')
export const createLocalLibrary = (data) => request.post('/libraries', data)
export const updateLocalLibrary = (code, data) => request.put('/libraries/' + code, data)
export const deleteLocalLibrary = (code) =>
  request.delete('/libraries/' + code + '?type=local')

// ============ 库（云端）— 走云端服务器 ============
export const getCloudLibraries = () => cloudRequest.get('/libraries/cloud')
export const createCloudLibrary = (data) => cloudRequest.post('/libraries', data)
export const updateCloudLibrary = (code, data) => cloudRequest.put('/libraries/' + code, data)
export const deleteCloudLibrary = (code) =>
  cloudRequest.delete('/libraries/' + code + '?type=cloud')

// ============ 库（通用） ============
export const getLibraryDetail = (code, type) => {
  const req = type === 'cloud' ? cloudRequest : request
  return req.get('/libraries/' + code, type ? { type } : undefined)
}
export const createLibrary = (data) => {
  const req = data.type === 'cloud' ? cloudRequest : request
  return req.post('/libraries', data)
}
export const updateLibrary = (code, data, type = 'local') => {
  const req = type === 'cloud' ? cloudRequest : request
  return req.put('/libraries/' + code, data)
}
export const deleteLibrary = (code, type = 'local') => {
  const req = type === 'cloud' ? cloudRequest : request
  return req.delete('/libraries/' + code + '?type=' + type)
}

// ============ 卡牌 ============
export const getCards = (libraryCode, params, type = 'local') => {
  const req = type === 'cloud' ? cloudRequest : request
  return req.get('/libraries/' + libraryCode + '/cards', { ...params, type, pageSize: 1000 })
}

export const searchCards = (params) =>
  request.get('/cards/search', params)

export const createCard = (data) => request.post('/cards', data)
export const updateCard = (id, data) => request.put('/cards/' + id, data)

export const deleteCard = (id) => request.delete('/cards/' + id)

/**
 * 保存原图：前端 Canvas 压缩 → 上传后端 /cards/orig-image → 返回 /uploads/orig/xxx.jpg
 * @param {string} filePath - 拍照/选文件的 data URL 或 blob URL
 * @returns {Promise<string|null>} 原图可访问路径，失败返回 null
 */
export const saveOrigImage = async (filePath) => {
  if (!filePath) return null
  try {
    const compressed = await compressImage(filePath)
    const res = await request.post('/cards/orig-image', { dataUrl: compressed })
    return (res && res.path) || null
  } catch (e) {
    console.error('保存原图失败:', e)
    return null
  }
}

// ============ 原图缓存管理 ============
export const getOrigCache = () => request.get('/cards/orig-cache')
export const deleteOrigCache = (files) =>
  request.delete('/cards/orig-cache?files=' + encodeURIComponent(files.join(',')))

// ============ 图片缓存管理（后台管理） ============
export const getOrderPhotoCaches = () => request.get('/admin/caches/order-photos')
export const cleanupOrderPhotoCaches = (months) =>
  request.post('/admin/caches/order-photos/cleanup', { months })
export const deleteOrderPhotoCaches = (orderNos) =>
  request.post('/admin/caches/order-photos/delete', { orderNos })
export const cleanupOrigCache = (months) =>
  request.post('/admin/caches/orig/cleanup', { months })

// ============ 库存编码（编号池） ============
export const getStockCodes = () => request.get('/admin/stock-codes')
export const createStockCode = (data) => request.post('/admin/stock-codes', data)
export const claimStockCode = (data) => request.post('/admin/stock-codes/claim', data)

// ============ 豆包 API 钥匙管理（后台管理） ============
export const getApiKeys = () => request.get('/admin/api-keys')
export const createApiKey = (data) => request.post('/admin/api-keys', data)
export const updateApiKey = (id, data) => request.put('/admin/api-keys/' + id, data)
export const deleteApiKey = (id) => request.delete('/admin/api-keys/' + id)
export const testApiKey = (id) => request.post('/admin/api-keys/' + id + '/test')
export const setDefaultApiKey = (id) => request.post('/admin/api-keys/' + id + '/default')
export const getApiKeyStats = () => request.get('/admin/api-keys/stats')
export const getApiKeyUsers = () => request.get('/admin/api-keys/users')

// ============ 账号管理（仅终端管理员） ============
export const getAccounts = () => request.get('/admin/accounts')
export const updateAccount = (id, data) => request.put('/admin/accounts/' + id, data)
// 修改账号密码：需携带操作者（终端管理员）本人当前密码确认
export const changeAccountPassword = (id, data) => request.put('/admin/accounts/' + id + '/password', data)
// 替指定账号上传头像（同源部署，用相对路径即可）
export const uploadAccountAvatar = (id, filePath) => new Promise((resolve, reject) => {
  const token = uni.getStorageSync('token')
  uni.uploadFile({
    url: '/v1/api/admin/accounts/' + id + '/avatar',
    filePath,
    name: 'avatar',
    header: { 'Authorization': 'Bearer ' + (token || '') },
    success: (res) => {
      try {
        const data = JSON.parse(res.data)
        if (res.statusCode === 200) resolve(data)
        else reject(new Error(data.error || '上传失败'))
      } catch (_) {
        reject(new Error('上传失败'))
      }
    },
    fail: (err) => reject(err)
  })
})

// ============ 邀请码管理（仅终端管理员） ============
export const getInviteCodes = () => request.get('/admin/invite-codes')
export const createInviteCode = (data) => request.post('/admin/invite-codes', data)
export const updateInviteCode = (id, data) => request.put('/admin/invite-codes/' + id, data)
export const deleteInviteCode = (id) => request.delete('/admin/invite-codes/' + id)

// ============ 豆包视觉识别代理 ============
// 提示词由后端按「当前生效方案」拼，前端不再传 prompt（只传 versionId 等）。
// 批量识别传 promptId 锁定整批用同一套。
export const doubaoRecognize = (data) => request.post('/vision/doubao-recognize', data)
export const getVisionUsage = () => request.get('/vision/usage')
export const getVisionKeys = () => request.get('/vision/keys')

// ============ 提示词方案（AI识别管理页） ============
export const getPromptConfig = (params) => request.get('/vision/prompt', params)
export const setActivePrompt = (data) => request.put('/vision/prompt/active', data)
export const getPromptStats = (params) => request.get('/vision/prompt/stats', params)

// ============ 目录缺失编号清单 ============
export const getMissingCodes = (params) => request.get('/missing-codes', params)
export const getMissingCodePrefixes = () => request.get('/missing-codes/prefixes')
export const updateMissingCode = (code, data) =>
  request.put('/missing-codes/' + encodeURIComponent(code), data)
export const deleteMissingCode = (code) =>
  request.delete('/missing-codes/' + encodeURIComponent(code))

// ============ 卡牌信息记录（蓝色「信息登记」块点一下登记一条） ============
// 粒度是 **(编号, 罕贵度)**：标了 N 就只有 N 变红，标了 NPR 就只有 NPR 变红。
// `rarity === ''` 是**通配**（不限罕贵度）—— 92 条老记录全是它，行为跟改之前一样。
// 后台列表里看 / 改备注 / 删。
// 后台是两级：一级 /card-marks/prefixes 列有记录的卡包 + 各包几条，
// 点进去二级用 getCardMarks({ prefix }) 看这个包里的记录。
export const getCardMarks = (params) => request.get('/card-marks', params)
export const getCardMarkPrefixes = () => request.get('/card-marks/prefixes')
// 登记全集。返回 { items:[{code,rarity,source}], codes:[...], sources:{'CODE|RARITY':src} }
// 上传页进页面时拉一次缓存在内存里，用来判断「刚拍出来、还没走过列表接口的那张卡」
// 是不是已登记 —— 见 upload.vue 的 markedWild / markedByKey。
// **权威字段是 items**（(编号,罕贵度) 才唯一定位一条记录）；codes 只够判断"这个编号有没有登记"。
export const getCardMarkCodes = () => request.get('/card-marks/codes')
// marks: [{ code, rarity }]。老写法传 codes 字符串数组后端也认（一律当通配）。
export const markCards = (marks, libraryCode, snapshots) =>
  request.post('/card-marks', { marks, libraryCode, snapshots })
// 改哪一条 = 第三参 `目标罕贵`（走 query）；改成什么 = data 里的字段。
// 一个编号可能有多条记录（N 一条、NPR 一条），所以定位必须给 —— 不给后端会 409。
// ⚠️ `目标罕贵` 传 `''` 和**不传**是两件事：传空串 = 就要改通配那条，不传 = 让后端自己判。
export const updateCardMark = (code, data, 目标罕贵) =>
  request.put(
    '/card-marks/' + encodeURIComponent(code) +
      (目标罕贵 === undefined ? '' : '?rarity=' + encodeURIComponent(目标罕贵 || '')),
    data
  )
// 罕贵度走 query 不走路径段：空串是合法值（通配那条），路径里表达不了。
export const deleteCardMark = (code, rarity) =>
  request.delete('/card-marks/' + encodeURIComponent(code) +
    '?rarity=' + encodeURIComponent(rarity || ''))

// ============ 任务清单 ============
export const getTaskNotes = (params) => request.get('/task-notes', params)
export const createTaskNote = (data) => request.post('/task-notes', data)
export const updateTaskNote = (id, data) => request.put('/task-notes/' + id, data)
export const deleteTaskNote = (id) => request.delete('/task-notes/' + id)

// ============ 上传/下载（库间转移）— 走本地后端 ============
export const transferUpload = (data) => request.post('/libraries/transfer/upload', data)
export const transferDownload = (data) => request.post('/libraries/transfer/download', data)

// ============ 罕贵度 & 品相 ============
export const getRarities = (versionId) =>
  request.get('/rarities', versionId ? { versionId } : undefined)

export const getGrades = (versionId) =>
  request.get('/grades', versionId ? { versionId } : undefined)

export const getPsaGrades = () => request.get('/grades/psa')

// ============ 卡牌目录 (TCG Database) ============
export const getTcgPacks = (params) => request.get('/tcg/packs', params)
export const getTcgPack = (code) => request.get(`/tcg/packs/${code}`)
export const searchTcgCards = (q) => request.get('/tcg/cards/search', { q })
export const saveTcgPack = (code, cards) => request.post(`/tcg/packs/${code}`, { cards })
export const getTcgStats = () => request.get('/tcg/stats')
export const getTcgPaths = () => request.get('/tcg/paths')
export const saveTcgPaths = (data) => request.put('/tcg/paths', data)
// 从当前 ID 数据目录全量重建卡库（补新包/更新卡/删残留），返回 { imported, deleted, ... }
export const importTcgData = () => request.post('/tcg/import', {})
// `getAltLabels` / `saveAltLabels`（打 /tcg/alt-labels 的那两个）随「异画标签」页一起删了（V1.2.39）。
// 标签现在是卡牌编号目录里的一列，跟着行保存走 `PUT /tcg/packs/:code`。

// 「目录数据包」= 卡牌目录 + 信息登记 + 异画标签，打成一个 JSON 文件带走。
// 导出走普通 GET（返回 JSON 文本，前端自己触发下载），不走浏览器直开链接 ——
// 这条路由要 Authorization 头，地址栏直开带不上 token，只会拿到 401。
export const exportCatalogBundle = () => request.get('/tcg/export-bundle')
// 只算不写：报「会新增多少 / 会覆盖多少 / 覆盖会删多少」，给二次确认弹窗看
export const previewCatalogBundle = (bundle) => request.post('/tcg/import-bundle/preview', bundle)
export const importCatalogBundle = (bundle, mode) => request.post('/tcg/import-bundle?mode=' + mode, bundle)

// Legacy aliases
export const catalogLookup = (params) => request.get('/tcg/cards/search', params)
export const addCatalogEntry = () => Promise.reject(new Error('请使用 saveTcgPack'))
export const listCatalog = () => getTcgPacks()
export const deleteCatalogEntry = () => Promise.reject(new Error('暂不支持'))

// ============ 库整体迁移（本地⇄云端 原地转换） ============
export const convertLibraryToCloud = (data) =>
  request.post('/libraries/convert-to-cloud', data)

export const convertLibraryToLocal = (data) =>
  request.post('/libraries/convert-to-local', data)

// ============ 订单处理 ============
// 创建订单: data = { orderNo, buyerInfo(买家信息一行, 如 "张先生 13999953090 地址"), note(可选备注), courierCode(快递码可选), pickupCode(取件码可选) }
// orderNo 手工传入（留空则后端自动生成18位），buyerInfo 可传合并行(字符串)或对象
export const createOrder = (data) => request.post('/orders', {
  orderNo: data.orderNo || '',
  buyerInfo: data.buyerInfo || '',
  note: data.note || '',
  courierCode: data.courierCode || '',
  pickupCode: data.pickupCode || ''
})
export const updateOrder = (orderNo, data) => request.put('/orders/' + orderNo, data)
// 删除订单：连同订单卡牌、拣货清单一并删除
export const deleteOrder = (orderNo) => request.delete('/orders/' + orderNo)
// 订单列表: { status(all/''/picking/shipping/done), page, pageSize, keyword, sort(pass/created) }
export const getOrders = (params = {}) => {
  const p = {}
  if (params.status) p.status = params.status
  if (params.page) p.page = params.page
  if (params.pageSize) p.pageSize = params.pageSize
  if (params.keyword) p.keyword = params.keyword
  if (params.sort) p.sort = params.sort
  return request.get('/orders', p)
}
// fresh=true: 重新进入订单时清空旧凑库结果，需重新解析
export const getOrderDetail = (orderNo, fresh) => request.get('/orders/' + orderNo, fresh ? { fresh: 1 } : undefined)
export const addOrderCards = (orderNo, items) => request.post('/orders/' + orderNo + '/cards', { items })
export const deleteOrderCard = (orderNo, cardNo) =>
  request.delete('/orders/' + orderNo + '/cards/' + cardNo)
export const updateOrderCard = (orderNo, cardNo, data) =>
  request.put('/orders/' + orderNo + '/cards/' + cardNo, data)
export const parseOrder = (orderNo) => request.post('/orders/' + orderNo + '/parse', {})
export const passOrder = (orderNo) => request.post('/orders/' + orderNo + '/pass', {})
export const getOrderPicks = (orderNo) => request.get('/orders/' + orderNo + '/picks')
export const updateOrderPick = (orderNo, pickId, pickStatus) =>
  request.put('/orders/' + orderNo + '/picks/' + pickId, { pickStatus })

// ============ 拍照留痕 ============
export const getOrderPhotos = (orderNo) => request.get('/orders/' + orderNo + '/photos')
// 拍照留痕：前端 Canvas 压缩 → 上传后端 /orders/:orderNo/photos → 返回照片记录
export const saveOrderPhoto = async (orderNo, filePath) => {
  if (!filePath) return null
  try {
    const compressed = await compressImage(filePath)
    const res = await request.post('/orders/' + orderNo + '/photos', { dataUrl: compressed })
    return res || null
  } catch (e) {
    console.error('保存拍照留痕失败:', e)
    return null
  }
}
export const deleteOrderPhoto = (orderNo, index) =>
  request.delete('/orders/' + orderNo + '/photos/' + index)

// ============ 总管理库 ============

export const getMasterLibrarySummary = (params = {}) =>
  request.get('/master-library/summary', params)

export const markCardsListed = (cardIds, listingId) =>
  request.put('/master-library/mark-listed', { cardIds, listingId })

export const markCardsUnlisted = (cardIds) =>
  request.put('/master-library/mark-unlisted', { cardIds })

// ============ 云端服务器管理（预留） ============
export const listCloudServers = () =>
  request.get('/cloud-servers')

export const addCloudServer = (data) =>
  request.post('/cloud-servers', data)

export const testCloudServer = (data) =>
  request.post('/cloud-servers/test', data)

// ============ 视觉识别（后端 API + 豆包 Doubao 降级） ============

/**
 * 调用后端视觉识别 API（主识别通道）
 * POST /vision/recognize — multipart/form-data
 * @param {string} filePath - 图片临时路径
 * @param {number|string} versionId - 游戏版本 ID，默认 "1"
 * @returns {Promise<{ jpName, cnName, code, rarity, confidence, serial }>}
 */
export const recognizeCardByBackend = (filePath, versionId = '1') => {
  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: config.apiBaseUrl + '/vision/recognize',
      filePath,
      name: 'image',
      formData: { versionId: String(versionId) },
      header: {
        'Authorization': 'Bearer ' + (uni.getStorageSync('token') || config.apiToken)
        // Content-Type 由 uni.uploadFile 自动设为 multipart/form-data
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const data = JSON.parse(res.data)
            resolve(data)
          } catch (e) {
            reject(new Error('解析识别结果失败'))
          }
        } else {
          let errMsg = '识别失败'
          try {
            const errData = JSON.parse(res.data)
            errMsg = errData.error || errMsg
          } catch (_) { /* use default */ }
          reject(new Error(errMsg))
        }
      },
      fail: (err) => {
        reject(new Error(err.errMsg || '网络请求失败'))
      }
    })
  })
}

// ============ 视觉识别（豆包 Doubao 降级） ============

/**
 * 压缩图片（H5 Canvas）— 解决大图 base64 超限问题
 * @param {string} filePath - blob URL 或 data URL
 * @returns {Promise<string>} 压缩后的 data URL
 */
const compressImage = (filePath) => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.Image) {
      // 小程序或无 Canvas 环境，直接返回原路径
      resolve(filePath)
      return
    }
    const img = new Image()
    img.onload = () => {
      const maxW = 1024
      const maxH = 1024
      let w = img.width
      let h = img.height
      if (w > maxW || h > maxH) {
        const ratio = Math.min(maxW / w, maxH / h)
        w = Math.round(w * ratio)
        h = Math.round(h * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.7))
    }
    img.onerror = () => resolve(filePath) // 加载失败用原图
    img.src = filePath
  })
}

/**
 * 识别提示词**已挪到后端**，见 Server/src/services/recognitionPrompt.js
 * 与配置文件 Storage/recognition-prompts.json。
 *
 * 之所以不在这里留一份：提示词要是前端一份、后端一份，就会有两个真相。
 * 你在「AI识别管理 → 提示词方案」页切了方案，前端这份老代码没变，
 * 结果就是"页面显示方案2、实际发出去还是方案1"——这种 bug 极难发现。
 * 现在由后端按当前生效方案拼，页面显示的那段必然就是实际发出去的那段。
 *
 * 前端识别时只需传 versionId / versionName / versionLang
 * （批量识别再多传一个 promptId 锁定整批）。
 */

// ============ 设备连接（Arduino 进料机 + 手机拍照） ============
export const getDeviceStatus = () => request.get('/device/status')
export const getDevicePhotos = () => request.get('/device/photos')
export const getDeviceInspect = () => request.get('/device/inspect')
// 照片/画面文件：<img> 直接加载（后端免鉴权），name 可含子目录（库号/图片名）
export const getDevicePhotoUrl = (name) => config.apiBaseUrl + '/device/photo/' + encodeURIComponent(name)
export const getDeviceFrameUrl = (t) => config.apiBaseUrl + '/device/frame' + (t ? '?t=' + t : '')
export const deviceScan = () => request.post('/device/scan')
export const deviceCapture = () => request.post('/device/capture')
export const deviceFocus = () => request.post('/device/focus')
export const getDeviceConfig = () => request.get('/device/config')
export const saveDeviceConfig = (data) => request.post('/device/config', data)
export const setDeviceSerial = (data) => request.post('/device/serial', data)
export const deviceLabelConfirm = () => request.post('/device/label-confirm')
export const deviceAutoStart = () => request.post('/device/auto/start')
export const deviceAutoStop = () => request.post('/device/auto/stop')
export const deviceBeep = () => request.post('/device/beep')
// V1.3 设备测试页：通用硬件指令透传
export const deviceHardware = (cmd) => request.post('/device/hardware', { cmd })
// V1.3 链路管理：USB 数据线 / ESP-01 WiFi
export const getDeviceLink = () => request.get('/device/link')
export const setDeviceLink = (data) => request.post('/device/link', data)

// 手机无线 ADB（拍照手机）
export const getPhoneStatus = () => request.get('/device/phone/status')
export const phoneDiscover = () => request.get('/device/phone/discover')
export const phoneConnect = (data) => request.post('/device/phone/connect', data || {})
export const phonePairUsb = () => request.post('/device/phone/pair_usb', {})
export const phoneDisconnect = () => request.post('/device/phone/disconnect', {})

// 送料时序测试（测试2）
export const seqStatus = () => request.get('/device/seq/status')
export const seqStart = (data) => request.post('/device/seq/start', data || {})
export const seqStop = () => request.post('/device/seq/stop', {})
export const seqClear = () => request.post('/device/seq/clear', {})

// 测试3：6 路光敏监视
export const ldrStatus = () => request.get('/device/ldr/status')
export const ldrStart = (data) => request.post('/device/ldr/start', data || {})
export const ldrStop = () => request.post('/device/ldr/stop', {})
export const ldrClear = () => request.post('/device/ldr/clear', {})
export const ldrOnce = () => request.post('/device/ldr/once', {})
export const getLdrThresholds = () => request.get('/device/ldr/thresholds')
export const saveLdrThresholds = (data) => request.post('/device/ldr/thresholds', data || {})
export const saveOutlets = (data) => request.post('/device/outlets/save', data || {})
export const getOutlets = () => request.get('/device/outlets/get')
export const speedStatus = () => request.get('/device/speed/status')
export const speedStart = (data) => request.post('/device/speed/start', data || {})
export const speedStop = () => request.post('/device/speed/stop', {})
export const speedClear = () => request.post('/device/speed/clear', {})
export const mainStart = (data) => request.post('/device/main/start', data || {})
export const mainStop = () => request.post('/device/main/stop', {})
export const mainStatus = () => request.get('/device/main/status')
export const getRules = () => request.get('/device/rules/get')
export const saveRules = (data) => request.post('/device/rules/save', data || {})
export const visionPhoto = () => request.get('/device/vision/photo')
export const visionQa = (data) => request.post('/device/vision/qa', data || {})
export const feedAutoStatus = () => request.get('/device/feedauto/status')
export const feedAutoStart = (data) => request.post('/device/feedauto/start', data || {})
export const feedAutoStop = () => request.post('/device/feedauto/stop', {})

