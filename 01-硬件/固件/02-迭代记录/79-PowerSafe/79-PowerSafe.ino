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
#define _SS_MAX_RX_BUFF 32   /* 省 32 字节 RAM */
#include <SoftwareSerial.h>

/* ==================== ★ WiFi / ESP-01 配置区 ★ ==================== */
#define WIFI_SSID       "YOUR_WIFI_SSID"              /* WiFi 名称 */
#define WIFI_PASS       "YOUR_WIFI_PASSWORD"           /* WiFi 密码 */
#define ESP_STATIC_IP   "192.168.1.100"     /* ESP 引导阶段固定 IP */
#define ESP_GATEWAY     "192.168.1.1"
#define ESP_NETMASK     "255.255.255.0"
#define BOOTSTRAP_PORT  8080                 /* 阶段① ESP 监听端口 */
#define PC_SERVER_PORT  9000                 /* 阶段② 电脑监听端口（仅日志用）*/

#define USB_IDLE_MS     15000UL              /* USB 多久没数据就算"没插线" */
#define HEARTBEAT_MS    10000UL              /* WiFi 心跳间隔 */

/* WDT_ENABLE: 0=关闭看门狗（排查复位问题用）  1=开启 */
#define WDT_ENABLE      0

#if WDT_ENABLE
  #define WDT_FEED()  wdt_reset()
#else
  #define WDT_FEED()  do { } while (0)
#endif

/* FEED 板：D10 = Nano->ESP（经分压），D12 = ESP->Nano */
#define PIN_ESP_RX   12
#define PIN_ESP_TX   10
/* ================================================================== */
#include <avr/wdt.h>
#include <avr/pgmspace.h>

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
#define FW_TAG   "V7.5-POWERSAFE"

/* ==================================================================
 *  双通道输出：USB 串口 / WiFi(ESP-01)
 *  用 Print 指针自动路由，业务代码完全不用改。
 * ================================================================== */
SoftwareSerial esp(PIN_ESP_RX, PIN_ESP_TX);

static uint8_t  g_usbActive  = 0;      /* USB 最近有数据 */
static uint32_t g_lastUsbMs  = 0;
static uint8_t  g_espLinked  = 0;      /* 阶段② 已连上电脑 */
static int8_t   g_espLink    = -1;
static uint32_t g_lastHb     = 0;
static uint32_t g_espBaud    = 9600;

static void esp_send_payload(const char *data, uint16_t len);

/* WiFi 输出缓冲：攒够一整段再发一条 AT+CIPSEND */
class EspSink : public Print
{
public:
  EspSink() { n = 0; }
  size_t write(uint8_t c)
  {
    /* 遇到换行就立即发出，缓冲可以很小 */
    if (c == '\n')
    {
      if (n < sizeof(buf) - 1) { buf[n++] = '\n'; }
      buf[n] = '\0';
      esp_send_payload(buf, n);
      n = 0;
      return 1;
    }
    if (n < sizeof(buf) - 1) { buf[n++] = (char)c; return 1; }
    /* 缓冲满了也发出去，避免丢字 */
    buf[n] = '\0';
    esp_send_payload(buf, n);
    n = 0;
    return 1;
  }
  void flushBuf(void)
  {
    if (n == 0) return;
    buf[n] = '\0';
    esp_send_payload(buf, n);
    n = 0;
  }
  void resetBuf(void) { n = 0; }
private:
  char     buf[72];
  uint16_t n;
};

static EspSink g_espSink;

/* ★ 输出路由：USB 有活动就优先 USB，否则走 WiFi ★ */
static Print *g_out = &Serial;

static void route_begin(void)
{
  if ((millis() - g_lastUsbMs) < USB_IDLE_MS)
  {
    g_out = &Serial;                    /* 数据线优先 */
    g_usbActive = 1;
  }
  else if (g_espLinked)
  {
    g_out = &g_espSink;
    g_usbActive = 0;
  }
  else
  {
    g_out = &Serial;                    /* 都没有，输出到 USB（无害） */
    g_usbActive = 0;
  }
}

static void route_end(void)
{
  if (g_out == &g_espSink) g_espSink.flushBuf();
}

/* 当前链路名称 */
static const char *link_name(void)
{
  if ((millis() - g_lastUsbMs) < USB_IDLE_MS) return "USB";
  if (g_espLinked) return "WIFI";
  return "NONE";
}


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
static void pc_print(const char *s) { g_out->print(s); }

static void pc_line(const __FlashStringHelper *tag, const __FlashStringHelper *body)
{
  g_out->print('[');
  g_out->print(tag);
  g_out->print(F("] "));
  g_out->println(body);
}

static void pc_line(const __FlashStringHelper *tag, const char *body)
{
  g_out->print('[');
  g_out->print(tag);
  g_out->print(F("] "));
  g_out->println(body);
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

  g_out->println(F("[I2C] scanning bus ..."));
  for (i = 0; i < 5; i++)
  {
    g_out->print(F("[I2C] "));
    g_out->print(names[i]);
    g_out->print(F(" ... "));
    if (i2c_read(addrs[i], R_STATUS, &v))
    {
      g_out->print(F("OK  STATUS=0x"));
      g_out->print(v, HEX);
      g_out->print(F("  FW=0x"));
      if (i2c_read(addrs[i], R_FW, &v)) g_out->println(v, HEX);
      else g_out->println(F("?"));
      ok++;
    }
    else
    {
      g_out->println(F("NOT FOUND"));
    }
    delay(5);
  }
  g_out->print(F("[I2C] total "));
  g_out->print(ok);
  g_out->println(F(" / 5 unit(s) online"));
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

  g_out->print(F("[状态] "));
  for (i = 0; i < 5; i++)
  {
    if (i) g_out->print(',');
    g_out->print(names[i]);
    g_out->print('=');
    if (i2c_read(addrs[i], R_STATUS, &v)) g_out->print(v, HEX);
    else g_out->print(F("NA"));
  }
  g_out->println();

  /* 进料状态 */
  g_out->print(F("[进料] 计数="));
  g_out->print(g_feedCount);
  g_out->print(F(",电机="));
  g_out->print(digitalRead(PIN_MOTOR_ENA) ? F("RUN") : F("STOP"));
  g_out->print(F(",主机="));
  g_out->println(g_hostOnline ? F("ON") : F("OFF"));

  /* 单元在线数 */
  {
    uint8_t aa[5] = { ADDR_IDENT, ADDR_SORT0, ADDR_SORT1, ADDR_SORT2, ADDR_SORT3 };
    uint8_t ii, cnt = 0, tmp;
    for (ii = 0; ii < 5; ii++) { if (i2c_read(aa[ii], R_STATUS, &tmp)) cnt++; }
    g_out->print(F("[在线] "));
    g_out->print(cnt);
    g_out->println(F(" / 5 单元"));
  }

  /* 光敏 */
  {
    int raw = analogRead(PIN_LDR);
    uint8_t pct = (g_ldrBase > 0) ? (uint8_t)((uint32_t)raw * 100UL / (uint32_t)g_ldrBase) : 0;
    if (pct > 100) pct = 100;
    g_out->print(F("[光敏] LDR="));
    g_out->print(raw);
    g_out->print(F(",基准="));
    g_out->print(g_ldrBase);
    g_out->print(',');
    g_out->print(pct);
    g_out->println('%');
  }
}

static void report_ident_result(uint8_t ok)
{
  uint8_t type = 0, len = 0, c, i;

  if (!ok) { g_out->println(F("[识别] 0,0,0,-")); return; }

  i2c_read(ADDR_IDENT, I_RES_TYPE, &type);
  i2c_read(ADDR_IDENT, I_RES_LEN, &len);
  if (len > 32) len = 32;

  g_out->print(F("[识别] 1,"));
  if (type == 1U) g_out->print(F("NFC"));
  else if (type == 3U) g_out->print(F("QR"));
  else if (type == 2U) g_out->print(F("QR"));
  else g_out->print(F("RAW"));
  g_out->print(',');
  g_out->print(len);
  g_out->print(',');
  for (i = 0; i < len; i++)
  {
    if (i2c_read(ADDR_IDENT, (uint8_t)(I_RES_BUF + i), &c))
      g_out->print(c, HEX);
    else
      g_out->print(F("??"));
  }
  if (len == 0) g_out->print('-');
  g_out->println();
}

/* 读持久缓冲区：which = 0 QR, 1 NFC */
static void report_persist(uint8_t which)
{
  uint8_t len = 0, c, i, lenReg, bufReg;

  if (which == 0U) { lenReg = I_QR_LEN;  bufReg = I_QR_BUF;  g_out->print(F("[缓冲区] QR,")); }
  else             { lenReg = I_NFC_LEN; bufReg = I_NFC_BUF; g_out->print(F("[缓冲区] NFC,")); }

  i2c_read(ADDR_IDENT, lenReg, &len);
  if (len > 32) len = 32;
  g_out->print(len);
  g_out->print(',');
  for (i = 0; i < len; i++)
  {
    if (i2c_read(ADDR_IDENT, (uint8_t)(bufReg + i), &c)) g_out->print(c, HEX);
  }
  if (len == 0) g_out->print('-');
  g_out->println();
}

static void report_ident_card(void)
{
  uint8_t v;
  g_out->print(F("[有卡] "));
  if (i2c_read(ADDR_IDENT, 0x22, &v)) { g_out->println(v ? F("CARD=1") : F("CARD=0")); }
  else g_out->println(F("I2C-NOACK"));
}

static void report_sort_status(uint8_t addr)
{
  uint8_t lim = 0, card = 0, phase = 0, cnt = 0;
  i2c_read(addr, U_LIMIT, &lim);
  i2c_read(addr, U_CARD, &card);
  i2c_read(addr, U_PHASE, &phase);
  i2c_read(addr, U_LIFT_CNT, &cnt);

  g_out->print(F("[分拣] 0x"));
  g_out->print(addr, HEX);
  g_out->print(F(",限位="));
  g_out->print(lim);
  g_out->print(F(",有卡="));
  g_out->print(card);
  g_out->print(F(",阶段="));
  g_out->print(phase);
  g_out->print(F(",抬升="));
  g_out->println(cnt);
}

/* ============================ 命令处理 ============================ */
static void help_line(void)
{
  g_out->println(F("[帮助] H 握手 | ? 状态 | s/t/c/r/b 进料"));
  g_out->println(F("[帮助] M,dir,speed,ms | O,on|off | B,freq,ms,times | D,text"));
  g_out->println(F("[帮助] Q,ldr | F,on|off | W,on|off"));
  g_out->println(F("[帮助] I/C/N/R,0x10 识别 | Q,0x10,qr|nfc | E,0x10,deg|up|down"));
  g_out->println(F("[帮助] K,0x10,on|off|sec,N|pwm,N|dir,F|R  皮带"));
  g_out->println(F("[帮助] S,0x20,raise|lower|au|ad|bu|bd|stop|hold|arm|disarm"));
  g_out->println(F("[帮助] P,0x20,au|ad|bu|bd|spd,val | T,0x20 | L,0x20,n | A,addr"));
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
        g_out->print(F("[握手] NANO-READY "));
        g_out->println(F(FW_TAG));
        g_hostOnline = 1;
        g_out->println(F("[主机] 在线"));
        return;
      case '?': report_status(); return;
      case 's': motor(1, 1, g_pwm); pc_line(F("进料"), F("电机=RUN")); return;
      case 't': motor(0, 1, 0);     pc_line(F("进料"), F("电机=STOP")); return;
      case 'c':
        motor(1, 1, g_pwm); delay(600); motor(0, 1, 0);
        g_feedCount++;
        { char b[40]; snprintf_P(b, sizeof(b), PSTR("推卡完成,计数=%u"), g_feedCount); pc_line(F("进料"), b); }
        tm_show(g_feedCount);
        return;
      case 'r':
        g_feedCount = 0; tm_show(0);
        pc_line(F("进料"), F("计数=0"));
        return;
      case 'b': beep(1000, 120, 1); pc_line(F("蜂鸣"), F("OK")); return;
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
        if (!a1) { pc_line(F("错误"), F("PARAM-INVALID")); return; }
        *a1++ = 0;
        char *a2 = strchr(a1, ',');
        if (a2) *a2++ = 0;
        char *a3 = strchr(a2 ? a2 : "", ',');
        if (a3) *a3++ = 0;

        uint8_t dir = (a1[0] == 'R' || a1[0] == 'r') ? 0U : 1U;
        uint8_t spd = (uint8_t)atoi(a2 ? a2 : "200");
        uint16_t ms = (uint16_t)atoi(a3 ? a3 : "0");

        if (a1[0] == 'S' || a1[0] == 's') { motor(0, 1, 0); pc_line(F("进料"), F("电机=STOP")); return; }
        g_pwm = spd;
        motor(1, dir, spd);
        if (ms > 0) { delay(ms); motor(0, 1, 0); }
        pc_line(F("进料"), dir ? "电机=RUN(F)" : "电机=RUN(R)");
        return;
      }

    case 'O':                      /* O,on|off */
      {
        uint8_t on = (strstr_P(line, PSTR("on")) != NULL);
        digitalWrite(PIN_LED_STATUS, on ? HIGH : LOW);
        pc_line(F("灯"), on ? "A0=ON" : "A0=OFF");
        return;
      }

    case 'F':                      /* F,on|off  风扇继电器 */
      {
        g_relayFan = (strstr_P(line, PSTR("on")) != NULL) ? 1 : 0;
        digitalWrite(PIN_RELAY_FAN, g_relayFan ? RELAY_ON : RELAY_OFF);
        pc_line(F("继电器"), g_relayFan ? "风扇=ON" : "风扇=OFF");
        return;
      }

    case 'W':                      /* W,on|off  灯继电器 */
      {
        g_relayLamp = (strstr_P(line, PSTR("on")) != NULL) ? 1 : 0;
        digitalWrite(PIN_RELAY_LAMP, g_relayLamp ? RELAY_ON : RELAY_OFF);
        pc_line(F("继电器"), g_relayLamp ? "灯=ON" : "灯=OFF");
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
        pc_line(F("蜂鸣"), F("OK"));
        return;
      }

    case 'D':                      /* D,text */
      {
        char t[5] = "    ";
        uint8_t i;
        const char *src = line + 2;
        for (i = 0; i < 4 && src[i]; i++) t[i] = src[i];
        tm_show_text(t);
        pc_line(F("数码管"), t);
        return;
      }

    case 'Q':                      /* Q,ldr | Q,addr,qr|nfc|card */
      {
        char *a1 = strchr(line, ',');
        if (!a1) { pc_line(F("错误"), F("PARAM-INVALID")); return; }
        *a1++ = 0;

        if (strcmp(a1, "ldr") == 0)     /* 读光敏 + 设基准 */
          {
            int raw = analogRead(PIN_LDR);
            if (g_ldrBase == 0) g_ldrBase = (uint16_t)raw;
            uint8_t pct = (g_ldrBase > 0) ? (uint8_t)((uint32_t)raw * 100UL / g_ldrBase) : 0;
            if (pct > 100) pct = 100;
            char b[48];
            snprintf_P(b, sizeof(b), PSTR("LDR=%d,基准=%u,%u%%"), raw, g_ldrBase, pct);
            pc_line(F("光敏"), b);
            return;
          }
        if (strcmp(a1, "setbase") == 0) { g_ldrBase = (uint16_t)analogRead(PIN_LDR); pc_line(F("光敏"), F("基准已设置")); return; }

        /* Q,0x10,qr|nfc|card */
        {
          char *a2 = strchr(a1, ',');
          if (!a2) { pc_line(F("错误"), F("PARAM-INVALID")); return; }
          *a2++ = 0;
          uint8_t addr = parse_addr(a1);
          if (!addr_is_ident(addr)) { pc_line(F("错误"), F("UNIT-NOTFOUND")); return; }

          if (strcmp(a2, "qr") == 0)        { report_persist(0); return; }
          if (strcmp(a2, "nfc") == 0)       { report_persist(1); return; }
          if (strcmp(a2, "card") == 0)      { report_ident_card(); return; }
        }
        pc_line(F("错误"), F("PARAM-INVALID"));
        return;
      }

    case 'I':                      /* I,0x10  自动识别 */
    case 'C':                      /* C,0x10  扫码 */
    case 'N':                      /* N,0x10  NFC */
      {
        uint8_t addr = parse_addr(line + 2);
        uint8_t c = (line[0] == 'I') ? 0x22 : ((line[0] == 'C') ? 0x24 : 0x25);
        if (!addr_is_ident(addr)) { pc_line(F("错误"), F("UNIT-NOTFOUND")); return; }
        if (!cmd(addr, c, 0)) { pc_line(F("错误"), F("I2C-NOACK")); return; }

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
        if (!a1) { pc_line(F("错误"), F("PARAM-INVALID")); return; }
        *a1++ = 0;
        char *a2 = strchr(a1, ',');
        if (!a2) { pc_line(F("错误"), F("PARAM-INVALID")); return; }
        *a2++ = 0;

        uint8_t addr = parse_addr(a1);
        if (!addr_is_ident(addr)) { pc_line(F("错误"), F("UNIT-NOTFOUND")); return; }

        if (strcmp(a2, "up") == 0)        cmd(addr, 0x30, 0);
        else if (strcmp(a2, "down") == 0) cmd(addr, 0x31, 0);
        else cmd(addr, 0x32, (uint8_t)atoi(a2));

        { char b[32]; snprintf_P(b, sizeof(b), PSTR("挡片=%s"), a2); pc_line(F("识别"), b); }
        return;
      }

    case 'K':                      /* K,0x10,on|off|sec,N|pwm,N|dir,F|R */
      {
        char *a1 = strchr(line, ',');
        if (!a1) { pc_line(F("错误"), F("PARAM-INVALID")); return; }
        *a1++ = 0;
        char *a2 = strchr(a1, ',');
        if (!a2) { pc_line(F("错误"), F("PARAM-INVALID")); return; }
        *a2++ = 0;

        uint8_t addr = parse_addr(a1);
        if (!addr_is_ident(addr)) { pc_line(F("错误"), F("UNIT-NOTFOUND")); return; }

        if (strcmp(a2, "on") == 0)        { cmd(addr, 0x10, 0); pc_line(F("皮带"), F("RUN")); }
        else if (strcmp(a2, "off") == 0)  { cmd(addr, 0x11, 0); pc_line(F("皮带"), F("STOP")); }
        else if (strncmp_P(a2, PSTR("sec,"), 4) == 0) { cmd(addr, 0x13, (uint8_t)atoi(a2 + 4)); pc_line(F("皮带"), F("定时运行")); }
        else if (strncmp_P(a2, PSTR("pwm,"), 4) == 0) { i2c_write(addr, 0x10, (uint8_t)atoi(a2 + 4)); cmd(addr, 0x10, 0); pc_line(F("皮带"), F("速度已设")); }
        else if (strncmp_P(a2, PSTR("dir,"), 4) == 0) { i2c_write(addr, 0x11, (a2[4] == 'R' || a2[4] == 'r') ? 0U : 1U); pc_line(F("皮带"), F("方向已设")); }
        else pc_line(F("错误"), F("PARAM-INVALID"));
        return;
      }

    case 'S':                      /* S,0x20,act */
      {
        char *a1 = strchr(line, ',');
        if (!a1) { pc_line(F("错误"), F("PARAM-INVALID")); return; }
        *a1++ = 0;
        char *a2 = strchr(a1, ',');
        if (!a2) { pc_line(F("错误"), F("PARAM-INVALID")); return; }
        *a2++ = 0;

        uint8_t addr = parse_addr(a1);
        if (!addr_is_sort(addr)) { pc_line(F("错误"), F("UNIT-NOTFOUND")); return; }

        if (sort_act(addr, a2))
        {
          char b[40];
          snprintf_P(b, sizeof(b), PSTR("0x%02X,%s OK"), addr, a2);
          pc_line(F("分拣"), b);
        }
        else pc_line(F("错误"), F("I2C-NOACK"));
        return;
      }

    case 'P':                      /* P,0x20,act,val */
      {
        char *a1 = strchr(line, ',');
        if (!a1) { pc_line(F("错误"), F("PARAM-INVALID")); return; }
        *a1++ = 0;
        char *a2 = strchr(a1, ',');
        if (!a2) { pc_line(F("错误"), F("PARAM-INVALID")); return; }
        *a2++ = 0;
        char *a3 = strchr(a2, ',');
        if (a3) *a3++ = 0;

        uint8_t addr = parse_addr(a1);
        if (!addr_is_sort(addr)) { pc_line(F("错误"), F("UNIT-NOTFOUND")); return; }

        int raw = atoi(a3 ? a3 : "0");
        if (raw < 0) raw = 0;
        if (raw > 255) raw = 255;
        uint8_t val = (uint8_t)raw;   /* 前端已按 x10ms / x10us 填好，直接透传 */

        uint8_t reg;
        if (strcmp(a2, "au") == 0)       reg = 0x10;
        else if (strcmp(a2, "bu") == 0)  reg = 0x11;
        else if (strcmp(a2, "spd") == 0) reg = 0x12;
        else { pc_line(F("错误"), F("PARAM-INVALID")); return; }

        if (i2c_write(addr, reg, val)) pc_line(F("分拣"), F("参数已设置"));
        else pc_line(F("错误"), F("I2C-NOACK"));
        return;
      }

    case 'T':                      /* T,0x20 */
      {
        uint8_t addr = parse_addr(line + 2);
        if (!addr_is_sort(addr)) { pc_line(F("错误"), F("UNIT-NOTFOUND")); return; }
        report_sort_status(addr);
        return;
      }

    case 'L':                      /* L,0x20,n */
      {
        char *a1 = strchr(line, ',');
        if (!a1) { pc_line(F("错误"), F("PARAM-INVALID")); return; }
        *a1++ = 0;
        uint8_t addr = parse_addr(a1);
        char *a2 = strchr(a1, ',');
        uint8_t n = a2 ? (uint8_t)atoi(a2 + 1) : 0;
        if (!addr_is_sort(addr)) { pc_line(F("错误"), F("UNIT-NOTFOUND")); return; }
        cmd(addr, 0x20, n);
        pc_line(F("分拣"), F("灯已设"));
        return;
      }

    case 'A':                      /* A,addr  自检 */
      {
        uint8_t addr = parse_addr(line + 2);
        if (addr_is_ident(addr))       cmd(addr, 0x40, 0);
        else if (addr_is_sort(addr))   cmd(addr, 0x30, 0);
        else { pc_line(F("错误"), F("UNIT-NOTFOUND")); return; }

        { char b[32]; snprintf_P(b, sizeof(b), PSTR("0x%02X 自检已触发"), addr); pc_line(F("自检"), b); }
        return;
      }

    default: break;
  }

  pc_line(F("错误"), F("PARAM-INVALID"));
}

/* ============================ 主程序 ============================ */

/* ==================================================================
 *  ESP-01 两阶段交接（服务器 -> 客户端）
 *  阶段①  ESP 开 8080 服务器，电脑连进来发 MYIP:<ip>:<port>
 *  阶段②  ESP 主动连电脑 9000，之后正常收发命令
 * ================================================================== */
#define PH_IDLE       0
#define PH_BOOTSTRAP  1
#define PH_HANDOVER   2
#define PH_CLIENT     3
#define PH_ERROR      4

static uint8_t  g_phase   = PH_IDLE;
static uint32_t g_tPhase  = 0;
static char     g_pcIp[24] = "";
static uint16_t g_pcPort   = 0;
static uint8_t  g_havePc   = 0;
static uint8_t  g_sendFail = 0;
static uint8_t  g_espReboot = 0;        /* 检测到 ESP 输出 ready = 它重启过 */
static const uint32_t BAUDS[3] = { 9600UL, 115200UL, 74880UL };

/* ---------- 剩余 RAM（诊断用）---------- */
static int freeRam(void)
{
  extern int __heap_start;
  extern void *__brkval;
  int v;
  return (int)&v - ((__brkval == 0) ? (int)&__heap_start : (int)__brkval);
}

/* ---------- 等 ESP 关键字（内喂看门狗）---------- */
static uint8_t esp_wait_for(const char *key, uint32_t timeoutMs)
{
  uint32_t t0 = millis();
  char buf[70];
  uint8_t n = 0;
  buf[0] = 0;

  while (millis() - t0 < timeoutMs)
  {
    WDT_FEED();
    while (esp.available())
    {
      char c = (char)esp.read();

      /* ★ 回显 ESP 原始输出，调试用 ★ */
      if (c == '\n') Serial.println();
      else if (c != '\r') Serial.print(c);

      if (n < sizeof(buf) - 1) buf[n++] = c;
      else { memmove(buf, buf + 20, n - 20); n -= 20; buf[n++] = c; }
      buf[n] = 0;
      if (strstr(buf, "Ai-Thinker") != NULL || strstr(buf, "ets Jan") != NULL)
      {
        g_espReboot = 1;
      }
      if (strstr(buf, key) != NULL) return 1;
    }
    delay(5);
  }
  return 0;
}

/* ---------- 发 AT 命令 ---------- */
static uint8_t at_cmd(const char *cmd, const char *expect, uint32_t timeoutMs, uint8_t retries)
{
  uint8_t i;
  for (i = 0; i <= retries; i++)
  {
    if (g_out != NULL && g_phase <= PH_BOOTSTRAP)
    {
      Serial.print(F("\n>> "));
      Serial.print(cmd);
    }
    while (esp.available()) esp.read();
    esp.print(cmd);
    esp.print(F("\r\n"));
    if (esp_wait_for(expect, timeoutMs)) return 1;
    delay(400);
  }
  return 0;
}

/* ---------- 发 AT 命令（命令串放在 Flash，省 RAM）---------- */
static uint8_t at_cmd_P(const __FlashStringHelper *cmd, const char *expect, uint32_t timeoutMs, uint8_t retries)
{
  uint8_t i;
  for (i = 0; i <= retries; i++)
  {
    Serial.print(F("\n>> "));
    Serial.print(cmd);
    while (esp.available()) esp.read();
    esp.print(cmd);
    esp.print(F("\r\n"));
    if (esp_wait_for(expect, timeoutMs)) return 1;
    delay(400);
  }
  return 0;
}

/* ---------- 探测波特率 + 迁到 9600 ---------- */
static uint8_t esp_probe(void)
{
  uint8_t i;

  /* ESP 从断电到能应答 AT 需要 1~2 秒，先等够 */
  Serial.println(F("\n--- 等待 ESP-01 启动 (4 秒) ---"));
  {
    uint32_t t0 = millis();
    while (millis() - t0 < 4000UL) { WDT_FEED(); delay(20); }
  }

  Serial.println(F("--- probing ESP-01 (USB log) ---"));

  for (i = 0; i < 3; i++)
  {
    g_espBaud = BAUDS[i];
    esp.begin(g_espBaud);
    delay(600);
    while (esp.available()) esp.read();

    Serial.print(F("  "));
    Serial.print(g_espBaud);
    Serial.print(F(" ... "));

    esp.print(F("AT\r\n"));
    if (!esp_wait_for("OK", 1500))
    {
      esp.print(F("AT\r\n"));
      if (!esp_wait_for("OK", 1500))
      {
        esp.print(F("AT\r\n"));
        if (!esp_wait_for("OK", 1500)) { Serial.println(F("no reply")); continue; }
      }
    }

    Serial.println(F("OK"));
    if (g_espBaud == 9600UL) return 1;

    /* 迁到 9600 */
    Serial.println(F("  -> migrating to 9600 ..."));
    while (esp.available()) esp.read();
    esp.print(F("AT+UART_DEF=9600,8,1,0,0\r\n"));
    if (!esp_wait_for("OK", 3000)) return 1;

    delay(500);
    while (esp.available()) esp.read();
    g_espBaud = 9600UL;
    esp.begin(g_espBaud);
    delay(300);
    while (esp.available()) esp.read();
    esp.print(F("AT\r\n"));
    if (esp_wait_for("OK", 2000)) { Serial.println(F("  [OK] 9600 ok")); return 1; }

    g_espBaud = BAUDS[i];
    esp.begin(g_espBaud);
    delay(300);
    return 1;
  }
  return 0;
}

/* ---------- 连 WiFi + 固定 IP ---------- */
static uint8_t esp_wifi(void)
{
  char cmd[110];

  if (!esp_probe()) return 0;

  /* ★ 关键：ESP 单独供电，Nano 复位时它不会复位，
   *   会停在上一轮的 TCP 连接/中间态里 -> 必须先 AT+RST 清干净 ★ */
  Serial.println(F("\n  >>> 发 AT+RST 强制复位 ESP <<<"));
  while (esp.available()) esp.read();
  esp.print(F("AT+RST\r\n"));

  /* 等 ESP 重启完成：看到 ready 或最多 6 秒 */
  {
    uint32_t t0 = millis();
    uint8_t gotReady = 0;
    char buf[120];
    uint8_t n = 0;
    buf[0] = 0;

    while (millis() - t0 < 6000)
    {
      WDT_FEED();
      while (esp.available())
      {
        char c = (char)esp.read();
        if (c == '\n') Serial.println(); else if (c != '\r') Serial.print(c);
        if (n < sizeof(buf) - 1) { buf[n++] = c; buf[n] = 0; }
        else { memmove(buf, buf + 40, n - 40); n -= 40; buf[n++] = c; buf[n] = 0; }
        if (strstr_P(buf, PSTR("ready")) != NULL) { gotReady = 1; break; }
      }
      if (gotReady) break;
      delay(20);
    }
    Serial.print(F("\n  ESP 复位完成: "));
    Serial.println(gotReady ? F("收到 ready") : F("超时(继续尝试)"));
  }
  delay(800);
  while (esp.available()) esp.read();

  /* 复位后重新确认通信 */
  esp.print(F("AT\r\n"));
  if (!esp_wait_for("OK", 3000))
  {
    Serial.println(F("  *** AT+RST 后 AT 无回应 ***"));
    return 0;
  }
  Serial.println(F("  [OK] 复位后通信正常"));

  at_cmd_P(F("ATE0"), "OK", 3000, 3);
  at_cmd_P(F("AT+CWMODE=1"), "OK", 3000, 3);

  /* ★ 降低射频发射功率：显著减小峰值电流，缓解欠压复位 ★ */
  at_cmd_P(F("AT+RFPOWER=20"), "OK", 2000, 1);

  snprintf_P(cmd, sizeof(cmd), PSTR("AT+CWJAP=\"%s\",\"%s\""), WIFI_SSID, WIFI_PASS);
  Serial.print(F("\n  WiFi: ")); Serial.print(WIFI_SSID); Serial.println(F(" ..."));
  Serial.println(F("  >>> 即将 CWJAP：这行之后若重启就是复位 <<<"));
  if (!at_cmd(cmd, "OK", 30000, 2)) { Serial.println(F("\n  *** CWJAP 三次都失败 ***"));
    Serial.println(F("  >>> 查询 ESP 当前状态 <<<"));
    at_cmd_P(F("AT+CWJAP?"), "OK", 5000, 0);
    at_cmd_P(F("AT+CIFSR"), "OK", 5000, 0);
    return 0; }
  Serial.println(F("  >>> CWJAP 成功 <<<"));

  snprintf_P(cmd, sizeof(cmd), PSTR("AT+CIPSTA=\"%s\",\"%s\",\"%s\""), ESP_STATIC_IP, ESP_GATEWAY, ESP_NETMASK);
  if (!at_cmd(cmd, "OK", 4000, 1))
  {
    snprintf_P(cmd, sizeof(cmd), PSTR("AT+CIPSTA_CUR=\"%s\",\"%s\",\"%s\""), ESP_STATIC_IP, ESP_GATEWAY, ESP_NETMASK);
    at_cmd(cmd, "OK", 4000, 1);
  }
  at_cmd_P(F("AT+CWAUTOCONN=1"), "OK", 2000, 0);
  return 1;
}

/* ---------- 阶段① 开服务器 ---------- */
static uint8_t esp_bootstrap(void)
{
  char cmd[64];

  Serial.println(F("\n[WIFI] --- 开引导服务器 ---"));
  Serial.print  (F("[WIFI] 剩余 RAM: "));
  Serial.print  (freeRam());
  Serial.println(F(" 字节"));

  g_phase  = PH_BOOTSTRAP;
  g_tPhase = millis();
  g_espLink = -1;
  g_espLinked = 0;
  g_havePc = 0;

  /* 没有服务器/没有连接时这两条必回 ERROR，属正常，只等 800ms 不重试 */
  Serial.print(F("\n>> AT+CIPSERVER=0"));
  while (esp.available()) esp.read();
  esp.print(F("AT+CIPSERVER=0\r\n"));
  if (esp_wait_for("OK", 900)) Serial.print(F("  [OK]"));
  else                        Serial.print(F("  [无服务器,正常]"));

  Serial.print(F("\n>> AT+CIPCLOSE=5"));
  while (esp.available()) esp.read();
  esp.print(F("AT+CIPCLOSE=5\r\n"));
  if (esp_wait_for("OK", 900)) Serial.print(F("  [OK]"));
  else                        Serial.print(F("  [无连接,正常]"));
  delay(300);

  Serial.print(F("\n>> AT+CIPMUX=1"));
  if (!at_cmd_P(F("AT+CIPMUX=1"), "OK", 2000, 3))
  {
    Serial.println(F("  *** CIPMUX=1 失败 ***"));
    g_phase = PH_ERROR;
    return 0;
  }
  Serial.print(F("  [OK]"));

  snprintf_P(cmd, sizeof(cmd), PSTR("AT+CIPSERVER=1,%d"), BOOTSTRAP_PORT);
  if (!at_cmd(cmd, "OK", 4000, 3))
  {
    Serial.println(F("  *** 开服务器失败 ***"));
    g_phase = PH_ERROR;
    return 0;
  }
  Serial.print(F("  [OK]"));

  delay(200);
  Serial.print(F("\n>> AT+CIFSR"));
  esp.print(F("AT+CIFSR\r\n"));
  esp_wait_for("OK", 3000);

  Serial.println(F("\n====================================================="));
  Serial.print  (F("[WIFI] *** 服务器已开 "));
  Serial.print  (F(ESP_STATIC_IP));
  Serial.print  (F(":"));
  Serial.print  (BOOTSTRAP_PORT);
  Serial.println(F(" ***"));
  Serial.print  (F("[WIFI] 剩余 RAM: "));
  Serial.print  (freeRam());
  Serial.println(F(" 字节"));
  Serial.println(F("  现在等电脑连进来 ..."));
  Serial.println(F("====================================================="));
  return 1;
}

/* ---------- 阶段② ESP 主动连电脑 ---------- */
static uint8_t esp_client(void)
{
  char cmd[100];
  uint8_t i;

  g_phase = PH_HANDOVER;
  while (esp.available()) esp.read();
  esp.print(F("AT+CIPSERVER=0\r\n"));
  esp_wait_for("OK", 1500);
  delay(200);
  while (esp.available()) esp.read();
  esp.print(F("AT+CIPCLOSE=5\r\n"));
  esp_wait_for("OK", 1500);
  delay(600);
  at_cmd_P(F("AT+CIPMUX=1"), "OK", 2000, 2);
  delay(200);

  for (i = 0; i < 3; i++)
  {
    snprintf_P(cmd, sizeof(cmd), PSTR("AT+CIPSTART=4,\"TCP\",\"%s\",%d"), g_pcIp, g_pcPort);
    while (esp.available()) esp.read();
    Serial.print(F("\n[WIFI] 连接电脑 ")); Serial.print(g_pcIp);
    Serial.print(':'); Serial.println(g_pcPort);
    esp.print(cmd);
    esp.print(F("\r\n"));

    /* 等 CONNECT，但先看有没有 no ip / ERROR —— 那说明 WiFi 还没拿到地址 */
    {
      uint8_t okConn = 0;
      uint8_t badFlag = 0;
      uint32_t tc = millis();
      char cbuf[80];
      uint8_t cn = 0;
      cbuf[0] = 0;

      while (millis() - tc < 9000)
      {
        WDT_FEED();
        while (esp.available())
        {
          char c = (char)esp.read();
          if (c == '\n') Serial.println(); else if (c != '\r') Serial.print(c);
          if (cn < sizeof(cbuf) - 1) { cbuf[cn++] = c; cbuf[cn] = 0; }
          else { memmove(cbuf, cbuf + 30, cn - 30); cn -= 30; cbuf[cn++] = c; cbuf[cn] = 0; }

          if (strstr(cbuf, "no ip") != NULL || strstr(cbuf, "ERROR") != NULL) badFlag = 1;
          if (strstr(cbuf, "Ai-Thinker") != NULL || strstr(cbuf, "ets Jan") != NULL) badFlag = 2;
          if (strstr(cbuf, "CONNECT") != NULL && !badFlag) okConn = 1;
        }
        if (okConn) break;
        if (badFlag) break;
        delay(5);
      }

      if (okConn && !badFlag)
      {
        delay(250);
        while (esp.available()) esp.read();
        g_phase = PH_CLIENT;
        g_espLink = 4;
        g_espLinked = 1;
        g_lastHb = millis();
        g_sendFail = 0;
        Serial.println(F("\n[WIFI] *** 已连上电脑，WiFi 通道可用 ***"));
        return 1;
      }

      if (badFlag == 2)
      {
        Serial.println(F("\n[WIFI] !!! 检测到 ESP 重启（供电不足？）!!!"));
        g_espReboot = 1;
      }
      else if (badFlag == 1)
      {
        Serial.println(F("\n[WIFI] !!! ESP 没有 IP（WiFi 未连上）!!!"));
        g_espReboot = 1;      /* 同样需要重建整条 WiFi 链路 */
      }
    }
    delay(1200);
  }
  Serial.println(F("[WIFI] 连不上电脑"));
  return 0;
}

/* ---------- 发一段数据到 WiFi ---------- */
static void esp_send_payload(const char *data, uint16_t len)
{
  char cmd[36];
  uint8_t got = 0;
  uint8_t attempt;

  if (!g_espLinked || g_espLink < 0 || len == 0) return;

  /* 先把残留数据清掉，避免把旧回显当成提示符 */
  while (esp.available()) esp.read();

  /* 两种语法都试：多连接 AT+CIPSEND=<link>,<len>；单连接 AT+CIPSEND=<len> */
  for (attempt = 0; attempt < 2 && !got; attempt++)
  {
    if (attempt == 0)
      snprintf_P(cmd, sizeof(cmd), PSTR("AT+CIPSEND=%d,%u"), g_espLink, (unsigned)len);
    else
      snprintf_P(cmd, sizeof(cmd), PSTR("AT+CIPSEND=%u"), (unsigned)len);

    Serial.print(F("\n[TX] "));
    Serial.print(cmd);

    esp.print(cmd);
    esp.print(F("\r\n"));

    {
      uint32_t t0 = millis();
      while (millis() - t0 < 1500)
      {
        WDT_FEED();
        while (esp.available())
        {
          char c = (char)esp.read();
          if (c == '>') { got = 1; break; }
        }
        if (got) break;
        delay(5);
      }
    }

    if (got) Serial.print(F("  [>]"));
    else     Serial.print(F("  [无提示符]"));
  }

  if (!got)
  {
    /* 失败不清链路！只累计失败次数，交给心跳去判断 */
    g_sendFail++;
    Serial.println(F("  *** 两次语法都没有提示符 ***"));
    return;
  }

  esp.print(data);
  if (esp_wait_for("SEND OK", 2500)) { g_sendFail = 0; Serial.println(F("  [SEND OK]")); }
  else { g_sendFail++; Serial.println(F("  [无 SEND OK]")); }
}

/* ---------- 解析电脑报的 MYIP ---------- */
static uint8_t esp_parse_myip(char *payload)
{
  char *p;
  char *colon;
  uint8_t l;
  uint8_t i;

  if (strncmp_P(payload, PSTR("MYIP"), 4) != 0) return 0;

  p = payload + 4;
  while (*p == ':' || *p == '=' || *p == ' ') p++;
  colon = strchr(p, ':');
  if (colon == NULL) return 0;

  l = (uint8_t)(colon - p);
  if (l == 0 || l > sizeof(g_pcIp) - 1) return 0;
  for (i = 0; i < l; i++) g_pcIp[i] = p[i];
  g_pcIp[i] = 0;
  g_pcPort = (uint16_t)atoi(colon + 1);
  if (g_pcPort == 0) return 0;

  g_havePc = 1;
  Serial.print(F("\n[WIFI] 收到电脑地址 "));
  Serial.print(g_pcIp); Serial.print(':'); Serial.println(g_pcPort);
  return 1;
}

/* ---------- 处理 ESP 输出（+IPD 完整长度校验）---------- */
static void esp_poll(void)
{
  static char buf[120];
  static uint16_t n = 0;

  while (esp.available())
  {
    char c = (char)esp.read();
    if (c == '\r') continue;

    if (n < sizeof(buf) - 1) { buf[n++] = c; buf[n] = 0; }
    else { memmove(buf, buf + 60, n - 60); n -= 60; buf[n++] = c; buf[n] = 0; }

    /* 阶段① 连上事件 */
    if (g_phase == PH_BOOTSTRAP)
    {
      char *cn = strstr_P(buf, PSTR(",CONNECT"));
      if (cn != NULL && cn > buf)
      {
        int id = atoi(cn - 1);
        if (id < 0 || id > 4) id = 0;
        g_espLink = (int8_t)id;
        Serial.println(F("\n[WIFI] 电脑已连入，等待 MYIP"));
        {
          const char *w = "OK:WAITING_MYIP\n";
          esp_send_payload(w, (uint16_t)strlen(w));
        }
        g_tPhase = millis();
        n = 0; buf[0] = 0;
        continue;
      }
    }

    /* +IPD 数据 */
    {
      char *ipd = strstr_P(buf, PSTR("+IPD,"));
      if (ipd != NULL)
      {
        char *colon = strchr(ipd, ':');
        if (colon != NULL)
        {
          int link = -1, len = 0;
          char hdr[26];
          uint8_t hl = (uint8_t)(colon - ipd);
          char *payload;
          uint16_t alen;

          if (hl < sizeof(hdr))
          {
            memcpy(hdr, ipd, hl); hdr[hl] = 0;
            if (sscanf(hdr, "+IPD,%d,%d", &link, &len) < 2)
            { link = -1; if (sscanf(hdr, "+IPD,%d", &len) != 1) len = 0; }
          }
          else len = 0;

          payload = colon + 1;
          alen = (uint16_t)strlen(payload);

          if (len > 0 && alen >= (uint16_t)len)   /* ★ 收满才处理 */
          {
            char save = payload[len];
            payload[len] = 0;
            if (link >= 0) g_espLink = (int8_t)link;

            /* 阶段① 收地址 */
            if (g_phase == PH_BOOTSTRAP && esp_parse_myip(payload))
            {
              const char *ack = "OK:GOT_IT\n";
              esp_send_payload(ack, (uint16_t)strlen(ack));
              delay(300);
              g_phase = PH_HANDOVER;
            }
            else if (strncmp_P(payload, PSTR("MYIP"), 4) != 0)
            {
              /* 当成命令执行（按行拆分）；MYIP 行跳过，避免被误当命令 */
              {
                uint16_t k = 0;
                while (k < len)
                {
                  char l2[48];
                  uint8_t m = 0;
                  while (k < len && payload[k] != '\n' && m < sizeof(l2) - 1)
                  {
                    if (payload[k] != '\r') l2[m++] = payload[k];
                    k++;
                  }
                  if (k < len) k++;
                  l2[m] = 0;
                  if (m > 0)
                  {
                    route_begin();
                    handle_line(l2);
                    route_end();
                  }
                }
              }
            }

            payload[len] = save;
            {
              char *tail = payload + len;
              uint16_t rest = (uint16_t)strlen(tail);
              memmove(buf, tail, rest);
              n = rest; buf[n] = 0;
            }
            continue;
          }
        }
      }
    }

    /* 断开 */
    if (g_phase == PH_CLIENT && strstr_P(buf, PSTR("CLOSED")) != NULL)
    {
      Serial.println(F("\n[WIFI] 电脑断开 -> 回阶段①"));
      g_espLinked = 0;
      g_espLink = -1;
      g_sendFail = 0;
      g_phase = PH_BOOTSTRAP;
      n = 0; buf[0] = 0;
      esp_bootstrap();
      continue;
    }

    if (n >= sizeof(buf) - 4 && strstr_P(buf, PSTR("+IPD,")) == NULL) { n = 0; buf[0] = 0; }
  }
}

/* ---------- WiFi 主状态机 ---------- */
static void esp_tick(void)
{
  uint32_t now = millis();

  /* 阶段② 运行中检测到 ESP 重启 → 从头再来 */
  if (g_espReboot && (g_phase == PH_CLIENT || g_phase == PH_BOOTSTRAP))
  {
    Serial.println(F("\n[WIFI] ESP 需要重建链路（重启过或没有 IP）"));
    g_espReboot = 0;
    g_espLinked = 0;
    g_espLink = -1;
    g_sendFail = 0;
    g_phase = PH_IDLE;
    delay(3000);   /* 多等一会，让电源恢复 */
    if (esp_wifi()) esp_bootstrap();
    return;
  }

  /* 阶段② 起点 */
  if (g_phase == PH_HANDOVER && g_havePc)
  {
    if (!esp_client())
    {
      delay(1500);
      esp_bootstrap();
    }
    return;
  }

  /* 阶段② 心跳 + 掉线回退 */
  if (g_phase == PH_CLIENT && (now - g_lastHb >= HEARTBEAT_MS))
  {
    g_lastHb = now;
    g_out = &g_espSink;
    g_espSink.resetBuf();
    g_espSink.print(F("PING\n"));
    g_espSink.flushBuf();
    if (g_sendFail >= 3)
    {
      Serial.println(F("\n[WIFI] 心跳连续失败 -> 回阶段①"));
      g_espLinked = 0;
      g_espLink = -1;
      g_sendFail = 0;
      g_phase = PH_BOOTSTRAP;
      esp_bootstrap();
    }
  }

  /* 阶段① 超时重开 */
  if (g_phase == PH_BOOTSTRAP && g_espLink < 0 && (now - g_tPhase > 60000UL))
  {
    esp_bootstrap();
  }
}


void setup()
{
  uint8_t mcusr = MCUSR;      /* 必须在一切之前读 */
  MCUSR = 0;

  Serial.begin(115200);
  delay(200);

  g_ms = millis();
  g_lastUsbMs = millis();

  /* ★★ 先把 ESP-01 起来（照 66 号的顺序），再初始化外设和 I2C ★★
   * 这样 SoftwareSerial 先占据时序，避免被 Wire/TWI 中断打乱。 */
  Serial.println(F("\n[WIFI] 启动 ESP-01（在 I2C 之前）..."));
  if (esp_wifi())
  {
    esp_bootstrap();
  }
  else
  {
    Serial.println(F("[WIFI] ESP 未就绪，仅用 USB 数据线"));
    g_phase = PH_ERROR;
  }
  Serial.print(F("[链路] 当前优先: "));
  Serial.println(link_name());
  Serial.println(F("[WIFI] ESP 阶段完成，开始初始化外设与 I2C ..."));

  Serial.println();
  Serial.print(F("=== RESET:0x"));
  Serial.print(mcusr, HEX);
  Serial.print(F("  "));
  if (mcusr & 0x08) Serial.print(F("WDRF=看门狗 "));
  if (mcusr & 0x04) Serial.print(F("BORF=欠压 "));
  if (mcusr & 0x02) Serial.print(F("EXTRF=外部 "));
  if (mcusr & 0x01) Serial.print(F("PORF=上电 "));
  Serial.println(F("==="));
  Serial.print(F("[WDT] 看门狗状态: "));
  Serial.println(WDT_ENABLE ? F("已开启") : F("已关闭(排查模式)"));

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
#if WDT_ENABLE
  wdt_enable(WDTO_2S);
#else
  wdt_disable();
#endif

  g_ldrBase = (uint16_t)analogRead(PIN_LDR);

  g_out->println();
  g_out->print(F("[握手] NANO-READY "));
  g_out->println(F(FW_TAG));
  g_out->println(F("[帮助] 发送 H 握手，? 查询状态，h 查看命令"));

  /* 开机扫描默认关闭：上拉不足时会在扫描阶段卡死。
   * 需要时用 ? 命令查在线数量，或把下面一行取消注释。 */
  /* i2c_scan_report(); */

  g_ms = millis();
  g_lastUsbMs = millis();
  Serial.print(F("[链路] 当前优先: "));
  Serial.println(link_name());
}

void loop()
{
  static char line[40];
  static uint8_t len = 0;
  static uint32_t lastRx = 0;
  static uint32_t lastHb = 0;
  static uint8_t lastBtn1 = 1, lastBtn2 = 1;

  g_ms = millis();
  WDT_FEED();                    /* 喂狗（WDT_ENABLE=0 时是空操作） */

  /* ---- 每 5 秒心跳：阶段 / 链路 / 剩余 RAM ---- */
  {
    static uint32_t lastHb2 = 0;
    if (millis() - lastHb2 >= 5000UL)
    {
      lastHb2 = millis();
      Serial.print(F("[HB] "));
      Serial.print(millis() / 1000);
      Serial.print(F("s 阶段="));
      Serial.print((int)g_phase);
      Serial.print(F(" 链="));
      Serial.print((int)g_espLinked);
      Serial.print(F(" fail="));
      Serial.print((int)g_sendFail);
      Serial.print(F(" RAM="));
      Serial.println(freeRam());
    }
  }

  /* ---- WiFi 通道轮询 ---- */
  if (g_phase != PH_ERROR) esp_poll();

  /* ---- USB 串口收命令 ---- */
  while (Serial.available())
  {
    char c = (char)Serial.read();
    g_lastPcRx = g_ms;
    g_lastUsbMs = g_ms;          /* ★ 记下 USB 有活动 = 数据线在用 */

    if (c == '\r') continue;
    if (c == '\n')
    {
      if (len > 0) { line[len] = 0; route_begin(); handle_line(line); route_end(); len = 0; }
      continue;
    }
    if (len < sizeof(line) - 1) line[len++] = c;
  }

  /* ---- 没有换行也执行（300ms 空闲） ---- */
  if (len > 0 && (g_ms - lastRx) > 300U && lastRx != 0)
  {
    line[len] = 0; route_begin(); handle_line(line); route_end(); len = 0;
  }
  if (len > 0) lastRx = g_ms;
  if (len == 0) lastRx = 0;

  /* ---- 主机在线检测 ---- */
  {
    uint8_t online = ((g_ms - g_lastPcRx) < 15000UL) ? 1U : 0U;
    if (online != g_hostOnline && g_lastPcRx != 0)
    {
      g_hostOnline = online;
      g_out->println(online ? F("[主机] 在线") : F("[主机] 离线"));
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
        g_out->println(F("[按钮] D3"));
        if (!g_hostOnline) { g_feedCount = 0; tm_show(0); }
      }
    }
    if (b2 != lastBtn2)
    {
      lastBtn2 = b2;
      if (b2 == LOW)
      {
        g_out->println(F("[按钮] D6"));
        if (!g_hostOnline)
        {
          motor(1, 1, g_pwm); delay(600); motor(0, 1, 0);
          g_feedCount++; tm_show(g_feedCount);
        }
      }
    }
  }

  /* ---- WiFi 状态机（阶段切换 / 心跳 / 掉线回退）---- */
  if (g_phase != PH_ERROR) esp_tick();

  delay(5);
}
