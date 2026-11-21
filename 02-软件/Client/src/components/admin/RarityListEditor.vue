<template>
  <view class="editor-section">
    <view class="section-header">
      <text class="section-title">罕贵度列表</text>
      <view class="add-btn" @tap="onAdd">
        <text class="add-text">+ 添加</text>
      </view>
    </view>
    <view class="rarity-list">
      <view class="rarity-chip" v-for="(item, index) in list" :key="index">
        <text class="chip-text">{{ item }}</text>
        <view class="chip-actions">
          <view class="move-btn" v-if="index > 0" @tap="onMoveUp(index)">
            <text class="move-text">↑</text>
          </view>
          <view class="move-btn" v-if="index < list.length - 1" @tap="onMoveDown(index)">
            <text class="move-text">↓</text>
          </view>
          <view class="delete-btn" @tap="onDelete(index)">
            <text class="delete-text">✕</text>
          </view>
        </view>
      </view>
      <text class="empty-hint" v-if="list.length === 0">暂无罕贵度，请点击添加</text>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  modelValue: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:modelValue'])

const list = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const onAdd = () => {
  uni.showModal({
    title: '添加罕贵度',
    editable: true,
    placeholderText: '输入罕贵度名称，如 UR、SR',
    success: (res) => {
      if (res.confirm && res.content && res.content.trim()) {
        const val = res.content.trim().toUpperCase()
        if (list.value.includes(val)) {
          uni.showToast({ title: '该罕贵度已存在', icon: 'none' })
          return
        }
        const newList = [...list.value, val]
        emit('update:modelValue', newList)
      }
    }
  })
}

const onDelete = (index) => {
  const newList = [...list.value]
  newList.splice(index, 1)
  emit('update:modelValue', newList)
}

const onMoveUp = (index) => {
  const newList = [...list.value]
  ;[newList[index - 1], newList[index]] = [newList[index], newList[index - 1]]
  emit('update:modelValue', newList)
}

const onMoveDown = (index) => {
  const newList = [...list.value]
  ;[newList[index], newList[index + 1]] = [newList[index + 1], newList[index]]
  emit('update:modelValue', newList)
}
</script>

<style scoped>
.editor-section {
  background-color: #FFFFFF;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
}
.section-header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.section-title {
  font-size: 15px;
  font-weight: 500;
  color: #1A1A1A;
}
.add-btn {
  background-color: #FF0000;
  border-radius: 14px;
  padding: 4px 14px;
}
.add-text {
  font-size: 12px;
  color: #FFFFFF;
}
.rarity-list {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
}
.rarity-chip {
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: #F5F5F7;
  border-radius: 16px;
  padding: 6px 8px 6px 12px;
  gap: 6px;
}
.chip-text {
  font-size: 13px;
  color: #1A1A1A;
  font-weight: 500;
}
.chip-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 2px;
}
.move-btn {
  width: 22px;
  height: 22px;
  border-radius: 11px;
  background-color: #E0E0E0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.move-text {
  font-size: 10px;
  color: #666666;
}
.delete-btn {
  width: 22px;
  height: 22px;
  border-radius: 11px;
  background-color: #FFE0E0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.delete-text {
  font-size: 10px;
  color: #FF0000;
}
.empty-hint {
  font-size: 13px;
  color: #999999;
  padding: 8px 0;
}
</style>
