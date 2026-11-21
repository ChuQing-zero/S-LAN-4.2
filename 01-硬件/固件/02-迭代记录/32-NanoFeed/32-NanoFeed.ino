/*
 * ============================================================================
 *  S-LAN V5.0  ·  进料主控（Nano / FEED）  文件编号 32-FEED
 * ============================================================================
 *
 *  三层架构的中间层：
 *
 *      PC ──(USB 串口 115200, JSON 行)──> Nano ──(I²C)──> IDEN + UNIT×4
 *
 *  职责：
 *    · 进料电机（调速 + 方向）
 *    · 光敏检测（进料口有没有卡）
 *    · 两个按钮（启动/暂停、清计数）
 *    · TM1637 数码管（已送张数 / 故障码）
 *    · 蜂鸣器
 *    · 继电器（风扇、补光灯）
 *    · I²C 主站：扫描、下发、轮询、上报
 *
 *  接线（按 FEED 板网表）：
 *      D3  按钮1         D6  按钮2
 *      D4  TM1637 CLK    D5  TM1637 DIO
 *      D7  电机 ENA      D8  电机 IN1     D9  电机 IN2
 *      D11 蜂鸣器        A0  状态灯
 *      A1  继电器-风扇   A2  继电器-补光灯
 *      A7  光敏          A4  SDA    A5  SCL
 *
 *  串口 115200，行结尾 Newline
 * ============================================================================
 */

#include <Wire.h>

/* ---------------------------------------------------------------- 配置 */
#define PIN_BTN1     3
#define PIN_BTN2     6
#define PIN_TM_CLK   4
#define PIN_TM_DIO   5
#define PIN_MOT_ENA  7
#define PIN_MOT_IN1  8
#define PIN_MOT_IN2  9
#define PIN_BUZZ     11
#define PIN_LED      A0
#define PIN_FAN      A1
#define PIN_LAMP     A2
#define PIN_LDR      A7

#define UNIT_FIRST   0x10
#define UNIT_LAST    0x23
#define IDEN_ADDR    0x10

#define CARD_ADC_ON    600    /* 光敏低于此值 = 有卡（按实测调） */
#define CARD_BLOCK_MS  150    /* 持续这么久才算有卡 */

/* ---------------------------------------------------------------- 状态 */
static uint16_t g_feed_cnt = 0;
static uint8_t  g_motor_on = 0;
static uint8_t  g_motor_dir = 1;
static uint8_t  g_fault = 0;      /* 0无 1卡纸 2光敏异常 3I2C掉线 */
static uint8_t  g_running = 0;
static uint8_t  g_btn1_last = 1;
static uint8_t  g_btn2_last = 1;
static unsigned long g_t_ldr = 0;
static unsigned long g_t_7seg = 0;
static unsigned long g_t_msg = 0;
static uint16_t g_card_ms = 0;
static uint8_t  g_card = 0;
static uint8_t  g_online_mask = 0;   /* bit0=0x10, bit1=0x20 ... 由扫描更新 */

/* ---------------------------------------------------------------- TM1637 */
static const uint8_t DIGIT[10] = {
  0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F
};
static const uint8_t CHAR_E = 0x79;
static const uint8_t CHAR_R = 0x50;

static void tm_delay(void) { delayMicroseconds(5); }

static void tm_start(void) {
  pinMode(PIN_TM_DIO, OUTPUT);
  digitalWrite(PIN_TM_DIO, HIGH);
  digitalWrite(PIN_TM_CLK, HIGH);
  tm_delay();
  digitalWrite(PIN_TM_DIO, LOW);
  tm_delay();
  digitalWrite(PIN_TM_CLK, LOW);
  tm_delay();
}

static void tm_stop(void) {
  pinMode(PIN_TM_DIO, OUTPUT);
  digitalWrite(PIN_TM_CLK, LOW);
  tm_delay();
  digitalWrite(PIN_TM_DIO, LOW);
  tm_delay();
  digitalWrite(PIN_TM_CLK, HIGH);
  tm_delay();
  digitalWrite(PIN_TM_DIO, HIGH);
  tm_delay();
}

static bool tm_write_byte(uint8_t b) {
  uint8_t i;
  for (i = 0; i < 8; i++) {
    digitalWrite(PIN_TM_CLK, LOW);
    tm_delay();
    digitalWrite(PIN_TM_DIO, (b & 0x01) ? HIGH : LOW);
    tm_delay();
    digitalWrite(PIN_TM_CLK, HIGH);
    tm_delay();
    b >>= 1;
  }
  pinMode(PIN_TM_DIO, INPUT_PULLUP);
  digitalWrite(PIN_TM_CLK, LOW);
  tm_delay();
  digitalWrite(PIN_TM_CLK, HIGH);
  tm_delay();
  bool ack = (digitalRead(PIN_TM_DIO) == LOW);
  pinMode(PIN_TM_DIO, OUTPUT);
  digitalWrite(PIN_TM_CLK, LOW);
  tm_delay();
  return ack;
}

static void tm_show_raw(uint8_t d0, uint8_t d1, uint8_t d2, uint8_t d3) {
  tm_start(); tm_write_byte(0x40); tm_stop();       /* 自动地址 */
  tm_start(); tm_write_byte(0xC0);                  /* 从第 0 位 */
  tm_write_byte(d0); tm_write_byte(d1);
  tm_write_byte(d2); tm_write_byte(d3);
  tm_stop();
  tm_start(); tm_write_byte(0x8F); tm_stop();       /* 亮度 8，开显示 */
}

static void tm_clear(void) { tm_show_raw(0, 0, 0, 0); }

/* 显示 4 位数字，或故障码 E1/E2/E3 */
static void tm_show_status(uint8_t blink_off) {
  if (blink_off) { tm_clear(); return; }

  if (g_fault) {
    tm_show_raw(CHAR_E, DIGIT[g_fault] , 0, 0);
    return;
  }

  uint16_t v = g_feed_cnt % 10000;
  tm_show_raw(DIGIT[(v / 1000) % 10],
              DIGIT[(v / 100) % 10],
              DIGIT[(v / 10) % 10],
              DIGIT[v % 10]);
}

/* ---------------------------------------------------------------- 电机 */
static void motor_init(void) {
  pinMode(PIN_MOT_ENA, OUTPUT);
  pinMode(PIN_MOT_IN1, OUTPUT);
  pinMode(PIN_MOT_IN2, OUTPUT);
  digitalWrite(PIN_MOT_ENA, LOW);
  digitalWrite(PIN_MOT_IN1, LOW);
  digitalWrite(PIN_MOT_IN2, LOW);
}

static void motor_set(uint8_t dir, uint8_t pwm) {
  if (dir) {
    digitalWrite(PIN_MOT_IN1, HIGH);
    digitalWrite(PIN_MOT_IN2, LOW);
  } else {
    digitalWrite(PIN_MOT_IN1, LOW);
    digitalWrite(PIN_MOT_IN2, HIGH);
  }
  analogWrite(PIN_MOT_ENA, pwm);
}

static void motor_stop(void) {
  analogWrite(PIN_MOT_ENA, 0);
  digitalWrite(PIN_MOT_IN1, LOW);
  digitalWrite(PIN_MOT_IN2, LOW);
}

/* ---------------------------------------------------------------- I²C */
static bool i2c_alive(uint8_t a) {
  Wire.beginTransmission(a);
  return Wire.endTransmission() == 0;
}

static bool i2c_wr(uint8_t a, uint8_t reg, uint8_t v) {
  Wire.beginTransmission(a);
  Wire.write(reg);
  Wire.write(v);
  return Wire.endTransmission() == 0;
}

static int i2c_rd(uint8_t a, uint8_t reg, uint8_t *out) {
  Wire.beginTransmission(a);
  Wire.write(0xFE);
  Wire.write(reg);
  if (Wire.endTransmission() != 0) return -1;
  if (Wire.requestFrom(a, (uint8_t)1) != 1) return -2;
  *out = Wire.read();
  return 0;
}

/* ---------------------------------------------------------------- 上报 */
static void send_msg(const char *key, const char *val) {
  Serial.print(F("{\"ev\":\""));
  Serial.print(key);
  if (val && val[0]) {
    Serial.print(F("\",\"v\":\""));
    Serial.print(val);
  }
  Serial.println(F("\"}"));
}

static void send_status(uint8_t addr) {
  uint8_t st = 0, lim = 0, card = 0, phase = 0;
  if (i2c_rd(addr, 0x02, &st) != 0) return;
  i2c_rd(addr, 0x22, &lim);
  i2c_rd(addr, 0x23, &card);
  i2c_rd(addr, 0x26, &phase);

  Serial.print(F("{\"ev\":\"UNIT\",\"addr\":\"0x"));
  if (addr < 0x10) Serial.print('0');
  Serial.print(addr, HEX);
  Serial.print(F("\",\"st\":"));
  Serial.print(st);
  Serial.print(F(",\"lim\":"));
  Serial.print(lim);
  Serial.print(F(",\"card\":"));
  Serial.print(card);
  Serial.print(F(",\"phase\":"));
  Serial.print(phase);
  Serial.println(F("}"));
}

/* ---------------------------------------------------------------- 命令处理 */
static void handle_json(char *line) {
  /* 极简 JSON 解析：靠 strstr 找关键字，够用 */
  int id = -1;
  char *p = strstr(line, "\"id\":");
  if (p) id = atoi(p + 5);

  if (strstr(line, "\"cmd\":\"FEED\"")) {
    g_running = 1;
    g_motor_dir = 1;
    motor_set(g_motor_dir, 180);
    g_motor_on = 1;
    Serial.print(F("{\"ev\":\"FEED_START\",\"id\":"));
    Serial.print(id);
    Serial.println(F("}"));
    return;
  }

  if (strstr(line, "\"cmd\":\"FEED_STOP\"")) {
    g_running = 0;
    g_motor_on = 0;
    motor_stop();
    send_msg("FEED_STOP", "");
    return;
  }

  if (strstr(line, "\"cmd\":\"PORTS\"")) {
    /* 简化版：拿到 port 和 side，转发给对应地址 */
    int port = 0;
    char side = 'L';
    p = strstr(line, "\"port\":");
    if (p) port = atoi(p + 7);
    p = strstr(line, "\"side\":\"");
    if (p) side = p[8];

    uint8_t addr = (uint8_t)(0x20 + ((port > 0) ? (port - 1) : 0));
    uint8_t cmd = (side == 'L') ? 0x11 : 0x10;   /* L=左  R=右 */
    bool ok = i2c_wr(addr, 0x00, cmd);

    Serial.print(F("{\"ev\":\"SORT\",\"addr\":\"0x"));
    Serial.print(addr, HEX);
    Serial.print(F("\",\"ok\":"));
    Serial.print(ok ? 1 : 0);
    Serial.println(F("}"));
    return;
  }

  if (strstr(line, "\"cmd\":\"QUERY\"")) {
    send_status(IDEN_ADDR);
    for (uint8_t a = 0x20; a <= 0x23; a++) send_status(a);
    return;
  }

  if (strstr(line, "\"cmd\":\"LAMP\"")) {
    digitalWrite(PIN_FAN,  strstr(line, "\"fan\":true")  ? HIGH : LOW);
    digitalWrite(PIN_LAMP, strstr(line, "\"lamp\":true") ? HIGH : LOW);
    send_msg("LAMP_OK", "");
    return;
  }

  if (strstr(line, "\"cmd\":\"RESET\"")) {
    for (uint8_t a = 0x10; a <= 0x23; a++) {
      if (i2c_alive(a)) i2c_wr(a, 0x00, 0x01);
    }
    g_feed_cnt = 0;
    g_fault = 0;
    g_running = 0;
    motor_stop();
    send_msg("RESET_OK", "");
    return;
  }

  send_msg("UNKNOWN_CMD", line);
}

/* ---------------------------------------------------------------- setup */

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
  i2cBusRecover();      /* 先恢复总线，再启动 Wire */
  Wire.begin();
  Wire.setClock(100000);

  pinMode(PIN_BTN1, INPUT_PULLUP);
  pinMode(PIN_BTN2, INPUT_PULLUP);
  pinMode(PIN_BUZZ, OUTPUT);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_FAN, OUTPUT);
  pinMode(PIN_LAMP, OUTPUT);
  digitalWrite(PIN_FAN, LOW);
  digitalWrite(PIN_LAMP, LOW);
  pinMode(PIN_TM_CLK, OUTPUT);
  pinMode(PIN_TM_DIO, OUTPUT);
  digitalWrite(PIN_TM_CLK, HIGH);
  digitalWrite(PIN_TM_DIO, HIGH);

  motor_init();
  tm_clear();

  /* 开机提示 */
  digitalWrite(PIN_BUZZ, HIGH); delay(80); digitalWrite(PIN_BUZZ, LOW);
  tm_show_raw(CHAR_E, CHAR_R, 0, 0);   /* "Er" 自检 */
  delay(400);

  Serial.println(F("{\"ev\":\"BOOT\",\"fw\":\"V5.0-FEED-32\"}"));
}

/* ---------------------------------------------------------------- loop */
static char g_line[160];
static size_t g_len = 0;

void loop() {
  unsigned long now = millis();

  /* ---- 串口收命令 ---- */
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      g_line[g_len] = 0;
      if (g_len > 0) handle_json(g_line);
      g_len = 0;
    } else if (g_len < sizeof(g_line) - 1) {
      g_line[g_len++] = c;
    }
  }

  /* ---- 光敏 ----- */
  if (now - g_t_ldr >= 20) {
    g_t_ldr = now;
    int adc = analogRead(PIN_LDR);
    if (adc < CARD_ADC_ON) {
      if (g_card_ms < 60000) g_card_ms++;
    } else {
      g_card_ms = 0;
      g_card = 0;
    }
    if ((g_card_ms * 20) >= CARD_BLOCK_MS && !g_card) {
      g_card = 1;
      Serial.print(F("{\"ev\":\"CARD_AT_FEED\",\"adc\":"));
      Serial.print(adc);
      Serial.println(F("}"));
      /* 卡到了就停进料电机，等 PC 发下一步 */
      if (g_running) {
        g_running = 0;
        g_motor_on = 0;
        motor_stop();
        g_feed_cnt++;
        send_msg("FEED_DONE", "");
      }
    }
  }

  /* ---- 按钮 ---- */
  uint8_t b1 = digitalRead(PIN_BTN1);
  uint8_t b2 = digitalRead(PIN_BTN2);

  if (b1 == LOW && g_btn1_last == HIGH) {
    digitalWrite(PIN_BUZZ, HIGH); delay(40); digitalWrite(PIN_BUZZ, LOW);
    g_running = !g_running;
    if (g_running) {
      g_motor_dir = 1;
      motor_set(g_motor_dir, 180);
      g_motor_on = 1;
    } else {
      g_motor_on = 0;
      motor_stop();
    }
    send_msg(g_running ? "BTN_START" : "BTN_STOP", "");
  }
  g_btn1_last = b1;

  if (b2 == LOW && g_btn2_last == HIGH) {
    digitalWrite(PIN_BUZZ, HIGH); delay(40); digitalWrite(PIN_BUZZ, LOW);
    g_feed_cnt = 0;
    send_msg("BTN_CLR", "");
  }
  g_btn2_last = b2;

  /* ---- 数码管 ---- */
  if (now - g_t_7seg >= 250) {
    g_t_7seg = now;
    uint8_t blink_off = g_fault && ((now / 250) % 2 == 0);
    tm_show_status(blink_off);
    /* 状态灯：运行=常亮；空闲=1Hz 通断闪烁（不用 PWM，不呼吸） */
    digitalWrite(PIN_LED, g_running ? HIGH : LOW);   /* 运行常亮 / 空闲常灭，不闪 */
  }

  /* ---- 每 2 秒扫一次总线，掉线要报 ---- */
  if (now - g_t_msg >= 2000) {
    g_t_msg = now;
    uint8_t mask = 0;
    uint8_t n = 0;
    for (uint8_t a = UNIT_FIRST; a <= UNIT_LAST; a++) {
      if (i2c_alive(a)) {
        mask |= (1U << (a - UNIT_FIRST));
        n++;
      }
    }
    if (mask != g_online_mask) {
      g_online_mask = mask;
      Serial.print(F("{\"ev\":\"SCAN\",\"count\":"));
      Serial.print(n);
      Serial.println(F("}"));
    }
    if (n == 0) g_fault = 3; else if (g_fault == 3) g_fault = 0;
  }
}
