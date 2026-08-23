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
        page.wait_for_function('window.SP1200DSP && window.ChopperSP1200', timeout=15000)

        result = page.evaluate('''async () => {
          await ensureAudio();
          const rate=ctx.sampleRate;
          sampleBuffer=ctx.createBuffer(1,Math.max(1,Math.floor(rate*.75)),rate);
          const channel=sampleBuffer.getChannelData(0);
          for(let i=0;i<channel.length;i++){
            const t=i/rate;
            channel[i]=.28*Math.sin(2*Math.PI*331*t)+.12*Math.sin(2*Math.PI*9000*t);
          }
          sampleName='sp-output-profiles.wav';
          samplePitchSemitones=0;
          markers=[0,sampleBuffer.duration];
          loopGridEvents=new Array(CHOPPER_SEQUENCE_STEPS).fill(0);
          loopGridEvents[0]=1;
          currentDrumSelection={
            mode:'off',patternId:'OFF',patternName:'OFF',
            kicks:[],snares:[],ghosts:[],hats:[],hatSteps:[],
            kickVelocity:{},snareVelocity:{},hatVelocity:{},
            kick:null,snare:null,hat:null
          };
          document.getElementById('sampleBpm').value='120';
          document.getElementById('punchMode').value='0';
          refreshPunchUI();
          const vinyl=document.getElementById('vinylAmount');
          vinyl.value='0';
          vinyl.dispatchEvent(new Event('input',{bubbles:true}));

          await ChopperSP1200.setEnabled(true);
          await ChopperSP1200.setOutputMode('raw');
          const button=document.getElementById('sp1200FilterToggle');
          const snapshot=()=>({
            mode:ChopperSP1200.outputMode,
            text:button.textContent,
            active:button.getAttribute('aria-pressed'),
            pair:ChopperSP1200.settings().outputFilter?.hardwarePair||null
          });
          const cycle=[snapshot()];
          button.click();
          cycle.push(snapshot());
          button.click();
          cycle.push(snapshot());
          button.click();
          cycle.push(snapshot());

          // PAD and PLAY must consume the same snapshotted 5/6 profile through
          // the shared renderSpChop boundary. Compare away from the marker edge
          // fade and final loop-boundary treatment.
          await ChopperSP1200.setOutputMode('filter56');
          await previewSlice(0);
          const padSource=chopAuditionSource;
          const reference=new Float32Array(padSource.buffer.getChannelData(0));
          const referenceRate=padSource.buffer.sampleRate;
          stopChopAudition();

          const rendered=await renderSequence(loopGridEvents,sampleBuffer,markers,1);
          const play=rendered.getChannelData(0);
          const skip=Math.ceil(rendered.sampleRate*.012);
          const end=Math.max(skip,Math.min(reference.length,play.length)-Math.ceil(rendered.sampleRate*.012));
          let maxDiff=0,sumDiff=0,sumRef=0,count=0;
          for(let i=skip;i<end;i++){
            const diff=play[i]-reference[i];
            maxDiff=Math.max(maxDiff,Math.abs(diff));
            sumDiff+=diff*diff;
            sumRef+=reference[i]*reference[i];
            count++;
          }
          const parity={
            count,
            rate:rendered.sampleRate,
            referenceRate,
            maxDiff,
            rmsDiff:Math.sqrt(sumDiff/Math.max(1,count)),
            referenceRms:Math.sqrt(sumRef/Math.max(1,count)),
            mode:ChopperSP1200.outputMode,
            pair:ChopperSP1200.settings().outputFilter?.hardwarePair||null
          };

          // A 3/4 -> 5/6 change while PLAY is pending belongs to the next render.
          // The old generation may finish computation but must never publish/start.
          await ChopperSP1200.setOutputMode('filter');
          renderedFlip=null;
          const renderBase=renderSequence;
          const playBase=playRendered;
          window.__spOutputStarts=0;
          renderSequence=async()=>{
            await new Promise(resolve=>setTimeout(resolve,120));
            return ctx.createBuffer(1,Math.max(1,Math.floor(ctx.sampleRate*.1)),ctx.sampleRate);
          };
          playRendered=async()=>{
            window.__spOutputStarts++;
            return true;
          };

          let race;
          try{
            const before=previewRenderGeneration;
            const pending=playCurrentBeat();
            await new Promise(resolve=>setTimeout(resolve,5));
            const during=previewRenderGeneration;
            await ChopperSP1200.setOutputMode('filter56');
            const after=previewRenderGeneration;
            const pendingResult=await pending;
            race={
              before,
              during,
              after,
              pendingResult,
              starts:window.__spOutputStarts,
              renderedNull:renderedFlip===null,
              playing:isLoopPlaying,
              mode:ChopperSP1200.outputMode,
              pair:ChopperSP1200.settings().outputFilter?.hardwarePair||null
            };
          }finally{
            renderSequence=renderBase;
            playRendered=playBase;
          }

          return {cycle,parity,race};
        }''')

        assert result['cycle'] == [
            {'mode': 'raw', 'text': 'FLT', 'active': 'false', 'pair': None},
            {'mode': 'filter', 'text': '3/4', 'active': 'true', 'pair': '3-4'},
            {'mode': 'filter56', 'text': '5/6', 'active': 'true', 'pair': '5-6'},
            {'mode': 'raw', 'text': 'FLT', 'active': 'false', 'pair': None},
        ], result['cycle']

        parity = result['parity']
        assert parity['count'] > 1000, parity
        assert parity['rate'] == parity['referenceRate'], parity
        assert parity['referenceRms'] > .01, parity
        assert parity['maxDiff'] < 5e-5, parity
        assert parity['rmsDiff'] < 1e-5, parity
        assert parity['mode'] == 'filter56', parity
        assert parity['pair'] == '5-6', parity

        race = result['race']
        assert race['during'] == race['before'] + 1, race
        assert race['after'] == race['during'] + 1, race
        assert race['pendingResult'] is False, race
        assert race['starts'] == 0, race
        assert race['renderedNull'] is True, race
        assert race['playing'] is False, race
        assert race['mode'] == 'filter56', race
        assert race['pair'] == '5-6', race
        assert not page_errors, page_errors

        page.close()
        browser.close()

print('OK: SP1200 output profiles — RAW/3-4/5-6 cycle, 5/6 PAD-PLAY parity and pending-render invalidation')
