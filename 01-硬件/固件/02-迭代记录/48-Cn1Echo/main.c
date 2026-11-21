/* ============================================================================
 *  48 · CN1 回显测试（9600）
 * ============================================================================
 *
 *  你从 CN1 写进去什么，它就从 CN1 原样吐回来什么。
 *  写 1110  ->  看到 1110 回来
 *
 *  接线（三根都接，都用 CN1）：
 *      TTL TX   ->  CN1 脚4（PA3，STM32 的 RX）
 *      TTL RX   ->  CN1 脚3（PA2，STM32 的 TX）
 *      TTL GND  ->  CN1 脚2（GND）
 *
 *  ★ 串口助手波特率：9600 ★
 *
 *  每收到一个字节：
 *      LED1 (PB14) 翻一次
 *      LED2 (PB15) 常亮
 *
 *  判断：
 *      写什么回来什么        -> CN1 的收发两根线全部正常
 *      只有 LED1 翻，没回显  -> TTL RX 没接对，或 PA2 到 CN1 脚3 断
 *      完全没反应            -> TTL TX 没接到 CN1 脚4，或波特率不对
 * ========================================================================== */

#include "stm32f10x.h"

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
  RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;
  GPIOB->CRH &= ~(0xFFUL << 24);
  GPIOB->CRH |=  (0x22UL << 24);
  GPIOB->ODR &= ~((1UL << 14) | (1UL << 15));
}

/* ---------------------------------------------------------------- CN1 串口 */
static void cn1_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB1ENR |= RCC_APB1ENR_USART2EN;

  /* PA1 = 触发脚，保持高电平（不用触发） */
  GPIOA->CRL &= ~(0xFUL << 4);
  GPIOA->CRL |=  (0x2UL << 4);
  GPIOA->ODR |= (1UL << 1);

  /* PA2 = USART2_TX 复用推挽 */
  GPIOA->CRL &= ~(0xFUL << 8);
  GPIOA->CRL |=  (0xBUL << 8);

  /* PA3 = USART2_RX 输入上拉（避免悬空收噪声） */
  GPIOA->CRL &= ~(0xFUL << 12);
  GPIOA->CRL |=  (0x8UL << 12);

  USART2->BRR = 3750U;                    /* 36MHz / 9600 */
  USART2->CR1 = USART_CR1_TE | USART_CR1_RE | USART_CR1_UE;
}

static void cn1_putc(char c)
{
  while ((USART2->SR & USART_SR_TXE) == 0U) { ; }
  USART2->DR = (uint16_t)(uint8_t)c;
}

static void cn1_puts(const char *s) { while (*s) cn1_putc(*s++); }

static void cn1_u32(uint32_t v)
{
  char b[12];
  int i = 0;
  if (v == 0U) { cn1_putc('0'); return; }
  while (v && i < 11) { b[i++] = (char)('0' + (v % 10U)); v /= 10U; }
  while (i--) cn1_putc(b[i]);
}

/* ---------------------------------------------------------------- main */
int main(void)
{
  uint8_t  b;
  uint32_t n = 0;
  uint32_t beat = 0;
  static uint8_t buf[64];
  uint16_t cnt = 0;
  uint16_t quiet = 0;
  uint8_t  ovf = 0;

  led_init();
  cn1_init();

  cn1_puts("\r\n\r\n=====================================================\r\n");
  cn1_puts("  48-CN1-ECHO  (9600)\r\n");
  cn1_puts("  CN1 pin4 <- TTL TX    CN1 pin3 -> TTL RX\r\n");
  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    cn1_puts("  clock: PLL 72MHz OK\r\n");
  }
  else
  {
    cn1_puts("  clock: *** NOT PLL ***\r\n");
  }
  cn1_puts("=====================================================\r\n");
  cn1_puts("  type anything, it comes straight back\r\n\r\n");

  /* ★ 分两步：先把收到的字节全存进内存，空闲了再统一发出去。
   *   这样接收绝不会被发送阻塞，9600 下也不丢包。 */
  /* ★ 关键：先把整串收完（连续 20 次没新字节 ≈ 几毫秒空闲），
   *   再一次性发出去。这样接收绝不会被发送阻塞。 */
  while (1)
  {
    /* ---- 第一步：收，只收不发 ---- */
    if ((USART2->SR & USART_SR_RXNE) != 0U)
    {
      b = (uint8_t)(USART2->DR & 0xFFU);

      if (cnt < sizeof(buf))
      {
        buf[cnt++] = b;
      }

      GPIOB->ODR ^= (1UL << 14);
      GPIOB->ODR |= (1UL << 15);
      quiet = 0;
      beat = 0;
    }
    else
    {
      quiet++;
      beat++;
    }

    /* ---- 第二步：确认这一串收完了，再统一发 ---- */
    if (cnt > 0U && quiet >= 20U)
    {
      uint16_t q;
      for (q = 0U; q < cnt; q++)
      {
        cn1_putc((char)buf[q]);
      }
      n += cnt;
      cnt = 0U;
      quiet = 0U;
    }

    /* ---- 每 5 秒打印存活 ---- */
    if (beat >= 600000UL)
    {
      beat = 0;
      cn1_puts("\r\n[ALIVE] total ");
      cn1_u32(n);
      cn1_puts(" bytes\r\n");
    }
  }
}
