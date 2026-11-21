/* ============================================================================
 *  S-LAN V4.0  --  Two Servo Test  (bare metal, no HAL, no CubeMX)
 *
 *  MCU   : STM32F103x  (Blue Pill)
 *  Build : Keil MDK-ARM 5  +  ARM Compiler 5
 *  Date  : 2026-09-21
 *
 *  ---------------------------------------------------------------------------
 *  WHY THIS FILE EXISTS
 *      It uses no library at all - just the CMSIS register definitions that
 *      come with the Keil device pack. So you can run it in a plain Keil
 *      project without installing STM32CubeMX.
 *
 *  ---------------------------------------------------------------------------
 *  PROJECT SETUP (do this once, in Keil)
 *      1. Project -> Manage -> Run-Time Environment
 *         tick  [x] CMSIS -> CORE            (processor support)
 *         tick  [x] Device -> Startup        (reset handler + vector table)
 *      2. Also keep system_stm32f10x.c in the project.
 *         It provides SystemInit(), which the startup file calls, and it
 *         already raises the clock to 72 MHz.
 *      3. Replace main.c with this file.
 *      4. Build (F7).  Download (F8).
 *      5. Options for Target -> Flash Download -> tick "Reset and Run",
 *         otherwise the chip keeps running the old program after a download.
 *
 *  ---------------------------------------------------------------------------
 *  WIRING
 *      Servo 1 signal (orange)  ->  PB10
 *      Servo 2 signal (orange)  ->  PB11
 *      Servo   +5V    (red)     ->  external 5V supply  +
 *      Servo   GND    (brown)   ->  external 5V supply  -
 *                                   AND to Blue Pill GND    <-- common ground
 *
 *      WARNING: never power the servos from the Blue Pill 5V pin.
 * ============================================================================
 */

/* ---------------------------------------------------------------------------
 *  Device header.
 *
 *  This Keil device pack is the older generation: the header is called
 *  stm32f10x.h (not stm32f1xx.h), and it refuses to compile unless one
 *  density symbol is defined first.
 *
 *      STM32F10X_LD  low density      16 / 32 KB flash   (F103x4, F103x6)
 *      STM32F10X_MD  medium density   64 / 128 KB flash  (F103x8, F103xB)
 *
 *  The project's startup file is startup_stm32f10x_ld.s, so LD it is.
 *  If you later switch the Keil device to STM32F103C8, change LD to MD here.
 * ------------------------------------------------------------------------ */
#if !defined(STM32F10X_LD)      && !defined(STM32F10X_LD_VL) \
 && !defined(STM32F10X_MD)      && !defined(STM32F10X_MD_VL) \
 && !defined(STM32F10X_HD)      && !defined(STM32F10X_HD_VL) \
 && !defined(STM32F10X_XL)      && !defined(STM32F10X_CL)
  #define STM32F10X_LD
#endif

#include "stm32f10x.h"


/* ---- Mode ------------------------------------------------------------- */

/* 0 = sweep mode      - servo runs back and forth, just to see it move.
 * 1 = measure mode    - servo parks at 0 deg, holds, then parks at 180 deg,
 *                       holds, and repeats. Use this to measure the real
 *                       travel angle with a protractor.
 */
#define MEASURE_MODE     1

/* How long the servo holds still at each end, in milliseconds. */
#define PARK_MS          4000


/* ---- Tunables --------------------------------------------------------- */

/* Servo pulse width range, in microseconds.
 * MG90S:  500us ~ 0 deg,  1500us ~ 90 deg,  2500us ~ 180 deg
 * If a servo buzzes at the ends, narrow these to 700 / 2300.
 */
#define SERVO_MIN_US     500
#define SERVO_MAX_US     2500

/* Sweep speed, used in sweep mode only. */
#define STEP_DEG         3
#define STEP_DELAY_MS    20


/* ---- Globals ---------------------------------------------------------- */

static volatile uint32_t g_ms = 0;   /* millisecond counter, incremented by SysTick */


/* ---- Prototypes ------------------------------------------------------- */

void        SysTick_Handler(void);   /* overrides the weak one in the startup file */
static void led_init(void);
static void clock_init(void);
static void servo_init(void);
static void systick_init(void);
static void delay_ms(uint32_t ms);
static void servo_set_angle(uint32_t ch, uint8_t deg);
static void run_sweep(void);
static void run_measure(void);


/* ========================================================================== */
/*  Interrupt handler                                                         */
/* ========================================================================== */

void SysTick_Handler(void)
{
  g_ms++;
}


/* ========================================================================== */
/*  main                                                                      */
/* ========================================================================== */

int main(void)
{
  /* ---- Heartbeat LED ----------------------------------------------------
   * This drives PC13, the small LED already soldered on the Blue Pill.
   * It tells you which of three things is going on:
   *
   *     dark, never lights at all   -> the program never started
   *                                    (check BOOT0 jumper, press reset)
   *     on solid, never blinks      -> stuck in clock_init(): the 8 MHz
   *                                    crystal is not starting
   *     toggling                    -> the program IS running fine
   * -------------------------------------------------------------------- */
  led_init();
  GPIOC->ODR &= ~(1UL << 13);        /* LED on immediately (active low) */

  clock_init();      /* 8 MHz crystal -> 72 MHz */
  servo_init();      /* TIM2 PWM on PB10 / PB11 */
  systick_init();    /* 1 ms tick for delay_ms() */

  /* Park both servos at 90 degrees for half a second, then start */
  servo_set_angle(3, 90);
  servo_set_angle(4, 90);
  delay_ms(500);

#if MEASURE_MODE
  run_measure();
#else
  run_sweep();
#endif
}


/* ========================================================================== */
/*  Sweep mode:  0 -> 180 -> 0, forever                                       */
/* ========================================================================== */

static void run_sweep(void)
{
  int d;

  while (1)
  {
    /* Forward sweep: 0 -> 180 degrees */
    for (d = 0; d <= 180; d += STEP_DEG)
    {
      servo_set_angle(3, (uint8_t)d);
      servo_set_angle(4, (uint8_t)d);
      delay_ms(STEP_DELAY_MS);
    }

    GPIOC->ODR ^= (1UL << 13);          /* heartbeat blink, once per sweep */

    delay_ms(300);

    /* Backward sweep: 180 -> 0 degrees */
    for (d = 180; d >= 0; d -= STEP_DEG)
    {
      servo_set_angle(3, (uint8_t)d);
      servo_set_angle(4, (uint8_t)d);
      delay_ms(STEP_DELAY_MS);
    }

    delay_ms(300);
  }
}


/* ========================================================================== */
/*  Measure mode:  park at 0, hold, park at 180, hold, forever                */
/* ========================================================================== */

/* While parked at 180 degrees the onboard LED is OFF, so you can tell the
 * two positions apart without a stopwatch.
 */
static void run_measure(void)
{
  while (1)
  {
    /* ---- Position A: 0 degrees ---- */
    servo_set_angle(3, 0);
    servo_set_angle(4, 0);
    GPIOC->ODR |= (1UL << 13);          /* LED off */
    delay_ms(PARK_MS);

    /* ---- Position B: 180 degrees ---- */
    servo_set_angle(3, 180);
    servo_set_angle(4, 180);
    GPIOC->ODR &= ~(1UL << 13);         /* LED on  */
    delay_ms(PARK_MS);
  }
}


/* ========================================================================== */
/*  Heartbeat LED:  PC13, the LED already on the Blue Pill                    */
/* ========================================================================== */

/* PC13 lives in GPIOC->CRH, four bits at offset (13 - 8) * 4 = 20.
 *     MODE = 10  (output, 2 MHz - PC13 is a weak pin, keep it slow)
 *     CNF  = 00  (general purpose push-pull)
 * The LED is wired active LOW: driving the pin to 0 turns it on.
 */
static void led_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPCEN;

  GPIOC->CRH &= ~(0xFUL << 20);
  GPIOC->CRH |=  (0x2UL << 20);

  GPIOC->ODR |= (1UL << 13);          /* start with the LED off */
}


/* ========================================================================== */
/*  Clock:  8 MHz HSE  x9 PLL  =  72 MHz                                      */
/* ========================================================================== */

/* system_stm32f10x.c has already done this inside SystemInit().
 * It is repeated here on purpose, so that this file also works if that
 * file is ever removed from the project.
 */
static void clock_init(void)
{
  /* Flash: prefetch on, 2 wait states. Required above 48 MHz. */
  FLASH->ACR = FLASH_ACR_PRFTBE | FLASH_ACR_LATENCY_2;

  /* Start the 8 MHz crystal and wait for it to stabilise */
  RCC->CR |= RCC_CR_HSEON;
  while ((RCC->CR & RCC_CR_HSERDY) == 0)
  {
  }

  /* Bus prescalers + PLL config:
   *   AHB  = 72 MHz  (div 1)
   *   APB1 = 36 MHz  (div 2)   -> TIM2 clock is x2 = 72 MHz
   *   APB2 = 72 MHz  (div 1)
   *   PLL source = HSE, PLL multiplier = x9
   */
  RCC->CFGR = RCC_CFGR_HPRE_DIV1
            | RCC_CFGR_PPRE1_DIV2
            | RCC_CFGR_PPRE2_DIV1
            | RCC_CFGR_PLLSRC
            | RCC_CFGR_PLLMULL9;

  /* Start the PLL and wait for lock */
  RCC->CR |= RCC_CR_PLLON;
  while ((RCC->CR & RCC_CR_PLLRDY) == 0)
  {
  }

  /* Switch the system clock over to the PLL */
  RCC->CFGR |= RCC_CFGR_SW_PLL;
  while ((RCC->CFGR & RCC_CFGR_SWS) != RCC_CFGR_SWS_PLL)
  {
  }
}


/* ========================================================================== */
/*  Servo:  TIM2 channel 3 + 4, 50 Hz PWM                                     */
/* ========================================================================== */

static void servo_init(void)
{
  /* Turn on the peripheral clocks we need */
  RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;    /* GPIOB */
  RCC->APB2ENR |= RCC_APB2ENR_AFIOEN;    /* AFIO - needed for the pin remap below */
  RCC->APB1ENR |= RCC_APB1ENR_TIM2EN;    /* TIM2  */

  /* ---------------------------------------------------------------------
   * TIM2 remap - THIS IS MANDATORY.
   *
   * TIM2 channel 3 and 4 come out on PA2 / PA3 by default. To get them on
   * PB10 / PB11 you must select the partial remap, otherwise PB10 / PB11
   * output nothing at all and the servos sit still.
   *
   *   TIM2_REMAP = 00  ->  CH3 = PA2,  CH4 = PA3
   *   TIM2_REMAP = 10  ->  CH3 = PB10, CH4 = PB11   <-- what we want
   * ------------------------------------------------------------------ */
  AFIO->MAPR &= ~AFIO_MAPR_TIM2_REMAP;
  AFIO->MAPR |=  AFIO_MAPR_TIM2_REMAP_PARTIALREMAP2;

  /* PB10 and PB11 -> alternate function push-pull, 50 MHz
   *
   * GPIOB->CRH covers pins 8..15, four bits per pin:
   *     PB10 -> bits  8..11
   *     PB11 -> bits 12..15
   * Each nibble is CNF[1:0] : MODE[1:0]
   *     MODE = 11  (output, 50 MHz)
   *     CNF  = 10  (alternate function push-pull)
   * so each nibble = 0b1011 = 0xB
   */
  GPIOB->CRH &= ~(0xFFUL << 8);
  GPIOB->CRH |=  (0xBBUL << 8);

  /* TIM2 runs from 72 MHz.
   *   PSC = 71    -> 72 MHz / 72 = 1 MHz, so 1 tick = 1 microsecond
   *   ARR = 19999 -> 20000 us = 20 ms period = 50 Hz
   */
  TIM2->PSC  = 71;
  TIM2->ARR  = 19999;

  /* Start both channels at 1500 us = 90 degrees */
  TIM2->CCR3 = 1500;
  TIM2->CCR4 = 1500;

  /* PWM mode 1 on channel 3 and 4, with output-compare preload enabled */
  TIM2->CCMR2 = TIM_CCMR2_OC3M_1 | TIM_CCMR2_OC3M_2 | TIM_CCMR2_OC3PE
              | TIM_CCMR2_OC4M_1 | TIM_CCMR2_OC4M_2 | TIM_CCMR2_OC4PE;

  /* Enable the two outputs (active high is the default polarity) */
  TIM2->CCER |= TIM_CCER_CC3E | TIM_CCER_CC4E;

  /* Generate an update event so PSC / ARR / CCR take effect right away,
   * otherwise the first period would run with the reset value of ARR.
   */
  TIM2->EGR = TIM_EGR_UG;
  TIM2->SR  = 0;                        /* clear the update flag */

  /* Auto-reload preload + start the counter */
  TIM2->CR1 |= TIM_CR1_ARPE | TIM_CR1_CEN;
}


/* ========================================================================== */
/*  Delay:  1 ms SysTick                                                      */
/* ========================================================================== */

static void systick_init(void)
{
  SysTick->LOAD = 72000UL - 1UL;        /* 1 ms at 72 MHz */
  SysTick->VAL  = 0UL;
  SysTick->CTRL = SysTick_CTRL_CLKSOURCE_Msk    /* core clock, not core/8 */
                | SysTick_CTRL_TICKINT_Msk      /* enable the interrupt   */
                | SysTick_CTRL_ENABLE_Msk;      /* start counting         */
}

static void delay_ms(uint32_t ms)
{
  uint32_t start = g_ms;

  while ((g_ms - start) < ms)
  {
  }
}


/* ========================================================================== */
/*  Servo helper                                                              */
/* ========================================================================== */

/* Map 0..180 degrees onto SERVO_MIN_US..SERVO_MAX_US.
 * TIM2 counts in microseconds, so the compare value is the pulse width.
 */
static void servo_set_angle(uint32_t ch, uint8_t deg)
{
  uint32_t us;

  if (deg > 180)
  {
    deg = 180;
  }

  us = SERVO_MIN_US + ((uint32_t)deg * (SERVO_MAX_US - SERVO_MIN_US)) / 180U;

  if (ch == 3)
  {
    TIM2->CCR3 = us;
  }
  else
  {
    TIM2->CCR4 = us;
  }
}
