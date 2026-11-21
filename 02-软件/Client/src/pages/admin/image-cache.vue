<template>
  <view class="page-container">
    <view class="toolbar-panel">
      <view class="toolbar">
        <view class="toolbar-left">
          <view class="tool-btn" @tap="goBack"><image class="icon-back" src="/static/icons/ic_back.png" mode="aspectFit" /></view>
        </view>
        <text class="tool-title">图片缓存管理</text>
        <view class="toolbar-right">
          <view v-if="activeTab === 0 && selOrders.length" class="select-actions">
            <text class="select-all" @tap="toggleAllOrders">{{ selOrders.length === orders.length ? '取消全选' : '全选' }}</text>
            <view class="del-btn" @tap="openDeleteOrders"><text class="del-btn-text">删除({{ selOrders.length }})</text></view>
          </view>
          <view v-else-if="activeTab === 1 && selOrig.length" class="select-actions">
            <text class="select-all" @tap="toggleAllOrig">{{ selOrig.length === origList.length ? '取消全选' : '全选' }}</text>
            <view class="del-btn" @tap="openDeleteOrig"><text class="del-btn-text">删除({{ selOrig.length }})</text></view>
          </view>
        </view>
      </view>
    </view>

    <!-- 页签切换 -->
    <view class="tabs">
      <view class="tab" :class="{ 'active': activeTab === 0 }" @tap="switchTab(0)">订单拍照留痕</view>
      <view class="tab" :class="{ 'active': activeTab === 1 }" @tap="switchTab(1)">卡牌原图缓存</view>
    </view>

    <!-- ===== Tab1 订单拍照留痕 ===== -->
    <template v-if="activeTab === 0">
      <view class="summary-bar">
        <text class="summary-text">共 {{ total }} 张照片，占用 {{ formatSize(totalSize) }}</text>
        <view class="cleanup-group">
          <picker mode="selector" :range="monthLabels" :value="monthsIdx" @change="onMonthsChange">
            <view class="months-picker">
              <text class="months-text">{{ monthLabels[monthsIdx] }}</text>
              <text class="months-arrow">▾</text>
            </view>
          </picker>
          <view class="clean-btn" @tap="openCleanup"><text class="clean-btn-text">一键清理</text></view>
        </view>
      </view>
      <view class="hint-bar">
        <text class="hint-text">清理：删除已完成订单中、{{ monthLabels[monthsIdx] }}拍照的留痕照片（含取件码/物流照）</text>
      </view>

      <scroll-view class="cache-list" scroll-y="true">
        <view class="order-item" v-for="g in orders" :key="g.orderNo">
          <view class="order-head" @tap="toggleOrder(g.orderNo)">
            <view class="order-check" :class="{ 'checked': isOrderSelected(g.orderNo) }">
              <text class="check-mark" v-if="isOrderSelected(g.orderNo)">✓</text>
            </view>
            <text class="order-no">{{ g.shortName || g.orderNo }}</text>
            <text class="order-status" :class="'st-' + statusKey(g.status)">{{ statusLabel(g.status) }}</text>
          </view>
          <view class="order-thumbs">
            <image class="ph-thumb" v-for="p in g.photos" :key="p.index"
              :src="p.src" mode="aspectFill" @tap.stop="openPhotoViewer(g, p)" />
          </view>
          <text class="order-meta">{{ g.photoCount }} 张 · 占用 {{ formatSize(g.size) }} · 点击缩略图可预览</text>
        </view>
        <view v-if="!loading && !orders.length" class="empty"><text class="empty-text">暂无订单拍照留痕</text></view>
        <view v-if="loading" class="empty"><text class="empty-text">加载中…</text></view>
      </scroll-view>
    </template>

    <!-- ===== Tab2 卡牌原图缓存 ===== -->
    <template v-else>
      <view class="summary-bar">
        <text class="summary-text">共 {{ origList.length }} 张缓存，占用 {{ formatSize(origTotalSize) }}</text>
        <view class="cleanup-group">
          <picker mode="selector" :range="monthLabels" :value="monthsIdx" @change="onMonthsChange">
            <view class="months-picker">
              <text class="months-text">{{ monthLabels[monthsIdx] }}</text>
              <text class="months-arrow">▾</text>
            </view>
          </picker>
          <view class="clean-btn" @tap="openOrigCleanup"><text class="clean-btn-text">一键清理</text></view>
        </view>
      </view>
      <view class="hint-bar">
        <text class="hint-text">清理：删除 {{ monthLabels[monthsIdx] }}上传的原图缓存，已引用卡牌会清空原图地址</text>
      </view>

      <view class="cache-list">
        <view class="order-item" v-for="day in origDays" :key="day.key">
          <view class="order-head" @tap="toggleDay(day)">
            <view class="order-check" :class="{ 'checked': isDaySelected(day) }">
              <text class="check-mark" v-if="isDaySelected(day)">✓</text>
            </view>
            <text class="order-no">{{ day.label }}</text>
          </view>
          <scroll-view class="order-thumbs-scroll" scroll-x="true" show-scrollbar="false">
            <view class="order-thumbs hscroll">
              <view class="ph-wrap" v-for="f in day.files" :key="f.name">
                <image class="ph-thumb" :src="f.url" mode="aspectFill" @tap.stop="openOrigViewer(day, f)" />
                <view class="ph-del" @tap.stop="openDeleteOrigOne(f)"><text class="ph-del-x">✕</text></view>
              </view>
            </view>
          </scroll-view>
          <text class="order-meta">{{ day.files.length }} 张 · 占用 {{ formatSize(day.size) }} · 点击缩略图可预览</text>
        </view>
        <view v-if="!loading && !origList.length" class="empty"><text class="empty-text">暂无缓存原图</text></view>
        <view v-if="loading" class="empty"><text class="empty-text">加载中…</text></view>
      </view>
    </template>

    <!-- ===== 确认弹窗（清理/删除） ===== -->
    <view v-if="showModal" class="modal-mask" @tap="showModal = false">
      <view class="modal-box" @tap.stop>
        <text class="mod-title">{{ modal.title }}</text>
        <text class="mod-desc">{{ modal.desc }}</text>
        <text class="mod-desc sub" v-if="modal.sub">{{ modal.sub }}</text>
        <view class="mod-btns">
          <view class="mod-btn cancel" @tap="showModal = false"><text>取消</text></view>
          <view class="mod-btn ok danger" @tap="doModal"><text>确认{{ modal.okText || '删除' }}</text></view>
        </view>
      </view>
    </view>

    <!-- ===== 图片详情弹窗：大图 + 相关信息 ===== -->
    <view v-if="viewer" class="viewer-mask" @tap="closeViewer">
      <view class="viewer-box" @tap.stop>
        <view class="viewer-img-area">
          <image class="viewer-img" :src="viewer.img" mode="aspectFit"></image>
          <view class="viewer-close" @tap.stop="closeViewer"><text class="viewer-close-x">✕</text></view>
        </view>
        <view class="viewer-info">
          <view class="viewer-row" v-for="(f, i) in viewer.fields" :key="i">
            <text class="viewer-label">{{ f.label }}</text>
            <text class="viewer-val" selectable>{{ f.value }}</text>
          </view>
        </view>
        <view class="viewer-delete" v-if="viewer.onDelete" @tap="viewerDelete">
          <text class="viewer-delete-text">删除这张图片</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import {
  getOrigCache, deleteOrigCache, cleanupOrigCache,
  getOrderPhotoCaches, cleanupOrderPhotoCaches, deleteOrderPhotoCaches,
} from '@/api/index.js'

const activeTab = ref(0)
const loading = ref(false)

/* ===== Tab1 订单拍照留痕 ===== */
const orders = ref([])
const total = ref(0)
const totalSize = ref(0)
const selOrders = ref([])
const monthLabels = ['1个月前', '3个月前', '6个月前', '12个月前']
const monthsValues = [1, 3, 6, 12]
const monthsIdx = ref(1)   // 默认 3 个月

// 给订单照片文件流 URL 附加 token（<image> 只能带 query；后端 /photos/:index/file 鉴权接受 ?token=）
const withToken = (url) => {
  if (!url || url.includes('?token=')) return url
  const token = uni.getStorageSync('token')
  if (!token) return url
  return url + (url.includes('?') ? '&' : '?') + 'token=' + token
}

const loadOrderPhotos = async () => {
  loading.value = true
  try {
    const data = await getOrderPhotoCaches()
    orders.value = (data?.list || []).map(g => ({ ...g, photos: g.photos.map(p => ({ ...p, src: withToken(p.src) })) }))
    total.value = data?.total || 0
    totalSize.value = data?.totalSize || 0
    const nos = new Set(orders.value.map(o => o.orderNo))
    selOrders.value = selOrders.value.filter(n => nos.has(n))
  } catch (e) {
    uni.showToast({ title: '加载失败：' + (e.message || '网络错误'), icon: 'none' })
  } finally {
    loading.value = false
  }
}

const onMonthsChange = (e) => { monthsIdx.value = Number(e.detail.value) }

const statusLabel = (s) => ({ '': '待处理', pending: '待处理', picking: '待拣卡', shipping: '待发货', done: '已完成' }[s] || s || '待处理')
const statusKey = (s) => ['pending', 'picking', 'shipping', 'done'].includes(s) ? s : 'pending'

const isOrderSelected = (n) => selOrders.value.includes(n)
const toggleOrder = (n) => {
  const i = selOrders.value.indexOf(n)
  if (i === -1) selOrders.value.push(n)
  else selOrders.value.splice(i, 1)
}
const toggleAllOrders = () => {
  selOrders.value = selOrders.value.length === orders.value.length ? [] : orders.value.map(o => o.orderNo)
}
// 订单照片详情弹窗：大图 + 所属订单/文件名/时间/位置/大小
const openPhotoViewer = (g, p) => {
  openViewer({
    img: p.src,
    name: p.filename,
    fields: [
      { label: '所属订单', value: (g.shortName || g.orderNo) + '（' + statusLabel(g.status) + '）' },
      { label: '订单编号', value: g.orderNo },
      { label: '文件名', value: p.filename },
      { label: '上传时间', value: formatDateTime(p.uploadedAt) },
      { label: '大小', value: formatSize(p.size) },
      { label: '位置', value: p.src },
    ],
    onDelete: null, // 订单照片按订单批量删除/清理，不提供单张删除
  })
}

/* ===== 一键清理 ===== */
const openCleanup = () => {
  if (!total.value) return uni.showToast({ title: '暂无可清理照片', icon: 'none' })
  showModal.value = true
  modal.value = {
    title: '一键清理照片',
    desc: `将删除「已完成」订单中、${monthLabels[monthsIdx.value]}拍照的留痕照片（当前共 ${total.value} 张），删除后不可恢复。`,
    sub: '未完成订单、更近期拍照的照片不受影响。',
    okText: '清理',
    action: 'cleanup',
  }
}

/* ===== Tab2 卡牌原图缓存 ===== */
const origList = ref([])
const origTotalSize = ref(0)
const selOrig = ref([])

const loadOrig = async () => {
  loading.value = true
  try {
    const data = await getOrigCache()
    origList.value = data?.list || []
    origTotalSize.value = data?.totalSize || 0
    const names = new Set(origList.value.map(i => i.name))
    selOrig.value = selOrig.value.filter(n => names.has(n))
  } catch (e) {
    uni.showToast({ title: '加载失败：' + (e.message || '网络错误'), icon: 'none' })
  } finally {
    loading.value = false
  }
}

// 按天分组（本地时区日期）
const dayKey = (iso) => {
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const dayLabel = (key) => {
  const [y, m, d] = key.split('-').map(Number)
  return `${y}年${m}月${d}日`
}
const origDays = computed(() => {
  const map = new Map()
  for (const f of origList.value) {
    const k = dayKey(f.uploadedAt)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(f)
  }
  return [...map.entries()].map(([k, files]) => ({
    key: k,
    label: dayLabel(k),
    files,
    size: files.reduce((s, f) => s + (f.size || 0), 0),
  }))
})

// 按天勾选（selOrig 存文件名的并集，批量删除仍走 deleteOrigCache）
const isDaySelected = (day) => day.files.every(f => selOrig.value.includes(f.name))
const toggleDay = (day) => {
  if (isDaySelected(day)) {
    const names = new Set(day.files.map(f => f.name))
    selOrig.value = selOrig.value.filter(n => !names.has(n))
  } else {
    selOrig.value = [...selOrig.value, ...day.files.map(f => f.name)]
  }
}
const toggleAllOrig = () => {
  selOrig.value = selOrig.value.length === origList.value.length ? [] : origList.value.map(i => i.name)
}
// 原图详情弹窗：大图 + 文件名/时间/大小/引用/位置，可单张删除
const openOrigViewer = (day, f) => {
  openViewer({
    img: f.url,
    name: f.name,
    fields: [
      { label: '文件名', value: f.name },
      { label: '上传时间', value: formatDateTime(f.uploadedAt) },
      { label: '大小', value: formatSize(f.size) },
      { label: '引用', value: f.refCount > 0 ? '被 ' + f.refCount + ' 张卡引用' : '未被引用' },
      { label: '位置', value: f.url },
    ],
    onDelete: (name) => { selOrig.value = [name]; openDeleteOrig() },
  })
}
const openDeleteOrigOne = (item) => {
  selOrig.value = [item.name]
  openDeleteOrig()
}

/* ===== 图片详情弹窗 ===== */
const viewer = ref(null)
const openViewer = (opt) => { viewer.value = opt }
const closeViewer = () => { viewer.value = null }
const viewerDelete = () => {
  const onDelete = viewer.value?.onDelete
  const name = viewer.value?.name
  closeViewer()
  if (onDelete) onDelete(name)
}

/* ===== 删除弹窗（两种来源） ===== */
const showModal = ref(false)
const modal = ref({ title: '', desc: '', sub: '', okText: '删除', action: '' })

const openDeleteOrders = () => {
  if (!selOrders.value.length) return
  showModal.value = true
  modal.value = {
    title: '删除订单照片',
    desc: `确定删除选中的 ${selOrders.value.length} 个订单的全部拍照留痕？删除后不可恢复。`,
    okText: '删除',
    action: 'deleteOrders',
  }
}
const openDeleteOrig = () => {
  if (!selOrig.value.length) return
  showModal.value = true
  modal.value = {
    title: '删除缓存原图',
    desc: `确定删除选中的 ${selOrig.value.length} 张原图？`,
    sub: '已引用该图的卡牌会清空原图地址，不影响卡牌其他信息。',
    okText: '删除',
    action: 'deleteOrig',
  }
}
const openOrigCleanup = () => {
  if (!origList.value.length) return uni.showToast({ title: '暂无可清理原图', icon: 'none' })
  showModal.value = true
  modal.value = {
    title: '一键清理原图',
    desc: `将删除 ${monthLabels[monthsIdx.value]}上传的原图缓存（共 ${origList.value.length} 张，占用 ${formatSize(origTotalSize.value)}），删除后不可恢复。`,
    sub: '已引用的卡牌会清空原图地址，不影响卡牌其他信息。',
    okText: '清理',
    action: 'origCleanup',
  }
}

const doModal = async () => {
  const action = modal.value.action
  showModal.value = false
  try {
    if (action === 'cleanup') {
      const res = await cleanupOrderPhotoCaches(monthsValues[monthsIdx.value])
      uni.showToast({ title: `已清理 ${res?.deleted || 0} 张照片`, icon: 'success' })
      loadOrderPhotos()
    } else if (action === 'deleteOrders') {
      const orderNos = [...selOrders.value]
      const res = await deleteOrderPhotoCaches(orderNos)
      uni.showToast({ title: `已删除 ${res?.deleted || 0} 张照片`, icon: 'success' })
      selOrders.value = []
      loadOrderPhotos()
    } else if (action === 'origCleanup') {
      const res = await cleanupOrigCache(monthsValues[monthsIdx.value])
      uni.showToast({ title: `已清理 ${res?.deleted || 0} 张原图`, icon: 'success' })
      loadOrig()
    } else if (action === 'deleteOrig') {
      const files = [...selOrig.value]
      const res = await deleteOrigCache(files)
      uni.showToast({ title: `已删除 ${res?.deleted || 0} 张`, icon: 'success' })
      selOrig.value = []
      loadOrig()
    }
  } catch (e) {
    uni.showToast({ title: '操作失败：' + (e.message || '网络错误'), icon: 'none' })
  }
}

/* ===== 通用 ===== */
const switchTab = (i) => {
  activeTab.value = i
  if (i === 0) loadOrderPhotos()
  else loadOrig()
}

const goBack = () => uni.reLaunch({ url: '/pages/admin/dashboard' })

const formatSize = (bytes) => {
  if (!bytes && bytes !== 0) return '0 KB'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(2) + ' MB'
}
const formatDateTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

onShow(() => {
  if (activeTab.value === 0) loadOrderPhotos()
  else loadOrig()
})
</script>

<style scoped>
.page-container {
  background-color: #F5F5F7;
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
}

/* ========== 顶部工具栏 ========== */
.toolbar-panel {
  background-color: #FFFFFF;
  flex-shrink: 0;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: 46px;
}
.toolbar-left { flex: 1; }
.tool-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.icon-back { width: 20px; height: 20px; }
.tool-title { font-size: 16px; font-weight: 600; color: #1A1A1A; }
.toolbar-right { flex: 1; display: flex; justify-content: flex-end; }

.select-actions { display: flex; align-items: center; gap: 12px; }
.select-all { font-size: 13px; color: #666; padding: 4px; }
.del-btn { background: #FF0000; border-radius: 14px; padding: 6px 14px; }
.del-btn-text { color: #FFF; font-size: 13px; }

/* ========== 页签 ========== */
.tabs {
  display: flex;
  background: #FFF;
  border-bottom: 1px solid #F0F0F0;
  flex-shrink: 0;
}
.tab {
  flex: 1;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #666;
  border-bottom: 2px solid transparent;
}
.tab.active { color: #FF0000; font-weight: 600; border-bottom-color: #FF0000; }

/* ========== 汇总条 ========== */
.summary-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  flex-shrink: 0;
}
.summary-text { font-size: 12px; color: #666; }

/* ========== 清理组 ========== */
.cleanup-group { display: flex; align-items: center; gap: 8px; }
.months-picker {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #FFF;
  border: 1px solid #E0E0E0;
  border-radius: 14px;
  padding: 4px 10px;
}
.months-text { font-size: 12px; color: #1A1A1A; }
.months-arrow { font-size: 10px; color: #999; }
.clean-btn { background: #FF0000; border-radius: 14px; padding: 5px 12px; }
.clean-btn-text { color: #FFF; font-size: 12px; }

.hint-bar { padding: 0 16px 8px; flex-shrink: 0; }
.hint-text { font-size: 11px; color: #999; }

/* ========== 缓存列表 ========== */
.cache-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px 12px;
  box-sizing: border-box;
}

/* --- Tab1 订单分组 --- */
.order-item {
  background: #FFF;
  border-radius: 12px;
  padding: 10px;
  margin-bottom: 10px;
}
.order-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.order-check {
  width: 22px;
  height: 22px;
  border-radius: 11px;
  border: 1.5px solid #CCC;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.order-check.checked { background: #FF0000; border-color: #FF0000; }
.check-mark { color: #FFF; font-size: 13px; font-weight: bold; }
.order-no { flex: 1; font-size: 14px; font-weight: 600; color: #1A1A1A; }
.order-status { font-size: 12px; padding: 2px 8px; border-radius: 8px; }
.st-pending { color: #FF0000; background: #FFEBEB; }
.st-picking { color: #3478F6; background: #EAF1FF; }
.st-shipping { color: #FF6A00; background: #FFF1E5; }
.st-done { color: #34C759; background: #E9F9ED; }

.order-thumbs {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.ph-thumb {
  width: 56px;
  height: 56px;
  border-radius: 8px;
  background: #EEE;
}
.order-meta {
  display: block;
  font-size: 11px;
  color: #999;
  margin-top: 8px;
}

/* --- Tab2 原图缓存（按天分组，复用订单分组样式） --- */
.order-thumbs-scroll {
  margin-top: 10px;
  width: 100%;
  white-space: nowrap;
}
.order-thumbs.hscroll {
  display: inline-flex;
  flex-wrap: nowrap;
  margin-top: 0;
}
.ph-wrap { position: relative; flex-shrink: 0; }
.ph-del {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 18px;
  height: 18px;
  border-radius: 9px;
  background: #FF0000;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}
.ph-del-x { color: #FFF; font-size: 11px; font-weight: bold; line-height: 1; }

.empty { display: flex; justify-content: center; padding: 60px 0; }
.empty-text { color: #999; font-size: 14px; }

/* ========== 弹窗 ========== */
.modal-mask {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}
.modal-box {
  width: 80%;
  background: #FFF;
  border-radius: 16px;
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
}
.mod-title { font-size: 16px; font-weight: 600; color: #1A1A1A; text-align: center; margin-bottom: 12px; }
.mod-desc { font-size: 13px; color: #333; text-align: center; line-height: 1.6; }
.mod-desc.sub { color: #999; font-size: 12px; margin-top: 6px; }
.mod-btns { display: flex; gap: 12px; margin-top: 18px; }
.mod-btn {
  flex: 1;
  height: 40px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mod-btn.cancel { background: #F2F2F2; }
.mod-btn.cancel text { color: #666; font-size: 14px; }
.mod-btn.ok { background: #FF0000; }
.mod-btn.ok text { color: #FFF; font-size: 14px; font-weight: 500; }
.mod-btn.ok.danger { background: #FF0000; }

/* ========== 图片详情弹窗 ========== */
.viewer-mask {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.viewer-box {
  width: 90%;
  max-height: 88vh;
  background: #FFF;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.viewer-img-area {
  position: relative;
  background: #1A1A1A;
  height: 50vh;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.viewer-img { width: 100%; height: 100%; }
.viewer-close {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 28px;
  height: 28px;
  border-radius: 14px;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}
.viewer-close-x { color: #FFF; font-size: 16px; font-weight: bold; }
.viewer-info {
  padding: 12px 16px 4px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}
.viewer-row { display: flex; align-items: flex-start; }
.viewer-label {
  width: 64px;
  flex-shrink: 0;
  font-size: 12px;
  color: #999;
  line-height: 1.5;
}
.viewer-val {
  flex: 1;
  font-size: 13px;
  color: #1A1A1A;
  line-height: 1.5;
  word-break: break-all;
}
.viewer-delete {
  margin: 4px 16px 16px;
  height: 40px;
  border-radius: 20px;
  background: #FF0000;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.viewer-delete-text { color: #FFF; font-size: 14px; font-weight: 500; }
</style>
