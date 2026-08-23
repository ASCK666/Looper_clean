"use strict";

// Mobile-only pad hold editor. It reuses the active Chopper edit model:
// MARKERS keeps the linked 1..16 chop boundaries; SLICES keeps independent ranges.
(() => {
  const pads=document.getElementById("pads");
  const host=pads?.parentElement;
  if(!pads || !host || !globalThis.ChopperWaveSlices || globalThis.ChopperMobileSliceEditor)return;

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

  const editor=document.createElement("div");
  editor.id="mobileChopEditor";
  editor.hidden=true;
  editor.setAttribute("aria-label","Éditeur mobile du chop");
  editor.innerHTML=`
    <div class="title compactTitle">CHOP <span id="mobileChopEditorTitle">--</span></div>
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
      <button id="mobileChopPreview" class="btn primary" type="button">PREVIEW</button>
      <button id="mobileChopDone" class="btn" type="button">DONE</button>
    </div>`;
  pads.insertAdjacentElement("afterend",editor);

  const title=document.getElementById("mobileChopEditorTitle");
  const rangeReadout=document.getElementById("mobileChopEditorRange");
  const preview=document.getElementById("mobileChopPreview");
  const done=document.getElementById("mobileChopDone");

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

  function updateEditor(){
    const range=currentRange();
    if(!range){
      closeEditor();
      return null;
    }
    const mode=ChopperWaveSlices.mode===ChopperWaveSlices.modes.slices?"SLICES":"MARKERS";
    title.textContent=`${String(activePad+1).padStart(2,"0")} • ${mode}`;
    rangeReadout.textContent=`START ${Math.round(range.start*1000)} ms • END ${Math.round(range.end*1000)} ms • LEN ${Math.round((range.end-range.start)*1000)} ms`;
    return range;
  }

  function openEditor(index){
    if(!isMobile() || !sampleBuffer)return false;
    const range=currentRange(index);
    if(!range)return false;

    stopChopAudition();
    activePad=index;
    if(ChopperWaveSlices.mode===ChopperWaveSlices.modes.slices){
      ChopperWaveSlices.selectSlice(index);
    }else{
      selectedMarker=index;
      refreshMarkerEditor();
      drawWave();
    }

    pads.hidden=true;
    editor.hidden=false;
    updateEditor();
    $("chopStatus").textContent=`MOBILE CHOP ${String(index+1).padStart(2,"0")} • START / END`;
    return true;
  }

  function closeEditor({stop=true}={}){
    if(stop)stopChopAudition();
    activePad=-1;
    editor.hidden=true;
    pads.hidden=false;
    return true;
  }

  function adjustBoundary(boundary,delta){
    const range=currentRange();
    if(!range)return false;
    const target=range[boundary]+Number(delta||0);

    if(ChopperWaveSlices.mode===ChopperWaveSlices.modes.slices){
      ChopperWaveSlices.setSliceBoundary(activePad,boundary,target);
    }else{
      const markerIndex=activePad+(boundary==="end"?1:0);
      moveMarker(markerIndex,target,false);
    }

    updateEditor();
    return true;
  }

  async function previewCurrent(){
    const range=currentRange();
    if(!range)return false;
    const button=document.querySelectorAll("#pads .pad")[activePad]||editor;
    await previewSlice(activePad,button);

    // MARKERS normally auditions from cue to sample end. In this editor the END
    // control must be audible, so stop this mobile preview at the chop boundary.
    if(ChopperWaveSlices.mode===ChopperWaveSlices.modes.markers && chopAuditionSource){
      const audible=Math.max(.005,(range.end-range.start)/samplePitchRate());
      const stopAt=Math.max(ctx.currentTime+.005,chopAuditionStartedAt+audible);
      try{chopAuditionSource.stop(stopAt);}catch{}
    }
    return true;
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

  editor.querySelectorAll("[data-mobile-boundary]").forEach(button=>{
    button.addEventListener("click",()=>adjustBoundary(button.dataset.mobileBoundary,button.dataset.mobileDelta));
  });
  preview.addEventListener("click",()=>{void previewCurrent();});
  done.addEventListener("click",()=>closeEditor());

  document.getElementById("autoMarkers")?.addEventListener("click",()=>closeEditor(),true);
  document.getElementById("sampleFile")?.addEventListener("change",()=>closeEditor(),true);
  document.getElementById("sliceEditModeBtn")?.addEventListener("click",()=>closeEditor(),true);
  mobileMedia.addEventListener?.("change",event=>{if(!event.matches)closeEditor();});

  globalThis.ChopperMobileSliceEditor=Object.freeze({
    holdMs:HOLD_MS,
    fineSec:FINE_SEC,
    coarseSec:COARSE_SEC,
    open:openEditor,
    close:closeEditor,
    adjust:adjustBoundary,
    preview:previewCurrent,
    get activePad(){return activePad;},
    get visible(){return !editor.hidden;}
  });
})();
