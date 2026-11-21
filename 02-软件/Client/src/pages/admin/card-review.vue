<template>
  <view class="page">
    <view class="topbar">
      <view class="tbtn" @tap="goBack"><image class="timg" src="/static/icons/ic_back.png" mode="aspectFit" /></view>
      <text class="ttl">待处理</text>
      <view class="tbtn" @tap="load"><text class="tbtn-txt">🔄</text></view>
    </view>

    <!-- 汇总 -->
    <view class="sum-bar">
      <text class="sum-main">总共 {{ n(摘要.合计) }} 行要人看</text>
      <text class="sum-sub">改完自动从列表消失</text>
    </view>

    <!-- 三个桶 -->
    <view class="filter-bar">
      <view
        v-for="t in 标签列" :key="t.key"
        class="seg" :class="active === t.key ? 'on' : ''"
        @tap="active = t.key"
      >
        <text>{{ t.名 }}</text><text class="seg-count">{{ 摘要[t.key] || 0 }}</text>
      </view>
    </view>

    <scroll-view class="content" scroll-y="true">
      <view class="row" v-for="r in 当前列表" :key="r._id">
        <view class="row-head">
          <text class="code">{{ r.code }}</text>
          <text class="pack">{{ r.packCode }}</text>
          <view class="chip" :class="'k-' + r.kind"><text>{{ 标签(r.kind) }}</text></view>
        </view>

        <view class="line" v-if="r.official.jp">
          <text class="lb">官方</text><text class="vl jp">{{ r.official.jp }}</text>
        </view>
        <!-- 缺卡密的行也要把名字摆出来看。名字只藏在下面那个输入框里的话，
             这一行读起来就只剩一个孤零零的简中名，不知道说的是哪张卡。 -->
        <view class="line" v-if="r.jpName || r.kind !== 'noExtCode'">
          <text class="lb">库里</text><text class="vl" :class="{ dim: !r.jpName }">{{ r.jpName || '（名字是空的）' }}</text>
        </view>
        <view class="line" v-if="r.cnName && r.cnName !== r.jpName">
          <text class="lb">简中</text><text class="vl dim">{{ r.cnName }}</text>
        </view>

        <!-- 建议：能一键填的就给个按钮，别让人手抄卡密 -->
        <view class="sug" v-if="建议列表(r).length">
          <view class="sug-item" v-for="(s, i) in 建议列表(r)" :key="i" @tap="用建议(r, s)">
            <text>{{ s.文 }}</text>
          </view>
        </view>

        <view class="edit">
          <view class="field">
            <text class="fl">卡密</text>
            <input
              class="fi" :class="{ 'fi-mono': true }"
              v-model="草稿[r._id].extCode"
              placeholder="留空 = 这张卡没有卡密"
              confirm-type="done"
              @confirm="保存(r)"
            />
          </view>
          <view class="field">
            <text class="fl">日文名</text>
            <input
              class="fi"
              v-model="草稿[r._id].jpName"
              placeholder="名字"
              confirm-type="done"
              @confirm="保存(r)"
            />
          </view>
          <view class="acts">
            <text class="act-reset" v-if="脏(r)" @tap="重置(r)">撤回</text>
            <view class="act-save" :class="脏(r) && !保存中[r._id] ? 'on' : ''" @tap="保存(r)">
              <text>{{ 保存中[r._id] ? '保存中…' : (脏(r) ? '保存' : '没改') }}</text>
            </view>
          </view>
        </view>
      </view>

      <view class="tip" v-if="loading"><text>读取中…</text></view>
      <view class="tip" v-else-if="!当前列表.length"><text>这一类是空的 🎉</text></view>
      <view class="footer-space"></view>
    </scroll-view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { goBack as navBack } from '@/utils/nav.js'
// 卡密形态规则与后端同形（唯一一份在 api/cardDb.js）
import { 卡密合法, 卡密说明 } from '@/api/cardDb.js'

const apiV1 = (url, opts) => {
  const token = uni.getStorageSync('token')
  return uni.request({
    url: '/v1/api' + url,
    header: { 'Authorization': 'Bearer ' + (token || ''), 'Content-Type': 'application/json' },
    ...opts,
  }).then(r => r.data)
}

const n = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'))

const 标签列 = [
  { key: '待处理', 名: '待处理' },
  { key: '缺卡密', 名: '缺卡密' },
  { key: '卡密查不到', 名: '卡密查不到' },
]

const 标签 = (kind) => ({
  wrongExtCode: '卡密填错',
  shortName: '名字短一截',
  emptyName: '名字是空的',
  noExtCode: '缺卡密',
  fakeExtCode: '假卡密 0',
  badExtCode: '卡密查不到',
}[kind] || kind)

const active = ref('待处理')
const loading = ref(false)
const 摘要 = ref({ 待处理: 0, 缺卡密: 0, 卡密查不到: 0, 合计: 0 })
const 待处理 = ref([])
const 缺卡密 = ref([])
const 卡密查不到 = ref([])

// 草稿：_id → { extCode, jpName }。不直接改 r，才分得清「改了没保存」和「本来就这样」。
const 草稿 = ref({})
const 保存中 = ref({})

const 当前列表 = computed(() => ({ 待处理, 缺卡密, 卡密查不到 }[active.value] || { value: [] }).value || [])

const 原始 = (r) => ({ extCode: r.extCode || '', jpName: r.jpName || '' })
const 脏 = (r) => {
  const d = 草稿.value[r._id]
  if (!d) return false
  const o = 原始(r)
  return d.extCode.trim() !== o.extCode.trim() || d.jpName.trim() !== o.jpName.trim()
}

const 建议列表 = (r) => {
  const out = []
  const s = r.suggestion || {}
  if (s.extCode) out.push({ 文: '改用卡密 ' + s.extCode, extCode: s.extCode })
  if (s.jpName) out.push({ 文: '改用官方名：' + s.jpName, jpName: s.jpName })
  // 假卡密 0 / 敲错的卡密：这张卡本来就查不到，多半该留空
  if (r.kind === 'fakeExtCode' || r.kind === 'badExtCode') out.push({ 文: '清空卡密', extCode: '' })
  return out
}

const 用建议 = (r, s) => {
  if (s.extCode !== undefined) 草稿.value[r._id].extCode = s.extCode
  if (s.jpName !== undefined) 草稿.value[r._id].jpName = s.jpName
}

const 重置 = (r) => { 草稿.value[r._id] = 原始(r) }

const load = async () => {
  loading.value = true
  try {
    const d = await apiV1('/card-uniques/pending')
    摘要.value = d.摘要 || 摘要.value
    待处理.value = d.待处理 || []
    缺卡密.value = d.缺卡密 || []
    卡密查不到.value = d.卡密查不到 || []
    // 草稿按新数据重建，顺带把已经删掉的行清出去
    const 新草稿 = {}
    for (const arr of [待处理.value, 缺卡密.value, 卡密查不到.value]) {
      for (const r of arr) 新草稿[r._id] = 原始(r)
    }
    草稿.value = 新草稿
    // 默认停在有内容的那一桶，省得打开是一片空白还得自己点
    if (!({ 待处理, 缺卡密, 卡密查不到 }[active.value] || { value: [] }).value.length) {
      const 有货 = 标签列.find((t) => ({ 待处理, 缺卡密, 卡密查不到 }[t.key] || { value: [] }).value.length)
      if (有货) active.value = 有货.key
    }
  } catch (e) {
    uni.showToast({ title: '读取失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

const 保存 = async (r) => {
  if (!脏(r) || 保存中.value[r._id]) return
  const d = 草稿.value[r._id]
  const o = 原始(r)
  const set = {}
  if (d.extCode.trim() !== o.extCode.trim()) set.extCode = d.extCode.trim()
  if (d.jpName.trim() !== o.jpName.trim()) set.jpName = d.jpName.trim()
  if (!Object.keys(set).length) return

  // 卡密形态不对的先拦下来，别等服务端 400 转一圈
  if (set.extCode !== undefined && set.extCode && !卡密合法(set.extCode)) {
    uni.showToast({ title: '卡密' + 卡密说明, icon: 'none', duration: 2500 })
    return
  }

  保存中.value = { ...保存中.value, [r._id]: true }
  try {
    const res = await apiV1('/card-uniques/row/' + encodeURIComponent(r.code), {
      method: 'PATCH',
      data: { set, expect: o },
    })
    if (res && res.error) throw new Error(res.error)
    uni.showToast({ title: '已保存', icon: 'success', duration: 1200 })
    await load()
  } catch (e) {
    const msg = (e && (e.message || e.errMsg)) || '保存失败'
    uni.showModal({ title: '保存失败', content: msg, showCancel: false })
    await load()   // 409 的情况下把最新值拉回来
  } finally {
    const m = { ...保存中.value }
    delete m[r._id]
    保存中.value = m
  }
}

const goBack = () => navBack('/pages/admin/card-library')

onMounted(load)
</script>

<style scoped>
* { box-sizing: border-box; }
.page { display: flex; flex-direction: column; height: 100vh; background: #F5F5F7; }
.topbar { background: #FFF; padding: 14px 16px 12px; display: flex; align-items: center; justify-content: space-between; position: relative; flex-shrink: 0; }
.tbtn { width: 32px; height: 32px; border-radius: 16px; background: #F0F0F0; display: flex; align-items: center; justify-content: center; }
.timg { width: 18px; height: 18px; }
.tbtn-txt { font-size: 14px; line-height: 1; }
.ttl { position: absolute; left: 50%; transform: translateX(-50%); font-size: 16px; font-weight: 500; color: #1A1A1A; }

.sum-bar { background: #FFF; padding: 0 16px 10px; display: flex; align-items: baseline; gap: 8px; flex-shrink: 0; }
.sum-main { font-size: 13px; font-weight: 600; color: #1A1A1A; }
.sum-sub { font-size: 11px; color: #999; }

.filter-bar { display: flex; flex-direction: row; gap: 6px; padding: 10px 16px 0; background: #F5F5F7; flex-shrink: 0; }
.seg { flex: 1; height: 32px; border-radius: 16px; background: #FFFFFF; display: flex; align-items: center; justify-content: center; gap: 3px; }
.seg text { font-size: 11px; color: #666; }
.seg-count { font-size: 10px; color: #AAA; }
.seg.on { background: #1660C6; }
.seg.on text { color: #FFF; }
.seg.on .seg-count { color: rgba(255,255,255,0.8); }

.content { flex: 1; padding: 10px 16px 0; }
.row { background: #FFFFFF; border-radius: 12px; padding: 12px; margin-bottom: 8px; }
.row-head { display: flex; align-items: center; gap: 6px; }
.code { font-size: 14px; font-weight: 600; color: #1A1A1A; }
.pack { font-size: 10px; padding: 1px 6px; border-radius: 6px; background: #F0F0F2; color: #666; }
.chip { margin-left: auto; padding: 3px 10px; border-radius: 10px; flex-shrink: 0; }
.chip text { font-size: 11px; font-weight: 500; }
.k-wrongExtCode, .k-fakeExtCode { background: rgba(239,68,68,0.12); }
.k-wrongExtCode text, .k-fakeExtCode text { color: #EF4444; }
.k-shortName, .k-emptyName, .k-badExtCode { background: rgba(249,115,22,0.14); }
.k-shortName text, .k-emptyName text, .k-badExtCode text { color: #F97316; }
.k-noExtCode { background: rgba(22,96,198,0.10); }
.k-noExtCode text { color: #1660C6; }

.line { display: flex; align-items: flex-start; gap: 8px; margin-top: 6px; }
.lb { width: 30px; flex-shrink: 0; font-size: 11px; color: #AAA; line-height: 1.5; }
.vl { flex: 1; font-size: 13px; color: #1A1A1A; line-height: 1.5; word-break: break-all; }
.vl.jp { font-weight: 500; }
.vl.dim { color: #888; font-size: 12px; }

.sug { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.sug-item { padding: 4px 10px; border-radius: 10px; background: rgba(22,96,198,0.08); }
.sug-item text { font-size: 11px; color: #1660C6; }

.edit { margin-top: 10px; padding-top: 10px; border-top: 1px solid #F0F0F2; }
.field { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.fl { width: 44px; flex-shrink: 0; font-size: 12px; color: #888; }
.fi { flex: 1; height: 34px; background: #F7F7F9; border-radius: 8px; padding: 0 10px; font-size: 13px; color: #1A1A1A; }
.fi-mono { letter-spacing: 1px; }
.acts { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
.act-reset { font-size: 12px; color: #999; padding: 6px 10px; }
.act-save { padding: 7px 18px; border-radius: 16px; background: #F0F0F2; }
.act-save text { font-size: 13px; color: #AAA; }
.act-save.on { background: #1660C6; }
.act-save.on text { color: #FFF; }

.tip { text-align: center; color: #AAA; font-size: 12px; padding: 40px 0; }
.footer-space { height: 30px; }
</style>
