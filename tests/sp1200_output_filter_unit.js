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

function profileDelta(dsp,tune,frequency,outputRate,mode){
  const inputRate=dsp.sampleRate;
  const source=sine(inputRate*2,inputRate,frequency,.4);
  const raw=dsp.renderPcm(source,{tune,outputRate,outputMode:"raw"});
  const filtered=dsp.renderPcm(source,{tune,outputRate,outputMode:mode});
  const skip=Math.ceil(outputRate*.05);
  return dbRatio(rms(filtered,skip),rms(raw,skip));
}

function main(){
  const runtime=fs.readFileSync(runtimePath,"utf8");
  vm.runInThisContext(runtime,{filename:runtimePath});
  const dsp=globalThis.SP1200DSP;
  assert(dsp,"SP1200DSP global missing");
  assert(Array.isArray(dsp.outputModes) && dsp.outputModes.join(",")==="raw,filter,filter56","SP output modes must expose RAW, fixed 3/4 and fixed 5/6 only");

  assert(dsp.outputFilter?.model==="fixed34-cheb5-derived-v2","SP 3/4 filter profile must identify the derived Chebyshev revision");
  assert(dsp.outputFilter?.family==="chebyshev1-derived","SP 3/4 profile must use a derived Chebyshev type-I family");
  assert(dsp.outputFilter?.hardwarePair==="3-4","SP 3/4 profile must identify its hardware pair");
  assert(dsp.outputFilter?.cutoffHz===9000,"SP fixed 3/4 cutoff must keep the conservative 9 kHz calibration point");
  assert(dsp.outputFilter?.order===5,"SP fixed 3/4 filter must model the documented five-pole topology");
  assert(dsp.outputFilter?.rippleDb===1,"SP fixed 3/4 filter must model the documented 1 dB passband ripple");
  assert(dsp.outputFilter?.makeupGainDb===0,"SP 3/4 output filter must not add loudness makeup");
  assert(dsp.outputFilter?.exactCircuit===false,"SP fixed 3/4 filter must remain explicitly derived, not exact-circuit");

  assert(dsp.outputFilter56?.model==="fixed56-cheb5-derived-v1","SP 5/6 filter profile must identify its derived revision");
  assert(dsp.outputFilter56?.family==="chebyshev1-derived","SP 5/6 profile must use the same documented derived filter family");
  assert(dsp.outputFilter56?.hardwarePair==="5-6","SP 5/6 profile must identify its hardware pair");
  assert(dsp.outputFilter56?.cutoffHz===10000,"SP fixed 5/6 cutoff must use the conservative 10 kHz derived calibration point");
  assert(dsp.outputFilter56?.order===5,"SP fixed 5/6 filter must model the documented five-pole topology");
  assert(dsp.outputFilter56?.rippleDb===1,"SP fixed 5/6 filter must model the documented 1 dB passband ripple");
  assert(dsp.outputFilter56?.makeupGainDb===0,"SP 5/6 output filter must not add loudness makeup");
  assert(dsp.outputFilter56?.exactCircuit===false,"SP fixed 5/6 filter must remain explicitly derived, not exact-circuit");

  assert(dsp.reconstruction?.model==="mux8-sh-zoh-v1","SP reconstruction model marker missing");
  assert(dsp.reconstruction?.sharedDac===true,"SP reconstruction must expose the shared DAC topology");
  assert(dsp.reconstruction?.dacBits===12,"SP reconstruction DAC must remain 12-bit");
  assert(dsp.reconstruction?.multiplexChannels===8,"SP reconstruction must model eight multiplexed channels");
  assert(dsp.reconstruction?.multiplexRate===208320,"SP DAC multiplex clock must be 8 x 26.04 kHz");
  assert(dsp.reconstruction?.holdRate===26040,"each SP sample/hold must refresh at 26.04 kHz");
  assert(dsp.reconstruction?.holdModel==="ideal-zoh-v1","SP sample/hold must stay an ideal ZOH");
  assert(dsp.reconstruction?.droopMode==="not-modeled","SP must not invent unmeasured sample/hold droop");
  assert(dsp.reconstruction?.crosstalkMode==="not-modeled","SP must not invent unmeasured multiplex crosstalk");

  const rate=dsp.sampleRate;
  const center=dsp.resolveTune(0);
  const pattern=new Float32Array([0,.25,-.5,.75,-1,.5,-.25,.125]);
  const raw=dsp.renderPcm(pattern,{tune:center,outputRate:rate,outputMode:"raw"});
  assert(raw.length===pattern.length,"RAW output length must be unchanged at the SP reconstruction rate");
  for(let i=0;i<pattern.length;i++){
    assert(raw[i]===pattern[i],"RAW output must stay bit-for-bit identical to the pre-filter playback path");
  }

  // The fixed filters are downstream of the shared DAC/sample-hold. At the DAC
  // multiplex rate RAW holds each PCM value for exactly eight slots, while either
  // fixed analog profile is free to move between slots only after reconstruction.
  const muxRate=dsp.reconstruction.multiplexRate;
  const holdPattern=new Float32Array([.125,.5,-.25,.75]);
  const held=dsp.renderPcm(holdPattern,{tune:center,outputRate:muxRate,outputMode:"raw"});
  assert(held.length===holdPattern.length*8,"multiplex-rate render must expose eight DAC slots per held sample");
  for(let frame=0;frame<holdPattern.length;frame++){
    for(let slot=0;slot<8;slot++){
      assert(held[frame*8+slot]===holdPattern[frame],`sample/hold changed inside frame ${frame}, slot ${slot}`);
    }
  }
  for(const mode of ["filter","filter56"]){
    const fixed=dsp.renderPcm(holdPattern,{tune:center,outputRate:muxRate,outputMode:mode});
    let movesInsideHold=false;
    for(let slot=1;slot<8;slot++){
      if(Math.abs(fixed[slot]-fixed[slot-1])>1e-8){
        movesInsideHold=true;
        break;
      }
    }
    assert(movesInsideHold,`SP ${mode} profile must run after DAC/sample-hold reconstruction`);
  }

  // Each profile's derived passband edge must remain approximately -1 dB when
  // reconstructed at the native SP grid and at both common live Web Audio rates.
  // Comparing against RAW at the same rate isolates the analog-profile response
  // from the intentional ZOH reconstruction response.
  const rates=[26040,44100,48000];
  const measured=[];
  for(const outputRate of rates){
    const edge34=profileDelta(dsp,center,9000,outputRate,"filter");
    const edge56=profileDelta(dsp,center,10000,outputRate,"filter56");
    assert(edge34<-.75 && edge34>-1.25,`SP 3/4 edge must stay near -1 dB at 9 kHz / ${outputRate} Hz, got ${edge34.toFixed(2)} dB`);
    assert(edge56<-.75 && edge56>-1.25,`SP 5/6 edge must stay near -1 dB at 10 kHz / ${outputRate} Hz, got ${edge56.toFixed(2)} dB`);

    const high34=profileDelta(dsp,center,10500,outputRate,"filter");
    const high56=profileDelta(dsp,center,10500,outputRate,"filter56");
    assert(high34<high56-8,`SP 3/4 must remain materially darker than 5/6 at 10.5 kHz / ${outputRate} Hz (${high34.toFixed(2)} vs ${high56.toFixed(2)} dB)`);
    measured.push({outputRate,edge34,edge56,high34,high56});
  }

  const low34=profileDelta(dsp,center,1000,48000,"filter");
  const low56=profileDelta(dsp,center,1000,48000,"filter56");
  assert(low34<=.05 && low34>-1.1,`SP 3/4 1 kHz must stay inside the 1 dB passband, got ${low34.toFixed(2)} dB`);
  assert(low56<=.05 && low56>-1.1,`SP 5/6 1 kHz must stay inside the 1 dB passband, got ${low56.toFixed(2)} dB`);

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
  assert(adapter.includes('filterButton.id="sp1200FilterToggle"'),"Chopper must keep one compact output-profile control");
  assert(adapter.includes("DSP.outputModes[(index+1)%DSP.outputModes.length]"),"SP output control must cycle the DSP-owned RAW/3-4/5-6 modes");
  assert(adapter.includes('if(outputMode==="filter56")return "FILTER 5/6"'),"SP status must distinguish the 5/6 fixed pair");
  assert(adapter.includes('outputFilter:outputMode==="filter56"?DSP.outputFilter56:outputMode==="filter"?DSP.outputFilter:null'),"SP settings must report the selected fixed-pair metadata");
  assert(!adapter.includes("createBiquadFilter"),"SP output filtering must remain DSP-owned, not Chopper UI wiring");

  const last=measured[measured.length-1];
  console.log(`OK: SP1200 output — RAW preserved, fixed 3/4 ${last.edge34.toFixed(1)} dB @ 9 kHz and 5/6 ${last.edge56.toFixed(1)} dB @ 10 kHz at 48 kHz reconstruction`);
}

try{
  main();
}catch(error){
  console.error(error?.stack||error);
  process.exit(1);
}
