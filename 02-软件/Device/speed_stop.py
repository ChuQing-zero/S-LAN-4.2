# -*- coding: utf-8 -*-
r"""
调试1 —— 识别单元皮带半速运行，到指定光敏被遮挡时立刻停，并记录全过程时间

用途：测「卡走到光敏」的延迟，以及「检测到 → 停电机」的响应时间。不改固件。

流程：
    ① 先静置采 N 帧，学亮态基线（电机不转，保证没卡）
    ② 发 K,0x10,pwm,<pwm> + K,0x10,on  让识别单元皮带按指定 PWM 转（默认 100 = 半速）
    ③ 按 intervalMs 周期读指定光敏通道
         0x10~0x23 → U,0x<addr>  回 [ADC] 0x10,3401
         A7        → Q,ldr        回 [光敏] LDR=812,基准=620,100%
    ④ 一旦 值 < 基线 × ratio（默认 0.75）→ 判定卡到位
         立刻发 K,0x10,off 停皮带，并记录回包时刻
    ⑤ 汇总三个时间：
         皮带启动 → 检测到卡     （卡走完这段距离用了多久）
         检测到 → 停带命令发出   （软件判断耗时）
         检测到 → 停带回包       （命令往返；真正断电在这之前一点）
         总延迟 = 检测到 → 停带回包

可调参数：
    channel     光敏通道，默认 0x10（识别单元）
    pwm         皮带 PWM 0~255，默认 150（实测 100 带不动皮带，150 才是能稳定运转的半速）
    intervalMs  采样间隔，默认 120
    ratio       低于基线的比例算"有卡"，默认 0.75
    timeoutMs   单次等回包超时，默认 1200
    maxMs       最长运行时间，超时自动停，默认 20000
"""

import re
import threading
import time


class SpeedStop(object):
    CHANNELS = ["0x10", "0x20", "0x21", "0x22", "0x23", "A7"]

    def __init__(self, send, log=None, mark=None, wait=None, params=None, get_th=None):
        self.send = send
        self._log = log or (lambda t: None)
        self._mark = mark or (lambda: 0)
        self._wait_new = wait or (lambda before: None)
        self._get_th = get_th or (lambda ch: None)

        p = params or {}
        self.channel = str(p.get("channel", "0x10"))
        self.pwm = int(p.get("pwm", 150))
        self.interval_ms = int(p.get("intervalMs", 120))
        self.ratio = float(p.get("ratio", 0.75))
        self.timeout_ms = int(p.get("timeoutMs", 1200))
        self.max_ms = int(p.get("maxMs", 20000))
        self.base_n = int(p.get("baseN", 5))
        self.mode = str(p.get("mode", "arrive"))    # arrive | pass
        self.light_ratio = float(p.get("lightRatio", 0.9))   # pass 模式：回到基线×0.9 视为变亮
        self.delay_ms = int(p.get("delayMs", 0))             # 判定到位后再等多久才断电

        self.lock = threading.Lock()
        self.running = False
        self._stop = False
        self._thread = None

        self.step = "空闲"
        self.base = None
        self.th = None
        self.cur = None
        self.samples = []          # [(t_ms, val)]
        self.result = {}
        self.last_error = ""

    # ------------------------------------------------------------------ 状态
    def status(self):
        with self.lock:
            return {
                "running": self.running,
                "step": self.step,
                "channel": self.channel,
                "mode": self.mode,
                "pwm": self.pwm,
                "intervalMs": self.interval_ms,
                "delayMs": self.delay_ms,
                "base": self.base,
                "th": self.th,
                "cur": self.cur,
                "result": dict(self.result),
                "samples": list(self.samples[-60:]),
                "lastError": self.last_error,
            }

    def clear(self):
        with self.lock:
            self.result = {}
            self.samples = []
            self.base = None
            self.th = None
            self.cur = None
            self.last_error = ""

    # ------------------------------------------------------------------ 启停
    def start(self, **kw):
        if self.running:
            return False, "已在运行"
        for k, v in kw.items():
            if v is None:
                continue
            if k == "delayMs":
                self.delay_ms = max(0, int(v))
            elif k == "mode":
                self.mode = str(v)
            elif k == "channel":
                self.channel = str(v)
            elif k == "pwm":
                self.pwm = max(0, min(255, int(v)))
            elif k == "intervalMs":
                self.interval_ms = max(50, int(v))
            elif k == "ratio":
                self.ratio = float(v)
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
        self._log("[调试1] " + text)

    def _set_step(self, s):
        with self.lock:
            self.step = s

    def _cmd(self, c):
        self.send(c)
        time.sleep(0.05)

    def _read_channel(self):
        """读一次选定通道，返回值（int）或 None"""
        if self.channel == "A7":
            cmd = "Q,ldr"
        else:
            cmd = "U," + self.channel
        before = self._mark()
        t0 = time.time()
        self.send(cmd)
        while (time.time() - t0) * 1000 < self.timeout_ms:
            if self._stop:
                return None
            line = self._wait_new(before)
            if line is not None:
                if self.channel == "A7":
                    m = re.search(r"LDR=(\d+)", line)
                    if m:
                        return int(m.group(1))
                    # 兜底：取百分比
                    m2 = re.search(r"(\d+)%", line)
                    return int(m2.group(1)) if m2 else None
                m = re.search(r"\[ADC\]\s*0x[0-9A-Fa-f]{2}\s*,\s*(\d+)", line)
                if m:
                    return int(m.group(1))
                return None
            time.sleep(0.01)
        return None

    # ------------------------------------------------------------------ 主流程
    def _run(self):
        r = {}
        try:
            # ① 学基线（皮带不动）
            self._set_step("① 学亮态基线")
            self._cmd("K,0x10,off")
            time.sleep(0.3)
            buf = []
            for _ in range(self.base_n):
                if self._stop:
                    break
                v = self._read_channel()
                if v is not None:
                    buf.append(v)
                time.sleep(0.05)
            if buf:
                buf.sort()
                base = buf[len(buf) // 2]
            else:
                base = None

            if base is None or base <= 0:
                with self.lock:
                    self.last_error = "基线读取失败（该通道没数据）"
                self._ev("基线读取失败，检查通道 %s" % self.channel)
                return

            th_saved = None
            try:
                th_saved = self._get_th(self.channel)
            except Exception:
                th_saved = None
            if th_saved:
                th = int(th_saved)
                src = "配置阈值"
            else:
                th = int(base * self.ratio)
                src = "基线×%.2f" % self.ratio
            with self.lock:
                self.base = base
                self.th = th
            r["base"] = base
            r["th"] = th
            self._ev("基线=%d  阈值=%d（%s）  通道=%s" % (base, th, src, self.channel))

            if self._stop:
                return

            # ② 皮带启动（先设速度再开）
            self._set_step("② 皮带启动 PWM=%d" % self.pwm)
            self._cmd("K,0x10,pwm,%d" % self.pwm)
            self._cmd("K,0x10,on")
            t_start = time.time()
            self._ev("皮带已启动 PWM=%d" % self.pwm)

            # ③ 轮询
            self._set_step("③ 等待光敏被遮挡（阈值 %d）" % th)
            detected = False
            t_detect = None
            val_last = None
            while (time.time() - t_start) * 1000 < self.max_ms:
                if self._stop:
                    break
                v = self._read_channel()
                el = int((time.time() - t_start) * 1000)
                if v is not None:
                    val_last = v
                    with self.lock:
                        self.cur = v
                        self.samples.append({"t": el, "v": v})
                        if len(self.samples) > 2000:
                            del self.samples[:500]
                    if v < th:
                        t_detect = time.time()
                        detected = True
                        self._ev("★ 检测到遮挡：%d < %d（皮带启动后 %d ms）"
                                 % (v, th, int((t_detect - t_start) * 1000)))
                        break
                rest = self.interval_ms - ((time.time() - t_start) * 1000 % self.interval_ms)
                if rest > 0:
                    time.sleep(min(rest, self.interval_ms) / 1000.0)

            if not detected:
                self._cmd("K,0x10,off")
                r["detected"] = False
                r["lastVal"] = val_last
                with self.lock:
                    self.result = r
                self._ev("超时未检测到遮挡（最后读数 %s），电机已停" % val_last)
                return

            # ③.5 pass 模式：继续等它重新变亮（卡完全通过）
            if self.mode == "pass":
                th_light = int(base * self.light_ratio)
                self._set_step("③.5 等待重新变亮（阈值 %d）" % th_light)
                self._ev("已遮住，等重新变亮（>%d）判卡通过" % th_light)
                t_light = None
                while (time.time() - t_detect) * 1000 < self.max_ms:
                    if self._stop:
                        break
                    v = self._read_channel()
                    el = int((time.time() - t_detect) * 1000)
                    if v is not None:
                        val_last = v
                        with self.lock:
                            self.cur = v
                            self.samples.append({"t": int((time.time() - t_start) * 1000), "v": v})
                        if v >= th_light:
                            t_light = time.time()
                            self._ev("★ 重新变亮：%d >= %d（卡通过用了 %d ms）"
                                     % (v, th_light, int((t_light - t_detect) * 1000)))
                            break
                    time.sleep(self.interval_ms / 1000.0)
                if t_light is None:
                    self._cmd("K,0x10,off")
                    r["detected"] = True
                    r["passOk"] = False
                    r["startToDarkMs"] = int((t_detect - t_start) * 1000)
                    with self.lock:
                        self.result = r
                    self._ev("等了 %d ms 没变亮，皮带已停" % self.max_ms)
                    return
                t_detect = t_light    # 后面统一按"最后这个时刻"算停带延迟

            # ③.9 可配置延时：判定到位后再等这么多毫秒才断电
            if self.delay_ms > 0:
                self._set_step("③.9 延时 %d ms 后断电" % self.delay_ms)
                self._ev("延时开始：%d ms 后停皮带" % self.delay_ms)
                t_dl = time.time()
                while (time.time() - t_dl) * 1000 < self.delay_ms:
                    if self._stop:
                        break
                    time.sleep(0.01)

            # ④ 停皮带
            t_cmd = time.time()
            self._set_step("④ 停皮带")
            self._cmd("K,0x10,off")
            t_ack = time.time()

            r["detected"] = True
            r["startToDetectMs"] = int((t_detect - t_start) * 1000)
            r["detectToCmdMs"] = int((t_cmd - t_detect) * 1000)
            r["detectToAckMs"] = int((t_ack - t_detect) * 1000)
            r["totalMs"] = int((t_ack - t_start) * 1000)
            r["detectVal"] = val_last
            r["delayMs"] = self.delay_ms
            if self.mode == "pass":
                r["mode"] = "pass"
                r["passOk"] = True
            with self.lock:
                self.result = r
            self._ev("★★ 汇总：启动→检测 %d ms ／ 检测→发停止命令 %d ms ／ 检测→停带回包 %d ms"
                     % (r["startToDetectMs"], r["detectToCmdMs"], r["detectToAckMs"]))

        except Exception as e:
            with self.lock:
                self.last_error = "%s" % e
            self._ev("异常：%s" % e)
        finally:
            try:
                self._cmd("K,0x10,off")
            except Exception:
                pass
            with self.lock:
                self.running = False
                self.step = "结束"
