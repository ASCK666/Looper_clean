"""Cassette contract for the approved 120927 deck."""
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'index.html').read_text(encoding='utf-8')
css=(ROOT/'css/looper.css').read_text(encoding='utf-8')
ns='{http://www.w3.org/2000/svg}'

expected={
    'cassetteReel cassetteReelLeft':('cassette-reel.svg','0 0 128 128','reference-raster'),
    'cassetteReel cassetteReelRight':('cassette-reel.svg','0 0 128 128','reference-raster'),
    'cassetteTape':('cassette-body.svg','0 0 442 252','reference-raster'),
}
for class_name,(asset,viewbox,kind) in expected.items():
    tag=re.search(rf'<img\b[^>]*class="{class_name}"[^>]*>',html)
    assert tag,class_name
    tag=tag.group()
    assert f'src="assets/looper-ui/120927/{asset}"' in tag
    assert 'alt=""' in tag and 'aria-hidden="true"' in tag
    root=ET.parse(ROOT/'assets/looper-ui/120927'/asset).getroot()
    assert root.attrib['viewBox']==viewbox,(asset,root.attrib.get('viewBox'))
    images=list(root.iter(ns+'image'))
    if kind=='reference-raster':
        # Physical cassette material comes directly from the approved mockup,
        # embedded locally so the asset stays deterministic and self-contained.
        assert images,asset
        href=images[0].attrib.get('href','')
        assert href.startswith('data:image/webp;base64,'),(asset,href[:32])
        assert 'http://' not in href and 'https://' not in href
    else:
        assert not images,asset
    assert not list(root.iter(ns+'text')),asset
    assert not list(root.iter(ns+'filter')),asset

body=ET.parse(ROOT/'assets/looper-ui/120927/cassette-body.svg').getroot()
# The live reels stay physically behind two transparent apertures in the body.
masks=list(body.iter(ns+'mask'))
assert masks
apertures=list(masks[0].iter(ns+'circle'))
assert len(apertures)==2
assert all(float(c.attrib['r'])>=20 for c in apertures)
assert 'aspect-ratio:442/252' in css
# Z-order is a visual contract; do not couple it to whitespace or selector prefixes.
for selector,level in (
    ('.cassetteReel',1),
    ('.cassetteTape',2),
):
    assert re.search(rf'{re.escape(selector)}\s*\{{[^}}]*z-index\s*:\s*{level}(?:\s*;|\s*\}})',css,re.S),(selector,level)
assert 'animation-play-state:paused' in css
assert re.search(r'\.cassetteDeck\.playing\s+\.cassetteReel\s*\{[^}]*animation-play-state\s*:\s*running',css,re.S)
assert 'animation-duration:var(--takeup-reel-cycle)' in css
assert 'cassetteGlass' not in html+css
print('OK: 120927 cassette is reference-derived, layered, masked and mechanically animated')
