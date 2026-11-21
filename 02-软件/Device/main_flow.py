# -*- coding: utf-8 -*-
r"""
main_flow.py —— 整机主流程（开始运转）

流程（2026-11-05 与用户逐条确认过）：

【启动一次】
    补光灯常亮 W,on → 挡片立起 E,0x10,120 → 皮带 K,0x10,pwm,<PWM> + on

【每张卡】
    ① 进料前：挡片立起 E,0x10,120 + 皮带 on，等 GATE_RAISE_WAIT_MS(600)
       然后 c 推一张（闭环，卡遮进料光敏就停）
    ② 等 FEED_TO_BELT_MS（默认 1000）让卡被皮带带走
    ③ 盯 0x10：光敏变暗（卡到识别位）→ 等 IDENT_STOP_DELAY_MS（默认 1000）→ 皮带停
    ④ 等 IDENT_SETTLE_MS（默认 500）→ 做 NFC（若识别方式含 NFC）
    ⑤ 挡片放行 E,0x10,90 → 等 GATE_TO_BELT_MS（默认 1000）→ 皮带 on
    ⑥ 等 0x10 重新变亮【并连续保持 LIGHT_CONFIRM_MS(500)】→ 皮带立刻停（第二次停 = 拍照位）
       ★ 加确认时间是为了防皮带抖动瞬间见光被误判为"卡已通过"
    ⑦ 等 PHOTO_WAIT_MS（默认 500）→ 手机真快门拍照 → 送 AI（此时皮带停着）
    ⑦b 识别完成、知道去向之后，才启动皮带走（见 ⑨）
    ⑧ 规则匹配 → 出口 1~8 或兜底 9
    ⑨ 出口 1~8：皮带 on → 只盯该单元光敏（遮住→变亮→等 STOP_DELAY_MS）
                 → 皮带停 → 写 A/B 参数 → S,raise → 等 RAISE_HOLD_MS → S,lower
       兜底 9：皮带转 FALLBACK_MS（默认 30000）→ 皮带停（不做舵机动作）
    ⑩ 等 CYCLE_DELAY_MS → 下一张（自动模式）／复位待命（单张模式）

保护：任一步超时 → 停皮带 + 停进料 + 挡片复位 + 报警日志，主流程退出。
"""

import json
import re
import threading
import time

import sort_rules


class MainFlow(object):
    def __init__(self, send, log=None, mark=None, next_line=None, cfg=None,
                 capture_photo=None, ask_ai=None, save_cfg=None):
        self.send = send
        self._save_cfg = save_cfg or (lambda: None)
        self._log = log or (lambda t: None)
        self._mark = mark or (lambda: 0)
        self._next_line = next_line or (lambda before: None)
        self._cursor = None       # 首次使用时才向 app 取游标（app 里函数定义在后面）
        self._recent = __import__("collections").deque(maxlen=400)   # (seq,line) 共享缓冲，不丢行
        self._match_from = 0
        self._cfg = cfg or (lambda: {})
        self._capture_photo = capture_photo      # () -> dataURL 或 None
        self._ask_ai = ask_ai                    # (dataURL, question) -> (ok, text)

        self.lock = threading.Lock()
        self.running = False
        self._stop = False
        self._thread = None

        self.mode = "auto"
        self.step = "空闲"
        self.card_no = 0
        self.last = {}          # 上一张的结果
        self.history = []

    # ------------------------------------------------------------ 参数
    def p(self, key, default):
        try:
            v = self._cfg().get(key)
            return default if v is None else v
        except Exception:
            return default

    def _pwm(self):
        return int(self.p("SORT_BELT_PWM", self.p("SPEED_PWM", 150)))

    def _feed_pwm(self):
        return int(self.p("FEED_PWM", 200))

    def _th(self, ch):
        ths = self.p("LDR_THRESHOLDS", {}) or {}
        v = ths.get(ch)
        return int(v) if v else 2700

    # ------------------------------------------------------------ 状态
    def status(self):
        with self.lock:
            return {
                "running": self.running,
                "mode": self.mode,
                "step": self.step,
                "cardNo": self.card_no,
                "last": dict(self.last),
                "history": list(self.history[-10:]),
                "params": {
                    "beltPwm": self._pwm(),
                    "feedToBeltMs": int(self.p("FEED_TO_BELT_MS", 1000)),
                    "identStopDelayMs": int(self.p("IDENT_STOP_DELAY_MS", 1000)),
                    "identSettleMs": int(self.p("IDENT_SETTLE_MS", 500)),
                    "photoWaitMs": int(self.p("PHOTO_WAIT_MS", 500)),
                    "photoStopDelayMs": int(self.p("PHOTO_STOP_DELAY_MS", 120)),
                    "stopDelayMs": int(self.p("SORT_STOP_DELAY_MS", 500)),
                    "sortLocalStop": bool(self.p("SORT_LOCAL_STOP", True)),
                    "sortLocalDelayMs": int(self.p("SORT_LOCAL_DELAY_MS", 120)),
                    "raiseHoldMs": int(self.p("SORT_RAISE_HOLD_MS", 4500)),
                    "cycleDelayMs": int(self.p("SORT_CYCLE_DELAY_MS", 1000)),
                    "fallbackMs": int(self.p("SORT_FALLBACK_MS", 30000)),
                },
            }

    # ------------------------------------------------------------ 启停
    def start(self, mode="auto"):
        if self.running:
            return False, "已在运转"
        self.mode = mode if mode in ("auto", "single") else "auto"
        self._stop = False
        self.running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return True, "已开始运转（%s）" % ("连续" if self.mode == "auto" else "单张")

    def stop(self):
        self._stop = True
        self._ev("收到停止请求，正在安全停止…")

    # ------------------------------------------------------------ 工具
    def _ev(self, t):
        self._log("[主流程] " + t)

    def _set_step(self, s):
        with self.lock:
            self.step = s

    def _sleep(self, ms):
        """可被 stop 打断的等待"""
        end = time.time() + ms / 1000.0
        while time.time() < end:
            if self._stop:
                return False
            time.sleep(0.02)
        return True

    def _cmd_expect(self, cmd, expect_kw, tries=2, timeout_ms=600, gap=0.15):
        """发命令 → 等含 expect_kw 的回执；没等到就重发（Nano 连发太快会丢）"""
        for k in range(max(1, tries)):
            if self._stop:
                return False
            self.send(cmd)
            line = self._await_line(lambda l: expect_kw in l, timeout_ms)
            if line:
                time.sleep(gap)
                return True
            self._ev("命令无回执，重发(%d/%d)：%s" % (k + 1, tries, cmd))
            time.sleep(gap)
        self._ev("命令最终失败：%s" % cmd)
        return False

    def _cmd(self, c, gap=0.06):
        self.send(c)
        time.sleep(gap)

    # ---- 通用读行（先把新行全部收进缓冲，再按需匹配，任何行都不会被吞）----
    def _pump(self):
        """把所有新行从 app 拉进本地缓冲（不丢行，多个等待者共享）"""
        for _ in range(200):
            item = self._next_line(self._cursor)
            if not item:
                break
            seq, ln = item
            self._cursor = seq
            self._recent.append((seq, ln))
        return self._recent

    def _await_line(self, pred, timeout_ms=3000, fresh=True):
        """等一条满足 pred 的『新』日志行（fresh=True 时忽略此前已收的行）"""
        if self._cursor is None or fresh:
            self._cursor = self._mark()
            self._match_from = self._cursor
        t0 = time.time()
        while (time.time() - t0) * 1000 < timeout_ms:
            if self._stop:
                return None
            self._pump()
            for seq, ln in list(self._recent):
                if seq <= self._match_from:
                    continue
                if pred(ln):
                    self._match_from = seq
                    return ln
            time.sleep(0.02)
        return None

    # ---- 皮带 ----
    def _belt_on(self):
        self._cmd("K,0x10,pwm,%d" % self._pwm())
        self._cmd("K,0x10,on")

    def _belt_running(self):
        """读主控状态字节 bit6（皮带运行位）；读不到返回 None"""
        self.send("?")
        line = self._await_line(lambda l: "[状态]" in l, 800)
        m = re.search(r"0x10\s*=\s*([0-9A-Fa-f]{1,2})", line or "")
        if not m:
            return None
        val = int(m.group(1), 16)
        return bool(val & 0x40)

    def _belt_off(self):
        self._cmd("K,0x10,off")

    def _gate_set(self, deg, tag):
        """发挡片角度并确认回包（固件 case 'E' 会把角度原样回显）；丢包就重发"""
        deg = int(deg)
        cmd = "E,0x10,%d" % deg
        for k in range(3):
            if self._stop:
                return False
            self.send(cmd)
            line = self._await_line(lambda l: ("[识别]" in l) and ("挡片=" in l), 600, fresh=False)
            if line:
                self._ev("挡片%s：%d°（第 %d 次确认）" % (tag, deg, k + 1))
                return True
            self._ev("挡片%s 无回包，重发(%d/3)：%s" % (tag, k + 1, cmd))
        self._ev("⚠ 挡片%s 三次都没回包，舵机可能没动（%d°）" % (tag, deg))
        return False

    def calibrate(self, samples=3, ratio=None):
        """启动校准：灯亮、无卡时实测六路亮态值，按比例算阈值并落盘 + 下发 A7 阈值"""
        chs = ["0x10", "0x20", "0x21", "0x22", "0x23", "A7"]
        ratio = float(ratio if ratio is not None else self.p("CALIB_RATIO", 0.78))
        self._set_step("启动校准")
        self._ev("开始校准：每路采 %d 次，比例 %.2f" % (samples, ratio))
        raw = {c: [] for c in chs}
        for i in range(samples):
            for c in chs:
                if self._stop:
                    return False
                v = self._read_adc(c)
                if v is not None and v > 0:
                    raw[c].append(v)
            if i < samples - 1:
                self._sleep(int(self.p("CALIB_GAP_MS", 150)))

        cfg = self._cfg()
        ths = dict(cfg.get("LDR_THRESHOLDS") or {})
        lines = []
        for c in chs:
            arr = sorted(raw[c])
            if not arr:
                lines.append("%s 无数据（保留原阈值 %s）" % (c, ths.get(c)))
                continue
            med = arr[len(arr) // 2]
            # 单元与进料口量程不同，比例分开给（默认 单元 0.82 ≈ 3000、A7 0.77 ≈ 600）
            r_c = float(self.p("CALIB_RATIO_A7", 0.77)) if c.upper() == "A7" \
                  else float(self.p("CALIB_RATIO_UNIT", 0.82))
            newv = int(round(med * r_c))
            oldv = ths.get(c)
            ths[c] = newv
            lines.append("%s 亮=%d ×%.2f → 阈值 %s→%d" % (c, med, r_c, oldv, newv))
        cfg["LDR_THRESHOLDS"] = ths
        try:
            self._save_cfg()
        except Exception as e:
            self._ev("校准结果保存失败：%s" % e)
        for ln in lines:
            self._ev("校准 " + ln)
        self._ev("校准完成（已落盘，A7 阈值稍后随 q 命令下发）")
        return True

    def _feed_th_push(self):
        """把进料阈值下发给 Nano（q 命令只写 RAM，断电会回到固件默认 100）"""
        th = self._th("A7")
        try:
            self.send("q%d" % th)
            self._ev("已下发进料阈值 q%d" % th)
        except Exception as e:
            self._ev("下发进料阈值失败：%s" % e)

    def _gate_block(self):
        return self._gate_set(self.p("GATE_DOWN_DEG", 120), "立起")

    def _gate_open(self):
        return self._gate_set(self.p("GATE_UP_DEG", 90), "放行")

    # ---- 光敏 ----
    def _read_adc(self, ch):
        """读一个光敏，返回 int 或 None"""
        is_a7 = str(ch).upper() == "A7"
        cmd = "Q,ldr" if is_a7 else ("U," + ch)
        self.send(cmd)
        if is_a7:
            line = self._await_line(lambda l: "LDR=" in l, 1500)
            m = re.search(r"LDR=(\d+)", line or "")
            return int(m.group(1)) if m else None
        line = self._await_line(
            lambda l: ("[ADC]" in l) and (str(ch).lower() in l.lower()), 1500)
        m = re.search(r"\[ADC\]\s*0x[0-9A-Fa-f]{2}\s*,\s*(\d+)", line or "")
        return int(m.group(1)) if m else None

    def _wait_light_confirm(self, ch, timeout_ms=25000, confirm_ms=500):
        """等光敏变亮，且必须【连续亮满 confirm_ms】才算通过（防皮带抖动误判）"""
        th = self._th(ch)
        t0 = time.time()
        bright_since = None
        while (time.time() - t0) * 1000 < timeout_ms:
            if self._stop:
                return False
            v = self._read_adc(ch)
            now = time.time()
            if v is not None and v >= th:
                if bright_since is None:
                    bright_since = now
                elif (now - bright_since) * 1000 >= confirm_ms:
                    return True
            else:
                bright_since = None          # 一断就重新计时（抖动不生效）
            time.sleep(0.03)
        return False

    def _wait_dark(self, ch, timeout_ms=10000):
        th = self._th(ch)
        t0 = time.time()
        while (time.time() - t0) * 1000 < timeout_ms:
            if self._stop:
                return False
            v = self._read_adc(ch)
            if v is not None and v < th:
                return True
            time.sleep(0.05)
        return False

    def _wait_light(self, ch, timeout_ms=15000):
        th = self._th(ch)
        t0 = time.time()
        while (time.time() - t0) * 1000 < timeout_ms:
            if self._stop:
                return False
            v = self._read_adc(ch)
            if v is not None and v >= th:
                return True
            time.sleep(0.05)
        return False

    # ---- 进料 ----
    def precheck_sensors(self):
        """启动前检查 5 路光敏：全部为亮（无卡遮挡）才允许开始。
        返回 (ok, 说明文字)"""
        chs = ["0x10", "0x20", "0x21", "0x22", "0x23"]
        bad = []
        no_sig = []
        vals = {}
        for ch in chs:
            v = None
            for _ in range(3):                 # 单次读失败多半是 I2C/WiFi 抖动，重试 3 次
                v = self._read_adc(ch)
                if v is not None:
                    break
                self._sleep(120)
            vals[ch] = v
            if v is None:
                no_sig.append(ch)              # 无信号只告警，不拦启动
            elif v < self._th(ch):
                bad.append("%s(%d<阈值%d)" % (ch, v, self._th(ch)))
        detail = "  ".join("%s=%s" % (k, vals[k]) for k in chs)
        self._ev("启动前光敏检查：%s" % detail)
        if no_sig:
            self._ev("⚠ 这些通道三次都没读到（不影响启动）：%s" % "、".join(no_sig))
        if bad:
            return False, "以下光敏被遮挡，请先清空皮带：" + "、".join(bad)
        return True, "5 路光敏全部正常（都亮）"

    def _feed_cmd_only(self, log_wait_ms=2500):
        """推卡：发 c（固件闭环，遮住就停）→ 等回包 → 回退一小段把多余卡拽回 → 判双张"""
        self.send("c")
        line = self._await_line(
            lambda l: ("[进料]" in l) and (("成功" in l) or ("已遮挡" in l) or ("超时" in l)),
            log_wait_ms, fresh=False)
        if line:
            self._ev("推卡回包：%s" % line.split("] ", 1)[-1])
        else:
            self._ev("推卡回包未及时到（不影响，继续按光敏判断）")

        # 推完先等一小会儿，再看进料口是否还被遮（判断"卡没走"或"出了两张"）
        wait_ms = int(self.p("FEED_DOUBLE_WAIT_MS", 250))
        if wait_ms > 0:
            self._sleep(wait_ms)
            v = self._read_adc("A7")
            th = self._th("A7")
            if v is not None and v < th:
                self._ev("⚠ 推完 %dms 后进料口仍被遮（A7=%s < 阈值%s）→ 可能双张或卡没走" % (wait_ms, v, th))
                # 按需反转回退：把卡从分张轮上退下来，再用皮带重新带走
                backoff = int(self.p("FEED_BACKOFF_MS", 150))
                if backoff > 0:
                    pwm = int(self.p("FEED_BACKOFF_PWM", 120))
                    old_pwm = self._feed_pwm()
                    self.send("M,R,%d,%d" % (pwm, backoff))   # 反转，到点自停（固件内部 delay 后停机）
                    self._sleep(backoff + 200)
                    self.send("M,S")
                    self.send("p%d" % old_pwm)                # 恢复推卡 PWM（M 命令会把 g_pwm 改成 120）
                    self._sleep(120)
                    self._ev("已反转回退 %d ms 并把 PWM 恢复成 %d" % (backoff, old_pwm))
            else:
                self._ev("进料口已空（A7=%s）" % v)

    def _feed_one(self, timeout_ms=12000):
        """发 c 推一张，等固件的 [进料] 成功 行"""
        self.send("c")
        line = self._await_line(
            lambda l: ("[进料]" in l) and ("成功" in l), timeout_ms, fresh=False)
        if line:
            m = re.search(r"(\d+)\s*ms", line)
            if m:
                self._ev("推卡 %s ms" % m.group(1))
            return True
        # 兼容旧版回包
        line = self._await_line(
            lambda l: ("推卡成功" in l) or ("计数=" in l), 1500, fresh=False)
        return line is not None

    # ---- 识别 ----
    def _nfc(self, tries=2):
        for _ in range(max(1, tries)):
            if self._stop:
                return ""
            self.send("N,0x10")
            time.sleep(0.4)
            self.send("R")
            line = self._await_line(lambda l: ("NFC" in l and "," in l), 1500)
            if line:
                parts = line.replace("[识别]", "").strip().split(",")
                if len(parts) >= 2 and parts[1].strip() == "NFC":
                    return parts[-1].strip()
        return ""

    def _ask_ident(self):
        """拍照 + AI，返回 ident 字典"""
        ident = {}
        modes = str(self.p("SORT_IDENT_MODE", "图像识别"))

        if "NFC" in modes:
            self._set_step("NFC 识别")
            uid = self._nfc()
            if uid:
                ident["code"] = uid
                ident["nfc"] = uid
                self._ev("NFC 读到 %s" % uid)

        need_image = ("图像" in modes) or (not ident)
        if need_image and self._capture_photo is not None:
            self._set_step("拍照 + AI 识别")
            img = self._capture_photo()
            if not img:
                self._ev("拍照失败，走兜底")
                return ident
            # 只问两个字段：类别 + 星数（实测 4.5 秒，带 name/code 要 13 秒）
            q = ("这是游戏王卡牌。只输出JSON，格式："
                 "{\"category\":\"类别\",\"level\":星数}\n"
                 "category 只能取：通常怪兽/效果怪兽/仪式怪兽/灵摆怪兽/"
                 "融合怪兽/同调怪兽/超量怪兽/连接怪兽/魔法卡/陷阱卡/衍生物；"
                 "level 填怪兽星数（超量卡填阶级），非怪兽填 0。不要解释。")
            ok, text = (False, "")
            if self._ask_ai is not None:
                ok, text = self._ask_ai(img, q)
            if ok and text:
                ident.update(self._parse_ident_json(text))
                self._ev("AI 返回 %s" % text[:120])
            else:
                self._ev("AI 无结果，走兜底")
        return ident

    @staticmethod
    def _parse_ident_json(text):
        out = {}
        s = str(text or "")
        m = re.search(r"\{[\s\S]*\}", s)
        if m:
            try:
                d = json.loads(m.group(0))
                if isinstance(d, dict):
                    if d.get("category"):
                        out["category"] = str(d["category"]).strip()
                    lv = d.get("level")
                    try:
                        lv = int(str(lv).strip())
                        if lv > 0:
                            out["level"] = lv
                    except Exception:
                        pass
                    if d.get("name"):
                        out["name"] = str(d["name"]).strip()
                    if d.get("code"):
                        out["code"] = str(d["code"]).strip()
                    return out
            except Exception:
                pass
        # 兜底：从自由文本里抓关键信息
        for t in ("融合怪兽", "同调怪兽", "超量怪兽", "连接怪兽",
                  "仪式怪兽", "灵摆怪兽", "通常怪兽", "效果怪兽", "衍生物"):
            if t in s:
                out["category"] = t
                break
        if not out.get("category") and "怪兽" in s:
            out["category"] = "怪兽卡"
        elif not out.get("category") and "魔法" in s:
            out["category"] = "魔法卡"
        elif "陷阱" in s:
            out["category"] = "陷阱卡"
        m = re.search(r"(\d+)\s*星", s)
        if m:
            out["level"] = int(m.group(1))
        return out

    # ---- 分拣 ----
    def _sort_stop_local(self, addr, timeout_ms=20000):
        """用固件本地闭环停带：Z,<addr>,<delay>,<th> → Nano 自己盯变亮并停带
        收到 [Z] STOP 即成功；没收到 [Z] ARMED 说明固件不支持，退回 PC 轮询。"""
        delay = int(self.p("SORT_LOCAL_DELAY_MS", 120))
        th = self._th(addr)
        self.send("Z,%s,%d,%d" % (addr, delay, th))
        armed = self._await_line(lambda l: ("[Z]" in l) and ("ARMED" in l), 1800)
        if not armed:
            self._ev("固件没回 [Z] ARMED，退回 PC 轮询")
            return False
        self._ev("%s 交给固件本地盯：变亮后 %d ms 停带（阈值 %d）" % (addr, delay, th))
        # 等待期间每 2 秒读一次该路光敏并记日志，便于判断"卡真被挡住"还是"边缘抖动"
        t_start = time.time()
        line = None
        first = True
        while (time.time() - t_start) * 1000 < timeout_ms:
            line = self._await_line(lambda l: ("[Z]" in l) and ("STOP" in l), 2000, fresh=first)
            first = False
            if line:
                break
            # 兜底判据：直接看主控状态字节 bit6（皮带运行位）是否已清零——
            # [Z] STOP 的回包可能丢，但皮带确实已被本地停掉
            if self._belt_running() is False:
                self._ev("%s 皮带已停（本地闭环生效，[Z] STOP 回包丢失）" % addr)
                line = "belt-stopped"
                break
            v = self._read_adc(addr)
            self._ev("Z 等待中 %.1fs… %s 读数=%s（阈值 %d）"
                     % (time.time() - t_start, addr, v, th))
        try:
            self.send("K,0x10,off")           # 保险：再补一次停带
        except Exception:
            pass
        if line:
            self._ev("%s 固件本地停带完成，用时 %.1fs" % (addr, time.time() - t_start))
            return True
        self._ev("等 [Z] STOP 超时（%.0fs），退回 PC 轮询" % (timeout_ms / 1000.0))
        return False

    def _sort_to_outlet(self, outlet):
        addr, side = sort_rules.OUTLET_MAP.get(outlet, (None, None))

        if addr is None:                       # 兜底：送走
            self._set_step("兜底：皮带送走")
            ms = int(self.p("SORT_FALLBACK_MS", 30000))
            self._belt_on()
            self._sleep(ms)
            self._belt_off()
            return True

        # 皮带送卡到该单元
        self._set_step("送卡到 %s" % sort_rules.OUTLET_NAMES.get(outlet, outlet))
        self._belt_on()
        if not self._wait_dark(addr, 20000):
            self._ev("超时：没等到 %s 光敏被遮" % addr)
            return False
        # 卡已到本单元 → 优先交给固件本地闭环停带（延时小、抖动小）
        if not (self.p("SORT_LOCAL_STOP", True) and self._sort_stop_local(addr)):
            # 本地闭环没用上（固件不支持）→ 走 PC 轮询
            if not self._wait_light(addr, 20000):
                self._ev("超时：没等到 %s 光敏变亮，直接停带" % addr)
                self._belt_off()
            else:
                wait_ms = int(self.p("SORT_STOP_DELAY_MS", 500))
                self._ev("%s 变亮，再等 %d ms 停带（PC 轮询）" % (addr, wait_ms))
                self._sleep(wait_ms)
                self._belt_off()
        self._ev("%s 皮带已停，开始下发舵机" % addr)

        # 写 A/B 参数 → 抬升（SORT_OUTLETS 是 list，元素含 name/addr/aMs/bMs）
        a_ms, b_ms = 500, 900
        try:
            target_name = sort_rules.OUTLET_NAMES.get(outlet, "")
            for it in (self.p("SORT_OUTLETS", []) or []):
                if isinstance(it, dict) and it.get("name") == target_name:
                    a_ms = int(it.get("aMs", a_ms))
                    b_ms = int(it.get("bMs", b_ms))
                    break
        except Exception as e:
            self._ev("读出口参数异常，用默认 500/900：%s" % e)
        self._ev("%s A=%dms B=%dms" % (sort_rules.OUTLET_NAMES.get(outlet, outlet), a_ms, b_ms))
        self._set_step("分拣 %s 抬升" % sort_rules.OUTLET_NAMES.get(outlet, outlet))
        t_raise = time.time()
        try:
            # ★ 参数必须逐条确认：两个出口共用一个单元，参数丢了会沿用上一个出口的
            #   （上一张 6#右 是 90/50，这一张 5#左 要 50/90；bu 若丢就会变成 50/50 → 左右一样高）
            burst = int(self.p("SORT_CMD_GAP_MS", 250))
            au = max(0, min(255, a_ms // 10))
            bu = max(0, min(255, b_ms // 10))
            for name, cmd in (("A", "P,%s,au,%d" % (addr, au)),
                              ("B", "P,%s,bu,%d" % (addr, bu))):
                ok = False
                for _ in range(3):
                    self.send(cmd)
                    if self._await_line(lambda l: "参数已设置" in l, 500):
                        ok = True
                        break
                    self._ev("%s 参数无回执，重发(%s)" % (name, cmd))
                    self._sleep(80)
                if not ok:
                    self._ev("⚠ %s 参数三次都没确认（%s），高度差可能不对" % (name, cmd))
            self._sleep(burst)
            self.send("S,%s,raise" % addr)
            self._sleep(burst)
            # 只校验一次：读 T,addr 看"阶段"或"抬升"是否动作
            ok_r = False
            for _ in range(2):
                t0 = time.strftime("%H:%M:%S")
                self.send("T,%s" % addr)
                line = self._await_line(lambda l: ("限位=" in l), 700)
                if line and ("阶段=1" in line or "阶段=2" in line or "抬升=" in line):
                    ok_r = True
                    break
                self._sleep(150)
            if not ok_r:              # 再补发一次抬升
                self._ev("T 没看到动作，补发一次 raise")
                self.send("S,%s,raise" % addr)
            self._ev("%s 抬升下发完成，用时 %.1f s（A=%dms B=%dms）"
                     % (sort_rules.OUTLET_NAMES.get(outlet, outlet),
                        time.time() - t_raise, a_ms, b_ms))
        except Exception as e:
            self._ev("下发抬升异常：%s" % e)

        self._sleep(int(self.p("SORT_RAISE_HOLD_MS", 4500)))

        self._set_step("分拣 %s 复位" % sort_rules.OUTLET_NAMES.get(outlet, outlet))
        self.send("S,%s,lower" % addr)
        ok_l = self._await_line(lambda l: ("lower OK" in l), 1200) is not None
        if not ok_l:
            self._ev("⚠ lower 无回执，补发一次")
            self.send("S,%s,lower" % addr)
            self._sleep(300)
        return True

    # ------------------------------------------------------------ 主循环
    def _run(self):
        try:
            self._ev("开始运转")

            # 启动前自检：五路光敏必须都是亮的（皮带/识别位/各出口不能有卡）
            self._set_step("启动前检查")
            if self.p("MAIN_PRECHECK", True):
                ok_chk, msg = self.precheck_sensors()
                if not ok_chk:
                    self._ev("❌ " + msg)
                    self._ev("已取消启动（清空皮带后再点开始运转）")
                    with self.lock:
                        self.running = False
                        self.step = "自检未通过"
                    return
                self._ev("✅ " + msg)

            # 启动准备
            self._set_step("启动准备")
            if self.p("START_CALIB", True):
                self.calibrate()
            self._feed_th_push()        # 先把进料阈值下发给 Nano（断电会回默认 100）
            self._cmd("W,on", 0.2)
            self._gate_block()
            self._belt_on()
            self._sleep(500)            # 等链路/继电器/挡片稳定，避免命令挤在一起

            while not self._stop:
                with self.lock:
                    self.card_no += 1
                    n = self.card_no
                self._ev("=== 第 %d 张 ===" % n)

                rec = {"no": n, "t": time.strftime("%H:%M:%S")}

                # ① 进料前：挡片必须重新立起来挡住（上一张放行后停在 90°），皮带也要在转
                self._set_step("第%d张 进料准备（挡片立起）" % n)
                self._belt_on()
                self._gate_block()                  # ★ 每张进料前都要立起挡住
                self._sleep(int(self.p("GATE_RAISE_WAIT_MS", 600)))
                self._set_step("第%d张 进料" % n)
                self._feed_cmd_only()
                self._sleep(int(self.p("FEED_TO_BELT_MS", 1000)))

                # ② 第一次停（识别位）
                self._set_step("第%d张 等卡到识别位" % n)
                if not self._wait_dark("0x10", 30000):
                    self._ev("超时：卡没到识别位，停止")
                    break
                self._sleep(int(self.p("IDENT_STOP_DELAY_MS", 1000)))
                self._belt_off()
                self._sleep(int(self.p("IDENT_SETTLE_MS", 500)))

                # ③ 挡片放下 → 等 GATE_TO_BELT_MS → 再启动皮带
                self._gate_open()
                self._sleep(int(self.p("GATE_TO_BELT_MS", 1000)))
                self._belt_on()
                self._set_step("第%d张 等卡到拍照位" % n)
                confirm = int(self.p("LIGHT_CONFIRM_MS", 500))
                if not self._wait_light_confirm("0x10", 25000, confirm):
                    self._ev("超时：没等到识别位光敏连续变亮 %d ms，停止" % confirm)
                    break
                self._ev("光敏已连续亮 %d ms，判定卡已通过" % confirm)
                photo_stop = int(self.p("PHOTO_STOP_DELAY_MS", 120))
                self._ev("再等 %d ms 停带（拍照位）" % photo_stop)
                self._sleep(photo_stop)
                self._belt_off()
                self._sleep(int(self.p("PHOTO_WAIT_MS", 500)))

                # ④ 识别
                ident = self._ask_ident()
                rec["ident"] = ident

                # ⑤ 定出口：完全没识别到 → 直接出口9（送走，不动舵机）
                rules = self.p("SORT_RULES", None) or {}
                if not ident:
                    outlet, rule = sort_rules.OUTLET_FALLBACK, None
                    self._ev("没有识别到任何信息 → 出口9（送走）")
                else:
                    outlet, rule = sort_rules.match_outlet(ident, rules)
                rec["outlet"] = outlet
                rec["why"] = sort_rules.describe(ident, outlet, rule)
                self._ev(rec["why"])

                # ⑥ 分拣
                ok = self._sort_to_outlet(outlet)
                rec["ok"] = bool(ok)

                with self.lock:
                    self.last = rec
                    self.history.append(rec)

                if not ok:
                    self._ev("分拣失败，停止")
                    break

                self._sleep(int(self.p("SORT_CYCLE_DELAY_MS", 1000)))

                if self.mode == "single":
                    self._ev("单张模式：本张完成，复位待命")
                    break

            # 收尾
            self._set_step("收尾复位")
            self._belt_off()
            self._cmd("t")
            self._gate_open()
            self._ev("已停止")
        except Exception as e:
            self._ev("异常：%s" % e)
        finally:
            try:
                self._belt_off()
                self._cmd("t")
            except Exception:
                pass
            with self.lock:
                self.running = False
                self.step = "空闲"
