"use strict";

(() => {
  if(globalThis.LooperDefaultDrumKit?.installed)return;

  const KIT_NAME="LOOPER BOOM BAP 90";
  const KIT_VERSION=1;

  const KICK_VARIANTS=[
    {id:"03",seed:5003,dur:.24,f0:118,f1:52,drop:.009,bodyTau:.054,knockLo:90,knockHi:170,knockTau:.022,knockAmt:.20,clickAmt:.036,drive:1.26,lp:6800,tailStart:.105,tailTau:.019},
    {id:"01",seed:5001,dur:.22,f0:110,f1:50,drop:.010,bodyTau:.050,knockLo:95,knockHi:180,knockTau:.020,knockAmt:.22,clickAmt:.040,drive:1.30,lp:6500,tailStart:.095,tailTau:.018},
    {id:"05",seed:5005,dur:.23,f0:108,f1:49,drop:.011,bodyTau:.051,knockLo:95,knockHi:190,knockTau:.020,knockAmt:.24,clickAmt:.040,drive:1.32,lp:6400,tailStart:.100,tailTau:.018},
    {id:"08",seed:5008,dur:.22,f0:114,f1:50,drop:.010,bodyTau:.049,knockLo:92,knockHi:185,knockTau:.019,knockAmt:.23,clickAmt:.042,drive:1.31,lp:6600,tailStart:.096,tailTau:.017}
  ];

  const SNARE_VARIANTS=[
    {id:"01",seed:7001,dur:.23,f1:188,f2:302,f2Amt:.28,bodyTau:.038,bodyAmt:.43,wireLo:900,wireHi:9800,wireTau:.050,wireAmt:.47,crackLo:2200,crackHi:11800,crackTau:.0065,crackAmt:.31,stickAmt:.09,hp:85,lp:13800,drive:1.24,tailStart:.115,tailTau:.020},
    {id:"03",seed:7003,dur:.25,f1:176,f2:286,f2Amt:.32,bodyTau:.043,bodyAmt:.46,wireLo:800,wireHi:9200,wireTau:.055,wireAmt:.44,crackLo:2000,crackHi:11000,crackTau:.0070,crackAmt:.28,stickAmt:.08,hp:80,lp:13200,drive:1.22,tailStart:.125,tailTau:.022},
    {id:"05",seed:7005,dur:.22,f1:194,f2:312,f2Amt:.27,bodyTau:.036,bodyAmt:.41,wireLo:950,wireHi:10200,wireTau:.047,wireAmt:.48,crackLo:2300,crackHi:12200,crackTau:.0060,crackAmt:.32,stickAmt:.09,hp:88,lp:14100,drive:1.26,tailStart:.110,tailTau:.019},
    {id:"08",seed:7008,dur:.24,f1:182,f2:294,f2Amt:.30,bodyTau:.040,bodyAmt:.44,wireLo:850,wireHi:9600,wireTau:.052,wireAmt:.46,crackLo:2100,crackHi:11600,crackTau:.0068,crackAmt:.30,stickAmt:.09,hp:82,lp:13600,drive:1.23,tailStart:.120,tailTau:.021}
  ];

  const HAT_VARIANTS=[
    {id:"03",seed:3003,dur:.135,freqs:[5220,6630,7840,9360,11210],metalDecay:.038,noiseDecay:.042,hp:4700,lp:16800,metalAmt:.78,noiseAmt:.50,tickAmt:.14,drive:1.20},
    {id:"01",seed:3001,dur:.115,freqs:[5680,6980,8230,9710,11650],metalDecay:.030,noiseDecay:.035,hp:5200,lp:17500,metalAmt:.75,noiseAmt:.55,tickAmt:.16,drive:1.22},
    {id:"05",seed:3005,dur:.120,freqs:[5840,7160,8520,10020,12180],metalDecay:.032,noiseDecay:.036,hp:5400,lp:17600,metalAmt:.74,noiseAmt:.56,tickAmt:.17,drive:1.24},
    {id:"06",seed:3006,dur:.105,freqs:[6030,7530,9010,10600,12920],metalDecay:.027,noiseDecay:.032,hp:5750,lp:18100,metalAmt:.71,noiseAmt:.59,tickAmt:.19,drive:1.26}
  ];

  const variantCache=new Map();

  function rng(seed){
    let state=(seed>>>0)||1;
    return ()=>{
      state^=state<<13;
      state^=state>>>17;
      state^=state<<5;
      return ((state>>>0)/4294967296)*2-1;
    };
  }

  function onePoleLowpass(input,cutoff,rate){
    const out=new Float32Array(input.length);
    const a=1-Math.exp(-2*Math.PI*Math.min(cutoff,rate*.45)/rate);
    let y=0;
    for(let i=0;i<input.length;i++){
      y+=a*(input[i]-y);
      out[i]=y;
    }
    return out;
  }

  function onePoleHighpass(input,cutoff,rate){
    const low=onePoleLowpass(input,cutoff,rate);
    const out=new Float32Array(input.length);
    for(let i=0;i<input.length;i++)out[i]=input[i]-low[i];
    return out;
  }

  function bandpassNoise(length,lo,hi,rate,random){
    const noise=new Float32Array(length);
    for(let i=0;i<length;i++)noise[i]=random();
    return onePoleLowpass(onePoleHighpass(noise,lo,rate),hi,rate);
  }

  function softClip(value,drive){
    const norm=Math.tanh(drive)||1;
    return Math.tanh(value*drive)/norm;
  }

  function normalize(data,target=.89){
    let peak=1e-8;
    for(let i=0;i<data.length;i++)peak=Math.max(peak,Math.abs(data[i]));
    const gain=target/peak;
    for(let i=0;i<data.length;i++)data[i]*=gain;
    return data;
  }

  function makeKick(p,rate){
    const length=Math.max(1,Math.floor(p.dur*rate));
    const out=new Float32Array(length);
    const random=rng(p.seed);
    const knock=bandpassNoise(length,p.knockLo,p.knockHi,rate,random);
    const click=bandpassNoise(length,1200,4200,rate,random);
    let phase=0;

    for(let i=0;i<length;i++){
      const t=i/rate;
      const f=p.f1+(p.f0-p.f1)*Math.exp(-t/p.drop);
      phase+=2*Math.PI*f/rate;
      const body=Math.sin(phase)*Math.exp(-Math.pow(t/p.bodyTau,1.35));
      const knockEnv=Math.exp(-Math.pow(t/p.knockTau,1.5));
      const clickEnv=Math.exp(-t/.0038);
      let sample=body+p.knockAmt*knock[i]*knockEnv+p.clickAmt*click[i]*clickEnv;
      if(t>p.tailStart)sample*=Math.exp(-Math.pow((t-p.tailStart)/p.tailTau,2.2));
      out[i]=softClip(sample,p.drive);
    }

    return normalize(onePoleLowpass(out,p.lp,rate),.89);
  }

  function makeSnare(p,rate){
    const length=Math.max(1,Math.floor(p.dur*rate));
    const out=new Float32Array(length);
    const random=rng(p.seed);
    const wires=bandpassNoise(length,p.wireLo,p.wireHi,rate,random);
    const crack=bandpassNoise(length,p.crackLo,p.crackHi,rate,random);
    const stick=bandpassNoise(length,1100,3600,rate,random);

    for(let i=0;i<length;i++){
      const t=i/rate;
      const body=(
        Math.sin(2*Math.PI*p.f1*t)+
        p.f2Amt*Math.sin(2*Math.PI*p.f2*t+.45)
      )*Math.exp(-Math.pow(t/p.bodyTau,1.55));
      const wire=wires[i]*Math.exp(-Math.pow(t/p.wireTau,1.35));
      const transient=crack[i]*Math.exp(-Math.pow(t/p.crackTau,1.8));
      const stickHit=stick[i]*Math.exp(-Math.pow(t/.0045,2));
      let sample=p.bodyAmt*body+p.wireAmt*wire+p.crackAmt*transient+p.stickAmt*stickHit;
      if(t>p.tailStart)sample*=Math.exp(-Math.pow((t-p.tailStart)/p.tailTau,2.3));
      out[i]=softClip(sample,p.drive);
    }

    return normalize(
      onePoleLowpass(onePoleHighpass(out,p.hp,rate),p.lp,rate),
      .87
    );
  }

  function makeHat(p,rate){
    const length=Math.max(1,Math.floor(p.dur*rate));
    const out=new Float32Array(length);
    const random=rng(p.seed);
    const phases=p.freqs.map(()=>Math.PI*(random()+1));
    const noise=new Float32Array(length);
    const tickRaw=new Float32Array(length);
    for(let i=0;i<length;i++){
      noise[i]=random();
      tickRaw[i]=random();
    }
    const hiss=onePoleLowpass(onePoleHighpass(noise,p.hp,rate),p.lp,rate);
    const tick=onePoleLowpass(onePoleHighpass(tickRaw,7000,rate),Math.min(17000,rate*.44),rate);

    for(let i=0;i<length;i++){
      const t=i/rate;
      let metal=0;
      for(let j=0;j<p.freqs.length;j++){
        metal+=Math.sin(2*Math.PI*p.freqs[j]*t+phases[j])/(1+j*.12);
      }
      metal/=p.freqs.length;
      metal*=Math.exp(-t/p.metalDecay);
      const noisePart=hiss[i]*Math.exp(-t/p.noiseDecay);
      const tickPart=tick[i]*Math.exp(-t/.0023);
      out[i]=softClip(p.metalAmt*metal+p.noiseAmt*noisePart+p.tickAmt*tickPart,p.drive);
    }

    return normalize(onePoleHighpass(out,Math.max(3900,p.hp-800),rate),.84);
  }

  function variantsFor(kind){
    if(kind==="kick")return KICK_VARIANTS;
    if(kind==="snare")return SNARE_VARIANTS;
    if(kind==="hat")return HAT_VARIANTS;
    return [];
  }

  function chooseVariant(kind,excludeName=null){
    const variants=variantsFor(kind);
    if(!variants.length)return null;
    const available=excludeName
      ? variants.filter(p=>`${KIT_NAME}-${kind.toUpperCase()}-${p.id}`!==excludeName)
      : variants;
    const pool=available.length?available:variants;
    return pool[randomIndex(pool.length)];
  }

  function makeDefaultBuffer(kind,variant,rate){
    const key=`${kind}:${variant.id}:${rate}`;
    if(variantCache.has(key))return variantCache.get(key);

    let mono;
    if(kind==="kick")mono=makeKick(variant,rate);
    else if(kind==="snare")mono=makeSnare(variant,rate);
    else mono=makeHat(variant,rate);

    const buffer=ctx.createBuffer(1,mono.length,rate);
    buffer.copyToChannel(mono,0);
    variantCache.set(key,buffer);
    return buffer;
  }

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

  if(typeof loadSelectedDrum!=="function" || typeof randomAudioFileFromDirectory!=="function"){
    console.warn("Default drum kit: drum engine unavailable");
    return;
  }

  loadSelectedDrum=async function(kind,rate,excludeName=null){
    const file=await randomAudioFileFromDirectory(kind,excludeName);
    if(file)return await decodeUserDrum(kind,file);

    const variant=chooseVariant(kind,excludeName);
    if(!variant){
      return {
        buffer:makeSynthBuffer(kind,rate),
        name:`SYNTH-${Math.floor(performance.now())}-${randomIndex(999)}`
      };
    }

    return {
      buffer:makeDefaultBuffer(kind,variant,rate),
      name:`${KIT_NAME}-${kind.toUpperCase()}-${variant.id}`
    };
  };

  globalThis.LooperDefaultDrumKit=Object.freeze({
    installed:true,
    name:KIT_NAME,
    version:KIT_VERSION,
    priority:"user-library > embedded-default > synth-fallback",
    dry:true,
    snareReverbReady:true,
    variants:Object.freeze({
      kick:KICK_VARIANTS.map(p=>p.id),
      snare:SNARE_VARIANTS.map(p=>p.id),
      hat:HAT_VARIANTS.map(p=>p.id)
    })
  });
})();
