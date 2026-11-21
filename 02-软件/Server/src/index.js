require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const config = require('./config');
const connectDB = require('./config/database');

// Routes
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const librariesRoutes = require('./routes/libraries');
const cardsRoutes = require('./routes/cards');
const transferRoutes = require('./routes/transfer');
const referenceRoutes = require('./routes/reference');
const visionRoutes = require('./routes/vision');
const adminRoutes = require('./routes/admin/versionConfig');
const adminVersionsRoutes = require('./routes/admin/versions');
const stockCodesRoutes = require('./routes/admin/stock-codes');
const adminImageCachesRoutes = require('./routes/admin/image-caches');
const adminApiKeysRoutes = require('./routes/admin/api-keys');
const accountUsersRoutes = require('./routes/admin/account-users');
const inviteCodesRoutes = require('./routes/admin/invite-codes');
const authTerminalAdmin = require('./middleware/authTerminalAdmin');
const balanceRoutes = require('./routes/balance');
const cloudServersRoutes = require('./routes/cloudServers');
const masterLibraryRoutes = require('./routes/master-library');
const listingsRoutes = require('./routes/listings');
const tcgRoutes = require('./routes/tcg');
const listingAgentRoutes = require('./routes/listing-agent');
const launchVmRoutes = require('./routes/launch-vm');
const listingAgentVmRoutes = require('./routes/listing-agent-vm/index.js');
const listedCardsRoutes = require('./routes/listed-cards');
const ordersRoutes = require('./routes/orders');
const missingCodesRoutes = require('./routes/missing-codes');
const taskNotesRoutes = require('./routes/task-notes');
const cardMarksRoutes = require('./routes/card-marks');
const cardUniquesRoutes = require('./routes/card-uniques');

// 订单三库 Model（注册 + 启动时建集合）
const Order = require('./models/Order');
const OrderCard = require('./models/OrderCard');
const OrderPick = require('./models/OrderPick');
const CardUnique = require('./models/CardUnique');

const app = express();

// Middleware
// CORS: 仅允许同源 + 局域网来源, 不反射任意 Origin (防止恶意网页跨域调用局域网 API)
app.use(cors({
  origin(origin, cb) {
    // 无 Origin (同源请求/手机APP/curl) 直接放行
    if (!origin) return cb(null, true);
    // 仅放行同机 + 局域网 IP 来源
    if (/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin)) {
      return cb(null, true);
    }
    return cb(null, false);
  },
  credentials: true,
}));
// 「目录数据包」导入的 body 天生就大：31969 条目录 + 94 条登记打成一个 JSON 已经 7.6 MB，
// 而且随卡牌数继续长。**必须挂在下面那个全局 5mb 解析器之前** —— 挂在路由上没用，
// 因为请求会先被全局的挡掉（body-parser 一报 entity.too.large 就到不了路由），
// 表现是「导入永远失败」但看不出原因。已解析过的 body 会被后面的全局解析器跳过。
//
// 两个挂载点都要写：前端 `config/index.js` 的 apiBaseUrl 是 `/v1/api`（request.get('/tcg/xxx')
// 拼出来是 /v1/api/tcg/xxx），而接口测试通常直接打 /api/tcg/xxx。**只挂一个，
// 另一个方向上就是「导入永远失败」** —— 而且失败得很安静（5mb 的全局解析器先拒掉）。
const BIG_BODY_PATHS = ['/api/tcg/import-bundle', '/v1/api/tcg/import-bundle'];
BIG_BODY_PATHS.forEach((p) => app.use(p, express.json({ charset: 'utf-8', limit: '128mb' })));
app.use(express.json({ charset: 'utf-8', limit: '5mb' }));
app.use(express.urlencoded({ extended: true, charset: 'utf-8', limit: '5mb' }));

// Multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Routes
// ── 设备端内部调用（仅本机回环，不需要 token）──
app.post('/internal/vision/qa', async (req, res) => {
  const ip = (req.ip || '').replace('::ffff:', '');
  if (!['127.0.0.1', '::1', 'localhost'].includes(ip)) {
    return res.status(403).json({ ok: false, error: '仅允许本机调用' });
  }
  const started = Date.now();
  try {
    const { image, question } = req.body || {};
    if (!image) return res.status(400).json({ ok: false, error: 'image is required' });

    const ApiKey = require('./models/ApiKey');
    const { callArkVision } = require('./services/arkVisionService');
    const key = await ApiKey.findOne({ isDefault: true, enabled: true }).lean();
    if (!key) return res.status(400).json({ ok: false, error: '没有默认可用的豆包钥匙' });

    const q = String(question || '').trim() || '这是什么卡牌？';
    const r = await callArkVision({
      apiKey: key.apiKey, apiUrl: key.apiUrl, model: key.model,
      imageDataUrl: image, prompt: q,
    });
    res.json({ ok: true, answer: String(r.text || '').trim(), ms: Date.now() - started });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

app.use('/health', healthRoutes);
// 静态文件：分目录挂载。order-photos（订单拍照留痕）不做静态，走鉴权 API 路由 /v1/api/orders/.../photos/:index/file
const uploadsRoot = path.join(__dirname, '../uploads');
['orig', 'avatars', 'tmp', 'versions'].forEach((d) => {
  app.use('/uploads/' + d, express.static(path.join(uploadsRoot, d)));
});

app.use('/v1/api/auth', authRoutes);
app.use('/v1/api/user', userRoutes);
app.use('/v1/api', librariesRoutes);
app.use('/v1/api/cards', cardsRoutes);
app.use('/v1/api/libraries/transfer', transferRoutes);
app.use('/v1/api', referenceRoutes);
app.use('/v1/api/vision', upload.single('image'), visionRoutes);
app.use('/v1/api/admin/version-config', adminRoutes);
app.use('/v1/api/admin/versions', adminVersionsRoutes);
app.use('/v1/api/admin/stock-codes', stockCodesRoutes);
app.use('/v1/api/admin/caches', adminImageCachesRoutes);
app.use('/v1/api/admin/api-keys', adminApiKeysRoutes);
app.use('/v1/api/admin', require('./routes/admin/backup'));
// 账号管理：仅终端管理员可访问（管理入口校验了 terminal_admin）
app.use('/v1/api/admin/accounts', authTerminalAdmin, accountUsersRoutes);
// 邀请码管理：仅终端管理员可访问
app.use('/v1/api/admin/invite-codes', authTerminalAdmin, inviteCodesRoutes);
app.use('/v1/api/cloud-servers', cloudServersRoutes);
app.use('/v1/api/balance', balanceRoutes);
app.use('/v1/api/master-library', masterLibraryRoutes);
app.use('/v1/api/listings', listingsRoutes);
app.use('/v1/api/tcg', tcgRoutes);
app.use('/v1/api/listing-agent', listingAgentRoutes);
app.use('/v1/api/launch-vm', launchVmRoutes);
app.use('/v1/api/listing-agent-vm', listingAgentVmRoutes);
app.use('/v1/api/listed-cards', listedCardsRoutes);
app.use('/v1/api/orders', ordersRoutes);
app.use('/v1/api/missing-codes', missingCodesRoutes);
app.use('/v1/api/task-notes', taskNotesRoutes);
app.use('/v1/api/card-marks', cardMarksRoutes);
// 卡牌唯一目录 / 待处理（只读为主，写操作在批次 3、4 才加）
app.use('/v1/api/card-uniques', cardUniquesRoutes);
app.use('/v1/api/device', require('./routes/device'));
app.use('/v1/api/barcode', require('./routes/barcode'));
app.use('/api/tcg', tcgRoutes);

// Compatibility alias
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api', librariesRoutes);
app.use('/api/cards', cardsRoutes);
app.use('/api/libraries/transfer', transferRoutes);
app.use('/api', referenceRoutes);
app.use('/api/vision', upload.single('image'), visionRoutes);
// card/recognize compatibility alias (前端文档约定)
app.use('/v1/api/card', upload.single('image'), visionRoutes);
app.use('/api/card', upload.single('image'), visionRoutes);

// Error handling
app.use((err, req, res, next) => {
  // body-parser 的错（body 太大 / JSON 语法错 / 顶层不是对象…）自带正确的 HTTP 状态，
  // 一律按 500 返回会把「请求本身不合法」说成「服务端炸了」，前端只能报个没头没脑的失败。
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('Error:', err);
  else console.warn(`Bad request (${status}):`, err.message);
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// Static frontend (编译产物: V1.1\Client\dist\build\h5, 由 Client 源码 build:h5 生成)
const frontendDir = require('path').join(__dirname, '../../Client/dist/build/h5');
app.use(express.static(frontendDir));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/v1/api') || req.path.startsWith('/api') || req.path.startsWith('/health') || req.path.startsWith('/uploads')) return next();
  res.sendFile(require('path').join(frontendDir, 'index.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// 项目根目录
const projectRoot = path.join(__dirname, '../../');
const pkg = require('../package.json');

// 自动 Git 保存 (仅当项目根是 git 仓库且 .git 存在时启用)
const autoGitSave = () => {
  try {
    const fs = require('fs');
    if (!fs.existsSync(path.join(projectRoot, '.git'))) return;
    const now = new Date();
    const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false });
    const commitMsg = `Auto-save: ${dateStr} ${timeStr}`;

    console.log(`\n📦 Auto-saving to git: "${commitMsg}"`);
    execSync('git add -A', { cwd: projectRoot, stdio: 'inherit' });
    execSync(`git commit -m "${commitMsg}"`, { cwd: projectRoot, stdio: 'inherit' });
    console.log('✅ Auto-save complete.\n');
  } catch (err) {
    // 没有变更时 git commit 会报错，忽略即可
    if (err.message && err.message.includes('nothing to commit')) {
      console.log('📝 No changes to save.\n');
    } else {
      console.error('❌ Auto-save failed:', err.message);
    }
  }
};

// 优雅关闭处理
const gracefulShutdown = (signal) => {
  console.log(`\n⚠ Received ${signal}, shutting down...`);
  autoGitSave();
  process.exit(0);
};

// Start server
const startServer = async () => {
  await connectDB();
  // 同步 Mongoose 索引 (新增索引自动创建, 不影响现有数据)
  try {
    await Promise.all([
      require('./models/StockCode').syncIndexes(),
      require('./models/Card').syncIndexes(),
      require('./models/MissingCode').syncIndexes(),
      require('./models/TaskNote').syncIndexes(),
      require('./models/VisionUsageLog').syncIndexes(),
      require('./models/CardMark').syncIndexes(),
      require('./models/CardUnique').syncIndexes(),
      // CardCatalog 加进来是为了**把那个 text 索引真的从 Mongo 删掉**：
      // 卡名字段已经从 schema 里去掉了，但索引不会自己消失，`syncIndexes()` 才会对齐。
      require('./models/CardCatalog').syncIndexes(),
    ]);
    console.log('📇 索引同步完成: StockCode / Card / MissingCode / TaskNote / VisionUsageLog / CardMark / CardUnique / CardCatalog');
  } catch (err) {
    console.warn('⚠ 索引同步失败 (不影响启动):', err.message);
  }

  // 卡名的映射预热：`cardcatalogs` 已经不存名字了，每个读点都要拿卡密去换取。
  // 不预热的话第一个请求会撞上一次全表扫（13,883 条），放在这里一次性建好。
  // 失败不算致命：`回填` 内部会在下次调用时自己重建，只是那一次会慢一点。
  try {
    await require('./services/cardNames').就绪();
    console.log('🏷  卡名映射预热完成 (carduniques → jpName/cnName/enName)');
  } catch (err) {
    console.warn('⚠ 卡名映射预热失败 (首个请求时会自动重建):', err.message);
  }
  // 显式创建订单三库集合（Mongo 惰性建集合，require 不会建，需 createCollection）
  try {
    await Promise.all([
      Order.createCollection(),
      OrderCard.createCollection(),
      OrderPick.createCollection(),
      // 唯一目录：Mongo 惰性建集合，require 不会建，得显式来一次
      CardUnique.createCollection(),
    ]);
    console.log('📦 订单三库集合已创建: orders / order_cards / order_picks；卡牌唯一目录: carduniques');
  } catch (err) {
    console.error('❌ 订单三库集合创建失败:', err.message);
  }
  const server = app.listen(config.port, () => {
    // 挂载 WebSocket 状态同步中心 (一键上架实时进度 → 各端)
    try {
      const wss = require('./ws');
      wss.attach(server);
      console.log('  WS 同步中心:  ws://localhost:' + config.port + '/ws');
    } catch (e) {
      console.warn('  [警告] WS 模块未加载: ' + e.message);
    }

    // 收集局域网 IPv4 地址
    const lanIps = [];
    const interfaces = os.networkInterfaces();
    for (const nets of Object.values(interfaces)) {
      for (const net of nets) {
        if (net.family === 'IPv4' && !net.internal) lanIps.push(net.address);
      }
    }

    console.log('\n' + '='.repeat(56));
    console.log('  S-LAN Server v' + (pkg.version || '2.0.0'));
    console.log('='.repeat(56));
    console.log('  本机访问:   http://localhost:' + config.port);
    lanIps.forEach(ip => console.log('  局域网访问: http://' + ip + ':' + config.port));
    console.log('  API 检查:   http://localhost:' + config.port + '/health');
    console.log('='.repeat(56));
    console.log('  提示: 手机/其他设备在同一局域网时, 用浏览器打开');
    console.log('        "局域网访问" 地址即可使用前端。');
    console.log('        关闭本窗口 = 停止服务。');
    console.log('');
  });

  // 注册关闭信号处理
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
};

startServer();

module.exports = app;
