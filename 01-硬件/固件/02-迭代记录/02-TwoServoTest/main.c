/* ============================================================================
 *  S-LAN V4.0  --  Two Servo Test
 *
 *  MCU   : STM32F103C8T6  (Blue Pill)
 *  Build : Keil MDK-ARM 5  +  ARM Compiler 5
 *  Date  : 2026-09-21
 *
 *  ---------------------------------------------------------------------------
 *  WHAT IT DOES
 *      Drives two servos on PB10 / PB11, sweeping  0 -> 180 -> 0  forever.
 *
 *  ---------------------------------------------------------------------------
 *  HOW TO USE
 *      Replace the whole file  Core/Src/main.c  in your CubeMX project
 *      with this one. Nothing else needs to change.
 *
 *  ---------------------------------------------------------------------------
 *  WIRING
 *      Servo 1 signal (orange)  ->  PB10
 *      Servo 2 signal (orange)  ->  PB11
 *      Servo   +5V    (red)     ->  external 5V supply  +
 *      Servo   GND    (brown)   ->  external 5V supply  -
 *                                   AND to Blue Pill GND    <-- common ground
 *
 *      WARNING: never power the servos from the Blue Pill 5V pin.
 *               They draw over 1A when stalled and will reset the MCU.
 * ============================================================================
 */

#include "main.h"

/* ---- Tunables --------------------------------------------------------- */

/* Servo pulse width range, in microseconds.
 * MG90S:  500us ~ 0 deg,  1500us ~ 90 deg,  2500us ~ 180 deg
 * If a servo buzzes at the ends, narrow these to 700 / 2300.
 */
#define SERVO_MIN_US     500
#define SERVO_MAX_US     2500

/* Sweep speed: move STEP_DEG degrees every STEP_DELAY_MS milliseconds.
 * Smaller STEP_DEG or larger STEP_DELAY_MS = slower.
 */
#define STEP_DEG         3
#define STEP_DELAY_MS    20

/* ---- Globals ---------------------------------------------------------- */

TIM_HandleTypeDef htim2;

/* ---- Prototypes ------------------------------------------------------- */

void              SystemClock_Config(void);
void              Error_Handler(void);
static void       MX_GPIO_Init(void);
static void       MX_TIM2_Init(void);
static void       Servo_SetAngle(uint32_t ch, uint8_t deg);


/* ========================================================================== */
/*  main                                                                      */
/* ========================================================================== */

int main(void)
{
  int d;

  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_TIM2_Init();

  /* Start PWM output on channel 3 (PB10) and channel 4 (PB11) */
  HAL_TIM_PWM_Start(&htim2, TIM_CHANNEL_3);
  HAL_TIM_PWM_Start(&htim2, TIM_CHANNEL_4);

  /* Park both servos at 90 degrees */
  Servo_SetAngle(TIM_CHANNEL_3, 90);
  Servo_SetAngle(TIM_CHANNEL_4, 90);
  HAL_Delay(500);

  while (1)
  {
    /* Forward sweep: 0 -> 180 degrees */
    for (d = 0; d <= 180; d += STEP_DEG)
    {
      Servo_SetAngle(TIM_CHANNEL_3, (uint8_t)d);
      Servo_SetAngle(TIM_CHANNEL_4, (uint8_t)d);
      HAL_Delay(STEP_DELAY_MS);
    }

    HAL_Delay(300);

    /* Backward sweep: 180 -> 0 degrees */
    for (d = 180; d >= 0; d -= STEP_DEG)
    {
      Servo_SetAngle(TIM_CHANNEL_3, (uint8_t)d);
      Servo_SetAngle(TIM_CHANNEL_4, (uint8_t)d);
      HAL_Delay(STEP_DELAY_MS);
    }

    HAL_Delay(300);
  }
}


/* ========================================================================== */
/*  Servo helper                                                              */
/* ========================================================================== */

/* Map 0..180 degrees onto SERVO_MIN_US..SERVO_MAX_US and write the CCR.
 *
 * TIM2 runs at 1 MHz (1 tick = 1 microsecond), so the compare value
 * is simply the pulse width in microseconds.
 */
static void Servo_SetAngle(uint32_t ch, uint8_t deg)
{
  uint32_t us;

  if (deg > 180)
  {
    deg = 180;
  }

  us = SERVO_MIN_US + ((uint32_t)deg * (SERVO_MAX_US - SERVO_MIN_US)) / 180U;

  __HAL_TIM_SET_COMPARE(&htim2, ch, us);
}


/* ========================================================================== */
/*  System clock:  8 MHz HSE  x9 PLL  =  72 MHz                               */
/* ========================================================================== */

void SystemClock_Config(void)
{
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

  RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSE;
  RCC_OscInitStruct.HSEState       = RCC_HSE_ON;
  RCC_OscInitStruct.HSEPredivValue = RCC_HSE_PREDIV_DIV1;
  RCC_OscInitStruct.HSIState       = RCC_HSI_ON;
  RCC_OscInitStruct.PLL.PLLState   = RCC_PLL_ON;
  RCC_OscInitStruct.PLL.PLLSource  = RCC_PLLSOURCE_HSE;
  RCC_OscInitStruct.PLL.PLLMUL     = RCC_PLL_MUL9;

  if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
  {
    Error_Handler();
  }

  RCC_ClkInitStruct.ClockType      = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK
                                   | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
  RCC_ClkInitStruct.SYSCLKSource   = RCC_SYSCLKSOURCE_PLLCLK;
  RCC_ClkInitStruct.AHBCLKDivider  = RCC_SYSCLK_DIV1;
  RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV2;   /* APB1 = 36MHz, timer x2 = 72MHz */
  RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV1;

  if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_2) != HAL_OK)
  {
    Error_Handler();
  }
}


/* ========================================================================== */
/*  GPIO init:  PB10 / PB11 as alternate-function push-pull                   */
/* ========================================================================== */

static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef GPIO_InitStruct = {0};

  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();
  __HAL_RCC_AFIO_CLK_ENABLE();

  /* ---------------------------------------------------------------------
   * TIM2 remap - THIS IS MANDATORY.
   *
   * TIM2 channel 3 and 4 come out on PA2 / PA3 by default. To get them on
   * PB10 / PB11 you must select the partial remap, otherwise PB10 / PB11
   * output nothing at all and the servos sit still.
   *
   * CubeMX normally emits this line itself, but this file replaces
   * MX_GPIO_Init() with its own copy, so it has to be here by hand.
   * ------------------------------------------------------------------ */
  __HAL_AFIO_REMAP_TIM2_PARTIAL_2();

  GPIO_InitStruct.Pin   = GPIO_PIN_10 | GPIO_PIN_11;
  GPIO_InitStruct.Mode  = GPIO_MODE_AF_PP;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
  HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);
}


/* ========================================================================== */
/*  TIM2 init:  50 Hz PWM on CH3 and CH4                                      */
/* ========================================================================== */

static void MX_TIM2_Init(void)
{
  TIM_ClockConfigTypeDef  sClockSourceConfig = {0};
  TIM_MasterConfigTypeDef sMasterConfig      = {0};
  TIM_OC_InitTypeDef      sConfigOC          = {0};

  __HAL_RCC_TIM2_CLK_ENABLE();

  htim2.Instance               = TIM2;
  htim2.Init.Prescaler         = 71;      /* 72 MHz / 72 = 1 MHz -> 1 tick = 1 us */
  htim2.Init.CounterMode       = TIM_COUNTERMODE_UP;
  htim2.Init.Period            = 19999;   /* 20000 us = 20 ms = 50 Hz */
  htim2.Init.ClockDivision     = TIM_CLOCKDIVISION_DIV1;
  htim2.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;

  if (HAL_TIM_Base_Init(&htim2) != HAL_OK)
  {
    Error_Handler();
  }

  sClockSourceConfig.ClockSource = TIM_CLOCKSOURCE_INTERNAL;
  if (HAL_TIM_ConfigClockSource(&htim2, &sClockSourceConfig) != HAL_OK)
  {
    Error_Handler();
  }

  if (HAL_TIM_PWM_Init(&htim2) != HAL_OK)
  {
    Error_Handler();
  }

  sMasterConfig.MasterOutputTrigger = TIM_TRGO_RESET;
  sMasterConfig.MasterSlaveMode     = TIM_MASTERSLAVEMODE_DISABLE;
  if (HAL_TIMEx_MasterConfigSynchronization(&htim2, &sMasterConfig) != HAL_OK)
  {
    Error_Handler();
  }

  sConfigOC.OCMode     = TIM_OCMODE_PWM1;
  sConfigOC.Pulse      = 1500;            /* 1500 us = 90 degrees at startup */
  sConfigOC.OCPolarity = TIM_OCPOLARITY_HIGH;
  sConfigOC.OCFastMode = TIM_OCFAST_DISABLE;

  if (HAL_TIM_PWM_ConfigChannel(&htim2, &sConfigOC, TIM_CHANNEL_3) != HAL_OK)
  {
    Error_Handler();
  }

  if (HAL_TIM_PWM_ConfigChannel(&htim2, &sConfigOC, TIM_CHANNEL_4) != HAL_OK)
  {
    Error_Handler();
  }
}


/* ========================================================================== */
/*  Error handler                                                             */
/* ========================================================================== */

void Error_Handler(void)
{
  __disable_irq();

  while (1)
  {
    /* Stay here. Attach a debugger to see what happened. */
  }
}
