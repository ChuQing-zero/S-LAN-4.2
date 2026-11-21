# STM32 单元板 —— 面包板测试程序

S-LAN V4.0 / **STM32F103C8T6 蓝 pill**
CubeMX + Keil MDK-ARM 5
日期：2026-09-21

> 用这个程序在面包板上验证：**限位开关 / 光敏 / 舵机** 三类外设。
> 代码在 `main.c`，**按段落填进 CubeMX 生成的 main.c 里**。

---

## 一、接线

| 器件 | 接到蓝pill | 说明 |
|---|---|---|
| **限位开关 1** COM | **PB9** | 脚 46，右排丝印 "B9" |
| 　 NC | **GND** | 蜂鸣档找"不按时响的两个脚" |
| **限位开关 2** COM | **PB5** | 脚 41，右排丝印 "B5" ⚠️ **不 FT，别碰 5V** |
| 　 NC | **GND** | |
| **光敏电阻** 上端 | **3.3V** | ⚠️ 3.3V，**不是 5V** |
| 　 光敏 + 10kΩ 中点 | **PA0** | |
| 　 10kΩ 下端 | **GND** | |
| **舵机 1** 橙线（信号）| **PB10** | |
| **舵机 2** 橙线（信号）| **PB11** | |
| **舵机 红线** | **独立 5V 电源 +** | ⚠️ **不要接板上 5V** |
| **舵机 棕线** | **独立 5V 电源 −** | ⚠️ 必须**和蓝pill GND 接一起** |
| USB-TTL **RX** | **PA9** | |
| USB-TTL **TX** | **PA10** | |
| USB-TTL **GND** | **GND** | |

### 蓝pill 上的开关与供电

```
   ① BOOT0 跳线帽 → "0" 位（默认就是）
   ② 蓝pill 供电 → 插 USB 线
   ③ ST-Link 只接 3 根：SWDIO / SWCLK / GND
      ⚠️ 不要接 ST-Link 的 3.3V（USB 已经在供了，两边同时供会打架）
      万一 ST-Link 报"连不上" → 把 ST-Link 3.3V 接上，同时【拔掉 USB】
   ④ ★ 舵机电源的 GND 必须和蓝pill 的 GND 连起来
```

> ⚠️ **蓝pill 板上的 5V 不能给舵机供电** —— 那是 USB 过来的，
> 一个舵机堵转就能把板子拉复位（表现为程序莫名重跑、串口掉线）。

---

## 二、CubeMX 配置（照着点）

### 1. System Core

| 位置 | 设成 |
|---|---|
| **RCC → High Speed Clock (HSE)** | **Crystal/Ceramic Resonator** ⚠️ 别选 Disable |
| **SYS → Debug** | **Serial Wire**（烧录口）|

### 2. 逐个引脚（在芯片图上点）

| 引脚 | 设成 | 备注 |
|---|---|---|
| **PA0** | `ADC1_IN0` | 光敏 |
| **PA9** | `USART1_TX` | 串口发 |
| **PA10** | `USART1_RX` | 串口收 |
| **PA11** | `GPIO_Output` | 卡牌灯 |
| **PA12** | `GPIO_Output` | 通信灯 |
| **PB10** | `TIM2_CH3` | 舵机 1 |
| **PB11** | `TIM2_CH4` | 舵机 2 |
| **PB9** | `GPIO_Input` | 限位 1（脚 46）|
| **PB5** | `GPIO_Input` | 限位 2（脚 41）⚠️ 不 FT |
| **PB14** | `GPIO_Output` | 限位 1 灯 |
| **PB15** | `GPIO_Output` | 限位 2 灯 |

### 3. 三个外设的参数

**ADC1**
```
Continuous Conversion Mode  = Disabled     ← ⚠️ 必须 Disabled，程序用轮询
Resolution                  = 12 bits
```

**TIM2**
```
Channel3 = PWM Generation CH3
Channel4 = PWM Generation CH4

Counter Settings:
    Prescaler        = 71          ← 72MHz / (71+1) = 1MHz，也就是 1 个计数 = 1µs
    Counter Period   = 19999       ← 20000µs = 20ms = 50Hz（舵机标准）
PWM Generation Channel 3 / 4:
    Pulse            = 1500        ← 1500µs = 90°
    Mode             = PWM mode 1
```

**USART1**
```
Mode = Asynchronous
Baud Rate    = 115200
Word Length  = 8 Bits
Parity       = None
Stop Bits    = 1
```

**PB9 / PB5 的 GPIO 参数**（点 GPIO 标签页改）
```
GPIO mode         = Input
GPIO Pull-up/Pull-down = Pull-up      ← ⚠️ 必须上拉
```

### 4. Clock Configuration

```
Input frequency     = 8 MHz
PLL Source          = HSE
PLL Multiplication  = ×9
System Clock Mux    = PLLCLK        → HCLK = 72 MHz
AHB Prescaler       = 1
APB1 Prescaler      = /2            → 36MHz，但定时器时钟 ×2 = 72MHz ✅
APB2 Prescaler      = /1
```

### 5. Project Manager

```
Project → Toolchain / IDE  = MDK-ARM  (V5)
Code Generator → 勾 "Copy only the necessary library files"
→ 点 GENERATE CODE
```

---

## 三、Keil 里的设置

### ⚠️ 必做（漏了 printf 没输出，还不报错）

```
Options for Target (Alt+F7)
  → Target 标签页
  → 勾上 【Use MicroLIB】
```

### 烧录设置

```
Options for Target (Alt+F7)
  → Debug 标签页
  → 右侧选 【ST-Link Debugger】
  → 点 Settings
      → Port 选 【SW】
      → 能读到 IDCODE 就是连上了
  → 切到 Flash Download 标签页
      → 勾 "Reset and Run"（下载完自动跑）
```

### 编译下载

```
   F7  = 编译
   F8  = 下载
```

---

## 四、测试顺序（一个一个来）

### 第 1 步：串口 + 限位 + 光敏

```
   ① main.c 里 #define TEST_MODE  1
   ② 编译下载
   ③ 打开串口助手，选 CH340 的 COM 口，波特率 115200
```

应该每半秒刷一行：

```
限位1=0  限位2=0  |  光敏 1650 mV    无卡
限位1=1  限位2=0  |  光敏 1650 mV    无卡
限位1=1  限位2=0  |  光敏   92 mV  【有卡】
```

**三个都要验：**

| 动作 | 应该看到 |
|---|---|
| 手指按下限位 1 的拨杆 | `限位1` 从 `0` 变 `1` |
| 把限位 1 的线从蓝pill 上拔掉 | `限位1` **也变成 1** ⭐ 断线保护 |
| 拿张卡挡住光敏 | 光敏 mV 掉到 400 以下，显示【有卡】 |

> **数字不动的排查顺序**：接线 → PB9/PB5 有没有设成 Pull-up → 波特率是不是 115200。

### 第 2 步：舵机

```
   ① main.c 里 #define TEST_MODE  2
   ② 重新编译下载
```

舵机会每 1 秒转 15°，串口同步打印角度。

**⭐ 这一步顺便把项目的关键未知数测出来** —— 盯着舵机臂：

```
   打印"命令角度 = 105 度" → 臂还在动
   打印"命令角度 = 120 度" → 臂【不动了】← 真实上限就在 105~120 之间
```

**把 15 改成 5 再跑一遍，能精确到 5° 以内。** 这个数直接填进 `docs/00-项目总览.md` 的「实测有效转角」。

> **舵机抖动/嗡嗡响不动**：脉宽超范围了，把 `SERVO_MIN_US` / `SERVO_MAX_US` 收窄成 700 / 2300。
> **舵机一抖 MCU 就复位**：舵机电源没独立，检查那根独立 5V 和共地。

### 第 3 步：综合

```
   ① main.c 里 #define TEST_MODE  3
   ② 重新编译下载
```

按下限位 1 → 两个舵机同时抬到 115°，限位灯亮；松开 → 回 0°。

---

## 五、出问题先看这几条

| 现象 | 原因 |
|---|---|
| **串口一个字都没有** | Keil 没勾 `Use MicroLIB` ／ 波特率不是 115200 |
| **串口全是乱码** | 波特率不对 |
| **ST-Link 连不上** | 接上 ST-Link 的 3.3V 并拔掉 USB ／ BOOT0 不在 0 位 |
| **光敏读数一直是 0 或 4095** | 分压接反了（光敏和 10kΩ 对调）／ 接的是 5V 不是 3.3V |
| **限位一直是 1** | NC 没接到 GND ／ PB9/PB5 没设 Pull-up |
| **舵机不动** | 信号线没接 PB10/PB11 ／ TIM2 的 Prescaler/Period 填错了 |

---

## 六、相关文档

| 文件 | 内容 |
|---|---|
| `../../../electronics/02-单元板BOM.md` | §7.3 光照 / §7.5 限位 / §7.6 串口 的接线详图 |
| `../../../electronics/03-面包板测试计划.md` | 完整测试流程 |
| `../../../docs/00-项目总览.md` | ⭐ 单一数据源（实测到的舵机转角填这里）|
