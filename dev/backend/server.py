"""Disposable local VOLK Cloud boundary fixture.

This is intentionally not production backend code. The future private
VOLK-Cloud repository owns identity, persistence, Agent policy, secrets, and
scalable execution.
"""

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ALLOWED_ORIGINS = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
}


class HealthHandler(BaseHTTPRequestHandler):
    server_version = "VOLKDevBackend/0"

    def _write_json(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        origin = self.headers.get("Origin")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):  # noqa: N802 - stdlib handler API
        origin = self.headers.get("Origin")
        if origin not in ALLOWED_ORIGINS:
            self._write_json(403, {"status": "forbidden"})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept, Content-Type")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self):  # noqa: N802 - stdlib handler API
        if urlsplit(self.path).path == "/health":
            self._write_json(200, {
                "status": "ok",
                "service": "volk-dev-backend",
                "apiVersion": "0",
            })
            return
        self._write_json(404, {"status": "not-found"})

    def log_message(self, format_string, *args):
        print("[volk-dev-backend] " + format_string % args)


def main():
    parser = argparse.ArgumentParser(description="Disposable VOLK local backend fixture")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), HealthHandler)
    print(f"VOLK development backend listening at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
