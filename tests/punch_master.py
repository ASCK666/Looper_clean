import sys

from browser_fixture import inline_runtime_page

try:
    from playwright.sync_api import sync_playwright
except Exception:
    print("SKIP: playwright is not installed")
    sys.exit(0)


html=inline_runtime_page(
    preload_before={
        'js/chopper-wave-slices.js': (
            'js/chopper-mobile-controls.js', 'js/chopper-mobile-slice-editor.js',
            'js/sp1200.js', 'js/chopper-sp1200.js',
        ),
    }
)

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
        assert page.locator('#vinylAmount,.vinylKnob').count()==0
        if width<=760:
            control=page.locator('#punchDesc')
            assert control.get_attribute('role')=='button'
            for label in ['KNOCK','HARD','OFF','WARM']:
                control.click()
                assert control.inner_text()==label
                assert page.evaluate('punchSettings().mode')==label.lower()
            control.press('Enter')
            assert control.inner_text()=='KNOCK'
        else:
            control=page.locator('#punchMode')
            control.focus()
            control.press('End')
            assert page.locator('#punchDesc').inner_text()=='HARD'
            control.press('Home')
            assert page.locator('#punchDesc').inner_text()=='OFF'

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

    assert page.locator('#vinylAmount,.vinylKnob').count()==0

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

      return {stats};
    }""")
    stats=result['stats']
    assert abs(stats['off']['checksum']-stats['warm']['checksum']) > 100, stats
    assert abs(stats['warm']['checksum']-stats['knock']['checksum']) > 10, stats
    assert abs(stats['knock']['checksum']-stats['hard']['checksum']) > 1, stats
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

print('OK: PUNCH — desktop keyboard/mobile controls, fixed output gain, four distinct presets and preview invalidation; VINYL retired')
