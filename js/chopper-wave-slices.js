"use strict";

// looper-next: two explicit Chopper edit modes without changing waveform height.
// MARKERS preserves the original linked-boundary editor from chopper.js.
// SLICES keeps an independent start/end range per pad; hold + drag inside a
// slice changes only that slice's end, so gaps and overlaps are both valid.
(() => {
  const root=document.getElementById("chopper");
  const waveCanvas=document.getElementById("waveCanvas");
  const overlayCanvas=document.getElementById("playheadCanvas");
  const displayTitle=root?.querySelector(".samplerScreenModule > .stableTitle");
  if(!root || !waveCanvas || !overlayCanvas || !displayTitle || root.dataset.waveSliceEditorInstalled==="1")return;
  if(typeof drawWave!=="function" || typeof renderPads!=="function" || typeof previewSlice!=="function")return;
  root.dataset.waveSliceEditorInstalled="1";

  const MODE_MARKERS="markers";
  const MODE_SLICES="slices";
  const FLASH_MS=190;
  const MAX_SLICES=16;
  const MIN_SLICE_SEC=.008;
  const DRAG_THRESHOLD_PX=4;

  let editMode=MODE_MARKERS;
  let independentSlices=[];
  let independentDirty=false;
  let selectedSlice=0;
  let activeSlice=-1;
  let flashSlice=-1;
  let flashUntil=0;
  let dragSlice=-1;
  let dragPointerId=null;
  let dragStartClientX=0;
  let dragMoved=false;

  const modeButton=document.createElement("button");
  modeButton.id="sliceEditModeBtn";
  modeButton.type="button";
  modeButton.className="chopModeToggle";
  displayTitle.appendChild(modeButton);

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
    }`;
  document.head.appendChild(style);

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

  function cloneMarkerSlices(){
    const count=markerSliceCount();
    independentSlices=Array.from({length:count},(_,i)=>(
      {start:markers[i],end:markers[i+1]}
    ));
    independentDirty=false;
    selectedSlice=count?clamp(selectedSlice,0,count-1):0;
  }

  function ensureIndependentSlices(){
    const count=markerSliceCount();
    if(!count){
      independentSlices=[];
      independentDirty=false;
      return;
    }
    if(independentSlices.length!==count)cloneMarkerSlices();
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

  function sliceCanvasBounds(index,target=waveCanvas){
    const range=currentSliceRange(index);
    if(!range)return null;
    return {
      left:sourceSecToCanvasX(range.start,target),
      right:sourceSecToCanvasX(range.end,target)
    };
  }

  function sliceIndexAtSourceSec(sec){
    const count=sliceCount();
    if(!count)return -1;
    const value=Number(sec)||0;

    // When independent ranges overlap, keep the selected slice easy to edit.
    const selected=currentSliceRange(selectedSlice);
    if(selected && value>=selected.start && value<=selected.end)return selectedSlice;

    for(let i=0;i<count;i++){
      const range=currentSliceRange(i);
      if(range && value>=range.start && value<=range.end)return i;
    }
    return -1;
  }

  function syncPadSelection(){
    document.querySelectorAll("#pads .pad").forEach((pad,i)=>{
      const selected=editMode===MODE_SLICES && i===selectedSlice && !pad.classList.contains("unavailable");
      pad.classList.toggle("slice-selected",selected);
      if(selected && !pad.disabled)pad.setAttribute("aria-current","true");
      else pad.removeAttribute("aria-current");
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

      // Independent right edge: visually a handle, not a shared chop line.
      c2d.fillStyle=selected?"#ffe0a5":"#a97942";
      c2d.fillRect(Math.max(0,right-3),0,Math.min(6,w-right+3),12);
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
      ? "Chop edit mode SLICES. Click to return to linked MARKERS mode."
      : "Chop edit mode MARKERS. Click to use independent SLICES mode.");
    modeButton.title=slices
      ? "SLICES • hold + drag a slice to set its independent end"
      : "MARKERS • original linked chop boundaries";
    waveCanvas.dataset.editMode=editMode;
    waveCanvas.setAttribute("aria-label",slices
      ? "Waveform en mode SLICES. Clic auditionne. Maintenir puis glisser dans un slice règle uniquement sa fin."
      : "Waveform en mode MARKERS. Éditeur de marqueurs liés d'origine.");
    waveCanvas.title=slices
      ? "SLICES • click = audition • hold + drag = set independent end"
      : "MARKERS • original linked marker editor";
  }

  function setEditMode(mode){
    const next=mode===MODE_SLICES?MODE_SLICES:MODE_MARKERS;
    if(next===editMode){
      updateModeButton();
      return editMode;
    }
    stopChopAudition();
    if(typeof stopCurrentBeat==="function" && isLoopPlaying)stopCurrentBeat();
    renderedFlip=null;
    dragSlice=-1;
    dragPointerId=null;
    dragMoved=false;
    if(typeof draggingMarker!=="undefined")draggingMarker=-1;

    editMode=next;
    if(editMode===MODE_SLICES){
      // Until the user has actually edited an independent slice, entering
      // SLICES reflects the latest MARKERS positions. Once edited, toggling
      // modes preserves that independent state instead of silently resetting it.
      if(independentDirty)ensureIndependentSlices();
      else cloneMarkerSlices();
    }
    activeSlice=-1;
    flashSlice=-1;
    updateModeButton();
    renderPads();
    drawWave();
    clearPlayhead();
    $("chopStatus").textContent=editMode===MODE_SLICES
      ? "CHOP MODE • SLICES"
      : "CHOP MODE • MARKERS";
    return editMode;
  }

  const drawWaveBase=drawWave;
  drawWave=function(...args){
    if(editMode!==MODE_SLICES || !sampleBuffer){
      return drawWaveBase(...args);
    }

    // Hide linked marker lines in SLICES mode. The source markers still exist
    // untouched for MARKERS mode; only their drawing is temporarily suppressed.
    const savedMarkers=markers;
    const savedSelectedMarker=selectedMarker;
    let result;
    try{
      markers=[];
      selectedMarker=-1;
      result=drawWaveBase(...args);
    }finally{
      markers=savedMarkers;
      selectedMarker=savedSelectedMarker;
    }
    paintIndependentSlices();
    return result;
  };

  const renderPadsBase=renderPads;
  renderPads=function(...args){
    const result=renderPadsBase(...args);
    if(editMode===MODE_SLICES){
      ensureIndependentSlices();
      const count=sliceCount();
      selectedSlice=count?clamp(selectedSlice,0,count-1):0;
    }
    syncPadSelection();
    return result;
  };

  const setMarkersBase=setMarkers;
  setMarkers=function(...args){
    const result=setMarkersBase(...args);
    cloneMarkerSlices();
    selectedSlice=0;
    syncPadSelection();
    drawWave();
    return result;
  };

  const autoPlaceMarkersBase=autoPlaceMarkers;
  autoPlaceMarkers=function(...args){
    const result=autoPlaceMarkersBase(...args);
    cloneMarkerSlices();
    selectedSlice=0;
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

    // Reuse the maintained preview chain (including VINYL) with this slice's
    // independent start, then stop the source at this slice's own end.
    const savedStart=markers[i];
    try{
      markers[i]=range.start;
      await previewSliceBase(i,button);
    }finally{
      markers[i]=savedStart;
    }

    const source=chopAuditionSource;
    if(source){
      const audible=Math.max(.005,(range.end-range.start)/samplePitchRate());
      try{source.stop(ctx.currentTime+audible);}catch{}
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

    const bpm=Math.max(40,Number($("sampleBpm").value)||90);
    const stepDur=(60/bpm)/2;
    const targetDur=8*60/bpm;
    const pitchRate=samplePitchRate();
    const events=gridEventsForRender();
    const placed=[];

    for(let step=0;step<CHOPPER_SEQUENCE_STEPS;step++){
      const chop=Number(events[step])||0;
      if(chop>=1 && chop<=independentSlices.length)placed.push({step,chop});
    }
    if(!placed.length)return null;

    const segments=[];
    for(let i=0;i<placed.length;i++){
      const ev=placed[i];
      const range=independentSlices[ev.chop-1];
      if(!range)continue;
      const startTime=ev.step*stepDur;
      const nextTime=i+1<placed.length?placed[i+1].step*stepDur:targetDur;
      const maxAudible=Math.max(0,range.end-range.start)/pitchRate;
      const endTime=Math.min(targetDur,nextTime,startTime+maxAudible);
      if(endTime>startTime){
        segments.push({
          pad:ev.chop-1,
          startTime,
          endTime,
          sampleStart:range.start
        });
      }
    }

    return {duration:targetDur,pitchRate,segments};
  };

  const renderSequenceBase=renderSequence;
  renderSequence=async function(events,sourceBuffer,cueMarkers,pitchRate){
    if(editMode!==MODE_SLICES){
      return await renderSequenceBase(events,sourceBuffer,cueMarkers,pitchRate);
    }
    if(!sourceBuffer)throw new Error("Charge un sample");
    ensureIndependentSlices();

    const bpm=Math.max(40,Number($("sampleBpm").value)||90);
    const stepDur=(60/bpm)/2;
    const bars=2;
    const targetDur=8*60/bpm;
    const rate=44100;
    const offline=new OfflineAudioContext(2,Math.ceil(targetDur*rate),rate);
    const master=makePunchMaster(offline);
    const sampleConditioner=makeSampleConditioner(offline,master.input,.72*sampleVolumeGain());

    const placed=[];
    for(let step=0;step<16;step++){
      const chop=Number(events[step])||0;
      if(chop>=1 && chop<=independentSlices.length)placed.push({step,chop});
    }
    if(!placed.length)throw new Error("Place au moins un PAD sur la grille");

    for(let e=0;e<placed.length;e++){
      const ev=placed[e];
      const range=independentSlices[ev.chop-1];
      if(!range)continue;
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

  const drawPlayheadBase=drawPlayhead;
  drawPlayhead=function(...args){
    const result=drawPlayheadBase(...args);
    paintActiveRegion();
    paintReadablePlayhead();
    return result;
  };

  waveCanvas.addEventListener("pointerdown",ev=>{
    if(editMode!==MODE_SLICES || !sampleBuffer)return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    ensureIndependentSlices();
    try{waveCanvas.focus({preventScroll:true});}catch{waveCanvas.focus();}

    const sec=sourceSecFromEvent(ev);
    const index=sliceIndexAtSourceSec(sec);
    if(index<0){
      dragSlice=-1;
      return;
    }

    selectSlice(index);
    dragSlice=index;
    dragPointerId=ev.pointerId;
    dragStartClientX=ev.clientX;
    dragMoved=false;
    try{waveCanvas.setPointerCapture(ev.pointerId);}catch{}
  },true);

  waveCanvas.addEventListener("pointermove",ev=>{
    if(editMode!==MODE_SLICES || !sampleBuffer || dragSlice<0)return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    if(Math.abs(ev.clientX-dragStartClientX)>=DRAG_THRESHOLD_PX)dragMoved=true;
    if(!dragMoved)return;

    const range=independentSlices[dragSlice];
    if(!range)return;
    range.end=clamp(
      sourceSecFromEvent(ev),
      Math.min(sampleBuffer.duration,range.start+MIN_SLICE_SEC),
      sampleBuffer.duration
    );
    drawWave();
  },true);

  waveCanvas.addEventListener("pointerup",ev=>{
    if(editMode!==MODE_SLICES || !sampleBuffer)return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    const index=dragSlice;
    const moved=dragMoved;
    if(dragPointerId!==null){
      try{waveCanvas.releasePointerCapture(dragPointerId);}catch{}
    }
    dragSlice=-1;
    dragPointerId=null;
    dragMoved=false;

    if(index<0)return;
    const range=independentSlices[index];
    if(moved && range){
      independentDirty=true;
      stopChopAudition();
      renderedFlip=null;
      renderSampleTimeline();
      const ms=Math.round((range.end-range.start)*1000);
      $("chopStatus").textContent=`SLICE ${index+1} • ${ms} ms ✓`;
      drawWave();
      return;
    }

    const pad=document.querySelectorAll("#pads .pad")[index];
    void previewSlice(index,pad||waveCanvas);
  },true);

  waveCanvas.addEventListener("pointercancel",ev=>{
    if(editMode!==MODE_SLICES)return;
    ev.stopImmediatePropagation();
    dragSlice=-1;
    dragPointerId=null;
    dragMoved=false;
  },true);

  modeButton.addEventListener("click",()=>{
    setEditMode(editMode===MODE_MARKERS?MODE_SLICES:MODE_MARKERS);
  });

  globalThis.ChopperWaveSlices={
    modes:Object.freeze({markers:MODE_MARKERS,slices:MODE_SLICES}),
    maxSlices:MAX_SLICES,
    get mode(){return editMode;},
    get selectedSlice(){return selectedSlice;},
    get activeSlice(){return activeSlice;},
    get slices(){return independentSlices.map(range=>({...range}));},
    setEditMode,
    selectSlice,
    sliceIndexAtSourceSec,
    sliceCanvasBounds,
    resetSlicesFromMarkers(){cloneMarkerSlices();renderPads();drawWave();return independentSlices.map(range=>({...range}));}
  };

  updateModeButton();
  renderPads();
  drawWave();
})();