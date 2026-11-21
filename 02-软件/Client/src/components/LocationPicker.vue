<template>
  <view v-if="visible" class="modal-mask" :style="{ top: topOffset + 'px' }" @tap="onClose"></view>
  <view v-if="visible" class="popup" :style="{ top: topOffset + 'px', maxHeight: 'calc(100vh - ' + topOffset + 'px)' }" @tap.stop>
    <!-- 本地库 -->
    <text class="section-label">本地库（账号绑定）</text>
    <view class="lib-grid">
      <view
        class="lib-item"
        :class="{
          'lib-active': selLocal?.code === item.code && activeTab === 'local',
          'lib-dim': selLocal?.code === item.code && activeTab !== 'local',
          'lib-problem': item.problemCount > 0
        }"
        v-for="item in localList"
        :key="item.code"
        @tap="onLocalTap(item)"
      >
        <text class="lib-text" :class="{ 'lib-text-active': selLocal?.code === item.code && activeTab === 'local', 'lib-text-dim': selLocal?.code === item.code && activeTab !== 'local' }">{{ libLabel(item) }}</text>
        <view class="lib-actions">
          <view class="del-x" @tap.stop="onDelete(item, 'local')"><text class="del-x-char">✕</text></view>
        </view>
      </view>
      <view class="lib-item lib-add" @tap="onAdd('local')">
        <text class="lib-add-text">添加+</text>
      </view>
      <view class="lib-item lib-add" @tap="autoClaim('local')">
        <text class="lib-add-text">自动+</text>
      </view>
      <view class="lib-item lib-add lib-scan-dev" @tap="onScanDev">
        <text class="lib-add-text" style="color:#FF6666">扫描+</text>
      </view>
    </view>

    <!-- 云端库 -->
    <view class="section-header">
      <text class="section-label">云端库（公共）</text>
      <view class="cloud-server-row" @tap="onSwitchServer">
        <text class="server-label">{{ currentServerName }}</text>
        <text class="server-arrow">›</text>
      </view>
    </view>
    <view class="lib-grid">
      <view
        class="lib-item"
        :class="{
          'lib-active': selCloud?.code === item.code && activeTab === 'cloud',
          'lib-dim': selCloud?.code === item.code && activeTab !== 'cloud',
          'lib-problem': item.problemCount > 0
        }"
        v-for="item in cloudList"
        :key="item.code"
        @tap="onCloudTap(item)"
      >
        <text class="lib-text" :class="{ 'lib-text-active': selCloud?.code === item.code && activeTab === 'cloud', 'lib-text-dim': selCloud?.code === item.code && activeTab !== 'cloud' }">{{ libLabel(item) }}</text>
        <view class="lib-actions">
          <view class="del-x" @tap.stop="onDelete(item, 'cloud')"><text class="del-x-char">✕</text></view>
        </view>
      </view>
      <view class="lib-item lib-add" @tap="onAdd('cloud')">
        <text class="lib-add-text">添加+</text>
      </view>
      <view class="lib-item lib-add" @tap="autoClaim('cloud')">
        <text class="lib-add-text">自动+</text>
      </view>
      <view class="lib-item lib-add lib-scan-dev" @tap="onScanDev">
        <text class="lib-add-text" style="color:#FF6666">扫描+</text>
      </view>
    </view>

    <!-- 云端服务器切换面板 -->
    <view v-if="showServerPicker" class="server-picker">
      <text class="section-label">选择云端服务器</text>
      <view
        class="server-item"
        :class="{ 'server-active': server.url === activeServerUrl }"
        v-for="server in serverList"
        :key="server.url"
        @tap="onSelectServer(server)"
      >
        <view class="server-info">
          <text class="server-name">{{ server.name }}</text>
          <text class="server-url">{{ server.url }}</text>
        </view>
        <text class="server-check" v-if="server.url === activeServerUrl">✓</text>
      </view>
      <view class="server-item server-add" @tap="onAddServer">
        <text class="server-add-text">+ 添加服务器</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import Quagga from '@ericblade/quagga2'
import { Html5Qrcode } from 'html5-qrcode'
import { getLocalLibraries, getCloudLibraries, createLibrary, updateLibrary, deleteLibrary, listCloudServers, addCloudServer } from '@/api/index.js'
import config from '@/config/index.js'

const props = defineProps({
  topOffset: { type: Number, default: 0 }
})

const emit = defineEmits(['confirm', 'close'])

const visible = ref(false)
const selLocal = ref(null)
const selCloud = ref(null)
const activeTab = ref('local')
const localList = ref([])
const cloudList = ref([])
const serverList = ref([])
const showServerPicker = ref(false)
const activeServerUrl = ref('')

const currentServerName = ref('默认')

// 库胶囊上的文字：平时是 A0-053-07(17)，这个库有问题卡时变成 A0-053-07(17/9)。
//
// 斜杠后面那个数是「正红 ⊕ 淡红 **去重后**的张数」—— 也就是打开这个库会看到几行红/粉，
// 由后端算好（见 routes/libraries 的 problemCountByLibrary）。一张卡不会算两次：
// 既是识别失败、编号又登记过的，界面上只画正红，那边也只算一次。
//
// 0 就不加那段（不然 30 个库全是 /0，比没有更乱）。
// 云端库那段走的是远端服务器，对面还没更新就没有 problemCount → 当 0 处理，不显示。
//
// libLabel 只用来**显示**（列表里那行字）。
// emit 出去的值走 libValue，保持原来「编号(卡数)」的格式不变：上传页拿到值之后
// 会先用 split('(')[0] 取库编号、随后 fetchCards 回来又用自己算的卡数把顶栏文字重建一遍
// （upload.vue 的 onLocationConfirm 之后的 fetchCards）。要是把带斜杠的串 emit 出去，
// 顶栏会在接口回来前的这一小段里闪一下 (17/9) 再跳回 (17)。
const libLabel = (item) =>
  item.code + '(' + item.cardCount + (item.problemCount > 0 ? '/' + item.problemCount : '') + ')'
const libValue = (item) => item.code + '(' + item.cardCount + ')'

const fetchLibraries = async () => {
  try {
    const [localData, cloudData] = await Promise.all([
      getLocalLibraries(),
      getCloudLibraries()
    ])
    localList.value = localData.list || []
    cloudList.value = cloudData.list || []
  } catch (e) { /* 使用默认数据 */ }
}

const fetchServers = async () => {
  // 默认服务器
  const defaultUrl = uni.getStorageSync('cloudApiUrl') || config.cloudApiBaseUrl
  activeServerUrl.value = defaultUrl
  currentServerName.value = '默认'

  const base = [{ name: '默认服务器', url: defaultUrl }]

  // 从主服务器获取已注册的云端服务器列表
  try {
    const data = await listCloudServers()
    if (data.list && data.list.length > 0) {
      serverList.value = [...base, ...data.list.map(s => ({ name: s.name, url: s.url }))]
    } else {
      serverList.value = base
    }
  } catch (e) { serverList.value = base }

  // 更新当前选中
  const cur = serverList.value.find(s => s.url === activeServerUrl.value)
  if (cur) currentServerName.value = cur.name
}

const open = (focusTab) => {
  fetchLibraries().then(() => {
    // 初始化选中状态：从 upload_state 读取当前库
    try {
      const s = uni.getStorageSync('upload_state')
      if (s) {
        activeTab.value = s.currentLibrary || 'local'
        const curCode = s.currentLocation || ''
        if (activeTab.value === 'local') {
          selLocal.value = localList.value.find(l => l.code === curCode) || null
          selCloud.value = cloudList.value[0] || null
        } else {
          selCloud.value = cloudList.value.find(l => l.code === curCode) || null
          selLocal.value = localList.value[0] || null
        }
      }
    } catch (_) {}
  })
  fetchServers()
  if (focusTab) activeTab.value = focusTab
  visible.value = true
  showServerPicker.value = false
}

const onSwitchServer = () => {
  showServerPicker.value = !showServerPicker.value
}

const onSelectServer = (server) => {
  uni.setStorageSync('cloudApiUrl', server.url)
  activeServerUrl.value = server.url
  currentServerName.value = server.name
  showServerPicker.value = false
  // 重新拉取云端库
  fetchLibraries()
}

const onAddServer = () => {
  uni.showModal({
    title: '添加云端服务器',
    editable: true,
    placeholderText: '输入服务器名称',
    success: (res1) => {
      if (!res1.confirm || !res1.content) return
      const name = res1.content.trim()
      uni.showModal({
        title: '服务器地址',
        editable: true,
        placeholderText: 'https://example.com/v1/api',
        success: async (res2) => {
          if (!res2.confirm || !res2.content) return
          const url = res2.content.trim()
          try {
            await addCloudServer({ name, url })
            uni.showToast({ title: '已添加', icon: 'success' })
            fetchServers()
          } catch (e) { /* handled */ }
        }
      })
    }
  })
}

const onClose = () => {
  visible.value = false
  emit('close')
}

const onLocalTap = (item) => {
  selLocal.value = item
  activeTab.value = 'local'
  emit('confirm', { value: libValue(item), type: 'local' })
}

const onCloudTap = (item) => {
  selCloud.value = item
  activeTab.value = 'cloud'
  emit('confirm', { value: libValue(item), type: 'cloud' })
}

const onScanDev = () => {
  uni.showToast({ title: '扫码功能开发中，敬请期待', icon: 'none', duration: 2000 })
}

const onScan = async (type) => {
  uni.chooseImage({
    count: 1,
    sourceType: ['camera'],
    success: async (res) => {
      const filePath = res.tempFilePaths[0]
      const fileObj = res.tempFiles ? res.tempFiles[0] : null
      if (!filePath) return
      uni.showLoading({ title: '识别中…' })
      const scanCode = (raw) => {
        const m = raw.match(/^([A-Z])(\d)(\d{3})(\d{2})$/)
        return m ? m[1]+m[2]+'-'+m[3]+'-'+m[4] : raw
      }
      // 第一遍：html5-qrcode (QR优先，容错高)
      if (!document.getElementById('scan-tmp')) {
        const d = document.createElement('div'); d.id = 'scan-tmp'; d.style.display = 'none'; document.body.appendChild(d)
      }
      const scanQr = new Html5Qrcode('scan-tmp')
      scanQr.scanFileV2(fileObj || filePath, {}).then(r => {
        scanQr.clear(); uni.hideLoading()
        if (r?.result?.text) { doClaimAndCreate(type, scanCode(r.result.text.trim())); return }
        fallbackQuagga()
      }).catch(() => { scanQr.clear(); fallbackQuagga() })

      const fallbackQuagga = () => {
        Quagga.decodeSingle({ src: filePath, numOfWorkers: 0, decoder: { readers: ['code_128_reader','code_39_reader','ean_reader'] }, locate: true }, (r) => {
          uni.hideLoading()
          if (r?.codeResult?.code) { doClaimAndCreate(type, scanCode(r.codeResult.code.trim())); return }
          uni.showToast({ title: '未识别到条码/QR', icon: 'none' })
        })
      }
    },
    fail: () => {}
  })
}

const doClaimAndCreate = async (type, code) => {
  const token = uni.getStorageSync('token')
  try {
    // 认领 StockCode（同添加逻辑）
    const claimResp = await fetch('/v1/api/admin/stock-codes/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ code, libraryType: type })
    })
    const claimData = await claimResp.json()
    if (!claimResp.ok) {
      uni.showModal({ title: '识别失败', content: claimData.error || '编号不可用', showCancel: false })
      return
    }
    // 创建库
    try {
      await createLibrary({ type, name: code })
    } catch (e) {
      uni.showModal({ title: '提示', content: '库已存在，已自动关联编号', showCancel: false })
    }
    await fetchLibraries()
    uni.showToast({ title: '已调度: ' + code, icon: 'success' })
  } catch (e) {
    uni.showModal({ title: '识别错误', content: '网络错误', showCancel: false })
  }
}

const autoClaim = async (type) => {
  try {
    const token = uni.getStorageSync('token')
    const resp = await fetch('/v1/api/admin/stock-codes/next-available', {
      headers: { 'Authorization': 'Bearer ' + token }
    })
    const data = await resp.json()
    if (!resp.ok) { uni.showModal({ title: '无可用编号', content: data.error || '编号池已空', showCancel: false }); return }
    await doClaimAndCreate(type, data.code)
  } catch (e) { uni.showModal({ title: '取号失败', content: '网络错误', showCancel: false }) }
}

const onAdd = (type) => {
  uni.showModal({
    title: type === 'local' ? '调度本地库' : '调度云端库',
    editable: true,
    placeholderText: '输入编号，如 A0-000-01',
    success: async (res) => {
      if (res.confirm && res.content && res.content.trim()) {
        const code = res.content.trim()
        try {
          // 先尝试认领 StockCode
          const token = uni.getStorageSync('token')
          const claimResp = await fetch('/v1/api/admin/stock-codes/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ code, libraryType: type })
          })
          const claimData = await claimResp.json()
          if (!claimResp.ok) {
            const errMsg = claimResp.error || '调度失败'
            uni.showModal({ title: '调度失败', content: errMsg, showCancel: false })
            return
          }
          // 创建库
          try {
            await createLibrary({ type, name: code })
          } catch (e) {
            uni.showModal({ title: '提示', content: '库已存在，已自动关联编号', showCancel: false })
          }
          await fetchLibraries()
          uni.showToast({ title: '已调度: ' + code, icon: 'success' })
        } catch (e) { uni.showModal({ title: '调度失败', content: '网络错误', showCancel: false }) }
      }
    }
  })
}

const onRename = (item, type) => {
  // ★ editable 弹窗**不能**带 content：H5 上 content 会被当成输入框初值并写回输入值，
  //   用户打的新名字会被冲回 content，确定后 name 落库的还是 content 原文
  //   —— 等于把库名改成了它自己的编号。当前名字改放 title 里给用户看。
  uni.showModal({
    title: `重命名库（当前：${item.name || item.code}）`,
    editable: true,
    placeholderText: '输入新名称',
    success: async (res) => {
      if (res.confirm && res.content && res.content.trim()) {
        try {
          await updateLibrary(item.code, { name: res.content.trim() }, type)
          await fetchLibraries()
          uni.showToast({ title: '已重命名', icon: 'success' })
        } catch (e) { /* handled */ }
      }
    }
  })
}

const onDelete = (item, type) => {
  uni.showModal({
    title: '删除库',
    content: `确定删除「${item.code}」吗？\n库中所有卡牌将一并删除，此操作不可恢复。`,
    success: async (res) => {
      if (res.confirm) {
        try {
          await deleteLibrary(item.code, type)
          await fetchLibraries()
          if (type === 'local' && selLocal.value?.code === item.code) selLocal.value = null
          if (type === 'cloud' && selCloud.value?.code === item.code) selCloud.value = null
          uni.showToast({ title: '已删除', icon: 'success' })
        } catch (e) { /* handled */ }
      }
    }
  })
}

defineExpose({ open, onClose, visible, fetchLibraries })
</script>

<style scoped>
.modal-mask {
  position: fixed;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  z-index: 200;
  overflow: hidden;
}

.popup {
  position: fixed;
  left: 0;
  width: 100%;
  z-index: 202;
  background-color: #FFFFFF;
  border-radius: 0 0 16px 16px;
  padding: 16px;
  box-sizing: border-box;
  overflow-y: auto;
}

.section-label {
  font-size: 16px;
  font-weight: 600;
  color: #333333;
  padding: 0 0 6px 0;
  display: block;
}

.lib-grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 14px;
}

.lib-item {
  background-color: #F5F5F7;
  border-radius: 50px;
  padding: 4px 6px 4px 14px;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
}

/* 「这个库里有问题卡」—— 跟斜杠后面那个数同一个条件（problemCount > 0），
   数字为 0 的库不上色，所以不上色的就是干净的库。

   注意声明顺序：本类必须写在 .lib-active 之前。三个类都是单类选择器、specificity 相同，
   打平时靠**后面的**胜出。一个库既在当前选中、又有问题卡时两个类会同时命中，
   得让正红（当前选中）压过淡红（有问题）。
   跟 .lib-dim 同色，所以两者撞上也无所谓 —— 反正画出来一样。 */
.lib-problem {
  background-color: #FFE0E0;
}
.lib-dim {
  background-color: #FFE0E0;
}
.lib-active {
  background-color: #FF0000;
}

.lib-text {
  font-size: 13px;
  color: #1A1A1A;
}
.lib-text-active {
  color: #FFFFFF;
}
.lib-text-dim {
  color: #1A1A1A;
}

.lib-actions {
  display: flex;
  flex-direction: row;
  gap: 2px;
}
.icon-btn {
  width: 22px;
  height: 22px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.edit-btn {
  background-color: rgba(0,0,0,0.08);
}
.del-btn {
  background-color: rgba(255,0,0,0.12);
}
.icon-char {
  font-size: 11px;
  color: #666666;
}
.icon-del {
  color: #FF0000;
}
.del-x-char { font-size:15px; font-weight:700; color:#FF0000; }
.lib-active .del-x-char { color:#FFFFFF; }

.lib-add {
  background-color: transparent;
  border: 1px dashed #CCCCCC;
  padding: 4px 14px;
}
.lib-add-text {
  font-size: 13px;
  color: #999999;
}
.lib-scan-dev {
  background: rgba(255,100,100,0.12) !important;
  border-color: rgba(255,100,100,0.3) !important;
}

/* ========== 云端服务器切换 ========== */
.section-header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 0 0 6px 0;
}
.cloud-server-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: #F0F0F0;
  border-radius: 12px;
  padding: 3px 10px;
  gap: 2px;
}
.server-label {
  font-size: 11px;
  color: #666666;
}
.server-arrow {
  font-size: 14px;
  color: #999999;
  font-weight: 600;
}

/* ========== 服务器选择面板 ========== */
.server-picker {
  border-top: 1px solid #F0F0F0;
  padding-top: 12px;
  margin-top: 8px;
}
.server-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background-color: #F5F5F7;
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 6px;
}
.server-active {
  background-color: #FFF0F0;
  border: 1px solid #FF0000;
}
.server-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.server-name {
  font-size: 14px;
  color: #1A1A1A;
  font-weight: 500;
}
.server-url {
  font-size: 11px;
  color: #999999;
}
.server-check {
  font-size: 16px;
  color: #FF0000;
  font-weight: 600;
}
.server-add {
  background-color: transparent;
  border: 1px dashed #CCCCCC;
  justify-content: center;
}
.server-add-text {
  font-size: 13px;
  color: #999999;
}

</style>
