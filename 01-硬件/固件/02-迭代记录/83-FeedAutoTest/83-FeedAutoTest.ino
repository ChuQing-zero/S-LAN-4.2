/* ============================================================================
 *  83-FeedAutoTest  ——  料仓缺卡自动停料 + 板载按键手动进料（Arduino Nano）
 * ----------------------------------------------------------------------------
 *  日期：2026-11-04
 *
 *  两个功能：
 *   ① 自动判定：料仓光敏（A7）读数 < 阈值 → 有卡；>= 阈值 → 空仓
 *               空仓时强制停止进料并蜂鸣一声
 *   ② 手动按键：
 *        BTN1（D3）按一下 → 推一张卡（电机转 PUSH_MS 毫秒自停）
 *        BTN2（D6）按住   → 一直转，松开就停（连续送料）
 *        空仓时按键无效，会串口提示 + 鸣一声
 *
 *  接线（与整机一致，不用改线）：
 *      料仓光敏 A7
 *      进料电机 ENA=D7  IN1=D8  IN2=D9
 *      蜂鸣器 D11
 *      按键1 D3  按键2 D6（另一端接 GND，用内部上拉）
 *
 *  串口：115200，每 200ms 打印一行
 *      [料仓] LDR= 98  状态=有卡  电机=STOP  推卡=0  切换=0
 * ========================================================================== */

/* ------------------------------ CONFIG ---------------------------------- */
#define PIN_LDR         A7
#define PIN_MOTOR_ENA   7       /* D7 */
#define PIN_MOTOR_IN1   8       /* D8 */
#define PIN_MOTOR_IN2   9       /* D9 */
#define PIN_BUZZER      11      /* D11 */
#define PIN_BTN1        3       /* D3  按一下 = 推一张卡 */
#define PIN_BTN2        6       /* D6  按住   = 连续进料 */

#define LDR_TH          300     /* 缺卡阈值：低于它=有卡，高于它=空仓 */
#define MOTOR_PWM       150     /* 进料电机 PWM 0~255（实测 100 带不动，150 能转） */
#define LOOP_MS         200     /* 主循环采样周期 */
#define HYST            30      /* 迟滞：阈值上下各留 30，防抖动 */
#define PUSH_MS         600     /* 「推一张卡」电机转多久 */
#define DEBOUNCE_MS     30      /* 按键消抖 */
#define BTN_ACTIVE_LOW  1       /* 1=按下接地(INPUT_PULLUP)；0=按下接高电平 */
#define BEEP_ON_EMPTY   1       /* 空仓响一声 */
#define BEEP_ON_PUSH    1       /* 推卡时响一声 */

/* ------------------------------------------------------------------------ */

static uint8_t  g_feeding   = 0;      /* 1 = 电机在转 */
static uint8_t  g_hasCard   = 1;      /* 1 = 料仓有卡 */
static uint16_t g_switches  = 0;      /* 料仓状态切换次数 */
static uint16_t g_pushed    = 0;      /* 推卡次数 */

static uint32_t g_tLast     = 0;      /* 主循环节拍 */
static uint32_t g_pushEnd   = 0;      /* 推卡定时结束时刻（0=无） */

static uint8_t  g_b1Prev    = 1;      /* 1 = 松开 */
static uint32_t g_b1Change  = 0;
static uint8_t  g_b2Prev    = 1;
static uint32_t g_b2Change  = 0;


static void motor(uint8_t on, uint8_t dir, uint8_t pwm)
{
  if (!on)
  {
    analogWrite(PIN_MOTOR_ENA, 0);
    digitalWrite(PIN_MOTOR_IN1, LOW);
    digitalWrite(PIN_MOTOR_IN2, LOW);
    return;
  }
  analogWrite(PIN_MOTOR_ENA, pwm);
  if (dir) { digitalWrite(PIN_MOTOR_IN1, HIGH); digitalWrite(PIN_MOTOR_IN2, LOW);  }
  else     { digitalWrite(PIN_MOTOR_IN1, LOW);  digitalWrite(PIN_MOTOR_IN2, HIGH); }
}


static void feed_on(void)
{
  motor(1, 1, MOTOR_PWM);
  g_feeding = 1;
  Serial.println(F("[料仓] 电机=ON"));
}


static void feed_off(void)
{
  motor(0, 1, 0);
  g_feeding = 0;
  Serial.println(F("[料仓] 电机=OFF"));
}


/* 按键电平还原：1 = 松开，0 = 按下 */
static uint8_t btn_read(uint8_t pin)
{
  uint8_t v = digitalRead(pin) ? 1 : 0;
  return BTN_ACTIVE_LOW ? (uint8_t)(!v) : v;
}


void setup()
{
  Serial.begin(115200);

  pinMode(PIN_MOTOR_ENA, OUTPUT);
  pinMode(PIN_MOTOR_IN1, OUTPUT);
  pinMode(PIN_MOTOR_IN2, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_BTN1, INPUT_PULLUP);
  pinMode(PIN_BTN2, INPUT_PULLUP);

  motor(0, 1, 0);
  g_feeding = 0;

  Serial.println();
  Serial.println(F("================================================"));
  Serial.println(F(" 83-FeedAutoTest  缺卡自动停料 + 按键手动进料"));
  Serial.println(F("------------------------------------------------"));
  Serial.print(F(" 光敏 A7  阈值 "));
  Serial.print(LDR_TH);
  Serial.print(F("  迟滞 +-"));
  Serial.println(HYST);
  Serial.print(F(" 电机 PWM "));
  Serial.print(MOTOR_PWM);
  Serial.print(F("  推卡 "));
  Serial.print(PUSH_MS);
  Serial.println(F(" ms"));
  Serial.println(F(" 按键1(D3) 按一下 = 推一张卡"));
  Serial.println(F(" 按键2(D6) 按住   = 连续进料，松开停"));
  Serial.println(F("================================================"));
  Serial.println();

  int raw = analogRead(PIN_LDR);
  g_hasCard = (raw < LDR_TH) ? 1 : 0;
  Serial.print(F("[料仓] 初始 LDR="));
  Serial.print(raw);
  Serial.print(F("  状态="));
  Serial.println(g_hasCard ? F("有卡") : F("空仓"));

  g_b1Prev = btn_read(PIN_BTN1);
  g_b2Prev = btn_read(PIN_BTN2);
}


void loop()
{
  uint32_t now = millis();

  /* ================= 1) 按键处理 ================= */
  uint8_t b1 = btn_read(PIN_BTN1);
  uint8_t b2 = btn_read(PIN_BTN2);

  if (b1 != g_b1Prev) g_b1Change = now;
  if (b2 != g_b2Prev) g_b2Change = now;

  /* BTN1 按下沿（已消抖）→ 推一张卡 */
  if (b1 == 0 && g_b1Prev == 1 && (now - g_b1Change) >= DEBOUNCE_MS)
  {
    if (!g_hasCard)
    {
      Serial.println(F("[按键] 空仓，按键无效"));
      #if BEEP_ON_EMPTY
      tone(PIN_BUZZER, 800, 150);
      #endif
    }
    else
    {
      g_pushEnd = now + PUSH_MS;
      if (!g_feeding) feed_on();
      g_pushed++;
      Serial.print(F("[按键] 推一张卡  #"));
      Serial.println(g_pushed);
      #if BEEP_ON_PUSH
      tone(PIN_BUZZER, 2500, 60);
      #endif
    }
  }

  /* BTN2 按下沿（已消抖）→ 连续进料开始 */
  if (b2 == 0 && g_b2Prev == 1 && (now - g_b2Change) >= DEBOUNCE_MS)
  {
    if (g_hasCard)
    {
      g_pushEnd = 0;
      if (!g_feeding) feed_on();
      Serial.println(F("[按键] 连续进料 开始"));
    }
    else
    {
      Serial.println(F("[按键] 空仓，无法连续进料"));
    }
  }
  /* BTN2 松开沿 → 连续进料结束 */
  if (b2 == 1 && g_b2Prev == 0 && (now - g_b2Change) >= DEBOUNCE_MS)
  {
    if (g_feeding) feed_off();
    Serial.println(F("[按键] 连续进料 结束"));
  }

  g_b1Prev = b1;
  g_b2Prev = b2;

  /* 推一张卡的定时结束 */
  if (g_pushEnd && (int32_t)(now - g_pushEnd) >= 0)
  {
    g_pushEnd = 0;
    if (g_feeding) feed_off();
  }

  /* ================= 2) 光敏判定（带迟滞） ================= */
  if (now - g_tLast >= LOOP_MS)
  {
    g_tLast = now;

    int raw = analogRead(PIN_LDR);
    uint8_t prev = g_hasCard;
    if (raw < (LDR_TH - HYST))      g_hasCard = 1;   /* 变暗 → 有卡 */
    else if (raw > (LDR_TH + HYST)) g_hasCard = 0;   /* 变亮 → 空仓 */

    if (g_hasCard != prev)
    {
      g_switches++;
      Serial.print(F("[料仓] 状态切换 → "));
      Serial.print(g_hasCard ? F("有卡") : F("空仓"));
      Serial.print(F("   LDR="));
      Serial.print(raw);
      Serial.print(F("   累计="));
      Serial.println(g_switches);
    }

    /* 空仓：强制停止，取消推卡 */
    if (!g_hasCard)
    {
      if (g_feeding)
      {
        feed_off();
        #if BEEP_ON_EMPTY
        tone(PIN_BUZZER, 2000, 120);
        #endif
      }
      g_pushEnd = 0;
    }

    /* 每周期打印一行 */
    Serial.print(F("[料仓] LDR="));
    if (raw < 100) Serial.print(' ');
    if (raw < 10)  Serial.print(' ');
    Serial.print(raw);
    Serial.print(F("  状态="));
    Serial.print(g_hasCard ? F("有卡") : F("空仓"));
    Serial.print(F("  电机="));
    Serial.print(g_feeding ? F("RUN") : F("STOP"));
    Serial.print(F("  推卡="));
    Serial.print(g_pushed);
    Serial.print(F("  切换="));
    Serial.println(g_switches);
  }
}
