from pathlib import Path
import math,re,struct,sys,tempfile,wave
try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIP: playwright is not installed')
    sys.exit(0)

ROOT=Path(__file__).resolve().parents[1]


def make_wav(path,duration=.72,freq=180,sr=44100):
    n=int(duration*sr)
    with wave.open(str(path),'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        frames=bytearray()
        for i in range(n):
            env=.82 if (i%(sr//9)) < 1400 else .30
            v=max(-1,min(1,env*math.sin(2*math.pi*freq*i/sr)))
            frames += struct.pack('<h',int(v*32767))
        w.writeframes(frames)


def inline_project():
    html=(ROOT/'index.html').read_text(encoding='utf-8')
    html=re.sub(r'<link rel="manifest"[^>]*>','',html)
    for rel in ['./css/base.css','./css/clean-ui.css','./css/chopper-drum-controls.css']:
        css=(ROOT/rel[2:]).read_text(encoding='utf-8')
        html=html.replace(f'<link rel="stylesheet" href="{rel}">',f'<style>{css}</style>')
    html=re.sub(r'src="assets/[^"]+"','src=""',html)
    for rel in ['./js/bootstrap.js','./js/core.js','./js/looper.js','./js/practice.js','./js/chopper.js','./js/drums.js','./js/events.js','./js/chopper-drum-controls.js']:
        js=(ROOT/rel[2:]).read_text(encoding='utf-8')
        html=html.replace(f'<script src="{rel}" defer></script>',f'<script>{js}</script>')
        html=html.replace(f'<script src="{rel}"></script>',f'<script>{js}</script>')
    feature=(ROOT/'js/chopper-wave-slices.js').read_text(encoding='utf-8')
    html=html.replace('</body>',f'<script>{feature}</script></body>')
    return html


def client_point_for_source(page,sec):
    return page.evaluate('''sec => {
      const canvas=document.getElementById('waveCanvas');
      const r=canvas.getBoundingClientRect();
      const vw=viewWindow();
      const display=sourceToDisplayTime(sec);
      return {
        x:r.left+((display-vw.start)/vw.dur)*r.width,
        y:r.top+r.height*.55
      };
    }''',sec)


with tempfile.TemporaryDirectory() as td, sync_playwright() as p:
    sample=Path(td)/'wave-slices.wav'
    make_wav(sample)
    browser=p.chromium.launch(
        headless=True,
        executable_path='/usr/bin/chromium',
        args=['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']
    )
    page=browser.new_page(viewport={'width':1280,'height':1100})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(inline_project(),wait_until='load',timeout=20000)
    page.wait_for_function('window.__SP && window.__SP.ready === true',timeout=10000)
    page.wait_for_function('window.ChopperWaveSlices && document.querySelector("#waveCanvas[tabindex]")',timeout=10000)
    page.click('[data-tab="chopper"]')
    page.set_input_files('#sampleFile',str(sample))
    page.wait_for_function('sampleBuffer !== null && markers.length === 17',timeout=10000)

    # Constraint: the feature must not enlarge the waveform. Desktop stays on
    # the maintained 240px CSS height used before the slice-editor change.
    wave_height=page.evaluate('document.getElementById("waveCanvas").getBoundingClientRect().height')
    assert abs(wave_height-240)<1,wave_height

    # Work with eight slices so double-click can create a ninth one.
    page.evaluate('setMarkers(8)')
    assert page.evaluate('markers.length')==9
    assert page.evaluate('ChopperWaveSlices.selectedSlice')==0

    # PAD N and waveform slice N are one selection state.
    page.locator('#pads .pad').nth(2).click()
    page.wait_for_function('ChopperWaveSlices.selectedSlice === 2 && chopAuditionPad === 2',timeout=5000)
    selected=page.evaluate('''() => [...document.querySelectorAll('#pads .pad')].map(p=>p.classList.contains('selected'))''')
    assert selected[2] and sum(1 for x in selected if x)==1,selected
    assert page.evaluate('selectedMarker')==2
    page.evaluate('stopChopAudition()')

    # Clicking a waveform region selects/auditions the matching pad.
    sec=page.evaluate('(markers[4]+markers[5])/2')
    point=client_point_for_source(page,sec)
    page.mouse.click(point['x'],point['y'])
    page.wait_for_function('ChopperWaveSlices.selectedSlice === 4 && chopAuditionPad === 4',timeout=5000)
    assert page.locator('#pads .pad').nth(4).evaluate("p=>p.classList.contains('selected')")

    # A pad strike paints a whole slice region on the overlay, not only a thin
    # playhead line. Count alpha pixels while the audition flash is active.
    page.wait_for_timeout(30)
    alpha_pixels=page.evaluate('''() => {
      const c=document.getElementById('playheadCanvas');
      const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      let count=0;
      for(let i=3;i<d.length;i+=4)if(d[i])count++;
      return count;
    }''')
    assert alpha_pixels>2500,alpha_pixels
    page.evaluate('stopChopAudition()')

    # Double-click inserts a free marker, focuses the waveform and selects the
    # newly created right-hand slice. Delete removes that internal marker again.
    add_sec=page.evaluate('sampleBuffer.duration * .43')
    add_point=client_point_for_source(page,add_sec)
    page.mouse.dblclick(add_point['x'],add_point['y'],delay=35)
    page.wait_for_function('markers.length === 10',timeout=3000)
    added=page.evaluate('''() => ({
      marker:selectedMarker,
      slice:ChopperWaveSlices.selectedSlice,
      focused:document.activeElement===document.getElementById('waveCanvas')
    })''')
    assert 0<added['marker']<9,added
    assert added['slice']==added['marker'],added
    assert added['focused'],added
    page.keyboard.press('Delete')
    page.wait_for_function('markers.length === 9',timeout=3000)

    # Marker hit areas are large enough to grab and a drag moves the marker
    # freely while preserving strict marker order.
    before=page.evaluate('markers[2]')
    marker_point=client_point_for_source(page,before)
    page.mouse.move(marker_point['x'],marker_point['y'])
    page.mouse.down()
    page.mouse.move(marker_point['x']+34,marker_point['y'],steps=5)
    page.mouse.up()
    after=page.evaluate('markers[2]')
    assert abs(after-before)>.005,(before,after)
    ordered=page.evaluate('markers.every((v,i,a)=>i===0 || v>a[i-1])')
    assert ordered
    assert page.evaluate('selectedMarker')==2

    # AUTO CHOP still returns to the requested 16-pad workstation.
    page.click('#autoMarkers')
    page.wait_for_timeout(50)
    assert page.evaluate('markers.length === 17 && document.querySelectorAll("#pads .pad:not(.unavailable)").length === 16')
    assert page.evaluate('ChopperWaveSlices.selectedSlice')==0
    assert not errors,errors
    page.close()
    browser.close()

print('OK: Chopper waveform slices — unchanged height, region selection, pad sync/flash, add/delete and marker drag')
