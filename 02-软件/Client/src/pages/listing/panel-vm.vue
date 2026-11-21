<template>
  <view class="page">
    <view class="topbar">
      <view class="topbar-left">
        <view class="tbtn" @tap="goBack"><image class="timg" src="/static/icons/ic_back.png" mode="aspectFit" /></view>
      </view>
      <text class="ttl">自动上架 - 虚拟机AI</text>
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

      <!-- VM专属: 启动控制 -->
      <view class="card">
        <text class="ctitle">启动控制</text>
        <view class="row" style="align-items:center;gap:12px">
          <view class="btn primary" @tap="launchVM" style="padding:8px 16px;border-radius:4px;font-weight:600;font-size:13px;cursor:pointer">启动系统</view>
          <text id="_tcg_vm_status" style="font-size:12px;color:#888">未启动</text>
        </view>
        <view id="_tcg_vm_log" style="margin-top:8px;font-size:10px;color:#666;line-height:1.6"></view>
      </view>

      <view class="card">
        <text class="ctitle">组件状态</text>
        <view style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <view :style="{width:'8px',height:'8px',borderRadius:'50%',background:compStatus.adbKeyboard?'#27ae60':'#e74c3c'}"></view>
          <text style="font-size:13px;flex:1">ADB键盘</text>
          <text style="font-size:11px;color:#999">{{ compStatus.adbKeyboard ? '在线' : '离线' }}</text>
        </view>
        <view style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <view :style="{width:'8px',height:'8px',borderRadius:'50%',background:compStatus.clipper?'#27ae60':'#e74c3c'}"></view>
          <text style="font-size:13px;flex:1">Clipper</text>
          <text style="font-size:11px;color:#999">{{ compStatus.clipper ? '在线' : '离线' }}</text>
        </view>
        <view class="btn" @tap="checkCompStatus" style="height:32px;width:auto;padding:0 12px;border-radius:4px;background:#4A90D9;box-shadow:none">
          <text style="color:#FFF;font-size:12px">{{ compStatus.loading ? '检测中...' : '检测' }}</text>
        </view>
      </view>

      <view class="card">
        <text class="ctitle">选择流程</text>
        <view class="row"><text class="lbl">流程</text>
          <picker :value="flowIdx" :range="flowNames" @change="onFlowChange">
            <view class="sel">{{ flowNames[flowIdx] }}</view>
          </picker>
        </view>
      </view>

      <!-- 「一键上架」的执行设置：连续失败熔断（V1.2.106）+ 每卡最多尝试遍数（V1.2.108）。
           两条都存在**服务器**上（不是本机），因为判它们的是服务端：
           整批是"一个包发一次请求"，计数得跨请求活着才数得准。 -->
      <view class="card">
        <text class="ctitle">自动上架设置</text>
        <!-- 用 .row2 / .h / .inp 这套老样式，别另写一套 —— 这里 `.row` 只是 margin，
             不是 flex，塞个 inline 的 flex:1 进去是不生效的，输入框会独占整行把按钮挤到下一行 -->
        <!-- ⚠️ 两格并排之后，**标签必须短到一个行放得下**（窄屏 375px 时每格只有 ~120px，
             11px 的汉字一行最多 10 个）。有一格折成两行的话，`align-items:flex-end` 会把
             两个输入框顶到不一样高，看着像画歪了。原来就一格，写多长都无所谓，现在不行了。 -->
        <view class="row2" style="align-items:flex-end">
          <view class="h">
            <text class="lbl">连着几张就停</text>
            <input class="inp" type="number" v-model="熔断阈值" placeholder="5" />
          </view>
          <view class="h">
            <text class="lbl">每卡最多试几遍</text>
            <input class="inp" type="number" v-model="每卡遍数" placeholder="2" />
          </view>
          <view style="width:84px">
            <text class="lbl">　</text>
            <view class="btn" @tap="saveSettings"
                  style="height:38px;margin-top:0;border-radius:8px;background:#4A90D9;box-shadow:none">
              <text style="color:#FFF;font-size:13px">{{ settingsSaving ? '保存中…' : '保存' }}</text>
            </view>
          </view>
        </view>
        <text style="display:block;font-size:11px;color:#888;line-height:1.7">
          <text style="color:#666">连着几张就停</text>：一键上架时，连着这么多张都没跑成就自动停下并弹窗提醒，交人工复核。
          换个包不清零，任意一张跑成即归零。0 = 关掉。
        </text>
        <text style="display:block;font-size:11px;color:#888;line-height:1.7">
          <text style="color:#666">每卡最多试几遍</text>：一张卡没跑成会立刻再整条跑一遍，第二遍还挂才标红并跳过。
          1 = 不重试（跑一遍算数）。急停是人叫停的，不重试。只在虚拟机 AI 这条链上生效。
        </text>
      </view>

      <view class="card">
        <text class="ctitle">上架参数</text>

        <view class="row2">
          <view class="h"><text class="lbl">版本</text>
            <picker :value="gameIdx" :range="gameNames" @change="onGameChange">
              <view class="sel">{{ gameNames[gameIdx] }}</view>
            </picker>
          </view>
          <view class="h"><text class="lbl">语种</text>
            <picker :value="langIdx" :range="langNames" @change="onLangChange">
              <view class="sel">{{ langNames[langIdx] }}</view>
            </picker>
          </view>
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
        <text class="ctitle">输出参数</text>
        <view class="row2">
          <view class="h"><text class="lbl">集换价</text><input class="inp" v-model="outJhj" placeholder="—" /></view>
          <view class="h"><text class="lbl">最低价</text><input class="inp" v-model="outDj" placeholder="—" /></view>
        </view>
        <view class="row2">
          <view class="h"><text class="lbl">编号</text><input class="inp" v-model="outBh" placeholder="—" /></view>
          <view class="h"><text class="lbl">罕贵度</text><input class="inp" v-model="outHgd" placeholder="—" /></view>
        </view>
        <view class="row2">
          <view class="h"><text class="lbl">中文卡名</text><input class="inp" v-model="outZwdm" placeholder="—" /></view>
          <view class="h"><text class="lbl">中文别名</text><input class="inp" v-model="outZwbm" placeholder="—" /></view>
        </view>
        <view class="row2">
          <view class="h"><text class="lbl">语种</text><input class="inp" v-model="outYz" placeholder="—" /></view>
          <view class="h"><text class="lbl">游戏版本</text><input class="inp" v-model="outYxbb" placeholder="—" /></view>
        </view>
        <view class="row2">
          <view class="h"><text class="lbl">行数</text><input class="inp" v-model="outHangshu" placeholder="—" /></view>
          <view class="h"><text class="lbl">运行状态</text><input class="inp" v-model="outYxzt" placeholder="—" /></view>
        </view>
        <view class="row2">
          <view class="h"><text class="lbl">数量</text><input class="inp" v-model="outSl" placeholder="—" /></view>
          <view class="h"><text class="lbl">价格</text><input class="inp" v-model="outJg" placeholder="—" /></view>
        </view>
        <view class="row2">
          <view class="h"><text class="lbl">备注</text><input class="inp" v-model="outBz" placeholder="—" /></view>
          <view class="h"><text class="lbl">输入框编号</text><input class="inp" v-model="outSrkbh" placeholder="—" /></view>
        </view>
      </view>

      <view class="card">
        <view class="lhead" @tap="logOpen=!logOpen"><text>执行日志 {{ logOpen?'▾':'▸' }}</text></view>
        <view v-if="logOpen" class="lbody">
          <text class="ll" :class="l.cls" v-for="(l,i) in logs" :key="i">{{ l.time }} {{ l.msg }}</text>
          <text v-if="logs.length===0" class="lempty">暂无日志</text>
        </view>
      </view>
      <!-- 页面扫描器 -->
      <view class="card">
        <view class="lhead" @tap="dumpOpen=!dumpOpen"><text>页面扫描 {{ dumpOpen ? '▾' : '▸' }}</text></view>
        <view v-if="dumpOpen" class="lbody">
          <view class="row" style="gap:6px;margin-bottom:8px">
            <view class="btn primary" @tap="doDump" style="padding:6px 12px;font-size:12px">扫描当前页面</view>
            <text style="font-size:11px;color:#888">{{ dumpCount }} 个元素</text>
          </view>
          <view v-if="dumpList.length>0" style="max-height:300px;overflow:auto;font-size:10px;line-height:1.4">
            <view v-for="(e,i) in dumpList" :key="i" style="padding:2px 4px;border-bottom:1px solid #222;display:flex;gap:8px">
              <text style="color:#888;width:24px">{{ i+1 }}</text>
              <text style="color:#e74c3c;width:28px">{{ e.clickable ? '可点' : '文字' }}</text>
              <text style="color:#aaa;width:64px">({{ e.x }},{{ e.y }})</text>
              <text style="color:#ddd;flex:1">{{ e.text }}</text>
            </view>
          </view>
        </view>
      </view>
      <view style="height:60px"></view>
    </scroll-view>
  </view>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { authFetch } from '@/utils/authFetch.js'
const API = '/v1/api/listing-agent-vm'
const flowNames=ref(['-- 手动选择 --'])
const gameNames=['游戏王','宝可梦']
const langNames=['日','简','英']
const v = reactive({'卡牌编号':'','罕贵度':'SER','卡牌品相':'流通品相','品相备注':'','异画':'','价格':'99','数量':'99','集换价':'false','旧罕贵度':''})
const ri=ref(0),ci=ref(0),ji=ref(0),mi=ref(0),flowIdx=ref(0),gameIdx=ref(0),langIdx=ref(0),engineOk=ref(false),logOpen=ref(false),logs=ref([]),running=ref(false)
const outJhj=ref(''),outDj=ref(''),outBh=ref(''),outHgd=ref(''),outZwdm=ref(''),outZwbm=ref(''),outYz=ref(''),outYxbb=ref(''),outHangshu=ref(''),outYxzt=ref(''),outSl=ref(''),outJg=ref(''),outBz=ref(''),outSrkbh=ref('')
const compStatus=reactive({ adbKeyboard: false, clipper: false, loading: false })
const checkCompStatus = async () => {
  compStatus.loading = true
  try {
    const r = await authFetch(API+'/status/detail')
    const d = await r.json()
    compStatus.adbKeyboard = d.adbKeyboard
    compStatus.clipper = d.clipper
  } catch (_) {
    compStatus.adbKeyboard = false
    compStatus.clipper = false
  }
  compStatus.loading = false
}
const dumpOpen=ref(false),dumpList=ref([]),dumpCount=ref(0)
const doDump=async()=>{
  try{const r=await authFetch(API+'/dump');const d=await r.json()
  dumpList.value=(d.elements||[]).map(e=>({text:e.text,x:e.center.x,y:e.center.y,clickable:e.clickable}))
  dumpCount.value=dumpList.value.length}catch(e){}
}
const rareOpts=['SER','UR','SR','QCSER','PSER','20SER','HR','UTR','CR','PR','N','NR']
const condOpts=['流通品相','有瑕疵','有损伤']
const onRare=e=>{ri.value=e.detail.value;v['罕贵度']=rareOpts[e.detail.value]}
const onCond=e=>{ci.value=e.detail.value;v['卡牌品相']=condOpts[e.detail.value]}
const onJ=e=>{ji.value=e.detail.value;v['集换价']=e.detail.value?'true':'false'}
const onM=e=>{mi.value=e.detail.value;v['旧罕贵度']=rareOpts[e.detail.value]}
const onFlowChange=e=>{flowIdx.value=e.detail.value}
const onGameChange=e=>{gameIdx.value=e.detail.value}
const onLangChange=e=>{langIdx.value=e.detail.value}
const goBack=()=>uni.navigateTo({url:'/pages/auto-listing/auto-listing'})
const launchVM=async()=>{
  const st=document.getElementById('_tcg_vm_status'),log=document.getElementById('_tcg_vm_log')
  if(st)st.textContent='启动中...';if(st)st.style.color='#f39c12'
  if(log)log.innerHTML=''
  const addLog=(msg,c)=>{if(log)log.innerHTML+='<div style=\"color:'+(c||'#666')+'\">'+msg+'</div>'}

  // [1/4] 启动模拟器
  addLog('[1/4] 启动模拟器...')
  try {
    const r=await authFetch('/v1/api/launch-vm/start',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+uni.getStorageSync('token')}})
    const d=await r.json()
    if(d.ok){addLog('[OK] '+d.detail,'#27ae60')}
    else{addLog('[ERR] '+d.error,'#e74c3c')}
  } catch(e) {addLog('[ERR] '+e.message,'#e74c3c')}

  // [2/4] 连接ADB
  addLog('[2/4] 连接ADB...')
  try {
    const r2=await authFetch('/v1/api/launch-vm/adb-connect',{method:'POST',headers:{'Content-Type':'application/json'}})
    const d2=await r2.json()
    if(d2.ok){addLog('[OK] ADB已连接','#27ae60')}
    else{addLog('[WARN] '+d2.error,'#f39c12')}
  } catch(e) {addLog('[WARN] '+e.message,'#f39c12')}

  // [3/4] 激活组件
  addLog('[3/4] 激活组件...')
  try {
    const r3=await authFetch('/v1/api/launch-vm/init-components',{method:'POST',headers:{'Content-Type':'application/json'}})
    const d3=await r3.json()
    if(d3.adbKeyboard) addLog('[OK] ADB键盘已激活','#27ae60')
    else addLog('[WARN] ADB键盘未激活','#f39c12')
    if(d3.clipper) addLog('[OK] Clipper已启动','#27ae60')
    else addLog('[WARN] Clipper启动失败','#f39c12')
  } catch(e) {addLog('[WARN] '+e.message,'#f39c12')}

  // [4/4] 检测状态
  addLog('[4/4] 检测状态...')
  try {
    const r4=await authFetch(API+'/status/detail')
    const d4=await r4.json()
    compStatus.adbKeyboard=d4.adbKeyboard
    compStatus.clipper=d4.clipper
    if(d4.adbKeyboard&&d4.clipper){if(st)st.textContent='运行中';if(st)st.style.color='#27ae60';addLog('[OK] 全部就绪','#27ae60')}
    else{if(st)st.textContent='部分离线';if(st)st.style.color='#f39c12';addLog('[WARN] 部分组件离线, 请检查','#f39c12')}
  } catch(e) {if(st)st.textContent='运行中';if(st)st.style.color='#27ae60'}
}
const goFlowEditor=()=>uni.navigateTo({url:'/pages/listing/flow-editor-vm'})
const goCoordPicker=()=>uni.navigateTo({url:'/pages/listing/coord-picker'})
const L=(m,c='log-info')=>{const t=new Date().toLocaleTimeString('zh-CN',{hour12:false});logs.value.push({time:t,msg:m,cls:c})}
const RARITY_XY={SER:[1262,289],UR:[884,357],SR:[1353,355],QCSER:[656,287],PSER:[765,287],'20SER':[523,287],HR:[866,287],CR:[796,352],UTR:[700,355],NPR:[1544,356],N:[497,422],NR:[574,421]}
const CM={'流通品相':[196,259],'有瑕疵':[313,253],'有损伤':[433,253]}
const JA=[366,536],JB=[366,831],LY=[508,600,689,780,870,960,1050,1140,1230,1323]
let localDB={}
const load=()=>{try{localDB=JSON.parse(uni.getStorageSync('card_listing_db')||'{}')}catch(_){localDB={}}}
const save=()=>uni.setStorageSync('card_listing_db',JSON.stringify(localDB))
const apiPost=async(p,b)=>{const r=await authFetch(API+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})});return r.json()}

// ===== 服务器设置（V1.2.106 熔断 / V1.2.108 重试）=====
// 两条都存在**服务器**上（不是 uni.getStorageSync），因为判它们的是后端：
// 整批是"一个包发一次请求"，计数要跨请求活着才数得准。
// 默认值与取值范围只有一处：Server/src/services/appSettings.js，这儿不写第二份。
const 熔断阈值 = ref('')
const 每卡遍数 = ref('')
const settingsSaving = ref(false)
const 载入设置 = async () => {
  try {
    const r = await authFetch(API + '/settings')
    const d = await r.json()
    if (d && d.连续失败熔断 !== undefined) 熔断阈值.value = String(d.连续失败熔断)
    if (d && d.每卡最多尝试遍数 !== undefined) 每卡遍数.value = String(d.每卡最多尝试遍数)
  } catch (_) { /* 读不到就留空，输入框的 placeholder 会显示 5 / 2 */ }
}
const saveSettings = async () => {
  if (settingsSaving.value) return
  settingsSaving.value = true
  try {
    const r = await authFetch(API + '/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      // 两条一起发：同一个「保存」按钮管这一张卡片 —— 分两次发的话，人改了一格、按一次保存，
      // 另一格会被这一趟没带的值漏掉（写设置 只写传进来的项，不带就是不动，看着像没保存）。
      body: JSON.stringify({ 连续失败熔断: 熔断阈值.value, 每卡最多尝试遍数: 每卡遍数.value }),
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status))
    // 回填**服务端实际生效**的值（可能被夹到 0~999 / 1~5）—— 不回填的话，
    // 人填了 10000、界面还显示 10000，实际按 999 跑，看着像没保存上。
    if (d.设置 && d.设置.连续失败熔断 !== undefined) 熔断阈值.value = String(d.设置.连续失败熔断)
    if (d.设置 && d.设置.每卡最多尝试遍数 !== undefined) 每卡遍数.value = String(d.设置.每卡最多尝试遍数)
    uni.showToast({ title: '已保存', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: '保存失败：' + (e.message || '网络错误'), icon: 'none' })
  }
  settingsSaving.value = false
}
const flowConfigs = ref({})
const loadFlowConfigs = async () => {
  try {
    const resp = await authFetch(API+'/flows')
    const list = await resp.json()
    if (Array.isArray(list)) {
      for (const item of list) {
        try {
          const dr = await authFetch(API+'/flows/' + encodeURIComponent(item.name))
          flowConfigs.value[item.name] = await dr.json()
        } catch (_) {}
      }
    }
  } catch (_) {}
}

const doExecute = async () => {
  console.log('[VM-PANEL] doExecute 被调用', { code: v['卡牌编号'], flowIdx: flowIdx.value, flowName: flowNames.value[flowIdx.value], running: running.value })
  if (running.value) { stopFlow(); return }
  const code = (v['卡牌编号'] || '').toUpperCase()
  if (!code) { console.log('[VM-PANEL] 卡牌编号为空'); uni.showToast({ title: '请输入卡牌编号', icon: 'none' }); return }
  if (flowIdx.value === 0) { console.log('[VM-PANEL] 未选择流程'); uni.showToast({ title: '请选择流程', icon: 'none' }); return }

  running.value = true
  console.log('[VM-PANEL] running=true, 加载流程配置...')

  const selFlow = flowNames.value[flowIdx.value]
  let cfg = flowConfigs.value[selFlow]
  console.log('[VM-PANEL] cfg缓存:', !!cfg, 'steps:', cfg ? cfg.steps?.length : 0)
  if (!cfg || !cfg.steps) {
    console.log('[VM-PANEL] 配置未缓存, 重新加载...')
    await loadFlowConfigs(); cfg = flowConfigs.value[selFlow]
    console.log('[VM-PANEL] 重新加载后cfg:', !!cfg)
    if (!cfg || !cfg.steps) { console.log('[VM-PANEL] 加载失败!'); uni.showToast({ title: '加载失败', icon: 'none' }); running.value = false; return }
  }

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
    '游戏版本': gameNames[gameIdx.value] || '游戏王',
    '语种': langNames[langIdx.value] || '日',
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
          // 变量值匹配action名称
          const m = s.actions.find(a => a.name === vv)
          if (m) { steps.push({ type: t, x: m.x, y: m.y, duration: d, _desc: s.desc }); L(stepNum + '. ' + s.desc + ' (' + m.x + ',' + m.y + ')') }
        } else {
          // 变量未在输入参数中 → 运行时解析(如行数(输出)等输出变量)
          const varName = s.stepVariable.replace(/[{}]/g, '')
          steps.push({ type: t, _varName: varName, _actions: s.actions, duration: d, _desc: s.desc })
          L(stepNum + '. ' + s.desc + ' (动态查找: ' + varName + ')')
        }
      } else if (t === 'input') {
        if ((s.actions || []).length === 0) {
          // actions为空时用stepVariable作为文本
          steps.push({ type: 'input', text: s.stepVariable || '', x: 0, y: 0, duration: d, _desc: s.desc })
          L(stepNum + '. ' + s.desc + ': ' + rv(s.stepVariable || ''))
        } else {
          for (const a of s.actions) {
            steps.push({ type: 'input', text: a.text || '', x: a.x || 0, y: a.y || 0, duration: d, _desc: s.desc }); L(stepNum + '. ' + s.desc + ': ' + rv(a.text || ''))
          }
        }
      } else if (t === 'ocr-find-row') {
        const act = s.actions[0]
        if (!act) {
          L(stepNum + '. OCR识别: actions为空, 跳过')
        } else {
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
      } else if (t === 'extract') {
        const acts = s.actions || []
        if (acts.length === 0) {
          const kw = s.stepVariable || ''
          steps.push({ type: 'extract', actions: [{ keyword: kw, outputVar: kw }], duration: d, _desc: s.desc })
          L(stepNum + '. 提取: ' + kw + ' → ' + kw)
        } else {
          steps.push({ type: 'extract', actions: acts, duration: d, _desc: s.desc })
          L(stepNum + '. 提取: ' + acts.map(a => (a.keyword||'') + '→' + (a.outputVar||'?')).join(', '))
        }
      } else if (t === 'extract-row') {
        const acts = s.actions || []
        if (acts.length === 0) {
          L(stepNum + '. 提取行数: actions为空, 跳过')
        } else {
          steps.push({ type: 'extract-row', actions: acts, duration: d, _desc: s.desc })
          L(stepNum + '. 提取行数: ' + acts.map(a => (a.keyword||'') + '→' + (a.outputVar||'?')).join(', '))
        }
      } else if (t === 'clean') {
        if ((s.actions || []).length === 0) {
          L(stepNum + '. 清理: actions为空, 跳过')
        } else {
          for (const a of (s.actions || [])) {
            steps.push({ type: 'clean', actions: s.actions, duration: d, _desc: s.desc })
            L(stepNum + '. 清理: ' + (a.inputVar||'') + ' 去' + (a.remove||''))
          }
        }
      } else if (t === 'press') {
        if ((s.actions || []).length === 0) {
          steps.push({ type: 'press', text: 'enter', duration: d, _desc: s.desc })
          L(stepNum + '. 按键: enter')
        } else {
          for (const a of (s.actions || [])) {
            steps.push({ type: 'press', text: a.text || a.key || 'enter', duration: d, _desc: s.desc })
            L(stepNum + '. 按键: ' + (a.text || a.key || 'enter'))
          }
        }
      }
    } else if (t === 'compare') {
      steps.push({ type: 'compare', compareVar: s.compareVar, compareRightVar: s.compareRightVar || '', compareOp: s.compareOp, compareValue: s.compareValue, trueJump: s.trueJump, falseJump: s.falseJump, duration: d, _desc: s.desc })
      L(stepNum + '. 比较: ' + (s.compareVar||'?') + ' ' + (s.compareOp||'==') + ' ' + (s.compareRightVar ? s.compareRightVar.replace(/[{}]/g, '') : (s.compareValue||'')) + ' ? →' + (s.trueJump||'next') + ' : →' + (s.falseJump||'next'))
    } else if (t === 'jump') {
      steps.push({ type: 'jump', jumpTo: s.jumpTo, duration: d, _desc: s.desc })
      L(stepNum + '. 跳转到步骤 ' + (s.jumpTo||'?'))
    } else if (t === 'end') {
      steps.push({ type: 'end', duration: d, _desc: s.desc })
      L(stepNum + '. 结束流程')
    } else if (t === 'setvar' || t === 'compute') {
      const lv = (s.leftVar || '').replace(/[{}]/g, '')
      const rv_ = (s.rightVar || '').replace(/[{}]/g, '')
      steps.push({ type: t, leftVar: lv, rightVar: rv_, template: s.template || '', duration: d, _desc: s.desc })
      L(stepNum + '. ' + (s.desc || t) + ': ' + lv)
    } else {
      const acts = s.actions || []
      // extract/clean 不迭代actions, 直接push一次
      if (t === 'end') {
        steps.push({ type: 'end', duration: d, _desc: s.desc })
        L(stepNum + '. 结束流程')
      } else if (t === 'extract') {
        if (acts.length > 0) {
          steps.push({ type: 'extract', actions: acts, duration: d, _desc: s.desc })
          L(stepNum + '. 提取: ' + acts.map(a => (a.keyword||'') + '→' + (a.outputVar||'?')).join(', '))
        }
      } else if (t === 'extract-row') {
        if (acts.length > 0) {
          steps.push({ type: 'extract-row', actions: acts, duration: d, _desc: s.desc })
          L(stepNum + '. 提取行数: ' + acts.map(a => (a.keyword||'') + '→' + (a.outputVar||'?')).join(', '))
        }
      } else if (t === 'clean') {
        if (acts.length > 0) {
          steps.push({ type: 'clean', actions: acts, duration: d, _desc: s.desc })
          L(stepNum + '. 清理: ' + acts.map(a => (a.inputVar||'') + '去' + (a.remove||'')).join(', '))
        }
      } else if (acts.length === 0) {
        // actions为空: wait/press可直接执行, 其他类型跳过
        if (t === 'wait') {
          steps.push({ type: 'wait', duration: d, _desc: s.desc })
          L(stepNum + '. 等待 ' + d + 's')
        } else if (t === 'press') {
          steps.push({ type: 'press', text: s.name || 'enter', duration: d, _desc: s.desc })
          L(stepNum + '. 按键: ' + (s.name || 'enter'))
        } else if (t === 'scroll') {
          steps.push({ type: 'scroll', scroll_clicks: -500, duration: d, _desc: s.desc })
          L(stepNum + '. 滚动(默认)')
        } else if (t === 'find-click') {
          steps.push({ type: 'find-click', keyword: s.stepVariable || '', duration: d, _desc: s.desc })
          L(stepNum + '. 精准点击: ' + (s.stepVariable || ''))
        } else if (t === 'extract') {
          steps.push({ type: 'extract', actions: [{ keyword: s.stepVariable || '', outputVar: s.stepVariable || '' }], duration: d, _desc: s.desc })
        } else {
          L(stepNum + '. [跳过] ' + (s.desc || t) + ': actions为空')
        }
      } else {
        for (const a of acts) {
          const ss = { duration: d }
          if (t === 'tplclick') { ss.type = 'tplclick'; ss.x = a.x; ss.y = a.y }
          else if (t === 'click') { ss.type = 'click'; ss.x = a.x; ss.y = a.y }
          else if (t === 'press') { ss.type = 'press'; ss.text = a.text || a.key || ''; L(stepNum + '. ' + s.desc) }
          else if (t === 'input') { ss.type = 'input'; ss.text = a.text || ''; ss.x = a.x || 0; ss.y = a.y || 0 }
          else if (t === 'wait') { ss.type = 'wait'; L(stepNum + '. 等待 ' + d + 's') }
          else if (t === 'scroll') { ss.type = 'scroll'; ss.scroll_clicks = a.scroll_clicks || -500; if(a.x1!=null){ss.x1=a.x1;ss.y1=a.y1;ss.x2=a.x2;ss.y2=a.y2;ss.ms=a.ms} L(stepNum + '. ' + s.desc) }
          else if (t === 'find-click') { ss.type = 'find-click'; ss.keyword = a.keyword || s.keyword || ''; steps.push(ss); L(stepNum + '. 精准点击: ' + (ss.keyword || '')); continue }
          else continue
          steps.push(ss)
        }
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
    console.log('[VM-PANEL] 发送请求 steps=' + steps.length + ' vars=' + JSON.stringify(vars))
    const result = await apiPost('/execute', { name: selFlow, steps, variables: vars })
    console.log('[VM-PANEL] 收到响应', result)
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
        // 只回写流程可能修改的变量 (setvar/OCR/extract), 不覆盖用户手工输入的上架参数
        if (rv_['旧罕贵度']) { v['旧罕贵度'] = rv_['旧罕贵度']; const mi2 = rareOpts.indexOf(rv_['旧罕贵度']); if (mi2 >= 0) mi.value = mi2 }
        if (rv_['集换价(输出)']!=null) outJhj.value=rv_['集换价(输出)']
        if (rv_['最低价(输出)']!=null) outDj.value=rv_['最低价(输出)']
        if (rv_['编号(输出)']!=null) outBh.value=rv_['编号(输出)']
        if (rv_['罕贵度(输出)']!=null) outHgd.value=rv_['罕贵度(输出)']
        if (rv_['中文卡名(输出)']!=null) outZwdm.value=rv_['中文卡名(输出)']
        if (rv_['中文别名(输出)']!=null) outZwbm.value=rv_['中文别名(输出)']
        if (rv_['语种(输出)']!=null) outYz.value=rv_['语种(输出)']
        if (rv_['游戏版本(输出)']!=null) outYxbb.value=rv_['游戏版本(输出)']
        if (rv_['行数(输出)']!=null) outHangshu.value=rv_['行数(输出)']
        if (rv_['运行状态(输出)']!=null) outYxzt.value=rv_['运行状态(输出)']
        if (rv_['数量(输出)']!=null) outSl.value=rv_['数量(输出)']
        if (rv_['价格(输出)']!=null) outJg.value=rv_['价格(输出)']
        if (rv_['备注(输出)']!=null) outBz.value=rv_['备注(输出)']
        if (rv_['输入框编号(输出)']!=null) outSrkbh.value=rv_['输入框编号(输出)']
        if (rv_['对应行数']&&rv_['对应行数']!=='1') L('>>> OCR: 第'+rv_['对应行数']+'行', 'log-ok')
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
            versionName: gameNames[gameIdx.value] + langNames[langIdx.value]
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
    console.error('[VM-PANEL] 执行错误', e)
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
    const resp = await authFetch(API+'/flows')
    const list = await resp.json()
    if (Array.isArray(list)) {
      flowNames.value = ['-- 手动选择 --', ...list.map(c => c.name)]
    }
  } catch (_) {}
}

onMounted(async()=>{
  try{engineOk.value=(await(await authFetch(API+'/status')).json()).ok}catch(_){}
  checkCompStatus()
  await refreshFlowList()
  loadFlowConfigs()
  载入设置()
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
