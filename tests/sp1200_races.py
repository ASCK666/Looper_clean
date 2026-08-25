from pathlib import Path
import contextlib
import http.server
import math
import os
import re
import socketserver
import struct
import sys
import tempfile
import threading
import wave

ROOT = Path(__file__).resolve().parents[1]

# Cheap source-contract checks still run when Playwright is unavailable.
adapter_source = (ROOT / 'js' / 'chopper-sp1200.js').read_text(encoding='utf-8')
chopper_source = (ROOT / 'js' / 'chopper.js').read_text(encoding='utf-8')
drums_source = (ROOT / 'js' / 'drums.js').read_text(encoding='utf-8')
events_source = (ROOT / 'js' / 'events.js').read_text(encoding='utf-8')

render_start = adapter_source.index('async function renderSpSequence')
render_end = adapter_source.index('async function previewSpSlice', render_start)
render_block = adapter_source[render_start:render_end]
assert 'tuneForPitchRate(pitchRate)' in render_block, 'SP full render must consume the explicit renderer pitch input'
assert 'samplePitchSemitones' not in render_block, 'SP full render must not reach back into Chopper pitch state'
first_render_await = render_block.index('await ensureAudio()')
snapshot_block = render_block[:first_render_await]
post_snapshot_block = render_block[first_render_await:]
for token in (
    'const renderMode=currentMode()',
    'const activeBank=currentBank()',
    'const renderEvents=Object.freeze',
    'const renderCueMarkers=Object.freeze',
    'const renderSlices=Object.freeze',
    'const renderOutputMode=outputMode',
    'const renderLevelCode=levelCodeForSampleVolume()'
):
    assert token in snapshot_block, f'SP full render must snapshot {token} before its first await'
assert 'currentMode()' not in post_snapshot_block, 'SP full render must not reread edit mode after async work starts'
assert 'currentBank()' not in post_snapshot_block, 'SP full render must not reread bank after async work starts'
assert 'globalThis.ChopperWaveSlices?.slices' not in post_snapshot_block, 'SP full render must not reread slice ranges after async work starts'
assert 'events?.[' not in post_snapshot_block, 'SP full render must use its event snapshot after async work starts'
assert 'cueMarkers?.[' not in post_snapshot_block, 'SP full render must use its marker snapshot after async work starts'
assert 'let previewGeneration=0' in adapter_source, 'SP pad audition needs an async generation token'
assert 'const stopChopAuditionBase=stopChopAudition' in adapter_source, 'normal Chopper stop must invalidate pending SP auditions'
assert 'generation!==previewGeneration' in adapter_source, 'stale SP pad continuations must be rejected'

# Sample replacement owns a separate last-request-wins token. It must stop an
# already-audible combined preview, invalidate a pending one, and reject stale
# decode continuations before they can publish source state or an obsolete error.
load_start = chopper_source.index('async function loadChopperSample')
load_end = chopper_source.index('\nfunction viewWindow', load_start)
load_block = chopper_source[load_start:load_end]
assert 'let sampleLoadGeneration=0' in chopper_source, 'sample loading needs its own request generation token'
assert 'const generation=++sampleLoadGeneration' in load_block, 'each sample load must allocate a new generation'
assert 'if(typeof stopCurrentBeat==="function" && isLoopPlaying)stopCurrentBeat();' in load_block, 'sample replacement must stop an active combined preview'
assert 'invalidatePreviewRender();' in load_block, 'sample replacement must invalidate a pending combined preview'
assert load_block.count('if(generation!==sampleLoadGeneration)return false;') >= 2, 'stale sample decodes and errors must both be rejected'
assert load_block.index('if(generation!==sampleLoadGeneration)return false;') < load_block.index('sampleBuffer=decoded;'), 'stale sample decode must be rejected before publishing sampleBuffer'

# The combined PLAY/DRUMS preview generation has one runtime writer. The SP
# pad-audition token above is intentionally separate because it owns a different
# async lifecycle and must not be folded into the combined-preview generation.
assert drums_source.count('previewRenderGeneration++') == 1, 'invalidatePreviewRender() must be the only combined-preview generation writer'
assert 'function invalidatePreviewRender(){\n  previewRenderGeneration++;' in drums_source, 'renderer owner must advance the combined-preview generation'
assert '++previewRenderGeneration' not in drums_source, 'renderer internals must not bypass invalidatePreviewRender()'
assert 'previewRenderGeneration+=' not in drums_source, 'renderer internals must not mutate the generation with +='
for js_path in sorted((ROOT / 'js').glob('*.js')):
    source = js_path.read_text(encoding='utf-8')
    if js_path.name != 'drums.js':
        for direct_write in ('previewRenderGeneration++', '++previewRenderGeneration', 'previewRenderGeneration+='):
            assert direct_write not in source, f'{js_path.name} must route combined-preview invalidation through invalidatePreviewRender()'
    if js_path.name not in ('core.js', 'drums.js'):
        assert not re.search(r'\brenderedFlip\s*=\s*null\b', source), f'{js_path.name} must not bypass renderer-owned preview invalidation'

play_start = events_source.index('async function playCurrentBeat')
play_end = events_source.index('$("previewFlip").onclick=playCurrentBeat', play_start)
play_block = events_source[play_start:play_end]
assert 'const generation=invalidatePreviewRender()' in play_block, 'full PLAY must allocate its generation through the renderer owner'
assert '++previewRenderGeneration' not in play_block, 'full PLAY must not bypass renderer-owned invalidation'
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
    replacement = td / 'sp-replacement-48k.wav'
    make_wav(sample)
    make_wav(replacement, hz=241)

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

        # Regression 4: a direct internal marker mutation during cooperative
        # encode cannot turn an already-started snapshot into hybrid audio. Real
        # UI marker mutations use the renderer invalidation contract instead.
        page.evaluate('''() => {
          SP1200DSP.clearCache(sampleBuffer);
          renderedFlip=null;
          markers[0]=6.5;
          loopGridEvents=new Array(CHOPPER_SEQUENCE_STEPS).fill(0);
          loopGridEvents[0]=1;
          renderLoopGrid();
        }''')
        page.click('#previewFlip')
        page.wait_for_timeout(5)
        page.evaluate('markers[0]=0')
        page.wait_for_function(
            "renderedFlip !== null && isLoopPlaying === true && lastPreviewMode === 'full'",
            timeout=10000,
        )
        snapshot_render = page.evaluate('''() => {
          const data=renderedFlip.getChannelData(0);
          const rate=renderedFlip.sampleRate;
          const first=Math.floor(2.2*rate);
          const last=Math.min(data.length,Math.ceil(3.5*rate));
          let peak=0;
          for(let i=first;i<last;i++)peak=Math.max(peak,Math.abs(data[i]));
          return {peak,markerNow:markers[0],duration:renderedFlip.duration};
        }''')
        assert snapshot_render['markerNow'] == 0, snapshot_render
        assert snapshot_render['duration'] > 3.9, snapshot_render
        assert snapshot_render['peak'] < 1e-5, snapshot_render
        page.click('#stopFlip')

        # Regression 5: changing MARKERS/SLICES while PLAY is still rendering
        # invalidates the old combined preview before it can start a live source.
        page.evaluate('''() => {
          ChopperWaveSlices.setEditMode('markers');
          SP1200DSP.clearCache(sampleBuffer);
          window.__spLiveStarts=0;
          loopGridEvents=new Array(CHOPPER_SEQUENCE_STEPS).fill(0);
          loopGridEvents[0]=1;
          renderLoopGrid();
        }''')
        page.click('#previewFlip')
        page.wait_for_timeout(5)
        page.evaluate("ChopperWaveSlices.setEditMode('slices')")
        page.wait_for_timeout(1200)
        slice_invalidation = page.evaluate('''() => ({
          playing:isLoopPlaying,
          source:flipSource,
          starts:window.__spLiveStarts,
          mode:ChopperWaveSlices.mode
        })''')
        assert slice_invalidation['playing'] is False, slice_invalidation
        assert slice_invalidation['source'] is None, slice_invalidation
        assert slice_invalidation['starts'] == 0, slice_invalidation
        assert slice_invalidation['mode'] == 'slices', slice_invalidation
        page.evaluate("ChopperWaveSlices.setEditMode('markers')")

        # Regression 6: replacing the sample while a combined preview is already
        # audible must stop that source before the new sample context is published.
        page.evaluate('''() => {
          SP1200DSP.clearCache(sampleBuffer);
          window.__spLiveStarts=0;
          loopGridEvents=new Array(CHOPPER_SEQUENCE_STEPS).fill(0);
          loopGridEvents[0]=1;
          renderLoopGrid();
        }''')
        page.click('#previewFlip')
        page.wait_for_function(
            "isLoopPlaying === true && flipSource !== null && lastPreviewMode === 'full'",
            timeout=10000,
        )
        active_starts = page.evaluate('window.__spLiveStarts')
        page.set_input_files('#sampleFile', str(replacement))
        page.wait_for_function(
            "sampleName === 'sp-replacement-48k.wav' && sampleBuffer && sampleBuffer.duration > 7.5",
            timeout=15000,
        )
        active_load = page.evaluate('''() => ({
          playing:isLoopPlaying,
          source:flipSource,
          mode:lastPreviewMode,
          starts:window.__spLiveStarts,
          name:sampleName
        })''')
        assert active_load['playing'] is False, active_load
        assert active_load['source'] is None, active_load
        assert active_load['mode'] is None, active_load
        assert active_load['starts'] == active_starts, active_load
        assert active_load['name'] == 'sp-replacement-48k.wav', active_load

        # Regression 7: replacing the sample while PLAY is still rendering must
        # invalidate the old generation so it cannot become audible afterward.
        page.set_input_files('#sampleFile', str(sample))
        page.wait_for_function(
            "sampleName === 'sp-race-48k.wav' && sampleBuffer && sampleBuffer.duration > 7.5",
            timeout=15000,
        )
        page.evaluate('''() => {
          document.getElementById('sampleBpm').value='120';
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
          SP1200DSP.clearCache(sampleBuffer);
          window.__spLiveStarts=0;
        }''')
        page.click('#previewFlip')
        page.wait_for_timeout(5)
        page.set_input_files('#sampleFile', str(replacement))
        page.wait_for_function(
            "sampleName === 'sp-replacement-48k.wav' && sampleBuffer && sampleBuffer.duration > 7.5",
            timeout=15000,
        )
        page.wait_for_timeout(1200)
        pending_load = page.evaluate('''() => ({
          playing:isLoopPlaying,
          source:flipSource,
          starts:window.__spLiveStarts,
          name:sampleName
        })''')
        assert pending_load['playing'] is False, pending_load
        assert pending_load['source'] is None, pending_load
        assert pending_load['starts'] == 0, pending_load
        assert pending_load['name'] == 'sp-replacement-48k.wav', pending_load

        # Regression 8: overlapping decodes are last-request-wins. The stale
        # first decode may finish later, but it cannot overwrite sample state.
        overlapping_loads = page.evaluate('''async () => {
          const decodeBase=decodeFile;
          const rate=ctx.sampleRate;
          const slowBuffer=ctx.createBuffer(1,Math.max(1,Math.floor(rate*.25)),rate);
          const fastBuffer=ctx.createBuffer(1,Math.max(1,Math.floor(rate*.5)),rate);
          decodeFile=async file=>{
            if(file.name==='slow-a.wav'){
              await new Promise(resolve=>setTimeout(resolve,120));
              return slowBuffer;
            }
            if(file.name==='fast-b.wav'){
              await new Promise(resolve=>setTimeout(resolve,10));
              return fastBuffer;
            }
            return await decodeBase(file);
          };
          try{
            const slow=loadChopperSample({name:'slow-a.wav',size:1,type:'audio/wav'});
            await new Promise(resolve=>setTimeout(resolve,5));
            const fast=loadChopperSample({name:'fast-b.wav',size:1,type:'audio/wav'});
            const [slowResult,fastResult]=await Promise.all([slow,fast]);
            return {
              slowResult,
              fastResult,
              name:sampleName,
              duration:sampleBuffer?.duration||0,
              status:document.getElementById('chopStatus').textContent
            };
          }finally{
            decodeFile=decodeBase;
          }
        }''')
        assert overlapping_loads['slowResult'] is False, overlapping_loads
        assert overlapping_loads['fastResult'] is True, overlapping_loads
        assert overlapping_loads['name'] == 'fast-b.wav', overlapping_loads
        assert abs(overlapping_loads['duration'] - .5) < .01, overlapping_loads
        assert 'fast-b.wav' in overlapping_loads['status'], overlapping_loads

        assert page.evaluate('window.__SP.errors.length') == 0
        assert not page_errors, page_errors
        context.close()
        browser.close()

print('OK: SP1200 async races — single-owner preview invalidation plus STOP-safe PAD/PLAY/sample-load lifecycle')