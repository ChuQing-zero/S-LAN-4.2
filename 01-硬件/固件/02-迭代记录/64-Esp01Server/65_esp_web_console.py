# -*- coding: utf-8 -*-
"""
65 · ESP-01 服务器模式 —— 电脑端网页控制台（客户端）

配合 64-Esp01Server.ino 使用：
    ESP-01 当 TCP 服务器（固定 IP 192.168.1.100:8080）
    电脑主动连它 -> 不用知道电脑 IP，换热点也不用重烧固件

启动：
    python 65_esp_web_console.py
    或者指定 ESP 地址：
    python 65_esp_web_console.py --esp 192.168.1.100 --port 8080

然后：
    浏览器打开 http://localhost:8000

页面功能：
    - 自动连接 ESP（断了自动重连）
    - 显示连接状态
    - 双向日志（收 / 发）
    - 输入框给 ESP 发数据
    - 快捷按钮：PING / MYIP / 查询

只用标准库，不需要 pip install。
"""

import argparse
import json
import socket
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


# ============================================================ 状态
class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.sock = None
        self.esp_addr = None
        self.rx = []
        self.tx = []
        self.total_rx = 0
        self.total_tx = 0
        self.since = None
        self.connected = False
        self.auto_reconnect = True
        self.last_error = ""
        self.max_lines = 500

    def _add(self, arr, text):
        arr.append((datetime.now().strftime("%H:%M:%S"), text))
        if len(arr) > self.max_lines:
            del arr[:len(arr) - self.max_lines]

    def log_rx(self, text):
        with self.lock:
            self.total_rx += 1
            self._add(self.rx, text)

    def log_tx(self, text):
        with self.lock:
            self.total_tx += 1
            self._add(self.tx, text)

    def set_connected(self, ok, addr=None, err=""):
        with self.lock:
            self.connected = ok
            if ok:
                self.esp_addr = addr
                self.since = datetime.now().strftime("%H:%M:%S")
                self._add(self.rx, "=== 已连接 %s:%d ===" % addr)
            else:
                self.since = None
                self.esp_addr = None
                self.last_error = err
                if err:
                    self._add(self.rx, "=== 连接断开: %s ===" % err)

    def snapshot(self):
        with self.lock:
            return {
                "connected": self.connected,
                "esp": ("%s:%d" % self.esp_addr) if self.esp_addr else None,
                "since": self.since,
                "rx": [{"t": t, "d": d} for t, d in self.rx],
                "tx": [{"t": t, "d": d} for t, d in self.tx],
                "totalRx": self.total_rx,
                "totalTx": self.total_tx,
                "err": self.last_error,
                "auto": self.auto_reconnect,
            }

    def send(self, data):
        with self.lock:
            s = self.sock
        if s is None:
            return False, "没连上 ESP"
        try:
            s.sendall(data.encode("utf-8"))
        except Exception as e:
            return False, "发送失败: %s" % e
        self.log_tx(data.rstrip("\r\n"))
        return True, "OK"

    def clear(self):
        with self.lock:
            self.rx = []
            self.tx = []


STATE = State()


# ============================================================ TCP 客户端（连 ESP）
class EspClient(threading.Thread):
    def __init__(self, host, port):
        super().__init__(daemon=True)
        self.host = host
        self.port = port

    def run(self):
        retry_delay = 2

        while True:
            if not STATE.auto_reconnect and STATE.since:
                time.sleep(1)
                continue

            print("[TCP] 正在连接 ESP %s:%d ..." % (self.host, self.port))
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(5)
            try:
                s.connect((self.host, self.port))
            except Exception as e:
                msg = str(e)
                print("[TCP] 连接失败: %s  （%d 秒后重试）" % (msg, retry_delay))
                STATE.set_connected(False, err=msg)
                try:
                    s.close()
                except Exception:
                    pass
                time.sleep(retry_delay)
                retry_delay = min(retry_delay + 1, 5)
                continue

            retry_delay = 2
            s.settimeout(None)
            s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

            with STATE.lock:
                STATE.sock = s
            STATE.set_connected(True, (self.host, self.port))
            print("[TCP] 已连接 ESP")

            # 连上后主动报一下电脑地址（ESP 会记录，便于调试）
            try:
                me = local_ip()
                hello = "MYIP:%s:8000\n" % me
                s.sendall(hello.encode("utf-8"))
                STATE.log_tx(hello.rstrip("\n"))
            except Exception:
                pass

            self._recv_loop(s)

            with STATE.lock:
                STATE.sock = None
            STATE.set_connected(False, err="对端关闭")
            try:
                s.close()
            except Exception:
                pass
            print("[TCP] 断开，准备重连")
            time.sleep(2)

    def _recv_loop(self, s):
        buf = b""
        while True:
            try:
                data = s.recv(4096)
            except Exception as e:
                STATE.set_connected(False, err=str(e))
                return
            if not data:
                return

            buf += data
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                self._emit(line)
            if len(buf) > 512:
                self._emit(buf)
                buf = b""

        if buf:
            self._emit(buf)

    @staticmethod
    def _emit(raw):
        try:
            text = raw.decode("utf-8", errors="replace")
        except Exception:
            text = repr(raw)
        text = text.replace("\r", "")
        for line in text.split("\n"):
            if line.strip():
                STATE.log_rx(line)


# ============================================================ 工具
def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.settimeout(0.3)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


# ============================================================ 网页
PAGE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ESP-01 服务器模式 · 电脑控制台</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
       background:#0f1419;color:#e6e6e6}
  .wrap{max-width:1000px;margin:0 auto;padding:20px 16px 60px}
  h1{font-size:22px;margin:0 0 6px}
  .sub{color:#8b949e;font-size:13px;margin-bottom:18px}
  .card{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:16px;margin-bottom:16px}
  .row{display:flex;gap:18px;flex-wrap:wrap;align-items:center}
  .k{color:#8b949e;font-size:13px}
  .v{font-family:ui-monospace,Consolas,monospace;font-size:14px}
  .status{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:600}
  .dot{width:12px;height:12px;border-radius:50%;background:#d03050;box-shadow:0 0 8px #d03050}
  .dot.on{background:#3fb950;box-shadow:0 0 10px #3fb950}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  @media(max-width:760px){.cols{grid-template-columns:1fr}}
  .logtitle{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
  .logtitle span{font-size:13px;color:#8b949e}
  .log{height:320px;overflow-y:auto;background:#0d1117;border-radius:8px;padding:10px;
       font-family:ui-monospace,Consolas,monospace;font-size:12.5px;line-height:1.65}
  .ln{white-space:pre-wrap;word-break:break-all}
  .ln .t{color:#484f58;margin-right:8px}
  .rx .ln .d{color:#7ee787}
  .tx .ln .d{color:#79c0ff}
  input[type=text]{width:100%;padding:11px 13px;border-radius:8px;border:1px solid #30363d;
                   background:#0d1117;color:#e6e6e6;font-size:14px;
                   font-family:ui-monospace,Consolas,monospace}
  input[type=text]:focus{outline:none;border-color:#388bfd}
  .btns{display:flex;gap:10px;margin-top:10px;flex-wrap:wrap}
  button{padding:10px 18px;border-radius:8px;border:1px solid #30363d;background:#21262d;
         color:#e6e6e6;font-size:14px;cursor:pointer}
  button:hover{background:#30363d}
  button.primary{background:#238636;border-color:#2ea043}
  button.primary:hover{background:#2ea043}
  button.danger{background:#8b2b2b;border-color:#a83232}
  .hint{font-size:12.5px;color:#8b949e;line-height:1.8;margin-top:12px}
  .hint code{color:#58a6ff}
  .err{color:#f85149;font-size:12.5px;margin-top:8px}
</style>
</head>
<body>
<div class="wrap">
  <h1>ESP-01 服务器模式 · 电脑控制台</h1>
  <div class="sub">电脑主动连 ESP（<span id="espaddr">---</span>），断线自动重连</div>

  <div class="card">
    <div class="status">
      <div class="dot" id="dot"></div>
      <div id="stext">正在连接...</div>
    </div>
    <div class="row" style="margin-top:14px">
      <div><span class="k">ESP 地址 </span><span class="v" id="esp">-</span></div>
      <div><span class="k">连接时间 </span><span class="v" id="since">-</span></div>
      <div><span class="k">收 </span><span class="v" id="trx">0</span></div>
      <div><span class="k">发 </span><span class="v" id="ttx">0</span></div>
      <div><span class="k">本机 IP </span><span class="v" id="myip">-</span></div>
    </div>
    <div class="err" id="err"></div>
  </div>

  <div class="cols">
    <div class="card">
      <div class="logtitle"><b>ESP → 电脑</b><span id="rxcount">0 条</span></div>
      <div class="log rx" id="logrx"></div>
    </div>
    <div class="card">
      <div class="logtitle"><b>电脑 → ESP</b><span id="txcount">0 条</span></div>
      <div class="log tx" id="logtx"></div>
    </div>
  </div>

  <div class="card">
    <div class="k" style="margin-bottom:8px">发给 ESP（回车发送）</div>
    <input type="text" id="txin" placeholder="比如 hello / PING">
    <div class="btns">
      <button class="primary" onclick="doSend()">发送</button>
      <button onclick="preset('hello\\n')">hello</button>
      <button onclick="preset('PING\\n')">PING</button>
      <button onclick="preset('CMD:STATUS\\n')">STATUS</button>
      <button class="danger" onclick="doClear()">清空日志</button>
    </div>
    <div class="hint">
      链路说明：电脑连上 ESP 后，双方可自由收发。<br>
      ESP 每 10 秒发一次 <code>PING</code>，电脑收到可回 <code>PONG</code>。<br>
      收不到数据 → 检查 ESP 是否在线、WiFi 是否正常。
    </div>
  </div>
</div>

<script>
let lastRx = -1, lastTx = -1;

async function poll(){
  try{
    const r = await fetch('/api/status?t=' + Date.now());
    render(await r.json());
  }catch(e){}
}

function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}

function render(d){
  const dot=document.getElementById('dot'), st=document.getElementById('stext');
  if(d.connected){ dot.classList.add('on'); st.textContent='已连接 ESP'; }
  else { dot.classList.remove('on'); st.textContent='未连接（自动重连中）'; }

  document.getElementById('esp').textContent   = d.esp || '-';
  document.getElementById('since').textContent = d.since || '-';
  document.getElementById('trx').textContent   = d.totalRx;
  document.getElementById('ttx').textContent   = d.totalTx;
  document.getElementById('err').textContent   = d.err || '';
  document.getElementById('rxcount').textContent = d.rx.length + ' 条';
  document.getElementById('txcount').textContent = d.tx.length + ' 条';

  if(d.rx.length !== lastRx){
    lastRx = d.rx.length;
    const b = document.getElementById('logrx');
    b.innerHTML = d.rx.map(x=>'<div class="ln"><span class="t">'+x.t+'</span><span class="d">'+esc(x.d)+'</span></div>').join('');
    b.scrollTop = b.scrollHeight;
  }
  if(d.tx.length !== lastTx){
    lastTx = d.tx.length;
    const b = document.getElementById('logtx');
    b.innerHTML = d.tx.map(x=>'<div class="ln"><span class="t">'+x.t+'</span><span class="d">'+esc(x.d)+'</span></div>').join('');
    b.scrollTop = b.scrollHeight;
  }
}

async function doSend(){
  const inp=document.getElementById('txin');
  if(!inp.value) return;
  await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({data:inp.value})});
  inp.value='';
  poll();
}

async function preset(s){
  await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({data:s})});
  poll();
}

async function doClear(){
  await fetch('/api/clear',{method:'POST'});
  lastRx=-1; lastTx=-1; poll();
}

async function initInfo(){
  try{
    const r=await fetch('/api/info'); const d=await r.json();
    document.getElementById('myip').textContent=d.ip;
    document.getElementById('espaddr').textContent=d.espIp+':'+d.espPort;
  }catch(e){}
}

document.getElementById('txin').addEventListener('keydown',e=>{ if(e.key==='Enter') doSend(); });

initInfo(); poll(); setInterval(poll,600);
</script>
</body>
</html>
"""


class Handler(BaseHTTPRequestHandler):
    esp_ip = "192.168.1.100"
    esp_port = 8080

    def log_message(self, fmt, *args):
        return

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        from urllib.parse import urlparse
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            body = PAGE.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/api/status":
            self._json(STATE.snapshot())
        elif path == "/api/info":
            self._json({"ip": local_ip(), "espIp": Handler.esp_ip, "espPort": Handler.esp_port})
        else:
            self.send_error(404)

    def do_POST(self):
        from urllib.parse import urlparse
        path = urlparse(self.path).path
        try:
            n = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(n) if n else b""
            data = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            data = {}

        if path == "/api/send":
            ok, msg = STATE.send(data.get("data", ""))
            self._json({"ok": ok, "msg": msg})
        elif path == "/api/clear":
            STATE.clear()
            self._json({"ok": True})
        else:
            self.send_error(404)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--esp", default="192.168.1.100", help="ESP 的 IP")
    ap.add_argument("--port", type=int, default=8080, help="ESP 的端口")
    ap.add_argument("--http", type=int, default=8000, help="网页端口")
    args = ap.parse_args()

    Handler.esp_ip = args.esp
    Handler.esp_port = args.port

    print()
    print("=" * 62)
    print("  ESP-01 服务器模式 · 电脑控制台")
    print("=" * 62)
    print("  浏览器打开:  http://localhost:%d" % args.http)
    print("  连接目标  :  %s:%d  (ESP-01)" % (args.esp, args.port))
    print("  本机 IP   :  %s" % local_ip())
    print("=" * 62)
    print()
    print("  按 Ctrl+C 退出")
    print()

    EspClient(args.esp, args.port).start()

    httpd = ThreadingHTTPServer(("0.0.0.0", args.http), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已退出")
        httpd.server_close()


if __name__ == "__main__":
    main()
