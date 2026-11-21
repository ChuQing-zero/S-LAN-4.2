<template>
  <view v-if="visible" class="dialog-mask" @tap="onClose">
    <view class="dialog-box" @tap.stop>

      <!-- ===== 卡牌数据库 ===== -->
      <text class="dialog-title">卡牌数据库</text>
      <text class="dialog-desc">卡牌目录数据已整合到本地服务器（MongoDB CardCatalog · {{ totalCards }} 张）</text>

      <view class="db-status">
        <text class="status-text status-ok">✓ 本地库可用（26,792 张卡牌数据）</text>
      </view>

      <!-- ===== 分隔线 ===== -->
      <view class="divider"></view>

      <!-- ===== 云端服务器配置 ===== -->
      <text class="dialog-title">云端服务器配置</text>
      <text class="dialog-desc">配置后云端库将连接到指定服务器</text>

      <view class="field-group">
        <text class="field-label">服务器地址</text>
        <input
          class="field-input"
          v-model="serverUrl"
          placeholder="https://cloud.example.com/v1/api"
          placeholder-style="color: #CCCCCC;"
        />
      </view>

      <view class="status-row">
        <text class="status-text" :class="{ 'status-ok': connected, 'status-err': !connected && tested }">
          {{ statusMsg || '默认：本地服务器' }}
        </text>
        <view class="test-btn" @tap="onTest">
          <text class="test-text">测试连接</text>
        </view>
      </view>

      <view class="dialog-btns">
        <view class="btn-reset" @tap="onReset">
          <text class="reset-text">恢复默认</text>
        </view>
        <view class="btn-save" @tap="onSave">
          <text class="save-text">保存</text>
        </view>
      </view>

    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'

const visible = ref(false)
const serverUrl = ref('')
const connected = ref(false)
const tested = ref(false)
const statusMsg = ref('')
const totalCards = ref(26792)

const open = () => {
  serverUrl.value = uni.getStorageSync('cloudApiUrl') || ''
  connected.value = false
  tested.value = false
  statusMsg.value = ''
  visible.value = true
}

const onClose = () => { visible.value = false }

const onTest = async () => {
  if (!serverUrl.value.trim()) {
    uni.showToast({ title: '请输入服务器地址', icon: 'none' })
    return
  }
  const base = serverUrl.value.trim()
  tested.value = true
  try {
    const res = await new Promise((resolve, reject) => {
      uni.request({
        url: base + '/health',
        method: 'GET',
        success: resolve,
        fail: reject
      })
    })
    if (res.statusCode === 200 && res.data?.status === 'ok') {
      connected.value = true
      statusMsg.value = '✓ 连接成功'
    } else {
      connected.value = false
      statusMsg.value = '✗ 响应异常 (' + (res.statusCode || '?') + ')'
    }
  } catch (e) {
    connected.value = false
    statusMsg.value = '✗ 无法连接'
  }
}

const onSave = () => {
  const url = serverUrl.value.trim()
  if (url) {
    uni.setStorageSync('cloudApiUrl', url)
    uni.showToast({ title: '已保存', icon: 'success', duration: 2000 })
  } else {
    uni.removeStorageSync('cloudApiUrl')
    uni.showToast({ title: '已清空，使用默认服务器', icon: 'success' })
  }
  visible.value = false
}

const onReset = () => {
  uni.removeStorageSync('cloudApiUrl')
  serverUrl.value = ''
  connected.value = false
  tested.value = false
  statusMsg.value = '已恢复默认（本地服务器）'
  uni.showToast({ title: '已恢复默认服务器', icon: 'success' })
}

defineExpose({ open })
</script>

<style scoped>
.dialog-mask {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dialog-box {
  width: calc(100% - 48px);
  max-width: 380px;
  background-color: #FFFFFF;
  border-radius: 16px;
  padding: 24px 20px 20px 20px;
  box-sizing: border-box;
  max-height: 85vh;
  overflow-y: auto;
}
.dialog-title {
  font-size: 17px;
  font-weight: 600;
  color: #1A1A1A;
  display: block;
  text-align: center;
}
.dialog-desc {
  font-size: 12px;
  color: #999999;
  display: block;
  text-align: center;
  margin-top: 4px;
  margin-bottom: 16px;
}

/* 数据库状态 */
.db-status {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 4px;
  padding: 0 4px;
}

/* 分隔线 */
.divider {
  height: 1px;
  background: #EEE;
  margin: 18px 0;
}

.field-group {
  margin-bottom: 14px;
}
.field-label {
  font-size: 13px;
  color: #333333;
  margin-bottom: 6px;
  display: block;
}
.field-input {
  width: 100%;
  height: 44px;
  background-color: #F5F5F7;
  border-radius: 10px;
  padding: 0 14px;
  font-size: 13px;
  color: #1A1A1A;
  box-sizing: border-box;
}
.status-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
.status-text {
  font-size: 12px;
  color: #999999;
}
.status-ok { color: #00AA00; }
.status-err { color: #FF0000; }
.test-btn {
  background-color: #F0F0F0;
  border-radius: 14px;
  padding: 6px 14px;
}
.test-text { font-size: 12px; color: #333333; }
.dialog-btns {
  display: flex;
  flex-direction: row;
  gap: 12px;
}
.btn-reset {
  flex: 1;
  background-color: #F0F0F0;
  border-radius: 24px;
  padding: 10px;
  text-align: center;
}
.reset-text { font-size: 14px; color: #666666; }
.btn-save {
  flex: 1;
  background-color: #FF0000;
  border-radius: 24px;
  padding: 10px;
  text-align: center;
}
.save-text { font-size: 14px; color: #FFFFFF; font-weight: 500; }
.link-row { display:flex; align-items:center; justify-content:space-between; padding:12px 4px; cursor:pointer }
.link-text { font-size:14px; color:#4A90D9; font-weight:500 }
.link-arrow { font-size:20px; color:#CCC }
</style>
