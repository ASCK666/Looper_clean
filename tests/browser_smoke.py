from pathlib import Path
import contextlib, http.server, socketserver, threading, os, sys, tempfile, wave, struct, math
try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIP: playwright is not installed')
    sys.exit(0)

ROOT=Path(__file__).resolve().parents[1]

def make_wav(path: Path, seconds=.25, hz=220):
    rate=44100
    frames=max(1,int(rate*seconds))
    with wave.open(str(path),'wb') as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(rate)
        wf.writeframes(b''.join(struct.pack('<h',int(.18*32767*math.sin(2*math.pi*hz*i/rate))) for i in range(frames)))

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_args):
        pass

with tempfile.TemporaryDirectory() as td, contextlib.ExitStack() as stack:
    td=Path(td)
    beat=td/'test-beat.wav'; sample=td/'test-sample.wav'; xss=td/'"><img src=x onerror=window.__sp_xss=1>.wav'
    make_wav(beat,.30,180); make_wav(sample,.42,330); make_wav(xss,.18,440)

    handler=lambda *a,**kw: QuietHandler(*a,directory=str(ROOT),**kw)
    server=socketserver.TCPServer(('127.0.0.1',0),handler)
    stack.callback(server.server_close)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    stack.callback(server.shutdown)
    port=server.server_address[1]

    chromium=os.environ.get('CHROMIUM','/usr/bin/chromium')
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=chromium,args=['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required'])
        context=browser.new_context(); page=context.new_page()
        page_errors=[]; console_errors=[]
        page.on('pageerror',lambda e:page_errors.append(str(e)))
        page.on('console',lambda m:console_errors.append(m.text) if m.type=='error' else None)
        page.goto(f'http://127.0.0.1:{port}/index.html',wait_until='networkidle',timeout=30000)
        page.wait_for_function('window.__SP && window.__SP.ready === true',timeout=10000)
        page.wait_for_function('window.ChopperWaveSlices',timeout=10000)

        assert page.evaluate('window.__SP.errors.length')==0
        assert page.evaluate("sampleBuffer === null && typeof meterAnimationRAF === 'undefined'") is True
        assert page.locator('#masterVolume,#masterDb,#vu,#looperVu').count()==0
        assert not page_errors,page_errors
        assert page.locator('.cassetteMechanism').count()==1
        assert page.locator('.cassetteBayForeground').count()==1
        assert page.locator('.cassetteCssLight').count()==1
        assert page.locator('.cassetteGlass').count()==1
        assert page.locator('.cassetteReel').count()==2
        assert page.locator('#library .crateBeat').count()==0

        for rid in ['playBeat','stopBeat','prevBeat','nextBeat','cratePlayBeat','importBeatsBtn','importFolderBtn','loadSampleBtn','kickFolderBtn','snareFolderBtn','hatFolderBtn','autoLooperToggle','deckAutoToggle','deckPitch','deckTransportState','deckSpeedReadout']:
            assert page.locator('#'+rid).count()==1,rid
        handlers=page.evaluate('''() => ['playBeat','cratePlayBeat','stopBeat','loadSampleBtn','kickFolderBtn','autoLooperToggle','deckAutoToggle','importBeatsBtn','importFolderBtn'].map(id=>typeof document.getElementById(id).onclick)''')
        assert all(v=='function' for v in handlers),handlers
        assert page.evaluate("typeof document.getElementById('deckPitch').oninput")=='function'
        assert page.evaluate("getComputedStyle(document.getElementById('playBeat'),'::before').animationName")=='looper66EmptyPlayPulse'
        assert page.evaluate("getComputedStyle(document.getElementById('playBeat'),'::before').animationDuration")=='6s'

        visible=page.evaluate('''() => ['playBeat','stopBeat','prevBeat','nextBeat','cratePlayBeat','autoLooperToggle','deckAutoToggle','deckPitch','importBeatsBtn','importFolderBtn'].map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect(),c=getComputedStyle(e);return [id,r.width,r.height,c.display,c.visibility,parseFloat(c.opacity)]})''')
        assert all(v[1]>=44 and v[2]>=44 and v[3]!='none' and v[4]=='visible' and v[5]>.5 for v in visible),visible
        assert page.locator('#cratePlayBeat').is_disabled()

        page.set_input_files('#beatFiles',str(beat))
        # The cassette display intentionally uppercases its physical label while
        # deckTrack/currentTrack retain the original filename casing.
        page.wait_for_function("document.getElementById('cassetteBeatName').textContent === 'TEST-BEAT.WAV'",timeout=10000)
        assert page.evaluate("getComputedStyle(document.getElementById('playBeat'),'::before').animationName")=='none'
        assert page.evaluate("document.getElementById('deckTrack').textContent === 'test-beat.wav'") is True
        assert page.locator('#library .crateBeat').count()==1
        assert page.evaluate("dbAll().then(rows=>rows.filter(row=>row.source==='user-import' && row.name==='test-beat.wav').length)")==1

        # A legacy duplicate already in IndexedDB is consolidated on refresh,
        # keeping the current beat instead of leaving duplicate crate rows.
        page.evaluate("""async()=>{const rows=await dbAll();const row=rows.find(item=>item.source==='user-import'&&item.name==='test-beat.wav');await dbPut({...row,id:'legacy-duplicate',created:(row.created||0)+1});await refreshLibrary(false)}""")
        assert page.locator('#library .crateBeat').count()==1
        assert page.evaluate("dbAll().then(rows=>rows.filter(row=>row.source==='user-import' && row.name==='test-beat.wav').length)")==1

        # Selecting the same file again loads the existing beat but must not
        # append another persistent row.
        page.set_input_files('#beatFiles',str(beat)); page.wait_for_timeout(250)
        assert page.locator('#library .crateBeat').count()==1
        assert page.evaluate("dbAll().then(rows=>rows.filter(row=>row.source==='user-import' && row.name==='test-beat.wav').length)")==1
        assert not page.locator('#cratePlayBeat').is_disabled()
        page.click('#cratePlayBeat'); page.wait_for_function('deckSource !== null')
        page.wait_for_function("document.getElementById('deckTransportState').textContent === 'PLAYING'",timeout=5000)
        assert page.evaluate("getComputedStyle(document.querySelector('.cassetteReel')).animationPlayState")=='running'
        page.click('#stopBeat'); page.wait_for_function('deckSource === null')
        assert page.evaluate("getComputedStyle(document.querySelector('.cassetteReel')).animationPlayState")=='paused'

        page.click('#autoLooperToggle')
        assert page.locator('#autoLooperToggle').get_attribute('data-speed-level')=='1'
        assert page.locator('#autoLooperCompactStatus').inner_text().startswith('+1%')
        for expected in ['2','3','4','5','0']:
            page.click('#autoLooperToggle')
            assert page.locator('#autoLooperToggle').get_attribute('data-speed-level')==expected

        page.locator('#deckPitch').evaluate("el=>{el.value='4.5';el.dispatchEvent(new Event('input',{bubbles:true}))}")
        assert page.locator('#deckPitchReadout').inner_text()=='+4.5%'
        assert page.locator('#deckPitch').get_attribute('aria-valuetext')=='+4.5%'
        pitch_position=page.locator('.deckPitchModule').evaluate("el=>[el.style.getPropertyValue('--pitch-x'),el.style.getPropertyValue('--pitch-y')]")
        assert pitch_position==['63.31%','30.94%'],pitch_position
        assert page.locator('#deckAutoToggle').get_attribute('aria-pressed')=='false'
        page.locator('#deckPitch').evaluate("el=>{el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}))}")
        page.click('#autoLooperToggle')
        page.click('#playBeat')
        page.wait_for_function('autoLooperSpeedPercent === 101',timeout=5000)
        page.click('#stopBeat')

        page.evaluate('document.activeElement && document.activeElement.blur()')
        page.keyboard.press('Space'); page.wait_for_function('deckSource !== null')
        page.keyboard.press('Space'); page.wait_for_function('deckSource === null')
        page.focus('#deckPitch')
        assert page.evaluate("document.activeElement?.id === 'deckPitch'") is True
        page.keyboard.press('Space'); page.wait_for_timeout(120)
        assert page.evaluate('deckSource === null') is True

        page.click('[data-tab="chopper"]')
        page.set_input_files('#sampleFile',str(sample))
        page.wait_for_function("document.getElementById('chopStatus').textContent.includes('SAMPLE READY')",timeout=10000)
        assert page.evaluate("sampleName === 'test-sample.wav' && sampleBuffer !== null") is True

        page.click('[data-tab="looper"]')
        page.set_input_files('#beatFiles',str(xss)); page.wait_for_timeout(500)
        assert page.locator('#autoLooperToggle').get_attribute('data-speed-level')=='0'
        assert page.locator('#deckPitchReadout').inner_text()=='0.0%'
        assert page.evaluate('window.__sp_xss') is None
        assert page.locator('#library img').count()==0
        assert page.evaluate("safeBeatFilename('CON.wav')")=='_CON'
        assert page.evaluate("safeBeatFilename('hello?.wav')")=='hello_'
        assert page.locator('#appBootError.visible').count()==0
        context.close(); browser.close()

print('OK: Looper66 layered cassette, native controls, play/stop reels, Speed Rate cycle, pitch and filename-XSS regression')
