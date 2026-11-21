/* ============================================================================
 *  66 · ESP-01 两阶段交接（服务器 -> 客户端）
 * ============================================================================
 *
 *  【解决什么问题】
 *      不想在固件里硬编码「电脑的 IP」。电脑 IP 一变就得重烧，很烦。
 *
 *  【工作流程】
 *
 *      阶段 ①  引导（ESP 当服务器）
 *          ESP 连 WiFi，设固定 IP 192.168.1.100，开 8080 端口等人连
 *          电脑主动连 192.168.1.100:8080
 *          电脑发一行：  MYIP:192.168.1.143:9000
 *          ESP 收到，记下这个地址，回 ACK
 *
 *      阶段 ②  交接（ESP 当客户端）
 *          ESP 关掉服务器，主动连 192.168.1.143:9000
 *          （电脑此时已在自己 9000 端口等着）
 *          连上后正常双向通信、心跳、断线回到阶段 ①
 *
 *  【好处】
 *      固件里只有 ESP 自己的固定 IP，永远不用因为电脑换 IP 而重烧。
 *
 *  【配置区】
 * ========================================================================== */

#include <Arduino.h>
#include <SoftwareSerial.h>

/* ==================== ★ 配置区 ★ ==================== */
#define WIFI_SSID       "YOUR_WIFI_SSID"              /* WiFi 名称 */
#define WIFI_PASS       "YOUR_WIFI_PASSWORD"           /* WiFi 密码 */

#define ESP_STATIC_IP   "192.168.1.100"     /* ★ ESP 引导阶段的固定 IP */
#define ESP_GATEWAY     "192.168.1.1"
#define ESP_NETMASK     "255.255.255.0"

#define BOOTSTRAP_PORT  8080                 /* ★ 阶段① ESP 监听端口（电脑连这里） */

#define HEARTBEAT_MS    10000UL              /* 阶段② 心跳间隔 */
#define WAIT_MYIP_MS    60000UL              /* 阶段① 等电脑报地址的最长时间 */
/* ================================================ */

#define PIN_ESP_RX   12
#define PIN_ESP_TX   10

SoftwareSerial esp(PIN_ESP_RX, PIN_ESP_TX);

/* 阶段 */
#define PH_IDLE       0
#define PH_BOOTSTRAP  1     /* ESP 当服务器，等电脑连 */
#define PH_HANDOVER   2     /* 收到电脑地址，准备切换 */
#define PH_CLIENT     3     /* ESP 当客户端，已连电脑 */
#define PH_ERROR      4

static uint8_t  g_phase = PH_IDLE;
static uint32_t g_baud = 115200;
/* 9600 优先：已经把 ESP 转成 9600 的话，开机第一步就命中 */
static const uint32_t BAUDS[3] = { 9600UL, 115200UL, 74880UL };

static int8_t   g_link = -1;            /* 阶段① 的 link id */
static bool     g_wifiOk = false;

static char     g_pcIp[24] = "";
static uint16_t g_pcPort = 0;
static bool     g_havePc = false;

static uint32_t g_tPhase = 0;           /* 进入当前阶段的时间 */
static uint32_t g_lastHb = 0;
static uint8_t  g_sendFail = 0;      /* 连续发送失败次数 */
static uint32_t g_upSec = 0;

/* ---------------- 等关键字 ---------------- */
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

/* ---------------- 发 AT ---------------- */
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
    if (esp_wait_for(expect, timeoutMs)) { Serial.print(F("  [OK]")); return 1; }
    Serial.print(F("  [retry]"));
    delay(500);
  }
  return 0;
}

/* ---------------- 探测波特率 + 自动迁到 9600 ----------------
 *  AVR 的 SoftwareSerial 在 115200 误码率太高（AT 命令会乱码），
 *  所以：
 *    ① 先试 9600 —— 已经迁过的话直接就通
 *    ② 不行再试 115200 —— 通了就发 AT+UART_DEF=9600 把 ESP 永久改成 9600
 *    ③ 最后试 74880
 *  迁完写进 ESP 的 flash，以后开机就是 9600。
 * ------------------------------------------------------------------ */
static uint8_t probe_esp(void)
{
  uint8_t i;

  Serial.println(F("\n--- probing ESP-01 ---"));

  for (i = 0; i < 3; i++)
  {
    g_baud = BAUDS[i];
    esp.begin(g_baud);
    delay(400);
    while (esp.available()) esp.read();

    Serial.print(F("  "));
    Serial.print(g_baud);
    Serial.print(F(" ... "));

    esp.print("AT\r\n");
    if (!esp_wait_for("OK", 1500))
    {
      Serial.println(F("no reply"));
      continue;
    }

    Serial.println(F("OK"));

    /* 已经是 9600 —— 完成 */
    if (g_baud == 9600UL) return 1;

    /* 在 115200 / 74880 上通了，把它改成 9600 */
    Serial.println(F("  -> migrating ESP to 9600 baud ..."));
    while (esp.available()) esp.read();

    esp.print("AT+UART_DEF=9600,8,1,0,0\r\n");
    if (!esp_wait_for("OK", 3000))
    {
      Serial.println(F("  [warn] UART_DEF 没回 OK，继续用当前波特率"));
      return 1;
    }

    Serial.println(F("  [OK] ESP 已设为 9600，切换串口 ..."));
    delay(500);
    while (esp.available()) esp.read();

    g_baud = 9600UL;
    esp.begin(g_baud);
    delay(300);
    while (esp.available()) esp.read();

    esp.print("AT\r\n");
    if (esp_wait_for("OK", 2000))
    {
      Serial.println(F("  [OK] 9600 通信正常"));
      return 1;
    }

    Serial.println(F("  [warn] 9600 无回应，退回原波特率"));
    g_baud = BAUDS[i];
    esp.begin(g_baud);
    delay(300);
    while (esp.available()) esp.read();
    return 1;
  }

  return 0;
}

/* ---------------- 发数据 ----------------
 * 全程 CIPMUX=1，所以永远用 AT+CIPSEND=<link>,<len>
 * ------------------------------------------------------------------ */
static uint8_t tcp_send(const char *data)
{
  char cmd[32];
  uint8_t len = (uint8_t)strlen(data);
  if (len == 0) return 0;
  if (g_link < 0) return 0;

  snprintf(cmd, sizeof(cmd), "AT+CIPSEND=%d,%d", g_link, len);

  while (esp.available()) esp.read();

  esp.print(cmd);
  esp.print("\r\n");

  uint32_t t0 = millis();
  uint8_t got = 0;
  while (millis() - t0 < 2500)
  {
    while (esp.available())
    {
      char c = (char)esp.read();
      if (c == '>') { got = 1; break; }
    }
    if (got) break;
    delay(5);
  }
  if (!got) { Serial.println(F("  [send] 没等到 >")); return 0; }

  esp.print(data);
  return esp_wait_for("SEND OK", 3000);
}

/* ---------------- 连 WiFi + 设固定 IP ---------------- */
static uint8_t wifi_setup(void)
{
  char cmd[110];

  g_wifiOk = false;

  if (!probe_esp()) { Serial.println(F("  *** 探测不到 ESP-01 ***")); return 0; }

  at_cmd("ATE0", "OK", 1200, 1);
  at_cmd("AT+CWMODE=1", "OK", 2000, 2);

  snprintf(cmd, sizeof(cmd), "AT+CWJAP=\"%s\",\"%s\"", WIFI_SSID, WIFI_PASS);
  Serial.print(F("\n  WiFi: "));
  Serial.print(WIFI_SSID);
  Serial.println(F(" ... (最多 20 秒)"));
  if (!at_cmd(cmd, "OK", 20000, 1))
  {
    Serial.println(F("  *** 连不上 WiFi ***"));
    return 0;
  }

  snprintf(cmd, sizeof(cmd), "AT+CIPSTA=\"%s\",\"%s\",\"%s\"",
           ESP_STATIC_IP, ESP_GATEWAY, ESP_NETMASK);
  if (!at_cmd(cmd, "OK", 4000, 1))
  {
    snprintf(cmd, sizeof(cmd), "AT+CIPSTA_CUR=\"%s\",\"%s\",\"%s\"",
             ESP_STATIC_IP, ESP_GATEWAY, ESP_NETMASK);
    at_cmd(cmd, "OK", 4000, 1);
  }

  at_cmd("AT+CWAUTOCONN=1", "OK", 2000, 0);

  g_wifiOk = true;
  return 1;
}

/* ---------------- 阶段①：开服务器 ---------------- */
static uint8_t enter_bootstrap(void)
{
  char cmd[80];

  Serial.println(F("\n====================================================="));
  Serial.println(F("  阶段 ①：ESP 当服务器，等电脑连进来"));
  Serial.println(F("====================================================="));

  g_phase = PH_BOOTSTRAP;
  g_tPhase = millis();
  g_link = -1;
  g_havePc = false;
  g_pcIp[0] = 0;
  g_pcPort = 0;

  if (!g_wifiOk && !wifi_setup()) { g_phase = PH_ERROR; return 0; }

  /* 关掉可能残留的服务器/连接 */
  at_cmd("AT+CIPSERVER=0", "OK", 1500, 0);
  at_cmd("AT+CIPCLOSE=5", "OK", 1500, 0);
  at_cmd("AT+CIPMUX=1", "OK", 2000, 2);

  snprintf(cmd, sizeof(cmd), "AT+CIPSERVER=1,%d", BOOTSTRAP_PORT);
  if (!at_cmd(cmd, "OK", 3000, 2))
  {
    Serial.println(F("  *** 开服务器失败（固件太老？）***"));
    g_phase = PH_ERROR;
    return 0;
  }

  Serial.println();
  Serial.println(F("-----------------------------------------------------"));
  Serial.print  (F("  请让电脑连接: "));
  Serial.print  (F(ESP_STATIC_IP));
  Serial.print  (F(":"));
  Serial.println(BOOTSTRAP_PORT);
  Serial.println(F("  连上后电脑发一行:  MYIP:<电脑IP>:<端口>"));
  Serial.println(F("-----------------------------------------------------"));
  return 1;
}

/* ---------------- 阶段②：ESP 当客户端连电脑（保持 CIPMUX=1） ---------------- */
static uint8_t enter_client(void)
{
  char cmd[100];
  uint8_t i;

  Serial.println(F("\n====================================================="));
  Serial.println(F("  阶段 ②：ESP 主动连电脑"));
  Serial.print  (F("  目标: "));
  Serial.print  (g_pcIp);
  Serial.print  (F(":"));
  Serial.println(g_pcPort);
  Serial.println(F("====================================================="));

  g_phase = PH_HANDOVER;

  /* ① 先关服务器，不再接受新连接 */
  at_cmd("AT+CIPSERVER=0", "OK", 2000, 2);
  delay(200);

  /* ② 关掉电脑那条旧连接（link 0），释放出来 */
  at_cmd("AT+CIPCLOSE=0", "OK", 2000, 1);
  at_cmd("AT+CIPCLOSE=5", "OK", 2000, 1);    /* 5 = 全部关掉 */
  delay(600);

  /* ③ 保持多连接模式（绝不切 CIPMUX）*/
  at_cmd("AT+CIPMUX=1", "OK", 2000, 2);
  delay(200);

  /* ④ 用 link 4 主动连电脑（多连接模式必须带 link id） */
  for (i = 0; i < 3; i++)
  {
    snprintf(cmd, sizeof(cmd), "AT+CIPSTART=4,\"TCP\",\"%s\",%d", g_pcIp, g_pcPort);

    while (esp.available()) esp.read();
    Serial.print(F("\n>> "));
    Serial.print(cmd);
    esp.print(cmd);
    esp.print("\r\n");

    if (esp_wait_for("CONNECT", 9000))
    {
      Serial.print(F("  [OK]"));
      delay(250);
      while (esp.available()) esp.read();
      g_phase = PH_CLIENT;
      g_link  = 4;
      g_lastHb = millis();
      Serial.println(F("\n  *** 已连上电脑，进入正常通信 ***"));
      tcp_send("HELLO:ESP01\n");
      return 1;
    }

    Serial.print(F("  [失败, 重试 "));
    Serial.print(i + 1);
    Serial.print(F("/3]"));
    delay(1500);
  }

  Serial.println(F("\n  *** 连不上电脑（电脑服务器没开？防火墙？）***"));
  return 0;
}

/* ---------------- 解析电脑发的 MYIP ---------------- */
static uint8_t try_parse_myip(char *payload)
{
  char *p;
  char *colon;

  if (strncmp(payload, "MYIP", 4) != 0) return 0;

  /* 支持两种格式:  MYIP:1.2.3.4:9000   或   MYIP=1.2.3.4:9000 */
  p = payload + 4;
  while (*p == ':' || *p == '=' || *p == ' ') p++;

  colon = strchr(p, ':');
  if (colon == NULL) return 0;

  {
    uint8_t l = (uint8_t)(colon - p);
    uint8_t i;
    if (l == 0 || l > sizeof(g_pcIp) - 1) return 0;
    for (i = 0; i < l; i++) g_pcIp[i] = p[i];
    g_pcIp[i] = 0;
    g_pcPort = (uint16_t)atoi(colon + 1);
    if (g_pcPort == 0) return 0;
    g_havePc = true;

    Serial.println();
    Serial.print(F("  [收到电脑地址] "));
    Serial.print(g_pcIp);
    Serial.print(F(":"));
    Serial.println(g_pcPort);
    return 1;
  }
}

/* ---------------- 处理 ESP 输出 ----------------
 * 关键修复：+IPD 必须等"完整长度"到齐再解析。
 * 原来一见 ':' 就当成完整数据，结果只读到 "M"，MYIP 永远解析失败。
 * ------------------------------------------------------------------ */
static void handle_esp_rx(void)
{
  static char buf[450];
  static uint16_t n = 0;

  while (esp.available())
  {
    char c = (char)esp.read();

    if (c == '\r') continue;

    if (n < sizeof(buf) - 1)
    {
      buf[n++] = c;
      buf[n]   = '\0';
    }
    else
    {
      /* 缓冲满了，丢掉前 200 字节（保留尾部做匹配） */
      memmove(buf, buf + 200, n - 200);
      n -= 200;
      buf[n++] = c;
      buf[n]   = '\0';
    }

    /* ========== ① 阶段① 电脑连上来 ========== */
    if (g_phase == PH_BOOTSTRAP)
    {
      char *cn = strstr(buf, ",CONNECT");
      if (cn != NULL && cn > buf)
      {
        int id = atoi(cn - 1);
        if (id < 0 || id > 4) id = 0;
        g_link = (int8_t)id;

        Serial.println();
        Serial.print(F("[+] 电脑已连接（link "));
        Serial.print(g_link);
        Serial.println(F("）"));
        tcp_send("OK:WAITING_MYIP\n");
        g_tPhase = millis();
        n = 0; buf[0] = '\0';
        continue;
      }
    }

    /* ========== ② 收到数据 +IPD,<link>,<len>:<payload> ========== */
    {
      char *ipd = strstr(buf, "+IPD,");
      if (ipd != NULL)
      {
        char *colon = strchr(ipd, ':');
        if (colon == NULL)
        {
          /* 头还没收全，继续等 */
        }
        else
        {
          int link = -1;
          int len  = 0;
          char hdr[26];
          uint8_t hl = (uint8_t)(colon - ipd);
          char *payload;
          uint16_t alen;

          if (hl < sizeof(hdr))
          {
            memcpy(hdr, ipd, hl);
            hdr[hl] = '\0';
            if (sscanf(hdr, "+IPD,%d,%d", &link, &len) < 2)
            {
              link = -1;
              if (sscanf(hdr, "+IPD,%d", &len) != 1) len = 0;
            }
          }
          else
          {
            len = 0;
          }

          payload = colon + 1;
          alen    = (uint16_t)strlen(payload);

          /* ★ 必须收满 len 字节才算完整 ★ */
          if (len > 0 && alen >= (uint16_t)len)
          {
            char save = payload[len];
            payload[len] = '\0';

            if (link >= 0) g_link = (int8_t)link;

            Serial.println();
            Serial.print(F("[PC->ESP] "));
            Serial.println(payload);

            /* 关键：电脑报自己的地址 */
            if (g_phase == PH_BOOTSTRAP && try_parse_myip(payload))
            {
              tcp_send("OK:GOT_IT\n");
              delay(400);
              g_phase = PH_HANDOVER;
              payload[len] = save;
              n = 0; buf[0] = '\0';
              return;                          /* 交给主循环切阶段② */
            }

            if (strstr(payload, "PING") != NULL) tcp_send("PONG\n");

            payload[len] = save;

            /* 把这一段从缓冲里去掉 */
            {
              char *tail = payload + len;
              uint16_t rest = (uint16_t)strlen(tail);
              memmove(buf, tail, rest);
              n = rest;
              buf[n] = '\0';
            }
            continue;
          }
          /* 数据还没到齐，等下一个字符 */
        }
      }
    }

    /* ========== ③ 阶段② 电脑断开 ========== */
    if (g_phase == PH_CLIENT && strstr(buf, "CLOSED") != NULL)
    {
      Serial.println(F("\n[-] 电脑断开，回到阶段①"));
      g_phase = PH_BOOTSTRAP;
      g_link = -1;
      g_sendFail = 0;
      n = 0; buf[0] = '\0';
      enter_bootstrap();
      continue;
    }

    /* ========== ④ 缓冲里没用的东西太长就清掉 ========== */
    if (n >= sizeof(buf) - 4 && strstr(buf, "+IPD,") == NULL)
    {
      n = 0; buf[0] = '\0';
    }
  }
}


/* ---------------- 状态打印 ---------------- */
static void print_phase(void)
{
  Serial.print(F("\n[状态] "));
  Serial.print(g_upSec);
  Serial.print(F("s  阶段="));
  switch (g_phase)
  {
    case PH_BOOTSTRAP: Serial.print(F("①等电脑连")); break;
    case PH_HANDOVER:  Serial.print(F("交接中"));    break;
    case PH_CLIENT:    Serial.print(F("②已连电脑")); break;
    case PH_ERROR:     Serial.print(F("错误"));      break;
    default:           Serial.print(F("空闲"));      break;
  }
  Serial.print(F("  WiFi="));
  Serial.print(g_wifiOk ? F("OK") : F("--"));
  if (g_havePc)
  {
    Serial.print(F("  电脑="));
    Serial.print(g_pcIp);
    Serial.print(F(":"));
    Serial.print(g_pcPort);
  }
  Serial.print(F("  baud="));
  Serial.println(g_baud);
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
  Serial.println(F("  66-ESP01-HANDOVER   两阶段交接"));
  Serial.println(F("  阶段① ESP 服务器 8080 等电脑连"));
  Serial.println(F("  阶段② 收到电脑地址后 ESP 主动连过去"));
  Serial.print  (F("  WiFi : ")); Serial.println(F(WIFI_SSID));
  Serial.print  (F("  my IP: ")); Serial.println(F(ESP_STATIC_IP));
  Serial.println(F("====================================================="));

  Serial.println(F("  waiting ESP-01 boot (3s) ..."));
  delay(3000);

  enter_bootstrap();
}

/* ---------------- loop ---------------- */
void loop()
{
  static uint32_t lastSec = 0;

  handle_esp_rx();

  /* 阶段② 起点：收到电脑地址就切过去 */
  if (g_phase == PH_HANDOVER && g_havePc)
  {
    if (!enter_client())
    {
      /* 连不上就退回阶段① */
      delay(2000);
      g_wifiOk = false;          /* 强制重连 WiFi 一次更稳 */
      enter_bootstrap();
    }
  }

  /* 秒计时 */
  if (millis() - lastSec >= 1000UL)
  {
    lastSec = millis();
    g_upSec++;
    if ((g_upSec % 20) == 0) print_phase();
  }

  /* 阶段① 等太久没等到电脑地址，重开服务器 */
  if (g_phase == PH_BOOTSTRAP && g_link < 0 &&
      (millis() - g_tPhase > WAIT_MYIP_MS))
  {
    Serial.println(F("\n[超时] 一直没人连，重开服务器"));
    enter_bootstrap();
  }

  /* 阶段② 心跳 + 掉线自动退回阶段① */
  if (g_phase == PH_CLIENT && g_link >= 0 &&
      (millis() - g_lastHb >= HEARTBEAT_MS))
  {
    g_lastHb = millis();

    if (tcp_send("PING\n"))
    {
      g_sendFail = 0;
      Serial.println(F("[心跳] PING 成功"));
    }
    else
    {
      g_sendFail++;
      Serial.print(F("[心跳] PING 失败 "));
      Serial.print(g_sendFail);
      Serial.println(F("/2"));

      if (g_sendFail >= 2)
      {
        Serial.println(F("\n[掉线] 电脑那边没了，退回阶段①"));
        g_sendFail = 0;
        g_phase = PH_BOOTSTRAP;
        g_link  = -1;
        g_wifiOk = true;          /* WiFi 还是通的，不用重连 */
        enter_bootstrap();
      }
    }
  }

  delay(10);
}
