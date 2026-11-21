# -*- coding: utf-8 -*-
"""
81 · ESP-01 长连接控制台（配合 80-SimpleServer.ino）

架构：
    ESP-01 上电后连 WiFi（192.168.1.100），开 8080 服务器并一直开着
    本程序主动连 192.168.1.100:8080，连上后就一直保持
    ESP 不再开开关关服务器，射频状态几乎不变 —— 供电压力最小

用法：
    python 81_esp_server_console.py
    python 81_esp_server_console.py --esp 192.168.1.100 --port 8080

浏览器：http://localhost:8000
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
        self.peer = None
        self.connected = False
        self.since = None
        self.rx = []
        self.tx = []
        self.total_rx = 0
        self.total_tx = 0
        self.err = ""
        self.esp = ""
        self.max_lines = 400
        self.reconnects = 0

    def _add(self, arr, text):
        arr.append((datetime.now().strftime("%H:%M:%S"), text))
        if len(arr) > self.max_lines:
            del arr[:len(arr) - self.max_lines]

    def log_rx(self, t):
        with self.lock:
            self.total_rx += 1
            self._add(self.rx, t)

    def log_tx(self, t):
        with self.lock:
            self.total_tx += 1
            self._add(self.tx, t)

    def set_conn(self, ok, peer=None, err=""):
      try:
        with self.lock:
            self.connected = ok
            if ok:
                self.peer = peer
                self.since = datetime.now().strftime("%H:%M:%S")
                self._add(self.rx, "=== 已连接 ESP %s:%d ===" % peer)
            else:
                self.since = None
                self.err = err
                if err:
                    self._add(self.rx, "=== 断开: %s ===" % err)
      except Exception as e:
        print("[STATE] set_conn error: %r" % e)

    def snapshot(self):
        with self.lock:
            return {
                "connected": self.connected,
                "peer": self.peer,
                "since": self.since,
                "esp": self.esp,
                "rx": [{"t": t, "d": d} for t, d in self.rx],
                "tx": [{"t": t, "d": d} for t, d in self.tx],
                "totalRx": self.total_rx,
                "totalTx": self.total_tx,
                "reconnects": self.reconnects,
                "err": self.err,
            }

    def clear(self):
        with self.lock:
            self.rx = []
            self.tx = []


STATE = State()
SEND_LOCK = threading.Lock()
CUR = {"s": None}


# ============================================================ TCP 长连接
def connector(esp_ip, esp_port):
    STATE.esp = "%s:%d" % (esp_ip, esp_port)
    backoff = 2

    while True:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(4)
        try:
            s.connect((esp_ip, esp_port))
        except Exception as e:
            STATE.set_conn(False, err="连不上 ESP: %s" % e)
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
        with SEND_LOCK:
            CUR["s"] = s
        STATE.set_conn(True, (esp_ip, esp_port))
        print("[TCP] 已连接 ESP %s:%d" % (esp_ip, esp_port))

        # 80 号固件不需要 MYIP，连上即可（减少一次发射）

        recv_loop(s)

        with SEND_LOCK:
            CUR["s"] = None
        STATE.set_conn(False, err="对端关闭")
        STATE.reconnects += 1
        try:
            s.close()
        except Exception:
            pass
        print("[TCP] 断开，2 秒后重连")
        time.sleep(2)


def recv_loop(s):
    buf = b""
    while True:
        try:
            data = s.recv(2048)
        except Exception as e:
            STATE.set_conn(False, err=str(e))
            try:
                s.shutdown(socket.SHUT_RDWR)
            except Exception:
                pass
            return
        if not data:
            return
        buf += data
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            emit(line)
        if len(buf) > 600:
            emit(buf)
            buf = b""

    if buf:
        emit(buf)


def emit(raw):
    try:
        text = raw.decode("utf-8", errors="replace")
    except Exception:
        text = repr(raw)
    text = text.replace("\r", "").strip()
    if text:
        STATE.log_rx(text)


def do_send(text):
    s = CUR.get("s")
    if s is None:
        return False, "当前没有连接"
    with SEND_LOCK:
        try:
            s.sendall(text.encode("utf-8"))
        except Exception as e:
            # ★ 发送失败说明 socket 已死，强制关掉，让 recv_loop 退出并重连
            try:
                s.shutdown(socket.SHUT_RDWR)
            except Exception:
                pass
            try:
                s.close()
            except Exception:
                pass
            CUR["s"] = None
            STATE.set_conn(False, err="发送失败已断开: %s" % e)
            return False, "发送失败（已触发重连）: %s" % e
    STATE.log_tx(text.rstrip("\r\n"))
    return True, "OK"


# ============================================================ 网页
PAGE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ESP-01 长连接控制台</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
       background:#0f1419;color:#e6e6e6}
  .wrap{max-width:980px;margin:0 auto;padding:20px 16px 60px}
  h1{font-size:21px;margin:0 0 6px}
  .sub{color:#8b949e;font-size:13px;margin-bottom:18px}
  .card{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:16px;margin-bottom:16px}
  .row{display:flex;gap:18px;flex-wrap:wrap;align-items:center}
  .k{color:#8b949e;font-size:13px}
  .v{font-family:ui-monospace,Consolas,monospace;font-size:13.5px}
  .status{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:600}
  .dot{width:12px;height:12px;border-radius:50%;background:#d03050;
       box-shadow:0 0 8px #d03050;flex:none}
  .dot.on{background:#3fb950;box-shadow:0 0 10px #3fb950}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  @media(max-width:760px){.cols{grid-template-columns:1fr}}
  .logtitle{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
  .logtitle span{font-size:13px;color:#8b949e}
  .log{height:330px;overflow-y:auto;background:#0d1117;border-radius:8px;padding:10px;
       font-family:ui-monospace,Consolas,monospace;font-size:12.5px;line-height:1.65}
  .ln{white-space:pre-wrap;word-break:break-all}
  .ln .t{color:#484f58;margin-right:8px}
  .rx .ln .d{color:#7ee787}
  .tx .ln .d{color:#79c0ff}
  input[type=text]{width:100%;padding:11px 13px;border-radius:8px;border:1px solid #30363d;
                   background:#0d1117;color:#e6e6e6;font-size:14px;
                   font-family:ui-monospace,Consolas,monospace}
  input[type=text]:focus{outline:none;border-color:#388bfd}
  .btns{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
  button{padding:9px 16px;border-radius:8px;border:1px solid #30363d;background:#21262d;
         color:#e6e6e6;font-size:13.5px;cursor:pointer}
  button:hover{background:#30363d}
  button.primary{background:#238636;border-color:#2ea043}
  button.primary:hover{background:#2ea043}
  button.danger{background:#8b2b2b;border-color:#a83232}
  .err{color:#f85149;font-size:12.5px;margin-top:8px}
  .hint{font-size:12.5px;color:#8b949e;line-height:1.8;margin-top:12px}
  .hint code{color:#58a6ff}
</style>
</head>
<body>
<div class="wrap">
  <h1>ESP-01 长连接控制台</h1>
  <div class="sub">ESP 常开服务器，电脑连上后一直保持 —— 最省电、最稳的通信方式</div>

  <div class="card">
    <div class="status">
      <div class="dot" id="dot"></div>
      <div id="stext">正在连接...</div>
    </div>
    <div class="row" style="margin-top:14px">
      <div><span class="k">ESP </span><span class="v" id="esp">-</span></div>
      <div><span class="k">连接时间 </span><span class="v" id="since">-</span></div>
      <div><span class="k">收 </span><span class="v" id="trx">0</span></div>
      <div><span class="k">发 </span><span class="v" id="ttx">0</span></div>
      <div><span class="k">重连次数 </span><span class="v" id="rc">0</span></div>
    </div>
    <div class="err" id="err"></div>
  </div>

  <div class="cols">
    <div class="card">
      <div class="logtitle"><b>ESP → 电脑</b><span id="rcount">0</span></div>
      <div class="log rx" id="logrx"></div>
    </div>
    <div class="card">
      <div class="logtitle"><b>电脑 → ESP</b><span id="tcount">0</span></div>
      <div class="log tx" id="logtx"></div>
    </div>
  </div>

  <div class="card">
    <div class="k" style="margin-bottom:8px">发给 ESP（回车发送）</div>
    <input type="text" id="txin" placeholder="敲 ? 或 H">
    <div class="btns">
      <button class="primary" onclick="doSend()">发送</button>
      <button onclick="preset('H\n')">H</button>
      <button onclick="preset('?\n')">?</button>
      <button onclick="preset('L,0x10,20\n')">读 0x10</button>
      <button onclick="preset('S,0x20,raise\n')">0x20 抬升</button>
      <button onclick="preset('S,0x20,lower\n')">0x20 下降</button>
      <button class="danger" onclick="doClear()">清空</button>
    </div>
    <div class="hint">
      连接一直保持，断开才重连。ESP 每 60 秒发一次 <code>PING</code>。<br>
      如果长时间「连不上」→ 检查 ESP 是否在线（<code>ping 192.168.1.100</code>）。
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
  const dot = document.getElementById('dot');
  if (d.connected){ dot.classList.add('on'); document.getElementById('stext').textContent = '已连接 ESP'; }
  else { dot.classList.remove('on'); document.getElementById('stext').textContent = '未连接（自动重连中）'; }

  document.getElementById('esp').textContent   = d.esp || '-';
  document.getElementById('since').textContent = d.since || '-';
  document.getElementById('trx').textContent   = d.totalRx;
  document.getElementById('ttx').textContent   = d.totalTx;
  document.getElementById('rc').textContent    = d.reconnects;
  document.getElementById('err').textContent   = d.err || '';
  document.getElementById('rcount').textContent = d.rx.length + ' 条';
  document.getElementById('tcount').textContent = d.tx.length + ' 条';

  if (d.rx.length !== lastRx){
    lastRx = d.rx.length;
    const b = document.getElementById('logrx');
    b.innerHTML = d.rx.map(x=>'<div class="ln"><span class="t">'+x.t+'</span><span class="d">'+esc(x.d)+'</span></div>').join('');
    b.scrollTop = b.scrollHeight;
  }
  if (d.tx.length !== lastTx){
    lastTx = d.tx.length;
    const b = document.getElementById('logtx');
    b.innerHTML = d.tx.map(x=>'<div class="ln"><span class="t">'+x.t+'</span><span class="d">'+esc(x.d)+'</span></div>').join('');
    b.scrollTop = b.scrollHeight;
  }
}

async function doSend(){
  const inp = document.getElementById('txin');
  if (!inp.value) return;
  const r = await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({data: inp.value})});
  const j = await r.json();
  if (!j.ok) alert(j.msg || '发送失败');
  inp.value = '';
  poll();
}

async function preset(s){
  const r = await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({data:s})});
  const j = await r.json();
  if (!j.ok) alert(j.msg || '发送失败');
  poll();
}

async function doClear(){
  await fetch('/api/clear',{method:'POST'});
  lastRx = -1; lastTx = -1; poll();
}

document.getElementById('txin').addEventListener('keydown', e=>{ if(e.key==='Enter') doSend(); });

poll(); setInterval(poll, 600);
</script>
</body>
</html>
"""


class Handler(BaseHTTPRequestHandler):
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
            self._json({"esp": STATE.esp})
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
            ok, msg = do_send(data.get("data", ""))
            self._json({"ok": ok, "msg": msg})
        elif path == "/api/clear":
            STATE.clear()
            self._json({"ok": True})
        else:
            self.send_error(404)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--esp", default="192.168.1.100")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--http", type=int, default=8000)
    args = ap.parse_args()

    print()
    print("=" * 62)
    print("  ESP-01 长连接控制台（配合 80-SimpleServer）")
    print("=" * 62)
    print("  浏览器打开:  http://localhost:%d" % args.http)
    print("  连接目标  :  %s:%d" % (args.esp, args.port))
    print("=" * 62)
    print()

    threading.Thread(target=connector, args=(args.esp, args.port), daemon=True).start()

    httpd = ThreadingHTTPServer(("0.0.0.0", args.http), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已退出")
        httpd.server_close()


if __name__ == "__main__":
    main()
