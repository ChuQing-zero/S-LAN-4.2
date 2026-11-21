<template>
  <view class="editor-section">
    <view class="section-header">
      <text class="section-title">版本管理</text>
      <view class="add-btn" @tap="onAdd">
        <text class="add-text">+ 添加版本</text>
      </view>
    </view>

    <view class="version-list" v-if="versions.length > 0">
      <view class="version-row" v-for="(v, index) in versions" :key="v.id || index">
        <!-- 图标 -->
        <view class="col-icon" @tap="onChangeLogo(index)">
          <image
            class="logo-img"
            :src="v.logo || '/static/icons/avatar.png'"
            mode="aspectFill"
          />
          <view class="logo-overlay">
            <text class="overlay-text">换</text>
          </view>
        </view>

        <!-- 名称 + 语言 -->
        <view class="col-info">
          <input
            class="input-name"
            :value="v.name"
            placeholder="版本名称"
            @input="onFieldChange(index, 'name', $event.detail.value)"
          />
          <input
            class="input-lang"
            :value="v.lang"
            placeholder="语种（如 日文、简中）"
            @input="onFieldChange(index, 'lang', $event.detail.value)"
          />
        </view>

        <!-- 删除 -->
        <view class="col-action" v-if="versions.length > 1">
          <view class="del-btn" @tap="onDelete(index)">
            <text class="del-text">删除</text>
          </view>
        </view>
      </view>
    </view>

    <text class="empty-hint" v-else>暂无版本</text>

    <!-- 保存按钮 -->
    <view class="save-row">
      <text class="save-hint" v-if="changed">有未保存的修改</text>
      <view class="save-btn" :class="{ 'save-btn--loading': saving }" @tap="onSave">
        <text class="save-text">{{ saving ? '保存中...' : '保存版本' }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, watch } from 'vue'
import { getVersions } from '@/api/index.js'
import { updateVersion, createVersion } from '@/api/admin.js'

const DEFAULT_LOGO = '/static/icons/version_logos/logo_yugioh_test.png'

// 出厂默认版本
const FALLBACK_VERSIONS = [
  { id: 1, name: '游戏王日文', lang: '日文', logo: DEFAULT_LOGO },
  { id: 2, name: '游戏王简中', lang: '简中', logo: DEFAULT_LOGO },
  { id: 3, name: '游戏王英文', lang: '英文', logo: DEFAULT_LOGO },
  { id: 4, name: '宝可梦日文', lang: '日文', logo: DEFAULT_LOGO },
  { id: 5, name: '宝可梦简中', lang: '简中', logo: DEFAULT_LOGO },
  { id: 6, name: '宝可梦英文', lang: '英文', logo: DEFAULT_LOGO }
]

const versions = ref([])
const originalJson = ref('')
const changed = ref(false)
const saving = ref(false)

const loadVersions = async () => {
  try {
    const data = await getVersions()
    const raw = data.list || []
    if (raw.length > 0) {
      // 合并后端数据与出厂默认：用出厂名称覆盖乱码
      const fallbackMap = {}
      FALLBACK_VERSIONS.forEach(v => { fallbackMap[v.id] = v })
      versions.value = raw.map(v => {
        const id = v.id || v.versionId
        const fb = fallbackMap[id]
        return {
          ...v,
          id,
          // 后端中文有编码问题，优先使用出厂默认名称和logo
          name: fb ? fb.name : (v.name || ''),
          lang: fb ? fb.lang : (v.lang || '日文'),
          logo: v.logo || (fb ? fb.logo : DEFAULT_LOGO)
        }
      })
      // 补充后端没有的出厂版本
      const backendIds = new Set(versions.value.map(v => v.id))
      FALLBACK_VERSIONS.forEach(v => {
        if (!backendIds.has(v.id)) {
          versions.value.push({ ...v })
        }
      })
    } else {
      versions.value = FALLBACK_VERSIONS.map(v => ({ ...v }))
    }
    originalJson.value = JSON.stringify(versions.value)
  } catch (e) {
    versions.value = FALLBACK_VERSIONS.map(v => ({ ...v }))
    originalJson.value = JSON.stringify(versions.value)
  }
}

loadVersions()

watch(versions, () => {
  changed.value = JSON.stringify(versions.value) !== originalJson.value
}, { deep: true })

const onFieldChange = (index, field, value) => {
  const newVersions = [...versions.value]
  newVersions[index] = { ...newVersions[index], [field]: value }
  versions.value = newVersions
}

const onChangeLogo = (index) => {
  uni.chooseImage({
    count: 1,
    sourceType: ['album', 'camera'],
    success: (res) => {
      const newVersions = [...versions.value]
      newVersions[index] = { ...newVersions[index], logo: res.tempFilePaths[0] }
      versions.value = newVersions
    }
  })
}

const onAdd = () => {
  const maxId = versions.value.reduce((max, v) => Math.max(max, v.id || 0), 0)
  versions.value = [...versions.value, {
    id: maxId + 1,
    name: '新版本',
    lang: '日文',
    logo: ''
  }]
}

const onDelete = (index) => {
  const v = versions.value[index]
  uni.showModal({
    title: '删除版本',
    content: `确定删除「${v.name}」吗？`,
    success: (res) => {
      if (res.confirm) {
        const newVersions = [...versions.value]
        newVersions.splice(index, 1)
        versions.value = newVersions
      }
    }
  })
}

const onSave = async () => {
  for (const v of versions.value) {
    if (!v.name.trim()) {
      uni.showToast({ title: '版本名称不能为空', icon: 'none' })
      return
    }
  }

  saving.value = true
  let saved = 0
  try {
    for (const v of versions.value) {
      const payload = {
        name: v.name,
        lang: v.lang,
        logo: v.logo || DEFAULT_LOGO
      }
      try {
        // 先尝试更新已有版本
        await updateVersion(v.id, payload)
      } catch (e) {
        // PUT 失败（版本可能不存在）→ 尝试新建
        try {
          await createVersion(payload)
        } catch (e2) {
          // 创建也失败则跳过，继续下一个
          console.error('版本保存失败:', v.name, e2.message)
        }
      }
      saved++
    }
    // 重新加载以获取后端实际数据
    await loadVersions()
    changed.value = false
    uni.showToast({ title: `已保存 ${saved} 个版本`, icon: 'success' })
  } catch (e) {
    console.error('保存版本失败:', e.message)
  } finally {
    saving.value = false
  }
}

defineExpose({ loadVersions })
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

.version-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.version-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 10px 8px;
  background-color: #F8F8F8;
  border-radius: 10px;
  gap: 10px;
}

.col-icon {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  overflow: hidden;
  position: relative;
  flex-shrink: 0;
  background-color: #EEEEEE;
}
.logo-img {
  width: 48px;
  height: 48px;
}
.logo-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 18px;
  background: rgba(0,0,0,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}
.overlay-text {
  font-size: 10px;
  color: #FFFFFF;
}

.col-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.input-name {
  background-color: #FFFFFF;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 14px;
  color: #1A1A1A;
  height: 34px;
  box-sizing: border-box;
}
.input-lang {
  background-color: #FFFFFF;
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  color: #666666;
  height: 30px;
  box-sizing: border-box;
}
.col-action {
  flex-shrink: 0;
}
.del-btn {
  background-color: #FFE0E0;
  border-radius: 12px;
  padding: 4px 10px;
}
.del-text {
  font-size: 11px;
  color: #FF0000;
}

.empty-hint {
  font-size: 13px;
  color: #999999;
  text-align: center;
  padding: 20px 0;
}

.save-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  margin-top: 14px;
  gap: 12px;
}
.save-hint {
  font-size: 12px;
  color: #FF9900;
}
.save-btn {
  background-color: #FF0000;
  border-radius: 20px;
  padding: 8px 24px;
}
.save-btn--loading {
  opacity: 0.6;
  pointer-events: none;
}
.save-text {
  font-size: 14px;
  color: #FFFFFF;
  font-weight: 500;
}
</style>
