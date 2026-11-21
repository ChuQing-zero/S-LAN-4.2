# -*- coding: utf-8 -*-
"""
TCG 卡牌扫描 · 网页拍照控制台
==============================
- 左半边：手机实时画面（每 FRAME_INTERVAL 秒截一帧，约 1~2 帧/秒）
- 右半边：手动拍照 / 当前计数 / 状态灯 / 串口日志 / 已保存照片
- 自动拍照：Arduino 报 "[成功] 卡通过" 后 AUTO_CAPTURE_DELAY 秒自动 adb 截屏存图
- 状态灯：Arduino 每 0.1 秒广播 "[状态] 报警/遮挡/等待卡/待命/已停止"，
          网页实时显示，报警/遮挡时红灯闪烁 + 电脑响一声"嘀"
- 参数：网页右下角可直接改并保存（存到 config.json），下次启动自动读取

环境：Python + Flask + pyserial + adb（都需已安装）
运行：  python app.py   →   浏览器打开 http://localhost:6001
注意： 本程序独占 Arduino 的 COM 口。运行期间请关闭 Arduino IDE 的串口监视器。
"""

import os
from collections import deque
import re
import json
import time
import threading
import subprocess
from flask import Flask, Response, jsonify, render_template_string, request
import serial
import serial.tools.list_ports

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, "config.json")

# ── 默认配置（网页里可直接改并保存）──────────────────────────────
CONFIG_DEFAULTS = {
    "COM_PORT": "AUTO",         # "AUTO"=自动识别 Arduino，或写 "COM3" 手动指定
    "BAUD": 115200,             # 串口波特率（V1.3 主控 Nano 用 115200）
    # ── V1.3 双链路：USB 数据线 / ESP-01 WiFi ──
    "LINK_MODE": "auto",        # auto=有数据线走USB，没有走WiFi；serial=只用USB；wifi=只用WiFi
    "ESP_IP": "192.168.1.100", # ESP-01 引导阶段的固定 IP
    "ESP_PORT": 8080,           # ESP-01 引导端口
    "WIFI_LISTEN_PORT": 9000,   # 本机 WiFi 通信端口（阶段②）
    "FRAME_INTERVAL": 0.3,      # 实时画面截屏间隔（秒），越小越流畅但手机费电
    "AUTO_CAPTURE_DELAY": 1.0,  # 卡通过后延迟拍照（秒）
    "LOG_MAX": 60,              # 串口日志保留条数
    "FOCUS_TAP": True,          # 拍照前先点一下屏幕（触发相机对焦）
    "PAUSE_FRAME_ON_PHOTO": True,   # 拍照期间暂停实时投屏（避免抢 adb 带宽）
    "FOCUS_TAP_X": 50,          # 对焦点击位置：横向百分比 0~100（50=正中间）
    "FOCUS_TAP_Y": 50,          # 对焦点击位置：纵向百分比 0~100（50=正中间）
    "CAPTURE_MODE": "camera",   # 拍照方式: "camera"=真相机快门(全分辨率) / "screencap"=截屏
    "SHUTTER_METHOD": "tap",    # 快门方式: "tap"=点屏幕快门按钮 / "keyevent"=物理快门键(相机键/音量键)
    "SHUTTER_TAP_X": 50,        # 快门按钮位置：横向百分比（50=中间）
    "SHUTTER_TAP_Y": 86,        # 快门按钮位置：纵向百分比（华为相机约在底部 86% 处）
    # ── 设备连接页联动（编号/保存路径/自动运转） ──────────────
    "SAVE_DIR": None,           # 保存路径绝对路径；None=默认 BASE_DIR/photos
    "LIB_CODE": "A0-000-01",    # 当前库号（含批次，如 A0-000-01）
    "START_SERIAL": 1,          # 起始序号（前端设备号 0001 → 存 1）
    "THRESHOLD": 30,            # 阈值：序号到达后停运转、弹贴标签
    "AUTO_MODE": False,         # 自动运转开关
    # ── 实时画面裁剪（只显示相机画面中间卡片区域） ─────────────
    "FRAME_CROP_TOP": 0,        # 画面顶部裁剪百分比（0~50），默认 0=不裁
    "FRAME_CROP_BOTTOM": 0,     # 画面底部裁剪百分比（0~50），默认 0=不裁
    # ── 手机相册原图清理 ─────────────────────────────────────
    "DELETE_REMOTE_AFTER_PULL": True,   # 照片 pull 到电脑后，删除手机相册里的原图（省空间）
    # ── 整机主流程等待时间（可在页面「主流程」块里改） ──────────
    "MAIN_PRECHECK": True,          # 启动前自检 5 路光敏
    "SORT_LOCAL_STOP": True,        # 分拣口停带交给 Nano 本地闭环（Z 命令）
    "SORT_LOCAL_DELAY_MS": 500,     # 卡到分拣口后，皮带再走多久才停（越大卡越往停位走）
    "SORT_CMD_GAP_MS": 250,         # 抬升三条命令之间隔多久
    "SORT_STOP_DELAY_MS": 500,      # 本地闭环失效时，PC 轮询路径的停带延时
    "PHOTO_STOP_DELAY_MS": 0,     # 第二次停（拍照位）不再延时     # 拍照位（第二次停）停带延时
    "IDENT_STOP_DELAY_MS": 1000,    # 识别位（第一次停）停带延时
    "IDENT_SETTLE_MS": 500,         # 识别位停稳后等待
    "FEED_TO_BELT_MS": 1000,        # 进料后等待
    "GATE_RAISE_WAIT_MS": 600,      # 每张进料前挡片立起后等待
    "GATE_TO_BELT_MS": 1000,        # 挡片放行后等待
    "LIGHT_CONFIRM_MS": 500,        # 变亮连续确认时长（防抖动）
    "PHOTO_WAIT_MS": 500,           # 拍照前等待
    "SORT_RAISE_HOLD_MS": 4500,     # 舵机抬升后保持
    "SORT_CYCLE_DELAY_MS": 5000,    # 每张之间间隔
    "SORT_FALLBACK_MS": 30000,      # 兜底出口送走时间
    "SORT_BELT_PWM": 150,           # 皮带速度
    # ── 启动校准（每次「开始运转」先实测六路亮态值，按比例算阈值）──
    "START_CALIB": True,            # 是否每次启动都校准
    "CALIB_RATIO_UNIT": 0.82,       # 单元阈值 = 亮态 × 0.82（约 3000）
    "CALIB_RATIO_A7": 0.77,         # 进料口阈值 = 亮态 × 0.77（约 600）
    "CALIB_SAMPLES": 3,             # 每路采样次数（取中位数）
    "CALIB_GAP_MS": 150,            # 轮次之间间隔
}

# 启动时读取 config.json（没有就用默认值）
config = dict(CONFIG_DEFAULTS)
if os.path.exists(CONFIG_FILE):
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            config.update(json.load(f))
    except Exception:
        pass


# ── V1.3 WiFi 链路（ESP-01）──────────────────────────────────
try:
    from link_wifi import WifiLink
except Exception as _e:
    WifiLink = None
    print("[WiFi] 未找到 link_wifi.py，WiFi 通道不可用:", _e)


def _wifi_on_line(line):
    """WiFi 收到的每一行：写进日志，顺便提取关键事件"""
    add_log("[WiFi] " + line)
    if line.startswith("[识别]"):
        state["lastRecognize"] = line
    elif line.startswith("[主机]"):
        state["host"] = "在线" if "在线" in line else "离线"


wifi_link = None
if WifiLink is not None:
    wifi_link = WifiLink(
        esp_ip=str(config.get("ESP_IP", "192.168.1.100")),
        esp_port=int(config.get("ESP_PORT", 8080)),
        my_port=int(config.get("WIFI_LISTEN_PORT", 9000)),
        on_line=_wifi_on_line,
    )


def link_info():
    """当前链路状态（给 /status 和前端用）"""
    mode = str(config.get("LINK_MODE", "auto")).lower()
    ser_ok = bool(arduino_serial is not None and getattr(arduino_serial, "is_open", False))
    wifi = wifi_link.status() if wifi_link is not None else {"connected": False, "phase": "off", "phaseText": "WiFi 模块未加载"}

    active = "none"
    if mode == "serial":
        active = "serial" if ser_ok else "none"
    elif mode == "wifi":
        active = "wifi" if wifi.get("connected") else "none"
    else:
        if ser_ok:
            active = "serial"
        elif wifi.get("connected"):
            active = "wifi"

    names = {"serial": "USB 数据线", "wifi": "WiFi (ESP-01)", "none": "未连接"}
    return {
        "mode": mode,
        "active": active,
        "activeText": names.get(active, active),
        "serialOk": ser_ok,
        "wifi": wifi,
    }


def save_config():
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print("保存 config.json 失败:", e)


PHOTO_DIR = os.path.join(BASE_DIR, "photos")
os.makedirs(PHOTO_DIR, exist_ok=True)
app = Flask(__name__)

def save_dir():
    """当前照片保存根目录（SAVE_DIR 未配时退回默认 photos/）。"""
    d = config.get("SAVE_DIR")
    return d if d else PHOTO_DIR

# ── 全局状态 ─────────────────────────────────────────────────────
state = {"count": None, "serial": "未连接", "adb": "检测中",
         "status": "未知", "log": [],
         # 开放协议事件（主机在线 / 按钮 / LDR 光敏读数 / 固件版本）
         "host": "未知", "button": None, "ldr": None, "fwVersion": None,
         # 设备连接页编号状态
         "serialNo": int(config.get("START_SERIAL", 1)),
         "libCode": config.get("LIB_CODE", "A0-000-01"),
         "threshold": int(config.get("THRESHOLD", 30)),
         "needsLabel": False,
         "autoRunning": False}
latest_frame = None          # 最近一次截屏的 PNG 字节
lock = threading.Lock()      # 保护 state/log
force_reconnect = False      # 网页改了 COM/波特率后，让串口线程重连

PLACEHOLDER_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640">'
    '<rect width="100%" height="100%" fill="#111"/>'
    '<text x="50%" y="50%" fill="#666" font-size="22" text-anchor="middle">'
    '暂无画面\n请连接手机</text></svg>'
)


# ── 送料时序测试（测试2）────────────────────────────────────────
try:
    from feed_seq import FeedSeq
except Exception as _e:
    FeedSeq = None
    print("[测试2] 未找到 feed_seq.py:", _e)


def _seq_get_ldr():
    """从最近日志里取最后一次 [光敏] 的百分比"""
    try:
        with lock:
            lg = list(state.get("log", []))
        for ln in reversed(lg[-80:]):
            s2 = str(ln)
            if "[光敏]" in s2 and "%" in s2:
                import re as _re
                m = _re.search(r"(\d+)%", s2[s2.find("[光敏]"):])
                if m:
                    return int(m.group(1))
    except Exception:
        pass
    return None


# ── 整机主流程（开始运转）──────────────────────────────────────────
try:
    from main_flow import MainFlow
    import sort_rules as _sort_rules
except Exception as _e:
    MainFlow = None
    _sort_rules = None
    print("[主流程] 模块加载失败:", _e)


def _ask_ai_internal(image, question):
    """设备端内部调用 Server 的识别接口（本机回环，无需 token）"""
    try:
        import urllib.request
        body = json.dumps({"image": image, "question": question}).encode("utf-8")
        req = urllib.request.Request(
            "http://127.0.0.1:4002/internal/vision/qa",
            data=body, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=90) as r:
            d = json.loads(r.read().decode("utf-8"))
        return bool(d.get("ok")), str(d.get("answer") or "")
    except Exception as e:
        print("[主流程] AI 调用失败:", e)
        return False, ""


main_flow = None
if MainFlow is not None:
    main_flow = MainFlow(
        send=lambda c: send_command(c),
        log=lambda _t: add_log(_t),
        mark=lambda: _all_mark(),
        next_line=lambda b: _all_next(b),
        cfg=lambda: config,
        capture_photo=lambda: capture_photo_dataurl()[0],
        ask_ai=_ask_ai_internal,
        save_cfg=lambda: save_config(),
    )

# ── 调试4：单张进料（调速 + 遮挡就停）──────────────────────────────
try:
    from feed_push import FeedPush
except Exception as _e:
    FeedPush = None
    print("[调试4] 未找到 feed_push.py:", _e)

feed_push = None
if FeedPush is not None:
    feed_push = FeedPush(
        send=lambda c: send_command(c),
        log=lambda _t: add_log(_t),
        mark=lambda: _log_mark(),
        wait=lambda b: _log_wait_new(b),
        get_th=lambda ch: (config.get("LDR_THRESHOLDS") or {}).get(ch),
        params={
            "channel": config.get("PUSH_CHANNEL", "0x10"),
            "pwm": int(config.get("PUSH_PWM", 200)),
            "th": int(config.get("PUSH_TH", 0)),
            "intervalMs": int(config.get("PUSH_INTERVAL_MS", 60)),
            "maxMs": int(config.get("PUSH_MAX_MS", 4000)),
        },
    )

# ── 调试3：料仓缺卡自动停料 ─────────────────────────────────────
try:
    from feed_auto import FeedAuto
except Exception as _e:
    FeedAuto = None
    print("[调试3] 未找到 feed_auto.py:", _e)

feed_auto = None
if FeedAuto is not None:
    feed_auto = FeedAuto(
        send=lambda c: send_command(c),
        log=lambda _t: add_log(_t),
        mark=lambda: _log_mark(),
        wait=lambda b: _log_wait_new(b),
        params={
            "channel": config.get("FEED_CHANNEL", "A7"),
            "th": int(config.get("FEED_TH", 300)),
            "intervalMs": int(config.get("FEED_INTERVAL_MS", 200)),
        },
    )

# ── 调试1：半速到光敏停 ─────────────────────────────────────────
try:
    from speed_stop import SpeedStop
except Exception as _e:
    SpeedStop = None
    print("[调试1] 未找到 speed_stop.py:", _e)

speed_stop = None
if SpeedStop is not None:
    speed_stop = SpeedStop(
        send=lambda c: send_command(c),
        log=lambda _t: add_log(_t),
        mark=lambda: _log_mark(),                 # 定义在下面，延迟解析
        wait=lambda b: _log_wait_new(b),
        get_th=lambda ch: (config.get("LDR_THRESHOLDS") or {}).get(ch),
        params={
            "channel": config.get("SPEED_CHANNEL", "0x10"),
            "pwm": int(config.get("SPEED_PWM", 100)),
            "intervalMs": int(config.get("SPEED_INTERVAL_MS", 120)),
            "ratio": float(config.get("SPEED_RATIO", 0.75)),
        },
    )

# ── 测试3：6 路光敏实时监视 + 延迟测量 ──────────────────────────
try:
    from ldr_probe import LdrProbe
except Exception as _e:
    LdrProbe = None
    print("[测试3] 未找到 ldr_probe.py:", _e)


# ── 全量日志游标（主流程用：要看到 [进料]/[状态]/[ADC] 等所有行）──
all_seq = 0
all_lines = deque(maxlen=600)


def _all_mark():
    with lock:
        return all_seq


def _all_next(before):
    """返回序号 > before 的第一条 (seq, line)；没有则 None"""
    with lock:
        for seq, ln in all_lines:
            if seq > before:
                return (seq, ln)
    return None


def _log_mark():
    """返回 [光敏ADC] 行的当前序号（单调递增，不受日志上限回绕影响）"""
    with lock:
        return ldr_seq


def _log_wait_new(before):
    """取序号比 before 大的第一条 [光敏ADC] 行"""
    with lock:
        for seq, ln in ldr_lines:
            if seq > before:
                return ln
    return None


ldr_probe = None
if LdrProbe is not None:
    ldr_probe = LdrProbe(
        send=lambda c: send_command(c),
        log=lambda _t: add_log(_t),
        params={
            "mode": config.get("LDR_MODE", "one"),
            "intervalMs": int(config.get("LDR_INTERVAL_MS", 300)),
            "unitTh": int(config.get("LDR_UNIT_TH", 2000)),
            "a7Th": int(config.get("LDR_A7_TH", 400)),
            "ratio": float(config.get("LDR_RATIO", 0.75)),
        },
    )
    ldr_probe.bind_log_source(_log_mark, _log_wait_new)


feed_seq = None
if FeedSeq is not None:
    feed_seq = FeedSeq(
        send=lambda c: send_command(c),
        get_ldr=_seq_get_ldr,
        log=lambda _t: add_log(_t),      # add_log 在本文件后面定义，延迟解析
        params={
            "gateMs": int(config.get("GATE_MS", 1200)),
            "gateUpDeg": int(config.get("GATE_UP_DEG", 90)),
            "gateDownDeg": int(config.get("GATE_DOWN_DEG", 60)),
            "gateBufferMs": int(config.get("GATE_BUFFER_MS", 1000)),
            "darkPct": int(config.get("LDR_DARK_PCT", 60)),
            "lightPct": int(config.get("LDR_LIGHT_PCT", 85)),
            "stopDelayMs": int(config.get("STOP_DELAY_MS", 1000)),
        },
    )


# ── 手机无线 ADB 链路（自动发现 + 自动重连）──────────────────────
try:
    from phone_link import PhoneLink
except Exception as _e:
    PhoneLink = None
    print("[手机] 未找到 phone_link.py，无线 ADB 不可用:", _e)

phone_link = None
if PhoneLink is not None:
    phone_link = PhoneLink(
        adb_path=config.get("ADB_PATH"),
        serial=config.get("PHONE_SERIAL"),
    )


def phone_serial_arg():
    """USB 与无线同时在线时必须带 -s，否则报 more than one device

    做法：给整个进程设 ANDROID_SERIAL 环境变量 —— 现有 5 处裸 adb 调用
    不用改代码就能自动带上目标设备。
    """
    try:
        ep = config.get("PHONE_ADB") or ""
        if not ep and phone_link is not None:
            ep = phone_link.endpoint or ""
        if ep:
            os.environ["ANDROID_SERIAL"] = ep
        return ep
    except Exception:
        return ""


def phone_sync_worker():
    """把 phone_link 连上的端点同步进 config 与环境变量"""
    while True:
        try:
            if phone_link is not None:
                ep = phone_link.endpoint
                if ep and ep != config.get("PHONE_ADB"):
                    config["PHONE_ADB"] = ep
                    try:
                        save_config()
                    except Exception:
                        pass
                phone_serial_arg()
        except Exception:
            pass
        time.sleep(5)


# ── adb 辅助 ─────────────────────────────────────────────────────
def adb_screencap():
    """adb 截屏，返回 PNG 字节；失败返回 None。"""
    try:
        p = subprocess.run(["adb", "exec-out", "screencap", "-p"],
                           capture_output=True, timeout=12)
        if p.returncode == 0 and p.stdout:
            return p.stdout
    except Exception:
        pass
    return None


screen_size = None          # 手机屏幕分辨率 (宽, 高)，查到后缓存


def adb_screen_size():
    """查询手机屏幕分辨率，返回 (宽, 高)；失败返回 None。"""
    global screen_size
    if screen_size:
        return screen_size
    try:
        p = subprocess.run(["adb", "shell", "wm", "size"],
                           capture_output=True, timeout=8, text=True)
        m = re.search(r"Physical size:\s*(\d+)x(\d+)", p.stdout)
        if m:
            screen_size = (int(m.group(1)), int(m.group(2)))
            return screen_size
    except Exception:
        pass
    return None


def adb_tap(x_pct, y_pct):
    """点一下手机屏幕：x/y 是百分比（50=中间）。用于触发相机点击对焦。"""
    size = adb_screen_size()
    if not size:
        return False
    x = int(size[0] * x_pct / 100.0)
    y = int(size[1] * y_pct / 100.0)
    try:
        # 先保证屏幕亮着（已亮则无副作用）
        subprocess.run(["adb", "shell", "input", "keyevent", "KEYCODE_WAKEUP"],
                       capture_output=True, timeout=8)
        time.sleep(0.2)
        p = subprocess.run(["adb", "shell", "input", "tap", str(x), str(y)],
                           capture_output=True, timeout=8)
        return p.returncode == 0
    except Exception:
        return False


def get_latest_camera_photo():
    """返回手机相册 DCIM/Camera 里最新一张照片的完整路径；没有返回空串。"""
    try:
        p = subprocess.run(
            ["adb", "shell", "ls -t /sdcard/DCIM/Camera/*.jpg 2>/dev/null | head -1"],
            capture_output=True, timeout=10, text=True)
        return p.stdout.strip()
    except Exception:
        return ""


def trigger_shutter():
    """按下相机快门。默认点屏幕上的快门按钮；也可选物理快门键。"""
    method = str(config.get("SHUTTER_METHOD", "tap"))
    if method == "keyevent":
        for key in ("KEYCODE_CAMERA", "KEYCODE_VOLUME_UP", "KEYCODE_VOLUME_DOWN"):
            p = subprocess.run(["adb", "shell", "input", "keyevent", key],
                               capture_output=True, timeout=8)
            if p.returncode == 0:
                return True
        return False
    # 默认：点屏幕上的快门按钮（位置可调）
    return adb_tap(config.get("SHUTTER_TAP_X", 50), config.get("SHUTTER_TAP_Y", 86))


def current_save_dir():
    """当前批次保存文件夹 = SAVE_DIR/库号（有则进、无则建）。"""
    lib = str(config.get("LIB_CODE", "A0-000-01")).strip()
    d = os.path.join(save_dir(), lib)
    os.makedirs(d, exist_ok=True)
    return d


def numbered_filename():
    """编号命名：库号-序号（如 A0-000-01-0001），扩展名由 save_photo 统一追加。"""
    lib = str(config.get("LIB_CODE", "A0-000-01")).strip()
    with lock:
        n = state["serialNo"]
    return "%s-%04d" % (lib, int(n))


def beep_worker():
    """贴标签持续报警：needsLabel 期间每 2 秒蜂鸣器响一下，直到点确认清除。"""
    while True:
        with lock:
            if not state["needsLabel"]:
                return
        send_command("b")
        time.sleep(2)


def after_saved():
    """照片保存成功后：序号+1、数码管跟随、到达阈值 → 持续报警+停运转+置待贴标签。"""
    first_cross = False
    with lock:
        state["serialNo"] += 1
        if state["serialNo"] > int(state["threshold"]):
            if not state["needsLabel"]:          # 只在第一次跨过阈值时启动持续报警（避免重复保存重复起线程）
                first_cross = True
            state["needsLabel"] = True
            state["autoRunning"] = False
    if first_cross:
        threading.Thread(target=beep_worker, daemon=True).start()  # 持续蜂鸣提醒贴标签
    send_command("D,%04d" % state["serialNo"])   # 数码管 = 当前序号（跟前端一致）


def save_photo(prefix, n=None, numbered=False):
    """先点屏对焦（可选）→ 拍照并保存。返回 (文件名或None, 错误信息)。
    numbered=True 时用编号命名（库号-序号.jpg），否则保留旧 card/manual_时间戳。"""
    if config.get("FOCUS_TAP"):
        adb_tap(config.get("FOCUS_TAP_X", 50), config.get("FOCUS_TAP_Y", 50))
        time.sleep(0.6)            # 等相机对焦稳定

    if numbered:
        name = numbered_filename()
    else:
        ts = time.strftime("%Y%m%d_%H%M%S")
        if n is not None:
            name = "%s_%03d_%s" % (prefix, int(n), ts)
        else:
            name = "%s_%s" % (prefix, ts)

    if config.get("CAPTURE_MODE") == "camera":
        name += ".jpg"
        before = get_latest_camera_photo()
        if not trigger_shutter():
            return None, "快门触发失败（检查手机连接/相机是否在前台）"
        local = os.path.join(current_save_dir(), name)
        for _ in range(35):                      # 最多等 7 秒新照片出现
            time.sleep(0.2)
            latest = get_latest_camera_photo()
            if latest and latest != before:
                p = subprocess.run(["adb", "pull", latest, local],
                                   capture_output=True, timeout=15)
                if p.returncode == 0 and os.path.exists(local) and os.path.getsize(local) > 0:
                    # pull 成功且已落盘 → 按配置删除手机相册原图（省手机空间）
                    if config.get("DELETE_REMOTE_AFTER_PULL", True):
                        subprocess.run(["adb", "shell", "rm", "-f", '"%s"' % latest],
                                       capture_output=True, timeout=10)
                    if numbered:
                        after_saved()
                    return name, name
                return None, "新照片已出现但拉取失败"
        return None, "快门按下后 7 秒内没发现新照片"

    # 截屏模式（原来的方式）
    png = adb_screencap()
    if not png:
        return None, "截屏失败（检查手机连接/USB调试）"
    if numbered:
        name += ".jpg"
    else:
        name += ".png"
    with open(os.path.join(current_save_dir(), name), "wb") as f:
        f.write(png)
    if numbered:
        after_saved()
    return name, name


# ── 实时画面线程：持续截屏刷新 latest_frame ─────────────────────
frame_paused = False        # 拍照期间暂停投屏线程，避免抢 adb


def frame_worker():
    global latest_frame
    while True:
        while frame_paused:                 # 拍照期间让路，别和拍照抢 adb
            time.sleep(0.1)
        png = adb_screencap()
        if png:
            with lock:
                latest_frame = png
                state["adb"] = "已连接"
            time.sleep(max(0.1, float(config["FRAME_INTERVAL"])))
        else:
            with lock:
                state["adb"] = "未连接"
            time.sleep(2)      # 失败时慢点重试，避免刷屏


# ── 串口线程 ─────────────────────────────────────────────────────
def find_arduino():
    if str(config["COM_PORT"]).upper() != "AUTO":
        return config["COM_PORT"]
    for p in serial.tools.list_ports.comports():
        # 只探测 USB 串口（Arduino 常见 CH340/CP210x/原生 CDC），
        # 跳过"标准串行"等幽灵口——打开它们会 PermissionError/信号灯超时卡死
        desc = (p.description or "").lower()
        if not any(k in desc for k in ("usb", "ch340", "cp210", "arduino")):
            continue
        try:
            s = serial.Serial(p.device, int(config["BAUD"]), timeout=0.5)
            # 打开会触发 CH340 复位 → Arduino 重启跑 setup（横幅输出约 2 秒）。
            # 连续读 2.5 秒拿满横幅，里面含 "TCG Scanner" / "固件版本" / "[握手]"。
            data = b""
            deadline = time.time() + 2.5
            while time.time() < deadline:
                if s.in_waiting:
                    data += s.read(s.in_waiting)
                time.sleep(0.05)
            s.write(b"H\n")                 # 探测握手（顺带确认主机在线）
            time.sleep(0.5)
            while s.in_waiting:
                data += s.read(s.in_waiting)
            s.close()
            got = data.decode("utf-8", "ignore")
            if any(k in got for k in ("[握手]", "[主机]", "[指令]", "TCG", "Scanner", "固件版本")):
                return p.device
        except Exception:
            continue
    return None


ldr_seq = 0                 # [光敏ADC] 行的单调序号（不能用 len(log)，日志有上限会回绕）
ldr_lines = []              # [(seq, line)] 最近若干条 [光敏ADC]


def add_log(text):
    global ldr_seq, ldr_lines, all_seq
    line = "[%s] %s" % (time.strftime("%H:%M:%S"), text)
    with lock:
        all_seq += 1
        all_lines.append((all_seq, line))
        state["log"].append(line)
        if len(state["log"]) > int(config["LOG_MAX"]):
            del state["log"][: len(state["log"]) - int(config["LOG_MAX"])]

    # 测试3 用：单独记录带单调序号的 ADC 行（X 命令为 [光敏ADC]，U 命令为 [ADC]）
    # 注意：ADC 行走独立缓冲，不再写进主日志，避免刷屏
    if ("[光敏ADC]" in line) or ("[ADC]" in line):
        with lock:
            ldr_seq += 1
            ldr_lines.append((ldr_seq, line))
            if len(ldr_lines) > 50:
                del ldr_lines[:len(ldr_lines) - 50]


arduino_serial = None      # 当前打开的串口对象（供网页发指令用）
serial_lock = threading.Lock()


def _serial_send(cmd):
    """走 USB 串口发一条指令"""
    global arduino_serial
    with serial_lock:
        if arduino_serial and arduino_serial.is_open:
            try:
                arduino_serial.write((cmd + "\n").encode())
                return True
            except Exception:
                pass
    return False


def send_command(cmd):
    """发一条指令。优先 USB 数据线；没有数据线就自动走 WiFi。

    链路选择由 config["LINK_MODE"] 控制：
        auto   —— 串口可用就串口，否则 WiFi（默认）
        serial —— 只用串口
        wifi   —— 只用 WiFi
    """
    mode = str(config.get("LINK_MODE", "auto")).lower()

    if mode == "wifi":
        if wifi_link is not None:
            return wifi_link.send(cmd + "\n")
        return False

    if mode == "serial":
        return _serial_send(cmd)

    # auto：数据线优先
    if _serial_send(cmd):
        return True
    if wifi_link is not None and wifi_link.is_connected():
        return wifi_link.send(cmd + "\n")
    return False


heartbeat_started = False


def host_heartbeat():
    """每 5 秒发一次 H 握手：Arduino 据此判断主机在线（离线后按钮恢复演示模式）。
    只启动一次；串口重连不影响。"""
    while True:
        time.sleep(5)
        send_command("H")


def serial_worker():
    global force_reconnect, arduino_serial, heartbeat_started
    while True:
        port = find_arduino()
        if not port:
            with lock:
                state["serial"] = "未找到 Arduino（检查接线/端口/是否被 IDE 占用）"
            time.sleep(5)
            continue
        with lock:
            state["serial"] = "已连接 %s" % port
        try:
            s = serial.Serial(port, int(config["BAUD"]), timeout=0.3)
        except Exception as e:
            with lock:
                state["serial"] = "打开 %s 失败: %s" % (port, e)
            time.sleep(5)
            continue
        with serial_lock:
            arduino_serial = s
        send_command("H")                       # 连接后立即握手一次
        if not heartbeat_started:
            heartbeat_started = True
            threading.Thread(target=host_heartbeat, daemon=True).start()
        try:
            while True:
                if force_reconnect:          # 网页改了 COM/波特率 → 断开重连
                    force_reconnect = False
                    break
                raw = s.readline()
                if not raw:
                    continue
                text = raw.decode("utf-8", "ignore").strip()
                if not text:
                    continue

                # 状态广播行：只更新状态灯，不写进日志（否则每 0.1 秒刷屏）
                if text.startswith("[状态]"):
                    with lock:
                        state["status"] = text.replace("[状态]", "").strip()
                    continue

                add_log(text)

                # 数码管错误码跟随：超时报警 / 光敏遮挡 / 遮挡解除
                if "遮挡已解除" in text:
                    with lock:
                        serial_no = state["serialNo"]
                    send_command("D,%04d" % serial_no)   # 解除 → 回到当前序号
                elif "[遮挡]" in text:
                    send_command("D,E002")               # 遮挡 → 错误码 E002
                if "[报警]" in text:
                    send_command("D,E001")               # 超时 → 错误码 E001

                # 开放协议事件：按钮 / 主机在线 / 光敏读数
                mb = re.search(r"\[按钮\]\s*(D\d+)", text)
                if mb:
                    with lock:
                        state["button"] = mb.group(1)
                mh = re.search(r"\[主机\]\s*(\S+)", text)
                if mh:
                    with lock:
                        state["host"] = mh.group(1)
                ml = re.search(r"LDR=(\d+)", text)
                if ml:
                    with lock:
                        state["ldr"] = int(ml.group(1))
                mv = re.search(r"固件=V([\d.]+)", text)
                if mv:
                    with lock:
                        state["fwVersion"] = "V" + mv.group(1)

                m = re.search(r"计数\s*=\s*(\d+)", text)
                if m:
                    with lock:
                        state["count"] = int(m.group(1))

                if "[成功]" in text:
                    with lock:
                        n = state["count"]
                    threading.Thread(
                        target=auto_capture, args=(n,), daemon=True
                    ).start()
        except Exception as e:
            with lock:
                state["serial"] = "串口断开: %s" % e
            time.sleep(3)
        finally:
            with serial_lock:
                if arduino_serial is s:
                    arduino_serial = None
            try:
                s.close()
            except Exception:
                pass


def auto_capture(n):
    time.sleep(float(config["AUTO_CAPTURE_DELAY"]))   # 成功 1 秒后拍照
    name, err = save_photo("card", n, numbered=True)
    if name:
        add_log("[自动拍照] 已保存 %s" % name)
    else:
        add_log("[自动拍照] 失败: %s" % err)


# ── 网页路由 ─────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template_string(HTML)


@app.route("/frame")
def frame():
    with lock:
        f = latest_frame
    if f:
        return Response(f, mimetype="image/png",
                        headers={"Cache-Control": "no-store"})
    return Response(PLACEHOLDER_SVG, mimetype="image/svg+xml")


def _bytes_to_dataurl(raw, max_w=720, quality=82):
    """把图片字节缩到 max_w 宽并转成 base64 dataURL"""
    try:
        from PIL import Image
        import io
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        if im.width > max_w:
            h = int(im.height * max_w / im.width)
            im = im.resize((max_w, h), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=quality)
        raw = buf.getvalue()
        mime = "image/jpeg"
    except Exception:
        mime = "image/png"
    import base64
    return "data:%s;base64,%s" % (mime, base64.b64encode(raw).decode("ascii")), raw


def _foreground_pkg():
    try:
        p = subprocess.run(["adb", "shell", "dumpsys", "window"],
                           capture_output=True, timeout=10, text=True)
        for ln in (p.stdout or "").splitlines():
            if "mCurrentFocus" in ln:
                return ln.strip()
    except Exception:
        pass
    return ""


def ensure_camera_foreground():
    """拍照前确保相机 App 在前台；不在就拉起来（桌面/别的界面时点屏等于乱点）"""
    pkg = str(config.get("CAMERA_PKG", "com.huawei.camera"))
    focus = _foreground_pkg()
    if pkg in focus:
        return True
    try:
        subprocess.run(["adb", "shell", "input", "keyevent", "KEYCODE_WAKEUP"],
                       capture_output=True, timeout=8)
        subprocess.run(["adb", "shell", "monkey", "-p", pkg,
                        "-c", "android.intent.category.LAUNCHER", "1"],
                       capture_output=True, timeout=15)
        wait_ms = int(config.get("CAMERA_LAUNCH_WAIT_MS", 2500))
        add_log("[拍照] 相机不在前台，已拉起 %s，等 %dms" % (pkg, wait_ms))
        time.sleep(wait_ms / 1000.0)
        return pkg in _foreground_pkg()
    except Exception as e:
        add_log("[拍照] 拉起相机失败：%s" % e)
        return False


def capture_photo_dataurl():
    """点屏对焦 → 真快门拍一张 → (dataURL, 文件名)；失败 (None, 错误)
    与 V1.2 的 save_photo 一致：FOCUS_TAP 打开时先点屏幕中间触发对焦，再按快门。"""
    global frame_paused
    frame_paused = bool(config.get("PAUSE_FRAME_ON_PHOTO", True))
    t_all = time.time()
    t_lapse = {}
    def _mark(name):
        nonlocal t_all
        now = time.time()
        t_lapse[name] = int((now - t_all) * 1000)
        t_all = now
    try:
        if not ensure_camera_foreground():
            return None, "相机不在前台且拉不起来"
        _mark("拉起相机")

        if config.get("FOCUS_TAP"):
            ok_tap = adb_tap(config.get("FOCUS_TAP_X", 50), config.get("FOCUS_TAP_Y", 50))
            wait_ms = int(config.get("FOCUS_WAIT_MS", 600))
            add_log("[对焦] 点屏(%d%%,%d%%) %s，等 %dms"
                    % (config.get("FOCUS_TAP_X", 50), config.get("FOCUS_TAP_Y", 50),
                       "成功" if ok_tap else "失败", wait_ms))
            time.sleep(wait_ms / 1000.0)
        _mark("对焦等待")

        before = get_latest_camera_photo()
        if not trigger_shutter():
            return None, "快门触发失败"
        _mark("点快门")
        latest = None
        for _ in range(75):                      # 最长等 15 秒（大图存盘慢）
            time.sleep(0.2)
            cur = get_latest_camera_photo()
            if cur and cur != before:
                latest = cur
                break
        if not latest:
            add_log("[拍照] 15 秒内没等到新照片（拍照前:%s）" % (os.path.basename(before) if before else "无"))
            return None, "等不到新照片"
        _mark("等新照片落盘")
        add_log("[拍照] 新照片 %s" % os.path.basename(latest))
        p = subprocess.run(["adb", "exec-out", "cat", latest],
                           capture_output=True, timeout=25)
        if p.returncode != 0 or not p.stdout:
            return None, "取回照片失败"
        _mark("adb 取回")
        url, _raw = _bytes_to_dataurl(p.stdout, int(config.get("VISION_MAX_WIDTH", 720)))
        _mark("缩图编码")
        add_log("[拍照] 分段耗时 ms：拉起 %d / 对焦 %d / 快门 %d / 等落盘 %d / 取回 %d / 缩图 %d（合计 %d）"
                % (t_lapse.get("拉起相机", 0), t_lapse.get("对焦等待", 0), t_lapse.get("点快门", 0),
                   t_lapse.get("等新照片落盘", 0), t_lapse.get("adb 取回", 0), t_lapse.get("缩图编码", 0),
                   sum(t_lapse.values())))
        return url, os.path.basename(latest)
    except Exception as e:
        return None, "%s" % e
    finally:
        frame_paused = False


@app.route("/vision/photo")
def vision_photo():
    """图像识别用：点屏对焦 → 真快门拍一张 → 返回 base64 dataURL（不落本地卡图目录）"""
    url, info = capture_photo_dataurl()
    if not url:
        return jsonify({"ok": False, "error": info})
    raw_len = int(len(url.split(",", 1)[-1]) * 3 / 4)
    add_log("[图像识别] 已拍照 %s（约 %d KB）" % (info, raw_len // 1024))
    return jsonify({"ok": True, "mime": "image/jpeg", "bytes": raw_len,
                    "file": info, "image": url})


@app.route("/vision/capture")
def vision_capture():
    """给图像识别用：抓一帧手机画面，缩到合适宽度后返回 base64 dataURL"""
    try:
        png = adb_screencap()
        if not png:
            with lock:
                png = latest_frame
        if not png:
            return jsonify({"ok": False, "error": "抓不到手机画面（手机连上了吗？）"})

        url, raw = _bytes_to_dataurl(png, int(config.get("VISION_MAX_WIDTH", 720)))
        return jsonify({"ok": True, "mime": "image/jpeg", "bytes": len(raw), "image": url})
    except Exception as e:
        return jsonify({"ok": False, "error": "%s" % e})


@app.route("/capture", methods=["POST"])
def capture():
    name, err = save_photo("manual")
    if not name:
        return jsonify({"ok": False, "error": err})
    add_log("[手动拍照] 已保存 %s" % name)
    return jsonify({"ok": True, "name": name})


@app.route("/scan", methods=["POST"])
def scan():
    """下一张：给 Arduino 发 'c' 推卡。卡通过后网页会自动拍照。"""
    ok = send_command("c")
    if ok:
        send_command("D,BUSY")   # 数码管显示运行中（4 字母）
    return jsonify({"ok": ok})


@app.route("/focus", methods=["POST"])
def focus():
    ok = adb_tap(config.get("FOCUS_TAP_X", 50), config.get("FOCUS_TAP_Y", 50))
    return jsonify({"ok": ok, "x": config.get("FOCUS_TAP_X", 50),
                    "y": config.get("FOCUS_TAP_Y", 50)})


@app.route("/photo/<path:name>")
def photo(name):
    # 兼容子目录：name 形如 "A0-000-01/A0-000-01-0001.jpg"
    safe = name.replace("\\", "/")
    path = os.path.join(save_dir(), safe)
    if os.path.exists(path) and os.path.isfile(path):
        ext = os.path.splitext(name)[1].lower()
        mime = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"
        return Response(open(path, "rb").read(), mimetype=mime)
    return jsonify({"ok": False, "error": "不存在"}), 404


@app.route("/photos")
def photos():
    """列出 save_dir 下所有子库照片，相对路径形如 库号/图片名，最新在前。"""
    root = save_dir()
    names = []
    if os.path.isdir(root):
        for d in sorted(os.listdir(root)):
            sub = os.path.join(root, d)
            if os.path.isdir(sub):
                names += [os.path.join(d, f) for f in sorted(os.listdir(sub), reverse=True)]
    return jsonify({"photos": sorted(names, reverse=True)[:60]})


@app.route("/inspect")
def inspect():
    """检测保存目录：按子库统计照片数量、命名格式、起止序号、文件总大小。"""
    root = save_dir()
    libs = []
    if os.path.isdir(root):
        for d in sorted(os.listdir(root)):
            sub = os.path.join(root, d)
            if not os.path.isdir(sub):
                continue
            files = sorted(os.listdir(sub))
            photos = [f for f in files if f.lower().endswith((".jpg", ".jpeg", ".png"))]
            total_size = sum(os.path.getsize(os.path.join(sub, f)) for f in files
                             if os.path.isfile(os.path.join(sub, f)))
            # 命名格式检测：A0-000-01-0001.jpg 型 → 提取序号段
            seqs = []
            for f in photos:
                m = re.match(r"^.*-(\d{4})\.(?:jpg|jpeg|png)$", f, re.IGNORECASE)
                if m:
                    seqs.append(int(m.group(1)))
            libs.append({
                "libCode": d,
                "count": len(photos),
                "totalSize": total_size,          # 字节
                "sizeMB": round(total_size / 1024 / 1024, 2),
                "minSeq": min(seqs) if seqs else None,   # 起始序号（如 1）
                "maxSeq": max(seqs) if seqs else None,   # 末尾序号
                "seqCount": len(seqs),                   # 序号命中的张数
                "sample": photos[0] if photos else "",    # 最新一张（列表序）
            })
    return jsonify({"saveDir": root, "libs": libs, "totalLibs": len(libs)})


@app.route("/status")
def status():
    with lock:
        return jsonify({
            "count": state["count"],
            "serial": state["serial"],
            "adb": state["adb"],
            "status": state["status"],
            "log": state["log"][-30:],
            # 设备连接页编号状态
            "serialNo": state["serialNo"],
            "libCode": state["libCode"],
            "threshold": state["threshold"],
            "needsLabel": state["needsLabel"],
            "autoRunning": state["autoRunning"],
            "saveDir": save_dir(),
            # 开放协议事件
            "host": state.get("host", "未知"),
            "ldr": state.get("ldr", None),
            "button": state.get("button", None),
            "fwVersion": state.get("fwVersion", None),
            # V1.3 双链路状态
            "link": link_info(),
        })


# ── 设备连接页：编号 / 贴标签 / 自动运转 / 前端报警 ────────────
def bump_lib_batch(lib):
    """库号批次末尾段 +1：A0-000-01 → A0-000-02。解析失败返回原值。"""
    m = re.match(r"^(.*-)(\d{2})$", str(lib).strip())
    if not m:
        return str(lib).strip()
    return m.group(1) + str(int(m.group(2)) + 1).zfill(2)


@app.route("/serial", methods=["POST"])
def serial_route():
    """设置编号：{libCode, serial, threshold, saveDir} → 写 config + state。"""
    data = request.get_json(force=True) or {}
    with lock:
        if "libCode" in data and str(data["libCode"]).strip():
            config["LIB_CODE"] = str(data["libCode"]).strip()
            state["libCode"] = config["LIB_CODE"]
        if "serial" in data and str(data["serial"]).strip().isdigit():
            config["START_SERIAL"] = int(data["serial"])
            state["serialNo"] = int(data["serial"])
        if "threshold" in data and str(data["threshold"]).strip().isdigit():
            config["THRESHOLD"] = int(data["threshold"])
            state["threshold"] = int(data["threshold"])
        if "saveDir" in data and str(data["saveDir"]).strip():
            config["SAVE_DIR"] = str(data["saveDir"]).strip()
        state["needsLabel"] = False
        state["autoRunning"] = False
    save_config()
    send_command("D,%04d" % state["serialNo"])   # 同步数码管到起始序号
    return jsonify({"ok": True, "libCode": state["libCode"],
                    "serialNo": state["serialNo"], "threshold": state["threshold"],
                    "saveDir": save_dir()})


@app.route("/label-confirm", methods=["POST"])
def label_confirm():
    """贴标签确认：库号批次+1、序号固定重置为 0001、停自动运转、建新库号文件夹。"""
    with lock:
        config["LIB_CODE"] = bump_lib_batch(state["libCode"])
        state["libCode"] = config["LIB_CODE"]
        config["START_SERIAL"] = 1          # 下一批固定从 0001 开始（持久化，重启后仍一致）
        state["serialNo"] = 1
        state["needsLabel"] = False
        state["autoRunning"] = False
    save_config()
    current_save_dir()          # 自动创建新批次文件夹
    add_log("[批次] 已贴标签，新批次 %s 从 %04d 起" % (state["libCode"], state["serialNo"]))
    send_command("D,%04d" % state["serialNo"])   # 数码管回到新批次起始序号
    return jsonify({"ok": True, "libCode": state["libCode"],
                    "serialNo": state["serialNo"]})


def auto_worker():
    """自动运转：不断发 c 推卡，等 serialNo 变化（=拍完一张）再推下一张；序号到阈值即停。"""
    def status_blocked():
        """当前串口状态是否遮挡/报警（自动运转需停）"""
        with lock:
            st = state["status"]
        return "遮挡" in st or "报警" in st

    while True:
        with lock:
            if not state["autoRunning"] or state["needsLabel"]:
                break
        if status_blocked():          # 推卡前发现遮挡/报警 → 自动停止，不硬推
            add_log("[自动] 检测到%s，自动停止运转" % state["status"])
            break
        ok = send_command("c")
        if not ok:
            add_log("[自动] 推卡指令失败（串口未连接）")
            break
        with lock:
            base_no = state["serialNo"]
        # 等这一张卡通过 + 拍完：serialNo 变 / 超时(约 12 秒) / 出现遮挡报警即停
        waited = 0
        while waited < 120:
            time.sleep(0.1)
            waited += 1
            with lock:
                if not state["autoRunning"] or state["needsLabel"]:
                    return
                if state["serialNo"] != base_no:
                    break
            if status_blocked():      # 等待中卡被挡/超时 → 自动停止
                add_log("[自动] 检测到%s，自动停止运转" % state["status"])
                with lock:
                    state["autoRunning"] = False
                return
        else:
            add_log("[自动] 等待超时，卡未通过")
    with lock:
        state["autoRunning"] = False


@app.route("/auto/start", methods=["POST"])
def auto_start():
    # 启动自动运转前先停掉测试2，避免两边同时抢电机
    try:
        if feed_seq is not None and feed_seq.running:
            feed_seq.stop()
            time.sleep(0.3)
            send_command("M,0,1,0")
            send_command("t")
            add_log("[自动] 已自动停止测试2，避免冲突")
    except Exception:
        pass

    with lock:
        state["autoRunning"] = True
        state["needsLabel"] = False
    threading.Thread(target=auto_worker, daemon=True).start()
    add_log("[自动] 自动运转已开始 -> 阈值 %d" % state["threshold"])
    send_command("D,BUSY")
    return jsonify({"ok": True, "autoRunning": True})


@app.route("/auto/stop", methods=["POST"])
def auto_stop():
    with lock:
        state["autoRunning"] = False
    add_log("[自动] 自动运转已停止")
    send_command("D,STOP")   # 数码管显示停止
    return jsonify({"ok": True, "autoRunning": False})


@app.route("/beep", methods=["POST"])
def beep():
    """前端→设备报警：给 Arduino 发 'b' 蜂鸣器响一声。"""
    ok = send_command("b")
    return jsonify({"ok": ok})


@app.route("/hardware", methods=["POST"])
def hardware():
    """通用硬件指令透传：{cmd: "M,F,255,600"} / {cmd: "L,red,blink,3"} /
    {cmd: "B,1000,500,2"} 等，原样发串口。前端/后端以后加功能走这个口，不用改固件。"""
    data = request.get_json(force=True) or {}
    cmd = str(data.get("cmd", "")).strip()
    if not cmd:
        return jsonify({"ok": False, "error": "缺少 cmd 字段"}), 400
    ok = send_command(cmd)
    add_log("[硬件] 发送 %s" % cmd)
    return jsonify({"ok": ok, "cmd": cmd})


# ── V1.3 链路管理：切换 USB / WiFi，重启 WiFi 握手 ────────────
@app.route("/link", methods=["GET", "POST"])
def link_route():
    if request.method == "GET":
        return jsonify(link_info())

    data = request.get_json(force=True) or {}

    if "mode" in data:
        m = str(data["mode"]).lower()
        if m in ("auto", "serial", "wifi"):
            config["LINK_MODE"] = m
            add_log("[链路] 模式切换为 %s" % m)

    changed_wifi = False
    for k, cast in (("ESP_IP", str), ("ESP_PORT", int), ("WIFI_LISTEN_PORT", int)):
        if k in data:
            try:
                config[k] = cast(data[k])
                changed_wifi = True
            except Exception:
                pass

    save_config()

    if changed_wifi or data.get("wifi_restart"):
        if wifi_link is not None:
            wifi_link.stop()
            time.sleep(0.4)
            if WifiLink is not None:
                newlink = WifiLink(
                    esp_ip=str(config.get("ESP_IP", "192.168.1.100")),
                    esp_port=int(config.get("ESP_PORT", 8080)),
                    my_port=int(config.get("WIFI_LISTEN_PORT", 9000)),
                    on_line=_wifi_on_line,
                )
                newlink.start()
                globals()["wifi_link"] = newlink
            add_log("[链路] WiFi 握手已重启")

    return jsonify({"ok": True, "link": link_info()})


# ── 手机无线 ADB：状态 / 发现 / 连接 / 一键配对 / 断开 ────────────
# ── 送料时序测试（测试2）──
# ── 调试1：半速到光敏停 ──
@app.route("/main/status")
def main_status():
    if main_flow is None:
        return jsonify({"ok": False, "error": "main_flow 未加载", "running": False})
    d = main_flow.status()
    d["ok"] = True
    return jsonify(d)


@app.route("/main/start", methods=["POST"])
def main_start():
    if main_flow is None:
        return jsonify({"ok": False, "error": "main_flow 未加载"})
    data = request.get_json(force=True, silent=True) or {}
    mode = str(data.get("mode") or "auto")
    # 与各测试互斥
    try:
        for eng in (feed_seq, ldr_probe, speed_stop, feed_auto, feed_push):
            if eng is not None and getattr(eng, "running", False):
                eng.stop()
        state["autoRunning"] = False
        time.sleep(0.3)
    except Exception:
        pass
    ok, msg = main_flow.start(mode)
    add_log("[主流程] " + msg)
    return jsonify({"ok": ok, "msg": msg, "mode": main_flow.mode})


@app.route("/main/stop", methods=["POST"])
def main_stop():
    if main_flow is None:
        return jsonify({"ok": False})
    main_flow.stop()
    try:
        send_command("K,0x10,off")
        send_command("t")
    except Exception:
        pass
    return jsonify({"ok": True})


@app.route("/rules/get")
def rules_get():
    rules = config.get("SORT_RULES")
    if not rules or not isinstance(rules, dict):
        rules = _sort_rules.default_rules() if _sort_rules else {}
    return jsonify({"ok": True, "rules": rules,
                    "types": (_sort_rules.RULE_TYPES if _sort_rules else []),
                    "outletMap": (_sort_rules.OUTLET_NAMES if _sort_rules else {})})


@app.route("/rules/save", methods=["POST"])
def rules_save():
    data = request.get_json(force=True, silent=True) or {}
    rules = data.get("rules")
    if not isinstance(rules, dict):
        return jsonify({"ok": False, "error": "rules 不是对象"})
    config["SORT_RULES"] = rules
    # identify 方式的独立键同步一份，方便其它地方读
    if rules.get("identMode"):
        config["SORT_IDENT_MODE"] = rules.get("identMode")
    if rules.get("aiKeyword") is not None:
        config["SORT_AI_KEYWORD"] = rules.get("aiKeyword")
    try:
        save_config()
    except Exception as e:
        return jsonify({"ok": False, "error": "保存失败: %s" % e})
    add_log("[规则] 已保存到 config.json（规则集 %s，识别方式 %s）"
            % (rules.get("ruleSet", 1), rules.get("identMode", "")))
    return jsonify({"ok": True})


@app.route("/feedpush/status")
def feedpush_status():
    if feed_push is None:
        return jsonify({"ok": False, "error": "feed_push 未加载", "running": False})
    d = feed_push.status()
    d["ok"] = True
    return jsonify(d)


@app.route("/feedpush/start", methods=["POST"])
def feedpush_start():
    if feed_push is None:
        return jsonify({"ok": False, "error": "feed_push 未加载"})
    data = request.get_json(force=True, silent=True) or {}
    try:
        if state.get("autoRunning"):
            state["autoRunning"] = False
        for eng in (feed_seq, ldr_probe, speed_stop, feed_auto):
            if eng is not None and getattr(eng, "running", False):
                eng.stop()
    except Exception:
        pass
    ok, msg = feed_push.start(
        channel=data.get("channel"),
        pwm=data.get("pwm"),
        th=data.get("th"),
        intervalMs=data.get("intervalMs"),
        maxMs=data.get("maxMs"),
    )
    return jsonify({"ok": ok, "msg": msg, "channel": feed_push.channel,
                    "pwm": feed_push.pwm, "th": feed_push.th})


@app.route("/feedpush/stop", methods=["POST"])
def feedpush_stop():
    if feed_push is None:
        return jsonify({"ok": False})
    feed_push.stop()
    try:
        send_command("M,S")
    except Exception:
        pass
    return jsonify({"ok": True})


@app.route("/feedpush/clear", methods=["POST"])
def feedpush_clear():
    if feed_push is None:
        return jsonify({"ok": False})
    feed_push.clear()
    return jsonify({"ok": True})


@app.route("/feedauto/status")
def feedauto_status():
    if feed_auto is None:
        return jsonify({"ok": False, "error": "feed_auto 未加载", "running": False})
    d = feed_auto.status()
    d["ok"] = True
    return jsonify(d)


@app.route("/feedauto/start", methods=["POST"])
def feedauto_start():
    if feed_auto is None:
        return jsonify({"ok": False, "error": "feed_auto 未加载"})
    data = request.get_json(force=True, silent=True) or {}
    try:
        if state.get("autoRunning"):
            state["autoRunning"] = False
    except Exception:
        pass
    ok, msg = feed_auto.start(
        channel=data.get("channel"),
        th=data.get("th"),
        intervalMs=data.get("intervalMs"),
    )
    return jsonify({"ok": ok, "msg": msg, "channel": feed_auto.channel, "th": feed_auto.th})


@app.route("/feedauto/stop", methods=["POST"])
def feedauto_stop():
    if feed_auto is None:
        return jsonify({"ok": False})
    feed_auto.stop()
    try:
        send_command("t")
    except Exception:
        pass
    return jsonify({"ok": True})


@app.route("/speed/status")
def speed_status():
    if speed_stop is None:
        return jsonify({"ok": False, "error": "speed_stop 未加载", "running": False})
    d = speed_stop.status()
    d["ok"] = True
    return jsonify(d)


@app.route("/speed/start", methods=["POST"])
def speed_start():
    if speed_stop is None:
        return jsonify({"ok": False, "error": "speed_stop 未加载"})
    data = request.get_json(force=True, silent=True) or {}
    try:
        if state.get("autoRunning"):
            state["autoRunning"] = False
        if feed_seq is not None and feed_seq.running:
            feed_seq.stop()
        if ldr_probe is not None and ldr_probe.running:
            ldr_probe.stop()
    except Exception:
        pass
    ok, msg = speed_stop.start(
        mode=data.get("mode"),
        channel=data.get("channel"),
        pwm=data.get("pwm"),
        intervalMs=data.get("intervalMs"),
        ratio=data.get("ratio"),
        delayMs=data.get("delayMs"),
    )
    return jsonify({"ok": ok, "msg": msg, "mode": speed_stop.mode,
                    "channel": speed_stop.channel, "pwm": speed_stop.pwm,
                    "delayMs": speed_stop.delay_ms})


@app.route("/speed/stop", methods=["POST"])
def speed_stop_now():
    if speed_stop is None:
        return jsonify({"ok": False})
    speed_stop.stop()
    try:
        send_command("M,S")
    except Exception:
        pass
    return jsonify({"ok": True})


@app.route("/speed/clear", methods=["POST"])
def speed_clear():
    if speed_stop is None:
        return jsonify({"ok": False})
    speed_stop.clear()
    return jsonify({"ok": True})


@app.route("/outlets/save", methods=["POST"])
def outlets_save():
    """把网页上 8 个分拣口的参数存进 config.json，供之后自动化使用"""
    data = request.get_json(force=True, silent=True) or {}
    arr = data.get("outlets")
    if not isinstance(arr, list) or len(arr) == 0:
        return jsonify({"ok": False, "error": "outlets 不是数组"})
    clean = []
    for it in arr:
        try:
            clean.append({
                "name": str(it.get("name", "")),
                "addr": str(it.get("addr", "")),
                "aMs": int(it.get("aMs", 0)),
                "bMs": int(it.get("bMs", 0)),
            })
        except Exception:
            pass
    config["SORT_OUTLETS"] = clean
    config["SORT_OUTLETS_DATE"] = time.strftime("%Y-%m-%d %H:%M:%S")
    try:
        save_config()
    except Exception as e:
        return jsonify({"ok": False, "error": "保存失败: %s" % e})
    add_log("[分拣口] 已保存 %d 个出口参数到 config.json" % len(clean))
    return jsonify({"ok": True, "count": len(clean), "savedAt": config["SORT_OUTLETS_DATE"]})


@app.route("/outlets/get")
def outlets_get():
    return jsonify({
        "ok": True,
        "outlets": config.get("SORT_OUTLETS", []),
        "savedAt": config.get("SORT_OUTLETS_DATE", ""),
    })


@app.route("/seq/status")
def seq_status():
    if feed_seq is None:
        return jsonify({"ok": False, "error": "feed_seq 未加载", "running": False})
    d = feed_seq.status()
    d["ok"] = True
    d["ldr"] = _seq_get_ldr()
    return jsonify(d)


@app.route("/seq/start", methods=["POST"])
def seq_start():
    if feed_seq is None:
        return jsonify({"ok": False, "error": "feed_seq 未加载"})
    data = request.get_json(force=True, silent=True) or {}
    mode = data.get("mode") or "run"
    # 允许临时覆盖参数
    for k, attr in (("gateMs", "gate_ms"), ("gateBufferMs", "gate_buffer_ms"),
                    ("darkPct", "dark_pct"), ("lightPct", "light_pct"),
                    ("measureMs", "measure_ms")):
        if k in data:
            try:
                setattr(feed_seq, attr, int(data[k]))
            except Exception:
                pass
    # ★ 启动测试2 前必须先停掉「自动运转」，否则两边会同时给电机下指令
    try:
        if state.get("autoRunning"):
            state["autoRunning"] = False
            add_log("[测试2] 已自动停止「自动运转」，避免冲突")
            send_command("M,0,1,0")
            send_command("t")
            time.sleep(0.3)
    except Exception:
        pass

    ok, msg = feed_seq.start(mode)
    return jsonify({"ok": ok, "msg": msg, "mode": mode})


@app.route("/seq/stop", methods=["POST"])
def seq_stop():
    if feed_seq is None:
        return jsonify({"ok": False, "error": "feed_seq 未加载"})
    feed_seq.stop()
    return jsonify({"ok": True})


@app.route("/seq/clear", methods=["POST"])
def seq_clear():
    if feed_seq is None:
        return jsonify({"ok": False})
    feed_seq.clear()
    return jsonify({"ok": True})


# ── 测试3：6 路光敏监视 ──
@app.route("/ldr/status")
def ldr_status():
    if ldr_probe is None:
        return jsonify({"ok": False, "error": "ldr_probe 未加载", "running": False})
    d = ldr_probe.status()
    d["ok"] = True
    return jsonify(d)


@app.route("/ldr/start", methods=["POST"])
def ldr_start():
    if ldr_probe is None:
        return jsonify({"ok": False, "error": "ldr_probe 未加载"})
    data = request.get_json(force=True, silent=True) or {}
    for k, attr in (("intervalMs", "interval_ms"), ("unitTh", "unit_th"), ("a7Th", "a7_th")):
        if k in data:
            try:
                setattr(ldr_probe, attr, int(data[k]))
            except Exception:
                pass
    ok, msg = ldr_probe.start()
    return jsonify({"ok": ok, "msg": msg, "intervalMs": ldr_probe.interval_ms})


@app.route("/ldr/stop", methods=["POST"])
def ldr_stop():
    if ldr_probe is None:
        return jsonify({"ok": False})
    ldr_probe.stop()
    return jsonify({"ok": True})


@app.route("/ldr/thresholds", methods=["GET"])
def ldr_th_get():
    ths = config.get("LDR_THRESHOLDS") or {}
    return jsonify({"ok": True, "thresholds": ths})


@app.route("/ldr/thresholds", methods=["POST"])
def ldr_th_set():
    data = request.get_json(force=True, silent=True) or {}
    ths = data.get("thresholds")
    if not isinstance(ths, dict):
        return jsonify({"ok": False, "error": "thresholds 不是对象"})
    clean = {}
    for k, v in ths.items():
        try:
            clean[str(k)] = int(v)
        except Exception:
            pass
    config["LDR_THRESHOLDS"] = clean
    try:
        save_config()
    except Exception as e:
        return jsonify({"ok": False, "error": "保存失败: %s" % e})
    add_log("[光敏] 已保存 6 路阈值")
    return jsonify({"ok": True, "thresholds": clean})


@app.route("/ldr/once", methods=["POST"])
def ldr_once():
    if ldr_probe is None:
        return jsonify({"ok": False, "error": "ldr_probe 未加载"})
    try:
        return jsonify(ldr_probe.read_once())
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


@app.route("/ldr/clear", methods=["POST"])
def ldr_clear():
    if ldr_probe is None:
        return jsonify({"ok": False})
    ldr_probe.clear()
    return jsonify({"ok": True})


@app.route("/phone/status")
def phone_status():
    if phone_link is None:
        return jsonify({"ok": False, "error": "phone_link 未加载"})
    st = phone_link.status()
    st["ok"] = True
    st["frameInterval"] = config.get("FRAME_INTERVAL")
    return jsonify(st)


@app.route("/phone/discover")
def phone_discover():
    if phone_link is None:
        return jsonify({"ok": False, "error": "phone_link 未加载", "devices": []})
    try:
        found = phone_link.discover(do_connect=False)
        return jsonify({"ok": True, "devices": found})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e), "devices": []})


@app.route("/phone/connect", methods=["POST"])
def phone_connect():
    if phone_link is None:
        return jsonify({"ok": False, "error": "phone_link 未加载"})
    data = request.get_json(force=True, silent=True) or {}
    ep = (data.get("endpoint") or "").strip()
    try:
        if not ep:
            found = phone_link.discover(do_connect=True)
            if phone_link.online:
                phone_serial_arg()
                return jsonify({"ok": True, "endpoint": phone_link.endpoint})
            return jsonify({"ok": False, "error": phone_link.last_error or "未发现设备", "devices": found})
        ok = phone_link.connect(ep)
        if ok:
            config["PHONE_ADB"] = ep
            save_config()
            phone_serial_arg()
        return jsonify({"ok": ok, "endpoint": ep, "error": "" if ok else phone_link.last_error})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


@app.route("/phone/pair_usb", methods=["POST"])
def phone_pair_usb():
    if phone_link is None:
        return jsonify({"ok": False, "error": "phone_link 未加载"})
    try:
        r = phone_link.pair_usb()
        if r.get("ok") and r.get("endpoint"):
            config["PHONE_ADB"] = r["endpoint"]
            save_config()
            phone_serial_arg()
        return jsonify(r)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


@app.route("/phone/disconnect", methods=["POST"])
def phone_disconnect():
    if phone_link is None:
        return jsonify({"ok": False, "error": "phone_link 未加载"})
    try:
        ok = phone_link.disconnect()
        config["PHONE_ADB"] = ""
        try:
            os.environ.pop("ANDROID_SERIAL", None)
        except Exception:
            pass
        save_config()
        return jsonify({"ok": ok})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── 参数配置：GET 读取，POST 修改并保存到 config.json ────────────
@app.route("/config", methods=["GET", "POST"])
def config_route():
    global force_reconnect
    if request.method == "GET":
        return jsonify(config)

    data = request.get_json(force=True) or {}
    keys = set(CONFIG_DEFAULTS) & set(data.keys())
    if not keys:
        return jsonify({"ok": False, "error": "没有可修改的参数"}), 400

    # 布尔字段：以布尔类型存取（存字符串 "True"/"False" 会让前端 !! 判断永远为真，开关关不掉）
    BOOL_FIELDS = ("FOCUS_TAP", "AUTO_MODE", "DELETE_REMOTE_AFTER_PULL",
                   "START_CALIB", "MAIN_PRECHECK", "SORT_LOCAL_STOP",
                   "PAUSE_FRAME_ON_PHOTO")
    changed = {}
    for k in keys:
        v = data[k]
        try:
            if k in BOOL_FIELDS:
                v = bool(v) if not isinstance(v, str) else v.strip().lower() in ("1", "true", "yes", "on")
            elif k in ("FRAME_INTERVAL", "AUTO_CAPTURE_DELAY"):
                v = float(v)
                if v < 0:
                    raise ValueError
            elif k in ("LOG_MAX", "BAUD", "SHUTTER_TAP_X", "SHUTTER_TAP_Y", "FOCUS_TAP_X", "FOCUS_TAP_Y"):
                v = int(v)
            elif k.endswith("_MS"):
                v = int(v)
            else:
                v = str(v)
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "%s 数值不合法" % k}), 400

        if config.get(k) != v:
            config[k] = v
            changed[k] = v

    save_config()
    # COM 口 / 波特率变了 → 让串口线程重连
    if "COM_PORT" in changed or "BAUD" in changed:
        force_reconnect = True
    return jsonify({"ok": True, "changed": changed, "config": config})


HTML = r"""<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>TCG 拍照控制台</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; font-family:"Microsoft YaHei",sans-serif; background:#1e1e1e; color:#eee; }
  #wrap { display:flex; height:100vh; }
  #left { flex:1.5; background:#000; display:flex; align-items:center; justify-content:center; }
  #left img { max-width:100%; max-height:100%; object-fit:contain; }
  #right { flex:1; padding:16px; overflow-y:auto; border-left:1px solid #333; }
  h1 { font-size:18px; margin:0 0 8px; }
  h3 { font-size:14px; margin:14px 0 6px; border-bottom:1px solid #333; padding-bottom:4px; }
  .row { margin:8px 0; }
  .btn { padding:10px 18px; font-size:15px; border:none; border-radius:6px;
         cursor:pointer; margin-right:8px; }
  .btn-main { background:#4CAF50; color:#fff; }
  .btn-ghost { background:#333; color:#eee; }
  .btn-scan { background:#ff9800; color:#fff; width:100%; padding:14px;
              font-size:17px; border:none; border-radius:8px; cursor:pointer;
              box-shadow:0 2px 8px rgba(255,152,0,.4); }
  .btn-scan:active { transform:scale(.98); }
  .val { color:#4CAF50; font-weight:bold; }

  /* 状态灯 */
  .statusline { font-size:16px; margin:10px 0; }
  .light { display:inline-block; width:14px; height:14px; border-radius:50%;
           vertical-align:middle; margin-right:8px; background:#666;
           box-shadow:0 0 8px currentColor; }
  .light.blink { animation: blink .4s step-start infinite; }
  @keyframes blink { 50% { opacity:.15; } }
  #statusText { font-weight:bold; }

  #log { background:#0d0d0d; height:150px; overflow-y:auto; font-family:Consolas,monospace;
         font-size:12px; padding:8px; border-radius:6px; white-space:pre-wrap; }
  #photos img { width:84px; height:84px; object-fit:cover; margin:3px; border:1px solid #444;
                cursor:pointer; border-radius:4px; }
  #msg { min-height:20px; color:#ffb74d; font-size:13px; }
  #conn { font-size:13px; color:#bbb; }

  /* 参数调节 */
  #cfg { background:#252525; border:1px solid #333; border-radius:8px; padding:10px; margin-top:12px; }
  #cfg .cfgrow { display:flex; align-items:center; margin:6px 0; }
  #cfg label { width:120px; font-size:13px; color:#bbb; flex-shrink:0; }
  #cfg input { flex:1; padding:5px 8px; border:1px solid #444; border-radius:4px;
               background:#1e1e1e; color:#eee; font-size:13px; }
  #cfgmsg { color:#4CAF50; font-size:12px; margin-left:8px; }
</style>
</head>
<body>
<div id="wrap">
  <div id="left">
    <img id="live" src="/frame" alt="手机实时画面">
  </div>
  <div id="right">
    <h1>TCG 卡牌扫描 · 拍照控制台</h1>
    <div class="row" id="conn">
      计数：<span class="val" id="count">-</span> ｜
      串口：<span id="serial">-</span> ｜
      手机：<span id="adb">-</span>
    </div>

    <!-- 状态灯：正常=绿 等待=黄 报警/遮挡=红闪 -->
    <div class="statusline">
      <span class="light" id="statusLight"></span>
      <span id="statusText">-</span>
    </div>

    <div class="row">
      <button class="btn btn-scan" onclick="scanNext()">▶️ 下一张（推卡 + 自动拍照）</button>
    </div>

    <div class="row">
      <button class="btn btn-main" onclick="manualCapture()">📷 立即拍照</button>
      <button class="btn btn-ghost" onclick="tapFocus()">📍 点击对焦</button>
      <button class="btn btn-ghost" onclick="refreshPhotos()">🔄 刷新照片</button>
    </div>
    <div id="msg"></div>

    <h3>串口日志</h3>
    <div id="log"></div>

    <h3>已保存照片（点击放大）</h3>
    <div id="photos"></div>

    <h3>参数调节（改完点保存）</h3>
    <div id="cfg">
      <div class="cfgrow"><label>COM 端口</label><input id="cfg_port" placeholder="AUTO 或 COM3"></div>
      <div class="cfgrow"><label>波特率</label><input id="cfg_baud" type="number"></div>
      <div class="cfgrow"><label>画面刷新(秒)</label><input id="cfg_fi" type="number" step="0.1" min="0.1"></div>
      <div class="cfgrow"><label>拍照延迟(秒)</label><input id="cfg_acd" type="number" step="0.1" min="0"></div>
      <div class="cfgrow"><label>日志条数</label><input id="cfg_lm" type="number" min="10"></div>
      <div class="cfgrow"><label>拍照前对焦</label><input id="cfg_focus" type="checkbox" style="width:auto; transform:scale(1.4);"></div>
      <div class="cfgrow"><label>对焦X (%)</label><input id="cfg_fx" type="number" min="0" max="100"></div>
      <div class="cfgrow"><label>对焦Y (%)</label><input id="cfg_fy" type="number" min="0" max="100"></div>
      <div class="cfgrow"><label>拍照方式</label>
        <select id="cfg_mode" style="flex:1; padding:5px 8px; border:1px solid #444; border-radius:4px; background:#1e1e1e; color:#eee; font-size:13px;">
          <option value="camera">相机真拍（全分辨率）</option>
          <option value="screencap">截屏（屏幕画面）</option>
        </select>
      </div>
      <div class="cfgrow"><label>快门位置X (%)</label><input id="cfg_sx" type="number" min="0" max="100"></div>
      <div class="cfgrow"><label>快门位置Y (%)</label><input id="cfg_sy" type="number" min="0" max="100"></div>
      <div class="cfgrow">
        <button class="btn btn-ghost" style="padding:8px 14px;" onclick="saveConfig()">💾 保存参数</button>
        <span id="cfgmsg"></span>
      </div>
    </div>
  </div>
</div>

<script>
function setMsg(t){ document.getElementById('msg').textContent = t; }

var STATUS_COLOR = {
  '报警':   '#ff3b30',
  '遮挡':   '#ff3b30',
  '等待卡': '#ffcc00',
  '待命':   '#34c759',
  '已停止': '#888888'
};
var STATUS_LABEL = {
  '报警':   '报警中（蜂鸣器响）',
  '遮挡':   '遮挡报警（检查光敏）',
  '等待卡': '等待卡通过…',
  '待命':   '正常运行中',
  '已停止': '已停止'
};
var prevStatus = '';

function beep(){   // 报警时电脑响一声"嘀"（需要浏览器允许声音）
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 1000;
    g.gain.setValueAtTime(0.25, ctx.currentTime);
    o.start(); o.stop(ctx.currentTime + 0.15);
  } catch(e){}
}

function setStatus(s){
  var light = document.getElementById('statusLight');
  var txt = document.getElementById('statusText');
  txt.textContent = STATUS_LABEL[s] || s;
  var c = STATUS_COLOR[s] || '#888';
  light.style.background = c;
  light.style.color = c;
  if (s === '报警' || s === '遮挡') light.classList.add('blink');
  else light.classList.remove('blink');
  if ((s === '报警' || s === '遮挡') && prevStatus !== s) beep();  // 进入报警才响
  prevStatus = s;
}

async function pollStatus(){
  try {
    const r = await fetch('/status');
    const d = await r.json();
    document.getElementById('count').textContent =
        (d.count === null || d.count === undefined) ? '-' : d.count;
    document.getElementById('serial').textContent = d.serial;
    document.getElementById('adb').textContent = d.adb;
    document.getElementById('log').textContent = d.log.join('\n');
    setStatus(d.status);
    var box = document.getElementById('log');
    box.scrollTop = box.scrollHeight;
  } catch(e) {}
}

function pollFrame(){
  document.getElementById('live').src = '/frame?t=' + Date.now();
}

async function scanNext(){
  setMsg('正在推卡... 卡通过后会自动拍照');
  try {
    const r = await fetch('/scan', {method:'POST'});
    const d = await r.json();
    if (!d.ok) setMsg('发送指令失败：串口未连接，检查 COM 口');
  } catch(e) { setMsg('请求失败：' + e); }
}

async function tapFocus(){
  setMsg('正在点击屏幕对焦...');
  try {
    const r = await fetch('/focus', {method:'POST'});
    const d = await r.json();
    setMsg(d.ok ? '已点击对焦 (' + d.x + '%, ' + d.y + '%)' : '点击失败，检查手机连接');
  } catch(e) { setMsg('请求失败：' + e); }
}

async function manualCapture(){
  setMsg('正在截屏...');
  try {
    const r = await fetch('/capture', {method:'POST'});
    const d = await r.json();
    setMsg(d.ok ? '已保存：' + d.name : '失败：' + d.error);
    if (d.ok) refreshPhotos();
  } catch(e) { setMsg('请求失败：' + e); }
}

async function refreshPhotos(){
  try {
    const r = await fetch('/photos');
    const d = await r.json();
    const box = document.getElementById('photos');
    box.innerHTML = d.photos.map(function(n){
      return '<a href="/photo/' + n + '" target="_blank">'
           + '<img src="/photo/' + n + '" title="' + n + '"></a>';
    }).join('');
  } catch(e) {}
}

async function loadConfig(){
  try {
    const r = await fetch('/config');
    const d = await r.json();
    document.getElementById('cfg_port').value = d.COM_PORT;
    document.getElementById('cfg_baud').value = d.BAUD;
    document.getElementById('cfg_fi').value = d.FRAME_INTERVAL;
    document.getElementById('cfg_acd').value = d.AUTO_CAPTURE_DELAY;
    document.getElementById('cfg_lm').value = d.LOG_MAX;
    document.getElementById('cfg_focus').checked = !!d.FOCUS_TAP;
    document.getElementById('cfg_fx').value = d.FOCUS_TAP_X;
    document.getElementById('cfg_fy').value = d.FOCUS_TAP_Y;
    document.getElementById('cfg_mode').value = d.CAPTURE_MODE || 'camera';
    document.getElementById('cfg_sx').value = d.SHUTTER_TAP_X;
    document.getElementById('cfg_sy').value = d.SHUTTER_TAP_Y;
  } catch(e) {}
}

async function saveConfig(){
  const body = {
    COM_PORT:         document.getElementById('cfg_port').value.trim(),
    BAUD:             parseInt(document.getElementById('cfg_baud').value, 10),
    FRAME_INTERVAL:   parseFloat(document.getElementById('cfg_fi').value),
    AUTO_CAPTURE_DELAY: parseFloat(document.getElementById('cfg_acd').value),
    LOG_MAX:          parseInt(document.getElementById('cfg_lm').value, 10),
    FOCUS_TAP:        document.getElementById('cfg_focus').checked,
    FOCUS_TAP_X:      parseInt(document.getElementById('cfg_fx').value, 10),
    FOCUS_TAP_Y:      parseInt(document.getElementById('cfg_fy').value, 10),
    CAPTURE_MODE:     document.getElementById('cfg_mode').value,
    SHUTTER_TAP_X:    parseInt(document.getElementById('cfg_sx').value, 10),
    SHUTTER_TAP_Y:    parseInt(document.getElementById('cfg_sy').value, 10),
  };
  const msg = document.getElementById('cfgmsg');
  msg.textContent = '保存中...';
  try {
    const r = await fetch('/config', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if (d.ok) {
      msg.textContent = '已保存并生效 ✓';
      loadConfig();
    } else {
      msg.textContent = '失败：' + (d.error || '');
    }
  } catch(e) { msg.textContent = '请求失败：' + e; }
}

setInterval(pollStatus, 500);
setInterval(pollFrame, 700);
loadConfig();
refreshPhotos();
pollStatus();
</script>
</body>
</html>"""


if __name__ == "__main__":
    threading.Thread(target=frame_worker, daemon=True).start()
    threading.Thread(target=serial_worker, daemon=True).start()

    # 启动手机无线 ADB（自动发现 + 自动重连）
    if phone_link is not None:
        phone_serial_arg()
        if config.get("PHONE_AUTO", True):
            phone_link.start()
            print("[手机] 无线 ADB 线程已启动  序列号=%s" % config.get("PHONE_SERIAL"))
        threading.Thread(target=phone_sync_worker, daemon=True).start()
    else:
        print("[手机] 未启用（缺 phone_link.py）")

    # 启动 WiFi 链路（ESP-01 两阶段握手）
    if wifi_link is not None:
        wifi_link.start()
        print("[WiFi] 链路线程已启动 -> %s:%s" % (config.get("ESP_IP"), config.get("ESP_PORT")))
    else:
        print("[WiFi] 未启用（缺 link_wifi.py）")
    print("=" * 52)
    print("  TCG 拍照控制台已启动")
    print("  浏览器打开:  http://localhost:6001")
    print("  提示: 运行期间请关闭 Arduino IDE 的串口监视器")
    print("  参数已从 config.json 加载，可在网页右下角修改并保存")
    print("=" * 52)
    app.run(host="127.0.0.1", port=6001, debug=False)
