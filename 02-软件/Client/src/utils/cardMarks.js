/**
 * 「信息登记」（cardmarks）在**前端**的匹配口径 —— 一处定义，两处引用：
 *   · pages/upload/batch-recognize.vue（识别上传页每张卡右下角的蓝块/绿块）
 *   · pages/auto-listing/auto-listing.vue（一键上架页待上架包详情里**每一行**右边那枚竖条；
 *     V1.2.107 之前只挂在缺目录那条带子上，后来跟识别上传页对齐成每行一枚）
 *
 * 跟后端 `Server/src/services/cardMarks.js` 的规则**逐字对应**，改一边就得改另一边：
 *   · 归一化：去空格 + 转大写，其余一字不差（不加去前导零、去后缀之类的容错，理由见那个文件）
 *   · 粒度是 **(编号, 罕贵度)**；`rarity === ''` 是**通配** —— 罩住这个编号的所有罕贵度
 *   · '...' / '---' 是"还没识别出来"的占位符，不是编号，一律不认
 *
 * 状态放在**模块级**（不放进某个组件），因为两个页面问的是同一张表：
 * 登记是全局共享、不分库、不按人的。每次拉取都是整份覆盖，所以谁先拉都一样。
 */
import { getCardMarkCodes } from '@/api/index.js'

export const markedWild = new Set()      // 有「不限罕贵度」记录的编号
export const markedByKey = new Set()     // 'CODE|RARITY' 精确登记过的
// 'CODE|RARITY' → 'auto' | 'manual'。通配那条的键是 'CODE|'。
// 只有「取消登记」的弹窗用得到：自动记的删掉会自己回来，得跟手动点出来的分开说。
export const markSources = new Map()

const 无效 = (c) => !c || c === '...' || c === '---'

// 归一化方式跟后端 norm() 一致：去空格 + 转大写，其余一字不差
export const pairKey = (code, rarity) =>
  String(code || '').trim().toUpperCase() + '|' + String(rarity || '').trim().toUpperCase()

/** 这张卡登记过没有。通配命中该编号的任意罕贵度，否则要求这一对精确在集合里。 */
export const isMarkedCode = (code, rarity) => {
  const c = String(code || '').trim().toUpperCase()
  if (无效(c)) return false
  return markedWild.has(c) || markedByKey.has(c + '|' + String(rarity || '').trim().toUpperCase())
}

/** 这张卡是被**哪一条记录**标中的 —— 「取消登记」删的就是它。
 *  精确那一对优先（用户标的 N 就删 N 那条），没有再退到通配（老记录 / 自动登记）。
 *  返回 'CODE|RARITY'，没有就是空串。 */
export const markKeyOf = (code, rarity) => {
  const k = pairKey(code, rarity)
  if (markedByKey.has(k)) return k
  const c = String(code || '').trim().toUpperCase()
  return (c && !无效(c) && markedWild.has(c)) ? c + '|' : ''
}

/** 拉一份登记全集。返回拉到没有（false = 网络/接口失败，缓存保持原样）。 */
export const loadMarkedCodes = async () => {
  try {
    const d = await getCardMarkCodes()
    // 权威是 items（(编号,罕贵度) 才能唯一定位一条记录）。老后端只回 codes 时
    // 退回"全按通配"——宁可标多了，也不能漏标。
    const items = Array.isArray(d?.items) ? d.items
      : (d?.codes || []).map((c) => ({ code: c, rarity: '' }))
    const 通配 = new Set()
    const 成对 = new Set()
    const 来源表 = new Map()
    for (const it of items) {
      const code = String(it?.code || '').trim().toUpperCase()
      if (无效(code)) continue
      const rar = String(it?.rarity || '').trim().toUpperCase()
      const k = code + '|' + rar
      if (rar) 成对.add(k); else 通配.add(code)
      来源表.set(k, d?.sources?.[k] === 'auto' ? 'auto' : 'manual')
    }
    // ⚠️ 拉**成功**了才整份换掉。老写法是先 clear 再填，一只网络抖动就会把
    //    整页的绿块集体按回蓝色（而且没人看得出来是网络问题）。
    markedWild.clear(); for (const c of 通配) markedWild.add(c)
    markedByKey.clear(); for (const k of 成对) markedByKey.add(k)
    markSources.clear(); for (const [k, v] of 来源表) markSources.set(k, v)
    return true
  } catch (e) {
    // 拉不到就保持原样：最坏情况是新识别的卡要刷新一下才变绿，
    // 不能因为这份缓存把页面卡住。首次加载时集合本来是空的，那就是"一条都没登记"。
    console.warn('拉取已登记记录失败:', e)
    return false
  }
}

/** 写接口成功之后往本地补一条，省得再拉一遍整份。source: 'auto' | 'manual' */
export const 登记条目 = (code, rarity, source) => {
  const c = String(code || '').trim().toUpperCase()
  if (无效(c)) return
  const r = String(rarity || '').trim().toUpperCase()
  const k = c + '|' + r
  if (r) markedByKey.add(k); else markedWild.add(c)
  markSources.set(k, source === 'auto' ? 'auto' : 'manual')
}

/** 删掉本地**这一条**。`rarity===''` 删的是通配那条，否则删的是精确那一对。
 *
 *  ⚠️ 删精确那条**绝不动**通配那条，反过来也一样 —— 后端 DELETE 一次也只删一条。
 *  一开始这里写成了"删了就把通配也删掉"，于是会出现：一个编号既有通配记录
 *  （自动登记）又有 N 的精确记录（人工登记），用户在 N 那张卡上点取消 ——
 *  后端只删掉 N 那条，通配那条照样罩着 SR，可本地已经把通配抹了，
 *  同页 SR 那张就自己变回蓝色，跟刷新后的样子对不上。
 *  调用方要删哪一条，用 `markKeyOf(code, rarity)` 先问出来（它精确优先）。 */
export const 删除条目 = (code, rarity) => {
  const c = String(code || '').trim().toUpperCase()
  const r = String(rarity || '').trim().toUpperCase()
  if (r) markedByKey.delete(c + '|' + r)
  else markedWild.delete(c)
  markSources.delete(c + '|' + r)
}

export const 来源 = (键) => markSources.get(键)
export const 已登记 = isMarkedCode
