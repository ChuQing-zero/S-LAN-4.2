<template>
  <view class="page-container">
    <!-- 第1块：主要功能区（工具栏）— 不被遮挡 -->
    <view class="toolbar-panel">
      <view class="toolbar">
        <view class="toolbar-left">
          <view class="tool-btn" @tap="goBack">
            <image class="icon-back" src="/static/icons/ic_back.png" mode="aspectFit"></image>
          </view>
          <view class="tool-btn" @tap="onSearch">
            <image class="icon-sm" src="/static/icons/ic_search.png" mode="aspectFit"></image>
          </view>
          <!-- 批量删掉标记待删的卡。文字不用图标：icons 里没有删除类图。
               一张没标时变灰点不动。数字只在弹窗里报，不写在按钮上 ——
               顶栏左侧到中间标题只有 75px 空档（390 屏），「删除 3」会顶到标题。
               要改文案先重量一遍（见 .del-all-btn 的注释）。 -->
          <view class="del-all-btn" :class="{ 'del-all-off': pendingDeleteCount === 0 }" @tap="onConfirmDeleteAll">
            <text class="del-all-text">删除</text>
          </view>
        </view>
        <view class="toolbar-center">
          <text class="tool-title">识别上传</text>
        </view>
        <view class="toolbar-right">
          <view class="orig-switch" @tap="toggleShowOrig">
            <text class="orig-switch-text">原图</text>
            <view class="switch-track" :class="{ on: showOrigImg }">
              <view class="switch-thumb"></view>
            </view>
          </view>
          <view class="version-selector" @tap="showVersionPicker">
            <text class="version-text">{{ selectedVersion.name }}</text>
            <image class="arrow" src="/static/icons/ic_arrow_down.png" mode="aspectFit"></image>
          </view>
        </view>
      </view>
    </view>

    <!-- 第2块：库切换（固定） -->
    <view class="lib-section">
      <view class="lib-top-row">
        <view class="library-tab">
          <view class="tab-item" @tap="switchLibrary('local')">
            <text :class="{ active: currentLibrary === 'local' }">本地库</text>
            <view v-if="currentLibrary === 'local'" class="red-line"></view>
          </view>
          <view class="tab-item" @tap="switchLibrary('cloud')">
            <text :class="{ active: currentLibrary === 'cloud' }">云端库</text>
            <view v-if="currentLibrary === 'cloud'" class="red-line"></view>
          </view>
        </view>
        <view class="api-bar">
          <text class="api-balance-text" @tap="showUsagePopup = true">累计消耗: ¥{{ usage.costYuan }}</text>
          <KeySelector v-model="selectedKeyId" />
        </view>
      </view>
    </view>

    <!-- 第3块：工具区（固定） -->
    <view class="tool-section">
      <view class="filter-bar">
        <view class="filter-tag" @tap="selectGrade">
          <text class="filter-tag-text">{{ selectedRarity }}·{{ selectedCondition }}·{{ selectedGrade?.name || '78品' }}</text>
          <image class="small-arrow" src="/static/icons/ic_arrow_down.png" mode="aspectFit"></image>
        </view>
        <view class="filter-tag" @tap="selectLocation">
          <text class="filter-tag-text">{{ selectedLocation }}</text>
          <image class="small-arrow" src="/static/icons/ic_arrow_down.png" mode="aspectFit"></image>
        </view>
        <view class="filter-tag" @tap="onUpload">
          <text class="filter-tag-text">{{ currentLibrary === 'cloud' ? '下载' : '上传' }}</text>
          <image class="icon-xs" :src="currentLibrary === 'cloud' ? '/static/icons/ic_download.png' : '/static/icons/ic_upload.png'" mode="aspectFit"></image>
        </view>
        <view class="filter-tag" @tap="onSettings">
          <text class="filter-tag-text">设置</text>
          <image class="icon-xs" src="/static/icons/ic_settings.png" mode="aspectFit"></image>
        </view>
      </view>
    </view>

    <!-- 卡牌列表（可滑动） -->
    <scroll-view class="main-scroll" scroll-y="true" :show-scrollbar="false">
      <view class="card-list">
        <view class="card-item" :class="{ 'card-to-delete': item.pendingDelete, 'card-failed': item.failed, 'card-uncollected': !item.failed && item.marked, 'card-pending': !item.failed && !item.marked && (item.altCount||1)>1 && (item.altLabel === '待填' || !item.altLabel) }" v-for="item in cardList" :key="item.id">
          <image v-if="showOrigImg && item.origImg" class="card-orig-img" :src="item.origImg" mode="aspectFill" @error="item.origImg = ''" @tap.stop="onPreviewOrig(item)"></image>
          <image class="card-img" :src="item.img || CARD_BACK" mode="aspectFill" @error="item.img = CARD_BACK" @tap.stop="onPreviewCard(item)"></image>
          <view class="card-info">
            <rich-text class="jp-name" :nodes="toRubyHtml(item.jpName)"></rich-text>
            <text class="cn-name">{{ item.cnName }}</text>
            <view class="card-meta">
              <text class="meta-text">{{ item.code }}</text>
              <text class="meta-text">{{ item.rarity }}</text>
              <text class="meta-text">{{ item.condition }}</text>
              <text class="meta-text">{{ item.note || '' }}</text>
            </view>
            <view class="card-codes">
              <text class="serial">{{ item.serial }}</text>
              <text class="ext-code">{{ item.extCode || '00000000' }}</text>
              <view class="card-alt-badge" :class="item.hasAltArt ? 'alt-has' : 'alt-none'"><text class="alt-badge-text">{{ item.hasAltArt ? '有异画' : '无异画' }}</text></view>
            </view>
            <view v-if="(item.altCount || 1) > 1" class="alt-switcher">
              <view class="alt-arrow" @tap.stop="onAltPrev(item)"><text class="alt-arrow-text">◀</text></view>
              <input class="alt-label-input" v-model="item.altLabel" placeholder="待填" @confirm="onAltLabelSave(item)" @blur="onAltLabelSave(item)" />
              <view class="alt-arrow" @tap.stop="onAltNext(item)"><text class="alt-arrow-text">▶</text></view>
            </view>
          </view>
          <view class="card-reg-block" :class="{ 'card-reg-block-on': item.marked }" @tap.stop="onRegisterCard(item)"><text class="edit-block-text" :class="{ 'edit-block-text-sm': item.marked }">{{ item.marked ? '信息已登记' : '信息登记' }}</text></view>
          <view class="card-edit-block" @tap.stop="onEditCard(item)"><text class="edit-block-text">信息有误</text></view>
          <!-- 点一下 = 标记待删（只改本地状态，不发请求，所以再点一下撤销是零成本的）。
               真正的删除在顶栏的「删除」按钮上统一做。 -->
          <view class="card-del-btn" @tap.stop="onToggleDelete(item)"><text class="del-char">{{ item.pendingDelete ? '↺' : '✕' }}</text></view>
        </view>
      </view>
    </scroll-view>

    <!-- 底部拍照按钮（允许连拍） -->
    <view class="camera-btn" @tap="onCamera">
      <image class="camera-icon" src="/static/icons/ic_camera.png" mode="aspectFit"></image>
    </view>

    <!-- 版本选择弹窗 -->
    <VersionPicker ref="versionPickerRef" :top-offset="54" @select="onVersionSelect" />

    <!-- 参数设置弹窗 -->
    <ParamsPicker ref="paramsPickerRef" :top-offset="124" :version-id="currentVersionId" @confirm="onParamsConfirm" />
    <LocationPicker ref="locationPickerRef" :top-offset="124" @confirm="onLocationConfirm" />
    <ConfirmDialog ref="confirmDialogRef" @confirm="onTransferConfirm" />
    <SettingsDialog ref="settingsDialogRef" :library-code="currentLocation" :library-type="currentLibrary" />

    <view v-if="editVisible" class="edit-overlay" @tap.stop="editVisible=false">
      <view class="edit-box" @tap.stop>
        <text class="edit-title">信息有误</text>
        <view class="edit-preview-row">
          <image class="edit-preview-img" :src="editPreviewImg" mode="aspectFill" @error="editPreviewImg = CARD_BACK"></image>
          <view class="edit-preview-right">
            <!-- 编号可改，失焦 / 回车就按新编号重查目录。这是全站唯一能改编号的地方。 -->
            <view class="edit-field"><text class="edit-label">卡牌编号</text>
              <input class="edit-input" v-model="editForm.code" @blur="onReloadFromCatalog(true)" @confirm="onReloadFromCatalog(true)"/>
            </view>
            <view class="edit-ai-btn" :class="{'edit-ai-loading':aiLoading}" @tap="onReloadFromCatalog()"><text class="edit-ai-text">{{aiLoading?'查询中…':'重新从目录带出'}}</text></view>
          </view>
        </view>
        <view class="edit-fields">
          <!-- 日文名称 / 中文名称 / 卡密：这三项属于「目录」（cardcatalogs）的数据，
               只读展示、不参与保存。要换名字只能改编号让目录重查，或者去补目录资料。 -->
          <view class="edit-field"><text class="edit-label">日文名称</text>
            <view class="edit-readonly">{{ editForm.jpName || '—' }}</view>
          </view>
          <view class="edit-field"><text class="edit-label">中文名称</text>
            <view class="edit-readonly">{{ editForm.cnName || '—' }}</view>
          </view>
          <view class="edit-field"><text class="edit-label">罕贵度</text>
            <!-- 只能点不能敲：选项来自图源里真实存在的罕贵度。
                 以前是自由输入框，敲错一个字母（NPR 打成 NPRR）就静默退回别的图，看不出错；
                 现在敲错就是卡背，所以干脆不给敲。单独占一行也是因为它现在是最该看清的一栏。 -->
            <RarityGrid v-model="editForm.rarity" :list="editRarityList" :loading="editRarityLoading" />
          </view>
          <view v-if="editRarityWarn" class="edit-hint edit-hint-warn">{{ editRarityWarn }}</view>
          <view class="edit-row-3">
            <view class="edit-field edit-field-sm"><text class="edit-label">品相</text>
              <picker :value="condOpts.indexOf(editForm.condition)" :range="condOpts" @change="(e)=>{editForm.condition=condOpts[e.detail.value]}">
                <view class="edit-input" style="display:flex;align-items:center">{{ editForm.condition || '流通品相' }}</view>
              </picker>
            </view>
            <view class="edit-field edit-field-sm"><text class="edit-label">备注</text><input class="edit-input" v-model="editForm.note"/></view>
          </view>
          <view class="edit-field"><text class="edit-label">卡密</text>
            <view class="edit-readonly">{{ editForm.extCode || '—' }}</view>
          </view>
          <view v-if="editCatalogState === 'loading'" class="edit-hint">正在查目录…</view>
          <view v-else-if="editCatalogState === 'missing'" class="edit-hint edit-hint-warn">目录里查不到这个编号，卡名和卡密带不出来（会自动登记待处理，卡片显示淡红底）</view>
        </view>
        <view class="edit-btns">
          <view class="edit-btn-cancel" @tap="editVisible=false"><text class="edit-btn-text">取消</text></view>
          <view class="edit-btn-save" @tap="onSaveEdit"><text class="edit-btn-text edit-btn-text-w">确认更改</text></view>
        </view>
      </view>
    </view>

    <!-- 累计消耗弹窗（后端明细日志，按账号聚合） -->
    <view v-if="showUsagePopup" class="edit-overlay" @tap="showUsagePopup=false">
      <view class="edit-box" @tap.stop>
        <text class="edit-title">累计消耗</text>
        <view class="edit-field"><text class="edit-label">当前钥匙</text><text class="usage-val">{{ usage.keyName || '未配置' }}</text></view>
        <view class="edit-field"><text class="edit-label">累计Token</text><text class="usage-val">{{ usage.tokens }}</text></view>
        <view class="edit-field"><text class="edit-label">识别次数</text><text class="usage-val">{{ usage.calls }}</text></view>
        <view class="edit-field"><text class="edit-label">估算费用</text><text class="usage-val">¥{{ usage.costYuan }}</text></view>
        <view class="edit-btns">
          <view class="edit-btn-save" @tap="showUsagePopup=false"><text class="edit-btn-text edit-btn-text-w">关闭</text></view>
        </view>
      </view>
    </view>

    <!-- 卡牌大图预览 -->
    <view v-if="cardPreviewVisible" class="card-preview-overlay" @tap="cardPreviewVisible = false">
      <image class="card-preview-img" :src="cardPreviewImg" mode="aspectFit" @error="cardPreviewImg = CARD_BACK" @tap.stop="cardPreviewVisible = false"></image>
    </view>
  </view>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import VersionPicker from '@/components/VersionPicker.vue'
import ParamsPicker from '@/components/ParamsPicker.vue'
import LocationPicker from '@/components/LocationPicker.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import RarityGrid from '@/components/RarityGrid.vue'
import SettingsDialog from '@/components/SettingsDialog.vue'
import { getCards, getLocalLibraries, getCloudLibraries, createCard, updateCard, deleteCard, saveOrigImage, getVisionUsage, markCards, getCardMarkCodes, deleteCardMark } from '@/api/index.js'
import KeySelector from '@/vision-api/KeySelector.vue'
import { recognize } from '@/vision-api/registry.js'
import { lookupCard, lookupRarityInfo, buildCardImgUrl, CARD_BACK } from '@/api/cardDb.js'
import { toRubyHtml } from '@/utils/ruby.js'

// 判「这张卡图还是个占位/临时图」—— 用路径常量逐个比，别再用 includes('placeholder') 那种字符串猜。
// 之前是靠子串猜的，改一次占位图文件名就会整段失效；而这段异步重建恰恰是唯一会用
// 图源派生的 altRarity 重建图的地方，它一失效，异画卡就永远显示原画。
const PLACEHOLDER_IMGS = [CARD_BACK, '/static/icons/ic_card_placeholder.png']
const isPlaceholderImg = (u) => !u || u.startsWith('data:') || PLACEHOLDER_IMGS.includes(u)
const recogMode = ref('doubao')
// 识别用哪把豆包钥匙：'' = 跟随后台默认钥匙；否则为所选钥匙 id
const selectedKeyId = ref('')
// 是否展示原图（开关，默认关，本地记忆）
const showOrigImg = ref(uni.getStorageSync('upload_show_orig_img') === '1')
const toggleShowOrig = () => {
  showOrigImg.value = !showOrigImg.value
  uni.setStorageSync('upload_show_orig_img', showOrigImg.value ? '1' : '0')
}
const condOpts = ref(['流通品相', '有瑕疵', '有损伤'])
const pad8 = (s) => String(s || '')  // 卡密保持原始位数（不补零）

// 累计消耗（后端明细日志，按账号聚合，见 /v1/api/vision/usage）
const showUsagePopup = ref(false)
const usage = ref({ keyName: '', tokens: 0, calls: 0, costYuan: 0 })

const loadVisionUsage = async () => {
  try {
    const data = await getVisionUsage()
    usage.value = {
      keyName: data?.key?.name || '',
      tokens: data?.totals?.tokens || 0,
      calls: data?.totals?.calls || 0,
      costYuan: data?.totals?.costYuan || 0,
    }
  } catch (_) {
    // 网络异常不阻塞识别
  }
}

loadVisionUsage()

const versionPickerRef = ref(null)
const paramsPickerRef = ref(null)
const locationPickerRef = ref(null)
const confirmDialogRef = ref(null)
const settingsDialogRef = ref(null)
const selectedVersion = ref({ name: '游戏王日文', lang: '日文' })
const selectedLocation = ref('')
const lastLocal = ref('')
const lastCloud = ref('')
const selectedRarity = ref('SR')
const selectedCondition = ref('流通品相')
const selectedGrade = ref({ name: '78品', desc: '标准流通' })
const currentLibrary = ref('local')
const currentLocation = ref('')
const cardList = ref([])
// 待删（点了 ✕ 但还没确认删）的卡。pendingDelete 只挂在本地卡片对象上，
// 不发请求也不落库 —— fetchCards 整体替换 cardList，所以切库/换筛选后这些标记自然消失。
const pendingDeleteList = computed(() => cardList.value.filter(c => c.pendingDelete))
const pendingDeleteCount = computed(() => pendingDeleteList.value.length)
// 批量删除进行中：期间锁住 ✕ 和顶栏按钮，免得删到一半又插进来一批
const isDeleting = ref(false)
const isRecognizing = ref(false)
const currentVersionId = ref(1)
const serialCounter = ref(0)
const previewVisible = ref(false)
const previewImage = ref('')

// 卡牌大图预览
const cardPreviewVisible = ref(false)
const cardPreviewImg = ref('')
const onPreviewCard = (item) => {
  cardPreviewImg.value = item.img || CARD_BACK
  cardPreviewVisible.value = true
}
// 预览原图（左侧拍照/上传图）
const onPreviewOrig = (item) => {
  cardPreviewImg.value = item.origImg || CARD_BACK
  cardPreviewVisible.value = true
}

// 生成序列号：基于当前列表中最大编号+1，自动填补空缺
const nextSerial = () => {
  const prefix = currentLocation.value + '-'
  const nums = cardList.value
    .map(c => c.serial)
    .filter(s => s && s.startsWith(prefix))
    .map(s => parseInt(s.replace(prefix, '')))
    .filter(n => !isNaN(n))
  const maxNum = nums.length > 0 ? Math.max(...nums) : 0
  return prefix + String(maxNum + 1).padStart(4, '0')
}

// ========== 状态持久化（刷新不丢） ==========
const saveState = () => {
  try {
    uni.setStorageSync('upload_state', {
      currentLibrary: currentLibrary.value,
      currentLocation: currentLocation.value,
      selectedLocation: selectedLocation.value,
      lastLocal: lastLocal.value,
      lastCloud: lastCloud.value,
      selectedRarity: selectedRarity.value,
      selectedCondition: selectedCondition.value,
      selectedGrade: selectedGrade.value,
      selectedVersion: selectedVersion.value,
      currentVersionId: currentVersionId.value,
      serialCounter: serialCounter.value,
      recogMode: recogMode.value,
      selectedKeyId: selectedKeyId.value
    })
  } catch (_) {}
}

const restoreState = () => {
  try {
    const s = uni.getStorageSync('upload_state')
    if (s) {
      if (s.currentLibrary) currentLibrary.value = s.currentLibrary
      if (s.currentLocation) currentLocation.value = s.currentLocation
      if (s.selectedLocation) selectedLocation.value = s.selectedLocation
      if (s.lastLocal) lastLocal.value = s.lastLocal
      if (s.lastCloud) lastCloud.value = s.lastCloud
      if (s.selectedRarity) selectedRarity.value = s.selectedRarity
      if (s.selectedCondition) selectedCondition.value = s.selectedCondition
      if (s.selectedGrade?.name) selectedGrade.value = s.selectedGrade
      if (s.selectedVersion?.name) selectedVersion.value = s.selectedVersion
      if (s.currentVersionId) currentVersionId.value = s.currentVersionId
      if (s.serialCounter) serialCounter.value = s.serialCounter
      if (s.recogMode) {
    // 兼容旧值映射到新 key
    const modeMap = { 'frontend': 'doubao', 'backend': 'backend-ocr' }
    recogMode.value = modeMap[s.recogMode] || s.recogMode
  }
      if (s.selectedKeyId) selectedKeyId.value = s.selectedKeyId
    }
  } catch (_) {}
}

// 状态变化时自动保存
const saveStateAndFetch = () => {
  saveState()
  fetchCards()
}

// 已登记记录的全集（cardmarks 表，全局共享、不分库、不按人）。
//
// 粒度是 **(编号, 罕贵度)**，所以拆成两个 Set：
//   · markedWild —— 这个编号有一条「不限罕贵度」的记录（92 条老记录 + 自动登记都是它）
//   · markedByKey —— (编号, 罕贵度) 精确登记过，键是 'CODE|RARITY'
// 命中条件跟服务端 services/cardMarks.js 一致：通配命中该编号的任意罕贵度，
// 否则要求这一对精确在集合里。**改了这里就得同时改那边**，不然前端绿了后端红、或者反过来。
//
// 为什么需要它：列表接口给每一行都带了 marked，但**刚识别出来的那张卡**是本页本地 new 的、
// 根本没走过接口。以前是靠"在本页找有没有同编号的绿卡"猜的（cardList.some(...)）——
// 换个库、或者那个编号的卡不在本页时猜不中，得刷新一下才变绿。
// 现在进页面拉一份全集，判断口径就和服务端完全一致了。几千条也不占什么内存。
const markedWild = new Set()
const markedByKey = new Set()
// 'CODE|RARITY' → 'auto' | 'manual'（通配那条的键是 'CODE|'）。
// 只有「取消登记」的弹窗用得到：自动记的删掉会自己回来，得跟手动点出来的分开说。
// 拿不到就当 manual（话说得保守些，不吓人）。
const markSources = new Map()
// 归一化方式跟后端 norm() 一致：去空格 + 转大写，其余一字不差
const pairKey = (code, rarity) =>
  String(code || '').trim().toUpperCase() + '|' + String(rarity || '').trim().toUpperCase()
const loadMarkedCodes = async () => {
  try {
    const d = await getCardMarkCodes()
    markedWild.clear()
    markedByKey.clear()
    markSources.clear()
    // 权威是 items（(编号,罕贵度) 才能唯一定位一条记录）。老后端只回 codes 时
    // 退回"全按通配"——宁可标多了，也不能漏标。
    const items = Array.isArray(d?.items) ? d.items
      : (d?.codes || []).map((c) => ({ code: c, rarity: '' }))
    for (const it of items) {
      const code = String(it?.code || '').trim().toUpperCase()
      if (!code) continue
      const rar = String(it?.rarity || '').trim().toUpperCase()
      const k = code + '|' + rar
      if (rar) markedByKey.add(k); else markedWild.add(code)
      markSources.set(k, d?.sources?.[k] === 'auto' ? 'auto' : 'manual')
    }
  } catch (e) {
    // 拉不到就当"一条都没登记"：最坏情况是新识别的卡要刷新一下才变绿，
    // 不能因为这份缓存把上传页卡住。
    console.warn('拉取已登记记录失败:', e)
  }
}
const isMarkedCode = (code, rarity) => {
  const c = String(code || '').trim().toUpperCase()
  if (!c) return false
  return markedWild.has(c) || markedByKey.has(c + '|' + String(rarity || '').trim().toUpperCase())
}
// 这张卡是被**哪一条记录**标中的 —— 「取消登记」删的就是它。
// 优先匹配精确那一对（用户标的 N 就删 N 那条），没有再退到通配（老记录）。
// 返回 'CODE|RARITY'，没有就是空串。
const markKeyOf = (code, rarity) => {
  const k = pairKey(code, rarity)
  if (markedByKey.has(k)) return k
  const c = String(code || '').trim().toUpperCase()
  return c && markedWild.has(c) ? c + '|' : ''
}
// 本地集合变了之后，把本页所有卡的 marked 重算一遍。
// 不能"只翻转被点的那张"—— 一条通配记录能同时罩住同编号的好几档，
// 取消时如果另一档还有独立的记录，它就**不该**跟着变蓝。重算天生处理得了这种叠加。
const 重算本页标记 = () => {
  cardList.value.forEach((x) => { x.marked = isMarkedCode(x.code, x.rarity) })
}

const fetchCards = async () => {
  if (!currentLocation.value) return
  try {
    const params = {}
    const data = await getCards(currentLocation.value, params, currentLibrary.value)
    cardList.value = (data.list || []).map(c => {
      const isFailed = c.jpName === '识别失败' || c.jpName === '识别中…' || c.code === '---' || c.code === '...'
      const isPhotoImg = c.img && c.img.startsWith('data:')
      const hasCode = c.code && c.code !== '...' && c.code !== '---'
      // 有卡牌编号 → 后台异步查目录取图片和卡密
      // 卡密始终从资源库（CardInfo）查
      if (hasCode && !isFailed) {
        lookupCard(c.code, c.rarity).then(data => {
          const idx = cardList.value.findIndex(ci => ci.id === c.id)
          if (idx === -1 || !data) return
          // 卡名也是「目录」的属性，跟卡密一样实时拉。以前只拉卡密不拉卡名，
          // 结果目录后来补了资料，卡名还停在识别当时写进去的占位快照上（「游戏王日文卡牌」）。
          if (data.jpName) cardList.value[idx].jpName = data.jpName
          if (data.cnName) cardList.value[idx].cnName = data.cnName
          if (data.extCode) {
            cardList.value[idx].extCode = data.extCode
            cardList.value[idx].hasAltArt = data.hasAltArt || false
            cardList.value[idx].altCount = data.altCount || 1
            cardList.value[idx].altRarity = data.altRarity || ''
            if (cardList.value[idx].altArtIndex === undefined) cardList.value[idx].altArtIndex = c.altArtIndex
            // altLabels 优先用 CardCatalog 全局映射
            if (data.altLabels && Object.keys(data.altLabels).length > 0) {
              cardList.value[idx].altLabels = { ...data.altLabels }
            }
            const curRarity = cardList.value[idx].rarity || ''
            const curAltIdx = cardList.value[idx].altArtIndex || 0
            const cataKey = curRarity + '|' + curAltIdx
            if (!cardList.value[idx].altLabel || cardList.value[idx].altLabel === '待填') {
              cardList.value[idx].altLabel = cardList.value[idx].altLabels?.[cataKey] || c.altLabel || ''
            }
            const curImg = cardList.value[idx].img
            const altIdx = (cardList.value[idx].altArtIndex != null) ? cardList.value[idx].altArtIndex : 0
            // 异画卡（altIdx>0）也重来一遍：初始渲染时还不知道 altRarity，只能用库里的罕贵度，
            // 那几乎必然落空；等目录查完拿到 altRarity，才拼得出整段命中的 URL。
            if (isPlaceholderImg(curImg) || altIdx > 0) {
              // 这里用 altRarity（图源派生的罕贵）而不是库里的 —— 后端要求
              // {编号}-{罕贵}-{N} 整段命中，库里的值跟文件名那一段基本对不上。
              const cardRarity = cardList.value[idx].altRarity || cardList.value[idx].rarity || ''
              cardList.value[idx].img = buildCardImgUrl({ password: data.extCode, code: c.code, rarity: cardRarity, altIndex: altIdx })
            }
          }
        }).catch(() => {})
      }
      // 初始图片：优先用后端存的 img，其次用 extCode 拼 API URL，最后占位图
      let initImg = c.img
      if (!initImg || initImg === 'OK' || initImg === '') {
        if (hasCode && c.extCode) {
          const altIdx = (c.altArtIndex != null) ? c.altArtIndex : 0
          // 用库里的罕贵度拼 —— 这就是「改错了罕贵度当场变卡背」的来源，故意的。
          // 异画卡这里会先落空一次，等上面 lookupCard 拿到 altRarity 后重建。
          initImg = buildCardImgUrl({ password: c.extCode, code: c.code, rarity: c.altRarity || c.rarity, altIndex: altIdx })
        } else {
          initImg = CARD_BACK
        }
      }

      const altLabels = c.altLabels || {}
      const hasAlt = c.hasAltArt || (c.altCount || 1) > 1
      const curIdx = c.altArtIndex || 0
      if (hasAlt) { let rk = (c.rarity || '').split(/[、]/)[0]?.trim() || '?'; const rm = rk.match(/^([A-Za-z0-9]+)/); if (rm) rk = rm[1]; const rki = rk + '|' + curIdx; if (!altLabels[rki]) altLabels[rki] = '待填'; }
      const curLabel = hasAlt ? (altLabels[rki] || c.altLabel || '待填') : ''
      return {
        ...c, recognizing: false, altLabels, altLabel: curLabel,
        failed: isFailed,
        img: isFailed ? (isPhotoImg ? c.img : CARD_BACK)
             : initImg
      }
    })
    updateLocationCount()
    // 序列号降序：大号在上，小号在下
    cardList.value.sort((a, b) => {
      const numA = parseInt((a.serial || "").split("-").pop()) || 0
      const numB = parseInt((b.serial || "").split("-").pop()) || 0
      return numB - numA
    })
  } catch (e) {
    if (cardList.value.length === 0) {
    }
  }
  updateLocationCount()
}

restoreState()
loadMarkedCodes()
fetchCards()
// 首次加载后保存默认状态
if (!currentLocation.value) {
  // 还未选择库，等待用户选择
} else {
  saveState()
}

const closeAllPickers = () => {
  if (versionPickerRef.value?.visible) versionPickerRef.value.onClose()
  if (paramsPickerRef.value?.visible) paramsPickerRef.value.onClose()
  if (locationPickerRef.value?.visible) locationPickerRef.value.onClose()
}

// 有待删标记时，切库/换库/返回都先问一句再走。
// 标记只活在本页内存里，离开就作废 —— 什么都没删，所以放行是安全的；
// 但不说一声，用户可能以为那几张已经删掉了，回头发现卡还在，以为删失败。
const guardPendingDeletes = (proceed) => {
  const n = pendingDeleteCount.value
  if (!n) { proceed(); return }
  uni.showModal({
    title: '还有待删的卡',
    content: `有 ${n} 张卡标了待删但还没删。现在离开这些标记会作废（卡还在库里）。`,
    confirmText: '作废离开',
    cancelText: '留下处理',
    success: (r) => { if (r.confirm) proceed() },
  })
}

const goBack = () => {
  // 优先关闭弹窗
  if (versionPickerRef.value?.visible) { versionPickerRef.value.onClose(); return }
  if (paramsPickerRef.value?.visible) { paramsPickerRef.value.onClose(); return }
  if (locationPickerRef.value?.visible) { locationPickerRef.value.onClose(); return }
  // 有标记待删 → 拦一下再回主界面
  guardPendingDeletes(() => uni.reLaunch({ url: '/pages/index/index' }))
}
const onSearch = () => {
  uni.showModal({
    title: '搜索卡牌',
    editable: true,
    placeholderText: '输入关键词',
    success: async (res) => {
      if (res.confirm && res.content) {
        try {
          const { searchCards } = await import('@/api/index.js')
          const data = await searchCards({ q: res.content, libraryCode: currentLocation.value })
          cardList.value = data.list || []
        } catch (e) { /* handled */ }
      }
    }
  })
}

const showVersionPicker = () => {
  closeAllPickers()
  setTimeout(() => versionPickerRef.value?.open(selectedVersion.value.name), 350)
}

const onVersionSelect = (version) => {
  selectedVersion.value = version
  currentVersionId.value = version.id || 1
  saveState()
}

const switchLibrary = (type) => guardPendingDeletes(() => {
  currentLibrary.value = type
  selectedLocation.value = type === 'cloud' ? lastCloud.value : lastLocal.value
  currentLocation.value = selectedLocation.value.split('(')[0]
  saveState()
  loadMarkedCodes()
  fetchCards()
})
const selectGrade = () => {
  closeAllPickers()
  setTimeout(() => paramsPickerRef.value?.open(selectedRarity.value, selectedCondition.value, selectedGrade.value), 350)
}

const onParamsConfirm = (params) => {
  selectedRarity.value = params.rarity
  selectedCondition.value = params.condition || '流通品相'
  selectedGrade.value = params.grade
  saveState()
  fetchCards()
}
const selectLocation = () => {
  closeAllPickers()
  setTimeout(() => locationPickerRef.value?.open(), 350)
}

const onLocationConfirm = (data) => {
  if (!data) return
  guardPendingDeletes(() => {
    selectedLocation.value = data.value
    currentLibrary.value = data.type
    currentLocation.value = data.value ? data.value.split('(')[0] : 'A001'
    if (data.type === 'cloud') {
      lastCloud.value = data.value
    } else {
      lastLocal.value = data.value
    }
    saveState()
    loadMarkedCodes()
    fetchCards()
  })
}
const onUpload = () => {
  // 上传/下载都是**整库**级的（后端 convert 只认库编号，见 onTransferConfirm），
  // 带标记待删的卡一起搬过去的话，云端那份还得再删一遍。先让用户处理掉。
  if (pendingDeleteCount.value > 0) {
    uni.showToast({
      title: `有 ${pendingDeleteCount.value} 张标了待删，请先删除或撤销`,
      icon: 'none',
      duration: 2000,
    })
    return
  }
  const isCloud = currentLibrary.value === 'cloud'
  const libCode = currentLocation.value
  const count = cardList.value.length
  const cardIds = cardList.value.map(c => c.id)

  if (isCloud) {
    // 云端库 → 整库下载到本地
    const msg = `将云端库 ${libCode} 整体下载到本地？（${count} 张卡牌）`
    confirmDialogRef.value?.open(msg, 'convert-local', { code: libCode })
  } else {
    // 本地库 → 整库上传到云端
    const msg = `将本地库 ${libCode} 整体迁移到云端？（${count} 张卡牌）`
    confirmDialogRef.value?.open(msg, 'convert', { code: libCode })
  }
}
const onSettings = () => settingsDialogRef.value?.open()

// ========== 拍照识别 ==========
const onCamera = () => {
  uni.chooseImage({
    count: 1,
    sourceType: ['camera'],
    success: (res) => {
      const tempFilePath = res.tempFilePaths[0]
      if (!tempFilePath) return
      // 转 data URL 存下拍照图片（失败时用作卡图）
      const reader = new FileReader()
      fetch(tempFilePath).then(r => r.blob()).then(blob => {
        reader.onloadend = () => doRecognize(reader.result)
        reader.readAsDataURL(blob)
      }).catch(() => doRecognize(tempFilePath))
    },
    fail: (err) => {
      if (err.errMsg?.includes('cancel')) return
      uni.showToast({ title: '无法打开摄像头', icon: 'none' })
    }
  })
}

const retakePhoto = () => {
  previewVisible.value = false
  // 直接重新打开相机（从用户点击事件触发的，不会报安全错误）
  onCamera()
}

const confirmPhoto = async () => {
  const filePath = previewImage.value
  previewVisible.value = false
  await doRecognize(filePath)
}

const cancelPreview = () => { previewVisible.value = false }

const updateLocationCount = () => {
  const code = currentLocation.value
  const count = cardList.value.length
  selectedLocation.value = code + '(' + count + ')'
  if (currentLibrary.value === 'cloud') {
    lastCloud.value = selectedLocation.value
  } else {
    lastLocal.value = selectedLocation.value
  }
}

const doRecognize = async (filePath) => {
  const localId = Date.now()
  // 把拍照图片存下来（失败时用作卡图）
  const photoData = filePath.startsWith('data:') ? filePath : null
  cardList.value.unshift({
    id: localId, img: photoData || CARD_BACK,
    jpName: '识别中…', cnName: '', code: '...',
    rarity: selectedRarity.value, condition: selectedCondition.value, note: selectedGrade.value?.name || '78品',
    serial: nextSerial(), failed: false, photoData
  })
  // 降序排列：大号在上(A001-0009)，小号在下(A001-0001)
  cardList.value.sort((a, b) => {
    const numA = parseInt((a.serial || '').split('-').pop()) || 0
    const numB = parseInt((b.serial || '').split('-').pop()) || 0
    return numB - numA
  })
  updateLocationCount()

  // 先在后端创建占位卡（保证刷新不丢）
  let backendId = null
  if (!currentLocation.value) {
    uni.showToast({ title: '请先创建或选择卡牌库', icon: 'none', duration: 2000 })
  } else {
    try {
      const saved = await createCard({
        libraryCode: currentLocation.value,
        type: currentLibrary.value,
        jpName: '识别中…', cnName: '', code: '...',
        rarity: selectedRarity.value, condition: selectedCondition.value, note: selectedGrade.value?.name || '78品',
        versionId: currentVersionId.value, img: ''
      })
      backendId = saved.id
      // 用后端 id 替换本地 id
      const idx = cardList.value.findIndex(c => c.id === localId)
      if (idx !== -1) {
        cardList.value[idx] = { ...cardList.value[idx], id: backendId, serial: saved.serial }
      }
    } catch (e) {
      console.error('创建卡牌失败:', e)
      uni.showToast({ title: '卡牌保存失败，刷新后可能丢失', icon: 'none', duration: 2000 })
    }
  }

  // 识别
  // 提示词由后端按「当前生效方案」拼（Server/src/services/recognitionPrompt.js），
  // 这里只报"我是哪个版本"，顺便把当前选的罕贵度带过去（记缺失清单要用）。
  try {
    const result = await recognize(recogMode.value, filePath, {
      versionId: currentVersionId.value,
      versionName: selectedVersion.value.name,
      versionLang: selectedVersion.value.lang,
      rarity: selectedRarity.value,
      source: 'single',
      keyId: selectedKeyId.value || undefined,
    })
    const cardCode = result?.cardCode || ''
    if (result?.cost) {
      // 后端已记账（source=single），刷新用量显示
      loadVisionUsage()
    }
    const searchId = backendId || localId
    const idx = cardList.value.findIndex(c => c.id === searchId)
    const isValidCode = cardCode && /^[A-Za-z0-9]+-[A-Za-z0-9]+(-[A-Za-z0-9]+)?$/.test(cardCode) && cardCode !== 'FAIL'

    if (isValidCode) {
      // 查卡牌目录 + 图源里真实存在的罕贵度（两个请求并行，省一次往返）
      let cardData = null
      let rarityInfo = null
      try {
        [cardData, rarityInfo] = await Promise.all([
          lookupCard(cardCode, selectedRarity.value),
          lookupRarityInfo(cardCode),
        ])
      } catch (_) {}
      const finalJp = cardData?.jpName || (selectedVersion.value.name + '卡牌')
      const finalCn = cardData?.cnName || '卡牌名称（官方/别称）'
      const extCode = cardData?.extCode || ''

      // 罕贵度自动纠错：只认**图源里真实存在**的罕贵度。
      // 以前用的是卡牌目录字段（cardData.rarity），可目录本身就常和图源对不上
      // （PC5-JP001 目录写 N/NPR、图源只有 C），拿它纠错等于把错的那套抄一遍，
      // 纠完照样是卡背。现在改用 GET /rarity-info（扫包目录里的文件名）。
      let finalRarity = selectedRarity.value
      const realRarities = (rarityInfo?.rarityList || []).map(r => r.rarity)
      if (realRarities.length === 1) {
        // 图源里只有一种 → 直接锁定，不给敲错的机会
        finalRarity = realRarities[0]
      } else if (realRarities.length > 1 && !realRarities.includes(finalRarity)) {
        // 多种 → 用户选的如果在其中就保留，否则用第一个
        finalRarity = realRarities[0]
      }
      // 这里**不写回** selectedRarity：那是「这一批用什么罕贵度」的全局选择，
      // 被单张卡的图源结果改掉，后面识别出来的每一张都会跟着错。

      const globalLabels = cardData?.altLabels || {}
      // 只有当前罕贵度有异画版本时才设 altArtIndex
      const hasAltForRarity = Object.keys(globalLabels).some(k => k.startsWith(finalRarity + '|'))
      const initAltIdx = hasAltForRarity ? 0 : null
      // 用用户选的罕贵度查标签，查不到就遍历所有标签找匹配的
      let globalAltLabel = globalLabels[finalRarity + '|' + (initAltIdx ?? 0)] || ''
      if (!globalAltLabel && initAltIdx != null) {
        for (const [k, v] of Object.entries(globalLabels)) {
          if (k.endsWith('|' + initAltIdx) && v && v !== '待填') { globalAltLabel = v; break }
        }
      }

      // 用最终罕贵度重新生成图URL（确保图和罕贵度一致）。
      // 放在 initAltIdx 算完之后：异画要从第 0 张开始，URL 必须带上 altIndex，
      // 否则识别出来的异画卡永远显示原画。
      const finalImg = extCode
        ? buildCardImgUrl({ password: extCode, code: cardCode, rarity: finalRarity, altRarity: cardData?.altRarity, altIndex: initAltIdx || 0 })
        : (cardData?.imageUrl || CARD_BACK)
      // 保存原图（压缩后上传），开关只控制显示，识别成功一律保存
      const origDataUrl = (idx !== -1 ? cardList.value[idx].photoData : '') || ''
      const origImg = origDataUrl ? await saveOrigImage(origDataUrl) : ''
      // 这张卡登记过「信息登记」→ 新识别的这张也直接画成绿的，不用等下次刷新。
      // 问的是登记全集（markedWild / markedByKey），不是"本页有没有同编号的绿卡" —— 见上面 loadMarkedCodes。
      // 编号在目录里查不到（cardData 为空）→ 后端在这个写路径上会自动登记一条**通配**记录
      // （见 CardMark.autoRegister：那是"这个编号整个有问题"，不分罕贵度），
      // 前端这边同步补进集合，省得再拉一次接口。来源要记成 auto：
      // 紧接着点绿块想取消时，弹窗得提醒"删了会自己回来"（见 confirmUnregister）。
      if (!cardData && cardCode) {
        const c = String(cardCode).trim().toUpperCase()
        markedWild.add(c)
        markSources.set(c + '|', 'auto')
      }
      const alreadyMarked = isMarkedCode(cardCode, finalRarity)
      if (idx !== -1) cardList.value[idx] = { ...cardList.value[idx], marked: alreadyMarked, img: finalImg, jpName: finalJp, cnName: finalCn, code: cardCode, rarity: finalRarity, failed: false, photoData: null, origImg, extCode, hasAltArt: cardData?.hasAltArt || false, altCount: cardData?.altCount || 1, altArtIndex: initAltIdx, altLabel: hasAltForRarity ? (globalAltLabel || '待填') : '', altLabels: globalLabels }
      if (backendId) updateCard(backendId, { jpName: finalJp, cnName: finalCn, code: cardCode, rarity: finalRarity, extCode, origImg, altArtIndex: initAltIdx, altLabel: hasAltForRarity ? (globalAltLabel || '待填') : '', altLabels: globalLabels }).catch(() => {})
    } else {
      if (idx !== -1) {
        const photo = cardList.value[idx].photoData || cardList.value[idx].img
        cardList.value[idx] = { ...cardList.value[idx], img: photo, jpName: '识别失败', cnName: '请重拍', code: '---', failed: true }
      }
      // 失败图存到数据库（压缩后）
      const failImg = cardList.value.find(c => c.id === (backendId || localId))?.photoData || ''
      if (backendId && failImg) updateCard(backendId, { jpName: '识别失败', cnName: '请重拍', code: '---', img: failImg }).catch(() => {})
    }
  } catch (e) {
    const searchId = backendId || localId
    const idx = cardList.value.findIndex(c => c.id === searchId)
    if (idx !== -1) {
      const photo = cardList.value[idx].photoData || cardList.value[idx].img
      cardList.value[idx] = { ...cardList.value[idx], img: photo, jpName: '失败', cnName: e.message, code: '---', failed: true }
    }
    if (backendId) updateCard(backendId, { jpName: '失败', cnName: e.message, code: '---' }).catch(() => {})
  }
}

const onTransferConfirm = () => {
  // 整库迁移后刷新库列表和卡牌
  const wasLocal = currentLibrary.value === 'local'
  const libCode = currentLocation.value
  const count = cardList.value.length

  if (wasLocal) {
    // 本地→云端：切换到云端tab
    currentLibrary.value = 'cloud'
    currentLocation.value = libCode
    selectedLocation.value = libCode + '(' + count + ')'
    lastCloud.value = libCode + '(' + count + ')'
  } else {
    // 云端→本地：切换到本地tab
    currentLibrary.value = 'local'
    currentLocation.value = libCode
    selectedLocation.value = libCode + '(' + count + ')'
    lastLocal.value = libCode + '(' + count + ')'
  }
  saveState()
  fetchCards()
}

const editVisible = ref(false)
const aiLoading = ref(false)
// 编辑框只有一个入口：橙块「信息有误」（可以改编号 —— 这是唯一允许改的目录相关字段）。
// 蓝块「信息登记」现在是一键登记，不开框了，见 onRegisterCard。
const editForm = ref({ id: null, jpName: '', cnName: '', code: '', rarity: '', condition: '', note: '', extCode: '' })

const editPreviewImg = ref(CARD_BACK)

// ── 罕贵度下拉的数据源：图源里**真实存在**的罕贵度 ──
const editRarityList = ref([])
const editRarityLoading = ref(false)
const editRaritySource = ref('')
// 库里写的罕贵度在图源里不存在时的提示文案（空串 = 没问题，不显示）
const editRarityWarn = computed(() => {
  if (editRaritySource.value !== 'files' || !editRarityList.value.length) return ''
  const cur = (editForm.value.rarity || '').trim().toUpperCase()
  if (cur && editRarityList.value.some(r => r.rarity === cur)) return ''
  const opts = editRarityList.value.map(r => r.rarity).join(' / ')
  if (!cur) return `这张卡还没填罕贵度。图源里有：${opts}`
  return `罕贵度「${cur}」在图源里不存在，所以图显示不出来。图源里有：${opts}`
})

// 预览图跟着「编号 + 罕贵度」实时重建 —— 这就是用户最初报的那个问题
// （「信息有误」里改了罕贵度，图纹丝不动）最直接的体感修复：
// 改到图源里真实存在的罕贵度，图当场换；改到没有的值，当场变卡背。
// 卡密还没从目录带出来时先不动，交给 onReloadFromCatalog 设。
watch(() => [editForm.value.code, editForm.value.rarity], () => {
  const f = editForm.value
  if (!f.extCode) return
  editPreviewImg.value = buildCardImgUrl({ password: f.extCode, code: f.code, rarity: f.rarity })
})
// 编辑框里「目录」那一侧的展示状态：idle 还没查 / loading 查询中 / found 目录里有 / missing 目录里没有
const editCatalogState = ref('idle')
const editLoadedCode = ref('')

const openEditDialog = (item) => {
  // 只预填「这张卡自己」的字段。卡名/卡密属于目录，交给 onReloadFromCatalog 从目录拉。
  // 这里以前把 jpName/cnName/extCode 硬编码成空串，而保存又是全量回写 ——
  // 打开框什么都不改、只点一下保存，就把卡名清空了。这次一并修掉。
  editForm.value = { id: item.id, jpName: item.jpName||'', cnName: item.cnName||'', code: item.code||'', rarity: item.rarity||'', condition: item.condition||'', note: item.note||'', extCode: item.extCode||'' }
  editPreviewImg.value = item.img || CARD_BACK
  editLoadedCode.value = ''
  editCatalogState.value = 'idle'
  editRarityList.value = []
  editRaritySource.value = ''
  editVisible.value = true
  onReloadFromCatalog(true)
  loadEditRarities(item.code)
}
const onEditCard = (item) => openEditDialog(item)

// 拉「这张卡的图源里真实有哪些罕贵度」，供下拉点选。
// 编号改了要重拉（onReloadFromCatalog 里会调），因为选项是跟编号走的。
const loadEditRarities = async (code) => {
  const c = String(code || '').trim().toUpperCase()
  if (!c || c === '...' || c === '---') { editRarityList.value = []; editRaritySource.value = ''; return }
  editRarityLoading.value = true
  try {
    const info = await lookupRarityInfo(c)
    editRarityList.value = info.rarityList || []
    editRaritySource.value = info.source || ''
  } catch (_) {
    editRarityList.value = []; editRaritySource.value = ''
  }
  editRarityLoading.value = false
}

// 「信息登记」＝ 一键登记，不开框。
//
// 登记的不是卡名/卡图，是**编号**：整张表按编号唯一，登记一次，同编号的卡在所有库
// 都显示绿色「信息已登记」。目的是攒一份「卡名错 / 卡图错，等我人工处理」的清单
// （后台管理 → 卡牌信息记录）。
//
// 蓝块点一下 = 登记，**绿块点一下 = 取消登记**（弹框确认，见 confirmUnregister）。
// 取消的入口放在这里，是因为最常发生的场景就是"在识别现场手滑点错了，想立刻反悔"，
// 为这个跑一趟后台不划算。后台那条路照旧能用。
//
// 品相 / 备注去哪改：走橙块「信息有误」那个框，它本来就有 罕贵度 / 品相 / 备注 三栏。
// 之所以不在蓝块里再开一个框：这个按钮的用法是「一连连点几十张」，弹框会打断节奏。
//
// 粒度是 **(编号, 罕贵度)**：标了 N 就只有 N 变绿，标了 NPR 就只有 NPR 变绿 ——
// 用户要的就是这个「精准定位到哪一档有问题」。
// 本页里同编号**同罕贵度**的卡要一起变，不然只改被点的那张、另一张要刷新才变，
// 看起来就像点了没反应。
// 卡自己的罕贵度是空的时候（识别失败之类）登记的是**通配**记录，
// 那就会罩住这个编号的所有罕贵度 —— 跟库里「留空 = 不限」是一个含义。
// 返回本页受影响的张数。
const markCodeLocally = (code, rarity) => {
  const c = String(code || '').trim().toUpperCase()
  const r = String(rarity || '').trim().toUpperCase()
  if (r) markedByKey.add(c + '|' + r); else markedWild.add(c)
  重算本页标记()   // 补进全集后整页重算：本页新识别出同编号同罕贵度的卡也能立刻变绿
  return cardList.value.filter((x) =>
    String(x.code || '').trim().toUpperCase() === c && (!r || String(x.rarity || '').trim().toUpperCase() === r)
  ).length
}

// markCodeLocally 的反向：取消登记后本地立刻变回蓝块。
// 同样按 (编号, 罕贵度) 连带 —— 本页同编号同罕贵度的卡一起变，不然又是"点了没反应"。
// marked 是**整页重算**出来的，不是简单翻回 false：
// 一条通配记录能罩住好几档，取消它之后另一档如果还有独立的记录，那张就还得是绿的。
// 底色交给模板里的 :class 重新算：识别失败会变回正红、待填异画变回淡黄、其余才是白。
// 返回本页受影响的张数。
const unmarkCodeLocally = (code, rarity) => {
  const c = String(code || '').trim().toUpperCase()
  const r = String(rarity || '').trim().toUpperCase()
  const k = c + '|' + r
  markedByKey.delete(k)
  markedWild.delete(c)
  markSources.delete(k)
  重算本页标记()
  return cardList.value.filter((x) => String(x.code || '').trim().toUpperCase() === c).length
}

// 「取消登记」的确认框。
//
// 三件事必须在文案里说清，不然用户会以为只影响眼前这一张：
//   1. 删的是**一条登记记录**，**所有库**里对得上的卡都会一起变回蓝色。
//      卡本身一个字段都不动 —— 编号/卡名/卡图/备注全留着，删掉的只是"待处理"这个标记。
//   2. **范围**要说明白：带罕贵度的那条只影响那一档；通配那条（不限罕贵度）会影响这个编号的
//      所有档。不说清楚用户会以为"怎么连 NPR 也一起变蓝了"。
//   3. 自动记的那条（编号在目录里查不到时后端自己记的）删掉后**会自己回来**：
//      只要这张卡再被写一次就重新登记，而「信息有误」那个框保存时永远带编号。
//      要让它永久消失得补目录资料 —— 这条不说清楚，用户会发现"删了又变回来"，
//      然后以为是按钮坏了。
const confirmUnregister = (code, rarity, source) => new Promise((resolve) => {
  const auto = source === 'auto'
  // ⚠️ showModal 的 content 是纯文本，**没有 markdown** —— 写 `**加粗**`
  //    用户看到的就是两个星号本身。要强调只能靠措辞和换行。
  const 范围 = rarity
    ? `只有 ${code} 的 ${rarity} 这一档会变回蓝色，其它罕贵度不受影响。`
    : `这条登记的罕贵度是空的（不限罕贵度），所以 ${code} 的所有罕贵度都会变回蓝色。`
  const tail = auto
    ? '\n\n注意：这条是编号在目录里查不到时自动记的。删掉后你下次编辑保存这张卡，它会再次自动登记。要让它永久消失，得先补上这个编号的目录资料。'
    : ''
  uni.showModal({
    title: '取消登记？',
    content: `${范围}卡片本身不会删。${tail}`,
    confirmText: '取消登记',
    cancelText: '返回',
    success: (r) => resolve(!!r.confirm),
    fail: () => resolve(false),
  })
})

const onRegisterCard = async (item) => {
  const code = String(item.code || '').trim().toUpperCase()
  const rarity = String(item.rarity || '').trim().toUpperCase()

  // 绿块 → 取消登记（反悔）。蓝块 → 登记。见上面 confirmUnregister 的三条说明。
  if (item.marked) {
    if (!code || code === '...' || code === '---') return
    // 删的是**标中这张卡的那一条记录**：精确那一对优先，没有才退到通配那条。
    // 拿卡片自己的罕贵度去删是不对的 —— 一张 N 卡可能是被通配记录罩绿的。
    const k = markKeyOf(code, rarity)
    const 删编号 = k.slice(0, k.indexOf('|'))
    const 删罕贵 = k.slice(k.indexOf('|') + 1)
    const go = await confirmUnregister(删编号 || code, 删罕贵, markSources.get(k))
    if (!go) return
    try {
      const r = await deleteCardMark(删编号 || code, 删罕贵)
      const sameCount = unmarkCodeLocally(删编号 || code, 删罕贵)
      // 后端说一条都没删掉 = 记录早就不在了（比如刚在后台删过）。
      // 本地照样变回蓝色，但得如实说，别报"已取消"让人以为是自己这次删的。
      const gone = r && r.deleted === 0
      const base = gone ? '记录早已不存在，已改回蓝色' : '已取消登记'
      uni.showToast({
        title: sameCount > 1 ? `${base} · 本页 ${sameCount} 张一起变蓝` : base,
        icon: 'none',
        duration: sameCount > 1 ? 2000 : 1500,
      })
    } catch (e) {
      uni.showToast({ title: '取消失败', icon: 'none' })
    }
    return
  }

  if (!code || code === '...' || code === '---') {
    uni.showToast({ title: '这张卡还没有编号', icon: 'none', duration: 1500 })
    return
  }
  try {
    // 带上这张卡自己的罕贵度 —— 后端按 (编号, 罕贵度) 存，标 N 就只标 N。
    // rarity 为空（识别失败之类）时后端存的是通配记录，会罩住这个编号的所有罕贵度。
    const r = await markCards([{ code, rarity }], item.libraryCode || currentLocation.value || '', {
      [code]: { jpName: item.jpName || '', cnName: item.cnName || '', img: item.img || '' }
    })
    // 本地立刻变绿，不等下一次 fetchCards —— 连点几十张时这个即时反馈很重要
    const sameCount = markCodeLocally(code, rarity)
    markSources.set(code + '|' + rarity, 'manual')   // 是人点出来的；紧接着再点绿块就知道该怎么提示
    const base = r && r.added ? '已登记' : '已登记过'
    uni.showToast({
      title: sameCount > 1 ? `${base} · 本页 ${sameCount} 张一起变绿` : base,
      icon: 'success',
      duration: sameCount > 1 ? 1800 : 1200,
    })
  } catch (e) {
    uni.showToast({ title: '登记失败', icon: 'none' })
  }
}

// 按当前编号去本地目录重新带出 卡名 + 卡密（只读展示用）。
// 只读不写 —— 这个框不许改目录，也不许手改卡名/卡密；
// 要换名字只能改编号让目录重新查，或者去补目录资料。
// silent=true 时不弹提示（编号失焦这种自动触发用，免得失焦一次弹一次）。
const onReloadFromCatalog = async (silent) => {
  const code = editForm.value.code?.trim().toUpperCase()
  if (!code) return
  if (code === editLoadedCode.value) return   // 编号没变就不重查
  editLoadedCode.value = code
  aiLoading.value = true
  editCatalogState.value = 'loading'
  loadEditRarities(code)   // 选项跟着编号走，编号换了就得重拉
  try {
    const d = await lookupCard(code, editForm.value.rarity)
    if (d) {
      editForm.value.jpName = d.jpName || ''
      editForm.value.cnName = d.cnName || ''
      editForm.value.extCode = d.extCode || ''
      editCatalogState.value = 'found'
      // 用框里当前的罕贵度拼（不是目录给的），这样一打开就能看出「库里这个罕贵度在图源里到底有没有」。
      // 罕贵度为空时走兜底链，至少给张图看，不至于一开框就是卡背。
      editPreviewImg.value = d.extCode
        ? buildCardImgUrl({ password: d.extCode, code, rarity: editForm.value.rarity || '' })
        : CARD_BACK
    } else {
      // 目录里没有这个编号 → 清空展示位（这三个值不属于当前编号），不给假数据
      editForm.value.jpName = ''
      editForm.value.cnName = ''
      editForm.value.extCode = ''
      editCatalogState.value = 'missing'
    }
    if (silent !== true) {
      uni.showToast({ title: d ? '已从目录带出' : ('目录里没有 ' + code), icon: d ? 'success' : 'none', duration: 1200 })
    }
  } catch (e) {
    editCatalogState.value = 'missing'
    if (silent !== true) uni.showToast({ title: '查询失败', icon: 'none' })
  }
  aiLoading.value = false
}
const onSaveEdit = async () => {
  const f = editForm.value
  if (!f.id) return
  try {
    // 只回写「这张卡自己」的字段。卡名和卡密属于目录，不传 —— 它们由接口按编号实时带出。
    // 编号要传：这是全站唯一允许改编号的地方。
    const payload = { code: f.code, rarity: f.rarity, condition: f.condition, note: f.note }
    await updateCard(f.id, payload)
    const idx = cardList.value.findIndex(c => c.id === f.id)
    if (idx !== -1) Object.assign(cardList.value[idx], payload)
    uni.showToast({ title: '已更新', icon: 'success', duration: 1500 })
    editVisible.value = false
    fetchCards()
  } catch (e) { uni.showToast({ title: '更新失败', icon: 'none' }) }
}

// 异画版本切换
  const altKey = (item) => {
    let r = (item.rarity || '').split(/[、]/)[0]?.trim() || '?'
    // 去掉标签: SER(0,初版) → SER
    const m = r.match(/^([A-Za-z0-9]+)/)
    if (m) r = m[1]
    return r + '|' + (item.altArtIndex || 0)
  }
  const ensureAltLabels = (item) => {
    if (!item.altLabels) item.altLabels = {}
    if (!item.hasAltArt && (item.altCount||1) <= 1) return  // 无异画不设标签
    const k0 = altKey(item); if (!item.altLabels[k0]) item.altLabels[k0] = '待填'
    
  }
  const onAltPrev = (item) => {
    if (item.altArtIndex === null || item.altArtIndex === undefined) item.altArtIndex = 0
    if (item.altArtIndex > 0) {
      ensureAltLabels(item)
      // 只保存用户实际修改过的标签（非待填）
      if (item.altLabel && item.altLabel !== '待填') {
        item.altLabels[altKey(item)] = item.altLabel
      }
      item.altArtIndex--
      item.altLabel = item.altLabels[altKey(item)] || ''
      updateCardImg(item)
    }
  }
  const onAltNext = (item) => {
    if (item.altArtIndex === null || item.altArtIndex === undefined) item.altArtIndex = 0
    const maxIdx = (item.altCount || 1) - 1
    if (item.altArtIndex < maxIdx) {
      ensureAltLabels(item)
      if (item.altLabel && item.altLabel !== '待填') {
        item.altLabels[altKey(item)] = item.altLabel
      }
      item.altArtIndex++
      item.altLabel = item.altLabels[altKey(item)] || ''
      updateCardImg(item)
    }
  }
  const updateCardImg = (item) => {
    if (!item.extCode) return
    const idx = (item.altArtIndex !== null && item.altArtIndex !== undefined) ? item.altArtIndex : 0
    // altRarity 优先：异画可能挂在非 DB 罕贵上（如 DB 记 NPR、实际 SER 有异画）
    const rar = item.altRarity || item.rarity || ''
    item.img = buildCardImgUrl({ password: item.extCode, code: item.code, rarity: rar, altRarity: item.altRarity, altIndex: idx })
    if (item.id) {
      updateCard(item.id, { altArtIndex: idx, altLabel: item.altLabel || '', altLabels: item.altLabels || {} }).catch(() => {})
      if (item.code) saveAltLabelsToCatalog(item.code, item.altLabels)
    }
  }
  const saveAltLabelsToCatalog = (code, altLabels) => {
    if (!code || !altLabels) return
    const token = uni.getStorageSync('token') || ''
    fetch('/api/tcg/card/' + encodeURIComponent(code), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ altLabels })
    }).catch(() => {})
  }
  const onAltLabelSave = (item) => {
    ensureAltLabels(item)
    const idx = (item.altArtIndex !== null && item.altArtIndex !== undefined) ? item.altArtIndex : 0
    item.altLabels[altKey(item)] = item.altLabel || ''
    if (item.id) {
      updateCard(item.id, { altLabel: item.altLabel, altLabels: item.altLabels, altArtIndex: idx }).catch(() => {})
      if (item.code) saveAltLabelsToCatalog(item.code, item.altLabels)
    }
  }

const onToggleDelete = (item) => {
  if (isDeleting.value) return
  // 只改本地状态：一个请求都不发，所以"点错了"再点一下就是零成本撤销
  item.pendingDelete = !item.pendingDelete
}

// 重编号：把整库的 serial 按当前顺序重排成 A0-053-01-0001 这样连续的。
// 抽出来是因为批量删除要跑，**而且必须只跑一遍** —— 原来每删一张卡就跑一整轮，
// 删 5 张就是 5 轮，每轮几十个 PUT。
const renumberList = async () => {
  const num = (c) => parseInt((c.serial || '').split('-').pop()) || 0
  // 先升序（小号在上），i=0 变 0001
  cardList.value.sort((a, b) => num(a) - num(b))
  const prefix = currentLocation.value + '-'
  let blocked = 0   // 服务端拒掉的张数（多半是库上有没拣完的拣货单）
  for (let i = 0; i < cardList.value.length; i++) {
    const c = cardList.value[i]
    const newSerial = prefix + String(i + 1).padStart(4, '0')
    if (c.serial !== newSerial) {
      // 先把号写到服务端，**认了才改本地**。原来相反：先改本地再吞掉异常，
      // 于是碰上「库上有没拣完的拣货单」被服务端 409 拒掉时，界面上会显示一堆
      // 库里并不存在的卡位号 —— 看着重排好了，其实一张没动。
      try {
        await updateCard(c.id, { serial: newSerial })
        c.serial = newSerial
      } catch (_) { blocked++ }
    }
  }
  // 最后降序（大号在上）
  cardList.value.sort((a, b) => num(b) - num(a))
  return blocked
}

// 统一确认。一次弹窗报总张数，不是每张问一遍。
const confirmDeleteAll = (n) => new Promise((resolve) => {
  uni.showModal({
    title: '确认删除',
    content: `确认删除这 ${n} 张卡？原图会一起删掉，删完不可恢复。`,
    confirmText: '删除',
    confirmColor: '#FF3B30',
    cancelText: '再想想',
    success: (r) => resolve(!!r.confirm),
    fail: () => resolve(false),
  })
})

const doDeleteAll = async (targets) => {
  isDeleting.value = true
  let failed = 0
  let blocked = 0
  // 逐张报进度：删十几张要几秒，静默会让人以为没反应
  uni.showLoading({ title: `删除 0/${targets.length}`, mask: true })
  try {
    for (let i = 0; i < targets.length; i++) {
      uni.showLoading({ title: `删除 ${i + 1}/${targets.length}`, mask: true })
      try {
        await deleteCard(targets[i].id)
        // 服务端删掉了才从列表里拿掉。删失败就留在列表里、清掉待删标记，
        // 免得卡片从界面上消失但其实还在库里 —— 那比报错更误导人。
        cardList.value = cardList.value.filter(c => c.id !== targets[i].id)
      } catch (e) {
        failed++
        targets[i].pendingDelete = false
      }
    }
    blocked = await renumberList()
  } finally {
    uni.hideLoading()
    isDeleting.value = false
  }
  updateLocationCount()
  const doneCount = targets.length - failed
  let msg = `已删除 ${doneCount} 张`
  if (failed > 0) msg += `，${failed} 张失败（已留在列表里）`
  if (blocked > 0) msg += `；${blocked} 张没重排（库上有没拣完的拣货单）`
  uni.showToast({ title: msg, icon: 'none', duration: 3000 })
}

const onConfirmDeleteAll = async () => {
  if (isDeleting.value) return
  const targets = [...pendingDeleteList.value]
  if (!targets.length) {
    uni.showToast({ title: '没有标记待删的卡', icon: 'none' })
    return
  }
  const go = await confirmDeleteAll(targets.length)
  if (!go) return
  await doDeleteAll(targets)
}
</script>

<style scoped>
/* ========== 页面容器 ========== */
.page-container {
  background-color: #F5F5F7;
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
}

/* ========== 第1块：工具栏面板 ========== */
.toolbar-panel {
  background-color: #FFFFFF;
  border-radius: 0;
  padding: 12px 16px 10px 16px;
  flex-shrink: 0;
  position: relative;
  z-index: 201;
}

/* ========== 工具栏 ========== */
.toolbar {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  position: relative;
}

.toolbar-left {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
}

.toolbar-center {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: row;
  align-items: center;
}

.toolbar-right {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 3px;
}

.tool-title {
  font-size: 15px;
  font-weight: 500;
  color: #1A1A1A;
}

/* 是否展示原图 开关 */
.orig-switch {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
}

.orig-switch-text {
  font-size: 10px;
  color: #999999;
  white-space: nowrap;
}

.switch-track {
  width: 30px;
  height: 17px;
  border-radius: 9px;
  background-color: #D8D8D8;
  padding: 2px;
  box-sizing: border-box;
  transition: background-color 0.2s;
}

.switch-track.on {
  background-color: #FF0000;
}

.switch-thumb {
  width: 13px;
  height: 13px;
  border-radius: 7px;
  background-color: #FFFFFF;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s;
}

.switch-track.on .switch-thumb {
  transform: translateX(13px);
}

.engine-pill {
  font-size: 11px;
  color: #4A90D9;
  background: #F0F4FF;
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
}

.version-selector {
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: #F0F0F0;
  border-radius: 16px;
  padding: 6px 12px;
  gap: 4px;
}

.tool-btn {
  width: 32px;
  height: 32px;
  border-radius: 16px;
  background-color: #F0F0F0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 顶栏「删除」——把标记待删的卡一次删掉。
   宽度按实测卡在 ~56px：.toolbar-left 到中间标题的空档在 390 屏上只有 75px，
   扣掉 .toolbar-left 的 10px gap 还剩 65px。实测（360/390/412 三档，两个上传页都量过）：
     「删除」56 ✓    「删除 3」64.6 ✗    「删除 12」70.7 ✗    「确认删除」78 ✗
   所以**数字只报在弹窗里，不写在按钮上**。哪天要改文案，先按这三档重量一遍。
   中间标题是 position:absolute 居中的，不吃左右宽度，所以加这个按钮不会把标题挤歪。 */
.del-all-btn {
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: #FF3B30;
  border-radius: 14px;
  padding: 5px 10px;
}
.del-all-text {
  font-size: 11px;
  color: #FFFFFF;
}
/* 一张没标 → 变灰、点不动（点了只弹个 toast，见 onConfirmDeleteAll）。
   不隐藏是因为常驻位置更好找，也让"现在没有待删的"这件事看得见。 */
.del-all-off {
  background-color: #F0F0F0;
}
.del-all-off .del-all-text {
  color: #C7C7CC;
}

.icon-back {
  width: 18px;
  height: 18px;
}

.icon-sm {
  width: 18px;
  height: 18px;
}

.icon-xs {
  width: 14px;
  height: 14px;
}

.version-text {
  font-size: 12px;
  color: #1A1A1A;
}

.arrow {
  width: 12px;
  height: 12px;
}

/* ========== 第2块：库区域 ========== */
.lib-section {
  background-color: #FFFFFF;
  padding: 0 16px 8px 16px;
  flex-shrink: 0;
  position: relative;
  z-index: 201;
}

/* ========== 本地库/云端库切换 ========== */
.library-tab {
  display: flex;
  flex-direction: row;
  justify-content: flex-start;
  gap: 32px;
  padding-left: 8px;
}

.tab-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.tab-item text {
  font-size: 15px;
  color: #999999;
}

.tab-item text.active {
  color: #1A1A1A;
  font-weight: 500;
}

.red-line {
  width: 28px;
  height: 3px;
  background-color: #FF0000;
  border-radius: 2px;
  margin-top: 4px;
}

/* ========== 第3块：工具区 ========== */
.tool-section {
  background-color: #FFFFFF;
  padding: 0 16px 12px 16px;
  flex-shrink: 0;
  position: relative;
  z-index: 201;
}

/* ========== 筛选参数栏 ========== */
.filter-bar {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.filter-tag {
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: #F0F0F0;
  border-radius: 14px;
  padding: 5px 10px;
  gap: 4px;
}

.filter-tag-text {
  font-size: 11px;
  color: #1A1A1A;
}

.small-arrow {
  width: 10px;
  height: 10px;
}

/* ========== 可滑动卡牌列表 ========== */
.main-scroll {
  flex: 1;
  padding: 0;
  overflow-y: auto;
}

.card-list {
  padding-top: 6px;
  padding-bottom: 110px;
}

.card-item {
  display: flex;
  flex-direction: row;
  background-color: #FFFFFF;
  border-radius: 0;
  /* 右边不留内边距，让删除块贴到卡片最右边 */
  padding: 14px 0 14px 16px;
  margin-bottom: 4px;
  position: relative;
}
/* 卡片底色三档。三者 specificity 相同、都带 !important，平局时靠后声明的赢，
   所以顺序必须是 弱 → 强：待填异画（淡黄）< 信息已登记（淡红）< 识别失败（正红）。
   模板里的 :class 绑定本身已经互斥，这里是第二道保险。 */
.card-pending {
  background-color: #FFF3CD !important;
}
/* 信息已登记 → 淡红底。见卡片右下角的绿块「信息已登记」—— 底色和绿块是**同一个状态**，
   都由 marked 推出来，不是两套。所以后台把那条记录删掉，刷新后底色和绿块一起还原。
   编号查不到目录时会由后端自动登记一条（CardMark.autoRegister），效果一样。
   颜色跟订单处理页的「缺货」卡一致，但那个是无关的另一套。 */
.card-uncollected {
  background-color: #FFE8E8 !important;
}
.card-failed {
  background-color: #FF0000 !important;
}
.card-failed .jp-name,
.card-failed .cn-name,
.card-failed .meta-text,
.card-failed .serial,
.card-failed .code-text {
  color: #FFFFFF !important;
}
/* 待删（点了 ✕ 还没确认）：虚线框 + 灰底 + 内容变淡，表示"即将消失"。
   必须声明在 .card-failed 之后：几个状态类 specificity 相同、都带 !important，
   平局靠后声明的赢 —— 一张红卡（识别失败）被标待删时，得让虚框盖过红底。
   用 outline 而不是 border：border 会改变盒子尺寸，下面那几个 margin:-14px
   撑满高度的色块就对不齐了；outline 不占布局。 */
.card-to-delete {
  background-color: #EDEDED !important;
  outline: 2px dashed #FF3B30;
  outline-offset: -2px;
}
/* 文字颜色要显式写回来：红卡上的白字在灰底上看不见 */
.card-to-delete .jp-name,
.card-to-delete .cn-name,
.card-to-delete .meta-text,
.card-to-delete .serial,
.card-to-delete .code-text {
  color: #8E8E93 !important;
}
.card-to-delete .card-img,
.card-to-delete .card-orig-img {
  opacity: 0.3;
}
/* 右边这块从"删除"变成"撤销"：红底换灰底，叉换成 ↺（见模板块的 v-if） */
.card-to-delete .card-del-btn {
  background: #8E8E93;
}
/* 删除块：卡片最右边一整条竖块，红底 + 白色大叉。
   margin 的 -14px 用来抵消 .card-item 的上下内边距，让红块贴到卡片的上下边缘；
   哪天卡片的 padding 改了，这里要跟着改。 */
.card-del-btn { width:28px; flex-shrink:0; align-self:stretch; margin:-14px 0; background:#FF0000; display:flex; align-items:center; justify-content:center; }
.del-char { font-size:18px; color:#FFFFFF; line-height:1; }
/* 信息有误块：紧挨在删除块左边，橙底 + 竖排白字，跟删除块一样撑满卡片高度。
   width:1em + word-break:break-all 是把「信息有误」拆成一个字一行竖起来，
   不用 writing-mode，兼容性更稳。红底卡上保持橙色，不跟着反白。 */
.card-edit-block { width:28px; flex-shrink:0; align-self:stretch; margin:-14px 0; background:#FF9500; display:flex; align-items:center; justify-content:center; }
/* 信息登记块：紧挨在橙块左边，蓝底 + 同样的竖排白字、撑满卡片高度。
   点一下把这个编号登记进 cardmarks（不开框，见 onRegisterCard）。 */
.card-reg-block { width:28px; flex-shrink:0; align-self:stretch; margin:-14px 0; background:#4A90D9; display:flex; align-items:center; justify-content:center; }
/* 已登记：蓝块变绿「信息已登记」。**再按一下 = 取消登记**（弹框确认，见 onRegisterCard）。
   绿不跟红卡反白 —— 红卡上这个块保持绿色，正好当"这张红卡我已经登记过了"的记号。
   取消也可以去后台「卡牌信息记录」删那条，两条路等价，删的都是同一个编号的记录。 */
.card-reg-block-on { background:#34C759; }
.edit-block-text { width:1em; font-size:15px; line-height:1.1; color:#FFFFFF; word-break:break-all; text-align:center; }
/* 「信息已登记」5 个字竖排比「信息登记」4 个字高一截，字号收一档免得撑破卡片高度。
   必须声明在 .edit-block-text 之后：两个类 specificity 相同，平局时靠后的赢。 */
.edit-block-text-sm { font-size:13px; line-height:1.05; }
/* 红卡（识别失败）上删除块不再反白：橙块「信息有误」挡在中间，
   红块跟红底不直接相邻，不需要白底红叉那套了。 */
.card-failed .card-alt-badge { background: transparent !important; }
.card-failed .alt-badge-text { color: #FFFFFF !important; }

/* 异画切换 */
.alt-switcher { display:flex; flex-direction:row; align-items:center; gap:2px; margin-top:4px; background:#F5F5F7; border-radius:6px; padding:2px 4px; align-self:flex-start; }
.alt-arrow { width:20px; height:20px; display:flex; align-items:center; justify-content:center; }
.alt-arrow-text { font-size:10px; color:#4A90D9; font-weight:600; }
.alt-label-input { width:48px; height:22px; font-size:10px; text-align:center; background:#FFF; border:1px solid #E5E5EA; border-radius:4px; padding:0 2px; color:#1A1A1A; font-weight:500; }

.card-img {
  width: 59px;
  height: 86px;
  border-radius: 2px;
  background-color: #EEEEEE;
  flex-shrink: 0;
  object-fit: cover;
}

/* 原图（拍照/上传的原始卡图，开关控制显示） */
.card-orig-img {
  width: 59px;
  height: 86px;
  border-radius: 2px;
  background-color: #F0F0F0;
  flex-shrink: 0;
  object-fit: cover;
  border: 1px solid #E5E5EA;
  margin-right: 8px;
  box-sizing: border-box;
}

.card-info {
  margin-left: 12px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  flex: 1;
}

.jp-name {
  font-size: 15px;
  font-weight: 600;
  color: #1A1A1A;
  line-height: 1.8;
}
/* ruby 注音样式 */
.jp-name rt {
  font-size: 9px;
  font-weight: 400;
  color: #888;
  line-height: 1;
}

.cn-name {
  font-size: 12px;
  color: #666666;
  margin-top: 2px;
}

.card-meta {
  display: flex;
  flex-direction: row;
  gap: 8px;
  margin-top: 4px;
}

.meta-text {
  font-size: 11px;
  color: #666666;
}

.card-codes {
  display: flex; flex-direction: row; gap: 8px; align-items: center; margin-top: 2px;
  flex-wrap: wrap;
}
.serial {
  font-size: 11px; color: #999999; white-space: nowrap;
}
.ext-code {
  font-size: 10px; color: #007AFF; background: #F0F4FF; padding: 1px 6px; border-radius: 3px; white-space: nowrap;
}

/* ========== 底部拍照按钮 ========== */
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

.camera-btn--loading {
  background-color: #CC0000;
  opacity: 0.8;
}

.camera-loading-text {
  color: #FFFFFF;
  font-size: 12px;
  font-weight: 600;
}

/* 拍照预览确认弹窗 */
.preview-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.85);
  z-index: 500;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.preview-box {
  width: 90%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}

.preview-img {
  width: 100%;
  max-height: 60vh;
  border-radius: 12px;
  background-color: #333333;
}

.preview-btns {
  display: flex;
  flex-direction: row;
  gap: 16px;
  width: 100%;
}

.preview-btn {
  flex: 1;
  border-radius: 50px;
  padding: 14px;
  text-align: center;
}

.preview-btn--retake {
  background-color: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.4);
}

.preview-btn--confirm {
  background-color: #FF0000;
}

.preview-btn-text {
  font-size: 16px;
  color: #FFFFFF;
  font-weight: 500;
}

.preview-btn-text--white {
  color: #FFFFFF;
}

/* 卡牌大图预览 */
.card-preview-overlay {
  position: fixed; inset: 0; z-index: 600;
  background: rgba(0, 0, 0, 0.9);
  display: flex; align-items: center; justify-content: center;
}
.card-preview-img {
  width: 100vw; height: 100vh;
  object-fit: contain;
}
.preview-path-bar {
  position: absolute; top: 10px; right: 10px;
  display: flex; align-items: center; gap: 6px;
  background: rgba(0,0,0,0.6); border-radius: 8px; padding: 4px 10px;
}
.preview-path-text {
  font-size: 10px; color: #AAA; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.preview-path-input {
  font-size: 10px; color: #FFF; background: rgba(255,255,255,0.2); border: none; border-radius: 4px; padding: 2px 6px; width: 180px;
}
.preview-path-edit {
  font-size: 12px; color: #FFF; padding: 2px 6px;
}

/* 识别中遮罩 */
.recognize-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.3);
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: center;
}

.recognize-toast {
  background-color: #FFFFFF;
  border-radius: 12px;
  padding: 20px 32px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.recognize-toast-text {
  font-size: 15px;
  color: #1A1A1A;
  font-weight: 500;
}

.card-alt-badge { padding: 2px 8px; border-radius: 10px; display: inline-flex; align-items: center; flex-shrink: 0; }
.card-alt-badge.alt-has { background: rgba(52,199,89,0.12); }
.card-alt-badge.alt-none { background: rgba(142,142,147,0.10); }
.alt-badge-text { font-size: 10px; font-weight: 500; }
.alt-has .alt-badge-text { color: #34C759; }
.alt-none .alt-badge-text { color: #8E8E93; }
.edit-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:400; display:flex; align-items:center; justify-content:center; }
.edit-box { width:calc(100% - 48px); max-width:380px; background:#FFF; border-radius:16px; padding:24px 20px 20px; box-sizing:border-box; }
.edit-title { font-size:17px; font-weight:600; text-align:center; display:block; margin-bottom:16px; }
.edit-fields { display:flex; flex-direction:column; gap:10px; margin-bottom:20px; }
.edit-field { display:flex; flex-direction:column; gap:4px; }
.edit-label { font-size:12px; color:#999; }
.usage-val { font-size:18px; font-weight:600; color:#1A1A1A; padding:4px 0; }
.edit-input { height:40px; background:#F5F5F7; border-radius:8px; padding:0 12px; font-size:14px; box-sizing:border-box; }
/* 只读展示位：日文名/中文名/卡密属于「目录」的数据，本页不允许手改。
   样式故意做得跟 .edit-input 不一样（浅底 + 虚线边），一眼看出"这不是输入框"。 */
.edit-readonly { min-height:40px; display:flex; align-items:center; background:#FAFAFA; border:1px dashed #DDD; border-radius:8px; padding:6px 12px; font-size:14px; color:#333; box-sizing:border-box; word-break:break-all; }
.edit-hint { font-size:11px; color:#999; line-height:1.5; }
.edit-hint-warn { color:#C0392B; }
.edit-row-3 { display:flex; gap:8px; }
.edit-field-sm { flex:1; }
.edit-ai-btn { background:#F0F4FF; border:1px solid #4A90D9; border-radius:8px; padding:8px 14px; text-align:center; }
.edit-ai-loading { opacity:0.5; }
.edit-ai-text { font-size:13px; color:#4A90D9; }
.edit-btns { display:flex; gap:12px; }
.edit-btn-cancel { flex:1; height:42px; background:#F0F0F0; border-radius:24px; display:flex; align-items:center; justify-content:center; }
.edit-btn-save { flex:1; height:42px; background:#FF0000; border-radius:24px; display:flex; align-items:center; justify-content:center; }
.edit-btn-text { font-size:14px; color:#1A1A1A; font-weight:500; }
.edit-btn-text-w { color:#FFF; }
.edit-preview-row { display: flex; gap: 12px; margin-bottom: 12px; align-items: flex-start; }
.edit-preview-img { width: 59px; height: 86px; border-radius: 2px; background: #EEE; flex-shrink: 0; object-fit: cover; }
.edit-preview-right { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.lib-top-row { display: flex; justify-content: space-between; align-items: flex-end; }
.api-usage-text { font-size: 11px; color: #4A90D9; background: #F0F4FF; padding: 2px 8px; border-radius: 10px; }
.api-bar { display: flex; gap: 8px; align-items: center; }
.api-balance-text { font-size: 11px; color: #FF6600; cursor: pointer; }
</style>
