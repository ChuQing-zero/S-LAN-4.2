<template>
  <view class="page">
    <view class="topbar">
      <view class="topbar-left">
        <view class="tbtn" @tap="goBack"><image class="timg" src="/static/icons/ic_back.png" mode="aspectFit" /></view>
      </view>
      <text class="ttl">自动上架</text>
      <view class="topbar-right">
        <view class="tbtn calib-btn" @tap="goCoordPicker"><text class="calib-text">位置测试</text></view>
        <view class="tbtn" @tap="goFlowEditor"><text style="font-size:11px;color:#4A90D9">流程</text></view>
      </view>
    </view>

    <scroll-view class="body" scroll-y>
      <view v-if="running" class="running-bar">
        <text class="running-dot">●</text>
        <text class="running-text">流程执行中...</text>
        <text class="running-hint">按 F1 / Escape 终止</text>
      </view>

      <view class="card">
        <text class="ctitle">选择流程</text>
        <view class="row"><text class="lbl">流程</text>
          <picker :value="flowIdx" :range="flowNames" @change="onFlowChange">
            <view class="sel">{{ flowNames[flowIdx] }}</view>
          </picker>
        </view>
      </view>

      <view class="card">
        <text class="ctitle">上架参数</text>

        <view class="row"><text class="lbl">版本</text>
          <picker :value="verIdx" :range="verNames" @change="onVerChange">
            <view class="sel">{{ verNames[verIdx] }}</view>
          </picker>
        </view>

        <view class="row"><text class="lbl">编号</text><input class="inp" v-model="v['卡牌编号']" placeholder="QCAC-JP036" /></view>

        <view class="row2">
          <view class="h"><text class="lbl">罕贵度</text><picker :value="ri" :range="rareOpts" @change="onRare"><view class="sel">{{ v['罕贵度'] }}</view></picker></view>
          <view class="h"><text class="lbl">品相</text><picker :value="ci" :range="condOpts" @change="onCond"><view class="sel">{{ v['卡牌品相'] }}</view></picker></view>
        </view>

        <view class="row2">
          <view class="h"><text class="lbl">品相备注</text><input class="inp" v-model="v['品相备注']" placeholder="9" @input="autoDetect" /></view>
          <view class="h"><text class="lbl">异画</text><input class="inp" v-model="v['异画']" placeholder="0=无" @input="autoDetect" /></view>
        </view>

        <view class="row2">
          <view class="h"><text class="lbl">价格</text><input class="inp" type="number" v-model="v['价格']" placeholder="99" /></view>
          <view class="h"><text class="lbl">数量</text><input class="inp" type="number" v-model="v['数量']" placeholder="99" /></view>
        </view>

        <view class="row2">
          <view class="h"><text class="lbl">集换价</text><picker :value="ji" :range="['否','是']" @change="onJ"><view class="sel">{{ v['集换价']==='true'?'是':'否' }}</view></picker></view>
          <view class="h"><text class="lbl">旧罕贵度</text><picker :value="mi" :range="rareOpts" @change="onM"><view class="sel">{{ v['旧罕贵度'] || rareOpts[0] }}</view></picker></view>
        </view>

        <view class="btn" :class="{running:running}" @tap="doExecute">
          <text class="bt">{{ running ? '⏸ 执行中... 再次点击暂停' : '▶ 启动' }}</text>
        </view>
      </view>

      <view class="card">
        <view class="lhead" @tap="logOpen=!logOpen"><text>执行日志 {{ logOpen?'▾':'▸' }}</text></view>
        <view v-if="logOpen" class="lbody">
          <text class="ll" :class="l.cls" v-for="(l,i) in logs" :key="i">{{ l.time }} {{ l.msg }}</text>
          <text v-if="logs.length===0" class="lempty">暂无日志</text>
        </view>
      </view>
      <view style="height:60px"></view>
    </scroll-view>
  </view>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { authFetch } from '@/utils/authFetch.js'
const API = '/v1/api/listing-agent'
const flowNames=ref(['-- 手动选择 --'])
const verNames=['游戏王日文','游戏王英文','游戏王简中','宝可梦简中','宝可梦日文','宝可梦繁中']
const v = reactive({'卡牌编号':'','罕贵度':'SER','卡牌品相':'流通品相','品相备注':'','异画':'','价格':'99','数量':'99','集换价':'false','旧罕贵度':''})
const ri=ref(0),ci=ref(0),ji=ref(0),mi=ref(0),flowIdx=ref(0),verIdx=ref(0),engineOk=ref(false),logOpen=ref(false),logs=ref([]),running=ref(false)
const rareOpts=['SER','UR','SR','QCSER','PSER','20SER','HR','UTR','CR','PR','N','NR']
const condOpts=['流通品相','有瑕疵','有损伤']
const onRare=e=>{ri.value=e.detail.value;v['罕贵度']=rareOpts[e.detail.value]}
const onCond=e=>{ci.value=e.detail.value;v['卡牌品相']=condOpts[e.detail.value]}
const onJ=e=>{ji.value=e.detail.value;v['集换价']=e.detail.value?'true':'false'}
const onM=e=>{mi.value=e.detail.value;v['旧罕贵度']=rareOpts[e.detail.value]}
const onFlowChange=e=>{flowIdx.value=e.detail.value}
const onVerChange=e=>{verIdx.value=e.detail.value}
const goBack=()=>uni.navigateTo({url:'/pages/auto-listing/auto-listing'})
const goFlowEditor=()=>uni.navigateTo({url:'/pages/listing/flow-editor'})
const goCoordPicker=()=>uni.navigateTo({url:'/pages/listing/coord-picker'})
const L=(m,c='log-info')=>{const t=new Date().toLocaleTimeString('zh-CN',{hour12:false});logs.value.push({time:t,msg:m,cls:c})}
const RARITY_XY={SER:[1262,289],UR:[884,357],SR:[1353,355],QCSER:[656,287],PSER:[765,287],'20SER':[523,287],HR:[866,287],CR:[796,352],UTR:[700,355],NPR:[1544,356],N:[497,422],NR:[574,421]}
const CM={'流通品相':[196,259],'有瑕疵':[313,253],'有损伤':[433,253]}
const JA=[366,536],JB=[366,831],LY=[508,600,689,780,870,960,1050,1140,1230,1323]
let localDB={}
const load=()=>{try{localDB=JSON.parse(uni.getStorageSync('card_listing_db')||'{}')}catch(_){localDB={}}}
const save=()=>uni.setStorageSync('card_listing_db',JSON.stringify(localDB))
const apiPost=async(p,b)=>{const r=await authFetch(API+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})});return r.json()}
const flowConfigs = ref({})
const loadFlowConfigs = async () => {
  try {
    const resp = await authFetch('/v1/api/listing-agent/configs')
    const list = await resp.json()
    if (Array.isArray(list)) {
      for (const item of list) {
        try {
          const dr = await authFetch('/v1/api/listing-agent/configs/' + encodeURIComponent(item.name))
          flowConfigs.value[item.name] = await dr.json()
        } catch (_) {}
      }
    }
  } catch (_) {}
}

const doExecute = async () => {
  if (running.value) { stopFlow(); return }
  const code = (v['卡牌编号'] || '').toUpperCase()
  if (!code) { uni.showToast({ title: '请输入卡牌编号', icon: 'none' }); return }
  if (flowIdx.value === 0) { uni.showToast({ title: '请选择流程', icon: 'none' }); return }

  running.value = true

  const selFlow = flowNames.value[flowIdx.value]
  let cfg = flowConfigs.value[selFlow]
  if (!cfg || !cfg.steps) { await loadFlowConfigs(); cfg = flowConfigs.value[selFlow]; if (!cfg || !cfg.steps) { uni.showToast({ title: '加载失败', icon: 'none' }); return } }

  const vars = {
    '卡牌编号': code,
    '罕贵度': v['罕贵度'] || 'N',
    '卡牌品相': v['卡牌品相'] || '流通品相',
    '品相备注': v['品相备注'] || '',
    '异画': v['异画'] || '',
    '价格': v['价格'] || '99',
    '数量': v['数量'] || '99',
    '集换价': v['集换价'] || '',
    '旧罕贵度': v['旧罕贵度'] || '',
    '对应行数': '1'
  }

  L('=== ' + selFlow + ': ' + code + ' ' + vars['价格'] + 'x' + vars['数量'] + ' ' + vars['罕贵度'] + ' ===')

  const rv = (t) => {
    if (!t) return t
    let r = t
    for (const [k, val] of Object.entries(vars)) {
      r = r.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), val || '')
    }
    return r
  }

  const steps = []
  const stepMap = {} // 配置步骤编号(1-based) → 扁平数组索引(1-based)
  let stepNum = 0
  for (const s of cfg.steps) {
    stepNum++
    stepMap[stepNum] = steps.length + 1  // 记录此配置步骤在扁平数组中的起始位置
    const t = s.stepType, d = s.stepDuration || 0.5
    if (s.stepVariable) {
      const vv = vars[s.stepVariable.replace(/[{}]/g, '')]
      if (['click', 'dblclick', 'tplclick'].includes(t)) {
        if (vv) {
          const m = s.actions.find(a => a.name === vv)
          if (m) { steps.push({ type: t, x: m.x, y: m.y, duration: d, _desc: s.desc }); L(stepNum + '. ' + s.desc + ' (' + m.x + ',' + m.y + ')') }
        }
      } else if (t === 'input') {
        for (const a of s.actions) {
          steps.push({ type: 'input', text: a.text || '', x: a.x || 0, y: a.y || 0, duration: d, _desc: s.desc }); L(stepNum + '. ' + s.desc + ': ' + rv(a.text || ''))
        }
      } else if (t === 'ocr-find-row') {
        const act = s.actions[0]
        steps.push({
          type: 'ocr-find-row',
          x1: act.x1, y1: act.y1, x2: act.x2, y2: act.y2,
          ocrPrompt: rv(act.ocrPrompt || ''),
          variable: '对应行数',
          duration: d,
          _desc: s.desc
        });
        L(stepNum + '. OCR识别中... (区域:' + act.x1 + ',' + act.y1 + '→' + act.x2 + ',' + act.y2 + ')')
        const rowStep = cfg.steps.find(s2 => s2.desc === '点对应行')
        steps.push({
          type: '_dynamic_click',
          _actions: rowStep ? rowStep.actions : [],
          _varName: '对应行数',
          duration: d
        })
      }
    } else if (t === 'compare') {
      steps.push({ type: 'compare', compareVar: s.compareVar, compareRightVar: s.compareRightVar || '', compareOp: s.compareOp, compareValue: s.compareValue, trueJump: s.trueJump, falseJump: s.falseJump, duration: d, _desc: s.desc })
      L(stepNum + '. 比较: ' + (s.compareVar||'?') + ' ' + (s.compareOp||'==') + ' ' + (s.compareRightVar ? s.compareRightVar.replace(/[{}]/g, '') : (s.compareValue||'')) + ' ? →' + (s.trueJump||'next') + ' : →' + (s.falseJump||'next'))
    } else if (t === 'jump') {
      steps.push({ type: 'jump', jumpTo: s.jumpTo, duration: d, _desc: s.desc })
      L(stepNum + '. 跳转到步骤 ' + (s.jumpTo||'?'))
    } else if (t === 'setvar') {
      const lv = (s.leftVar || '').replace(/[{}]/g, '')
      const rv_ = (s.rightVar || '').replace(/[{}]/g, '')
      steps.push({ type: 'setvar', leftVar: lv, rightVar: rv_, template: s.template || '', duration: d, _desc: s.desc })
      L(stepNum + '. 设置变量: ' + lv + ' = ' + (s.template || rv_))
    } else {
      for (const a of s.actions) {
        const ss = { duration: d }
        if (t === 'tplclick') { ss.type = 'tplclick'; ss.x = a.x; ss.y = a.y }
        else if (t === 'click') { ss.type = 'click'; ss.x = a.x; ss.y = a.y }
        else if (t === 'press') { ss.type = 'press'; ss.text = a.text || a.key || ''; L(stepNum + '. ' + s.desc) }
        else if (t === 'input') { ss.type = 'input'; ss.text = a.text || ''; ss.x = a.x || 0; ss.y = a.y || 0 }
        else if (t === 'wait') { ss.type = 'wait'; L(stepNum + '. 等待 ' + d + 's') }
        else if (t === 'scroll') { ss.type = 'scroll'; ss.scroll_clicks = a.scroll_clicks || -500; if(a.x1!=null){ss.x1=a.x1;ss.y1=a.y1;ss.x2=a.x2;ss.y2=a.y2;ss.ms=a.ms} L(stepNum + '. ' + s.desc) }
        else continue
        steps.push(ss)
      }
    }
  }

  // 修正跳转目标：将配置步骤编号映射为扁平数组索引
  for (const step of steps) {
    if (step.type === 'compare') {
      if (step.trueJump && stepMap[step.trueJump]) step.trueJump = stepMap[step.trueJump]
      if (step.falseJump && stepMap[step.falseJump]) step.falseJump = stepMap[step.falseJump]
    } else if (step.type === 'jump') {
      if (step.jumpTo && stepMap[step.jumpTo]) step.jumpTo = stepMap[step.jumpTo]
    }
  }

  L('共 ' + steps.length + ' 步')
  try {
    const result = await apiPost('/execute', { name: selFlow, steps, variables: vars })
    if (result.logs && result.logs.length > 0) {
      result.logs.forEach(l => L('  ' + l, 'log-info'))
    }
    if (result.variables && result.variables['对应行数']) {
      L('>>> OCR识别结果: 第' + result.variables['对应行数'] + '行', 'log-ok')
    }
    if (result.success) {
      // 回写流程中变化的变量到前端UI
      if (result.variables) {
        const rv_ = result.variables
        if (rv_['卡牌编号']) v['卡牌编号'] = rv_['卡牌编号']
        if (rv_['罕贵度']) { v['罕贵度'] = rv_['罕贵度']; const ri2 = rareOpts.indexOf(rv_['罕贵度']); if (ri2 >= 0) ri.value = ri2 }
        if (rv_['卡牌品相']) { v['卡牌品相'] = rv_['卡牌品相']; const ci2 = condOpts.indexOf(rv_['卡牌品相']); if (ci2 >= 0) ci.value = ci2 }
        if (rv_['品相备注']) v['品相备注'] = rv_['品相备注']
        if (rv_['异画']) v['异画'] = rv_['异画']
        if (rv_['价格']) v['价格'] = rv_['价格']
        if (rv_['数量']) v['数量'] = rv_['数量']
        if (rv_['集换价']) { v['集换价'] = rv_['集换价']; ji.value = rv_['集换价'] === 'true' ? 1 : 0 }
        if (rv_['旧罕贵度']) { v['旧罕贵度'] = rv_['旧罕贵度']; const mi2 = rareOpts.indexOf(rv_['旧罕贵度']); if (mi2 >= 0) mi.value = mi2 }
        L('变量已同步回前端', 'log-ok')
      }
      L('OK ' + selFlow + ' 完成', 'log-ok')
      // 同步到后端已上架库
      try {
        await authFetch('/v1/api/listed-cards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: v['卡牌编号'] || code,
            rarity: v['罕贵度'] || '',
            condition: v['卡牌品相'] || '',
            note: v['品相备注'] || '',
            altArt: v['异画'] || '',
            price: Number(v['价格']) || 0,
            quantity: Number(v['数量']) || 1,
            isJiHuan: v['集换价'] === 'true',
            versionName: verNames[verIdx.value] || ''
          })
        })
        L('已同步到已上架库', 'log-ok')
      } catch (_) { L('同步已上架库失败', 'log-err') }
      // 保留本地备份
      load()
      const card = localDB[code] || { listings: [] }
      card.listings.push({ condition: v['卡牌品相'], rarity: v['罕贵度'], note: v['品相备注'], price: +v['价格'], qty: +v['数量'], altArt: v['异画'] })
      localDB[code] = card
      save()
    } else {
      L('FAIL: ' + (result.message || 'error'), 'log-err')
    }
  } catch (e) {
    L('ERR ' + e.message, 'log-err')
  }
  running.value = false
}
const stopFlow = async () => {
  if (!running.value) return
  try {
    await authFetch(API + '/execute/stop', { method: 'POST' })
    running.value = false
    L('⏹ 已发送终止信号...', 'log-err')
    uni.showToast({ title: '已终止流程 (F1)', icon: 'none' })
  } catch (_) {}
}

const onKeyDown = (e) => {
  if (e.key === 'F1' || e.keyCode === 112) {
    e.preventDefault()
    stopFlow()
  }
  // 也支持 Escape / F12
  if (e.key === 'F12' || e.keyCode === 123) {
    e.preventDefault()
    stopFlow()
  }
  if (e.key === 'Escape' || e.keyCode === 27) {
    if (running.value) {
      e.preventDefault()
      stopFlow()
    }
  }
}

const refreshFlowList = async () => {
  try {
    const resp = await authFetch('/v1/api/listing-agent/configs')
    const list = await resp.json()
    if (Array.isArray(list)) {
      flowNames.value = ['-- 手动选择 --', ...list.map(c => c.name)]
    }
  } catch (_) {}
}

onMounted(async()=>{
  try{engineOk.value=(await(await authFetch(API+'/status')).json()).ok}catch(_){}
  await refreshFlowList()
  loadFlowConfigs()
  document.addEventListener('keydown', onKeyDown)
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<style scoped>
*{box-sizing:border-box}
.page{width:100%;max-width:100vw;display:flex;flex-direction:column;height:100vh;background:#F5F5F7;overflow:hidden}
.topbar{width:100%;background:#FFF;padding:14px 16px 12px;display:flex;align-items:center;position:relative;flex-shrink:0}
.topbar-left{display:flex;align-items:center;gap:10px;z-index:1}
.topbar-right{display:flex;align-items:center;gap:8px;z-index:1;margin-left:auto}
.tbtn{width:32px;height:32px;border-radius:16px;background:#F0F0F0;display:flex;align-items:center;justify-content:center}
.timg{width:18px;height:18px}
.ttl{font-size:15px;font-weight:500;color:#1A1A1A;position:absolute;left:50%;transform:translateX(-50%);white-space:nowrap}
.calib-btn{width:auto;padding:0 10px;background:#FF0000;border-radius:12px}
.calib-text{font-size:11px;color:#FFF}
.body{flex:1;overflow-y:auto;padding:12px 16px}

.running-bar{display:flex;align-items:center;gap:8px;background:#FFF3F0;border:1px solid rgba(255,0,0,.15);border-radius:10px;padding:10px 14px;margin-bottom:10px;animation:pulse 1.5s ease-in-out infinite}
.running-dot{color:#FF0000;font-size:12px;animation:blink 0.8s ease-in-out infinite}
.running-text{font-size:13px;color:#FF0000;font-weight:500;flex:1}
.running-hint{font-size:11px;color:#999;background:#F5F5F7;padding:4px 10px;border-radius:6px}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
@keyframes pulse{0%,100%{border-color:rgba(255,0,0,.15)}50%{border-color:rgba(255,0,0,.35)}}

.status{padding:10px 14px;border-radius:10px;font-size:12px;text-align:center;margin-bottom:10px}
.status.ready{background:#FFF;color:#34C759}
.status.running{background:#FFF8F0;color:#F60}

.fi{display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:10px;font-size:13px;font-weight:500;margin-bottom:10px;justify-content:center}
.fi.flow-none{background:#FFF;color:#999;border:1px solid #EEE}
.fi.flow-a{background:rgba(255,0,0,.06);color:#FF0000;border:1px solid rgba(255,0,0,.15)}
.fi.flow-b{background:rgba(74,144,217,.06);color:#4A90D9;border:1px solid rgba(74,144,217,.15)}
.fitag{font-size:12px;font-weight:700;padding:3px 10px;border-radius:8px}
.flow-a .fitag{background:rgba(255,0,0,.12);color:#FF0000}
.flow-b .fitag{background:rgba(74,144,217,.12);color:#4A90D9}
.fitxt{font-size:12px}

.card{background:#FFF;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 2px 12px rgba(0,0,0,.04)}
.ctitle{font-size:15px;font-weight:500;color:#1A1A1A;display:block;margin-bottom:12px}
.row{margin-bottom:10px}
.row2{display:flex;gap:10px;margin-bottom:10px}
.h{flex:1;min-width:0}
.lbl{font-size:11px;color:#999;display:block;margin-bottom:3px}
.inp{display:block;width:100%;height:38px;background:#F5F5F7;border:1px solid #E5E5EA;border-radius:8px;padding:0 10px;font-size:14px;box-sizing:border-box}
.sel{display:block;width:100%;height:38px;background:#F5F5F7;border:1px solid #E5E5EA;border-radius:8px;padding:0 10px;font-size:14px;box-sizing:border-box;line-height:38px;color:#1A1A1A}
.btn{width:100%;height:48px;background:#FF0000;border-radius:24px;display:flex;align-items:center;justify-content:center;margin-top:4px;box-shadow:0 4px 12px rgba(255,0,0,.25);transition:background .3s}
.btn.running{background:#FF6600;animation:pulse-btn 1.5s ease-in-out infinite}
@keyframes pulse-btn{0%,100%{opacity:1}50%{opacity:.7}}
.bt{color:#FFF;font-size:15px;font-weight:500}
.lhead{padding:12px 16px;font-size:13px;color:#999}
.lbody{padding:0 16px 12px;max-height:180px;overflow-y:auto}
.ll{font-size:11px;line-height:1.6;display:block}
.log-ok{color:#34C759}.log-err{color:#FF0000}.log-info{color:#4A90D9}
.lempty{color:#CCC;font-size:11px}
</style>
