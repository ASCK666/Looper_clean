"use strict";

/* UI-only controller for the cassette deck.
   The audio/import/transport state remains owned by looper.js. */
(() => {
  const crateState={value:"all"};
  let deckVolumeValue=1;
  let clockPosition=0;
  let clockLastCtxTime=0;
  let clockWasPlaying=false;
  let clockTrackId=null;

  const formatClock=value=>{
    const seconds=Math.max(0,Math.floor(Number(value)||0));
    const minutes=Math.floor(seconds/60);
    return `${String(minutes).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;
  };

  const rowSource=row=>isFolderBeat(row)?"library":"imports";
  const rowsForCrate=(rows,crate)=>{
    const list=[...(rows||[])];
    if(crate==="library")return list.filter(row=>rowSource(row)==="library");
    if(crate==="imports")return list.filter(row=>rowSource(row)==="imports");
    if(crate==="recent")return list.sort((a,b)=>(b.created||0)-(a.created||0)).slice(0,40);
    return list;
  };

  const crateCounts=rows=>{
    const list=rows||[];
    return {
      all:list.length,
      library:list.filter(row=>rowSource(row)==="library").length,
      imports:list.filter(row=>rowSource(row)==="imports").length,
      recent:Math.min(40,list.length)
    };
  };

  async function removeImportedBeat(row){
    if(isFolderBeat(row))return;
    const deletingCurrent=currentTrack?.id===row.id;
    if(deletingCurrent){
      stopDeck();
      currentTrack=null;
      deckBuffer=null;
      $("deckTrack").textContent="Aucun beat chargé";
      $("deckInfo").textContent="Importe un WAV/MP3 pour commencer.";
      refreshCassetteUI();
    }
    await dbDelete(row.id);
    await refreshLibrary(false);
  }

  function renderCrates(rows){
    const root=$("crateFilters");
    if(!root)return;
    const counts=crateCounts(rows);
    const defs=[
      ["all","ALL BEATS"],
      ["library","LIBRARY"],
      ["imports","IMPORTS"],
      ["recent","RECENT"]
    ];
    root.replaceChildren(...defs.map(([mode,label])=>{
      const button=document.createElement("button");
      button.type="button";
      button.className="crateFilterButton";
      button.dataset.crateMode=mode;
      button.setAttribute("aria-pressed",crateState.value===mode?"true":"false");
      button.innerHTML=`<span>${label}</span><span>${counts[mode]}</span>`;
      button.onclick=()=>{
        crateState.value=mode;
        renderDeckLibrary(visibleLibraryRowsState);
      };
      return button;
    }));
  }

  function makeBeatRow(row,index){
    const button=document.createElement("button");
    button.type="button";
    button.className="beatListRow";
    button.dataset.trackId=row.id;
    button.setAttribute("role","listitem");
    button.setAttribute("aria-label",`Charger ${row.name}`);
    if(currentTrack?.id===row.id)button.setAttribute("aria-current","true");

    const number=document.createElement("span");
    number.className="beatListNumber";
    number.textContent=String(index+1).padStart(2,"0");
    const name=document.createElement("span");
    name.className="beatListName";
    name.textContent=row.label||row.name;
    const length=document.createElement("span");
    length.className="beatListLength";
    length.textContent=row.duration?formatClock(row.duration):"--:--";
    button.append(number,name,length);

    button.onclick=()=>switchTrack(row).catch(error=>{
      console.error("Beat load:",error);
      updateBeatFolderStatus(`LOAD ERROR • ${safeErrorMessage(error)}`);
    });

    if(!isFolderBeat(row)){
      const remove=document.createElement("span");
      remove.className="beatListDelete";
      remove.setAttribute("role","button");
      remove.setAttribute("tabindex","0");
      remove.setAttribute("aria-label",`Supprimer ${row.name}`);
      remove.textContent="×";
      const runDelete=event=>{
        event.preventDefault();
        event.stopPropagation();
        void removeImportedBeat(row);
      };
      remove.onclick=runDelete;
      remove.onkeydown=event=>{
        if(event.key==="Enter"||event.key===" ")runDelete(event);
      };
      name.appendChild(remove);
    }
    return button;
  }

  function renderDeckLibrary(rows){
    const baseRows=[...(rows||[])];
    visibleLibraryRowsState=baseRows;
    renderCrates(baseRows);

    const filtered=rowsForCrate(baseRows,crateState.value);
    const count=$("crateCount");
    if(count)count.textContent=`${filtered.length} beat${filtered.length===1?"":"s"}`;

    const list=$("beatList");
    if(!list)return;
    if(!filtered.length){
      const empty=document.createElement("div");
      empty.className="beatListEmpty";
      empty.textContent=crateState.value==="imports"
        ? "Aucun beat importé. Utilise IMPORT BEAT."
        : crateState.value==="library"
          ? "Aucune library connectée. Utilise IMPORT LIBRARY."
          : "Aucun beat disponible.";
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...filtered.map(makeBeatRow));
    list.querySelector('[aria-current="true"]')?.scrollIntoView({block:"nearest"});
  }

  /* refreshLibrary() stays authoritative for retrieval/filtering; only its view changes. */
  if(typeof renderLibraryRows==="function")renderLibraryRows=renderDeckLibrary;

  const updateReadout=()=>{
    const rate=$("deckSpeedReadout");
    if(rate && typeof deckRate==="function"){
      const delta=(deckRate()-1)*100;
      rate.textContent=`${delta>=0?"+":""}${delta.toFixed(1)}%`;
    }
    const duration=$("deckTimeDuration");
    if(duration)duration.textContent=deckBuffer?formatClock(deckBuffer.duration):"00:00";
  };

  const volume=$("deckVolume");
  const volumeKnob=document.querySelector("#looper .deckVolumeKnob");
  const applyVolume=value=>{
    deckVolumeValue=Math.max(0,Math.min(1,Number(value)/100));
    if(deckOutputGain && ctx)deckOutputGain.gain.setValueAtTime(deckVolumeValue,ctx.currentTime);
    if(volumeKnob){
      const angle=-126+(deckVolumeValue*252);
      volumeKnob.style.setProperty("--deck-volume-angle",`${angle.toFixed(1)}deg`);
    }
  };
  if(volume){
    volume.addEventListener("input",event=>applyVolume(event.currentTarget.value));
    applyVolume(volume.value);
  }

  if(typeof playDeck==="function"){
    const playDeckBase=playDeck;
    playDeck=async function(){
      const result=await playDeckBase.apply(this,arguments);
      if(result && deckOutputGain && ctx)deckOutputGain.gain.setValueAtTime(deckVolumeValue,ctx.currentTime);
      return result;
    };
  }

  function updateClock(){
    const current=$("deckTimeCurrent");
    const progress=$("deckProgressFill");
    const loaded=!!deckBuffer;
    const playing=!!deckSource;
    const trackId=currentTrack?.id||null;

    if(!loaded){
      clockPosition=0;
      clockLastCtxTime=0;
      clockWasPlaying=false;
      clockTrackId=null;
      if(current)current.textContent="00:00";
      if(progress)progress.style.width="0%";
      updateReadout();
      return;
    }

    if(trackId!==clockTrackId){
      clockTrackId=trackId;
      clockPosition=0;
      clockLastCtxTime=ctx?.currentTime||0;
    }
    if(playing && !clockWasPlaying){
      clockPosition=0;
      clockLastCtxTime=ctx?.currentTime||0;
    }
    if(playing && ctx){
      const now=ctx.currentTime;
      if(clockLastCtxTime)clockPosition+=Math.max(0,now-clockLastCtxTime)*deckRate();
      clockLastCtxTime=now;
      clockPosition%=Math.max(.001,deckBuffer.duration);
    }else if(!playing){
      clockPosition=0;
      clockLastCtxTime=0;
    }
    clockWasPlaying=playing;

    const duration=Math.max(.001,deckBuffer.duration);
    if(current)current.textContent=formatClock(clockPosition);
    if(progress)progress.style.width=`${Math.min(100,(clockPosition/duration)*100).toFixed(2)}%`;
    updateReadout();
  }

  updateReadout();
  setInterval(updateClock,200);
  window.__SP && (window.__SP.ui120927Ready=true);
  document.documentElement.dataset.ui120927Ready="1";
})();
