/* ============================================================================
 *  S-LAN V4.0  --  Limit Switch Test  (bare metal, no HAL, no CubeMX)
 *
 *  MCU   : STM32F103x  (Blue Pill)
 *  Build : Keil MDK-ARM 5  +  ARM Compiler 5
 *  Date  : 2026-09-22
 *
 *  ---------------------------------------------------------------------------
 *  WHAT IT DOES
 *
 *      The onboard LED (PC13) reports the state of PB9 and PB5 by the
 *      NUMBER of times it blinks, so you can tell the two pins apart without
 *      a scope.
 *
 *      On power-up:   3 SLOW blinks   (about 2.4 s)  = "the program is alive"
 *
 *      Then, forever, one round every 1.5 s:
 *
 *          PB9 is HIGH  ->  1 FAST blink
 *          PB5 is HIGH  ->  2 FAST blinks
 *
 *      So:
 *          nothing connected / both floating  ->  3 fast blinks   (1 + 2)
 *          only PB9 floating                  ->  1 fast blink
 *          only PB5 floating                  ->  2 fast blinks
 *          both pulled to GND                 ->  0 fast blinks
 *
 *      Blink counting tells you two things at once:
 *          1. which physical pin is PB9 and which is PB5
 *          2. whether shorting a pin to GND actually took effect
 *
 *  ---------------------------------------------------------------------------
 *  HOW TO USE IT TO FIND THE PINS
 *
 *      1. Power up. You should see 3 SLOW blinks. If not, the program is not
 *         running - press reset, check BOOT0.
 *      2. Now count the FAST blinks each round.
 *      3. Touch a jumper wire between one of the header pins and GND, and
 *         watch which group of fast blinks disappears:
 *             1 fast blink disappears  -> that pin is PB9
 *             2 fast blinks disappear  -> that pin is PB5
 *      4. Repeat for the other pin.
 *
 *  ---------------------------------------------------------------------------
 *  WIRING (once the pins are known)
 *
 *      Limit switch 1     COM  ->  PB9      (chip pin 46, header silk "B9")
 *      Limit switch 1     NC   ->  GND
 *      Limit switch 1     NO   ->  not connected
 *
 *      Limit switch 2     COM  ->  PB5      (chip pin 41, header silk "B5")
 *      Limit switch 2     NC   ->  GND
 *      Limit switch 2     NO   ->  not connected
 *
 *      Four wires total. COM and NC are interchangeable, a switch contact
 *      has no polarity. No external resistor - the internal pull-up is used.
 *
 *      PB5 is NOT 5 V tolerant (chip pin 41, "I/O -" in the datasheet).
 *      Keep it away from 5 V - a switch to GND or to 3.3 V is fine.
 *
 *  ---------------------------------------------------------------------------
 *  WHY NC AND NOT NO
 *      Not pressed  -> NC closed  -> pin pulled to GND -> reads 0 -> no blink
 *      Pressed      -> NC open    -> internal pull-up wins -> reads 1 -> blinks
 *      Wire falls out / plug loose -> reads 1 -> looks PRESSED (safe)
 *
 *      With NO it would be the other way round: a broken wire would read
 *      "not pressed" and the mechanism would keep driving into the stop.
 *
 *  ---------------------------------------------------------------------------
 *  PROJECT SETUP (same as the servo test)
 *      1. Project -> Manage -> Run-Time Environment
 *         tick  [x] CMSIS -> CORE
 *         tick  [x] Device -> Startup
 *      2. Keep system_stm32f10x.c in the project - the startup file calls
 *         SystemInit() from it.
 *      3. Replace main.c with this file.
 *      4. Options for Target -> Flash Download -> tick "Reset and Run",
 *         and make sure the Programming Algorithm list is NOT empty.
 *      5. Build (F7).  Download (F8).
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


/* ---- Pin assignment --------------------------------------------------- */

#define SW1_PIN          9           /* limit switch 1 -> PB9   (chip pin 46) */
#define SW2_PIN          5           /* limit switch 2 -> PB5   (chip pin 41) */
#define LED_PIN          13          /* onboard LED    -> PC13 */

/* The onboard LED is wired active LOW: pin low = LED on. */
#define LED_ON()         (GPIOC->ODR &= ~(1UL << LED_PIN))
#define LED_OFF()        (GPIOC->ODR |=  (1UL << LED_PIN))

/* A switch reads 1 when pressed, or when its wire is broken. */
#define SW1_HIGH()       ((GPIOB->IDR & (1UL << SW1_PIN)) != 0UL)
#define SW2_HIGH()       ((GPIOB->IDR & (1UL << SW2_PIN)) != 0UL)


/* ---- Timing ----------------------------------------------------------- */

#define BOOT_BLINK_MS    400         /* slow startup blinks, on and off */
#define BOOT_BLINKS      3

#define FAST_ON_MS       150         /* fast report blink, on  */
#define FAST_OFF_MS      200         /* fast report blink, off */
#define CYCLE_MS         1500        /* gap between rounds     */


/* ---- Prototypes ------------------------------------------------------- */

void        SysTick_Handler(void);   /* overrides the weak one in the startup file */
static void led_init(void);
static void switch_init(void);
static void systick_init(void);
static void delay_ms(uint32_t ms);
static void blink_fast(uint8_t times);


/* ---- Globals ---------------------------------------------------------- */

static volatile uint32_t g_ms = 0;


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
  int i;

  led_init();
  switch_init();
  systick_init();

  /* ---- 3 slow blinks: the program is alive ---------------------------- */
  for (i = 0; i < BOOT_BLINKS; i++)
  {
    LED_ON();
    delay_ms(BOOT_BLINK_MS);
    LED_OFF();
    delay_ms(BOOT_BLINK_MS);
  }

  delay_ms(800);

  /* ---- Then report the two pins over and over -------------------------- */
  while (1)
  {
    if (SW1_HIGH())
    {
      blink_fast(1);          /* PB9 high -> one fast blink  */
    }

    if (SW2_HIGH())
    {
      blink_fast(2);          /* PB5 high -> two fast blinks */
    }

    delay_ms(CYCLE_MS);
  }
}


/* ========================================================================== */
/*  Helpers                                                                   */
/* ========================================================================== */

/* Blink the LED a given number of times, quickly. Pass 0 for nothing. */
static void blink_fast(uint8_t times)
{
  uint8_t i;

  for (i = 0; i < times; i++)
  {
    LED_ON();
    delay_ms(FAST_ON_MS);
    LED_OFF();
    delay_ms(FAST_OFF_MS);
  }
}


/* ========================================================================== */
/*  GPIO init                                                                 */
/* ========================================================================== */

/* PC13 lives in GPIOC->CRH, four bits at offset (13 - 8) * 4 = 20.
 *     MODE = 10  (output, 2 MHz - PC13 is a weak pin, keep it slow)
 *     CNF  = 00  (general purpose push-pull)
 */
static void led_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPCEN;

  GPIOC->CRH &= ~(0xFUL << 20);
  GPIOC->CRH |=  (0x2UL << 20);

  LED_OFF();
}


/* The two limit switches now sit on opposite halves of port B, so this is
 * the one place where the split between CRL and CRH actually matters:
 *
 *     PB9 -> GPIOB->CRH, bits 4..7      (high half covers PB8..PB15)
 *     PB5 -> GPIOB->CRL, bits 20..23    (low half covers PB0..PB7)
 *
 * Each nibble is CNF[1:0] : MODE[1:0]
 *     MODE = 00  (input)
 *     CNF  = 10  (input with pull-up / pull-down)
 * so each nibble = 0b1000 = 0x8
 *
 * Which one it pulls - up or down - is chosen by the matching bit in ODR:
 *     ODR bit = 1  ->  pull-UP
 *     ODR bit = 0  ->  pull-DOWN
 *
 * Nothing else in this file writes GPIOB->CRL, so those four bits are ours
 * alone.  GPIOB->CRH bits 16..31 belong to PB12..PB15 and must be left
 * alone.
 */
static void switch_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;

  /* PB9 - limit switch 1, input with internal pull-up */
  GPIOB->CRH &= ~(0xFUL << 4);
  GPIOB->CRH |=  (0x8UL << 4);

  /* PB5 - limit switch 2, input with internal pull-up */
  GPIOB->CRL &= ~(0xFUL << 20);
  GPIOB->CRL |=  (0x8UL << 20);

  GPIOB->ODR |= (1UL << SW1_PIN) | (1UL << SW2_PIN);   /* pull-UP on both */
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
