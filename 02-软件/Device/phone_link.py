# -*- coding: utf-8 -*-
r"""
手机 ADB 无线链路模块（自动发现 + 自动重连）

配套文档：附件\毕业设计\手机ADB调试-1104\

核心原则：**认序列号，不认 IP**
    序列号 YOUR_PHONE_SERIAL  不变  → 身份校验、挑设备、重连匹配
    端点   192.168.1.123:5555  会变 → 只是本次连接的地址

发现顺序（任一步成功即停）：
    ① 缓存端点  adb connect <上次的 ip:5555>
    ② mDNS      adb mdns services  → 服务名 adb-<序列号> 自带序列号
    ③ 扫网段    从本机 IP 推 /24，扫 5555 端口（换热点也能用，不写死网段）

⚠️ 硬约束：手机重启后 5555 端口关闭、mDNS 也不再广播。
   华为不 root 改不了 persist.adb.tcp.port，
   所以每次开机必须插一次 USB 跑一次 pair_usb()。
"""

import os
import re
import socket
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor

# 默认 adb 路径（可在 config.json 用 ADB_PATH 覆盖）
DEFAULT_ADB = r"D:\Project\S-LAN\Code\V1.0.1\TCG_Android\adb\adb.exe"

CREATE_NO_WINDOW = 0x08000000


def _find_adb(preferred=None):
    """找 adb.exe：优先传入路径，其次常见位置，最后 PATH"""
    cands = []
    if preferred:
        cands.append(preferred)
    cands.append(DEFAULT_ADB)
    cands.append(os.path.join(os.environ.get("ANDROID_HOME", ""), "platform-tools", "adb.exe"))
    cands.append(os.path.join(os.environ.get("LOCALAPPDATA", ""),
                              "Android", "Sdk", "platform-tools", "adb.exe"))
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return "adb"          # 交给 PATH


def local_ipv4_list():
    """取本机所有非回环 IPv4（用于推算 /24 网段）"""
    ips = []
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command",
                              "Get-NetIPAddress -AddressFamily IPv4 | "
                              "Where-Object { $_.IPAddress -notlike '127.*' -and "
                              "$_.IPAddress -notlike '169.254.*' } | "
                              "ForEach-Object { $_.IPAddress }"],
                             capture_output=True, text=True, timeout=10,
                             creationflags=CREATE_NO_WINDOW)
        for ln in out.stdout.splitlines():
            ln = ln.strip()
            if re.match(r"^\d+\.\d+\.\d+\.\d+$", ln):
                ips.append(ln)
    except Exception:
        pass
    if not ips:
        # 兜底：UDP 探一下出口地址
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.settimeout(0.3)
            s.connect(("8.8.8.8", 80))
            ips.append(s.getsockname()[0])
            s.close()
        except Exception:
            pass
    return ips


class PhoneLink(object):
    """手机无线 ADB 链路管理（后台线程自动维持连接）"""

    def __init__(self, adb_path=None, serial=None, on_state=None):
        self.adb = _find_adb(adb_path)
        self.serial = serial or "YOUR_PHONE_SERIAL"
        self.on_state = on_state

        self.lock = threading.Lock()
        self.endpoint = ""          # 当前 ip:5555
        self.online = False
        self.model = ""
        self.battery = None
        self.state = "idle"         # idle / connecting / online / need_usb / error
        self.msg = "未启动"
        self.last_error = ""
        self.discovered = []        # [{name, serial, endpoint}]
        self.reconnects = 0

        self._stop = False
        self._thread = None

    # ---------------------------------------------------------------- 生命周期
    def start(self):
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop = False
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop = True

    # ---------------------------------------------------------------- 基础命令
    def _adb(self, *args, timeout=15):
        """执行 adb 命令，返回 (returncode, 输出)"""
        cmd = [self.adb] + [str(a) for a in args]
        try:
            p = subprocess.run(cmd, capture_output=True, text=True,
                               timeout=timeout, creationflags=CREATE_NO_WINDOW)
            out = (p.stdout or "") + (p.stderr or "")
            return p.returncode, out.strip()
        except subprocess.TimeoutExpired:
            return -1, "timeout"
        except Exception as e:
            return -1, "%s" % e

    def _adb_s(self, *args, timeout=15):
        """对「当前设备」执行：优先端点，其次序列号，都加 -s"""
        target = self.endpoint or self.serial
        return self._adb("-s", target, *args, timeout=timeout)

    # ---------------------------------------------------------------- 设备列表
    def devices(self):
        """解析 adb devices -l，返回 [{serial, state, model}]"""
        rc, out = self._adb("devices", "-l", timeout=10)
        res = []
        if rc != 0:
            return res
        for ln in out.splitlines():
            ln = ln.strip()
            if not ln or ln.startswith("List of devices") or ln.startswith("*"):
                continue
            parts = ln.split()
            if len(parts) < 2:
                continue
            serial, state = parts[0], parts[1]
            model = ""
            for p in parts[2:]:
                if p.startswith("model:"):
                    model = p[6:]
            res.append({"serial": serial, "state": state, "model": model})
        return res

    # ---------------------------------------------------------------- mDNS 发现
    def mdns_services(self):
        """adb mdns services → [{name, serial, endpoint}]"""
        rc, out = self._adb("mdns", "services", timeout=8)
        res = []
        if rc != 0:
            return res
        for ln in out.splitlines():
            ln = ln.strip()
            if "_adb._tcp" not in ln:
                continue
            # adb-YOUR_PHONE_SERIAL   _adb._tcp   192.168.1.123:5555
            parts = ln.split()
            if len(parts) < 3:
                continue
            name = parts[0]
            ep = parts[-1]
            ser = name[4:] if name.startswith("adb-") else name
            res.append({"name": name, "serial": ser, "endpoint": ep})
        return res

    # ---------------------------------------------------------------- 扫网段
    def scan_network(self, port=5555, timeout=0.8):
        """扫本机所在 /24 的指定端口（自动取当前 IP，换网络也能用）"""
        ips = local_ipv4_list()
        bases = []
        for ip in ips:
            bases.append(".".join(ip.split(".")[:3]) + ".")

        def probe(ip):
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(timeout)
            try:
                s.connect((ip, port))
                return ip
            except Exception:
                return None
            finally:
                try:
                    s.close()
                except Exception:
                    pass

        targets = []
        for b in bases:
            targets.extend([b + str(i) for i in range(1, 255)])
        hits = []
        try:
            with ThreadPoolExecutor(max_workers=128) as ex:
                for r in ex.map(probe, targets):
                    if r:
                        hits.append("%s:%d" % (r, port))
        except Exception:
            pass
        return hits

    # ---------------------------------------------------------------- 连接
    def _verify(self, target):
        """校验设备身份：序列号是否匹配；顺便读型号与电量"""
        rc, out = self._adb("-s", target, "shell", "getprop ro.serialno", timeout=10)
        if rc != 0:
            return False
        got = out.strip().splitlines()[0].strip() if out.strip() else ""
        if got != self.serial:
            return False
        self.serial = got
        # 型号
        rc2, out2 = self._adb("-s", target, "shell",
                              "getprop ro.product.brand; getprop ro.product.model", timeout=10)
        if rc2 == 0:
            parts = [x.strip() for x in out2.splitlines() if x.strip()]
            if len(parts) >= 2:
                self.model = "%s %s" % (parts[0], parts[1])
            elif parts:
                self.model = parts[0]
        # 电量
        rc3, out3 = self._adb("-s", target, "shell", "dumpsys battery", timeout=10)
        if rc3 == 0:
            m = re.search(r"level:\s*(\d+)", out3)
            if m:
                try:
                    self.battery = int(m.group(1))
                except Exception:
                    pass
        return True

    def connect(self, endpoint):
        """连一个端点并校验身份"""
        rc, out = self._adb("connect", endpoint, timeout=12)
        if rc != 0:
            self.last_error = out
            return False
        if "cannot" in out.lower() or "failed" in out.lower():
            self.last_error = out
            return False
        # connect 成功不代表授权成功，必须再看 devices 状态
        time.sleep(0.4)
        for d in self.devices():
            if d["serial"] == endpoint and d["state"] == "device":
                if self._verify(endpoint):
                    with self.lock:
                        self.endpoint = endpoint
                        self.online = True
                        self.state = "online"
                        self.msg = "已连接 %s" % endpoint
                        self.last_error = ""
                    return True
            if d["serial"] == endpoint and d["state"] == "unauthorized":
                self.last_error = "端点未授权（adb kill-server 后再试）"
        self.last_error = self.last_error or "已 connect 但设备未就绪"
        return False

    def discover(self, do_connect=True):
        """按 缓存 → mDNS → 扫网段 的顺序找手机"""
        found = []

        # ① 已连接
        for d in self.devices():
            if d["state"] == "device" and d["serial"].split(":")[0].count("."):
                found.append({"name": "adb-" + d["serial"], "serial": d["serial"], "endpoint": d["serial"]})

        # ② mDNS
        for s in self.mdns_services():
            if not any(x["endpoint"] == s["endpoint"] for x in found):
                found.append(s)

        # ③ 扫网段（只在没找到时做，扫一次约 1.5 秒）
        if not found:
            for ep in self.scan_network():
                found.append({"name": "scan-" + ep, "serial": "", "endpoint": ep})

        with self.lock:
            self.discovered = found

        if not do_connect:
            return found

        # 优先匹配序列号；mdns 的服务名带序列号，可以直接判断
        ordered = []
        for f in found:
            if f.get("serial") and self.serial and f["serial"] == self.serial:
                ordered.insert(0, f)
            else:
                ordered.append(f)

        for f in ordered:
            if self.connect(f["endpoint"]):
                return found
        return found

    def disconnect(self):
        rc, out = self._adb("disconnect", self.endpoint or "", timeout=8)
        with self.lock:
            self.online = False
            self.endpoint = ""
            self.state = "idle"
            self.msg = "已断开"
        return rc == 0

    # ---------------------------------------------------------------- 一键配对
    def pair_usb(self):
        """插 USB 后跑：tcpip 5555 → 读 wlan0 IP → connect → 校验"""
        # 1) 找 USB（非 ip:port 形式的序列号）
        usb = None
        for d in self.devices():
            if ":" not in d["serial"] and d["state"] == "device":
                usb = d
                break
        if not usb:
            self.last_error = "没找到 USB 设备，请先插线并在手机上允许 USB 调试"
            return {"ok": False, "msg": self.last_error}

        serial_usb = usb["serial"]
        if self.serial and serial_usb != self.serial:
            # 型号不匹配也允许，但记下来
            self.serial = serial_usb

        # 2) 切 tcpip
        rc, out = self._adb("-s", serial_usb, "tcpip", "5555", timeout=12)
        if rc != 0:
            self.last_error = "tcpip 失败: " + out
            return {"ok": False, "msg": self.last_error}
        time.sleep(1.5)

        # 3) 读手机 wlan0 IP
        rc, out = self._adb("-s", serial_usb, "shell",
                            "ip -f inet addr show wlan0", timeout=10)
        ip = ""
        if rc == 0:
            m = re.search(r"inet\s+(\d+\.\d+\.\d+\.\d+)", out)
            if m:
                ip = m.group(1)
        if not ip:
            self.last_error = "手机 wlan0 没有 IP，确认手机已连上 WiFi"
            return {"ok": False, "msg": self.last_error}

        ep = "%s:5555" % ip

        # 4) 重启 adb server（坑 1：tcpip 会清授权，直接 connect 会 unauthorized）
        self._adb("kill-server", timeout=8)
        time.sleep(0.5)
        self._adb("start-server", timeout=10)
        time.sleep(1.0)

        # 5) 连接 + 校验
        ok = self.connect(ep)
        if not ok:
            return {"ok": False, "msg": self.last_error or "connect 后校验失败", "endpoint": ep}

        return {"ok": True, "msg": "配对成功，可以拔线了", "endpoint": ep, "serial": self.serial}

    # ---------------------------------------------------------------- 状态
    def status(self):
        with self.lock:
            return {
                "online": self.online,
                "state": self.state,
                "msg": self.msg,
                "serial": self.serial,
                "endpoint": self.endpoint,
                "model": self.model,
                "battery": self.battery,
                "lastError": self.last_error,
                "discovered": list(self.discovered),
                "reconnects": self.reconnects,
                "adb": self.adb,
            }

    def frame_ok(self):
        """快速探活：能否执行一条 shell"""
        if not self.endpoint:
            return False
        rc, out = self._adb_s("shell", "echo", "ping", timeout=8)
        return rc == 0 and "ping" in out

    # ---------------------------------------------------------------- 后台线程
    def _run(self):
        interval = 10
        while not self._stop:
            try:
                if self.online:
                    if not self.frame_ok():
                        with self.lock:
                            self.online = False
                            self.state = "connecting"
                            self.msg = "探测失败，准备重连"
                            self.reconnects += 1
                    else:
                        # 已在线：偶尔刷新电量
                        pass
                else:
                    with self.lock:
                        if self.state != "need_usb":
                            self.state = "connecting"
                            self.msg = "正在发现手机…"

                    # 先用缓存端点
                    cached = self.endpoint
                    ok = False
                    if cached and self.connect(cached):
                        ok = True
                    if not ok:
                        found = self.discover(do_connect=False)
                        if found:
                            ok = self.discover(do_connect=True) and self.online
                    with self.lock:
                        if not ok:
                            self.state = "need_usb"
                            self.msg = "未发现手机，请插 USB 点一键配对"
                        else:
                            self.msg = "已连接 %s" % self.endpoint
            except Exception as e:
                with self.lock:
                    self.last_error = "%s" % e
            time.sleep(interval)


# ---------------------------------------------------------------- CLI 自测
if __name__ == "__main__":
    import json
    link = PhoneLink()
    print("adb:", link.adb)
    print("本机 IP:", local_ipv4_list())
    print("devices:", link.devices())
    print("mdns:", link.mdns_services())
    print("scan:", link.scan_network())
    st = link.status()
    print("status:", json.dumps(st, ensure_ascii=False, indent=2))
