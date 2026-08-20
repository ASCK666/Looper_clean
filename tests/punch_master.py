from pathlib import Path
import re, sys
try:
    from playwright.sync_api import sync_playwright
except Exception:
    print("SKIP: playwright is not installed")
    sys.exit(0)

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

chromium='/usr/bin/chromium'
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=chromium,args=['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required'])

    for width in [390,520,621,700,820,980,1024,1240,1440]:
        page=browser.new_page(viewport={'width':width,'height':1900})
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(html,wait_until='load',timeout=20000)
        page.wait_for_function('window.__SP && window.__SP.ready === true',timeout=10000)
        page.add_style_tag(content='*,*::before,*::after{animation:none!important;transition:none!important}')
        page.click('[data-tab="chopper"]')
        page.wait_for_timeout(40)
        page.locator('#punchMode').scroll_into_view_if_needed()
        page.wait_for_timeout(20)
        geo=page.evaluate("""() => {
          const volume=document.querySelector('.sampleVolumeKnob').getBoundingClientRect();
          const punch=document.querySelector('.punchKnob').getBoundingClientRect();
          const punchInput=document.querySelector('#punchMode').getBoundingClientRect();
          const reverb=document.querySelector('.drumReverbKnob').getBoundingClientRect();
          const newDrums=document.querySelector('#newDrums').getBoundingClientRect();
          const punchHit=document.elementFromPoint(punchInput.left+punchInput.width/2,punchInput.top+punchInput.height/2);
          return {
            volume:volume.toJSON(),punch:punch.toJSON(),reverb:reverb.toJSON(),newDrums:newDrums.toJSON(),
            punchHit:punchHit&&punchHit.id
          };
        }""")
        assert geo['punchHit']=='punchMode', (width,geo)
        # PUNCH belongs to the sample header immediately after SAMPLE VOL.
        assert geo['punch']['left'] >= geo['volume']['right']-2, (width,geo)
        assert geo['punch']['top'] < geo['volume']['bottom'] and geo['punch']['bottom'] > geo['volume']['top'], (width,geo)
        # NEW DRUMS remains directly beside the REVERB knob in the editor action row.
        assert geo['newDrums']['left'] >= geo['reverb']['right']-2, (width,geo)
        assert geo['newDrums']['top'] < geo['reverb']['bottom'] and geo['newDrums']['bottom'] > geo['reverb']['top'], (width,geo)

        # Hit-test REVERB only after scrolling it into the viewport. At narrow
        # widths it sits below the fold while PUNCH remains in the sample header.
        page.locator('#snareReverbMix').scroll_into_view_if_needed()
        page.wait_for_timeout(20)
        reverb_hit=page.evaluate("""() => {
          const r=document.querySelector('#snareReverbMix').getBoundingClientRect();
          const e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
          return e&&e.id;
        }""")
        assert reverb_hit=='snareReverbMix', (width,reverb_hit)

        page.locator('#masterVolume').scroll_into_view_if_needed()
        page.wait_for_timeout(20)
        master_hit=page.evaluate("""() => {
          const r=document.querySelector('#masterVolume').getBoundingClientRect();
          const e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
          return e&&e.id;
        }""")
        assert master_hit=='masterVolume', (width,master_hit)
        assert not errors, errors
        page.close()

    page=browser.new_page(viewport={'width':1440,'height':1700})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html,wait_until='load',timeout=20000)
    page.wait_for_function('window.__SP && window.__SP.ready === true',timeout=10000)
    page.click('[data-tab="chopper"]')
    assert page.locator('#masterVuVertical').count()==0
    assert page.locator('#vu').count()==1

    page.evaluate('ensureAudio()')
    box=page.locator('#masterVolume').bounding_box()
    assert box and box['width']>20 and box['height']>20
    before=float(page.input_value('#masterVolume'))
    y=box['y']+box['height']/2
    page.mouse.move(box['x']+box['width']*.8,y)
    page.mouse.down()
    page.mouse.move(box['x']+box['width']*.2,y,steps=5)
    page.mouse.up()
    page.wait_for_timeout(100)
    after=float(page.input_value('#masterVolume'))
    assert after != before, (before,after)
    gain=page.evaluate('liveBus.gain.value')
    assert abs(gain-after/100) < .015, (after,gain)

    result=page.evaluate("""async () => {
      await ensureAudio();
      sampleBuffer=ctx.createBuffer(2,44100*2,44100);
      for(let c=0;c<2;c++){
        const d=sampleBuffer.getChannelData(c);
        for(let i=0;i<d.length;i++){
          const t=i/44100;
          let v=.72*Math.sin(2*Math.PI*110*t)+.26*Math.sin(2*Math.PI*440*t);
          if(i%11025<50)v+=.8*Math.exp(-(i%11025)/12);
          d[i]=Math.max(-.99,Math.min(.99,v));
        }
      }
      sampleName='punch-test.wav';
      markers=[0,.5,1,1.5];
      sampleConditionProfile={label:'CLEAN',trimDb:0,highPassHz:30,bodyCutDb:0,rmsDb:-10,crestDb:10,peakDb:-.1,clippingRatio:0,lowMidRatio:0};
      document.getElementById('sampleBpm').value='90';
      currentDrumSelection={
        mode:'off',patternId:'OFF',patternName:'OFF',
        kicks:[],snares:[],ghosts:[],hats:[],hatSteps:[],
        kickVelocity:{},snareVelocity:{},hatVelocity:{},kick:null,snare:null,hat:null
      };
      const ev=Array(16).fill(0); ev[0]=1; ev[4]=2; ev[8]=3; ev[12]=1;
      const stats={};
      const modes=[['off','0'],['warm','1'],['knock','2'],['hard','3']];
      for(const [name,value] of modes){
        document.getElementById('punchMode').value=value;
        const b=await renderSequence(ev,sampleBuffer,markers,samplePitchRate());
        let sum=0,peak=0,n=0,checksum=0;
        for(let c=0;c<b.numberOfChannels;c++){
          const d=b.getChannelData(c);
          for(let i=0;i<d.length;i++){
            const a=Math.abs(d[i]); peak=Math.max(peak,a); sum+=d[i]*d[i]; n++;
            if(i<8192)checksum+=a*(i+1)*(c+1);
          }
        }
        stats[name]={rms:Math.sqrt(sum/n),peak,checksum};
      }
      return stats;
    }""")
    assert abs(result['off']['checksum']-result['warm']['checksum']) > 100, result
    assert abs(result['warm']['checksum']-result['knock']['checksum']) > 10, result
    assert abs(result['knock']['checksum']-result['hard']['checksum']) > 1, result

    page.evaluate("renderedFlip={stale:true}; isLoopPlaying=false")
    page.evaluate("""() => {
      const el=document.getElementById('punchMode');
      el.value='2';
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
    }""")
    page.wait_for_timeout(50)
    assert page.evaluate('renderedFlip===null') is True
    assert page.locator('#punchDesc').inner_text() == 'KNOCK'
    assert 'PUNCH KNOCK' in page.locator('#chopStatus').inner_text().upper()

    assert not errors, errors
    page.close()
    browser.close()

print('OK: PUNCH/MASTER — PUNCH beside SAMPLE VOL, REVERB beside NEW DRUMS, clickable controls, real master gain and four real audio preset differences')
