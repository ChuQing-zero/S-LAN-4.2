<template>
  <view class="page">
    <view class="topbar">
      <view class="tbtn" @tap="goBack"><image class="timg" src="/static/icons/ic_back.png" mode="aspectFit" /></view>
      <text class="ttl">{{ prefix }}</text>
      <text class="tcount">{{ total }} 条记录</text>
    </view>

    <view class="searchbar">
      <input
        class="search-input"
        v-model="keyword"
        placeholder="在这个包里搜编号 / 卡名 / 备注"
        confirm-type="search"
        @confirm="onSearch"
      />
      <view class="search-btn" @tap="onSearch"><text class="search-btn-text">搜索</text></view>
    </view>

    <scroll-view class="content" scroll-y="true">
      <view v-if="loading" class="hint">加载中...</view>
      <view v-else-if="list.length === 0" class="hint">
        <text class="hint-line">{{ keyword ? '这个包里没有匹配的记录' : '这个包已经空了' }}</text>
      </view>

      <view v-for="it in list" :key="it.code + '|' + (it.rarity || '') + '|' + (it._k || 0)" class="cm-card">
        <view class="cm-head">
          <text class="cm-code">{{ it.code }}</text>
          <!-- 罕贵度：这条记录管哪一档。空 = 不限（整个编号），老记录都是它。
               就地可改（已与用户确认）：改完这条只管新罕贵度那一档，撞上已有的档后端会 409。 -->
          <input
            class="cm-rarity"
            :value="it.rarity"
            placeholder="不限"
            @blur="(e) => onSaveRarity(it, e.detail.value)"
          />
          <text v-if="it.libraryCode" class="cm-tag cm-tag-lib">{{ it.libraryCode }}</text>
          <!-- 这条是机器自动记的（编号查不到目录）还是人点出来的。只做标识，不区分颜色。 -->
          <text class="cm-tag cm-tag-src">{{ it.source === 'auto' ? '自动' : '手动' }}</text>
        </view>

        <view class="cm-body">
          <!-- 图挂了就把 catImg 清空 → 落回卡背（空串本身就是「显示卡背」的意思，不用再加标志位） -->
          <image class="cm-img" :src="it.catImg || CARD_BACK" mode="aspectFill" @error="it.catImg = ''"></image>
          <view class="cm-names">
            <text class="cm-jp">{{ it.jpName || '（登记时没有卡名）' }}</text>
            <text class="cm-cn">{{ it.cnName || '—' }}</text>
            <text class="cm-time">登记于 {{ fmtTime(it.markedAt) }}</text>
          </view>
        </view>

        <textarea
          class="cm-note"
          :value="it.note"
          placeholder="写点备注（比如：卡名应是 xxx / 卡图错了，已重新扫图）改完自动保存"
          :auto-height="true"
          @blur="(e) => onSaveNote(it, e.detail.value)"
        />

        <view class="cm-foot">
          <text class="cm-hint">{{ it.rarity ? `删掉这条 → 上传页 ${it.code} 的 ${it.rarity} 会变回蓝色` : `删掉这条 → 上传页 ${it.code} 所有罕贵度都会变回蓝色` }}</text>
          <text class="cm-del" @tap="onDelete(it)">删除</text>
        </view>
      </view>

      <view class="footer-space"></view>
    </scroll-view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { getCardMarks, updateCardMark, deleteCardMark } from '@/api/index.js'
import { goBack as navBack } from '@/utils/nav.js'
import { 拉目录, buildCardImgUrl, CARD_BACK } from '@/api/cardDb.js'

const prefix = ref('')
const list = ref([])
const total = ref(0)
const keyword = ref('')
const loading = ref(true)

// 列表缩略图：按编号问目录、现拼官方图，挂在 `it.catImg` 上（不落库）。
//
// 以前这里读 `it.img`，那是登记时对 `Card.img` 的快照 —— 而 `Card.img` 建卡时就被硬编码成
// `''`，清库前 38,767 张填充率 0.00%。所以这页是**结构性恒卡背**，跟数据无关（V1.2.86）。
// 卡密问目录要、图按 `{编号}+{罕贵}` 现拼，详见 cardDb.js。
const 回填登记图 = async (条们) => {
  const 有编号 = 条们.filter(x => x && x.code)
  if (!有编号.length) return
  const 表 = await 拉目录(有编号.map(x => x.code))
  for (const x of 有编号) {
    const 卡密 = (表[x.code] || {}).extCode || ''
    x.catImg = buildCardImgUrl({ password: 卡密, code: x.code, rarity: x.rarity })
  }
}

// prefix 从 URL 带过来（一级页点包跳进来）。
// 用 onLoad 拿参数、onShow 拉数据：删完一条返回一级页再进来，或者在这页里删到空，都能对上。
onLoad((opt) => { prefix.value = decodeURIComponent(opt?.prefix || '') })

const load = async () => {
  if (!prefix.value) return
  loading.value = true
  try {
    // sort=code：包内按编号升序，同一个包的编号排在一起好找
    const d = await getCardMarks({ prefix: prefix.value, keyword: keyword.value.trim(), sort: 'code', pageSize: 500 })
    list.value = d.list || []
    total.value = d.total || 0
    回填登记图(list.value)
  } catch (e) {
    list.value = []
    total.value = 0
    uni.showToast({ title: '加载失败：' + (e.message || ''), icon: 'none' })
  }
  loading.value = false
}
onShow(load)
const onSearch = () => load()

const fmtTime = (t) => {
  if (!t) return '—'
  const d = new Date(t)
  if (isNaN(d.getTime())) return '—'
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 一条记录 = (编号, 罕贵度)。改它的时候必须把**当前**罕贵度当定位传过去 ——
// 不传的话后端只知道编号、而这个编号可能有好几档，会直接 409 拒绝改。
// 所以下面每个写操作都用 `it.rarity`（也可能是 `''` = 通配那条）。
const onSaveNote = async (it, val) => {
  if (val === it.note) return
  try {
    await updateCardMark(it.code, { note: val }, it.rarity)
    it.note = val
    uni.showToast({ title: '备注已保存', icon: 'none' })
  } catch (e) {
    uni.showToast({ title: '备注保存失败', icon: 'none' })
  }
}

// 改罕贵度 = 把这条记录从「管哪一档」换成另一档。空 = 不限罕贵度。
// 撞档（这个编号已经有一条同罕贵度的记录了）后端给 409 + 一句人话，原样转出来。
const onSaveRarity = async (it, val) => {
  const 新 = String(val || '').trim().toUpperCase()
  const 旧 = it.rarity || ''
  if (新 === 旧) return
  try {
    await updateCardMark(it.code, { rarity: 新 }, 旧)
    it.rarity = 新
    uni.showToast({ title: 新 ? `已改成 ${新}` : '已改成不限罕贵度', icon: 'none' })
  } catch (e) {
    // 失败时输入框里还留着刚敲进去的值，而数据没变、` :value` 也就不会重新下发，
    // 文字会跟数据对不上。改一次 `_k` 逼这一条重渲染（`_k` 参与 :key）。
    it._k = (it._k || 0) + 1
    uni.showToast({ title: e.message || '罕贵度改不了', icon: 'none' })
  }
}

// 删除 = 「这一档我人工处理完了」。通配那条删掉是整个编号都解除；
// 带罕贵度那条只解除这一档 —— 所以确认框里要**说清范围**，别让人以为删的都是同一个东西。
const onDelete = (it) => {
  const 范围 = it.rarity
    ? `只有 ${it.code} 的 ${it.rarity} 这一档会变回蓝色。`
    : `${it.code} 的所有罕贵度都会变回蓝色。`
  uni.showModal({
    title: '处理完了？',
    content: `删除「${it.code}${it.rarity ? '·' + it.rarity : '（不限罕贵度）'}」这条记录？\n删掉后上传页上：${范围}（刷新即可）不会删掉任何一张卡。`,
    confirmText: '删除',
    success: async (r) => {
      if (!r.confirm) return
      try {
        await deleteCardMark(it.code, it.rarity)
        // 按 (编号, 罕贵度) 删本地那条 —— 只按编号滤会把同编号的另一档一起从列表里抹掉
        list.value = list.value.filter((x) => !(x.code === it.code && (x.rarity || '') === (it.rarity || '')))
        total.value = Math.max(total.value - 1, 0)
        uni.showToast({ title: '已删除', icon: 'success' })
      } catch (e) {
        uni.showToast({ title: '删除失败', icon: 'none' })
      }
    },
  })
}

// 上一页是一级包列表；刷新过就直接回一级页（见 utils/nav.js 里的说明）
const goBack = () => navBack('/pages/admin/card-marks')
</script>

<style scoped>
* { box-sizing: border-box; }
.page { display: flex; flex-direction: column; height: 100vh; background: #F5F5F7; }
.topbar { background: #FFF; padding: 14px 16px 12px; display: flex; align-items: center; position: relative; flex-shrink: 0; }
.tbtn { width: 32px; height: 32px; border-radius: 16px; background: #F0F0F0; display: flex; align-items: center; justify-content: center; }
.timg { width: 18px; height: 18px; }
.ttl { position: absolute; left: 50%; transform: translateX(-50%); font-size: 16px; font-weight: 500; color: #1A1A1A; }
.tcount { margin-left: auto; font-size: 12px; color: #999; }

.searchbar { background: #FFF; padding: 0 16px 12px; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.search-input { flex: 1; height: 34px; background: #F5F5F7; border-radius: 17px; padding: 0 14px; font-size: 13px; color: #1A1A1A; }
.search-btn { height: 34px; border-radius: 17px; background: #1660C6; display: flex; align-items: center; justify-content: center; padding: 0 16px; }
.search-btn-text { font-size: 13px; font-weight: 500; color: #FFF; }

.content { flex: 1; padding: 14px 16px; }
.hint { text-align: center; color: #999; font-size: 13px; line-height: 2; padding: 40px 0; }
.hint-line { display: block; }

.cm-card { background: #FFF; border-radius: 12px; padding: 14px; margin-bottom: 10px; }
.cm-head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.cm-code { font-size: 16px; font-weight: 600; color: #1A1A1A; letter-spacing: 0.5px; }
/* 罕贵度：跟着编号走的小输入框，看着像标签但能点进去改（空 = 不限罕贵度） */
.cm-rarity { width: 68px; height: 24px; line-height: 24px; font-size: 12px; font-weight: 500; color: #1660C6; background: #EAF2FD; border-radius: 4px; padding: 0 6px; text-align: center; }
.cm-tag { font-size: 11px; border-radius: 4px; padding: 2px 6px; }
.cm-tag-lib { color: #666; background: #F5F5F7; }
.cm-tag-src { color: #666; background: #F5F5F7; }

.cm-body { display: flex; align-items: flex-start; gap: 10px; margin-top: 10px; }
.cm-img { width: 40px; height: 56px; border-radius: 2px; background: #F5F5F7; flex-shrink: 0; }
.cm-names { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.cm-jp { font-size: 13px; color: #1A1A1A; line-height: 1.4; word-break: break-all; }
.cm-cn { font-size: 12px; color: #666; line-height: 1.4; word-break: break-all; }
.cm-time { font-size: 11px; color: #BBB; margin-top: 2px; }

.cm-note { width: 100%; min-height: 44px; margin-top: 10px; padding: 8px 10px; background: #F7F7F9; border-radius: 8px; font-size: 12px; color: #1A1A1A; line-height: 1.6; }

.cm-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; }
.cm-hint { flex: 1; font-size: 11px; color: #BBB; line-height: 1.4; }
.cm-del { flex-shrink: 0; font-size: 13px; font-weight: 500; color: #FA5151; padding: 2px 4px; }

.footer-space { height: 30px; }
</style>
