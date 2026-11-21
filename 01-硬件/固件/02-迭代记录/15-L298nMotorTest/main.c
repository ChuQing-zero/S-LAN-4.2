/* ============================================================================
 *  S-LAN V4.0  --  L298N belt motor bring-up test   (TIM3 CH3 PWM, bare metal)
 *                  no HAL, no CubeMX, no library
 *
 *  MCU   : STM32F103C8  (Blue Pill)  --  this is the 识别单元 board
 *  Build : Keil MDK-ARM 5  +  ARM Compiler 5
 *  Date  : 2026-10-06
 *
 *  ---------------------------------------------------------------------------
 *  WHY THIS RUNS ON THE STM32 AND NOT ON THE MEGA
 *
 *      The final machine drives the belt from the Arduino Mega (D2 / D3 + D4).
 *      This program exists only to prove the L298N module, the motor and the
 *      minimum usable speed - none of which depends on which MCU sends the
 *      PWM.  The numbers you write down here carry straight over to the Mega
 *      sketch.  Only the pin names change.
 *
 *  ---------------------------------------------------------------------------
 *  WIRING
 *
 *      L298N              ->   STM32 (识别单元 board)
 *      ----------------------------------------------------
 *      ENA                ->   PB0   (TIM3_CH3, hardware PWM)
 *      IN1                ->   PB1
 *      IN2                ->   PB10
 *      GND                ->   GND      *** THIS WIRE IS NOT OPTIONAL ***
 *      OUT1 / OUT2        ->   the motor, either way round
 *      12V terminal       ->   battery / supply +
 *      GND terminal       ->   battery / supply -
 *
 *      Serial monitor, three wires, 115200 baud:
 *
 *          CH340 TXD ---> PA10   (USART1_RX)
 *          CH340 RXD ---> PA9    (USART1_TX)
 *          CH340 GND ---> GND
 *
 *      WHY THE PINS ARE WHAT THEY ARE
 *
 *      The belt motor stays on the identification unit permanently - the belt
 *      runs continuously and never stops, so whichever board turns it on is
 *      irrelevant, and this one is where the wires already are.  These pins
 *      are therefore shared with the rest of that board:
 *
 *          PB0    ENA   motor PWM
 *          PB1    IN1   motor direction
 *          PB10   IN2   motor direction
 *          PA0          photoresistor,      ADC1_IN0
 *          PB11         baffle servo,       TIM2_CH4
 *
 *      PB0 / PB1 / PB10 sit inside the pins-10-to-22 run that carries the
 *      whole front end (light sensor, QR scanner, PN532, motor, servo) and
 *      they match the final PCB exactly - see electronics/04-识别单元方案.md -
 *      so what gets wired on the bench is what the finished board will be.
 *
 *      The rest of the board, so nothing here collides: the PN532 owns
 *      PA4..PA7, the QR scanner owns PA1..PA3, the console owns PA9/PA10,
 *      the lamps own PA11/PA12/PB14/PB15, the heartbeat owns PC13, and
 *      PA13/PA14 are the SWD pins.
 *
 *      NOTE ON PB2 - it is NOT on the header.  PB2 is BOOT1, the pin with the
 *      board's own 10 k pulldown, and the Blue Pill simply does not route it
 *      out.  Every second pinout drawing on the internet shows it anyway.
 *      If you need a fourth direction pin later, PB11 is the next one along.
 *
 *  ===========================================================================
 *  THE FOUR TRAPS, IN THE ORDER PEOPLE HIT THEM
 *
 *   1. NO COMMON GROUND.
 *      The L298N's GND and the STM32's GND must be joined.  Without it the
 *      control inputs have no reference and you get motor-randomly-spins /
 *      motor-does-nothing / motor-twitches-then-stops - all of which look
 *      exactly like a dead module.  Check this first, always.
 *
 *   2. THE ENA JUMPER IS STILL IN PLACE.
 *      Every L298N board ships with a jumper capping ENA to +5V.  While it is
 *      there ENA is hard-wired high and PWM does nothing at all: the motor
 *      runs at 100% from the moment IN1/IN2 differ, no matter what the
 *      firmware asks for.  PULL IT OFF.  (Leave ENB alone if you are only
 *      driving one motor.)
 *
 *   3. THE ONBOARD 5V REGULATOR JUMPER.
 *        VS <= 12 V  ->  leave the jumper on, the module makes its own 5V
 *        VS  > 12 V  ->  PULL IT OFF and feed the 5V terminal from an external
 *                        5V supply, or you cook the onboard regulator
 *
 *   4. THE L298N DROPS 1.8 - 2 V INSIDE ITSELF.
 *      Feed it 12 V and the motor only ever sees about 10 V.  If the belt
 *      feels weak, put a meter across OUT1/OUT2 and measure - do not blame
 *      the motor before you have that number.
 *
 *  ---------------------------------------------------------------------------
 *  WHAT TO WRITE DOWN  (this is the actual point of the exercise)
 *
 *      1. does it turn, and is the direction what you expect
 *      2. does speed rise smoothly from 0 to 255, or are there dead zones
 *      3. *** the lowest PWM value at which it turns steadily ***
 *
 *      Number 3 is the one that matters later.  The belt runs continuously,
 *      and below that value the motor stalls instead of turning - stalled it
 *      draws full current and heats up with nothing moving.
 *
 *  ---------------------------------------------------------------------------
 *  USAGE   (serial monitor, 115200 8N1, sends no line ending by default)
 *
 *      0 .. 255   set the PWM speed (takes effect immediately while running)
 *      f          forward          b   reverse
 *      s          coast stop       x   brake
 *      +  /  -    speed +-10
 *      t          automatic test sequence
 *      p          print status     h or ?  this list
 *
 *      A number is acted on as soon as you stop typing for 300 ms, so you do
 *      not need to press enter.
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

/* ---- PWM ----------------------------------------------------------------
 * TIM3 sits on APB1.  APB1 is clocked at 36 MHz but because its prescaler is
 * not 1 the timer itself still runs at 72 MHz.  72 MHz / 72 = 1 MHz counter,
 * 1000 counts = 1 kHz PWM - the same ballpark as the Arduino's own analogWrite
 * at 980 Hz, which keeps the two platforms comparable.
 */
#define PWM_PSC           71U      /* prescaler: 72 MHz -> 1 MHz counter       */
#define PWM_ARR           1000U    /* 1000 counts -> 1 kHz, and a clean 0..255 */

#define SPEED_MIN         0
#define SPEED_MAX         255
#define SPEED_START       150      /* boot speed.  does NOT start the motor.   */
#define SPEED_STEP        10

/* A bare number is committed once you stop typing, so "150" does not fire
 * three separate commands as 1, 15, 150. */
#define NUM_TIMEOUT_MS    300U

#define HEARTBEAT_MS      500U
#define BOOT_BLINK_MS     150U
#define BOOT_BLINKS       3U


/* ========================================================================== */
/*  Pin macros                                                                */
/* ========================================================================== */

/* ENA lives on PB0 = TIM3_CH3 and is driven by the timer, not by GPIO.       */

#define IN1_HIGH()           (GPIOB->BSRR = (1UL << 1))   /* PB1  */
#define IN1_LOW()            (GPIOB->BRR  = (1UL << 1))
#define IN2_HIGH()           (GPIOB->BSRR = (1UL << 10))  /* PB10 */
#define IN2_LOW()            (GPIOB->BRR  = (1UL << 10))

#define HB_ON()              (GPIOC->ODR &= ~(1UL << 13)) /* PC13, active LOW */
#define HB_OFF()             (GPIOC->ODR |=  (1UL << 13))


/* ========================================================================== */
/*  State                                                                     */
/* ========================================================================== */

#define ST_STOP   0U      /* both inputs low  - coasts to a halt              */
#define ST_FWD    1U
#define ST_REV    2U
#define ST_BRAKE  3U      /* both inputs high - terminals shorted, stops fast */

static volatile uint32_t g_ms = 0UL;

static uint8_t  g_state       = ST_STOP;
static int      g_speed       = SPEED_START;

static char     g_buf[4];       /* a speed is at most 3 digits ("255")       */
static uint8_t  g_buf_len     = 0U;
static uint32_t g_last_digit  = 0UL;

static uint32_t g_last_hb     = 0UL;
static uint8_t  g_hb_on       = 0U;


/* ========================================================================== */
/*  Prototypes                                                                */
/* ========================================================================== */

void SysTick_Handler(void);

static void   systick_init(void);
static void   delay_ms(uint32_t ms);
static void   delay_ms_hb(uint32_t ms);

static void   uart_init(void);
static void   uart_putc(char c);
static void   uart_puts(const char *s);
static void   uart_put_u32(uint32_t v);
static uint8_t uart_rx_ready(void);
static char   uart_getc(void);

static void   motor_init(void);
static uint16_t speed_to_ccr(int speed);
static void   motor_forward(void);
static void   motor_reverse(void);
static void   motor_coast(void);
static void   motor_brake(void);
static void   set_speed(int v);

static void   print_status(void);
static void   print_help(void);
static void   auto_test(void);
static void   handle_letter(char c);
static void   flush_number(void);

static uint8_t is_digit(char c);
static uint8_t is_sep(char c);
static char    to_lower(char c);


/* ========================================================================== */
/*  Time:  1 ms SysTick                                                       */
/* ========================================================================== */

static void systick_init(void)
{
  SysTick->LOAD = 72000UL - 1UL;                 /* 1 ms at 72 MHz */
  SysTick->VAL  = 0UL;
  SysTick->CTRL = SysTick_CTRL_CLKSOURCE_Msk
                | SysTick_CTRL_TICKINT_Msk
                | SysTick_CTRL_ENABLE_Msk;
}


void SysTick_Handler(void)
{
  g_ms++;
}


static void delay_ms(uint32_t ms)
{
  uint32_t start = g_ms;

  while ((g_ms - start) < ms)
  {
  }
}


/* Same wait, but it keeps the heartbeat blinking.  The automatic test spends
 * twelve seconds inside delays; without this the board would look dead for
 * the whole run. */
static void delay_ms_hb(uint32_t ms)
{
  uint32_t start = g_ms;
  uint32_t edge  = g_ms;

  while ((g_ms - start) < ms)
  {
    if ((g_ms - edge) >= 250U)
    {
      edge += 250U;

      if (g_hb_on == 0U) { HB_ON();  g_hb_on = 1U; }
      else               { HB_OFF(); g_hb_on = 0U; }
    }
  }

  g_last_hb = g_ms;
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


static uint8_t uart_rx_ready(void)
{
  return (uint8_t)((USART1->SR & USART_SR_RXNE) != 0UL ? 1U : 0U);
}


/* Reading DR clears RXNE.  It also clears ORE / NE / FE / PE, so a burst of
 * noise on the line cannot wedge the receiver. */
static char uart_getc(void)
{
  return (char)(USART1->DR & 0xFFUL);
}


/* ========================================================================== */
/*  Motor:  PB0 = TIM3_CH3 PWM,  PB1 / PB10 = direction                       */
/* ========================================================================== */

/* PB0  -> GPIOB->CRL bits 0..3     0xB = MODE 11 (50 MHz), CNF 10 (AF PP)
 * PB1  -> GPIOB->CRL bits 4..7     0x2 = MODE 10 (2 MHz),  CNF 00 (PP out)
 * PB10 -> GPIOB->CRH bits 8..11    0x2 = MODE 10 (2 MHz),  CNF 00 (PP out)
 * PC13 -> GPIOC->CRH bits 20..23   0x2 = MODE 10 (2 MHz),  CNF 00 (PP out)
 *
 * Watch the register split: PB0..PB7 are configured in CRL, PB8..PB15 in CRH.
 * PB1 is in CRL and PB10 is in CRH, which is why the two lines below do not
 * look alike.
 *
 * 2 MHz is plenty for a direction line: it changes a handful of times per
 * second and the slower slew keeps the switching noise out of the analogue
 * side of the board.
 */
static void motor_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPCEN;
  RCC->APB1ENR |= RCC_APB1ENR_TIM3EN;

  GPIOB->CRL &= ~((0xFUL << 0) | (0xFUL << 4));
  GPIOB->CRL |=  ((0xBUL << 0) | (0x2UL << 4));

  GPIOB->CRH &= ~(0xFUL << 8);
  GPIOB->CRH |=  (0x2UL << 8);

  GPIOC->CRH &= ~(0xFUL << 20);
  GPIOC->CRH |=  (0x2UL << 20);

  /* Both direction pins low = coast, so the motor does not lurch the instant
   * the firmware starts running. */
  IN1_LOW();
  IN2_LOW();

  TIM3->PSC   = PWM_PSC;
  TIM3->ARR   = PWM_ARR - 1UL;
  TIM3->CCR3  = 0UL;

  /* Channel 3 lives in CCMR2: OC3M[2:0] = bits 6..4, OC3PE = bit 3.
   * OC3M = 110 is PWM mode 1 - active while CNT < CCR3. */
  TIM3->CCMR2 = (0x6UL << 4) | (0x1UL << 3);

  /* CCER: CC3E = bit 8 (enable output), CC3P = bit 9 (0 = active high) */
  TIM3->CCER  = (0x1UL << 8);

  TIM3->EGR   = 0x1UL;              /* UG: latch PSC/ARR before the first run */
  TIM3->CR1   = TIM_CR1_ARPE | TIM_CR1_CEN;
}


/* 0 -> 0 counts (never on),  255 -> 1000 counts (always on, CCR > ARR). */
static uint16_t speed_to_ccr(int speed)
{
  if (speed < SPEED_MIN) { speed = SPEED_MIN; }
  if (speed > SPEED_MAX) { speed = SPEED_MAX; }

  return (uint16_t)(((uint32_t)speed * PWM_ARR) / 255UL);
}


static void motor_forward(void)
{
  TIM3->CCR3 = speed_to_ccr(g_speed);
  IN1_HIGH();
  IN2_LOW();
  g_state = ST_FWD;
}


static void motor_reverse(void)
{
  TIM3->CCR3 = speed_to_ccr(g_speed);
  IN1_LOW();
  IN2_HIGH();
  g_state = ST_REV;
}


/* Coast: both inputs low, PWM to zero.  The bridge lets go and the belt runs
 * on under its own inertia. */
static void motor_coast(void)
{
  IN1_LOW();
  IN2_LOW();
  TIM3->CCR3 = 0UL;
  g_state = ST_STOP;
}


/* Brake: both inputs high shorts the motor through the bridge, so it stops
 * far quicker than coasting.  Do not hold it there for minutes - the bridge
 * carries the short-circuit current the whole time. */
static void motor_brake(void)
{
  IN1_HIGH();
  IN2_HIGH();
  TIM3->CCR3 = PWM_ARR;
  g_state = ST_BRAKE;
}


static void set_speed(int v)
{
  if (v < SPEED_MIN) { v = SPEED_MIN; }
  if (v > SPEED_MAX) { v = SPEED_MAX; }

  g_speed = v;

  uart_puts(">> speed ");
  uart_put_u32((uint32_t)g_speed);
  uart_puts("  (");
  uart_put_u32((uint32_t)((g_speed * 100L) / 255L));
  uart_puts("%)\r\n");

  /* live change while running */
  if (g_state == ST_FWD)      { motor_forward(); }
  else if (g_state == ST_REV) { motor_reverse(); }
}


/* ========================================================================== */
/*  Small character helpers  (avoid pulling in <ctype.h> for three functions) */
/* ========================================================================== */

static uint8_t is_digit(char c)
{
  return (uint8_t)((c >= '0') && (c <= '9') ? 1U : 0U);
}

static uint8_t is_sep(char c)
{
  return (uint8_t)((c == '\n') || (c == '\r') || (c == ' ')
                || (c == '\t') || (c == ',') ? 1U : 0U);
}

static char to_lower(char c)
{
  if ((c >= 'A') && (c <= 'Z'))
  {
    return (char)(c + 32);
  }

  return c;
}


/* ========================================================================== */
/*  Input handling                                                            */
/* ========================================================================== */

static void flush_number(void)
{
  int     v = 0;
  uint8_t i;

  if (g_buf_len == 0U)
  {
    return;
  }

  for (i = 0U; i < g_buf_len; i++)
  {
    v = (v * 10) + (int)(g_buf[i] - '0');
  }

  g_buf_len = 0U;

  if ((v < SPEED_MIN) || (v > SPEED_MAX))
  {
    uart_puts("!! speed must be 0..255, ignored\r\n");
    return;
  }

  set_speed(v);
}


static void handle_letter(char c)
{
  switch (c)
  {
    case 'f':
      motor_forward();
      uart_puts(">> forward\r\n");
      break;

    case 'b':
      motor_reverse();
      uart_puts(">> reverse\r\n");
      break;

    case 's':
      motor_coast();
      uart_puts(">> stop (coast - the belt rolls on a little)\r\n");
      break;

    case 'x':
      motor_brake();
      uart_puts(">> brake (terminals shorted, stops fast)\r\n");
      break;

    case '+':
      set_speed(g_speed + SPEED_STEP);
      break;

    case '-':
      set_speed(g_speed - SPEED_STEP);
      break;

    case 't':
      auto_test();
      break;

    case 'p':
      print_status();
      break;

    case 'h':
    case '?':
      print_help();
      break;

    default:
      uart_puts("!! unknown command: ");
      uart_putc(c);
      uart_puts("\r\n   send h for the list\r\n");
      break;
  }
}


/* ========================================================================== */
/*  Printing                                                                  */
/* ========================================================================== */

static void print_status(void)
{
  uart_puts("state: ");

  switch (g_state)
  {
    case ST_FWD:   uart_puts("forward"); break;
    case ST_REV:   uart_puts("reverse"); break;
    case ST_BRAKE: uart_puts("brake  "); break;
    default:       uart_puts("stopped"); break;
  }

  uart_puts("   speed: ");
  uart_put_u32((uint32_t)g_speed);
  uart_puts("  (");
  uart_put_u32((uint32_t)((g_speed * 100L) / 255L));
  uart_puts("%)\r\n");
}


static void print_help(void)
{
  uart_puts("\r\n---------------- command list ----------------\r\n");
  uart_puts("  0 .. 255   set PWM speed (enter not required)\r\n");
  uart_puts("  f          forward\r\n");
  uart_puts("  b          reverse\r\n");
  uart_puts("  s          stop (coast)\r\n");
  uart_puts("  x          brake (fast stop)\r\n");
  uart_puts("  +  /  -    speed +10 / -10\r\n");
  uart_puts("  t          automatic test sequence\r\n");
  uart_puts("  p          print status\r\n");
  uart_puts("  h  or  ?   this list\r\n");
  uart_puts("----------------------------------------------\r\n");
  uart_puts("  pins: ENA=PB0  IN1=PB1  IN2=PB10  GND=common\r\n");
  uart_puts("  the ENA jumper on the L298N must be removed\r\n");
  uart_puts("  or PWM does nothing at all\r\n\r\n");
}


static void auto_test(void)
{
  /* Step list for the ramp.  Values chosen so the printed percentages are
   * round: 25 / 50 / 75 / 100 %. */
  static const int steps[4] = { 64, 128, 191, 255 };
  uint8_t i;

  uart_puts(">> automatic test starts\r\n");

  uart_puts("   forward 2 s   - watch which way the belt goes\r\n");
  motor_forward();
  delay_ms_hb(2000U);

  uart_puts("   stop 1 s\r\n");
  motor_coast();
  delay_ms_hb(1000U);

  uart_puts("   reverse 2 s   - should be the other way\r\n");
  motor_reverse();
  delay_ms_hb(2000U);

  uart_puts("   brake 1 s\r\n");
  motor_brake();
  delay_ms_hb(1000U);

  uart_puts("   ramp 25 / 50 / 75 / 100 %, 1.5 s each\r\n");
  uart_puts("   *** note the first step that turns steadily ***\r\n");

  for (i = 0U; i < 4U; i++)
  {
    g_speed = steps[i];

    uart_puts("     speed ");
    uart_put_u32((uint32_t)g_speed);
    uart_puts("  (");
    uart_put_u32((uint32_t)((g_speed * 100L) / 255L));
    uart_puts("%)\r\n");

    motor_forward();
    delay_ms_hb(1500U);
  }

  uart_puts("   stop\r\n");
  motor_coast();

  uart_puts(">> automatic test finished, motor is stopped\r\n");
  uart_puts("   write down: direction ok?  lowest steady speed?  OUT1-OUT2 volts?\r\n");
}


/* ========================================================================== */
/*  Main                                                                      */
/* ========================================================================== */

int main(void)
{
  char    c;
  uint8_t i;

  systick_init();
  uart_init();
  motor_init();                 /* leaves the motor coasting */
  motor_coast();

  HB_OFF();

  for (i = 0U; i < BOOT_BLINKS; i++)
  {
    HB_ON();
    delay_ms(BOOT_BLINK_MS);
    HB_OFF();
    delay_ms(BOOT_BLINK_MS);
  }

  uart_puts("\r\n");
  uart_puts("==========================================\r\n");
  uart_puts("   S-LAN V4.0   L298N belt motor test\r\n");
  uart_puts("   STM32F103C8 / TIM3_CH3 PWM, 1 kHz\r\n");
  uart_puts("==========================================\r\n");
  uart_puts("   ENA(PWM)=PB0   IN1=PB1   IN2=PB10\r\n");
  uart_puts("\r\n");
  uart_puts("   powered up in STOP.  send h for the command list.\r\n");
  uart_puts("\r\n");
  uart_puts("   motor does not move?  check these two first:\r\n");
  uart_puts("     1. L298N GND and STM32 GND are joined\r\n");
  uart_puts("     2. the ENA jumper on the L298N is removed\r\n");
  uart_puts("\r\n");

  print_status();

  g_last_hb = g_ms;

  for (;;)
  {
    while (uart_rx_ready() != 0U)
    {
      c = uart_getc();

      if (is_digit(c) != 0U)
      {
        if (g_buf_len < 3U)
        {
          g_buf[g_buf_len] = c;
          g_buf_len++;
          g_last_digit = g_ms;
        }
      }
      else if (is_sep(c) != 0U)
      {
        flush_number();
      }
      else
      {
        flush_number();
        handle_letter(to_lower(c));
      }
    }

    /* A bare number fires once you stop typing, so "150" is not read as the
     * three commands 1, 15, 150. */
    if ((g_buf_len > 0U) && ((g_ms - g_last_digit) > NUM_TIMEOUT_MS))
    {
      flush_number();
    }

    if ((g_ms - g_last_hb) >= HEARTBEAT_MS)
    {
      g_last_hb = g_ms;

      if (g_hb_on == 0U) { HB_ON();  g_hb_on = 1U; }
      else               { HB_OFF(); g_hb_on = 0U; }
    }
  }
}
