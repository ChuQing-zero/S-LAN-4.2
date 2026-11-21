/* ============================================================================
 *  63 · ESP-01 自动连接（上电即连电脑，全自动）
 * ============================================================================
 *
 *  【做什么】
 *  烧进 Nano 后，只要给板子上电，它会自动：
 *      ① 唤醒并检测 ESP-01（自动试 115200 / 9600 / 74880）
 *      ② AT+CWMODE=1        设为 STA 模式
 *      ③ AT+CWJAP="YOUR_WIFI_SSID","YOUR_WIFI_PASSWORD"   连接指定 WiFi
 *      ④ AT+CIPSTA="固定IP"  设静态 IP（方便电脑找）
 *      ⑤ AT+CIPMUX=0        单连接模式
 *      ⑥ AT+CIPSTART="TCP","电脑IP",端口   连到电脑
 *      ⑦ 之后自动收发数据；断线会自动重连
 *
 *  【你只需要改下面这一块配置】
 * ========================================================================== */

#include <Arduino.h>
#include <SoftwareSerial.h>

/* ==================== ★ 配置区（按需修改） ★ ==================== */
#define WIFI_SSID       "YOUR_WIFI_SSID"              /* WiFi 名称 */
#define WIFI_PASS       "YOUR_WIFI_PASSWORD"           /* WiFi 密码 */

#define PC_IP           "192.168.1.143"     /* 电脑的 IP（跑测试工具那台） */
#define PC_PORT         8080                 /* 电脑监听端口 */

#define ESP_STATIC_IP   "192.168.1.100"     /* 给 ESP 的固定 IP */
#define ESP_GATEWAY     "192.168.1.1"       /* 网关（一般同网段 .1） */
#define ESP_NETMASK     "255.255.255.0"

#define HEARTBEAT_MS    10000UL              /* 每 10 秒给电脑发一次心跳 */
#define RECONNECT_MS    15000UL              /* 断线后每 15 秒重试一次 */
/* ================================================================ */

/* FEED 板网表：D10 = Nano->ESP（经 1K/2K 分压），D12 = ESP->Nano */
#define PIN_ESP_RX   12
#define PIN_ESP_TX   10

SoftwareSerial esp(PIN_ESP_RX, PIN_ESP_TX);

static uint32_t g_baud = 115200;
static const uint32_t BAUDS[3] = { 115200UL, 9600UL, 74880UL };

static bool g_wifiOk   = false;
static bool g_tcpOk    = false;
static uint32_t g_lastHb = 0;
static uint32_t g_lastTry = 0;
static uint32_t g_upSec = 0;

/* ---------------- 基础输出 ---------------- */
#define LOG(x)      do { Serial.print(x); } while (0)
#define LOGLN(x)    do { Serial.println(x); } while (0)

/* ---------------- 读 ESP 直到出现关键字 ---------------- */
/* 返回 1=找到目标关键字, 0=超时 */
static uint8_t esp_wait_for(const char *key, uint32_t timeoutMs)
{
  uint32_t t0 = millis();
  char buf[160];
  uint8_t n = 0;

  buf[0] = '\0';

  while (millis() - t0 < timeoutMs)
  {
    while (esp.available())
    {
      char c = (char)esp.read();

      /* 累积到缓冲里做关键字匹配（保留最后 120 字节） */
      if (n < sizeof(buf) - 1) buf[n++] = c;
      else
      {
        memmove(buf, buf + 40, n - 40);
        n -= 40;
        buf[n++] = c;
      }
      buf[n] = '\0';

      /* 回显（去掉 \r） */
      if (c != '\r') Serial.print(c);

      if (strstr(buf, key) != NULL) return 1;

      /* 出错立即返回，避免白等 */
      if (strstr(buf, "ERROR") != NULL || strstr(buf, "FAIL") != NULL)
      {
        if (strstr(buf, key) == NULL) return 0;
      }
    }
    delay(5);
  }
  return 0;
}

/* ---------------- 发 AT 命令并等回应 ---------------- */
static uint8_t at_cmd(const char *cmd, const char *expect, uint32_t timeoutMs, uint8_t retries)
{
  uint8_t i;

  for (i = 0; i <= retries; i++)
  {
    Serial.print(F("\n>> "));
    Serial.print(cmd);

    while (esp.available()) esp.read();      /* 清空残留 */

    esp.print(cmd);
    esp.print("\r\n");

    if (esp_wait_for(expect, timeoutMs))
    {
      Serial.print(F("   [OK]"));
      return 1;
    }
    Serial.print(F("   [timeout, retry "));
    Serial.print(i + 1);
    Serial.print(F("/"));
    Serial.print(retries + 1);
    Serial.print(F("]"));
    delay(600);
  }
  return 0;
}

/* ---------------- 探测 ESP 波特率 ---------------- */
static uint8_t probe_esp(void)
{
  uint8_t i;

  Serial.println(F("\n--- probing ESP-01 baud ---"));

  for (i = 0; i < 3; i++)
  {
    g_baud = BAUDS[i];
    esp.begin(g_baud);
    delay(300);
    while (esp.available()) esp.read();

    Serial.print(F("  try "));
    Serial.print(g_baud);
    Serial.print(F(" ... "));

    esp.print("AT\r\n");
    if (esp_wait_for("OK", 1200))
    {
      Serial.println(F("OK"));
      return 1;
    }
    Serial.println(F("no reply"));
  }
  return 0;
}

/* ---------------- 建立 TCP 连接 ---------------- */
static uint8_t open_tcp(void)
{
  char cmd[80];

  snprintf(cmd, sizeof(cmd), "AT+CIPSTART=\"TCP\",\"%s\",%d", PC_IP, PC_PORT);

  while (esp.available()) esp.read();
  Serial.print(F("\n>> "));
  Serial.print(cmd);

  esp.print(cmd);
  esp.print("\r\n");

  /* CONNECT 成功后 ESP 会回 CONNECT + OK；已连接会回 ALREADY CONNECT */
  if (esp_wait_for("CONNECT", 8000))
  {
    Serial.print(F("   [OK]"));
    delay(300);
    while (esp.available()) esp.read();
    return 1;
  }
  Serial.print(F("   [FAIL]"));
  return 0;
}

/* ---------------- 全流程启动 ---------------- */
static uint8_t bring_up(void)
{
  char cmd[96];

  g_wifiOk = false;
  g_tcpOk  = false;

  Serial.println(F("\n====================================================="));
  Serial.println(F("  ESP-01 自动连接流程"));
  Serial.println(F("====================================================="));

  /* ① 探测波特率 */
  if (!probe_esp())
  {
    Serial.println(F("  *** 探测不到 ESP-01 ***"));
    Serial.println(F("      检查: 3.3V 供电 / EN 接 3.3V / D10-D12 接线"));
    return 0;
  }

  /* ② 关回显，输出更干净 */
  at_cmd("ATE0", "OK", 1200, 1);

  /* ③ STA 模式 */
  at_cmd("AT+CWMODE=1", "OK", 2000, 2);

  /* ④ 连接 WiFi */
  snprintf(cmd, sizeof(cmd), "AT+CWJAP=\"%s\",\"%s\"", WIFI_SSID, WIFI_PASS);
  Serial.print(F("\n  WiFi: "));
  Serial.print(WIFI_SSID);
  Serial.println(F(" ... (最多等 20 秒)"));

  if (!at_cmd(cmd, "OK", 20000, 1))
  {
    Serial.println(F("  *** 连不上 WiFi ***"));
    Serial.println(F("      检查: 热点是否 2.4GHz / 密码是否正确 / 名字有没有中文"));
    return 0;
  }
  g_wifiOk = true;

  /* ⑤ 设静态 IP */
  snprintf(cmd, sizeof(cmd), "AT+CIPSTA=\"%s\",\"%s\",\"%s\"",
           ESP_STATIC_IP, ESP_GATEWAY, ESP_NETMASK);
  if (!at_cmd(cmd, "OK", 4000, 1))
  {
    /* 老固件用 _CUR */
    snprintf(cmd, sizeof(cmd), "AT+CIPSTA_CUR=\"%s\",\"%s\",\"%s\"",
             ESP_STATIC_IP, ESP_GATEWAY, ESP_NETMASK);
    at_cmd(cmd, "OK", 4000, 1);
  }

  /* ⑥ 上电自动重连 WiFi */
  at_cmd("AT+CWAUTOCONN=1", "OK", 2000, 0);

  /* ⑦ 单连接模式 */
  at_cmd("AT+CIPMUX=0", "OK", 2000, 1);

  /* ⑧ 连电脑 */
  g_tcpOk = open_tcp();

  if (g_tcpOk)
  {
    Serial.println(F("\n====================================================="));
    Serial.println(F("  *** 全部成功，已连接到电脑 ***"));
    Serial.println(F("====================================================="));
    g_lastHb = millis();
  }
  else
  {
    Serial.println(F("\n  连上 WiFi 但没连上电脑（TCP）"));
    Serial.println(F("  检查: 电脑测试工具是否在跑 / 防火墙是否挡住 8080"));
  }

  return g_tcpOk;
}

/* ---------------- 给电脑发数据 ---------------- */
static void tcp_send(const char *data)
{
  char cmd[32];
  uint8_t len = (uint8_t)strlen(data);

  if (!g_tcpOk) return;

  snprintf(cmd, sizeof(cmd), "AT+CIPSEND=%d", len);
  esp.print(cmd);
  esp.print("\r\n");

  /* 等 '>' 提示符 */
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

  if (!got)
  {
    Serial.println(F("  [send] 没等到 > 提示符"));
    return;
  }

  esp.print(data);

  /* 等 SEND OK */
  esp_wait_for("SEND OK", 2500);
}

/* ---------------- 处理 ESP 发来的数据 ---------------- */
static void handle_esp_rx(void)
{
  static char buf[300];
  static uint16_t n = 0;

  while (esp.available())
  {
    char c = (char)esp.read();

    if (c != '\r') buf[n < sizeof(buf) - 1 ? n++ : 0] = c;
    if (n < sizeof(buf)) buf[n] = '\0';

    /* ESP 主动断开 */
    if (strstr(buf, "CLOSED") != NULL)
    {
      Serial.println(F("\n[!] 电脑端断开，准备重连"));
      g_tcpOk = false;
      n = 0;
      g_lastTry = millis();
      return;
    }

    /* 收到 +IPD,<len>:<data> —— 打印机把 data 提出来 */
    if (strstr(buf, "+IPD,") != NULL && (c == '\n' || n >= sizeof(buf) - 2))
    {
      char *p = strstr(buf, "+IPD,");
      if (p)
      {
        char *colon = strchr(p, ':');
        if (colon)
        {
          Serial.print(F("\n[PC->ESP] "));
          Serial.println(colon + 1);

          /* 收到 PING 就立刻回 PONG */
          if (strstr(colon + 1, "PING") != NULL)
          {
            tcp_send("PONG\n");
          }
        }
      }
      n = 0;
      buf[0] = '\0';
    }

    /* 缓冲快满时清一次 */
    if (n >= sizeof(buf) - 2)
    {
      n = 0;
      buf[0] = '\0';
    }
  }
}

/* ---------------- setup ---------------- */
void setup()
{
  Serial.begin(115200);
  delay(300);

  pinMode(PIN_ESP_RX, INPUT);
  pinMode(PIN_ESP_TX, OUTPUT);

  Serial.println();
  Serial.println(F("====================================================="));
  Serial.println(F("  63-ESP01-AUTO-CONNECT"));
  Serial.println(F("  Nano D10 -> 1K/2K -> ESP RX"));
  Serial.println(F("  Nano D12 <-          ESP TX"));
  Serial.println(F("====================================================="));
  Serial.print(F("  WiFi : "));  Serial.println(F(WIFI_SSID));
  Serial.print(F("  PC   : "));  Serial.print(F(PC_IP));
  Serial.print(F(":"));          Serial.println(PC_PORT);
  Serial.print(F("  my IP: "));  Serial.println(F(ESP_STATIC_IP));
  Serial.println(F("====================================================="));

  /* ESP-01 上电需要时间，多等一会 */
  Serial.println(F("  waiting ESP-01 boot (3s) ..."));
  delay(3000);

  bring_up();
}

/* ---------------- loop ---------------- */
void loop()
{
  static uint32_t lastSec = 0;

  /* 处理 ESP 发来的数据 */
  handle_esp_rx();

  /* 每秒打印一次运行时间 */
  if (millis() - lastSec >= 1000UL)
  {
    lastSec = millis();
    g_upSec++;
    if ((g_upSec % 30) == 0)
    {
      Serial.print(F("\n[状态] 运行 "));
      Serial.print(g_upSec);
      Serial.print(F("s  WiFi="));
      Serial.print(g_wifiOk ? F("OK") : F("--"));
      Serial.print(F("  TCP="));
      Serial.print(g_tcpOk ? F("OK") : F("--"));
      Serial.print(F("  baud="));
      Serial.print(g_baud);
      Serial.println();
    }
  }

  /* 心跳：给电脑发 PING，电脑回 PONG（也证明链路通） */
  if (g_tcpOk && (millis() - g_lastHb >= HEARTBEAT_MS))
  {
    g_lastHb = millis();
    tcp_send("PING\n");
    Serial.println(F("[心跳] 已发 PING"));
  }

  /* 断线重连 */
  if (!g_tcpOk && (millis() - g_lastTry >= RECONNECT_MS))
  {
    g_lastTry = millis();
    Serial.println(F("\n[重连] 尝试重新建立 TCP ..."));

    if (!g_wifiOk)
    {
      bring_up();          /* WiFi 都掉了，整个流程重来 */
    }
    else
    {
      at_cmd("AT+CIPMUX=0", "OK", 1500, 0);
      g_tcpOk = open_tcp();
      if (g_tcpOk) g_lastHb = millis();
    }
  }

  delay(10);
}
