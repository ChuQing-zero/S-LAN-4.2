<template>
  <view v-if="visible" class="pf-overlay" @tap="close">
    <view class="pf-card" @tap.stop>
      <view class="pf-head">
        <text class="pf-title">图源目录 · {{ packCode }}</text>
        <text class="pf-close" @tap="close">✕</text>
      </view>

      <text class="pf-path">{{ dir || '读取中…' }}</text>

      <view class="pf-actions">
        <view class="pf-btn" @tap="copyPath"><text class="pf-btn-t">复制路径</text></view>
        <view class="pf-btn" @tap="openInExplorer"><text class="pf-btn-t">🖥 在电脑上打开</text></view>
        <view class="pf-btn" @tap="reload"><text class="pf-btn-t">↻ 刷新</text></view>
      </view>

      <!-- 找不到这张卡的文件时**不报错、不空白**，退回显示整个卡包，并说清为什么 -->
      <view v-if="highlight && highlightHit.length" class="pf-hint pf-hint-ok">
        <text class="pf-hint-t">「{{ highlight }}」在图源里有 {{ highlightHit.length }} 个文件，已高亮</text>
      </view>
      <view v-else-if="highlight" class="pf-hint pf-hint-warn">
        <text class="pf-hint-t">「{{ highlight }}」在图源里没有对应文件，已显示整个卡包（{{ packCode }}）</text>
      </view>

      <view v-if="loading" class="pf-empty"><text>读取中…</text></view>
      <view v-else-if="!exists" class="pf-empty">
        <text>这个包在图源里还没有目录</text>
        <text class="pf-empty-sub">{{ dir }}</text>
      </view>
      <view v-else-if="!files.length" class="pf-empty"><text>这个目录里没有图片文件</text></view>

      <scroll-view v-else class="pf-list" scroll-y="true">
        <view v-for="f in files" :key="f.name" class="pf-row" :class="{ 'pf-row-hit': isHit(f) }">
          <image class="pf-thumb" :src="f.url" mode="aspectFit" />
          <view class="pf-info">
            <template v-if="renaming === f.name">
              <input class="pf-inp" v-model="renameTo" />
            </template>
            <template v-else>
              <text class="pf-name">{{ f.name }}</text>
              <text class="pf-meta">{{ fmtSize(f.size) }} · {{ f.mtime.slice(0, 10) }}</text>
            </template>
          </view>
          <view class="pf-ops">
            <template v-if="renaming === f.name">
              <view class="pf-op pf-op-ok" @tap="doRename(f)"><text class="pf-op-t-w">确定</text></view>
              <view class="pf-op" @tap="renaming = ''"><text class="pf-op-t">取消</text></view>
            </template>
            <template v-else>
              <view class="pf-op" @tap="startRename(f)"><text class="pf-op-t">改名</text></view>
              <view class="pf-op pf-op-del" @tap="askDelete(f)"><text class="pf-op-t-w">删除</text></view>
            </template>
          </view>
        </view>

        <view v-if="ignored.length" class="pf-ignored">
          <text class="pf-ignored-t">另有 {{ ignored.length }} 个文件被忽略：</text>
          <text class="pf-ignored-l" v-for="g in ignored" :key="g.name">{{ g.name }} —— {{ g.reason }}</text>
        </view>
      </scroll-view>

      <text class="pf-foot">改文件名 / 删图会直接改动共享图源（V1.1 正式版读的是同一份）。删掉的图会先复制到 Server\Storage\deleted-files\ 里，能捞回来。</text>
    </view>
  </view>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  packCode: { type: String, default: '' },
  // 要定位的卡牌编号。找到了高亮那几个文件；找不到就退回显示整包 —— 用户明确要的行为
  highlight: { type: String, default: '' },
})
// changed：图源真的被动过了（改名 / 删图）。调用方（卡牌目录页）收到后要刷新瓦片 ——
// 它的图片地址带着缓存，不刷新的话页面上还挂着旧文件那张图。
const emit = defineEmits(['close', 'changed'])

const API = '/api/tcg'
const loading = ref(false)
const exists = ref(false)
const dir = ref('')
const files = ref([])
const ignored = ref([])
const renaming = ref('')
const renameTo = ref('')

const req = (url, opts = {}) => {
  const token = uni.getStorageSync('token')
  return uni.request({
    url: API + url,
    header: { 'Authorization': 'Bearer ' + (token || ''), 'Content-Type': 'application/json' },
    ...opts,
  }).then(r => r.data)
}

const fmtSize = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB'

// 文件名形如 {编号}-{罕贵}[-{异画号}].ext，编号本身含 '-'，
// 所以只能按「以 编号- 开头」来认，不能反过来去拆文件名的段。
const isHit = (f) => !!props.highlight && f.name.startsWith(props.highlight + '-')
const highlightHit = ref([])

const load = async () => {
  if (!props.packCode) return
  loading.value = true; renaming.value = ''
  try {
    const d = await req('/pack-files/' + encodeURIComponent(props.packCode))
    if (d.error) {
      uni.showToast({ title: '❌ ' + d.error, icon: 'none' })
      dir.value = ''; files.value = []; exists.value = false
    } else {
      dir.value = d.dir || ''
      exists.value = !!d.exists
      files.value = d.files || []
      ignored.value = d.ignored || []
      highlightHit.value = files.value.filter(isHit)
    }
  } catch (e) {
    uni.showToast({ title: '读取失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

const reload = () => load()
const close = () => emit('close')

const copyPath = () => {
  if (!dir.value) return
  uni.setClipboardData({ data: dir.value, success: () => uni.showToast({ title: '路径已复制', icon: 'none' }) })
}

const openInExplorer = async () => {
  try {
    const d = await req('/pack-files/' + encodeURIComponent(props.packCode) + '/open', { method: 'POST' })
    // 手机 / 平板打不开服务器那台电脑的资源管理器，这里要给出人话解释
    uni.showToast({ title: d.ok ? '已在本机打开' : '❌ ' + (d.error || '打开失败'), icon: 'none' })
  } catch (e) { uni.showToast({ title: '只能在服务器那台电脑上用', icon: 'none' }) }
}

const startRename = (f) => { renaming.value = f.name; renameTo.value = f.name }

const doRename = async (f) => {
  const to = String(renameTo.value || '').trim()
  if (!to || to === f.name) { renaming.value = ''; return }
  const d = await req('/pack-files/' + encodeURIComponent(props.packCode) + '/rename',
    { method: 'POST', data: { from: f.name, to } })
  if (d.ok) { uni.showToast({ title: '✅ 已改名', icon: 'none' }); emit('changed'); await load() }
  else uni.showToast({ title: '❌ ' + (d.error || '改名失败'), icon: 'none' })
}

const askDelete = (f) => {
  uni.showModal({
    title: '删除这张图？',
    content: f.name + '\n\n会先复制到 Server\\Storage\\deleted-files\\ 再删，能捞回来。',
    confirmText: '删除', confirmColor: '#FF3B30',
    success: async (r) => {
      if (!r.confirm) return
      const d = await req('/pack-files/' + encodeURIComponent(props.packCode) + '/' + encodeURIComponent(f.name), { method: 'DELETE' })
      if (d.ok) { uni.showToast({ title: '已删除', icon: 'none' }); emit('changed'); await load() }
      else uni.showToast({ title: '❌ ' + (d.error || '删除失败'), icon: 'none' })
    },
  })
}

watch(() => [props.visible, props.packCode, props.highlight], () => { if (props.visible) load() })
</script>

<style scoped>
.pf-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 900; }
.pf-card { width: min(760px, 94vw); max-height: 88vh; background: #FFF; border-radius: 14px; padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; }
.pf-head { display: flex; align-items: center; justify-content: space-between; }
.pf-title { font-size: 15px; font-weight: 600; color: #1A1A1A; }
.pf-close { font-size: 16px; color: #999; padding: 0 4px; }
.pf-path { font-size: 11px; color: #666; font-family: monospace; word-break: break-all; background: #F5F5F7; padding: 6px 8px; border-radius: 6px; }
.pf-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.pf-btn { padding: 5px 12px; border: 1px solid #DDD; border-radius: 14px; }
.pf-btn-t { font-size: 12px; color: #333; }
.pf-hint { padding: 7px 10px; border-radius: 8px; }
.pf-hint-t { font-size: 12px; }
.pf-hint-ok { background: #E8F7EE; }
.pf-hint-ok .pf-hint-t { color: #1B7F3B; }
.pf-hint-warn { background: #FFF8E1; }
.pf-hint-warn .pf-hint-t { color: #8A6100; }
.pf-empty { padding: 28px 0; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.pf-empty text { font-size: 13px; color: #888; }
.pf-empty-sub { font-size: 11px; font-family: monospace; color: #AAA; }
.pf-list { flex: 1; min-height: 120px; max-height: 56vh; }
.pf-row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; }
.pf-row + .pf-row { border-top: 1px solid #F2F2F2; }
.pf-row-hit { background: #EAF3FF; }
.pf-thumb { width: 38px; height: 53px; background: #F5F5F7; border-radius: 4px; flex-shrink: 0; }
.pf-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pf-name { font-size: 12px; color: #1A1A1A; font-family: monospace; word-break: break-all; }
.pf-meta { font-size: 10px; color: #999; }
.pf-inp { font-size: 12px; font-family: monospace; border: 1px solid #CCC; border-radius: 5px; padding: 4px 6px; width: 100%; }
.pf-ops { display: flex; gap: 6px; flex-shrink: 0; }
.pf-op { padding: 4px 10px; border-radius: 12px; background: #F2F2F7; }
.pf-op-ok { background: #34C759; }
.pf-op-del { background: #FF3B30; }
.pf-op-t { font-size: 11px; color: #333; }
.pf-op-t-w { font-size: 11px; color: #FFF; }
.pf-ignored { margin-top: 10px; padding: 8px 10px; background: #FAFAFA; border-radius: 8px; display: flex; flex-direction: column; gap: 3px; }
.pf-ignored-t { font-size: 11px; color: #888; }
.pf-ignored-l { font-size: 11px; color: #AAA; font-family: monospace; }
.pf-foot { font-size: 10px; color: #AAA; line-height: 1.5; }
</style>
