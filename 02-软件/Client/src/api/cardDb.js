/**
 * 卡牌数据库查询层
 *
 * 数据源：Node.js BE (:3000) MongoDB CardCatalog
 * 卡图：BE /api/tcg/card-image
 */
const API_BASE = '/api/tcg'

/**
 * 统一查询：按卡牌编号查完整信息
 * 返回格式：{ jpName, cnName, extCode, imageUrl, rarity }
 */
export async function lookupCard(code, rarity) {
  if (!code) return null
  try {
    let url = `${API_BASE}/card?code=${encodeURIComponent(code.trim())}`
    if (rarity) url += `&rarity=${encodeURIComponent(rarity)}`
    const resp = await fetch(url)
    if (!resp.ok) return null
    const data = await resp.json()
    if (!data?.found) return null
    const card = data.card
    const firstRarity = rarity || (card.rarity || '').split(/[、,，]/)[0]?.trim() || ''
    return {
      jpName: card.jp_name || '',
      cnName: card.cn_name || '',
      extCode: card.password || '',
      imageUrl: getCardImageUrl(card.password, card.code, firstRarity),
      rarity: card.rarity || '',
      hasAltArt: card.has_alt_art || false,
      altCount: card.alt_count || 1,
      altRarity: card.alt_rarity || '', // 实际有异画文件的罕贵（可能不同于 DB 罕贵）
      altLabels: card.alt_labels || {},
    }
  } catch {
    return null
  }
}

/**
 * 查这张卡该用哪个异画号；拿不准一律回 0（原画）。
 *
 * 为什么需要它：订单卡（`order_cards`）上存的是**标签**（从编号括号里解析出来的「初版」），
 * 没有异画号，而拼卡图 URL 要的是号 —— 目录的 `alt_labels`（键是 `${罕贵}|${异画号}`）正好能反查。
 *
 * **只在图源里真有异画文件时才给号**（`altRarity` 非空就是这个信号，它由后端扫图源文件名得出）。
 * 少了这道闸会出反效果：`altIndex ≥ 1` 时后端要 `${编号}-${罕贵}-${异画号}` 整段命中，
 * 图源里没有那个文件就 404 → 卡背 —— 比老老实实出原画还差。
 *
 * 反查不到也回 0：宁可少给一张异画，也别猜一个号出来指到别的卡图上。
 * 只在**同一罕贵度**内找：不同罕贵的标签可能撞名，跨罕贵匹配会指错。
 *
 * @param {object} 目录项 `拉目录` 的一项（用 `altRarity` 和 `altLabels`）
 */
export function 查异画号(目录项, rarity, altLabel) {
  const { altRarity, altLabels } = 目录项 || {}
  if (!altRarity) return 0
  const 标签 = String(altLabel == null ? '' : altLabel).trim()
  if (!标签) return 0
  const 前缀 = String(rarity || '') + '|'
  for (const k of Object.keys(altLabels || {})) {
    if (!k.startsWith(前缀)) continue
    if (String(altLabels[k]).trim() !== 标签) continue
    const n = parseInt(k.slice(前缀.length), 10)
    if (n > 0) return n
  }
  return 0
}

/** 每次批量查的编号数。200 是后端 `批量查上限` 之下留了余量的值。 */
const 每批编号数 = 200

/**
 * 按编号**批量**问目录 → `{ 编号: { extCode, cnName, jpName, altLabels } }`
 *
 * 卡密（`extCode`）是**目录**的属性，不是 cards 文档的 —— 同一编号的所有实体卡卡密都一样，
 * 而 `Card.extCode` 只是识别流程的快照（清库前 38,767 张里只有 42 张填过）。要拼卡图 URL
 * 就得来这儿拿，别读卡文档上那个。见 `Server/src/routes/libraries/index.js` 里
 * 「一律以目录为准，取不到才退回快照」那条规矩。
 *
 * 走 `POST /api/tcg/cards`（一次 `$in` 查库），不是按编号循环 `GET /card`：
 * 真库一批有 8562 个编号，逐个查就是 8562 个 HTTP 同时压上去。浏览器同域只开 6~10 条连接，
 * 其余全排队，整页的图片和别的接口一起被饿死 —— 那才是"点什么都卡"的由来（V1.2.83 治的）。
 *
 * **分块串行**（每批 200），不是 `Promise.all` 全打出去 —— 那样只是把排队挪个地方。
 *
 * @param {string[]} codes 编号。**原样传入**，键就是原样：后端 `codes` 也是原样回键的，
 *                         差一个字符（大小写/空格）这条就永远命中不上。
 * @returns {Promise<Object>} 查不到的编号**不在表里**（调用方按「没拿到」处理，别当成空卡密）。
 *   每项：`{ extCode, altRarity, cnName, jpName, altLabels }`
 *   —— `altRarity` / `altLabels` 给异画用，见 `查异画号`。
 */
export async function 拉目录(codes) {
  const 表 = {}
  const 要查 = [...new Set((codes || []).filter(Boolean))]
  for (let i = 0; i < 要查.length; i += 每批编号数) {
    const 块 = 要查.slice(i, i + 每批编号数)
    try {
      const r = await fetch(`${API_BASE}/cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: 块 }),
      })
      const d = await r.json()
      // ★ 失败的响应**整块跳过**。后端失败时刻意不带 `missing`（见 tcg/index.js 那段注释），
      //   就是不让一次网络抖动被读成「这些编号在目录里真没有」。这里配合它：不写表、下次刷新再试。
      if (!d || !d.ok) continue
      const 卡们 = d.cards || {}
      for (const code of 块) {
        const c = 卡们[code]
        if (!c) continue
        // API 的字段名是 password（卡密）
        表[code] = {
          extCode: c.password || '',
          cnName: c.cn_name || '',
          jpName: c.jp_name || '',
          altLabels: c.alt_labels || {},
          // 异画专属：图源里真有异画文件的那个罕贵。异画（altIndex ≥ 1）**必须**用它，
          // 因为后端要 `{编号}-{罕贵}-{异画号}` 整段命中，而库里写的罕贵常和图源那一段不一样
          // （库里 SER、文件叫 SER-1/DSER），拿库里的值必然 404。
          altRarity: c.alt_rarity || '',
        }
      }
    } catch (_) { /* 网络失败不算「查不到」 */ }
  }
  return 表
}

/**
 * 全站统一的占位图 = KONAMI 卡背。
 * 图落空（404）时一律回退到它。
 *
 * ⚠️ 别再拿 `/static/icons/ic_card_placeholder.png` 当卡背 —— 那张图实际是
 * 「閃刀姫-カガリ」的一张**真卡图**，图挂了却显示一张无关的真卡，比裂图更容易骗人。
 * 它只该用于「还没加载」这种中性场合。
 */
export const CARD_BACK = '/static/icons/YO-GI-OH-card_placeholder.png'

/**
 * 卡密的形态规则 —— 与后端 `Server/src/services/cardPassword.js` **必须逐字一致**。
 *
 * 前端先拦一道只是省得白跑一趟；真正的门在服务端。这条规则是**路径穿越防线**
 * （卡密会被拼进 `YGOPro\{卡密}.jpg`），不是美观问题，两边别各改各的。
 *
 * V1.2.73 从「1–12 位数字」放宽成字母/数字/下划线/短横线 —— 因为「代号」本来就能填，
 * 编号（`AT03-JP009`）自然也该能当卡密用。
 */
export const 卡密正则 = /^[A-Za-z0-9_-]{1,64}$/
export const 卡密说明 = '只能是字母、数字、下划线或短横线，1–64 位'
/** 非空才算合法 */
export const 卡密合法 = (s) => 卡密正则.test(String(s == null ? '' : s))
/** 合法或留空（清空卡密是合法动作） */
export const 卡密可留空 = (s) => {
  const v = String(s == null ? '' : s)
  return !v || 卡密正则.test(v)
}

/**
 * 卡图 URL 统一入口 —— 所有页面都从这里拼，别再各写一份。
 *
 * 后端契约（2026-09-29 起）：同时带 code 和 rarity = **精准模式**，
 * 只认 `{编号}-{罕贵}` / `{编号}-{罕贵}-{异画号}` 整段命中，落空直接 404。
 * 所以：
 *   • rarity 给空 = 退回旧的逐级兜底链（一定尽力给张图）
 *   • 异画（altIndex ≥ 1）**必须**用 altRarity —— 后端要求整段命中，而库里写的
 *     罕贵度跟文件名那一段几乎从不一样（库里 SER、文件叫 SER-1/DSER），
 *     用库里的值必然 404，这正是「异画切换看不出变化」的一半原因。
 *
 * @param {string}  o.password 卡密（必填，空则返回空串让调用方直接显示卡背）
 * @param {string}  o.code     编号
 * @param {string}  o.rarity   罕贵度（库里的值）
 * @param {string}  o.altRarity 图源派生的罕贵度（GET /api/tcg/card 的 alt_rarity）
 * @param {number}  o.altIndex 异画序号，0 = 原画
 * @param {boolean} o.thumb    true = 200px 缩略图（列表用），false = 原图（大图用）
 */
export function buildCardImgUrl({ password, code, rarity, altRarity, altIndex = 0, thumb = true } = {}) {
  if (!password) return ''
  const rarityUsed = (altIndex > 0 ? (altRarity || rarity) : rarity) || ''
  let url = `${API_BASE}/${thumb ? 'card-thumbnail' : 'card-image'}?password=${encodeURIComponent(String(password))}`
  if (code) url += `&code=${encodeURIComponent(code)}`
  if (rarityUsed) url += `&rarity=${encodeURIComponent(rarityUsed)}`
  if (altIndex > 0) url += `&altIndex=${altIndex}`
  return url
}

/**
 * 卡图 URL（按卡密查找）— 列表场景用缩略图 (200px WebP, 加载快)
 * 保留旧签名，内部走 buildCardImgUrl。
 * @param {string} password - 卡密
 * @param {string} code - 卡牌编号（用于定位卡包目录）
 * @param {string} rarity - 罕贵度
 */
export function getCardImageUrl(password, code, rarity) {
  return buildCardImgUrl({ password, code, rarity })
}

/**
 * 数据源固定为本地 BE（不再需要外部 :8081）
 */
export function getCardDbSource() {
  return 'local'
}

/**
 * 查这个编号在**图源里真实存在**的罕贵度。
 *
 * 注意它扫的是包目录的文件名，不是目录字段 —— 目录字段常和图源对不上
 * （PC5-JP001 目录写 N/NPR，图源只有 C），拿它填下拉等于把错的那套抄一遍。
 *
 * 返回：
 *   rarityList      [{rarity, altCount}]  altCount=1 只有原画，>1 另有 -1..-(n-1) 张异画
 *   source          'files' 图源实扫（权威）/ 'catalog' 图源里没有这张卡
 *   matchesCatalog  库里写的罕贵度是否落在图源真实集合里（false = 这张卡的罕贵度是错的）
 *   catalogRarities 目录字段解析结果，供对照提示
 */
export async function lookupRarityInfo(code) {
  const empty = { rarityList: [], source: '', matchesCatalog: true, catalogRarities: {} }
  if (!code) return empty
  try {
    const resp = await fetch(`${API_BASE}/rarity-info/${encodeURIComponent(code)}`)
    if (!resp.ok) return empty
    const data = await resp.json()
    return {
      rarityList: data.rarityList || [],
      source: data.source || '',
      matchesCatalog: data.matchesCatalog !== false,
      catalogRarities: data.catalogRarities || {},
    }
  } catch { return empty }
}

export function setCardDbSource(_source) {
  // 已统一为本地 BE，忽略切换
}
