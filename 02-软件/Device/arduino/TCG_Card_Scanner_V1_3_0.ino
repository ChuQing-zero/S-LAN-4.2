/*
 * ═══════════════════════════════════════════════════════════════════
 *  TCG 卡牌扫描仪 - 串口控制版（电脑 USB 直连）
 *  ═══════════════════════════════════════════════════════════════════
 *  固件版本：V1.3.0（开放协议版）—— 电脑端发 ? 可查询版本号，用于对接校验
 *  V1.3.0：数码管升级——电脑端可发 D,文本 显示任意 ≤4 字符（数字/字母/错误码），
 *         在线时电脑端控制，主机离线自动回本地计数（离线测试功能不变）。
 *  基于 TCG_Card_Scanner_00_Chinese 改造，原版文件保留未动。
 *
 *  改造点：
 *   - 删除麦克风 (A2)
 *   - 用电脑串口（USB）发指令控制，不需要 ESP-01 / WiFi
 *   - 保留两个物理按钮：D3=复位计数，D6=扫描一张（同 c）
 *   - 板载 D13 指示灯：电机转 = 常亮，电机停 = 熄灭
 *   - 灯色：运行/等待卡 = 绿灯，卡通过计数 = 白灯，超时报警 = 红灯闪
 *   - 计数规则：按一次扫描（c / D6）→ 等一张卡通过 → 计数 +1 + 灯环变白
 *   - 一次扫描只计一张卡；没按扫描键时卡划过不计数
 *   - 机器默认一直启动；扫描后 8 秒内卡没通过才报警（只响一次）
 *
 *  ═══════════════════════════════════════════════════════════════════
 *  开放协议（V1.2）— 整行逗号分隔，电脑端可远程控制全部硬件资源，
 *  以后加功能只改电脑端程序，不用再刷固件。
 *  ═══════════════════════════════════════════════════════════════════
 *
 *  单字符（向后兼容）：
 *     s = 启动          t = 停止
 *     c = 扫描一张      r = 复位计数
 *     b = 蜂鸣器响一声（= B,1000,500,1）
 *     H = 握手（主机在线，Python 每 5 秒发一次保活）
 *     ? = 查询全部状态
 *
 *  带参数（首字符大写，逗号分隔）：
 *     M,dir,speed,ms      电机: dir=F正转/R反转/S停, speed=0-255, ms=时长(0=一直转)
 *     L,color,mode,times  灯环: color=red/green/blue/yellow/white/cyan/magenta/
 *                               orange/off 或 6位hex如 FF00FF;
 *                               mode=solid常亮/blink闪烁/breath呼吸/flow流水;
 *                               times=循环次数(0=无限)
 *     B,freq,ms,times     蜂鸣器档位: freq=频率Hz(如1000), ms=时长(如500), times=次数(0=无限)
 *     O,on|off            板载 D13 LED 开关（on=常亮 off=灭；不发 O 时自动跟随电机）
 *     D,1234/BUSY/STOP/E001  数码管显示任意 ≤4 字符（数字/字母/错误码）：
 *                              在线时电脑端发什么显示什么，固定到下次再发；
 *                              主机离线后自动回到本地计数（离线测试原功能）。
 *     Q,ldr               读光敏电阻: 回传 当前值/基准/百分比
 *
 *  事件上报（Arduino → 电脑）：
 *     [握手] 主机在线         电脑连接成功后收到 H 的回执
 *     [主机] 在线 / [主机] 离线  连线检测状态变化
 *     [按钮] D6 / [按钮] D3   物理按钮按下事件（电脑端可自由赋值功能）
 *     [传感器] LDR=xxx 基准=xxx (xx%)    Q,ldr 的回执
 *     [查询] 计数=N 状态=xx 电机=xx 主机=xx 光敏=xxx/xxx(xx%)
 *
 *  连线检测：电脑串口发过任何数据 → 主机在线；超过 15 秒没收到任何
 *  串口数据 → 判定离线。在线时按钮只上报事件不执行动作（防误触）；
 *  离线（独立供电/演示）时按钮恢复原功能（扫描/复位）。
 *
 *  使用步骤：
 *    1. USB 线连电脑，Arduino IDE 选好板子和端口，直接上传
 *    2. 打开串口监视器（波特率 9600，右下角选"换行"）
 *    3. 输入 c 或按 D6 扫描一张，再让卡通过光敏 → 计数 +1；r / D3 复位
 * ═══════════════════════════════════════════════════════════════════
 */

#include <TM1637Display.h>
#include <Adafruit_NeoPixel.h>

// ── 引脚分配 ──
const int ENA = 9;
const int IN1 = 8;
const int IN2 = 7;

// ── 电机控制旋钮 ──
const int motorSpeed = 255;              // PWM 速度 0~255，越小越慢（默认约 60%）
const unsigned long pushDuration = 600; // 前推时间(ms)：把卡推向光敏
const unsigned long rollbackTime = 0; // 反向回退时间(ms)：把下一张卡拉离光敏，让光敏看到"亮"
const unsigned long minForwardTime = 200; // 电机前推最短时间(ms)：卡在边缘也要至少推这么久才允许判定通过
const unsigned long alarmWait = 1000;     // 电机动作(前推+回退)结束后再等这么久(ms)才拉报警

// ── 光敏阈值（都用百分比，方便对环境光暗/亮调整）──
// 遮挡报警解除条件：读数 > 基准 × 该% 就认为"没遮挡"。
const int ldrRecoverPct = 20;   // 默认 20%，调低(10/5)更易恢复，调高(40/60)更严格

// 遮挡报警触发条件：读数 < 基准 × 该% 才判定"被遮挡"。
const int ldrBlockPct = 70;
const unsigned long ldrDebounce = 300;   // 遮挡/解除 判定防抖(ms)
unsigned long ldrBlockTimer = 0;
const int buzzerPin = 11;
const int ldrPin = A7;
const int displayClkPin = 4;
const int displayDioPin = 5;
const int statusLedPin = 13;   // 板载 LED：电机转=常亮，电机停=熄灭（O 指令可覆盖）
const int buttonResetPin = 3;         // 按钮1：复位计数（按下接地）
const int buttonManualTrigger = 6;    // 按钮2：启动/停止切换（按下接地）

// ── 显示屏 / 灯环 ──
TM1637Display display(displayClkPin, displayDioPin);
Adafruit_NeoPixel ledRing(8, A0, NEO_GRB + NEO_KHZ800);

// ── 扫描仪状态变量 ──
int cardCount = 0;
bool motorRunning = false;
unsigned long lastButtonPress = 0;    // 启停按钮防抖
unsigned long lastResetPress = 0;     // 复位按钮防抖
bool scannerActive = false;
bool cardInPosition = false;
bool timeoutMode = false;
bool ldrBlocked = false;         // 待命时实时监测：光敏被遮挡 → 短鸣循环报警
bool waitingForCard = false;   // 信号后正在等卡通过；只有此期间超时报警才会触发
unsigned long lastCardDetectedTime = 0;
unsigned long lastCardMovedTime = 0;
// 报警等待 = 电机前推 + 回退 + 额外1秒；改上面旋钮会自动跟着变
const unsigned long timeoutDuration = pushDuration + rollbackTime + alarmWait;
const unsigned long cardCountDelay = 1000;
unsigned long lastCardCountTime = 0;
unsigned long lastMotorStartTime = 0;    // 本次推卡开始时间（用于限时停止）

// ── 状态广播（给网页控制台用）──
const unsigned long statusInterval = 100;  // 0.1 秒
unsigned long lastStatusTime = 0;

// ── 电机相位状态机：前推 → 回退 → 停 ──
enum MotorPhase { MOTOR_IDLE, MOTOR_FORWARD, MOTOR_REVERSE };
MotorPhase motorPhase = MOTOR_IDLE;
unsigned long motorPhaseStart = 0;       // 当前相位开始时间
int baseLdrValue;

// ═══════════════════════════════════════════════════════════════════
//  开放协议：主机在线检测 / 手动控制 / 通用灯效 / 蜂鸣档位
// ═══════════════════════════════════════════════════════════════════
const char* FIRMWARE_VERSION = "V1.3.0";  // 固件版本号：电脑端发 ? 查询可读到，用于对接校验
bool hostConnected = false;          // 主机（电脑串口）是否在线
unsigned long lastHostContact = 0;   // 最近一次收到串口数据的时间
const unsigned long hostTimeoutMs = 15000;  // 15 秒无串口数据 → 判定离线
bool displayRemote = false;          // 数码管是否由电脑端接管（收到 D 指令后置 true，主机离线复位）

unsigned long manualMotorUntil = 0;  // 手动电机持续到的时间（0=一直转）
int ledManualOn = -1;                // 板载 LED 手动覆盖：-1=自动(跟随电机) 0=灭 1=亮

// 通用灯环状态机（非阻塞）
enum LightMode { LIGHT_OFF, LIGHT_SOLID, LIGHT_BLINK, LIGHT_BREATH, LIGHT_FLOW };
struct CustomLight {
  LightMode mode = LIGHT_OFF;
  uint8_t r = 255, g = 255, b = 255;  // 当前颜色
  int times = 0;                      // 剩余循环次数，0=无限
  unsigned long lastTick = 0;
  bool on = false;
  int breathVal = 255, breathDir = -1;
  int flowPos = 0;
} customLight;

// 蜂鸣器状态机（非阻塞，支持多档连响）
struct BeepCtrl {
  bool active = false;
  int freq = 1000, ms = 200, times = 0;
  unsigned long lastChange = 0;
  bool sounding = false;
} beepCtrl;

// ── 灯光控制（原有）──
const int reasonBrightness = 255;
unsigned long dimmingStartTime = 0;
const unsigned long dimmingDuration = 5000;
bool isDimmed = false;
unsigned long colorFadeTime = 0;
int fadeStep = 0;

// 开机序列 (1-5)
const int startup = 5;

// ═══════════════════════════════════════════════════════════════════
//  setup
// ═══════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(9600);

  pinMode(ENA, OUTPUT);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(buzzerPin, OUTPUT);
  pinMode(ldrPin, INPUT);
  pinMode(statusLedPin, OUTPUT);   // 状态指示灯
  pinMode(buttonResetPin, INPUT_PULLUP);
  pinMode(buttonManualTrigger, INPUT_PULLUP);

  ledRing.begin();
  setLightRed(reasonBrightness);   // 用红光校准光敏电阻
  ledRing.show();

  analogWrite(ENA, motorSpeed);   // PWM 调速
  display.setBrightness(0x0f);
  display.showNumberDec(cardCount);

  delay(500);
  baseLdrValue = analogRead(ldrPin);
  Serial.print(F("Basis LDR-Wert: "));
  Serial.println(baseLdrValue);
  Serial.print(F("电机速度 = "));
  Serial.print(motorSpeed);
  Serial.print(F(" (0-255)，前推 = "));
  Serial.print(pushDuration);
  Serial.print(F(" ms，回退 = "));
  Serial.print(rollbackTime);
  Serial.print(F(" ms，最短前推 = "));
  Serial.print(minForwardTime);
  Serial.print(F(" ms，报警等待 = "));
  Serial.print(timeoutDuration);
  Serial.print(F(" ms，光敏恢复阈值 = 基准的 "));
  Serial.print(ldrRecoverPct);
  Serial.print(F("% (≈"));
  Serial.print((long)baseLdrValue * ldrRecoverPct / 100);
  Serial.print(F(")，遮挡判定 = 基准的 "));
  Serial.print(ldrBlockPct);
  Serial.print(F("% (≈"));
  Serial.print((long)baseLdrValue * ldrBlockPct / 100);
  Serial.println(F(")"));

  // 打印指令帮助
  Serial.println(F("============== TCG Scanner 串口控制 =============="));
  Serial.print(F("固件版本 ")); Serial.println(FIRMWARE_VERSION);
  Serial.println(F("  s 启动  t 停止  c 扫描一张  r 复位  b 蜂鸣一声"));
  Serial.println(F("  H 握手(主机在线)  ? 查询状态"));
  Serial.println(F("  M,dir,speed,ms 电机  L,color,mode,times 灯环"));
  Serial.println(F("  B,freq,ms,times 蜂鸣  O,on/off 板载LED  D,num 数码管  Q,ldr 光敏"));
  Serial.println(F("  按钮: 离线=扫描/复位, 在线=仅上报事件(防误触)"));
  Serial.println(F("=================================================="));

  // 开机动画
  switch (startup) {
    case 1: startupSequence1(); break;
    case 2: startupSequence2(); break;
    case 3: startupSequence3(); break;
    case 4: startupSequence4(); break;
    case 5: startupSequence5(); break;
    default: startupSequence1(); break;
  }

  // 默认一直启动：开机即为"已启动、未武装"状态，按扫描键（c/D6）才计一张
  scannerActive = true;
  setLightWhite(reasonBrightness);   // 运行/待命 = 白灯
  delay(50);
  baseLdrValue = analogRead(ldrPin);   // 白色下校准光敏基准
}

// ═══════════════════════════════════════════════════════════════════
//  loop
// ═══════════════════════════════════════════════════════════════════
void loop() {
  handleSerialCommand();   // 处理电脑发来的串口指令（整行解析）
  handleButtons();         // 处理两个物理按钮（事件上报 + 离线才动作）

  checkHostTimeout();      // 15 秒无串口数据 → 判定主机离线

  // 手动电机超时停止
  if (manualMotorUntil > 0 && millis() > manualMotorUntil) {
    manualMotorUntil = 0;
    stopMotor();
  }

  // 状态指示灯：电机转=亮，电机停=灭（O 指令可手动覆盖）
  if (ledManualOn >= 0) {
    digitalWrite(statusLedPin, ledManualOn ? HIGH : LOW);
  } else {
    digitalWrite(statusLedPin, motorRunning ? HIGH : LOW);
  }

  // 状态广播：每隔 statusInterval 毫秒把当前状态发给网页控制台
  if (statusInterval > 0 && millis() - lastStatusTime >= statusInterval) {
    lastStatusTime = millis();
    sendStatus();
  }

  int ldrValue = analogRead(ldrPin);
  // Serial.println(ldrValue);   // 注释掉刷屏

  // 未激活时确保电机停
  if (!scannerActive && motorRunning) {
    stopMotor();
  }

  // 电机相位推进：前推 pushDuration → 回退 rollbackTime → 停
  switch (motorPhase) {
    case MOTOR_FORWARD:
      if (millis() - motorPhaseStart >= pushDuration) {
        motorPhase = MOTOR_REVERSE;
        motorPhaseStart = millis();
        digitalWrite(IN1, HIGH);   // 反转
        digitalWrite(IN2, LOW);
        analogWrite(ENA, motorSpeed);
        Serial.println(F("[回退] 前推超时，反向回退让光敏复位"));
      }
      break;
    case MOTOR_REVERSE:
      if (millis() - motorPhaseStart >= rollbackTime) {
        stopMotor();
        Serial.println(F("[回退] 回退结束，电机停"));
      }
      break;
    case MOTOR_IDLE:
      break;
  }

  // 扫描仪激活 + 本次扫描已武装（等一张卡通过）时才检测
  if (scannerActive && waitingForCard) {
    if (!cardInPosition && ldrValue < baseLdrValue - 50) {
      cardInPosition = true;
      lastCardDetectedTime = millis();
    }
    if (cardInPosition && ldrValue > baseLdrValue - 30) {
      bool minPushDone = (motorPhase != MOTOR_FORWARD)
                       || (millis() - motorPhaseStart >= minForwardTime);
      if (minPushDone) {
        stopMotor();
        // ✅ 卡成功通过 = 计数 +1 + 解除武装 + 亮白灯（数码管被电脑端接管时不自动改）
        cardCount++;
        if (!displayRemote) display.showNumberDec(cardCount);
        Serial.print(F("[成功] 卡通过 → 计数 = "));
        Serial.println(cardCount);
        waitingForCard = false;
        timeoutMode = false;
        isDimmed = false;
        lastCardMovedTime = millis();
        setLightGreen(255);          // 成功 → 绿闪 0.1s
        delay(100);
        setLightWhite(255);          // 回到白色待命
        delay(50);
        cardInPosition = false;
      }
    }
    if (millis() - lastCardMovedTime > timeoutDuration && !timeoutMode) {
      timeoutMode = true;
      waitingForCard = false;
      isDimmed = false;
      stopMotor();
      Serial.println(F("[报警] 8 秒内没有卡通过"));
      tone(buzzerPin, 1000, 500);
    }
  }

  // 超时模式闪烁
  if (timeoutMode) {
    blinkRedLEDAndSoundBuzzer();
  }

  // 待命实时监测：光敏被遮挡 → 短鸣循环报警，直到恢复无遮挡
  if (scannerActive && !waitingForCard && !timeoutMode) {
    bool nowBlocked = (ldrValue < (long)baseLdrValue * ldrBlockPct / 100);
    if (!ldrBlocked && nowBlocked) {
      if (ldrBlockTimer == 0) ldrBlockTimer = millis();
      if (millis() - ldrBlockTimer >= ldrDebounce) {
        ldrBlocked = true;
        ldrBlockTimer = 0;
        Serial.println(F("[遮挡] 光敏被遮挡，短鸣报警中..."));
      }
    } else if (ldrBlocked && !nowBlocked) {
      if (ldrBlockTimer == 0) ldrBlockTimer = millis();
      if (millis() - ldrBlockTimer >= ldrDebounce) {
        ldrBlocked = false;
        ldrBlockTimer = 0;
        Serial.println(F("[遮挡] 遮挡已解除"));
        setLightWhite(255);          // 恢复白色待命
      }
    } else {
      ldrBlockTimer = 0;
    }
  }
  if (ldrBlocked && scannerActive && !waitingForCard && !timeoutMode) {
    obstructionAlarmBlink();       // 红色闪烁 + 短鸣循环
  }

  // 暂停模式 - 灯光平滑变化
  if (!scannerActive && !timeoutMode) {
    fadeLights();
  }

  if (isDimmed) {
    dimLights();
  }

  // 开放协议：通用灯效 / 蜂鸣档位（非阻塞推进，系统报警优先）
  updateCustomLight();
  updateBeep();
}

// ═══════════════════════════════════════════════════════════════════
//  状态广播（给网页控制台显示状态灯 / 报警）
// ═══════════════════════════════════════════════════════════════════
void sendStatus() {
  Serial.print(F("[状态] "));
  if (timeoutMode)            Serial.print(F("报警"));
  else if (ldrBlocked)        Serial.print(F("遮挡"));
  else if (waitingForCard)    Serial.print(F("等待卡"));
  else if (scannerActive)     Serial.print(F("待命"));
  else                        Serial.print(F("已停止"));
  Serial.println();
}

// ═══════════════════════════════════════════════════════════════════
//  串口指令解析（整行，支持单字符兼容 + 带参数指令）
// ═══════════════════════════════════════════════════════════════════
String lineBuf = "";

void handleSerialCommand() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n') {
      if (lineBuf.length() > 0) {
        parseCommand(lineBuf);
        lineBuf = "";
      }
    } else if (ch != '\r') {
      lineBuf += ch;
      if (lineBuf.length() > 64) lineBuf = "";   // 防异常数据刷爆内存
    }
    // 收到任何串口数据 → 主机在线（刷新超时计时）
    if (!hostConnected) {
      hostConnected = true;
      Serial.println(F("[主机] 在线"));
    }
    lastHostContact = millis();
  }
}

void parseCommand(String cmd) {
  if (cmd.length() == 1) {
    // 单字符指令（向后兼容 + 新增 H / ?）
    switch (cmd.charAt(0)) {
      case 's': case 'S':
        doStart();
        Serial.println(F("[指令] 启动"));
        break;
      case 't': case 'T':
        doStop();
        Serial.println(F("[指令] 停止"));
        break;
      case 'c': case 'C':
        doScan();
        Serial.print(F("[指令] 扫描一张，计数 = "));
        Serial.println(cardCount);
        break;
      case 'r': case 'R':
        doReset();
        Serial.println(F("[指令] 复位计数 = 0"));
        break;
      case 'b': case 'B':
        startBeep(1000, 500, 1);          // 蜂鸣一声
        Serial.println(F("[指令] 前端报警（蜂鸣器）"));
        break;
      case 'H': case 'h':
        Serial.println(F("[握手] 主机在线"));
        break;
      case '?':
        reportStatus();
        break;
      default:
        break;   // 忽略换行、回车、其它字符
    }
    return;
  }

  // 带参数指令：前缀,参数1,参数2...
  int comma = cmd.indexOf(',');
  String prefix = (comma < 0) ? cmd : cmd.substring(0, comma);
  String args = (comma < 0) ? "" : cmd.substring(comma + 1);

  if (prefix.equalsIgnoreCase("M")) {
    cmdMotor(args);
  } else if (prefix.equalsIgnoreCase("L")) {
    cmdLight(args);
  } else if (prefix.equalsIgnoreCase("B")) {
    cmdBeep(args);
  } else if (prefix.equalsIgnoreCase("O")) {
    cmdLed(args);
  } else if (prefix.equalsIgnoreCase("D")) {
    cmdDisplay(args);
  } else if (prefix.equalsIgnoreCase("Q")) {
    cmdSensor(args);
  } else {
    Serial.print(F("[指令] 未知: ")); Serial.println(cmd);
  }
}

// ── 带参数指令实现 ──

/** 取逗号分隔第 idx 个参数（从 0 开始），取不到返回空串 */
String getArg(String args, int idx) {
  int start = 0;
  for (int i = 0; i < idx; i++) {
    int p = args.indexOf(',', start);
    if (p < 0) return "";
    start = p + 1;
  }
  int p = args.indexOf(',', start);
  if (p < 0) return args.substring(start);
  return args.substring(start, p);
}

/** 电机: M,F/R/S,speed(0-255),ms(0=一直转) */
void cmdMotor(String args) {
  String dir = getArg(args, 0);
  if (dir.length() == 0) { Serial.println(F("[电机] 用法 M,F/R/S,speed,ms")); return; }
  int speed = getArg(args, 1).toInt();
  unsigned long ms = getArg(args, 2).toInt();
  char d = dir.charAt(0);
  if (d == 'S' || d == 's') {
    stopMotor();
    Serial.println(F("[电机] 停"));
    return;
  }
  manualMotorUntil = 0;
  if (motorPhase != MOTOR_IDLE) stopMotor();
  digitalWrite(IN1, (d == 'F' || d == 'f') ? LOW : HIGH);
  digitalWrite(IN2, (d == 'F' || d == 'f') ? HIGH : LOW);
  analogWrite(ENA, speed);
  motorRunning = true;
  if (ms > 0) manualMotorUntil = millis() + ms;
  Serial.print(F("[电机] "));
  if (d == 'F' || d == 'f') Serial.print(F("正转")); else Serial.print(F("反转"));
  Serial.print(F(" 速度="));
  Serial.print(speed);
  if (ms > 0) { Serial.print(F(" 时长=")); Serial.print(ms); Serial.println(F("ms")); }
  else Serial.println(F(" 持续"));
}

/** 灯环: L,color,mode,times */
void cmdLight(String args) {
  String colorStr = getArg(args, 0);
  String modeStr = getArg(args, 1);
  int times = getArg(args, 2).toInt();
  uint8_t r, g, b;
  if (!parseColor(colorStr, r, g, b)) {
    Serial.print(F("[灯环] 颜色不识别: ")); Serial.print(colorStr); Serial.println(F(" (用 red/blink 或 6位hex)"));
    return;
  }
  setCustomLight(r, g, b, modeStr, times);
}

/** 蜂鸣器档位: B,freq,ms,times */
void cmdBeep(String args) {
  int freq = getArg(args, 0).toInt();
  int ms = getArg(args, 1).toInt();
  int times = getArg(args, 2).toInt();
  if (freq < 31) freq = 1000;      // tone 最低约 31Hz，防非法值
  if (ms <= 0) ms = 200;
  if (times < 0) times = 0;
  startBeep(freq, ms, times);
  Serial.print(F("[蜂鸣] "));
  Serial.print(freq);
  Serial.print(F("Hz "));
  Serial.print(ms);
  Serial.print(F("ms x"));
  if (times == 0) Serial.println(F("∞")); else Serial.println(times);
}

/** 板载 LED: O,on/off */
void cmdLed(String args) {
  String v = getArg(args, 0);
  v.toLowerCase();
  if (v == "on" || v == "1") { ledManualOn = 1; Serial.println(F("[LED] 板载灯常亮")); }
  else if (v == "off" || v == "0") { ledManualOn = 0; Serial.println(F("[LED] 板载灯灭")); }
  else if (v == "auto") { ledManualOn = -1; Serial.println(F("[LED] 板载灯自动(跟随电机)")); }
  else { Serial.println(F("[LED] 用法 O,on/off/auto")); }
  digitalWrite(statusLedPin, ledManualOn == 1 ? HIGH : ledManualOn == 0 ? LOW : (motorRunning ? HIGH : LOW));
}

/** 数码管: D,文本（任意 ≤4 字符：数字/字母/错误码，如 D,0001 D,BUSY D,STOP D,E001）
 *  在线时电脑端发什么就显示什么，固定到下次再发；主机离线后自动回本地计数。 */
void cmdDisplay(String args) {
  String v = getArg(args, 0);
  v.toUpperCase();
  displayRemote = true;          // 电脑端接管数码管，本地成功/复位不再自动改
  showText(v, 4);
  Serial.print(F("[数码管] 显示 "));
  Serial.println(v);
}

/** 单个字符 → 7段码；无法显示的字符返回 0（该位熄灭） */
uint8_t charSeg(char c) {
  switch (c) {
    case '0': return 0x3F;
    case '1': return 0x06;
    case '2': return 0x5B;
    case '3': return 0x4F;
    case '4': return 0x66;
    case '5': return 0x6D;
    case '6': return 0x7D;
    case '7': return 0x07;
    case '8': return 0x7F;
    case '9': return 0x6F;
    case 'O': return 0x3F;                       // O = 0
    case 'A': case 'a': return 0x77;
    case 'b': return 0x7C;
    case 'C': case 'c': return 0x39;
    case 'd': return 0x5E;
    case 'E': case 'e': return 0x79;
    case 'F': case 'f': return 0x71;
    case 'G': case 'g': return 0x3D;
    case 'H': case 'h': return 0x76;
    case 'I': return 0x30;                       // 中横 + 右竖
    case 'J': return 0x1E;
    case 'L': case 'l': return 0x38;
    case 'N': case 'n': return 0x54;             // n（7段无标准 N，用 n 近似）
    case 'P': return 0x73;
    case 'q': return 0x67;
    case 'r': return 0x50;
    case 'S': case 's': return 0x6D;
    case 'T': case 't': return 0x78;             // t 形态
    case 'U': case 'u': return 0x3E;
    case 'Y': return 0x6E;
    case '-': return 0x40;
    case '_': return 0x08;
    case ' ': return 0x00;
    default: return 0x00;
  }
}

/** 在 4 位数码管上显示文本（左起，不足 4 位右侧补空格熄灭） */
void showText(String s, int maxLen) {
  uint8_t seg[4] = {0, 0, 0, 0};
  int n = s.length();
  for (int i = 0; i < maxLen; i++) {
    char c = (i < n) ? s.charAt(i) : ' ';
    seg[i] = charSeg(c);
  }
  display.setSegments(seg, maxLen, 0);
}

/** 传感器: Q,ldr 等 */
void cmdSensor(String args) {
  String what = getArg(args, 0);
  what.toLowerCase();
  if (what == "ldr" || what == "") {
    reportLdr();
  } else {
    Serial.println(F("[传感器] 可用: Q,ldr"));
  }
}

// ═══════════════════════════════════════════════════════════════════
//  主机在线检测：15 秒无串口数据 → 离线
// ═══════════════════════════════════════════════════════════════════
void checkHostTimeout() {
  if (hostConnected && millis() - lastHostContact > hostTimeoutMs) {
    hostConnected = false;
    displayRemote = false;                 // 主机离线 → 数码管交回本地（计数）
    display.showNumberDec(cardCount);
    Serial.println(F("[主机] 离线"));
  }
}

// ═══════════════════════════════════════════════════════════════════
//  物理按钮（D6 扫描 / D3 复位）— 事件上报 + 离线才执行动作
// ═══════════════════════════════════════════════════════════════════
void handleButtons() {
  // 按钮2 (D6)：扫描一张（= 串口 c）
  if (digitalRead(buttonManualTrigger) == LOW) {
    if (millis() - lastButtonPress > 300) {
      lastButtonPress = millis();
      Serial.println(F("[按钮] D6"));            // 事件上报（电脑端可自由赋值）
      if (!hostConnected) {
        doScan();
        Serial.println(F("[按钮] 扫描一张，等卡通过"));
      } else {
        Serial.println(F("[按钮] 主机在线，动作由电脑端决定"));
      }
    }
  }
  // 按钮1 (D3)：复位计数
  if (digitalRead(buttonResetPin) == LOW && millis() - lastResetPress > 300) {
    lastResetPress = millis();
    Serial.println(F("[按钮] D3"));            // 事件上报
    if (!hostConnected) {
      doReset();
      Serial.println(F("[按钮] 复位计数 = 0"));
    } else {
      Serial.println(F("[按钮] 主机在线，动作由电脑端决定"));
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  动作（原有逻辑不变）
// ═══════════════════════════════════════════════════════════════════
void doStart() {
  scannerActive = true;
  timeoutMode = false;
  waitingForCard = true;
  cardInPosition = false;
  isDimmed = false;
  ldrBlocked = false;
  setLightYellow(255);
  delay(100);
  setLightWhite(255);
  delay(50);
  baseLdrValue = analogRead(ldrPin);
  moveCard();
  lastCardDetectedTime = millis();
  lastCardMovedTime = millis();
}

void doStop() {
  scannerActive = false;
  stopMotor();
  timeoutMode = false;
  waitingForCard = false;
  isDimmed = false;
}

void doScan() {
  isDimmed = false;
  ldrBlocked = false;
  setLightYellow(255);
  delay(100);
  setLightWhite(255);
  if (!scannerActive) scannerActive = true;
  waitingForCard = true;
  cardInPosition = false;
  timeoutMode = false;
  delay(50);
  baseLdrValue = analogRead(ldrPin);
  moveCard();
  lastCardMovedTime = millis();
}

void doReset() {
  cardCount = 0;
  if (!displayRemote) display.showNumberDec(cardCount);   // 被电脑端接管时保持电脑端显示

  int nowLdr = analogRead(ldrPin);
  Serial.print(F("[复位] 当前光敏读数 = "));
  Serial.print(nowLdr);
  Serial.print(F(" / 基准 "));
  Serial.print(baseLdrValue);
  Serial.print(F(" → "));
  if (baseLdrValue > 0) {
    long pct = (long)nowLdr * 100L / baseLdrValue;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    Serial.print(pct);
    Serial.println(F("%"));
  } else {
    Serial.println(F("(基准未校准)"));
  }
}

// ═══════════════════════════════════════════════════════════════════
//  电机控制
// ═══════════════════════════════════════════════════════════════════
void moveCard() {
  manualMotorUntil = 0;          // 手动电机被扫描接管
  if (scannerActive && !timeoutMode) {
    motorPhase = MOTOR_FORWARD;
    motorPhaseStart = millis();
    digitalWrite(IN1, LOW);
    digitalWrite(IN2, HIGH);                 // 前进 = 推卡
    analogWrite(ENA, motorSpeed);
    motorRunning = true;
    lastMotorStartTime = millis();
  }
}

void stopMotor() {
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
  motorRunning = false;
  motorPhase = MOTOR_IDLE;
}

// ═══════════════════════════════════════════════════════════════════
//  通用灯环（开放协议）
// ═══════════════════════════════════════════════════════════════════
void fillRGB(uint8_t r, uint8_t g, uint8_t b) {
  for (int i = 0; i < ledRing.numPixels(); i++) {
    ledRing.setPixelColor(i, ledRing.Color(r, g, b));
  }
  ledRing.show();
}

/** 解析颜色：预设色名 / off / 6位hex（如 FF00FF） */
bool parseColor(String s, uint8_t &r, uint8_t &g, uint8_t &b) {
  s.toLowerCase();
  static const char* names[] = {"red", "green", "blue", "yellow", "white",
                                "cyan", "magenta", "orange", "off"};
  static const uint8_t vals[9][3] = {
    {255,0,0}, {0,255,0}, {0,0,255}, {255,255,0}, {255,255,255},
    {0,255,255}, {255,0,255}, {255,127,0}, {0,0,0}
  };
  for (int i = 0; i < 9; i++) {
    if (s == names[i]) { r = vals[i][0]; g = vals[i][1]; b = vals[i][2]; return true; }
  }
  if (s.startsWith("#")) s = s.substring(1);
  if (s.length() == 6) {
    long v = strtol(s.c_str(), NULL, 16);
    r = (v >> 16) & 0xFF;
    g = (v >> 8) & 0xFF;
    b = v & 0xFF;
    return true;
  }
  return false;
}

/** 设置自定义灯效（非阻塞） */
void setCustomLight(uint8_t r, uint8_t g, uint8_t b, String modeStr, int times) {
  modeStr.toLowerCase();
  if (modeStr == "solid" || modeStr == "" ) {
    customLight.mode = LIGHT_SOLID;
  } else if (modeStr == "blink") {
    customLight.mode = LIGHT_BLINK;
  } else if (modeStr == "breath") {
    customLight.mode = LIGHT_BREATH;
    customLight.breathVal = 255;
    customLight.breathDir = -1;
  } else if (modeStr == "flow") {
    customLight.mode = LIGHT_FLOW;
    customLight.flowPos = 0;
  } else if (modeStr == "off") {
    customLight.mode = LIGHT_OFF;
    fillRGB(0, 0, 0);
    return;
  } else {
    Serial.print(F("[灯环] 模式不识别: ")); Serial.println(modeStr);
    return;
  }
  customLight.r = r;
  customLight.g = g;
  customLight.b = b;
  customLight.times = (times == 0) ? 0 : times;   // 0=无限
  customLight.lastTick = millis();
  customLight.on = false;
  if (customLight.mode == LIGHT_SOLID) fillRGB(r, g, b);
  Serial.println(F("[灯环] 已设置"));
}

/** 推进自定义灯效（每帧调用，非阻塞；系统报警时暂停） */
void updateCustomLight() {
  if (customLight.mode == LIGHT_OFF) return;
  if (timeoutMode || ldrBlocked) return;      // 系统报警优先
  unsigned long now = millis();

  switch (customLight.mode) {
    case LIGHT_SOLID:
      fillRGB(customLight.r, customLight.g, customLight.b);   // 每帧重绘，业务瞬时光被覆盖回来
      break;
    case LIGHT_BLINK:
      if (now - customLight.lastTick >= 500) {
        customLight.lastTick = now;
        customLight.on = !customLight.on;
        if (customLight.on) {
          fillRGB(customLight.r, customLight.g, customLight.b);
        } else {
          fillRGB(0, 0, 0);
          if (customLight.times > 0) {          // 完成一个亮灭周期
            customLight.times--;
            if (customLight.times == 0) customLight.mode = LIGHT_OFF;
          }
        }
      }
      break;
    case LIGHT_BREATH:
      if (now - customLight.lastTick >= 20) {
        customLight.lastTick = now;
        customLight.breathVal += customLight.breathDir * 5;
        if (customLight.breathVal >= 255) {
          customLight.breathVal = 255;
          customLight.breathDir = -1;
        } else if (customLight.breathVal <= 0) {
          customLight.breathVal = 0;
          customLight.breathDir = 1;
          if (customLight.times > 0) {          // 完成一个呼吸
            customLight.times--;
            if (customLight.times == 0) customLight.mode = LIGHT_OFF;
          }
        }
        int v = customLight.breathVal;
        fillRGB(customLight.r * v / 255, customLight.g * v / 255, customLight.b * v / 255);
      }
      break;
    case LIGHT_FLOW:
      if (now - customLight.lastTick >= 100) {
        customLight.lastTick = now;
        ledRing.clear();
        ledRing.setPixelColor(customLight.flowPos,
                              ledRing.Color(customLight.r, customLight.g, customLight.b));
        ledRing.show();
        customLight.flowPos = (customLight.flowPos + 1) % ledRing.numPixels();
        if (customLight.flowPos == 0 && customLight.times > 0) {  // 转完一圈
          customLight.times--;
          if (customLight.times == 0) {
            customLight.mode = LIGHT_OFF;
            fillRGB(0, 0, 0);
          }
        }
      }
      break;
    default:
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  通用蜂鸣器（开放协议，非阻塞，支持档位连响）
// ═══════════════════════════════════════════════════════════════════
void startBeep(int freq, int ms, int times) {
  beepCtrl.active = true;
  beepCtrl.freq = freq;
  beepCtrl.ms = ms;
  beepCtrl.times = times;
  beepCtrl.lastChange = millis();
  beepCtrl.sounding = true;
  tone(buzzerPin, freq, ms);
}

void updateBeep() {
  if (!beepCtrl.active) return;
  if (timeoutMode || ldrBlocked) return;      // 系统报警时暂停用户蜂鸣
  unsigned long now = millis();
  if (beepCtrl.sounding) {
    if (now - beepCtrl.lastChange >= beepCtrl.ms) {
      beepCtrl.sounding = false;
      noTone(buzzerPin);
      beepCtrl.lastChange = now;
      if (beepCtrl.times > 0) {
        beepCtrl.times--;
        if (beepCtrl.times == 0) {
          beepCtrl.active = false;
          return;
        }
      }
    }
  } else {
    if (now - beepCtrl.lastChange >= 150) {   // 间隔 150ms
      beepCtrl.sounding = true;
      beepCtrl.lastChange = now;
      tone(buzzerPin, beepCtrl.freq, beepCtrl.ms);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  状态 / 传感器上报
// ═══════════════════════════════════════════════════════════════════
void reportStatus() {
  Serial.print(F("[查询] 固件="));
  Serial.print(FIRMWARE_VERSION);
  Serial.print(F(" 计数="));
  Serial.print(cardCount);
  Serial.print(F(" 状态="));
  if (timeoutMode)            Serial.print(F("报警"));
  else if (ldrBlocked)        Serial.print(F("遮挡"));
  else if (waitingForCard)    Serial.print(F("等待卡"));
  else if (scannerActive)     Serial.print(F("待命"));
  else                        Serial.print(F("已停止"));
  Serial.print(F(" 电机="));
  if (motorRunning) Serial.print(F("转")); else Serial.print(F("停"));
  Serial.print(F(" 主机="));
  if (hostConnected) Serial.print(F("在线")); else Serial.print(F("离线"));
  Serial.print(F(" 灯环="));
  if (customLight.mode == LIGHT_OFF) Serial.print(F("系统")); else Serial.print(F("自定义"));
  Serial.print(F(" 蜂鸣="));
  if (beepCtrl.active) Serial.print(F("响")); else Serial.print(F("off"));
  Serial.print(F(" 光敏="));
  reportLdrValueInline();
}

void reportLdr() {
  Serial.print(F("[传感器] "));
  reportLdrValueInline();
}

void reportLdrValueInline() {
  int nowLdr = analogRead(ldrPin);
  Serial.print(F("LDR="));
  Serial.print(nowLdr);
  Serial.print(F(" 基准="));
  Serial.print(baseLdrValue);
  if (baseLdrValue > 0) {
    long pct = (long)nowLdr * 100L / baseLdrValue;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    Serial.print(F("("));
    Serial.print(pct);
    Serial.print(F("%)"));
  }
  Serial.println();
}

// ═══════════════════════════════════════════════════════════════════
//  灯光 / 声音（原有）
// ═══════════════════════════════════════════════════════════════════
void blinkRedLEDAndSoundBuzzer() {
  static unsigned long lastBlinkTime = 0;
  unsigned long currentMillis = millis();
  if (currentMillis - lastBlinkTime >= 500) {
    lastBlinkTime = currentMillis;
    static bool ledState = false;
    ledState = !ledState;

    if (ledState) {
      setLightRed(255);
      tone(buzzerPin, 1000, 100);
    } else {
      ledRing.clear();
      noTone(buzzerPin);
    }
    ledRing.show();
  }
}

// 遮挡报警：红色闪烁 + 短促"嘀嘀嘀"
void obstructionAlarmBlink() {
  static unsigned long lastBlinkTime = 0;
  if (millis() - lastBlinkTime >= 300) {
    lastBlinkTime = millis();
    static bool ledState = false;
    ledState = !ledState;

    if (ledState) {
      setLightRed(255);
      tone(buzzerPin, 1000, 60);
    } else {
      ledRing.clear();
      noTone(buzzerPin);
    }
    ledRing.show();
  }
}

void dimLights() {
  unsigned long elapsedTime = millis() - dimmingStartTime;
  int brightness = map(elapsedTime, 0, dimmingDuration, 255, 0);
  setLightRed(brightness);
  ledRing.show();
}

void fadeLights() {
  unsigned long currentMillis = millis();
  if (currentMillis - colorFadeTime >= 2000) {
    colorFadeTime = currentMillis;
    switch (fadeStep % 6) {
      case 0: ledRing.fill(ledRing.Color(255, 0, 0)); break;
      case 1: ledRing.fill(ledRing.Color(255, 127, 0)); break;
      case 2: ledRing.fill(ledRing.Color(255, 255, 0)); break;
      case 3: ledRing.fill(ledRing.Color(0, 255, 0)); break;
      case 4: ledRing.fill(ledRing.Color(0, 0, 255)); break;
      case 5: ledRing.fill(ledRing.Color(75, 0, 130)); break;
    }
    ledRing.show();
    fadeStep++;
  }
}

void setLightRed(int brightness) {
  fillRGB(brightness, 0, 0);
}

void setLightGreen(int brightness) {
  fillRGB(0, brightness, 0);
}

void setLightYellow(int brightness) {
  fillRGB(brightness, brightness, 0);
}

void setLightWhite(int brightness) {
  fillRGB(brightness, brightness, brightness);
}

// ═══════════════════════════════════════════════════════════════════
//  开机动画 (1-5，与原版一致)
// ═══════════════════════════════════════════════════════════════════
void startupSequence1() {
  ledRing.clear();
  ledRing.show();

  for (int i = 0; i < ledRing.numPixels(); i++) {
    ledRing.setPixelColor(i, ledRing.Color(255, 0, 0));
    ledRing.show();
    tone(buzzerPin, 1000, 100);
    delay(100);
  }
  delay(200);

  for (int i = 0; i < ledRing.numPixels(); i++) {
    ledRing.setPixelColor(i, ledRing.Color(0, 255, 0));
    ledRing.show();
    tone(buzzerPin, 1200, 100);
    delay(100);
  }
  delay(200);

  for (int i = 0; i < ledRing.numPixels(); i++) {
    ledRing.setPixelColor(i, ledRing.Color(0, 0, 255));
    ledRing.show();
    tone(buzzerPin, 1400, 100);
    delay(100);
  }
  delay(200);

  for (int i = 0; i < ledRing.numPixels(); i++) {
    ledRing.setPixelColor(i, ledRing.Color(255, 255, 255));
    ledRing.show();
    tone(buzzerPin, 1600, 100);
    delay(100);
  }
  delay(500);

  ledRing.fill(ledRing.Color(255, 255, 255));
  ledRing.show();
  tone(buzzerPin, 2000, 300);
  delay(300);

  ledRing.clear();
  ledRing.show();
  noTone(buzzerPin);
}

void startupSequence2() {
  ledRing.clear();
  ledRing.show();

  for (int i = 0; i < ledRing.numPixels(); i++) {
    ledRing.setPixelColor(i, ledRing.Color(255, 165, 0));
    ledRing.show();
    tone(buzzerPin, 800 + (i * 50), 100);
    delay(100);
  }
  delay(300);

  for (int j = 0; j < 3; j++) {
    for (int brightness = 0; brightness <= 255; brightness += 5) {
      ledRing.fill(ledRing.Color(brightness, brightness / 2, 0));
      ledRing.show();
      delay(10);
    }
    for (int brightness = 255; brightness >= 0; brightness -= 5) {
      ledRing.fill(ledRing.Color(brightness, brightness / 2, 0));
      ledRing.show();
      delay(10);
    }
    tone(buzzerPin, 1200, 150);
    delay(150);
  }

  for (int i = 0; i < 3; i++) {
    ledRing.fill(ledRing.Color(255, 255, 255));
    ledRing.show();
    tone(buzzerPin, 2000, 100);
    delay(100);

    ledRing.clear();
    ledRing.show();
    noTone(buzzerPin);
    delay(100);
  }
}

void startupSequence3() {
  ledRing.clear();
  ledRing.show();

  for (int i = 0; i < ledRing.numPixels(); i++) {
    ledRing.setPixelColor(i, ledRing.Color(255, 0, 255));
    ledRing.show();
    tone(buzzerPin, 800 + (i * 30), 50);
    delay(50);
  }
  noTone(buzzerPin);
  delay(300);

  int half = ledRing.numPixels() / 2;
  for (int i = 0; i <= half; i++) {
    ledRing.setPixelColor(half - i, ledRing.Color(0, 255, 255));
    ledRing.setPixelColor(half + i, ledRing.Color(0, 255, 255));
    ledRing.show();
    tone(buzzerPin, 1000 + (i * 40), 80);
    delay(80);
  }
  noTone(buzzerPin);
  delay(300);

  for (int j = 0; j < 3; j++) {
    ledRing.fill(ledRing.Color(0, 0, 255));
    ledRing.show();
    tone(buzzerPin, 1500, 100);
    delay(200);

    ledRing.fill(ledRing.Color(0, 0, 100));
    ledRing.show();
    delay(200);
  }
  noTone(buzzerPin);
  delay(300);

  for (int i = 0; i < ledRing.numPixels(); i++) {
    ledRing.setPixelColor(i, ledRing.Color(255, 255, 255));
    ledRing.setPixelColor((i + ledRing.numPixels() / 2) % ledRing.numPixels(), 0);
    ledRing.show();
    tone(buzzerPin, 2000 + (i * 20), 30);
    delay(30);
  }
  noTone(buzzerPin);
  delay(300);

  ledRing.fill(ledRing.Color(255, 255, 255));
  ledRing.show();
  tone(buzzerPin, 2500, 150);
  delay(150);
  ledRing.clear();
  ledRing.show();
  noTone(buzzerPin);
}

void startupSequence4() {
  Serial.println(F("Starte Startup-Sequenz 4"));
  ledRing.clear();
  ledRing.show();

  for (int i = 0; i < ledRing.numPixels(); i++) {
    ledRing.setPixelColor(i, ledRing.Color(255, 0, 255));
    ledRing.show();
    tone(buzzerPin, 800 + (i * 30), 50);
    delay(50);
  }
  noTone(buzzerPin);
  delay(300);

  int half = ledRing.numPixels() / 2;
  for (int i = 0; i <= half; i++) {
    ledRing.setPixelColor(half - i, ledRing.Color(0, 255, 255));
    ledRing.setPixelColor(half + i, ledRing.Color(0, 255, 255));
    ledRing.show();
    tone(buzzerPin, 1000 + (i * 40), 80);
    delay(80);
  }
  noTone(buzzerPin);
  delay(300);

  for (int j = 0; j < 3; j++) {
    ledRing.fill(ledRing.Color(0, 0, 255));
    ledRing.show();
    tone(buzzerPin, 1500, 100);
    delay(200);

    ledRing.fill(ledRing.Color(0, 0, 100));
    ledRing.show();
    delay(200);
  }
  noTone(buzzerPin);
  delay(300);

  for (int i = 0; i < ledRing.numPixels(); i++) {
    ledRing.setPixelColor(i, ledRing.Color(255, 255, 255));
    ledRing.setPixelColor((i + ledRing.numPixels() / 2) % ledRing.numPixels(), 0);
    ledRing.show();
    tone(buzzerPin, 2000 + (i * 20), 30);
    delay(30);
  }
  noTone(buzzerPin);
  delay(300);

  ledRing.fill(ledRing.Color(255, 255, 255));
  ledRing.show();
  tone(buzzerPin, 2500, 150);
  delay(150);
  ledRing.clear();
  ledRing.show();
  noTone(buzzerPin);
}

void startupSequence5() {
  ledRing.clear();
  ledRing.show();

  for (int i = 0; i < ledRing.numPixels(); i++) {
    ledRing.setPixelColor(i, ledRing.Color(0, 0, 255));
    ledRing.show();
    tone(buzzerPin, 800 + (i * 20), 50);
    delay(50);
    ledRing.setPixelColor(i, 0);
  }
  noTone(buzzerPin);
  delay(300);

  int half = ledRing.numPixels() / 2;
  for (int i = half; i >= 0; i--) {
    ledRing.setPixelColor(half - i, ledRing.Color(255, 255, 0));
    ledRing.setPixelColor(half + i, ledRing.Color(255, 255, 0));
    ledRing.show();
    tone(buzzerPin, 1000 + (i * 50), 50);
    delay(80);
  }
  noTone(buzzerPin);
  delay(300);

  for (int j = 0; j < 3; j++) {
    ledRing.fill(ledRing.Color(255, 255, 255));
    ledRing.show();
    tone(buzzerPin, 1500, 100);
    delay(200);

    ledRing.clear();
    ledRing.show();
    delay(200);
  }
  noTone(buzzerPin);
  delay(300);

  for (int i = 0; i <= half; i++) {
    ledRing.setPixelColor(half - i, 0);
    ledRing.setPixelColor(half + i, 0);
    ledRing.show();
    tone(buzzerPin, 2000 - (i * 50), 50);
    delay(80);
  }
  noTone(buzzerPin);
  delay(300);

  for (int i = 0; i < 2; i++) {
    ledRing.fill(ledRing.Color(255, 0, 0));
    ledRing.show();
    tone(buzzerPin, 2500, 150);
    delay(150);

    ledRing.clear();
    ledRing.show();
    noTone(buzzerPin);
    delay(150);
  }
}
