from pathlib import Path
import contextlib, http.server, os, socketserver, sys, threading

try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIP: playwright is not installed')
    raise SystemExit(0)

ROOT=Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_args):
        pass


with contextlib.ExitStack() as stack:
    handler=lambda *a,**kw: QuietHandler(*a,directory=str(ROOT),**kw)
    server=socketserver.TCPServer(('127.0.0.1',0),handler)
    stack.callback(server.server_close)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    stack.callback(server.shutdown)
    url=f'http://127.0.0.1:{server.server_address[1]}/index.html'

    with sync_playwright() as p:
        browser=p.chromium.launch(
            headless=True,
            executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),
            args=['--no-sandbox','--disable-dev-shm-usage']
        )
        for width,height in [(1440,1200),(820,1200),(520,1400),(390,1500)]:
            page=browser.new_page(viewport={'width':width,'height':height})
            errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto(url,wait_until='networkidle',timeout=30000)
            page.wait_for_function('window.__SP?.ready === true',timeout=10000)
            page.click('[data-tab="chopper"]')
            if width<=760:
                page.wait_for_function('window.ChopperMobileControls?.active === true',timeout=10000)
            page.wait_for_timeout(50)

            state=page.evaluate('''() => {
              const required=[
                '#chopper .samplerDeck','#chopper .samplerDeck .panel',
                '#chopper .samplerDrumSection','#chopper .wavewrap.largeWave',
                '#chopper .loopGridWrap','#chopper .drumEditBox','#chopper .advancedBox',
                '#chopper #sampleBpm','#chopper #punchMode','#chopper .samplerUpperDeck',
                '#chopper .samplerSequenceModule'
              ];
              const missing=required.filter(selector=>!document.querySelector(selector));
              const style=selector=>{
                const element=document.querySelector(selector);
                return element?getComputedStyle(element):null;
              };
              const rect=selector=>document.querySelector(selector).getBoundingClientRect().toJSON();
              const displayOrAbsent=selector=>{
                const value=style(selector);
                return value?value.display:'absent';
              };
              const links=[...document.querySelectorAll('link[rel~="stylesheet"]')];
              if(missing.length)return {missing};
              const backgrounds={
                deck:style('#chopper .samplerDeck').backgroundImage,
                panel:style('#chopper .samplerDeck .panel').backgroundImage,
                drums:style('#chopper .samplerDrumSection').backgroundImage,
                wave:style('#chopper .wavewrap.largeWave').backgroundImage,
                grid:style('#chopper .loopGridWrap').backgroundImage,
                editor:style('#chopper .drumEditBox').backgroundImage,
                advanced:style('#chopper .advancedBox').backgroundImage,
                input:style('#chopper #sampleBpm').backgroundImage,
                punch:style('#chopper #punchMode').backgroundImage
              };
              return {
                missing,
                links:links.map(link=>({href:link.getAttribute('href').split('?')[0].split('#')[0],loaded:Boolean(link.sheet)})),
                upperColumns:style('#chopper .samplerUpperDeck').gridTemplateColumns,
                hidden:{
                  sampleInfo:displayOrAbsent('#chopper .samplerSampleInfo'),
                  titleMeta:displayOrAbsent('#chopper .titleMeta'),
                  currentDrums:displayOrAbsent('#chopper .currentDrums')
                },
                backgrounds,
                deck:rect('#chopper .samplerDeck'),
                sequence:rect('#chopper .samplerSequenceModule'),
                drums:rect('#chopper .samplerDrumSection')
              };
            }''')

            assert not state['missing'],(width,state['missing'])
            hrefs=[item['href'] for item in state['links']]
            assert hrefs,state
            assert len(hrefs)==len(set(hrefs)),hrefs
            assert all(item['loaded'] for item in state['links']),state['links']

            chopper_owners=[
                './css/chopper-drum-controls.css',
                './css/chopper-deck-texture.css'
            ]
            for owner in chopper_owners:
                assert hrefs.count(owner)==1,(owner,hrefs)
            assert hrefs.index(chopper_owners[0]) < hrefs.index(chopper_owners[1]),hrefs

            assert len(state['upperColumns'].split())==1,state['upperColumns']

            # Hidden legacy/readout nodes may also be removed by runtime code;
            # either state is non-visible and therefore valid for this CSS gate.
            assert all(value in ('none','absent') for value in state['hidden'].values()),state['hidden']

            for key in ['deck','panel','drums']:
                assert state['backgrounds'][key] != 'none',(width,key,state['backgrounds'][key])
                assert 'deck-black-ui-texture.png' in state['backgrounds'][key],(
                    width,key,state['backgrounds'][key]
                )
            for key in ['wave','grid','editor','advanced','input','punch']:
                assert state['backgrounds'][key] == 'none',(width,key,state['backgrounds'][key])

            deck_box=state['deck']
            assert deck_box['width']>0 and deck_box['height']>0,(width,'deck',deck_box)
            assert deck_box['left']>=-1 and deck_box['right']<=width+1,(width,'deck',deck_box)

            if width>760:
                for key in ['sequence','drums']:
                    box=state[key]
                    assert box['width']>0 and box['height']>0,(width,key,box)
                    assert box['left']>=-1 and box['right']<=width+1,(width,key,box)
            else:
                # Mobile intentionally exposes one workspace at a time. Exercise
                # every tab before measuring it instead of requiring hidden
                # SEQ/DRUMS/PADS panels to have legacy non-zero geometry.
                mobile_surfaces={
                    'chopper':'#chopper .samplerUpperDeck',
                    'sequence':'#chopper .samplerSequenceModule',
                    'pads':'#chopper .samplerPadsModule',
                    'drums':'#chopper .samplerDrumSection',
                }
                for workspace,selector in mobile_surfaces.items():
                    page.evaluate('(name) => ChopperMobileControls.setWorkspace(name)',workspace)
                    page.wait_for_timeout(30)
                    mobile_state=page.evaluate('''({workspace,selector}) => ({
                      workspace:ChopperMobileControls.workspace,
                      display:getComputedStyle(document.querySelector(selector)).display,
                      box:document.querySelector(selector).getBoundingClientRect().toJSON()
                    })''',{'workspace':workspace,'selector':selector})
                    assert mobile_state['workspace']==workspace,(width,workspace,mobile_state)
                    assert mobile_state['display']!='none',(width,workspace,mobile_state)
                    box=mobile_state['box']
                    assert box['width']>0 and box['height']>0,(width,workspace,box)
                    assert box['left']>=-1 and box['right']<=width+1,(width,workspace,box)

            assert not errors,(width,errors)
            page.close()
        browser.close()

print('OK: real Chopper runtime loads its CSS owners with stable visual ownership across desktop/tablet/mobile workspaces')
