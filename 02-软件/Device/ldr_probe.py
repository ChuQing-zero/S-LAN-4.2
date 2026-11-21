# -*- coding: utf-8 -*-
r"""
测试3 —— 6 路光敏实时监视 + 响应延迟测量

6 路光敏：
    0x10 / 0x20~0x23   各单元 STM32 的 PA0 → ADC（寄存器 0x20 低8位 + 0x21 高4位）
    A7                 主控 Nano 自己的那路

两种采集模式（固件不同配不同模式）：
    one  ★默认  发 `U,<addr>` 一次读一个通道，轮转 6 路（固件 82-ReadOne / V8.3-READONE）
                 优点：每次只读 2 个 I2C 寄存器，最省总线、最不容易卡
                 代价：一轮 6 条命令，一轮约 6×(单次往返) 毫秒
    x            发 `X` 一次读全部 6 路（固件 81-LdrAll / V8.4-LDRALL）
                 优点：一轮只 1 次往返，最快
                 代价：一次要读 10 个 I2C 寄存器

判定方式（不用固定阈值）：
    启动后自动学"亮态基线"：每路取前 N 帧的中位数，
    之后 当前值 < 基线 × ratio(0.75) 判定为"有卡"；
    基线为 0 说明该路没信号，标 noSignal、不参与判定。

安全机制：
    连续 3 次等不到回包 → 自动降频（×2，上限 2000ms），成功一次立即恢复原频率，
    避免把链路/总线打死。
"""

import re
import threading
import time


class LdrProbe(object):
    # 轮转顺序：5 个单元 + 主控 A7(0x00)
    ONE_ORDER = [0x10, 0x20, 0x21, 0x22, 0x23, 0x00]

    def __init__(self, send, log=None, params=None):
        self.send = send
        self._log = log or (lambda t: None)

        p = params or {}
        self.mode = str(p.get("mode", "one")).lower()          # one | x
        self.interval_ms = int(p.get("intervalMs", 300))
        self.base_interval = self.interval_ms
        self.ratio = float(p.get("ratio", 0.75))
        self.base_n = int(p.get("baseN", 8))
        self.unit_th = int(p.get("unitTh", 2000))              # 基线未就绪时的兜底
        self.a7_th = int(p.get("a7Th", 400))
        self.timeout_ms = int(p.get("timeoutMs", 1200))

        self.lock = threading.Lock()
        self.running = False
        self._stop = False
        self._thread = None
        self._rr = 0

        self.names = ["0x10", "0x20", "0x21", "0x22", "0x23", "A7"]
        self.values = [None] * 6
        self.base = [None] * 6
        self.base_buf = [[] for _ in range(6)]
        self.base_ready = False
        self.nosig = [False] * 6
        self.card = [False] * 6

        self.lat_last = None
        self.lat_min = None
        self.lat_max = None
        self.lat_sum = 0.0
        self.lat_n = 0
        self.sweep_ms = None
        self.fail = 0
        self.fail_streak = 0
        self.flips = []
        self.last_line = ""
        self.last_error = ""

        # 供 app.py 注入：取最新回包
        self._wait_new = staticmethod(lambda before: None)
        self._mark = staticmethod(lambda: 0)

    # ------------------------------------------------------------------ 绑定
    def bind_log_source(self, mark_fn, wait_fn):
        self._mark = staticmethod(mark_fn)
        self._wait_new = staticmethod(wait_fn)

    # ------------------------------------------------------------------ 状态
    def status(self):
        with self.lock:
            avg = (self.lat_sum / self.lat_n) if self.lat_n else None
            return {
                "running": self.running,
                "mode": self.mode,
                "intervalMs": self.interval_ms,
                "sweepMs": self.sweep_ms,
                "latency": {
                    "last": self.lat_last,
                    "avg": (round(avg, 1) if avg is not None else None),
                    "min": self.lat_min,
                    "max": self.lat_max,
                    "n": self.lat_n,
                },
                "fail": self.fail,
                "failStreak": self.fail_streak,
                "ch": [
                    {
                        "name": self.names[i],
                        "val": self.values[i],
                        "base": self.base[i],
                        "card": bool(self.card[i]),
                        "ok": self.values[i] is not None,
                        "noSignal": bool(self.nosig[i]),
                    }
                    for i in range(6)
                ],
                "flips": list(self.flips[-40:]),
                "lastLine": self.last_line,
                "lastError": self.last_error,
                "baseReady": self.base_ready,
                "ratio": self.ratio,
            }

    def relearn(self):
        with self.lock:
            self.base = [None] * 6
            self.base_buf = [[] for _ in range(6)]
            self.base_ready = False
            self.nosig = [False] * 6

    def clear(self):
        with self.lock:
            self.flips = []
            self.lat_sum = 0.0
            self.lat_n = 0
            self.lat_min = None
            self.lat_max = None
            self.lat_last = None
            self.fail = 0
            self.fail_streak = 0
            self.base = [None] * 6
            self.base_buf = [[] for _ in range(6)]
            self.base_ready = False
            self.nosig = [False] * 6

    # ------------------------------------------------------------------ 启停
    def start(self):
        if self.running:
            return False, "已在运行"
        self._stop = False
        self.base_interval = self.interval_ms
        self.fail_streak = 0
        self._rr = 0
        self.running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        return True, "已启动"

    def stop(self):
        self._stop = True
        with self.lock:
            self.running = False

    # ------------------------------------------------------------------ 解析
    _RE_X = re.compile(r"(0x1[0-9A-Fa-f]|0x2[0-9A-Fa-f]|A7)\s*=\s*(\d+|ERR)")
    _RE_ONE = re.compile(r"\[ADC\]\s*(0x[0-9A-Fa-f]{2}|A7)\s*,\s*(\d+|ERR)")

    def _parse_x(self, text):
        idx = text.find("[光敏ADC]")
        if idx < 0:
            return None
        got = {}
        for m in self._RE_X.finditer(text[idx:]):
            got[m.group(1).upper()] = (None if m.group(2) == "ERR" else int(m.group(2)))
        return [got.get(n.upper()) for n in self.names]

    def _parse_one(self, text):
        m = self._RE_ONE.search(text)
        if not m:
            return None, None
        name = m.group(1).upper()
        val = None if m.group(2) == "ERR" else int(m.group(2))
        key = "A7" if name == "A7" else ("0x%02X" % int(name, 16))
        if key not in self.names:
            return None, None
        return self.names.index(key), val

    # ------------------------------------------------------------------ 判定
    def _apply_one(self, i, val):
        """更新单路：学基线 → 判有卡。调用方需持有 self.lock"""
        self.values[i] = val
        if val is None:
            return

        if not self.base_ready:
            self.base_buf[i].append(val)
            if all(len(b) >= self.base_n for b in self.base_buf):
                for k in range(6):
                    buf = sorted(self.base_buf[k])
                    self.base[k] = buf[len(buf) // 2]      # 中位数抗毛刺
                self.base_ready = True
                self._log("[测试3] 亮态基线已学习: " + ", ".join(
                    "%s=%s" % (self.names[k], self.base[k]) for k in range(6)))
            return

        b = self.base[i]
        if b is None or b == 0:
            self.nosig[i] = True
            newcard = False
        else:
            newcard = val < (b * self.ratio)

        if newcard != self.card[i]:
            self.card[i] = newcard
            ts = time.strftime("%H:%M:%S") + (".%03d" % int((time.time() % 1) * 1000))
            self.flips.append({
                "t": ts, "ch": i, "name": self.names[i], "val": val,
                "to": "有卡" if newcard else "空",
            })
            if len(self.flips) > 300:
                del self.flips[:100]

    def _record_latency(self, lat):
        self.lat_last = lat
        self.lat_sum += lat
        self.lat_n += 1
        if self.lat_min is None or lat < self.lat_min:
            self.lat_min = lat
        if self.lat_max is None or lat > self.lat_max:
            self.lat_max = lat

    # ------------------------------------------------------------------ 问一次
    def _ask(self, cmd):
        """发命令并等对应回包，返回 (line, 耗时ms)"""
        before = self._mark()
        t0 = time.time()
        self.send(cmd)
        while (time.time() - t0) * 1000 < self.timeout_ms:
            if self._stop:
                return None, int((time.time() - t0) * 1000)
            line = self._wait_new(before)
            if line is not None:
                return line, int((time.time() - t0) * 1000)
            time.sleep(0.01)
        return None, int((time.time() - t0) * 1000)

    # ------------------------------------------------------------------ 单次读取
    def read_once(self):
        """手动读一次：把 6 路走一遍，返回最新状态（不启动后台线程）"""
        if self.running:
            return {"ok": False, "error": "连续采集进行中，请先停止"}
        t0 = time.time()
        got = 0
        for addr in self.ONE_ORDER:
            cmd = "U,0x%02X" % addr
            line, lat = self._ask(cmd)
            if line is None:
                continue
            idx, val = self._parse_one(line)
            if idx is None:
                continue
            with self.lock:
                self._record_latency(lat)
                self._apply_one(idx, val)
            got += 1
        took = int((time.time() - t0) * 1000)
        with self.lock:
            self.sweep_ms = took
            self.last_error = "" if got == 6 else ("只读到 %d/6 路" % got)
            # 第一次「读一次」：把当前值直接定为亮态基线（前提：此刻没有卡挡着）
            if got == 6 and not self.base_ready:
                for k in range(6):
                    if self.values[k] is not None:
                        self.base[k] = self.values[k]
                self.base_ready = True
                self.card = [False] * 6
                self._log("[测试3] 已用当前值建立基线: " + ", ".join(
                    "%s=%s" % (self.names[k], self.base[k]) for k in range(6)))
        d = self.status()
        d["ok"] = got > 0
        d["tookMs"] = took
        d["got"] = got
        return d

    # ------------------------------------------------------------------ 主循环
    def _loop(self):
        while not self._stop:
            t0 = time.time()
            ok = False
            try:
                if self.mode == "x":
                    ok = self._tick_x()
                else:
                    ok = self._tick_one()
            except Exception as e:
                with self.lock:
                    self.fail += 1
                    self.last_error = "%s" % e

            with self.lock:
                if ok:
                    self.fail_streak = 0
                else:
                    self.fail += 1
                    self.fail_streak += 1
                    if self.fail_streak >= 3 and self.interval_ms < 2000:
                        self.interval_ms = min(self.interval_ms * 2, 2000)
                        self._log("[测试3] 连续 %d 次无回包，降频到 %d ms"
                                  % (self.fail_streak, self.interval_ms))

            used = (time.time() - t0) * 1000
            if self.mode != "x":
                # one 模式下 sweepMs 表示走完 6 路一轮的耗时
                with self.lock:
                    self.sweep_ms = int(used * 6)
            rest = self.interval_ms - used
            if rest > 0:
                time.sleep(rest / 1000.0)

        with self.lock:
            self.running = False

    def _tick_x(self):
        line, lat = self._ask("X")
        if line is None:
            with self.lock:
                self.last_error = "等 X 回包超时"
            return False
        vals = self._parse_x(line)
        if vals is None:
            with self.lock:
                self.last_error = "解析失败：" + line[:60]
            return False
        with self.lock:
            self.last_line = line.strip()[:120]
            self.last_error = ""
            self._record_latency(lat)
            for i in range(6):
                self._apply_one(i, vals[i])
            self.sweep_ms = lat
        return True

    def _tick_one(self):
        addr = self.ONE_ORDER[self._rr % len(self.ONE_ORDER)]
        self._rr += 1
        cmd = "U,0x%02X" % addr
        line, lat = self._ask(cmd)
        if line is None:
            with self.lock:
                self.last_error = "等 %s 回包超时" % cmd
            return False
        idx, val = self._parse_one(line)
        if idx is None:
            with self.lock:
                self.last_error = "解析失败：" + line[:60]
            return False
        with self.lock:
            self.last_line = line.strip()[:120]
            self.last_error = ""
            self._record_latency(lat)
            self._apply_one(idx, val)
        return True
