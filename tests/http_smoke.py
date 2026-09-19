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

    for asset,mime,min_size in (
        ("/assets/looper-ui/120927/rear-cables.webp","image/webp",10_000),
        ("/assets/looper-ui/120927/deck-shell.webp","image/webp",100_000),
        ("/assets/looper-ui/120927/readout-panel.webp","image/webp",20_000),
        ("/assets/looper-ui/120927/utility-panel.webp","image/webp",20_000),
        ("/assets/looper-ui/120927/pitch-panel.webp","image/webp",20_000),
        ("/assets/looper-ui/120927/reader-mechanism.webp","image/webp",5_000),
        ("/assets/looper-ui/120927/cassette.webp","image/webp",5_000),
        ("/assets/looper-ui/120927/reel-animation.webp","image/webp",1_000),
        ("/assets/looper-ui/120927/mockup-reference.png","image/png",100_000),
    ):
        with urlopen(Request(base_url + asset, method="HEAD"), timeout=5) as response:
            assert response.status == 200
            assert response.headers.get_content_type() == mime
            assert int(response.headers["Content-Length"]) > min_size
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)

print("OK: deployable folder serves the runtime CSS manifest, JS, manifest and production assets locally")
