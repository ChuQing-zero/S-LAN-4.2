# -*- coding: utf-8 -*-
r"""
调试4 —— 单张进料（速度可调 + 光敏遮挡即停）

用户口径（2026-11-05）：
    "设置光敏电阻的一个阻值，卡牌遮上去的时候就直接停机；
     速度调慢一点，速度可以进行调整，我这边可以设置转速，也可以设置阈值。"

流程：
    ① 先确认光敏处于"亮"状态（否则说明卡还压在光敏上，拒绝启动并提示）
    ② M,S 停一下，读一次当前值作为参考
    ③ M,F,<pwm>,0 启动进料电机（pwm 可调 = 转速可调）
    ④ 按 intervalMs 周期读指定光敏通道
    ⑤ 读数 < 阈值 → 判定"卡牌已遮挡 = 这一张进料成功"
         立刻 M,S 停电机，记录三段毫秒
    ⑥ 超过 maxMs 还没遮挡 → 停电机，报"超时未检测到卡"

判据说明：
    通道 0x10~0x23 用 U,0x<addr>  回 [ADC] 0x10,3401
    通道 A7        用 Q,ldr       回 LDR=<raw>,基准=..,..%
    阈值优先用页面传进来的，其次 config 的 LDR_THRESHOLDS，最后 基线×ratio
"""

import re
import threading
import time


class FeedPush(object):
    CHANNELS = ["0x10", "0x20", "0x21", "0x22", "0x23", "A7"]

    def __init__(self, send, log=None, mark=None, wait=None, params=None, get_th=None):
        self.send = send
        self._log = log or (lambda t: None)
        self._mark = mark or (lambda: 0)
        self._wait_new = wait or (lambda before: None)
        self._get_th = get_th or (lambda ch: None)

        p = params or {}
        self.channel = str(p.get("channel", "0x10"))
        self.pwm = int(p.get("pwm", 200))          # 进料电机转速，出厂 g_pwm=200
        self.th = int(p.get("th", 0) or 0)         # 0 = 用配置/自动基线
        self.interval_ms = int(p.get("intervalMs", 60))
        self.max_ms = int(p.get("maxMs", 4000))
        self.min_run_ms = int(p.get("minRunMs", 120))
        self.timeout_ms = int(p.get("timeoutMs", 1200))
        self.ratio = float(p.get("ratio", 0.75))
        self.require_clear = bool(p.get("requireClear", True))

        self.lock = threading.Lock()
        self.running = False
        self._stop = False
        self._thread = None

        self.step = "空闲"
        self.base = None
        self.used_th = None
        self.cur = None
        self.samples = []
        self.result = {}
        self.last_error = ""
        self.count = 0            # 累计成功进料张数（本引擎自己数）

    # ------------------------------------------------------------------ 状态
    def status(self):
        with self.lock:
            return {
                "running": self.running,
                "step": self.step,
                "channel": self.channel,
                "pwm": self.pwm,
                "th": self.used_th if self.used_th else self.th,
                "intervalMs": self.interval_ms,
                "maxMs": self.max_ms,
                "base": self.base,
                "cur": self.cur,
                "count": self.count,
                "result": dict(self.result),
                "samples": list(self.samples[-60:]),
                "lastError": self.last_error,
            }

    def clear(self):
        with self.lock:
            self.result = {}
            self.samples = []
            self.base = None
            self.used_th = None
            self.cur = None
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
            elif k == "pwm":
                self.pwm = max(0, min(255, int(v)))
            elif k == "th":
                self.th = int(v)
            elif k == "intervalMs":
                self.interval_ms = max(30, int(v))
            elif k == "maxMs":
                self.max_ms = max(200, int(v))
            elif k == "minRunMs":
                self.min_run_ms = max(0, int(v))
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
        self._log("[调试4] " + text)

    def _set_step(self, s):
        with self.lock:
            self.step = s

    def _cmd(self, c, gap=0.05):
        self.send(c)
        time.sleep(gap)

    def _read(self):
        """读一次选定通道，返回 int 或 None"""
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

    # ------------------------------------------------------------------ 主流程
    def _run(self):
        try:
            # ① 先读一次亮态作为参考
            self._set_step("① 读当前光敏")
            self._cmd("M,S", 0.15)
            v0 = self._read()
            if v0 is None:
                with self.lock:
                    self.last_error = "读不到光敏（通道 %s）" % self.channel
                self._ev("读不到光敏，检查通道 %s 是否在线" % self.channel)
                return
            with self.lock:
                self.base = v0
                self.cur = v0

            # ② 定阈值
            th_saved = self._get_th(self.channel)
            if self.th:
                th = self.th
                src = "页面填写"
            elif th_saved:
                th = int(th_saved)
                src = "配置阈值"
            else:
                th = int(v0 * self.ratio)
                src = "当前值×%.2f" % self.ratio
            with self.lock:
                self.used_th = th
            self._ev("当前值=%d  阈值=%d（%s）  转速PWM=%d" % (v0, th, src, self.pwm))

            # ③ 启动前必须确认光敏是亮的（否则卡还压着）
            if self.require_clear and v0 < th:
                with self.lock:
                    self.last_error = "光敏当前已被遮挡（%d < %d），请先移开卡牌" % (v0, th)
                self._ev("光敏已被遮挡（%d < %d），拒绝启动，请先把卡移开" % (v0, th))
                return

            if self._stop:
                return

            # ④ 启动进料电机
            self._set_step("② 进料电机启动 PWM=%d" % self.pwm)
            self._cmd("M,F,%d,0" % self.pwm)
            t_start = time.time()
            self._ev("进料电机已启动，等待光敏被遮挡")

            # ⑤ 轮询等遮挡
            self._set_step("③ 等待卡牌遮挡光敏（阈值 %d）" % th)
            detected = False
            t_detect = None
            val = None
            while (time.time() - t_start) * 1000 < self.max_ms:
                if self._stop:
                    break
                v = self._read()
                el = int((time.time() - t_start) * 1000)
                if v is not None:
                    val = v
                    with self.lock:
                        self.cur = v
                        self.samples.append({"t": el, "v": v})
                        if len(self.samples) > 2000:
                            del self.samples[:500]
                    # min_run_ms 内不判定，避免刚启动就误触
                    if el >= self.min_run_ms and v < th:
                        t_detect = time.time()
                        detected = True
                        self._ev("★ 检测到遮挡：%d < %d（启动后 %d ms）" % (v, th, el))
                        break
                time.sleep(self.interval_ms / 1000.0)

            r = {}
            if not detected:
                self._cmd("M,S")
                r["success"] = False
                r["lastVal"] = val
                with self.lock:
                    self.result = r
                self._ev("超时 %d ms 未检测到遮挡（最后读数 %s），电机已停" % (self.max_ms, val))
                return

            # ⑥ 立刻停
            t_cmd = time.time()
            self._set_step("④ 停进料电机")
            self._cmd("M,S")
            t_ack = time.time()

            r["success"] = True
            r["startToDetectMs"] = int((t_detect - t_start) * 1000)
            r["detectToCmdMs"] = int((t_cmd - t_detect) * 1000)
            r["detectToAckMs"] = int((t_ack - t_detect) * 1000)
            r["detectVal"] = val
            r["th"] = th
            with self.lock:
                self.result = r
                self.count += 1
            self._ev("★★ 一张进料成功：启动→遮挡 %d ms ／ 遮挡→停令 %d ms ／ 遮挡→回包 %d ms  累计 %d 张"
                     % (r["startToDetectMs"], r["detectToCmdMs"], r["detectToAckMs"], self.count))

        except Exception as e:
            with self.lock:
                self.last_error = "%s" % e
            self._ev("异常：%s" % e)
        finally:
            try:
                self._cmd("M,S")
            except Exception:
                pass
            with self.lock:
                self.running = False
                self.step = "结束"
