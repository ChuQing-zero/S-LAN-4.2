/* ============================================================================
 *  36 · PN532 NFC 独立测试（不用 I2C、不用 Nano）
 * ----------------------------------------------------------------------------
 *  上电后每 2 秒试着读一次 IC 卡 UID，串口打印结果。
 *
 *  串口 PA9/PA10 115200
 *  接线：PA4=CS  PA5=SCK  PA6=MISO  PA7=MOSI  PN532 必须 3.3V 供电
 *
 *  指示灯：PC13 心跳 / PB14 读到卡 / PB15 没读到
 *
 *  PN532 驱动从 12-Pn532SpiTest 原样移植（那份已验证）
 * ========================================================================== */

#include "stm32f10x.h"

/* ---------------------------------------------------------------- 延时 */
static void delay_ms(uint32_t ms)
{
  volatile uint32_t n;
  while (ms--)
  {
    for (n = 0; n < 7200U; n++) { __asm volatile ("nop"); }
  }
}

/* ---------------------------------------------------------------- 灯 */
static void led_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPCEN;
  GPIOB->CRH &= ~(0xFFUL << 24);
  GPIOB->CRH |=  (0x22UL << 24);
  GPIOC->CRH &= ~(0xFUL << 20);
  GPIOC->CRH |=  (0x2UL << 20);
  GPIOC->ODR |= (1UL << 13);
}

/* ---------------------------------------------------------------- 串口1 */
static void uart1_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_USART1EN;
  RCC->APB2ENR |= RCC_APB2ENR_AFIOEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  GPIOA->CRH &= ~(0xFFUL << 4);
  GPIOA->CRH |=  (0xBUL << 4);
  GPIOA->CRH |=  (0x4UL << 8);
  USART1->BRR = 0x271U;
  USART1->CR1 = USART_CR1_UE | USART_CR1_TE | USART_CR1_RE;
}

static void uart_putc(char c)
{
  while ((USART1->SR & USART_SR_TXE) == 0U) { ; }
  USART1->DR = (uint16_t)(uint8_t)c;
}

static void uart_puts(const char *s)
{
  while (*s) { uart_putc(*s++); }
}

static void uart_put_hex8(uint8_t v)
{
  uart_putc(k_hex[(v >> 4) & 0x0FU]);
  uart_putc(k_hex[v & 0x0FU]);
}


/* ================================================================ PN532 */
#define PN_SPI_DATAWRITE  0x01U

#define PN_SPI_STATREAD   0x02U

#define PN_SPI_DATAREAD   0x03U

#define PN_READY_BIT      0x01U      /* status byte bit 0 = 1 -> frame waiting */

#define PN_TFI_HOST       0xD4U      /* host -> PN532 */

#define PN_TFI_PN532      0xD5U      /* PN532 -> host */

#define PN_ACK_0          0x00U      /* the ACK is a fixed 6 byte literal,  */

#define PN_ACK_1          0x00U      /* NOT a normal length-checksummed      */

#define PN_ACK_2          0xFFU      /* frame.  Counting it with the normal  */

#define PN_ACK_3          0x00U      /* formula gives 07 bytes, one too many,*/

#define PN_ACK_4          0xFFU      /* and the extra byte eats the start of */

#define PN_ACK_5          0x00U      /* the response.  Read exactly 6.       */

#define PN_CMD_GET_FIRMWARE      0x02U

#define PN_CMD_GET_GENERAL_STATUS 0x04U   /* battery only - not used in anger  */

#define PN_CMD_SAMCONFIG         0x14U

#define PN_CMD_INLIST_PASSIVE    0x4AU

#define PN_CS_SETUP_MS      1U       /* SS low  -> first clock edge          */

#define PN_CS_HOLD_MS       1U       /* SS high -> next transaction          */

#define PN_WAKE_MS          5U       /* SS low at boot, to leave power down  */

#define PN_ACK_TIMEOUT_MS   1000U    /* manual: ACK within 15 ms, be generous*/

#define PN_POLL_TIMEOUT_MS  3000U    /* InListPassiveTarget reply window     */

#define PN_POLL_PERIOD_MS   500U     /* how often to look for a card         */

#define PN_POLL_TRIES       3U       /* re-sends before believing a miss     */

#define PN_POLL_RETRY_GAP_MS 20U     /* let the RF state machine settle      */

#define PN_BUF              64U      /* biggest frame here is 22 bytes       */

#define PN_CS_LOW()          (GPIOA->BRR  = (1UL << 4))     /* PA4, active low */

#define PN_CS_HIGH()         (GPIOA->BSRR = (1UL << 4))


static uint8_t g_last_status = 0U;
static uint8_t g_ack_raw[6];
static uint8_t g_ack_got     = 0U;

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


static void pn_abort(void)
{
  PN_CS_LOW();
  delay_ms(PN_CS_SETUP_MS);
  PN_CS_HIGH();
  delay_ms(PN_CS_HOLD_MS);
}


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


/* ================================================================ main */
int main(void)
{
  uint8_t uid[10];
  uint8_t ulen;
  uint8_t i;
  uint8_t hb = 0;

  led_init();
  uart1_init();

  uart_puts("\r\n\r\n");
  uart_puts("=====================================================\r\n");
  uart_puts("  36-NFC-TEST   PN532 on SPI1 (PA4-PA7)\r\n");
  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    uart_puts("  clock: PLL 72MHz OK\r\n");
  }
  else
  {
    uart_puts("  clock: *** NOT PLL ***\r\n");
  }
  uart_puts("=====================================================\r\n\r\n");

  spi_init();

  while (1)
  {
    hb ^= 1U;
    if (hb) GPIOC->ODR &= ~(1UL << 13); else GPIOC->ODR |= (1UL << 13);

    ulen = 0;
    if (pn_read_uid(uid, &ulen) == 0U && ulen > 0U)
    {
      GPIOB->ODR |=  (1UL << 14);
      uart_puts("UID len = ");
      uart_putc((char)('0' + ulen));
      uart_puts("   HEX:");
      for (i = 0; i < ulen; i++)
      {
        uart_putc(' ');
        uart_put_hex8(uid[i]);
      }
      uart_puts("\r\n");
      delay_ms(300);
      GPIOB->ODR &= ~(1UL << 14);
    }
    else
    {
      GPIOB->ODR |= (1UL << 15);
      uart_puts("no card\r\n");
      delay_ms(300);
      GPIOB->ODR &= ~(1UL << 15);
    }

    delay_ms(1700);
  }
}
