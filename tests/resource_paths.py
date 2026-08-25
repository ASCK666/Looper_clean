from pathlib import Path
import re
import wave
ROOT=Path(__file__).resolve().parents[1]
problems=[]

# HTML local href/src references.
html=(ROOT/'index.html').read_text(encoding='utf-8')
for val in re.findall(r'\b(?:src|href)=["\']([^"\']+)["\']', html):
    if val.startswith(('http://','https://','data:','#','mailto:')):
        continue
    target=(ROOT/val.split('?',1)[0].split('#',1)[0].lstrip('./')).resolve()
    if not target.exists():
        problems.append(f'HTML missing: {val} -> {target}')

# Relative CSS url(...) values must resolve relative to the CSS file, not index.html.
for css in [ROOT/'css'/'base.css']:
    text=css.read_text(encoding='utf-8')
    for raw in re.findall(r'url\(([^)]+)\)', text, flags=re.I):
        val=raw.strip().strip('"\'')
        if not val or val.startswith(('data:','http://','https://','#')):
            continue
        target=(css.parent/val).resolve()
        if not target.exists():
            problems.append(f'CSS missing: {css.name}: {val} -> {target}')

# Service worker references must resolve when present.
sw=(ROOT/'sw.js').read_text(encoding='utf-8')
for val in re.findall(r'["\'](\./[^"\']+)["\']', sw):
    if val=='./':
        continue
    target=(ROOT/val[2:]).resolve()
    if not target.exists():
        problems.append(f'SW missing: {val} -> {target}')

# GitHub Pages development contract: do not let an old worker combine a fresh
# HTML shell with stale JavaScript. The worker must retire itself and never
# intercept fetches; bootstrap also cleans registrations/caches defensively.
if re.search(r'addEventListener\s*\(\s*["\']fetch["\']', sw):
    problems.append('SW must not intercept fetches while Pages is in development mode')
for token in ['caches.keys()', 'self.registration.unregister()']:
    if token not in sw:
        problems.append(f'SW retirement missing: {token}')
if 'client.navigate(' in sw:
    problems.append('SW retirement must not navigate an already-rendered client')

bootstrap=(ROOT/'js'/'bootstrap.js').read_text(encoding='utf-8')
for token in ['navigator.serviceWorker.getRegistrations()', 'caches.keys()']:
    if token not in bootstrap:
        problems.append(f'Bootstrap stale-cache cleanup missing: {token}')

# Bootstrap must not hide extra runtime dependencies: any local path it names
# has to exist in the deployable tree.
for val in re.findall(r'["\'](\./[^"\']+)["\']', bootstrap):
    target=(ROOT/val[2:]).resolve()
    if not target.exists():
        problems.append(f'Bootstrap missing: {val} -> {target}')

events=(ROOT/'js'/'events.js').read_text(encoding='utf-8')
if 'serviceWorker.register' in events:
    problems.append('events.js must not re-register the retired service worker')

# The bundled default kit must be real audio, not runtime-generated synth hits.
default_kit=(ROOT/'js'/'default-drum-kit.js').read_text(encoding='utf-8')
expected_default_drums={
    './assets/drums/default/kick.wav',
    './assets/drums/default/snare.wav',
    './assets/drums/default/hat.wav',
}
referenced_default_drums=set(re.findall(r'url:"(\./assets/drums/default/[^"\']+\.wav)"', default_kit))
if referenced_default_drums != expected_default_drums:
    problems.append(
        'Default drum kit must reference exactly kick.wav, snare.wav and hat.wav; '
        f'found: {sorted(referenced_default_drums)}'
    )
for val in sorted(expected_default_drums):
    target=(ROOT/val[2:]).resolve()
    if not target.exists():
        problems.append(f'Default drum missing: {val} -> {target}')
        continue
    try:
        with wave.open(str(target),'rb') as wav:
            if wav.getnchannels()!=1 or wav.getsampwidth()!=2 or wav.getframerate()!=26040:
                problems.append(
                    f'Default drum must be mono PCM16 26040 Hz: {val} '
                    f'({wav.getnchannels()} ch, {wav.getsampwidth()*8}-bit, {wav.getframerate()} Hz)'
                )
    except wave.Error as error:
        problems.append(f'Default drum is not a readable PCM WAV: {val}: {error}')
if 'makeSynthBuffer(' in default_kit or 'synth-fallback' in default_kit:
    problems.append('Default drum kit must not synthesize fallback drums at runtime')
if 'syntheticFallback:false' not in default_kit:
    problems.append('Default drum kit must declare syntheticFallback:false')

assert not problems, '\n'.join(problems)
print('OK: local resource paths resolve, Pages caches stay retired, and bundled default drums are real WAV assets')
