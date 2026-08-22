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
  let enabled=false;

  function currentMode(){
    return globalThis.ChopperWaveSlices?.mode||"markers";
  }

  function currentBank(){
    return globalThis.ChopperBanks?.active||null;
  }

  // A named 30 s bank remains one physical SP PCM. ALL is special on long
  // sources: use an aligned 30 s page (extended only as far as the current
  // audible request needs) so one pad never encodes a multi-minute file.
  function workingEncodeRange(sourceBuffer,requestedStart=0,requestedEnd=sourceBuffer?.duration||0){
    const bank=currentBank();
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

  async function encodedForPlayback(sourceBuffer,requestedStart,requestedEnd){
    const encodeRange=workingEncodeRange(sourceBuffer,requestedStart,requestedEnd);
    return await DSP.encodeBufferAsync(sourceBuffer,{
      startSec:encodeRange.start,
      endSec:encodeRange.end
    });
  }

  function markerRange(index,sourceBuffer,cueMarkers){
    const start=Math.max(0,Number(cueMarkers?.[index])||0);
    const bank=currentBank();
    const end=bank && bank.id!=="all"
      ? Math.min(sourceBuffer.duration,Number(bank.end)||sourceBuffer.duration)
      : sourceBuffer.duration;
    return {start:Math.min(start,end),end};
  }

  function sliceRange(index){
    const range=globalThis.ChopperWaveSlices?.slices?.[index];
    if(!range)return null;
    return {
      start:Math.max(0,Number(range.start)||0),
      end:Math.max(0,Number(range.end)||0)
    };
  }

  function rangeForPad(index,sourceBuffer,cueMarkers){
    if(currentMode()==="slices")return sliceRange(index);
    return markerRange(index,sourceBuffer,cueMarkers);
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

  async function renderSpSequence(events,sourceBuffer,cueMarkers){
    if(!sourceBuffer)throw new Error("Charge un sample");
    await ensureAudio();
    const bpm=Math.max(40,Number($("sampleBpm")?.value)||90);
    const stepDur=(60/bpm)/2;
    const bars=2;
    const targetDur=8*60/bpm;
    const rate=sessionOutputRate();
    const offline=new OfflineAudioContext(2,Math.ceil(targetDur*rate),rate);
    const master=makePunchMaster(offline);
    const slices=currentMode()==="slices";
    const conditionerGain=.72*sampleVolumeGain()*(slices?1:sampleAutoMixGain(sourceBuffer));
    const sampleConditioner=makeSampleConditioner(offline,master.input,conditionerGain);

    const placed=[];
    for(let step=0;step<16;step++){
      const chop=Number(events?.[step])||0;
      const available=slices
        ? chop>=1 && chop<=globalThis.ChopperWaveSlices.slices.length
        : chop>=1 && chop<(cueMarkers?.length||0);
      if(available)placed.push({step,chop});
    }
    if(!placed.length)throw new Error("Place au moins un PAD sur la grille");

    const tune=DSP.resolveTune(samplePitchSemitones);
    const ratio=tune.ratio;
    const localEncoded=new Map();

    async function encodedForEvent(start,end){
      const encodeRange=workingEncodeRange(sourceBuffer,start,end);
      const key=`${encodeRange.start}:${encodeRange.end}`;
      if(localEncoded.has(key))return localEncoded.get(key);
      const encoded=await DSP.encodeBufferAsync(sourceBuffer,{
        startSec:encodeRange.start,
        endSec:encodeRange.end
      });
      localEncoded.set(key,encoded);
      return encoded;
    }

    for(let e=0;e<placed.length;e++){
      const event=placed[e];
      const startTime=event.step*stepDur;
      const nextTime=e+1<placed.length?placed[e+1].step*stepDur:targetDur;
      const index=event.chop-1;
      const range=rangeForPad(index,sourceBuffer,cueMarkers);
      if(!range || range.end<=range.start)continue;

      const naturalDuration=(range.end-range.start)/ratio;
      const wanted=Math.max(.001,nextTime-startTime);
      const audible=Math.max(.001,Math.min(wanted,naturalDuration,targetDur-startTime));
      const sourceEnd=Math.min(
        range.end,
        range.start+audible*ratio+1/SP_SAMPLE_RATE
      );
      const encoded=await encodedForEvent(range.start,sourceEnd);
      const segment=DSP.renderEncodedSegment(offline,encoded,{
        startSec:range.start,
        endSec:sourceEnd,
        tune,
        maxDuration:audible
      });
      const source=offline.createBufferSource();
      source.buffer=segment;

      if(slices){
        source.connect(sampleConditioner.input);
      }else{
        const edge=offline.createGain();
        const fade=Math.min(typeof CHOP_EDGE_FADE_SECONDS==="number"?CHOP_EDGE_FADE_SECONDS:.0025,audible*.5);
        edge.gain.setValueAtTime(0,startTime);
        edge.gain.linearRampToValueAtTime(1,startTime+fade);
        edge.gain.setValueAtTime(1,Math.max(startTime+fade,startTime+audible-fade));
        edge.gain.linearRampToValueAtTime(0,startTime+audible);
        source.connect(edge).connect(sampleConditioner.input);
      }
      source.start(startTime);
      source.stop(startTime+audible);
    }

    const selection=await ensureDrumSelection();
    renderSelectedDrums(offline,selection,bpm,bars,targetDur,master.input);
    const rendered=finalizeLoopBuffer(await offline.startRendering());
    return await maybeVinyl(rendered);
  }

  async function previewSpSlice(index){
    if(!sampleBuffer || index<0)return;
    const sourceBuffer=sampleBuffer;
    const range=rangeForPad(index,sourceBuffer,markers);
    if(!range || range.end<=range.start)return;

    await ensureAudio();
    stopChopAudition();
    setActivePad(index);

    const tune=DSP.resolveTune(samplePitchSemitones);
    const ratio=tune.ratio;
    const naturalDuration=(range.end-range.start)/ratio;
    const previewDuration=Math.min(naturalDuration,MAX_PAD_PREVIEW_SECONDS);
    const sourceEnd=Math.min(
      range.end,
      range.start+previewDuration*ratio+1/SP_SAMPLE_RATE
    );
    const encoded=await encodedForPlayback(sourceBuffer,range.start,sourceEnd);
    if(!enabled || sampleBuffer!==sourceBuffer)return;

    let buffer=DSP.renderEncodedSegment(ctx,encoded,{
      startSec:range.start,
      endSec:sourceEnd,
      tune,
      maxDuration:previewDuration
    });
    buffer=await maybeVinyl(buffer);
    if(!enabled || sampleBuffer!==sourceBuffer)return;

    const source=ctx.createBufferSource();
    source.buffer=buffer;
    const previewOutput=ctx.createGain();
    connectLive(previewOutput);
    const conditioner=makeSampleConditioner(ctx,previewOutput,sampleVolumeGain());
    source.connect(conditioner.input);

    chopAuditionSource=source;
    chopAuditionGain=conditioner.gain;
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
    return await renderSpSequence(events,sourceBuffer,cueMarkers);
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
      ? "SP ON • 26.04 kHz • 12-bit • pitch sans interpolation"
      : "SP OFF • lecture clean";
  }

  async function setEnabled(value){
    const next=Boolean(value);
    if(next===enabled)return enabled;
    stopChopAudition();
    enabled=next;
    renderedFlip=null;
    const button=document.getElementById("sp1200Toggle");
    syncButton(button);

    const status=$("chopStatus");
    if(status){
      status.textContent=enabled
        ? "SP ON • 26.04 kHz • 12-BIT • RAW"
        : "SP OFF • CLEAN";
    }

    if(isLoopPlaying && lastPreviewMode==="full" && typeof rerenderPreviewMode==="function"){
      try{
        await rerenderPreviewMode("full");
        if(status)status.textContent=enabled
          ? "SP ON • 26.04 kHz • 12-BIT • RAW ✓"
          : "SP OFF • CLEAN ✓";
      }catch(error){
        if(status)status.textContent=`SP ERROR • ${typeof safeErrorMessage==="function"?safeErrorMessage(error):error.message}`;
      }
    }
    return enabled;
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

    const style=document.createElement("style");
    style.dataset.sp1200="1";
    style.textContent=`
      #chopper .sp1200Toggle {
        min-width:34px !important;
        width:auto !important;
        padding-inline:8px !important;
      }
      #chopper .sp1200Toggle[data-active="1"] {
        color:#ffe2a4 !important;
        border-color:#a87535 !important;
        background:linear-gradient(180deg,#5a371d,#24150d) !important;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 0 10px rgba(226,173,95,.22) !important;
      }`;
    document.head.appendChild(style);
  }

  globalThis.ChopperSP1200=Object.freeze({
    get enabled(){return enabled;},
    setEnabled,
    settings(){
      const tune=DSP.resolveTune(samplePitchSemitones);
      return Object.freeze({
        enabled,
        sampleRate:DSP.sampleRate,
        bitDepth:DSP.bitDepth,
        inputLowpassHz:DSP.inputLowpassHz,
        output:"raw",
        reconstructionRate:sessionOutputRate(),
        tuneCode:tune.code,
        tuneModel:tune.model
      });
    }
  });

  installToggle();
})();