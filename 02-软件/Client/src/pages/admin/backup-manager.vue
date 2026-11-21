<template>
  <view class="page">
    <view class="topbar">
      <view class="tbtn" @tap="goBack"><image class="timg" src="/static/icons/ic_back.png" mode="aspectFit" /></view>
      <text class="ttl">备份管理</text>
      <view class="tbtn-entry" @tap="onBackup"><text class="tbtn-entry-text">{{ backing ? '备份中…' : '立即备份' }}</text></view>
    </view>

    <scroll-view class="content" scroll-y="true">
      <view class="tips-box">
        <text class="tips-text">备份 = 把当前数据库完整存一份（不影响运行）。</text>
        <text class="tips-text">恢复 = 用某次备份覆盖当前数据（会丢失恢复之后的新数据，请谨慎）。</text>
      </view>

      <view v-if="loading" class="loading">加载中...</view>
      <view v-else-if="list.length === 0" class="empty">还没有备份，点右上角「立即备份」</view>

      <view v-for="b in list" :key="b.name" class="bk-card">
        <view class="bk-main">
          <view class="bk-left">
            <text class="bk-name">{{ formatName(b.name) }}</text>
            <text class="bk-size">{{ b.sizeMB }} MB</text>
          </view>
          <view class="bk-actions">
            <view class="bk-btn bk-restore" @tap="onRestore(b)"><text>恢复</text></view>
            <view class="bk-btn bk-del" @tap="onDelete(b)"><text>删除</text></view>
          </view>
        </view>
        <view class="bk-links">
          <text class="bk-link" @tap="onOpenFolder(b)">📂 打开文件夹</text>
          <text class="bk-link-copy" @tap="onCopyPath(b)">复制路径</text>
        </view>
      </view>

      <view class="footer-space"></view>
    </scroll-view>

    <!-- 二次确认浮层：**故意不用 uni.showModal**
         uni-app 的 H5 弹窗是全局单例，连着弹两次时第二次会复用同一个 DOM，
         而第一次的淡出收尾（约 300ms）随后把 display:none 落下来，把第二次一起带走
         —— 表现就是「点了继续，弹窗一闪就没了，什么都没发生」。自己画一层最稳。 -->
    <view v-if="askYes" class="ask-mask">
      <view class="ask-box">
        <text class="ask-title">最终确认</text>
        <text class="ask-body">确定用 {{ formatName(askYes.name) }} 的备份覆盖当前数据库吗？</text>
        <text class="ask-warn">恢复后新产生的数据会丢失，且无法找回！</text>
        <input class="ask-input" v-model="askText" placeholder="输入英文大写 YES 才能继续" />
        <view class="ask-ft">
          <view class="ask-btn" @tap="askCancel"><text class="ask-btn-t">取消</text></view>
          <view class="ask-btn ask-btn-p" @tap="doRestore"><text class="ask-btn-t-p">确定恢复</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { authFetch } from '@/utils/authFetch.js'
import { goBack as navBack } from '@/utils/nav.js'

const list = ref([])
const loading = ref(true)
const backing = ref(false)

const apiBase = '/v1/api/admin'

const formatName = (n) => {
  // 20260818-102008 → 2026-08-18 10:20:08
  const d = n.slice(0, 8), t = n.slice(9)
  return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)} ${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}`
}

const load = async () => {
  loading.value = true
  try {
    const r = await authFetch(apiBase + '/backups')
    const d = await r.json()
    list.value = d.list || []
  } catch (_) { list.value = [] }
  loading.value = false
}

const onBackup = () => {
  if (backing.value) return
  uni.showModal({
    title: '立即备份',
    content: '将当前数据库完整备份一份，约需10秒。确认备份？',
    confirmText: '备份',
    success: async (r) => {
      if (!r.confirm) return
      backing.value = true
      uni.showLoading({ title: '备份中...' })
      try {
        const resp = await authFetch(apiBase + '/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
        const d = await resp.json()
        uni.hideLoading()
        if (d.ok) {
          uni.showToast({ title: '备份完成', icon: 'success' })
          load()
        } else {
          uni.showToast({ title: '备份失败: ' + (d.error || '未知'), icon: 'none', duration: 3000 })
        }
      } catch (e) {
        uni.hideLoading()
        uni.showToast({ title: '备份失败: ' + (e.message || '网络错误'), icon: 'none' })
      }
      backing.value = false
    }
  })
}

// 等待输入 YES 的那次确认（null = 没有在问）
const askYes = ref(null)
const askText = ref('')
const asking = ref(false)

const onRestore = (b) => {
  // 第一层确认用 uni.showModal 没关系 —— 只有**连续两次**才会撞上单例的收尾问题
  uni.showModal({
    title: '恢复备份',
    content: `确定用 ${formatName(b.name)} 的备份覆盖当前数据库吗？\n下一步要输入 YES 才会真的执行。`,
    confirmText: '继续',
    success: (r) => {
      if (!r.confirm) return
      askText.value = ''
      askYes.value = b
    }
  })
}

const askCancel = () => { askYes.value = null; askText.value = '' }

const doRestore = async () => {
  const b = askYes.value
  if (!b || asking.value) return
  // 原样比对：大小写/空格都算错，防手滑
  if (askText.value.trim() !== 'YES') {
    uni.showToast({ title: '要输入大写 YES 才能恢复', icon: 'none' })
    return
  }
  askYes.value = null
  askText.value = ''
  asking.value = true
  uni.showLoading({ title: '恢复中...' })
  try {
    const resp = await authFetch(apiBase + '/backups/' + b.name + '/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'YES' })
    })
    const d = await resp.json()
    uni.hideLoading()
    if (d.ok) {
      uni.showToast({ title: '恢复完成，请重启后端', icon: 'success', duration: 3000 })
    } else {
      uni.showToast({ title: '恢复失败: ' + (d.error || '未知'), icon: 'none', duration: 3000 })
    }
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: '恢复失败: ' + (e.message || '网络错误'), icon: 'none' })
  }
  asking.value = false
}

const onDelete = (b) => {
  uni.showModal({
    title: '删除备份',
    content: `删除 ${formatName(b.name)} 的备份？删除后不可找回。`,
    confirmText: '删除',
    success: async (r) => {
      if (!r.confirm) return
      try {
        const resp = await authFetch(apiBase + '/backups/' + b.name, { method: 'DELETE' })
        const d = await resp.json()
        if (d.ok) {
          uni.showToast({ title: '已删除', icon: 'success' })
          load()
        } else {
          uni.showToast({ title: '删除失败: ' + (d.error || '未知'), icon: 'none' })
        }
      } catch (e) {
        uni.showToast({ title: '删除失败', icon: 'none' })
      }
    }
  })
}

// 打开备份所在文件夹 (本机部署时在电脑上弹出资源管理器)
const onOpenFolder = async (b) => {
  try {
    const resp = await authFetch(apiBase + '/backups/' + b.name + '/open', { method: 'POST' })
    const d = await resp.json()
    if (d.ok) {
      uni.showToast({ title: '已在电脑上打开', icon: 'success' })
    } else {
      uni.showToast({ title: '打开失败: ' + (d.error || ''), icon: 'none', duration: 3000 })
    }
  } catch (e) {
    uni.showToast({ title: '打开失败', icon: 'none' })
  }
}

// 复制备份文件夹路径到剪贴板
const onCopyPath = async (b) => {
  try {
    const resp = await authFetch(apiBase + '/backups/' + b.name + '/path')
    const d = await resp.json()
    if (d.ok && d.path) {
      uni.setClipboardData({ data: d.path, success: () => uni.showToast({ title: '路径已复制', icon: 'success' }) })
    }
  } catch (e) {
    uni.showToast({ title: '获取路径失败', icon: 'none' })
  }
}

const goBack = () => navBack('/pages/admin/dashboard')
load()
</script>

<style scoped>
* { box-sizing: border-box; }
.page { display: flex; flex-direction: column; height: 100vh; background: #F5F5F7; }
.topbar { background: #FFF; padding: 14px 16px 12px; display: flex; align-items: center; justify-content: space-between; position: relative; flex-shrink: 0; }
.tbtn { width: 32px; height: 32px; border-radius: 16px; background: #F0F0F0; display: flex; align-items: center; justify-content: center; }
.timg { width: 18px; height: 18px; }
.ttl { position: absolute; left: 50%; transform: translateX(-50%); font-size: 16px; font-weight: 500; color: #1A1A1A; }
.tbtn-entry { height: 32px; border-radius: 16px; background: #1660C6; display: flex; align-items: center; justify-content: center; padding: 0 14px; }
.tbtn-entry-text { font-size: 12px; font-weight: 500; color: #FFF; }
.content { flex: 1; padding: 14px 16px; }
.tips-box { background: #E8F0FE; border-radius: 10px; padding: 10px 12px; margin-bottom: 14px; }
.tips-text { display: block; font-size: 12px; color: #1660C6; line-height: 1.6; }
.loading, .empty { text-align: center; color: #999; font-size: 13px; padding: 40px 0; }
.bk-card { background: #FFF; border-radius: 12px; padding: 14px; margin-bottom: 10px; }
.bk-main { display: flex; justify-content: space-between; align-items: center; }
.bk-left { display: flex; flex-direction: column; }
.bk-name { font-size: 15px; font-weight: 500; color: #1A1A1A; }
.bk-size { font-size: 12px; color: #999; margin-top: 4px; }
.bk-actions { display: flex; gap: 8px; }
.bk-btn { height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; padding: 0 14px; }
.bk-restore { background: #1660C6; }
.bk-restore text { font-size: 13px; color: #FFF; }
.bk-del { background: #FEF0F0; border: 1px solid #FA5151; }
.bk-del text { font-size: 13px; color: #FA5151; }
.bk-links { display: flex; gap: 16px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #F0F0F0; }
.bk-link { font-size: 12px; color: #1660C6; }
.bk-link-copy { font-size: 12px; color: #999; }
.footer-space { height: 30px; }
/* 二次确认浮层 */
.ask-mask { position: fixed; left: 0; right: 0; top: 0; bottom: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 999; padding: 0 24px; }
.ask-box { width: 100%; max-width: 380px; background: #FFF; border-radius: 12px; padding: 18px 16px 14px; }
.ask-title { display: block; text-align: center; font-size: 16px; font-weight: 600; color: #1A1A1A; margin-bottom: 12px; }
.ask-body { display: block; font-size: 14px; color: #333; line-height: 1.6; }
.ask-warn { display: block; font-size: 13px; color: #FA5151; line-height: 1.6; margin-top: 6px; }
.ask-input { margin-top: 12px; height: 40px; border: 1px solid #DDD; border-radius: 8px; padding: 0 10px; font-size: 14px; background: #FAFAFA; }
.ask-ft { display: flex; gap: 10px; margin-top: 16px; }
.ask-btn { flex: 1; height: 40px; border-radius: 8px; background: #F0F0F0; display: flex; align-items: center; justify-content: center; }
.ask-btn-p { background: #FA5151; }
.ask-btn-t { font-size: 14px; color: #333; }
.ask-btn-t-p { font-size: 14px; color: #FFF; font-weight: 500; }
</style>
