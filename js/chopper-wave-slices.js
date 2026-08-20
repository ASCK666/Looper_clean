"use strict";

// looper-next: make the existing Chopper waveform a direct slice editor without
// changing its physical height. Wave regions and pads are two views of the same
// 1..16 slice state.
(() => {
  const root=document.getElementById("chopper");
  const waveCanvas=document.getElementById("waveCanvas");
  const overlayCanvas=document.getElementById("playheadCanvas");
  if(!root || !waveCanvas || !overlayCanvas || root.dataset.waveSliceEditorInstalled==="1")return;
  if(typeof drawWave!=="function" || typeof renderPads!=="function" || typeof previewSlice!=="function")return;
  root.dataset.waveSliceEditorInstalled="1";

  const MARKER_GRAB_PX=18;
  const FLASH_MS=190;
  const MAX_SLICES=16;
  let selectedSlice=0;
  let localDragMarker=-1;
  let pointerSlice=-1;
  let activeSlice=-1;
  let flashSlice=-1;
  let flashUntil=0;

  waveCanvas.tabIndex=0;
  waveCanvas.setAttribute("aria-label","Waveform éditable du Chopper. Clic auditionne un slice, double-clic ajoute un slice, glisser déplace un marqueur, Suppr enlève le marqueur sélectionné.");
  waveCanvas.title="Click = audition • Double-click = new slice • Drag marker = move • Delete = remove";

  const style=document.createElement("style");
  style.dataset.chopperWaveSlices="1";
  style.textContent=`
    #chopper #waveCanvas { cursor:pointer; }
    #chopper #waveCanvas:focus { outline:1px solid rgba(226,173,95,.48); outline-offset:-2px; }
    #chopper .pad.selected:not(.hit):not(.active) {
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

  function availableSlices(){
    return Math.min(MAX_SLICES,Math.max(0,markers.length-1));
  }

  function clampSlice(index){
    const count=availableSlices();
    if(!count)return -1;
    return clamp(Math.round(Number(index)||0),0,count-1);
  }

  function sliceIndexAtSourceSec(sec){
    const count=availableSlices();
    if(!count)return -1;
    const t=clamp(Number(sec)||0,markers[0],markers[markers.length-1]);
    for(let i=0;i<count;i++){
      if(t>=markers[i] && (t<markers[i+1] || i===count-1))return i;
    }
    return count-1;
  }

  function sourceSecFromEvent(ev){
    const r=waveCanvas.getBoundingClientRect();
    const vw=viewWindow();
    const ratio=clamp((ev.clientX-r.left)/Math.max(1,r.width),0,1);
    return displayToSourceTime(vw.start+ratio*vw.dur);
  }

  function sourceSecToCssX(sec){
    const r=waveCanvas.getBoundingClientRect();
    const vw=viewWindow();
    const display=sourceToDisplayTime(sec);
    return (display-vw.start)/Math.max(.000001,vw.dur)*r.width;
  }

  function sourceSecToCanvasX(sec,target=waveCanvas){
    const vw=viewWindow();
    const display=sourceToDisplayTime(sec);
    return (display-vw.start)/Math.max(.000001,vw.dur)*target.width;
  }

  function sliceCanvasBounds(index,target=waveCanvas){
    const i=clampSlice(index);
    if(i<0)return null;
    return {
      left:sourceSecToCanvasX(markers[i],target),
      right:sourceSecToCanvasX(markers[i+1],target)
    };
  }

  function nearestMarkerFromEvent(ev){
    if(!markers.length)return {index:-1,distance:Infinity,sec:0};
    const sec=sourceSecFromEvent(ev);
    const r=waveCanvas.getBoundingClientRect();
    const mouseX=ev.clientX-r.left;
    let index=-1,distance=Infinity;
    for(let i=0;i<markers.length;i++){
      const d=Math.abs(sourceSecToCssX(markers[i])-mouseX);
      if(d<distance){distance=d;index=i;}
    }
    return {index,distance,sec};
  }

  function syncPadSelection(){
    document.querySelectorAll("#pads .pad").forEach((pad,i)=>{
      pad.classList.toggle("selected",i===selectedSlice && !pad.classList.contains("unavailable"));
      if(i===selectedSlice && !pad.disabled)pad.setAttribute("aria-current","true");
      else pad.removeAttribute("aria-current");
    });
  }

  function selectSlice(index,{syncMarker=true,redraw=true}={}){
    const next=clampSlice(index);
    if(next<0){selectedSlice=0;syncPadSelection();return -1;}
    selectedSlice=next;
    if(syncMarker){
      selectedMarker=clamp(next,0,Math.max(0,markers.length-1));
      refreshMarkerEditor();
    }
    syncPadSelection();
    if(redraw)drawWave();
    return selectedSlice;
  }

  function selectMarker(index,{redraw=true}={}){
    if(!markers.length)return -1;
    selectedMarker=clamp(Math.round(Number(index)||0),0,markers.length-1);
    refreshMarkerEditor();
    const count=availableSlices();
    selectedSlice=count?clamp(selectedMarker,0,count-1):0;
    syncPadSelection();
    if(redraw)drawWave();
    return selectedMarker;
  }

  function flash(index){
    const i=clampSlice(index);
    if(i<0)return;
    flashSlice=i;
    flashUntil=performance.now()+FLASH_MS;
  }

  function paintStaticWaveState(){
    if(!sampleBuffer || availableSlices()<=0)return;
    const w=waveCanvas.width,h=waveCanvas.height;
    const bounds=sliceCanvasBounds(selectedSlice,waveCanvas);
    if(bounds){
      const left=clamp(bounds.left,0,w);
      const right=clamp(bounds.right,0,w);
      if(right>left){
        c2d.save();
        c2d.fillStyle="rgba(226,173,95,.085)";
        c2d.fillRect(left,0,right-left,h);
        c2d.strokeStyle="rgba(240,180,95,.42)";
        c2d.lineWidth=2;
        c2d.strokeRect(left+1,1,Math.max(0,right-left-2),Math.max(0,h-2));
        c2d.fillStyle="#fff0d0";
        c2d.font="700 13px monospace";
        c2d.fillText(String(selectedSlice+1),Math.min(w-22,Math.max(7,left+7)),36);
        c2d.restore();
      }
    }

    const vw=viewWindow();
    c2d.save();
    for(let i=0;i<markers.length;i++){
      const display=sourceToDisplayTime(markers[i]);
      if(display<vw.start || display>vw.end)continue;
      const x=(display-vw.start)/Math.max(.000001,vw.dur)*w;
      const selected=i===selectedMarker;
      const locked=i===0 || i===markers.length-1;
      c2d.fillStyle=selected?"#fff1a8":(locked?"#c79045":"#d48643");
      c2d.shadowColor=selected?"rgba(255,225,150,.68)":"rgba(226,173,95,.32)";
      c2d.shadowBlur=selected?7:3;
      c2d.beginPath();
      c2d.moveTo(x-7,0);
      c2d.lineTo(x+7,0);
      c2d.lineTo(x+5,8);
      c2d.lineTo(x,12);
      c2d.lineTo(x-5,8);
      c2d.closePath();
      c2d.fill();
    }
    c2d.restore();
  }

  function paintActiveRegion(){
    if(!sampleBuffer || activeSlice<0)return;
    const bounds=sliceCanvasBounds(activeSlice,overlayCanvas);
    if(!bounds)return;
    const w=overlayCanvas.width,h=overlayCanvas.height;
    const left=clamp(bounds.left,0,w);
    const right=clamp(bounds.right,0,w);
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

  function addSliceAt(sec){
    if(!sampleBuffer)return false;
    if(availableSlices()>=MAX_SLICES){
      $("chopStatus").textContent="16 SLICES MAX";
      return false;
    }
    const gap=Math.min(.012,Math.max(.002,sampleBuffer.duration/500));
    const value=clamp(Number(sec)||0,gap,Math.max(gap,sampleBuffer.duration-gap));
    let insert=markers.findIndex(marker=>marker>value);
    if(insert<1)insert=markers.length-1;
    const previous=markers[insert-1];
    const next=markers[insert];
    if(!Number.isFinite(previous) || !Number.isFinite(next) || value-previous<gap || next-value<gap){
      $("chopStatus").textContent="SLICE TOO CLOSE TO MARKER";
      return false;
    }
    markers.splice(insert,0,value);
    selectedMarker=insert;
    selectedSlice=clamp(insert,0,markers.length-2);
    refreshMarkerEditor();
    renderPads();
    drawWave();
    $("chopStatus").textContent=`SLICE ${selectedSlice+1} ADDED ✓`;
    return true;
  }

  function deleteSelectedMarker(){
    if(!sampleBuffer || selectedMarker<=0 || selectedMarker>=markers.length-1){
      $("chopStatus").textContent="START / END MARKERS ARE LOCKED";
      return false;
    }
    const removed=selectedMarker;
    markers.splice(removed,1);
    selectedSlice=clamp(removed-1,0,Math.max(0,markers.length-2));
    selectedMarker=selectedSlice;
    refreshMarkerEditor();
    renderPads();
    drawWave();
    $("chopStatus").textContent=`SLICE MARKER REMOVED ✓`;
    return true;
  }

  const drawWaveBase=drawWave;
  drawWave=function(...args){
    const result=drawWaveBase(...args);
    paintStaticWaveState();
    return result;
  };

  const renderPadsBase=renderPads;
  renderPads=function(...args){
    const result=renderPadsBase(...args);
    const count=availableSlices();
    if(count)selectedSlice=clamp(selectedSlice,0,count-1);
    else selectedSlice=0;
    syncPadSelection();
    return result;
  };

  const setMarkersBase=setMarkers;
  setMarkers=function(...args){
    const result=setMarkersBase(...args);
    selectedSlice=0;
    selectedMarker=0;
    syncPadSelection();
    drawWave();
    return result;
  };

  const autoPlaceMarkersBase=autoPlaceMarkers;
  autoPlaceMarkers=function(...args){
    const result=autoPlaceMarkersBase(...args);
    selectedSlice=0;
    selectedMarker=0;
    syncPadSelection();
    drawWave();
    return result;
  };

  const previewSliceBase=previewSlice;
  previewSlice=async function(index,button){
    const i=selectSlice(index);
    if(i<0)return;
    flash(i);
    return await previewSliceBase(i,button);
  };

  const setActivePadBase=setActivePad;
  setActivePad=function(index){
    setActivePadBase(index);
    const next=clampSlice(index);
    if(index>=0 && next>=0){
      if(next!==activeSlice)flash(next);
      activeSlice=next;
    }else{
      activeSlice=-1;
    }
    syncPadSelection();
  };

  const drawPlayheadBase=drawPlayhead;
  drawPlayhead=function(...args){
    const result=drawPlayheadBase(...args);
    paintActiveRegion();
    paintReadablePlayhead();
    return result;
  };

  waveCanvas.addEventListener("pointerdown",ev=>{
    if(!sampleBuffer)return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    try{waveCanvas.focus({preventScroll:true});}catch{waveCanvas.focus();}
    const marker=nearestMarkerFromEvent(ev);
    const internal=marker.index>0 && marker.index<markers.length-1;
    if(internal && marker.distance<=MARKER_GRAB_PX){
      localDragMarker=marker.index;
      pointerSlice=-1;
      selectMarker(marker.index);
      waveCanvas.style.cursor="ew-resize";
      try{waveCanvas.setPointerCapture(ev.pointerId);}catch{}
      return;
    }
    localDragMarker=-1;
    pointerSlice=sliceIndexAtSourceSec(marker.sec);
    selectSlice(pointerSlice);
  },true);

  waveCanvas.addEventListener("pointermove",ev=>{
    if(!sampleBuffer)return;
    if(localDragMarker>=0){
      ev.stopImmediatePropagation();
      ev.preventDefault();
      moveMarker(localDragMarker,sourceSecFromEvent(ev),false);
      selectMarker(localDragMarker,{redraw:false});
      drawWave();
      return;
    }
    const marker=nearestMarkerFromEvent(ev);
    const internal=marker.index>0 && marker.index<markers.length-1;
    waveCanvas.style.cursor=internal && marker.distance<=MARKER_GRAB_PX?"ew-resize":"pointer";
  },true);

  waveCanvas.addEventListener("pointerup",ev=>{
    if(!sampleBuffer)return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    if(localDragMarker>=0){
      try{waveCanvas.releasePointerCapture(ev.pointerId);}catch{}
      localDragMarker=-1;
      waveCanvas.style.cursor="pointer";
      return;
    }
    const i=pointerSlice;
    pointerSlice=-1;
    if(i>=0){
      const pad=document.querySelectorAll("#pads .pad")[i];
      void previewSlice(i,pad||waveCanvas);
    }
  },true);

  waveCanvas.addEventListener("pointercancel",ev=>{
    ev.stopImmediatePropagation();
    localDragMarker=-1;
    pointerSlice=-1;
    waveCanvas.style.cursor="pointer";
  },true);

  waveCanvas.addEventListener("dblclick",ev=>{
    if(!sampleBuffer)return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    stopChopAudition();
    addSliceAt(sourceSecFromEvent(ev));
    try{waveCanvas.focus({preventScroll:true});}catch{waveCanvas.focus();}
  },true);

  document.addEventListener("keydown",ev=>{
    if(ev.key!=="Delete" && ev.key!=="Backspace")return;
    if(document.activeElement!==waveCanvas)return;
    ev.preventDefault();
    ev.stopPropagation();
    deleteSelectedMarker();
  },true);

  globalThis.ChopperWaveSlices={
    maxSlices:MAX_SLICES,
    markerGrabPx:MARKER_GRAB_PX,
    get selectedSlice(){return selectedSlice;},
    get activeSlice(){return activeSlice;},
    selectSlice,
    selectMarker,
    sliceIndexAtSourceSec,
    sliceCanvasBounds,
    addSliceAt,
    deleteSelectedMarker
  };

  renderPads();
  drawWave();
})();