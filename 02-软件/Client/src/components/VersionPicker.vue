<template>
  <view v-if="visible" class="modal-mask" :style="{ top: topOffset + 'px' }" @tap="onClose"></view>
  <view v-if="visible" class="popup popup-show" :style="{ top: topOffset + 'px', maxHeight: 'calc(100vh - ' + topOffset + 'px)' }" @tap.stop>
    <view class="version-grid">
      <view
        class="version-item"
        :class="{ 'version-item-active': activeId === item.id }"
        v-for="item in versionList"
        :key="item.id"
        @tap="selectVersion(item)"
      >
        <view class="logo-wrap">
          <image class="logo" :src="item.logo" mode="aspectFit"></image>
          <view class="lang-tag">{{ item.lang }}</view>
        </view>
        <text class="version-name">{{ item.name }}</text>
      </view>
      <view class="version-item version-add" v-if="showAdd" @tap="$emit('add')">
        <text class="add-icon">+</text>
        <text class="version-name">添加</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { getVersions } from '@/api/index.js'

const props = defineProps({
  topOffset: { type: Number, default: 0 },
  showAdd: { type: Boolean, default: false }
})

const emit = defineEmits(['select', 'close'])

const visible = ref(false)
const activeId = ref(1)
const versionList = ref([])

// 出厂默认版本（后端无数据时兜底）
const DEFAULT_LOGO = '/static/icons/version_logos/logo_yugioh_test.png'
const FALLBACK_VERSIONS = [
  { id: 1, name: '游戏王日文', lang: '日文', logo: DEFAULT_LOGO },
  { id: 2, name: '游戏王简中', lang: '简中', logo: DEFAULT_LOGO },
  { id: 3, name: '游戏王英文', lang: '英文', logo: DEFAULT_LOGO },
  { id: 4, name: '宝可梦日文', lang: '日文', logo: DEFAULT_LOGO },
  { id: 5, name: '宝可梦简中', lang: '简中', logo: DEFAULT_LOGO },
  { id: 6, name: '宝可梦英文', lang: '英文', logo: DEFAULT_LOGO }
]

const fetchVersions = async () => {
  try {
    const data = await getVersions()
    const raw = data.list || []
    // 规范化：后端可能返回 versionId 而非 id
    versionList.value = raw.length > 0
      ? raw.map(v => ({ ...v, id: v.id || v.versionId }))
      : FALLBACK_VERSIONS
  } catch (e) {
    versionList.value = FALLBACK_VERSIONS
  }
}

const open = (currentName) => {
  fetchVersions().then(() => {
    const found = versionList.value.find(v => v.name === currentName)
    if (found) activeId.value = found.id
  })
  visible.value = true
}

const onClose = () => {
  visible.value = false
  emit('close')
}

const selectVersion = (item) => {
  activeId.value = item.id
  emit('select', item)
  onClose()
}

defineExpose({ open, onClose, visible })
</script>

<style scoped>
.modal-mask {
  position: fixed;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  z-index: 200;
  overflow: hidden;
}

.popup {
  position: fixed;
  left: 0;
  width: 100%;
  z-index: 202;
  background-color: #FFFFFF;
  border-radius: 0 0 16px 16px;
  padding: 16px;
  box-sizing: border-box;
  overflow-y: auto;
}

.version-grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  padding-bottom: 16px;
}

.version-item {
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

.version-item-active {
  background-color: #FF0000;
}

.version-item-active .version-name {
  color: #FFFFFF;
}

.logo-wrap {
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

.lang-tag {
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

.logo {
  width: 64px;
  height: 37px;
}

.version-name {
  font-size: 10px;
  font-weight: 700;
  color: #1A1A1A;
  text-align: center;
}
.version-add {
  background-color: #FFF;
  border: 2px dashed #FF0000;
}
.version-add .version-name { color: #FF0000; }
.add-icon { font-size: 20px; color: #FF0000; font-weight: 700; line-height: 1; }
</style>
