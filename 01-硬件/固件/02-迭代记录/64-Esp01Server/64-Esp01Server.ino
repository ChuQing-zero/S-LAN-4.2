/* ============================================================================
 *  64 · ESP-01 当服务器（电脑主动连它，不用知道电脑 IP）
 * ============================================================================
 *
 *  【为什么这样更好】
 *      原来：ESP 要知道电脑 IP  -> 电脑换热点 IP 变了就得重烧
 *      现在：ESP 用固定 IP 当服务器 -> 电脑主动连它 -> 永不用重烧
 *
 *  【工作原理】
 *      ① ESP 上电 -> 连 WiFi -> 设固定 IP 192.168.1.100
 *      ② AT+CIPMUX=1 + AT+CIPSERVER=1,8080  -> 开 8080 端口等连接
 *      ③ 电脑测试工具主动连 192.168.1.100:8080
 *      ④ 连上后双向收发；电脑可以发 "MYIP=..." 告诉 ESP 自己的地址（可选）
 *
 *  【串口（USB 115200）】
 *      上电自动跑，全程打印状态。
 *      你也可以在串口敲一行文字，会转发给电脑（先发 SHELL: 前缀）
 *
 *  【只改这一块配置】
 * ========================================================================== */

#include <Arduino.h>
#include <SoftwareSerial.h>

/* ==================== ★ 配置区 ★ ==================== */
#define WIFI_SSID       "YOUR_WIFI_SSID"              /* WiFi 名称 */
#define WIFI_PASS       "YOUR_WIFI_PASSWORD"           /* WiFi 密码 */

#define ESP_STATIC_IP   "192.168.1.100"     /* ★ ESP 自己的固定 IP（电脑连这个） */
#define ESP_GATEWAY     "192.168.1.1"
#define ESP_NETMASK     "255.255.255.0"

#define SERVER_PORT     8080                 /* ★ ESP 监听的端口 */
#define HEARTBEAT_MS    10000UL              /* 心跳间隔 */
/* ================================================ */

/* FEED 板：D10 = Nano->ESP（经分压），D12 = ESP->Nano */
#define PIN_ESP_RX   12
#define PIN_ESP_TX   10

SoftwareSerial esp(PIN_ESP_RX, PIN_ESP_TX);

static uint32_t g_baud = 115200;
static const uint32_t BAUDS[3] = { 115200UL, 9600UL, 74880UL };

static int8_t   g_link = -1;            /* 当前连接的 link id，-1 = 没连接 */
static bool     g_wifiOk = false;
static uint32_t g_lastHb = 0;
static uint32_t g_upSec = 0;

static char     g_pcIp[24] = "";        /* 电脑告诉我们的 IP（可选，仅记录） */
static uint16_t g_pcPort = 0;

/* ---------------- 等 ESP 关键字 ---------------- */
static uint8_t esp_wait_for(const char *key, uint32_t timeoutMs)
{
  uint32_t t0 = millis();
  char buf[180];
  uint8_t n = 0;
  buf[0] = 0;

  while (millis() - t0 < timeoutMs)
  {
    while (esp.available())
    {
      char c = (char)esp.read();

      if (n < sizeof(buf) - 1) buf[n++] = c;
      else { memmove(buf, buf + 40, n - 40); n -= 40; buf[n++] = c; }
      buf[n] = 0;

      if (c != '\r') Serial.print(c);
      if (strstr(buf, key) != NULL) return 1;
    }
    delay(5);
  }
  return 0;
}

/* ---------------- 发 AT 命令 ---------------- */
static uint8_t at_cmd(const char *cmd, const char *expect, uint32_t timeoutMs, uint8_t retries)
{
  uint8_t i;
  for (i = 0; i <= retries; i++)
  {
    Serial.print(F("\n>> "));
    Serial.print(cmd);

    while (esp.available()) esp.read();
    esp.print(cmd);
    esp.print("\r\n");

    if (esp_wait_for(expect, timeoutMs)) { Serial.print(F("   [OK]")); return 1; }
    Serial.print(F("   [retry]"));
    delay(500);
  }
  return 0;
}

/* ---------------- 探测波特率 ---------------- */
static uint8_t probe_esp(void)
{
  uint8_t i;
  Serial.println(F("\n--- probing ESP-01 ---"));
  for (i = 0; i < 3; i++)
  {
    g_baud = BAUDS[i];
    esp.begin(g_baud);
    delay(300);
    while (esp.available()) esp.read();
    Serial.print(F("  "));
    Serial.print(g_baud);
    Serial.print(F(" ... "));
    esp.print("AT\r\n");
    if (esp_wait_for("OK", 1200)) { Serial.println(F("OK")); return 1; }
    Serial.println(F("no reply"));
  }
  return 0;
}

/* ---------------- 给电脑发数据 ---------------- */
static void tcp_send(const char *data)
{
  char cmd[32];
  uint8_t len;

  if (g_link < 0) return;

  len = (uint8_t)strlen(data);
  if (len == 0) return;

  /* 多连接模式下必须 CIPSEND=<link>,<len> */
  snprintf(cmd, sizeof(cmd), "AT+CIPSEND=%d,%d", g_link, len);
  esp.print(cmd);
  esp.print("\r\n");

  /* 等 '>' */
  uint32_t t0 = millis();
  uint8_t got = 0;
  while (millis() - t0 < 2000)
  {
    while (esp.available())
    {
      char c = (char)esp.read();
      if (c == '>') { got = 1; break; }
    }
    if (got) break;
    delay(5);
  }
  if (!got) { Serial.println(F("  [send] no '>' prompt")); return; }

  esp.print(data);
  esp_wait_for("SEND OK", 2500);
}

/* ---------------- 全流程启动 ---------------- */
static uint8_t bring_up(void)
{
  char cmd[110];

  g_wifiOk = false;
  g_link = -1;

  Serial.println(F("\n====================================================="));
  Serial.println(F("  ESP-01 服务器模式启动"));
  Serial.println(F("====================================================="));

  if (!probe_esp())
  {
    Serial.println(F("  *** 探测不到 ESP-01 ***"));
    return 0;
  }

  at_cmd("ATE0", "OK", 1200, 1);

  /* STA 模式 */
  at_cmd("AT+CWMODE=1", "OK", 2000, 2);

  /* 连 WiFi */
  snprintf(cmd, sizeof(cmd), "AT+CWJAP=\"%s\",\"%s\"", WIFI_SSID, WIFI_PASS);
  Serial.print(F("\n  WiFi: ")); Serial.print(WIFI_SSID);
  Serial.println(F(" ... (最多 20 秒)"));
  if (!at_cmd(cmd, "OK", 20000, 1))
  {
    Serial.println(F("  *** 连不上 WiFi（检查 2.4GHz / 密码）***"));
    return 0;
  }
  g_wifiOk = true;

  /* 固定 IP */
  snprintf(cmd, sizeof(cmd), "AT+CIPSTA=\"%s\",\"%s\",\"%s\"",
           ESP_STATIC_IP, ESP_GATEWAY, ESP_NETMASK);
  if (!at_cmd(cmd, "OK", 4000, 1))
  {
    snprintf(cmd, sizeof(cmd), "AT+CIPSTA_CUR=\"%s\",\"%s\",\"%s\"",
             ESP_STATIC_IP, ESP_GATEWAY, ESP_NETMASK);
    at_cmd(cmd, "OK", 4000, 1);
  }

  at_cmd("AT+CWAUTOCONN=1", "OK", 2000, 0);

  /* ★ 多连接模式（开服务器必须） */
  at_cmd("AT+CIPMUX=1", "OK", 2000, 2);

  /* ★ 开服务器监听 8080 */
  snprintf(cmd, sizeof(cmd), "AT+CIPSERVER=1,%d", SERVER_PORT);
  if (!at_cmd(cmd, "OK", 3000, 2))
  {
    Serial.println(F("  *** 开服务器失败 ***"));
    return 0;
  }

  /* 查一下实际 IP 确认 */
  Serial.println();
  at_cmd("AT+CIFSR", "OK", 3000, 0);

  Serial.println(F("\n====================================================="));
  Serial.println(F("  *** 服务器已启动 ***"));
  Serial.print  (F("  电脑请连接: "));
  Serial.print  (F(ESP_STATIC_IP));
  Serial.print  (F(":"));
  Serial.println(SERVER_PORT);
  Serial.println(F("  等待电脑连接 ..."));
  Serial.println(F("====================================================="));
  return 1;
}

/* ---------------- 处理 ESP 发来的数据 ---------------- */
static void handle_esp_rx(void)
{
  static char buf[400];
  static uint16_t n = 0;

  while (esp.available())
  {
    char c = (char)esp.read();

    if (c != '\r')
    {
      if (n < sizeof(buf) - 1) buf[n++] = c;
      buf[n] = 0;
    }

    /* ---- 电脑连上来了： 0,CONNECT ---- */
    if (strstr(buf, "CONNECT") != NULL && strstr(buf, "0,CONNECT") != NULL)
    {
      g_link = 0;
      Serial.println(F("\n[+] 电脑已连接（link 0）"));
      g_lastHb = millis();
      tcp_send("WELCOME:ESP01-SERVER\n");
      n = 0; buf[0] = 0;
      continue;
    }

    /* ---- 电脑断开： 0,CLOSED ---- */
    if (strstr(buf, "CLOSED") != NULL)
    {
      Serial.println(F("\n[-] 电脑断开"));
      g_link = -1;
      n = 0; buf[0] = 0;
      continue;
    }

    /* ---- 收到数据： +IPD,<link>,<len>:<data> ---- */
    char *ipd = strstr(buf, "+IPD,");
    if (ipd != NULL && strchr(ipd, ':') != NULL)
    {
      char *colon = strchr(ipd, ':');
      if (colon != NULL)
      {
        /* 解析 link 和 len */
        int link = -1, len = 0;
        if (sscanf(ipd, "+IPD,%d,%d:", &link, &len) >= 2)
        {
          g_link = (int8_t)link;
        }

        char *payload = colon + 1;

        Serial.print(F("\n[PC->ESP] "));
        Serial.println(payload);

        /* 电脑告诉我们它的 IP（可选） */
        if (strncmp(payload, "MYIP=", 5) == 0)
        {
          char *slash = strchr(payload + 5, ':');
          uint8_t i = 0;
          if (slash != NULL)
          {
            uint8_t l = (uint8_t)(slash - (payload + 5));
            if (l > sizeof(g_pcIp) - 1) l = sizeof(g_pcIp) - 1;
            for (i = 0; i < l; i++) g_pcIp[i] = payload[5 + i];
            g_pcIp[i] = 0;
            g_pcPort = (uint16_t)atoi(slash + 1);
            Serial.print(F("        电脑地址已记录: "));
            Serial.print(g_pcIp);
            Serial.print(F(":"));
            Serial.println(g_pcPort);
          }
        }

        /* 收到 PING 回 PONG */
        if (strstr(payload, "PING") != NULL)
        {
          tcp_send("PONG\n");
        }

        n = 0; buf[0] = 0;
      }
    }

    if (n >= sizeof(buf) - 2) { n = 0; buf[0] = 0; }
  }
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
  Serial.println(F("  64-ESP01-SERVER   (电脑主动连它)"));
  Serial.println(F("  WiFi   : " WIFI_SSID));
  Serial.println(F("  my IP  : " ESP_STATIC_IP));
  Serial.print  (F("  port    : "));
  Serial.println(SERVER_PORT);
  Serial.println(F("====================================================="));

  Serial.println(F("  waiting ESP-01 boot (3s) ..."));
  delay(3000);

  bring_up();
}

void loop()
{
  static uint32_t lastSec = 0;

  handle_esp_rx();

  /* 每秒计时 + 每 30 秒打印状态 */
  if (millis() - lastSec >= 1000UL)
  {
    lastSec = millis();
    g_upSec++;
    if ((g_upSec % 30) == 0)
    {
      Serial.print(F("\n[状态] "));
      Serial.print(g_upSec);
      Serial.print(F("s  WiFi="));
      Serial.print(g_wifiOk ? F("OK") : F("--"));
      Serial.print(F("  PC="));
      Serial.print(g_link >= 0 ? F("已连接") : F("等待"));
      Serial.print(F("  baud="));
      Serial.println(g_baud);
    }
  }

  /* 心跳 */
  if (g_link >= 0 && (millis() - g_lastHb >= HEARTBEAT_MS))
  {
    g_lastHb = millis();
    tcp_send("PING\n");
    Serial.println(F("[心跳] PING"));
  }

  /* WiFi 掉了就重建 */
  if (!g_wifiOk && (g_upSec % 20) == 0 && g_upSec > 0)
  {
    static uint32_t lastTry = 0;
    if (millis() - lastTry > 20000UL)
    {
      lastTry = millis();
      Serial.println(F("\n[重试] 重建服务器 ..."));
      bring_up();
    }
  }

  delay(10);
}
