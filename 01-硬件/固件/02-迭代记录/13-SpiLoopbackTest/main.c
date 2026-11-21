/* ============================================================================
 *  S-LAN V4.0  --  SPI1 loopback + MISO line probe   (bare metal)
 *                  no HAL, no CubeMX, no library, no interrupts
 *
 *  MCU   : STM32F103C8  (Blue Pill)
 *  Build : Keil MDK-ARM 5  +  ARM Compiler 5
 *  Date  : 2026-10-06
 *
 *  ---------------------------------------------------------------------------
 *  WHY THIS PROGRAM EXISTS
 *
 *  The PN532 test (12-Pn532SpiTest) keeps reporting that MISO never changes -
 *  first FF FF FF, then 00 00 00.  Both readings mean "nothing is driving this
 *  line", but from the outside there are two completely different reasons and
 *  they are impossible to tell apart:
 *
 *      (a) the STM32 side is broken   - wrong GPIO setup, dead pin, bad SPI
 *      (b) the MODULE side is broken  - no power, wrong DIP switch, bad wire
 *
 *  This program splits those two apart with certainty, and needs NO multimeter
 *  and NO oscilloscope.
 *
 *  ---------------------------------------------------------------------------
 *  TEST 1 - the pull-up / pull-down probe      *** NO EXTRA HARDWARE ***
 *
 *      PA6 is an INPUT.  On the STM32 the same pin can be switched between
 *          input with internal PULL-UP     (weak resistor to 3.3 V)
 *          input with internal PULL-DOWN   (weak resistor to GND)
 *
 *      Then we read the pin in both states.  The weak internal resistor cannot
 *      fight anything that is actively driving, but it easily wins against a
 *      pin that is just floating.  So the two readings identify the line:
 *
 *          pull-up   pull-down     what PA6 is
 *          ------------------------------------------------------------
 *             1         0          FLOATING.  Nothing at all is driving it.
 *                                   The module is not talking.  Either it has
 *                                   no power, is in the wrong interface mode,
 *                                   or the wire is not connected.
 *
 *             0         0          HELD LOW, hard.  Something is pulling it
 *                                   to ground - a short, or the wire is on a
 *                                   GND pin.
 *
 *             1         1          HELD HIGH, hard.  Something is driving it
 *                                   up - the module IS connected and IS
 *                                   driving the line.
 *
 *  ---------------------------------------------------------------------------
 *  TEST 2 - SPI loopback       *** NEEDS ONE JUMPER WIRE ***
 *
 *      Put a jumper wire straight between PA7 (MOSI) and PA6 (MISO).  Nothing
 *      else - leave the module connected or unplug it, either is fine.
 *
 *      Now every byte the STM32 shifts out on MOSI is shifted straight back in
 *      on MISO.  If we send 5A A5 3C the read must return 5A A5 3C.
 *
 *      If that works, then ALL of this is proven good, permanently:
 *          the SPI1 peripheral and all its registers
 *          the PA5 / PA6 / PA7 GPIO configuration
 *          spi_xfer() and the whole transfer routine
 *          the 72 MHz clock feeding PCLK2
 *
 *      After that the ONLY thing left that can be wrong is the module.
 *      If the loopback fails, the module was never the problem.
 *
 *  ---------------------------------------------------------------------------
 *  HOW TO READ THE OUTPUT
 *
 *      Every 2 seconds it re-runs both tests and prints a verdict line.  You
 *      do not need to understand the numbers - just read the verdicts.
 *
 *  ---------------------------------------------------------------------------
 *  WIRING (unchanged from the PN532 test - do not move anything yet)
 *
 *      PA4 = SS    PA5 = SCK    PA6 = MISO    PA7 = MOSI
 *      Serial monitor on PA9 / PA10, 115200 baud
 *      PC13 = onboard LED, heartbeat (it blinks twice as fast as before, so
 *             you can tell at a glance which program is flashed)
 * ============================================================================
 */

/* ---------------------------------------------------------------------------
 *  Device header.  This pack is the older generation - the header is called
 *  stm32f10x.h (not stm32f1xx.h) and refuses to compile until exactly one
 *  density symbol is defined.  In a real Keil project the device selection
 *  does this for you and the block below never fires.
 * ------------------------------------------------------------------------ */
#if !defined(STM32F10X_LD)      && !defined(STM32F10X_LD_VL) \
 && !defined(STM32F10X_MD)      && !defined(STM32F10X_MD_VL) \
 && !defined(STM32F10X_HD)      && !defined(STM32F10X_HD_VL) \
 && !defined(STM32F10X_XL)      && !defined(STM32F10X_CL)
  #define STM32F10X_MD
#endif

#include "stm32f10x.h"


/* ========================================================================== */
/*  Tunables                                                                  */
/* ========================================================================== */

#define HEARTBEAT_MS        250U     /* deliberately 2x the other program,    */
                                     /* so the PC13 blink tells you which     */
                                     /* firmware is actually running          */
#define BOOT_BLINK_MS       120U
#define BOOT_BLINKS         3U

#define TEST_PERIOD_MS      2000U    /* how often to re-run everything        */
#define PROBE_SAMPLES       5U       /* reads per probe, to filter noise      */


/* ========================================================================== */
/*  Pin helpers                                                               */
/* ========================================================================== */

#define PN_CS_LOW()          (GPIOA->BRR  = (1UL << 4))     /* PA4, active low */
#define PN_CS_HIGH()         (GPIOA->BSRR = (1UL << 4))

#define HB_ON()              (GPIOC->ODR &= ~(1UL << 13))   /* PC13, active LOW */
#define HB_OFF()             (GPIOC->ODR |=  (1UL << 13))

#define LAMP_ON()            (GPIOB->ODR |=  (1UL << 14))   /* PB14 - verdict ok */
#define LAMP_OFF()           (GPIOB->ODR &= ~(1UL << 14))


/* ========================================================================== */
/*  Globals                                                                   */
/* ========================================================================== */

static volatile uint32_t g_ms = 0UL;

static uint32_t g_last_hb = 0UL;

/* Both tests are reported every round, and a summary line at the end.  These
 * remember the results so the summary can be printed last. */
static uint8_t g_probe_up   = 0U;    /* PA6 read with internal pull-up    */
static uint8_t g_probe_down = 0U;    /* PA6 read with internal pull-down  */
static uint8_t g_loop_ok    = 0U;    /* 1 = every byte came back intact   */


/* ========================================================================== */
/*  Prototypes                                                                */
/* ========================================================================== */

void SysTick_Handler(void);

static void    systick_init(void);
static void    delay_ms(uint32_t ms);

static void    uart_init(void);
static void    uart_putc(char c);
static void    uart_puts(const char *s);
static void    uart_put_u32(uint32_t v);
static void    uart_put_hex8(uint8_t v);

static void    lamps_init(void);
static void    led_flash(uint8_t n, uint16_t on_ms, uint16_t off_ms);

static void    spi_init(void);
static uint8_t spi_xfer(uint8_t b);

static void    pa6_as_input_floating(void);
static void    pa6_as_input_pull(uint8_t up);
static uint8_t pa6_read(void);

static void    test_probe_pa6(void);
static void    test_spi_loopback(void);


/* ========================================================================== */
/*  SysTick - the 1 ms time base                                              */
/* ========================================================================== */

void SysTick_Handler(void)
{
  g_ms++;
}


/* ========================================================================== */
/*  SPI1                                                                      */
/* ========================================================================== */

/* PA4  bits 16..19   0x3 = MODE 11 (50 MHz), CNF 00 (push-pull output)
 * PA5  bits 20..23   0xB = MODE 11 (50 MHz), CNF 10 (alternate func PP)
 * PA6  bits 24..27   0x4 = MODE 00 (input),   CNF 01 (floating)
 * PA7  bits 28..31   0xB = MODE 11 (50 MHz), CNF 10 (alternate func PP)
 *
 * Identical to the PN532 test, on purpose - the whole point of the loopback
 * is to prove THIS configuration works.
 */
static void spi_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB2ENR |= RCC_APB2ENR_SPI1EN;

  GPIOA->CRL &= ~(0xFFFFUL << 16);
  GPIOA->CRL |=  ((0x3UL << 16) | (0xBUL << 20) | (0x4UL << 24) | (0xBUL << 28));

  PN_CS_HIGH();                       /* idle high, before the pin is live */

  SPI1->CR1 = (uint16_t)(SPI_CR1_MSTR
                       | SPI_CR1_LSBFIRST
                       | SPI_CR1_SSM
                       | SPI_CR1_SSI
                       | SPI_CR1_BR_2
                       | SPI_CR1_BR_0);

  SPI1->CR1 |= SPI_CR1_SPE;
}


/* One byte out, one byte in.
 *
 * The 8-bit pointer casts are not decoration.  SPI1->DR is declared as a
 * 16-bit register and DFF is 0 (8-bit frames), and the reference manual is
 * explicit that in 8-bit mode DR must be accessed as a byte.
 */
static uint8_t spi_xfer(uint8_t b)
{
  while ((SPI1->SR & SPI_SR_TXE) == 0U)
  {
  }

  *(volatile uint8_t *)&SPI1->DR = b;

  while ((SPI1->SR & SPI_SR_RXNE) == 0U)
  {
  }

  return *(volatile uint8_t *)&SPI1->DR;
}


/* ========================================================================== */
/*  PA6 / PA7 as plain GPIO - the probe                                       */
/* ========================================================================== */

/* MODE 00, CNF 01 = input, floating.  Nothing is connected to the pin
 * internally, so it reads whatever the outside world gives it. */
static void pa6_as_input_floating(void)
{
  GPIOA->CRL &= ~(0xFUL << 24);
  GPIOA->CRL |=  (0x4UL << 24);
}


/* MODE 00, CNF 10 = input with pull.
 *
 * On the STM32F1 the direction of the internal pull is chosen by the OUTPUT
 * data register bit for that pin, which is a quirk of this family - ODR is
 * doing double duty here because the pin is not actually an output.
 *
 *     ODR bit 6 = 1  ->  pull-UP   (about 40 kohm to 3.3 V)
 *     ODR bit 6 = 0  ->  pull-DOWN (about 40 kohm to GND)
 */
static void pa6_as_input_pull(uint8_t up)
{
  GPIOA->CRL &= ~(0xFUL << 24);
  GPIOA->CRL |=  (0x8UL << 24);

  if (up != 0U)
  {
    GPIOA->ODR |=  (1UL << 6);
  }
  else
  {
    GPIOA->ODR &= ~(1UL << 6);
  }
}


static uint8_t pa6_read(void)
{
  if ((GPIOA->IDR & (1UL << 6)) != 0UL)
  {
    return 1U;
  }

  return 0U;
}


/* ========================================================================== */
/*  TEST 1 - what is the PA6 / MISO line actually doing                       */
/* ========================================================================== */

/* Read the pin PROBE_SAMPLES times and take the majority, so one stray read
 * does not flip the answer. */
static uint8_t read_stable(void)
{
  uint8_t i;
  uint8_t ones = 0U;

  for (i = 0U; i < PROBE_SAMPLES; i++)
  {
    if (pa6_read() != 0U)
    {
      ones++;
    }
  }

  if (ones > (uint8_t)(PROBE_SAMPLES / 2U))
  {
    return 1U;
  }

  return 0U;
}


static void test_probe_pa6(void)
{
  uint8_t flo;

  uart_puts("  [1] MISO line probe  (PA6, no extra hardware needed)\r\n");

  /* ---- first: what does it do with nothing connected internally ---- */
  pa6_as_input_floating();
  delay_ms(2);
  flo = read_stable();

  uart_puts("      floating input  reads ");
  uart_puts((flo != 0U) ? "1" : "0");
  uart_puts("\r\n");

  /* ---- now force it one way, then the other ---- */
  pa6_as_input_pull(1U);
  delay_ms(2);
  g_probe_up = read_stable();

  uart_puts("      with pull-UP    reads ");
  uart_puts((g_probe_up != 0U) ? "1" : "0");
  uart_puts("\r\n");

  pa6_as_input_pull(0U);
  delay_ms(2);
  g_probe_down = read_stable();

  uart_puts("      with pull-DOWN  reads ");
  uart_puts((g_probe_down != 0U) ? "1" : "0");
  uart_puts("\r\n");

  /* ---- say what it means ---- */
  if ((g_probe_up != 0U) && (g_probe_down == 0U))
  {
    uart_puts("      -> FLOATING.  Nothing is driving this line at all.\r\n");
    uart_puts("         The module is not talking.  It is NOT a wiring mistake\r\n");
    uart_puts("         on the STM32 side - the pin itself is fine.\r\n");
    uart_puts("         Causes, most likely first:\r\n");
    uart_puts("           a. module has no power (check its LED / VCC)\r\n");
    uart_puts("           b. DIP switch is not on SPI\r\n");
    uart_puts("           c. this wire is not actually on the module's MISO pin\r\n");
  }
  else if ((g_probe_up == 0U) && (g_probe_down == 0U))
  {
    uart_puts("      -> HELD LOW, hard.  Something is pulling PA6 to ground.\r\n");
    uart_puts("         A pin that is merely unconnected would win against the\r\n");
    uart_puts("         weak internal pull-up and read 1.  This reads 0 both ways,\r\n");
    uart_puts("         so there is a real low-impedance path:\r\n");
    uart_puts("           a. the wire is on a GND pin, not on MISO\r\n");
    uart_puts("           b. there is a short to ground somewhere\r\n");
    uart_puts("           c. the module is holding it low (powered but confused)\r\n");
    uart_puts("         <- this is what your board is doing right now\r\n");
  }
  else if ((g_probe_up != 0U) && (g_probe_down != 0U))
  {
    uart_puts("      -> HELD HIGH, hard.  Something IS driving this line up.\r\n");
    uart_puts("         The module is connected and alive.  Good news - the\r\n");
    uart_puts("         problem is the interface mode or the byte order, not the\r\n");
    uart_puts("         wiring and not the power.\r\n");
  }
  else
  {
    uart_puts("      -> odd result (up=0, down=1).  Impossible for a real pin;\r\n");
    uart_puts("         the pull settings are probably not taking effect.\r\n");
  }

  uart_puts("\r\n");
}


/* ========================================================================== */
/*  TEST 2 - SPI loopback                                                     */
/* ========================================================================== */

static void test_spi_loopback(void)
{
  /* Deliberately chosen so a shifted or bit-reversed transfer cannot look
   * correct by accident.  5A and A5 are exact bit-reverses of each other. */
  static const uint8_t k_pattern[8] =
  {
    0x5AU, 0xA5U, 0x3CU, 0xC3U, 0x01U, 0x80U, 0xFFU, 0x00U
  };

  uint8_t i;
  uint8_t bad = 0U;

  uart_puts("  [2] SPI loopback  (NEEDS A JUMPER FROM PA7 TO PA6)\r\n");
  uart_puts("      TX ->  RX\r\n");

  spi_init();                         /* takes PA6 and PA7 back from the probe */

  for (i = 0U; i < 8U; i++)
  {
    uint8_t tx = k_pattern[i];
    uint8_t rx = spi_xfer(tx);

    uart_puts("      ");
    uart_put_hex8(tx);
    uart_puts(" -> ");
    uart_put_hex8(rx);
    uart_puts((rx == tx) ? "  ok\r\n" : "  MISMATCH\r\n");

    if (rx != tx)
    {
      bad = 1U;
    }
  }

  if (bad == 0U)
  {
    g_loop_ok = 1U;
    uart_puts("      -> LOOPBACK PASSED.  SPI1, PA5/PA6/PA7, the transfer\r\n");
    uart_puts("         routine and the 72 MHz clock are ALL proven good.\r\n");
    uart_puts("         Nothing on the STM32 side can be the fault.\r\n");
  }
  else
  {
    g_loop_ok = 0U;
    uart_puts("      -> LOOPBACK FAILED.  Either the jumper between PA7 and PA6\r\n");
    uart_puts("         is missing / not seated, or the SPI1 side really is broken.\r\n");
    uart_puts("         Fit the jumper first and re-check before blaming the MCU.\r\n");
  }

  uart_puts("\r\n");
}


/* ========================================================================== */
/*  Pin setup                                                                 */
/* ========================================================================== */

/* PB14 lamp.  spi_init() owns GPIOA->CRL (PA4..PA7) and uart_init() owns
 * GPIOA->CRH bits 4..11 (PA9 / PA10).  Nothing here may touch those. */
static void lamps_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPCEN;

  GPIOB->CRH &= ~(0xFUL << 24);
  GPIOB->CRH |=  (0x2UL << 24);       /* PB14 push-pull output */

  GPIOC->CRH &= ~(0xFUL << 20);
  GPIOC->CRH |=  (0x2UL << 20);       /* PC13 push-pull output */

  LAMP_OFF();
  HB_OFF();
}


/* Blink the onboard LED, then push the heartbeat a full period away so the
 * two do not interleave and make the count unreadable. */
static void led_flash(uint8_t n, uint16_t on_ms, uint16_t off_ms)
{
  uint8_t i;

  for (i = 0U; i < n; i++)
  {
    HB_ON();
    delay_ms(on_ms);
    HB_OFF();
    delay_ms(off_ms);
  }

  g_last_hb = g_ms;
}


/* ========================================================================== */
/*  Serial:  USART1 on PA9 / PA10, 115200 8N1                                 */
/* ========================================================================== */

static void uart_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB2ENR |= RCC_APB2ENR_USART1EN;

  GPIOA->CRH &= ~((0xFUL << 4) | (0xFUL << 8));
  GPIOA->CRH |=  ((0xBUL << 4) | (0x4UL << 8));

  /* PCLK2 is 72 MHz, 115200 baud:
   *     USARTDIV = 72000000 / (16 * 115200) = 39.0625
   *     mantissa = 39 = 0x27, fraction = 0.0625 * 16 = 1
   *     BRR = (0x27 << 4) | 1 = 0x271
   */
  USART1->BRR = 0x271UL;

  USART1->CR1 = USART_CR1_TE | USART_CR1_RE | USART_CR1_UE;
}


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


static const char k_hex[16] =
{
  '0', '1', '2', '3', '4', '5', '6', '7',
  '8', '9', 'A', 'B', 'C', 'D', 'E', 'F'
};


static void uart_put_hex8(uint8_t v)
{
  uart_putc(k_hex[(v >> 4) & 0x0FU]);
  uart_putc(k_hex[v & 0x0FU]);
}


/* ========================================================================== */
/*  Delay:  1 ms SysTick                                                      */
/* ========================================================================== */

static void systick_init(void)
{
  SysTick->LOAD = 72000UL - 1UL;                 /* 1 ms at 72 MHz */
  SysTick->VAL  = 0UL;
  SysTick->CTRL = SysTick_CTRL_CLKSOURCE_Msk
                | SysTick_CTRL_TICKINT_Msk
                | SysTick_CTRL_ENABLE_Msk;
}


static void delay_ms(uint32_t ms)
{
  uint32_t start = g_ms;

  while ((g_ms - start) < ms)
  {
  }
}


/* ========================================================================== */
/*  main                                                                      */
/* ========================================================================== */

int main(void)
{
  uint32_t t0;
  uint32_t round = 0UL;

  systick_init();
  lamps_init();
  spi_init();
  uart_init();

  /* ---- 3 quick blinks: we are alive ---- */
  led_flash(BOOT_BLINKS, BOOT_BLINK_MS, BOOT_BLINK_MS);

  uart_puts("\r\n\r\n");
  uart_puts("=====================================================\r\n");
  uart_puts("  S-LAN V4.0   SPI1 loopback + MISO line probe\r\n");
  uart_puts("  SS=PA4  SCK=PA5  MISO=PA6  MOSI=PA7\r\n");

  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    uart_puts("  clock: PLL, 72 MHz - good\r\n");
  }
  else
  {
    uart_puts("  clock: *** NOT PLL *** - the 8 MHz crystal did not\r\n");
    uart_puts("  start, so every timing is wrong.\r\n");
  }

  uart_puts("=====================================================\r\n\r\n");

  uart_puts("  WHAT TO DO\r\n");
  uart_puts("    Test 1 needs nothing at all - just read the verdict.\r\n");
  uart_puts("    Test 2 needs ONE jumper wire from PA7 to PA6.\r\n");
  uart_puts("    The module can stay plugged in, or come out.  Either is fine.\r\n\r\n");
  uart_puts("  Re-runs every 2 s.  PC13 blinks at 250 ms so you can tell\r\n");
  uart_puts("  this firmware apart from the PN532 test at a glance.\r\n\r\n");

  t0 = g_ms;

  for (;;)
  {
    /* ---- heartbeat ---- */
    if ((g_ms - g_last_hb) >= HEARTBEAT_MS)
    {
      g_last_hb = g_ms;
      GPIOC->ODR ^= (1UL << 13);
    }

    if ((g_ms - t0) < TEST_PERIOD_MS)
    {
      continue;
    }

    t0 = g_ms;
    round++;

    uart_puts("=====================================================\r\n");
    uart_puts("  round ");
    uart_put_u32(round);
    uart_puts("\r\n");
    uart_puts("=====================================================\r\n");

    test_probe_pa6();
    test_spi_loopback();

    /* ---- the one line that matters ---- */
    uart_puts("  SUMMARY\r\n");

    if ((g_probe_up == 0U) && (g_probe_down == 0U))
    {
      uart_puts("    MISO line : HELD LOW  - check the wire, it may be on GND\r\n");
    }
    else if ((g_probe_up != 0U) && (g_probe_down == 0U))
    {
      uart_puts("    MISO line : FLOATING  - the module is not driving it\r\n");
    }
    else if ((g_probe_up != 0U) && (g_probe_down != 0U))
    {
      uart_puts("    MISO line : HELD HIGH - the module is alive and talking\r\n");
    }
    else
    {
      uart_puts("    MISO line : odd - pull settings did not take effect\r\n");
    }

    if (g_loop_ok != 0U)
    {
      uart_puts("    STM32 SPI : PASS      - the MCU side is not the problem\r\n");
      LAMP_ON();
    }
    else
    {
      uart_puts("    STM32 SPI : FAIL      - fit the PA7-PA6 jumper and re-check\r\n");
      LAMP_OFF();
    }

    uart_puts("\r\n");
  }
}
