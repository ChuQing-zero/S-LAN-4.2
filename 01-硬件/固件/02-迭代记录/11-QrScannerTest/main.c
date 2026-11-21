/* ============================================================================
 *  S-LAN V4.0  --  QR / barcode scanner test  (standalone, no I2C, no servos)
 *                  (bare metal, no HAL, no CubeMX)
 *
 *  MCU   : STM32F103C8  (Blue Pill)
 *  Build : Keil MDK-ARM 5  +  ARM Compiler 5
 *  Date  : 2026-10-06
 *
 *  ---------------------------------------------------------------------------
 *  WHAT IT DOES
 *
 *      Fires the scanner once every 3 seconds and prints exactly what came
 *      back.  The line that matters is the OUT line - that is the one the PC
 *      parses.  The hex and text dump below it is only for eyeballing.
 *
 *          ---- scan #7 ----
 *            TR held low for 187 ms
 *            OUT,Q,53,wxp://f2f6G15Me5gBQzcHQsmR516WHUzX-RA3Q76sLobLxVtkO4Q
 *            len = 53
 *            HEX: 77 78 70 3A 2F 2F 66 32 66 36 47 31 35 4D 65 35
 *                 ...
 *            TXT: wxp://f2f6G15Me5gBQzcHQsmR516WHUzX-RA3Q76sLobLxVtkO4Q
 *            OK
 *
 *  ---------------------------------------------------------------------------
 *  THE OUTPUT PROTOCOL  (this is the contract with the PC side)
 *
 *          OUT,<type>,<len>,<text>\r\n
 *
 *          type   B  = looks like a barcode  (all digits, length 8/12/13/14)
 *                 Q  = anything else          (treat as a QR code)
 *                 E  = no read                (timeout or overflow, len = 0)
 *          len    decimal character count of <text>
 *          text   the decoded characters, verbatim
 *
 *      Examples
 *          OUT,B,13,6921734970039
 *          OUT,Q,53,wxp://f2f6G15Me5gBQzcHQsmR516WHUzX-RA3Q76sLobLxVtkO4Q
 *          OUT,E,0,
 *
 *      WHY THE LENGTH IS THERE: QR text is arbitrary and may contain commas,
 *      quotes or anything else, so splitting on ',' from the left is not
 *      safe.  The PC must read the two commas, take the count, then consume
 *      exactly that many characters.  One OUT line is emitted per scan, even
 *      on failure, so the PC never has to guess or time out.
 *
 *      THE TYPE FIELD IS A GUESS, NOT A MEASUREMENT - see qr_classify().
 *
 *      You can also test it without a PC at all - watch the PC13 LED:
 *          1 blink   barcode        2 blinks  QR        5 blinks  no read
 *
 *  ---------------------------------------------------------------------------
 *  HOW THE TRIGGER WORKS  (measured on the real module, not guessed)
 *
 *      TR is LOW-ACTIVE and it is NOT an edge trigger - it is a GATE.
 *      The module scans for exactly as long as TR is held low.
 *
 *          TR ----+                              +--------------
 *                 |                              |
 *                 +------------------------------+
 *                 |<-- scanning + decoding ----->|
 *                                                ^
 *                                    the reply comes out here,
 *                                    THEN we release TR
 *
 *      So the sequence is:
 *            1. pull TR low        -> module starts scanning
 *            2. WAIT               -> module decodes, then dumps the string
 *            3. receive one frame  -> USART IDLE interrupt says "that was it"
 *            4. pull TR high       -> ONLY NOW.  Releasing early aborts the
 *                                     scan and you get nothing.
 *
 *      Do NOT replace step 2+3 with "delay 20 ms then release" - that was the
 *      first guess and it is wrong.
 *
 *  ---------------------------------------------------------------------------
 *  WIRING
 *
 *      Scanner module          ->   STM32
 *      ------------------------------------------------
 *      TR  (trigger)           ->   PA1   (pin 11)
 *      TXD (module sends)      ->   PA3   (pin 13)  USART2_RX
 *      RXD (module receives)   <-   PA2   (pin 12)  USART2_TX
 *      GND                     ->   GND            <-- MANDATORY
 *      VCC / 3V3               ->   external 3.3V  <-- NOT from the Blue Pill
 *
 *      Serial monitor, three wires, 115200 baud:
 *
 *          CH340 TXD ---> PA10   (USART1_RX)
 *          CH340 RXD ---> PA9    (USART1_TX)
 *          CH340 GND ---> GND
 *
 *      Indicator lamps - same four pins as every other test:
 *
 *          PB14 - lamp 1 - lit while TR is held low   (busy scanning)
 *          PB15 - lamp 2 - lit when a scan TIMED OUT  (nothing found)
 *          PA11 - lamp 3 - lit when a scan SUCCEEDED
 *          PA12 - lamp 4 - blips on the first byte in (data is arriving)
 *          PC13 - onboard LED, heartbeat, flips every 500 ms
 *
 *  ---------------------------------------------------------------------------
 *  BEFORE YOU WIRE PA3, READ THIS
 *
 *      PA0..PA7 are NOT 5 V tolerant.  The scanner's TXD level has not been
 *      measured yet, and if it is a 5 V push-pull output it will inject
 *      current into PA3 through its protection diode.
 *
 *      CHEAP UNIVERSAL FIX - put a 1 kOhm resistor in series:
 *
 *          module TXD ---[ 1k ]---> PA3
 *
 *      That caps the injection current at about 1.4 mA (the limit is 5 mA)
 *      and costs nothing at 9600 baud.  Do this and the level stops mattering.
 *
 *      Alternative: measure TXD-to-GND with a voltmeter while idle.  About
 *      3.3 V means PA3 is safe as-is; about 5 V means you need the 1 kOhm
 *      resistor (or move the scanner to USART1 on PA10, which IS 5 V tolerant).
 *
 *      TR (PA1) is driven push-pull, which is safe either way: the pin always
 *      drives 3.3 V or 0 V and never floats.  If you measure 0 V on TR while
 *      idle, add a 10 kOhm pull-up from TR to 3.3 V, or the module may fire
 *      spuriously while the STM32 is still in reset.
 *
 *  ---------------------------------------------------------------------------
 *  PROJECT SETUP (same as the other bare-metal tests)
 *      1. Project -> Manage -> Run-Time Environment
 *         tick  [x] CMSIS -> CORE
 *         tick  [x] Device -> Startup
 *      2. Keep system_stm32f10x.c in the project.
 *      3. Replace main.c with this file.
 *      4. Options for Target -> Flash Download -> tick "Reset and Run",
 *         and make sure the Programming Algorithm list is NOT empty.
 *      5. Build (F7).  Download (F8).
 *
 *      No MicroLIB needed - integers are printed by hand, printf is not used.
 *
 *  NOTE ON THE STARTUP FILE: this project's startup file is the LOW density
 *  one (startup_stm32f10x_ld.s).  This test runs fine on it because USART1
 *  and USART2 exist in both densities.  But the moment you want SPI2, TIM4,
 *  USART3 or I2C2 you MUST switch the Keil device to STM32F103C8 and use the
 *  medium density startup file - otherwise those peripherals are not declared.
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
 *  The board is an F103C8, so MD is the right answer.  In a normal Keil
 *  project the device selection defines this for you and the block below
 *  never fires.
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

/* ---- Trigger pin ---- */
#define TR_PIN            1U         /* PA1 */

/* ---- Receive buffer ---------------------------------------------------
 *
 *  Measured on the real module:
 *      13 bytes  -  an EAN-13 product barcode  "6921734970039"
 *      53 bytes  -  a WeChat pay QR code       "wxp://f2f6G...O4Q"
 *
 *  256 gives better than 4x headroom over the longest one seen, and the C8
 *  has 20 KB of RAM, so there is no reason to be stingy.  Do not go back to
 *  64 - that leaves only 11 bytes of slack and a longer QR code will silently
 *  truncate.
 * ---------------------------------------------------------------------- */
#define QR_BUF_MAX        256U

/* ---- How long to hold TR low before giving up -------------------------
 *
 *  MEASURED on the real module (2026-10-06, 13 scans):
 *
 *      13 byte EAN-13 barcode    116 / 147 / 148 ms     -> ~150 ms
 *      53 byte QR code           286 ms                 -> ~290 ms
 *      nothing in front of the lens   NEVER answers, no matter how long
 *
 *  Those figures already include the transmission time - 53 bytes at
 *  9600 8N1 is 55 ms of the 286 - so roughly 230 ms is pure decode.
 *
 *  800 ms is 2.8x the worst case observed: enough headroom for a badly lit
 *  or damaged code, while still failing FAST.
 *
 *  The value here used to be 3000 ms, which was a guess made before the
 *  hardware existed.  In the finished machine a missed read would have
 *  stalled the card for three seconds out of a six second budget.
 * ---------------------------------------------------------------------- */
#define QR_TIMEOUT_MS     800U

/* ---- Auto scan period ---- */
#define AUTO_PERIOD_MS    3000U

/* ---- Boot ---- */
#define BOOT_BLINK_MS     300U
#define BOOT_BLINKS       3U

/* ---- Heartbeat ---- */
#define HEARTBEAT_MS      500U

/* ---- Bytes per line when dumping hex ---- */
#define HEX_PER_LINE      16U


/* ========================================================================== */
/*  Pin helpers                                                               */
/* ========================================================================== */

#define LAMP_SCANNING_ON()   (GPIOA->ODR |=  (1UL << 11))   /* PA11 */
#define LAMP_SCANNING_OFF()  (GPIOA->ODR &= ~(1UL << 11))
#define LAMP_TIMEOUT_ON()    (GPIOB->ODR |=  (1UL << 15))   /* PB15 */
#define LAMP_TIMEOUT_OFF()   (GPIOB->ODR &= ~(1UL << 15))
#define LAMP_OK_ON()         (GPIOB->ODR |=  (1UL << 14))   /* PB14 */
#define LAMP_OK_OFF()        (GPIOB->ODR &= ~(1UL << 14))
#define LAMP_RX_ON()         (GPIOA->ODR |=  (1UL << 12))   /* PA12 */
#define LAMP_RX_OFF()        (GPIOA->ODR &= ~(1UL << 12))

#define HB_ON()              (GPIOC->ODR &= ~(1UL << 13))   /* PC13, active LOW */
#define HB_OFF()             (GPIOC->ODR |=  (1UL << 13))

#define TR_LOW()             (GPIOA->BRR  = (1UL << TR_PIN))
#define TR_HIGH()            (GPIOA->BSRR = (1UL << TR_PIN))


/* ========================================================================== */
/*  Globals                                                                   */
/* ========================================================================== */

static volatile uint32_t g_ms = 0UL;

/* Filled by the USART2 interrupt, consumed by the main loop. */
static volatile uint8_t  g_qr[QR_BUF_MAX];
static volatile uint16_t g_qr_len      = 0U;   /* 16 bit: 256 does not fit in 8 */
static volatile uint8_t  g_qr_ready    = 0U;   /* IDLE seen, frame complete     */
static volatile uint8_t  g_qr_overflow = 0U;   /* more bytes than the buffer    */
static volatile uint8_t  g_first_byte  = 0U;   /* lit the RX lamp, cleared by main */

/* UI state, owned by the main loop only. */
static uint8_t g_auto         = 1U;   /* 1 = scan on a timer, 0 = keypress only  */
static uint8_t g_scan_request = 0U;   /* set by the keypress handler, cleared    */

/* Heartbeat bookkeeping.  At file scope rather than a local in main() so
 * that led_flash() can push the next heartbeat out of the way - PC13 is
 * shared between the heartbeat and the result blink code, and the two
 * would otherwise interleave into an unreadable mess. */
static uint32_t g_last_hb = 0UL;


/* ========================================================================== */
/*  Prototypes                                                                */
/* ========================================================================== */

void        SysTick_Handler(void);
void        USART2_IRQHandler(void);

static void lamps_init(void);
static void lamps_all_off(void);
static void scanner_init(void);
static void systick_init(void);
static void delay_ms(uint32_t ms);

static void uart_init(void);
static void uart_putc(char c);
static void uart_puts(const char *s);
static void uart_put_u32(uint32_t v);
static void uart_put_hex8(uint8_t v);
static uint8_t uart_getc_nowait(char *c);

static uint8_t qr_scan_once(uint32_t *waited_ms);
static uint8_t qr_classify(void);
static void    qr_dump(void);
static void    qr_print_out(uint8_t kind);
static void    led_flash(uint8_t n);


/* ========================================================================== */
/*  Interrupt handlers                                                        */
/* ========================================================================== */

void SysTick_Handler(void)
{
  g_ms++;
}


/* One byte in, or end of frame.
 *
 * The module sends a bare string with NO header and NO terminator - 13 bytes
 * for a barcode, 53 for a QR code - so there is no delimiter to look for.
 * The IDLE flag is what makes variable length work: the receiver hardware
 * sets it when the line stays quiet for one whole character time, which is
 * exactly "the burst has finished".
 *
 * WARNING: reading SR then DR is the ONLY way to clear IDLE.  Reading DR
 * alone clears RXNE and leaves IDLE set, and the interrupt then re-enters
 * forever.
 */
void USART2_IRQHandler(void)
{
  if ((USART2->SR & USART_SR_RXNE) != 0UL)
  {
    uint8_t b = (uint8_t)USART2->DR;             /* reading DR clears RXNE */

    if (g_qr_len == 0U)
    {
      g_first_byte = 1U;
    }

    if (g_qr_len < QR_BUF_MAX)
    {
      g_qr[g_qr_len] = b;
      g_qr_len++;
    }
    else
    {
      g_qr_overflow = 1U;
    }
  }

  if ((USART2->SR & USART_SR_IDLE) != 0UL)
  {
    (void)USART2->SR;                            /* clear IDLE: read SR ...  */
    (void)USART2->DR;                            /* ... then read DR         */

    /* The len > 0 guard matters: on the F1 the IDLE flag can already be set
     * when the receiver is switched on with an idle line, and without the
     * guard the first interrupt would declare a zero length frame complete
     * before a single byte ever arrived. */
    if (g_qr_len > 0U)
    {
      g_qr_ready = 1U;
    }
  }
}


/* ========================================================================== */
/*  Triggering one scan                                                       */
/* ========================================================================== */

/* Hold TR low, wait for one complete frame, then release TR.
 *
 * BLOCKING on purpose - this is a bring-up test and a plain wait loop is the
 * easiest thing to reason about.  When this becomes part of the scanner unit
 * it has to be turned into a state machine, because the same wait has to
 * happen while the NFC reader is polled in parallel.
 *
 * Returns  0 = got a frame          (g_qr[0..g_qr_len-1] is valid)
 *          1 = timed out, no reply
 *          2 = reply was longer than QR_BUF_MAX
 */
static uint8_t qr_scan_once(uint32_t *waited_ms)
{
  uint32_t t0;

  g_qr_len      = 0U;
  g_qr_ready    = 0U;
  g_qr_overflow = 0U;
  g_first_byte  = 0U;

  LAMP_OK_OFF();
  LAMP_TIMEOUT_OFF();
  LAMP_RX_OFF();

  LAMP_SCANNING_ON();
  TR_LOW();                                     /* module starts scanning */

  t0 = g_ms;
  while ((g_qr_ready == 0U) && ((g_ms - t0) < QR_TIMEOUT_MS))
  {
  }

  TR_HIGH();                                    /* ONLY NOW - see header */
  LAMP_SCANNING_OFF();

  *waited_ms = g_ms - t0;

  if (g_qr_overflow != 0U)
  {
    return 2U;
  }

  if (g_qr_ready == 0U)
  {
    return 1U;
  }

  return 0U;
}


/* Print the last frame, hex first then text. */
static void qr_dump(void)
{
  uint16_t i;

  uart_puts("  len = ");
  uart_put_u32((uint32_t)g_qr_len);
  uart_puts("\r\n");

  uart_puts("  HEX:");
  for (i = 0U; i < g_qr_len; i++)
  {
    if ((i % HEX_PER_LINE) == 0U)
    {
      uart_puts("\r\n   ");
    }
    uart_putc(' ');
    uart_put_hex8((uint8_t)g_qr[i]);
  }
  uart_puts("\r\n");

  uart_puts("  TXT: ");
  for (i = 0U; i < g_qr_len; i++)
  {
    uint8_t b = (uint8_t)g_qr[i];

    /* Keep it on one line: anything unprintable shows as a dot. */
    if ((b >= 0x20U) && (b <= 0x7EU))
    {
      uart_putc((char)b);
    }
    else
    {
      uart_putc('.');
    }
  }
  uart_puts("\r\n");
}


/* ========================================================================== */
/*  Classifying + reporting                                                   */
/* ========================================================================== */

/* Guess what kind of code this was.
 *
 * HONEST CAVEAT, read this before trusting the type field:
 *
 *      The module sends the decoded TEXT and nothing else - no header, no
 *      type field, no terminator.  A QR code containing "6921734970039" and
 *      an EAN-13 barcode containing "6921734970039" arrive as exactly the
 *      same 13 bytes.  There is NO WAY to tell them apart from the data.
 *
 *      So this is a heuristic, not an identification:
 *
 *          'B'   all digits, length 8 / 12 / 13 / 14   -> "looks like a barcode"
 *          'Q'   anything else                          -> "treat as QR"
 *
 *      It is correct for everything seen so far (EAN-13 barcodes are digits
 *      only; the WeChat QR codes always contain ':' and '/').  Good enough
 *      to drive a demo lamp.  If you ever need the REAL symbology, it has to
 *      come from the module: most of these scanners can be configured to
 *      prepend an AIM identifier (']E0' for EAN-13, ']Q1' for QR).  That
 *      needs the manufacturer's configuration barcode - ask me first.
 * ------------------------------------------------------------------------ */
static uint8_t qr_classify(void)
{
  uint16_t i;

  if ((g_qr_len != 8U)  && (g_qr_len != 12U) &&
      (g_qr_len != 13U) && (g_qr_len != 14U))
  {
    return (uint8_t)'Q';
  }

  for (i = 0U; i < g_qr_len; i++)
  {
    uint8_t b = (uint8_t)g_qr[i];

    if ((b < (uint8_t)'0') || (b > (uint8_t)'9'))
    {
      return (uint8_t)'Q';
    }
  }

  return (uint8_t)'B';
}


/* Print the one line the PC parses:   OUT,<type>,<len>,<text>
 *
 * Non-printable bytes are replaced by '.' so the frame stays on one line and
 * the length field stays honest - a newline inside a QR payload would other-
 * wise break the PC's line based reader.
 */
static void qr_print_out(uint8_t kind)
{
  uint16_t i;

  uart_puts("  OUT,");
  uart_putc((char)kind);
  uart_putc(',');
  uart_put_u32((uint32_t)g_qr_len);
  uart_putc(',');

  for (i = 0U; i < g_qr_len; i++)
  {
    uint8_t b = (uint8_t)g_qr[i];

    if ((b >= 0x20U) && (b <= 0x7EU))
    {
      uart_putc((char)b);
    }
    else
    {
      uart_putc('.');
    }
  }

  uart_puts("\r\n");
}


/* Blink the onboard LED n times, and push the next heartbeat a full period
 * away so the two do not interleave.
 *
 *      1 blink   looks like a barcode
 *      2 blinks  QR code / anything else
 *      5 blinks  no read at all
 *
 * 100 ms on / 100 ms off: 1 = 200 ms, 2 = 400 ms, 5 = 1000 ms.  Keep the
 * failure count odd-ish but the total short - a failed scan already cost the
 * full QR_TIMEOUT_MS, and this runs before the next auto scan is due.
 */
#define LED_FLASH_MS      100U

static void led_flash(uint8_t n)
{
  uint8_t i;

  for (i = 0U; i < n; i++)
  {
    HB_ON();
    delay_ms(LED_FLASH_MS);
    HB_OFF();
    delay_ms(LED_FLASH_MS);
  }

  g_last_hb = g_ms;
}


/* ========================================================================== */
/*  main                                                                      */
/* ========================================================================== */

int main(void)
{
  uint32_t scan_no  = 0UL;
  uint32_t t0;
  char     c;
  int      i;

  lamps_init();
  scanner_init();
  systick_init();
  uart_init();

  /* ---- 3 slow blinks: the program is alive ---------------------------- */
  for (i = 0; i < (int)BOOT_BLINKS; i++)
  {
    HB_ON();
    delay_ms(BOOT_BLINK_MS);
    HB_OFF();
    delay_ms(BOOT_BLINK_MS);
  }

  lamps_all_off();
  delay_ms(300);

  /* ---- Banner ----------------------------------------------------------
   * If you can read this, the serial wiring, the baud rate and the system
   * clock are all correct.
   * -------------------------------------------------------------------- */
  uart_puts("\r\n\r\n");
  uart_puts("=====================================================\r\n");
  uart_puts("  S-LAN V4.0   QR / barcode scanner test\r\n");
  uart_puts("  TR = PA1 (pin 11)   TXD->PA3 (pin 13)   RXD<-PA2 (pin 12)\r\n");
  uart_puts("  TR is a GATE, not an edge: held low for the whole scan.\r\n");

  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    uart_puts("  clock: PLL, 72 MHz - good\r\n");
  }
  else
  {
    uart_puts("  clock: *** NOT PLL *** - the 8 MHz crystal did\r\n");
    uart_puts("  not start, so every baud rate below is wrong.\r\n");
  }

  uart_puts("=====================================================\r\n");
  uart_puts("  lamps: PB14 ok   PB15 timeout   PA11 scanning   PA12 rx\r\n");
  uart_puts("  PC13 blink code:  1 = barcode   2 = QR   5 = no read\r\n");
  uart_puts("  PC output line:   OUT,<B|Q|E>,<len>,<text>\r\n");
  uart_puts("  auto scan every 3 s.  press any key to scan now.\r\n");
  uart_puts("  press 'a' to toggle auto.\r\n");
  uart_puts("-----------------------------------------------------\r\n");

  t0 = g_ms;

  while (1)
  {
    /* ---- heart beat ---------------------------------------------------- */
    if ((g_ms - g_last_hb) >= HEARTBEAT_MS)
    {
      g_last_hb = g_ms;
      GPIOC->ODR ^= (1UL << 13);
    }

    /* ---- a byte arriving lights lamp 4, briefly ------------------------ */
    if (g_first_byte != 0U)
    {
      g_first_byte = 0U;
      LAMP_RX_ON();
    }

    /* ---- serial: any key = scan now, 'a' = toggle auto ----------------- */
    if (uart_getc_nowait(&c) != 0U)
    {
      if ((c == 'a') || (c == 'A'))
      {
        g_auto = (g_auto == 0U) ? 1U : 0U;
        uart_puts(g_auto != 0U ? "  auto: ON\r\n" : "  auto: OFF\r\n");
      }
      else if ((c != '\r') && (c != '\n'))
      {
        g_scan_request = 1U;
      }
    }

    /* ---- time to scan? -------------------------------------------------- */
    if (g_auto != 0U)
    {
      if ((g_ms - t0) < AUTO_PERIOD_MS)      /* auto mode: wait for the timer */
      {
        continue;
      }
    }
    else
    {
      if (g_scan_request == 0U)              /* manual mode: wait for a key   */
      {
        continue;
      }
    }

    g_scan_request = 0U;
    t0 = g_ms;
    scan_no++;

    uart_puts("\r\n---- scan #");
    uart_put_u32(scan_no);
    uart_puts(" ----\r\n");

    {
      uint32_t waited = 0UL;
      uint8_t  rc     = qr_scan_once(&waited);
      uint8_t  kind   = (uint8_t)'E';
      uint8_t  flashes;

      uart_puts("  TR held low for ");
      uart_put_u32(waited);
      uart_puts(" ms\r\n");

      if (rc == 0U)
      {
        kind = qr_classify();          /* 'B' or 'Q' */
        LAMP_OK_ON();

        qr_print_out(kind);            /* <-- the line the PC parses        */
        qr_dump();                     /* <-- for eyeballing only, drop later */
        uart_puts("  OK\r\n");
      }
      else if (rc == 1U)
      {
        LAMP_TIMEOUT_ON();

        /* Still emit an OUT line: one per scan, always, so the PC never has
         * to run its own timeout to notice that nothing was read. */
        g_qr_len = 0U;                 /* nothing was read - stay honest   */
        qr_print_out(kind);            /* kind is 'E', so: OUT,E,0,        */
        uart_puts("  TIMEOUT - no reply.  Check that a code is in front of\r\n");
        uart_puts("  the lens, and that TR / TXD / GND are really connected.\r\n");
      }
      else
      {
        LAMP_TIMEOUT_ON();

        /* On overflow g_qr_len is QR_BUF_MAX - the buffer is full of a
         * truncated frame.  Report it as a clean zero length failure rather
         * than dumping half a code at the PC. */
        g_qr_len = 0U;
        qr_print_out(kind);
        uart_puts("  OVERFLOW - the reply did not fit.  Raise QR_BUF_MAX.\r\n");
      }

      LAMP_RX_OFF();

      /* ---- blink code, readable with no PC attached ---------------------- */
      if (kind == (uint8_t)'B')
      {
        flashes = 1U;
      }
      else if (kind == (uint8_t)'Q')
      {
        flashes = 2U;
      }
      else
      {
        flashes = 5U;
      }

      led_flash(flashes);
    }

    /* Leave the result lamps on long enough to see without the serial port. */
    delay_ms(400);
    LAMP_OK_OFF();
    LAMP_TIMEOUT_OFF();
  }
}


/* ========================================================================== */
/*  GPIO init                                                                 */
/* ========================================================================== */

/* Four lamps + the onboard LED.  Same pins as every other test in this tree.
 *
 *   GPIOA->CRH bits 12..15  ->  PA11   nibble 0x2
 *   GPIOA->CRH bits 16..19  ->  PA12   nibble 0x2
 *   GPIOB->CRH bits 24..27  ->  PB14   nibble 0x2
 *   GPIOB->CRH bits 28..31  ->  PB15   nibble 0x2
 *   GPIOC->CRH bits 20..23  ->  PC13   nibble 0x2
 *
 * 0b0010 = MODE 10 (output, 2 MHz), CNF 00 (push-pull).
 *
 * CAREFUL: uart_init() owns GPIOA->CRH bits 4..11 (PA9 / PA10) and
 * scanner_init() owns GPIOA->CRL, so nothing here may touch those.
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

  lamps_all_off();
  HB_OFF();
}


static void lamps_all_off(void)
{
  LAMP_SCANNING_OFF();
  LAMP_TIMEOUT_OFF();
  LAMP_OK_OFF();
  LAMP_RX_OFF();
}


/* ========================================================================== */
/*  Scanner:  TR on PA1, USART2 on PA2 / PA3, 9600 8N1                         */
/* ========================================================================== */

/* PA1 -> GPIOA->CRL bits  4..7    0x2 = MODE 10 (2 MHz), CNF 00 (push-pull)
 * PA2 -> GPIOA->CRL bits  8..11   0xB = MODE 11 (50 MHz), CNF 10 (AF PP)
 * PA3 -> GPIOA->CRL bits 12..15   0x8 = MODE 00 (input), CNF 10 (pull-up/down)
 *
 * PA1 is a plain push-pull output on purpose.  It must never float: TR is
 * low-active, so a floating pin can fire the module while the STM32 is still
 * in reset and you get a burst of garbage before main() even starts.
 */
static void scanner_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB1ENR |= RCC_APB1ENR_USART2EN;

  GPIOA->CRL &= ~((0xFUL << 4) | (0xFUL << 8) | (0xFUL << 12));
  GPIOA->CRL |=  ((0x2UL << 4) | (0xBUL << 8) | (0x8UL << 12));

  /* Park TR high BEFORE anything else, so the module is quiet. */
  TR_HIGH();

  /* PCLK1 is 36 MHz and the module talks at 9600:
   *     USARTDIV = 36000000 / (16 * 9600) = 234.375
   *     mantissa = 234 = 0xEA, fraction = 0.375 * 16 = 6
   *     BRR = (0xEA << 4) | 6 = 0xEA6      -> exact, zero error
   *
   * (If you ever move the scanner to USART1 on PCLK2 = 72 MHz, the same
   *  baud rate is BRR = 0x1D4C.)
   */
  USART2->BRR = 0xEA6UL;

  USART2->CR1 = USART_CR1_RE          /* receiver on                       */
              | USART_CR1_RXNEIE      /* interrupt per received byte       */
              | USART_CR1_IDLEIE      /* interrupt when the line goes idle */
              | USART_CR1_UE;         /* USART enabled                     */

  NVIC_SetPriority(USART2_IRQn, 2U);
  NVIC_EnableIRQ(USART2_IRQn);
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

  /* PCLK2 is 72 MHz and we want 115200 baud:
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


/* Non-blocking read.  Returns 1 and stores the byte when one is waiting. */
static uint8_t uart_getc_nowait(char *c)
{
  if ((USART1->SR & USART_SR_RXNE) == 0UL)
  {
    return 0U;
  }

  *c = (char)(uint8_t)USART1->DR;
  return 1U;
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
