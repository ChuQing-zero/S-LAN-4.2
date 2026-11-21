<template>
  <view v-if="visible" class="dialog-mask" @tap="onCancel">
    <view class="dialog-box" @tap.stop>
      <text class="dialog-text">{{ message }}</text>
      <view class="dialog-btns">
        <view class="btn-cancel" @tap="onCancel">
          <text class="cancel-text">取消</text>
        </view>
        <view class="btn-confirm" @tap="onConfirm">
          <text class="confirm-text">确定</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { transferUpload, transferDownload, convertLibraryToCloud, convertLibraryToLocal } from '@/api/index.js'

const emit = defineEmits(['confirm', 'cancel'])

const visible = ref(false)
const message = ref('')
const transferType = ref('')
const transferParams = ref({})

// open(msg, type, params)
// type: 'upload' | 'download'
// params: { fromCode, toCode, cardIds }
const open = (msg, type, params = {}) => {
  message.value = msg
  transferType.value = type || ''
  transferParams.value = params
  visible.value = true
}

const onCancel = () => {
  visible.value = false
  emit('cancel')
}

const onConfirm = async () => {
  const p = transferParams.value
  try {
    if (transferType.value === 'upload') {
      await transferUpload({ fromCode: p.fromCode, toCode: p.toCode, cardIds: p.cardIds || [] })
      uni.showToast({ title: '操作成功', icon: 'success' })
    } else if (transferType.value === 'download') {
      await transferDownload({ fromCode: p.fromCode, toCode: p.toCode, cardIds: p.cardIds || [] })
      uni.showToast({ title: '操作成功', icon: 'success' })
    } else if (transferType.value === 'convert') {
      await convertLibraryToCloud({ code: p.code })
      uni.showToast({ title: '已迁移为云端库', icon: 'success' })
    } else if (transferType.value === 'convert-local') {
      await convertLibraryToLocal({ code: p.code })
      uni.showToast({ title: '已下载到本地库', icon: 'success' })
    }
  } catch (e) {
    // 错误已在 request.js 处理
  }
  visible.value = false
  emit('confirm')
}

defineExpose({ open })
</script>

<style scoped>
.dialog-mask {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog-box {
  width: calc(100% - 64px);
  background-color: #FFFFFF;
  border-radius: 16px;
  padding: 24px 20px 20px 20px;
  box-sizing: border-box;
}

.dialog-text {
  font-size: 15px;
  color: #1A1A1A;
  text-align: center;
  display: block;
  margin-bottom: 24px;
  line-height: 1.5;
}

.dialog-btns {
  display: flex;
  flex-direction: row;
  gap: 12px;
}

.btn-cancel {
  flex: 1;
  background-color: #F0F0F0;
  border-radius: 50px;
  padding: 6px;
  text-align: center;
}

.cancel-text {
  font-size: 14px;
  color: #1A1A1A;
  font-weight: 500;
}

.btn-confirm {
  flex: 1;
  background-color: #FF0000;
  border-radius: 50px;
  padding: 6px;
  text-align: center;
}

.confirm-text {
  font-size: 14px;
  color: #FFFFFF;
  font-weight: 500;
}
</style>
