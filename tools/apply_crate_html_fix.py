from pathlib import Path
import hashlib
import re

root=Path(__file__).resolve().parents[1]

# index.html: real visible crate chrome
p=root/'index.html'
text=p.read_text()
old='''        <section class="panel beatCratePanel">
          <div class="title stableTitle compatHidden"><span>BEAT CRATE</span></div>
          <div class="grid2 beatCrateControls">
            <div><label for="librarySearch">SEARCH</label><input id="librarySearch" placeholder="SEARCH BEATS…"></div>
            <div><label for="libraryOrder">SORT</label><select id="libraryOrder"><option value="name">NAME</option><option value="recent">RECENT</option></select></div>
          </div>
          <div id="library" class="library"></div>
          <div class="beatCrateTransport" role="group" aria-label="Navigation dans le Beat Crate">
            <button id="prevBeat" type="button" aria-label="Beat précédent"><span aria-hidden="true">◀</span> PREVIOUS</button>
            <button id="nextBeat" type="button" aria-label="Beat suivant">NEXT <span aria-hidden="true">▶</span></button>
          </div>
        </section>'''
new='''        <section class="panel beatCratePanel" aria-label="Beat Crate">
          <header class="beatCrateHeader">
            <div><strong>BEAT CRATE</strong><span>LOCAL BEATS</span></div>
            <span id="crateDeckState">SELECT A BEAT</span>
          </header>
          <div class="grid2 beatCrateControls">
            <div><label for="librarySearch">SEARCH</label><input id="librarySearch" placeholder="SEARCH BEATS…"></div>
            <div><label for="libraryOrder">SORT</label><select id="libraryOrder"><option value="name">NAME</option><option value="recent">RECENT</option></select></div>
          </div>
          <div id="library" class="library"></div>
          <div class="beatCrateTransport" role="group" aria-label="Transport du Beat Crate">
            <button id="prevBeat" type="button" aria-label="Beat précédent">◀ PREV</button>
            <button id="cratePlayBeat" type="button" aria-label="Lire le beat sélectionné" disabled>▶ PLAY</button>
            <button id="nextBeat" type="button" aria-label="Beat suivant">NEXT ▶</button>
          </div>
        </section>'''
assert old in text, 'crate markup anchor missing'
p.write_text(text.replace(old,new))

# looper.js: selected-beat state drives visible crate PLAY
p=root/'js'/'looper.js'
text=p.read_text()
old='''  const autoReadout=$("deckAutoReadout");
  if(!zone || !name) return;'''
new='''  const autoReadout=$("deckAutoReadout");
  const cratePlay=$("cratePlayBeat");
  const crateState=$("crateDeckState");
  if(!zone || !name) return;'''
assert old in text
text=text.replace(old,new,1)
old='''  if(speedEcho)speedEcho.textContent=formattedRate;
  if(autoReadout)autoReadout.textContent=autoLooperEnabledState ? "ON" : "OFF";
}'''
new='''  if(speedEcho)speedEcho.textContent=formattedRate;
  if(autoReadout)autoReadout.textContent=autoLooperEnabledState ? "ON" : "OFF";
  if(cratePlay){
    cratePlay.disabled=!loaded;
    cratePlay.textContent=playing ? "↻ RESTART" : "▶ PLAY";
  }
  if(crateState){
    crateState.textContent=!loaded ? "SELECT A BEAT" : playing ? `PLAYING • ${displayName}` : `READY • ${displayName}`;
  }
}'''
assert old in text
text=text.replace(old,new,1)
text=text.replace('  el.dataset.crateTone=String(beatCrateTone(row));\n','  const tone=beatCrateTone(row);\n',1)
old='''  art.className="crateBeatArt";
  art.setAttribute("aria-hidden","true");'''
new='''  art.className="crateBeatArt";
  art.style.backgroundPosition=`${tone*25}% 50%`;
  art.setAttribute("aria-hidden","true");'''
assert old in text
text=text.replace(old,new,1)
text=text.replace('  meta.textContent=`${folderSource?"LOCAL LIBRARY":"USER IMPORT"} • ${row.duration?row.duration.toFixed(1):"?"} s`;','  meta.textContent=`LOAD • ${folderSource?"LOCAL LIBRARY":"USER IMPORT"} • ${row.duration?row.duration.toFixed(1):"?"} s`;',1)
p.write_text(text)

# events.js: crate PLAY is real transport
p=root/'js'/'events.js'
text=p.read_text()
text=text.replace('const deckTransportControlIds=["prevBeat","playBeat","stopBeat","nextBeat","autoLooperToggle","deckAutoToggle","deckPitch"];','const deckTransportControlIds=["prevBeat","cratePlayBeat","playBeat","stopBeat","nextBeat","autoLooperToggle","deckAutoToggle","deckPitch"];',1)
old='''$("playBeat").onclick=()=>runLooperAction("PLAY",playDeck);
$("stopBeat").onclick=()=>stopDeck();'''
new='''$("playBeat").onclick=()=>runLooperAction("PLAY",playDeck);
$("cratePlayBeat").onclick=()=>runLooperAction("CRATE PLAY",playDeck);
$("stopBeat").onclick=()=>stopDeck();'''
assert old in text
p.write_text(text.replace(old,new,1))

# looper.css: retire transparent image-hotspot crate
p=root/'css'/'looper.css'
css=p.read_text()
replacements={
    '.looper66Shell .deckLoadKey,#looper .beatCrateTransport button {':'.looper66Shell .deckLoadKey {',
    '.looper66Shell .deckLoadKey strong,#looper .beatCrateTransport button > span { opacity:0; }':'.looper66Shell .deckLoadKey strong { opacity:0; }',
    '.looper66Shell .deckLoadKey::before,#looper .beatCrateTransport button::before {':'.looper66Shell .deckLoadKey::before {',
    '.looper66Shell .deckLoadKey:hover,.looper66Shell .deckLoadKey:focus-visible,#looper .beatCrateTransport button:hover,#looper .beatCrateTransport button:focus-visible { --light-strength:.35; }':'.looper66Shell .deckLoadKey:hover,.looper66Shell .deckLoadKey:focus-visible { --light-strength:.35; }',
    '.looper66Shell .deckLoadKey:active,#looper .beatCrateTransport button:active { --light-strength:1; }':'.looper66Shell .deckLoadKey:active { --light-strength:1; }',
}
for a,b in replacements.items():
    assert a in css,a
    css=css.replace(a,b,1)

start=css.index('/* Beat Crate Digger — one Looper-owned component, no legacy rack path. */')
end=css.index('#looper button:focus-visible',start)
crate_css='''/* Beat Crate Digger — functional HTML/CSS surface; the skin owns no crate controls. */
#looper .beatCratePanel::before { content:"";position:absolute;z-index:3;top:55.35%;left:3.25%;width:93.5%;height:39.9%;box-sizing:border-box;border:1px solid #3d2d1e;border-radius:5px;background:linear-gradient(180deg,rgba(15,12,9,.97),rgba(5,4,3,.98));box-shadow:inset 0 0 0 1px #120e0a,inset 0 10px 28px rgba(0,0,0,.52),0 2px 8px rgba(0,0,0,.45);pointer-events:none; }
#looper .beatCrateHeader { position:absolute;z-index:4;top:56.15%;left:4%;width:92%;height:3.2%;display:flex;align-items:center;justify-content:space-between;color:#8a6338;font-family:var(--font-mono);pointer-events:none; }
#looper .beatCrateHeader>div { display:flex;align-items:baseline;gap:10px;min-width:0; }
#looper .beatCrateHeader strong { color:#ef9d2d;font-size:clamp(8px,1vw,14px);letter-spacing:.12em; }
#looper .beatCrateHeader span { overflow:hidden;font-size:clamp(6px,.66vw,9px);letter-spacing:.08em;text-overflow:ellipsis;white-space:nowrap; }
#looper .beatCrateControls { position:absolute;z-index:4;top:59.65%;left:4%;width:92%;height:4.2%;display:grid;grid-template-columns:minmax(0,2fr) minmax(110px,.72fr);gap:.8%;pointer-events:auto; }
#looper .beatCrateControls>div { display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:6px;min-width:0; }
#looper .beatCrateControls label { margin:0;color:#9a6a32;font:600 clamp(6px,.66vw,9px)/1 var(--font-mono);letter-spacing:.08em; }
#looper .beatCrateControls input,#looper .beatCrateControls select { width:100%;height:100%;min-height:0;margin:0;padding:0 8px;border:1px solid #4b3520;border-radius:2px;color:#ffc15f;background:#080604;font:600 clamp(7px,.78vw,11px)/1 var(--font-mono);box-shadow:inset 0 1px 5px rgba(0,0,0,.8); }
#looper .beatCrateControls input::placeholder { color:#74522d;opacity:1; }
#looper .library { position:absolute;z-index:4;top:64.55%;left:4%;width:92%;height:22.15%;min-height:0;box-sizing:border-box;display:grid;grid-template-rows:auto minmax(0,1fr);gap:5px;overflow:hidden;padding:5px;border:1px solid #302317;border-radius:3px;background:#050403;box-shadow:inset 0 0 16px rgba(0,0,0,.8);pointer-events:auto; }
#looper .beatCrateToolbar { display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:5px;align-items:center;min-height:30px; }
#looper .crateModeGroup { display:flex;min-width:0;gap:4px; }
#looper .crateModeButton,#looper .crateDigButton { min-width:0;min-height:30px;padding:0 10px;border:1px solid #4a3521;border-radius:2px;color:#ca8429;background:linear-gradient(#171008,#090604);font:700 clamp(7px,.78vw,11px)/1 var(--font-mono);letter-spacing:.04em;white-space:nowrap;cursor:pointer; }
#looper .crateModeButton[aria-pressed="true"],#looper .crateDigButton:hover,#looper .crateDigButton:focus-visible { border-color:#b8711c;color:#ffe0a2;background:linear-gradient(#352007,#160d03); }
#looper .crateDigButton { min-width:64px;color:#ffc15b; }
#looper .crateModeStatus { min-width:0;overflow:hidden;color:#8d653a;font:600 clamp(6px,.65vw,9px)/1 var(--font-mono);text-align:right;text-overflow:ellipsis;white-space:nowrap; }
#looper .beatCrateGrid { min-height:0;display:grid;grid-auto-flow:column;grid-template-rows:repeat(2,minmax(0,1fr));grid-auto-columns:minmax(235px,32.8%);gap:5px;overflow-x:auto;overflow-y:hidden;padding:3px;scrollbar-width:thin;scroll-snap-type:x proximity; }
#looper .crateBeat { position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;min-width:0;min-height:0;border:1px solid #352819;border-radius:3px;background:linear-gradient(180deg,#12100d,#080604);box-shadow:0 2px 5px rgba(0,0,0,.45);scroll-snap-align:start;transition:transform .14s ease,border-color .14s ease; }
#looper .crateBeat.active { z-index:2;transform:translateY(-3px);border-color:#c4781c;box-shadow:0 0 9px rgba(255,152,15,.2); }
#looper .crateBeatLoad { display:grid;grid-template-columns:70px minmax(0,1fr);min-width:0;height:100%;padding:4px 3px;border:0;color:inherit;background:transparent;cursor:pointer; }
#looper .crateBeatArt { width:60px;height:31px;align-self:center;justify-self:center;background:url("../assets/looper-ui/looper66-crate-cassettes.webp") 0 50%/500% 100% no-repeat;filter:brightness(.82) saturate(.78); }
#looper .crateBeatCopy { display:flex;min-width:0;flex-direction:column;justify-content:center;padding-right:5px;text-align:left; }
#looper .crateBeatCopy strong { width:100%;overflow:hidden;color:#f0a23a;font:700 clamp(7px,.92vw,13px)/1 var(--font-mono);text-overflow:ellipsis;white-space:nowrap; }
#looper .crateBeatCopy small { width:100%;margin-top:6px;overflow:hidden;color:#8a633b;font:600 clamp(5px,.58vw,8px)/1 var(--font-mono);text-overflow:ellipsis;white-space:nowrap; }
#looper .crateBeatActions { display:grid;grid-template-columns:repeat(2,30px);grid-template-rows:repeat(2,1fr);gap:3px;align-content:center;padding:4px; }
#looper .crateFlag,#looper .crateBeatDelete { min-width:30px;min-height:27px;padding:0;border:1px solid #44311e;border-radius:2px;color:#946b3e;background:#090705;font:700 9px/1 var(--font-mono);cursor:pointer; }
#looper .crateFlag[aria-pressed="true"] { border-color:#b86d17;color:#ffe0a2;background:#321d05; }
#looper .crateBeatSource { grid-column:1/-1;align-self:center;color:#84603a;font:700 7px/1 var(--font-mono);letter-spacing:.08em;text-align:center; }
#looper .crateBeatDelete { grid-column:1/-1;color:#b36d48;font-size:14px; }
#looper .crateEmptyState { grid-row:1/-1;display:grid;place-items:center;min-width:260px;border:1px dashed #4a3522;color:#8c6336;background:#080604;font:700 clamp(7px,.8vw,11px)/1.4 var(--font-mono);letter-spacing:.06em;text-align:center; }
#looper .beatCrateTransport { position:absolute;z-index:4;left:4%;bottom:3.9%;width:92%;height:6.6%;display:grid;grid-template-columns:1fr 1.15fr 1fr;gap:1%;margin:0;pointer-events:auto; }
#looper .beatCrateTransport button { min-width:0;min-height:44px;padding:0 10px;border:1px solid #513820;border-radius:3px;color:#d79a48;background:linear-gradient(#18110a,#090604);box-shadow:inset 0 1px #302216,0 2px 5px rgba(0,0,0,.45);font:800 clamp(8px,.9vw,13px)/1 var(--font-mono);letter-spacing:.06em;cursor:pointer; }
#looper .beatCrateTransport button:is(:hover,:focus-visible) { border-color:#b66e1d;color:#ffe0a0; }
#looper #cratePlayBeat { border-color:#a76516;color:#1b1003;background:linear-gradient(#ffbd55,#c87518);text-shadow:0 1px rgba(255,255,255,.24); }
#looper #cratePlayBeat:disabled { opacity:.34;filter:grayscale(.75);cursor:not-allowed; }
'''
css=css[:start]+crate_css+'\n'+css[end:]

mobile_start=css.index('  #looper .beatCrateControls { top:69.1%;')
mobile_end=css.index('  #looper .beatCrateTransport button { min-height:44px; }',mobile_start)+len('  #looper .beatCrateTransport button { min-height:44px; }')
mobile='''  #looper .beatCratePanel::before { top:68.35%;left:6.5%;width:87%;height:30.3%; }
  #looper .beatCrateHeader { top:69%;left:8%;width:84%;height:2.4%; }
  #looper .beatCrateHeader>div { gap:6px; }
  #looper .beatCrateHeader strong { font-size:9px; }
  #looper .beatCrateHeader span { font-size:6px; }
  #looper .beatCrateControls { top:71.7%;left:8%;width:84%;height:5.2%;grid-template-columns:minmax(0,1fr) 35%;gap:2%; }
  #looper .beatCrateControls>div { grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr);gap:1px; }
  #looper .beatCrateControls label { font-size:6px; }
  #looper .beatCrateControls input,#looper .beatCrateControls select { min-height:30px;padding:0 6px;font-size:9px; }
  #looper .library { top:77.35%;left:8%;width:84%;height:15.35%;grid-template-rows:auto minmax(0,1fr);gap:4px;padding:4px; }
  #looper .beatCrateToolbar { grid-template-columns:minmax(0,1fr) 54px;grid-template-rows:38px 13px;gap:3px;min-height:0; }
  #looper .crateModeGroup { gap:2px; }
  #looper .crateModeButton,#looper .crateDigButton { min-height:38px;padding:0 5px;font-size:8px; }
  #looper .crateDigButton { min-width:54px; }
  #looper .crateModeStatus { grid-column:1/-1;font-size:7px;text-align:left; }
  #looper .beatCrateGrid { display:flex;flex-direction:column;gap:5px;overflow-x:hidden;overflow-y:auto;padding:3px;scroll-snap-type:y proximity; }
  #looper .crateBeat { flex:0 0 62px;min-height:62px;scroll-snap-align:start; }
  #looper .crateBeat.active { transform:translateX(3px); }
  #looper .crateBeatLoad { grid-template-columns:58px minmax(0,1fr); }
  #looper .crateBeatArt { width:52px;height:29px; }
  #looper .crateBeatCopy strong { font-size:10px; }
  #looper .crateBeatCopy small { margin-top:5px;font-size:6px; }
  #looper .crateBeatActions { grid-template-columns:repeat(2,28px);padding:3px; }
  #looper .crateFlag,#looper .crateBeatDelete { min-width:28px;min-height:27px; }
  #looper .beatCrateTransport { left:8%;bottom:1.35%;width:84%;height:44px;gap:2%; }
  #looper .beatCrateTransport button { min-height:44px;padding:0 4px;font-size:9px; }
'''
css=css[:mobile_start]+mobile+css[mobile_end:]
p.write_text(css)

# asset health/contract alignment
desktop='looper66-desktop-pitch-clean-no-crate-7907d094.webp'
mobile_asset='looper66-mobile-pitch-clean-no-crate-933411c6.webp'
old_desktop='looper66-desktop-pitch-clean-1e6d4f36.webp'
old_mobile='looper66-mobile-pitch-clean-c034fcbb.webp'
desktop_sha=hashlib.sha256((root/'assets'/'looper-ui'/desktop).read_bytes()).hexdigest()
mobile_sha=hashlib.sha256((root/'assets'/'looper-ui'/mobile_asset).read_bytes()).hexdigest()

p=root/'tests'/'assets_health.py'
text=p.read_text().replace(old_desktop,desktop).replace(old_mobile,mobile_asset)
p.write_text(text)

p=root/'tests'/'looper66_contract.py'
text=p.read_text().replace(old_desktop,desktop).replace(old_mobile,mobile_asset)
text=re.sub(rf"'{re.escape(desktop)}':\(\(1086,1009\),'[^']+'\),",f"'{desktop}':((1086,1009),'{desktop_sha}'),",text)
text=re.sub(rf"'{re.escape(mobile_asset)}':\(\(441,849\),'[^']+'\),",f"'{mobile_asset}':((441,849),'{mobile_sha}'),",text)
anchor="assert '#looper .beatCrateControls { display:none!important; }' not in CSS\n"
extra='''assert 'id="cratePlayBeat"' in HTML and 'id="crateDeckState"' in HTML
assert '.beatCratePanel::before' in CSS and '.beatCrateHeader' in CSS
assert '.deckLoadKey,#looper .beatCrateTransport button' not in CSS
assert '$("cratePlayBeat").onclick=()=>runLooperAction("CRATE PLAY",playDeck);' in EVENTS
'''
assert anchor in text
text=text.replace(anchor,anchor+extra,1)
p.write_text(text)

# browser contract: the crate itself must start audio
p=root/'tests'/'browser_smoke.py'
text=p.read_text().replace('#library .track','#library .crateBeat')
text=text.replace("'playBeat','stopBeat','prevBeat','nextBeat','importBeatsBtn'","'playBeat','stopBeat','prevBeat','nextBeat','cratePlayBeat','importBeatsBtn'",1)
text=text.replace("['playBeat','stopBeat','loadSampleBtn'","['playBeat','cratePlayBeat','stopBeat','loadSampleBtn'",1)
text=text.replace("['playBeat','stopBeat','prevBeat','nextBeat','autoLooperToggle'","['playBeat','stopBeat','prevBeat','nextBeat','cratePlayBeat','autoLooperToggle'",1)
anchor="        assert all(v[1]>=44 and v[2]>=44 and v[3]!='none' and v[4]=='visible' and v[5]>.5 for v in visible),visible\n"
assert anchor in text
text=text.replace(anchor,anchor+"        assert page.locator('#cratePlayBeat').is_disabled()\n",1)
old="""        assert page.locator('#library .crateBeat').count()==1
        page.click('#playBeat'); page.wait_for_function('deckSource !== null')"""
new="""        assert page.locator('#library .crateBeat').count()==1
        assert not page.locator('#cratePlayBeat').is_disabled()
        page.click('#cratePlayBeat'); page.wait_for_function('deckSource !== null')"""
assert old in text
text=text.replace(old,new,1)
p.write_text(text)

for path in [root/'index.html',root/'css'/'looper.css',root/'tests'/'assets_health.py',root/'tests'/'looper66_contract.py']:
    body=path.read_text()
    assert old_desktop not in body,(path,old_desktop)
    assert old_mobile not in body,(path,old_mobile)
