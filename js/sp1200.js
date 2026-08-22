"use strict";

// SP-1200 inspired DSP engine.
// Scope is deliberately narrow: mono input, 26.04 kHz sampling, 12-bit linear
// quantization, 7-bit carry address stepping and zero-order-hold output.
// This is a behavioral approximation, not a bit-perfect hardware clone.
(() => {
  const SP_SAMPLE_RATE=26040;
  const SP_BITS=12;
  const PCM_SCALE=2048;
  const INPUT_LOWPASS_HZ=10500;
  const FILTER_PREROLL_SECONDS=.05;
  const MAX_CACHE_ENTRIES=6;
  const ENCODE_YIELD_INPUT_FRAMES=32768;
  const SP_TUNE_MIN_CODE=0;
  const SP_TUNE_MAX_CODE=31;
  const SP_TUNE_CENTER_CODE=16;
  const SP_TUNE_MIN_SEMITONES=-16;
  const SP_TUNE_MAX_SEMITONES=15;
  const SP_TUNE_DEFAULT_MIN_SEMITONES=-8;
  const SP_TUNE_DEFAULT_MAX_SEMITONES=7;
  const SP_TUNE_CARRY_MAX=127;
  const SP_TUNE_MODEL="carry7-octave-derived-v1";
  const SP_ADDRESSING_MODEL="carry7-pattern-v1";
  const SP_MONO_LEVEL_MODEL="bounded-energy-v1";
  const SP_STEREO_DOWNMIX_MAX_GAIN=Math.SQRT2;

  // SP-1200 exposes 32 total tune/decay positions (0..31), with INIT DK/TUNE
  // 16 as original pitch and only a 16-position window accessible at once.
  // The central -8..+7 window below uses the nearest 7-bit carry populations
  // to publicly measured SP-12 negative tuning ratios, mirrored for the skip
  // side. Outer SP-1200 codes are the same carry grid folded by one octave.
  // This is hardware-derived, but not claimed as a dumped bit-perfect PROM table.
  const SP_BASE_TUNE_CARRY_COUNTS=Object.freeze([
    73,64,51,42,32,23,15,7,
    0,
    7,15,23,32,42,51,64
  ]);

  function baseTune(nominalSemitones){
    const index=nominalSemitones-SP_TUNE_DEFAULT_MIN_SEMITONES;
    const carry=SP_BASE_TUNE_CARRY_COUNTS[index];
    const carryDirection=nominalSemitones<0?"repeat":nominalSemitones>0?"skip":"normal";
    const ratio=carryDirection==="repeat"
      ? 1/(1+carry/SP_TUNE_CARRY_MAX)
      : carryDirection==="skip"
        ? 1+carry/SP_TUNE_CARRY_MAX
        : 1;
    return {carry,carryDirection,ratio};
  }

  const SP_TUNE_TABLE=Object.freeze(Array.from({length:32},(_,code)=>{
    const nominalSemitones=code-SP_TUNE_CENTER_CODE;
    let foldedSemitones=nominalSemitones;
    let octaveShift=0;
    if(foldedSemitones<SP_TUNE_DEFAULT_MIN_SEMITONES){
      foldedSemitones+=12;
      octaveShift=-1;
    }else if(foldedSemitones>SP_TUNE_DEFAULT_MAX_SEMITONES){
      foldedSemitones-=12;
      octaveShift=1;
    }
    const base=baseTune(foldedSemitones);
    return Object.freeze({
      code,
      nominalSemitones,
      foldedSemitones,
      octaveShift,
      carry:base.carry,
      carryDirection:base.carryDirection,
      ratio:base.ratio*Math.pow(2,octaveShift)
    });
  }));

  const BUTTERWORTH_6_Q=Object.freeze([.5176380902,.7071067812,1.9318516526]);
  const encodedCache=new WeakMap();
  const pendingEncodes=new WeakMap();
  const monoPlans=new WeakMap();

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

  // Callers may still speak in nominal semitones, but playback receives one of
  // the 32 immutable hardware-grid plans. `actualSemitones` exposes the small
  // detune caused by the finite carry grid; `effectiveSemitones` remains the
  // nominal tune-code position for compatibility with existing callers.
  function resolveTune(semitones=0){
    const requestedSemitones=Math.round(Number(semitones)||0);
    const nominalSemitones=Math.max(
      SP_TUNE_MIN_SEMITONES,
      Math.min(SP_TUNE_MAX_SEMITONES,requestedSemitones)
    );
    const base=SP_TUNE_TABLE[nominalSemitones-SP_TUNE_MIN_SEMITONES];
    return Object.freeze({
      ...base,
      requestedSemitones,
      effectiveSemitones:base.nominalSemitones,
      actualSemitones:12*Math.log2(base.ratio),
      model:SP_TUNE_MODEL
    });
  }

  function assertTunePlan(tune){
    if(!tune || !Number.isInteger(tune.code) ||
       tune.code<SP_TUNE_MIN_CODE || tune.code>SP_TUNE_MAX_CODE ||
       !Number.isFinite(tune.ratio) || tune.ratio<=0){
      throw new Error("SP1200: discrete tune plan missing");
    }
    const expected=SP_TUNE_TABLE[tune.code];
    if(!expected || tune.model!==SP_TUNE_MODEL ||
       tune.nominalSemitones!==expected.nominalSemitones ||
       tune.foldedSemitones!==expected.foldedSemitones ||
       tune.octaveShift!==expected.octaveShift ||
       tune.carry!==expected.carry || tune.carryDirection!==expected.carryDirection ||
       Math.abs(tune.ratio-expected.ratio)>1e-12){
      throw new Error("SP1200: invalid hardware tune plan");
    }
    return tune;
  }

  // Model the address generator as a deterministic 7-bit carry machine instead
  // of deriving every source address from floor(tick * averageRatio). For the
  // repeat side a carry inserts one extra hold of the current source address;
  // for the skip side a carry advances by two source addresses. Outer tune codes
  // wrap the same base pattern through a fixed octave repeat/skip stage.
  // The PROM phase/reset state is not publicly dumped, so V1 starts the carry
  // accumulator at zero and is deliberately labelled as a derived pattern model.
  function addressStepper(plan){
    const octaveCopies=Math.pow(2,Math.max(0,-plan.octaveShift));
    const octaveScale=Math.pow(2,Math.max(0,plan.octaveShift));
    let baseAddress=0;
    let carryPhase=0;
    let repeatPending=false;
    let octaveCopiesLeft=octaveCopies;

    function advanceBase(){
      if(plan.carryDirection==="repeat"){
        if(repeatPending){
          repeatPending=false;
          baseAddress++;
          return;
        }
        carryPhase+=plan.carry;
        if(carryPhase>=SP_TUNE_CARRY_MAX){
          carryPhase-=SP_TUNE_CARRY_MAX;
          repeatPending=true;
        }else{
          baseAddress++;
        }
        return;
      }

      if(plan.carryDirection==="skip"){
        carryPhase+=plan.carry;
        let advance=1;
        if(carryPhase>=SP_TUNE_CARRY_MAX){
          carryPhase-=SP_TUNE_CARRY_MAX;
          advance=2;
        }
        baseAddress+=advance;
        return;
      }

      baseAddress++;
    }

    return {
      next(){
        const address=baseAddress*octaveScale;
        octaveCopiesLeft--;
        if(octaveCopiesLeft<=0){
          octaveCopiesLeft=octaveCopies;
          advanceBase();
        }
        return address;
      }
    };
  }

  function rejectLegacySemitones(options){
    if(options && Object.prototype.hasOwnProperty.call(options,"semitones")){
      throw new Error("SP1200: playback requires a discrete tune plan");
    }
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

  // Mono is a property of the loaded source, not of an arbitrary bank/page.
  // Analyze the whole source once (bounded to ~100k probe points), freeze that
  // decision, and reuse it for every subsequent encode window of this buffer.
  // Stereo files need an app-side ingestion rule because the physical SP input
  // is mono. Average L/R, but restore only the energy that averaging removed:
  // never more than +3.01 dB and never above the original sampled channel peak.
  // This is not post-encode normalization and mono sources always stay at gain 1.
  function analyzeMonoPlan(sourceBuffer){
    const channels=Math.max(1,Number(sourceBuffer?.numberOfChannels)||1);
    if(channels===1)return Object.freeze({mode:"single",channel:0,gain:1});
    if(channels!==2)return Object.freeze({mode:"average",channels,gain:1});

    const left=sourceBuffer.getChannelData(0);
    const right=sourceBuffer.getChannelData(1);
    const span=Math.max(1,sourceBuffer.length);
    const stride=Math.max(1,Math.floor(span/100000));
    let ll=0,rr=0,lr=0,sourcePeak=0,mixedPeak=0;
    for(let i=0;i<sourceBuffer.length;i+=stride){
      const l=Number.isFinite(left[i])?left[i]:0;
      const r=Number.isFinite(right[i])?right[i]:0;
      ll+=l*l;
      rr+=r*r;
      lr+=l*r;
      sourcePeak=Math.max(sourcePeak,Math.abs(l),Math.abs(r));
      mixedPeak=Math.max(mixedPeak,Math.abs((l+r)*.5));
    }
    const corr=lr/Math.max(1e-12,Math.sqrt(ll*rr));
    if(corr<-.35){
      return Object.freeze({mode:"single",channel:rr>ll?1:0,gain:1,correlation:corr});
    }

    const stereoEnergy=(ll+rr)*.5;
    const mixedEnergy=(ll+rr+2*lr)*.25;
    const energyGain=mixedEnergy>1e-12
      ? Math.sqrt(stereoEnergy/mixedEnergy)
      : 1;
    const peakGain=mixedPeak>1e-12
      ? sourcePeak/mixedPeak
      : 1;
    const gain=Math.max(1,Math.min(
      SP_STEREO_DOWNMIX_MAX_GAIN,
      Number.isFinite(energyGain)?energyGain:1,
      Number.isFinite(peakGain)?peakGain:1
    ));
    return Object.freeze({
      mode:"average",
      channels:2,
      gain,
      correlation:corr
    });
  }

  function monoPlanFor(sourceBuffer){
    let plan=monoPlans.get(sourceBuffer);
    if(!plan){
      plan=analyzeMonoPlan(sourceBuffer);
      monoPlans.set(sourceBuffer,plan);
    }
    return plan;
  }

  function monoSample(sourceBuffer,frame,plan){
    if(plan.mode==="single"){
      const value=sourceBuffer.getChannelData(plan.channel)[frame];
      return (Number.isFinite(value)?value:0)*(plan.gain||1);
    }
    let sum=0;
    for(let channel=0;channel<plan.channels;channel++){
      const value=sourceBuffer.getChannelData(channel)[frame];
      sum+=Number.isFinite(value)?value:0;
    }
    return (sum/plan.channels)*(plan.gain||1);
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

  // ENCODE contract: source audio enters here and leaves as immutable SP PCM.
  // Playback below never receives or reads the original AudioBuffer.
  function* encodeSteps(sourceBuffer,request){
    const {inputRate,startFrame,endFrame,processStartFrame}=request;
    const plan=monoPlanFor(sourceBuffer);
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
      monoChannel:plan.mode==="single"?plan.channel:null,
      monoGain:plan.gain||1,
      monoScope:"source"
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

  // PLAYBACK contract: only stored SP PCM plus a resolved discrete tune plan
  // enter from here downward.
  function renderPcm(encodedData,options={}){
    rejectLegacySemitones(options);
    const {
      tune=resolveTune(0),
      outputRate=44100,
      maxDuration=Infinity,
      startFrame=0,
      endFrame=null
    }=options;
    const data=pcmData(encodedData);
    if(!data || !data.length)return new Float32Array(0);
    const plan=assertTunePlan(tune);
    const first=Math.max(0,Math.min(data.length-1,Math.floor(Number(startFrame)||0)));
    const last=Math.max(first+1,Math.min(data.length,Math.ceil(Number(endFrame) || data.length)));
    const rate=Math.max(8000,Number(outputRate)||44100);
    const naturalDuration=(last-first)/SP_SAMPLE_RATE/plan.ratio;
    const limit=Number.isFinite(maxDuration)?Math.max(0,Number(maxDuration)||0):naturalDuration;
    const duration=Math.min(naturalDuration,limit);
    const length=Math.max(1,Math.ceil(duration*rate));
    const output=new Float32Array(length);
    const stepper=addressStepper(plan);
    let renderedTick=-1;
    let sourceOffset=0;

    for(let i=0;i<length;i++){
      const spTick=Math.floor(i*SP_SAMPLE_RATE/rate);
      while(renderedTick<spTick){
        sourceOffset=stepper.next();
        renderedTick++;
      }
      const sourceIndex=first+sourceOffset;
      output[i]=sourceIndex<last?pcmValue(data,sourceIndex):0;
    }
    return output;
  }

  function assertEncodedPcm(encoded){
    if(!encoded || !pcmData(encoded) || !encoded.data.length){
      throw new Error("SP1200: encoded PCM missing");
    }
    if(encoded.sampleRate!==SP_SAMPLE_RATE || encoded.bitDepth!==SP_BITS){
      throw new Error("SP1200: incompatible encoded PCM");
    }
    if(!Number.isFinite(encoded.sourceStartSec) || !Number.isFinite(encoded.sourceEndSec)){
      throw new Error("SP1200: encoded PCM source range missing");
    }
    return encoded;
  }

  function renderEncodedSegment(audioContext,encoded,options={}){
    rejectLegacySemitones(options);
    const {
      startSec=encoded?.sourceStartSec||0,
      endSec=encoded?.sourceEndSec||0,
      tune=resolveTune(0),
      maxDuration=Infinity
    }=options;
    if(!audioContext?.createBuffer)throw new Error("SP1200: AudioContext unavailable");
    assertEncodedPcm(encoded);
    const plan=assertTunePlan(tune);

    const relativeStart=Math.max(0,(Number(startSec)||0)-encoded.sourceStartSec);
    const relativeEnd=Math.max(relativeStart,(Number(endSec)||0)-encoded.sourceStartSec);
    const first=Math.max(0,Math.min(encoded.data.length-1,Math.floor(relativeStart*SP_SAMPLE_RATE)));
    const last=Math.max(first+1,Math.min(encoded.data.length,Math.ceil(relativeEnd*SP_SAMPLE_RATE)));
    const output=renderPcm(encoded,{
      tune:plan,
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
    if(sourceBuffer){
      encodedCache.delete(sourceBuffer);
      pendingEncodes.delete(sourceBuffer);
      // Keep monoPlans: the per-source mono decision must remain stable even if
      // encoded PCM pages are evicted or explicitly rebuilt.
    }
  }

  globalThis.SP1200DSP=Object.freeze({
    sampleRate:SP_SAMPLE_RATE,
    bitDepth:SP_BITS,
    inputLowpassHz:INPUT_LOWPASS_HZ,
    maxCacheEntries:MAX_CACHE_ENTRIES,
    pcmStorage:"int16",
    monoPolicy:"per-source",
    monoLevelPolicy:SP_MONO_LEVEL_MODEL,
    stereoDownmixMaxGainDb:20*Math.log10(SP_STEREO_DOWNMIX_MAX_GAIN),
    tuneModel:SP_TUNE_MODEL,
    addressingModel:SP_ADDRESSING_MODEL,
    tuneCodes:Object.freeze({
      min:SP_TUNE_MIN_CODE,
      max:SP_TUNE_MAX_CODE,
      center:SP_TUNE_CENTER_CODE
    }),
    tuneRange:Object.freeze({
      minSemitones:SP_TUNE_MIN_SEMITONES,
      maxSemitones:SP_TUNE_MAX_SEMITONES,
      defaultMinSemitones:SP_TUNE_DEFAULT_MIN_SEMITONES,
      defaultMaxSemitones:SP_TUNE_DEFAULT_MAX_SEMITONES
    }),
    quantize12,
    resolveTune,
    encodeBuffer,
    encodeBufferAsync,
    renderPcm,
    renderEncodedSegment,
    clearCache
  });
})();