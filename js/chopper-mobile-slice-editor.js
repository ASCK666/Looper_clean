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

  const workspace=document.createElement("section");
  workspace.id="mobileChopWorkspace";
  workspace.className="panel";
  workspace.hidden=true;
  workspace.setAttribute("aria-label","Éditeur mobile du chop");
  workspace.innerHTML=`
    <div class="samplerSequenceHead">
      <div id="mobileChopEditorTitle" class="title compactTitle">CHOP --</div>
      <div class="sequenceActions">
        <button id="mobileChopDone" class="btn" type="button">DONE</button>
      </div>
    </div>
    <div class="wavewrap largeWave samplerScreen">
      <canvas id="mobileChopWave" width="900" height="220" aria-label="Waveform du sample et chop sélectionné"></canvas>
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
    <button id="mobileChopPreview" class="btn primary" type="button">PREVIEW CHOP</button>`;
  deck.appendChild(workspace);

  const title=document.getElementById("mobileChopEditorTitle");
  const rangeReadout=document.getElementById("mobileChopEditorRange");
  const wave=document.getElementById("mobileChopWave");
  const wave2d=wave.getContext("2d");
  const preview=document.getElementById("mobileChopPreview");
  const done=document.getElementById("mobileChopDone");

  // The dedicated view deliberately reuses existing Chopper primitives instead
  // of adding another mobile stylesheet/component skin.
  wave.style.display="block";
  wave.style.width="100%";
  wave.style.height="190px";
  wave.style.touchAction="none";
  workspace.style.width="100%";

  function isMobile(){
    return mobileMedia.matches;
  }

  function currentRange(index=activePad){
    if(index<0)return null;
    if(ChopperWaveSlices.mode===ChopperWaveSlices.modes.slices){
      return ChopperWaveSlices.slices[index]||null;
    }
    if(index>=markers.length-1)return null;
    return {start:markers[index],end:markers[index+1]};
  }

  function drawEditorWave(){
    const w=wave.width,h=wave.height;
    wave2d.clearRect(0,0,w,h);
    wave2d.fillStyle="#080604";
    wave2d.fillRect(0,0,w,h);
    if(!sampleBuffer)return;

    wave2d.strokeStyle="#d7a455";
    wave2d.lineWidth=1;
    drawBufferRange(wave2d,sampleBuffer,0,sampleBuffer.duration,0,w,h);

    const range=currentRange();
    if(!range)return;
    const dur=Math.max(.001,sampleBuffer.duration);
    const left=clamp(range.start/dur*w,0,w);
    const right=clamp(range.end/dur*w,0,w);

    wave2d.fillStyle="rgba(0,0,0,.58)";
    wave2d.fillRect(0,0,left,h);
    wave2d.fillRect(right,0,w-right,h);
    wave2d.fillStyle="rgba(226,173,95,.10)";
    wave2d.fillRect(left,0,Math.max(0,right-left),h);

    wave2d.strokeStyle="#ffe0a5";
    wave2d.lineWidth=3;
    wave2d.beginPath();
    wave2d.moveTo(left,0);wave2d.lineTo(left,h);
    wave2d.moveTo(right,0);wave2d.lineTo(right,h);
    wave2d.stroke();

    wave2d.fillStyle="#fff0d0";
    wave2d.font="700 12px monospace";
    wave2d.fillText(`CHOP ${String(activePad+1).padStart(2,"0")}`,Math.min(w-78,Math.max(8,left+8)),20);
  }

  function updateEditor(){
    const range=currentRange();
    if(!range){
      closeEditor();
      return null;
    }
    const mode=ChopperWaveSlices.mode===ChopperWaveSlices.modes.slices?"SLICES":"MARKERS";
    title.textContent=`CHOP ${String(activePad+1).padStart(2,"0")} • ${mode}`;
    rangeReadout.textContent=`START ${Math.round(range.start*1000)} ms • END ${Math.round(range.end*1000)} ms • LEN ${Math.round((range.end-range.start)*1000)} ms`;
    drawEditorWave();
    return range;
  }

  function showDedicatedView(){
    hiddenDeckChildren=[];
    for(const child of deck.children){
      if(child===workspace)continue;
      hiddenDeckChildren.push({
        element:child,
        display:child.style.getPropertyValue("display"),
        priority:child.style.getPropertyPriority("display")
      });
      child.style.setProperty("display","none","important");
    }
    workspace.hidden=false;
    root.dataset.mobileChopView="1";
    try{workspace.scrollIntoView({block:"start",behavior:"auto"});}catch{}
  }

  function restoreDeckView(){
    for(const state of hiddenDeckChildren){
      if(state.display)state.element.style.setProperty("display",state.display,state.priority);
      else state.element.style.removeProperty("display");
    }
    hiddenDeckChildren=[];
    workspace.hidden=true;
    delete root.dataset.mobileChopView;
  }

  function openEditor(index){
    if(!isMobile() || !sampleBuffer || !currentRange(index))return false;

    stopChopAudition();
    activePad=index;
    if(ChopperWaveSlices.mode===ChopperWaveSlices.modes.slices){
      ChopperWaveSlices.selectSlice(index);
    }else{
      selectedMarker=index;
      refreshMarkerEditor();
      drawWave();
    }

    showDedicatedView();
    updateEditor();
    $("chopStatus").textContent=`MOBILE CHOP ${String(index+1).padStart(2,"0")} • START / END`;
    return true;
  }

  function closeEditor(){
    if(activePad>=0 || !workspace.hidden)stopChopAudition();
    activePad=-1;
    restoreDeckView();
  }

  function adjustBoundary(boundary,delta){
    const range=currentRange();
    if(!range)return;
    const target=range[boundary]+Number(delta||0);

    if(ChopperWaveSlices.mode===ChopperWaveSlices.modes.slices){
      ChopperWaveSlices.setSliceBoundary(activePad,boundary,target);
    }else{
      moveMarker(activePad+(boundary==="end"?1:0),target,false);
    }
    updateEditor();
  }

  async function previewCurrent(){
    const range=currentRange();
    if(!range)return;
    const button=document.querySelectorAll("#pads .pad")[activePad]||workspace;
    await previewSlice(activePad,button);

    // MARKERS normally auditions from cue to sample end. In this dedicated CHOP
    // view the END control must be audible, so stop at the current chop boundary.
    if(ChopperWaveSlices.mode===ChopperWaveSlices.modes.markers && chopAuditionSource){
      const audible=Math.max(.005,(range.end-range.start)/samplePitchRate());
      const stopAt=Math.max(ctx.currentTime+.005,chopAuditionStartedAt+audible);
      try{chopAuditionSource.stop(stopAt);}catch{}
    }
  }

  function clearHold(){
    if(holdTimer){
      clearTimeout(holdTimer);
      holdTimer=0;
    }
    holdPointerId=null;
    holdButton=null;
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
    holdPointerId=event.pointerId;
    holdButton=button;
    holdStartX=event.clientX;
    holdStartY=event.clientY;
    holdTimer=setTimeout(()=>{
      const held=holdButton;
      holdTimer=0;
      if(!held || held.disabled || !held.isConnected)return;
      const index=[...pads.querySelectorAll(".pad")].indexOf(held);
      if(index<0 || !openEditor(index))return;
      suppressClickButton=held;
      setTimeout(()=>{
        if(suppressClickButton===held)suppressClickButton=null;
      },700);
    },HOLD_MS);
  },true);

  pads.addEventListener("pointermove",event=>{
    if(event.pointerId!==holdPointerId || !holdTimer)return;
    if(Math.hypot(event.clientX-holdStartX,event.clientY-holdStartY)>MOVE_CANCEL_PX)clearHold();
  },true);

  for(const type of ["pointerup","pointercancel","pointerleave"]){
    pads.addEventListener(type,event=>{
      if(event.pointerId===holdPointerId)clearHold();
    },true);
  }

  pads.addEventListener("click",event=>{
    const button=padFromEvent(event);
    if(button && button===suppressClickButton){
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClickButton=null;
    }
  },true);

  pads.addEventListener("contextmenu",event=>{
    if(isMobile() && padFromEvent(event))event.preventDefault();
  });

  workspace.querySelectorAll("[data-mobile-boundary]").forEach(button=>{
    button.addEventListener("click",()=>adjustBoundary(button.dataset.mobileBoundary,button.dataset.mobileDelta));
  });
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