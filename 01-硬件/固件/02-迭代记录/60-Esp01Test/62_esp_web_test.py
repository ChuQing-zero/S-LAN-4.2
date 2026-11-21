# -*- coding: utf-8 -*-
"""
62 · ESP-01 网页测试工具

一个文件搞定，只用标准库，不需要 pip install。

启动：
    python 62_esp_web_test.py

然后：
    1. 浏览器打开 http://localhost:8000
    2. 页面上会显示电脑的 IP 和要用的 TCP 端口
    3. ESP-01 那边敲 AT+CIPSTART="TCP","<页面显示IP>",8080
    4. 连上后页面会变成绿色「已连接」，ESP 发来的数据实时显示
    5. 页面下方输入框可以给 ESP 发数据

端口说明：
    TCP  8080  ← ESP-01 连这里
    HTTP 8000  ← 浏览器看这里

可选参数：
    python 62_esp_web_test.py --tcp 8080 --http 8000
"""

import argparse
import json
import socket
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs


# ============================================================ 共享状态
class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.conn = None
        self.peer = None          # (ip, port)
        self.rx_lines = []        # [(time, text)]
        self.tx_lines = []
        self.total_rx = 0
        self.total_tx = 0
        self.connected_since = None
        self.max_lines = 500

    # ---------- 连接 ----------
    def attach(self, conn, peer):
        with self.lock:
            old = self.conn
            self.conn = conn
            self.peer = peer
            self.connected_since = datetime.now().strftime("%H:%M:%S")
            self._log("system", "ESP 已连接 %s:%d" % (peer[0], peer[1]), "rx")
        if old is not None and old is not conn:
            try:
                old.close()
            except Exception:
                pass

    def detach(self, conn):
        with self.lock:
            if self.conn is conn:
                self.conn = None
                self.peer = None
                self.connected_since = None
                self._log("system", "ESP 断开连接", "rx")

    def is_connected(self):
        with self.lock:
            return self.conn is not None

    # ---------- 日志 ----------
    def _log(self, kind, text, direction):
        item = (datetime.now().strftime("%H:%M:%S"), text)
        key = "rx_lines" if direction == "rx" else "tx_lines"
        arr = getattr(self, key)
        arr.append(item)
        if len(arr) > self.max_lines:
            del arr[:len(arr) - self.max_lines]

    def log_rx(self, text):
        with self.lock:
            self.total_rx += 1
            self._log("rx", text, "rx")

    def log_tx(self, text):
        with self.lock:
            self.total_tx += 1
            self._log("tx", text, "tx")

    def snapshot(self):
        with self.lock:
            return {
                "connected": self.conn is not None,
                "peer": ("%s:%d" % self.peer) if self.peer else None,
                "since": self.connected_since,
                "rx": [{"t": t, "d": d} for t, d in self.rx_lines],
                "tx": [{"t": t, "d": d} for t, d in self.tx_lines],
                "totalRx": self.total_rx,
                "totalTx": self.total_tx,
            }

    # ---------- 发送 ----------
    def send(self, text):
        with self.lock:
            conn = self.conn
            peer = self.peer
        if conn is None:
            return False, "没有 ESP 连接"

        try:
            conn.sendall(text.encode("utf-8"))
        except Exception as e:
            return False, "发送失败: %s" % e

        with self.lock:
            self.total_tx += 1
            self._log("tx", text.rstrip("\r\n"), "tx")
        return True, "已发送 %d 字节" % len(text.encode("utf-8"))

    def clear(self):
        with self.lock:
            self.rx_lines = []
            self.tx_lines = []


STATE = State()


# ============================================================ TCP 服务器（等 ESP 连进来）
def tcp_server(host, port):
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((host, port))
    srv.listen(2)
    print("[TCP] 监听 %s:%d  （ESP 连这里）" % (host, port))

    while True:
        try:
            conn, peer = srv.accept()
        except OSError:
            break

        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        STATE.attach(conn, peer)
        print("[TCP] ESP 已连接: %s:%d" % peer)
        threading.Thread(target=recv_loop, args=(conn,), daemon=True).start()


def recv_loop(conn):
    buf = b""
    while True:
        try:
            data = conn.recv(4096)
        except OSError:
            break
        if not data:
            break

        buf += data

        # 按行切；没换行的部分如果攒够 256 字节也吐出来
        while True:
            if b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                emit(line)
            else:
                break

        if len(buf) > 256:
            emit(buf)
            buf = b""

    if buf:
        emit(buf)

    STATE.detach(conn)
    print("[TCP] ESP 断开")
    try:
        conn.close()
    except Exception:
        pass


def emit(raw):
    """把收到的字节变成可读文本并记录"""
    try:
        text = raw.decode("utf-8", errors="replace")
    except Exception:
        text = repr(raw)

    text = text.replace("\r", "")
    for line in text.split("\n"):
        if line.strip():
            STATE.log_rx(line)


# ============================================================ HTTP 页面
PAGE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ESP-01 通信测试</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
         background:#0f1419; color:#e6e6e6; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 20px 16px 60px; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  .sub { color:#8b949e; font-size: 13px; margin-bottom: 18px; }

  .card { background:#161b22; border:1px solid #21262d; border-radius: 10px;
          padding: 16px; margin-bottom: 16px; }
  .row { display:flex; gap:16px; flex-wrap:wrap; align-items:center; }
  .k { color:#8b949e; font-size:13px; }
  .v { font-family: ui-monospace, Consolas, monospace; font-size:14px; }

  .status { display:flex; align-items:center; gap:10px; font-size:16px; font-weight:600; }
  .dot { width:12px; height:12px; border-radius:50%; background:#d03050;
         box-shadow:0 0 8px #d03050; }
  .dot.on { background:#3fb950; box-shadow:0 0 10px #3fb950; }

  .ipbox { background:#0d1117; border:1px dashed #30363d; border-radius:8px;
           padding:12px 14px; margin-top:12px; }
  .ipbox code { color:#58a6ff; font-size:15px; font-family: ui-monospace, Consolas, monospace; }

  .cols { display:grid; grid-template-columns: 1fr 1fr; gap:16px; }
  @media (max-width: 760px) { .cols { grid-template-columns: 1fr; } }

  .logtitle { display:flex; justify-content:space-between; align-items:center;
              margin-bottom:8px; }
  .logtitle span { font-size:13px; color:#8b949e; }
  .log { height: 300px; overflow-y:auto; background:#0d1117; border-radius:8px;
         padding:10px; font-family: ui-monospace, Consolas, monospace; font-size:12.5px;
         line-height:1.65; }
  .ln { white-space: pre-wrap; word-break: break-all; }
  .ln .t { color:#484f58; margin-right:8px; }
  .rx .ln .d { color:#7ee787; }
  .tx .ln .d { color:#79c0ff; }
  .ln.sys .d { color:#d29922; font-style: italic; }

  input[type=text] { width:100%; padding:11px 13px; border-radius:8px;
                     border:1px solid #30363d; background:#0d1117; color:#e6e6e6;
                     font-size:14px; font-family: ui-monospace, Consolas, monospace; }
  input[type=text]:focus { outline:none; border-color:#388bfd; }
  .btns { display:flex; gap:10px; margin-top:10px; flex-wrap:wrap; }
  button { padding:10px 18px; border-radius:8px; border:1px solid #30363d;
           background:#21262d; color:#e6e6e6; font-size:14px; cursor:pointer; }
  button:hover { background:#30363d; }
  button.primary { background:#238636; border-color:#2ea043; }
  button.primary:hover { background:#2ea043; }
  button.danger { background:#8b2b2b; border-color:#a83232; }

  .hint { font-size:12.5px; color:#8b949e; line-height:1.8; }
  .hint code { color:#58a6ff; }
</style>
</head>
<body>
<div class="wrap">
  <h1>ESP-01 通信测试</h1>
  <div class="sub">电脑这边在跑，ESP-01 连上来就能收发数据</div>

  <div class="card">
    <div class="status">
      <div class="dot" id="dot"></div>
      <div id="stext">等待 ESP-01 连接...</div>
    </div>
    <div class="ipbox">
      <div class="k">ESP-01 那边敲这两条命令连过来：</div>
      <div style="margin-top:8px">
        <code id="cmdmux">AT+CIPMUX=0</code><br>
        <code id="cmdstart">AT+CIPSTART="TCP","---",8080</code>
      </div>
    </div>
    <div class="row" style="margin-top:14px">
      <div><span class="k">连接来源 </span><span class="v" id="peer">-</span></div>
      <div><span class="k">连接时间 </span><span class="v" id="since">-</span></div>
      <div><span class="k">收 </span><span class="v" id="trx">0</span></div>
      <div><span class="k">发 </span><span class="v" id="ttx">0</span></div>
    </div>
  </div>

  <div class="cols">
    <div class="card">
      <div class="logtitle"><b>ESP → 电脑</b><span>收到 N 条</span></div>
      <div class="log rx" id="logrx"></div>
    </div>
    <div class="card">
      <div class="logtitle"><b>电脑 → ESP</b><span>发出 N 条</span></div>
      <div class="log tx" id="logtx"></div>
    </div>
  </div>

  <div class="card">
    <div class="k" style="margin-bottom:8px">发给 ESP（回车发送）</div>
    <input type="text" id="txin" placeholder="比如 hello，或者 AT 命令">
    <div class="btns">
      <button class="primary" onclick="doSend()">发送</button>
      <button onclick="sendPreset('hello')">hello</button>
      <button onclick="sendPreset('AT+GMR\\r\\n')">AT+GMR</button>
      <button onclick="sendPreset('AT+CIFSR\\r\\n')">AT+CIFSR</button>
      <button class="danger" onclick="doClear()">清空日志</button>
    </div>
    <div class="hint" style="margin-top:14px">
      提示：ESP-01 用 AT 固件时，电脑发过去的数据在 ESP 串口会显示成
      <code>+IPD,长度:内容</code>。ESP 发上来的数据这里会实时显示。
    </div>
  </div>
</div>

<script>
let lastRxCount = -1, lastTxCount = -1;

function pad(n){ return n<10 ? '0'+n : ''+n; }

async function poll(){
  try {
    const r = await fetch('/api/status?t=' + Date.now());
    const d = await r.json();
    render(d);
  } catch(e) {}
}

function render(d){
  const dot = document.getElementById('dot');
  const st  = document.getElementById('stext');
  if (d.connected){
    dot.classList.add('on');
    st.textContent = '已连接';
  } else {
    dot.classList.remove('on');
    st.textContent = '等待 ESP-01 连接...';
  }
  document.getElementById('peer').textContent  = d.peer || '-';
  document.getElementById('since').textContent = d.since || '-';
  document.getElementById('trx').textContent   = d.totalRx;
  document.getElementById('ttx').textContent   = d.totalTx;

  if (d.rx.length !== lastRxCount){
    lastRxCount = d.rx.length;
    const box = document.getElementById('logrx');
    box.innerHTML = d.rx.map(x=>
      '<div class="ln '+(x.d.indexOf('ESP')>=0 && x.d.indexOf('已连接')>=0 ? 'sys':'')+'">'
      + '<span class="t">'+x.t+'</span><span class="d">'+esc(x.d)+'</span></div>').join('');
    box.scrollTop = box.scrollHeight;
  }
  if (d.tx.length !== lastTxCount){
    lastTxCount = d.tx.length;
    const box = document.getElementById('logtx');
    box.innerHTML = d.tx.map(x=>
      '<div class="ln"><span class="t">'+x.t+'</span><span class="d">'+esc(x.d)+'</span></div>').join('');
    box.scrollTop = box.scrollHeight;
  }
}

function esc(s){
  return String(s).replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
}

async function doSend(){
  const inp = document.getElementById('txin');
  const text = inp.value;
  if (!text) return;
  await fetch('/api/send', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({data: text})
  });
  inp.value = '';
  poll();
}

async function sendPreset(s){
  await fetch('/api/send', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({data: s})
  });
  poll();
}

async function doClear(){
  await fetch('/api/clear', {method:'POST'});
  lastRxCount = -1; lastTxCount = -1;
  poll();
}

document.getElementById('txin').addEventListener('keydown', e=>{
  if (e.key === 'Enter') doSend();
});

async function initInfo(){
  try {
    const r = await fetch('/api/info');
    const d = await r.json();
    document.getElementById('cmdmux').textContent = 'AT+CIPMUX=0';
    document.getElementById('cmdstart').textContent =
      'AT+CIPSTART="TCP","' + d.ip + '",' + d.tcpPort;
  } catch(e){}
}

initInfo();
poll();
setInterval(poll, 600);
</script>
</body>
</html>
"""


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


class Handler(BaseHTTPRequestHandler):
    tcp_port = 8080

    def log_message(self, fmt, *args):
        return   # 静音，避免刷屏

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/" or path == "/index.html":
            body = PAGE.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/api/status":
            self._json(STATE.snapshot())
        elif path == "/api/info":
            self._json({"ip": local_ip(), "tcpPort": Handler.tcp_port})
        else:
            self.send_error(404)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            n = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(n) if n else b""
            data = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            data = {}

        if path == "/api/send":
            text = data.get("data", "")
            ok, msg = STATE.send(text)
            self._json({"ok": ok, "msg": msg})
        elif path == "/api/clear":
            STATE.clear()
            self._json({"ok": True})
        else:
            self.send_error(404)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tcp", type=int, default=8080, help="ESP 连接的 TCP 端口")
    ap.add_argument("--http", type=int, default=8000, help="浏览器访问的端口")
    args = ap.parse_args()

    Handler.tcp_port = args.tcp

    t = threading.Thread(target=tcp_server, args=("0.0.0.0", args.tcp), daemon=True)
    t.start()

    ip = local_ip()
    print()
    print("=" * 62)
    print("  ESP-01 通信测试工具")
    print("=" * 62)
    print("  浏览器打开:  http://localhost:%d" % args.http)
    print()
    print("  ESP-01 连这里: %s:%d" % (ip, args.tcp))
    print()
    print("  ESP 串口敲:")
    print('      AT+CIPMUX=0')
    print('      AT+CIPSTART="TCP","%s",%d' % (ip, args.tcp))
    print("=" * 62)
    print()
    print("  按 Ctrl+C 退出")
    print()

    httpd = ThreadingHTTPServer(("0.0.0.0", args.http), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已退出")
        httpd.server_close()


if __name__ == "__main__":
    main()
