/**
 * 拣货清单长图 —— 把一单的拣货明细拼成一张（太长就自动切成多张）PNG，直接在浏览器里下载。
 *
 * 左边卡图、右边编号/卡名/品相/卡位；表头写这一单的全部信息（订单编号、交易时间、
 * 买家、快递、取件码、共几张、已拣几张、生成时间）。
 *
 * ★ 为什么是**纯前端 Canvas**，不走服务端 sharp：
 *   · 卡图接口 `/api/tcg/card-thumbnail`、`/api/tcg/card-image` **免鉴权、跟页面同源**
 *     —— 画进 canvas 不污染画布，`toBlob` 能正常导出（跨域图会让导出直接失败）；
 *   · 中文用浏览器自带字体，**零字体配置**。服务端 sharp 写中文要装中文字体，
 *     那是这条路上最大的坑，为了它多起一个进程不划算；
 *   · 导出用现成套路 Blob + `<a download>`（同 `pages/admin/tcg-paths.vue`）。
 *
 * ★ 代价：`document` / `canvas` 是浏览器 API，**这一份只能在 H5 跑**。
 *   调用处（`order-processing.vue` 的按钮）必须用 `#ifdef H5` 圈起来，
 *   否则 App 端打包进去会在点按钮时炸掉。
 */

import { CARD_BACK } from '@/api/cardDb.js'

// —— 排版常量（全按「逻辑像素」算，最后统一乘 k 缩放）——
// 想改图的长宽，动这几个数就行：`画布宽` 是左右总宽（900 → 720 收窄过一次，
// 再窄就往 640 走），`卡图宽` 是左边卡图占的宽度，`行高` 跟着卡图高走。
const 画布宽 = 480
const 内边距 = 32
const 底部高 = 48
const 卡图宽 = 150
const 卡图高 = Math.round(卡图宽 * 1.45) // 游戏王卡面比例 ≈ 59:86
const 图间距 = 24 // ★ 卡图右边缘 → 文字左边 的那段空隙，就是它
const 行高 = 卡图高 + 26
const 字体 = '-apple-system, "Microsoft YaHei", "PingFang SC", sans-serif'

/**
 * 单个 canvas 的 device 像素上限：Chrome 大约 16384px，超了不报错、直接给你一张空白。
 * 所以行数多的时候**必须分张**，不能画一张超高的图然后指望导出成功。
 */
const 设备上限 = 16000

// —— 取图 ——
// 图缓存里存 Promise（跨张去重），已加载图里存 Image（画的时候**同步**取 ——
// 不然画到一半图还没到，导出的 PNG 就缺图）。
const 图缓存 = new Map()
const 已加载图 = new Map()

/** 带超时的取图；挂一张不许把整张长图拖死。`备选` 用于首选图落空时退一级。 */
const 取图 = (url, 备选) => {
  if (!url) return 备选 ? 取图(备选, '') : Promise.resolve(null)
  if (图缓存.has(url)) return 图缓存.get(url)
  const p = new Promise((resolve) => {
    const img = new Image()
    const t = setTimeout(() => resolve(null), 8000)
    img.onload = () => { clearTimeout(t); resolve(img) }
    img.onerror = async () => {
      clearTimeout(t)
      // 首选是原图（card-image），图源里没有那一档时会 404 → 退回列表用的缩略图，
      // 再不行才让调用方画灰块，别整行空着。
      resolve(备选 ? await 取图(备选, '') : null)
    }
    img.src = url
  })
  图缓存.set(url, p)
  return p
}

/**
 * 列表里用的是 200px 缩略图（`card-thumbnail`），长图是给人看/发给买家的，优先用原图。
 * 只做**字符串替换**：编号、罕贵、卡密都在 query 里原样带过去，不用再问一次目录。
 */
const 换原图 = (url) => (url && url.includes('/card-thumbnail?'))
  ? url.replace('/card-thumbnail?', '/card-image?')
  : ''

// —— 画图小工具 ——

const 圆角矩形 = (ctx, x, y, w, h, r) => {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return }
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

/** 超宽就截断加省略号 —— 卡名长的能顶出画布右边 */
const 截断 = (ctx, 文, 最大宽) => {
  const s = String(文 == null ? '' : 文)
  if (ctx.measureText(s).width <= 最大宽) return s
  let out = s
  while (out.length > 1 && ctx.measureText(out + '…').width > 最大宽) out = out.slice(0, -1)
  return out + '…'
}

const 画卡图 = (ctx, img, x, y, w, h) => {
  ctx.save()
  圆角矩形(ctx, x, y, w, h, 6); ctx.clip()
  if (!img) {
    ctx.fillStyle = '#e9ecf1'; ctx.fillRect(x, y, w, h)
    ctx.fillStyle = '#9aa3b0'; ctx.font = `500 ${Math.round(w * 0.16)}px ${字体}`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('无图', x + w / 2, y + h / 2)
  } else {
    // aspectFill：按目标比例从源图中间裁一块，别把卡面拉变形
    const 比 = w / h, 源比 = img.width / img.height
    let sx = 0, sy = 0, sw = img.width, sh = img.height
    if (源比 > 比) { sw = img.height * 比; sx = (img.width - sw) / 2 }
    else { sh = img.width / 比; sy = (img.height - sh) / 2 }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
  }
  ctx.restore()
  ctx.strokeStyle = '#dfe3ea'; ctx.lineWidth = 1
  圆角矩形(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 6); ctx.stroke()
}

/** 表头：写这一单的全部信息。**返回画完后的 y**（拿它当第一行的起点）。
 *
 * 全部左对齐 —— 右侧不留任何东西（原来那两处右对齐的「状态」和「已拣 M 张」，
 * 按用户要求去掉了，右半边空出来的地方正好让文字铺开）。
 * 交易时间、创建时间**各占一行**。 */
const 画表头 = (ctx, 订单, 张序, 总张数, 买家, 总张) => {
  const x = 内边距
  const 右 = 画布宽 - 内边距
  let y = 内边距

  ctx.textAlign = 'left'; ctx.textBaseline = 'top'

  // 第一行：订单简称（大字）
  ctx.fillStyle = '#111'; ctx.font = `700 30px ${字体}`
  ctx.fillText(截断(ctx, 订单.shortName || ('订单 ' + (订单.orderNo || '')), 右 - x), x, y)
  y += 44

  // 订单编号单独一行加粗 —— 对着系统核对靠它，不能被别的信息淹掉
  ctx.fillStyle = '#111'; ctx.font = `700 19px ${字体}`
  ctx.fillText('编号  ' + (订单.orderNo || '—'), x, y)
  y += 28
  ctx.fillStyle = '#555'; ctx.font = `15px ${字体}`
  ctx.fillText('交易  ' + 时间(订单.tradeTime), x, y)
  y += 24
  ctx.fillText('创建  ' + 时间(订单.createdAt), x, y)
  y += 24
  if (买家) { ctx.fillText('买家  ' + 截断(ctx, 买家, 右 - x), x, y); y += 24 }
  ctx.fillText('快递  ' + (订单.courierCode || '—') + '      取件码  ' + (订单.pickupCode || '—'), x, y)
  y += 24

  ctx.fillStyle = '#111'; ctx.font = `700 17px ${字体}`
  ctx.fillText(`共 ${总张} 张` + (总张数 > 1 ? `      （第 ${张序}/${总张数} 张）` : ''), x, y)
  y += 26

  ctx.fillStyle = '#8a93a0'; ctx.font = `13px ${字体}`
  ctx.fillText('生成时间  ' + 现在(), x, y)
  y += 24

  ctx.strokeStyle = '#cfd6e0'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(x, y + 6); ctx.lineTo(右, y + 6); ctx.stroke()
  return y + 22
}

/** 拿一个废弃画布量**真**表头高 —— 估数写小了会把最后几行裁掉。 */
const 量表头高 = (订单, 买家, 总张) => {
  const cv = document.createElement('canvas')
  return 画表头(cv.getContext('2d'), 订单, 1, 1, 买家, 总张)
}

const 画一行 = (ctx, r, y, 第几张, 总张) => {
  const x = 内边距
  const 图上 = y + (行高 - 卡图高) / 2

  // 从**已加载**缓存同步取（加载在 画一张 里已经 await 过了）
  画卡图(ctx, 已加载图.get(r.图) || null, x, 图上, 卡图宽, 卡图高)

  const tx = x + 卡图宽 + 图间距
  // 行尾不再有「已拣/待拣」角标，文字可以一直铺到右内边距
  const 文字宽 = 画布宽 - 内边距 - tx
  const 行数 = 5                                  // 编号 / 卡名 / 品相 / 卡位 / 第几张
  let ty = y + (行高 - (行数 * 26 + 6)) / 2

  ctx.textAlign = 'left'; ctx.textBaseline = 'top'

  ctx.fillStyle = '#111'; ctx.font = `700 20px ${字体}`
  ctx.fillText(截断(ctx, (r.编号 || '') + (r.罕贵 ? '  ' + r.罕贵 : ''), 文字宽), tx, ty)
  ty += 27

  ctx.fillStyle = '#333'; ctx.font = `17px ${字体}`
  ctx.fillText(截断(ctx, r.中文名 || '—', 文字宽), tx, ty)
  ty += 25

  ctx.fillStyle = '#666'; ctx.font = `15px ${字体}`
  ctx.fillText(截断(ctx, '品相  ' + r.品相 + (r.备注 ? '（' + r.备注 + '）' : ''), 文字宽), tx, ty)
  ty += 23

  ctx.fillStyle = '#8a93a0'; ctx.font = `14px ${字体}`
  ctx.fillText(截断(ctx, '卡位  ' + (r.卡位 || '—'), 文字宽), tx, ty)
  ty += 24

  // 第几张 —— 拣货时对数量用。**序号是整单连续的**，分张之后第 2 张图接着 31 往下数
  ctx.fillStyle = '#2f6fed'; ctx.font = `700 15px ${字体}`
  ctx.fillText(截断(ctx, `第 ${第几张} 张卡牌 · 共 ${总张} 张卡牌`, 文字宽), tx, ty)
}

/** 画一张（一张饼 = 一个 canvas）。必须先把这一张用到的图全部加载完再落笔。 */
const 画一张 = async (订单, 行们, 张序, 总张数, k, 买家, 总张, 表头高, 起始序) => {
  await Promise.all([...new Set(行们.map((r) => r.图).filter(Boolean))].map(async (u) => {
    if (!已加载图.has(u)) 已加载图.set(u, await 取图(u, 缩略图备选(u)))
  }))

  const 逻辑高 = 表头高 + 行们.length * 行高 + 底部高
  const cv = document.createElement('canvas')
  cv.width = Math.round(画布宽 * k)
  cv.height = Math.round(逻辑高 * k)
  const ctx = cv.getContext('2d')
  ctx.scale(k, k)
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 画布宽, 逻辑高)

  let y = 画表头(ctx, 订单, 张序, 总张数, 买家, 总张)
  for (let i = 0; i < 行们.length; i++) {
    if (i > 0) {
      ctx.strokeStyle = '#eef0f4'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(内边距, y + 0.5); ctx.lineTo(画布宽 - 内边距, y + 0.5); ctx.stroke()
    }
    // ★ `+ 1`：起始序是「前面已经画过几张」，序号从 1 起，别写漏了变成「第 0 张」
    画一行(ctx, 行们[i], y, 起始序 + i + 1, 总张)
    y += 行高
  }
  ctx.fillStyle = '#8a93a0'; ctx.font = `14px ${字体}`; ctx.textAlign = 'center'
  ctx.fillText(`共 ${总张} 张` + (总张数 > 1 ? ` · 第 ${张序}/${总张数} 张` : ''), 画布宽 / 2, y + 20)
  return cv
}

// 原图 404 时的退路：换回缩略图（同一个 query，只换路径段）
const 缩略图备选 = (url) => (url && url.includes('/card-image?'))
  ? url.replace('/card-image?', '/card-thumbnail?')
  : ''

// —— 时间文案 ——
const 补零 = (n) => String(n).padStart(2, '0')
const 时间 = (t) => {
  if (!t) return '—'
  const d = new Date(t)
  if (isNaN(d.getTime())) return '—'
  return `${d.getFullYear()}-${补零(d.getMonth() + 1)}-${补零(d.getDate())} ${补零(d.getHours())}:${补零(d.getMinutes())}`
}
const 现在 = () => 时间(new Date())

/** 现成套路：Blob + `<a download>`（同 tcg-paths.vue） */
const 存档 = (blob, 文件名) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 文件名
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/**
 * 生成并下载拣货清单长图。行数太多会**自动分张**（见 `设备上限`），全部依次下载。
 *
 * @param {object} 订单  订单详情（`shortName` / `orderNo` / `status` / `tradeTime` / `createdAt` /
 *                       `courierCode` / `pickupCode`）
 * @param {Array}  行们  一行一张物理卡：`{ 图, 编号, 罕贵, 中文名, 品相, 备注, 卡位 }`
 *                       `图` 给列表用的缩略图地址即可，本函数会自己换原图试试
 *                       （`已拣` 字段已不再画进图里，页面仍可照传，本函数不看）
 * @param {object} 选项  `{ 买家 }` —— 页面 `buyerLine` 的结果，直接透传，别在这边重算
 * @returns {Promise<{张数:number, 行数:number}>}
 */
export async function 导出拣货清单长图(订单, 行们, { 买家 = '' } = {}) {
  if (!订单 || !行们 || !行们.length) return { 张数: 0, 行数: 0 }

  // 列表里是缩略图，长图优先上原图 —— 但保留缩略图当退路（图源里没有能直接命中的原图时）
  const 画的行 = 行们.map((r) => {
    const 缩略 = r.图 || ''
    const 原 = 换原图(缩略)
    return { ...r, 图: 原 || 缩略 || CARD_BACK }
  })

  const k = Math.min(typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1, 2)
  const 总张 = 画的行.length

  const 表头高 = 量表头高(订单, 买家, 总张)
  const 逻辑高上限 = 设备上限 / k
  const 每张行数 = Math.max(1, Math.floor((逻辑高上限 - 表头高 - 底部高) / 行高))
  const 总张数 = Math.max(1, Math.ceil(总张 / 每张行数))

  for (let s = 0; s < 总张数; s++) {
    const 块 = 画的行.slice(s * 每张行数, (s + 1) * 每张行数)
    const cv = await 画一张(订单, 块, s + 1, 总张数, k, 买家, 总张, 表头高, s * 每张行数)
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'))
    if (!blob) continue
    存档(blob, `清单_${订单.orderNo || '订单'}${总张数 > 1 ? `_${s + 1}of${总张数}` : ''}.png`)
    // 连点下载浏览器会拦，张与张之间隔一下，给它个喘气的机会
    if (s < 总张数 - 1) await new Promise((r) => setTimeout(r, 400))
  }
  return { 张数: 总张数, 行数: 总张 }
}
