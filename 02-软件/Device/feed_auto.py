# -*- coding: utf-8 -*-
r"""
调试3 —— 料仓缺卡自动停料（进料机构优化）

用户现场口径（2026-11-04）：
    料仓正常放着一张卡时，光敏读数大概在 **100 左右**（卡挡住光）。
    卡用完、光敏露光后读数会**变高**，到 **300 左右**就该停。
    → 读数 < 阈值 = 有卡，继续进料；读数 >= 阈值 = 没卡了，停进料。

流程：
    循环（每 intervalMs 读一次指定通道的原始值）：
        值 < th  → 料仓有卡：进料电机保持运转（发 s 开）
        值 >= th → 料仓空：停进料（发 t 停）

    只在状态切换时下发命令，不会反复刷指令。

参数：
    channel     光敏通道，默认 A7（料仓那个）
    th          阈值（原始值），默认 300
    intervalMs  采样间隔，默认 200
    autoStart   检测到有卡时是否自动开进料，默认 1
"""

import re
import threading
import time


class FeedAuto(object):
    def __init__(self, send, log=None, mark=None, wait=None, params=None):
        self.send = send
        self._log = log or (lambda t: None)
        self._mark = mark or (lambda: 0)
        self._wait_new = wait or (lambda before: None)

        p = params or {}
        self.channel = str(p.get("channel", "A7"))
        self.th = int(p.get("th", 300))
        self.interval_ms = int(p.get("intervalMs", 200))
        self.timeout_ms = int(p.get("timeoutMs", 1200))

        self.lock = threading.Lock()
        self.running = False
        self._stop = False
        self._thread = None

        self.cur = None
        self.has_card = None        # True=有卡, False=空, None=未知
        self.feeding = False        # 进料是否在转
        self.flips = []             # 状态切换记录
        self.last_error = ""
        self.count = 0              # 切换次数

    # ------------------------------------------------------------------ 状态
    def status(self):
        with self.lock:
            return {
                "running": self.running,
                "channel": self.channel,
                "th": self.th,
                "intervalMs": self.interval_ms,
                "cur": self.cur,
                "hasCard": self.has_card,
                "feeding": self.feeding,
                "count": self.count,
                "flips": list(self.flips[-30:]),
                "lastError": self.last_error,
            }

    def clear(self):
        with self.lock:
            self.flips = []
            self.count = 0
            self.last_error = ""

    # ------------------------------------------------------------------ 启停
    def start(self, **kw):
        if self.running:
            return False, "已在运行"
        for k, v in kw.items():
            if v is None:
                continue
            if k == "channel":
                self.channel = str(v)
            elif k == "th":
                self.th = int(v)
            elif k == "intervalMs":
                self.interval_ms = max(80, int(v))
        self._stop = False
        self.running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return True, "已启动"

    def stop(self):
        self._stop = True
        self._ev("收到停止请求")

    # ------------------------------------------------------------------ 工具
    def _ev(self, text):
        self._log("[调试3] " + text)

    def _read(self):
        """读一次原始值"""
        cmd = "Q,ldr" if self.channel.upper() == "A7" else ("U," + self.channel)
        before = self._mark()
        t0 = time.time()
        self.send(cmd)
        while (time.time() - t0) * 1000 < self.timeout_ms:
            if self._stop:
                return None
            line = self._wait_new(before)
            if line is not None:
                if self.channel.upper() == "A7":
                    m = re.search(r"LDR=(\d+)", line)
                    return int(m.group(1)) if m else None
                m = re.search(r"\[ADC\]\s*0x[0-9A-Fa-f]{2}\s*,\s*(\d+)", line)
                return int(m.group(1)) if m else None
            time.sleep(0.01)
        return None

    def _set_feeding(self, on):
        try:
            self.send("s" if on else "t")
        except Exception:
            pass
        with self.lock:
            if on != self.feeding:
                self.feeding = on
                self.count += 1
                ts = time.strftime("%H:%M:%S")
                self.flips.append({"t": ts, "to": "进料开" if on else "进料停",
                                   "val": self.cur})
        self._ev("进料 %s" % ("开" if on else "停"))

    # ------------------------------------------------------------------ 主循环
    def _run(self):
        try:
            self._ev("开始监测料仓（通道 %s，阈值 %d）" % (self.channel, self.th))
            while not self._stop:
                v = self._read()
                if v is None:
                    with self.lock:
                        self.last_error = "读不到光敏值"
                    time.sleep(self.interval_ms / 1000.0)
                    continue

                has_card = v < self.th
                with self.lock:
                    self.cur = v
                    prev = self.has_card
                    self.has_card = has_card
                    self.last_error = ""

                if prev != has_card:
                    self._ev("★ 料仓状态变化：%d %s %d → %s"
                             % (v, "<" if has_card else ">=", self.th,
                                "有卡" if has_card else "空仓"))

                # 有卡就开进料，空仓就停
                if has_card and not self.feeding:
                    self._set_feeding(True)
                elif (not has_card) and self.feeding:
                    self._set_feeding(False)

                time.sleep(self.interval_ms / 1000.0)
        except Exception as e:
            with self.lock:
                self.last_error = "%s" % e
            self._ev("异常：%s" % e)
        finally:
            try:
                self.send("t")
            except Exception:
                pass
            with self.lock:
                self.running = False
                self.feeding = False
