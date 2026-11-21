/*
 * ============================================================================
 *  S-LAN V4.3  ·  Nano 主控 —— 单元功能测试台
 * ============================================================================
 *
 *  干两件事：
 *    ① 上电自动扫描 0x20~0x23，对每块在线单元**依次自测每个功能**并给 PASS/FAIL
 *    ② 之后进入菜单，可以手动敲命令单独测某一项
 *
 *  当前从机固件（stm32_slave_4addr 那四份）支持的寄存器：
 *      0x00 LED_N      写 0~4，点亮前 n 颗灯
 *      0x01 ECHO       写什么读回什么
 *      0x02 HEARTBEAT  每读一次 +1
 *      0x03 FW_VER     固定 0x10
 *      0x04 ADC_L      光敏低 8 位
 *      0x05 ADC_H      光敏高 4 位
 *      0x06 RX_CNT     收到过几次写
 *      0xFE PTR        只挪读指针
 *
 *  接线：Nano  A4=SCL  A5=SDA  GND  5V
 *        上拉 2.2k/4.7k ×2 只在 Nano 这一端
 *
 *  串口 115200
 * ============================================================================
 */

#include <Wire.h>

#define REG_LED_N      0x00
#define REG_ECHO       0x01
#define REG_HEARTBEAT  0x02
#define REG_FW_VER     0x03
#define REG_ADC_L      0x04
#define REG_ADC_H      0x05
#define REG_RX_CNT     0x06
#define REG_PTR        0xFE

#define ADDR_FIRST     0x20
#define ADDR_LAST      0x23

static bool g_monitor = false;
static unsigned long g_lastMon = 0;

// ================================================================ I²C 基础
static bool i2cAlive(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

static bool i2cWrite(uint8_t addr, uint8_t reg, uint8_t val) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

static int i2cRead(uint8_t addr, uint8_t reg, uint8_t *out) {
  Wire.beginTransmission(addr);
  Wire.write(REG_PTR);
  Wire.write(reg);
  if (Wire.endTransmission() != 0) return -1;
  if (Wire.requestFrom(addr, (uint8_t)1) != 1) return -2;
  *out = Wire.read();
  return 0;
}

static void printAddr(uint8_t a) {
  Serial.print(F("0x"));
  if (a < 0x10) Serial.print('0');
  Serial.print(a, HEX);
}

// ================================================================ 单项读
static int getHeartbeat(uint8_t a, uint8_t *v) { return i2cRead(a, REG_HEARTBEAT, v); }
static int getFw(uint8_t a, uint8_t *v)        { return i2cRead(a, REG_FW_VER, v); }
static int getRxCount(uint8_t a, uint8_t *v)   { return i2cRead(a, REG_RX_CNT, v); }

static int getAdc(uint8_t a, uint16_t *v) {
  uint8_t lo = 0, hi = 0;
  if (i2cRead(a, REG_ADC_L, &lo) != 0) return -1;
  if (i2cRead(a, REG_ADC_H, &hi) != 0) return -2;
  *v = (uint16_t)lo | ((uint16_t)(hi & 0x0F) << 8);
  return 0;
}

// ================================================================ 扫描
static uint8_t scanBus(uint8_t *found, uint8_t maxn) {
  uint8_t n = 0;
  for (uint8_t a = ADDR_FIRST; a <= ADDR_LAST && n < maxn; a++) {
    if (i2cAlive(a)) found[n++] = a;
  }
  return n;
}

// ================================================================ 单元自测
// 返回通过的项数；每项打印 [PASS]/[FAIL]
static uint8_t autoTestUnit(uint8_t addr, bool verbose) {
  uint8_t pass = 0;
  uint8_t total = 0;

  Serial.println();
  Serial.print(F("===== unit "));
  printAddr(addr);
  Serial.println(F(" ====="));

  // --- 1. 应答 ---
  total++;
  if (i2cAlive(addr)) {
    Serial.println(F("  [PASS] 1. ACK          device answers"));
    pass++;
  } else {
    Serial.println(F("  [FAIL] 1. ACK          no response - check wiring / address"));
    return pass;                       // 不应答，后面没意义
  }

  // --- 2. 固件版本 ---
  total++;
  uint8_t fw = 0;
  if (getFw(addr, &fw) == 0 && fw == 0x10) {
    Serial.println(F("  [PASS] 2. FW_VER       = 0x10"));
    pass++;
  } else {
    Serial.print(F("  [FAIL] 2. FW_VER       got 0x"));
    Serial.println(fw, HEX);
  }

  // --- 3. 心跳递增 ---
  total++;
  uint8_t hb1 = 0, hb2 = 0;
  bool hb_ok = (getHeartbeat(addr, &hb1) == 0) &&
               (getHeartbeat(addr, &hb2) == 0) &&
               (hb2 != hb1);
  if (hb_ok) {
    Serial.print(F("  [PASS] 3. HEARTBEAT    "));
    Serial.print(hb1);
    Serial.print(F(" -> "));
    Serial.println(hb2);
    pass++;
  } else {
    Serial.print(F("  [FAIL] 3. HEARTBEAT    "));
    Serial.print(hb1);
    Serial.print(F(" -> "));
    Serial.println(hb2);
  }

  // --- 4. 回声 ---
  total++;
  uint8_t back = 0;
  bool echo_ok = i2cWrite(addr, REG_ECHO, 0xA5) &&
                 (i2cRead(addr, REG_ECHO, &back) == 0) &&
                 (back == 0xA5);
  if (echo_ok) {
    Serial.println(F("  [PASS] 4. ECHO         wrote 0xA5, read back 0xA5"));
    pass++;
  } else {
    Serial.print(F("  [FAIL] 4. ECHO         read back 0x"));
    Serial.println(back, HEX);
  }

  // --- 5. 四颗灯 ---
  total++;
  Serial.println(F("  [ .. ] 5. LED          0 -> 1 -> 2 -> 3 -> 4 -> 0"));
  bool led_ok = true;
  for (uint8_t n = 0; n <= 4; n++) {
    if (!i2cWrite(addr, REG_LED_N, n)) led_ok = false;
    delay(350);
  }
  i2cWrite(addr, REG_LED_N, 0);
  if (led_ok) {
    Serial.println(F("  [PASS] 5. LED          all writes ACKed (did lamps follow?)"));
    pass++;
  } else {
    Serial.println(F("  [FAIL] 5. LED          some write hit NACK"));
  }

  // --- 6. 光敏 ---
  total++;
  uint16_t adc = 0;
  if (getAdc(addr, &adc) == 0) {
    Serial.print(F("  [PASS] 6. LIGHT ADC    = "));
    Serial.println(adc);
    pass++;
  } else {
    Serial.println(F("  [FAIL] 6. LIGHT ADC    read error"));
  }

  // --- 7. 接收计数 ---
  total++;
  uint8_t rx = 0;
  if (getRxCount(addr, &rx) == 0) {
    Serial.print(F("  [PASS] 7. RX_CNT       = "));
    Serial.println(rx);
    pass++;
  } else {
    Serial.println(F("  [FAIL] 7. RX_CNT       read error"));
  }

  Serial.print(F("  ------- "));
  Serial.print(pass);
  Serial.print('/');
  Serial.print(total);
  Serial.println(F(" passed -------"));

  return pass;
}

// 对扫描到的每块板跑一遍
static void autoTestAll() {
  uint8_t found[8];
  uint8_t n = scanBus(found, 8);

  Serial.println();
  Serial.print(F("Found "));
  Serial.print(n);
  Serial.println(F(" unit(s)."));

  if (n == 0) {
    Serial.println(F("Nothing to test."));
    Serial.println(F("Check: pull-ups on Nano side, common GND, SDA/SCL, unit powered."));
    return;
  }

  uint8_t okUnits = 0;
  for (uint8_t i = 0; i < n; i++) {
    uint8_t pass = autoTestUnit(found[i], true);
    if (pass >= 6) okUnits++;
    delay(300);
  }

  Serial.println();
  Serial.print(F("========== "));
  Serial.print(okUnits);
  Serial.print('/');
  Serial.print(n);
  Serial.println(F(" unit(s) basically OK =========="));

  if (okUnits == n) {
    Serial.println(F("All units passed. Next: burn the sorter firmware with servos."));
  } else {
    Serial.println(F("Fix the FAIL items above before adding servos."));
  }
}

// ================================================================ 监视
static void monitorTick() {
  if (!g_monitor) return;
  if (millis() - g_lastMon < 1000) return;
  g_lastMon = millis();

  Serial.print(F("["));
  Serial.print(millis() / 1000);
  Serial.print(F("s] "));

  uint8_t found[8];
  uint8_t n = scanBus(found, 8);

  if (n == 0) {
    Serial.println(F("(no unit)"));
    return;
  }

  for (uint8_t i = 0; i < n; i++) {
    uint8_t hb = 0, rx = 0;
    uint16_t adc = 0;
    getHeartbeat(found[i], &hb);
    getRxCount(found[i], &rx);
    getAdc(found[i], &adc);

    printAddr(found[i]);
    Serial.print(F(" HB="));
    Serial.print(hb);
    Serial.print(F(" ADC="));
    Serial.print(adc);
    Serial.print(F(" RX="));
    Serial.print(rx);
    Serial.print(F("  "));
  }
  Serial.println();
}

// ================================================================ 帮助
static void help() {
  Serial.println(F("--------------------------------------------------"));
  Serial.println(F("  A            auto-test ALL units in sequence"));
  Serial.println(F("  r 0x20       auto-test ONE unit"));
  Serial.println(F("  s            scan bus"));
  Serial.println(F("  b 0x20       blink: 4 lamps on that unit"));
  Serial.println(F("  h 0x20       read heartbeat"));
  Serial.println(F("  e 0x20       echo test"));
  Serial.println(F("  l 0x20 2     light 2 lamps (0..4)"));
  Serial.println(F("  p 0x20       read light ADC + RX count"));
  Serial.println(F("  m            monitor mode on/off"));
  Serial.println(F("  ?            this help"));
  Serial.println(F("--------------------------------------------------"));
}

// ================================================================ 参数解析
static uint8_t parseNum(const char *s) {
  if (!s) return 0;
  if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) return (uint8_t)strtoul(s + 2, NULL, 16);
  return (uint8_t)strtoul(s, NULL, 10);
}

// ================================================================ 命令处理
static char   g_line[64];
static size_t g_len = 0;

static void handleLine(char *line) {
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

  // 无参数
  if (!arg1) {
    switch (cmd) {
      case 'A': autoTestAll(); break;
      case 's': case 'S': {
        uint8_t found[8];
        uint8_t k = scanBus(found, 8);
        Serial.println(F("Scan 0x20..0x23"));
        for (uint8_t i = 0; i < k; i++) {
          Serial.print(F("  found "));
          printAddr(found[i]);
          Serial.println();
        }
        Serial.print(k);
        Serial.println(F(" device(s)"));
        break;
      }
      case 'm': case 'M':
        g_monitor = !g_monitor;
        Serial.println(g_monitor ? F("monitor ON") : F("monitor OFF"));
        break;
      case '?': help(); break;
      default:
        Serial.print(F("unknown '"));
        Serial.print(cmd);
        Serial.println(F("'  (type ? for help)"));
    }
    return;
  }

  uint8_t addr = parseNum(arg1);

  switch (cmd) {
    case 'r': case 'R': autoTestUnit(addr, true); break;

    case 'b': case 'B':
      if (i2cWrite(addr, REG_LED_N, 4)) {
        Serial.println(F("4 lamps ON, 1s ..."));
        delay(1000);
        i2cWrite(addr, REG_LED_N, 0);
        Serial.println(F("done"));
      } else {
        Serial.println(F("NO ACK"));
      }
      break;

    case 'h': case 'H': {
      uint8_t hb = 0;
      if (getHeartbeat(addr, &hb) == 0) {
        Serial.print(F("HB = "));
        Serial.println(hb);
      } else Serial.println(F("read FAILED"));
      break;
    }

    case 'e': case 'E': {
      uint8_t back = 0;
      if (!i2cWrite(addr, REG_ECHO, 0xA5)) { Serial.println(F("write NACK")); break; }
      if (i2cRead(addr, REG_ECHO, &back) != 0) { Serial.println(F("read FAILED")); break; }
      Serial.print(F("echo = 0x"));
      Serial.print(back, HEX);
      Serial.println(back == 0xA5 ? F("  OK") : F("  MISMATCH"));
      break;
    }

    case 'l': case 'L': {
      uint8_t v = arg2 ? parseNum(arg2) : 1;
      if (i2cWrite(addr, REG_LED_N, v)) {
        Serial.print(F("lamps = "));
        Serial.println(v);
      } else Serial.println(F("NO ACK"));
      break;
    }

    case 'p': case 'P': {
      uint16_t adc = 0;
      uint8_t rx = 0;
      if (getAdc(addr, &adc) != 0) { Serial.println(F("ADC read FAILED")); break; }
      getRxCount(addr, &rx);
      Serial.print(F("ADC = "));
      Serial.print(adc);
      Serial.print(F("   RX_CNT = "));
      Serial.println(rx);
      break;
    }

    default:
      Serial.print(F("unknown '"));
      Serial.print(cmd);
      Serial.println(F("'  (type ? for help)"));
  }
}

// ================================================================ setup
void setup() {
  Serial.begin(115200);
  while (!Serial) { ; }
  Wire.begin();
  Wire.setClock(100000);

  Serial.println();
  Serial.println(F("=============================================="));
  Serial.println(F("  S-LAN V4.3   unit test bench   (Nano master)"));
  Serial.println(F("  SCL=A4  SDA=A5   pull-ups on Nano side"));
  Serial.println(F("=============================================="));

  // 给 3 秒跳过自动测试的机会
  Serial.println(F("Auto test starts in 3s  (press any key to skip)"));
  unsigned long t0 = millis();
  while (millis() - t0 < 3000) {
    if (Serial.available()) {
      while (Serial.available()) Serial.read();
      Serial.println(F("skipped"));
      help();
      return;
    }
  }

  autoTestAll();
  Serial.println();
  help();
}

// ================================================================ loop
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
