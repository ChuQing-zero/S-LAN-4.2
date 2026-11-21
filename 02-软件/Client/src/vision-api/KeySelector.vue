<template>
  <text class="key-pill" @tap="showPicker">{{ displayLabel }}</text>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { getVisionKeys } from '@/api/index.js'

/**
 * 豆包钥匙选择器（识别页 API 栏右侧）
 * modelValue: '' = 跟随后台默认钥匙；否则为所选钥匙 id
 * 显示所选钥匙名字，超长截断前6字 + …
 */
const props = defineProps({
  modelValue: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue'])

const keys = ref([])

const defaultKey = computed(() => keys.value.find((k) => k.isDefault) || keys.value[0] || null)

const truncate = (s) => {
  const str = String(s || '')
  return str.length > 6 ? str.slice(0, 6) + '…' : str
}

const current = computed(() => {
  if (props.modelValue) {
    return keys.value.find((k) => k.id === props.modelValue) || null
  }
  return defaultKey.value
})

const displayLabel = computed(() => {
  const k = current.value
  return k ? truncate(k.name) : '豆包'
})

const loadKeys = async () => {
  try {
    const data = await getVisionKeys()
    keys.value = data?.list || []
  } catch (_) {
    // 网络异常不阻塞，仍可用默认钥匙
  }
}

const showPicker = async () => {
  if (!keys.value.length) await loadKeys()
  if (!keys.value.length) return uni.showToast({ title: '暂无可用钥匙，请到后台添加', icon: 'none' })
  const defaultName = defaultKey.value ? defaultKey.value.name : '无'
  const itemList = ['跟随默认（' + defaultName + '）', ...keys.value.map((k) => k.name + '（' + k.maskedKey + '）')]
  uni.showActionSheet({
    itemList,
    success: (res) => {
      if (res.tapIndex === 0) {
        emit('update:modelValue', '')
        uni.showToast({ title: '已跟随后台默认钥匙', icon: 'none', duration: 1200 })
      } else {
        const k = keys.value[res.tapIndex - 1]
        if (k) {
          emit('update:modelValue', k.id)
          uni.showToast({ title: '已切换：' + k.name, icon: 'none', duration: 1200 })
        }
      }
    }
  })
}

onMounted(loadKeys)
</script>

<style scoped>
.key-pill {
  font-size: 11px;
  color: #4A90D9;
  background: #F0F4FF;
  padding: 2px 8px;
  border-radius: 10px;
  flex-shrink: 0;
}
</style>
