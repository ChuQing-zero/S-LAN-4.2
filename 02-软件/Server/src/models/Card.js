const mongoose = require('mongoose');

const cardSchema = new mongoose.Schema({
  serial: { type: String, required: true },
  jpName: { type: String, default: '' },
  cnName: { type: String, default: '' },
  code: { type: String, default: '' },
  rarity: { type: String, default: '' },
  condition: { type: String, default: '' },            // 品相: 流通品相/有瑕疵/有损伤
  note: { type: String, default: '' },                  // 品相备注: 9品/8品等
  img: { type: String, default: '' },
  origImg: { type: String, default: '' },                                  // 原图路径(/uploads/orig/xxx.jpg)，拍照/上传的原始卡牌图
  extCode: { type: String, default: '' },                                 // 卡密(密码)，用于卡图映射
  altArtIndex: { type: Number, default: null },                            // 异画序号 null=无异画 0=原画 1=异画1
  altLabel: { type: String, default: '' },                                 // 当前异画标签
  altLabels: { type: mongoose.Schema.Types.Mixed, default: {} },           // 异画标签映射 {0:'原画',1:'异画'}
  libraryCode: { type: String, required: true },
  versionId: { type: Number, default: 1 },
  userId: { type: String, default: null },  // 本地库卡牌=当前用户ID, 云端库卡牌=null
  // 已上架 = 这张实体卡已经挂到店里卖出去了。**它就是订单凑库的准入开关**：
  // 凑库只认 `{ listed: true }`（`routes/orders/index.js`），未上架的卡凑不到任何订单。
  listed: { type: Boolean, default: false },
  // 谁标的「已上架」+ 哪个批次标的（V1.2.82）。
  // 这两个字段是为了让「撤回」能认出**自己标的卡**：老办法靠 listedPrice/listingId 是否为 null
  // 来分辨，但「主库」标记落库时那两个字段也恰好是 null（调用方不传 listingId），
  // 长得跟一键上架标的卡一模一样 → 撤回会把人家的标记一起抹掉 → 那张卡从凑库池里凭空消失
  // （卡还在库里，就是凑不到订单）。
  // 取值：'auto-listing' / 'master-library' / 'listed-cards'；null = 加这个字段之前的旧标记。
  listedBy: { type: String, default: null },
  listedBatchId: { type: String, default: null },
  listingId: { type: String, default: null },
  listedAt: { type: Date, default: null },
  listedPrice: { type: Number, default: null }
}, { timestamps: true });

cardSchema.index({ libraryCode: 1 });
cardSchema.index({ jpName: 'text', cnName: 'text', code: 'text', serial: 'text' });
cardSchema.index({ userId: 1 });
cardSchema.index({ libraryCode: 1, userId: 1 });
cardSchema.index({ listed: 1, code: 1 });
cardSchema.index({ code: 1 });
cardSchema.index({ origImg: 1 });
// 唯一：同库里卡位号不许重复。撞击后果很重 —— `OrderPick.position` 存的就是 serial，
// 出库那句「按 (库, 卡位) 删一张」会删掉错的那张。2026-10-02 加之前查过两个库
// （s-lan-local / s-lan-test，各 38767 张）重复组数都是 0，所以可以直接改成唯一索引；
// 启动时的 `Card.syncIndexes()` 会把原来那个非唯一的同名索引**删掉重建**。
cardSchema.index({ libraryCode: 1, serial: 1 }, { unique: true });

module.exports = mongoose.model('Card', cardSchema);
