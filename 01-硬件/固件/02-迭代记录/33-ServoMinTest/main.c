/* ============================================================================
 *  33 · 分拣单元【最小舵机测试】v2
 * ----------------------------------------------------------------------------
 *  这一版直接用 stm32f10x.h（和 09 完全一样的写法），不再手写寄存器地址，
 *  舵机初始化部分逐行照抄 09-ServoSystemTest（那份在真机上验证过能转）。
 *
 *  现象：
 *      串口打印横幅（验证烧的是这份程序）
 *      4 颗灯循环亮
 *      PB10 / PB11 上两个舵机 1 秒正转 / 1 秒反转
 *
 *  接线：servo A -> U2（信号 PB10）
 *        servo B -> U3（信号 PB11）
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
  RCC->APB2ENR |= RCC_APB2ENR_IOPCEN;

  GPIOA->CRH &= ~(0xFFUL << 12);      /* PA11 PA12 */
  GPIOA->CRH |=  (0x22UL << 12);

  GPIOB->CRH &= ~(0xFFUL << 24);      /* PB14 PB15 */
  GPIOB->CRH |=  (0x22UL << 24);

  GPIOC->CRH &= ~(0xFUL << 20);       /* PC13 */
  GPIOC->CRH |=  (0x2UL << 20);
}

static void lamps(uint8_t n)
{
  GPIOB->ODR &= ~((1UL << 14) | (1UL << 15));
  GPIOA->ODR &= ~((1UL << 11) | (1UL << 12));

  if (n >= 1U) GPIOB->ODR |= (1UL << 14);
  if (n >= 2U) GPIOB->ODR |= (1UL << 15);
  if (n >= 3U) GPIOA->ODR |= (1UL << 11);
  if (n >= 4U) GPIOA->ODR |= (1UL << 12);
}

/* ---------------------------------------------------------------- 串口 */
static void uart_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_USART1EN;
  RCC->APB2ENR |= RCC_APB2ENR_AFIOEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;

  GPIOA->CRH &= ~(0xFFUL << 4);       /* PA9 TX, PA10 RX */
  GPIOA->CRH |=  (0xBUL << 4);        /* PA9  AF push-pull 50MHz */
  GPIOA->CRH |=  (0x4UL << 8);        /* PA10 input floating      */

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

/* ---------------------------------------------------------------- 舵机
 * 以下初始化逐行照抄 09-ServoSystemTest（已验证可转）
 * ------------------------------------------------------------------ */
static void servo_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;
  RCC->APB2ENR |= RCC_APB2ENR_AFIOEN;
  RCC->APB1ENR |= RCC_APB1ENR_TIM2EN;

  /* TIM2 CH3/CH4 默认在 PA2/PA3，部分重映射 2 才到 PB10/PB11 —— 必须！ */
  AFIO->MAPR &= ~AFIO_MAPR_TIM2_REMAP;
  AFIO->MAPR |=  AFIO_MAPR_TIM2_REMAP_PARTIALREMAP2;

  /* PB10 / PB11 -> 复用推挽 50MHz */
  GPIOB->CRH &= ~(0xFFUL << 8);
  GPIOB->CRH |=  (0xBBUL << 8);

  TIM2->PSC  = 71;
  TIM2->ARR  = 19999;

  TIM2->CCR3 = 1500;
  TIM2->CCR4 = 1500;

  TIM2->CCMR2 = TIM_CCMR2_OC3M_1 | TIM_CCMR2_OC3M_2 | TIM_CCMR2_OC3PE
              | TIM_CCMR2_OC4M_1 | TIM_CCMR2_OC4M_2 | TIM_CCMR2_OC4PE;

  TIM2->CCER |= TIM_CCER_CC3E | TIM_CCER_CC4E;

  /* 强制更新，PSC/ARR 立即生效 */
  TIM2->EGR = TIM_EGR_UG;
  TIM2->SR  = 0;

  TIM2->CR1 |= TIM_CR1_ARPE | TIM_CR1_CEN;
}

static void set_servo(uint8_t ch, uint16_t us)
{
  if (us < 500U)  us = 500U;
  if (us > 2500U) us = 2500U;
  if (ch == 1U) TIM2->CCR3 = us;
  else          TIM2->CCR4 = us;
}

/* ---------------------------------------------------------------- main */
int main(void)
{
  uint8_t k;

  led_init();
  lamps(0);
  uart_init();

  uart_puts("\r\n\r\n");
  uart_puts("=====================================================\r\n");
  uart_puts("  33-SERVOMIN-TEST  v2  (CMSIS, copied from 09)\r\n");
  uart_puts("  PB10 = servo A   PB11 = servo B\r\n");
  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    uart_puts("  clock: PLL 72MHz OK\r\n");
  }
  else
  {
    uart_puts("  clock: *** NOT PLL *** - crystal problem!\r\n");
  }
  uart_puts("=====================================================\r\n");

  servo_init();

  /* 开机 4 灯各亮一次 */
  for (k = 1U; k <= 4U; k++)
  {
    lamps(k);
    delay_ms(200);
  }
  lamps(0);
  delay_ms(300);

  while (1)
  {
    /* --- 正转 1 秒 --- */
    lamps(1);
    set_servo(1U, 2200U);
    set_servo(2U,  800U);
    delay_ms(1000);

    /* --- 反转 1 秒 --- */
    lamps(2);
    set_servo(1U,  800U);
    set_servo(2U, 2200U);
    delay_ms(1000);

    /* --- 停 1 秒 --- */
    lamps(3);
    set_servo(1U, 1500U);
    set_servo(2U, 1500U);
    delay_ms(1000);

    /* --- 灯扫一遍 --- */
    lamps(4);
    delay_ms(300);
    lamps(0);
    delay_ms(300);
  }
}
