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
    handler=lambda *a,**kw:QuietHandler(*a,directory=str(ROOT),**kw)
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
            page.wait_for_function('window.__SP?.ui120927Ready === true',timeout=10000)

            metrics=page.evaluate('''() => {
              const r=s=>document.querySelector(s).getBoundingClientRect().toJSON();
              const ids=['playBeat','stopBeat','autoLooperToggle','deckPitch','deckVolume','importBeatsBtn','importFolderBtn'];
              return {
                bodyW:document.body.scrollWidth,viewportW:innerWidth,
                workspace:r('.looper66Workspace'),shell:r('.looper66Shell'),mechanism:r('.cassetteMechanism'),
                readout:r('.deckReadout'),pitch:r('.deckPitchModule'),imports:r('.looperImportDock'),
                controls:ids.map(id=>({id,...document.getElementById(id).getBoundingClientRect().toJSON(),display:getComputedStyle(document.getElementById(id)).display})),
                crates:r('.cratePanel'),beats:r('.beatListPanel')
              };
            }''')
            assert metrics['bodyW']<=metrics['viewportW']+2,metrics
            assert metrics['shell']['width']<=metrics['viewportW']+1,metrics
            assert abs(metrics['mechanism']['width']/metrics['mechanism']['height']-(435/262))<.02,metrics
            assert all(c['display']!='none' and c['width']>=44 and c['height']>=44 for c in metrics['controls']),metrics

            workspace=metrics['workspace']
            for name in ('readout','pitch','imports','mechanism','crates','beats'):
                box=metrics[name]
                assert box['x']>=workspace['x']-2,(width,name,box,workspace)
                assert box['x']+box['width']<=workspace['x']+workspace['width']+2,(width,name,box,workspace)
                assert box['y']>=workspace['y']-2,(width,name,box,workspace)
                assert box['y']+box['height']<=workspace['y']+workspace['height']+2,(width,name,box,workspace)

            by_id={c['id']:c for c in metrics['controls']}
            stop,play,speed=(by_id[name] for name in ('stopBeat','playBeat','autoLooperToggle'))
            if width>680:
                assert stop['x']<play['x']<speed['x'],metrics
                assert max(abs(stop['y']-play['y']),abs(play['y']-speed['y']))<2,metrics
            else:
                assert stop['y']<=play['y']+2,metrics
                assert speed['y']>=min(stop['y'],play['y']),metrics

            assert page.locator('#autoLooperToggle .deckRateVisualSegments i').count()==5
            assert page.locator('#crateFilters .crateFilterButton').count()==4
            assert page.locator('.deckTransport button').evaluate_all('''buttons=>buttons.every(button=>{
              const b=button.getBoundingClientRect();
              return b.width>=44 && b.height>=44 && !!button.getAttribute('aria-label');
            })''')

            page.click('[data-tab="chopper"]');page.wait_for_timeout(40)
            page.click('[data-tab="looper"]');page.wait_for_timeout(40)
            assert page.locator('#looper.active .cassetteMechanism').count()==1
            assert not errors,errors
            page.close()
        browser.close()

print('OK: 120927 deck stays contained, touchable and responsive across desktop/mobile')
