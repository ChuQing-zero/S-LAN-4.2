/* ============================================================================
 *  46 · 串口回显测试（最简单的一条路）
 * ============================================================================
 *
 *  你从串口发什么，它就原样发回什么。
 *  发 1110  ->  应该看到 1110 回来
 *
 *  接线（H2 排针，三根都接）：
 *      TTL TX   ->  H2 脚3（PA10，STM32 的 RX）
 *      TTL RX   ->  H2 脚2（PA9，STM32 的 TX）
 *      TTL GND  ->  H2 脚1（GND）
 *
 *  串口助手：115200 8N1
 *
 *  每一条都有灯证明：
 *      LED1 (PB14)  收到一个字节就翻一次
 *      LED2 (PB15)  收过数据就常亮
 *
 *  判断：
 *      发什么回来什么   -> 两根串口线 + 波特率全部正常
 *      发出去没反应     -> TTL RX 那根没接，或 TX 没到 PA10
 *      回来是乱码       -> 波特率不对
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

/* ---------------------------------------------------------------- 串口 */
static void uart_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_USART1EN;
  RCC->APB2ENR |= RCC_APB2ENR_AFIOEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;

  GPIOA->CRH &= ~((0xFUL << 4) | (0xFUL << 8));
  GPIOA->CRH |=  (0xBUL << 4);      /* PA9  AF 推挽输出 */
  GPIOA->CRH |=  (0x8UL << 8);      /* PA10 输入上拉（不悬空） */

  USART1->BRR = 0x271U;             /* 72MHz / 115200 */
  USART1->CR1 = USART_CR1_TE | USART_CR1_RE | USART_CR1_UE;
}

static void putc_(char c)
{
  while ((USART1->SR & USART_SR_TXE) == 0U) { ; }
  USART1->DR = (uint16_t)(uint8_t)c;
}

static void puts_(const char *s) { while (*s) putc_(*s++); }

static void hex8(uint8_t v)
{
  static const char hx[] = "0123456789ABCDEF";
  putc_(hx[(v >> 4) & 0x0FU]);
  putc_(hx[v & 0x0FU]);
}

static void u32_(uint32_t v)
{
  char b[12];
  int i = 0;
  if (v == 0U) { putc_('0'); return; }
  while (v && i < 11) { b[i++] = (char)('0' + (v % 10U)); v /= 10U; }
  while (i--) putc_(b[i]);
}

/* 打印 3 位数字，不足补 0：7 -> 007 */
static void d3_(uint32_t v)
{
  v %= 1000UL;
  putc_((char)('0' + (v / 100UL) % 10UL));
  putc_((char)('0' + (v / 10UL) % 10UL));
  putc_((char)('0' + v % 10UL));
}

/* ---------------------------------------------------------------- main */
int main(void)
{
  uint8_t  b;
  uint32_t n = 0;
  uint32_t idle = 0;
  uint32_t beat = 0;

  led_init();
  uart_init();

  puts_("\r\n\r\n");
  puts_("=====================================================\r\n");
  puts_("  46-SERIAL-ECHO\r\n");
  puts_("  every 5s prints [ALIVE nnn]\r\n");
  puts_("  type anything -> it comes straight back\r\n");
  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    puts_("  clock: PLL 72MHz OK\r\n");
  }
  else
  {
    puts_("  clock: *** NOT PLL ***\r\n");
  }
  puts_("=====================================================\r\n");
  puts_("  >> ");

  while (1)
  {
    if ((USART1->SR & USART_SR_RXNE) != 0U)
    {
      b = (uint8_t)(USART1->DR & 0xFFU);

      /* ---- 原样回显 ---- */
      putc_((char)b);

      /* ---- 灯反馈 ---- */
      GPIOB->ODR ^= (1UL << 14);        /* LED1 每字节翻一次 */
      GPIOB->ODR |= (1UL << 15);        /* LED2 常亮 = 收过数据 */

      n++;
      idle = 0;
    }

    /* ---- 每 5 秒打印一次心跳，证明板子还活着 ---- */
    idle++;
    if (idle >= 5000U)
    {
      idle = 0;
      beat++;
      puts_("\r\n[ALIVE ");
      d3_(beat);
      puts_("]  ");
      puts_("total ");
      u32_(n);
      puts_(" bytes\r\n  >> ");
    }

    delay_ms(1);
  }
}
