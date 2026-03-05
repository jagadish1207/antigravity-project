#!/usr/bin/env python3
"""
StockLens local proxy server.
Serves static files AND acts as a Yahoo Finance / Google News proxy.
Usage: python3 proxy.py
Then open http://localhost:8080
"""

import http.server
import urllib.request
import urllib.parse
import json
import os
import sys

PORT = 8080
STATIC_ROOT = os.path.dirname(os.path.abspath(__file__))

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://finance.yahoo.com/',
    'Origin': 'https://finance.yahoo.com',
}

class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_ROOT, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        # /proxy/yf?symbol=RELIANCE.NS  → Yahoo Finance chart API
        if parsed.path == '/proxy/yf':
            params = urllib.parse.parse_qs(parsed.query)
            symbol = params.get('symbol', [''])[0]
            if not symbol:
                self._send_json_error(400, 'Missing symbol')
                return
            self._fetch_and_forward(
                f'https://query2.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?interval=1d&range=2d'
            )

        # /proxy/yfsearch?q=RELI  → Yahoo Finance search
        elif parsed.path == '/proxy/yfsearch':
            params = urllib.parse.parse_qs(parsed.query)
            q = params.get('q', [''])[0]
            if not q:
                self._send_json_error(400, 'Missing q')
                return
            self._fetch_and_forward(
                f'https://query1.finance.yahoo.com/v1/finance/search?q={urllib.parse.quote(q)}&newsCount=0&enableFuzzyQuery=false&enableCb=false'
            )

        # /proxy/news?q=RELIANCE+NSE  → Google News RSS
        elif parsed.path == '/proxy/news':
            params = urllib.parse.parse_qs(parsed.query)
            q = params.get('q', ['Indian Stock Market'])[0]
            self._fetch_and_forward(
                f'https://news.google.com/rss/search?q={urllib.parse.quote(q)}&hl=en-IN&gl=IN&ceid=IN:en',
                content_type='application/rss+xml; charset=utf-8',
                as_text=True
            )

        else:
            # Serve static files normally
            super().do_GET()

    def _fetch_and_forward(self, url, content_type='application/json; charset=utf-8', as_text=False):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = resp.read()
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self._send_json_error(502, str(e))

    def _send_json_error(self, code, msg):
        body = json.dumps({'error': msg}).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Suppress normal GET logs for proxy requests; show errors only
        if args and str(args[1]) not in ('200', '304'):
            super().log_message(format, *args)


if __name__ == '__main__':
    os.chdir(STATIC_ROOT)
    with http.server.ThreadingHTTPServer(('', PORT), ProxyHandler) as httpd:
        print(f'StockLens proxy running at http://localhost:{PORT}')
        print(f'Press Ctrl+C to stop.')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nProxy stopped.')
