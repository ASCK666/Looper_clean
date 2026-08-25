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
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
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
          await ensureAudio();
          sampleBuffer=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate);
          sampleName='punch-race.wav';
          markers=[0,.5];
          loopGridEvents=new Array(CHOPPER_SEQUENCE_STEPS).fill(0);
          loopGridEvents[0]=1;
          currentDrumSelection={
            mode:'off',patternId:'OFF',patternName:'OFF',
            kicks:[],snares:[],ghosts:[],hats:[],hatSteps:[],
            kickVelocity:{},snareVelocity:{},hatVelocity:{},
            kick:null,snare:null,hat:null
          };

          const punch=document.getElementById('punchMode');
          punch.value='0';
          refreshPunchUI();

          const renderBase=renderSequence;
          const playBase=playRendered;
          window.__punchPlayStarts=0;
          renderSequence=async()=>{
            await new Promise(resolve=>setTimeout(resolve,120));
            return ctx.createBuffer(1,Math.max(1,Math.floor(ctx.sampleRate*.1)),ctx.sampleRate);
          };
          playRendered=async()=>{
            window.__punchPlayStarts++;
            return true;
          };

          try{
            const before=previewRenderGeneration;
            const pending=playCurrentBeat();
            await new Promise(resolve=>setTimeout(resolve,5));
            const during=previewRenderGeneration;

            punch.value='2';
            punch.dispatchEvent(new Event('input',{bubbles:true}));
            const afterInput=previewRenderGeneration;

            const pendingResult=await pending;
            return {
              before,
              during,
              afterInput,
              pendingResult,
              starts:window.__punchPlayStarts,
              renderedNull:renderedFlip===null,
              playing:isLoopPlaying,
              desc:document.getElementById('punchDesc').textContent
            };
          }finally{
            renderSequence=renderBase;
            playRendered=playBase;
          }
        }''')

        assert result['during'] == result['before'] + 1, result
        assert result['afterInput'] == result['during'] + 1, result
        assert result['pendingResult'] is False, result
        assert result['starts'] == 0, result
        assert result['renderedNull'] is True, result
        assert result['playing'] is False, result
        assert result['desc'] == 'KNOCK', result
        assert not page_errors, page_errors

        page.close()
        browser.close()

print('OK: PUNCH preview race — input invalidates a pending combined PLAY before release')
