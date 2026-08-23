"use strict";

// Chopper-owned adapter for the optional SP-1200 DSP engine.
// It translates Chopper state (banks, slices, pitch, pads and render flow) into
// explicit SP PCM encode/playback calls. The DSP itself knows nothing about DOM
// or Chopper feature state.
(() => {
  const DSP=globalThis.SP1200DSP;
  const root=document.getElementById("chopper");
  if(!DSP || !root || root.dataset.sp1200Installed==="1")return;
  root.dataset.sp1200Installed="1";

  const SP_SAMPLE_RATE=DSP.sampleRate;
  const ALL_ENCODE_PAGE_SECONDS=30;
  const MAX_PAD_PREVIEW_SECONDS=30;
  const MAX_PREVIEW_RENDER_CACHE_ENTRIES=3;
  let enabled=false;
  let outputMode="raw";
  let previewGeneration=0;
  const previewRenderedCache=new WeakMap();

  function currentMode(){
    return globalThis.ChopperWaveSlices?.mode||"markers";
  }

  function currentBank(){
    return globalThis.ChopperBanks?.active||null;
  }

  function outputLabel(){
    if(outputMode==="filter")return "FILTER 3/4";
    if(outputMode==="filter56")return "FILTER 5/6";
    return "RAW";
  }

  function invalidatePendingPreview(){
    previewGeneration++;
    return previewGeneration;
  }

  // Any normal Chopper stop/change must also invalidate an SP encode that has
  // not created its AudioBufferSource yet. The base stop remains the one owner
  // of the actual audition source/playhead cleanup.
  const stopChopAuditionBase=stopChopAudition;
  stopChopAudition=function(...args){
    invalidatePendingPreview();
    return stopChopAuditionBase(...args);
  };

  function tuneForPitchRate(pitchRate){
    const ratio=Math.max(.000001,Number(pitchRate)||1);
    return DSP.resolveTune(Math.round(12*Math.log2(ratio)));
  }

  // A named 30 s bank remains one physical SP PCM. ALL is special on long
  // sources: use an aligned 30 s page (extended only as far as the current
  // audible request needs) so one pad never encodes a multi-minute file.
  function workingEncodeRange(sourceBuffer,requestedStart=0,requestedEnd=sourceBuffer?.duration||0,bank=null){
    if(bank && bank.id!=="all"){
      return {
        start:Math.max(0,Math.min(sourceBuffer.duration,Number(bank.start)||0)),
        end:Math.max(0,Math.min(sourceBuffer.duration,Number(bank.end)||sourceBuffer.duration))
      };
    }
    if(sourceBuffer.duration<=ALL_ENCODE_PAGE_SECONDS){
      return {start:0,end:sourceBuffer.duration};
    }

    const start=Math.max(0,Math.min(sourceBuffer.duration,Number(requestedStart)||0));
    const end=Math.max(start,Math.min(sourceBuffer.duration,Number(requestedEnd)||start));
    const pageStart=Math.floor(start/ALL_ENCODE_PAGE_SECONDS)*ALL_ENCODE_PAGE_SECONDS;
    const pageEnd=Math.min(
      sourceBuffer.duration,
      Math.max(pageStart+ALL_ENCODE_PAGE_SECONDS,end)
    );
    return {start:pageStart,end:pageEnd};
  }

  function markerRange(index,sourceBuffer,cueMarkers,bank=currentBank()){
    const start=Math.max(0,Number(cueMarkers?.[index])||0);
    const end=bank && bank.id!=="all"
      ? Math.min(sourceBuffer.duration,Number(bank.end)||sourceBuffer.duration)
      : sourceBuffer.duration;
    return {start:Math.min(start,end),end};
  }

  function sliceRange(index,slices=globalThis.ChopperWaveSlices?.slices||[]){
    const range=slices?.[index];
    if(!range)return null;
    return {
      start:Math.max(0,Number(range.start)||0),
      end:Math.max(0,Number(range.end)||0)
    };
  }

  function rangeForPad(index,sourceBuffer,cueMarkers,mode=currentMode(),bank=currentBank(),slices=globalThis.ChopperWaveSlices?.slices||[]){
    if(mode==="slices")return sliceRange(index,slices);
    return markerRange(index,sourceBuffer,cueMarkers,bank);
  }

  async function maybeVinyl(buffer){
    if(globalThis.ChopperVinyl?.processRenderedBuffer){
      return await globalThis.ChopperVinyl.processRenderedBuffer(buffer);
    }
    return buffer;
  }

  // SP reconstruction must use one output grid per live session. PAD audition
  // already renders against ctx; offline PLAY/SAVE must use that same rate so
  // zero-order hold does not change character between audition and export.
  function sessionOutputRate(){
    const rate=Number(ctx?.sampleRate);
    return Number.isFinite(rate) && rate>=8000 ? rate : 44100;
  }

  // Chopper's existing 0..100% SAMPLE VOL becomes the SP sound-level register.
  // Map the desired linear gain to the nearest AD7524 code/256 transfer value.
  // Full-scale 100% therefore lands at code 255 (255/256), as on the ideal MDAC.
  function levelCodeForSampleVolume(){
    const max=Math.max(0,Number(DSP.levelDac?.maxCode)||255);
    const denominator=Math.max(1,Number(DSP.levelDac?.denominator)||256);
    const code=Math.round(sampleVolumeGain()*denominator);
    return Math.max(0,Math.min(max,code));
  }

  // One operation owns the complete SP chop transition shared by PAD and
  // PLAY/SAVE: source range -> audible duration -> encoded PCM page -> playback
  // reconstruction. Product routing (edge fade, PUNCH/master, VINYL/finalize)
  // stays outside this boundary.
  async function renderSpChop(audioContext,{
    sourceBuffer,
    range,
    tune,
    levelCode,
    outputMode:outputProfile,
    durationLimit,
    bank=null,
    encodedCache=null,
    renderedCache=null,
    shouldContinue=null
  }){
    if(!sourceBuffer || !range || range.end<=range.start){
      throw new Error("SP1200: invalid chop render range");
    }

    const naturalDuration=(range.end-range.start)/tune.ratio;
    const limit=Number.isFinite(durationLimit)
      ? Math.max(.001,Number(durationLimit)||0)
      : naturalDuration;
    const audible=Math.max(.001,Math.min(naturalDuration,limit));
    const sourceEnd=Math.min(
      range.end,
      range.start+audible*tune.ratio+1/SP_SAMPLE_RATE
    );
    const encodeRange=workingEncodeRange(sourceBuffer,range.start,sourceEnd,bank);
    const cacheKey=`${encodeRange.start}:${encodeRange.end}`;
    let encoded=encodedCache?.get(cacheKey)||null;
    if(!encoded){
      encoded=await DSP.encodeBufferAsync(sourceBuffer,{
        startSec:encodeRange.start,
        endSec:encodeRange.end
      });
      encodedCache?.set(cacheKey,encoded);
    }

    // PAD requests can become stale while an encode is pending. Preserve the
    // previous early-cancellation behavior so a stale 30 s request never spends
    // time reconstructing a buffer that cannot be played.
    if(typeof shouldContinue==="function" && !shouldContinue())return null;

    const renderKey=`${range.start}:${sourceEnd}:t${tune.code}:l${levelCode}:o${outputProfile}:r${audioContext.sampleRate}:d${audible}`;
    let cachedRenders=renderedCache?.get(encoded)||null;
    let buffer=cachedRenders?.get(renderKey)||null;
    if(buffer && cachedRenders){
      cachedRenders.delete(renderKey);
      cachedRenders.set(renderKey,buffer);
    }else{
      buffer=DSP.renderEncodedSegment(audioContext,encoded,{
        startSec:range.start,
        endSec:sourceEnd,
        tune,
        levelCode,
        outputMode:outputProfile,
        maxDuration:audible
      });
      if(renderedCache){
        if(!cachedRenders){
          cachedRenders=new Map();
          renderedCache.set(encoded,cachedRenders);
        }
        cachedRenders.set(renderKey,buffer);
        while(cachedRenders.size>MAX_PREVIEW_RENDER_CACHE_ENTRIES){
          cachedRenders.delete(cachedRenders.keys().next().value);
        }
      }
    }
    return {buffer,audible,sourceEnd};
  }

  async function renderSpSequence(events,sourceBuffer,cueMarkers,pitchRate){
    if(!sourceBuffer)throw new Error("Charge un sample");

    // Freeze every Chopper-owned input before any asynchronous work. A bank,
    // mode, marker, volume or output change belongs to the next render only.
    const renderMode=currentMode();
    const activeBank=currentBank();
    const renderBank=activeBank?Object.freeze({...activeBank}):null;
    const renderEvents=Object.freeze(Array.from(events||[],value=>Number(value)||0));
    const renderCueMarkers=Object.freeze(Array.isArray(cueMarkers)
      ? cueMarkers.map(value=>Number(value)||0)
      : []);
    const renderSlices=Object.freeze(renderMode==="slices"
      ? (globalThis.ChopperWaveSlices?.slices||[]).map(range=>Object.freeze({
          start:Math.max(0,Number(range?.start)||0),
          end:Math.max(0,Number(range?.end)||0)
        }))
      : []);
    const renderOutputMode=outputMode;
    const renderLevelCode=levelCodeForSampleVolume();
    const slices=renderMode==="slices";
    const plan=buildSequencePlan(
      renderEvents,
      $("sampleBpm")?.value,
      slices?renderSlices.length:Math.max(0,renderCueMarkers.length-1)
    );

    await ensureAudio();

    const rate=sessionOutputRate();
    const offline=new OfflineAudioContext(2,Math.ceil(plan.targetDur*rate),rate);
    const master=makePunchMaster(offline);
    if(!plan.placed.length)throw new Error("Place au moins un PAD sur la grille");

    const tune=tuneForPitchRate(pitchRate);
    const localEncoded=new Map();

    for(const event of plan.placed){
      const index=event.chop-1;
      const range=rangeForPad(index,sourceBuffer,renderCueMarkers,renderMode,renderBank,renderSlices);
      if(!range || range.end<=range.start)continue;
      const durationLimit=Math.max(.001,Math.min(event.nextTime-event.startTime,plan.targetDur-event.startTime));
      const renderedChop=await renderSpChop(offline,{
        sourceBuffer,
        range,
        tune,
        levelCode:renderLevelCode,
        outputMode:renderOutputMode,
        durationLimit,
        bank:renderBank,
        encodedCache:localEncoded
      });
      const audible=renderedChop.audible;
      const source=offline.createBufferSource();
      source.buffer=renderedChop.buffer;

      if(slices){
        source.connect(master.input);
      }else{
        const edge=offline.createGain();
        const fade=Math.min(typeof CHOP_EDGE_FADE_SECONDS==="number"?CHOP_EDGE_FADE_SECONDS:.0025,audible*.5);
        edge.gain.setValueAtTime(0,event.startTime);
        edge.gain.linearRampToValueAtTime(1,event.startTime+fade);
        edge.gain.setValueAtTime(1,Math.max(event.startTime+fade,event.startTime+audible-fade));
        edge.gain.linearRampToValueAtTime(0,event.startTime+audible);
        source.connect(edge).connect(master.input);
      }
      source.start(event.startTime);
      source.stop(event.startTime+audible);
    }

    const selection=await ensureDrumSelection();
    renderSelectedDrums(offline,selection,plan.bpm,plan.bars,plan.targetDur,master.input);
    const rendered=finalizeLoopBuffer(await offline.startRendering());
    return await maybeVinyl(rendered);
  }

  async function previewSpSlice(index){
    if(!sampleBuffer || index<0)return;
    const generation=++previewGeneration;
    const sourceBuffer=sampleBuffer;
    const requestOutputMode=outputMode;
    const requestLevelCode=levelCodeForSampleVolume();
    const activeBank=currentBank();
    const requestBank=activeBank?Object.freeze({...activeBank}):null;
    const requestMode=currentMode();
    const requestSlices=requestMode==="slices" ? globalThis.ChopperWaveSlices?.slices||[] : [];
    const range=rangeForPad(index,sourceBuffer,markers,requestMode,requestBank,requestSlices);
    if(!range || range.end<=range.start)return;
    const requestTune=DSP.resolveTune(samplePitchSemitones);

    // Stop the currently audible pad without invalidating this newly-created
    // request generation. External stop/change calls go through the wrapper.
    stopChopAuditionBase();
    await ensureAudio();
    if(generation!==previewGeneration || !enabled || sampleBuffer!==sourceBuffer)return;
    setActivePad(index);

    const renderedChop=await renderSpChop(ctx,{
      sourceBuffer,
      range,
      tune:requestTune,
      levelCode:requestLevelCode,
      outputMode:requestOutputMode,
      durationLimit:MAX_PAD_PREVIEW_SECONDS,
      bank:requestBank,
      renderedCache:previewRenderedCache,
      shouldContinue:()=>generation===previewGeneration && enabled && sampleBuffer===sourceBuffer
    });
    if(!renderedChop)return;

    let buffer=await maybeVinyl(renderedChop.buffer);
    if(generation!==previewGeneration || !enabled || sampleBuffer!==sourceBuffer)return;

    const source=ctx.createBufferSource();
    source.buffer=buffer;
    const previewOutput=ctx.createGain();
    connectLive(previewOutput);
    // SP SAMPLE VOL has already been rendered through the 8-bit level DAC, and
    // the DSP output profile is final. Connect it directly so RAW stays RAW.
    source.connect(previewOutput);

    chopAuditionSource=source;
    // Do not expose the clean-path continuous volume GainNode while SP is active;
    // changing SAMPLE VOL takes effect on the next hardware-style pad trigger.
    chopAuditionGain=null;
    chopAuditionPad=index;
    chopAuditionOffset=range.start;
    chopAuditionStartedAt=ctx.currentTime;

    source.onended=()=>{
      if(chopAuditionSource===source){
        chopAuditionSource=null;
        chopAuditionPad=-1;
        chopAuditionGain=null;
        if(isLoopPlaying && lastPreviewMode==="full" && loopPlayheadState){
          startPlayheadAnimation();
        }else{
          stopPlayheadAnimation(true);
        }
      }
    };

    source.start();
    startPlayheadAnimation();
  }

  const renderSequenceBase=renderSequence;
  renderSequence=async function(events,sourceBuffer,cueMarkers,pitchRate){
    if(!enabled)return await renderSequenceBase(events,sourceBuffer,cueMarkers,pitchRate);
    return await renderSpSequence(events,sourceBuffer,cueMarkers,pitchRate);
  };

  const previewSliceBase=previewSlice;
  previewSlice=async function(index,button){
    if(!enabled)return await previewSliceBase(index,button);
    return await previewSpSlice(index);
  };

  function syncButton(button){
    if(!button)return;
    button.dataset.active=enabled?"1":"0";
    button.setAttribute("aria-pressed",enabled?"true":"false");
    button.title=enabled
      ? `SP ON • 26.04 kHz • 12-bit • ${outputLabel()}`
      : "SP OFF • lecture clean";
  }

  function syncFilterButton(button){
    if(!button)return;
    const filtered=outputMode!=="raw";
    button.hidden=!enabled;
    button.dataset.active=filtered?"1":"0";
    button.setAttribute("aria-pressed",filtered?"true":"false");
    button.textContent=outputMode==="filter"?"3/4":outputMode==="filter56"?"5/6":"FLT";
    button.title=outputMode==="filter"
      ? "SP FILTER 3/4 • sortie fixe dérivée plus sombre"
      : outputMode==="filter56"
        ? "SP FILTER 5/6 • sortie fixe dérivée plus ouverte"
        : "SP RAW • sortie non filtrée";
  }

  async function setEnabled(value){
    const next=Boolean(value);
    if(next===enabled)return enabled;
    stopChopAudition();
    // A pending full render belongs to the old SP/CLEAN mode even if playback
    // has not started yet. Route it through the renderer-owned invalidation.
    invalidatePreviewRender();
    enabled=next;
    const button=document.getElementById("sp1200Toggle");
    const filterButton=document.getElementById("sp1200FilterToggle");
    syncButton(button);
    syncFilterButton(filterButton);

    const status=$("chopStatus");
    if(status){
      status.textContent=enabled
        ? `SP ON • 26.04 kHz • 12-BIT • ${outputLabel()}`
        : "SP OFF • CLEAN";
    }

    if(isLoopPlaying && lastPreviewMode==="full" && typeof rerenderPreviewMode==="function"){
      try{
        await rerenderPreviewMode("full");
        if(status)status.textContent=enabled
          ? `SP ON • 26.04 kHz • 12-BIT • ${outputLabel()} ✓`
          : "SP OFF • CLEAN ✓";
      }catch(error){
        if(status)status.textContent=`SP ERROR • ${typeof safeErrorMessage==="function"?safeErrorMessage(error):error.message}`;
      }
    }
    return enabled;
  }

  async function setOutputMode(value){
    const next=String(value||"raw").toLowerCase();
    if(!DSP.outputModes?.includes(next))throw new Error("SP output mode invalide");
    if(next===outputMode)return outputMode;
    stopChopAudition();
    invalidatePreviewRender();
    outputMode=next;
    syncButton(document.getElementById("sp1200Toggle"));
    syncFilterButton(document.getElementById("sp1200FilterToggle"));

    const status=$("chopStatus");
    if(status && enabled)status.textContent=`SP ON • 26.04 kHz • 12-BIT • ${outputLabel()}`;

    if(enabled && isLoopPlaying && lastPreviewMode==="full" && typeof rerenderPreviewMode==="function"){
      try{
        await rerenderPreviewMode("full");
        if(status)status.textContent=`SP ON • 26.04 kHz • 12-BIT • ${outputLabel()} ✓`;
      }catch(error){
        if(status)status.textContent=`SP ERROR • ${typeof safeErrorMessage==="function"?safeErrorMessage(error):error.message}`;
      }
    }
    return outputMode;
  }

  function installToggle(){
    if(document.getElementById("sp1200Toggle"))return;
    const host=root.querySelector(".waveHeaderActions") || root.querySelector(".samplerScreenModule > .stableTitle");
    if(!host)return;

    const button=document.createElement("button");
    button.id="sp1200Toggle";
    button.type="button";
    button.className="btn sp1200Toggle";
    button.textContent="SP";
    button.setAttribute("aria-label","Activer le moteur sample SP 12-bit 26.04 kHz");
    button.addEventListener("click",()=>{void setEnabled(!enabled);});
    syncButton(button);
    host.appendChild(button);

    const filterButton=document.createElement("button");
    filterButton.id="sp1200FilterToggle";
    filterButton.type="button";
    filterButton.className="btn sp1200FilterToggle";
    filterButton.setAttribute("aria-label","Cycler les sorties SP RAW, filtre 3-4 et filtre 5-6");
    filterButton.addEventListener("click",()=>{
      const index=DSP.outputModes.indexOf(outputMode);
      void setOutputMode(DSP.outputModes[(index+1)%DSP.outputModes.length]);
    });
    syncFilterButton(filterButton);
    host.appendChild(filterButton);

    const style=document.createElement("style");
    style.dataset.sp1200="1";
    style.textContent=`
      #chopper .sp1200Toggle,
      #chopper .sp1200FilterToggle {
        min-width:34px !important;
        width:auto !important;
        padding-inline:8px !important;
      }
      #chopper .sp1200FilterToggle[hidden] {
        display:none !important;
      }
      #chopper .sp1200Toggle[data-active="1"],
      #chopper .sp1200FilterToggle[data-active="1"] {
        color:#ffe2a4 !important;
        border-color:#a87535 !important;
        background:linear-gradient(180deg,#5a371d,#24150d) !important;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 0 10px rgba(226,173,95,.22) !important;
      }`;
    document.head.appendChild(style);
  }

  function installCompactLayout(){
    // Keep PLAY / DRUMS / STOP with the performance surface, but below the pads
    // so the pad grid reads first and transport reads second.
    const pads=document.getElementById("pads");
    const transport=root.querySelector(".padTransport");
    if(pads && transport) pads.insertAdjacentElement("afterend",transport);

    // Long-sample bank tabs belong in the waveform action row next to SP, not in
    // a dedicated row below the waveform.
    const waveActions=root.querySelector(".waveHeaderActions");
    const bankTabs=document.getElementById("chopperBankTabs");
    const spButton=document.getElementById("sp1200Toggle");
    if(waveActions && bankTabs) waveActions.insertBefore(bankTabs,spButton||null);

    // Status nodes are still kept in the DOM because existing handlers write to
    // them, but the Chopper surface no longer prints transient prose below WAVE.
    const statusStrip=root.querySelector(".chopperStatusStrip");
    for(const id of ["chopStatus","beatSaveStatus"]){
      const node=document.getElementById(id);
      if(!node)continue;
      node.classList.add("compatHidden");
      node.removeAttribute("aria-live");
      root.appendChild(node);
    }
    statusStrip?.remove();

    const style=document.createElement("style");
    style.dataset.chopperCompactLayout="1";
    style.textContent=`
      #chopper .samplerScreenModule {
        grid-template-areas:
          "fine fine fine fine fine fine"
          "title pitch tempo volume punch vinyl"
          "wave wave wave wave wave wave" !important;
      }
      #chopper .chopperStatusStrip,
      #chopper .samplerSampleInfo {
        display:none !important;
      }
      #chopper .samplerPadsModule > .padTransport {
        margin:10px 0 0 auto !important;
      }
      #chopper .waveHeaderActions {
        flex-wrap:wrap;
      }
      #chopper .waveHeaderActions > .chopperBankTabs {
        grid-area:auto !important;
        flex:0 1 auto;
        max-width:100%;
        margin:0 !important;
        padding:0 !important;
        gap:4px;
      }
      #chopper .waveHeaderActions > .chopperBankTabs[hidden] {
        display:none !important;
      }
      @media (max-width:760px) {
        #chopper .samplerPadsModule > .padTransport {
          margin-top:8px !important;
        }
      }`;
    document.head.appendChild(style);
  }

  globalThis.ChopperSP1200=Object.freeze({
    get enabled(){return enabled;},
    get outputMode(){return outputMode;},
    setEnabled,
    setOutputMode,
    settings(){
      const tune=DSP.resolveTune(samplePitchSemitones);
      const levelCode=levelCodeForSampleVolume();
      const level=DSP.resolveLevelCode(levelCode);
      return Object.freeze({
        enabled,
        sampleRate:DSP.sampleRate,
        bitDepth:DSP.bitDepth,
        inputLowpassHz:DSP.inputLowpassHz,
        levelCode,
        levelGain:level.gain,
        levelDac:DSP.levelDac,
        output:outputMode,
        outputFilter:outputMode==="filter56"?DSP.outputFilter56:outputMode==="filter"?DSP.outputFilter:null,
        reconstructionRate:sessionOutputRate(),
        tuneCode:tune.code,
        tuneModel:tune.model
      });
    }
  });

  installToggle();
  installCompactLayout();
})();