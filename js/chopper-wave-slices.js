"use strict";

// looper-next feature loader. The maintained bootstrap still loads this path;
// the actual slice editor lives in chopper-wave-slices-core.js so this loader
// can also install the folder reconnect fix without touching main/base files.
(() => {
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

  async function boot(){
    if(!globalThis.ChopperWaveSlices){
      await loadScript("./js/chopper-wave-slices-core.js","chopperWaveSlicesCore","CHOPPER WAVE SLICES CORE");
    }
    if(!globalThis.ChopperFolderReconnect){
      await loadScript("./js/chopper-folder-reconnect.js","chopperFolderReconnect","CHOPPER FOLDER RECONNECT");
    }
  }

  void boot().catch(error=>{
    if(globalThis.__SP?.report)globalThis.__SP.report("CHOPPER FEATURES",error);
    else console.error("Chopper feature loader:",error);
  });
})();