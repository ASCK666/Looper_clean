"use strict";

// looper-next feature loader. The maintained bootstrap still loads this path;
// the slice editor and long-sample banks live in focused Chopper feature files,
// followed by the folder reconnect fix and the optional SP playback engine.
(() => {
  const DEFAULT_SAMPLE_URL="./assets/Le%20altre%2010.mp3";
  const DEFAULT_SAMPLE_NAME="Le altre 10.mp3";
  let defaultSampleCancelled=false;
  let defaultSampleRequested=false;

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
    if(!globalThis.ChopperBanks){
      await loadScript("./js/chopper-banks.js","chopperBanks","CHOPPER BANKS");
    }
    if(!globalThis.ChopperFolderReconnect){
      await loadScript("./js/chopper-folder-reconnect.js","chopperFolderReconnect","CHOPPER FOLDER RECONNECT");
    }
    if(!globalThis.SP1200DSP){
      await loadScript("./js/sp1200.js","sp1200","SP1200");
    }

    loadDefaultSampleOnChopperOpen();
  }

  void boot().catch(error=>{
    if(globalThis.__SP?.report)globalThis.__SP.report("CHOPPER FEATURES",error);
    else console.error("Chopper feature loader:",error);
  });
})();