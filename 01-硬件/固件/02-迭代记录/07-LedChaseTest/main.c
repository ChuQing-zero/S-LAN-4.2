/* ============================================================================
 *  S-LAN V4.0  --  Indicator LED Chase / Roll Call
 *                  (bare metal, no HAL, no CubeMX)
 *
 *  MCU   : STM32F103x  (Blue Pill)
 *  Build : Keil MDK-ARM 5  +  ARM Compiler 5
 *  Date  : 2026-09-22  (rev F - lamp 1 back on PB14, matching the PCB)
 *
 *  ---------------------------------------------------------------------------
 *  WHAT IT DOES
 *
 *      Roll call for the four indicator LEDs the program controls.  One at a
 *      time, in order, and each lamp blinks ITS OWN NUMBER:
 *
 *          [1] PB14   limit switch 1 lamp    blinks 1 time
 *          [2] PB15   limit switch 2 lamp    blinks 2 times
 *          [3] PA11   card detect lamp       blinks 3 times
 *          [4] PA12   comm lamp              blinks 4 times
 *
 *      Between lamps there is a silent gap, and the bar LED (PC13) flips once
 *      per round.
 *
 *  ---------------------------------------------------------------------------
 *  WHY BLINK COUNTS AND NOT A RUNNING LIGHT
 *
 *      A plain chase is ambiguous.  With a "now all four" step in the middle,
 *      a working lamp lights TWICE per round (its own step, then the all-on
 *      step) while a dead one lights zero times - and you cannot tell which
 *      lamp is which when several are dark.
 *
 *      Blink counts remove the ambiguity: the lamp that blinks 3 times IS the
 *      PA11 lamp, no matter where you physically plugged it in.  If a lamp
 *      blinks the wrong count, you have the wire on the wrong pin.
 *
 *  ---------------------------------------------------------------------------
 *  HOW TO USE IT
 *
 *      Watch one full round, about 8 seconds, and write down what you see:
 *
 *          lamp 1 (PB14)  should blink 1 time
 *          lamp 2 (PB15)  should blink 2 times
 *          lamp 3 (PA11)  should blink 3 times
 *          lamp 4 (PA12)  should blink 4 times
 *
 *          a lamp that never blinks   -> its LED, its 470R, or its wire
 *          a lamp that blinks the wrong number -> the wire is on the wrong pin
 *          all four blink the right count -> all four lamps and wires are good
 *
 *      No serial needed, but the serial port names the lamp before it blinks,
 *      so you can watch both at once.
 *
 *  ---------------------------------------------------------------------------
 *  THE FIFTH LAMP
 *
 *      The POWER lamp is not driven by the CPU at all - it hangs straight off
 *      +3V3 through a 470R resistor.  It stays lit from power-on and never
 *      takes part in the roll call.  That is correct, not a fault.  It is
 *      also useful: a dark power lamp means the 3.3 V rail itself is missing.
 *
 *  ---------------------------------------------------------------------------
 *  WIRING  (4 LEDs, 8 wires)
 *
 *          PB14 ---[ 470R ]--- LED1 long leg (anode, +)
 *                              LED1 short leg (cathode, -) ---> GND
 *
 *          PB15 ---[ 470R ]--- LED2 long leg (anode, +)
 *                              LED2 short leg (cathode, -) ---> GND
 *
 *          PA11 ---[ 470R ]--- LED3 long leg (anode, +)
 *                              LED3 short leg (cathode, -) ---> GND
 *
 *          PA12 ---[ 470R ]--- LED4 long leg (anode, +)
 *                              LED4 short leg (cathode, -) ---> GND
 *
 *      Serial, three wires, optional but recommended:
 *
 *          CH340 TXD ---> PA10    (USART1_RX)
 *          CH340 RXD ---> PA9     (USART1_TX)
 *          CH340 GND ---> GND
 *          CH340 VCC ---> not connected
 *
 *      All four lamps are ACTIVE HIGH: the pin goes high to light them,
 *      because the LED cathode sits on GND.  That is the opposite of the
 *      onboard LED on PC13, which is active LOW.
 *
 *      NOTE ON PA11 / PA12: on the Blue Pill these are the USB pins (D- and
 *      D+), and PA12 carries the board's R10 pull-up.  Do not be surprised by
 *      anything odd there while the USB cable is plugged in.  The custom PCB
 *      has no USB connector, so PA11 / PA12 are clean there.
 *
 *  ---------------------------------------------------------------------------
 *  PROJECT SETUP (same as the servo, limit switch, light sensor and
 *                 indicator tests)
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


/* ---- Pin assignment ---------------------------------------------------
 *
 *  --------------------------------------------------------------------
 *  LAMP 1 IS ON PB14, MATCHING THE PCB
 *
 *  Lamp 1 was parked on PA8 for a while, because PB14 appeared dead on
 *  this breadboard.  The real cause turned out to be a bad physical
 *  contact - the board was not pushed home - not the pin and not the LED.
 *  Lamp 1 is therefore back on PB14, which is what the PCB uses, so the
 *  roll call names exactly the pins the finished board will have.
 *
 *  If a pin ever looks dead, CHECK THE CONTACT FIRST.  A dead lamp and a
 *  stuck-at-1 input are the same failure from two sides: a loose jumper.
 *  PA8 (above PB15) is the drop-in substitute if a pin really does fail:
 *  LED1_PIN 14 -> 8 and the two LED1 macros from GPIOB to GPIOA.
 *
 *  Do NOT use PA9 as a substitute - it is USART1_TX and taking it kills
 *  the serial output.  Other free pins:  PA4 PA5 PA6 PA7 PA8 PB0 PB1 PB8 PB9
 *  --------------------------------------------------------------------
 */

#define LED1_PIN         14          /* PB14   limit switch 1 lamp  */
#define LED2_PIN         15          /* PB15   limit switch 2 lamp  */
#define LED3_PIN         11          /* PA11   card detect lamp     */
#define LED4_PIN         12          /* PA12   comm lamp            */
#define HB_PIN           13          /* PC13   onboard LED, heartbeat */

/* All four indicator lamps are ACTIVE HIGH */
#define LED1_ON()        (GPIOB->ODR |=  (1UL << LED1_PIN))
#define LED1_OFF()       (GPIOB->ODR &= ~(1UL << LED1_PIN))
#define LED2_ON()        (GPIOB->ODR |=  (1UL << LED2_PIN))
#define LED2_OFF()       (GPIOB->ODR &= ~(1UL << LED2_PIN))
#define LED3_ON()        (GPIOA->ODR |=  (1UL << LED3_PIN))
#define LED3_OFF()       (GPIOA->ODR &= ~(1UL << LED3_PIN))
#define LED4_ON()        (GPIOA->ODR |=  (1UL << LED4_PIN))
#define LED4_OFF()       (GPIOA->ODR &= ~(1UL << LED4_PIN))

/* The onboard LED is ACTIVE LOW */
#define HB_ON()          (GPIOC->ODR &= ~(1UL << HB_PIN))
#define HB_OFF()         (GPIOC->ODR |=  (1UL << HB_PIN))


/* ---- Timing ----------------------------------------------------------- */

#define BLINK_ON_MS      220         /* one blink: on time  */
#define BLINK_OFF_MS     220         /* one blink: off time */

#define GAP_MS           800         /* silence between two lamps   */
#define ROUND_GAP_MS     1500        /* longer silence between rounds */

#define BOOT_BLINK_MS    300
#define BOOT_BLINKS      3


/* ---- Prototypes ------------------------------------------------------- */

void        SysTick_Handler(void);   /* overrides the weak one in the startup file */
static void led_init(void);
static void leds_all_off(void);
static void systick_init(void);
static void delay_ms(uint32_t ms);
static void lamp_drive(uint8_t which, uint8_t on);
static void blink_one(uint8_t which, uint8_t times, const char *label);
static void silence(uint32_t ms, const char *label);
static void uart_init(void);
static void uart_putc(char c);
static void uart_puts(const char *s);
static void uart_put_u32(uint32_t v);


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
  uint32_t round = 0UL;

  led_init();
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

  delay_ms(400);

  /* ---- Banner ---------------------------------------------------------
   * If you can read this, the serial wiring, the baud rate and the system
   * clock are all correct.
   * -------------------------------------------------------------------- */
  uart_puts("\r\n\r\n");
  uart_puts("=====================================================\r\n");
  uart_puts("  S-LAN V4.0   indicator LED roll call\r\n");
  uart_puts("  each lamp blinks its own number:\r\n");
  uart_puts("     [1] PB14   limit switch 1 lamp   x1\r\n");
  uart_puts("     [2] PB15   limit switch 2 lamp   x2\r\n");
  uart_puts("     [3] PA11   card detect lamp      x3\r\n");
  uart_puts("     [4] PA12   comm lamp             x4\r\n");
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

  uart_puts("=====================================================\r\n");

  /* ---- Roll call, forever --------------------------------------------- */
  while (1)
  {
    round++;

    uart_puts("\r\n-- round ");
    uart_put_u32(round);
    uart_puts(" --\r\n");

    silence(GAP_MS, "  (all off)");

    blink_one(1U, 1U, "  [1] PB14  limit switch 1 lamp   x1");
    silence(GAP_MS, "  (all off)");

    blink_one(2U, 2U, "  [2] PB15  limit switch 2 lamp   x2");
    silence(GAP_MS, "  (all off)");

    blink_one(3U, 3U, "  [3] PA11  card detect lamp      x3");
    silence(GAP_MS, "  (all off)");

    blink_one(4U, 4U, "  [4] PA12  comm lamp             x4");
    silence(ROUND_GAP_MS, "  (all off)");

    /* One heartbeat flip per round, so a stalled roll call is obvious. */
    GPIOC->ODR ^= (1UL << HB_PIN);
  }
}


/* ========================================================================== */
/*  Roll call                                                                 */
/* ========================================================================== */

/* which: 1 = PB14, 2 = PB15, 3 = PA11, 4 = PA12, anything else = all off */
static void lamp_drive(uint8_t which, uint8_t on)
{
  leds_all_off();

  if (on == 0U)
  {
    return;
  }

  if (which == 1U)
  {
    LED1_ON();
  }
  else if (which == 2U)
  {
    LED2_ON();
  }
  else if (which == 3U)
  {
    LED3_ON();
  }
  else if (which == 4U)
  {
    LED4_ON();
  }
}


/* Blink one lamp a given number of times.  Everything else stays dark for
 * the whole blink, so there is never any doubt about which lamp is talking.
 */
static void blink_one(uint8_t which, uint8_t times, const char *label)
{
  uint8_t n;

  uart_puts(label);
  uart_puts("\r\n");

  for (n = 0; n < times; n++)
  {
    lamp_drive(which, 1U);
    delay_ms(BLINK_ON_MS);
    lamp_drive(which, 0U);
    delay_ms(BLINK_OFF_MS);
  }
}


/* Everything dark for a while - this is what separates one lamp from the
 * next, so two lamps are never lit close enough together to confuse you.
 */
static void silence(uint32_t ms, const char *label)
{
  leds_all_off();

  if (label != 0)
  {
    uart_puts(label);
    uart_puts("\r\n");
  }

  delay_ms(ms);
}


static void leds_all_off(void)
{
  LED1_OFF();
  LED2_OFF();
  LED3_OFF();
  LED4_OFF();
}


/* ========================================================================== */
/*  GPIO init                                                                 */
/* ========================================================================== */

/* Every pin is a plain push-pull output at 2 MHz - the lamps draw about
 * 3 mA each and there is nothing fast going on.
 *
 *   GPIOA->CRH bits 12..15  ->  PA11     nibble 0x2
 *   GPIOA->CRH bits 16..19  ->  PA12     nibble 0x2
 *   GPIOB->CRH bits 24..27  ->  PB14     nibble 0x2
 *   GPIOB->CRH bits 28..31  ->  PB15     nibble 0x2
 *   GPIOC->CRH bits 20..23  ->  PC13     nibble 0x2
 *
 * Each nibble is CNF[1:0] : MODE[1:0], so 0b0010 = MODE 10 (output, 2 MHz),
 * CNF 00 (general purpose push-pull).
 *
 * CAREFUL: uart_init() owns GPIOA->CRH bits 4..11 (PA9 / PA10), so nothing
 * in here may touch those bits.
 */
static void led_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPCEN;

  /* PA11 / PA12 - lamps 3 and 4.  PA9 / PA10 belong to the serial port
   * and are deliberately not touched here. */
  GPIOA->CRH &= ~(0xFFUL << 12);
  GPIOA->CRH |=  (0x22UL << 12);

  /* PB14 / PB15 - lamps 1 and 2 */
  GPIOB->CRH &= ~(0xFFUL << 24);
  GPIOB->CRH |=  (0x22UL << 24);

  GPIOC->CRH &= ~(0xFUL << 20);
  GPIOC->CRH |=  (0x2UL << 20);

  leds_all_off();
  HB_OFF();
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
