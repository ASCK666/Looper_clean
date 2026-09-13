"""Cassette contract for the approved 120927 deck."""
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'index.html').read_text(encoding='utf-8')
css=(ROOT/'css/looper.css').read_text(encoding='utf-8')
ns='{http://www.w3.org/2000/svg}'

expected={
    'cassetteReel cassetteReelLeft':('cassette-reel.svg','0 0 128 128'),
    'cassetteReel cassetteReelRight':('cassette-reel.svg','0 0 128 128'),
    'cassetteTape':('cassette-body.svg','0 0 900 600'),
    'cassetteBayForeground':('cassette-frame.svg','0 0 900 600'),
}
for class_name,(asset,viewbox) in expected.items():
    tag=re.search(rf'<img\b[^>]*class="{class_name}"[^>]*>',html)
    assert tag,class_name
    tag=tag.group()
    assert f'src="assets/looper-ui/120927/{asset}"' in tag
    assert 'alt=""' in tag and 'aria-hidden="true"' in tag
    root=ET.parse(ROOT/'assets/looper-ui/120927'/asset).getroot()
    assert root.attrib['viewBox']==viewbox,(asset,root.attrib.get('viewBox'))
    assert not list(root.iter(ns+'image')),asset
    assert not list(root.iter(ns+'text')),asset
    assert not list(root.iter(ns+'filter')),asset

body=ET.parse(ROOT/'assets/looper-ui/120927/cassette-body.svg').getroot()
# The shell uses even-odd cut-outs for the reel apertures instead of painting reels on top.
body_paths=list(body.iter(ns+'path'))
assert any(p.attrib.get('fill-rule')=='evenodd' for p in body_paths)
frame=(ROOT/'assets/looper-ui/120927/cassette-frame.svg').read_text(encoding='utf-8')
assert 'glass' in frame.lower()
assert '<circle' not in frame  # no screws placed on the glass/door asset

assert 'aspect-ratio:3/2' in css
assert '.cassetteReel {\n  z-index:1;' in css
assert '#looper .cassetteTape { z-index:2; }' in css
assert '#looper .cassetteBayForeground { z-index:5; }' in css
assert 'animation-play-state:paused' in css
assert '.cassetteDeck.playing .cassetteReel { animation-play-state:running; }' in css
assert 'animation-duration:var(--takeup-reel-cycle)' in css
assert 'cassetteGlass' not in html+css
print('OK: 120927 cassette is layered, masked and mechanically animated')
