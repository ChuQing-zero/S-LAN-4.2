<template>
  <view class="page-container">
    <view class="topbar">
      <view class="tbtn" @tap="goBack"><image class="timg" src="/static/icons/ic_back.png" mode="aspectFit" /></view>
      <text class="ttl">账号管理</text>
      <view class="tbtn-entry" @tap="goInviteCodes"><text class="tbtn-entry-text">邀请码</text></view>
    </view>

    <view class="tips-box">
      <text class="tips-text">仅终端管理员可查看/修改全部账号。修改身份前会二次确认，请谨慎操作。</text>
    </view>

    <scroll-view class="content" scroll-y="true">
      <view class="user-card" :class="{ 'card-disabled': u.disabled }" v-for="u in users" :key="u.id" @tap="openEdit(u)">
        <image class="user-avatar" :src="u.avatar || '/static/icons/avatar.png'" mode="aspectFill" @error="onAvatarError($event, u)" />
        <view class="user-mid">
          <view class="user-name-row">
            <text class="user-name" :class="{ 'name-dim': u.disabled }">{{ u.nickname }}</text>
            <text class="role-chip" :class="'role-' + u.role">{{ roleLabel(u.role) }}</text>
            <text class="disabled-chip" v-if="u.disabled">已禁用</text>
          </view>
          <text class="user-sub">ID: {{ u.id }}</text>
          <text class="user-sub" v-if="u.email">{{ u.email }}</text>
        </view>
        <text class="user-edit">{{ u.disabled ? '恢复 ›' : '编辑 ›' }}</text>
      </view>
      <view v-if="!users.length" class="empty-tip">暂无账号</view>
      <view class="footer-space"></view>
    </scroll-view>

    <!-- 编辑弹窗 -->
    <view v-if="editModal" class="modal-mask" @tap.self="closeEdit">
      <view class="modal-card">
        <view class="modal-head">
          <text class="modal-title">编辑账号</text>
          <view class="modal-close" @tap="closeEdit"><text>✕</text></view>
        </view>

        <!-- 头像 -->
        <view class="avatar-edit" @tap="chooseAvatar">
          <image class="avatar-big" :src="editing.avatar || '/static/icons/avatar.png'" mode="aspectFill" @error="onBigAvatarError" />
          <text class="avatar-tip">点击更换头像</text>
        </view>

        <!-- 姓名 -->
        <view class="field">
          <text class="field-label">姓名</text>
          <input class="field-input" v-model="editing.nickname" placeholder="输入姓名" />
        </view>

        <!-- 邮箱 -->
        <view class="field">
          <text class="field-label">邮箱（登录账号）</text>
          <input class="field-input" v-model="editing.email" type="text" placeholder="输入邮箱" />
        </view>

        <!-- ID -->
        <view class="field">
          <text class="field-label">ID</text>
          <input class="field-input" v-model="editing.id" placeholder="输入ID" />
        </view>

        <!-- 身份 -->
        <view class="field">
          <text class="field-label">身份</text>
          <view class="role-seg">
            <view
              class="seg"
              v-for="r in roleOptions"
              :key="r.v"
              :class="editing.role === r.v ? 'on' : ''"
              @tap="editing.role = r.v"
            >
              <text>{{ r.label }}</text>
            </view>
          </view>
        </view>

        <!-- 禁用账号 -->
        <view class="field switch-field">
          <view class="switch-text">
            <text class="field-label">禁用该账号</text>
            <text class="switch-desc">禁用后无法登录，已登录也会被踢出。可随时恢复。</text>
          </view>
          <switch :checked="editing.disabled" color="#FF0000" style="transform: scale(0.8)" @change="onDisabledChange" />
        </view>

        <!-- 修改密码（需操作者当前密码确认） -->
        <view class="pwd-block">
          <text class="pwd-title">修改密码</text>
          <input class="field-input pwd-input" password v-model="newPwd" placeholder="新密码（至少 6 位）" />
          <input class="field-input pwd-input" password v-model="currentPwd" placeholder="输入你的当前密码以确认" />
          <view class="mod-btn save pwd-btn" @tap="onChangePwd"><text>确认修改密码</text></view>
          <text class="pwd-tip">{{ pwdTip }}</text>
        </view>

        <view class="modal-foot">
          <view class="mod-btn cancel" @tap="closeEdit"><text>取消</text></view>
          <view class="mod-btn save" @tap="onSave"><text>保存</text></view>
        </view>
      </view>
    </view>

    <!-- 修改确认警告 -->
    <view v-if="confirmModal" class="modal-mask">
      <view class="modal-card warn-card">
        <view class="warn-icon">⚠️</view>
        <text class="warn-title">确定要修改吗？</text>
        <view class="warn-body">
          <view class="warn-line" v-for="(d, i) in changeDesc" :key="i">
            <text class="warn-label">{{ d.label }}</text>
            <text class="warn-val"><text class="warn-old">{{ d.old }}</text> → <text class="warn-new">{{ d.new }}</text></text>
          </view>
        </view>
        <view class="modal-foot">
          <view class="mod-btn cancel" @tap="confirmModal = false"><text>取消</text></view>
          <view class="mod-btn danger" @tap="onConfirm"><text>确认修改</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { getAccounts, updateAccount, uploadAccountAvatar, changeAccountPassword } from '@/api/index.js'

const users = ref([])
const editModal = ref(false)
const confirmModal = ref(false)
const editing = ref({ id: '', nickname: '', email: '', avatar: '', role: 'user', disabled: false, _origId: '' })
const newPwd = ref('')
const currentPwd = ref('')
const pwdTip = ref('')

const roleOptions = [
  { v: 'user', label: '用户' },
  { v: 'admin', label: '管理员' },
  { v: 'terminal_admin', label: '终端管理员' },
]

const roleLabel = (r) => ({
  user: '用户', admin: '管理员', terminal_admin: '终端管理员',
}[r] || r)

// 当前登录账号（用于 ID 变更后提示重登）
const myId = uni.getStorageSync('user')?.id || ''

const load = async () => {
  try {
    const d = await getAccounts()
    users.value = d.list || []
  } catch (e) {
    uni.showToast({ title: e.message || '读取账号失败', icon: 'none' })
    // 非终端管理员 → 退回后台管理
    if (String(e.message || '').includes('Terminal') || String(e.message || '').includes('终端')) {
      setTimeout(() => uni.reLaunch({ url: '/pages/admin/dashboard' }), 1200)
    }
  }
}

const openEdit = (u) => {
  editing.value = { id: u.id, nickname: u.nickname, email: u.email || '', avatar: u.avatar || '/static/icons/avatar.png', role: u.role, disabled: !!u.disabled, _origId: u.id }
  newPwd.value = ''
  currentPwd.value = ''
  pwdTip.value = ''
  editModal.value = true
}

const closeEdit = () => { editModal.value = false }

const onDisabledChange = (e) => { editing.value.disabled = !!e.detail.value }

const onAvatarError = (e, u) => { e.target.src = '/static/icons/avatar.png' }
const onBigAvatarError = (e) => { e.target.src = '/static/icons/avatar.png' }

const chooseAvatar = () => {
  uni.chooseImage({
    count: 1,
    sourceType: ['album'],
    success: async (res) => {
      try {
        const d = await uploadAccountAvatar(editing.value._origId, res.tempFilePaths[0])
        editing.value.avatar = d.avatar + '?t=' + Date.now()
      } catch (_) {
        uni.showToast({ title: '头像上传失败', icon: 'none' })
      }
    }
  })
}

// 变更摘要（供确认弹窗展示）
const changeDesc = computed(() => {
  const o = users.value.find(u => u.id === editing.value._origId)
  const desc = []
  if (o && editing.value.nickname.trim() !== o.nickname) desc.push({ label: '姓名', old: o.nickname, new: editing.value.nickname.trim() })
  if (o && String(editing.value.email || '').trim().toLowerCase() !== (o.email || '').trim().toLowerCase()) {
    desc.push({ label: '邮箱', old: o.email, new: editing.value.email.trim() })
  }
  if (o && String(editing.value.id).trim() !== o.id) desc.push({ label: 'ID', old: o.id, new: String(editing.value.id).trim() })
  if (o && editing.value.avatar.split('?')[0] !== (o.avatar || '').split('?')[0]) desc.push({ label: '头像', old: '原头像', new: '新头像' })
  if (o && editing.value.role !== o.role) desc.push({ label: '身份', old: roleLabel(o.role), new: roleLabel(editing.value.role) })
  if (o && !!editing.value.disabled !== !!o.disabled) {
    desc.push({ label: '账号状态', old: o.disabled ? '已禁用' : '正常', new: editing.value.disabled ? '已禁用' : '恢复启用' })
  }
  return desc
})

const onSave = () => {
  const e = editing.value
  if (!e.nickname || !e.nickname.trim()) {
    uni.showToast({ title: '姓名不能为空', icon: 'none' }); return
  }
  if (!e.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email.trim())) {
    uni.showToast({ title: '邮箱格式不正确', icon: 'none' }); return
  }
  if (!e.id || !String(e.id).trim()) {
    uni.showToast({ title: 'ID不能为空', icon: 'none' }); return
  }
  if (!changeDesc.value.length) {
    uni.showToast({ title: '没有改动', icon: 'none' }); return
  }
  // 关闭编辑弹窗，弹出确认警告
  editModal.value = false
  confirmModal.value = true
}

const onConfirm = async () => {
  const e = editing.value
  const origId = e._origId
  const changedId = String(e.id).trim() !== origId
  const selfChanged = origId === myId
  confirmModal.value = false
  try {
    await updateAccount(origId, {
      nickname: e.nickname.trim(),
      email: e.email.trim(),
      id: String(e.id).trim(),
      avatar: e.avatar.split('?')[0],
      role: e.role,
      disabled: e.disabled,
    })
    uni.showToast({ title: '已修改', icon: 'success' })
    // 自己改了 ID / 身份 / 被禁用 → 退出登录
    const selfRoleChanged = e.role !== (users.value.find(u => u.id === origId)?.role)
    if (selfChanged && (changedId || selfRoleChanged || e.disabled)) {
      uni.removeStorageSync('token')
      uni.removeStorageSync('user')
      setTimeout(() => {
        uni.showModal({
          title: e.disabled ? '账号已禁用' : '需要重新登录',
          content: e.disabled ? '本账号已被禁用，无法继续使用。' : '你修改了本账号，已退出登录，请重新登录。',
          showCancel: false,
          success: () => uni.reLaunch({ url: '/pages/index/index' })
        })
      }, 800)
      return
    }
    load()
  } catch (err) {
    uni.showToast({ title: err.message || '修改失败', icon: 'none' })
  }
}

// 修改密码：需输入操作者本人当前密码确认
const onChangePwd = async () => {
  const e = editing.value
  if (!newPwd.value || newPwd.value.length < 6) {
    uni.showToast({ title: '新密码至少 6 位', icon: 'none' }); return
  }
  if (!currentPwd.value) {
    uni.showToast({ title: '请输入当前密码确认', icon: 'none' }); return
  }
  pwdTip.value = ''
  try {
    await changeAccountPassword(e._origId, { password: newPwd.value, currentPassword: currentPwd.value })
    pwdTip.value = '✓ 密码已修改'
    newPwd.value = ''
    currentPwd.value = ''
    setTimeout(() => { pwdTip.value = '' }, 2000)
  } catch (err) {
    pwdTip.value = '✗ ' + (err.message || '修改失败')
  }
}

const goBack = () => uni.reLaunch({ url: '/pages/admin/dashboard' })
const goInviteCodes = () => uni.navigateTo({ url: '/pages/admin/invite-codes' })

load()
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
.tbtn-entry {
  height: 32px;
  border-radius: 16px;
  background: #1660C6;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
}
.tbtn-entry-text { font-size: 12px; font-weight: 500; color: #FFFFFF; }
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
.user-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #FFFFFF;
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 10px;
}
.user-avatar {
  width: 46px;
  height: 46px;
  border-radius: 23px;
  background: #EEE;
  flex-shrink: 0;
}
.user-mid { flex: 1; overflow: hidden; }
.user-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.user-name {
  font-size: 15px;
  font-weight: 600;
  color: #1A1A1A;
}
.role-chip {
  font-size: 10px;
  color: #FFF;
  padding: 1px 6px;
  border-radius: 6px;
  font-weight: 500;
  line-height: 1.3;
}
.role-user { background: #999999; }
.role-admin { background: #1660C6; }
.role-terminal_admin { background: #FF0000; }
.disabled-chip {
  font-size: 10px;
  color: #FFF;
  background: #FF0000;
  padding: 1px 6px;
  border-radius: 6px;
  font-weight: 500;
  line-height: 1.3;
}
.card-disabled { background: #F0F0F2; }
.name-dim { color: #AAA; }
.user-sub {
  display: block;
  font-size: 11px;
  color: #999;
  margin-top: 2px;
}
.user-edit {
  font-size: 12px;
  color: #1660C6;
  flex-shrink: 0;
}
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
  max-height: 86%;
  background: #FFFFFF;
  border-radius: 16px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
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

/* 头像编辑 */
.avatar-edit {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 14px;
}
.avatar-big {
  width: 72px;
  height: 72px;
  border-radius: 36px;
  background: #EEE;
}
.avatar-tip {
  font-size: 11px;
  color: #1660C6;
  margin-top: 6px;
}

.field { margin-bottom: 12px; }
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
.role-seg {
  display: flex;
  flex-direction: row;
  gap: 8px;
}
.seg {
  flex: 1;
  height: 36px;
  border-radius: 8px;
  background: #F5F5F7;
  display: flex;
  align-items: center;
  justify-content: center;
}
.seg text { font-size: 13px; color: #666; }
.seg.on { background: #1660C6; }
.seg.on text { color: #FFF; font-weight: 500; }

/* 禁用开关 */
.switch-field {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background: #FFF7F7;
  border: 1px solid #FFD6D6;
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 14px;
}
.switch-text { flex: 1; margin-right: 10px; }
.switch-field .field-label { margin-bottom: 2px; }
.switch-desc {
  display: block;
  font-size: 10px;
  color: #E07070;
  line-height: 1.4;
}

/* 修改密码块 */
.pwd-block {
  border-top: 1px solid #F0F0F0;
  padding-top: 14px;
  margin-bottom: 14px;
}
.pwd-title {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: #1A1A1A;
  margin-bottom: 10px;
}
.pwd-input { margin-bottom: 8px; }
.pwd-btn { margin-top: 4px; }
.pwd-tip {
  display: block;
  text-align: center;
  font-size: 12px;
  color: #22C55E;
  margin-top: 8px;
}

/* 弹窗底部按钮 */
.modal-foot {
  display: flex;
  flex-direction: row;
  gap: 10px;
  margin-top: 6px;
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
.mod-btn.danger { background: #FF0000; }
.mod-btn.danger text { color: #FFF; }

/* 确认警告 */
.warn-card { align-items: center; }
.warn-icon { font-size: 36px; }
.warn-title {
  font-size: 16px;
  font-weight: 600;
  color: #1A1A1A;
  margin: 8px 0 12px;
}
.warn-body { width: 100%; }
.warn-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 0;
  border-top: 1px solid #F5F5F7;
}
.warn-label { font-size: 12px; color: #999; flex-shrink: 0; }
.warn-val { font-size: 12px; }
.warn-old { color: #999; text-decoration: line-through; }
.warn-new { color: #FF0000; font-weight: 600; }
.warn-card .modal-foot { width: 100%; }
</style>
