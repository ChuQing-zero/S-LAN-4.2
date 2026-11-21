<template>
  <view v-show="visible" class="modal-mask" :style="{ top: topOffset + 'px' }" @tap="onClose"></view>
  <view v-show="visible" class="popup popup-show" :style="{ top: topOffset + 'px', maxHeight: 'calc(100vh - ' + topOffset + 'px)' }" @tap.stop>
    <!-- 罕贵度 -->
    <text class="section-label">罕贵度</text>
    <view class="rarity-grid">
      <view
        class="rarity-item"
        :class="{ 'rarity-active': selRarity === r }"
        v-for="r in rarityList"
        :key="r"
        @tap="onRarityTap(r)"
      >
        <text class="rarity-text" :class="{ 'rarity-text-active': selRarity === r }">{{ r }}</text>
      </view>
    </view>

    <!-- 品相 -->
    <text class="section-label">品相</text>
    <view class="grade-grid">
      <view
        class="grade-item"
        :class="{ 'grade-active': selCondition === c }"
        v-for="c in conditionList"
        :key="c"
        @tap="onConditionTap(c)"
      >
        <text class="grade-name">{{ c }}</text>
      </view>
    </view>

    <!-- 备注 -->
    <text class="section-label">备注</text>
    <view class="grade-grid">
      <view
        class="grade-item"
        :class="{ 'grade-active': selGrade && selGrade.name === g.name }"
        v-for="g in gradeList"
        :key="g.name"
        @tap="onGradeTap(g)"
      >
        <text class="grade-name">{{ g.name }}</text>
        <text class="grade-desc" v-if="g.desc">{{ g.desc }}</text>
        <text class="grade-arrow" v-if="g.hasSub">›</text>
      </view>
    </view>
  </view>

    <!-- 二级弹窗 -->
    <view v-if="subVisible" class="sub-mask" @tap="subVisible = false">
      <view class="sub-popup" @tap.stop>
        <text class="sub-title">{{ subTitle }}</text>
        <scroll-view class="sub-scroll" scroll-y="true">
          <view
            class="sub-item"
            v-for="item in subList"
            :key="item"
            @tap="onSubSelect(item)"
          >
            <text>{{ item }}</text>
          </view>
        </scroll-view>
      </view>
    </view>
</template>

<script setup>
import { ref } from 'vue'
import { getRarities, getGrades, getPsaGrades } from '@/api/index.js'

const props = defineProps({
  topOffset: { type: Number, default: 0 },
  versionId: { type: Number, default: 0 }
})

const emit = defineEmits(['confirm', 'close'])

const visible = ref(false)
const animShow = ref(false)
const selRarity = ref('QCSER')
const selCondition = ref('流通品相')
const selGrade = ref(null)
const conditionList = ['流通品相', '有瑕疵', '有损伤']

const rarityList = ref([
  '20SER', 'QCSER', 'PSER', 'HR', 'HPR', 'ESR', 'ESPR', 'SER',
  'SEMR', 'SEPR', 'PR', 'UPR', 'PGR', 'GSER', 'GMR', 'GR',
  'UTR', 'CR', 'UR', 'RR', 'USR', 'UMR', 'SR', 'SPR',
  'NPR', 'NMR', 'NKC', 'R', 'RKC', 'RPR', 'N', 'NR'
])

const gradeList = ref([
  { name: '99品', desc: '完美全新', hasSub: false },
  { name: '9品', desc: '近新优品', hasSub: false },
  { name: '78品', desc: '标准流通', hasSub: false },
  { name: '56品', desc: '中小瑕疵', hasSub: false },
  { name: '34品', desc: '重大次品', hasSub: false },
])

const subVisible = ref(false)
const subTitle = ref('')
const subList = ref([])

const psaList = ref(['PSA 10', 'PSA 9', 'PSA 8', 'PSA 7', 'PSA 6', 'PSA 5', 'PSA 4', 'PSA 3', 'PSA 2', 'PSA 1'])
const customList = ['损品', '折角', '划痕', '褪色', '污渍', '缺角', '其他']

const fetchData = async () => {
  try {
    const versionId = props.versionId || undefined
    const [rarityData, gradeData, psaData] = await Promise.all([
      getRarities(versionId),
      getGrades(versionId),
      getPsaGrades()
    ])
    if (rarityData.list) rarityList.value = rarityData.list
    if (gradeData.list) gradeList.value = gradeData.list
    if (psaData.list) psaList.value = psaData.list
    return {
      defaultRarity: rarityData.default || null,
      defaultGrade: gradeData.default || null
    }
  } catch (e) { /* 使用默认数据 */ }
}

const open = (currentRarity, currentCondition, currentGrade) => {
  selRarity.value = currentRarity || 'QCSER'
  selCondition.value = currentCondition || '流通品相'
  selGrade.value = currentGrade || null
  animShow.value = false
  visible.value = true
  fetchData()
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { animShow.value = true })
  })
}

const onClose = () => {
  if (subVisible.value) {
    subVisible.value = false
    return
  }
  animShow.value = false
  setTimeout(() => {
    visible.value = false
    emit('close')
  }, 300)
}

const onRarityTap = (r) => {
  selRarity.value = r
  emit('confirm', { rarity: selRarity.value, condition: selCondition.value, grade: selGrade.value })
}

const onConditionTap = (c) => {
  selCondition.value = c
  emit('confirm', { rarity: selRarity.value, condition: selCondition.value, grade: selGrade.value })
}

const onGradeTap = (g) => {
  if (g.hasSub) {
    subTitle.value = g.name
    subList.value = g.name === '评级卡' ? psaList.value : customList
    subVisible.value = true
  } else {
    selGrade.value = g
    emit('confirm', { rarity: selRarity.value, condition: selCondition.value, grade: selGrade.value })
  }
}

const onSubSelect = (item) => {
  selGrade.value = { ...gradeList.find(g => g.name === subTitle.value), subValue: item }
  subVisible.value = false
  emit('confirm', { rarity: selRarity.value, condition: selCondition.value, grade: selGrade.value })
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
  opacity: 0;
  transform: translateY(-8px);
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.popup-show {
  opacity: 1;
  transform: translateY(0);
}

.section-label {
  font-size: 16px;
  font-weight: 600;
  color: #333333;
  padding: 0 0 6px 0;
  display: block;
}

/* 罕贵度 */
.rarity-grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 12px;
}

.rarity-item {
  background-color: #F5F5F7;
  border-radius: 50px;
  padding: 6px 12px;
  text-align: center;
  box-sizing: border-box;
}

.rarity-active {
  background-color: #FF0000;
}

.rarity-text {
  font-size: 13px;
  color: #1A1A1A;
}

.rarity-text-active {
  color: #FFFFFF;
}

/* 品相 */
.grade-grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 16px;
}

.grade-item {
  background-color: #F5F5F7;
  border-radius: 50px;
  padding: 6px 14px;
  display: flex;
  flex-direction: row;
  align-items: center;
  box-sizing: border-box;
}

.grade-active {
  background-color: #FF0000;
}

.grade-active .grade-name,
.grade-active .grade-desc,
.grade-active .grade-arrow {
  color: #FFFFFF;
}

.grade-name {
  font-size: 13px;
  font-weight: 600;
  color: #1A1A1A;
}

.grade-desc {
  font-size: 11px;
  color: #999999;
  margin-left: 4px;
}

.grade-arrow {
  font-size: 16px;
  color: #999999;
  margin-left: 4px;
}

/* 二级弹窗 */
.sub-mask {
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

.sub-popup {
  width: 75%;
  max-height: 60%;
  background-color: #FFFFFF;
  border-radius: 16px;
  padding: 20px;
}

.sub-title {
  font-size: 16px;
  font-weight: 600;
  color: #1A1A1A;
  text-align: center;
  display: block;
  margin-bottom: 16px;
}

.sub-scroll {
  max-height: 300px;
}

.sub-item {
  padding: 14px 0;
  border-bottom: 1px solid #F0F0F0;
  text-align: center;
  font-size: 14px;
  color: #1A1A1A;
}
</style>
