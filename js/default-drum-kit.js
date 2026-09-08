"use strict";

(() => {
  if(globalThis.LooperDefaultDrumKit?.version>=3)return;

  const KIT_NAME="LOOPER NY DARK 90 V3";
  const KIT_VERSION=3;
  const SOURCE_REF="dbfd6ec52d4ed53b60bdbea5fc6adf295127c027";
  const SOURCE_ROOT=`https://cdn.jsdelivr.net/gh/stargatedaw/stargate-sample-pack@${SOURCE_REF}/stargate-sample-pack`;

  const ASSETS=Object.freeze({
    kick:Object.freeze({
      sources:Object.freeze([
        Object.freeze({
          url:`${SOURCE_ROOT}/karoryfer/kicks/kick_marching_20_old.wav`,
          name:"NY90_KICK_OLD"
        }),
        Object.freeze({
          url:"./assets/drums/default/kick.wav",
          name:"LOOPER_BB90_V2_KICK"
        })
      ]),
      compensationDb:0
    }),
    snare:Object.freeze({
      sources:Object.freeze([
        Object.freeze({
          url:`${SOURCE_ROOT}/freesound/drums/snare/212233__alexthegr81__tapesnare-5.wav`,
          name:"NY90_SNARE_TAPE"
        }),
        Object.freeze({
          url:"./assets/drums/default/snare.wav",
          name:"LOOPER_BB90_V2_SNARE"
        })
      ]),
      compensationDb:0
    }),
    hat:Object.freeze({
      sources:Object.freeze([
        Object.freeze({
          url:`${SOURCE_ROOT}/freesound/drums/cymbal/closed/339278__cabled-mess__hihat-closed-raw-03-gate-eq.wav`,
          name:"NY90_HAT_RAW"
        }),
        Object.freeze({
          url:"./assets/drums/default/hat.wav",
          name:"LOOPER_BB90_V2_HAT"
        })
      ]),
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

  async function loadDefaultDrum(kind){
    const spec=ASSETS[kind];
    if(!spec)return null;

    if(!embeddedLoads.has(kind)){
      embeddedLoads.set(kind,(async()=>{
        let lastError=null;

        for(const source of spec.sources){
          try{
            const response=await fetch(source.url,{cache:"no-store"});
            if(!response.ok){
              throw new Error(`${kind.toUpperCase()} default asset HTTP ${response.status}`);
            }
            const bytes=await response.arrayBuffer();
            const buffer=await ctx.decodeAudioData(bytes.slice(0));
            embeddedBufferCompensation.set(buffer,spec.compensationDb);
            return {buffer,name:source.name};
          }catch(error){
            lastError=error;
            console.warn(`Default ${kind} source unavailable: ${source.url}`,error);
          }
        }

        throw lastError||new Error(`${kind.toUpperCase()} default asset unavailable`);
      })());
    }

    return embeddedLoads.get(kind);
  }

  if(typeof loadSelectedDrum!=="function" ||
     typeof randomAudioFileFromDirectory!=="function" ||
     typeof makeSynthBuffer!=="function"){
    console.warn("Default drum kit v3: drum engine unavailable");
    return;
  }

  loadSelectedDrum=async function(kind,rate,excludeName=null){
    const file=await randomAudioFileFromDirectory(kind,excludeName);
    if(file)return await decodeUserDrum(kind,file);

    try{
      const embedded=await loadDefaultDrum(kind);
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
    source:"cc0-recorded-one-shots",
    sourceLicense:"CC0-1.0",
    sourceRepository:"stargatedaw/stargate-sample-pack",
    sourceRef:SOURCE_REF,
    priority:"user-library > cc0-recorded-default > bundled-default > synth-fallback",
    dry:true,
    snareReverbReady:true,
    gainCompensationDb:Object.freeze({kick:0,snare:0,hat:0}),
    assets:Object.freeze({
      kick:ASSETS.kick.sources[0].url,
      snare:ASSETS.snare.sources[0].url,
      hat:ASSETS.hat.sources[0].url
    }),
    fallbackAssets:Object.freeze({
      kick:ASSETS.kick.sources[1].url,
      snare:ASSETS.snare.sources[1].url,
      hat:ASSETS.hat.sources[1].url
    })
  });
})();
