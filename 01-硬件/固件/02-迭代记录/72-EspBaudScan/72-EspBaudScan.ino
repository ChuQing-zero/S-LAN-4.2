/* ============================================================================
 *  72 · ESP-01 波特率全扫（极简版，不带任何外设）
 * ============================================================================
 *
 *  【为什么需要这个】
 *  之前一次乱码命令（AT+UART_DEF 被发成了垃圾）可能把 ESP-01 的串口
 *  配置改乱了，它现在停在一个未知波特率上。
 *  66/68/69 都只试 9600 / 115200 / 74880 三档，正好覆盖不到。
 *
 *  【这个程序做什么】
 *  ① 按从常见到罕见的顺序，扫 10 档波特率
 *  ② 每档发 3 次 AT，把 ESP 回来的原始字节打出来（可读字符直接显示，
 *     不可读的显示成 . 并附十六进制）
 *  ③ 找到能回 OK 的那一档后，进入「透传模式」，你可以在串口里直接敲 AT
 *  ④ 找到之后马上用 AT+UART_DEF 把它固定回 9600
 *
 *  【硬件】
 *  Nano D10 --(1k/2k 分压)--> ESP RXD
 *  Nano D12 <----------------  ESP TXD
 *  ESP 3.3V 独立供电，GND 共地
 *  串口监视器 115200
 * ========================================================================== */

#include <SoftwareSerial.h>

#define PIN_ESP_RX   12
#define PIN_ESP_TX   10

SoftwareSerial esp(PIN_ESP_RX, PIN_ESP_TX);

/* 扫描顺序：常见的放前面 */
static const uint32_t SCAN_BAUDS[] = {
  9600, 115200, 74880, 19200, 38400, 57600, 230400, 4800, 2400, 1200
};
#define SCAN_N  ((uint8_t)(sizeof(SCAN_BAUDS) / sizeof(SCAN_BAUDS[0])))

static uint32_t g_found = 0;      /* 找到的波特率，0 = 还没找到 */
static char     g_line[80];
static uint8_t  g_len = 0;

/* ---------------- 打印一个原始字节 ---------------- */
static void echo_byte(char c)
{
  if (c == '\n') { Serial.println(); return; }
  if (c == '\r') return;

  if (c >= 32 && c < 127)
  {
    Serial.print(c);
  }
  else
  {
    Serial.print(F("."));
  }
}

/* ---------------- 在某档波特率上试 3 次 AT ---------------- */
static uint8_t try_baud(uint32_t baud)
{
  uint8_t attempt;
  uint8_t gotOk = 0;

  Serial.print(F("  "));
  Serial.print(baud);
  Serial.print(F(" ... "));

  esp.begin(baud);
  delay(250);
  while (esp.available()) esp.read();

  for (attempt = 0; attempt < 3 && !gotOk; attempt++)
  {
    uint32_t t0;
    char buf[64];
    uint8_t n = 0;
    buf[0] = '\0';

    esp.print("AT\r\n");

    t0 = millis();
    while (millis() - t0 < 900)
    {
      while (esp.available())
      {
        char c = (char)esp.read();
        echo_byte(c);

        if (n < sizeof(buf) - 1) { buf[n++] = c; buf[n] = '\0'; }
        else { memmove(buf, buf + 20, n - 20); n -= 20; buf[n++] = c; buf[n] = '\0'; }

        if (strstr(buf, "OK") != NULL) { gotOk = 1; }
      }
      if (gotOk) break;
      delay(5);
    }
    if (!gotOk) Serial.print(F("|"));
  }

  if (gotOk) { Serial.println(F("  <<< OK 找到了 >>>")); return 1; }
  Serial.println(F(" x"));
  return 0;
}

/* ---------------- 扫描全部波特率 ---------------- */
static void scan_all(void)
{
  uint8_t i;

  Serial.println();
  Serial.println(F("====================================================="));
  Serial.println(F("  ESP-01 波特率全扫"));
  Serial.println(F("  共 10 档，每档试 3 次 AT，约 30 秒"));
  Serial.println(F("====================================================="));

  for (i = 0; i < SCAN_N; i++)
  {
    if (try_baud(SCAN_BAUDS[i]))
    {
      g_found = SCAN_BAUDS[i];
      break;
    }
  }

  Serial.println(F("-----------------------------------------------------"));
  if (g_found == 0)
  {
    Serial.println(F("  *** 10 档全部没有回应 ***"));
    Serial.println(F("  1) ESP 的 3.3V 供电是否真的加上了？量一下电压"));
    Serial.println(F("  2) GND 是否和 Arduino 共地？"));
    Serial.println(F("  3) ESP TXD 是否接到了 D12？RXD 是否经分压接到 D10？"));
    Serial.println(F("  4) 拔掉 ESP 电源等 5 秒再上电，看有没有启动乱码"));
    Serial.println(F("  5) 若有乱码但扫不到，把乱码发我（可反推波特率）"));
  }
  else
  {
    Serial.print(F("  >>> 找到波特率: "));
    Serial.println(g_found);
    Serial.println(F("  现在可以敲 AT 了（透传模式），回车发送"));
    Serial.println(F("  建议依次敲："));
    Serial.println(F("      AT+GMR            (看固件版本)"));
    Serial.println(F("      AT+UART_DEF=9600,8,1,0,0   (固定回 9600)"));
    Serial.println(F("      AT+RST            (重启生效)"));
  }
  Serial.println(F("-----------------------------------------------------"));
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
  Serial.println(F("  72-ESP01-BAUDSCAN"));
  Serial.println(F("  Nano D10 -> 1k/2k -> ESP RXD"));
  Serial.println(F("  Nano D12 <-          ESP TXD"));
  Serial.println(F("====================================================="));

  Serial.println(F("  等 ESP 上电稳定 3 秒 ..."));
  delay(3000);

  scan_all();

  if (g_found != 0)
  {
    esp.begin(g_found);
  }
}

/* ---------------- loop：透传到 ESP ---------------- */
void loop()
{
  /* ESP -> 串口 */
  while (esp.available())
  {
    char c = (char)esp.read();
    if (c == '\r') continue;
    Serial.print(c);
  }

  /* 串口 -> ESP（一行一行发） */
  while (Serial.available())
  {
    char c = (char)Serial.read();

    if (c == '\r') continue;

    if (c == '\n')
    {
      if (g_len > 0)
      {
        uint8_t i;
        g_line[g_len] = '\0';
        if (g_found != 0)
        {
          for (i = 0; i < g_len; i++) esp.print(g_line[i]);
          esp.print("\r\n");
        }
        else
        {
          Serial.println(F("[提示] 还没找到波特率，敲 /scan 重新扫描"));
        }
        g_len = 0;
      }
      continue;
    }

    if (g_len < sizeof(g_line) - 1) g_line[g_len++] = c;
  }

  /* 300ms 空闲也发出去 */
  {
    static uint32_t lastRx = 0;
    if (g_len > 0) lastRx = millis();
    if (g_len > 0 && (millis() - lastRx) > 300U)
    {
      uint8_t i;
      g_line[g_len] = '\0';
      if (g_found != 0)
      {
        for (i = 0; i < g_len; i++) esp.print(g_line[i]);
        esp.print("\r\n");
      }
      g_len = 0;
    }
  }

  delay(5);
}
