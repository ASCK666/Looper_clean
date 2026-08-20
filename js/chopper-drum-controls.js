"use strict";

// chopper-200826: the Drum UI is intentionally reduced to AUTO groove selection,
// one fixed PLATE reverb mix and the existing four PUNCH master presets.
const PUNCH_MODE_NAMES=["off","warm","knock","hard"];

function punchModeName(){
  const raw=Number($("punchMode")?.value);
  const index=Number.isFinite(raw)
    ? clamp(Math.round(raw),0,PUNCH_MODE_NAMES.length-1)
    : 1;
  return PUNCH_MODE_NAMES[index]||"warm";
}

function refreshPunchUI(){
  const mode=punchModeName();
  $("punchDesc").textContent=mode.toUpperCase();
}

function punchSettings(){
  const mode=punchModeName();
  const presets={
    off:{
      mode:"off"
    },
    warm:{
      mode:"warm",
      threshold:-12,
      knee:12,
      ratio:1.5,
      attack:.035,
      release:.20,
      drive:1.03,
      makeup:1.00,
      ceiling:.97
    },
    knock:{
      mode:"knock",
      threshold:-14,
      knee:10,
      ratio:1.8,
      attack:.030,
      release:.13,
      drive:1.08,
      makeup:1.01,
      ceiling:.965
    },
    hard:{
      mode:"hard",
      threshold:-18,
      knee:8,
      ratio:2.6,
      attack:.018,
      release:.10,
      drive:1.18,
      makeup:1.02,
      ceiling:.95
    }
  };
  return presets[mode]||presets.warm;
}

function snareReverbSettings(){
  const mix=clamp((Number($("snareReverbMix").value)||0)/100,0,.70);
  return {
    on:mix>0,
    type:"plate",
    mix
  };
}

async function generateDrumSelection(forceDifferent=false){
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
      kick,
      snare,
      hat
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
}

async function refreshDrumsAfterFolderChange(kind,count,origin){
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
}

const reverbInput=$("snareReverbMix");
reverbInput.oninput=()=>{
  $("snareReverbMixReadout").textContent=`${reverbInput.value}%`;
};
reverbInput.onchange=async()=>{
  const mix=Number(reverbInput.value)||0;
  renderedFlip=null;
  if(!isLoopPlaying){
    $("drumStatus").textContent=mix>0?`REVERB ${mix}% • READY`:"REVERB OFF • READY";
    return;
  }
  try{
    await rerenderPreviewMode();
    $("drumStatus").textContent=mix>0?`REVERB ${mix}% ✓`:"REVERB OFF ✓";
  }catch(error){
    $("drumStatus").textContent=`REVERB ERROR: ${safeErrorMessage(error)}`;
  }
};

const punchInput=$("punchMode");
punchInput.oninput=refreshPunchUI;
punchInput.onchange=async()=>{
  const mode=punchModeName();
  refreshPunchUI();
  renderedFlip=null;

  if(!isLoopPlaying){
    $("chopStatus").textContent=`PUNCH ${mode.toUpperCase()} • READY`;
    return;
  }

  try{
    await rerenderPreviewMode();
    $("chopStatus").textContent=`PUNCH ${mode.toUpperCase()} ✓`;
  }catch(error){
    $("chopStatus").textContent=`PUNCH ERROR: ${safeErrorMessage(error)}`;
  }
};

refreshPunchUI();
reverbInput.dispatchEvent(new Event("input"));