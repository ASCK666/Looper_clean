"""Real cassette transitions, shared geometry and six reviewable references.

Set UPDATE_CASSETTE_REFERENCES=1 to replace the committed review images.
The regular run always writes current screenshots to test-artifacts, then
compares against those references with a small cross-platform raster tolerance.
"""
from pathlib import Path
import contextlib, http.server, os, socketserver, threading
from PIL import Image, ImageChops, ImageStat
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print('SKIP: playwright is not installed')
    raise SystemExit(0)

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT/'test-artifacts'
REFERENCES = ROOT/'tests/references/cassette'
ARTIFACTS.mkdir(exist_ok=True)

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args): pass

def capture(page, name):
    path = ARTIFACTS/f'cassette-{name}.png'
    page.locator('.cassetteMechanism').screenshot(path=str(path))
    baseline = REFERENCES/path.name
    if os.environ.get('UPDATE_CASSETTE_REFERENCES') == '1':
        REFERENCES.mkdir(parents=True, exist_ok=True)
        baseline.write_bytes(path.read_bytes())
    assert baseline.exists(), f'Missing reviewed reference: {baseline}'
    with Image.open(path).convert('RGB') as actual, Image.open(baseline).convert('RGB') as expected:
        assert actual.size == expected.size, (name, actual.size, expected.size)
        diff = ImageChops.difference(actual, expected)
        # Small font/antialias variation is OK; a veil or shifted asset is not.
        assert max(ImageStat.Stat(diff).mean) < 2.0, (name, ImageStat.Stat(diff).mean)
        changed = sum(max(pixel) > 40 for pixel in diff.getdata())
        assert changed/(actual.width*actual.height) < .015, (name, changed)

with contextlib.ExitStack() as stack:
    server = socketserver.TCPServer(('127.0.0.1', 0), lambda *a, **kw: QuietHandler(*a, directory=str(ROOT), **kw))
    stack.callback(server.server_close)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    stack.callback(server.shutdown)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'), args=['--no-sandbox','--disable-dev-shm-usage'])
        stack.callback(browser.close)
        geometry = None
        for width, height, label in [(1440,1100,'desktop'),(820,1000,'tablet'),(390,900,'mobile'),(320,812,'narrow'),(680,1000,'breakpoint'),(681,1000,'above-breakpoint')]:
            page = browser.new_page(viewport={'width':width,'height':height}, device_scale_factor=1)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(f'http://127.0.0.1:{server.server_address[1]}/index.html', wait_until='networkidle')
            page.wait_for_function('window.__SP?.ready === true')
            page.wait_for_function("[...document.querySelectorAll('.cassetteMechanism img')].every(i=>i.complete && i.naturalWidth>0)")
            mechanism = page.locator('.cassetteMechanism')
            box = mechanism.bounding_box()
            assert abs(box['width']/box['height']-1.5) < .001
            assert page.evaluate('document.body.scrollWidth <= innerWidth+2')
            # Empty must be a truly opaque cavity: changing the underlying skin
            # must not change a single pixel in the mechanism.
            before = mechanism.screenshot()
            page.locator('.looper66Skin').evaluate("el=>el.style.visibility='hidden'")
            assert before == mechanism.screenshot(), 'Baked-in cassette leaks through the cavity'
            page.locator('.looper66Skin').evaluate("el=>el.style.visibility=''")
            assert page.locator('.cassetteBayForeground').is_visible()
            for selector in ('.cassetteTape','.cassetteReelLeft','.cassetteReelRight','.cassetteLabel','.cassetteBeatName'):
                assert not page.locator(selector).is_visible(), ('empty', selector)
            if label in ('desktop','mobile'): capture(page, f'{label}-empty')
            page.evaluate("commitLoadedTrack({name:'MIDNIGHT SESSION.wav'}, new AudioBuffer({length:44100,sampleRate:44100,numberOfChannels:1}))")
            page.wait_for_function("Math.abs(+getComputedStyle(document.querySelector('.cassetteCssLight')).opacity-.3)<.01")
            assert page.locator('#cassetteBeatName').inner_text() == 'MIDNIGHT SESSION.WAV'
            assert page.locator('.cassetteReelLeft').evaluate('el=>getComputedStyle(el).animationPlayState') == 'paused'
            metrics = mechanism.evaluate('''el=>{
              const b=el.getBoundingClientRect();
              return [...el.children].map(child=>{
                const c=child.getBoundingClientRect(),s=getComputedStyle(child);
                return {name:child.className, x:(c.x-b.x)/b.width,y:(c.y-b.y)/b.height,
                  w:c.width/b.width,h:c.height/b.height,z:+s.zIndex,visible:s.visibility,filter:s.filter};
              });
            }''')
            assert [m['z'] for m in metrics] == [1,2,2,3,4,5,6], metrics
            assert all(m['visible']=='visible' and m['filter']=='none' for m in metrics)
            for m in metrics:
                assert m['x']>=-.001 and m['y']>=-.001 and m['x']+m['w']<=1.001 and m['y']+m['h']<=1.001, m
            # Native reel centres match the tape asset; label stays centred.
            for m, cx in zip(metrics[1:3], (.32,.68)):
                assert abs(m['x']+m['w']/2-cx)<.001
                assert abs(m['y']+m['h']/2-.49)<.001
                assert abs(m['w']*box['width']-m['h']*box['height'])<.1
            assert abs(metrics[4]['x']+metrics[4]['w']/2-.5)<.001
            assert metrics[4]['y']+metrics[4]['h']<metrics[1]['y']
            if geometry is None: geometry=metrics
            for original, current in zip(geometry, metrics):
                assert all(abs(original[k]-current[k])<.001 for k in ('x','y','w','h')), (width,original,current)
            if label in ('desktop','mobile'): capture(page, f'{label}-loaded')
            # Compare layout properties, not transformed reel bounding boxes.
            layout = mechanism.evaluate('el=>[...el.children].map(c=>[c.offsetLeft,c.offsetTop,c.offsetWidth,c.offsetHeight])')
            # Use actual PLAY/STOP buttons: no synthetic .playing class.
            page.locator('#playBeat').click()
            page.wait_for_function("document.querySelector('.cassetteDeck').classList.contains('playing')")
            page.wait_for_function("Math.abs(+getComputedStyle(document.querySelector('.cassetteCssLight')).opacity-.86)<.01")
            assert mechanism.bounding_box() == box
            assert mechanism.evaluate('el=>[...el.children].map(c=>[c.offsetLeft,c.offsetTop,c.offsetWidth,c.offsetHeight])') == layout
            assert page.locator('.cassetteReel').evaluate_all("els=>els.every(el=>getComputedStyle(el).animationPlayState==='running')")
            transforms = page.locator('.cassetteReel').evaluate_all('els=>els.map(el=>getComputedStyle(el).transform)')
            page.wait_for_timeout(180)
            assert all(a!=b for a,b in zip(transforms,page.locator('.cassetteReel').evaluate_all('els=>els.map(el=>getComputedStyle(el).transform)')))
            # Freeze only animation time for reproducible playing references.
            page.locator('.cassetteReel').evaluate_all('els=>els.forEach(el=>el.getAnimations().forEach(a=>{a.pause();a.currentTime=400;}))')
            if label in ('desktop','mobile'): capture(page, f'{label}-playing')
            page.locator('#stopBeat').click()
            page.wait_for_function("!document.querySelector('.cassetteDeck').classList.contains('playing')")
            assert mechanism.bounding_box() == box
            assert mechanism.evaluate('el=>[...el.children].map(c=>[c.offsetLeft,c.offsetTop,c.offsetWidth,c.offsetHeight])') == layout
            assert page.locator('.cassetteReel').evaluate_all("els=>els.every(el=>getComputedStyle(el).animationPlayState==='paused')")
            page.evaluate("commitLoadedTrack({name:'A VERY LONG BEAT NAME '.repeat(12)},deckBuffer)")
            assert page.locator('#cassetteBeatName').evaluate('el=>el.getBoundingClientRect().width < el.parentElement.getBoundingClientRect().width')
            page.emulate_media(reduced_motion='reduce')
            assert page.locator('.cassetteReel').evaluate_all("els=>els.every(el=>getComputedStyle(el).animationName==='none')")
            page.evaluate('deckBuffer=null; refreshCassetteUI()')
            assert not page.locator('.cassetteTape').is_visible()
            assert not errors, errors
            page.close()
print('OK: cassette states, rotation, layers, shared geometry, opaque empty bay and visual references')
