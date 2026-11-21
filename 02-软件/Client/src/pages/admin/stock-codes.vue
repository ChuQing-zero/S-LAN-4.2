<template>
  <view class="page">
    <view class="topbar">
      <view class="tbtn" @tap="goBack"><image class="timg" src="/static/icons/ic_back.png" mode="aspectFit" /></view>
      <text class="ttl">库存编号管理</text>
    </view>

    <!-- 统计 -->
    <view class="stats">
      <text class="st" :class="{active:!selStatus}" @tap="selStatus='';fetchList()">总数 {{total}}</text>
      <text class="st ok" :class="{active:selStatus==='available'}" @tap="selStatus='available';fetchList()">可用 {{available}}</text>
      <text class="st use" :class="{active:selStatus==='in_use'}" @tap="selStatus='in_use';fetchList()">已用 {{inUse}}</text>
      <text class="st full" :class="{active:selStatus==='full'}" @tap="selStatus='full';fetchList()">已满 {{full}}</text>
    </view>

    <!-- 库类型筛选 -->
    <view class="filter-bar">
      <view class="filter-tag" @tap="showPick='lib'"><text class="filter-tag-text">{{ libTypeLabel }}</text><image class="small-arrow" src="/static/icons/ic_arrow_down.png" mode="aspectFit" /></view>
      <view class="filter-tag" @tap="showPick='ver'"><text class="filter-tag-text">{{ verLabel }}</text><image class="small-arrow" src="/static/icons/ic_arrow_down.png" mode="aspectFit" /></view>
      <view class="filter-tag" v-if="allTags.length>0" @tap="showPick='tag'"><text class="filter-tag-text">{{ tagLabel }}</text><image class="small-arrow" src="/static/icons/ic_arrow_down.png" mode="aspectFit" /></view>
    </view>

    <!-- 筛选弹窗 -->
    <view v-if="showPick" class="pick-mask" @tap="showPick=''"></view>
    <view v-if="showPick" class="pick-popup" @tap.stop>
      <view class="pick-grid">
        <view class="pick-item" :class="{active:isPickActive(v)}" v-for="(v,i) in pickList" :key="i" @tap="onPickSelect(i,v)">{{ v }}</view>
      </view>
    </view>

    <scroll-view class="body" scroll-y>
      <view class="card" v-for="item in list" :key="item.code">
        <view class="row">
          <text class="code">{{ item.displayCode || item.fullCode }}</text>
          <text class="ver">{{ item.versionName }}</text>
          <text class="st-tag" :class="item.status">{{ item.status==='available'?'可用':item.status==='in_use'?'已用':item.status==='full'?'已满':item.status==='locked'?'锁定':item.status==='archived'?'已上架':item.status==='pending'?'待上架':'未知' }}</text>
          <text class="lib-type local" v-if="item.libraryType==='local'&&item.assignedTo">ID:{{ item.assignedTo }}</text>
          <text class="lib-type cloud" v-else-if="item.libraryType==='cloud'">云端</text>
          <text class="lib-type archived" v-else-if="item.status==='archived'">已上架</text>
          <text class="lib-type pool" v-else>编号池</text>
          <text class="tag" v-for="t in (item.tags||[])" :key="t">{{ t }}</text>
        </view>
        <view class="row2" v-if="item.note">
          <text class="note">备注: {{ item.note }}</text>
        </view>
        <view class="row2">
          <text class="info">上限: {{ item.maxCards }}张 | 当前: {{ item.currentCards }}张 | {{ formatTime(item.updatedAt) }}</text>
        </view>
      </view>
      <view v-if="list.length===0" style="text-align:center;padding:60px 0;color:#CCC">暂无编号</view>
    </scroll-view>

    <!-- 新增/编辑弹窗 -->
    <view v-if="showAdd||showEdit" class="modal-mask" @tap="showAdd=false;showEdit=false">
      <view class="modal-box" @tap.stop>
        <text class="mod-title">{{ showEdit?'编辑':'新增' }}库存编号</text>

        <view class="mod-row">
          <text class="mod-lbl">前缀</text>
          <input class="mod-inp" v-model="form.prefix" placeholder="A" style="width:60px" />
          <text class="mod-lbl">分区</text>
          <input class="mod-inp" v-model.number="form.zone" type="number" placeholder="0" style="width:48px" />
          <text class="mod-lbl">序号</text>
          <input class="mod-inp" v-model.number="form.seq" type="number" placeholder="1" style="width:60px" />
        </view>
        <view class="mod-row">
          <text class="mod-lbl">子序号</text>
          <input class="mod-inp" v-model.number="form.subSeq" type="number" placeholder="0" style="width:48px" />
        </view>
        <view class="mod-row">
          <text class="mod-lbl">版本</text>
          <picker :value="verIdx" :range="verNames" @change="onVer"><view class="mod-sel">{{ verNames[verIdx] }}</view></picker>
        </view>
        <view class="mod-row">
          <text class="mod-lbl">备注</text>
          <input class="mod-inp" v-model="form.note" placeholder="备注说明" style="flex:1" />
        </view>
        <view class="mod-row">
          <text class="mod-lbl">标签</text>
          <view style="flex:1;display:flex;flex-direction:column;gap:4px">
            <view style="display:flex;gap:4px;flex-wrap:wrap">
              <view class="tag-edit" v-for="(t,i) in (form.tags||[])" :key="i">
                <text>{{t}}</text><text class="tag-x" @tap="form.tags.splice(i,1)">×</text>
              </view>
            </view>
            <view style="display:flex;gap:4px">
              <input class="mod-inp" v-model="newTag" placeholder="新标签" style="flex:1" @confirm="addTag" />
              <view class="tag-add-btn" @tap="addTag"><text>添加</text></view>
            </view>
          </view>
        </view>
        <view class="mod-row">
          <text class="mod-lbl">上限</text>
          <input class="mod-inp" v-model.number="form.maxCards" type="number" placeholder="30" style="width:60px" />
          <text class="mod-lbl">状态</text>
          <picker :value="['available','in_use','full','locked'].indexOf(form.status)" :range="['可用','已用','已满','锁定']" @change="e=>form.status=['available','in_use','full','locked'][e.detail.value]">
            <view class="mod-sel">{{ form.status==='available'?'可用':form.status==='in_use'?'已用':form.status==='full'?'已满':'锁定' }}</view>
          </picker>
        </view>
        <view class="mod-row" v-if="!showEdit">
          <text class="mod-lbl">批量</text>
          <input class="mod-inp" v-model.number="batchCount" type="number" placeholder="数量" style="width:60px" />
          <text class="hint">自动递增子序号</text>
        </view>

        <view class="mod-btns">
          <view class="mod-btn cancel" @tap="showAdd=false;showEdit=false"><text>取消</text></view>
          <view class="mod-btn ok" @tap="onSave"><text>{{ showEdit?'保存':'创建' }}</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'

const API = '/v1/api/admin/stock-codes'
const list = ref([])
const showAdd = ref(false)
const showEdit = ref(false)
const editCode = ref('')
const batchCount = ref(1)
const verIdx = ref(0)
const verNames = ['游戏王日文','游戏王英文','游戏王简中','宝可梦简中','宝可梦日文','宝可梦繁中']

const form = ref({ prefix:'A', zone:0, seq:1, subSeq:0, versionName:'游戏王日文', note:'', maxCards:30, status:'available' })

const total = ref(0), available = ref(0), inUse = ref(0), full = ref(0)
const allTags = ref([]), selTag = ref(''), selVer = ref(''), selStatus = ref(''), selLibType = ref(''), newTag = ref('')
const libTypeLabel = ref('全部位置'), verLabel = ref('全部版本'), tagLabel = ref('全部标签')
const showPick = ref('')
const pickList = ref([])

const isPickActive = (v) => {
  if (showPick.value==='lib') return v===libTypeLabel.value
  if (showPick.value==='ver') return v===verLabel.value
  if (showPick.value==='tag') return v===tagLabel.value
  return false
}

const onPickSelect = (i, v) => {
  if (showPick.value==='lib') {
    if (v==='已上架') { selStatus.value='archived'; selLibType.value='' }
    else { selLibType.value = v==='全部'?'':v==='本地库'?'local':'cloud'; selStatus.value='' }
    libTypeLabel.value = v
  } else if (showPick.value==='ver') {
    selVer.value = v==='全部版本'?'':v
    verLabel.value = v
  } else if (showPick.value==='tag') {
    selTag.value = v==='全部标签'?'':v
    tagLabel.value = v
  }
  showPick.value = ''; fetchList()
}

watch(showPick, (val) => {
  if (val==='lib') pickList.value = ['全部','本地库','云端库','已上架']
  else if (val==='ver') pickList.value = ['全部版本',...verNames]
  else if (val==='tag') pickList.value = ['全部标签',...allTags.value]
})

const goBack = () => uni.navigateTo({ url: '/pages/inventory/inventory' })

const fetchList = async () => {
  try {
    const token = uni.getStorageSync('token')
    const params = []
    if (selTag.value) params.push('tag=' + encodeURIComponent(selTag.value))
    if (selVer.value) params.push('versionName=' + encodeURIComponent(selVer.value))
    if (selStatus.value) params.push('status=' + selStatus.value)
    if (selStatus.value) params.push('status=' + selStatus.value)
    else if (selLibType.value) { params.push('libraryType=' + selLibType.value) }
    else { params.push('excludePool=true') }
    let url = API
    if (params.length) url += '?' + params.join('&')
    const r = await (await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })).json()
    list.value = r.list || []
    total.value = r.total || 0
    available.value = r.available || 0
    inUse.value = r.inUse || 0
    full.value = r.full || 0
    allTags.value = r.allTags || []
    verNameOpts.value = ['全部版本', ...verNames]
    tagOpts.value = ['全部标签', ...allTags.value]
  } catch (_) {}
}

const formatTime = (d) => {
  if (!d) return ''
  const dt = new Date(d)
  return dt.getFullYear()+'/'+String(dt.getMonth()+1).padStart(2,'0')+'/'+String(dt.getDate()).padStart(2,'0')+' '+String(dt.getHours()).padStart(2,'0')+':'+String(dt.getMinutes()).padStart(2,'0')
}

const addTag = () => {
  const t = newTag.value.trim()
  if (!t) return
  if (!form.value.tags) form.value.tags = []
  if (!form.value.tags.includes(t)) form.value.tags.push(t)
  newTag.value = ''
}

const onVer = e => { verIdx.value = e.detail.value; form.value.versionName = verNames[e.detail.value] }

const resetForm = () => {
  form.value = { prefix:'A', zone:0, seq:list.value.length+1, subSeq:0, versionName:'游戏王日文', note:'', maxCards:30, status:'available' }
  batchCount.value = 1
  verIdx.value = 0
}

const editItem = (item) => {
  form.value = { ...item }
  verIdx.value = verNames.indexOf(item.versionName)
  if (verIdx.value < 0) verIdx.value = 0
  editCode.value = item.code
  showEdit.value = true
}

const authHeaders = () => {
  const token = uni.getStorageSync('token')
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
}

const onSave = async () => {
  if (showEdit.value) {
    await fetch(API + '/' + editCode.value, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify(form.value)
    })
    showEdit.value = false
  } else if (batchCount.value > 1) {
    await fetch(API + '/batch', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ ...form.value, startSeq: form.value.seq, count: batchCount.value })
    })
    showAdd.value = false; resetForm()
  } else {
    await fetch(API, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify(form.value)
    })
    showAdd.value = false; resetForm()
  }
  fetchList()
}

const deleteItem = async (item) => {
  uni.showModal({
    title: '删除', content: '确定删除 ' + item.code + ' ?',
    success: async (res) => {
      if (res.confirm) { await fetch(API + '/' + item.code, { method: 'DELETE', headers: authHeaders() }); fetchList() }
    }
  })
}

onMounted(fetchList)
</script>

<style scoped>
*{box-sizing:border-box}
.page{display:flex;flex-direction:column;height:100vh;background:#F5F5F7}
.topbar{background:#FFF;padding:14px 16px 12px;display:flex;align-items:center;position:relative;flex-shrink:0;z-index:210}
.tbtn{width:32px;height:32px;border-radius:16px;background:#F0F0F0;display:flex;align-items:center;justify-content:center}
.timg{width:18px;height:18px}
.ttl{font-size:15px;font-weight:500;color:#1A1A1A;position:absolute;left:50%;transform:translateX(-50%)}
.stats{display:flex;gap:16px;padding:10px 16px;background:#FFF;border-top:1px solid #F0F0F0;position:relative;z-index:210}
.st{font-size:12px;color:#666;padding:2px 6px;border-radius:4px}.st.active{background:#F0F0F0;font-weight:600}.st.ok{color:#34C759}.st.use{color:#FF9500}.st.full{color:#FF0000}
.filter-bar{display:flex;gap:8px;padding:8px 16px;background:#FFF;border-top:1px solid #F0F0F0;position:relative;z-index:210}
.filter-tag{display:flex;align-items:center;background:#F0F0F0;border-radius:14px;padding:5px 10px;gap:4px}
.filter-tag-text{font-size:11px;color:#1A1A1A}
.small-arrow{width:10px;height:10px}
.pick-mask{position:fixed;top:0;left:0;right:0;bottom:0;z-index:199;background:rgba(0,0,0,.4)}
.pick-popup{position:fixed;top:139px;left:0;width:100%;z-index:200;background:#FFF;border-radius:0 0 16px 16px;padding:16px;box-sizing:border-box;box-shadow:0 8px 20px rgba(0,0,0,.15)}
.pick-grid{display:flex;flex-wrap:wrap;gap:8px}
.pick-item{background:#F0F0F0;border-radius:50px;padding:8px 16px;font-size:13px;color:#1A1A1A}
.pick-item.active{background:#FF0000;color:#FFF}
.tags-row{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px}
.tag{font-size:10px;padding:2px 8px;border-radius:10px;background:#F0F4FF;color:#4A90D9}
.lib-type{font-size:10px;padding:2px 8px;border-radius:8px}.lib-type.local{background:#E8F5E9;color:#2E7D32}.lib-type.cloud{background:#E3F2FD;color:#1565C0}.lib-type.pool{background:#FFF3E0;color:#E65100}.lib-type.archived{background:#F3E5F5;color:#9C27B0}
.tag-edit{display:flex;align-items:center;gap:2px;font-size:11px;padding:2px 8px;border-radius:10px;background:#F0F4FF;color:#4A90D9}
.tag-x{font-size:12px;color:#999;margin-left:4px}
.tag-add-btn{font-size:12px;color:#FFF;background:#4A90D9;padding:4px 12px;border-radius:6px}
.body{flex:1;overflow-y:auto;padding:12px 16px}
.card{background:#FFF;border-radius:10px;padding:12px 14px;margin-bottom:8px}
.row{display:flex;align-items:center;gap:8px}
.row2{display:flex;align-items:center;justify-content:space-between;margin-top:4px}
.code{font-size:15px;font-weight:600;color:#1A1A1A}
.ver{font-size:11px;color:#666;background:#F0F0F0;padding:2px 8px;border-radius:10px}
.st-tag{font-size:10px;padding:2px 8px;border-radius:8px}.st-tag.available{color:#34C759;background:#E8F8ED}.st-tag.in_use{color:#FF9500;background:#FFF3E0}.st-tag.full{color:#FF0000;background:#FFF0F0}.st-tag.archived{color:#9C27B0;background:#F3E5F5}.st-tag.locked{color:#999;background:#F0F0F0}.st-tag.pending{color:#C62828;background:#FCE4EC}
.note{font-size:11px;color:#999}
.info{font-size:11px;color:#999}
.row-btns{display:flex;gap:6px}
.rbtn{padding:3px 10px;border-radius:10px;background:#F0F0F0}.rbtn.del{background:#FFF0F0}
.rb{font-size:11px;color:#1A1A1A}.rbtn.del .rb{color:#FF0000}
.modal-mask{position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center}
.modal-box{width:90%;max-width:360px;background:#FFF;border-radius:16px;padding:20px}
.mod-title{font-size:16px;font-weight:600;text-align:center;display:block;margin-bottom:16px}
.mod-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.mod-lbl{font-size:12px;color:#666;width:40px;text-align:right}
.mod-inp{height:36px;background:#F5F5F7;border:1px solid #E5E5EA;border-radius:6px;padding:0 8px;font-size:13px}
.mod-sel{flex:1;height:36px;background:#F5F5F7;border:1px solid #E5E5EA;border-radius:6px;display:flex;align-items:center;padding:0 8px;font-size:13px}
.hint{font-size:10px;color:#999}
.mod-btns{display:flex;gap:10px;margin-top:6px}
.mod-btn{flex:1;height:42px;border-radius:20px;display:flex;align-items:center;justify-content:center;font-size:14px}
.mod-btn.cancel{background:#F0F0F0;color:#666}
.mod-btn.ok{background:#FF0000;color:#FFF}
</style>
