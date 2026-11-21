/* ============================================================================
 *  43 · USART2 自环测试（验证 PA2 / PA3 引脚和串口硬件）
 * ============================================================================
 *
 *  ★ 测试前必须做：用一根杜邦线/镊子把 PA2 和 PA3 短接
 *      PA2 = USART2_TX  （CN1 脚3）
 *      PA3 = USART2_RX  （CN1 脚4）
 *
 *  原理：MCU 从 PA2 发一个字节，短接线让它直接回到 PA3，
 *        MCU 再读出来比对。收发一致 = 串口硬件完全正常。
 *
 *  串口（H2 排针，TTL）：115200
 *      TTL RX  -> H2 脚2
 *      TTL GND -> H2 脚1
 *
 *  运行后会一直打印：
 *      TX=55 -> RX=55  OK
 *      TX=AA -> RX=AA  OK
 *      TX=00 -> RX=00  OK
 *      ...
 *      --- sent=40  ok=40  fail=0 ---
 *
 *  判断：
 *      全是 OK、fail=0        -> PA2/PA3 和 USART2 硬件都正常
 *      RX 全是 0 或 FF        -> 短接线没接好
 *      fail 一直在涨          -> 波特率/引脚配置问题
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
  GPIOA->CRH &= ~(0xFUL << 12);        /* PA11 */
  GPIOA->CRH |=  (0x2UL << 12);
  GPIOB->CRH &= ~(0xFFUL << 24);       /* PB14 PB15 */
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

/* ---------------------------------------------------------------- USART2 */
static void u2_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB1ENR |= RCC_APB1ENR_USART2EN;

  /* PA2 = USART2_TX 复用推挽 */
  GPIOA->CRL &= ~(0xFUL << 8);
  GPIOA->CRL |=  (0xBUL << 8);

  /* PA3 = USART2_RX 浮空输入（要和 PA2 短接） */
  GPIOA->CRL &= ~(0xFUL << 12);
  GPIOA->CRL |=  (0x4UL << 12);

  USART2->BRR = 3750U;                 /* 36MHz / 9600 */
  USART2->CR1 = USART_CR1_UE | USART_CR1_RE | USART_CR1_TE;
}

/* 发一个字节并等它回来，返回收到的字节；超时返回 0xEE 特殊值 */
static uint8_t u2_loop(uint8_t tx)
{
  uint16_t wait;

  USART2->DR = (uint16_t)tx;                       /* 发送 */

  wait = 0;
  while (((USART2->SR & USART_SR_RXNE) == 0U) && wait < 500U)
  {
    delay_ms(1);
    wait++;
  }

  if ((USART2->SR & USART_SR_RXNE) == 0U) return 0xEEU;
  return (uint8_t)(USART2->DR & 0xFFU);
}

/* ---------------------------------------------------------------- main */
int main(void)
{
  static const uint8_t PATTERN[4] = { 0x55U, 0xAAU, 0x00U, 0xFFU };
  uint32_t sent = 0, ok = 0, fail = 0;
  uint32_t k = 0;
  uint8_t  tx, rx;

  led_init();
  dbg_init();
  u2_init();

  dbg_puts("\r\n\r\n");
  dbg_puts("=====================================================\r\n");
  dbg_puts("  43-USART2-LOOPBACK\r\n");
  dbg_puts("  *** SHORT PA2 and PA3 together before this test ***\r\n");
  dbg_puts("  PA2 = CN1 pin3    PA3 = CN1 pin4\r\n");
  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    dbg_puts("  clock: PLL 72MHz OK\r\n");
  }
  else
  {
    dbg_puts("  clock: *** NOT PLL ***\r\n");
  }
  dbg_puts("=====================================================\r\n");

  while (1)
  {
    tx = PATTERN[k % 4U];
    k++;

    rx = u2_loop(tx);
    sent++;

    dbg_puts("  TX=");
    dbg_hex8(tx);
    dbg_puts(" -> RX=");

    if (rx == 0xEEU)
    {
      dbg_puts("--   NO REPLY");
      fail++;
      GPIOB->ODR |= (1UL << 15);        /* LED2 = 失败 */
    }
    else
    {
      dbg_hex8(rx);
      if (rx == tx)
      {
        dbg_puts("   OK");
        ok++;
        GPIOB->ODR |= (1UL << 14);      /* LED1 = 成功过 */
      }
      else
      {
        dbg_puts("   MISMATCH");
        fail++;
        GPIOB->ODR |= (1UL << 15);
      }
    }
    dbg_puts("\r\n");

    /* 每 4 次打印一次统计 */
    if ((k % 4U) == 0U)
    {
      dbg_puts("  --- sent=");
      dbg_u32(sent);
      dbg_puts("  ok=");
      dbg_u32(ok);
      dbg_puts("  fail=");
      dbg_u32(fail);
      dbg_puts(" ---\r\n\r\n");
    }

    delay_ms(50);
  }
}
