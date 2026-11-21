/*
 * ============================================================================
 *  S-LAN V4.3  ·  Nano I²C 点名测试                                  第 1 阶段
 * ============================================================================
 *
 *  干什么：扫描总线、点名闪灯、读心跳、读光敏，验证 5 块 STM32 单元板
 *          地址不撞、链路健康。
 *
 *  接线（Nano）：  A4 = SDA    A5 = SCL    GND = GND
 *                  2.2k ×2 上拉到 +5V，**只在 Nano 这一端**
 *
 *  串口 115200，指令：
 *      s            扫描总线
 *      b 0x20       点名：亮 4 颗灯 1 秒后灭
 *      h 0x20       读一次心跳
 *      l 0x20 2     亮 2 颗灯（0~4）
 *      e 0x20 0xAB  回声测试
 *      a 0x20       读光敏 ADC + 接收计数
 *      r            全量体检（心跳/固件/ADC/RX）
 *      m            连续监视（再敲一次停）
 *      ?            帮助
 *
 *  说明：地址可写 0x20 也可写 32，两种都认。
 * ============================================================================
 */

#include <Wire.h>

// ---- 从机寄存器（与 I2C-Test/STM32-Slave/main.c 严格一致）------------------
#define REG_LED_N      0x00
#define REG_ECHO       0x01
#define REG_HEARTBEAT  0x02
#define REG_FW_VER     0x03
#define REG_ADC_L      0x04
#define REG_ADC_H      0x05
#define REG_RX_CNT     0x06
#define REG_PTR        0xFE

#define SCAN_FIRST     0x10
#define SCAN_LAST      0x23

// ---- 全局 ----------------------------------------------------------------
static bool          g_monitor   = false;
static unsigned long g_lastMon   = 0;
static const unsigned long MON_PERIOD = 1000;

// ---- I²C 基本操作 --------------------------------------------------------
static bool i2cWrite(uint8_t addr, uint8_t reg, uint8_t val) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

// 返回 0 成功，-1 写指针失败，-2 读失败
static int i2cRead(uint8_t addr, uint8_t reg, uint8_t *out) {
  Wire.beginTransmission(addr);
  Wire.write(REG_PTR);
  Wire.write(reg);
  if (Wire.endTransmission() != 0) return -1;
  if (Wire.requestFrom(addr, (uint8_t)1) != 1) return -2;
  *out = Wire.read();
  return 0;
}

static bool i2cAlive(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

// ---- 扫描 ----------------------------------------------------------------
static int scanBus(bool quiet) {
  int found = 0;
  if (!quiet) Serial.print(F("Scan 0x"));
  for (uint8_t a = SCAN_FIRST; a <= SCAN_LAST; a++) {
    if (i2cAlive(a)) {
      found++;
      if (!quiet) {
        Serial.print(F("0x"));
        if (a < 0x10) Serial.print('0');
        Serial.print(a, HEX);
        Serial.println(F("  found"));
      } else {
        Serial.print(F("  found 0x"));
        Serial.println(a, HEX);
      }
    }
  }
  return found;
}

// ---- 单项操作 ------------------------------------------------------------
static void doBlink(uint8_t addr) {
  if (!i2cWrite(addr, REG_LED_N, 4)) {
    Serial.println(F("BLINK -> NO ACK (check address / wiring)"));
    return;
  }
  Serial.println(F("BLINK -> ACK, count the lamps"));
  delay(1000);
  i2cWrite(addr, REG_LED_N, 0);
}

static void doHeartbeat(uint8_t addr) {
  uint8_t hb = 0;
  int rc = i2cRead(addr, REG_HEARTBEAT, &hb);
  if (rc == 0) {
    Serial.print(F("HB = "));
    Serial.print(hb);
    Serial.println(F("   (read again -> should increase)"));
  } else {
    Serial.print(F("HB read FAILED rc="));
    Serial.println(rc);
  }
}

static void doLamps(uint8_t addr, uint8_t n) {
  bool ok = i2cWrite(addr, REG_LED_N, n);
  Serial.print(ok ? F("LAMPS ok  n=") : F("LAMPS FAILED  n="));
  Serial.println(n);
}

static void doEcho(uint8_t addr, uint8_t val) {
  if (!i2cWrite(addr, REG_ECHO, val)) {
    Serial.println(F("ECHO write NO ACK"));
    return;
  }
  uint8_t back = 0;
  if (i2cRead(addr, REG_ECHO, &back) != 0) {
    Serial.println(F("ECHO read FAILED"));
    return;
  }
  Serial.print(F("ECHO wrote 0x"));
  Serial.print(val, HEX);
  Serial.print(F("  read 0x"));
  Serial.print(back, HEX);
  Serial.println(back == val ? F("   OK") : F("   MISMATCH"));
}

static void doAnalog(uint8_t addr) {
  uint8_t lo = 0, hi = 0, rx = 0;
  if (i2cRead(addr, REG_ADC_L, &lo) != 0 ||
      i2cRead(addr, REG_ADC_H, &hi) != 0) {
    Serial.println(F("ADC read FAILED"));
    return;
  }
  i2cRead(addr, REG_RX_CNT, &rx);
  uint16_t adc = (uint16_t)lo | ((uint16_t)(hi & 0x0F) << 8);
  Serial.print(F("ADC = "));
  Serial.print(adc);
  Serial.print(F("   RX_CNT = "));
  Serial.println(rx);
  Serial.println(F("   (cover the photoresistor -> ADC should change)"));
}

// ---- 全量体检 ------------------------------------------------------------
static void doReport() {
  Serial.println(F("ADDR   HB   FW     ADC    RX"));
  int found = 0;
  for (uint8_t a = SCAN_FIRST; a <= SCAN_LAST; a++) {
    if (!i2cAlive(a)) continue;
    found++;

    uint8_t hb = 0, fw = 0, lo = 0, hi = 0, rx = 0;
    i2cRead(a, REG_HEARTBEAT, &hb);
    i2cRead(a, REG_FW_VER,    &fw);
    i2cRead(a, REG_ADC_L,     &lo);
    i2cRead(a, REG_ADC_H,     &hi);
    i2cRead(a, REG_RX_CNT,    &rx);
    uint16_t adc = (uint16_t)lo | ((uint16_t)(hi & 0x0F) << 8);

    Serial.print(F("0x"));
    if (a < 0x10) Serial.print('0');
    Serial.print(a, HEX);
    Serial.print(F("   "));
    if (hb < 100) Serial.print(' ');
    if (hb < 10)  Serial.print(' ');
    Serial.print(hb);
    Serial.print(F("   0x"));
    Serial.print(fw, HEX);
    Serial.print(F("   "));
    if (adc < 1000) Serial.print(' ');
    if (adc < 100)  Serial.print(' ');
    if (adc < 10)   Serial.print(' ');
    Serial.print(adc);
    Serial.print(F("    "));
    Serial.println(rx);
  }
  Serial.print(found);
  Serial.println(F(" device(s)"));
}

// ---- 监视模式 ------------------------------------------------------------
static void monitorTick() {
  if (!g_monitor) return;
  if (millis() - g_lastMon < MON_PERIOD) return;
  g_lastMon = millis();

  Serial.print(millis() / 1000);
  Serial.print(F("s "));
  int found = 0;
  for (uint8_t a = SCAN_FIRST; a <= SCAN_LAST; a++) {
    uint8_t hb = 0;
    if (i2cRead(a, REG_HEARTBEAT, &hb) == 0) {
      found++;
      Serial.print(F("0x"));
      if (a < 0x10) Serial.print('0');
      Serial.print(a, HEX);
      Serial.print('=');
      Serial.print(hb);
      Serial.print(' ');
    }
  }
  if (!found) Serial.print(F("(no device)"));
  Serial.println();
}

static void help() {
  Serial.println(F("--------------------------------------------------"));
  Serial.println(F("  s            scan bus"));
  Serial.println(F("  b 0x20       blink 4 lamps on that unit"));
  Serial.println(F("  h 0x20       read heartbeat once"));
  Serial.println(F("  l 0x20 2     light 2 lamps (0..4)"));
  Serial.println(F("  e 0x20 0xAB  echo test"));
  Serial.println(F("  a 0x20       read ADC + RX count"));
  Serial.println(F("  r            full health report"));
  Serial.println(F("  m            monitor mode on/off"));
  Serial.println(F("  ?            this help"));
  Serial.println(F("--------------------------------------------------"));
}

// ---- 参数解析：0x20 或 32 都认 -------------------------------------------
static uint8_t parseNum(const char *s) {
  if (!s) return 0;
  if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) return (uint8_t)strtoul(s + 2, NULL, 16);
  return (uint8_t)strtoul(s, NULL, 10);
}

// ---- 串口指令处理 --------------------------------------------------------
static char   g_line[64];
static size_t g_len = 0;

static void handleLine(char *line) {
  // 去掉首尾空白
  while (*line == ' ') line++;
  size_t n = strlen(line);
  while (n && (line[n - 1] == ' ' || line[n - 1] == '\r' || line[n - 1] == '\n')) line[--n] = 0;
  if (n == 0) return;

  char cmd = line[0];
  char *arg1 = NULL, *arg2 = NULL;

  if (n > 1) {
    char *p = line + 1;
    while (*p == ' ') p++;
    arg1 = p;
    char *sp = strchr(p, ' ');
    if (sp) { *sp = 0; arg2 = sp + 1; while (*arg2 == ' ') arg2++; }
  }

  // 无参数指令
  if (!arg1) {
    switch (cmd) {
      case 's': case 'S': {
        int f = 0;
        Serial.print(F("Scan 0x"));
        Serial.print(SCAN_FIRST, HEX);
        Serial.print(F("..0x"));
        Serial.println(SCAN_LAST, HEX);
        f = scanBus(true);
        Serial.print(f);
        Serial.println(F(" device(s)"));
        break;
      }
      case 'r': case 'R': doReport(); break;
      case 'm': case 'M':
        g_monitor = !g_monitor;
        Serial.println(g_monitor ? F("monitor ON") : F("monitor OFF"));
        break;
      case '?': help(); break;
      default:
        Serial.print(F("unknown command '"));
        Serial.print(cmd);
        Serial.println(F("'  (type ? for help)"));
    }
    return;
  }

  uint8_t addr = parseNum(arg1);

  switch (cmd) {
    case 'b': case 'B': doBlink(addr); break;
    case 'h': case 'H': doHeartbeat(addr); break;
    case 'l': case 'L': doLamps(addr, arg2 ? parseNum(arg2) : 1); break;
    case 'e': case 'E': doEcho(addr, arg2 ? parseNum(arg2) : 0xAB); break;
    case 'a': case 'A': doAnalog(addr); break;
    default:
      Serial.print(F("unknown command '"));
      Serial.print(cmd);
      Serial.println(F("'  (type ? for help)"));
  }
}

// ---- setup / loop -------------------------------------------------------
void setup() {
  Serial.begin(115200);
  while (!Serial) { ; }
  Wire.begin();
  Wire.setClock(100000);

  Serial.println();
  Serial.println(F("=============================================="));
  Serial.println(F("  S-LAN V4.3   Nano I2C test   (stage 1)"));
  Serial.println(F("  SDA=A4  SCL=A5   2.2k pull-ups on Nano side"));
  Serial.println(F("=============================================="));
  help();

  Serial.println(F("Initial scan ..."));
  int f = scanBus(true);
  Serial.print(f);
  Serial.println(F(" device(s) on bus"));
  Serial.println();
}

void loop() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      g_line[g_len] = 0;
      handleLine(g_line);
      g_len = 0;
    } else if (g_len < sizeof(g_line) - 1) {
      g_line[g_len++] = c;
    }
  }
  monitorTick();
}
