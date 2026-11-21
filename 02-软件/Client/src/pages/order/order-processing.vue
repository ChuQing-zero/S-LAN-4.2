<template>
  <view class="page-container">
    <!-- 第1块：工具栏 -->
    <view class="toolbar-panel">
      <view class="toolbar">
        <view class="toolbar-left">
          <view class="tool-btn" @tap="goBack">
            <image class="icon-back" src="/static/icons/ic_back.png" mode="aspectFit"></image>
          </view>
        </view>
        <view class="toolbar-center">
          <text class="tool-title">订单处理</text>
        </view>
        <view class="toolbar-right">
          <view class="filter-tag" @tap="onSettings">
            <text class="filter-tag-text">设置</text>
            <image class="icon-xs" src="/static/icons/ic_settings.png" mode="aspectFit"></image>
          </view>
        </view>
      </view>
    </view>

    <!-- 第2块：订单状态切换（固定） -->
    <view class="lib-section">
      <view class="lib-top-row">
        <view class="library-tab">
          <view class="tab-item" v-for="st in statusList" :key="st.key" @tap="switchStatus(st.key)">
            <text :class="{ active: currentStatus === st.key }">{{ st.label }}<text v-if="statusCount(st.key)" class="tab-count">{{ statusCount(st.key) }}</text></text>
            <view v-if="currentStatus === st.key" class="red-line"></view>
          </view>
        </view>
      </view>
    </view>

    <!-- 订单内容区（卡牌列表 + 凑库结果） -->
    <scroll-view class="main-scroll" scroll-y="true" :show-scrollbar="false" @scrolltolower="loadMore">
      <!-- 订单列表视图：当前状态下全部订单框（点击进入详情） -->
      <view class="order-list" v-if="viewMode === 'list'">
        <!-- 搜索框：编号/买家/快递/取件码 -->
        <view class="order-search">
          <text class="search-ico">🔍</text>
          <input class="order-search-input" v-model="searchKeyword" placeholder="搜索 编号 / 买家 / 快递 / 取件码" confirm-type="search" @input="onSearchInput" @confirm="onSearchConfirm" />
          <view class="order-search-clear" v-if="searchKeyword" @tap="onSearchClear"><text class="order-search-clear-x">✕</text></view>
        </view>

        <view class="order-list-item" v-for="(o, i) in filteredOrders" :key="o.orderNo" @tap="onOpenOrder(o)">
          <view class="oli-top">
            <text class="oli-seq">{{ i + 1 }}</text>
            <view class="oli-left">
              <text class="oli-name">{{ o.shortName }}</text>
              <text class="oli-count">共 {{ o.totalCards }} 张</text>
              <text class="oli-miss" v-if="isListMiss(o)">缺货</text>
            </view>
            <view class="oli-right">
              <text class="oli-pickup" v-if="settings.showListCodes && o.pickupCode">{{ o.pickupCode }}</text>
              <text class="oli-status">{{ statusLabel(o.status) }}</text>
            </view>
          </view>
          <view class="oli-main">
            <image class="oli-card-img" :src="orderFirstImg(o)" mode="aspectFill" @error="onOliImgError(o)"></image>
            <view class="oli-info">
              <text class="oli-cards" :class="{ 'oli-cards-empty': !orderCardNameLine(o) }">{{ orderCardNameLine(o) || '此订单内暂无添加卡牌' }}</text>
              <text class="oli-no">订单编号 {{ o.orderNo }}</text>
              <text class="oli-time">交易时间 {{ formatTimeFull(o.tradeTime) }}</text>
              <view class="oli-meta-line" v-if="settings.showListCodes && (o.courierCode || o.pickupCode)">
                <text class="oli-code">快递 {{ o.courierCode || '—' }} · 取件 {{ o.pickupCode || '—' }}</text>
              </view>
              <text class="oli-buyer" v-if="settings.showListBuyer && o.buyerInfo && o.buyerInfo.name">买家 {{ o.buyerInfo.name }}</text>
            </view>
          </view>
        </view>
        <!-- 加载更多 / 已加载全部 -->
        <view class="load-more" v-if="pageInfo.hasMore"><text class="load-more-text">{{ loadingMore ? '加载中…' : '上拉加载更多' }}</text></view>
        <view class="load-more" v-else-if="filteredOrders.length && !searchKeyword"><text class="load-more-text end">— 已加载全部 —</text></view>
        <!-- 创建订单入口（仅待处理 tab，红色大按钮框） -->
        <view class="order-create-box" v-if="currentStatus === 'pending'" @tap="onCreateOrder">
          <text class="order-create-text">创建订单</text>
        </view>
        <view class="op-empty" v-if="!filteredOrders.length">
          <text class="op-empty-text">{{ searchKeyword ? '没有找到匹配的订单' : (currentStatus === 'pending' ? '该状态下暂无订单，点击「创建」新建' : '暂无订单') }}</text>
        </view>
      </view>

      <!-- 订单详情视图（点选订单框后进入） -->
      <template v-else>
      <!-- 通过按钮（绿色大字框，待处理/待拣卡/待发货 显示，已完成隐藏） -->
      <view class="pass-box" v-if="currentOrder && currentOrder.status !== 'done'" @tap="onPassOrder">
        <text class="pass-box-text">通过</text>
      </view>
      <!-- 订单概要 -->
      <view class="order-summary" v-if="currentOrder">
        <view class="summary-row">
          <text class="summary-no">{{ currentOrder.shortName }}</text>
          <text class="summary-status">{{ statusLabel(currentOrder.status) }}</text>
          <text class="back-list" @tap.stop="viewMode = 'list'">← 返回列表</text>
        </view>
        <view class="summary-order-no" @tap="onEditOrder">
          <text>编号 {{ currentOrder.orderNo }}</text>
          <text class="edit-hint">✎ 修改</text>
        </view>
        <text class="summary-time">交易 {{ formatTime(currentOrder.tradeTime) }} · 创建 {{ formatTime(currentOrder.createdAt) }}</text>
        <text class="summary-buyer" v-if="buyerLine">买家: {{ buyerLine }}</text>
        <text class="summary-codes">快递: {{ currentOrder.courierCode || '—' }} · 取件: {{ currentOrder.pickupCode || '—' }}</text>
        <view class="summary-total-row">
          <text class="summary-total">共 {{ currentOrder.totalCards }} 张</text>
          <text class="summary-picked" v-if="isPickingStage && !isPhotoStage">已拣 {{ pickedCount }} 张</text>
          <text class="summary-picked" v-if="isPhotoStage">已拍照 {{ photoCount }} 张</text>
          <text class="summary-seq" v-if="currentSeq">第 {{ currentSeq }} 单</text>
        </view>
        <!-- 拣货清单长图：待拣卡及之后、且有拣货明细才给。
             纯浏览器 Canvas（见 utils/pickSheet.js），App 端没有 document → 只在 H5 出。 -->
        <!-- #ifdef H5 -->
        <view class="summary-actions" v-if="isPickingStage && flatPicks.length">
          <view class="action-btn" @tap="onExportSheet">
            <text class="action-btn-text">🖼 生成清单长图</text>
          </view>
        </view>
        <!-- #endif -->
        <!-- 拍照留痕操作单独一行（拍照阶段；已完成只保留预览） -->
        <view class="photo-actions-row" v-if="isPhotoStage">
          <view class="photo-btn" v-if="!isDoneStage" @tap="onTakePhoto"><text class="photo-btn-text">📷 拍照</text></view>
          <view class="photo-btn photo-btn-ghost" @tap="photoView = !photoView"><text class="photo-btn-text">{{ photoView ? '看卡牌' : '预览' }}</text></view>
        </view>
        <!-- 待拣卡及之后：添加/解析已无用，隐藏 -->
        <view class="summary-actions" v-if="!isPickingStage">
          <view class="action-btn" @tap="onAddCard">
            <text class="action-btn-text">＋ 添加卡牌</text>
          </view>
          <view class="action-btn action-btn-red" @tap="onParseOrder">
            <text class="action-btn-text">凑库解析</text>
          </view>
        </view>
      </view>
      <view class="empty" v-else>
        <text class="empty-text">暂无订单，点击「创建」新建订单</text>
      </view>

      <!-- 卡牌列表：待拣卡及之后 → 每张物理卡一条（卡位 + 编号+罕贵度）；待拣卡可点击切换已拣/待拣，拍照阶段统一白色不可点 -->
      <view class="card-list" v-if="isPickingStage && flatPicks.length && !(isPhotoStage && photoView)">
        <view class="pick-card" :class="{ picked: !isPhotoStage && p.pickStatus === 'picked' }" v-for="(p, i) in flatPicks" :key="p.cardNo + '-' + p.position + '-' + i" @tap="onPickCardTap(p)">
          <image class="card-thumb" :src="p.img" mode="aspectFill" @error="onFlatImgError(p)" @tap.stop="onPreviewFlat(p)"></image>
          <view class="pick-card-info">
            <view class="pick-card-head">
              <text class="pick-card-pos">{{ p.position }}</text>
              <text class="pick-status" :class="p.pickStatus === 'picked' ? 'picked' : 'pending'" v-if="!isPhotoStage">{{ p.pickStatus === 'picked' ? '已拣' : '待拣' }}</text>
            </view>
            <text class="pick-card-code">{{ p.code }} {{ p.rarity || '' }}</text>
          </view>
        </view>
      </view>

      <!-- 拍照留痕照片墙（待发货/已完成 + 预览开启） -->
      <view class="photo-wall" v-if="isPhotoStage && photoView">
        <view class="photo-item" v-for="ph in photos" :key="ph.index">
          <image class="photo-img" :src="ph.src || ph.path" mode="aspectFill" @error="onPhotoImgError(ph)" @tap="onPreviewPhoto(ph)"></image>
          <view class="photo-del" @tap.stop="onDeletePhoto(ph)"><text class="photo-del-text">✕</text></view>
        </view>
        <view class="photo-empty" v-if="!photos.length">
          <text class="photo-empty-text">暂无照片，点击「拍照」留痕</text>
        </view>
      </view>

      <!-- 卡牌列表（待处理）：按订单卡分组的原视图 -->
      <view class="card-list" v-if="!isPickingStage && currentOrder && currentOrder.cards.length">
        <view class="card-item" :class="{ 'card-miss': isCardMiss(card) }" v-for="card in currentOrder.cards" :key="card.cardNo" @tap="onEditCard(card)">
          <!-- 卡图：实拍原图优先，否则按编号现拼的官方图，均无→卡背；点击放大预览 -->
          <image class="card-thumb" :src="卡图(card)" mode="aspectFill" @error="onCardImgError(card)" @tap.stop="onPreviewCardImg(card)"></image>
          <view class="card-info">
            <text class="card-code">{{ card.code }}</text>
            <view class="card-meta">
              <text class="meta-text">{{ card.rarity || '-' }}</text>
              <text class="meta-text">{{ card.condition || '流通品相' }}</text>
              <text class="meta-text">×{{ card.qty }}</text>
              <text class="meta-text" v-if="card.altLabel">异画:{{ card.altLabel }}</text>
              <text class="meta-text" v-if="card.note">{{ card.note }}</text>
            </view>
            <view class="card-picks" v-if="card.picks.length">
              <view class="pick-line" v-for="(p, i) in card.picks" :key="i">
                <text class="pick-lib">{{ p.position || p.libraryCode }}</text>
                <text class="pick-qty">取{{ p.qty }}</text>
                <text class="pick-status" :class="p.pickStatus === 'picked' ? 'picked' : 'pending'">{{ p.pickStatus === 'picked' ? '已拣' : '待拣' }}</text>
              </view>
              <!-- 部分匹配仍缺货：在拣货行下方标注缺几张 -->
              <view class="pick-line" v-if="isCardMiss(card)">
                <text class="pick-status miss">缺货 缺{{ card.missing }}张</text>
              </view>
            </view>
            <view class="card-short" v-else>
              <text class="pick-status pending">{{ isCardMiss(card) ? '缺货 缺' + (card.missing || card.qty) + '张' : '未凑库' }}</text>
            </view>
          </view>
          <view class="card-del-btn" @tap.stop="onDeleteCard(card)"><text class="del-char">✕</text></view>
        </view>
      </view>

      <!-- 底部添加卡牌按钮（仅待处理显示，待拣卡后隐藏） -->
      <view class="add-card-bottom" v-if="currentOrder && !isPickingStage" @tap="onAddCard">
        <text class="add-card-bottom-text">＋ 添加卡牌</text>
      </view>
      </template>
    </scroll-view>

    <!-- 通过确认弹窗（统一样式同创建订单，居中白底） -->
    <view v-if="passVisible" class="edit-overlay" @tap="passVisible = false">
      <view class="edit-box" @tap.stop>
        <text class="edit-title">订单通过</text>
        <view class="confirm-body">
          <text class="confirm-text">订单 {{ currentOrder?.shortName }} 将通过，进入【{{ nextStatusLabel }}】？</text>
          <text class="confirm-text confirm-warn" v-if="isToPicking">将删除凑库匹配的 {{ passPickCount }} 张库存卡并压缩卡位，删除后不可恢复！</text>
          <text class="confirm-text confirm-op">使用此账号作为记录：{{ operatorName }}（{{ operatorId }}）</text>
        </view>
        <view class="edit-btns" style="margin-top:20px">
          <view class="edit-btn-cancel" @tap="passVisible = false"><text class="edit-btn-text">取消</text></view>
          <view class="edit-btn-save" @tap="confirmPass"><text class="edit-btn-text edit-btn-text-w">确认通过</text></view>
        </view>
      </view>
    </view>

    <!-- 添加卡牌弹窗 -->
    <view v-if="addVisible" class="edit-overlay" @tap="addVisible = false">
      <view class="edit-box" @tap.stop>
        <text class="edit-title">添加卡牌</text>
        <view class="add-form">
          <input class="add-input" v-model="addForm.code" placeholder="卡牌编号 如 QCAC-JP019(初版)" />
          <view class="add-row">
            <picker class="add-input-half add-picker" :range="rarityOptions" @change="onRarityChange(addForm, $event)">
              <text class="picker-label">罕贵度</text>
              <text class="picker-value">{{ addForm.rarity }}</text>
              <text class="picker-arrow">▾</text>
            </picker>
            <input class="add-input-half" v-model="addForm.qty" type="number" placeholder="数量" />
          </view>
          <picker :range="conditionOptions" @change="onConditionChange(addForm, $event)">
            <view class="add-input add-picker">
              <text class="picker-label">品相</text>
              <text class="picker-value">{{ addForm.condition }}</text>
              <text class="picker-arrow">▾</text>
            </view>
          </picker>
          <picker :range="gradeOptions" @change="onGradeChange(addForm, $event)">
            <view class="add-input add-picker">
              <text class="picker-label">备注</text>
              <text class="picker-value">{{ addForm.note }}</text>
              <text class="picker-arrow">▾</text>
            </view>
          </picker>
        </view>
        <view class="edit-btns" style="margin-top:18px">
          <view class="edit-btn-cancel" @tap="addVisible = false"><text class="edit-btn-text">取消</text></view>
          <view class="edit-btn-save" @tap="confirmAdd"><text class="edit-btn-text edit-btn-text-w">添加</text></view>
        </view>
      </view>
    </view>

    <!-- 创建订单弹窗（手工输入订单编号 + 买家信息一行 + 可选备注） -->
    <view v-if="createVisible" class="edit-overlay" @tap="createVisible = false">
      <view class="edit-box" @tap.stop>
        <text class="edit-title">创建订单</text>
        <view class="add-form">
          <input class="add-input" v-model="createForm.orderNo" placeholder="订单编号 如 202608132359590001" />
          <input class="add-input" v-model="createForm.buyerText" placeholder="买家信息 如 张先生 13999953090 新疆乌鲁木齐迎宾路158号" />
          <input class="add-input" v-model="createForm.note" placeholder="备注（可选）" />
          <view class="add-row">
            <input class="add-input-half" v-model="createForm.courierCode" placeholder="快递码（可选）" />
            <input class="add-input-half" v-model="createForm.pickupCode" placeholder="取件码（可选）" />
          </view>
        </view>
        <view class="edit-btns" style="margin-top:18px">
          <view class="edit-btn-cancel" @tap="createVisible = false"><text class="edit-btn-text">取消</text></view>
          <view class="edit-btn-save" @tap="confirmCreate"><text class="edit-btn-text edit-btn-text-w">确定创建</text></view>
        </view>
      </view>
    </view>

    <!-- 编辑订单弹窗（改编号 + 买家信息一行 + 可选备注） -->
    <view v-if="editOrderVisible" class="edit-overlay" @tap="editOrderVisible = false">
      <view class="edit-box" @tap.stop>
        <view class="edit-title-row">
          <text class="edit-title">编辑订单</text>
          <text class="edit-del-order" @tap.stop="onDeleteOrder">删除订单</text>
        </view>
        <view class="add-form">
          <input class="add-input" :class="{ 'add-input-disabled': editOrderNoLocked }" v-model="editOrderForm.orderNo" placeholder="订单编号 如 202608132359590001" :disabled="editOrderNoLocked" />
          <text class="edit-order-lock-hint" v-if="editOrderNoLocked">已进入拣卡阶段，订单编号不可修改</text>
          <input class="add-input" v-model="editOrderForm.buyerText" placeholder="买家信息 如 张先生 13999953090 新疆乌鲁木齐迎宾路158号" />
          <input class="add-input" v-model="editOrderForm.note" placeholder="备注（可选）" />
          <view class="add-row">
            <input class="add-input-half" v-model="editOrderForm.courierCode" placeholder="快递码（待发货前必填）" />
            <input class="add-input-half" v-model="editOrderForm.pickupCode" placeholder="取件码（待发货前必填）" />
          </view>
        </view>
        <!-- 通过记录（只读展示，不可修改） -->
        <view class="pass-history" v-if="passHistoryList.length">
          <text class="pass-history-title">通过记录（只读）</text>
          <view class="pass-history-item" v-for="(h, i) in passHistoryList" :key="i">
            <text class="ph-stage">{{ h.stage }}</text>
            <text class="ph-op">{{ h.op }}</text>
            <text class="ph-time">{{ h.time }}</text>
          </view>
        </view>
        <view class="edit-btns" style="margin-top:18px">
          <view class="edit-btn-cancel" @tap="editOrderVisible = false"><text class="edit-btn-text">取消</text></view>
          <view class="edit-btn-save" @tap="confirmEditOrder"><text class="edit-btn-text edit-btn-text-w">保存</text></view>
        </view>
      </view>
    </view>

    <!-- 编辑卡牌弹窗（改 code/rarity/qty/note） -->
    <view v-if="editCardVisible" class="edit-overlay" @tap="editCardVisible = false">
      <view class="edit-box" @tap.stop>
        <text class="edit-title">编辑卡牌</text>
        <view class="add-form">
          <input class="add-input" v-model="editCardForm.code" placeholder="卡牌编号 如 QCAC-JP019(初版)" />
          <view class="add-row">
            <picker class="add-input-half add-picker" :range="rarityOptions" @change="onRarityChange(editCardForm, $event)">
              <text class="picker-label">罕贵度</text>
              <text class="picker-value">{{ editCardForm.rarity }}</text>
              <text class="picker-arrow">▾</text>
            </picker>
            <input class="add-input-half" v-model="editCardForm.qty" type="number" placeholder="数量" />
          </view>
          <picker :range="conditionOptions" @change="onConditionChange(editCardForm, $event)">
            <view class="add-input add-picker">
              <text class="picker-label">品相</text>
              <text class="picker-value">{{ editCardForm.condition }}</text>
              <text class="picker-arrow">▾</text>
            </view>
          </picker>
          <picker :range="gradeOptions" @change="onGradeChange(editCardForm, $event)">
            <view class="add-input add-picker">
              <text class="picker-label">备注</text>
              <text class="picker-value">{{ editCardForm.note }}</text>
              <text class="picker-arrow">▾</text>
            </view>
          </picker>
        </view>
        <view class="edit-btns" style="margin-top:18px">
          <view class="edit-btn-cancel" @tap="editCardVisible = false"><text class="edit-btn-text">取消</text></view>
          <view class="edit-btn-save" @tap="confirmEditCard"><text class="edit-btn-text edit-btn-text-w">保存</text></view>
        </view>
      </view>
    </view>

    <!-- 设置弹窗（列表显示开关 + 排序） -->
    <view v-if="settingsVisible" class="edit-overlay" @tap="settingsVisible = false">
      <view class="edit-box" @tap.stop>
        <text class="edit-title">设置</text>
        <view class="settings-list">
          <view class="setting-row" @tap="toggleSetting('showListCodes')">
            <text class="setting-label">列表显示快递/取件码</text>
            <view class="setting-switch" :class="{ on: settings.showListCodes }"><view class="setting-switch-dot"></view></view>
          </view>
          <view class="setting-row" @tap="toggleSetting('showListBuyer')">
            <text class="setting-label">列表显示买家</text>
            <view class="setting-switch" :class="{ on: settings.showListBuyer }"><view class="setting-switch-dot"></view></view>
          </view>
          <view class="setting-row">
            <text class="setting-label">列表排序</text>
            <view class="setting-seg">
              <view class="seg-item" :class="{ on: settings.sortBy === 'pass' }" @tap="setSort('pass')"><text class="seg-item-text">进入时间</text></view>
              <view class="seg-item" :class="{ on: settings.sortBy === 'created' }" @tap="setSort('created')"><text class="seg-item-text">创建时间</text></view>
            </view>
          </view>
        </view>
        <view class="edit-btns" style="margin-top:18px">
          <view class="edit-btn-save" @tap="settingsVisible = false"><text class="edit-btn-text edit-btn-text-w">知道了</text></view>
        </view>
      </view>
    </view>

    <!-- 统一弹窗（样式同创建订单弹窗，替代原生 uni.showModal 适配差的问题） -->
    <view v-if="dialog" class="edit-overlay" @tap="dialog = null">
      <view class="edit-box" @tap.stop>
        <text class="edit-title">{{ dialog.title }}</text>
        <view class="confirm-body">
          <text class="confirm-text">{{ dialog.message }}</text>
        </view>
        <view class="edit-btns" style="margin-top:20px">
          <view class="edit-btn-cancel" v-if="!dialog.single" @tap="dialog = null"><text class="edit-btn-text">{{ dialog.cancelText }}</text></view>
          <view class="edit-btn-save" @tap="onDialogConfirm"><text class="edit-btn-text edit-btn-text-w">{{ dialog.confirmText }}</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import {
  createOrder, updateOrder, deleteOrder, getOrders, getOrderDetail,
  addOrderCards, deleteOrderCard, updateOrderCard, parseOrder, passOrder,
  updateOrderPick, getOrderPhotos, saveOrderPhoto, deleteOrderPhoto,
  getRarities
} from '@/api/index.js'
import { 拉目录, 查异画号, buildCardImgUrl, CARD_BACK } from '@/api/cardDb.js'
// #ifdef H5
// 清单长图是纯浏览器 Canvas（document / toBlob / <a download>），App 端跑不了 —— 连 import 都别带进去
import { 导出拣货清单长图 } from '@/utils/pickSheet.js'
// #endif

// 订单状态定义（待处理 tab 涵盖后端 ''(空) 与 pending）
const statusList = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待处理' },
  { key: 'picking', label: '待拣卡' },
  { key: 'shipping', label: '待发货' },
  { key: 'done', label: '已完成' }
]
// 后端 status: ''(空) / pending / picking / shipping / done — 统一显示
const statusLabel = (k) => {
  const map = { '': '待处理', pending: '待处理', picking: '待拣卡', shipping: '待发货', done: '已完成' }
  return map[k] || k
}

// 状态流转顺序（待处理(''/pending)→待拣卡一步到位→shipping→done）
const passFlow = { '': 'picking', pending: 'picking', picking: 'shipping', shipping: 'done', done: 'done' }

const currentStatus = ref(uni.getStorageSync('orderCurrentStatus') || 'pending')  // 当前选中的状态 tab（刷新恢复）
const orders = ref([])            // 当前状态已加载的订单（分页累加）
const currentOrderNo = ref(uni.getStorageSync('orderCurrentNo') || '')  // 当前选中订单号（刷新恢复）
const currentOrder = ref(null)    // 当前订单详情
const loading = ref(false)
const loadingMore = ref(false)    // 加载更多中
const viewMode = ref('list')      // 视图：list=订单列表（默认） / detail=订单详情
const searchKeyword = ref('')     // 搜索关键字
const pageInfo = ref({ page: 1, pageSize: 20, total: 0, hasMore: false })  // 分页信息
const counts = ref({})            // 各状态订单数量（来自服务端，tab 角标）
const totalCount = ref(0)         // 全部订单数
const editOrderNoLocked = ref(false) // 拣卡后订单编号锁定

// 订单设置（列表显示开关 + 排序），持久化到本地
const settings = ref({ showListCodes: true, showListBuyer: true, sortBy: 'pass' })
try {
  const storedSettings = uni.getStorageSync('orderSettings')
  if (storedSettings && typeof storedSettings === 'object') {
    settings.value = { ...settings.value, ...storedSettings }
  }
} catch (e) { /* 忽略损坏的本地设置 */ }
const saveSettings = () => { uni.setStorageSync('orderSettings', settings.value) }
const toggleSetting = (key) => {
  settings.value[key] = !settings.value[key]
  saveSettings()
  loadOrders(true)
}
const setSort = (k) => {
  settings.value.sortBy = k
  saveSettings()
  loadOrders(true)
}

const passVisible = ref(false)

// 当前登录账号（通过弹窗显示"使用此账号作为记录"）
const operatorName = computed(() => (uni.getStorageSync('user') || {}).nickname || '未知账号')
const operatorId = computed(() => (uni.getStorageSync('user') || {}).id || '')

const addVisible = ref(false)
const settingsVisible = ref(false)
// 品相三档（与识别上传一致），默认流通品相
const conditionOptions = ['流通品相', '有瑕疵', '有损伤']
const onConditionChange = (form, e) => { form.condition = conditionOptions[Number(e.detail.value)] }

// 罕贵度下拉（参考识别上传 ParamsPicker）：优先后端配置的罕贵度列表，失败用内置 YGO 列表
const RARITY_FALLBACK = ['20SER','QCSER','PSER','HR','HPR','ESR','ESPR','SER','SEMR','SEPR','PR','UPR','PGR','GSER','GMR','GR','UTR','CR','UR','RR','USR','UMR','SR','SPR','NPR','NMR','NKC','R','RKC','RPR','N','NR']
const rarityOptions = ref([...RARITY_FALLBACK])
const DEFAULT_RARITY = 'N'  // 罕贵度默认 N
getRarities().then(d => { if (d && d.list && d.list.length) rarityOptions.value = d.list }).catch(() => {})
const onRarityChange = (form, e) => { form.rarity = rarityOptions.value[Number(e.detail.value)] }

// 备注（品级）下拉 5 档（参考识别上传），默认 78品
const gradeOptions = ['99品', '9品', '78品', '56品', '34品']
const DEFAULT_GRADE = '78品'
const onGradeChange = (form, e) => { form.note = gradeOptions[Number(e.detail.value)] }

const addForm = ref({ code: '', rarity: DEFAULT_RARITY, qty: '1', condition: '流通品相', note: DEFAULT_GRADE })

// 统一弹窗（样式同创建订单弹窗，替代原生 uni.showModal，解决手机适配差）
const dialog = ref(null)   // { title, message, single, confirmText, cancelText, onConfirm }
const openDialog = (opt) => {
  dialog.value = {
    title: opt.title || '',
    message: opt.message || '',
    single: !!opt.single,                              // true 只显示一个按钮（知道了）
    confirmText: opt.confirmText || (opt.single ? '知道了' : '确定'),
    cancelText: opt.cancelText || '取消',
    onConfirm: opt.onConfirm || (() => {}),
  }
}
const onDialogConfirm = () => {
  const fn = dialog.value && dialog.value.onConfirm
  dialog.value = null
  if (fn) fn()
}

// 创建订单弹窗（手工输入订单编号 + 买家信息一行 + 可选备注）
const createVisible = ref(false)
const createForm = ref({ orderNo: '', buyerText: '', note: '', courierCode: '', pickupCode: '' })
// 编辑订单弹窗（改编号 + 买家信息）
const editOrderVisible = ref(false)
const editOrderForm = ref({ orderNo: '', buyerText: '', note: '', courierCode: '', pickupCode: '' })
// 编辑卡牌弹窗（改 code/rarity/qty/note）
const editCardVisible = ref(false)
const editCardForm = ref({ code: '', rarity: DEFAULT_RARITY, qty: '1', condition: '流通品相', note: DEFAULT_GRADE })
const editCardNo = ref('')

// 未解析时的卡背占位图
const cardBackImg = CARD_BACK

// ===== 卡图：实拍原图 > 目录现拼的官方图 > 卡背 =====
//
// 为什么要有「目录现拼」这一层（V1.2.86）：订单卡上的 `img` 一直是空的。
// 它是凑库时从**库存卡**上抄来的，而库存卡的 `Card.img` 在建卡时就被硬编码成 `''`
// （`routes/cards/index.js`），清库前 38,767 张填充率 0.00%；`Card.extCode` 也只有 0.11%。
// 两条腿都是空的 → 整页恒卡背，跟数据无关。
//
// 真实卡图不在库里，是磁盘上 `images\OCG\{包}\{编号}-{罕贵}.jpg`，按编号+罕贵走精准模式取，
// 拼 URL 需要一个**合法卡密**过门（路径穿越防线，空串 400），而卡密是**目录**的属性。
// 所以按编号问目录、现拼、**不落库** —— 存下来就会过期（同一编号的卡密会随目录更新）。
//
// 注意**不看 `matched`**：目录图只认编号+罕贵，跟这张卡凑没凑到库存无关。
// 「未凑库」的淡红底与角标照旧，只是底下从卡背换成真卡图。
const 回填卡图 = async (卡们) => {
  const 有编号 = 卡们.filter(c => c && c.parsedCode)
  if (!有编号.length) return
  const 表 = await 拉目录(有编号.map(c => c.parsedCode))
  for (const c of 有编号) {
    const 目录 = 表[c.parsedCode] || {}
    // 异画：订单卡上只有标签（「初版」），拿它去目录反查异画号；查不到、或图源里压根没有
    // 异画文件，都是 0（原画）—— 见 cardDb.js 里那段说明，给错号的后果比不给还差。
    const altIndex = 查异画号(目录, c.rarity, c.altLabel)
    // buildCardImgUrl 自带 `if (!password) return ''` —— 目录里查不到的编号就留空，落回卡背
    c.catImg = buildCardImgUrl({
      password: 目录.extCode || '',
      code: c.parsedCode,
      rarity: c.rarity,
      altRarity: 目录.altRarity,
      altIndex,
    })
  }
}

// 卡图加载失败 → 回退到卡背。
// 置标志位而不是清数据：`card.img` 本来就是死的，清它等于第一次失败就直接跳卡背，
// 把下面那张目录图也一起丢了。origImg（实拍原图）仍按老规矩单独清。
const onCardImgError = (card) => {
  if (card.origImg) card.origImg = ''
  else card.imgFallback = true
}

// 渲染侧统一口径：三处都用它，别再各写一遍 `||`
const 卡图 = (c) => c.origImg || (c.imgFallback ? '' : c.catImg) || cardBackImg

// 解析后仍未匹配到库存的卡 → 卡行淡红底 + 角标"缺货"（未解析时不算缺货）
const isCardMiss = (card) => {
  return !!currentOrder.value && currentOrder.value.parsed && card.matched === false
}

// 点击卡图放大预览（类似小弹窗，可双指缩放）
const onPreviewCardImg = (card) => {
  const src = 卡图(card)
  uni.previewImage({ urls: [src], current: src })
}

// 当前状态下的订单列表（服务端已按状态过滤 + 分页排序，直接透传）
const filteredOrders = computed(() => orders.value)

// 当前订单在所属状态列表里的序号（1 起，不在已加载列表则为 0）
const currentSeq = computed(() => {
  const o = currentOrder.value
  if (!o) return 0
  const i = filteredOrders.value.findIndex(x => x.orderNo === o.orderNo)
  return i >= 0 ? i + 1 : 0
})

// 各状态订单数量（供 tab 角标；来自服务端 counts 聚合，不随搜索/分页变化）
const statusCount = (key) => {
  if (key === 'all') return totalCount.value
  if (key === 'pending') return (counts.value[''] || 0) + (counts.value['pending'] || 0)
  return counts.value[key] || 0
}

// 加载订单列表（分页）：reset=true 回到第 1 页重新拉，否则追加下一页
let listReqSeq = 0  // 请求序号：快速切tab/搜索/加载更多时，只接受最新一次请求的结果，丢弃过期响应
const loadOrders = async (reset = true) => {
  const seq = ++listReqSeq
  if (reset) {
    orders.value = []
    pageInfo.value = { page: 1, pageSize: 20, total: 0, hasMore: false }
  }
  loading.value = true
  try {
    const data = await getOrders({
      status: currentStatus.value,
      page: pageInfo.value.page,
      pageSize: pageInfo.value.pageSize,
      keyword: searchKeyword.value.trim(),
      sort: settings.value.sortBy,
    })
    if (seq !== listReqSeq) return  // 已有更新的请求，本次结果过期，丢弃
    const list = data.list || []
    orders.value = reset ? list : orders.value.concat(list)
    // 订单框的第一张卡图同样得现拼（列表接口的 `cardList[].img` 也是那个死字段）。
    // 不 await：它只是就地往对象上挂 `catImg`，挂上了页面自己会重渲染，别为它拖住 loading。
    //
    // ★ 必须从 `orders.value`（响应式代理）上取，不能用上面那个 `list` 原始数组：
    //   列表这一屏**已经渲染过了**，往 raw 对象上写 `catImg` 绕过了 Proxy 的 set 陷阱，
    //   不会通知渲染副作用，页面就一直是卡背。
    //   （详情屏 `loadOrderDetail` 走的是另一条更干净的写法：**先挂图再整体赋值**，
    //     连过渡的一帧卡背都没有；这里是因为 concat 追加、已在屏上的老订单不能重建才用代理写。）
    回填卡图(orders.value.flatMap(o => o.cardList || []))
    pageInfo.value = { page: data.page || 1, pageSize: data.pageSize || 20, total: data.total || 0, hasMore: !!data.hasMore }
    counts.value = data.counts || {}
    totalCount.value = data.totalCount || 0
  } catch (e) {
    // 已 toast
  } finally {
    if (seq === listReqSeq) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

// 滚动到底加载更多（仅列表视图）
const loadMore = () => {
  if (viewMode.value !== 'list') return
  if (loading.value || loadingMore.value || !pageInfo.value.hasMore) return
  loadingMore.value = true
  pageInfo.value.page += 1
  loadOrders(false)
}

// 搜索（输入防抖 400ms）
let searchTimer = null
const onSearchInput = () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { loadOrders(true) }, 400)
}
const onSearchConfirm = () => { loadOrders(true) }
const onSearchClear = () => {
  searchKeyword.value = ''
  loadOrders(true)
}

// 列表缺货角标：待处理订单已凑库解析但未全部匹配
const isListMiss = (o) => {
  return (o.status === '' || o.status === 'pending') && !!o.parsed && !o.allPicked
}

// 加载订单详情（fresh=true: 重新进入 → 后端清空旧凑库结果，需重新解析）
const loadOrderDetail = async (orderNo, fresh = false) => {
  try {
    const data = await getOrderDetail(orderNo, fresh)
    // ★ 顺序要紧：**先**把 `catImg` 挂到原始对象上，**再**整体赋给 `currentOrder.value`。
    //
    //   反过来（先赋值、后回填）会闪一帧卡背、而且那一帧会**永久停住**：赋值当场触发一次渲染，
    //   那一刻 `catImg` 还没挂上（`拉目录` 是异步的），只能画卡背；随后往原始对象上写 `catImg`
    //   绕过了 Proxy 的 set 陷阱、不通知渲染副作用，页面就再也不会重画了。
    //   之前 `selectOrder` 侥幸正常，只是因为它是 `await` 完才切 `viewMode`（等于渲染前就挂好了）；
    //   而**人已经在详情屏里**重载的路径（凑库解析、改卡、换品相、通过/撤回…）没这层遮挡 ——
    //   这就是「点凑库解析图变卡背」「刷新一下图才出来」的根因。
    //   挂完再赋值，第一次渲染就带着图，没有中间态（同 inventory.vue「拼好整对象再赋值」）。
    //   `拉目录` 内部失败只跳过该批、不抛（见 cardDb.js），不会把详情一起拖住。
    await 回填卡图(data.cards || [])
    currentOrder.value = data
    currentOrderNo.value = data.orderNo
  } catch (e) { /* 已 toast */ }
}

// 选择订单（进入详情视图）→ 不清凑库结果（卡牌没变就保留；变了后端已失效，需重新凑库解析）
const selectOrder = async (orderNo) => {
  uni.setStorageSync('orderCurrentNo', orderNo)
  await loadOrderDetail(orderNo, false)
  photoView.value = false
  loadPhotos(orderNo)
  viewMode.value = 'detail'
}

// 订单列表框点击 → 打开该订单详情
const onOpenOrder = (o) => {
  selectOrder(o.orderNo)
}

const nextStatusLabel = computed(() => {
  if (!currentOrder.value) return ''
  return statusLabel(passFlow[currentOrder.value.status])
})

// 当前订单是否处于"待处理→待拣卡"的通过（会触发删除库存+压缩卡位）
const isToPicking = computed(() => {
  const o = currentOrder.value
  return !!o && (o.status === '' || o.status === 'pending')
})

// 本订单凑库匹配的库存卡数（通过将删除出库）
const passPickCount = computed(() => {
  if (!currentOrder.value) return 0
  return (currentOrder.value.cards || []).reduce((s, c) => s + (c.picks ? c.picks.length : 0), 0)
})

// 通过记录（只读展示，来自 passPicked/passShipping/passDone）
const passHistoryList = computed(() => {
  const o = currentOrder.value
  if (!o) return []
  const stages = [
    { key: 'passPicked', label: '待处理→待拣卡' },
    { key: 'passShipping', label: '待拣卡→待发货' },
    { key: 'passDone', label: '待发货→已完成' },
  ]
  const out = []
  for (const s of stages) {
    const rec = o[s.key]
    if (rec && (rec.userId || rec.nickname)) {
      out.push({
        stage: s.label,
        op: `${rec.nickname || '未知'}（${rec.userId || '—'}）`,
        time: rec.at ? formatTime(rec.at) : '—',
      })
    }
  }
  return out
})

// 是否已进入待拣卡及之后（picking/shipping/done）→ 卡牌列表按"每个单卡一条"展示
const isPickingStage = computed(() => {
  const o = currentOrder.value
  return !!o && o.status !== '' && o.status !== 'pending'
})

// 拍照留痕阶段（待发货/已完成）→ 卡牌统一白色不可点击，显示已拍照 + 拍照/预览按钮
const isPhotoStage = computed(() => {
  const o = currentOrder.value
  return !!o && (o.status === 'shipping' || o.status === 'done')
})

// 已完成阶段 → 只读预览，不再允许拍照
const isDoneStage = computed(() => {
  const o = currentOrder.value
  return !!o && o.status === 'done'
})

// 拍照留痕
const photos = ref([])       // 当前订单照片列表
const photoView = ref(false) // 是否切换到照片墙（true=照片 / false=卡牌）
// 已拍照张数：优先取订单库持久化的 photoCount（刷新不丢），内存照片数组作后备
const photoCount = computed(() => {
  const pc = currentOrder.value && currentOrder.value.photoCount
  return pc != null ? pc : photos.value.length
})

// 给照片文件流 URL 附加 token（<image> 只能带 query；后端 /photos/:index/file 鉴权接受 ?token=）
const withToken = (url) => {
  if (!url || url.includes('?token=')) return url
  const token = uni.getStorageSync('token')
  if (!token) return url
  return url + (url.includes('?') ? '&' : '?') + 'token=' + token
}

const loadPhotos = async (orderNo) => {
  if (!orderNo) { photos.value = []; return }
  try {
    const data = await getOrderPhotos(orderNo)
    photos.value = (data.list || []).map(p => ({ ...p, src: withToken(p.src) }))
  } catch (e) { photos.value = [] }
}

// 照片图加载失败 → 置空显示空白（静态 /uploads 已不对 order-photos 开放）
const onPhotoImgError = (ph) => { if (ph.src) ph.src = '' }

// 拍照 → 相机/相册 → 压缩上传
const onTakePhoto = () => {
  const o = currentOrder.value
  if (!o) return
  uni.chooseImage({
    count: 1,
    sourceType: ['camera', 'album'],
    success: async (res) => {
      const paths = res.tempFilePaths || []
      if (!paths.length) return
      uni.showLoading({ title: '上传中...' })
      for (const p of paths) {
        const res = await saveOrderPhoto(o.orderNo, p)
        if (res && res.photoCount != null && currentOrder.value) currentOrder.value.photoCount = res.photoCount
      }
      uni.hideLoading()
      await loadPhotos(o.orderNo)
      uni.showToast({ title: '已拍照', icon: 'success' })
    }
  })
}

// 删除单张照片（删库记录+删文件）
const onDeletePhoto = (ph) => {
  const o = currentOrder.value
  if (!o) return
  openDialog({
    title: '删除照片',
    message: '确定删除这张拍照留痕？',
    confirmText: '删除',
    onConfirm: async () => {
      const res = await deleteOrderPhoto(o.orderNo, ph.index)
      if (res && res.photoCount != null && currentOrder.value) currentOrder.value.photoCount = res.photoCount
      await loadPhotos(o.orderNo)
      uni.showToast({ title: '已删除', icon: 'success' })
    }
  })
}

const onPreviewPhoto = (ph) => {
  const urls = photos.value.map(x => x.src || x.path)
  uni.previewImage({ urls, current: ph.src || ph.path })
}

// 扁平化：每张物理卡(pick)一条，带上卡图与完整编号（父级订单卡）
const flatPicks = computed(() => {
  if (!currentOrder.value) return []
  const out = []
  for (const c of currentOrder.value.cards || []) {
    for (const p of c.picks || []) {
      out.push({
        ...p,
        code: c.code,                                // 完整编号（含异画括号）
        源卡: c,                                     // 图是挂在父级订单卡上的（同一张卡的所有 pick 共用一张图）
        img: 卡图(c),
        cardNo: c.cardNo,
      })
    }
  }
  // 按卡位排序：库编号(A0-000-XX)优先，段内卡位递增，逐段数值比较
  const posKey = (pos) => (pos || '').split('-').map(s => {
    const n = parseInt(s, 10)
    return isNaN(n) ? s : String(n).padStart(12, '0')
  }).join('-')
  out.sort((a, b) => (posKey(a.position) < posKey(b.position) ? -1 : posKey(a.position) > posKey(b.position) ? 1 : 0))
  return out
})

// 已拣张数（统计拣货清单 pickStatus==='picked' 的数量）
const pickedCount = computed(() => {
  if (!currentOrder.value) return 0
  let n = 0
  for (const c of currentOrder.value.cards || []) {
    for (const p of c.picks || []) {
      if (p.pickStatus === 'picked') n++
    }
  }
  return n
})

// 扁平卡图加载失败 → 回退卡背。
// 标志位写到**源卡**上，不写 p.img：flatPicks 是 computed，p.img 会被下一次重算覆盖，
// 写源卡才会让 `卡图(c)` 真的返回卡背，而且不会反复重发那张挂掉的图。
const onFlatImgError = (p) => {
  if (p.源卡) p.源卡.imgFallback = true
  else p.img = cardBackImg
}

// 点击单卡：拍照阶段(待发货/已完成)不可切换，仅待拣卡可切换已拣/待拣
const onPickCardTap = (p) => {
  if (isPhotoStage.value) return
  onTogglePick(p)
}

// 点击单卡 → 切换 已拣/待拣（白↔淡绿），状态写入数据库，刷新后保持
const onTogglePick = async (p) => {
  const next = p.pickStatus === 'picked' ? 'pending' : 'picked'
  // 同步到源数据（currentOrder.cards 里的 pick），flatPicks 由其计算自动刷新
  const src = (currentOrder.value.cards || []).flatMap(c => c.picks || []).find(x => x.cardNo === p.cardNo && x.position === p.position)
  if (src) src.pickStatus = next
  else p.pickStatus = next
  try {
    await updateOrderPick(currentOrder.value.orderNo, p._id, next)
  } catch (e) {
    const rollback = next === 'picked' ? 'pending' : 'picked'
    if (src) src.pickStatus = rollback
    else p.pickStatus = rollback
  }
}
// 点击扁平卡图放大预览
const onPreviewFlat = (p) => uni.previewImage({ urls: [p.img], current: p.img })

const formatTime = (t) => {
  if (!t) return ''
  const d = new Date(t)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 带秒的交易时间（订单列表视图 第2行第3行）
const formatTimeFull = (t) => {
  if (!t) return ''
  const d = new Date(t)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// ===== 订单列表视图 订单框辅助 =====
// 第一张卡图（原图优先→目录现拼的官方图→卡背）；图加载失败 → 永久卡背
const onOliImgError = (o) => { o.imgFallback = true }
const orderFirstImg = (o) => {
  if (o.imgFallback) return cardBackImg
  const c = (o.cardList || [])[0]
  return c ? 卡图(c) : cardBackImg
}
// 卡名行：每张卡 "中文名 ×数量"，拼一行，无中文名的卡跳过（空则整行留白，超长由 CSS 省略号截断）
const orderCardNameLine = (o) => {
  const parts = (o.cardList || []).map(c => {
    const name = (c.cnName || '').trim()
    return name ? `${name} ×${c.qty}` : ''
  }).filter(Boolean)
  return parts.join('  ')
}

// 买家信息合并显示（姓名 电话 地址）
const buyerLine = computed(() => {
  const b = currentOrder.value?.buyerInfo
  if (!b) return ''
  return [b.name, b.phone, b.address].filter(v => v && String(v).trim()).join(' ')
})

// 创建订单：弹出弹窗手工输入订单编号 + 买家信息
const onCreateOrder = () => {
  createForm.value = { orderNo: '', buyerText: '', note: '', courierCode: '', pickupCode: '' }
  createVisible.value = true
}

const confirmCreate = async () => {
  const f = createForm.value
  if (!f.orderNo.trim()) {
    uni.showToast({ title: '请输入订单编号', icon: 'none' })
    return
  }
  createVisible.value = false
  try {
    uni.showLoading({ title: '创建中...' })
    const order = await createOrder({
      orderNo: f.orderNo.trim(),
      buyerInfo: f.buyerText.trim(),
      note: f.note.trim(),
      courierCode: f.courierCode.trim(),
      pickupCode: f.pickupCode.trim()
    })
    uni.hideLoading()
    currentStatus.value = 'pending'  // 新单状态为空，归入待处理 tab
    uni.setStorageSync('orderCurrentStatus', 'pending')
    await loadOrders()
    await selectOrder(order.orderNo)  // 直接进入新订单详情
    uni.showToast({ title: '已创建 ' + order.shortName, icon: 'success' })
  } catch (e) {
    uni.hideLoading()
  }
}

// 编辑订单（订单编号 + 买家信息一行）— 点击订单概要的编号触发；拣卡后编号锁定
const onEditOrder = () => {
  const o = currentOrder.value
  if (!o) return
  const b = o.buyerInfo || {}
  editOrderNoLocked.value = isPickingStage.value
  editOrderForm.value = {
    orderNo: o.orderNo,
    buyerText: [b.name, b.phone, b.address].filter(v => v && String(v).trim()).join(' '),
    note: b.note || '',
    courierCode: o.courierCode || '',
    pickupCode: o.pickupCode || ''
  }
  editOrderVisible.value = true
}

const confirmEditOrder = async () => {
  const f = editOrderForm.value
  if (!f.orderNo.trim()) {
    uni.showToast({ title: '请输入订单编号', icon: 'none' })
    return
  }
  const oldNo = currentOrder.value.orderNo
  editOrderVisible.value = false
  try {
    const order = await updateOrder(oldNo, {
      orderNo: f.orderNo.trim(),
      buyerInfo: f.buyerText.trim(),
      note: f.note.trim(),
      courierCode: f.courierCode.trim(),
      pickupCode: f.pickupCode.trim()
    })
    // 编号变了：切到新编号；无论是否改号都刷新详情（新编号/买家/快递信息），
    // 避免后续加卡/凑库/通过/拍照仍用旧编号（修复 404）
    if (order.orderNo !== oldNo) {
      currentOrderNo.value = order.orderNo
      uni.setStorageSync('orderCurrentNo', order.orderNo)
    }
    await loadOrderDetail(order.orderNo, false)
    await loadOrders()
    uni.showToast({ title: '已保存', icon: 'success' })
  } catch (e) { /* 已 toast */ }
}

// 删除订单（连同卡牌、拣货清单全部清空，弹小窗确认）
const onDeleteOrder = () => {
  const o = currentOrder.value
  if (!o) return
  openDialog({
    title: '确定删除订单吗',
    message: `${o.shortName || o.orderNo}：订单、卡牌与拣货记录将全部删除，无法恢复。`,
    confirmText: '删除',
    cancelText: '取消',
    onConfirm: async () => {
      editOrderVisible.value = false
      try {
        await deleteOrder(o.orderNo)
        uni.showToast({ title: '已删除', icon: 'success' })
        // 清空当前选中，回到订单列表视图
        currentOrder.value = null
        currentOrderNo.value = ''
        uni.removeStorageSync('orderCurrentNo')
        viewMode.value = 'list'
        await loadOrders()
      } catch (e) { /* 已 toast */ }
    }
  })
}

// 编辑卡牌（code/rarity/qty/note）— 点击卡片条目触发
const onEditCard = (card) => {
  editCardNo.value = card.cardNo
  editCardForm.value = {
    code: card.code || '',
    rarity: card.rarity || DEFAULT_RARITY,
    qty: String(card.qty || 1),
    condition: card.condition || '流通品相',
    note: card.note || DEFAULT_GRADE
  }
  editCardVisible.value = true
}

const confirmEditCard = async () => {
  const f = editCardForm.value
  if (!f.code.trim()) {
    uni.showToast({ title: '请输入卡牌编号', icon: 'none' })
    return
  }
  editCardVisible.value = false
  try {
    await updateOrderCard(currentOrder.value.orderNo, editCardNo.value, {
      code: f.code.trim(),
      rarity: f.rarity.trim(),
      qty: parseInt(f.qty, 10) || 1,
      condition: f.condition || '流通品相',
      note: f.note.trim()
    })
    uni.showToast({ title: '已保存', icon: 'success' })
    await loadOrderDetail(currentOrder.value.orderNo)
  } catch (e) { /* 已 toast */ }
}

// 通过 → 弹窗确认 → 进入下一状态
const onPassOrder = () => {
  if (!currentOrder.value) {
    uni.showToast({ title: '请先创建订单', icon: 'none' })
    return
  }
  if (currentOrder.value.status === 'done') {
    uni.showToast({ title: '订单已完成', icon: 'none' })
    return
  }
  // 待处理 → 待拣卡：必须先凑库解析且全部匹配成功，否则弹警告
  if (isToPicking.value && !currentOrder.value.allPicked) {
    openDialog({
      title: '暂不能通过',
      message: '订单需先「凑库解析」且全部匹配成功才能通过。请先处理缺货的卡。',
      single: true
    })
    return
  }
  // 待拣卡 → 待发货：必须全部卡已确认拣到（每张点亮绿色），否则弹警告
  if (currentOrder.value.status === 'picking' && pickedCount.value < flatPicks.value.length) {
    openDialog({
      title: '暂不能通过',
      message: `还有 ${flatPicks.value.length - pickedCount.value} 张卡未确认拣到，需把全部卡都点亮绿色「已拣」后才能通过。`,
      single: true
    })
    return
  }
  // 待发货 → 已完成：必须填写快递码和取件码，否则弹警告（待拣卡通过不要求填）
  if (currentOrder.value.status === 'shipping' && (!String(currentOrder.value.courierCode || '').trim() || !String(currentOrder.value.pickupCode || '').trim())) {
    openDialog({
      title: '暂不能通过',
      message: '进入已完成前请先填写快递码和取件码，可在「编辑订单」里补充。',
      single: true
    })
    return
  }
  // 待发货 → 已完成：必须至少一张拍照留痕，否则弹警告
  // 用持久化 photoCount 判断（优先），内存 photos 兜底——避免刚进待发货、照片还没加载完就被误拦
  if (currentOrder.value.status === 'shipping' && !photos.value.length && !(currentOrder.value.photoCount || 0)) {
    openDialog({
      title: '暂不能通过',
      message: '进入已完成前请先拍照留痕，点击「拍照」记录发货照片。',
      single: true
    })
    return
  }
  passVisible.value = true
}

const confirmPass = async () => {
  const order = currentOrder.value
  if (!order) return
  passVisible.value = false
  try {
    const data = await passOrder(order.orderNo)
    const next = data.order.status
    currentStatus.value = (next === '' || next === 'pending') ? 'pending' : next
    uni.setStorageSync('orderCurrentStatus', currentStatus.value)
    uni.showToast({ title: '已通过 → ' + statusLabel(next), icon: 'success' })
    await loadOrders()
    // 刷新为下一状态的详情并停留（列表计数同步，当前订单显示新状态）
    await loadOrderDetail(order.orderNo)
    loadPhotos(order.orderNo)
  } catch (e) { /* 已 toast */ }
}

// 添加卡牌
const onAddCard = () => {
  if (!currentOrder.value) {
    uni.showToast({ title: '请先创建订单', icon: 'none' })
    return
  }
  addForm.value = { code: '', rarity: DEFAULT_RARITY, qty: '1', condition: '流通品相', note: DEFAULT_GRADE }
  addVisible.value = true
}

const confirmAdd = async () => {
  const form = addForm.value
  if (!form.code) {
    uni.showToast({ title: '请输入卡牌编号', icon: 'none' })
    return
  }
  addVisible.value = false
  try {
    await addOrderCards(currentOrder.value.orderNo, [{
      code: form.code.trim(),
      rarity: form.rarity.trim(),
      qty: parseInt(form.qty, 10) || 1,
      condition: form.condition || '流通品相',
      note: form.note.trim()
    }])
    uni.showToast({ title: '已添加', icon: 'success' })
    await loadOrderDetail(currentOrder.value.orderNo)
  } catch (e) { /* 已 toast */ }
}

// 删除卡牌
const onDeleteCard = async (card) => {
  openDialog({
    title: '删除卡牌',
    message: `删除 ${card.code} ×${card.qty}？`,
    confirmText: '删除',
    onConfirm: async () => {
      try {
        await deleteOrderCard(currentOrder.value.orderNo, card.cardNo)
        uni.showToast({ title: '已删除', icon: 'success' })
        await loadOrderDetail(currentOrder.value.orderNo)
      } catch (e) { /* 已 toast */ }
    }
  })
}

// 凑库解析
const onParseOrder = async () => {
  if (!currentOrder.value) return
  if (!currentOrder.value.cards.length) {
    uni.showToast({ title: '请先添加卡牌', icon: 'none' })
    return
  }
  try {
    uni.showLoading({ title: '解析中...' })
    const data = await parseOrder(currentOrder.value.orderNo)
    uni.hideLoading()
    // 汇总结果
    const okCount = data.results.filter(r => r.ok).length
    const missing = data.results.filter(r => !r.ok)
    if (data.success) {
      uni.showToast({ title: '凑库完成，全部可拣', icon: 'success' })
    } else {
      const missText = missing.map(m => `${m.code} 缺${m.missing}张`).join('；')
      openDialog({
        title: '库存不足',
        message: `已凑 ${okCount} 项，${missing.length} 项不足：${missText}`,
        single: true
      })
    }
    await loadOrderDetail(currentOrder.value.orderNo)
  } catch (e) {
    uni.hideLoading()
  }
}

// #ifdef H5
// 一键生成拣货清单长图（待拣卡及之后）—— 左边卡图、右边编号/卡名/品相/卡位，
// 表头写这一单的全部信息。行数太多会自动切成多张，逐张下载。实现在 utils/pickSheet.js。
const sheetBusy = ref(false)   // 生成期间不许再点：一张图要编码好几秒，连点会串档
const onExportSheet = async () => {
  const o = currentOrder.value
  const 行们 = flatPicks.value
  if (!o || !行们.length || sheetBusy.value) return
  sheetBusy.value = true
  uni.showLoading({ title: '生成中…', mask: true })
  try {
    const { 张数 } = await 导出拣货清单长图(o, 行们.map(p => ({
      图: p.img,                                     // 列表用的缩略图地址，pickSheet 会自己换原图试
      编号: p.code,
      罕贵: p.rarity || '',
      // 卡名/品相只能用 pick 上的快照：凑库通过后库存卡就删了，订单卡上没有名字字段
      中文名: p.cnName || '',
      品相: p.condition || '流通品相',
      备注: p.note || '',
      卡位: p.position || p.libraryCode || '',
      已拣: p.pickStatus === 'picked',
    })), { 买家: buyerLine.value })
    uni.hideLoading()
    uni.showToast({ title: 张数 > 1 ? `已导出 ${张数} 张` : '已导出长图', icon: 'none' })
  } catch (e) {
    uni.hideLoading()
    console.error('[清单长图] 生成失败', e)
    uni.showToast({ title: '生成失败，看控制台', icon: 'none' })
  } finally {
    sheetBusy.value = false
  }
}
// #endif

const switchStatus = (key) => {
  currentStatus.value = key
  uni.setStorageSync('orderCurrentStatus', key)
  currentOrderNo.value = ''
  currentOrder.value = null
  viewMode.value = 'list'  // 切 tab → 回到该状态的订单列表
  searchKeyword.value = '' // 切状态清空搜索，重新拉该状态第 1 页
  loadOrders()
}

const onSettings = () => {
  settingsVisible.value = true
}

// 返回键：详情视图 → 返回订单列表；列表视图 → 回主页
const goBack = () => {
  if (viewMode.value === 'detail') {
    viewMode.value = 'list'
  } else {
    uni.reLaunch({ url: '/pages/index/index' })
  }
}

onShow(() => {
  loadOrders(true)
  // 详情视图回到页面：静默刷新当前订单详情（保留凑库结果，不自动清空）
  if (viewMode.value === 'detail' && currentOrder.value) {
    loadOrderDetail(currentOrder.value.orderNo, false)
    loadPhotos(currentOrder.value.orderNo)
  }
})
</script>

<style scoped>
/* ========== 页面容器 ========== */
.page-container {
  background-color: #F5F5F7;
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
}

/* ========== 第1块：工具栏面板 ========== */
.toolbar-panel {
  background-color: #FFFFFF;
  border-radius: 0;
  padding: 12px 16px 10px 16px;
  flex-shrink: 0;
  position: relative;
  z-index: 201;
}

.toolbar {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  position: relative;
}

.toolbar-left {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
}

.toolbar-center {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: row;
  align-items: center;
}

.toolbar-right {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 3px;
}

.tool-title {
  font-size: 16px;
  font-weight: 600;
  color: #1A1A1A;
}

.tool-btn {
  width: 32px;
  height: 32px;
  border-radius: 16px;
  background-color: #F0F0F0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-back {
  width: 18px;
  height: 18px;
}

.icon-xs {
  width: 14px;
  height: 14px;
}

/* ========== 第2块：状态切换 ========== */
.lib-section {
  background-color: #FFFFFF;
  padding: 0 16px 8px 16px;
  flex-shrink: 0;
  position: relative;
  z-index: 201;
}

.lib-top-row { display: flex; justify-content: space-between; align-items: flex-end; }

.library-tab {
  display: flex;
  flex-direction: row;
  justify-content: flex-start;
  gap: 24px;
  padding-left: 8px;
}

.tab-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.tab-item text {
  font-size: 15px;
  color: #999999;
}

.tab-count {
  font-size: 11px;
  color: #FF0000;
  font-weight: 600;
  margin-left: 3px;
}

.tab-item text.active {
  color: #1A1A1A;
  font-weight: 500;
}

.red-line {
  width: 28px;
  height: 3px;
  background-color: #FF0000;
  border-radius: 2px;
  margin-top: 4px;
}

/* ========== 第3块：工具区 ========== */
.filter-tag {
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: #F0F0F0;
  border-radius: 14px;
  padding: 5px 10px;
  gap: 4px;
}

.filter-tag-text {
  font-size: 11px;
  color: #1A1A1A;
}

/* ========== 订单内容区 ========== */
.main-scroll {
  flex: 1;
  padding: 0;
  overflow-y: auto;
}

.order-summary {
  background-color: #FFFFFF;
  border-radius: 12px;
  margin: 12px 16px;
  padding: 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.summary-row {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
}

.back-list {
  font-size: 12px;
  color: #34C759;
  font-weight: 600;
  flex-shrink: 0;
  margin-left: 12px;
}

.summary-no {
  font-size: 18px;
  font-weight: 600;
  color: #1A1A1A;
}

.summary-status {
  font-size: 13px;
  color: #FF0000;
  font-weight: 500;
}

.summary-seq {
  font-size: 12px;
  color: #34C759;
  font-weight: 600;
  background: #E8F8EC;
  border-radius: 10px;
  padding: 2px 10px;
  margin-left: auto;
}

/* 拍照留痕操作单独一行 */
.photo-actions-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}

/* 拍照留痕按钮 */
.photo-btn {
  background: #34C759;
  border-radius: 8px;
  padding: 3px 12px;
  flex-shrink: 0;
}
.photo-btn-ghost {
  background: #FFF;
  border: 1px solid #34C759;
}
.photo-btn-text { font-size: 12px; font-weight: 600; color: #FFF; }
.photo-btn-ghost .photo-btn-text { color: #34C759; }

/* 照片墙 */
.photo-wall { display: flex; flex-wrap: wrap; gap: 12px; padding: 4px 0 12px; }
.photo-item { position: relative; width: calc(33.333% - 8px); }
.photo-img { width: 100%; height: 160px; border-radius: 10px; background: #EEE; }
.photo-del {
  position: absolute; top: 6px; right: 6px; width: 24px; height: 24px;
  border-radius: 50%; background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center;
}
.photo-del-text { font-size: 14px; color: #FFF; line-height: 1; }
.photo-empty { width: 100%; text-align: center; padding: 40px 0; color: #999; font-size: 13px; }
.photo-empty-text { color: #999; }

.summary-order-no {
  font-size: 12px;
  color: #666666;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.edit-hint {
  font-size: 11px;
  color: #FF0000;
  background: #FFF0F0;
  border-radius: 8px;
  padding: 2px 8px;
}

.summary-time {
  font-size: 12px;
  color: #999999;
}

.summary-buyer {
  font-size: 12px;
  color: #666666;
}

.summary-codes {
  font-size: 12px;
  color: #34C759;
  margin-top: 2px;
}

.summary-total-row {
  display: flex;
  align-items: center;
  gap: 24px;
}

.summary-total {
  font-size: 13px;
  color: #333333;
  font-weight: 500;
}

.summary-picked {
  font-size: 13px;
  color: #34C759;
  font-weight: 500;
}

.summary-actions {
  display: flex;
  flex-direction: row;
  gap: 10px;
  margin-top: 8px;
}

.action-btn {
  flex: 1;
  height: 38px;
  background: #F0F0F0;
  border-radius: 19px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.action-btn-red {
  background: #FF0000;
}

.action-btn-text {
  font-size: 13px;
  color: #1A1A1A;
  font-weight: 500;
}

.action-btn-red .action-btn-text {
  color: #FFFFFF;
}

.empty {
  display: flex;
  justify-content: center;
  padding: 60px 16px;
}

.empty-text {
  color: #999999;
  font-size: 14px;
}

/* 卡牌列表 */
.card-list {
  padding: 0 16px 0 16px;
}
/* 最后一张卡与底部添加卡牌按钮的间距收紧到 5px */
.card-list .card-item:last-child {
  margin-bottom: 5px;
}

/* 底部添加卡牌按钮 */
.add-card-bottom {
  margin: 0 16px 24px 16px;
  height: 44px;
  border-radius: 22px;
  background: #FFFFFF;
  border: 1px dashed #FF0000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.add-card-bottom-text {
  font-size: 14px;
  color: #FF0000;
  font-weight: 500;
}

.card-item {
  background: #FFFFFF;
  border-radius: 12px;
  margin-bottom: 10px;
  /* 右边不留内边距，让删除块贴到卡片最右边 */
  padding: 14px 0 14px 16px;
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 12px;
}

.card-thumb {
  width: 59px;
  height: 86px;
  border-radius: 2px;   /* 卡图圆角全站统一 2px（原来这里没写，是直角） */
  background-color: #EEEEEE;
  flex-shrink: 0;
  object-fit: cover;
}

/* 凑库后缺货的卡 → 整行淡红底 */
.card-item.card-miss {
  background-color: #FFE8E8;
}

/* 待拣卡：每张物理卡一条 */
.pick-card {
  background: #FFFFFF;
  border-radius: 12px;
  margin-bottom: 10px;
  padding: 14px 16px;
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 12px;
}
/* 已拣：淡绿底 */
.pick-card.picked {
  background: #E8F8EC;
}
.pick-card-info {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  min-width: 0;
}
.pick-card-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.pick-card-pos {
  font-size: 20px;
  color: #1A1A1A;
  font-weight: 700;
  font-family: monospace;
}
.pick-card-code {
  font-size: 20px;
  color: #1A1A1A;
  font-weight: 600;
}
/* 删除块：卡片最右边一整条竖块，红底 + 白色大叉。
   margin 的 -14px 用来抵消 .card-item 的上下内边距，让红块贴到卡片的上下边缘；
   border-radius 右侧那 12px 是跟着 .card-item 的圆角走的（这里不是直角卡片，不能省），
   哪天卡片圆角或 padding 改了，这两个值都要跟着改。 */
.card-del-btn {
  width: 28px;
  flex-shrink: 0;
  align-self: stretch;
  margin: -14px 0;
  border-radius: 0 12px 12px 0;
  background: #FF0000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.del-char {
  font-size: 18px;
  color: #FFFFFF;
  line-height: 1;
}

.card-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.card-code {
  font-size: 15px;
  font-weight: 600;
  color: #1A1A1A;
}

.card-meta {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
}

.meta-text {
  font-size: 12px;
  color: #666666;
  background: #F5F5F7;
  border-radius: 8px;
  padding: 2px 8px;
}

.card-picks {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
}

.pick-line {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.pick-lib {
  font-size: 12px;
  color: #1A1A1A;
  font-weight: 500;
  font-family: monospace;
}

.pick-qty {
  font-size: 12px;
  color: #FF0000;
  font-weight: 500;
}

.pick-status {
  font-size: 11px;
  border-radius: 6px;
  padding: 1px 6px;
}

.pick-status.pending {
  color: #FF9500;
  background: #FFF4E5;
}

.pick-status.picked {
  color: #34C759;
  background: #E8F8EC;
}

.pick-status.miss {
  color: #FF3B30;
  background: #FFE8E8;
  font-weight: 500;
}

.card-short {
  margin-top: 6px;
}

/* ========== 弹窗 ========== */
.edit-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:400; display:flex; align-items:center; justify-content:center; }
.edit-box { width:calc(100% - 48px); max-width:380px; background:#FFF; border-radius:16px; padding:24px 20px 20px; box-sizing:border-box; }
.edit-title-row { display:flex; align-items:center; justify-content:center; position:relative; margin-bottom:16px; }
.edit-title { font-size:17px; font-weight:600; text-align:center; }
.confirm-body { padding: 16px 0 2px; }
.confirm-text { display:block; font-size:14px; color:#333; line-height:1.6; text-align:center; word-break:break-all; }
.confirm-text + .confirm-text { margin-top:10px; }
.confirm-warn { color:#FF3B30; font-weight:500; }
.confirm-op { color:#34C759; font-weight:500; }
.edit-del-order { position:absolute; right:0; top:0; font-size:13px; color:#FF3B30; padding:2px 0 2px 12px; }
.mod-desc { font-size:13px; color:#333; text-align:center; line-height:1.6; }

/* 编辑订单弹窗：通过记录（只读） */
.pass-history { margin-top:14px; border-top:1px dashed #E5E5E5; padding-top:12px; }
.pass-history-title { display:block; font-size:12px; color:#999; margin-bottom:8px; }
.pass-history-item { display:flex; align-items:center; font-size:12px; color:#666; line-height:1.6; }
.pass-history-item + .pass-history-item { margin-top:4px; }
.ph-stage { flex-shrink:0; width:96px; color:#999; }
.ph-op { flex-shrink:0; color:#333; }
.ph-time { margin-left:auto; color:#BBB; }
.edit-btns { display:flex; gap:12px; }
.edit-btn-cancel { flex:1; height:42px; background:#F0F0F0; border-radius:24px; display:flex; align-items:center; justify-content:center; }
.edit-btn-save { flex:1; height:42px; background:#FF0000; border-radius:24px; display:flex; align-items:center; justify-content:center; }
.edit-btn-text { font-size:14px; color:#1A1A1A; font-weight:500; }
.edit-btn-text-w { color:#FFF; }

/* 添加卡牌表单 */
.add-form { display: flex; flex-direction: column; gap: 10px; }
.add-input { height: 40px; background: #F5F5F7; border-radius: 10px; padding: 0 12px; font-size: 14px; color: #1A1A1A; }
.add-row { display: flex; flex-direction: row; gap: 10px; }
.add-input-half { flex: 1; height: 40px; background: #F5F5F7; border-radius: 10px; padding: 0 12px; font-size: 14px; color: #1A1A1A; }

/* 品相下拉（与 add-input 同高同底色） */
.add-picker { display: flex; align-items: center; }
.picker-label { font-size: 12px; color: #999999; flex-shrink: 0; }
.picker-value { flex: 1; font-size: 14px; color: #1A1A1A; padding-left: 8px; }
.picker-arrow { font-size: 12px; color: #999999; flex-shrink: 0; }

/* 订单列表视图（当前状态全部订单框） */
.order-list { padding: 8px 0 12px; }
.order-list-item {
  background: #FFFFFF;
  border-radius: 12px;
  padding: 12px 14px;
  margin-bottom: 10px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}
.oli-top { display: flex; align-items: center; }
.oli-seq {
  flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%;
  background: #34C759; color: #FFF; font-size: 12px; font-weight: 600;
  display: flex; align-items: center; justify-content: center; margin-right: 10px;
}
.oli-left { flex: 1; min-width: 0; display: flex; align-items: center; }
.oli-name { font-size: 16px; font-weight: 600; color: #1A1A1A; }
.oli-count { flex-shrink: 0; font-size: 13px; font-weight: 500; color: #666666; margin-left: 8px; }
.oli-right { flex-shrink: 0; display: flex; align-items: center; gap: 6px; }
.oli-pickup { font-size: 12px; color: #666666; background: #F0F0F0; border-radius: 6px; padding: 1px 6px; }
.oli-status { font-size: 16px; font-weight: 600; color: #FF0000; }
/* 第二行：左卡图 + 右三行文字（三行与卡图顶/底贴齐，等距分布） */
.oli-main { display: flex; align-items: stretch; margin-top: 10px; }
.oli-card-img {
  flex-shrink: 0; width: 48px; height: 69px;
  background: #F0F0F0;
}
.oli-info {
  flex: 1; min-width: 0; margin-left: 12px;
  display: flex; flex-direction: column; justify-content: flex-start; gap: 3px;
}
.oli-cards {
  display: block; font-size: 14px; font-weight: 500; color: #1A1A1A; line-height: 1.3;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.oli-cards-empty { color: #999999; font-weight: 400; font-size: 13px; }
.oli-no { display: block; font-size: 12px; color: #999999; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.oli-time { display: block; font-size: 12px; color: #999999; }
/* 物流码/买家 附加行 */
.oli-meta-line { display: flex; align-items: center; }
.oli-code { font-size: 11px; color: #34C759; background: #E8F8EC; border-radius: 6px; padding: 1px 6px; }
.oli-buyer { font-size: 11px; color: #666666; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
/* 缺货角标 */
.oli-miss {
  flex-shrink: 0; font-size: 10px; color: #FFF; background: #FF3B30;
  border-radius: 6px; padding: 1px 6px; margin-left: 6px;
}

/* 搜索框 */
.order-search {
  display: flex; align-items: center; gap: 6px;
  background: #FFF; border-radius: 10px; padding: 0 12px;
  margin-bottom: 10px; height: 38px; border: 1px solid #F0F0F0;
}
.search-ico { font-size: 13px; color: #999; flex-shrink: 0; }
.order-search-input { flex: 1; height: 100%; font-size: 13px; color: #1A1A1A; min-width: 0; }
.order-search-clear {
  width: 18px; height: 18px; border-radius: 9px; background: #E5E5E5;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.order-search-clear-x { font-size: 11px; color: #666; line-height: 1; }

/* 加载更多 */
.load-more { display: flex; justify-content: center; padding: 14px 0 6px; }
.load-more-text { font-size: 12px; color: #999; }
.load-more-text.end { color: #CCC; }

/* 设置弹窗 */
.settings-list { margin-top: 16px; display: flex; flex-direction: column; gap: 4px; }
.setting-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 2px; border-bottom: 1px solid #F5F5F7;
}
.setting-row:last-child { border-bottom: none; }
.setting-label { font-size: 14px; color: #1A1A1A; }
.setting-switch {
  width: 44px; height: 24px; border-radius: 12px; background: #E0E0E0;
  padding: 2px; box-sizing: border-box; transition: background 0.2s;
  flex-shrink: 0;
}
.setting-switch.on { background: #34C759; }
.setting-switch-dot {
  width: 20px; height: 20px; border-radius: 10px; background: #FFF;
  transition: transform 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.setting-switch.on .setting-switch-dot { transform: translateX(20px); }
.setting-seg { display: flex; background: #F0F0F0; border-radius: 16px; padding: 2px; flex-shrink: 0; }
.seg-item { padding: 4px 12px; border-radius: 14px; }
.seg-item.on { background: #FFF; box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
.seg-item-text { font-size: 12px; color: #666; }
.seg-item.on .seg-item-text { color: #FF0000; font-weight: 600; }

/* 编辑订单：编号锁定 */
.add-input-disabled { background: #EFEFEF; color: #999; }
.edit-order-lock-hint { display: block; font-size: 11px; color: #FF9500; margin-top: 4px; }
.order-create-box {
  background: #E53935;
  border-radius: 12px;
  padding: 14px 14px;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}
.order-create-text { color: #FFFFFF; font-size: 20px; font-weight: 700; letter-spacing: 6px; }
.pass-box {
  background: #34C759;
  border-radius: 12px;
  margin: 12px 16px 0;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}
.pass-box-text { color: #FFFFFF; font-size: 20px; font-weight: 700; letter-spacing: 6px; }
.op-empty { display: flex; justify-content: center; padding: 20px; }
.op-empty-text { color: #999999; font-size: 13px; }
</style>
