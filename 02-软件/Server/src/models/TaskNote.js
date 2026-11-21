const mongoose = require('mongoose');

/**
 * 任务清单 —— 需要人工处理的待办事项
 *
 * 用途：有些问题机器判断不了、或者必须人工逐个核对（比如某些老卡包的编号可能跟官方对不上），
 * 先在这里记一条，人工改完再把 status 标成 done。
 *
 *   packCode —— 关联卡包（可空）。填了的话接口会实时回显这个包现在的编号长什么样，
 *               "改了没、改到哪一步"一眼能看到，不用另外记进度。
 *   status   —— pending 待处理 / doing 处理中 / done 已完成
 *   note     —— 人工备注
 *
 * 注意：清单是"人工断言"，不会被自动清掉。卡包改好了也要自己把 status 改掉，
 * 接口只会把当前编号状态回显出来做参考。
 */
const taskNoteSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    detail: { type: String, default: '' },
    category: { type: String, default: '编号问题' },
    packCode: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'doing', 'done'], default: 'pending' },
    note: { type: String, default: '' },
    sortOrder: { type: Number, default: 0 },
    doneAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'tasknotes' }
);

taskNoteSchema.index({ status: 1, sortOrder: 1 });
taskNoteSchema.index({ packCode: 1 });

module.exports = mongoose.model('TaskNote', taskNoteSchema);
