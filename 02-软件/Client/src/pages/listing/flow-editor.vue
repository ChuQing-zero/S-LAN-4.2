<template>
  <view class="page-container">
    <view class="toolbar-panel">
      <view class="toolbar">
        <view class="toolbar-left">
          <view class="tool-btn" @tap="goBack"><image class="icon-sm" src="/static/icons/ic_back.png" mode="aspectFit" /></view>
        </view>
        <text class="tool-title">流程编辑器 - PC</text>
        <view class="toolbar-right">
          <view class="tool-btn calib-btn" @tap="showCalibModal = true"><text class="calib-text">缩放校准</text></view>
          <view class="tool-btn" @tap="showAddModal = true"><text style="font-size:18px;color:#FF0000">+</text></view>
        </view>
      </view>
    </view>

    <scroll-view class="main-scroll" scroll-y>
      <view class="flow-list">
        <view class="flow-item" v-for="(flow, fi) in flows" :key="fi">
          <view class="flow-head" @tap="flow._open = !flow._open">
            <view style="flex:1;min-width:0">
              <text class="flow-name">{{ flow.name }}</text>
              <text class="flow-desc">{{ flow.desc || '' }}</text>
            </view>
            <view style="display:flex;gap:6px;align-items:center;flex-shrink:0">
              <text class="flow-count">{{ (flow.steps || []).length }}步</text>
              <text class="flow-arrow">{{ flow._open ? '▾' : '▸' }}</text>
            </view>
          </view>
          <view v-if="flow._open" class="flow-body">
            <view class="form-row">
              <text class="form-label">名称</text>
              <input class="form-input" v-model="flow.name" placeholder="流程名称" />
            </view>
            <view class="form-row">
              <text class="form-label">描述</text>
              <input class="form-input" v-model="flow.desc" placeholder="流程描述" />
            </view>
            <view class="step-list">
              <view class="step-item" v-for="(step, si) in (flow.steps || [])" :key="si">
                <view class="step-head" @tap="step._open = !step._open">
                  <text class="step-num">{{ si + 1 }}</text>
                  <text class="step-desc">{{ step.desc || '新步骤' }}</text>
                  <view style="display:flex;gap:4px;margin-left:auto">
                    <view class="step-btn-sm" @tap.stop="moveStep(flow, si, -1)"><text>▲</text></view>
                    <view class="step-btn-sm" @tap.stop="moveStep(flow, si, 1)"><text>▼</text></view>
                    <view class="step-btn-sm del" @tap.stop="flow.steps.splice(si,1)"><text>✕</text></view>
                  </view>
                </view>
                <view v-if="step._open" class="step-body">
                  <view class="form-row-sm">
                    <text class="fl">类型</text>
                    <picker :value="stepTypeKeys.indexOf(step.stepType)" :range="stepTypes" @change="(e)=>{onStepTypeChange(step, stepTypeKeys[e.detail.value])}">
                      <view class="form-picker-sm">{{ typeLabel(step.stepType) }}</view>
                    </picker>
                  </view>
                  <view class="form-row-sm">
                    <text class="fl">描述</text>
                    <input class="form-input-sm" v-model="step.desc" placeholder="步骤描述" />
                  </view>
                  <view class="form-row-sm">
                    <text class="fl">时长</text>
                    <input class="form-input-sm" type="number" v-model.number="step.stepDuration" placeholder="0.5" style="width:80px" />
                    <text style="font-size:10px;color:#999">秒</text>
                  </view>
                  <view class="form-row-sm" v-if="step.stepType!=='compare' && step.stepType!=='jump' && step.stepType!=='setvar' && step.stepType!=='compute'">
                    <text class="fl">变量</text>
                    <picker :value="varList.indexOf(step.stepVariable)" :range="varDisplayList" @change="(e)=>{step.stepVariable=varList[e.detail.value]}">
                      <view class="form-picker-sm">{{ varLabel(step.stepVariable) }}</view>
                    </picker>
                  </view>
                  <!-- 跳转 -->
                  <template v-if="step.stepType==='jump'">
                    <view class="form-row-sm">
                      <text class="fl">跳转到</text>
                      <input class="form-input-sm" type="number" v-model.number="step.jumpTo" placeholder="步骤号" style="width:80px" />
                      <text style="font-size:10px;color:#999">步</text>
                    </view>
                  </template>
                  <!-- 设置变量 -->
                  <template v-if="step.stepType==='setvar' || step.stepType==='compute'">
                    <view class="form-row-sm setvar-row">
                      <text class="fl">左变量</text>
                      <picker :value="varList.indexOf(step.leftVar)" :range="varDisplayList" @change="(e)=>{step.leftVar=varList[e.detail.value]}">
                        <view class="form-picker-sm">{{ varLabel(step.leftVar) }}</view>
                      </picker>
                      <text class="setvar-arrow">←</text>
                      <text class="fl" style="width:auto">右变量</text>
                      <picker :value="varList.indexOf(step.rightVar)" :range="varDisplayList" @change="(e)=>{step.rightVar=varList[e.detail.value]}">
                        <view class="form-picker-sm">{{ varLabel(step.rightVar) }}</view>
                      </picker>
                    </view>
                    <text class="setvar-hint">右变量的值 → 赋给左变量</text>
                    <view class="form-row-sm" style="margin-top:6px">
                      <text class="fl">模板</text>
                      <input class="form-input-sm" v-model="step.template" placeholder="如: {{卡牌编号}}({{异画}})" style="flex:1" />
                    </view>
                    <text class="setvar-hint">模板优先；替换后自动去掉空括号()</text>
                  </template>
                  <!-- 比较 -->
                  <template v-if="step.stepType==='compare'">
                    <view class="form-row-sm">
                      <text class="fl">左变量</text>
                      <picker :value="varList.indexOf(step.compareVar)" :range="varDisplayList" @change="(e)=>{step.compareVar=varList[e.detail.value]}">
                        <view class="form-picker-sm">{{ varLabel(step.compareVar) }}</view>
                      </picker>
                    </view>
                    <view class="form-row-sm">
                      <text class="fl">运算符</text>
                      <picker :value="['==','!=','>','<','>=','<='].indexOf(step.compareOp||'==')" :range="['== 等于','!= 不等于','> 大于','< 小于','>= 大于等于','<= 小于等于']" @change="(e)=>{step.compareOp=['==','!=','>','<','>=','<='][e.detail.value]}">
                        <view class="form-picker-sm">{{ step.compareOp || '==' }}</view>
                      </picker>
                    </view>
                    <view class="form-row-sm">
                      <text class="fl">右变量</text>
                      <picker :value="varList.indexOf(step.compareRightVar)" :range="varDisplayList" @change="(e)=>{step.compareRightVar=varList[e.detail.value]}">
                        <view class="form-picker-sm">{{ varLabel(step.compareRightVar) }}</view>
                      </picker>
                    </view>
                    <text class="setvar-hint">优先与右变量比较；右变量为"无"时使用下方对比值</text>
                    <view class="form-row-sm">
                      <text class="fl">对比值</text>
                      <input class="form-input-sm" v-model="step.compareValue" placeholder="比较的值" style="flex:1" />
                    </view>
                    <view class="form-row-sm">
                      <text class="fl">为真→</text>
                      <input class="form-input-sm" type="number" v-model.number="step.trueJump" placeholder="步骤号" style="width:60px" />
                      <text style="font-size:10px;color:#999">步</text>
                      <text class="fl" style="margin-left:12px">为假→</text>
                      <input class="form-input-sm" type="number" v-model.number="step.falseJump" placeholder="步骤号" style="width:60px" />
                      <text style="font-size:10px;color:#999">步</text>
                    </view>
                  </template>
                  <view class="actions-section" v-if="step.stepType!=='compare' && step.stepType!=='jump' && step.stepType!=='setvar' && step.stepType!=='compute'">
                    <text class="actions-title">动作</text>
                    <!-- OCR行号识别：四行布局 -->
                    <template v-if="step.stepType==='ocr-find-row'">
                      <view v-for="(act, ai) in (step.actions || [])" :key="ai" class="ocr-action-block">
                        <view class="ocr-row">
                          <text class="ocr-label">名称</text>
                          <input class="form-input-sm" v-model="act.name" placeholder="动作名称" style="flex:1" />
                          <view class="step-btn-sm del" @tap="step.actions.splice(ai,1)"><text>✕</text></view>
                        </view>
                        <view class="ocr-row">
                          <text class="ocr-label">提示词</text>
                          <input class="form-input-sm" v-model="act.ocrPrompt" placeholder="告诉OCR要识别什么…" style="flex:1" />
                        </view>
                        <view class="ocr-row">
                          <text class="ocr-label">范围</text>
                          <text class="act-xy">X1</text><input class="form-input-xs" type="number" v-model.number="act.x1" />
                          <text class="act-xy">Y1</text><input class="form-input-xs" type="number" v-model.number="act.y1" />
                          <view class="step-btn-sm cap" :class="{armed: act._armedTl}" @tap="armCaptureRegion(act,'tl')"><text>坐标</text></view>
                        </view>
                        <view class="ocr-row">
                          <text class="ocr-label">范围</text>
                          <text class="act-xy">X2</text><input class="form-input-xs" type="number" v-model.number="act.x2" />
                          <text class="act-xy">Y2</text><input class="form-input-xs" type="number" v-model.number="act.y2" />
                          <view class="step-btn-sm cap" :class="{armed: act._armedBr}" @tap="armCaptureRegion(act,'br')"><text>坐标</text></view>
                        </view>
                      </view>
                    </template>
                    <!-- 普通步骤：单行布局 -->
                    <view v-for="(act, ai) in (step.actions || [])" :key="ai" class="action-row" v-if="step.stepType!=='ocr-find-row'">
                      <text class="act-num">{{ ai + 1 }}</text>
                      <input class="form-input-xs" v-model="act.name" placeholder="名称" style="width:56px" />
                      <template v-if="needXY(step.stepType)">
                        <text class="act-xy">X:</text><input class="form-input-xs" type="number" v-model.number="act.x" placeholder="0" />
                        <text class="act-xy">Y:</text><input class="form-input-xs" type="number" v-model.number="act.y" placeholder="0" />
                      </template>
                      <input v-if="step.stepType==='input'" class="form-input-xs" v-model="act.text" placeholder="文本" style="width:60px" />
                      <picker v-if="step.stepType==='press'" :value="keyList.indexOf(act.text)" :range="keyDisplayList" @change="(e)=>{act.text=keyList[e.detail.value]}">
                        <view class="form-picker-sm" style="width:70px">{{ keyLabel(act.text) }}</view>
                      </picker>
                      <input v-if="step.stepType==='scroll'" class="form-input-xs" type="number" v-model.number="act.scroll_clicks" placeholder="滚动" style="width:50px" />
                      <view class="step-btn-sm cap" :class="{armed: act._armed}" v-if="needXY(step.stepType)" @tap="armCapture(act)"><text>坐标</text></view>
                      <view class="step-btn-sm del" @tap="step.actions.splice(ai,1)"><text>✕</text></view>
                    </view>
                    <view class="step-add-act" @tap="addAction(step)"><text>+ 添加动作</text></view>
                  </view>
                </view>
              </view>
            </view>
            <view class="step-add" @tap="addStep(flow)"><text>+ 添加步骤</text></view>
            <view class="flow-actions">
              <view class="btn-save" @tap="saveFlow(flow)"><text class="save-text">💾 保存</text></view>
              <view class="btn-del" @tap="flows.splice(fi,1)"><text class="del-text">🗑 删除</text></view>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>

    <view v-if="showAddModal" class="modal-mask" @tap="showAddModal = false">
      <view class="modal-box" @tap.stop>
        <text class="modal-title">新建流程</text>
        <input class="modal-input" v-model="newFlowName" placeholder="流程名称" />
        <view class="modal-btns">
          <view class="modal-btn cancel" @tap="showAddModal = false"><text>取消</text></view>
          <view class="modal-btn ok" @tap="doAddFlow"><text>创建</text></view>
        </view>
      </view>
    </view>

    <!-- 缩放校准弹窗 -->
    <view v-if="showCalibModal" class="modal-mask" @tap="showCalibModal = false">
      <view class="modal-box" @tap.stop>
        <text class="modal-title">屏幕缩放校准</text>
        <text class="modal-hint">逻辑坐标(鼠标/F8采集) → 物理坐标(截图)</text>
        <view class="calib-row">
          <text class="calib-label">逻辑 X 最大</text>
          <input class="form-input-sm" type="number" v-model.number="calib.logX" style="width:80px" />
          <text class="calib-label">逻辑 Y 最大</text>
          <input class="form-input-sm" type="number" v-model.number="calib.logY" style="width:80px" />
        </view>
        <view class="calib-row">
          <text class="calib-label">物理 X 最大</text>
          <input class="form-input-sm" type="number" v-model.number="calib.phyX" style="width:80px" />
          <text class="calib-label">物理 Y 最大</text>
          <input class="form-input-sm" type="number" v-model.number="calib.phyY" style="width:80px" />
        </view>
        <text class="calib-info">缩放比 X: {{ (calib.phyX / calib.logX || 1).toFixed(3) }} | Y: {{ (calib.phyY / calib.logY || 1).toFixed(3) }}</text>
        <view class="modal-btns" style="margin-top:10px">
          <view class="modal-btn cancel" @tap="showCalibModal = false"><text>取消</text></view>
          <view class="modal-btn ok" @tap="saveCalib"><text>保存</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { authFetch } from '@/utils/authFetch.js'
import { BUILT_IN_FLOWS } from './builtin-flows.js'

const stepTypeKeys = ['click','dblclick','tplclick','drag','input','press','wait','scroll','screenshot','verify','ocr-find-row','compare','jump','setvar','compute']
const keyList = ['enter','backspace','tab','escape','space','delete']
const keyDisplayList = ['回车','退格','Tab','Esc','空格','删除']
const keyLabel = (k) => { const i = keyList.indexOf(k); return i >= 0 ? keyDisplayList[i] : (k || '回车') }
const stepTypes = ['点击','双击','三击','拖拽','输入文本','按键','等待','滚动','截屏','验证','OCR识别行号','比较','跳转','设置变量','计算变量']
const varList = ['','{{卡牌编号}}','{{罕贵度}}','{{卡牌品相}}','{{品相备注}}','{{异画}}','{{价格}}','{{数量}}','{{集换价}}','{{旧罕贵度}}','{{游戏版本}}','{{对应行数}}','集换价(输出)','最低价(输出)','编号(输出)','罕贵度(输出)','中文卡名(输出)','中文别名(输出)','语种(输出)','游戏版本(输出)']
const varDisplayList = ['无','卡牌编号','罕贵度','卡牌品相','品相备注','异画','价格','数量','集换价','旧罕贵度','游戏版本','对应行数','集换价(输出)','最低价(输出)','编号(输出)','罕贵度(输出)','中文卡名(输出)','中文别名(输出)','语种(输出)','游戏版本(输出)']

const needXY = (t) => ['click','dblclick','tplclick','drag'].includes(t)
const captureXY = async (act) => {
  try {
    const r = await authFetch('/v1/api/listing-agent/mouse-position')
    const p = await r.json()
    act.x = p.x; act.y = p.y
    uni.showToast({ title: 'X:'+p.x+' Y:'+p.y, icon: 'success', duration: 1000 })
  } catch (_) { uni.showToast({ title: '获取失败', icon: 'none' }) }
}
	const armedAct = ref(null)
	const armCapture = (act) => {
	  act._armed = !act._armed
	  armedAct.value = act._armed ? act : null
	  if (act._armed) uni.showToast({ title: '按 F8 采集坐标', icon: 'none', duration: 2000 })
	  else uni.showToast({ title: '已取消', icon: 'none', duration: 800 })
	}
	const armedRegion = ref(null) // { act, corner: 'tl'|'br' }
	const armCaptureRegion = (act, corner) => {
	  const key = corner === 'tl' ? '_armedTl' : '_armedBr'
	  const wasArmed = act[key]
	  if (armedRegion.value) { armedRegion.value.act._armedTl = false; armedRegion.value.act._armedBr = false }
	  if (armedAct.value) { armedAct.value._armed = false; armedAct.value = null }
	  act[key] = !wasArmed
	  armedRegion.value = act[key] ? { act, corner } : null
	  if (act[key]) {
	    const label = corner === 'tl' ? '左上角' : '右下角'
	    uni.showToast({ title: '按 F8 采集'+label, icon: 'none', duration: 2000 })
	  } else {
	    uni.showToast({ title: '已取消', icon: 'none', duration: 800 })
	  }
	}
	// 全局 F8 监听
	if (typeof window !== 'undefined') {
	  window.addEventListener('keydown', async (e) => {
	    if (e.key === 'F8') {
	      e.preventDefault()
	      try {
	        const r = await authFetch('/v1/api/listing-agent/mouse-position')
	        const p = await r.json()
	        if (armedRegion.value) {
	          const { act, corner } = armedRegion.value
	          if (corner === 'tl') { act.x1 = p.x; act.y1 = p.y; act._armedTl = false }
	          else { act.x2 = p.x; act.y2 = p.y; act._armedBr = false }
	          uni.showToast({ title: '已采集 '+corner.toUpperCase()+' X:'+p.x+' Y:'+p.y, icon: 'success', duration: 1500 })
	          armedRegion.value = null
	        } else if (armedAct.value) {
	          armedAct.value.x = p.x; armedAct.value.y = p.y
	          armedAct.value._armed = false
	          uni.showToast({ title: '已采集 X:'+p.x+' Y:'+p.y, icon: 'success', duration: 1500 })
	          armedAct.value = null
	        }
	      } catch (_) {}
	    }
	  })
	}
	const typeLabel = (k) => { const i = stepTypeKeys.indexOf(k); return i >= 0 ? stepTypes[i] : k }
const varLabel = (v) => v ? v.replace(/[{}\\ ]/g, '') : '-- 无 --'
const goBack = () => uni.navigateTo({ url: '/pages/listing/panel' })
const showAddModal = ref(false)
const newFlowName = ref('')
const showCalibModal = ref(false)
const calib = ref({ logX: 1440, logY: 960, phyX: 2158, phyY: 1438 })
const saveCalib = () => {
  uni.setStorageSync('screen_calib', JSON.stringify(calib.value))
  uni.showToast({ title: '校准已保存', icon: 'success' })
  showCalibModal.value = false
}
// 加载已保存的校准
try { const saved = uni.getStorageSync('screen_calib'); if (saved) calib.value = JSON.parse(saved) } catch (_) {}
const flows = ref([])

onMounted(async () => {
  try {
    const resp = await authFetch('/v1/api/listing-agent/configs')
    const data = await resp.json()
    if (Array.isArray(data) && data.length > 0) {
      for (const c of data) {
        try {
          const dr = await authFetch('/v1/api/listing-agent/configs/' + encodeURIComponent(c.name))
          const full = await dr.json()
          flows.value.push({ name: full.name || c.name, desc: full.desc || '', _open: false, steps: (full.steps || []).map(s => ({ ...s, _open: false })) })
        } catch (_) {
          flows.value.push({ name: c.name, desc: '', _open: false, steps: [] })
        }
      }
    }
  } catch (_) {}
  // 合并：内置流程始终保留，BE 已保存的覆盖同名内置
  const flowMap = {}
  BUILT_IN_FLOWS.forEach(f => {
    const ff = JSON.parse(JSON.stringify(f))
    ff._open = false
    ff.steps = ff.steps.map(s => { s._open = false; return s })
    flowMap[ff.name] = ff
  })
  flows.value.forEach(f => { flowMap[f.name] = f })
  flows.value = Object.values(flowMap)
})

const doAddFlow = () => {
  if (!newFlowName.value.trim()) return
  flows.value.push({ name: newFlowName.value.trim(), desc: '', _open: true, steps: [] })
  newFlowName.value = ''; showAddModal.value = false
}

const addStep = (flow) => {
  if (!flow.steps) flow.steps = []
  const t = 'click'
  flow.steps.push({ name: '', desc: '新步骤', _open: true, stepType: t, stepDuration: 0.5, stepVariable: '', actions: [{ name: '1', x: 0, y: 0 }] })
}
// 切换类型时清理无用字段
const onStepTypeChange = (step, typeKey) => {
  step.stepType = typeKey
  if (typeKey === 'compare') {
    step.compareVar = step.compareVar || ''
    step.compareRightVar = step.compareRightVar || ''
    step.compareOp = step.compareOp || '=='
    step.compareValue = step.compareValue || ''
    step.trueJump = step.trueJump || null
    step.falseJump = step.falseJump || null
    step.actions = []
  } else if (typeKey === 'jump') {
    step.jumpTo = step.jumpTo || null
    step.actions = []
  } else if (typeKey === 'setvar') {
    step.leftVar = step.leftVar || ''
    step.rightVar = step.rightVar || ''
    step.template = step.template || ''
    step.actions = []
  } else if (typeKey === 'ocr-find-row') {
    if (!step.actions || step.actions.length === 0) {
      step.actions = [{ name: 'OCR识别行号', x1: 0, y1: 0, x2: 0, y2: 0, ocrPrompt: '' }]
    }
  } else {
    if (!step.actions || step.actions.length === 0) {
      step.actions = [{ name: '1', x: 0, y: 0 }]
    }
  }
}

const addAction = (step) => {
  if (!step.actions) step.actions = []
  step.actions.push({ name: String(step.actions.length + 1), x: 0, y: 0 })
}

const moveStep = (flow, idx, dir) => { const ns = idx + dir; if (ns >= 0 && ns < flow.steps.length) { const t = flow.steps[idx]; flow.steps[idx] = flow.steps[ns]; flow.steps[ns] = t } }

const saveFlow = async (flow) => {
  try {
    await authFetch('/v1/api/listing-agent/configs/' + encodeURIComponent(flow.name), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: flow.name, desc: flow.desc, steps: flow.steps }) })
    uni.showToast({ title: '已保存', icon: 'success' })
  } catch (e) { uni.showToast({ title: '保存失败', icon: 'none' }) }
}
</script>

<style scoped>
.page-container { display:flex; flex-direction:column; height:100vh; background:#F5F5F7 }
.toolbar-panel { background:#FFF; padding:14px 16px 12px; flex-shrink:0; position:relative }
.toolbar { display:flex; justify-content:space-between; align-items:center; position:relative; height:36px }
.toolbar-left { display:flex; align-items:center; gap:10px; z-index:1 }
.toolbar-right { display:flex; align-items:center; gap:8px; z-index:1; margin-left:auto }
.tool-btn { width:32px; height:32px; border-radius:16px; background:#F0F0F0; display:flex; align-items:center; justify-content:center }
.calib-btn { width:auto; padding:0 10px; background:#FF0000; border-radius:12px }
.calib-text { font-size:11px; color:#FFF }
.icon-sm { width:18px; height:18px }
.tool-title { font-size:15px; font-weight:500; color:#1A1A1A; position:absolute; left:50%; transform:translateX(-50%); white-space:nowrap }
.main-scroll { flex:1; overflow-y:auto; padding-bottom:80px }
.flow-list { padding:12px 16px }
.flow-item { background:#FFF; border-radius:12px; margin-bottom:8px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,.04) }
.flow-head { display:flex; justify-content:space-between; align-items:center; padding:14px 16px; gap:8px }
.flow-name { font-size:15px; font-weight:500; color:#1A1A1A; display:block }
.flow-desc { font-size:11px; color:#999; display:block; margin-top:2px }
.flow-count { font-size:11px; color:#999 }
.flow-arrow { font-size:12px; color:#999 }
.flow-body { padding:0 16px 14px; border-top:1px solid #F5F5F7 }
.form-row { display:flex; align-items:center; gap:10px; margin-bottom:10px }
.form-label { font-size:12px; color:#666; width:40px }
.form-input { flex:1; height:36px; background:#F5F5F7; border:1px solid #E5E5EA; border-radius:6px; padding:0 10px; font-size:13px }
.step-list { margin:8px 0 }
.step-item { background:#F9F9FB; border-radius:8px; margin-bottom:6px; overflow:hidden }
.step-head { display:flex; align-items:center; gap:8px; padding:10px 12px }
.step-num { width:20px; height:20px; border-radius:10px; background:#FF0000; color:#FFF; font-size:11px; font-weight:600; display:flex; align-items:center; justify-content:center; flex-shrink:0 }
.step-desc { font-size:13px; color:#1A1A1A; flex:1 }
.step-type-tag { font-size:10px; color:#4A90D9; background:#F0F4FF; padding:1px 6px; border-radius:3px; flex-shrink:0 }
.step-btn-sm { width:22px; height:22px; border-radius:11px; background:#EEE; display:flex; align-items:center; justify-content:center; font-size:10px; color:#666 }
.step-btn-sm.del { color:#FF0000 }
.step-btn-sm.cap { font-size:9px; color:#999; padding:0 4px; width:auto } .step-btn-sm.cap.armed { color:#FFF; background:#34C759 }
.step-body { padding:8px 12px 10px; border-top:1px solid #EEE }
.form-row-sm { display:flex; align-items:center; gap:8px; margin-bottom:6px }
.fl { font-size:11px; color:#999; width:40px; text-align:right }
.form-input-sm { flex:1; height:32px; background:#FFF; border:1px solid #E5E5EA; border-radius:5px; padding:0 8px; font-size:12px }
.form-picker-sm { flex:1; height:32px; background:#FFF; border:1px solid #E5E5EA; border-radius:5px; padding:0 8px; font-size:12px; display:flex; align-items:center }
.actions-section { margin-top:6px; padding-top:6px; border-top:1px dashed #E5E5EA }
.actions-title { font-size:10px; color:#999; margin-bottom:4px; display:block }
.action-row { display:flex; align-items:center; gap:3px; margin:3px 0 }
.ocr-action-block { padding:2px 0; margin:4px 0 }
.ocr-row { display:flex; align-items:center; gap:6px; margin:5px 0 }
.ocr-label { font-size:11px; color:#999; width:32px; text-align:right; flex-shrink:0 }
.act-num { font-size:10px; color:#CCC; width:14px; text-align:center }
.act-xy { font-size:9px; color:#999; font-weight:500 }
.form-input-xs { width:48px; height:28px; background:#FFF; border:1px solid #E5E5EA; border-radius:4px; padding:0 4px; font-size:10px; text-align:center }
.step-add-act { padding:6px 0 0 8px; font-size:11px; color:#4A90D9 }
.step-add { padding:8px 0; text-align:center; font-size:13px; color:#4A90D9 }
.flow-actions { display:flex; gap:10px; margin-top:10px }
.btn-save { flex:1; height:40px; background:#FF0000; border-radius:20px; display:flex; align-items:center; justify-content:center }
.save-text { color:#FFF; font-size:14px; font-weight:500 }
.btn-del { flex:1; height:40px; background:#F0F0F0; border-radius:20px; display:flex; align-items:center; justify-content:center }
.del-text { color:#FF0000; font-size:14px }
.modal-mask { position:fixed; inset:0; z-index:500; background:rgba(0,0,0,.4); display:flex; align-items:center; justify-content:center; padding:20px }
.modal-box { width:100%; max-width:320px; background:#FFF; border-radius:16px; padding:20px }
.modal-title { font-size:16px; font-weight:600; text-align:center; display:block; margin-bottom:16px }
.modal-input { width:100%; height:42px; background:#F5F5F7; border:1px solid #E5E5EA; border-radius:8px; padding:0 12px; font-size:14px; margin-bottom:16px; box-sizing:border-box }
.modal-btns { display:flex; gap:10px }
.modal-btn { flex:1; height:40px; border-radius:20px; display:flex; align-items:center; justify-content:center; font-size:14px }
.modal-btn.cancel { background:#F0F0F0; color:#666 }
.modal-btn.ok { background:#FF0000; color:#FFF }
.modal-hint { font-size:11px; color:#999; text-align:center; display:block; margin-bottom:12px }
.calib-row { display:flex; align-items:center; gap:6px; margin:6px 0 }
.calib-label { font-size:11px; color:#666; width:70px; text-align:right }
.calib-info { font-size:12px; color:#4A90D9; text-align:center; display:block; margin-top:8px; font-weight:500 }
.setvar-row { gap:4px }
.setvar-arrow { font-size:16px; color:#FF0000; font-weight:700; margin:0 2px }
.setvar-hint { font-size:10px; color:#999; display:block; text-align:center; margin-top:2px }
</style>
