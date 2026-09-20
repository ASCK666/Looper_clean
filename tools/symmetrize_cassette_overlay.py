from pathlib import Path
from PIL import Image, ImageChops, ImageOps

ROOT=Path(__file__).resolve().parents[1]
path=ROOT/'assets'/'looper-ui'/'120927'/'cassette-reference-overlay.webp'
image=Image.open(path).convert('RGBA')
width,height=image.size
assert (width,height)==(542,347)
assert width % 2 == 0

half=width//2
right=image.crop((half,0,width,height))
symmetric=Image.new('RGBA',(width,height))
symmetric.paste(ImageOps.mirror(right),(0,0))
symmetric.paste(right,(half,0))

if ImageChops.difference(image,symmetric).getbbox() is None:
    print('overlay already symmetric')
else:
    symmetric.save(path,'WEBP',lossless=True,method=6,exact=True)
    print('symmetrized cassette-reference-overlay.webp from the cleaner right half')
