"use strict";

// Branch-only Chopper composition: keep the existing control IDs/handlers, but
// present them as one compact hardware strip instead of two framed panels.
(() => {
  const root=document.getElementById("chopper");
  const screen=root?.querySelector(".samplerScreenModule");
  const controls=root?.querySelector(".samplerControlModule");
  if(!root || !screen || !controls)return;

  const actionStrip=document.createElement("div");
  actionStrip.className="chopperActionStrip";
  actionStrip.setAttribute("role","group");
  actionStrip.setAttribute("aria-label","Actions du Chopper");

  // Left -> right exactly as requested.
  for(const id of ["loadSampleBtn","autoMarkers","playDrumsOnly","previewFlip","stopFlip","addFlipLibrary"]){
    const button=document.getElementById(id);
    if(button)actionStrip.appendChild(button);
  }

  const fineSettings=controls.querySelector(".advancedBox");
  const chopStatus=document.getElementById("chopStatus");
  const saveStatus=document.getElementById("beatSaveStatus");
  const statusStrip=document.createElement("div");
  statusStrip.className="chopperStatusStrip";

  const wireStatus=(node,{clearInitial=false}={})=>{
    if(!node)return;
    if(clearInitial)node.textContent="";
    const sync=()=>{
      const text=node.textContent.trim();
      node.hidden=!text || text==="READY";
    };
    sync();
    new MutationObserver(sync).observe(node,{childList:true,subtree:true,characterData:true});
    statusStrip.appendChild(node);
  };

  // Keep real action feedback, but remove permanent idle READY labels.
  wireStatus(chopStatus,{clearInitial:chopStatus?.textContent.trim()==="READY"});
  if(saveStatus?.textContent.includes("SAVE rend"))saveStatus.textContent="";
  wireStatus(saveStatus);

  screen.insertBefore(actionStrip,screen.firstChild);
  if(fineSettings)screen.insertBefore(fineSettings,actionStrip.nextSibling);
  screen.appendChild(statusStrip);

  // One hardware row owns resolution, snare reverb, regeneration and clear.
  const drumQuickActions=root.querySelector(".drumQuickActions");
  const drumEditView=document.getElementById("drumEditView");
  const clearDrums=document.getElementById("clearDrumEdits");
  if(drumQuickActions){
    if(drumEditView)drumQuickActions.insertBefore(drumEditView,drumQuickActions.firstChild);
    if(clearDrums)drumQuickActions.appendChild(clearDrums);
    drumQuickActions.setAttribute("aria-label","Résolution, snare reverb et actions de batterie");
  }

  // Hidden inputs remain available to their existing handlers after the old
  // control frame is removed.
  for(const id of ["sampleFile","waveZoom"]){
    const input=document.getElementById(id);
    if(input)root.appendChild(input);
  }

  root.querySelector(".samplerTopRail")?.remove();
  root.querySelector(".sampleConditionHelp")?.remove();
  root.querySelectorAll(".samplerModuleHint,.spaceHint,.samplerControlLegend,.drumEditHead .help,.titleMeta").forEach(node=>node.remove());
  root.querySelector(".samplerDisplayActions")?.remove();
  controls.remove();
})();

// Boom-bap vinyl macro. This remains branch-scoped so the existing Chopper
// engine stays untouched: rendered PLAY/SAVE buffers are post-processed, while
// direct pad audition gets the equivalent live filter/noise/modulation chain.
(() => {
  const root=document.getElementById("chopper");
  const punch=root?.querySelector(".punchKnob");
  if(!root || !punch || root.dataset.vinylInstalled==="1")return;
  root.dataset.vinylInstalled="1";

  const vinylKnob=document.createElement("div");
  vinylKnob.className="sampleKnob vinylKnob";
  vinylKnob.dataset.rangeKnob="vinylAmount";
  vinylKnob.innerHTML=`
    <label for="vinylAmount">VINYL</label>
    <div class="sampleKnobControl">
      <span class="sampleKnobFace" aria-hidden="true"></span>
      <input id="vinylAmount" class="sampleKnobInput" type="range" min="0" max="100" step="1" value="0" aria-label="Effet vinyle boom bap, zéro désactive l'effet">
    </div>
    <span id="vinylAmountReadout" class="sampleKnobReadout">OFF</span>`;
  punch.insertAdjacentElement("afterend",vinylKnob);

  // The knob is mounted after bootstrap's initial range-knob scan, so keep its
  // rotary percentage synchronized here. The style also extends the existing
  // sample header by one compact hardware column without touching its layout JS.
  const style=document.createElement("style");
  style.dataset.chopperVinyl="1";
  style.textContent=`
    #chopper .samplerScreenModule {
      grid-template-columns:minmax(0,1fr) 52px 68px 52px 52px 52px !important;
      grid-template-areas:
        "actions actions actions actions actions actions"
        "fine fine fine fine fine fine"
        "title pitch tempo volume punch vinyl"
        "wave wave wave wave wave wave"
        "status status status status status status"
        "info info info info info info" !important;
    }
    #chopper .vinylKnob {
      --knob-pct:0;
      grid-area:vinyl !important;
      margin:0 !important;
      padding:0 !important;
      border:0 !important;
      background:transparent !important;
      background-image:none !important;
      box-shadow:none !important;
    }
    @media (max-width:760px) {
      #chopper .samplerScreenModule {
        grid-template-columns:minmax(0,1fr) 40px 56px 40px 40px 40px !important;
      }
    }
    @media (max-width:430px) {
      #chopper .samplerScreenModule {
        grid-template-columns:minmax(0,1fr) 36px 50px 36px 36px 36px !important;
      }
    }`;
  document.head.appendChild(style);

  const input=document.getElementById("vinylAmount");
  const readout=document.getElementById("vinylAmountReadout");

  function settings(){
    const amount=clamp((Number(input?.value)||0)/100,0,1);
    return {
      amount,
      lowpassHz:19000-8500*amount,
      highShelfDb:-3.2*amount,
      wowDepth:.00085*amount,
      flutterDepth:.00008*amount,
      hissGain:.0045*amount,
      crackleGain:.055*amount,
      cracklesPerSecond:1.5+8*amount
    };
  }

  function syncUI(){
    const value=clamp(Number(input?.value)||0,0,100);
    vinylKnob.style.setProperty("--knob-pct",String(value));
    if(readout)readout.textContent=value===0?"OFF":`${Math.round(value)}%`;
  }

  function seededRandom(seed){
    let state=(seed>>>0)||0x76494e59;
    return ()=>{
      state=(state+0x6D2B79F5)>>>0;
      let t=state;
      t=Math.imul(t^(t>>>15),t|1);
      t^=t+Math.imul(t^(t>>>7),t|61);
      return ((t^(t>>>14))>>>0)/4294967296;
    };
  }

  function makeNoiseBuffer(audioContext,duration,fx){
    const rate=audioContext.sampleRate;
    const length=Math.max(1,Math.ceil(Math.max(.05,duration)*rate));
    const buffer=audioContext.createBuffer(2,length,rate);
    const crackles=Math.max(1,Math.round(duration*fx.cracklesPerSecond));

    for(let ch=0;ch<2;ch++){
      const data=buffer.getChannelData(ch);
      const random=seededRandom((0x90b00b5^length^rate^(ch*0x9e3779b9))>>>0);

      for(let i=0;i<length;i++){
        data[i]=(random()*2-1)*fx.hissGain;
      }

      for(let n=0;n<crackles;n++){
        const pos=Math.floor(random()*Math.max(1,length-2));
        const span=Math.max(8,Math.round(rate*(.0012+random()*.0038)));
        const amp=fx.crackleGain*(.35+random()*.65)*(random()<.5?-1:1);
        for(let j=0;j<span && pos+j<length;j++){
          const env=Math.exp(-j/Math.max(1,span*.20));
          data[pos+j]+=amp*env*(.82+(random()*2-1)*.18);
        }
      }
    }
    return buffer;
  }

  function makeVinylBus(audioContext,destination,noiseDuration,{loopNoise=false}={}){
    const fx=settings();
    const busInput=audioContext.createGain();
    if(fx.amount<=0){
      busInput.connect(destination);
      return {input:busInput,start(){},stop(){}};
    }

    const lowpass=audioContext.createBiquadFilter();
    lowpass.type="lowpass";
    lowpass.frequency.value=fx.lowpassHz;
    lowpass.Q.value=.55;

    const shelf=audioContext.createBiquadFilter();
    shelf.type="highshelf";
    shelf.frequency.value=6000;
    shelf.gain.value=fx.highShelfDb;

    const delay=audioContext.createDelay(.02);
    // Keep the modulation safely above zero while adding almost no latency.
    delay.delayTime.value=.0002+fx.wowDepth+fx.flutterDepth;

    const ceiling=audioContext.createGain();
    ceiling.gain.value=.985;

    busInput.connect(lowpass);
    lowpass.connect(shelf);
    shelf.connect(delay);
    delay.connect(ceiling);
    ceiling.connect(destination);

    const wow=audioContext.createOscillator();
    const wowGain=audioContext.createGain();
    wow.frequency.value=.43;
    wowGain.gain.value=fx.wowDepth;
    wow.connect(wowGain).connect(delay.delayTime);

    const flutter=audioContext.createOscillator();
    const flutterGain=audioContext.createGain();
    flutter.frequency.value=6.4;
    flutterGain.gain.value=fx.flutterDepth;
    flutter.connect(flutterGain).connect(delay.delayTime);

    const noise=audioContext.createBufferSource();
    noise.buffer=makeNoiseBuffer(audioContext,noiseDuration,fx);
    noise.loop=loopNoise;
    const noiseHP=audioContext.createBiquadFilter();
    const noiseLP=audioContext.createBiquadFilter();
    noiseHP.type="highpass";
    noiseHP.frequency.value=1800;
    noiseHP.Q.value=.5;
    noiseLP.type="lowpass";
    noiseLP.frequency.value=10500;
    noiseLP.Q.value=.45;
    noise.connect(noiseHP).connect(noiseLP).connect(ceiling);

    let started=false;
    return {
      input:busInput,
      start(at=0){
        if(started)return;
        started=true;
        wow.start(at);
        flutter.start(at);
        noise.start(at);
      },
      stop(){
        if(!started)return;
        for(const source of [wow,flutter,noise]){
          try{source.stop()}catch{}
        }
        started=false;
      }
    };
  }

  async function processRenderedBuffer(buffer){
    const fx=settings();
    if(!buffer || fx.amount<=0)return buffer;

    const offline=new OfflineAudioContext(
      Math.max(1,buffer.numberOfChannels),
      buffer.length,
      buffer.sampleRate
    );
    const source=offline.createBufferSource();
    source.buffer=buffer;
    const vinyl=makeVinylBus(offline,offline.destination,buffer.duration);
    source.connect(vinyl.input);
    vinyl.start(0);
    source.start(0);
    const rendered=await offline.startRendering();
    return typeof finalizeLoopBuffer==="function" ? finalizeLoopBuffer(rendered) : rendered;
  }

  // PLAY and SAVE both call these same render functions, so wrapping them once
  // guarantees the exported WAV and the audible loop use the exact same vinyl.
  const renderSequenceBase=renderSequence;
  renderSequence=async function(...args){
    return await processRenderedBuffer(await renderSequenceBase(...args));
  };

  const renderDrumsOnlyBase=renderDrumsOnly;
  renderDrumsOnly=async function(...args){
    return await processRenderedBuffer(await renderDrumsOnlyBase(...args));
  };

  // Keep direct pad audition honest too: when VINYL is on, the pad uses the
  // same tone/wow/noise family instead of previewing a clean source.
  const previewSliceBase=previewSlice;
  previewSlice=async function(i,button){
    const fx=settings();
    if(fx.amount<=0)return await previewSliceBase(i,button);
    if(!sampleBuffer||i<0||i>=markers.length-1)return;

    await ensureAudio();
    stopChopAudition();

    const start=clamp(markers[i],0,Math.max(0,sampleBuffer.duration-.001));
    const source=ctx.createBufferSource();
    source.buffer=sampleBuffer;
    source.playbackRate.value=samplePitchRate();

    const previewOutput=ctx.createGain();
    connectLive(previewOutput);
    const vinyl=makeVinylBus(ctx,previewOutput,2,{loopNoise:true});
    const conditioner=makeSampleConditioner(ctx,vinyl.input,sampleVolumeGain());
    source.connect(conditioner.input);

    chopAuditionSource=source;
    chopAuditionGain=conditioner.gain;
    chopAuditionPad=i;
    chopAuditionOffset=start;
    chopAuditionStartedAt=ctx.currentTime;

    setActivePad(i);
    source.onended=()=>{
      vinyl.stop();
      if(chopAuditionSource===source){
        chopAuditionSource=null;
        chopAuditionPad=-1;
        chopAuditionGain=null;
        if(isLoopPlaying && lastPreviewMode==="full" && loopPlayheadState){
          startPlayheadAnimation();
        }else{
          stopPlayheadAnimation(true);
        }
      }
    };

    const when=ctx.currentTime;
    vinyl.start(when);
    source.start(when,start);
    startPlayheadAnimation();
  };

  input.addEventListener("input",syncUI);
  input.addEventListener("change",async()=>{
    renderedFlip=null;
    if(!isLoopPlaying || (lastPreviewMode!=="full" && lastPreviewMode!=="drums"))return;
    const status=lastPreviewMode==="drums"?$("drumStatus"):$("chopStatus");
    try{
      await rerenderPreviewMode(lastPreviewMode);
      const value=Math.round(settings().amount*100);
      status.textContent=value?`VINYL ${value}% ✓`:"VINYL OFF ✓";
    }catch(error){
      status.textContent=`VINYL ERROR: ${safeErrorMessage(error)}`;
    }
  });

  globalThis.ChopperVinyl={settings,processRenderedBuffer};
  syncUI();
})();

// Local folder memory for looper-next. Only four locations are persisted:
// KICK, SNARE, HAT and the Chopper sample directory. No musical settings,
// pattern state, knobs or grid data are stored here.
(() => {
  const root=document.getElementById("chopper");
  if(!root || root.dataset.folderPersistenceInstalled==="1")return;
  root.dataset.folderPersistenceInstalled="1";

  const DB_NAME="scratch-practice-folder-handles";
  const DB_VERSION=1;
  const STORE_NAME="handles";
  const ALLOWED_KEYS=Object.freeze(["kick","snare","hat","sample"]);
  const DRUM_KEYS=Object.freeze(["kick","snare","hat"]);
  const memoryHandles=new Map();
  let dbPromise=null;
  let sampleDirectoryHandle=null;

  function validKey(key){
    return ALLOWED_KEYS.includes(key);
  }

  function openFolderDb(){
    if(dbPromise)return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      if(!globalThis.indexedDB){
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      let request;
      try{ request=indexedDB.open(DB_NAME,DB_VERSION); }
      catch(error){ reject(error); return; }
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains(STORE_NAME))db.createObjectStore(STORE_NAME,{keyPath:"id"});
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error("Folder database open failed"));
      request.onblocked=()=>reject(new Error("Folder database blocked"));
    });
    dbPromise.catch(()=>{ dbPromise=null; });
    return dbPromise;
  }

  async function saveHandle(key,handle){
    if(!validKey(key) || !handle)return false;
    memoryHandles.set(key,handle);
    try{
      const db=await openFolderDb();
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_NAME,"readwrite");
        tx.objectStore(STORE_NAME).put({id:key,handle});
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error||new Error("Folder save failed"));
        tx.onabort=()=>reject(tx.error||new Error("Folder save aborted"));
      });
    }catch(error){
      // FileSystemHandle cloning is browser-specific. Session memory remains a
      // safe fallback without breaking the Chopper when persistence is blocked.
      console.warn(`Folder persistence (${key}):`,error?.message||error);
    }
    return true;
  }

  async function readHandle(key){
    if(!validKey(key))return null;
    if(memoryHandles.has(key))return memoryHandles.get(key);
    try{
      const db=await openFolderDb();
      const row=await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_NAME,"readonly");
        const request=tx.objectStore(STORE_NAME).get(key);
        request.onsuccess=()=>resolve(request.result||null);
        request.onerror=()=>reject(request.error||new Error("Folder read failed"));
      });
      const handle=row?.handle||null;
      if(handle)memoryHandles.set(key,handle);
      return handle;
    }catch(error){
      console.warn(`Folder restore (${key}):`,error?.message||error);
      return null;
    }
  }

  async function removeHandle(key){
    if(!validKey(key))return false;
    memoryHandles.delete(key);
    try{
      const db=await openFolderDb();
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_NAME,"readwrite");
        tx.objectStore(STORE_NAME).delete(key);
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error||new Error("Folder delete failed"));
      });
    }catch{}
    if(key==="sample")sampleDirectoryHandle=null;
    return true;
  }

  async function queryReadPermission(handle){
    if(!handle)return "denied";
    if(typeof handle.queryPermission!=="function")return "granted";
    try{return await handle.queryPermission({mode:"read"});}
    catch{return "denied";}
  }

  async function requestReadPermission(handle){
    if(!handle)return "denied";
    let permission=await queryReadPermission(handle);
    if(permission==="granted")return permission;
    if(typeof handle.requestPermission!=="function")return permission;
    try{return await handle.requestPermission({mode:"read"});}
    catch{return "denied";}
  }

  async function scanDrumDirectory(handle){
    const entries=[];
    for await(const entry of handle.values()){
      if(entry.kind==="file" && audioExt.test(entry.name)){
        entries.push(entry);
        if(entries.length>=MAX_DRUM_FOLDER_FILES)break;
      }
    }
    return entries;
  }

  async function mountDrumHandle(kind,handle,{refresh=false}={}){
    if(!DRUM_KEYS.includes(kind) || !handle)return false;
    let entries;
    try{ entries=await scanDrumDirectory(handle); }
    catch(error){
      console.warn(`Restore ${kind} folder:`,error);
      return false;
    }
    if(!entries.length)return false;

    drumDirectoryHandles[kind]=handle;
    drumDirectoryEntries[kind]=entries;
    drumFolderFiles[kind]=[];
    if(refresh){
      $("drumStatus").textContent=`${kind.toUpperCase()} • ${handle.name} • ${entries.length} SOUNDS • LOADING…`;
      await refreshDrumsAfterFolderChange(kind,entries.length,handle.name);
    }
    return true;
  }

  const chooseDrumFolderBase=chooseDrumFolder;
  chooseDrumFolder=async function(kind){
    if(!DRUM_KEYS.includes(kind))return await chooseDrumFolderBase(kind);
    const button=$(`${kind}FolderBtn`);
    if(button)button.disabled=true;
    try{
      // If startup already mounted this folder, clicking the lane is treated as
      // an intentional folder change and opens the native picker as before.
      const mounted=(drumDirectoryEntries[kind]||[]).length>0;
      if(!mounted){
        const saved=drumDirectoryHandles[kind] || await readHandle(kind);
        if(saved){
          drumDirectoryHandles[kind]=saved;
          const permission=await requestReadPermission(saved);
          if(permission==="granted" && await mountDrumHandle(kind,saved,{refresh:true})){
            await saveHandle(kind,saved);
            return true;
          }
        }
      }

      await chooseDrumFolderBase(kind);
      const selected=drumDirectoryHandles[kind];
      if(selected)await saveHandle(kind,selected);
      return !!selected;
    }finally{
      if(button)button.disabled=false;
    }
  };

  async function restoreDrumFolders(){
    const restored=[];
    for(const kind of DRUM_KEYS){
      const handle=await readHandle(kind);
      if(!handle)continue;
      drumDirectoryHandles[kind]=handle;
      if(await queryReadPermission(handle)!=="granted")continue;
      if(await mountDrumHandle(kind,handle))restored.push(kind.toUpperCase());
    }
    if(restored.length){
      const status=$("drumStatus");
      if(status)status.textContent=`FOLDERS RESTORED • ${restored.join(" / ")} ✓`;
    }
    return restored;
  }

  async function chooseSampleDirectory(){
    if(typeof window.showDirectoryPicker!=="function")return null;
    try{
      const handle=await window.showDirectoryPicker({id:"scratch-chopper-sample-folder",mode:"read"});
      sampleDirectoryHandle=handle;
      await saveHandle("sample",handle);
      return handle;
    }catch(error){
      if(error?.name!=="AbortError")console.warn("Sample folder picker:",error);
      return null;
    }
  }

  async function chooseSampleFromRememberedFolder(forceNewFolder=false){
    const legacyInput=$("sampleFile");
    if(typeof window.showDirectoryPicker!=="function" || typeof window.showOpenFilePicker!=="function"){
      if(legacyInput){legacyInput.value="";legacyInput.click();}
      return false;
    }

    if(forceNewFolder)sampleDirectoryHandle=null;
    if(!sampleDirectoryHandle && !forceNewFolder)sampleDirectoryHandle=await readHandle("sample");

    if(!sampleDirectoryHandle){
      const selected=await chooseSampleDirectory();
      if(selected){
        $("chopStatus").textContent=`SAMPLE FOLDER • ${selected.name} ✓ • CLICK LOAD SAMPLE AGAIN`;
      }
      return false;
    }

    let permission=await requestReadPermission(sampleDirectoryHandle);
    if(permission!=="granted"){
      const selected=await chooseSampleDirectory();
      if(!selected)return false;
      $("chopStatus").textContent=`SAMPLE FOLDER • ${selected.name} ✓ • CLICK LOAD SAMPLE AGAIN`;
      return false;
    }

    try{
      const handles=await window.showOpenFilePicker({
        id:"scratch-chopper-sample-file",
        startIn:sampleDirectoryHandle,
        multiple:false,
        excludeAcceptAllOption:false,
        types:[{
          description:"Audio samples",
          accept:{"audio/*":[".wav",".mp3",".m4a",".aac",".ogg",".flac",".webm"]}
        }]
      });
      const fileHandle=handles?.[0];
      if(!fileHandle)return false;
      const file=await fileHandle.getFile();
      return await loadChopperSample(file);
    }catch(error){
      if(error?.name!=="AbortError"){
        console.warn("Sample file picker:",error);
        $("chopStatus").textContent=`SAMPLE PICKER ERROR • ${safeErrorMessage(error)}`;
      }
      return false;
    }
  }

  const loadSampleBtn=$("loadSampleBtn");
  if(loadSampleBtn){
    loadSampleBtn.title="LOAD SAMPLE • Shift+click = change sample folder";
    loadSampleBtn.setAttribute("aria-label","Load sample from remembered sample folder; Shift plus click changes folder");
    loadSampleBtn.onclick=event=>chooseSampleFromRememberedFolder(!!event?.shiftKey);
  }

  async function restoreSampleDirectory(){
    sampleDirectoryHandle=await readHandle("sample");
    return sampleDirectoryHandle;
  }

  globalThis.ChopperFolderPersistence={
    keys:[...ALLOWED_KEYS],
    dbName:DB_NAME,
    saveHandle,
    readHandle,
    removeHandle,
    restoreDrumFolders,
    restoreSampleDirectory,
    mountDrumHandle,
    chooseSampleFromRememberedFolder
  };

  void Promise.all([restoreDrumFolders(),restoreSampleDirectory()]);
})();