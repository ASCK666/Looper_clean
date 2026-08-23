"use strict";

// SP-1200 inspired DSP engine.
// Scope is deliberately narrow: mono input, 26.04 kHz sampling, 12-bit linear
// quantization, 7-bit carry address stepping, multiplexed DAC/sample-hold
// reconstruction and optional derived fixed-output filters. This is a
// behavioral approximation, not a bit-perfect hardware clone.
(() => {
  const SP_SAMPLE_RATE=26040;
  const SP_BITS=12;
  const PCM_SCALE=2048;
  const SP_INPUT_FILTER_MODEL="service-manual-42dboct-derived-v1";
  const SP_INPUT_FILTER_CUTOFF_HZ=10500;
  const SP_INPUT_FILTER_ORDER=7;
  const SP_INPUT_FILTER_SLOPE_DB_PER_OCTAVE=42;
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
  const SP_MONO_LEVEL_MODEL="fixed-equal-power-v1";
  const SP_STEREO_DOWNMIX_COEFFICIENT=Math.SQRT1_2;
  const SP_INPUT_STAGE_MODEL="discrete-preamp-v1";
  const SP_INPUT_GAIN_STEPS_DB=Object.freeze([0,20,40]);
  const SP_INPUT_GAIN_DEFAULT_DB=0;
  const SP_INPUT_OVERLOAD_THRESHOLD=1;
  const SP_LEVEL_DAC_MODEL="ad7524-ideal-transfer-v1";
  const SP_LEVEL_DAC_BITS=8;
  const SP_LEVEL_DAC_MAX_CODE=255;
  const SP_LEVEL_DAC_DENOMINATOR=256;
  const SP_RECONSTRUCTION_MODEL="mux8-sh-zoh-v1";
  const SP_DAC_CHANNELS=8;
  const SP_DAC_MULTIPLEX_RATE=SP_SAMPLE_RATE*SP_DAC_CHANNELS;
  const SP_HOLD_MODEL="ideal-zoh-v1";
  const SP_OUTPUT_FILTER_MODEL="fixed34-cheb5-derived-v2";
  const SP_OUTPUT_FILTER_56_MODEL="fixed56-cheb5-derived-v1";
  const SP_OUTPUT_FILTER_FAMILY="chebyshev1-derived";
  const SP_OUTPUT_FILTER_CUTOFF_HZ=9000;
  const SP_OUTPUT_FILTER_56_CUTOFF_HZ=10000;
  const SP_OUTPUT_FILTER_ORDER=5;
  const SP_OUTPUT_FILTER_RIPPLE_DB=1;
  const SP_OUTPUT_MODES=Object.freeze(["raw","filter","filter56"]);

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

  // A 7th-order Butterworth factors into one real pole plus three complex-pole
  // pairs. Its asymptotic slope is 7 * 6 = 42 dB/octave, matching the service
  // manual description of the SP sample-input anti-alias filter. The original
  // analog network is more complex, so this remains an explicitly derived V1
  // magnitude model rather than a claim of exact TL084/circuit equivalence.
  const BUTTERWORTH_7_Q=Object.freeze([
    .5549581321,
    .8019377358,
    2.2469796037
  ]);

  // Normalized poles for a fifth-order, 1 dB-ripple Chebyshev type-I low-pass.
  // Archival SP documentation identifies the fixed 3-6 outputs as five-pole
  // 1 dB Chebyshev filters, but does not publish a calibrated component transfer.
  // Keep conservative derived edges and bilinear-transform this standard
  // prototype instead of inventing component tolerances or EQ gain.
  const CHEBYSHEV_5_1DB_REAL_POLE=.2894933412;
  const CHEBYSHEV_5_1DB_PAIR_POLES=Object.freeze([
    Object.freeze({real:.2342050328,imag:.6119198477}),
    Object.freeze({real:.0894583622,imag:.9901071120})
  ]);
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

  function resolveOutputMode(mode="raw"){
    const value=String(mode||"raw").toLowerCase();
    if(!SP_OUTPUT_MODES.includes(value)){
      throw new Error("SP1200: output mode must be raw, filter or filter56");
    }
    return value;
  }

  function resolveInputGain(inputGainDb=SP_INPUT_GAIN_DEFAULT_DB){
    const db=Number(inputGainDb);
    if(!SP_INPUT_GAIN_STEPS_DB.includes(db)){
      throw new Error("SP1200: input gain must be 0, 20 or 40 dB");
    }
    return Object.freeze({db,linear:Math.pow(10,db/20)});
  }

  // Playback-level control on the original machine is a standard 8-bit
  // multiplying DAC after the 12-bit audio DAC. The AD7524 ideal unipolar
  // transfer is code/256, so full code 255 is intentionally 255/256 rather than
  // mathematical unity. Omitted levelCode means bypass so low-level DSP tests and
  // non-Chopper callers can isolate pitch/reconstruction; the Chopper adapter
  // always supplies a hardware level code while SP mode is active.
  function resolveLevelCode(levelCode=null){
    if(levelCode===null || typeof levelCode==="undefined"){
      return Object.freeze({code:null,gain:1,bypass:true});
    }
    const code=Number(levelCode);
    if(!Number.isInteger(code) || code<0 || code>SP_LEVEL_DAC_MAX_CODE){
      throw new Error("SP1200: level code must be an integer from 0 to 255");
    }
    return Object.freeze({
      code,
      gain:code/SP_LEVEL_DAC_DENOMINATOR,
      bypass:false
    });
  }

  function safeFilterCutoff(sampleRate,cutoff){
    const rate=Math.max(1,Number(sampleRate)||44100);
    return Math.max(10,Math.min(Number(cutoff)||SP_INPUT_FILTER_CUTOFF_HZ,rate*.45));
  }

  function makeOnePoleLowpass(sampleRate,cutoff){
    const rate=Math.max(1,Number(sampleRate)||44100);
    const fc=safeFilterCutoff(rate,cutoff);
    const k=Math.tan(Math.PI*fc/rate);
    const norm=1/(1+k);
    return {
      b0:k*norm,
      b1:k*norm,
      a1:(k-1)*norm,
      z1:0
    };
  }

  function filterOnePole(section,x){
    const y=section.b0*x+section.z1;
    section.z1=section.b1*x-section.a1*y;
    return y;
  }

  function makeLowpass(sampleRate,cutoff,q){
    const rate=Math.max(1,Number(sampleRate)||44100);
    const fc=safeFilterCutoff(rate,cutoff);
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

  function makeChebyshev5Lowpass(sampleRate,cutoff){
    const rate=Math.max(1,Number(sampleRate)||44100);
    const fc=safeFilterCutoff(rate,cutoff);
    const k=2*rate;
    const warped=2*rate*Math.tan(Math.PI*fc/rate);
    const realPole=CHEBYSHEV_5_1DB_REAL_POLE*warped;
    const realNorm=1/(k+realPole);
    const firstOrder={
      b0:realPole*realNorm,
      b1:realPole*realNorm,
      a1:(realPole-k)*realNorm,
      z1:0
    };
    const sections=CHEBYSHEV_5_1DB_PAIR_POLES.map(pole=>{
      const a=2*pole.real*warped;
      const b=(pole.real*pole.real+pole.imag*pole.imag)*warped*warped;
      const d0=k*k+a*k+b;
      return {
        b0:b/d0,
        b1:2*b/d0,
        b2:b/d0,
        a1:(-2*k*k+2*b)/d0,
        a2:(k*k-a*k+b)/d0,
        z1:0,
        z2:0
      };
    });
    return {firstOrder,sections};
  }

  function filterSample(section,x){
    const y=section.b0*x+section.z1;
    section.z1=section.b1*x-section.a1*y+section.z2;
    section.z2=section.b2*x-section.a2*y;
    return y;
  }

  // The original hardware uses one 12-bit DAC shared across eight audio channels.
  // Its analog output passes through an 8-bit multiplying level DAC before the
  // 4051 routes each voice into its sample/hold. For one isolated voice, the held
  // value is therefore the selected 12-bit sample multiplied by one fixed 8-bit
  // level code until that channel's next 26.04 kHz refresh. V1 models this ideal
  // transfer without inventing MDAC non-linearity, capacitor droop or crosstalk.
  function reconstructSampleHold(data,{first,last,plan,rate,length,level}){
    const output=new Float32Array(length);
    const stepper=addressStepper(plan);
    let renderedHold=-1;
    let heldValue=0;

    for(let i=0;i<length;i++){
      const dacSlot=Math.floor(i*SP_DAC_MULTIPLEX_RATE/rate);
      const holdTick=Math.floor(dacSlot/SP_DAC_CHANNELS);
      while(renderedHold<holdTick){
        const sourceOffset=stepper.next();
        const sourceIndex=first+sourceOffset;
        const dacValue=sourceIndex<last?pcmValue(data,sourceIndex):0;
        heldValue=dacValue*level.gain;
        renderedHold++;
      }
      output[i]=heldValue;
    }
    return output;
  }

  // Vintage SP-1200 channels 3/4 use the darker fixed output filter, 5/6 use
  // a somewhat more open fixed filter, and 7/8 are unfiltered. Archival technical
  // documentation identifies the fixed 3-6 filters as five-pole, 1 dB-ripple
  // Chebyshev responses. Complete calibrated SP-1200 component transfers are not
  // public here, so 3/4 retains its conservative 9 kHz edge and 5/6 uses the
  // separately published 10 kHz second-profile calibration as a derived point.
  // Both profiles remain post DAC/level-DAC/S&H, with no makeup gain and no claim
  // to the dynamic SSM2044 path used by channels 1/2.
  function applyOutputProfile(output,sampleRate,mode){
    const resolved=resolveOutputMode(mode);
    if(resolved==="raw" || !output.length)return output;
    const cutoff=resolved==="filter56" ? SP_OUTPUT_FILTER_56_CUTOFF_HZ : SP_OUTPUT_FILTER_CUTOFF_HZ;
    const filter=makeChebyshev5Lowpass(sampleRate,cutoff);
    for(let i=0;i<output.length;i++){
      let value=filterOnePole(filter.firstOrder,output[i]);
      for(const section of filter.sections)value=filterSample(section,value);
      output[i]=value;
    }
    return output;
  }

  // Mono is a property of the loaded source, not of an arbitrary bank/page.
  // Analyze the whole source once (bounded to ~100k probe points), freeze that
  // decision, and reuse it for every subsequent encode window of this buffer.
  // The physical SP sample input is mono; loading a stereo browser file therefore
  // needs an app-side ingestion rule before the SP model. Use one fixed equal-power
  // sum (L/sqrt(2) + R/sqrt(2)) rather than content-dependent RMS/peak makeup.
  // This policy is deterministic and deliberately separate from the input preamp.
  // Strong anti-phase material keeps the existing dominant-channel fallback to
  // avoid destructive cancellation from a stereo file.
  function analyzeMonoPlan(sourceBuffer){
    const channels=Math.max(1,Number(sourceBuffer?.numberOfChannels)||1);
    if(channels===1)return Object.freeze({mode:"single",channel:0});
    if(channels!==2)return Object.freeze({mode:"average",channels});

    const left=sourceBuffer.getChannelData(0);
    const right=sourceBuffer.getChannelData(1);
    const span=Math.max(1,sourceBuffer.length);
    const stride=Math.max(1,Math.floor(span/100000));
    let ll=0,rr=0,lr=0;
    for(let i=0;i<sourceBuffer.length;i+=stride){
      const l=Number.isFinite(left[i])?left[i]:0;
      const r=Number.isFinite(right[i])?right[i]:0;
      ll+=l*l;
      rr+=r*r;
      lr+=l*r;
    }
    const corr=lr/Math.max(1e-12,Math.sqrt(ll*rr));
    if(corr<-.35){
      return Object.freeze({mode:"single",channel:rr>ll?1:0,correlation:corr});
    }
    return Object.freeze({
      mode:"stereo-equal-power",
      channels:2,
      coefficient:SP_STEREO_DOWNMIX_COEFFICIENT,
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
      return Number.isFinite(value)?value:0;
    }
    if(plan.mode==="stereo-equal-power"){
      const left=sourceBuffer.getChannelData(0)[frame];
      const right=sourceBuffer.getChannelData(1)[frame];
      return ((Number.isFinite(left)?left:0)+(Number.isFinite(right)?right:0))*plan.coefficient;
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

  function encodeRequest(sourceBuffer,{
    startSec=0,
    endSec=sourceBuffer?.duration||0,
    inputGainDb=SP_INPUT_GAIN_DEFAULT_DB
  }={}){
    if(!sourceBuffer || !sourceBuffer.length || !sourceBuffer.sampleRate){
      throw new Error("SP1200: source audio missing");
    }

    const inputRate=sourceBuffer.sampleRate;
    const inputGain=resolveInputGain(inputGainDb);
    const sourceDuration=sourceBuffer.duration;
    const safeStart=Math.max(0,Math.min(sourceDuration,Number(startSec)||0));
    const safeEnd=Math.max(safeStart,Math.min(sourceDuration,Number(endSec)||sourceDuration));
    const startFrame=Math.max(0,Math.min(sourceBuffer.length-1,Math.floor(safeStart*inputRate)));
    const endFrame=Math.max(startFrame+1,Math.min(sourceBuffer.length,Math.ceil(safeEnd*inputRate)));
    const processStartFrame=Math.max(0,startFrame-Math.ceil(FILTER_PREROLL_SECONDS*inputRate));
    return {
      inputRate,
      inputGain,
      startFrame,
      endFrame,
      processStartFrame,
      cacheKey:`${startFrame}:${endFrame}:g${inputGain.db}`
    };
  }

  function cachedEncode(sourceBuffer,request){
    const cache=cacheFor(sourceBuffer);
    const cached=cache.get(request.cacheKey);
    return cached?touchCache(cache,request.cacheKey,cached):null;
  }

  // ENCODE contract: source audio enters here and leaves as immutable SP PCM.
  // The discrete preamp gain is applied before the anti-alias filter/ADC. The
  // original machine reports Sample Overload but still keeps the sample, so V1
  // records overload metadata and lets the 12-bit ADC hard-clip naturally. It
  // deliberately adds no unmeasured preamp saturation, compression or noise.
  // Playback below never receives or reads the original AudioBuffer.
  function* encodeSteps(sourceBuffer,request){
    const {inputRate,inputGain,startFrame,endFrame,processStartFrame}=request;
    const plan=monoPlanFor(sourceBuffer);
    const firstOrder=makeOnePoleLowpass(inputRate,SP_INPUT_FILTER_CUTOFF_HZ);
    const sections=BUTTERWORTH_7_Q.map(q=>makeLowpass(
      inputRate,
      SP_INPUT_FILTER_CUTOFF_HZ,
      q
    ));
    const filteredLength=endFrame-processStartFrame;
    const requestedSeconds=(endFrame-startFrame)/inputRate;
    const length=Math.max(1,Math.ceil(requestedSeconds*SP_SAMPLE_RATE));
    const data=new Int16Array(length);
    const sourcePerTarget=inputRate/SP_SAMPLE_RATE;
    const requestedOffset=startFrame-processStartFrame;
    let outputIndex=0;
    let targetPosition=requestedOffset;
    let previous=0;
    let adcPeak=0;
    let overloadSamples=0;

    function storeAdcSample(value){
      const magnitude=Math.abs(Number(value)||0);
      adcPeak=Math.max(adcPeak,magnitude);
      if(magnitude>SP_INPUT_OVERLOAD_THRESHOLD)overloadSamples++;
      data[outputIndex++]=quantize12Code(value);
    }

    for(let offset=0;offset<filteredLength;offset++){
      let current=monoSample(sourceBuffer,processStartFrame+offset,plan)*inputGain.linear;
      current=filterOnePole(firstOrder,current);
      for(const section of sections)current=filterSample(section,current);

      if(offset===0){
        previous=current;
        while(outputIndex<length && targetPosition<=0){
          storeAdcSample(current);
          targetPosition=requestedOffset+outputIndex*sourcePerTarget;
        }
      }else{
        while(outputIndex<length && targetPosition<=offset){
          const fraction=Math.max(0,Math.min(1,targetPosition-(offset-1)));
          const value=previous+(current-previous)*fraction;
          storeAdcSample(value);
          targetPosition=requestedOffset+outputIndex*sourcePerTarget;
        }
        previous=current;
      }

      if(offset>0 && offset%ENCODE_YIELD_INPUT_FRAMES===0)yield;
    }

    while(outputIndex<length)storeAdcSample(previous);

    return Object.freeze({
      data,
      sampleRate:SP_SAMPLE_RATE,
      bitDepth:SP_BITS,
      sourceStartSec:startFrame/inputRate,
      sourceEndSec:endFrame/inputRate,
      monoMode:plan.mode,
      monoChannel:plan.mode==="single"?plan.channel:null,
      monoCoefficient:plan.mode==="stereo-equal-power"?plan.coefficient:null,
      monoScope:"source",
      inputGainDb:inputGain.db,
      inputGainLinear:inputGain.linear,
      adcPeak,
      overload:overloadSamples>0,
      overloadSamples
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
  // enter from here downward. Reconstruction explicitly models the shared 12-bit
  // DAC, the 8-bit multiplying level DAC, eight multiplex slots and each channel's
  // sample/hold. The optional output profile then happens after reconstruction.
  function renderPcm(encodedData,options={}){
    rejectLegacySemitones(options);
    const {
      tune=resolveTune(0),
      levelCode=null,
      outputRate=44100,
      outputMode="raw",
      maxDuration=Infinity,
      startFrame=0,
      endFrame=null
    }=options;
    const data=pcmData(encodedData);
    if(!data || !data.length)return new Float32Array(0);
    const plan=assertTunePlan(tune);
    const level=resolveLevelCode(levelCode);
    const resolvedOutputMode=resolveOutputMode(outputMode);
    const first=Math.max(0,Math.min(data.length-1,Math.floor(Number(startFrame)||0)));
    const last=Math.max(first+1,Math.min(data.length,Math.ceil(Number(endFrame) || data.length)));
    const rate=Math.max(8000,Number(outputRate)||44100);
    const naturalDuration=(last-first)/SP_SAMPLE_RATE/plan.ratio;
    const limit=Number.isFinite(maxDuration)?Math.max(0,Number(maxDuration)||0):naturalDuration;
    const duration=Math.min(naturalDuration,limit);
    const length=Math.max(1,Math.ceil(duration*rate));
    const output=reconstructSampleHold(data,{first,last,plan,rate,length,level});
    return applyOutputProfile(output,rate,resolvedOutputMode);
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
      levelCode=null,
      outputMode="raw",
      maxDuration=Infinity
    }=options;
    if(!audioContext?.createBuffer)throw new Error("SP1200: AudioContext unavailable");
    assertEncodedPcm(encoded);
    const plan=assertTunePlan(tune);
    resolveLevelCode(levelCode);
    const resolvedOutputMode=resolveOutputMode(outputMode);

    const relativeStart=Math.max(0,(Number(startSec)||0)-encoded.sourceStartSec);
    const relativeEnd=Math.max(relativeStart,(Number(endSec)||0)-encoded.sourceStartSec);
    const first=Math.max(0,Math.min(encoded.data.length-1,Math.floor(relativeStart*SP_SAMPLE_RATE)));
    const last=Math.max(first+1,Math.min(encoded.data.length,Math.ceil(relativeEnd*SP_SAMPLE_RATE)));
    const output=renderPcm(encoded,{
      tune:plan,
      levelCode,
      outputRate:audioContext.sampleRate,
      outputMode:resolvedOutputMode,
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
    inputLowpassHz:SP_INPUT_FILTER_CUTOFF_HZ,
    inputStage:Object.freeze({
      model:SP_INPUT_STAGE_MODEL,
      gainStepsDb:SP_INPUT_GAIN_STEPS_DB,
      defaultGainDb:SP_INPUT_GAIN_DEFAULT_DB,
      overloadThreshold:SP_INPUT_OVERLOAD_THRESHOLD,
      overloadMode:"hard-adc-clip",
      nonlinearPreamp:"not-modeled"
    }),
    inputFilter:Object.freeze({
      model:SP_INPUT_FILTER_MODEL,
      family:"butterworth-derived",
      cutoffHz:SP_INPUT_FILTER_CUTOFF_HZ,
      order:SP_INPUT_FILTER_ORDER,
      slopeDbPerOctave:SP_INPUT_FILTER_SLOPE_DB_PER_OCTAVE,
      exactCircuit:false
    }),
    levelDac:Object.freeze({
      model:SP_LEVEL_DAC_MODEL,
      bits:SP_LEVEL_DAC_BITS,
      maxCode:SP_LEVEL_DAC_MAX_CODE,
      denominator:SP_LEVEL_DAC_DENOMINATOR,
      fullScaleGain:SP_LEVEL_DAC_MAX_CODE/SP_LEVEL_DAC_DENOMINATOR,
      transfer:"unipolar-code-over-256",
      placement:"post-12bit-dac-pre-demux",
      analogNonlinearity:"not-modeled"
    }),
    reconstruction:Object.freeze({
      model:SP_RECONSTRUCTION_MODEL,
      sharedDac:true,
      dacBits:SP_BITS,
      multiplexChannels:SP_DAC_CHANNELS,
      multiplexRate:SP_DAC_MULTIPLEX_RATE,
      holdRate:SP_SAMPLE_RATE,
      holdModel:SP_HOLD_MODEL,
      droopMode:"not-modeled",
      crosstalkMode:"not-modeled"
    }),
    maxCacheEntries:MAX_CACHE_ENTRIES,
    pcmStorage:"int16",
    monoPolicy:"per-source",
    monoLevelPolicy:SP_MONO_LEVEL_MODEL,
    stereoDownmixCoefficient:SP_STEREO_DOWNMIX_COEFFICIENT,
    tuneModel:SP_TUNE_MODEL,
    addressingModel:SP_ADDRESSING_MODEL,
    outputModes:SP_OUTPUT_MODES,
    outputFilter:Object.freeze({
      model:SP_OUTPUT_FILTER_MODEL,
      family:SP_OUTPUT_FILTER_FAMILY,
      hardwarePair:"3-4",
      cutoffHz:SP_OUTPUT_FILTER_CUTOFF_HZ,
      order:SP_OUTPUT_FILTER_ORDER,
      rippleDb:SP_OUTPUT_FILTER_RIPPLE_DB,
      makeupGainDb:0,
      exactCircuit:false
    }),
    outputFilter56:Object.freeze({
      model:SP_OUTPUT_FILTER_56_MODEL,
      family:SP_OUTPUT_FILTER_FAMILY,
      hardwarePair:"5-6",
      cutoffHz:SP_OUTPUT_FILTER_56_CUTOFF_HZ,
      order:SP_OUTPUT_FILTER_ORDER,
      rippleDb:SP_OUTPUT_FILTER_RIPPLE_DB,
      makeupGainDb:0,
      exactCircuit:false
    }),
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
    resolveLevelCode,
    encodeBuffer,
    encodeBufferAsync,
    renderPcm,
    renderEncodedSegment,
    clearCache
  });
})();