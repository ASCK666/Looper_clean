"use strict";

// Long-sample Chopper banks. A bank owns its marker/slice pad layout and its
// 16-step Chopper sequence. Windows are 30 seconds wide and advance by 25
// seconds, giving adjacent banks a 5-second overlap. ALL remains independent.
(() => {
  const root=document.getElementById("chopper");
  const waveCanvas=document.getElementById("waveCanvas");
  const waveWrap=waveCanvas?.closest(".wavewrap");
  const displayBody=waveWrap?.parentElement;
  if(!root || !waveCanvas || !waveWrap || !displayBody || !globalThis.ChopperWaveSlices)return;
  if(root.dataset.sampleBanksInstalled==="1")return;
  root.dataset.sampleBanksInstalled="1";

  const BANK_WINDOW_SEC=30;
  const BANK_OVERLAP_SEC=5;
  const BANK_STEP_SEC=BANK_WINDOW_SEC-BANK_OVERLAP_SEC;
  const EPS=.000001;

  let banks=[];
  let activeBankIndex=0;

  const bankTabs=document.createElement("div");
  bankTabs.id="chopperBankTabs";
  bankTabs.className="chopperBankTabs";
  bankTabs.setAttribute("role","tablist");
  bankTabs.setAttribute("aria-label","Portions du sample");
  bankTabs.hidden=true;
  waveWrap.insertAdjacentElement("afterend",bankTabs);

  const style=document.createElement("style");
  style.dataset.chopperBanks="1";
  style.textContent=`
    #chopper .samplerScreenModule {
      grid-template-areas:
        "actions actions actions actions actions actions"
        "fine fine fine fine fine fine"
        "title pitch tempo volume punch vinyl"
        "wave wave wave wave wave wave"
        "banks banks banks banks banks banks"
        "status status status status status status"
        "info info info info info info" !important;
    }
    #chopper .chopperBankTabs {
      grid-area:banks;
      display:flex;
      min-width:0;
      gap:5px;
      margin:0;
      padding:2px 0 4px;
      overflow-x:auto;
      overflow-y:hidden;
      scrollbar-width:thin;
      overscroll-behavior-x:contain;
      -webkit-overflow-scrolling:touch;
    }
    #chopper .chopperBankTabs[hidden] { display:none !important; }
    #chopper .chopperBankTab {
      flex:0 0 auto;
      min-width:54px;
      min-height:30px;
      margin:0;
      padding:5px 9px;
      border:1px solid #493927;
      border-radius:3px;
      color:#a99578;
      background:linear-gradient(180deg,#17130f,#0c0907);
      box-shadow:inset 0 1px 0 rgba(255,255,255,.02);
      font:800 8px/1 var(--font-mono);
      letter-spacing:.45px;
      white-space:nowrap;
      cursor:pointer;
    }
    #chopper .chopperBankTab:hover {
      color:#d9c39f;
      border-color:#765a34;
    }
    #chopper .chopperBankTab.active,
    #chopper .chopperBankTab[aria-selected="true"] {
      color:#ffe0a5;
      border-color:#9a7038;
      background:linear-gradient(180deg,#4b321d,#24170e);
      box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 0 8px rgba(226,173,95,.12);
    }
    #chopper .chopperBankTab:focus-visible {
      outline:1px solid #d9a85d;
      outline-offset:1px;
    }
    @media (max-width:760px) {
      #chopper .chopperBankTabs { gap:4px;padding-bottom:3px; }
      #chopper .chopperBankTab { min-height:34px;padding:6px 9px;font-size:8px; }
    }
  `;
  document.head.appendChild(style);

  function formatTime(sec){
    const value=Math.max(0,Number(sec)||0);
    const rounded=Math.round(value);
    return Math.abs(value-rounded)<.05 ? String(rounded) : value.toFixed(1).replace(/\.0$/,"");
  }

  function makeBank(id,label,start,end){
    return {id,label,start,end,state:null};
  }

  function buildBanks(duration){
    const total=Math.max(0,Number(duration)||0);
    const next=[makeBank("all","ALL",0,total)];
    if(total<=BANK_WINDOW_SEC+EPS)return next;

    for(let start=0;start<total-EPS;start+=BANK_STEP_SEC){
      const end=Math.min(total,start+BANK_WINDOW_SEC);
      next.push(makeBank(
        `window-${Math.round(start*1000)}`,
        `${formatTime(start)}–${formatTime(end)}`,
        start,
        end
      ));
      if(end>=total-EPS)break;
    }
    return next;
  }

  function activeBank(){
    return banks[activeBankIndex]||null;
  }

  function activeRange(){
    const bank=activeBank();
    if(bank && sampleBuffer)return {start:bank.start,end:bank.end};
    return {start:0,end:sampleBuffer?.duration||0};
  }

  function isWindowBank(){
    return !!sampleBuffer && banks.length>1 && activeBankIndex>0;
  }

  function normalizeGrid(values){
    const result=new Array(CHOPPER_SEQUENCE_STEPS).fill(0);
    if(!Array.isArray(values))return result;
    for(let i=0;i<Math.min(values.length,CHOPPER_SEQUENCE_STEPS);i++){
      const pad=Number(values[i])||0;
      result[i]=pad>=1 && pad<=16 ? pad : 0;
    }
    return result;
  }

  function defaultSliceRanges(bank){
    const count=ChopperWaveSlices.initialSlices||4;
    const span=Math.max(0,bank.end-bank.start);
    return Array.from({length:count},(_,i)=>({
      start:bank.start+span*i/count,
      end:bank.start+span*(i+1)/count
    }));
  }

  function regularMarkers(bank,count){
    const n=clamp(Math.round(Number(count)||8),1,16);
    const span=Math.max(0,bank.end-bank.start);
    return Array.from({length:n+1},(_,i)=>bank.start+span*i/n);
  }

  function autoMarkersForBank(bank,count){
    const n=clamp(Math.round(Number(count)||8),1,16);
    const mode=$("snapMode")?.value||"free";
    const span=Math.max(0,bank.end-bank.start);
    const minGap=Math.min(.012,Math.max(.002,span/(n*20)));

    if(mode!=="transient" || !transients.length){
      return regularMarkers(bank,n);
    }

    const chosen=[bank.start];
    const usable=transients
      .filter(t=>t>bank.start+minGap && t<bank.end-minGap)
      .sort((a,b)=>a-b);

    for(let i=1;i<n;i++){
      const target=bank.start+span*i/n;
      const lo=chosen[chosen.length-1]+minGap;
      const hi=bank.end-(n-i)*minGap;
      let best=clamp(target,lo,hi);
      let bestD=Infinity;

      for(const t of usable){
        if(t<lo || t>hi)continue;
        const distance=Math.abs(t-target);
        if(distance<bestD){
          bestD=distance;
          best=t;
        }
      }
      chosen.push(clamp(best,lo,hi));
    }

    chosen.push(bank.end);
    return chosen;
  }

  function setSliceRange(index,range){
    ChopperWaveSlices.setSliceBoundary(index,"end",range.end,{redraw:false});
    ChopperWaveSlices.setSliceBoundary(index,"start",range.start,{redraw:false});
  }

  // The SLICES editor intentionally keeps its state private. Rebuild it through
  // its public operations so each bank can restore exact independent ranges
  // without reaching into that closure.
  function restoreSliceRanges(targetRanges,selected=0,targetMode=ChopperWaveSlices.mode){
    if(!sampleBuffer)return;
    const bank=activeBank()||makeBank("all","ALL",0,sampleBuffer.duration);
    const minSec=Math.max(.0001,Number(ChopperWaveSlices.minSliceSec)||.008);
    const maxSlices=Math.max(4,Number(ChopperWaveSlices.maxSlices)||16);
    const target=(Array.isArray(targetRanges)?targetRanges:defaultSliceRanges(bank))
      .slice(0,maxSlices)
      .map(range=>({
        start:clamp(Number(range.start)||bank.start,bank.start,bank.end),
        end:clamp(Number(range.end)||bank.end,bank.start,bank.end)
      }))
      .filter(range=>range.end-range.start>=minSec-EPS);

    const desired=target.length>=4 ? target : defaultSliceRanges(bank);
    const savedGrid=normalizeGrid(loopGridEvents);

    ChopperWaveSlices.setEditMode("slices");
    ChopperWaveSlices.resetSlices();

    // Normalize the editor's four seeds to the active bank first. The legacy
    // seed function still spans the physical AudioBuffer at its outer edges.
    const seed=defaultSliceRanges(bank);
    for(let i=seed.length-1;i>=0;i--)setSliceRange(i,seed[i]);

    let guard=32;
    while(ChopperWaveSlices.slices.length<desired.length && guard--){
      const ranges=ChopperWaveSlices.slices;
      let bestIndex=-1;
      let bestLength=-1;
      for(let i=0;i<ranges.length;i++){
        const length=ranges[i].end-ranges[i].start;
        if(length>bestLength){bestLength=length;bestIndex=i;}
      }
      if(bestIndex<0 || bestLength<minSec*2.1)break;
      const range=ranges[bestIndex];
      if(!ChopperWaveSlices.addSliceAt((range.start+range.end)/2))break;
    }

    const count=Math.min(desired.length,ChopperWaveSlices.slices.length);
    if(count===desired.length){
      // Compact all slices at the left edge. This creates enough free space to
      // restore arbitrary gaps/ranges without one neighbour clamping another.
      for(let i=0;i<count;i++){
        const start=bank.start+i*minSec;
        ChopperWaveSlices.setSliceBoundary(i,"start",start,{redraw:false});
        ChopperWaveSlices.setSliceBoundary(i,"end",start+minSec,{redraw:false});
      }
      for(let i=count-1;i>=0;i--)setSliceRange(i,desired[i]);
    }

    loopGridEvents=savedGrid;
    ChopperWaveSlices.selectSlice(clamp(Number(selected)||0,0,Math.max(0,count-1)),{redraw:false});
    ChopperWaveSlices.setEditMode(targetMode==="slices"?"slices":"markers");
  }

  function captureState(){
    return {
      markers:markers.slice(),
      selectedMarker,
      grid:normalizeGrid(loopGridEvents),
      mode:ChopperWaveSlices.mode,
      slices:ChopperWaveSlices.slices.map(range=>({...range})),
      selectedSlice:ChopperWaveSlices.selectedSlice,
      sliceCount:$("sliceCount")?.value||String(Math.max(1,markers.length-1)),
      zoom:$("waveZoom")?.value||"1",
      scroll:$("waveScroll")?.value||"0"
    };
  }

  function saveActiveBank(){
    const bank=activeBank();
    if(!bank || !sampleBuffer)return;
    bank.state=captureState();
  }

  function freshState(bank,inheritedMode="markers"){
    const count=clamp(Math.round(Number($("sliceCount")?.value)||16),1,16);
    return {
      markers:autoMarkersForBank(bank,count),
      selectedMarker:0,
      grid:new Array(CHOPPER_SEQUENCE_STEPS).fill(0),
      mode:inheritedMode==="slices"?"slices":"markers",
      slices:defaultSliceRanges(bank),
      selectedSlice:0,
      sliceCount:String(count),
      zoom:"1",
      scroll:"0"
    };
  }

  function applyState(bank,state){
    if(!bank || !state || !sampleBuffer)return;
    if($("sliceCount") && [...$("sliceCount").options].some(option=>option.value===String(state.sliceCount))){
      $("sliceCount").value=String(state.sliceCount);
    }
    if($("waveZoom"))$("waveZoom").value=state.zoom||"1";
    if($("waveScroll"))$("waveScroll").value=state.scroll||"0";

    markers=Array.isArray(state.markers)?state.markers.slice():regularMarkers(bank,16);
    selectedMarker=clamp(Number(state.selectedMarker)||0,0,Math.max(0,markers.length-1));
    refreshMarkerEditor();

    // Restore private SLICES before the grid because adding slices can remap
    // grid pad numbers internally. The saved bank sequence wins afterwards.
    loopGridEvents=new Array(CHOPPER_SEQUENCE_STEPS).fill(0);
    restoreSliceRanges(state.slices,state.selectedSlice,state.mode);
    loopGridEvents=normalizeGrid(state.grid);

    renderedFlip=null;
    renderPads();
    drawWave();
    renderSampleTimeline();
    clearPlayhead();
  }

  function renderBankTabs(){
    bankTabs.textContent="";
    bankTabs.hidden=banks.length<=1;
    if(bankTabs.hidden)return;

    banks.forEach((bank,index)=>{
      const button=document.createElement("button");
      const active=index===activeBankIndex;
      button.type="button";
      button.className=`chopperBankTab${active?" active":""}`;
      button.dataset.bankIndex=String(index);
      button.setAttribute("role","tab");
      button.setAttribute("aria-selected",active?"true":"false");
      button.setAttribute("aria-controls","waveCanvas");
      button.tabIndex=active?0:-1;
      button.textContent=bank.label;
      button.title=index===0
        ? "Sample complet • banque indépendante"
        : `${formatTime(bank.start)}–${formatTime(bank.end)} s • 16 pads indépendants`;
      button.addEventListener("click",()=>selectBank(index));
      bankTabs.appendChild(button);
    });
  }

  function selectBank(index){
    if(!sampleBuffer || !banks.length)return false;
    const next=clamp(Math.round(Number(index)||0),0,banks.length-1);
    if(next===activeBankIndex){
      renderBankTabs();
      return true;
    }

    const inheritedMode=ChopperWaveSlices.mode;
    saveActiveBank();
    stopChopAudition();
    if(typeof stopCurrentBeat==="function" && isLoopPlaying)stopCurrentBeat();
    renderedFlip=null;
    if(typeof draggingMarker!=="undefined")draggingMarker=-1;

    activeBankIndex=next;
    const bank=activeBank();
    if(!bank.state)bank.state=freshState(bank,inheritedMode);
    applyState(bank,bank.state);
    renderBankTabs();

    const status=$("chopStatus");
    if(status){
      status.textContent=next===0
        ? `BANK ALL • ${ChopperWaveSlices.mode.toUpperCase()} • 16 PADS`
        : `BANK ${bank.label} • ${ChopperWaveSlices.mode.toUpperCase()} • 16 PADS`;
    }
    return true;
  }

  bankTabs.addEventListener("keydown",event=>{
    const button=event.target.closest(".chopperBankTab");
    if(!button || !banks.length)return;
    let next=Number(button.dataset.bankIndex)||0;
    if(event.key==="ArrowRight")next=(next+1)%banks.length;
    else if(event.key==="ArrowLeft")next=(next-1+banks.length)%banks.length;
    else if(event.key==="Home")next=0;
    else if(event.key==="End")next=banks.length-1;
    else return;
    event.preventDefault();
    selectBank(next);
    requestAnimationFrame(()=>bankTabs.querySelector(`[data-bank-index="${next}"]`)?.focus());
  });

  const viewWindowBase=viewWindow;
  viewWindow=function(){
    if(!isWindowBank())return viewWindowBase();
    const bank=activeBank();
    const zoom=Math.max(1,Number($("waveZoom")?.value)||1);
    const displayStart=sourceToDisplayTime(bank.start);
    const displayEnd=sourceToDisplayTime(bank.end);
    const total=Math.max(.000001,displayEnd-displayStart);
    const dur=total/zoom;
    const maxOffset=Math.max(0,total-dur);
    const scroll=(Number($("waveScroll")?.value)||0)/1000;
    const start=displayStart+maxOffset*scroll;
    return {start,dur,end:start+dur};
  };

  waveCanvas.addEventListener("wheel",event=>{
    if(!isWindowBank())return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const oldView=viewWindow();
    const oldZoom=Math.max(1,Number($("waveZoom")?.value)||1);
    const nextZoom=clamp(oldZoom+(event.deltaY<0?1:-1),1,24);
    $("waveZoom").value=String(nextZoom);

    const rect=waveCanvas.getBoundingClientRect();
    const mouseRatio=clamp((event.clientX-rect.left)/Math.max(1,rect.width),0,1);
    const bank=activeBank();
    const displayStart=sourceToDisplayTime(bank.start);
    const displayEnd=sourceToDisplayTime(bank.end);
    const total=Math.max(.000001,displayEnd-displayStart);
    const visibleDur=total/nextZoom;
    const maxOffset=Math.max(0,total-visibleDur);

    if(maxOffset>0){
      const focus=oldView.start+mouseRatio*oldView.dur;
      const desired=clamp(focus-mouseRatio*visibleDur-displayStart,0,maxOffset);
      $("waveScroll").value=String(Math.round(desired/maxOffset*1000));
    }else{
      $("waveScroll").value="0";
    }
    drawWave();
  },{capture:true,passive:false});

  const markerBoundsBase=markerBounds;
  markerBounds=function(index){
    if(!isWindowBank())return markerBoundsBase(index);
    const gap=.001;
    const bank=activeBank();
    if(index===0)return [bank.start,Math.max(bank.start,markers[1]-gap)];
    if(index===markers.length-1)return [markers[index-1]+gap,bank.end];
    return [markers[index-1]+gap,markers[index+1]-gap];
  };

  function installMarkers(next,label){
    markers=next.slice();
    selectedMarker=0;
    refreshMarkerEditor();
    const mode=ChopperWaveSlices.mode;
    const bank=activeBank();
    const grid=normalizeGrid(loopGridEvents);
    restoreSliceRanges(defaultSliceRanges(bank),0,mode);
    loopGridEvents=grid;
    renderedFlip=null;
    renderPads();
    drawWave();
    renderSampleTimeline();
    if($("sampleInfo"))$("sampleInfo").textContent=label;
  }

  const setMarkersBase=setMarkers;
  setMarkers=function(count){
    if(!isWindowBank())return setMarkersBase(count);
    const bank=activeBank();
    const n=clamp(Math.round(Number(count)||8),1,16);
    installMarkers(regularMarkers(bank,n),`${n} chops • banque ${bank.label}`);
  };

  const autoPlaceMarkersBase=autoPlaceMarkers;
  autoPlaceMarkers=function(){
    if(!isWindowBank())return autoPlaceMarkersBase();
    const bank=activeBank();
    const n=clamp(Math.round(Number($("sliceCount")?.value)||8),1,16);
    const mode=$("snapMode")?.value||"free";
    installMarkers(
      autoMarkersForBank(bank,n),
      `${n} chops • ${mode==="transient"?"transients":"répartition"} • banque ${bank.label}`
    );
  };

  const previewSliceBase=previewSlice;
  previewSlice=async function(index,button){
    const result=await previewSliceBase(index,button);
    if(!isWindowBank() || ChopperWaveSlices.mode==="slices" || !chopAuditionSource)return result;
    const bank=activeBank();
    const start=clamp(Number(markers[index])||bank.start,bank.start,bank.end);
    const audible=Math.max(.005,(bank.end-start)/samplePitchRate());
    const stopAt=Math.max(ctx.currentTime+.005,chopAuditionStartedAt+audible);
    try{chopAuditionSource.stop(stopAt);}catch{}
    return result;
  };

  const buildLoopPlayheadStateBase=buildLoopPlayheadState;
  buildLoopPlayheadState=function(){
    if(!isWindowBank() || ChopperWaveSlices.mode==="slices")return buildLoopPlayheadStateBase();
    if(!sampleBuffer)return null;

    const bank=activeBank();
    const bpm=Math.max(40,Number($("sampleBpm")?.value)||90);
    const stepDur=(60/bpm)/2;
    const targetDur=8*60/bpm;
    const pitchRate=samplePitchRate();
    const events=gridEventsForRender();
    const placed=[];

    for(let step=0;step<CHOPPER_SEQUENCE_STEPS;step++){
      const chop=Number(events[step])||0;
      if(chop>=1 && chop<markers.length)placed.push({step,chop});
    }
    if(!placed.length)return null;

    const segments=[];
    for(let i=0;i<placed.length;i++){
      const event=placed[i];
      const startTime=event.step*stepDur;
      const nextTime=i+1<placed.length?placed[i+1].step*stepDur:targetDur;
      const sampleStart=markers[event.chop-1];
      const available=Math.max(0,bank.end-sampleStart);
      const maxAudible=available/pitchRate;
      const endTime=Math.min(targetDur,nextTime,startTime+maxAudible);
      if(endTime>startTime){
        segments.push({pad:event.chop-1,startTime,endTime,sampleStart});
      }
    }
    return {duration:targetDur,pitchRate,segments};
  };

  function copyBankBuffer(sourceBuffer,bank){
    const rate=sourceBuffer.sampleRate;
    const startFrame=clamp(Math.floor(bank.start*rate),0,sourceBuffer.length);
    const endFrame=clamp(Math.ceil(bank.end*rate),startFrame+1,sourceBuffer.length);
    const length=Math.max(1,endFrame-startFrame);
    const audioContext=ctx || (typeof initializeAudioContext==="function"?initializeAudioContext():null);
    if(!audioContext)return sourceBuffer;
    const copy=audioContext.createBuffer(sourceBuffer.numberOfChannels,length,rate);
    for(let channel=0;channel<sourceBuffer.numberOfChannels;channel++){
      copy.getChannelData(channel).set(sourceBuffer.getChannelData(channel).subarray(startFrame,endFrame));
    }
    return copy;
  }

  const renderSequenceBase=renderSequence;
  renderSequence=async function(events,sourceBuffer,cueMarkers,pitchRate){
    if(!isWindowBank() || ChopperWaveSlices.mode==="slices" || sourceBuffer!==sampleBuffer){
      return await renderSequenceBase(events,sourceBuffer,cueMarkers,pitchRate);
    }
    const bank=activeBank();
    const bankBuffer=copyBankBuffer(sourceBuffer,bank);
    if(bankBuffer===sourceBuffer){
      return await renderSequenceBase(events,sourceBuffer,cueMarkers,pitchRate);
    }
    const relativeMarkers=(cueMarkers||[]).map(value=>clamp((Number(value)||0)-bank.start,0,bank.end-bank.start));
    return await renderSequenceBase(events,bankBuffer,relativeMarkers,pitchRate);
  };

  function initializeBanks(){
    if(!sampleBuffer){
      banks=[];
      activeBankIndex=0;
      renderBankTabs();
      return;
    }
    banks=buildBanks(sampleBuffer.duration);
    activeBankIndex=0;
    banks[0].state=captureState();
    renderBankTabs();
  }

  const loadChopperSampleBase=loadChopperSample;
  loadChopperSample=async function(file){
    if(!file)return false;
    saveActiveBank();
    const previousBanks=banks;
    const previousIndex=activeBankIndex;
    const previousBuffer=sampleBuffer;

    // Disable an old sub-bank while the maintained loader initializes the new
    // physical sample. Its normal whole-sample setup must run unchanged.
    banks=[];
    activeBankIndex=0;
    renderBankTabs();

    const loaded=await loadChopperSampleBase(file);
    if(loaded){
      initializeBanks();
      return true;
    }

    if(sampleBuffer===previousBuffer){
      banks=previousBanks;
      activeBankIndex=previousIndex;
      renderBankTabs();
    }
    return false;
  };

  globalThis.ChopperBanks={
    windowSeconds:BANK_WINDOW_SEC,
    overlapSeconds:BANK_OVERLAP_SEC,
    stepSeconds:BANK_STEP_SEC,
    get activeIndex(){return activeBankIndex;},
    get active(){
      const bank=activeBank();
      return bank?{id:bank.id,label:bank.label,start:bank.start,end:bank.end}:null;
    },
    get banks(){
      return banks.map((bank,index)=>({
        id:bank.id,label:bank.label,start:bank.start,end:bank.end,
        active:index===activeBankIndex,
        initialized:!!bank.state
      }));
    },
    selectBank,
    saveCurrent:saveActiveBank
  };

  if(sampleBuffer)initializeBanks();
  else renderBankTabs();
})();
