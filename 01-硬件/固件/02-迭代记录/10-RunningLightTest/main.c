/* ============================================================================
 *  S-LAN V4.0  --  Running Light  (classic chase)
 *                  (bare metal, no HAL, no CubeMX)
 *
 *  MCU   : STM32F103x  (Blue Pill)
 *  Build : Keil MDK-ARM 5  +  ARM Compiler 5
 *  Date  : 2026-10-04
 *
 *  ---------------------------------------------------------------------------
 *  WHAT IT DOES
 *
 *      The simplest possible proof that the chip is alive and the four
 *      indicator LEDs are wired right: ONE lamp lit at a time, walking down
 *      the row, over and over.
 *
 *          PB14 -> PB15 -> PA11 -> PA12 -> (pause) -> PB14 -> ...
 *
 *      Each step is 150 ms and exactly one lamp is lit, so it reads as a dot
 *      running along the row.  The onboard LED (PC13) flips once per round,
 *      so a frozen chase is immediately obvious.
 *
 *  ---------------------------------------------------------------------------
 *  THIS IS NOT 07-LedChaseTest
 *
 *      07 is the ROLL CALL: each lamp blinks its own number (1, 2, 3, 4) in
 *      turn.  That one is for FINDING a bad lamp or a wrong wire, and its
 *      README explains why a plain chase is ambiguous for that job.
 *
 *      This one is the opposite trade: it tells you almost nothing about
 *      WHICH lamp failed, but it is the fastest read on "does the program run
 *      at all, and is the LED row basically working".
 *
 *      Use this one first.  If a lamp is dark, switch to 07 to find it.
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
 *      Serial, three wires, optional:
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
 *  PROJECT SETUP (same as the other bare-metal tests)
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
 *  These four pins are the PCB allocation, copied straight out of
 *  01-单元板方案.md §6.1, so the test names exactly the pins the finished
 *  board will have.
 *
 *  Substitute pins if one really is dead - PA8 sits right above PB15 and is
 *  the easiest drop-in for lamp 1 (LED1_PIN 14 -> 8, GPIOB -> GPIOA).
 *  Do NOT use PA9 as a substitute: it is USART1_TX and taking it kills the
 *  serial output.  Other free pins:  PA4 PA5 PA6 PA7 PA8 PB0 PB1 PB8 PB9
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


/* ---- Timing -----------------------------------------------------------
 *
 *  Lamps per round: 4, plus one pause.  A round is
 *      4 * 150 + 400 = 1000 ms
 *  so the heartbeat flips once a second - easy to count against a watch.
 */

#define STEP_MS          150         /* one lamp is lit for this long      */
#define ROUND_GAP_MS     400         /* all dark between two rounds        */

#define BOOT_BLINK_MS    300
#define BOOT_BLINKS      3


/* ---- Prototypes ------------------------------------------------------- */

void        SysTick_Handler(void);   /* overrides the weak one in the startup file */
static void led_init(void);
static void leds_all_off(void);
static void systick_init(void);
static void delay_ms(uint32_t ms);
static void lamp(uint8_t which);
static void uart_init(void);
static void uart_putc(char c);
static void uart_puts(const char *s);
static void uart_put_u32(uint32_t v);


/* ---- Globals ---------------------------------------------------------- */

static volatile uint32_t g_ms = 0;

/* Index 0 and 5 are unused so that lamp numbers read 1..4, matching the
 * silkscreen and the README. */
static const char *const k_lamp_name[6] =
{
  "",
  "  [1] PB14  limit switch 1 lamp",
  "  [2] PB15  limit switch 2 lamp",
  "  [3] PA11  card detect lamp",
  "  [4] PA12  comm lamp",
  ""
};


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
  uint8_t  which;
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
  uart_puts("  S-LAN V4.0   running light\r\n");
  uart_puts("  one lamp at a time, 150 ms a step:\r\n");
  uart_puts("     PB14 -> PB15 -> PA11 -> PA12 -> pause -> repeat\r\n");
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

  /* ---- Chase, forever -------------------------------------------------
   * lamp() clears all four first, so exactly one lamp is ever lit and
   * there is no dark gap between steps - that is what makes it read as a
   * dot running down the row.
   * -------------------------------------------------------------------- */
  while (1)
  {
    round++;

    uart_puts("\r\n-- round ");
    uart_put_u32(round);
    uart_puts(" --\r\n");

    for (which = 1U; which <= 4U; which++)
    {
      lamp(which);
      uart_puts(k_lamp_name[which]);
      uart_puts("\r\n");
      delay_ms(STEP_MS);
    }

    leds_all_off();
    uart_puts("  (all off)\r\n");
    delay_ms(ROUND_GAP_MS);

    /* One heartbeat flip per round, so a stalled chase is obvious. */
    GPIOC->ODR ^= (1UL << HB_PIN);
  }
}


/* ========================================================================== */
/*  Lamp driving                                                              */
/* ========================================================================== */

/* Light exactly one lamp, or none at all when which is out of 1..4.
 * Everything is cleared first, so callers never have to remember to. */
static void lamp(uint8_t which)
{
  leds_all_off();

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
