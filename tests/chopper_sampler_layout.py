from pathlib import Path
import re, sys
try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIP: playwright is not installed');sys.exit(0)

ROOT=Path(__file__).resolve().parents[1]
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
          const firstPad=document.querySelector('#pads .pad');
          const idlePadShadow=firstPad?getComputedStyle(firstPad).boxShadow:'';
          if(firstPad)firstPad.classList.add('active');
          const activePadShadow=firstPad?getComputedStyle(firstPad).boxShadow:'';
          if(firstPad)firstPad.classList.remove('active');
          return {
            upperChildren:[...upper.children].map(x=>x.classList.contains('samplerScreenModule')?'screen':'other'),
            controlCount:document.querySelectorAll('.samplerControlModule').length,
            actionOrder:ids('#chopper .chopperActionStrip > .btn'),
            actions:boxes('#chopper .chopperActionStrip > .btn'),
            actionStrip:box('.chopperActionStrip'),
            fine:box('.advancedBox'),
            title:box('.samplerScreenModule > .stableTitle'),
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
            idlePadShadow,
            activePadShadow,
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
        assert data['controlCount']==0,data
        assert data['actionOrder']==['loadSampleBtn','autoMarkers','playDrumsOnly','previewFlip','stopFlip','addFlipLibrary'],data
        assert data['fine']['top']>=data['actionStrip']['bottom']-2,data
        assert data['descriptions']==0,data
        assert data['currentDisplay']=='none',data
        assert data['editorBorder']=='0px' and data['gridWrapBorder']=='0px',data
        assert data['chopStatusText']=='' and data['chopStatusHidden'] is True,data
        assert data['padCount']==16,data
        assert data['idlePadShadow']!='none' and data['activePadShadow']!='none',data
        assert data['idlePadShadow']!=data['activePadShadow'],data

        if width>=820:
            first=data['actions'][0]
            last=data['actions'][-1]
            assert all(a['top']<first['bottom'] and a['bottom']>first['top'] for a in data['actions']),data
            assert first['id']=='loadSampleBtn' and first['left']<=min(a['left'] for a in data['actions'])+1,data
            assert last['id']=='addFlipLibrary' and last['right']>=max(a['right'] for a in data['actions'])-1,data

        # Header row: title | pitch | tempo | sample volume | punch.
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

print('OK: Chopper sampler layout — no idle READY, amber pad backlight, clean chrome and responsive layout')
