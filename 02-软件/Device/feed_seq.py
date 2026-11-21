# -*- coding: utf-8 -*-
r"""
送料时序测试引擎（测试2）

流程（用户确认版）：
    ① 补光灯常亮                W,on
    ② 皮带停                    K,0x10,off      ← 舵机动作时电机必须不动
    ③ 挡片放下                  E,0x10,down
    ④ 等放下完成 + 1 秒缓冲
    ⑤ 皮带全速启动              K,0x10,on + K,0x10,pwm,255
           ↓
    ⑥ 光敏检测到"有卡"（百分比掉下来）→ 记 T0
           ↓
    ⑦ 皮带停                    K,0x10,off      ← 舵机动作前先停电机
    ⑧ 挡片抬起                  E,0x10,up
    ⑨ 等抬起完成 + 1 秒缓冲
    ⑩ 皮带再启动（放行）        K,0x10,on
           ↓
    ⑪ 光敏回到"亮"（卡过完）→ 皮带停 + 关灯

另有两种模式：
    measure  只测光敏：灯开、皮带停，打印 10 秒 Q,ldr，用于现场定量阈值
    run      跑完整时序（开始前自动 Q,setbase 标定基准）

设计：不依赖固件改动，只通过 send(cmd) 下发指令、
      get_ldr() 读最近一次 [光敏] 的百分比。
"""

import threading
import time


class FeedSeq(object):
    def __init__(self, send, get_ldr, log=None, params=None):
        """
        send(cmd)      下发一条指令（走当前链路）
        get_ldr()      返回最近一次光敏百分比(int) 或 None
        log(text)      记录一行日志
        """
        self.send = send
        self.get_ldr = get_ldr
        self._log = log or (lambda t: None)

        p = params or {}
        self.light_on = "W,on"
        self.light_off = "W,off"
        self.belt_on = "K,0x10,on"
        self.belt_off = "K,0x10,off"
        self.belt_full = "K,0x10,pwm,255"

        self.gate_up_deg = int(p.get("gateUpDeg", 90))     # 竖起角度（放行）
        self.gate_down_deg = int(p.get("gateDownDeg", 60)) # 倒下角度（挡住，下面有限位）
        self.gate_ms = int(p.get("gateMs", 1200))       # 挡片单程时间
        self.gate_up = "E,0x10,%d" % self.gate_up_deg
        self.gate_down = "E,0x10,%d" % self.gate_down_deg
        self.gate_buffer_ms = int(p.get("gateBufferMs", 1000))  # 动作完成后缓冲
        self.poll_ms = int(p.get("pollMs", 80))          # 光敏轮询周期
        self.dark_pct = int(p.get("darkPct", 60))        # 低于它算"有卡"
        self.light_pct = int(p.get("lightPct", 85))      # 高于它算"卡走了"
        self.card_timeout_ms = int(p.get("cardTimeoutMs", 30000))
        self.pass_timeout_ms = int(p.get("passTimeoutMs", 15000))
        self.measure_ms = int(p.get("measureMs", 10000))
        self.stop_delay_ms = int(p.get("stopDelayMs", 1000))   # 检测到光敏后多久停皮带

        self.lock = threading.Lock()
        self.running = False
        self.mode = ""
        self.step = "空闲"
        self.events = []          # [(t, text)]
        self.result = {}
        self._stop = False
        self._thread = None

    # ---------------------------------------------------------------- 状态
    def _ev(self, text):
        t = time.strftime("%H:%M:%S")
        ms = int((time.time() % 1) * 1000)
        stamp = "%s.%03d" % (t, ms)
        with self.lock:
            self.events.append((stamp, text))
            if len(self.events) > 300:
                del self.events[:100]
        self._log("[测试2] " + text)

    def _set_step(self, s):
        with self.lock:
            self.step = s
        self._ev("步骤：" + s)

    def status(self):
        with self.lock:
            return {
                "running": self.running,
                "mode": self.mode,
                "step": self.step,
                "events": [{"t": t, "d": d} for t, d in self.events[-80:]],
                "result": dict(self.result),
                "params": {
                    "gateMs": self.gate_ms,
                    "gateBufferMs": self.gate_buffer_ms,
                    "pollMs": self.poll_ms,
                    "darkPct": self.dark_pct,
                    "lightPct": self.light_pct,
                    "stopDelayMs": self.stop_delay_ms,
                },
            }

    def clear(self):
        with self.lock:
            self.events = []
            self.result = {}

    # ---------------------------------------------------------------- 启停
    def start(self, mode="run"):
        if self.running:
            return False, "已在运行"
        self._stop = False
        self.mode = mode
        self.running = True
        self._thread = threading.Thread(target=self._run, args=(mode,), daemon=True)
        self._thread.start()
        return True, "已启动"

    def stop(self):
        self._stop = True
        self._ev("收到停止请求")

    # ---------------------------------------------------------------- 工具
    def _sleep(self, ms):
        """可被 stop 打断的睡眠"""
        t0 = time.time()
        while (time.time() - t0) * 1000 < ms:
            if self._stop:
                return False
            time.sleep(0.02)
        return True

    def _cmd(self, c, note=""):
        self.send(c)
        self._ev("下发 %s%s" % (c, ("  (" + note + ")") if note else ""))
        time.sleep(0.25)      # 给链路一点时间，避免指令挤在一起

    def _wait_ldr(self, cond, timeout_ms, label):
        """轮询光敏直到 cond(pct) 成立；返回 (ok, elapsed_ms, last_pct)"""
        t0 = time.time()
        last = None
        while (time.time() - t0) * 1000 < timeout_ms:
            if self._stop:
                return False, int((time.time() - t0) * 1000), last
            self.send("Q,ldr")
            last = self.get_ldr()
            if last is not None and cond(last):
                return True, int((time.time() - t0) * 1000), last
            time.sleep(self.poll_ms / 1000.0)
        return False, int((time.time() - t0) * 1000), last

    # ---------------------------------------------------------------- 主流程
    def _run(self, mode):
        t_start = time.time()
        try:
            if mode == "measure":
                self._do_measure()
            else:
                self._do_run()
        except Exception as e:
            self._ev("异常：%s" % e)
        finally:
            # 收尾：停皮带、关灯
            try:
                self.send(self.belt_off)
                self.send(self.light_off)
            except Exception:
                pass
            with self.lock:
                self.running = False
                self.step = "结束"
            self._ev("流程结束，用时 %.1f 秒" % (time.time() - t_start))

    def _do_measure(self):
        self.result = {}
        self._set_step("测光敏：灯开、皮带停")
        self._cmd(self.belt_off)
        self._cmd(self.light_on)
        self._sleep(1200)
        self._cmd("Q,setbase", "灯亮无卡时标定基准")
        self._sleep(600)

        self._ev("开始采集 %d 秒，请在这段时间里手动放卡再拿走（每 0.5 秒打一次）" % (self.measure_ms // 1000))
        t0 = time.time()
        samples = []
        while (time.time() - t0) * 1000 < self.measure_ms:
            if self._stop:
                break
            self.send("Q,ldr")
            time.sleep(0.15)
            v = self.get_ldr()
            if v is not None:
                samples.append(v)
                if len(samples) % 6 == 0:
                    self._ev("光敏 %d%%" % v)
            time.sleep(0.35)

        if samples:
            lo, hi = min(samples), max(samples)
            self.result = {"min": lo, "max": hi, "n": len(samples)}
            self._ev("采集完成：最低 %d%% / 最高 %d%% / %d 个样本" % (lo, hi, len(samples)))
            self._ev("建议阈值：dark < %d%%，light > %d%%" %
                     (int(lo + (hi - lo) * 0.4), int(lo + (hi - lo) * 0.7)))
        else:
            self._ev("没采到光敏数据（Q,ldr 没有回显？）")

    def _do_run(self):
        """新的简化流程（用户 2026-11-04 晚确认）：
        挡板启动时抬起 → 皮带全速 → 识别到第一个光敏 → 提示并计时 → 1 秒后停皮带
        """
        self.result = {}
        r = {}

        # ① 灯常亮
        self._set_step("① 补光灯常亮")
        self._cmd(self.light_on)
        self._sleep(800)

        # ② 皮带先停
        self._set_step("② 皮带停（准备）")
        self._cmd(self.belt_off)

        # ③ 挡板抬起（启动状态）
        self._set_step("③ 挡板抬起（启动状态）")
        self._cmd(self.gate_up)
        self._sleep(self.gate_ms + self.gate_buffer_ms)

        # ④ 标定光敏基准（灯亮、无卡、挡板抬起）
        self._set_step("④ 标定光敏基准")
        self._cmd("Q,setbase")
        self._sleep(500)
        self.send("Q,ldr")
        time.sleep(0.3)
        base = self.get_ldr()
        r["basePct"] = base
        self._ev("基准标定完成，当前 %s%%（亮）" % (base if base is not None else "?"))

        # ⑤ 皮带全速
        self._set_step("⑤ 皮带全速运行")
        self._cmd(self.belt_on)
        self._cmd(self.belt_full)
        t_belt = time.time()
        self._ev("皮带已启动，开始等第一个光敏信号（判据 < %d%%）" % self.dark_pct)

        # ⑥ 等第一个光敏
        ok, el, last = self._wait_ldr(lambda p: p < self.dark_pct,
                                     self.card_timeout_ms, "等光敏")
        if not ok:
            self._ev("等光敏超时（%d ms，最后读数 %s%%）" % (el, last))
            r["cardDetected"] = False
            self.result = r
            return

        t_card = time.time()
        r["cardDetected"] = True
        r["waitCardMs"] = int((t_card - t_belt) * 1000)
        r["cardPct"] = last

        self._ev("★★★★★ 识别到第一个光敏电阻！（光敏 %d%%，距皮带启动 %d ms）★★★★★"
                 % (last, r["waitCardMs"]))

        # ⑦ 检测到后等 1 秒
        self._set_step("⑦ 检测到光敏后等待 %d ms" % self.stop_delay_ms)
        if not self._sleep(self.stop_delay_ms):
            self._ev("等待期间被中止")
            return

        # ⑧ 停皮带
        self._set_step("⑧ 停皮带")
        self._cmd(self.belt_off)
        t_stop = time.time()
        r["runAfterDetectMs"] = int((t_stop - t_card) * 1000)
        r["totalBeltMs"] = int((t_stop - t_belt) * 1000)
        self._ev("★★★★★ 皮带已停（检测到后 %d ms，皮带共运行 %d ms）★★★★★"
                 % (r["runAfterDetectMs"], r["totalBeltMs"]))

        r["passOk"] = True
        self.result = r
