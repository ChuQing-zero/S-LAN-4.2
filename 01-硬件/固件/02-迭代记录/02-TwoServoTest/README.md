# 双舵机最小测试

S-LAN V4.0 / **STM32F103C8T6 蓝 pill**
CubeMX + Keil MDK-ARM 5
日期：2026-09-21

> ⭐ **整份替换的 main.c** —— 不用再纠结"哪段填哪里"，直接把整个文件覆盖过去就行。
> 文件是**纯 ASCII**，不会出编码问题。

---

## 一、接线

```
   舵机 1  橙线（信号） ──> PB10
   舵机 2  橙线（信号） ──> PB11

   独立 5V 电源 正极 ──┬── 舵机1 红线
                       └── 舵机2 红线

   独立 5V 电源 负极 ──┬── 舵机1 棕线
                       ├── 舵机2 棕线
                       └── ★ 蓝pill 的 GND   ← 必须接！
```

⚠️ **舵机红线不要接蓝pill 板上的 5V**（会拉复位）。

---

## 二、CubeMX 配置（只要 5 步）

```
① File → New Project → 选 STM32F103C8Tx → Start Project

② System Core → RCC → HSE = Crystal/Ceramic Resonator
   System Core → SYS → Debug = Serial Wire

③ 点引脚：PB10 → TIM2_CH3      PB11 → TIM2_CH4
   ⚠️ 两个都要设成 "PWM Generation CHx"

④ 这一步参数不用管 —— main.c 里自己会配 TIM2
   （CubeMX 里配了也不冲突，反正会被覆盖）

⑤ Clock Configuration 标签页：
        PLL Source = HSE，PLL ×9，System Clock Mux = PLLCLK → 72MHz
   Project Manager：
        Project Location = D:\Project\S-LAN\Build\V4.0\V4.2\STM32
        Toolchain / IDE  = MDK-ARM (V5)
   → GENERATE CODE → 弹窗点 Open Project
```

---

## 三、⭐ 只做一件事：整个替换 main.c

```
① Keil 左侧文件树 → 展开 Core → Src → 双击 main.c
② 全选（Ctrl+A）→ 删除
③ 把本文件夹的 main.c 全部内容粘进去 → 保存（Ctrl+S）
```

**完事。** 其它文件（`main.h`、`stm32f1xx_hal_msp.c`、`stm32f1xx_it.c`、启动文件…）**一个都别动**。

> **为什么这次能整份替换？**
> 因为这份 main.c 里**自带**了 `SystemClock_Config`、`MX_GPIO_Init`、`MX_TIM2_Init`，
> 还有 `Error_Handler`。CubeMX 生成的那几个同名函数就在 main.c 里，被覆盖掉也不缺东西。
>
> ✅ 这个程序**不用串口，所以不用勾 Use MicroLIB**。

---

## 四、Keil 编译下载

### 设置（只做一次）

```
Options for Target (Alt+F7)
   → Target 标签页 → ARM Compiler 选 【v5.06 update 5 (build 528)】
   → Debug 标签页 → 右上角下拉选 【ST-Link Debugger】
        → Settings → Port 选 【SW】→ 看到 IDCODE = 连上了
   → Flash Download 标签页 → 勾 【Reset and Run】
   → 确定
```

### 每次

```
   F7 = 编译      F8 = 下载
```

### ST-Link 接蓝pill

```
   SWDIO ──> SWDIO
   SWCLK ──> SWCLK
   GND   ──> GND
   3.3V  ──> ✂ 先不接（蓝pill 走 USB 供电）

   ⚠️ Keil 报"连不上"时：接上 ST-Link 的 3.3V，同时【拔掉蓝pill 的 USB】
```

---

## 五、应该看到

两个舵机**同步** 0° → 180°（约 1.2 秒）→ 停 0.3 秒 → 转回 0° → 停 0.3 秒 → 循环。

想改速度，改 main.c 顶部：

```c
#define STEP_DEG         3      /* 改小 = 更慢 */
#define STEP_DELAY_MS    20     /* 改大 = 更慢 */
```

---

## 六、不动的排查顺序

| 现象 | 原因 |
|---|---|
| 编译报 **错误** | 代码没粘全 / 粘到了别的文件里 |
| 编译报 `uint32_t is undefined` | 同上，粘的位置不对 |
| **两个都不动** | ① PB10/PB11 是不是接在 CubeMX 里的 TIM2_CH3/CH4<br>② 信号线插对了没 |
| **只有一个动** | 另一个信号线没插好 |
| **动一下就复位** | **舵机电源没独立**，或**没和蓝pill 共地** |
| **嗡嗡响不转** | 脉宽超范围 → `SERVO_MIN_US`/`SERVO_MAX_US` 改成 700 / 2300 |
| **ST-Link 连不上** | 接 3.3V + 拔 USB；BOOT0 跳线帽在 `0` 位 |

---

## 七、相关文档

| 文件 | 内容 |
|---|---|
| `../01-BoardTest/` | 完整版测试（限位 + 光敏 + 舵机 + 串口）|
| `../README.md` | 环境安装 + 完整流程 |
| `../../../electronics/02-单元板BOM.md` | 接线详图 |
