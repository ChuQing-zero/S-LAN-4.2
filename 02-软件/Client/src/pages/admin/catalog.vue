<template>
  <view class="page-container">
    <!-- ====== 顶部工具栏 ====== -->
    <view class="toolbar-panel">
      <view class="toolbar">
        <view class="toolbar-left">
          <view class="tool-btn" @tap="goBack">
            <image class="icon-sm" src="/static/icons/ic_back.png" mode="aspectFit" />
          </view>
          <view class="tool-btn" @tap="onSearch">
            <image class="icon-sm" src="/static/icons/ic_search.png" mode="aspectFit" />
          </view>
        </view>
        <text class="tool-title">卡牌编号目录</text>
        <picker :value="srcIdx" :range="srcOptions" @change="onSrcChange" class="src-picker">
          <view class="src-btn">
            <text class="src-btn-text">{{ srcOptions[srcIdx] }}</text>
            <image class="src-arrow" src="/static/icons/ic_arrow_down.png" mode="aspectFit" />
          </view>
        </picker>
      </view>
    </view>

    <!-- ====== 筛选栏（仅详细图源：按卡包） ====== -->
    <view class="filter-section" v-if="!inDetail && srcIdx === 0">
      <view class="filter-bar">
        <view class="filter-tag" @tap="showCatPicker">
          <text class="filter-tag-text">{{ catLabel }}</text>
          <image class="small-arrow" src="/static/icons/ic_arrow_down.png" mode="aspectFit" />
        </view>
        <view class="filter-tag" @tap="showStatusPicker">
          <text class="filter-tag-text">{{ statusLabel }}</text>
          <image class="small-arrow" src="/static/icons/ic_arrow_down.png" mode="aspectFit" />
        </view>
      </view>
    </view>

    <!-- ====== 主内容区 ====== -->
    <scroll-view class="main-scroll" scroll-y="true" :show-scrollbar="false">

      <!-- 卡包列表（详细图源：按卡包分类） -->
      <view v-if="!inDetail && srcIdx === 0">
        <view class="search-bar">
          <view class="search-box">
            <image class="search-icon-sm" src="/static/icons/ic_search.png" mode="aspectFit" />
            <input class="search-input" v-model="packSearch" placeholder="搜索卡包..." />
          </view>
          <text class="pack-count">共 {{ filteredPacks.length }} 包</text>
          <!-- 新建卡包放这里，**不放顶栏**：顶栏左侧到标题只剩几十像素，再塞一个按钮
               会把「卡牌编号目录」挤歪（这条是量过的）。搜索栏这一行本来就还有空位。 -->
          <view class="new-pack-btn" @tap="openNewPack"><text class="new-pack-t">＋ 新建</text></view>
        </view>
        <view class="pack-grid">
          <view class="pack-card" :class="'st-' + (p.status || 'pending')" v-for="p in filteredPacks" :key="p.code" @tap="openPack(p)">
            <!-- 删除键。**必须 `.stop`** —— 整张卡是 @tap="openPack(p)"，不挡住的话
                 点删除会连带进包。 -->
            <text class="pack-del" @tap.stop="startDeletePack(p)">🗑</text>
            <text class="pack-code">{{ p.code }}</text>
            <text class="pack-name">{{ p.full_name }}</text>
            <view class="pack-meta">
              <text>{{ p.date || '' }}</text>
              <text>{{ p.total_cards || '?' }}张</text>
              <text class="pack-status">{{ statusText(p.status) }}</text>
              <!-- 「信息登记」角标：说的是「这包有几张要人工处理」，与状态竖条说的
                   「图源齐不齐」是两件事，所以两者并存、不互相覆盖 -->
              <text v-if="packMarkCounts[p.code]" class="pack-flag">登记 {{ packMarkCounts[p.code] }}</text>
            </view>
          </view>
          <view v-if="filteredPacks.length === 0" class="empty-state">暂无匹配卡包</view>
          <!-- 归不到任何卡包的登记编号不能就这么消失：它们前缀在图源里可能真有目录，
               只是没进卡牌编号目录。单列一张清单，点开能看是哪几个编号。 -->
          <view v-if="orphanMarks.length" class="orphan-bar" @tap="orphanVisible = true">
            <text class="orphan-text">⚠️ 有 {{ orphanMarks.length }} 条登记记录不属于任何卡包（点开看清单）</text>
            <text class="orphan-arrow">▸</text>
          </view>
          <!-- 图源里有目录、_index.json 里没收录的包。**不铺进主列表**（用户已定：
               一级保持 929 个不变，找包才快），但也不能让它们真的消失 —— 这里给一行提示，
               点开是纯清单，还能直接开那个包的目录浏览。 -->
          <view v-if="uncatTotal || uncatMissingTotal" class="uncat-bar" @tap="openUncat">
            <text class="uncat-text">图源里还有 {{ uncatTotal }} 个包未收录到目录{{ uncatMissingTotal ? '，另有 ' + uncatMissingTotal + ' 个目录里有、图源里没文件夹' : '' }}（点开看清单）</text>
            <text class="uncat-arrow">▸</text>
          </view>
        </view>
      </view>

      <!-- 保底图源模式：卡牌单个展开，按卡密搜索 -->
      <view v-if="!inDetail && srcIdx === 1">
        <view class="search-bar">
          <view class="search-box">
            <image class="search-icon-sm" src="/static/icons/ic_search.png" mode="aspectFit" />
            <input class="search-input" v-model="ygoproKw" placeholder="搜索卡牌卡密..." confirm-type="search" @confirm="loadYgoPro(1)" />
          </view>
          <text class="pack-count">{{ ygoproStats }}</text>
        </view>
        <view class="ygopro-grid">
          <view class="ygopro-card" v-for="img in ygoproList" :key="img.name" @tap="copyCardNo(img.name)">
            <image :src="img.url" mode="aspectFill" class="ygopro-img" @error="img.err = 1" />
            <text class="ygopro-no">{{ img.name }}</text>
          </view>
          <view v-if="ygoproList.length === 0" class="empty-state">{{ ygoproLoading ? '加载中...' : '暂无匹配卡牌' }}</view>
        </view>
        <view class="ygopro-pager" v-if="ygoproTotalPages > 1">
          <view class="pager-btn" :class="{ active: ygoproPage === i }" v-for="i in ygoproPageRange" :key="i" @tap="loadYgoPro(i)">
            <text>{{ i }}</text>
          </view>
        </view>
      </view>

      <!-- 卡牌详情 -->
      <view v-if="inDetail">
        <view class="detail-bar">
          <text class="detail-info">{{ packData.full_name || packCode }} · {{ packData.date }} · {{ cards.length }}张</text>
          <view class="detail-btns">
            <view class="btn-dir" @tap="openPackDir('')"><text class="btn-dir-text">📁 目录</text></view>
            <view class="btn-dir" @tap="pickImages"><text class="btn-dir-text">⬆️ 传图</text></view>
            <!-- 没有「修改 / 保存」这一对了：所有改动都在「卡牌详情」弹窗里做，点「确认更改」立刻落库。
                 加卡也搬进了弹窗（这个按钮就是入口）—— 以前它挂在表格的「＋ 添加一行」上，
                 而那张表在 <900px 是 display:none，手机上根本够不着。 -->
            <view class="btn-edit" @tap="openEditCard(null)"><text class="btn-text">＋ 新增一张卡</text></view>
          </view>
        </view>

        <!-- 空包引导卡。刚建出来的包就在这里开始填东西：格式要求写在最前面，因为
             文件名里罕贵度那一段写错**不会报错**，只会让卡片安安静静显示成卡背。
             只在「一条目录都没有」时出现 —— 导完 Excel 它就自己让位给卡表了。 -->
        <view v-if="cards.length === 0" class="guide-card" :class="{ 'guide-over': dragOver }">
          <text class="gc-title">这个卡包还没有卡牌数据</text>
          <text class="gc-path">图片放这里：{{ packDir || '读取中…' }}</text>
          <text class="gc-rule">命名：编号-罕贵.jpg（原画）／编号-罕贵-异画号.jpg（异画）</text>
          <text class="gc-rule">例：QCAC-JP001-SER.jpg、QCAC-JP001-SER-1.jpg</text>
          <text class="gc-rule">支持 .jpg / .jpeg / .png / .webp；下划线开头的文件会被忽略</text>
          <text class="gc-warn">罕贵度那一段必须和表格里填的一字不差，否则卡片会显示成卡背</text>
          <view class="gc-drop" @tap="pickImages">
            <text class="gc-drop-t">{{ dragOver ? '松手就传' : '把图片拖到这里，或点这里选文件' }}</text>
          </view>
          <view class="gc-btns">
            <view class="gc-btn" @tap="openPackDir('')"><text class="gc-btn-t">📁 打开目录</text></view>
            <view class="gc-btn" @tap="pickImages"><text class="gc-btn-t">⬆️ 上传图片</text></view>
            <view class="gc-btn" @tap="pickExcel"><text class="gc-btn-t">📊 导入 Excel</text></view>
          </view>
          <view class="gc-btns">
            <view class="gc-btn gc-plain" @tap="downloadTemplate"><text class="gc-btn-t2">⬇️ 下载 Excel 模板</text></view>
          </view>
          <text class="gc-rule">表头：卡牌编号 / 卡密 / 日文名 / 中文名 / 英文名 / 罕贵度 / 异画序号（表头行在第几行都行，会自动找）</text>
          <text v-if="upText" class="gc-busy">{{ upText }}</text>
          <text v-if="packFileCount !== null" class="gc-rule">本包目录里现在有 {{ packFileCount }} 个图片文件</text>
        </view>

        <view v-if="Object.keys(markIndex).length" class="mk-legend">
          <text class="mk-dot mk-exact"></text><text class="mk-legend-t">已被登记（待人工核对）</text>
          <text class="mk-dot mk-norm mk-legend-gap"></text><text class="mk-legend-t">已被登记，但编号位数和目录不一致</text>
        </view>

        <!-- 本包登记了、但当前卡表里对不上的记录：明着列出来，不要让它静悄悄地不红。
             这是「登记了 42 张、一张都不红」这种困惑的唯一解释来源。
             两种原因分开说 —— 编号找不到，和"编号有、但本包没这一档"，要查的地方完全不同。 -->
        <view v-if="packMarksLeft.length" class="left-bar">
          <text class="left-title">⚠️ 本包有 {{ packMarksLeft.length }} 条登记在卡表里对不上（所以不会标红）</text>
          <text class="left-codes">{{ packMarksLeft.map(m => markLabel(m) + (m.why === 'rarity' ? '（本包没有这个罕贵度）' : '（编号不在卡表里）')).join('、') }}</text>
        </view>

        <!-- 桌面表格 -->
        <view class="card-table-wrap">
          <table class="card-table">
            <!-- V1.2.39 起**一行 = 一个 (编号, 罕贵度, 后缀序号)**，不再是「一个编号一行、
                 罕贵度用「、」串起来」。所以表里会看到同一个编号重复出现几行 —— 那不是重复，
                 是同一张卡的几个罕贵度。「后缀」就是图源文件名的最后一段
                 （`{编号}-{罕贵}.jpg` 是 0，`{编号}-{罕贵}-{N}.jpg` 是 N）。
                 「异画标签」是人工填的：原画 / 异画 / 初版 / 别的叫法，空着就是没标。 -->
            <thead><tr>
              <th>编号</th><th>卡密</th><th>日文名</th><th>中文名</th><th>英文名</th><th>罕贵度</th><th>后缀</th><th>异画标签</th>
            </tr></thead>
            <tbody>
              <!-- 点行打开「卡牌详情」弹窗：手机端瓦片本来就能点（openEditCard），桌面端表格却没有入口，
                   结果「卡牌地址 / 一键跳目录」在电脑上根本够不着 —— 而这功能恰恰只在电脑上有意义。
                   表格本身是**只读**的：所有改动都在弹窗里做，点「确认更改」立刻落库。 -->
              <tr v-for="c in cards" :key="c._rowKey" :class="{ 'tr-marked': markKind(c.code, c.rarity) }"
                  @tap="openEditCard(c)">
                <td>
                  <!-- 编号是只读文字：改编号不只是改这一格，它同时出现在图源文件名 /
                       目录 / 包 JSON / 库存卡 四个地方，必须走编辑弹窗的改编号流程
                       （那是先盘点再二次确认的，不能从表格里直接改）。 -->
                  <text class="td-code">{{ c.code }}</text>
                  <!-- norm = 编号位数和目录对不上（登记 DL1-001 / 目录 DL1-01），
                       是靠去前导零才对上的。这事本身就值得让用户看见，好去订正。
                       罕贵度是这一行自己的那一档：标了 N 就只有 N 这行带点。 -->
                  <text v-if="markKind(c.code, c.rarity)" class="mk-dot"
                        :class="'mk-' + markKind(c.code, c.rarity)"></text>
                </td>
                <td><text class="td-code">{{ c.ext_code || '-' }}</text></td>
                <td>
                  <!-- 卡名是**只读**的：它是「卡」的属性，不是「这一行」的。
                       改名字请去卡牌唯一目录（那里一改，用这个卡密的所有行一起变）。 -->
                  <rich-text :nodes="toRubyHtml(c.jp_name)"></rich-text>
                </td>
                <td>
                  <view class="td-flex">
                    <text class="ai-badge" v-if="c.cn_source === 'ai'">🤖</text>
                    <text class="cn-text">{{ c.cn_name }}</text>
                  </view>
                </td>
                <td><text class="td-en">{{ c.en_name }}</text></td>
                <td><text class="td-rarity">{{ c.rarity }}</text></td>
                <td>
                  <!-- 后缀序号：0 = 原画，1/2/3 = 图源里那张 `-1/-2/-3` 的异画 -->
                  <text class="td-rarity">{{ c.alt_art_index || 0 }}</text>
                </td>
                <td><text class="td-rarity">{{ c.alt_label || '—' }}</text></td>
              </tr>
            </tbody>
          </table>
        </view>

        <!-- 手机卡片网格瓦片（按罕贵展开，OCG 详细图优先） -->
        <view class="tile-grid">
          <view class="card-tile" v-for="(t,i) in tiles" :key="t.card.code + '-' + (t.rarity||'') + i"
                :class="['img-' + tileStatus(t), (t.card.rarity ? 'rar-full' : 'rar-missing'), t.mark ? 'tile-marked' : '']"
                @tap="openEditCard(t.card)">
            <view class="ct-thumb">
              <image v-if="t.srcs[t.idx]" :src="t.srcs[t.idx]" mode="aspectFit"
                     class="ct-img" @error="onTileError(t)" />
              <text v-else class="no-img">无图</text>
            </view>
            <text class="ct-name">{{ t.card.cn_name || t.card.jp_name }}</text>
            <view class="ct-coderow">
              <text class="ct-code">{{ t.card.code }}</text>
              <text v-if="t.rarity" class="ct-rarity">{{ t.rarity }}</text>
            </view>
          </view>
          <view v-if="tiles.length === 0" class="empty-state">暂无卡牌数据</view>
        </view>
      </view>

    </scroll-view>

    <!-- ====== 编辑弹窗（手机） ====== -->
    <!-- ====== 点一行/一个瓦片打开的「卡牌详情」 ======
         左上是小图，右边是这一行的全部数据，底下一条图源地址 + 按钮，一屏放得下、不用滚。
         以前是九个「标签 + 输入框」竖着摞，高度直奔 700px，手机上要滚两屏才够得着「确认」。 -->
    <view v-if="editVisible" class="edit-overlay" @tap="editVisible=false">
      <view class="edit-card edit-card-wide" @tap.stop>
        <view class="ef-head">
          <text class="edit-title">{{ editRowKey ? '卡牌详情' : '新增一张卡' }}</text>
          <text class="ef-head-code">{{ editForm.code || '（新行）' }}</text>
          <text class="ef-close" @tap="editVisible=false">✕</text>
        </view>

        <view class="ef-body">
          <!-- 上面一条：左卡图、右边紧挨着「这张卡是什么」。
               卡名和登记以前摞在输入框下面，右栏就被顶得比图高一倍，图底下空一大块；
               挪到图右边之后最高的一条就是这张图，整体矮下来。 -->
          <view class="ef-top">
            <!-- 卡图。改了编号/罕贵/后缀它立刻跟着换，对不上就显示原因。
                 点一下全屏放大（缩略图一格才一百多像素宽，卡面细节得凑到脸前才看得清）。
                 不加任何角标 —— 用户明确不要「🔍 放大」那个提示，直接点图就行。 -->
            <view class="ef-left">
              <view class="ef-preview" :class="{ 'ef-preview-zoom': editFormPreview && !efPreviewErr }"
                    @tap="previewCardImage">
                <image v-if="editFormPreview && !efPreviewErr" :src="editFormPreview" mode="aspectFit"
                       class="ef-preview-img" @error="efPreviewErr = true" />
                <text v-else class="ef-preview-none">{{ efPreviewText }}</text>
              </view>
            </view>

            <!-- 紧挨着图的右边：三个卡名 + 登记状态。全是只读，改名字去「卡牌唯一目录」 -->
            <view class="ef-names">
              <view class="ef-ro-line"><text class="ef-ro-k">日文名</text><text class="ef-ro-v">{{ editForm.jp_name || '—' }}</text></view>
              <view class="ef-ro-line"><text class="ef-ro-k">中文名</text><text class="ef-ro-v">{{ editForm.cn_name || '—' }}</text></view>
              <view class="ef-ro-line"><text class="ef-ro-k">英文名</text><text class="ef-ro-v">{{ editForm.en_name || '—' }}</text></view>
              <view class="ef-ro-line"><text class="ef-ro-k">登记</text><text class="ef-ro-v" :class="{ 'ef-ro-warn': !markKind(editForm.code, editForm.rarity) }">{{ efMarkText }}</text></view>
              <text class="ef-hint">卡名只读 —— 要改请去「卡牌唯一目录」，改一次所有用到这张卡的行一起变</text>
            </view>
          </view>

          <!-- 文件名条：这串就是图源里那张图**该叫**的名字。用户要拿它去给图片改名，
               所以字比别处大、后面紧跟着一键复制。不画底框，缺图时这串字自己变红。
               「打开卡包」不在这儿 —— 它落在下面「图源」那一行，跟「预览」做一对。 -->
          <view class="ef-fbar">
            <text class="ef-fname" :class="{ 'ef-fname-miss': !editFormPreview || efPreviewErr }">{{ efPreviewName || '—' }}</text>
            <view class="ef-fbtn" @tap="copyCardNo(efPreviewName)"><text class="ef-fbtn-t">复制名称</text></view>
          </view>

          <!-- 下面才是这一行能改的东西，两行排开 -->
          <view class="ef-form">
            <view class="ef-frow">
              <view class="ef-fld">
                <text class="ef-label">卡牌编号</text>
                <input class="ef-input ef-code" v-model="editForm.code" placeholder="如 QCAC-JP001" />
              </view>
              <view class="ef-fld">
                <text class="ef-label">卡密</text>
                <input class="ef-input" v-model="editForm.ext_code" placeholder="卡密" />
              </view>
            </view>
            <view class="ef-frow">
              <view class="ef-fld">
                <text class="ef-label">罕贵度</text>
                <input class="ef-input" v-model="editForm.rarity" />
              </view>
              <view class="ef-fld ef-fld-narrow">
                <text class="ef-label">后缀序号</text>
                <input class="ef-input ef-code" v-model="editForm.alt_index" placeholder="0" />
              </view>
              <view class="ef-fld">
                <text class="ef-label">异画标签</text>
                <input class="ef-input" v-model="editForm.alt_label" placeholder="原画 / 异画 / 初版…（可留空）" />
              </view>
            </view>
          </view>
          <text class="ef-hint ef-hint-form">点「确认更改」<text class="ef-hint-strong">立刻存进数据库</text>，不用再去顶栏点保存。改编号会重命名图源文件、改目录与包 JSON、并清掉这个编号的登记记录，那一步会先给你看影响面。</text>
        </view>

        <!-- 图源地址：由「图源总文件夹 + 包名」现拼，不硬编码 —— 用户在「图源设置」里换了总文件夹，这里跟着变 -->
        <view class="ef-foot-dir">
          <text class="ef-foot-k">图源</text>
          <text class="ef-dir">{{ packDir || '读取中…' }}{{ packDir && !packDirExists ? '（图源里还没有这个目录）' : '' }}</text>
          <view class="ef-dbtn" @tap="openPackDir(editForm.code)"><text class="ef-dbtn-t">👁 预览</text></view>
          <view class="ef-dbtn" @tap="openPackDirOnPC(efOpenTarget)"><text class="ef-dbtn-t">📁 打开</text></view>
        </view>

        <view class="edit-btns">
          <!-- 删掉这张卡：以前是表格里每行的 🗑（只在「修改模式」下才有，而那张表在手机上
               根本是 display:none）。现在搬进弹窗，点了就先二次确认，再走同一条 PUT。
               新增态下没有这张卡可删，所以不显示。 -->
          <view v-if="editRowKey" class="eb-del" @tap="startDeleteCard"><text class="eb-del-t">🗑 删掉这张卡</text></view>
          <view class="eb-cancel" @tap="editVisible=false"><text>取消</text></view>
          <view class="eb-save" :disabled="saveBusy" @tap="applyEditCard"><text class="eb-text-w">{{ saveBusy ? '保存中…' : '确认更改' }}</text></view>
        </view>
      </view>
    </view>

    <!-- ====== 改编号二次确认（先把影响面摊开） ====== -->
    <view v-if="renameVisible && renamePlan" class="edit-overlay" @tap="renameVisible=false">
      <view class="rn-card" @tap.stop>
        <text class="rn-title">把 {{ renamePlan.oldCode }} 改成 {{ renamePlan.newCode }}？</text>
        <view class="rn-lines">
          <text class="rn-line" v-for="(l, i) in renameLines" :key="i">{{ l }}</text>
        </view>
        <view class="edit-btns">
          <view class="eb-cancel" @tap="renameVisible=false"><text>取消</text></view>
          <view class="eb-save" :disabled="renameBusy" @tap="doRenameCode"><text class="eb-text-w">{{ renameBusy ? '处理中…' : '确认更改编号' }}</text></view>
        </view>
      </view>
    </view>

    <!-- ====== 删卡包二次确认（先把影响面摊开） ====== -->
    <view v-if="delVisible && delPlan" class="edit-overlay" @tap="delVisible=false">
      <view class="del-card" @tap.stop>
        <text class="rn-title">删掉卡包 {{ delPlan.code }}？</text>
        <view class="rn-lines">
          <text class="rn-line" v-for="(l, i) in deleteLines" :key="i">{{ l }}</text>
        </view>
        <!-- 有实物卡时用户定的是「直接禁止」，所以这里是一段红字说明，**不给确认按钮** -->
        <view v-if="delPlan.禁止原因" class="del-block">
          <text class="del-block-t">{{ delPlan.禁止原因 }}</text>
        </view>
        <view class="edit-btns">
          <view class="eb-cancel" @tap="delVisible=false"><text>{{ delPlan.禁止原因 ? '知道了' : '取消' }}</text></view>
          <view v-if="!delPlan.禁止原因" class="eb-save" :disabled="delBusy" @tap="doDeletePack">
            <text class="eb-text-w">{{ delBusy ? '处理中…' : '确认删除' }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- ====== 弹窗选择器 ====== -->
    <view v-if="pickerVisible" class="picker-mask" @tap="pickerVisible=false" />
    <view v-if="pickerVisible" class="picker-popup">
      <view class="picker-row" :class="{active:pickerVal===item.v}" v-for="item in pickerItems" :key="item.v" @tap="onPickerSelect(item)">
        <text>{{ item.label }}</text>
      </view>
    </view>

    <!-- ====== 图源目录浏览（一级/二级/编辑弹窗都能开） ====== -->
    <PackFilesDialog :visible="pfVisible" :pack-code="pfCode" :highlight="pfHighlight"
                     @close="pfVisible = false" @changed="onPackFilesChanged" />

    <!-- ====== 归不到卡包的登记记录清单 ====== -->
    <view v-if="orphanVisible" class="edit-overlay" @tap="orphanVisible=false">
      <view class="orphan-card" @tap.stop>
        <text class="orphan-title">不属于任何卡包的登记记录</text>
        <text class="orphan-sub">共 {{ orphanMarks.length }} 条。这些编号在图源里可能有图片目录，但没有进卡牌编号目录（一级列表读的是 _index.json），所以挂不到任何一个卡包上。「(不限)」= 不限罕贵度。</text>
        <scroll-view class="orphan-list" scroll-y="true">
          <text class="orphan-item" v-for="m in orphanMarks" :key="m.code + '|' + m.rarity">{{ markLabel(m) }}</text>
        </scroll-view>
        <view class="edit-btns">
          <view class="eb-save" @tap="orphanVisible=false"><text class="eb-text-w">知道了</text></view>
        </view>
      </view>
    </view>

    <!-- ====== 新建卡包 ====== -->
    <view v-if="newVisible" class="edit-overlay" @tap="newVisible=false">
      <view class="rn-card" @tap.stop>
        <text class="rn-title">新建卡包</text>
        <text class="new-sub">会做两件事：在图源里建一个以包简写命名的文件夹，并在 _index.json 里登记这个包 —— 不然一级列表里根本看不到它。</text>
        <view class="edit-fields">
          <text class="ef-label">包简写（必填）</text>
          <input class="ef-input ef-code" v-model="newForm.code" placeholder="如 QCAC" />
          <text v-if="newCodeBad" class="ef-note ef-note-bad">只能用字母、数字、括号、加号、连字符，1~20 位</text>
          <text v-else-if="newCodeDup" class="ef-note ef-note-bad">「{{ newCodeUpper }}」已经存在了 —— 图源里有这个目录，或者卡牌编号目录里已经登记过</text>
          <text v-else class="ef-note">图片文件名要用这个前缀（如 QCAC-JP001-SER.jpg），所以别带空格</text>
          <text class="ef-label">中文名（必填）</text>
          <input class="ef-input" v-model="newForm.fullName" placeholder="如 青眼白龙 25 周年纪念包" />
          <text class="ef-label">英文名</text>
          <input class="ef-input" v-model="newForm.enName" placeholder="可留空" />
          <text class="ef-label">日期</text>
          <input class="ef-input" v-model="newForm.date" placeholder="YYYY-MM-DD" />
        </view>
        <view class="edit-btns">
          <view class="eb-cancel" @tap="newVisible=false"><text>取消</text></view>
          <view class="eb-save" :disabled="newBusy" @tap="submitNewPack"><text class="eb-text-w">{{ newBusy ? '建立中…' : '建立卡包' }}</text></view>
        </view>
      </view>
    </view>

    <!-- ====== 图源里有、目录里没有的包清单 ====== -->
    <view v-if="uncatVisible" class="edit-overlay" @tap="uncatVisible=false">
      <view class="orphan-card" @tap.stop>
        <text class="orphan-title">图源里有、卡牌编号目录里没有</text>
        <text class="orphan-sub" v-if="uncatBusy">读取中…</text>
        <view v-else class="uncat-body">
          <!-- 两种「对不上」要分开说：只有上面那类是真的要处理的（点进去是空的） -->
          <text class="uncat-head" v-if="uncatMissingList.length">⚠️ 目录里有、图源里却没有文件夹：{{ uncatMissingList.length }} 个 —— 这些点进去是空包，先到「图源设置」确认图源路径对不对</text>
          <scroll-view class="orphan-list" scroll-y="true" v-if="uncatMissingList.length">
            <text class="uncat-miss" v-for="c in uncatMissingList" :key="'m' + c">{{ c }}</text>
          </scroll-view>
          <text class="uncat-head">图源里有文件夹、但没有登记进目录：{{ uncatList.length }} 个（一级列表里看不到它们）</text>
          <scroll-view class="orphan-list" scroll-y="true">
            <view class="uncat-item" v-for="u in uncatList" :key="u.code" @tap="openUncatDir(u.code)">
              <text class="uncat-code">{{ u.code }}</text>
              <text class="uncat-n">{{ u.fileCount }} 张图</text>
              <text class="uncat-arrow2">▸</text>
            </view>
            <text class="orphan-sub" v-if="!uncatList.length">没有</text>
          </scroll-view>
        </view>
        <view class="edit-btns">
          <view class="eb-save" @tap="uncatVisible=false"><text class="eb-text-w">知道了</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, reactive, onMounted, watch } from 'vue'
import { toRubyHtml } from '@/utils/ruby.js'
import { goBack as navBack } from '@/utils/nav.js'
import { buildCardImgUrl, 卡密可留空, 卡密说明 } from '@/api/cardDb.js'
import PackFilesDialog from '@/components/PackFilesDialog.vue'

// ==================== State ====================
// 选择图源：0=详细图源（按卡包分类） 1=保底图源（卡牌单个展开，按卡密搜索）
const srcOptions = ['详细图源', '保底图源']
const srcIdx = ref(0)
const inDetail = ref(false)
const packSearch = ref('')
const catFilter = ref('')
const statusFilter = ref('')
const catLabel = ref('全部分类')
const statusLabel = ref('全部状态')

const packs = ref([])
const packCode = ref('')
const packData = ref({})
const cards = ref([])
const tiles = ref([]) // 按罕贵展开的网格瓦片（每瓦片 = 卡 + 单个罕贵）

const editVisible = ref(false)
const editForm = reactive({ code:'', ext_code:'', jp_name:'', cn_name:'', en_name:'', rarity:'', alt_index:'0', alt_label:'' })
const editRowKey = ref('')   // 编辑弹窗当前改的是哪一行。空串 = 「新增一张卡」
const saveBusy = ref(false)  // 单行保存进行中（防连点）
// 改了编号时，其余 4 个字段要等 rename 那条二次确认走完再一起存，
// 中间隔着两个弹窗，所以拿这个变量把它们带过去。
const 待存字段 = ref(null)

const pickerVisible = ref(false)
const pickerVal = ref('')
const pickerMode = ref('')
const pickerItems = ref([])

const STATUSES = [
  { v:'', label:'全部状态' }, { v:'done', label:'✅ 齐全' },
  { v:'data_only', label:'🟠 缺图' }, { v:'rarity_missing', label:'🟡 缺罕贵' }, { v:'failed', label:'❌ 失败' }
]
const CATEGORIES = [
  { v:'', label:'全部分类' }, { v:'booster', label:'补充包' },
  { v:'structure', label:'预组' }, { v:'special', label:'特殊包' }, { v:'promo', label:'活动/限定' }
]

// ==================== Computed ====================
const filteredPacks = computed(() => {
  let list = packs.value
  const q = packSearch.value.toLowerCase()
  if (q) list = list.filter(p => p.code.toLowerCase().includes(q) || (p.full_name||'').toLowerCase().includes(q))
  if (catFilter.value) list = list.filter(p => p.category === catFilter.value)
  if (statusFilter.value) list = list.filter(p => p.status === statusFilter.value)
  return list
})

// ==================== Config ====================
const API = '/api/tcg'

// ==================== Methods ====================
const goBack = () => {
  if (inDetail.value) { inDetail.value = false; packSearch.value = ''; return }
  // 从图源设置进入 → 返回图源设置；直接访问/刷新过 → 回图源设置兜底
  navBack('/pages/admin/tcg-paths')
}
const onSrcChange = (e) => {
  srcIdx.value = Number(e.detail.value)
  inDetail.value = false
  if (srcIdx.value === 1) loadYgoPro(1)
}
const onSearch = () => {
  uni.showModal({ title:'搜索卡包', editable:true, placeholderText:'输入关键词',
    success:(res) => { if(res.confirm&&res.content){ packSearch.value = res.content } }
  })
}

const showCatPicker = () => { pickerItems.value = CATEGORIES; pickerVal.value = catFilter.value; pickerMode.value = 'cat'; pickerVisible.value = true }
const showStatusPicker = () => { pickerItems.value = STATUSES; pickerVal.value = statusFilter.value; pickerMode.value = 'status'; pickerVisible.value = true }
const onPickerSelect = (item) => {
  if (pickerMode.value === 'cat') { catFilter.value = item.v; catLabel.value = item.label }
  else { statusFilter.value = item.v; statusLabel.value = item.label }
  pickerVisible.value = false
}

const statusText = (st) => {
  if (st==='done') return '✅ 齐全'; if (st==='data_only') return '🟠 缺图'
  if (st==='rarity_missing') return '🟡 缺罕贵'; if (st==='failed') return '❌ 失败'
  return '⏳ 待处理'
}
// ==================== 网格瓦片（按罕贵展开，OCG 详细图优先） ====================
const RARITY_ORDER = ['QCSER','PSER','HR','SER','UR','SR','R','N','NR','PR','UTR','GR','20SER','10000SER','CR','ESR','GSER','MR']
const rarBase = (r) => String(r || '').replace(/\(\d+\)/g, '').trim()
const codeSortKey = (c) => {
  const m = String(c.code || '').match(/^(.*?)(\d+)$/)
  return m ? [m[1], parseInt(m[2], 10)] : [String(c.code || ''), 1e9]
}

// ==================== 本页图片地址的版本号 ====================
// 图源成功返回时带的是 `Cache-Control: public, max-age=604800`（7 天）。文件名改了、
// 但页面里的 <image src> 一字没变 → 浏览器根本不会再去问服务端，直接把旧图给你，
// 于是「图源明明改了，页面上还是那张」。
// 本页是**人工订正图源的现场**，必须看到实况，所以在 URL 尾巴上挂一个 v= 时间戳：
// 换一次值就等于换了一批地址，浏览器只能重新取。**只影响本页** ——
// 上传页/库存页等走的是共享的 buildCardImgUrl，7 天缓存照旧。
const imgVer = ref(Date.now())
const bumpImgVer = () => { imgVer.value = Date.now() }
const catalogImgUrl = (o) => {
  const u = buildCardImgUrl(o)
  return u ? u + '&v=' + imgVer.value : u
}

// 从 cards 构建瓦片：**一行一个瓦片**。
// V1.2.39 拆行之后，同一张卡的每个罕贵度本来就是独立的一行，以前那个
// `String(c.rarity).split('、')` 展开已经没有东西可展了（而且会把 `SER(1)` 这种
// 带后缀的旧写法拆成一条地址拼不对的假瓦片）。后缀序号直接喂给 buildCardImgUrl。
const buildTiles = () => {
  const entries = cards.value.map(c => ({
    card: c,
    rarity: String(c.rarity || '').trim(),
    altIndex: parseInt(c.alt_art_index) || 0,
  }))
  entries.sort((a, b) => {
    const ka = codeSortKey(a.card), kb = codeSortKey(b.card)
    if (ka[0] !== kb[0]) return ka[0] < kb[0] ? -1 : 1
    if (ka[1] !== kb[1]) return ka[1] - kb[1]
    const ra = RARITY_ORDER.indexOf(rarBase(a.rarity)), rb = RARITY_ORDER.indexOf(rarBase(b.rarity))
    return ((ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb))
        || String(a.rarity).localeCompare(String(b.rarity))
        || (a.altIndex - b.altIndex)
  })
  tiles.value = entries.map(e => {
    const { card, rarity, altIndex } = e
    const ext = String(card.ext_code || '').trim()
    const srcs = []
    // **只认「图源里对得上的那张」**，只有一级候选：
    //   · 有罕贵 → 精准层：服务端要求文件名整段命中 `{编号}-{罕贵}[-{异画}]`，对不上直接 404
    //   · 没罕贵 → 按编号在这个包的图源里找（服务端是前缀匹配）
    // 后缀序号 > 0 时服务端会去找 `{编号}-{罕贵}-{N}.jpg` —— 这正是「红边没图但图其实在」那个
    // 老问题的解药：以前库里写的是 `SER(1)`、地址里带的是 `rarity=SER(1)`，永远 404。
    // `if (u)` 而不是 `if (card.code)`：卡密为空时 buildCardImgUrl 返回空串，
    // 空串塞进 srcs 会让瓦片判成「有图」而顶着绿边显示「无图」两个字。
    const u = card.code ? catalogImgUrl({ password: ext, code: card.code, rarity, altIndex }) : ''
    if (u) srcs.push(u)
    return { card, rarity, altIndex, srcs, idx: 0, mark: markKind(card.code, rarity) }
  })
}

// ==================== 编辑弹窗里的卡图预览 ====================
// 「重新输入编号 + 罕贵度 + 后缀，它自己会找到那张图」—— 这里就是那个「自己找」。
// 地址和保存后表格/瓦片里那张是同一个（都走 buildCardImgUrl 的精准模式），
// 所以预览看不到的，保存后也一定看不到。
const efPreviewErr = ref(false)
const editFormPreview = computed(() => {
  const code = String(editForm.code || '').trim().toUpperCase()
  const ext = String(editForm.ext_code || '').trim()
  if (!code || !ext) return ''
  return catalogImgUrl({
    password: ext, code,
    rarity: String(editForm.rarity || '').trim(),
    altIndex: parseInt(editForm.alt_index) || 0,
  })
})
// 弹窗左边那张图「应当」叫什么文件名。图片加载成功它就是那张图的名字，
// 加载失败它就是「图源里没有 XXX.jpg」里那个 XXX —— 两处必须是同一个串，
// 各拼一份迟早会漂。
const efPreviewName = computed(() => {
  const code = String(editForm.code || '').trim().toUpperCase()
  if (!code) return ''
  const r = String(editForm.rarity || '').trim()
  if (!r) return `${code}-（缺罕贵度）.jpg`
  const n = parseInt(editForm.alt_index) || 0
  return `${code}-${r}${n > 0 ? '-' + n : ''}.jpg`
})
const efPreviewText = computed(() => {
  const code = String(editForm.code || '').trim().toUpperCase()
  const ext = String(editForm.ext_code || '').trim()
  if (!code) return '先填编号'
  if (!ext) return '先填卡密（卡图按卡密找）'
  return `图源里没有 ${efPreviewName.value}`
})

// ==================== 点一下全屏放大 ====================
// 预览框只有 132×184（手机 104×145），卡面上的小字、版本标、防伪标根本看不清。
// 点一下走 uni.previewImage —— uni 自带的全屏看图，能缩放，跟 card-unique.vue 里
// 那个「点缩略图看大图」是同一个写法，不用自己写一套遮罩。
// **这里要用全尺寸那张**（thumb:false → /card-image）：预览框里显示的是缩略图
// （/card-thumbnail，长边 200px），拿它去全屏就是糊的 —— 放大的意义本就是看清细节。
const editFormFullImage = computed(() => {
  const code = String(editForm.code || '').trim().toUpperCase()
  const ext = String(editForm.ext_code || '').trim()
  if (!code || !ext) return ''
  return catalogImgUrl({
    password: ext, code,
    rarity: String(editForm.rarity || '').trim(),
    altIndex: parseInt(editForm.alt_index) || 0,
    thumb: false,
  })
})
const previewCardImage = () => {
  // 图没找到时不放行：这会儿框里显示的是「图源里没有 XXX.jpg」的原因文字，
  // 点开会是一片空白，反而让人以为图挂了。
  if (!editFormPreview.value || efPreviewErr.value) return
  uni.previewImage({ urls: [editFormFullImage.value], current: 0 })
}
// 这个 (编号, 罕贵度) 在本包的「信息登记」里是什么状态（就是表格里那个小圆点）。
// 跟着 editForm.rarity 走 —— 编辑框里改了罕贵度，这行提示要跟着变。
const efMarkText = computed(() => {
  const k = markKind(editForm.code, editForm.rarity)
  if (k === 'exact') return '已登记'
  if (k === 'norm') return '已登记（编号写法不同）'
  return '未登记'
})
// 改了任意一项就把「上一条地址 404 了」这个状态清掉，重新试着加载
watch(() => [editForm.code, editForm.ext_code, editForm.rarity, editForm.alt_index],
  () => { efPreviewErr.value = false })

// ---------- 卡密 / 编号 → 上面那三个卡名，边打字边换 ----------
// 卡密是**取名字的钥匙**（服务端 services/cardNames.js 顶上那段）：敲什么就去唯一目录里
// 按它取一次名字，敲个查不到的，三格就该显示「—」而不是把旧编号的名字顶上来
// —— 所以服务端那边走的是 `按输入取`（严格版），不是带编号回退的 `查一条`。
//
// 编号也一起 watch：**卡密为空时编号才是钥匙**。卡密非空时服务端会忽略编号，
// 正好就是用户说的「跟编号没关系」。
//
// `已查钥匙` 记下上一次查过的那把钥匙，用来跳过「刚打开弹窗、几个字段被整体赋初值」那一次：
// 那不是用户输入，而且行上的名字本来就是服务端按同一把钥匙回填的，白跑一趟。
// 用「钥匙」而不是一个布尔标志 —— 赋初值时若各字段值没变，watch 根本不会触发，
// 标志会一直留在那儿，把下一次**真实**输入吞掉（同一个弹窗开两次就会踩到）。
let 名防抖 = null
let 名序号 = 0
let 已查钥匙 = null
const 当前钥匙 = () => {
  const 密 = String(editForm.ext_code || '').trim()
  if (密) return '密:' + 密
  const 号 = String(editForm.code || '').trim().toUpperCase()
  return 号 ? '号:' + 号 : ''
}
const 取卡名 = async () => {
  const 发起键 = 当前钥匙()
  const my = ++名序号
  const 密 = String(editForm.ext_code || '').trim()
  const 号 = String(editForm.code || '').trim().toUpperCase()
  if (!发起键) {  // 编号和卡密都空着（新增态刚开始）：不用问服务端，就是没名字
    editForm.jp_name = ''; editForm.cn_name = ''; editForm.en_name = ''
    已查钥匙 = ''
    return
  }
  try {
    const d = await api('/card-names?ext_code=' + encodeURIComponent(密) + '&code=' + encodeURIComponent(号))
    // 两道闸：① 期间又发了新请求；② 期间钥匙又变了、但新请求还没发出来（正好落在这 300ms 窗口里）
    if (my !== 名序号 || 发起键 !== 当前钥匙()) return
    editForm.jp_name = (d && d.jp_name) || ''
    editForm.cn_name = (d && d.cn_name) || ''
    editForm.en_name = (d && d.en_name) || ''
    已查钥匙 = 发起键     // 只在**拿到结果**后才认账；失败不认，下次钥匙变了还会重查
  } catch (_) { /* 查不动就维持原样：宁可显示上一组，也别把用户眼前的名字清空 */ }
}
watch(() => [editForm.code, editForm.ext_code], () => {
  if (名防抖) clearTimeout(名防抖)
  名防抖 = setTimeout(() => {
    if (当前钥匙() === 已查钥匙) return    // 钥匙没换，名字也不会换
    取卡名()
  }, 300)
})

// 瓦片图片状态（顶边色）：绿 = 拿到了图源里对得上的那张，红 = 无图。
// 以前中间还有一档「橙 = 走的兜底图源（按卡密找到的保底图）」，目录页现在只留一级
// 候选，那一档不再产出 —— 编号或罕贵写错时不会再蒙混一张图过去，而是直接变红。
// （`.img-orange` 的样式留着，没删。）
const tileStatus = (t) => (t.srcs[t.idx] ? 'green' : 'red')
// 图片加载失败 → 沿候选链降级
const onTileError = (t) => { if (t.idx < t.srcs.length) t.idx++ }

// ==================== 「信息登记」叠加标红 ====================
// 数据源是 cardmarks（见 /v1/api/card-marks）。粒度是 **(编号, 罕贵度)**：
//   标了 N 就只有 N 变红，标了 NPR 就只有 NPR 变红 —— 好「精准查到错误点」。
//   rarity === '' 是**通配**（不限罕贵度）：92 条老记录和自动登记都是它，罩住该编号所有档。
// 匹配要过两关，缺一不可：
//   ① 编号 —— 登记的编号和目录里的编号**位数经常不一致**（登记写 DL1-001，目录写 DL1-01）。
//      只按精确相等判，绝大多数条目根本对不上 = 这功能永远不红，等于没用；
//      把编号里的数字段归一化（DL1-001 → DL1-1，两边都归）后能对上大部分。
//   ② 罕贵度 —— 通配直接过；否则两边 trim + 大写后要求一字不差。
// 两关都过不了的记录归到「对不上」清单里明着列出来，并注明是哪一关挂的（why）——
// 编号找不到和"这个包里没这一档"是两个不同的错误，混着说用户没法查。
const markedCodes = ref([])        // 全部登记记录：[{code, rarity, source}]（都大写）
const markIndex = ref({})          // 当前卡表：'CODE|RARITY'（卡自己的那对） → 'exact' | 'norm'
const packMarkCounts = ref({})     // 一级：包 code → 该包登记条数（一档一条，所以是"要修几处"）
const packMarksLeft = ref([])      // 当前包：登记了但卡表里对不上的 [{code, rarity, why}]
const orphanMarks = ref([])        // 归不到任何卡包的登记记录
const orphanVisible = ref(false)
// 登记记录的显示名：DL1-045·N / DL1-045·(不限)。清单里一条一条列出来时用。
const markLabel = (m) => `${m.code}·${m.rarity || '(不限)'}`
// 编号和罕贵度在这里的归一化都只做「去空格 + 转大写」，跟后端 norm() 一致。
// 罕贵度**不要**接 rarBase（那个是显示用的去 `(N)` 后缀，见上面）—— 实测全库没有一行带后缀，
// 接进来只会把不同印刷混成一档。
const markNorm = (v) => String(v || '').trim().toUpperCase()

// ==================== 图源目录浏览（批次 3） ====================
const pfVisible = ref(false)

const pfCode = ref('')
const pfHighlight = ref('')        // 要高亮的卡牌编号；传空 = 只浏览整个包
const packDir = ref('')            // 当前包的图源绝对路径（每次开包现取，跟着图源设置走）
const packDirExists = ref(true)

const openPackDir = (highlight) => {
  pfCode.value = packCode.value
  pfHighlight.value = highlight || ''
  pfVisible.value = true
}

// 图源目录弹窗里改了名 / 删了图之后（组件回抛 changed）：本页瓦片要立刻跟着变。
// 不刷新的话，改名前那张图还在页面上挂着（浏览器缓存里就是旧地址的旧图）。
// 只在真有动作时刷新 —— 光是打开看看目录不会让整页图重下一遍。
const onPackFilesChanged = () => { bumpImgVer(); buildTiles() }

// ==================== 新建卡包 / 传图 / 导表（批次 6） ====================
const newVisible = ref(false)
const newBusy = ref(false)
const newForm = reactive({ code: '', fullName: '', enName: '', date: '' })

// 包简写正则与服务端 PACK_CODE_RE 一字不差。前端这份**不是为了替服务端把关**
// （服务端照样会再验一遍），是为了让用户在打字时就看到提示，而不是提交后被 400 打回来。
const PACK_RE = /^[A-Za-z0-9()+-]{1,20}$/
const newCodeUpper = computed(() => String(newForm.code || '').trim().toUpperCase())
const newCodeBad = computed(() => !!newCodeUpper.value && !PACK_RE.test(newCodeUpper.value))
// 查重的两边都要看：一级列表只认 _index.json，光比 packs 会漏掉「图源里有目录、
// 索引里没登记」的那些包（正是底部那条提示里的），而新建接口查的恰恰是目录。
const knownDirs = ref(new Set())
const newCodeDup = computed(() => !!newCodeUpper.value
  && (packs.value.some(p => String(p.code).toUpperCase() === newCodeUpper.value)
      || knownDirs.value.has(newCodeUpper.value)))

const upBusy = ref(false)
const upText = ref('')
const dragOver = ref(false)
const packFileCount = ref(null)   // 本包目录里的图片数；null = 还没问到

// 本地日期。**不用 toISOString().slice(0,10)**：那是 UTC，中国的凌晨会算成前一天，
// 用户建包时会看到一个「昨天」的日期。
const today = () => {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const openNewPack = async () => {
  newForm.code = ''; newForm.fullName = ''; newForm.enName = ''; newForm.date = today()
  newVisible.value = true
  // 顺便把「图源里已有的包目录」捞回来查重用。便宜档（不带文件数），别为一次查重扫全盘
  try {
    const d = await api('/uncataloged-packs')
    if (d && d.ok) knownDirs.value = new Set((d.uncataloged || []).map(x => String(x.code).toUpperCase()))
  } catch (e) { /* 拿不到就只按索引查重，不阻断新建 */ }
}

const submitNewPack = async () => {
  if (newBusy.value) return
  if (!newCodeUpper.value) return uni.showToast({ title: '请填写包简写', icon: 'none' })
  if (newCodeBad.value) return uni.showToast({ title: '包简写的格式不对', icon: 'none' })
  if (!String(newForm.fullName || '').trim()) return uni.showToast({ title: '请填写中文名', icon: 'none' })
  newBusy.value = true
  try {
    const d = await api('/packs', {
      method: 'POST',
      data: { code: newCodeUpper.value, fullName: String(newForm.fullName).trim(), enName: String(newForm.enName || '').trim(), date: newForm.date },
    })
    if (d && d.ok) {
      newVisible.value = false
      await fetchPacks()
      loadUncat()      // 这个包刚进索引，底部那条「未收录」计数要减一
      uni.showToast({ title: '✅ 已建 ' + d.code, icon: 'none' })
      const p = packs.value.find(x => String(x.code).toUpperCase() === String(d.code).toUpperCase())
      if (p) openPack(p)   // 直接进空包，那里就是「传图 → 导表」的入口
    } else {
      uni.showToast({ title: '❌ ' + ((d && d.error) || '建立失败'), icon: 'none' })
    }
  } catch (e) { uni.showToast({ title: '请求失败', icon: 'none' }) }
  newBusy.value = false
}

/**
 * 选图片。用 document.createElement 而不是模板里的 `<input type=file>`：
 * uni-app 的 H5 编译器会把模板里的 `<input>` 渲染成 `<uni-input>`（一个包装组件），
 * 拿不到真实的 `files`。上传页的文件夹选择（batch-recognize.vue）也是这么绕过去的。
 */
const pickImages = () => {
  // #ifdef H5
  if (upBusy.value) return
  const el = document.createElement('input')
  el.type = 'file'
  el.multiple = true
  el.accept = 'image/*,.jpg,.jpeg,.png,.webp'
  el.onchange = () => { const fs = Array.from(el.files || []); el.remove(); if (fs.length) doUpload(fs) }
  el.click()
  // #endif
  // #ifndef H5
  uni.showToast({ title: '传图请在电脑浏览器里操作', icon: 'none' })
  // #endif
}

/** 真正上传。multer 的字段名、每次上限（200）都要和服务端对齐，这里写死一处 */
const doUpload = async (fileList) => {
  if (upBusy.value) return
  if (fileList.length > 200) {
    return uni.showToast({ title: '一次最多 200 个文件，请分批传', icon: 'none' })
  }
  upBusy.value = true
  upText.value = '上传中… 0/' + fileList.length
  try {
    // #ifdef H5
    // 这里不用 uni.uploadFile：它一次只带一个 filePath，传 200 张要发 200 个请求；
    // 而服务端这条路由本来收的就是 multipart 里的多个 files 字段。直接用 FormData。
    const fd = new FormData()
    fileList.forEach(f => fd.append('files', f, f.name))
    const token = uni.getStorageSync('token')
    const r = await fetch(API + '/pack-files/' + encodeURIComponent(packCode.value) + '/upload', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + (token || '') }, body: fd,
    })
    const d = await r.json()
    // #endif
    // #ifndef H5
    const d = { ok: false, error: '传图请在电脑浏览器里操作' }
    // #endif
    if (d && d.ok) {
      const lines = ['✅ 收了 ' + d.savedCount + ' 个']
      if (d.skippedCount) {
        lines.push('跳过 ' + d.skippedCount + ' 个：')
        d.skipped.slice(0, 6).forEach(s => lines.push('· ' + s.name + ' —— ' + s.reason))
        if (d.skippedCount > 6) lines.push('…另外 ' + (d.skippedCount - 6) + ' 个同理')
      }
      uni.showModal({ title: '上传结果', content: lines.join('\n'), showCancel: false })
      // 新传的图可能刚好补上某张一直显示「无图」的卡：换版本号 + 重建瓦片，
      // 那张卡立刻就有图了（不换的话它那次的 404 结果还留在当前这次渲染里）。
      bumpImgVer(); buildTiles()
      loadPackImgCount()
    } else {
      uni.showToast({ title: '❌ ' + ((d && d.error) || '上传失败'), icon: 'none' })
    }
  } catch (e) {
    uni.showToast({ title: '上传失败：' + e.message, icon: 'none' })
  }
  upBusy.value = false
  upText.value = ''
}

/** 选 Excel */
const pickExcel = () => {
  // #ifdef H5
  if (upBusy.value) return
  const el = document.createElement('input')
  el.type = 'file'
  el.accept = '.xlsx,.xls'
  el.onchange = () => { const f = (el.files || [])[0]; el.remove(); if (f) doImportExcel(f) }
  el.click()
  // #endif
  // #ifndef H5
  uni.showToast({ title: '导表请在电脑浏览器里操作', icon: 'none' })
  // #endif
}

const doImportExcel = async (file) => {
  if (upBusy.value) return
  upBusy.value = true
  upText.value = '解析表格中…'
  try {
    const fd = new FormData()
    fd.append('file', file, file.name)
    const token = uni.getStorageSync('token')
    const r = await fetch(API + '/packs/' + encodeURIComponent(packCode.value) + '/import-excel', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + (token || '') }, body: fd,
    })
    const d = await r.json()
    if (d && d.ok) {
      // 拒掉的行、对不上的罕贵度都要原样摊出来。**不能只说一句「导入成功」**：
      // 罕贵度写错不会报错，只会让那张卡显示成卡背，是最难事后查的一类问题。
      const lines = [`新增 ${d.inserted} 条，库里现在共 ${d.totalCards} 条`]
      if (d.noImage) lines.push(`其中 ${d.noImage} 个编号在图源里还没有图片`)
      if (d.warnings && d.warnings.length) {
        lines.push('', '⚠️ 需要留意 ' + d.warnings.length + ' 条：')
        d.warnings.slice(0, 5).forEach(w => lines.push('· 第 ' + w.row + ' 行 ' + w.reason))
        if (d.warnings.length > 5) lines.push('…另外 ' + (d.warnings.length - 5) + ' 条同理')
      }
      if (d.errors && d.errors.length) {
        lines.push('', '❌ 有 ' + d.errors.length + ' 行没收：')
        d.errors.slice(0, 5).forEach(w => lines.push('· 第 ' + w.row + ' 行 ' + w.reason))
        if (d.errors.length > 5) lines.push('…另外 ' + (d.errors.length - 5) + ' 行同理')
      }
      uni.showModal({ title: '导入结果', content: lines.join('\n'), showCancel: false })
      await openPack({ code: packCode.value, has_data: true })   // 重新拉一遍卡表
    } else {
      uni.showModal({ title: '导入失败', content: (d && d.error) || '未知错误', showCancel: false })
    }
  } catch (e) {
    uni.showToast({ title: '导入失败：' + e.message, icon: 'none' })
  }
  upBusy.value = false
  upText.value = ''
}

/** 下模板。带 token 的接口不能用 <a href> 直接下（没有请求头），所以取 blob 再点一下 */
const downloadTemplate = async () => {
  try {
    const token = uni.getStorageSync('token')
    const r = await fetch(API + '/template.xlsx', { headers: { 'Authorization': 'Bearer ' + (token || '') } })
    if (!r.ok) { uni.showToast({ title: '❌ 下载失败', icon: 'none' }); return }
    const blob = await r.blob()
    // #ifdef H5
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = '卡牌编号目录模板.xlsx'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    // #endif
  } catch (e) { uni.showToast({ title: '❌ 下载失败', icon: 'none' }) }
}

const loadPackImgCount = async () => {
  try {
    const d = await reqPackFiles('/pack-files/' + encodeURIComponent(packCode.value))
    packFileCount.value = (d && d.count) || 0
  } catch (e) { /* 数不出来就不显示这一行 */ }
}

/** 二级里都可以拖：空包是「往里拖图片」，有数据的包是「补几张图」 */
const canDrop = computed(() => inDetail.value && !editVisible.value)

// 拖拽上传 —— 全项目第一处拖放。
// 直接挂 document 而不是绑在提示卡上：uni-app H5 把 `<view>` 渲染成 `<uni-view>`，
// 模板 ref 拿到的是组件实例而不是 DOM 节点，要拿真节点还得绕 $el，不值当；
// 而且这一屏的语义本来就是「把这个包该有的图片拖进来」，整页当投放区更顺手。
const onDocDragOver = (e) => { e.preventDefault(); if (canDrop.value) dragOver.value = true }
const onDocDragLeave = (e) => { if (!e.relatedTarget) dragOver.value = false }
const onDocDrop = (e) => {
  // 一律 preventDefault：不拦的话浏览器会把拖进来的图片**当成导航**直接打开它，
  // 等于把用户从后台踹出去。拦掉之后只在二级里才真的收。
  e.preventDefault()
  dragOver.value = false
  if (!canDrop.value) return
  const fs = Array.from((e.dataTransfer && e.dataTransfer.files) || [])
  if (fs.length) doUpload(fs)
}

// ==================== 图源里有、目录里没有的包 ====================
const uncatTotal = ref(0)
const uncatMissingTotal = ref(0)
const uncatVisible = ref(false)
const uncatBusy = ref(false)
const uncatList = ref([])
const uncatMissingList = ref([])

// 一级那行提示只要计数，所以走便宜档（不带文件数）——
// 「数每个目录里有几张图」要对 1500 多个目录各 readdir 一次，不该为一行提示付这个代价
const loadUncat = async () => {
  try {
    const d = await api('/uncataloged-packs')
    if (d && d.ok) { uncatTotal.value = d.total || 0; uncatMissingTotal.value = d.missingDirCount || 0 }
  } catch (e) { /* 这行提示失败不该影响主流程 */ }
}

const openUncat = async () => {
  uncatVisible.value = true; uncatBusy.value = true
  try {
    const d = await api('/uncataloged-packs?detail=1')
    if (d && d.ok) { uncatList.value = d.uncataloged || []; uncatMissingList.value = d.missingDir || [] }
  } catch (e) { uni.showToast({ title: '加载失败', icon: 'none' }) }
  uncatBusy.value = false
}

// 点一个未收录的包 → 直接开它的目录浏览。这条路径**不经过 _index.json**，
// 所以「图源里有、目录里没收」的包照样能进去看图（这也正是它们唯一可达的入口）
const openUncatDir = (code) => {
  uncatVisible.value = false
  pfCode.value = code
  pfHighlight.value = ''
  pfVisible.value = true
}
// 「打开」要精准到哪一层：这张图在图源里真的存在 → 让资源管理器选中它；
// 不存在（或编号/卡密还没填全，图压根没去取）→ 退到整个包。
// 跟 PackFilesDialog 高亮那张卡是同一个规矩（有卡则精准到卡，没有则到包），
// 只是那边落在弹窗列表里，这边落在资源管理器里。
const efOpenTarget = computed(() => (editFormPreview.value && !efPreviewErr.value ? efPreviewName.value : ''))

// 编辑弹窗里直接调 explorer，不走弹窗 —— 用户要的就是「一键落到那个文件夹」
const openPackDirOnPC = (file) => {
  reqPackFiles('/pack-files/' + encodeURIComponent(packCode.value) + '/open',
    { method: 'POST', data: file ? { file } : {} })
    .then(d => {
      if (!d || !d.ok) return uni.showToast({ title: '❌ ' + ((d && d.error) || '打开失败'), icon: 'none' })
      // 后端回带 selected = 真选中了哪个文件；没选中就说明退成了「只开文件夹」
      uni.showToast({ title: d.selected ? '已选中 ' + d.selected : '已在本机打开', icon: 'none' })
    })
    .catch(() => uni.showToast({ title: '只能在服务器那台电脑上用', icon: 'none' }))
}

// 卡牌编号目录接口（/api/tcg 下，要带 token）。PackFilesDialog 内部也有一份同样的 ——
// 组件要能独立使用，不从这里注入。
const reqPackFiles = (url, opts) => {
  const token = uni.getStorageSync('token')
  return uni.request({
    url: API + url,
    header: { 'Authorization': 'Bearer ' + (token || ''), 'Content-Type': 'application/json' },
    ...opts,
  }).then(r => r.data)
}

// 编号数字段去前导零：DL1-001 → DL1-1，DL1-01 → DL1-1
const normCode = (code) => {
  const p = String(code || '').toUpperCase().split('-')
  if (p.length < 2) return String(code || '').toUpperCase()
  if (/^\d+$/.test(p[p.length - 1])) p[p.length - 1] = String(parseInt(p[p.length - 1], 10))
  return p.join('-')
}
const prefixOf = (code) => String(code || '').toUpperCase().split('-')[0]

const loadMarks = async () => {
  try {
    const data = await apiV1('/card-marks/codes')
    // 权威是 items（(编号,罕贵度) 才能唯一定位一条记录）。老后端只回 codes 时
    // 退回"全按通配"，宁可标多了也不能漏标。
    const items = Array.isArray(data.items)
      ? data.items
      : (data.codes || []).map(c => ({ code: c, rarity: '' }))
    markedCodes.value = items
      .map(it => ({
        code: markNorm(it && it.code),
        rarity: markNorm(it && it.rarity),
        source: (it && it.source) === 'auto' ? 'auto' : 'manual',
      }))
      .filter(m => m.code && m.code !== '...' && m.code !== '---')
    buildPackMarkCounts()
    // 登记和卡包是并行的两个请求，谁先回来不一定。如果已经进了二级，
    // 拿到登记后要把当前包的标红重算一遍，否则这一屏永远不红（要等用户退出再进）
    if (inDetail.value) { buildMarkIndex(); buildTiles() }
  } catch (e) { console.warn('拉信息登记失败', e) }
}

// 一级：按「编号前缀 = 包 code」归到卡包上；归不到任何卡包的单独成一张清单。
// 注意这里的锚点是**一级列表自己的包集合**，不另造第三套包宇宙。
// 数的是**记录条数**：同一个编号的 N 和 NPR 各一条 = 2 处要修，正是这个角标的意义。
const buildPackMarkCounts = () => {
  const known = new Set(packs.value.map(p => p.code))
  const counts = {}
  const orphan = []
  for (const m of markedCodes.value) {
    const pre = prefixOf(m.code)
    if (known.has(pre)) counts[pre] = (counts[pre] || 0) + 1
    else orphan.push(m)
  }
  packMarkCounts.value = counts
  orphanMarks.value = orphan
}

// 二级：拿当前卡表把登记记录对上，同时把对不上的挑出来。
//
// 一个编号在卡表里可能有好几行（N / NPR / SER…），所以索引建的是
// 「编号 → 该编号的所有行」，再逐行比罕贵度。**不能**像以前那样
// 「编号 → 一个 code」——那样一档匹配上就把整个编号画红了。
const buildMarkIndex = () => {
  const exact = new Map()   // 'CODE'      → [卡表里的行]
  const byNorm = new Map()  // 'CODE归一后' → [卡表里的行]
  for (const c of cards.value) {
    const k = markNorm(c.code)
    if (!exact.has(k)) exact.set(k, [])
    exact.get(k).push(c)
    const nk = normCode(c.code)
    if (!byNorm.has(nk)) byNorm.set(nk, [])
    byNorm.get(nk).push(c)
  }
  const idx = {}
  const left = []
  const mine = markedCodes.value.filter(m => prefixOf(m.code) === markNorm(packCode.value))
  for (const m of mine) {
    const 精确 = exact.get(m.code)
    const 组 = 精确 || byNorm.get(normCode(m.code))
    // 编号这一关就挂了：那正是它被登记的原因（卡面号和目录号错位）
    if (!组) { left.push({ ...m, why: 'code' }); continue }
    const kind = 精确 ? 'exact' : 'norm'
    let 命中 = false
    for (const c of 组) {
      // 通配记录罩住该编号的所有罕贵度；否则要求这一档一字不差
      if (m.rarity && m.rarity !== markNorm(c.rarity)) continue
      idx[markNorm(c.code) + '|' + markNorm(c.rarity)] = kind
      命中 = true
    }
    // 编号在、但本包里没有这一档 —— 这正是"精准查到错误点"要说的事，不能悄悄吞掉
    if (!命中) left.push({ ...m, why: 'rarity' })
  }
  markIndex.value = idx
  packMarksLeft.value = left
}
// 这张卡（它自己的编号 + 它自己的罕贵度）有没有被登记。
// 返回 'exact'（编号完全对上）| 'norm'（编号位数不一致）| ''（没登记）。
const markKind = (code, rarity) =>
  markIndex.value[markNorm(code) + '|' + markNorm(rarity)] || ''

// ==================== API ====================
const api = (url, opts) => {
  const token = uni.getStorageSync('token')
  return uni.request({
    url: API + url,
    header: { 'Authorization':'Bearer ' + (token||''), 'Content-Type':'application/json' },
    ...opts
  }).then(r => r.data)
}
// 信息登记（cardmarks）挂在 /v1/api 下，不在 /api/tcg 里，拼不出来，单开一个
const apiV1 = (url, opts) => {
  const token = uni.getStorageSync('token')
  return uni.request({
    url: '/v1/api' + url,
    header: { 'Authorization':'Bearer ' + (token||''), 'Content-Type':'application/json' },
    ...opts
  }).then(r => r.data)
}

// 卡包清单**一次拉全**：接口是按页给的（每页上限 2000），所以这里顺着 totalPages
// 把后面的页也拉回来，拉满为止。
//
// 为什么不改成「上一页 / 下一页」那种翻页 UI：本页的搜索、分类、状态三个筛选
// 都是拿 `packs` 这一份**全量**在本地筛的（filteredPacks）。真分页之后筛选只会
// 作用在当前这一页上 —— 搜「QCAC」在第二页，第一页搜出来就是空的，看着像没这个包。
// 要真分页就得把三个筛选一起搬到服务端，那是另一件事。
//
// 为什么不是简单把 perPage 调大：那只是把「931 个包刚好没超」换成「2000 个刚好没超」，
// 过线那天照样**静默少显示**（接口只回前 N 条，页面不看 total）。循环拉才是真的没有上限。
const 每页包数 = 2000
const fetchPacks = async () => {
  try {
    let 全部 = [], page = 1, totalPages = 1
    do {
      const data = await api(`/packs?page=${page}&perPage=${每页包数}`)
      全部 = 全部.concat(data.packs || [])
      totalPages = data.totalPages || 1
      page++
      // 兜底：万一 totalPages 报得离谱，别在这儿转成死循环
    } while (page <= totalPages && page <= 50)
    packs.value = 全部
    buildPackMarkCounts()   // 包的集合刚变，登记归属要重算
  } catch(e) { console.error(e) }
}

const openPack = async (p) => {
  if (!p.has_data) { uni.showToast({ title:'⏳ 该卡包数据待爬取', icon:'none' }); return }
  try {
    const data = await api('/packs/' + p.code)
    packCode.value = p.code; packData.value = data; cards.value = data.cards || []
    // 每次进包换一个新版本号：上次进这个包之后图源里改过名字的图，这次一进来就是新的
    bumpImgVer()
    initRows(); buildMarkIndex(); buildTiles()
    inDetail.value = true
    loadPackDir(); loadPackImgCount()
  } catch(e) { uni.showToast({ title:'加载失败', icon:'none' }) }
}

// 每一行要两个只在本地存在的东西：
//   · `_rowKey` —— v-for 的 :key，也是「弹窗当前在改哪一行」的凭据。用 _rowKey 而不是编号：
//     编号可改，用编号当键的话改完编号这一行的东西就全对不上了。
//   · `_orig`   —— 这一行的**原身份**（三元组）。保存时拿它跟新的 (编号, 罕贵度, 后缀序号) 比：
//     只要变了，这一行在库里的主键就变了，老行找不回来，得显式报进 `deleted` 让它跟着走。
const initRows = () => {
  cards.value.forEach((c, i) => {
    if (!c._rowKey) c._rowKey = 'r' + i
    c._orig = { code: c.code, rarity: c.rarity || '', altArtIndex: parseInt(c.alt_art_index) || 0 }
  })
}

// ---------- 单行保存 ----------
// 这是本页**唯一**的写路径：弹窗里点「确认更改」→ 改这一行 → 立刻 PUT。
// 以前不是这样的：「确认更改」只往内存里塞一份草稿、再顺手打开「修改模式」，
// 真正落库要另点顶栏的 💾 保存 —— 于是「确认更改」看着像存好了，其实一个字都没进库，
// 而且这个页面**没有任何离开守卫**，返回一下草稿就没了。
//
// 服务端 PUT 的语义是「只 upsert + 显式删」：`deleted` 里没说的行绝不会被删，
// 所以只提交一行是安全的（不会被理解成「其它行都不要了」）。
const saveRow = async (row, f) => {
  if (saveBusy.value) return
  saveBusy.value = true
  const 新编号 = String(f.code).trim().toUpperCase()
  const 新罕贵 = String(f.rarity || '').trim()
  const 新序号 = parseInt(f.alt_art_index) || 0

  // 罕贵度或后缀序号一改，这一行的**主键就变了** —— 服务端只 upsert 不删，老行会原地留着，
  // 结果改一次多一行。把老行原样报进 deleted，让它跟着走。
  const deleted = []
  if (row && row._orig && row._orig.code &&
      (row._orig.code.toUpperCase() !== 新编号 || row._orig.rarity !== 新罕贵 || row._orig.altArtIndex !== 新序号)) {
    deleted.push({ code: row._orig.code, rarity: row._orig.rarity, altArtIndex: row._orig.altArtIndex })
  }

  const 提交行 = {
    code: 新编号,
    ext_code: f.ext_code,
    // **不回传三个卡名**。名字是唯一目录里按「钥匙」（卡密，没卡密才用编号）现查出来的
    // 派生值，这一行没有自己的名字可写。以前照抄 row 上的旧名字回去"喂"给服务端
    // `卡名.收下()`，本意是「只补空位、不覆盖」，可改卡密时钥匙已经换成了新卡密 ——
    // 旧卡的名字就被写到了**新卡密**这个身份上，凭空造出一条 carduniques
    // （实测 1000020 → 強欲の壺，13,883 → 13,884）。
    // 三个名字全空时 `收下` 一行都写不动（`补` 与 `现` 全等 → continue → ops 为空、不 bulkWrite），
    // 所以不回传 = 零写入。`收下` 只在三条**导入**路径上还有用，那边名字来自文件。
    rarity: 新罕贵,
    alt_art_index: 新序号,
    alt_label: f.alt_label,
    cn_source: 'manual',
  }

  try {
    const d = await api('/packs/' + packCode.value, { method:'PUT', data:{ cards:[提交行], deleted } })
    if (!d || !d.ok) {
      uni.showToast({ title:'❌ ' + ((d && d.error) || '保存失败'), icon:'none' })
      saveBusy.value = false
      return
    }
    // 服务端会**静默跳过**坏行（buildCatalogDoc 直接 continue，见 index.js:700），而且照样
    // 回 `ok:true`。所以不能只看 ok：`saved` 是「真写进去几行」。
    // saved=0 就是一行都没落库（缺编号 / 卡密不是纯数字），这时**绝不能**改本地状态
    // ——否则页面上会多出一行刷新就没的幽灵卡。
    if (!d.saved) {
      uni.showModal({ title:'没存进去', content:(d.errors || ['服务端跳过了这一行']).join('\n'), showCancel:false })
      saveBusy.value = false
      return
    }
    // 另外 errors 里还可能混着「包 JSON 回写失败（数据库已保存）」「卡名写入唯一目录失败」——
    // 这两种库都已经是对的了，只是图源那份镜像没刷新。光看 errors 非空会把它误报成失败，
    // 所以上面先用 saved 分开，这里只把提示摊开，本地照常更新。
    if (d.errors && d.errors.length) {
      uni.showModal({ title:'已存进数据库，但有提示', content: d.errors.join('\n'), showCancel:false })
    }
    // 新增时三元组撞上库里已有的行：服务端是 upsert，会**悄悄覆盖**那一行，不是报错。
    // 不说一声的话用户以为加了一张新卡，其实改掉了一张老的。
    if (!row && d.inserted === 0) {
      uni.showModal({ title:'这个编号已经有了',
        content:`库里本来就有 ${新编号}${新罕贵 ? ' · ' + 新罕贵 : ''}，这次是把那一行覆盖掉，不是新增。`,
        showCancel:false })
    }
    editVisible.value = false
    await afterRowSaved(row, 提交行)
    uni.showToast({ title:'✅ 已保存', icon:'none' })
  } catch(e) { uni.showToast({ title:'请求失败', icon:'none' }) }
  saveBusy.value = false
}

/**
 * 一行存完之后，把它那三个卡名按**新身份**重新要一遍。
 *
 * 卡名是身份的派生值（见 services/cardNames.js 顶上那段）：卡密一改就换了取名字的钥匙，
 * 行上缓存的那三个字符串立刻过期。而下面的就地更新**从来不碰**
 * `jp_name/cn_name/en_name` —— 不补的话，表格行（模板里那个 `toRubyHtml(c.jp_name)`）
 * 和卡片格会一直挂着**上一把钥匙的名字**。
 *
 * 只补这一行。`openPack` 要重拉上千行、重算瓦片、重取包目录，这里其实只差三个字符串。
 */
const 刷新这一行名字 = async (row) => {
  if (!row) return
  try {
    const d = await api('/card-names?ext_code=' + encodeURIComponent(row.ext_code || '')
      + '&code=' + encodeURIComponent(row.code || ''))
    if (!d || !d.ok) return
    row.jp_name = d.jp_name || ''
    row.cn_name = d.cn_name || ''
    row.en_name = d.en_name || ''
  } catch (_) { /* 刷不到就留旧值 —— 名字旧了是小事，别让它打断「已保存」 */ }
}

/**
 * 存完之后的本地收尾。**不能**像以前的批量保存那样 `cards.value = 刚提交的那份`
 * —— 那会只剩这一行。就地改这一行就够了。
 *
 * 但两种情况下必须整包重拉：
 *   · 新增的行：真值以服务端为准（它还会顺手更新 _index.json 里的计数）
 *   · 罕贵度里带「、」或末尾 `(N)`：服务端 `展开()`（services/catalogRarity.js:55）会把
 *     一条**拆成好几行**（`UR、SER` → 2 行），而且 `(N)` 里的序号**赢过**「后缀序号」那一格。
 *     就地改会少显示一行、或者把后缀序号显示错。
 */
const afterRowSaved = async (row, 提交行) => {
  const 要重拉 = !row || 提交行.rarity.includes('、') || /\(\d+\)$/.test(提交行.rarity)
  if (要重拉) {
    await openPack({ code: packCode.value, has_data: true })
    return
  }
  Object.assign(row, {
    code: 提交行.code, ext_code: 提交行.ext_code, rarity: 提交行.rarity,
    alt_art_index: 提交行.alt_art_index, alt_label: 提交行.alt_label, cn_source: 'manual',
  })
  row._orig = { code: 提交行.code, rarity: 提交行.rarity, altArtIndex: 提交行.alt_art_index }
  // 无条件补名字，**不做**「身份变没变」的判断 —— 判不出来：改编号那条路里
  // `doRenameCode` 在调 saveRow **之前**就把行上的 code 换成新编号了（见那边的循环），
  // 所以这里 `提交行.code !== row.code` 永远为假，偏偏那条路名字会过期。
  // 一次纯内存查表的 GET 换掉一整类静默过期，划算。
  await 刷新这一行名字(row)
  buildMarkIndex(); buildTiles()
}

// ---------- 删掉这一行 ----------
// 以前是表格里每行的 🗑（只在「修改模式」下才有，而那张表在 <900px 是 display:none，
// 手机上根本够不着），而且当时只打个 _deleted 标记、等保存时一起提交。现在搬进弹窗、立刻删。
const startDeleteCard = () => {
  const row = cards.value.find(c => c._rowKey === editRowKey.value)
  if (!row) return
  uni.showModal({
    title: '删掉这张卡？',
    content: `${row.code}${row.rarity ? ' · ' + row.rarity : ''}\n只删这一行目录，图源里的图片和「信息登记」都不动。`,
    confirmText: '删除',
    success: (r) => { if (r.confirm) doDeleteCard(row) },
  })
}

const doDeleteCard = async (row) => {
  if (saveBusy.value) return
  saveBusy.value = true
  try {
    const d = await api('/packs/' + packCode.value, { method:'PUT', data:{
      // cards 传空数组是合法的：服务端只删 `deleted` 里明说的那几行，
      // 不会因为 cards 里没有就把别的行一起删掉
      cards: [],
      deleted: [{ code: row.code, rarity: row.rarity || '', altArtIndex: parseInt(row.alt_art_index) || 0 }],
    } })
    if (!d || !d.ok) {
      uni.showToast({ title:'❌ ' + ((d && d.error) || '删除失败'), icon:'none' })
    } else if (!d.removed) {
      // removed = 0 → 一行都没删掉。这个编号还有实物卡时服务端就是这么拒的，原因在 errors 里
      uni.showModal({ title:'没删掉', content: (d.errors || ['那一行已经不在了（刷新看看）']).join('\n'), showCancel:false })
      await openPack({ code: packCode.value, has_data: true })
    } else {
      editVisible.value = false
      cards.value = cards.value.filter(x => x._rowKey !== row._rowKey)
      packData.value.cards = cards.value
      buildMarkIndex(); buildTiles()
      uni.showToast({ title:'✅ 已删掉这一行', icon:'none' })
    }
  } catch(e) { uni.showToast({ title:'请求失败', icon:'none' }) }
  saveBusy.value = false
}

// 卡牌地址 = ocgDir + 包名，由服务端现算（图源设置换了它自动跟着变，前端不硬编码）
const loadPackDir = async () => {
  packDir.value = ''; packDirExists.value = true
  try {
    const d = await reqPackFiles('/pack-files/' + encodeURIComponent(packCode.value) + '/path')
    if (d && d.ok) { packDir.value = d.path; packDirExists.value = !!d.exists }
    else if (d && d.error) { packDir.value = '（' + d.error + '）'; packDirExists.value = false }
  } catch (e) { packDir.value = '（读取失败）'; packDirExists.value = false }
}

// 传 `null` = 「新增一张卡」（顶栏那个 ＋ 按钮）：没有对应的行，所有字段从空开始。
const openEditCard = (c) => {
  名序号++                                     // 作废上一个弹窗在途的卡名查询，别让它盖住这一行的初值
  if (名防抖) { clearTimeout(名防抖); 名防抖 = null }
  editRowKey.value = c ? c._rowKey : ''
  if (!packDir.value) loadPackDir()   // 打开编辑时现取一次，别让地址栏空着
  editForm.code = c ? (c.code || '') : ''
  editForm.ext_code = c ? (c.ext_code || '') : ''
  editForm.jp_name = c ? (c.jp_name || '') : ''
  editForm.cn_name = c ? (c.cn_name || '') : ''
  editForm.en_name = c ? (c.en_name || '') : ''
  editForm.rarity = c ? (c.rarity || '') : ''
  editForm.alt_index = String(c ? (parseInt(c.alt_art_index) || 0) : 0)
  editForm.alt_label = c ? (c.alt_label || '') : ''
  // 三个名字就用行上的值（行上的名字是服务端按同一把钥匙回填过的），**打开时不回查** ——
  // 把身份直接记成「已查过」，上面那个 watch 遇到相同钥匙会跳过，免得一打开就白发一次请求。
  已查钥匙 = 当前钥匙()
  editVisible.value = true
}

// 弹窗里点「确认更改」：**立刻存这一行**。三条路：
//   ① 新增（弹窗是从「＋ 新增一张卡」打开的，根本没有对应的行）
//   ② **编号动了** → 这不是普通字段，它同时出现在图源文件名 / 目录 / 包 JSON / 库存卡 四个地方，
//      必须走 POST /rename-code。先 dryRun 盘点给二次确认，确认了才真跑；
//      跑完再把其余 4 个字段用 PUT 落下去（见 doRenameCode 末尾）。
//   ③ 其余字段动了 → 直接 PUT 这一行
const applyEditCard = () => {
  if (saveBusy.value) return
  const code = String(editForm.code || '').trim().toUpperCase()
  if (!code) return uni.showToast({ title:'请填卡牌编号', icon:'none' })
  const ext = String(editForm.ext_code || '').trim()
  // 服务端 buildCatalogDoc 判的就是这个（规则唯一一份在 api/cardDb.js，与后端同形），
  // 前端先拦一道省得白跑一趟
  if (!卡密可留空(ext)) return uni.showToast({ title:'卡密' + 卡密说明, icon:'none' })
  const f = {
    code, ext_code: ext,
    rarity: String(editForm.rarity || '').trim(),
    alt_art_index: parseInt(editForm.alt_index) || 0,
    alt_label: editForm.alt_label || '',
  }

  const row = cards.value.find(c => c._rowKey === editRowKey.value)
  if (!row) return saveRow(null, f)                       // ① 新增
  const 编号变了 = code !== String(row.code).toUpperCase()
  const 其余变了 = f.ext_code !== (row.ext_code || '')
    || f.rarity !== (row.rarity || '')
    || f.alt_art_index !== (parseInt(row.alt_art_index) || 0)
    || f.alt_label !== (row.alt_label || '')
  // 一个字都没改就别发请求了 —— 每次 PUT 都会重写一遍图源里的包 JSON，白写不划算
  if (!编号变了 && !其余变了) { editVisible.value = false; return }
  if (编号变了) { 待存字段.value = f; return startRenameCode(row, code) }   // ②
  saveRow(row, f)                                        // ③
}

// ---------- 改卡牌编号 ----------
const renameBusy = ref(false)
const renameVisible = ref(false)    // 二次确认弹窗。别漏了它 —— 漏了不报错，只会在 startRenameCode 里
                                    // 变成 ReferenceError 被 catch 吞掉，表现成「盘点失败，网络或服务异常」，
                                    // 一路查到服务端都查不出问题。前端这类漏声明只有页面层测试能兜住。
const renamePlan = ref(null)        // dryRun 的盘点结果

// 二次确认里要摊开的那几行。写成一个 computed 而不是在模板里拼字符串 ——
// 模板里放 slice/map 这种表达式在 uni-app 的编译器下不保险，也不好看。
const renameLines = computed(() => {
  const p = renamePlan.value
  if (!p) return []
  const names = p.files.slice(0, 3).map(f => f.from).join('、')
  const lines = [
    '· 图源文件：重命名 ' + p.filesCount + ' 个' + (p.filesCount ? '（' + names + (p.filesCount > 3 ? ' …' : '') + '）' : ''),
    '· 卡牌编号目录：' + p.catalogCount + ' 行',
    '· 包 JSON（' + p.packCode + '.json）：' + (p.packJsonHasIt ? '会一起改' : '里面没有这一条'),
    '· 库存卡：' + p.cardsCount + ' 张（所有库合计）',
    '· 信息登记：' + (p.markCount ? '这个编号的 ' + p.markCount + ' 条登记记录会被删除（编号修好了，标记就该消失）' : '没有登记记录'),
    '· 原文件会先复制到 Server\\Storage\\rename-backup\\{时间戳}\\ 再改名，能捞回来',
  ]
  for (const w of (p.warnings || [])) lines.push('⚠️ ' + w)
  return lines
})

const startRenameCode = async (card, newCode) => {
  renameBusy.value = true
  try {
    const d = await api('/rename-code', { method:'POST',
      data:{ oldCode: card.code, newCode, packCode: packCode.value, altArtIndex: parseInt(card.alt_art_index)||0, dryRun: true } })
    // 前置校验没过（编号形状不对 / 新编号已存在 / 目录里没这个编号）时，服务端直接给原因。
    // 这一步**什么都没改**，所以只需把原因原样告诉用户，不用进二次确认。
    if (!d || d.error) {
      uni.showModal({ title:'不能这样改', content:(d && d.error) || '盘点失败', showCancel:false })
      renameBusy.value = false
      return
    }
    renamePlan.value = d.plan
    editVisible.value = false
    renameVisible.value = true
  } catch (e) {
    uni.showModal({ title:'不能这样改', content:'盘点失败，网络或服务异常', showCancel:false })
  }
  renameBusy.value = false
}

const doRenameCode = async () => {
  const p = renamePlan.value
  if (!p) return
  renameBusy.value = true
  const oldCode = p.oldCode
  const 待办 = 待存字段.value
  待存字段.value = null
  try {
    const d = await api('/rename-code', { method:'POST',
      data:{ oldCode, newCode: p.newCode, packCode: p.packCode, altArtIndex: 0 } })
    if (!d || d.error) { uni.showToast({ title:'❌ ' + (d && d.error ? d.error : '改编号失败'), icon:'none' }); renameBusy.value = false; return }
    // 本地跟随：**整个编号组**都要换，不是只换弹窗里这一行。
    // 服务端是 `CardCatalog.updateMany({ code: oldCode }, ...)`（`index.js:1480`），
    // 一个编号下的每一档罕贵度都是一行、都被一起挪走了。而本地这个编号通常就是好几行
    // —— 只改点开的那一行的话，同编号的其它行还挂着旧编号，用户下次点它们编辑时
    // `saveRow` 会拿旧编号当主键 upsert，等于把刚改好的编号又劈出一行野行。
    // （以前这毛病被「整包重发、cards.value 全量覆盖」盖着，改成单行保存后才露出来。）
    // `_orig.code` 也得一起换 —— 它是「这一行在库里的主键」，下次比对时若还拿旧编号，
    // 会误判成「编号被改过」而把一条本来不存在的旧行报进 deleted。
    const card = cards.value.find(c => c._rowKey === editRowKey.value)
    const 改过的行 = []
    for (const c of cards.value) {
      if (String(c.code || '').trim().toUpperCase() !== oldCode.toUpperCase()) continue
      c.code = p.newCode
      if (c._orig) c._orig.code = p.newCode
      改过的行.push(c)
    }
    // 这个编号的「信息登记」服务端已经**整组**删了（deleteMany，一个编号可能有好几档），
    // 本地也要摘掉，否则红块会留到下次刷新。按 code 过滤，不是按 (code, rarity) —— 删的是整组。
    if (d.markDeleted) {
      markedCodes.value = markedCodes.value.filter(x => x.code !== oldCode)
      buildPackMarkCounts()
    }
    buildMarkIndex(); buildTiles()
    renameVisible.value = false
    renamePlan.value = null
    // 编号改完了。弹窗里若还改了别的字段（卡密/罕贵度/后缀/异画标签），这里一并落库 ——
    // 以前这要用户自己回去点顶栏那个 💾 保存，而那个按钮已经取消了。
    // saveRow 会自己把弹窗关掉、并在失败时摊开原因（它的 _orig 现在是新编号，删旧行仍是对的）。
    const 还要落别的字段 = !!(card && 待办 &&
      (待办.ext_code !== (card.ext_code || '') || 待办.rarity !== (card.rarity || '') ||
       待办.alt_art_index !== (parseInt(card.alt_art_index) || 0) || 待办.alt_label !== (card.alt_label || '')))
    if (还要落别的字段) {
      await saveRow(card, 待办)      // 里面的 afterRowSaved 会把这一行的名字补上
    } else {
      // 只改了编号，saveRow 不会被调用 —— 名字这把刷新得自己补。
      // 换编号就是换身份：卡密为空时编号才是钥匙，名字跟着变（新编号多半查不到，该显示「—」）；
      // 卡密非空时钥匙没动，刷回来是同一组值，无害。
      await Promise.all(改过的行.map(刷新这一行名字))
    }
    const extra = (d.warnings && d.warnings.length) ? '\n' + d.warnings.join('\n') : ''
    uni.showModal({ title:'✅ 已改成 ' + p.newCode,
      content:`图源文件 ${d.renamed} 个 · 目录 ${d.catalogUpdated != null ? d.catalogUpdated : 1} 行 · 库存卡 ${d.cardsUpdated} 张` +
              (d.markDeleted ? ' · 已清掉 ' + d.markDeleted + ' 条信息登记' : '') + extra,
      showCancel:false })
  } catch (e) { uni.showToast({ title:'❌ 请求失败', icon:'none' }) }
  renameBusy.value = false
}

// ---------- 删卡包 ----------
// 跟改编号同一套路：先 dryRun 盘点 → 弹二次确认 → 真跑。差别是这里有一步会**直接拒绝**：
// 包里还有实物卡时服务端不给删（用户定的口径是「直接禁止，先清空库存」），
// 这时弹窗只显示原因、不给「确认删除」按钮。
const delVisible = ref(false)
const delBusy = ref(false)
const delPlan = ref(null)          // dryRun 的盘点结果（字段是后端给的中文键）

// 二次确认里要摊开的那几行。跟 renameLines 一样写成 computed，不在模板里拼字符串。
const deleteLines = computed(() => {
  const p = delPlan.value
  if (!p) return []
  return [
    '· 卡牌编号目录：删掉 ' + p.目录行数 + ' 行',
    '· _index.json：' + (p.有索引条目 ? '摘掉这个条目' : '本来就没有这个条目'),
    '· 包 JSON（' + p.code + '.json）：' + (p.有包JSON ? '一起删掉' : '本来就没有'),
    '· 图源目录：' + (p.有图源目录 ? '搬走 ' + p.图片文件数 + ' 个图片文件' : '图源里本来就没有这个目录'),
    // 登记是人工攒的，删了不可逆 —— 用户已定「留着」。删完它们会出现在一级底部那条
    // 「有 N 条登记不属于任何卡包」的提示里，这是有意的可发现路径，别当 bug 去"修"。
    '· 信息登记：' + (p.登记条数 ? '保留这个包的 ' + p.登记条数 + ' 条登记（人工攒的，不删）' : '这个包没有登记记录'),
    '· 图片只是搬到「图源\\_deleted-packs\\」下，不是真删，需要时能捞回来',
  ]
})

const startDeletePack = async (p) => {
  delBusy.value = true
  try {
    const d = await api('/delete-pack', { method:'POST', data:{ code: p.code, dryRun: true } })
    if (!d || d.error) {
      uni.showModal({ title:'不能删', content:(d && d.error) || '盘点失败', showCancel:false })
      delBusy.value = false
      return
    }
    delPlan.value = d.plan
    delVisible.value = true
  } catch (e) {
    uni.showModal({ title:'不能删', content:'盘点失败，网络或服务异常', showCancel:false })
  }
  delBusy.value = false
}

const doDeletePack = async () => {
  const p = delPlan.value
  if (!p || p.禁止原因) return      // 被拦下的包，这里不该有人来点
  delBusy.value = true
  try {
    const d = await api('/delete-pack', { method:'POST', data:{ code: p.code } })
    if (!d || d.error) { uni.showToast({ title:'❌ ' + (d && d.error ? d.error : '删除失败'), icon:'none' }); delBusy.value = false; return }
    delVisible.value = false
    delPlan.value = null
    // 包没了 ⇒ 一级列表、包角标、底部三条提示全部要重算。
    // 跟 onMounted 那三件套一致：少刷一个，「有 N 条登记不属于任何卡包」就会停在旧数上。
    fetchPacks(); loadMarks(); loadUncat()
    const extra = (d.warnings && d.warnings.length) ? '\n' + d.warnings.join('\n') : ''
    uni.showModal({ title:'✅ 已删掉 ' + p.code,
      content:`目录 ${d.deletedRows} 行 · ${d.indexRemoved ? '索引条目已摘' : '索引里本来没有'} · ${d.packJsonRemoved ? '包 JSON 已删' : '包 JSON 本来没有'} · ${d.imagesMoved ? '图片已搬进 _deleted-packs' : '没有图片目录'}` +
              (d.保留登记 ? ' · 保留 ' + d.保留登记 + ' 条登记' : '') + extra,
      showCancel:false })
  } catch (e) { uni.showToast({ title:'❌ 请求失败', icon:'none' }) }
  delBusy.value = false
}

// ==================== 保底图源模式（卡牌单个展开，按卡密搜索） ====================
const ygoproKw = ref('')
const ygoproList = ref([])
const ygoproPage = ref(1)
const ygoproTotalPages = ref(1)
const ygoproStats = ref('')
const ygoproLoading = ref(false)

const ygoproPageRange = computed(() => {
  const pages = []
  for (let i = Math.max(1, ygoproPage.value - 2); i <= Math.min(ygoproTotalPages.value, ygoproPage.value + 2); i++) pages.push(i)
  return pages
})

// 遍历保底图源（YGOPro，按卡密.jpg 存图），per_page 200 分页，支持卡密搜索
const loadYgoPro = async (page) => {
  if (page) ygoproPage.value = page
  ygoproLoading.value = true
  try {
    const params = { source: 'YGOPro图片源', page: ygoproPage.value, per_page: 200, search: ygoproKw.value }
    const qs = Object.entries(params).map(([k, v]) => k + '=' + encodeURIComponent(v || '')).join('&')
    const token = uni.getStorageSync('token')
    const res = await uni.request({ url: `/api/tcg/list-images?${qs}`, header: { 'Authorization': 'Bearer ' + token } })
    const data = res.data
    if (data.error) { ygoproList.value = []; ygoproStats.value = data.error; ygoproLoading.value = false; return }
    ygoproTotalPages.value = data.totalPages || 1
    ygoproStats.value = `共 ${(data.total || 0).toLocaleString()} 张`
    ygoproList.value = (data.images || []).map(f => ({
      name: f.replace(/\.\w+$/, ''),
      url: '/api/tcg/images/ygopro/' + f,
      err: 0
    }))
  } catch (e) { ygoproList.value = []; ygoproStats.value = '加载失败' }
  ygoproLoading.value = false
}

const copyCardNo = (name) => {
  // 弹窗里文件名条也走这个函数，编号还没填时 efPreviewName 是空串 —— 别把空串塞进剪贴板
  if (!name) return
  // uni 的 H5 版先试 navigator.clipboard，失败再退回 textarea + execCommand。
  // 两条都失败时（非安全上下文又没拿到用户手势）它只会静默走 fail —— 复制按钮
  // 一声不响是最坏的结果，用户会以为名字已经在剪贴板里了，所以这里必须给个提示。
  uni.setClipboardData({
    data: name,
    success: () => uni.showToast({ title: '已复制: ' + name, icon: 'none' }),
    fail: () => uni.showToast({ title: '复制失败，请手动选中再复制', icon: 'none' }),
  })
}

onMounted(() => {
  fetchPacks(); loadMarks(); loadUncat()
  // 拖放只在浏览器里有；小程序/APP 里 document 是 undefined，挂不上也不该挂
  if (typeof document !== 'undefined') {
    document.addEventListener('dragover', onDocDragOver)
    document.addEventListener('dragleave', onDocDragLeave)
    document.addEventListener('drop', onDocDrop)
  }
})
</script>

<style scoped>
.page-container { display:flex; flex-direction:column; min-height:100vh; background:#F5F5F7; overflow-x:hidden }

/* 工具栏 */
.toolbar-panel { background:#FFF; padding:12px 16px 10px; flex-shrink:0; width:100% }
.toolbar { display:flex; justify-content:space-between; align-items:center; position:relative }
.toolbar-left { display:flex; gap:10px; align-items:center }
.tool-btn { width:32px; height:32px; border-radius:16px; background:#F0F0F0; display:flex; align-items:center; justify-content:center }
.icon-sm { width:18px; height:18px }
.tool-title { position:absolute; left:50%; transform:translateX(-50%); font-size:15px; font-weight:500; color:#1A1A1A }
/* 筛选栏 */
.filter-section { background:#FFF; padding:0 14px 10px; flex-shrink:0 }
.filter-bar { display:flex; gap:8px }
.filter-tag { display:flex; align-items:center; gap:4px; background:#F0F0F0; border-radius:14px; padding:5px 10px }
.filter-tag-text { font-size:11px; color:#1A1A1A }
.small-arrow { width:10px; height:10px }

/* 主滚动区 */
.main-scroll { flex:1; padding:10px 16px 20px; width:100%; box-sizing:border-box }
.pack-grid { padding-right:0; width:100%; box-sizing:border-box }
.pack-card { max-width:100%; box-sizing:border-box }

/* 搜索 */
.search-bar { display:flex; align-items:center; gap:8px; margin-bottom:10px }
.search-box { display:flex; align-items:center; gap:6px; flex:1; max-width:calc(100% - 168px); background:#F0F0F0; border-radius:10px; padding:9px 12px }
.search-icon-sm { width:14px; height:14px }
.search-input { flex:1; border:none; background:none; font-size:14px; color:#1A1A1A; min-width:0 }
.pack-count { font-size:11px; color:#999; flex-shrink:0; padding-right:2px }

/* 新建卡包：一行里放得下，就不去动顶栏（顶栏到标题只剩几十像素） */
.new-pack-btn { flex-shrink:0; padding:8px 12px; background:#FF0000; border-radius:10px }
.new-pack-t { font-size:12px; font-weight:500; color:#FFF }

/* 卡包 */
.pack-grid { display:flex; flex-direction:column; gap:8px }
.pack-card { background:#FFF; border-radius:12px; padding:12px 14px; box-shadow:0 1px 6px rgba(0,0,0,.04); position:relative; overflow:hidden; display:flex; flex-direction:column; gap:3px }
.pack-card::before { content:''; position:absolute; left:0; top:0; bottom:0; width:3px }
/* 删卡包的垃圾桶。绝对定位到右上角 —— 卡里第一行（pack-code）很短，那块是空的；
   卡本身 overflow:hidden，所以不会溢出圆角。 */
.pack-del { position:absolute; top:8px; right:10px; padding:4px 6px; font-size:13px; line-height:1; border-radius:8px; cursor:pointer }
.pack-del:hover { background:#FFEBEE }
.st-done::before{background:#34C759} .st-data_only::before{background:#FF9500} .st-rarity_missing::before{background:#FFCC00} .st-failed::before{background:#FF3B30} .st-pending::before{background:#C1C1C6}
.pack-code { font-size:14px; font-weight:600; color:#1A1A1A }
.pack-name { font-size:12px; color:#666; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.pack-meta { display:flex; gap:6px; align-items:center; font-size:10px; color:#999; margin-top:1px; flex-wrap:wrap }
.pack-status { font-size:10px; padding:1px 6px; border-radius:6px }
.st-done .pack-status{background:#E8F5E9;color:#2E7D32} .st-data_only .pack-status{background:#FFF3E0;color:#E65100} .st-rarity_missing .pack-status{background:#FFF8E1;color:#F57F17} .st-failed .pack-status{background:#FFEBEE;color:#C62828} .st-pending .pack-status{background:#F0F0F0;color:#999}
.empty-state { text-align:center; padding:48px 20px; color:#999; font-size:14px }

/* 信息登记叠加：一级角标 + 归不到包的清单入口 */
.pack-flag { font-size:10px; padding:1px 6px; border-radius:6px; background:#FFE8E8; color:#C62828; font-weight:600 }
.orphan-bar { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:12px; padding:10px 12px; background:#FFF8E1; border:1px solid #FFE082; border-radius:10px }
.orphan-text { font-size:12px; color:#8D6E00; flex:1 }
.orphan-arrow { font-size:13px; color:#8D6E00 }
.orphan-card { width:min(420px, 88vw); max-height:70vh; background:#FFF; border-radius:14px; padding:18px; display:flex; flex-direction:column; gap:8px }
.orphan-title { font-size:15px; font-weight:600; color:#1A1A1A }
.orphan-sub { font-size:12px; color:#888; line-height:1.5 }
.orphan-list { max-height:40vh; display:flex; flex-direction:column; gap:4px; margin:4px 0 }
.orphan-item { font-size:12px; color:#1A1A1A; font-family:monospace; padding:3px 0; border-bottom:1px solid #F2F2F2 }

/* 「图源里有、目录里没有」的入口。与「归不到包的登记」同一套视觉语言（都是黄色提醒条），
   但措辞要区分开：一个是登记数据的归属问题，一个是包没收录的问题。 */
.uncat-bar { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:8px; padding:10px 12px; background:#EEF4FF; border:1px solid #C7DBFF; border-radius:10px }
.uncat-text { font-size:12px; color:#1B4B91; flex:1 }
.uncat-arrow { font-size:13px; color:#1B4B91 }
.uncat-head { font-size:12px; color:#444; font-weight:600; margin-top:6px }
.uncat-body { display:flex; flex-direction:column; gap:2px; min-height:0 }
.uncat-item { display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #F2F2F2 }
.uncat-code { font-size:12px; color:#1A1A1A; font-family:monospace; flex:1 }
.uncat-n { font-size:11px; color:#999 }
.uncat-arrow2 { font-size:12px; color:#0A63C4 }
.uncat-miss { font-size:12px; color:#C62828; font-family:monospace; padding:3px 0; border-bottom:1px solid #F2F2F2 }

/* 新建卡包弹窗 */
.new-sub { font-size:11px; color:#888; line-height:1.55; margin-top:-4px }
.ef-note-bad { color:#C62828 }

/* 空包引导卡：格式要求 + 三个入口 + 拖放区。
   拖拽悬停时整卡描边变蓝，是「松手会传到这里」的唯一提示。 */
.guide-card { background:#FFF; border:1px solid #E5E5EA; border-radius:16px; padding:16px; margin-bottom:12px; display:flex; flex-direction:column; gap:6px }
.guide-over { border-color:#0A63C4; box-shadow:0 0 0 3px rgba(10,99,196,.12) }
.gc-title { font-size:14px; font-weight:600; color:#1A1A1A; margin-bottom:2px }
.gc-path { font-size:11px; color:#555; font-family:monospace; word-break:break-all; background:#F5F5F7; border-radius:8px; padding:8px 10px }
.gc-rule { font-size:11px; color:#666; line-height:1.6 }
.gc-warn { font-size:11px; color:#C62828; line-height:1.6; font-weight:500 }
.gc-drop { border:1.5px dashed #C7C7CC; border-radius:12px; padding:18px 12px; text-align:center; margin:6px 0 2px }
.guide-over .gc-drop { border-color:#0A63C4; background:#EEF4FF }
.gc-drop-t { font-size:12px; color:#8E8E93 }
.gc-btns { display:flex; gap:8px }
.gc-btn { flex:1; padding:9px 0; background:#EAF3FF; border-radius:9px; display:flex; align-items:center; justify-content:center }
.gc-plain { background:#F0F0F0 }
.gc-btn-t { font-size:12px; color:#0A63C4; font-weight:500 }
.gc-btn-t2 { font-size:12px; color:#333; font-weight:500 }
.gc-busy { font-size:11px; color:#0A63C4 }

/* 详情 */
.detail-bar { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px }
.detail-info { font-size:12px; color:#666; font-weight:500; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.detail-btns { display:flex; gap:6px; flex-shrink:0 }
.btn-edit,.btn-dir { padding:6px 14px; border-radius:14px }
.btn-edit { background:#F0F0F0 }
.btn-dir { background:#EAF3FF }
.btn-text { font-size:12px; font-weight:500; color:#1A1A1A }
.btn-dir-text { font-size:12px; font-weight:500; color:#0A63C4 }

/* 编辑弹窗里的「卡牌地址」：只读展示 + 两个跳转入口 */
.ef-dir { font-size:11px; color:#555; font-family:monospace; word-break:break-all; line-height:1.5 }
/* 详情弹窗页脚那一条图源地址：标签 + 省略号截断的路径 + 两个小按钮，一行放下。
   路径太长时截断而不是换行 —— 换行会让弹窗高度跟着路径长度变。 */
.ef-foot-dir { display:flex; align-items:center; gap:8px; margin-top:12px;
               background:#F5F5F7; border:1px solid #E5E5EA; border-radius:8px; padding:7px 10px }
.ef-foot-k { font-size:11px; color:#8E8E93; flex-shrink:0 }
.ef-foot-dir .ef-dir { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
.ef-dbtn { flex-shrink:0; padding:6px 10px; background:#EAF3FF; border-radius:7px; display:flex; align-items:center; justify-content:center }
.ef-dbtn-t { font-size:12px; color:#0A63C4; font-weight:500 }

/* 改编号二次确认弹窗 */
.rn-card { width:min(460px, 92vw); max-height:80vh; background:#FFF; border-radius:14px; padding:18px; display:flex; flex-direction:column; gap:10px }
.rn-title { font-size:15px; font-weight:600; color:#1A1A1A; font-family:monospace }
.rn-lines { display:flex; flex-direction:column; gap:6px; background:#F7F7FA; border-radius:10px; padding:10px 12px }
.rn-line { font-size:12px; color:#444; line-height:1.55 }

/* 删卡包确认框。行比改编号多，跟 .rn-card 同宽即可（里面用 flex 竖排，不撑破）。
   禁止删除时那段红字说明：单独一块底色，别跟「会删什么」的灰底混在一起。 */
.del-card { width:min(460px, 92vw); max-height:80vh; background:#FFF; border-radius:14px; padding:18px; display:flex; flex-direction:column; gap:10px }
.del-block { background:#FFEBEE; border-radius:10px; padding:10px 12px }
.del-block-t { font-size:12px; color:#C62828; line-height:1.55 }

/* 编号输入框旁边那行灰字：说清改编号的连带影响 */
.ef-code { font-family:monospace }
.ef-note { font-size:10px; color:#999; line-height:1.5; margin-top:-4px }

/* 表格 */
.card-table-wrap { overflow-x:auto; background:#FFF; border-radius:16px; box-shadow:0 2px 12px rgba(0,0,0,.04); margin-bottom:12px }
.card-table { width:100%; border-collapse:collapse }
.card-table th { background:#F5F5F7; color:#666; font-size:11px; font-weight:500; text-align:left; padding:12px 14px; border-bottom:1px solid #E5E5EA; white-space:nowrap }
.card-table td { padding:10px 14px; font-size:13px; border-bottom:1px solid #F0F0F0; color:#1A1A1A }
.td-code { font-size:11px; color:#666; background:#F5F5F7; padding:2px 5px; border-radius:4px }
.td-flex { display:flex; align-items:center; gap:4px }
.td-en { color:#999; font-size:12px }
.td-rarity { font-size:11px; color:#666 }
.cn-text { font-weight:600 }
.ai-badge { display:inline-block; font-size:10px; background:#FFF3E0; color:#E65100; padding:1px 5px; border-radius:6px; vertical-align:middle }
/* V1.2.50 起表格是纯只读的（改动全走弹窗），所以 .edit-inp / .edit-short / .edit-num /
   .row-del / .th-add / .add-row 这一整套输入框样式都删掉了，别再加回来。 */

/* 早先那版「卡片式列表」（.card-list / .card-item / .card-thumb / .card-info / .ci-* /
   .card-edit-btn）整块删掉了：桌面改表格、手机改网格瓦片之后模板里一个都没再用，
   连媒体查询里的 .card-list 也是空转。别再加回来。 */
.no-img { font-size:10px; color:#CCC }

/* 编辑弹窗 */
.edit-overlay { position:fixed; inset:0; z-index:400; background:rgba(0,0,0,.5); display:flex; align-items:center; justify-content:center; padding:20px }
.edit-card { background:#FFF; border-radius:16px; padding:20px; width:100%; max-width:360px; box-shadow:0 8px 32px rgba(0,0,0,.12); box-sizing:border-box }
.edit-title { font-size:16px; font-weight:600; margin-bottom:14px; display:block }
/* ====== 「卡牌详情」弹窗：左小图 + 右边紧挨着卡名 + 下面两行输入 ======
   通用的 360px 窄弹窗是给「删除确认」那种一句话弹窗用的。详情要把九个字段都摊开，
   以前是竖着一路排下来，高度直奔 700px，手机上要滚两屏才够得着「确认更改」。

   ⚠️ 卡名和登记**不能**摞在输入框下面（第一版就是这么放的，被用户打回来了）：
   那样右栏 = 四个输入行 + 四行卡名 ≈ 430px，比左边那张图高一倍，
   整条 flex 行就被右栏顶到 430，图底下空出两百来像素 —— 就是「上下空太大」的来源。
   现在图旁边只放卡名，最高的一条是图本身（184px），底下输入框再摊平排两行。 */
.edit-card-wide { max-width:720px; padding:14px 16px }
.ef-head { display:flex; align-items:baseline; gap:8px; margin-bottom:10px }
.ef-head .edit-title { margin-bottom:0 }
.ef-head-code { flex:1; min-width:0; font-size:12px; color:#0A63C4; font-family:monospace;
                overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.ef-close { font-size:14px; color:#B0B0B5; padding:0 4px }
.ef-body { display:flex; flex-direction:column }
.ef-top { display:flex; gap:14px; align-items:flex-start }
.ef-left { width:132px; flex-shrink:0 }
.ef-names { flex:1; min-width:0; display:flex; flex-direction:column; gap:6px; padding-top:2px }
.edit-card-wide .ef-input { height:38px; padding:9px 10px }
/* 132×184 ≈ 游戏王卡 59:86，缩略图不变形 */
.edit-card-wide .ef-preview { width:132px; height:184px }
/* 能改的那几项：两行摊开，不再一行一个竖着摞 */
.ef-form { display:flex; flex-direction:column; gap:8px; margin-top:12px }
.ef-frow { display:flex; gap:10px }
.ef-fld { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px }
.ef-fld-narrow { flex:0 0 84px }
/* 只读那几行用文本而不是禁用输入框：少三个 38px 高的框，高度能省一半，
   而且长日文名以前在输入框里是横向滚动的、看不全，现在截断显示更直观 */
.ef-ro-line { display:flex; align-items:baseline; gap:8px }
.ef-ro-k { width:42px; flex-shrink:0; font-size:11px; color:#8E8E93 }
.ef-ro-v { flex:1; min-width:0; font-size:13px; color:#333;
           overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.ef-ro-warn { color:#C62828 }
.ef-hint-form { display:block; margin-top:8px }
/* 文件名条：**不画底框** —— 就是裸文字 + 后面紧跟着一个复制按钮。
   字比别处大一号，因为这是要照着它给图片改名的，看错一个字符图就认不出来。
   图源里缺这张图时不换底色（没底色可换），直接把那串字本身变红。 */
.ef-fbar { display:flex; align-items:center; gap:8px; margin-top:10px }
/* 文件名永远是「文字在左、按钮在右」的一行。宽窄只影响字大小和它占多宽，
   **绝不让按钮掉到下一行** —— 窄屏那条规则里曾经写过 `flex:1 1 100%`，
   文件名独占一整行，按钮就被挤下去了，用户一眼就看出不对。 */
.ef-fname { flex:1; min-width:0; font-size:14px; color:#1A1A1A; font-family:monospace;
            line-height:1.4; word-break:break-all }
.ef-fname-miss { color:#C62828 }
.ef-fbtn { flex-shrink:0; padding:5px 10px; background:#EAF3FF; border-radius:7px }
.ef-fbtn-t { font-size:12px; color:#0A63C4; font-weight:500 }
/* 窄屏：图再缩一档，卡名仍紧挨着图右侧（不改成上下摞，摞起来反而更高）。
   输入框允许换行 —— 宽屏那两行在三列并排时手机上挤得看不清。
   ⚠️ 这里必须写 `.edit-card-wide .ef-preview` 全名：上面那条宽屏规则是两段选择器，
   单写 `.ef-preview` 的优先级压不过它，图上尺寸会改不动。 */
@media (max-width:719px) {
  .ef-top { gap:10px }
  .ef-left { width:104px }
  .edit-card-wide .ef-preview { width:104px; height:145px }
  .ef-frow { flex-wrap:wrap }
  .ef-fld { flex:1 1 140px }
  .ef-fld-narrow { flex:0 0 90px }
  .ef-names { gap:5px }
  .ef-ro-v { font-size:12px }
  /* 文件名条在手机上照样是一行：只把字缩一档、按钮收紧一点。
     **不要 flex-wrap，也不要给文件名 flex-basis:100%** —— 那会把按钮顶到下一行，
     而用户要的就是「点.gpg右边就是复制名称」。文件名太长时它自己在格子里折行。 */
  .ef-fbar { gap:6px }
  .ef-fname { font-size:13px }
  .ef-fbtn { padding:5px 8px }
}
.edit-fields { display:flex; flex-direction:column; gap:8px; margin-bottom:14px }
.ef-label { font-size:11px; color:#666; font-weight:500 }
.ef-input { width:100%; padding:12px 10px; border:1px solid #E5E5EA; border-radius:8px; font-size:14px; background:#F5F5F7; box-sizing:border-box; height:44px; line-height:1.4 }
.ef-hint { font-size:11px; color:#8E8E93; line-height:1.5; margin-top:-2px }
/* 「点确认更改**立刻存进数据库**」里那句强调。它是套在提示文字里的行内 <text>，
   所以只能改颜色/字重 —— 加 padding 或 margin 会把那一行撑破。 */
.ef-hint-strong { color:#C62828; font-weight:600 }
/* 编辑弹窗里的卡图预览：改了编号/罕贵/后缀就地能看到找到的那张图。
   高度写死，免得图片加载出来把弹窗高度顶得跳一下。 */
.ef-preview { height:180px; border-radius:10px; background:#F5F5F7; overflow:hidden;
              display:flex; align-items:center; justify-content:center; position:relative }
.ef-preview-img { width:100%; height:100% }
.ef-preview-none { font-size:12px; color:#999; padding:0 16px; text-align:center; line-height:1.6 }
/* 有图的时候整个框可点（点一下全屏放大）。没图时别给手型 —— 那种情况下点了没反应，
   cursor:pointer 会让人以为按钮坏了。
   图上**不带任何角标**（用户明确不要「🔍 放大」那个提示），框本身就是可点区域。 */
.ef-preview-zoom { cursor:pointer }
.edit-btns { display:flex; gap:10px; justify-content:flex-end; margin-top:4px }
.eb-cancel,.eb-save { padding:8px 22px; border-radius:18px; font-size:13px }
.eb-cancel { background:#F0F0F0; color:#666 }
.eb-save { background:#FF0000 }
.eb-text-w { color:#FFF }
/* 弹窗页脚的「🗑 删掉这张卡」。它是次要动作，实心红要留给主按钮「确认更改」，
   所以这里用描边 + 红字；`margin-right:auto` 把它顶到最左边，跟右边那对按钮拉开距离防误点。 */
.eb-del { margin-right:auto; padding:8px 14px; border-radius:18px; border:1px solid #FFCDD2; background:#FFF5F5 }
.eb-del-t { font-size:13px; color:#C62828 }

/* 弹窗 */
.picker-mask { position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:300 }
.picker-popup { position:fixed; top:0; left:0; right:0; z-index:301; background:#FFF; border-radius:0 0 16px 16px; padding:16px; max-height:60vh; overflow-y:auto; box-shadow:0 8px 32px rgba(0,0,0,.12) }
.picker-row { padding:12px 10px; font-size:14px; color:#1A1A1A; border-bottom:1px solid #F0F0F0 }
.picker-row.active { color:#FF0000; font-weight:500 }

/* 响应式：移动默认 */
.card-table-wrap { display:none }
.tile-grid { display:grid }

@media(min-width:600px){
  .pack-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:10px }
}
@media(min-width:900px){
  .card-table-wrap { display:block }
  .tile-grid { display:none !important }
  .pack-grid { grid-template-columns:repeat(3,1fr); gap:10px }
}

/* 网格瓦片（参照 V1.1 卡牌管理） */
.tile-grid {
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 10px;
}
.card-tile {
  background: #FFF;
  border-radius: 10px;
  overflow: hidden;
  padding: 0 0 8px;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0,0,0,.05);
  border-top: 3px solid #E5E5EA;
  border-bottom: 3px solid #E5E5EA;
}
.card-tile:active { transform: scale(.97) }
.ct-thumb {
  width: calc(100% - 10px);
  margin: 5px auto 0;
  aspect-ratio: 5 / 7;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.ct-img { width: 100%; height: 100% }
.ct-name { font-size: 13px; color: #1A1A1A; margin-top: 6px; padding: 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ct-coderow { display: flex; justify-content: flex-start; align-items: center; gap: 8px; margin-top: 3px; padding: 0 8px }
.ct-code { font-size: 11px; color: #666; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ct-rarity { font-size: 11px; font-weight: 600; color: #E53935; flex-shrink: 0 }
.card-tile.img-green { border-top-color: #34C759 }
.card-tile.img-orange { border-top-color: #FF9500 }
.card-tile.img-red { border-top-color: #FF3B30 }
.card-tile.rar-full { border-bottom-color: #34C759 }
.card-tile.rar-missing { border-bottom-color: #FF3B30 }

/* 被「信息登记」过的卡：**实心红底 + 整块翻白**。
   以前是淡红底 #FFE8E8（和上传页 .card-uncollected 同色），用户嫌它不够跳，改成纯红 #FF0000
   （页面主色）。底一变红，原来紧挨着的那些字就全废了 —— 所以**同一个容器里的字必须一起翻白**：
   瓦片里是卡名(近黑)/编号(灰)/罕贵度(红)，表格里是整行八列。
   ⚠️ 未登记的卡一个字都不动：白底、灰编号、红罕贵度。 */
.card-tile.tile-marked { background-color: #FF0000 }
.card-tile.tile-marked .ct-name,
.card-tile.tile-marked .ct-code,
.card-tile.tile-marked .ct-rarity { color: #FFF }

.card-table tbody tr.tr-marked { background-color: #FF0000 }
/* 整行翻白。这几个 class 各自写死了颜色，光改 td 的 color 盖不住，得逐个点出来。 */
.card-table tbody tr.tr-marked td,
.card-table tbody tr.tr-marked .td-code,
.card-table tbody tr.tr-marked .td-en,
.card-table tbody tr.tr-marked .td-rarity { color: #FFF }
/* 编号那格原本有个浅灰底片，压在红底上会糊成一块脏白 —— 换成半透明白 */
.card-table tbody tr.tr-marked .td-code { background: rgba(255,255,255,.18) }
/* 行与行之间的分隔线同理，纯浅灰在红底上基本看不见 */
.card-table tbody tr.tr-marked td { border-bottom-color: rgba(255,255,255,.35) }
/* 「🤖 中文名是 AI 翻的」那个小胶囊，橙底压在红底上也是一片糊 */
.card-table tbody tr.tr-marked .ai-badge { background: rgba(255,255,255,.22); color: #FFF }
/* （V1.2.50 起这张表没有编辑模式了，原来给 .edit-inp 灭火的那条规则一并删掉。） */

.mk-dot { display:inline-block; width:6px; height:6px; border-radius:50%; margin-left:5px; vertical-align:middle }
.mk-exact { background:#FF3B30 }
.mk-norm { background:#FF9500 }
/* 这两个小圆点原本是红/橙，整行翻红之后**红的那个直接消失**（红点压红底）。
   换成白(完全对上) / 浅黄(位数对不上)，两种仍然分得清。 */
.card-table tbody tr.tr-marked .mk-exact { background: #FFF }
.card-table tbody tr.tr-marked .mk-norm { background: #FFD54F }
/* 上方图例原先是白底上的红点/橙点。行里的点现在长在红底上、是白/黄，
   图例再画红/橙就对不上号了 —— 给图例这两个点也铺一圈红当底（box-shadow 撑开，
   不用改模板），让图例和它要解释的东西长得一模一样。 */
.mk-legend .mk-dot { box-shadow: 0 0 0 3px #FF0000 }
.mk-legend .mk-exact { background: #FFF }
.mk-legend .mk-norm { background: #FFD54F }
.mk-legend { display:flex; align-items:center; flex-wrap:wrap; gap:4px; margin-bottom:8px; font-size:11px; color:#888 }
.mk-legend-t { margin-right:10px }
.mk-legend-gap { margin-left:4px }
.left-bar { background:#FFF8E1; border:1px solid #FFE082; border-radius:10px; padding:9px 11px; margin-bottom:10px; display:flex; flex-direction:column; gap:4px }
.left-title { font-size:12px; color:#8D6E00; font-weight:500 }
.left-codes { font-size:11px; color:#A1873A; font-family:monospace; word-break:break-all; line-height:1.5 }
@media(min-width:600px){
  .tile-grid { grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)) }
}

/* 选择图源按钮（topbar 右侧，参考识别上传页右上角：浅灰底+深色字，右移20px留白） */
.src-picker { margin-right: 20px; }
.src-btn {
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: #F0F0F0;
  border-radius: 16px;
  padding: 6px 12px;
  gap: 4px;
}
.src-btn-text { font-size: 12px; color: #1A1A1A; }
.src-arrow { width: 12px; height: 12px; }

/* 保底图源模式：卡牌单个展开 */
.ygopro-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 110px);
  gap: 8px;
  justify-content: center;
}
.ygopro-card {
  background: #FFFFFF;
  border-radius: 8px;
  box-shadow: 0 1px 6px rgba(0,0,0,.04);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 4px 3px;
}
.ygopro-img {
  width: 100px;
  height: 140px;
  border-radius: 4px;
  background: #E8E8ED;
  display: block;
  object-fit: cover;
}
.ygopro-no {
  padding: 3px 0 1px;
  font-size: 10px;
  color: #666;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.ygopro-pager {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.pager-btn {
  width: 32px;
  height: 32px;
  border-radius: 16px;
  background: #F0F0F0;
  color: #666;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pager-btn.active { background: #FF0000; color: #FFF; }
@media(min-width:600px){
  .ygopro-grid { grid-template-columns: repeat(auto-fill, 140px) }
  .ygopro-img { width: 130px; height: 182px; }
}
@media(min-width:900px){
  .ygopro-grid { grid-template-columns: repeat(auto-fill, 150px) }
  .ygopro-img { width: 140px; height: 196px; }
}
</style>
