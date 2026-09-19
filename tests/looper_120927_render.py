"""Capture the approved 120927 deck at reviewable desktop/mobile sizes."""
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

            assert page.locator('.looper66DeskSurface').count()==0
            workspace=page.locator('.looper66Workspace')
            workspace_bg=workspace.evaluate("el=>getComputedStyle(el).backgroundImage")
            cables=page.locator('.looper66RearCables')
            assert cables.count()==1
            cable_state=cables.evaluate("""el => {
              const r=el.getBoundingClientRect(),s=getComputedStyle(el);
              return {complete:el.complete,w:el.naturalWidth,h:el.naturalHeight,display:s.display,visibility:s.visibility,opacity:Number(s.opacity),rw:r.width,rh:r.height};
            }""")
            assert cable_state['complete'] and cable_state['w']==1448 and cable_state['h']==1086,cable_state
            if width>680:
                assert workspace_bg.count('gradient')>=3,workspace_bg
                assert cable_state['display']!='none' and cable_state['visibility']!='hidden' and cable_state['opacity']>.95,cable_state
                assert abs(cable_state['rw']/cable_state['rh']-1448/1086)<.001,cable_state

            for selector in ('.cassetteTape','.cassetteReelLeft','.cassetteReelRight'):
                asset=page.locator(selector)
                assert asset.count()==1,selector
                dims=asset.evaluate('el=>({complete:el.complete,w:el.naturalWidth,h:el.naturalHeight})')
                assert dims['complete'] and dims['w']>0 and dims['h']>0,(selector,dims)

            cassette_box=page.locator('.cassetteMechanism').bounding_box()
            title_box=page.locator('#cassetteBeatName').bounding_box()
            assert cassette_box and title_box
            assert cassette_box['x'] <= title_box['x']
            assert title_box['x']+title_box['width'] <= cassette_box['x']+cassette_box['width']
            assert cassette_box['y'] <= title_box['y']
            assert title_box['y']+title_box['height'] <= cassette_box['y']+cassette_box['height']*.35

            assert page.locator('#deckVolume').count()==1
            assert page.locator('#crateFilters').count()==1
            assert page.locator('#beatList').count()==1
            assert page.locator('#autoLooperToggle .deckRateVisualSegments i').count()==5
            tabs=page.locator('.mainModeTabs')
            tabs_box=tabs.bounding_box()
            tab_boxes=page.locator('.mainModeTabs .tab').evaluate_all("els=>els.map(el=>{const r=el.getBoundingClientRect();return {w:r.width,h:r.height}})")
            assert tabs_box and tabs_box['width'] <= min(width,722)
            assert len(tab_boxes)==2 and all(box['h']>=44 for box in tab_boxes),tab_boxes
            tabs.screenshot(path=str(ARTIFACTS/f'mode-tabs-{label}.png'))
            import_title=page.locator('.deckImportTitle')
            assert import_title.is_visible()
            assert import_title.inner_text()=='BEAT IMPORT'
            import_box=import_title.bounding_box()
            workspace_box=workspace.bounding_box()
            assert import_box and workspace_box
            if width>680:
                assert import_box['x'] >= workspace_box['x'] + workspace_box['width']*.75,import_box
                assert import_box['y'] < workspace_box['y'] + workspace_box['height']*.25,import_box

            assert not errors,errors
            page.locator('#looper').screenshot(path=str(ARTIFACTS/f'120927-{label}-empty.png'))
            page.locator('.cassetteMechanism').screenshot(path=str(ARTIFACTS/f'cassette-120927-{label}-empty.png'))

            page.evaluate("""() => {
              const buffer=new AudioBuffer({length:44100*156,sampleRate:44100,numberOfChannels:1});
              commitLoadedTrack({id:'120927-review',name:'MIDNIGHT SESSION.WAV',created:Date.now(),source:'user-import'},buffer);
            }""")
            page.wait_for_function("document.querySelector('.cassetteDeck').classList.contains('loaded')")
            assert page.locator('#cassetteBeatName').inner_text()=='MIDNIGHT SESSION'
            page.locator('#looper').screenshot(path=str(ARTIFACTS/f'120927-{label}-loaded.png'))
            page.locator('.cassetteMechanism').screenshot(path=str(ARTIFACTS/f'cassette-120927-{label}-loaded.png'))

            page.locator('#playBeat').click()
            page.wait_for_function("document.querySelector('.cassetteDeck').classList.contains('playing')")
            page.wait_for_timeout(250)
            assert page.locator('.cassetteReel').evaluate_all("els=>els.every(el=>getComputedStyle(el).animationPlayState==='running')")
            page.locator('#looper').screenshot(path=str(ARTIFACTS/f'120927-{label}-playing.png'))
            page.locator('.cassetteMechanism').screenshot(path=str(ARTIFACTS/f'cassette-120927-{label}-playing.png'))
            if label=='desktop': page.locator('.deckTransport').screenshot(path=str(ARTIFACTS/'120927-transport-playing.png'))
            page.locator('#stopBeat').click()
            assert not errors,errors
            page.close()
print('OK: 120927 production assets are decoded, visible and functional in Chromium')
