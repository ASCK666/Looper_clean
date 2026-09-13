#!/usr/bin/env python3
"""Validate current runtime structure without freezing historical implementation details."""

from collections import Counter
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
BASE_CSS = (ROOT / "css" / "base.css").read_text(encoding="utf-8")
RUNTIME_FILES = [
    ROOT / "js" / "bootstrap.js",
    ROOT / "js" / "core.js",
    ROOT / "js" / "looper.js",
    ROOT / "js" / "looper-view.js",
    ROOT / "js" / "chopper.js",
    ROOT / "js" / "drums.js",
    ROOT / "js" / "events.js",
]
JS = "\n".join(path.read_text(encoding="utf-8") for path in RUNTIME_FILES)
SW = (ROOT / "sw.js").read_text(encoding="utf-8")

failures = []

def require(name, condition, detail=""):
    if not condition:
        failures.append(f"{name}{': ' + detail if detail else ''}")

for rel in [
    "index.html",
    "manifest.json",
    "sw.js",
    "css/base.css",
    "css/looper.css",
    "js/bootstrap.js",
    "js/core.js",
    "js/looper.js",
    "js/looper-view.js",
    "js/chopper.js",
    "js/drums.js",
    "js/events.js",
    "assets/deck-black-ui-texture.png",
    "assets/looper-ui/120927/mockup-reference.png",
    "assets/looper-ui/120927/desk-surface.webp",
    "assets/looper-ui/120927/rear-cables.webp",
    "assets/looper-ui/120927/deck-shell.webp",
    "assets/looper-ui/120927/readout-panel.webp",
    "assets/looper-ui/120927/utility-panel.webp",
    "assets/looper-ui/120927/pitch-panel.webp",
    "assets/looper-ui/120927/cassette-support.webp",
    "assets/looper-ui/120927/cassette-shell.svg",
    "assets/looper-ui/120927/cassette-spool.svg",
]:
    require(f"file {rel}", (ROOT / rel).is_file())

require("retired Practice script deleted", not (ROOT / "js" / "practice.js").exists())
require("retired Practice script absent from HTML", "./js/practice.js" not in HTML)
for marker in [
    'id="practice"','id="practiceOverlayClose"','id="practiceLevel"','id="practiceSub"',
    'id="practiceTempo"','id="practiceBars"','id="newPattern"','id="startPractice"',
    'id="practiceAuto"','id="patternCycles"','id="practiceName"','id="practiceNotation"',
    'id="practiceGrid"','id="practiceCount"',
]:
    require(f"retired Practice DOM {marker}", marker not in HTML)
for symbol in [
    "makePractice","renderPracticeGrid","stopPractice","tickPractice","startPractice",
    "practicePattern","practiceStep","practiceTimer","practiceCyclesDone",
]:
    require(f"retired Practice runtime symbol {symbol}", symbol not in JS)
for selector in ["#practice",".practiceCard",".practiceName",".practiceClose",".beatgrid"]:
    require(f"retired Practice CSS selector {selector}", selector not in BASE_CSS)

ids = re.findall(r'\bid="([^"]+)"', HTML)
duplicates = sorted(name for name, count in Counter(ids).items() if count > 1)
require("no duplicate ids", not duplicates, ", ".join(duplicates))

literal_dom_refs = sorted(set(re.findall(r'\$\("([^"]+)"\)', JS)))
optional_dom_refs={"deckAutoToggle"}
missing_refs = [name for name in literal_dom_refs if name not in optional_dom_refs and f'id="{name}"' not in HTML]
require("all required literal $() DOM refs exist", not missing_refs, ", ".join(missing_refs))

for path in [*RUNTIME_FILES, ROOT / "sw.js"]:
    proc = subprocess.run(["node", "--check", str(path)],capture_output=True,text=True)
    require(f"node --check {path.name}", proc.returncode == 0, proc.stderr.strip())

sw_intercepts_fetch = bool(re.search(r'addEventListener\s*\(\s*["\']fetch["\']', SW))
if sw_intercepts_fetch:
    require("service worker same-origin guard", "url.origin!==self.location.origin" in SW)
    require("service worker bounded cache", "STATIC_PATHS.has(url.pathname)" in SW)
else:
    require("service worker retirement unregister", "self.registration.unregister()" in SW)
    require("service worker retirement cache purge", "scratch-practice-" in SW and "caches.keys()" in SW)

require("no eval", "eval(" not in JS)
require("no dynamic Function constructor", "new Function" not in JS)
require("no document.write", "document.write" not in JS)
require("no insertAdjacentHTML", "insertAdjacentHTML" not in JS)
require("no remote application URLs", not re.search(r"https?://", HTML + JS))

inner_html = [m.group(0) for m in re.finditer(r"\.innerHTML\s*=\s*([^;]+);", JS)]
unsafe_inner_html = [expr for expr in inner_html if not re.search(r"innerHTML\s*=\s*[\"']{2}", expr)]
require("innerHTML only clears trusted UI", not unsafe_inner_html, "; ".join(unsafe_inner_html))

for token in ["MAX_BEAT_FILE_BYTES", "MAX_SAMPLE_FILE_BYTES", "MAX_DRUM_FILE_BYTES"]:
    require(f"local file guard {token}", token in JS)
require("local UUID fallback", "function localId()" in JS)
require("Windows filename hardening", "CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]" in JS)

if failures:
    for failure in failures:
        print(f"FAIL: {failure}")
    sys.exit(1)

print("OK: runtime contract — deployable files, DOM refs, JS syntax and generic security guards")
