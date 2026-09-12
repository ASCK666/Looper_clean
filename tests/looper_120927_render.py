"""Capture the 120927 migration at reviewable desktop/mobile sizes."""
from pathlib import Path
import contextlib, http.server, os, socketserver, threading
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print('SKIP: playwright is not installed')
    raise SystemExit(0)

ROOT=Path(__file__).resolve().parents[1]
ARTIFACTS=ROOT/'test-artifacts'
ARTIFACTS.mkdir(exist_ok=True)

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_args): pass

with contextlib.ExitStack() as stack:
    server=socketserver.TCPServer(('127.0.0.1',0),lambda *a,**kw:QuietHandler(*a,directory=str(ROOT),**kw))
    stack.callback(server.server_close)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    stack.callback(server.shutdown)
    with sync_playwright() as p, contextlib.ExitStack() as browser_stack:
        browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
        browser_stack.callback(browser.close)
        for width,height,label in [(1440,1100,'desktop'),(390,900,'mobile')]:
            page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
            errors=[]
            page.on('pageerror',lambda err:errors.append(str(err)))
            page.goto(f'http://127.0.0.1:{server.server_address[1]}/index.html',wait_until='networkidle')
            page.wait_for_function('window.__SP?.ready === true')
            page.wait_for_function('window.__SP?.ui120927Ready === true')
            page.wait_for_function('window.__SP?.ui120927CssReady === true')
            page.wait_for_function("[...document.querySelectorAll('.cassetteMechanism img')].every(i=>i.complete && i.naturalWidth>0)")
            assert page.locator('.looper66Skin').evaluate("el=>getComputedStyle(el).display==='none'")
            assert page.locator('#deckVolume').count()==1
            assert page.locator('#crate120927Filters').count()==1
            assert page.locator('#beat120927List').count()==1
            assert page.locator('#autoLooperToggle .deckRateVisualSegments i').count()==5
            assert not errors,errors
            page.locator('#looper').screenshot(path=str(ARTIFACTS/f'120927-{label}.png'))
            page.close()
print('OK: 120927 deck render captured at desktop and mobile')
