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

function mockAudioContext(sampleRate=48000){
  return {
    sampleRate,
    createBuffer(channels,length,rate){
      const data=Array.from({length:channels},()=>new Float32Array(length));
      return {
        numberOfChannels:channels,
        length,
        sampleRate:rate,
        duration:length/rate,
        getChannelData(channel){return data[channel];}
      };
    }
  };
}

async function main(){
  const runtime=fs.readFileSync(runtimePath,"utf8");
  vm.runInThisContext(runtime,{filename:runtimePath});
  const dsp=globalThis.SP1200DSP;

  assert(dsp,"SP1200DSP global missing");
  assert(dsp.sampleRate===26040,"SP sample rate must be exactly 26040 Hz");
  assert(dsp.bitDepth===12,"SP bit depth must be 12");
  assert(dsp.pcmStorage==="int16","stored SP PCM must use compact Int16 storage");
  assert(dsp.maxCacheEntries<=8,"SP PCM cache must stay small on mobile");
  assert(typeof dsp.encodeBuffer==="function" && typeof dsp.encodeBufferAsync==="function","encode contract missing");
  assert(typeof dsp.renderEncodedSegment==="function","encoded playback contract missing");
  assert(typeof dsp.renderSegment==="undefined","playback must not accept a source AudioBuffer");
  assert(typeof dsp.renderSegmentAsync==="undefined","async mixed encode/playback helper must stay removed");
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

  const subrange=dsp.renderPcm(encodedPattern,{semitones:0,outputRate:26040,startFrame:2,endFrame:6});
  assert(subrange.length===4,"a chop must read a subrange of one stored SP PCM");
  assert(subrange[0]===pattern[2] && subrange[3]===pattern[5],"stored SP PCM subrange boundaries incorrect");

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
  assert(dsp.encodeBuffer(mockBuffer)===encoded,"same working range must reuse the stored SP PCM cache");
  assert(encoded.data instanceof Int16Array,"encoded PCM must be stored as Int16 codes");
  assert(Math.abs(encoded.data.length-26040)<=2,"one second must encode to about 26040 SP frames");
  assert(encoded.sampleRate===26040 && encoded.bitDepth===12,"encoded metadata mismatch");
  assert(encoded.data.byteLength===encoded.data.length*2,"SP PCM storage must use two bytes per frame");
  for(let i=0;i<encoded.data.length;i+=Math.max(1,Math.floor(encoded.data.length/257))){
    const code=encoded.data[i];
    assert(code>=-2048 && code<=2047,"encoded PCM code must stay inside signed 12-bit range");
  }

  const rendered=dsp.renderEncodedSegment(mockAudioContext(),encoded,{
    startSec:.2,
    endSec:.4,
    semitones:-12
  });
  assert(rendered.numberOfChannels===1,"encoded playback must render mono");
  assert(rendered.sampleRate===48000,"encoded playback must target the audio context rate");
  assert(.39<rendered.duration && rendered.duration<.41,"-12 st encoded segment duration mismatch");

  let rejected=false;
  try{
    dsp.renderEncodedSegment(mockAudioContext(),mockBuffer,{startSec:0,endSec:.1});
  }catch(error){
    rejected=/encoded PCM/.test(String(error?.message||error));
  }
  assert(rejected,"playback must reject an unencoded source AudioBuffer");

  dsp.clearCache(mockBuffer);
  const first=dsp.encodeBuffer(mockBuffer,{startSec:0,endSec:.08});
  for(let i=1;i<=dsp.maxCacheEntries;i++){
    const start=i*.1;
    dsp.encodeBuffer(mockBuffer,{startSec:start,endSec:Math.min(1,start+.08)});
  }
  const firstAfterPressure=dsp.encodeBuffer(mockBuffer,{startSec:0,endSec:.08});
  assert(firstAfterPressure!==first,"oldest SP PCM cache entry must be evicted when cache is full");

  dsp.clearCache(mockBuffer);
  const asyncEncoded=await dsp.encodeBufferAsync(mockBuffer,{startSec:.1,endSec:.9});
  assert(asyncEncoded.data instanceof Int16Array,"async encoder must also produce compact Int16 PCM");
  assert(
    dsp.encodeBuffer(mockBuffer,{startSec:.1,endSec:.9})===asyncEncoded,
    "async encoder result must populate the same bounded cache"
  );

  const loader=fs.readFileSync(loaderPath,"utf8");
  assert(loader.includes("./js/sp1200.js"),"Chopper feature loader must load sp1200.js");
  assert(loader.includes("SP1200DSP"),"Chopper feature loader must guard SP1200DSP");

  const runtimeSource=fs.readFileSync(runtimePath,"utf8");
  assert(!runtimeSource.includes("DSP.renderSegmentAsync"),"browser integration must not use mixed encode/playback helpers");
  assert(runtimeSource.includes("DSP.encodeBufferAsync"),"browser integration must explicitly encode source audio");
  assert(runtimeSource.includes("DSP.renderEncodedSegment"),"browser integration must explicitly render encoded PCM");

  console.log("OK: SP1200 DSP — strict encode/playback boundary, compact PCM, bounded cache and skip/repeat pitch");
}

main().catch(error=>{
  console.error(error?.stack||error);
  process.exit(1);
});