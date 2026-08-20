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


def no_overlaps(page):
    return page.evaluate('''() => ChopperWaveSlices.slices.every((r,i,a) =>
      r.end-r.start >= ChopperWaveSlices.minSliceSec-1e-9 &&
      (i===0 || r.start >= a[i-1].end-1e-9)
    )''')


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

    # MARKERS remains the original linked editor from chopper.js.
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
    marker_snapshot=page.evaluate('markers.slice()')

    # SLICES always begins as four coarse, ordered, non-overlapping regions.
    page.click('#sliceEditModeBtn')
    page.wait_for_function('ChopperWaveSlices.mode === "slices"',timeout=3000)
    seeded=page.evaluate('''() => ({
      initial:ChopperWaveSlices.initialSlices,
      max:ChopperWaveSlices.maxSlices,
      ranges:ChopperWaveSlices.slices,
      enabled:[...document.querySelectorAll('#pads .pad')].filter(p=>!p.disabled).length,
      markers:markers.slice()
    })''')
    assert seeded['initial']==4 and seeded['max']==16,seeded
    assert len(seeded['ranges'])==4 and seeded['enabled']==4,seeded
    assert seeded['markers']==marker_snapshot,seeded
    assert no_overlaps(page),seeded

    # Tail trim creates a gap without moving the next slice.
    initial=seeded['ranges']
    tail_target=initial[0]['end']-.045
    end_point=client_point_for_source(page,initial[0]['end'])
    target=client_point_for_source(page,tail_target)
    page.mouse.move(end_point['x'],end_point['y'])
    page.mouse.down()
    page.mouse.move(target['x'],target['y'],steps=6)
    page.mouse.up()
    trimmed=page.evaluate('ChopperWaveSlices.slices')
    assert trimmed[0]['end']<initial[1]['start']-.02,trimmed
    assert abs(trimmed[1]['start']-initial[1]['start'])<1e-9,trimmed
    assert no_overlaps(page)

    # Attack trim is independent too. The previous slice remains untouched.
    start_before=trimmed[1]['start']
    attack_target=start_before+.030
    start_point=client_point_for_source(page,start_before)
    target=client_point_for_source(page,attack_target)
    page.mouse.move(start_point['x'],start_point['y'])
    page.mouse.down()
    page.mouse.move(target['x'],target['y'],steps=6)
    page.mouse.up()
    attack=page.evaluate('ChopperWaveSlices.slices')
    assert attack[1]['start']>start_before+.015,attack
    assert abs(attack[0]['end']-trimmed[0]['end'])<1e-9,attack
    assert no_overlaps(page)

    # A boundary cannot cross its neighbour: overlaps are clamped out while gaps remain legal.
    clamp_state=page.evaluate('''() => {
      const before=ChopperWaveSlices.slices;
      ChopperWaveSlices.setSliceBoundary(0,'end',before[1].start+.2);
      return ChopperWaveSlices.slices;
    }''')
    assert abs(clamp_state[0]['end']-clamp_state[1]['start'])<1e-9,clamp_state
    assert no_overlaps(page)

    # Re-create a visible gap, then double-click inside it to add a new slice.
    gap=page.evaluate('''() => {
      const s=ChopperWaveSlices.slices;
      ChopperWaveSlices.setSliceBoundary(0,'end',s[1].start-.09);
      const n=ChopperWaveSlices.slices;
      return {left:n[0].end,right:n[1].start};
    }''')
    gap_sec=(gap['left']+gap['right'])/2
    gap_point=client_point_for_source(page,gap_sec)
    page.mouse.dblclick(gap_point['x'],gap_point['y'],delay=50)
    page.wait_for_function('ChopperWaveSlices.slices.length === 5',timeout=3000)
    after_gap=page.evaluate('''() => ({
      ranges:ChopperWaveSlices.slices,
      enabled:[...document.querySelectorAll('#pads .pad')].filter(p=>!p.disabled).length
    })''')
    assert after_gap['enabled']==5,after_gap
    assert no_overlaps(page),after_gap

    # Double-clicking inside an existing slice splits that slice in two.
    split_range=after_gap['ranges'][-1]
    split_sec=(split_range['start']+split_range['end'])/2
    split_point=client_point_for_source(page,split_sec)
    page.mouse.dblclick(split_point['x'],split_point['y'],delay=50)
    page.wait_for_function('ChopperWaveSlices.slices.length === 6',timeout=3000)
    assert no_overlaps(page)
    assert page.evaluate("[...document.querySelectorAll('#pads .pad')].filter(p=>!p.disabled).length")==6

    # Keep splitting the largest region until all 16 pads are mapped.
    grown=page.evaluate('''() => {
      let guard=40;
      while(ChopperWaveSlices.slices.length<ChopperWaveSlices.maxSlices && guard--){
        const ranges=ChopperWaveSlices.slices;
        let best=-1,bestLen=-1;
        for(let i=0;i<ranges.length;i++){
          const len=ranges[i].end-ranges[i].start;
          if(len>bestLen){best=i;bestLen=len;}
        }
        if(best<0 || bestLen<ChopperWaveSlices.minSliceSec*2.1)break;
        const r=ranges[best];
        if(!ChopperWaveSlices.addSliceAt((r.start+r.end)/2))break;
      }
      const beforeExtra=ChopperWaveSlices.slices.length;
      const r=ChopperWaveSlices.slices[0];
      const extra=ChopperWaveSlices.addSliceAt((r.start+r.end)/2);
      return {
        count:ChopperWaveSlices.slices.length,
        beforeExtra,
        extra,
        enabled:[...document.querySelectorAll('#pads .pad')].filter(p=>!p.disabled).length,
        ranges:ChopperWaveSlices.slices
      };
    }''')
    assert grown['count']==16 and grown['beforeExtra']==16,grown
    assert grown['extra'] is False,grown
    assert grown['enabled']==16,grown
    assert no_overlaps(page),grown

    # Pad N auditions exactly slice N, using its independent start/end.
    chosen=7
    chosen_range=grown['ranges'][chosen]
    page.locator('#pads .pad').nth(chosen).click()
    page.wait_for_function(f'ChopperWaveSlices.selectedSlice === {chosen} && chopAuditionPad === {chosen}',timeout=5000)
    assert abs(page.evaluate('chopAuditionOffset')-chosen_range['start'])<1e-9
    page.evaluate('stopChopAudition()')

    page.evaluate(f'''() => {{
      loopGridEvents=new Array(CHOPPER_SEQUENCE_STEPS).fill(0);
      loopGridEvents[0]={chosen+1};
    }}''')
    playhead_state=page.evaluate(f'''() => {{
      const s=buildLoopPlayheadState();
      const r=ChopperWaveSlices.slices[{chosen}];
      return {{segment:s.segments[0],range:r,rate:s.pitchRate}};
    }}''')
    audible=playhead_state['segment']['endTime']-playhead_state['segment']['startTime']
    expected=(playhead_state['range']['end']-playhead_state['range']['start'])/playhead_state['rate']
    assert abs(audible-expected)<1e-6,(audible,expected,playhead_state)

    # MARKERS comes back untouched. Returning to SLICES preserves the edited state.
    page.click('#sliceEditModeBtn')
    assert page.evaluate('ChopperWaveSlices.mode')=='markers'
    assert page.evaluate('markers.slice()')==marker_snapshot
    page.click('#sliceEditModeBtn')
    assert page.evaluate('ChopperWaveSlices.mode')=='slices'
    assert page.evaluate('ChopperWaveSlices.slices.length')==16

    # AUTO CHOP is the coarse reset for SLICES: four regions again.
    page.click('#autoMarkers')
    page.wait_for_timeout(80)
    reset=page.evaluate('''() => ({
      count:ChopperWaveSlices.slices.length,
      enabled:[...document.querySelectorAll('#pads .pad')].filter(p=>!p.disabled).length,
      markers:markers.slice()
    })''')
    assert reset['count']==4 and reset['enabled']==4,reset
    assert no_overlaps(page),reset
    assert not errors,errors
    page.close()
    browser.close()

print('OK: Chopper SLICES — 4 coarse slices, double-click add/split, independent trim, no overlap, 16-pad ceiling, MARKERS untouched')
