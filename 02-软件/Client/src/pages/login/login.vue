<template>
  <view class="page-container">
    <!-- 登录/注册表单卡片 -->
    <view class="card form-card">
      <!-- 切换标签 -->
      <view class="tab-row">
        <view
          class="tab-item"
          :class="{ active: mode === 'login' }"
          @tap="switchMode('login')"
        >
          <text class="tab-text">登录</text>
        </view>
        <view
          class="tab-item"
          :class="{ active: mode === 'register' }"
          @tap="switchMode('register')"
        >
          <text class="tab-text">注册</text>
        </view>
      </view>

      <!-- 昵称（仅注册） -->
      <view class="input-group" v-if="mode === 'register'">
        <text class="input-label">昵称</text>
        <input
          class="input-field"
          v-model="nickname"
          type="text"
          confirm-type="done"
          placeholder="请输入昵称"
          placeholder-style="color: #CCCCCC;"
          @confirm="onSubmit"
        />
      </view>

      <!-- 邮箱 -->
      <view class="input-group">
        <text class="input-label">邮箱</text>
        <input
          class="input-field"
          v-model="email"
          type="text"
          confirm-type="done"
          placeholder="请输入邮箱"
          placeholder-style="color: #CCCCCC;"
          @confirm="onSubmit"
        />
      </view>

      <!-- 密码 -->
      <view class="input-group">
        <text class="input-label">密码</text>
        <input
          class="input-field"
          v-model="password"
          :password="!showPassword"
          confirm-type="done"
          placeholder="请输入密码"
          placeholder-style="color: #CCCCCC;"
          @confirm="onSubmit"
        />
        <view class="eye-btn" @tap="togglePassword">
          <text class="eye-text">{{ showPassword ? '隐藏' : '显示' }}</text>
        </view>
      </view>

      <!-- 邀请码（仅注册） -->
      <view class="input-group" v-if="mode === 'register'">
        <text class="input-label">邀请码</text>
        <input
          class="input-field"
          v-model="inviteCode"
          type="text"
          confirm-type="done"
          placeholder="请输入邀请码"
          placeholder-style="color: #CCCCCC;"
          @confirm="onSubmit"
        />
      </view>

      <!-- 提交按钮 -->
      <view class="submit-btn" :class="{ 'submit-btn--loading': loading }" @tap="onSubmit">
        <text class="submit-text">{{ loading ? '请稍候...' : (mode === 'login' ? '登 录' : '注 册') }}</text>
      </view>

      <!-- 底部切换提示 -->
      <view class="toggle-hint" @tap="switchMode(mode === 'login' ? 'register' : 'login')">
        <text class="hint-text">
          {{ mode === 'login' ? '没有账号？立即注册' : '已有账号？返回登录' }}
        </text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { login, register } from '@/api/index.js'
import { getAllVersionConfigs } from '@/api/admin.js'
import { goBack as navBack } from '@/utils/nav.js'

const mode = ref('login')
const nickname = ref('')
const email = ref('')
const password = ref('')
const inviteCode = ref('')
const showPassword = ref(false)
const loading = ref(false)

const switchMode = (m) => {
  mode.value = m
}

const togglePassword = () => {
  showPassword.value = !showPassword.value
}

const onSubmit = async () => {
  if (loading.value) return

  if (mode.value === 'register' && !nickname.value.trim()) {
    uni.showToast({ title: '请输入昵称', icon: 'none', duration: 1500 })
    return
  }
  if (!email.value.trim()) {
    uni.showToast({ title: '请输入邮箱', icon: 'none', duration: 1500 })
    return
  }
  if (!password.value.trim()) {
    uni.showToast({ title: '请输入密码', icon: 'none', duration: 1500 })
    return
  }
  if (mode.value === 'register' && !inviteCode.value.trim()) {
    uni.showToast({ title: '请输入邀请码', icon: 'none', duration: 1500 })
    return
  }

  loading.value = true

  try {
    if (mode.value === 'login') {
      // 1. 先尝试普通用户登录
      const res = await login({
        email: email.value.trim(),
        password: password.value.trim()
      })
      uni.setStorageSync('token', res.token)
      uni.setStorageSync('user', res.user)

      // 2. 尝试管理员检测（静默设置 adminToken，不改变跳转）
      tryAdminLogin()

      uni.showToast({ title: '登录成功', icon: 'success', duration: 1500 })
      goHome()
    } else {
      // 注册
      const res = await register({
        nickname: nickname.value.trim(),
        email: email.value.trim(),
        password: password.value.trim(),
        inviteCode: inviteCode.value.trim()
      })
      uni.setStorageSync('token', res.token)
      uni.setStorageSync('user', res.user)
      uni.showToast({ title: '注册成功', icon: 'success', duration: 1500 })
      goHome()
    }
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}

// 检测当前用户是否为管理员
// 管理员登录用的是普通登录接口，后台根据用户 role 判断权限
// 能成功调用 admin API 说明是管理员
const tryAdminLogin = async () => {
  try {
    // 用当前登录的 token 作为 adminToken 去调 admin 接口
    const token = uni.getStorageSync('token')
    uni.setStorageSync('adminToken', token)
    await getAllVersionConfigs()
    // 调用成功 → 是管理员
    uni.setStorageSync('adminUser', { username: email.value.trim() })
    return true
  } catch (e) {
    // 不是管理员，清除临时 adminToken
    uni.removeStorageSync('adminToken')
    return false
  }
}

const goHome = () => {
  setTimeout(() => navBack('/pages/index/index'), 1500)
}
</script>

<style scoped>
/* ========== 页面容器 ========== */
.page-container {
  background-color: #F5F5F7;
  padding: 40px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100vh;
  box-sizing: border-box;
}


/* ========== 卡片 ========== */
.card {
  background-color: #FFFFFF;
  border-radius: 20px;
  padding: 24px 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  width: 100%;
  box-sizing: border-box;
}

/* ========== 切换标签 ========== */
.tab-row {
  display: flex;
  flex-direction: row;
  margin-bottom: 24px;
  border-bottom: 2px solid #F0F0F0;
}

.tab-item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-bottom: 10px;
  position: relative;
}

.tab-item.active::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 50%;
  transform: translateX(-50%);
  width: 40px;
  height: 3px;
  border-radius: 2px;
  background-color: #FF0000;
}

.tab-text {
  font-size: 16px;
  color: #999999;
}

.tab-item.active .tab-text {
  color: #FF0000;
  font-weight: bold;
}

/* ========== 输入区 ========== */
.input-group {
  margin-bottom: 16px;
  position: relative;
}

.input-label {
  font-size: 14px;
  color: #333333;
  margin-bottom: 8px;
  display: block;
}

.input-field {
  width: 100%;
  height: 48px;
  background-color: #F5F5F7;
  border-radius: 12px;
  padding: 0 16px;
  font-size: 14px;
  color: #1A1A1A;
  box-sizing: border-box;
}

.eye-btn {
  position: absolute;
  right: 14px;
  bottom: 12px;
}

.eye-text {
  font-size: 12px;
  color: #999999;
}

/* ========== 提交按钮 ========== */
.submit-btn {
  width: 100%;
  height: 48px;
  background-color: #FF0000;
  border-radius: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 24px;
  box-shadow: 0 4px 12px rgba(255, 0, 0, 0.25);
}

.submit-btn--loading {
  opacity: 0.6;
  pointer-events: none;
}

.submit-text {
  font-size: 16px;
  font-weight: 500;
  color: #FFFFFF;
}

/* ========== 底部切换 ========== */
.toggle-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 18px;
}

.hint-text {
  font-size: 13px;
  color: #FF0000;
}
</style>
