"use strict";

(() => {
  if(globalThis.LooperDefaultDrumKit?.version>=2)return;

  const KIT_NAME="LOOPER BOOM BAP 90 V2";
  const KIT_VERSION=2;
  const ASSETS=Object.freeze({
    kick:Object.freeze({
      url:"./assets/drums/default/kick.wav",
      name:"LOOPER_BB90_V2_KICK",
      compensationDb:1.5
    }),
    snare:Object.freeze({
      url:"./assets/drums/default/snare.wav",
      name:"LOOPER_BB90_V2_SNARE",
      compensationDb:2.0
    }),
    hat:Object.freeze({
      url:"./assets/drums/default/hat.wav",
      name:"LOOPER_BB90_V2_HAT",
      compensationDb:4.0
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
    if(!spec)return null;

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
     typeof randomAudioFileFromDirectory!=="function" ||
     typeof makeSynthBuffer!=="function"){
    console.warn("Default drum kit v2: drum engine unavailable");
    return;
  }

  loadSelectedDrum=async function(kind,rate,excludeName=null){
    const file=await randomAudioFileFromDirectory(kind,excludeName);
    if(file)return await decodeUserDrum(kind,file);

    try{
      const embedded=await loadEmbeddedDrum(kind);
      if(embedded)return embedded;
    }catch(error){
      console.warn(`Default ${kind} one-shot unavailable; using synth fallback`,error);
    }

    return {
      buffer:makeSynthBuffer(kind,rate),
      name:`SYNTH-${Math.floor(performance.now())}-${randomIndex(999)}`
    };
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
    source:"bundled-wav-one-shots",
    priority:"user-library > embedded-default > synth-fallback",
    dry:true,
    snareReverbReady:true,
    gainCompensationDb:Object.freeze({kick:1.5,snare:2.0,hat:4.0}),
    assets:Object.freeze({
      kick:ASSETS.kick.url,
      snare:ASSETS.snare.url,
      hat:ASSETS.hat.url
    })
  });
})();
