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
assert './js/chopper-mobile-controls.js' in loader
assert './js/chopper-mobile-slice-editor.js' in loader


def make_wav(path,duration=36.0,freq=190,sr=8000):
    n=int(duration*sr)
    with wave.open(str(path),'wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(sr)
        frames=bytearray()
        period=max(1,sr//10);accent_frames=max(20,sr//40)
        for i in range(n):
            env=.82 if (i%period) < accent_frames else .28
            v=max(-1,min(1,env*math.sin(2*math.pi*freq*i/sr)))
            frames += struct.pack('<h',int(v*32767))
        w.writeframes(frames)


html=inline_runtime_page(preload_before={
    'js/chopper-wave-slices.js':(
        'js/chopper-mobile-controls.js',
        'js/chopper-mobile-slice-editor.js',
        'js/sp1200.js',
        'js/chopper-sp1200.js',
    )
})

with tempfile.TemporaryDirectory() as td, sync_playwright() as p:
    sample=Path(td)/'mobile-chops.wav';make_wav(sample)
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required'])
    context=browser.new_context(viewport={'width':390,'height':900},is_mobile=True,has_touch=True,device_scale_factor=2)
    page=context.new_page();cdp=context.new_cdp_session(page)

    def touch_point(locator):
        locator.scroll_into_view_if_needed()
        page.wait_for_timeout(30)
        box=locator.bounding_box();assert box,box
        x=box['x']+box['width']/2;y=box['y']+box['height']/2
        viewport=page.viewport_size
        assert viewport and 0<=x<viewport['width'] and 0<=y<viewport['height'],(box,viewport)
        return x,y

    def touch_start(locator):
        x,y=touch_point(locator)
        cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y,'radiusX':8,'radiusY':8,'force':1}]})

    def touch_move(x,y):
        cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x,'y':y,'radiusX':8,'radiusY':8,'force':1}]})

    def touch_end():
        cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})

    def touch_drag(locator,dy):
        x,y=touch_point(locator)
        cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y,'radiusX':8,'radiusY':8,'force':1}]})
        page.wait_for_timeout(20)
        touch_move(x,y+dy)
        page.wait_for_timeout(20)
        touch_end()
        page.wait_for_timeout(60)

    def canvas_checksum(canvas_id):
        return page.evaluate('''canvasId => {
          const c=document.getElementById(canvasId),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
          let sum=0;for(let i=0;i<d.length;i+=4)sum=(sum+d[i]*3+d[i+1]*5+d[i+2]*7+d[i+3])%2147483647;return sum;
        }''',canvas_id)

    def open_pad_editor(index):
        pad=page.locator('#pads .pad').nth(index)
        touch_start(pad);page.wait_for_timeout(520)
        page.wait_for_function(f'ChopperMobileSliceEditor.visible && ChopperMobileSliceEditor.activePad === {index}',timeout=3000)
        touch_end();page.wait_for_timeout(40)
        return pad

    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html,wait_until='load',timeout=20000)
    page.wait_for_function('window.ChopperWaveSlices && window.ChopperMobileControls && window.ChopperMobileSliceEditor && window.ChopperBanks && window.ChopperSP1200',timeout=10000)
    page.click('[data-tab="chopper"]');page.set_input_files('#sampleFile',str(sample))
    page.wait_for_function('sampleBuffer !== null && markers.length === 17 && ChopperBanks.banks.length === 3',timeout=10000)
    assert page.locator('#autoMarkers').count()==0

    state=page.evaluate('''() => ({
      mode:ChopperWaveSlices.mode,
      markers:markers.length,
      pads:document.querySelectorAll('#pads .pad').length,
      enabled:[...document.querySelectorAll('#pads .pad')].filter(p=>!p.disabled).length,
      mobile:matchMedia('(max-width:760px)').matches,
      touch:navigator.maxTouchPoints>0,
      controls:ChopperMobileControls.active,
      workspace:ChopperMobileControls.workspace,
      tabs:[...document.querySelectorAll('.chopperMobileTab')].map(button=>button.textContent),
      waves:document.querySelectorAll('#waveCanvas').length,
      padGrids:document.querySelectorAll('#pads').length,
      sequences:document.querySelectorAll('#loopGrid').length,
      drumEditors:document.querySelectorAll('#drumEditor').length,
      banks:ChopperBanks.banks.map(bank=>bank.label)
    })''')
    assert state=={
      'mode':'markers','markers':17,'pads':16,'enabled':16,'mobile':True,'touch':True,'controls':True,
      'workspace':'chopper','tabs':['CHOPPER','SEQ','PADS','DRUMS'],
      'waves':1,'padGrids':1,'sequences':1,'drumEditors':1,
      'banks':['ALL','0–30','25–36']
    },state

    chopper_view=page.evaluate('''() => ({
      upper:getComputedStyle(document.querySelector('.samplerUpperDeck')).display,
      performance:getComputedStyle(document.querySelector('.samplerPerformanceDeck')).display,
      drums:getComputedStyle(document.querySelector('.samplerDrumSection')).display,
      actionChildren:[...document.getElementById('mobileChopperActionRow').children].map(node=>node.id),
      spChildren:[...document.getElementById('mobileChopperSpCell').children].map(node=>node.id),
      bankParent:document.getElementById('chopperBankTabs').parentElement.id,
      bankButtons:[...document.querySelectorAll('#chopperBankTabs .chopperBankTab')].map(button=>button.textContent),
      paramOrder:[...document.getElementById('mobileChopperParamRow').children].map(node=>node.querySelector('input')?.id||''),
      wave:getComputedStyle(document.querySelector('.wavewrap')).display,
      waveParent:document.querySelector('.wavewrap').parentElement.className,
      pitchKnob:getComputedStyle(document.querySelector('.samplePitchKnob .sampleKnobControl')).display,
      tempoKnob:getComputedStyle(document.getElementById('mobileTempoKnob')).display,
      volumeKnob:getComputedStyle(document.querySelector('.sampleVolumeKnob .sampleKnobControl')).display,
      punchKnob:getComputedStyle(document.querySelector('.punchKnob .sampleKnobControl')).display,
      bpmInput:getComputedStyle(document.getElementById('sampleBpm')).display,
      pitchRole:document.querySelector('.samplePitchKnob .sampleKnobControl').getAttribute('role'),
      bpmRole:document.getElementById('mobileTempoKnob').getAttribute('role'),
      volumeRole:document.querySelector('.sampleVolumeKnob .sampleKnobControl').getAttribute('role'),
      punchRole:document.getElementById('punchDesc').getAttribute('role'),
      saveParent:document.getElementById('addFlipLibrary').parentElement.className,
      selected:[...document.querySelectorAll('.chopperMobileTab')].filter(button=>button.getAttribute('aria-selected')==='true').map(button=>button.dataset.mobileWorkspace)
    })''')
    assert chopper_view['upper']!='none' and chopper_view['performance']=='none' and chopper_view['drums']=='none',chopper_view
    assert chopper_view['actionChildren']==['loadSampleBtn','mobileChopperSpCell'],chopper_view
    assert chopper_view['spChildren']==['sp1200Toggle','sp1200FilterToggle'],chopper_view
    assert chopper_view['bankParent']=='mobileChopperBankRow' and chopper_view['bankButtons']==['ALL','0–30','25–36'],chopper_view
    assert chopper_view['paramOrder']==['sampleBpm','samplePitch','sampleVolume','punchMode'],chopper_view
    assert chopper_view['wave']!='none' and 'samplerDisplayBody' in chopper_view['waveParent'],chopper_view
    assert chopper_view['pitchKnob']!='none' and chopper_view['tempoKnob']!='none' and chopper_view['volumeKnob']!='none',chopper_view
    assert chopper_view['punchKnob']=='none' and chopper_view['bpmInput']=='none',chopper_view
    assert chopper_view['pitchRole']=='slider' and chopper_view['bpmRole']=='slider' and chopper_view['volumeRole']=='slider' and chopper_view['punchRole']=='button',chopper_view
    assert 'sequenceActions' in chopper_view['saveParent'] and chopper_view['selected']==['chopper'],chopper_view

    touch_drag(page.locator('.samplePitchKnob .sampleKnobControl'),-36)
    touch_drag(page.locator('#mobileTempoKnob'),-30)
    touch_drag(page.locator('.sampleVolumeKnob .sampleKnobControl'),20)
    punch_target=page.locator('#punchDesc');px,py=touch_point(punch_target);page.touchscreen.tap(px,py);page.wait_for_timeout(60)
    rotary_values=page.evaluate('''() => ({
      pitch:document.getElementById('samplePitch').value,
      pitchText:document.getElementById('samplePitchReadout').textContent,
      bpm:document.getElementById('sampleBpm').value,
      bpmText:document.getElementById('sampleBpmReadout').textContent,
      volume:document.getElementById('sampleVolume').value,
      volumeText:document.getElementById('sampleVolumeReadout').textContent,
      punch:document.getElementById('punchMode').value,
      punchText:document.getElementById('punchDesc').textContent
    })''')
    assert rotary_values['pitch']=='2' and rotary_values['pitchText']=='+2 st',rotary_values
    assert rotary_values['bpm']=='100' and rotary_values['bpmText']=='100 BPM',rotary_values
    assert rotary_values['volume']=='70' and rotary_values['volumeText']=='70%',rotary_values
    assert rotary_values['punch']=='2' and rotary_values['punchText']=='KNOCK',rotary_values

    page.click('[data-mobile-workspace="sequence"]');page.wait_for_timeout(80)
    sequence_view=page.evaluate('''() => ({
      workspace:ChopperMobileControls.workspace,
      upper:getComputedStyle(document.querySelector('.samplerUpperDeck')).display,
      performance:getComputedStyle(document.querySelector('.samplerPerformanceDeck')).display,
      pads:getComputedStyle(document.querySelector('.samplerPadsModule')).display,
      sequence:getComputedStyle(document.querySelector('.samplerSequenceModule')).display,
      drums:getComputedStyle(document.querySelector('.samplerDrumSection')).display,
      footer:getComputedStyle(document.getElementById('mobileSequenceFooter')).display,
      transport:[...document.getElementById('mobileSequenceTransport').children].map(node=>node.id),
      saveParent:document.getElementById('addFlipLibrary').parentElement.id,
      save:getComputedStyle(document.getElementById('addFlipLibrary')).display,
      uniquePlay:document.querySelectorAll('#previewFlip').length,
      uniqueStop:document.querySelectorAll('#stopFlip').length,
      uniqueSave:document.querySelectorAll('#addFlipLibrary').length
    })''')
    assert sequence_view['workspace']=='sequence' and sequence_view['upper']=='none' and sequence_view['performance']!='none',sequence_view
    assert sequence_view['pads']=='none' and sequence_view['sequence']!='none' and sequence_view['drums']=='none',sequence_view
    assert sequence_view['footer']!='none' and sequence_view['transport']==['previewFlip','stopFlip'],sequence_view
    assert sequence_view['saveParent']=='mobileSequenceFooter' and sequence_view['save']!='none',sequence_view
    assert sequence_view['uniquePlay']==sequence_view['uniqueStop']==sequence_view['uniqueSave']==1,sequence_view

    page.click('[data-mobile-workspace="drums"]');page.wait_for_timeout(50)
    drums_view=page.evaluate('''() => ({
      workspace:ChopperMobileControls.workspace,
      upper:getComputedStyle(document.querySelector('.samplerUpperDeck')).display,
      performance:getComputedStyle(document.querySelector('.samplerPerformanceDeck')).display,
      drums:getComputedStyle(document.querySelector('.samplerDrumSection')).display,
      saveParent:document.getElementById('addFlipLibrary').parentElement.className
    })''')
    assert drums_view['workspace']=='drums' and drums_view['upper']=='none' and drums_view['performance']=='none',drums_view
    assert drums_view['drums']!='none' and 'sequenceActions' in drums_view['saveParent'],drums_view

    page.click('[data-mobile-workspace="pads"]');page.wait_for_timeout(50)
    pads_view=page.evaluate('''() => ({
      workspace:ChopperMobileControls.workspace,
      upper:getComputedStyle(document.querySelector('.samplerUpperDeck')).display,
      performance:getComputedStyle(document.querySelector('.samplerPerformanceDeck')).display,
      pads:getComputedStyle(document.querySelector('.samplerPadsModule')).display,
      sequence:getComputedStyle(document.querySelector('.samplerSequenceModule')).display,
      drums:getComputedStyle(document.querySelector('.samplerDrumSection')).display,
      wave:getComputedStyle(document.querySelector('.wavewrap')).display,
      waveParent:document.querySelector('.wavewrap').parentElement.className,
      transport:[...document.querySelector('.samplerPadsModule .padTransport').children].map(node=>node.id),
      saveParent:document.getElementById('addFlipLibrary').parentElement.className,
      waves:document.querySelectorAll('#waveCanvas').length
    })''')
    assert pads_view['workspace']=='pads' and pads_view['upper']=='none' and pads_view['performance']!='none',pads_view
    assert pads_view['pads']!='none' and pads_view['sequence']=='none' and pads_view['drums']=='none',pads_view
    assert pads_view['wave']!='none' and 'samplerPadsModule' in pads_view['waveParent'] and pads_view['waves']==1,pads_view
    assert pads_view['transport']==['previewFlip','playDrumsOnly','stopFlip'] and 'sequenceActions' in pads_view['saveParent'],pads_view

    pad=page.locator('#pads .pad').nth(5);x,y=touch_point(pad);page.touchscreen.tap(x,y)
    page.wait_for_function('chopAuditionPad === 5',timeout=3000)
    assert page.evaluate("document.querySelectorAll('#pads .pad.hit').length")==1
    page.evaluate('stopChopAudition()')

    open_pad_editor(5)
    held=page.evaluate('''() => {
      const w=document.getElementById('mobileChopWave').getBoundingClientRect(),p=document.getElementById('mobileChopPlayhead').getBoundingClientRect(),r=document.getElementById('mobileChopEditorRange').getBoundingClientRect();
      const save=document.getElementById('addFlipLibrary'),tabs=document.getElementById('chopperBankTabs');
      return {
        title:document.getElementById('mobileChopEditorTitle').textContent,
        workspace:getComputedStyle(document.getElementById('mobileChopWorkspace')).display,
        upper:getComputedStyle(document.querySelector('.samplerUpperDeck')).display,
        performance:getComputedStyle(document.querySelector('.samplerPerformanceDeck')).display,
        drums:getComputedStyle(document.querySelector('.samplerDrumSection')).display,
        mobileTabs:getComputedStyle(document.querySelector('.chopperMobileTabs')).display,
        w:w.width,h:w.height,playheadOverlay:p.width===w.width && p.height===w.height,above:w.bottom<=r.top+1,
        flag:document.getElementById('chopper').dataset.mobileChopView,audition:chopAuditionPad,
        saveInside:document.getElementById('mobileChopWorkspace').contains(save),
        bankParent:tabs.parentElement.id,bankVisible:getComputedStyle(tabs).display!=='none',
        bankButtons:[...tabs.querySelectorAll('.chopperBankTab')].map(button=>button.textContent)
      };
    }''')
    assert held['title']=='CHOP 06 / 16 • MARKERS' and held['workspace']!='none' and held['flag']=='1',held
    assert held['upper']=='none' and held['performance']=='none' and held['drums']=='none' and held['mobileTabs']!='none',held
    assert held['w']>340 and held['h']>=180 and held['playheadOverlay'] and held['above'],held
    assert held['audition']==-1 and page.evaluate('chopAuditionPad')==-1
    assert not held['saveInside'],held
    assert held['bankParent']=='mobileChopBankHost' and held['bankVisible'] and held['bankButtons']==['ALL','0–30','25–36'],held

    page.locator('#mobileChopBankHost .chopperBankTab').nth(1).click()
    page.wait_for_function('ChopperBanks.activeIndex === 1 && ChopperMobileSliceEditor.visible',timeout=3000)
    page.wait_for_timeout(80)
    bank_switch=page.evaluate('''() => ({
      active:ChopperBanks.active.label,
      pad:ChopperMobileSliceEditor.activePad,
      title:document.getElementById('mobileChopEditorTitle').textContent,
      start:markers[5],end:markers[6]
    })''')
    assert bank_switch['active']=='0–30' and bank_switch['pad']==5 and bank_switch['title']=='CHOP 06 / 16 • MARKERS',bank_switch
    assert 0<=bank_switch['start']<bank_switch['end']<=30,bank_switch
    page.locator('#mobileChopBankHost .chopperBankTab').nth(0).click()
    page.wait_for_function('ChopperBanks.activeIndex === 0 && ChopperMobileSliceEditor.visible',timeout=3000)
    page.wait_for_timeout(80)

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

    # The global mobile tabs remain usable from the dedicated trim editor.
    page.click('[data-mobile-workspace="sequence"]');page.wait_for_timeout(80)
    nav_seq=page.evaluate('''() => ({visible:ChopperMobileSliceEditor.visible,workspace:ChopperMobileControls.workspace,sequence:getComputedStyle(document.querySelector('.samplerSequenceModule')).display,saveParent:document.getElementById('addFlipLibrary').parentElement.id})''')
    assert not nav_seq['visible'] and nav_seq['workspace']=='sequence' and nav_seq['sequence']!='none' and nav_seq['saveParent']=='mobileSequenceFooter',nav_seq

    page.click('[data-mobile-workspace="pads"]');page.wait_for_timeout(50);open_pad_editor(5)
    page.click('[data-mobile-workspace="chopper"]');page.wait_for_timeout(80)
    nav_chopper=page.evaluate('''() => ({visible:ChopperMobileSliceEditor.visible,workspace:ChopperMobileControls.workspace,upper:getComputedStyle(document.querySelector('.samplerUpperDeck')).display})''')
    assert not nav_chopper['visible'] and nav_chopper['workspace']=='chopper' and nav_chopper['upper']!='none',nav_chopper

    page.click('[data-mobile-workspace="pads"]');page.wait_for_timeout(50);open_pad_editor(5)
    page.click('[data-mobile-workspace="drums"]');page.wait_for_timeout(80)
    nav_drums=page.evaluate('''() => ({visible:ChopperMobileSliceEditor.visible,workspace:ChopperMobileControls.workspace,drums:getComputedStyle(document.querySelector('.samplerDrumSection')).display})''')
    assert not nav_drums['visible'] and nav_drums['workspace']=='drums' and nav_drums['drums']!='none',nav_drums

    page.click('[data-mobile-workspace="pads"]');page.wait_for_timeout(50);open_pad_editor(5)
    assert page.locator('#mobileChopDone').inner_text()=='← CHOPS';page.click('#mobileChopDone')
    done=page.evaluate('''() => ({
      visible:ChopperMobileSliceEditor.visible,
      workspace:getComputedStyle(document.getElementById('mobileChopWorkspace')).display,
      activeWorkspace:ChopperMobileControls.workspace,
      performance:getComputedStyle(document.querySelector('.samplerPerformanceDeck')).display,
      pads:getComputedStyle(document.getElementById('pads')).display,
      tabs:getComputedStyle(document.querySelector('.chopperMobileTabs')).display,
      enabled:[...document.querySelectorAll('#pads .pad')].filter(p=>!p.disabled).length,
      flag:document.getElementById('chopper').dataset.mobileChopView||'',
      status:document.getElementById('chopStatus').textContent,
      saveParent:document.getElementById('addFlipLibrary').parentElement.className,
      bankParent:document.getElementById('chopperBankTabs').parentElement.id
    })''')
    assert not done['visible'] and done['workspace']=='none' and done['activeWorkspace']=='pads',done
    assert done['performance']!='none' and done['pads']!='none' and done['tabs']!='none' and done['enabled']==16 and done['flag']=='' and done['status']=='CHOP MODE • MARKERS',done
    assert 'sequenceActions' in done['saveParent'] and done['bankParent']=='mobileChopperBankRow',done

    marker_snapshot=page.evaluate('markers.slice()');page.evaluate("ChopperWaveSlices.setEditMode('slices')")
    page.wait_for_function("ChopperWaveSlices.mode === 'slices' && ChopperWaveSlices.slices.length === 4",timeout=3000)
    slice_before=page.evaluate('ChopperWaveSlices.slices[1].start');open_pad_editor(1)
    page.click('#mobileChopNext');page.wait_for_function('ChopperMobileSliceEditor.activePad === 2',timeout=2000);page.click('#mobileChopPrev');page.wait_for_function('ChopperMobileSliceEditor.activePad === 1',timeout=2000)
    page.click('[data-mobile-boundary="start"][data-mobile-delta="0.005"]');slice_after=page.evaluate('ChopperWaveSlices.slices[1].start')
    assert abs((slice_after-slice_before)-.005)<1e-6 and page.evaluate('markers.slice()')==marker_snapshot
    page.click('#mobileChopDone');assert not errors,errors
    page.close();context.close();browser.close()

print('OK: Chopper mobile — AUTO CHOP retired, ordered CHOPPER rows, shared SEQ transport/SAVE, rotary controls and navigable touch CHOP editor')