<template>
  <view class="editor-section">
    <view class="section-header">
      <text class="section-title">品相列表</text>
      <view class="add-btn" @tap="onAdd">
        <text class="add-text">+ 添加品相</text>
      </view>
    </view>

    <view class="grade-table" v-if="list.length > 0">
      <view class="grade-row" v-for="(item, index) in list" :key="index">
        <!-- 序号 -->
        <view class="col-num">
          <text class="num-text">{{ index + 1 }}</text>
        </view>

        <!-- 品相名 -->
        <view class="col-name">
          <input
            class="input-name"
            :value="item.name"
            placeholder="品相名"
            @input="onFieldChange(index, 'name', $event.detail.value)"
          />
        </view>

        <!-- 描述 -->
        <view class="col-desc">
          <input
            class="input-desc"
            :value="item.desc"
            placeholder="描述（可选）"
            @input="onFieldChange(index, 'desc', $event.detail.value)"
          />
        </view>

        <!-- 含子项 -->
        <view class="col-sub" @tap="onToggleSub(index)">
          <text class="sub-tag" :class="{ 'sub-tag--on': item.hasSub }">
            {{ item.hasSub ? '子' : '—' }}
          </text>
        </view>

        <!-- 排序 -->
        <view class="col-sort">
          <view class="sort-btn" :class="{ disabled: index === 0 }" @tap="onMoveUp(index)">
            <text class="sort-arrow">▲</text>
          </view>
          <view class="sort-btn" :class="{ disabled: index === list.length - 1 }" @tap="onMoveDown(index)">
            <text class="sort-arrow">▼</text>
          </view>
        </view>

        <!-- 删除 -->
        <view class="col-del">
          <view class="del-btn" @tap="onDelete(index)">
            <text class="del-text">✕</text>
          </view>
        </view>
      </view>
    </view>

    <text class="empty-hint" v-else>暂无品相，请点击「+ 添加品相」</text>
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

const onFieldChange = (index, field, value) => {
  const newList = [...list.value]
  newList[index] = { ...newList[index], [field]: value }
  emit('update:modelValue', newList)
}

const onToggleSub = (index) => {
  const newList = [...list.value]
  newList[index] = { ...newList[index], hasSub: !newList[index].hasSub }
  emit('update:modelValue', newList)
}

const onAdd = () => {
  const newList = [...list.value, { name: '', desc: '', hasSub: false }]
  emit('update:modelValue', newList)
}

const onDelete = (index) => {
  uni.showModal({
    title: '删除品相',
    content: `确定删除「${list.value[index].name || '未命名'}」？`,
    success: (res) => {
      if (res.confirm) {
        const newList = [...list.value]
        newList.splice(index, 1)
        emit('update:modelValue', newList)
      }
    }
  })
}

const onMoveUp = (index) => {
  if (index === 0) return
  const newList = [...list.value]
  ;[newList[index - 1], newList[index]] = [newList[index], newList[index - 1]]
  emit('update:modelValue', newList)
}

const onMoveDown = (index) => {
  if (index === list.value.length - 1) return
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

/* ========== 表格 ========== */
.grade-table {
  border-radius: 10px;
  overflow: hidden;
}
.grade-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 10px 8px;
  border-bottom: 1px solid #F0F0F0;
  gap: 6px;
}
.grade-row:last-child {
  border-bottom: none;
}

/* ========== 列 ========== */
.col-num {
  width: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.num-text {
  font-size: 12px;
  color: #BBBBBB;
  font-weight: 500;
}

.col-name {
  flex: 1;
  min-width: 60px;
}
.input-name {
  background-color: #F5F5F7;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  color: #1A1A1A;
  height: 36px;
  box-sizing: border-box;
  width: 100%;
}

.col-desc {
  flex: 1.5;
  min-width: 80px;
}
.input-desc {
  background-color: #F5F5F7;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  color: #666666;
  height: 36px;
  box-sizing: border-box;
  width: 100%;
}

.col-sub {
  width: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sub-tag {
  font-size: 10px;
  color: #BBBBBB;
  background-color: #F0F0F0;
  border-radius: 10px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sub-tag--on {
  color: #FFFFFF;
  background-color: #FF0000;
}

.col-sort {
  width: 28px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sort-btn {
  width: 24px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}
.sort-btn.disabled {
  opacity: 0.25;
}
.sort-arrow {
  font-size: 8px;
  color: #999999;
}

.col-del {
  width: 30px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.del-btn {
  width: 26px;
  height: 26px;
  border-radius: 13px;
  background-color: #FFE0E0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.del-text {
  font-size: 12px;
  color: #FF0000;
}

.empty-hint {
  font-size: 13px;
  color: #999999;
  text-align: center;
  padding: 20px 0;
}
</style>
