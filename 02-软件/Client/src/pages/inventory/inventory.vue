<template>
  <view class="page-container">
    <view class="toolbar-panel">
      <view class="toolbar">
        <view class="toolbar-left">
          <view class="tool-btn" @tap="goBack"><image class="icon-back" src="/static/icons/ic_back.png" mode="aspectFit" /></view>
          <view class="tool-btn" @tap="onSearch"><image class="icon-sm" src="/static/icons/ic_search.png" mode="aspectFit" /></view>
        </view>
        <text class="tool-title">已上架库</text>
        <view class="toolbar-right">
          <view class="number-btn" @tap="goStockCodes"><text class="number-btn-text">编号</text></view>
          <view class="version-selector" @tap="showVersionPicker">
            <text class="version-text">{{ selectedVersion.name }}</text>
            <image class="arrow" src="/static/icons/ic_arrow_down.png" mode="aspectFit"></image>
          </view>
        </view>
      </view>
    </view>

    <scroll-view class="main-scroll" scroll-y="true" :show-scrollbar="false">
      <view class="img-grid">
        <view class="img-cell" v-for="item in sampleCards" :key="item._key" @tap="openDetail(item)">
          <image class="img-thumb" :src="item.img || CARD_BACK" mode="aspectFill" @error="item.img = CARD_BACK" />
          <text class="card-cn-name">{{ item.cnName || item.code }}</text>
          <view class="card-code-row">
            <text class="card-code">{{ item.code }}</text>
            <text class="card-rarity-tag">{{ item.rarity }}</text>
          </view>
          <view class="card-bottom-row">
            <text class="card-cond-text">{{ item.condition || '流通品相' }}</text>
            <text class="card-note-text" v-if="item.note">{{ item.note }}</text>
          </view>
          <view class="card-qty-row">
            <text class="card-alt-tag" v-if="item.altLabel">{{ item.altLabel }}</text>
            <text class="card-qty-tag">×{{ item.qty }}</text>
          </view>
        </view>
      </view>
      <view v-if="sampleCards.length===0" class="empty-hint"><text>暂无已上架卡牌</text></view>
    </scroll-view>

    <VersionPicker ref="versionPickerRef" :top-offset="54" @select="onVersionSelect" />

    <view v-if="detailVisible" class="detail-mask" @tap="detailVisible=false">
      <view class="detail-sheet" @tap.stop>
        <view class="detail-top">
          <image class="detail-img" :src="detailCard.img || CARD_BACK" mode="aspectFill" @error="detailCard.img = CARD_BACK" />
          <view class="detail-info">
            <text class="detail-cn">{{ detailCard.cnName }}</text>
            <view class="detail-meta">
              <text class="detail-code">{{ detailCard.code }}</text>
              <text class="detail-rarity-text">{{ detailCard.rarity }}</text>
            </view>
          </view>
          <view class="detail-close" @tap="detailVisible=false"><text class="detail-close-x">✕</text></view>
        </view>
        <view class="detail-body">
          <view class="inv-row" v-for="(inv, idx) in detailCard.inventory" :key="idx">
            <text class="inv-serial">{{ inv.serial }}</text>
            <text class="inv-rarity-badge">{{ inv.rarity }}</text>
            <text class="inv-cond">{{ inv.condition }}</text>
            <text class="inv-note" v-if="inv.note">{{ inv.note }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import VersionPicker from '@/components/VersionPicker.vue'
import { 拉目录, buildCardImgUrl, CARD_BACK } from '@/api/cardDb.js'

const allCards = ref([])
const sampleCards = ref([])
const detailVisible = ref(false)
const detailCard = ref({})
const selectedVersion = ref({ name: '游戏王日文', id: 1 })

const goStockCodes = () => uni.navigateTo({ url: '/pages/admin/stock-codes' })
const searchKeyword = ref('')
const versionPickerRef = ref(null)

const goBack = () => uni.reLaunch({ url: '/pages/index/index' })

const showVersionPicker = () => {
  setTimeout(() => versionPickerRef.value?.open(selectedVersion.value.name), 350)
}

const onVersionSelect = (version) => {
  selectedVersion.value = version
  applyFilters()
}

const onSearch = () => {
  uni.showModal({
    title: '搜索卡牌',
    editable: true,
    placeholderText: '卡密 / 编号 / 中文名 / 日文名',
    success: (res) => {
      if (res.confirm) {
        searchKeyword.value = (res.content || '').trim()
        applyFilters()
      }
    }
  })
}

const applyFilters = () => {
  let cards = allCards.value

  // 版本过滤
  if (selectedVersion.value.id) {
    cards = cards.filter(c => c.versionId === selectedVersion.value.id)
  }

  // 搜索过滤（优先级：extCode > code > cnName > jpName）
  const kw = searchKeyword.value
  if (kw) {
    const kwUpper = kw.toUpperCase()
    const scored = cards.map(c => {
      let score = 0
      const extCode = String(c.extCode || '')
      const code = String(c.code || '').toUpperCase()
      const cnName = String(c.cnName || '')
      const jpName = String(c.jpName || '')

      if (extCode === kw) score = 400
      else if (extCode.includes(kw)) score = 300
      else if (code === kwUpper) score = 200
      else if (code.includes(kwUpper)) score = 150
      else if (cnName === kw) score = 100
      else if (cnName.includes(kw)) score = 80
      else if (jpName === kw) score = 50
      else if (jpName.includes(kw)) score = 30

      return { ...c, _score: score }
    }).filter(c => c._score > 0)
    .sort((a, b) => b._score - a._score)

    sampleCards.value = scored
  } else {
    sampleCards.value = cards
  }
}

const openDetail = (item) => { detailCard.value = item; detailVisible.value = true }

const fetchData = async () => {
  try {
    const token = uni.getStorageSync('token')
    const scResp = await fetch('/v1/api/admin/stock-codes?status=archived', { headers: { 'Authorization': 'Bearer ' + token } })
    const scData = await scResp.json()
    const codes = (scData.list || []).map(s => s.fullCode)
    if (codes.length === 0) { allCards.value = []; sampleCards.value = []; return }

    const cardResp = await fetch('/v1/api/cards/archived', { headers: { 'Authorization': 'Bearer ' + token } })
    const cardData = await cardResp.json()
    const list = cardData.list || []

    // 目录：编号 → { 卡密, 异画标签 }。**一份，两件事都用它。**
    //
    // 为什么要拿卡密（V1.2.85）：图源里的图按 `{编号}-{罕贵}` 命名，光有编号就能定位，
    // 但 `/card-thumbnail` 开头有一道「卡密必须合法」的门（它是路径穿越防线，卡密会被
    // 拼进 `YGOPro\{卡密}.jpg` 当文件名），空串直接 400。而卡密是**目录**的属性，
    // 所以按编号问目录（`拉目录` 的来龙去脉写在 `api/cardDb.js` 里，全站共用那一份）。
    const 目录表 = await 拉目录(list.map(c => c.code))

    // 按 code+rarity+condition+note+altLabel 五维分组
    const groupMap = {}
    list.forEach(c => {
      const 目录 = 目录表[c.code] || {}
      const cataAltLabels = 目录.altLabels || {}
      const cataKey = (c.rarity || '') + '|' + (c.altArtIndex || 0)
      const altLabel = cataAltLabels[cataKey] || c.altLabel || ''
      const key = (c.code||'?') + '|' + (c.rarity||'') + '|' + (c.condition||'') + '|' + (c.note||'') + '|' + altLabel
      if (!groupMap[key]) {
        const altIdx = c.altArtIndex || 0
        // 库存页刻意**不**用 altRarity：这里展示的是「你手上这张」的申报罕贵度，
        // 报错了就该显形（图变卡背），而不是悄悄换成另一张罕贵度的图糊过去。
        //
        // 卡密**目录优先、卡文档兜底** —— 与 `routes/libraries/index.js` 那条
        // 「一律以目录为准，取不到才退回快照」同一口径（V1.2.86 把 V1.2.85 写反的改回来）。
        //
        // 出了哪张图其实不看这个值：给了 code + rarity 时后端走「精准模式」，
        // **只认 {编号}-{罕贵} 整段命中**，卡密在那儿只负责过门（空串直接 400）。
        // 真正较真的是下面 `extCode: 卡密` 存的这个值 —— 搜索框（applyFilters）拿它比卡密，
        // 留卡文档上那个识别快照的话，就会出现「图用目录卡密出得来、搜目录卡密却搜不到」的半修状态。
        const 卡密 = 目录.extCode || c.extCode || ''
        const imgUrl = 卡密
          ? buildCardImgUrl({ password: 卡密, code: c.code, rarity: c.rarity, altIndex: altIdx })
          : (c.img || CARD_BACK)
        groupMap[key] = {
          _key: key, code: c.code, cnName: c.cnName || c.code, jpName: c.jpName || '',
          rarity: c.rarity, condition: c.condition, note: c.note, altLabel,
          // 这里存的是「页面上认的那个卡密」而不是卡文档上那个 ——
          // 搜索框（applyFilters）就是拿它比的。写成 c.extCode 的话，
          // 图上按目录卡密出得来了，搜那个卡密却搜不到，等于修一半。
          img: imgUrl, extCode: 卡密, versionId: c.versionId,
          qty: 0, inventory: []
        }
      }
      groupMap[key].qty += (c.quantity || 1)
      groupMap[key].inventory.push({
        serial: c.serial || '-', rarity: c.rarity, condition: c.condition, note: c.note
      })
    })

    allCards.value = Object.values(groupMap)
    applyFilters()
  } catch (_) { allCards.value = []; sampleCards.value = [] }
}

onMounted(fetchData)
</script>

<style scoped>
.page-container{background:#F5F5F7;display:flex;flex-direction:column;height:100vh;box-sizing:border-box}
.toolbar-panel{background:#FFF;padding:12px 16px 10px;flex-shrink:0;position:relative;z-index:201}
.toolbar{display:flex;justify-content:space-between;align-items:center;position:relative}
.toolbar-left{display:flex;align-items:center;gap:10px;z-index:1}
.tool-title{position:absolute;left:50%;transform:translateX(-50%);font-size:15px;font-weight:500;color:#1A1A1A}
.tool-btn{width:32px;height:32px;border-radius:16px;background:#F0F0F0;display:flex;align-items:center;justify-content:center}
.icon-back{width:18px;height:18px}.icon-sm{width:18px;height:18px}.icon-xs{width:14px;height:14px}
.toolbar-right{display:flex;align-items:center;gap:8px;z-index:1}
.number-btn{display:flex;align-items:center;background:#F0F0F0;border-radius:16px;padding:6px 12px;gap:4px}
.number-btn-text{font-size:12px;color:#1A1A1A}
.version-selector{display:flex;align-items:center;background:#F0F0F0;border-radius:16px;padding:6px 12px;gap:4px;z-index:1}
.version-text{font-size:12px;color:#1A1A1A}.arrow{width:12px;height:12px}

.tool-section{background:#FFF;padding:0 16px 8px;flex-shrink:0}
.filter-bar{display:flex;gap:8px}
.filter-tag{display:flex;align-items:center;background:#F0F0F0;border-radius:14px;padding:5px 10px;gap:4px}
.filter-tag-text{font-size:11px;color:#1A1A1A}

.main-scroll{flex:1;overflow-y:auto}
.img-grid{display:grid;grid-template-columns:repeat(auto-fill,110px);gap:6px;justify-content:center;padding:10px 8px 40px}
.img-cell{background:#FFF;border-radius:3px;box-shadow:0 1px 6px rgba(0,0,0,.04);display:flex;flex-direction:column;align-items:center;padding:3px 3px 2px}
.img-thumb{width:104px;height:152px;object-fit:cover;border-radius:4px;background:#E8E8ED}
.card-cn-name{font-size:13px;font-weight:600;color:#1A1A1A;text-align:left;align-self:flex-start;padding:4px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.card-code-row{display:flex;gap:4px;padding-top:1px;width:100%}
.card-code{font-size:10px;color:#999}.card-rarity-tag{font-size:10px;font-weight:700;color:#1A1A1A}
.card-bottom-row{display:flex;gap:3px;align-items:center;width:100%;padding:2px 0 0}
.card-cond-text{font-size:10px;color:#999}
.card-note-text{font-size:10px;color:#999}
.card-qty-row{display:flex;justify-content:space-between;align-items:center;width:100%;padding:2px 0 4px}
.card-alt-tag{font-size:10px;color:#4A90D9}
.card-qty-tag{font-size:10px;font-weight:600;color:#FFF;background:#888;padding:1px 6px;border-radius:4px;margin-left:auto}

.empty-hint{display:flex;align-items:center;justify-content:center;padding:80px 0;font-size:13px;color:#CCC}

.detail-mask{position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.4);display:flex;align-items:flex-end}
.detail-sheet{width:100%;height:70vh;background:#FFF;border-radius:16px 16px 0 0;padding:16px;display:flex;flex-direction:column;overflow-y:auto}
.detail-top{display:flex;gap:12px;position:relative}
.detail-img{width:72px;height:105px;border-radius:2px;background:#EEE;flex-shrink:0;object-fit:cover}
.detail-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.detail-cn{font-size:15px;font-weight:600;color:#1A1A1A}
.detail-meta{display:flex;gap:6px;margin-top:2px}
.detail-code{font-size:11px;color:#999}.detail-rarity-text{font-size:11px;font-weight:600;color:#1A1A1A}
.detail-close{position:absolute;top:0;right:0;width:28px;height:28px;border-radius:14px;background:#F0F0F0;display:flex;align-items:center;justify-content:center}
.detail-close-x{font-size:14px;color:#999}
.detail-body{margin-top:16px;padding-top:12px;border-top:1px solid #F0F0F0}
.inv-row{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #F5F5F7}
.inv-serial{font-size:13px;font-weight:500;color:#1A1A1A;min-width:80px}
.inv-rarity-badge{font-size:11px;color:#007AFF;background:#F0F4FF;padding:1px 5px;border-radius:3px}
.inv-cond{font-size:11px;color:#FF0000;margin-left:auto}.inv-note{font-size:10px;color:#999;margin-left:4px}

@media(min-width:480px){.img-grid{grid-template-columns:repeat(auto-fill,140px)}}
@media(min-width:768px){.img-grid{grid-template-columns:repeat(auto-fill,150px)}}
</style>
