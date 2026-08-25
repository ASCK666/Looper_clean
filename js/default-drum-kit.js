"use strict";

(() => {
  if(globalThis.LooperDefaultDrumKit?.version>=3)return;

  const KIT_NAME="SP1200 BOOM BAP DEFAULT";
  const KIT_VERSION=3;
  const ASSETS=Object.freeze({
    kick:Object.freeze({
      url:"./assets/drums/default/kick.wav",
      name:"BB_SP1200_KICK_01_Dusty",
      compensationDb:0
    }),
    snare:Object.freeze({
      url:"./assets/drums/default/snare.wav",
      name:"BB_SP1200_SNARE_01_Dusty",
      compensationDb:0
    }),
    hat:Object.freeze({
      url:"./assets/drums/default/hat.wav",
      name:"BB_SP1200_HAT_01_Tight",
      compensationDb:0
    })
  });

  const embeddedBufferCompensation=new WeakMap();
  const embeddedLoads=new Map();

  async function decodeUserDrum(kind,file){
    const key=`${kind}:${file.name}:${file.size}:${file.lastModified}`;
    if(!drumDecodeCache.has(key)){
      drumDecodeCache.set(key,await decodeFile(file));
      if(drumDecodeCache.size>24){
        const first=drumDecodeCache.keys().next().value;
        drumDecodeCache.delete(first);
      }
    }
    return {buffer:drumDecodeCache.get(key),name:file.name};
  }

  async function loadEmbeddedDrum(kind){
    const spec=ASSETS[kind];
    if(!spec)throw new Error(`Unknown default drum kind: ${kind}`);

    if(!embeddedLoads.has(kind)){
      embeddedLoads.set(kind,(async()=>{
        const response=await fetch(spec.url,{cache:"no-store"});
        if(!response.ok){
          throw new Error(`${kind.toUpperCase()} default asset HTTP ${response.status}`);
        }
        const bytes=await response.arrayBuffer();
        const buffer=await ctx.decodeAudioData(bytes.slice(0));
        embeddedBufferCompensation.set(buffer,spec.compensationDb);
        return {buffer,name:spec.name};
      })());
    }

    return embeddedLoads.get(kind);
  }

  if(typeof loadSelectedDrum!=="function" ||
     typeof randomAudioFileFromDirectory!=="function"){
    console.warn("Default SP1200 drum kit: drum engine unavailable");
    return;
  }

  loadSelectedDrum=async function(kind,rate,excludeName=null){
    const file=await randomAudioFileFromDirectory(kind,excludeName);
    if(file)return await decodeUserDrum(kind,file);

    try{
      return await loadEmbeddedDrum(kind);
    }catch(error){
      globalThis.__SP?.report?.("DEFAULT DRUM KIT",error);
      throw error;
    }
  };

  if(typeof drumAutoGain==="function"){
    const baseDrumAutoGain=drumAutoGain;
    drumAutoGain=function(kind,buffer){
      const baseGain=baseDrumAutoGain(kind,buffer);
      const compensationDb=embeddedBufferCompensation.get(buffer)||0;
      return baseGain*Math.pow(10,compensationDb/20);
    };
  }

  globalThis.LooperDefaultDrumKit=Object.freeze({
    installed:true,
    name:KIT_NAME,
    version:KIT_VERSION,
    source:"bundled-sp1200-boom-bap-wav",
    priority:"user-library > embedded-sp1200-pack",
    syntheticFallback:false,
    dry:true,
    snareReverbReady:true,
    gainCompensationDb:Object.freeze({kick:0,snare:0,hat:0}),
    assets:Object.freeze({
      kick:ASSETS.kick.url,
      snare:ASSETS.snare.url,
      hat:ASSETS.hat.url
    })
  });
})();
