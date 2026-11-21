/* ============================================================================
 *  60 · ESP-01 (ESP8266) 连接测试
 * ============================================================================
 *
 *  【用途】
 *  单独测试 ESP-01 WiFi 模块能不能通信、能不能连 WiFi、能不能连 TCP 服务器。
 *  只烧到进料 Nano，其他外设全部不涉及。
 *
 *  【FEED 板接线（网表）】
 *      Nano D10 -----> 1K/2K 分压 -----> ESP-01 RX   （Nano 发，ESP 收，必须分压！）
 *      Nano D12 <----- 直连 ----------- ESP-01 TX   （ESP 发，Nano 收）
 *      Nano +3.3V --------------------- ESP-01 VCC  （ESP 必须 3.3V，5V 会烧）
 *      Nano GND ----------------------- ESP-01 GND
 *      ESP-01 CH_PD/EN ----------------+ 3.3V（必须拉高，否则不启动）
 *
 *  ⚠ ESP-01 电流峰值 ~300mA，Nano 的 3.3V 输出可能不够
 *     如果一直没响应，先给 ESP-01 单独接一个 3.3V 电源（GND 共地）
 *
 *  【串口（USB，115200）】
 *      上电自动跑测试：
 *        1) 扫波特率 115200 / 9600 / 74880
 *        2) AT           -> 期望 OK
 *        3) AT+GMR       -> 固件版本
 *        4) AT+CWMODE?   -> 当前模式
 *        5) AT+CWLAP     -> 扫描附近 WiFi
 *
 *      然后进入手动模式，你敲什么就原样发给 ESP-01，ESP 回什么就打印什么：
 *        at            发 AT 命令
 *        /115200       切换波特率
 *        /9600
 *        /reset        复位 ESP-01（AT+RST）
 *        /info         再查一次 AT+GMR
 *        /scan         扫 WiFi
 *        /join ssid pass   连 WiFi
 *        /tcp ip port      建 TCP 连接
 *        /help         帮助
 *
 *  【判断】
 *      看到 "OK" 或 "ready"  -> 接线和波特率都对
 *      什么都没有            -> 检查 EN 拉高 / 供电 / TX-RX 是否交叉
 *      乱码                  -> 波特率不对，换 /9600 或 /74880 试
 * ========================================================================== */

#include <Arduino.h>
#include <SoftwareSerial.h>

/* FEED 板网表：D10 = Nano->ESP（经分压），D12 = ESP->Nano */
#define PIN_ESP_RX      12      /* ESP 的 TX -> Nano D12（Nano 收） */
#define PIN_ESP_TX      10      /* Nano D10 -> 分压 -> ESP RX（Nano 发） */

SoftwareSerial esp(PIN_ESP_RX, PIN_ESP_TX);

static uint32_t g_baud = 115200;
static const uint32_t BAUDS[3] = { 115200UL, 9600UL, 74880UL };

/* ---------------- 工具 ---------------- */
static void pc_puts(const char *s) { Serial.print(s); }

static void pc_line(void) { Serial.println(); }

/* 从 ESP 读一段时间，原样打印到 USB 串口；返回读到的字节数 */
static uint16_t esp_dump(uint32_t ms)
{
  uint16_t n = 0;
  uint32_t t0 = millis();
  while (millis() - t0 < ms)
  {
    while (esp.available())
    {
      char c = (char)esp.read();
      if (c == '\r') continue;
      if (c == '\n') { Serial.println(); }
      else           { Serial.print(c); }
      n++;
    }
    delay(2);
  }
  return n;
}

/* 发一条 ESP 命令（自动补 \r\n）并收回应 */
static uint16_t esp_cmd(const char *cmd, uint32_t waitMs)
{
  Serial.print(F(">> "));
  Serial.println(cmd);

  esp.print(cmd);
  esp.print("\r\n");

  uint16_t n = esp_dump(waitMs);
  Serial.println();

  Serial.print(F("   [bytes: "));
  Serial.print(n);
  Serial.println(F("]"));
  return n;
}

static void show_baud(void)
{
  Serial.print(F("  current baud = "));
  Serial.println(g_baud);
}

static void set_baud(uint32_t b)
{
  g_baud = b;
  esp.begin(b);
  delay(50);
  Serial.print(F("  switched to "));
  Serial.println(b);
}

/* ---------------- 自动探测 ---------------- */
static void auto_probe(void)
{
  uint8_t i;
  uint16_t n;

  Serial.println(F("====================================================="));
  Serial.println(F("  auto probing ESP-01 ..."));
  Serial.println(F("====================================================="));

  for (i = 0; i < 3; i++)
  {
    Serial.print(F("\n--- try baud "));
    Serial.print(BAUDS[i]);
    Serial.println(F(" ---"));

    set_baud(BAUDS[i]);
    delay(300);
    /* 丢掉之前缓冲的垃圾 */
    while (esp.available()) esp.read();

    n = esp_cmd("AT", 1200);

    if (n > 0)
    {
      Serial.print(F("  *** GOT REPLY at "));
      Serial.print(BAUDS[i]);
      Serial.println(F(" ***"));
      return;
    }
  }

  Serial.println(F("\n  *** NO REPLY on any baud ***"));
  Serial.println(F("  check list:"));
  Serial.println(F("    1. ESP-01 VCC = 3.3V (NOT 5V)"));
  Serial.println(F("    2. ESP-01 EN / CH_PD tied to 3.3V"));
  Serial.println(F("    3. ESP TX -> Nano D12     ESP RX <- 1K/2K <- Nano D10"));
  Serial.println(F("    4. common ground"));
  Serial.println(F("    5. ESP-01 needs ~300mA, try external 3.3V supply"));
}

/* ---------------- 手动命令 ---------------- */
static void handle_pc_line(char *line)
{
  if (line[0] == '/')
  {
    /* ---- 斜杠命令 ---- */
    if (strcmp(line, "/help") == 0)
    {
      Serial.println(F("  /help           this"));
      Serial.println(F("  /115200         switch baud"));
      Serial.println(F("  /9600"));
      Serial.println(F("  /74880"));
      Serial.println(F("  /reset          AT+RST"));
      Serial.println(F("  /info           AT+GMR"));
      Serial.println(F("  /scan           AT+CWLAP"));
      Serial.println(F("  /mode           AT+CWMODE?"));
      Serial.println(F("  /join ssid pass"));
      Serial.println(F("  /tcp ip port"));
      Serial.println(F("  /probe          auto probe again"));
      Serial.println(F("  anything else   sent to ESP as-is (add AT prefix yourself)"));
      return;
    }
    if (strcmp(line, "/115200") == 0) { set_baud(115200); return; }
    if (strcmp(line, "/9600")   == 0) { set_baud(9600);   return; }
    if (strcmp(line, "/74880")  == 0) { set_baud(74880);  return; }
    if (strcmp(line, "/reset")  == 0) { esp_cmd("AT+RST", 3000); return; }
    if (strcmp(line, "/info")   == 0) { esp_cmd("AT+GMR", 2000); return; }
    if (strcmp(line, "/scan")   == 0) { esp_cmd("AT+CWLAP", 8000); return; }
    if (strcmp(line, "/mode")   == 0) { esp_cmd("AT+CWMODE?", 1500); return; }
    if (strcmp(line, "/probe")  == 0) { auto_probe(); return; }

    if (strncmp(line, "/join ", 6) == 0)
    {
      char cmd[100];
      snprintf(cmd, sizeof(cmd), "AT+CWJAP=\"%s\"", line + 6);
      esp_cmd(cmd, 15000);
      return;
    }
    if (strncmp(line, "/tcp ", 5) == 0)
    {
      char cmd[100];
      snprintf(cmd, sizeof(cmd), "AT+CIPSTART=\"TCP\",\"%s\"", line + 5);
      esp_cmd(cmd, 8000);
      return;
    }

    Serial.println(F("  unknown /command, type /help"));
    return;
  }

  /* ---- 普通行：原样发给 ESP ---- */
  if (line[0] != '\0')
  {
    esp_cmd(line, 3000);
  }
}

/* ---------------- 读一行（不用按回车也行） ---------------- */
static uint8_t read_line(char *buf, uint8_t maxlen)
{
  static uint8_t len = 0;
  static uint32_t last = 0;

  while (Serial.available())
  {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n')
    {
      if (len > 0) { buf[len] = 0; uint8_t r = len; len = 0; return r; }
      continue;
    }
    if (len < maxlen - 1) { buf[len++] = c; last = millis(); }
  }

  if (len > 0 && (millis() - last) > 400)
  {
    buf[len] = 0;
    uint8_t r = len;
    len = 0;
    return r;
  }
  return 0;
}

/* ---------------- setup / loop ---------------- */
void setup()
{
  Serial.begin(115200);
  delay(300);

  pinMode(PIN_ESP_RX, INPUT);
  pinMode(PIN_ESP_TX, OUTPUT);

  Serial.println();
  Serial.println(F("====================================================="));
  Serial.println(F("  60-ESP01-TEST"));
  Serial.println(F("  Nano D10 -> 1K/2K -> ESP RX"));
  Serial.println(F("  Nano D12 <-          ESP TX"));
  Serial.println(F("  ESP VCC = 3.3V   EN = 3.3V   common GND"));
  Serial.println(F("====================================================="));
  show_baud();

  auto_probe();

  Serial.println();
  Serial.println(F("-----------------------------------------------------"));
  Serial.println(F("  manual mode: type AT commands, or /help"));
  Serial.println(F("-----------------------------------------------------"));
  Serial.print(F("> "));
}

void loop()
{
  static char line[128];
  uint8_t n;

  /* ESP 主动发来的数据（比如 WiFi 断开通知）实时转出来 */
  while (esp.available())
  {
    char c = (char)esp.read();
    if (c == '\r') continue;
    if (c == '\n') Serial.println();
    else           Serial.print(c);
  }

  n = read_line(line, sizeof(line));
  if (n == 0) { delay(5); return; }

  Serial.print(F("> "));
  Serial.println(line);

  handle_pc_line(line);

  Serial.print(F("> "));
}
