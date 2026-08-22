"use strict";

// SP-1200 inspired Chopper playback engine.
// Scope is deliberately narrow: mono input, 26.04 kHz sampling, 12-bit linear
// quantization, nearest-address pitch stepping and zero-order-hold output.
// This is a behavioral approximation, not a bit-perfect hardware clone.
(() => {
  const SP_SAMPLE_RATE=26040;
  const SP_BITS=12;
  const INPUT_LOWPASS_HZ=10500;
  const FILTER_PREROLL_SECONDS=.05;
  const MAX_CACHE_ENTRIES=64;
  const BUTTERWORTH_6_Q=Object.freeze([.5176380902,.7071067812,1.9318516526]);
  const encodedCache=new WeakMap();

  function clampUnit(value){
    const x=Number(value)||0;
    return Math.max(-1,Math.min(1,x));
  }

  function quantize12(value){
    const x=clampUnit(value);
    const code=Math.max(-2048,Math.min(2047,Math.round(x*2048)));
    return code/2048;
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

  function encodeBuffer(sourceBuffer,{startSec=0,endSec=sourceBuffer?.duration||0}={}){
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
    const cacheKey=`${startFrame}:${endFrame}`;
    const cache=cacheFor(sourceBuffer);
    const cached=cache.get(cacheKey);
    if(cached)return cached;

    const plan=channelPlan(sourceBuffer,processStartFrame,endFrame);
    const sections=BUTTERWORTH_6_Q.map(q=>makeLowpass(inputRate,INPUT_LOWPASS_HZ,q));
    const filteredLength=endFrame-processStartFrame;
    const filtered=new Float32Array(filteredLength);

    for(let offset=0;offset<filteredLength;offset++){
      let value=monoSample(sourceBuffer,processStartFrame+offset,plan);
      for(const section of sections)value=filterSample(section,value);
      filtered[offset]=value;
    }

    // The filter gets a short pre-roll for stable state, but the SP sample grid
    // itself is anchored to the requested working portion. Moving a chop START
    // therefore never changes the 26.04 kHz PCM stored for the same bank.
    const requestedSeconds=(endFrame-startFrame)/inputRate;
    const length=Math.max(1,Math.ceil(requestedSeconds*SP_SAMPLE_RATE));
    const data=new Float32Array(length);
    const sourcePerTarget=inputRate/SP_SAMPLE_RATE;
    const requestedOffset=startFrame-processStartFrame;

    for(let i=0;i<length;i++){
      const position=Math.min(filteredLength-1,requestedOffset+i*sourcePerTarget);
      const left=Math.floor(position);
      const right=Math.min(filteredLength-1,left+1);
      const frac=position-left;
      const value=filtered[left]+(filtered[right]-filtered[left])*frac;
      data[i]=quantize12(value);
    }

    const encoded=Object.freeze({
      data,
      sampleRate:SP_SAMPLE_RATE,
      bitDepth:SP_BITS,
      sourceStartSec:startFrame/inputRate,
      sourceEndSec:endFrame/inputRate,
      monoMode:plan.mode,
      monoChannel:plan.mode==="single"?plan.channel:null
    });

    cache.set(cacheKey,encoded);
    while(cache.size>MAX_CACHE_ENTRIES){
      cache.delete(cache.keys().next().value);
    }
    return encoded;
  }

  function renderPcm(encodedData,{
    semitones=0,
    outputRate=44100,
    maxDuration=Infinity,
    startFrame=0,
    endFrame=null
  }={}){
    const data=encodedData?.data instanceof Float32Array ? encodedData.data : encodedData;
    if(!(data instanceof Float32Array) || !data.length){
      return new Float32Array(0);
    }
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
      output[i]=sourceIndex<last?data[sourceIndex]:0;
    }
    return output;
  }

  function renderSegment(audioContext,sourceBuffer,{
    startSec=0,
    endSec=sourceBuffer?.duration||0,
    semitones=0,
    maxDuration=Infinity,
    encodeStartSec=startSec,
    encodeEndSec=endSec
  }={}){
    if(!audioContext?.createBuffer)throw new Error("SP1200: AudioContext unavailable");
    const encoded=encodeBuffer(sourceBuffer,{startSec:encodeStartSec,endSec:encodeEndSec});
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

  function clearCache(sourceBuffer=null){
    if(sourceBuffer)encodedCache.delete(sourceBuffer);
  }

  const DSP=Object.freeze({
    sampleRate:SP_SAMPLE_RATE,
    bitDepth:SP_BITS,
    inputLowpassHz:INPUT_LOWPASS_HZ,
    quantize12,
    pitchRatio,
    encodeBuffer,
    renderPcm,
    renderSegment,
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

  function workingEncodeRange(sourceBuffer){
    const bank=currentBank();
    if(bank && bank.id!=="all"){
      return {
        start:Math.max(0,Math.min(sourceBuffer.duration,Number(bank.start)||0)),
        end:Math.max(0,Math.min(sourceBuffer.duration,Number(bank.end)||sourceBuffer.duration))
      };
    }
    return {start:0,end:sourceBuffer.duration};
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
    const encodeRange=workingEncodeRange(sourceBuffer);
    DSP.encodeBuffer(sourceBuffer,{startSec:encodeRange.start,endSec:encodeRange.end});

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
      const segment=DSP.renderSegment(offline,sourceBuffer,{
        startSec:range.start,
        endSec:range.end,
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
    const range=rangeForPad(index,sampleBuffer,markers);
    if(!range || range.end<=range.start)return;

    await ensureAudio();
    stopChopAudition();

    const encodeRange=workingEncodeRange(sampleBuffer);
    let buffer=DSP.renderSegment(ctx,sampleBuffer,{
      startSec:range.start,
      endSec:range.end,
      semitones:samplePitchSemitones,
      encodeStartSec:encodeRange.start,
      encodeEndSec:encodeRange.end
    });
    buffer=await maybeVinyl(buffer);

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

    setActivePad(index);
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
