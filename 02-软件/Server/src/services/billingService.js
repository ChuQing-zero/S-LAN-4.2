/**
 * 火山引擎余额查询服务
 *
 * 关键要点（和 OCR 同理）：
 * 1. Billing 计费接口要求 application/x-www-form-urlencoded
 * 2. BillPeriod 必须放在 URL Query 参数
 * 3. 空 body {}，参数全部通过 query 传入
 */
const { billing } = require('@volcengine/openapi');
const config = require('../config');

function getCurrentBillingPeriod() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * 查询账户余额/账单概览
 * @returns {Promise<object>} 余额信息
 */
async function getBalance() {
  const billingService = new billing.BillingService({
    accessKeyId: config.volcengine.accessKeyId,
    secretKey: config.volcengine.secretKey,
  });

  try {
    // BillPeriod 放入 query 查询串，body 为空对象
    const result = await billingService.ListBillOverviewByProd(
      {},
      {
        query: {
          BillPeriod: getCurrentBillingPeriod(),
          Limit: '10',
          Offset: '0',
        },
      }
    );

    return {
      success: true,
      period: getCurrentBillingPeriod(),
      data: result,
    };
  } catch (error) {
    return {
      success: false,
      message: error.message || '余额查询失败',
    };
  }
}

module.exports = { getBalance };
