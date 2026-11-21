<template>
  <view class="page">
    <view class="topbar">
      <view class="tbtn" @tap="goBack"><image class="timg" src="/static/icons/ic_back.png" mode="aspectFit" /></view>
      <text class="ttl">任务清单</text>
      <view class="tbtn-entry" @tap="onCreate"><text class="tbtn-entry-text">＋ 新增</text></view>
    </view>

    <!-- 状态筛选 -->
    <view class="tabs">
      <view v-for="t in TABS" :key="t.key" class="tab" @tap="tab = t.key">
        <text class="tab-text" :class="{ 'tab-text-on': tab === t.key }">{{ t.label }} {{ counts[t.key] || 0 }}</text>
        <view v-if="tab === t.key" class="tab-line"></view>
      </view>
    </view>

    <scroll-view class="content" scroll-y="true">
      <view v-if="loading" class="loading">加载中...</view>
      <view v-else-if="list.length === 0" class="empty">这里还没有记录</view>

      <view v-for="it in list" :key="it._id" class="tk-card">
        <view class="tk-head">
          <text class="tk-title">{{ it.title }}</text>
          <view class="tk-status" :class="'st-' + it.status" @tap="onPickStatus(it)">
            <text class="tk-status-text">{{ STATUS_ZH[it.status] || it.status }}</text>
          </view>
        </view>

        <view class="tk-meta">
          <text class="tk-tag">{{ it.category }}</text>
          <text v-if="it.packCode" class="tk-tag tk-tag-pack">{{ it.packCode }}</text>
          <!-- 挂在卡包上的任务：实时回显这个包现在的编号状态 -->
          <text v-if="it.packState" class="tk-pack-state" :class="{ 'tk-pack-ok': it.packState.fixed }">
            目录 {{ it.packState.padded }}/{{ it.packState.total }} 已补三位{{ it.packState.fixed ? ' ✅' : '' }}
          </text>
        </view>

        <text v-if="it.detail" class="tk-detail">{{ it.detail }}</text>

        <textarea
          class="tk-note"
          :value="it.note"
          placeholder="写点备注（改完自动保存）"
          :auto-height="true"
          @blur="(e) => onSaveNote(it, e.detail.value)"
        />

        <view class="tk-foot">
          <text class="tk-del" @tap="onDelete(it)">删除</text>
        </view>
      </view>

      <view class="footer-space"></view>
    </scroll-view>
  </view>
</template>

<script setup>
import { ref, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getTaskNotes, updateTaskNote, deleteTaskNote, createTaskNote } from '@/api/index.js'
import { goBack as navBack } from '@/utils/nav.js'

const TABS = [
  { key: 'pending', label: '待处理' },
  { key: 'doing', label: '处理中' },
  { key: 'done', label: '已完成' },
  { key: 'all', label: '全部' },
]
const STATUS_ZH = { pending: '待处理', doing: '处理中', done: '已完成' }
const NEXT = { pending: 'doing', doing: 'done', done: 'pending' }

const tab = ref('pending')
const list = ref([])
const counts = ref({})
const loading = ref(true)

const load = async () => {
  loading.value = true
  try {
    const d = await getTaskNotes({ status: tab.value === 'all' ? '' : tab.value, pageSize: 200 })
    list.value = d.list || []
    counts.value = d.counts || {}
  } catch (e) {
    list.value = []
    uni.showToast({ title: '加载失败：' + (e.message || ''), icon: 'none' })
  }
  loading.value = false
}
watch(tab, load)
onShow(load)

// 点状态胶囊：待处理 → 处理中 → 已完成 → 待处理
const onPickStatus = async (it) => {
  const next = NEXT[it.status] || 'pending'
  try {
    await updateTaskNote(it._id, { status: next })
    it.status = next
    if (tab.value !== 'all' && tab.value !== next) list.value = list.value.filter((x) => x._id !== it._id)
    await load()
    // load 后 counts 会刷新，但列表被重新赋值，这里不用再手动同步
  } catch (e) {
    uni.showToast({ title: '保存失败：' + (e.message || ''), icon: 'none' })
  }
}

const onSaveNote = async (it, val) => {
  if (val === it.note) return
  try {
    await updateTaskNote(it._id, { note: val })
    it.note = val
    uni.showToast({ title: '备注已保存', icon: 'none' })
  } catch (e) {
    uni.showToast({ title: '备注保存失败', icon: 'none' })
  }
}

const onDelete = (it) => {
  uni.showModal({
    title: '删除记录',
    content: `删除「${it.title}」？删除后不可找回。`,
    confirmText: '删除',
    success: async (r) => {
      if (!r.confirm) return
      try {
        await deleteTaskNote(it._id)
        list.value = list.value.filter((x) => x._id !== it._id)
        uni.showToast({ title: '已删除', icon: 'success' })
      } catch (e) {
        uni.showToast({ title: '删除失败', icon: 'none' })
      }
    },
  })
}

const onCreate = () => {
  uni.showModal({
    title: '新增任务',
    editable: true,
    placeholderText: '任务标题',
    success: async (r) => {
      if (!r.confirm || !r.content) return
      try {
        await createTaskNote({ title: r.content })
        uni.showToast({ title: '已新增', icon: 'success' })
        load()
      } catch (e) {
        uni.showToast({ title: '新增失败', icon: 'none' })
      }
    },
  })
}

const goBack = () => navBack('/pages/admin/dashboard')
</script>

<style scoped>
* { box-sizing: border-box; }
.page { display: flex; flex-direction: column; height: 100vh; background: #F5F5F7; }
.topbar { background: #FFF; padding: 14px 16px 12px; display: flex; align-items: center; justify-content: space-between; position: relative; flex-shrink: 0; }
.tbtn { width: 32px; height: 32px; border-radius: 16px; background: #F0F0F0; display: flex; align-items: center; justify-content: center; }
.timg { width: 18px; height: 18px; }
.ttl { position: absolute; left: 50%; transform: translateX(-50%); font-size: 16px; font-weight: 500; color: #1A1A1A; }
.tbtn-entry { height: 32px; border-radius: 16px; background: #1660C6; display: flex; align-items: center; justify-content: center; padding: 0 14px; }
.tbtn-entry-text { font-size: 12px; font-weight: 500; color: #FFF; }

.tabs { background: #FFF; display: flex; padding: 0 6px; flex-shrink: 0; border-bottom: 1px solid #F0F0F0; }
.tab { flex: 1; display: flex; flex-direction: column; align-items: center; padding: 10px 0 0; position: relative; }
.tab-text { font-size: 13px; color: #999; padding-bottom: 8px; }
.tab-text-on { color: #1660C6; font-weight: 500; }
.tab-line { position: absolute; bottom: 0; width: 24px; height: 2px; border-radius: 1px; background: #1660C6; }

.content { flex: 1; padding: 14px 16px; }
.loading, .empty { text-align: center; color: #999; font-size: 13px; padding: 40px 0; }

.tk-card { background: #FFF; border-radius: 12px; padding: 14px; margin-bottom: 10px; }
.tk-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.tk-title { flex: 1; font-size: 15px; font-weight: 500; color: #1A1A1A; line-height: 1.4; }
.tk-status { flex-shrink: 0; height: 26px; border-radius: 13px; padding: 0 12px; display: flex; align-items: center; }
.st-pending { background: #FFF3CD; }
.st-doing { background: #E8F0FE; }
.st-done { background: #E6F7EC; }
.tk-status-text { font-size: 12px; color: #1A1A1A; }
.st-pending .tk-status-text { color: #B8860B; }
.st-doing .tk-status-text { color: #1660C6; }
.st-done .tk-status-text { color: #0E8A43; }

.tk-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.tk-tag { font-size: 11px; color: #666; background: #F5F5F7; border-radius: 4px; padding: 2px 6px; }
.tk-tag-pack { color: #1660C6; background: #E8F0FE; font-weight: 500; }
.tk-pack-state { font-size: 11px; color: #B8860B; }
.tk-pack-ok { color: #0E8A43; }

.tk-detail { display: block; font-size: 12px; color: #666; line-height: 1.7; margin-top: 10px; white-space: pre-wrap; word-break: break-all; }

.tk-note { width: 100%; min-height: 40px; margin-top: 10px; padding: 8px 10px; background: #F7F7F9; border-radius: 8px; font-size: 12px; color: #1A1A1A; line-height: 1.6; }

.tk-foot { display: flex; justify-content: flex-end; margin-top: 8px; }
.tk-del { font-size: 12px; color: #FA5151; }

.footer-space { height: 30px; }
</style>
