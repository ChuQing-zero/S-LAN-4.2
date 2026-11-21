# 双舵机测试 —— 不用 CubeMX 版

S-LAN V4.0 / **STM32F103C8T6 蓝 pill**
纯寄存器 · 不装 CubeMX · 不用 HAL 库
日期：2026-09-21

> **为什么有这个版本？**
> 你现在的 Keil 工程是**空的** —— 没有 `main.h`、没有启动文件、没有 HAL 库。
> 这些东西本来应该由 CubeMX 生成，但你现在还没跑过 CubeMX。
>
> 这个版本**一个库都不用**，只依赖 Keil 器件包里自带的 CMSIS 寄存器定义，
> 所以**现在就能跑**。

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

## 二、Keil 里加启动文件（关键，之前就是漏了这一步）

```
   Keil 菜单： Project → Manage → Run-Time Environment

   中间那栏展开 Software Components，勾这两项：
        [x] CMSIS  →  CORE            处理器内核支持
        [x] Device →  Startup         复位向量 + 启动代码

   点 OK。左边文件树里会多出来 Startup 文件夹。
```

> **不勾这个 = 链接时报 `Undefined symbol Reset_Handler` 或者根本跑不起来。**

---

## 三、整份替换 main.c

```
① Keil 左侧文件树 → 双击 main.c
② 全选（Ctrl+A）→ 删除
③ 把本文件夹的 main.c 全部内容粘进去 → 保存（Ctrl+S）
```

**完事。** 不用改别的地方。

> **`system_stm32f10x.c` 一定要留着**（你项目里已经有了）。
> 启动文件会调用它里面的 `SystemInit()`，**删了会报 `Undefined symbol SystemInit`**。
> main.c 里**没有**再定义一遍 `SystemInit`，就是为了不跟它撞车。

---

## 三-B、你机器上的实际情况（我已经查过了）

| 项 | 值 |
|---|---|
| Keil | `D:\App\Keil5`，ARMCC `V5.06 update 5 (build 528)` |
| 器件包 | `Keil.STM32F1xx_DFP` **2.2.0**（**老版本**）|
| 设备头文件 | **`stm32f10x.h`** ← 不是 `stm32f1xx.h` |
| 启动文件 | `startup_stm32f10x_ld.s`（ld = 低密度）|
| 系统文件 | `system_stm32f10x.c`（**它自己已经把时钟配到 72MHz 了**）|
| CMSIS 内核头 | `D:\App\Keil5\ARM\PACK\ARM\CMSIS\5.0.1\CMSIS\Include\core_cm3.h` |

**为什么一开始报 `stm32f1xx.h` 找不到？** —— 因为那是**新版器件包（2.4.x）**的命名，
你装的是老包，名字是 `stm32f10x.h`。现在改过来了。

另外老包的 `stm32f10x.h` 有个硬性要求：**必须先定义一个"密度"宏**，否则直接 `#error`：

```c
STM32F10X_LD   低密度   16 / 32 KB Flash   (F103x4 / x6)   ← 你现在的启动文件是 ld
STM32F10X_MD   中密度   64 / 128 KB Flash  (F103x8 / xB)   ← 蓝 pill 其实是这个
```

main.c 顶部已经自动定义了（配套 `_ld.s` 启动文件）。
**以后把 Keil 的 Device 改成 STM32F103C8 时，把那行 `STM32F10X_LD` 改成 `STM32F10X_MD`。**

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

### ⭐ 一定要勾 `Reset and Run`

```
   Options for Target (Alt+F7) → Flash Download 标签页
        → 勾上 【Reset and Run】 → 确定
```

**不勾的后果**：F8 显示 `Verify OK`（烧写确实成功了），
但芯片**不复位**，还在跑上一次的旧程序 —— 表现为**下载成功但什么都不动**。

（遇到这种情况手动按一下蓝pill 上的黑色复位键也能跑，但每次都按很烦。）

### ⚠️ Device 暂时**别改**

```
Options for Target → Device 标签页 → 保持 STM32F103C6 不动
```

> 蓝 pill 其实是 **C8T6**（64KB Flash），选 C6 也能跑（这个程序才几 KB）。
> **现在别改** —— 一改 Keil 会让你换启动文件（`_ld.s` → `_md.s`），多一个坑。
> 等舵机转起来了，再一起改（同时把 main.c 顶部的 `STM32F10X_LD` 改成 `STM32F10X_MD`）。

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

## 六、排查顺序

| 现象 | 原因 |
|---|---|
| **下载成功但什么都不动** | ⭐ **`Reset and Run` 没勾** → 按一下蓝pill 复位键（或见下）|
| 找不到 `main.h` | **别用 02 那份**，这份不 include main.h |
| `Reset_Handler` 未定义 | 第二步没做（RTE 里没勾 Startup）|
| `Undefined symbol SystemInit` | `system_stm32f10x.c` 被删了 → 加回来 |
| `SystemInit is defined twice` | main.c 里多定义了一遍 → 这版已经删掉了，重新粘一次 |
| `stm32f1xx.h` 找不到 | 你装的是老器件包，应该用 `stm32f10x.h` → 重新粘一次 |
| **两个都不动** | ① PB10/PB11 信号线 ② 舵机电源没独立 ③ 没共地 ④ **TIM2 没做 remap**（见下）|
| **只有一个动** | 另一个信号线没插好 |
| **动一下就复位** | 舵机电源没独立，或没和蓝pill 共地 |
| **嗡嗡响不转** | 脉宽超范围 → `SERVO_MIN_US`/`SERVO_MAX_US` 改成 700 / 2300 |
| **ST-Link 连不上** | 接 3.3V + 拔 USB；BOOT0 跳线帽在 `0` 位 |

---

## 六-B、⚠️ TIM2 remap —— 最隐蔽的一个坑

**STM32 的 TIM2 通道 3/4 默认在 PA2 / PA3，不在 PB10 / PB11。**

要挪过去必须改 `AFIO->MAPR` 的 `TIM2_REMAP` 位：

| TIM2_REMAP | CH1/ETR | CH2 | CH3 | CH4 |
|---|---|---|---|---|
| `00` 默认 | PA0 | PA1 | **PA2** | **PA3** |
| `01` 部分1 | PA15 | PB3 | PA2 | PA3 |
| **`10` 部分2** | PA0 | PA1 | **PB10** ✅ | **PB11** ✅ |
| `11` 全映射 | PA15 | PB3 | PB10 | PB11 |

写错的表现就是：**编译下载都正常，但舵机一动不动**，而且用示波器量 PB10 什么都量不到。

代码里是这两行（`servo_init()` 里）：

```c
RCC->APB2ENR |= RCC_APB2ENR_AFIOEN;       /* AFIO 时钟，不开这个改 MAPR 无效 */
AFIO->MAPR &= ~AFIO_MAPR_TIM2_REMAP;
AFIO->MAPR |=  AFIO_MAPR_TIM2_REMAP_PARTIALREMAP2;
```

> **CubeMX 会自动生成这行**（`__HAL_AFIO_REMAP_TIM2_PARTIAL_2()`），
> 但 `02-TwoServoTest/main.c` 整份替换了 `MX_GPIO_Init`，所以那份里也手动补上了。

**以后改引脚一定要注意**：换了 TIM 通道的引脚，先查参考手册的 remap 表。

---

## 七、这份和 02 有什么区别

| | `02-TwoServoTest/` | `03-TwoServoBareMetal/`（本文件夹）|
|---|---|---|
| 依赖 | HAL 库 + CubeMX 工程 | **只依赖 CMSIS** |
| 能现在跑吗 | ❌ 要先装 CubeMX | ✅ **现在就能跑** |
| 代码风格 | HAL（和正式工程一致）| 直接写寄存器 |
| 用在哪 | **正式工程**（以后 ADC / 串口 / I²C 都用它）| 只是先把舵机转起来验证接线 |

**这份是"临时验证用"的。** 舵机转起来、接线确认没问题之后，
**正式工程还是要用 CubeMX**（`../README.md` 里有完整流程），
不然以后写 ADC 采样和串口打印会非常痛苦。

---

## 八、相关文档

| 文件 | 内容 |
|---|---|
| `../02-TwoServoTest/` | HAL 版（正式工程用）|
| `../01-BoardTest/` | 完整测试（限位 + 光敏 + 舵机 + 串口）|
| `../README.md` | 环境安装 + CubeMX 完整流程 |
| `../../../electronics/02-单元板BOM.md` | 接线详图 |
