/*
 * ============================================================================
 *  S-LAN V4.3  ·  Nano 主控 —— 统一测试台（识别单元 + 4 个分拣单元）
 * ============================================================================
 *
 *  一套程序同时管 5 块板。按地址自动判断用哪套寄存器表：
 *
 *     0x10        识别单元    -> 新表（CMD=0x00, ADC=0x20 ...）
 *     0x20~0x23   分拣单元    -> 老表（LED_N=0x00, ADC=0x04 ...）
 *
 *  所以命令都要带地址，例如：
 *
 *      l 0x10 3      识别单元点亮 3 颗灯
 *      b 0x20        分拣 A 点名（亮 4 颗灯）
 *      h 0x20        分拣 A 心跳
 *      x 0x10        识别单元状态总览
 *
 *  串口 115200，行结尾 Newline
 *
 *  接线：Nano A4=SCL  A5=SDA  GND  +5V
 *        上拉 2.2k/4.7k ×2 只在 Nano 这一端
 * ============================================================================
 */

#include <Wire.h>

#define ADDR_FIRST   0x10
#define ADDR_LAST    0x23

/* ================= 老表（分拣单元 18-Stm32Slave4Addr） ================= */
#define O_LED_N      0x00
#define O_ECHO       0x01
#define O_HB         0x02
#define O_FW         0x03
#define O_ADC_L      0x04s
#define O_ADC_H      0x05
#define O_RXCNT      0x06

/* ================= 新表（识别单元 26-IdentUnit） ====================== */
#define N_CMD        0x00
#define N_ARG        0x01
#define N_STATUS     0x02
#define N_ERR        0x03
#define N_HB         0x04
#define N_FW         0x05
#define N_TYPE       0x06
#define N_ADC_L      0x20
#define N_ADC_H      0x21
#define N_CARD       0x22
#define N_RESTYPE    0x23
#define N_RESLEN     0x24
#define N_MSTATE     0x25
#define N_ERRLAST    0x26
#define N_GATEDEG    0x28
#define N_LEDMASK    0x18
#define N_REST       0x12
#define N_BLOCK      0x13
#define N_BELT_PWM   0x10
#define N_SCANTO     0x15
#define N_RESBUF     0x40

#define N_C_RESET    0x01
#define N_C_BELTRUN  0x10
#define N_C_BELTSTOP 0x11
#define N_C_BELTREV  0x12
#define N_C_SCAN     0x24
#define N_C_IDENT    0x22
#define N_C_RESCLEAR 0x23
#define N_C_GATEUP   0x30
#define N_C_GATEDN   0x31
#define N_C_GATEDEG  0x32

#define REG_PTR      0xFE

// ================================================================ 基础
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

static bool isIdent(uint8_t a) { return a == 0x10; }

static bool sendCmd(uint8_t a, uint8_t cmd, uint8_t arg, bool hasArg) {
  if (hasArg) {
    if (!wr(a, N_ARG, arg)) return false;
  }
  return wr(a, N_CMD, cmd);
}

static void printAddr(uint8_t a) {
  Serial.print(F("0x"));
  if (a < 0x10) Serial.print('0');
  Serial.print(a, HEX);
}

static int parseNum(const char *s) {
  if (!s) return -1;
  if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) return (int)strtol(s + 2, NULL, 16);
  return atoi(s);
}

// ================================================================ 读心跳
static void showHeartbeat(uint8_t a) {
  uint8_t hb = 0;
  uint8_t reg = N_HB;
  if (rd(a, reg, &hb) == 0) {
    Serial.print(F("HB = "));
    Serial.println(hb);
  } else {
    Serial.println(F("HB read FAILED"));
  }
}

// ================================================================ 读光敏
static void showAdc(uint8_t a) {
  uint8_t lo = 0, hi = 0;
  uint8_t rl = N_ADC_L;
  uint8_t rh = N_ADC_H;

  if (rd(a, rl, &lo) != 0 || rd(a, rh, &hi) != 0) {
    Serial.println(F("ADC read FAILED"));
    return;
  }
  Serial.print(F("ADC = "));
  Serial.print((uint16_t)lo | ((uint16_t)(hi & 0x0F) << 8));
  if (isIdent(a)) {
    uint8_t card = 0;
    rd(a, N_CARD, &card);
    Serial.print(F("   CARD = "));
    Serial.print(card);
  }
  Serial.println();
}

// ================================================================ 识别单元状态
static void showIdentStatus(uint8_t a) {
  uint8_t st = 0, err = 0, ms = 0, card = 0, rt = 0, rl = 0, gd = 0;
  const char *msName[] = { "IDLE", "WAIT", "BUSY", "RESULT", "FAULT" };
  const char *rtName[] = { "none", "NFC", "QR", "BARCODE" };

  if (rd(a, N_STATUS, &st) != 0 || rd(a, N_ERRLAST, &err) != 0 ||
      rd(a, N_MSTATE, &ms) != 0 || rd(a, N_CARD, &card) != 0 ||
      rd(a, N_RESTYPE, &rt) != 0 || rd(a, N_RESLEN, &rl) != 0 ||
      rd(a, N_GATEDEG, &gd) != 0) {
    Serial.println(F("status read FAILED"));
    return;
  }

  Serial.print(F("STATUS=0x")); Serial.print(st, HEX);
  Serial.print(F("  MACH="));   Serial.print((ms < 5) ? msName[ms] : "?");
  Serial.print(F("  CARD="));   Serial.print(card);
  Serial.print(F("  GATE="));   Serial.print(gd);
  Serial.print(F("deg  ERR=0x")); Serial.print(err, HEX);
  Serial.print(F("  RES="));    Serial.print((rt < 4) ? rtName[rt] : "?");
  Serial.print(F(" len="));     Serial.println(rl);
}

// ================================================================ 结果缓冲
static void showResult(uint8_t a) {
  uint8_t rt = 0, rl = 0, i = 0, c = 0;

  if (rd(a, N_RESTYPE, &rt) != 0 || rd(a, N_RESLEN, &rl) != 0) {
    Serial.println(F("cannot read RES_TYPE/RES_LEN"));
    return;
  }
  Serial.print(F("RES_TYPE=")); Serial.print(rt);
  Serial.print(F("  RES_LEN=")); Serial.println(rl);
  if (rl == 0) { Serial.println(F("(empty)")); return; }

  Serial.print(F("RES_BUF = ["));
  for (i = 0; i < rl && i < 32; i++) {
    if (rd(a, (uint8_t)(N_RESBUF + i), &c) != 0) { Serial.print('?'); continue; }
    if (c >= 32 && c < 127) Serial.print((char)c);
    else { Serial.print('<'); Serial.print(c, HEX); Serial.print('>'); }
  }
  Serial.println(F("]"));
}

/* 读任意缓冲区：lenReg = 长度寄存器, bufReg = 数据起始寄存器 */
static void showBuffer(uint8_t a, uint8_t lenReg, uint8_t bufReg, const char *title)
{
  uint8_t len = 0, i, c;
  uint8_t rt = 0;

  rd(a, 0x23, &rt);
  if (rd(a, lenReg, &len) != 0) { Serial.println(F("NO ACK")); return; }

  Serial.print(F("  "));
  Serial.print(title);
  Serial.print(F("  len="));
  Serial.println(len);

  if (len == 0) { Serial.println(F("  (empty)")); return; }

  Serial.print(F("  BUF = ["));
  for (i = 0; i < len && i < 32; i++)
  {
    if (rd(a, (uint8_t)(bufReg + i), &c) != 0) break;
    if (c >= 32 && c < 127) Serial.print((char)c);
    else { Serial.print('<'); Serial.print(c, HEX); Serial.print('>'); }
  }
  Serial.println(F("]"));
}

/* ---- 等 STM32 做完识别，然后自动打印结果（不用再敲 z） ---- */
static void waitAndShowResult(uint8_t a, uint16_t maxMs)
{
  uint16_t t = 0;
  uint8_t ms = 0;
  const char *nm[] = { "IDLE", "WAIT", "BUSY", "RESULT", "FAULT" };

  Serial.print(F("  waiting"));
  while (t < maxMs)
  {
    delay(50);
    t += 50;
    if ((t % 250U) == 0U) Serial.print('.');

    if (rd(a, 0x25, &ms) != 0) continue;     /* MSTATE */
    if (ms == 3U || ms == 4U || ms == 0U) break;
  }
  Serial.println();
  if (ms < 5U) { Serial.print(F("  MACH = ")); Serial.println(nm[ms]); }
  showResult(a);
}


// ================================================================ 扫描 + 概览
static uint8_t scanBus(uint8_t *found, uint8_t maxn) {
  uint8_t n = 0;
  for (uint8_t a = ADDR_FIRST; a <= ADDR_LAST && n < maxn; a++) {
    if (i2cAlive(a)) found[n++] = a;
  }
  return n;
}

static void doScan() {
  uint8_t found[8];
  uint8_t k = scanBus(found, 8);

  Serial.println(F("Scan 0x10..0x23"));
  for (uint8_t i = 0; i < k; i++) {
    Serial.print(F("  found "));
    printAddr(found[i]);
    Serial.print(isIdent(found[i]) ? F("   (IDENT)") : F("   (SORT)"));
    Serial.println();
  }
  Serial.print(k);
  Serial.println(F(" device(s)"));
}

static void doOverview() {
  uint8_t found[8];
  uint8_t k = scanBus(found, 8);

  if (k == 0) { Serial.println(F("no device")); return; }

  for (uint8_t i = 0; i < k; i++) {
    uint8_t hb = 0, fw = 0, lo = 0, hi = 0;
    uint8_t a = found[i];
    rd(a, N_HB, &hb);
    rd(a, N_FW, &fw);
    rd(a, N_ADC_L, &lo);
    rd(a, N_ADC_H, &hi);

    printAddr(a);
    Serial.print(isIdent(a) ? F(" IDENT  ") : F(" SORT   "));
    Serial.print(F("HB="));  Serial.print(hb);
    Serial.print(F("  FW=0x")); Serial.print(fw, HEX);
    Serial.print(F("  ADC=")); Serial.println((uint16_t)lo | ((uint16_t)(hi & 0x0F) << 8));
  }
}

// ================================================================ 帮助
static void help() {
  Serial.println(F("----------------------------------------------------------"));
  Serial.println(F("  s           scan 0x10..0x23"));
  Serial.println(F("  o           overview of every unit"));
  Serial.println(F("  ?           this help"));
  Serial.println(F("-- any address works (0x10 ident, 0x20..0x23 sort) ------"));
  Serial.println(F("  l 0x10 3    light 3 lamps"));
  Serial.println(F("  b 0x20      blink all 4 lamps, 1s"));
  Serial.println(F("  h 0x20      heartbeat"));
  Serial.println(F("  p 0x10      light ADC"));
  Serial.println(F("-- IDENT unit (0x10) only --------------------------------"));
  Serial.println(F("  x 0x10      full status"));
  Serial.println(F("  u 0x10      gate UP (release)"));
  Serial.println(F("  d 0x10      gate DOWN (block)"));
  Serial.println(F("  g 0x10 45   gate to 45 deg"));
  Serial.println(F("  r 0x10      belt RUN"));
  Serial.println(F("  t 0x10      belt STOP"));
  Serial.println(F("  # 0x10 3    belt run 3 seconds"));
  Serial.println(F("  v 0x10      belt REVERSE"));
  Serial.println(F("  c 0x10      trigger scan"));
  Serial.println(F("  a 0x10      auto identify"));
  Serial.println(F("  z 0x10      read LAST result"));
  Serial.println(F("  ! 0x10      read SCAN buffer (persistent)"));
  Serial.println(F("  $ 0x10      read NFC  buffer (persistent)"));
  Serial.println(F("  0 0x10      reset"));
  Serial.println(F("  * 0x10      NFC read UID"));
  Serial.println(F("  = 0x10      sensor ON"));
  Serial.println(F("  % 0x10      sensor OFF"));
  Serial.println(F("  @ 0x10      SELFTEST"));
  Serial.println(F("  + 0x10 150  belt speed"));
  Serial.println(F("  - 0x10 1050 card threshold"));
  Serial.println(F("  > 0x10 5    RAW listen 5s (no trigger)"));
  Serial.println(F("-- SORT unit (0x20..0x23) only ---------------------------"));
  Serial.println(F("  1 0x20      A up    (SERVO_A_UP)"));
  Serial.println(F("  2 0x20      A down  (SERVO_A_DOWN)"));
  Serial.println(F("  3 0x20      B up    (SERVO_B_UP)"));
  Serial.println(F("  4 0x20      B down  (SERVO_B_DOWN)"));
  Serial.println(F("  5 0x20      stop A"));
  Serial.println(F("  6 0x20      stop B"));
  Serial.println(F("  7 0x20      RAISE both"));
  Serial.println(F("  8 0x20      LOWER both"));
  Serial.println(F("  9 0x20      RAISE_HOLD (auto)"));
  Serial.println(F("  m 0x20 100 50   set servo1=1.0s servo2=0.5s"));
  Serial.println(F("  k 0x20 50       speed span 500us"));
  Serial.println(F("  f 0x20          RISE_HOLD: lift -> hold -> auto lower"));
  Serial.println(F("  e 0x20          ARM: card triggers one cycle"));
  Serial.println(F("  q 0x20          DISARM"));
  Serial.println(F("  i 0x20          read limits + card + phase + err"));
  Serial.println(F("  n 0x20          read LIFT_CNT + PHASE"));
  Serial.println(F("  j 0x20          clear LIFT_CNT"));
  Serial.println(F("  y 0x20          blink all 4 lamps"));
  Serial.println(F("  w 0x20          SELFTEST"));
  Serial.println(F("----------------------------------------------------------"));
}

// ================================================================ 命令处理
static char   g_line[64];
static size_t g_len = 0;

static void handleLine(char *line) {
  while (*line == ' ') line++;
  size_t n = strlen(line);
  while (n && (line[n - 1] == ' ' || line[n - 1] == '\r')) line[--n] = 0;
  if (n == 0) return;

  char c = line[0];
  char *arg1 = NULL;
  char *arg2 = NULL;

  if (n > 1) {
    char *p = line + 1;
    while (*p == ' ') p++;
    if (*p) {
      arg1 = p;
      char *sp = strchr(p, ' ');
      if (sp) { *sp = 0; arg2 = sp + 1; while (*arg2 == ' ') arg2++; }
    }
  }

  /* 无地址命令 */
  if (!arg1) {
    switch (c) {
      case 's': case 'S': doScan(); break;
      case 'o': case 'O': doOverview(); break;
      case '?': help(); break;
      default:
        Serial.print(F("need an address, e.g. 'h 0x20'.  type ? for help"));
        Serial.println();
    }
    return;
  }

  int av = parseNum(arg1);
  if (av < 0 || av > 0x7F) { Serial.println(F("bad address")); return; }
  uint8_t a = (uint8_t)av;
  bool ident = isIdent(a);

  switch (c) {
    case 'h': case 'H': showHeartbeat(a); break;
    case 'p': case 'P': showAdc(a); break;

    case 'b': case 'B':
      if (wr(a, 0x18, 4)) {
        Serial.println(F("4 lamps ON, 1s ..."));
        delay(1000);
        wr(a, 0x18, 0);
        Serial.println(F("done"));
      } else Serial.println(F("NO ACK"));
      break;

    case 'l': case 'L': {
      int v = parseNum(arg2);
      if (v < 0 || v > 4) { Serial.println(F("usage: l 0xXX 0..4")); break; }
      Serial.println(wr(a, 0x18, (uint8_t)v) ? F("ok") : F("NO ACK"));
      break;
    }

    /* ---- 下面是识别单元专属 ---- */
    case 'x': case 'X':
      if (ident) showIdentStatus(a);
      else Serial.println(F("status only for 0x10"));
      break;

    case 'u': case 'U':
      if (ident) Serial.println(sendCmd(a, N_C_GATEUP, 0, false) ? F("gate UP") : F("NO ACK"));
      else Serial.println(F("gate only for 0x10"));
      break;

    case 'd': case 'D':
      if (ident) Serial.println(sendCmd(a, N_C_GATEDN, 0, false) ? F("gate DOWN") : F("NO ACK"));
      else Serial.println(F("gate only for 0x10"));
      break;

    case 'g': case 'G': {
      int v = parseNum(arg2);
      if (!ident) { Serial.println(F("gate only for 0x10")); break; }
      if (v < 0 || v > 180) { Serial.println(F("usage: g 0x10 0..180")); break; }
      Serial.println(sendCmd(a, N_C_GATEDEG, (uint8_t)v, true) ? F("gate moving") : F("NO ACK"));
      break;
    }

    case 'r': case 'R':
      if (ident) Serial.println(sendCmd(a, N_C_BELTRUN, 0, false) ? F("belt RUN") : F("NO ACK"));
      else Serial.println(F("belt only for 0x10"));
      break;

    case 't': case 'T':
      if (ident) Serial.println(sendCmd(a, N_C_BELTSTOP, 0, false) ? F("belt STOP") : F("NO ACK"));
      else Serial.println(F("belt only for 0x10"));
      break;

    case 'v': case 'V':
      if (ident) Serial.println(sendCmd(a, N_C_BELTREV, 0, false) ? F("belt REVERSE") : F("NO ACK"));
      else Serial.println(F("belt only for 0x10"));
      break;

    case 'c': case 'C':
      if (!ident) { Serial.println(F("scan only for 0x10")); break; }
      Serial.println(F("trigger scan, up to 3s ..."));
      if (sendCmd(a, N_C_SCAN, 0, false)) { waitAndShowResult(a, 5000U); }
      else Serial.println(F("NO ACK"));
      showIdentStatus(a);
      break;

    case 'a': case 'A':
      if (!ident) { Serial.println(F("identify only for 0x10")); break; }
      Serial.println(F("auto identify ..."));
      if (sendCmd(a, N_C_IDENT, 0, false)) { waitAndShowResult(a, 7000U); }
      else Serial.println(F("NO ACK"));
      showIdentStatus(a);
      break;

    case 'z': case 'Z':
      if (ident) showResult(a);
      else Serial.println(F("result only for 0x10"));
      break;

    case '0':
      if (ident) Serial.println(sendCmd(a, N_C_RESET, 0, false) ? F("RESET") : F("NO ACK"));
      else Serial.println(F("reset only for 0x10"));
      break;

    /* ---- 分拣单元 V5：单路/整组动作 ---- */
    case '1':
      if (!ident) Serial.println(sendCmd(a, 0x13, 0, false) ? F("A 抬升 (SERVO_A_UP)") : F("NO ACK"));
      else Serial.println(F("sort only"));
      break;

    case '2':
      if (!ident) Serial.println(sendCmd(a, 0x14, 0, false) ? F("A 下降 (SERVO_A_DOWN)") : F("NO ACK"));
      else Serial.println(F("sort only"));
      break;

    case '3':
      if (!ident) Serial.println(sendCmd(a, 0x15, 0, false) ? F("B 抬升 (SERVO_B_UP)") : F("NO ACK"));
      else Serial.println(F("sort only"));
      break;

    case '4':
      if (!ident) Serial.println(sendCmd(a, 0x16, 0, false) ? F("B 下降 (SERVO_B_DOWN)") : F("NO ACK"));
      else Serial.println(F("sort only"));
      break;

    case '5':
      if (!ident) Serial.println(sendCmd(a, 0x17, 1, true) ? F("A 停 (STOP A)") : F("NO ACK"));
      else Serial.println(F("sort only"));
      break;

    case '6':
      if (!ident) Serial.println(sendCmd(a, 0x17, 2, true) ? F("B 停 (STOP B)") : F("NO ACK"));
      else Serial.println(F("sort only"));
      break;

    case '7':
      if (!ident) Serial.println(sendCmd(a, 0x10, 0, false) ? F("两路抬升 (RAISE)") : F("NO ACK"));
      else Serial.println(F("sort only"));
      break;

    case '8':
      if (!ident) Serial.println(sendCmd(a, 0x12, 0, false) ? F("两路下降 (LOWER)") : F("NO ACK"));
      else Serial.println(F("sort only"));
      break;

    case '9':
      if (!ident) Serial.println(sendCmd(a, 0x11, 0, false) ? F("一键分拣 RAISE_HOLD") : F("NO ACK"));
      else Serial.println(F("sort only"));
      break;

    case 'm': case 'M': {
      char *p2 = arg2;
      int v1 = parseNum(arg2);
      int v2 = -1;
      if (p2) {
        char *sp = strchr(p2, ' ');
        if (sp) { *sp = 0; v2 = parseNum(sp + 1); }
      }
      if (ident) { Serial.println(F("sort only")); break; }
      if (v1 < 0) { Serial.println(F("usage: m 0x20 <s1_ms/10> <s2_ms/10>")); break; }
      wr(a, 0x10, (uint8_t)v1);
      if (v2 >= 0) wr(a, 0x11, (uint8_t)v2);
      Serial.print(F("servo1_ms=")); Serial.print(v1 * 10);
      if (v2 >= 0) { Serial.print(F("ms  servo2_ms=")); Serial.print(v2 * 10); }
      Serial.println(F("ms"));
      break;
    }

    case 'k': case 'K': {
      int v = parseNum(arg2);
      if (ident) { Serial.println(F("sort only")); break; }
      if (v < 0 || v > 100) { Serial.println(F("usage: k 0x20 0..100")); break; }
      wr(a, 0x12, (uint8_t)v);
      Serial.print(F("speed span = ")); Serial.print(v * 10); Serial.println(F("us"));
      break;
    }

    /* ---- 分拣单元：完整功能 ---- */
    case 'f': case 'F':                    /* f = 一键分拣 */
      if (!ident) Serial.println(sendCmd(a, 0x19, 0, false) ? F("RISE_HOLD: lift -> hold -> auto lower") : F("NO ACK"));
      else Serial.println(F("sort only"));
      break;

    case 'e': case 'E':                    /* e = ARM 光敏自动触发 */
      if (!ident) Serial.println(sendCmd(a, 0x1A, 0, false) ? F("ARMED: card triggers one cycle") : F("NO ACK"));
      else Serial.println(F("sort only"));
      break;

    case 'q': case 'Q':                    /* DISARM */
      if (!ident) Serial.println(sendCmd(a, 0x1B, 0, false) ? F("DISARMED") : F("NO ACK"));
      else Serial.println(F("sort only"));
      break;

    case 'n': case 'N': {                  /* 读动作计数 */
      uint8_t cnt = 0, ph = 0;
      if (ident) { Serial.println(F("sort only")); break; }
      rd(a, 0x25, &cnt);
      rd(a, 0x26, &ph);
      Serial.print(F("LIFT_CNT = ")); Serial.print(cnt);
      Serial.print(F("   PHASE = ")); Serial.println(ph);
      break;
    }

    case 'j': case 'J':                    /* 清计数 */
      if (!ident) Serial.println(sendCmd(a, 0x1C, 0, false) ? F("count cleared") : F("NO ACK"));
      else Serial.println(F("sort only"));
      break;

    case 'y': case 'Y':                    /* 灯闪烁 */
      if (ident) { Serial.println(F("sort only")); break; }
      Serial.println(sendCmd(a, 0x21, 0, false) ? F("blink all 4") : F("NO ACK"));
      break;

    case 'w': case 'W':                    /* w = 自检 */
      if (ident) { Serial.println(F("sort only")); break; }
      Serial.println(sendCmd(a, 0x30, 0, false) ? F("SELFTEST running...") : F("NO ACK"));
      break;

    case 'i': case 'I': {                  /* i = 读限位 + 光敏有卡 */
      uint8_t lim = 0, card = 0, ph = 0, err = 0;
      if (ident) { Serial.println(F("sort only")); break; }
      rd(a, 0x22, &lim);
      rd(a, 0x23, &card);
      rd(a, 0x26, &ph);
      rd(a, 0x03, &err);
      Serial.print(F("LIMIT=0x")); Serial.print(lim, HEX);
      Serial.print(F("  (bit0=lim1 bit1=lim2)  CARD=")); Serial.print(card);
      Serial.print(F("  PHASE=")); Serial.print(ph);
      Serial.print(F("  ERR=0x")); Serial.println(err, HEX);
      break;
    }

    case '#': {                            /* # 0x10 3  皮带转 3 秒 */
      int sec = parseNum(arg2);
      if (ident) { Serial.println(F("belt only for 0x10")); break; }
      if (sec <= 0) { Serial.println(F("usage: # 0x10 <seconds>")); break; }
      Serial.print(F("belt run "));
      Serial.print(sec);
      Serial.println(F(" s ..."));
      Serial.println(sendCmd(a, 0x13, (uint8_t)sec, true) ? F("started") : F("NO ACK"));
      break;
    }

    /* ---- IDENT 单元：其余功能 ---- */
    case '*':                              /* * 0x10  NFC 读卡 */
      if (!ident) { Serial.println(F("ident only")); break; }
      Serial.println(F("NFC read, waiting ..."));
      if (sendCmd(a, 0x25, 0, false)) { waitAndShowResult(a, 5000U); }
      else Serial.println(F("NO ACK"));
      break;

    case '=':                              /* = 0x10  传感器使能 */
      if (!ident) { Serial.println(F("ident only")); break; }
      Serial.println(sendCmd(a, 0x20, 0, false) ? F("SENSOR_ON") : F("NO ACK"));
      break;

    case '%':                              /* % 0x10  传感器关闭 */
      if (!ident) { Serial.println(F("ident only")); break; }
      Serial.println(sendCmd(a, 0x21, 0, false) ? F("SENSOR_OFF") : F("NO ACK"));
      break;

    case '@':                              /* @ 0x10  全功能自检 */
      if (!ident) { Serial.println(F("ident only")); break; }
      Serial.println(sendCmd(a, 0x40, 0, false) ? F("SELFTEST running ...") : F("NO ACK"));
      break;

    case '+': {                            /* + 0x10 150  皮带速度 */
      int v = parseNum(arg2);
      if (!ident) { Serial.println(F("ident only")); break; }
      if (v < 0 || v > 255) { Serial.println(F("usage: + 0x10 0..255")); break; }
      Serial.println(wr(a, 0x10, (uint8_t)v) ? F("belt speed set") : F("NO ACK"));
      break;
    }

    case '-': {                            /* - 0x10 1050  光敏阈值 */
      int v = parseNum(arg2);
      if (v < 0 || v > 4080) { Serial.println(F("usage: - 0x10 0..4080")); break; }
      Serial.println(wr(a, 0x16, (uint8_t)(v / 16)) ? F("card threshold set") : F("NO ACK"));
      break;
    }

    case '>': {                            /* > 0x10 5  原始监听 5 秒 */
      int sec = parseNum(arg2);
      if (!ident) { Serial.println(F("ident only")); break; }
      if (sec <= 0 || sec > 30) { Serial.println(F("usage: > 0x10 <1..30>")); break; }
      Serial.print(F("raw listen "));
      Serial.print(sec);
      Serial.println(F(" s - no trigger, just listening ..."));
      if (sendCmd(a, 0x26, (uint8_t)sec, true)) {
        delay((uint32_t)sec * 1000UL + 300UL);
        showResult(a);
      } else Serial.println(F("NO ACK"));
      break;
    }

    case '!': {                            /* ! 0x10  读扫码持久缓冲区 */
      if (!ident) { Serial.println(F("ident only")); break; }
      showBuffer(a, 0x2C, 0x60, "QR   (scan)");
      break;
    }

    case '$': {                            /* $ 0x10  读 NFC 持久缓冲区 */
      if (!ident) { Serial.println(F("ident only")); break; }
      showBuffer(a, 0x2D, 0x80, "NFC  (uid)");
      break;
    }

    default:
      Serial.print(F("unknown '"));
      Serial.print(c);
      Serial.println(F("'  (type ? for help)"));
  }
}

// ================================================================ setup / loop

/* ==========================================================================
 *  I²C 总线恢复
 * --------------------------------------------------------------------------
 *  如果从机卡在传输中间，会一直把 SDA 拽在低电平，主站永远开始不了。
 *  这里在 Wire.begin() 之前手动生成 START + STOP 时序，把从机状态机打回空闲。
 *
 *  时序（和你手动把 SDA 拉低再放开是一样的）：
 *      SCL 保持高 -> SDA 拉低       = START 条件（从机复位）
 *      保持 LOW_RECOVER_MS 毫秒
 *      SCL 保持高 -> SDA 释放为高   = STOP 条件（总线释放）
 *      再补 9 个 SCL 时钟，把任何半截字节推完
 * ========================================================================== */
#define RECOVER_LOW_MS   500

static void i2cBusRecover(void)
{
  uint8_t i;

  /* 两根线都先当普通 IO，拉高（开漏靠外部上拉，这里直接推高也行） */
  pinMode(A4, OUTPUT);          /* SDA */
  pinMode(A5, OUTPUT);          /* SCL */
  digitalWrite(A4, HIGH);
  digitalWrite(A5, HIGH);
  delay(5);

  /* --- START：SCL 高时 SDA 由高变低 --- */
  digitalWrite(A4, LOW);
  delay(RECOVER_LOW_MS);        /* 你实测 0.5 秒够用 */

  /* --- STOP：SCL 高时 SDA 由低变高 --- */
  digitalWrite(A4, HIGH);
  delay(5);

  /* --- 标准恢复：补 9 个 SCL 时钟 --- */
  for (i = 0; i < 9; i++)
  {
    digitalWrite(A5, LOW);
    delayMicroseconds(20);
    digitalWrite(A5, HIGH);
    delayMicroseconds(20);
  }

  /* --- 再来一组 START + STOP 收尾 --- */
  digitalWrite(A4, LOW);  delayMicroseconds(20);
  digitalWrite(A5, HIGH); delayMicroseconds(20);
  digitalWrite(A4, HIGH); delayMicroseconds(20);

  /* 交还给 Wire 库 */
  pinMode(A4, INPUT);
  pinMode(A5, INPUT);
  delay(5);
}


void setup() {
  Serial.begin(115200);
  while (!Serial) { ; }
  i2cBusRecover();      /* 先恢复总线，再启动 Wire */
  Wire.begin();
  Wire.setClock(50000);

  Serial.println();
  Serial.println(F("=============================================="));
  Serial.println(F("  S-LAN V4.3   all-unit test bench"));
  Serial.println(F("  all units: unified V5 register map"));
  Serial.println(F("  SCL=A4  SDA=A5   pull-ups on Nano side"));
  Serial.println(F("=============================================="));

  doScan();
  doOverview();
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
