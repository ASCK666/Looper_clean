from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
loader=(ROOT/'js/chopper-wave-slices.js').read_text(encoding='utf-8')
assert 'await loadDefaultSample();' not in loader
assert '.addEventListener("click",requestDefaultSample,{once:true})' in loader
assert 'if(chopper?.classList.contains("active"))' in loader
assert './js/chopper-banks.js' in loader
core_pos=loader.index('./js/chopper-wave-slices-core.js')
banks_pos=loader.index('./js/chopper-banks.js')
default_call_pos=loader.rindex('    loadDefaultSampleOnChopperOpen();')
assert core_pos < banks_pos < default_call_pos

html=(ROOT/'index.html').read_text(encoding='utf-8')
runtime_order=[
    './js/chopper-drum-controls.js',
    './js/chopper-wave-slices-core.js',
    './js/chopper-banks.js',
    './js/chopper-folder-reconnect.js',
    './js/chopper-wave-slices.js',
]
positions=[html.index(f'src="{path}"') for path in runtime_order]
assert positions==sorted(positions),'Chopper feature scripts must stay explicit and ordered in index.html'

legacy=ROOT/'tests/chopper_wave_slices_legacy.py'
source=legacy.read_text(encoding='utf-8')
needle="js/chopper-wave-slices.js"
replacement="js/chopper-wave-slices-core.js"
assert needle in source,'legacy Chopper slice test no longer references the feature path'
source=source.replace(needle,replacement)
namespace={
    '__name__':'__main__',
    '__file__':str(legacy),
    '__builtins__':__builtins__,
}
exec(compile(source,str(legacy),'exec'),namespace)
