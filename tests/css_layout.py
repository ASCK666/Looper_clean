from pathlib import Path
import contextlib, http.server, os, socketserver, sys, threading

try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIP: playwright is not installed')
    sys.exit(0)

ROOT=Path(__file__).resolve().parents[1]

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_args): pass

with contextlib.ExitStack() as stack:
    handler=lambda *a,**kw: QuietHandler(*a,directory=str(ROOT),**kw)
    server=socketserver.TCPServer(('127.0.0.1',0),handler)
    stack.callback(server.server_close)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    stack.callback(server.shutdown)

    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
        for width,height in [(1440,1100),(820,1000),(520,900),(375,812)]:
            page=browser.new_page(viewport={'width':width,'height':height})
            errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(f'http://127.0.0.1:{server.server_address[1]}/index.html',wait_until='networkidle',timeout=30000)
            page.wait_for_function('window.__SP?.ready === true',timeout=10000)
            metrics=page.evaluate('''() => {
              const rect=id=>document.getElementById(id).getBoundingClientRect();
              const mechanism=document.querySelector('.cassetteMechanism').getBoundingClientRect();
              const controls=['prevBeat','playBeat','stopBeat','nextBeat','autoLooperToggle','deckAutoToggle','deckPitch','importBeatsBtn','importFolderBtn'].map(id=>({id,...rect(id).toJSON()}));
              return {bodyW:document.body.scrollWidth,viewportW:innerWidth,mechanism:mechanism.toJSON(),controls,workspace:getComputedStyle(document.querySelector('.looper66Workspace')).gridTemplateColumns};
            }''')
            assert metrics['bodyW']<=metrics['viewportW']+2,metrics
            assert abs(metrics['mechanism']['width']/metrics['mechanism']['height']-1422/804)<.03,metrics
            assert all(c['width']>=44 and c['height']>=44 for c in metrics['controls']),metrics
            if width>=1080:
                transport=[c for c in metrics['controls'] if c['id'] in ('playBeat','stopBeat','autoLooperToggle')]
                assert len({(round(c['width']),round(c['height'])) for c in transport})==1,transport
            assert len(metrics['workspace'].split())==1,metrics
            page.click('[data-tab="chopper"]'); page.wait_for_timeout(60)
            page.click('[data-tab="looper"]'); page.wait_for_timeout(60)
            assert page.locator('#looper.active .cassetteMechanism').count()==1
            assert not errors,errors
            page.close()
        browser.close()

print('OK: Looper66 v2 deck, cassette aspect ratio and 44px controls adapt across desktop/mobile')
