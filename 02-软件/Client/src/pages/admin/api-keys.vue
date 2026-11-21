<template>
  <view class="page-container">
    <view class="toolbar-panel">
      <view class="toolbar">
        <view class="toolbar-left">
          <view class="tool-btn" @tap="goBack"><image class="icon-back" src="/static/icons/ic_back.png" mode="aspectFit" /></view>
        </view>
        <text class="tool-title">AI识别管理</text>
        <view class="toolbar-right">
          <view v-if="currentTab === 'keys'" class="add-btn" @tap="openCreate"><text class="add-btn-text">＋ 新增钥匙</text></view>
        </view>
      </view>
    </view>

    <!-- Tab 切换 -->
    <view class="lib-tabs">
      <view class="tab-item" @tap="switchTab('usage')">
        <text :class="{ active: currentTab === 'usage' }">用量信息</text>
        <view v-if="currentTab === 'usage'" class="red-line"></view>
      </view>
      <view class="tab-item" @tap="switchTab('keys')">
        <text :class="{ active: currentTab === 'keys' }">API keys</text>
        <view v-if="currentTab === 'keys'" class="red-line"></view>
      </view>
      <view class="tab-item" @tap="switchTab('recharge')">
        <text :class="{ active: currentTab === 'recharge' }">充值</text>
        <view v-if="currentTab === 'recharge'" class="red-line"></view>
      </view>
      <view class="tab-item" @tap="switchTab('prompt')">
        <text :class="{ active: currentTab === 'prompt' }">提示词方案</text>
        <view v-if="currentTab === 'prompt'" class="red-line"></view>
      </view>
    </view>

    <!-- ═══ Tab 1：用量信息 ═══ -->
    <scroll-view v-if="currentTab === 'usage'" class="tab-body" scroll-y="true">
      <!-- 顶部汇总：今日 + 累计 -->
      <view class="usage-overview">
        <view class="uv-box"><text class="uv-label">今日 Token</text><text class="uv-val">{{ formatTokens(todayStat.tokens) }}</text></view>
        <view class="uv-box"><text class="uv-label">今日费用</text><text class="uv-val">¥{{ formatYuan(todayStat.costYuan) }}</text></view>
        <view class="uv-box"><text class="uv-label">累计 Token</text><text class="uv-val">{{ formatTokens(stats.totals.tokens) }}</text></view>
        <view class="uv-box"><text class="uv-label">累计费用</text><text class="uv-val">¥{{ formatYuan(stats.totals.costYuan) }}</text></view>
      </view>

      <!-- 近30天趋势柱状图 -->
      <view class="sec-title chart-title">
        <text>近30天用量趋势</text>
        <picker :range="chartKeyOptions" @change="onChartKeyChange">
          <view class="chart-picker">
            <text class="chart-picker-text">{{ chartKeyLabel }}</text>
            <text class="chart-picker-arrow">▾</text>
          </view>
        </picker>
      </view>
      <view class="chart-card">
        <view class="chart-sel">
          <text class="chart-date">{{ selStat.label }}（{{ selStat.date }}）</text>
          <view class="chart-vals">
            <text class="chart-val">{{ formatTokens(selStat.tokens) }} token</text>
            <text class="chart-sub">{{ selStat.calls }} 次 · ¥{{ formatYuan(selStat.costYuan) }}</text>
          </view>
        </view>
        <view class="bar-chart">
          <view v-for="(d, i) in chartDays" :key="i" class="bar-col" @tap="barTap(i)">
            <view class="bar" :class="{ on: i === selIdx }" :style="{ height: barHeight(d) + '%' }"></view>
          </view>
        </view>
        <view class="chart-axis"><text>30天前</text><text>今天</text></view>
      </view>

      <!-- 每把钥匙用量 + 占比 -->
      <view class="sec-title">每把钥匙用量（共 {{ stats.total }} 把）</view>
      <view class="sub-item" v-for="(p, i) in stats.perKey" :key="i">
        <view class="sub-left">
          <text class="sub-name">{{ p.keyName }}</text>
          <view class="bar-track"><view class="bar-fill" :style="{ width: keyPercent(p.tokens) + '%' }"></view></view>
          <text class="sub-meta">{{ formatTokens(p.tokens) }} token · {{ p.calls }} 次 · 占比 {{ keyPercent(p.tokens) }}%</text>
        </view>
        <text class="sub-cost">¥{{ formatYuan(p.costYuan) }}</text>
      </view>
      <view v-if="!stats.perKey.length" class="empty"><text class="empty-text">暂无用量记录</text></view>

      <!-- 每日明细 -->
      <view class="sec-title">每日明细（近30天）</view>
      <view class="daily-item" v-for="(d, i) in dailyList" :key="i">
        <text class="daily-date">{{ d.date }}</text>
        <text class="daily-tokens">{{ formatTokens(d.tokens) }} token</text>
        <text class="daily-calls">{{ d.calls }} 次</text>
        <text class="daily-cost">¥{{ formatYuan(d.costYuan) }}</text>
      </view>
      <view v-if="!dailyList.length" class="empty"><text class="empty-text">近30天暂无用量</text></view>
    </scroll-view>

    <!-- ═══ Tab 2：API keys ═══ -->
    <scroll-view v-if="currentTab === 'keys'" class="tab-body" scroll-y="true">
      <view class="hint-bar">
        <text class="hint-text">钥匙明文只存后端，识别上传 / 批量识别共用默认钥匙。换钥匙、换URL不影响模型。</text>
      </view>

      <view class="key-item" v-for="k in keys" :key="k._id">
        <view class="key-head">
          <text class="key-name">{{ k.name || '未命名' }}</text>
          <text class="key-badge default" v-if="k.isDefault">默认</text>
          <text class="key-badge" :class="k.enabled ? 'on' : 'off'">{{ k.enabled ? '启用' : '停用' }}</text>
          <view class="sw" :class="{ on: k.enabled }" @tap="onToggleEnabled(k)">
            <view class="knob"></view>
          </view>
        </view>

        <view class="key-meta">
          <text class="km-line">钥匙：{{ k.maskedKey }}</text>
          <text class="km-line">模型：{{ k.model }}</text>
          <text class="km-line">绑定账号：{{ (k.ownerNicknames && k.ownerNicknames.length) ? k.ownerNicknames.join('、') : '未绑定' }}</text>
          <text class="km-line" v-if="k.apiUrl">URL：{{ k.apiUrl }}</text>
          <text class="km-line">用量：{{ formatTokens(k.usage.tokens) }} token · {{ k.usage.calls }} 次 · ¥{{ formatYuan(k.usage.costYuan) }}</text>
          <text class="km-line note" v-if="k.note">备注：{{ k.note }}</text>
          <text class="km-line test-result" v-if="k.testResult">{{ k.testResult }}</text>
          <text class="km-line test-result" v-if="k.testing">测试中…</text>
        </view>

        <view class="key-actions">
          <view class="rbtn" @tap="onTest(k)"><text>{{ k.testing ? '测试中' : '测试' }}</text></view>
          <view class="rbtn" v-if="!k.isDefault" @tap="onSetDefault(k)"><text>设默认</text></view>
          <view class="rbtn" @tap="openEdit(k)"><text>编辑</text></view>
          <view class="rbtn del" @tap="openDelete(k)"><text>删除</text></view>
        </view>
      </view>

      <view v-if="!loading && !keys.length" class="empty"><text class="empty-text">暂无钥匙，点右上角「新增钥匙」添加</text></view>
      <view v-if="loading" class="empty"><text class="empty-text">加载中…</text></view>
    </scroll-view>

    <!-- ═══ Tab 3：充值 ═══ -->
    <scroll-view v-if="currentTab === 'recharge'" class="tab-body" scroll-y="true">
      <view class="sec-title">充值说明</view>
      <view class="recharge-desc">
        钥匙的调用费用从对应平台的账户余额扣，余额不足时识别会失败。
        <text>点下面的入口跳转到对应平台官网，登录后即可充值。</text>
      </view>

      <view class="recharge-card" @tap="openExternal('https://console.volcengine.com/ark')">
        <text class="rc-icon">☁️</text>
        <view class="rc-info">
          <text class="rc-name">火山方舟（豆包 API）</text>
          <text class="rc-desc">查看余额 · 充值 · 管理钥匙</text>
        </view>
        <text class="rc-arrow">›</text>
      </view>
      <view class="recharge-card" @tap="openExternal('https://platform.deepseek.com/')">
        <text class="rc-icon">🧠</text>
        <view class="rc-info">
          <text class="rc-name">DeepSeek 开放平台</text>
          <text class="rc-desc">充值 · 查看用量</text>
        </view>
        <text class="rc-arrow">›</text>
      </view>
      <view class="recharge-card" @tap="openExternal('https://www.doubao.com')">
        <text class="rc-icon">🔍</text>
        <view class="rc-info">
          <text class="rc-name">豆包 官网</text>
          <text class="rc-desc">产品介绍 · 更多信息</text>
        </view>
        <text class="rc-arrow">›</text>
      </view>

      <view class="sec-title">使用教程</view>
      <view class="tutorial">
        <text class="tu-line">1. 在「API keys」页点「＋ 新增钥匙」，粘贴从平台获取的钥匙明文。</text>
        <text class="tu-line">2. 点「测试」确认钥匙能连通；设默认后，识别上传 / 批量识别默认用它。</text>
        <text class="tu-line">3. 用量、费用在「用量信息」页实时累计；余额不足时到对应平台官网充值。</text>
      </view>
    </scroll-view>

    <!-- ═══ Tab 4：提示词方案 ═══ -->
    <scroll-view v-if="currentTab === 'prompt'" class="tab-body" scroll-y="true">

      <!-- ── 子视图：目录缺失编号清单 ── -->
      <template v-if="showMissing">
        <view class="sub-head">
          <view class="sub-back" @tap="showMissing = false"><text class="sub-back-text">‹ 返回</text></view>
          <text class="sub-title">目录缺失编号清单</text>
        </view>

        <view class="mc-summary">
          <view class="mc-sum-item"><text class="mc-sum-val">{{ missingSummary.pending }}</text><text class="mc-sum-label">待补</text></view>
          <view class="mc-sum-item"><text class="mc-sum-val ok">{{ missingSummary.filled }}</text><text class="mc-sum-label">已补上</text></view>
          <view class="mc-sum-item"><text class="mc-sum-val">{{ missingSummary.total }}</text><text class="mc-sum-label">合计</text></view>
        </view>

        <view class="mc-hint">
          AI 认出了编号、但卡牌目录里查不到，就会自动记到这里，同一个编号只记一条。
          把资料补进目录后回来看，行会变绿、图片会出来。
        </view>
        <view class="mc-refresh" @tap="loadMissing">
          <text class="mc-refresh-text">{{ missingLoading ? '刷新中…' : '↻ 刷新' }}</text>
        </view>

        <view v-for="m in missingList" :key="m.code" class="mc-row" :class="{ filled: m.filled }">
          <view class="mc-img-box">
            <image v-if="m.filled && m.extCode" class="mc-img" :src="thumbUrl(m)" mode="aspectFit" @error="m.extCode = ''" />
            <text v-else class="mc-img-empty">无图</text>
          </view>
          <view class="mc-info">
            <text class="mc-code">{{ m.code }}</text>
            <view class="mc-tags">
              <text class="mc-tag">{{ m.rarity || '罕贵未填' }}</text>
              <text class="mc-tag">{{ m.versionName || '版本未知' }}</text>
            </view>
            <text v-if="m.filled" class="mc-name">{{ m.cnName || m.jpName || '—' }}</text>
            <text class="mc-sub">首次 {{ fmtDate(m.firstSeenAt) }} · 见过 {{ m.seenCount }} 次</text>
          </view>
          <text class="mc-state" :class="{ ok: m.filled }">{{ m.filled ? '已补上' : '待补' }}</text>
        </view>

        <view v-if="!missingList.length && !missingLoading" class="mc-empty">
          还没有记录。等出现「AI 认出来但目录里没有」的卡，会自动记到这里。
        </view>
      </template>

      <!-- ── 主视图：方案选择 ── -->
      <template v-else>
        <view class="sec-title">调试版本</view>
        <view class="ver-grid">
          <view
            class="ver-item"
            :class="{ 'ver-item-active': promptVersionId === v.id }"
            v-for="v in versionList"
            :key="v.id"
            @tap="pickVersion(v)"
          >
            <view class="ver-logo-wrap">
              <image class="ver-logo" :src="v.logo" mode="aspectFit" />
              <view class="ver-lang">{{ v.lang }}</view>
            </view>
            <text class="ver-name">{{ v.name }}</text>
          </view>
        </view>

        <view class="sec-title">提示词方案（点一下切换，切换后新的识别立即用它）</view>

        <view v-if="promptData && !promptData.grouped" class="pm-fallback">{{ promptList[0] && promptList[0].note }}</view>

        <view
          v-for="p in promptList"
          :key="p.id"
          class="pm-card"
          :class="{ on: p.active }"
          @tap="pickPrompt(p)"
        >
          <view class="pm-head">
            <text class="pm-radio" :class="{ on: p.active }">{{ p.active ? '◉' : '○' }}</text>
            <text class="pm-name">{{ p.name }}</text>
            <view v-if="p.builtin" class="pm-badge base"><text class="pm-badge-text">基线</text></view>
            <view v-if="p.active" class="pm-badge used"><text class="pm-badge-text">使用中</text></view>
          </view>
          <text class="pm-note-text">{{ p.note }}</text>
          <view class="pm-toggle" @tap.stop="toggleText(p.id)">
            <text class="pm-toggle-text">{{ expanded[p.id] ? '收起原文 ▴' : '看原文 ▾' }}</text>
          </view>
          <text v-if="expanded[p.id]" class="pm-raw">{{ p.text }}</text>
        </view>

        <view class="sec-title">成功率对比（近 7 天）</view>
        <view class="st-hint">
          「识别成功」= AI 报出了一个合法编号；「完全成功」= 报出的编号在目录里也查得到。
          目录里没有是资料还没补，不算提示词的锅。
        </view>
        <view v-if="!statList.length" class="st-empty">近期还没有调用记录。跑几次识别上传或批量识别就会出现在这里。</view>
        <view v-else class="st-table">
          <view class="st-row st-head">
            <text class="st-c1">方案</text>
            <text class="st-c2">识别成功</text>
            <text class="st-c3">完全成功</text>
            <text class="st-c4">费用</text>
          </view>
          <view class="st-row" v-for="s in statList" :key="s.promptKey">
            <view class="st-c1"><text class="st-name">{{ s.name }}</text><text class="st-calls">{{ s.calls }} 次</text></view>
            <view class="st-c2"><text class="st-pct" :class="rateClass(s.recognizedRate)">{{ s.recognizedRate }}%</text><text class="st-frac">{{ s.recognized }}/{{ s.calls }}</text></view>
            <view class="st-c3"><text class="st-pct" :class="rateClass(s.catalogHitRate)">{{ s.catalogHitRate }}%</text><text class="st-frac">{{ s.catalogHit }}/{{ s.calls }}</text></view>
            <text class="st-c4">¥{{ formatYuan(s.costYuan) }}</text>
          </view>
        </view>

        <view class="mc-entry" @tap="openMissing">
          <view class="mc-entry-info">
            <text class="mc-entry-title">目录缺失编号清单</text>
            <text class="mc-entry-desc">AI 认出来但目录里没有的卡 · 自动记录 · 同编号去重</text>
          </view>
          <text class="mc-entry-arrow">›</text>
        </view>
      </template>
    </scroll-view>

    <!-- 新增/编辑弹窗 -->
    <view v-if="editVisible" class="edit-overlay" @tap="editVisible = false">
      <view class="edit-card" @tap.stop>
        <text class="edit-title">{{ editMode === 'create' ? '新增钥匙' : '编辑钥匙' }}</text>
        <scroll-view class="edit-scroll" scroll-y="true">
          <view class="edit-fields">
            <text class="ef-label">别名（如：主力钥匙）</text>
            <input class="ef-input" v-model="editForm.name" placeholder="不填显示为『未命名』" />

            <text class="ef-label">API 钥匙（明文）</text>
            <input class="ef-input" v-model="editForm.apiKey"
              :placeholder="editMode === 'edit' ? '留空 = 不更换' : '输入 ark-xxx'"
              :disabled="editMode === 'edit'" />

            <text class="ef-label">接口 URL</text>
            <input class="ef-input" v-model="editForm.apiUrl" placeholder="默认方舟 responses 地址" />

            <text class="ef-label">模型</text>
            <input class="ef-input" v-model="editForm.model" placeholder="默认 doubao-seed-2-0-mini-260428" />

            <text class="ef-label">单价（元/千token，费用估算用）</text>
            <input class="ef-input" type="digit" v-model="editForm.unitPricePerK" placeholder="默认 0.008" />

            <text class="ef-label">绑定账号（可多选，费用归因）</text>
            <view class="ef-input picker-box" @tap="ownerExpand = !ownerExpand">
              <text class="picker-text" :class="{ empty: !selectedOwnerNames.length }">
                {{ selectedOwnerNames.length ? selectedOwnerNames.join('、') : '请选择账号' }}
              </text>
              <text class="picker-arrow" :class="{ up: ownerExpand }">▾</text>
            </view>
            <view v-if="ownerExpand" class="owner-options">
              <view class="owner-opt" v-for="u in users" :key="u.id" @tap="toggleOwner(u.id)">
                <text class="owner-opt-text">{{ u.nickname }}（{{ u.id }}）</text>
                <text class="owner-check">{{ isOwnerSelected(u.id) ? '☑' : '☐' }}</text>
              </view>
              <view v-if="!users.length" class="owner-opt"><text class="owner-opt-text dim">暂无账号</text></view>
            </view>

            <view class="ef-sw-row">
              <text class="ef-label">启用</text>
              <view class="sw" :class="{ on: editForm.enabled }" @tap="editForm.enabled = !editForm.enabled">
                <view class="knob"></view>
              </view>
            </view>
            <view class="ef-sw-row">
              <text class="ef-label">设为默认（识别用）</text>
              <view class="sw" :class="{ on: editForm.isDefault }" @tap="editForm.isDefault = !editForm.isDefault">
                <view class="knob"></view>
              </view>
            </view>

            <text class="ef-label">备注</text>
            <input class="ef-input" v-model="editForm.note" placeholder="可选" />
          </view>
        </scroll-view>
        <view class="edit-btns">
          <view class="eb-cancel" @tap="editVisible = false"><text class="eb-text">取消</text></view>
          <view class="eb-save" @tap="applyEdit"><text class="eb-text-w">保存</text></view>
        </view>
      </view>
    </view>

    <!-- 删除确认弹窗 -->
    <view v-if="showModal" class="modal-mask" @tap="showModal = false">
      <view class="modal-box" @tap.stop>
        <text class="mod-title">删除钥匙</text>
        <text class="mod-desc">确定删除「{{ delName }}」？</text>
        <text class="mod-desc sub">用量历史日志会保留，不参与新的识别。若为默认钥匙，将自动顶替第一把启用的钥匙。</text>
        <view class="mod-btns">
          <view class="mod-btn cancel" @tap="showModal = false"><text>取消</text></view>
          <view class="mod-btn ok danger" @tap="doDelete"><text>确认删除</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import {
  getApiKeys, createApiKey, updateApiKey, deleteApiKey,
  testApiKey, setDefaultApiKey, getApiKeyStats, getApiKeyUsers,
  getVersions, getPromptConfig, setActivePrompt, getPromptStats, getMissingCodes,
} from '@/api/index.js'
import { buildCardImgUrl } from '@/api/cardDb.js'

const loading = ref(false)
const keys = ref([])
const users = ref([])
const currentTab = ref('usage')
const stats = ref({ total: 0, totals: { tokens: 0, calls: 0, costYuan: 0 }, perKey: [], perDay: [] })

/* ===== 提示词方案（Tab 4） ===== */
// 这个页面的版本选择只是拿来「调试/对比」用的，跟识别上传页左上角选的那个互不影响。
const DEFAULT_LOGO = '/static/icons/version_logos/logo_yugioh_test.png'
const FALLBACK_VERSIONS = [
  { id: 1, name: '游戏王日文', lang: '日文', logo: DEFAULT_LOGO },
  { id: 2, name: '游戏王简中', lang: '简中', logo: DEFAULT_LOGO },
  { id: 3, name: '游戏王英文', lang: '英文', logo: DEFAULT_LOGO },
  { id: 4, name: '宝可梦日文', lang: '日文', logo: DEFAULT_LOGO },
  { id: 5, name: '宝可梦简中', lang: '简中', logo: DEFAULT_LOGO },
  { id: 6, name: '宝可梦英文', lang: '英文', logo: DEFAULT_LOGO },
]
const versionList = ref([])
// 版本 id 是后端给的字符串（如 "default-1"），不是数字，所以先留空、拿到列表后再定
const promptVersionId = ref('')
const promptData = ref(null)
const expanded = ref({})          // 哪些方案的原文是展开的
const statList = ref([])
const showMissing = ref(false)    // 子视图：缺失编号清单
const missingList = ref([])
const missingSummary = ref({ total: 0, filled: 0, pending: 0 })
const missingLoading = ref(false)

const promptList = computed(() => (promptData.value && promptData.value.list) || [])
// 当前调试的版本；找不到就退回列表第一个，保证永远有一个合法版本可传
const curVersion = () =>
  versionList.value.find((x) => x.id === promptVersionId.value) || versionList.value[0] || {}
const promptVersionName = computed(() => curVersion().name || '')

const loadVersions = async () => {
  try {
    const data = await getVersions()
    const raw = (data && data.list) || []
    versionList.value = raw.length ? raw.map((v) => ({ ...v, id: v.id || v.versionId })) : FALLBACK_VERSIONS
  } catch (_) {
    versionList.value = FALLBACK_VERSIONS
  }
  // 默认停在「游戏王日文」，没有就选第一个
  if (!versionList.value.some((v) => v.id === promptVersionId.value)) {
    const pref = versionList.value.find((v) => v.name === '游戏王日文') || versionList.value[0]
    promptVersionId.value = pref ? pref.id : ''
  }
}

const loadPrompt = async () => {
  try {
    const v = curVersion()
    const data = await getPromptConfig({ versionId: promptVersionId.value, versionName: v.name, versionLang: v.lang })
    promptData.value = data
    // 默认只展开「使用中」那一条，其余折起来，免得原文太长翻不动
    const exp = {}
    ;(data.list || []).forEach((p) => { exp[p.id] = !!p.active })
    expanded.value = exp
  } catch (e) {
    uni.showToast({ title: '方案加载失败：' + (e.message || '网络错误'), icon: 'none' })
  }
}

const loadStats = async () => {
  try {
    const v = curVersion()
    const data = await getPromptStats({ versionId: promptVersionId.value, versionName: v.name, days: 7 })
    statList.value = (data && data.list) || []
  } catch (_) {
    statList.value = []
  }
}

const switchTab = (t) => {
  currentTab.value = t
  if (t === 'prompt') {
    showMissing.value = false
    // 版本列表可能还没拿到（onShow 是异步的），补一次
    const ready = versionList.value.length ? Promise.resolve() : loadVersions()
    ready.then(() => { loadPrompt(); loadStats() })
  }
}

const pickVersion = (v) => {
  if (promptVersionId.value === v.id) return
  promptVersionId.value = v.id
  loadPrompt()
  loadStats()
}

const toggleText = (id) => { expanded.value = { ...expanded.value, [id]: !expanded.value[id] } }

const pickPrompt = (p) => {
  if (p.active) return
  uni.showModal({
    title: '切换提示词方案',
    content: `把「${promptVersionName.value}」的识别方案切到「${p.name}」？切换后新的识别立即用它。`,
    success: async (r) => {
      if (!r.confirm) return
      try {
        await setActivePrompt({ versionId: promptVersionId.value, versionName: promptVersionName.value, promptId: p.id })
        uni.showToast({ title: '已切换', icon: 'none' })
        loadPrompt()
        loadStats()
      } catch (e) {
        uni.showToast({ title: '切换失败：' + (e.message || '网络错误'), icon: 'none' })
      }
    },
  })
}

const openMissing = () => { showMissing.value = true; loadMissing() }

const loadMissing = async () => {
  missingLoading.value = true
  try {
    const data = await getMissingCodes({ pageSize: 200 })
    missingList.value = (data && data.list) || []
    missingSummary.value = (data && data.summary) || { total: 0, filled: 0, pending: 0 }
  } catch (e) {
    uni.showToast({ title: '清单加载失败：' + (e.message || '网络错误'), icon: 'none' })
  } finally {
    missingLoading.value = false
  }
}

// 卡图走后端缩略图接口，要卡密才拿得到；目录里补上资料前 extCode 是空的。
// 这里**故意不传 rarity**：这页就是「缺资料的编号」清单，它的罕贵度本来就没人核过，
// 传进去只会让后端进精准模式、整页变成卡背。不传 = 走兜底链，尽力给一张图。
const thumbUrl = (m) =>
  buildCardImgUrl({ password: m.extCode, code: m.code })

const fmtDate = (d) => {
  if (!d) return '—'
  const t = new Date(d)
  return `${t.getMonth() + 1}/${t.getDate()} ${pad2(t.getHours())}:${pad2(t.getMinutes())}`
}

const rateClass = (r) => (r >= 80 ? 'good' : r >= 50 ? 'mid' : 'bad')

const openExternal = (url) => {
  if (typeof window !== 'undefined' && window.open) window.open(url, '_blank')
  else uni.showToast({ title: '请复制链接到浏览器打开：' + url, icon: 'none' })
}

const formatTokens = (n) => (Number(n) || 0).toLocaleString()
const formatYuan = (n) => {
  const v = Number(n) || 0
  return v === 0 ? '0' : String(Number(v.toFixed(4)))
}

/* ===== 用量信息：今日/图表/占比 ===== */
const pad2 = (n) => String(n).padStart(2, '0')
const dayKey = (dt) => `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`

/* 今日统计（chartDays 最后一天即今天，无调用则为 0） */
const chartKey = ref('') // '' = 全部钥匙；否则为 keyId，趋势图按它筛选
const chartKeyOptions = computed(() => ['全部钥匙', ...keys.value.map((k) => k.name || '未命名')])
const chartKeyLabel = computed(() => {
  if (!chartKey.value) return '全部钥匙'
  const k = keys.value.find((k) => String(k._id) === chartKey.value)
  return k ? k.name : '全部钥匙'
})
const onChartKeyChange = (e) => {
  const i = Number((e.detail && e.detail.value) || 0)
  chartKey.value = i === 0 ? '' : String(keys.value[i - 1]._id)
}

const chartDays = computed(() => {
  const now = new Date()
  const map = {}
  const src = chartKey.value
    ? (stats.value.perKeyDay || []).filter((d) => String(d.keyId) === chartKey.value)
    : (stats.value.perDay || [])
  src.forEach((d) => { map[d.date] = d })
  const days = []
  for (let i = 29; i >= 0; i--) {
    const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const key = dayKey(dt)
    const s = map[key]
    days.push({
      date: key,
      label: `${dt.getMonth() + 1}/${dt.getDate()}`,
      tokens: s ? s.tokens : 0,
      calls: s ? s.calls : 0,
      costYuan: s ? s.costYuan : 0,
    })
  }
  return days
})
const todayStat = computed(() => chartDays.value[chartDays.value.length - 1] || { tokens: 0, calls: 0, costYuan: 0 })

/* 柱状图选中态（默认选最后一天=今天） */
const selectedDay = ref(-1)
const selIdx = computed(() => (selectedDay.value === -1 ? chartDays.value.length - 1 : selectedDay.value))
const selStat = computed(() => chartDays.value[selIdx.value] || { label: '', date: '', tokens: 0, calls: 0, costYuan: 0 })
const maxBarTokens = computed(() => Math.max(1, ...chartDays.value.map((d) => d.tokens)))
const barHeight = (d) => Math.max(d.tokens > 0 ? 4 : 1.5, Math.round((d.tokens / maxBarTokens.value) * 100))
const barTap = (i) => { selectedDay.value = i }

/* 每把钥匙占比（占累计 token） */
const keyPercent = (tokens) => {
  const total = Number(stats.value.totals.tokens) || 0
  if (!total) return 0
  return Math.max(1, Math.round((Number(tokens) / total) * 100))
}
const dailyList = computed(() => [...(stats.value.perDay || [])].reverse())

const load = async () => {
  loading.value = true
  try {
    const [keyData, statData, userData] = await Promise.all([
      getApiKeys().catch(() => null),
      getApiKeyStats().catch(() => null),
      getApiKeyUsers().catch(() => null),
    ])
    keys.value = (keyData?.list || []).map((k) => ({ ...k, testing: false, testResult: '' }))
    stats.value = {
      total: keyData?.total || 0,
      totals: statData?.totals || { tokens: 0, calls: 0, costYuan: 0 },
      perKey: statData?.perKey || [],
      perDay: statData?.perDay || [],
      perKeyDay: statData?.perKeyDay || [],
    }
    users.value = userData?.list || []
    await loadVersions()   // 提示词方案页的版本选择要用
  } catch (e) {
    uni.showToast({ title: '加载失败：' + (e.message || '网络错误'), icon: 'none' })
  } finally {
    loading.value = false
  }
}

/* ===== 启用/停用 ===== */
const onToggleEnabled = async (k) => {
  const next = !k.enabled
  try {
    await updateApiKey(k._id, { enabled: next })
    uni.showToast({ title: next ? '已启用' : '已停用', icon: 'none' })
    load()
  } catch (e) {
    uni.showToast({ title: '操作失败：' + (e.message || '网络错误'), icon: 'none' })
  }
}

/* ===== 测试 ===== */
const onTest = async (k) => {
  k.testing = true
  k.testResult = ''
  try {
    const res = await testApiKey(k._id)
    k.testResult = res?.ok
      ? `✅ 测试通过 · 耗时 ${res.latencyMs}ms · ${formatTokens(res.tokens)} token`
      : `❌ 测试失败：${res?.error || '未知错误'}`
    uni.showToast({ title: res?.ok ? '测试通过' : '测试失败', icon: 'none' })
  } catch (e) {
    k.testResult = '❌ 测试失败：' + (e.message || '网络错误')
  } finally {
    k.testing = false
  }
}

/* ===== 设默认 ===== */
const onSetDefault = async (k) => {
  try {
    await setDefaultApiKey(k._id)
    uni.showToast({ title: '已设为默认', icon: 'none' })
    load()
  } catch (e) {
    uni.showToast({ title: '操作失败：' + (e.message || '网络错误'), icon: 'none' })
  }
}

/* ===== 新增/编辑弹窗 ===== */
const editVisible = ref(false)
const editMode = ref('create')
const editForm = ref({ _id: '', name: '', apiKey: '', apiUrl: '', model: '', unitPricePerK: '', ownerIds: [], enabled: true, isDefault: false, note: '' })
const ownerExpand = ref(false)

/* 绑定账号多选（页内联展开，不用原生 picker 避免层级覆盖） */
const selectedOwnerNames = computed(() =>
  users.value.filter((u) => editForm.value.ownerIds.includes(u.id)).map((u) => `${u.nickname}（${u.id}）`)
)
const isOwnerSelected = (id) => editForm.value.ownerIds.includes(id)
const toggleOwner = (id) => {
  const arr = editForm.value.ownerIds
  const i = arr.indexOf(id)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(id)
}

const openCreate = () => {
  editMode.value = 'create'
  editForm.value = {
    _id: '', name: '', apiKey: '', apiUrl: '', model: '', unitPricePerK: '', ownerIds: [], enabled: true, isDefault: false, note: '',
  }
  ownerExpand.value = false
  editVisible.value = true
}

const openEdit = (k) => {
  editMode.value = 'edit'
  editForm.value = {
    _id: k._id, name: k.name, apiKey: '', apiUrl: k.apiUrl, model: k.model,
    unitPricePerK: String(k.unitPricePerK),
    ownerIds: Array.isArray(k.ownerIds) && k.ownerIds.length ? [...k.ownerIds] : (k.ownerId ? [k.ownerId] : []),
    enabled: k.enabled, isDefault: k.isDefault, note: k.note,
  }
  ownerExpand.value = false
  editVisible.value = true
}

const applyEdit = async () => {
  const f = editForm.value
  if (editMode.value === 'create' && !f.apiKey.trim()) {
    return uni.showToast({ title: '请输入 API 钥匙', icon: 'none' })
  }
  const unitPricePerK = f.unitPricePerK === '' ? undefined : Number(f.unitPricePerK)
  const payload = {
    name: f.name,
    apiUrl: f.apiUrl,
    model: f.model,
    unitPricePerK,
    ownerIds: f.ownerIds,
    enabled: f.enabled,
    isDefault: f.isDefault,
    note: f.note,
  }
  if (editMode.value === 'create') payload.apiKey = f.apiKey.trim()
  try {
    if (editMode.value === 'create') await createApiKey(payload)
    else await updateApiKey(f._id, payload)
    editVisible.value = false
    uni.showToast({ title: '保存成功', icon: 'success' })
    load()
  } catch (e) {
    uni.showToast({ title: '保存失败：' + (e.message || '网络错误'), icon: 'none' })
  }
}

/* ===== 删除确认 ===== */
const showModal = ref(false)
const delName = ref('')
const delId = ref('')

const openDelete = (k) => {
  delName.value = k.name || '未命名'
  delId.value = k._id
  showModal.value = true
}

const doDelete = async () => {
  showModal.value = false
  try {
    await deleteApiKey(delId.value)
    uni.showToast({ title: '已删除', icon: 'success' })
    load()
  } catch (e) {
    uni.showToast({ title: '删除失败：' + (e.message || '网络错误'), icon: 'none' })
  }
}

const goBack = () => uni.reLaunch({ url: '/pages/admin/dashboard' })

onShow(load)
</script>

<style scoped>
.page-container {
  background-color: #F5F5F7;
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
}

/* ========== 顶部工具栏 ========== */
.toolbar-panel { background-color: #FFFFFF; flex-shrink: 0; }
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: 46px;
}
.toolbar-left { flex: 1; }
.tool-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; }
.icon-back { width: 20px; height: 20px; }
.tool-title { font-size: 16px; font-weight: 600; color: #1A1A1A; }
.toolbar-right { flex: 1; display: flex; justify-content: flex-end; }
.add-btn { background: #FF0000; border-radius: 14px; padding: 6px 12px; }
.add-btn-text { color: #FFF; font-size: 13px; }

/* ========== Tab 栏 ========== */
.lib-tabs {
  display: flex;
  background: #FFF;
  border-bottom: 1px solid #F0F0F0;
  flex-shrink: 0;
}
.tab-item {
  flex: 1;
  padding: 12px 0 10px;
  text-align: center;
  position: relative;
}
.tab-item text { font-size: 15px; color: #666; }
.tab-item text.active { color: #1A1A1A; font-weight: 600; }
.red-line {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 24px;
  height: 3px;
  border-radius: 2px;
  background: #FF0000;
}

/* ========== Tab 内容区（三 tab 共用） ========== */
.tab-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  box-sizing: border-box;
}
.hint-bar { padding: 0 0 8px; }
.hint-text { font-size: 11px; color: #999; }

/* ========== 用量信息 ========== */
.usage-overview {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
}
.uv-box {
  flex: 0 0 calc(50% - 5px);
  background: #FFF;
  border-radius: 12px;
  padding: 14px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
}
.uv-label { font-size: 11px; color: #999; }
.uv-val { font-size: 17px; font-weight: 600; color: #1A1A1A; }

/* 近30天趋势柱状图 */
.chart-card {
  background: #FFF;
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 16px;
}
.chart-sel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.chart-date { font-size: 13px; font-weight: 600; color: #1A1A1A; }
.chart-vals { display: flex; align-items: baseline; gap: 8px; }
.chart-val { font-size: 14px; font-weight: 600; color: #FF0000; }
.chart-sub { font-size: 11px; color: #999; }
.bar-chart {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 120px;
  padding: 4px 2px 0;
}
.bar-col {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: flex-end;
  cursor: pointer;
}
.bar {
  width: 100%;
  min-height: 2px;
  background: #FFD6D6;
  border-radius: 2px 2px 0 0;
  transition: background .2s;
}
.bar.on { background: #FF0000; }
.chart-axis {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  padding: 0 2px;
}
.chart-axis text { font-size: 10px; color: #BBB; }

/* 每把钥匙占比进度条 */
.bar-track {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: #F0F0F0;
  margin-top: 6px;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 3px;
  background: #FF0000;
}

/* 每日明细 */
.daily-item {
  display: flex;
  align-items: center;
  background: #FFF;
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 6px;
}
.daily-date { flex: 1; font-size: 12px; color: #1A1A1A; }
.daily-tokens { font-size: 12px; font-weight: 500; color: #1A1A1A; margin-right: 10px; }
.daily-calls { font-size: 11px; color: #999; margin-right: 10px; }
.daily-cost { font-size: 12px; font-weight: 600; color: #FF0000; flex-shrink: 0; }

.sec-title { font-size: 13px; font-weight: 600; color: #1A1A1A; margin: 4px 2px 8px; }
.chart-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.chart-picker {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #FFF;
  border: 1px solid #EEE;
  border-radius: 12px;
  padding: 4px 10px;
}
.chart-picker-text { font-size: 12px; color: #333; }
.chart-picker-arrow { font-size: 10px; color: #999; }
.sub-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #FFF;
  border-radius: 12px;
  padding: 10px 12px;
  margin-bottom: 8px;
}
.sub-left { display: flex; flex-direction: column; gap: 2px; }
.sub-name { font-size: 13px; font-weight: 500; color: #1A1A1A; }
.sub-meta { font-size: 11px; color: #999; }
.sub-cost { font-size: 13px; font-weight: 600; color: #FF0000; flex-shrink: 0; }

/* ========== 提示词方案（Tab 4） ========== */
/* 版本选择：块样式对齐识别上传页右上角的系列选择（VersionPicker） */
.ver-grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}
.ver-item {
  width: 68px;
  height: 58px;
  background-color: #E5E5E5;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.ver-item-active { background-color: #FF0000; }
.ver-item-active .ver-name { color: #FFFFFF; }
.ver-logo-wrap {
  position: relative;
  width: 64px;
  height: 37px;
  background-color: #FFFFFF;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.ver-logo { width: 64px; height: 37px; }
.ver-lang {
  position: absolute;
  bottom: 5px;
  left: 5px;
  background: rgba(0, 0, 0, 0.5);
  color: #FFFFFF;
  font-size: 6px;
  border-radius: 0 3px 0 0;
  padding: 1px 4px;
  line-height: 1.2;
}
.ver-name { font-size: 10px; font-weight: 700; color: #1A1A1A; text-align: center; }

/* 方案卡片：单选样式，点一下切换 */
.pm-card {
  background: #FFF;
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 10px;
  border: 2px solid transparent;
}
.pm-card.on { border-color: #FF0000; }
.pm-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.pm-radio { font-size: 15px; color: #CCC; }
.pm-radio.on { color: #FF0000; }
.pm-name { font-size: 14px; font-weight: 600; color: #1A1A1A; flex: 1; }
.pm-badge { border-radius: 4px; padding: 1px 6px; flex-shrink: 0; }
.pm-badge.base { background: #EFEFEF; }
.pm-badge.used { background: #FF0000; }
.pm-badge-text { font-size: 10px; color: #666; }
.pm-badge.used .pm-badge-text { color: #FFF; }
.pm-note-text { font-size: 12px; color: #666; line-height: 1.7; display: block; }
.pm-toggle { margin-top: 8px; }
.pm-toggle-text { font-size: 11px; color: #FF0000; }
.pm-raw {
  display: block;
  margin-top: 8px;
  background: #F7F7F7;
  border-radius: 8px;
  padding: 10px;
  font-size: 11px;
  color: #555;
  line-height: 1.7;
  font-family: monospace;
}
.pm-fallback {
  background: #FFF8E1;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 12px;
  color: #8A6D00;
  line-height: 1.7;
  margin-bottom: 10px;
}

/* 成功率对比 */
.st-hint { font-size: 11px; color: #999; line-height: 1.7; margin: 0 2px 10px; }
.st-empty {
  background: #FFF;
  border-radius: 12px;
  padding: 20px 12px;
  text-align: center;
  font-size: 12px;
  color: #999;
  margin-bottom: 16px;
}
.st-table { background: #FFF; border-radius: 12px; overflow: hidden; margin-bottom: 16px; }
.st-row {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid #F5F5F5;
}
.st-row:last-child { border-bottom: none; }
.st-head { background: #FAFAFA; }
.st-head text { font-size: 11px; color: #999; }
.st-c1 { flex: 1.4; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.st-c2, .st-c3 { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.st-c4 { flex: 0.8; font-size: 12px; color: #666; text-align: right; }
.st-name { font-size: 12px; font-weight: 500; color: #1A1A1A; }
.st-calls { font-size: 10px; color: #999; }
.st-pct { font-size: 14px; font-weight: 600; }
.st-pct.good { color: #1AA34A; }
.st-pct.mid { color: #E07000; }
.st-pct.bad { color: #FF0000; }
.st-frac { font-size: 10px; color: #999; }

/* 缺失编号清单入口 */
.mc-entry {
  display: flex;
  align-items: center;
  background: #FFF;
  border-radius: 12px;
  padding: 14px 12px;
  gap: 10px;
}
.mc-entry-info { flex: 1; display: flex; flex-direction: column; gap: 3px; }
.mc-entry-title { font-size: 14px; font-weight: 600; color: #1A1A1A; }
.mc-entry-desc { font-size: 11px; color: #999; }
.mc-entry-arrow { font-size: 20px; color: #CCC; }

/* 子视图：清单 */
.sub-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.sub-back { padding: 2px 4px; }
.sub-back-text { font-size: 14px; color: #FF0000; }
.sub-title { font-size: 15px; font-weight: 600; color: #1A1A1A; }
.mc-summary { display: flex; gap: 10px; margin-bottom: 10px; }
.mc-sum-item {
  flex: 1;
  background: #FFF;
  border-radius: 12px;
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.mc-sum-val { font-size: 18px; font-weight: 600; color: #E07000; }
.mc-sum-val.ok { color: #1AA34A; }
.mc-sum-label { font-size: 11px; color: #999; }
.mc-hint { font-size: 11px; color: #999; line-height: 1.7; margin: 0 2px 10px; }
.mc-refresh { align-self: flex-start; margin-bottom: 10px; }
.mc-refresh-text { font-size: 13px; color: #FF0000; }
.mc-row {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #FFF;
  border-radius: 12px;
  padding: 10px;
  margin-bottom: 8px;
  border-left: 3px solid #E07000;
}
.mc-row.filled { border-left-color: #1AA34A; }
.mc-img-box {
  width: 44px;
  height: 62px;
  background: #F2F2F2;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}
.mc-img { width: 44px; height: 62px; }
.mc-img-empty { font-size: 10px; color: #BBB; }
.mc-info { flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.mc-code { font-size: 14px; font-weight: 600; color: #1A1A1A; }
.mc-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.mc-tag { font-size: 10px; color: #666; background: #F2F2F2; border-radius: 4px; padding: 1px 6px; }
.mc-name { font-size: 12px; color: #1A1A1A; }
.mc-sub { font-size: 10px; color: #999; }
.mc-state { font-size: 11px; color: #E07000; flex-shrink: 0; }
.mc-state.ok { color: #1AA34A; }
.mc-empty {
  background: #FFF;
  border-radius: 12px;
  padding: 24px 12px;
  text-align: center;
  font-size: 12px;
  color: #999;
  line-height: 1.7;
}

/* ========== 充值 ========== */
.recharge-desc {
  background: #FFF;
  border-radius: 12px;
  padding: 12px;
  font-size: 13px;
  color: #666;
  line-height: 1.7;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 16px;
}
.recharge-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #FFF;
  border-radius: 12px;
  padding: 14px 12px;
  margin-bottom: 10px;
}
.rc-icon { font-size: 22px; width: 32px; text-align: center; flex-shrink: 0; }
.rc-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.rc-name { font-size: 14px; font-weight: 600; color: #1A1A1A; }
.rc-desc { font-size: 11px; color: #999; }
.rc-arrow { font-size: 20px; color: #CCC; flex-shrink: 0; }
.tutorial {
  background: #FFF;
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tu-line { font-size: 13px; color: #666; line-height: 1.6; }

/* ========== 钥匙列表 ========== */
.key-item {
  background: #FFF;
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 10px;
}
.key-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.key-name { flex: 1; font-size: 15px; font-weight: 600; color: #1A1A1A; }
.key-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 8px;
  flex-shrink: 0;
}
.key-badge.default { color: #FFF; background: #FF0000; }
.key-badge.on { color: #34C759; background: #E9F9ED; }
.key-badge.off { color: #999; background: #F0F0F0; }

/* 开关 */
.sw {
  width: 40px;
  height: 22px;
  border-radius: 11px;
  background: #CCC;
  position: relative;
  transition: background .2s;
  flex-shrink: 0;
}
.sw.on { background: #FF0000; }
.knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 9px;
  background: #FFF;
  transition: left .2s;
}
.sw.on .knob { left: 20px; }

.key-meta { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
.km-line { font-size: 12px; color: #666; line-height: 1.5; word-break: break-all; }
.km-line.note { color: #999; }
.km-line.test-result { color: #FF0000; }

.key-actions { display: flex; gap: 8px; margin-top: 12px; }
.rbtn {
  background: #F5F5F7;
  border-radius: 8px;
  padding: 6px 14px;
}
.rbtn text { font-size: 12px; color: #333; }
.rbtn.del text { color: #FF0000; }

.empty { display: flex; justify-content: center; padding: 60px 0; }
.empty-text { color: #999; font-size: 14px; }

/* ========== 新增/编辑弹窗 ========== */
.edit-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}
.edit-card {
  background: #FFF;
  border-radius: 16px;
  padding: 20px 16px;
  width: 100%;
  max-width: 360px;
  box-shadow: 0 8px 32px rgba(0,0,0,.12);
  box-sizing: border-box;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
}
.edit-title { font-size: 16px; font-weight: 600; color: #1A1A1A; text-align: center; margin-bottom: 14px; flex-shrink: 0; }
.edit-scroll { flex: 1; overflow-y: auto; }
.edit-fields { display: flex; flex-direction: column; gap: 4px; }
.ef-label { font-size: 11px; color: #666; font-weight: 500; margin-top: 8px; }
.ef-input {
  width: 100%;
  padding: 12px 10px;
  border: 1px solid #E5E5EA;
  border-radius: 8px;
  font-size: 14px;
  background: #F5F5F7;
  box-sizing: border-box;
  height: 44px;
  line-height: 1.4;
  margin-top: 2px;
}
.picker-box { display: flex; align-items: center; justify-content: space-between; }
.picker-text { font-size: 14px; color: #1A1A1A; }
.picker-text.empty { color: #999; }
.picker-arrow { font-size: 12px; color: #999; transition: transform .2s; }
.picker-arrow.up { transform: rotate(180deg); }

/* 绑定账号多选下拉（页内联展开，无独立层级） */
.owner-options {
  border: 1px solid #E5E5EA;
  border-radius: 8px;
  background: #FFF;
  margin-top: 2px;
  max-height: 168px;
  overflow-y: auto;
  box-shadow: 0 2px 8px rgba(0,0,0,.06);
}
.owner-opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid #F2F2F2;
}
.owner-opt:last-child { border-bottom: none; }
.owner-opt-text { font-size: 13px; color: #1A1A1A; }
.owner-opt-text.dim { color: #999; }
.owner-check { font-size: 15px; color: #FF0000; }
.ef-sw-row { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
.ef-sw-row .ef-label { margin-top: 0; }
.edit-btns { display: flex; gap: 12px; margin-top: 16px; flex-shrink: 0; }
.eb-cancel, .eb-save {
  flex: 1;
  height: 42px;
  border-radius: 21px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.eb-cancel { background: #F0F0F0; }
.eb-text { color: #666; font-size: 14px; }
.eb-save { background: #FF0000; }
.eb-text-w { color: #FFF; font-size: 14px; font-weight: 500; }

/* ========== 删除确认弹窗 ========== */
.modal-mask {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}
.modal-box {
  width: 80%;
  background: #FFF;
  border-radius: 16px;
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
}
.mod-title { font-size: 16px; font-weight: 600; color: #1A1A1A; text-align: center; margin-bottom: 12px; }
.mod-desc { font-size: 13px; color: #333; text-align: center; line-height: 1.6; }
.mod-desc.sub { color: #999; font-size: 12px; margin-top: 6px; }
.mod-btns { display: flex; gap: 12px; margin-top: 18px; }
.mod-btn {
  flex: 1;
  height: 40px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mod-btn.cancel { background: #F2F2F2; }
.mod-btn.cancel text { color: #666; font-size: 14px; }
.mod-btn.ok { background: #FF0000; }
.mod-btn.ok text { color: #FFF; font-size: 14px; font-weight: 500; }
</style>
