from pathlib import Path
import contextlib
import http.server
import socketserver
import sys
import threading

try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIP: playwright is not installed')
    sys.exit(0)

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


with contextlib.ExitStack() as stack:
    handler = lambda *a, **kw: QuietHandler(*a, directory=str(ROOT), **kw)
    server = socketserver.TCPServer(('127.0.0.1', 0), handler)
    stack.callback(server.server_close)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    stack.callback(server.shutdown)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
        )
        page = browser.new_page(viewport={'width': 1280, 'height': 900})
        page_errors = []
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        page.goto(f'http://127.0.0.1:{server.server_address[1]}/index.html', wait_until='load', timeout=20000)
        page.wait_for_function('window.__SP && window.__SP.ready === true', timeout=10000)

        result = page.evaluate('''async () => {
          const makeSelection=()=>({
            mode:'classic',patternId:'BB01',patternName:'TEST',
            kicks:[0,4],snares:[4,12],ghosts:[],hats:[0,1,2,3,4,5,6,7],hatSteps:[0,2,4,6,8,10,12,14],
            kickVelocity:{0:.5,4:1},snareVelocity:{4:1,12:1},hatVelocity:{0:1,2:1,4:1,6:1,8:1,10:1,12:1,14:1},
            hatSwing:.034,hatOn:.31,hatOff:.24,snareDelay:.008,kickNudge:{},
            kick:{name:'KICK'},snare:{name:'SNARE'},hat:{name:'HAT'}
          });
          const makeOffSelection=()=>({
            mode:'off',patternId:'OFF',patternName:'OFF',
            kicks:[],snares:[],ghosts:[],hats:[],hatSteps:[],
            kickVelocity:{},snareVelocity:{},hatVelocity:{},
            kick:null,snare:null,hat:null
          });

          const renderBase=renderDrumsOnly;
          const playBase=playRendered;
          const generateBase=generateDrumSelection;
          window.__drumEditPlayGenerations=[];
          renderDrumsOnly=async()=>({testBuffer:true});
          playRendered=async(_buffer,generation)=>{
            window.__drumEditPlayGenerations.push(generation);
            return true;
          };

          try{
            // Idle CLEAR has no async selection boundary and invalidates once.
            currentDrumSelection=makeSelection();
            isLoopPlaying=false;
            lastPreviewMode='drums';
            renderedFlip={stale:true};
            const clearBefore=previewRenderGeneration;
            await clearDrumEdits();
            const idleClear={
              delta:previewRenderGeneration-clearBefore,
              renderedNull:renderedFlip===null,
              patternId:currentDrumSelection.patternId,
              kicks:currentDrumSelection.kicks.length,
              plays:window.__drumEditPlayGenerations.length
            };

            // An active synchronous step edit uses the mutation generation for
            // rerender instead of allocating a second generation.
            currentDrumSelection=makeSelection();
            isLoopPlaying=true;
            lastPreviewMode='drums';
            renderDrumEditor();
            window.__drumEditPlayGenerations=[];
            const clickBefore=previewRenderGeneration;
            const kickCell=document.querySelector('.drumEditStep.kick.active');
            await kickCell.onclick();
            const activeClick={
              delta:previewRenderGeneration-clickBefore,
              current:previewRenderGeneration,
              playGeneration:window.__drumEditPlayGenerations.at(-1),
              removed:!currentDrumSelection.kicks.includes(0),
              patternId:currentDrumSelection.patternId
            };

            // Wheel velocity is also synchronous: one edit, one generation.
            currentDrumSelection=makeSelection();
            isLoopPlaying=true;
            lastPreviewMode='drums';
            renderDrumEditor();
            window.__drumEditPlayGenerations=[];
            const wheelBefore=previewRenderGeneration;
            const wheelCell=document.querySelector('.drumEditStep.kick.active');
            wheelCell.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));
            await new Promise(resolve=>setTimeout(resolve,20));
            const activeWheel={
              delta:previewRenderGeneration-wheelBefore,
              current:previewRenderGeneration,
              playGeneration:window.__drumEditPlayGenerations.at(-1),
              velocity:currentDrumSelection.kickVelocity[0]
            };

            // When a click must await a new Drum selection, invalidation is
            // intentionally two-phase: before the await and after publication.
            currentDrumSelection=makeOffSelection();
            isLoopPlaying=true;
            lastPreviewMode='drums';
            renderDrumEditor();
            window.__drumEditPlayGenerations=[];
            generateDrumSelection=async()=>{
              await new Promise(resolve=>setTimeout(resolve,25));
              currentDrumSelection=makeSelection();
              return currentDrumSelection;
            };
            const asyncBefore=previewRenderGeneration;
            const emptyKickCell=document.querySelector('.drumEditStep.kick');
            await emptyKickCell.onclick();
            const asyncClick={
              delta:previewRenderGeneration-asyncBefore,
              current:previewRenderGeneration,
              playGeneration:window.__drumEditPlayGenerations.at(-1),
              removed:!currentDrumSelection.kicks.includes(0),
              patternId:currentDrumSelection.patternId
            };
            generateDrumSelection=generateBase;

            // Reusing the edit generation must not weaken stale-render rejection.
            currentDrumSelection=makeSelection();
            isLoopPlaying=true;
            lastPreviewMode='drums';
            renderDrumEditor();
            renderedFlip={stale:true};
            window.__drumEditPlayGenerations=[];
            let releaseRender=null;
            renderDrumsOnly=()=>new Promise(resolve=>{
              releaseRender=()=>resolve({delayedBuffer:true});
            });
            const staleCell=document.querySelector('.drumEditStep.kick.active');
            const stalePending=staleCell.onclick();
            while(!releaseRender)await new Promise(resolve=>setTimeout(resolve,0));
            const editGeneration=previewRenderGeneration;
            invalidatePreviewRender();
            const cancelledGeneration=previewRenderGeneration;
            releaseRender();
            await stalePending;
            const stale={
              editGeneration,
              cancelledGeneration,
              plays:window.__drumEditPlayGenerations.length,
              renderedNull:renderedFlip===null
            };

            return {idleClear,activeClick,activeWheel,asyncClick,stale};
          }finally{
            renderDrumsOnly=renderBase;
            playRendered=playBase;
            generateDrumSelection=generateBase;
            isLoopPlaying=false;
            lastPreviewMode=null;
          }
        }''')

        assert result['idleClear']['delta'] == 1, result
        assert result['idleClear']['renderedNull'] is True, result
        assert result['idleClear']['patternId'] == 'EDIT', result
        assert result['idleClear']['kicks'] == 0, result
        assert result['idleClear']['plays'] == 0, result

        assert result['activeClick']['delta'] == 1, result
        assert result['activeClick']['playGeneration'] == result['activeClick']['current'], result
        assert result['activeClick']['removed'] is True, result
        assert result['activeClick']['patternId'] == 'EDIT', result

        assert result['activeWheel']['delta'] == 1, result
        assert result['activeWheel']['playGeneration'] == result['activeWheel']['current'], result
        assert abs(result['activeWheel']['velocity'] - .55) < 1e-9, result

        assert result['asyncClick']['delta'] == 2, result
        assert result['asyncClick']['playGeneration'] == result['asyncClick']['current'], result
        assert result['asyncClick']['removed'] is True, result
        assert result['asyncClick']['patternId'] == 'EDIT', result

        assert result['stale']['cancelledGeneration'] == result['stale']['editGeneration'] + 1, result
        assert result['stale']['plays'] == 0, result
        assert result['stale']['renderedNull'] is True, result
        assert not page_errors, page_errors

        page.close()
        browser.close()

print('OK: Drum edit invalidation — one generation for sync edits, two-phase across selection await, stale rerender rejected')
