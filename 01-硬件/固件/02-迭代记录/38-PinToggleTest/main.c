/* ============================================================================
 *  38 · 引脚高低电平翻转测试
 * ============================================================================
 *
 *  目的：**只验证一根引脚能不能被程序控制**，别的什么都不做。
 *
 *  默认引脚：PA1（识别单元扫码枪的触发脚 TR，接 CN1 第 1 脚）
 *
 *  行为：
 *      PA1 拉低 3 秒  ->  拉高 3 秒  ->  循环
 *      每次切换：串口打印 + PC13 跟着翻
 *
 *  怎么判断：
 *      万用表量 PA1 对 GND
 *        看到 0V 和 3.3V 每 3 秒交替  = 程序在跑、引脚正常
 *        一直 3.3V 或一直 0V          = 程序没跑（检查烧录）
 *
 *  想测别的引脚，只改下面 PIN_NUM 和 PIN_PORT 两个宏即可。
 * ========================================================================== */

#include "stm32f10x.h"

/* ★ 要测哪根脚就改这里 ★ */
#define PIN_PORT      GPIOA
#define PIN_NUM       1          /* PA1 = CN1 第 1 脚（扫码枪触发 TR） */

/* 切换周期（毫秒）*/
#define HALF_PERIOD_MS   3000U   /* 3 秒低、3 秒高 */

/* ---------------------------------------------------------------- 延时 */
static void delay_ms(uint32_t ms)
{
  volatile uint32_t n;
  while (ms--)
  {
    for (n = 0; n < 7200U; n++) { __asm volatile ("nop"); }
  }
}

/* ---------------------------------------------------------------- 串口 */
static void uart_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_USART1EN;
  RCC->APB2ENR |= RCC_APB2ENR_AFIOEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;

  GPIOA->CRH &= ~(0xFFUL << 4);
  GPIOA->CRH |=  (0xBUL << 4);        /* PA9 AF push-pull */
  GPIOA->CRH |=  (0x4UL << 8);        /* PA10 input float */

  USART1->BRR = 0x271U;               /* 72MHz / 115200 */
  USART1->CR1 = USART_CR1_UE | USART_CR1_TE | USART_CR1_RE;
}

static void uart_putc(char c)
{
  while ((USART1->SR & USART_SR_TXE) == 0U) { ; }
  USART1->DR = (uint16_t)(uint8_t)c;
}

static void uart_puts(const char *s)
{
  while (*s) { uart_putc(*s++); }
}

/* ---------------------------------------------------------------- 引脚 */
static void pin_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPCEN;

  /* 用预处理器分支，避免 PinNum < 8 时 else 分支的无符号下溢警告 */
#if (PIN_NUM < 8)
  PIN_PORT->CRL &= ~(0xFUL << (PIN_NUM * 4));
  PIN_PORT->CRL |=  (0x2UL << (PIN_NUM * 4));       /* 推挽输出 2MHz */
#else
  PIN_PORT->CRH &= ~(0xFUL << ((PIN_NUM - 8) * 4));
  PIN_PORT->CRH |=  (0x2UL << ((PIN_NUM - 8) * 4));
#endif

  /* PC13 板载灯 */
  GPIOC->CRH &= ~(0xFUL << 20);
  GPIOC->CRH |=  (0x2UL << 20);
  GPIOC->ODR |= (1UL << 13);
}

/* ---------------------------------------------------------------- main */
int main(void)
{
  uint8_t level = 0;      /* 0 = 低, 1 = 高 */

  pin_init();
  uart_init();

  uart_puts("\r\n\r\n");
  uart_puts("=====================================================\r\n");
  uart_puts("  38-PIN-TOGGLE-TEST\r\n");
  uart_puts("  PA1 (CN1 pin 1) : LOW 3s / HIGH 3s forever\r\n");
  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    uart_puts("  clock: PLL 72MHz OK\r\n");
  }
  else
  {
    uart_puts("  clock: *** NOT PLL ***\r\n");
  }
  uart_puts("=====================================================\r\n");

  /* 开机先把 PA1 拉低，方便万用表立刻看到 */
  PIN_PORT->ODR &= ~(1UL << PIN_NUM);
  GPIOC->ODR    &= ~(1UL << 13);        /* PC13 亮 = 当前低电平 */
  uart_puts("  PA1 = LOW\r\n");

  while (1)
  {
    delay_ms(HALF_PERIOD_MS);

    level = (uint8_t)(level ? 0U : 1U);

    if (level)
    {
      PIN_PORT->ODR |=  (1UL << PIN_NUM);   /* 高 */
      GPIOC->ODR    |=  (1UL << 13);        /* PC13 灭 */
      uart_puts("  PA1 = HIGH (3.3V)\r\n");
    }
    else
    {
      PIN_PORT->ODR &= ~(1UL << PIN_NUM);   /* 低 */
      GPIOC->ODR    &= ~(1UL << 13);        /* PC13 亮 */
      uart_puts("  PA1 = LOW  (0V)\r\n");
    }
  }
}
