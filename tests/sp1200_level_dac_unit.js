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

function nearly(a,b,tolerance=1e-7){
  return Math.abs(a-b)<=tolerance;
}

function main(){
  const runtime=fs.readFileSync(runtimePath,"utf8");
  vm.runInThisContext(runtime,{filename:runtimePath});
  const dsp=globalThis.SP1200DSP;
  assert(dsp,"SP1200DSP global missing");

  assert(dsp.levelDac?.model==="ad7524-ideal-transfer-v1","SP playback level must expose the AD7524 ideal-transfer model");
  assert(dsp.levelDac?.bits===8,"SP multiplying level DAC must be 8-bit");
  assert(dsp.levelDac?.maxCode===255,"SP level DAC max code must be 255");
  assert(dsp.levelDac?.denominator===256,"AD7524 unipolar transfer must use code/256");
  assert(nearly(dsp.levelDac?.fullScaleGain,255/256,1e-12),"SP level DAC full scale must be 255/256");
  assert(dsp.levelDac?.placement==="post-12bit-dac-pre-demux","SP level DAC must sit after the audio DAC and before demux/sample-hold");
  assert(dsp.levelDac?.analogNonlinearity==="not-modeled","SP V1 must not invent unmeasured MDAC nonlinearity");

  const bypass=dsp.resolveLevelCode();
  const zero=dsp.resolveLevelCode(0);
  const half=dsp.resolveLevelCode(128);
  const full=dsp.resolveLevelCode(255);
  assert(bypass.bypass===true && bypass.gain===1,"omitted level code must be an explicit DSP-isolation bypass");
  assert(zero.code===0 && zero.gain===0,"level code 0 must mute");
  assert(half.code===128 && half.gain===.5,"level code 128 must equal one half");
  assert(full.code===255 && nearly(full.gain,255/256,1e-12),"level code 255 transfer mismatch");

  for(const invalid of [-1,256,1.5,NaN]){
    let rejected=false;
    try{dsp.resolveLevelCode(invalid);}catch(error){
      rejected=/level code/.test(String(error?.message||error));
    }
    assert(rejected,`invalid SP level code ${String(invalid)} must be rejected`);
  }

  const center=dsp.resolveTune(0);
  const pattern=new Float32Array([1,-1,.5,-.25,.125]);
  const isolated=dsp.renderPcm(pattern,{tune:center,outputRate:26040,outputMode:"raw"});
  const halfRendered=dsp.renderPcm(pattern,{tune:center,levelCode:128,outputRate:26040,outputMode:"raw"});
  const fullRendered=dsp.renderPcm(pattern,{tune:center,levelCode:255,outputRate:26040,outputMode:"raw"});
  const muted=dsp.renderPcm(pattern,{tune:center,levelCode:0,outputRate:26040,outputMode:"raw"});

  for(let i=0;i<pattern.length;i++){
    assert(isolated[i]===pattern[i],"level-DAC bypass must preserve isolated pitch/reconstruction tests");
    assert(nearly(halfRendered[i],pattern[i]*.5),"code 128 must multiply the 12-bit DAC output by one half");
    assert(nearly(fullRendered[i],pattern[i]*(255/256)),"code 255 must use the ideal AD7524 255/256 transfer");
    assert(muted[i]===0,"code 0 must mute every held sample");
  }

  // The level DAC must be part of reconstruction, not a post-filter volume gain.
  // At the 8x multiplex clock every held slot must already contain the multiplied
  // value before the optional analog output filter is allowed to evolve.
  const muxRate=dsp.reconstruction.multiplexRate;
  const held=dsp.renderPcm(new Float32Array([.8,.4]),{
    tune:center,
    levelCode:128,
    outputRate:muxRate,
    outputMode:"raw"
  });
  assert(held.length===16,"two SP samples must expose sixteen multiplex slots");
  for(let slot=0;slot<8;slot++)assert(nearly(held[slot],.4),"first held frame must include 8-bit level multiplication before S/H");
  for(let slot=8;slot<16;slot++)assert(nearly(held[slot],.2),"second held frame must include 8-bit level multiplication before S/H");

  const adapter=fs.readFileSync(adapterPath,"utf8");
  assert(adapter.includes("function levelCodeForSampleVolume()"),"Chopper must translate SAMPLE VOL to a hardware level code");
  assert(adapter.includes("Math.round(sampleVolumeGain()*denominator)"),"Chopper volume must quantize to the nearest code/256 transfer");
  assert(adapter.includes("levelCode:renderLevelCode"),"SP PLAY/SAVE must use the snapshotted 8-bit level code");
  assert(adapter.includes("levelCode:requestLevelCode"),"SP PAD audition must use the snapshotted 8-bit level code");
  assert(adapter.includes("const conditionerGain=.72*(slices?1:sampleAutoMixGain(sourceBuffer));"),"SP sequence must not apply SAMPLE VOL twice after the level DAC");
  assert(adapter.includes("makeSampleConditioner(ctx,previewOutput,1)"),"SP PAD must not apply continuous SAMPLE VOL again after the level DAC");
  assert(adapter.includes("chopAuditionGain=null"),"SP PAD must not expose the clean continuous volume gain after quantized rendering");

  console.log("OK: SP1200 level — 8-bit AD7524 transfer, pre-S/H placement, Chopper SAMPLE VOL quantized once");
}

try{
  main();
}catch(error){
  console.error(error?.stack||error);
  process.exit(1);
}
