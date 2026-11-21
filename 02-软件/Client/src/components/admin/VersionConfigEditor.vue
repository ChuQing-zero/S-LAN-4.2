<template>
  <view class="config-editor">
    <!-- 加载中 -->
    <view class="loading-box" v-if="loading">
      <text class="loading-text">加载配置中...</text>
    </view>

    <!-- 编辑区域 -->
    <view v-else>
      <!-- 罕贵度编辑器 -->
      <RarityListEditor v-model="rarities" />

      <!-- 品相编辑器 -->
      <GradeListEditor v-model="grades" />

      <!-- 默认选择器 -->
      <DefaultSelector
        :rarities="rarities"
        :grades="grades"
        :defaultRarity="defaultRarity"
        :defaultGrade="defaultGrade"
        @update:defaultRarity="defaultRarity = $event"
        @update:defaultGrade="defaultGrade = $event"
      />

      <!-- 底部提示 -->
      <text class="last-saved" v-if="lastUpdated">上次保存：{{ lastUpdated }}</text>

      <!-- 保存按钮 -->
      <view class="save-btn" :class="{ 'save-btn--loading': saving }" @tap="onSave">
        <text class="save-text">{{ saving ? '保存中...' : '保存配置' }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, watch } from 'vue'
import RarityListEditor from './RarityListEditor.vue'
import GradeListEditor from './GradeListEditor.vue'
import DefaultSelector from './DefaultSelector.vue'
import { updateVersionConfig } from '@/api/admin.js'
import { getFactoryDefaults } from '@/config/admin-defaults.js'

const props = defineProps({
  versionId: { type: Number, required: true },
  versionName: { type: String, default: '' },
  savedConfig: { type: Object, default: null }  // 从 dashboard 传入的已有配置
})

const rarities = ref([])
const grades = ref([])
const defaultRarity = ref('')
const defaultGrade = ref('')
const lastUpdated = ref('')
const loading = ref(false)
const saving = ref(false)

// 加载版本配置（优先用传入的已有配置，没有再请求）
const loadConfig = async () => {
  if (!props.versionId) return
  loading.value = true
  try {
    // 优先使用 dashboard 传入的缓存配置，避免 404
    if (props.savedConfig) {
      rarities.value = props.savedConfig.rarities || []
      grades.value = props.savedConfig.grades || []
      defaultRarity.value = props.savedConfig.defaultRarity || ''
      defaultGrade.value = props.savedConfig.defaultGrade || ''
      if (props.savedConfig.updatedAt) {
        lastUpdated.value = new Date(props.savedConfig.updatedAt).toLocaleString('zh-CN')
      }
    } else {
      // 无缓存时使用出厂默认值
      const defaults = getFactoryDefaults(props.versionName)
      rarities.value = defaults.rarities
      grades.value = defaults.grades
      defaultRarity.value = defaults.defaultRarity
      defaultGrade.value = defaults.defaultGrade
      lastUpdated.value = ''
    }
  } catch (e) {
    const defaults = getFactoryDefaults(props.versionName)
    rarities.value = defaults.rarities
    grades.value = defaults.grades
    defaultRarity.value = defaults.defaultRarity
    defaultGrade.value = defaults.defaultGrade
    lastUpdated.value = ''
  } finally {
    loading.value = false
  }
}

// 版本切换时重新加载
watch(() => props.versionId, () => {
  loadConfig()
}, { immediate: true })

// 保存配置
const onSave = async () => {
  // 客户端校验
  if (rarities.value.length === 0) {
    uni.showToast({ title: '罕贵度列表不能为空', icon: 'none' })
    return
  }
  if (!defaultRarity.value) {
    uni.showToast({ title: '请选择默认罕贵度', icon: 'none' })
    return
  }
  if (!defaultGrade.value) {
    uni.showToast({ title: '请选择默认品相', icon: 'none' })
    return
  }
  if (!rarities.value.includes(defaultRarity.value)) {
    uni.showToast({ title: '默认罕贵度必须在罕贵度列表中', icon: 'none' })
    return
  }
  if (!grades.value.some(g => g.name === defaultGrade.value)) {
    uni.showToast({ title: '默认品相必须在品相列表中', icon: 'none' })
    return
  }

  // 过滤空值
  const cleanRarities = rarities.value.filter(r => r && r.trim())
  const cleanGrades = grades.value.filter(g => g.name && g.name.trim())
  if (cleanRarities.length === 0) {
    uni.showToast({ title: '至少需要一个罕贵度', icon: 'none' })
    return
  }
  if (cleanGrades.length === 0) {
    uni.showToast({ title: '至少需要一个品相', icon: 'none' })
    return
  }

  saving.value = true
  try {
    const payload = {
      rarities: cleanRarities,
      grades: cleanGrades.map(g => ({ name: g.name, desc: g.desc || '', hasSub: !!g.hasSub })),
      defaultRarity: defaultRarity.value,
      defaultGrade: defaultGrade.value
    }
    const data = await updateVersionConfig(props.versionId, payload)
    lastUpdated.value = new Date(data.updatedAt || Date.now()).toLocaleString('zh-CN')
    uni.showToast({ title: '保存成功', icon: 'success' })
  } catch (e) {
    console.error('保存失败:', e.message)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.config-editor {
  padding: 0 0 40px 0;
}
.loading-box {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
}
.loading-text {
  font-size: 14px;
  color: #999999;
}
.last-saved {
  font-size: 12px;
  color: #999999;
  display: block;
  text-align: center;
  margin-bottom: 12px;
}
.save-btn {
  width: 100%;
  height: 48px;
  background-color: #FF0000;
  border-radius: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(255, 0, 0, 0.25);
}
.save-btn--loading {
  opacity: 0.6;
  pointer-events: none;
}
.save-text {
  font-size: 16px;
  font-weight: 500;
  color: #FFFFFF;
}
</style>
