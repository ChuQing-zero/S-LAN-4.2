/* ============================================================================
 *  S-LAN V4.0  --  Full System Test with Servos
 *                  (bare metal, no HAL, no CubeMX)
 *
 *  MCU   : STM32F103x  (Blue Pill)
 *  Build : Keil MDK-ARM 5  +  ARM Compiler 5
 *  Date  : 2026-09-22
 *
 *  ---------------------------------------------------------------------------
 *  WHAT IT DOES - THE CYCLE
 *
 *      One operating cycle, triggered by a card blocking the light:
 *
 *          step 0   WAIT FOR THE LIGHT     the light must be blocked
 *                                          CONTINUOUSLY for 1.0 s
 *                  ------------------------------------------------------
 *          step 1   RISE                   both servos ramp to the lift
 *                                          position, one turning forward
 *                                          and one turning backward
 *                                          exactly 2.0 s
 *          step 2   HOLD                   stay at the lift position
 *                                          2.0 s
 *          step 3   LOWER                  both servos go back down.
 *                                          Each limit switch stops its
 *                                          OWN servo the moment it closes;
 *                                          the other one keeps going.
 *                                          Switch 1 -> servo 1, always.
 *                                          at most 10.0 s
 *                  ------------------------------------------------------
 *          back to step 0
 *
 *      A full cycle therefore takes 4 s plus however long the descent
 *      needs, up to 14 s worst case.
 *
 *  ---------------------------------------------------------------------------
 *  READ THIS FIRST - WHICH KIND OF SERVO IS PLUGGED IN
 *
 *      There are two kinds of hobby servo, they take exactly the same
 *      three wires and the same 50 Hz signal, and the SAME pulse width
 *      means completely different things to each of them:
 *
 *                                    MG90S           360 degree
 *                                  (positional)     (continuous)
 *          1500 us  ..............   go to 90 deg  .  STOP
 *          2200 us  ..............   go to 140 deg .  spin one way, speed
 *           800 us  ..............   go to  40 deg .  spin the other way
 *
 *      A positional servo has a position sensor inside and drives until it
 *      gets there.  A continuous servo has the sensor replaced by a speed
 *      controller, so the pulse is a SPEED COMMAND, not a destination.
 *
 *      THE BUG THIS FILE USED TO HAVE.  Stopping a positional servo means
 *      simply not writing a new pulse: it brakes at wherever it already is.
 *      That is what the previous version did, and with a positional servo
 *      it was right.  With a CONTINUOUS servo it is exactly nothing - the
 *      last pulse written was a SPEED, so the motor keeps spinning at that
 *      speed for ever.  The state machine did reach IDLE and the counters
 *      did move, so the serial port said "stopped" while the mechanism
 *      carried on and drove itself into the end stop.  A continuous servo
 *      has to be TOLD to stop: write 1500 us.
 *
 *      Every halt in this file therefore goes through servos_halt(), which
 *      does the right thing for whichever kind is selected at the top.
 *
 *
 *  WHY THE RISE IS A RAMP (POSITIONAL ONLY)
 *
 *      A positional servo has no speed control.  Write a new pulse width
 *      and it slams to that angle at full speed - a few hundred
 *      milliseconds, drawing a big current spike and shocking the
 *      mechanism.
 *
 *      Two servos push the SAME rigid platform.  If they are commanded in
 *      one jump, they arrive by different paths at different moments and
 *      fight each other through the platform on the way.  That is the exact
 *      failure mode section 7 of the unit board design doc exists to
 *      prevent.
 *
 *      So the target is approached in 100 small steps of 20 ms.  Both
 *      channels are written from the same step counter, so they cannot
 *      drift apart, and 100 x 20 ms is exactly the 2 s the cycle asks for.
 *
 *      A continuous servo needs none of this.  Its own electronics
 *      accelerate it to the commanded speed, so there is nothing to ramp:
 *      "rise" simply means run at that speed for 2 s and then stop.  That
 *      is why RISE_STEPS is 1 in continuous mode - a one-step ramp is a
 *      direct speed command.
 *
 *  ---------------------------------------------------------------------------
 *  WHY THE LIGHT MUST BE BLOCKED FOR A FULL SECOND
 *
 *      A raw photoresistor reading jitters - mains flicker in the room
 *      lights, shadows, a hand passing over.  Reacting to a single reading
 *      means reacting to noise.
 *
 *      The trigger is therefore a timer, not a comparison: `hold` counts up
 *      only while the reading is under the threshold, and is slammed back to
 *      zero the instant one reading comes back above it.  A cycle starts
 *      only when that counter reaches 1000 ms.
 *
 *      One further guard: after a cycle the trigger is DISARMED until the
 *      light comes back.  Without it, a card left lying on the sensor would
 *      re-trigger forever.  See ARMING below.
 *
 *  ---------------------------------------------------------------------------
 *  ARMING - EASY TO CHANGE IF YOU WANT SOMETHING ELSE
 *
 *      ARMED   a cycle may start once the light has been blocked 1 s
 *      DISARMED   set the moment a cycle starts
 *
 *      DISARMED -> ARMED happens the moment the light comes back, i.e. the
 *      card has gone.  So the machine wants one card in, one cycle out.
 *
 *      If you would rather it ran continuously while something keeps the
 *      light blocked, delete the `g_armed` test in the ST_IDLE case.
 *
 *  ---------------------------------------------------------------------------
 *  THE LIMIT SWITCHES - ONE SWITCH, ONE SERVO, DESCENT ONLY
 *
 *      There are exactly two rules, and both of them matter:
 *
 *      RULE 1 - IT IS ONE TO ONE.
 *
 *          limit switch 1 (PB9)   stops SERVO 1 (PB10).  Nothing else.
 *          limit switch 2 (PB5)   stops SERVO 2 (PB11).  Nothing else.
 *
 *          There is no "stop everything" switch.  One side can be down and
 *          parked while the other is still lowering, and the parked side
 *          stays parked no matter what the ramp does - see the lock flags
 *          in servo_set_us().
 *
 *      RULE 2 - ONLY DURING THE DESCENT.
 *
 *          At the start of a cycle the platform is already at the bottom,
 *          so BOTH switches are already closed.  That is the normal resting
 *          condition, not a trigger.
 *
 *          If they were obeyed during the rise the machine would stop the
 *          instant it started and never move at all.  So the switches are
 *          read on every pass but only ACTED ON in ST_LOWER.  Press either
 *          one during the rise or the hold and absolutely nothing happens;
 *          the cycle carries on as if you had not touched it.
 *
 *      The 10 s timeout is the backstop.  If one side never reaches its
 *      switch, both stop at 10 s, `to` and `one` go up, and the serial line
 *      shows which side was missing in n1 / n2.  A repeated one-sided
 *      descent means the mechanism, not the code: one servo has been
 *      stalled against something for seconds, and the two sides are no
 *      longer level with each other.
 *
 *      Both switches are wired COM + NC, so a broken wire reads as CLOSED,
 *      i.e. as "already down".  That is deliberate: a loose wire stops the
 *      servo early instead of letting it run on into the end stop.  It also
 *      means a loose wire is indistinguishable from a genuine landing, so
 *      check the contacts before believing a reading.
 *
 *  ---------------------------------------------------------------------------
 *  WIRING
 *
 *      Servos - SIGNAL ONLY from the board.  Power comes from elsewhere:
 *
 *          servo 1 signal (orange) -> PB10   (TIM2_CH3)
 *          servo 2 signal (orange) -> PB11   (TIM2_CH4)
 *          servo +5V      (red)    -> external 5 V supply +
 *          servo GND      (brown)  -> external 5 V supply -
 *                                     AND to Blue Pill GND   <- COMMON GROUND
 *
 *      WARNING - never power the servos from the Blue Pill 5V pin, and
 *      never raise the servo supply to 6 V.  At 6 V an MG90S needs a logic
 *      high of 3.0-3.6 V and a 3.3 V signal no longer reliably reaches it.
 *
 *      A 100R resistor in series with each signal line is what the BOM
 *      specifies; it is not needed on the breadboard but do not forget it
 *      on the PCB.
 *
 *      Limit switches - COM + NC, so a broken wire reads as TRIGGERED:
 *
 *          switch 1    COM -> PB9      NC -> GND     NO -> not connected
 *          switch 2    COM -> PB5      NC -> GND     NO -> not connected
 *
 *      Each switch input also has a 100 nF from the pin to GND, right at the
 *      chip pin.  With the internal ~40k pull-up that is a 4 ms time
 *      constant - a press is seen inside one 20 ms loop, and a short glitch
 *      gets filtered.  Do not go above 1 uF.
 *
 *      Triggered = the pin reads 1.
 *
 *      Lamps, all ACTIVE HIGH - cathode to GND, opposite of the onboard LED:
 *
 *          PB14 ---[ 470R ]--- LED1 long leg     LED1 short leg ---> GND
 *          PB15 ---[ 470R ]--- LED2 long leg     LED2 short leg ---> GND
 *          PA11 ---[ 470R ]--- LED3 long leg     LED3 short leg ---> GND
 *          PA12 ---[ 470R ]--- LED4 long leg     LED4 short leg ---> GND
 *
 *      What the lamps mean:
 *
 *          LED1  PB14   limit switch 1, raw     lit = triggered
 *          LED2  PB15   limit switch 2, raw     lit = triggered
 *          LED3  PA11   card detect             lit = light blocked
 *          LED4  PA12   cycle running           lit during RISE / HOLD / LOWER
 *          PC13         heartbeat               toggles at 1 Hz, always
 *
 *      Photoresistor divider.  +3V3, never +5V - PA0 is not 5 V tolerant:
 *
 *          +3V3 ---[ GL5528 ]---+---[ 10k ]--- GND
 *                              |
 *                              +---> PA0
 *
 *      Serial, three wires.  This debug port is the only window into the
 *      state machine, so keep it connected:
 *
 *          CH340 TXD ---> PA10     (USART1_RX)
 *          CH340 RXD ---> PA9      (USART1_TX)
 *          CH340 GND ---> GND
 *          CH340 VCC ---> not connected
 *
 *      NOT WIRED YET: the I2C link on PB6 / PB7.
 *
 *  ---------------------------------------------------------------------------
 *  READING THE OUTPUT
 *
 *      SW1=0 SW2=0 ADC= 3421 TH= 2000 hold= 0.0s ST=IDLE cyc=  0 to=  0 one=  0 n1=0 n2=0 nl=  0
 *
 *          SW1    limit switch 1, 0 = open, 1 = closed
 *          SW2    limit switch 2, same
 *          ADC    divider reading now, 0..4095, where 4095 = 3.300 V
 *          TH     the threshold this build compares against
 *          hold   how long the light has been blocked continuously;
 *                 a cycle starts when this reaches 1.0
 *          ST     IDLE / RISE / HOLD / LOWER
 *          cyc    completed cycles since power-up
 *          to     descents that gave up on the 10 s timeout
 *          one    of those, how many had only ONE side arrive
 *          n1     servo 1 has reached its switch this descent, 0 or 1
 *          n2     servo 2 has reached its switch this descent, 0 or 1
 *          nl     cycles where the platform never rose at all
 *
 *      n1 / n2 are cleared at the start of every descent, so during LOWER
 *      they are a live progress report: 0/0 = neither side down yet,
 *      1/0 = servo 1 is parked and servo 2 is still going, 1/1 = done.
 *      A 1/0 that sits there until the timeout means servo 2's switch or
 *      linkage is the problem - not the code.
 *
 *      nl is the one to watch with a continuous servo.  The rise is pure
 *      time and there is no position feedback, so the ONLY evidence that a
 *      side lifted is its switch letting go.  If a switch is still closed
 *      when the descent begins, that side never left the bottom.
 *
 *      When that happens the serial line also ends with a loud marker:
 *
 *          ... <<< LIMIT 2 NEVER OPENED - CHECK ITS WIRE
 *
 *      Do not go looking in the servo code.  A switch that reads closed
 *      for ever is almost always a NC wire that is not actually at GND -
 *      the internal pull-up then holds the pin high and it reads as
 *      permanently closed, exactly like a genuine landing.  The lamp for
 *      that switch will be lit the whole time, which is the quickest way
 *      to tell: watch lamp 2 during the rise, and it should go OUT.
 *
 *      The header line above is only printed once, at boot.
 *
 *  ---------------------------------------------------------------------------
 *  THE THRESHOLD IS A PLACEHOLDER
 *
 *      TH = 2000 is carried over from 05 and was never measured on this
 *      divider.  Run ../../08-SystemTest first and read min and max off its
 *      output, then put (min + max) / 2 in THRESHOLD below.
 *
 *      Until then a cycle may trigger by itself, or refuse to trigger at
 *      all.  Both are the threshold, not the servo code.
 *
 *  ---------------------------------------------------------------------------
 *  PROJECT SETUP (same as 03 through 08)
 *      1. Project -> Manage -> Run-Time Environment
 *         tick  [x] CMSIS -> CORE
 *         tick  [x] Device -> Startup
 *      2. Keep system_stm32f10x.c in the project.
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


/* ==========================================================================
 *  TUNING - everything you are likely to want to change lives here
 * ========================================================================== */

/* ---- Pillars ----------------------------------------------------------
 *
 *  The three numbers from the cycle spec.  Change these and the whole
 *  cycle changes; nothing below assumes any particular value.
 * --------------------------------------------------------------------- */

#define BLOCK_MS         1000        /* light must stay blocked this long  */
#define RISE_MS          2000        /* step 1: ramp up                    */
#define HOLD_MS          2000        /* step 2: stay up                    */
#define LOWER_TIMEOUT_MS 10000       /* step 3: give up after this         */

/* The descent ramps at the same rate as the rise, then holds at the rest
 * position pressing against whatever is down there until the limit switch
 * closes or the timeout expires. */
#define LOWER_RAMP_MS    2000


/* ---- Which kind of servo is on the bench ------------------------------
 *
 *  1 = 360 degree CONTINUOUS ROTATION  (pulse width = speed, 1500 = stop)
 *  0 = MG90S POSITIONAL                (pulse width = angle, 1500 = 90 deg)
 *
 *  The bench currently has the 360 degree ones, so this is 1.
 *
 *  !!! SET THIS BACK TO 0 BEFORE FLASHING THE FINISHED BOARD !!!
 *  The BOM and the unit board design doc both specify the MG90S.  Running
 *  continuous
 *  mode on a positional servo will not damage it, but the machine will not
 *  work: every "stop" would send it to 90 degrees instead of holding, and
 *  the lift would be a full-speed slam rather than a 2 s ramp.
 * --------------------------------------------------------------------- */

#define SERVO_CONTINUOUS   1


/* ---- Servo travel -----------------------------------------------------
 *
 *  Everything is in MICROSECONDS, because that is what a servo actually
 *  takes.  Degrees only appear in the positional branch below.
 *
 *  Servo 1 (PB10) RISES by turning FORWARD.
 *  Servo 2 (PB11) RISES by turning BACKWARD.
 *  The two are mirror images, which is what a pair of servos pushing the
 *  same platform from opposite sides needs.
 *
 *  WHICH WAY IS "FORWARD" IS NOT STANDARDISED.  Some continuous servos
 *  treat above 1500 as clockwise and some as anticlockwise, and it differs
 *  between batches of the same model.  If one servo turns the wrong way,
 *  swap its two numbers - US_RISE_n and US_DOWN_n - and nothing else.
 * --------------------------------------------------------------------- */

#if SERVO_CONTINUOUS

  /* The middle of the dead band.  This is the STOP command.
   *
   * Some continuous servos creep slowly at exactly 1500 - the dead band is
   * not perfectly centred.  If the motors crawl while the machine is idle,
   * nudge this by 10 or 20 at a time until they truly stop, and leave it
   * there. */
  #define SERVO_MID_US   1500

  /* How far from the middle to push.  0 = stop, 1000 = full speed.
   *
   * 700 is about 70% and is a deliberate bench value: with no mechanism
   * attached there is nothing to be gentle with, but full speed slams the
   * servo against its own internal end stops on every cycle, which is hard
   * on the gearbox.  Raise it toward 1000 once the mechanism is on and you
   * know the 2 s gives the right travel. */
  #define SERVO_SPAN_US   700

  #define US_RISE_1      (SERVO_MID_US + SERVO_SPAN_US)   /* 2200 */
  #define US_RISE_2      (SERVO_MID_US - SERVO_SPAN_US)   /*  800 */
  #define US_DOWN_1      (SERVO_MID_US - SERVO_SPAN_US)   /*  800 */
  #define US_DOWN_2      (SERVO_MID_US + SERVO_SPAN_US)   /* 2200 */

  /* Where the servos sit when the machine is not moving.  For a continuous
   * servo that is simply the stop command. */
  #define US_REST_1       SERVO_MID_US
  #define US_REST_2       SERVO_MID_US

  /* A continuous servo has nothing to ramp - the pulse IS the speed. */
  #define RISE_STEPS      1U
  #define LOWER_STEPS     1U

#else   /* ---- positional MG90S ---------------------------------------- */

  /* 500 us ~ 0 deg,  1500 us ~ 90 deg,  2500 us ~ 180 deg */
  #define DEG_TO_US(d)   (500UL + ((uint32_t)(d) * 2000UL) / 180UL)

  #define S1_REST_DEG      90
  #define S1_LIFT_DEG     140          /* forward  = rising  */
  #define S2_REST_DEG      90
  #define S2_LIFT_DEG      40          /* backward = rising  */

  #define US_RISE_1       DEG_TO_US(S1_LIFT_DEG)
  #define US_RISE_2       DEG_TO_US(S2_LIFT_DEG)
  #define US_DOWN_1       DEG_TO_US(S1_REST_DEG)
  #define US_DOWN_2       DEG_TO_US(S2_REST_DEG)
  #define US_REST_1       DEG_TO_US(S1_REST_DEG)
  #define US_REST_2       DEG_TO_US(S2_REST_DEG)

  /* 100 steps of 20 ms = the 2 s the cycle asks for. */
  #define RISE_STEPS      (RISE_MS / LOOP_MS)
  #define LOWER_STEPS     (LOWER_RAMP_MS / LOOP_MS)

#endif

/* Pulse limits.  Anything outside this is clamped, so a typo in the numbers
 * above cannot drive a servo past its mechanical end. */
#define SERVO_MIN_US    500
#define SERVO_MAX_US   2500


/* ---- Threshold --------------------------------------------------------
 *
 *  PLACEHOLDER - see the header.  Readings BELOW this mean "blocked".
 * --------------------------------------------------------------------- */
#define THRESHOLD        2000


/* ---- Pins ------------------------------------------------------------- */

/* Both switches moved off PB12 / PB13 so they sit on the TOP edge of the
 * chip, where the connectors are (see the board layout doc).  PB9 is chip
 * pin 46 and PB5 is chip pin 41.  Changing these two numbers is enough -
 * sw_read() and the pull-up write both follow them. */
#define SW1_PIN           5          /* PB5    limit switch 1 -> servo 1    */
#define SW2_PIN           9          /* PB9    limit switch 2 -> servo 2    */

#define LED1_PIN         14          /* PB14   limit switch 1 lamp          */
#define LED2_PIN         15          /* PB15   limit switch 2 lamp          */
#define LED3_PIN         11          /* PA11   card detect lamp             */
#define LED4_PIN         12          /* PA12   cycle running lamp           */
#define HB_PIN           13          /* PC13   onboard LED                  */

#define ADC_CH            0          /* PA0    ADC1_IN0, photoresistor      */

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


/* ---- Derived ---------------------------------------------------------- */

#define LOOP_MS          20          /* one pass of the main loop       */

#define REPORT_EVERY     10          /* print every 10 passes = 200 ms  */
#define HB_MS            500         /* heartbeat half period = 1 Hz    */
#define ADC_AVG          16

#define BOOT_BLINK_MS    300
#define BOOT_BLINKS      3


/* ---- States ----------------------------------------------------------- */

typedef enum
{
  ST_IDLE = 0,
  ST_RISE,
  ST_HOLD,
  ST_LOWER
} state_t;


/* ---- Prototypes ------------------------------------------------------- */

void        SysTick_Handler(void);   /* overrides the weak one in the startup file */

static void     gpio_init(void);
static void     leds_all_off(void);
static void     adc_init(void);
static uint16_t adc_read_once(void);
static uint16_t adc_read_avg(void);
static uint8_t  sw_read(uint32_t pin);

static void     servo_init(void);
static void     servo_set_us(uint32_t ch, uint32_t us);
static void     servo_park(uint32_t ch);
static void     ramp_start(uint32_t from1, uint32_t from2,
                           uint32_t to1,   uint32_t to2,
                           uint32_t steps);
static uint8_t  ramp_tick(void);
static void     servos_halt(void);
static void     servos_rest(void);
static void     servos_unlock(void);

static void     systick_init(void);
static void     delay_ms(uint32_t ms);

static void     uart_init(void);
static void     uart_putc(char c);
static void     uart_puts(const char *s);
static void     uart_put_u32_pad(uint32_t v, uint8_t width);
static void     uart_put_sec10(uint32_t ms);
static const char *state_name(state_t s);

static void     enter(state_t s, uint32_t now);


/* ---- Globals ---------------------------------------------------------- */

static volatile uint32_t g_ms = 0;

/* Where the servos are right now, in pulse width. */
static uint32_t g_us1 = 1500;
static uint32_t g_us2 = 1500;

/* Parked channels.
 *
 * Each limit switch stops ITS OWN servo and nothing else, so one channel
 * can be finished while the other is still lowering.  A parked channel must
 * be left completely alone for the rest of the cycle - the ramp keeps
 * writing both channels every pass from a shared step counter, and without
 * this lock it would immediately restart the servo that just stopped. */
static uint8_t  g_lock3 = 0U;        /* channel 3 = PB10 = servo 1 */
static uint8_t  g_lock4 = 0U;        /* channel 4 = PB11 = servo 2 */

/* Which servos have reached their own limit switch this descent. */
static uint8_t  g_done1 = 0U;
static uint8_t  g_done2 = 0U;

/* Ramp generator */
static uint32_t g_ramp_from1, g_ramp_from2;
static uint32_t g_ramp_to1,   g_ramp_to2;
static uint32_t g_ramp_steps, g_ramp_step;

/* State machine */
static state_t  g_state     = ST_IDLE;
static uint32_t g_state_ms  = 0;     /* g_ms when the state was entered */

/* Counters, all shown on the serial line */
static uint32_t g_cycles    = 0;
static uint32_t g_timeouts  = 0;
static uint32_t g_onesided  = 0;     /* descents where only ONE side got there */
static uint32_t g_norel     = 0;     /* cycles where a side never left the bottom */

/* Did each side fail to release its switch during the rise?
 *
 * A switch that is ALREADY closed when the descent begins never opened, so
 * that side never left the bottom.  It cannot mean "arrived at the bottom",
 * because it never left in the first place.  Set once per descent, in the
 * ST_HOLD -> ST_LOWER transition, and shown on the serial line. */
static uint8_t  g_norel1    = 0U;
static uint8_t  g_norel2    = 0U;

/* Trigger: how long the light has been blocked, and whether we are allowed
 * to start a cycle at all.  See ARMING in the header. */
static uint32_t g_hold_ms   = 0;
static uint8_t  g_armed     = 1U;


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
  uint8_t  s1, s2, blocked;
  uint8_t  hb_on       = 0U;
  uint32_t hb_last     = 0UL;
  uint32_t next_report = 0UL;
  uint32_t now;

  /* SysTick first: adc_init() and the boot park use delay_ms(). */
  gpio_init();
  systick_init();
  uart_init();
  adc_init();
  servo_init();

  /* ---- 3 slow blinks on the onboard LED: the program is alive --------- */
  for (i = 0; i < BOOT_BLINKS; i++)
  {
    HB_ON();
    delay_ms(BOOT_BLINK_MS);
    HB_OFF();
    delay_ms(BOOT_BLINK_MS);
  }

  /* ---- Park both servos at rest before anything else ------------------
   * A servo that powers up somewhere unknown will jump when the first
   * pulse arrives.  Give it a known place to be.  For a continuous servo
   * this is also the stop command, so the motors are still from here on.
   * -------------------------------------------------------------------- */
  servos_rest();
  delay_ms(500);

  /* ---- Banner ---------------------------------------------------------
   * If you can read this, the serial wiring, the baud rate and the system
   * clock are all correct.
   * -------------------------------------------------------------------- */
  uart_puts("\r\n\r\n");
  uart_puts("=====================================================\r\n");
  uart_puts("  S-LAN V4.0   system test with servos\r\n");
  uart_puts("     servo 1 PB10   rises forward\r\n");
  uart_puts("     servo 2 PB11   rises backward\r\n");
  uart_puts("     limit 1 PB9    stops servo 1  (lower only)\r\n");
  uart_puts("     limit 2 PB5    stops servo 2  (lower only)\r\n");
  uart_puts("     light   PA0    card detect, needs 1.0 s\r\n");
  uart_puts("  cycle: rise 2s, hold 2s, lower <= 10s\r\n");
  uart_puts("  limit switches do NOTHING during rise or hold.\r\n");

#if SERVO_CONTINUOUS
  uart_puts("  servos: 360 deg CONTINUOUS - pulse is a speed,\r\n");
  uart_puts("  so every stop writes 1500us explicitly.\r\n");
#else
  uart_puts("  servos: MG90S positional - pulse is an angle,\r\n");
  uart_puts("  so the rise is a 2s ramp.\r\n");
#endif

  if ((RCC->CFGR & RCC_CFGR_SWS) == RCC_CFGR_SWS_PLL)
  {
    uart_puts("  clock: PLL, 72 MHz - good\r\n");
  }
  else
  {
    uart_puts("  clock: *** NOT PLL *** - the 8 MHz crystal did\r\n");
    uart_puts("  not start, so the baud rate is wrong.\r\n");
  }

  uart_puts("  TH=2000 IS A PLACEHOLDER - run 08-SystemTest\r\n");
  uart_puts("  first and read min and max off its output.\r\n");
  uart_puts("=====================================================\r\n");

  uart_puts("SW1= SW2= ADC=  TH=  hold=  ST=  cyc=  to= one= n1= n2= nl=\r\n");

  next_report = g_ms;

  /* ---- Main loop, one pass every 20 ms --------------------------------
   *
   *  ORDER MATTERS.  The switches are read and acted on at the very top,
   *  before the ADC and before the serial report, because those two are
   *  slow (the ADC average is about 90 us, the report far more) and a stop
   *  command must not sit in a queue behind them.  Worst-case latency from
   *  a limit switch closing to 1500 us reaching the servos is therefore one
   *  loop period, 20 ms.
   * -------------------------------------------------------------------- */
  while (1)
  {
    now = g_ms;

    s1 = sw_read(SW1_PIN);
    s2 = sw_read(SW2_PIN);

    /* ---- LIMIT SWITCH RULES ------------------------------------------
     *
     *  ONE SWITCH, ONE SERVO.  Limit switch 1 stops servo 1 and nothing
     *  else; limit switch 2 stops servo 2 and nothing else.  There is no
     *  "stop everything" switch.
     *
     *  AND ONLY DURING THE DESCENT.  At the start of a cycle the platform
     *  is already at the bottom, so both switches are already closed - that
     *  is the normal resting condition, not a trigger.  If they were obeyed
     *  during the rise the machine would stop the instant it started and
     *  never move at all.  So the switches are read every pass but only
     *  ACTED ON in ST_LOWER.  Press either one during the rise or the hold
     *  and nothing happens; the cycle carries on.
     * ----------------------------------------------------------------- */

    /* ---- State machine ------------------------------------------------ */
    switch (g_state)
    {
      /* ---- Waiting for a card ---------------------------------------- */
      case ST_IDLE:
        /* Keep telling the servos to stop, every single pass.  With a
         * positional servo this is a no-op and the angle is held; with a
         * continuous servo it is the only thing keeping the motors still. */
        servos_halt();

        if ((g_armed != 0U) && (g_hold_ms >= BLOCK_MS))
        {
          g_armed = 0U;
          g_hold_ms = 0UL;

          /* Release any channel parked by the previous descent, and clear
           * last descent's release report. */
          servos_unlock();
          g_done1  = 0U;
          g_done2  = 0U;
          g_norel1 = 0U;
          g_norel2 = 0U;

          /* Continuous: RISE_STEPS is 1, so this writes the rise speed
           * straight away - a speed command.  Positional: RISE_STEPS is
           * 100, so this starts the 2 s ramp toward the lift angle. */
          ramp_start(g_us1, g_us2, US_RISE_1, US_RISE_2, RISE_STEPS);
          enter(ST_RISE, now);
        }
        break;

      /* ---- Step 1: rise, 2 s -----------------------------------------
       * Neither limit switch has any effect here, by design.
       * ----------------------------------------------------------------- */
      case ST_RISE:
        /* ramp_tick() returns 1 at once in continuous mode, so the time
         * test is what actually ends this state.  In positional mode the
         * ramp takes essentially the same 2 s and either test may win. */
        if ((ramp_tick() != 0U) && ((now - g_state_ms) >= RISE_MS))
        {
          enter(ST_HOLD, now);
        }
        break;

      /* ---- Step 2: hold, 2 s -----------------------------------------
       * Neither limit switch has any effect here either.
       * ----------------------------------------------------------------- */
      case ST_HOLD:
        /* Continuous servos have no way to hold a position - the pulse is a
         * speed, and the only speed that stands still is 0, i.e. 1500 us.
         * The platform stays put because the gearbox resists back-driving.
         *
         * If the platform sags during this 2 s, the gearbox is too free and
         * a continuous servo simply cannot do this step.  That is a real
         * argument for the MG90S in the finished design.
         *
         * Positional servos: servos_halt() does nothing here, which leaves
         * the lift angle held. */
        servos_halt();

        if ((now - g_state_ms) >= HOLD_MS)
        {
          /* ---- Did each side actually leave the bottom? ----------------
           * A continuous servo has no position feedback, so the rise is
           * pure time and nothing else can tell us whether it worked.  The
           * ONLY evidence is whether the switch let go.
           *
           * A switch that is still closed here NEVER OPENED.  That side
           * never left the bottom, so "the switch is closed" cannot mean
           * "arrived at the bottom" - it was never anywhere else.
           *
           * Getting this wrong is what made servo 2 (PB11 / TIM2_CH4) sit
           * still through a whole descent: the old code checked the switch
           * on every pass of ST_LOWER, so a side that was still closed the
           * instant the descent began got parked before it had been given
           * a single pulse, and the cycle then counted as a clean success
           * even though that servo had not moved at all.
           *
           * So the decision is made HERE, once, at the transition, from a
           * snapshot - not from a level that is re-read every pass.
           *
           * Such a side IS parked rather than driven: if the arm never came
           * off the switch, driving it further just presses it into a stop
           * it is already sitting on.  What changes is that it is now
           * reported loudly instead of passing silently.
           * ------------------------------------------------------------- */
          servos_unlock();
          g_done1 = 0U;
          g_done2 = 0U;

          g_norel1 = (s1 != 0U) ? 1U : 0U;
          g_norel2 = (s2 != 0U) ? 1U : 0U;

          if (g_norel1 != 0U) { servo_park(3U); g_done1 = 1U; }
          if (g_norel2 != 0U) { servo_park(4U); g_done2 = 1U; }

          if ((g_norel1 != 0U) || (g_norel2 != 0U))
          {
            g_norel++;
          }

          if ((g_done1 != 0U) && (g_done2 != 0U))
          {
            /* Neither side left the bottom.  There is nothing to lower. */
            enter(ST_IDLE, now);
          }
          else
          {
            ramp_start(g_us1, g_us2, US_DOWN_1, US_DOWN_2, LOWER_STEPS);
            enter(ST_LOWER, now);
          }
        }
        break;

      /* ---- Step 3: lower - THIS IS WHERE THE SWITCHES COUNT ---------- */
      case ST_LOWER:
        /* Each side stops the moment ITS OWN switch closes, and is then
         * parked so nothing can restart it.  The other side carries on. */
        if ((g_done1 == 0U) && (s1 != 0U))
        {
          /* THIS IS THE LINE THAT WAS BROKEN.  Stopping the ramp alone only
           * stops the RAMP; the servos keep whatever pulse they were last
           * given.  A positional servo brakes there and that looks fine.  A
           * continuous servo reads that pulse as a speed and keeps going,
           * straight into the end stop, while the serial port cheerfully
           * reports IDLE.  Each motor has to be told, explicitly. */
          servo_park(3U);
          g_done1 = 1U;
        }

        if ((g_done2 == 0U) && (s2 != 0U))
        {
          servo_park(4U);
          g_done2 = 1U;
        }

        if ((g_done1 != 0U) && (g_done2 != 0U))
        {
          /* Both sides are down.  A clean cycle. */
          servos_halt();
          g_cycles++;
          enter(ST_IDLE, now);
        }
        else if ((now - g_state_ms) >= LOWER_TIMEOUT_MS)
        {
          /* 10 s and at least one side never arrived.  Stop anyway, and
           * count it - which side is missing is on the serial line as n1/n2.
           *
           * Do not just run it again.  A side that never reaches its switch
           * means it has been stalled against something for seconds, which
           * is how servos get cooked, and it means the two sides are no
           * longer level with each other. */
          servos_halt();
          g_timeouts++;
          g_onesided++;
          enter(ST_IDLE, now);
        }
        else
        {
          /* Re-writes the descent speed every pass on any channel that is
           * not parked.  Harmless in continuous mode and the real ramp in
           * positional mode. */
          ramp_tick();
        }
        break;

      default:
        enter(ST_IDLE, now);
        break;
    }

    /* ---- Light, only worth reading when a card could still arrive -----
     * Placed after the state machine so a limit switch never waits behind
     * 16 ADC conversions.  Reading it every pass anyway keeps `hold`
     * counting up smoothly while the machine is idle.
     * ----------------------------------------------------------------- */
    v       = adc_read_avg();
    blocked = (v < (uint16_t)THRESHOLD) ? 1U : 0U;

    /* ---- Trigger timer ------------------------------------------------
     * Counts up only while the reading stays blocked.  One clear reading
     * anywhere in the middle and it starts again from zero.  That is what
     * turns a noisy photoresistor into a decision.
     * ----------------------------------------------------------------- */
    if (blocked != 0U)
    {
      if (g_hold_ms < BLOCK_MS)
      {
        g_hold_ms += LOOP_MS;
      }
    }
    else
    {
      g_hold_ms = 0UL;

      /* The light came back, so whatever was in the way has gone.  Allow
       * the next cycle.  See ARMING in the header. */
      if (g_state == ST_IDLE)
      {
        g_armed = 1U;
      }
    }

    /* ---- Lamps -------------------------------------------------------- */
    if (s1 != 0U) { LED1_ON(); } else { LED1_OFF(); }
    if (s2 != 0U) { LED2_ON(); } else { LED2_OFF(); }
    if (blocked != 0U) { LED3_ON(); } else { LED3_OFF(); }

    /* LED4 is on for as long as a cycle is running, so a glance tells you
     * whether the machine is busy even with the serial port unplugged. */
    if ((g_state == ST_RISE) || (g_state == ST_HOLD) || (g_state == ST_LOWER))
    {
      LED4_ON();
    }
    else
    {
      LED4_OFF();
    }

    /* Heartbeat on the onboard LED, independent of everything else. */
    if ((now - hb_last) >= HB_MS)
    {
      hb_last = now;
      hb_on   = (uint8_t)(hb_on == 0U ? 1U : 0U);

      if (hb_on != 0U) { HB_ON();  } else { HB_OFF(); }
    }

    /* ---- Report ------------------------------------------------------- */
    if ((now - next_report) >= (LOOP_MS * REPORT_EVERY))
    {
      next_report = now;

      uart_puts("SW1=");
      uart_put_u32_pad(s1, 1);
      uart_puts(" SW2=");
      uart_put_u32_pad(s2, 1);
      uart_puts(" ADC=");
      uart_put_u32_pad(v, 5);
      uart_puts(" TH=");
      uart_put_u32_pad(THRESHOLD, 5);
      uart_puts(" hold=");
      uart_put_sec10(g_hold_ms);
      uart_puts(" ST=");
      uart_puts(state_name(g_state));
      uart_puts(" cyc=");
      uart_put_u32_pad(g_cycles, 3);
      uart_puts(" to=");
      uart_put_u32_pad(g_timeouts, 3);
      uart_puts(" one=");
      uart_put_u32_pad(g_onesided, 3);
      uart_puts(" n1=");
      uart_put_u32_pad(g_done1, 1);
      uart_puts(" n2=");
      uart_put_u32_pad(g_done2, 1);
      uart_puts(" nl=");
      uart_put_u32_pad(g_norel, 3);

      if (blocked != 0U) { uart_puts("  [BLOCKED]"); }
      else               { uart_puts("  [clear  ]"); }

      /* Shout if a side never left the bottom this descent.  This is the
       * signature of a switch whose NC wire is not really at GND: the pin
       * floats high through the pull-up and reads as permanently closed,
       * so that servo is parked the instant the descent starts and never
       * moves - while everything else looks perfectly normal. */
      if ((g_norel1 != 0U) || (g_norel2 != 0U))
      {
        uart_puts("  <<< LIMIT ");
        if (g_norel1 != 0U) { uart_puts("1 "); }
        if (g_norel2 != 0U) { uart_puts("2 "); }
        uart_puts("NEVER OPENED - CHECK ITS WIRE\r\n");
      }
      else
      {
        uart_puts("\r\n");
      }
    }

    delay_ms(LOOP_MS);
  }
}


/* ========================================================================== */
/*  State helper                                                              */
/* ========================================================================== */

static void enter(state_t s, uint32_t now)
{
  g_state    = s;
  g_state_ms = now;
}


static const char *state_name(state_t s)
{
  if (s == ST_RISE)  { return "RISE "; }
  if (s == ST_HOLD)  { return "HOLD "; }
  if (s == ST_LOWER) { return "LOWER"; }

  return "IDLE ";
}


/* ========================================================================== */
/*  Inputs                                                                    */
/* ========================================================================== */

/* Limit switches on PB9 / PB5, wired COM + NC to GND with the internal
 * pull-up enabled:
 *
 *     not triggered   NC closed   pin pulled to GND   reads 0
 *     triggered       NC open     pull-up wins        reads 1
 *     wire off        same as triggered               reads 1  <- fail-safe
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

  /* PA0 must be ANALOG INPUT: GPIOA->CRL bits 0..3 = 0b0000. */
  GPIOA->CRL &= ~(0xFUL << 0);

  /* The ADC clock must stay under 14 MHz.  SystemInit() leaves ADCPRE at
   * PCLK2 / 2 = 36 MHz, which is well over.  Use /6 = 12 MHz. */
  RCC->CFGR &= ~RCC_CFGR_ADCPRE;
  RCC->CFGR |=  RCC_CFGR_ADCPRE_DIV6;

  ADC1->CR2 |= ADC_CR2_ADON;
  delay_ms(1);

  ADC1->CR2 |= ADC_CR2_RSTCAL;
  while ((ADC1->CR2 & ADC_CR2_RSTCAL) != 0UL)
  {
  }

  ADC1->CR2 |= ADC_CR2_CAL;
  while ((ADC1->CR2 & ADC_CR2_CAL) != 0UL)
  {
  }

  ADC1->SQR1 = 0UL;                    /* one conversion in the sequence */
  ADC1->SQR3 = (uint32_t)ADC_CH;       /* first conversion = channel 0   */

  /* SMP0[2:0] = 0b111 = 55.5 cycles, the longest sample window.  The
   * divider's source impedance is up to 10k, so give the sample-and-hold
   * capacitor all the time it can get. */
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
/*  Servos:  TIM2 channel 3 + 4 -> PB10 / PB11, 50 Hz                         */
/* ========================================================================== */

/* PA10 / PA11 note: nothing here touches GPIOA->CRH bits 0..11, so PA8
 * stays free and PA9 / PA10 stay with the serial port. */

static void servo_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;
  RCC->APB2ENR |= RCC_APB2ENR_AFIOEN;    /* needed for the remap below */
  RCC->APB1ENR |= RCC_APB1ENR_TIM2EN;

  /* ---------------------------------------------------------------------
   * TIM2 remap - THIS IS MANDATORY.
   *
   * TIM2 channel 3 and 4 come out on PA2 / PA3 by default.  To get them on
   * PB10 / PB11 you must select the partial remap, otherwise PB10 / PB11
   * output nothing at all and the servos sit still - with no error message
   * anywhere to explain it.
   *
   *   TIM2_REMAP = 00  ->  CH3 = PA2,  CH4 = PA3
   *   TIM2_REMAP = 10  ->  CH3 = PB10, CH4 = PB11   <-- what we want
   * ------------------------------------------------------------------ */
  AFIO->MAPR &= ~AFIO_MAPR_TIM2_REMAP;
  AFIO->MAPR |=  AFIO_MAPR_TIM2_REMAP_PARTIALREMAP2;

  /* PB10 and PB11 -> alternate function push-pull, 50 MHz
   *     GPIOB->CRH bits  8..11  ->  PB10
   *     GPIOB->CRH bits 12..15  ->  PB11
   * Each nibble is CNF[1:0] : MODE[1:0], so 0b1011 = 0xB.
   *
   * CAREFUL: this write must stop at bit 15.  Bits 16..31 are PB12..PB15
   * (the lamps), and bits 4..7 are PB9, limit switch 1 - all configured in
   * gpio_init().  Widening this mask to 0xFFFF would silently un-configure
   * limit switch 1 and leave it floating. */
  GPIOB->CRH &= ~(0xFFUL << 8);
  GPIOB->CRH |=  (0xBBUL << 8);

  /* TIM2 runs from 72 MHz.
   *   PSC = 71    -> 72 MHz / 72 = 1 MHz, so 1 tick = 1 microsecond
   *   ARR = 19999 -> 20000 us = 20 ms period = 50 Hz
   * So a compare value IS a pulse width in microseconds, which is why
   * everything above talks in us rather than degrees. */
  TIM2->PSC  = 71;
  TIM2->ARR  = 19999;

  TIM2->CCR3 = 1500;
  TIM2->CCR4 = 1500;

  TIM2->CCMR2 = TIM_CCMR2_OC3M_1 | TIM_CCMR2_OC3M_2 | TIM_CCMR2_OC3PE
              | TIM_CCMR2_OC4M_1 | TIM_CCMR2_OC4M_2 | TIM_CCMR2_OC4PE;

  TIM2->CCER |= TIM_CCER_CC3E | TIM_CCER_CC4E;

  /* Force an update so PSC / ARR / CCR take effect immediately, otherwise
   * the first period runs with reset values. */
  TIM2->EGR = TIM_EGR_UG;
  TIM2->SR  = 0;

  TIM2->CR1 |= TIM_CR1_ARPE | TIM_CR1_CEN;

  g_us1 = 1500;
  g_us2 = 1500;
}


/* ch is the TIM2 channel number: 3 for PB10, 4 for PB11.
 * The current position is remembered so a ramp knows where it starts.
 *
 * A PARKED channel ignores every write.  That is what lets one limit switch
 * stop its own servo while the other is still lowering: the ramp keeps
 * writing both channels from a shared step counter, and without the lock it
 * would restart the servo that had just stopped. */
static void servo_set_us(uint32_t ch, uint32_t us)
{
  if (us < SERVO_MIN_US) { us = SERVO_MIN_US; }
  if (us > SERVO_MAX_US) { us = SERVO_MAX_US; }

  if (ch == 3U)
  {
    if (g_lock3 != 0U) { return; }
    TIM2->CCR3 = us;
    g_us1 = us;
  }
  else
  {
    if (g_lock4 != 0U) { return; }
    TIM2->CCR4 = us;
    g_us2 = us;
  }
}


/* --------------------------------------------------------------------------
 *  Stop ONE servo where it is, and leave it alone for the rest of the cycle.
 *
 *  The difference between the two kinds of servo is the whole story again:
 *
 *      CONTINUOUS  1500 us is the only thing that stops it, so write 1500
 *                  first and lock afterwards.  Locking first would block the
 *                  very write that does the stopping.
 *
 *      POSITIONAL  it brakes on its own the moment the pulses stop changing,
 *                  so there is nothing to write - just lock, and the angle
 *                  stays where it was.
 * ------------------------------------------------------------------------ */
static void servo_park(uint32_t ch)
{
#if SERVO_CONTINUOUS
  if (ch == 3U)
  {
    TIM2->CCR3 = SERVO_MID_US;
    g_us1      = SERVO_MID_US;
    g_lock3    = 1U;
  }
  else
  {
    TIM2->CCR4 = SERVO_MID_US;
    g_us2      = SERVO_MID_US;
    g_lock4    = 1U;
  }
#else
  if (ch == 3U) { g_lock3 = 1U; }
  else          { g_lock4 = 1U; }
#endif
}


/* Release both channels so the next cycle can move them again.  Called
 * wherever a descent ends, and at the start of every rise. */
static void servos_unlock(void)
{
  g_lock3 = 0U;
  g_lock4 = 0U;
}


/* --------------------------------------------------------------------------
 *  THE TWO WAYS TO STOP A SERVO, AND WHY THEY ARE NOT THE SAME
 *
 *  STOP MOVING, RIGHT HERE
 *
 *      A positional servo holds its angle on its own: just leave the last
 *      pulse alone and it brakes.  So for a positional servo "halt" means
 *      "do nothing at all".
 *
 *      A continuous servo has no idea what its own angle is.  The last
 *      pulse it received was a SPEED.  Leave it alone and it keeps spinning
 *      at that speed indefinitely - which is precisely the failure that
 *      made the limit switch look broken.  It must be commanded to 1500 us.
 *
 *  GO TO THE REST POSE
 *
 *      Used once, at power-up.  Both kinds need this: a servo that powers
 *      up somewhere unknown will lurch when the first pulse arrives, so
 *      give it somewhere known to be.  For a continuous servo the rest
 *      pose IS the stop command, but that is a coincidence, not a law -
 *      keep the two functions separate so the distinction stays visible.
 * ------------------------------------------------------------------------ */

static void servos_halt(void)
{
#if SERVO_CONTINUOUS
  /* 1500 us = zero speed.  Write it, or the motor keeps running. */
  servo_set_us(3U, SERVO_MID_US);
  servo_set_us(4U, SERVO_MID_US);
#else
  /* Positional: leave the pulse alone.  The servo holds its angle, which
   * is exactly what "stopped" means for a positional servo.  Writing a
   * pulse here would send it somewhere, which is the opposite of stopping.
   *
   * If you would rather it went limp instead of holding, disable the two
   * channels - TIM2->CCER &= ~(TIM_CCER_CC3E | TIM_CCER_CC4E) - but note
   * that a raised platform will drop the moment you do. */
#endif
}


static void servos_rest(void)
{
  servo_set_us(3U, US_REST_1);
  servo_set_us(4U, US_REST_2);
}


/* ========================================================================== */
/*  Ramp generator                                                            */
/* ========================================================================== */

/* Both channels are interpolated from the SAME step counter, so they cannot
 * drift apart no matter how long the ramp is.  That is the whole point:
 * two servos on one rigid platform must stay in step, and the cheapest way
 * to guarantee it is to compute both from one number.
 *
 * Signed arithmetic on purpose - the two channels move in opposite
 * directions, so one of the two deltas is always negative, and unsigned
 * subtraction would wrap it into a huge positive number.
 */
static void ramp_start(uint32_t from1, uint32_t from2,
                       uint32_t to1,   uint32_t to2,
                       uint32_t steps)
{
  g_ramp_from1 = from1;
  g_ramp_from2 = from2;
  g_ramp_to1   = to1;
  g_ramp_to2   = to2;
  g_ramp_steps = (steps == 0UL) ? 1UL : steps;
  g_ramp_step  = 0UL;
}


/* Advance one step.  Returns 1 once the ramp has arrived, and keeps
 * returning 1 afterwards while the servos hold at the target. */
static uint8_t ramp_tick(void)
{
  int32_t d1;
  int32_t d2;

  if (g_ramp_step >= g_ramp_steps)
  {
    servo_set_us(3U, g_ramp_to1);
    servo_set_us(4U, g_ramp_to2);
    return 1U;
  }

  g_ramp_step++;

  d1 = (int32_t)g_ramp_to1 - (int32_t)g_ramp_from1;
  d2 = (int32_t)g_ramp_to2 - (int32_t)g_ramp_from2;

  /* Integer interpolation: no floating point, no accumulated rounding. */
  servo_set_us(3U, (uint32_t)((int32_t)g_ramp_from1
                + (d1 * (int32_t)g_ramp_step) / (int32_t)g_ramp_steps));

  servo_set_us(4U, (uint32_t)((int32_t)g_ramp_from2
                + (d2 * (int32_t)g_ramp_step) / (int32_t)g_ramp_steps));

  return (g_ramp_step >= g_ramp_steps) ? 1U : 0U;
}


/* ========================================================================== */
/*  GPIO init                                                                 */
/* ========================================================================== */

/* Lamp pins are push-pull outputs at 2 MHz - about 3 mA each and nothing
 * fast going on.  Each nibble is CNF[1:0] : MODE[1:0], so 0b0010 = MODE 10
 * (output, 2 MHz), CNF 00 (general purpose push-pull).  Input with pull-up
 * is 0b1000 = 0x8, with the ODR bit = 1 to select pull-UP.
 *
 *   GPIOA->CRH bits 12..15  ->  PA11     nibble 0x2
 *   GPIOA->CRH bits 16..19  ->  PA12     nibble 0x2
 *   GPIOB->CRL bits 20..23  ->  PB5      nibble 0x8  input pull-up
 *   GPIOB->CRH bits  4.. 7  ->  PB9      nibble 0x8  input pull-up
 *   GPIOB->CRH bits 24..27  ->  PB14     nibble 0x2
 *   GPIOB->CRH bits 28..31  ->  PB15     nibble 0x2
 *   GPIOC->CRH bits 20..23  ->  PC13     nibble 0x2
 *
 * Bits 8..15 of GPIOB->CRH (PB10 / PB11, the servos) belong to
 * servo_init(), and bits 4..11 of GPIOA->CRH (PA9 / PA10, the serial port)
 * belong to uart_init().  Neither may be touched from here.
 */
static void gpio_init(void)
{
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPCEN;

  /* PA11 / PA12 - lamps 3 and 4 */
  GPIOA->CRH &= ~(0xFFUL << 12);
  GPIOA->CRH |=  (0x22UL << 12);

  /* PB9 - limit switch 1, input with internal pull-up.
   *   GPIOB->CRH bits 4..7 -> PB9, high half of port B */
  GPIOB->CRH &= ~(0xFUL << 4);
  GPIOB->CRH |=  (0x8UL << 4);

  /* PB5 - limit switch 2, input with internal pull-up.
   *   GPIOB->CRL bits 20..23 -> PB5, low half of port B.
   * Nothing else in this file writes GPIOB->CRL, so these four bits are
   * ours alone. */
  GPIOB->CRL &= ~(0xFUL << 20);
  GPIOB->CRL |=  (0x8UL << 20);

  /* PB14 / PB15 - lamps 1 and 2 */
  GPIOB->CRH &= ~(0xFFUL << 24);
  GPIOB->CRH |=  (0x22UL << 24);

  /* Pull-ups selected: on an input, ODR bit = 1 means "pull up" */
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


/* A duration in milliseconds, printed as seconds with one decimal:
 *     850  ->  "0.8"      1000 ->  "1.0"      0 ->  "0.0"
 */
static void uart_put_sec10(uint32_t ms)
{
  uart_put_u32_pad(ms / 1000UL, 2);
  uart_putc('.');
  uart_put_u32_pad((ms / 100UL) % 10UL, 1);
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
