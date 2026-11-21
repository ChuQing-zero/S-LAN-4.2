<template>
  <view class="page">
    <view class="topbar">
      <view class="tbtn" @tap="goBack"><image class="timg" src="/static/icons/ic_back.png" mode="aspectFit" /></view>
      <text class="ttl">卡牌信息记录</text>
      <text class="tcount">{{ list.length }} 个包 · {{ totalCodes }} 条记录</text>
    </view>

    <scroll-view class="content" scroll-y="true">
      <view v-if="loading" class="hint">加载中...</view>
      <view v-else-if="list.length === 0" class="hint">
        <text class="hint-line">还没有登记过任何编号</text>
        <text class="hint-line">编号在目录里查不到时会自动记一条，</text>
        <text class="hint-line">上传页点卡片行那个蓝色「信息登记」块也会记一条</text>
      </view>

      <!-- 一层：包。点进去看这个包里的编号记录。
           包是从记录里现聚出来的，所以一个编号都没有的包根本不会出现在这里。 -->
      <view v-for="it in list" :key="it.codePrefix" class="pk-card" @tap="onOpen(it)">
        <view class="pk-left">
          <text class="pk-name">{{ it.codePrefix }}</text>
          <text class="pk-time">最近登记 {{ fmtTime(it.lastMarkedAt) }}</text>
        </view>
        <text class="pk-count">{{ it.count }} 条记录</text>
        <text class="pk-arrow">›</text>
      </view>

      <view class="footer-space"></view>
    </scroll-view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getCardMarkPrefixes } from '@/api/index.js'
import { goBack as navBack } from '@/utils/nav.js'

const list = ref([])
const loading = ref(true)

// 标题右边那个「N 个包 · M 个编号」——M 就是各包的编号数加起来
const totalCodes = computed(() => list.value.reduce((s, x) => s + (x.count || 0), 0))

// 每次显示都重拉：在二级页把某个包的最后一条删掉，返回时这个包会自动消失
const load = async () => {
  loading.value = true
  try {
    const d = await getCardMarkPrefixes()
    list.value = d.list || []
  } catch (e) {
    list.value = []
    uni.showToast({ title: '加载失败：' + (e.message || ''), icon: 'none' })
  }
  loading.value = false
}
onShow(load)

const fmtTime = (t) => {
  if (!t) return '—'
  const d = new Date(t)
  if (isNaN(d.getTime())) return '—'
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const onOpen = (it) => {
  uni.navigateTo({ url: '/pages/admin/card-marks-pack?prefix=' + encodeURIComponent(it.codePrefix) })
}

// 上一页是后台管理；刷新过就直接回后台管理（见 utils/nav.js 里的说明）
const goBack = () => navBack('/pages/admin/dashboard')
</script>

<style scoped>
* { box-sizing: border-box; }
.page { display: flex; flex-direction: column; height: 100vh; background: #F5F5F7; }
.topbar { background: #FFF; padding: 14px 16px 12px; display: flex; align-items: center; position: relative; flex-shrink: 0; }
.tbtn { width: 32px; height: 32px; border-radius: 16px; background: #F0F0F0; display: flex; align-items: center; justify-content: center; }
.timg { width: 18px; height: 18px; }
.ttl { position: absolute; left: 50%; transform: translateX(-50%); font-size: 16px; font-weight: 500; color: #1A1A1A; }
.tcount { margin-left: auto; font-size: 12px; color: #999; }

.content { flex: 1; padding: 14px 16px; }
.hint { text-align: center; color: #999; font-size: 13px; line-height: 2; padding: 40px 0; }
.hint-line { display: block; }

.pk-card { background: #FFF; border-radius: 12px; padding: 16px 14px; margin-bottom: 10px; display: flex; align-items: center; gap: 10px; }
.pk-left { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.pk-name { font-size: 17px; font-weight: 600; color: #1A1A1A; letter-spacing: 0.5px; word-break: break-all; }
.pk-time { font-size: 11px; color: #BBB; }
.pk-count { flex-shrink: 0; font-size: 13px; color: #1660C6; font-weight: 500; }
.pk-arrow { flex-shrink: 0; font-size: 18px; color: #CCC; line-height: 1; }

.footer-space { height: 30px; }
</style>
