"use strict";

/* 120927 behavior adapter.
   It deliberately reuses the existing Looper state/functions instead of
   introducing a second audio or transport model. */
(() => {
  function init120927(){
    const modeState={value:"all"};
    let volumeValue=1;
    let clockPosition=0;
    let clockLastCtxTime=0;
    let clockWasPlaying=false;
    let clockTrackId=null;

    function ensure120927Markup(){
      const deck=$("looperDropzoneBtn");
      if(!deck || deck.dataset.ui120927==="1")return;
      deck.dataset.ui120927="1";

      const readout=deck.querySelector(".deckReadout");
      const state=readout?.querySelector(".deckReadoutState");
      const speedReadout=$("deckSpeedReadout");
      if(readout){
        const time=document.createElement("div");
        time.className="deckReadoutTime";
        time.innerHTML='<small>TIME:</small><span id="deckTimeCurrent">00:00</span><span>/</span><span id="deckTimeDuration">00:00</span>';

        const meter=document.createElement("div");
        meter.className="deckReadoutMeter";
        meter.setAttribute("aria-hidden","true");
        meter.innerHTML='<i id="deckProgressFill"></i>';

        const rateRow=document.createElement("div");
        rateRow.className="deckReadoutRateRow";
        const rateLabel=document.createElement("small");
        rateLabel.textContent="RATE:";
        rateRow.append(rateLabel);
        if(speedReadout)rateRow.append(speedReadout);

        readout.append(time,meter,rateRow);
        if(state){
          const label=state.querySelector("small");
          if(label)label.textContent="STATE:";
        }
      }

      const utility=document.createElement("div");
      utility.className="deckUtilityPanel";
      utility.innerHTML=`
        <div class="deckVolumeControl">
          <label for="deckVolume">VOLUME</label>
          <span class="deckVolumeKnob" aria-hidden="true"></span>
          <input id="deckVolume" type="range" min="0" max="100" step="1" value="100" aria-label="Volume du lecteur">
        </div>
        <div class="deckJack" aria-label="Entrée micro décorative"><span>MIC</span><i aria-hidden="true"></i></div>
        <div class="deckJack" aria-label="Prise casque décorative"><span>PHONES</span><i aria-hidden="true"></i></div>`;
      deck.appendChild(utility);

      const importDock=deck.querySelector(".looperImportDock");
      if(importDock){
        importDock.querySelector("#importFolderBtn strong").textContent="IMPORT LIBRARY";
        importDock.querySelector("#importBeatsBtn strong").textContent="IMPORT BEAT";
        const title=document.createElement("div");
        title.className="deckImportTitle";
        title.textContent="IMPORT SAMPLES";
        const drop=document.createElement("div");
        drop.className="deckDropHint";
        drop.innerHTML="<span>DRAG &amp; DROP<br>AUDIO FILES HERE</span>";
        const meta=document.createElement("div");
        meta.className="deckImportMeta";
        meta.textContent="WAV  MP3  M4A  AAC  OGG  FLAC  WEBM  •  MAX 512MB";
        importDock.prepend(title,drop);
        importDock.appendChild(meta);
      }

      const autoLabel=deck.querySelector("#autoLooperToggle .deckKeyLabel");
      if(autoLabel)autoLabel.textContent="SPEED AUTO";

      const cratePanel=document.querySelector("#looper .beatCratePanel");
      if(cratePanel){
        const left=document.createElement("section");
        left.className="crate120927Panel";
        left.setAttribute("aria-label","Crates de beats");
        const leftTitle=document.createElement("h3");
        leftTitle.className="crate120927Title";
        leftTitle.textContent="CRATES";
        const filters=document.createElement("div");
        filters.id="crate120927Filters";
        const countWrap=document.createElement("div");
        countWrap.className="crate120927Count";
        const existingCount=$("crateCount");
        if(existingCount)countWrap.append(existingCount);
        left.append(leftTitle,filters,countWrap);

        const right=document.createElement("section");
        right.className="beat120927Panel";
        right.setAttribute("aria-label","Liste des beats");
        const rightTitle=document.createElement("h3");
        rightTitle.className="beat120927Title";
        rightTitle.textContent="BEATS";
        const header=document.createElement("div");
        header.className="beat120927Header";
        header.innerHTML="<span>#</span><span>NAME</span><span>LENGTH</span>";
        const list=document.createElement("div");
        list.id="beat120927List";
        list.setAttribute("role","list");
        right.append(rightTitle,header,list);
        cratePanel.append(left,right);
      }
    }

    ensure120927Markup();

    const formatClock=value=>{
      const seconds=Math.max(0,Math.floor(Number(value)||0));
      const minutes=Math.floor(seconds/60);
      return `${String(minutes).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;
    };

    const sourceMode=row=>isFolderBeat(row)?"library":"imports";
    const modeRows=(rows,mode)=>{
      const list=[...(rows||[])];
      if(mode==="library")return list.filter(row=>sourceMode(row)==="library");
      if(mode==="imports")return list.filter(row=>sourceMode(row)==="imports");
      if(mode==="recent")return list.sort((a,b)=>(b.created||0)-(a.created||0)).slice(0,40);
      return list;
    };

    function countsFor(rows){
      const list=rows||[];
      return {
        all:list.length,
        library:list.filter(row=>sourceMode(row)==="library").length,
        imports:list.filter(row=>sourceMode(row)==="imports").length,
        recent:Math.min(40,list.length)
      };
    }

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

    function renderCrateFilters(rows){
      const root=$("crate120927Filters");
      if(!root)return;
      const counts=countsFor(rows);
      const defs=[
        ["all","ALL BEATS"],
        ["library","LIBRARY"],
        ["imports","IMPORTS"],
        ["recent","RECENT"]
      ];
      const content=defs.map(([mode,label])=>{
        const button=document.createElement("button");
        button.type="button";
        button.className="crateFilterButton";
        button.dataset.crateMode=mode;
        button.setAttribute("aria-pressed",modeState.value===mode?"true":"false");
        const text=document.createElement("span");
        text.textContent=label;
        const count=document.createElement("span");
        count.textContent=String(counts[mode]);
        button.append(text,count);
        button.onclick=()=>{
          modeState.value=mode;
          render120927Library(visibleLibraryRowsState);
        };
        return button;
      });
      root.replaceChildren(...content);
    }

    function makeBeatRow(row,index){
      const button=document.createElement("button");
      button.type="button";
      button.className="beat120927Row";
      button.dataset.trackId=row.id;
      button.setAttribute("aria-label",`Charger ${row.name}`);
      if(currentTrack?.id===row.id)button.setAttribute("aria-current","true");

      const number=document.createElement("span");
      number.textContent=String(index+1).padStart(2,"0");
      const name=document.createElement("span");
      name.className="beat120927Name";
      name.textContent=row.label||row.name;
      const length=document.createElement("span");
      length.textContent=row.duration?formatClock(row.duration):"--:--";
      button.append(number,name,length);
      button.onclick=()=>switchTrack(row).catch(error=>{
        console.error("Beat load:",error);
        updateBeatFolderStatus(`LOAD ERROR • ${safeErrorMessage(error)}`);
      });

      if(!isFolderBeat(row)){
        const remove=document.createElement("span");
        remove.className="beat120927Delete";
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

    function render120927Library(rows){
      const baseRows=[...(rows||[])];
      visibleLibraryRowsState=baseRows;
      renderCrateFilters(baseRows);

      const filtered=modeRows(baseRows,modeState.value);
      const list=$("beat120927List");
      if(!list)return;

      const count=$("crateCount");
      if(count)count.textContent=`${filtered.length} beat${filtered.length===1?"":"s"}`;

      if(!filtered.length){
        const empty=document.createElement("div");
        empty.className="beat120927Empty";
        empty.textContent=modeState.value==="imports"
          ? "Aucun beat importé. Utilise IMPORT BEAT."
          : modeState.value==="library"
            ? "Aucune library connectée. Utilise IMPORT LIBRARY."
            : "Aucun beat disponible.";
        list.replaceChildren(empty);
        return;
      }

      list.replaceChildren(...filtered.map(makeBeatRow));
      list.querySelector('[aria-current="true"]')?.scrollIntoView({block:"nearest"});
    }

    /* Keep one renderer: refreshLibrary() still owns data retrieval/filtering,
       this branch only swaps the visual representation. */
    if(typeof renderLibraryRows==="function")renderLibraryRows=render120927Library;

    function syncSpeedLedLabels(){
      document.querySelectorAll("#autoLooperToggle .deckRateVisualSegments i").forEach((led,index)=>{
        led.dataset.level=String(index+1);
      });
    }

    function refresh120927Readout(){
      const rate=$("deckSpeedReadout");
      if(rate && typeof deckRate==="function"){
        const delta=(deckRate()-1)*100;
        rate.textContent=`${delta>=0?"+":""}${delta.toFixed(1)}%`;
      }
      const duration=$("deckTimeDuration");
      if(duration)duration.textContent=deckBuffer?formatClock(deckBuffer.duration):"00:00";
    }

    if(typeof refreshCassetteUI==="function"){
      const baseRefreshCassetteUI=refreshCassetteUI;
      refreshCassetteUI=function(){
        const result=baseRefreshCassetteUI.apply(this,arguments);
        refresh120927Readout();
        requestAnimationFrame(()=>{
          if(typeof visibleLibraryRowsState!=="undefined")render120927Library(visibleLibraryRowsState);
        });
        return result;
      };
    }

    /* Volume stays on the existing deckOutputGain path. */
    const volume=$("deckVolume");
    const volumePanel=document.querySelector(".deckUtilityPanel");
    const applyVolume=value=>{
      volumeValue=Math.max(0,Math.min(1,Number(value)/100));
      if(deckOutputGain && ctx){
        deckOutputGain.gain.setValueAtTime(volumeValue,ctx.currentTime);
      }
      if(volumePanel){
        const angle=-126+(volumeValue*252);
        volumePanel.style.setProperty("--deck-volume-angle",`${angle.toFixed(1)}deg`);
      }
    };
    if(volume){
      volume.addEventListener("input",event=>applyVolume(event.currentTarget.value));
      applyVolume(volume.value);
    }

    if(typeof playDeck==="function"){
      const basePlayDeck=playDeck;
      playDeck=async function(){
        const result=await basePlayDeck.apply(this,arguments);
        if(result && deckOutputGain && ctx){
          deckOutputGain.gain.setValueAtTime(volumeValue,ctx.currentTime);
        }
        return result;
      };
    }

    function updateTransportClock(){
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
        refresh120927Readout();
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
        if(clockLastCtxTime){
          const delta=Math.max(0,now-clockLastCtxTime);
          clockPosition += delta*deckRate();
        }
        clockLastCtxTime=now;
        const dur=Math.max(.001,deckBuffer.duration);
        clockPosition%=dur;
      }else if(!playing){
        clockPosition=0;
        clockLastCtxTime=0;
      }

      clockWasPlaying=playing;
      const dur=Math.max(.001,deckBuffer.duration);
      if(current)current.textContent=formatClock(clockPosition);
      if(progress)progress.style.width=`${Math.min(100,(clockPosition/dur)*100).toFixed(2)}%`;
      refresh120927Readout();
    }

    syncSpeedLedLabels();
    refresh120927Readout();
    if(typeof refreshLibrary==="function")void refreshLibrary(false);
    setInterval(updateTransportClock,200);
    document.documentElement.dataset.ui120927Ready="1";
    if(window.__SP)window.__SP.ui120927Ready=true;
  }

  if(document.readyState==="loading")window.addEventListener("DOMContentLoaded",init120927,{once:true});
  else init120927();
})();
