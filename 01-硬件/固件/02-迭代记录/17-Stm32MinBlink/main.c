/*
 * ============================================================================
 *  STM32 最小测试：只闪灯，【完全不碰 I²C】
 * ============================================================================
 *
 *  目的：确认"新烧进去的程序到底有没有在跑"。
 *        如果这个都不亮，那跟 I²C、跟 Nano 一点关系都没有，
 *        是下载没成功 / 芯片没跑 / 焊接问题。
 *
 *  现象（很显眼，不会跟别的程序混淆）：
 *      4 颗灯从 LED1 到 LED4 依次亮，每颗 200ms，走到头全部灭
 *      PC13 板载灯在每一步都跟着反转一次
 *      一轮大约 1 秒，一直循环
 *
 *  灯的位置（按你的 UNIT 板）：
 *      LED1 = PB14      LED2 = PB15      LED3 = PA11      LED4 = PA12
 *      PC13 = 板载灯
 *
 *  建工程：和 STM32\03~10 一样，普通 Keil 工程，不需要 CubeMX
 * ============================================================================
 */

#include <stdint.h>

/* ---------- 寄存器地址 ---------- */
#define RCC_APB2ENR   (*(volatile uint32_t *)0x40021018)
#define GPIOA_CRH     (*(volatile uint32_t *)0x40010804)
#define GPIOA_ODR     (*(volatile uint32_t *)0x4001080C)
#define GPIOB_CRH     (*(volatile uint32_t *)0x40010C04)
#define GPIOB_ODR     (*(volatile uint32_t *)0x40010C0C)
#define GPIOC_CRH     (*(volatile uint32_t *)0x40011004)
#define GPIOC_ODR     (*(volatile uint32_t *)0x4001100C)

#define RCC_IOPAEN    (1UL << 2)
#define RCC_IOPBEN    (1UL << 3)
#define RCC_IOPCEN    (1UL << 4)

/* ---------- 引脚 ---------- */
#define LED1  14    /* PB14 */
#define LED2  15    /* PB15 */
#define LED3  11    /* PA11 */
#define LED4  12    /* PA12 */
#define HB    13    /* PC13 */

/* ---------- 简单延时（不精确，够看灯用） ---------- */
static void delay_loops(volatile uint32_t n)
{
  while (n--) { __asm volatile ("nop"); }
}

static void delay_ms(uint32_t ms)
{
  /* 72MHz 下约 7200 次循环 = 1ms；不准也没关系 */
  while (ms--) { delay_loops(7200); }
}

/* ---------- 初始化 GPIO 为推挽输出 ---------- */
static void gpio_init(void)
{
  RCC_APB2ENR |= (RCC_IOPAEN | RCC_IOPBEN | RCC_IOPCEN);

  /* 每个引脚占 4 位：0x2 = 输出推挽 2MHz */
  GPIOB_CRH &= ~((0xFUL << 24) | (0xFUL << 28));   /* PB14 PB15 */
  GPIOB_CRH |=  ((2UL  << 24) | (2UL  << 28));

  GPIOA_CRH &= ~((0xFUL << 12) | (0xFUL << 16));   /* PA11 PA12 */
  GPIOA_CRH |=  ((2UL  << 12) | (2UL  << 16));

  GPIOC_CRH &= ~(0xFUL << 20);                     /* PC13 */
  GPIOC_CRH |=  (2UL  << 20);
}

static void led_on(uint8_t which)
{
  switch (which) {
    case 1: GPIOB_ODR |= (1UL << LED1); break;
    case 2: GPIOB_ODR |= (1UL << LED2); break;
    case 3: GPIOA_ODR |= (1UL << LED3); break;
    case 4: GPIOA_ODR |= (1UL << LED4); break;
  }
}

static void led_off(uint8_t which)
{
  switch (which) {
    case 1: GPIOB_ODR &= ~(1UL << LED1); break;
    case 2: GPIOB_ODR &= ~(1UL << LED2); break;
    case 3: GPIOA_ODR &= ~(1UL << LED3); break;
    case 4: GPIOA_ODR &= ~(1UL << LED4); break;
  }
}

static void all_off(void)
{
  GPIOB_ODR &= ~((1UL << LED1) | (1UL << LED2));
  GPIOA_ODR &= ~((1UL << LED3) | (1UL << LED4));
}

int main(void)
{
  uint8_t i, k;

  gpio_init();
  all_off();

  /* 开机先把 4 颗灯一起闪 3 下 —— 一眼看出程序跑没跑 */
  for (i = 0; i < 3; i++) {
    led_on(1); led_on(2); led_on(3); led_on(4);
    GPIOC_ODR |=  (1UL << HB);
    delay_ms(150);
    all_off();
    GPIOC_ODR &= ~(1UL << HB);
    delay_ms(150);
  }

  while (1) {
    for (k = 1; k <= 4; k++) {
      led_on(k);
      GPIOC_ODR ^= (1UL << HB);      /* 每步翻一次板载灯 */
      delay_ms(200);
      led_off(k);
    }
    delay_ms(200);
  }
}
