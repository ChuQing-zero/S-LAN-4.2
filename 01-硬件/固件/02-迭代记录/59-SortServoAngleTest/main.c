/* ============================================================================
 *  59 · 分拣单元舵机角度测试（判断 180° 位置舵机 / 360° 连续舵机）
 * ============================================================================
 *
 *  【用途】
 *  烧到分拣单元板（UNIT 板，0x20~0x23 任意一块），不用 I2C、不用 Nano。
 *  上电后两个舵机自动按角度扫描，用来判断它们到底是哪种舵机：
 *
 *      180° 位置舵机  ->  每个角度会"停住不动"
 *      360° 连续舵机  ->  一直转，停不住
 *
 *  【引脚（UNIT 板网表）】
 *      SERVO1 = PB10  (TIM2_CH3)
 *      SERVO2 = PB11  (TIM2_CH4)
 *      LED1   = PB14
 *      LED2   = PB15
 *      LED3   = PA11
 *      LED4   = PA12
 *      PC13   = 板上无灯（空脚，代码里保留心跳但看不到）
 *
 *  【扫描动作（每步停 1.5 秒，方便肉眼判断）】
 *      0° -> 45° -> 90° -> 135° -> 180° -> 135° -> 90° -> 45° -> 0° -> 循环
 *
 *  【串口（H2 排针 PA9/PA10，115200）】
 *      每步打印：  angle = 45 deg   pulse = 1000 us   CH3/CH4
 *
 *  【判断方法】
 *      停在某角度不动  -> 180° 位置舵机
 *      缓慢一直转      -> 360° 连续舵机（1500us 是停止点）
 *      剧烈抖动/顶死   -> 行程超出机械范围，需要减小脉宽范围
 *
 *  【脉宽范围】
 *      默认 500us ~ 2500us（0° ~ 180°）
 *      如果舵机只支持 1000us~2000us，把 PULSE_MIN / PULSE_MAX 改成 1000 / 2000
 * ========================================================================== */

#include "stm32f10x.h"

/* ★ 脉宽范围：不同舵机不一样，按需修改 ★ */
#define PULSE_MIN     500U       /* 0°   】
#define PULSE_MID    1500U       /* 90°  |  180° 舵机常见范围 500~2500 */
#define PULSE_MAX    2500U       /* 180° */

/* 每步停留时间（毫秒）*/
#define STEP_HOLD_MS  1500U

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

  GPIOA->CRH &= ~(0xFUL << 12);        /* PA11 */
  GPIOA->CRH |=  (0x2UL << 12);
  GPIOA->CRH &= ~(0xFUL << 16);        /* PA12 */
  GPIOA->CRH |=  (0x2UL << 16);

  GPIOB->CRH &= ~(0xFUL << 24);        /* PB14 */
  GPIOB->CRH |=  (0x2UL << 24);
  GPIOB->CRH &= ~(0xFUL << 28);        /* PB15 */
  GPIOB->CRH |=  (0x2UL << 28);

  GPIOC->CRH &= ~(0xFUL << 20);        /* PC13 */
  GPIOC->CRH |=  (0x2UL << 20);
  GPIOC->ODR |= (1UL << 13);

  GPIOA->ODR &= ~((1UL << 11) | (1UL << 12));
  GPIOB->ODR &= ~((1UL << 14) | (1UL << 15));
}

/* ---------------------------------------------------------------- 串口1 */
static void uart1_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_USART1EN;
  RCC->APB2ENR |= RCC_APB2ENR_AFIOEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;

  GPIOA->CRH &= ~(0xFFUL << 4);
  GPIOA->CRH |=  (0xBUL << 4);         /* PA9  AF 推挽 */
  GPIOA->CRH |=  (0x4UL << 8);         /* PA10 浮空输入 */

  USART1->BRR = 0x271U;                /* 72MHz / 115200 */
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
 * TIM2_CH3 -> PB10,  TIM2_CH4 -> PB11
 * 必须部分重映射 2，否则 CH3/CH4 在 PA2/PA3
 * ------------------------------------------------------------------ */
static void servo_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;
  RCC->APB2ENR |= RCC_APB2ENR_AFIOEN;
  RCC->APB1ENR |= RCC_APB1ENR_TIM2EN;

  /* 部分重映射 2：CH3 -> PB10，CH4 -> PB11 */
  AFIO->MAPR &= ~AFIO_MAPR_TIM2_REMAP;
  AFIO->MAPR |=  AFIO_MAPR_TIM2_REMAP_PARTIALREMAP2;

  /* PB10 -> 复用推挽 50MHz (CRH bits 8..11) */
  GPIOB->CRH &= ~(0xFUL << 8);
  GPIOB->CRH |=  (0xBUL << 8);
  /* PB11 -> 复用推挽 50MHz (CRH bits 12..15) */
  GPIOB->CRH &= ~(0xFUL << 12);
  GPIOB->CRH |=  (0xBUL << 12);

  TIM2->PSC = 71;                      /* 72MHz/72 = 1MHz，1 tick = 1us */
  TIM2->ARR = 19999;                   /* 20ms 周期 = 50Hz */

  TIM2->CCR3 = PULSE_MID;              /* CH3 默认 90° */
  TIM2->CCR4 = PULSE_MID;              /* CH4 默认 90° */

  /* CH3：PWM 模式 1 + 预装载 */
  TIM2->CCMR2 &= ~(0xFFUL << 0);
  TIM2->CCMR2 |=  (TIM_CCMR2_OC3M_1 | TIM_CCMR2_OC3M_2 | TIM_CCMR2_OC3PE);
  /* CH4：PWM 模式 1 + 预装载 */
  TIM2->CCMR2 &= ~(0xFFUL << 8);
  TIM2->CCMR2 |=  (TIM_CCMR2_OC4M_1 | TIM_CCMR2_OC4M_2 | TIM_CCMR2_OC4PE);

  TIM2->CCER |= TIM_CCER_CC3E;
  TIM2->CCER |= TIM_CCER_CC4E;

  TIM2->EGR = TIM_EGR_UG;              /* 让 PSC/ARR 立即生效（必须！） */
  TIM2->SR  = 0;

  TIM2->CR1 |= TIM_CR1_ARPE | TIM_CR1_CEN;
}

/* 角度(0~180) -> 脉宽(us) */
static uint16_t deg_to_pulse(uint8_t deg)
{
  if (deg > 180U) deg = 180U;
  return (uint16_t)(PULSE_MIN + ((uint32_t)(PULSE_MAX - PULSE_MIN) * deg / 180U));
}

/* 同时设置两个舵机到指定角度 */
static void servo_set(uint8_t deg)
{
  uint16_t p = deg_to_pulse(deg);
  TIM2->CCR3 = p;
  TIM2->CCR4 = p;
}

/* 只设 CH3（A 舵机） */
static void servo_a(uint8_t deg) { TIM2->CCR3 = deg_to_pulse(deg); }
/* 只设 CH4（B 舵机） */
static void servo_b(uint8_t deg) { TIM2->CCR4 = deg_to_pulse(deg); }

/* ---------------------------------------------------------------- 测试步骤 */
static const uint8_t STEPS[9] = { 0, 45, 90, 135, 180, 135, 90, 45, 0 };

/* ---------------------------------------------------------------- main */
int main(void)
{
  uint8_t i;
  uint16_t p;

  led_init();
  uart1_init();
  servo_init();

  uart1_puts("\r\n\r\n");
  uart1_puts("=====================================================\r\n");
  uart1_puts("  59-SORT-SERVO-ANGLE-TEST\r\n");
  uart1_puts("  SERVO1 = PB10 (TIM2_CH3)\r\n");
  uart1_puts("  SERVO2 = PB11 (TIM2_CH4)\r\n");
  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    uart1_puts("  clock: PLL 72MHz OK\r\n");
  }
  else
  {
    uart1_puts("  clock: *** NOT PLL ***\r\n");
  }
  uart1_puts("-----------------------------------------------------\r\n");
  uart1_puts("  pulse range: ");
  uart1_u32(PULSE_MIN);
  uart1_puts(" ~ ");
  uart1_u32(PULSE_MAX);
  uart1_puts(" us\r\n");
  uart1_puts("  sweep: 0-45-90-135-180-135-90-45-0  hold 1.5s\r\n");
  uart1_puts("-----------------------------------------------------\r\n");
  uart1_puts("  HOW TO JUDGE:\r\n");
  uart1_puts("    stops at each angle  -> 180 deg POSITIONAL servo\r\n");
  uart1_puts("    keeps spinning       -> 360 deg CONTINUOUS servo\r\n");
  uart1_puts("    shaking / stuck      -> travel too large, reduce range\r\n");
  uart1_puts("=====================================================\r\n\r\n");

  /* 先都回到 90° 停 2 秒，方便观察上电状态 */
  servo_set(90);
  delay_ms(2000);

  while (1)
  {
    for (i = 0; i < 9; i++)
    {
      p = deg_to_pulse(STEPS[i]);
      servo_set(STEPS[i]);

      uart1_puts("  angle = ");
      uart1_u32(STEPS[i]);
      uart1_puts(" deg   pulse = ");
      uart1_u32(p);
      uart1_puts(" us   (CH3 & CH4)\r\n");

      /* 灯指示当前角度档位 */
      if (STEPS[i] == 0U)         { GPIOB->ODR |=  (1UL << 14); } else { GPIOB->ODR &= ~(1UL << 14); }
      if (STEPS[i] == 90U)        { GPIOB->ODR |=  (1UL << 15); } else { GPIOB->ODR &= ~(1UL << 15); }
      if (STEPS[i] == 180U)       { GPIOA->ODR |=  (1UL << 11); } else { GPIOA->ODR &= ~(1UL << 11); }

      /* 心跳 */
      GPIOC->ODR ^= (1UL << 13);

      delay_ms(STEP_HOLD_MS);
    }

    uart1_puts("  ---- one round done, repeat ----\r\n\r\n");
  }
}
