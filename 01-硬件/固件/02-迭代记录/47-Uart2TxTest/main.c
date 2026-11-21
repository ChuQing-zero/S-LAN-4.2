/* ============================================================================
 *  47 · CN1（USART2）持续发送测试
 * ============================================================================
 *
 *  让 STM32 每隔 1 秒从 CN1 的 TX 脚（PA2）往外发一行状态，用来验证
 *  「STM32 → CN1」这个方向通不通。
 *
 *  ★ 两个串口的波特率不一样，注意！！
 *
 *      CN1 脚3 = PA2 = USART2_TX   →  波特率 9600
 *      H2  脚2 = PA9 = USART1_TX   →  波特率 115200
 *
 *  两个口发的内容一样，方便对照。
 *
 *  测法一：TTL 的 RX 接到 CN1 脚3，串口助手设 9600
 *          应该每秒看到  STATUS 0001
 *                       STATUS 0002
 *
 *  测法二：TTL 的 RX 接到 H2 脚2，串口助手设 115200
 *          看到同样的内容
 *
 *  结果：
 *      两个口都能看到 -> STM32 发送完全正常
 *      只有 H2 能看   -> CN1 脚3（PA2）这段有问题
 *      两个都看不到   -> 程序没跑 / 波特率错
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

/* ---------------------------------------------------------------- 两个串口 */
static void u1_init(void)              /* H2, 115200 */
{
  RCC->APB2ENR |= RCC_APB2ENR_USART1EN;
  RCC->APB2ENR |= RCC_APB2ENR_AFIOEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;

  GPIOA->CRH &= ~((0xFUL << 4) | (0xFUL << 8));
  GPIOA->CRH |=  (0xBUL << 4);         /* PA9  AF 推挽 */
  GPIOA->CRH |=  (0x8UL << 8);         /* PA10 输入上拉 */

  USART1->BRR = 0x271U;                /* 115200 */
  USART1->CR1 = USART_CR1_TE | USART_CR1_RE | USART_CR1_UE;
}

static void u2_init(void)              /* CN1, 9600 */
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB1ENR |= RCC_APB1ENR_USART2EN;

  /* PA1 触发脚保持高，不发 */
  GPIOA->CRL &= ~(0xFUL << 4);
  GPIOA->CRL |=  (0x2UL << 4);
  GPIOA->ODR |= (1UL << 1);

  /* PA2 = USART2_TX 复用推挽 */
  GPIOA->CRL &= ~(0xFUL << 8);
  GPIOA->CRL |=  (0xBUL << 8);
  /* PA3 = USART2_RX 输入上拉 */
  GPIOA->CRL &= ~(0xFUL << 12);
  GPIOA->CRL |=  (0x8UL << 12);

  USART2->BRR = 3750U;                 /* 9600 */
  USART2->CR1 = USART_CR1_TE | USART_CR1_RE | USART_CR1_UE;
}

/* ---------------------------------------------------------------- 发送 */
static void u1_putc(char c)
{
  while ((USART1->SR & USART_SR_TXE) == 0U) { ; }
  USART1->DR = (uint16_t)(uint8_t)c;
}

static void u2_putc(char c)
{
  while ((USART2->SR & USART_SR_TXE) == 0U) { ; }
  USART2->DR = (uint16_t)(uint8_t)c;
}

/* 同一行同时发到两个口 */
static void both_putc(char c) { u1_putc(c); u2_putc(c); }

static void both_puts(const char *s) { while (*s) both_putc(*s++); }

static void both_d4(uint32_t v)
{
  v %= 10000UL;
  both_putc((char)('0' + (v / 1000UL) % 10UL));
  both_putc((char)('0' + (v / 100UL) % 10UL));
  both_putc((char)('0' + (v / 10UL) % 10UL));
  both_putc((char)('0' + v % 10UL));
}

/* ---------------------------------------------------------------- main */
int main(void)
{
  uint32_t cnt = 0;

  led_init();
  u1_init();
  u2_init();

  both_puts("\r\n\r\n");
  both_puts("=====================================================\r\n");
  both_puts("  47-UART2-TX-TEST\r\n");
  both_puts("  CN1 pin3 (PA2) = 9600    H2 pin2 (PA9) = 115200\r\n");
  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    both_puts("  clock: PLL 72MHz OK\r\n");
  }
  else
  {
    both_puts("  clock: *** NOT PLL ***\r\n");
  }
  both_puts("=====================================================\r\n");
  both_puts("  sending STATUS every 1 second ...\r\n\r\n");

  while (1)
  {
    cnt++;

    both_puts("STATUS ");
    both_d4(cnt);
    both_puts("\r\n");

    GPIOB->ODR ^= (1UL << 14);         /* LED1 每秒翻一次 */

    delay_ms(1000);
  }
}
