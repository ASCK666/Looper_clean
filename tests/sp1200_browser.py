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

try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIP: playwright is not installed')
    sys.exit(0)

ROOT = Path(__file__).resolve().parents[1]


def make_wav(path: Path, seconds=36.0, hz=137, rate=8000):
    frames = max(1, int(rate * seconds))
    with wave.open(str(path), 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        payload = bytearray()
        for i in range(frames):
            t = i / rate
            # Regular accents keep the long fixture useful to the existing
            # transient detector without making the file large.
            accent = .72 if i % (rate // 2) < 72 else .22
            value = accent * math.sin(2 * math.pi * hz * t)
            payload += struct.pack('<h', int(max(-1, min(1, value)) * 32767))
        wf.writeframes(payload)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


with tempfile.TemporaryDirectory() as td, contextlib.ExitStack() as stack:
    td = Path(td)
    sample = td / 'sp-browser-36s.wav'
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
        context = browser.new_context(accept_downloads=True)
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
            'window.SP1200DSP && window.ChopperSP1200 && window.ChopperVinyl',
            timeout=15000,
        )

        # Loading through the real file input also cancels the optional default
        # Chopper sample before opening the Chopper tab.
        page.set_input_files('#sampleFile', str(sample))
        page.wait_for_function(
            'sampleBuffer && sampleBuffer.duration > 35 && ChopperBanks.banks.length === 3',
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
          ChopperBanks.selectBank(1);
          ChopperWaveSlices.setEditMode('markers');
          moveMarker(15,29,false);
          document.getElementById('samplePitch').value='-5';
          updateSamplePitch(-5);
          loopGridEvents=new Array(CHOPPER_SEQUENCE_STEPS).fill(0);
          loopGridEvents[0]=16;
          renderLoopGrid();
        }''')

        # SP starts OFF and the CLEAN path still auditions the physical source.
        assert page.locator('#sp1200Toggle').count() == 1
        assert page.locator('#sp1200Toggle').get_attribute('aria-pressed') == 'false'
        page.locator('#pads .pad').nth(15).click()
        page.wait_for_function('chopAuditionSource !== null && chopAuditionPad === 15', timeout=5000)
        assert page.evaluate('chopAuditionSource.buffer === sampleBuffer') is True
        page.click('#stopFlip')
        page.wait_for_function('chopAuditionSource === null')

        # MARKERS / banked PAD: SP must replace the source with a rendered mono
        # buffer, preserve -5 st duration behavior, and use the live session rate.
        page.click('#sp1200Toggle')
        page.wait_for_function('ChopperSP1200.enabled === true')
        assert page.locator('#sp1200Toggle').get_attribute('data-active') == '1'
        page.locator('#pads .pad').nth(15).click()
        page.wait_for_function('chopAuditionSource !== null && chopAuditionPad === 15', timeout=20000)
        marker_preview = page.evaluate('''() => ({
          isOriginal:chopAuditionSource.buffer===sampleBuffer,
          channels:chopAuditionSource.buffer.numberOfChannels,
          duration:chopAuditionSource.buffer.duration,
          offset:chopAuditionOffset,
          bank:ChopperBanks.active.label,
          pitch:samplePitchSemitones,
          rate:chopAuditionSource.buffer.sampleRate,
          sessionRate:ctx.sampleRate,
          settingsRate:ChopperSP1200.settings().reconstructionRate
        })''')
        assert marker_preview['isOriginal'] is False, marker_preview
        assert marker_preview['channels'] == 1, marker_preview
        assert marker_preview['bank'] == '0–30', marker_preview
        assert abs(marker_preview['offset'] - 29) < .02, marker_preview
        assert marker_preview['pitch'] == -5, marker_preview
        assert 1.20 < marker_preview['duration'] < 1.50, marker_preview
        assert marker_preview['rate'] == marker_preview['sessionRate'], marker_preview
        assert marker_preview['settingsRate'] == marker_preview['sessionRate'], marker_preview
        page.click('#stopFlip')

        # SLICES uses the same SP engine with the independent START/END range.
        page.click('#sliceEditModeBtn')
        page.wait_for_function("ChopperWaveSlices.mode === 'slices'")
        page.evaluate('''() => {
          ChopperWaveSlices.setSliceBoundary(0,'end',.5,{redraw:false});
          renderPads();
        }''')
        page.locator('#pads .pad').nth(0).click()
        page.wait_for_function('chopAuditionSource !== null && chopAuditionPad === 0', timeout=20000)
        slice_preview = page.evaluate('''() => ({
          isOriginal:chopAuditionSource.buffer===sampleBuffer,
          duration:chopAuditionSource.buffer.duration,
          range:ChopperWaveSlices.slices[0]
        })''')
        assert slice_preview['isOriginal'] is False, slice_preview
        assert abs(slice_preview['range']['end'] - .5) < .01, slice_preview
        assert .60 < slice_preview['duration'] < .75, slice_preview
        page.click('#stopFlip')

        # A later overlapping bank must keep global source coordinates while the
        # SP engine encodes only that working bank.
        page.evaluate('''() => {
          ChopperWaveSlices.setEditMode('markers');
          ChopperBanks.selectBank(2);
          moveMarker(15,35,false);
        }''')
        page.locator('#pads .pad').nth(15).click()
        page.wait_for_function('chopAuditionSource !== null && chopAuditionPad === 15', timeout=20000)
        later_bank = page.evaluate('''() => ({
          label:ChopperBanks.active.label,
          offset:chopAuditionOffset,
          duration:chopAuditionSource.buffer.duration
        })''')
        assert later_bank['label'] == '25–36', later_bank
        assert 34.98 < later_bank['offset'] < 35.02, later_bank
        assert 1.20 < later_bank['duration'] < 1.50, later_bank
        page.click('#stopFlip')

        # ALL on a long source must also audition its tail successfully. P0 pages
        # the encode range internally rather than encoding all 36 s blindly.
        page.evaluate('''() => {
          ChopperBanks.selectBank(0);
          ChopperWaveSlices.setEditMode('markers');
          moveMarker(15,35,false);
        }''')
        page.locator('#pads .pad').nth(15).click()
        page.wait_for_function('chopAuditionSource !== null && chopAuditionPad === 15', timeout=20000)
        all_tail = page.evaluate('''() => ({
          label:ChopperBanks.active.label,
          offset:chopAuditionOffset,
          duration:chopAuditionSource.buffer.duration
        })''')
        assert all_tail['label'] == 'ALL', all_tail
        assert 34.98 < all_tail['offset'] < 35.02, all_tail
        assert 1.20 < all_tail['duration'] < 1.50, all_tail
        page.click('#stopFlip')

        # SP + VINYL: instrument the public post-process hook and verify the SP
        # pad path actually invokes it when the vinyl macro is active.
        page.evaluate('''() => {
          window.__spVinylCalls=0;
          window.__spVinylOriginal=ChopperVinyl.processRenderedBuffer;
          ChopperVinyl.processRenderedBuffer=async buffer=>{
            window.__spVinylCalls++;
            return await window.__spVinylOriginal(buffer);
          };
          const vinyl=document.getElementById('vinylAmount');
          vinyl.value='35';
          vinyl.dispatchEvent(new Event('input',{bubbles:true}));
        }''')
        page.locator('#pads .pad').nth(15).click()
        page.wait_for_function('window.__spVinylCalls > 0 && chopAuditionSource !== null', timeout=20000)
        assert abs(page.evaluate('ChopperVinyl.settings().amount') - .35) < .001
        page.click('#stopFlip')
        page.evaluate('''() => {
          ChopperVinyl.processRenderedBuffer=window.__spVinylOriginal;
          const vinyl=document.getElementById('vinylAmount');
          vinyl.value='0';
          vinyl.dispatchEvent(new Event('input',{bubbles:true}));
        }''')

        # PLAY must render through the SP wrapper at the same reconstruction
        # rate as PAD audition, then STOP must kill all Chopper playback state.
        page.evaluate('''() => {
          ChopperBanks.selectBank(1);
          ChopperWaveSlices.setEditMode('markers');
          moveMarker(15,29,false);
          loopGridEvents=new Array(CHOPPER_SEQUENCE_STEPS).fill(0);
          loopGridEvents[0]=16;
          renderLoopGrid();
        }''')
        page.click('#previewFlip')
        page.wait_for_function(
            "isLoopPlaying === true && lastPreviewMode === 'full' && renderedFlip && flipSource",
            timeout=30000,
        )
        play_state = page.evaluate('''() => ({
          enabled:ChopperSP1200.enabled,
          same:flipSource.buffer===renderedFlip,
          duration:renderedFlip.duration,
          channels:renderedFlip.numberOfChannels,
          rate:renderedFlip.sampleRate,
          sessionRate:ctx.sampleRate,
          settingsRate:ChopperSP1200.settings().reconstructionRate
        })''')
        assert play_state['enabled'] is True, play_state
        assert play_state['same'] is True, play_state
        assert 3.9 < play_state['duration'] < 4.1, play_state
        assert play_state['channels'] == 2, play_state
        assert play_state['rate'] == play_state['sessionRate'], play_state
        assert play_state['settingsRate'] == play_state['sessionRate'], play_state
        assert play_state['rate'] == marker_preview['rate'], (marker_preview, play_state)
        page.click('#stopFlip')
        page.wait_for_function('isLoopPlaying === false && flipSource === null && chopAuditionSource === null')
        assert page.evaluate('lastPreviewMode === null') is True

        # SAVE: preserve the real button handler and real SP render, but replace
        # only filesystem permission/download side effects with deterministic
        # browser-test hooks. The rendered save buffer must stay on the same rate.
        page.evaluate('''() => {
          window.__spSaved=null;
          window.__spSaveMode=null;
          window.__spSaveRate=null;
          const renderSaveBase=renderCurrentBeatForSave;
          renderCurrentBeatForSave=async events=>{
            window.__spSaveMode=ChopperSP1200.enabled;
            const rendered=await renderSaveBase(events);
            window.__spSaveRate=rendered?.sampleRate||null;
            return rendered;
          };
          prepareBeatFolderFromSaveGesture=async()=>({direct:false,reason:'browser test'});
          downloadBeatFallback=(blob,filename)=>{
            window.__spSaved={size:blob.size,filename};
          };
        }''')
        page.click('#addFlipLibrary')
        page.wait_for_function(
            'window.__spSaved && document.getElementById("addFlipLibrary").disabled === false',
            timeout=30000,
        )
        saved = page.evaluate('''() => ({
          saved:window.__spSaved,
          mode:window.__spSaveMode,
          saveRate:window.__spSaveRate,
          rendered:!!renderedFlip,
          renderedRate:renderedFlip?.sampleRate||null,
          sessionRate:ctx.sampleRate,
          status:document.getElementById('chopStatus').textContent
        })''')
        assert saved['mode'] is True, saved
        assert saved['rendered'] is True, saved
        assert saved['saved']['size'] > 44, saved
        assert saved['saved']['filename'].lower().endswith('.wav'), saved
        assert saved['saveRate'] == saved['sessionRate'], saved
        assert saved['renderedRate'] == saved['sessionRate'], saved
        assert saved['saveRate'] == marker_preview['rate'], (marker_preview, saved)
        assert 'WAV DOWNLOADED' in saved['status'], saved

        # Turning SP OFF must immediately restore the original CLEAN audition
        # path for the same pad and keep the toggle semantics honest.
        page.click('#sp1200Toggle')
        page.wait_for_function('ChopperSP1200.enabled === false')
        assert page.locator('#sp1200Toggle').get_attribute('aria-pressed') == 'false'
        page.locator('#pads .pad').nth(15).click()
        page.wait_for_function('chopAuditionSource !== null && chopAuditionPad === 15', timeout=5000)
        assert page.evaluate('chopAuditionSource.buffer === sampleBuffer') is True
        page.click('#stopFlip')

        assert page.evaluate('window.__SP.errors.length') == 0
        assert not page_errors, page_errors
        context.close()
        browser.close()

print('OK: SP1200 browser — shared PAD/PLAY/SAVE reconstruction rate, ON/OFF, BANK/SLICES, VINYL and STOP')
