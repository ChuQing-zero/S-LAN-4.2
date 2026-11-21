<template>
  <view class="page">
    <view class="topbar">
      <view class="tbtn" @tap="goBack"><image class="timg" src="/static/icons/ic_back.png" mode="aspectFit" /></view>
      <text class="ttl">坐标采集</text>
    </view>
    <view class="card" style="margin:12px 16px;padding:16px">
      <text style="font-size:14px;color:#666;text-align:center;display:block;margin-bottom:12px">将鼠标移到目标位置，点下方按钮采集坐标</text>
      <view class="pos-display">
        <text class="pos-text">X:{{ pos.x }}  Y:{{ pos.y }}</text>
      </view>
      <view style="text-align:center;margin-top:8px">
        <text style="font-size:13px;color:#999">将鼠标移到集换社搜索框 → 点采集 → 坐标复制到剪贴板</text>
      </view>
      <view class="btn" @tap="capture" style="margin-top:12px"><text class="bt">📍 采集当前鼠标坐标</text></view>
      <view style="margin-top:12px;background:#F5F5F7;border-radius:8px;padding:10px;min-height:40px">
        <text style="font-size:12px;color:#999">采集记录：</text>
        <view v-for="(p,i) in history" :key="i" style="padding:4px 0;border-bottom:1px solid #EEE">
          <text style="font-size:12px;color:#1A1A1A">X:{{ p.x }} Y:{{ p.y }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { authFetch } from '@/utils/authFetch.js'
import { goBack as navBack } from '@/utils/nav.js'
const pos = ref({x:0, y:0})
const history = ref([])
// 这个页面 panel 和 panel-vm 都会跳进来，有上一页就正常回上一页；
// 只有刷新过（栈里只剩自己）才兜底回发布面板。
const goBack = () => navBack('/pages/listing/panel')

const refreshPos = async () => {
  try {
    const r = await authFetch('/v1/api/listing-agent/mouse-position')
    pos.value = await r.json()
  } catch (_) {}
}

const capture = async () => {
  await refreshPos()
  history.value.unshift({x: pos.value.x, y: pos.value.y})
  // 复制到剪贴板
  const txt = `X:${pos.value.x} Y:${pos.value.y}`
  uni.setClipboardData({ data: txt, success: () => uni.showToast({ title: '已复制: ' + txt, icon: 'success' }) })
}

onMounted(() => { refreshPos(); setInterval(refreshPos, 1000) })
</script>

<style scoped>
.page{display:flex;flex-direction:column;height:100vh;background:#F5F5F7}
.topbar{background:#FFF;padding:12px 16px 10px;display:flex;align-items:center;justify-content:space-between}
.tbtn{width:32px;height:32px;border-radius:16px;background:#F0F0F0;display:flex;align-items:center;justify-content:center}
.timg{width:18px;height:18px}
.ttl{font-size:15px;font-weight:500;color:#1A1A1A}
.card{background:#FFF;border-radius:12px}
.pos-display{text-align:center;padding:20px;background:#F0F4FF;border-radius:10px}
.pos-text{font-size:24px;font-weight:700;color:#4A90D9}
.btn{height:48px;background:#FF0000;border-radius:24px;display:flex;align-items:center;justify-content:center}
.bt{color:#FFF;font-size:15px;font-weight:500}
</style>
