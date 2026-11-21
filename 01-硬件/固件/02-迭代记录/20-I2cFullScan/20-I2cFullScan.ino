/*
 * ============================================================================
 *  I²C 全段扫描器  (0x01 ~ 0x7F)
 * ============================================================================
 *
 *  用途：不管板子里烧的是什么地址，先把它"揪出来"。
 *        每 3 秒自动重扫一次，方便边接线边看变化。
 *
 *  串口 115200
 *
 *  输出会标出：
 *      0x10            -> 还是旧的识别单元地址（没重烧）
 *      0x20~0x23       -> 分拣单元，正常
 *      其它地址        -> 意外的地址（扫到要警惕）
 *
 *  接线：Nano A4=SCL  A5=SDA  上拉 2.2k/4.7k ×2 只在 Nano 端
 * ============================================================================
 */

#include <Wire.h>

#define SCAN_FIRST  0x01
#define SCAN_LAST   0x7F

static void printHex(uint8_t v) {
  Serial.print(F("0x"));
  if (v < 0x10) Serial.print('0');
  Serial.print(v, HEX);
}

static uint8_t scanOnce() {
  uint8_t n = 0;

  for (uint8_t a = SCAN_FIRST; a <= SCAN_LAST; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      n++;
      Serial.print(F("  found "));
      printHex(a);

      if (a == 0x10) {
        Serial.print(F("   <- 旧的识别单元地址（这块没重烧到 0x20~0x23）"));
      } else if (a >= 0x20 && a <= 0x23) {
        Serial.print(F("   <- 分拣单元，正常"));
      } else {
        Serial.print(F("   <- 意外地址，留意一下"));
      }
      Serial.println();
    }
  }
  return n;
}

void setup() {
  Serial.begin(115200);
  while (!Serial) { ; }
  Wire.begin();
  Wire.setClock(100000);

  Serial.println();
  Serial.println(F("=============================================="));
  Serial.println(F("  I2C full scan  0x01 .. 0x7F"));
  Serial.println(F("  SCL=A4  SDA=A5"));
  Serial.println(F("  auto rescan every 3s"));
  Serial.println(F("=============================================="));
}

void loop() {
  Serial.print(F("--- scan @ "));
  Serial.print(millis() / 1000);
  Serial.println(F("s ---"));

  uint8_t n = scanOnce();

  Serial.print(F("  "));
  Serial.print(n);
  Serial.println(F(" device(s)"));

  if (n == 0) {
    Serial.println(F("  (nothing) check: pull-ups, GND, SDA/SCL, unit power"));
  }

  Serial.println();
  delay(3000);
}
