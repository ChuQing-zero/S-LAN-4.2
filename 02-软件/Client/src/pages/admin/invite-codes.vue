<template>
  <view class="page-container">
    <view class="topbar">
      <view class="tbtn" @tap="goBack"><image class="timg" src="/static/icons/ic_back.png" mode="aspectFit" /></view>
      <text class="ttl">邀请码管理</text>
      <view class="tbtn-placeholder"></view>
    </view>

    <view class="stats-row">
      <view class="stat-box">
        <text class="stat-num">{{ total }}</text>
        <text class="stat-label">全部</text>
      </view>
      <view class="stat-box">
        <text class="stat-num green">{{ unused }}</text>
        <text class="stat-label">未使用</text>
      </view>
      <view class="stat-box">
        <text class="stat-num gray">{{ used }}</text>
        <text class="stat-label">已使用</text>
      </view>
      <view class="create-btn" @tap="openCreate"><text>＋ 新建邀请码</text></view>
    </view>

    <view class="tips-box">
      <text class="tips-text">注册需要邀请码。留空自动生成，已使用的邀请码不可再改。</text>
    </view>

    <scroll-view class="content" scroll-y="true">
      <view class="code-card" v-for="c in list" :key="c._id">
        <view class="code-main">
          <view class="code-row">
            <text class="code-text" :class="c.used ? 'dim' : ''">{{ c.code }}</text>
            <text class="status-chip" :class="c.used ? 'st-used' : 'st-unused'">
              {{ c.used ? '已使用' : '未使用' }}
            </text>
          </view>
          <view class="code-sub">
            <text v-if="c.used">使用人: {{ userNameMap[c.usedBy] || c.usedBy }} · {{ fmtTime(c.usedAt) }}</text>
            <text v-else>创建于 {{ fmtTime(c.createdAt) }}</text>
          </view>
        </view>
        <view class="code-actions">
          <view class="act-btn" v-if="!c.used" @tap="openEdit(c)"><text>更改</text></view>
          <view class="act-btn del" @tap="onDelete(c)"><text>删除</text></view>
        </view>
      </view>
      <view v-if="!list.length" class="empty-tip">还没有邀请码</view>
      <view class="footer-space"></view>
    </scroll-view>

    <!-- 新建/编辑弹窗 -->
    <view v-if="modal" class="modal-mask" @tap.self="modal = false">
      <view class="modal-card">
        <view class="modal-head">
          <text class="modal-title">{{ modalMode === 'create' ? '新建邀请码' : '更改邀请码' }}</text>
          <view class="modal-close" @tap="modal = false"><text>✕</text></view>
        </view>
        <view class="field">
          <text class="field-label">{{ modalMode === 'create' ? '邀请码（留空自动生成）' : '新邀请码' }}</text>
          <input class="field-input" v-model="modalCode" placeholder="如 SLAN-XXXXXX" :maxlength="32" />
        </view>
        <view class="modal-foot">
          <view class="mod-btn cancel" @tap="modal = false"><text>取消</text></view>
          <view class="mod-btn save" @tap="onSave"><text>保存</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { getInviteCodes, createInviteCode, updateInviteCode, deleteInviteCode, getAccounts } from '@/api/index.js'

const list = ref([])
const total = ref(0)
const used = ref(0)
const unused = ref(0)
const userNameMap = ref({})

const modal = ref(false)
const modalMode = ref('create') // create | edit
const modalCode = ref('')
const editingId = ref('')

const fmtTime = (t) => {
  if (!t) return ''
  const d = new Date(t)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const load = async () => {
  try {
    const d = await getInviteCodes()
    list.value = d.list || []
    total.value = d.total || 0
    used.value = d.used || 0
    unused.value = d.unused || 0
  } catch (e) {
    uni.showToast({ title: e.message || '读取邀请码失败', icon: 'none' })
    if (String(e.message || '').includes('Terminal') || String(e.message || '').includes('终端')) {
      setTimeout(() => uni.reLaunch({ url: '/pages/admin/account-admin' }), 1200)
    }
  }
}

// 使用者 ID → 昵称（尽力映射，失败则显示 ID）
const loadUsers = async () => {
  try {
    const d = await getAccounts()
    const m = {}
    ;(d.list || []).forEach(u => { m[u.id] = u.nickname })
    userNameMap.value = m
  } catch (_) {}
}

const openCreate = () => {
  modalMode.value = 'create'
  modalCode.value = ''
  editingId.value = ''
  modal.value = true
}

const openEdit = (c) => {
  modalMode.value = 'edit'
  modalCode.value = c.code
  editingId.value = c._id
  modal.value = true
}

const onSave = async () => {
  const code = modalCode.value.trim()
  try {
    if (modalMode.value === 'create') {
      const d = await createInviteCode({ code })
      uni.showToast({ title: d.invite?.code ? `已生成 ${d.invite.code}` : '已生成', icon: 'success' })
    } else {
      await updateInviteCode(editingId.value, { code })
      uni.showToast({ title: '已更改', icon: 'success' })
    }
    modal.value = false
    load()
  } catch (err) {
    uni.showToast({ title: err.message || '操作失败', icon: 'none' })
  }
}

const onDelete = (c) => {
  uni.showModal({
    title: '删除邀请码',
    content: `确定删除邀请码 ${c.code} 吗？删除后该码将无法使用。`,
    confirmText: '删除',
    confirmColor: '#FF0000',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await deleteInviteCode(c._id)
        uni.showToast({ title: '已删除', icon: 'success' })
        load()
      } catch (err) {
        uni.showToast({ title: err.message || '删除失败', icon: 'none' })
      }
    }
  })
}

const goBack = () => uni.reLaunch({ url: '/pages/admin/account-admin' })

load()
loadUsers()
</script>

<style scoped>
* { box-sizing: border-box; }
.page-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #F5F5F7;
}
.topbar {
  background: #FFFFFF;
  padding: 14px 16px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  flex-shrink: 0;
}
.tbtn {
  width: 32px;
  height: 32px;
  border-radius: 16px;
  background: #F0F0F0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.timg { width: 18px; height: 18px; }
.ttl {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 16px;
  font-weight: 500;
  color: #1A1A1A;
}
.tbtn-placeholder { width: 32px; }

/* 统计 + 新建 */
.stats-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 12px 16px 0;
}
.stat-box {
  background: #FFFFFF;
  border-radius: 10px;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 64px;
}
.stat-num { font-size: 18px; font-weight: 700; color: #1A1A1A; line-height: 1.2; }
.stat-num.green { color: #22C55E; }
.stat-num.gray { color: #999; }
.stat-label { font-size: 11px; color: #999; margin-top: 2px; }
.create-btn {
  flex: 1;
  height: 40px;
  border-radius: 10px;
  background: #1660C6;
  display: flex;
  align-items: center;
  justify-content: center;
}
.create-btn text { font-size: 13px; font-weight: 500; color: #FFF; }

.tips-box {
  background: #E8F0FE;
  border-radius: 10px;
  padding: 10px 12px;
  margin: 12px 16px 0;
}
.tips-text {
  display: block;
  font-size: 12px;
  color: #1660C6;
  line-height: 1.6;
}

.content { flex: 1; padding: 12px 16px; }
.code-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #FFFFFF;
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 10px;
}
.code-main { flex: 1; overflow: hidden; }
.code-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.code-text {
  font-size: 15px;
  font-weight: 600;
  color: #1A1A1A;
  font-family: monospace;
  letter-spacing: 0.5px;
}
.code-text.dim { color: #AAA; }
.status-chip { padding: 2px 8px; border-radius: 8px; flex-shrink: 0; }
.status-chip text { font-size: 11px; font-weight: 500; }
.st-unused { background: rgba(34,197,94,0.14); }
.st-unused text { color: #22C55E; }
.st-used { background: rgba(153,153,153,0.18); }
.st-used text { color: #999; }
.code-sub {
  display: block;
  font-size: 11px;
  color: #999;
  margin-top: 4px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.code-actions {
  display: flex;
  flex-direction: row;
  gap: 6px;
  flex-shrink: 0;
}
.act-btn {
  padding: 6px 12px;
  border-radius: 8px;
  background: #F0F0F0;
}
.act-btn text { font-size: 12px; color: #1660C6; }
.act-btn.del { background: rgba(255,0,0,0.08); }
.act-btn.del text { color: #FF0000; }
.empty-tip { text-align: center; color: #AAA; font-size: 13px; padding: 40px 0; }
.footer-space { height: 30px; }

/* 弹窗 */
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}
.modal-card {
  width: 86%;
  background: #FFFFFF;
  border-radius: 16px;
  padding: 16px;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.modal-title { font-size: 16px; font-weight: 600; color: #1A1A1A; }
.modal-close {
  width: 28px;
  height: 28px;
  border-radius: 14px;
  background: #F0F0F0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal-close text { font-size: 14px; color: #666; }
.field { margin-bottom: 14px; }
.field-label {
  display: block;
  font-size: 12px;
  color: #666;
  margin-bottom: 6px;
}
.field-input {
  width: 100%;
  height: 40px;
  background: #F5F5F7;
  border-radius: 8px;
  padding: 0 12px;
  font-size: 14px;
  color: #1A1A1A;
}
.modal-foot {
  display: flex;
  flex-direction: row;
  gap: 10px;
}
.mod-btn {
  flex: 1;
  height: 42px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mod-btn text { font-size: 14px; font-weight: 500; }
.mod-btn.cancel { background: #F0F0F0; }
.mod-btn.cancel text { color: #666; }
.mod-btn.save { background: #1660C6; }
.mod-btn.save text { color: #FFF; }
</style>
