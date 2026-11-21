/*
 * ============================================================================
 *  单块分拣单元测试   ——   目标地址 0x20 (A 板)
 * ============================================================================
 *
 *  只测一块，不做扫描菜单。上电就干三件事：
 *
 *    ① 探测 0x20 有没有应答
 *       没应答 -> 自动试 0x10 / 0x21 / 0x22 / 0x23，告诉你"它可能在哪"
 *    ② 有应答 -> 依次测：固件版本 / 心跳 / 回声 / 四颗灯 / 光敏 / 接收计数
 *    ③ 之后每 2 秒打印一行状态；串口敲任意键 = 重测一遍
 *
 *  串口 115200    行结尾选 Newline
 *
 *  接线：Nano A4=SCL  A5=SDA  GND  +5V
 *        上拉 2.2k/4.7k ×2 只在 Nano 一端
 * ============================================================================
 */

#include <Wire.h>

#define TARGET         0x20
#define REG_LED_N      0x00
#define REG_ECHO       0x01
#define REG_HEARTBEAT  0x02
#define REG_FW_VER     0x03
#define REG_ADC_L      0x04
#define REG_ADC_H      0x05
#define REG_RX_CNT     0x06
#define REG_PTR        0xFE

static unsigned long g_lastPrint = 0;

// ---------------------------------------------------------------- 基础
static void printHex(uint8_t v) {
  Serial.print(F("0x"));
  if (v < 0x10) Serial.print('0');
  Serial.print(v, HEX);
}

static bool probe(uint8_t a) {
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

// ---------------------------------------------------------------- 诊断
// 没应答时，把常见地址都试一遍，报出来
static void diagnose() {
  Serial.println(F("  Diagnosing: probing common addresses ..."));

  const uint8_t list[] = { 0x10, 0x20, 0x21, 0x22, 0x23 };
  uint8_t hit = 0;

  for (uint8_t i = 0; i < sizeof(list); i++) {
    if (probe(list[i])) {
      hit++;
      Serial.print(F("    found "));
      printHex(list[i]);
      if (list[i] == 0x10) {
        Serial.println(F("   <- 这是旧地址，说明这块板没重烧到 0x20"));
      } else if (list[i] == TARGET) {
        Serial.println(F("   <- 目标地址，正常"));
      } else {
        Serial.println(F("   <- 地址不是 0x20，烧错文件了"));
      }
    }
  }

  if (hit == 0) {
    Serial.println(F("    nothing on the bus at all."));
    Serial.println(F("    按顺序查："));
    Serial.println(F("      1) Nano 端 2.2k/4.7k 上拉焊了吗？(A4 对 +5V 应约 2.2k)"));
    Serial.println(F("      2) GND 共地了吗？"));
    Serial.println(F("      3) 单元板有 5V 吗？(量 U10 脚4)"));
    Serial.println(F("      4) SDA/SCL 接反了吗？(Nano A4=SCL A5=SDA)"));
    Serial.println(F("      5) 用的是 U10 还是 U14？U14 线序是反的！"));
  }
}

// ---------------------------------------------------------------- 全测
static void testAll() {
  Serial.println();
  Serial.println(F("=============================================="));
  Serial.print(F("  testing unit "));
  printHex(TARGET);
  Serial.println();

  if (!probe(TARGET)) {
    Serial.print(F("  [FAIL] no ACK from "));
    printHex(TARGET);
    Serial.println();
    diagnose();
    return;
  }
  Serial.println(F("  [ OK ] device answers"));

  // 1 固件版本
  uint8_t fw = 0;
  if (rd(TARGET, REG_FW_VER, &fw) == 0) {
    Serial.print(F("  [ OK ] FW_VER     = 0x"));
    Serial.print(fw, HEX);
    Serial.println(fw == 0x10 ? F("  (expected)") : F("  (unexpected!)"));
  } else {
    Serial.println(F("  [FAIL] FW_VER     read error"));
  }

  // 2 心跳
  uint8_t h1 = 0, h2 = 0;
  bool hb_ok = (rd(TARGET, REG_HEARTBEAT, &h1) == 0) &&
               (rd(TARGET, REG_HEARTBEAT, &h2) == 0) &&
               (h2 != h1);
  Serial.print(F("  ["));
  Serial.print(hb_ok ? F(" OK ") : F("FAIL"));
  Serial.print(F("] HEARTBEAT   "));
  Serial.print(h1);
  Serial.print(F(" -> "));
  Serial.println(h2);

  // 3 回声
  uint8_t back = 0;
  bool echo_ok = wr(TARGET, REG_ECHO, 0xA5) &&
                 (rd(TARGET, REG_ECHO, &back) == 0) &&
                 (back == 0xA5);
  Serial.print(F("  ["));
  Serial.print(echo_ok ? F(" OK ") : F("FAIL"));
  Serial.print(F("] ECHO        wrote 0xA5 read 0x"));
  Serial.print(back, HEX);
  Serial.println();

  // 4 四颗灯
  Serial.println(F("  [ .. ] LED       0 -> 1 -> 2 -> 3 -> 4 -> 0   (watch the lamps!)"));
  bool led_ok = true;
  for (uint8_t n = 0; n <= 4; n++) {
    if (!wr(TARGET, REG_LED_N, n)) led_ok = false;
    delay(400);
  }
  wr(TARGET, REG_LED_N, 0);
  Serial.print(F("  ["));
  Serial.print(led_ok ? F(" OK ") : F("FAIL"));
  Serial.println(F("] LED       all writes ACKed"));

  // 5 光敏
  uint8_t lo = 0, hi = 0;
  if (rd(TARGET, REG_ADC_L, &lo) == 0 && rd(TARGET, REG_ADC_H, &hi) == 0) {
    uint16_t adc = (uint16_t)lo | ((uint16_t)(hi & 0x0F) << 8);
    Serial.print(F("  [ OK ] LIGHT     ADC = "));
    Serial.println(adc);
    Serial.println(F("         cover the photoresistor -> the number in the status line below should drop"));
  } else {
    Serial.println(F("  [FAIL] LIGHT     read error"));
  }

  // 6 接收计数
  uint8_t rx = 0;
  if (rd(TARGET, REG_RX_CNT, &rx) == 0) {
    Serial.print(F("  [ OK ] RX_CNT    = "));
    Serial.println(rx);
  } else {
    Serial.println(F("  [FAIL] RX_CNT    read error"));
  }

  Serial.println(F("=============================================="));
  Serial.println(F("  status line below, press any key to re-test"));
}

// ---------------------------------------------------------------- setup
void setup() {
  Serial.begin(115200);
  while (!Serial) { ; }
  Wire.begin();
  Wire.setClock(100000);

  Serial.println();
  Serial.println(F("=============================================="));
  Serial.println(F("  single unit test    target = 0x20 (A board)"));
  Serial.println(F("  SCL=A4  SDA=A5"));
  Serial.println(F("=============================================="));

  delay(300);
  testAll();
  g_lastPrint = millis();
}

// ---------------------------------------------------------------- loop
void loop() {
  // 按键 -> 重测
  if (Serial.available()) {
    while (Serial.available()) Serial.read();
    testAll();
    g_lastPrint = millis();
    return;
  }

  // 每 2 秒一行状态
  if (millis() - g_lastPrint >= 2000) {
    g_lastPrint = millis();

    if (!probe(TARGET)) {
      Serial.print(F("["));
      Serial.print(millis() / 1000);
      Serial.println(F("s] 0x20 OFFLINE  (no answer)"));
      return;
    }

    uint8_t hb = 0, rx = 0, lo = 0, hi = 0;
    rd(TARGET, REG_HEARTBEAT, &hb);
    rd(TARGET, REG_RX_CNT,    &rx);
    rd(TARGET, REG_ADC_L,     &lo);
    rd(TARGET, REG_ADC_H,     &hi);
    uint16_t adc = (uint16_t)lo | ((uint16_t)(hi & 0x0F) << 8);

    Serial.print(F("["));
    Serial.print(millis() / 1000);
    Serial.print(F("s] 0x20 ONLINE   HB="));
    Serial.print(hb);
    Serial.print(F("  ADC="));
    Serial.print(adc);
    Serial.print(F("  RX="));
    Serial.println(rx);
  }
}
