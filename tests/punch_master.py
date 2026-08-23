from pathlib import Path
import re, sys
try:
    from playwright.sync_api import sync_playwright
except Exception:
    print("SKIP: playwright is not installed")
    sys.exit(0)

ROOT=Path(__file__).resolve().parents[1]


def inline_project():
    html=(ROOT/'index.html').read_text(encoding='utf-8')
    html=re.sub(r'<link\b[^>]*\brel=["\']manifest["\'][^>]*>','',html,flags=re.I)

    def inline_stylesheet(match):
        tag=match.group(0)
        rel=re.search(r'\brel=["\']([^"\']+)["\']',tag,flags=re.I)
        href=re.search(r'\bhref=["\']([^"\']+)["\']',tag,flags=re.I)
        if not rel or not href or 'stylesheet' not in rel.group(1).lower().split():
            return tag
        value=href.group(1)
        if value.startswith(('http://','https://','data:')):
            return tag
        clean=value.split('?',1)[0].split('#',1)[0]
        path=(ROOT/clean.lstrip('./')).resolve()
        assert path.exists(),f'Runtime CSS missing from punch master fixture: {value}'
        return f'<style data-inline-from="{clean}">{path.read_text(encoding="utf-8")}</style>'

    html=re.sub(r'<link\b[^>]*>',inline_stylesheet,html,flags=re.I)
    html=re.sub(r'src="assets/[^"]+"','src=""',html)

    def inline_script(match):
        tag=match.group(0)
        src=re.search(r'\bsrc=["\']([^"\']+)["\']',tag,flags=re.I)
        if not src:
            return tag
        value=src.group(1)
        if value.startswith(('http://','https://','data:')):
            return tag
        clean=value.split('?',1)[0].split('#',1)[0]
        path=(ROOT/clean.lstrip('./')).resolve()
        assert path.exists(),f'Runtime JS missing from punch master fixture: {value}'
        return f'<script data-inline-from="{clean}">{path.read_text(encoding="utf-8")}</script>'

    return re.sub(
        r'<script\b[^>]*\bsrc=["\'][^"\']+["\'][^>]*>\s*</script>',
        inline_script,
        html,
        flags=re.I
    )


html=inline_project()

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
          const vinyl=document.querySelector('.vinylKnob').getBoundingClientRect();
          const vinylInput=document.querySelector('#vinylAmount').getBoundingClientRect();
          const reverb=document.querySelector('.drumReverbKnob').getBoundingClientRect();
          const newDrums=document.querySelector('#newDrums').getBoundingClientRect();
          const punchHit=document.elementFromPoint(punchInput.left+punchInput.width/2,punchInput.top+punchInput.height/2);
          const vinylHit=document.elementFromPoint(vinylInput.left+vinylInput.width/2,vinylInput.top+vinylInput.height/2);
          return {
            volume:volume.toJSON(),punch:punch.toJSON(),vinyl:vinyl.toJSON(),reverb:reverb.toJSON(),newDrums:newDrums.toJSON(),
            punchHit:punchHit&&punchHit.id,vinylHit:vinylHit&&vinylHit.id
          };
        }""")
        assert geo['punchHit']=='punchMode', (width,geo)
        assert geo['vinylHit']=='vinylAmount', (width,geo)
        # PUNCH follows SAMPLE VOL; VINYL follows PUNCH on the same header row.
        assert geo['punch']['left'] >= geo['volume']['right']-2, (width,geo)
        assert geo['punch']['top'] < geo['volume']['bottom'] and geo['punch']['bottom'] > geo['volume']['top'], (width,geo)
        assert geo['vinyl']['left'] >= geo['punch']['right']-2, (width,geo)
        assert geo['vinyl']['top'] < geo['punch']['bottom'] and geo['vinyl']['bottom'] > geo['punch']['top'], (width,geo)
        # Desktop/tablet keeps NEW DRUMS beside REVERB. Phone uses the deliberate
        # second row so all four Drum controls fit without overlap.
        if width>430:
            assert geo['newDrums']['left'] >= geo['reverb']['right']-2, (width,geo)
            assert geo['newDrums']['top'] < geo['reverb']['bottom'] and geo['newDrums']['bottom'] > geo['reverb']['top'], (width,geo)
        else:
            assert geo['newDrums']['top'] >= geo['reverb']['bottom']+8, (width,geo)
            overlap_x=max(0,min(geo['newDrums']['right'],geo['reverb']['right'])-max(geo['newDrums']['left'],geo['reverb']['left']))
            overlap_y=max(0,min(geo['newDrums']['bottom'],geo['reverb']['bottom'])-max(geo['newDrums']['top'],geo['reverb']['top']))
            assert overlap_x<=0 or overlap_y<=0, (width,geo)

        page.locator('#snareReverbMix').scroll_into_view_if_needed()
        page.wait_for_timeout(20)
        reverb_hit=page.evaluate("""() => {
          const r=document.querySelector('#snareReverbMix').getBoundingClientRect();
          const e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
          return e&&e.id;
        }""")
        assert reverb_hit=='snareReverbMix', (width,reverb_hit)

        assert not errors, errors
        page.close()

    page=browser.new_page(viewport={'width':1440,'height':1700})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html,wait_until='load',timeout=20000)
    page.wait_for_function('window.__SP && window.__SP.ready === true',timeout=10000)
    page.click('[data-tab="chopper"]')
    assert page.locator('#masterVuVertical').count()==0
    assert page.locator('#masterVolume,#masterDb,#vu,#looperVu').count()==0

    vinyl=page.locator('#vinylAmount')
    assert vinyl.get_attribute('type')=='range'
    assert vinyl.get_attribute('min')=='0'
    assert vinyl.get_attribute('max')=='100'
    assert vinyl.get_attribute('step')=='1'
    assert vinyl.input_value()=='0'
    assert page.locator('#vinylAmountReadout').inner_text()=='OFF'
    settings=page.evaluate('ChopperVinyl.settings()')
    assert settings['amount']==0, settings

    page.evaluate('ensureAudio()')
    gain=page.evaluate('liveBus.gain.value')
    assert abs(gain-.85) < .001, gain

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
      document.getElementById('vinylAmount').value='0';
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

      // VINYL at zero must preserve the existing render path; at 65% it must
      // produce a measurably different master (tone + wow/flutter + surface noise).
      document.getElementById('punchMode').value='0';
      document.getElementById('vinylAmount').value='0';
      const dry=await renderSequence(ev,sampleBuffer,markers,samplePitchRate());
      document.getElementById('vinylAmount').value='65';
      const wet=await renderSequence(ev,sampleBuffer,markers,samplePitchRate());
      let diff=0,wetChecksum=0,dryChecksum=0,count=0;
      for(let c=0;c<dry.numberOfChannels;c++){
        const a=dry.getChannelData(c),b=wet.getChannelData(c);
        const n=Math.min(a.length,b.length,44100);
        for(let i=0;i<n;i++){
          const delta=a[i]-b[i];
          diff+=delta*delta;
          dryChecksum+=Math.abs(a[i])*(i+1)*(c+1);
          wetChecksum+=Math.abs(b[i])*(i+1)*(c+1);
          count++;
        }
      }
      return {stats,vinyl:{mse:diff/Math.max(1,count),dryChecksum,wetChecksum}};
    }""")
    stats=result['stats']
    assert abs(stats['off']['checksum']-stats['warm']['checksum']) > 100, stats
    assert abs(stats['warm']['checksum']-stats['knock']['checksum']) > 10, stats
    assert abs(stats['knock']['checksum']-stats['hard']['checksum']) > 1, stats
    assert result['vinyl']['mse'] > 1e-7, result['vinyl']
    assert abs(result['vinyl']['dryChecksum']-result['vinyl']['wetChecksum']) > 100, result['vinyl']

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

    page.evaluate("renderedFlip={stale:true}; isLoopPlaying=false")
    page.evaluate("""() => {
      const el=document.getElementById('vinylAmount');
      el.value='55';
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
    }""")
    page.wait_for_timeout(50)
    assert page.evaluate('renderedFlip===null') is True
    assert page.locator('#vinylAmountReadout').inner_text() == '55%'
    assert abs(float(page.evaluate("getComputedStyle(document.querySelector('.vinylKnob')).getPropertyValue('--knob-pct')"))-55)<.01
    page.fill('#vinylAmount','0')
    page.dispatch_event('#vinylAmount','input')
    assert page.locator('#vinylAmountReadout').inner_text() == 'OFF'

    assert not errors, errors
    page.close()
    browser.close()

print('OK: PUNCH/VINYL — compact knobs, fixed output gain, four PUNCH presets and deterministic boom-bap vinyl processing')
