/* ============================================================================
 *  37 · 识别单元挡片舵机独立测试（180° 位置舵机，PB11）
 * ----------------------------------------------------------------------------
 *  不用 I2C、不用 Nano，上电自动扫角度。
 *
 *  动作：0° -> 45° -> 90° -> 135° -> 180° -> 90°（回到放行位）-> 循环
 *        每个角度停 1 秒
 *
 *  串口（PA9/PA10，115200）每一步打印当前角度和脉宽
 *
 *  指示灯：
 *      PC13  每步翻一次
 *      PA11  0~90° 区间亮
 *      PB14  搭到 90° 时亮
 *
 *  注意：TIM2 CH4 默认在 PA3，必须部分重映射 2 才到 PB11（已处理）
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

  GPIOA->CRH &= ~(0xFUL << 12);       /* PA11 */
  GPIOA->CRH |=  (0x2UL << 12);

  GPIOB->CRH &= ~(0xFUL << 24);       /* PB14 */
  GPIOB->CRH |=  (0x2UL << 24);

  GPIOC->CRH &= ~(0xFUL << 20);       /* PC13 */
  GPIOC->CRH |=  (0x2UL << 20);

  GPIOC->ODR |= (1UL << 13);
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

/* ---------------------------------------------------------------- 舵机
 * TIM2_CH4 -> PB11（需要部分重映射 2）
 * 180° 舵机：0° -> 500us，180° -> 2500us
 * ------------------------------------------------------------------ */
static void servo_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;
  RCC->APB2ENR |= RCC_APB2ENR_AFIOEN;
  RCC->APB1ENR |= RCC_APB1ENR_TIM2EN;

  /* 关键：CH4 默认在 PA3，必须部分重映射 2 才到 PB11 */
  AFIO->MAPR &= ~AFIO_MAPR_TIM2_REMAP;
  AFIO->MAPR |=  AFIO_MAPR_TIM2_REMAP_PARTIALREMAP2;

  /* PB11 -> 复用推挽 50MHz (CRH bits 12..15) */
  GPIOB->CRH &= ~(0xFUL << 12);
  GPIOB->CRH |=  (0xBUL << 12);

  TIM2->PSC = 71;                     /* 1MHz，1 tick = 1us */
  TIM2->ARR = 19999;                  /* 20ms = 50Hz */

  TIM2->CCR4 = 1500;

  TIM2->CCMR2 &= ~(0xFFUL << 8);
  TIM2->CCMR2 |=  (TIM_CCMR2_OC4M_1 | TIM_CCMR2_OC4M_2 | TIM_CCMR2_OC4PE);

  TIM2->CCER |= TIM_CCER_CC4E;

  TIM2->EGR = TIM_EGR_UG;             /* 让 PSC/ARR 立即生效 */
  TIM2->SR  = 0;

  TIM2->CR1 |= TIM_CR1_ARPE | TIM_CR1_CEN;
}

/* 角度 -> 脉宽：0°=500us，180°=2500us */
static void servo_deg(uint8_t deg)
{
  uint16_t us;
  if (deg > 180U) deg = 180U;
  us = (uint16_t)(500U + ((uint16_t)deg * 2000U) / 180U);
  TIM2->CCR4 = us;
}

/* ---------------------------------------------------------------- main */
int main(void)
{
  const uint8_t seq[7] = { 0U, 45U, 90U, 135U, 180U, 90U, 0U };
  uint8_t k;
  uint16_t us;

  led_init();
  uart1_init();

  uart1_puts("\r\n\r\n");
  uart1_puts("=====================================================\r\n");
  uart1_puts("  37-GATE-SERVO-TEST   180 deg servo on PB11\r\n");
  uart1_puts("  sweep: 0-45-90-135-180-90-0\r\n");
  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    uart1_puts("  clock: PLL 72MHz OK\r\n");
  }
  else
  {
    uart1_puts("  clock: *** NOT PLL ***\r\n");
  }
  uart1_puts("=====================================================\r\n\r\n");

  servo_init();

  /* 先回 90° 中位 */
  servo_deg(90);
  delay_ms(800);

  while (1)
  {
    for (k = 0; k < 7U; k++)
    {
      servo_deg(seq[k]);
      us = (uint16_t)(500U + ((uint16_t)seq[k] * 2000U) / 180U);

      /* PC13 每步翻一次 */
      GPIOC->ODR ^= (1UL << 13);

      /* 指示灯：0~90 亮 PA11，>=90 亮 PB14 */
      if (seq[k] < 90U) { GPIOA->ODR |= (1UL << 11); GPIOB->ODR &= ~(1UL << 14); }
      else              { GPIOA->ODR &= ~(1UL << 11); GPIOB->ODR |= (1UL << 14); }

      uart1_puts("  angle = ");
      uart1_u32(seq[k]);
      uart1_puts(" deg   pulse = ");
      uart1_u32(us);
      uart1_puts(" us\r\n");

      delay_ms(1000);
    }
    uart1_puts("  --- cycle repeat ---\r\n\r\n");
    delay_ms(500);
  }
}
