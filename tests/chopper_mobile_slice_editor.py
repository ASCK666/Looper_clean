from pathlib import Path
import math,struct,sys,tempfile,wave

from browser_fixture import inline_runtime_page

try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIP: playwright is not installed')
    sys.exit(0)

ROOT=Path(__file__).resolve().parents[1]
loader=(ROOT/'js/chopper-wave-slices.js').read_text(encoding='utf-8')
assert './js/chopper-mobile-slice-editor.js' in loader


def make_wav(path,duration=1.6,freq=190,sr=44100):
    n=int(duration*sr)
    with wave.open(str(path),'wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(sr)
        frames=bytearray()
        for i in range(n):
            env=.82 if (i%(sr//10)) < 1500 else .28
            v=max(-1,min(1,env*math.sin(2*math.pi*freq*i/sr)))
            frames += struct.pack('<h',int(v*32767))
        w.writeframes(frames)


html=inline_runtime_page(
    preload_before={
        'js/chopper-wave-slices.js':('js/chopper-mobile-slice-editor.js',),
    }
)

with tempfile.TemporaryDirectory() as td, sync_playwright() as p:
    sample=Path(td)/'mobile-chops.wav';make_wav(sample)
    browser=p.chromium.launch(
        headless=True,
        executable_path='/usr/bin/chromium',
        args=['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']
    )
    context=browser.new_context(viewport={'width':390,'height':900},is_mobile=True,has_touch=True,device_scale_factor=2)
    page=context.new_page();cdp=context.new_cdp_session(page)

    def touch_point(locator):
        box=locator.bounding_box();assert box,box
        return box['x']+box['width']/2,box['y']+box['height']/2

    def touch_start(locator):
        x,y=touch_point(locator)
        cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y,'radiusX':8,'radiusY':8,'force':1}]})

    def touch_end():
        cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})

    def canvas_checksum(canvas_id):
        return page.evaluate('''canvasId => {
          const c=document.getElementById(canvasId);
          const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
          let sum=0;for(let i=0;i<d.length;i+=4)sum=(sum+d[i]*3+d[i+1]*5+d[i+2]*7+d[i+3])%2147483647;
          return sum;
        }''',canvas_id)

    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html,wait_until='load',timeout=20000)
    page.wait_for_function('window.ChopperWaveSlices && window.ChopperMobileSliceEditor',timeout=10000)
    page.click('[data-tab="chopper"]');page.set_input_files('#sampleFile',str(sample))
    page.wait_for_function('sampleBuffer !== null && markers.length === 17',timeout=10000)
    page.click('#autoMarkers');page.wait_for_timeout(80)
    state=page.evaluate('''() => ({mode:ChopperWaveSlices.mode,markers:markers.length,pads:document.querySelectorAll('#pads .pad').length,enabled:[...document.querySelectorAll('#pads .pad')].filter(p=>!p.disabled).length,mobile:matchMedia('(max-width:760px)').matches,touch:navigator.maxTouchPoints>0})''')
    assert state=={'mode':'markers','markers':17,'pads':16,'enabled':16,'mobile':True,'touch':True},state

    pad=page.locator('#pads .pad').nth(5);x,y=touch_point(pad);page.touchscreen.tap(x,y)
    page.wait_for_function('chopAuditionPad === 5',timeout=3000);page.evaluate('stopChopAudition()')
    touch_start(pad);page.wait_for_timeout(520)
    page.wait_for_function('ChopperMobileSliceEditor.visible && ChopperMobileSliceEditor.activePad === 5',timeout=3000)
    held=page.evaluate('''() => {const w=document.getElementById('mobileChopWave').getBoundingClientRect(),p=document.getElementById('mobileChopPlayhead').getBoundingClientRect(),r=document.getElementById('mobileChopEditorRange').getBoundingClientRect();return {title:document.getElementById('mobileChopEditorTitle').textContent,workspace:getComputedStyle(document.getElementById('mobileChopWorkspace')).display,upper:getComputedStyle(document.querySelector('.samplerUpperDeck')).display,performance:getComputedStyle(document.querySelector('.samplerPerformanceDeck')).display,drums:getComputedStyle(document.querySelector('.samplerDrumSection')).display,w:w.width,h:w.height,playheadOverlay:p.width===w.width && p.height===w.height,above:w.bottom<=r.top+1,flag:document.getElementById('chopper').dataset.mobileChopView,audition:chopAuditionPad}}''')
    touch_end();page.wait_for_timeout(40)
    assert held['title']=='CHOP 06 / 16 • MARKERS' and held['workspace']!='none' and held['flag']=='1',held
    assert held['upper']=='none' and held['performance']=='none' and held['drums']=='none' and held['w']>340 and held['h']>=180 and held['playheadOverlay'] and held['above'],held
    assert held['audition']==-1 and page.evaluate('chopAuditionPad')==-1

    page.click('#mobileChopNext');page.wait_for_function('ChopperMobileSliceEditor.activePad === 6',timeout=2000)
    assert page.evaluate("document.getElementById('mobileChopEditorTitle').textContent")=='CHOP 07 / 16 • MARKERS'
    page.click('#mobileChopPrev');page.wait_for_function('ChopperMobileSliceEditor.activePad === 5',timeout=2000)
    assert page.evaluate("document.getElementById('mobileChopEditorTitle').textContent")=='CHOP 06 / 16 • MARKERS'

    before=page.evaluate('''() => ({start:markers[5],end:markers[6]})''')
    page.click('[data-mobile-boundary="start"][data-mobile-delta="0.005"]');page.click('[data-mobile-boundary="end"][data-mobile-delta="-0.025"]')
    after=page.evaluate('''() => ({start:markers[5],end:markers[6],count:markers.length,ordered:markers.every((v,i,a)=>i===0||v>a[i-1])})''')
    assert after['count']==17 and after['ordered'] and abs((after['start']-before['start'])-.005)<1e-6 and abs((after['end']-before['end'])+.025)<1e-6,(before,after)

    static_wave=canvas_checksum('mobileChopWave');static_playhead=canvas_checksum('mobileChopPlayhead')
    page.click('#mobileChopPreview');page.wait_for_function('chopAuditionPad === 5',timeout=3000);page.wait_for_timeout(45)
    assert canvas_checksum('mobileChopWave')==static_wave
    assert canvas_checksum('mobileChopPlayhead')!=static_playhead
    page.wait_for_timeout(int((after['end']-after['start'])*1000+160));assert page.evaluate('chopAuditionPad')==-1

    assert page.locator('#mobileChopDone').inner_text()=='← CHOPS';page.click('#mobileChopDone')
    done=page.evaluate('''() => ({visible:ChopperMobileSliceEditor.visible,workspace:getComputedStyle(document.getElementById('mobileChopWorkspace')).display,performance:getComputedStyle(document.querySelector('.samplerPerformanceDeck')).display,pads:getComputedStyle(document.getElementById('pads')).display,enabled:[...document.querySelectorAll('#pads .pad')].filter(p=>!p.disabled).length,flag:document.getElementById('chopper').dataset.mobileChopView||'',status:document.getElementById('chopStatus').textContent})''')
    assert not done['visible'] and done['workspace']=='none' and done['performance']!='none' and done['pads']!='none' and done['enabled']==16 and done['flag']=='' and done['status']=='CHOP MODE • MARKERS',done

    pad=page.locator('#pads .pad').nth(5);touch_start(pad);page.wait_for_timeout(520)
    page.wait_for_function('ChopperMobileSliceEditor.visible && ChopperMobileSliceEditor.activePad === 5',timeout=3000);touch_end();page.wait_for_timeout(40);page.click('#mobileChopDone')

    marker_snapshot=page.evaluate('markers.slice()');page.evaluate("ChopperWaveSlices.setEditMode('slices')")
    page.wait_for_function("ChopperWaveSlices.mode === 'slices' && ChopperWaveSlices.slices.length === 4",timeout=3000)
    slice_before=page.evaluate('ChopperWaveSlices.slices[1].start');slice_pad=page.locator('#pads .pad').nth(1);touch_start(slice_pad);page.wait_for_timeout(520)
    page.wait_for_function('ChopperMobileSliceEditor.visible && ChopperMobileSliceEditor.activePad === 1',timeout=3000);touch_end();page.wait_for_timeout(40)
    page.click('#mobileChopNext');page.wait_for_function('ChopperMobileSliceEditor.activePad === 2',timeout=2000);page.click('#mobileChopPrev');page.wait_for_function('ChopperMobileSliceEditor.activePad === 1',timeout=2000)
    page.click('[data-mobile-boundary="start"][data-mobile-delta="0.005"]');slice_after=page.evaluate('ChopperWaveSlices.slices[1].start')
    assert abs((slice_after-slice_before)-.005)<1e-6 and page.evaluate('markers.slice()')==marker_snapshot
    page.click('#mobileChopDone');assert not errors,errors
    page.close();context.close();browser.close()

print('OK: Chopper mobile CHOP view — real touch hold, static waveform + overlay playhead, 16 AUTO CHOP pads, PREV/NEXT, START/END, CHOPS return, SLICES')