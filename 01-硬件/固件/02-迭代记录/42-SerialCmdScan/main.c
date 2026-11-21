/* ============================================================================
 *  42 · 串口命令控制扫码（不用 I²C）
 * ============================================================================
 *
 *  你在 H2 排针（TTL）上敲一个字符，STM32 就执行对应动作，结果立刻打印回来。
 *
 *  接线：
 *      TTL 的 RX  ->  H2 脚2（PA9，STM32 的 TX）
 *      TTL 的 GND ->  H2 脚1（GND）
 *      串口助手：115200 8N1，行结尾「Newline」
 *
 *  扫码模块（CN1）：
 *      CN1 脚1 -> 模块 TR（可不接）
 *      CN1 脚2 -> 模块 GND    ← 必须
 *      CN1 脚3 -> 模块 RX
 *      CN1 脚4 -> 模块 TX     ← 关键，数据从这里进来
 *      CN1 脚5 -> 模块 VCC 3.3V
 *
 *  命令：
 *      s    触发扫码，拉低 TR 等 3 秒，收到数据立刻打印
 *      n    不拉 TR，纯监听 3 秒（模块自动输出型用这个）
 *      p    只拉低 TR 3 秒，不收数据（测触发脚）
 *      ?    帮助
 *
 *  指示灯：
 *      LED3 (PA11)  正在扫
 *      LED1 (PB14)  收到过数据，常亮
 *      LED2 (PB15)  超时
 * ========================================================================== */

#include "stm32f10x.h"

/* ---------------------------------------------------------------- 延时 */
static void delay_ms(uint32_t ms)
{
  volatile uint32_t n;
  while (ms--)
  {
    for (n = 0; n < 7200U; n++) { __asm volatile ("nop"); }
  }
}

/* ---------------------------------------------------------------- 灯 */
static void led_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;
  GPIOA->CRH &= ~(0xFUL << 12);
  GPIOA->CRH |=  (0x2UL << 12);
  GPIOB->CRH &= ~(0xFFUL << 24);
  GPIOB->CRH |=  (0x22UL << 24);
  GPIOA->ODR &= ~(1UL << 11);
  GPIOB->ODR &= ~((1UL << 14) | (1UL << 15));
}

/* ---------------------------------------------------------------- 调试串口 */
static void dbg_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_USART1EN;
  RCC->APB2ENR |= RCC_APB2ENR_AFIOEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  GPIOA->CRH &= ~(0xFFUL << 4);
  GPIOA->CRH |=  (0xBUL << 4);
  GPIOA->CRH |=  (0x4UL << 8);
  USART1->BRR = 0x271U;
  USART1->CR1 = USART_CR1_UE | USART_CR1_TE | USART_CR1_RE;
}

static void dbg_putc(char c)
{
  while ((USART1->SR & USART_SR_TXE) == 0U) { ; }
  USART1->DR = (uint16_t)(uint8_t)c;
}

static void dbg_puts(const char *s) { while (*s) { dbg_putc(*s++); } }

static void dbg_hex8(uint8_t v)
{
  static const char hx[] = "0123456789ABCDEF";
  dbg_putc(hx[(v >> 4) & 0x0FU]);
  dbg_putc(hx[v & 0x0FU]);
}

static void dbg_u32(uint32_t v)
{
  char b[12];
  int i = 0;
  if (v == 0U) { dbg_putc('0'); return; }
  while (v && i < 11) { b[i++] = (char)('0' + (v % 10U)); v /= 10U; }
  while (i--) { dbg_putc(b[i]); }
}

/* ---------------------------------------------------------------- 扫码串口 */
static void scan_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB1ENR |= RCC_APB1ENR_USART2EN;

  GPIOA->CRL &= ~(0xFUL << 4);             /* PA1 触发，推挽输出 */
  GPIOA->CRL |=  (0x2UL << 4);
  GPIOA->CRL &= ~(0xFUL << 8);             /* PA2 = USART2_TX */
  GPIOA->CRL |=  (0xBUL << 8);
  GPIOA->CRL &= ~(0xFUL << 12);            /* PA3 = USART2_RX */
  GPIOA->CRL |=  (0x4UL << 12);

  GPIOA->ODR |= (1UL << 1);                /* TR 空闲高 */

  USART2->BRR = 3750U;                     /* 9600 */
  USART2->CR1 = USART_CR1_RE | USART_CR1_TE;   /* 不开 RXNEIE */
}

#define TR_LOW()    (GPIOA->ODR &= ~(1UL << 1))
#define TR_HIGH()   (GPIOA->ODR |=  (1UL << 1))

/* ---------------------------------------------------------------- 动作 */

/* 收数据并打印。
 *   useTrigger : 1 = 先拉低 TR
 *   seconds    : 0 = 一直监听直到按任意键；>0 = 监听这么多秒
 *   noData     : 1 = 不打印每个字节（只测触发脚用）
 */
static void do_scan(uint8_t useTrigger, uint16_t seconds, uint8_t noData)
{
  uint32_t t = 0;
  uint16_t n = 0;
  uint8_t  c;
  uint8_t  stop = 0;

  GPIOA->ODR |= (1UL << 11);               /* LED3 = 正在扫 */

  if (useTrigger)
  {
    TR_LOW();
    dbg_puts("  TR = LOW");
  }

  if (seconds == 0U)
  {
    dbg_puts(", listening CONTINUOUSLY (press any key to stop) ...\r\n");
  }
  else
  {
    dbg_puts(", listening ");
    dbg_u32(seconds);
    dbg_puts("s ...\r\n");
  }

  while (1)
  {
    /* ---- 收扫码数据（紧密轮询，不 delay，否则 9600 会丢包） ---- */
    if ((USART2->SR & USART_SR_RXNE) != 0U)
    {
      c = (uint8_t)(USART2->DR & 0xFFU);
      n++;

      if (noData == 0U)
      {
        dbg_puts("  RX[");
        dbg_u32(n - 1U);
        dbg_puts("] = ");
        dbg_hex8(c);
        dbg_puts(" '");
        dbg_putc((c >= 32U && c < 127U) ? (char)c : '.');
        dbg_puts("'\r\n");
      }

      GPIOB->ODR |= (1UL << 14);           /* LED1 常亮 */
    }

    /* ---- 连续模式：按任意键停止 ---- */
    if (seconds == 0U)
    {
      if ((USART1->SR & USART_SR_RXNE) != 0U)
      {
        (void)(USART1->DR & 0xFFU);
        stop = 1;
      }
    }
    else
    {
      if (t >= ((uint32_t)seconds * 1000UL)) stop = 1;
    }

    if (stop != 0U) break;

    /* 只有空闲时才计时，收数据时不 delay */
    if ((USART2->SR & USART_SR_RXNE) == 0U)
    {
      delay_us_or_nop();
      t++;
    }

    /* ---- 每 10000 次粗略报一次进度 ---- */
    if (seconds == 0U && (t % 10000UL) == 0UL)
    {
      dbg_puts("  ... ");
      dbg_u32(t / 1000UL);
      dbg_puts("s  total ");
      dbg_u32(n);
      dbg_puts(" bytes\r\n");
    }
  }

  if (useTrigger) TR_HIGH();
  GPIOA->ODR &= ~(1UL << 11);

  if (n == 0U)
  {
    dbg_puts("  --- 0 byte (timeout) ---\r\n");
    GPIOB->ODR |= (1UL << 15);             /* LED2 = 超时 */
  }
  else
  {
    dbg_puts("  --- END, total ");
    dbg_u32(n);
    dbg_puts(" bytes ---\r\n");
  }
}


static void help(void)
{
  dbg_puts("--------------------------------------------------\r\n");
  dbg_puts("  s        trigger scan 3s (TR low), print data\r\n");
  dbg_puts("  s 10     trigger scan 10s\r\n");
  dbg_puts("  n        listen CONTINUOUSLY (TR untouched), any key stops\r\n");
  dbg_puts("  n 30     listen 30 seconds\r\n");
  dbg_puts("  p        only pull TR low 3s (test the trigger pin)\r\n");
  dbg_puts("  ?   this help\r\n");
  dbg_puts("--------------------------------------------------\r\n");
}

/* ---------------------------------------------------------------- main */
int main(void)
{
  static char line[16];
  uint8_t  len = 0;
  char     ch;
  uint16_t sec;
  uint8_t  i;
  uint16_t idle = 0;
  uint8_t  exec = 0;

  led_init();
  dbg_init();
  scan_init();

  dbg_puts("\r\n\r\n");
  dbg_puts("=====================================================\r\n");
  dbg_puts("  42-SERIAL-CMD-SCAN   no I2C\r\n");
  dbg_puts("  type :  s / s 10 / n / n 30 / p / ?\r\n");
  dbg_puts("  (Enter 可选，输入后 300ms 自动执行)\r\n");
  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    dbg_puts("  clock: PLL 72MHz OK\r\n");
  }
  else
  {
    dbg_puts("  clock: *** NOT PLL ***\r\n");
  }
  dbg_puts("=====================================================\r\n");
  help();

  while (1)
  {
    /* ---- 收字符 ---- */
    if ((USART1->SR & USART_SR_RXNE) != 0U)
    {
      ch = (char)(USART1->DR & 0xFFU);

      if (ch == '\r' || ch == '\n')
      {
        if (len > 0U) exec = 1U;
      }
      else
      {
        if (len < sizeof(line) - 1U)
        {
          line[len++] = ch;
        }
        idle = 0;                     /* 有新字符，重置空闲计时 */
      }
    }

    /* ---- 300ms 没新字符就自动执行（不用按回车） ---- */
    if (len > 0U && exec == 0U)
    {
      idle++;
      if (idle >= 300U) exec = 1U;
    }

    if (exec == 0U)
    {
      delay_ms(1);
      continue;
    }

    /* ---- 执行 ---- */
    line[len] = 0;
    exec = 0;
    idle = 0;

    dbg_puts("> ");
    dbg_puts(line);
    dbg_puts("   <-- got it\r\n");

    sec = 0;
    for (i = 1U; i < len; i++)
    {
      if (line[i] >= '0' && line[i] <= '9')
      {
        sec = (uint16_t)(sec * 10U + (uint16_t)(line[i] - '0'));
        if (sec > 600U) sec = 600U;
      }
    }

    if (line[0] == 's' || line[0] == 'S')
    {
      do_scan(1U, (sec == 0U) ? 3U : sec, 0U);
    }
    else if (line[0] == 'n' || line[0] == 'N')
    {
      do_scan(0U, sec, 0U);           /* 不带数字 = 一直监听 */
    }
    else if (line[0] == 'p' || line[0] == 'P')
    {
      dbg_puts("  TR = LOW for 3s (no RX reading)\r\n");
      TR_LOW();
      delay_ms(3000);
      TR_HIGH();
      dbg_puts("  TR = HIGH again\r\n");
    }
    else if (line[0] == '?' || line[0] == 'h' || line[0] == 'H')
    {
      help();
    }
    else
    {
      dbg_puts("  unknown command, type ? for help\r\n");
    }

    len = 0;
  }
}
