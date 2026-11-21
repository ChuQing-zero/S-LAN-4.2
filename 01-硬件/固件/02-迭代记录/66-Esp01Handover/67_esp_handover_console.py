# -*- coding: utf-8 -*-
"""
67 · ESP-01 两阶段交接 —— 电脑端网页控制台

配合 66-Esp01Handover.ino 使用。

流程：
    阶段①  电脑当客户端，主动连 ESP（192.168.1.100:8080）
            连上后发一行  MYIP:<本机IP>:9000
            ESP 收到会回 OK:GOT_IT

    阶段②  电脑立刻切成服务器，在 9000 端口等 ESP 来连
            ESP 主动连过来 -> 双方开始正常收发

好处：固件里不用写死电脑 IP，电脑换 IP 也不用重烧 ESP。

启动：
    python 67_esp_handover_console.py
    python 67_esp_handover_console.py --esp 192.168.1.100 --esp-port 8080 --my-port 9000

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
        self.phase = "init"          # init / phase1 / wait_esp / phase2 / error
        self.phase_text = "初始化"
        self.connected = False
        self.peer = None
        self.since = None
        self.rx = []
        self.tx = []
        self.total_rx = 0
        self.total_tx = 0
        self.esp_ip = ""
        self.esp_port = 0
        self.my_ip = ""
        self.my_port = 0
        self.err = ""
        self.max_lines = 400

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

    def set_phase(self, ph, text):
        with self.lock:
            self.phase = ph
            self.phase_text = text
            self._add(self.rx, "=== %s ===" % text)

    def set_connected(self, ok, peer=None):
        with self.lock:
            self.connected = ok
            self.peer = peer
            self.since = datetime.now().strftime("%H:%M:%S") if ok else None
            if ok:
                self._add(self.rx, "=== 与 ESP 建立通信链路 ===")
            else:
                self._add(self.rx, "=== 链路断开 ===")

    def snapshot(self):
        with self.lock:
            return {
                "phase": self.phase,
                "phaseText": self.phase_text,
                "connected": self.connected,
                "peer": self.peer,
                "since": self.since,
                "rx": [{"t": t, "d": d} for t, d in self.rx],
                "tx": [{"t": t, "d": d} for t, d in self.tx],
                "totalRx": self.total_rx,
                "totalTx": self.total_tx,
                "esp": "%s:%d" % (self.esp_ip, self.esp_port),
                "me": "%s:%d" % (self.my_ip, self.my_port),
                "err": self.err,
            }

    def clear(self):
        with self.lock:
            self.rx = []
            self.tx = []


STATE = State()
SEND_LOCK = threading.Lock()
CUR_SOCK = {"s": None}


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


# ============================================================ 通信主循环
def orchestrator(esp_ip, esp_port, my_port):
    """两阶段循环：①去连 ESP 报地址 -> ②开服务器等 ESP 连回来"""
    me = local_ip()
    with STATE.lock:
        STATE.esp_ip = esp_ip
        STATE.esp_port = esp_port
        STATE.my_ip = me
        STATE.my_port = my_port

    while True:
        # ========== 阶段①：当客户端连 ESP ==========
        STATE.set_phase("phase1", "阶段① 正在连接 ESP %s:%d" % (esp_ip, esp_port))
        print("[阶段①] 连接 ESP %s:%d ..." % (esp_ip, esp_port))

        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(4)
        try:
            s.connect((esp_ip, esp_port))
        except Exception as e:
            STATE.err = str(e)
            print("[阶段①] 连不上 ESP: %s" % e)
            try:
                s.close()
            except Exception:
                pass
            time.sleep(3)
            continue

        STATE.err = ""
        s.settimeout(3)
        print("[阶段①] 已连上 ESP")

        # 读掉 ESP 的问候语（OK:WAITING_MYIP），最多等 1 秒
        try:
            s.settimeout(1.0)
            greet = s.recv(256)
            if greet:
                txt = greet.decode("utf-8", errors="replace").replace("\r", "")
                for ln in txt.split("\n"):
                    if ln.strip():
                        STATE.log_rx(ln)
        except Exception:
            pass

        # 发自己的地址
        line = "MYIP:%s:%d\n" % (me, my_port)
        try:
            s.sendall(line.encode("utf-8"))
            STATE.log_tx(line.rstrip("\n"))
            print("[阶段①] 已发送 %s" % line.strip())
        except Exception as e:
            print("[阶段①] 发送失败: %s" % e)
            try:
                s.close()
            except Exception:
                pass
            time.sleep(2)
            continue

        # 等 ESP 的 ACK
        got_ack = False
        deadline = time.time() + 6.0          # 最多等 6 秒 ACK
        try:
            s.settimeout(1.5)
            while time.time() < deadline:
                data = s.recv(512)
                if not data:
                    break
                txt = data.decode("utf-8", errors="replace").replace("\r", "")
                for ln in txt.split("\n"):
                    if ln.strip():
                        STATE.log_rx(ln)
                        if "GOT_IT" in ln:
                            got_ack = True
                if got_ack:
                    break
        except Exception as e:
            print("[阶段①] 等 ACK: %s" % e)

        try:
            s.close()
        except Exception:
            pass

        if not got_ack:
            print("[阶段①] 没收到 GOT_IT，2 秒后重试")
            time.sleep(2)
            continue

        print("[阶段①] 收到 GOT_IT —— ESP 开始连回来")
        time.sleep(1.0)                        # 给 ESP 时间关服务器/切模式

        # ========== 阶段②：当服务器等 ESP 连回来 ==========
        STATE.set_phase("wait_esp", "阶段② 等待 ESP 连回来 (%s:%d)" % (me, my_port))
        print("[阶段②] 监听 %s:%d 等 ESP ..." % (me, my_port))

        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            srv.bind(("0.0.0.0", my_port))
        except Exception as e:
            STATE.err = "端口 %d 绑定失败: %s" % (my_port, e)
            print("[阶段②] %s" % STATE.err)
            time.sleep(3)
            continue

        srv.listen(1)
        srv.settimeout(45)          # 等 45 秒等不到就回阶段①

        conn = None
        try:
            conn, peer = srv.accept()
            print("[阶段②] ESP 连回来了: %s:%d" % peer)
            conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            conn.settimeout(None)

            STATE.set_connected(True, "%s:%d" % peer)
            STATE.set_phase("phase2", "阶段② 已建立通信")
            with SEND_LOCK:
                CUR_SOCK["s"] = conn

            recv_loop(conn)

        except socket.timeout:
            print("[阶段②] 等不到 ESP 连接，回到阶段①")
            STATE.err = "等 ESP 连回来超时"
        except Exception as e:
            print("[阶段②] 异常: %s" % e)
            STATE.err = str(e)
        finally:
            with SEND_LOCK:
                CUR_SOCK["s"] = None
            STATE.set_connected(False)
            try:
                if conn is not None:
                    conn.close()
            except Exception:
                pass
            try:
                srv.close()
            except Exception:
                pass

        STATE.set_phase("phase1", "链路断开，重新从阶段①开始")
        time.sleep(2)


def recv_loop(conn):
    buf = b""
    while True:
        try:
            data = conn.recv(4096)
        except Exception as e:
            print("[通信] 接收异常: %s" % e)
            return
        if not data:
            return

        buf += data
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            emit(line)
        if len(buf) > 512:
            emit(buf)
            buf = b""

    if buf:
        emit(buf)


def emit(raw):
    try:
        txt = raw.decode("utf-8", errors="replace")
    except Exception:
        txt = repr(raw)
    txt = txt.replace("\r", "")
    for ln in txt.split("\n"):
        if ln.strip():
            STATE.log_rx(ln)


def do_send(text):
    s = CUR_SOCK.get("s")
    if s is None:
        return False, "目前没有活动链路（还没到阶段②）"
    with SEND_LOCK:
        try:
            s.sendall(text.encode("utf-8"))
        except Exception as e:
            return False, "发送失败: %s" % e
    STATE.log_tx(text.rstrip("\r\n"))
    return True, "OK"

PAGE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ESP-01 两阶段交接</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
       background:#0f1419;color:#e6e6e6}
  .wrap{max-width:1000px;margin:0 auto;padding:20px 16px 60px}
  h1{font-size:21px;margin:0 0 6px}
  .sub{color:#8b949e;font-size:13px;margin-bottom:18px}
  .card{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:16px;margin-bottom:16px}
  .row{display:flex;gap:18px;flex-wrap:wrap;align-items:center}
  .k{color:#8b949e;font-size:13px}
  .v{font-family:ui-monospace,Consolas,monospace;font-size:13.5px}
  .phase{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:600}
  .dot{width:12px;height:12px;border-radius:50%;background:#d03050;box-shadow:0 0 8px #d03050;flex:none}
  .dot.p1{background:#d29922;box-shadow:0 0 10px #d29922}
  .dot.p2{background:#3fb950;box-shadow:0 0 10px #3fb950}
  .steps{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}
  .step{flex:1;min-width:140px;padding:10px 12px;border-radius:8px;background:#0d1117;
        border:1px solid #21262d;font-size:12.5px;color:#8b949e}
  .step.act{border-color:#388bfd;color:#e6e6e6;background:#161b22}
  .step b{display:block;font-size:13px;margin-bottom:4px}
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
  .err{color:#f85149;font-size:12.5px;margin-top:8px}
  .hint{font-size:12.5px;color:#8b949e;line-height:1.8;margin-top:12px}
  .hint code{color:#58a6ff}
</style>
</head>
<body>
<div class="wrap">
  <h1>ESP-01 两阶段交接</h1>
  <div class="sub">阶段①电脑连 ESP 报地址 &rarr; 阶段②电脑当服务器等 ESP 连回来</div>

  <div class="card">
    <div class="phase">
      <div class="dot" id="dot"></div>
      <div id="ptext">初始化...</div>
    </div>

    <div class="steps">
      <div class="step" id="s1"><b>阶段 ①</b>电脑当客户端，连 ESP 报地址</div>
      <div class="step" id="s2"><b>阶段 ②</b>电脑当服务器，等 ESP 连回来</div>
      <div class="step" id="s3"><b>通信中</b>双向收发</div>
    </div>

    <div class="row" style="margin-top:16px">
      <div><span class="k">ESP </span><span class="v" id="esp">-</span></div>
      <div><span class="k">本机 </span><span class="v" id="me">-</span></div>
      <div><span class="k">对端 </span><span class="v" id="peer">-</span></div>
      <div><span class="k">收 </span><span class="v" id="trx">0</span></div>
      <div><span class="k">发 </span><span class="v" id="ttx">0</span></div>
    </div>
    <div class="err" id="err"></div>
  </div>

  <div class="cols">
    <div class="card">
      <div class="logtitle"><b>ESP &rarr; 电脑</b><span id="rc">0 条</span></div>
      <div class="log rx" id="logrx"></div>
    </div>
    <div class="card">
      <div class="logtitle"><b>电脑 &rarr; ESP</b><span id="tc">0 条</span></div>
      <div class="log tx" id="logtx"></div>
    </div>
  </div>

  <div class="card">
    <div class="k" style="margin-bottom:8px">发给 ESP（回车发送）</div>
    <input type="text" id="txin" placeholder="hello / PING">
    <div class="btns">
      <button class="primary" onclick="doSend()">发送</button>
      <button onclick="preset('hello\n')">hello</button>
      <button onclick="preset('PING\n')">PING</button>
      <button class="danger" onclick="doClear()">清空日志</button>
    </div>
    <div class="hint">
      阶段① 自动完成（连 ESP 并发 <code>MYIP:本机IP:端口</code>）。<br>
      收到 ESP 的 <code>OK:GOT_IT</code> 后进入阶段②，在 9000 端口等 ESP 连回来。<br>
      只有进入阶段② 之后，下方发送框才可用。
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
  const pt  = document.getElementById('ptext');
  dot.className = 'dot';
  if (d.phase === 'phase2') dot.classList.add('p2');
  else if (d.phase === 'phase1' || d.phase === 'wait_esp') dot.classList.add('p1');

  pt.textContent = d.phaseText || '-';

  document.getElementById('s1').classList.toggle('act', d.phase === 'phase1');
  document.getElementById('s2').classList.toggle('act', d.phase === 'wait_esp');
  document.getElementById('s3').classList.toggle('act', d.phase === 'phase2');

  document.getElementById('esp').textContent  = d.esp || '-';
  document.getElementById('me').textContent   = d.me || '-';
  document.getElementById('peer').textContent = d.peer || '-';
  document.getElementById('trx').textContent  = d.totalRx;
  document.getElementById('ttx').textContent  = d.totalTx;
  document.getElementById('err').textContent  = d.err || '';
  document.getElementById('rc').textContent   = d.rx.length + ' 条';
  document.getElementById('tc').textContent   = d.tx.length + ' 条';

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

document.getElementById('txin').addEventListener('keydown', e=>{ if (e.key==='Enter') doSend(); });

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
    ap.add_argument("--esp", default="192.168.1.100", help="ESP 引导阶段的 IP")
    ap.add_argument("--esp-port", type=int, default=8080, help="ESP 引导端口")
    ap.add_argument("--my-port", type=int, default=9000, help="电脑进入阶段②后监听的端口")
    ap.add_argument("--http", type=int, default=8000, help="网页端口")
    args = ap.parse_args()

    print()
    print("=" * 64)
    print("  ESP-01 两阶段交接 · 控制台")
    print("=" * 64)
    print("  浏览器  :  http://localhost:%d" % args.http)
    print("  阶段①连 :  %s:%d   (ESP 服务器)" % (args.esp, args.esp_port))
    print("  阶段②听 :  %s:%d   (电脑服务器)" % (local_ip(), args.my_port))
    print("=" * 64)
    print()

    threading.Thread(target=orchestrator,
                     args=(args.esp, args.esp_port, args.my_port),
                     daemon=True).start()

    httpd = ThreadingHTTPServer(("0.0.0.0", args.http), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已退出")
        httpd.server_close()


if __name__ == "__main__":
    main()
