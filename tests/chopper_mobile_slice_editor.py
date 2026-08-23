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
    page=browser.new_page(viewport={'width':390,'height':900})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html,wait_until='load',timeout=20000)
    page.wait_for_function('window.ChopperWaveSlices && window.ChopperMobileSliceEditor',timeout=10000)
    page.click('[data-tab="chopper"]')
    page.set_input_files('#sampleFile',str(sample))
    page.wait_for_function('sampleBuffer !== null && markers.length === 17',timeout=10000)

    # AUTO CHOP remains the normal 16-chop MARKERS instrument on mobile.
    page.click('#autoMarkers');page.wait_for_timeout(80)
    auto_state=page.evaluate('''() => ({
      mode:ChopperWaveSlices.mode,
      markers:markers.length,
      pads:document.querySelectorAll('#pads .pad').length,
      enabled:[...document.querySelectorAll('#pads .pad')].filter(p=>!p.disabled).length,
      mobile:matchMedia('(max-width:760px)').matches
    })''')
    assert auto_state=={'mode':'markers','markers':17,'pads':16,'enabled':16,'mobile':True},auto_state

    # A short tap keeps the original audition behavior.
    pad=page.locator('#pads .pad').nth(5)
    pad.click();page.wait_for_function('chopAuditionPad === 5',timeout=3000)
    page.evaluate('stopChopAudition()')

    # A long press opens a dedicated CHOP view for PAD 06. The regular Chopper
    # deck is hidden and a full-sample waveform is displayed above START / END.
    box=pad.bounding_box();assert box,box
    page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
    page.mouse.down();page.wait_for_timeout(520)
    page.wait_for_function('ChopperMobileSliceEditor.visible && ChopperMobileSliceEditor.activePad === 5',timeout=3000)
    held=page.evaluate('''() => {
      const workspace=document.getElementById('mobileChopWorkspace');
      const wave=document.getElementById('mobileChopWave').getBoundingClientRect();
      const range=document.getElementById('mobileChopEditorRange').getBoundingClientRect();
      return {
        audition:chopAuditionPad,
        title:document.getElementById('mobileChopEditorTitle').textContent,
        workspaceDisplay:getComputedStyle(workspace).display,
        upperDisplay:getComputedStyle(document.querySelector('.samplerUpperDeck')).display,
        performanceDisplay:getComputedStyle(document.querySelector('.samplerPerformanceDeck')).display,
        drumsDisplay:getComputedStyle(document.querySelector('.samplerDrumSection')).display,
        waveWidth:wave.width,
        waveHeight:wave.height,
        waveAboveRange:wave.bottom <= range.top+1,
        viewFlag:document.getElementById('chopper').dataset.mobileChopView
      };
    }''')
    page.mouse.up();page.wait_for_timeout(40)
    assert held['audition']==-1,held
    assert held['title']=='CHOP 06 • MARKERS',held
    assert held['workspaceDisplay']!='none' and held['viewFlag']=='1',held
    assert held['upperDisplay']=='none' and held['performanceDisplay']=='none' and held['drumsDisplay']=='none',held
    assert held['waveWidth']>340 and held['waveHeight']>=180 and held['waveAboveRange'],held
    assert page.evaluate('chopAuditionPad')==-1

    # START / END arrow buttons edit the existing 16-chop marker boundaries.
    before=page.evaluate('''() => ({start:markers[5],end:markers[6],count:markers.length})''')
    page.click('[data-mobile-boundary="start"][data-mobile-delta="0.005"]')
    page.click('[data-mobile-boundary="end"][data-mobile-delta="-0.025"]')
    after=page.evaluate('''() => ({
      start:markers[5],end:markers[6],count:markers.length,
      ordered:markers.every((value,index,all)=>index===0 || value>all[index-1]),
      range:document.getElementById('mobileChopEditorRange').textContent
    })''')
    assert after['count']==17 and after['ordered'],after
    assert abs((after['start']-before['start'])-.005)<1e-6,(before,after)
    assert abs((after['end']-before['end'])+.025)<1e-6,(before,after)
    assert 'LEN' in after['range'],after

    # PREVIEW in the dedicated CHOP view respects END.
    page.click('#mobileChopPreview')
    page.wait_for_function('chopAuditionPad === 5',timeout=3000)
    chop_len=after['end']-after['start']
    page.wait_for_timeout(int(chop_len*1000+160))
    assert page.evaluate('chopAuditionPad')==-1

    page.click('#mobileChopDone')
    done=page.evaluate('''() => ({
      visible:ChopperMobileSliceEditor.visible,
      workspaceDisplay:getComputedStyle(document.getElementById('mobileChopWorkspace')).display,
      performanceDisplay:getComputedStyle(document.querySelector('.samplerPerformanceDeck')).display,
      enabled:[...document.querySelectorAll('#pads .pad')].filter(p=>!p.disabled).length,
      viewFlag:document.getElementById('chopper').dataset.mobileChopView || ''
    })''')
    assert not done['visible'] and done['workspaceDisplay']=='none',done
    assert done['performanceDisplay']!='none' and done['enabled']==16 and done['viewFlag']=='',done

    # The same dedicated view operates independent SLICES without mutating MARKERS.
    marker_snapshot=page.evaluate('markers.slice()')
    page.evaluate("ChopperWaveSlices.setEditMode('slices')")
    page.wait_for_function("ChopperWaveSlices.mode === 'slices' && ChopperWaveSlices.slices.length === 4",timeout=3000)
    slice_before=page.evaluate('ChopperWaveSlices.slices[1].start')
    slice_pad=page.locator('#pads .pad').nth(1)
    slice_box=slice_pad.bounding_box();assert slice_box,slice_box
    page.mouse.move(slice_box['x']+slice_box['width']/2,slice_box['y']+slice_box['height']/2)
    page.mouse.down();page.wait_for_timeout(520)
    page.wait_for_function('ChopperMobileSliceEditor.visible && ChopperMobileSliceEditor.activePad === 1',timeout=3000)
    slice_view=page.evaluate("document.getElementById('mobileChopEditorTitle').textContent")
    page.mouse.up();page.wait_for_timeout(40)
    assert slice_view=='CHOP 02 • SLICES',slice_view
    page.click('[data-mobile-boundary="start"][data-mobile-delta="0.005"]')
    slice_after=page.evaluate('ChopperWaveSlices.slices[1].start')
    assert abs((slice_after-slice_before)-.005)<1e-6,(slice_before,slice_after)
    assert page.evaluate('markers.slice()')==marker_snapshot
    page.click('#mobileChopDone')

    assert not errors,errors
    page.close();browser.close()

print('OK: Chopper mobile CHOP view — 16 AUTO CHOP pads, hold opens dedicated waveform editor, START/END, bounded preview, SLICES')