<template>
  <view class="editor-section">
    <text class="section-title">默认选择</text>
    <text class="section-desc">用户选择此版本后，以下选项将默认选中</text>

    <!-- 默认罕贵度 -->
    <view class="field-group">
      <text class="field-label">默认罕贵度</text>
      <picker
        mode="selector"
        :range="rarities"
        :value="rarityIndex"
        @change="onRarityChange"
      >
        <view class="picker-box">
          <text class="picker-text" :class="{ placeholder: !defaultRarity }">
            {{ defaultRarity || '请选择默认罕贵度' }}
          </text>
          <text class="picker-arrow">▼</text>
        </view>
      </picker>
    </view>

    <!-- 默认品相 -->
    <view class="field-group">
      <text class="field-label">默认品相</text>
      <picker
        mode="selector"
        :range="gradeNames"
        :value="gradeIndex"
        @change="onGradeChange"
      >
        <view class="picker-box">
          <text class="picker-text" :class="{ placeholder: !defaultGrade }">
            {{ defaultGrade || '请选择默认品相' }}
          </text>
          <text class="picker-arrow">▼</text>
        </view>
      </picker>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  rarities: { type: Array, default: () => [] },
  grades: { type: Array, default: () => [] },
  defaultRarity: { type: String, default: '' },
  defaultGrade: { type: String, default: '' }
})

const emit = defineEmits(['update:defaultRarity', 'update:defaultGrade'])

const gradeNames = computed(() => props.grades.map(g => g.name))

const rarityIndex = computed(() => {
  const idx = props.rarities.indexOf(props.defaultRarity)
  return idx >= 0 ? idx : 0
})

const gradeIndex = computed(() => {
  const idx = gradeNames.value.indexOf(props.defaultGrade)
  return idx >= 0 ? idx : 0
})

const onRarityChange = (e) => {
  const val = props.rarities[e.detail.value]
  if (val) emit('update:defaultRarity', val)
}

const onGradeChange = (e) => {
  const val = gradeNames.value[e.detail.value]
  if (val) emit('update:defaultGrade', val)
}
</script>

<style scoped>
.editor-section {
  background-color: #FFFFFF;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
}
.section-title {
  font-size: 15px;
  font-weight: 500;
  color: #1A1A1A;
  display: block;
}
.section-desc {
  font-size: 12px;
  color: #999999;
  margin-top: 4px;
  margin-bottom: 14px;
  display: block;
}
.field-group {
  margin-bottom: 12px;
}
.field-label {
  font-size: 13px;
  color: #333333;
  margin-bottom: 6px;
  display: block;
}
.picker-box {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  background-color: #F5F5F7;
  border-radius: 10px;
  padding: 10px 14px;
}
.picker-text {
  font-size: 14px;
  color: #1A1A1A;
}
.picker-text.placeholder {
  color: #CCCCCC;
}
.picker-arrow {
  font-size: 10px;
  color: #999999;
}
</style>
