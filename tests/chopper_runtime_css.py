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
            page.wait_for_timeout(50)

            state=page.evaluate('''() => {
              const style=selector=>getComputedStyle(document.querySelector(selector));
              const rect=selector=>document.querySelector(selector).getBoundingClientRect().toJSON();
              const links=[...document.querySelectorAll('link[rel~="stylesheet"]')];
              const backgrounds={
                deck:style('#chopper .samplerDeck').backgroundImage,
                panel:style('#chopper .samplerDeck .panel').backgroundImage,
                drums:style('#chopper .samplerDrumSection').backgroundImage,
                wave:style('#chopper .wavewrap.largeWave').backgroundImage,
                grid:style('#chopper .loopGridWrap').backgroundImage,
                editor:style('#chopper .drumEditBox').backgroundImage,
                advanced:style('#chopper .advancedBox').backgroundImage,
                input:style('#chopper #sampleBpm').backgroundImage,
                select:style('#chopper #punchMode').backgroundImage
              };
              return {
                links:links.map(link=>({href:link.getAttribute('href'),loaded:Boolean(link.sheet)})),
                upperColumns:style('#chopper .samplerUpperDeck').gridTemplateColumns,
                hidden:{
                  sampleInfo:style('#chopper .samplerSampleInfo').display,
                  titleMeta:style('#chopper .titleMeta').display,
                  currentDrums:style('#chopper .currentDrums').display
                },
                backgrounds,
                deck:rect('#chopper .samplerDeck'),
                sequence:rect('#chopper .samplerSequenceModule'),
                drums:rect('#chopper .samplerDrumSection')
              };
            }''')

            assert len(state['links'])==4,state
            assert all(item['loaded'] for item in state['links']),state['links']
            assert [item['href'] for item in state['links']]==[
                './css/base.css',
                './css/clean-ui.css',
                './css/chopper-drum-controls.css',
                './css/chopper-deck-texture.css'
            ],state['links']

            # chopper-drum-controls.css is the active owner of the one-column upper deck.
            assert len(state['upperColumns'].split())==1,state['upperColumns']

            # These legacy readouts are intentionally absent from the rendered UI.
            assert state['hidden']=={
                'sampleInfo':'none','titleMeta':'none','currentDrums':'none'
            },state['hidden']

            # The deck/panels keep their runtime texture, while inner controls stay
            # image-free without the deleted late reset block.
            for key in ['deck','panel','drums']:
                assert state['backgrounds'][key] != 'none',(width,key,state['backgrounds'][key])
                assert 'deck-black-ui-texture.png' in state['backgrounds'][key],(
                    width,key,state['backgrounds'][key]
                )
            for key in ['wave','grid','editor','advanced','input','select']:
                assert state['backgrounds'][key] == 'none',(width,key,state['backgrounds'][key])

            for key in ['deck','sequence','drums']:
                box=state[key]
                assert box['width']>0 and box['height']>0,(width,key,box)
                assert box['left']>=-1 and box['right']<=width+1,(width,key,box)

            assert not errors,(width,errors)
            page.close()
        browser.close()

print('OK: Chopper runtime CSS — real 4-sheet manifest, responsive modules, texture ownership and image-free inner controls')
