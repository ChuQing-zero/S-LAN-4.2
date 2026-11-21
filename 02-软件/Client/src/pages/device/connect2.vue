<template>
  <view class="page">
    <!-- ① 工具栏 -->
    <view class="toolbar">
      <view class="tool-btn" @tap="goBack">
        <image class="icon-back" src="/static/icons/ic_back.png" mode="aspectFit"></image>
      </view>
      <text class="tool-title">设备连接2</text>
      <view class="toolbar-right">
        <view class="alarm-indicator">
          <view class="alarm-dot" :class="alarmClass"></view>
          <text class="alarm-text">{{ linkStateText }}</text>
        </view>
        <view class="tool-btn" @tap="showCfg = true">
          <text class="tool-btn-icon">⚙</text>
        </view>
      </view>
    </view>

    <!-- 操作行：测试 / 分拣规则（互斥展开） -->
    <view class="toolbar-actions">
      <view class="tap-btn" :class="{ 'tap-btn-on': showTest }" @tap="togglePanel('test')">
        <text class="tap-btn-text">{{ showTest ? '收起测试' : '测试' }}</text>
      </view>
      <view class="tap-btn" :class="{ 'tap-btn-on': showRules }" @tap="togglePanel('rules')">
        <text class="tap-btn-text">{{ showRules ? '收起规则' : '分拣规则' }}</text>
      </view>
    </view>

    <!-- ② 连接栏 -->
    <view class="connect-bar">
      <input class="bar-input mono" v-model="cfg.espIp" placeholder="192.168.43.100" />
      <input class="bar-input-sm mono" type="number" v-model="cfg.espPort" placeholder="8080" />
      <view class="bar-btn" :class="{ 'bar-btn-red': !wifiOk }" @tap="toggleLink">
        <text class="bar-btn-text">{{ wifiOk ? '断开' : '连接' }}</text>
      </view>
      <view class="bar-btn" @tap="restartWifi">
        <text class="bar-btn-text">重连</text>
      </view>
    </view>

    <!-- ③ 手机画面投屏区 -->
    <view class="body">
    <view class="screen-block">
      <image v-if="frameSrc" class="screen-img" :src="frameSrc" mode="aspectFit" />
      <view v-else class="screen-placeholder">
        <text class="ph-main">暂无画面</text>
        <text class="ph-sub">ADB 投屏待接入（当前为无线链路调试版）</text>
      </view>

      <!-- 上下裁剪遮罩 -->
      <view class="crop-mask" :style="{ height: cfg.cropTop + '%' }"></view>
      <view class="crop-mask crop-mask-bottom" :style="{ height: cfg.cropBottom + '%' }"></view>

      <!-- 日志半透明叠加（绿色字幕，照设备连接） -->
      <view class="log-overlay" v-if="cfg.showLog && logs.length">
        <text class="log-line" v-for="(l, i) in overlayLogs" :key="i">{{ l }}</text>
      </view>
    </view>

    </view>

    <!-- ④ 动作栏 -->
    <view class="action-bar">
      <view class="start-btn" :class="{ 'start-btn-running': mainRunning }" @tap="toggleMain">
        <text class="start-btn-text">{{ mainRunning ? '停止运转' : '开始运转' }}</text>
      </view>
      <view class="auto-toggle">
        <text class="auto-label">{{ mainMode === 'auto' ? '连续' : '单张' }}</text>
        <view class="switch-track" :class="{ 'switch-on': mainMode === 'auto' }" @tap="mainMode = (mainMode === 'auto' ? 'single' : 'auto')">
          <view class="switch-thumb" :class="{ 'thumb-on': mainMode === 'auto' }"></view>
        </view>
      </view>
    </view>

    <!-- ④.2 补光灯 / 电风扇（按键式，同「开始运转」样式） -->
    <view class="device-bar">
      <view class="dev-btn" :class="{ 'dev-btn-on': lampOn }" @tap="toggleLamp">
        <text class="dev-btn-text">补光灯 {{ lampOn ? '开' : '关' }}</text>
      </view>
      <view class="dev-btn" :class="{ 'dev-btn-on': fanOn }" @tap="toggleFan">
        <text class="dev-btn-text">电风扇 {{ fanOn ? '开' : '关' }}</text>
      </view>
    </view>

    <!-- ⑤ 测试（默认收起，点工具栏「测试」展开） -->
    <view class="panel" v-if="showTest">
      <view class="row-between">
        <view class="row-between" style="margin-bottom:8px">
        <text class="panel-title" style="margin:0">测试</text>
        <view class="tap-btn" @tap="copyLogs">
          <text class="tap-btn-text">复制日志</text>
        </view>
      </view>
        <text class="tiny">日志已移到上方画面</text>
      </view>

      <!-- 最近一次操作/回包（页面下方的即时反馈） -->
      <view class="fb-line">
        <text class="fb-label">最近</text>
        <text class="fb-text">{{ lastLog }}</text>
      </view>

      <!-- 5.1 无线链路 -->
      <text class="sub-title">无线链路</text>
      <view class="kv"><text class="k">状态</text><text class="v" :class="wifiOk ? 'ok' : 'bad'">{{ wifiText }}</text></view>
      <view class="kv"><text class="k">地址</text><text class="v mono">{{ addrText }}</text></view>
      <view class="kv"><text class="k">收发</text><text class="v mono">{{ rxCount }} / {{ txCount }}</text></view>
      <view class="kv"><text class="k">重连</text><text class="v mono">{{ reconnects }}</text></view>
      <view class="kv"><text class="k">有线串口</text><text class="v mono">{{ serialText }}</text></view>
      <view class="mode-row">
        <view class="mode-btn" :class="{ 'mode-on': linkMode === 'auto' }"   @tap="setMode('auto')">自动</view>
        <view class="mode-btn" :class="{ 'mode-on': linkMode === 'serial' }" @tap="setMode('serial')">仅 USB</view>
        <view class="mode-btn" :class="{ 'mode-on': linkMode === 'wifi' }"   @tap="setMode('wifi')">仅 WiFi</view>
      </view>
      <view class="err-line" v-if="errText">{{ errText }}</view>

      <!-- 5.2 拍照手机 -->
      <text class="sub-title">拍照手机</text>
      <view class="kv">
        <text class="k">状态</text>
        <view class="alarm-indicator">
          <view class="alarm-dot" :class="phone && phone.online ? 'alarm-green' : 'alarm-red'"></view>
          <text class="alarm-text">{{ phone ? (phone.online ? '在线' : '不在线') : '读取中' }}</text>
        </view>
      </view>
      <view class="kv"><text class="k">型号</text><text class="v mono">{{ (phone && phone.model) || '-' }}</text></view>
      <view class="kv"><text class="k">序列号</text><text class="v mono">{{ (phone && phone.serial) || '-' }}</text></view>
      <view class="kv"><text class="k">端点</text><text class="v mono">{{ (phone && phone.endpoint) || '-' }}</text></view>
      <view class="kv"><text class="k">电量</text><text class="v mono">{{ (phone && phone.battery != null) ? phone.battery + '%' : '-' }}</text></view>
      <view class="kv"><text class="k">状态</text><text class="v">{{ (phone && phone.msg) || '-' }}</text></view>
      <view class="kv" v-if="phone && phone.lastError"><text class="k">错误</text><text class="v bad">{{ phone.lastError }}</text></view>
      <view class="grid">
        <view class="op" @tap="doScanPhone">扫描设备</view>
        <view class="op op-green" @tap="doPairPhone">一键配对（需插线）</view>
        <view class="op op-red" @tap="doDiscPhone">断开</view>
      </view>

      <!-- 最近识别结果 -->
      <view class="fb-line" v-if="identBusy">
        <text class="fb-label">识别中</text>
        <text class="fb-text">第 {{ identTry }} 次尝试…（点「停止识别」可中断）</text>
      </view>
      <view class="fb-line" v-if="identResult">
        <text class="fb-label">识别</text>
        <text class="fb-text">{{ identResult }}</text>
      </view>

      <!-- 5.3.5 八路分拣口：每行一个出口，全部可见可操作 -->
      <text class="sub-title">八路分拣口</text>
      <view class="out-card" v-for="(o, i) in outlets" :key="i">
        <view class="out-line1">
          <text class="out-name">{{ o.name }}</text>
          <text class="out-unit mono">{{ o.addr }}</text>
          <input class="out-num mono" type="number" v-model="o.aMs" placeholder="A" />
          <input class="out-num mono" type="number" v-model="o.bMs" placeholder="B" />
          <view class="sq" @tap="writeOutlet(o, i)">保</view>
          <view class="sq sq-red" @tap="actOutlet(o, i, 'raise')">抬</view>
          <view class="sq sq-gray" @tap="actOutlet(o, i, 'lower')">复</view>
        </view>
        <view class="out-state" v-if="o.state">
          <text class="out-state-text">{{ o.state }}</text>
        </view>
      </view>

      <view class="grid">
        <view class="op" @tap="writeAllOutlets">全部写入</view>
        <view class="op op-red" @tap="lowerAllOutlets">全部复位</view>
        <view class="op" @tap="resetOutlets">恢复默认值</view>
        <view class="op op-green" @tap="saveAllOutlets">存到配置</view>
      </view>
      <text class="tiny" style="display:block;margin-top:8px">
        A/B 是 360° 舵机转动时间(ms)，0=不动、越大抬越高。改完先点「写入」再点「A抬/B抬」；每行下方会显示该单元限位与抬升计数。
      </text>

      <!-- 5.3 挡片角度 + 自定义指令 -->
      <text class="sub-title">挡片角度</text>
      <view class="in-row">
        <input class="in-box mono" type="number" v-model="gateDeg" placeholder="0~180" />
        <view class="in-btn in-btn-red" @tap="setGateAngle">转到该角度</view>
      </view>
      <view class="in-row" v-if="identBusy">
        <view class="in-btn" style="flex:1;background-color:#FF3B30;color:#FFFFFF" @tap="stopIdentify">停止识别</view>
      </view>
      <view class="in-row">
        <input class="in-box mono" v-model="customCmd" placeholder="任意指令，如 Q,ldr 或 K,0x10,on" @confirm="sendCustom" />
        <view class="in-btn" @tap="sendCustom">发送</view>
      </view>

      <text class="sub-title">快捷指令</text>
      <view class="grid">
        <view class="op" v-for="(c, i) in quickCmds" :key="i"
              :class="{ 'op-red': c.cmd === 's' && feedOn }"
              @tap="sendCmd(c.cmd)">{{ c.cmd === 's' ? (feedOn ? '进料中·点停' : '进料 开/停') : c.label }}</view>
      </view>

      <!-- 皮带转速（识别单元）-->
      <view class="row-between" style="margin:8px 0 6px">
        <text class="sub-title" style="margin:0">皮带转速（识别单元）</text>
        <text class="tiny">默认 255，设速度会同时启动皮带</text>
      </view>
      <view class="kv">
        <text class="k">当前已设</text>
        <text class="v mono">{{ beltPwmSet != null ? beltPwmSet : 255 }}</text>
      </view>
      <view class="in-row">
        <text class="in-tag">转速</text>
        <input class="in-box mono" type="number" v-model="beltPwmIn" placeholder="255" />
        <view class="op op-green" style="flex:1" @tap="doSetBeltPwm">设转速</view>
      </view>
      <view class="grid">
        <view class="op" @tap="doBeltPwmQuick(100)">100</view>
        <view class="op" @tap="doBeltPwmQuick(150)">150</view>
        <view class="op" @tap="doBeltPwmQuick(180)">180</view>
        <view class="op" @tap="doBeltPwmQuick(255)">255</view>
        <view class="op op-red" @tap="sendCmd('K,0x10,off')">停皮带</view>
      </view>

      <!-- 5.4 六路光敏（原测试3） -->
      <text class="sub-title">六路光敏</text>
      <view class="led-grid">
        <view class="led-cell" v-for="(c, i) in ldrCh" :key="i" :class="c.card ? 'led-on' : 'led-off'">
          <view class="led-dot" :class="c.card ? 'led-dot-on' : 'led-dot-off'"></view>
          <text class="led-name">{{ c.name }}</text>
          <text class="led-val">{{ c.ok ? c.val : '-' }}</text>
        </view>
      </view>
      <!-- 每路阈值输入 -->
      <view class="th-row">
        <text class="th-tag">阈值</text>
        <view class="th-cell" v-for="nm in ['0x10','0x20','0x21','0x22','0x23','A7']" :key="nm">
          <input class="th-num mono" type="number" v-model="thVals[nm]" />
          <text class="th-name">{{ nm }}</text>
        </view>
      </view>
      <view class="kv"><text class="k">亮态基线</text><text class="v mono">{{ ldr && ldr.baseReady ? '已学' : '未学' }}</text></view>
      <view class="kv"><text class="k">单次往返</text><text class="v mono">{{ latText('last') }}</text></view>
      <view class="kv"><text class="k">采集状态</text><text class="v" :class="ldrRunning ? 'ok' : ''">{{ ldrRunning ? ('连续采集中 ' + ldr.intervalMs + 'ms') : '停止' }}</text></view>
      <view class="grid">
        <view class="op op-green" @tap="doSampleAll">整体采样</view>
        <view class="op" @tap="doSaveThresholds">保存阈值</view>
        <view class="op" @tap="doReadOnce">读一次</view>
        <view class="op" @tap="toggleLdr">{{ ldrRunning ? '停止连续' : '连续采集' }}</view>
      </view>

      <!-- 5.5 测试2 · 送料时序 -->
      <text class="sub-title">测试2 · 送料时序</text>
      <view class="row-between" style="margin-bottom:6px">
        <text class="tiny">挡片 90°→120° · 皮带全速 · 光敏判到位</text>
        <view class="alarm-indicator">
          <view class="alarm-dot" :class="seqRunning ? 'alarm-green' : 'alarm-red'"></view>
          <text class="alarm-text">{{ seqRunning ? '运行中' : '空闲' }}</text>
        </view>
      </view>
      <view class="kv" v-if="seq"><text class="k">当前步骤</text><text class="v">{{ seq.step || '-' }}</text></view>
      <view class="kv" v-if="seq"><text class="k">光敏</text><text class="v mono">{{ seq.ldr != null ? seq.ldr + '%' : '-' }}</text></view>
      <view class="kv" v-if="seq && seq.result && seq.result.waitCardMs != null">
        <text class="k">皮带启动→识别到光敏</text>
        <text class="v mono">{{ seq.result.waitCardMs }} ms</text>
      </view>
      <view class="kv" v-if="seq && seq.result && seq.result.runAfterDetectMs != null">
        <text class="k">识别到光敏→停皮带</text>
        <text class="v mono">{{ seq.result.runAfterDetectMs }} ms</text>
      </view>
      <view class="kv" v-if="seq && seq.result && seq.result.totalBeltMs != null">
        <text class="k">皮带总共运行</text>
        <text class="v mono">{{ seq.result.totalBeltMs }} ms</text>
      </view>
      <view class="kv" v-if="seq && seq.result && seq.result.cardDetected === false">
        <text class="k">结果</text><text class="v bad">等光敏超时，未识别到卡</text>
      </view>
      <view class="grid">
        <view class="op op-green" @tap="runSeq2">开始</view>
        <view class="op op-red" @tap="stopSeq2">停止</view>
        <view class="op" @tap="measureLdr">测光敏10秒</view>
        <view class="op" @tap="clearSeq">清日志</view>
      </view>

      <!-- 调试1：半速到光敏停 -->
      <text class="sub-title">调试1 · 半速到光敏停</text>
      <view class="row-between" style="margin-bottom:6px">
        <text class="tiny">进料电机按 PWM 转，指定光敏被遮挡即停</text>
        <view class="alarm-indicator">
          <view class="alarm-dot" :class="spRunning ? 'alarm-green' : 'alarm-red'"></view>
          <text class="alarm-text">{{ spRunning ? '运行中' : '空闲' }}</text>
        </view>
      </view>
      <view class="in-row">
        <text class="in-tag">光敏</text>
        <view class="out-chip" v-for="c in ['0x10','0x20','0x21','0x22','0x23','A7']" :key="c"
              :class="{ 'out-chip-on': spChannel === c }" @tap="spChannel = c">
          <text class="out-chip-text">{{ c }}</text>
        </view>
      </view>
      <view class="in-row">
        <text class="in-tag">PWM</text>
        <input class="in-box mono" type="number" v-model="spPwm" placeholder="150" />
        <text class="in-tag">间隔ms</text>
        <input class="in-box mono" type="number" v-model="spInterval" placeholder="120" />
      </view>
      <view class="in-row">
        <text class="in-tag">检测后延时</text>
        <input class="in-box mono" type="number" v-model="spDelay" placeholder="0" />
        <text class="in-tag">ms（0=立刻断电）</text>
      </view>
      <view class="kv" v-if="speed"><text class="k">当前步骤</text><text class="v">{{ speed.step || '-' }}</text></view>
      <view class="kv" v-if="speed">
        <text class="k">基线 / 阈值</text>
        <text class="v mono">{{ speed.base != null ? speed.base : '-' }} / {{ speed.th != null ? speed.th : '-' }}</text>
      </view>
      <view class="kv" v-if="speed"><text class="k">当前读数</text><text class="v mono">{{ speed.cur != null ? speed.cur : '-' }}</text></view>
      <view class="kv" v-if="speed && speed.result && speed.result.startToDetectMs != null">
        <text class="k">电机启动→检测到</text><text class="v mono">{{ speed.result.startToDetectMs }} ms</text>
      </view>
      <view class="kv"><text class="k">延时设定</text><text class="v mono">{{ spDelay }} ms</text></view>
      <view class="kv" v-if="speed && speed.result && speed.result.detectToCmdMs != null">
        <text class="k">检测到→发停指令</text><text class="v mono">{{ speed.result.detectToCmdMs }} ms</text>
      </view>
      <view class="kv" v-if="speed && speed.result && speed.result.detectToAckMs != null">
        <text class="k">检测到→停带回包</text><text class="v mono">{{ speed.result.detectToAckMs }} ms</text>
      </view>
      <view class="kv" v-if="speed && speed.result && speed.result.detected === false">
        <text class="k">结果</text><text class="v bad">超时未检测到遮挡</text>
      </view>
      <view class="grid">
        <view class="op op-green" @tap="runSpeed">开始</view>
        <view class="op op-red" @tap="stopSpeed">停止</view>
        <view class="op" @tap="clearSpeed">清结果</view>
      </view>

      <!-- 调试2：半速 · 先遮后亮再停 -->
      <text class="sub-title">调试2 · 遮住→变亮→停</text>
      <view class="row-between" style="margin-bottom:6px">
        <text class="tiny">皮带半速转，光敏先被遮住、再重新变亮（卡完全通过）才停</text>
        <view class="alarm-indicator">
          <view class="alarm-dot" :class="sp2Running ? 'alarm-green' : 'alarm-red'"></view>
          <text class="alarm-text">{{ sp2Running ? '运行中' : '空闲' }}</text>
        </view>
      </view>
      <view class="in-row">
        <text class="in-tag">光敏</text>
        <view class="out-chip" v-for="c in ['0x10','0x20','0x21','0x22','0x23','A7']" :key="c"
              :class="{ 'out-chip-on': sp2Channel === c }" @tap="sp2Channel = c">
          <text class="out-chip-text">{{ c }}</text>
        </view>
      </view>
      <view class="in-row">
        <text class="in-tag">PWM</text>
        <input class="in-box mono" type="number" v-model="sp2Pwm" placeholder="150" />
        <text class="in-tag">间隔ms</text>
        <input class="in-box mono" type="number" v-model="sp2Interval" placeholder="120" />
      </view>
      <view class="in-row">
        <text class="in-tag">变亮后延时</text>
        <input class="in-box mono" type="number" v-model="sp2Delay" placeholder="120" />
        <text class="in-tag">ms（0=立刻断电）</text>
      </view>
      <view class="kv" v-if="speed2"><text class="k">当前步骤</text><text class="v">{{ speed2.step || '-' }}</text></view>
      <view class="kv" v-if="speed2">
        <text class="k">基线 / 遮住阈值 / 变亮阈值</text>
        <text class="v mono">{{ speed2.base != null ? speed2.base : '-' }} / {{ speed2.th != null ? speed2.th : '-' }} / {{ speed2.base != null ? Math.round(speed2.base * 0.9) : '-' }}</text>
      </view>
      <view class="kv" v-if="speed2"><text class="k">当前读数</text><text class="v mono">{{ speed2.cur != null ? speed2.cur : '-' }}</text></view>
      <view class="kv" v-if="speed2 && speed2.result && speed2.result.startToDetectMs != null">
        <text class="k">皮带启动→遮住</text><text class="v mono">{{ speed2.result.startToDetectMs }} ms</text>
      </view>
      <view class="kv" v-if="speed2 && speed2.result && speed2.result.passOk === false">
        <text class="k">结果</text><text class="v bad">遮住后一直没变亮（超时）</text>
      </view>
      <view class="kv"><text class="k">延时设定</text><text class="v mono">{{ sp2Delay }} ms</text></view>
      <view class="kv" v-if="speed2 && speed2.result && speed2.result.detectToCmdMs != null">
        <text class="k">变亮→发停指令</text><text class="v mono">{{ speed2.result.detectToCmdMs }} ms</text>
      </view>
      <view class="kv" v-if="speed2 && speed2.result && speed2.result.detectToAckMs != null">
        <text class="k">变亮→停带回包</text><text class="v mono">{{ speed2.result.detectToAckMs }} ms</text>
      </view>
      <view class="grid">
        <view class="op op-green" @tap="runSpeed2">开始</view>
        <view class="op op-red" @tap="stopSpeed2">停止</view>
        <view class="op" @tap="clearSpeed2">清结果</view>
      </view>

      <!-- 调试3：料仓缺卡自动停料 -->
      <text class="sub-title">调试3 · 料仓缺卡自动停料</text>
      <view class="row-between" style="margin-bottom:6px">
        <text class="tiny">有卡就进料，缺卡（露光变亮）自动停进料</text>
        <view class="alarm-indicator">
          <view class="alarm-dot" :class="faRunning ? 'alarm-green' : 'alarm-red'"></view>
          <text class="alarm-text">{{ faRunning ? '监测中' : '空闲' }}</text>
        </view>
      </view>
      <view class="in-row">
        <text class="in-tag">光敏</text>
        <view class="out-chip" v-for="c in ['A7','0x10','0x20','0x21','0x22','0x23']" :key="c"
              :class="{ 'out-chip-on': faChannel === c }" @tap="faChannel = c">
          <text class="out-chip-text">{{ c }}</text>
        </view>
      </view>
      <view class="in-row">
        <text class="in-tag">缺卡阈值</text>
        <input class="in-box mono" type="number" v-model="faTh" placeholder="300" />
        <text class="in-tag">低于=有卡，高于=空仓</text>
      </view>
      <view class="kv" v-if="feedAuto"><text class="k">当前读数</text><text class="v mono">{{ feedAuto.cur != null ? feedAuto.cur : '-' }}</text></view>
      <view class="kv" v-if="feedAuto">
        <text class="k">料仓状态</text>
        <text class="v" :class="feedAuto.hasCard ? 'ok' : 'bad'">{{ feedAuto.hasCard == null ? '-' : (feedAuto.hasCard ? '有卡' : '空仓') }}</text>
      </view>
      <view class="kv" v-if="feedAuto">
        <text class="k">进料电机</text>
        <text class="v" :class="feedAuto.feeding ? 'ok' : ''">{{ feedAuto.feeding ? '运转中' : '停止' }}</text>
      </view>
      <view class="kv" v-if="feedAuto"><text class="k">切换次数</text><text class="v mono">{{ feedAuto.count }}</text></view>
      <view class="grid">
        <view class="op op-green" @tap="runFeedAuto">开始监测</view>
        <view class="op op-red" @tap="stopFeedAuto">停止</view>
        <view class="op" @tap="clearFeedAuto">清统计</view>
      </view>

      <!-- 5.5 测试4 · 卡牌进料 -->
      <text class="sub-title">测试4 · 卡牌进料</text>
      <view class="row-between" style="margin-bottom:6px">
        <text class="tiny">闭环：卡牌遮住光敏即停，转速与阈值都可设</text>
        <view class="alarm-indicator">
          <view class="alarm-dot" :class="feedOn ? 'alarm-green' : 'alarm-red'"></view>
          <text class="alarm-text">{{ feedOn ? '进料中' : '空闲' }}</text>
        </view>
      </view>
      <view class="kv">
        <text class="k">当前光敏</text>
        <text class="v mono">{{ pushLdr != null ? pushLdr : '-' }}</text>
      </view>
      <view class="kv">
        <text class="k">当前阈值</text>
        <text class="v mono">{{ pushTh != null ? pushTh : '-' }}</text>
      </view>
      <view class="kv">
        <text class="k">当前转速 PWM</text>
        <text class="v mono">{{ pushPwm != null ? pushPwm : '-' }}</text>
      </view>
      <view class="kv">
        <text class="k">推卡计数</text>
        <text class="v mono">{{ pushCount != null ? pushCount : '-' }}</text>
      </view>
      <view class="in-row">
        <text class="in-tag">阈值</text>
        <input class="in-box mono" type="number" v-model="pushThIn" placeholder="100" />
        <view class="op op-green" style="flex:1" @tap="doSetPushTh">设阈值</view>
      </view>
      <view class="in-row">
        <text class="in-tag">转速</text>
        <input class="in-box mono" type="number" v-model="pushPwmIn" placeholder="200" />
        <view class="op op-green" style="flex:1" @tap="doSetPushPwm">设转速</view>
      </view>
      <view class="grid">
        <view class="op" @tap="doReadPush">读光敏</view>
        <view class="op op-green" @tap="sendCmd('c')">单张进料</view>
        <view class="op" :class="{ 'op-red': feedOn }" @tap="sendCmd('s')">{{ feedOn ? '连续中·点停' : '连续进料' }}</view>
        <view class="op op-red" @tap="doStopFeed">停进料</view>
      </view>
      <text class="sub-title">主流程 · 开始运转</text>
      <view class="kv"><text class="k">运行状态</text><text class="v" :class="mainRunning ? 'ok' : ''">{{ mainRunning ? '运转中' : '空闲' }}</text></view>
      <view class="kv"><text class="k">当前步骤</text><text class="v">{{ mainState.step || '-' }}</text></view>
      <view class="kv"><text class="k">已完成张数</text><text class="v mono">{{ mainState.cardNo || 0 }}</text></view>
      <view class="kv" v-if="mainState.last && mainState.last.why"><text class="k">上一张</text><text class="v">{{ mainState.last.why }}</text></view>
      <view class="in-row">
        <text class="in-tag">拍照前等待</text>
        <input class="in-box mono" type="number" v-model="waitPhoto" placeholder="500" />
        <text class="in-tag">ms</text>
      </view>
      <view class="in-row">
        <text class="in-tag">识别停带延时</text>
        <input class="in-box mono" type="number" v-model="waitIdentStop" placeholder="500" />
        <text class="in-tag">ms</text>
      </view>
      <view class="in-row">
        <text class="in-tag">拍照位停带延时</text>
        <input class="in-box mono" type="number" v-model="waitPhotoStop" placeholder="0" />
        <text class="in-tag">ms（第二次停）</text>
      </view>
      <view class="in-row">
        <text class="in-tag">分拣口停带延时</text>
        <input class="in-box mono" type="number" v-model="waitSortLocal" placeholder="500" />
        <text class="in-tag">ms（卡到口再走）</text>
      </view>
      <view class="chips">
        <view class="chip" v-for="v in SORT_DELAY_PRESETS" :key="'sd' + v" @tap="setSortDelay(v)">
          <text class="chip-text">{{ v }}</text>
        </view>
        <text class="chip-note">一键设分拣口延时（ms）</text>
      </view>
      <view class="in-row">
        <text class="in-tag">抬升后等待</text>
        <input class="in-box mono" type="number" v-model="waitRaiseHold" placeholder="1000" />
        <text class="in-tag">ms（再下降）</text>
      </view>
      <view class="in-row">
        <text class="in-tag">变亮确认</text>
        <input class="in-box mono" type="number" v-model="waitLightConfirm" placeholder="500" />
        <text class="in-tag">ms（防抖动）</text>
      </view>
      <view class="in-row">
        <text class="in-tag">挡片放行后等待</text>
        <input class="in-box mono" type="number" v-model="waitGate" placeholder="500" />
        <text class="in-tag">ms</text>
      </view>
      <view class="in-row">
        <text class="in-tag">兜底传送</text>
        <input class="in-box mono" type="number" v-model="waitFallback" placeholder="30000" />
        <text class="in-tag">ms</text>
      </view>
      <view class="in-row">
        <text class="in-tag">运转模式</text>
        <view class="out-chip" :class="{ 'out-chip-on': mainMode === 'single' }" @tap="mainMode = 'single'">
          <text class="out-chip-text">单张</text>
        </view>
        <view class="out-chip" :class="{ 'out-chip-on': mainMode === 'auto' }" @tap="mainMode = 'auto'">
          <text class="out-chip-text">连续</text>
        </view>
      </view>
      <text class="sub-title">流程开关（点一下切换）</text>
      <view class="grid2">
        <view class="op" :class="{ 'op-red': optCalib }" @tap="toggleOpt('calib')">
          {{ optCalib ? '启动校准 · 开' : '启动校准 · 关' }}
        </view>
        <view class="op" :class="{ 'op-red': optFocus }" @tap="toggleOpt('focus')">
          {{ optFocus ? '拍照对焦 · 开' : '拍照对焦 · 关' }}
        </view>
        <view class="op" :class="{ 'op-red': optPauseFrame }" @tap="toggleOpt('frame')">
          {{ optPauseFrame ? '拍照停投屏 · 开' : '拍照停投屏 · 关' }}
        </view>
        <view class="op" :class="{ 'op-red': optLocalStop }" @tap="toggleOpt('local')">
          {{ optLocalStop ? '分拣口本地停带 · 开' : '分拣口本地停带 · 关' }}
        </view>
      </view>
      <view class="grid">
        <view class="op" @tap="doSaveWaits">保存等待时间</view>
        <view class="op op-green" @tap="startMain">开始运转</view>
        <view class="op op-red" @tap="stopMain">停止运转</view>
        <view class="op" @tap="copyLogs">一键复制日志</view>
      </view>
    </view>

    <!-- ⑤b 分拣规则（与测试互斥展开） -->
    <view class="panel" v-if="showRules">
      <view class="row-between" style="margin-bottom:8px">
        <text class="panel-title" style="margin:0">分拣规则</text>
        <picker mode="selector" :range="RULE_SETS" :value="ruleSet - 1" @change="onRuleSetChange">
          <view class="rule-select">
            <text class="rule-select-text">{{ RULE_SETS[ruleSet - 1] }}</text>
            <text class="rule-select-arrow">▾</text>
          </view>
        </picker>
      </view>

      <view class="kv"><text class="k">当前规则集</text><text class="v">分拣规则{{ ruleSet }}</text></view>

      <text class="sub-title">识别方式</text>
      <view class="in-row">
        <view class="out-chip" v-for="m in IDENT_MODES" :key="m"
              :class="{ 'out-chip-on': identMode === m }" @tap="identMode = m">
          <text class="out-chip-text">{{ m }}</text>
        </view>
      </view>
      <view class="in-row" v-if="identMode === '图像识别'">
        <text class="in-tag">AI关键词</text>
        <input class="in-box mono" v-model="aiKeyword" placeholder="例如 星数/属性/卡名" />
      </view>

      <text class="sub-title">每条规则决定该出口收哪些卡</text>
      <view class="kv"><text class="k">规则类型</text><text class="v">点类型可切换</text></view>

      <view v-for="(r, i) in sortRules" :key="i">
        <!-- 第 9 条：未识别 → 皮带送走，固定不可编辑 -->
        <view class="rule-row rule-row-fixed" v-if="r.fixed">
          <text class="rule-name">{{ r.name }}</text>
          <view class="rule-type rule-type-fixed"><text class="rule-type-text">兜底</text></view>
          <text class="rule-fixed-text">没识别到 → 皮带送走，不做舵机动作</text>
        </view>
        <view class="rule-row" v-else>
          <text class="rule-name">{{ r.name }}{{ r.side }}</text>
          <view class="rule-type" @tap="cycleRuleType(i)">
            <text class="rule-type-text">{{ RULE_TYPES[r.type] }}</text>
          </view>
          <input class="rule-input mono" v-model="r.value" :placeholder="ruleHint(r)" />
        </view>
        <view class="rule-row rule-row2" v-if="r.type2">
          <text class="rule-name">且</text>
          <view class="rule-type" @tap="cycleRuleType2(i)">
            <text class="rule-type-text">{{ RULE_TYPES[r.type2] }}</text>
          </view>
          <input class="rule-input mono" v-model="r.value2" placeholder="例如 >=5 或 魔法卡" />
          <view class="rule-del" @tap="clearCond2(i)"><text class="rule-del-text">×</text></view>
        </view>
        <view class="rule-add" v-else @tap="addCond2(i)">
          <text class="rule-add-text">＋ 加第二条件（且）</text>
        </view>
      </view>

      <view class="grid">
        <view class="op op-green" @tap="saveSortRules">保存规则</view>
        <view class="op" @tap="clearSortRules">清空规则</view>
        <view class="op" @tap="defaultSortRules">恢复默认</view>
      </view>

      <text class="sub-title">图像识别测试</text>
      <view class="kv"><text class="k">提问</text><text class="v">{{ aiQuestion }}</text></view>
      <view class="kv" v-if="aiAnswer"><text class="k">AI回答</text><text class="v">{{ aiAnswer }}</text></view>
      <view class="kv" v-if="aiMs"><text class="k">耗时</text><text class="v mono">{{ aiMs }} ms</text></view>
      <view class="grid">
        <view class="op op-green" @tap="doVisionTest">拍照并识别</view>
        <view class="op" @tap="cycleAiQuestion">换问题</view>
      </view>

      <text class="sub-title">规则说明</text>
      <view class="kv"><text class="k">前缀</text><text class="v">编号以该串开头</text></view>
      <view class="kv"><text class="k">精确</text><text class="v">编号完全相等</text></view>
      <view class="kv"><text class="k">关键字</text><text class="v">卡名或编号包含该串</text></view>
      <view class="kv"><text class="k">兜底</text><text class="v">前面都不匹配时进这个口</text></view>
    </view>

    <!-- ⑨ 设置弹窗 -->
    <view class="modal-overlay" v-if="showCfg" @tap="showCfg = false">
      <view class="modal-box" @tap.stop>
        <text class="modal-title">设备设置</text>

        <view class="cfg-row">
          <text class="cfg-label">ESP IP</text>
          <input class="cfg-input mono" v-model="cfg.espIp" />
        </view>
        <view class="cfg-row">
          <text class="cfg-label">端口</text>
          <input class="cfg-input mono" type="number" v-model="cfg.espPort" />
        </view>
        <view class="cfg-row">
          <text class="cfg-label">画面刷新(秒)</text>
          <input class="cfg-input mono" type="number" v-model="cfg.refresh" />
        </view>
        <view class="cfg-row">
          <text class="cfg-label">上边框裁剪%</text>
          <input class="cfg-input mono" type="number" v-model="cfg.cropTop" />
        </view>
        <view class="cfg-row">
          <text class="cfg-label">下边框裁剪%</text>
          <input class="cfg-input mono" type="number" v-model="cfg.cropBottom" />
        </view>
        <view class="cfg-row">
          <text class="cfg-label">串口日志显示</text>
          <view class="switch-track" :class="{ 'switch-on': cfg.showLog }" @tap="cfg.showLog = !cfg.showLog">
            <view class="switch-thumb" :class="{ 'thumb-on': cfg.showLog }"></view>
          </view>
        </view>
        <view class="cfg-row">
          <text class="cfg-label">投屏来源</text>
          <text class="cfg-value">ADB（待接入）</text>
        </view>

        <view class="modal-actions">
          <view class="modal-btn modal-btn-cancel" @tap="showCfg = false">取消</view>
          <view class="modal-btn modal-btn-ok" @tap="saveCfg">保存</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import {
  getDeviceStatus, getDeviceFrameUrl, deviceHardware,
  deviceAutoStart, deviceAutoStop, getDeviceLink, setDeviceLink,
  getPhoneStatus, phoneDiscover, phonePairUsb, phoneDisconnect,
  seqStatus, seqStart, seqStop, seqClear,
  ldrStatus, ldrStart, ldrStop, ldrClear, ldrOnce,
  saveOutlets,
  speedStatus, speedStart, speedStop, speedClear,
  getLdrThresholds, saveLdrThresholds,
  feedAutoStatus, feedAutoStart, feedAutoStop,
  visionPhoto, visionQa,
  mainStart, mainStop, mainStatus, getRules, saveRules,
  saveDeviceConfig
} from '@/api/index.js'

const link = ref(null)
const logs = ref([])
const serialInfo = ref('')
const showCfg = ref(false)
const mainRunning = ref(false)
const mainMode = ref('auto')          // auto=连续，single=单张一张
const mainState = ref({})
const waitPhoto = ref(500)
const waitIdentStop = ref(500)
const waitFallback = ref(30000)
const waitGate = ref(500)
const waitLightConfirm = ref(500)
const waitRaiseHold = ref(1000)
const waitSortLocal = ref(500)
const SORT_DELAY_PRESETS = [120, 200, 300, 500, 700, 1000]
const optCalib = ref(true)        // START_CALIB
const optFocus = ref(true)        // FOCUS_TAP
const optPauseFrame = ref(true)   // PAUSE_FRAME_ON_PHOTO
const optLocalStop = ref(true)    // SORT_LOCAL_STOP
const waitPhotoStop = ref(0)
let mainTimer = null

async function pollMain () {
  try {
    const r = await mainStatus()
    if (r) {
      mainState.value = r
      mainRunning.value = !!r.running
    }
  } catch (e) { /* 忽略 */ }
}

function startMainPoll () {
  if (mainTimer) clearInterval(mainTimer)
  mainTimer = setInterval(pollMain, 800)
  pollMain()
}

async function toggleMain () {
  if (mainRunning.value) await stopMain()
  else await startMain()
}

async function startMain () {
  try {
    addLog('【主流程】开始运转（' + (mainMode.value === 'auto' ? '连续' : '单张') + '）')
    const r = await mainStart({ mode: mainMode.value })
    if (r && r.ok) { mainRunning.value = true; startMainPoll() }
    else addLog('【主流程】启动失败：' + ((r && r.msg) || ''))
  } catch (e) {
    addLog('【主流程】启动失败：' + (e && e.message ? e.message : e))
  }
}

async function stopMain () {
  try {
    addLog('【主流程】请求停止')
    await mainStop()
    mainRunning.value = false
  } catch (e) { addLog('【主流程】停止失败：' + (e && e.message ? e.message : e)) }
}

function setSortDelay (v) {
  waitSortLocal.value = v
  addLog('【主流程】分拣口停带延时已设为 ' + v + ' ms，点「保存等待时间」生效')
}

async function loadWaits () {
  try {
    const r = await getDeviceConfig()
    const d = (r && (r.config || r.data || r)) || {}
    const num = (v, fb) => { const n = parseInt(v, 10); return isNaN(n) ? fb : n }
    if (d.PHOTO_WAIT_MS !== undefined) waitPhoto.value = num(d.PHOTO_WAIT_MS, 500)
    if (d.IDENT_STOP_DELAY_MS !== undefined) waitIdentStop.value = num(d.IDENT_STOP_DELAY_MS, 500)
    if (d.PHOTO_STOP_DELAY_MS !== undefined) waitPhotoStop.value = num(d.PHOTO_STOP_DELAY_MS, 0)
    if (d.SORT_RAISE_HOLD_MS !== undefined) waitRaiseHold.value = num(d.SORT_RAISE_HOLD_MS, 1000)
    if (d.LIGHT_CONFIRM_MS !== undefined) waitLightConfirm.value = num(d.LIGHT_CONFIRM_MS, 500)
    if (d.GATE_TO_BELT_MS !== undefined) waitGate.value = num(d.GATE_TO_BELT_MS, 500)
    if (d.SORT_FALLBACK_MS !== undefined) waitFallback.value = num(d.SORT_FALLBACK_MS, 30000)
    if (d.SORT_LOCAL_DELAY_MS !== undefined) waitSortLocal.value = num(d.SORT_LOCAL_DELAY_MS, 500)
    if (d.START_CALIB !== undefined) optCalib.value = !!d.START_CALIB && d.START_CALIB !== 'False'
    if (d.FOCUS_TAP !== undefined) optFocus.value = !!d.FOCUS_TAP && d.FOCUS_TAP !== 'False'
    if (d.PAUSE_FRAME_ON_PHOTO !== undefined && d.PAUSE_FRAME_ON_PHOTO !== null) {
      optPauseFrame.value = (d.PAUSE_FRAME_ON_PHOTO === true || d.PAUSE_FRAME_ON_PHOTO === 'True' || d.PAUSE_FRAME_ON_PHOTO === 1)
    }
    if (d.SORT_LOCAL_STOP !== undefined) optLocalStop.value = !!d.SORT_LOCAL_STOP && d.SORT_LOCAL_STOP !== 'False' 
  } catch (e) { /* 静默，用默认值 */ }
}

function toggleOpt (kind) {
  if (kind === 'calib') optCalib.value = !optCalib.value
  if (kind === 'focus') optFocus.value = !optFocus.value
  if (kind === 'frame') optPauseFrame.value = !optPauseFrame.value
  if (kind === 'local') optLocalStop.value = !optLocalStop.value
  addLog('【开关】' + OPT_NAMES[kind] + ' → ' + (optValue(kind) ? '开' : '关') + '，点「保存等待时间」生效')
}

const OPT_NAMES = { calib: '启动校准', focus: '拍照前对焦', frame: '拍照期间暂停投屏', local: '分拣口本地停带' }
function optValue (kind) {
  return kind === 'calib' ? optCalib.value : kind === 'focus' ? optFocus.value
       : kind === 'frame' ? optPauseFrame.value : optLocalStop.value
}

async function doSaveOpts () {
  try {
    const r = await saveDeviceConfig({
      START_CALIB: !!optCalib.value,
      FOCUS_TAP: !!optFocus.value,
      PAUSE_FRAME_ON_PHOTO: !!optPauseFrame.value,
      SORT_LOCAL_STOP: !!optLocalStop.value
    })
    addLog(r && r.ok ? '【开关】已保存' : '【开关】保存失败')
  } catch (e) { addLog('【开关】保存失败：' + (e && e.message ? e.message : e)) }
}

async function doSaveWaits () {
  try {
    const r = await saveDeviceConfig({
      PHOTO_WAIT_MS: parseInt(waitPhoto.value, 10) || 500,
      IDENT_STOP_DELAY_MS: parseInt(waitIdentStop.value, 10) || 500,
      SORT_FALLBACK_MS: parseInt(waitFallback.value, 10) || 30000,
      GATE_TO_BELT_MS: parseInt(waitGate.value, 10) || 500,
      LIGHT_CONFIRM_MS: parseInt(waitLightConfirm.value, 10) || 500,
      SORT_RAISE_HOLD_MS: parseInt(waitRaiseHold.value, 10) || 1000,
      PHOTO_STOP_DELAY_MS: (isNaN(parseInt(waitPhotoStop.value, 10)) ? 0 : parseInt(waitPhotoStop.value, 10)),
      SORT_LOCAL_DELAY_MS: parseInt(waitSortLocal.value, 10) || 500
    })
    addLog(r && r.ok ? '【主流程】等待时间已保存' : '【主流程】保存失败')
  } catch (e) { addLog('【主流程】保存失败：' + (e && e.message ? e.message : e)) }
}

const showTest = ref(true)      // 测试面板是否展开
const showRules = ref(false)    // 分拣规则面板是否展开

/* 两个面板互斥：打开一个就收起另一个，再点自己就收起 */
function togglePanel (kind) {
  if (kind === 'test') {
    const next = !showTest.value
    showTest.value = next
    if (next) showRules.value = false
  } else {
    const next = !showRules.value
    showRules.value = next
    if (next) showTest.value = false
  }
}

/* 分拣规则：8 个出口，规则类型循环切换 */
const RULE_TYPES = ['前缀', '精确', '关键字', '兜底']
const IDENT_MODES = ['图像识别', 'NFC识别', '条形码识别']

const RULE_SETS = ['分拣规则1', '分拣规则2']
const ruleSet = ref(1)          // 当前编辑哪套规则（1 / 2）

function onRuleSetChange (e) {
  const idx = parseInt(e.detail.value, 10)
  ruleSet.value = (isNaN(idx) ? 0 : idx) + 1
}
const identMode = ref('图像识别')
const aiKeyword = ref('')
const aiAnswer = ref('')
const aiMs = ref(0)

const AI_QUESTIONS = [
  '这张卡牌是怪兽卡、魔法卡还是陷阱卡？',
  '这张卡牌有几颗星？',
  '这张卡牌的卡名和属性是什么？',
  '这张卡牌是什么颜色边框（黄/蓝/紫/绿/红）？'
]
const aiQIndex = ref(0)
const aiQuestion = computed(() => AI_QUESTIONS[aiQIndex.value])

function cycleAiQuestion () {
  aiQIndex.value = (aiQIndex.value + 1) % AI_QUESTIONS.length
  aiAnswer.value = ''
}

/* 两套规则各自独立 */
function blankRules () {
  return [
    { name: '1#', side: '左', addr: '0x20', type: 0, value: '', type2: null, value2: '' },
    { name: '2#', side: '右', addr: '0x20', type: 1, value: '', type2: null, value2: '' },
    { name: '3#', side: '左', addr: '0x21', type: 0, value: '', type2: null, value2: '' },
    { name: '4#', side: '右', addr: '0x21', type: 0, value: '', type2: null, value2: '' },
    { name: '5#', side: '左', addr: '0x22', type: 0, value: '', type2: null, value2: '' },
    { name: '6#', side: '右', addr: '0x22', type: 0, value: '', type2: null, value2: '' },
    { name: '7#', side: '左', addr: '0x23', type: 0, value: '', type2: null, value2: '' },
    { name: '8#', side: '右', addr: '0x23', type: 0, value: '衍生物', type2: null, value2: '' },
    { name: '9#', side: '送走', addr: '', type: 3, value: '', type2: null, value2: '', fixed: true }
  ]
}
const rulesA = ref(blankRules())
const rulesB = ref(blankRules())
const sortRules = computed(() => (ruleSet.value === 1 ? rulesA.value : rulesB.value))

function ruleHint (r) {
  if (r.type === 3) return '兜底口不用填'
  if (r.type === 1) return '例如 00121217'
  if (r.type === 2) return '例如 青眼'
  return '例如 0012'
}

function addCond2 (i) {
  const r = sortRules.value[i]
  if (r.type === 3) return
  r.type2 = 4          // 默认「星数区间」
  r.value2 = ''
}

function clearCond2 (i) {
  const r = sortRules.value[i]
  r.type2 = null
  r.value2 = ''
}

function cycleRuleType2 (i) {
  const r = sortRules.value[i]
  if (r.type2 === null) return
  r.type2 = (r.type2 + 1) % RULE_TYPES.length
}

function cycleRuleType (i) {
  const r = sortRules.value[i]
  r.type = (r.type + 1) % RULE_TYPES.length
  if (r.type === 3) r.value = ''
}

async function saveSortRules () {
  const toRows = (arr) => arr.filter(r => !r.fixed).map(r => ({
    outlet: r.name + r.side, addr: r.addr, side: r.side === '左' ? 'L' : 'R',
    type: RULE_TYPES[r.type], value: r.value,
    type2: r.type2 === null || r.type2 === undefined ? '' : RULE_TYPES[r.type2],
    value2: r.type2 === null || r.type2 === undefined ? '' : (r.value2 || '')
  }))
  const payload = {
    rules: {
      identMode: identMode.value,
      aiKeyword: aiKeyword.value,
      ruleSet: ruleSet.value,
      sets: { '1': toRows(rulesA.value), '2': toRows(rulesB.value) }
    }
  }
  try {
    const r = await saveRules(payload)
    if (r && r.ok) addLog('【规则】已保存到设备（规则集' + ruleSet.value + '，识别方式 ' + identMode.value + '）')
    else addLog('【规则】保存失败：' + ((r && r.error) || ''))
  } catch (e) {
    addLog('【规则】保存失败：' + (e && e.message ? e.message : e))
  }
}

async function loadSortRules () {
  try {
    const r = await getRules()
    if (!r || !r.rules) return
    const d = r.rules
    if (d.identMode) identMode.value = d.identMode
    if (d.aiKeyword) aiKeyword.value = d.aiKeyword
    if (d.ruleSet) ruleSet.value = parseInt(d.ruleSet, 10) || 1
    const fill = (arr, rows) => {
      if (!Array.isArray(rows)) return
      let k = 0
      arr.forEach((r0) => {
        if (r0.fixed) return
        const src = rows[k++]
        if (!src) return
        const t = RULE_TYPES.indexOf(src.type)
        r0.type = t >= 0 ? t : 0
        r0.value = src.value || ''
        const t2 = RULE_TYPES.indexOf(src.type2 || '')
        if (t2 >= 0 && src.type2) { r0.type2 = t2; r0.value2 = src.value2 || '' }
        else { r0.type2 = null; r0.value2 = '' }
      })
    }
    if (d.sets) { fill(rulesA.value, d.sets['1']); fill(rulesB.value, d.sets['2']) }
    addLog('【规则】已从设备读回（规则集' + ruleSet.value + '，识别方式 ' + identMode.value + '）')
  } catch (e) { /* 忽略 */ }
}

function clearSortRules () {
  sortRules.value.forEach(r => { r.value = '' })
  addLog('【规则】内容已清空（类型保留）')
}

function defaultSortRules () {
  sortRules.value.forEach(r => { r.type = 0; r.value = '' })
  sortRules.value[1].type = 1
  sortRules.value[7].type = 3
  addLog('【规则】已恢复默认（2# 精确、8# 兜底）')
}
const seq = ref(null)
let seqTimer = null
const ldr = ref(null)
let ldrTimer = null
const gateDeg = ref(120)     // 挡片目标角度输入
const customCmd = ref('')   // 自定义指令输入
const identResult = ref('') // 最近一次识别结果

// 8 个分拣口：4 单元 × 2 口
// 2026-11-04 现场调定的 8 个分拣口参数（毫秒）
// 1#=400/800  2#=800/400  3#~8#: 左 500/900、右 900/500
function defaultOutlets () {
  return [
    { name: '1#左', addr: '0x20', aMs: 400, bMs: 800, state: '' },
    { name: '2#右', addr: '0x20', aMs: 800, bMs: 400, state: '' },
    { name: '3#左', addr: '0x21', aMs: 500, bMs: 900, state: '' },
    { name: '4#右', addr: '0x21', aMs: 900, bMs: 500, state: '' },
    { name: '5#左', addr: '0x22', aMs: 500, bMs: 900, state: '' },
    { name: '6#右', addr: '0x22', aMs: 900, bMs: 500, state: '' },
    { name: '7#左', addr: '0x23', aMs: 500, bMs: 900, state: '' },
    { name: '8#右', addr: '0x23', aMs: 900, bMs: 500, state: '' }
  ]
}
const outlets = ref(defaultOutlets())
const outSel = ref(0)       // 当前选中的出口下标
const outState = ref('')    // 最近一次读回的单元状态
const speed = ref(null)      // 调试1 状态
const spChannel = ref('0x10')
const spPwm = ref(150)   // 实测 100 带不动皮带，150 可稳定运转
const spInterval = ref(120)
const spDelay = ref(0)      // 调试1 检测后延时(ms)
const feedOn = ref(false)   // 进料电机是否在持续转
const pushLdr = ref(null)     // 测试4：当前光敏值
const pushTh = ref(null)      // 测试4：当前阈值
const pushPwm = ref(null)     // 测试4：当前转速
const pushCount = ref(null)   // 测试4：推卡计数
const pushThIn = ref(200)     // 测试4：要设置的阈值
const pushPwmIn = ref(200)    // 测试4：要设置的转速
const beltPwmIn = ref(255)    // 皮带：要设置的转速
const beltPwmSet = ref(255)   // 皮带：当前已设转速（255=固件默认）
const thVals = ref({ '0x10': 2700, '0x20': 2700, '0x21': 2700, '0x22': 2700, '0x23': 2700, 'A7': 600 })
let speedTimer = null
const speed2 = ref(null)     // 调试2 状态
const sp2Channel = ref('0x10')
const sp2Pwm = ref(150)
const sp2Interval = ref(120)
const sp2Delay = ref(120)      // 调试2：变亮后延时(ms)     // 调试2 变亮后延时(ms)
let speed2Timer = null
const feedAuto = ref(null)   // 调试3 状态
const faChannel = ref('A7')
const faTh = ref(300)
let faTimer = null
let devLogLast = ''          // 上次已同步的设备日志最后一行
const identBusy = ref(false) // 识别循环进行中
const identTry = ref(0)      // 已尝试次数
let identCancel = false      // 取消标志
const lampOn = ref(false)   // 补光灯继电器
const fanOn = ref(false)    // 电风扇继电器
const autoRunning = ref(false)
const autoMode = ref(true)
const frameSrc = ref('')
const phone = ref(null)
const phoneBusy = ref(false)
let timer = null
let frameTimer = null

const cfg = reactive({
  espIp: '192.168.43.100',
  espPort: 8080,
  refresh: 1,
  cropTop: 0,
  cropBottom: 0,
  showLog: true
})

/* ---------------- 计算 ---------------- */
const linkMode = computed(() => (link.value && link.value.mode) || 'auto')
const wifiOk = computed(() => !!(link.value && link.value.wifi && link.value.wifi.connected))
const wifiText = computed(() => {
  const w = link.value && link.value.wifi
  if (!w) return '-'
  if (w.connected) return '已连接'
  return w.phaseText || w.phase || '-'
})
const addrText = computed(() => cfg.espIp + ':' + cfg.espPort)
const rxCount = computed(() => (link.value && link.value.wifi && link.value.wifi.rx) || 0)
const txCount = computed(() => (link.value && link.value.wifi && link.value.wifi.tx) || 0)
const reconnects = computed(() => (link.value && link.value.wifi && link.value.wifi.reconnects) || 0)
const errText = computed(() => (link.value && link.value.wifi && link.value.wifi.err) || '')
const seqRunning = computed(() => !!(seq.value && seq.value.running))
const ldrRunning = computed(() => !!(ldr.value && ldr.value.running))
const faRunning = computed(() => !!(feedAuto.value && feedAuto.value.running))
const sp2Running = computed(() => !!(speed2.value && speed2.value.running))
const spRunning = computed(() => !!(speed.value && speed.value.running))
const lastLog = computed(() => (logs.value && logs.value.length) ? logs.value[logs.value.length - 1] : '暂无操作')
const ldrCh = computed(() => {
  const d = ldr.value
  if (!d || !d.ch) return [
    { name: '0x10', val: null, card: false, ok: false },
    { name: '0x20', val: null, card: false, ok: false },
    { name: '0x21', val: null, card: false, ok: false },
    { name: '0x22', val: null, card: false, ok: false },
    { name: '0x23', val: null, card: false, ok: false },
    { name: 'A7', val: null, card: false, ok: false }
  ]
  return d.ch
})
function latText (k) {
  const l = ldr.value && ldr.value.latency
  if (!l || l[k] == null) return '-'
  return l[k] + ' ms'
}
const serialText = computed(() => {
  const t = serialInfo.value || ''
  const m = t.match(/COM\d+/)
  return m ? m[0] + ' 已连接' : '未连接'
})
const linkStateText = computed(() => {
  if (!link.value) return '读取中'
  if (link.value.active === 'wifi') return 'WiFi 已连接'
  if (link.value.active === 'serial') return 'USB 已连接'
  return '未连接'
})
const alarmClass = computed(() => (wifiOk.value ? 'alarm-green' : 'alarm-red'))
const overlayLogs = computed(() => logs.value.slice(0, 6).reverse())

const quickCmds = [
  { label: '握手',     cmd: 'H' },
  { label: '状态',     cmd: '?' },
  { label: '自动识别', cmd: 'I,0x10' },
  { label: '扫码',     cmd: 'C,0x10' },
  { label: 'NFC',      cmd: 'N,0x10' },
  { label: '读结果',   cmd: 'R' },
  { label: '挡片放行90', cmd: 'E,0x10,90' },
  { label: '挡片挡住120', cmd: 'E,0x10,120' },
  { label: '皮带开',   cmd: 'K,0x10,on' },
  { label: '皮带停',   cmd: 'K,0x10,off' },
  { label: '0x20 抬升', cmd: 'S,0x20,raise' },
  { label: '0x20 下降', cmd: 'S,0x20,lower' },
  { label: '0x20 状态', cmd: 'T,0x20' },
  { label: '补光灯',   cmd: 'W,on' },
  { label: '灯光关',   cmd: 'W,off' },
  { label: '光敏',     cmd: 'Q,ldr' },
  { label: '推一张卡', cmd: 'c' },
  { label: '进料 开/停', cmd: 's' }
]

/* ---------------- 工具 ---------------- */
function addLog (t) {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  logs.value.push(hh + ':' + mm + ':' + ss + '  ' + t)
  if (logs.value.length > 80) logs.value.shift()
}

function goBack () {
  // 指定返回到首页（与「设备连接」页一致，防止历史栈不对时回错地方）
  uni.reLaunch({ url: '/pages/index/index' })
}

/* ---------------- 链路 ---------------- */
async function refresh () {
  try {
    const r = await getDeviceStatus()
    serialInfo.value = (r && r.serial) || ''
    if (r && r.link) link.value = r.link
    syncDeviceLog(r)
    try {
      const ph = await getPhoneStatus()
      if (ph) phone.value = ph
    } catch (e) { /* 手机接口不可用时忽略 */ }
  } catch (e) {
    serialInfo.value = ''
  }
}

async function setMode (m) {
  try {
    const r = await setDeviceLink({ mode: m })
    if (r && r.link) link.value = r.link
    try {
      const ph = await getPhoneStatus()
      if (ph) phone.value = ph
    } catch (e) { /* 手机接口不可用时忽略 */ }
    addLog('切换模式 → ' + m)
  } catch (e) {
    addLog('切换失败：' + (e && e.message ? e.message : e))
  }
}

async function restartWifi () {
  try {
    const r = await setDeviceLink({ wifi_restart: true })
    if (r && r.link) link.value = r.link
    try {
      const ph = await getPhoneStatus()
      if (ph) phone.value = ph
    } catch (e) { /* 手机接口不可用时忽略 */ }
    addLog('WiFi 握手已重启')
  } catch (e) {
    addLog('重启失败：' + (e && e.message ? e.message : e))
  }
}

async function toggleLink () {
  if (wifiOk.value) {
    await setMode('serial')
    addLog('已断开无线（切到仅 USB）')
  } else {
    await setMode('wifi')
    addLog('已切到仅 WiFi')
  }
}

/* ---------------- 指令 ---------------- */
async function sendCmd (cmd) {
  if (needFetchResult(cmd)) { await identify(cmd); return }
  // 进料开/停 一个按钮切换，并同步状态
  if (cmd === 's') {
    const next = !feedOn.value
    const real = next ? 's' : 't'
    addLog('>>> ' + real)
    try {
      await deviceHardware(real)
      feedOn.value = next
    } catch (e) {
      addLog('下发失败：' + (e && e.message ? e.message : e))
    }
    return
  }
  addLog('>>> ' + cmd)
  try {
    await deviceHardware(cmd)
  } catch (e) {
    addLog('下发失败：' + (e && e.message ? e.message : e))
  }
}

/* ---------------- 自动化 ---------------- */
async function toggleAuto () {
  if (autoRunning.value) await stopAuto()
  else await startAuto()
}

async function startAuto () {
  addLog('请求开始自动运转…')
  try {
    await deviceAutoStart()
    autoRunning.value = true
    addLog('自动运转已启动')
  } catch (e) {
    addLog('启动失败：' + (e && e.message ? e.message : e))
  }
}

async function stopAuto () {
  addLog('请求停止自动运转…')
  try {
    await deviceAutoStop()
    autoRunning.value = false
    addLog('自动运转已停止')
  } catch (e) {
    addLog('停止失败：' + (e && e.message ? e.message : e))
  }
}

/* ---------------- 手机 ---------------- */
async function doScanPhone () {
  phoneBusy.value = true
  addLog('扫描手机…')
  try {
    const r = await phoneDiscover()
    if (r && r.devices && r.devices.length) {
      r.devices.forEach(d => addLog('发现 ' + (d.name || '') + ' ' + d.endpoint))
    } else {
      addLog('没发现手机（手机需先连同一 WiFi，且开过无线调试）')
    }
  } catch (e) {
    addLog('扫描失败：' + (e && e.message ? e.message : e))
  }
  phoneBusy.value = false
}

async function doPairPhone () {
  phoneBusy.value = true
  addLog('一键配对中（请保持 USB 插着）…')
  try {
    const r = await phonePairUsb()
    addLog(r && r.ok ? ('配对成功 ' + (r.endpoint || '')) : ('配对失败：' + ((r && r.msg) || '')))
  } catch (e) {
    addLog('配对失败：' + (e && e.message ? e.message : e))
  }
  phoneBusy.value = false
  await refresh()
}

async function doDiscPhone () {
  try {
    await phoneDisconnect()
    addLog('手机已断开')
  } catch (e) {
    addLog('断开失败：' + (e && e.message ? e.message : e))
  }
  await refresh()
}

/* ---------------- 六路阈值 ---------------- */
async function loadThresholds () {
  try {
    const r = await getLdrThresholds()
    if (r && r.thresholds) thVals.value = Object.assign({}, thVals.value, r.thresholds)
  } catch (e) { /* 忽略 */ }
}

async function doSampleAll () {
  addLog('【阈值】整体采样中…')
  try {
    const r = await ldrOnce()
    if (r) {
      ldr.value = r
      const sug = {}
      ;(r.ch || []).forEach(c => {
        if (c.ok && c.val) {
          sug[c.name] = Math.round(c.val * 0.75)   // 建议阈值 = 当前值 × 0.75
        }
      })
      if (Object.keys(sug).length) {
        thVals.value = Object.assign({}, thVals.value, sug)
        addLog('【阈值】已按 ×0.75 填入建议值，可手动改后点「保存阈值」')
      } else {
        addLog('【阈值】采样没读到有效值')
      }
      const list = (r.ch || []).map(c => c.name + '=' + (c.ok ? c.val : '-')).join(' ')
      addLog('【阈值】' + list)
    }
  } catch (e) {
    addLog('【阈值】采样失败：' + (e && e.message ? e.message : e))
  }
}

async function doSaveThresholds () {
  try {
    const payload = {}
    ;['0x10', '0x20', '0x21', '0x22', '0x23', 'A7'].forEach(k => {
      payload[k] = parseInt(thVals.value[k], 10) || 0
    })
    const r = await saveLdrThresholds({ thresholds: payload })
    addLog(r && r.ok ? '【阈值】已保存 6 路阈值' : ('【阈值】保存失败：' + ((r && r.error) || '')))
  } catch (e) {
    addLog('【阈值】保存失败：' + (e && e.message ? e.message : e))
  }
}

/* ---------------- 调试1：半速到光敏停 ---------------- */
async function pollSpeed () {
  try {
    const r = await speedStatus()
    if (r) speed.value = r
  } catch (e) { /* 忽略 */ }
}

function startSpeedPoll () {
  if (speedTimer) clearInterval(speedTimer)
  if (speed2Timer) clearInterval(speed2Timer)
  if (faTimer) clearInterval(faTimer)
  if (mainTimer) clearInterval(mainTimer)
  speedTimer = setInterval(pollSpeed, 400)
  pollSpeed()
}

async function runSpeed () {
  addLog('【调试1】开始：通道 ' + spChannel.value + ' PWM ' + spPwm.value + ' 间隔 ' + spInterval.value + 'ms')
  try {
    const r = await speedStart({
      channel: spChannel.value,
      pwm: parseInt(spPwm.value, 10) || 150,
      intervalMs: parseInt(spInterval.value, 10) || 120,
      delayMs: parseInt(spDelay.value, 10) || 0
    })
    addLog(r && r.ok ? '【调试1】已启动' : ('【调试1】启动失败：' + ((r && r.msg) || '')))
    startSpeedPoll()
  } catch (e) {
    addLog('【调试1】启动失败：' + (e && e.message ? e.message : e))
  }
}

async function stopSpeed () {
  try {
    await speedStop()
    addLog('【调试1】已请求停止')
  } catch (e) { /* 忽略 */ }
}

async function clearSpeed () {
  try { await speedClear(); speed.value = null; addLog('【调试1】结果已清') } catch (e) { /* 忽略 */ }
}

/* ---------------- 调试2：先遮后亮再停 ---------------- */
async function pollSpeed2 () {
  try {
    const r = await speedStatus()
    if (r) speed2.value = r
  } catch (e) { /* 忽略 */ }
}

function startSpeed2Poll () {
  if (speed2Timer) clearInterval(speed2Timer)
  if (faTimer) clearInterval(faTimer)
  speed2Timer = setInterval(pollSpeed2, 400)
  pollSpeed2()
}

async function runSpeed2 () {
  addLog('【调试2】开始：通道 ' + sp2Channel.value + ' PWM ' + sp2Pwm.value)
  try {
    const r = await speedStart({
      mode: 'pass',
      channel: sp2Channel.value,
      pwm: parseInt(sp2Pwm.value, 10) || 150,
      intervalMs: parseInt(sp2Interval.value, 10) || 120,
      delayMs: parseInt(sp2Delay.value, 10) || 0
    })
    addLog(r && r.ok ? '【调试2】已启动（遮住→变亮→停）' : ('【调试2】启动失败：' + ((r && r.msg) || '')))
    startSpeed2Poll()
  } catch (e) {
    addLog('【调试2】启动失败：' + (e && e.message ? e.message : e))
  }
}

async function stopSpeed2 () {
  try { await speedStop(); addLog('【调试2】已请求停止') } catch (e) { /* 忽略 */ }
}

async function clearSpeed2 () {
  try { await speedClear(); speed2.value = null; addLog('【调试2】结果已清') } catch (e) { /* 忽略 */ }
}

/* ---------------- 皮带转速（识别单元 K,0x10,pwm,N）---------------- */
async function doSetBeltPwm () {
  const v = parseInt(beltPwmIn.value, 10)
  if (!(v >= 0 && v <= 255)) { addLog('【皮带】转速要在 0~255'); return }
  try {
    addLog('>>> K,0x10,pwm,' + v)
    await deviceHardware('K,0x10,pwm,' + v)
    beltPwmSet.value = v
    addLog('【皮带】转速已设为 ' + v + '（皮带已启动）')
  } catch (e) {
    addLog('【皮带】设置失败：' + (e && e.message ? e.message : e))
  }
}

async function doBeltPwmQuick (v) {
  beltPwmIn.value = v
  await doSetBeltPwm()
}

/* ---------------- 一键复制日志 ---------------- */
async function copyLogs () {
  const text = (logs.value || []).join('\n')
  if (!text) { addLog('【复制】日志还是空的'); return }
  let ok = false
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      ok = true
    }
  } catch (e) { ok = false }
  if (!ok) {
    try {
      uni.setClipboardData({ data: text, success: () => {}, fail: () => {} })
      ok = true
    } catch (e) { ok = false }
  }
  if (ok) addLog('【复制】已复制 ' + (logs.value || []).length + ' 行日志到剪贴板')
  else addLog('【复制】浏览器不允许自动复制，请手动长按选择')
}

/* ---------------- 图像识别测试 ---------------- */
async function doVisionTest () {
  aiAnswer.value = ''
  aiMs.value = 0
  try {
    addLog('【识别】正在拍照…')
    const cap = await visionPhoto()
    if (!cap || !cap.ok) {
      addLog('【识别】拍照失败：' + ((cap && cap.error) || '未知错误'))
      return
    }
    addLog('【识别】照片 ' + (cap.file || '') + '，' + Math.round((cap.bytes || 0) / 1024) + ' KB，提交给 AI…')

    let q = aiQuestion.value
    if (identMode.value === '图像识别' && aiKeyword.value.trim()) {
      q = q + '（关注：' + aiKeyword.value.trim() + '）'
    }
    const r = await visionQa({ image: cap.image, question: q })
    if (!r || !r.ok) {
      addLog('【识别】AI 失败：' + ((r && r.error) || '未知错误'))
      return
    }
    aiAnswer.value = r.answer
    aiMs.value = r.ms || 0
    addLog('【识别】' + q + ' → ' + r.answer + '（' + aiMs.value + 'ms）')
  } catch (e) {
    addLog('【识别】失败：' + (e && e.message ? e.message : e))
  }
}

/* ---------------- 测试4：卡牌进料 ---------------- */
/* 解析设备回包： [进料] LDR=623,阈值=100,PWM=200,计数=0 */
function parsePushInfo (line) {
  if (!line) return false
  const m = line.match(/LDR=(\d+)[\s\S]*?阈值=(\d+)[\s\S]*?PWM=(\d+)[\s\S]*?计数=(\d+)/)
  if (!m) return false
  pushLdr.value = parseInt(m[1], 10)
  pushTh.value = parseInt(m[2], 10)
  pushPwm.value = parseInt(m[3], 10)
  pushCount.value = parseInt(m[4], 10)
  if (pushTh.value) pushThIn.value = pushTh.value
  if (pushPwm.value) pushPwmIn.value = pushPwm.value
  return true
}

async function doReadPush () {
  try {
    addLog('>>> i')
    await deviceHardware('i')
    for (let k = 0; k < 10; k++) {
      await new Promise(r => setTimeout(r, 250))
      const hit = [...logs.value].reverse().find(l => l.indexOf('LDR=') >= 0 && l.indexOf('阈值=') >= 0)
      if (hit && parsePushInfo(hit)) {
        addLog('【测试4】光敏 ' + pushLdr.value + ' / 阈值 ' + pushTh.value + ' / PWM ' + pushPwm.value + ' / 计数 ' + pushCount.value)
        return
      }
    }
    addLog('【测试4】没读到进料信息')
  } catch (e) {
    addLog('【测试4】读取失败：' + (e && e.message ? e.message : e))
  }
}

async function doSetPushTh () {
  const v = parseInt(pushThIn.value, 10)
  if (!(v > 0 && v < 4096)) { addLog('【测试4】阈值要在 1~4095'); return }
  try {
    addLog('>>> q' + v)
    await deviceHardware('q' + v)
    pushTh.value = v
    addLog('【测试4】阈值已设为 ' + v)
  } catch (e) { addLog('【测试4】设置失败：' + (e && e.message ? e.message : e)) }
}

async function doSetPushPwm () {
  const v = parseInt(pushPwmIn.value, 10)
  if (!(v >= 0 && v <= 255)) { addLog('【测试4】转速要在 0~255'); return }
  try {
    addLog('>>> p' + v)
    await deviceHardware('p' + v)
    pushPwm.value = v
    addLog('【测试4】转速已设为 ' + v)
  } catch (e) { addLog('【测试4】设置失败：' + (e && e.message ? e.message : e)) }
}

async function doStopFeed () {
  feedOn.value = false
  try {
    addLog('>>> t')
    await deviceHardware('t')
    addLog('【测试4】进料已停')
  } catch (e) { addLog('【测试4】停止失败：' + (e && e.message ? e.message : e)) }
}

/* ---------------- 调试3：料仓缺卡自动停料 ---------------- */
async function pollFeedAuto () {
  try {
    const r = await feedAutoStatus()
    if (r) feedAuto.value = r
  } catch (e) { /* 忽略 */ }
}

function startFeedAutoPoll () {
  if (faTimer) clearInterval(faTimer)
  faTimer = setInterval(pollFeedAuto, 500)
  pollFeedAuto()
}

async function runFeedAuto () {
  addLog('【调试3】开始监测料仓：通道 ' + faChannel.value + ' 阈值 ' + faTh.value)
  try {
    const r = await feedAutoStart({
      channel: faChannel.value,
      th: parseInt(faTh.value, 10) || 300
    })
    addLog(r && r.ok ? '【调试3】已启动' : ('【调试3】启动失败：' + ((r && r.msg) || '')))
    startFeedAutoPoll()
  } catch (e) {
    addLog('【调试3】启动失败：' + (e && e.message ? e.message : e))
  }
}

async function stopFeedAuto () {
  try {
    await feedAutoStop()
    addLog('【调试3】已停止')
  } catch (e) { /* 忽略 */ }
}

async function clearFeedAuto () {
  try { feedAuto.value = null; addLog('【调试3】统计已清') } catch (e) { /* 忽略 */ }
}

/* ---------------- 八路分拣口 ---------------- */
function clampMs (v) {
  let n = parseInt(v, 10)
  if (isNaN(n)) n = 0
  if (n < 0) n = 0
  if (n > 2550) n = 2550
  return n
}

async function writeOutlet (o, idx) {
  const a = clampMs(o.aMs)
  const b = clampMs(o.bMs)
  const av = Math.round(a / 10)     // 固件单位：×10ms
  const bv = Math.round(b / 10)
  addLog('【' + o.name + '】A=' + a + 'ms B=' + b + 'ms')
  try {
    await deviceHardware('P,' + o.addr + ',au,' + av)
    await deviceHardware('P,' + o.addr + ',bu,' + bv)
    await new Promise(r => setTimeout(r, 600))
    await readOutletState(o)
  } catch (e) {
    addLog('【' + o.name + '】写入失败：' + (e && e.message ? e.message : e))
  }
}

async function testOutlet (o, idx) {
  await writeOutlet(o, idx)
  addLog('【' + o.name + '】抬升测试')
  try {
    await deviceHardware('S,' + o.addr + ',raise')
  } catch (e) {
    addLog('【' + o.name + '】抬升失败：' + (e && e.message ? e.message : e))
  }
}

async function readOutletState (o) {
  try {
    await deviceHardware('T,' + o.addr)
    await new Promise(r => setTimeout(r, 700))
    await refresh()
    const hit = logs.value.slice().reverse().find(l => l.indexOf(o.addr + ',限位') >= 0)
    if (hit) o.state = String(hit).replace('[分拣]', '').trim()
  } catch (e) { /* 忽略 */ }
}

async function actOutlet (o, idx, act) {
  addLog('【' + o.name + '】' + o.addr + ' ' + act)
  try {
    // ★ 重要：抬升前必须先把当前 A/B 参数重新写一遍（覆盖上一次的值），否则会用旧参数
    if (act === 'raise') {
      const a = clampMs(o.aMs)
      const b = clampMs(o.bMs)
      await deviceHardware('P,' + o.addr + ',au,' + Math.round(a / 10))
      await new Promise(r => setTimeout(r, 120))
      await deviceHardware('P,' + o.addr + ',bu,' + Math.round(b / 10))
      await new Promise(r => setTimeout(r, 150))
      addLog('【' + o.name + '】已写入 A=' + a + 'ms B=' + b + 'ms 再抬升')
    }
    await deviceHardware('S,' + o.addr + ',' + act)
    await new Promise(r => setTimeout(r, 900))
    await readOutletState(o)
  } catch (e) {
    addLog('【' + o.name + '】失败：' + (e && e.message ? e.message : e))
  }
}

async function resetOutlet (o, idx) {
  addLog('【' + o.name + '】复位（两臂下降）')
  try {
    await deviceHardware('S,' + o.addr + ',lower')
    await new Promise(r => setTimeout(r, 900))
    await readOutletState(o)
  } catch (e) {
    addLog('【' + o.name + '】复位失败：' + (e && e.message ? e.message : e))
  }
}

async function lowerAllOutlets () {
  addLog('【分拣】全部复位（8 个口两臂下降）…')
  const seen = {}
  for (const o of outlets.value) {
    if (seen[o.addr]) continue      // 同一个单元只发一次
    seen[o.addr] = 1
    try {
      await deviceHardware('S,' + o.addr + ',lower')
      await new Promise(r => setTimeout(r, 300))
    } catch (e) { /* 忽略 */ }
  }
  addLog('【分拣】全部复位完成')
}

async function saveAllOutlets () {
  addLog('【分拣口】保存 8 个出口参数到后端配置…')
  try {
    const list = outlets.value.map(o => ({ name: o.name, addr: o.addr, aMs: clampMs(o.aMs), bMs: clampMs(o.bMs) }))
    const r = await saveOutlets({ outlets: list })
    addLog(r && r.ok ? ('【分拣口】已保存 ' + r.count + ' 个，时间 ' + r.savedAt) : ('【分拣口】保存失败：' + ((r && r.error) || '')))
  } catch (e) {
    addLog('【分拣口】保存失败：' + (e && e.message ? e.message : e))
  }
}

async function writeAllOutlets () {
  addLog('【分拣】写入全部 8 个出口参数…')
  for (let i = 0; i < outlets.value.length; i++) {
    await writeOutlet(outlets.value[i], i)
    await new Promise(r => setTimeout(r, 120))
  }
  addLog('【分拣】全部写入完成')
}

function resetOutlets () {
  outlets.value = defaultOutlets()
  addLog('【分拣】已恢复默认参数（未写入设备）')
}

/* ---------------- 角度 / 自定义指令 ---------------- */
async function setGateAngle () {
  const d = parseInt(gateDeg.value, 10)
  if (isNaN(d) || d < 0 || d > 180) {
    addLog('【挡片】角度必须是 0~180 的整数')
    return
  }
  addLog('【挡片】E,0x10,' + d)
  try {
    await deviceHardware('E,0x10,' + d)
  } catch (e) {
    addLog('【挡片】失败：' + (e && e.message ? e.message : e))
  }
}

async function sendCustom () {
  const c = (customCmd.value || '').trim()
  if (!c) return
  addLog('>>> ' + c)
  try {
    await deviceHardware(c)
  } catch (e) {
    addLog('发送失败：' + (e && e.message ? e.message : e))
  }
}

/* ---------------- 独立开关 ---------------- */
async function toggleLamp () {
  const next = !lampOn.value
  addLog('【补光灯】' + (next ? 'W,on' : 'W,off'))
  try {
    await deviceHardware(next ? 'W,on' : 'W,off')
    lampOn.value = next
  } catch (e) {
    addLog('【补光灯】失败：' + (e && e.message ? e.message : e))
  }
}

async function toggleFan () {
  const next = !fanOn.value
  addLog('【电风扇】' + (next ? 'F,on' : 'F,off'))
  try {
    await deviceHardware(next ? 'F,on' : 'F,off')
    fanOn.value = next
  } catch (e) {
    addLog('【电风扇】失败：' + (e && e.message ? e.message : e))
  }
}

/* ---------------- 测试3 ---------------- */
async function pollLdr () {
  try {
    const r = await ldrStatus()
    if (r) {
      const prev = ldr.value
      ldr.value = r
      // 状态翻转写进绿色字幕
      if (prev && r.flips && prev.flips && r.flips.length > (prev.flips.length || 0)) {
        const nf = r.flips.slice(prev.flips.length)
        nf.forEach(f => addLog('【光敏】' + f.name + ' ' + f.to + '（' + f.val + '）'))
      }
    }
  } catch (e) { /* 忽略 */ }
}

function startLdrPoll () {
  if (ldrTimer) clearInterval(ldrTimer)
  if (speedTimer) clearInterval(speedTimer)
  if (speed2Timer) clearInterval(speed2Timer)
  if (faTimer) clearInterval(faTimer)
  ldrTimer = setInterval(pollLdr, 300)
  pollLdr()
}

async function startLdr (ms) {
  try {
    const r = await ldrStart({ intervalMs: ms || 300 })
    addLog(r && r.ok ? '【测试3】开始采集，间隔 ' + (ms || 300) + ' ms' : ('【测试3】启动失败：' + ((r && r.msg) || '')))
    startLdrPoll()
  } catch (e) {
    addLog('【测试3】启动失败：' + (e && e.message ? e.message : e))
  }
}

async function doReadOnce () {
  addLog('【光敏】读一次…')
  try {
    const r = await ldrOnce()
    if (r) {
      ldr.value = r
      const list = (r.ch || []).map(c => c.name + '=' + (c.ok ? c.val : '-')).join(' ')
      addLog('【光敏】' + list + (r.tookMs != null ? ('  (' + r.tookMs + 'ms)') : ''))
    }
  } catch (e) {
    addLog('【光敏】读取失败：' + (e && e.message ? e.message : e))
  }
}

async function stopLdr () {
  try { await ldrStop(); addLog('【测试3】已停止'); } catch (e) { /* 忽略 */ }
}

async function doClearLdr () {
  try { await ldrClear(); addLog('【测试3】统计已清零'); } catch (e) { /* 忽略 */ }
}

function toggleLdr () {
  if (ldrRunning.value) stopLdr()
  else startLdr(300)
}

/* ---------------- 设备日志同步 ---------------- */
function syncDeviceLog (st) {
  try {
    const dl = (st && st.log) || []
    if (!dl.length) return
    let start = 0
    if (devLogLast) {
      const i = dl.lastIndexOf(devLogLast)
      if (i >= 0) start = i + 1
      else start = Math.max(0, dl.length - 5)   // 找不到就从最后 5 条开始
    } else {
      start = Math.max(0, dl.length - 5)
    }
    for (let k = start; k < dl.length; k++) {
      const line = String(dl[k] || '')
      if (!line) continue
      // 去掉设备端的时间戳前缀，页面自己加
      const m = line.match(/^\[[^\]]*\]\s*(.*)$/)
      const body = m ? m[1] : line
      // ★ 过滤测试3 的轮询噪声，避免刷屏把识别结果挤掉
      if (body.indexOf('[ADC]') >= 0) continue
      if (body.indexOf('[光敏]') >= 0) continue
      if (body.indexOf('[状态]') >= 0) continue
      if (body.indexOf('[在线]') >= 0) continue
      if (logs.value.indexOf(body) < 0 && logs.value.indexOf(line) < 0) {
        logs.value.push(body)
      }
      if (body.indexOf('[识别]') >= 0) {
        identResult.value = body.replace('[识别]', '').trim()
      }
    }
    devLogLast = dl[dl.length - 1] || devLogLast
    if (logs.value.length > 120) logs.value.splice(0, logs.value.length - 120)
  } catch (e) { /* 忽略 */ }
}

/* ---------------- 识别（自动补读结果）---------------- */
function needFetchResult (cmd) {
  const c = (cmd || '').trim().toUpperCase()
  return c.startsWith('N,') || c.startsWith('C,') || c.startsWith('I,')
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 判断识别结果是否有效（固件失败时返回 RAW,0,- ）
function identOk (txt) {
  const t = String(txt || '').trim()
  if (!t) return false
  if (t.indexOf(',0,-') >= 0) return false
  if (t.indexOf('RAW,0') >= 0) return false
  return /^\d+,[A-Z]+,\d+,/i.test(t)
}

function stopIdentify () {
  identCancel = true
  addLog('【识别】正在停止…')
}

// 循环触发，直到读到数据为止
async function identify (cmd, maxTry) {
  if (identBusy.value) {
    addLog('【识别】已经有一轮在跑，先点「停止识别」')
    return
  }
  const limit = maxTry || 12
  identCancel = false
  identBusy.value = true
  identTry.value = 0
  addLog('【识别】开始，最多尝试 ' + limit + ' 次（' + cmd + '）')

  for (let i = 1; i <= limit; i++) {
    if (identCancel) break
    identTry.value = i
    identResult.value = ''
    addLog('【识别】第 ' + i + ' 次触发 ' + cmd)
    try { await deviceHardware(cmd) } catch (e) { addLog('触发失败：' + (e && e.message ? e.message : e)) }
    await sleep(1300)
    if (identCancel) break
    try { await deviceHardware('R') } catch (e) { /* 忽略 */ }
    await sleep(1300)
    await refresh()
    if (identOk(identResult.value)) {
      addLog('【识别】✅ 读到：' + identResult.value)
      identBusy.value = false
      return
    }
    addLog('【识别】第 ' + i + ' 次没读到，继续')
  }

  identBusy.value = false
  if (identCancel) {
    addLog('【识别】已停止')
  } else if (!identOk(identResult.value)) {
    addLog('【识别】' + limit + ' 次都没读到，检查卡的位置')
  }
}

/* ---------------- 测试2 ---------------- */
async function pollSeq () {
  try {
    const r = await seqStatus()
    if (r) {
      const prevStep = seq.value && seq.value.step
      seq.value = r
      if (r.step && r.step !== prevStep && r.running) addLog('【测试2】' + r.step)
      const evs = (r.events || []).slice(-3)
      evs.forEach(e => {
        if (e && e.d && !logs.value.some(x => x.indexOf(e.d) >= 0)) {
          addLog(e.t + '  ' + e.d)
        }
      })
      if (!r.running && prevStep && prevStep !== '空闲' && prevStep !== '结束') {
        addLog('【测试2】已结束')
      }
    }
  } catch (e) { /* 忽略 */ }
}

function startSeqPoll () {
  if (seqTimer) clearInterval(seqTimer)
  if (ldrTimer) clearInterval(ldrTimer)
  if (speedTimer) clearInterval(speedTimer)
  if (speed2Timer) clearInterval(speed2Timer)
  if (faTimer) clearInterval(faTimer)
  seqTimer = setInterval(pollSeq, 1000)
  pollSeq()
}

async function runSeq2 () {
  try {
    const r = await seqStart({ mode: 'run' })
    addLog(r && r.ok ? '【测试2】已启动（完整时序）' : ('【测试2】启动失败：' + ((r && r.msg) || '')))
    startSeqPoll()
  } catch (e) {
    addLog('【测试2】启动失败：' + (e && e.message ? e.message : e))
  }
}

async function measureLdr () {
  try {
    const r = await seqStart({ mode: 'measure', measureMs: 10000 })
    addLog(r && r.ok ? '【测试2】开始测光敏 10 秒，请手动放卡/拿卡' : ('【测试2】启动失败：' + ((r && r.msg) || '')))
    startSeqPoll()
  } catch (e) {
    addLog('【测试2】启动失败：' + (e && e.message ? e.message : e))
  }
}

async function stopSeq2 () {
  try {
    await seqStop()
    addLog('【测试2】已请求停止')
  } catch (e) { /* 忽略 */ }
}

async function clearSeq () {
  try { await seqClear(); logs.value = [] } catch (e) { /* 忽略 */ }
}

function toggleSeq2 () {
  if (seqRunning.value) stopSeq2()
  else runSeq2()
}

/* ---------------- 配置 ---------------- */
async function saveCfg () {
  showCfg.value = false
  try {
    await setDeviceLink({
      ESP_IP: String(cfg.espIp || '').trim(),
      ESP_PORT: Number(cfg.espPort) || 8080
    })
    addLog('保存参数 ' + cfg.espIp + ':' + cfg.espPort)
    await refresh()
  } catch (e) {
    addLog('保存失败：' + (e && e.message ? e.message : e))
  }
  restartFrameTimer()
}

/* ---------------- 投屏（占位） ---------------- */
function tickFrame () {
  // ADB 未接入：先尝试取帧 URL，失败则保持占位
  try {
    frameSrc.value = getDeviceFrameUrl(Date.now())
  } catch (e) {
    frameSrc.value = ''
  }
}

function restartFrameTimer () {
  if (frameTimer) clearInterval(frameTimer)
  if (seqTimer) clearInterval(seqTimer)
  if (ldrTimer) clearInterval(ldrTimer)
  if (speedTimer) clearInterval(speedTimer)
  if (speed2Timer) clearInterval(speed2Timer)
  if (faTimer) clearInterval(faTimer)
  const sec = Math.max(1, Number(cfg.refresh) || 1)
  frameTimer = setInterval(tickFrame, sec * 1000)
}

onMounted(async () => {
  await refresh()
  tickFrame()
  restartFrameTimer()
  timer = setInterval(refresh, 1500)
  startSeqPoll()
  startLdrPoll()
  startSpeedPoll()
  startSpeed2Poll()
  startFeedAutoPoll()
  loadThresholds()
  loadSortRules()
  startMainPoll()
  loadWaits()
  addLog('页面已加载：无线链路调试版')
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  if (frameTimer) clearInterval(frameTimer)
  if (seqTimer) clearInterval(seqTimer)
  if (ldrTimer) clearInterval(ldrTimer)
  if (speedTimer) clearInterval(speedTimer)
  if (speed2Timer) clearInterval(speed2Timer)
  if (faTimer) clearInterval(faTimer)
})
</script>

<style scoped>
/* ===== 照「设备连接」页：全宽白底块，块间 1px 缝，无外边距 ===== */
.page {
  min-height: 100vh;
  background-color: #F5F5F7;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding-bottom: 20px;
}

/* 工具栏（全宽白块） */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: #FFFFFF;
  padding: 12px 16px 10px;
  flex-shrink: 0;
}
.tool-btn {
  width: 32px; height: 32px; border-radius: 16px;
  background-color: #F0F0F0;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.tool-btn-icon { font-size: 16px; color: #1A1A1A; line-height: 1; }
.icon-back { width: 18px; height: 18px; }
.tap-btn {
  display: flex; align-items: center; justify-content: center;
  padding: 6px 12px; background-color: #F0F0F0; border-radius: 13px;
  flex-shrink: 0;
}
.tap-btn-on { background-color: #1A1A1A; }
.tap-btn-on .tap-btn-text { color: #FFFFFF; }
.tap-btn-red { background-color: #FF3B30; }

/* 第9条固定兜底行 */
.rule-row-fixed { background-color: #FAFAFA; border-radius: 8px; padding: 2px 6px; }
.rule-type-fixed { background-color: #E8E8E8; }
.rule-fixed-text { flex: 1; font-size: 11px; color: #999999; }

.grid2 { display: flex; flex-wrap: wrap; gap: 8px; }
.grid2 .op { width: 48%; margin: 0; }

/* 快捷档 chips */
.chips { display: flex; align-items: center; gap: 8px; padding: 6px 0 2px 0; flex-wrap: wrap; }
.chip { padding: 4px 12px; border-radius: 12px; background-color: #F0F0F0; }
.chip-text { font-size: 12px; color: #1A1A1A; }
.chip-note { font-size: 11px; color: #999999; }

/* 规则第二条件 */
.rule-row2 { margin-top: -2px; }
.rule-del {
  width: 24px; height: 30px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background-color: #F5F5F7; border-radius: 8px;
}
.rule-del-text { font-size: 14px; color: #FF3B30; }
.rule-add { padding: 0 0 4px 46px; }
.rule-add-text { font-size: 11px; color: #999999; }

/* 规则集下拉 */
.rule-select {
  display: flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 12px;
  background-color: #F0F0F0; border-radius: 8px;
}
.rule-select-text { font-size: 12px; color: #1A1A1A; }
.rule-select-arrow { font-size: 11px; color: #999999; }

/* 分拣规则行 */
.rule-row {
  display: flex; align-items: center; gap: 6px;
  margin: 6px 0;
}
.rule-name {
  width: 40px; flex-shrink: 0;
  font-size: 12px; color: #1A1A1A;
}
.rule-type {
  width: 56px; flex-shrink: 0; height: 30px;
  display: flex; align-items: center; justify-content: center;
  background-color: #F0F0F0; border-radius: 8px;
}
.rule-type-text { font-size: 11px; color: #1A1A1A; }
.rule-input {
  flex: 1; height: 30px; padding: 0 8px;
  background-color: #F5F5F7; border-radius: 8px;
  font-size: 12px; color: #1A1A1A;
}

/* 输入行 */
.in-row {
  display: flex; align-items: center; gap: 8px;
  margin: 6px 0;
}
.in-box {
  flex: 1; height: 36px;
  padding: 0 10px;
  background-color: #F5F5F7;
  border-radius: 8px;
  font-size: 13px; color: #1A1A1A;
}
.in-btn {
  height: 36px; padding: 0 14px;
  border-radius: 8px;
  background-color: #F0F0F0;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; color: #1A1A1A;
  flex-shrink: 0;
}
.in-btn-red { background-color: #FF0000; }
.in-btn-red { color: #FFFFFF; }

/* 八路分拣口表格 */
.out-head {
  display: flex; align-items: center;
  padding: 4px 0;
  border-bottom: 1px solid #F0F0F0;
}
.out-h-name { width: 52px; font-size: 11px; color: #999999; }
.out-h-unit { width: 46px; font-size: 11px; color: #999999; }
.out-h-num  { flex: 1;  font-size: 11px; color: #999999; text-align: center; }
.out-h-op   { width: 116px; font-size: 11px; color: #999999; text-align: center; }

.out-row {
  display: flex; align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid #F5F5F7;
}
.out-name { width: 46px; font-size: 13px; color: #1A1A1A; font-weight: 500; }
.out-unit { width: 42px; font-size: 11px; color: #666666; }
.out-lbl { font-size: 11px; color: #999999; }
.out-num {
  width: 64px; height: 32px; margin: 0 2px;
  padding: 0 6px;
  background-color: #F5F5F7;
  border-radius: 6px;
  font-size: 12px; color: #1A1A1A;
  text-align: center;
}
.out-ops { width: 116px; display: flex; gap: 4px; }
.out-btn {
  flex: 1; height: 28px;
  border-radius: 6px;
  background-color: #F0F0F0;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: #1A1A1A;
}
.out-btn-red { background-color: #FF0000; color: #FFFFFF; }
.out-btn-gray { background-color: #8A8A8A; color: #FFFFFF; }

/* 阈值行 */
.th-row {
  display: flex; align-items: flex-end; gap: 3px;
  margin: 8px 0 4px;
}
.th-tag { font-size: 11px; color: #999999; width: 28px; flex-shrink: 0; }
.th-cell { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.th-num {
  width: 100%; height: 28px;
  padding: 0 2px;
  background-color: #F5F5F7;
  border-radius: 5px;
  font-size: 11px; color: #1A1A1A;
  text-align: center;
}
.th-name { font-size: 9px; color: #999999; font-family: ui-monospace, Consolas, monospace; }

/* 出口行：一行放完（名字 单元 A B 保 抬 复） */
.out-card {
  background-color: #FAFAFA;
  border-radius: 8px;
  padding: 6px 8px;
  margin-bottom: 6px;
}
.out-line1 {
  display: flex; align-items: center; gap: 5px;
}
.out-name { width: 40px; font-size: 13px; color: #1A1A1A; font-weight: 500; flex-shrink: 0; }
.out-unit { width: 38px; font-size: 11px; color: #666666; flex-shrink: 0; }
.out-num {
  width: 54px; height: 30px;
  padding: 0 4px;
  background-color: #FFFFFF;
  border-radius: 6px;
  font-size: 12px; color: #1A1A1A;
  text-align: center;
  flex-shrink: 0;
}
.sq {
  width: 32px; height: 30px;
  border-radius: 6px;
  background-color: #F0F0F0;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 500; color: #1A1A1A;
  flex-shrink: 0;
}
.sq-red { background-color: #FF0000; color: #FFFFFF; }
.sq-gray { background-color: #8A8A8A; color: #FFFFFF; }
.out-state {
  margin-top: 5px;
  padding: 3px 6px;
  background-color: #FFFFFF;
  border-radius: 5px;
}
.out-state-text {
  font-size: 10px; color: #666666;
  font-family: ui-monospace, Consolas, monospace;
}

/* 出口选择 chips（旧样式保留不冲突）*/
.out-pick {
  display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0;
}
.out-chip {
  width: calc((100% - 18px) / 4);
  height: 32px;
  border-radius: 8px;
  background-color: #F0F0F0;
  display: flex; align-items: center; justify-content: center;
}
.out-chip-on { background-color: #1A1A1A; }
.out-chip-on .out-chip-text { color: #FFFFFF; font-weight: 500; }
.out-chip-text { font-size: 12px; color: #1A1A1A; }

.in-tag { font-size: 11px; color: #999999; flex-shrink: 0; }

/* 补光灯 / 电风扇按键行（同开始运转样式） */
.device-bar {
  display: flex; gap: 12px;
  background-color: #FFFFFF;
  padding: 12px 16px;
  margin-top: 1px;
}
.dev-btn {
  flex: 1; height: 42px; border-radius: 10px;
  background-color: #F0F0F0;
  display: flex; align-items: center; justify-content: center;
}
.dev-btn-on { background-color: #FF0000; }
.dev-btn-text { font-size: 15px; font-weight: 500; color: #1A1A1A; }
.dev-btn-on .dev-btn-text { color: #FFFFFF; }

/* 操作行（第二行按钮） */
.toolbar-actions {
  display: flex; gap: 8px;
  background-color: #FFFFFF;
  padding: 0 16px 12px;
}
.toolbar-actions .tap-btn { flex: 1; padding: 8px 0; }

/* 最近操作反馈 */
.fb-line {
  display: flex; align-items: baseline; gap: 8px;
  background-color: #F5F5F7;
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 6px;
}
.fb-label { font-size: 11px; color: #999999; flex-shrink: 0; }
.fb-text {
  flex: 1;
  font-size: 11px; color: #1A1A1A;
  font-family: ui-monospace, Consolas, monospace;
  word-break: break-all;
}
.tap-btn-red .tap-btn-text { color: #FFFFFF; }
.seq-panel { background-color: #FFFFFF; }

/* 测试3 指示灯 */
.led-grid {
  display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0;
}
.led-cell {
  width: calc((100% - 16px) / 3);
  box-sizing: border-box;
  display: flex; flex-direction: column; align-items: center;
  gap: 4px;
  padding: 10px 4px;
  border-radius: 8px;
  border: 1px solid #F0F0F0;
}
.led-on  { background-color: #E9F9EE; border-color: #9BE0A8; }
.led-off { background-color: #FBEFF0; border-color: #F0C0C4; }
.led-dot {
  width: 16px; height: 16px; border-radius: 8px;
}
.led-dot-on  { background-color: #34C759; box-shadow: 0 0 8px #34C759; }
.led-dot-off { background-color: #FF3B30; box-shadow: 0 0 6px #FF3B30; }
.led-name { font-size: 11px; color: #666666; font-family: ui-monospace, Consolas, monospace; }
.led-val  { font-size: 12px; color: #1A1A1A; font-family: ui-monospace, Consolas, monospace; font-weight: 500; }
.tap-btn-text { font-size: 12px; color: #1A1A1A; }
.tool-title { font-size: 15px; font-weight: 500; color: #1A1A1A; }
.toolbar-right { display: flex; align-items: center; gap: 8px; }
.alarm-indicator { display: flex; align-items: center; gap: 5px; }
.alarm-dot {
  width: 10px; height: 10px; border-radius: 5px;
  background-color: #C8C8C8;
}
.alarm-red   { background-color: #FF3B30; box-shadow: 0 0 6px #FF3B30; }
.alarm-green { background-color: #34C759; box-shadow: 0 0 6px #34C759; }
.alarm-text { font-size: 11px; color: #666666; }

/* 连接栏（全宽白块） */
.connect-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  background-color: #FFFFFF;
  padding: 10px 16px;
  margin-top: 1px;
  flex-shrink: 0;
}
.bar-input {
  flex: 2; height: 32px; padding: 0 10px;
  background-color: #F5F5F7; border-radius: 8px;
  font-size: 12px; color: #1A1A1A;
}
.bar-input-sm {
  flex: 1; height: 32px; padding: 0 8px;
  background-color: #F5F5F7; border-radius: 8px;
  font-size: 12px; color: #1A1A1A;
}
.bar-btn {
  height: 32px; padding: 0 12px; border-radius: 8px;
  background-color: #F0F0F0;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.bar-btn-red { background-color: #FF0000; }
.bar-btn-red .bar-btn-text { color: #FFFFFF; }
.bar-btn-text { font-size: 12px; color: #1A1A1A; }

/* 中间区（唯一有左右内边距的地方，照设备连接的 .body） */
.body {
  padding: 12px 16px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 投屏区（圆角黑底，占满中间） */
.screen-block {
  width: 100%;
  height: 320px;
  background-color: #1A1A1A;
  border-radius: 10px;
  position: relative;
  overflow: hidden;
}
.screen-img { width: 100%; height: 100%; }
.screen-placeholder {
  position: absolute; left: 0; top: 0; right: 0; bottom: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
}
.ph-main { font-size: 14px; color: #FFFFFF; }
.ph-sub { font-size: 11px; color: #8A8A8A; margin-top: 6px; }
.crop-mask {
  position: absolute; left: 0; right: 0; top: 0;
  background-color: #F5F5F7;
}
.crop-mask-bottom { top: auto; bottom: 0; }
.log-overlay {
  position: absolute; left: 0; right: 0; bottom: 0;
  background-color: rgba(0, 0, 0, 0.55);
  padding: 6px 10px;
  max-height: 40%;
  overflow: hidden;
  border-radius: 0 0 10px 10px;
}
.log-line {
  display: block;
  font-size: 11px; color: #9FE8A0; line-height: 1.6;
  font-family: Consolas, ui-monospace, monospace;
  word-break: break-all;
}

/* 动作栏（全宽白块） */
.action-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background-color: #FFFFFF;
  margin-top: 1px;
  flex-shrink: 0;
}
.start-btn {
  flex: 1; height: 42px; border-radius: 10px;
  background-color: #FF0000;
  display: flex; align-items: center; justify-content: center;
}
.start-btn-running { background-color: #8A8A8A; }
.start-btn-text { font-size: 15px; font-weight: 500; color: #FFFFFF; }
.auto-toggle { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.auto-label { font-size: 13px; color: #1A1A1A; }
.switch-track {
  width: 40px; height: 22px; border-radius: 11px;
  background-color: #E0E0E0;
  padding: 2px;
  box-sizing: border-box;
}
.switch-on { background-color: #34C759; }
.switch-thumb {
  width: 18px; height: 18px; border-radius: 9px;
  background-color: #FFFFFF;
  transition: margin-left 0.15s;
}
.thumb-on { margin-left: 18px; }

/* 区块（全宽白块，无圆角、无外边距） */
.panel {
  background-color: #FFFFFF;
  padding: 14px 16px;
  margin-top: 1px;
}
.panel-title {
  display: block;
  font-size: 15px; font-weight: 500; color: #1A1A1A;
  margin-bottom: 8px;
}
.sub-title {
  display: block;
  font-size: 13px; font-weight: 500; color: #1A1A1A;
  margin: 16px 0 6px;
  padding-top: 10px;
  border-top: 1px solid #F0F0F0;
}
.row-between { display: flex; align-items: center; justify-content: space-between; }
.tiny { font-size: 11px; color: #999999; }
.tiny-red { font-size: 12px; color: #FF3B30; }

.kv {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 5px 0;
}
.k { font-size: 12px; color: #999999; }
.v { font-size: 12px; color: #1A1A1A; }
.v.ok { color: #34C759; font-weight: 500; }
.v.bad { color: #FF3B30; font-weight: 500; }
.mono { font-family: ui-monospace, Consolas, monospace; }

.mode-row { display: flex; gap: 8px; margin-top: 10px; }
.mode-btn {
  flex: 1; height: 32px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  background-color: #F0F0F0; color: #1A1A1A; font-size: 12px;
}
.mode-on { background-color: #1A1A1A; color: #FFFFFF; font-weight: 500; }
.err-line { margin-top: 8px; font-size: 11px; color: #FF3B30; }

.grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.op {
  flex: 1; min-width: 84px; height: 34px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  background-color: #F0F0F0; color: #1A1A1A; font-size: 12px;
}
.op-green { background-color: #E9F9EE; color: #18A058; }
.op-red   { background-color: #FFEDEC; color: #FF3B30; }

/* 日志 */
.log-box {
  height: 200px;
  background-color: #F5F5F7; border-radius: 8px;
  padding: 10px;
}
.log-empty {
  font-size: 11px; color: #C0C0C0;
  text-align: center; padding-top: 70px;
}

/* 弹窗（照设备连接：白色面板） */
.modal-overlay {
  position: fixed; left: 0; top: 0; right: 0; bottom: 0;
  background-color: rgba(0, 0, 0, 0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 99;
}
.modal-box {
  width: 88%;
  max-width: 420px;
  background-color: #FFFFFF;
  border-radius: 12px;
  padding: 18px;
  max-height: 80vh;
  overflow-y: auto;
}
.modal-title {
  display: block;
  font-size: 15px; font-weight: 500; color: #1A1A1A;
  margin-bottom: 12px;
}
.cfg-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #F0F0F0;
}
.cfg-label { font-size: 12px; color: #666666; }
.cfg-value { font-size: 12px; color: #999999; }
.cfg-input {
  width: 140px; height: 30px; padding: 0 8px;
  background-color: #F5F5F7; border-radius: 6px;
  font-size: 12px; color: #1A1A1A; text-align: right;
}
.modal-actions { display: flex; gap: 10px; margin-top: 16px; }
.modal-btn {
  flex: 1; height: 38px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px;
}
.modal-btn-cancel { background-color: #F0F0F0; color: #1A1A1A; }
.modal-btn-ok { background-color: #FF0000; color: #FFFFFF; }
</style>
