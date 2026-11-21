<template>
  <view class="page">
    <view class="topbar">
      <view class="tbtn" @tap="goBack"><image class="timg" src="/static/icons/ic_back.png" mode="aspectFit" /></view>
      <text class="ttl">后台管理</text>
    </view>

    <view class="body">
      <view class="card" @tap="goVersionManager">
        <view class="card-icon">📋</view>
        <view class="card-info">
          <text class="card-title">后台版本管理</text>
          <text class="card-desc">版本设置 · 罕贵度 · 品相 · 备注</text>
        </view>
        <text class="card-arrow">›</text>
      </view>

      <view class="card" @tap="goStockCodes">
        <view class="card-icon">📦</view>
        <view class="card-info">
          <text class="card-title">库存编号管理</text>
          <text class="card-desc">编号池创建 · 调度 · 管理</text>
        </view>
        <text class="card-arrow">›</text>
      </view>

      <view class="card" @tap="goImageCache">
        <view class="card-icon">🖼️</view>
        <view class="card-info">
          <text class="card-title">图片缓存管理</text>
          <text class="card-desc">订单拍照留痕 · 原图缓存清理</text>
        </view>
        <text class="card-arrow">›</text>
      </view>

      <view class="card" @tap="goApiKeys">
        <view class="card-icon">🔑</view>
        <view class="card-info">
          <text class="card-title">AI识别管理</text>
          <text class="card-desc">用量信息 · API钥匙 · 充值</text>
        </view>
        <text class="card-arrow">›</text>
      </view>

      <view class="card" @tap="goTcgPaths">
        <view class="card-icon">🗂️</view>
        <view class="card-info">
          <text class="card-title">图源设置</text>
          <text class="card-desc">TCG 卡图目录 · 详细/保底/缩略图/ID数据</text>
        </view>
        <text class="card-arrow">›</text>
      </view>

      <!-- 「异画标签」这一页从 V1.2.39 起撤掉了。原因：卡牌编号目录改成「一行 = 一个
           (编号, 罕贵度, 后缀序号)」之后，「罕贵度 + 后缀序号」本身就是一行的主键，
           标签直接落成行上的 `altLabel` 一列，在目录页那一格里填 —— 不必再单开一页
           按 `罕贵|序号` 拼键去对（那套键拆行之后就再也拼不准了）。 -->

      <view class="card" @tap="goBackupManager">
        <view class="card-icon">💾</view>
        <view class="card-info">
          <text class="card-title">备份管理</text>
          <text class="card-desc">数据库备份 · 恢复 · 删除</text>
        </view>
        <text class="card-arrow">›</text>
      </view>

      <!-- 账号管理：仅终端管理员可见 -->
      <view class="card" v-if="myRole === 'terminal_admin'" @tap="goAccountAdmin">
        <view class="card-icon">👤</view>
        <view class="card-info">
          <text class="card-title">账号管理</text>
          <text class="card-desc">查看/修改全部账号 · 姓名/ID/头像/身份</text>
        </view>
        <text class="card-arrow">›</text>
      </view>

      <view class="card" @tap="goTaskList">
        <view class="card-icon">📋</view>
        <view class="card-info">
          <text class="card-title">任务清单</text>
          <text class="card-desc">待人工处理的记录 · 编号错误/待核对</text>
        </view>
        <text class="card-arrow">›</text>
      </view>

      <view class="card" @tap="goCardMarks">
        <view class="card-icon">📝</view>
        <view class="card-info">
          <text class="card-title">卡牌信息记录</text>
          <text class="card-desc">上传页点过「信息登记」的编号 · 卡名错/卡图错，处理完删掉</text>
        </view>
        <text class="card-arrow">›</text>
      </view>

      <view class="card" @tap="goCardLibrary">
        <view class="card-icon">📚</view>
        <view class="card-info">
          <text class="card-title">卡牌资料库</text>
          <text class="card-desc">唯一目录 · 官方名核对 · 待处理</text>
        </view>
        <text class="card-arrow">›</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'

const myRole = ref('')
// 页面每次显示刷新角色（账号管理入口仅终端管理员可见）
onShow(() => {
  myRole.value = uni.getStorageSync('user')?.role || ''
})

const goBack = () => uni.reLaunch({ url: '/pages/index/index' })
const goVersionManager = () => uni.navigateTo({ url: '/pages/admin/version-manager' })
const goStockCodes = () => uni.navigateTo({ url: '/pages/admin/stock-codes-admin' })
const goImageCache = () => uni.navigateTo({ url: '/pages/admin/image-cache' })
const goApiKeys = () => uni.navigateTo({ url: '/pages/admin/api-keys' })
const goTcgPaths = () => uni.navigateTo({ url: '/pages/admin/tcg-paths' })
const goBackupManager = () => uni.navigateTo({ url: '/pages/admin/backup-manager' })
const goAccountAdmin = () => uni.navigateTo({ url: '/pages/admin/account-admin' })
const goTaskList = () => uni.navigateTo({ url: '/pages/admin/task-list' })
const goCardMarks = () => uni.navigateTo({ url: '/pages/admin/card-marks' })
const goCardLibrary = () => uni.navigateTo({ url: '/pages/admin/card-library' })
</script>

<style scoped>
*{box-sizing:border-box}
.page{display:flex;flex-direction:column;height:100vh;background:#F5F5F7}
.topbar{background:#FFF;padding:14px 16px 12px;display:flex;align-items:center;position:relative;flex-shrink:0}
.tbtn{width:32px;height:32px;border-radius:16px;background:#F0F0F0;display:flex;align-items:center;justify-content:center}
.timg{width:18px;height:18px}
.ttl{font-size:15px;font-weight:500;color:#1A1A1A;position:absolute;left:50%;transform:translateX(-50%)}
.body{flex:1;overflow-y:auto;padding:16px}
.card{background:#FFF;border-radius:12px;padding:16px;margin-bottom:10px;display:flex;align-items:center;gap:12px}
.card.wip{opacity:0.4}
.card-icon{font-size:24px;width:40px;text-align:center}
.card-info{flex:1}
.card-title{font-size:15px;font-weight:500;color:#1A1A1A;display:block}
.card-desc{font-size:12px;color:#999;margin-top:2px;display:block}
.card-arrow{font-size:24px;color:#CCC}
</style>
