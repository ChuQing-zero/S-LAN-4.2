<template>
  <view class="page">
    <view class="toolbar">
      <view class="tool-btn" @tap="goBack">
        <image class="icon-back" src="/static/icons/ic_back.png" mode="aspectFit"></image>
      </view>
      <view class="toolbar-mid">
        <text class="title">设备调试</text>
        <text class="sub">硬件动作测试台 · 点击按钮直接驱动设备</text>
      </view>
      <view class="tool-btn-ph"></view>
    </view>

    <!-- 通信端口 -->
    <view class="card">
      <text class="section">通信端口</text>
      <view class="status-row" style="margin-top:12px">
        <text class="status-label">当前链路</text>
        <text class="status-value" :class="linkActive === 'none' ? 'bad' : 'ok'">{{ linkActiveText }}</text>
      </view>
      <view class="status-row">
        <text class="status-label">USB 串口</text>
        <text class="status-value" :class="link && link.serialOk ? 'ok' : ''">{{ link && link.serialOk ? '已连接' : '未连接' }}</text>
      </view>
      <view class="status-row">
        <text class="status-label">WiFi 阶段</text>
        <text class="status-value small mono">{{ wifiText }}</text>
      </view>
      <view class="status-row" v-if="link && link.wifi && link.wifi.peer">
        <text class="status-label">WiFi 对端</text>
        <text class="status-value small mono">{{ link.wifi.peer }}</text>
      </view>

      <text class="subtitle">链路模式（auto = 有数据线走USB，没有走WiFi）</text>
      <view class="grid">
        <view class="op" :class="linkMode === 'auto' ? 'op-up' : ''" @tap="setLinkMode('auto')">自动</view>
        <view class="op" :class="linkMode === 'serial' ? 'op-up' : ''" @tap="setLinkMode('serial')">仅 USB</view>
        <view class="op" :class="linkMode === 'wifi' ? 'op-up' : ''" @tap="setLinkMode('wifi')">仅 WiFi</view>
        <view class="op" @tap="restartWifi">重启 WiFi</view>
      </view>
    </view>

    <!-- 连接状态 -->
    <view class="card status-card">
      <view class="status-row">
        <text class="status-label">串口</text>
        <text class="status-value" :class="conn ? 'ok' : 'bad'">{{ serialText }}</text>
      </view>
      <view class="status-row">
        <text class="status-label">最近指令</text>
        <text class="status-value mono">{{ lastCmd || '-' }}</text>
      </view>
      <view class="status-row" v-if="lastResp">
        <text class="status-label">回执</text>
        <text class="status-value mono small">{{ lastResp }}</text>
      </view>
      <view class="btn-row">
        <view class="btn btn-gray" @tap="refreshStatus">刷新状态</view>
        <view class="btn btn-gray" @tap="sendCmd('?')">查询全部</view>
        <view class="btn btn-gray" @tap="sendCmd('H')">握手</view>
      </view>
    </view>

    <!-- 分拣单元 -->
    <view class="card">
      <text class="section">分拣单元</text>
      <!-- 每个单元一行：单独控制该单元的舵机 -->
      <view class="unit-row" v-for="u in units" :key="u">
        <text class="unit-name">{{ u }}</text>
        <view class="unit-btns">
          <view class="mini up"   @tap="unitAct(u, 'raise')">↑ 抬升</view>
          <view class="mini down" @tap="unitAct(u, 'lower')">↓ 下降</view>
          <view class="mini stop" @tap="unitAct(u, 'stop')">■ 停止</view>
          <view class="mini"      @tap="unitState(u)">状态</view>
        </view>
      </view>

      <text class="subtitle">选中单元 {{ sortAddr }} 的其它动作</text>
      <view class="unit-pick">
        <view
          v-for="u in units"
          :key="'p' + u"
          class="unit-chip"
          :class="{ active: sortAddr === u }"
          @tap="sortAddr = u"
        >{{ u }}</view>
      </view>

      <view class="grid">
        <view class="op" @tap="sortAct('au')">A 抬</view>
        <view class="op" @tap="sortAct('ad')">A 放</view>
        <view class="op" @tap="sortAct('bu')">B 抬</view>
        <view class="op" @tap="sortAct('bd')">B 放</view>
        <view class="op" @tap="sortAct('hold')">抬手保持</view>
        <view class="op" @tap="sortAct('arm')">布防</view>
        <view class="op" @tap="sortAct('disarm')">撤防</view>
        <view class="op" @tap="sendCmd('T,' + sortAddr)">读状态</view>
        <view class="op" @tap="sendCmd('L,' + sortAddr + ',3')">点 3 灯</view>
        <view class="op op-up" @tap="sortAct('raise')">两路都抬</view>
        <view class="op op-down" @tap="sortAct('lower')">两路都放</view>
      </view>

      <text class="subtitle">抬升参数（时间 ×10ms，100 = 1.0 秒）</text>
      <view class="param-row">
        <text class="param-label">A</text>
        <input class="param-input" type="number" v-model="servoA" placeholder="100" />
        <text class="param-hint">{{ (Number(servoA) || 0) / 100 }} 秒</text>
      </view>
      <view class="param-row">
        <text class="param-label">B</text>
        <input class="param-input" type="number" v-model="servoB" placeholder="100" />
        <text class="param-hint">{{ (Number(servoB) || 0) / 100 }} 秒</text>
      </view>

      <view class="grid">
        <view class="op op-up" @tap="setAndRaise">设置并抬升</view>
        <view class="op" @tap="setOnly">只设置</view>
        <view class="op" @tap="quickSet(50, 50)">50/50</view>
        <view class="op" @tap="quickSet(100, 100)">100/100</view>
        <view class="op" @tap="quickSet(200, 100)">A 高 B 低</view>
        <view class="op" @tap="quickSet(100, 200)">B 高 A 低</view>
      </view>
    </view>

    <!-- 识别单元 -->
    <view class="card">
      <text class="section">识别单元 0x10</text>

      <view class="grid">
        <view class="op op-up" @tap="sendCmd('I,0x10')">自动识别</view>
        <view class="op" @tap="sendCmd('C,0x10')">扫码</view>
        <view class="op" @tap="sendCmd('N,0x10')">NFC</view>
        <view class="op" @tap="sendCmd('R,0x10')">读结果</view>
        <view class="op" @tap="sendCmd('Q,0x10,qr')">读扫码缓冲</view>
        <view class="op" @tap="sendCmd('Q,0x10,nfc')">读NFC缓冲</view>
        <view class="op" @tap="sendCmd('Q,0x10,card')">读有卡</view>
        <view class="op" @tap="sendCmd('A,0x10')">自检</view>
      </view>

      <text class="subtitle">挡片</text>
      <view class="grid">
        <view class="op" @tap="sendCmd('E,0x10,up')">放行</view>
        <view class="op" @tap="sendCmd('E,0x10,down')">阻挡</view>
        <view class="op" @tap="sendCmd('E,0x10,0')">0°</view>
        <view class="op" @tap="sendCmd('E,0x10,45')">45°</view>
        <view class="op" @tap="sendCmd('E,0x10,90')">90°</view>
        <view class="op" @tap="sendCmd('E,0x10,135')">135°</view>
        <view class="op" @tap="sendCmd('E,0x10,180')">180°</view>
      </view>

      <text class="subtitle">识别单元皮带</text>
      <view class="grid">
        <view class="op" @tap="sendCmd('K,0x10,on')">启动</view>
        <view class="op op-warn" @tap="sendCmd('K,0x10,off')">停止</view>
        <view class="op" @tap="sendCmd('K,0x10,sec,3')">跑 3 秒</view>
        <view class="op" @tap="sendCmd('K,0x10,pwm,255')">全速</view>
        <view class="op" @tap="sendCmd('K,0x10,pwm,150')">半速</view>
        <view class="op" @tap="sendCmd('K,0x10,dir,R')">反转</view>
      </view>
    </view>

    <!-- 进料单元 -->
    <view class="card">
      <text class="section">进料单元</text>
      <view class="grid">
        <view class="op op-up" @tap="sendCmd('s')">电机启动</view>
        <view class="op op-warn" @tap="sendCmd('t')">电机停止</view>
        <view class="op" @tap="sendCmd('c')">推一张卡</view>
        <view class="op" @tap="sendCmd('r')">复位计数</view>
        <view class="op" @tap="sendCmd('b')">蜂鸣一声</view>
        <view class="op" @tap="sendCmd('O,on')">状态灯亮</view>
        <view class="op" @tap="sendCmd('O,off')">状态灯灭</view>
        <view class="op" @tap="sendCmd('Q,ldr')">读光敏</view>
        <view class="op" @tap="sendCmd('F,on')">风扇开</view>
        <view class="op" @tap="sendCmd('F,off')">风扇关</view>
        <view class="op" @tap="sendCmd('W,on')">灯继电器开</view>
        <view class="op" @tap="sendCmd('W,off')">灯继电器关</view>
      </view>

      <text class="subtitle">数码管</text>
      <view class="grid">
        <view class="op" v-for="t in ['1234','0000','8888','BUSY']" :key="t" @tap="sendCmd('D,' + t)">{{ t }}</view>
      </view>
    </view>

    <!-- 自定义指令 -->
    <view class="card">
      <text class="section">自定义指令</text>
      <input
        class="cmd-input"
        v-model="customCmd"
        placeholder="例：S,0x20,raise"
        confirm-type="send"
        @confirm="sendCmd(customCmd)"
      />
      <view class="btn-row">
        <view class="btn" @tap="sendCmd(customCmd)">发送</view>
      </view>
    </view>

    <!-- 日志 -->
    <view class="card">
      <view class="log-head">
        <text class="section">日志</text>
        <text class="clear" @tap="logs = []">清空</text>
      </view>
      <scroll-view scroll-y class="log-box">
        <text v-for="(l, i) in logs" :key="i" class="log-line">{{ l }}</text>
        <text v-if="!logs.length" class="log-empty">暂无</text>
      </scroll-view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { getDeviceStatus, deviceHardware, getDeviceLink, setDeviceLink } from '@/api/index.js'

const linkActiveText = computed(() => {
  if (!link.value) return '读取中...'
  return link.value.activeText || '-'
})
const wifiText = computed(() => {
  const w = link.value && link.value.wifi
  if (!w) return '-'
  if (w.connected) return '已连接 ' + (w.peer || '')
  return (w.phaseText || w.phase || '-') + (w.err ? (' / ' + w.err) : '')
})

const units = ['0x20', '0x21', '0x22', '0x23']
const sortAddr = ref('0x20')

const conn = ref(false)
const serialText = ref('未连接')
const lastCmd = ref('')
const lastResp = ref('')
const logs = ref([])
const customCmd = ref('')
const link = ref(null)
const linkMode = ref('auto')
const servoA = ref(100)
const servoB = ref(100)
const sending = ref(false)

function addLog (txt) {
  const t = new Date().toTimeString().slice(0, 8)
  logs.value.unshift('[' + t + '] ' + txt)
  if (logs.value.length > 80) logs.value.pop()
}

async function refreshStatus () {
  try {
    const r = await getDeviceStatus()
    serialText.value = (r && r.serial) || '未知'
    conn.value = !!(r && r.serial && r.serial.indexOf('已连接') >= 0)
    if (r && r.link) {
      link.value = r.link
      linkMode.value = r.link.mode || 'auto'
    }
  } catch (e) {
    serialText.value = '读取失败'
    conn.value = false
  }
}

/* 单个分拣单元动作：unitAct('0x20','raise') */
function unitAct (addr, act) {
  sendCmd('S,' + addr + ',' + act)
  addLog('>>> ' + addr + ' ' + act)
}

/* 读单个分拣单元状态 */
function unitState (addr) {
  sendCmd('T,' + addr)
  addLog('>>> ' + addr + ' 读状态')
}

function goBack () {
  uni.reLaunch({ url: '/pages/index/index' })
}

/* 切换链路模式 */
async function setLinkMode (m) {
  try {
    const r = await setDeviceLink({ mode: m })
    if (r && r.link) { link.value = r.link; linkMode.value = r.link.mode }
    addLog('链路模式 -> ' + m)
  } catch (e) {
    addLog('切换失败: ' + (e && e.message ? e.message : e))
  }
}

/* 重启 WiFi 握手 */
async function restartWifi () {
  try {
    const r = await setDeviceLink({ wifi_restart: true })
    if (r && r.link) { link.value = r.link; linkMode.value = r.link.mode }
    addLog('WiFi 握手已重启')
  } catch (e) {
    addLog('重启失败: ' + (e && e.message ? e.message : e))
  }
}

async function sendCmd (cmd) {
  const c = String(cmd || '').trim()
  if (!c) return
  if (sending.value) return
  sending.value = true
  lastCmd.value = c
  try {
    const r = await deviceHardware(c)
    lastResp.value = r && r.ok ? 'OK' : JSON.stringify(r || {})
    addLog('发送 ' + c + ' -> ' + lastResp.value)
  } catch (e) {
    lastResp.value = '失败: ' + (e && e.message ? e.message : e)
    addLog('发送 ' + c + ' 失败')
  }
  sending.value = false
  setTimeout(refreshStatus, 300)
}

function sortAct (act) {
  sendCmd('S,' + sortAddr.value + ',' + act)
}

/* 顺序发送多条指令（每条等上一条完成）*/
async function sendSeq (cmds) {
  for (const c of cmds) {
    await sendCmd(c)
    await new Promise(r => setTimeout(r, 120))
  }
}

/* 只设置 A/B 抬升时间 */
function setOnly () {
  const a = Number(servoA.value) || 0
  const b = Number(servoB.value) || 0
  if (a <= 0 || b <= 0) {
    addLog('参数必须大于 0')
    return
  }
  sendSeq([
    'P,' + sortAddr.value + ',au,' + a,
    'P,' + sortAddr.value + ',bu,' + b
  ])
  addLog('设置 A=' + a + ' B=' + b)
}

/* 先设置 A/B，再抬升 */
function setAndRaise () {
  const a = Number(servoA.value) || 0
  const b = Number(servoB.value) || 0
  if (a <= 0 || b <= 0) {
    addLog('参数必须大于 0')
    return
  }
  sendSeq([
    'P,' + sortAddr.value + ',au,' + a,
    'P,' + sortAddr.value + ',bu,' + b,
    'S,' + sortAddr.value + ',raise'
  ])
  addLog('设置并抬升 A=' + a + ' B=' + b)
}

/* 快捷填入 */
function quickSet (a, b) {
  servoA.value = a
  servoB.value = b
}

onMounted(() => {
  refreshStatus()
})
</script>

<style scoped>
/* ===== 与「设备连接」「设备连接2」统一的配色 ===== */
.page {
  min-height: 100vh;
  background-color: #F5F5F7;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding-bottom: 20px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  background-color: #FFFFFF;
  padding: 12px 16px 10px;
}
.toolbar-mid { flex: 1; }
.tool-btn {
  width: 32px; height: 32px; border-radius: 16px;
  background-color: #F0F0F0;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.tool-btn-icon { font-size: 16px; color: #1A1A1A; line-height: 1; }
.icon-back { width: 18px; height: 18px; }
.tool-btn-ph { width: 32px; flex-shrink: 0; }
.header { padding: 2px 2px 12px; }
.title { font-size: 18px; font-weight: 600; color: #1A1A1A; }
.sub { display: block; font-size: 11px; color: #999999; margin-top: 4px; }

/* 区块（照设备连接：全宽白底、无圆角、块间 1px 缝） */
.card {
  background-color: #FFFFFF;
  padding: 14px 16px;
  margin-top: 1px;
}
.section {
  display: block;
  font-size: 15px; font-weight: 500; color: #1A1A1A;
  margin-bottom: 10px;
}
.subtitle {
  display: block;
  font-size: 12px; color: #999999;
  margin: 14px 0 8px;
}

/* 状态行 */
.status-card { }
.status-row {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 5px 0;
}
.status-label { font-size: 12px; color: #999999; }
.status-value { font-size: 12px; color: #1A1A1A; }
.status-value.ok   { color: #34C759; font-weight: 500; }
.status-value.bad  { color: #FF3B30; font-weight: 500; }
.status-value.mono { font-family: ui-monospace, Consolas, monospace; }
.status-value.small { font-size: 11px; }

/* 分拣单元逐行 */
.unit-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid #F0F0F0;
}
.unit-name {
  width: 52px; flex-shrink: 0;
  font-size: 13px; font-weight: 500; color: #1A1A1A;
  font-family: ui-monospace, Consolas, monospace;
}
.unit-btns { flex: 1; display: flex; gap: 6px; }
.mini {
  flex: 1; height: 30px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  background-color: #F0F0F0; color: #1A1A1A; font-size: 12px;
}
.mini.up   { background-color: #E9F9EE; color: #18A058; }
.mini.down { background-color: #F0F0F0; color: #1A1A1A; }
.mini.stop { background-color: #FFEDEC; color: #FF3B30; }

/* 单元选择胶囊 */
.unit-pick { display: flex; gap: 8px; margin: 4px 0 10px; }
.unit-chip {
  flex: 1; height: 30px; border-radius: 15px;
  display: flex; align-items: center; justify-content: center;
  background-color: #F0F0F0; color: #666666; font-size: 12px;
  font-family: ui-monospace, Consolas, monospace;
}
.unit-chip.active { background-color: #1A1A1A; color: #FFFFFF; font-weight: 500; }

/* 操作按钮网格 */
.grid { display: flex; flex-wrap: wrap; gap: 8px; }
.op {
  flex: 1; min-width: 84px; height: 34px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  background-color: #F0F0F0; color: #1A1A1A; font-size: 12px;
}
.op-up   { background-color: #E9F9EE; color: #18A058; }
.op-down { background-color: #F0F0F0; color: #1A1A1A; }
.op-warn { background-color: #FFF4E5; color: #E65100; }

/* 参数 */
.param-row {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 10px;
}
.param-label {
  width: 24px; font-size: 13px; color: #1A1A1A; font-weight: 500;
}
.param-input {
  flex: 1; height: 34px; padding: 0 10px;
  background-color: #F5F5F7; border-radius: 8px;
  font-size: 13px; color: #1A1A1A;
  font-family: ui-monospace, Consolas, monospace;
}
.param-hint { width: 56px; font-size: 11px; color: #999999; text-align: right; }

/* 通用按钮 */
.btn-row { display: flex; gap: 8px; margin-top: 10px; }
.btn {
  flex: 1; height: 34px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  background-color: #FF0000; color: #FFFFFF; font-size: 13px;
}
.btn-gray { background-color: #F0F0F0; color: #1A1A1A; }

/* 自定义指令输入 */
.cmd-input {
  height: 36px; padding: 0 12px;
  background-color: #F5F5F7; border-radius: 8px;
  font-size: 13px; color: #1A1A1A;
  font-family: ui-monospace, Consolas, monospace;
}

/* 日志 */
.clear { font-size: 12px; color: #FF3B30; }
.log-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px;
}
.log-box {
  height: 220px;
  background-color: #F5F5F7; border-radius: 8px;
  padding: 10px;
}
.log-line {
  font-size: 11px; color: #666666; line-height: 1.9;
  font-family: ui-monospace, Consolas, monospace;
  word-break: break-all;
}
.log-empty {
  font-size: 11px; color: #C0C0C0;
  text-align: center; padding-top: 80px;
}

/* 通用 */
.mono { font-family: ui-monospace, Consolas, monospace; }
</style>
