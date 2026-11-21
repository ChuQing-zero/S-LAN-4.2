/*
 * ============================================================================
 *  Nano 最小主控：只干一件事 —— 往 0x20 写"亮 4 颗灯"
 * ============================================================================
 *
 *  没有任何菜单、不用敲命令。上电就循环：
 *
 *      1) 扫描 0x20
 *      2) 写 LED_N = 4   -> 灯应该亮
 *      3) 串口报 ACK / NAK
 *      4) 停 1 秒
 *      5) 写 LED_N = 0   -> 灯灭
 *      6) 停 1 秒
 *
 *  串口 115200。看到一个 ACK 一个 NAK 交替，并且灯跟着亮灭，就是通了。
 *
 *  这份程序故意什么都不做，只验证"一条 I²C 写能不能成功"。
 * ============================================================================
 */

#include <Wire.h>

#define TARGET        0x20
#define REG_LED_N     0x00

static unsigned long t0 = 0;

static void printHex(uint8_t v) {
  Serial.print(F("0x"));
  if (v < 0x10) Serial.print('0');
  Serial.print(v, HEX);
}

static bool probe(uint8_t a) {
  Wire.beginTransmission(a);
  return Wire.endTransmission() == 0;
}

static void writeLamps(uint8_t n) {
  Wire.beginTransmission(TARGET);
  Wire.write(REG_LED_N);
  Wire.write(n);
  uint8_t err = Wire.endTransmission();

  Serial.print(F("["));
  Serial.print((millis() - t0) / 1000);
  Serial.print(F("s] write LED_N="));
  Serial.print(n);
  Serial.print(F(" -> "));
  if (err == 0) {
    Serial.println(F("ACK  (lamps should follow)"));
  } else {
    Serial.print(F("NAK  err="));
    Serial.println(err);
  }
}

void setup() {
  Serial.begin(115200);
  while (!Serial) { ; }
  Wire.begin();
  Wire.setClock(100000);
  t0 = millis();

  Serial.println();
  Serial.println(F("=============================================="));
  Serial.println(F("  minimal I2C lamp test   target 0x20"));
  Serial.println(F("  SCL=A4  SDA=A5"));
  Serial.println(F("=============================================="));

  Serial.print(F("probe "));
  printHex(TARGET);
  Serial.println(probe(TARGET) ? F("  -> ACK, device is there")
                               : F("  -> NO ACK, device not answering"));
}

void loop() {
  /* 每轮开头先探一次，掉线能看出来 */
  if (!probe(TARGET)) {
    Serial.print(F("["));
    Serial.print((millis() - t0) / 1000);
    Serial.print(F("s] "));
    printHex(TARGET);
    Serial.println(F(" NO ACK  (check wiring / address / power)"));
    delay(1000);
    return;
  }

  writeLamps(4);     /* 亮 4 颗 */
  delay(1000);

  writeLamps(0);     /* 全灭 */
  delay(1000);
}
