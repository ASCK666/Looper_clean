"use strict";

(() => {
  if(globalThis.LooperDefaultDrumKit?.version>=2)return;

  const KIT_NAME="LOOPER BOOM BAP 90 V2";
  const KIT_VERSION=2;
  const ASSETS=Object.freeze({
    kick:Object.freeze({
      url:"./assets/drums/default/kick.wav",
      name:"LOOPER_BB90_V2_KICK",
      compensationDb:1.5,
      encoding:"pcm16be",
      sampleRate:44100
    }),
    snare:Object.freeze({
      url:"./assets/drums/default/snare.wav",
      name:"LOOPER_BB90_V2_SNARE",
      compensationDb:2.0,
      encoding:"pcm16be",
      sampleRate:44100
    }),
    hat:Object.freeze({
      url:"./assets/drums/default/hat.wav",
      name:"LOOPER_BB90_V2_HAT",
      compensationDb:4.0,
      encoding:"wav"
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

  function decodePcm16BeMono(bytes,sampleRate){
    if(bytes.byteLength<2 || bytes.byteLength%2!==0){
      throw new Error(`invalid PCM16-BE asset length ${bytes.byteLength}`);
    }
    const frameCount=bytes.byteLength/2;
    const buffer=ctx.createBuffer(1,frameCount,sampleRate);
    const channel=buffer.getChannelData(0);
    const view=new DataView(bytes);
    for(let i=0;i<frameCount;i++){
      channel[i]=view.getInt16(i*2,false)/32768;
    }
    return buffer;
  }

  async function decodeEmbeddedAsset(bytes,spec){
    if(spec.encoding==="pcm16be"){
      return decodePcm16BeMono(bytes,spec.sampleRate||44100);
    }
    return await ctx.decodeAudioData(bytes.slice(0));
  }

  async function loadEmbeddedDrum(kind){
    const spec=ASSETS[kind];
    if(!spec)throw new Error(`Unknown default drum lane: ${kind}`);

    if(!embeddedLoads.has(kind)){
      const load=(async()=>{
        const response=await fetch(spec.url,{cache:"no-store"});
        if(!response.ok){
          throw new Error(`${kind.toUpperCase()} default asset HTTP ${response.status}`);
        }
        const bytes=await response.arrayBuffer();
        const buffer=await decodeEmbeddedAsset(bytes,spec);
        embeddedBufferCompensation.set(buffer,spec.compensationDb);
        return {buffer,name:spec.name};
      })();
      load.catch(()=>embeddedLoads.delete(kind));
      embeddedLoads.set(kind,load);
    }

    return await embeddedLoads.get(kind);
  }

  if(typeof loadSelectedDrum!=="function" ||
     typeof randomAudioFileFromDirectory!=="function"){
    const error=new Error("Default drum kit v2: drum engine unavailable");
    console.error(error);
    globalThis.__SP?.report?.("DEFAULT DRUM KIT",error);
    return;
  }

  loadSelectedDrum=async function(kind,rate,excludeName=null){
    const file=await randomAudioFileFromDirectory(kind,excludeName);
    if(file)return await decodeUserDrum(kind,file);

    try{
      return await loadEmbeddedDrum(kind);
    }catch(error){
      throw new Error(
        `DEFAULT DRUM KIT • ${kind.toUpperCase()} unavailable • ${error?.message||String(error)}`
      );
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

  if(typeof currentDrumSelection!=="undefined" && currentDrumSelection){
    const parts=[currentDrumSelection.kick,currentDrumSelection.snare,currentDrumSelection.hat];
    if(parts.some(part=>String(part?.name||"").startsWith("SYNTH-"))){
      currentDrumSelection=null;
      if(typeof updateDrumSelectionUI==="function")updateDrumSelectionUI();
    }
  }

  globalThis.LooperDefaultDrumKit=Object.freeze({
    installed:true,
    name:KIT_NAME,
    version:KIT_VERSION,
    source:"bundled-one-shots",
    priority:"user-library > embedded-default",
    dry:true,
    snareReverbReady:true,
    gainCompensationDb:Object.freeze({kick:1.5,snare:2.0,hat:4.0}),
    assets:Object.freeze({
      kick:ASSETS.kick.url,
      snare:ASSETS.snare.url,
      hat:ASSETS.hat.url
    }),
    loadEmbeddedDrum
  });
})();
