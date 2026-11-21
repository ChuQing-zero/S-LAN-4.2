<template>
  <view class="page-container">
    <!-- 顶部个人信息区（无白色底板） -->
    <view class="profile-section">
      <view class="profile-left">
        <image class="avatar" :src="userAvatar" mode="aspectFill" @tap="onAvatarTap"></image>
        <view class="user-info">
          <text class="user-name" @tap="onLoginTap">{{ userName }}</text>
          <view class="user-id-row">
            <text class="user-id">{{ userId }}</text>
            <text class="role-badge" v-if="userRole">{{ userRole==='terminal_admin'?'终端管理员':userRole==='admin'?'管理员':'用户' }}</text>
          </view>
        </view>
      </view>
      <view class="settings-circle" @tap="onSettingsTap">
        <image class="settings-icon" src="/static/icons/ic_settings.png" mode="aspectFit"></image>
      </view>
    </view>

    <!-- 应用与服务区 -->
    <view class="card services-card">
      <text class="section-title">应用服务</text>
      <view class="services-grid">
        <view class="service-item" @tap="onServiceTap('识别上传')">
          <image class="service-icon" src="/static/icons/ic_scan_upload.png" mode="aspectFit"></image>
          <text class="service-label">识别上传</text>
        </view>
        <view class="service-item" @tap="onServiceTap('批量识别')">
          <image class="service-icon" src="/static/icons/ic_scan_upload.png" mode="aspectFit"></image>
          <text class="service-label">批量识别</text>
        </view>
        <view class="service-item" @tap="onServiceTap('一键上架')" v-if="userRole==='admin'||userRole==='terminal_admin'">
          <image class="service-icon" src="/static/icons/ic_one_click_listing.png" mode="aspectFit"></image>
          <text class="service-label">一键上架</text>
        </view>
        <view class="service-item" @tap="onServiceTap('库存管理')">
          <image class="service-icon" src="/static/icons/ic_order_processing.png" mode="aspectFit"></image>
          <text class="service-label">库存管理</text>
        </view>
        <view class="service-item" @tap="onServiceTap('管理后台')" v-if="userRole==='admin'||userRole==='terminal_admin'">
          <image class="service-icon" src="/static/icons/ic_settings.png" mode="aspectFit"></image>
          <text class="service-label">管理后台</text>
        </view>
        <view class="service-item" @tap="onServiceTap('订单处理')">
          <image class="service-icon" src="/static/icons/ic_settings.png" mode="aspectFit"></image>
          <text class="service-label">订单处理</text>
        </view>
        <view class="service-item" @tap="onServiceTap('设备连接')">
          <image class="service-icon" src="/static/icons/ic_settings.png" mode="aspectFit"></image>
          <text class="service-label">设备连接</text>
        </view>
        <view class="service-item" @tap="onServiceTap('设备调试')">
          <image class="service-icon" src="/static/icons/ic_one_click_listing.png" mode="aspectFit"></image>
          <text class="service-label">设备调试</text>
        </view>
        <view class="service-item" @tap="onServiceTap('设备连接2')">
          <image class="service-icon" src="/static/icons/ic_settings.png" mode="aspectFit"></image>
          <text class="service-label">设备连接2</text>
        </view>
      </view>
    </view>

    <!-- 服务器地址 -->
    <view class="server-addr-bar" @tap="onServerBarTap">
      <view class="server-row">
        <text class="server-label">电脑端</text>
        <text class="server-addr" selectable>{{ pcAddr }}</text>
      </view>
      <view class="server-row">
        <text class="server-label">手机端</text>
        <text class="server-addr" selectable>{{ mobileAddr }}</text>
      </view>
      <text class="server-edit-tip">点击修改服务器地址 ›</text>
    </view>


    <!-- 拍照按钮 -->
    <view class="camera-btn" @tap="onCameraTap">
      <image class="camera-icon" src="/static/icons/ic_camera.png" mode="aspectFit"></image>
    </view>

  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getUserProfile } from '@/api/index.js'

const userName = ref('登录/注册')
const userId = ref('ID:')
const userRole = ref('')
const userAvatar = ref('/static/icons/avatar.png')

// 从本地存储加载用户信息
const loadFromStorage = () => {
  const user = uni.getStorageSync('user')
  if (user) {
    if (user.nickname) userName.value = user.nickname
    if (user.id) userId.value = 'ID:' + user.id
    if (user.role) userRole.value = user.role
    if (user.avatar) userAvatar.value = user.avatar
  }
}

// 从服务器获取最新用户信息
const fetchProfile = async () => {
  const token = uni.getStorageSync('token')
  if (!token) {
    // 未登录，重置为默认值
    userName.value = '登录/注册'
    userId.value = 'ID:'
    userAvatar.value = '/static/icons/avatar.png'
    return
  }

  // 先从本地加载（即时显示），再从服务器刷新
  loadFromStorage()

  try {
    const data = await getUserProfile()
    if (data.nickname) userName.value = data.nickname
    if (data.id) userId.value = 'ID:' + data.id
    if (data.role) userRole.value = data.role
    if (data.avatar) userAvatar.value = data.avatar
    // 同步最新数据到本地存储
    const stored = uni.getStorageSync('user') || {}
    uni.setStorageSync('user', { ...stored, ...data })
  } catch (e) {
    // 请求失败时使用本地缓存（已在 loadFromStorage 中加载）
  }
}

// 页面每次显示时刷新（包括从登录页返回）
onShow(() => {
  fetchProfile()
})

const onLoginTap = () => {
  uni.navigateTo({ url: '/pages/login/login' })
}

const onAvatarTap = () => {
  uni.chooseImage({
    count: 1,
    sourceType: ['album'],
    success: (res) => {
      const token = uni.getStorageSync('token')
      uni.uploadFile({
        url: '/v1/api/user/avatar',
        filePath: res.tempFilePaths[0],
        name: 'avatar',
        header: { 'Authorization': 'Bearer ' + (token || '') },
        success: (uploadRes) => {
          if (uploadRes.statusCode === 200) {
            const data = JSON.parse(uploadRes.data)
            userAvatar.value = data.avatar + '?t=' + Date.now()
            const stored = uni.getStorageSync('user') || {}
            stored.avatar = data.avatar
            uni.setStorageSync('user', stored)
            uni.showToast({ title: '头像已更新', icon: 'success', duration: 1500 })
          }
        },
        fail: () => uni.showToast({ title: '上传失败', icon: 'none' })
      })
    }
  })
}

const onServiceTap = (name) => {
  if (name === '识别上传') {
    uni.navigateTo({ url: '/pages/upload/upload' })
  } else if (name === '批量识别') {
    uni.navigateTo({ url: '/pages/upload/batch-recognize' })
  } else if (name === '一键上架') {
    uni.navigateTo({ url: '/pages/auto-listing/auto-listing' })
  } else if (name === '库存管理') {
    uni.navigateTo({ url: '/pages/inventory/inventory' })
  } else if (name === '管理后台') {
    uni.navigateTo({ url: '/pages/admin/dashboard' })
  } else if (name === '订单处理') {
    uni.navigateTo({ url: '/pages/order/order-processing' })
  } else if (name === '设备连接') {
    uni.navigateTo({ url: '/pages/device/connect' })
  } else if (name === '设备调试') {
    uni.navigateTo({ url: '/pages/device/test' })
  } else if (name === '设备连接2') {
    uni.navigateTo({ url: '/pages/device/connect2' })
  } else {
    uni.showToast({ title: name + '（即将上线）', icon: 'none', duration: 1500 })
  }
}

const pcAddr = computed(() => window.location.origin)
const mobileAddr = computed(() => {
  // 手机上直接用当前 URL，电脑上显示局域网地址
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1') {
    const ip = uni.getStorageSync('lan_ip') || '192.168.0.105'
    return 'http://' + ip + ':' + window.location.port
  }
  return window.location.origin
})

const onCameraTap = () => {
  console.log('拍照')
}

// 点击服务器地址栏 → 进入服务器设置页 (APP 手动改地址, IP 变了不用重打包)
const onServerBarTap = () => {
  uni.navigateTo({ url: '/pages/settings/server' })
}

// 管理员入口：双击设置图标进入管理后台
let settingsTapCount = 0
let settingsTapTimer = null
const onSettingsTap = () => {
  settingsTapCount++
  if (settingsTapCount >= 3) {
    settingsTapCount = 0
    if (settingsTapTimer) clearTimeout(settingsTapTimer)
    uni.navigateTo({ url: '/pages/login/login' })
    return
  }
  if (settingsTapTimer) clearTimeout(settingsTapTimer)
  settingsTapTimer = setTimeout(() => {
    settingsTapCount = 0
  }, 800)
}
</script>

<style scoped>
/* ========== 页面容器 ========== */
.page-container {
  background-color: #F5F5F7;
  padding: 20px;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  padding-bottom: 120px;
  box-sizing: border-box;
}

/* ========== 个人信息区（无白色底板） ========== */
.profile-section {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: flex-start;
  padding: 4px 0;
  margin-bottom: 16px;
}

.profile-left {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.avatar {
  width: 80px;
  height: 80px;
  border-radius: 40px;
  background-color: #E8E8E8;
  flex-shrink: 0;
}

.user-info {
  margin-left: 12px;
  display: flex;
  flex-direction: column;
}

.user-name {
  font-size: 18px;
  font-weight: bold;
  color: #1A1A1A;
}

.user-id-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 4px;
}
.user-id {
  font-size: 12px;
  color: #999999;
  line-height: 1;
}
.role-badge {
  font-size: 10px;
  color: #FFF;
  background: #FF0000;
  padding: 1px 5px;
  border-radius: 6px;
  font-weight: 500;
  line-height: 1.2;
}


/* 设置图标 + 灰色圆底 */
.settings-circle {
  width: 36px;
  height: 36px;
  border-radius: 18px;
  background-color: #EEEEEE;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: -4px;
}

.settings-icon {
  width: 20px;
  height: 20px;
}

/* ========== 卡片通用 ========== */
.card {
  background-color: #FFFFFF;
  border-radius: 20px;
  padding: 16px;
  margin-bottom: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}

/* ========== 应用服务区 ========== */
.services-card {
  margin-top: 0;
}

.section-title {
  font-size: 16px;
  font-weight: 500;
  color: #333333;
  margin-bottom: 10px;
  display: block;
}

.services-grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;          /* 按内容宽度排布，放不下自动换行 */
  justify-content: flex-start;
  gap: 8px;                 /* 行列间距 */
}

.service-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.service-icon {
  width: 30px;
  height: 30px;
}

.service-label {
  font-size: 10px;
  color: #666666;
  margin-top: 2px;
}

/* 服务器地址 */
.server-addr-bar { margin-top: 12px; padding: 0 4px; }
.server-row { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
.server-label { font-size: 11px; color: #999; min-width: 36px; }
.server-addr { font-size: 12px; color: #FF0000; font-weight: 500; user-select: text; }
.server-edit-tip { display: block; font-size: 11px; color: #999; margin-top: 4px; }


/* ========== 拍照按钮 ========== */
.camera-btn {
  position: fixed;
  bottom: 35px;
  left: 50%;
  transform: translateX(-50%);
  width: 56px;
  height: 56px;
  border-radius: 28px;
  background-color: #FF0000;
  box-shadow: 0 4px 12px rgba(255, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.camera-icon {
  width: 23px;
  height: 23px;
}
</style>
