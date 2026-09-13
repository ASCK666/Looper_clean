"""Real cassette transitions and geometry for the approved 120927 deck."""
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

def capture(page,name):
    page.locator('.cassetteMechanism').screenshot(path=str(ARTIFACTS/f'cassette-{name}.png'))

with contextlib.ExitStack() as stack:
    server=socketserver.TCPServer(('127.0.0.1',0),lambda *a,**kw:QuietHandler(*a,directory=str(ROOT),**kw))
    stack.callback(server.server_close)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    stack.callback(server.shutdown)
    with sync_playwright() as p, contextlib.ExitStack() as browser_stack:
        browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
        browser_stack.callback(browser.close)
        for width,height,label in [(1440,1100,'desktop'),(820,1000,'tablet'),(390,900,'mobile'),(320,812,'narrow'),(680,1000,'breakpoint'),(681,1000,'above-breakpoint')]:
            page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
            errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto(f'http://127.0.0.1:{server.server_address[1]}/index.html',wait_until='networkidle')
            page.wait_for_function('window.__SP?.ready === true')
            page.wait_for_function('window.__SP?.ui120927Ready === true')
            page.wait_for_function('window.__SP?.ui120927CssReady === true')
            page.wait_for_function("[...document.querySelectorAll('.cassetteMechanism img')].every(i=>i.complete && i.naturalWidth>0)")

            mechanism=page.locator('.cassetteMechanism')
            box=mechanism.bounding_box()
            assert abs(box['width']/box['height']-1.5)<.001,(label,box)
            assert page.evaluate('document.body.scrollWidth <= innerWidth+2')
            assert page.locator('.cassetteBayForeground').is_visible()
            for selector in ('.cassetteTape','.cassetteReelLeft','.cassetteReelRight','.cassetteBeatName'):
                opacity=float(page.locator(selector).evaluate('el=>getComputedStyle(el).opacity'))
                assert opacity==0,('empty',label,selector,opacity)
            if label in ('desktop','mobile'): capture(page,f'{label}-empty')

            page.evaluate("commitLoadedTrack({id:'cassette-state',name:'MIDNIGHT SESSION.wav'},new AudioBuffer({length:44100,sampleRate:44100,numberOfChannels:1}))")
            page.wait_for_function("document.querySelector('.cassetteDeck').classList.contains('loaded')")
            assert page.locator('#cassetteBeatName').inner_text()=='MIDNIGHT SESSION'
            assert page.locator('.cassetteReelLeft').evaluate('el=>getComputedStyle(el).animationPlayState')=='paused'

            metrics=mechanism.evaluate('''el=>{
              const b=el.getBoundingClientRect();
              return [...el.children].map(child=>{
                const c=child.getBoundingClientRect(),s=getComputedStyle(child);
                return {name:child.className,x:(c.x-b.x)/b.width,y:(c.y-b.y)/b.height,
                  w:c.width/b.width,h:c.height/b.height,z:+s.zIndex,visible:s.visibility,filter:s.filter};
              });
            }''')
            assert [m['z'] for m in metrics]==[1,1,2,3,4,5],metrics
            assert all(m['visible']=='visible' and m['filter']=='none' for m in metrics),metrics
            for m in metrics:
                assert m['x']>=-.001 and m['y']>=-.001 and m['x']+m['w']<=1.001 and m['y']+m['h']<=1.001,m

            # Centres exactly match cassette-body.svg reel apertures: (301,309) and (599,309) in 900×600.
            for m,cx in zip(metrics[0:2],(301/900,599/900)):
                assert abs(m['x']+m['w']/2-cx)<.002,(label,m,cx)
                assert abs(m['y']+m['h']/2-309/600)<.002,(label,m)
                assert abs(m['w']*box['width']-m['h']*box['height'])<.2,m
            assert metrics[3]['y']+metrics[3]['h']<metrics[0]['y']
            if label in ('desktop','mobile'): capture(page,f'{label}-loaded')

            layout=mechanism.evaluate('el=>[...el.children].map(c=>[c.offsetLeft,c.offsetTop,c.offsetWidth,c.offsetHeight])')
            page.locator('#playBeat').click()
            page.wait_for_function("document.querySelector('.cassetteDeck').classList.contains('playing')")
            assert mechanism.bounding_box()==box
            assert mechanism.evaluate('el=>[...el.children].map(c=>[c.offsetLeft,c.offsetTop,c.offsetWidth,c.offsetHeight])')==layout
            assert page.locator('.cassetteReel').evaluate_all("els=>els.every(el=>getComputedStyle(el).animationPlayState==='running')")
            transforms=page.locator('.cassetteReel').evaluate_all('els=>els.map(el=>getComputedStyle(el).transform)')
            page.wait_for_timeout(180)
            assert all(a!=b for a,b in zip(transforms,page.locator('.cassetteReel').evaluate_all('els=>els.map(el=>getComputedStyle(el).transform)')))
            if label in ('desktop','mobile'): capture(page,f'{label}-playing')

            page.locator('#stopBeat').click()
            page.wait_for_function("!document.querySelector('.cassetteDeck').classList.contains('playing')")
            assert mechanism.evaluate('el=>[...el.children].map(c=>[c.offsetLeft,c.offsetTop,c.offsetWidth,c.offsetHeight])')==layout
            assert page.locator('.cassetteReel').evaluate_all("els=>els.every(el=>getComputedStyle(el).animationPlayState==='paused')")
            page.evaluate("commitLoadedTrack({id:'long-title',name:'A VERY LONG BEAT NAME '.repeat(12)},deckBuffer)")
            assert page.locator('#cassetteBeatName').evaluate('el=>el.scrollWidth>=el.clientWidth')
            page.emulate_media(reduced_motion='reduce')
            assert page.locator('.cassetteReel').evaluate_all("els=>els.every(el=>getComputedStyle(el).animationName==='none')")
            page.evaluate('deckBuffer=null; refreshCassetteUI()')
            assert float(page.locator('.cassetteTape').evaluate('el=>getComputedStyle(el).opacity'))==0
            assert not errors,errors
            page.close()
print('OK: 120927 cassette states, masked reel rotation and stable geometry')
