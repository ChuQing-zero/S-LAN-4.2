/* ============================================================================
 *  84-ButtonScan  ——  找出板载按键接在哪个引脚（Arduino Nano）
 * ----------------------------------------------------------------------------
 *  用途：不知道按键接在哪个引脚、也不知道按下是高还是低时，用这个程序扫一遍。
 *
 *  做法：
 *    把所有可用引脚都设成 INPUT_PULLUP（内部上拉），
 *    每 300ms 打印一次「当前为 LOW 的引脚」。
 *    按下按键时，对应引脚电平会变，串口里就会看到它出现/消失。
 *
 *  用法：
 *    ① 烧进去 → 打开串口监视器（115200）
 *    ② 不碰按键，记下当前打印的引脚列表（这是静止状态）
 *    ③ 按住那个按钮不放，看列表里哪个引脚变了
 *    ④ 松开，再看它是否恢复
 *    ⑤ 把变化前后的列表发给写程序的人
 *
 *  ⚠ 不要接外设（电机/ESP 等）时上电扫描，避免误驱动。
 *     本程序只读不写，理论上安全，但 D0/D1 是串口，已排除。
 * ========================================================================== */

/* 参与扫描的引脚（Nano 上除 D0/D1 串口外的全部） */
const uint8_t SCAN_PINS[] = {
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
  A0, A1, A2, A3, A4, A5, A6, A7
};
const uint8_t SCAN_N = sizeof(SCAN_PINS) / sizeof(SCAN_PINS[0]);


static void print_pin_name(uint8_t pin)
{
  if (pin >= A0) { Serial.print('A'); Serial.print(pin - A0); }
  else           { Serial.print('D'); Serial.print(pin); }
}


void setup()
{
  Serial.begin(115200);
  delay(300);

  Serial.println();
  Serial.println(F("================================================"));
  Serial.println(F(" 84-ButtonScan  按键引脚扫描"));
  Serial.println(F(" 所有引脚已设为 INPUT_PULLUP（内部上拉）"));
  Serial.println(F(" 每 300ms 打印一次当前为 LOW 的引脚"));
  Serial.println(F("------------------------------------------------"));
  Serial.println(F(" 用法："));
  Serial.println(F("   1) 先不碰按键，看打印的列表"));
  Serial.println(F("   2) 按住按键不放，看哪个引脚出现/消失"));
  Serial.println(F("   3) 松开，确认它恢复"));
  Serial.println(F("================================================"));
  Serial.println();

  for (uint8_t i = 0; i < SCAN_N; i++)
  {
    pinMode(SCAN_PINS[i], INPUT_PULLUP);
  }
}


void loop()
{
  Serial.print(F("[扫描] LOW 的引脚: "));
  uint8_t cnt = 0;

  for (uint8_t i = 0; i < SCAN_N; i++)
  {
    if (digitalRead(SCAN_PINS[i]) == LOW)
    {
      print_pin_name(SCAN_PINS[i]);
      Serial.print(' ');
      cnt++;
    }
  }

  if (cnt == 0) Serial.print(F("（全部为高，没有引脚被拉低）"));

  Serial.print(F("   共 "));
  Serial.print(cnt);
  Serial.println(F(" 个"));

  delay(300);
}
