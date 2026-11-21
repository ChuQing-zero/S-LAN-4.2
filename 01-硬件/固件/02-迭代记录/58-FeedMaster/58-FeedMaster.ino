/* ============================================================================
 *  58 · S-LAN 主控 Nano 固件  V6.0
 * ============================================================================
 *  硬件：进料板 Nano（ATmega328P）
 *  角色：I2C 主站，控制识别单元 0x10 + 分拣单元 0x20~0x23 + 自身进料外设
 *  串口：115200 8N1（PC <-> Nano），协议见 通信协议.md
 *
 *  ⚠ 本期不使用 ESP-01，D10 / D12 空出（D10 是 PWM 脚，可留给补光灯）
 * ========================================================================== */

#include <Wire.h>
#include <avr/wdt.h>

/* ============================ 引脚定义 ============================ */
#define PIN_BTN1        3
#define PIN_BTN2        6
#define PIN_TM_CLK      4
#define PIN_TM_DIO      5
#define PIN_MOTOR_ENA   7
#define PIN_MOTOR_IN1   8
#define PIN_MOTOR_IN2   9
#define PIN_BUZZER      11
#define PIN_LED_STATUS  A0
#define PIN_RELAY_FAN   A1
#define PIN_RELAY_LAMP  A2
#define PIN_LDR         A7

#define RELAY_ON   HIGH
#define RELAY_OFF  LOW

/* ============================ 单元地址 ============================ */
#define ADDR_IDENT   0x10
#define ADDR_SORT0   0x20
#define ADDR_SORT1   0x21
#define ADDR_SORT2   0x22
#define ADDR_SORT3   0x23

/* ============================ 寄存器（V5 统一表） ============================ */
#define R_CMD        0x00
#define R_ARG        0x01
#define R_STATUS     0x02
#define R_ERR        0x03
#define R_HB         0x04
#define R_FW         0x05
#define R_PTR        0xFE

/* 分拣单元读回 */
#define U_LIMIT      0x22
#define U_CARD       0x23
#define U_LIFT_CNT   0x25
#define U_PHASE      0x26

/* 识别单元读回 */
#define I_RES_TYPE   0x23
#define I_RES_LEN    0x24
#define I_MSTATE     0x25
#define I_ERR        0x26
#define I_BELT_STATE 0x27
#define I_GATE_DEG   0x28
#define I_RES_BUF    0x40
#define I_QR_LEN     0x2C
#define I_NFC_LEN    0x2D
#define I_QR_BUF     0x60
#define I_NFC_BUF    0x80

/* ============================ 版本 ============================ */
#define FW_TAG   "V6.0-MASTER"

/* ============================ 状态变量 ============================ */
static uint32_t g_ms = 0;
static uint32_t g_lastPcRx = 0;
static uint8_t  g_hostOnline = 0;
static uint16_t g_feedCount = 0;
static uint16_t g_ldrBase = 0;
static uint8_t  g_pwm = 200;
static uint8_t  g_relayFan = 0;
static uint8_t  g_relayLamp = 0;

/* ============================ TM1637 ============================ */
static const uint8_t SEG[10] = {0x3F,0x06,0x5B,0x4F,0x66,0x6D,0x7D,0x07,0x7F,0x6F};

static void tm_start(void){digitalWrite(PIN_TM_DIO,HIGH);digitalWrite(PIN_TM_CLK,HIGH);delayMicroseconds(2);digitalWrite(PIN_TM_DIO,LOW);delayMicroseconds(2);}
static void tm_stop(void){digitalWrite(PIN_TM_CLK,LOW);delayMicroseconds(2);digitalWrite(PIN_TM_DIO,LOW);delayMicroseconds(2);digitalWrite(PIN_TM_CLK,HIGH);delayMicroseconds(2);digitalWrite(PIN_TM_DIO,HIGH);delayMicroseconds(2);}
static void tm_byte(uint8_t b){uint8_t i;for(i=0;i<8;i++){digitalWrite(PIN_TM_CLK,LOW);delayMicroseconds(2);digitalWrite(PIN_TM_DIO,(b&1)?HIGH:LOW);delayMicroseconds(2);digitalWrite(PIN_TM_CLK,HIGH);delayMicroseconds(2);b>>=1;}digitalWrite(PIN_TM_CLK,LOW);delayMicroseconds(2);digitalWrite(PIN_TM_CLK,HIGH);delayMicroseconds(2);}

static void tm_show(uint16_t v)
{
  uint8_t d[4], i;
  if (v > 9999U) { d[0]=d[1]=d[2]=d[3]=0x40; }
  else { d[0]=SEG[(v/1000U)%10U]; d[1]=SEG[(v/100U)%10U]; d[2]=SEG[(v/10U)%10U]; d[3]=SEG[v%10U]; }
  tm_start(); tm_byte(0x40); tm_stop();
  tm_start(); tm_byte(0xC0); for(i=0;i<4;i++) tm_byte(d[i]); tm_stop();
  tm_start(); tm_byte(0x8F); tm_stop();
}

/* 显示 4 个字符（数字或字母），不足补空格 */
static void tm_show_text(const char *t)
{
  uint8_t d[4], i;
  for (i = 0; i < 4; i++)
  {
    char c = t[i];
    if (c >= '0' && c <= '9') d[i] = SEG[c - '0'];
    else if (c == '-') d[i] = 0x40;
    else if (c == ' ') d[i] = 0x00;
    else if (c == '\0') d[i] = 0x00;
    else d[i] = 0x00;                       /* 其它字符不显示 */
  }
  tm_start(); tm_byte(0x40); tm_stop();
  tm_start(); tm_byte(0xC0); for(i=0;i<4;i++) tm_byte(d[i]); tm_stop();
  tm_start(); tm_byte(0x8F); tm_stop();
}

/* ============================ 电机 ============================ */
static void motor(uint8_t on, uint8_t dir, uint8_t pwm)
{
  if (!on) { analogWrite(PIN_MOTOR_ENA, 0); digitalWrite(PIN_MOTOR_IN1, LOW); digitalWrite(PIN_MOTOR_IN2, LOW); return; }
  analogWrite(PIN_MOTOR_ENA, pwm);
  if (dir) { digitalWrite(PIN_MOTOR_IN1, HIGH); digitalWrite(PIN_MOTOR_IN2, LOW); }
  else     { digitalWrite(PIN_MOTOR_IN1, LOW);  digitalWrite(PIN_MOTOR_IN2, HIGH); }
}

/* ============================ 蜂鸣器 ============================ */
static void beep(uint16_t freq, uint16_t ms, uint8_t times)
{
  uint8_t i;
  if (times == 0) times = 1;
  for (i = 0; i < times; i++)
  {
    if (freq < 50) freq = 50;
    tone(PIN_BUZZER, freq, ms);
    delay(ms + 40);
  }
  noTone(PIN_BUZZER);
}

/* ============================ 串口输出 ============================ */
static void pc_print(const char *s) { Serial.print(s); }

static void pc_line(const char *tag, const char *body)
{
  Serial.print('[');
  Serial.print(tag);
  Serial.print(F("] "));
  Serial.println(body);
}

/* ============================ I2C 底层 ============================ */
static void i2c_recover(void)
{
  uint8_t i;
  pinMode(A4, OUTPUT); pinMode(A5, OUTPUT);
  digitalWrite(A4, HIGH); digitalWrite(A5, HIGH);
  delay(5);
  digitalWrite(A4, LOW);  delay(500);
  digitalWrite(A4, HIGH); delay(5);
  for (i = 0; i < 9; i++) { digitalWrite(A5, LOW); delayMicroseconds(20); digitalWrite(A5, HIGH); delayMicroseconds(20); }
  digitalWrite(A4, LOW);  delayMicroseconds(20);
  digitalWrite(A5, HIGH); delayMicroseconds(20);
  digitalWrite(A4, HIGH); delayMicroseconds(20);
  pinMode(A4, INPUT); pinMode(A5, INPUT);
  delay(5);
}

/* 开机 I2C 扫描：逐地址探测，打印哪个单元在线 */
static void i2c_scan_report(void)
{
  uint8_t addrs[5] = { ADDR_IDENT, ADDR_SORT0, ADDR_SORT1, ADDR_SORT2, ADDR_SORT3 };
  const char *names[5] = { "0x10 IDENT", "0x20 SORT", "0x21 SORT", "0x22 SORT", "0x23 SORT" };
  uint8_t i, ok = 0, v;

  Serial.println(F("[I2C] scanning bus ..."));
  for (i = 0; i < 5; i++)
  {
    Serial.print(F("[I2C] "));
    Serial.print(names[i]);
    Serial.print(F(" ... "));
    if (i2c_read(addrs[i], R_STATUS, &v))
    {
      Serial.print(F("OK  STATUS=0x"));
      Serial.print(v, HEX);
      Serial.print(F("  FW=0x"));
      if (i2c_read(addrs[i], R_FW, &v)) Serial.println(v, HEX);
      else Serial.println(F("?"));
      ok++;
    }
    else
    {
      Serial.println(F("NOT FOUND"));
    }
    delay(5);
  }
  Serial.print(F("[I2C] total "));
  Serial.print(ok);
  Serial.println(F(" / 5 unit(s) online"));
}

/* 向从机写： [reg][val] */
static uint8_t i2c_write(uint8_t addr, uint8_t reg, uint8_t val)
{
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(val);
  return (Wire.endTransmission() == 0) ? 1U : 0U;
}

/* 从从机读一个寄存器： 先写 PTR，再读 1 字节 */
static uint8_t i2c_read(uint8_t addr, uint8_t reg, uint8_t *out)
{
  Wire.beginTransmission(addr);
  Wire.write(R_PTR);
  Wire.write(reg);
  if (Wire.endTransmission() != 0) return 0U;

  Wire.requestFrom(addr, (uint8_t)1);
  if (Wire.available() < 1) return 0U;
  *out = (uint8_t)Wire.read();
  return 1U;
}

/* 发命令 */
static uint8_t cmd(uint8_t addr, uint8_t c, uint8_t arg)
{
  if (!i2c_write(addr, R_ARG, arg)) return 0U;
  return i2c_write(addr, R_CMD, c);
}

/* ============================ 地址解析 ============================ */
static uint8_t parse_addr(const char *s)
{
  if (s == NULL) return 0;
  while (*s == ' ') s++;
  if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X'))
    return (uint8_t)strtol(s + 2, NULL, 16);
  return (uint8_t)strtol(s, NULL, 10);
}

static uint8_t addr_is_sort(uint8_t a) { return (a >= 0x20 && a <= 0x23) ? 1U : 0U; }
static uint8_t addr_is_ident(uint8_t a) { return (a == ADDR_IDENT) ? 1U : 0U; }

/* ============================ 上报函数 ============================ */
static void report_status(void)
{
  uint8_t v, i;
  uint8_t addrs[5] = { ADDR_IDENT, ADDR_SORT0, ADDR_SORT1, ADDR_SORT2, ADDR_SORT3 };
  const char *names[5] = { "0x10", "0x20", "0x21", "0x22", "0x23" };

  Serial.print(F("[状态] "));
  for (i = 0; i < 5; i++)
  {
    if (i) Serial.print(',');
    Serial.print(names[i]);
    Serial.print('=');
    if (i2c_read(addrs[i], R_STATUS, &v)) Serial.print(v, HEX);
    else Serial.print(F("NA"));
  }
  Serial.println();

  /* 进料状态 */
  Serial.print(F("[进料] 计数="));
  Serial.print(g_feedCount);
  Serial.print(F(",电机="));
  Serial.print(digitalRead(PIN_MOTOR_ENA) ? F("RUN") : F("STOP"));
  Serial.print(F(",主机="));
  Serial.println(g_hostOnline ? F("ON") : F("OFF"));

  /* 单元在线数 */
  {
    uint8_t aa[5] = { ADDR_IDENT, ADDR_SORT0, ADDR_SORT1, ADDR_SORT2, ADDR_SORT3 };
    uint8_t ii, cnt = 0, tmp;
    for (ii = 0; ii < 5; ii++) { if (i2c_read(aa[ii], R_STATUS, &tmp)) cnt++; }
    Serial.print(F("[在线] "));
    Serial.print(cnt);
    Serial.println(F(" / 5 单元"));
  }

  /* 光敏 */
  {
    int raw = analogRead(PIN_LDR);
    uint8_t pct = (g_ldrBase > 0) ? (uint8_t)((uint32_t)raw * 100UL / (uint32_t)g_ldrBase) : 0;
    if (pct > 100) pct = 100;
    Serial.print(F("[光敏] LDR="));
    Serial.print(raw);
    Serial.print(F(",基准="));
    Serial.print(g_ldrBase);
    Serial.print(',');
    Serial.print(pct);
    Serial.println('%');
  }
}

static void report_ident_result(uint8_t ok)
{
  uint8_t type = 0, len = 0, c, i;

  if (!ok) { Serial.println(F("[识别] 0,0,0,-")); return; }

  i2c_read(ADDR_IDENT, I_RES_TYPE, &type);
  i2c_read(ADDR_IDENT, I_RES_LEN, &len);
  if (len > 32) len = 32;

  Serial.print(F("[识别] 1,"));
  if (type == 1U) Serial.print(F("NFC"));
  else if (type == 3U) Serial.print(F("QR"));
  else if (type == 2U) Serial.print(F("QR"));
  else Serial.print(F("RAW"));
  Serial.print(',');
  Serial.print(len);
  Serial.print(',');
  for (i = 0; i < len; i++)
  {
    if (i2c_read(ADDR_IDENT, (uint8_t)(I_RES_BUF + i), &c))
      Serial.print(c, HEX);
    else
      Serial.print(F("??"));
  }
  if (len == 0) Serial.print('-');
  Serial.println();
}

/* 读持久缓冲区：which = 0 QR, 1 NFC */
static void report_persist(uint8_t which)
{
  uint8_t len = 0, c, i, lenReg, bufReg;

  if (which == 0U) { lenReg = I_QR_LEN;  bufReg = I_QR_BUF;  Serial.print(F("[缓冲区] QR,")); }
  else             { lenReg = I_NFC_LEN; bufReg = I_NFC_BUF; Serial.print(F("[缓冲区] NFC,")); }

  i2c_read(ADDR_IDENT, lenReg, &len);
  if (len > 32) len = 32;
  Serial.print(len);
  Serial.print(',');
  for (i = 0; i < len; i++)
  {
    if (i2c_read(ADDR_IDENT, (uint8_t)(bufReg + i), &c)) Serial.print(c, HEX);
  }
  if (len == 0) Serial.print('-');
  Serial.println();
}

static void report_ident_card(void)
{
  uint8_t v;
  Serial.print(F("[有卡] "));
  if (i2c_read(ADDR_IDENT, 0x22, &v)) { Serial.println(v ? F("CARD=1") : F("CARD=0")); }
  else Serial.println(F("I2C-NOACK"));
}

static void report_sort_status(uint8_t addr)
{
  uint8_t lim = 0, card = 0, phase = 0, cnt = 0;
  i2c_read(addr, U_LIMIT, &lim);
  i2c_read(addr, U_CARD, &card);
  i2c_read(addr, U_PHASE, &phase);
  i2c_read(addr, U_LIFT_CNT, &cnt);

  Serial.print(F("[分拣] 0x"));
  Serial.print(addr, HEX);
  Serial.print(F(",限位="));
  Serial.print(lim);
  Serial.print(F(",有卡="));
  Serial.print(card);
  Serial.print(F(",阶段="));
  Serial.print(phase);
  Serial.print(F(",抬升="));
  Serial.println(cnt);
}

/* ============================ 命令处理 ============================ */
static void help_line(void)
{
  Serial.println(F("[帮助] H 握手 | ? 状态 | s/t/c/r/b 进料"));
  Serial.println(F("[帮助] M,dir,speed,ms | O,on|off | B,freq,ms,times | D,text"));
  Serial.println(F("[帮助] Q,ldr | F,on|off | W,on|off"));
  Serial.println(F("[帮助] I/C/N/R,0x10 识别 | Q,0x10,qr|nfc | E,0x10,deg|up|down"));
  Serial.println(F("[帮助] K,0x10,on|off|sec,N|pwm,N|dir,F|R  皮带"));
  Serial.println(F("[帮助] S,0x20,raise|lower|au|ad|bu|bd|stop|hold|arm|disarm"));
  Serial.println(F("[帮助] P,0x20,au|ad|bu|bd|spd,val | T,0x20 | L,0x20,n | A,addr"));
}

/* 分拣单元动作 */
static uint8_t sort_act(uint8_t addr, const char *act)
{
  if (strcmp(act, "raise") == 0)  return cmd(addr, 0x10, 0);
  if (strcmp(act, "hold") == 0)   return cmd(addr, 0x11, 0);
  if (strcmp(act, "lower") == 0)  return cmd(addr, 0x12, 0);
  if (strcmp(act, "au") == 0)     return cmd(addr, 0x13, 0);
  if (strcmp(act, "ad") == 0)     return cmd(addr, 0x14, 0);
  if (strcmp(act, "bu") == 0)     return cmd(addr, 0x15, 0);
  if (strcmp(act, "bd") == 0)     return cmd(addr, 0x16, 0);
  if (strcmp(act, "stop") == 0)   return cmd(addr, 0x17, 0);
  if (strcmp(act, "arm") == 0)    return cmd(addr, 0x60, 1);
  if (strcmp(act, "disarm") == 0) return cmd(addr, 0x60, 0);
  if (strcmp(act, "selftest") == 0) return cmd(addr, 0x30, 0);
  return 0;
}

/* 处理一行命令 */
static void handle_line(char *line)
{
  char *p;
  uint8_t n;

  g_lastPcRx = g_ms;

  /* ---- 单字符 ---- */
  if (line[1] == '\0')
  {
    switch (line[0])
    {
      case 'H':
        Serial.print(F("[握手] NANO-READY "));
        Serial.println(F(FW_TAG));
        g_hostOnline = 1;
        Serial.println(F("[主机] 在线"));
        return;
      case '?': report_status(); return;
      case 's': motor(1, 1, g_pwm); pc_line("进料", "电机=RUN"); return;
      case 't': motor(0, 1, 0);     pc_line("进料", "电机=STOP"); return;
      case 'c':
        motor(1, 1, g_pwm); delay(600); motor(0, 1, 0);
        g_feedCount++;
        { char b[40]; snprintf(b, sizeof(b), "推卡完成,计数=%u", g_feedCount); pc_line("进料", b); }
        tm_show(g_feedCount);
        return;
      case 'r':
        g_feedCount = 0; tm_show(0);
        pc_line("进料", "计数=0");
        return;
      case 'b': beep(1000, 120, 1); pc_line("蜂鸣", "OK"); return;
      case 'h': help_line(); return;
      default: break;
    }
  }

  /* ---- 带参数：首字符大写 + 逗号 ---- */
  switch (line[0])
  {
    case 'M':                      /* M,dir,speed,ms */
      {
        char *a1 = strchr(line, ',');
        if (!a1) { pc_line("错误", "PARAM-INVALID"); return; }
        *a1++ = 0;
        char *a2 = strchr(a1, ',');
        if (a2) *a2++ = 0;
        char *a3 = strchr(a2 ? a2 : "", ',');
        if (a3) *a3++ = 0;

        uint8_t dir = (a1[0] == 'R' || a1[0] == 'r') ? 0U : 1U;
        uint8_t spd = (uint8_t)atoi(a2 ? a2 : "200");
        uint16_t ms = (uint16_t)atoi(a3 ? a3 : "0");

        if (a1[0] == 'S' || a1[0] == 's') { motor(0, 1, 0); pc_line("进料", "电机=STOP"); return; }
        g_pwm = spd;
        motor(1, dir, spd);
        if (ms > 0) { delay(ms); motor(0, 1, 0); }
        pc_line("进料", dir ? "电机=RUN(F)" : "电机=RUN(R)");
        return;
      }

    case 'O':                      /* O,on|off */
      {
        uint8_t on = (strstr(line, "on") != NULL);
        digitalWrite(PIN_LED_STATUS, on ? HIGH : LOW);
        pc_line("灯", on ? "A0=ON" : "A0=OFF");
        return;
      }

    case 'F':                      /* F,on|off  风扇继电器 */
      {
        g_relayFan = (strstr(line, "on") != NULL) ? 1 : 0;
        digitalWrite(PIN_RELAY_FAN, g_relayFan ? RELAY_ON : RELAY_OFF);
        pc_line("继电器", g_relayFan ? "风扇=ON" : "风扇=OFF");
        return;
      }

    case 'W':                      /* W,on|off  灯继电器 */
      {
        g_relayLamp = (strstr(line, "on") != NULL) ? 1 : 0;
        digitalWrite(PIN_RELAY_LAMP, g_relayLamp ? RELAY_ON : RELAY_OFF);
        pc_line("继电器", g_relayLamp ? "灯=ON" : "灯=OFF");
        return;
      }

    case 'B':                      /* B,freq,ms,times */
      {
        uint16_t f = 1000, ms = 120; uint8_t t = 1;
        char *q = line + 2;
        f  = (uint16_t)atoi(q);
        q = strchr(q, ','); if (q) { q++; ms = (uint16_t)atoi(q); }
        q = strchr(q ? q : "", ','); if (q) { q++; t = (uint8_t)atoi(q); }
        beep(f, ms, t);
        pc_line("蜂鸣", "OK");
        return;
      }

    case 'D':                      /* D,text */
      {
        char t[5] = "    ";
        uint8_t i;
        const char *src = line + 2;
        for (i = 0; i < 4 && src[i]; i++) t[i] = src[i];
        tm_show_text(t);
        pc_line("数码管", t);
        return;
      }

    case 'Q':                      /* Q,ldr | Q,addr,qr|nfc|card */
      {
        char *a1 = strchr(line, ',');
        if (!a1) { pc_line("错误", "PARAM-INVALID"); return; }
        *a1++ = 0;

        if (strcmp(a1, "ldr") == 0)     /* 读光敏 + 设基准 */
          {
            int raw = analogRead(PIN_LDR);
            if (g_ldrBase == 0) g_ldrBase = (uint16_t)raw;
            uint8_t pct = (g_ldrBase > 0) ? (uint8_t)((uint32_t)raw * 100UL / g_ldrBase) : 0;
            if (pct > 100) pct = 100;
            char b[48];
            snprintf(b, sizeof(b), "LDR=%d,基准=%u,%u%%", raw, g_ldrBase, pct);
            pc_line("光敏", b);
            return;
          }
        if (strcmp(a1, "setbase") == 0) { g_ldrBase = (uint16_t)analogRead(PIN_LDR); pc_line("光敏", "基准已设置"); return; }

        /* Q,0x10,qr|nfc|card */
        {
          char *a2 = strchr(a1, ',');
          if (!a2) { pc_line("错误", "PARAM-INVALID"); return; }
          *a2++ = 0;
          uint8_t addr = parse_addr(a1);
          if (!addr_is_ident(addr)) { pc_line("错误", "UNIT-NOTFOUND"); return; }

          if (strcmp(a2, "qr") == 0)        { report_persist(0); return; }
          if (strcmp(a2, "nfc") == 0)       { report_persist(1); return; }
          if (strcmp(a2, "card") == 0)      { report_ident_card(); return; }
        }
        pc_line("错误", "PARAM-INVALID");
        return;
      }

    case 'I':                      /* I,0x10  自动识别 */
    case 'C':                      /* C,0x10  扫码 */
    case 'N':                      /* N,0x10  NFC */
      {
        uint8_t addr = parse_addr(line + 2);
        uint8_t c = (line[0] == 'I') ? 0x22 : ((line[0] == 'C') ? 0x24 : 0x25);
        if (!addr_is_ident(addr)) { pc_line("错误", "UNIT-NOTFOUND"); return; }
        if (!cmd(addr, c, 0)) { pc_line("错误", "I2C-NOACK"); return; }

        /* 等结果 */
        {
          uint16_t t = 0;
          uint8_t ms_state = 0;
          while (t < 6000U)
          {
            delay(50); t += 50;
            if (!i2c_read(addr, I_MSTATE, &ms_state)) continue;
            if (ms_state == 3U || ms_state == 4U || ms_state == 0U) break;
          }
          report_ident_result(ms_state == 3U);
        }
        return;
      }

    case 'R':                      /* R,0x10  读结果 */
      report_ident_result(1);
      return;

    case 'E':                      /* E,0x10,deg|up|down */
      {
        char *a1 = strchr(line, ',');
        if (!a1) { pc_line("错误", "PARAM-INVALID"); return; }
        *a1++ = 0;
        char *a2 = strchr(a1, ',');
        if (!a2) { pc_line("错误", "PARAM-INVALID"); return; }
        *a2++ = 0;

        uint8_t addr = parse_addr(a1);
        if (!addr_is_ident(addr)) { pc_line("错误", "UNIT-NOTFOUND"); return; }

        if (strcmp(a2, "up") == 0)        cmd(addr, 0x30, 0);
        else if (strcmp(a2, "down") == 0) cmd(addr, 0x31, 0);
        else cmd(addr, 0x32, (uint8_t)atoi(a2));

        { char b[32]; snprintf(b, sizeof(b), "挡片=%s", a2); pc_line("识别", b); }
        return;
      }

    case 'K':                      /* K,0x10,on|off|sec,N|pwm,N|dir,F|R */
      {
        char *a1 = strchr(line, ',');
        if (!a1) { pc_line("错误", "PARAM-INVALID"); return; }
        *a1++ = 0;
        char *a2 = strchr(a1, ',');
        if (!a2) { pc_line("错误", "PARAM-INVALID"); return; }
        *a2++ = 0;

        uint8_t addr = parse_addr(a1);
        if (!addr_is_ident(addr)) { pc_line("错误", "UNIT-NOTFOUND"); return; }

        if (strcmp(a2, "on") == 0)        { cmd(addr, 0x10, 0); pc_line("皮带", "RUN"); }
        else if (strcmp(a2, "off") == 0)  { cmd(addr, 0x11, 0); pc_line("皮带", "STOP"); }
        else if (strncmp(a2, "sec,", 4) == 0) { cmd(addr, 0x13, (uint8_t)atoi(a2 + 4)); pc_line("皮带", "定时运行"); }
        else if (strncmp(a2, "pwm,", 4) == 0) { i2c_write(addr, 0x10, (uint8_t)atoi(a2 + 4)); cmd(addr, 0x10, 0); pc_line("皮带", "速度已设"); }
        else if (strncmp(a2, "dir,", 4) == 0) { i2c_write(addr, 0x11, (a2[4] == 'R' || a2[4] == 'r') ? 0U : 1U); pc_line("皮带", "方向已设"); }
        else pc_line("错误", "PARAM-INVALID");
        return;
      }

    case 'S':                      /* S,0x20,act */
      {
        char *a1 = strchr(line, ',');
        if (!a1) { pc_line("错误", "PARAM-INVALID"); return; }
        *a1++ = 0;
        char *a2 = strchr(a1, ',');
        if (!a2) { pc_line("错误", "PARAM-INVALID"); return; }
        *a2++ = 0;

        uint8_t addr = parse_addr(a1);
        if (!addr_is_sort(addr)) { pc_line("错误", "UNIT-NOTFOUND"); return; }

        if (sort_act(addr, a2))
        {
          char b[40];
          snprintf(b, sizeof(b), "0x%02X,%s OK", addr, a2);
          pc_line("分拣", b);
        }
        else pc_line("错误", "I2C-NOACK");
        return;
      }

    case 'P':                      /* P,0x20,act,val */
      {
        char *a1 = strchr(line, ',');
        if (!a1) { pc_line("错误", "PARAM-INVALID"); return; }
        *a1++ = 0;
        char *a2 = strchr(a1, ',');
        if (!a2) { pc_line("错误", "PARAM-INVALID"); return; }
        *a2++ = 0;
        char *a3 = strchr(a2, ',');
        if (a3) *a3++ = 0;

        uint8_t addr = parse_addr(a1);
        if (!addr_is_sort(addr)) { pc_line("错误", "UNIT-NOTFOUND"); return; }

        int raw = atoi(a3 ? a3 : "0");
        if (raw < 0) raw = 0;
        if (raw > 255) raw = 255;
        uint8_t val = (uint8_t)raw;   /* 前端已按 x10ms / x10us 填好，直接透传 */

        uint8_t reg;
        if (strcmp(a2, "au") == 0)       reg = 0x10;
        else if (strcmp(a2, "bu") == 0)  reg = 0x11;
        else if (strcmp(a2, "spd") == 0) reg = 0x12;
        else { pc_line("错误", "PARAM-INVALID"); return; }

        if (i2c_write(addr, reg, val)) pc_line("分拣", "参数已设置");
        else pc_line("错误", "I2C-NOACK");
        return;
      }

    case 'T':                      /* T,0x20 */
      {
        uint8_t addr = parse_addr(line + 2);
        if (!addr_is_sort(addr)) { pc_line("错误", "UNIT-NOTFOUND"); return; }
        report_sort_status(addr);
        return;
      }

    case 'L':                      /* L,0x20,n */
      {
        char *a1 = strchr(line, ',');
        if (!a1) { pc_line("错误", "PARAM-INVALID"); return; }
        *a1++ = 0;
        uint8_t addr = parse_addr(a1);
        char *a2 = strchr(a1, ',');
        uint8_t n = a2 ? (uint8_t)atoi(a2 + 1) : 0;
        if (!addr_is_sort(addr)) { pc_line("错误", "UNIT-NOTFOUND"); return; }
        cmd(addr, 0x20, n);
        pc_line("分拣", "灯已设");
        return;
      }

    case 'A':                      /* A,addr  自检 */
      {
        uint8_t addr = parse_addr(line + 2);
        if (addr_is_ident(addr))       cmd(addr, 0x40, 0);
        else if (addr_is_sort(addr))   cmd(addr, 0x30, 0);
        else { pc_line("错误", "UNIT-NOTFOUND"); return; }

        { char b[32]; snprintf(b, sizeof(b), "0x%02X 自检已触发", addr); pc_line("自检", b); }
        return;
      }

    default: break;
  }

  pc_line("错误", "PARAM-INVALID");
}

/* ============================ 主程序 ============================ */
void setup()
{
  Serial.begin(115200);
  delay(200);

  pinMode(PIN_BTN1, INPUT_PULLUP);
  pinMode(PIN_BTN2, INPUT_PULLUP);
  pinMode(PIN_TM_CLK, OUTPUT);
  pinMode(PIN_TM_DIO, OUTPUT);
  pinMode(PIN_MOTOR_ENA, OUTPUT);
  pinMode(PIN_MOTOR_IN1, OUTPUT);
  pinMode(PIN_MOTOR_IN2, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_STATUS, OUTPUT);
  pinMode(PIN_RELAY_FAN, OUTPUT);
  pinMode(PIN_RELAY_LAMP, OUTPUT);

  motor(0, 1, 0);
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_LED_STATUS, LOW);
  digitalWrite(PIN_RELAY_FAN, RELAY_OFF);
  digitalWrite(PIN_RELAY_LAMP, RELAY_OFF);
  tm_show(0);

  /* 先用内部上拉把两根线拉到高，缓解外部上拉缺失 */
  pinMode(A4, INPUT_PULLUP);
  pinMode(A5, INPUT_PULLUP);
  delay(5);

  i2c_recover();
  Wire.begin();
  Wire.setClock(50000);           /* 50 kHz，稳 */

  /* 看门狗：I2C 一旦卡死，2 秒后自动复位重启（自愈） */
  wdt_enable(WDTO_2S);

  g_ldrBase = (uint16_t)analogRead(PIN_LDR);

  Serial.println();
  Serial.print(F("[握手] NANO-READY "));
  Serial.println(F(FW_TAG));
  Serial.println(F("[帮助] 发送 H 握手，? 查询状态，h 查看命令"));

  /* 开机扫描默认关闭：上拉不足时会在扫描阶段卡死。
   * 需要时用 ? 命令查在线数量，或把下面一行取消注释。 */
  /* i2c_scan_report(); */

  g_ms = millis();
}

void loop()
{
  static char line[48];
  static uint8_t len = 0;
  static uint32_t lastRx = 0;
  static uint32_t lastHb = 0;
  static uint8_t lastBtn1 = 1, lastBtn2 = 1;

  g_ms = millis();
  wdt_reset();                    /* 喂狗：正常循环不会复位 */

  /* ---- 串口收命令 ---- */
  while (Serial.available())
  {
    char c = (char)Serial.read();
    g_lastPcRx = g_ms;

    if (c == '\r') continue;
    if (c == '\n')
    {
      if (len > 0) { line[len] = 0; handle_line(line); len = 0; }
      continue;
    }
    if (len < sizeof(line) - 1) line[len++] = c;
  }

  /* ---- 没有换行也执行（300ms 空闲） ---- */
  if (len > 0 && (g_ms - lastRx) > 300U && lastRx != 0)
  {
    line[len] = 0; handle_line(line); len = 0;
  }
  if (len > 0) lastRx = g_ms;
  if (len == 0) lastRx = 0;

  /* ---- 主机在线检测 ---- */
  {
    uint8_t online = ((g_ms - g_lastPcRx) < 15000UL) ? 1U : 0U;
    if (online != g_hostOnline && g_lastPcRx != 0)
    {
      g_hostOnline = online;
      Serial.println(online ? F("[主机] 在线") : F("[主机] 离线"));
    }
  }

  /* ---- 按钮事件 ---- */
  {
    uint8_t b1 = digitalRead(PIN_BTN1);
    uint8_t b2 = digitalRead(PIN_BTN2);

    if (b1 != lastBtn1)
    {
      lastBtn1 = b1;
      if (b1 == LOW)
      {
        Serial.println(F("[按钮] D3"));
        if (!g_hostOnline) { g_feedCount = 0; tm_show(0); }
      }
    }
    if (b2 != lastBtn2)
    {
      lastBtn2 = b2;
      if (b2 == LOW)
      {
        Serial.println(F("[按钮] D6"));
        if (!g_hostOnline)
        {
          motor(1, 1, g_pwm); delay(600); motor(0, 1, 0);
          g_feedCount++; tm_show(g_feedCount);
        }
      }
    }
  }

  delay(5);
}
