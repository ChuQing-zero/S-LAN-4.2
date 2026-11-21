/*
 * ============================================================================
 *  S-LAN V4.3  ·  FEED 板整板功能自检                        Nano 固件测试
 * ============================================================================
 *
 *  一块一块地试：继电器、按钮、蜂鸣器、数码管、电机、光敏、ESP-01 WiFi。
 *  每个功能都能单独跑，也能一键全跑。
 *
 *  串口 115200，指令：
 *      a            全自动自检（依次跑一遍，每条打印 PASS / FAIL）
 *      2            蜂鸣器响一声
 *      3            上机提示音（开机三连）
 *      4            数码管显示 0000~0004 与文字
 *      5            按钮测试（10 秒监视，按一下打印一次）
 *      6 风扇       切换风扇继电器
 *      7 灯         切换补光灯继电器
 *      8 电机       电机正转/反转/调速/停
 *      9 光敏       连读 3 秒 ADC，用手挡光敏看变化
 *      w            ESP-01 WiFi 测试（发 AT，看回不回 OK）
 *      ?            帮助
 *
 *  ⚠️ 已知硬件问题：补光灯接在 A6，而 Nano 的 A6/A7 只能做模拟输入，
 *     **无法输出**。本程序会对 A6 做一次自检并如实报告。
 *
 *  引脚（按 FEED 板网表）：
 *      D3  按钮1        D6  按钮2        D11 蜂鸣器
 *      D4  数码管 CLK   D5  数码管 DIO
 *      D7  电机 ENA     D8  电机 IN1     D9  电机 IN2
 *      D10 ESP-01 RX←   D12 ESP-01 TX→   （经 1K/2K 分压）
 *      A0  状态指示灯   A1  继电器(风扇) A2  继电器(灯)
 *      A6  补光灯(不可输出)   A7  光敏电阻
 * ============================================================================
 */

#include <SoftwareSerial.h>

// ---------------------------------------------------------------- 引脚
#define PIN_BTN1        3
#define PIN_BTN2        6
#define PIN_TM_CLK      4
#define PIN_TM_DIO      5
#define PIN_MOTOR_ENA   7
#define PIN_MOTOR_IN1   8
#define PIN_MOTOR_IN2   9
#define PIN_ESP_TX      10      // Nano -> ESP（经分压）
#define PIN_BUZZER      11
#define PIN_ESP_RX      12      // ESP -> Nano
#define PIN_LED_STATUS  A0
#define PIN_RELAY_FAN   A1
#define PIN_RELAY_LAMP  A2
#define PIN_LIGHT_FILL  A6      // ⚠ 只能模拟输入
#define PIN_LIGHT_SENSE A7

// 继电器极性：高电平吸合（若相反改成 LOW）
#define RELAY_ON   HIGH
#define RELAY_OFF  LOW

SoftwareSerial esp(PIN_ESP_RX, PIN_ESP_TX);

static bool g_relayFan = false;
static bool g_relayLamp = false;

// ================================================================ 数码管
// 最小 TM1637 驱动（不依赖第三方库）
static void tmStart() {
  digitalWrite(PIN_TM_CLK, HIGH);
  digitalWrite(PIN_TM_DIO, HIGH);
  delayMicroseconds(5);
  digitalWrite(PIN_TM_DIO, LOW);
  delayMicroseconds(5);
}

static void tmStop() {
  digitalWrite(PIN_TM_CLK, LOW);
  delayMicroseconds(5);
  digitalWrite(PIN_TM_DIO, LOW);
  delayMicroseconds(5);
  digitalWrite(PIN_TM_CLK, HIGH);
  delayMicroseconds(5);
  digitalWrite(PIN_TM_DIO, HIGH);
  delayMicroseconds(5);
}

static void tmWriteByte(uint8_t b) {
  for (uint8_t i = 0; i < 8; i++) {
    digitalWrite(PIN_TM_CLK, LOW);
    delayMicroseconds(3);
    digitalWrite(PIN_TM_DIO, (b & 0x01) ? HIGH : LOW);
    b >>= 1;
    delayMicroseconds(3);
    digitalWrite(PIN_TM_CLK, HIGH);
    delayMicroseconds(3);
  }
  // ACK
  digitalWrite(PIN_TM_CLK, LOW);
  pinMode(PIN_TM_DIO, INPUT);
  delayMicroseconds(5);
  digitalWrite(PIN_TM_CLK, HIGH);
  delayMicroseconds(5);
  pinMode(PIN_TM_DIO, OUTPUT);
}

static void tmInit() {
  pinMode(PIN_TM_CLK, OUTPUT);
  pinMode(PIN_TM_DIO, OUTPUT);
  digitalWrite(PIN_TM_CLK, HIGH);
  digitalWrite(PIN_TM_DIO, HIGH);
  // 显示开，最大亮度
  tmStart(); tmWriteByte(0x8F); tmStop();
}

// 7 段码表（0-9, A-F, 空格, 减号）
static const uint8_t SEG[] = {
  0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07,
  0x7F, 0x6F, 0x77, 0x7C, 0x39, 0x5E, 0x79, 0x71
};

static uint8_t segOf(char c) {
  if (c >= '0' && c <= '9') return SEG[c - '0'];
  if (c >= 'A' && c <= 'F') return SEG[c - 'A' + 10];
  if (c >= 'a' && c <= 'f') return SEG[c - 'a' + 10];
  if (c == '-') return 0x40;
  return 0x00;                        // 空白
}

// 显示 4 个字符（自动右对齐不足补空）
static void tmShow(const char *s) {
  char buf[4] = {' ', ' ', ' ', ' '};
  int len = strlen(s);
  if (len > 4) { s += (len - 4); len = 4; }
  for (int i = 0; i < len; i++) buf[4 - len + i] = s[i];

  tmStart(); tmWriteByte(0x40); tmStop();          // 自动地址
  tmStart(); tmWriteByte(0xC0);                    // 起始地址 0
  for (int i = 0; i < 4; i++) tmWriteByte(segOf(buf[i]));
  tmStop();
}

static void tmShowNum(long n) {
  char buf[12];
  snprintf(buf, sizeof(buf), "%ld", n);
  tmShow(buf);
}

// ================================================================ 蜂鸣器
static void beep(uint16_t ms) {
  digitalWrite(PIN_BUZZER, HIGH);
  delay(ms);
  digitalWrite(PIN_BUZZER, LOW);
}

// 上机提示音：三连短响
static void bootChime() {
  beep(80);  delay(70);
  beep(80);  delay(70);
  beep(160);
}

// ================================================================ 继电器
static void setRelay(uint8_t pin, bool on, bool &state, const char *name) {
  digitalWrite(pin, on ? RELAY_ON : RELAY_OFF);
  state = on;
  Serial.print(F("  "));
  Serial.print(name);
  Serial.println(on ? F(" -> ON   (should hear a click)") : F(" -> OFF"));
}

// ================================================================ 各项测试
static bool testBuzzer() {
  Serial.println(F("--- [2] buzzer ---"));
  beep(200);
  Serial.println(F("  beep 200ms: did you hear it? PASS if yes"));
  return true;
}

static bool testBootChime() {
  Serial.println(F("--- [3] boot chime ---"));
  bootChime();
  Serial.println(F("  three short beeps"));
  return true;
}

static bool testDisplay() {
  Serial.println(F("--- [4] TM1637 display ---"));
  for (int i = 0; i <= 4; i++) {
    tmShowNum(i);
    delay(400);
  }
  tmShow("8888"); delay(400);
  tmShow("AbCd"); delay(600);
  tmShow("----"); delay(400);
  tmShowNum(0);
  Serial.println(F("  expect 0..4 then 8888 / AbCd / ----"));
  Serial.println(F("  nothing? -> check TM1637 module pin order (CLK/DIO swapped?)"));
  return true;
}

static bool testButtons() {
  Serial.println(F("--- [5] buttons, watching 10s ---"));
  Serial.println(F("  press D3 / D6 ..."));

  bool last1 = HIGH, last2 = HIGH;
  unsigned long t0 = millis();
  int hits = 0;

  while (millis() - t0 < 10000) {
    bool b1 = digitalRead(PIN_BTN1);
    bool b2 = digitalRead(PIN_BTN2);

    if (b1 != last1) {
      last1 = b1;
      if (b1 == LOW) { Serial.println(F("  BTN1 (D3) pressed"));  hits++; beep(30); }
      else          { Serial.println(F("  BTN1 (D3) released")); }
    }
    if (b2 != last2) {
      last2 = b2;
      if (b2 == LOW) { Serial.println(F("  BTN2 (D6) pressed"));  hits++; beep(30); }
      else          { Serial.println(F("  BTN2 (D6) released")); }
    }
    delay(10);
  }

  Serial.print(F("  hits = "));
  Serial.println(hits);
  Serial.println(hits ? F("  PASS") : F("  FAIL: no button event"));
  return hits > 0;
}

static bool testRelays() {
  Serial.println(F("--- [6][7] relays ---"));

  setRelay(PIN_RELAY_FAN,  true,  g_relayFan,  "relay FAN ");
  delay(1200);
  setRelay(PIN_RELAY_FAN,  false, g_relayFan,  "relay FAN ");
  delay(400);

  setRelay(PIN_RELAY_LAMP, true,  g_relayLamp, "relay LAMP");
  delay(1200);
  setRelay(PIN_RELAY_LAMP, false, g_relayLamp, "relay LAMP");
  Serial.println(F("  no click? -> relay polarity may be inverted (change RELAY_ON)"));
  return true;
}

static bool testMotor() {
  Serial.println(F("--- [8] motor via L298N ---"));
  pinMode(PIN_MOTOR_ENA, OUTPUT);
  pinMode(PIN_MOTOR_IN1, OUTPUT);
  pinMode(PIN_MOTOR_IN2, OUTPUT);

  // 正转，慢速
  Serial.println(F("  forward 60%"));
  digitalWrite(PIN_MOTOR_IN1, HIGH);
  digitalWrite(PIN_MOTOR_IN2, LOW);
  analogWrite(PIN_MOTOR_ENA, 153);
  delay(1500);

  // 反转
  Serial.println(F("  reverse 60%"));
  digitalWrite(PIN_MOTOR_IN1, LOW);
  digitalWrite(PIN_MOTOR_IN2, HIGH);
  analogWrite(PIN_MOTOR_ENA, 153);
  delay(1500);

  // 调速
  Serial.println(F("  ramp 40% -> 100%"));
  digitalWrite(PIN_MOTOR_IN1, HIGH);
  digitalWrite(PIN_MOTOR_IN2, LOW);
  for (int s = 100; s <= 255; s += 30) {
    analogWrite(PIN_MOTOR_ENA, s);
    delay(300);
  }

  // 停
  analogWrite(PIN_MOTOR_ENA, 0);
  digitalWrite(PIN_MOTOR_IN1, LOW);
  digitalWrite(PIN_MOTOR_IN2, LOW);
  Serial.println(F("  stop"));
  return true;
}

static bool testLight() {
  Serial.println(F("--- [9] photoresistor (A7) ---"));
  unsigned long t0 = millis();
  int lo = 1023, hi = 0;
  while (millis() - t0 < 3000) {
    int v = analogRead(PIN_LIGHT_SENSE);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    Serial.print(F("  A7 = "));
    Serial.println(v);
    delay(120);
  }
  Serial.print(F("  min="));
  Serial.print(lo);
  Serial.print(F("  max="));
  Serial.print(hi);
  Serial.print(F("  span="));
  Serial.println(hi - lo);
  Serial.println(hi - lo > 50
                 ? F("  PASS: cover/uncover it, span should be big")
                 : F("  WARN: span small, check wiring / threshold"));
  return (hi - lo) > 50;
}

// A6 自检：如实报告这块硬件的已知问题
static bool testFillLight() {
  Serial.println(F("--- A6 fill light self-check ---"));
  int v = analogRead(PIN_LIGHT_FILL);
  Serial.print(F("  analogRead(A6) = "));
  Serial.println(v);
  Serial.println(F("  NOTE: A6/A7 on Nano are ANALOG-INPUT-ONLY."));
  Serial.println(F("        A6 CANNOT drive the fill light. This is a hardware issue."));
  Serial.println(F("        If the light is always on, it is wired straight to VIN."));
  return true;
}

// ================================================================ ESP-01
static bool espAt(uint32_t baud) {
  esp.begin(baud);
  delay(200);
  while (esp.available()) esp.read();

  esp.print(F("AT\r\n"));

  String resp;
  unsigned long t0 = millis();
  while (millis() - t0 < 1500) {
    while (esp.available()) resp += (char)esp.read();
  }
  Serial.print(F("  @"));
  Serial.print(baud);
  Serial.print(F("  got: ["));
  Serial.print(resp);
  Serial.println(F("]"));
  return resp.indexOf(F("OK")) >= 0;
}

static bool testWifi() {
  Serial.println(F("--- [w] ESP-01 WiFi ---"));
  Serial.println(F("  sending AT, trying 115200 then 9600 ..."));

  bool ok = espAt(115200);
  if (!ok) ok = espAt(9600);

  if (ok) {
    Serial.println(F("  PASS: ESP-01 answers AT"));
    Serial.println(F("  next: AT+CWMODE=1 / AT+CWJAP=... (do it from the PC lab)"));
  } else {
    Serial.println(F("  FAIL: no OK from ESP-01"));
    Serial.println(F("  most likely causes, in order:"));
    Serial.println(F("    1) ESP-01 powered from Nano 3V3 (~50mA) -> browns out. Needs its own 3.3V LDO."));
    Serial.println(F("    2) TX/RX swapped (D10 -> divider -> ESP RX, D12 <- ESP TX)"));
    Serial.println(F("    3) baud mismatch (try 74880 / 57600)"));
  }
  return ok;
}

// ================================================================ 全自动
static void selftestAll() {
  Serial.println();
  Serial.println(F("========== FULL SELF TEST =========="));

  testBuzzer();
  testBootChime();
  testDisplay();
  testRelays();
  testMotor();
  testLight();
  testFillLight();
  testButtons();
  testWifi();

  Serial.println(F("========== DONE =========="));
  Serial.println(F("any FAIL above -> fix that one before wiring the I2C bus"));
  tmShow("done");
}

// ================================================================ 帮助
static void help() {
  Serial.println(F("--------------------------------------------------"));
  Serial.println(F("  a        full self test (all below, in order)"));
  Serial.println(F("  2        buzzer one beep"));
  Serial.println(F("  3        boot chime (three beeps)"));
  Serial.println(F("  4        display 0..4 / 8888 / AbCd"));
  Serial.println(F("  5        buttons, watch 10s"));
  Serial.println(F("  6        toggle FAN relay"));
  Serial.println(F("  7        toggle LAMP relay"));
  Serial.println(F("  8        motor forward/reverse/ramp/stop"));
  Serial.println(F("  9        photoresistor A7, watch 3s"));
  Serial.println(F("  w        ESP-01 WiFi (AT test)"));
  Serial.println(F("  ?        this help"));
  Serial.println(F("--------------------------------------------------"));
}

// ================================================================ setup
void setup() {
  Serial.begin(115200);
  while (!Serial) { ; }

  pinMode(PIN_BUZZER,      OUTPUT);
  pinMode(PIN_RELAY_FAN,   OUTPUT);
  pinMode(PIN_RELAY_LAMP,  OUTPUT);
  pinMode(PIN_LED_STATUS,  OUTPUT);
  pinMode(PIN_BTN1, INPUT_PULLUP);
  pinMode(PIN_BTN2, INPUT_PULLUP);
  pinMode(PIN_MOTOR_ENA, OUTPUT);
  pinMode(PIN_MOTOR_IN1, OUTPUT);
  pinMode(PIN_MOTOR_IN2, OUTPUT);

  digitalWrite(PIN_BUZZER,     LOW);
  digitalWrite(PIN_RELAY_FAN,  RELAY_OFF);
  digitalWrite(PIN_RELAY_LAMP, RELAY_OFF);
  digitalWrite(PIN_MOTOR_ENA,  0);

  tmInit();
  tmShow("boot");

  Serial.println();
  Serial.println(F("=============================================="));
  Serial.println(F("  S-LAN V4.3   FEED board self test"));
  Serial.println(F("  relay=FAN/LAMP  btn=D3/D6  buzzer=D11"));
  Serial.println(F("  motor=D7/D8/D9  ESP=D10/D12  light=A7"));
  Serial.println(F("=============================================="));

  bootChime();
  help();
}

// ================================================================ loop
void loop() {
  if (!Serial.available()) return;

  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.length() == 0) return;

  char c = line[0];

  switch (c) {
    case 'a': case 'A': selftestAll(); break;
    case '2':           testBuzzer();  break;
    case '3':           testBootChime(); break;
    case '4':           testDisplay(); break;
    case '5':           testButtons(); break;
    case '6':           setRelay(PIN_RELAY_FAN,  !g_relayFan,  g_relayFan,  "relay FAN ");  break;
    case '7':           setRelay(PIN_RELAY_LAMP, !g_relayLamp, g_relayLamp, "relay LAMP"); break;
    case '8':           testMotor();   break;
    case '9':           testLight();   break;
    case 'w': case 'W': testWifi();    break;
    case '?':           help();        break;
    default:
      Serial.print(F("unknown '"));
      Serial.print(line);
      Serial.println(F("'   type ? for help"));
  }
}
