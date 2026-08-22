"use strict";

// SP-1200 inspired Chopper playback engine.
// Scope is deliberately narrow: mono input, 26.04 kHz sampling, 12-bit linear
// quantization, nearest-address pitch stepping and zero-order-hold output.
// This is a behavioral approximation, not a bit-perfect hardware clone.
(() => {
  const SP_SAMPLE_RATE=26040;
  const SP_BITS=12;
  const PCM_SCALE=2048;
  const INPUT_LOWPASS_HZ=10500;
  const FILTER_PREROLL_SECONDS=.05;
  const MAX_CACHE_ENTRIES=6;
  const ENCODE_YIELD_INPUT_FRAMES=32768;
  const ALL_ENCODE_PAGE_SECONDS=30;
  const MAX_PAD_PREVIEW_SECONDS=30;
  const BUTTERWORTH_6_Q=Object.freeze([.5176380902,.7071067812,1.9318516526]);
  const encodedCache=new WeakMap();
  const pendingEncodes=new WeakMap();

  function clampUnit(value){
    const x=Number(value)||0;
    return Math.max(-1,Math.min(1,x));
  }

  function quantize12Code(value){
    const x=clampUnit(value);
    return Math.max(-2048,Math.min(2047,Math.round(x*PCM_SCALE)));
  }

  function quantize12(value){
    return quantize12Code(value)/PCM_SCALE;
  }

  function pitchRatio(semitones){
    return Math.pow(2,(Number(semitones)||0)/12);
  }

  function makeLowpass(sampleRate,cutoff,q){
    const rate=Math.max(1,Number(sampleRate)||44100);
    const fc=Math.max(10,Math.min(Number(cutoff)||INPUT_LOWPASS_HZ,rate*.45));
    const w0=2*Math.PI*fc/rate;
    const cos=Math.cos(w0);
    const sin=Math.sin(w0);
    const alpha=sin/(2*Math.max(.0001,Number(q)||.707));
    const a0=1+alpha;
    return {
      b0:((1-cos)/2)/a0,
      b1:(1-cos)/a0,
      b2:((1-cos)/2)/a0,
      a1:(-2*cos)/a0,
      a2:(1-alpha)/a0,
      z1:0,
      z2:0
    };
  }

  function filterSample(section,x){
    const y=section.b0*x+section.z1;
    section.z1=section.b1*x-section.a1*y+section.z2;
    section.z2=section.b2*x-section.a2*y;
    return y;
  }

  function channelPlan(sourceBuffer,startFrame,endFrame){
    const channels=Math.max(1,Number(sourceBuffer?.numberOfChannels)||1);
    if(channels===1)return {mode:"single",channel:0};
    if(channels!==2)return {mode:"average",channels};

    const left=sourceBuffer.getChannelData(0);
    const right=sourceBuffer.getChannelData(1);
    const span=Math.max(1,endFrame-startFrame);
    const stride=Math.max(1,Math.floor(span/100000));
    let ll=0,rr=0,lr=0;
    for(let i=startFrame;i<endFrame;i+=stride){
      const l=Number.isFinite(left[i])?left[i]:0;
      const r=Number.isFinite(right[i])?right[i]:0;
      ll+=l*l;
      rr+=r*r;
      lr+=l*r;
    }
    const corr=lr/Math.max(1e-12,Math.sqrt(ll*rr));
    if(corr<-.35){
      return {mode:"single",channel:rr>ll?1:0};
    }
    return {mode:"average",channels:2};
  }

  function monoSample(sourceBuffer,frame,plan){
    if(plan.mode==="single"){
      const value=sourceBuffer.getChannelData(plan.channel)[frame];
      return Number.isFinite(value)?value:0;
    }
    let sum=0;
    for(let channel=0;channel<plan.channels;channel++){
      const value=sourceBuffer.getChannelData(channel)[frame];
      sum+=Number.isFinite(value)?value:0;
    }
    return sum/plan.channels;
  }

  function cacheFor(sourceBuffer){
    let cache=encodedCache.get(sourceBuffer);
    if(!cache){
      cache=new Map();
      encodedCache.set(sourceBuffer,cache);
    }
    return cache;
  }

  function pendingFor(sourceBuffer){
    let pending=pendingEncodes.get(sourceBuffer);
    if(!pending){
      pending=new Map();
      pendingEncodes.set(sourceBuffer,pending);
    }
    return pending;
  }

  function touchCache(cache,key,value){
    if(cache.has(key))cache.delete(key);
    cache.set(key,value);
    while(cache.size>MAX_CACHE_ENTRIES){
      cache.delete(cache.keys().next().value);
    }
    return value;
  }

  function encodeRequest(sourceBuffer,{startSec=0,endSec=sourceBuffer?.duration||0}={}){
    if(!sourceBuffer || !sourceBuffer.length || !sourceBuffer.sampleRate){
      throw new Error("SP1200: source audio missing");
    }

    const inputRate=sourceBuffer.sampleRate;
    const sourceDuration=sourceBuffer.duration;
    const safeStart=Math.max(0,Math.min(sourceDuration,Number(startSec)||0));
    const safeEnd=Math.max(safeStart,Math.min(sourceDuration,Number(endSec)||sourceDuration));
    const startFrame=Math.max(0,Math.min(sourceBuffer.length-1,Math.floor(safeStart*inputRate)));
    const endFrame=Math.max(startFrame+1,Math.min(sourceBuffer.length,Math.ceil(safeEnd*inputRate)));
    const processStartFrame=Math.max(0,startFrame-Math.ceil(FILTER_PREROLL_SECONDS*inputRate));
    return {
      inputRate,
      startFrame,
      endFrame,
      processStartFrame,
      cacheKey:`${startFrame}:${endFrame}`
    };
  }

  function cachedEncode(sourceBuffer,request){
    const cache=cacheFor(sourceBuffer);
    const cached=cache.get(request.cacheKey);
    return cached?touchCache(cache,request.cacheKey,cached):null;
  }

  // Streaming encoder: it never allocates a full-rate filtered copy of the
  // working window. The filtered input is consumed once and target SP frames
  // are emitted as soon as their interpolation interval is available.
  function* encodeSteps(sourceBuffer,request){
    const {inputRate,startFrame,endFrame,processStartFrame}=request;
    const plan=channelPlan(sourceBuffer,processStartFrame,endFrame);
    const sections=BUTTERWORTH_6_Q.map(q=>makeLowpass(inputRate,INPUT_LOWPASS_HZ,q));
    const filteredLength=endFrame-processStartFrame;
    const requestedSeconds=(endFrame-startFrame)/inputRate;
    const length=Math.max(1,Math.ceil(requestedSeconds*SP_SAMPLE_RATE));
    const data=new Int16Array(length);
    const sourcePerTarget=inputRate/SP_SAMPLE_RATE;
    const requestedOffset=startFrame-processStartFrame;
    let outputIndex=0;
    let targetPosition=requestedOffset;
    let previous=0;

    for(let offset=0;offset<filteredLength;offset++){
      let current=monoSample(sourceBuffer,processStartFrame+offset,plan);
      for(const section of sections)current=filterSample(section,current);

      if(offset===0){
        previous=current;
        while(outputIndex<length && targetPosition<=0){
          data[outputIndex++]=quantize12Code(current);
          targetPosition=requestedOffset+outputIndex*sourcePerTarget;
        }
      }else{
        while(outputIndex<length && targetPosition<=offset){
          const fraction=Math.max(0,Math.min(1,targetPosition-(offset-1)));
          const value=previous+(current-previous)*fraction;
          data[outputIndex++]=quantize12Code(value);
          targetPosition=requestedOffset+outputIndex*sourcePerTarget;
        }
        previous=current;
      }

      if(offset>0 && offset%ENCODE_YIELD_INPUT_FRAMES===0)yield;
    }

    while(outputIndex<length)data[outputIndex++]=quantize12Code(previous);

    return Object.freeze({
      data,
      sampleRate:SP_SAMPLE_RATE,
      bitDepth:SP_BITS,
      sourceStartSec:startFrame/inputRate,
      sourceEndSec:endFrame/inputRate,
      monoMode:plan.mode,
      monoChannel:plan.mode==="single"?plan.channel:null
    });
  }

  function runEncodeSync(iterator){
    let step=iterator.next();
    while(!step.done)step=iterator.next();
    return step.value;
  }

  function yieldMainThread(){
    if(globalThis.scheduler && typeof globalThis.scheduler.yield==="function"){
      return globalThis.scheduler.yield();
    }
    return new Promise(resolve=>setTimeout(resolve,0));
  }

  async function runEncodeAsync(iterator){
    let step=iterator.next();
    while(!step.done){
      await yieldMainThread();
      step=iterator.next();
    }
    return step.value;
  }

  function encodeBuffer(sourceBuffer,options={}){
    const request=encodeRequest(sourceBuffer,options);
    const cached=cachedEncode(sourceBuffer,request);
    if(cached)return cached;
    const encoded=runEncodeSync(encodeSteps(sourceBuffer,request));
    return touchCache(cacheFor(sourceBuffer),request.cacheKey,encoded);
  }

  async function encodeBufferAsync(sourceBuffer,options={}){
    const request=encodeRequest(sourceBuffer,options);
    const cached=cachedEncode(sourceBuffer,request);
    if(cached)return cached;

    const pending=pendingFor(sourceBuffer);
    if(pending.has(request.cacheKey))return await pending.get(request.cacheKey);

    const task=(async()=>{
      try{
        const encoded=await runEncodeAsync(encodeSteps(sourceBuffer,request));
        return touchCache(cacheFor(sourceBuffer),request.cacheKey,encoded);
      }finally{
        pending.delete(request.cacheKey);
      }
    })();
    pending.set(request.cacheKey,task);
    return await task;
  }

  function pcmData(encodedData){
    const data=(encodedData?.data instanceof Int16Array || encodedData?.data instanceof Float32Array)
      ? encodedData.data
      : encodedData;
    return data instanceof Int16Array || data instanceof Float32Array ? data : null;
  }

  function pcmValue(data,index){
    return data instanceof Int16Array ? data[index]/PCM_SCALE : data[index];
  }

  function renderPcm(encodedData,{
    semitones=0,
    outputRate=44100,
    maxDuration=Infinity,
    startFrame=0,
    endFrame=null
  }={}){
    const data=pcmData(encodedData);
    if(!data || !data.length)return new Float32Array(0);
    const first=Math.max(0,Math.min(data.length-1,Math.floor(Number(startFrame)||0)));
    const last=Math.max(first+1,Math.min(data.length,Math.ceil(Number(endFrame) || data.length)));
    const ratio=pitchRatio(semitones);
    const rate=Math.max(8000,Number(outputRate)||44100);
    const naturalDuration=(last-first)/SP_SAMPLE_RATE/ratio;
    const limit=Number.isFinite(maxDuration)?Math.max(0,Number(maxDuration)||0):naturalDuration;
    const duration=Math.min(naturalDuration,limit);
    const length=Math.max(1,Math.ceil(duration*rate));
    const output=new Float32Array(length);

    for(let i=0;i<length;i++){
      const spTick=Math.floor(i*SP_SAMPLE_RATE/rate);
      const sourceIndex=first+Math.floor(spTick*ratio);
      output[i]=sourceIndex<last?pcmValue(data,sourceIndex):0;
    }
    return output;
  }

  function renderEncodedSegment(audioContext,encoded,{
    startSec=encoded?.sourceStartSec||0,
    endSec=encoded?.sourceEndSec||0,
    semitones=0,
    maxDuration=Infinity
  }={}){
    if(!audioContext?.createBuffer)throw new Error("SP1200: AudioContext unavailable");
    const relativeStart=Math.max(0,(Number(startSec)||0)-encoded.sourceStartSec);
    const relativeEnd=Math.max(relativeStart,(Number(endSec)||0)-encoded.sourceStartSec);
    const first=Math.max(0,Math.min(encoded.data.length-1,Math.floor(relativeStart*SP_SAMPLE_RATE)));
    const last=Math.max(first+1,Math.min(encoded.data.length,Math.ceil(relativeEnd*SP_SAMPLE_RATE)));
    const output=renderPcm(encoded,{
      semitones,
      outputRate:audioContext.sampleRate,
      maxDuration,
      startFrame:first,
      endFrame:last
    });
    const buffer=audioContext.createBuffer(1,Math.max(1,output.length),audioContext.sampleRate);
    buffer.getChannelData(0).set(output);
    return buffer;
  }

  function renderSegment(audioContext,sourceBuffer,{
    startSec=0,
    endSec=sourceBuffer?.duration||0,
    semitones=0,
    maxDuration=Infinity,
    encodeStartSec=startSec,
    encodeEndSec=endSec
  }={}){
    const encoded=encodeBuffer(sourceBuffer,{startSec:encodeStartSec,endSec:encodeEndSec});
    return renderEncodedSegment(audioContext,encoded,{startSec,endSec,semitones,maxDuration});
  }

  async function renderSegmentAsync(audioContext,sourceBuffer,{
    startSec=0,
    endSec=sourceBuffer?.duration||0,
    semitones=0,
    maxDuration=Infinity,
    encodeStartSec=startSec,
    encodeEndSec=endSec
  }={}){
    const encoded=await encodeBufferAsync(sourceBuffer,{startSec:encodeStartSec,endSec:encodeEndSec});
    return renderEncodedSegment(audioContext,encoded,{startSec,endSec,semitones,maxDuration});
  }

  function clearCache(sourceBuffer=null){
    if(sourceBuffer){
      encodedCache.delete(sourceBuffer);
      pendingEncodes.delete(sourceBuffer);
    }
  }

  const DSP=Object.freeze({
    sampleRate:SP_SAMPLE_RATE,
    bitDepth:SP_BITS,
    inputLowpassHz:INPUT_LOWPASS_HZ,
    maxCacheEntries:MAX_CACHE_ENTRIES,
    pcmStorage:"int16",
    quantize12,
    pitchRatio,
    encodeBuffer,
    encodeBufferAsync,
    renderPcm,
    renderSegment,
    renderSegmentAsync,
    clearCache
  });
  globalThis.SP1200DSP=DSP;

  // Node/unit-test loading stops here. Browser integration is intentionally
  // kept in this same feature file so the classic runtime needs only one new
  // script for the complete SP responsibility.
  if(typeof document==="undefined")return;
  const root=document.getElementById("chopper");
  if(!root || root.dataset.sp1200Installed==="1")return;
  root.dataset.sp1200Installed="1";

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

  async function renderSpSequence(events,sourceBuffer,cueMarkers){
    if(!sourceBuffer)throw new Error("Charge un sample");
    const bpm=Math.max(40,Number($("sampleBpm")?.value)||90);
    const stepDur=(60/bpm)/2;
    const bars=2;
    const targetDur=8*60/bpm;
    const rate=44100;
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

    const semitones=Number(samplePitchSemitones)||0;
    const ratio=DSP.pitchRatio(semitones);

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
      const encodeRange=workingEncodeRange(sourceBuffer,range.start,sourceEnd);
      const segment=await DSP.renderSegmentAsync(offline,sourceBuffer,{
        startSec:range.start,
        endSec:sourceEnd,
        semitones,
        maxDuration:audible,
        encodeStartSec:encodeRange.start,
        encodeEndSec:encodeRange.end
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

  async function previewSpSlice(index,button){
    if(!sampleBuffer || index<0)return;
    const sourceBuffer=sampleBuffer;
    const range=rangeForPad(index,sourceBuffer,markers);
    if(!range || range.end<=range.start)return;

    await ensureAudio();
    stopChopAudition();
    setActivePad(index);

    const ratio=DSP.pitchRatio(samplePitchSemitones);
    const naturalDuration=(range.end-range.start)/ratio;
    const previewDuration=Math.min(naturalDuration,MAX_PAD_PREVIEW_SECONDS);
    const sourceEnd=Math.min(
      range.end,
      range.start+previewDuration*ratio+1/SP_SAMPLE_RATE
    );
    const encodeRange=workingEncodeRange(sourceBuffer,range.start,sourceEnd);
    let buffer=await DSP.renderSegmentAsync(ctx,sourceBuffer,{
      startSec:range.start,
      endSec:sourceEnd,
      semitones:samplePitchSemitones,
      maxDuration:previewDuration,
      encodeStartSec:encodeRange.start,
      encodeEndSec:encodeRange.end
    });
    if(!enabled || sampleBuffer!==sourceBuffer)return;
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
    return await previewSpSlice(index,button);
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
      return Object.freeze({
        enabled,
        sampleRate:SP_SAMPLE_RATE,
        bitDepth:SP_BITS,
        inputLowpassHz:INPUT_LOWPASS_HZ,
        output:"raw"
      });
    }
  });

  installToggle();
})();