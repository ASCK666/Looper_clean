"use strict";

// looper-next: two explicit Chopper edit modes without changing waveform height.
// MARKERS deliberately leaves the maintained chopper.js marker editor untouched.
// SLICES is a separate 1..16 pad model. It starts with four coarse regions,
// supports independent attack/tail trimming, and adds slices by double-click.
// Slices are always ordered left-to-right and never overlap; deliberate gaps are
// valid so a tail can be tightened without moving the next attack.
(() => {
  const root=document.getElementById("chopper");
  const waveCanvas=document.getElementById("waveCanvas");
  const overlayCanvas=document.getElementById("playheadCanvas");
  const waveScroll=document.getElementById("waveScroll");
  const waveZoom=document.getElementById("waveZoom");
  const displayTitle=root?.querySelector(".samplerScreenModule > .stableTitle");
  if(!root || !waveCanvas || !overlayCanvas || !displayTitle || root.dataset.waveSliceEditorInstalled==="1")return;
  if(typeof drawWave!=="function" || typeof renderPads!=="function" || typeof previewSlice!=="function")return;
  root.dataset.waveSliceEditorInstalled="1";

  const MODE_MARKERS="markers";
  const MODE_SLICES="slices";
  const INITIAL_SLICES=4;
  const MAX_SLICES=16;
  const MIN_SLICE_SEC=.008;
  const FLASH_MS=190;
  const DRAG_THRESHOLD_PX=4;
  const EDGE_GRAB_PX=14;
  const MIN_SCROLL_THUMB_PX=34;

  let editMode=MODE_MARKERS;
  let independentSlices=[];
  let independentDirty=false;
  let selectedSlice=0;
  let activeSlice=-1;
  let flashSlice=-1;
  let flashUntil=0;
  let dragSlice=-1;
  let dragEdge=null;
  let dragPointerId=null;
  let dragStartClientX=0;
  let dragMoved=false;
  let viewportPinned=false;
  let viewportBuffer=null;

  const modeButton=document.createElement("button");
  modeButton.id="sliceEditModeBtn";
  modeButton.type="button";
  modeButton.className="chopModeToggle";
  const displayLabel=displayTitle.querySelector("span");
  if(displayLabel?.nextSibling)displayTitle.insertBefore(modeButton,displayLabel.nextSibling);
  else displayTitle.appendChild(modeButton);

  waveCanvas.tabIndex=0;

  const style=document.createElement("style");
  style.dataset.chopperWaveSlices="1";
  style.textContent=`
    #chopper .samplerScreenModule > .stableTitle {
      display:flex !important;
      align-items:center !important;
      gap:7px !important;
      white-space:nowrap;
    }
    #chopper .chopModeToggle {
      min-height:22px !important;
      width:auto !important;
      margin:0 !important;
      padding:4px 7px !important;
      border:1px solid #514131 !important;
      border-radius:3px !important;
      color:#cdb792 !important;
      background:linear-gradient(180deg,#1b1712,#0d0a07) !important;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.025) !important;
      font:800 8px/1 var(--font-mono) !important;
      letter-spacing:.6px !important;
      cursor:pointer;
    }
    #chopper .chopModeToggle[data-mode="slices"] {
      color:#ffe0a5 !important;
      border-color:#9a7038 !important;
      background:linear-gradient(180deg,#4b321d,#24170e) !important;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 0 10px rgba(226,173,95,.11) !important;
    }
    #chopper #waveCanvas[data-edit-mode="slices"] { cursor:pointer; }
    #chopper #waveCanvas[data-edit-mode="slices"]:focus {
      outline:1px solid rgba(226,173,95,.48);
      outline-offset:-2px;
    }
    #chopper .pad.slice-selected:not(.hit):not(.active) {
      color:#ffe6b8 !important;
      border-color:#9a7038 !important;
      background:
        radial-gradient(circle at 50% 112%,rgba(226,173,95,.24),transparent 60%),
        linear-gradient(180deg,#4b321d 0%,#2c1d11 52%,#140d08 100%) !important;
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.055),
        inset 0 -10px 20px rgba(226,173,95,.10),
        0 0 12px rgba(226,173,95,.20),
        0 5px 9px rgba(0,0,0,.32) !important;
    }
    #chopper .waveScrollbar {
      height:14px !important;
      bottom:5px !important;
      align-items:center !important;
    }
    #chopper .waveScrollbar input[type="range"] {
      --wave-scroll-thumb:34px;
      height:14px !important;
      margin:0 !important;
      cursor:ew-resize !important;
    }
    #chopper .waveScrollbar input[type="range"]::-webkit-slider-runnable-track {
      height:6px !important;
      border:1px solid #584128 !important;
      border-radius:3px !important;
      background:#120d08 !important;
      box-shadow:inset 0 1px 2px rgba(0,0,0,.72) !important;
    }
    #chopper .waveScrollbar input[type="range"]::-webkit-slider-thumb {
      width:var(--wave-scroll-thumb) !important;
      height:12px !important;
      margin-top:-4px !important;
      border:1px solid #a67b43 !important;
      border-radius:3px !important;
      background:linear-gradient(180deg,#80603d,#4b3522) !important;
      box-shadow:inset 0 1px rgba(255,255,255,.08),0 1px 3px rgba(0,0,0,.55) !important;
    }
    #chopper .waveScrollbar input[type="range"]::-moz-range-track {
      height:6px !important;
      border:1px solid #584128 !important;
      border-radius:3px !important;
      background:#120d08 !important;
      box-shadow:inset 0 1px 2px rgba(0,0,0,.72) !important;
    }
    #chopper .waveScrollbar input[type="range"]::-moz-range-thumb {
      width:var(--wave-scroll-thumb) !important;
      height:12px !important;
      border:1px solid #a67b43 !important;
      border-radius:3px !important;
      background:linear-gradient(180deg,#80603d,#4b3522) !important;
      box-shadow:inset 0 1px rgba(255,255,255,.08),0 1px 3px rgba(0,0,0,.55) !important;
    }
    #chopper[data-wave-viewport-pinned="1"] .waveScrollbar input[type="range"]::-webkit-slider-thumb {
      border-color:#e2ad5f !important;
      box-shadow:inset 0 1px rgba(255,255,255,.09),0 0 7px rgba(226,173,95,.28) !important;
    }
    #chopper[data-wave-viewport-pinned="1"] .waveScrollbar input[type="range"]::-moz-range-thumb {
      border-color:#e2ad5f !important;
      box-shadow:inset 0 1px rgba(255,255,255,.09),0 0 7px rgba(226,173,95,.28) !important;
    }
    #chopper .waveScrollbar input[type="range"]:disabled {
      cursor:default !important;
      opacity:.52;
    }`;
  document.head.appendChild(style);

  function setViewportPinned(value){
    viewportPinned=Boolean(value);
    root.dataset.waveViewportPinned=viewportPinned?"1":"0";
    return viewportPinned;
  }

  function syncWaveScrollbar(){
    if(!waveScroll || !waveZoom)return;

    if(sampleBuffer!==viewportBuffer){
      viewportBuffer=sampleBuffer||null;
      setViewportPinned(false);
    }

    const zoom=Math.max(1,Number(waveZoom.value)||1);
    const canScroll=Boolean(sampleBuffer) && zoom>1;
    if(!canScroll && viewportPinned)setViewportPinned(false);

    const trackWidth=Math.max(0,waveScroll.clientWidth||waveScroll.getBoundingClientRect().width||0);
    const visibleRatio=1/zoom;
    const thumbPx=trackWidth>0
      ? clamp(trackWidth*visibleRatio,Math.min(MIN_SCROLL_THUMB_PX,trackWidth),trackWidth)
      : MIN_SCROLL_THUMB_PX;
    waveScroll.style.setProperty("--wave-scroll-thumb",`${Math.round(thumbPx)}px`);
    waveScroll.disabled=!canScroll;

    const position=Math.round(clamp((Number(waveScroll.value)||0)/10,0,100));
    const visiblePercent=Math.round(clamp(visibleRatio*100,0,100));
    waveScroll.setAttribute(
      "aria-valuetext",
      canScroll
        ? `Position ${position}% • fenêtre ${visiblePercent}% du sample`
        : "Waveform entier visible"
    );
  }

  function pinEditedViewport(){
    if(!sampleBuffer || !waveZoom || Number(waveZoom.value)<=1)return false;
    return setViewportPinned(true);
  }

  function markerSliceCount(){
    return Math.min(MAX_SLICES,Math.max(0,markers.length-1));
  }

  function sliceCount(){
    return editMode===MODE_SLICES
      ? Math.min(MAX_SLICES,independentSlices.length)
      : markerSliceCount();
  }

  function clampSlice(index){
    const count=sliceCount();
    if(!count)return -1;
    return clamp(Math.round(Number(index)||0),0,count-1);
  }

  function markerBoundaryForFraction(fraction){
    const markerCount=markerSliceCount();
    if(markerCount>=INITIAL_SLICES){
      const index=clamp(Math.round(markerCount*fraction),0,markerCount);
      const value=Number(markers[index]);
      if(Number.isFinite(value))return value;
    }
    return (sampleBuffer?.duration||0)*fraction;
  }

  function seedInitialSlices(){
    if(!sampleBuffer){
      independentSlices=[];
      independentDirty=false;
      selectedSlice=0;
      return;
    }

    const boundaries=[];
    for(let i=0;i<=INITIAL_SLICES;i++){
      boundaries.push(markerBoundaryForFraction(i/INITIAL_SLICES));
    }
    boundaries[0]=0;
    boundaries[boundaries.length-1]=sampleBuffer.duration;

    let valid=true;
    for(let i=1;i<boundaries.length;i++){
      if(!(boundaries[i]-boundaries[i-1]>=MIN_SLICE_SEC)){valid=false;break;}
    }
    if(!valid){
      for(let i=0;i<=INITIAL_SLICES;i++)boundaries[i]=sampleBuffer.duration*i/INITIAL_SLICES;
    }

    independentSlices=Array.from({length:INITIAL_SLICES},(_,i)=>(
      {start:boundaries[i],end:boundaries[i+1]}
    ));
    independentDirty=false;
    selectedSlice=clamp(selectedSlice,0,INITIAL_SLICES-1);
  }

  function ensureIndependentSlices(){
    if(!sampleBuffer){
      independentSlices=[];
      independentDirty=false;
      selectedSlice=0;
      return;
    }
    if(!independentSlices.length)seedInitialSlices();
  }

  function currentSliceRange(index){
    const i=clampSlice(index);
    if(i<0)return null;
    if(editMode===MODE_SLICES){
      const range=independentSlices[i];
      return range?{start:range.start,end:range.end}:null;
    }
    return {start:markers[i],end:markers[i+1]};
  }

  function independentCueMarkers(){
    if(!independentSlices.length)return [];
    return [
      ...independentSlices.map(range=>range.start),
      independentSlices[independentSlices.length-1].end
    ];
  }

  function sourceSecFromEvent(ev){
    const r=waveCanvas.getBoundingClientRect();
    const vw=viewWindow();
    const ratio=clamp((ev.clientX-r.left)/Math.max(1,r.width),0,1);
    return displayToSourceTime(vw.start+ratio*vw.dur);
  }

  function sourceSecToCanvasX(sec,target=waveCanvas){
    const vw=viewWindow();
    const display=sourceToDisplayTime(sec);
    return (display-vw.start)/Math.max(.000001,vw.dur)*target.width;
  }

  function sourceSecToClientX(sec){
    const r=waveCanvas.getBoundingClientRect();
    const vw=viewWindow();
    const display=sourceToDisplayTime(sec);
    return r.left+(display-vw.start)/Math.max(.000001,vw.dur)*r.width;
  }

  function sliceCanvasBounds(index,target=waveCanvas){
    const range=currentSliceRange(index);
    if(!range)return null;
    return {
      left:sourceSecToCanvasX(range.start,target),
      right:sourceSecToCanvasX(range.end,target)
    };
  }

  function sliceIndexAtSourceSec(sec){
    if(editMode!==MODE_SLICES)return -1;
    ensureIndependentSlices();
    const value=Number(sec)||0;
    for(let i=0;i<independentSlices.length;i++){
      const range=independentSlices[i];
      if(value>=range.start && (value<range.end || (i===independentSlices.length-1 && value<=range.end)))return i;
    }
    return -1;
  }

  function edgeHitFromEvent(ev){
    if(editMode!==MODE_SLICES || !independentSlices.length)return null;
    const order=[];
    if(selectedSlice>=0 && selectedSlice<independentSlices.length)order.push(selectedSlice);
    for(let i=0;i<independentSlices.length;i++)if(i!==selectedSlice)order.push(i);

    let best=null;
    for(const i of order){
      const range=independentSlices[i];
      const startDistance=Math.abs(sourceSecToClientX(range.start)-ev.clientX);
      const endDistance=Math.abs(sourceSecToClientX(range.end)-ev.clientX);
      if(startDistance<=EDGE_GRAB_PX && (!best || startDistance<best.distance)){
        best={index:i,edge:"start",distance:startDistance};
      }
      if(endDistance<=EDGE_GRAB_PX && (!best || endDistance<best.distance)){
        best={index:i,edge:"end",distance:endDistance};
      }
    }
    return best;
  }

  function pointerTarget(ev){
    const edge=edgeHitFromEvent(ev);
    if(edge)return edge;
    const index=sliceIndexAtSourceSec(sourceSecFromEvent(ev));
    if(index<0)return {index:-1,edge:null,distance:Infinity};
    return {index,edge:"end",distance:Infinity};
  }

  function setSliceBoundary(index,edge,sec,{redraw=true}={}){
    if(editMode!==MODE_SLICES || !sampleBuffer)return false;
    ensureIndependentSlices();
    const i=clampSlice(index);
    const range=independentSlices[i];
    if(i<0 || !range)return false;

    const previousEnd=i>0?independentSlices[i-1].end:0;
    const nextStart=i<independentSlices.length-1?independentSlices[i+1].start:sampleBuffer.duration;
    const value=Number(sec)||0;

    if(edge==="start"){
      range.start=clamp(value,previousEnd,Math.max(previousEnd,range.end-MIN_SLICE_SEC));
    }else if(edge==="end"){
      range.end=clamp(value,Math.min(nextStart,range.start+MIN_SLICE_SEC),nextStart);
    }else{
      return false;
    }

    independentDirty=true;
    selectedSlice=i;
    invalidatePreviewRender();
    syncPadSelection();
    if(redraw)drawWave();
    return true;
  }

  function shiftGridForInsertion(insertAt){
    if(!Array.isArray(loopGridEvents))return;
    const firstShiftedPad=insertAt+1;
    loopGridEvents=loopGridEvents.map(value=>{
      const pad=Number(value)||0;
      if(!pad)return 0;
      return pad>=firstShiftedPad?Math.min(MAX_SLICES,pad+1):pad;
    });
  }

  function addSliceAt(sec){
    if(editMode!==MODE_SLICES || !sampleBuffer)return false;
    ensureIndependentSlices();
    if(independentSlices.length>=MAX_SLICES){
      $("chopStatus").textContent=`SLICES • MAX ${MAX_SLICES}`;
      return false;
    }

    const value=clamp(Number(sec)||0,0,sampleBuffer.duration);
    const containing=sliceIndexAtSourceSec(value);
    let insertAt=-1;

    if(containing>=0){
      const range=independentSlices[containing];
      if(value-range.start<MIN_SLICE_SEC || range.end-value<MIN_SLICE_SEC){
        $("chopStatus").textContent="SLICES • DOUBLE-CLICK TOO CLOSE TO EDGE";
        return false;
      }
      const oldEnd=range.end;
      range.end=value;
      insertAt=containing+1;
      independentSlices.splice(insertAt,0,{start:value,end:oldEnd});
    }else{
      insertAt=independentSlices.findIndex(range=>value<range.start);
      if(insertAt<0)insertAt=independentSlices.length;

      const gapStart=insertAt>0?independentSlices[insertAt-1].end:0;
      const gapEnd=insertAt<independentSlices.length?independentSlices[insertAt].start:sampleBuffer.duration;
      if(gapEnd-gapStart<MIN_SLICE_SEC){
        $("chopStatus").textContent="SLICES • NO ROOM HERE";
        return false;
      }

      const defaultLength=Math.max(MIN_SLICE_SEC*2,sampleBuffer.duration/MAX_SLICES);
      let start=clamp(value,gapStart,gapEnd);
      let end=Math.min(gapEnd,start+defaultLength);
      if(end-start<MIN_SLICE_SEC){
        end=clamp(value,gapStart,gapEnd);
        start=Math.max(gapStart,end-defaultLength);
      }
      if(end-start<MIN_SLICE_SEC){
        $("chopStatus").textContent="SLICES • NO ROOM HERE";
        return false;
      }
      independentSlices.splice(insertAt,0,{start,end});
    }

    independentDirty=true;
    selectedSlice=insertAt;
    invalidatePreviewRender();
    shiftGridForInsertion(insertAt);
    stopChopAudition();
    renderPads();
    drawWave();
    renderSampleTimeline();
    $("chopStatus").textContent=`SLICE ${insertAt+1} ADDED • ${independentSlices.length}/${MAX_SLICES}`;
    return true;
  }

  function syncPadSelection(){
    document.querySelectorAll("#pads .pad").forEach((pad,i)=>{
      const selected=editMode===MODE_SLICES && i===selectedSlice && !pad.classList.contains("unavailable");
      pad.classList.toggle("slice-selected",selected);
      if(selected && !pad.disabled)pad.setAttribute("aria-current","true");
      else pad.removeAttribute("aria-current");
    });
  }

  function syncPadAvailability(){
    if(editMode!==MODE_SLICES)return;
    const count=independentSlices.length;
    document.querySelectorAll("#pads .pad").forEach((pad,i)=>{
      const available=i<count;
      pad.disabled=!available;
      pad.classList.toggle("unavailable",!available);
      pad.title=available
        ? `Slice ${i+1} • click = audition`
        : `PAD ${i+1} • double-click waveform to add a slice`;
      pad.onclick=available?()=>previewSlice(i,pad):null;
    });
  }

  function selectSlice(index,{redraw=true}={}){
    const next=clampSlice(index);
    if(next<0){
      selectedSlice=0;
      syncPadSelection();
      return -1;
    }
    selectedSlice=next;
    syncPadSelection();
    if(redraw)drawWave();
    return selectedSlice;
  }

  function flash(index){
    const i=clampSlice(index);
    if(i<0)return;
    flashSlice=i;
    flashUntil=performance.now()+FLASH_MS;
  }

  function paintIndependentSlices(){
    if(editMode!==MODE_SLICES || !sampleBuffer || !independentSlices.length)return;
    const w=waveCanvas.width,h=waveCanvas.height;
    c2d.save();
    c2d.font="700 11px monospace";

    for(let i=0;i<independentSlices.length;i++){
      const bounds=sliceCanvasBounds(i,waveCanvas);
      if(!bounds)continue;
      const left=clamp(Math.min(bounds.left,bounds.right),0,w);
      const right=clamp(Math.max(bounds.left,bounds.right),0,w);
      if(right<=left)continue;
      const selected=i===selectedSlice;

      c2d.fillStyle=selected?"rgba(226,173,95,.14)":"rgba(226,173,95,.045)";
      c2d.fillRect(left,0,right-left,h);
      c2d.strokeStyle=selected?"rgba(255,218,145,.72)":"rgba(154,112,56,.46)";
      c2d.lineWidth=selected?2.5:1.25;
      c2d.strokeRect(left+1,1,Math.max(0,right-left-2),Math.max(0,h-2));

      c2d.fillStyle=selected?"#fff0d0":"#d8bd91";
      c2d.fillText(String(i+1),Math.min(w-22,Math.max(6,left+6)),18);

      const handleColor=selected?"#ffe0a5":"#a97942";
      c2d.fillStyle=handleColor;
      c2d.fillRect(Math.max(0,left-3),0,Math.min(6,w-left+3),13);
      c2d.fillRect(Math.max(0,right-3),0,Math.min(6,w-right+3),13);
      if(selected){
        c2d.fillStyle="rgba(255,224,165,.72)";
        c2d.fillRect(Math.max(0,left-1),13,2,Math.max(0,h-13));
        c2d.fillRect(Math.max(0,right-1),13,2,Math.max(0,h-13));
      }
    }
    c2d.restore();
  }

  function paintActiveRegion(){
    if(editMode!==MODE_SLICES || !sampleBuffer || activeSlice<0)return;
    const bounds=sliceCanvasBounds(activeSlice,overlayCanvas);
    if(!bounds)return;
    const w=overlayCanvas.width,h=overlayCanvas.height;
    const left=clamp(Math.min(bounds.left,bounds.right),0,w);
    const right=clamp(Math.max(bounds.left,bounds.right),0,w);
    if(right<=left)return;
    const hot=activeSlice===flashSlice && performance.now()<flashUntil;
    ph2d.save();
    ph2d.globalCompositeOperation="destination-over";
    ph2d.fillStyle=hot?"rgba(240,180,95,.30)":"rgba(226,173,95,.12)";
    ph2d.fillRect(left,0,right-left,h);
    ph2d.strokeStyle=hot?"rgba(255,224,166,.72)":"rgba(226,173,95,.30)";
    ph2d.lineWidth=hot?3:2;
    ph2d.strokeRect(left+1,1,Math.max(0,right-left-2),Math.max(0,h-2));
    ph2d.restore();
  }

  function paintReadablePlayhead(){
    if(editMode!==MODE_SLICES)return;
    const info=currentPlayheadInfo();
    if(!info || info.time===null)return;
    const vw=viewWindow();
    if(info.time<vw.start || info.time>vw.end)return;
    const w=overlayCanvas.width,h=overlayCanvas.height;
    const x=(info.time-vw.start)/Math.max(.000001,vw.dur)*w;
    ph2d.save();
    ph2d.lineCap="round";
    ph2d.strokeStyle="rgba(5,3,2,.86)";
    ph2d.lineWidth=6;
    ph2d.beginPath();ph2d.moveTo(x,0);ph2d.lineTo(x,h);ph2d.stroke();
    ph2d.strokeStyle="#ffd98e";
    ph2d.lineWidth=2.6;
    ph2d.shadowColor="rgba(240,180,95,.88)";
    ph2d.shadowBlur=10;
    ph2d.beginPath();ph2d.moveTo(x,0);ph2d.lineTo(x,h);ph2d.stroke();
    ph2d.fillStyle="#ffe1a6";
    ph2d.beginPath();
    ph2d.moveTo(x-7,0);ph2d.lineTo(x+7,0);ph2d.lineTo(x,10);ph2d.closePath();ph2d.fill();
    ph2d.restore();
  }

  function updateModeButton(){
    const slices=editMode===MODE_SLICES;
    modeButton.dataset.mode=editMode;
    modeButton.textContent=slices?"SLICES":"MARKERS";
    modeButton.setAttribute("aria-pressed",slices?"true":"false");
    modeButton.setAttribute("aria-label",slices
      ? "Chop edit mode SLICES. Click to return to original MARKERS mode."
      : "Chop edit mode MARKERS. Click to edit independent SLICES.");
    modeButton.title=slices
      ? "SLICES • 4 start • double-click = add • drag edges = trim"
      : "MARKERS • original linked marker editor";
    waveCanvas.dataset.editMode=editMode;
    waveCanvas.setAttribute("aria-label",slices
      ? "Waveform en mode SLICES. Double-clic ajoute ou divise un slice. Glisser le bord gauche règle le début; le bord droit règle la fin."
      : "Waveform en mode MARKERS. Éditeur de marqueurs d'origine.");
    waveCanvas.title=slices
      ? "SLICES • double-click = add/split • left edge = start • right edge/body = end"
      : "MARKERS • original linked marker editor";
    if(!slices)waveCanvas.style.cursor="";
  }

  function clearDrag(){
    dragSlice=-1;
    dragEdge=null;
    dragPointerId=null;
    dragMoved=false;
  }

  function setEditMode(mode){
    const next=mode===MODE_SLICES?MODE_SLICES:MODE_MARKERS;
    if(next===editMode){
      updateModeButton();
      return editMode;
    }
    stopChopAudition();
    if(typeof stopCurrentBeat==="function" && isLoopPlaying)stopCurrentBeat();
    else invalidatePreviewRender();
    clearDrag();
    if(typeof draggingMarker!=="undefined")draggingMarker=-1;

    editMode=next;
    if(editMode===MODE_SLICES){
      if(independentDirty)ensureIndependentSlices();
      else seedInitialSlices();
    }
    activeSlice=-1;
    flashSlice=-1;
    updateModeButton();
    renderPads();
    drawWave();
    clearPlayhead();
    $("chopStatus").textContent=editMode===MODE_SLICES
      ? `CHOP MODE • SLICES • ${independentSlices.length}/${MAX_SLICES}`
      : "CHOP MODE • MARKERS";
    return editMode;
  }

  const drawWaveBase=drawWave;
  drawWave=function(...args){
    let result;
    if(editMode!==MODE_SLICES || !sampleBuffer){
      result=drawWaveBase(...args);
    }else{
      const savedMarkers=markers;
      const savedSelectedMarker=selectedMarker;
      try{
        markers=[];
        selectedMarker=-1;
        result=drawWaveBase(...args);
      }finally{
        markers=savedMarkers;
        selectedMarker=savedSelectedMarker;
      }
      paintIndependentSlices();
    }
    syncWaveScrollbar();
    return result;
  };

  const gridEventsForRenderBase=gridEventsForRender;
  gridEventsForRender=function(...args){
    const events=gridEventsForRenderBase(...args);
    if(editMode!==MODE_SLICES)return events;
    const count=independentSlices.length;
    return events.map(value=>{
      const pad=Number(value)||0;
      return pad>=1 && pad<=count?pad:0;
    });
  };

  const renderLoopGridBase=renderLoopGrid;
  renderLoopGrid=function(...args){
    if(editMode!==MODE_SLICES)return renderLoopGridBase(...args);
    ensureIndependentSlices();
    const savedMarkers=markers;
    try{
      markers=independentCueMarkers();
      return renderLoopGridBase(...args);
    }finally{
      markers=savedMarkers;
    }
  };

  const renderPadsBase=renderPads;
  renderPads=function(...args){
    const result=renderPadsBase(...args);
    if(editMode===MODE_SLICES){
      ensureIndependentSlices();
      selectedSlice=independentSlices.length?clamp(selectedSlice,0,independentSlices.length-1):0;
      syncPadAvailability();
    }
    syncPadSelection();
    return result;
  };

  const setMarkersBase=setMarkers;
  setMarkers=function(...args){
    const result=setMarkersBase(...args);
    if(sampleBuffer)seedInitialSlices();
    syncPadSelection();
    drawWave();
    return result;
  };

  const autoPlaceMarkersBase=autoPlaceMarkers;
  autoPlaceMarkers=function(...args){
    const result=autoPlaceMarkersBase(...args);
    if(sampleBuffer)seedInitialSlices();
    selectedSlice=0;
    if(editMode===MODE_SLICES)renderPads();
    syncPadSelection();
    drawWave();
    return result;
  };

  const previewSliceBase=previewSlice;
  previewSlice=async function(index,button){
    if(editMode!==MODE_SLICES)return await previewSliceBase(index,button);
    ensureIndependentSlices();
    const i=selectSlice(index);
    const range=currentSliceRange(i);
    if(i<0 || !range)return;
    flash(i);

    const savedMarkers=markers;
    try{
      markers=independentCueMarkers();
      await previewSliceBase(i,button);
    }finally{
      markers=savedMarkers;
    }

    const source=chopAuditionSource;
    if(source){
      const audible=Math.max(.005,(range.end-range.start)/samplePitchRate());
      const stopAt=Math.max(ctx.currentTime+.005,chopAuditionStartedAt+audible);
      try{source.stop(stopAt);}catch{}
    }
  };

  const setActivePadBase=setActivePad;
  setActivePad=function(index){
    setActivePadBase(index);
    if(editMode===MODE_SLICES){
      const next=clampSlice(index);
      if(index>=0 && next>=0){
        if(next!==activeSlice)flash(next);
        activeSlice=next;
      }else{
        activeSlice=-1;
      }
      syncPadSelection();
    }else{
      activeSlice=-1;
    }
  };

  const buildLoopPlayheadStateBase=buildLoopPlayheadState;
  buildLoopPlayheadState=function(){
    if(editMode!==MODE_SLICES)return buildLoopPlayheadStateBase();
    if(!sampleBuffer)return null;
    ensureIndependentSlices();

    const pitchRate=samplePitchRate();
    const plan=buildSequencePlan(
      gridEventsForRender(),
      $("sampleBpm").value,
      independentSlices.length
    );
    if(!plan.placed.length)return null;

    const segments=plan.placed.map(event=>{
      const range=independentSlices[event.chop-1];
      const maxAudible=Math.max(0,range.end-range.start)/pitchRate;
      const endTime=Math.min(plan.targetDur,event.nextTime,event.startTime+maxAudible);
      return endTime>event.startTime
        ? {pad:event.chop-1,startTime:event.startTime,endTime,sampleStart:range.start}
        : null;
    }).filter(Boolean);

    return {duration:plan.targetDur,pitchRate,segments};
  };

  const renderSequenceBase=renderSequence;
  renderSequence=async function(events,sourceBuffer,cueMarkers,pitchRate){
    if(editMode!==MODE_SLICES)return await renderSequenceBase(events,sourceBuffer,cueMarkers,pitchRate);
    if(!sourceBuffer)throw new Error("Charge un sample");
    ensureIndependentSlices();

    const bpm=Math.max(40,Number($("sampleBpm").value)||90);
    const stepDur=(60/bpm)/2;
    const bars=Math.max(1,Math.ceil(events.length/8));
    const targetDur=bars*4*60/bpm;
    const rate=44100;
    const offline=new OfflineAudioContext(2,Math.ceil(targetDur*rate),rate);
    const master=makePunchMaster(offline);
    const sampleConditioner=makeSampleConditioner(offline,master.input,.72*sampleVolumeGain());

    const placed=[];
    for(let step=0;step<events.length;step++){
      const chop=Number(events[step])||0;
      if(chop>=1 && chop<=independentSlices.length)placed.push({step,chop});
    }
    if(!placed.length)throw new Error("Place au moins un PAD sur la grille");

    for(let e=0;e<placed.length;e++){
      const ev=placed[e];
      const range=independentSlices[ev.chop-1];
      const startTime=ev.step*stepDur;
      const nextTime=e+1<placed.length?placed[e+1].step*stepDur:targetDur;
      const available=Math.max(.005,range.end-range.start);
      const wanted=Math.max(.005,nextTime-startTime);

      const src=offline.createBufferSource();
      src.buffer=sourceBuffer;
      src.playbackRate.value=pitchRate;
      src.connect(sampleConditioner.input);
      src.start(startTime,range.start);
      src.stop(Math.min(targetDur,startTime+Math.min(wanted,available/pitchRate)));
    }

    const selection=await ensureDrumSelection();
    renderSelectedDrums(offline,selection,bpm,bars,targetDur,master.input);
    let rendered=finalizeLoopBuffer(await offline.startRendering());
    if(globalThis.ChopperVinyl?.processRenderedBuffer){
      rendered=await globalThis.ChopperVinyl.processRenderedBuffer(rendered);
    }
    return rendered;
  };

  function drawPinnedPlayheadFrame(){
    clearPlayhead();

    const loopTime=currentLoopTime();
    drawSampleTimelinePlayhead(loopTime);
    const info=currentPlayheadInfo(loopTime);
    if(!info){
      chopPlayheadRAF=0;
      setActivePad(-1);
      return false;
    }

    setActivePad(info.pad);
    const t=info.time;
    if(t!==null){
      const vw=viewWindow();
      const w=overlayCanvas.width,h=overlayCanvas.height;
      if(t>=vw.start && t<=vw.end){
        const x=(t-vw.start)/Math.max(.000001,vw.dur)*w;
        ph2d.save();
        ph2d.strokeStyle="#e2ad5f";
        ph2d.lineWidth=2;
        ph2d.shadowColor="rgba(226,173,95,.62)";
        ph2d.shadowBlur=8;
        ph2d.beginPath();
        ph2d.moveTo(x,0);
        ph2d.lineTo(x,h);
        ph2d.stroke();
        ph2d.fillStyle="#d48643";
        ph2d.beginPath();
        ph2d.moveTo(x-5,0);
        ph2d.lineTo(x+5,0);
        ph2d.lineTo(x,7);
        ph2d.closePath();
        ph2d.fill();
        ph2d.restore();
      }
    }

    chopPlayheadRAF=requestAnimationFrame(drawPlayhead);
    return true;
  }

  const drawPlayheadBase=drawPlayhead;
  drawPlayhead=function(...args){
    const result=viewportPinned
      ? drawPinnedPlayheadFrame()
      : drawPlayheadBase(...args);
    paintActiveRegion();
    paintReadablePlayhead();
    return result;
  };

  // A user interaction with the zoomed waveform owns the viewport. Playback
  // may move its playhead off-screen, but it must not drag the edited area away.
  waveCanvas.addEventListener("pointerdown",()=>{pinEditedViewport();},true);
  waveCanvas.addEventListener("wheel",()=>{pinEditedViewport();},{capture:true,passive:true});
  waveScroll?.addEventListener("input",()=>{
    pinEditedViewport();
    syncWaveScrollbar();
  });
  window.addEventListener("resize",syncWaveScrollbar,{passive:true});

  waveCanvas.addEventListener("pointerdown",ev=>{
    if(editMode!==MODE_SLICES || !sampleBuffer)return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    ensureIndependentSlices();
    try{waveCanvas.focus({preventScroll:true});}catch{waveCanvas.focus();}

    const hit=pointerTarget(ev);
    if(hit.index<0){
      clearDrag();
      return;
    }

    selectSlice(hit.index);
    dragSlice=hit.index;
    dragEdge=hit.edge;
    dragPointerId=ev.pointerId;
    dragStartClientX=ev.clientX;
    dragMoved=false;
    waveCanvas.style.cursor="ew-resize";
    try{waveCanvas.setPointerCapture(ev.pointerId);}catch{}
  },true);

  waveCanvas.addEventListener("pointermove",ev=>{
    if(editMode!==MODE_SLICES || !sampleBuffer)return;
    if(dragSlice<0){
      waveCanvas.style.cursor=edgeHitFromEvent(ev)?"ew-resize":"pointer";
      return;
    }

    ev.stopImmediatePropagation();
    ev.preventDefault();
    if(Math.abs(ev.clientX-dragStartClientX)>=DRAG_THRESHOLD_PX)dragMoved=true;
    if(!dragMoved)return;
    setSliceBoundary(dragSlice,dragEdge,sourceSecFromEvent(ev));
  },true);

  waveCanvas.addEventListener("pointerup",ev=>{
    if(editMode!==MODE_SLICES || !sampleBuffer)return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    const index=dragSlice;
    const edge=dragEdge;
    const moved=dragMoved;
    if(dragPointerId!==null){
      try{waveCanvas.releasePointerCapture(dragPointerId);}catch{}
    }
    clearDrag();
    waveCanvas.style.cursor=edgeHitFromEvent(ev)?"ew-resize":"pointer";

    if(index<0)return;
    const range=independentSlices[index];
    if(moved && range){
      independentDirty=true;
      stopChopAudition();
      renderSampleTimeline();
      const startMs=Math.round(range.start*1000);
      const endMs=Math.round(range.end*1000);
      const lenMs=Math.round((range.end-range.start)*1000);
      $("chopStatus").textContent=`SLICE ${index+1} • ${edge==="start"?"START":"END"} • ${startMs}–${endMs} ms • ${lenMs} ms ✓`;
      drawWave();
      return;
    }

    const pad=document.querySelectorAll("#pads .pad")[index];
    void previewSlice(index,pad||waveCanvas);
  },true);

  waveCanvas.addEventListener("pointercancel",ev=>{
    if(editMode!==MODE_SLICES)return;
    ev.stopImmediatePropagation();
    clearDrag();
    waveCanvas.style.cursor="pointer";
  },true);

  waveCanvas.addEventListener("pointerleave",()=>{
    if(editMode===MODE_SLICES && dragSlice<0)waveCanvas.style.cursor="pointer";
  });

  waveCanvas.addEventListener("dblclick",ev=>{
    if(editMode!==MODE_SLICES || !sampleBuffer)return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    stopChopAudition();
    clearDrag();
    addSliceAt(sourceSecFromEvent(ev));
  },true);

  modeButton.addEventListener("click",()=>{
    setEditMode(editMode===MODE_MARKERS?MODE_SLICES:MODE_MARKERS);
  });

  globalThis.ChopperWaveSlices={
    modes:Object.freeze({markers:MODE_MARKERS,slices:MODE_SLICES}),
    initialSlices:INITIAL_SLICES,
    maxSlices:MAX_SLICES,
    minSliceSec:MIN_SLICE_SEC,
    get mode(){return editMode;},
    get selectedSlice(){return selectedSlice;},
    get activeSlice(){return activeSlice;},
    get viewportPinned(){return viewportPinned;},
    get slices(){return independentSlices.map(range=>({...range}));},
    setEditMode,
    selectSlice,
    setSliceBoundary,
    addSliceAt,
    sliceIndexAtSourceSec,
    sliceCanvasBounds,
    resumePlayheadFollow(){
      setViewportPinned(false);
      return viewportPinned;
    },
    resetSlices(){
      invalidatePreviewRender();
      seedInitialSlices();
      renderPads();
      drawWave();
      return independentSlices.map(range=>({...range}));
    }
  };

  updateModeButton();
  renderPads();
  drawWave();
})();
