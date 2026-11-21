<template>
  <view class="page-container">
    <view class="topbar">
      <view class="tbtn" @tap="goBack"><image class="timg" src="/static/icons/ic_back.png" mode="aspectFit" /></view>
      <text class="ttl">图源设置</text>
      <view class="tbtn-entry" @tap="goCatalog"><text class="tbtn-entry-text">卡牌编号目录</text></view>
    </view>

    <scroll-view class="content" scroll-y="true">
      <view class="tips-box">
        <text class="tips-text">配置 TCG 卡图库的 4 个图源目录。保存后立即生效，不用重启后端。</text>
        <text class="tips-text">详细图源 = 日文OCG（子目录按包号）；保底图源 = YGOPro（直接按卡密）。</text>
      </view>

      <view class="path-card" v-for="item in pathItems" :key="item.key">
        <view class="path-head">
          <text class="path-name">{{ item.name }}</text>
          <text class="path-exists" :class="exists[item.key] ? 'green' : 'red'">
            {{ exists[item.key] ? '✓ 存在' : '✗ 不存在' }}
          </text>
        </view>
        <input class="path-input" v-model="paths[item.key]" :placeholder="item.placeholder" />
        <text class="path-desc">{{ item.desc }}</text>
      </view>

      <view class="btn-row">
        <view class="btn btn-save" @tap="onSave"><text>保存</text></view>
        <view class="btn btn-reset" @tap="onReset"><text>恢复默认</text></view>
      </view>

      <view class="import-box">
        <view class="btn btn-import" @tap="onImport" :class="{ disabled: importing }"><text>{{ importing ? '载入中…' : '载入卡牌数据' }}</text></view>
        <text class="import-tip">从 ID 数据目录重建卡库：补新包 + 更新全部卡 + 删除残留旧包。异画标签保留。</text>
      </view>

      <view class="bak-box">
        <text class="bak-title">数据备份</text>
        <view class="btn-row">
          <view class="btn btn-export" @tap="onExport" :class="{ disabled: busy }"><text>📤 导出</text></view>
          <view class="btn btn-importfile" @tap="onPickBundle" :class="{ disabled: busy }"><text>📥 导入</text></view>
        </view>
        <text class="bak-tip">导出成一个 JSON 文件，里面装着「卡牌编号目录 + 信息登记 + 异画标签」三样人工整理出来的数据。换机器、重装、改坏了要退回来，都靠它。</text>
        <text class="bak-tip">导入时可选「合并」（只补不改，库里多出来的一个不删）或「覆盖」（先整份自动备份，再清空重建）。</text>
      </view>

      <view class="footer-space"></view>
    </scroll-view>

    <!-- 导入向导：模式选择 → 覆盖二次确认 → 结果。三个分支用同一个外壳，
         自绘而不用 uni.showModal —— 那个只有两个按钮，而这里要摆的是「合并 / 覆盖 / 取消」三选一，
         还要把备份路径这种长文本原样显示出来。 -->
    <view class="mask" v-if="dlgStep">
      <view class="dlg">
        <template v-if="dlgStep === 'mode'">
          <text class="dlg-title">导入数据包</text>
          <text class="dlg-file">{{ impFileName }}</text>
          <!-- 「异画标签 N 个编号」改成「N 行」：V1.2.39 起标签不再是独立那份 altLabels 映射，
               而是卡牌编号目录行上的一列，所以计数的单位从「编号」变成了「行」。 -->
          <text class="dlg-line">文件里：卡牌编号目录 {{ impPlan.cardcatalogs.inFile }} 条 · 信息登记 {{ impPlan.cardmarks.inFile }} 条 · 异画标签 {{ impPlan.altLabels.inFile }} 行</text>
          <text class="dlg-line">当前库里：卡牌编号目录 {{ impPlan.cardcatalogs.inDb }} 条 · 信息登记 {{ impPlan.cardmarks.inDb }} 条</text>
          <view class="dlg-sep"></view>
          <text class="dlg-opt-t">合并导入（推荐）</text>
          <text class="dlg-opt-d">新增 {{ impPlan.cardcatalogs.add + impPlan.cardmarks.add }} 条，更新 {{ impPlan.cardcatalogs.overwrite + impPlan.cardmarks.overwrite }} 条；库里多出来的记录一个都不删，已有的处理备注也不会被空备注覆盖。</text>
          <text class="dlg-opt-t">覆盖导入</text>
          <text class="dlg-opt-d">清空现有 {{ impPlan.cardcatalogs.inDb }} 条目录与 {{ impPlan.cardmarks.inDb }} 条登记，只留文件里的内容。导入前会自动整份备份。</text>
          <view class="dlg-btns">
            <view class="dlg-btn dlg-cancel" @tap="dlgStep = ''"><text>取消</text></view>
            <view class="dlg-btn dlg-merge" @tap="runImport('merge')"><text>合并导入</text></view>
            <view class="dlg-btn dlg-replace" @tap="dlgStep = 'confirm'"><text>覆盖导入</text></view>
          </view>
        </template>

        <template v-else-if="dlgStep === 'confirm'">
          <text class="dlg-title">确认覆盖导入？</text>
          <text class="dlg-warn">这一步会先把当前数据整份备份，然后清空重建。</text>
          <text class="dlg-line">会被清掉：卡牌编号目录 {{ impPlan.cardcatalogs.inDb }} 条 · 信息登记 {{ impPlan.cardmarks.inDb }} 条</text>
          <text class="dlg-line">会被丢掉：异画标签里文件没提到的编号</text>
          <view class="dlg-sep"></view>
          <text class="dlg-line">导入前自动备份到服务器的</text>
          <text class="dlg-path">Server\Storage\pre-replace-backup\</text>
          <text class="dlg-line">下的一个新目录（精确路径导入完成后会告诉你）。导错了拿那份备份再导一次就能退回来。</text>
          <view class="dlg-btns">
            <view class="dlg-btn dlg-cancel" @tap="dlgStep = 'mode'"><text>再想想</text></view>
            <view class="dlg-btn dlg-replace" @tap="runImport('replace')"><text>确认覆盖</text></view>
          </view>
        </template>

        <template v-else-if="dlgStep === 'done'">
          <text class="dlg-title">{{ doneTitle }}</text>
          <text class="dlg-line" v-for="(l, i) in doneLines" :key="i">{{ l }}</text>
          <view class="dlg-btns">
            <view class="dlg-btn dlg-merge" @tap="dlgStep = ''"><text>知道了</text></view>
          </view>
        </template>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import {
  getTcgPaths, saveTcgPaths, importTcgData,
  exportCatalogBundle, previewCatalogBundle, importCatalogBundle,
} from '@/api/index.js'

const paths = ref({ ocgDir: '', ygoproDir: '', thumbDir: '', dataDir: '' })
const exists = ref({})
let defaultsRef = null

const pathItems = [
  { key: 'ocgDir', name: '详细图源（日文OCG）', desc: '子目录 = 包号 → 卡密-编号-罕贵(-异画).jpg', placeholder: '…\\TCG_Image_Database\\日文OCG' },
  { key: 'ygoproDir', name: '保底图源（YGOPro）', desc: '直接 卡密.jpg（兜底）', placeholder: '…\\YGOPro图片源' },
  { key: 'thumbDir', name: '缩略图目录', desc: '懒加载生成的 webp 缩略图缓存', placeholder: '…\\缩略图' },
  { key: 'dataDir', name: 'ID 数据目录', desc: '卡牌编号目录 JSON（包号.json + _index.json）', placeholder: '…\\TCG_ID_Database\\日文游戏王' },
]

const load = async () => {
  try {
    const d = await getTcgPaths()
    if (d.paths) paths.value = { ...paths.value, ...d.paths }
    if (d.exists) exists.value = d.exists
    if (d.defaults) defaultsRef = d.defaults
  } catch (_) {
    uni.showToast({ title: '读取图源配置失败', icon: 'none' })
  }
}

const onSave = async () => {
  try {
    const d = await saveTcgPaths(paths.value)
    if (d.exists) exists.value = d.exists
    uni.showToast({ title: '已保存，立即生效', icon: 'success' })
  } catch (_) {
    uni.showToast({ title: '保存失败', icon: 'none' })
  }
}

const onReset = async () => {
  try {
    const d = await saveTcgPaths(defaultsRef || {})
    if (d.paths) paths.value = { ...paths.value, ...d.paths }
    if (d.exists) exists.value = d.exists
    uni.showToast({ title: '已恢复默认', icon: 'success' })
  } catch (_) {
    uni.showToast({ title: '恢复失败', icon: 'none' })
  }
}

// 载入卡牌数据：从 ID 数据目录全量重建 MongoDB 卡库
const importing = ref(false)
const onImport = () => {
  uni.showModal({
    title: '载入卡牌数据',
    content: '将从当前 ID 数据目录重建卡库：补新包、更新全部卡、删除新库没有的残留旧包。已有异画标签保留。确定载入？',
    confirmText: '载入',
    success: async (r) => {
      if (!r.confirm) return
      importing.value = true
      uni.showLoading({ title: '正在载入...' })
      try {
        const d = await importTcgData()
        uni.hideLoading()
        uni.showToast({ title: `载入完成：更新 ${d.imported} 张，删除 ${d.deleted} 张`, icon: 'none' })
      } catch (e) {
        uni.hideLoading()
        uni.showToast({ title: '载入失败：' + ((e && (e.message || e.errMsg)) || '未知错误'), icon: 'none' })
      } finally {
        importing.value = false
      }
    }
  })
}

// ---------- 数据备份：导出 / 导入 ----------
// 导出的是一个「目录数据包」：卡牌编号目录 + 信息登记 + 异画标签，三样都是人工整理出来的，
// 所以要能一起带走、一起带回来。它跟上面那个「载入卡牌数据」不是一回事 ——
// 那个是从 ID 数据目录重建，这个是在两台机器/两个时间点之间搬运人工成果。
const busy = ref(false)
const dlgStep = ref('')          // '' | 'mode' | 'confirm' | 'done'
const impBundle = ref(null)      // 解析好的数据包（先存着，用户选完模式才真发）
const impPlan = ref(null)        // preview 的核对结果
const impFileName = ref('')
const doneTitle = ref('')
const doneLines = ref([])

const today = () => {
  const d = new Date()
  const p2 = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

const onExport = async () => {
  if (busy.value) return
  busy.value = true
  uni.showLoading({ title: '正在导出…' })
  try {
    const bundle = await exportCatalogBundle()
    const name = `slan-catalog-${today()}.json`
    // 不直接用浏览器打开 /tcg/export-bundle：那条路由要 Authorization 头，
    // 地址栏直开带不上 token，只会拿到 401。所以先取回文本，再自己触发下载。
    // #ifdef H5
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    uni.hideLoading()
    uni.showToast({ title: '已导出 ' + name, icon: 'none', duration: 2500 })
    // #endif
    // #ifndef H5
    uni.hideLoading()
    uni.showToast({ title: '导出目前只在网页端可用', icon: 'none' })
    // #endif
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: '导出失败：' + ((e && e.message) || '未知错误'), icon: 'none' })
  } finally {
    busy.value = false
  }
}

const onPickBundle = () => {
  if (busy.value) return
  // #ifdef H5
  const inp = document.createElement('input')
  inp.type = 'file'
  inp.accept = '.json,application/json'
  inp.style.display = 'none'
  inp.onchange = () => {
    const f = inp.files && inp.files[0]
    document.body.removeChild(inp)
    if (f) readBundleFile(f)
  }
  document.body.appendChild(inp)
  inp.click()
  // #endif
  // #ifndef H5
  uni.showToast({ title: '导入目前只在网页端可用', icon: 'none' })
  // #endif
}

const readBundleFile = (f) => {
  const reader = new FileReader()
  reader.onload = async () => {
    let bundle = null
    try { bundle = JSON.parse(String(reader.result)) } catch (_) {}
    // 先在本地粗筛一道：文件不对就没必要把几 MB 传上去再让服务端拒。
    // 判据跟服务端 validateBundle 对齐（那边是权威，这里只是省一趟）。
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)
      || !Array.isArray(bundle.cardcatalogs) || !Array.isArray(bundle.cardmarks)) {
      uni.showToast({ title: '这不是「目录数据包」文件', icon: 'none', duration: 2500 })
      return
    }
    if (bundle._meta && bundle._meta.app && bundle._meta.app !== 'S-LAN') {
      uni.showToast({ title: '这个文件不是 S-LAN 导出的', icon: 'none', duration: 2500 })
      return
    }
    impFileName.value = f.name
    impBundle.value = bundle
    busy.value = true
    uni.showLoading({ title: '正在核对…' })
    try {
      const d = await previewCatalogBundle(bundle)
      uni.hideLoading()
      if (!d || !d.plan) {
        impBundle.value = null
        uni.showToast({ title: '核对失败', icon: 'none' })
        return
      }
      impPlan.value = d.plan
      dlgStep.value = 'mode'
    } catch (e) {
      uni.hideLoading()
      impBundle.value = null
      uni.showToast({ title: '核对失败：' + ((e && e.message) || '未知错误'), icon: 'none', duration: 2500 })
    } finally {
      busy.value = false
    }
  }
  reader.onerror = () => uni.showToast({ title: '读取文件失败', icon: 'none' })
  reader.readAsText(f, 'utf-8')
}

const runImport = async (mode) => {
  if (busy.value || !impBundle.value) return
  busy.value = true
  dlgStep.value = ''
  uni.showLoading({ title: mode === 'replace' ? '正在覆盖导入…' : '正在合并导入…' })
  try {
    const d = await importCatalogBundle(impBundle.value, mode)
    uni.hideLoading()
    const c = (d && d.cardcatalogs) || {}
    const m = (d && d.cardmarks) || {}
    doneTitle.value = mode === 'replace' ? '覆盖导入完成' : '合并导入完成'
    doneLines.value = [
      `卡牌编号目录：新增 ${c.inserted || 0} 条，更新 ${c.updated || 0} 条`,
      `信息登记：新增 ${m.inserted || 0} 条，更新 ${m.updated || 0} 条`,
    ]
    if (d && d.backupDir) {
      doneLines.value.push('覆盖前的备份在服务器的：')
      doneLines.value.push(d.backupDir)
    }
    dlgStep.value = 'done'
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: '导入失败：' + ((e && e.message) || '未知错误'), icon: 'none', duration: 2500 })
  } finally {
    busy.value = false
    impBundle.value = null
  }
}

// 返回键 → 直达后台管理（reLaunch 重置页面栈，直接访问本页也能可靠返回）
const goBack = () => uni.reLaunch({ url: '/pages/admin/dashboard' })
const goCatalog = () => uni.navigateTo({ url: '/pages/admin/catalog' })

load()
</script>

<style scoped>
* { box-sizing: border-box; }
.page-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #F5F5F7;
}
.topbar {
  background: #FFFFFF;
  padding: 14px 16px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  flex-shrink: 0;
}
.tbtn {
  width: 32px;
  height: 32px;
  border-radius: 16px;
  background: #F0F0F0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.timg { width: 18px; height: 18px; }
.ttl {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 16px;
  font-weight: 500;
  color: #1A1A1A;
}
.tbtn-entry {
  height: 32px;
  border-radius: 16px;
  background: #1660C6;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
}
.tbtn-entry-text { font-size: 12px; font-weight: 500; color: #FFFFFF; }
.content { flex: 1; padding: 14px 16px; }
.tips-box {
  background: #E8F0FE;
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 14px;
}
.tips-text {
  display: block;
  font-size: 12px;
  color: #1660C6;
  line-height: 1.6;
}
.path-card {
  background: #FFFFFF;
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 10px;
}
.path-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.path-name {
  font-size: 14px;
  font-weight: 500;
  color: #1A1A1A;
}
.path-exists { font-size: 12px; }
.path-exists.green { color: #22C55E; }
.path-exists.red { color: #EF4444; }
.path-input {
  width: 100%;
  height: 36px;
  background: #F5F5F7;
  border-radius: 8px;
  padding: 0 10px;
  font-size: 13px;
  color: #1A1A1A;
}
.path-desc {
  display: block;
  font-size: 11px;
  color: #999999;
  margin-top: 6px;
}
.btn-row {
  display: flex;
  flex-direction: row;
  gap: 12px;
  margin-top: 4px;
}
.btn {
  flex: 1;
  height: 42px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.btn-save { background: #1660C6; }
.btn-save text { font-size: 15px; font-weight: 500; color: #FFFFFF; }
.btn-reset { background: #F0F0F0; }
.btn-reset text { font-size: 14px; color: #666666; }
.import-box { margin-top: 14px; }
.btn-import { background: #E58E26; height: 42px; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
.btn-import text { font-size: 15px; font-weight: 500; color: #FFFFFF; }
.btn-import.disabled { opacity: 0.6; }
.import-tip {
  display: block;
  font-size: 11px;
  color: #999999;
  margin-top: 8px;
  line-height: 1.5;
}
.bak-box {
  margin-top: 20px;
  background: #FFFFFF;
  border-radius: 12px;
  padding: 12px;
}
.bak-title { display: block; font-size: 14px; font-weight: 500; color: #1A1A1A; margin-bottom: 10px; }
.btn-export { background: #1660C6; }
.btn-export text { font-size: 15px; font-weight: 500; color: #FFFFFF; }
.btn-importfile { background: #F0F0F0; }
.btn-importfile text { font-size: 15px; font-weight: 500; color: #1660C6; }
.btn.disabled { opacity: 0.6; }
.bak-tip {
  display: block;
  font-size: 11px;
  color: #999999;
  margin-top: 8px;
  line-height: 1.6;
}

/* ---------- 导入向导弹窗 ---------- */
.mask {
  position: fixed;
  left: 0; top: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.dlg {
  width: 84%;
  max-width: 420px;
  max-height: 82vh;
  overflow-y: auto;
  background: #FFFFFF;
  border-radius: 14px;
  padding: 18px 16px 14px;
}
.dlg-title { display: block; font-size: 16px; font-weight: 600; color: #1A1A1A; text-align: center; margin-bottom: 12px; }
.dlg-file { display: block; font-size: 11px; color: #1660C6; word-break: break-all; margin-bottom: 8px; }
.dlg-line { display: block; font-size: 12px; color: #555555; line-height: 1.7; margin-bottom: 4px; }
.dlg-warn {
  display: block;
  font-size: 13px;
  color: #D93025;
  background: #FFE8E8;
  border-radius: 8px;
  padding: 8px 10px;
  line-height: 1.6;
  margin-bottom: 10px;
}
.dlg-path {
  display: block;
  font-size: 12px;
  color: #1A1A1A;
  background: #F5F5F7;
  border-radius: 6px;
  padding: 6px 8px;
  margin: 4px 0;
  word-break: break-all;
}
.dlg-sep { height: 1px; background: #EEEEEE; margin: 12px 0; }
.dlg-opt-t { display: block; font-size: 13px; font-weight: 500; color: #1A1A1A; margin-top: 8px; }
.dlg-opt-d { display: block; font-size: 11px; color: #999999; line-height: 1.6; margin-top: 2px; }
.dlg-btns { display: flex; flex-direction: row; gap: 8px; margin-top: 16px; }
.dlg-btn {
  flex: 1;
  height: 40px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dlg-btn text { font-size: 14px; font-weight: 500; }
.dlg-cancel { background: #F0F0F0; }
.dlg-cancel text { color: #666666; }
.dlg-merge { background: #1660C6; }
.dlg-merge text { color: #FFFFFF; }
.dlg-replace { background: #D93025; }
.dlg-replace text { color: #FFFFFF; }
.footer-space { height: 30px; }
</style>
