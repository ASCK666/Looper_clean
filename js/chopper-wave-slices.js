"use strict";

// looper-next feature loader. The maintained bootstrap still loads this path;
// focused Chopper features are loaded in dependency order. SP is split into a
// pure DSP engine followed by the Chopper-owned product adapter.
(() => {
  const DEFAULT_SAMPLE_URL="./assets/Le%20altre%2010.mp3";
  const DEFAULT_SAMPLE_NAME="Le altre 10.mp3";
  const WAVE_PEAK_BASE_BUCKET=16;
  let defaultSampleCancelled=false;
  let defaultSampleRequested=false;

  function installWaveformPerf(){
    if(typeof drawBufferRange!=="function" || typeof drawWave!=="function")return;
    if(globalThis.ChopperWavePerf?.installed)return;

    const peakCache=new WeakMap();
    const originalDrawBufferRange=drawBufferRange;
    const drawWaveImmediate=drawWave;
    const waveCanvas=document.getElementById("waveCanvas");
    let pointerMoveDraw=false;
    let scheduledFrame=0;
    let scheduledArgs=null;

    function buildPeakPyramid(buffer){
      const data=buffer?.getChannelData?.(0);
      if(!data?.length)return null;

      const bucketCount=Math.ceil(data.length/WAVE_PEAK_BASE_BUCKET);
      const mins=new Float32Array(bucketCount);
      const maxs=new Float32Array(bucketCount);

      for(let bucket=0;bucket<bucketCount;bucket++){
        const start=bucket*WAVE_PEAK_BASE_BUCKET;
        const end=Math.min(data.length,start+WAVE_PEAK_BASE_BUCKET);
        let min=1,max=-1;
        for(let i=start;i<end;i++){
          const value=data[i];
          if(value<min)min=value;
          if(value>max)max=value;
        }
        mins[bucket]=min;
        maxs[bucket]=max;
      }

      const levels=[{bucketSize:WAVE_PEAK_BASE_BUCKET,mins,maxs}];
      let previous=levels[0];
      while(previous.mins.length>1){
        const nextLength=Math.ceil(previous.mins.length/2);
        const nextMins=new Float32Array(nextLength);
        const nextMaxs=new Float32Array(nextLength);
        for(let i=0;i<nextLength;i++){
          const a=i*2;
          const b=a+1;
          nextMins[i]=b<previous.mins.length
            ? Math.min(previous.mins[a],previous.mins[b])
            : previous.mins[a];
          nextMaxs[i]=b<previous.maxs.length
            ? Math.max(previous.maxs[a],previous.maxs[b])
            : previous.maxs[a];
        }
        previous={
          bucketSize:previous.bucketSize*2,
          mins:nextMins,
          maxs:nextMaxs
        };
        levels.push(previous);
      }

      return {length:data.length,levels};
    }

    function cachedPeaks(buffer){
      let cached=peakCache.get(buffer);
      if(cached)return cached;
      cached=buildPeakPyramid(buffer);
      if(cached)peakCache.set(buffer,cached);
      return cached;
    }

    drawBufferRange=function(context,buffer,startSec,endSec,x,width,height){
      if(!buffer || width<=0 || height<=0)return;
      const data=buffer.getChannelData(0);
      const sr=buffer.sampleRate;
      const first=clamp(Math.floor(startSec*sr),0,data.length);
      const last=clamp(Math.ceil(endSec*sr),first,data.length);
      const samples=last-first;
      const columns=Math.max(1,Math.floor(width));
      if(samples<=0)return;

      const samplesPerColumn=samples/columns;
      if(samplesPerColumn<WAVE_PEAK_BASE_BUCKET){
        return originalDrawBufferRange(context,buffer,startSec,endSec,x,width,height);
      }

      const cached=cachedPeaks(buffer);
      if(!cached)return originalDrawBufferRange(context,buffer,startSec,endSec,x,width,height);

      let level=cached.levels[0];
      const targetBucketSize=Math.max(
        WAVE_PEAK_BASE_BUCKET,
        samplesPerColumn/16
      );
      for(const candidate of cached.levels){
        if(candidate.bucketSize>targetBucketSize)break;
        level=candidate;
      }

      context.beginPath();
      for(let px=0;px<columns;px++){
        const columnStart=first+Math.floor(samples*px/columns);
        const columnEnd=Math.min(last,first+Math.ceil(samples*(px+1)/columns));
        const firstFullBucket=Math.ceil(columnStart/level.bucketSize);
        const lastFullBucketExclusive=Math.floor(columnEnd/level.bucketSize);
        const headEnd=Math.min(columnEnd,firstFullBucket*level.bucketSize);
        let min=1,max=-1;

        for(let i=columnStart;i<headEnd;i++){
          const value=data[i];
          if(value<min)min=value;
          if(value>max)max=value;
        }

        for(let bucket=firstFullBucket;bucket<lastFullBucketExclusive;bucket++){
          if(level.mins[bucket]<min)min=level.mins[bucket];
          if(level.maxs[bucket]>max)max=level.maxs[bucket];
        }

        const tailStart=Math.max(headEnd,lastFullBucketExclusive*level.bucketSize);
        for(let i=tailStart;i<columnEnd;i++){
          const value=data[i];
          if(value<min)min=value;
          if(value>max)max=value;
        }

        const y1=(1-max)*height/2;
        const y2=(1-min)*height/2;
        context.moveTo(x+px,y1);
        context.lineTo(x+px,y2);
      }
      context.stroke();
    };

    if(waveCanvas){
      document.addEventListener("pointermove",event=>{
        if(event.target!==waveCanvas)return;
        pointerMoveDraw=true;
        queueMicrotask(()=>{pointerMoveDraw=false;});
      },true);
    }

    drawWave=function(...args){
      if(!pointerMoveDraw)return drawWaveImmediate(...args);

      scheduledArgs=args;
      if(scheduledFrame)return;
      scheduledFrame=requestAnimationFrame(()=>{
        scheduledFrame=0;
        const argsToDraw=scheduledArgs||[];
        scheduledArgs=null;
        drawWaveImmediate(...argsToDraw);
      });
    };

    globalThis.ChopperWavePerf=Object.freeze({
      installed:true,
      baseBucketSamples:WAVE_PEAK_BASE_BUCKET
    });
  }

  function loadScript(src,dataKey,scope){
    const selector=`script[data-${dataKey.replace(/[A-Z]/g,m=>`-${m.toLowerCase()}`)}="1"]`;
    const existing=document.querySelector(selector);
    if(existing){
      if(existing.dataset.loaded==="1")return Promise.resolve();
      return new Promise((resolve,reject)=>{
        existing.addEventListener("load",resolve,{once:true});
        existing.addEventListener("error",()=>reject(new Error(`${scope} failed to load`)),{once:true});
      });
    }

    return new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src=src;
      script.dataset[dataKey]="1";
      script.onload=()=>{script.dataset.loaded="1";resolve();};
      script.onerror=()=>reject(new Error(`${scope} failed to load`));
      document.body.appendChild(script);
    });
  }

  async function loadDefaultSample(){
    if(defaultSampleCancelled || sampleBuffer || typeof loadChopperSample!=="function")return;

    try{
      const response=await fetch(DEFAULT_SAMPLE_URL);
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const blob=await response.blob();
      if(defaultSampleCancelled || sampleBuffer)return;

      const file=new File([blob],DEFAULT_SAMPLE_NAME,{type:blob.type||"audio/mpeg"});
      await loadChopperSample(file);
    }catch(error){
      console.error("Default Chopper sample:",error);
      const status=document.getElementById("chopStatus");
      if(status && !sampleBuffer){
        const message=typeof safeErrorMessage==="function"
          ? safeErrorMessage(error)
          : (error?.message||String(error));
        status.textContent=`DEFAULT SAMPLE ERROR • ${message}`;
      }
    }
  }

  function requestDefaultSample(){
    if(defaultSampleRequested)return;
    defaultSampleRequested=true;
    void loadDefaultSample();
  }

  function loadDefaultSampleOnChopperOpen(){
    const chopper=document.getElementById("chopper");
    if(chopper?.classList.contains("active")){
      requestDefaultSample();
      return;
    }
    document.querySelector('[data-tab="chopper"]')
      ?.addEventListener("click",requestDefaultSample,{once:true});
  }

  async function boot(){
    const sampleInput=document.getElementById("sampleFile");
    sampleInput?.addEventListener("change",()=>{defaultSampleCancelled=true;},{once:true});

    if(!globalThis.ChopperWaveSlices){
      await loadScript("./js/chopper-wave-slices-core.js","chopperWaveSlicesCore","CHOPPER WAVE SLICES CORE");
    }
    installWaveformPerf();
    if(!globalThis.ChopperMobileControls){
      await loadScript("./js/chopper-mobile-controls.js","chopperMobileControls","CHOPPER MOBILE CONTROLS");
    }
    if(!globalThis.ChopperMobileSliceEditor){
      await loadScript("./js/chopper-mobile-slice-editor.js","chopperMobileSliceEditor","CHOPPER MOBILE SLICE EDITOR");
    }
    if(!globalThis.ChopperBanks){
      await loadScript("./js/chopper-banks.js","chopperBanks","CHOPPER BANKS");
    }
    if(!globalThis.ChopperFolderReconnect){
      await loadScript("./js/chopper-folder-reconnect.js","chopperFolderReconnect","CHOPPER FOLDER RECONNECT");
    }
    if(!globalThis.SP1200DSP){
      await loadScript("./js/sp1200.js","sp1200","SP1200 DSP");
    }
    if(!globalThis.ChopperSP1200){
      await loadScript("./js/chopper-sp1200.js","chopperSp1200","CHOPPER SP1200");
    }

    loadDefaultSampleOnChopperOpen();
  }

  void boot().catch(error=>{
    if(globalThis.__SP?.report)globalThis.__SP.report("CHOPPER FEATURES",error);
    else console.error("Chopper feature loader:",error);
  });
})();