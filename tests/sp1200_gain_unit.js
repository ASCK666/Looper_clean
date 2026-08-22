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

function maxAbs(data){
  let peak=0;
  for(const value of data)peak=Math.max(peak,Math.abs(Number(value)||0));
  return peak;
}

function main(){
  const runtime=fs.readFileSync(runtimePath,"utf8");
  vm.runInThisContext(runtime,{filename:runtimePath});
  const dsp=globalThis.SP1200DSP;
  assert(dsp,"SP1200DSP global missing");
  assert(dsp.monoLevelPolicy==="bounded-energy-v1","SP stereo ingestion must expose bounded energy compensation");
  assert(Math.abs(dsp.stereoDownmixMaxGainDb-3.01029995664)<1e-6,"stereo downmix compensation must cap at +3.01 dB");

  const rate=48000;
  const length=rate;
  const frequency=997;
  const amplitude=.4;
  const referenceRms=amplitude/Math.sqrt(2);

  // True mono is the hardware-native case: no makeup gain at all.
  const mono=sine(length,rate,frequency,amplitude);
  const monoEncoded=dsp.encodeBuffer(makeBuffer([mono],rate));
  assert(monoEncoded.monoMode==="single" && monoEncoded.monoGain===1,"mono input must stay gain-neutral");
  assert(Math.abs(dbRatio(rmsEncoded(monoEncoded),referenceRms))<.08,"mono passband level must stay essentially unchanged");

  // Dual-mono stereo already sums without loss and therefore receives no boost.
  const dualMono=dsp.encodeBuffer(makeBuffer([mono,mono],rate));
  assert(dualMono.monoMode==="average","dual-mono stereo should use the average path");
  assert(Math.abs(dualMono.monoGain-1)<1e-6,"correlated stereo must not be boosted");
  assert(Math.abs(dbRatio(rmsEncoded(dualMono),referenceRms))<.08,"dual-mono encoded level must match the source channel");

  // A 90-degree stereo pair loses 3 dB under raw (L+R)/2. The bounded-energy
  // policy restores that loss, but cannot exceed either +3.01 dB or source peak.
  const wideRight=sine(length,rate,frequency,amplitude,Math.PI/2);
  const wide=dsp.encodeBuffer(makeBuffer([mono,wideRight],rate));
  assert(wide.monoMode==="average","wide stereo should remain a mono sum, not arbitrarily drop a channel");
  assert(wide.monoGain>1.40 && wide.monoGain<=Math.SQRT2+1e-9,"wide stereo should recover about 3 dB and stay capped");
  assert(Math.abs(dbRatio(rmsEncoded(wide),referenceRms))<.12,"wide stereo downmix must preserve per-channel RMS closely");
  const rawMixed=new Float32Array(length);
  for(let i=0;i<length;i++)rawMixed[i]=(mono[i]+wideRight[i])*.5;
  assert(maxAbs(rawMixed)*wide.monoGain<=amplitude+1e-6,"downmix compensation must not exceed the original channel peak before filtering");

  // Strong anti-phase material still follows the existing safe policy: choose
  // the dominant physical channel instead of trying to makeup a cancelling sum.
  const antiRight=sine(length,rate,frequency,-.2);
  const anti=dsp.encodeBuffer(makeBuffer([mono,antiRight],rate));
  assert(anti.monoMode==="single" && anti.monoChannel===0,"anti-phase stereo must keep the dominant channel policy");
  assert(anti.monoGain===1,"dominant-channel anti-phase handling must not add gain");

  // Do not hide the anti-alias stage behind normalization. At 10.5 kHz the
  // six-pole filter plus finite-rate encode interpolation should remain clearly
  // attenuated rather than receiving any automatic post-filter makeup.
  const cutoffAmplitude=.2;
  const cutoff=sine(length,rate,10500,cutoffAmplitude);
  const cutoffEncoded=dsp.encodeBuffer(makeBuffer([cutoff],rate));
  const cutoffDelta=dbRatio(rmsEncoded(cutoffEncoded),cutoffAmplitude/Math.sqrt(2));
  assert(cutoffDelta>-5.2 && cutoffDelta<-3.5,`anti-alias encode attenuation should stay intact, got ${cutoffDelta.toFixed(2)} dB`);

  console.log("OK: SP1200 gain — mono neutral, stereo downmix level preserved, filter attenuation untouched");
}

try{
  main();
}catch(error){
  console.error(error?.stack||error);
  process.exit(1);
}
