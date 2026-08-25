"use strict";

const fs=require("fs");
const path=require("path");
const vm=require("vm");

const ROOT=path.resolve(__dirname,"..");
const runtimePath=path.join(ROOT,"js","sp1200.js");

function assert(condition,message){
  if(!condition)throw new Error(message);
}

function makeBuffer(channels,rate=48000){
  const length=channels[0].length;
  return {
    numberOfChannels:channels.length,
    length,
    sampleRate:rate,
    duration:length/rate,
    getChannelData(channel){return channels[channel];}
  };
}

function rmsEncoded(encoded,start=200){
  let sum=0,count=0;
  for(let i=Math.min(start,encoded.data.length);i<encoded.data.length;i++){
    const value=encoded.data[i]/2048;
    sum+=value*value;
    count++;
  }
  return Math.sqrt(sum/Math.max(1,count));
}

function dbRatio(value,reference){
  return 20*Math.log10(Math.max(value,1e-12)/Math.max(reference,1e-12));
}

function sine(length,rate,frequency,amplitude,phase=0){
  const out=new Float32Array(length);
  for(let i=0;i<length;i++)out[i]=Math.sin(2*Math.PI*frequency*i/rate+phase)*amplitude;
  return out;
}

function clippedCodes(encoded){
  let count=0;
  for(const code of encoded.data){
    if(code<=-2048 || code>=2047)count++;
  }
  return count;
}

function main(){
  const runtime=fs.readFileSync(runtimePath,"utf8");
  vm.runInThisContext(runtime,{filename:runtimePath});
  const dsp=globalThis.SP1200DSP;
  assert(dsp,"SP1200DSP global missing");
  assert(dsp.monoLevelPolicy==="fixed-equal-power-v1","SP stereo ingestion must use a fixed equal-power rule");
  assert(Math.abs(dsp.stereoDownmixCoefficient-Math.SQRT1_2)<1e-12,"stereo channels must use fixed -3.01 dB coefficients");
  assert(dsp.inputStage?.model==="discrete-preamp-v1","SP input stage must expose the discrete preamp model");
  assert(Array.isArray(dsp.inputStage?.gainStepsDb) && dsp.inputStage.gainStepsDb.join(",")==="0,20,40","SP input gain must expose only +0/+20/+40 dB steps");
  assert(dsp.inputStage?.defaultGainDb===0,"SP browser ingestion must default to the line-level +0 dB setting");
  assert(dsp.inputStage?.overloadThreshold===1,"SP overload threshold must stay at ADC full scale");
  assert(dsp.inputStage?.overloadMode==="hard-adc-clip","SP overload must remain ADC clipping, not a soft saturator");
  assert(dsp.inputStage?.nonlinearPreamp==="not-modeled","SP V1 must not invent unmeasured preamp coloration");
  assert(dsp.inputFilter?.model==="service-manual-42dboct-derived-v1","SP input filter must expose the service-manual-derived model");
  assert(dsp.inputFilter?.family==="butterworth-derived","SP input filter family must remain explicitly derived");
  assert(dsp.inputFilter?.cutoffHz===10500,"SP input filter calibration point must stay at 10.5 kHz");
  assert(dsp.inputFilter?.order===7,"SP input filter must use seven poles for 42 dB/octave asymptotic slope");
  assert(dsp.inputFilter?.slopeDbPerOctave===42,"SP input filter slope metadata must match the service manual");
  assert(dsp.inputFilter?.exactCircuit===false,"derived SP input filter must not claim exact circuit equivalence");
  assert(!runtime.includes("BUTTERWORTH_6_Q"),"old six-pole input placeholder must stay removed");
  assert(!runtime.includes("Math.tanh"),"SP input stage must not hide a generic tanh vintage saturator");
  for(const forbidden of ["energyGain","peakGain","stereoEnergy","sourcePeak","mixedPeak"]){
    assert(!runtime.includes(forbidden),`SP input staging must not use adaptive ${forbidden}`);
  }

  const rate=48000;
  const length=rate;
  const frequency=997;
  const amplitude=.4;
  const referenceRms=amplitude/Math.sqrt(2);

  // True mono at the default +0 dB setting is the hardware-native line-level
  // case: no automatic makeup, attenuation or hidden preamp coloration.
  const mono=sine(length,rate,frequency,amplitude);
  const monoEncoded=dsp.encodeBuffer(makeBuffer([mono],rate));
  assert(monoEncoded.monoMode==="single","mono input must stay on one physical channel");
  assert(monoEncoded.monoCoefficient===null,"mono input must not receive a stereo coefficient");
  assert(monoEncoded.inputGainDb===0 && monoEncoded.inputGainLinear===1,"default encode must record +0 dB input gain");
  assert(monoEncoded.overload===false && monoEncoded.overloadSamples===0,"healthy +0 dB input must not report Sample Overload");
  assert(monoEncoded.adcPeak<1,"healthy +0 dB input must remain below ADC full scale");
  assert(Math.abs(dbRatio(rmsEncoded(monoEncoded),referenceRms))<.08,"mono passband level must stay essentially unchanged");

  // The hardware gain selector is discrete. +20 dB is exactly 10x and +40 dB is
  // 100x before the anti-alias filter/ADC. Gain is part of the PCM cache key.
  const quiet=sine(length,rate,frequency,.02);
  const quietBuffer=makeBuffer([quiet],rate);
  const quiet0=dsp.encodeBuffer(quietBuffer,{inputGainDb:0});
  const quiet20=dsp.encodeBuffer(quietBuffer,{inputGainDb:20});
  const gain20Delta=dbRatio(rmsEncoded(quiet20),rmsEncoded(quiet0));
  assert(quiet20!==quiet0,"different SP input gains must never alias to the same cached PCM");
  assert(dsp.encodeBuffer(quietBuffer,{inputGainDb:20})===quiet20,"same range and input gain must reuse the cached PCM");
  assert(quiet20.inputGainDb===20 && quiet20.inputGainLinear===10,"+20 dB input gain metadata mismatch");
  assert(gain20Delta>19.8 && gain20Delta<20.2,`+20 dB preamp should add about 20 dB before ADC, got ${gain20Delta.toFixed(2)} dB`);
  assert(quiet20.overload===false,"quiet +20 dB input should remain below overload");

  const quiet40=dsp.encodeBuffer(quietBuffer,{inputGainDb:40});
  assert(quiet40.inputGainDb===40 && quiet40.inputGainLinear===100,"+40 dB input gain metadata mismatch");
  assert(quiet40.overload===true && quiet40.overloadSamples>0,"+40 dB hot ADC input must report Sample Overload");
  assert(quiet40.adcPeak>1,"Sample Overload metadata must expose a pre-clamp ADC peak above full scale");
  assert(clippedCodes(quiet40)>0,"overloaded input must hard-clip to signed 12-bit codes");

  let invalidGainRejected=false;
  try{
    dsp.encodeBuffer(quietBuffer,{inputGainDb:10});
  }catch(error){
    invalidGainRejected=/input gain/.test(String(error?.message||error));
  }
  assert(invalidGainRejected,"non-hardware input gain steps must be rejected");

  // Fixed equal-power summing is deterministic. A duplicated mono signal is
  // therefore +3.01 dB at the virtual mono input; unlike the previous policy,
  // the engine must not analyze correlation and silently normalize it back down.
  const dualMono=dsp.encodeBuffer(makeBuffer([mono,mono],rate));
  assert(dualMono.monoMode==="stereo-equal-power","stereo files must use the fixed equal-power ingestion path");
  assert(Math.abs(dualMono.monoCoefficient-Math.SQRT1_2)<1e-12,"encoded metadata must record the fixed stereo coefficient");
  const dualMonoDelta=dbRatio(rmsEncoded(dualMono),referenceRms);
  assert(dualMonoDelta>2.90 && dualMonoDelta<3.12,`dual-mono fixed sum should be about +3.01 dB, got ${dualMonoDelta.toFixed(2)} dB`);

  // A 90-degree pair is the equal-power reference case: the fixed coefficients
  // preserve the RMS of either source channel without any content-dependent gain.
  const wideRight=sine(length,rate,frequency,amplitude,Math.PI/2);
  const wide=dsp.encodeBuffer(makeBuffer([mono,wideRight],rate));
  assert(wide.monoMode==="stereo-equal-power","wide stereo must use the same fixed ingestion rule");
  assert(Math.abs(dbRatio(rmsEncoded(wide),referenceRms))<.12,"equal-power wide stereo should preserve per-channel RMS closely");

  // Strong anti-phase material keeps the explicit source-safety fallback rather
  // than summing into cancellation. It still receives no automatic gain makeup.
  const antiRight=sine(length,rate,frequency,-.2);
  const anti=dsp.encodeBuffer(makeBuffer([mono,antiRight],rate));
  assert(anti.monoMode==="single" && anti.monoChannel===0,"anti-phase stereo must keep the dominant channel policy");
  assert(anti.monoCoefficient===null,"dominant-channel anti-phase handling must not add stereo gain");

  // A hot correlated stereo source is allowed to overload at +0 dB instead of
  // being peak-normalized. The machine keeps overloaded samples; V1 mirrors that
  // by retaining clipped PCM plus explicit overload metadata.
  const hot=sine(length,rate,frequency,.9);
  const hotStereo=dsp.encodeBuffer(makeBuffer([hot,hot],rate));
  assert(hotStereo.overload===true && hotStereo.overloadSamples>0,"hot fixed stereo sum must report Sample Overload");
  assert(clippedCodes(hotStereo)>0,"hot fixed stereo sum should be able to clip the 12-bit input");

  // The service manual describes an input anti-alias filter with an asymptotic
  // slope around 42 dB/octave. The calibrated seven-pole V1 keeps its 10.5 kHz
  // corner while rejecting the near-Nyquist region much harder than the old
  // six-pole placeholder. No makeup is allowed after this attenuation.
  const cutoffAmplitude=.2;
  const cutoff=sine(length,rate,10500,cutoffAmplitude);
  const cutoffEncoded=dsp.encodeBuffer(makeBuffer([cutoff],rate));
  const cutoffDelta=dbRatio(rmsEncoded(cutoffEncoded),cutoffAmplitude/Math.sqrt(2));
  assert(cutoffDelta>-5.2 && cutoffDelta<-3.5,`anti-alias 10.5 kHz calibration should stay near -4.4 dB after resampling, got ${cutoffDelta.toFixed(2)} dB`);

  const guardAmplitude=.2;
  const guard=sine(length,rate,12000,guardAmplitude);
  const guardEncoded=dsp.encodeBuffer(makeBuffer([guard],rate));
  const guardDelta=dbRatio(rmsEncoded(guardEncoded),guardAmplitude/Math.sqrt(2));
  assert(guardDelta<-12.5,`calibrated anti-alias filter must strongly reject 12 kHz before the 13.02 kHz Nyquist point, got ${guardDelta.toFixed(2)} dB`);

  console.log(`OK: SP1200 input — +0/+20/+40 dB preamp, overload metadata, 7-pole anti-alias ${guardDelta.toFixed(1)} dB @ 12 kHz`);
}

try{
  main();
}catch(error){
  console.error(error?.stack||error);
  process.exit(1);
}
