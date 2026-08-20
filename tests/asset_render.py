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
        page.wait_for_function("document.querySelectorAll('.cassetteReel').length === 2",timeout=10000)

        info=page.evaluate('''() => {
          const ids=['prevBeat','playBeat','stopBeat','nextBeat','autoLooperToggle','deckAutoToggle','deckPitch','importFolderBtn','importBeatsBtn'];
          const rect=id=>document.getElementById(id).getBoundingClientRect().toJSON();
          return {
            appErrors:window.__SP.errors,
            layers:[...document.querySelectorAll('.cassetteMechanism > *')].map(layer=>[layer.className,getComputedStyle(layer).zIndex]),
            controls:ids.map(id=>({id,...rect(id),display:getComputedStyle(document.getElementById(id)).display})),
            transport:['stopBeat','playBeat','autoLooperToggle'].map(rect),
            mechanism:rect('looperDropzoneBtn'),
            reels:[...document.querySelectorAll('.cassetteReel')].map(reel=>reel.getBoundingClientRect().toJSON()),
            workspace:document.querySelector('.looper66Workspace').getBoundingClientRect().toJSON(),
            transportOrder:[...document.querySelectorAll('.deckTransport > button')].map(button=>button.id),
            transportStyles:['stopBeat','playBeat','autoLooperToggle'].map(id=>{
              const style=getComputedStyle(document.getElementById(id));
              return {background:style.backgroundColor,backgroundImage:style.backgroundImage,boxShadow:style.boxShadow};
            }),
            rackSlots:document.querySelectorAll('.cassetteRackSlot').length,
            title:document.getElementById('cassetteBeatName').textContent,
            skin:document.querySelector('.looper66Skin img').getAttribute('src')
          };
        }''')
        assert len(info['layers'])==6,info
        assert [layer[0] for layer in info['layers']]==[
            'cassetteReel cassetteReelLeft','cassetteReel cassetteReelRight',
            'cassetteBeatName','cassetteBayForeground',
            'cassetteCssLight','cassetteGlass'
        ],info
        assert all(c['display']!='none' and c['width']>=44 and c['height']>=44 for c in info['controls']),info
        sizes={(round(rect['width'],1),round(rect['height'],1)) for rect in info['transport']}
        assert len(sizes)==1,sizes
        assert info['transportOrder']==['stopBeat','playBeat','autoLooperToggle'],info
        assert all(style['background']=='rgba(0, 0, 0, 0)' and style['backgroundImage']=='none' and style['boxShadow']=='none' for style in info['transportStyles']),info
        transport_left=min(rect['x'] for rect in info['transport'])
        transport_right=max(rect['x']+rect['width'] for rect in info['transport'])
        cassette_left=info['workspace']['x']+info['workspace']['width']*.423
        cassette_right=cassette_left+info['workspace']['width']*.417
        assert transport_left>=cassette_left-1 and transport_right<=cassette_right+1,info
        expected_centers=((601,238),(763,238))
        for reel,(expected_x,expected_y) in zip(info['reels'],expected_centers):
          center_x=(reel['x']+reel['width']/2-info['workspace']['x'])/info['workspace']['width']*1086
          center_y=(reel['y']+reel['height']/2-info['workspace']['y'])/info['workspace']['height']*1009
          assert abs(center_x-expected_x)<1 and abs(center_y-expected_y)<1,(center_x,center_y)
        assert info['rackSlots']==9,info
        assert info['title']=='NO BEAT LOADED' and info['skin'].endswith('looper66-desktop-clean-a3d35bc4.webp'),info
        assert not info['appErrors'] and not page_errors and not failed,(info['appErrors'],page_errors,failed)

        page.locator('#looper').screenshot(path=str(ARTIFACTS/'looper66-render.png'))
        page.screenshot(path=str(ARTIFACTS/'looper66-full-render.png'),full_page=True)
        browser.close()

print('OK: Looper66 v2 skins, separate reels and equal native controls render without runtime errors')
