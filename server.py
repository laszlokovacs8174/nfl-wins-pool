#!/usr/bin/env python3
"""
Tiny local server for the NFL Wins Pool page.

- Serves the static files (index.html, app.js, styles.css, teams.json).
- Proxies requests to  /espn/...  ->  https://site.api.espn.com/...
  This sidesteps the browser CORS block on ESPN's endpoints.

Usage:
    python3 server.py            # http://localhost:8000
    python3 server.py 9000       # custom port
"""

import http.server
import socketserver
import sys
import urllib.request
import urllib.error

ESPN_BASE = "https://site.api.espn.com"
PROXY_PREFIX = "/espn/"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith(PROXY_PREFIX):
            self.proxy()
        else:
            super().do_GET()

    def proxy(self):
        target = ESPN_BASE + self.path[len(PROXY_PREFIX) - 1:]
        req = urllib.request.Request(target, headers={"User-Agent": "wins-pool/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = resp.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b'{"error":"upstream"}')
        except Exception as e:  # noqa: BLE001
            self.send_response(502)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(str(e).encode())

    def log_message(self, *args):
        pass  # quiet


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    with ReusableTCPServer(("", PORT), Handler) as httpd:
        print(f"Serving on http://localhost:{PORT}  (Ctrl+C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
