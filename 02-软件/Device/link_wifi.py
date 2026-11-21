# -*- coding: utf-8 -*-
r"""
V1.3 设备端 WiFi 链路模块（长连接版）

配套固件：STM32\80-SimpleServer\80-SimpleServer.ino（V8.3-HEAL，最终版）

架构：
    ESP-01 上电后连 WiFi（192.168.1.100），开 8080 服务器并一直开着
    本模块主动连 192.168.1.100:8080，连上后保持长连接
    断开才重连（指数退避，最长 8 秒）

用法：
    from link_wifi import WifiLink
    link = WifiLink(esp_ip="192.168.1.100", esp_port=8080)
    link.start()
    link.send("?\\n")
    link.is_connected()
    link.status()      # 给网页显示
    link.stop()

只用标准库。
"""

import socket
import threading
import time
from datetime import datetime


class WifiLink(object):
    def __init__(self, esp_ip="192.168.1.100", esp_port=8080,
                 my_port=None, on_line=None):
        self.esp_ip = esp_ip
        self.esp_port = esp_port
        self.on_line = on_line            # 收到一行文本时的回调

        self.lock = threading.Lock()
        self.send_lock = threading.Lock()
        self.sock = None

        self.connected = False
        self.since = None
        self.err = ""
        self.rx_count = 0
        self.tx_count = 0
        self.reconnects = 0
        self.last_rx = ""

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
        self._close()

    def _close(self):
        with self.send_lock:
            s = self.sock
            self.sock = None
        if s:
            try:
                s.shutdown(socket.SHUT_RDWR)
            except Exception:
                pass
            try:
                s.close()
            except Exception:
                pass
        with self.lock:
            self.connected = False
            self.since = None

    # ---------------------------------------------------------------- 状态
    def status(self):
        with self.lock:
            return {
                "mode": "wifi",
                "phase": "connected" if self.connected else "disconnected",
                "phaseText": ("已连接 %s:%d" % (self.esp_ip, self.esp_port))
                             if self.connected
                             else ("连接中 %s:%d" % (self.esp_ip, self.esp_port)),
                "connected": self.connected,
                "peer": ("%s:%d" % (self.esp_ip, self.esp_port)) if self.connected else None,
                "since": self.since,
                "esp": "%s:%d" % (self.esp_ip, self.esp_port),
                "listen": "",
                "err": self.err,
                "rx": self.rx_count,
                "tx": self.tx_count,
                "reconnects": self.reconnects,
                "lastRx": self.last_rx,
            }

    def is_connected(self):
        with self.lock:
            return self.connected

    # ---------------------------------------------------------------- 发送
    def send(self, text):
        with self.send_lock:
            s = self.sock
            if s is None:
                return False
            try:
                s.sendall(text.encode("utf-8"))
            except Exception as e:
                with self.lock:
                    self.err = "发送失败: %s" % e
                # socket 已死：关掉，让接收线程退出并触发重连
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except Exception:
                    pass
                return False
        with self.lock:
            self.tx_count += 1
        return True

    # ---------------------------------------------------------------- 主循环
    def _run(self):
        backoff = 2

        while not self._stop:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(4)
            try:
                s.connect((self.esp_ip, self.esp_port))
            except Exception as e:
                with self.lock:
                    self.err = "连不上 ESP: %s" % e
                try:
                    s.close()
                except Exception:
                    pass
                time.sleep(backoff)
                backoff = min(backoff + 1, 8)
                continue

            backoff = 2
            s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            s.settimeout(None)

            with self.send_lock:
                self.sock = s
            with self.lock:
                self.connected = True
                self.since = datetime.now().strftime("%H:%M:%S")
                self.err = ""

            self._recv_loop(s)

            self._close()
            with self.lock:
                if not self.err:
                    self.err = "对端关闭"
                self.reconnects += 1
            try:
                s.close()
            except Exception:
                pass

            if not self._stop:
                time.sleep(2)

    # ---------------------------------------------------------------- 收数据
    def _recv_loop(self, s):
        buf = b""
        while not self._stop:
            try:
                data = s.recv(2048)
            except Exception as e:
                with self.lock:
                    self.err = "接收异常: %s" % e
                return
            if not data:
                with self.lock:
                    self.err = "对端关闭"
                return

            buf += data
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                self._emit(line)
            if len(buf) > 1024:
                self._emit(buf)
                buf = b""

        if buf:
            self._emit(buf)

    def _emit(self, raw):
        try:
            text = raw.decode("utf-8", errors="replace")
        except Exception:
            text = repr(raw)
        text = text.replace("\r", "").strip()
        if not text:
            return
        with self.lock:
            self.rx_count += 1
            self.last_rx = text
            self.err = ""      # 收到数据说明链路健康
        if self.on_line:
            try:
                self.on_line(text)
            except Exception:
                pass
