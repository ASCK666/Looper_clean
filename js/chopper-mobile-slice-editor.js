"use strict";

// Mobile-only pad hold editor. A hold opens a dedicated CHOP workspace while
// keeping the active Chopper edit model: MARKERS keeps linked 1..16 chop
// boundaries; SLICES keeps independent ranges.
(() => {
  const root=document.getElementById("chopper");
  const pads=document.getElementById("pads");
  const deck=pads?.closest(".samplerDeck");
  if(!root || !pads || !deck || !globalThis.ChopperWaveSlices || globalThis.ChopperMobileSliceEditor)return;

  const mobileMedia=window.matchMedia("(max-width:760px)");
  const HOLD_MS=450;
  const MOVE_CANCEL_PX=12;
  const FINE_SEC=.005;
  const COARSE_SEC=.025;

  let activePad=-1;
  let holdTimer=0;
  let holdPointerId=null;
  let holdButton=null;
  let holdStartX=0;
  let holdStartY=0;
  let suppressClickButton=null;
  let hiddenDeckChildren=[];
  let playheadRAF=0;
  let playheadRange=null;
  let playheadStartedAt=0;
  let playheadRate=1;
  let mobilePadVisual=NaN;

  const workspace=document.createElement("section");
  workspace.id="mobileChopWorkspace";
  workspace.className="panel";
  workspace.hidden=true;
  workspace.setAttribute("aria-label","Éditeur mobile du chop");
  workspace.innerHTML=`
    <div class="samplerSequenceHead">
      <button id="mobileChopPrev" class="btn" type="button" aria-label="Chop précédent">◀</button>
      <div id="mobileChopEditorTitle" class="title compactTitle">CHOP --</div>
      <button id="mobileChopNext" class="btn" type="button" aria-label="Chop suivant">▶</button>
    </div>
    <div id="mobileChopWaveWrap" class="wavewrap largeWave samplerScreen">
      <canvas id="mobileChopWave" width="900" height="220" aria-label="Waveform du chop sélectionné"></canvas>
      <canvas id="mobileChopPlayhead" width="900" height="220" aria-hidden="true"></canvas>
    </div>
    <div id="mobileChopEditorRange" class="status" aria-live="polite">START — • END —</div>
    <div>
      <label>START</label>
      <div class="grid4">
        <button class="btn" type="button" data-mobile-boundary="start" data-mobile-delta="-${COARSE_SEC}" aria-label="Reculer le début de 25 millisecondes">−25</button>
        <button class="btn" type="button" data-mobile-boundary="start" data-mobile-delta="-${FINE_SEC}" aria-label="Reculer le début de 5 millisecondes">−5</button>
        <button class="btn" type="button" data-mobile-boundary="start" data-mobile-delta="${FINE_SEC}" aria-label="Avancer le début de 5 millisecondes">+5</button>
        <button class="btn" type="button" data-mobile-boundary="start" data-mobile-delta="${COARSE_SEC}" aria-label="Avancer le début de 25 millisecondes">+25</button>
      </div>
    </div>
    <div>
      <label>END</label>
      <div class="grid4">
        <button class="btn" type="button" data-mobile-boundary="end" data-mobile-delta="-${COARSE_SEC}" aria-label="Reculer la fin de 25 millisecondes">−25</button>
        <button class="btn" type="button" data-mobile-boundary="end" data-mobile-delta="-${FINE_SEC}" aria-label="Reculer la fin de 5 millisecondes">−5</button>
        <button class="btn" type="button" data-mobile-boundary="end" data-mobile-delta="${FINE_SEC}" aria-label="Avancer la fin de 5 millisecondes">+5</button>
        <button class="btn" type="button" data-mobile-boundary="end" data-mobile-delta="${COARSE_SEC}" aria-label="Avancer la fin de 25 millisecondes">+25</button>
      </div>
    </div>
    <div class="grid2">
      <button id="mobileChopPreview" class="btn primary" type="button">PREVIEW CHOP</button>
      <button id="mobileChopDone" class="btn" type="button">← CHOPS</button>
    </div>`;
  deck.appendChild(workspace);

  const title=document.getElementById("mobileChopEditorTitle");
  const rangeReadout=document.getElementById("mobileChopEditorRange");
  const waveWrap=document.getElementById("mobileChopWaveWrap");
  const wave=document.getElementById("mobileChopWave");
  const wave2d=wave.getContext("2d");
  const playhead=document.getElementById("mobileChopPlayhead");
  const playhead2d=playhead.getContext("2d");
  const preview=document.getElementById("mobileChopPreview");
  const done=document.getElementById("mobileChopDone");
  const prev=document.getElementById("mobileChopPrev");
  const next=document.getElementById("mobileChopNext");

  waveWrap.style.position="relative";
  wave.style.cssText="display:block;width:100%;height:190px;touch-action:none";
  playhead.style.cssText="position:absolute;inset:0;width:100%;height:190px;pointer-events:none";
  workspace.style.width="100%";

  function isMobile(){return mobileMedia.matches;}

  // The base playhead asks for the same pad class on every animation frame.
  // On mobile that means 16 needless classList writes per frame. Keep the base
  // owner/behavior, but skip the write when the DOM already shows that pad.
  const setActivePadBase=setActivePad;
  setActivePad=function(index){
    if(isMobile() && index===mobilePadVisual){
      const alreadyShown=index>=0
        ? Boolean(pads.children[index]?.classList.contains("hit"))
        : !pads.querySelector(".pad.hit");
      if(alreadyShown)return;
    }
    mobilePadVisual=index;
    return setActivePadBase(index);
  };

  function currentRange(index=activePad){
    if(index<0)return null;
    if(ChopperWaveSlices.mode===ChopperWaveSlices.modes.slices)return ChopperWaveSlices.slices[index]||null;
    return index<markers.length-1?{start:markers[index],end:markers[index+1]}:null;
  }

  function currentCount(){
    return ChopperWaveSlices.mode===ChopperWaveSlices.modes.slices
      ? ChopperWaveSlices.slices.length
      : Math.max(0,markers.length-1);
  }

  function editorWindow(range=currentRange()){
    if(!sampleBuffer || !range)return null;
    const span=Math.max(.001,range.end-range.start);
    const start=Math.max(0,range.start-span*.55);
    const end=Math.min(sampleBuffer.duration,range.end+span*.55);
    return {start,end,dur:Math.max(.001,end-start)};
  }

  function clearEditorPlayhead(){
    playhead2d.clearRect(0,0,playhead.width,playhead.height);
  }

  function drawEditorWave(){
    const w=wave.width,h=wave.height;
    wave2d.clearRect(0,0,w,h);
    wave2d.fillStyle="#080604";wave2d.fillRect(0,0,w,h);
    const range=currentRange();
    const view=editorWindow(range);
    if(!range || !view)return;

    wave2d.strokeStyle="#d7a455";wave2d.lineWidth=1;
    drawBufferRange(wave2d,sampleBuffer,view.start,view.end,0,w,h);

    const left=clamp((range.start-view.start)/view.dur*w,0,w);
    const right=clamp((range.end-view.start)/view.dur*w,0,w);
    wave2d.fillStyle="rgba(0,0,0,.58)";
    wave2d.fillRect(0,0,left,h);wave2d.fillRect(right,0,w-right,h);
    wave2d.fillStyle="rgba(226,173,95,.10)";wave2d.fillRect(left,0,Math.max(0,right-left),h);
    wave2d.strokeStyle="#ffe0a5";wave2d.lineWidth=3;
    wave2d.beginPath();wave2d.moveTo(left,0);wave2d.lineTo(left,h);wave2d.moveTo(right,0);wave2d.lineTo(right,h);wave2d.stroke();

    wave2d.fillStyle="#fff0d0";wave2d.font="700 12px monospace";
    wave2d.textAlign="left";wave2d.fillText("START",Math.min(w-52,left+8),20);
    wave2d.textAlign="right";wave2d.fillText("END",Math.max(38,right-8),20);
    wave2d.textAlign="left";
  }

  function drawEditorPlayhead(sec){
    clearEditorPlayhead();
    const range=currentRange();
    const view=editorWindow(range);
    if(!range || !view || !Number.isFinite(sec) || sec<range.start || sec>range.end)return;

    const w=playhead.width,h=playhead.height;
    const x=clamp((sec-view.start)/view.dur*w,0,w);
    playhead2d.save();
    playhead2d.strokeStyle="rgba(5,3,2,.88)";playhead2d.lineWidth=6;
    playhead2d.beginPath();playhead2d.moveTo(x,0);playhead2d.lineTo(x,h);playhead2d.stroke();
    playhead2d.strokeStyle="#ffd98e";playhead2d.lineWidth=2.5;
    playhead2d.shadowColor="rgba(240,180,95,.9)";playhead2d.shadowBlur=9;
    playhead2d.beginPath();playhead2d.moveTo(x,0);playhead2d.lineTo(x,h);playhead2d.stroke();
    playhead2d.fillStyle="#ffe1a6";
    playhead2d.beginPath();playhead2d.moveTo(x-6,0);playhead2d.lineTo(x+6,0);playhead2d.lineTo(x,9);playhead2d.closePath();playhead2d.fill();
    playhead2d.restore();
  }

  function stopEditorPlayhead(){
    if(playheadRAF)cancelAnimationFrame(playheadRAF);
    playheadRAF=0;playheadRange=null;
    clearEditorPlayhead();
  }

  function runEditorPlayhead(){
    if(!playheadRange || workspace.hidden)return stopEditorPlayhead();
    const sec=playheadRange.start+Math.max(0,ctx.currentTime-playheadStartedAt)*playheadRate;
    if(sec>=playheadRange.end || chopAuditionPad<0){
      drawEditorPlayhead(playheadRange.end);
      playheadRAF=requestAnimationFrame(stopEditorPlayhead);
      return;
    }
    drawEditorPlayhead(sec);
    playheadRAF=requestAnimationFrame(runEditorPlayhead);
  }

  function updateEditor(){
    const range=currentRange();
    if(!range){closeEditor();return null;}
    const mode=ChopperWaveSlices.mode===ChopperWaveSlices.modes.slices?"SLICES":"MARKERS";
    const number=String(activePad+1).padStart(2,"0");
    title.textContent=`CHOP ${number} / ${String(currentCount()).padStart(2,"0")} • ${mode}`;
    wave.setAttribute("aria-label",`Waveform du chop ${number}, bornes START et END`);
    rangeReadout.textContent=`START ${Math.round(range.start*1000)} ms • END ${Math.round(range.end*1000)} ms • LEN ${Math.round((range.end-range.start)*1000)} ms`;
    drawEditorWave();
    clearEditorPlayhead();
    return range;
  }

  function showDedicatedView(){
    hiddenDeckChildren=[...deck.children].filter(child=>child!==workspace).map(element=>({
      element,
      display:element.style.getPropertyValue("display"),
      priority:element.style.getPropertyPriority("display")
    }));
    hiddenDeckChildren.forEach(({element})=>element.style.setProperty("display","none","important"));
    workspace.hidden=false;
    root.dataset.mobileChopView="1";
    try{workspace.scrollIntoView({block:"start",behavior:"auto"});}catch{}
  }

  function restoreDeckView(){
    hiddenDeckChildren.forEach(({element,display,priority})=>{
      if(display)element.style.setProperty("display",display,priority);
      else element.style.removeProperty("display");
    });
    hiddenDeckChildren=[];
    workspace.hidden=true;
    delete root.dataset.mobileChopView;
  }

  function selectActiveChop(index){
    const count=currentCount();
    if(!count)return false;
    stopChopAudition();stopEditorPlayhead();
    activePad=(Math.round(index)%count+count)%count;
    if(ChopperWaveSlices.mode===ChopperWaveSlices.modes.slices)ChopperWaveSlices.selectSlice(activePad,{redraw:false});
    else{selectedMarker=activePad;refreshMarkerEditor();}
    updateEditor();
    return true;
  }

  function navigateChop(delta){
    if(activePad<0)return false;
    return selectActiveChop(activePad+Number(delta||0));
  }

  function openEditor(index){
    if(!isMobile() || !sampleBuffer || !currentRange(index))return false;
    stopChopAudition();stopEditorPlayhead();
    activePad=index;
    if(ChopperWaveSlices.mode===ChopperWaveSlices.modes.slices)ChopperWaveSlices.selectSlice(index,{redraw:false});
    else{selectedMarker=index;refreshMarkerEditor();}
    showDedicatedView();
    updateEditor();
    $("chopStatus").textContent=`MOBILE CHOP ${String(index+1).padStart(2,"0")} • START / END`;
    return true;
  }

  function closeEditor(){
    stopEditorPlayhead();
    if(activePad>=0 || !workspace.hidden)stopChopAudition();
    activePad=-1;
    restoreDeckView();
    drawWave();
    renderPads();
    $("chopStatus").textContent=ChopperWaveSlices.mode===ChopperWaveSlices.modes.slices
      ? `CHOP MODE • SLICES • ${ChopperWaveSlices.slices.length}/${ChopperWaveSlices.maxSlices}`
      : "CHOP MODE • MARKERS";
    try{pads.scrollIntoView({block:"center",behavior:"auto"});}catch{}
  }

  function adjustBoundary(boundary,delta){
    const range=currentRange();
    if(!range)return;
    stopChopAudition();stopEditorPlayhead();
    const target=range[boundary]+Number(delta||0);
    if(ChopperWaveSlices.mode===ChopperWaveSlices.modes.slices){
      ChopperWaveSlices.setSliceBoundary(activePad,boundary,target,{redraw:false});
    }else{
      const markerIndex=activePad+(boundary==="end"?1:0);
      const [lo,hi]=markerBounds(markerIndex);
      const next=clamp(target,lo,hi);
      if(next!==markers[markerIndex])invalidatePreviewRender();
      markers[markerIndex]=next;
      selectedMarker=markerIndex;
      refreshMarkerEditor();
    }
    updateEditor();
  }

  async function previewCurrent(){
    const range=currentRange();
    if(!range)return;
    stopEditorPlayhead();
    const button=document.querySelectorAll("#pads .pad")[activePad]||workspace;
    await previewSlice(activePad,button);
    if(ChopperWaveSlices.mode===ChopperWaveSlices.modes.markers && chopAuditionSource){
      const audible=Math.max(.005,(range.end-range.start)/samplePitchRate());
      try{chopAuditionSource.stop(Math.max(ctx.currentTime+.005,chopAuditionStartedAt+audible));}catch{}
    }
    if(chopAuditionSource){
      playheadRange={start:range.start,end:range.end};
      playheadStartedAt=chopAuditionStartedAt;
      playheadRate=samplePitchRate();
      runEditorPlayhead();
    }
  }

  function clearHold(){
    if(holdTimer){clearTimeout(holdTimer);holdTimer=0;}
    holdPointerId=null;holdButton=null;
  }

  function padFromEvent(event){
    const button=event.target.closest?.("#pads .pad");
    return button && pads.contains(button)?button:null;
  }

  pads.addEventListener("pointerdown",event=>{
    if(!isMobile() || event.button!==0)return;
    const button=padFromEvent(event);
    if(!button || button.disabled)return;
    clearHold();
    holdPointerId=event.pointerId;holdButton=button;
    holdStartX=event.clientX;holdStartY=event.clientY;
    holdTimer=setTimeout(()=>{
      const held=holdButton;
      holdTimer=0;
      if(!held || held.disabled || !held.isConnected)return;
      const index=[...pads.querySelectorAll(".pad")].indexOf(held);
      if(index<0 || !openEditor(index))return;
      suppressClickButton=held;
      setTimeout(()=>{if(suppressClickButton===held)suppressClickButton=null;},700);
    },HOLD_MS);
  },true);

  pads.addEventListener("pointermove",event=>{
    if(event.pointerId===holdPointerId && holdTimer && Math.hypot(event.clientX-holdStartX,event.clientY-holdStartY)>MOVE_CANCEL_PX)clearHold();
  },true);
  for(const type of ["pointerup","pointercancel","pointerleave"]){
    pads.addEventListener(type,event=>{if(event.pointerId===holdPointerId)clearHold();},true);
  }
  pads.addEventListener("click",event=>{
    const button=padFromEvent(event);
    if(button && button===suppressClickButton){
      event.preventDefault();event.stopImmediatePropagation();suppressClickButton=null;
    }
  },true);
  pads.addEventListener("contextmenu",event=>{if(isMobile() && padFromEvent(event))event.preventDefault();});

  workspace.querySelectorAll("[data-mobile-boundary]").forEach(button=>{
    button.addEventListener("click",()=>adjustBoundary(button.dataset.mobileBoundary,button.dataset.mobileDelta));
  });
  prev.addEventListener("click",()=>navigateChop(-1));
  next.addEventListener("click",()=>navigateChop(1));
  preview.addEventListener("click",()=>{void previewCurrent();});
  done.addEventListener("click",closeEditor);

  document.getElementById("autoMarkers")?.addEventListener("click",closeEditor,true);
  document.getElementById("sampleFile")?.addEventListener("change",closeEditor,true);
  document.getElementById("sliceEditModeBtn")?.addEventListener("click",closeEditor,true);
  mobileMedia.addEventListener?.("change",event=>{if(!event.matches)closeEditor();});

  globalThis.ChopperMobileSliceEditor=Object.freeze({
    holdMs:HOLD_MS,
    get activePad(){return activePad;},
    get visible(){return !workspace.hidden;}
  });
})();