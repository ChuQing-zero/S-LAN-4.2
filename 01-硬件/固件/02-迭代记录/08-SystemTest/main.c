/* ============================================================================
 *  S-LAN V4.0  --  System Test, everything except the inter-board link
 *                  (bare metal, no HAL, no CubeMX)
 *
 *  MCU   : STM32F103x  (Blue Pill)
 *  Build : Keil MDK-ARM 5  +  ARM Compiler 5
 *  Date  : 2026-09-22
 *
 *  ---------------------------------------------------------------------------
 *  WHAT IT DOES
 *
 *      The whole unit board except the I2C link:
 *
 *          limit switch 1   PB9   ->  lamp 1   PB14
 *          limit switch 2   PB5   ->  lamp 2   PB15
 *          photoresistor    PA0   ->  lamp 3   PA11   (card detect)
 *          --                     ->  lamp 4   PA12   (1 Hz heartbeat, for now)
 *          --                     ->  PC13 onboard LED = alive indicator
 *
 *      The same information, plus the raw ADC value, goes out over the serial
 *      port four times a second.
 *
 *  ---------------------------------------------------------------------------
 *  WHAT IT IS FOR
 *
 *      Two jobs, in this order:
 *
 *      1. FIND THE THRESHOLD.  min and max are tracked and printed, so you
 *         cover and uncover the sensor and read the two numbers you need off
 *         the screen.  TH is then set to a value between them.
 *
 *      2. PROVE THE FOUR LAMPS WORK TOGETHER.  07 rolled one lamp at a time,
 *         which is what you want when hunting a fault.  Here all four are
 *         live at once, driven by real inputs, which is what the finished
 *         board does - a different thing to get wrong.
 *
 *  ---------------------------------------------------------------------------
 *  THE THRESHOLD IS A PLACEHOLDER
 *
 *      TH = 2000 is carried over from 05 and has NOT been measured on your
 *      divider.  Until you replace it, lamp 3 may well be wrong.
 *
 *      How to fix it:
 *          1. Cover and uncover the sensor about 20 times, watch min and max.
 *          2. TH = (min + max) / 2.
 *          3. Put that number in THRESHOLD below, rebuild, download.
 *
 *  ---------------------------------------------------------------------------
 *  NO LIGHT SOURCE LED - AND WHY THAT IS ONLY TEMPORARY
 *
 *      This build reads the sensor under whatever room light happens to be
 *      around, with no dedicated LED.  That is fine for finding the threshold
 *      and proving the logic.
 *
 *      It is NOT the design.  The finished unit board carries its own light
 *      source on the mechanism - a 5 mm white or green LED on +5V through
 *      220R, on connector J9 - because the mechanism itself will shade the
 *      sensor and the room light will change.  A threshold measured under
 *      ambient light drifts.  Measure it again once the source LED is fitted.
 *
 *  ---------------------------------------------------------------------------
 *  WIRING
 *
 *      Limit switches - COM + NC, so a broken wire reads as TRIGGERED:
 *
 *          switch 1    COM -> PB9      NC -> GND     NO -> not connected
 *          switch 2    COM -> PB5      NC -> GND     NO -> not connected
 *
 *          PB9 is chip pin 46, right header silk "B9"  - it IS 5 V tolerant
 *          PB5 is chip pin 41, right header silk "B5"  - it is NOT 5 V
 *          tolerant, so keep 5 V off that pin.
 *
 *      Lamps, all ACTIVE HIGH - cathode to GND, which is the opposite of the
 *      onboard LED on PC13:
 *
 *          PB14 ---[ 470R ]--- LED1 long leg     LED1 short leg ---> GND
 *          PB15 ---[ 470R ]--- LED2 long leg     LED2 short leg ---> GND
 *          PA11 ---[ 470R ]--- LED3 long leg     LED3 short leg ---> GND
 *          PA12 ---[ 470R ]--- LED4 long leg     LED4 short leg ---> GND
 *
 *      Photoresistor divider.  Divider on +3V3, never on +5V - PA0 is NOT
 *      5 V tolerant and 5 V on it destroys the pin:
 *
 *          +3V3 ---[ GL5528 ]---+---[ 10k ]--- GND
 *                              |
 *                              +---> PA0
 *
 *      Serial, three wires.  Only the INTER-BOARD link is deferred; this
 *      debug port stays, it is the only window into the program:
 *
 *          CH340 TXD ---> PA10     (USART1_RX)
 *          CH340 RXD ---> PA9      (USART1_TX)
 *          CH340 GND ---> GND
 *          CH340 VCC ---> not connected
 *
 *      NOT WIRED YET: the two servos on PB10 / PB11, and the I2C link on
 *      PB6 / PB7.  Both are deliberate - one change at a time.  The servos
 *      come back in the build after this one.
 *
 *  ---------------------------------------------------------------------------
 *  READING THE OUTPUT
 *
 *      SW1=0 SW2=0  ADC= 3421  min=  186 max= 3462  TH= 2000  N=  0  [ clear   ]
 *
 *          SW1    limit switch 1:  0 = open (NC still closed to GND)
 *                                  1 = pressed, or its wire has come off
 *          SW2    limit switch 2, same
 *          ADC    divider voltage right now, 0..4095, where 4095 = 3.300 V
 *          min    lowest value seen since power-up
 *          max    highest value seen since power-up
 *          TH     the threshold this build compares against
 *          N      how many times the light came back, i.e. how many
 *                 block / unblock cycles you have completed
 *          tail   [ clear   ] = light reaching the sensor
 *                 [ BLOCKED ] = under TH, so something is in the way
 *
 *      More light on the sensor makes the divider fall, so the BLOCKED
 *      readings are the LOW ones.  Cover the sensor and the number drops.
 *
 *  ---------------------------------------------------------------------------
 *  PROJECT SETUP (same as 03 through 07)
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
 *      No MicroLIB needed - integers are printed by hand, printf is unused.
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


/* ---- Pin assignment ---------------------------------------------------
 *
 *  --------------------------------------------------------------------
 *  LAMP 1 IS ON PB14, MATCHING THE PCB
 *
 *  Lamp 1 was parked on PA8 for a while, because PB14 appeared dead on
 *  this breadboard.  The real cause turned out to be a bad physical
 *  contact - the board was not pushed home - and not the pin and not the
 *  LED.  Lamp 1 is therefore back on PB14, which is what the PCB uses.
 *
 *  If PB14 ever looks dead again, CHECK THE CONTACT FIRST.  A limit
 *  switch reading stuck at 1 with nothing pressed is the same story from
 *  the other side: an input with its pull-up enabled reads 1 when its
 *  wire is not making contact, which is exactly the fail-safe behaviour
 *  the design wants, and exactly what a loose jumper looks like.
 *
 *  PA8 (the free pin just above PB15) is the drop-in substitute if a pin
 *  really does fail: LED1_PIN 14 -> 8 and the two LED1 macros from GPIOB
 *  to GPIOA.
 *
 *  Do NOT use PA9 as a substitute - it is USART1_TX and taking it kills
 *  the serial output.  Other free pins:  PA4 PA5 PA6 PA7 PA8 PB0 PB1 PB8
 *  --------------------------------------------------------------------
 */

#define SW1_PIN          9           /* PB9    limit switch 1  pin 46 */
#define SW2_PIN          5           /* PB5    limit switch 2  pin 41 */

#define LED1_PIN         14          /* PB14   limit switch 1 lamp   */
#define LED2_PIN         15          /* PB15   limit switch 2 lamp   */
#define LED3_PIN         11          /* PA11   card detect lamp      */
#define LED4_PIN         12          /* PA12   heartbeat, for now    */
#define HB_PIN           13          /* PC13   onboard LED           */

#define ADC_CH            0          /* PA0    ADC1_IN0, photoresistor */

/* All four indicator lamps are ACTIVE HIGH */
#define LED1_ON()        (GPIOB->ODR |=  (1UL << LED1_PIN))
#define LED1_OFF()       (GPIOB->ODR &= ~(1UL << LED1_PIN))
#define LED2_ON()        (GPIOB->ODR |=  (1UL << LED2_PIN))
#define LED2_OFF()       (GPIOB->ODR &= ~(1UL << LED2_PIN))
#define LED3_ON()        (GPIOA->ODR |=  (1UL << LED3_PIN))
#define LED3_OFF()       (GPIOA->ODR &= ~(1UL << LED3_PIN))
#define LED4_ON()        (GPIOA->ODR |=  (1UL << LED4_PIN))
#define LED4_OFF()       (GPIOA->ODR &= ~(1UL << LED4_PIN))

/* The onboard LED is ACTIVE LOW - the opposite of the four above */
#define HB_ON()          (GPIOC->ODR &= ~(1UL << HB_PIN))
#define HB_OFF()         (GPIOC->ODR |=  (1UL << HB_PIN))


/* ---- Threshold --------------------------------------------------------
 *
 *  PLACEHOLDER.  2000 is what 05 carried, never measured on your divider.
 *
 *  Cover the sensor about 20 times and watch min and max on the serial
 *  port, then set this to (min + max) / 2 and download again.
 *
 *  Readings BELOW this count as "something is in the way".
 * --------------------------------------------------------------------- */
#define THRESHOLD        2000


/* ---- Timing ---------------------------------------------------------- */

#define LOOP_MS          20          /* one pass of the main loop      */
#define REPORT_EVERY     10          /* print every 10 passes = 200 ms */
#define HB_MS            500         /* heartbeat half period = 1 Hz   */
#define ADC_AVG          16          /* readings averaged per result   */

#define BOOT_BLINK_MS    300
#define BOOT_BLINKS      3


/* ---- Prototypes ------------------------------------------------------- */

void        SysTick_Handler(void);   /* overrides the weak one in the startup file */
static void gpio_init(void);
static void leds_all_off(void);
static void adc_init(void);
static uint16_t adc_read_once(void);
static uint16_t adc_read_avg(void);
static uint8_t sw_read(uint32_t pin);
static void systick_init(void);
static void delay_ms(uint32_t ms);
static void uart_init(void);
static void uart_putc(char c);
static void uart_puts(const char *s);
static void uart_put_u32_pad(uint32_t v, uint8_t width);


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
  uint8_t  s1, s2, blocked;
  uint8_t  was_blocked = 0U;
  uint8_t  hb_on       = 0U;
  uint32_t n_cycles    = 0UL;
  uint32_t hb_last     = 0UL;
  uint32_t next_report = 0UL;

  /* SysTick first: adc_init() uses delay_ms(), which needs it running. */
  gpio_init();
  systick_init();
  uart_init();
  adc_init();

  /* ---- 3 slow blinks on the onboard LED: the program is alive --------- */
  for (i = 0; i < BOOT_BLINKS; i++)
  {
    HB_ON();
    delay_ms(BOOT_BLINK_MS);
    HB_OFF();
    delay_ms(BOOT_BLINK_MS);
  }

  delay_ms(400);

  /* ---- Banner ---------------------------------------------------------
   * If you can read this, the serial wiring, the baud rate and the system
   * clock are all correct.
   * -------------------------------------------------------------------- */
  uart_puts("\r\n\r\n");
  uart_puts("=====================================================\r\n");
  uart_puts("  S-LAN V4.0   system test (no I2C, no servos)\r\n");
  uart_puts("     switch 1 PB9   ->  lamp 1 PB14\r\n");
  uart_puts("     switch 2 PB5   ->  lamp 2 PB15\r\n");
  uart_puts("     light    PA0   ->  lamp 3 PA11   card detect\r\n");
  uart_puts("     --             ->  lamp 4 PA12   1 Hz heartbeat\r\n");
  uart_puts("  the POWER lamp never blinks - it is hard-wired\r\n");
  uart_puts("  to +3V3 and stays on all the time.\r\n");

  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    uart_puts("  clock: PLL, 72 MHz - good\r\n");
  }
  else
  {
    uart_puts("  clock: *** NOT PLL *** - the 8 MHz crystal did\r\n");
    uart_puts("  not start, so the baud rate is wrong.\r\n");
  }

  uart_puts("  TH=2000 IS A PLACEHOLDER - cover and uncover\r\n");
  uart_puts("  the sensor, read min and max, then set TH to\r\n");
  uart_puts("  the value between them.\r\n");
  uart_puts("=====================================================\r\n");

  next_report = g_ms;

  /* ---- Main loop, one pass every 20 ms -------------------------------- */
  while (1)
  {
    s1 = sw_read(SW1_PIN);
    s2 = sw_read(SW2_PIN);

    v       = adc_read_avg();
    blocked = (v < (uint16_t)THRESHOLD) ? 1U : 0U;

    /* Track the extremes - these two numbers are what the threshold is
     * picked from. */
    if (v < vmin) { vmin = v; }
    if (v > vmax) { vmax = v; }

    /* A completed block / unblock cycle.  Counted on the way back so a
     * half-finished cover does not inflate the number. */
    if ((was_blocked != 0U) && (blocked == 0U))
    {
      n_cycles++;
    }
    was_blocked = blocked;

    /* ---- Drive the four lamps ---------------------------------------- */
    if (s1 != 0U) { LED1_ON(); } else { LED1_OFF(); }
    if (s2 != 0U) { LED2_ON(); } else { LED2_OFF(); }
    if (blocked != 0U) { LED3_ON(); } else { LED3_OFF(); }

    /* ---- Heartbeat on lamp 4, and on the onboard LED ----------------- */
    if ((g_ms - hb_last) >= HB_MS)
    {
      hb_last = g_ms;
      hb_on   = (uint8_t)(hb_on == 0U ? 1U : 0U);

      if (hb_on != 0U) { LED4_ON();  HB_ON();  }
      else             { LED4_OFF(); HB_OFF(); }
    }

    /* ---- Report ------------------------------------------------------- */
    if ((g_ms - next_report) >= (LOOP_MS * REPORT_EVERY))
    {
      next_report = g_ms;

      uart_puts("SW1=");
      uart_put_u32_pad(s1, 1);
      uart_puts(" SW2=");
      uart_put_u32_pad(s2, 1);
      uart_puts("  ADC=");
      uart_put_u32_pad(v, 5);
      uart_puts("  min=");
      uart_put_u32_pad(vmin, 5);
      uart_puts(" max=");
      uart_put_u32_pad(vmax, 5);
      uart_puts("  TH=");
      uart_put_u32_pad(THRESHOLD, 5);
      uart_puts("  N=");
      uart_put_u32_pad(n_cycles, 3);
      uart_puts(blocked ? "  [ BLOCKED ]\r\n" : "  [ clear   ]\r\n");
    }

    delay_ms(LOOP_MS);
  }
}


/* ========================================================================== */
/*  Inputs                                                                    */
/* ========================================================================== */

/* Limit switch on PB9 / PB5, wired COM + NC to GND with the internal
 * pull-up enabled:
 *
 *     not pressed   NC closed   pin pulled to GND   reads 0
 *     pressed       NC open     pull-up wins       reads 1
 *     wire off      same as pressed                 reads 1  <- fail-safe
 */
static uint8_t sw_read(uint32_t pin)
{
  return ((GPIOB->IDR & (1UL << pin)) != 0UL) ? 1U : 0U;
}


/* ========================================================================== */
/*  Photoresistor on PA0                                                      */
/* ========================================================================== */

static void adc_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB2ENR |= RCC_APB2ENR_ADC1EN;

  /* PA0 must be ANALOG INPUT: GPIOA->CRL bits 0..3 = 0b0000.
   * Anything else and the digital input buffer loads the divider. */
  GPIOA->CRL &= ~(0xFUL << 0);

  /* The ADC clock must stay under 14 MHz.  SystemInit() leaves ADCPRE at
   * PCLK2 / 2 = 36 MHz, which is well over.  Use /6 = 12 MHz. */
  RCC->CFGR &= ~RCC_CFGR_ADCPRE;
  RCC->CFGR |=  RCC_CFGR_ADCPRE_DIV6;

  ADC1->CR2 |= ADC_CR2_ADON;
  delay_ms(1);

  /* Calibration.  05 measured the exact numbers in the comment there. */
  ADC1->CR2 |= ADC_CR2_RSTCAL;
  while ((ADC1->CR2 & ADC_CR2_RSTCAL) != 0UL)
  {
  }

  ADC1->CR2 |= ADC_CR2_CAL;
  while ((ADC1->CR2 & ADC_CR2_CAL) != 0UL)
  {
  }

  ADC1->SQR1 = 0UL;                    /* one conversion in the sequence   */
  ADC1->SQR3 = (uint32_t)ADC_CH;        /* first conversion = channel 0     */

  /* SMP0[2:0] = 0b111 = 55.5 cycles, the longest sample window.  The
   * divider's source impedance is up to 10k (10k || dark GL5528), so give
   * the sample-and-hold capacitor all the time it can get.
   *
   * CAREFUL: this must be ADC_SMPR2_SMP0, i.e. all three SMP0 bits.  In 05
   * it was written as ADC_SMPR2_SMP0_2 alone, which is 0b100 = 13.5 cycles
   * and only marginally enough for a 10k source.  It worked, but there is
   * no reason to run that close to the edge. */
  ADC1->SMPR2 = ADC_SMPR2_SMP0;
}


/* One conversion.  Writing ADON again starts it when it is already on. */
static uint16_t adc_read_once(void)
{
  ADC1->CR2 |= ADC_CR2_ADON;

  while ((ADC1->SR & ADC_SR_EOC) == 0UL)
  {
  }

  /* Reading DR clears EOC.  The result is 12 bits, right aligned. */
  return (uint16_t)(ADC1->DR & 0x0FFFUL);
}


/* Average a burst.  The divider is quiet but the supply is not, and lamp 4
 * switches at 1 Hz, so a little averaging costs nothing and steadies the
 * number the threshold is chosen from. */
static uint16_t adc_read_avg(void)
{
  uint32_t sum = 0UL;
  uint8_t  i;

  for (i = 0; i < ADC_AVG; i++)
  {
    sum += (uint32_t)adc_read_once();
  }

  return (uint16_t)(sum / (uint32_t)ADC_AVG);
}


/* ========================================================================== */
/*  GPIO init                                                                 */
/* ========================================================================== */

/* Every lamp pin is a plain push-pull output at 2 MHz - about 3 mA each and
 * nothing fast going on.  Each nibble is CNF[1:0] : MODE[1:0], so
 * 0b0010 = MODE 10 (output, 2 MHz), CNF 00 (general purpose push-pull).
 * Input with pull-up is 0b1000 = 0x8, with ODR bit = 1 to select pull-UP.
 *
 *   GPIOA->CRH bits 12..15  ->  PA11     nibble 0x2
 *   GPIOA->CRH bits 16..19  ->  PA12     nibble 0x2
 *   GPIOB->CRL bits 20..23  ->  PB5      nibble 0x8  input pull-up
 *   GPIOB->CRH bits 4..7    ->  PB9      nibble 0x8  input pull-up
 *   GPIOB->CRH bits 24..27  ->  PB14     nibble 0x2
 *   GPIOB->CRH bits 28..31  ->  PB15     nibble 0x2
 *   GPIOC->CRH bits 20..23  ->  PC13     nibble 0x2
 *
 * CAREFUL: the two limit switches are now on OPPOSITE halves of port B, so
 * this is the one place that has to write both config registers.  PB9 is in
 * GPIOB->CRH, PB5 is in GPIOB->CRL.
 *
 * CAREFUL: uart_init() owns GPIOA->CRH bits 4..11 (PA9 / PA10), and
 * adc_init() owns GPIOA->CRL bits 0..3 (PA0).  Nothing in here may touch
 * those bits.
 */
static void gpio_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPCEN;

  /* PA11 / PA12 - lamps 3 and 4.  PA9 / PA10 belong to the serial port
   * and are deliberately not touched here. */
  GPIOA->CRH &= ~(0xFFUL << 12);
  GPIOA->CRH |=  (0x22UL << 12);

  /* PB9 - limit switch 1, input with internal pull-up (high half of port B) */
  GPIOB->CRH &= ~(0xFUL << 4);
  GPIOB->CRH |=  (0x8UL << 4);

  /* PB5 - limit switch 2, input with internal pull-up (low half of port B) */
  GPIOB->CRL &= ~(0xFUL << 20);
  GPIOB->CRL |=  (0x8UL << 20);

  /* PB14 / PB15 - lamps 1 and 2, one nibble write each */
  GPIOB->CRH &= ~(0xFFUL << 24);
  GPIOB->CRH |=  (0x22UL << 24);

  /* Pull-ups selected: ODR bit = 1 on an input means "pull up" */
  GPIOB->ODR |=  (1UL << SW1_PIN) | (1UL << SW2_PIN);

  /* PC13 - onboard LED */
  GPIOC->CRH &= ~(0xFUL << 20);
  GPIOC->CRH |=  (0x2UL << 20);

  leds_all_off();
  HB_OFF();
}


static void leds_all_off(void)
{
  LED1_OFF();
  LED2_OFF();
  LED3_OFF();
  LED4_OFF();
}


/* ========================================================================== */
/*  Serial:  USART1 on PA9 / PA10, 115200 8N1                                 */
/* ========================================================================== */

/* PA9  -> GPIOA->CRH bits 4..7    0xB = MODE 11 (50 MHz), CNF 10 (AF PP)
 * PA10 -> GPIOA->CRH bits 8..11   0x4 = MODE 00 (input),   CNF 01 (floating)
 */
static void uart_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB2ENR |= RCC_APB2ENR_USART1EN;

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


/* Right aligned in a field of `width` spaces, so the columns do not jump
 * around while the numbers change. */
static void uart_put_u32_pad(uint32_t v, uint8_t width)
{
  char    buf[10];
  uint8_t n = 0;
  uint8_t i;

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
