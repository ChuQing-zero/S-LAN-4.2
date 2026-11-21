/*
 * ============================================================================
 *  TM1637 数码管 单独测试
 * ============================================================================
 *  只干一件事：把 1234 显示出来，不断刷。
 *  用来快速定位"是引脚顺序不对，还是别的"。
 *
 *  板子：Arduino Nano / ATmega168
 *  串口：115200（只是打印状态，不接也能跑）
 *
 *  ┌────────────────────────────────────────────────────┐
 *  │ 如果屏幕全黑：把下面的 SWAP 从 0 改成 1，重烧。      │
 *  │ 还黑：把 1 改成 0 再试一次，或者看下面"还黑怎么办"。│
 *  └────────────────────────────────────────────────────┘
 * ============================================================================
 */

#define SWAP   0        // 0: CLK=D4 DIO=D5    1: CLK=D5 DIO=D4

#if SWAP == 0
  #define PIN_CLK   4
  #define PIN_DIO   5
#else
  #define PIN_CLK   5
  #define PIN_DIO   4
#endif

#define BRIGHTNESS 7    // 0~7

// 7 段码（共阴）：0-9 A-F 空格 减号
static const uint8_t SEG[] = {
  0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07,
  0x7F, 0x6F, 0x77, 0x7C, 0x39, 0x5E, 0x79, 0x71
};

// ---------------------------------------------------------------- 底层
static void tmStart() {
  digitalWrite(PIN_CLK, HIGH);
  digitalWrite(PIN_DIO, HIGH);
  delayMicroseconds(5);
  digitalWrite(PIN_DIO, LOW);
  delayMicroseconds(5);
}

static void tmStop() {
  digitalWrite(PIN_CLK, LOW);
  delayMicroseconds(5);
  digitalWrite(PIN_DIO, LOW);
  delayMicroseconds(5);
  digitalWrite(PIN_CLK, HIGH);
  delayMicroseconds(5);
  digitalWrite(PIN_DIO, HIGH);
  delayMicroseconds(5);
}

static void tmByte(uint8_t b) {
  for (uint8_t i = 0; i < 8; i++) {
    digitalWrite(PIN_CLK, LOW);
    delayMicroseconds(2);
    digitalWrite(PIN_DIO, (b & 0x01) ? HIGH : LOW);
    b >>= 1;
    delayMicroseconds(2);
    digitalWrite(PIN_CLK, HIGH);
    delayMicroseconds(2);
  }
  // 第 9 个时钟：读 ACK
  digitalWrite(PIN_CLK, LOW);
  pinMode(PIN_DIO, INPUT);
  delayMicroseconds(4);
  digitalWrite(PIN_CLK, HIGH);
  delayMicroseconds(4);
  pinMode(PIN_DIO, OUTPUT);
}

static uint8_t segOf(char c) {
  if (c >= '0' && c <= '9') return SEG[c - '0'];
  if (c >= 'A' && c <= 'F') return SEG[c - 'A' + 10];
  if (c >= 'a' && c <= 'f') return SEG[c - 'a' + 10];
  if (c == '-') return 0x40;
  return 0x00;
}

// 显示 4 个字符，右对齐
static void tmShow(const char *s) {
  char buf[4] = { ' ', ' ', ' ', ' ' };
  int len = strlen(s);
  if (len > 4) { s += (len - 4); len = 4; }
  for (int i = 0; i < len; i++) buf[4 - len + i] = s[i];

  // 写显示寄存器（自动地址 0x40）
  tmStart(); tmByte(0x40); tmStop();

  // 从地址 0 开始写 4 个字节
  tmStart(); tmByte(0xC0 | 0x00);
  for (int i = 0; i < 4; i++) tmByte(segOf(buf[i]));
  tmStop();

  // 开显示 + 亮度（0x88 | 亮度）
  tmStart(); tmByte(0x88 | (BRIGHTNESS & 0x07)); tmStop();
}

// ---------------------------------------------------------------- setup
void setup() {
  Serial.begin(115200);
  while (!Serial) { ; }

  Serial.println();
  Serial.println(F("=== TM1637 display test ==="));
  Serial.print(F("CLK = D"));
  Serial.println(PIN_CLK);
  Serial.print(F("DIO = D"));
  Serial.println(PIN_DIO);
  Serial.print(F("SWAP = "));
  Serial.println(SWAP);
  Serial.println(F("showing 1234 in a loop, watch the display"));
  Serial.println(F("BLACK? change SWAP to 1 and re-upload."));

  pinMode(PIN_CLK, OUTPUT);
  pinMode(PIN_DIO, OUTPUT);
  digitalWrite(PIN_CLK, HIGH);
  digitalWrite(PIN_DIO, HIGH);
}

// ---------------------------------------------------------------- loop
void loop() {
  static uint8_t step = 0;

  switch (step) {
    case 0:
      tmShow("1234");
      Serial.println(F("show 1234"));
      break;
    case 1:
      tmShow("8888");
      Serial.println(F("show 8888"));
      break;
    case 2:
      tmShow("AbCd");
      Serial.println(F("show AbCd"));
      break;
    case 3:
      tmShow("    ");
      Serial.println(F("blank"));
      break;
  }

  step = (step + 1) & 0x03;
  delay(1200);
}
