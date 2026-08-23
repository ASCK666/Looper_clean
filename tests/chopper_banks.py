from pathlib import Path
import math,re,struct,sys,tempfile,wave
try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIP: playwright is not installed');sys.exit(0)

ROOT=Path(__file__).resolve().parents[1]


def make_wav(path,duration=68.0,freq=137,sr=8000):
    n=int(duration*sr)
    with wave.open(str(path),'wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(sr)
        frames=bytearray()
        for i in range(n):
            t=i/sr
            # Continuous tone plus regular accents gives AUTO CHOP deterministic
            # transient candidates while keeping the fixture small (~1 MB).
            accent=.78 if i%(sr//2)<90 else .24
            value=accent*math.sin(2*math.pi*freq*t)
            frames += struct.pack('<h',int(max(-1,min(1,value))*32767))
        w.writeframes(frames)


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
        assert path.exists(),f'Runtime CSS missing from Chopper banks fixture: {value}'
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
        assert path.exists(),f'Runtime JS missing from Chopper banks fixture: {value}'
        return f'<script data-inline-from="{clean}">{path.read_text(encoding="utf-8")}</script>'

    html=re.sub(r'<script\b[^>]*\bsrc=["\'][^"\']+["\'][^>]*>\s*</script>',inline_script,html,flags=re.I)
    return html


with tempfile.TemporaryDirectory() as td, sync_playwright() as p:
    sample=Path(td)/'banked-68s.wav'
    make_wav(sample)
    browser=p.chromium.launch(
        headless=True,
        executable_path='/usr/bin/chromium',
        args=['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']
    )
    page=browser.new_page(viewport={'width':1280,'height':1200})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(inline_project(),wait_until='load',timeout=20000)
    page.wait_for_function('window.__SP && window.__SP.ready === true',timeout=10000)
    page.wait_for_function('window.ChopperWaveSlices && window.ChopperBanks',timeout=10000)
    page.click('[data-tab="chopper"]')
    page.set_input_files('#sampleFile',str(sample))
    page.wait_for_function('sampleBuffer && sampleBuffer.duration > 67 && ChopperBanks.banks.length === 4',timeout=15000)

    bank_meta=page.evaluate('''() => ({
      labels:ChopperBanks.banks.map(bank=>bank.label),
      ranges:ChopperBanks.banks.map(bank=>[bank.start,bank.end]),
      active:ChopperBanks.active,
      visible:!document.getElementById('chopperBankTabs').hidden,
      buttons:document.querySelectorAll('#chopperBankTabs .chopperBankTab').length,
      geometry:(() => {
        const wave=document.querySelector('#chopper .wavewrap').getBoundingClientRect();
        const tabs=document.getElementById('chopperBankTabs').getBoundingClientRect();
        return {waveBottom:wave.bottom,tabsTop:tabs.top};
      })()
    })''')
    assert bank_meta['labels']==['ALL','0–30','25–55','50–68'],bank_meta
    assert bank_meta['visible'] and bank_meta['buttons']==4,bank_meta
    assert bank_meta['active']['label']=='ALL',bank_meta
    assert bank_meta['geometry']['tabsTop'] >= bank_meta['geometry']['waveBottom']-2,bank_meta

    # ALL keeps its own marker/grid configuration.
    page.evaluate('''() => {
      ChopperWaveSlices.setEditMode('markers');
      moveMarker(1,2.25,false);
      loopGridEvents=new Array(CHOPPER_SEQUENCE_STEPS).fill(0);
      loopGridEvents[0]=1;
      renderLoopGrid();
    }''')
    all_marker=page.evaluate('markers[1]')

    # First 30-second window is fresh and constrained to 0..30.
    page.evaluate('ChopperBanks.selectBank(1)')
    first=page.evaluate('''() => ({
      bank:ChopperBanks.active,
      first:markers[0],last:markers[markers.length-1],
      view:viewWindow(),grid:loopGridEvents.slice()
    })''')
    assert abs(first['first'])<1e-6 and abs(first['last']-30)<1e-6,first
    assert abs(first['view']['start'])<1e-6 and abs(first['view']['end']-30)<1e-4,first
    assert all(value==0 for value in first['grid']),first
    page.evaluate('''() => {
      moveMarker(1,2.5,false);
      loopGridEvents[1]=2;
      renderLoopGrid();
    }''')

    # Overlapping window starts at 25 and does not inherit bank 1's sequence.
    page.evaluate('ChopperBanks.selectBank(2)')
    second=page.evaluate('''() => ({
      bank:ChopperBanks.active,
      first:markers[0],last:markers[markers.length-1],
      view:viewWindow(),grid:loopGridEvents.slice()
    })''')
    assert second['bank']['label']=='25–55',second
    assert abs(second['first']-25)<1e-6 and abs(second['last']-55)<1e-6,second
    assert abs(second['view']['start']-25)<1e-4 and abs(second['view']['end']-55)<1e-4,second
    assert all(value==0 for value in second['grid']),second

    # Returning restores the exact marker and sequence from each bank.
    page.evaluate('ChopperBanks.selectBank(1)')
    restored_first=page.evaluate('''() => ({marker:markers[1],grid:loopGridEvents.slice()})''')
    assert abs(restored_first['marker']-2.5)<1e-6,restored_first
    assert restored_first['grid'][1]==2 and restored_first['grid'][0]==0,restored_first
    page.evaluate('ChopperBanks.selectBank(0)')
    restored_all=page.evaluate('''() => ({marker:markers[1],grid:loopGridEvents.slice()})''')
    assert abs(restored_all['marker']-all_marker)<1e-6,restored_all
    assert restored_all['grid'][0]==1 and restored_all['grid'][1]==0,restored_all

    # SLICES is banked too: private slice edges survive a round trip and a new
    # bank starts with four ranges entirely inside its own 30-second window.
    page.evaluate('ChopperBanks.selectBank(1); ChopperWaveSlices.setEditMode("slices")')
    slices_one=page.evaluate('ChopperWaveSlices.slices')
    assert len(slices_one)==4 and all(0<=r['start']<r['end']<=30 for r in slices_one),slices_one
    assert page.evaluate("ChopperWaveSlices.setSliceBoundary(0,'end',6,{redraw:false})") is True
    assert abs(page.evaluate('ChopperWaveSlices.slices[0].end')-6)<1e-6

    page.evaluate('ChopperBanks.selectBank(2)')
    slices_two=page.evaluate('ChopperWaveSlices.slices')
    assert len(slices_two)==4 and all(25<=r['start']<r['end']<=55 for r in slices_two),slices_two
    page.evaluate('ChopperBanks.selectBank(1)')
    restored_slices=page.evaluate('ChopperWaveSlices.slices')
    assert abs(restored_slices[0]['end']-6)<1e-6,restored_slices

    # MARKERS rendering must stop at the active bank end. PAD 16 begins at 29s;
    # the rendered loop must therefore be silent well before 2s, even though the
    # physical source continues to 68s.
    render_tail=page.evaluate('''async () => {
      ChopperWaveSlices.setEditMode('markers');
      moveMarker(15,29,false);
      loopGridEvents=new Array(CHOPPER_SEQUENCE_STEPS).fill(0);
      loopGridEvents[0]=16;
      document.getElementById('punchMode').value='0';
      const vinyl=document.getElementById('vinylAmount');
      if(vinyl)vinyl.value='0';
      currentDrumSelection={
        mode:'off',patternId:'OFF',patternName:'OFF',
        kicks:[],snares:[],ghosts:[],hats:[],hatSteps:[],
        kickVelocity:{},snareVelocity:{},hatVelocity:{},kick:null,snare:null,hat:null
      };
      const rendered=await renderSequence(loopGridEvents,sampleBuffer,markers,samplePitchRate());
      const start=Math.floor(rendered.sampleRate*1.25);
      const end=Math.min(rendered.length,Math.floor(rendered.sampleRate*2.0));
      let peak=0;
      for(let channel=0;channel<rendered.numberOfChannels;channel++){
        const data=rendered.getChannelData(channel);
        for(let i=start;i<end;i++)peak=Math.max(peak,Math.abs(data[i]));
      }
      return {peak,duration:rendered.duration,bank:ChopperBanks.active};
    }''')
    assert render_tail['bank']['label']=='0–30',render_tail
    assert render_tail['peak']<.002,render_tail

    assert not errors,errors
    page.close();browser.close()

print('OK: Chopper banks — production script order, ALL + overlapping 30s windows, independent MARKERS/SLICES/grid state and bank-limited rendering')
