# -*- coding: utf-8 -*-
"""
61 · ESP-01 <-> 电脑 TCP 通信测试服务器

用法：
    python tcp_test_server.py

默认监听 0.0.0.0:8080，ESP-01 连上来之后：
    - 它发什么，这里就打印什么
    - 你在控制台敲一行回车，就发给 ESP-01

命令：
    /ip        显示本机所有 IP（告诉 ESP 连哪个）
    /port N    换端口（需重启）
    /help      帮助
    /quit      退出

依赖：只用标准库，不需要 pip install
"""

import socket
import threading
import sys
import os


def list_ips():
    """列出本机所有 IPv4 地址"""
    ips = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except Exception:
        pass

    # 兜底：用 UDP 探一个外部地址拿到出口 IP
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.3)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip not in ips and not ip.startswith("127."):
            ips.insert(0, ip)
    except Exception:
        pass

    return ips


class TcpTestServer:
    def __init__(self, host="0.0.0.0", port=8080):
        self.host = host
        self.port = port
        self.srv = None
        self.client = None
        self.client_addr = None
        self.lock = threading.Lock()
        self.running = False

    # ---------------- 启动 ----------------
    def start(self):
        self.srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            self.srv.bind((self.host, self.port))
        except OSError as e:
            print("!! 端口 %d 绑定失败: %s" % (self.port, e))
            print("   可能被占用，换一个端口：修改 MAX_PORT 或本文件里的 port")
            return False

        self.srv.listen(1)
        self.running = True

        print("=" * 60)
        print("  ESP-01 TCP 测试服务器")
        print("=" * 60)
        print("  监听: 0.0.0.0:%d" % self.port)
        for ip in list_ips():
            print("  ESP 连接地址: %-18s 端口 %d" % (ip, self.port))
        print("=" * 60)
        print("  等待 ESP-01 连接 ...")
        print()

        threading.Thread(target=self._accept_loop, daemon=True).start()
        return True

    # ---------------- 接受连接 ----------------
    def _accept_loop(self):
        while self.running:
            try:
                conn, addr = self.srv.accept()
            except OSError:
                break

            with self.lock:
                if self.client is not None:
                    try:
                        self.client.close()
                    except Exception:
                        pass
                self.client = conn
                self.client_addr = addr

            print("[+] ESP-01 已连接: %s:%d" % (addr[0], addr[1]))
            print("    现在可以互发数据了（输入一行回车就发给 ESP）")
            print()

            threading.Thread(target=self._recv_loop, args=(conn,), daemon=True).start()

    # ---------------- 收数据 ----------------
    def _recv_loop(self, conn):
        buf = b""
        while self.running:
            try:
                data = conn.recv(4096)
            except OSError:
                break
            if not data:
                break

            buf += data
            # 按行打印
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                self._print_rx(line)

            if len(buf) > 512:
                self._print_rx(buf)
                buf = b""

        print("[-] ESP-01 断开连接")
        with self.lock:
            if self.client is conn:
                self.client = None
                self.client_addr = None
        try:
            conn.close()
        except Exception:
            pass
        print("    等待新的连接 ...")

    def _print_rx(self, raw):
        try:
            text = raw.decode("utf-8", errors="replace")
        except Exception:
            text = repr(raw)
        text = text.rstrip("\r\n")
        if text:
            print("  [RX] %s" % text)

    # ---------------- 发数据 ----------------
    def send(self, text):
        with self.lock:
            if self.client is None:
                print("  !! 没有 ESP 连接，先让 ESP 连上来")
                return False
            try:
                self.client.sendall(text.encode("utf-8"))
                print("  [TX] %s" % text.rstrip("\r\n"))
                return True
            except Exception as e:
                print("  !! 发送失败: %s" % e)
                return False

    def stop(self):
        self.running = False
        with self.lock:
            if self.client:
                try:
                    self.client.close()
                except Exception:
                    pass
            if self.srv:
                try:
                    self.srv.close()
                except Exception:
                    pass


def main():
    port = 8080
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass

    srv = TcpTestServer(port=port)
    if not srv.start():
        input("按回车退出")
        return

    print("命令: /ip  /help  /quit      直接输入文字 = 发给 ESP")
    print()

    while True:
        try:
            line = input()
        except (EOFError, KeyboardInterrupt):
            break

        if line == "/quit":
            break
        elif line == "/ip":
            print("  本机 IP:")
            for ip in list_ips():
                print("    %s" % ip)
            print("  ESP 端用: AT+CIPSTART=\"TCP\",\"%s\",%d" % (list_ips()[0] if list_ips() else "192.168.1.143", port))
        elif line == "/help":
            print("  /ip     显示本机 IP 和 ESP 该用的连接命令")
            print("  /quit   退出")
            print("  其它输入  直接发给 ESP-01（自动补 \\r\\n）")
        elif line.strip() == "":
            continue
        else:
            srv.send(line + "\r\n")

    srv.stop()
    print("已退出")


if __name__ == "__main__":
    main()
