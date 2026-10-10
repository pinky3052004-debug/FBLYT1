"""Static server for the game + tiny state API (round/winners handoff between VMs)."""
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
os.chdir(ROOT)

STATE_FILE = os.path.join(ROOT, "state.json")


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, obj):
        data = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/api/state"):
            try:
                self._json(json.load(open(STATE_FILE, encoding="utf-8")))
            except Exception:
                self._json({})
        else:
            super().do_GET()

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        try:
            data = json.loads(body or b"{}")
        except Exception:
            data = {}
        if self.path.startswith("/api/state"):
            json.dump(data, open(STATE_FILE, "w", encoding="utf-8"))
        self._json({"ok": True})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    print(f"http://localhost:{port}/index.html?speed=2", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
