#!/usr/bin/env python3
"""Serve the deployable folder and verify its critical static responses."""

from functools import partial
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class StylesheetCollector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "link":
            return
        values = dict(attrs)
        rel = values.get("rel", "").lower().split()
        href = values.get("href")
        if href and "stylesheet" in rel:
            self.hrefs.append(href)


handler = partial(QuietHandler, directory=str(ROOT))
server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
thread = Thread(target=server.serve_forever, daemon=True)
thread.start()

base_url = f"http://127.0.0.1:{server.server_port}"
try:
    expected = {
        "/index.html": ("text/html", b"Scratch Practice"),
        "/js/events.js": ("javascript", b"addEventListener"),
        "/manifest.json": ("application/json", b"Local pixel-art Looper"),
    }
    index_body = None
    for path, (mime, marker) in expected.items():
        with urlopen(base_url + path, timeout=5) as response:
            body = response.read()
            assert response.status == 200, (path, response.status)
            assert mime in response.headers.get_content_type(), (
                path,
                response.headers.get_content_type(),
            )
            assert marker in body, (path, marker)
            if path == "/index.html":
                index_body = body

    collector = StylesheetCollector()
    collector.feed(index_body.decode("utf-8"))
    assert collector.hrefs, "index.html must declare at least one runtime stylesheet"
    for href in collector.hrefs:
        parsed = urlsplit(href)
        assert not parsed.scheme and not parsed.netloc, (
            "Runtime stylesheet must stay local",
            href,
        )
        path = "/" + parsed.path.lstrip("./")
        with urlopen(base_url + path, timeout=5) as response:
            assert response.status == 200, (path, response.status)
            assert response.headers.get_content_type() == "text/css", (
                path,
                response.headers.get_content_type(),
            )
            assert response.read().strip(), (path, "empty stylesheet")

    deck = "/assets/looper-ui/looper66-desktop-pitch-clean-1e6d4f36.webp"
    with urlopen(Request(base_url + deck, method="HEAD"), timeout=5) as response:
        assert response.status == 200
        assert response.headers.get_content_type() == "image/webp"
        assert int(response.headers["Content-Length"]) > 80_000
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)

print("OK: deployable folder serves the runtime CSS manifest, JS, manifest and production assets locally")