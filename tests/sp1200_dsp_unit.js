"use strict";

const fs=require("fs");
const path=require("path");
const vm=require("vm");

const ROOT=path.resolve(__dirname,"..");
const runtimePath=path.join(ROOT,"js","sp1200.js");
const loaderPath=path.join(ROOT,"js","chopper-wave-slices.js");

function assert(condition,message){
  if(!condition)throw new Error(message);
}

const runtime=fs.readFileSync(runtimePath,"utf8");
vm.runInThisContext(runtime,{filename:runtimePath});
const dsp=globalThis.SP1200DSP;

assert(dsp,"SP1200DSP global missing");
assert(dsp.sampleRate===26040,"SP sample rate must be exactly 26040 Hz");
assert(dsp.bitDepth===12,"SP bit depth must be 12");
assert(dsp.quantize12(0)===0,"zero must quantize to zero");
assert(dsp.quantize12(-1)===-1,"negative full scale must survive");
assert(dsp.quantize12(1)===2047/2048,"positive full scale must clamp to 12-bit code 2047");

const pattern=new Float32Array([0,.125,.25,.375,.5,.625,.75,.875]);
const encodedPattern={data:pattern};
const down=dsp.renderPcm(encodedPattern,{semitones:-12,outputRate:26040});
assert(down.length===16,"-12 st should double duration");
assert(down[0]===pattern[0] && down[1]===pattern[0],"pitch down must duplicate samples");
assert(down[2]===pattern[1] && down[3]===pattern[1],"pitch down duplication pattern incorrect");

const up=dsp.renderPcm(encodedPattern,{semitones:12,outputRate:26040});
assert(up.length===4,"+12 st should halve duration");
assert(up[0]===pattern[0] && up[1]===pattern[2],"pitch up must skip source samples");
assert(up[2]===pattern[4] && up[3]===pattern[6],"pitch up skip pattern incorrect");

const odd=dsp.renderPcm(encodedPattern,{semitones:-5,outputRate:26040});
for(const value of odd){
  assert(pattern.includes(value),"SP pitch stage must not invent interpolated values");
}

const rate=48000;
const length=rate;
const sourceData=new Float32Array(length);
for(let i=0;i<length;i++)sourceData[i]=Math.sin(2*Math.PI*997*i/rate)*.73;
const mockBuffer={
  numberOfChannels:1,
  length,
  sampleRate:rate,
  duration:length/rate,
  getChannelData(channel){
    if(channel!==0)throw new Error("unexpected channel");
    return sourceData;
  }
};
const encoded=dsp.encodeBuffer(mockBuffer);
assert(Math.abs(encoded.data.length-26040)<=2,"one second must encode to about 26040 SP frames");
assert(encoded.sampleRate===26040 && encoded.bitDepth===12,"encoded metadata mismatch");
for(let i=0;i<encoded.data.length;i+=Math.max(1,Math.floor(encoded.data.length/257))){
  const code=encoded.data[i]*2048;
  assert(Math.abs(code-Math.round(code))<1e-6,"encoded PCM must lie on the 12-bit grid");
}

const loader=fs.readFileSync(loaderPath,"utf8");
assert(loader.includes("./js/sp1200.js"),"Chopper feature loader must load sp1200.js");
assert(loader.includes("SP1200DSP"),"Chopper feature loader must guard SP1200DSP");

console.log("OK: SP1200 DSP — 26.04 kHz, 12-bit quantization, skip/repeat pitch, no pitch interpolation");
