from pathlib import Path
import sys

from browser_fixture import inline_runtime_page

try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIP: playwright is not installed');sys.exit(0)

ROOT=Path(__file__).resolve().parents[1]
SOURCE_ASSET_NAME='looper66-desktop-transport-square-3d62809d.webp'
BUTTON_ASSET_NAME='chopper-looper-button-off-alpha-6920266c.webp'
source_asset=ROOT/'assets/looper-ui'/SOURCE_ASSET_NAME
button_asset=ROOT/'assets/looper-ui'/BUTTON_ASSET_NAME
assert source_asset.exists(),f'Missing Looper source transport asset: {source_asset}'
assert button_asset.exists(),f'Missing isolated Chopper button asset: {button_asset}'

html=inline_runtime_page()
asset_css=(ROOT/'css/chopper-drum-controls.css').read_text(encoding='utf-8')
assert BUTTON_ASSET_NAME in asset_css,'Chopper pads/transport must use the isolated transparent Looper-derived button artwork'
assert SOURCE_ASSET_NAME not in asset_css,'Chopper must not use the complete Looper transport sprite as a button texture'
assert '--chopper-looper-button-art' in asset_css
assert 'center/227.273% 100%' not in asset_css,'Legacy Looper light-crop sizing must not be used as Chopper button artwork'
assert 'filter: sepia(.05) saturate(.64) brightness(.82) !important;' in asset_css,'Missing neutral pad filter state'
assert 'filter: sepia(.36) saturate(1.35) brightness(1.18) !important;' in asset_css,'Missing lit pad hit state'

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    for width,height in [(1440,1200),(820,1200),(520,1400),(390,1500)]:
        page=browser.new_page(viewport={'width':width,'height':height})
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(html,wait_until='load',timeout=20000)
        page.wait_for_function('window.__SP && window.__SP.ready === true',timeout=10000)
        page.add_style_tag(content='*,*::before,*::after{animation:none!important;transition:none!important}')
        page.click('[data-tab="chopper"]')
        page.wait_for_timeout(80)

        data=page.evaluate('''() => {
          const box=s=>document.querySelector(s).getBoundingClientRect().toJSON();
          const boxes=sel=>[...document.querySelectorAll(sel)].map(x=>({id:x.id,...x.getBoundingClientRect().toJSON()}));
          const ids=sel=>[...document.querySelectorAll(sel)].map(x=>x.id);
          const upper=document.querySelector('.samplerUpperDeck');
          const wrap=document.querySelector('.loopGridWrap');
          const current=getComputedStyle(document.querySelector('.currentDrums'));
          const editor=getComputedStyle(document.querySelector('.drumEditBox'));
          const gridWrap=getComputedStyle(wrap);
          const chopStatus=document.querySelector('#chopStatus');
          const pads=document.querySelector('#pads');
          const padsStyle=getComputedStyle(pads);
          const padsPanel=document.querySelector('.samplerPadsModule');
          const padsPanelStyle=getComputedStyle(padsPanel);
          const firstPad=document.querySelector('#pads .pad');
          if(firstPad){
            firstPad.classList.remove('unavailable');
            firstPad.disabled=false;
          }
          const firstPadStyle=firstPad?getComputedStyle(firstPad):null;
          const firstPadAfter=firstPad?getComputedStyle(firstPad,'::after'):null;
          const firstTransport=document.querySelector('.padTransport .btn');
          const firstTransportStyle=firstTransport?getComputedStyle(firstTransport):null;
          const firstTransportAfter=firstTransport?getComputedStyle(firstTransport,'::after'):null;
          const idlePadFilter=firstPadStyle?.filter||'';
          if(firstPad)firstPad.classList.add('hit');
          const hitClassApplied=Boolean(firstPad?.classList.contains('hit'));
          const activePadFilter=firstPad?getComputedStyle(firstPad).filter:'';
          if(firstPad)firstPad.classList.remove('hit');
          return {
            upperChildren:[...upper.children].map(x=>x.classList.contains('samplerScreenModule')?'screen':'other'),
            controlCount:document.querySelectorAll('.samplerControlModule').length,
            oldActionStripCount:document.querySelectorAll('.chopperActionStrip').length,
            waveActionOrder:ids('#chopper .waveHeaderActions > .btn'),
            padTransportOrder:ids('#chopper .padTransport > .btn'),
            sequenceActionOrder:ids('#chopper .sequenceActions > .btn'),
            waveActions:boxes('#chopper .waveHeaderActions > .btn'),
            padActions:boxes('#chopper .padTransport > .btn'),
            sequenceActions:boxes('#chopper .sequenceActions > .btn'),
            waveActionGroup:box('.waveHeaderActions'),
            padTransport:box('.padTransport'),
            sequenceActionGroup:box('.sequenceActions'),
            padsPanel:box('.samplerPadsModule'),
            sequencePanel:box('.samplerSequenceModule'),
            fine:box('.advancedBox'),
            title:box('.samplerScreenModule > .stableTitle'),
            titleText:document.querySelector('.samplerScreenModule > .stableTitle').textContent,
            pitch:box('.samplePitchKnob'),
            tempo:box('.sampleTempoControl'),
            volume:box('.sampleVolumeKnob'),
            punch:box('.punchKnob'),
            wave:box('.samplerScreen'),
            punchType:document.querySelector('#punchMode').type,
            punchValue:document.querySelector('#punchMode').value,
            punchPct:getComputedStyle(document.querySelector('.punchKnob')).getPropertyValue('--knob-pct').trim(),
            descriptions:document.querySelectorAll('#chopper .samplerTopRail,#chopper .sampleConditionHelp,#chopper .samplerModuleHint,#chopper .spaceHint,#chopper .samplerControlLegend,#chopper .drumEditHead .help,#chopper .titleMeta').length,
            currentDisplay:current.display,
            editorBorder:editor.borderTopWidth,
            gridWrapBorder:gridWrap.borderTopWidth,
            chopStatusText:chopStatus.textContent.trim(),
            chopStatusHidden:chopStatus.hidden,
            padCount:document.querySelectorAll('#pads .pad').length,
            padsPanelBorder:padsPanelStyle.borderTopWidth,
            padsPanelShadow:padsPanelStyle.boxShadow,
            padBackground:firstPadStyle?.backgroundImage||'',
            padBorder:firstPadStyle?.borderTopWidth||'',
            padShadow:firstPadStyle?.boxShadow||'',
            padCounterReset:padsStyle?.counterReset||'',
            padNumber:firstPadAfter?.content||'',
            idlePadFilter,
            hitClassApplied,
            activePadFilter,
            transportBackground:firstTransportStyle?.backgroundImage||'',
            transportBorder:firstTransportStyle?.borderTopWidth||'',
            transportShadow:firstTransportStyle?.boxShadow||'',
            transportLabel:firstTransportAfter?.content||'',
            timeline:box('#sampleTimelineCanvas'),
            matrix:box('#loopGrid'),
            preview:box('#drumPatternPreview'),
            firstHead:box('#loopGrid .matrixHead'),
            firstPreview:box('#drumPatternPreview .drumPatternPreviewPair'),
            wrapScrollWidth:wrap.scrollWidth,
            wrapClientWidth:wrap.clientWidth,
            bodyW:document.body.scrollWidth,
            viewportW:innerWidth
          };
        }''')

        assert data['upperChildren']==['screen'],data
        assert data['controlCount']==0 and data['oldActionStripCount']==0,data
        assert data['waveActionOrder']==['loadSampleBtn','autoMarkers'],data
        assert data['padTransportOrder']==['previewFlip','playDrumsOnly','stopFlip'],data
        assert data['sequenceActionOrder']==['addFlipLibrary','clearGrid'],data
        assert 'SAMPLE DISPLAY' not in data['titleText'],data
        assert data['fine']['bottom']<=data['title']['top']+2,data
        assert data['descriptions']==0,data
        assert data['currentDisplay']=='none',data
        assert data['editorBorder']=='0px' and data['gridWrapBorder']=='0px',data
        assert data['chopStatusText']=='' and data['chopStatusHidden'] is True,data
        assert data['padCount']==16,data

        # Asset UI contract: no CSS-drawn pad/panel frame. The isolated neutral
        # Looper-derived artwork supplies physical chrome; runtime uses .hit for
        # the lit pad state while the CSS source owns its distinct filter values.
        assert data['padsPanelBorder']=='0px' and data['padsPanelShadow']=='none',data
        assert BUTTON_ASSET_NAME in data['padBackground'],data
        assert data['padBorder']=='0px' and data['padShadow']=='none',data
        assert 'chopper-pad' in data['padCounterReset'],data
        assert 'counter(chopper-pad' in data['padNumber'],data
        assert data['hitClassApplied'] is True,data
        assert BUTTON_ASSET_NAME in data['transportBackground'],data
        assert data['transportBorder']=='0px' and data['transportShadow']=='none',data
        assert 'PLAY' in data['transportLabel'],data

        # The transport stays attached to the pad panel and SAVE/CLEAR to sequence.
        assert data['padTransport']['top']>=data['padsPanel']['top']-1,data
        assert data['padTransport']['bottom']<=data['padsPanel']['bottom']+1,data
        assert data['sequenceActionGroup']['top']>=data['sequencePanel']['top']-1,data
        assert data['sequenceActionGroup']['bottom']<=data['sequencePanel']['bottom']+1,data

        if width>=820:
            for actions in [data['waveActions'],data['padActions'],data['sequenceActions']]:
                first=actions[0]
                assert all(a['top']<first['bottom'] and a['bottom']>first['top'] for a in actions),data

        # Header row: waveform actions | pitch | tempo | sample volume | punch.
        assert data['title']['right']<=data['pitch']['left']+2,data
        assert data['pitch']['right']<=data['tempo']['left']+2,data
        assert data['tempo']['right']<=data['volume']['left']+2,data
        assert data['volume']['right']<=data['punch']['left']+2,data
        for item in ['pitch','tempo','volume','punch']:
            assert data[item]['top']<data['title']['bottom'] and data[item]['bottom']>data['title']['top'],data
        header_bottom=max(data[x]['bottom'] for x in ['title','pitch','tempo','volume','punch'])
        assert data['wave']['top']>=header_bottom-2,data
        assert data['wave']['left']<=data['title']['left']+2,data
        assert data['wave']['right']>=data['punch']['right']-2,data
        assert data['punchType']=='range' and data['punchValue']=='1',data
        assert abs(float(data['punchPct'])-(100/3))<.1,data

        page.fill('#punchMode','3')
        page.dispatch_event('#punchMode','input')
        state=page.evaluate('''() => ({
          pct:getComputedStyle(document.querySelector('.punchKnob')).getPropertyValue('--knob-pct').trim(),
          label:document.querySelector('#punchDesc').textContent
        })''')
        assert abs(float(state['pct'])-100)<.01,state
        assert state['label']=='HARD',state

        # Timeline, Chopper matrix and drum preview share one ruler and scroll origin.
        assert abs(data['timeline']['left']-data['matrix']['left'])<1.5,data
        assert abs(data['matrix']['left']-data['preview']['left'])<1.5,data
        assert abs(data['timeline']['right']-data['matrix']['right'])<1.5,data
        assert abs(data['matrix']['right']-data['preview']['right'])<1.5,data
        assert abs(data['firstHead']['left']-data['firstPreview']['left'])<1.5,data
        assert data['wrapScrollWidth']>=data['wrapClientWidth'],data
        assert data['bodyW']<=data['viewportW']+2,data
        assert not errors,errors
        page.close()

    browser.close()

print('OK: Chopper sampler layout — isolated transparent Looper-derived button asset, no CSS frame lines, responsive workflow layout')