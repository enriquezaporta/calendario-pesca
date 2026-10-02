#!/usr/bin/env python3
"""Entorno de desarrollo en un comando, sin instalar nada:

    python3 tools/dev.py            ->  http://localhost:8080

Arranca el backend con una base de datos en .dev/ y un servidor que sirve app/ con las mismas cabeceras de
seguridad que deploy/Caddyfile (incluida la CSP), y pasa /api/* al backend como haría Caddy.
"""
import argparse
import http.server
import os
import re
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app")


def caddy_headers():
    """Lee las cabeceras del bloque `header { ... }` del Caddyfile para usar exactamente las mismas."""
    text = open(os.path.join(ROOT, "deploy", "Caddyfile"), encoding="utf-8").read()
    block = re.search(r"\n\theader \{\n(.*?)\n\t\}", text, re.S).group(1)
    out = []
    for line in block.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        name, value = line.split(" ", 1)
        out.append((name, value.strip().strip('"')))
    return out


HEADERS = caddy_headers()


def make_handler(api_port):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=APP, **k)

        def end_headers(self):
            for name, value in HEADERS:
                if name != "Strict-Transport-Security":  # en local no hay HTTPS
                    self.send_header(name, value)
            if self.path.split("?")[0] in ("/", "/index.html", "/sw.js", "/manifest.json"):
                self.send_header("Cache-Control", "no-cache")
            super().end_headers()

        def _proxy(self, method):
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else None
            headers = {k: v for k, v in self.headers.items() if k in ("Content-Type", "Authorization")}
            headers["X-Real-IP"] = self.client_address[0]
            req = urllib.request.Request(f"http://127.0.0.1:{api_port}{self.path}", data=body, method=method, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    code, data, rh = r.status, r.read(), r.headers
            except urllib.error.HTTPError as e:
                code, data, rh = e.code, e.read(), e.headers
            except OSError:
                code, data, rh = 502, b'{"error": "Backend no disponible"}', {}
            self.send_response(code)
            for k in ("Content-Type", "Content-Disposition", "Cache-Control"):
                if rh.get(k):
                    self.send_header(k, rh.get(k))
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path.startswith("/api/"):
                return self._proxy("GET")
            super().do_GET()

        def do_POST(self):
            if self.path.startswith("/api/"):
                return self._proxy("POST")
            self.send_error(405)

        def log_message(self, fmt, *args):
            pass

    return Handler


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--api-port", type=int, default=8000)
    ap.add_argument("--db", default=os.path.join(ROOT, ".dev", "pesca.db"))
    ap.add_argument("--fast-hash", action="store_true", help="contraseñas con pocas iteraciones (solo pruebas)")
    args = ap.parse_args()

    env = dict(os.environ, PESCA_DB=args.db, PESCA_PORT=str(args.api_port),
               PESCA_OPERATOR_NAME=os.environ.get("PESCA_OPERATOR_NAME", "Entorno de desarrollo"),
               PESCA_OPERATOR_CONTACT=os.environ.get("PESCA_OPERATOR_CONTACT", "dev@localhost"))
    backend = os.path.join(ROOT, "backend", "server.py")
    cmd = [sys.executable, backend]
    if args.fast_hash:
        cmd = [sys.executable, "-c",
               "import sys; sys.path.insert(0, %r); import server; server.PBKDF2_ITER = 1000; server.init_db(); "
               "server.Server((server.HOST, server.PORT), server.Handler).serve_forever()" % os.path.dirname(backend)]
    api = subprocess.Popen(cmd, env=env)
    # Al recibir SIGTERM se sale por el finally y se para también el backend.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    time.sleep(0.8)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(args.api_port))
    print(f"Calendario de Pesca en http://localhost:{args.port}  (Ctrl+C para salir)", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        api.terminate()
        api.wait(timeout=5)


if __name__ == "__main__":
    main()
