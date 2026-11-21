<template>
  <view class="page-container">
    <!-- 第1行：工具栏（返回键 + 标题「设备连接」 + 报警灯） -->
    <view class="toolbar-panel">
      <view class="toolbar">
        <view class="toolbar-left">
          <view class="tool-btn" @tap="goBack">
            <image class="icon-back" src="/static/icons/ic_back.png" mode="aspectFit"></image>
          </view>
        </view>
        <view class="toolbar-center">
          <text class="tool-title">设备连接</text>
        </view>
        <view class="toolbar-right">
          <!-- 点亮屏幕按钮：屏幕黑屏时人工点一下，代替手点手机屏幕（同对焦，先唤醒再点击） -->
          <view class="tap-btn" @tap="onTapScreen"><text class="tap-btn-text">点击</text></view>
          <!-- 设备状态指示：彩圈 + 状态文字（点击发蜂鸣器，双向报警） -->
          <view class="alarm-indicator" @tap="onAlarmTap">
            <view class="alarm-dot" :class="alarmColorClass"></view>
            <text class="alarm-text">{{ lightState }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 第3行：库号输入 + 设备号输入 + 测试键 + 设置键 -->
    <view class="connect-bar">
      <input class="lib-input" v-model="libCode" placeholder="A0-000-01" placeholder-class="lib-input-ph" @confirm="onInputLib" @focus="libCodeFocused = true" @blur="onLibBlur" />
      <input class="device-input" v-model="deviceCode" placeholder="0001" placeholder-class="lib-input-ph" @confirm="onInputLib" @focus="deviceCodeFocused = true" @blur="onDeviceBlur" />
      <view class="bar-btn" @tap="onTest"><image class="bar-icon" src="/static/icons/ic_search.png" mode="aspectFit"></image><text class="bar-btn-text">测试</text></view>
      <view class="bar-btn" @tap="onSettings"><image class="bar-icon" src="/static/icons/ic_settings.png" mode="aspectFit"></image><text class="bar-btn-text">设置</text></view>
    </view>

    <!-- 第4行：保存路径（点击打开设置弹窗） -->
    <view class="folder-bar">
      <text class="folder-path-label">保存路径</text>
      <text class="folder-path-text" :class="{ 'folder-path-empty': !folderPath }" @tap="onSettings">{{ folderPath || '点击设置保存路径' }}</text>
    </view>

    <!-- 手机屏幕预览块 + 历史图片行 -->
    <view class="body">
      <view class="screen-block">
        <!-- 画面放大铺满整个黑框（aspectFill），上下用黑罩按百分比盖掉 → 中间放大显示 -->
        <image v-if="frameUrl && !frameError" class="screen-img" :src="frameUrl" mode="aspectFill" @error="frameError = true"></image>
        <text v-else class="screen-placeholder">暂无画面\n请连接手机</text>
        <!-- 上下裁剪遮罩：黑色盖住边框，只留中间画面 -->
        <view v-if="frameUrl && !frameError" class="crop-mask crop-mask-top" :style="cropTopStyle"></view>
        <view v-if="frameUrl && !frameError" class="crop-mask crop-mask-bottom" :style="cropBottomStyle"></view>
        <!-- 串口日志半透明叠加（设置开关） -->
        <view v-if="showLog && statusLog.length" class="log-overlay">
          <text class="log-line" v-for="(l, i) in statusLog" :key="i">{{ l }}</text>
        </view>
      </view>
      <scroll-view class="history-scroll" scroll-x="true" :show-scrollbar="false">
        <view class="history-row">
          <view class="history-item" v-for="h in historyList" :key="h" @tap="onPreviewHistory(h)">
            <view class="history-thumb">
              <image v-if="h" class="history-img" :src="getDevicePhotoUrl(h)" mode="aspectFill"></image>
            </view>
            <text class="history-label">{{ thumbLabel(h) }}</text>
          </view>
        </view>
      </scroll-view>
    </view>

    <!-- 历史图片放大预览 -->
    <view v-if="previewVisible" class="preview-overlay" @tap="previewVisible = false">
      <view class="preview-box" @tap.stop>
        <image v-if="previewItem" class="preview-img" :src="getDevicePhotoUrl(previewItem)" mode="aspectFit"></image>
      </view>
    </view>

    <!-- 启动 + 是否自动 -->
    <view class="action-bar">
      <view class="start-btn" :class="{ 'start-btn-running': autoRunning, 'start-btn-disabled': starting }" @tap="onStart">
        <text class="start-btn-text">{{ starting ? '启动中…' : autoRunning ? '停止' : '启动' }}</text>
      </view>
      <view class="auto-toggle">
        <text class="auto-label">是否自动</text>
        <view class="switch-track" :class="{ on: autoMode }" @tap="autoMode = !autoMode">
          <view class="switch-thumb"></view>
        </view>
      </view>
    </view>

    <!-- 设置弹窗 -->
    <view v-if="settingsVisible" class="modal-overlay" @tap="settingsVisible = false">
      <view class="modal-box" @tap.stop>
        <text class="modal-title">设备设置</text>
        <scroll-view class="modal-scroll" scroll-y="true" :show-scrollbar="false">
          <view class="cfg-row">
            <text class="cfg-label">保存路径</text>
            <input class="cfg-input" v-model="cfg.SAVE_DIR" placeholder="如 D:/TCG/photos" />
          </view>
          <!-- 目录检测：扫描保存路径下所有库 -->
          <view class="cfg-row">
            <text class="cfg-label">检测目录</text>
            <view class="inspect-btn" :class="{ busy: inspectLoading }" @tap="onInspect">
              <text>{{ inspectLoading ? '检测中…' : (inspectList.length ? '重新检测' : '开始检测') }}</text>
            </view>
          </view>
          <view v-if="inspectVisible" class="inspect-wrap">
            <text class="inspect-dir">{{ inspectDir || '—' }}（共 {{ inspectList.length }} 个库）</text>
            <scroll-view v-if="inspectList.length" class="inspect-list" scroll-y="true" :show-scrollbar="false">
              <view class="inspect-item" v-for="lib in inspectList" :key="lib.libCode">
                <image v-if="lib.sample" class="inspect-thumb" :src="inspectSampleUrl(lib)" mode="aspectFill"></image>
                <view class="inspect-info">
                  <text class="inspect-libcode">{{ lib.libCode }}</text>
                  <text class="inspect-sub">{{ lib.count }} 张 · {{ lib.sizeMB }} MB · 序号 {{ lib.minSeq }}~{{ lib.maxSeq }}</text>
                </view>
              </view>
            </scroll-view>
            <text v-else-if="!inspectLoading" class="inspect-empty">{{ inspectError || '目录下暂无库或照片' }}</text>
          </view>
          <view class="cfg-row">
            <text class="cfg-label">阈值（贴标签）</text>
            <input class="cfg-input" v-model="cfg.THRESHOLD" type="number" placeholder="0030" />
          </view>
          <view class="cfg-row">
            <text class="cfg-label">COM 端口</text>
            <input class="cfg-input" v-model="cfg.COM_PORT" placeholder="AUTO 或 COM3" />
          </view>
          <view class="cfg-row">
            <text class="cfg-label">波特率</text>
            <input class="cfg-input" v-model="cfg.BAUD" type="number" placeholder="9600" />
          </view>
          <view class="cfg-row">
            <text class="cfg-label">画面刷新(秒)</text>
            <input class="cfg-input" v-model="cfg.FRAME_INTERVAL" type="number" step="0.1" placeholder="0.3" />
          </view>
          <view class="cfg-row">
            <text class="cfg-label">拍照延迟(秒)</text>
            <input class="cfg-input" v-model="cfg.AUTO_CAPTURE_DELAY" type="number" step="0.1" placeholder="1.0" />
          </view>
          <view class="cfg-row">
            <text class="cfg-label">拍照前对焦</text>
            <view class="switch-track" :class="{ on: cfg.FOCUS_TAP }" @tap="cfg.FOCUS_TAP = !cfg.FOCUS_TAP">
              <view class="switch-thumb"></view>
            </view>
          </view>
          <view class="cfg-row">
            <text class="cfg-label">对焦位置</text>
            <view class="cfg-pair">
              <input class="cfg-input-sm" v-model="cfg.FOCUS_TAP_X" type="number" placeholder="50" />
              <input class="cfg-input-sm" v-model="cfg.FOCUS_TAP_Y" type="number" placeholder="50" />
            </view>
          </view>
          <view class="cfg-row">
            <text class="cfg-label">拍照方式</text>
            <picker :range="captureModes" :value="cfgModeIndex" @change="onModeChange">
              <view class="cfg-picker">{{ captureModes[cfgModeIndex] }}</view>
            </picker>
          </view>
          <view class="cfg-row">
            <text class="cfg-label">快门方式</text>
            <picker :range="shutterModes" :value="cfgShutterIndex" @change="onShutterChange">
              <view class="cfg-picker">{{ shutterModes[cfgShutterIndex] }}</view>
            </picker>
          </view>
          <view class="cfg-row">
            <text class="cfg-label">快门位置</text>
            <view class="cfg-pair">
              <input class="cfg-input-sm" v-model="cfg.SHUTTER_TAP_X" type="number" placeholder="50" />
              <input class="cfg-input-sm" v-model="cfg.SHUTTER_TAP_Y" type="number" placeholder="86" />
            </view>
          </view>
          <view class="cfg-row">
            <text class="cfg-label">上边框裁剪%</text>
            <input class="cfg-input" v-model="cfg.FRAME_CROP_TOP" type="number" placeholder="0" />
          </view>
          <view class="cfg-row">
            <text class="cfg-label">下边框裁剪%</text>
            <input class="cfg-input" v-model="cfg.FRAME_CROP_BOTTOM" type="number" placeholder="0" />
          </view>
          <view class="cfg-row">
            <text class="cfg-label">拉取后删手机原图</text>
            <view class="switch-track" :class="{ on: cfg.DELETE_REMOTE_AFTER_PULL }" @tap="cfg.DELETE_REMOTE_AFTER_PULL = !cfg.DELETE_REMOTE_AFTER_PULL">
              <view class="switch-thumb"></view>
            </view>
          </view>
          <view class="cfg-row">
            <text class="cfg-label">串口日志显示</text>
            <view class="switch-track" :class="{ on: showLog }" @tap="showLog = !showLog">
              <view class="switch-thumb"></view>
            </view>
          </view>
        </scroll-view>
        <view class="modal-actions">
          <view class="modal-btn modal-btn-cancel" @tap="settingsVisible = false"><text>取消</text></view>
          <view class="modal-btn modal-btn-ok" @tap="onSaveSettings"><text>保存</text></view>
        </view>
      </view>
    </view>

    <!-- 贴标签提醒弹窗 -->
    <view v-if="labelVisible" class="modal-overlay">
      <view class="modal-box label-box">
        <text class="modal-title">贴标签提醒</text>
        <text class="label-desc">本批次 {{ lastLibCode }} 已拍 {{ lastCount }} 张\n请为这批卡贴上标签，确认后自动切换到下一批次</text>
        <view class="modal-actions">
          <view class="modal-btn modal-btn-ok" @tap="onLabelConfirm"><text>确认贴好</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { onShow, onHide } from '@dcloudio/uni-app'
import {
  getDeviceStatus, getDevicePhotos, getDevicePhotoUrl, getDeviceFrameUrl,
  deviceScan, deviceCapture, deviceFocus, getDeviceConfig, saveDeviceConfig,
  setDeviceSerial, deviceLabelConfirm, deviceAutoStart, deviceAutoStop, deviceBeep,
  getDeviceInspect,
} from '@/api/index.js'

const libCode = ref('')
const deviceCode = ref('0001')
// 是否自动（开合关）
const autoMode = ref(false)
// 编号/阈值/路径（从 Python config 同步）
const cfg = ref({})
const folderPath = ref('')
const threshold = ref(30)
// 状态轮询
const statusLog = ref([])
const autoRunning = ref(false)
// 启动防误点：手动推卡后置"启动中"，直到这一张保存成功（serialNo 变化）或超时才解除
const starting = ref(false)
let lastSerialNo = null
let startWaitAt = 0
const lastLibCode = ref('')
const lastCount = ref(0)
// 串口日志开关（持久化）
const showLog = ref(true)
try {
  showLog.value = uni.getStorageSync('device_connect_showlog') !== '0'
  autoMode.value = uni.getStorageSync('device_connect_auto') === '1'
} catch (_) {}
// 历史图片
const historyList = ref([])
// 屏幕画面
const frameUrl = ref('')
const frameError = ref(false)
// 放大预览
const previewVisible = ref(false)
const previewItem = ref('')
// 设置弹窗
const settingsVisible = ref(false)
// 贴标签弹窗
const labelVisible = ref(false)

const captureModes = ['camera', 'screencap']
const shutterModes = ['tap', 'keyevent']
const cfgModeIndex = computed(() => Math.max(0, captureModes.indexOf(cfg.value.CAPTURE_MODE)))
const cfgShutterIndex = computed(() => Math.max(0, shutterModes.indexOf(cfg.value.SHUTTER_METHOD)))
// 画面裁剪：黑色遮罩盖住上下边框，只留中间画面（不放大）
const cropTopStyle = computed(() => ({ height: Math.min(parseFloat(cfg.value.FRAME_CROP_TOP) || 0, 45) + '%' }))
const cropBottomStyle = computed(() => ({ height: Math.min(parseFloat(cfg.value.FRAME_CROP_BOTTOM) || 0, 45) + '%' }))
const onModeChange = (e) => { cfg.value.CAPTURE_MODE = captureModes[Number(e.detail.value)] }
const onShutterChange = (e) => { cfg.value.SHUTTER_METHOD = shutterModes[Number(e.detail.value)] }

// ── 生命周期：进页轮询，离页停止 ──────────────────────────────
let statusTimer = null
let frameTimer = null
let photoTimer = null

const startPolling = () => {
  stopPolling()
  refreshStatus()
  refreshPhotos()
  refreshFrame()
  statusTimer = setInterval(refreshStatus, 1000)
  photoTimer = setInterval(refreshPhotos, 2000)
  frameTimer = setInterval(refreshFrame, 500)
}
const stopPolling = () => {
  if (statusTimer) clearInterval(statusTimer)
  if (frameTimer) clearInterval(frameTimer)
  if (photoTimer) clearInterval(photoTimer)
  statusTimer = frameTimer = photoTimer = null
}
onShow(() => startPolling())
onHide(() => stopPolling())

const goBack = () => {
  stopPolling()
  uni.reLaunch({ url: '/pages/index/index' })
}

// 同步当前输入的库号/设备号到 Python（启动/测试/保存设置时调用）
const syncSerial = async () => {
  const serial = parseInt(deviceCode.value, 10) || 1
  await setDeviceSerial({
    libCode: libCode.value.trim() || 'A0-000-01',
    serial,
    threshold: parseInt(cfg.value.THRESHOLD, 10) || parseInt(threshold.value, 10) || 30,
    saveDir: cfg.value.SAVE_DIR || folderPath.value || '',
  })
}

// 库号输入框聚焦状态：聚焦中不自动覆盖（避免打断手动改库号）
const libCodeFocused = ref(false)
// 设备号输入框聚焦状态：聚焦中不自动覆盖（避免打断手动改起始号）
const deviceCodeFocused = ref(false)
const onDeviceBlur = () => {
  deviceCodeFocused.value = false
  syncSerial()   // 手动改的起始号立即同步 Python，避免下次轮询把显示覆盖回去
}

const lightState = ref('待命')
// 状态 → 彩圈颜色类；未知状态兜底灰色（文字照常显示，不会空白）
const alarmColorClass = computed(() => {
  const map = { 报警: 'dot-red', 遮挡: 'dot-red', 等待卡: 'dot-yellow', 待命: 'dot-green', 已停止: 'dot-gray' }
  return map[lightState.value] || 'dot-gray'
})

const refreshStatus = async () => {
  try {
    const s = await getDeviceStatus()
    if (s.log) statusLog.value = s.log.slice(-6)
    autoRunning.value = !!s.autoRunning
    // 运行中（手动推卡 / 自动运转）→ 黄灯；图片保存成功或停止后才恢复状态色
    // 贴标签（needsLabel）优先级最高 → 红灯，直到点确认
    if (s.needsLabel) {
      lightState.value = '报警'
    } else if (starting.value || autoRunning.value) {
      lightState.value = '等待卡'
    } else if (s.status) {
      lightState.value = s.status
    }
    // 编号/路径同步显示
    if (s.saveDir) folderPath.value = s.saveDir
    if (s.threshold) cfg.value.THRESHOLD = s.threshold
    // 库号跟随：贴标签换批次后自动更新到新库号；聚焦输入中不覆盖（避免打断手动改号）
    if (s.libCode && !libCodeFocused.value) libCode.value = s.libCode
    // 序号实时回显到设备号输入框：拍照+1 后自动更新（0001→0002→…）；聚焦输入中不覆盖
    if (typeof s.serialNo === 'number') {
      // 手动"启动中"：serialNo 变化（=这一张已保存）→ 解除；超时 15 秒兜底
      if (starting.value) {
        if (lastSerialNo !== null && s.serialNo !== lastSerialNo) {
          starting.value = false
          uni.showToast({ title: '已保存 ' + String(s.serialNo - 1).padStart(4, '0'), icon: 'none' })
        } else if (Date.now() - startWaitAt > 15000) {
          starting.value = false
          uni.showToast({ title: '超时未保存，请检查手机拍照', icon: 'none' })
        }
      }
      lastSerialNo = s.serialNo
      if (!deviceCodeFocused.value) deviceCode.value = String(s.serialNo).padStart(4, '0')
    }
    // 贴标签弹窗
    if (s.needsLabel) {
      lastLibCode.value = s.libCode || ''
      lastCount.value = s.serialNo - 1
      if (!labelVisible.value) labelVisible.value = true
    }
  } catch (_) {}
}

const refreshPhotos = async () => {
  try {
    const d = await getDevicePhotos()
    // 跟随顶部库号过滤：只显示当前库号子文件夹里的图片（选哪个库看哪个）
    // 路径是 库号/图片名，但 Python os.path.join 在 Windows 上会返回反斜杠 → 统一换正斜杠再匹配
    const code = (libCode.value || '').trim()
    let list = (d.photos || []).map((p) => p.replace(/\\/g, '/'))
    if (code) list = list.filter((p) => p.startsWith(code + '/'))
    historyList.value = list.slice(0, 7)
  } catch (_) {}
}

const refreshFrame = () => {
  frameError.value = false
  frameUrl.value = getDeviceFrameUrl(Date.now())
}

// ── 点亮屏幕（人工点击） ───────────────────────────────────────
const onTapScreen = async () => {
  try {
    const r = await deviceFocus()
    uni.showToast({ title: r.ok ? '已点击屏幕（唤醒）' : '点击失败（手机未连接）', icon: 'none' })
  } catch (_) { uni.showToast({ title: '点击失败', icon: 'none' }) }
}

// ── 报警灯 ─────────────────────────────────────────────────────
const onAlarmTap = async () => {
  // 双向报警：前端 → 设备（蜂鸣器响）
  try {
    const r = await deviceBeep()
    uni.showToast({ title: r.ok ? '已向设备发送报警' : '发送失败（串口未连接）', icon: 'none' })
  } catch (_) { uni.showToast({ title: '发送失败', icon: 'none' }) }
}

// ── 按钮 ───────────────────────────────────────────────────────
const onInputLib = () => {
  libCodeFocused.value = false   // 回车=改号结束，之后允许跟随后端新库号
  if (!libCode.value.trim()) {
    uni.showToast({ title: '请输入库号', icon: 'none' })
    return
  }
  uni.showToast({ title: '已设置编号 ' + libCode.value.trim() + '-' + deviceCode.value, icon: 'none' })
  syncSerial()      // 库号变了 → 同步给 Python（含库号+设备号）
  refreshPhotos()   // 库号变了 → 图片栏立即跟随过滤
}

// 库号输入框失焦：重置聚焦状态（之后允许跟随后端新库号），并把改的库号同步 Python
const onLibBlur = () => {
  libCodeFocused.value = false
  syncSerial()
  refreshPhotos()
}

const onTest = async () => {
  try {
    // 测试只查状态，不 syncSerial（避免用输入框旧值覆盖 Python 序号）
    const s = await getDeviceStatus()
    uni.showToast({
      title: '串口:' + (s.serial || '未知') + ' 手机:' + (s.adb || '未知'),
      icon: 'none', duration: 2500,
    })
  } catch (_) {}
}

const onStart = async () => {
  if (autoRunning.value) {
    try { await deviceAutoStop() } catch (_) {}
    autoRunning.value = false
    uni.showToast({ title: '已停止', icon: 'none' })
    return
  }
  if (starting.value) return   // 正在启动中，防误点二次启动
  try {
    // 注意：启动时不再 syncSerial（避免用输入框旧值覆盖 Python 正在累加的序号）
    // 改起始号只在你手动编辑设备号并失焦时同步（onDeviceBlur → syncSerial）
    if (autoMode.value) {
      starting.value = true
      const r = await deviceAutoStart()
      starting.value = false
      if (r.ok) {
        autoRunning.value = true
        uni.showToast({ title: '自动运转中，至阈值停止', icon: 'none' })
      } else {
        uni.showToast({ title: '启动失败（串口未连接）', icon: 'none' })
      }
    } else {
      // 手动推卡：置"启动中"直到这一张保存成功（serialNo 变化）或超时
      starting.value = true
      startWaitAt = Date.now()
      const r = await deviceScan()
      if (!r.ok) {
        starting.value = false
        uni.showToast({ title: '启动失败（串口未连接）', icon: 'none' })
      } else {
        uni.showToast({ title: '已推卡，卡通过后自动拍照', icon: 'none' })
      }
    }
  } catch (_) { starting.value = false }
}

// 是否自动开关状态持久化
watch(autoMode, (v) => {
  try { uni.setStorageSync('device_connect_auto', v ? '1' : '0') } catch (_) {}
})
watch(showLog, (v) => {
  try { uni.setStorageSync('device_connect_showlog', v ? '1' : '0') } catch (_) {}
})

// ── 设置弹窗 ───────────────────────────────────────────────────
const onSettings = async () => {
  settingsVisible.value = true
  try {
    const c = await getDeviceConfig()
    cfg.value = { ...c }
    normalizeBoolFields()          // 把历史字符串布尔转成真布尔，开关才能关掉
    if (c.SAVE_DIR) folderPath.value = c.SAVE_DIR
  } catch (_) {}
}

// 布尔字段：兼容后端历史存的字符串 "True"/"False"（统一转成布尔，保证开关可关）
const normalizeBoolFields = () => {
  const bools = ['FOCUS_TAP', 'DELETE_REMOTE_AFTER_PULL', 'AUTO_MODE']
  for (const k of bools) {
    const v = cfg.value[k]
    if (typeof v === 'string') cfg.value[k] = v === 'true' || v === 'True' || v === '1'
  }
}

const onSaveSettings = async () => {
  try {
    // 控制台参数
    await saveDeviceConfig({
      COM_PORT: cfg.value.COM_PORT,
      BAUD: parseInt(cfg.value.BAUD, 10) || 9600,
      FRAME_INTERVAL: parseFloat(cfg.value.FRAME_INTERVAL) || 0.3,
      AUTO_CAPTURE_DELAY: parseFloat(cfg.value.AUTO_CAPTURE_DELAY) || 1.0,
      FOCUS_TAP: !!cfg.value.FOCUS_TAP,
      FOCUS_TAP_X: parseInt(cfg.value.FOCUS_TAP_X, 10) || 50,
      FOCUS_TAP_Y: parseInt(cfg.value.FOCUS_TAP_Y, 10) || 50,
      CAPTURE_MODE: cfg.value.CAPTURE_MODE || 'camera',
      SHUTTER_METHOD: cfg.value.SHUTTER_METHOD || 'tap',
      SHUTTER_TAP_X: parseInt(cfg.value.SHUTTER_TAP_X, 10) || 50,
      SHUTTER_TAP_Y: parseInt(cfg.value.SHUTTER_TAP_Y, 10) || 86,
      FRAME_CROP_TOP: parseFloat(cfg.value.FRAME_CROP_TOP) || 0,
      FRAME_CROP_BOTTOM: parseFloat(cfg.value.FRAME_CROP_BOTTOM) || 0,
      DELETE_REMOTE_AFTER_PULL: !!cfg.value.DELETE_REMOTE_AFTER_PULL,
    })
    // 编号/路径/阈值
    await setDeviceSerial({
      libCode: libCode.value.trim() || cfg.value.LIB_CODE || 'A0-000-01',
      serial: parseInt(deviceCode.value, 10) || 1,
      threshold: parseInt(cfg.value.THRESHOLD, 10) || 30,
      saveDir: cfg.value.SAVE_DIR || '',
    })
    if (cfg.value.SAVE_DIR) folderPath.value = cfg.value.SAVE_DIR
    settingsVisible.value = false
    uni.showToast({ title: '已保存', icon: 'success' })
  } catch (_) {}
}

// ── 目录检测 ───────────────────────────────────────────────────
// 扫描保存路径下所有库：每库多少张、图片大小、序号区间
const inspectVisible = ref(false)
const inspectLoading = ref(false)
const inspectList = ref([])
const inspectDir = ref('')
const inspectError = ref('')

const onInspect = async () => {
  inspectVisible.value = true
  inspectLoading.value = true
  inspectError.value = ''
  try {
    const r = await getDeviceInspect()
    inspectDir.value = r.saveDir || ''
    inspectList.value = (r.libs || []).map((l) => ({ ...l }))
  } catch (_) {
    inspectError.value = '检测失败：拍照控制台(:5000)不可达'
    inspectList.value = []
  } finally {
    inspectLoading.value = false
  }
}

// 样例图 URL：库号/图片名（photo 路由免鉴权，<img> 可直接加载）
const inspectSampleUrl = (lib) =>
  lib.sample ? getDevicePhotoUrl(lib.libCode + '/' + lib.sample) : ''

// ── 贴标签确认 ─────────────────────────────────────────────────
const onLabelConfirm = async () => {
  labelVisible.value = false
  try {
    const r = await deviceLabelConfirm()
    // 新库号立即回显到顶部库号框（不用等轮询）
    if (r.libCode) libCode.value = r.libCode
    uni.showToast({ title: '新批次 ' + r.libCode + '-' + String(r.serialNo).padStart(4, '0'), icon: 'none' })
    refreshStatus()
  } catch (_) {}
}

// ── 历史图预览 ─────────────────────────────────────────────────
const onPreviewHistory = (name) => {
  previewItem.value = name
  previewVisible.value = true
}

// 缩略图下编号文字：相对路径 A0-001-03/A0-001-03-0014.jpg → A0-001-03-0014
const thumbLabel = (h) => {
  const file = String(h || '').split('/').pop()
  return file.replace(/\.\w+$/, '')
}
</script>

<style scoped>
/* ========== 页面容器 ========== */
.page-container {
  background-color: #F5F5F7;
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
}

/* ========== 第1行：工具栏 ========== */
.toolbar-panel {
  background-color: #FFFFFF;
  padding: 12px 16px 10px 16px;
  flex-shrink: 0;
}

.toolbar {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  position: relative;
}

.toolbar-left {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.toolbar-center {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: row;
  align-items: center;
}

.toolbar-right {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.tool-title {
  font-size: 15px;
  font-weight: 500;
  color: #1A1A1A;
}

.tool-btn {
  width: 32px;
  height: 32px;
  border-radius: 16px;
  background-color: #F0F0F0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-back {
  width: 18px;
  height: 18px;
}

/* 点亮屏幕按钮：点击一次手机屏幕（黑屏时人工唤醒） */
.tap-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 10px;
  background-color: #F0F0F0;
  border-radius: 13px;
  margin-right: 6px;
  flex-shrink: 0;
}

.tap-btn-text {
  font-size: 12px;
  color: #1A1A1A;
}

/* 设备状态指示：彩圈 + 文字（点击发蜂鸣器，双向报警） */
.alarm-indicator {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  background-color: #F0F0F0;
  border-radius: 13px;
}

.alarm-dot {
  width: 10px;
  height: 10px;
  border-radius: 5px;
  background-color: #C8C8C8;
  flex-shrink: 0;
}

.alarm-dot.dot-red { background-color: #FF3B30; box-shadow: 0 0 6px #FF3B30; }
.alarm-dot.dot-yellow { background-color: #FFCC00; box-shadow: 0 0 6px #FFCC00; }
.alarm-dot.dot-green { background-color: #34C759; box-shadow: 0 0 6px #34C759; }
.alarm-dot.dot-gray { background-color: #C8C8C8; }

.alarm-text {
  font-size: 12px;
  color: #1A1A1A;
}

/* ========== 第3行：库号输入条 ========== */
.connect-bar {
  background-color: #FFFFFF;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  flex-shrink: 0;
}

.lib-input {
  flex: 1;
  height: 36px;
  background-color: #F5F5F7;
  border-radius: 8px;
  padding: 0 12px;
  font-size: 14px;
  color: #1A1A1A;
}

.device-input {
  width: 72px;
  height: 36px;
  background-color: #F5F5F7;
  border-radius: 8px;
  padding: 0 12px;
  font-size: 14px;
  color: #1A1A1A;
  text-align: center;
  flex-shrink: 0;
}

.lib-input-ph {
  color: #C0C0C0;
  font-size: 14px;
}

.bar-btn {
  height: 36px;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 3px;
  background-color: #F0F0F0;
  border-radius: 8px;
  padding: 0 14px;
  flex-shrink: 0;
}

.bar-btn-text {
  font-size: 13px;
  color: #1A1A1A;
}

.bar-icon {
  width: 14px;
  height: 14px;
}

/* ========== 第4行：保存路径 ========== */
.folder-bar {
  background-color: #FFFFFF;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  flex-shrink: 0;
  margin-top: 1px;
}

.folder-path-label {
  font-size: 12px;
  color: #999999;
  flex-shrink: 0;
}

.folder-path-text {
  flex: 1;
  font-size: 13px;
  color: #1A1A1A;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-path-empty {
  color: #C0C0C0;
}

/* ========== 手机屏幕预览块 + 历史图片行 ========== */
.body {
  flex: 1;
  min-height: 0;
  padding: 12px 16px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.screen-block {
  flex: 1;
  min-height: 0;
  width: 100%;
  background-color: #1A1A1A;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

/* 上下裁剪遮罩：黑色盖住边框 → 中间画面放大填满黑框（aspectFill 铺满） */
.crop-mask {
  position: absolute;
  left: 0;
  right: 0;
  background-color: #1A1A1A;
}

.crop-mask-top {
  top: 0;
}

.crop-mask-bottom {
  bottom: 0;
}

.screen-img {
  width: 100%;
  height: 100%;
}

.screen-placeholder {
  font-size: 14px;
  color: #8A8A8A;
  text-align: center;
  white-space: pre-line;
  line-height: 1.8;
}

/* 串口日志半透明叠加 */
.log-overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.55);
  padding: 6px 10px;
  max-height: 40%;
  overflow: hidden;
  border-radius: 0 0 10px 10px;
}

.log-line {
  display: block;
  font-size: 11px;
  color: #9FE8A0;
  line-height: 1.6;
  font-family: Consolas, monospace;
}

/* 历史图片横向滑动行 */
.history-scroll {
  flex-shrink: 0;
  width: 100%;
  white-space: nowrap;
}

.history-row {
  display: flex;
  flex-direction: row;
  gap: 8px;
}

/* 每个缩略图：图片在上 + 编号文字在下 */
.history-item {
  width: 68px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.history-thumb {
  width: 64px;
  height: 64px;
  background-color: #1A1A1A;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.history-img {
  width: 100%;
  height: 100%;
}

.history-label {
  width: 100%;
  font-size: 9px;
  color: #666666;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 历史图片放大预览弹窗 */
.preview-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.75);
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-box {
  width: 90%;
  height: 75%;
  background-color: #1A1A1A;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.preview-img {
  width: 100%;
  height: 100%;
}

/* ========== 启动 + 是否自动 ========== */
.action-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background-color: #FFFFFF;
  flex-shrink: 0;
}

.start-btn {
  flex: 1;
  height: 42px;
  border-radius: 10px;
  background-color: #FF0000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.start-btn-running {
  background-color: #8A8A8A;
}

.start-btn-disabled {
  background-color: #B0B0B0;
  opacity: 0.75;
}

.start-btn-text {
  font-size: 15px;
  font-weight: 500;
  color: #FFFFFF;
}

.auto-toggle {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.auto-label {
  font-size: 13px;
  color: #1A1A1A;
}

/* 开关 */
.switch-track {
  width: 40px;
  height: 22px;
  border-radius: 11px;
  background-color: #D8D8D8;
  padding: 3px;
  box-sizing: border-box;
  transition: background-color 0.2s;
}

.switch-track.on {
  background-color: #FF0000;
}

.switch-thumb {
  width: 16px;
  height: 16px;
  border-radius: 8px;
  background-color: #FFFFFF;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s;
}

.switch-track.on .switch-thumb {
  transform: translateX(18px);
}

/* ========== 设置弹窗 ========== */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-box {
  width: 86%;
  max-height: 78%;
  background-color: #FFFFFF;
  border-radius: 16px;
  padding: 18px 16px 12px 16px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.modal-title {
  font-size: 16px;
  font-weight: 500;
  color: #1A1A1A;
  text-align: center;
  margin-bottom: 12px;
}

.modal-scroll {
  flex: 1;
  min-height: 0;
  max-height: 55vh;
}

.cfg-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-bottom: 10px;
}

.cfg-label {
  width: 110px;
  font-size: 13px;
  color: #333333;
  flex-shrink: 0;
}

.cfg-input {
  flex: 1;
  height: 32px;
  background-color: #F5F5F7;
  border-radius: 8px;
  padding: 0 10px;
  font-size: 13px;
  color: #1A1A1A;
}

.cfg-pair {
  flex: 1;
  display: flex;
  flex-direction: row;
  gap: 8px;
}

.cfg-input-sm {
  flex: 1;
  height: 32px;
  background-color: #F5F5F7;
  border-radius: 8px;
  padding: 0 10px;
  font-size: 13px;
  color: #1A1A1A;
  text-align: center;
}

.cfg-picker {
  flex: 1;
  height: 32px;
  background-color: #F5F5F7;
  border-radius: 8px;
  padding: 0 10px;
  font-size: 13px;
  color: #1A1A1A;
  display: flex;
  align-items: center;
}

/* ========== 目录检测 ========== */
.inspect-btn {
  flex: 1;
  height: 32px;
  border-radius: 8px;
  background-color: #E8F0FE;
  display: flex;
  align-items: center;
  justify-content: center;
}

.inspect-btn.busy {
  background-color: #E0E0E0;
}

.inspect-btn text {
  font-size: 13px;
  color: #1660C6;
}

.inspect-btn.busy text {
  color: #888888;
}

.inspect-wrap {
  margin: 2px 0 10px 0;
  padding: 10px 10px 6px 10px;
  background-color: #F8F8FA;
  border-radius: 10px;
}

.inspect-dir {
  display: block;
  font-size: 12px;
  color: #666666;
  margin-bottom: 8px;
  word-break: break-all;
}

.inspect-list {
  max-height: 220px;
}

.inspect-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: #FFFFFF;
  border-radius: 8px;
  padding: 6px 8px;
  margin-bottom: 6px;
}

.inspect-thumb {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  background-color: #E5E5E5;
  flex-shrink: 0;
  margin-right: 10px;
}

.inspect-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.inspect-libcode {
  font-size: 13px;
  font-weight: 500;
  color: #1A1A1A;
}

.inspect-sub {
  font-size: 12px;
  color: #888888;
  margin-top: 2px;
}

.inspect-empty {
  display: block;
  font-size: 12px;
  color: #999999;
  text-align: center;
  padding: 12px 0;
}

.modal-actions {
  display: flex;
  flex-direction: row;
  gap: 12px;
  margin-top: 14px;
}

.modal-btn {
  flex: 1;
  height: 38px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-btn-cancel {
  background-color: #F0F0F0;
}

.modal-btn-cancel text {
  font-size: 14px;
  color: #666666;
}

.modal-btn-ok {
  background-color: #FF0000;
}

.modal-btn-ok text {
  font-size: 14px;
  font-weight: 500;
  color: #FFFFFF;
}

/* ========== 贴标签弹窗 ========== */
.label-box {
  align-items: center;
}

.label-desc {
  font-size: 13px;
  color: #666666;
  text-align: center;
  line-height: 1.8;
  white-space: pre-line;
  margin-top: 4px;
}

.label-box .modal-actions {
  width: 100%;
}
</style>
