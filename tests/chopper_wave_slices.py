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


def drag_source(page,start_sec,end_sec):
    start=client_point_for_source(page,start_sec)
    end=client_point_for_source(page,end_sec)
    page.mouse.move(start['x'],start['y'])
    page.mouse.down()
    page.mouse.move(end['x'],end['y'],steps=7)
    page.mouse.up()
    page.wait_for_timeout(50)


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

    # Mode switch is beside SAMPLE DISPLAY and never changes waveform height.
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

    # MARKERS is exactly the maintained linked-boundary editor from chopper.js.
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

    # SLICES seeds from the current MARKERS state and then becomes independent.
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

    # Select slice 2 first so its two coincident edges win hit-testing over
    # neighbouring slices at the original shared MARKERS boundaries.
    slice2=seeded['ranges'][1]
    body_sec=slice2['start']+(slice2['end']-slice2['start'])*.5
    body=client_point_for_source(page,body_sec)
    page.mouse.click(body['x'],body['y'])
    page.wait_for_function('ChopperWaveSlices.selectedSlice === 1',timeout=3000)
    page.evaluate('stopChopAudition()')

    marker_snapshot=page.evaluate('markers.slice()')
    neighbour_left_end=seeded['ranges'][0]['end']
    neighbour_right_start=seeded['ranges'][2]['start']
    original_start=slice2['start']
    original_end=slice2['end']

    # ATTACK trim: drag the left handle to the right. Only slice 2 start moves.
    new_start=original_start+(original_end-original_start)*.22
    drag_source(page,original_start,new_start)
    after_start=page.evaluate('''() => ({
      ranges:ChopperWaveSlices.slices,
      markers:markers.slice(),
      selected:ChopperWaveSlices.selectedSlice
    })''')
    assert after_start['selected']==1,after_start
    assert after_start['ranges'][1]['start']>original_start+.005,after_start
    assert abs(after_start['ranges'][1]['end']-original_end)<1e-9,after_start
    assert abs(after_start['ranges'][0]['end']-neighbour_left_end)<1e-9,after_start
    assert abs(after_start['ranges'][2]['start']-neighbour_right_start)<1e-9,after_start
    assert after_start['markers']==marker_snapshot,after_start

    # TAIL trim: drag the right handle to the left. Start stays put and a gap
    # opens before slice 3 without moving slice 3 or any MARKERS boundary.
    trimmed_start=after_start['ranges'][1]['start']
    short_end=trimmed_start+(original_end-trimmed_start)*.62
    drag_source(page,original_end,short_end)
    after_end=page.evaluate('''() => ({ranges:ChopperWaveSlices.slices,markers:markers.slice()})''')
    assert abs(after_end['ranges'][1]['start']-trimmed_start)<1e-9,after_end
    assert after_end['ranges'][1]['end']<neighbour_right_start,after_end
    assert abs(after_end['ranges'][2]['start']-neighbour_right_start)<1e-9,after_end
    assert after_end['markers']==marker_snapshot,after_end

    # Tail can also extend across the next slice: overlaps stay legal and the
    # neighbour remains completely independent.
    overlap_target=min(page.evaluate('sampleBuffer.duration-.01'),neighbour_right_start+.055)
    drag_source(page,after_end['ranges'][1]['end'],overlap_target)
    overlap=page.evaluate('ChopperWaveSlices.slices')
    assert overlap[1]['end']>overlap[2]['start'],overlap
    assert abs(overlap[1]['start']-trimmed_start)<1e-9,overlap
    assert abs(overlap[2]['start']-neighbour_right_start)<1e-9,overlap
    assert page.evaluate('markers.slice()')==marker_snapshot

    # Direct API follows the same invariant and proves the outer boundaries are
    # not locked in SLICES mode: first attack and last tail can both be trimmed.
    page.evaluate('ChopperWaveSlices.setSliceBoundary(0,"start",0.018)')
    page.evaluate('ChopperWaveSlices.setSliceBoundary(7,"end",sampleBuffer.duration-.021)')
    outer=page.evaluate('ChopperWaveSlices.slices')
    assert outer[0]['start']>.015,outer
    assert outer[-1]['end']<page.evaluate('sampleBuffer.duration-.015'),outer
    assert page.evaluate('markers.slice()')==marker_snapshot

    # Pad audition starts at the edited attack; playhead/sequence duration ends
    # at the edited tail.
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
    assert abs(playhead_state['segment']['sampleStart']-playhead_state['range']['start'])<1e-9

    # Each edit model survives mode switching independently.
    saved_start=overlap[1]['start']
    saved_end=overlap[1]['end']
    page.click('#sliceEditModeBtn')
    assert page.evaluate('ChopperWaveSlices.mode')=='markers'
    assert page.locator('#sliceEditModeBtn').inner_text()=='MARKERS'
    assert page.evaluate('markers.slice()')==marker_snapshot
    assert not page.locator('#pads .pad').nth(1).evaluate("p=>p.classList.contains('slice-selected')")

    page.click('#sliceEditModeBtn')
    assert page.evaluate('ChopperWaveSlices.mode')=='slices'
    restored=page.evaluate('ChopperWaveSlices.slices[1]')
    assert abs(restored['start']-saved_start)<1e-9,restored
    assert abs(restored['end']-saved_end)<1e-9,restored

    # AUTO CHOP intentionally starts a fresh set of independent ranges.
    page.click('#autoMarkers')
    page.wait_for_timeout(60)
    final_state=page.evaluate('''() => ({
      markers:markers.length,
      ranges:ChopperWaveSlices.slices.length,
      pads:document.querySelectorAll('#pads .pad:not(.unavailable)').length,
      mode:ChopperWaveSlices.mode,
      firstStart:ChopperWaveSlices.slices[0].start,
      lastEnd:ChopperWaveSlices.slices.at(-1).end,
      duration:sampleBuffer.duration
    })''')
    assert final_state['markers']==17 and final_state['ranges']==16 and final_state['pads']==16,final_state
    assert final_state['mode']=='slices',final_state
    assert abs(final_state['firstStart'])<1e-9,final_state
    assert abs(final_state['lastEnd']-final_state['duration'])<1e-9,final_state
    assert not errors,errors
    page.close()
    browser.close()

print('OK: Chopper edit modes — native MARKERS plus independent SLICES with separate attack/tail trim, unchanged waveform height')
