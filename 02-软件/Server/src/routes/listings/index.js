const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const autoExecuteRouter = require('./auto-execute');
const autoExecuteVmRouter = require('./auto-execute-vm');  // VM 版
const queuesRouter = require('./queues');
const batchesRouter = require('./batches');

// 一键上架（必须在 /batches/:batchId 之前）
router.use('/auto-execute', autoExecuteRouter);
router.use('/auto-execute-vm', autoExecuteVmRouter);  // VM 版

// 执行队列（解析结果持久化）
router.use('/queues', queuesRouter);

// 批次档案（确认完成 = 人工归档）
router.use('/batches', batchesRouter);

module.exports = router;
