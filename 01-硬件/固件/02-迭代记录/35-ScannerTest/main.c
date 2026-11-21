/* ============================================================================
 *  35 · 扫码模块独立测试（不用 I2C、不用 Nano）
 * ----------------------------------------------------------------------------
 *  触发方式（按你的要求）：
 *      PA1 = TR 触发脚
 *      平时   ：高电平（空闲）
 *      扫码时 ：拉低（进入扫描模式），扫成功或超时后自动拉高
 *
 *  串口输出（PA9/PA10，115200）：
 *      开机打印横幅
 *      每次触发打印：len / HEX / TXT
 *
 *  指示灯：
 *      PC13  每 500ms 翻一次  —— 程序在跑
 *      PA11  正在扫（TR 拉低期间）亮
 *      PB14  扫到了（OK）亮
 *      PB15  超时亮
 *      PA12  收到串口数据时亮
 *
 *  接线（和 IDEN 板网表一致）：
 *      TR    -> PA1
 *      模块 TX -> PA3   （模块发，MCU 收）
 *      模块 RX <- PA2   （MCU 发，模块收）
 *      9600 8N1
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
#define HB_ON()      (GPIOC->ODR &= ~(1UL << 13))
#define HB_OFF()     (GPIOC->ODR |=  (1UL << 13))
#define SCAN_ON()    (GPIOA->ODR |=  (1UL << 11))
#define SCAN_OFF()   (GPIOA->ODR &= ~(1UL << 11))
#define OK_ON()      (GPIOB->ODR |=  (1UL << 14))
#define OK_OFF()     (GPIOB->ODR &= ~(1UL << 14))
#define TO_ON()      (GPIOB->ODR |=  (1UL << 15))
#define TO_OFF()     (GPIOB->ODR &= ~(1UL << 15))
#define RX_ON()      (GPIOA->ODR |=  (1UL << 12))
#define RX_OFF()     (GPIOA->ODR &= ~(1UL << 12))

static void led_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPCEN;

  GPIOA->CRH &= ~(0xFFUL << 12);      /* PA11 PA12 */
  GPIOA->CRH |=  (0x22UL << 12);

  GPIOB->CRH &= ~(0xFFUL << 24);      /* PB14 PB15 */
  GPIOB->CRH |=  (0x22UL << 24);

  GPIOC->CRH &= ~(0xFUL << 20);       /* PC13 */
  GPIOC->CRH |=  (0x2UL << 20);

  HB_OFF(); SCAN_OFF(); OK_OFF(); TO_OFF(); RX_OFF();
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

  USART1->BRR = 0x271U;               /* 72MHz / 115200 */
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

static void uart1_hex8(uint8_t v)
{
  const char *h = "0123456789ABCDEF";
  uart1_putc(h[(v >> 4) & 0xF]);
  uart1_putc(h[v & 0xF]);
}

static void uart1_u32(uint32_t v)
{
  char buf[12];
  int i = 0;
  if (v == 0U) { uart1_putc('0'); return; }
  while (v && i < 11) { buf[i++] = (char)('0' + (v % 10U)); v /= 10U; }
  while (i--) { uart1_putc(buf[i]); }
}

/* ---------------------------------------------------------------- 扫码
 * TR = PA1 门控：拉低扫描，扫完拉高。USART2 = PA2(TX) / PA3(RX)，9600
 * ------------------------------------------------------------------ */
#define TR_LOW()     (GPIOA->ODR &= ~(1UL << 1))
#define TR_HIGH()    (GPIOA->ODR |=  (1UL << 1))

static void scanner_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB1ENR |= RCC_APB1ENR_USART2EN;

  /* PA1 = TR 推挽输出 2MHz (CRL bits 4..7) */
  GPIOA->CRL &= ~(0xFUL << 4);
  GPIOA->CRL |=  (0x2UL << 4);

  /* PA2 = USART2_TX 复用推挽 (CRL bits 8..11) */
  GPIOA->CRL &= ~(0xFUL << 8);
  GPIOA->CRL |=  (0xBUL << 8);

  /* PA3 = USART2_RX 浮空输入 (CRL bits 12..15) */
  GPIOA->CRL &= ~(0xFUL << 12);
  GPIOA->CRL |=  (0x4UL << 12);

  TR_HIGH();                          /* 空闲高电平 */

  /* 36MHz / 9600 = 3750 = 0xEA6 */
  USART2->BRR = 3750U;
  USART2->CR1 = USART_CR1_UE | USART_CR1_TE | USART_CR1_RE;
}

/* 拉低 TR，最多收 timeout_ms，返回收到的字节数 */
static uint8_t scan_once(uint8_t *buf, uint8_t maxlen, uint16_t timeout_ms)
{
  uint8_t n = 0;
  uint16_t t = 0;
  uint16_t quiet = 0;

  SCAN_ON();
  TR_LOW();

  while (t < timeout_ms)
  {
    if ((USART2->SR & USART_SR_RXNE) != 0U)
    {
      uint8_t c = (uint8_t)(USART2->DR & 0xFFU);
      if (n < maxlen) buf[n++] = c;
      quiet = 0;
      RX_ON();
    }
    else
    {
      quiet++;
    }

    delay_ms(1);
    t++;

    /* 收到过东西之后，静默 60ms 认为一帧结束 */
    if (n > 0U && quiet >= 60U) break;
  }

  TR_HIGH();
  SCAN_OFF();
  RX_OFF();
  return n;
}

/* ---------------------------------------------------------------- main */
int main(void)
{
  uint8_t buf[64];
  uint8_t n;
  uint8_t i;
  uint32_t hb = 0;

  led_init();
  uart1_init();

  uart1_puts("\r\n\r\n");
  uart1_puts("=====================================================\r\n");
  uart1_puts("  35-SCANNER-TEST\r\n");
  uart1_puts("  TR = PA1 : HIGH idle, LOW while scanning\r\n");
  uart1_puts("  module TX -> PA3   module RX <- PA2   9600 8N1\r\n");
  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    uart1_puts("  clock: PLL 72MHz OK\r\n");
  }
  else
  {
    uart1_puts("  clock: *** NOT PLL ***\r\n");
  }
  uart1_puts("=====================================================\r\n");
  uart1_puts("  scanning every 2 seconds ...\r\n\r\n");

  scanner_init();

  while (1)
  {
    /* ---- PC13 心跳：每 500ms 翻一次 ---- */
    hb++;
    if ((hb & 1UL) != 0UL) HB_ON(); else HB_OFF();

    /* ---- 每 2 秒触发一次扫码 ---- */
    n = scan_once(buf, sizeof(buf), 1500U);

    if (n > 0U)
    {
      OK_ON();
      uart1_puts("len = ");
      uart1_u32(n);
      uart1_puts("\r\n  HEX:");
      for (i = 0; i < n; i++)
      {
        uart1_putc(' ');
        uart1_hex8(buf[i]);
      }
      uart1_puts("\r\n  TXT: ");
      for (i = 0; i < n; i++)
      {
        uint8_t c = buf[i];
        uart1_putc((c >= 32U && c < 127U) ? (char)c : '.');
      }
      uart1_puts("\r\n\r\n");
      delay_ms(200);
      OK_OFF();
    }
    else
    {
      TO_ON();
      uart1_puts("timeout - nothing from the module\r\n\r\n");
      delay_ms(200);
      TO_OFF();
    }

    delay_ms(1500);
  }
}
