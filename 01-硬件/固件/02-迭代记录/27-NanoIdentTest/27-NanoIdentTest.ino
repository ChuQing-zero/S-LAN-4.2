/*
 * ============================================================================
 *  S-LAN V4.3  ·  Nano 主控 —— 识别单元测试台（地址 0x10）
 * ============================================================================
 *
 *  配套固件：26-IdentUnit/main.c（新寄存器表）
 *
 *  串口 115200，行结尾 Newline
 *
 *  指令：
 *      s           扫描 0x10
 *      h           读心跳（连敲两次，数字必须递增）
 *      x           状态总览（机态/错误/有卡/结果类型/结果长度/舵机角度）
 *      p           读光敏 ADC
 *      l n         点亮 n 颗灯（0~4），写寄存器 0x18
 *      u           舵机 放行位（GATE_UP）
 *      d           舵机 挡住位（GATE_DOWN）
 *      g n         舵机 转到指定角度 n（0~180）
 *      r           皮带 正转
 *      t           皮带 停
 *      b           皮带 反向
 *      c           触发扫码（超时 3 秒）
 *      a           自动识别（本阶段 = 扫码）
 *      z           读取识别结果缓冲区
 *      0           复位
 *      ?           帮助
 *
 *  接线：Nano A4=SCL  A5=SDA  GND  +5V
 *        上拉 2.2k/4.7k ×2 只在 Nano 这一端
 * ============================================================================
 */

#include <Wire.h>

#define TARGET        0x10

/* ---- 通用寄存器 ---- */
#define REG_CMD       0x00
#define REG_ARG       0x01
#define REG_STATUS    0x02
#define REG_ERR       0x03
#define REG_HB        0x04
#define REG_FW        0x05
#define REG_TYPE      0x06
#define REG_ADDR      0x07
#define REG_PTR       0xFE

/* ---- 参数区 ---- */
#define REG_BELT_PWM   0x10
#define REG_BELT_DIR   0x11
#define REG_GATE_REST  0x12
#define REG_GATE_BLOCK 0x13
#define REG_GATE_MS    0x14
#define REG_SCAN_TO    0x15
#define REG_NFC_TO     0x16
#define REG_BLOCK_MS   0x17
#define REG_LED_MASK   0x18

/* ---- 读回区 ---- */
#define REG_ADC_L     0x20
#define REG_ADC_H     0x21
#define REG_CARD      0x22
#define REG_RES_TYPE  0x23
#define REG_RES_LEN   0x24
#define REG_MSTATE    0x25
#define REG_ERR_LAST  0x26
#define REG_BELT_ST   0x27
#define REG_GATE_DEG  0x28
#define REG_CLR       0x29
#define REG_RES_BUF   0x40

/* ---- 指令 ---- */
#define CMD_RESET     0x01
#define CMD_ENABLE    0x02
#define CMD_STOP      0x03
#define CMD_BELT_RUN  0x10
#define CMD_BELT_STOP 0x11
#define CMD_BELT_REV  0x12
#define CMD_SCAN      0x20
#define CMD_IDENT     0x22
#define CMD_RES_CLEAR 0x23
#define CMD_GATE_UP   0x30
#define CMD_GATE_DOWN 0x31
#define CMD_GATE_DEG  0x32

// ================================================================ I²C 基础
static bool i2cAlive(uint8_t a) {
  Wire.beginTransmission(a);
  return Wire.endTransmission() == 0;
}

static bool wr(uint8_t a, uint8_t reg, uint8_t v) {
  Wire.beginTransmission(a);
  Wire.write(reg);
  Wire.write(v);
  return Wire.endTransmission() == 0;
}

static int rd(uint8_t a, uint8_t reg, uint8_t *out) {
  Wire.beginTransmission(a);
  Wire.write(REG_PTR);
  Wire.write(reg);
  if (Wire.endTransmission() != 0) return -1;
  if (Wire.requestFrom(a, (uint8_t)1) != 1) return -2;
  *out = Wire.read();
  return 0;
}

static bool sendCmd(uint8_t cmd, uint8_t arg) {
  if (arg != 0xFF) {
    if (!wr(TARGET, REG_ARG, arg)) return false;
  }
  return wr(TARGET, REG_CMD, cmd);
}

static void printHex(uint8_t v) {
  Serial.print(F("0x"));
  if (v < 0x10) Serial.print('0');
  Serial.print(v, HEX);
}

// ================================================================ 各项读取
static void showStatus() {
  uint8_t st = 0, err = 0, ms = 0, card = 0, rt = 0, rl = 0, gd = 0;

  if (rd(TARGET, REG_STATUS,   &st)   != 0 ||
      rd(TARGET, REG_ERR_LAST, &err)  != 0 ||
      rd(TARGET, REG_MSTATE,   &ms)   != 0 ||
      rd(TARGET, REG_CARD,     &card) != 0 ||
      rd(TARGET, REG_RES_TYPE, &rt)   != 0 ||
      rd(TARGET, REG_RES_LEN,  &rl)   != 0 ||
      rd(TARGET, REG_GATE_DEG, &gd)   != 0) {
    Serial.println(F("read FAILED (no answer?)"));
    return;
  }

  const char *msName[] = { "IDLE", "WAIT", "BUSY", "RESULT", "FAULT" };
  const char *rtName[] = { "none", "NFC", "QR", "BARCODE" };

  Serial.print(F("STATUS=0x"));
  Serial.print(st, HEX);
  Serial.print(F("  MACH="));
  Serial.print((ms < 5) ? msName[ms] : "?");
  Serial.print(F("  CARD="));
  Serial.print(card);
  Serial.print(F("  GATE="));
  Serial.print(gd);
  Serial.print(F("deg  ERR=0x"));
  Serial.print(err, HEX);
  Serial.print(F("  RES="));
  Serial.print((rt < 4) ? rtName[rt] : "?");
  Serial.print(F(" len="));
  Serial.println(rl);
}

static void showAdc() {
  uint8_t lo = 0, hi = 0, card = 0;
  if (rd(TARGET, REG_ADC_L, &lo) != 0 || rd(TARGET, REG_ADC_H, &hi) != 0) {
    Serial.println(F("ADC read FAILED"));
    return;
  }
  rd(TARGET, REG_CARD, &card);
  Serial.print(F("ADC = "));
  Serial.print((uint16_t)lo | ((uint16_t)(hi & 0x0F) << 8));
  Serial.print(F("   CARD = "));
  Serial.println(card);
}

static void readResult() {
  uint8_t rt = 0, rl = 0, i = 0, c = 0;

  if (rd(TARGET, REG_RES_TYPE, &rt) != 0 || rd(TARGET, REG_RES_LEN, &rl) != 0) {
    Serial.println(F("cannot read RES_TYPE/RES_LEN"));
    return;
  }

  Serial.print(F("RES_TYPE="));
  Serial.print(rt);
  Serial.print(F("  RES_LEN="));
  Serial.println(rl);

  if (rl == 0) {
    Serial.println(F("(empty)"));
    return;
  }

  Serial.print(F("RES_BUF = ["));
  for (i = 0; i < rl && i < 32; i++) {
    if (rd(TARGET, (uint8_t)(REG_RES_BUF + i), &c) != 0) {
      Serial.print(F("?"));
      continue;
    }
    if (c >= 32 && c < 127) Serial.print((char)c);
    else { Serial.print('<'); Serial.print(c, HEX); Serial.print('>'); }
  }
  Serial.println(F("]"));
}

static void readHeartbeat() {
  uint8_t hb = 0;
  if (rd(TARGET, REG_HB, &hb) == 0) {
    Serial.print(F("HB = "));
    Serial.println(hb);
  } else {
    Serial.println(F("HB read FAILED"));
  }
}

// ================================================================ 帮助
static void help() {
  Serial.println(F("--------------------------------------------------"));
  Serial.println(F("  s        scan 0x10"));
  Serial.println(F("  h        heartbeat"));
  Serial.println(F("  x        status (mach/err/card/res/gate)"));
  Serial.println(F("  p        light ADC"));
  Serial.println(F("  l n      light n lamps (0..4)"));
  Serial.println(F("  u / d    gate UP (release) / DOWN (block)"));
  Serial.println(F("  g n      gate to angle n (0..180)"));
  Serial.println(F("  r / t / b  belt RUN / STOP / REVERSE"));
  Serial.println(F("  c        trigger scan (3s)"));
  Serial.println(F("  a        auto identify"));
  Serial.println(F("  z        read result buffer"));
  Serial.println(F("  0        reset"));
  Serial.println(F("  ?        this help"));
  Serial.println(F("--------------------------------------------------"));
}

// ================================================================ 解析
static int parseNum(const char *s) {
  if (!s) return -1;
  if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) return (int)strtol(s + 2, NULL, 16);
  return atoi(s);
}

static char   g_line[64];
static size_t g_len = 0;

static void handleLine(char *line) {
  while (*line == ' ') line++;
  size_t n = strlen(line);
  while (n && (line[n - 1] == ' ' || line[n - 1] == '\r' || line[n - 1] == '\n')) line[--n] = 0;
  if (n == 0) return;

  char c = line[0];
  char *arg = NULL;
  if (n > 1) {
    char *p = line + 1;
    while (*p == ' ') p++;
    if (*p) arg = p;
  }

  switch (c) {
    case 's': case 'S':
      Serial.print(F("probe "));
      printHex(TARGET);
      Serial.println(i2cAlive(TARGET) ? F("  -> ACK") : F("  -> NO ACK"));
      break;

    case 'h': case 'H': readHeartbeat(); break;
    case 'x': case 'X': showStatus();    break;
    case 'p': case 'P': showAdc();       break;

    case 'l': case 'L': {
      int v = parseNum(arg);
      if (v < 0 || v > 4) { Serial.println(F("usage: l 0..4")); break; }
      Serial.println(wr(TARGET, REG_LED_MASK, (uint8_t)v) ? F("LED mask set") : F("NO ACK"));
      break;
    }

    case 'u': case 'U':
      Serial.println(sendCmd(CMD_GATE_UP, 0xFF) ? F("gate UP") : F("NO ACK"));
      break;

    case 'd': case 'D':
      Serial.println(sendCmd(CMD_GATE_DOWN, 0xFF) ? F("gate DOWN") : F("NO ACK"));
      break;

    case 'g': case 'G': {
      int v = parseNum(arg);
      if (v < 0 || v > 180) { Serial.println(F("usage: g 0..180")); break; }
      Serial.println(sendCmd(CMD_GATE_DEG, (uint8_t)v) ? F("gate moving") : F("NO ACK"));
      break;
    }

    case 'r': case 'R':
      Serial.println(sendCmd(CMD_BELT_RUN, 0xFF) ? F("belt RUN") : F("NO ACK"));
      break;

    case 't': case 'T':
      Serial.println(sendCmd(CMD_BELT_STOP, 0xFF) ? F("belt STOP") : F("NO ACK"));
      break;

    case 'b': case 'B':
      Serial.println(sendCmd(CMD_BELT_REV, 0xFF) ? F("belt REVERSE") : F("NO ACK"));
      break;

    case 'c': case 'C':
      Serial.println(F("trigger scan, waiting up to 3s ..."));
      Serial.println(sendCmd(CMD_SCAN, 0xFF) ? F("done - use z to read") : F("NO ACK"));
      showStatus();
      break;

    case 'a': case 'A':
      Serial.println(F("auto identify, waiting ..."));
      Serial.println(sendCmd(CMD_IDENT, 0xFF) ? F("done - use z to read") : F("NO ACK"));
      showStatus();
      break;

    case 'z': case 'Z': readResult(); break;

    case '0':
      Serial.println(sendCmd(CMD_RESET, 0xFF) ? F("RESET") : F("NO ACK"));
      break;

    case '?': help(); break;

    default:
      Serial.print(F("unknown '"));
      Serial.print(c);
      Serial.println(F("'  (type ? for help)"));
  }
}

// ================================================================ setup / loop
void setup() {
  Serial.begin(115200);
  while (!Serial) { ; }
  Wire.begin();
  Wire.setClock(100000);

  Serial.println();
  Serial.println(F("=============================================="));
  Serial.println(F("  S-LAN V4.3   IDENT unit test   addr 0x10"));
  Serial.println(F("  SCL=A4  SDA=A5   pull-ups on Nano side"));
  Serial.println(F("=============================================="));

  if (i2cAlive(TARGET)) {
    Serial.println(F("0x10 -> ACK, unit is there"));
  } else {
    Serial.println(F("0x10 -> NO ACK"));
    Serial.println(F("check: power, GND, SDA/SCL, pull-ups, STM32 running"));
  }

  help();
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
}
