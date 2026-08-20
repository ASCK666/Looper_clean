from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
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
