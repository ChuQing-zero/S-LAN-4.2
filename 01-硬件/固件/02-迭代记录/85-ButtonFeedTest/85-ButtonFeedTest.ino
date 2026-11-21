/* ============================================================================
 *  85-ButtonFeedTest  ——  两个按钮 + 串口指令  测单张进料（Arduino Nano）
 * ----------------------------------------------------------------------------
 *  日期：2026-11-05
 *
 *  一、两个按键（一直有效，不像 82 那样被"主机在线"门控住）
 *    【BTN1 = D3】按一下 → 单张进料
 *        电机转 → 盯着光敏 → 读数降到阈值以下（卡牌遮住）→ 立刻停、计数+1、鸣一声
 *        超时没遮住 → 停 + 鸣两声
 *    【BTN2 = D6】按一下 → 重新学光敏阈值
 *                按住 1.5 秒 → 计数清零
 *
 *  二、串口指令（115200，行尾「新行」或「NL+CR」都行）
 *    ?            帮助
 *    i            查看当前参数与状态
 *    r            读一次光敏当前值
 *    c            单张进料（闭环，同 BTN1）
 *    s            连续进料（一直转，直到 t）
 *    t            停电机
 *    l            重新学基线（要求光敏露光、没卡）
 *    p<数字>      设转速 PWM      例：p150   （0~255）
 *    h<数字>      设遮挡阈值      例：h560
 *    u<数字>      设阈值比例(%)   例：u75    （阈值 = 基线 × 0.75）
 *    m<数字>      设单张超时 ms   例：m3000
 *    z            计数清零
 *
 *  三、自动学习
 *    上电采 20 帧取中位数作为亮态基线，阈值 = 基线 × LDR_RATIO。
 *
 *  接线：光敏 A7 ／ 电机 ENA=D7 IN1=D8 IN2=D9 ／ 蜂鸣器 D11 ／ 按键 D3、D6（另一端接GND）
 * ========================================================================== */

/* ------------------------------ CONFIG ---------------------------------- */
#define PIN_LDR         A7
#define PIN_MOTOR_ENA   7
#define PIN_MOTOR_IN1   8
#define PIN_MOTOR_IN2   9
#define PIN_BUZZER      11
#define PIN_BTN1        3
#define PIN_BTN2        6

#define MOTOR_PWM_INI   200     /* 初始转速 0~255 */
#define LDR_RATIO_INI   0.75    /* 初始阈值比例 */
#define PUSH_MAX_MS_INI 3000    /* 初始单张超时 */
#define MIN_RUN_MS      120     /* 刚启动这段时间不判定 */
#define LEARN_N         20
#define LEARN_GAP_MS    15
#define SAMPLE_MS       20
#define PRINT_MS        500     /* 状态行打印周期 */
#define DEBOUNCE_MS     30
#define LONG_PRESS_MS   1500
#define BTN_ACTIVE_LOW  1
#define DARK_MEANS_CARD 1
#define CMD_BUF         40

/* ------------------------------------------------------------------------ */

static int      g_base      = 0;
static int      g_th        = 0;
static bool     g_thManual  = false;   /* 手动设过阈值，学习时不覆盖 */
static int      g_cur       = 0;
static int      g_pwm       = MOTOR_PWM_INI;
static float    g_ratio     = LDR_RATIO_INI;
static uint32_t g_maxMs     = PUSH_MAX_MS_INI;

static bool     g_feeding   = false;
static bool     g_continuous= false;
static uint32_t g_pushStart = 0;
static uint16_t g_count     = 0;

static uint8_t  g_b1Prev = 1, g_b2Prev = 1;
static uint32_t g_b1Change = 0, g_b2Change = 0, g_b2Down = 0;
static bool     g_b2LongDone = false;

static uint32_t g_tSample = 0, g_tPrint = 0;

static char     g_cmd[CMD_BUF];
static uint8_t  g_cmdLen = 0;


/* ---------------------------- 基础 ---------------------------- */
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

static uint8_t btn_read(uint8_t pin)
{
  uint8_t v = digitalRead(pin) ? 1 : 0;
  return BTN_ACTIVE_LOW ? (uint8_t)(!v) : v;
}

static bool is_blocked(int v)
{
#if DARK_MEANS_CARD
  return v < g_th;
#else
  return v > g_th;
#endif
}

static void recompute_th(void)
{
#if DARK_MEANS_CARD
  g_th = (int)(g_base * g_ratio);
#else
  g_th = (int)(g_base / g_ratio);
#endif
}

static void print_params(void)
{
  Serial.println(F("---------- 当前参数 ----------"));
  Serial.print(F("  转速 PWM   : ")); Serial.println(g_pwm);
  Serial.print(F("  亮态基线   : ")); Serial.println(g_base);
  Serial.print(F("  遮挡阈值   : ")); Serial.print(g_th);
  Serial.println(g_thManual ? F("   (手动设定)") : F("   (基线×比例)"));
  Serial.print(F("  阈值比例   : ")); Serial.println(g_ratio, 2);
  Serial.print(F("  单张超时   : ")); Serial.print(g_maxMs); Serial.println(F(" ms"));
  Serial.print(F("  当前读数   : ")); Serial.print(g_cur);
  Serial.println(is_blocked(g_cur) ? F("   [已遮挡]") : F("   [亮]"));
  Serial.print(F("  电机       : "));
  if (g_continuous)   Serial.println(F("RUN (连续)"));
  else                Serial.println(g_feeding ? F("RUN (单张)") : F("STOP"));
  Serial.print(F("  计数       : ")); Serial.println(g_count);
  Serial.println(F("------------------------------"));
}

static void print_help(void)
{
  Serial.println(F("========== 指令表 =========="));
  Serial.println(F("  ?      本帮助"));
  Serial.println(F("  i      查看当前参数/阈值/读数"));
  Serial.println(F("  r      读一次光敏当前值"));
  Serial.println(F("  c      单张进料（闭环，同 BTN1）"));
  Serial.println(F("  s      连续进料（一直转）"));
  Serial.println(F("  t      停电机"));
  Serial.println(F("  l      重新学基线（需露光无卡）"));
  Serial.println(F("  p<数字>  设转速 PWM     例 p150"));
  Serial.println(F("  h<数字>  设遮挡阈值     例 h560"));
  Serial.println(F("  u<数字>  设阈值比例(%)  例 u75"));
  Serial.println(F("  m<数字>  设单张超时 ms  例 m3000"));
  Serial.println(F("  z      计数清零"));
  Serial.println(F("============================"));
}


/* ---------------------------- 学基线 ---------------------------- */
static bool learn_base(void)
{
  int buf[LEARN_N];
  int n = 0;

  Serial.println(F("[学习] 采集中，请确保光敏露光、没有卡..."));
  for (int i = 0; i < LEARN_N; i++)
  {
    buf[n++] = analogRead(PIN_LDR);
    delay(LEARN_GAP_MS);
  }

  for (int i = 1; i < n; i++)
  {
    int key = buf[i], j = i - 1;
    while (j >= 0 && buf[j] > key) { buf[j + 1] = buf[j]; j--; }
    buf[j + 1] = key;
  }

  int med = buf[n / 2];
  if (med <= 5)
  {
    Serial.print(F("[学习] 基线异常（="));
    Serial.print(med);
    Serial.println(F("），检查光敏接线或补光灯"));
    return false;
  }

  g_base = med;
  if (!g_thManual) recompute_th();

  Serial.print(F("[学习] 基线="));
  Serial.print(g_base);
  Serial.print(F("  阈值="));
  Serial.print(g_th);
  if (g_thManual) Serial.print(F("（手动阈值保持不变）"));
  Serial.println();
  tone(PIN_BUZZER, 2000, 80);
  return true;
}


/* ---------------------------- 进料 ---------------------------- */
static void start_single(void)
{
  if (g_continuous) { Serial.println(F("[推卡] 连续进料中，先发 t 停")); return; }
  if (g_feeding)    { Serial.println(F("[推卡] 正在推，忽略")); return; }

  int v = analogRead(PIN_LDR);
  g_cur = v;
  if (is_blocked(v))
  {
    Serial.print(F("[推卡] 光敏已被遮住（读数 "));
    Serial.print(v);
    Serial.print(F(" < 阈值 "));
    Serial.print(g_th);
    Serial.println(F("），请先移开卡牌"));
    tone(PIN_BUZZER, 800, 200);
    return;
  }

  Serial.print(F("[推卡] 开始 PWM="));
  Serial.print(g_pwm);
  Serial.print(F("  读数="));
  Serial.print(v);
  Serial.print(F("  阈值="));
  Serial.println(g_th);

  motor(1, 1, (uint8_t)g_pwm);
  g_feeding = true;
  g_pushStart = millis();
}

static void finish_single(bool success)
{
  motor(0, 1, 0);
  g_feeding = false;
  uint32_t el = millis() - g_pushStart;

  if (success)
  {
    g_count++;
    Serial.print(F("[推卡] OK 卡牌遮挡光敏！用时 "));
    Serial.print(el);
    Serial.print(F(" ms  计数="));
    Serial.println(g_count);
    tone(PIN_BUZZER, 2500, 80);
  }
  else
  {
    Serial.print(F("[推卡] 超时 "));
    Serial.print(el);
    Serial.println(F(" ms 未遮挡，已停"));
    tone(PIN_BUZZER, 700, 150);
    delay(100);
    tone(PIN_BUZZER, 700, 150);
  }
}

static void start_continuous(void)
{
  if (g_continuous) { Serial.println(F("[连续] 已经在转")); return; }
  if (g_feeding)    { Serial.println(F("[连续] 单张进料中，稍后")); return; }
  motor(1, 1, (uint8_t)g_pwm);
  g_continuous = true;
  Serial.print(F("[连续] 开始 PWM="));
  Serial.println(g_pwm);
}

static void stop_all(void)
{
  motor(0, 1, 0);
  if (g_feeding || g_continuous) Serial.println(F("[电机] 已停"));
  g_feeding = false;
  g_continuous = false;
}

static void poll_feeding(void)
{
  if (!g_feeding) return;

  int v = analogRead(PIN_LDR);
  g_cur = v;
  uint32_t el = millis() - g_pushStart;

  if (el >= MIN_RUN_MS && is_blocked(v)) { finish_single(true);  return; }
  if (el >= g_maxMs)                     { finish_single(false); return; }
}


/* ---------------------------- 串口指令 ---------------------------- */
static void handle_command(char *s)
{
  while (*s == ' ' || *s == '\t') s++;
  int L = (int)strlen(s);
  while (L > 0 && (s[L - 1] == '\r' || s[L - 1] == ' ' || s[L - 1] == '\t')) s[--L] = 0;
  if (L == 0) return;

  char c = s[0];
  long val = atol(s + 1);

  switch (c)
  {
    case '?': print_help(); return;
    case 'i': g_cur = analogRead(PIN_LDR); print_params(); return;
    case 'r':
      g_cur = analogRead(PIN_LDR);
      Serial.print(F("[光敏] 读数="));
      Serial.print(g_cur);
      Serial.print(F("  基线="));
      Serial.print(g_base);
      Serial.print(F("  阈值="));
      Serial.print(g_th);
      Serial.print(F("  状态="));
      Serial.println(is_blocked(g_cur) ? F("已遮挡") : F("亮"));
      return;
    case 'c': start_single(); return;
    case 's': start_continuous(); return;
    case 't': stop_all(); return;
    case 'l':
      if (g_feeding || g_continuous) { Serial.println(F("[学习] 电机在转，先发 t")); return; }
      learn_base();
      return;
    case 'z':
      g_count = 0;
      Serial.println(F("[计数] 已清零"));
      return;
    case 'p':
      if (val >= 0 && val <= 255)
      {
        g_pwm = (int)val;
        Serial.print(F("[设置] 转速 PWM = "));
        Serial.println(g_pwm);
        if (g_continuous) { motor(1, 1, (uint8_t)g_pwm); Serial.println(F("[设置] 已在转，速度已生效")); }
      }
      else Serial.println(F("[错误] PWM 范围 0~255，例：p150"));
      return;
    case 'h':
      if (val > 0 && val < 4096)
      {
        g_th = (int)val;
        g_thManual = true;
        Serial.print(F("[设置] 遮挡阈值 = "));
        Serial.print(g_th);
        Serial.println(F("（手动设定，学基线不会覆盖）"));
      }
      else Serial.println(F("[错误] 阈值范围 1~4095，例：h560"));
      return;
    case 'u':
      if (val >= 10 && val <= 99)
      {
        g_ratio = val / 100.0;
        g_thManual = false;
        recompute_th();
        Serial.print(F("[设置] 阈值比例 = "));
        Serial.print(g_ratio, 2);
        Serial.print(F("  当前阈值 = "));
        Serial.println(g_th);
      }
      else Serial.println(F("[错误] 比例用百分数 10~99，例：u75"));
      return;
    case 'm':
      if (val >= 200 && val <= 30000)
      {
        g_maxMs = (uint32_t)val;
        Serial.print(F("[设置] 单张超时 = "));
        Serial.print(g_maxMs);
        Serial.println(F(" ms"));
      }
      else Serial.println(F("[错误] 超时 200~30000 ms，例：m3000"));
      return;
    default:
      Serial.print(F("[错误] 不认识的指令："));
      Serial.println(s);
      Serial.println(F("  发 ? 看指令表"));
      return;
  }
}

static void poll_serial(void)
{
  while (Serial.available() > 0)
  {
    char ch = (char)Serial.read();
    if (ch == '\n' || ch == '\r')
    {
      if (g_cmdLen > 0)
      {
        g_cmd[g_cmdLen] = 0;
        handle_command(g_cmd);
        g_cmdLen = 0;
      }
    }
    else if (g_cmdLen < CMD_BUF - 1)
    {
      g_cmd[g_cmdLen++] = ch;
    }
  }
}


/* ---------------------------- setup / loop ---------------------------- */
void setup()
{
  Serial.begin(115200);
  delay(200);

  pinMode(PIN_MOTOR_ENA, OUTPUT);
  pinMode(PIN_MOTOR_IN1, OUTPUT);
  pinMode(PIN_MOTOR_IN2, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_BTN1, INPUT_PULLUP);
  pinMode(PIN_BTN2, INPUT_PULLUP);

  motor(0, 1, 0);

  Serial.println();
  Serial.println(F("=================================================="));
  Serial.println(F(" 85-ButtonFeedTest  按键 + 串口指令 测单张进料"));
  Serial.println(F("--------------------------------------------------"));
  Serial.print(F(" 转速 PWM "));   Serial.print(g_pwm);
  Serial.print(F("   阈值比例 "));  Serial.print(g_ratio, 2);
  Serial.print(F("   超时 "));      Serial.print(g_maxMs);
  Serial.println(F(" ms"));
  Serial.println(F(" BTN1(D3)=单张进料   BTN2(D6)=刷新阈值(长按清计数)"));
  Serial.println(F(" 串口：? 帮助  i 参数  c 推一张  t 停  p150 调速"));
  Serial.println(F("=================================================="));
  Serial.println();

  learn_base();
  print_help();

  g_b1Prev = btn_read(PIN_BTN1);
  g_b2Prev = btn_read(PIN_BTN2);
}


void loop()
{
  uint32_t now = millis();

  /* ---------- 0) 串口指令（随时可改参数） ---------- */
  poll_serial();

  /* ---------- 1) 按键 ---------- */
  uint8_t b1 = btn_read(PIN_BTN1);
  uint8_t b2 = btn_read(PIN_BTN2);

  /* 边沿检测：状态一变就处理（82 的写法，简单可靠） */
  if (b1 != g_b1Prev)
  {
    g_b1Prev = b1;
    if (b1 == 0) start_single();
  }

  if (b2 != g_b2Prev)
  {
    g_b2Prev = b2;
    if (b2 == 0)
    {
      g_b2Down = now;
      g_b2LongDone = false;
    }
    else
    {
      /* 松开：没到长按就是"刷新阈值" */
      if (!g_b2LongDone && g_b2Down)
      {
        if (g_feeding || g_continuous) Serial.println(F("[学习] 电机在转，先发 t"));
        else learn_base();
      }
      g_b2Down = 0;
      g_b2LongDone = false;
    }
  }

  /* BTN2 一直按住 → 1.5 秒后清计数 */
  if (b2 == 0 && !g_b2LongDone && g_b2Down && (now - g_b2Down) >= LONG_PRESS_MS)
  {
    g_b2LongDone = true;
    g_count = 0;
    Serial.println(F("[计数] 已清零（长按 D6）"));
    tone(PIN_BUZZER, 1200, 300);
  }

  /* ---------- 2) 采样 / 判遮挡 ---------- */
  if (now - g_tSample >= SAMPLE_MS)
  {
    g_tSample = now;
    poll_feeding();
    if (!g_feeding) g_cur = analogRead(PIN_LDR);
  }

  /* ---------- 3) 周期状态行 ---------- */
  if (now - g_tPrint >= PRINT_MS)
  {
    g_tPrint = now;
    Serial.print(F("[状态] LDR="));
    if (g_cur < 100) Serial.print(' ');
    if (g_cur < 10)  Serial.print(' ');
    Serial.print(g_cur);
    Serial.print(F(" 阈值="));
    Serial.print(g_th);
    Serial.print(F(" PWM="));
    Serial.print(g_pwm);
    Serial.print(F(" 电机="));
    if (g_continuous)   Serial.print(F("CONT"));
    else if (g_feeding) Serial.print(F("RUN"));
    else                Serial.print(F("STOP"));
    Serial.print(F(" 计数="));
    Serial.println(g_count);
  }
}
