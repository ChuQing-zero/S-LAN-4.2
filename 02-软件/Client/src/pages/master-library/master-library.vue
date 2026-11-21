<template>
  <view class="page-container">
    <!-- 工具栏 -->
    <view class="toolbar-panel">
      <view class="toolbar">
        <view class="toolbar-left">
          <view class="tool-btn" @tap="goBack">
            <image class="icon-back" src="/static/icons/ic_back.png" mode="aspectFit"></image>
          </view>
        </view>
        <text class="tool-title">总管理库</text>
        <view class="toolbar-right"></view>
      </view>
    </view>

    <!-- 统计条 -->
    <view class="stats-bar">
      <text class="stat-item">📦 {{ stats.totalGroups }} 组</text>
      <text class="stat-item">🃏 {{ stats.totalCards }} 张</text>
      <text class="stat-item stat-listed">✅ {{ stats.totalListed }} 已上架</text>
      <text class="stat-item stat-unlisted">⚠️ {{ stats.totalUnlisted }} 未上架</text>
    </view>

    <!-- 筛选栏 -->
    <view class="filter-bar">
      <view class="filter-row">
        <view class="filter-tag version-tag" @tap="showVersionPicker">
          <text>{{ selectedVersion.name }}</text>
          <image class="small-arrow" src="/static/icons/ic_arrow_down.png" mode="aspectFit"></image>
        </view>
        <view class="filter-tag" @tap="cycleListedFilter">
          <text>{{ listedFilterLabel }}</text>
        </view>
        <view class="search-box">
          <input class="search-input" v-model="searchText" placeholder="搜索卡牌编号/名称"
            @confirm="doSearch" />
          <image class="search-icon" src="/static/icons/ic_search.png" mode="aspectFit" @tap="doSearch"></image>
        </view>
      </view>
    </view>

    <!-- 卡牌组列表 -->
    <scroll-view class="main-scroll" scroll-y="true" :show-scrollbar="false"
      @scrolltolower="loadMore" :refresher-enabled="true" @refresherrefresh="onRefresh">
      <view class="group-list">
        <view class="group-item" v-for="group in groupList" :key="group.code" @tap="toggleExpand(group.code)">
          <!-- 折叠头部 -->
          <view class="group-header">
            <image class="group-img" :src="groupImage(group)" mode="aspectFill" @error="onGroupImgError(group)"></image>
            <view class="group-info">
              <text class="group-code">{{ group.code }}</text>
              <rich-text class="group-jp" :nodes="toRubyHtml(group.jpName)"></rich-text>
              <text class="group-cn">{{ group.cnName }}</text>
              <view class="group-tags">
                <text class="tag-rarity" v-for="(cnt, r) in group.rarities" :key="r">{{ r }}×{{ cnt }}</text>
              </view>
            </view>
            <view class="group-stats">
              <text class="stat-num">{{ group.totalCount }}张</text>
              <view class="stat-listed-bar">
                <view class="bar-filled" :style="{ width: barPercent(group) + '%' }"></view>
                <view class="bar-empty"></view>
              </view>
              <text class="stat-sub">✅{{ group.listedCount }} ⚠️{{ group.unlistedCount }}</text>
            </view>
            <text class="expand-arrow" :class="{ expanded: expandedGroups[group.code] }">▶</text>
          </view>

          <!-- 展开详情 -->
          <view class="group-detail" v-if="expandedGroups[group.code]">
            <!-- 子卡牌表格 -->
            <view class="detail-table">
              <view class="table-header">
                <text class="th-serial">库编号</text>
                <text class="th-library">所在库</text>
                <text class="th-rarity">罕贵度</text>
                <text class="th-condition">品相</text>
                <text class="th-status">状态</text>
              </view>
              <view class="table-row" v-for="card in group.subCards" :key="card.serial"
                :class="{ 'row-unlisted': !card.listed }">
                <text class="td-serial">{{ card.serial }}</text>
                <text class="td-library">{{ card.libraryCode }}</text>
                <text class="td-rarity">{{ card.rarity }}</text>
                <text class="td-condition">{{ card.condition }}</text>
                <text class="td-status" :class="card.listed ? 'status-ok' : 'status-no'">
                  {{ card.listed ? '已上架' : '未上架' }}
                </text>
              </view>
            </view>

            <!-- 操作按钮 -->
            <view class="detail-actions">
              <view class="action-btn action-list" v-if="group.unlistedCount > 0"
                @tap.stop="listGroupCards(group)">
                <text>📋 上架 {{ group.unlistedCount }} 张未上架</text>
              </view>
              <view class="action-btn action-mark" @tap.stop="toggleAllListed(group)">
                <text>{{ group.unlistedCount > 0 ? '✅ 标记全部已上架' : '🔄 取消全部上架' }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <view v-if="groupList.length === 0 && !loading" class="empty-state">
        <text>暂无卡牌数据</text>
        <text class="empty-sub">请先在「识别上传」中添加卡牌</text>
      </view>
    </scroll-view>

    <!-- 一键上架按钮 -->
    <view class="float-btn" @tap="onBatchList" v-if="stats.totalUnlisted > 0">
      <text>🚀 一键上架全部未上架 ({{ stats.totalUnlisted }})</text>
    </view>

    <!-- 版本选择弹窗 -->
    <VersionPicker ref="versionPickerRef" :top-offset="54" @select="onVersionSelect" />
  </view>
</template>

<script setup>
import { ref, computed, reactive } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import VersionPicker from '@/components/VersionPicker.vue'
import { getMasterLibrarySummary, markCardsListed, markCardsUnlisted } from '@/api/index.js'
import { toRubyHtml } from '@/utils/ruby.js'
import { 拉目录, buildCardImgUrl, CARD_BACK } from '@/api/cardDb.js'

// ========== 数据状态 ==========
const groupList = ref([])
const loading = ref(false)
const page = ref(1)
const pageSize = 30
const totalPages = ref(1)
const searchText = ref('')
const listedFilter = ref('unlisted')  // all | listed | unlisted
const expandedGroups = reactive({})
const selectedVersion = ref({ id: 1, name: '游戏王日文' })
const stats = reactive({
  totalCards: 0, totalGroups: 0, totalListed: 0, totalUnlisted: 0
})

const versionPickerRef = ref(null)

const listedFilterLabel = computed(() => {
  const map = { all: '全部', listed: '已上架', unlisted: '未上架' }
  return map[listedFilter.value]
})

// ========== 加载数据 ==========
const fetchSummary = async (isRefresh = false) => {
  if (isRefresh) page.value = 1
  loading.value = true
  try {
    const params = {
      versionId: selectedVersion.value.id,
      listed: listedFilter.value,
      page: page.value,
      pageSize
    }
    if (searchText.value) params.search = searchText.value

    const data = await getMasterLibrarySummary(params)
    if (isRefresh || page.value === 1) {
      groupList.value = data.groups || []
    } else {
      groupList.value = [...groupList.value, ...(data.groups || [])]
    }
    // ★ 从 `groupList.value`（响应式代理）上取，不用上面那个 `data.groups` 原始数组：
    //   这一屏已经渲染过了，往 raw 对象上写 `catImg` 绕过 Proxy 的 set 陷阱，不会触发重渲染。
    //   幂等：已经填过的组再填一次无害，只是多问一次目录。
    回填组图(groupList.value)
    if (data.stats) {
      Object.assign(stats, data.stats)
    }
    if (data.pagination) {
      totalPages.value = data.pagination.totalPages
    }
  } catch (e) {
    console.error('加载总库失败:', e)
    uni.showToast({ title: '加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

onShow(() => {
  fetchSummary(true)
})

const onRefresh = () => fetchSummary(true)
const loadMore = () => {
  if (page.value < totalPages.value) {
    page.value++
    fetchSummary()
  }
}

// ========== 交互 ==========
const goBack = () => uni.reLaunch({ url: '/pages/index/index' })

const toggleExpand = (code) => {
  expandedGroups[code] = !expandedGroups[code]
}

const barPercent = (group) => {
  if (group.totalCount === 0) return 0
  return Math.round((group.listedCount / group.totalCount) * 100)
}

// 组缩略图：实拍原图 > 目录现拼的官方图 > 卡背。
//
// 以前这里读的是 `subCards[0].img`，来自服务端聚合的 `img: '$img'` —— 而 `Card.img`
// 建卡时就被硬编码成 `''`，清库前 38,767 张填充率 0.00%。所以这页是**结构性恒卡背**，
// 跟数据无关（V1.2.86）。官方图得按 `{编号}+{罕贵}` 现拼，卡密问目录要 —— 详见 cardDb.js。
const groupImage = (group) => {
  if (group.imgFallback) return CARD_BACK
  const card = group.subCards?.[0]
  return card?.origImg || group.catImg || CARD_BACK
}

// 卡图加载失败 → 落卡背。
// 标志位置在**组**上，不再往 card.img 里写卡背 —— 那是个永远不会被读的死字段，
// 写进去等于什么都没发生（而且会把原值覆盖掉）。
const onGroupImgError = (group) => { group.imgFallback = true }

// 按编号问目录，现拼每个组第一张卡的官方图（一组一张代表图）
const 回填组图 = async (组们) => {
  const 有编号 = 组们.filter(g => g && g.code)
  if (!有编号.length) return
  const 表 = await 拉目录(有编号.map(g => g.code))
  for (const g of 有编号) {
    const 卡密 = (表[g.code] || {}).extCode || ''
    // 用第一张子卡的罕贵度走精准模式；目录里查不到的编号留空 → 卡背
    g.catImg = buildCardImgUrl({ password: 卡密, code: g.code, rarity: g.subCards?.[0]?.rarity })
  }
}

const doSearch = () => { page.value = 1; fetchSummary(true) }

const cycleListedFilter = () => {
  const cycle = ['all', 'listed', 'unlisted']
  const idx = cycle.indexOf(listedFilter.value)
  listedFilter.value = cycle[(idx + 1) % 3]
  page.value = 1
  fetchSummary(true)
}

const showVersionPicker = () => {
  setTimeout(() => versionPickerRef.value?.open(selectedVersion.value.name), 350)
}

const onVersionSelect = (version) => {
  selectedVersion.value = version
  page.value = 1
  fetchSummary(true)
}

// ========== 批量操作 ==========
const toggleAllListed = async (group) => {
  const unlistedCards = group.subCards.filter(c => !c.listed)
  const listedCards = group.subCards.filter(c => c.listed)

  if (unlistedCards.length > 0) {
    // 标记全部已上架
    const ids = group.subCards.map(c => c.cardId)
    uni.showModal({
      title: '确认操作',
      content: `将 "${group.code}" 的全部 ${group.totalCount} 张卡牌标记为已上架？`,
      success: async (res) => {
        if (res.confirm) {
          try {
            await markCardsListed(ids)
            fetchSummary(true)
            uni.showToast({ title: '已标记', icon: 'success' })
          } catch (e) {
            uni.showToast({ title: '操作失败', icon: 'none' })
          }
        }
      }
    })
  } else {
    // 全部取消
    const ids = group.subCards.map(c => c.cardId)
    uni.showModal({
      title: '确认操作',
      content: `取消 "${group.code}" 的全部 ${group.totalCount} 张卡牌上架标记？`,
      success: async (res) => {
        if (res.confirm) {
          try {
            await markCardsUnlisted(ids)
            fetchSummary(true)
            uni.showToast({ title: '已取消', icon: 'success' })
          } catch (e) {
            uni.showToast({ title: '操作失败', icon: 'none' })
          }
        }
      }
    })
  }
}

const listGroupCards = (group) => {
  // 跳转到自动上架页面，携带要上架的卡牌信息
  const unlistedIds = group.subCards.filter(c => !c.listed).map(c => c.cardId)
  uni.setStorageSync('auto_list_queue', {
    groupCode: group.code,
    cardIds: unlistedIds
  })
  uni.navigateTo({ url: '/pages/auto-listing/auto-listing' })
}

const onBatchList = () => {
  // 一键上架全部未上架
  uni.showModal({
    title: '一键上架',
    content: `确定要对全部 ${stats.totalUnlisted} 张未上架卡牌启动自动上架？\n\n将跳转到自动上架页面逐张处理。`,
    success: (res) => {
      if (res.confirm) {
        // 收集所有未上架卡牌ID
        const allUnlisted = []
        groupList.value.forEach(g => {
          g.subCards.forEach(c => {
            if (!c.listed) allUnlisted.push(c.cardId)
          })
        })
        uni.setStorageSync('auto_list_queue', {
          groupCode: 'BATCH',
          cardIds: allUnlisted
        })
        uni.navigateTo({ url: '/pages/auto-listing/auto-listing' })
      }
    }
  })
}
</script>

<style scoped>
.page-container {
  background-color: #F5F5F7;
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
}

/* 工具栏 */
.toolbar-panel {
  background-color: #FFFFFF;
  border-radius: 0;
  padding: 12px 16px 10px 16px;
  flex-shrink: 0;
}

.toolbar {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.toolbar-left, .toolbar-right {
  width: 60px;
}

.tool-btn {
  width: 32px; height: 32px;
  border-radius: 16px;
  background-color: #F0F0F0;
  display: flex; align-items: center; justify-content: center;
}

.icon-back { width: 18px; height: 18px; }

.tool-title {
  font-size: 15px; font-weight: 500; color: #1A1A1A;
}

/* 统计条 */
.stats-bar {
  display: flex; flex-direction: row; gap: 10px;
  padding: 8px 16px;
  background: #FFFFFF;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.stat-item {
  font-size: 12px; color: #666; background: #F5F5F7;
  padding: 3px 10px; border-radius: 12px;
}

.stat-listed { color: #34C759; }
.stat-unlisted { color: #FF9500; }

/* 筛选栏 */
.filter-bar {
  background: #FFFFFF; padding: 0 16px 10px 16px; flex-shrink: 0;
}

.filter-row {
  display: flex; flex-direction: row; gap: 8px; align-items: center;
}

.filter-tag {
  display: flex; flex-direction: row; align-items: center;
  background: #F0F0F0; border-radius: 14px; padding: 5px 10px; gap: 4px;
  font-size: 11px; color: #1A1A1A;
}

.version-tag { background: #FFF3F3; border: 1px solid #FF0000; }

.search-box {
  flex: 1; display: flex; align-items: center;
  background: #F0F0F0; border-radius: 14px; padding: 5px 10px;
}

.search-input { flex: 1; font-size: 12px; height: 22px; }

.search-icon { width: 16px; height: 16px; flex-shrink: 0; }

.small-arrow { width: 10px; height: 10px; }

/* 卡牌列表 */
.main-scroll { flex: 1; overflow-y: auto; padding-bottom: 60px; }

.group-list { padding-top: 6px; }

.group-item {
  background: #FFFFFF; margin: 0 8px 6px;
  border-radius: 12px; overflow: hidden;
}

.group-header {
  display: flex; flex-direction: row; align-items: center;
  padding: 12px; gap: 10px;
}

.group-img {
  width: 59px; height: 86px; border-radius: 2px;   /* 卡图圆角全站统一 2px */
  background: #EEE; flex-shrink: 0; object-fit: cover;
}

.group-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }

.group-code { font-size: 14px; font-weight: 600; color: #1A1A1A; }
.group-jp { font-size: 12px; color: #1A1A1A; line-height: 1.7; }
.group-jp rt { font-size: 7px; color: #999; font-weight: 400; }
.group-cn { font-size: 11px; color: #666; }

.group-tags { display: flex; flex-direction: row; gap: 4px; flex-wrap: wrap; margin-top: 2px; }

.tag-rarity {
  font-size: 10px; color: #007AFF; background: #F0F4FF;
  padding: 1px 6px; border-radius: 8px;
}

.group-stats {
  display: flex; flex-direction: column; align-items: flex-end; gap: 4px;
  flex-shrink: 0;
}

.stat-num { font-size: 14px; font-weight: 600; color: #1A1A1A; }

.stat-listed-bar {
  display: flex; flex-direction: row; width: 60px; height: 4px;
  border-radius: 2px; overflow: hidden;
}

.bar-filled { background: #34C759; height: 100%; }
.bar-empty { flex: 1; background: #FF9500; height: 100%; }

.stat-sub { font-size: 10px; color: #999; }

.expand-arrow {
  font-size: 12px; color: #999; transition: transform 0.2s;
  flex-shrink: 0;
}

.expand-arrow.expanded { transform: rotate(90deg); }

/* 展开详情 */
.group-detail {
  border-top: 1px solid #F0F0F0; padding: 8px 12px;
}

.detail-table { display: flex; flex-direction: column; }

.table-header, .table-row {
  display: flex; flex-direction: row; gap: 6px; padding: 4px 0;
  font-size: 11px; border-bottom: 1px solid #F5F5F7;
}

.table-header { color: #999; font-weight: 500; }
.table-row { color: #666; }
.row-unlisted { background: #FFF8F0; }

.th-serial, .td-serial { flex: 2.5; }
.th-library, .td-library { flex: 1.2; }
.th-rarity, .td-rarity { flex: 1.2; }
.th-condition, .td-condition { flex: 1; }
.th-status, .td-status { flex: 1.2; text-align: right; }

.status-ok { color: #34C759; }
.status-no { color: #FF9500; font-weight: 500; }

.detail-actions {
  display: flex; flex-direction: row; gap: 8px; margin-top: 8px;
}

.action-btn {
  flex: 1; text-align: center; padding: 8px; border-radius: 20px;
  font-size: 12px; font-weight: 500;
}

.action-list { background: #FF0000; color: #FFFFFF; }
.action-mark { background: #F0F0F0; color: #1A1A1A; }

.empty-state {
  display: flex; flex-direction: column; align-items: center;
  padding: 40px; gap: 8px;
  color: #999; font-size: 14px;
}

.empty-sub { font-size: 12px; color: #BBB; }

/* 浮动按钮 */
.float-btn {
  position: fixed; bottom: 35px; left: 50%; transform: translateX(-50%);
  background: #FF0000; color: #FFFFFF; padding: 12px 28px;
  border-radius: 28px; font-size: 14px; font-weight: 600;
  box-shadow: 0 4px 12px rgba(255,0,0,0.35);
  z-index: 100;
}
</style>
