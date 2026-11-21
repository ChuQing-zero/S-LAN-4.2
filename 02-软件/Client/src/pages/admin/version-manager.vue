<template>
  <view class="page-container">
    <view class="toolbar-panel">
      <view class="toolbar">
        <view class="toolbar-left">
          <view class="tool-btn" @tap="goBack"><image class="icon-back" src="/static/icons/ic_back.png" mode="aspectFit" /></view>
        </view>
        <text class="tool-title">后台版本管理</text>
        <view class="version-selector" @tap="showVersionPicker">
          <text class="version-text">{{ currentVersionName || '游戏王日文' }}</text>
          <image class="arrow" src="/static/icons/ic_arrow_down.png" mode="aspectFit" />
        </view>
      </view>
    </view>

    <view class="tool-section">
      <view class="filter-bar">
        <view class="filter-tag" :class="{ 'tab-active': adminTab==='version' }" @tap="switchTab('version')">
          <text class="filter-tag-text" :class="{ 'tab-active-text': adminTab==='version' }">版本设置</text>
        </view>
        <view class="filter-tag" :class="{ 'tab-active': adminTab==='rarity' }" @tap="switchTab('rarity')">
          <text class="filter-tag-text" :class="{ 'tab-active-text': adminTab==='rarity' }">罕贵度</text>
        </view>
        <view class="filter-tag" :class="{ 'tab-active': adminTab==='condition' }" @tap="switchTab('condition')">
          <text class="filter-tag-text" :class="{ 'tab-active-text': adminTab==='condition' }">品相</text>
        </view>
        <view class="filter-tag" :class="{ 'tab-active': adminTab==='note' }" @tap="switchTab('note')">
          <text class="filter-tag-text" :class="{ 'tab-active-text': adminTab==='note' }">备注</text>
        </view>
      </view>
    </view>

    <VersionPicker ref="versionPickerRef" :top-offset="54" :show-add="true" @select="onVersionSelect" @add="showAddVer=true" />

    <view v-if="showAddVer" class="modal-mask" @tap="showAddVer=false">
      <view class="modal-box" @tap.stop>
        <text class="mod-title">添加版本</text>
        <view class="mod-row"><text class="mod-lbl">名称</text><input class="mod-inp" v-model="newVer.name" placeholder="如: 游戏王韩文" /></view>
        <view class="mod-row"><text class="mod-lbl">语种</text><input class="mod-inp" v-model="newVer.lang" placeholder="如: 韩文" /></view>
        <view class="mod-btns"><view class="mod-btn cancel" @tap="showAddVer=false"><text>取消</text></view><view class="mod-btn ok" @tap="onAddVersion"><text>添加</text></view></view>
      </view>
    </view>

    <view v-if="showDelVer" class="modal-mask" @tap="showDelVer=false">
      <view class="modal-box" @tap.stop>
        <text class="mod-title">删除版本</text>
        <text style="text-align:center;display:block;margin-bottom:16px;font-size:14px;color:#666">确定删除「{{ currentVersionName }}」？此操作不可恢复。</text>
        <view class="mod-btns"><view class="mod-btn cancel" @tap="showDelVer=false"><text>取消</text></view><view class="mod-btn ok" @tap="onDeleteVersion"><text>确认删除</text></view></view>
      </view>
    </view>

    <view class="editor-scroll">
      <view v-if="adminTab==='version'">
        <view class="ver-card">
          <view class="ver-logo-wrap" @tap="onChangeLogo">
            <image class="ver-logo-img" :src="currentVerLogo || '/static/icons/avatar.png'" mode="aspectFit" />
            <text class="ver-logo-hint">点击切换图片</text>
          </view>
          <view class="ver-fields">
            <text class="ver-label">名称</text>
            <input class="ver-input" v-model="currentVersionName" @blur="onSaveVer" />
            <text class="ver-label">语言</text>
            <input class="ver-input" v-model="currentVerLang" @blur="onSaveVer" />
          </view>
        </view>
        <view class="del-ver-btn" @tap="showDelVer=true"><text class="del-ver-text">删除此版本</text></view>
      </view>

      <view v-if="adminTab==='rarity'">
        <text class="sec-hint">点击编辑 | 点击[默认]设为首选</text>
        <view class="list-item" v-for="(r,i) in rarities" :key="i" :class="{'list-default':defRarity===r}">
          <input class="list-inp-edit" v-model="rarities[i]" @blur="saveConfig()" />
          <text class="list-def-tag" @tap="defRarity=r;saveConfig()" v-if="defRarity===r">默认</text>
          <text class="list-def-tag set" @tap="defRarity=r;saveConfig()" v-else>设默认</text>
          <view class="list-del" @tap="rarities.splice(i,1);if(defRarity===r)defRarity=rarities[0]||'';saveConfig()"><text>×</text></view>
        </view>
        <view class="list-add-row">
          <input class="list-add-inp" v-model="newRarity" placeholder="新罕贵度" @confirm="addRarity" />
          <view class="list-add-btn" @tap="addRarity"><text>+</text></view>
        </view>
      </view>

      <view v-if="adminTab==='condition'">
        <text class="sec-hint">点击编辑 | 点击[默认]设为首选</text>
        <view class="list-item" v-for="(c,i) in conditions" :key="i" :class="{'list-default':defCondition===c}">
          <input class="list-inp-edit" v-model="conditions[i]" @blur="saveConfig()" />
          <text class="list-def-tag" @tap="defCondition=c;saveConfig()" v-if="defCondition===c">默认</text>
          <text class="list-def-tag set" @tap="defCondition=c;saveConfig()" v-else>设默认</text>
          <view class="list-del" @tap="conditions.splice(i,1);if(defCondition===c)defCondition=conditions[0]||'';saveConfig()"><text>×</text></view>
        </view>
        <view class="list-add-row">
          <input class="list-add-inp" v-model="newCondition" placeholder="新品相" @confirm="addCondition" />
          <view class="list-add-btn" @tap="addCondition"><text>+</text></view>
        </view>
      </view>

      <view v-if="adminTab==='note'">
        <text class="sec-hint">点击编辑 | 点击[默认]设为首选</text>
        <view class="list-item" v-for="(g,i) in grades" :key="i" :class="{'list-default':defGrade===g.name}">
          <input class="list-inp-edit" v-model="grades[i].name" @blur="saveConfig()" style="flex:1" />
          <input class="list-inp-edit" v-model="grades[i].desc" @blur="saveConfig()" style="width:70px;font-size:10px;color:#999" placeholder="描述" />
          <text class="list-def-tag" @tap="defGrade=g.name;saveConfig()" v-if="defGrade===g.name">默认</text>
          <text class="list-def-tag set" @tap="defGrade=g.name;saveConfig()" v-else>设默认</text>
          <view class="list-del" @tap="grades.splice(i,1);if(defGrade===g.name)defGrade=grades[0]?.name||'';saveConfig()"><text>×</text></view>
        </view>
        <view class="list-add-row">
          <input class="list-add-inp" v-model="newGrade.name" placeholder="备注名" style="flex:1" />
          <input class="list-add-inp" v-model="newGrade.desc" placeholder="描述" style="width:70px" />
          <view class="list-add-btn" @tap="addGrade"><text>+</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import VersionPicker from '@/components/VersionPicker.vue'
import { getVersions } from '@/api/index.js'
import { goBack as navBack } from '@/utils/nav.js'

const versions = ref([]), versionPickerRef = ref(null)
const currentVersionId = ref(0), currentVersionName = ref(''), currentVerLang = ref(''), currentVerLogo = ref('')
const adminTab = ref('version')
const rarities = ref([]), conditions = ref([]), grades = ref([])
const defRarity = ref(''), defCondition = ref(''), defGrade = ref('')
const newRarity = ref(''), newCondition = ref(''), newGrade = ref({ name: '', desc: '' })

const FALLBACK = [{ id: 1, name: '游戏王日文' }, { id: 2, name: '游戏王简中' }, { id: 3, name: '游戏王英文' }, { id: 4, name: '宝可梦日文' }, { id: 5, name: '宝可梦简中' }, { id: 6, name: '宝可梦英文' }]

const switchTab = (tab) => { adminTab.value = tab; if (tab !== 'version') fetchConfig() }

onShow(async () => { if (!uni.getStorageSync('token')) { uni.redirectTo({ url: '/pages/login/login' }); return }; await fetchData() })

const fetchData = async () => {
  try { const vd = await getVersions(); versions.value = (vd.list || []).length > 0 ? vd.list : FALLBACK; if (!currentVersionId.value && versions.value.length > 0) { const v = versions.value[0]; currentVersionId.value = v.id; currentVersionName.value = v.name; currentVerLang.value = v.lang || ''; currentVerLogo.value = v.logo || '' }; await fetchConfig() }
  catch { versions.value = FALLBACK; if (!currentVersionId.value) { currentVersionId.value = 1; currentVersionName.value = '游戏王日文' }; await fetchConfig() }
}

const fetchConfig = async () => {
  if (!currentVersionId.value) return
  try { const token = uni.getStorageSync('token'); const resp = await fetch('/v1/api/admin/version-config/' + currentVersionId.value, { headers: { 'Authorization': 'Bearer ' + token } }); const data = await resp.json(); rarities.value = data.rarities || []; conditions.value = data.conditions || ['流通品相','有瑕疵','有损伤']; grades.value = data.grades || []; defRarity.value = data.defaultRarity || rarities.value[0] || ''; defCondition.value = data.defaultCondition || conditions.value[0] || ''; defGrade.value = data.defaultGrade || grades.value[0]?.name || '' }
  catch (_) {}
}

const saveConfig = async () => {
  const token = uni.getStorageSync('token'), body = {}
  if (adminTab.value === 'rarity') { body.rarities = rarities.value; body.defaultRarity = defRarity.value }
  else if (adminTab.value === 'condition') { body.conditions = conditions.value; body.defaultCondition = defCondition.value }
  else if (adminTab.value === 'note') { body.grades = grades.value; body.defaultGrade = defGrade.value }
  else return
  await fetch('/v1/api/admin/version-config/' + currentVersionId.value, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify(body) })
}

const addRarity = () => { const v = newRarity.value.trim(); if (v && !rarities.value.includes(v)) { rarities.value.push(v); saveConfig(); newRarity.value = '' } }
const addCondition = () => { const v = newCondition.value.trim(); if (v && !conditions.value.includes(v)) { conditions.value.push(v); saveConfig(); newCondition.value = '' } }
const addGrade = () => { const n = newGrade.value.name.trim(); if (n) { grades.value.push({ name: n, desc: newGrade.value.desc.trim() }); saveConfig(); newGrade.value = { name: '', desc: '' } } }

const showVersionPicker = () => versionPickerRef.value?.open(currentVersionName.value)
const onVersionSelect = (v) => { currentVersionId.value = v.id; currentVersionName.value = v.name; currentVerLang.value = v.lang || ''; currentVerLogo.value = v.logo || ''; fetchConfig() }

const onSaveVer = async () => {
  const token = uni.getStorageSync('token')
  await fetch('/v1/api/admin/versions/' + currentVersionId.value, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ name: currentVersionName.value, lang: currentVerLang.value }) })
  uni.showToast({ title: '已保存', icon: 'success' })
}

const onChangeLogo = () => { uni.chooseImage({ count: 1, sourceType: ['album'], success: async (res) => { const token = uni.getStorageSync('token'); uni.uploadFile({ url: '/v1/api/admin/versions/' + currentVersionId.value + '/logo', filePath: res.tempFilePaths[0], name: 'image', header: { 'Authorization': 'Bearer ' + token }, success: (r) => { if (r.statusCode === 200) { const d = JSON.parse(r.data); currentVerLogo.value = d.logo + '?t=' + Date.now(); uni.showToast({ title: '已更新', icon: 'success' }) } } }) } }) }

const showAddVer = ref(false), newVer = ref({ name: '', lang: '' })
const onAddVersion = async () => { if (!newVer.value.name.trim()) { uni.showToast({ title: '请输入名称', icon: 'none' }); return }; const token = uni.getStorageSync('token'); const resp = await fetch('/v1/api/admin/versions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ name: newVer.value.name.trim(), lang: newVer.value.lang.trim() || '其他' }) }); if (resp.ok) { showAddVer.value = false; newVer.value = { name: '', lang: '' }; fetchData(); uni.showToast({ title: '已添加', icon: 'success' }) } else { const d = await resp.json().catch(() => ({})); uni.showToast({ title: d.error || '添加失败', icon: 'none' }) } }

const showDelVer = ref(false)
const onDeleteVersion = async () => { const token = uni.getStorageSync('token'); const resp = await fetch('/v1/api/admin/versions/' + currentVersionId.value, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } }); if (resp.ok) { showDelVer.value = false; currentVersionId.value = 0; fetchData(); uni.showToast({ title: '已删除', icon: 'success' }) } else uni.showToast({ title: '删除失败', icon: 'none' }) }

const goBack = () => navBack('/pages/admin/dashboard')
</script>

<style scoped>
.page-container { background:#F5F5F7; display:flex; flex-direction:column; height:100vh; box-sizing:border-box; overflow-x:hidden }
.toolbar-panel { background:#FFF; padding:12px 16px 10px; flex-shrink:0; position:relative; z-index:201 }
.toolbar { display:flex; justify-content:space-between; align-items:center; position:relative }
.toolbar-left { display:flex; align-items:center; gap:10px; z-index:1 }
.tool-title { position:absolute; left:50%; transform:translateX(-50%); font-size:15px; font-weight:500; color:#1A1A1A }
.tool-btn { width:32px; height:32px; border-radius:16px; background:#F0F0F0; display:flex; align-items:center; justify-content:center }
.icon-back { width:18px; height:18px }
.version-selector { display:flex; align-items:center; background:#F0F0F0; border-radius:16px; padding:6px 12px; gap:4px; z-index:1 }
.version-text { font-size:12px; color:#1A1A1A }
.arrow { width:12px; height:12px }
.tool-section { background:#FFF; padding:0 16px 12px; flex-shrink:0 }
.filter-bar { display:flex; gap:8px }
.filter-tag { display:flex; align-items:center; background:#F0F0F0; border-radius:14px; padding:5px 10px; gap:4px }
.filter-tag-text { font-size:11px; color:#1A1A1A }
.tab-active { background:#FF0000 }
.tab-active-text { color:#FFF }
.editor-scroll { flex:1; overflow-y:auto; padding:12px 16px }

.ver-card { background:#FFF; border-radius:12px; padding:16px; display:flex; align-items:flex-start; gap:16px; box-sizing:border-box }
.ver-logo-wrap { display:flex; flex-direction:column; align-items:center; flex-shrink:0; background:#FF0000; border-radius:8px; padding:4px }
.ver-logo-img { width:128px; height:76px; object-fit:contain; border-radius:5px; background:#FFF }
.ver-logo-hint { font-size:11px; color:#FFF; font-weight:700; line-height:1.2; white-space:nowrap; padding:2px 6px 3px }
.ver-fields { min-width:0; max-width:200px; margin-left:auto }
.ver-fields .ver-label { font-size:11px; color:#999; display:block; margin-bottom:2px }
.ver-fields .ver-label + .ver-label { margin-top:6px }
.ver-fields .ver-input { display:block; width:100%; height:32px; background:#F5F5F7; border:1px solid #E5E5EA; border-radius:6px; padding:0 8px; font-size:13px; box-sizing:border-box; margin-bottom:6px }

.del-ver-btn { margin-top:12px; padding:12px; background:#FFF; border-radius:12px; border:1px solid #FF0000; text-align:center }
.del-ver-text { font-size:14px; color:#FF0000 }

.sec-hint { font-size:11px; color:#999; display:block; margin-bottom:8px }
.list-item { background:#FFF; border-radius:8px; padding:10px 14px; margin-bottom:6px; display:flex; align-items:center; justify-content:space-between }
.list-default { background:#FFF0F0; border:1px solid #FF0000 }
.list-inp-edit { flex:1; height:28px; background:transparent; border:none; font-size:14px; color:#1A1A1A; padding:0 }
.list-def-tag { font-size:10px; padding:2px 6px; border-radius:6px; flex-shrink:0; margin-left:8px; background:#FF0000; color:#FFF }
.list-def-tag.set { background:#F0F0F0; color:#999 }
.list-del { width:24px; height:24px; border-radius:12px; background:#FFF0F0; display:flex; align-items:center; justify-content:center; flex-shrink:0; margin-left:6px }
.list-del text { font-size:14px; color:#FF0000 }
.list-add-row { display:flex; gap:6px; align-items:center; margin-top:8px }
.list-add-inp { flex:1; height:34px; background:#FFF; border:1px solid #E5E5EA; border-radius:6px; padding:0 8px; font-size:13px; box-sizing:border-box }
.list-add-btn { width:34px; height:34px; border-radius:17px; background:#FF0000; display:flex; align-items:center; justify-content:center; flex-shrink:0 }
.list-add-btn text { color:#FFF; font-size:18px }

.modal-mask { position:fixed; inset:0; z-index:500; background:rgba(0,0,0,.4); display:flex; align-items:center; justify-content:center }
.modal-box { width:90%; max-width:320px; background:#FFF; border-radius:16px; padding:20px }
.mod-title { font-size:16px; font-weight:600; text-align:center; display:block; margin-bottom:16px }
.mod-row { display:flex; align-items:center; gap:8px; margin-bottom:10px }
.mod-lbl { font-size:12px; color:#666; width:36px; text-align:right }
.mod-inp { flex:1; height:36px; background:#F5F5F7; border:1px solid #E5E5EA; border-radius:6px; padding:0 8px; font-size:13px }
.mod-btns { display:flex; gap:10px; margin-top:6px }
.mod-btn { flex:1; height:42px; border-radius:20px; display:flex; align-items:center; justify-content:center; font-size:14px }
.mod-btn.cancel { background:#F0F0F0; color:#666 }
.mod-btn.ok { background:#FF0000; color:#FFF }
</style>
