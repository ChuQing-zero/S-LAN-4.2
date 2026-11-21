/* ============================================================================
 *  44 · 双串口监视器（乱码也看得见）
 * ============================================================================
 *
 *  两个串口收到的任何字节，都会立刻以十六进制 + 字符形式打印出来。
 *
 *      USART1  PA9/PA10（H2 排针）  115200   ← 你和电脑之间
 *      USART2  PA2/PA3（CN1 脚3/4） 9600     ← 扫码模块
 *
 *  显示格式：
 *      [U1] 41 'A'      <- USART1 收到 0x41
 *      [U2] 39 '9'      <- USART2 收到 0x39（扫码数据）
 *
 *  串口助手设置：115200，行结尾随便（不影响）
 *
 *  用途：
 *      1) 你在串口助手敲字 -> 会看到 [U1] xx 回显 = USART1 通
 *      2) 扫码模块发数据   -> 会看到 [U2] xx    = USART2 通
 *      3) 波特率不对时会看到一堆 [U2] FF / 00，能判断线路有信号
 *
 *  指示灯：
 *      LED1 (PB14)  USART2 收到过数据
 *      LED2 (PB15)  USART1 收到过数据
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

/* ---------------------------------------------------------------- USART1 */
static void u1_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_USART1EN;
  RCC->APB2ENR |= RCC_APB2ENR_AFIOEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;

  GPIOA->CRH &= ~(0xFFUL << 4);
  GPIOA->CRH |=  (0xBUL << 4);
  GPIOA->CRH |=  (0x4UL << 8);

  USART1->BRR = 0x271U;                  /* 115200 */
  USART1->CR1 = USART_CR1_UE | USART_CR1_TE | USART_CR1_RE;
}

static void u1_putc(char c)
{
  while ((USART1->SR & USART_SR_TXE) == 0U) { ; }
  USART1->DR = (uint16_t)(uint8_t)c;
}

static void u1_puts(const char *s) { while (*s) { u1_putc(*s++); } }

static void u1_hex8(uint8_t v)
{
  static const char hx[] = "0123456789ABCDEF";
  u1_putc(hx[(v >> 4) & 0x0FU]);
  u1_putc(hx[v & 0x0FU]);
}

static void u1_u32(uint32_t v)
{
  char b[12];
  int i = 0;
  if (v == 0U) { u1_putc('0'); return; }
  while (v && i < 11) { b[i++] = (char)('0' + (v % 10U)); v /= 10U; }
  while (i--) { u1_putc(b[i]); }
}

/* 打印一个字节： [Ux] 41 'A' */
static void dump(const char *who, uint8_t b)
{
  u1_puts("  [");
  u1_puts(who);
  u1_puts("] ");
  u1_hex8(b);
  u1_puts(" '");
  u1_putc((b >= 32U && b < 127U) ? (char)b : '.');
  u1_puts("'\r\n");
}

/* ---------------------------------------------------------------- USART2 */
static void u2_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB1ENR |= RCC_APB1ENR_USART2EN;

  /* PA1 触发脚：保持高电平（不触发） */
  GPIOA->CRL &= ~(0xFUL << 4);
  GPIOA->CRL |=  (0x2UL << 4);
  GPIOA->ODR |= (1UL << 1);

  /* PA2 = USART2_TX */
  GPIOA->CRL &= ~(0xFUL << 8);
  GPIOA->CRL |=  (0xBUL << 8);
  /* PA3 = USART2_RX */
  GPIOA->CRL &= ~(0xFUL << 12);
  GPIOA->CRL |=  (0x4UL << 12);

  USART2->BRR = 3750U;                   /* 9600 */
  USART2->CR1 = USART_CR1_UE | USART_CR1_RE | USART_CR1_TE;
}

/* ---------------------------------------------------------------- main */
int main(void)
{
  uint8_t  b;
  uint32_t n1 = 0, n2 = 0;
  uint32_t idle = 0;
  uint32_t last1 = 0, last2 = 0;

  led_init();
  u1_init();
  u2_init();

  u1_puts("\r\n\r\n");
  u1_puts("=====================================================\r\n");
  u1_puts("  44-DUAL-PORT-MONITOR\r\n");
  u1_puts("  USART1 PA9/PA10  115200  -> [U1]\r\n");
  u1_puts("  USART2 PA2/PA3    9600   -> [U2]\r\n");
  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    u1_puts("  clock: PLL 72MHz OK\r\n");
  }
  else
  {
    u1_puts("  clock: *** NOT PLL ***\r\n");
  }
  u1_puts("=====================================================\r\n");
  u1_puts("  type here -> you will see [U1]\r\n");
  u1_puts("  scan a code -> you should see [U2]\r\n\r\n");

  while (1)
  {
    /* ---- USART1：收到就打回来 ---- */
    if ((USART1->SR & USART_SR_RXNE) != 0U)
    {
      b = (uint8_t)(USART1->DR & 0xFFU);
      n1++;
      last1 = 0;
      dump("U1", b);
      GPIOB->ODR |= (1UL << 15);
    }

    /* ---- USART2：扫码口 ---- */
    if ((USART2->SR & USART_SR_RXNE) != 0U)
    {
      b = (uint8_t)(USART2->DR & 0xFFU);
      n2++;
      last2 = 0;
      dump("U2", b);
      GPIOB->ODR |= (1UL << 14);
    }

    /* ---- 每 2 秒打印一次统计（只在有变化时） ---- */
    idle++;
    if (idle >= 2000U)
    {
      idle = 0;
      u1_puts("  --- U1=");
      u1_u32(n1);
      u1_puts("  U2=");
      u1_u32(n2);
      u1_puts(" ---\r\n");
    }

    delay_ms(1);
  }
}
