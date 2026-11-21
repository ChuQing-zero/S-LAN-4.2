/* ============================================================================
 *  S-LAN V4.0  --  PN532 NFC reader bring-up test   (SPI1, bare metal)
 *                  no HAL, no CubeMX, no library, no interrupts
 *
 *  MCU   : STM32F103C8  (Blue Pill)
 *  Build : Keil MDK-ARM 5  +  ARM Compiler 5
 *  Date  : 2026-10-06
 *
 *  ---------------------------------------------------------------------------
 *  WHAT IT DOES
 *
 *      1. Wakes the PN532 and asks for its firmware version.
 *
 *              *** THIS IS THE TEST.  NOTHING ELSE MATTERS. ***
 *
 *         If it answers "32 01 06 07", then the SPI wiring, the LSB-first
 *         setting, the clock mode, MISO/MOSI polarity, VCC and GND are ALL
 *         correct.  There is nothing left to prove about the link.
 *
 *      2. Puts it into normal SAM mode (required before any card command).
 *
 *      3. Polls for a card twice a second and prints the UID when one appears.
 *
 *              PN532 firmware: 32 01 06 07
 *              card 1: UID = 04 A1 B2 C3
 *              OUT,N,4,04A1B2C3
 *
 *  ---------------------------------------------------------------------------
 *  OUTPUT PROTOCOL  (same shape as the QR scanner test, so the PC side can
 *                    parse both with one reader)
 *
 *          OUT,N,<len>,<UID in hex>\r\n      a card is present
 *          OUT,N,0,\r\n                      the card was removed
 *
 *      <len> is the UID length in BYTES (4 for Mifare Classic, 7 for NTAG /
 *      Ultralight, 10 for some bank cards).  One line per event - only when
 *      the card appears or disappears, never on every poll, so you do not get
 *      two lines a second.
 *
 *  ---------------------------------------------------------------------------
 *  WIRING
 *
 *      PN532                    ->   STM32
 *      ------------------------------------------------
 *      SCK                      ->   PA5   (pin 15)
 *      MISO                     ->   PA6   (pin 16)
 *      MOSI                     ->   PA7   (pin 17)
 *      SS                       ->   PA4   (pin 14)  software driven
 *      VCC                      ->   3.3V
 *      GND                      ->   GND
 *      IRQ                      ->   not connected  (we poll instead)
 *      RSTO / RSTPDN            ->   not connected  (see troubleshooting)
 *
 *      Serial monitor, three wires, 115200 baud:
 *
 *          CH340 TXD ---> PA10   (USART1_RX)
 *          CH340 RXD ---> PA9    (USART1_TX)
 *          CH340 GND ---> GND
 *
 *      Lamps - all optional, the program is useful without them:
 *
 *          PB14 - lamp 1 - PN532 answered (stays on once the link is up)
 *          PB15 - lamp 2 - something failed
 *          PA11 - lamp 3 - polling right now
 *          PA12 - lamp 4 - a card is in the field
 *          PC13 - onboard LED, heartbeat
 *
 *  ===========================================================================
 *  IF IT DOES NOT WORK, THE ANSWER IS ONE OF THESE FOUR
 *
 *   1. THE MODULE IS NOT SET TO SPI.
 *      PN532 breakouts have a DIP switch choosing HSU / I2C / SPI.  On the
 *      wrong setting the module is completely silent - no error, no ACK,
 *      nothing at all.  The positions are printed next to the switch on the
 *      board itself.  This is the single most common cause.
 *
 *   2. MISO AND MOSI ARE SWAPPED.
 *      The PN532 is an SPI slave.  Depending on the board, the silkscreen
 *      labels MISO/MOSI either from the module's point of view or from the
 *      host's - and they come out backwards.  If the firmware read returns
 *      FF FF FF or 00 00 00, swap those two wires and retry.  It costs
 *      nothing and cannot damage anything.
 *
 *   3. RSTPDN IS HELD IN RESET.
 *      RSTPD_N is an active-low reset: chained to the wrong level the chip
 *      stays in reset and every output goes high impedance, so MISO floats
 *      and nothing ever answers.  A floating MISO line is exactly what that
 *      looks like.  Most boards tie it correctly on-board and leaving the
 *      header pin unconnected is fine, but not all of them.
 *      If the supply and the interface switch are both confirmed good and
 *      the module is still silent, try RSTO on 3.3 V, then on GND - one of
 *      the two releases it.  Neither level can damage the pin.
 *
 *   4. VCC IS 5 V ON A 3.3 V BOARD.
 *      Instant death on some breakouts.  Read the silkscreen first.
 *
 *  AND IF THE MODULE TURNS OUT TO BE AN RC522, none of this works - the two
 *  chips share nothing but the antenna.  Tell me and I will write that one.
 *
 *  ---------------------------------------------------------------------------
 *  THE ONE THING THAT MAKES PN532 SPI DIFFERENT FROM EVERY OTHER SPI DEVICE
 *
 *      The PN532 SPI interface is LSB FIRST.  Every other SPI chip you have
 *      ever met is MSB first.  On AVR and ESP32 people have to bit-reverse
 *      every byte in software, which is where the "PN532 SPI is a nightmare"
 *      reputation comes from - the symptom is that 0x01 reads back as 0x80.
 *
 *      The STM32 SPI peripheral has a hardware LSBFIRST bit (SPI_CR1 bit 7)
 *      so here it is one line of setup.  But if you ever port this to another
 *      chip, DO NOT FORGET IT - without it every byte arrives bit reversed
 *      and nothing works, with no error message anywhere.
 *
 *      The other three settings, for the record:
 *          SPI mode 0        CPOL = 0, CPHA = 0, data sampled on first edge
 *          NSS               active low, toggled per transaction
 *          ACK frame         the fixed 6 bytes  00 00 FF 00 FF 00  after
 *                            every command, before the real response
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

/* ---- PN532 SPI transport bytes ----------------------------------------
 *  The first byte clocked out on MOSI tells the PN532 what we want.
 *  The low two bits are the whole message: xx01 / xx10 / xx11.
 * ---------------------------------------------------------------------- */
#define PN_SPI_DATAWRITE  0x01U
#define PN_SPI_STATREAD   0x02U
#define PN_SPI_DATAREAD   0x03U

#define PN_READY_BIT      0x01U      /* status byte bit 0 = 1 -> frame waiting */

/* ---- PN532 frame markers ---- */
#define PN_TFI_HOST       0xD4U      /* host -> PN532 */
#define PN_TFI_PN532      0xD5U      /* PN532 -> host */
#define PN_ACK_0          0x00U      /* the ACK is a fixed 6 byte literal,  */
#define PN_ACK_1          0x00U      /* NOT a normal length-checksummed      */
#define PN_ACK_2          0xFFU      /* frame.  Counting it with the normal  */
#define PN_ACK_3          0x00U      /* formula gives 07 bytes, one too many,*/
#define PN_ACK_4          0xFFU      /* and the extra byte eats the start of */
#define PN_ACK_5          0x00U      /* the response.  Read exactly 6.       */

/* ---- PN532 commands ---- */
#define PN_CMD_GET_FIRMWARE      0x02U
#define PN_CMD_GET_GENERAL_STATUS 0x04U   /* battery only - not used in anger  */
#define PN_CMD_SAMCONFIG         0x14U
#define PN_CMD_INLIST_PASSIVE    0x4AU

/* ---- Timing -----------------------------------------------------------
 *
 *  Deliberately slow and generous.  This is a bring-up test: the point is to
 *  find out whether the link works at all, not to be fast.  A card read takes
 *  about 50 ms here, against a 6 second per card budget, so there is nothing
 *  to win by shaving milliseconds and a lot to lose by being too clever.
 *
 *  SPI clock is PCLK2 / 64 = 72 MHz / 64 = 1.125 MHz.  The PN532 is good for
 *  about 5 MHz, so there is 4x of headroom.  Raise it later if you care.
 * ---------------------------------------------------------------------- */
#define PN_CS_SETUP_MS      1U       /* SS low  -> first clock edge          */
#define PN_CS_HOLD_MS       1U       /* SS high -> next transaction          */
#define PN_WAKE_MS          5U       /* SS low at boot, to leave power down  */
#define PN_ACK_TIMEOUT_MS   1000U    /* manual: ACK within 15 ms, be generous*/
/* InListPassiveTarget is the one command that does real work before it
 * answers: the PN532 powers the RF field up, polls, and only then builds the
 * reply, and with an empty field that reply is still a real frame
 * (D5 4B 00, "NbTg = 0").  It is NOT a slow-ACK-fast-nothing command, so a
 * 1 s window is not generous here - it is the thing that was cutting the
 * reply off.  3 s is the manual's figure for the no-card case plus margin. */
#define PN_POLL_TIMEOUT_MS  3000U    /* InListPassiveTarget reply window     */
#define PN_POLL_PERIOD_MS   500U     /* how often to look for a card         */
/* The PN532 accepts InListPassiveTarget and ACKs it, but on roughly one poll
 * in three it never produces the reply - and the late read shows an idle
 * MISO, so the reply is not merely late, it was never sent.  Measured on the
 * bench over 22 polls.  One re-send gets a real answer every time, so a
 * dropped command is retried instead of being reported as a fault. */
#define PN_POLL_TRIES       3U       /* re-sends before believing a miss     */
#define PN_POLL_RETRY_GAP_MS 20U     /* let the RF state machine settle      */

#define PN_BUF              64U      /* biggest frame here is 22 bytes       */

/* ---- Boot ---- */
#define BOOT_BLINK_MS       300U
#define BOOT_BLINKS         3U

/* ---- Heartbeat ---- */
#define HEARTBEAT_MS        500U

/* ---- Card event blink ---- */
#define CARD_BLINK_MS       80U
#define CARD_BLINKS         3U


/* ========================================================================== */
/*  Pin helpers                                                               */
/* ========================================================================== */

#define PN_CS_LOW()          (GPIOA->BRR  = (1UL << 4))     /* PA4, active low */
#define PN_CS_HIGH()         (GPIOA->BSRR = (1UL << 4))

#define LAMP_LINK_ON()       (GPIOB->ODR |=  (1UL << 14))   /* PB14 */
#define LAMP_LINK_OFF()      (GPIOB->ODR &= ~(1UL << 14))
#define LAMP_ERROR_ON()      (GPIOB->ODR |=  (1UL << 15))   /* PB15 */
#define LAMP_ERROR_OFF()     (GPIOB->ODR &= ~(1UL << 15))
#define LAMP_POLL_ON()       (GPIOA->ODR |=  (1UL << 11))   /* PA11 */
#define LAMP_POLL_OFF()      (GPIOA->ODR &= ~(1UL << 11))
#define LAMP_CARD_ON()       (GPIOA->ODR |=  (1UL << 12))   /* PA12 */
#define LAMP_CARD_OFF()      (GPIOA->ODR &= ~(1UL << 12))

#define HB_ON()              (GPIOC->ODR &= ~(1UL << 13))   /* PC13, active LOW */
#define HB_OFF()             (GPIOC->ODR |=  (1UL << 13))


/* ========================================================================== */
/*  Globals                                                                   */
/* ========================================================================== */

static volatile uint32_t g_ms = 0UL;

static uint32_t g_last_hb = 0UL;

/* Bring-up diagnostics.  Filled by every transport attempt and printed when
 * one fails.  These raw bytes are what turn "it does not work" into
 * "the link is bit-reversed" or "MISO is not connected" - without them the
 * only honest answer is a guess. */
static uint8_t g_last_status = 0U;
static uint8_t g_ack_raw[6];
static uint8_t g_ack_got     = 0U;

/* The last card we saw, so a card sitting in the field does not re-print
 * twice a second. */
static uint8_t g_have_card   = 0U;
static uint8_t g_last_uid[10];
static uint8_t g_last_uid_len = 0U;

/* What SAMConfiguration returned at boot.  Kept so the poll loop can repeat it
 * in its first failure line: the two failures are almost always the same
 * fault, and this makes one paste of the poll output enough to see it. */
static uint8_t g_sam_rc       = 0xFFU;


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

static uint8_t  pn_status(void);
static uint8_t  pn_wait_ready(uint32_t timeout_ms);
static void     pn_write_frame(const uint8_t *f, uint16_t n);
static uint8_t  pn_read_ack(void);
static uint16_t pn_read_frame(uint8_t *out, uint16_t maxlen);
static void     pn_dump_raw(const uint8_t *b, uint16_t n);
static uint8_t  pn_all_same(const uint8_t *b, uint8_t n, uint8_t v);
static void     pn_diag(uint8_t rc);

static void     pn_abort(void);
static void     pn_late_dump(void);
static uint8_t  pn_probe(const char *label, uint8_t cmd, const uint8_t *params,
                         uint8_t nparams, uint32_t wait_ms);

static uint8_t pn_send(uint8_t cmd, const uint8_t *params, uint8_t nparams,
                       uint32_t wait_ms,
                       uint8_t *resp, uint16_t maxresp, uint16_t *resplen);

static uint8_t pn_get_firmware(uint8_t *ver4);
static uint8_t pn_read_uid(uint8_t *uid, uint8_t *uidlen);


/* ========================================================================== */
/*  Interrupt handlers                                                        */
/* ========================================================================== */

void SysTick_Handler(void)
{
  g_ms++;
}


/* ========================================================================== */
/*  SPI1  --  PA4 SS, PA5 SCK, PA6 MISO, PA7 MOSI                            */
/* ========================================================================== */

/* GPIOA->CRL nibbles, bits 16..31:
 *
 *   PA4  bits 16..19   0x3 = MODE 11 (50 MHz), CNF 00 (push-pull output)
 *   PA5  bits 20..23   0xB = MODE 11 (50 MHz), CNF 10 (alternate func PP)
 *   PA6  bits 24..27   0x4 = MODE 00 (input),   CNF 01 (floating)
 *   PA7  bits 28..31   0xB = MODE 11 (50 MHz), CNF 10 (alternate func PP)
 *
 * PA4 is a plain output on purpose, not the hardware NSS.  Hardware NSS on
 * the F1 only works in multi-master mode and misbehaves in single-master -
 * every practical STM32 SPI driver drives CS from software like this.
 */
static void spi_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB2ENR |= RCC_APB2ENR_SPI1EN;

  GPIOA->CRL &= ~(0xFFFFUL << 16);
  GPIOA->CRL |=  ((0x3UL << 16) | (0xBUL << 20) | (0x4UL << 24) | (0xBUL << 28));

  PN_CS_HIGH();                       /* idle high, before the pin is live */

  /* ---- the four settings that matter ---------------------------------
   *
   *  SPI_CR1_LSBFIRST   *** MANDATORY ***  the PN532 shifts LSB first.
   *                     Without this every byte is bit reversed and the
   *                     whole thing fails silently.  See the header.
   *
   *  SPI_CR1_MSTR       master, obviously.
   *
   *  SPI_CR1_SSM | SSI  software slave management, internal NSS held high.
   *                     Without these two the SPI peripheral sees its own
   *                     NSS pin floating and drops into slave mode.
   *
   *  BR_2 | BR_0        fPCLK2 / 64 = 1.125 MHz.  PN532 manages ~5 MHz.
   *
   *  CPOL and CPHA are left at 0, which IS SPI mode 0 - the mode the PN532
   *  wants.  They are not omitted by accident.
   * -------------------------------------------------------------------- */
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
 * explicit that in 8-bit mode DR must be accessed as a byte.  A 32-bit
 * access like  SPI1->DR = b;  happens to work on this part but it is
 * undefined behaviour and it breaks the moment DFF changes.
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
/*  PN532 low level                                                           */
/* ========================================================================== */

/* Read the status byte.
 *
 * Two bytes go out, not one.  SPI is full duplex: while the PN532 is being
 * told "give me your status" it is still shifting out whatever was left in
 * its buffer, so the first byte back is junk and must be thrown away.  The
 * status byte arrives on the second byte.
 *
 *   MOSI:  [0x02] [0x00]
 *   MISO:  [junk] [STATUS]
 */
static uint8_t pn_status(void)
{
  uint8_t st;

  PN_CS_LOW();
  delay_ms(PN_CS_SETUP_MS);

  (void)spi_xfer(PN_SPI_STATREAD);
  st = spi_xfer(0x00U);

  PN_CS_HIGH();
  delay_ms(PN_CS_HOLD_MS);

  g_last_status = st;

  return st;
}


/* Poll until bit 0 of the status byte goes high, or give up. */
static uint8_t pn_wait_ready(uint32_t timeout_ms)
{
  uint32_t t0 = g_ms;

  while ((g_ms - t0) < timeout_ms)
  {
    if ((pn_status() & PN_READY_BIT) != 0U)
    {
      return 1U;
    }
  }

  return 0U;
}


/* Send one frame: 0x01 (write data) then the frame bytes, in one CS window. */
static void pn_write_frame(const uint8_t *f, uint16_t n)
{
  uint16_t i;

  PN_CS_LOW();
  delay_ms(PN_CS_SETUP_MS);

  (void)spi_xfer(PN_SPI_DATAWRITE);

  for (i = 0U; i < n; i++)
  {
    (void)spi_xfer(f[i]);
  }

  PN_CS_HIGH();
  delay_ms(PN_CS_HOLD_MS);
}


/* Read the 6 byte ACK literal.  See PN_ACK_0..5 for why it is 6 and not 7. */
static uint8_t pn_read_ack(void)
{
  uint8_t buf[6];
  uint8_t i;

  PN_CS_LOW();
  delay_ms(PN_CS_SETUP_MS);

  (void)spi_xfer(PN_SPI_DATAREAD);

  for (i = 0U; i < 6U; i++)
  {
    buf[i] = spi_xfer(0x00U);
  }

  PN_CS_HIGH();
  delay_ms(PN_CS_HOLD_MS);

  /* Keep the bytes even when they are wrong - pn_diag() prints them. */
  for (i = 0U; i < 6U; i++)
  {
    g_ack_raw[i] = buf[i];
  }
  g_ack_got = 1U;

  if ((buf[0] != PN_ACK_0) || (buf[1] != PN_ACK_1) || (buf[2] != PN_ACK_2) ||
      (buf[3] != PN_ACK_3) || (buf[4] != PN_ACK_4) || (buf[5] != PN_ACK_5))
  {
    return 0U;
  }

  return 1U;
}


/* Pull SS low then high again with no clock at all.
 *
 * The PN532 counts SPI bytes between the falling and the rising edge of SS, so
 * a bare pulse abandons a half-read frame and drops the chip back onto a byte
 * boundary.  Cheap insurance after any transaction we walked away from: it
 * costs two milliseconds and it stops one bad command poisoning the next. */
static void pn_abort(void)
{
  PN_CS_LOW();
  delay_ms(PN_CS_SETUP_MS);
  PN_CS_HIGH();
  delay_ms(PN_CS_HOLD_MS);
}


/* Read whatever is in the PN532's buffer right now, without waiting for the
 * ready bit.  Only ever called after a timeout has already expired, so it
 * cannot cost anything - the transaction is being abandoned anyway.
 *
 * A real frame here means the reply was merely late and the timeout above is
 * still too short.  All FF or all 00 means the module genuinely said nothing
 * and the fault is elsewhere.  Caller must call pn_abort() afterwards. */
static void pn_late_dump(void)
{
  uint8_t b[8];
  uint8_t i;

  PN_CS_LOW();
  delay_ms(PN_CS_SETUP_MS);

  (void)spi_xfer(PN_SPI_DATAREAD);

  for (i = 0U; i < 8U; i++)
  {
    b[i] = spi_xfer(0x00U);
  }

  PN_CS_HIGH();
  delay_ms(PN_CS_HOLD_MS);

  uart_puts("      late read   = ");
  for (i = 0U; i < 8U; i++)
  {
    uart_put_hex8(b[i]);
    uart_putc(' ');
  }
  uart_puts("\r\n");
}


/* Send one command and narrate the whole thing: what came back on success,
 * and on failure the ACK bytes plus a late dump.  Returns pn_send()'s code.
 *
 * This exists so a single flash can compare several commands against each
 * other.  "The card command fails" is not a diagnosis; "command 1 works,
 * command 2 works, command 3 fails" narrows it to one layer in one run. */
static uint8_t pn_probe(const char *label, uint8_t cmd, const uint8_t *params,
                        uint8_t nparams, uint32_t wait_ms)
{
  uint8_t  resp[PN_BUF];
  uint16_t rlen = 0U;
  uint8_t  rc;
  uint8_t  i;

  uart_puts("  ");
  uart_puts(label);
  uart_puts(" ... ");

  rc = pn_send(cmd, params, nparams, wait_ms, resp, PN_BUF, &rlen);

  if (rc == 0U)
  {
    uart_puts("ok  ");
    uart_put_u32((uint32_t)rlen);
    uart_puts("B: ");
    for (i = 0U; i < rlen; i++)
    {
      uart_put_hex8(resp[i]);
      uart_putc(' ');
    }
    uart_puts("\r\n");
    return 0U;
  }

  uart_puts("FAILED, code ");
  uart_put_u32((uint32_t)rc);
  uart_puts("\r\n      ack bytes   = ");
  if (g_ack_got != 0U)
  {
    for (i = 0U; i < 6U; i++)
    {
      uart_put_hex8(g_ack_raw[i]);
      uart_putc(' ');
    }
  }
  else
  {
    uart_puts("nothing read - RDY never came up");
  }
  uart_puts("\r\n");

  pn_late_dump();
  pn_abort();

  return rc;
}


/* True when every one of the first n bytes equals v. */
static uint8_t pn_all_same(const uint8_t *b, uint8_t n, uint8_t v)
{
  uint8_t i;

  for (i = 0U; i < n; i++)
  {
    if (b[i] != v)
    {
      return 0U;
    }
  }

  return 1U;
}


/* Read one response frame and hand back just the payload.
 *
 * A normal frame is
 *
 *      00 00 FF  LEN  LCS  TFI  DATA...  DCS  00
 *
 * so the total length is 7 + LEN and everything is read inside ONE CS-low
 * window - splitting the read across two windows corrupts the PN532's SPI
 * state machine and the next command comes back garbage.
 *
 * The first 6 bytes are read first to learn LEN, then exactly the right
 * number more, then CS is released on the last real byte.
 *
 * Returns the payload length (0 on a malformed frame).  The payload is
 * TFI followed by DATA, i.e. the byte at out[0] is 0xD5 for a PN532 reply.
 */
static uint16_t pn_read_frame(uint8_t *out, uint16_t maxlen)
{
  uint8_t  buf[PN_BUF];
  uint16_t i;
  uint16_t len;
  uint16_t total;

  PN_CS_LOW();
  delay_ms(PN_CS_SETUP_MS);

  (void)spi_xfer(PN_SPI_DATAREAD);

  for (i = 0U; i < 6U; i++)
  {
    buf[i] = spi_xfer(0x00U);
  }

  if ((buf[0] != 0x00U) || (buf[1] != 0x00U) || (buf[2] != 0xFFU))
  {
    PN_CS_HIGH();
    delay_ms(PN_CS_HOLD_MS);

    /* Print the garbage we actually got.  On the bench this is the most
     * useful line in the whole program: FF FF FF means nothing is driving
     * MISO, 80 40 ... means the link is bit-reversed (LSB-first missing),
     * and 00 00 00 means MISO is stuck low. */
    pn_dump_raw(buf, 6U);

    return 0U;
  }

  len   = (uint16_t)buf[3];
  total = 7U + len;

  if (total > (uint16_t)PN_BUF)
  {
    total = (uint16_t)PN_BUF;          /* paranoia - never happens here */
  }

  for (i = 6U; i < total; i++)
  {
    buf[i] = spi_xfer(0x00U);
  }

  PN_CS_HIGH();
  delay_ms(PN_CS_HOLD_MS);

  if (len > maxlen)
  {
    len = maxlen;
  }

  for (i = 0U; i < len; i++)
  {
    out[i] = buf[5U + i];              /* payload = TFI + DATA */
  }

  return len;
}


/* Dump the raw bytes of a frame we could not parse.  Only on the error path. */
static void pn_dump_raw(const uint8_t *b, uint16_t n)
{
  uint16_t i;

  uart_puts("  raw: ");
  for (i = 0U; i < n; i++)
  {
    uart_put_hex8(b[i]);
    uart_putc(' ');
  }
  uart_puts("\r\n");
}


/* Print what actually came back, and what it means.
 *
 * This exists because "no answer" has four completely different causes that
 * look identical from the outside, and the raw bytes tell them apart:
 *
 *      status byte / ACK bytes            what it means
 *      ---------------------------------  --------------------------------
 *      status bit0 = 0 forever            MISO stuck low - module silent
 *      status = FF, ack = FF FF FF FF FF FF   MISO stuck HIGH, nothing
 *                                         driving it.  This is what a wrong
 *                                         DIP setting looks like, because
 *                                         the module simply never answers.
 *      status = 00, ack = 00 00 00 00 00 00   MISO shorted to GND
 *      real, changing bytes               something IS driving MISO - the
 *                                         link exists, it is just wrong.
 *                                         Bit-reversed (80 instead of 01)
 *                                         means the LSB-first bit is off.
 */
static void pn_diag(uint8_t rc)
{
  uint8_t i;

  uart_puts("      status byte = 0x");
  uart_put_hex8(g_last_status);
  uart_puts("   RDY bit = ");
  uart_puts(((g_last_status & PN_READY_BIT) != 0U) ? "1" : "0");
  uart_puts("\r\n");

  uart_puts("      ack bytes   = ");
  if (g_ack_got != 0U)
  {
    for (i = 0U; i < 6U; i++)
    {
      uart_put_hex8(g_ack_raw[i]);
      uart_putc(' ');
    }
    uart_puts(" (want 00 00 FF 00 FF 00)");
  }
  else
  {
    uart_puts("nothing read - RDY never came up");
  }
  uart_puts("\r\n");

  /* ---- now say what it means ---- */
  if (rc == 1U)
  {
    uart_puts("      -> MISO sits LOW and never goes ready.\r\n");
    uart_puts("         Module unpowered, wrong DIP setting, or MISO not wired.\r\n");
    return;
  }

  if (g_ack_got == 0U)
  {
    uart_puts("      -> frame was ready but came back malformed.\r\n");
    return;
  }

  if (pn_all_same(g_ack_raw, 6U, 0xFFU) != 0U)
  {
    uart_puts("      -> ALL FF: MISO is stuck HIGH and NOTHING is driving it.\r\n");
    uart_puts("         The module is not talking over SPI at all.  In order:\r\n");
    uart_puts("           1. DIP switch is not on SPI   <- most likely by far\r\n");
    uart_puts("           2. MISO and MOSI are swapped\r\n");
    uart_puts("           3. MISO is not actually connected\r\n");
    uart_puts("           4. VCC / GND missing on the module\r\n");
    return;
  }

  if (pn_all_same(g_ack_raw, 6U, 0x00U) != 0U)
  {
    uart_puts("      -> ALL 00: MISO is stuck LOW.  Missing GND, MISO shorted\r\n");
    uart_puts("         to ground, or MISO not connected.\r\n");
    return;
  }

  uart_puts("      -> Real, changing bits are coming back - something IS\r\n");
  uart_puts("         driving MISO.  The link exists, it is just wrong.\r\n");
  uart_puts("         If the values look bit-reversed (80 where 01 is expected,\r\n");
  uart_puts("         40 where 02 is expected) the LSB-first bit is the problem.\r\n");
  uart_puts("         Otherwise swap MISO and MOSI.\r\n");
}


/* ========================================================================== */
/*  PN532 commands                                                            */
/* ========================================================================== */

/* Build a frame, send it, check the ACK, wait for the response.
 *
 * wait_ms is how long to give the RESPONSE, and it is a parameter because the
 * commands differ by three orders of magnitude: GetFirmwareVersion is a
 * lookup, InListPassiveTarget drives the RF field.  The ACK wait is always
 * PN_ACK_TIMEOUT_MS - the PN532's own spec puts that at 15 ms, so anything
 * beyond a second means the module is not there at all.
 *
 * Returns  0  ok, *resplen holds the payload length
 *          1  ACK never arrived (module silent, wrong mode, no power)
 *          2  ACK was there but the frame was malformed
 *          3  ACK arrived, response did not
 */
static uint8_t pn_send(uint8_t cmd, const uint8_t *params, uint8_t nparams,
                       uint32_t wait_ms,
                       uint8_t *resp, uint16_t maxresp, uint16_t *resplen)
{
  uint8_t  frame[32];
  uint8_t  i;
  uint8_t  len;
  uint8_t  sum;
  uint16_t n;

  *resplen = 0U;

  /* ---- build:  00 00 FF LEN LCS D4 cmd params... DCS 00 ---- */
  /* LEN counts TFI, the command byte AND the parameters - all three.  Leaving
   * the command byte out makes LEN one short, and because LCS is derived from
   * LEN the pair still sums to zero and still looks self-consistent, so the
   * frame is not rejected at the checksum.  Instead the PN532 believes the
   * frame ends one byte early, reads the command byte in place of DCS, fails
   * the DCS test and silently drops the whole thing.  The only symptom is
   * that the ready bit never comes up - no error, no ACK, nothing. */
  len = (uint8_t)(2U + nparams);           /* TFI + cmd + parameters */

  frame[0] = 0x00U;
  frame[1] = 0x00U;
  frame[2] = 0xFFU;
  frame[3] = len;
  frame[4] = (uint8_t)(0x100U - (uint16_t)len);       /* LCS = ~LEN + 1 */
  frame[5] = PN_TFI_HOST;
  frame[6] = cmd;

  sum = (uint8_t)(PN_TFI_HOST + cmd);

  for (i = 0U; i < nparams; i++)
  {
    frame[7U + i] = params[i];
    sum = (uint8_t)(sum + params[i]);
  }

  frame[7U + nparams] = (uint8_t)(0x100U - (uint16_t)sum);   /* DCS */
  frame[8U + nparams] = 0x00U;

  n = (uint16_t)(9U + nparams);

  /* ---- send ---- */
  pn_write_frame(frame, n);

  /* ---- the ACK always comes first ---- */
  if (pn_wait_ready(PN_ACK_TIMEOUT_MS) == 0U)
  {
    return 1U;
  }

  if (pn_read_ack() == 0U)
  {
    return 2U;
  }

  /* ---- then the response.  This is the slow one for card commands, so it
   * gets its own, caller-supplied window rather than the ACK's 1 s. ---- */
  if (pn_wait_ready(wait_ms) == 0U)
  {
    return 3U;
  }

  *resplen = pn_read_frame(resp, maxresp);

  /* Two bytes minimum: TFI plus the echoed command.  Without this the
   * resp[1] test below would read a byte that was never written. */
  if (*resplen < 2U)
  {
    return 2U;
  }

  /* Every response starts with 0xD5 then a command byte one higher than the
   * one we sent.  Checking both makes a bit-reversed link obvious at once. */
  if (resp[0] != PN_TFI_PN532)
  {
    return 2U;
  }

  if (resp[1] != (uint8_t)(cmd + 1U))
  {
    return 2U;
  }

  return 0U;
}


/* GetFirmwareVersion.  The answer is IC / version / revision / support, and
 * on a genuine PN532 it is always 32 01 06 07. */
static uint8_t pn_get_firmware(uint8_t *ver4)
{
  uint8_t  resp[PN_BUF];
  uint16_t rlen = 0U;
  uint8_t  rc;
  uint8_t  i;

  rc = pn_send(PN_CMD_GET_FIRMWARE, (const uint8_t *)0, 0U,
               PN_ACK_TIMEOUT_MS, resp, PN_BUF, &rlen);

  if (rc != 0U)
  {
    return rc;
  }

  /* resp = D5 03 IC Ver Rev Support  ->  ver4 gets the last four */
  if (rlen < 6U)
  {
    return 2U;
  }

  for (i = 0U; i < 4U; i++)
  {
    ver4[i] = resp[2U + i];
  }

  return 0U;
}


/* InListPassiveTarget - look for one ISO14443A card in the field.
 *
 * Response payload layout:
 *      [0] D5
 *      [1] 4B              command + 1
 *      [2] NbTg            0 = nothing there, 1 = a card
 *      [3] Tg              target number
 *      [4] [5] SENS_RES
 *      [6] SEL_RES
 *      [7] NFCIDLength     the UID length in bytes
 *      [8..] NFCID         the UID
 *
 * Returns  0 = read ok, *uidlen is 0 when no card is present
 */
static uint8_t pn_read_uid(uint8_t *uid, uint8_t *uidlen)
{
  uint8_t  params[2];
  uint8_t  resp[PN_BUF];
  uint16_t rlen = 0U;
  uint8_t  rc = 3U;
  uint8_t  attempt;
  uint8_t  i;

  *uidlen = 0U;

  params[0] = 0x01U;      /* at most one target                    */
  params[1] = 0x00U;      /* baud rate 106 kbps, type A            */

  /* Retry rather than report.  See PN_POLL_TRIES: the module drops this
   * command about one time in three, and a re-send is all it takes.  The
   * abort between tries puts the PN532's SPI state machine back on a byte
   * boundary before the next frame goes out. */
  for (attempt = 0U; attempt < PN_POLL_TRIES; attempt++)
  {
    rc = pn_send(PN_CMD_INLIST_PASSIVE, params, 2U,
                 PN_POLL_TIMEOUT_MS, resp, PN_BUF, &rlen);

    if (rc == 0U)
    {
      break;
    }

    pn_abort();
    delay_ms(PN_POLL_RETRY_GAP_MS);
  }

  if (rc != 0U)
  {
    return rc;
  }

  if (rlen < 3U)
  {
    return 2U;
  }

  if (resp[2] == 0x00U)   /* NbTg = 0 -> field is empty */
  {
    return 0U;
  }

  if (rlen < 8U)
  {
    return 2U;
  }

  *uidlen = resp[7];

  if (((uint16_t)*uidlen + 8U) > rlen)
  {
    return 2U;
  }

  if (*uidlen > 10U)
  {
    *uidlen = 10U;
  }

  for (i = 0U; i < *uidlen; i++)
  {
    uid[i] = resp[8U + i];
  }

  return 0U;
}


/* ========================================================================== */
/*  main                                                                      */
/* ========================================================================== */

int main(void)
{
  uint8_t  ver[4];
  uint8_t  uid[10];
  uint8_t  uidlen = 0U;
  uint8_t  rc;
  uint8_t  i;
  uint8_t  sam_p[3];
  uint8_t  card_p[2];
  uint32_t t0;
  uint32_t poll_n  = 0UL;
  uint32_t attempt = 0UL;
  int      k;

  ver[0] = 0U; ver[1] = 0U; ver[2] = 0U; ver[3] = 0U;   /* C90 has no array init here */

  sam_p[0]  = 0x01U;   /* SAMConfiguration: normal mode, no SAM card       */
  sam_p[1]  = 0x14U;   /* timeout 20 * 50 ms = 1 s                         */
  sam_p[2]  = 0x01U;   /* raise IRQ - harmless, we poll anyway             */
  card_p[0] = 0x01U;   /* InListPassiveTarget: at most one target          */
  card_p[1] = 0x00U;   /* baud rate 106 kbps, ISO14443A                    */

  systick_init();
  lamps_init();
  spi_init();          /* before the banner, so PA4 stops floating early */
  uart_init();

  /* ---- 3 slow blinks: we are alive ---- */
  for (k = 0; k < (int)BOOT_BLINKS; k++)
  {
    HB_ON();
    delay_ms(BOOT_BLINK_MS);
    HB_OFF();
    delay_ms(BOOT_BLINK_MS);
  }

  uart_puts("\r\n\r\n");
  uart_puts("=====================================================\r\n");
  uart_puts("  S-LAN V4.0   PN532 NFC reader test   (SPI1)\r\n");
  uart_puts("  SS=PA4  SCK=PA5  MISO=PA6  MOSI=PA7   mode 0, LSB first\r\n");

  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    uart_puts("  clock: PLL, 72 MHz - good\r\n");
  }
  else
  {
    uart_puts("  clock: *** NOT PLL *** - the 8 MHz crystal did not\r\n");
    uart_puts("  start, so the SPI clock is wrong.\r\n");
  }

  uart_puts("=====================================================\r\n");

  /* ---- wake the module -------------------------------------------------
   * If it was left in power-down, it only listens again after NSS has been
   * held low for about a millisecond.  Doing it here means the very first
   * command does not get swallowed.
   * -------------------------------------------------------------------- */
  uart_puts("  waking the PN532 ...\r\n");
  PN_CS_LOW();
  delay_ms(PN_WAKE_MS);
  PN_CS_HIGH();
  delay_ms(PN_WAKE_MS);

  /* ---- *** THE TEST *** ------------------------------------------------
   * Retries until the module answers, printing what actually came back on
   * every attempt.  That way you can flip the DIP switch, or re-seat a
   * wire, WHILE IT IS RUNNING and watch the exact moment it starts to
   * work - no reflashing between switch positions.
   * -------------------------------------------------------------------- */
  uart_puts("  GetFirmwareVersion ...\r\n");
  uart_puts("  retrying every second.  You can flip the DIP switch now -\r\n");
  uart_puts("  it will continue by itself the moment the setting is right.\r\n\r\n");

  for (;;)
  {
    if ((g_ms - g_last_hb) >= HEARTBEAT_MS)
    {
      g_last_hb = g_ms;
      GPIOC->ODR ^= (1UL << 13);
    }

    rc = pn_get_firmware(ver);

    if (rc == 0U)
    {
      break;
    }

    attempt++;

    uart_puts("  --- attempt ");
    uart_put_u32(attempt);
    uart_puts(": FAILED, code ");
    uart_put_u32((uint32_t)rc);
    uart_puts("   (1 = no ACK at all, 2 = bad frame, 3 = ACK ok but no reply)\r\n");

    pn_diag(rc);
    uart_puts("\r\n");

    LAMP_ERROR_ON();
    delay_ms(120);
    LAMP_ERROR_OFF();
    delay_ms(880);
  }

  /* ---- only reached once the module answered ---- */
  LAMP_ERROR_OFF();
  LAMP_LINK_ON();

  uart_puts("  *** THE PN532 ANSWERED ***\r\n");
  uart_puts("  PN532 firmware: ");
  uart_put_hex8(ver[0]);
  uart_putc(' ');
  uart_put_hex8(ver[1]);
  uart_putc(' ');
  uart_put_hex8(ver[2]);
  uart_putc(' ');
  uart_put_hex8(ver[3]);
  uart_puts("\r\n");

  if ((ver[0] == 0x32U) && (ver[1] == 0x01U) &&
      (ver[2] == 0x06U) && (ver[3] == 0x07U))
  {
    uart_puts("  -> 32 01 06 07 is a genuine PN532.  THE LINK WORKS.\r\n");
    uart_puts("     SPI wiring, LSB-first, mode 0, power and MISO/MOSI\r\n");
    uart_puts("     are all correct.  Nothing else needs proving.\r\n");
  }
  else
  {
    uart_puts("  -> answered, but NOT the usual 32 01 06 07.\r\n");
    uart_puts("     A clone, or a different firmware.  The link works,\r\n");
    uart_puts("     which is what matters - carry on.\r\n");
  }

  /* ---- command battery --------------------------------------------------
   *
   * The card command failed while the firmware read kept working.  Those two
   * differ in more than one way at once, so this runs the candidates in order
   * and lets ONE flash say which of them is the outlier:
   *
   *   1. GetFirmwareVersion again   does the SECOND command work at all, or
   *                                 only the first one after a wake-up?
   *   2. GetGeneralStatus           an ordinary command, touches no RF
   *   3. SAMConfiguration           sets the mode card commands need
   *   4. InListPassiveTarget        the only one that drives the antenna
   *
   * Read it top down: the first line that says FAILED is the fault.  If all
   * four pass here, the poll loop below will work too. */
  uart_puts("\r\n  --- command battery -------------------------------\r\n");

  (void)pn_probe("GetFirmwareVersion (2nd)", PN_CMD_GET_FIRMWARE,
                 (const uint8_t *)0, 0U, PN_ACK_TIMEOUT_MS);

  (void)pn_probe("GetGeneralStatus        ", PN_CMD_GET_GENERAL_STATUS,
                 (const uint8_t *)0, 0U, PN_ACK_TIMEOUT_MS);

  g_sam_rc = pn_probe("SAMConfiguration        ", PN_CMD_SAMCONFIG,
                      sam_p, 3U, PN_POLL_TIMEOUT_MS);

  (void)pn_probe("InListPassiveTarget     ", PN_CMD_INLIST_PASSIVE,
                 card_p, 2U, PN_POLL_TIMEOUT_MS);

  uart_puts("  --------------------------------------------------\r\n");

  if (g_sam_rc != 0U)
  {
    LAMP_ERROR_ON();
  }

  uart_puts("\r\n-----------------------------------------------------\r\n");
  uart_puts("  polling for a card every 500 ms.\r\n");
  uart_puts("  output: OUT,N,<uid byte count>,<UID hex>\r\n");
  uart_puts("  lamps:  PB14 link   PB15 error   PA11 polling   PA12 card\r\n");
  uart_puts("  put a card on the antenna.  it does NOT have to touch.\r\n");
  uart_puts("-----------------------------------------------------\r\n\r\n");

  t0 = g_ms;

  while (1)
  {
    /* ---- heartbeat ----------------------------------------------------- */
    if ((g_ms - g_last_hb) >= HEARTBEAT_MS)
    {
      g_last_hb = g_ms;
      GPIOC->ODR ^= (1UL << 13);
    }

    if ((g_ms - t0) < PN_POLL_PERIOD_MS)
    {
      continue;
    }

    t0 = g_ms;
    poll_n++;

    LAMP_POLL_ON();

    rc = pn_read_uid(uid, &uidlen);

    LAMP_POLL_OFF();

    if (rc != 0U)
    {
      LAMP_ERROR_ON();
      uart_puts("  poll #");
      uart_put_u32(poll_n);
      uart_puts(": ");

      if (rc == 3U)
      {
        /* Only reachable after PN_POLL_TRIES re-sends have all been dropped,
         * so this is now rare rather than routine.  Note it is NOT the same
         * thing as "no card": a PN532 with an empty field still answers with
         * a real frame, D5 4B 00. */
        uart_puts("no reply to ");
        uart_put_u32((uint32_t)PN_POLL_TRIES);
        uart_puts(" card commands in a row - module is not answering\r\n");
      }
      else
      {
        uart_puts("reader error, code ");
        uart_put_u32((uint32_t)rc);
        uart_puts("\r\n");
      }

      if (poll_n == 1U)
      {
        uart_puts("      SAMConfiguration at boot returned ");
        uart_put_u32((uint32_t)g_sam_rc);
        if (g_sam_rc == 0U)
        {
          uart_puts(" (ok)\r\n");
        }
        else
        {
          uart_puts(" (NON-ZERO - the PN532 may never have entered\r\n");
          uart_puts("       normal mode, and every card command after it fails)\r\n");
        }
      }

      /* First three failures only.  If a real frame is sitting in the
       * buffer now, the reply was merely late and the window is still too
       * short; FF FF or 00 00 means the module really did say nothing. */
      if (poll_n <= 3U)
      {
        pn_late_dump();
        uart_puts("      (00 00 FF ... = a late reply, widen the window;\r\n");
        uart_puts("       FF FF ... or 00 00 ... = the module said nothing)\r\n");
      }

      pn_abort();
      delay_ms(500);
      continue;
    }

    if (uidlen > 0U)
    {
      uint8_t changed = 0U;

      LAMP_CARD_ON();

      if (g_have_card == 0U)
      {
        changed = 1U;
      }
      else if (g_last_uid_len != uidlen)
      {
        changed = 1U;
      }
      else
      {
        for (i = 0U; i < uidlen; i++)
        {
          if (g_last_uid[i] != uid[i])
          {
            changed = 1U;
          }
        }
      }

      if (changed != 0U)
      {
        uart_puts("  card present, UID = ");
        for (i = 0U; i < uidlen; i++)
        {
          uart_put_hex8(uid[i]);
          if (i < (uint8_t)(uidlen - 1U))
          {
            uart_putc(' ');
          }
        }
        uart_puts("\r\n");

        /* ---- the line the PC parses ---- */
        uart_puts("  OUT,N,");
        uart_put_u32((uint32_t)uidlen);
        uart_putc(',');
        for (i = 0U; i < uidlen; i++)
        {
          uart_put_hex8(uid[i]);
        }
        uart_puts("\r\n");

        led_flash(CARD_BLINKS, CARD_BLINK_MS, CARD_BLINK_MS);
      }

      g_have_card    = 1U;
      g_last_uid_len = uidlen;
      for (i = 0U; i < uidlen; i++)
      {
        g_last_uid[i] = uid[i];
      }
    }
    else
    {
      LAMP_CARD_OFF();

      if (g_have_card != 0U)
      {
        uart_puts("  card removed\r\n");
        uart_puts("  OUT,N,0,\r\n");
      }

      g_have_card    = 0U;
      g_last_uid_len = 0U;
    }
  }
}


/* ========================================================================== */
/*  GPIO init                                                                 */
/* ========================================================================== */

/*   GPIOA->CRH bits 12..15  ->  PA11   nibble 0x2
 *   GPIOA->CRH bits 16..19  ->  PA12   nibble 0x2
 *   GPIOB->CRH bits 24..27  ->  PB14   nibble 0x2
 *   GPIOB->CRH bits 28..31  ->  PB15   nibble 0x2
 *   GPIOC->CRH bits 20..23  ->  PC13   nibble 0x2
 *
 * 0b0010 = MODE 10 (output, 2 MHz), CNF 00 (push-pull).
 *
 * CAREFUL: spi_init() owns GPIOA->CRL (PA4..PA7) and uart_init() owns
 * GPIOA->CRH bits 4..11 (PA9 / PA10).  Nothing here may touch those.
 */
static void lamps_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPCEN;

  GPIOA->CRH &= ~(0xFFUL << 12);
  GPIOA->CRH |=  (0x22UL << 12);

  GPIOB->CRH &= ~(0xFFUL << 24);
  GPIOB->CRH |=  (0x22UL << 24);

  GPIOC->CRH &= ~(0xFUL << 20);
  GPIOC->CRH |=  (0x2UL << 20);

  LAMP_LINK_OFF();
  LAMP_ERROR_OFF();
  LAMP_POLL_OFF();
  LAMP_CARD_OFF();
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
/*  Serial:  USART1 on PA9 / PA10, 115200 8N1   (debug print only)            */
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
