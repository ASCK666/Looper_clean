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
  assert(dsp.inputFilter?.model==="service-manual-42dboct-derived-v1","SP input filter must expose the service-manual-derived model");
  assert(dsp.inputFilter?.family==="butterworth-derived","SP input filter family must remain explicitly derived");
  assert(dsp.inputFilter?.cutoffHz===10500,"SP input filter calibration point must stay at 10.5 kHz");
  assert(dsp.inputFilter?.order===7,"SP input filter must use seven poles for 42 dB/octave asymptotic slope");
  assert(dsp.inputFilter?.slopeDbPerOctave===42,"SP input filter slope metadata must match the service manual");
  assert(dsp.inputFilter?.exactCircuit===false,"derived SP input filter must not claim exact circuit equivalence");
  assert(!runtime.includes("BUTTERWORTH_6_Q"),"old six-pole input placeholder must stay removed");
  for(const forbidden of ["energyGain","peakGain","stereoEnergy","sourcePeak","mixedPeak"]){
    assert(!runtime.includes(forbidden),`SP input staging must not use adaptive ${forbidden}`);
  }

  const rate=48000;
  const length=rate;
  const frequency=997;
  const amplitude=.4;
  const referenceRms=amplitude/Math.sqrt(2);

  // True mono is the hardware-native case: no automatic makeup or attenuation.
  const mono=sine(length,rate,frequency,amplitude);
  const monoEncoded=dsp.encodeBuffer(makeBuffer([mono],rate));
  assert(monoEncoded.monoMode==="single","mono input must stay on one physical channel");
  assert(monoEncoded.monoCoefficient===null,"mono input must not receive a stereo coefficient");
  assert(Math.abs(dbRatio(rmsEncoded(monoEncoded),referenceRms))<.08,"mono passband level must stay essentially unchanged");

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

  // Fixed staging means a hot correlated stereo source is allowed to overload the
  // virtual 12-bit input instead of being peak-normalized. That behavior is what
  // the later input-amp/headroom model will refine.
  const hot=sine(length,rate,frequency,.9);
  const hotStereo=dsp.encodeBuffer(makeBuffer([hot,hot],rate));
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

  console.log(`OK: SP1200 input — fixed mono staging, 7-pole 42 dB/oct anti-alias model, ${guardDelta.toFixed(1)} dB @ 12 kHz`);
}

try{
  main();
}catch(error){
  console.error(error?.stack||error);
  process.exit(1);
}
