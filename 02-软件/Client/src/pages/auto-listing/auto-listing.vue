<template>
  <view class="page-container">
    <!-- ================= 区块一：顶部导航栏 =================
         「‹ 返回」在包详情 / 查看溯源里是「退回包列表」，在列表上才是回首页。 -->
    <view class="toolbar-panel">
      <view class="toolbar">
        <view class="toolbar-left">
          <view class="tool-btn" @tap="onTopBack">
            <image class="icon-back" src="/static/icons/ic_back.png" mode="aspectFit"></image>
          </view>
          <view class="filter-tag parse-tag mode-tag" :style="{background:modeOnline?'#27ae60':'red'}" @tap="showModePopup">
            <text class="filter-tag-text">{{ modeMethod }}</text>
          </view>
        </view>
        <text class="tool-title">一键上架</text>
        <view class="version-selector" @tap="openVersionPicker">
          <text class="version-text">{{ selectedVersion.name }}</text>
          <image class="arrow" src="/static/icons/ic_arrow_down.png" mode="aspectFit"></image>
        </view>
      </view>
    </view>

    <!-- ================= 区块二：顶层页签 =================
         四枚平级：本地库 / 云端库 / 待上架库 / 已上架库（V1.2.84）。
         本地库/云端库留着：它们是「把哪个库送去待上架」的入口，撤掉就没地方标记了。
         「已上架库」原来缩在待上架库底下当子页签（待上架包 | 已上架包），现在是并列的顶栏页签 ——
         那一层子页签已收掉，`sub` 改成由 topTab 派生（见脚本里那段）。 -->
    <view class="lib-section">
      <view class="library-tab">
        <view class="tab-item" @tap="switchTab('local')">
          <text :class="{ active: topTab === 'local' }">本地库</text>
          <view v-if="topTab === 'local'" class="red-line"></view>
        </view>
        <view class="tab-item" @tap="switchTab('cloud')">
          <text :class="{ active: topTab === 'cloud' }">云端库</text>
          <view v-if="topTab === 'cloud'" class="red-line"></view>
        </view>
        <view class="tab-item" @tap="switchTab('listing')">
          <text :class="{ active: topTab === 'listing' }">待上架库</text>
          <view v-if="topTab === 'listing'" class="red-line"></view>
        </view>
        <view class="tab-item" @tap="switchTab('listed')">
          <text :class="{ active: topTab === 'listed' }">已上架库</text>
          <view v-if="topTab === 'listed'" class="red-line"></view>
        </view>
      </view>
    </view>

    <!-- ================= 屏幕：本地库 / 云端库 =================
         ★ 必须显式列出 local/cloud 两个值，**不能用 `topTab !== 'listing'`** ——
         新页签 'listed' 同样满足"不等于 listing"，会被这一屏截胡：
         点「已上架库」看到的会是本地库卡片。 -->
    <scroll-view v-if="topTab === 'local' || topTab === 'cloud'" class="main-scroll" scroll-y="true" :show-scrollbar="false">
      <view class="list-section">
        <view class="list-card" v-for="lib in libraries" :key="'lib-' + lib.code">
          <view class="card-left">
            <text class="card-code-line">{{ lib.code }}</text>
            <text class="card-info-line">数量{{ lib.cardCount }}张  {{ selectedVersion.name }}  {{ formatDate(lib.createdAt) || '2026/6/29' }}</text>
          </view>
          <view class="card-right">
            <view class="icon-btn upload-icon-btn" @tap="onUploadLib(lib)">
              <image class="act-icon" src="/static/icons/ic_upload.png" mode="aspectFit"></image>
            </view>
          </view>
        </view>
        <view class="empty-hint" v-if="libraries.length === 0">
          <text>{{ topTab === 'cloud' ? '暂无云端库数据' : '暂无本地库数据' }}</text>
        </view>
      </view>
    </scroll-view>

    <!-- ================= 屏幕：查看溯源（留档 · 行情） =================
         11 列、要 ~800px，手机竖屏放不下 —— 所以整屏 + 横向滚，不做弹层。 -->
    <scroll-view v-else-if="screen === 'trace'" class="main-scroll" scroll-y="true" :show-scrollbar="false">
      <view class="filter-bar trace-bar">
        <view class="status-col">
          <text class="parse-status status-done">留档 · 行情</text>
          <text class="batch-label">共 {{ 溯源行.length }} 条记录 · 一行 = 一张卡的存档</text>
        </view>
        <view class="action-col">
          <view class="filter-tag" @tap="screen = 'list'">
            <text class="filter-tag-text">‹ 返回包列表</text>
          </view>
        </view>
      </view>
      <scroll-view class="trace-scroll" scroll-x="true">
        <view class="trace-table">
          <view class="tr th">
            <text class="td w64">包</text>
            <text class="td w180">编号 / 卡名</text>
            <text class="td w62">罕贵</text>
            <text class="td w78">品相</text>
            <text class="td w52">备注</text>
            <text class="td w46">异画</text>
            <text class="td w58 num">原始库存</text>
            <text class="td w58 num">本次上架</text>
            <text class="td w58 num">目标库存</text>
            <text class="td w132">集换价 / 最低价</text>
            <text class="td w62 num">结果</text>
          </view>
          <view class="tr" v-for="r in 溯源行" :key="r._k">
            <text class="td w64">{{ r.包 }}</text>
            <view class="td w180 col">
              <text class="t-code">{{ r.编号 }}</text>
              <text class="t-name" :class="{ missing: !r.卡名 }">{{ r.卡名 || '（无名称）' }}</text>
            </view>
            <text class="td w62">{{ r.罕贵 }}</text>
            <text class="td w78">{{ r.品相 }}</text>
            <text class="td w52">{{ r.备注 || '—' }}</text>
            <text class="td w46">{{ r.异画 || '—' }}</text>
            <text class="td w58 num">{{ r.原始库存 }}</text>
            <text class="td w58 num">{{ r.本次上架 }}</text>
            <text class="td w58 num target">{{ r.目标库存 }}</text>
            <view class="td w132 col">
              <text class="t-jhj" v-if="r.集换价">¥{{ r.集换价 }}</text>
              <text class="t-low" v-if="r.最低价">¥{{ r.最低价 }}</text>
              <text class="none" v-if="!r.集换价 && !r.最低价">—</text>
            </view>
            <text class="td w62 num" :class="r.成功 ? 't-ok' : 't-bad'">{{ r.成功 ? '成功' : '失败' }}</text>
          </view>
          <view class="tr" v-if="溯源行.length === 0">
            <text class="td empty" style="width:100%">还没有上架记录</text>
          </view>
        </view>
      </scroll-view>
      <view class="hint trace-hint">
        这张表两用：<text class="b">价格两列 = 行情</text>；<text class="b">其余列 = 追溯存档</text> ——
        记录每张卡的原始库存 / 本次上架 / 目标库存 / 上传的编号与卡名 / 是否成功。
      </view>
    </scroll-view>

    <!-- ================= 屏幕：包详情 ================= -->
    <template v-else-if="screen === 'detail'">
      <!-- ★ 钉住区（V1.2.105）：包头那一行（带 ▶自动上架 / ■急停）+ 当前卡方框。
           跟列表屏同一个道理 —— 都得在 <scroll-view> **外面**。这个包几百行，
           往下翻着核卡时「自动上架 / 急停」不该跟着滚走。 -->
      <view class="pin-zone">
      <view class="detail-head">
        <text class="pname">{{ 当前包 }}</text>
        <text class="info">{{ 详情张数 }} 张 · 流程 A/B/C = {{ 详情cnt.A }}/{{ 详情cnt.B }}/{{ 详情cnt.C }}</text>
        <text class="spacer"></text>
        <text class="dstate" :class="{ done: 只读包 }" v-if="详情状态字">{{ 详情状态字 }}</text>
        <!-- 详情屏这枚**只跑眼下这个包**（选了起点就从那一行往下）；
             要跑整批的去包列表的动作栏点「一键上架」。参数必须显式写出来 ——
             直接写 @tap="onBatchListing" 会把事件对象当第一个参数塞进去。 -->
        <view class="btn primary sm" v-if="!只读包 && !listing" @tap="onBatchListing({ 只这个包: true })">
          <text class="btn-text">▶ 自动上架</text>
        </view>
        <view class="btn ghost sm" v-if="!只读包 && listing" @tap="终止批跑">
          <text class="btn-text">■ 急停</text>
        </view>
      </view>

      <!-- 当前卡方框（详情屏那一份，V1.2.105）。跟列表屏那份是**同一份 当前卡 状态**，
           谁在跑就谁那儿显示 —— 详情屏这枚是"只跑这个包"发起的，列表屏那枚是整批/勾选发起的。 -->
      <view class="cur-card" :class="当前卡档" v-if="当前卡">
        <text class="cc-label">{{ 当前卡前缀 }}当前卡牌</text>
        <text class="cc-code">{{ 当前卡.code }} · {{ 当前卡.rarity }}</text>
        <text class="cc-state">{{ 当前卡状态字 }}</text>
        <text class="cc-batch">{{ 当前卡位次 }}</text>
      </view>
      </view>

      <scroll-view class="main-scroll" scroll-y="true" :show-scrollbar="false">
      <!-- 有编号查不到目录 → 整包不允许上架。这条带子只在这一种情况下出现。
           两条出口都只是**就地**处理这一行，都不碰卡牌目录。 -->
      <view class="note-bar" v-if="!只读包 && 详情缺.length">
        ⚠ 这个包有 <text class="nb-b">{{ 详情缺.length }}</text> 个编号在卡牌目录里查不到（{{ 详情缺.join('、') }}）——
        <text class="nb-b">整包不允许上架</text>。
        <view class="nb-line">
          就地解决：
          <view class="nb-btns">
            <!-- ⚠️ 原型上这里还有一枚「改编号」，**故意没做**（V1.2.101）：
                 编号不是队列行自己能改的 —— 它是从库里那几张卡解析出来的，
                 只改行不改卡，两边当场对不上（上架推的是行的编号，库里留的是卡的编号）。
                 而改**卡**上的编号，现在只有识别上传页那批还没入库的卡有「信息有误」框能用，
                 库内已存在的卡没有入口（PUT /v1/api/cards/:id 有接口、没界面），
                 而且改完这批的 existQty/flow 也是拿旧编号算的，得重新解析。
                 所以这一支要等口径定了再做（见本轮报告里挂着的那条）。 -->
            <view class="nb-btn" @tap="删缺目录的行">删掉这些行</view>
          </view>
        </view>
        <!-- 这里原先还挂着一排「信息登记」块（V1.2.101），V1.2.107 起**撤掉了**：
             登记块改成每一行自己带一枚（见下面 .card-reg-block），带子里再来一排就成了
             同一件事的两个入口 —— 而且那一排只覆盖缺目录的行，看着像"缺目录才需要登记"。
             这一条只剩「删掉这些行」这枚**就地解决**的按钮，所以文案也跟着改了。 -->
        <view class="nb-line">
          来不及现在就补目录的，到下面每一行右边点「信息登记」先记一笔（补目录仍然是你本人到「卡牌资料库 ▸ 卡牌目录」去做）。
        </view>
      </view>
      <view class="hint" v-if="!只读包">
        点任意一行设为起点 → 点「自动上架」就从这一行往下跑，绿色的自动跳过；
        点右边「标记已上架」能把跑红的这一行按绿（人已经在店里手工上架的那种）——
        按绿前先在左边「上架价格」框里填个价，不然这一行就是"上架了却没价"；
        失败的行旁边也有「重跑」再来一次；
        每一行右边那枚<text class="b">「信息登记」</text>蓝色块是给卡名/卡图有问题的行记一笔待办（点亮变绿，后勤照清单改），卡没问题上架不受影响。
      </view>
      <view class="hint" v-else>
        <text v-if="详情来源 && 详情来源.来源 === 'staged'">
          这个包在本批里已经确认完成（还没归档），这里是只读的：要改先去「已上架包」那一页点它的「放回」。
        </text>
        <text v-else>这个包已经完成，这里是存档：能看到当时上的每一张卡、成功的和失败的。</text>
      </view>

      <view class="card-list">
        <view class="card-row" v-for="item in 详情项" :key="item.index"
              :class="{ listed: item.itemStatus === 'success', failed: item.itemStatus === 'failed',
                        running: item.itemStatus === 'running', ro: 只读包,
                        cur: !只读包 && item.index === 选中行 }"
              @tap="选起点(item)">
          <!-- 有图才是 <image>；查不到目录 / 图 404 时是一个红边白框，**不放卡背** ——
               原件就是这样，放张卡背上去看着像"这张卡长这样"。 -->
          <!-- 点图是「看大图」，不该顺手把这行选成起点 —— 所以 .stop。 -->
          <image v-if="卡图(item)" class="cimg" :src="卡图(item)" mode="aspectFill"
                 @tap.stop="看大图(item)" @error="onImgErr(item)" />
          <view v-else class="cimg miss"></view>
          <view class="cinfo">
            <!-- 第 1 行：主名（中文名优先）+ 右端那一组小签。
                 签子必须跟名字**同一行**、靠 margin-left:auto 顶到最右 —— 这就是「卡牌的右侧」；
                 名字太长时它自己换行，签子 flex-shrink:0 不会被压扁。 -->
            <view class="name-main">
              <text class="nm" :class="{ noname: 无名(item) }">{{ 主名(item) }}</text>
              <!-- 组内三枚签**一起常驻 DOM**（只读包整组不渲染），显隐全靠 CSS ——
                   条件插入会让这一行的高度跟着跳。 -->
              <view class="tag-group" v-if="!只读包">
                <text class="start-tag">起点</text>
                <text class="run-tag">正在执行中</text>
                <text class="flow-tag" :class="'flow-' + item.flow">流程{{ item.flow }}</text>
              </view>
            </view>
            <text class="name-sub" v-if="副名(item)">{{ 副名(item) }}</text>
            <!-- 第 3 行：编号 / 罕贵度 / 品相 / 备注 并排（编号和备注点一下复制） -->
            <view class="card-meta">
              <text class="meta-text code-text" @tap.stop="复制(item.code)">{{ item.code }}</text>
              <text class="meta-text">{{ item.rarity }}</text>
              <text class="meta-text">{{ item.condition || '流通品相' }}</text>
              <text class="meta-text" v-if="item.note" @tap.stop="复制(item.note)">{{ item.note }}</text>
            </view>
            <!-- 第 4 行：卡密 + 异画标签 + 右端的（详细 / 重跑 / 上架价格 / ×目标库存） -->
            <view class="card-codes">
              <!-- 卡密跟编号一样是「点一下复制」的靶子，所以同样 .stop —— 点它是要复制卡密，
                   不是要把这行设成起点。 -->
              <text class="ext-code" @tap.stop="复制(卡密(item))">{{ 卡密(item) || '（无卡密）' }}</text>
              <text class="alt-badge" v-if="item.altLabel && item.altLabel !== '初版'"
                    :class="item.altLabel === '待填' ? 'alt-none' : 'alt-has'">{{ item.altLabel }}</text>
              <view class="cqty-group">
                <view class="cdetail-btn" @tap.stop="开详细(item)">
                  <text class="cdetail-text">详细</text>
                </view>
                <!-- 「重跑」是**两种红**的出口：跑红的行，和卡在「执行中」的僵尸行（进程崩在中途留下的那种）。
                     ⚠️ 僵尸行这条原来漏了（V1.2.109 补）：那种行服务端**不会自己放回 pending**，
                     还专门拦着不让启动（auto-execute-vm.js 那道「僵尸行」检查），提示
                     「先把它们点『重跑』再启动」—— 可它只认 failed，running 的行**压根没渲染这颗键**。
                     服务端指的出口不存在，整批就谁也跑不了（实际撞上过：26-10-3-1 卡了 1 行，
                     人点 SD47 起不来，翻遍整批三百多个包一个「重跑」都没有）。
                     ⚠️ `&& !listing` 是防误伤：正常跑的时候「当前卡」那张就是 running，不加这一条，
                     跑动中那张旁边会一直挂着一颗永远点不动的键（后端有进程内锁，点了只会回
                     「这一批正在执行中，先终止再改条目」）。正常收尾时服务端 finally 会把 running 放回
                     pending，所以「running 且这一趟没在跑」基本就等于僵尸行。 -->
                <view class="cmini" v-if="!只读包 && (item.itemStatus === 'failed' || (item.itemStatus === 'running' && !listing))" @tap.stop="重跑一行(item)">
                  <text class="cmini-text">重跑</text>
                </view>
                <!-- 上架价格：绑的是 listingPrice（人定的价），不是集换价、也不是「价格(输出)」。
                     点输入框是要填价，不该顺手把这行选成起点 —— 所以 .stop。 -->
                <input v-if="!只读包" class="cprice-input" type="digit" :value="item.listingPrice || ''"
                       placeholder="上架价格" placeholder-class="cprice-ph"
                       @tap.stop="() => {}"
                       @blur="存价(item, $event)" @confirm="存价(item, $event)" />
                <text class="cprice-ro" v-else>{{ item.listingPrice || '—' }}</text>
                <text class="cqty" :id="'qty-' + item.index" @tap.stop="开数量(item)">× {{ item.totalQty || 0 }}</text>
              </view>
            </view>
            <text class="cerr" v-if="item.itemStatus === 'failed' && item.errorMessage">{{ 首行(item.errorMessage) }}</text>
          </view>

          <!-- 「信息登记」（V1.2.107）：跟识别上传页那张卡上的蓝绿块**同一个东西、同一份数据**
               （@/utils/cardMarks.js），只是搬到了待上架包的每一行上 —— 卡名/卡图有问题
               （或者编号还没进目录）先记一笔，后勤照这份清单改。蓝＝没登记，绿＝已登记，再点一下取消。
               粒度 (编号, 罕贵度)：同一个编号的不同罕贵度各登各的。
               放在「标记已上架」那条灰条**左边**：右边那枚是"这张卡跑成没跑成"的收尾动作，
               这枚跟跑的结果无关（红卡绿卡都能登记），两件事不该长得一样。
               ⚠️ .stop：这一行的整行点击是「设为起点」，登记不该顺手把起点也改了。
               ⚠️ 只读包（本批已确认的 / 已归档的）**不给这枚块** —— 用户这一支要的就是
               「点开**待上架包**能点」，只读屏上那一堆是存档，要动先去「已上架包」放回。 -->
          <view class="card-reg-block" v-if="!只读包" :class="{ on: 行已登记[item.index] }" @tap.stop="点登记块(item)">
            <text class="reg-text" :class="{ sm: 行已登记[item.index] }">{{ 行已登记[item.index] ? '信息已登记' : '信息登记' }}</text>
          </view>

          <!-- 右端竖直条：点一下人工标成「已上架」。跑成功过的行是绿的、点不动。 -->
          <view class="cmark" v-if="!只读包" :class="{ on: item.itemStatus === 'success' }" @tap.stop="标记已上架(item)">
            <text class="cmark-text">{{ item.itemStatus === 'success' ? '已上架' : '标记已上架' }}</text>
          </view>
        </view>
        <view class="empty-hint" v-if="详情项.length === 0"><text>这个包没有条目</text></view>
      </view>
      </scroll-view>
    </template>

    <!-- ================= 屏幕：库位详情（一个盒子里的全部卡，跨包） =================
         三步走的终点站里唯一能下钻的一层。用户要的口径：「看这个库位里的全部卡（跨包）」。
         为什么非要有这一层：归档是按**包**存的，实物是按**盒子**码的 —— 格子对不上就核不了货。
         全程只读：已经归档进库位的卡不该在这一层改，要改只能整批撤回。
         ★ 数据源是 `GET /v1/api/cards/archived`（Card 文档），**不是**队列里的 serialList ——
           归档时卡位号被整库重排过，队列那份是归档前的旧号（见脚本里 包名表 那段注释）。 -->
    <scroll-view v-else-if="screen === 'shelf'" class="main-scroll" scroll-y="true" :show-scrollbar="false">
      <view class="filter-bar bar-pad">
        <view class="status-col">
          <text class="parse-status status-done">{{ 当前库位 }}</text>
          <text class="batch-label">{{ 当前库位卡们.length }} 张 · 混装 {{ 当前库位包数 }} 个包</text>
        </view>
        <view class="action-col">
          <view class="filter-tag" @tap="screen = 'list'">
            <text class="filter-tag-text">‹ 返回库位列表</text>
          </view>
        </view>
      </view>
      <view class="hint shelf-hint">
        <text>点任意一行 → 看这个包当时的全貌（从盒子反查包，是这一屏最常用的一步）。</text>
      </view>
      <view class="card-list" v-if="当前库位卡们.length">
        <view class="card-row listed ro" v-for="(c, i) in 当前库位卡们" :key="c.serial || i"
              @tap="从库位看包(c)">
          <!-- 查不到目录的照样**红边白框、不放卡背** —— 跟这一页别处的口径一致，
               也正好是"照着册子核实物时该停下来看一眼"的那些。 -->
          <image v-if="卡图(c)" class="cimg" :src="卡图(c)" mode="aspectFill"
                 @tap.stop="看大图(c)" @error="onImgErr(c)" />
          <view v-else class="cimg miss"></view>
          <view class="cinfo">
            <view class="name-main">
              <text class="nm" :class="{ noname: 无名(c) }">{{ 主名(c) }}</text>
            </view>
            <text class="name-sub" v-if="副名(c)">{{ 副名(c) }}</text>
            <view class="card-meta">
              <text class="meta-text code-text" @tap.stop="复制(c.code)">{{ c.code }}</text>
              <text class="meta-text">{{ c.rarity }}</text>
              <text class="meta-text">{{ c.condition || '流通品相' }}</text>
              <text class="meta-text" v-if="c.note" @tap.stop="复制(c.note)">{{ c.note }}</text>
            </view>
            <view class="card-codes">
              <text class="ext-code" @tap.stop="复制(卡密(c))">{{ 卡密(c) || '（无卡密）' }}</text>
              <text class="alt-badge alt-has" v-if="c.altLabel && c.altLabel !== '初版'">{{ c.altLabel }}</text>
              <!-- 卡位号按 monospace 排（跟详情弹层里「实体卡」那一页同一套观感）——
                   照着号去盒子里找卡，字距不匀会看错行。 -->
              <text class="loc-serial">{{ c.serial }}</text>
              <!-- 这一行是哪个包的。认不出批次的老卡不写，宁可空着也不猜个包名上去。 -->
              <text class="loc-lib" v-if="卡片包(c)">{{ 卡片包(c) }}</text>
              <text class="cprice-ro">{{ c.listedPrice ? '¥' + c.listedPrice : '—' }}</text>
            </view>
            <text class="cerr" v-if="未找到[c.code]">这个编号在卡牌目录里查不到 —— 图出不来，得先补目录</text>
          </view>
        </view>
      </view>
      <view class="empty-hint" v-else><text>这个库位里没有卡。</text></view>
    </scroll-view>

    <!-- ================= 屏幕：包列表 =================
         **三段**，看 `sub`：
           pending —— 「待上架库 → 待上架包」：还没确认完成的包。
           staged  —— 「待上架库 → 已上架包」：本批已确认、还没归档的那一撮（V1.2.103 起住这儿）。
           listed  —— 顶栏「已上架库」：只有真归档过的（历史批次 + 按库位看）。
         走过的弯路记一笔：V1.2.84 把「待上架包/已上架包」这层子页签撤了、顶栏升成四枚，
         于是 staged 那一撮挤进了「已上架库」的头顶 —— "这批确认完了没"和"库里到底进了什么"
         混在同一屏，两件事分不开。V1.2.103 把那撮下放回子页签，顶栏那枚只留归档过的。
         `sub` 仍是派生的（topTab + 待上架子），见脚本里那段。 -->
    <template v-else>
      <!-- ★ 钉住区（V1.2.105）：子页签 / 动作栏 / 批次条 / 进度条 / 勾选条 / 当前卡方框。
           它必须是下面那个 <scroll-view> 的**兄弟**，不能放进去 —— 页面是 height:100vh
           + flex 列 + 内部 scroll-view，position:sticky 在 scroll-view 里不可靠。
           （原型 :701-705 明写了"真代码不能照抄这份 sticky"，指的就是这一处。）
           钉的是"我要干什么"那一圈：翻包列表翻到第两百行时，「一键上架 / 终止 / 批量完成」
           还应该在眼前，不该跟着滚走。 -->
      <view class="pin-zone">
      <!-- 子页签：只在「待上架库」这一屏出现。
           别跟顶栏那枚「已上架库」混 —— 那枚只放**真归档过的**，这枚放"已确认、还没归档"的。 -->
      <view class="sub-tabs" v-if="topTab === 'listing'">
        <view class="sub-tab" :class="{ on: sub === 'pending' }" @tap="切待上架子('pending')">
          <text class="sub-t">待上架包</text>
          <view v-if="sub === 'pending'" class="sub-line"></view>
        </view>
        <view class="sub-tab" :class="{ on: sub === 'staged' }" @tap="切待上架子('staged')">
          <text class="sub-t">已上架包</text>
          <view v-if="sub === 'staged'" class="sub-line"></view>
        </view>
      </view>

      <!-- 动作栏 -->
      <view class="filter-bar bar-pad">
        <view class="status-col">
          <text class="parse-status" :class="parseStatusClass">{{ sub === 'pending' ? parseStatusText : '已上架' }}</text>
          <text class="batch-label" v-if="sub === 'pending'">
            {{ currentBatchId ? '批次：' + currentBatchId : '批次：暂无' }}
          </text>
          <text class="batch-label" v-else-if="sub === 'staged'">{{ 已上架包头文案 }}</text>
          <text class="batch-label" v-else>{{ 已上架头文案 }}</text>
        </view>
        <view class="action-col">
          <template v-if="sub === 'pending'">
            <view class="filter-tag parse-tag" v-if="!currentBatchId" @tap="onParseAll">
              <text class="filter-tag-text">开始解析</text>
            </view>
            <!-- 这一枚是**整批**（不带包、不带起点），跟详情屏那枚分工不同。 -->
            <view class="filter-tag listing-tag" v-if="currentBatchId && !listing" @tap="onBatchListing()">
              <text class="filter-tag-text">一键上架</text>
            </view>
            <!-- 终止走 终止批跑（不是直接 onStopListing）：批跑那一趟是前端循环驱动的，
                 只发服务端信号的话，这一趟还会"顺手"起下一个包。见 终止批跑()。 -->
            <view class="filter-tag listing-tag stop" v-if="listing" @tap="终止批跑">
              <text class="filter-tag-text">终止</text>
            </view>
            <!-- 撤回是全代码里唯一能把上架批次解锁的路，不能撤 -->
            <view class="filter-tag back-tag" v-if="currentBatchId && !listing" @tap="onRevertParse">
              <text class="filter-tag-text">撤回</text>
            </view>
          </template>
          <!-- 批量完成：挂在「已上架包」这一页（V1.2.103 起），搬的是这一批 —— 判据见 整批说明()。
               挂在这儿是因为"全部确认完了"这件事就发生在这一页；原来挂在「已上架库」上，
               而那一屏现在只放真归档过的了。 -->
          <view class="filter-tag finish-tag" v-if="sub === 'staged'" :class="{ on: 整批可完成 }" @tap="onFinishAll">
            <text class="filter-tag-text">批量完成</text>
          </view>
          <view class="filter-tag trace-tag" @tap="screen = 'trace'">
            <text class="filter-tag-text">查看溯源</text>
          </view>
          <view class="filter-tag set-tag" @tap="onSettings">
            <image class="icon-xs" src="/static/icons/ic_settings.png" mode="aspectFit"></image>
            <text class="filter-tag-text">设置</text>
          </view>
        </view>
      </view>

      <view class="batch-bar" v-if="sub === 'pending' && currentBatchId">
        <text class="batch-summary-text">批次 {{ currentBatchId }}  {{ 全部包们.length }} 个包 · {{ 队列张数 }} 张  {{ selectedVersion.name }}</text>
      </view>

      <view class="progress-bar" v-if="listing">
        <view class="progress-fill" :style="{ width: progressPct + '%' }"></view>
        <text class="progress-text">{{ listingProgress }}</text>
      </view>

      <!-- 勾选条（V1.2.104）：勾几个包，一次把这几个包**按勾选顺序**跑完。
           「全选」和右边那枚按钮长什么样，只由 全选态 / 勾选包 / listing 派生 ——
           别处不要再各写一份，两处迟早走散。
           那一枚按钮**两种身份**：没跑 = 「▶ 开始上架」，跑着 = 「■ 终止」（急停整趟）。 -->
      <view class="sel-bar" v-if="sub === 'pending' && currentBatchId && 包们.length > 0">
        <view class="sel-all" :class="{ dim: listing }" @tap="切换全选">
          <view class="checkbox" :class="{ checked: 全选态 }"><text class="ck">✓</text></view>
          <text class="sel-all-t">全选</text>
        </view>
        <text class="sel-count">已选 <text class="sel-b">{{ 勾选包.length }}</text> 个包 · 共 <text class="sel-b">{{ 可勾包数 }}</text> 个</text>
        <text class="spacer"></text>
        <view class="sel-start" :class="{ off: !listing && !勾选包.length, running: listing }" @tap="开始批跑">
          <text class="sel-start-t">{{ listing ? '■ 终止' : '▶ 开始上架' }}</text>
        </view>
      </view>

      <!-- 当前卡方框（V1.2.105）：一趟跑下来只有进度条在动的话，看不出在跑哪一张 ——
           出了问题只知道"跑过 137 张"，不知道"卡在哪一张"。数据源是同一份 item-progress
           （服务端 auto-execute-vm.js:277 每张开始跑时发一次，带 code/rarity/detail）。
           ⚠️ 详情屏有一份一模一样的（见那边），两块**共用 当前卡 这一份状态**，不各存一份。 -->
      <view class="cur-card" :class="当前卡档" v-if="当前卡">
        <text class="cc-label">{{ 当前卡前缀 }}当前卡牌</text>
        <text class="cc-code">{{ 当前卡.code }} · {{ 当前卡.rarity }}</text>
        <text class="cc-state">{{ 当前卡状态字 }}</text>
        <text class="cc-batch">{{ 当前卡位次 }}</text>
      </view>
      </view>

      <scroll-view class="main-scroll" scroll-y="true" :show-scrollbar="false">
      <!-- 待上架包 -->
      <view class="pkg-list" v-if="sub === 'pending'">
        <!-- 左竖条：blocked（有编号查不到目录）= 橙，其余一律 frozen = 蓝。
             跟原件一样**没有"透明"这一档** —— 一条不画色的左边线，看着像没加载完。 -->
        <view class="pkg" v-for="p in 包们" :key="p.pack"
              :class="[p.缺.length ? 'blocked' : 'frozen', { checked: 勾选包.includes(p.pack) }]"
              @tap="打开包(p.pack, false, '')">
          <view class="pkg-main">
            <view class="pkg-bar"><view class="bar"><view class="bar-fill" :style="{ width: p.pct + '%' }"></view></view></view>
            <view class="row2">
              <text class="name">{{ p.pack }}</text>
              <text class="qty">{{ p.total }} 张</text>
              <text class="spacer"></text>
              <text class="state">{{ p.状态 }}</text>
            </view>
            <view class="flows">
              <text class="chip a">流程A {{ p.cnt.A }}</text>
              <text class="chip b">流程B {{ p.cnt.B }}</text>
              <text class="chip c">流程C {{ p.cnt.C }}</text>
              <text class="chip warn" v-if="p.缺.length">⚠ {{ p.缺.length }} 个编号缺目录</text>
            </view>
          </view>
          <!-- 包级「确认完成」：把这一个包从「待上架包」挪进「已上架包」（V1.2.103 起；原来挪进的是
               「已上架库」的待归档那一撮）。只是收起来，库一个字不动。
               灰的也画出来、点得动 —— 点一下toast说为什么不行，比一个点不动的死块强。
               可点判据看 包可确认(): 缺目录 / 有没跑完的 / 有跑红的，三种都不给搬
               （红的那档是 V1.2.100 加的，跟后端 packs/complete 同一口径）。 -->
          <!-- 勾选竖条（V1.2.104）：位置是用户定的 —— **紧挨在「确认完成」左边**、同宽（38px）、
               同一块竖矩形，点一下切换。模样：未选 = 白底灰字「勾选」；已选 = 红底白字
               「✓ 已选」，同时整张卡描一圈红边。配色跟「确认完成」那枚一样是纯色块：白 → 红。
               位置在**卡片右端**不是左端：竖着一条更像按钮、也好点（左边那条状态竖条说的是
               "包的状态"，两回事，别让它俩挤在一块）。
               `.stop` 是必须的 —— 整块卡片是"点开进详情"，不拦的话点勾选会顺手把自己送进详情页。 -->
          <view class="pkg-sel" :class="{ on: 勾选包.includes(p.pack), dim: listing }" @tap.stop="点包勾选(p)">
            <text class="st">{{ 勾选包.includes(p.pack) ? '✓ 已选' : '勾选' }}</text>
          </view>
          <view class="pkg-finish" :class="包可确认(p) ? 'ok' : 'off'" @tap.stop="确认包(p)">
            <text class="ft">确认完成</text>
          </view>
        </view>

        <!-- 还没解析的待上架库：解析入口 -->
        <view class="pkg-unparsed" v-if="!currentBatchId && 待解析库.length > 0">
          <text class="up-title">还没解析的待上架库</text>
          <view class="up-row" v-for="sc in 待解析库" :key="sc.code">
            <text class="up-code">{{ sc.fullCode || sc.code }}</text>
            <text class="up-cnt">{{ sc.currentCards || 0 }} 张</text>
          </view>
          <text class="up-hint">点上面那枚红色的「开始解析」把它们解析成待上架包。</text>
        </view>

        <view class="empty-hint" v-if="包们.length === 0 && 待解析库.length === 0">
          <!-- 空态有三层，别混：都确认完了 / 这一批本来就没包 / 连待上架库都是空的。
               （少了中间那层判断的话，把包全确认掉之后会显示"这一批没有包" —— 假话。） -->
          <text v-if="全部包们.length > 0">这一批的包都挪进「已上架包」了 —— 去那一页核对，或点「批量完成」归档</text>
          <text v-else>{{ currentBatchId ? '这一批没有包' : '待上架库是空的 —— 去「本地库 / 云端库」把库标成待上架' }}</text>
        </view>
      </view>

      <!-- 已上架包（V1.2.103 起）。这一页住的是**本批已确认、还没归档**的包 ——
           原来它们挤在「已上架库」的头顶上，跟真归档过的混在一屏里，两件事分不开：
           「这批确认完了没」和「库里到底进了什么」。现在顶栏那枚只放后者。
           这一页全是只读的（包还挂在库上，标的是"收起来"）：要改点「放回」，退回「待上架包」。 -->
      <view class="pkg-list" v-else-if="sub === 'staged'">
        <view class="pkg done" v-for="p in 已确认包们" :key="p.pack"
              @tap="打开包(p.pack, true, '', 'staged')">
          <view class="pkg-main">
            <view class="pkg-bar"><view class="bar"><view class="bar-fill" :style="{ width: p.pct + '%' }"></view></view></view>
            <view class="row2">
              <text class="name">{{ p.pack }}</text>
              <text class="qty">{{ p.total }} 张</text>
              <text class="spacer"></text>
              <text class="state">完成于 {{ formatDate(p.完成于) }}</text>
            </view>
            <view class="flows">
              <text class="chip a">成功 {{ p.成功 }}</text>
              <text class="chip warn" v-if="p.失败">失败 {{ p.失败 }}（待处理）</text>
              <text class="chip batch">本批已确认 · 待归档</text>
            </view>
          </view>
          <!-- 「放回」：把包退回「待上架包」接着改。整批真归档要走「批量完成」，
               归档过的那批要退只能整批撤回（见「撤回」那枚）。 -->
          <view class="pkg-finish" @tap.stop="放回包(p)"><text class="ft">放回</text></view>
        </view>
        <view class="empty-hint" v-if="已确认包们.length === 0">
          <text v-if="全部包们.length > 0">这一批还没有确认完成的包 —— 回「待上架包」把包点「确认完成」</text>
          <text v-else>没有待归档的包</text>
        </view>
      </view>

      <!-- 已上架库。V1.2.103 起这一屏**只放真归档过的**（历史已归档 + 按库位看）：
           本批已确认·待归档那一撮已经下放到「待上架库 → 已上架包」那一页了。
           V1.2.102 起这一屏有**两种看法**（见上面那枚切换）：
           按包看（= 历史已归档）／按库位看（= 归档之后卡躺在哪个盒子，照着册核实物用）。 -->
      <view class="pkg-list" v-else>
        <!-- 两枚切换：按包看 / 按库位看（V1.2.102）。**加切换、不替换** ——
             按包看答的是"这批归档了没"，按库位看答的是"照着册核实物对不对得上"，
             两个问题都得答，少哪个都得另找一屏。 -->
        <view class="seg-bar">
          <view class="seg" :class="{ on: 已上架看法 === 'pack' }" @tap="切已上架看法('pack')">
            <text class="seg-t">按包看</text>
          </view>
          <view class="seg" :class="{ on: 已上架看法 === 'lib' }" @tap="切已上架看法('lib')">
            <text class="seg-t">按库位看</text>
          </view>
          <text class="seg-note" v-if="已上架看法 === 'pack'">归档了没</text>
          <text class="seg-note" v-else>照着册核实物</text>
        </view>

        <template v-if="已上架看法 === 'pack'">
        <view class="pkg done" v-for="p in 已上架包们" :key="p.批次 + '|' + p.pack"
              @tap="打开包(p.pack, true, p.批次, 'archive')">
          <view class="pkg-main">
            <view class="pkg-bar"><view class="bar"><view class="bar-fill" style="width:100%"></view></view></view>
            <view class="row2">
              <text class="name">{{ p.pack }}</text>
              <text class="qty">{{ p.total }} 张</text>
              <text class="spacer"></text>
              <text class="state">完成于 {{ formatDate(p.完成于) }}</text>
            </view>
            <view class="flows">
              <text class="chip a">成功 {{ p.成功 }}</text>
              <text class="chip warn" v-if="p.失败">失败 {{ p.失败 }}（待处理）</text>
              <!-- 批次号这枚 chip 是原件没有的：原件只有一批，真程序里同一个包名
                   可以在好几批里各出现一次，不留这枚就分不出点的是哪一批。 -->
              <text class="chip batch">批次 {{ p.批次 }}</text>
            </view>
          </view>
          <!-- 这一屏只剩历史归档的包 → 一律死块「已归档」（原件上它也是 cursor:default，点不动）。
               归档那批真要退，走「撤回」整批还原；本批"已确认·待归档"那种在「已上架包」那一页。 -->
          <view class="pkg-finish ok"><text class="ft">已归档</text></view>
        </view>
        <view class="empty-hint" v-if="已上架包们.length === 0">
          <text>还没有归档过的批次 —— 去「待上架库 → 已上架包」点「批量完成」</text>
        </view>
        </template>

        <template v-else>
          <!-- 按库位看：一个盒子一张卡（跨包、跨批次）。
               混装的那几个包名直接摆在卡上 —— 这一屏答的就是"这个盒子里都有谁"。 -->
          <view class="lib-note" v-if="库位载入中"><text>正在拉库位数据…</text></view>
          <view class="pkg done" v-for="g in 库位组们" :key="g.lib" @tap="打开库位(g.lib)">
            <view class="pkg-main">
              <view class="pkg-bar"><view class="bar"><view class="bar-fill" style="width:100%"></view></view></view>
              <view class="row2">
                <text class="name">{{ g.lib }}</text>
                <text class="qty">{{ g.张 }} 张</text>
                <text class="spacer"></text>
                <text class="state">{{ g.包们.length }} 个包</text>
              </view>
              <view class="flows">
                <text class="chip b" v-for="b in g.包们" :key="b.pack">{{ b.pack }} {{ b.张 }}</text>
              </view>
            </view>
            <view class="pkg-finish ok"><text class="ft">看卡</text></view>
          </view>
          <view class="empty-hint" v-if="!库位载入中 && 库位组们.length === 0">
            <text>还没有卡进库位 —— 点「批量完成」真归档之后，这里才有东西</text>
          </view>
          <view class="lib-note" v-if="库位组们.length > 0">
            <text>共 {{ 库位总张数 }} 张卡 · {{ 库位组们.length }} 个库位。点一个库位 → 看那个盒子里的全部卡（跨包、跨批次）。</text>
          </view>
        </template>
      </view>
      </scroll-view>
    </template>

    <!-- ================= 详细弹层：一个弹层，两张脸 =================
         脸① 输出参数（14 项）／脸② 实体卡（这一行背后每张实体卡的卡位号）。
         手机上 420px 宽的弹层并排放不下两块，所以翻页，默认停「输出参数」。 -->
    <view class="out-mask" v-if="详细开" @tap="详细开 = false">
      <view class="out-box" @tap.stop>
        <view class="out-head">
          <text class="out-title">{{ 详细行.code }} {{ 详细行.rarity }} · {{ 主名(详细行) }}</text>
          <text class="out-close" @tap="详细开 = false">✕</text>
        </view>
        <view class="dt-tabs">
          <view class="dt-tab" :class="{ on: 详细页 === 'out' }" @tap="详细页 = 'out'">
            <text class="dt-t">输出参数</text><text class="dt-n">{{ 有输出 ? 14 : 0 }}</text>
          </view>
          <view class="dt-tab" :class="{ on: 详细页 === 'inv' }" @tap="详细页 = 'inv'">
            <text class="dt-t">实体卡</text><text class="dt-n">{{ (详细行.serialList || []).length }}</text>
          </view>
        </view>
        <scroll-view class="dt-body" scroll-y="true">
          <view v-if="详细页 === 'out'">
            <!-- 一张都没跑过：别丢一张全是「（空）」的表出来 -->
            <view class="out-none" v-if="!有输出">
              这张卡还没跑过自动上架，没有任何输出参数。<br>
              跑完之后这 14 项会回填到这里。
            </view>
            <template v-else>
              <!-- 14 项分三组（照原件），分组只为了扫读：一眼知道这堆是"卡的身份"
                   还是"上架内容"，不用逐行读键名去猜。 -->
              <template v-for="g in 输出分组" :key="g.名">
                <view class="out-g">{{ g.名 }}<text class="out-n">{{ g.项.length }} 项</text></view>
                <view class="out-row" v-for="f in g.项" :key="f.字段">
                  <text class="out-k">{{ f.名 }}</text>
                  <text class="out-v" v-if="详细行[f.字段]">{{ 详细行[f.字段] }}</text>
                  <text class="out-v empty" v-else>（空）</text>
                </view>
              </template>
            </template>
            <view class="out-err" v-if="详细行.errorMessage">失败原因：{{ 详细行.errorMessage }}</view>
          </view>
          <view v-else>
            <!-- 一张都没有时别丢一张空表出来 -->
            <view class="out-none" v-if="(详细行.serialList || []).length === 0">
              这一行没有实体卡位号。
            </view>
            <template v-else>
              <view class="loc-head">
                <text>共 {{ (详细行.serialList || []).length }} 张实体卡</text>
                <text class="loc-head-r">原始库存 {{ 详细行.existQty || 0 }} 张 · 目标库存 {{ 详细行.totalQty || 0 }} 张</text>
              </view>
              <view class="loc-row" v-for="(s, i) in (详细行.serialList || [])" :key="i">
                <text class="loc-idx">{{ i + 1 }}</text>
                <text class="loc-serial">{{ s }}</text>
                <text class="loc-cond">{{ 详细行.condition || '流通品相' }}</text>
                <text class="loc-note" v-if="详细行.note">{{ 详细行.note }}</text>
                <text class="loc-lib">{{ 详细行.code }}</text>
                <view class="loc-del" v-if="!只读包" @tap.stop="onRemoveCopy(s)">
                  <text class="loc-del-text">删除</text>
                </view>
              </view>
              <view class="loc-all" v-if="!只读包">
                <view class="loc-del-all" @tap="onRemoveAllCopies">
                  <text class="loc-del-all-text">全部删除</text>
                </view>
              </view>
            </template>
          </view>
        </scroll-view>
      </view>
    </view>

    <!-- ================= 卡图全屏 ================= -->
    <view class="big-mask" v-if="大图" @tap="大图 = ''">
      <image class="big-img" :src="大图" mode="aspectFit" />
      <text class="big-tip">点任意处关闭</text>
    </view>

    <!-- ================= 「× 目标库存」三行明细 =================
         照原件：贴着那枚小框冒出来（默认在小框正上方、右边缘对齐；上面放不开就翻到下面）。
         位置靠 createSelectorQuery 量，量不到就退回屏幕正中。
         原件没有遮罩 —— 但手机上没有"点别处关掉"这件事，所以铺一层**全透明**的接点击层，
         点哪儿都收起来，看着还是原件那样。 -->
    <view class="qty-mask" v-if="qty弹.open" @tap="qty弹.open = false"></view>
    <view class="qty-pop" v-if="qty弹.open" id="qtyPop" :style="qty弹样式" @tap.stop>
      <view class="qp-line"><text class="qp-k">原始库存</text><text class="qp-v">{{ qty弹.item.existQty || 0 }} 张</text></view>
      <view class="qp-line"><text class="qp-k">本次上架</text><text class="qp-v">{{ qty弹.item.addQty || 0 }} 张</text></view>
      <view class="qp-line"><text class="qp-k">目标库存</text><text class="qp-v total">{{ qty弹.item.totalQty || 0 }} 张</text></view>
    </view>

    <!-- 版本选择弹窗 -->
    <VersionPicker ref="versionPickerRef" :top-offset="54" @select="onVersionSelect" />
  </view>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import VersionPicker from '@/components/VersionPicker.vue'
import { getLocalLibraries, getCloudLibraries, markCards, deleteCardMark } from '@/api/index.js'
import { authFetch } from '@/utils/authFetch.js'
import { buildCardImgUrl } from '@/api/cardDb.js'
import wsClient from '@/api/ws-client.js'
// 「信息登记」的判定与缓存：跟识别上传页**共用同一份**（含 `rarity:''` 是通配这条规则）。
// 本页只用它来画缺目录带子上那个蓝块/绿块 —— 登记不代表目录补上了，那张卡照样上不了架。
import { loadMarkedCodes, 已登记, markKeyOf, 来源 as 登记来源, 登记条目, 删除条目 } from '@/utils/cardMarks.js'

// ===== 屏幕与页签 =====
const topTab = ref('listing')        // local | cloud | listing | listed（默认停在待上架库 —— 这页的主要动作都在这儿）
// 「待上架库」底下有**两枚子页签**：待上架包 | 已上架包（V1.2.103 起把这一层加回来）。
//   · 待上架包 —— 包内 0 灰 0 红才点得动「确认完成」；点一下就挪进「已上架包」。
//   · 已上架包 —— 本批已确认、还没归档的那一撮。能「放回」接着改；全部好了点「批量完成」整批进「已上架库」。
// 顶栏那枚「已上架库」只放**真归档过的**（历史已归档 + 按库位看）。
//
// ★ `sub` 仍然是**派生**的，不另开一个能写错的口子：真源只有 topTab 和 待上架子 两个，
//   `sub` 永远是它俩的函数 —— 画的和选的不会漂。下面二十来处 `sub === 'pending' / 'listed'`
//   一个字都不用改。代价照旧：computed 没有 setter，任何 `sub.value = …` 都会当场报错
//   （这是**好事**，漏改的地方藏不住）。
const 待上架子 = ref('pending')     // pending | staged（只在 topTab === 'listing' 时有意义）
const sub = computed(() => (topTab.value === 'listed' ? 'listed' : 待上架子.value))
// 切子页签。换页要退回包列表屏 —— 停在包详情里的话，页签动了、屏幕没动，看着像没生效。
const 切待上架子 = (v) => { 待上架子.value = v; screen.value = 'list' }
const screen = ref('list')           // list | detail | trace | shelf
const selectedVersion = ref({ name: '游戏王日文', lang: '日文', id: 1 })
const libraries = ref([])
const versionPickerRef = ref(null)

// ===== 当前待上架批次 =====
const currentBatchId = ref(null)
const 队列items = ref([])            // 这一批的全部队列条目（ListingQueue）
const 名称表 = ref({})               // code → { cnName, jpName, extCode, altLabels }
const 未找到 = ref({})               // code → true（卡牌目录里查不到）
const 图挂了 = ref({})               // code → true（图片地址 404；单独记，别把卡密一起抹掉）
const 待解析库 = ref([])             // 标了 pending 但还没解析的库

// ===== 当前正在处理哪张卡（V1.2.105）=====
// 服务端每张开始跑时发一条 item-progress（auto-execute-vm.js:277），带
// code / rarity / step / stepName / detail。前端原先把这份丢了、只用 msg.index ——
// 于是一趟跑下来界面上只有进度条在动，出了事只知道"跑到第几行"，不知道卡在哪一张。
// 现在留住它。**列表屏和详情屏共用这一份**，两处只画不存。
const 当前卡 = ref(null)             // null | { index, code, rarity, detail }

// ===== 已上架 =====
const 已上架批次 = ref([])           // [{ batchId, completedAt, items: [] }]
// 本批里已经点过包级「确认完成」的包：[{ pack, at }]。存后端（ListingBatch.donePacks），
// 跟着 拉队列 一起刷新 —— 刷新页面/换设备都不丢，这也是它没走 localStorage 的原因。
// 只存名字+时间，**不存 items**：行会被删/重跑而变，存快照会僵。
const 已完成包 = ref([])

// ===== 包的多选（V1.2.104）=====
// 存**数组**不是 Set：顺序要留着 —— 「开始上架」是按勾选的先后一个包一个包跑的，
// 下标就是"第几个跑"。用 Set 的话顺序会退化成包列表的顺序（原型 :1503 那份就是 set，
// 跟它自己文档里写的"按勾选顺序"对不上；这里按文档来）。
const 勾选包 = ref([])               // [pack…]，下标 = 勾选的先后
// 非 null = 这一趟批跑还在走。**终止就是把它置 null** —— 跑包的循环每跑完一个包
// 抬头看它一眼，没了就退。跨包终止只能由这个循环自己管：每次请求进服务端都会
// resetAbort（auto-execute-vm.js:239），旗子留不到下一个包（V1.2.98 的教训）。
const 批跑 = ref(null)               // null | { 名单: [pack…], 第几 }

// ===== 已上架库 · 两种看法（V1.2.102）=====
// 「按包看」和「按库位看」不是同一批卡的两种切法，是**两个问题**：
//   · 按包看 —— "这个包归档了没"：同一批的行在一起，能确认、能放回。
//   · 按库位看 —— "A0-000-07 这个盒子里的卡跟册子对不对得上"：实物是**按盒子**码的，
//     而一个包里的卡散在好几个库位、一个库位混装好几个包的卡，照包看永远对不上货架。
// 所以是**加一枚切换**，不是把按包看换成按库位看（见改造清单 §1.3）。
const 已上架看法 = ref('pack')       // pack | lib
const 库位卡表 = ref([])             // GET /v1/api/cards/archived 原样返回的 Card 文档
const 库位拉了 = ref(false)          // 拉过一次就不再拉（空结果也算拉过）
const 库位载入中 = ref(false)
const 当前库位 = ref('')             // 库位详情屏看的是哪个盒子（libraryCode）

// ===== 详情屏 =====
// { 只读, 批次, pack, 来源 }。来源：'archive' = 已归档批次的包（历史），
// 'staged' = 本批已确认但还没归档的包（刚搬进「已上架库」那种）。两者都只读，但数据源不同。
const 详情来源 = ref(null)
// 包详情是从哪一屏点进来的 —— 返回时退**回那一屏**，别一律丢回包列表。
// 主要是库位详情：点一行看那个包的全貌，看完当然要回到那个盒子继续核，
// 丢回包列表就等于每看一张卡重找一次库位。
const 详情退回 = ref('list')         // list | shelf
// 自动上架的起点：当前包内某一行的 ListingQueue.index，null = 从第一行跑。
// 用 index 当键而不是原型的 `code|rarity` —— index 是批内唯一、且删行后**不重编号**
// （queues.js 只删不重排），行上本来就拿它当 :key，是天然的稳定标识。
const 选中行 = ref(null)
const 详细开 = ref(false)
const 详细页 = ref('out')            // out | inv
const 详细行 = ref({})
const 大图 = ref('')
const qty弹 = ref({ open: false, item: {} })

// ===== 执行状态 =====
const parsing = ref(false)
const listing = ref(false)
const listingProgress = ref('')
const progressPct = ref(0)
const modeMethod = ref(window._tcg_mode || '虚拟机AI')
const modeOnline = ref(false)
let _modeTimer = null

// 输出参数的展示顺序 —— 跟后端 services/listingOutputs.js 的字段表一一对应
const 输出字段 = [
  { 名: '集换价', 字段: 'outputJhj' },
  { 名: '最低价', 字段: 'outputLowest' },
  { 名: '价格', 字段: 'outputPrice' },
  { 名: '编号', 字段: 'outputCode' },
  { 名: '罕贵度', 字段: 'outputRarity' },
  { 名: '中文卡名', 字段: 'outputCnName' },
  { 名: '中文别名', 字段: 'outputCnAlias' },
  { 名: '语种', 字段: 'outputLang' },
  { 名: '游戏版本', 字段: 'outputGameVersion' },
  { 名: '行数', 字段: 'outputRows' },
  { 名: '数量', 字段: 'outputQty' },
  { 名: '备注', 字段: 'outputNote' },
  { 名: '输入框编号', 字段: 'outputInputCode' },
  { 名: '运行状态', 字段: 'outputStatus' },
]

// 这 14 项分三组，照着「看的时候想问什么」分：
//   ① 卡的身份 —— 这是哪张卡？   ② 上架内容 —— 这一行打算怎么上？   ③ 结果与备注 —— 跑成没有？
// ⚠️ 分组只影响**显示**（顺序 + 小标题带子），一个字都不动 输出字段 那串顺序 ——
//    落库照的正是那串原始顺序。
const 取字段 = (名) => 输出字段.find(f => f.名 === 名)
const 输出分组 = [
  { 名: '卡的身份', 项: ['编号', '罕贵度', '中文卡名', '中文别名', '输入框编号'].map(取字段).filter(Boolean) },
  { 名: '上架内容', 项: ['语种', '游戏版本', '行数', '数量', '价格', '集换价', '最低价'].map(取字段).filter(Boolean) },
  { 名: '结果与备注', 项: ['运行状态', '备注'].map(取字段).filter(Boolean) },
]
// 兜底：三组必须不多不少盖住全部 14 项。**不靠「加字段时记得改两处」** ——
// 漏掉的那种错在页面上就是少一行，没人看得出来。所以这里现算一次，
// 有漏的就补一条「未归类」的带子把它顶出来（见着了就知道该去改上面的分组）。
{
  const 已归 = new Set(输出分组.flatMap(g => g.项.map(f => f.字段)))
  const 漏的 = 输出字段.filter(f => !已归.has(f.字段))
  if (漏的.length) 输出分组.push({ 名: '未归类', 项: 漏的 })
}

// ================= 工具 =================
const formatDate = (d) => {
  if (!d) return ''
  const dt = new Date(d)
  return `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`
}
const 首行 = (s) => String(s || '').split('\n')[0].slice(0, 40)
const 复制 = (t) => {
  if (!t) return
  uni.setClipboardData({ data: String(t), success: () => uni.showToast({ title: '已复制 ' + t, icon: 'none' }) })
}
const askConfirm = (title, content, confirmText) => new Promise(resolve => {
  uni.showModal({
    title, content,
    confirmText: confirmText || '确定',
    cancelText: '再等等',
    success: r => resolve(!!r.confirm),
    fail: () => resolve(false)
  })
})

// ================= 卡牌目录 =================
// 一个 code 只查一次。查不到的要**记住查不到**（否则每次重渲染都重打一遍网络）。
//
// 按 200 个一块批量查（V1.2.83）。原来是**一编号一个** `GET /api/tcg/card`，
// 真库一批有 8562 个编号 → 同时压 8562 个 HTTP 上去。浏览器同域只开 6~10 条连接，
// 其余全排队，整页的图片和别的接口一起被饿死 —— 那就是"点什么都卡"的由来。
// 现在 8562 → 43 次。**分块串行**，不是 Promise.all 全打出去（那样只是把排队挪个地方）。
const 每批编号数 = 200
const 拉目录 = async (codes) => {
  const 表 = { ...名称表.value }
  const 没 = { ...未找到.value }
  const 要查 = [...new Set(codes)].filter(c => c && !(c in 表) && !(c in 没))
  for (let i = 0; i < 要查.length; i += 每批编号数) {
    const 块 = 要查.slice(i, i + 每批编号数)
    try {
      const r = await fetch('/api/tcg/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: 块 }),
      })
      const d = await r.json()
      // ★ 只有**成功**的响应才敢认 `missing`。失败（网络断 / 5xx）时**一个都不写** ——
      //   否则一次网络抖动会被读成"这些编号在目录里真没有"，整包变红边 + blocked，
      //   归档判据（包可确认 = 没缺目录）被卡死。后端那边也配合：失败响应里不带 missing。
      if (!d || !d.ok) continue
      const 卡们 = d.cards || {}
      const 丢掉 = d.missing || []
      for (const code of 块) {
        const c = 卡们[code]
        if (c) {
          表[code] = {
            cnName: c.cn_name || '',
            jpName: c.jp_name || '',
            extCode: c.password || '',      // API 的字段名是 password（卡密）
            altLabels: c.alt_labels || {},
          }
        } else if (丢掉.indexOf(code) >= 0) {
          没[code] = true
        }
        // 既不在 cards 也不在 missing：什么都不写，留给下一次再试（宁可多查一次，
        // 也不要把一次不完整的响应当成"目录里没有"）
      }
    } catch (_) { /* 网络失败不算「查不到」，下次再试 */ }
  }
  名称表.value = 表
  未找到.value = 没
}

const 中文名 = (item) => (名称表.value[item.code] && 名称表.value[item.code].cnName) || ''
const 日文名 = (item) => (名称表.value[item.code] && 名称表.value[item.code].jpName) || ''
// 主名：中文名优先，没有中文名才退回日文名顶上（免得标题空着）。
// 副名：**只有中文名和日文名都有**才显示 —— 真库里绝大多数卡只有日文名，
// 不加这个判断，主名退回日文名之后第 2 行又原样再印一遍日文名，看着像哪里渲染重了。
const 主名 = (item) => 中文名(item) || 日文名(item) || '（无名称）'
const 副名 = (item) => (中文名(item) && 日文名(item)) ? 日文名(item) : ''
const 无名 = (item) => !中文名(item) && !日文名(item)
const 卡密 = (item) => (名称表.value[item.code] && 名称表.value[item.code].extCode) || ''

// 图片地址：{卡密}-{编号}-{罕贵}-{异画序号} 整段命中才出图 —— 对不上就是卡背 + 红边。
// 异画的罕贵要取 **altLabels 的键**里那一段（图源文件派生的），不是库里的值，
// 否则库里 NPR / 文件叫 SER-1 这种对不上，异画永远是卡背。
const 卡图 = (item) => {
  const c = 名称表.value[item.code]
  if (!c || !c.extCode || 图挂了.value[item.code]) return ''
  let altRarity = ''
  let altIndex = 0
  let loose = null
  for (const [key, label] of Object.entries(c.altLabels || {})) {
    if (!label || label === '待填' || label !== item.altLabel) continue
    const [r, i] = key.split('|')
    if (!r || r === '?') continue
    const cand = { altRarity: r, altIndex: parseInt(i) || 0 }
    if (r === (item.rarity || '')) { loose = cand; break }
    if (!loose) loose = cand
  }
  if (loose) { altRarity = loose.altRarity; altIndex = loose.altIndex }
  return buildCardImgUrl({ password: c.extCode, code: item.code, rarity: item.rarity, altRarity, altIndex })
}
const onImgErr = (item) => {
  // 图挂了就把这张标记成「没图」，靠 class 出红边，别一直重试。
  // 只记在 图挂了 里 —— 直接清 extCode 会把卡片行上的卡密一起抹掉。
  if (!图挂了.value[item.code]) 图挂了.value = { ...图挂了.value, [item.code]: true }
}
const 看大图 = (item) => { const u = 卡图(item); if (u) 大图.value = u }

// ================= 按包分组 =================
// 包 = 卡牌编号前缀（QCAC-JP001 → QCAC）。一次上架会话 = 一批，一批跨多个包。
// 一行属于哪个包。包名优先看行上带的 packCode，没有才退回编号前缀（老数据）。
// 抽出来是因为「当前卡」那块也要认一次（同一把钥匙，两处写得不一样迟早对不上）。
const 行包名 = (it) => it.packCode || (String(it.code || '').split('-')[0] || '未知')

const 组包 = (items) => {
  const m = new Map()
  for (const it of items) {
    const p = 行包名(it)
    if (!m.has(p)) m.set(p, [])
    m.get(p).push(it)
  }
  return [...m.entries()].map(([pack, list]) => {
    const cnt = { A: 0, B: 0, C: 0 }
    list.forEach(i => { if (cnt[i.flow] !== undefined) cnt[i.flow]++ })
    const 成功 = list.filter(i => i.itemStatus === 'success').length
    const 没跑 = list.filter(i => i.itemStatus === 'pending' || i.itemStatus === 'running').length
    const 失败 = list.filter(i => i.itemStatus === 'failed').length
    // 卡在「执行中」的行（V1.2.109）。正常收尾时服务端会把它们放回 pending，所以跑完还留着 running
    // 就是「上一次崩在中途」的痕迹 —— 那种行不会自己变回去，得人去点「重跑」。
    // 为什么非得单独标出来：服务端拦启动时只说「这一批有 N 张停在执行中」，**不说是哪个包**，
    // 而一批能跨三百多个包（26-10-3-1 就是）。原来 running 是并进「没跑」里一起数的，
    // 一屏的包全写着「剩 N 行」，人根本不知道该进哪个包去点那颗「重跑」。
    const 卡住 = list.filter(i => i.itemStatus === 'running').length
    const 缺 = [...new Set(list.filter(i => 未找到.value[i.code]).map(i => i.code))]
    return {
      pack, items: list, cnt, 成功, 没跑, 失败, 缺,
      total: list.reduce((s, i) => s + (i.addQty || 1), 0),
      pct: list.length ? Math.round(成功 / list.length * 100) : 0,
      // 状态字跟后端两道守卫同一个口径（V1.2.100 起）：pending 拦、running 拦、
      // **failed 也拦**（红行先重跑或删掉，见 包可确认 那段）。
      // 「不可上架」= 有编号在卡牌目录里查不到，那个包永远搬不进已上架（原件上也是这么写的）。
      // 单位是**行**不是张：一个队列行背后可能是好几份实体卡，卡住归档的是行数。
      // 卡住的行**另挂一句**，不并进上面任何一档：它会因为缺目录/没跑完被盖住，而盖住了就找不着了。
      // 例外只有「可完成」—— 有 running 就必然有没跑完（running 算在 没跑 里），两档碰不到一起。
      状态: (缺.length ? '不可上架' : (没跑 ? `剩 ${没跑} 行` : (失败 ? `${失败} 行失败` : '可完成')))
        + (卡住 ? ` · ${卡住} 行执行中` : ''),
    }
  }).sort((a, b) => a.pack.localeCompare(b.pack))
}
// 这一批的全部包（不减去已确认的）—— 批头数字、归档说明、归档确认都用它算。
// 包卡片那一屏才用减过的 包们。
const 全部包们 = computed(() => 组包(队列items.value))
// 已确认的包名集合，用来把「待上架包」和「已上架包」两边劈开。
const 已确认set = computed(() => new Set(已完成包.value.map(d => d.pack)))
// 待上架包那一页只渲染它：包级「确认完成」过的包从这里消失，出现在「已上架包」那一页。
const 包们 = computed(() => 全部包们.value.filter(p => !已确认set.value.has(p.pack)))
const 队列张数 = computed(() => 队列items.value.reduce((s, i) => s + (i.addQty || 1), 0))

// ===== 勾选（V1.2.104）=====
// 有编号在卡牌目录里查不到的包**整包不允许上架**（后端也这么筛），所以它勾不了 ——
// 不是"勾了再被踢"，是压根不给勾，省得名单里混着跑不动的东西。
const 可上架的包 = (p) => !p.缺.length
const 可勾包数 = computed(() => 包们.value.filter(可上架的包).length)
// 「全选」的勾态：**只由"可勾的那些"决定** —— 有缺目录的包在，「全选」永远点不亮才是 bug。
const 全选态 = computed(() => 可勾包数.value > 0 && 包们.value.filter(可上架的包).every(p => 勾选包.value.includes(p.pack)))

// 点包上那条竖条。跑动中不给改 —— 名单是起跑那一刻抄下的，跑一半改勾选只会让人
// 以为改了名单（原型 :1502 的口径）。可见状态由模板的 :class 派生，这里只动数据。
const 点包勾选 = (p) => {
  if (listing.value) { uni.showToast({ title: '正在跑，要改名单先按「终止」', icon: 'none' }); return }
  if (p.缺.length) {
    // 说清是哪一种不行：缺目录要先去补目录，不是"这个包坏了"。
    uni.showToast({ title: '「' + p.pack + '」有编号不在卡牌目录，整包不可上架，勾不了', icon: 'none' })
    return
  }
  勾选包.value = 勾选包.value.includes(p.pack)
    ? 勾选包.value.filter(x => x !== p.pack)
    : [...勾选包.value, p.pack]     // 追加 = 排在名单末尾，这就是"按勾选顺序跑"的来处
}

const 设全选 = (on) => {
  if (listing.value) { uni.showToast({ title: '正在跑，要改名单先按「终止」', icon: 'none' }); return }
  if (!on) { 勾选包.value = []; return }
  // 追加式：已经勾上的**保持原来的位置**，新勾的按包列表顺序跟在后面。
  // 整份重写的话，人先勾了 B、再点全选，B 会被"挪"到 A 后面 —— 顺序就这么被改掉了。
  const 已勾 = 勾选包.value
  勾选包.value = [...已勾, ...包们.value.filter(p => 可上架的包(p) && !已勾.includes(p.pack)).map(p => p.pack)]
}
const 切换全选 = () => 设全选(!全选态.value)

// 包没了（被「确认完成」搬走 / 撤回 / 重新解析），勾选里那条也得跟着消失 ——
// 留着它，「已选 N 个包」会虚高，而且名单里有个已经不存在的包，
// 最后那一下「开始上架」永远点不下去（原型 :1399 那条注释说的是同一件事）。
const 修剪勾选 = () => {
  const 在册 = new Set(包们.value.map(p => p.pack))
  if (勾选包.value.some(x => !在册.has(x))) 勾选包.value = 勾选包.value.filter(x => 在册.has(x))
}

// ===== 当前卡那枚方框要显示什么（V1.2.105）=====
// 「第 N/M 张」得自己算：服务端给的 index 是**批次内**的行号，包内序号它不给。
// 归堆用 行包名（跟 组包() 同一把钥匙），不然同一个包在两处的边界会不一样。
const 当前卡行 = computed(() => (当前卡.value ? 队列items.value.find(x => x.index === 当前卡.value.index) : null))
// 状态字直接读那一行的 itemStatus —— 服务端一张卡只发一条 item-progress（开始跑那一刻，
// 重试时每一遍再发一条），没有"每步一发"，所以能说的只有"正在跑 / 跑成了 / 跑挂了"这三档，
// 别编更细的。
// ⚠️ 「重试中」这一档（V1.2.108）**不能**从 itemStatus 推出来：重试的中间那些遍不落库，
//    整张卡一直停在 running。所以它读的是 当前卡.遍（服务端每一遍重发的那个数），
//    而且**只在行还没出结论时**才生效 —— 行一旦变 success/failed，遍就该让位给结果。
const 当前卡遍 = computed(() => (当前卡.value && 当前卡.value.遍) || 1)
const 当前卡状态字 = computed(() => {
  const s = 当前卡行.value && 当前卡行.value.itemStatus
  if (s === 'success') return '成功'
  if (s === 'failed') return '失败已跳过'
  return 当前卡遍.value > 1 ? ('重试中（第 ' + 当前卡遍.value + ' 遍）') : '正在跑'
})
const 当前卡档 = computed(() => {
  const s = 当前卡行.value && 当前卡行.value.itemStatus
  if (s === 'success') return 's-success'
  if (s === 'failed') return 's-failed'
  return 当前卡遍.value > 1 ? 's-retrying' : 's-running'
})
const 当前卡位次 = computed(() => {
  const c = 当前卡.value
  const it = 当前卡行.value
  if (!c || !it) return ''
  const 名 = 行包名(it)
  const 同包 = 队列items.value.filter(x => 行包名(x) === 名)
  const at = 同包.findIndex(x => x.index === c.index)
  return at < 0 ? '' : '第 ' + (at + 1) + '/' + 同包.length + ' 张'
})
// 「包 X/Y · 」那一截只在勾选批跑时有 —— 那才是"这一趟的第几个包"。
// 整批跑和单包跑都没有"这一趟"的概念，硬套一个数字是编的。
const 当前卡前缀 = computed(() => (批跑.value
  ? '包 ' + (批跑.value.第几 + 1) + '/' + 批跑.value.名单.length + ' · ' : ''))

// 本批已确认的包（还没归档，只是"收起来了"）。items 现从 全部包们 派生，不存快照。
const 已确认包们 = computed(() => {
  const at表 = new Map(已完成包.value.map(d => [d.pack, d.at]))
  return 全部包们.value
    .filter(p => at表.has(p.pack))
    .map(p => ({ ...p, 来源: 'staged', 批次: '', 完成于: at表.get(p.pack) }))
    .sort((a, b) => new Date(b.完成于 || 0) - new Date(a.完成于 || 0))
})

// 已上架：把每个已归档批次拆成包，扁平列出来（包名相同不同批次的会出现两次，靠批次 chip 区分）
const 已上架包们 = computed(() => {
  const out = []
  for (const b of 已上架批次.value) {
    for (const p of 组包(b.items || [])) out.push({ ...p, 来源: 'archive', 批次: b.batchId, 完成于: b.completedAt })
  }
  return out
})
// 头部那行：**数的是这一页真的摆着的东西**。
// V1.2.103 起两页分开数了：这一页只数归档过的批次，待归档的挪去「已上架包」那一页数。
// （原来两撮混在一屏，所以写法是"总数 + 其中 N 张待归档"；现在一页一撮，那个"其中"没了对象。）
const 已上架头文案 = computed(() => {
  if (!已上架批次.value.length) return '还没有归档过的批次'
  const 张 = 已上架包们.value.reduce((s, p) => s + p.total, 0)
  return 张 + ' 张卡 · ' + 已上架批次.value.length + ' 个批次'
})
// 「已上架包」那一页的头：本批已确认、还没归档的那一撮。
const 已上架包头文案 = computed(() => {
  const 包们_ = 已确认包们.value
  if (!包们_.length) return currentBatchId.value ? '这一批还没有确认完成的包' : '没有待归档的包'
  const 张 = 包们_.reduce((s, p) => s + p.total, 0)
  return 包们_.length + ' 个包 · ' + 张 + ' 张 · 待归档'
})

// ================= 按库位看（V1.2.102）=================
// 包名索引：`批次|编号|罕贵度` → 包名。给库位详情里每张卡标"这张是哪个包的"。
// ⚠️ 为什么不用 Card.serial 去对队列里的 serialList：**归档时卡位号会被整库重排**
//    （batches.js 的 compactLibrarySerials，从 0001 起重新发号），队列里那份是**归档前**的快照，
//    拿它去对是拿旧号对新号，对不上还看不出来。批次号 + (编号,罕贵度) 这两样不随重排变。
const 包名表 = computed(() => {
  const m = new Map()
  for (const b of 已上架批次.value) {
    for (const it of (b.items || [])) {
      const k = b.batchId + '|' + String(it.code || '').trim().toUpperCase()
        + '|' + String(it.rarity || '').trim().toUpperCase()
      if (!m.has(k)) m.set(k, it.packCode || String(it.code || '').split('-')[0] || '')
    }
  }
  return m
})
// 这张实体卡是哪个包上的。认不出来就退回编号前缀（包名本来就是这个前缀），
// 前缀也取不到才给空串 —— 宁可写「—」也不猜一个包名，猜错比认不出更坏。
const 卡片包 = (c) => {
  const k = (c.listedBatchId || '') + '|' + String(c.code || '').trim().toUpperCase()
    + '|' + String(c.rarity || '').trim().toUpperCase()
  return 包名表.value.get(k) || String(c.code || '').split('-')[0] || ''
}
const 卡位排序 = (a, b) => String(a.serial || '').localeCompare(String(b.serial || ''))

// 一个盒子一组。**分组键是 Card.libraryCode（库位就是它）**，不是 serial 的前 9 位 ——
// 结果一样（serial 就是 `库位-序号`），但 libraryCode 是存下来的字段、不靠切字符串。
const 库位组们 = computed(() => {
  const m = new Map()
  for (const c of 库位卡表.value) {
    const lib = c.libraryCode || ''
    if (!lib) continue
    let g = m.get(lib)
    if (!g) { g = { lib, 卡们: [], 包数: new Map() }; m.set(lib, g) }
    g.卡们.push(c)
    const p = 卡片包(c)
    g.包数.set(p, (g.包数.get(p) || 0) + 1)
  }
  return [...m.values()].map((g) => ({
    lib: g.lib,
    卡们: g.卡们.slice().sort(卡位排序),
    张: g.卡们.length,
    // 混装几个包 —— 这一屏存在的理由就是它（1,588 个库位里 1,487 个是混装的）
    包们: [...g.包数.entries()]
      .map(([pack, 张]) => ({ pack: pack || '—', 张 }))
      .sort((a, b) => b.张 - a.张 || a.pack.localeCompare(b.pack)),
  })).sort((a, b) => a.lib.localeCompare(b.lib))   // 按库位号排 = 真库里盒子的物理顺序
})
const 库位总张数 = computed(() => 库位组们.value.reduce((s, g) => s + g.张, 0))
const 当前库位组 = computed(() => 库位组们.value.find(g => g.lib === 当前库位.value) || null)
const 当前库位卡们 = computed(() => (当前库位组.value ? 当前库位组.value.卡们 : []))
const 当前库位包数 = computed(() => (当前库位组.value ? 当前库位组.value.包们.length : 0))

// 拉库位数据。**只在人点了「按库位看」时才拉** —— 这个接口回的是归档卡的整套文档，
// 老库上可能是几千上万张，挂在启动路径上就是白等（按包看那一屏根本用不到它）。
const 拉库位 = async () => {
  if (库位拉了.value || 库位载入中.value) return
  库位载入中.value = true
  try {
    const token = uni.getStorageSync('token')
    const r = await fetch('/v1/api/cards/archived', { headers: { Authorization: 'Bearer ' + token } })
    const d = await r.json()
    库位卡表.value = Array.isArray(d && d.list) ? d.list : []
    库位拉了.value = true      // ⚠️ 空结果也算拉过，别让每次切回「按库位看」都重拉一遍
  } catch (e) {
    // 失败了**不置 库位拉了**，下次切回来还能再试
    uni.showToast({ title: '库位数据没拉到：' + (e.message || e), icon: 'none' })
  } finally { 库位载入中.value = false }
}
const 切已上架看法 = (v) => {
  已上架看法.value = v
  if (v === 'lib') 拉库位()
}
// 库位里的东西变了（整批归档 / 撤回）就把这份缓存丢掉，下次切到「按库位看」重拉。
// 不清的话归档完切过去，看到的还是归档前那份 —— 最要命的是"新归档的那批根本没出现"。
const 清库位缓存 = () => {
  库位拉了.value = false
  库位卡表.value = []
}
// 打开一个盒子：**先切屏再补名字** —— 卡本身（库位表）已经在手上了，立刻画得出来，
// 只有卡名/卡密要等目录，晚几十毫秒到就晚点出现，不该让整屏等着。
// 只给**这个盒子的编号**拉目录（一个盒子几百个编号 = 几次请求），
// 不给全部归档卡拉 —— 那会把「点一下等一下」变成「点一下等半天」。
const 打开库位 = async (lib) => {
  当前库位.value = lib
  screen.value = 'shelf'
  const codes = [...new Set(当前库位卡们.value.map(c => c.code).filter(Boolean))]
  if (codes.length) await 拉目录(codes)
}
// 库位详情里点一行 = 看**这个包那时候的全貌**（"这张卡是哪批上的"→ 顺包名找回那一批）。
// 归档前就在库里的老卡认不出批次，如实说一句，别跳到一个空包上。
const 从库位看包 = (c) => {
  const pack = 卡片包(c)
  if (!pack) { uni.showToast({ title: '这张卡认不出是哪个包上的', icon: 'none' }); return }
  const 批 = 已上架批次.value.find(b => b.batchId === (c.listedBatchId || '')
      && (b.items || []).some(i => (i.packCode || String(i.code || '').split('-')[0]) === pack))
    || 已上架批次.value.find(b => (b.items || []).some(i => (i.packCode || String(i.code || '').split('-')[0]) === pack))
  if (!批) { uni.showToast({ title: '这张卡在归档批次里查不到（可能是归档前就在库里的老卡）', icon: 'none' }); return }
  打开包(pack, true, 批.batchId, 'archive')
  详情退回.value = 'shelf'   // 看完这张回到那个盒子接着核，别丢回包列表
}

// ================= 详情屏 =================
const 当前包 = computed(() => (详情来源.value ? 详情来源.value.pack : ''))
const 只读包 = computed(() => !!(详情来源.value && 详情来源.value.只读))
const 详情项 = computed(() => {
  const s = 详情来源.value
  if (!s) return []
  // 只有历史归档批次（archive）的 items 在 已上架批次 里。
  // staged（本批已确认）的数据源**仍然是队列行** —— 包还挂在库上，标的是"收起来"；
  // 点「放回」之后这些行要原样回到待上架屏，另存一份就会僵。
  const 源 = s.来源 === 'archive'
    ? ((已上架批次.value.find(b => b.batchId === s.批次) || {}).items || [])
    : 队列items.value
  const p = 组包(源).find(x => x.pack === s.pack)
  return p ? p.items : []
})
const 详情行数 = computed(() => 详情项.value.length)
const 详情张数 = computed(() => 详情项.value.reduce((s, i) => s + (i.addQty || 1), 0))
const 详情cnt = computed(() => {
  const c = { A: 0, B: 0, C: 0 }
  详情项.value.forEach(i => { if (c[i.flow] !== undefined) c[i.flow]++ })
  return c
})
const 详情缺 = computed(() => {
  const p = 组包(详情项.value)[0]
  return p ? p.缺 : []
})
// 「信息登记」那份集合在 @/utils/cardMarks.js 里是**普通 Set**（两个页面共用，不能是响应式），
// 所以点完蓝块要重画那一行，得靠这个计数器顶一下 —— 下面两个 computed 都依赖它。
const 登记版本 = ref(0)
// 缺目录的那些**行**：登记粒度是 (编号, 罕贵度)，所以要按行算，不是按编号去重。
// 同一个编号在同一个包里可能有好几档（N / NPR），各登记各的。
// 现在只给「删掉这些行」用（那排登记块 V1.2.107 挪到每行上了，见 行已登记）。
const 详情缺行 = computed(() => {
  登记版本.value   // ⚠️ 这行不是废话：它让这个 computed 依赖上面的计数器，别删
  return 详情项.value.filter(i => 未找到.value[i.code])
})
// 每一行那枚「信息登记」块亮不亮（V1.2.107），按行 index 摊成一张表。
// ⚠️ 不能在模板里直接写 已登记(item.code, item.rarity)：那读的是普通 Set，
//    Vue 看不见它变，点完蓝块不会变绿。这里显式依赖 登记版本，点一下就整表重算。
// 摊表而不是每行调一次，是因为模板里每渲染一行要读好几次（类名一次、文案一次）。
const 行已登记 = computed(() => {
  登记版本.value   // ⚠️ 同上：没有它就是一张永不更新的死表
  const 表 = {}
  for (const it of 详情项.value) 表[it.index] = 已登记(it.code, it.rarity)
  return 表
})
// 头部那枚状态字：**不需要说的就整枚藏起来**（留个空 span 照样占位，会把右边的按钮顶偏）。
// 只剩两种真需要说的情况：跑完的（存档）、有编号查不到目录的（整包不可上架）。
const 详情状态字 = computed(() => {
  const p = 组包(详情项.value)[0]
  if (!p) return ''
  const 尾巴 = p.失败 ? '（' + p.失败 + ' 行失败）' : ''
  if (只读包.value) {
    // 本批已确认但还没归档的，跟历史归档的分开说 —— 不然两种包在详情屏长得一模一样。
    return (详情来源.value && 详情来源.value.来源 === 'staged')
      ? '✅ 本批已确认 · 未归档' + 尾巴
      : '✅ 已完成' + 尾巴
  }
  if (p.缺.length) return '⚠ 不可上架'
  if (p.没跑) return '剩 ' + p.没跑 + ' 行'
  return '✅ 已完成' + (尾巴 || ' ' + p.成功 + ' 行')
})
// 「详细」里输出参数那张脸：一个字都没回填过就是"这张卡还没跑过"
const 有输出 = computed(() => 输出字段.some(f => 详细行.value[f.字段]))

// 点一行 = 把这一行设成起点。**幂等赋值，不是开关** —— 再点同一行不会取消它，
// 要取消就换包（或干脆不选，直接点自动上架就是从第一行跑）。
// 子元素（卡图 / 详细 / ×N / 标记已上架 / 复制 / 价格框）都 `.stop` 过，不会顺手改起点。
const 选起点 = (item) => {
  if (只读包.value) return
  选中行.value = item.index
}

// 来源：'' = 待上架包（可编辑）/ 'staged' = 本批已确认 / 'archive' = 历史已归档。
// 后两种都只读，但数据源不同（见 详情项）。
const 打开包 = async (pack, 只读, 批次, 来源 = '') => {
  // 换包才清起点 —— 同包重渲染（点「标记已上架」「重跑」会走到这里）必须保住它，
  // 否则每次标绿一下，起点就自己没了。比较要在覆盖 详情来源 之前做。
  const 换包 = !详情来源.value || 详情来源.value.pack !== pack
    || 详情来源.value.批次 !== 批次 || (详情来源.value.来源 || '') !== 来源
  详情来源.value = { pack, 只读, 批次, 来源 }
  详情退回.value = 'list'   // 默认退回包列表；从库位详情点进来的，调用方会把它改回去（见 从库位看包）
  if (换包 || 只读) 选中行.value = null
  screen.value = 'detail'
  // 只有历史归档批次的目录不在手上（那批的队列行早删了），得照存档拉一次。
  // staged 的目录 拉队列 里已经加载过，不用再查。
  if (只读 && 来源 === 'archive') {
    const b = 已上架批次.value.find(x => x.batchId === 批次)
    await 拉目录([...new Set((b && b.items || []).map(i => i.code).filter(Boolean))])
  }
}

const 开详细 = (item) => {
  详细行.value = item
  详细页.value = 'out'
  详细开.value = true
}

// 「× 目标库存」点出来的三条数字。**不是居中弹窗** —— 原件是贴着那枚小框冒出来的
// （默认在小框正上方、右边缘对齐；上面放不开就翻到下面）。
// 位置得先量：先把小框摆到屏幕外量一次自己的宽高，再按那枚 ×N 的位置算 —— 不量的话
// 算出来的一定是错的（弹窗宽度不是常量）。量不到就退回屏幕正中，别让它跑没了。
const qty弹样式 = computed(() => {
  const q = qty弹.value
  if (!q.就位) return 'left:50%;top:50%;transform:translate(-50%,-50%)'
  return `left:${q.left}px;top:${q.top}px`
})
const 开数量 = (item) => {
  qty弹.value = { open: true, item, left: -9999, top: -9999, 就位: false }
  nextTick(() => {
    const q = uni.createSelectorQuery()
    q.select('#qtyPop').boundingClientRect()
    q.select('#qty-' + item.index).boundingClientRect()
    q.exec((res) => {
      const pop = res && res[0]
      const el = res && res[1]
      if (!pop || !el) return
      let left = el.right - pop.width          // 右边缘跟小框对齐
      if (left < 8) left = 8
      let top = el.top - pop.height - 8        // 优先放上方
      if (top < 8) top = el.bottom + 8         // 上方不够就翻到下面
      qty弹.value = { ...qty弹.value, left, top, 就位: true }
    })
  })
}

// ================= 数据拉取 =================
const 拉队列 = async (batchId) => {
  try {
    const token = uni.getStorageSync('token')
    const resp = await fetch('/v1/api/listings/queues/' + batchId, {
      headers: { Authorization: 'Bearer ' + token }
    })
    if (!resp.ok) return false
    const data = await resp.json()
    队列items.value = data.items || []
    // 包级「确认完成」的标记跟行一起回来（后端 GET /queues/:batchId 带上的）。
    // 拿不到（老后端）就当空数组 —— 该批的包全在待上架屏，功能退化但不炸。
    已完成包.value = data.donePacks || []
    // 包没了（被搬走 / 重解析），勾选名单里那条也得跟着走 —— 见 修剪勾选()。
    修剪勾选()
    await 拉目录([...new Set(队列items.value.map(i => i.code).filter(Boolean))])
    连WS(batchId)
    return true
  } catch (_) { return false }
}

const 拉待解析库 = async () => {
  try {
    const token = uni.getStorageSync('token')
    const r = await fetch('/v1/api/admin/stock-codes?status=pending', {
      headers: { Authorization: 'Bearer ' + token }
    })
    const d = await r.json()
    待解析库.value = d.list || []
  } catch (_) { 待解析库.value = [] }
}

const 拉已上架 = async () => {
  try {
    const token = uni.getStorageSync('token')
    const r = await fetch('/v1/api/listings/batches?state=listed', {
      headers: { Authorization: 'Bearer ' + token }
    })
    const d = await r.json()
    const list = d.list || []
    const out = []
    for (const b of list) {
      let items = []
      try {
        const q = await fetch('/v1/api/listings/queues/' + b.batchId, {
          headers: { Authorization: 'Bearer ' + token }
        })
        const qd = await q.json()
        items = qd.items || []
      } catch (_) {}
      out.push({ batchId: b.batchId, completedAt: b.completedAt || b.createdAt, items })
    }
    已上架批次.value = out
    // 归档过的行也要有卡名/卡密才画得出那张表
    await 拉目录([...new Set(out.flatMap(b => b.items.map(i => i.code)).filter(Boolean))])
  } catch (_) { 已上架批次.value = [] }
}

const fetchLibraries = async () => {
  try {
    const fetcher = topTab.value === 'cloud' ? getCloudLibraries : getLocalLibraries
    const data = await fetcher()
    libraries.value = (data.list || []).map(lib => ({ ...lib, cardCount: lib.cardCount || 0 }))
  } catch (e) { libraries.value = [] }
}

// 有一批没跑完的队列 → 接着用（刷新页面别把进度丢了）。返回「接上了没有」。
//
// 两条路，缺一不可（V1.2.80）：
//   ① `/queues/pending`：只列**还有 pending/running/failed 行**的批次 —— 跑了一半的走这条；
//   ② `/batches?state=parsing` 兜底：整批都跑绿、又还没点「批量完成」的批次，
//      **一条 pending/running/failed 都没有**，所以根本不在 ① 的名单里。
//      少了这条兜底，跑完一个包刷新一下页面，这一批就凭空消失了：
//      待上架屏空的、「批量完成」也点不到（它是挂在有 currentBatchId 的时候才画得出来），
//      库既没归档也不在任何一屏上 —— 只能靠这枚兜底把它捞回来。
const checkAndRestoreQueue = async () => {
  const token = uni.getStorageSync('token')
  const headers = { Authorization: 'Bearer ' + token }
  // 接上就返回 true；拉队列失败（批次被删/被撤）就换下一批
  const 试接 = async (batchId) => {
    if (!batchId || !(await 拉队列(batchId))) return false
    currentBatchId.value = batchId
    return true
  }
  try {
    const resp = await fetch('/v1/api/listings/queues/pending', { headers })
    const data = await resp.json()
    for (const b of (data.list || [])) if (await 试接(b.batchId)) return true
  } catch (_) {}
  try {
    // 按 createdAt 倒序（后端就是倒序）→ 先接最近那一批
    const resp = await fetch('/v1/api/listings/batches?state=parsing', { headers })
    const data = await resp.json()
    for (const b of (data.list || [])) if (await 试接(b.batchId)) return true
  } catch (_) {}
  return false
}

// ================= WebSocket 实时进度 =================
// 手机端从前完全没接 WS：一次阻塞 POST 跑完整批，操作者全程看不见过程。
// 事件四件套跟服务端（ws/index.js + auto-execute*.js）同一个契约。
let 订阅过的批次 = null
const 连WS = (batchId) => {
  const key = String(batchId)
  if (订阅过的批次 === key) return          // 同一个批次只订一次（订阅表是模块级的，重复订会越堆越多）
  订阅过的批次 = key
  wsClient.subscribe(key, (msg) => {
    if (!msg || String(msg.batchId) !== key) return
    if (msg.event === 'item-progress') {
      const it = 队列items.value.find(x => x.index === msg.index)
      // 已经出结果的行不许被「开始执行」倒推回 running
      if (it && it.itemStatus !== 'success' && it.itemStatus !== 'failed') it.itemStatus = 'running'
      // ★ 留住是**哪一张**（V1.2.105）。原来这条只用了 msg.index，code/rarity/detail 全扔了 ——
      // 于是"跑到哪一张"在界面上无从看出。缺字段（老后端）就退回行上的值，不写 undefined。
      // ★ 遍（V1.2.108）：一张卡没跑成会自动再跑一遍（后端那个内层循环），中间那些遍
      //   **不写 itemStatus** —— 只看行状态的话，第 2 遍和第 1 遍长得一模一样，人不知道它在重试。
      //   服务端每一遍都重发一次 item-progress 并带上 `遍`，方框靠它才说得出「重试中（第 N 遍）」。
      //   老后端不带这个字段 → 当成第 1 遍（就是"正在跑"，跟从前一致）。
      当前卡.value = {
        index: msg.index,
        code: msg.code !== undefined ? msg.code : (it ? it.code : ''),
        rarity: msg.rarity !== undefined ? msg.rarity : (it ? it.rarity : ''),
        detail: msg.detail || '',
        遍: msg.遍 || 1,
      }
    } else if (msg.event === 'queue-update') {
      const it = 队列items.value.find(x => x.index === msg.index)
      if (it) {
        it.itemStatus = msg.itemStatus
        if (msg.outputStatus !== undefined) it.outputStatus = msg.outputStatus
      }
      // 这一张出结果了 —— 方框上的状态字跟着变成 成功/失败已跳过（档位是派生的，见 当前卡档）。
    } else if (msg.event === 'execution-end') {
      // 跑完把 14 项输出和真实状态整批补回来（WS 只带状态，不带输出）
      拉队列(key)
      listing.value = false
      listingProgress.value = ''
      // 这一趟结束了，方框收起来 —— 留着最后一张会让人以为还在跑。
      // （`execution-end` 是**一次 execute 请求**的结束：勾选批跑时一个包一个，
      //   包与包之间会闪一下，这是如实反映，不是 bug。）
      当前卡.value = null
    }
  })
}

// ================= 页签与返回 =================
const loadData = () => {
  if (topTab.value === 'local' || topTab.value === 'cloud') fetchLibraries()
}

const switchTab = async (tab) => {
  topTab.value = tab
  screen.value = 'list'
  libraries.value = []
  // 点「待上架库」一律先落在「待上架包」那一页 —— 停在「已上架包」上的话，
  // 人点这枚页签想看的显然是"还有哪些包要跑"，不是"归档了哪些"。
  if (tab === 'listing') 待上架子.value = 'pending'
  // 「待上架库」与「已上架库」走同一段 —— **两个都要 checkAndRestoreQueue()**：
  // 「待上架库 → 已上架包」那一页摆着的就是「本批已确认·待归档」那一撮，
  // 它是从 `队列items` 派生的（见 已确认包们），不拉队列就画不出来，头文案也会少数字。
  if (tab === 'listing' || tab === 'listed') {
    await checkAndRestoreQueue()
    if (!currentBatchId.value) await 拉待解析库()
    if (sub.value === 'listed') await 拉已上架()
  } else {
    loadData()
  }
}


const onTopBack = () => {
  // 一屏一屏往回退，不是一步跳回包列表：库位详情 → 包列表；
  // 包详情（从库位点进去的）→ 回到那个盒子，接着核实物。
  if (screen.value === 'detail' && 详情退回.value === 'shelf') { screen.value = 'shelf'; return }
  if (screen.value !== 'list') { screen.value = 'list'; return }
  uni.reLaunch({ url: '/pages/index/index' })
}

const openVersionPicker = () => { versionPickerRef.value?.open(selectedVersion.value.name) }
const onVersionSelect = (v) => { selectedVersion.value = v }

const onSettings = () => uni.navigateTo({
  url: window._tcg_mode === '虚拟机AI' ? '/pages/listing/panel-vm' : '/pages/listing/panel'
})

const showModePopup = () => {
  const modes = [
    { name: '虚拟机AI', api: 'http://localhost:8090/api/status' },
    { name: '屏幕点击', api: 'http://localhost:5099/api/status' },
    { name: '手机ADB直连', api: null }
  ]
  uni.showActionSheet({
    itemList: modes.filter(m => m.api).map(m => m.name),
    success: (r) => {
      const m = modes[r.tapIndex]
      if (m && m.api) { modeMethod.value = m.name; window._tcg_mode = m.name; localStorage.setItem('_tcg_mode', m.name) }
    }
  })
}

// ================= 上传库（标成待上架） =================
const onUploadLib = async (lib) => {
  if (lib.cardCount === 0) { uni.showToast({ title: '该库没有卡牌', icon: 'none' }); return }
  // 还有没跑完的批次就不许再塞新库 —— 一次只跑一批
  if (currentBatchId.value) {
    uni.showModal({
      title: '无法上传',
      content: '待上架库还有未完成的批次（' + currentBatchId.value + '），请先完成上架或撤回解析后再上传新库',
      showCancel: false, confirmText: '知道了'
    })
    return
  }
  const sure = await askConfirm('标成待上架？', '库 ' + lib.code + '（' + lib.cardCount + ' 张）会进待上架库，等下一批解析。', '标记')
  if (!sure) return
  try {
    uni.showLoading({ title: '标记中...' })
    const token = uni.getStorageSync('token')
    const resp = await fetch('/v1/api/admin/stock-codes/' + lib.code, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ status: 'pending' })
    })
    uni.hideLoading()
    if (resp.ok) {
      uni.showToast({ title: '已标记为待上架', icon: 'success' })
      fetchLibraries()
      拉待解析库()
    } else {
      const d = await resp.json().catch(() => ({}))
      uni.showToast({ title: d.error || '操作失败', icon: 'none' })
    }
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: '网络错误', icon: 'none' })
  }
}

// ================= 解析 =================
const parseStatusText = computed(() => {
  if (parsing.value) return '解析中...'
  if (listing.value) return '上架中...'
  if (currentBatchId.value) return '✅ 已解析'
  return 待解析库.value.length > 0 ? '待解析' : '无批次'
})
const parseStatusClass = computed(() => {
  if (parsing.value || listing.value) return 'status-parsing'
  if (currentBatchId.value) return 'status-done'
  return 'status-pending'
})

const onParseAll = async () => {
  if (parsing.value || currentBatchId.value) return
  parsing.value = true
  uni.showLoading({ title: '解析中…' })
  try {
    const token = uni.getStorageSync('token')
    const cardResp = await fetch('/v1/api/cards/pending', { headers: { Authorization: 'Bearer ' + token } })
    const cardData = await cardResp.json()
    const allCards = (cardData.list || []).map(c => ({ ...c, quantity: c.quantity || 1, _batch: c.libraryCode }))
    if (allCards.length === 0) {
      uni.hideLoading()
      uni.showToast({ title: '没有待解析的卡', icon: 'none' })
      return
    }

    // 目录里那一份 altLabels 是**全局**的，解析分组要用它算异画标签
    const uniqueCodes = [...new Set(allCards.map(c => c.code).filter(Boolean))]
    const 目录原始 = {}
    await Promise.all(uniqueCodes.map(async (code) => {
      try {
        const resp = await fetch('/api/tcg/card?code=' + encodeURIComponent(code))
        const d = await resp.json()
        if (d && d.found) 目录原始[code] = d.card
      } catch (_) {}
    }))

    // 按 code + rarity + condition + note + 异画 五维分组
    const groupMap = {}
    allCards.forEach(c => {
      const code = c.code || '---'
      const rarity = c.rarity || ''
      const cond = c.condition || ''
      const cata = 目录原始[code] || {}
      const cataLabels = cata.alt_labels || {}
      const cataKey = rarity + '|' + (c.altArtIndex || 0)
      const altLabel = cataLabels[cataKey] || c.altLabel || ''
      const altIdx = c.altArtIndex || 0
      const altKey = altLabel || (altIdx > 0 ? 'V' + altIdx : '')
      const key = [code, rarity, cond, c.note || '', altKey].join('|')
      // 异画的罕贵要取 cataKey 里那一段（图源文件派生的），不是库里那个
      const imgRarity = altIdx > 0 ? (cataKey.split('|')[0] || rarity) : rarity
      const imgUrl = c.extCode
        ? buildCardImgUrl({ password: c.extCode, code, rarity: imgRarity, altIndex: altIdx })
        : (c.img || '')
      if (!groupMap[key]) {
        groupMap[key] = {
          code, rarity, condition: cond, note: c.note || '', altLabel,
          img: imgUrl, extCode: c.extCode || '', qty: 0, serialList: [],
        }
      }
      const g = groupMap[key]
      g.qty += (c.quantity || 1)
      if (!g.img && imgUrl) g.img = imgUrl
      if (c.serial) g.serialList.push(c.serial)
    })

    // 已上架库里有什么 → 判 A/B/C 流程
    //   3D 组（编号+罕贵+异画）下，同一 (品相+备注) 有几种：
    //   0 种 = A（全新上架）/ 1 种 = B（更新已有）/ 2+ 种 = C（多变体更新）
    const archResp = await fetch('/v1/api/cards/archived', { headers: { Authorization: 'Bearer ' + token } })
    const archData = await archResp.json()
    const existQty = {}
    const flowMap3d = {}
    ;(archData.list || []).forEach(l => {
      const cata = 目录原始[l.code] || {}
      const lAltLabel = (cata.alt_labels || {})[(l.rarity || '') + '|' + (l.altArtIndex || 0)] || l.altLabel || ''
      const k5 = [l.code || '?', l.rarity || '', l.condition || '', l.note || '', lAltLabel || ''].join('|')
      existQty[k5] = (existQty[k5] || 0) + 1
      const k3 = [l.code || '?', l.rarity || '', lAltLabel || ''].join('|')
      if (!flowMap3d[k3]) flowMap3d[k3] = new Set()
      flowMap3d[k3].add((l.condition || '') + '|' + (l.note || ''))
    })

    const dl = []
    let ca = 0, cb = 0, cc = 0
    Object.values(groupMap).forEach((g) => {
      const k3 = [g.code || '?', g.rarity || '', g.altLabel || ''].join('|')
      const variants = flowMap3d[k3]
      const k5 = [g.code || '?', g.rarity || '', g.condition || '', g.note || '', g.altLabel || ''].join('|')
      const exist = existQty[k5] || 0
      const add = g.qty || 1
      const cd = String(g.code || '')
      const packCode = cd.includes('-') ? cd.split('-')[0] : cd
      if (!variants) { g.flow = 'A'; ca++ }
      else if (variants.size === 1) { g.flow = 'B'; cb++ }
      else { g.flow = 'C'; cc++ }
      dl.push({
        code: g.code, rarity: g.rarity, condition: g.condition, note: g.note,
        altLabel: g.altLabel, flow: g.flow, packCode,
        serialList: g.serialList, addQty: add, exist, totalQty: exist + add,
      })
    })

    // ===== 持久化到 ListingQueue + 锁定 StockCode =====
    // 这一段整块包 try：它挂掉不该把上面已经算好的解析结果一起吞了。
    try {
      const queueItems = dl.map(d => ({
        code: d.code, rarity: d.rarity, condition: d.condition, note: d.note,
        altLabel: d.altLabel, flow: d.flow, packCode: d.packCode || '',
        serialList: d.serialList || [],
        existQty: d.exist || 0, addQty: d.addQty || 1, totalQty: d.totalQty,
      }))
      const lockedStockCodes = [...new Set(allCards.map(c => c._batch).filter(Boolean))]
      const qResp = await fetch('/v1/api/listings/queues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ items: queueItems, flowSummary: { flowA: ca, flowB: cb, flowC: cc }, lockedStockCodes })
      })
      const qData = await qResp.json().catch(() => ({}))
      if (qData.batchId) {
        currentBatchId.value = qData.batchId
        await 拉队列(qData.batchId)
        待解析库.value = []
      } else {
        uni.showModal({
          title: '解析结果没能落库',
          content: qData.error || ('HTTP ' + qResp.status) + '\n卡还在待上架库里，重试一次即可。',
          showCancel: false, confirmText: '知道了'
        })
      }
    } catch (e) {
      uni.showModal({
        title: '解析结果没能落库',
        content: e.message + '\n卡还在待上架库里，重试一次即可。',
        showCancel: false, confirmText: '知道了'
      })
    }

    uni.hideLoading()
    uni.showToast({ title: `解析完成：${dl.length} 行 / ${allCards.length} 张`, icon: 'success' })
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: '解析失败：' + e.message, icon: 'none' })
  } finally {
    // hideLoading 只在每条路径里各调一次 —— 放进 finally 会跟上面那两次重复，
    // uni 会打印「showLoading 与 hideLoading 必须配对使用」。
    // 另外 showToast 自己会把 loading 收掉，所以 toast 之前的那次 hideLoading 是必要的、也只需要那一次。
    parsing.value = false
  }
}

// ================= 一键上架 / 终止 =================
const onStopListing = () => {
  const stopUrl = modeMethod.value === '虚拟机AI'
    ? '/v1/api/listing-agent-vm/execute/stop'
    : '/v1/api/listing-agent/execute/stop'
  // 必须带上批次号：终止信号是按批次隔离的，不带的话只会停「没有批次标识」那一槽
  if (!currentBatchId.value) {
    uni.showToast({ title: '不知道在停哪一批，先启动一批再停', icon: 'none' })
    return
  }
  // 急停之后把起点落到「停下的那一张」，再点自动上架就从它续跑（原型 :1967-1977）。
  // 必须在**点击这一刻**读 running：终止是异步的（当前这步做完才停），等请求回来再读，
  // 那一行早被改成别的状态了。
  // 只在「停的就是当前打开这个包里的行」时才改 —— 起点是按 index 记的、跟包无关，
  // 乱改会把用户在别的包里设好的起点悄悄顶掉。不在详情屏（当前包为空）也不动。
  const 正在跑 = 队列items.value.find(i => i.itemStatus === 'running')
  const 它的包 = 正在跑 ? (正在跑.packCode || String(正在跑.code || '').split('-')[0] || '未知') : ''
  if (正在跑 && 当前包.value && 它的包 === 当前包.value) 选中行.value = 正在跑.index

  authFetch(stopUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchId: currentBatchId.value })
  }).catch(() => {})
  uni.showToast({
    title: 正在跑 && 它的包 === 当前包.value ? '已发终止，它会是新起点，当前这步做完才停' : '已发终止，当前这步做完才停',
    icon: 'none'
  })
}

// 发一次执行请求。**一个包一次** —— 后端只认**单个** packCode（auto-execute-vm.js:136
// 读的是 req.body.packCode 一个字符串，不是数组），所以"整批"在前端就是把包一个一个发过去。
// 失败抛出去，由调用方决定怎么说（整批那枚弹窗、批跑那趟汇总，两处说法不一样）。
const 发执行 = async (body) => {
  const token = uni.getStorageSync('token')
  const execEndpoint = modeMethod.value === '虚拟机AI'
    ? '/v1/api/listings/auto-execute-vm'
    : '/v1/api/listings/auto-execute'
  const resp = await fetch(execEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body)
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status))
  return data
}

// 把一条失败结果排版成给人看的一段。**纯排版，不弹窗** ——
// 批跑一趟要报好几个包的故障，一个包弹一次的话，H5 的 uni.showModal 是单例，
// 后面的会被前一个的淡出收尾吃掉（弹都不弹）。所以先攒着，最后一次性报。
const 排一条故障 = (r) => {
  let s = '【' + r.code + ' ' + r.rarity + '】' + (r.outputStatus || r.message || '未知错误')
  if (r.allOutputs) {
    const kv = Object.entries(r.allOutputs).filter(([, v]) => v).map(([k, v]) => k.replace('(输出)', '') + '=' + v)
    if (kv.length) s += '\n' + kv.join(' | ')
  }
  if (r.logs) s += '\n日志: ' + r.logs
  return s
}
const 取失败行 = (data) => (data.results || []).filter(r => !r.success).map(排一条故障)

const 报故障一览 = (标题, 行) => uni.showModal({
  title: 标题,
  content: 行.join('\n\n') + '\n\n可以把跑红的点「标记已上架」，或点「重跑」再来一次。',
  showCancel: false, confirmText: '知道了'
})

// 熔断（V1.2.106）：**连着**好几张没跑成 → 服务端自己停下 + 说这一句。
// 跟急停必须说成两件事：急停是人按的（不用解释），熔断是它自己停的，
// 不说清"为什么停、我没干什么、接下来怎么办"，人只会以为又卡住了。
// 阈值/连败都从响应里拿 —— 服务端判的，前端不自己再数一遍（数岔了会谎报）。
const 报熔断 = (data, 行 = []) => {
  const 阈值 = data.阈值 || 0
  const 连败 = data.连败 || 阈值
  uni.showModal({
    title: '连着 ' + 连败 + ' 张没跑成，已经停下来',
    content: '（阈值 ' + 阈值 + ' 张，可在「设置」里改）\n\n'
      + '多半是模拟器断了，或者流程/坐标配错了 —— 这种时候再往下跑也是白跑，所以先停住。\n'
      + '没跑到的行保持「待执行」，没有标红；已经跑完的（红的绿的）都留着。\n'
      + '人工看一眼、把故障排除掉，再点「开始上架」就能接着跑。\n'
      + (行.length ? '\n最后这张没成：\n' + 行.slice(0, 2).join('\n\n') : ''),
    showCancel: false, confirmText: '知道了'
  })
}

// opts 只由模板里的**显式调用**传：详情屏那枚按钮传 { 只这个包: true }，包列表那枚不传。
// `@tap` 默认会把事件对象当第一个参数塞进来，所以绝不能写成 `@tap="onBatchListing"`。
const onBatchListing = async (opts = {}) => {
  if (listing.value) return
  if (!currentBatchId.value) { uni.showToast({ title: '请先完成解析', icon: 'none' }); return }

  listing.value = true
  listingProgress.value = '执行中...'
  progressPct.value = 0
  当前卡.value = null          // 起跑先把上一趟的方框清掉，别让上一张冒充这一趟的
  try {
    // 详情屏：只跑当前这个包，选了起点就从那一行往下；
    // 列表动作栏：只发 batchId，照旧整批（这是两枚按钮的分工）。
    const execBody = {
      batchId: currentBatchId.value,
      ...(opts.只这个包 ? { packCode: 当前包.value } : {}),
      ...(opts.只这个包 && 选中行.value != null ? { startIndex: 选中行.value } : {}),
    }
    let data
    try {
      data = await 发执行(execBody)
    } catch (e) {
      listing.value = false
      listingProgress.value = ''
      uni.showModal({ title: '没能启动', content: e.message, showCancel: false, confirmText: '知道了' })
      await 拉队列(currentBatchId.value)
      return
    }
    const ok = data.ok || 0
    const fail = data.fail || 0
    const total = data.total || 队列items.value.length
    listingProgress.value = ok + '/' + total
    progressPct.value = total ? Math.round(ok / total * 100) : 0

    // 跑完（或中断）都要把真实状态拉回来判「该不该报故障」
    const 起来了 = await 拉队列(currentBatchId.value)
    const 待处理 = 起来了
      ? 队列items.value.filter(i => i.itemStatus === 'failed')
      : []
    // 熔断先说 —— 它是"自动停下"，比"红了几条"更要紧，而且 H5 的 uni.showModal 是单例，
    // 两个都想弹的话后一个会被前一个的淡出收尾吃掉（弹都不弹），所以只能弹一个。
    if (data.熔断) {
      报熔断(data, 取失败行(data))
    } else if (data.aborted || fail > 0 || 待处理.length > 0) {
      const 行 = 取失败行(data)
      // 只报前 6 条：弹窗再长也读不完，剩下的去列表上看红点。
      if (行.length > 0) {
        报故障一览('上架故障 (' + fail + '条)',
          行.slice(0, 6).concat(行.length > 6 ? ['（后面还有 ' + (行.length - 6) + ' 条，去列表上看红点）'] : []))
      } else if (data.aborted) {
        uni.showToast({ title: '已暂停，检查后可继续', icon: 'none' })
      }
    } else if (ok === total && total > 0) {
      // 详情屏那枚「自动上架」是**只跑这个包**的，这时 total 只是这个包的行数 ——
      // 说"这一批全跑完了"是假话（V1.2.74 的锅，那时还没有包级这一层）。
      uni.showToast({
        title: opts.只这个包
          ? '这个包跑完了，核对后可点包卡片右边的「确认完成」'
          : '这一批全跑完了，逐个包点「确认完成」挪进「已上架包」，再去那一页点「批量完成」归档',
        icon: 'none'
      })
    }
  } catch (e) {
    uni.showToast({ title: '上架失败：' + e.message, icon: 'none' })
  } finally {
    listing.value = false
    listingProgress.value = ''
  }
}

// ================= 勾选着跑（V1.2.104）=================
// 终止。**先把这一趟的名单掐掉**（循环下一圈抬头看 批跑 就是 null，自己退），
// 再发服务端信号把眼下这一步停掉。反过来的话，服务端停了、循环却已经起了下一个包。
// 勾选**不清** —— 急停/终止后要能再点一下「开始上架」接着把没跑完的跑完（原型 :3007）。
const 终止批跑 = () => {
  批跑.value = null
  onStopListing()
}

// 「▶ 开始上架」/「■ 终止」：同一枚按钮两种身份（原型 :3037）。
// 文案和颜色只在模板里由 listing / 勾选包 派生，这里只管"该走哪条路"。
const 开始批跑 = async () => {
  if (listing.value) { 终止批跑(); return }
  if (!currentBatchId.value) { uni.showToast({ title: '请先完成解析', icon: 'none' }); return }

  const 勾的 = 勾选包.value.slice()      // 起跑这一刻抄下名单：跑一半改勾选不影响这一趟
  const 在册 = new Map(包们.value.map(p => [p.pack, p]))
  const 名单 = 勾的.filter(x => 在册.has(x) && 可上架的包(在册.get(x)))
  const 被剔 = 勾的.filter(x => 在册.has(x) && !可上架的包(在册.get(x)))
  if (!名单.length) {
    uni.showToast({
      title: 勾的.length ? '勾上的包全都有编号不在卡牌目录，整包不可上架，撤掉勾选再试' : '先勾几个包',
      icon: 'none'
    })
    return
  }
  // 不悄悄绕开：点了五六个包却少跑一个，不说的话只有在最后对账时才发现。
  if (被剔.length) uni.showToast({ title: 被剔.join('、') + ' 整包不可上架，这一趟绕开它', icon: 'none' })
  await 跑这些包(名单)
}

// 一趟批跑：按名单顺序，一个包一个包地跑。
const 跑这些包 = async (名单) => {
  listing.value = true
  progressPct.value = 0
  当前卡.value = null          // 起跑先把上一趟的方框清掉
  批跑.value = { 名单, 第几: 0 }
  const 故障们 = []                 // [{ pack, 行: […] }]，攒着最后一次性报
  let 第几 = 0
  let 停因 = ''                     // '' = 跑到底 | '终止' | '急停' | '熔断' | '起不动'
  let 熔断数据 = null               // 熔断时的响应（连败/阈值），弹窗照着说人话
  try {
    for (; 第几 < 名单.length; 第几++) {
      if (!批跑.value) { 停因 = '终止'; break }
      批跑.value.第几 = 第几
      listingProgress.value = '包 ' + (第几 + 1) + '/' + 名单.length + '：' + 名单[第几]
      progressPct.value = Math.round(第几 / 名单.length * 100)
      let data
      try {
        // 连败继续：服务端判熔断的计数**跨包**活着（用户口径：整批里连着数，换包不清零），
        // 而整批在前端就是"一个包一次请求"，服务端自己看不出这是第几个包 ——
        // 所以由这里点名"这是接着上一包数的"。第一个包不带 → 服务端把计数归零，从这一趟重新数。
        data = await 发执行({
          batchId: currentBatchId.value,
          packCode: 名单[第几],
          ...(第几 > 0 ? { 连败继续: true } : {}),
        })
      } catch (e) {
        // 起不动就停在这一包，不往下瞎跑 —— 后面几个包多半是同一个原因（模式挂了/批次被锁）。
        uni.showModal({ title: '「' + 名单[第几] + '」没能启动', content: e.message, showCancel: false, confirmText: '知道了' })
        停因 = '起不动'
        break
      }
      await 拉队列(currentBatchId.value)
      const 行 = 取失败行(data)
      if (行.length) 故障们.push({ pack: 名单[第几], 行 })
      progressPct.value = Math.round((第几 + 1) / 名单.length * 100)
      // 这个包被打断了 —— 这一趟到此为止。**不是"跳到下一个包"**：
      // 人按终止就是要全停下，接着跑下一个包等于没停；熔断同理，它停就是因为"再跑也是白跑"。
      if (data.aborted) { 停因 = data.熔断 ? '熔断' : '急停'; 熔断数据 = data.熔断 ? data : null; break }
    }
  } finally {
    const 全跑完 = !停因 && 第几 >= 名单.length
    批跑.value = null
    listing.value = false
    listingProgress.value = ''
    progressPct.value = 0

    // 熔断优先说（一次弹窗，只能弹一个 —— H5 的 uni.showModal 是单例）。
    // 它的"为什么停"比"红了几条"要紧，红点照样留在列表上。
    // 判据用 熔断数据 本身，不用 停因 —— 少一个"两个变量会不会走岔"的坑：
    // 真要是没拿到那几个数，就退回下面那条通用故障汇总，绝不能弹一句"连着 0 张没跑成"。
    if (熔断数据) {
      const 最后一段 = 故障们.length ? 故障们[故障们.length - 1].行 : []
      报熔断(熔断数据, 最后一段)
    } else if (故障们.length) {
      // 故障汇总（一次弹窗，别一个包弹一次）。失败了**不中断整批**、也不给"失败清单" ——
      // 红点留在列表上，人工看。
      const 总行 = 故障们.map(g => '◆ ' + g.pack + '（' + g.行.length + ' 条失败）\n' + g.行.slice(0, 3).join('\n'))
      报故障一览('这一趟有 ' + 故障们.reduce((s, g) => s + g.行.length, 0) + ' 条没跑成，已跳过（红点留着，人工看）', 总行)
    } else if (全跑完) {
      // 名单走完了才清勾选。**只在这一处清** —— 终止/急停那条路要留着名单，
      // 好让人再点一下「开始上架」接着把没跑完的跑完（原型 :3005 说的就是这处分界）。
      勾选包.value = []
      uni.showToast({ title: '勾的 ' + 名单.length + ' 个包跑完了，逐个点「确认完成」', icon: 'none' })
    }
    // 终止 / 急停那两条不再补一句：onStopListing 已经 toast 过「已发终止，当前这步做完才停」了。
    // 前一条也**不清勾选** —— 勾选就是"这一趟要跑哪几个"，正跑着更应该看得见，停了才好续跑。
  }
}

// ================= 撤回 =================
// 撤回是**唯一**能把上架批次解锁的路（queues.js 里那句 status:'pending' + listingBatchId:null）。
// 撤掉它等于把那批实体卡永久锁死 —— libraries 那边会一直回 423「该库已被上架批次锁定」。
const onRevertParse = async () => {
  if (!currentBatchId.value) return
  const batchId = currentBatchId.value
  const sure = await askConfirm(
    '撤回这一批？',
    '批次 ' + batchId + ' 会退回解析前：库的状态、归属、卡数照存档还回去' +
      '（原来是本地库还是本地库，不会一律变成「待上架」）。\n' +
      '如果这批已经归档过，卡位号和原图链接也会一并还原。\n' +
      '包级「确认完成」的标记也会一并清掉。\n这一步不能撤销。',
    '撤回'
  )
  if (!sure) return

  uni.showLoading({ title: '撤回中...', mask: true })
  try {
    const token = uni.getStorageSync('token')
    const resp = await fetch('/v1/api/listings/queues/' + batchId + '/revert', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token }
    })
    const data = await resp.json().catch(() => ({}))
    uni.hideLoading()
    if (!resp.ok || !data.success) {
      uni.showModal({ title: '撤回失败', content: data.error || ('HTTP ' + resp.status), showCancel: false, confirmText: '知道了' })
      return
    }
    if (data.cardsMissing) {
      uni.showModal({
        title: '撤回了，但有几张没还上',
        content: '有 ' + data.cardsMissing + ' 张卡在库里找不到了，卡位号没能还原 —— 去审计里看是哪些。',
        showCancel: false, confirmText: '知道了'
      })
    }
    // 本该收回却没收回的「已上架」标记（V1.2.82）。正常是 0；非 0 说明这批里有卡
    // 在库里仍是已上架状态 —— 也就是**还在凑库池里**，会被订单当成"已上架的货"拣走。
    // 多为 V1.2.82 之前跑的那一批（那时标记里没带批次号，认不出是谁标的）。
    if (data.未收回已上架) {
      uni.showModal({
        title: '撤回了，但有卡没解开',
        content: '有 ' + data.未收回已上架 + ' 张卡还停在「已上架」状态，仍会被订单拣走。\n' +
          '多半是本版本之前跑的那一批（标记里没带批次号）。\n' +
          '确认已经不在店里挂着的话，去「主库」用「取消已上架」把它们退出凑库。',
        showCancel: false, confirmText: '知道了'
      })
    }
    currentBatchId.value = null
    队列items.value = []
    已完成包.value = []
    详情来源.value = null
    // 批都没了，勾选名单和"跑着的那一趟"一起作废（修剪勾选挂在 拉队列 里，
    // 撤回这条路不走 拉队列，得自己清）。
    勾选包.value = []
    批跑.value = null
    当前卡.value = null
    screen.value = 'list'
    // 批没了，「已上架包」那页自然也就空了 —— 落在那一页上会是一片空屏，
    // 看着像撤坏了。回「待上架包」那一页（那才是撤完该看的地方）。
    待上架子.value = 'pending'
    // 撤回会把整批的卡退回解析态、库位归属也变了 —— 库位缓存跟着丢
    清库位缓存()
    await 拉待解析库()
    await 拉已上架()
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: '撤回失败：' + e.message, icon: 'none' })
  }
}

// ================= 包级「确认完成」/「放回」（V1.2.75）=================
// 跟下面那个整批归档**不是一回事**：这里只是把一个包从「待上架库」挪进「已上架库」，
// 库状态、卡位号、库锁一个字都不动。所以它没有"不可逆"的负担 —— 随时能「放回」。
// 判据：不是「缺」（有编号查不到目录）、没有没跑完的行（pending/running）、**也没有跑红的行**。
// 红行原先放行（"那是留给人看的"），V1.2.100 起跟后端两道路闸一起改成拦 ——
// 后端的整批归档（batches.js 的 complete）和包级（batches.js 的 packs/complete）都是这个口径，
// 前端再放行就是"点得动、点完被打回"。
// 三样各自有不同的出路，所以 toast 里要分开说：缺 → 去补目录；没跑 → 去跑；红 → 重跑或删行。
const 包可确认 = (p) => !p.缺.length && p.没跑 === 0 && p.失败 === 0

// 包级标记的唯一写入口：POST 完用后端回的 donePacks 覆盖本地（以服务端为准）。
const 发包级 = async (尾巴, body, 成功话) => {
  const batchId = currentBatchId.value
  if (!batchId) return
  uni.showLoading({ title: '处理中...', mask: true })
  try {
    const token = uni.getStorageSync('token')
    const resp = await fetch('/v1/api/listings/batches/' + batchId + 尾巴, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body)
    })
    const data = await resp.json().catch(() => ({}))
    uni.hideLoading()
    if (!resp.ok || !data.success) {
      uni.showModal({ title: '没能搬动', content: data.error || ('HTTP ' + resp.status), showCancel: false, confirmText: '知道了' })
      await 拉队列(batchId)
      return
    }
    // 服务端**不信客户端**，可能把某个包跳过了 —— 点名说出来，别让它悄悄没搬。
    const 跳 = data.skipped || []
    if (跳.length) {
      uni.showModal({
        title: '有 ' + 跳.length + ' 个包没搬',
        content: 跳.map(s => s.pack + '：' + s.reason).join('\n'),
        showCancel: false, confirmText: '知道了'
      })
    } else if (成功话) {
      uni.showToast({ title: 成功话, icon: 'none' })
    }
    await 拉队列(batchId)
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: '失败：' + e.message, icon: 'none' })
  }
}

const 确认包 = async (p) => {
  if (!包可确认(p)) {
    // 三种卡住的原因分开说 —— 光一句"挪不过去"人不知道该去补目录、去跑、还是去重跑。
    uni.showToast({
      title: p.缺.length ? '这个包有编号查不到目录，挪不过去'
        : (p.没跑 ? '还有 ' + p.没跑 + ' 行没跑完' : '还有 ' + p.失败 + ' 行跑失败了，先重跑或删掉'),
      icon: 'none'
    })
    return
  }
  const sure = await askConfirm(
    '确认完成「' + p.pack + '」？',
    // V1.2.103 起这两步分在两页上了，所以文案得点明"挪去哪一页"，
    // 别再写成"进已上架库" —— 那句会让后一步（批量完成）看着像同一步走两遍。
    p.total + ' 张（成功 ' + p.成功 + (p.失败 ? ' / 失败 ' + p.失败 : '') + '）挪进「已上架包」。\n' +
      '这只是先把它收起来 —— 库、卡位号都不动。等这一批全好了再点「批量完成」才是真的归档进「已上架库」。\n' +
      '挪过去之后这个包只读，想改先点「放回」。',
    '确认完成'
  )
  if (!sure) return
  await 发包级('/packs/complete', { packs: [p.pack] }, '「' + p.pack + '」已挪进「已上架包」')
}

const 放回包 = async (p) => {
  await 发包级('/packs/undo', { pack: p.pack }, '「' + p.pack + '」已放回待上架包')
}

// ================= 批量完成（整批归档） =================
// 判据跟后端 complete 的守卫同一个口径：没有 pending、没有 running、**也没有 failed**
// （最后那档是 V1.2.100 跟后端一起加上的；不加的话就是"按钮点得动、点完被后端打回"）。
// 按不动的原因照样挂出来（光变灰不说为什么，人只会一遍遍点它）。
// ⚠️ 刻意**不要求"待上架屏清空"**：有编号查不到目录的包永远确认不了（原型 :986 明规定），
//    真加了这条，那种包一出现就永远点不亮归档。包级标记是加分项，不是归档的前置门。
const 整批可完成 = computed(() =>
  !!currentBatchId.value &&
  队列items.value.length > 0 &&
  !队列items.value.some(i => i.itemStatus === 'pending' || i.itemStatus === 'running' || i.itemStatus === 'failed'))

const 整批说明 = computed(() => {
  if (!currentBatchId.value) return '待上架包是空的，没有要搬的'
  // 拿 全部包们 数：包级确认过的包也算这一批的，不能因为搬走了数字就缩水。
  // 没跑完的先说（那是"还没跑"），跑红的随后（那是"跑了没成"）—— 两件事的出路不同。
  const 没跑完 = 全部包们.value.filter(p => p.没跑)
  if (没跑完.length) {
    // 点名是哪些包 —— 只说"剩 N 行"的话，人得在几百个包卡片里自己翻。
    return '还有 ' + 没跑完.reduce((s, p) => s + p.没跑, 0) + ' 行没跑完（' +
      没跑完.slice(0, 5).map(p => p.pack).join('、') +
      (没跑完.length > 5 ? ' 等 ' + 没跑完.length + ' 个包' : '') + '）'
  }
  const 红的 = 全部包们.value.filter(p => p.失败)
  if (红的.length) {
    return '还有 ' + 红的.reduce((s, p) => s + p.失败, 0) + ' 行跑失败了（' +
      红的.slice(0, 5).map(p => p.pack).join('、') +
      (红的.length > 5 ? ' 等 ' + 红的.length + ' 个包' : '') + '），先重跑或删掉'
  }
  return '把这一批的 ' + 全部包们.value.length + ' 个包整批归档进「已上架库」（这一步之后要退只能整批撤回）'
})

const onFinishAll = async () => {
  if (!整批可完成.value) { uni.showToast({ title: 整批说明.value, icon: 'none' }); return }
  await onCompleteBatch()
}

// 确认完成 = 人工归档：跑完了、人核对过了，点这一下把这批搬进已上架库。
// 后端会拦：还有没跑完的打回来；库上挂着没拣完的拣货单也打回来（归档要重排卡位号）。
const onCompleteBatch = async () => {
  if (!currentBatchId.value) { uni.showToast({ title: '还没有解析出的批次', icon: 'none' }); return }
  const batchId = currentBatchId.value
  const 缺目录的包 = 全部包们.value.filter(p => p.缺.length)
  const sure = await askConfirm(
    '确认完成',
    '批次 ' + batchId + '（' + 全部包们.value.length + ' 个包 / ' + 队列items.value.length + ' 行 / ' + 队列张数.value + ' 张）会归档进已上架库：\n' +
      '库封存、原图链接清空。\n' +
      '⚠ 卡位号会**重排**：这几个库里的卡（不只这一批的，库里原来就有的老卡也一样）\n' +
      '   统统从 0001 起重新编号成连续的。装册/找卡按号来的话，先记一下。\n' +
      '归档后这批就从「待上架」里出去了，要退只能整批撤回。' +
      (缺目录的包.length
        ? '\n\n⚠ ' + 缺目录的包.map(p => p.pack).join('、') + ' 有编号在卡牌目录里查不到，归档后卡名/卡图会一直空着。'
        : ''),
    '确认完成'
  )
  if (!sure) return

  uni.showLoading({ title: '归档中...', mask: true })
  try {
    const token = uni.getStorageSync('token')
    const resp = await fetch('/v1/api/listings/batches/' + batchId + '/complete', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token }
    })
    const data = await resp.json().catch(() => ({}))
    uni.hideLoading()
    if (!resp.ok || !data.success) {
      uni.showModal({ title: '不能归档', content: data.error || ('HTTP ' + resp.status), showCancel: false, confirmText: '知道了' })
      return
    }
    currentBatchId.value = null
    队列items.value = []
    已完成包.value = []
    详情来源.value = null
    勾选包.value = []          // 这一批已经归档进库了，名单作废
    批跑.value = null
    当前卡.value = null
    screen.value = 'list'
    // 归档成功后停在「已上架库」页签（sub 是 topTab 的派生值，所以这里改 topTab）
    topTab.value = 'listed'
    // 库位里的卡**变了**（卡位号刚被整库重排过）—— 「按库位看」那份缓存必须丢
    清库位缓存()
    await 拉已上架()
    uni.showModal({
      title: '已归档',
      // failedCount 现在是**恒为 0** 的（V1.2.100 起后端的 complete 拦红，有红行根本走不到这儿）。
      // 留着这个分支是防"拦之前就已经是红"的历史数据万一漏过来 —— 真漏了就点名说出来，
      // 别让它悄悄跟着归档进去。
      content: data.libCount + ' 个库 / ' + data.itemCount + ' 行已进已上架库' +
        (data.failedCount ? '（其中 ' + data.failedCount + ' 行是失败留存，要清得去删）' : ''),
      showCancel: false, confirmText: '知道了'
    })
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: '归档失败：' + e.message, icon: 'none' })
  }
}

// ================= 上架价格（listingPrice） =================
// 绑的是 listingPrice（人定的、要挂到店里去的价），**不是**集换价、也不是 outputPrice。
// 自动跑完只会拿集换价在**为空时**给它打底，所以这里改完的值重跑不会被冲掉。
const 存价 = async (item, e) => {
  const v = e && e.detail ? String(e.detail.value || '').trim() : ''
  if (v === String(item.listingPrice || '')) return
  try {
    const token = uni.getStorageSync('token')
    const resp = await fetch('/v1/api/listings/queues/' + currentBatchId.value + '/item/' + item.index + '/price', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ price: v })
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      uni.showToast({ title: data.error || '价格没存上', icon: 'none' })
      return
    }
    item.listingPrice = data.listingPrice
  } catch (err) {
    uni.showToast({ title: '价格没存上：' + err.message, icon: 'none' })
  }
}

// ================= 标记已上架 / 重跑 =================
// 跑红了但人已经在店里手工上架了 → 按绿。没有这个键的话那抹红会一直挂到归档。
//
// ⚠️ 先要有价（V1.2.100）。这一行被按绿之后就是「已上架」了，会上追溯那屏、也进归档；
//    后端 /mark-listed 只写状态、**一个价也不读**，所以价只能在这儿拦 ——
//    没价就按绿的话，这批里就多了一张"上架了但没价"的卡，之后谁也说不清它卖多少钱。
//    价是这一行左边的那个「上架价格」输入框填的（同一个 item.listingPrice）。
const 标记已上架 = async (item) => {
  if (item.itemStatus === 'success') return          // 已经绿的点不动（要重来请点「重跑」）
  if (item.itemStatus === 'running') { uni.showToast({ title: '这一行正在执行中，等它跑完', icon: 'none' }); return }
  if (!String(item.listingPrice || '').trim()) {
    uni.showToast({ title: '还没填价 —— 先在左边的「上架价格」框里填一个价，再标已上架', icon: 'none' })
    return
  }
  const sure = await askConfirm(
    '标成已上架？',
    item.code + '  ' + (item.rarity || '') + '  价 ' + item.listingPrice + '\n' +
      '这一行会被记为成功（运行状态写「人工标记」），不再排队重跑。\n' +
      '店里还没挂上去的话别点这一下。',
    '标成已上架'
  )
  if (!sure) return
  try {
    const token = uni.getStorageSync('token')
    const resp = await fetch('/v1/api/listings/queues/' + currentBatchId.value + '/item/' + item.index + '/mark-listed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok || !data.success) {
      uni.showModal({ title: '没标上', content: data.error || ('HTTP ' + resp.status), showCancel: false, confirmText: '知道了' })
      return
    }
    item.itemStatus = 'success'
    item.outputStatus = '人工标记'
    uni.showToast({ title: '已标记', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: '标记失败：' + e.message, icon: 'none' })
  }
}

// 单卡重跑：只把这一行放回待执行，真正跑还是下次点「一键上架」的时候。
// 它同时也是**清掉卡在「执行中」的僵尸行**的唯一出口（进程崩过之后留下的那种）。
const 重跑一行 = async (item) => {
  const sure = await askConfirm(
    '把这一行放回待执行？',
    item.code + ' ' + (item.rarity || '') + '\n点「自动上架」时它会重新排进队列。',
    '重跑'
  )
  if (!sure) return
  try {
    const token = uni.getStorageSync('token')
    const resp = await fetch('/v1/api/listings/queues/' + currentBatchId.value + '/item/' + item.index + '/rerun', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok || !data.success) {
      uni.showModal({ title: '没放回去', content: data.error || ('HTTP ' + resp.status), showCancel: false, confirmText: '知道了' })
      return
    }
    item.itemStatus = 'pending'
    item.outputStatus = ''
    uni.showToast({ title: '已放回待执行', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: '重跑失败：' + e.message, icon: 'none' })
  }
}

// ================= 缺目录那条带子的出口（V1.2.101）=================
// 模板里那条 note-bar：一枚「删掉这些行」+ 每个缺失行一枚「信息登记」块。
// ⚠️ 两条都**只动这一批的行和登记清单**，一个字都不写卡牌目录 ——
//    补目录是用户本人到「卡牌资料库 ▸ 卡牌目录」做的（用户 2026-10-04 明确定的：
//    「需要我人工确认，只能是我人工点」）。
//    ⚠️⚠️ 登记 ≠ 目录补上了：登记只往 cardmarks 记一笔待办，橙色边要等目录补好才消。

// 「删掉这些行」：把查不到目录的行**整行**删掉（走的还是详情层那枚「全部删除」的接口，
// 所以实体卡是真从库里删的，会留审计和快照）。删完这个包往往就能跑了。
// 剩下的行不重编号 —— 后端只删不重排（queues.js）。
const 删缺目录的行 = async () => {
  if (removing.value) return
  const 缺行 = 详情缺行.value
  if (!缺行.length) return
  const pack = 当前包.value
  const 份数 = 缺行.reduce((s, i) => s + (i.serialList || []).length, 0)
  const sure = await askConfirm(
    '把查不到目录的 ' + 缺行.length + ' 行删掉？',
    '包「' + pack + '」里这 ' + 缺行.length + ' 行（' + [...new Set(缺行.map(i => i.code))].join('、') + '）整行删掉：\n' +
      '它们背后的 ' + 份数 + ' 份实体卡会从库里删掉，这几行也从队列里消失，不再跟着这批上架。\n' +
      '删之前会留审计和快照，但删这个动作本身撤不回来。\n\n' +
      '剩下的行不受影响（不重编号）。',
    '全删'
  )
  if (!sure) return
  removing.value = true
  uni.showLoading({ title: '删除中...', mask: true })
  const 没删成 = []
  for (const r of 缺行) {
    try {
      const x = await 删条目(r.index, [], true)
      if (!x.ok || !x.data.success) 没删成.push(r.code + ' ' + (r.rarity || ''))
    } catch (_) { 没删成.push(r.code + ' ' + (r.rarity || '')) }
  }
  uni.hideLoading()
  removing.value = false
  await 拉队列(currentBatchId.value)
  // 行删空了 → 回包列表；这个包里还剩行 → 留在原地，带子会自己重算
  if (组包(队列items.value).some(p => p.pack === pack)) await 打开包(pack, false, '')
  else { 详情来源.value = null; screen.value = 'list' }
  if (没删成.length) {
    uni.showModal({
      title: '有几行没删掉', content: 没删成.join('、') + ' —— 可以再来一次',
      showCancel: false, confirmText: '知道了'
    })
  } else {
    uni.showToast({ title: '已删掉 ' + 缺行.length + ' 行', icon: 'success' })
  }
}

// 「信息登记」块：蓝＝还没登记 → 点一下登记；绿＝已登记 → 点一下取消。
// 后端现成的，一行新代码都不用加：POST /api/card-marks（带这一行的罕贵度）、
// DELETE /api/card-marks/:code?rarity=XX。
const 点登记块 = async (r) => {
  const code = String(r.code || '').trim().toUpperCase()
  const rarity = String(r.rarity || '').trim().toUpperCase()
  if (!code) return

  if (已登记(code, rarity)) {
    // 删的是**标中这一行的那条记录**：精确那一对优先，没有才退到通配那条。
    // 拿这一行自己的罕贵度去删是不对的 —— 它可能正是被一条通配记录罩绿的。
    const k = markKeyOf(code, rarity)
    const 删编号 = k.slice(0, k.indexOf('|'))
    const 删罕贵 = k.slice(k.indexOf('|') + 1)
    const auto = 登记来源(k) === 'auto'
    // 「取消完照样上不了架」这句只在**编号确实查不到目录**时才是对的（橙边靠补目录消）。
    // V1.2.107 起这枚块每行都有了，行的大多数编号是在目录里的 —— 那种行取消登记完
    // 就该能正常上架，不能一律说成上不了。
    const 缺目录 = !!未找到.value[code]
    const sure = await askConfirm(
      '取消「' + (删编号 || code) + '」的信息登记？',
      (删罕贵
        ? '只有 ' + (删编号 || code) + ' 的 ' + 删罕贵 + ' 这一档会从待办清单里出去，其它罕贵度不受影响。'
        : '这条登记的罕贵度是空的（不限罕贵度），所以 ' + (删编号 || code) + ' 的所有罕贵度会一起从待办里出去。') +
      '\n\n注意：这去掉的只是「待办」这个标记 —— 卡牌目录一个字都不动。' +
      (缺目录 ? '\n（这个编号在目录里查不到，所以取消登记之后这个包照样上不了架，橙边要等目录补上才消。）' : '') +
      (auto ? '\n\n这条是编号在目录里查不到时自动记的，删掉之后那张卡再被写一次它还会自己回来。要让它永久消失，得先补上这个编号的目录资料。' : ''),
      '取消登记'
    )
    if (!sure) return
    try {
      const res = await deleteCardMark(删编号 || code, 删罕贵)
      uni.showToast({ title: (res && res.deleted === 0) ? '记录早已不存在' : '已取消登记', icon: 'none' })
      删除条目(删编号 || code, 删罕贵)
      登记版本.value++
    } catch (e) {
      uni.showToast({ title: '取消失败：' + e.message, icon: 'none' })
    }
    return
  }

  try {
    // 带上这一行自己的罕贵度：后端按 (编号, 罕贵度) 存，标 N 就只标 N。
    // 罕贵度为空的行 → 存的是通配记录，罩住这个编号的所有罕贵度。
    const res = await markCards([{ code, rarity }], '', undefined)
    登记条目(code, rarity, 'manual')
    登记版本.value++
    uni.showToast({
      title: (res && res.added) ? '已登记' : '已登记过',
      icon: 'success'
    })
  } catch (e) {
    uni.showToast({ title: '登记失败：' + e.message, icon: 'none' })
  }
}

// ================= 删除实体卡 =================
// 删的是**实体卡**（从库里真删掉），不是只从这一行摘下来 —— 摘下来它就变成没主的孤儿卡了。
// 所以两个删除键都带确认框，也都防连点。
const removing = ref(false)

const 删条目 = async (index, 要删的份, 整行) => {
  const token = uni.getStorageSync('token')
  const url = '/v1/api/listings/queues/' + currentBatchId.value + '/item/' + index
    + (整行 ? '/remove-all' : '/remove')
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(整行 ? {} : { serials: 要删的份 })
  })
  return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => ({})) }
}

// 删完重新从队列读一遍（别在本地自己猜结果），再把弹层指回同一行。
// 行被删空了的话，后端那边这一行已经没了 —— 关掉弹层，别再指着一个不存在的行。
const 刷新这一行 = async (index) => {
  await 拉队列(currentBatchId.value)
  const 新行 = 队列items.value.find(c => c.index === index)
  if (新行) 详细行.value = 新行
  else { 详细开.value = false; uni.showToast({ title: '这一行已经删空了', icon: 'none' }) }
}

const onRemoveCopy = async (serial) => {
  if (removing.value) return
  const index = 详细行.value.index
  if (!index) { uni.showToast({ title: '这一行没定位到队列行号', icon: 'none' }); return }
  const sure = await askConfirm(
    '删掉这一份？',
    详细行.value.code + '  ' + (serial || '(没有卡位号)') + '\n' +
      '这张实体卡会从库里删掉，也不再跟着这批上架。\n删之前会留审计和快照，但删这个动作本身撤不回来。',
    '删除'
  )
  if (!sure) return
  removing.value = true
  uni.showLoading({ title: '删除中…', mask: true })
  try {
    const r = await 删条目(index, [serial], false)
    uni.hideLoading()
    if (!r.ok || !r.data.success) {
      uni.showModal({ title: '没删成', content: r.data.error || ('HTTP ' + r.status), showCancel: false, confirmText: '知道了' })
      return
    }
    if ((r.data.missing || []).length) {
      uni.showModal({
        title: '这份库里没有',
        content: '卡位号 ' + r.data.missing.join('、') + ' 在库里找不到，什么都没删。',
        showCancel: false, confirmText: '知道了'
      })
    } else {
      uni.showToast({ title: '已删除', icon: 'success' })
    }
    await 刷新这一行(index)
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: '删除失败：' + e.message, icon: 'none' })
  } finally {
    removing.value = false
  }
}

const onRemoveAllCopies = async () => {
  if (removing.value) return
  const index = 详细行.value.index
  if (!index) { uni.showToast({ title: '这一行没定位到队列行号', icon: 'none' }); return }
  const 几份 = (详细行.value.serialList || []).length
  const sure = await askConfirm(
    '整行删掉？',
    详细行.value.code + '  ' + (详细行.value.rarity || '') + '\n' +
      '这一行的 ' + 几份 + ' 份实体卡都会从库里删掉，这行也从队列里消失。\n删之前会留审计和快照，但删这个动作本身撤不回来。',
    '全删'
  )
  if (!sure) return
  removing.value = true
  uni.showLoading({ title: '删除中…', mask: true })
  try {
    const r = await 删条目(index, [], true)
    uni.hideLoading()
    if (!r.ok || !r.data.success) {
      uni.showModal({ title: '没删成', content: r.data.error || ('HTTP ' + r.status), showCancel: false, confirmText: '知道了' })
      return
    }
    uni.showToast({ title: '整行已删除', icon: 'success' })
    await 刷新这一行(index)
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: '删除失败：' + e.message, icon: 'none' })
  } finally {
    removing.value = false
  }
}

// ================= 溯源表 =================
// 「已上架」这一屏的溯源**只记归档过的批次** —— 本批那些"已确认·待归档"的包刻意不算：
// 归档（改库状态、压卡位号）才是留档那一刻，刚收起来的包还没走到那一步。
const 溯源行 = computed(() => {
  const 源 = sub.value === 'listed'
    ? 已上架批次.value.flatMap(b => (b.items || []).map(i => ({ ...i, _b: b.batchId })))
    : 队列items.value
  return 源.map(i => ({
    _k: (i._b || '') + '|' + i.index,
    包: i.packCode || String(i.code || '').split('-')[0] || '—',
    编号: i.code,
    卡名: 中文名(i) || 日文名(i),
    罕贵: i.rarity || '—',
    品相: i.condition || '—',
    备注: i.note || '',
    异画: i.altLabel && i.altLabel !== '初版' ? i.altLabel : '',
    原始库存: i.existQty || 0,
    本次上架: i.addQty || 0,
    目标库存: i.totalQty || 0,
    集换价: i.outputJhj || '',
    最低价: i.outputLowest || '',
    成功: i.itemStatus === 'success',
  }))
})

// ================= 生命周期 =================
// 进页面/回到页面都重新对一次账：别拿着上一次的快照画这一屏。
const refresh = async () => {
  // 信息登记那份清单跟着页面对账一起刷新：别的时候改过（识别上传页点过蓝块、
  // 后台删过记录），回到这页要看见最新的。失败就保持原样（见 cardMarks 模块里的注释）。
  loadMarkedCodes().then((ok) => { if (ok) 登记版本.value++ })
  // ★ 只对 local/cloud 早退。原来写的是 `topTab !== 'listing'` —— 加了「已上架库」这枚页签之后，
  //   它会把这个新页签当成"本地库/云端库"处理：回到页面只拉库列表就 return，
  //   已上架库那屏永远不刷新。
  if (topTab.value === 'local' || topTab.value === 'cloud') { await fetchLibraries(); return }
  if (!currentBatchId.value) {
    const 接上了 = await checkAndRestoreQueue()
    if (!接上了) await 拉待解析库()
  }
  if (sub.value === 'listed') await 拉已上架()
}

onShow(() => { refresh() })

onMounted(() => {
  const check = () => {
    fetch('http://localhost:8090/api/status', { signal: AbortSignal.timeout(3000) })
      .then(r => r.json()).then(d => { modeOnline.value = !!(d.ok || d.bootCompleted) })
      .catch(() => { modeOnline.value = false })
  }
  check(); _modeTimer = setInterval(check, 5000)
  refresh()
})
onUnmounted(() => { clearInterval(_modeTimer) })
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

/* ========== 区块一：顶部导航栏 ========== */
.toolbar-panel {
  background-color: #FFFFFF;
  padding: 12px 16px 10px 16px;
  flex-shrink: 0;
  position: relative;
  z-index: 201;
}
.toolbar {
  display: flex; flex-direction: row;
  justify-content: space-between; align-items: center;
  position: relative;
}
.toolbar-left { display: flex; flex-direction: row; align-items: center; gap: 10px; }
.tool-title {
  position: absolute; left: 50%; transform: translateX(-50%);
  font-size: 15px; font-weight: 500; color: #1A1A1A;
}
.tool-btn {
  width: 32px; height: 32px; border-radius: 16px;
  background-color: #F0F0F0;
  display: flex; align-items: center; justify-content: center;
}
.icon-back { width: 18px; height: 18px; }
.version-selector {
  display: flex; flex-direction: row; align-items: center;
  background-color: #F0F0F0; border-radius: 16px; padding: 6px 12px; gap: 4px;
}
.version-text { font-size: 12px; color: #1A1A1A; }
.arrow { width: 12px; height: 12px; }
/* 顶栏横向预算只剩 ~65px，模式标签别撑开 */
.mode-tag { flex-shrink: 0; }

/* ========== 区块二：顶层页签 ==========
   四枚平级：本地库 / 云端库 / 待上架库 / 已上架库（V1.2.84）。
   `gap` 从 28px 收到 20px：多加一枚 4 字标签（已上架库）后，28px 的间距
   在 320px 宽的窄屏上正好贴边。宽度是量出来的，不是估的 —— 见 README 里那一节。 */
.library-tab { display: flex; flex-direction: row; justify-content: flex-start; gap: 20px; padding-left: 8px; }
.tab-item { display: flex; flex-direction: column; align-items: center; }
.tab-item text { font-size: 15px; color: #999999; }
.tab-item text.active { color: #1A1A1A; font-weight: 500; }
.red-line { width: 28px; height: 3px; background-color: #FF0000; border-radius: 2px; margin-top: 4px; }
/* ========== 「待上架库」底下的两枚子页签（V1.2.103） ==========
   跟顶栏那四枚**不是一个层级**，所以整体小一号、红短线也短一截：
   一眼要能看出这是"这一屏里的两页"，不是"又换了一个库"。
   背景铺白是接着下面那条动作栏，两行连成一块，中间不断色。 */
.sub-tabs {
  display: flex; flex-direction: row; align-items: center; gap: 18px;
  background: #FFFFFF; padding: 8px 16px 0;
}
.sub-tab { display: flex; flex-direction: column; align-items: center; }
.sub-tab .sub-t { font-size: 13px; color: #999999; }
.sub-tab.on .sub-t { color: #1A1A1A; font-weight: 500; }
.sub-line { width: 20px; height: 2px; background-color: #FF0000; border-radius: 1px; margin-top: 3px; }

/* ========== 钉住区（V1.2.105）==========
   子页签 / 动作栏 / 批次条 / 进度条 / 勾选条 / 当前卡方框这一圈，钉在顶栏正下方，
   翻列表时不跟着滚。做法是把它做成 <scroll-view> 的**兄弟**（模板里那段），
   这里只负责"不给压缩、压在上面"。
   ⚠️ 用 flex-shrink:0 不用 position:fixed：父容器是 height:100vh 的 flex 列，
   fixed 会脱出文档流，scroll-view 就不知道自己该多高（底下会缺一截）。 */
.pin-zone {
  flex-shrink: 0;
  background: #FFFFFF;
  position: relative;
  z-index: 10;
}

/* ========== 当前卡方框（V1.2.105）==========
   回答"这会儿在跑哪一张"。四档状态色跟左边那条竖线一起变（档位由 当前卡档 派生）。 */
.cur-card {
  display: flex; flex-direction: row; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 16px; background: #F2F7FF;
  border-left: 4px solid #4A90D9; border-bottom: 1px solid #EBEBEF;
  flex-shrink: 0;
}
.cur-card .cc-label { font-size: 12px; color: #888888; }
.cur-card .cc-code { font-size: 12px; color: #333333; font-weight: 600; }
.cur-card .cc-state { font-size: 12px; font-weight: 600; color: #4A90D9; }
.cur-card .cc-batch { font-size: 12px; color: #999999; }
.cur-card.s-success { border-left-color: #22B573; background: #F1FBF6; }
.cur-card.s-success .cc-state { color: #22B573; }
.cur-card.s-failed { border-left-color: #FF0000; background: #FFF3F3; }
.cur-card.s-failed .cc-state { color: #FF0000; }
/* 重试中（V1.2.108）：橙。夹在蓝（正在跑）和红（挂了）中间 —— 它两头都不是：
   这一遍确实挂了，但还没到结论，程序正在自己再试一遍。颜色取自原型
   Client/mock/listing-board-v3.html 的 .cur-card.s-retrying，别另调一个橙。 */
.cur-card.s-retrying { border-left-color: #FF9500; background: #FFF8EE; }
.cur-card.s-retrying .cc-state { color: #FF9500; font-weight: 700; }

/* ========== 动作栏 ========== */
.bar-pad {
  background: #FFFFFF;
  padding: 10px 16px;
}
.filter-bar { display: flex; flex-direction: row; justify-content: space-between; align-items: center; }
.status-col { display: flex; flex-direction: column; gap: 2px; }
.batch-label { font-size: 11px; color: #999999; }
.action-col { display: flex; flex-direction: row; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.filter-tag {
  display: flex; flex-direction: row; align-items: center;
  background-color: #F0F0F0; border-radius: 14px; padding: 5px 10px; gap: 4px;
}
.filter-tag-text { font-size: 11px; color: #1A1A1A; }
.parse-tag, .listing-tag { background-color: #FF0000; }
.parse-tag .filter-tag-text, .listing-tag .filter-tag-text { color: #FFFFFF; }
.back-tag { background-color: #666; }
.back-tag .filter-tag-text { color: #FFF; }
.trace-tag { background: #4A90D9; }
.trace-tag .filter-tag-text { color: #FFF; }
/* 批量完成：没点亮时是灰的（点不动），点亮才是红的 */
.finish-tag { background: #E8E8EA; }
.finish-tag .filter-tag-text { color: #999; }
.finish-tag.on { background: #FF0000; }
.finish-tag.on .filter-tag-text { color: #FFF; }
.parse-status { font-size: 13px; font-weight: 600; }
.status-pending { color: #999; }
.status-parsing { color: #FF6600; }
.status-done { color: #FF0000; }
.icon-xs { width: 14px; height: 14px; }

.batch-bar {
  background-color: #FFFFFF;
  padding: 8px 16px;
  border-top: 1px solid #F0F0F0;
  flex-shrink: 0;
}
.batch-summary-text { font-size: 11px; color: #666; }
.progress-bar { background: #FFF; padding: 2px 16px 6px; flex-shrink: 0; }
.progress-fill { height: 3px; background: #FF0000; border-radius: 2px; transition: width .3s; }
.progress-text { font-size: 10px; color: #FF0000; display: block; margin-top: 2px; }

/* ========== 主体滚动区 ========== */
.main-scroll { flex: 1; padding: 0; overflow-y: auto; }

/* ========== 包卡片 ========== */
.pkg-list { padding: 12px 16px 50px; display: flex; flex-direction: column; gap: 10px; }
.pkg {
  display: flex; flex-direction: row; align-items: stretch;
  background: #FFF; border-radius: 10px;
  border-left: 4px solid transparent;
  overflow: hidden;   /* 让右边那块矩形（.pkg-finish）被白板的圆角裁出来 */
}
/* 左竖条三档：frozen（待上架，蓝）/ done（已完成，绿）/ blocked（有编号缺目录，橙）。
   ⚠️ 没有「透明」这一档 —— 一条不画色的左边线看着像没加载完。 */
.pkg.frozen { border-left-color: #4A90D9; }
.pkg.done { border-left-color: #22B573; }
.pkg.blocked { border-left-color: #FF9500; }

/* 右边那一整块竖条：从卡片右边缘开始的**矩形**（不是圆角药丸），
   右边上下两个角的圆由 .pkg 的 overflow:hidden 裁出来。
   本色（蓝）= 可点的「放回」（本批已确认、还能退回待上架）；
   .ok（绿）= 归档后的死标记；.off（灰）= 点不动，「确认完成」的禁用态。 */
.pkg-finish {
  width: 38px; flex-shrink: 0;
  background: #4A90D9; color: #FFF;
  display: flex; align-items: center; justify-content: center;
  border-radius: 0 10px 10px 0;
}
.pkg-finish.ok { background: #22B573; }
.pkg-finish.off { background: #DCDCE1; }               /* 禁用灰，取自原型 listing-board.html:187 */
.pkg-finish .ft { width: 1em; font-size: 13px; line-height: 1.12; word-break: break-all; text-align: center; color: #FFF; }
.pkg-finish.off .ft { color: #8A8A8E; }

/* ---------- 勾选（V1.2.104）---------- */
/* 勾选条：勾几个包、一次把这几个包按顺序跑完。 */
.sel-bar {
  display: flex; flex-direction: row; align-items: center; gap: 10px;
  padding: 8px 16px; background: #FFF; border-bottom: 1px solid #EBEBEF;
  flex-shrink: 0;
}
.sel-bar .spacer { flex: 1; }
.sel-all { display: flex; flex-direction: row; align-items: center; gap: 6px; }
.sel-all.dim { opacity: .45; }          /* 跑动中不给改名单，压暗但不清零 */
.sel-all-t { font-size: 12px; color: #333333; }
.sel-count { font-size: 12px; color: #666666; }
.sel-b { color: #222222; font-weight: 500; }
/* 方形勾选框：白底灰边 → 红底白勾（跟包卡片右端那条竖条同一个红，不引入第三种颜色）。 */
.checkbox {
  width: 20px; height: 20px; border-radius: 5px;
  border: 1.5px solid #CCCCCC; background: #FFF;
  display: flex; align-items: center; justify-content: center;
}
.checkbox .ck { font-size: 13px; line-height: 1; color: transparent; }
.checkbox.checked { background: #FF0000; border-color: #FF0000; }
.checkbox.checked .ck { color: #FFF; }
/* 「▶ 开始上架」/「■ 终止」——同一枚按钮两种身份（见 开始批跑）。 */
.sel-start {
  border-radius: 14px; padding: 5px 14px;
  background: #FF0000;
  display: flex; align-items: center; justify-content: center;
}
.sel-start .sel-start-t { font-size: 12px; color: #FFF; }
.sel-start.off { background: #DCDCE1; }         /* 一个包都没勾：禁用灰 */
.sel-start.off .sel-start-t { color: #999999; }
.sel-start.running { background: #666666; }     /* 跑动中 = 终止，换成灰的，别跟"开始"一个色 */

/* 包卡片右端的「勾选」竖条：紧挨在「确认完成」左边、同宽同高（38px），点一下切换。
   未选 = 白底灰字；已选 = 红底白字「✓ 已选」，同时整张卡描一圈红边（.pkg.checked）。 */
.pkg-sel {
  width: 38px; flex-shrink: 0;
  background: #FFF; border-left: 1px solid #EBEBEF;
  display: flex; align-items: center; justify-content: center;
}
.pkg-sel .st { width: 1em; font-size: 13px; line-height: 1.12; word-break: break-all; text-align: center; color: #999999; }
.pkg-sel.on { background: #FF0000; border-left-color: #FF0000; }
.pkg-sel.on .st { color: #FFF; }
/* 跑动中整排不能改勾选（名单是起跑那一刻抄下的），但**已勾的照旧显示红条** ——
   把红条也灰掉，人就看不出这一趟到底勾了哪几个包了。所以只压暗，不换色。 */
/* ⚠️ 这儿必须带 `:not(.on)`：两条规则的特异性一样，不加的话后面这条会盖掉
   `.pkg-sel.on` 的红底白字，已勾的包在跑动中会变成灰条 —— 恰恰是这条注释想避免的事。 */
.pkg-sel.on.dim { opacity: .55; }
.pkg-sel.dim:not(.on) { background: #F7F7F8; }
.pkg-sel.dim:not(.on) .st { color: #D5D5DA; }
/* 已勾的整张卡描一圈红边。用 box-shadow 不用 border：border 会把卡片撑大 2px，
   一勾一取消整排卡片就跟着抖一下。 */
.pkg.checked { box-shadow: 0 0 0 2px #FF0000; }

.pkg-main { flex: 1; min-width: 0; padding: 10px 12px; }
.pkg-bar { display: flex; flex-direction: row; align-items: center; gap: 8px; }
.bar { width: 100px; height: 6px; background: #EEEEEE; border-radius: 3px; overflow: hidden; flex: none; }
.bar-fill { display: block; height: 100%; background: #22B573; }
.row2 { display: flex; flex-direction: row; align-items: baseline; gap: 10px; margin-top: 7px; }
.row2 .name { font-size: 16px; font-weight: 600; color: #1A1A1A; }
.row2 .qty { font-size: 13px; color: #666; }
.row2 .spacer { flex: 1; }
/* 原件是写死 width:66px + 右对齐。改成 min-width 是因为真程序的「完成于 2026/10/2」
   比原件的「刚完成」长，写死宽度会折成两行。 */
.row2 .state { font-size: 12px; color: #888; min-width: 66px; text-align: right; }
.flows { display: flex; flex-direction: row; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.chip { font-size: 12px; padding: 2px 9px; border-radius: 10px; white-space: nowrap; }
.chip.a { color: #2E7D32; background: #E8F5E9; }
.chip.b { color: #1565C0; background: #E3F2FD; }
.chip.c { color: #E65100; background: #FFF3E0; }
.chip.warn { color: #D97706; background: #FFF0E0; font-weight: 600; }
.chip.batch { color: #666; background: #F0F0F2; }

/* 还没解析的待上架库 */
.pkg-unparsed { background: #FFF; border-radius: 8px; padding: 12px; margin-top: 4px; }
.up-title { font-size: 12px; color: #999; display: block; margin-bottom: 6px; }
.up-row { display: flex; flex-direction: row; align-items: center; padding: 6px 0; border-bottom: 1px solid #F5F5F7; }
.up-code { font-size: 14px; font-weight: 500; color: #1A1A1A; }
.up-cnt { font-size: 11px; color: #999; margin-left: auto; }
.up-hint { font-size: 11px; color: #4A90D9; display: block; margin-top: 8px; }

/* ========== 包详情 ========== */
.detail-head {
  display: flex; flex-direction: row; align-items: center; gap: 14px; flex-wrap: wrap;
  background: #FFF; padding: 14px 16px;
  border-bottom: 1px solid #EBEBEF;
}
.detail-head .pname { font-size: 20px; font-weight: 700; color: #1A1A1A; }
.detail-head .info { font-size: 13px; color: #666; }
.detail-head .spacer { flex: 1; }
/* 状态字：待上架的蓝、存档的绿。不需要说的时候整枚不渲染（v-if），不留空位。 */
.detail-head .dstate { font-size: 13px; color: #4A90D9; }
.detail-head .dstate.done { color: #22B573; }
.btn { padding: 7px 16px; border-radius: 20px; display: flex; align-items: center; }
.btn.sm { padding: 5px 12px; }
.btn.primary { background: #FF0000; }
/* 急停改成原件那档「白底描边」（原先是深灰实底）——跟红按钮并排时，
   两个实底会互相抢，一个红一个白才分得出哪个是主动作。 */
.btn.ghost { background: #FFF; border: 1px solid #DDDDDD; }
.btn-text { font-size: 13px; color: #FFF; }
.btn.ghost .btn-text { color: #333; }
.hint { font-size: 12px; color: #999; padding: 0 16px 6px; line-height: 1.6; }
.hint .b { color: #4A90D9; font-weight: 600; }
/* 有编号查不到目录时的黄底提示条 */
.note-bar {
  margin: 12px 16px 0; padding: 10px 14px; border-radius: 8px;
  background: #FFF8E6; color: #8A6D1F; font-size: 13px; line-height: 1.7;
}
.note-bar .nb-b { font-weight: 700; }
/* 带子里那一排「就地解决」的按钮。
   （V1.2.107 前这里还有第二排「信息登记」块，已挪到每一行上 —— 见 .card-reg-block。） */
.note-bar .nb-line { margin-top: 8px; }
.note-bar .nb-btns { display: inline-flex; gap: 8px; margin-left: 2px; }
.note-bar .nb-btn {
  display: inline-block; padding: 3px 12px; border-radius: 6px;
  background: #E8A33D; color: #FFF; font-size: 12px; font-weight: 600;
}
.note-bar .nb-btn:active { background: #D08F2C; }

.card-list { display: flex; flex-direction: column; padding: 0 0 60px; }
/* 卡片行 = 识别上传页的那张卡：**白底**、不画边框、靠 4px 缝分隔。
   白卡得浮在浅灰页面(#F5F5F7)上才看得出来。右边不留内边距，
   好让「标记已上架」那条竖块贴到卡片最右边缘。 */
.card-row {
  display: flex; flex-direction: row; align-items: stretch;
  background: #FFFFFF; position: relative;
  padding: 14px 0 14px 16px; margin-bottom: 4px;
}
/* 状态**只用底色表达，一律不画边框**：未上架=白 / 已上架=淡绿 / 失败=正红反白 */
.card-row.listed { background: #EAF9EF; }
.card-row.failed { background: #FF0000; }
.card-row.failed .name-main,
.card-row.failed .name-sub,
.card-row.failed .meta-text,
.card-row.failed .cerr,
.card-row.failed .noname { color: #FFFFFF !important; }
/* 卡密胶囊和异画标签自带底色，红卡上要把底色抽掉才看得见白字 */
.card-row.failed .ext-code { background: transparent !important; color: #FFFFFF !important; }
.card-row.failed .alt-badge { background: transparent !important; color: #FFFFFF !important; }
/* 红卡上那个「×目标」胶囊：默认就是红底白字，再铺红底就消失了 —— 反过来做成白底红字 */
.card-row.failed .cqty { background: #FFFFFF !important; color: #FF0000 !important; }
/* 只读版（已上架库点进来的）没有右边那条竖条，右边得自己留出内边距，
   不然「×N」会贴到卡片边缘。 */
.card-row.ro { padding-right: 16px; }
/* 正在执行：左边一条蓝内竖条 + 淡蓝底。
   用 inset shadow 而不是 border —— border 会撑大盒子，把右边那条竖块挤歪。 */
.card-row.running { background: #F2F7FF; box-shadow: inset 4px 0 0 #4A90D9; }
/* 起点：跟「正在执行」**同一根同色的蓝竖条**，只是没有淡蓝底。
   跑起来的时候它就是起点往下推的结果，换个颜色反而要多认一次（原型 :260-272 的原话）。
   .cur 与 .running 是两个独立 class、可以共存，都画同一条 shadow，叠着也看不出来。 */
.card-row.cur { box-shadow: inset 4px 0 0 #4A90D9; }
.cimg {
  width: 59px; height: 86px; flex-shrink: 0;
  border-radius: 2px; background: #EEEEEE;
}
/* 目录里查不到的编号：红边白底的空框，**不放卡背** */
.cimg.miss { border: 2px solid #FF3B30; background: #FFFFFF; box-sizing: border-box; }
/* 中间四行。行高 / 字号 / 间距全部对齐识别上传页的 .card-info 一系。
   ⚠️ .cinfo 是 space-between，但此刻**没有富余空间**（内容正好等于卡图的 86px），
      所以下面那几个 margin-top 加多少就往下推多少，不会被自动分配吃掉。 */
.cinfo {
  margin-left: 12px; flex: 1; min-width: 0;
  display: flex; flex-direction: column; justify-content: space-between;
}
/* 第 1 行：名字 + 右端那一组小签。flex 只是为了让签子能靠 margin-left:auto 顶到最右，
   名字本身是个普通 flex 项，行高还是 1.8，整行高度不变。
   ⚠️ 类名按**位置**叫，不按语种叫：上面那行是主名、下面那行是副名。 */
.name-main { display: flex; flex-direction: row; align-items: center; }
.name-main .nm { font-size: 15px; font-weight: 600; color: #1A1A1A; line-height: 1.8; }
.name-main .noname { color: #FF3B30; font-weight: 400; }
.name-sub { font-size: 12px; color: #666; margin-top: 2px; }
/* 第 3 行：编号 / 罕贵度 / 品相 / 备注 并排一行 */
.card-meta { display: flex; flex-direction: row; gap: 8px; margin-top: 4px; }
.meta-text { font-size: 11px; color: #666; }
.code-text { font-family: Consolas, monospace; }
/* 第 4 行：卡密 + 异画标签 + 右端的（详细 / 重跑 / 上架价格 / ×目标库存） */
.card-codes {
  display: flex; flex-direction: row; gap: 8px; align-items: center;
  margin-top: 5px; flex-wrap: wrap;
}
.ext-code {
  font-size: 10px; color: #007AFF; background: #F0F4FF;
  padding: 1px 6px; border-radius: 3px; white-space: nowrap;
}
/* 异画标签：显示的是**标签自己的值**（原画/初版/异画…）。
   「待填」是占位符 → 灰底，一眼看出这个标签还没人填过。 */
.alt-badge {
  padding: 2px 8px; border-radius: 10px; flex-shrink: 0;
  font-size: 10px; font-weight: 500; white-space: nowrap;
}
.alt-badge.alt-has { background: rgba(52, 199, 89, 0.12); color: #34C759; }
.alt-badge.alt-none { background: rgba(142, 142, 147, 0.10); color: #8E8E93; }
/* 第 1 行右端那两枚小签。靠 margin-left:auto 顶到最右，紧挨着右边那条竖块 ——
   这就是「卡牌的右侧」。名字太长时它会自己换行，签子 flex-shrink:0 不会被压扁。 */
.tag-group {
  margin-left: auto; flex-shrink: 0; padding-left: 10px;
  display: flex; flex-direction: row; align-items: center; gap: 6px;
}
/* 机器停在谁身上就把它标出来。一张要跑好几秒，不闪一下整屏一动不动，看着像卡死了 ——
   所以让它一闪一闪，既表示"还活着"，也顺带告诉人"当前进度在这"。 */
.run-tag {
  display: none; font-size: 10px; color: #FFF; background: #4A90D9;
  border-radius: 3px; padding: 1px 5px; white-space: nowrap;
}
.card-row.running .run-tag { display: inline-block; animation: slan-breath 1.2s ease-in-out infinite; }
/* 「起点」签：跟 run-tag 长得一样，但它**不闪**（起点是静止的，闪起来就成"正在跑"了）。
   .running 那行让它让位给「正在执行中」—— 同一行两枚签挤在一起反而说不清谁是谁。 */
.start-tag {
  display: none; font-size: 10px; color: #FFF; background: #4A90D9;
  border-radius: 3px; padding: 1px 5px; white-space: nowrap;
}
.card-row.cur .start-tag { display: inline-block; }
.card-row.running .start-tag { display: none; }
@keyframes slan-breath { 0%, 100% { opacity: 1 } 50% { opacity: .4 } }
/* 「流程 A / B / C」**一档一个颜色**，扫一眼就知道这行归哪一档（三档都同一个红，
   非得读字才分得出来）。这三个颜色跟包列表里那三枚 chip 是**同一套** ——
   同一个概念在页面上只该有一个颜色，不然每换一屏都得重新认一遍。 */
.flow-tag {
  display: inline-block;
  font-size: 10px; color: #FFFFFF;
  border-radius: 3px; padding: 1px 5px; white-space: nowrap;
}
.flow-tag.flow-A { background: #2E7D32; }
.flow-tag.flow-B { background: #1565C0; }
.flow-tag.flow-C { background: #E65100; }
/* 失败的红卡整行翻红，什么底色铺上去都糊 —— 跟 ×N 那颗一样反过来做成白底。
   但**字要留这一档自己的颜色**：三档全刷成同一个红字，红卡上就白分 A/B/C 了。 */
.card-row.failed .flow-tag { background: #FFFFFF !important; }
.card-row.failed .flow-tag.flow-A { color: #1B5E20 !important; }
.card-row.failed .flow-tag.flow-B { color: #0D47A1 !important; }
.card-row.failed .flow-tag.flow-C { color: #BF360C !important; }
/* 失败原因：红卡上翻白（不然红字压红底，什么都看不见） */
.cerr { font-size: 12px; color: #FF3B30; margin-top: 4px; }

/* 卡面右下角这一排，从左到右：详细（灰底黑字）→ 重跑 → 上架价格（白底小输入框）→ ×目标库存。
   前两样和价格框、×N **尺寸字号一模一样**，就靠底色区分，摆一排才齐。 */
.cqty-group { margin-left: auto; display: flex; flex-direction: row; align-items: center; gap: 6px; }
.cdetail-btn {
  white-space: nowrap;
  font-size: 11px; font-weight: 600;
  border-radius: 10px; padding: 2px 8px;
  background: #E2E2E8;
}
.cdetail-text { font-size: 11px; font-weight: 600; color: #1A1A1A; }
/* 「重跑」原件没有，是真程序补的动作键（跑红了放回待执行）。做成同尺寸的白底红字，
   不跟「详细」抢眼，也不至于在红卡上消失。 */
.cmini {
  white-space: nowrap;
  border-radius: 10px; padding: 2px 8px;
  background: #FFFFFF; border: 1px solid #FFB4B4;
}
.cmini-text { font-size: 11px; font-weight: 600; color: #FF3B30; }
/* 「上架价格」**不是按钮，是一个跟左右两颗一样大的小输入框**。
   高度写死 19px（配合全局 border-box，含 1px 边框仍与左右两颗等高），
   不然 input 自带的行高会把它撑高一行。 */
.cprice-input {
  /* 宽 72px 是**缩到底**的数：里面最宽的显示是「1234.00元」= 54.8px，
     加左右内边距 12 + 边框 2 = 68.8px。 */
  width: 72px; height: 19px;
  font-size: 11px; font-weight: 600;
  border-radius: 10px; padding: 0 6px;
  border: 1px solid #D8D8DE; background: #FFFFFF;
  color: #1A1A1A; text-align: center;
  font-variant-numeric: tabular-nums;
}
.cprice-ph { color: #A8A8AE; font-size: 11px; font-weight: 500; }
/* 只读版里价格那一格**不是输入框，是一段死文字**：宽高字号跟左右的「详细」「×N」对齐，
   看着还是原来那一排，只是敲不进去了。 */
.cprice-ro {
  display: inline-flex; align-items: center; justify-content: center;
  width: 72px; height: 19px; border-radius: 10px;
  font-size: 11px; font-weight: 600; color: #1A1A1A;
  background: #FFFFFF; border: 1px solid #E8E8EE;
  font-variant-numeric: tabular-nums;
}
.card-row.failed .cprice-ro {
  color: #FFFFFF !important; background: transparent !important;
  border-color: rgba(255, 255, 255, .35) !important;
}
/* 「×目标库存」**红底白字**，点一下弹出三条明细 */
.cqty {
  font-size: 11px; font-weight: 600; color: #FFFFFF;
  background: #FF3B30; border-radius: 10px; padding: 2px 8px;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}

/* 「信息登记」竖直条（V1.2.107）：跟识别上传页那张卡上的块同一个样式语言 ——
   窄条 + 竖排白字 + 撑满卡片高度。margin 上下各 -14px 抵消 .card-row 的内边距（同 .cmark），
   左边 12px 是跟卡面内容隔开；右边不留缝，直接贴住「标记已上架」那条灰条，
   两枚并成一组"卡片右端的动作区"。
   ⚠️ 宽度比 .cmark 窄一点（28 vs 30）：它俩挨着，同宽会看着像一根柱子被劈成两半。 */
.card-reg-block {
  width: 28px; flex-shrink: 0; align-self: stretch; margin: -14px 0 -14px 12px;
  background: #4A90D9; display: flex; align-items: center; justify-content: center;
}
/* 已登记：蓝变绿「信息已登记」。**再按一下 = 取消登记**（弹框确认，见 点登记块）。
   绿不跟红卡反白 —— 红卡上这枚保持绿色，正好当"这张红卡我已经登记过了"的记号
   （跟识别上传页同一个口径）。 */
.card-reg-block.on { background: #34C759; }
.card-reg-block:active { opacity: 0.85; }
.reg-text {
  width: 1em; font-size: 15px; line-height: 1.1; color: #FFF;
  word-break: break-all; text-align: center;
}
/* 「信息已登记」5 个字竖排比「信息登记」4 个字高一截，字号收一档免得撑破卡片高度。
   必须写在 .reg-text 之后：两个类 specificity 相同，平局时靠后的赢。 */
.reg-text.sm { font-size: 13px; line-height: 1.05; }

/* 右端竖直条：点一下在「标记已上架(灰)」和「已上架(绿)」之间来回切。
   margin 上下各 -14px 是为了抵消 .card-row 的上下内边距，让它**顶天立地**。
   ⚠️ 左边距是 0，不是 12 —— V1.2.107 起它左边永远紧贴着「信息登记」那条（两者同一个
   v-if="!只读包"，要么都在要么都不在），中间那 12px 的缝由登记块自己的左边距出。
   跟识别上传页那排竖块一个道理：挨着的块拼成一组，中间露一道底色像是画错了。 */
.cmark {
  width: 30px; flex-shrink: 0; align-self: stretch; margin: -14px 0 -14px 0;
  background: #B8B8BE; display: flex; align-items: center; justify-content: center;
}
.cmark.on { background: #34C759; }
.cmark-text {
  width: 1em; font-size: 13px; line-height: 1.05; color: #FFF;
  word-break: break-all; text-align: center;
}

/* ========== 详细弹层：一个弹层，两张脸 ==========
   顶上那两枚按钮翻页，一次只亮一枚。竖屏上 420px 并排放不下两块，硬分会挤成两条细缝。 */
.out-mask {
  position: fixed; inset: 0; z-index: 600;
  background: rgba(0, 0, 0, .45);
  display: flex; align-items: center; justify-content: center;
}
.out-box {
  width: 420px; max-width: 92vw; max-height: 80vh;
  background: #FFF; border-radius: 12px;
  display: flex; flex-direction: column; overflow: hidden;
}
.out-head {
  display: flex; flex-direction: row; align-items: center;
  padding: 13px 16px; border-bottom: 1px solid #F0F0F3;
}
.out-title { font-size: 15px; font-weight: 600; color: #1A1A1A; flex: 1; }
.out-close { font-size: 15px; color: #999; padding: 0 4px; }
/* 两枚等宽平分，右边那枚的数字跟着实体卡份数走。竖屏上要够大才点得准 —— 高度给到 34px。 */
.dt-tabs { display: flex; flex-direction: row; gap: 8px; padding: 10px 16px 0; }
.dt-tab {
  flex: 1; height: 34px;
  display: flex; flex-direction: row; align-items: center; justify-content: center;
  font-size: 13px; color: #666;
  background: #FFF; border: 1px solid #E4E4E9; border-radius: 8px;
}
.dt-tab .dt-t { font-size: 13px; color: #666; }
.dt-tab .dt-n { font-size: 11px; color: #AAA; margin-left: 5px; }
.dt-tab.on { background: #EAF2FE; border-color: #4A90D9; }
.dt-tab.on .dt-t { color: #1565C0; font-weight: 600; }
.dt-tab.on .dt-n { color: #4A90D9; }
.dt-body { flex: 1; padding: 6px 0 10px; overflow-y: auto; }
.out-row {
  display: flex; flex-direction: row;
  padding: 6px 16px; gap: 10px;
  border-bottom: 1px solid #F7F7F9;
}
.out-k { width: 92px; flex-shrink: 0; font-size: 13px; color: #888; }
.out-v { flex: 1; font-size: 13px; color: #222; word-break: break-all; }
.out-v.empty { color: #C4C4CA; }
/* 14 项分三组，每组顶上压一条灰底小标题。分组只为了**扫读**：
   一眼知道这堆是"卡的身份"还是"上架内容"，不用逐行读键名去猜。
   底色比行分隔线略深一档，才看得出它是"一条带子"而不是一行字。 */
.out-g {
  display: flex; flex-direction: row; align-items: center; gap: 6px;
  padding: 9px 16px 5px; font-size: 11px; font-weight: 600; color: #8A8A92;
  background: #FAFAFC; border-top: 1px solid #EDEDF2; border-bottom: 1px solid #F4F4F7;
}
.out-g .out-n { color: #B8B8C0; font-weight: 400; }
/* 第一条不带顶边：上面就是弹层标题栏那条分隔线，再来一条就成了双线。 */
.out-g:first-child { border-top: none; }
.out-none { padding: 26px 16px; color: #999; font-size: 13px; line-height: 1.7; text-align: center; }
.out-err { margin: 10px 16px 0; padding: 8px 10px; border-radius: 6px; background: #FFE8E8; color: #C0392B; font-size: 12px; }

/* 实体卡那一面：一行 = 一张实体卡（序号 + 流水号 + 库位号） */
.loc-head {
  display: flex; flex-direction: row; align-items: center; gap: 8px;
  padding: 4px 16px 8px; font-size: 12px; color: #888;
  border-bottom: 1px solid #EBEBEF;
}
.loc-head-r { margin-left: auto; }
.loc-row {
  display: flex; flex-direction: row; align-items: center; gap: 10px;
  padding: 7px 16px; border-bottom: 1px solid #F0F0F3;
}
.loc-idx { width: 2.2em; font-size: 11px; color: #AAA; text-align: right; }
.loc-serial { font-family: Consolas, monospace; font-size: 13px; color: #1A1A1A; }
.loc-cond { font-size: 11px; color: #FF3B30; }
.loc-note { font-size: 11px; color: #999; }
.loc-lib {
  margin-left: auto; font-size: 11px; color: #4A90D9;
  background: #F0F4FF; padding: 1px 7px; border-radius: 3px;
  font-family: Consolas, monospace;
}
.loc-del { padding: 2px 8px; border: 1px solid #E5B4B4; border-radius: 10px; flex-shrink: 0; }
.loc-del-text { font-size: 11px; font-weight: 600; color: #FF3B30; }
.loc-all { display: flex; flex-direction: row; justify-content: flex-end; padding: 10px 16px 0; }
.loc-del-all { padding: 4px 12px; border: 1px solid #E5B4B4; border-radius: 10px; }
.loc-del-all-text { font-size: 12px; font-weight: 600; color: #FF3B30; }

/* ========== 卡图全屏 ==========
   比输出参数弹层（z-index 600）再高一档，免得叠在它下面。整块都是关闭热区。 */
.big-mask {
  position: fixed; inset: 0; z-index: 700;
  background: rgba(0, 0, 0, .88);
  display: flex; align-items: center; justify-content: center;
}
.big-img { max-width: 92vw; max-height: 88vh; border-radius: 6px; }
.big-tip {
  position: absolute; left: 0; right: 0; bottom: 26px; text-align: center;
  color: rgba(255, 255, 255, .68); font-size: 13px;
}

/* ========== ×目标库存 三行明细 ==========
   照原件：**深色小气泡**，不是居中弹窗。position:fixed，位置由 JS 按那枚小框算。
   遮罩是全**透明**的，只负责"点别处收起来"。 */
.qty-mask { position: fixed; inset: 0; z-index: 650; }
.qty-pop {
  position: fixed; z-index: 651;
  background: #1F1F23; border-radius: 8px;
  padding: 10px 12px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
  white-space: nowrap;
}
.qp-line { display: flex; flex-direction: row; align-items: baseline; }
.qp-k { color: #A9A9B2; font-size: 12px; line-height: 1.75; display: inline-block; min-width: 5em; }
.qp-v { font-weight: 600; font-size: 12px; line-height: 1.75; color: #FFF; font-variant-numeric: tabular-nums; }
.qp-v.total { color: #FFD166; }

/* ========== 溯源表 ==========
   这块本来就是横着看的（11 列、要 ~800px），窄屏上靠外层 overflow-x 滚。
   真程序里用 flex 行而不是 <table> —— uni-app 没有 table 这号组件。 */
.trace-bar { background: #FFF; padding: 10px 16px; }
.trace-scroll { background: #FFF; margin-top: 12px; }
.trace-table { display: flex; flex-direction: column; min-width: 860px; }
.tr { display: flex; flex-direction: row; align-items: stretch; border-bottom: 1px solid #F0F0F2; }
.tr.th { background: #FAFAFB; }
.tr.th .td { font-size: 12px; color: #888; font-weight: 500; }
.td {
  font-size: 12px; color: #1A1A1A;
  padding: 8px 10px; box-sizing: border-box;
  display: flex; align-items: center; word-break: break-all;
}
.td.col { flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px; }
.td.num { justify-content: center; }
.td.w46 { width: 46px; flex-shrink: 0; }
.td.w52 { width: 52px; flex-shrink: 0; }
.td.w58 { width: 58px; flex-shrink: 0; }
.td.w62 { width: 62px; flex-shrink: 0; }
.td.w64 { width: 64px; flex-shrink: 0; }
.td.w78 { width: 78px; flex-shrink: 0; }
.td.w132 { width: 132px; flex-shrink: 0; }
.td.w180 { width: 180px; flex-shrink: 0; }
.t-code { font-family: Consolas, monospace; font-size: 13px; color: #1A1A1A; }
.t-name { font-size: 13px; color: #333; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t-name.missing { color: #FF3B30; }
.t-jhj { font-size: 12px; color: #E65100; font-weight: 600; font-variant-numeric: tabular-nums; }
.t-low { font-size: 12px; color: #999; font-variant-numeric: tabular-nums; }
.td.num { font-variant-numeric: tabular-nums; color: #555; }
.td.target { color: #222; font-weight: 600; }
.t-ok { color: #22B573; font-weight: 600; }
.t-bad { color: #FF3B30; font-weight: 600; }
.none { color: #CCC; }
.td.empty { justify-content: center; color: #CCC; padding: 40px 0; }
.trace-hint { background: #FFF; padding: 10px 16px 40px; }

/* ========== 库列表 ========== */
.list-section { padding-top: 6px; padding-bottom: 50px; }
.list-card {
  display: flex; flex-direction: row; align-items: center; justify-content: space-between;
  background-color: #FFFFFF; padding: 12px 16px; margin-bottom: 4px;
}
.card-left { display: flex; flex-direction: column; flex: 1; gap: 2px; }
.card-code-line { font-size: 15px; font-weight: 600; color: #1A1A1A; }
.card-info-line { font-size: 12px; color: #999999; margin-top: 2px; }
.card-right { display: flex; flex-direction: row; gap: 6px; align-items: center; flex-shrink: 0; }
.icon-btn {
  width: 34px; height: 34px; border-radius: 17px;
  background-color: #F0F0F0;
  display: flex; align-items: center; justify-content: center;
}
.upload-icon-btn { background-color: #FF0000; }
.act-icon { width: 18px; height: 18px; }
.upload-icon-btn .act-icon { filter: brightness(0) invert(1); }

.empty-hint {
  display: flex; align-items: center; justify-content: center;
  padding: 60px 24px; font-size: 13px; color: #CCCCCC; text-align: center; line-height: 1.8;
}

/* ================= 「已上架库」按包看 / 按库位看 的切换 ================= */
/* 一枚两段的小胶囊，摆在包列表最上面。做成小尺寸是**故意的**：
   它切的是"看法"，不是顶栏那种"换一个库"，别跟顶栏四枚平级抢注意力。 */
.seg-bar { display: flex; flex-direction: row; align-items: center; gap: 8px; padding: 10px 16px 4px; }
.seg {
  padding: 3px 14px; border-radius: 14px;
  background: #F0F0F2; border: 1px solid transparent;
}
.seg.on { background: #FFFFFF; border-color: #4A90D9; }
.seg-t { font-size: 12px; color: #666; }
.seg.on .seg-t { color: #4A90D9; font-weight: 600; }
/* 右边这行小字是给切换做注解的 —— 两个看法名字太像，不写一句"答的是什么问题"，
   人得点进去才知道哪个是哪个。 */
.seg-note { margin-left: auto; font-size: 11px; color: #AAA; }

/* 按库位看那一屏的脚注（混装说明 / 正在拉数据）。跟 .hint 同一档观感，
   但它出现在列表**下面**，所以底部留白跟 .card-list 那 60px 对齐。 */
.lib-note {
  padding: 10px 16px 60px; font-size: 11px; color: #AAA; line-height: 1.7;
}
/* 库位详情那一屏的提示行：它上面压着 filter-bar，下边距给一点点就够 */
.shelf-hint { padding-top: 4px; }
</style>
