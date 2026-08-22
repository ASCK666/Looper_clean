"use strict";

const fs=require("fs");
const path=require("path");
const vm=require("vm");

const ROOT=path.resolve(__dirname,"..");
const runtimePath=path.join(ROOT,"js","sp1200.js");
const adapterPath=path.join(ROOT,"js","chopper-sp1200.js");

function assert(condition,message){
  if(!condition)throw new Error(message);
}

function sine(length,rate,frequency,amplitude=.5){
  const out=new Float32Array(length);
  for(let i=0;i<length;i++)out[i]=Math.sin(2*Math.PI*frequency*i/rate)*amplitude;
  return out;
}

function rms(data,start=0){
  let sum=0,count=0;
  for(let i=Math.min(start,data.length);i<data.length;i++){
    const value=Number(data[i])||0;
    sum+=value*value;
    count++;
  }
  return Math.sqrt(sum/Math.max(1,count));
}

function dbRatio(value,reference){
  return 20*Math.log10(Math.max(value,1e-12)/Math.max(reference,1e-12));
}

function main(){
  const runtime=fs.readFileSync(runtimePath,"utf8");
  vm.runInThisContext(runtime,{filename:runtimePath});
  const dsp=globalThis.SP1200DSP;
  assert(dsp,"SP1200DSP global missing");
  assert(Array.isArray(dsp.outputModes) && dsp.outputModes.join(",")==="raw,filter","SP output modes must stay RAW/FILTER only");
  assert(dsp.outputFilter?.model==="fixed34-derived-v1","SP filter profile must remain explicitly derived");
  assert(dsp.outputFilter?.hardwarePair==="3-4","SP filter V1 must represent the fixed lower-cutoff 3/4 pair");
  assert(dsp.outputFilter?.cutoffHz===9000,"SP fixed output cutoff must stay at the V1 9 kHz calibration point");
  assert(dsp.outputFilter?.order===4,"SP fixed output filter must stay fourth-order in V1");
  assert(dsp.outputFilter?.makeupGainDb===0,"SP output filter must not add loudness makeup");

  // The SP audio DAC is shared across eight channels. At the documented
  // per-channel sample rate this implies an 8x multiplex clock; each channel's
  // sample/hold keeps one exact DAC value for all eight slots until its next
  // refresh. V1 deliberately does not invent capacitor droop or channel bleed.
  assert(dsp.reconstruction?.model==="mux8-sh-zoh-v1","SP reconstruction model marker missing");
  assert(dsp.reconstruction?.sharedDac===true,"SP reconstruction must expose the shared DAC topology");
  assert(dsp.reconstruction?.dacBits===12,"SP reconstruction DAC must remain 12-bit");
  assert(dsp.reconstruction?.multiplexChannels===8,"SP reconstruction must model eight multiplexed channels");
  assert(dsp.reconstruction?.multiplexRate===208320,"SP DAC multiplex clock must be 8 x 26.04 kHz");
  assert(dsp.reconstruction?.holdRate===26040,"each SP sample/hold must refresh at 26.04 kHz");
  assert(dsp.reconstruction?.holdModel==="ideal-zoh-v1","SP V1 sample/hold must stay an ideal ZOH");
  assert(dsp.reconstruction?.droopMode==="not-modeled","SP V1 must not invent unmeasured sample/hold droop");
  assert(dsp.reconstruction?.crosstalkMode==="not-modeled","SP V1 must not invent unmeasured multiplex crosstalk");

  const rate=26040;
  const center=dsp.resolveTune(0);
  const pattern=new Float32Array([0,.25,-.5,.75,-1,.5,-.25,.125]);
  const raw=dsp.renderPcm(pattern,{tune:center,outputRate:rate,outputMode:"raw"});
  assert(raw.length===pattern.length,"RAW output length must be unchanged at the SP reconstruction rate");
  for(let i=0;i<pattern.length;i++){
    assert(raw[i]===pattern[i],"RAW output must stay bit-for-bit identical to the pre-filter playback path");
  }

  // Inspect the DAC's multiplex clock directly. Every PCM value must be held for
  // exactly eight DAC slots with no interpolation and no within-hold amplitude
  // decay. The output filter is allowed to evolve after this stage, proving the
  // processing order is PCM -> multiplexed DAC/S&H -> optional analog filter.
  const muxRate=dsp.reconstruction.multiplexRate;
  const holdPattern=new Float32Array([.125,.5,-.25,.75]);
  const held=dsp.renderPcm(holdPattern,{tune:center,outputRate:muxRate,outputMode:"raw"});
  assert(held.length===holdPattern.length*8,"multiplex-rate render must expose eight DAC slots per held sample");
  for(let frame=0;frame<holdPattern.length;frame++){
    for(let slot=0;slot<8;slot++){
      assert(held[frame*8+slot]===holdPattern[frame],`sample/hold changed inside frame ${frame}, slot ${slot}`);
    }
  }
  const heldFiltered=dsp.renderPcm(holdPattern,{tune:center,outputRate:muxRate,outputMode:"filter"});
  let filterMovesInsideHold=false;
  for(let slot=1;slot<8;slot++){
    if(Math.abs(heldFiltered[slot]-heldFiltered[slot-1])>1e-8){
      filterMovesInsideHold=true;
      break;
    }
  }
  assert(filterMovesInsideHold,"SP output filter must run after DAC/sample-hold reconstruction");

  const low=sine(rate,rate,1000,.4);
  const lowRaw=dsp.renderPcm(low,{tune:center,outputRate:rate,outputMode:"raw"});
  const lowFiltered=dsp.renderPcm(low,{tune:center,outputRate:rate,outputMode:"filter"});
  const lowDelta=dbRatio(rms(lowFiltered,500),rms(lowRaw,500));
  assert(Math.abs(lowDelta)<.15,`SP FILTER must keep 1 kHz essentially flat, got ${lowDelta.toFixed(2)} dB`);

  const high=sine(rate,rate,10500,.4);
  const highRaw=dsp.renderPcm(high,{tune:center,outputRate:rate,outputMode:"raw"});
  const highFiltered=dsp.renderPcm(high,{tune:center,outputRate:rate,outputMode:"filter"});
  const highDelta=dbRatio(rms(highFiltered,500),rms(highRaw,500));
  assert(highDelta<-12,`SP FILTER must strongly attenuate 10.5 kHz, got ${highDelta.toFixed(2)} dB`);

  let rejected=false;
  try{
    dsp.renderPcm(pattern,{tune:center,outputRate:rate,outputMode:"ssm2044-exact"});
  }catch(error){
    rejected=/output mode/.test(String(error?.message||error));
  }
  assert(rejected,"unknown or falsely exact SP output modes must be rejected");

  const adapter=fs.readFileSync(adapterPath,"utf8");
  assert(adapter.includes('let outputMode="raw"'),"Chopper must default SP playback to RAW");
  assert(adapter.includes("outputMode:renderOutputMode"),"SP PLAY/SAVE must render the snapshotted output profile");
  assert(adapter.includes("outputMode:requestOutputMode"),"SP PAD audition must render the snapshotted output profile");
  assert(adapter.includes('button.id="sp1200FilterToggle"'),"Chopper must expose the compact FILTER control");
  assert(adapter.includes("setOutputMode"),"Chopper must expose programmatic RAW/FILTER switching");
  assert(adapter.includes("output:outputMode"),"SP settings must report the audible output profile");
  assert(!adapter.includes("createBiquadFilter"),"SP output filtering must remain DSP-owned, not Chopper UI wiring");

  console.log(`OK: SP1200 output — mux8 DAC/S&H ZOH preserved, FILTER 3/4 ${highDelta.toFixed(1)} dB @ 10.5 kHz`);
}

try{
  main();
}catch(error){
  console.error(error?.stack||error);
  process.exit(1);
}