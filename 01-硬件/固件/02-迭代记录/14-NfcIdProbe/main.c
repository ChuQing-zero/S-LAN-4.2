/* ============================================================================
 *  S-LAN V4.0  --  NFC module identification probe   (SPI1, bare metal)
 *                  no HAL, no CubeMX, no library, no interrupts
 *
 *  MCU   : STM32F103C8  (Blue Pill)
 *  Build : Keil MDK-ARM 5  +  ARM Compiler 5
 *  Date  : 2026-10-06
 *
 *  ---------------------------------------------------------------------------
 *  WHAT THIS IS FOR
 *
 *  The STM32 side is already proven good: 13-SpiLoopbackTest passes, so the
 *  SPI1 peripheral, PA5/PA6/PA7, the transfer routine and the 72 MHz clock are
 *  all known to work.  Whatever is wrong is on the module.
 *
 *  The remaining unknown is WHICH CHIP the module actually carries.  The
 *  project notes say RC522; the parts list says PN532.  The two share nothing
 *  but the antenna - different registers, different SPI bit order, zero code
 *  reuse - so guessing wrong wastes an entire program.
 *
 *  Instead of guessing, this program SPEAKS BOTH PROTOCOLS, one after the
 *  other, and reports which one answers.  That is the whole program.
 *
 *      [1]  probe the MISO line first - is anything driving it at all?
 *      [2]  speak PN532      (SPI mode 0, LSB first    - unusual)
 *      [3]  speak MFRC522    (SPI mode 0, MSB first    - the normal way)
 *      ->   print a verdict naming the chip
 *
 *  ---------------------------------------------------------------------------
 *  IF NEITHER ANSWERS
 *
 *  Then it is a power, mode-switch or reset problem, not a chip problem.
 *  In order of likelihood:
 *
 *   1. NO POWER.  Both boards have a small power LED.  If it is dark, stop
 *      reading and go and find the loose VCC or GND wire.  Nothing else in
 *      this list matters until that LED is lit.
 *
 *   2. THE INTERFACE SWITCH IS NOT ON SPI.
 *      PN532 breakouts have a DIP switch choosing HSU / I2C / SPI, and the
 *      setting is latched AT POWER ON - flipping it while running does
 *      nothing at all.  You must power cycle after every change.
 *      The positions are printed on the board itself, next to the switch.
 *
 *   3. RST / RSTO is holding the chip in reset.
 *      Both chips have an active-low reset pin.  Held low, every output goes
 *      high impedance - which is EXACTLY what "nothing is driving MISO"
 *      looks like.  Most breakout boards pull it up on-board, but not all.
 *      Try tying RST (or RSTO) to 3.3 V.  Do NOT tie it to GND.
 *
 *   4. VCC is 5 V on a 3.3 V board.  RC522 boards die instantly on 5 V.
 *
 *  ---------------------------------------------------------------------------
 *  WIRING  (put the module back exactly as it was - remove the loopback jumper)
 *
 *      module                   ->   STM32
 *      ------------------------------------------------
 *      SCK                      ->   PA5
 *      MISO                     ->   PA6
 *      MOSI / SDA               ->   PA7
 *      SS / NSS / CS / SDA      ->   PA4   (the one on the SPI side, not I2C)
 *      VCC                      ->   3.3 V
 *      GND                      ->   GND
 *      IRQ                      ->   not connected
 *      RST / RSTO               ->   see item 3 above
 *
 *      NOTE ON LABELS: some NFC boards label the SPI data pins with the I2C
 *      names.  When the switch is on SPI, board SDA = MOSI and board SCL =
 *      SCK.  The silkscreen says SDA, the signal is still MOSI.
 *
 *      Serial monitor on PA9 / PA10, 115200 baud.
 *      PC13 blinks at 800 ms - a third rhythm, so you can tell at a glance
 *      which of the three programs is flashed.
 * ============================================================================
 */

/* ---------------------------------------------------------------------------
 *  Device header.  This pack is the older generation - the header is called
 *  stm32f10x.h (not stm32f1xx.h) and refuses to compile until exactly one
 *  density symbol is defined.
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

#define HEARTBEAT_MS        800U     /* third rhythm: 12 uses 500, 13 uses 250 */
#define BOOT_BLINK_MS       120U
#define BOOT_BLINKS         3U
#define TEST_PERIOD_MS      2500U
#define PROBE_SAMPLES       5U

/* ---- PN532 SPI transport bytes ---- */
#define PN_SPI_DATAWRITE    0x01U
#define PN_SPI_STATREAD     0x02U
#define PN_SPI_DATAREAD     0x03U
#define PN_READY_BIT        0x01U

#define PN_TFI_HOST         0xD4U
#define PN_TFI_PN532        0xD5U
#define PN_CMD_GET_FIRMWARE 0x02U

/* ---- MFRC522 registers we touch ---- */
#define RC_REG_COMMAND      0x01U    /* bit4 = PowerDown                  */
#define RC_REG_VERSION      0x37U    /* 0x91 / 0x92 on a real MFRC522     */
#define RC_SOFTRESET        0x0FU
#define RC_POWERDOWN_BIT    0x10U

#define RC_VER_1            0x91U
#define RC_VER_2            0x92U

/* ---- timing ---- */
#define PN_CS_SETUP_MS      1U
#define PN_CS_HOLD_MS       1U
#define PN_WAKE_MS          5U
#define PROBE_WAIT_MS       100U     /* how long to wait for a ready bit  */

#define RAW_BYTES           14U      /* enough for an ACK plus a header   */


/* ========================================================================== */
/*  Pin helpers                                                               */
/* ========================================================================== */

#define CS_LOW()             (GPIOA->BRR  = (1UL << 4))     /* PA4, active low */
#define CS_HIGH()            (GPIOA->BSRR = (1UL << 4))

#define HB_ON()              (GPIOC->ODR &= ~(1UL << 13))   /* PC13, active LOW */
#define HB_OFF()             (GPIOC->ODR |=  (1UL << 13))

#define LAMP_ON()            (GPIOB->ODR |=  (1UL << 14))
#define LAMP_OFF()           (GPIOB->ODR &= ~(1UL << 14))


/* ========================================================================== */
/*  Globals                                                                   */
/* ========================================================================== */

static volatile uint32_t g_ms = 0UL;

static uint32_t g_last_hb = 0UL;

static uint8_t g_probe_up    = 0U;   /* PA6 read with internal pull-up    */
static uint8_t g_probe_down  = 0U;   /* PA6 read with internal pull-down  */
static uint8_t g_pn_ok       = 0U;   /* 1 = the PN532 protocol answered   */
static uint8_t g_pn_ver[4];          /* firmware version if it did        */
static uint8_t g_rc_ver      = 0U;   /* VersionReg, 0 if it never read    */
static uint8_t g_rc_ok       = 0U;   /* 1 = VersionReg says MFRC522       */

/* Raw bytes the PN532 protocol handed back, kept for the printout. */
static uint8_t g_pn_raw[RAW_BYTES];


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

static void    cs_pin_init(void);
static void    spi_init_mode(uint8_t msb_first);
static uint8_t spi_xfer(uint8_t b);

static void    pa6_as_input_pull(uint8_t up);
static uint8_t pa6_read(void);

static uint8_t read_stable(void);
static void    probe_miso_line(void);

static void    pn532_try(void);
static void    mfrc522_try(void);
static void    print_verdict(void);


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

/* PA4 alone, as a plain push-pull output.  Shared by both protocols. */
static void cs_pin_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;

  GPIOA->CRL &= ~(0xFUL << 16);
  GPIOA->CRL |=  (0x3UL << 16);       /* PA4: MODE 11 (50 MHz), CNF 00 out */
  CS_HIGH();
}


/* The one thing the two chips disagree about is bit order:
 *
 *      PN532     LSB first   (very unusual - almost nothing else does this)
 *      MFRC522   MSB first   (the normal way every SPI chip works)
 *
 *  0x01 on the wire therefore comes out as 0x80 to the other one, which is
 *  why the same wiring cannot serve both and why speaking the wrong protocol
 *  returns pure garbage rather than an error.
 *
 *  SPE must be cleared before the format bits can be changed.
 */
static void spi_init_mode(uint8_t msb_first)
{
  uint16_t cr1;

  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB2ENR |= RCC_APB2ENR_SPI1EN;

  SPI1->CR1 &= (uint16_t)~SPI_CR1_SPE;

  GPIOA->CRL &= ~(0xFFFFUL << 16);
  GPIOA->CRL |=  ((0x3UL << 16) | (0xBUL << 20) | (0x4UL << 24) | (0xBUL << 28));

  CS_HIGH();

  cr1 = (uint16_t)(SPI_CR1_MSTR
                 | SPI_CR1_SSM
                 | SPI_CR1_SSI
                 | SPI_CR1_BR_2
                 | SPI_CR1_BR_0);    /* /64 = 1.125 MHz, both chips are fine */

  if (msb_first == 0U)
  {
    cr1 = (uint16_t)(cr1 | SPI_CR1_LSBFIRST);
  }

  SPI1->CR1  = cr1;
  SPI1->CR1 |= SPI_CR1_SPE;
}


/* One byte out, one byte in.  DR is accessed as a byte because DFF is 0. */
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
/*  PA6 as a probed input                                                     */
/* ========================================================================== */

/* MODE 00, CNF 10 = input with pull.  The direction is chosen by the OUTPUT
 * data register bit, which is a quirk of the STM32F1 family - ODR does double
 * duty because the pin is not actually an output.
 *
 *     ODR bit 6 = 1  ->  pull-UP   (~40 kohm to 3.3 V)
 *     ODR bit 6 = 0  ->  pull-DOWN (~40 kohm to GND)
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


/* The weak internal resistor cannot fight anything that is actively driving,
 * but it easily beats a line that is merely floating.  Two readings therefore
 * classify the wire completely:
 *
 *      up=1 down=0   floating   - nothing is driving it
 *      up=0 down=0   held low   - a real low-impedance path to ground
 *      up=1 down=1   held high  - something IS driving it
 */
static void probe_miso_line(void)
{
  uart_puts("  [1] MISO line (PA6), with SS held LOW (chip selected)\r\n");

  /* *** SS MUST BE LOW FOR THIS TO MEAN ANYTHING. ***
   *
   * An SPI slave releases MISO whenever it is not selected - that is how the
   * bus is allowed to be shared at all.  Probing with SS HIGH therefore always
   * reads "floating", whether the module is perfectly healthy or completely
   * dead, and an earlier version of this program was foolish enough to do
   * exactly that and send everyone hunting for a fault that was not there.
   *
   * With SS LOW the slave is selected and must drive the line. */
  CS_LOW();
  delay_ms(2);

  pa6_as_input_pull(1U);
  delay_ms(2);
  g_probe_up = read_stable();

  uart_puts("      with pull-UP     reads ");
  uart_puts((g_probe_up != 0U) ? "1" : "0");
  uart_puts("\r\n");

  pa6_as_input_pull(0U);
  delay_ms(2);
  g_probe_down = read_stable();

  uart_puts("      with pull-DOWN   reads ");
  uart_puts((g_probe_down != 0U) ? "1" : "0");
  uart_puts("\r\n");

  CS_HIGH();

  if ((g_probe_up != 0U) && (g_probe_down == 0U))
  {
    uart_puts("      -> FLOATING.  Nothing is driving MISO even when the chip\r\n");
    uart_puts("         is selected.  The module is dead to the bus - no power,\r\n");
    uart_puts("         wrong interface switch, or held in reset.\r\n");
  }
  else if ((g_probe_up == 0U) && (g_probe_down == 0U))
  {
    uart_puts("      -> HELD LOW.  Something is pulling PA6 to ground.\r\n");
    uart_puts("         Either the wire is on a GND pin instead of MISO,\r\n");
    uart_puts("         or the slave happens to be driving its first bit low.\r\n");
  }
  else if ((g_probe_up != 0U) && (g_probe_down != 0U))
  {
    uart_puts("      -> HELD HIGH.  Something IS driving MISO.\r\n");
    uart_puts("         A live slave is answering.  This is the healthy case.\r\n");
  }
  else
  {
    uart_puts("      -> odd result - the pull settings did not take effect.\r\n");
  }

  uart_puts("\r\n");
}


/* ========================================================================== */
/*  PN532 protocol   -   SPI mode 0, LSB first                                */
/* ========================================================================== */

/* Read the status byte.  Two bytes go out because SPI is full duplex: while
 * the PN532 is being told "give me your status" it is still shifting out
 * whatever was left in its buffer, so the first byte back is junk. */
static uint8_t pn_status(void)
{
  uint8_t st;

  CS_LOW();
  delay_ms(PN_CS_SETUP_MS);

  (void)spi_xfer(PN_SPI_STATREAD);
  st = spi_xfer(0x00U);

  CS_HIGH();
  delay_ms(PN_CS_HOLD_MS);

  return st;
}


static uint8_t pn_wait_ready(void)
{
  uint32_t t0 = g_ms;

  while ((g_ms - t0) < PROBE_WAIT_MS)
  {
    if ((pn_status() & PN_READY_BIT) != 0U)
    {
      return 1U;
    }
  }

  return 0U;
}


/* Send 00 00 FF LEN LCS D4 02 DCS 00 in one CS window. */
static void pn_send_get_firmware(void)
{
  /* GetFirmwareVersion: LEN = 02, LCS = FE, TFI = D4, CMD = 02, sum = 2A */
  static const uint8_t frame[9] =
  {
    0x00U, 0x00U, 0xFFU, 0x02U, 0xFEU,
    PN_TFI_HOST, PN_CMD_GET_FIRMWARE,
    0x2AU, 0x00U
  };

  uint8_t i;

  CS_LOW();
  delay_ms(PN_CS_SETUP_MS);

  (void)spi_xfer(PN_SPI_DATAWRITE);

  for (i = 0U; i < 9U; i++)
  {
    (void)spi_xfer(frame[i]);
  }

  CS_HIGH();
  delay_ms(PN_CS_HOLD_MS);
}


/* Pull n bytes out with DATAREAD, in one CS window.
 *
 * Only ever call this after pn_wait_ready() has said the chip is ready.  The
 * readiness poll is what guarantees there is something to read: the instant
 * the chip runs out of bytes to send it releases MISO, and a high-impedance
 * line next to a running clock reads back as a run of 0xAA - the clock
 * leaking into the wire.  Reading past the end of a frame looks exactly like
 * that and is not a fault. */
static void pn_read_n(uint8_t *dst, uint8_t n)
{
  uint8_t i;

  CS_LOW();
  delay_ms(PN_CS_SETUP_MS);

  (void)spi_xfer(PN_SPI_DATAREAD);

  for (i = 0U; i < n; i++)
  {
    dst[i] = spi_xfer(0x00U);
  }

  CS_HIGH();
  delay_ms(PN_CS_HOLD_MS);
}


static void pn532_try(void)
{
  static const uint8_t k_ack[6] =
  {
    0x00U, 0x00U, 0xFFU, 0x00U, 0xFFU, 0x00U
  };

  uint8_t ack[6];
  uint8_t ack_ok = 1U;
  uint8_t i;

  uart_puts("  [2] speaking PN532   (SPI mode 0, LSB first)\r\n");

  spi_init_mode(0U);                  /* 0 = LSB first */

  /* Leave power-down: NSS held low for a millisecond is the documented wake. */
  CS_LOW();
  delay_ms(PN_WAKE_MS);
  CS_HIGH();
  delay_ms(PN_WAKE_MS);

  g_pn_ok = 0U;
  g_pn_ver[0] = 0U;
  g_pn_ver[1] = 0U;
  g_pn_ver[2] = 0U;
  g_pn_ver[3] = 0U;

  pn_send_get_firmware();

  /* ---- step 1: the fixed 6 byte ACK -------------------------------------
   * This is the chip saying "I heard you".  It arrives first, always, before
   * any real data.
   * -------------------------------------------------------------------- */
  if (pn_wait_ready() == 0U)
  {
    uart_puts("      no ready bit after the command\r\n\r\n");
    return;
  }

  pn_read_n(ack, 6U);

  uart_puts("      ACK    = ");
  for (i = 0U; i < 6U; i++)
  {
    uart_put_hex8(ack[i]);
    uart_putc(' ');
  }
  uart_puts("  (want 00 00 FF 00 FF 00)\r\n");

  for (i = 0U; i < 6U; i++)
  {
    if (ack[i] != k_ack[i])
    {
      ack_ok = 0U;
    }
  }

  if (ack_ok == 0U)
  {
    uart_puts("      -> no valid ACK - the chip did not accept the command\r\n\r\n");
    return;
  }

  uart_puts("      -> ACK ok.  The chip heard the command and is working.\r\n");

  /* ---- step 2: the response, which only exists a moment later -----------
   * The ready bit has to be polled AGAIN here.  Reading straight through
   * without this second wait is what turns the tail of the buffer into
   * 0xAA - the chip has released MISO because it has not finished yet.
   * -------------------------------------------------------------------- */
  if (pn_wait_ready() == 0U)
  {
    uart_puts("      but no response frame arrived in time\r\n\r\n");
    return;
  }

  pn_read_n(g_pn_raw, RAW_BYTES);

  uart_puts("      reply  = ");
  for (i = 0U; i < RAW_BYTES; i++)
  {
    uart_put_hex8(g_pn_raw[i]);
    uart_putc(' ');
  }
  uart_puts("\r\n");

  /* A GetFirmwareVersion reply is
   *     00 00 FF 06 FA D5 03 <ver0> <ver1> <ver2> <ver3> DCS 00 */
  if ((g_pn_raw[0] == 0x00U) && (g_pn_raw[1] == 0x00U) &&
      (g_pn_raw[2] == 0xFFU) && (g_pn_raw[5] == PN_TFI_PN532) &&
      (g_pn_raw[6] == (uint8_t)(PN_CMD_GET_FIRMWARE + 1U)))
  {
    g_pn_ok = 1U;

    for (i = 0U; i < 4U; i++)
    {
      g_pn_ver[i] = g_pn_raw[7U + i];
    }

    uart_puts("      -> A PN532 IS ANSWERING.  firmware ");
    uart_put_hex8(g_pn_ver[0]);
    uart_putc(' ');
    uart_put_hex8(g_pn_ver[1]);
    uart_putc(' ');
    uart_put_hex8(g_pn_ver[2]);
    uart_putc(' ');
    uart_put_hex8(g_pn_ver[3]);
    uart_puts("\r\n");
    uart_puts("         32 01 06 07 is a genuine PN532.  Anything else is a\r\n");
    uart_puts("         clone - and a clone is fine.\r\n\r\n");
  }
  else
  {
    uart_puts("      -> the reply is not a firmware frame\r\n\r\n");
  }
}


/* ========================================================================== */
/*  MFRC522 protocol   -   SPI mode 0, MSB first                              */
/* ========================================================================== */

/* The address byte carries the direction in its top bit:
 *
 *      bit 7 = 0  ->  write
 *      bit 7 = 1  ->  read
 *      bits 1..6  ->  the register address
 *      bit 0      ->  must be 0
 */
static void rc_write(uint8_t addr, uint8_t val)
{
  CS_LOW();
  (void)spi_xfer((uint8_t)((addr << 1) & 0x7EU));
  (void)spi_xfer(val);
  CS_HIGH();
}


static uint8_t rc_read(uint8_t addr)
{
  uint8_t v;

  CS_LOW();
  (void)spi_xfer((uint8_t)(((addr << 1) & 0x7EU) | 0x80U));
  v = spi_xfer(0x00U);
  CS_HIGH();

  return v;
}


static void mfrc522_try(void)
{
  uint32_t t0;

  uart_puts("  [3] speaking MFRC522 (SPI mode 0, MSB first)\r\n");

  spi_init_mode(1U);                  /* 1 = MSB first */

  g_rc_ver = 0U;
  g_rc_ok  = 0U;

  /* Soft reset first - it puts the chip in a known state and, more usefully
   * here, it is itself a test: a chip that is not there will not clear the
   * PowerDown bit. */
  rc_write(RC_REG_COMMAND, RC_SOFTRESET);

  t0 = g_ms;
  while ((g_ms - t0) < 50U)
  {
    if ((rc_read(RC_REG_COMMAND) & RC_POWERDOWN_BIT) == 0U)
    {
      break;
    }
  }

  g_rc_ver = rc_read(RC_REG_VERSION);

  uart_puts("      VersionReg (0x37) = ");
  uart_put_hex8(g_rc_ver);
  uart_puts("   (0x91 or 0x92 = real MFRC522)\r\n");

  if ((g_rc_ver == RC_VER_1) || (g_rc_ver == RC_VER_2))
  {
    g_rc_ok = 1U;
    uart_puts("      -> AN MFRC522 IS ANSWERING\r\n\r\n");
  }
  else if ((g_rc_ver == 0x00U) || (g_rc_ver == 0xFFU))
  {
    uart_puts("      -> no answer (all 0 or all 1 - the line is stuck)\r\n\r\n");
  }
  else
  {
    uart_puts("      -> something answered, but it is not a standard MFRC522\r\n");
    uart_puts("         (unknown clone, or the byte order is off)\r\n\r\n");
  }
}


/* ========================================================================== */
/*  Verdict                                                                   */
/* ========================================================================== */

static void print_verdict(void)
{
  uart_puts("  ================================================\r\n");

  if (g_pn_ok != 0U)
  {
    uart_puts("   VERDICT: this is a PN532\r\n");
    uart_puts("            use the 12-Pn532SpiTest program\r\n");
    LAMP_ON();
  }
  else if (g_rc_ok != 0U)
  {
    uart_puts("   VERDICT: this is an RC522 (MFRC522)\r\n");
    uart_puts("            the PN532 code can never work on it\r\n");
    LAMP_ON();
  }
  else if (g_rc_ver == 0x00U)
  {
    uart_puts("   VERDICT: nothing answered, and MISO read as all zeros\r\n");
    uart_puts("            -> the module is probably NOT POWERED\r\n");
    uart_puts("               check its LED, then VCC and GND\r\n");
    LAMP_OFF();
  }
  else if ((g_probe_up != 0U) && (g_probe_down == 0U))
  {
    uart_puts("   VERDICT: nothing answered, and MISO is floating\r\n");
    uart_puts("            -> the module is not driving its data pin\r\n");
    uart_puts("               no power / switch not on SPI / held in reset\r\n");
    LAMP_OFF();
  }
  else
  {
    uart_puts("   VERDICT: neither protocol answered.  See the four\r\n");
    uart_puts("            causes listed at the top of main.c\r\n");
    LAMP_OFF();
  }

  uart_puts("  ================================================\r\n\r\n");
}


/* ========================================================================== */
/*  Pin setup                                                                 */
/* ========================================================================== */

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
  cs_pin_init();
  uart_init();

  led_flash(BOOT_BLINKS, BOOT_BLINK_MS, BOOT_BLINK_MS);

  uart_puts("\r\n\r\n");
  uart_puts("=====================================================\r\n");
  uart_puts("  S-LAN V4.0   NFC module identification\r\n");
  uart_puts("  SS=PA4  SCK=PA5  MISO=PA6  MOSI=PA7\r\n");

  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    uart_puts("  clock: PLL, 72 MHz - good\r\n");
  }
  else
  {
    uart_puts("  clock: *** NOT PLL *** - every timing is wrong\r\n");
  }

  uart_puts("=====================================================\r\n\r\n");
  uart_puts("  Take the A6-A7 loopback jumper OUT first, and put the\r\n");
  uart_puts("  module's MISO and MOSI wires back, the way they were.\r\n\r\n");

  t0 = g_ms;

  for (;;)
  {
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

    probe_miso_line();
    pn532_try();
    mfrc522_try();
    print_verdict();
  }
}
