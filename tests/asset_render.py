from pathlib import Path
import contextlib, http.server, os, socketserver, sys, threading, tempfile, wave

try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIP: playwright is not installed')
    raise SystemExit(0)

ROOT=Path(__file__).resolve().parents[1]
ARTIFACTS=ROOT/'test-artifacts'
ARTIFACTS.mkdir(exist_ok=True)

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_args): pass

with contextlib.ExitStack() as stack:
    handler=lambda *a,**kw: QuietHandler(*a,directory=str(ROOT),**kw)
    server=socketserver.TCPServer(('127.0.0.1',0),handler)
    stack.callback(server.server_close)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    stack.callback(server.shutdown)

    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
        page=browser.new_page(viewport={'width':1536,'height':1200},device_scale_factor=1)
        page_errors=[]; failed=[]
        page.on('pageerror',lambda err:page_errors.append(str(err)))
        page.on('requestfailed',lambda req:failed.append(f'{req.url}: {req.failure}'))
        page.goto(f'http://127.0.0.1:{server.server_address[1]}/index.html',wait_until='networkidle',timeout=30000)
        page.wait_for_function('window.__SP?.ready === true',timeout=10000)
        page.wait_for_function("document.querySelectorAll('.cassetteReel').length === 2",timeout=10000)
        page.wait_for_function("""() => {
          const bay=document.querySelector('.cassetteBayForeground');
          return bay instanceof HTMLImageElement && bay.complete && bay.naturalWidth===793 && bay.naturalHeight===496;
        }""",timeout=10000)

        info=page.evaluate('''() => {
          const ids=['prevBeat','playBeat','stopBeat','nextBeat','autoLooperToggle','deckAutoToggle','deckPitch','importFolderBtn','importBeatsBtn'];
          const rect=id=>document.getElementById(id).getBoundingClientRect().toJSON();
          return {
            appErrors:window.__SP.errors,
            bay:(()=>{
              const image=document.querySelector('.cassetteBayForeground');
              return {tag:image.tagName,complete:image.complete,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,src:image.getAttribute('src')};
            })(),
            layers:[...document.querySelectorAll('.cassetteMechanism > *')].map(layer=>[layer.className,getComputedStyle(layer).zIndex]),
            controls:ids.map(id=>({id,...rect(id),display:getComputedStyle(document.getElementById(id)).display})),
            transport:['stopBeat','playBeat','autoLooperToggle'].map(rect),
            mechanism:rect('looperDropzoneBtn'),
            reels:[...document.querySelectorAll('.cassetteReel')].map(reel=>reel.getBoundingClientRect().toJSON()),
            workspace:document.querySelector('.looper66Workspace').getBoundingClientRect().toJSON(),
            transportOrder:[...document.querySelectorAll('.deckTransport > button')].map(button=>button.id),
            readoutRateFontSize:parseFloat(getComputedStyle(document.querySelector('.deckReadoutRate')).fontSize),
            transportStyles:['stopBeat','playBeat','autoLooperToggle'].map(id=>{
              const style=getComputedStyle(document.getElementById(id));
              return {background:style.backgroundColor,backgroundImage:style.backgroundImage,boxShadow:style.boxShadow};
            }),
            rackSlots:document.querySelectorAll('.cassetteRackSlot').length,
            title:document.getElementById('cassetteBeatName').textContent,
            skin:document.querySelector('.looper66Skin img').getAttribute('src'),
            emptyPlayAnimation:getComputedStyle(document.querySelector('#playBeat'),'::before').animationName
          };
        }''')
        assert len(info['layers'])==6,info
        assert [layer[0] for layer in info['layers']]==[
            'cassetteReel cassetteReelLeft','cassetteReel cassetteReelRight',
            'cassetteBeatName','cassetteBayForeground',
            'cassetteCssLight','cassetteGlass'
        ],info
        assert info['bay']=={
            'tag':'IMG','complete':True,'naturalWidth':793,'naturalHeight':496,
            'src':'assets/looper-ui/looper66-cassette-bay-d7d5e6d4.png'
        },info
        assert all(c['display']!='none' and c['width']>=44 and c['height']>=44 for c in info['controls']),info
        stop,play,speed=info['transport']
        assert abs(stop['width']-speed['width'])<1 and abs(stop['height']-speed['height'])<1,info
        assert play['width']>stop['width']*1.5 and play['width']<stop['width']*1.7,info
        assert play['height']>stop['height'] and stop['width']/stop['height']<1.3,info
        assert info['transportOrder']==['stopBeat','playBeat','autoLooperToggle'],info
        assert info['readoutRateFontSize']<=27.01,info
        assert all('linear-gradient' in style['backgroundImage'] and 'inset' in style['boxShadow'] for style in info['transportStyles']),info
        transport_left=min(rect['x'] for rect in info['transport'])
        transport_right=max(rect['x']+rect['width'] for rect in info['transport'])
        cassette_left=info['workspace']['x']+info['workspace']['width']*.423
        cassette_right=cassette_left+info['workspace']['width']*.417
        assert abs(transport_left-cassette_left)<1 and abs(transport_right-cassette_right)<1,info
        expected_centers=((601,238),(763,238))
        for reel,(expected_x,expected_y) in zip(info['reels'],expected_centers):
          center_x=(reel['x']+reel['width']/2-info['workspace']['x'])/info['workspace']['width']*1086
          center_y=(reel['y']+reel['height']/2-info['workspace']['y'])/info['workspace']['height']*1009
          assert abs(center_x-expected_x)<1 and abs(center_y-expected_y)<1,(center_x,center_y)
        assert info['rackSlots']==9,info
        assert info['title']=='AUCUN BEAT CHARGÉ' and info['skin'].endswith('looper66-desktop-pitch-clean-1e6d4f36.webp'),info
        assert info['emptyPlayAnimation']=='none',info
        assert page.locator('.cassetteBeatName').evaluate('(el)=>getComputedStyle(el).opacity')=='0'
        assert page.locator('.cassetteReelLeft').evaluate('(el)=>getComputedStyle(el).opacity')=='0'
        assert not info['appErrors'] and not page_errors and not failed,(info['appErrors'],page_errors,failed)

        page.locator('#looper').screenshot(path=str(ARTIFACTS/'looper66-render.png'))
        page.screenshot(path=str(ARTIFACTS/'looper66-full-render.png'),full_page=True)
        # Exercise real transport transitions and rate-driven animation at each
        # layout size; screenshots are uploaded by the existing CI workflow.
        for width,height in [(1440,1100),(820,1000),(390,900)]:
            page.set_viewport_size({'width':width,'height':height})
            page.evaluate('''() => {
              stopDeck();
              deckBuffer=null;
              refreshCassetteUI();
            }''')
            page.wait_for_function("Number(getComputedStyle(document.querySelector('.cassetteCssLight')).opacity)<.01")
            page.locator('.cassetteMechanism').screenshot(path=str(ARTIFACTS/f'cabinet-empty-{width}.png'))
            page.evaluate('''() => {
              commitLoadedTrack({name:'CABINET TEST'},new AudioBuffer({length:44100,sampleRate:44100,numberOfChannels:1}));
            }''')
            page.wait_for_function("Math.abs(Number(getComputedStyle(document.querySelector('.cassetteCssLight')).opacity)-.3)<.01")
            page.locator('#stopBeat').focus()
            page.keyboard.press('Tab')
            assert page.locator('#playBeat').evaluate("el=>el===document.activeElement && el.matches(':focus-visible')")
            assert page.locator('#playBeat').evaluate('(el)=>parseFloat(getComputedStyle(el).outlineWidth)')>=2
            page.keyboard.down('Space')
            page.wait_for_function("new DOMMatrix(getComputedStyle(document.querySelector('#playBeat')).transform).m42===2",timeout=3000)
            page.locator('.deckTransport').screenshot(path=str(ARTIFACTS/f'transport-pressed-{width}.png'))
            page.keyboard.up('Space')
            page.wait_for_function("Math.abs(Number(getComputedStyle(document.querySelector('.cassetteCssLight')).opacity)-.86)<.01")
            light=page.evaluate('''() => {
              const get=selector=>document.querySelector(selector);
              const lamp=get('.cassetteCssLight'),bay=get('.cassetteBayForeground');
              const l=lamp.getBoundingClientRect(),b=bay.getBoundingClientRect();
              const label=get('.cassetteBeatName').getBoundingClientRect();
              const glass=get('.cassetteGlass').getBoundingClientRect();
              const reel=get('.cassetteReel').getBoundingClientRect();
              return {inside:l.left>b.left&&l.right<b.right&&l.top>b.top&&l.bottom<b.bottom,
                labelClear:label.left>glass.left && label.right<glass.right && label.top>glass.top && label.bottom<reel.top,
                belowGlass:Number(getComputedStyle(lamp).zIndex)<Number(getComputedStyle(get('.cassetteGlass')).zIndex),
                belowFrame:Number(getComputedStyle(lamp).zIndex)<Number(getComputedStyle(bay).zIndex),
                states:[...document.querySelectorAll('.cassetteReel')].map(el=>getComputedStyle(el).animationPlayState)};
            }''')
            assert light['inside'] and light['belowGlass'] and light['belowFrame'],light
            assert light['labelClear'],(width,light)
            assert light['states']==['running','running'],light
            for hub in ('.cassetteReelLeft','.cassetteReelRight'):
                assert page.locator(hub).evaluate('(el)=>getComputedStyle(el).backgroundSize')=='auto, auto'
            assert page.locator('.cassetteReelLeft').evaluate('(el)=>getComputedStyle(el).opacity')=='1'
            assert page.locator('.cassetteBeatName').evaluate('(el)=>getComputedStyle(el).opacity')=='1'
            for pitch in (-8,0,8):
                page.evaluate('(value)=>setLooperPitch(value)',pitch)
                duration=float(page.locator('.cassetteReelLeft').evaluate('(el)=>getComputedStyle(el).animationDuration').removesuffix('s'))
                if pitch==-8:
                    slow_duration=duration
                elif pitch==8:
                    assert duration<slow_duration,(duration,slow_duration)
            before=page.locator('.cassetteReelLeft').evaluate('(el)=>getComputedStyle(el).transform')
            page.wait_for_timeout(180)
            after=page.locator('.cassetteReelLeft').evaluate('(el)=>getComputedStyle(el).transform')
            assert before!=after,(width,before,after)
            page.locator('.cassetteMechanism').screenshot(path=str(ARTIFACTS/f'cabinet-playing-{width}.png'))
            page.locator('#stopBeat').click()
            page.wait_for_function("Math.abs(Number(getComputedStyle(document.querySelector('.cassetteCssLight')).opacity)-.3)<.01")
            assert page.locator('.cassetteReelLeft').evaluate('(el)=>getComputedStyle(el).animationPlayState')=='paused'
            page.locator('.cassetteMechanism').screenshot(path=str(ARTIFACTS/f'cabinet-stopped-{width}.png'))
            # All five speed increments remain selectable and readable after
            # moving the indicators into the native keycap.
            for level in (1,2,3,4,5,0):
                page.locator('#autoLooperToggle').click()
                assert page.locator('#autoLooperToggle').get_attribute('data-speed-level')==str(level)
                lit=page.locator('.deckRateVisualSegments i').evaluate_all("els=>els.filter(el=>getComputedStyle(el).borderTopColor==='rgb(220, 167, 46)').length")
                assert lit==level,(width,level,lit)
                assert page.locator('#autoLooperToggle').get_attribute('aria-pressed')==('true' if level else 'false')
            page.locator('.deckTransport').screenshot(path=str(ARTIFACTS/f'transport-stopped-{width}.png'))
        assert not page_errors,page_errors
        # The native crate must represent real imports, including an empty
        # search and overflow beyond the first nine slots, at each viewport.
        with tempfile.TemporaryDirectory() as folder:
            paths=[]
            for i in range(11):
                path=Path(folder)/f'{i:02d} - Late night session with a deliberately long beat name.wav'
                with wave.open(str(path),'wb') as wav:
                    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(8000)
                    wav.writeframes(bytes(16000))
                paths.append(str(path))
            page.set_input_files('#beatFiles',paths)
            page.wait_for_function("document.querySelectorAll('#library .track').length===11")
            for width,height in [(1440,1100),(820,1000),(390,900)]:
                page.set_viewport_size({'width':width,'height':height})
                assert page.locator('#crateCount').inner_text()=='11 beats'
                assert page.locator('#library .trackMeta[aria-current="true"]').count()==1
                page.locator('#librarySearch').fill('no matching beat')
                page.wait_for_function("document.querySelector('#library').dataset.empty==='true'")
                assert 'Aucun résultat' in page.locator('#library').get_attribute('aria-label')
                page.locator('#librarySearch').fill('10 -')
                page.wait_for_function("document.querySelectorAll('#library .track').length===1")
                page.locator('#library .trackMeta').click()
                page.wait_for_function("document.querySelector('#cassetteBeatName').title.startsWith('10 -')")
                assert page.locator('#deckReadoutTrack').inner_text()==Path(paths[-1]).name.upper()
                page.locator('#deckReadoutTrack').click()
                page.wait_for_function("document.querySelector('#deckTrackDetails').matches(':popover-open')")
                assert page.locator('#deckFullTrackName').inner_text()==Path(paths[-1]).name
                assert page.locator('#deckFullTrackName').evaluate('(el)=>el.scrollWidth<=el.clientWidth')
                page.screenshot(path=str(ARTIFACTS/f'beat-title-{width}.png'))
                page.locator('#deckTrackDetails button').click()
                page.wait_for_function("!document.querySelector('#deckTrackDetails').matches(':popover-open')")
                page.locator('#deckReadoutTrack').focus()
                page.keyboard.press('Space')
                page.wait_for_function("document.querySelector('#deckTrackDetails').matches(':popover-open')")
                page.keyboard.press('Escape')
                page.wait_for_function("!document.querySelector('#deckTrackDetails').matches(':popover-open')")
                assert page.evaluate('deckSource===null')
                page.locator('#librarySearch').fill('')
                page.wait_for_function("document.querySelectorAll('#library .track').length===11")
                page.locator('#libraryOrder').select_option('recent')
                page.wait_for_function("document.querySelector('#library .trackMeta').title.startsWith('10 -')")
                geometry=page.evaluate('''() => {
                  const box=s=>document.querySelector(s).getBoundingClientRect();
                  const search=box('.beatCrateControls'),list=box('#library'),nav=box('.beatCrateTransport');
                  return {separate:search.bottom<=list.top && list.bottom<=nav.top,
                    overflow:document.body.scrollWidth<=innerWidth+2,
                    opaque:getComputedStyle(document.querySelector('#library')).backgroundColor!=='rgba(0, 0, 0, 0)',
                    cover:parseFloat(getComputedStyle(document.querySelector('.beatCratePanel'),'::before').width)>box('.looper66Workspace').width*.85};
                }''')
                assert all(geometry.values()),(width,geometry)
                page.locator('#looper').screenshot(path=str(ARTIFACTS/f'crate-loaded-{width}.png'))
                page.locator('#libraryOrder').select_option('name')
                page.wait_for_function("document.querySelector('#library .trackMeta').title.startsWith('00 -')")
                for button,prefix in [('#nextBeat','00 -'),('#prevBeat','10 -')]:
                    page.locator(button).scroll_into_view_if_needed()
                    before_scroll=page.evaluate('scrollY')
                    page.locator(button).click()
                    page.wait_for_function("prefix=>document.querySelector('#cassetteBeatName').title.startsWith(prefix)",arg=prefix)
                    page.wait_for_function('''() => {
                      const active=document.querySelector('#library .track.active');
                      if(!active)return false;
                      const item=active.getBoundingClientRect(),rack=document.querySelector('#library').getBoundingClientRect();
                      return item.left>=rack.left-1 && item.right<=rack.right+1 && item.top>=rack.top-1 && item.bottom<=rack.bottom+1;
                    }''')
                    assert abs(page.evaluate('scrollY')-before_scroll)<2
                if width<=680:
                    assert page.locator('#library').bounding_box()['height']>=360
                    assert page.evaluate('''() => {
                      const range=document.createRange();
                      range.selectNodeContents(document.querySelector('#deckReadoutTrack'));
                      return range.getBoundingClientRect().bottom<=document.querySelector('#deckReadoutHint').getBoundingClientRect().top;
                    }'''),'Mobile title overlaps playback status'
                    page.locator('#library').screenshot(path=str(ARTIFACTS/'crate-mobile-navigation.png'))
            assert not page_errors,page_errors
        page.emulate_media(reduced_motion='reduce')
        page.evaluate('''() => { stopDeck();deckBuffer=null;refreshCassetteUI(); }''')
        assert page.locator('.cassetteReelLeft').evaluate('(el)=>getComputedStyle(el).animationName')=='none'
        for pseudo in ('::before','::after'):
            assert page.locator('#playBeat').evaluate('(el,pseudo)=>getComputedStyle(el,pseudo).animationName',pseudo)=='none'
        browser.close()

print('OK: Looper66 desktop transport matches cassette width with dominant Play and symmetric side controls')
