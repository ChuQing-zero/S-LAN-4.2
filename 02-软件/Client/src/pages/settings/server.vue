<template>
  <view class="page">
    <view class="topbar">
      <view class="tbtn" @tap="goBack"><image class="timg" src="/static/icons/ic_back.png" mode="aspectFit" /></view>
      <text class="ttl">服务器设置</text>
      <view class="tbtn-placeholder"></view>
    </view>

    <view class="content">
      <view class="tips-box">
        <text class="tips-title">手机 APP 连不上后端时，在这里改服务器地址</text>
        <text class="tips-text">电脑 IP 变了，只需改这里保存，不用重新打包 APP。</text>
        <text class="tips-text">填写格式：http://192.168.x.x:3001/v1/api</text>
      </view>

      <view class="input-card">
        <text class="label">服务器地址</text>
        <input class="addr-input" v-model="serverUrl" placeholder="http://192.168.x.x:3001/v1/api" placeholder-class="ph" />
      </view>

      <view class="btn-row">
        <view class="btn btn-save" @tap="onSave"><text>保存并应用</text></view>
        <view class="btn btn-test" @tap="onTest" :class="{ disabled: testing }"><text>{{ testing ? '检测中...' : '测试连接' }}</text></view>
      </view>
      <view class="btn btn-reset" @tap="onReset"><text>恢复默认地址</text></view>

      <view v-if="testResult" class="test-result" :class="testOk ? 'ok' : 'fail'">
        <text>{{ testResult }}</text>
      </view>

      <view class="current-bar">
        <text class="current-label">当前生效地址</text>
        <text class="current-addr" selectable>{{ currentUrl }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import config from '@/config/index.js'
import { goBack as navBack } from '@/utils/nav.js'

const serverUrl = ref(uni.getStorageSync('serverUrl') || config.apiBaseUrl)
const testing = ref(false)
const testResult = ref('')
const testOk = ref(false)

const currentUrl = config.apiBaseUrl

// 这个页面是从首页进来的；刷新过就直接回首页（见 utils/nav.js 里的说明）
const goBack = () => navBack('/pages/index/index')

const onSave = () => {
  const url = String(serverUrl.value || '').trim()
  if (!url) {
    uni.showToast({ title: '请输入服务器地址', icon: 'none' })
    return
  }
  // 规范化: 去掉末尾斜杠
  const clean = url.replace(/\/+$/, '')
  uni.setStorageSync('serverUrl', clean)
  uni.showToast({ title: '已保存，重启APP生效', icon: 'success' })
}

const onTest = async () => {
  const url = String(serverUrl.value || '').trim().replace(/\/+$/, '')
  if (!url) { uni.showToast({ title: '请输入地址', icon: 'none' }); return }
  testing.value = true
  testResult.value = ''
  try {
    const r = await fetch(url.replace(/\/v1\/api$/, '') + '/health', { timeout: 5000 })
    if (r.ok) {
      testOk.value = true
      testResult.value = '✅ 连接成功，服务器正常'
    } else {
      testOk.value = false
      testResult.value = '❌ 服务器响应异常 (HTTP ' + r.status + ')'
    }
  } catch (e) {
    testOk.value = false
    testResult.value = '❌ 无法连接：' + (e.message || '网络错误')
  }
  testing.value = false
}

const onReset = () => {
  uni.removeStorageSync('serverUrl')
  uni.showToast({ title: '已恢复默认，重启APP生效', icon: 'success' })
}
</script>

<style scoped>
.page { min-height: 100vh; background: #F5F5F7; display: flex; flex-direction: column; }
.topbar { background: #FFF; padding: 14px 16px 12px; display: flex; align-items: center; justify-content: space-between; position: relative; }
.tbtn { width: 32px; height: 32px; border-radius: 16px; background: #F0F0F0; display: flex; align-items: center; justify-content: center; }
.timg { width: 18px; height: 18px; }
.ttl { position: absolute; left: 50%; transform: translateX(-50%); font-size: 16px; font-weight: 500; color: #1A1A1A; }
.tbtn-placeholder { width: 32px; }
.content { padding: 16px; }
.tips-box { background: #E8F0FE; border-radius: 10px; padding: 12px; margin-bottom: 14px; }
.tips-title { display: block; font-size: 14px; font-weight: 500; color: #1660C6; margin-bottom: 6px; }
.tips-text { display: block; font-size: 12px; color: #1660C6; line-height: 1.7; }
.input-card { background: #FFF; border-radius: 12px; padding: 14px; }
.label { display: block; font-size: 13px; color: #666; margin-bottom: 8px; }
.addr-input { width: 100%; height: 44px; background: #F5F5F7; border-radius: 8px; padding: 0 12px; font-size: 13px; color: #1A1A1A; }
.ph { color: #BBB; }
.btn-row { display: flex; gap: 10px; margin-top: 14px; }
.btn { flex: 1; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
.btn-save { background: #1660C6; }
.btn-save text { color: #FFF; font-size: 14px; font-weight: 500; }
.btn-test { background: #FFF; border: 1px solid #1660C6; }
.btn-test text { color: #1660C6; font-size: 14px; }
.btn-test.disabled { opacity: 0.6; }
.btn-reset { margin-top: 10px; background: #F0F0F0; }
.btn-reset text { color: #666; font-size: 14px; }
.test-result { margin-top: 12px; padding: 12px; border-radius: 8px; font-size: 13px; }
.test-result.ok { background: #E8F8EE; color: #07C160; }
.test-result.fail { background: #FEF0F0; color: #FA5151; }
.current-bar { margin-top: 20px; background: #FFF; border-radius: 10px; padding: 12px 14px; }
.current-label { font-size: 12px; color: #999; display: block; margin-bottom: 6px; }
.current-addr { font-size: 13px; color: #FF0000; word-break: break-all; }
</style>
