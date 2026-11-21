<template>
  <view class="rg-wrap">
    <!-- 有真实罕贵度 → 药丸网格，只能点不能敲。
         样式照 ParamsPicker 的 rarity-grid（同一套视觉），但选项来自图源而不是静态枚举。 -->
    <view v-if="list.length" class="rarity-grid">
      <view
        class="rarity-item"
        :class="{ 'rarity-active': modelValue === r.rarity }"
        v-for="r in list"
        :key="r.rarity"
        @tap="!disabled && $emit('update:modelValue', r.rarity)"
      >
        <text class="rarity-text" :class="{ 'rarity-text-active': modelValue === r.rarity }">{{ r.rarity }}</text>
        <!-- 有这个罕贵度的异画版本时标出来，点进去才知道 ◀▶ 有得切 -->
        <text v-if="r.altCount > 1" class="rarity-badge" :class="{ 'rarity-badge-active': modelValue === r.rarity }">×{{ r.altCount }}</text>
      </view>
    </view>
    <!-- 图源里一张图都没有（编号不在日文 OCG 图源里）→ 说清楚，别给一个空框让人猜 -->
    <view v-else class="rg-empty">
      <text class="rg-empty-text">{{ loading ? '正在查图源…' : '图源里没有这张卡，罕贵度无从选起' }}</text>
    </view>
  </view>
</template>

<script setup>
defineProps({
  // 当前罕贵度（v-model）
  modelValue: { type: String, default: '' },
  // [{ rarity, altCount }]：来源是后端 GET /api/tcg/rarity-info/:code，
  // 扫的是图源包目录的文件名 —— 和挑图逻辑同一个数据源，
  // 所以「下拉里选得到、图上却挑不出来」这种事不会再发生。
  list: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})
defineEmits(['update:modelValue'])
</script>

<style scoped>
.rg-wrap { width: 100%; }
.rarity-grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 6px;
}
.rarity-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: #F5F5F7;
  border-radius: 50px;
  padding: 4px 9px;
  box-sizing: border-box;
}
.rarity-active { background-color: #FF0000; }
.rarity-text { font-size: 12px; color: #1A1A1A; }
.rarity-text-active { color: #FFFFFF; }
/* 异画角标：告诉用户这个罕贵度下 ◀▶ 有得切 */
.rarity-badge { font-size: 9px; color: #999; margin-left: 3px; }
.rarity-badge-active { color: #FFD9D9; }
.rg-empty {
  background-color: #FFF7E6;
  border-radius: 4px;
  padding: 5px 8px;
}
.rg-empty-text { font-size: 11px; color: #B26A00; }
</style>
