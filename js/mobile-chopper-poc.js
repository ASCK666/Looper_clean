"use strict";

// Mobile Chopper slice-editor POC.
// This file is injected only by mobile-chopper-poc.html and does not run in index.html.
(() => {
  const mobileQuery=matchMedia("(max-width: 760px)");
  const NUDGE_SECONDS=.005;
  let autoBaseline=[];
  let sliceIndex=0;
  let activeHandle="start";
  let draggingHandle="";
  let editorView={start:0,end:1,dur:1};

  document.body.classList.add("mobileChopperPoc");

  const legend=document.querySelector("#chopper .samplerControlLegend");
  if(legend){
    legend.textContent="TAP A SLICE TO EDIT • AUTO CHOP = 16 SLICES";
  }

  const editor=document.createElement("div");
  editor.id="mobileSliceEditor";
  editor.setAttribute("aria-hidden","true");
  editor.innerHTML=`
    <section class="mobileSliceSheet" role="dialog" aria-modal="true" aria-labelledby="mobileSliceTitle">
      <div class="mobileSliceGrabber" aria-hidden="true"></div>

      <div class="mobileSliceHeader">
        <button id="mobileSlicePrev" class="mobileSliceIconBtn" type="button" aria-label="Slice précédente">‹</button>
        <div class="mobileSliceHeaderCopy">
          <strong id="mobileSliceTitle">SLICE 01 / 16</strong>
          <small id="mobileSliceSubtitle">AUTO CHOP BASELINE</small>
        </div>
        <button id="mobileSliceClose" class="mobileSliceIconBtn" type="button" aria-label="Fermer l'éditeur">×</button>
      </div>

      <div class="mobileSliceWaveFrame">
        <canvas id="mobileSliceCanvas" width="1200" height="280" aria-label="Waveform zoomée de la slice"></canvas>
        <div class="mobileSliceWaveHint">
          <span>DRAG START / END</span>
          <span id="mobileSliceSharedHint">END = NEXT START</span>
        </div>
      </div>

      <div id="mobileSliceTimeReadout" class="mobileSliceTimeReadout">START — • END —</div>

      <div class="mobileSliceNudgeGrid">
        <div id="mobileSliceStartBox" class="mobileSliceNudgeBox active">
          <div class="mobileSliceNudgeHead"><span>START</span><small>±5 ms</small></div>
          <div class="mobileSliceNudgeButtons">
            <button id="mobileSliceStartMinus" type="button">− 5 ms</button>
            <button id="mobileSliceStartPlus" type="button">+ 5 ms</button>
          </div>
        </div>

        <div id="mobileSliceEndBox" class="mobileSliceNudgeBox">
          <div class="mobileSliceNudgeHead"><span>END / NEXT</span><small>±5 ms</small></div>
          <div class="mobileSliceNudgeButtons">
            <button id="mobileSliceEndMinus" type="button">− 5 ms</button>
            <button id="mobileSliceEndPlus" type="button">+ 5 ms</button>
          </div>
        </div>
      </div>

      <div class="mobileSliceActionGrid">
        <button id="mobileSliceAudition" type="button">▶ AUDITION</button>
        <button id="mobileSliceReset" type="button">RESET SLICE</button>
        <select id="mobileSliceSnap" aria-label="Mode de snap">
          <option value="transient">SNAP • TRANSIENT</option>
          <option value="grid">SNAP • GRID</option>
          <option value="free">SNAP • FREE</option>
        </select>
        <button id="mobileSliceNext" type="button">NEXT SLICE ›</button>
      </div>

      <div class="mobileSliceFooterNote">
        RESET restaure les deux frontières au dernier AUTO CHOP. La frontière END est partagée avec le START de la slice suivante.
      </div>
    </section>`;

  document.body.appendChild(editor);

  const editorCanvas=$("mobileSliceCanvas");
  const editor2d=editorCanvas.getContext("2d");

  function isMobile(){
    return mobileQuery.matches;
  }

  function captureBaseline(){
    autoBaseline=markers.slice();
  }

  function baselineReady(){
    return autoBaseline.length===markers.length && autoBaseline.length>1;
  }

  function currentSliceCount(){
    return Math.max(0,markers.length-1);
  }

  function clampSlice(index){
    return clamp(Number(index)||0,0,Math.max(0,currentSliceCount()-1));
  }

  function formatTime(sec){
    return `${Math.max(0,sec).toFixed(3)} s`;
  }

  function setActiveHandle(which){
    activeHandle=which==="end"?"end":"start";
    $("mobileSliceStartBox").classList.toggle("active",activeHandle==="start");
    $("mobileSliceEndBox").classList.toggle("active",activeHandle==="end");
    drawEditor();
  }

  function sliceEditorWindow(){
    if(!sampleBuffer || currentSliceCount()<1){
      return {start:0,end:1,dur:1};
    }

    const start=markers[sliceIndex];
    const end=markers[sliceIndex+1];
    const sliceDur=Math.max(.001,end-start);
    const minimumPad=Math.max(.02,sampleBuffer.duration/160);
    const pad=Math.max(sliceDur*.75,minimumPad);
    const viewStart=Math.max(0,start-pad);
    const viewEnd=Math.min(sampleBuffer.duration,end+pad);

    return {
      start:viewStart,
      end:Math.max(viewStart+.001,viewEnd),
      dur:Math.max(.001,viewEnd-viewStart)
    };
  }

  function editorXForTime(sec){
    return clamp((sec-editorView.start)/editorView.dur,0,1)*editorCanvas.width;
  }

  function editorTimeForClientX(clientX){
    const rect=editorCanvas.getBoundingClientRect();
    const ratio=clamp((clientX-rect.left)/Math.max(1,rect.width),0,1);
    return editorView.start+ratio*editorView.dur;
  }

  function drawHandle(x,label,selected){
    const h=editorCanvas.height;
    editor2d.save();
    editor2d.strokeStyle=selected?"#fff0b0":"#d48643";
    editor2d.lineWidth=selected?5:3;
    editor2d.shadowColor=selected?"rgba(255,229,160,.52)":"rgba(212,134,67,.42)";
    editor2d.shadowBlur=selected?12:7;
    editor2d.beginPath();
    editor2d.moveTo(x,0);
    editor2d.lineTo(x,h);
    editor2d.stroke();

    editor2d.shadowBlur=0;
    editor2d.fillStyle=selected?"#fff0b0":"#d48643";
    editor2d.beginPath();
    editor2d.moveTo(x-14,0);
    editor2d.lineTo(x+14,0);
    editor2d.lineTo(x,18);
    editor2d.closePath();
    editor2d.fill();

    editor2d.fillStyle="#f2dfbd";
    editor2d.font="900 24px monospace";
    editor2d.textAlign=x<editorCanvas.width*.5?"left":"right";
    editor2d.fillText(label,x+(x<editorCanvas.width*.5?18:-18),34);
    editor2d.restore();
  }

  function drawEditor(){
    const w=editorCanvas.width;
    const h=editorCanvas.height;
    editor2d.clearRect(0,0,w,h);
    editor2d.fillStyle="#080704";
    editor2d.fillRect(0,0,w,h);

    if(!sampleBuffer || currentSliceCount()<1){
      editor2d.fillStyle="#c9a975";
      editor2d.font="24px monospace";
      editor2d.fillText("LOAD SAMPLE",24,h/2);
      return;
    }

    sliceIndex=clampSlice(sliceIndex);
    editorView=sliceEditorWindow();

    editor2d.strokeStyle="#d7a455";
    editor2d.lineWidth=2;
    drawBufferRange(
      editor2d,
      sampleBuffer,
      editorView.start,
      editorView.end,
      0,
      w,
      h
    );

    const start=markers[sliceIndex];
    const end=markers[sliceIndex+1];
    const startX=editorXForTime(start);
    const endX=editorXForTime(end);

    editor2d.fillStyle="rgba(226,173,95,.065)";
    editor2d.fillRect(startX,0,Math.max(1,endX-startX),h);

    drawHandle(startX,"START",activeHandle==="start");
    drawHandle(endX,"END",activeHandle==="end");

    editor2d.fillStyle="#917f63";
    editor2d.font="18px monospace";
    editor2d.textAlign="center";
    editor2d.fillText(
      `SLICE ${String(sliceIndex+1).padStart(2,"0")}`,
      (startX+endX)/2,
      h-18
    );
  }

  function refreshEditor(){
    if(!sampleBuffer || currentSliceCount()<1){
      closeEditor();
      return;
    }

    sliceIndex=clampSlice(sliceIndex);
    const count=currentSliceCount();
    const start=markers[sliceIndex];
    const end=markers[sliceIndex+1];
    const durationMs=Math.max(0,(end-start)*1000);

    $("mobileSliceTitle").textContent=
      `SLICE ${String(sliceIndex+1).padStart(2,"0")} / ${String(count).padStart(2,"0")}`;
    $("mobileSliceSubtitle").textContent=sampleName||"CHOPPER SAMPLE";
    $("mobileSliceTimeReadout").textContent=
      `START ${formatTime(start)} • END ${formatTime(end)} • ${durationMs.toFixed(1)} ms`;
    $("mobileSlicePrev").disabled=sliceIndex<=0;
    $("mobileSliceNext").disabled=sliceIndex>=count-1;
    $("mobileSliceSharedHint").textContent=
      sliceIndex<count-1
        ? `END = SLICE ${String(sliceIndex+2).padStart(2,"0")} START`
        : "END = SAMPLE END";

    const snap=$("snapMode");
    $("mobileSliceSnap").value=snap?.value||"transient";

    drawEditor();
  }

  function openEditor(index){
    if(!isMobile() || !sampleBuffer || currentSliceCount()<1)return;
    if(!baselineReady())captureBaseline();

    stopChopAudition();
    sliceIndex=clampSlice(index);
    activeHandle="start";
    editor.classList.add("open");
    editor.setAttribute("aria-hidden","false");
    document.body.classList.add("sliceEditorOpen");
    setActiveHandle("start");
    refreshEditor();
  }

  function closeEditor(){
    draggingHandle="";
    editor.classList.remove("open");
    editor.setAttribute("aria-hidden","true");
    document.body.classList.remove("sliceEditorOpen");
  }

  function redrawChopperAfterMarkerChange(){
    refreshMarkerEditor();
    drawWave();
    renderPads();
    refreshEditor();
  }

  function moveBoundary(which,sec){
    if(!sampleBuffer || currentSliceCount()<1)return;
    const markerIndex=which==="end"?sliceIndex+1:sliceIndex;
    selectedMarker=markerIndex;
    moveMarker(markerIndex,sec,false);
    refreshEditor();
  }

  function nudge(which,delta){
    if(!sampleBuffer)return;
    const markerIndex=which==="end"?sliceIndex+1:sliceIndex;
    setActiveHandle(which);
    moveBoundary(which,markers[markerIndex]+delta);
  }

  function resetCurrentSlice(){
    if(!sampleBuffer || !baselineReady())return;

    const i=sliceIndex;
    const last=markers.length-1;
    const baselineStart=autoBaseline[i];
    const baselineEnd=autoBaseline[i+1];
    const previous=i>0?markers[i-1]+.001:0;
    const following=i+2<=last?markers[i+2]-.001:sampleBuffer.duration;

    const maxStart=Math.max(previous,following-.001);
    markers[i]=clamp(baselineStart,previous,maxStart);
    markers[i+1]=clamp(
      baselineEnd,
      markers[i]+.001,
      Math.max(markers[i]+.001,following)
    );

    selectedMarker=i;
    redrawChopperAfterMarkerChange();
  }

  function sliceFromMainWavePointer(ev){
    const mainCanvas=$("waveCanvas");
    const rect=mainCanvas.getBoundingClientRect();
    const vw=viewWindow();
    const ratio=clamp((ev.clientX-rect.left)/Math.max(1,rect.width),0,1);
    const sourceSec=displayToSourceTime(vw.start+ratio*vw.dur);

    for(let i=0;i<markers.length-1;i++){
      if(sourceSec>=markers[i] && sourceSec<=markers[i+1]){
        return i;
      }
    }

    let best=0;
    let distance=Infinity;
    for(let i=0;i<markers.length-1;i++){
      const center=(markers[i]+markers[i+1])/2;
      const d=Math.abs(center-sourceSec);
      if(d<distance){
        distance=d;
        best=i;
      }
    }
    return best;
  }

  const originalAutoPlaceMarkers=autoPlaceMarkers;
  autoPlaceMarkers=function(){
    const result=originalAutoPlaceMarkers.apply(this,arguments);
    if(sampleBuffer && markers.length>1){
      captureBaseline();
      if(editor.classList.contains("open")){
        sliceIndex=clampSlice(sliceIndex);
        refreshEditor();
      }
    }
    return result;
  };

  if(sampleBuffer && markers.length>1){
    captureBaseline();
  }

  $("waveCanvas").addEventListener("pointerdown",ev=>{
    if(!isMobile() || !sampleBuffer || currentSliceCount()<1)return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    openEditor(sliceFromMainWavePointer(ev));
  },true);

  editorCanvas.addEventListener("pointerdown",ev=>{
    if(!sampleBuffer)return;

    const startX=editorXForTime(markers[sliceIndex]);
    const endX=editorXForTime(markers[sliceIndex+1]);
    const rect=editorCanvas.getBoundingClientRect();
    const px=(ev.clientX-rect.left)/Math.max(1,rect.width)*editorCanvas.width;
    const startDistance=Math.abs(px-startX);
    const endDistance=Math.abs(px-endX);
    const nearest=startDistance<=endDistance?"start":"end";
    const nearestDistance=Math.min(startDistance,endDistance);

    setActiveHandle(nearest);

    // Large 72 px canvas hit area so the visible line can stay thin.
    if(nearestDistance<=72){
      draggingHandle=nearest;
      editorCanvas.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    }
  });

  editorCanvas.addEventListener("pointermove",ev=>{
    if(!draggingHandle || !sampleBuffer)return;
    ev.preventDefault();
    moveBoundary(draggingHandle,editorTimeForClientX(ev.clientX));
  });

  editorCanvas.addEventListener("pointerup",ev=>{
    if(draggingHandle && editorCanvas.hasPointerCapture(ev.pointerId)){
      editorCanvas.releasePointerCapture(ev.pointerId);
    }
    draggingHandle="";
  });

  editorCanvas.addEventListener("pointercancel",()=>{
    draggingHandle="";
  });

  $("mobileSliceClose").onclick=closeEditor;
  $("mobileSlicePrev").onclick=()=>{
    if(sliceIndex<=0)return;
    sliceIndex--;
    setActiveHandle("start");
    refreshEditor();
  };
  $("mobileSliceNext").onclick=()=>{
    if(sliceIndex>=currentSliceCount()-1)return;
    sliceIndex++;
    setActiveHandle("start");
    refreshEditor();
  };

  $("mobileSliceStartMinus").onclick=()=>nudge("start",-NUDGE_SECONDS);
  $("mobileSliceStartPlus").onclick=()=>nudge("start",NUDGE_SECONDS);
  $("mobileSliceEndMinus").onclick=()=>nudge("end",-NUDGE_SECONDS);
  $("mobileSliceEndPlus").onclick=()=>nudge("end",NUDGE_SECONDS);

  $("mobileSliceReset").onclick=()=>{
    resetCurrentSlice();
    setActiveHandle("start");
  };

  $("mobileSliceAudition").onclick=()=>{
    const pad=document.querySelectorAll("#pads .pad")[sliceIndex];
    previewSlice(sliceIndex,pad||$("mobileSliceAudition"));
  };

  $("mobileSliceSnap").onchange=()=>{
    const snap=$("snapMode");
    if(snap)snap.value=$("mobileSliceSnap").value;
  };

  editor.addEventListener("pointerdown",ev=>{
    if(ev.target===editor)closeEditor();
  });

  document.addEventListener("keydown",ev=>{
    if(ev.key==="Escape" && editor.classList.contains("open")){
      ev.preventDefault();
      closeEditor();
    }
  });

  mobileQuery.addEventListener?.("change",event=>{
    if(!event.matches)closeEditor();
  });
})();
