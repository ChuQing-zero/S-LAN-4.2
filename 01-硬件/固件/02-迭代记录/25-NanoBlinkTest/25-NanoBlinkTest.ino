/*
 * ============================================================================
 *  Nano 最小烧录测试 —— 只让 D13 灯闪
 * ============================================================================
 *  用途：验证"能不能把程序烧进去"。
 *        没有库、没有串口、没有外设，编译只要几百字节。
 *
 *  板载 LED 是 D13（板上丝印 L），就是那颗。
 *
 *  改下面 MODE 一个数字，切换闪法：
 *      0 = 慢闪      1 秒亮 / 1 秒灭        （和出厂程序像，不好区分）
 *      1 = 快闪      100ms 亮 / 100ms 灭
 *      2 = 三连闪    快闪 3 下 → 停 2 秒 → 重复   ★ 推荐
 *
 *  为什么推荐 2：
 *      出厂自带的程序通常是"慢闪"。你烧进模式 2 之后，
 *      如果灯变成"三下快闪 + 停顿"，就 100% 证明你的程序进去了，
 *      不会跟原来的程序混淆。
 * ============================================================================
 */

#define MODE   2          // ← 改这里

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);
}

void loop() {
#if MODE == 0
  // 慢闪
  digitalWrite(LED_BUILTIN, HIGH);
  delay(1000);
  digitalWrite(LED_BUILTIN, LOW);
  delay(1000);

#elif MODE == 1
  // 快闪
  digitalWrite(LED_BUILTIN, HIGH);
  delay(100);
  digitalWrite(LED_BUILTIN, LOW);
  delay(100);

#else
  // 三连闪 + 停 2 秒（推荐：一眼看出是新程序）
  for (int i = 0; i < 3; i++) {
    digitalWrite(LED_BUILTIN, HIGH);
    delay(100);
    digitalWrite(LED_BUILTIN, LOW);
    delay(150);
  }
  delay(2000);
#endif
}
