/* ============================================================================
 *  S-LAN V4.0  单元板 —— 面包板测试程序
 *  目标芯片：STM32F103C8T6（蓝 pill 最小系统板）
 *  开发环境：STM32CubeMX + Keil MDK-ARM 5
 *  日期：2026-09-21
 *
 *  【怎么用】
 *  1. 先用 STM32CubeMX 建工程（配置见同目录 README.md）
 *  2. CubeMX 生成 Keil 工程并打开
 *  3. 把下面每一段，填进 main.c 里对应的
 *         /* USER CODE BEGIN xxx *  /  /* USER CODE END xxx *
 *     区域中间。★ 不要整个替换 main.c ★
 *     （SystemClock_Config / MX_xxx_Init 那些都是 CubeMX 生成的，替换掉就废了）
 *  4. Keil 里勾上 Use MicroLIB，编译下载
 * ============================================================================
 */

/* ==========================================================================
 * 【第 1 段】找到  /* USER CODE BEGIN Includes */  把下面填进去
 * ========================================================================== */
    #include <stdio.h>

/* ==========================================================================
 * 【第 2 段】找到  /* USER CODE BEGIN PD */  把下面填进去
 * ========================================================================== */

/* ---- 选择要跑哪个测试 ----
 *  1 = 限位开关 + 光敏        ← 先跑这个（舵机先不接）
 *  2 = 舵机扫描              ← 用来实测舵机有效转角
 *  3 = 综合：限位触发 → 舵机抬起
 */
#define TEST_MODE        1

/* ---- 光敏判定阈值（单位 mV）----
 * 实测参考：挡住光 < 150mV，有光 800~2500mV
 */
#define PHOTO_CARD_MV    400

/* ---- 舵机脉宽范围（单位 微秒）----
 * MG90S：500us ≈ 0°，1500us ≈ 90°，2500us ≈ 180°
 */
#define SERVO_MIN_US     500
#define SERVO_MAX_US     2500

/* 本项目实际需要 114.6°，先按 115° 试 */
#define SERVO_SAFE_DEG   115


/* ==========================================================================
 * 【第 3 段】找到  /* USER CODE BEGIN PFP */  把下面填进去
 * ========================================================================== */
static uint8_t  Limit_Triggered(uint16_t pin);
static uint16_t Photo_ReadMV(void);
static void     Servo_SetPulse(uint32_t ch, uint16_t pulse_us);
static void     Servo_SetAngle(uint32_t ch, uint8_t deg);


/* ==========================================================================
 * 【第 4 段】找到  /* USER CODE BEGIN 0 */  把下面填进去
 * ========================================================================== */

/* ---- printf 重定向到串口 1 ----
 * ⚠️ Keil 里必须勾：Options for Target → Target → Use MicroLIB
 *    不勾的话 printf 没有任何输出（而且不报错）
 */
int fputc(int ch, FILE *f)
{
    HAL_UART_Transmit(&huart1, (uint8_t *)&ch, 1, 0xFFFF);
    return ch;
}

/* ---- 限位开关 ----
 * NC 接 GND + 内部上拉：
 *   开关没按   → NC 闭合到 GND → 读到 低(0)  → 未触发
 *   开关按下   → NC 断开       → 读到 高(1)  → 触发
 *   线掉了     → 也读到 高(1)  → 触发（安全）
 */
static uint8_t Limit_Triggered(uint16_t pin)
{
    return (HAL_GPIO_ReadPin(GPIOB, pin) == GPIO_PIN_SET) ? 1 : 0;
}

/* ---- 光敏：返回分压中点电压，单位 mV ---- */
static uint16_t Photo_ReadMV(void)
{
    uint32_t raw;

    HAL_ADC_Start(&hadc1);
    if (HAL_ADC_PollForConversion(&hadc1, 20) != HAL_OK)
    {
        HAL_ADC_Stop(&hadc1);
        return 0xFFFF;                      /* 读失败 */
    }
    raw = HAL_ADC_GetValue(&hadc1);
    HAL_ADC_Stop(&hadc1);

    /* 12 位 ADC，参考电压 3.3V=3300mV */
    return (uint16_t)((raw * 3300UL) / 4095UL);
}

/* ---- 舵机：直接给脉宽（微秒）---- */
static void Servo_SetPulse(uint32_t ch, uint16_t pulse_us)
{
    if (pulse_us < SERVO_MIN_US) pulse_us = SERVO_MIN_US;
    if (pulse_us > SERVO_MAX_US) pulse_us = SERVO_MAX_US;
    __HAL_TIM_SET_COMPARE(&htim2, ch, pulse_us);
}

/* ---- 舵机：给角度（0~180 度）---- */
static void Servo_SetAngle(uint32_t ch, uint8_t deg)
{
    uint32_t us;

    if (deg > 180) deg = 180;
    us = SERVO_MIN_US + ((uint32_t)deg * (SERVO_MAX_US - SERVO_MIN_US)) / 180U;
    Servo_SetPulse(ch, (uint16_t)us);
}


/* ==========================================================================
 * 【第 5 段】找到  /* USER CODE BEGIN 2 */
 *          （在 MX_xxx_Init() 全部调用完之后）
 * ========================================================================== */

    /* 启动两路舵机 PWM，先停在 90° */
    HAL_TIM_PWM_Start(&htim2, TIM_CHANNEL_3);
    HAL_TIM_PWM_Start(&htim2, TIM_CHANNEL_4);
    Servo_SetPulse(TIM_CHANNEL_3, 1500);
    Servo_SetPulse(TIM_CHANNEL_4, 1500);

    HAL_Delay(300);

    printf("\r\n");
    printf("========================================\r\n");
    printf("  S-LAN V4.0  单元板测试   TEST_MODE=%d\r\n", TEST_MODE);
    printf("========================================\r\n");


/* ==========================================================================
 * 【第 6 段】找到  /* USER CODE BEGIN WHILE */
 *          （在 while (1) { 的下一行）
 * ========================================================================== */

#if TEST_MODE == 1

        /* ========== 测试 1：限位开关 + 光敏 ========== */
        {
            uint16_t mv = Photo_ReadMV();

            printf("限位1=%d  限位2=%d  |  光敏 %4u mV  %s\r\n",
                   Limit_Triggered(GPIO_PIN_9),
                   Limit_Triggered(GPIO_PIN_5),
                   mv,
                   (mv < PHOTO_CARD_MV) ? "【有卡】" : "  无卡 ");

            HAL_Delay(500);
        }

#elif TEST_MODE == 2

        /* ========== 测试 2：舵机扫描（测有效转角）==========
         * 眼睛盯着舵机臂：
         *   打印的角度还在涨，但臂已经不动了 → 那个角度就是它的真实上限
         *   想要更细，把 15 改成 5
         */
        {
            int d;

            printf("-- 正向 0 → 180 --\r\n");
            for (d = 0; d <= 180; d += 15)
            {
                Servo_SetAngle(TIM_CHANNEL_3, (uint8_t)d);
                Servo_SetAngle(TIM_CHANNEL_4, (uint8_t)(180 - d));
                printf("命令角度 = %3d 度\r\n", d);
                HAL_Delay(1000);
            }

            HAL_Delay(1000);

            printf("-- 反向 180 → 0 --\r\n");
            for (d = 180; d >= 0; d -= 15)
            {
                Servo_SetAngle(TIM_CHANNEL_3, (uint8_t)d);
                Servo_SetAngle(TIM_CHANNEL_4, (uint8_t)(180 - d));
                printf("命令角度 = %3d 度\r\n", d);
                HAL_Delay(1000);
            }
        }

#elif TEST_MODE == 3

        /* ========== 测试 3：综合 ==========
         * 限位 1 按下 → 两路舵机抬到 115° + 限位灯亮
         * 松开        → 回 0°              + 限位灯灭
         */
        {
            uint8_t  t1   = Limit_Triggered(GPIO_PIN_9);
            uint16_t mv   = Photo_ReadMV();
            uint8_t  card = (mv < PHOTO_CARD_MV) ? 1 : 0;

            /* 舵机 */
            Servo_SetAngle(TIM_CHANNEL_3, t1 ? SERVO_SAFE_DEG : 0);
            Servo_SetAngle(TIM_CHANNEL_4, t1 ? SERVO_SAFE_DEG : 0);

            /* 指示灯 */
            HAL_GPIO_WritePin(GPIOB, GPIO_PIN_14, t1   ? GPIO_PIN_SET : GPIO_PIN_RESET);
            HAL_GPIO_WritePin(GPIOB, GPIO_PIN_15, t1   ? GPIO_PIN_SET : GPIO_PIN_RESET);
            HAL_GPIO_WritePin(GPIOA, GPIO_PIN_11, card ? GPIO_PIN_SET : GPIO_PIN_RESET);
            HAL_GPIO_WritePin(GPIOA, GPIO_PIN_12, GPIO_PIN_RESET);

            printf("限位1=%d  光敏=%4u mV  %s\r\n",
                   t1, mv, card ? "【有卡】" : "  无卡 ");

            HAL_Delay(100);
        }

#endif

/* ============================================================================
 *  段落到此结束
 * ============================================================================
 */
