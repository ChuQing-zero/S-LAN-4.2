<template>
  <view class="page">
    <view class="topbar">
      <view class="tbtn" @tap="goBack"><image class="timg" src="/static/icons/ic_back.png" mode="aspectFit" /></view>
      <text class="ttl">卡牌唯一目录</text>
      <view class="tbtn" @tap="onRebuild"><text class="tbtn-txt">🔄</text></view>
    </view>

    <!-- 汇总 -->
    <!-- 常驻那行灰字不变量（「在用 N = … + …」）已按用户要求删掉 —— 它一直在、没人看。
         但**坏了得出声**：只在真对不上时露一行红字，平时一个像素都不占。
         连这个也不要的话，删掉下面那个 sum-bad 的 <text> 和 script 里的 loadStats 调用即可。 -->
    <view class="sum-bar">
      <text class="sum-main">共 {{ n(total) }} 条</text>
      <text class="sum-bad" v-if="不变量坏">⚠️ 不变量对不上，点右上角重建</text>
      <view class="new-btn" @tap="开添加"><text class="new-btn-t">＋ 添加</text></view>
    </view>

    <view class="search-bar">
      <input class="search-input" v-model="kw" placeholder="搜卡密 / 编号 / 官方日语 / 官方简中 / 官方英语" confirm-type="search" />
    </view>

    <scroll-view class="content" scroll-y="true" :lower-threshold="120" @scrolltolower="loadMore">
      <!-- 每一块的版式照「批量识别」（`upload/batch-recognize.vue`）的卡片来：
           左图 59×86、右边信息列、最右边一条绿竖块「详细」。
           竖块那套（28px 宽、撑满卡片高度、width:1em 竖排白字）是照那边的
           `.card-del-btn` / `.edit-block-text` 抄的，别在这儿另发明一套。 -->
      <view class="card-list">
        <view class="card-item" v-for="r in rows" :key="r._id">
          <!-- 左：卡图。**两级**（V1.2.73 起）：
               ① YGOPro 图源里以卡密命名的那张（only=ygopro）—— 这一行的身份就是卡密，
                  图对不对直接用来看，所以它优先。
               ② YGOPro 没有，就拿同一个卡密去 OCG 那头找（普通兜底链，挑该编号的第一张）。
               两级都没有才落卡背（用户定的：所有找不到图的都用卡背代替，不再显示「无图」文字）。
               ② 命中的那张会打「OCG」角标 —— 不打的话 OCG 详细图会被当成 YGOPro 保底图看，
               校对就不准了，而那正是 only=ygopro 当初存在的意义。 -->
          <view class="card-img-box" @tap="看大图(r)">
            <image :src="显示图(r)" mode="aspectFill" class="card-img" @error="图坏了(r)" />
            <text v-if="用兜底(r)" class="img-src-tag">OCG</text>
          </view>

          <view class="card-info">
            <!-- 这一列**只显示两个名字**（官方日语、官方简中），前缀标签暂时不显示（见 .lb-off）。
                 日语读音和官方英语先不列出来 —— 字段还在库里，点右边「详细」能看也能改。
                 空串显示成「—」：唯一目录里四个字段每个都存在，空就是真没有，不是缺字段。 -->
            <view class="line">
              <text class="lb lb-off">官方日语</text><text class="vl jp">{{ r.official.jp || '—' }}</text>
            </view>
            <view class="line">
              <text class="lb lb-off">官方简中</text><text class="vl">{{ r.official.cn || '—' }}</text>
            </view>
            <!-- 卡密是**第三行**，还是蓝底数字标签（跟批量上传那边同一个样式） -->
            <view class="line code-line">
              <text class="ext-code">{{ r.key }}</text>
              <text class="keytype">{{ r.keyType === 'extCode' ? '卡密' : '编号' }}</text>
            </view>
          </view>

          <!-- 最右边：绿竖块「详细」，点开看全四个名字、也能改 -->
          <view class="card-detail-btn" @tap.stop="看详细(r)"><text class="detail-text">详细</text></view>
        </view>
      </view>

      <view class="tip" v-if="loading"><text>读取中…</text></view>
      <view class="tip" v-else-if="!rows.length"><text>没有匹配的卡</text></view>
      <view class="tip" v-else-if="!hasMore"><text>— 到底了 —</text></view>
      <view class="footer-space"></view>
    </scroll-view>

    <!-- ===== 详细 / 改名弹窗 =====
         四个名字都能改；卡密**默认锁着** —— 它不只是个编号，还是这一条的「身份」、
         同时决定这张卡取哪张图，随手改会把图一起换掉。要改按右边那个「改」解锁，
         保存时还会再弹一次确认（把真实受影响的目录行数摆出来）。
         保存走 `PATCH /v1/api/card-uniques/unique/:key`。
         右上角「删除」走 `DELETE /v1/api/card-uniques/unique/:key`，
         只删得掉没被目录行引用的身份（服务端拦，见那个接口的注释）。 -->
    <view v-if="编.开" class="dialog-mask" @tap="关详细">
      <view class="dialog-box" @tap.stop>
        <text class="dialog-title">卡牌详细</text>
        <view v-if="编.r" class="d-del" @tap="删这张"><text class="d-del-t">删除</text></view>

        <view class="d-head">
          <view class="d-img-box">
            <!-- 和列表行同一个两级逻辑（共用 `图源` 那张表，同一个 key 结论一致）。
                 以前这里没挂 @error，图挂了就停在裂图上 —— 顺手补上。 -->
            <image v-if="编.r" :src="显示图(编.r)" mode="aspectFill" class="d-img" @error="图坏了(编.r)" />
            <text v-if="编.r && 用兜底(编.r)" class="img-src-tag">OCG</text>
          </view>
          <view class="d-head-r">
            <text class="d-cur">{{ 编.r && 编.r.key }}</text>
            <text class="d-cur-sub">{{ 编.r && 编.r.keyType === 'extCode' ? '卡密身份' : '编号身份（这一条没有卡密）' }}</text>
          </view>
        </view>

        <view class="d-row" v-for="f in 四名" :key="f.k">
          <text class="d-label">{{ f.名 }}</text>
          <input class="d-input" v-model="编.表[f.k]" placeholder="（空）" placeholder-style="color:#CCCCCC;" />
        </view>

        <!-- 编号身份（keyType='code'）压根没有卡密可改，整行不显示 -->
        <view class="d-row" v-if="编.r && 编.r.keyType === 'extCode'">
          <text class="d-label">卡密</text>
          <input class="d-input" :class="{ 'd-input-lock': !编.解锁卡密 }" v-model="编.表.extCode" :disabled="!编.解锁卡密" placeholder="8 位卡密，或自定义代号" />
          <view class="d-lock" v-if="!编.解锁卡密" @tap="解锁卡密"><text class="d-lock-t">改</text></view>
        </view>
        <text class="d-hint" v-if="编.r && 编.r.keyType === 'extCode' && !编.解锁卡密">卡密决定这一条的身份，也决定这张图取哪张 —— 所以锁着。确定要改就按右边的「改」。</text>
        <text class="d-hint" v-else-if="编.r && 编.r.keyType === 'extCode'">已解锁。保存时会先弹框确认：改了会连带改掉目录里所有用旧卡密的行。</text>

        <view class="dialog-btns">
          <view class="btn-cancel" @tap="关详细"><text class="btn-cancel-t">取消</text></view>
          <view class="btn-save" @tap="保存详细"><text class="btn-save-t">{{ 编.忙 ? '保存中…' : '保存' }}</text></view>
        </view>
      </view>
    </view>

    <!-- ===== 添加卡牌弹窗 =====
         只写 `carduniques`，**不动** `cardcatalogs` —— 所以目录页 / 库存 / 缺号里不会多出这张卡。
         卡密位置随便填：8 位卡密或自定义代号，一律当卡密身份（不按「是不是数字」分流）。
         四个名字一律手填（不自动去官方源补），允许全空。
         左边那张图跟着卡密实时变，取不到就是卡背。 -->
    <view v-if="添.开" class="dialog-mask" @tap="关添加">
      <view class="dialog-box" @tap.stop>
        <text class="dialog-title">添加卡牌</text>

        <view class="d-head">
          <view class="d-img-box">
            <image :src="添预览图" mode="aspectFill" class="d-img" @error="添图挂了" />
            <text v-if="添.图源 === 'ocg'" class="img-src-tag">OCG</text>
          </view>
          <view class="d-head-r">
            <text class="d-cur">{{ 添.表.key || '（还没填卡密）' }}</text>
            <text class="d-cur-sub">{{ 添图说明 }}</text>
          </view>
        </view>

        <view class="d-row">
          <text class="d-label">卡密</text>
          <input class="d-input" v-model="添.表.key" :maxlength="64" placeholder="8 位卡密，或自定义代号"
                 placeholder-style="color:#CCCCCC;" @input="添图重置" />
        </view>

        <view class="d-row" v-for="f in 四名" :key="f.k">
          <text class="d-label">{{ f.名 }}</text>
          <input class="d-input" v-model="添.表[f.k]" placeholder="（空）" placeholder-style="color:#CCCCCC;" />
        </view>

        <text class="d-hint">只进「卡牌唯一目录」：不会新建编号目录行，目录页 / 库存 / 缺号里看不到这张卡。</text>
        <text class="d-hint">四个名字都可以留空，之后再点「详细」改。</text>

        <view class="dialog-btns">
          <view class="btn-cancel" @tap="关添加"><text class="btn-cancel-t">取消</text></view>
          <view class="btn-save" @tap="保存添加"><text class="btn-save-t">{{ 添.忙 ? '添加中…' : '添加' }}</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { goBack as navBack } from '@/utils/nav.js'
// 卡背取全站统一的那个常量，别自己拼路径 —— `api/cardDb.js` 那段注释解释了
// 为什么不能用 `/static/icons/ic_card_placeholder.png`（那张其实是張真卡图）。
import { CARD_BACK } from '@/api/cardDb.js'

// 非 2xx 一律 reject，并把服务端那句人话（`{error}`）和整个响应体挂到 error 上 ——
// 保存那条路要靠 `err.响应.需要确认` 判断"服务端在等一次改卡密的确认"，所以响应体不能丢。
const apiV1 = async (url, opts) => {
  const token = uni.getStorageSync('token')
  const r = await uni.request({
    url: '/v1/api' + url,
    header: { 'Authorization': 'Bearer ' + (token || ''), 'Content-Type': 'application/json' },
    ...opts,
  })
  if (r.statusCode >= 200 && r.statusCode < 300) return r.data
  const err = new Error((r.data && r.data.error) || ('请求失败 HTTP ' + r.statusCode))
  err.响应 = r.data
  err.状态 = r.statusCode
  throw err
}

const n = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'))

// ---------- 行内卡图：两级 ----------
// ① YGOPro 图源里 {卡密}.jpg（`only=ygopro`，保底图）—— 这一行的身份就是卡密，
//    图对不对直接用来看，所以它优先。
// ② YGOPro 没有（V1.2.73 加）：拿同一个卡密去 OCG 那头找 —— 不带 `only` 就是普通兜底链的
//    **P1**（卡密反查编号目录 → 定位包目录 → 挑第一张）。挑的是**这个编号自己的图**：
//    `listOcgFiles` 先按 `{编号}-` 前缀把同包别的卡滤掉，所以不会挑错。
// 两级都没有才落卡背。
//
// 为什么不预先探测、而用 `@error` 串：src 一变浏览器自然会重新请求，
// 前端也就顺带知道这张图**是从哪来的** —— OCG 兜底那张要打角标，
// 不标的话 OCG 详细图会被当成 YGOPro 保底图看，而那正是 `only=ygopro` 当初存在的意义。
//
// 无卡密的身份（keyType='code'）压根没有可取的图，不去请求，省一批 404。
const 图源 = ref({})   // key → 缺省（先试 YGOPro）| 'ocg'（YGOPro 没有，退 OCG）| 'none'（都没有）
const 源 = (r) => 图源.value[r.key] || 'ygopro'
const 用兜底 = (r) => 源(r) === 'ocg'
// ⚠️ 必须 encodeURIComponent：手工新增的身份 key 可以是任意代号，
// 里面只要有 `&` / `#` / 空格就会把查询串截断（以前卡密都是纯数字，一直没暴露这条）。
const 图地址 = (r) => {
  if (r.keyType !== 'extCode') return ''
  const s = 源(r)
  if (s === 'none') return ''
  return '/api/tcg/card-thumbnail?password=' + encodeURIComponent(r.key)
    + (s === 'ygopro' ? '&only=ygopro' : '')
}
// 取不到图（没卡密 / 两级都落空）一律落卡背 —— 用户定的，不再显示「无图」文字。
const 显示图 = (r) => 图地址(r) || CARD_BACK
// 图挂了就往下一级退：YGOPro → OCG → 卡背。
// 只有两步，不会来回弹：src 每变一次才触发一次 @error，第二次进来时 源 已经是 'ocg' 了。
const 图坏了 = (r) => { 图源.value[r.key] = 源(r) === 'ygopro' ? 'ocg' : 'none' }
const 看大图 = (r) => {
  // 预览「屏幕上正显示的那张」：有真图看真图，没有就看卡背。
  // 原来无图时直接 return，点了什么都不发生，看着像按钮坏了。
  uni.previewImage({ urls: [显示图(r)], current: 0 })
}

const rows = ref([])
const total = ref(0)
const page = ref(1)
const hasMore = ref(false)
const loading = ref(false)
const kw = ref('')
// 只留「坏了才显示」这一个布尔量 —— 常驻的那行灰字不变量已按用户要求删掉
const 不变量坏 = ref(false)

// 请求序号：搜索框防抖期间可能连着发好几次，只认最后一发的结果，
// 否则慢的那次后到会把快的那次结果覆盖掉，列表看起来"搜了半天没反应"。
let seq = 0
const load = async (reset = false) => {
  const my = ++seq
  const p = reset ? 1 : page.value + 1
  loading.value = true
  try {
    const qs = '?page=' + p + '&pageSize=50&sort=key'
      + (kw.value.trim() ? '&kw=' + encodeURIComponent(kw.value.trim()) : '')
    const d = await apiV1('/card-uniques' + qs)
    if (my !== seq) return
    page.value = p
    rows.value = p === 1 ? (d.list || []) : rows.value.concat(d.list || [])
    total.value = d.total || 0
    hasMore.value = rows.value.length < total.value
  } catch (_) {
    if (my === seq) uni.showToast({ title: '读取失败', icon: 'none' })
  } finally {
    if (my === seq) loading.value = false
  }
}

const loadMore = () => { if (hasMore.value && !loading.value) load(false) }

let 防抖 = null
watch(kw, () => {
  if (防抖) clearTimeout(防抖)
  防抖 = setTimeout(() => load(true), 350)
})

const loadStats = async () => {
  try {
    const d = await apiV1('/card-uniques/stats')
    不变量坏.value = !!(d.不变量 && d.不变量.ok === false)
  } catch (_) { 不变量坏.value = false }
}

// ---------- 重建唯一目录 ----------
const 确认 = (title, content, confirmText) => new Promise((resolve) => {
  uni.showModal({ title, content, confirmText, success: (r) => resolve(!!r.confirm) })
})

const rebuilding = ref(false)
const onRebuild = async () => {
  if (rebuilding.value) return
  try {
    const dry = await apiV1('/card-uniques/rebuild', { method: 'POST', data: { dryRun: true } })
    if (!dry || !dry.ok) { uni.showToast({ title: '预演失败', icon: 'none' }); return }
    const p = dry.计划 || {}
    const c = dry.当前 || {}
    const txt = [
      '要建的身份：卡密 ' + p.卡密身份 + ' 个 + 编号 ' + p.编号身份 + ' 个 = ' + p.合计 + ' 条',
      '其中官方查得到：' + p.其中官方查得到 + ' 个',
      '',
      '集合里已有 ' + c.集合里已有 + ' 条，本次预计新增 ' + c.估计新增 + ' 条。',
      '',
      '只增不删，已有的官方资料不会被覆盖；重复点也没关系。',
    ].join('\n')
    if (!await 确认('重建唯一目录', txt, '重建')) return
    rebuilding.value = true
    uni.showLoading({ title: '重建中…' })
    try {
      const r = await apiV1('/card-uniques/rebuild', { method: 'POST', data: { dryRun: false } })
      uni.hideLoading()
      const w = (r && r.写入) || {}
      uni.showModal({
        title: r && r.ok ? '✅ 重建完成' : '重建失败',
        content: '新增 ' + (w.新增 || 0) + ' 条，已存在 ' + (w.已存在 || 0) + ' 条'
          + (w.失败 ? '\n⚠️ 有 ' + w.失败 + ' 条写入失败' : '')
          + '\n集合里现在共 ' + (r?.集合里现在共 || 0) + ' 条'
          + '\n耗时 ' + ((r?.耗时毫秒 || 0) / 1000).toFixed(1) + ' 秒',
        showCancel: false,
      })
      await load(true)
      await loadStats()
    } catch (e) {
      uni.hideLoading()
      uni.showToast({ title: '重建失败：' + (e.message || ''), icon: 'none', duration: 3000 })
    }
    rebuilding.value = false
  } catch (e) {
    uni.showToast({ title: '预演失败：' + (e.message || ''), icon: 'none' })
  }
}

// ---------- 详细 / 改名弹窗 ----------
// 四个名字的顺序 = 页面上的顺序，和 `cardUniques.js` 的字段顺序、接口白名单一致。
const 四名 = [
  { k: 'jp', 名: '官方日语' },
  { k: 'ruby', 名: '日语读音' },
  { k: 'cn', 名: '官方简中' },
  { k: 'en', 名: '官方英语' },
]

const 编 = ref({ 开: false, r: null, 表: { jp: '', ruby: '', cn: '', en: '', extCode: '' }, 解锁卡密: false, 忙: false })

const 看详细 = (r) => {
  编.value = {
    开: true,
    r,
    表: {
      jp: r.official.jp || '', ruby: r.official.ruby || '', cn: r.official.cn || '', en: r.official.en || '',
      // 编号身份没有卡密，这里填空串；那一行输入框在模板里也不显示
      extCode: r.keyType === 'extCode' ? String(r.key) : '',
    },
    解锁卡密: false,
    忙: false,
  }
}
const 关详细 = () => { 编.value.开 = false }

// 解锁是**本地状态**，不发请求 —— 真正的写入在「保存」，那时才弹确认框。
// 不在这里就弹，是因为"受影响行数"要服务端现数，本地猜不出来。
const 解锁卡密 = () => { 编.value.解锁卡密 = true }

// ---------- 删除身份 ----------
// 只删 `carduniques` 这一条身份，`cardcatalogs` 一个字不动。
// **还被目录行引用着的删不掉** —— 服务端 409 拦下来（删了不变量当场假红，
// 而且批次 2 之后那些行会失去名字来源）。手工「＋ 添加」的卡没有目录行，
// 属于「未使用身份」，删得掉，删完不变量还是 ok。
const 删这张 = async () => {
  const s = 编.value
  if (!s.开 || !s.r || s.忙) return
  const r = s.r
  // 把三个非空名字摆出来，让用户确认删的就是他以为的那张 —— 只有卡密太容易点错
  const 名字 = [r.official.jp, r.official.cn, r.official.en]
    .map((x) => String(x || '').trim()).filter(Boolean).join(' / ')
  const 确认删 = await 确认(
    '确认删除这张卡牌吗',
    [
      '卡密：' + r.key,
      名字 ? '名字：' + 名字 : '（四个名字都是空的）',
      '',
      '只从「卡牌唯一目录」里删掉这一条身份，编号目录一个字不动。',
      '删了就找不回来了（服务端会留一份快照，但要人工去捞）。',
    ].join('\n'),
    '删除'
  )
  if (!确认删) return

  s.忙 = true
  try {
    await apiV1(
      '/card-uniques/unique/' + encodeURIComponent(r.key) + '?keyType=' + encodeURIComponent(r.keyType),
      { method: 'DELETE' }
    )
    s.忙 = false
    关详细()
    uni.showToast({ title: '已删除', icon: 'success' })
    // 把搜索框清掉再重拉：不然框里还留着刚删掉的那个卡密，重拉出来的就是「没有匹配的卡」,
    // 看着像把整页删坏了。删完之后该看到的是正常的完整列表。
    // 注意 watch(kw) 有 350ms 防抖 —— **从有词变空**它会自己重拉一次，这时别再手动拉，
    // 否则同一秒发两个请求；本来就没搜索（框是空的）时 watch 不触发，必须手动拉。
    const 刚才在搜索 = !!kw.value.trim()
    kw.value = ''
    if (!刚才在搜索) await load(true)
    await loadStats()
  } catch (e) {
    s.忙 = false
    // 服务端拦下来的（还有目录行在用 / 身份已经没了）要说清楚原因，
    // 用 showModal 而不是 toast —— 那条错误信息是要读完的，不是扫一眼的
    uni.showModal({ title: '删不掉', content: e.message || '未知错误', showCancel: false })
  }
}

const 保存详细 = async () => {
  const s = 编.value
  if (!s.开 || !s.r || s.忙) return
  const 旧 = s.r
  const 表 = s.表

  // 只发改动过的字段，但 `expect` 发**整条** —— 见下面那段注释
  const set = {}
  for (const f of ['jp', 'ruby', 'cn', 'en']) {
    const v = String(表[f] == null ? '' : 表[f]).trim()
    if (v !== String(旧.official[f] || '')) set[f] = v
  }
  const 卡密动了 = 旧.keyType === 'extCode' && String(表.extCode || '').trim() !== String(旧.key)
  if (卡密动了) set.extCode = String(表.extCode || '').trim()

  if (!Object.keys(set).length) { uni.showToast({ title: '没有改动', icon: 'none' }); return }

  // 乐观锁：把「我看到的整条」发过去。只发改动过的字段挡不住这种情况 ——
  // 我载入之后别人改了卡密、我只动名字，卡密那个键不在 `set` 里就被跳过，于是在一条已被动过的数据上照样写成功。
  const expect = {
    jp: 旧.official.jp || '', ruby: 旧.official.ruby || '',
    cn: 旧.official.cn || '', en: 旧.official.en || '',
  }
  if (旧.keyType === 'extCode') expect.extCode = String(旧.key)

  const 发 = (extra) => apiV1('/card-uniques/unique/' + encodeURIComponent(旧.key), {
    method: 'PATCH',
    data: { keyType: 旧.keyType, set, expect, ...extra },
  })

  s.忙 = true
  try {
    let d
    try {
      d = await 发({})
    } catch (e) {
      // 卡密要动时服务端**第一次一定拦下来**（不带 keyChangeConfirmed 就是 409 + 需要确认），
      // 正好拿它现数的 `受影响行数` 来弹框 —— 该说的数字在框里，不让用户盲点。
      if (!(e.响应 && e.响应.需要确认)) throw e
      const 行 = e.响应.受影响行数 || 0
      const ok = await 确认('改卡密', [
        '卡密不只是个编号：它是这一条的身份，也决定这张卡取哪张图。',
        '',
        '改掉会连带把编号目录里所有用旧卡密的行一起改掉' + (行 ? '（现在有 ' + 行 + ' 行）' : '') + '。',
        '这一条是**原地改键**，不会多出一条身份 —— 但改完这一页会重新加载，',
        '因为它在按卡密排序的列表里换了位置。',
        '',
        '确认要改吗？',
      ].join('\n'), '确认改')
      if (!ok) { s.忙 = false; return }
      d = await 发({ keyChangeConfirmed: true })
    }

    关详细()
    if (d && d.卡密变了) {
      // 卡密变了 = 身份变了，它在按 key 排序的列表里也换了位置 —— 从第一页重来，不然找不着它
      uni.showToast({ title: '已改卡密，连带 ' + (d.改的目录行数 || 0) + ' 行', icon: 'none', duration: 2500 })
      await load(true)
    } else {
      // 只改名字：就地更新这一行，不为了改名把整页重拉一遍
      const 后 = (d && d.改后) || {}
      Object.assign(旧.official, {
        jp: 后.jp != null ? 后.jp : 旧.official.jp,
        ruby: 后.ruby != null ? 后.ruby : 旧.official.ruby,
        cn: 后.cn != null ? 后.cn : 旧.official.cn,
        en: 后.en != null ? 后.en : 旧.official.en,
      })
      uni.showToast({ title: '已保存', icon: 'success' })
    }
  } catch (e) {
    uni.showToast({ title: e.message || '保存失败', icon: 'none', duration: 3000 })
  } finally {
    s.忙 = false
  }
}

// ---------- 添加卡牌 ----------
// 只建 `carduniques` 一条身份，**不动** `cardcatalogs`（用户选的）。
// 所以它是「未使用身份」—— 不影响不变量、`/verify` 也不会翻（孤儿的判定是只报不判）。
// 也不怕被 rebuild 冲掉：rebuild 是纯 upsert，不删也不改已存在文档。
const 添 = ref({ 开: false, 表: { key: '', jp: '', ruby: '', cn: '', en: '' }, 图源: 'ygopro', 忙: false })

const 开添加 = () => {
  添.value = { 开: true, 表: { key: '', jp: '', ruby: '', cn: '', en: '' }, 图源: 'ygopro', 忙: false }
}
// 添加中不让点遮罩关掉 —— 请求已经在路上了，关了框用户就不知道到底加没加上
const 关添加 = () => { if (!添.value.忙) 添.value.开 = false }

// 弹窗里那张预览图跟着卡密实时变，**两级和列表同一个逻辑**：
// 填了就先找 YGOPro 保底图，没有退 OCG 找该编号的图，都没有才卡背。
const 添预览图 = computed(() => {
  const k = String(添.value.表.key || '').trim()
  if (!k || 添.value.图源 === 'none') return CARD_BACK
  return '/api/tcg/card-thumbnail?password=' + encodeURIComponent(k)
    + (添.value.图源 === 'ygopro' ? '&only=ygopro' : '')
})
const 添图说明 = computed(() => {
  const k = String(添.value.表.key || '').trim()
  if (!k) return '先填卡密，图跟着变'
  if (添.value.图源 === 'none') return 'YGOPro 和 OCG 都没有这张，显示卡背'
  if (添.value.图源 === 'ocg') return 'YGOPro 没有，改用 OCG 里这个编号的图'
  return '按卡密取 YGOPro 保底图（没有再退 OCG）'
})
// 图挂了退一级（YGOPro → OCG → 卡背）
const 添图挂了 = () => { 添.value.图源 = 添.value.图源 === 'ygopro' ? 'ocg' : 'none' }
// 卡密一改就从头试 —— 不然旧卡密"没有图"的结论会套到新卡密头上
const 添图重置 = () => { 添.value.图源 = 'ygopro' }

const 保存添加 = async () => {
  const s = 添.value
  if (!s.开 || s.忙) return
  const k = String(s.表.key || '').trim()
  if (!k) { uni.showToast({ title: '卡密不能为空', icon: 'none' }); return }

  s.忙 = true
  try {
    await apiV1('/card-uniques/unique', {
      method: 'POST',
      data: { key: k, jp: s.表.jp, ruby: s.表.ruby, cn: s.表.cn, en: s.表.en },
    })
    s.忙 = false
    s.开 = false
    uni.showToast({ title: '已添加', icon: 'success' })
    // 列表按 key 排序、一共十几页，新加的这条多半不在第一页 ——
    // 直接把搜索框设成它，用户立刻看得到刚建的那一条，不用自己翻。
    kw.value = k
  } catch (e) {
    s.忙 = false
    // 409（已经有这个身份）要让人看清楚是哪一个，toast 一闪就没了，所以用弹窗
    uni.showModal({ title: '添加失败', content: e.message || '未知错误', showCancel: false })
  }
}

const goBack = () => navBack('/pages/admin/card-library')

onMounted(() => { load(true); loadStats() })
</script>

<style scoped>
* { box-sizing: border-box; }
.page { display: flex; flex-direction: column; height: 100vh; background: #F5F5F7; }
.topbar { background: #FFF; padding: 14px 16px 12px; display: flex; align-items: center; justify-content: space-between; position: relative; flex-shrink: 0; }
.tbtn { width: 32px; height: 32px; border-radius: 16px; background: #F0F0F0; display: flex; align-items: center; justify-content: center; }
.timg { width: 18px; height: 18px; }
.tbtn-txt { font-size: 14px; line-height: 1; }
.ttl { position: absolute; left: 50%; transform: translateX(-50%); font-size: 16px; font-weight: 500; color: #1A1A1A; }

.sum-bar { background: #FFF; padding: 2px 16px 10px; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.sum-main { font-size: 13px; font-weight: 600; color: #1A1A1A; }
/* 只在真对不上时露一下的那行红字（原来常驻的那行灰字不变量已按用户要求删掉） */
.sum-bad { font-size: 11px; color: #EF4444; }
/* 「＋ 添加」红钮照 catalog.vue 的 `.new-pack-btn` / `.new-pack-t` 抄（那边的「＋ 新建」）：
   红底 #FF0000、圆角 10px、白字 12px/500。margin-left:auto 把它顶到这一行最右边 */
.new-btn { margin-left: auto; flex-shrink: 0; display: flex; align-items: center; padding: 8px 12px; background: #FF0000; border-radius: 10px; }
.new-btn-t { font-size: 12px; font-weight: 500; color: #FFF; }

.search-bar { padding: 10px 16px; flex-shrink: 0; }
.search-input { width: 100%; height: 36px; background: #FFFFFF; border-radius: 8px; padding: 0 12px; font-size: 13px; color: #1A1A1A; }

/* 滚动区**不留左右内边距** —— 批量识别那边的 `.main-scroll` 就是 padding:0，
   卡片靠自己的 padding 顶到屏幕两边（那边 `.card-item` 也是 border-radius:0，没有圆角）。 */
.content { flex: 1; padding: 0; }
/* 列表的上留白也照那边 `.card-list` 的 padding-top:6px。
   那边还有 padding-bottom:110px，是给悬浮的拍照按钮让位的 —— 这页没有那个按钮，不抄，
   用它下面那个 .footer-space 留一小截就够。 */
.card-list { padding-top: 6px; }

/* ===== 卡片块：下面的数值**逐条**照 upload/batch-recognize.vue 的
   `.card-item` / `.card-img` / `.card-info` / `.jp-name` / `.cn-name` 抄，别在这里自己发明 =====
   关键的那几个：border-radius:0（**没有圆角**）、padding 右边是 0（绿条要贴死最右边就靠它）、
   图 59×86、图到文字 12px 是 .card-info 的 margin-left（不是 flex gap）。 */
.card-item { display: flex; flex-direction: row; background-color: #FFFFFF; border-radius: 0; padding: 14px 0 14px 16px; margin-bottom: 4px; position: relative; }
.card-img-box { width: 59px; height: 86px; flex-shrink: 0; border-radius: 2px; background-color: #EEEEEE; overflow: hidden; display: flex; align-items: center; justify-content: center; position: relative; }
/* 灰底和圆角在**图框和图上各写一份**：图还没加载出来时看到的是这张图自己的底色，
   跟那边 `.card-img` 直接就是那张 <image> 是同一个观感。 */
.card-img { width: 59px; height: 86px; border-radius: 2px; background-color: #EEEEEE; flex-shrink: 0; }
.card-info { margin-left: 12px; flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: space-between; }

.line { display: flex; align-items: flex-start; gap: 8px; margin-top: 2px; }
/* 卡密行：**第三行**。间距照那边的 `.card-meta`（margin-top:4px） */
.line.code-line { margin-top: 4px; align-items: center; }
.ext-code { font-size: 10px; color: #007AFF; background: #F0F4FF; padding: 1px 6px; border-radius: 3px; white-space: nowrap; }
/* 「卡密 / 编号」这个小灰字照那边的 `.serial`（11px、#999999），
   不是 `.meta-text`（那个是 11px/#666，管的是编号/罕贵/品相那一排） */
.keytype { font-size: 11px; color: #999999; white-space: nowrap; }

/* 名字行现在**只有值、没有前缀**（用户要求先只留两个名字、把前缀藏掉）。
   `.lb-off` 单独成一个类、而不是把元素从模板里删掉：将来要把前缀放回来，去掉这一行就行。
   `.lb` 那 48px 是按**四个字**留的（「官方日语」11px×4=44px），前缀一放回来就得靠它 ——
   所以宽度留着，别顺手删掉。 */
.lb { width: 48px; flex-shrink: 0; font-size: 11px; color: #AAA; line-height: 1.5; }
.lb-off { display: none; }
/* 中文名照那边的 .cn-name：12px、#666666 */
.vl { flex: 1; font-size: 12px; color: #666666; line-height: 1.5; word-break: break-all; }
/* 日文名照那边的 .jp-name：15px、600、行高 1.8 */
.vl.jp { font-size: 15px; font-weight: 600; color: #1A1A1A; line-height: 1.8; }

/* ===== 详细块：照 upload/batch-recognize.vue 的 `.card-del-btn` 抄（同一个宽、同一个 -14px 撑满高度、
   同样不留圆角），只把红底换成绿底；竖排白字那套照 `.edit-block-text`。 */
.card-detail-btn { width: 28px; flex-shrink: 0; align-self: stretch; margin: -14px 0; background-color: #34C759; display: flex; align-items: center; justify-content: center; }
.detail-text { width: 1em; font-size: 15px; line-height: 1.1; color: #FFFFFF; word-break: break-all; text-align: center; }

.tip { text-align: center; color: #AAA; font-size: 12px; padding: 24px 0; }
.footer-space { height: 30px; }

/* ===== 详细弹窗 ===== */
.dialog-mask { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.5); z-index: 300; display: flex; align-items: center; justify-content: center; }
.dialog-box { position: relative; width: calc(100% - 48px); max-width: 380px; background: #FFFFFF; border-radius: 16px; padding: 22px 20px 18px; box-sizing: border-box; max-height: 85vh; overflow-y: auto; }
.dialog-title { font-size: 17px; font-weight: 600; color: #1A1A1A; display: block; text-align: center; }
/* 删除钮绝对定位在右上角，跟居中的标题同一行 —— **不能进 flex 流**，
   否则会把标题挤离正中。top 让它的文字和标题对齐（标题 17px，钮 12px）。
   right 取 20px = 弹窗左右内边距，让钮的右缘跟下面几个输入框的右缘**对齐**，
   不是随便塞进角里。
   ⚠️ 内容超高时 `.dialog-box` 会出现滚动条，绝对定位的 right 是相对**内边距盒**算的，
   于是钮相对外框会再往左让出滚动条那十几像素 —— 这是对的（它该待在可滚区域里），
   不是偏移 bug。桌面浏览器上能看到这个差，手机上是覆盖式滚动条（宽 0）就没有。 */
.d-del { position: absolute; top: 19px; right: 20px; padding: 5px 9px; border-radius: 8px; background: #FFEBEB; }
.d-del-t { font-size: 12px; font-weight: 500; color: #EF4444; }
.d-head { display: flex; flex-direction: row; align-items: center; gap: 12px; margin: 14px 0 2px; }
.d-img-box { width: 59px; height: 86px; flex-shrink: 0; border-radius: 2px; background: #EEEEEE; overflow: hidden; display: flex; align-items: center; justify-content: center; position: relative; }
/* 「这张图是拿 OCG 兜底出来的」角标。压在图的左下角，半透明黑底白字 ——
   小到不挡图，又足够在扫的时候一眼看见（不标的话 OCG 详细图会被当成 YGOPro 保底图）。 */
.img-src-tag {
  position: absolute; left: 0; bottom: 0;
  padding: 0 3px; font-size: 9px; line-height: 14px; color: #FFFFFF;
  background: rgba(0, 0, 0, 0.55); border-top-right-radius: 3px;
}
.d-img { width: 59px; height: 86px; }
.d-head-r { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.d-cur { font-size: 16px; font-weight: 600; color: #1A1A1A; word-break: break-all; }
.d-cur-sub { font-size: 11px; color: #999999; }
.d-row { display: flex; flex-direction: row; align-items: center; gap: 8px; margin-top: 10px; }
.d-label { width: 56px; flex-shrink: 0; font-size: 12px; color: #666666; }
.d-input { flex: 1; min-width: 0; height: 34px; background: #F5F5F7; border-radius: 6px; padding: 0 10px; font-size: 13px; color: #1A1A1A; }
/* 锁住时看着就得是锁住的：灰底灰字，跟可编辑的输入框一眼分得开 */
.d-input-lock { color: #999999; background: #EFEFF2; }
.d-lock { width: 34px; height: 34px; flex-shrink: 0; border-radius: 6px; background: #E8F7EC; display: flex; align-items: center; justify-content: center; }
.d-lock-t { font-size: 13px; font-weight: 600; color: #34C759; }
/* 提示行左边留 56+8=64px，跟上面几行输入框的左边缘对齐 */
.d-hint { display: block; font-size: 11px; color: #999999; line-height: 1.5; margin-top: 6px; padding-left: 64px; }
.dialog-btns { display: flex; flex-direction: row; gap: 10px; margin-top: 18px; }
.btn-cancel { flex: 1; height: 40px; border-radius: 8px; background: #F0F0F0; display: flex; align-items: center; justify-content: center; }
.btn-cancel-t { font-size: 14px; color: #666666; }
.btn-save { flex: 1; height: 40px; border-radius: 8px; background: #34C759; display: flex; align-items: center; justify-content: center; }
.btn-save-t { font-size: 14px; font-weight: 500; color: #FFFFFF; }
</style>
