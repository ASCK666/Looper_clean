from pathlib import Path
import contextlib
import http.server
import math
import os
import socketserver
import struct
import sys
import tempfile
import threading
import wave

ROOT = Path(__file__).resolve().parents[1]

# Cheap source-contract checks still run when Playwright is unavailable.
adapter_source = (ROOT / 'js' / 'chopper-sp1200.js').read_text(encoding='utf-8')
events_source = (ROOT / 'js' / 'events.js').read_text(encoding='utf-8')

render_start = adapter_source.index('async function renderSpSequence')
render_end = adapter_source.index('async function previewSpSlice', render_start)
render_block = adapter_source[render_start:render_end]
assert 'tuneForPitchRate(pitchRate)' in render_block, 'SP full render must consume the explicit renderer pitch input'
assert 'samplePitchSemitones' not in render_block, 'SP full render must not reach back into Chopper pitch state'
assert 'let previewGeneration=0' in adapter_source, 'SP pad audition needs an async generation token'
assert 'const stopChopAuditionBase=stopChopAudition' in adapter_source, 'normal Chopper stop must invalidate pending SP auditions'
assert 'generation!==previewGeneration' in adapter_source, 'stale SP pad continuations must be rejected'

play_start = events_source.index('async function playCurrentBeat')
play_end = events_source.index('$("previewFlip").onclick=playCurrentBeat', play_start)
play_block = events_source[play_start:play_end]
assert 'const generation=++previewRenderGeneration' in play_block, 'full PLAY must allocate a renderer generation'
assert play_block.count('generation!==previewRenderGeneration') >= 2, 'full PLAY must recheck generation across async boundaries'
assert 'playRendered(buffer,generation)' in play_block, 'full PLAY must pass its generation into playback'

try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIP: playwright is not installed (SP1200 async source contracts passed)')
    sys.exit(0)


def make_wav(path: Path, seconds=8.0, hz=173, rate=48000):
    frames = max(1, int(rate * seconds))
    with wave.open(str(path), 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        payload = bytearray()
        for i in range(frames):
            t = i / rate
            accent = .78 if i % (rate // 2) < 96 else .24
            value = accent * math.sin(2 * math.pi * hz * t)
            payload += struct.pack('<h', int(max(-1, min(1, value)) * 32767))
        wf.writeframes(payload)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


with tempfile.TemporaryDirectory() as td, contextlib.ExitStack() as stack:
    td = Path(td)
    sample = td / 'sp-race-48k.wav'
    make_wav(sample)

    handler = lambda *a, **kw: QuietHandler(*a, directory=str(ROOT), **kw)
    server = socketserver.TCPServer(('127.0.0.1', 0), handler)
    stack.callback(server.server_close)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    stack.callback(server.shutdown)
    port = server.server_address[1]

    chromium = os.environ.get('CHROMIUM', '/usr/bin/chromium')
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            executable_path=chromium,
            args=[
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--autoplay-policy=no-user-gesture-required',
            ],
        )
        context = browser.new_context()
        page = context.new_page()
        page_errors = []
        page.on('pageerror', lambda e: page_errors.append(str(e)))

        page.goto(
            f'http://127.0.0.1:{port}/index.html',
            wait_until='networkidle',
            timeout=30000,
        )
        page.wait_for_function('window.__SP && window.__SP.ready === true', timeout=10000)
        page.wait_for_function(
            'window.ChopperWaveSlices && window.ChopperBanks && '
            'window.SP1200DSP && window.ChopperSP1200',
            timeout=15000,
        )

        # The decoded Web Audio rate is device-dependent, but an eight-second
        # source is long enough to cross several cooperative SP encoder yields
        # at either common 44.1 or 48 kHz session rates.
        page.set_input_files('#sampleFile', str(sample))
        page.wait_for_function(
            'sampleBuffer && sampleBuffer.duration > 7.5 && sampleBuffer.length > 300000',
            timeout=15000,
        )
        page.click('[data-tab="chopper"]')

        page.evaluate('''() => {
          document.getElementById('punchMode').value='0';
          document.getElementById('sampleBpm').value='120';
          const vinyl=document.getElementById('vinylAmount');
          vinyl.value='0';
          vinyl.dispatchEvent(new Event('input',{bubbles:true}));
          currentDrumSelection={
            mode:'off',patternId:'OFF',patternName:'OFF',
            kicks:[],snares:[],ghosts:[],hats:[],hatSteps:[],
            kickVelocity:{},snareVelocity:{},hatVelocity:{},
            kick:null,snare:null,hat:null
          };
          ChopperBanks.selectBank(0);
          ChopperWaveSlices.setEditMode('markers');
          loopGridEvents=new Array(CHOPPER_SEQUENCE_STEPS).fill(0);
          loopGridEvents[0]=1;
          renderLoopGrid();
        }''')

        page.click('#sp1200Toggle')
        page.wait_for_function('ChopperSP1200.enabled === true')
        page.evaluate('ensureAudio()')
        page.wait_for_function('ctx && ctx.state !== "closed"')

        # When Chromium exposes scheduler.yield(), slow only that existing yield
        # during this test. The long fixture remains sufficient if the property
        # cannot be overridden on a particular browser build.
        page.evaluate('''() => {
          const delayed=()=>new Promise(resolve=>setTimeout(resolve,25));
          try {
            if(globalThis.scheduler && (typeof globalThis.scheduler==='object' || typeof globalThis.scheduler==='function')){
              Object.defineProperty(globalThis.scheduler,'yield',{value:delayed,configurable:true});
            }
          } catch(_error) {}
        }''')

        # Instrument only live ctx sources. Offline render sources are intentionally
        # excluded so we can detect an audition/loop that starts after STOP.
        page.evaluate('''() => {
          window.__spLiveStarts=0;
          const createBase=ctx.createBufferSource.bind(ctx);
          ctx.createBufferSource=()=>{
            const source=createBase();
            const startBase=source.start.bind(source);
            source.start=(...args)=>{
              window.__spLiveStarts++;
              return startBase(...args);
            };
            return source;
          };
        }''')

        # Regression 1: STOP while PAD encoding is pending must invalidate the
        # continuation before it can create/start a live source.
        page.evaluate('''() => {
          SP1200DSP.clearCache(sampleBuffer);
          window.__spLiveStarts=0;
        }''')
        page.locator('#pads .pad').nth(0).click()
        page.wait_for_timeout(5)
        page.click('#stopFlip')
        page.wait_for_timeout(700)
        pad_stop = page.evaluate('''() => ({
          source:chopAuditionSource,
          pad:chopAuditionPad,
          starts:window.__spLiveStarts,
          status:document.getElementById('chopStatus').textContent
        })''')
        assert pad_stop['source'] is None, pad_stop
        assert pad_stop['pad'] == -1, pad_stop
        assert pad_stop['starts'] == 0, pad_stop
        assert pad_stop['status'] == 'STOP', pad_stop

        # Regression 2: two rapid pads are last-request-wins. The stale first
        # encode may finish internally, but it must never start a second source.
        page.evaluate('''() => {
          SP1200DSP.clearCache(sampleBuffer);
          window.__spLiveStarts=0;
        }''')
        page.locator('#pads .pad').nth(0).click()
        page.wait_for_timeout(5)
        page.locator('#pads .pad').nth(1).click()
        page.wait_for_function('chopAuditionSource !== null && chopAuditionPad === 1', timeout=10000)
        page.wait_for_timeout(350)
        pad_switch = page.evaluate('''() => ({
          pad:chopAuditionPad,
          starts:window.__spLiveStarts
        })''')
        assert pad_switch['pad'] == 1, pad_switch
        assert pad_switch['starts'] == 1, pad_switch
        page.click('#stopFlip')

        # Regression 3: STOP while full PLAY is rendering must invalidate the
        # pending render before playRendered() can resurrect transport state.
        page.evaluate('''() => {
          SP1200DSP.clearCache(sampleBuffer);
          window.__spLiveStarts=0;
        }''')
        page.click('#previewFlip')
        page.wait_for_timeout(5)
        page.click('#stopFlip')
        page.wait_for_timeout(1200)
        play_stop = page.evaluate('''() => ({
          playing:isLoopPlaying,
          source:flipSource,
          mode:lastPreviewMode,
          starts:window.__spLiveStarts,
          status:document.getElementById('chopStatus').textContent
        })''')
        assert play_stop['playing'] is False, play_stop
        assert play_stop['source'] is None, play_stop
        assert play_stop['mode'] is None, play_stop
        assert play_stop['starts'] == 0, play_stop
        assert play_stop['status'] == 'STOP', play_stop

        assert page.evaluate('window.__SP.errors.length') == 0
        assert not page_errors, page_errors
        context.close()
        browser.close()

print('OK: SP1200 async races — stale PAD/PLAY work cannot restart after STOP; explicit pitch boundary preserved')
