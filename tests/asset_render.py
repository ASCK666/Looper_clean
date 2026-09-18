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
    server=socketserver.TCPServer(('127.0.0.1',0),lambda *a,**kw:QuietHandler(*a,directory=str(ROOT),**kw))
    stack.callback(server.server_close)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    stack.callback(server.shutdown)

    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
        page=browser.new_page(viewport={'width':1440,'height':1100},device_scale_factor=1)
        errors=[];failed=[]
        page.on('pageerror',lambda err:errors.append(str(err)))
        page.on('requestfailed',lambda req:failed.append(f'{req.url}: {req.failure}'))
        page.goto(f'http://127.0.0.1:{server.server_address[1]}/index.html',wait_until='networkidle',timeout=30000)
        page.wait_for_function('window.__SP?.ready === true',timeout=10000)
        page.wait_for_function('window.__SP?.ui120927Ready === true',timeout=10000)
        page.wait_for_function("[...document.querySelectorAll('.cassetteMechanism img')].every(i=>i.complete && i.naturalWidth>0)")

        assets=page.evaluate('''() => [...document.querySelectorAll('.cassetteMechanism img')].map(i=>({cls:i.className,src:i.getAttribute('src'),w:i.naturalWidth,h:i.naturalHeight}))''')
        assert len(assets)==3,assets
        assert assets[0]['src'].endswith('120927/reel-animation.webp') and assets[0]['w']==64 and assets[0]['h']==64,assets
        assert assets[1]['src'].endswith('120927/reel-animation.webp') and assets[1]['w']==64 and assets[1]['h']==64,assets
        assert assets[2]['src'].endswith('120927/cassette.webp') and assets[2]['w']==435 and assets[2]['h']==262,assets

        controls=['playBeat','stopBeat','autoLooperToggle','deckPitch','deckVolume','importFolderBtn','importBeatsBtn']
        boxes=page.evaluate('(ids)=>ids.map(id=>({id,...document.getElementById(id).getBoundingClientRect().toJSON()}))',controls)
        assert all(item['width']>=44 and item['height']>=44 for item in boxes),boxes
        assert page.locator('#autoLooperToggle .deckRateVisualSegments i').count()==5

        page.evaluate("""() => {
          const buffer=new AudioBuffer({length:44100*156,sampleRate:44100,numberOfChannels:1});
          commitLoadedTrack({id:'asset-render',name:'MIDNIGHT SESSION.WAV',created:Date.now(),source:'user-import'},buffer);
        }""")
        page.wait_for_function("document.querySelector('.cassetteDeck').classList.contains('loaded')")
        assert page.locator('#deckReadoutTrack').inner_text()=='MIDNIGHT SESSION.WAV'
        assert page.locator('#deckTimeDuration').inner_text()=='02:36'

        page.locator('#playBeat').click()
        page.wait_for_function("document.querySelector('.cassetteDeck').classList.contains('playing')")
        assert page.locator('.cassetteReel').evaluate_all("els=>els.every(el=>getComputedStyle(el).animationPlayState==='running')")
        assert page.locator('#playBeat').evaluate("el=>getComputedStyle(el).getPropertyValue('--light-strength').trim()") in ('.82','0.82')

        page.locator('#deckVolume').evaluate("el=>{el.value='25';el.dispatchEvent(new Event('input',{bubbles:true}))}")
        page.wait_for_function("Math.abs((deckOutputGain?.gain?.value ?? -1) - .25) < .02")
        gain=page.evaluate('deckOutputGain?.gain?.value')
        assert gain is not None and abs(gain-.25)<.02,gain

        page.evaluate('setLooperPitch(-8)')
        slow=float(page.locator('.cassetteReelLeft').evaluate("el=>parseFloat(getComputedStyle(el).animationDuration)"))
        page.evaluate('setLooperPitch(8)')
        fast=float(page.locator('.cassetteReelLeft').evaluate("el=>parseFloat(getComputedStyle(el).animationDuration)"))
        assert fast<slow,(slow,fast)
        page.evaluate('setLooperPitch(0)')

        # SPEED AUTO cycles the existing 0..5 engine state and the five real lamps follow it.
        for level in (1,2,3,4,5,0):
            page.locator('#autoLooperToggle').click()
            assert page.locator('#autoLooperToggle').get_attribute('data-speed-level')==str(level)
            assert page.locator('#autoLooperToggle').get_attribute('aria-pressed')==('true' if level else 'false')

        page.locator('#looper').screenshot(path=str(ARTIFACTS/'looper120927-render.png'))
        page.locator('.cassetteMechanism').screenshot(path=str(ARTIFACTS/'looper120927-cassette-playing.png'))
        page.locator('#stopBeat').click()
        assert page.locator('.cassetteReel').evaluate_all("els=>els.every(el=>getComputedStyle(el).animationPlayState==='paused')")
        assert not errors and not failed,(errors,failed)
        browser.close()

print('OK: 120927 assets load and the real transport, volume, pitch and Speed Auto remain functional')
