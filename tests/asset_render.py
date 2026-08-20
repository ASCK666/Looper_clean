from pathlib import Path
import contextlib, http.server, os, socketserver, sys, threading

try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIP: playwright is not installed')
    raise SystemExit(0)

ROOT=Path(__file__).resolve().parents[1]
ARTIFACTS=ROOT/'test-artifacts'
ARTIFACTS.mkdir(exist_ok=True)

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
        page=browser.new_page(viewport={'width':1536,'height':1200},device_scale_factor=1)
        page_errors=[]; failed=[]
        page.on('pageerror',lambda err:page_errors.append(str(err)))
        page.on('requestfailed',lambda req:failed.append(f'{req.url}: {req.failure}'))
        page.goto(f'http://127.0.0.1:{server.server_address[1]}/index.html',wait_until='networkidle',timeout=30000)
        page.wait_for_function('window.__SP?.ready === true',timeout=10000)
        page.wait_for_function("[...document.querySelectorAll('.cassetteLayer,.cassetteReel')].every(img=>img.complete&&img.naturalWidth)",timeout=10000)

        info=page.evaluate('''() => {
          const ids=['prevBeat','playBeat','stopBeat','nextBeat','autoLooperToggle','deckAutoToggle','deckPitch','importFolderBtn','importBeatsBtn'];
          const rect=id=>document.getElementById(id).getBoundingClientRect().toJSON();
          return {
            appErrors:window.__SP.errors,
            layers:[...document.querySelectorAll('.cassetteMechanism img')].map(img=>[img.className,img.naturalWidth,img.naturalHeight]),
            controls:ids.map(id=>({id,...rect(id),display:getComputedStyle(document.getElementById(id)).display})),
            transport:['playBeat','stopBeat','autoLooperToggle'].map(rect),
            title:document.getElementById('cassetteBeatName').textContent,
            wordmark:document.querySelector('.looper66Wordmark').textContent.trim()
          };
        }''')
        assert len(info['layers'])==7,info
        assert all(layer[1]>0 and layer[2]>0 for layer in info['layers']),info
        assert all(c['display']!='none' and c['width']>=44 and c['height']>=44 for c in info['controls']),info
        sizes={(round(rect['width'],1),round(rect['height'],1)) for rect in info['transport']}
        assert len(sizes)==1,sizes
        assert info['title']=='NO BEAT LOADED' and info['wordmark']=='LOOPER66',info
        assert not info['appErrors'] and not page_errors and not failed,(info['appErrors'],page_errors,failed)

        page.locator('#looper').screenshot(path=str(ARTIFACTS/'looper66-render.png'))
        page.screenshot(path=str(ARTIFACTS/'looper66-full-render.png'),full_page=True)
        browser.close()

print('OK: neutral layered cassette and equal native Looper66 controls render without runtime errors')
