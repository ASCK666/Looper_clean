from pathlib import Path
import math,re,struct,sys,tempfile,wave
try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIP: playwright is not installed')
    sys.exit(0)

ROOT=Path(__file__).resolve().parents[1]


def make_wav(path,duration=.96,freq=180,sr=44100):
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
    page.wait_for_function('window.ChopperWaveSlices && document.getElementById("sliceEditModeBtn")',timeout=10000)
    page.click('[data-tab="chopper"]')
    page.set_input_files('#sampleFile',str(sample))
    page.wait_for_function('sampleBuffer !== null && markers.length === 17',timeout=10000)

    # The mode control lives directly in the SAMPLE DISPLAY title row and the
    # feature does not enlarge the maintained waveform.
    mode_ui=page.evaluate('''() => {
      const button=document.getElementById('sliceEditModeBtn');
      const title=button.closest('.stableTitle');
      const label=title.querySelector('span');
      const br=button.getBoundingClientRect();
      const lr=label.getBoundingClientRect();
      return {
        text:button.textContent,
        mode:ChopperWaveSlices.mode,
        inTitle:!!title && title.textContent.includes('SAMPLE DISPLAY'),
        buttonX:br.x,
        labelRight:lr.right,
        height:document.getElementById('waveCanvas').getBoundingClientRect().height
      };
    }''')
    assert mode_ui['text']=='MARKERS' and mode_ui['mode']=='markers',mode_ui
    assert mode_ui['inTitle'] and mode_ui['buttonX']>=mode_ui['labelRight']-1,mode_ui
    assert abs(mode_ui['height']-240)<1,mode_ui

    # MARKERS is the original linked-boundary editor: dragging marker 2 moves
    # that shared boundary while keeping the marker list ordered.
    page.evaluate('setMarkers(8)')
    before=page.evaluate('markers[2]')
    marker_point=client_point_for_source(page,before)
    page.mouse.move(marker_point['x'],marker_point['y'])
    page.mouse.down()
    page.mouse.move(marker_point['x']+34,marker_point['y'],steps=5)
    page.mouse.up()
    linked_after=page.evaluate('markers[2]')
    assert abs(linked_after-before)>.005,(before,linked_after)
    assert page.evaluate('markers.every((v,i,a)=>i===0 || v>a[i-1])')
    assert page.evaluate('ChopperWaveSlices.mode')=='markers'

    # Switching to SLICES creates independent ranges from the current marker
    # layout. The marker array remains the untouched MARKERS-mode source.
    page.click('#sliceEditModeBtn')
    page.wait_for_function('ChopperWaveSlices.mode === "slices"',timeout=3000)
    seeded=page.evaluate('''() => ({
      button:document.getElementById('sliceEditModeBtn').textContent,
      marker2:markers[2],
      ranges:ChopperWaveSlices.slices
    })''')
    assert seeded['button']=='SLICES',seeded
    assert len(seeded['ranges'])==8,seeded
    assert abs(seeded['ranges'][1]['end']-seeded['marker2'])<1e-9,seeded

    # Hold + drag inside slice 2 changes only slice 2's end. Slice 3's start and
    # every linked marker remain unchanged, so a deliberate gap is possible.
    slice2=seeded['ranges'][1]
    slice3_start=seeded['ranges'][2]['start']
    marker_snapshot=page.evaluate('markers.slice()')
    press_sec=slice2['start']+(slice2['end']-slice2['start'])*.35
    target_sec=slice2['start']+(slice2['end']-slice2['start'])*.62
    press=client_point_for_source(page,press_sec)
    target=client_point_for_source(page,target_sec)
    page.mouse.move(press['x'],press['y'])
    page.mouse.down()
    page.mouse.move(target['x'],target['y'],steps=6)
    page.mouse.up()
    page.wait_for_timeout(40)
    gap_state=page.evaluate('''() => ({ranges:ChopperWaveSlices.slices,markers:markers.slice(),selected:ChopperWaveSlices.selectedSlice})''')
    assert gap_state['selected']==1,gap_state
    assert gap_state['ranges'][1]['end']<slice3_start,gap_state
    assert abs(gap_state['ranges'][2]['start']-slice3_start)<1e-9,gap_state
    assert gap_state['markers']==marker_snapshot,gap_state

    # The same slice can also extend across the next slice, proving overlaps are
    # allowed without moving that neighbour's independent start.
    overlap_target=min(page.evaluate('sampleBuffer.duration-.01'),slice3_start+.055)
    press=client_point_for_source(page,press_sec)
    target=client_point_for_source(page,overlap_target)
    page.mouse.move(press['x'],press['y'])
    page.mouse.down()
    page.mouse.move(target['x'],target['y'],steps=6)
    page.mouse.up()
    page.wait_for_timeout(40)
    overlap=page.evaluate('ChopperWaveSlices.slices')
    assert overlap[1]['end']>overlap[2]['start'],overlap
    assert abs(overlap[2]['start']-slice3_start)<1e-9,overlap
    assert page.evaluate('markers.slice()')==marker_snapshot

    # A simple pad click selects the same independent region and auditions from
    # that range's own start; the playhead model is limited by its own end.
    page.locator('#pads .pad').nth(1).click()
    page.wait_for_function('ChopperWaveSlices.selectedSlice === 1 && chopAuditionPad === 1',timeout=5000)
    selected=page.evaluate('''() => [...document.querySelectorAll('#pads .pad')].map(p=>p.classList.contains('slice-selected'))''')
    assert selected[1] and sum(1 for x in selected if x)==1,selected
    assert abs(page.evaluate('chopAuditionOffset')-overlap[1]['start'])<1e-9
    page.evaluate('stopChopAudition()')

    page.evaluate('''() => {
      loopGridEvents=new Array(CHOPPER_SEQUENCE_STEPS).fill(0);
      loopGridEvents[0]=2;
    }''')
    playhead_state=page.evaluate('''() => {
      const s=buildLoopPlayheadState();
      const r=ChopperWaveSlices.slices[1];
      return {segment:s.segments[0],range:r,rate:s.pitchRate};
    }''')
    audible=playhead_state['segment']['endTime']-playhead_state['segment']['startTime']
    expected=(playhead_state['range']['end']-playhead_state['range']['start'])/playhead_state['rate']
    assert abs(audible-expected)<1e-6,(audible,expected,playhead_state)

    # Mode switching preserves each model separately: MARKERS returns to the
    # original linked editor; switching back restores the independent edit.
    saved_free_end=overlap[1]['end']
    page.click('#sliceEditModeBtn')
    assert page.evaluate('ChopperWaveSlices.mode')=='markers'
    assert page.locator('#sliceEditModeBtn').inner_text()=='MARKERS'
    assert page.evaluate('markers.slice()')==marker_snapshot
    assert not page.locator('#pads .pad').nth(1).evaluate("p=>p.classList.contains('slice-selected')")

    page.click('#sliceEditModeBtn')
    assert page.evaluate('ChopperWaveSlices.mode')=='slices'
    assert abs(page.evaluate('ChopperWaveSlices.slices[1].end')-saved_free_end)<1e-9

    # AUTO CHOP remains available and intentionally reseeds both models.
    page.click('#autoMarkers')
    page.wait_for_timeout(60)
    final_state=page.evaluate('''() => ({
      markers:markers.length,
      ranges:ChopperWaveSlices.slices.length,
      pads:document.querySelectorAll('#pads .pad:not(.unavailable)').length,
      mode:ChopperWaveSlices.mode
    })''')
    assert final_state=={'markers':17,'ranges':16,'pads':16,'mode':'slices'},final_state
    assert not errors,errors
    page.close()
    browser.close()

print('OK: Chopper edit modes — original linked MARKERS plus independent hold-drag SLICES, unchanged waveform height')
