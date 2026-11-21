/* ============================================================================
 *  S-LAN V4.0  --  Limit Switch + Indicator LED Test
 *                  (bare metal, no HAL, no CubeMX)
 *
 *  MCU   : STM32F103x  (Blue Pill)
 *  Build : Keil MDK-ARM 5  +  ARM Compiler 5
 *  Date  : 2026-09-22
 *
 *  ---------------------------------------------------------------------------
 *  WHAT IT DOES
 *
 *      This is the full stage-2 program: read the two limit switches and
 *      drive a separate indicator LED for each one, so the LED wiring on the
 *      real board is proven before the PCB exists.
 *
 *          limit switch 1  (PB9)   ->  indicator LED 1  (PB14)
 *          limit switch 2  (PB5)   ->  indicator LED 2  (PB15)
 *
 *      Everything is also printed over the serial port, so you can check that
 *      the LEDs and the switches agree.
 *
 *      The onboard LED (PC13) is left alone as a 1 Hz heartbeat, which tells
 *      you the program itself is still alive.
 *
 *      POLARITY, do not mix these up:
 *
 *          PB14 / PB15  drive the external LEDs  ->  ACTIVE HIGH
 *                       (pin high = lit, because the LED cathode is on GND)
 *
 *          PC13         is the onboard LED       ->  ACTIVE LOW
 *                       (pin low = lit, it has its anode on 3V3)
 *
 *  ---------------------------------------------------------------------------
 *  WIRING  (11 wires)
 *
 *      Limit switches:
 *
 *          switch 1   COM  ->  PB9       (right header silk "B9", pin 46)
 *          switch 1   NC   ->  GND
 *          switch 1   NO   ->  not connected
 *
 *          switch 2   COM  ->  PB5       (right header silk "B5", pin 41)
 *          switch 2   NC   ->  GND
 *          switch 2   NO   ->  not connected
 *
 *          PB5 is NOT 5 V tolerant - keep it away from 5 V.
 *
 *      Indicator LEDs:
 *
 *          PB14 ---[ 470R ]--- LED1 long leg  (anode, +)
 *                              LED1 short leg (cathode, -) ---> GND
 *
 *          PB15 ---[ 470R ]--- LED2 long leg  (anode, +)
 *                              LED2 short leg (cathode, -) ---> GND
 *
 *      Serial, three wires only:
 *
 *          CH340 TXD ---> PA10    (USART1_RX)
 *          CH340 RXD ---> PA9     (USART1_TX)
 *          CH340 GND ---> GND
 *          CH340 VCC ---> not connected
 *
 *      The long leg is the anode.  If you get it the wrong way round the LED
 *      simply stays dark - it will not be damaged at 3 mA.
 *
 *  ---------------------------------------------------------------------------
 *  READING THE OUTPUT
 *
 *      SW1=0  SW2=0   N1=  0  N2=  0   both switches open
 *      SW1=1  SW2=0   N1=  1  N2=  0   switch 1 triggered
 *      SW1=1  SW2=1   N1=  1  N2=  1   BOTH switches triggered
 *
 *          SW1   state of limit switch 1 right now
 *          N1    how many times switch 1 has gone from open to triggered
 *
 *      N1 / N2 are the useful part: press switch 1 twenty times and N1 should
 *      read exactly 20.  If it reads more, the contacts are bouncing.
 *
 *  ---------------------------------------------------------------------------
 *  PROJECT SETUP (same as the servo, limit switch and light sensor tests)
 *      1. Project -> Manage -> Run-Time Environment
 *         tick  [x] CMSIS -> CORE
 *         tick  [x] Device -> Startup
 *      2. Keep system_stm32f10x.c in the project - the startup file calls
 *         SystemInit() from it.
 *      3. Replace main.c with this file.
 *      4. Options for Target -> Flash Download -> tick "Reset and Run",
 *         and make sure the Programming Algorithm list is NOT empty
 *         (Add -> STM32F10x 128KB Flash).
 *      5. Build (F7).  Download (F8).
 *
 *      No MicroLIB needed - integers are printed by hand, printf is not used.
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

#define SW1_PIN          9           /* limit switch 1   -> PB9  (pin 46) */
#define SW2_PIN          5           /* limit switch 2   -> PB5  (pin 41) */
#define LED1_PIN         14          /* indicator LED 1  -> PB14 */
#define LED2_PIN         15          /* indicator LED 2  -> PB15 */
#define HB_PIN           13          /* heartbeat, onboard LED -> PC13 */

/* External LEDs: cathode on GND, so HIGH lights them */
#define LED1_ON()        (GPIOB->ODR |=  (1UL << LED1_PIN))
#define LED1_OFF()       (GPIOB->ODR &= ~(1UL << LED1_PIN))
#define LED2_ON()        (GPIOB->ODR |=  (1UL << LED2_PIN))
#define LED2_OFF()       (GPIOB->ODR &= ~(1UL << LED2_PIN))

/* Onboard LED: anode on 3V3, so LOW lights it */
#define HB_ON()          (GPIOC->ODR &= ~(1UL << HB_PIN))
#define HB_OFF()         (GPIOC->ODR |=  (1UL << HB_PIN))

/* A switch reads 1 when pressed, or when its wire has fallen out. */
#define SW1_HIGH()       ((GPIOB->IDR & (1UL << SW1_PIN)) != 0UL)
#define SW2_HIGH()       ((GPIOB->IDR & (1UL << SW2_PIN)) != 0UL)


/* ---- Timing ----------------------------------------------------------- */

#define LOOP_MS          200         /* one report every 200 ms */
#define HB_TICKS         5           /* 5 x 200 ms = a 1 Hz heartbeat */

#define BOOT_BLINK_MS    400
#define BOOT_BLINKS      3


/* ---- Prototypes ------------------------------------------------------- */

void        SysTick_Handler(void);   /* overrides the weak one in the startup file */
static void led_init(void);
static void switch_init(void);
static void systick_init(void);
static void delay_ms(uint32_t ms);
static void uart_init(void);
static void uart_putc(char c);
static void uart_puts(const char *s);
static void uart_put_u32_pad(uint32_t v, int width);


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
  int      i;
  uint8_t  s1;
  uint8_t  s2;
  uint8_t  prev1 = 0U;
  uint8_t  prev2 = 0U;
  uint32_t n1 = 0UL;
  uint32_t n2 = 0UL;
  uint8_t  tick = 0U;

  led_init();
  switch_init();
  systick_init();
  uart_init();

  /* ---- 3 slow blinks on the onboard LED: the program is alive --------- */
  for (i = 0; i < BOOT_BLINKS; i++)
  {
    HB_ON();
    delay_ms(BOOT_BLINK_MS);
    HB_OFF();
    delay_ms(BOOT_BLINK_MS);
  }

  delay_ms(500);

  /* ---- Banner --------------------------------------------------------- */
  uart_puts("\r\n\r\n");
  uart_puts("=====================================================\r\n");
  uart_puts("  S-LAN V4.0   limit switch + indicator LED test\r\n");
  uart_puts("  SW1=PB9   SW2=PB5    LED1=PB14  LED2=PB15\r\n");
  uart_puts("  PC13 onboard LED = 1 Hz heartbeat\r\n");

  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    uart_puts("  clock: PLL, 72 MHz - good\r\n");
  }
  else
  {
    uart_puts("  clock: *** NOT PLL *** - the 8 MHz crystal did\r\n");
    uart_puts("  not start, so the baud rate and all timing are\r\n");
    uart_puts("  wrong.  Check the crystal.\r\n");
  }

  uart_puts("=====================================================\r\n");
  uart_puts("  Press each switch and watch its LED come on.\r\n");
  uart_puts("  Press 20 times, N1 / N2 should read exactly 20.\r\n");
  uart_puts("-----------------------------------------------------\r\n");

  /* ---- Report forever -------------------------------------------------- */
  while (1)
  {
    s1 = (SW1_HIGH()) ? 1U : 0U;
    s2 = (SW2_HIGH()) ? 1U : 0U;

    /* Drive the two indicator LEDs straight from the switch states */
    if (s1 != 0U) { LED1_ON(); } else { LED1_OFF(); }
    if (s2 != 0U) { LED2_ON(); } else { LED2_OFF(); }

    /* Count open -> triggered edges.  At 200 ms per poll, contact bounce
     * (a few milliseconds) is skipped over entirely, so N1 / N2 stay exact.
     */
    if ((prev1 == 0U) && (s1 != 0U)) { n1++; }
    if ((prev2 == 0U) && (s2 != 0U)) { n2++; }
    prev1 = s1;
    prev2 = s2;

    /* ---- 1 Hz heartbeat on the onboard LED ---- */
    tick++;
    if (tick >= HB_TICKS)
    {
      tick = 0U;
      GPIOC->ODR ^= (1UL << HB_PIN);
    }

    /* ---- Serial report ---- */
    uart_puts("SW1=");
    uart_put_u32_pad(s1, 1);
    uart_puts("  SW2=");
    uart_put_u32_pad(s2, 1);
    uart_puts("   N1=");
    uart_put_u32_pad(n1, 3);
    uart_puts("  N2=");
    uart_put_u32_pad(n2, 3);
    uart_puts("   ");

    if ((s1 != 0U) && (s2 != 0U))
    {
      uart_puts("BOTH switches triggered\r\n");
    }
    else if (s1 != 0U)
    {
      uart_puts("switch 1 triggered\r\n");
    }
    else if (s2 != 0U)
    {
      uart_puts("switch 2 triggered\r\n");
    }
    else
    {
      uart_puts("both switches open\r\n");
    }

    delay_ms(LOOP_MS);
  }
}


/* ========================================================================== */
/*  GPIO init                                                                 */
/* ========================================================================== */

/* Onboard LED on PC13, in GPIOC->CRH at offset (13 - 8) * 4 = 20:
 *     MODE = 10  (output, 2 MHz - PC13 is a weak pin, keep it slow)
 *     CNF  = 00  (general purpose push-pull)
 */
static void led_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPCEN;

  GPIOC->CRH &= ~(0xFUL << 20);
  GPIOC->CRH |=  (0x2UL << 20);

  HB_OFF();
}


/* The port-B pins used here are split across BOTH config registers, so watch
 * which one you are writing:
 *
 *   GPIOB->CRL  covers PB0..PB7, four bits per pin.
 *   GPIOB->CRH  covers PB8..PB15, four bits per pin.
 *
 * Each nibble is CNF[1:0] : MODE[1:0].
 *
 *   PB5          limit switch 2 input   -> CRL nibble bits 20..23
 *       MODE = 00  (input)
 *       CNF  = 10  (input with pull-up / pull-down)
 *       -> nibble 0b1000 = 0x8
 *
 *   PB9          limit switch 1 input   -> CRH nibble bits 4..7
 *       same nibble 0x8
 *
 *   PB14 / PB15  indicator LED outputs  -> CRH nibbles bits 24..31
 *       MODE = 10  (output, 2 MHz)
 *       CNF  = 00  (general purpose push-pull)
 *       -> nibble 0b0010 = 0x2
 *
 * Which way PB5 / PB9 pull is chosen by the matching bit in ODR:
 *     ODR bit = 1  ->  pull-UP
 *     ODR bit = 0  ->  pull-DOWN
 */
static void switch_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;

  /* PB5 - limit switch 2, input with internal pull-up (low half of port B) */
  GPIOB->CRL &= ~(0xFUL << 20);
  GPIOB->CRL |=  (0x8UL << 20);

  /* PB9 - limit switch 1, input with internal pull-up (high half of port B) */
  GPIOB->CRH &= ~(0xFUL << 4);
  GPIOB->CRH |=  (0x8UL << 4);

  GPIOB->CRH &= ~(0xFFUL << 24);
  GPIOB->CRH |=  (0x22UL << 24);

  /* Pull-UP both inputs, and make sure both LEDs start off. */
  GPIOB->ODR |=  (1UL << SW1_PIN) | (1UL << SW2_PIN);
  GPIOB->ODR &= ~((1UL << LED1_PIN) | (1UL << LED2_PIN));
}


/* ========================================================================== */
/*  Serial:  USART1 on PA9 / PA10, 115200 8N1                                 */
/* ========================================================================== */

static void uart_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB2ENR |= RCC_APB2ENR_USART1EN;

  /* CRH covers PA8..PA15, four bits per pin:
   *     PA9  -> bits  4..7    MODE = 11 (50 MHz), CNF = 10 (AF push-pull)
   *                           -> nibble 0b1011 = 0xB
   *     PA10 -> bits  8..11   MODE = 00 (input),   CNF = 01 (floating)
   *                           -> nibble 0b0100 = 0x4
   */
  GPIOA->CRH &= ~((0xFUL << 4) | (0xFUL << 8));
  GPIOA->CRH |=  ((0xBUL << 4) | (0x4UL << 8));

  /* PCLK2 is 72 MHz and we want 115200 baud:
   *     USARTDIV = 72000000 / (16 * 115200) = 39.0625
   *     mantissa = 39 = 0x27, fraction = 0.0625 * 16 = 1
   *     BRR = (0x27 << 4) | 1 = 0x271
   */
  USART1->BRR = 0x271UL;

  USART1->CR1 = USART_CR1_TE        /* transmitter on */
              | USART_CR1_RE        /* receiver on    */
              | USART_CR1_UE;       /* USART enabled  */
}


/* Wait for the transmit register to empty, then hand it one byte. */
static void uart_putc(char c)
{
  while ((USART1->SR & USART_SR_TXE) == 0UL)
  {
  }

  USART1->DR = (uint16_t)(uint8_t)c;
}


static void uart_puts(const char *s)
{
  while (*s != '\0')
  {
    uart_putc(*s);
    s++;
  }
}


/* Right aligned in a fixed field, so the columns stay put. */
static void uart_put_u32_pad(uint32_t v, int width)
{
  char buf[10];
  int  n = 0;
  int  i;

  do
  {
    buf[n] = (char)('0' + (v % 10UL));
    n++;
    v /= 10UL;
  }
  while ((v > 0UL) && (n < 10));

  for (i = n; i < width; i++)
  {
    uart_putc(' ');
  }

  while (n > 0)
  {
    n--;
    uart_putc(buf[n]);
  }
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
