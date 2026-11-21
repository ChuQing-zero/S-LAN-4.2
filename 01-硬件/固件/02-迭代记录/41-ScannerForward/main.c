/* ============================================================================
 *  41 · 扫码数据转发测试（不用 I²C）
 * ============================================================================
 *
 *  目的：验证 **STM32 能不能收到扫码模块的数据**，并且把收到的字节
 *        一个字节一个字节地立刻转发到调试串口（H2 排针，TTL 能看）。
 *
 *  串口：
 *      调试口 USART1  PA9/PA10（H2 脚2/脚3）  115200
 *      扫码口 USART2  PA2/PA3（CN1 脚3/脚4）  9600
 *
 *  触发：
 *      PA1 平时高电平，每 3 秒拉低 3 秒（拉低期间扫码模块工作）
 *
 *  运行中会一直打印：
 *      READY                         开启等数据
 *      TRIGGER LOW                   开始触发
 *      RX[ 0] = 39 '9'               每收到一个字节立刻打印
 *      RX[ 1] = 39 '9'
 *      ...
 *      END n=11                      这一帧结束，共 11 字节
 *      --- timeout, nothing ---      3 秒内一个字节都没有
 *
 *  指示灯：
 *      LED3 (PA11)  正在扫（触发期间）
 *      LED1 (PB14)  收到过数据，常亮
 *      LED2 (PB15)  超时
 *
 *  怎么判断：
 *      看到 RX[ 0] = ... 一行行滚出来  -> STM32 收到了模块数据
 *      一直只有 --- timeout ---        -> 一个字节都没收到
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

  GPIOA->CRH &= ~(0xFUL << 12);            /* PA11 -> 输出 */
  GPIOA->CRH |=  (0x2UL << 12);

  GPIOB->CRH &= ~(0xFFUL << 24);           /* PB14 PB15 -> 输出 */
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
  GPIOA->CRH |=  (0xBUL << 4);             /* PA9  AF 推挽 */
  GPIOA->CRH |=  (0x4UL << 8);             /* PA10 浮空输入 */

  USART1->BRR = 0x271U;                    /* 72MHz / 115200 */
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

  /* PA1 = 触发，推挽输出 */
  GPIOA->CRL &= ~(0xFUL << 4);
  GPIOA->CRL |=  (0x2UL << 4);
  /* PA2 = USART2_TX */
  GPIOA->CRL &= ~(0xFUL << 8);
  GPIOA->CRL |=  (0xBUL << 8);
  /* PA3 = USART2_RX */
  GPIOA->CRL &= ~(0xFUL << 12);
  GPIOA->CRL |=  (0x4UL << 12);

  GPIOA->ODR |= (1UL << 1);                /* TR 空闲高 */

  USART2->BRR = 3750U;                     /* 36MHz / 9600 */
  /* 只开 RE | TE，绝不开 RXNEIE */
  USART2->CR1 = USART_CR1_RE | USART_CR1_TE;
}

#define TR_LOW()    (GPIOA->ODR &= ~(1UL << 1))
#define TR_HIGH()   (GPIOA->ODR |=  (1UL << 1))

/* ---------------------------------------------------------------- main */
int main(void)
{
  uint16_t t;
  uint8_t  n;
  uint8_t  c;

  led_init();
  dbg_init();
  scan_init();

  dbg_puts("\r\n\r\n");
  dbg_puts("=====================================================\r\n");
  dbg_puts("  41-SCANNER-FORWARD   no I2C\r\n");
  dbg_puts("  scanner USART2 9600 (PA2/PA3) -> debug USART1 115200\r\n");
  dbg_puts("  TR = PA1 LOW 3s every 3s\r\n");
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
    /* ---- 触发：PA1 拉低 3 秒 ---- */
    dbg_puts("  TRIGGER LOW\r\n");
    GPIOA->ODR |=  (1UL << 11);            /* LED3 亮 = 正在扫 */
    TR_LOW();

    n = 0;
    for (t = 0; t < 3000U; t++)
    {
      if ((USART2->SR & USART_SR_RXNE) != 0U)
      {
        c = (uint8_t)(USART2->DR & 0xFFU);

        /* ---- 立刻转发到调试串口 ---- */
        dbg_puts("  RX[");
        dbg_u32(n);
        dbg_puts("] = ");
        dbg_hex8(c);
        dbg_puts(" '");
        dbg_putc((c >= 32U && c < 127U) ? (char)c : '.');
        dbg_puts("'\r\n");

        n++;
        GPIOB->ODR |= (1UL << 14);         /* LED1 常亮 = 收到过数据 */
      }
      delay_ms(1);
    }

    TR_HIGH();
    GPIOA->ODR &= ~(1UL << 11);            /* LED3 灭 */

    if (n == 0U)
    {
      dbg_puts("  --- timeout, nothing ---\r\n");
      GPIOB->ODR |= (1UL << 15);           /* LED2 亮 = 超时 */
    }
    else
    {
      dbg_puts("  END n=");
      dbg_u32(n);
      dbg_puts("\r\n\r\n");
      GPIOB->ODR &= ~(1UL << 15);
    }

    delay_ms(1000);
  }
}
