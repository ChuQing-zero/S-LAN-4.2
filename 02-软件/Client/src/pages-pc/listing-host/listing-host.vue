<template>
  <view class="host-panel">
    <view class="header">
      <text class="title">一键上架执行主机</text>
      <text class="status" :class="hostOnline ? 'online' : 'offline'">
        {{ hostOnline ? '主机在线' : '主机离线' }}
      </text>
    </view>

    <view class="section">
      <text class="section-title">待执行批次</text>
      <view v-if="batches.length === 0" class="empty">暂无待执行批次</view>
      <view v-for="b in batches" :key="b.batchId" class="batch-card">
        <view class="batch-row">
          <text class="batch-id">{{ b.batchId }}</text>
          <text class="batch-progress">
            {{ b.successCount }}/{{ b.totalCards }} 成功
            <text v-if="b.failedCount > 0" class="fail-text"> | {{ b.failedCount }} 失败</text>
          </text>
        </view>
        <view class="batch-row sub">
          <text>流程A: {{ b.flowSummary.flowA }} 流程B: {{ b.flowSummary.flowB }} 流程C: {{ b.flowSummary.flowC }}</text>
        </view>
      </view>
    </view>

    <view class="section">
      <text class="section-title">实时执行日志</text>
      <scroll-view class="log-box" scroll-y :scroll-into-view="'log-' + logs.length">
        <view v-for="(l, i) in logs" :key="i" :id="'log-' + i" class="log-line">
          [{{ l.time }}] {{ l.text }}
        </view>
        <view v-if="logs.length === 0" class="empty">等待执行...</view>
      </scroll-view>
    </view>
  </view>
</template>

<script>
// #ifdef H5
import config from '@/config/index.js'
import wsClient from '@/api/ws-client.js'
import request from '@/api/request.js'
// #endif

export default {
  data() {
    return {
      hostOnline: false,
      batches: [],
      logs: [],
    }
  },
  onLoad() {
    this.startPolling()
    this.initWs()
  },
  onUnload() {
    clearInterval(this.timer)
  },
  methods: {
    async startPolling() {
      this.timer = setInterval(async () => {
        try {
          const r = await request({ url: '/listings/queues/pending', method: 'GET' })
          this.batches = r.list || []
        } catch (_) { /* 静默 */ }
      }, 3000)
    },
    initWs() {
      wsClient.subscribe('__all__', (msg) => {
        this.hostOnline = true
        const t = new Date().toLocaleTimeString('zh-CN', { hour12: false })
        if (msg.event === 'item-progress') {
          this.logs.push({ time: t, text: `批次${msg.batchId} #${msg.index} ${msg.detail || ''}` })
        } else if (msg.event === 'queue-update') {
          this.logs.push({ time: t, text: `批次${msg.batchId} #${msg.index} ${msg.itemStatus} ${msg.outputStatus || ''}` })
        } else if (msg.event === 'execution-start') {
          this.logs.push({ time: t, text: `批次${msg.batchId} 开始执行 (共${msg.total}条)` })
        } else if (msg.event === 'execution-end') {
          this.logs.push({ time: t, text: `批次${msg.batchId} 执行结束 (成功${msg.success} 失败${msg.failed})` })
        }
        if (this.logs.length > 200) this.logs = this.logs.slice(-200)
      })
    },
  },
}
</script>

<style scoped>
.host-panel { padding: 24rpx; }
.header { display: flex; justify-content: space-between; align-items: center; padding: 24rpx; background: #fff; border-radius: 12rpx; }
.title { font-size: 34rpx; font-weight: bold; }
.status { font-size: 26rpx; padding: 6rpx 20rpx; border-radius: 999rpx; }
.online { background: #e8f8ee; color: #07c160; }
.offline { background: #f5f5f5; color: #999; }
.section { margin-top: 24rpx; background: #fff; border-radius: 12rpx; padding: 24rpx; }
.section-title { font-size: 30rpx; font-weight: bold; margin-bottom: 16rpx; }
.empty { color: #999; font-size: 26rpx; text-align: center; padding: 32rpx 0; }
.batch-card { border: 1rpx solid #eee; border-radius: 8rpx; padding: 16rpx; margin-bottom: 12rpx; }
.batch-row { display: flex; justify-content: space-between; }
.batch-row.sub { margin-top: 8rpx; font-size: 24rpx; color: #666; }
.batch-id { font-size: 28rpx; font-weight: bold; }
.batch-progress { font-size: 26rpx; color: #07c160; }
.fail-text { color: #fa5151; }
.log-box { height: 600rpx; background: #1e1e1e; border-radius: 8rpx; padding: 16rpx; }
.log-line { color: #d4d4d4; font-size: 24rpx; line-height: 1.8; font-family: monospace; }
</style>
