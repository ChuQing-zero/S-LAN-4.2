/* ============================================================================
 *  34 · 分拣单元舵机测试（最简版）
 * ----------------------------------------------------------------------------
 *  上电自动执行，不需要 Nano、不需要 I2C、不需要串口（串口只是方便验证）：
 *
 *      PC13 慢闪 3 下（证明程序在跑）
 *      舵机A / 舵机B：正转 2 秒 -> 停 1 秒 -> 反转 2 秒 -> 停 1 秒 -> 循环
 *      4 颗指示灯跟着动作变化
 *
 *  ★ 用法（重要）：
 *    不要"添加"这个文件到工程，而是【复制全文，粘贴覆盖】
 *    你 Keil 工程里正在编译的那个 main.c（编译日志里显示的那个文件），
 *    然后 F7 编译、F8 下载。
 *    这样就不会出现"改了文件但工程编的还是旧文件"的情况。
 *
 *  舵机接插件：
 *      servo A -> U2（信号 PB10）
 *      servo B -> U3（信号 PB11）
 * ========================================================================== */

#include "stm32f10x.h"

/* ============================================================== 延时 */
static void delay_ms(uint32_t ms)
{
  volatile uint32_t n;
  while (ms--)
  {
    for (n = 0; n < 7200U; n++) { __asm volatile ("nop"); }
  }
}

/* ============================================================== 灯 */
static void gpio_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPCEN;

  GPIOA->CRH &= ~(0xFFUL << 12);     /* PA11 PA12（灯） */
  GPIOA->CRH |=  (0x22UL << 12);

  GPIOB->CRH &= ~(0xFFUL << 24);     /* PB14 PB15（灯） */
  GPIOB->CRH |=  (0x22UL << 24);

  GPIOC->CRH &= ~(0xFUL << 20);      /* PC13（板载灯） */
  GPIOC->CRH |=  (0x2UL << 20);

  /* PC13 在多数板子上是低电平点亮，先关掉 */
  GPIOC->ODR |=  (1UL << 13);
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

/* ============================================================== 串口
 * 只是方便确认烧的是这份程序。不接串口也不影响舵机。
 * ------------------------------------------------------------------ */
static void uart_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_USART1EN;
  RCC->APB2ENR |= RCC_APB2ENR_AFIOEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;

  GPIOA->CRH &= ~(0xFFUL << 4);
  GPIOA->CRH |=  (0xBUL << 4);       /* PA9  AF push-pull */
  GPIOA->CRH |=  (0x4UL << 8);       /* PA10 input float  */

  USART1->BRR = 0x271U;              /* 72MHz / 115200 */
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

/* ============================================================== 舵机
 * 初始化与 09-ServoSystemTest 完全一致（那份已验证可转）
 * ------------------------------------------------------------------ */
static void servo_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;
  RCC->APB2ENR |= RCC_APB2ENR_AFIOEN;
  RCC->APB1ENR |= RCC_APB1ENR_TIM2EN;

  /* TIM2 CH3/CH4 默认在 PA2/PA3，部分重映射 2 才到 PB10/PB11 */
  AFIO->MAPR &= ~AFIO_MAPR_TIM2_REMAP;
  AFIO->MAPR |=  AFIO_MAPR_TIM2_REMAP_PARTIALREMAP2;

  GPIOB->CRH &= ~(0xFFUL << 8);
  GPIOB->CRH |=  (0xBBUL << 8);

  TIM2->PSC  = 71;
  TIM2->ARR  = 19999;

  TIM2->CCR3 = 1500;
  TIM2->CCR4 = 1500;

  TIM2->CCMR2 = TIM_CCMR2_OC3M_1 | TIM_CCMR2_OC3M_2 | TIM_CCMR2_OC3PE
              | TIM_CCMR2_OC4M_1 | TIM_CCMR2_OC4M_2 | TIM_CCMR2_OC4PE;

  TIM2->CCER |= TIM_CCER_CC3E | TIM_CCER_CC4E;

  TIM2->EGR = TIM_EGR_UG;
  TIM2->SR  = 0;

  TIM2->CR1 |= TIM_CR1_ARPE | TIM_CR1_CEN;
}

static void s1(uint16_t us) { TIM2->CCR3 = us; }
static void s2(uint16_t us) { TIM2->CCR4 = us; }

/* ============================================================== main */
int main(void)
{
  uint8_t i;

  gpio_init();
  uart_init();
  lamps(0);

  /* ---- 开机横幅：确认烧的是这一份 ---- */
  uart_puts("\r\n\r\n");
  uart_puts("=====================================================\r\n");
  uart_puts("  34-SERVO-TEST     forward 2s / stop 1s / reverse 2s\r\n");
  uart_puts("  PB10 = servo A    PB11 = servo B\r\n");
  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    uart_puts("  clock: PLL 72MHz OK\r\n");
  }
  else
  {
    uart_puts("  clock: *** NOT PLL ***\r\n");
  }
  uart_puts("=====================================================\r\n");

  servo_init();

  /* ---- 开机 PC13 慢闪 3 下 ---- */
  for (i = 0; i < 3U; i++)
  {
    GPIOC->ODR &= ~(1UL << 13);
    delay_ms(200);
    GPIOC->ODR |=  (1UL << 13);
    delay_ms(200);
  }

  /* 舵机先停稳 1 秒 */
  s1(1500);
  s2(1500);
  delay_ms(1000);

  while (1)
  {
    /* ---------- 正转 2 秒 ---------- */
    lamps(1);
    GPIOC->ODR &= ~(1UL << 13);      /* PC13 亮 = 正在动作 */
    s1(2200);
    s2(2200);
    delay_ms(2000);

    /* ---------- 停 1 秒 ---------- */
    s1(1500);
    s2(1500);
    GPIOC->ODR |= (1UL << 13);
    lamps(2);
    delay_ms(1000);

    /* ---------- 反转 2 秒 ---------- */
    lamps(3);
    GPIOC->ODR &= ~(1UL << 13);
    s1(800);
    s2(800);
    delay_ms(2000);

    /* ---------- 停 1 秒 ---------- */
    s1(1500);
    s2(1500);
    GPIOC->ODR |= (1UL << 13);
    lamps(4);
    delay_ms(1000);

    lamps(0);
    delay_ms(200);
  }
}
