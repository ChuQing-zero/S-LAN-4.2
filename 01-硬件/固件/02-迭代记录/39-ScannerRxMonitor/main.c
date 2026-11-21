/* ============================================================================
 *  39 · 扫码模块 RX 接收监视器
 * ============================================================================
 *
 *  这个程序只做一件事：**盯着 USART2（PA3）看有没有字节进来**。
 *
 *  行为：
 *      PC13 每 500ms 翻一次            = 程序在跑
 *      PB14 收到数据后 0.5 秒亮/0.5 秒灭 闪 5 秒 = 有数据！
 *      PB15 只要收过数据就一直亮        = 确认通信成功
 *      串口 115200 每秒打印收到的字节总数
 *
 *  判断：
 *      扫码时 PB14 在闪 / PB15 亮起 / 串口计数在涨  -> 通信成功
 *      扫码时 PB14 一直不动、计数一直是 0            -> 一个字节都没收到
 *
 *  接线：模块 TX -> PA3（CN1 第 4 脚），模块 GND -> GND，波特率 9600 8N1
 * ========================================================================== */

#include "stm32f10x.h"

static volatile uint32_t g_rx_cnt = 0;
static volatile uint32_t g_blink_ms = 0;   /* 收到数据后继续闪的剩余时间 */
static          uint32_t g_tick     = 0;   /* 100ms 计数器 */

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
  RCC->APB2ENR |= RCC_APB2ENR_IOPCEN;

  GPIOB->CRH &= ~(0xFFUL << 24);        /* PB14 PB15 */
  GPIOB->CRH |=  (0x22UL << 24);

  GPIOC->CRH &= ~(0xFUL << 20);         /* PC13 */
  GPIOC->CRH |=  (0x2UL << 20);

  GPIOC->ODR |= (1UL << 13);            /* PC13 off (active low) */
  GPIOB->ODR &= ~((1UL << 14) | (1UL << 15));
}

/* ---------------------------------------------------------------- 串口1 */
static void uart1_init(void)
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

static void uart1_putc(char c)
{
  while ((USART1->SR & USART_SR_TXE) == 0U) { ; }
  USART1->DR = (uint16_t)(uint8_t)c;
}

static void uart1_puts(const char *s)
{
  while (*s) { uart1_putc(*s++); }
}

static void uart1_u32(uint32_t v)
{
  char b[12];
  int i = 0;
  if (v == 0U) { uart1_putc('0'); return; }
  while (v && i < 11) { b[i++] = (char)('0' + (v % 10U)); v /= 10U; }
  while (i--) { uart1_putc(b[i]); }
}

/* ---------------------------------------------------------------- USART2 */
static void usart2_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB1ENR |= RCC_APB1ENR_USART2EN;

  /* PA2 = TX 复用推挽（这里不发，但配好）*/
  GPIOA->CRL &= ~(0xFUL << 8);
  GPIOA->CRL |=  (0xBUL << 8);

  /* PA3 = RX 浮空输入 */
  GPIOA->CRL &= ~(0xFUL << 12);
  GPIOA->CRL |=  (0x4UL << 12);

  /* 36MHz / 9600 = 3750 = 0xEA6 */
  USART2->BRR = 3750U;
  USART2->CR1 = USART_CR1_UE | USART_CR1_RE | USART_CR1_TE;
}

/* ---------------------------------------------------------------- main */
int main(void)
{
  uint32_t last = 0;
  uint32_t hb   = 0;
  uint8_t  b;

  led_init();
  uart1_init();
  usart2_init();

  uart1_puts("\r\n\r\n");
  uart1_puts("=====================================================\r\n");
  uart1_puts("  39-RX-MONITOR   listening on PA3 @ 9600 8N1\r\n");
  uart1_puts("  PB14 flips on every received byte\r\n");
  uart1_puts("  PB15 stays ON once any data arrived\r\n");
  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    uart1_puts("  clock: PLL 72MHz OK\r\n");
  }
  else
  {
    uart1_puts("  clock: *** NOT PLL ***\r\n");
  }
  uart1_puts("=====================================================\r\n");
  uart1_puts("  scan a code now, watch PB14 / PB15\r\n\r\n");

  while (1)
  {
    /* ---- 收到字节：翻 PB14，点亮 PB15 ---- */
    if ((USART2->SR & USART_SR_RXNE) != 0U)
    {
      b = (uint8_t)(USART2->DR & 0xFFU);    /* 读出来清标志 */
      (void)b;
      g_rx_cnt++;
      g_blink_ms = 5000UL;                  /* 每收到字节，闪烁窗口延长到 5 秒 */
      GPIOB->ODR |= (1UL << 15);            /* PB15 常亮 = 确实收到过数据 */
    }

    /* ---- 每 100ms：PC13 心跳 ---- */
    delay_ms(100);
    hb++;
    if ((hb & 1UL) != 0UL) GPIOC->ODR &= ~(1UL << 13);
    else                   GPIOC->ODR |=  (1UL << 13);

    /* ---- 收到数据后：PB14 以 0.5 秒亮 / 0.5 秒灭 闪烁 5 秒 ---- */
    if (g_blink_ms > 0UL)
    {
      g_blink_ms -= 100UL;
      g_tick++;

      if ((g_tick % 5UL) == 0UL)            /* 每 500ms 翻一次 */
      {
        GPIOB->ODR ^= (1UL << 14);
      }

      if (g_blink_ms == 0UL)                /* 闪完熄灭 */
      {
        GPIOB->ODR &= ~(1UL << 14);
        g_tick = 0;
      }
    }

    /* ---- 每 1 秒打印字节总数 ---- */
    if ((hb % 10UL) == 0UL)
    {
      uart1_puts("  RX bytes = ");
      uart1_u32(g_rx_cnt);
      uart1_puts("\r\n");

      if (g_rx_cnt != last)
      {
        last = g_rx_cnt;
      }
    }
  }
}
