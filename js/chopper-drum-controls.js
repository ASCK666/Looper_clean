"use strict";

// chopper-200826: reduced Drum control surface. These assignments replace the
// legacy UI-dependent bindings without duplicating top-level function declarations.
const PUNCH_MODE_NAMES=["off","warm","knock","hard"];

globalThis.punchModeName=()=>{
  const raw=Number($("punchMode")?.value);
  const index=Number.isFinite(raw)
    ? clamp(Math.round(raw),0,PUNCH_MODE_NAMES.length-1)
    : 1;
  return PUNCH_MODE_NAMES[index]||"warm";
};

globalThis.refreshPunchUI=()=>{
  $("punchDesc").textContent=punchModeName().toUpperCase();
};

globalThis.punchSettings=()=>{
  const mode=punchModeName();
  const presets={
    off:{mode:"off"},
    warm:{mode:"warm",threshold:-12,knee:12,ratio:1.5,attack:.035,release:.20,drive:1.03,makeup:1.00,ceiling:.97},
    knock:{mode:"knock",threshold:-14,knee:10,ratio:1.8,attack:.030,release:.13,drive:1.08,makeup:1.01,ceiling:.965},
    hard:{mode:"hard",threshold:-18,knee:8,ratio:2.6,attack:.018,release:.10,drive:1.18,makeup:1.02,ceiling:.95}
  };
  return presets[mode]||presets.warm;
};

globalThis.snareReverbSettings=()=>{
  const mix=clamp((Number($("snareReverbMix").value)||0)/100,0,.70);
  return {on:mix>0,type:"plate",mix};
};

globalThis.generateDrumSelection=async(forceDifferent=false)=>{
  await ensureAudio();
  const requested="auto";
  const previous=currentDrumSelection;
  const previousSignature=drumSelectionSignature(previous);
  const density=sampleBuffer ? sampleDensity(sampleBuffer) : .5;
  const rate=44100;

  async function buildOne(){
    const pat=drumPattern(requested,density,previous,forceDifferent);
    const prevKick=forceDifferent ? previous?.kick?.name || null : null;
    const prevSnare=forceDifferent ? previous?.snare?.name || null : null;
    const prevHat=forceDifferent ? previous?.hat?.name || null : null;
    const [kick,snare,hat]=await Promise.all([
      loadSelectedDrum("kick",rate,prevKick),
      loadSelectedDrum("snare",rate,prevSnare),
      loadSelectedDrum("hat",rate,prevHat)
    ]);
    return {
      mode:pat.mode,
      patternId:pat.id,
      patternName:pat.name,
      kicks:[...pat.kicks],
      snares:[...(pat.snares||[4,12])],
      ghosts:[...(pat.ghosts||[])],
      hats:[...(pat.hats||[0,1,2,3,4,5,6,7])],
      hatSteps:[...(pat.hats||[0,1,2,3,4,5,6,7])].map(x=>x*2),
      kickVelocity:Object.fromEntries((pat.kicks||[]).map(step=>[step,1])),
      snareVelocity:Object.fromEntries((pat.snares||[4,12]).map(step=>[step,1])),
      hatVelocity:Object.fromEntries((pat.hats||[0,1,2,3,4,5,6,7]).map(x=>[x*2,1])),
      hatSwing:pat.hatSwing??.034,
      hatOn:pat.hatOn??.31,
      hatOff:pat.hatOff??.24,
      snareDelay:pat.snareDelay??.008,
      kickNudge:{...(pat.kickNudge||{})},
      kick,snare,hat
    };
  }

  let next=await buildOne();
  if(forceDifferent && previous && drumSelectionSignature(next)===previousSignature){
    next=await buildOne();
  }
  currentDrumSelection=next;
  drumGenerationNumber++;
  updateDrumSelectionUI();
  return currentDrumSelection;
};

globalThis.refreshDrumsAfterFolderChange=async(kind,count,origin)=>{
  const wasPlaying=isLoopPlaying;
  const modeBefore=lastPreviewMode;
  try{
    await generateDrumSelection(true);
    if(wasPlaying){
      if(modeBefore==="drums"){
        renderedFlip=await renderDrumsOnly();
        lastPreviewMode="drums";
        await playRendered(renderedFlip);
      }else if(modeBefore==="full" && sampleBuffer){
        const events=gridEventsForRender();
        if(events.some(Boolean)){
          renderedFlip=await renderSequence(events,sampleBuffer,markers,samplePitchRate());
          lastPreviewMode="full";
          await playRendered(renderedFlip);
        }
      }
    }
    const selected={
      kick:currentDrumSelection?.kick?.name,
      snare:currentDrumSelection?.snare?.name,
      hat:currentDrumSelection?.hat?.name
    }[kind] || "ready";
    $("drumStatus").textContent=`${kind.toUpperCase()} • ${selected} ✓`;
  }catch(error){
    $("drumStatus").textContent=`${kind.toUpperCase()} ERROR: ${safeErrorMessage(error)}`;
  }
};

refreshPunchUI();
$("snareReverbMix").dispatchEvent(new Event("input"));