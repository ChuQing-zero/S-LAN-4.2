<script>
export default {
  onLaunch: function () {
    console.log('App Launch')
  },
  onShow: function () {
    console.log('App Show')
  },
  onHide: function () {
    console.log('App Hide')
  },
}
</script>

<style>
/*每个页面公共css */

/* ===== 窄屏兼容（<370px）===== */
@media screen and (max-width: 370px) {
  /* 工具栏 */
  .tool-btn { width: 28px !important; height: 28px !important; }
  .tool-title { font-size: 13px !important; }
  .icon-back, .icon-sm { width: 15px !important; height: 15px !important; }
  .icon-xs { width: 12px !important; height: 12px !important; }

  /* 版本选择器 */
  .version-selector { padding: 4px 8px !important; }
  .version-text { font-size: 10px !important; }
  .arrow { width: 10px !important; height: 10px !important; }

  /* 筛选标签 */
  .filter-tag { padding: 3px 7px !important; }
  .filter-tag-text { font-size: 10px !important; }
  .small-arrow { width: 8px !important; height: 8px !important; }

  /* 库选择tab */
  .tab-item text { font-size: 13px !important; }
  .red-line { width: 22px !important; height: 2px !important; margin-top: 3px !important; }

  /* API信息 */
  .api-usage-text, .api-balance-text { font-size: 9px !important; }

  /* 卡片 */
  .card-item { padding: 10px 12px !important; }
  .card-img { width: 48px !important; height: 70px !important; }
  .jp-name { font-size: 13px !important; }
  .cn-name { font-size: 10px !important; }
  .meta-text, .serial, .ext-code { font-size: 9px !important; }
  .card-del-btn { width: 20px !important; height: 20px !important; top: 6px !important; right: 8px !important; }
  .del-char { font-size: 10px !important; }

  /* 异画切换 */
  .alt-switcher { padding: 1px 3px !important; }
  .alt-arrow { width: 16px !important; height: 16px !important; }
  .alt-arrow-text { font-size: 8px !important; }
  .alt-label-input { width: 38px !important; height: 18px !important; font-size: 9px !important; }

  /* 底部拍照按钮 */
  .camera-btn { width: 46px !important; height: 46px !important; bottom: 25px !important; }
  .camera-icon { width: 19px !important; height: 19px !important; }

  /* 弹窗 */
  .edit-box { padding: 16px 14px !important; }
  .edit-title { font-size: 15px !important; }
  .edit-input { height: 34px !important; font-size: 12px !important; }
  .edit-btn-text { font-size: 12px !important; }
  .edit-btn-cancel, .edit-btn-save { height: 36px !important; }

  /* 库存页网格 */
  .img-grid { grid-template-columns: repeat(auto-fill, 90px) !important; gap: 4px !important; }
  .img-thumb { width: 84px !important; height: 123px !important; }
  .card-cn-name { font-size: 11px !important; }

  /* 统计行 */
  .stats { gap: 10px !important; }
  .st { font-size: 10px !important; }

  /* 库存编号卡片 */
  .code { font-size: 13px !important; }
  .ver, .info, .note { font-size: 10px !important; }
  .rbtn { padding: 2px 7px !important; }
  .rb { font-size: 10px !important; }

  /* 后台管理 */
  .mod-inp { height: 30px !important; font-size: 11px !important; }
  .mod-lbl { font-size: 10px !important; width: 34px !important; }
  .mod-sel { height: 30px !important; font-size: 11px !important; }
  .mod-btn { height: 36px !important; font-size: 12px !important; }
  .lib-type, .st-tag { font-size: 8px !important; padding: 1px 5px !important; }

  /* 通用间距 */
  .toolbar-panel { padding: 8px 12px 8px !important; }
  .lib-section { padding: 0 12px 6px !important; }
  .tool-section { padding: 0 12px 8px !important; }
  .card-list { padding-top: 4px !important; padding-bottom: 90px !important; }
}
</style>
