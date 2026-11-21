<template>
  <view class="page">
    <view class="topbar">
      <view class="tbtn" @tap="goBack"><image class="timg" src="/static/icons/ic_back.png" mode="aspectFit" /></view>
      <text class="ttl">卡牌资料库</text>
      <view class="tbtn-placeholder"></view>
    </view>

    <view class="body">
      <!-- 概况条：这几个数是页面的"体检报告"，异常一眼能看见 -->
      <view class="stat-strip">
        <view class="stat-cell">
          <text class="stat-num">{{ n(stat.目录总行数) }}</text>
          <text class="stat-lbl">目录行数</text>
        </view>
        <view class="stat-div"></view>
        <view class="stat-cell">
          <text class="stat-num">{{ n(stat.唯一目录条数) }}</text>
          <text class="stat-lbl">唯一记录</text>
        </view>
        <view class="stat-div"></view>
        <view class="stat-cell">
          <text class="stat-num" :class="stat.不变量_过 ? 'ok' : 'bad'">{{ n(stat.待处理) }}</text>
          <text class="stat-lbl">待处理</text>
        </view>
      </view>

      <view class="invariant" :class="stat.不变量_过 ? 'inv-ok' : 'inv-bad'">
        <text class="inv-text">{{ stat.不变量文本 || '读不到不变量' }}</text>
        <text class="inv-sub">唯一目录 = 不同卡密 + 无卡密行</text>
      </view>

      <view class="card" @tap="goUnique">
        <view class="card-icon">📚</view>
        <view class="card-info">
          <text class="card-title">卡牌唯一目录</text>
          <text class="card-desc">一张卡一行 · 官方日文名 / 读音 / 简中 / 英文 / 库里现有写法</text>
          <view class="chips">
            <text class="chip chip-gray">{{ n(stat.唯一目录条数) }} 条</text>
            <text class="chip chip-red" v-if="stat.名字不符">名字不符 {{ stat.名字不符 }}</text>
            <text class="chip chip-orange" v-if="stat.写法差异">写法差异 {{ stat.写法差异 }}</text>
          </view>
        </view>
        <text class="card-arrow">›</text>
      </view>

      <view class="card" @tap="goReview">
        <view class="card-icon">⚠️</view>
        <view class="card-info">
          <text class="card-title">待处理</text>
          <text class="card-desc">名字/卡密对不上的行 · 缺卡密的行 · 能改卡密、能改名字</text>
          <view class="chips">
            <text class="chip chip-red" v-if="stat.待处理">待处理 {{ n(stat.待处理) }}</text>
            <text class="chip chip-blue" v-if="stat.缺卡密">缺卡密 {{ n(stat.缺卡密) }}</text>
            <text class="chip chip-orange" v-if="stat.卡密查不到">卡密查不到 {{ n(stat.卡密查不到) }}</text>
            <text class="chip chip-gray" v-if="!stat.合计">都清干净了</text>
          </view>
        </view>
        <text class="card-arrow">›</text>
      </view>

      <view class="card wip">
        <view class="card-icon">🧹</view>
        <view class="card-info">
          <text class="card-title">批量整理 <text class="soon">即将上线</text></text>
          <text class="card-desc">照换官方简中 {{ n(stat.要照换简中) }} 行 · 清成官方写法 {{ n(stat.写法啰嗦) }} 行 · 补卡密 / 清空卡密 / 补名字</text>
        </view>
      </view>

      <view class="foot">
        <text class="foot-text">官方资料：ygocdb.com · 全库 {{ n(stat.官方卡密数) }} 个卡密已逐个查过</text>
        <text class="foot-text" v-if="stat.官方查不到">查不到 {{ stat.官方查不到 }} 个（位数错的卡密，保留原值不动）</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { goBack as navBack } from '@/utils/nav.js'

const apiV1 = (url, opts) => {
  const token = uni.getStorageSync('token')
  return uni.request({
    url: '/v1/api' + url,
    header: { 'Authorization': 'Bearer ' + (token || ''), 'Content-Type': 'application/json' },
    ...opts,
  }).then(r => r.data)
}

const n = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'))

const stat = ref({
  目录总行数: null, 唯一目录条数: null, 待处理: null,
  名字不符: 0, 写法差异: 0, 卡密填错: 0, 名字短或空: 0,
  缺卡密: 0, 卡密查不到: 0, 合计: 0,
  写法啰嗦: 0, 要照换简中: 0,
  官方卡密数: null, 官方查不到: 0,
  不变量_过: false, 不变量文本: '',
})

const load = async () => {
  try {
    // /stats 和 /pending 走的是同一个 60 秒缓存的全库扫描，多发一个不额外贵
    const [d, p] = await Promise.all([
      apiV1('/card-uniques/stats'),
      apiV1('/card-uniques/pending'),
    ])
    const 名字 = d.名字 || {}
    const byKind = 名字.byKind || {}
    const 摘要 = p.摘要 || {}
    stat.value = {
      目录总行数: d.目录?.总行数,
      唯一目录条数: d.唯一目录?.总条数,
      待处理: 名字.真要处理,
      名字不符: 名字.byKind?.wrongExtCode,
      写法差异: 名字.写法啰嗦,
      卡密填错: byKind.wrongExtCode,
      名字短或空: (byKind.shortName || 0) + (byKind.emptyName || 0),
      缺卡密: 摘要.缺卡密 || 0,
      卡密查不到: 摘要.卡密查不到 || 0,
      合计: 摘要.合计 || 0,
      写法啰嗦: 名字.写法啰嗦,
      要照换简中: d.中文名?.要照换,
      官方卡密数: d.官方数据?.总数,
      官方查不到: d.官方数据?.查不到,
      不变量_过: !!d.不变量?.ok,
      不变量文本: d.不变量?.不变量 || '',
    }
  } catch (e) {
    uni.showToast({ title: '读取卡牌资料库失败', icon: 'none' })
  }
}

// 每次进来都重拉：用户可能刚在别的页面改过数据
onShow(load)

const goBack = () => navBack('/pages/admin/dashboard')
const goUnique = () => uni.navigateTo({ url: '/pages/admin/card-unique' })
const goReview = () => uni.navigateTo({ url: '/pages/admin/card-review' })
</script>

<style scoped>
* { box-sizing: border-box; }
.page { display: flex; flex-direction: column; height: 100vh; background: #F5F5F7; }
.topbar { background: #FFF; padding: 14px 16px 12px; display: flex; align-items: center; justify-content: space-between; position: relative; flex-shrink: 0; }
.tbtn { width: 32px; height: 32px; border-radius: 16px; background: #F0F0F0; display: flex; align-items: center; justify-content: center; }
.timg { width: 18px; height: 18px; }
.ttl { position: absolute; left: 50%; transform: translateX(-50%); font-size: 16px; font-weight: 500; color: #1A1A1A; }
.tbtn-placeholder { width: 32px; }
.body { flex: 1; overflow-y: auto; padding: 16px; }

.stat-strip { background: #FFF; border-radius: 12px; padding: 14px 0; display: flex; align-items: center; }
.stat-cell { flex: 1; display: flex; flex-direction: column; align-items: center; }
.stat-num { font-size: 20px; font-weight: 600; color: #1A1A1A; }
.stat-num.ok { color: #22C55E; }
.stat-num.bad { color: #EF4444; }
.stat-lbl { font-size: 11px; color: #999; margin-top: 2px; }
.stat-div { width: 1px; height: 28px; background: #EEE; }

.invariant { border-radius: 10px; padding: 10px 12px; margin: 10px 0; }
.inv-ok { background: rgba(34,197,94,0.10); }
.inv-bad { background: rgba(239,68,68,0.10); }
.inv-text { display: block; font-size: 13px; font-weight: 600; color: #1A1A1A; }
.inv-sub { display: block; font-size: 11px; color: #888; margin-top: 2px; }

.card { background: #FFF; border-radius: 12px; padding: 14px; margin-bottom: 10px; display: flex; align-items: flex-start; gap: 12px; }
.card.wip { opacity: 0.5; }
.card-icon { font-size: 24px; width: 40px; text-align: center; line-height: 1.2; }
.card-info { flex: 1; overflow: hidden; }
.card-title { font-size: 15px; font-weight: 500; color: #1A1A1A; display: block; }
.soon { font-size: 10px; font-weight: 400; color: #B45309; background: rgba(245,158,11,0.16); padding: 1px 6px; border-radius: 6px; margin-left: 4px; }
.card-desc { font-size: 12px; color: #999; margin-top: 3px; display: block; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.chip { font-size: 11px; padding: 2px 8px; border-radius: 8px; }
.chip-gray { background: #F0F0F2; color: #666; }
.chip-red { background: rgba(239,68,68,0.12); color: #EF4444; }
.chip-orange { background: rgba(249,115,22,0.14); color: #F97316; }
.chip-blue { background: rgba(22,96,198,0.10); color: #1660C6; }
.card-arrow { font-size: 24px; color: #CCC; line-height: 1; }

.foot { padding: 6px 4px 20px; }
.foot-text { display: block; font-size: 11px; color: #AAA; line-height: 1.6; }
</style>
