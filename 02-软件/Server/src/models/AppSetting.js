const mongoose = require('mongoose');

/**
 * 应用级设置 (appsettings) —— 一张 key/value 表，给「服务器设置」这类东西落脚。
 *
 * 为什么单开一张表，而不是塞进 config/ 里的 JSON：
 *   这类值是**全局**的（不跟用户、批次、库走），改一次只动一行。
 *   放 config/ 目录的话它会跟着走 git（autoGitSave 会把它提交进去），
 *   于是「我把阈值从 5 调成 3」会变成一条源码改动，跟流程配置混在一起。
 *   放库里就没这回事。
 *
 * 读写的唯一入口是 services/appSettings.js（默认值与取值范围都在那儿），
 * 别绕过它直接摸这张表 —— 不然「页面显示 5、后端按 3 跑」这种事迟早发生。
 */
const appSettingSchema = new mongoose.Schema({
  key:   { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true, collection: 'appsettings' });

module.exports = mongoose.model('AppSetting', appSettingSchema);
