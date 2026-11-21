/* ============================================================================
 *  S-LAN V4.0  --  Light Sensor Test  (bare metal, no HAL, no CubeMX)
 *
 *  MCU   : STM32F103x  (Blue Pill)
 *  Build : Keil MDK-ARM 5  +  ARM Compiler 5
 *  Date  : 2026-09-22
 *
 *  ---------------------------------------------------------------------------
 *  WHAT IT DOES
 *
 *      Reads the photoresistor divider on PA0 (ADC1 channel 0) and prints the
 *      raw value over the serial port, four times a second.  It also keeps
 *      track of the lowest and highest value seen since power-up - those two
 *      numbers are what you need in order to pick a threshold.
 *
 *      The onboard LED (PC13) is a serial-free indicator, so the board is
 *      useful even before the serial adapter shows up:
 *
 *          LED on   ->  reading is BELOW the threshold  (light blocked)
 *          LED off  ->  reading is ABOVE the threshold  (light getting through)
 *
 *      Wave your hand over the sensor and the LED should follow it.
 *
 *  ---------------------------------------------------------------------------
 *  WIRING
 *
 *      Light source, always on, uses no GPIO:
 *
 *          +5V ---[ 220R ]--- white / green LED --- GND
 *
 *      Photoresistor divider:
 *
 *          +3V3 ---[ GL5528 ]---+---[ 10k ]--- GND
 *                              |
 *                              +---> PA0      <- ADC1_IN0, pin 10 of the LQFP48
 *
 *      Serial, three wires only:
 *
 *          CH340 TXD ---> PA10    (USART1_RX)
 *          CH340 RXD ---> PA9     (USART1_TX)
 *          CH340 GND ---> GND
 *          CH340 VCC ---> not connected
 *
 *      WARNING - two different supply rails, do not mix them up:
 *      the light source must sit on +5V, because a white LED drops about
 *      3.2 V and will not light from 3.3 V.  The divider must sit on +3V3,
 *      because PA0 is NOT 5 V tolerant and 5 V on it will destroy the pin.
 *
 *  ---------------------------------------------------------------------------
 *  READING THE OUTPUT
 *
 *      ADC= 3421  min= 3390  max= 3462  TH=2000  N= 0  [ clear   ]
 *      ADC=  186  min=  186  max= 3462  TH=2000  N= 0  [ BLOCKED ]
 *      ADC= 3400  min=  186  max= 3462  TH=2000  N= 1  [ clear   ]
 *
 *          ADC   the value right now, 0..4095, where 4095 = 3.300 V
 *          min   lowest value since power-up
 *          max   highest value since power-up
 *          TH    the threshold this program compares against
 *          N     how many times the light has come back, i.e. how many
 *                block / unblock cycles you have done
 *
 *      Cover and uncover the sensor twenty times, then look at min and max.
 *      Set TH to something between them - halfway is the safe choice.
 *
 *  ---------------------------------------------------------------------------
 *  PROJECT SETUP (same as the servo and limit switch tests)
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
 *      No MicroLIB needed - this file prints integers by hand and never
 *      touches printf or the standard library.
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

#define ADC_CH           0           /* PA0 = ADC1_IN0 */
#define LED_PIN          13          /* onboard LED    -> PC13 */

#define LED_ON()         (GPIOC->ODR &= ~(1UL << LED_PIN))
#define LED_OFF()        (GPIOC->ODR |=  (1UL << LED_PIN))


/* ---- Tunables --------------------------------------------------------- */

/* The threshold, on the 0..4095 raw scale.
 *
 *   light blocked  ->  the divider value falls  ->  reading drops
 *   light reaching ->  the divider value rises  ->  reading climbs
 *
 * So a reading BELOW this value means "a card is in the gap".
 *
 * 2000 is only a starting guess.  Run the test, read min and max off the
 * serial port, and replace this with a number between the two.
 */
#define THRESHOLD        2000

/* How many samples to average per report.  Averaging is the cheapest
 * noise filter there is, and 16 costs about 90 microseconds.
 */
#define ADC_AVG          16

#define REPORT_MS        250         /* one line every 250 ms */

#define BOOT_BLINK_MS    400         /* slow startup blinks, on and off */
#define BOOT_BLINKS      3


/* ---- Prototypes ------------------------------------------------------- */

void        SysTick_Handler(void);   /* overrides the weak one in the startup file */
static void led_init(void);
static void systick_init(void);
static void delay_ms(uint32_t ms);
static void uart_init(void);
static void uart_putc(char c);
static void uart_puts(const char *s);
static void uart_put_u32(uint32_t v);
static void uart_put_u32_pad(uint32_t v, int width);
static void adc_init(void);
static uint16_t adc_read_once(void);
static uint16_t adc_read_avg(uint8_t n);


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
  uint16_t v;
  uint16_t vmin = 4095U;
  uint16_t vmax = 0U;
  uint8_t  blocked;
  uint8_t  was_blocked = 0U;
  uint32_t cycles = 0UL;

  led_init();

  /* This one must come before any delay_ms() call. */
  systick_init();

  uart_init();
  adc_init();

  /* ---- 3 slow blinks: the program is alive ---------------------------- */
  for (i = 0; i < BOOT_BLINKS; i++)
  {
    LED_ON();
    delay_ms(BOOT_BLINK_MS);
    LED_OFF();
    delay_ms(BOOT_BLINK_MS);
  }

  delay_ms(500);

  /* ---- Banner ----------------------------------------------------------
   * If you can read this on the PC, then the serial wiring, the baud rate
   * and the system clock are all correct.  That is three things ruled out
   * in one go.
   * -------------------------------------------------------------------- */
  uart_puts("\r\n\r\n");
  uart_puts("=====================================================\r\n");
  uart_puts("  S-LAN V4.0   light sensor test\r\n");
  uart_puts("  PA0 = ADC1_IN0        LED = PC13        TH = ");
  uart_put_u32(THRESHOLD);
  uart_puts("\r\n");

  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    uart_puts("  clock: PLL, 72 MHz - good\r\n");
  }
  else
  {
    uart_puts("  clock: *** NOT PLL ***\r\n");
    uart_puts("  The 8 MHz crystal did not start, so the MCU is\r\n");
    uart_puts("  running on its internal 8 MHz oscillator.  Timing\r\n");
    uart_puts("  and the baud rate are both wrong.  Check the\r\n");
    uart_puts("  crystals are soldered and the board is a real\r\n");
    uart_puts("  F103 with an HSE crystal fitted.\r\n");
  }

  uart_puts("=====================================================\r\n");
  uart_puts("  Cover and uncover the sensor a few times, then\r\n");
  uart_puts("  read min and max below and set THRESHOLD between\r\n");
  uart_puts("  them (in main.c, at the top).\r\n");
  uart_puts("  LED is on whenever the reading is under THRESHOLD.\r\n");
  uart_puts("-----------------------------------------------------\r\n");

  /* ---- Report forever -------------------------------------------------- */
  while (1)
  {
    v = adc_read_avg(ADC_AVG);

    if (v < vmin) { vmin = v; }
    if (v > vmax) { vmax = v; }

    blocked = (v < (uint16_t)THRESHOLD) ? 1U : 0U;

    /* Count each time the light comes back, which is one full block /
     * unblock cycle - the same thing the test plan counts 20 of.
     */
    if ((was_blocked != 0U) && (blocked == 0U))
    {
      cycles++;
    }
    was_blocked = blocked;

    uart_puts("ADC=");
    uart_put_u32_pad(v, 5);
    uart_puts("  min=");
    uart_put_u32_pad(vmin, 5);
    uart_puts("  max=");
    uart_put_u32_pad(vmax, 5);
    uart_puts("  TH=");
    uart_put_u32_pad(THRESHOLD, 5);
    uart_puts("  N=");
    uart_put_u32_pad(cycles, 3);
    uart_puts(blocked ? "  [ BLOCKED ]\r\n" : "  [ clear   ]\r\n");

    if (blocked)
    {
      LED_ON();
    }
    else
    {
      LED_OFF();
    }

    delay_ms(REPORT_MS);
  }
}


/* ========================================================================== */
/*  GPIO init                                                                 */
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

  LED_OFF();
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
   *     mantissa = 39 = 0x27
   *     fraction = 0.0625 * 16 = 1
   *     BRR = (0x27 << 4) | 1 = 0x271
   */
  USART1->BRR = 0x271UL;

  USART1->CR1 = USART_CR1_TE        /* transmitter on  */
              | USART_CR1_RE        /* receiver on     */
              | USART_CR1_UE;       /* USART enabled   */
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


static void uart_put_u32(uint32_t v)
{
  char buf[10];
  int  n = 0;

  do
  {
    buf[n] = (char)('0' + (v % 10UL));
    n++;
    v /= 10UL;
  }
  while ((v > 0UL) && (n < 10));

  while (n > 0)
  {
    n--;
    uart_putc(buf[n]);
  }
}


/* Same, but right aligned in a fixed field so the columns line up and the
 * numbers do not dance around as you watch them.
 */
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
/*  ADC:  ADC1, channel 0 (PA0), single conversion                            */
/* ========================================================================== */

static void adc_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB2ENR |= RCC_APB2ENR_ADC1EN;

  /* PA0 must be an ANALOG input: PA0 sits in GPIOA->CRL bits 0..3, and the
   * nibble for analog is CNF = 00, MODE = 00, i.e. 0x0.  The reset value is
   * 0x4 (floating digital input), which leaks and reads nonsense.
   */
  GPIOA->CRL &= ~(0xFUL << 0);

  /* The ADC has its own clock and 14 MHz is the hard limit.  clock_init()
   * over in the servo test left ADCPRE at 00, which is PCLK2 / 2 = 36 MHz -
   * way over spec.  PCLK2 / 6 = 12 MHz is comfortably inside it.
   */
  RCC->CFGR &= ~RCC_CFGR_ADCPRE;
  RCC->CFGR |=  RCC_CFGR_ADCPRE_DIV6;

  /* Power the ADC up and let it stabilise (tSTAB is around 1 us, but 1 ms
   * costs nothing here and removes all doubt).
   */
  ADC1->CR2 |= ADC_CR2_ADON;
  delay_ms(1);

  /* Calibration.  Skipping it leaves the internal offset uncorrected, which
   * shows up as a few tens of counts of error at the bottom of the range -
   * exactly where the "blocked" reading lives.
   */
  ADC1->CR2 |= ADC_CR2_RSTCAL;
  while ((ADC1->CR2 & ADC_CR2_RSTCAL) != 0UL)
  {
  }

  ADC1->CR2 |= ADC_CR2_CAL;
  while ((ADC1->CR2 & ADC_CR2_CAL) != 0UL)
  {
  }

  /* One conversion per trigger, first (and only) slot = channel 0.
   * SQR1 = 0 sets L = 0, which means "1 conversion in the sequence".
   */
  ADC1->SQR1 = 0UL;
  ADC1->SQR3 = (uint32_t)ADC_CH;

  /* Sample time for channel 0: SMP0 = 0b100 = 55.5 ADC clock cycles.
   * The source impedance here is at most 10k, which 55.5 cycles covers
   * with plenty of margin.
   */
  ADC1->SMPR2 = ADC_SMPR2_SMP0_2;
}


static uint16_t adc_read_once(void)
{
  /* ADON is already 1, so writing it again starts a conversion rather than
   * powering the ADC up again.
   */
  ADC1->CR2 |= ADC_CR2_ADON;

  while ((ADC1->SR & ADC_SR_EOC) == 0UL)
  {
  }

  /* Reading DR clears EOC.  The result is 12 bits, right aligned. */
  return (uint16_t)(ADC1->DR & 0x0FFFUL);
}


static uint16_t adc_read_avg(uint8_t n)
{
  uint32_t sum = 0UL;
  uint8_t  i;

  if (n == 0U)
  {
    return adc_read_once();
  }

  for (i = 0; i < n; i++)
  {
    sum += (uint32_t)adc_read_once();
  }

  return (uint16_t)(sum / (uint32_t)n);
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
