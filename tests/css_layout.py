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
              return {bodyW:document.body.scrollWidth,viewportW:innerWidth,mechanism:mechanism.toJSON(),controls,transportPanel:document.querySelector('.deckTransportVisual').getBoundingClientRect().toJSON(),pitch:document.querySelector('.deckPitchModule').getBoundingClientRect().toJSON(),workspace:getComputedStyle(document.querySelector('.looper66Workspace')).gridTemplateColumns,playLightSize:getComputedStyle(document.getElementById('playBeat'),'::before').backgroundSize};
            }''')
            assert metrics['bodyW']<=metrics['viewportW']+2,metrics
            expected_mechanism_ratio=1.505 if width<=680 else 1.586
            assert abs(metrics['mechanism']['width']/metrics['mechanism']['height']-expected_mechanism_ratio)<.02,metrics
            assert all(c['width']>=44 and c['height']>=44 for c in metrics['controls']),metrics
            if width>=1080:
                by_id={control['id']:control for control in metrics['controls']}
                stop,play,speed=(by_id[name] for name in ('stopBeat','playBeat','autoLooperToggle'))
                assert abs(stop['width']-speed['width'])<1 and abs(stop['height']-speed['height'])<1,metrics
                assert play['width']>stop['width']*1.5 and play['width']<stop['width']*1.7,metrics
                assert play['height']>stop['height'] and stop['width']/stop['height']<1.3,metrics
                assert abs(stop['x']-metrics['mechanism']['x'])<1,metrics
                assert abs(speed['x']+speed['width']-metrics['mechanism']['x']-metrics['mechanism']['width'])<1,metrics
                assert metrics['transportPanel']['y']+metrics['transportPanel']['height']>metrics['mechanism']['y']+metrics['mechanism']['height']+metrics['transportPanel']['height']*.9,metrics
            if width<=680:
                by_id={control['id']:control for control in metrics['controls']}
                stop,play,speed=(by_id[name] for name in ('stopBeat','playBeat','autoLooperToggle'))
                assert abs(stop['y']-play['y'])<1 and abs(stop['width']-play['width'])<1 and abs(stop['height']-play['height'])<1,metrics
                assert speed['y']>=stop['y']+stop['height'] and speed['width']>=stop['width']+play['width'],metrics
                assert abs(speed['x']-metrics['transportPanel']['x'])<1 and abs(speed['width']-metrics['transportPanel']['width'])<1,metrics
                assert metrics['transportPanel']['y']>=metrics['mechanism']['y']+metrics['mechanism']['height']-1,metrics
                assert metrics['transportPanel']['y']+metrics['transportPanel']['height']<=metrics['pitch']['y']+1,metrics
                assert metrics['playLightSize']=='208.35% 208.35%',metrics
            assert len(metrics['workspace'].split())==1,metrics
            page.click('[data-tab="chopper"]'); page.wait_for_timeout(60)
            page.click('[data-tab="looper"]'); page.wait_for_timeout(60)
            assert page.locator('#looper.active .cassetteMechanism').count()==1
            assert not errors,errors
            page.close()
        browser.close()

print('OK: Looper66 v2 deck, cassette aspect ratio and 44px controls adapt across desktop/mobile')
