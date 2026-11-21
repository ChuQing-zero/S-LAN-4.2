/**
 * 一键上架「同一批只能跑一次」的进程内锁。
 *
 * 订单那边有一份一模一样的（`routes/orders/index.js:30` 的 `passingLocks`），
 * 这里是它的上架版：双击「一键上架」、或者局域网里两台设备同时点，
 * 第二次直接 409 —— 免得同一批在模拟器上把 ADB 动作**做两遍**（那是实打实的重复操作）。
 *
 * ⚠️ 只在**进程内**有效，服务一重启锁就没了。所以两个 auto-execute 入口除了问这里，
 * 还要看一眼库里有没有停在 `running` 的行（那是上一次没跑完留下的痕迹）。
 */
const running = new Set();

/** 抢锁；已经在跑、或者 batchId 是空的，返回 false（调用方应当回 409） */
const acquire = (batchId) => {
  if (!batchId || running.has(batchId)) return false;
  running.add(batchId);
  return true;
};

const release = (batchId) => { running.delete(batchId); };

const isRunning = (batchId) => running.has(batchId);

module.exports = { acquire, release, isRunning };
