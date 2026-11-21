# -*- coding: utf-8 -*-
"""
61 · 局域网设备扫描器（找 ESP-01 / Nano / 任何联网设备）

用途：
    电脑不知道 ESP-01 拿到什么 IP 时，用这个扫一遍局域网，
    把在线设备、MAC 地址、厂商、开放端口都列出来。
    ESP8266 的 MAC 厂商是 Espressif，会自动标出来。

用法：
    python find_esp.py                # 扫本机所在的 /24 网段
    python find_esp.py 192.168.43     # 指定网段前缀
    python find_esp.py -p 8080        # 只列开放 8080 端口的设备
    python find_esp.py -t 80          # 同时测 80 端口

依赖：只用标准库
"""

import socket
import subprocess
import sys
import threading
import time
import re

# ESP8266 / ESP32 常见的 MAC 厂商前缀（OUI）
ESP_OUI = {
    "5C:CF:7F": "Espressif",
    "AC:67:B2": "Espressif",
    "84:F3:EB": "Espressif",
    "DC:4F:22": "Espressif",
    "84:0D:8E": "Espressif",
    "A0:20:A6": "Espressif",
    "B4:E6:2D": "Espressif",
    "C4:4F:33": "Espressif",
    "48:3F:DA": "Espressif",
    "24:0A:C4": "Espressif",
    "30:AE:A4": "Espressif",
    "2C:3A:E8": "Espressif",
    "3C:71:BF": "Espressif",
    "60:01:94": "Espressif",
    "68:C6:3A": "Espressif",
    "7C:9E:BD": "Espressif",
    "8C:AA:B5": "Espressif",
    "90:38:0C": "Espressif",
    "A4:CF:12": "Espressif",
    "D8:A0:1D": "Espressif",
    "EC:FA:BC": "Espressif",
    "F4:CF:A2": "Espressif",
    "FC:F5:C4": "Espressif",
}


def local_ip():
    """拿到本机在局域网里的 IP"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.settimeout(0.3)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "192.168.1.2"
    finally:
        s.close()
    return ip


def ping(ip, timeout_ms=350):
    """Windows 下快速 ping 一个 IP，返回是否可达"""
    cmd = ["ping", "-n", "1", "-w", str(timeout_ms), ip]
    try:
        r = subprocess.run(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=1.0,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
        )
        return r.returncode == 0
    except Exception:
        return False


def arp_table():
    """读 ARP 缓存：{ip: mac}"""
    out = {}
    try:
        txt = subprocess.run(
            ["arp", "-a"],
            capture_output=True,
            timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
        ).stdout.decode("gbk", errors="ignore")
    except Exception:
        return out

    for line in txt.splitlines():
        m = re.search(r"(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2})", line)
        if m:
            ip = m.group(1)
            mac = m.group(2).replace("-", ":").upper()
            out[ip] = mac
    return out


def port_open(ip, port, timeout=0.4):
    """测 TCP 端口是否开放"""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((ip, port))
        s.close()
        return True
    except Exception:
        try:
            s.close()
        except Exception:
            pass
        return False


def vendor_of(mac):
    """根据 MAC 前 3 段判断厂商"""
    if not mac:
        return ""
    prefix = mac[:8].upper()
    return ESP_OUI.get(prefix, "")


def sweep(prefix, ports, workers=64):
    """并发 ping 扫 /24"""
    results = {}
    lock = threading.Lock()

    def work(i):
        ip = "%s.%d" % (prefix, i)
        ok = ping(ip)
        with lock:
            results[ip] = ok

    threads = []
    for i in range(1, 255):
        t = threading.Thread(target=work, args=(i,), daemon=True)
        threads.append(t)

    # 分批启动，避免线程爆炸
    for idx, t in enumerate(threads):
        t.start()
        if (idx + 1) % workers == 0:
            time.sleep(0.02)
            for tt in threads[max(0, idx - workers + 1):idx + 1]:
                tt.join(timeout=2.0)

    for t in threads:
        t.join(timeout=2.0)

    alive = [ip for ip, ok in results.items() if ok]

    # 端口探测（只对活的）
    port_hits = {}
    if ports:
        plock = threading.Lock()

        def pw(ip):
            hit = []
            for p in ports:
                if port_open(ip, p):
                    hit.append(p)
            with plock:
                port_hits[ip] = hit

        ts = [threading.Thread(target=pw, args=(ip,), daemon=True) for ip in alive]
        for t in ts:
            t.start()
        for t in ts:
            t.join(timeout=3.0)

    return alive, port_hits


def main():
    args = sys.argv[1:]
    ports = [8080]
    prefix = None

    i = 0
    while i < len(args):
        a = args[i]
        if a == "-p":
            i += 1
            if i < len(args):
                ports = [int(x) for x in args[i].split(",")]
        elif a == "-t":
            i += 1
            if i < len(args):
                ports += [int(x) for x in args[i].split(",")]
        elif re.match(r"^\d+\.\d+\.\d+$", a):
            prefix = a
        i += 1

    my_ip = local_ip()
    if prefix is None:
        prefix = ".".join(my_ip.split(".")[:3])

    print("=" * 66)
    print("  局域网扫描  本机 IP: %s   网段: %s.0/24" % (my_ip, prefix))
    print("  探测端口: %s" % (ports if ports else "无"))
    print("=" * 66)
    print("  正在扫描 254 个地址，请稍候 ...")
    print()

    t0 = time.time()
    alive, port_hits = sweep(prefix, ports)
    elapsed = time.time() - t0

    arp = arp_table()

    print("  扫描完成，用时 %.1f 秒，发现 %d 台在线设备" % (elapsed, len(alive)))
    print()
    print("  %-16s %-20s %-12s %-16s %s" % ("IP", "MAC", "厂商", "开放端口", "备注"))
    print("  " + "-" * 76)

    esp_found = []
    for ip in sorted(alive, key=lambda x: int(x.split(".")[-1])):
        mac = arp.get(ip, "")
        ven = vendor_of(mac)
        p = port_hits.get(ip, [])
        note = ""

        if ven == "Espressif":
            note = "★ ESP8266/ESP32"
            esp_found.append((ip, mac, p))
        elif ip == my_ip:
            note = "← 本机"
        elif ip.endswith(".1"):
            note = "网关"

        print("  %-16s %-20s %-12s %-16s %s" % (
            ip, mac or "-", ven or "-", ",".join(str(x) for x in p) or "-", note))

    print("  " + "-" * 76)
    print()

    if esp_found:
        print("  ★ 找到 ESP 设备:")
        for ip, mac, p in esp_found:
            print("      IP = %s   MAC = %s" % (ip, mac or "-"))
            if p:
                print("      开放端口: %s" % ",".join(str(x) for x in p))
        print()
        ip = esp_found[0][0]
        print("  下一步在 ESP 串口敲:")
        print('      AT+CIPMUX=0')
        print('      AT+CIPSTART="TCP","%s",%d' % (my_ip, ports[0] if ports else 8080))
        print("  或者在电脑敲:")
        print('      telnet %s %d' % (ip, ports[0] if ports else 8080))
    else:
        print("  ⚠ 没找到 ESP 设备。可能原因:")
        print("     1. ESP 还没连上 WiFi（先在 ESP 串口敲 AT+CIFSR 看有没有 IP）")
        print("     2. ESP 的 IP 不在本网段（本机是 %s）" % my_ip)
        print("     3. ESP 在省电模式，ping 不通 —— 试直接给它发 TCP")
        print()
        print("  直接查 ESP 自己的 IP 最可靠：在 ESP 串口敲")
        print("      AT+CIFSR")
        print("  会直接告诉你它的 IP。")
    print()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n已中断")
