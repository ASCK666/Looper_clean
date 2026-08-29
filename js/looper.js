"use strict";

// ----------------------------
// IndexedDB beat library
// ----------------------------
const BEAT_DB_NAME="scratch-practice-station";
const BEAT_DB_VERSION=3;
const BEAT_STORE_NAME="beats";
const BEAT_FOLDER_CACHE_PREFIX="beat-folder-cache:";
const BEAT_CRATE_FAVORITES_KEY="looper66-beat-crate-favorites";
const BEAT_CRATE_SET_KEY="looper66-beat-crate-set";
const BEAT_CRATE_DIG_HISTORY_LIMIT=4;

// Looper66 owns the complete deck state. Other modules may call the transport
// functions below, but do not mutate or mirror these values.
let deckSource=null;
let deckBuffer=null;
let currentTrack=null;
let deckOutputGain=null;
let autoLooperEnabledState=false;
let autoLooperTimer=null;
let autoLooperLastCtxTime=0;
let autoLooperSourceSeconds=0;
let autoLooperLoopCount=0;
let autoLooperSpeedPercent=100;
let looperSpeedRateLevel=0;
let looperPitchPercent=0;
let beatCrateViewState="all";
let beatCrateFavoritesState=readBeatCrateKeySet(BEAT_CRATE_FAVORITES_KEY);
let beatCrateSetState=readBeatCrateKeySet(BEAT_CRATE_SET_KEY);
let beatCrateDigHistory=[];

// Beat Crate and transport contracts live here so rendering, timing and tests
// share the same values instead of repeating UI magic numbers.
const AUTO_LOOP_BATCH=8;
const AUTO_SPEED_MAX_PERCENT=200;
const AUTO_PROGRESS_INTERVAL_MS=200;
const SUPPLY_REEL_CYCLE_SECONDS=2.91;
const TAKEUP_REEL_CYCLE_SECONDS=1.46;

// Keep the cassette view beside the Looper state it renders. This function is
// deliberately presentation-only: transport changes remain in playDeck(),
// stopDeck() and the Speed Rate transitions, which makes refreshes safe to repeat.
function refreshCassetteUI(){
  const zone=$("looperDropzoneBtn");
  const name=$("cassetteBeatName");
  const readoutTrack=$("deckReadoutTrack");
  const transportState=$("deckTransportState");
  const speedReadout=$("deckSpeedReadout");
  const speedEcho=$("deckSpeedEcho");
  const autoReadout=$("deckAutoReadout");
  const cratePlay=$("cratePlayBeat");
  const crateState=$("crateDeckState");
  if(!zone || !name) return;

  const currentName=($("deckTrack")?.textContent || "NO BEAT LOADED").trim();
  const displayName=shortName(currentName.toUpperCase(),32);
  name.textContent=displayName;
  if(readoutTrack)readoutTrack.textContent=displayName;

  const loaded=!!deckBuffer;
  const playing=!!deckSource;

  zone.classList.toggle("loaded",loaded);
  zone.classList.toggle("playing",playing);
  if(transportState)transportState.textContent=!loaded ? "EMPTY" : playing ? "PLAYING" : "READY";
  const formattedRate=formatDeckRate();
  if(speedReadout)speedReadout.textContent=formattedRate;
  if(speedEcho)speedEcho.textContent=formattedRate;
  if(autoReadout)autoReadout.textContent=autoLooperEnabledState ? "ON" : "OFF";
  if(cratePlay){
    cratePlay.disabled=!loaded;
    cratePlay.textContent=playing ? "↻ RESTART" : "▶ PLAY";
  }
  if(crateState){
    crateState.textContent=!loaded ? "SELECT A BEAT" : playing ? `PLAYING • ${displayName}` : `READY • ${displayName}`;
  }
}

// V61 stability: IndexedDB can be blocked by browser/privacy context. In that
// case the app continues to work for the current session instead of breaking
// LOOPER/CHOPPER/DRUM event binding during startup.
const memoryBeatStore=new Map();
let dbFallbackMode=false;
let dbPromise=null;

function enableDbFallback(error){
  dbFallbackMode=true;
  const reason=error?.message||String(error||"IndexedDB unavailable");
  console.warn("Scratch Practice: IndexedDB unavailable, using session memory:",reason);
}

function openDb(){
  if(dbPromise)return dbPromise;
  const attempt=new Promise((resolve,reject)=>{
    let req;
    let settled=false;
    const fail=error=>{
      if(settled)return;
      settled=true;
      reject(error);
    };

    try{ req=indexedDB.open(BEAT_DB_NAME,BEAT_DB_VERSION); }
    catch(error){ fail(error); return; }
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(BEAT_STORE_NAME))db.createObjectStore(BEAT_STORE_NAME,{keyPath:"id"});
    };
    req.onsuccess=()=>{
      const db=req.result;
      if(settled){ db.close(); return; }
      settled=true;
      db.onversionchange=()=>{ try{db.close()}catch{} dbPromise=null; };
      resolve(db);
    };
    req.onerror=()=>fail(req.error||new Error("IndexedDB open failed"));
    req.onblocked=()=>fail(new Error("IndexedDB upgrade blocked by another tab"));
  });
  dbPromise=attempt;
  // A synchronous indexedDB.open() failure happens before the outer assignment.
  // Clear the cached promise from a microtask so a later call may retry cleanly.
  void attempt.catch(()=>{ if(dbPromise===attempt)dbPromise=null; });
  return attempt;
}

function transactionError(tx,request,message){
  let requestFailure=null;
  try{ requestFailure=request?.error||null; }catch{}
  return requestFailure||tx?.error||new Error(message);
}

async function runBeatStoreTransaction(mode,operation){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(BEAT_STORE_NAME,mode);
    let request;
    try{
      request=operation(tx.objectStore(BEAT_STORE_NAME));
    }catch(error){
      try{tx.abort()}catch{}
      reject(error);
      return;
    }
    tx.oncomplete=()=>resolve(request?.result);
    // Request errors are more specific than transaction AbortError values
    // (notably QuotaExceededError, which keeps persistent rows visible).
    tx.onabort=()=>reject(transactionError(tx,request,"IndexedDB transaction aborted"));
    tx.onerror=()=>reject(transactionError(tx,request,"IndexedDB transaction failed"));
  });
}

async function dbPut(row){
  if(dbFallbackMode){
    memoryBeatStore.set(row.id,row);
  }else{
    try{
      await runBeatStoreTransaction("readwrite",store=>store.put(row));
      memoryBeatStore.delete(row.id);
    }catch(e){
      // Quota exhaustion must not hide the existing persistent library.
      if(e?.name==="QuotaExceededError"){
        console.warn("Scratch Practice: storage quota reached; keeping item in session memory");
        memoryBeatStore.set(row.id,row);
      }else{
        enableDbFallback(e);
        memoryBeatStore.set(row.id,row);
      }
    }
  }
}

async function dbDeleteMany(ids){
  const uniqueIds=[...new Set((ids||[]).filter(Boolean))];
  for(const id of uniqueIds)memoryBeatStore.delete(id);
  if(dbFallbackMode || !uniqueIds.length)return;
  try{
    await runBeatStoreTransaction("readwrite",store=>{
      for(const id of uniqueIds)store.delete(id);
    });
  }catch(e){
    console.warn("Scratch Practice: persistent delete failed",e);
  }
}

async function dbDelete(id){
  await dbDeleteMany([id]);
}

async function dbAll(){
  if(dbFallbackMode)return [...memoryBeatStore.values()];
  try{
    const persistent=await runBeatStoreTransaction("readonly",store=>store.getAll())||[];
    // Session-memory rows (e.g. quota overflow) overlay persistent rows by id.
    const merged=new Map(persistent.map(row=>[row.id,row]));
    for(const [id,row] of memoryBeatStore)merged.set(id,row);
    return [...merged.values()];
  }catch(e){
    enableDbFallback(e);
    return [...memoryBeatStore.values()];
  }
}

function beatImportIdentity(value){
  const blob=value?.blob||value;
  const name=String(value?.name||blob?.name||"").trim().toLowerCase();
  if(!name)return "";
  const size=Number(value?.fileSize??blob?.size??value?.size??0);
  const lastModified=Number(value?.fileLastModified??blob?.lastModified??value?.lastModified??0);
  return `${name}\u0000${size}\u0000${lastModified}`;
}

function beatCacheId(name){
  return `${BEAT_FOLDER_CACHE_PREFIX}${String(name).toLowerCase()}`;
}

async function cacheBeatDirectoryFile(file){
  await dbPut({
    id:beatCacheId(file.name),
    name:file.name,
    blob:file,
    created:file.lastModified||Date.now(),
    duration:null,
    source:"beat-folder-cache"
  },{flashLamp:false});
}

async function clearBeatDirectoryCache(){
  const rows=await dbAll();
  for(const row of rows){
    if(String(row.id||"").startsWith(BEAT_FOLDER_CACHE_PREFIX)){
      await dbDelete(row.id);
    }
  }
}


let visibleLibraryRowsState=[];
let beatDirectoryHandle=null;
let beatDirectoryRows=[];
let trackLoadSequence=0;
let deckTransportSequence=0;


function beatFolderSupported(){
  return "showDirectoryPicker" in window;
}

async function beatFolderPermission(mode="read"){
  if(!beatDirectoryHandle)return "denied";
  if(!beatDirectoryHandle.queryPermission)return "granted";
  try{
    return await beatDirectoryHandle.queryPermission({mode});
  }catch{
    return "denied";
  }
}

function updateBeatFolderStatus(text){
  const el=$("beatImportStatus");
  if(el)el.textContent=text;
}

async function normalizeBeatDirectoryHandle(selectedHandle){
  if(!selectedHandle)throw new Error("Aucun dossier sélectionné");

  if(selectedHandle.name.toLowerCase()==="beat_scratch"){
    return selectedHandle;
  }

  // If the user selected K:\ (or another parent), only accept it if the
  // required beat_scratch child really exists. Never silently save elsewhere.
  try{
    return await selectedHandle.getDirectoryHandle("beat_scratch",{create:false});
  }catch{
    throw new Error('Sélectionne exactement K:\\beat_scratch (ou K:\\ contenant déjà beat_scratch)');
  }
}

async function scanBeatDirectory(){
  if(!beatDirectoryHandle){
    beatDirectoryRows=[];
    return beatDirectoryRows;
  }

  const permission=await beatFolderPermission("read");
  if(permission!=="granted"){
    updateBeatFolderStatus("K:\\beat_scratch • autorisation requise • CONNECT");
    return beatDirectoryRows;
  }

  try{
    const nextRows=[];
    const cacheCandidates=[];
    let skippedLarge=0;
    let cacheBytes=0;

    for await(const entry of beatDirectoryHandle.values()){
      if(entry.kind!=="file" || !audioExt.test(entry.name))continue;
      const file=await entry.getFile();
      if(file.size>MAX_BEAT_FILE_BYTES){ skippedLarge++; continue; }

      nextRows.push({
        id:`beat-folder:${entry.name}`,
        name:entry.name,
        blob:file,
        created:file.lastModified||0,
        duration:null,
        source:"beat-folder"
      });

      if(cacheCandidates.length<MAX_BEAT_CACHE_FILES && cacheBytes+file.size<=MAX_BEAT_CACHE_BYTES){
        cacheCandidates.push(file);
        cacheBytes+=file.size;
      }
    }

    // Only replace the old cache after a complete successful directory scan.
    beatDirectoryRows=nextRows;
    await clearBeatDirectoryCache();
    let cached=0;
    for(const file of cacheCandidates){
      try{ await cacheBeatDirectoryFile(file); cached++; }
      catch(e){ console.warn("Beat cache stopped:",e); break; }
    }

    const extras=[];
    if(skippedLarge)extras.push(`${skippedLarge} trop volumineux ignoré${skippedLarge>1?"s":""}`);
    if(cached<nextRows.length)extras.push(`cache ${cached}/${nextRows.length}`);
    updateBeatFolderStatus(`K:\\beat_scratch • ${nextRows.length} beats • connecté${extras.length?` • ${extras.join(" • ")}`:""}`);
  }catch(e){
    updateBeatFolderStatus("K:\\beat_scratch • scan error");
    console.warn("Beat folder scan:",e);
  }

  return beatDirectoryRows;
}
async function connectBeatDirectory(mode="read"){
  if(!beatFolderSupported()){
    updateBeatFolderStatus("Chrome/Edge requis pour l'accès direct au dossier");
    return false;
  }

  const pickerMode=mode==="readwrite"?"readwrite":"read";
  try{
    const selected=await window.showDirectoryPicker({
      id:"scratch-beat-folder",
      mode:pickerMode
    });

    beatDirectoryHandle=await normalizeBeatDirectoryHandle(selected);
    await scanBeatDirectory();
    await refreshLibrary(false);
    return true;
  }catch(e){
    if(e?.name!=="AbortError"){
      updateBeatFolderStatus(`Folder error: ${e.message}`);
      setBeatSaveStatus(`FOLDER ERROR: ${e.message}`,"error");
    }
    return false;
  }
}

async function ensureBeatDirectoryWriteAccess(){
  if(beatDirectoryHandle){
    let permission=await beatFolderPermission("readwrite");
    if(permission!=="granted" && beatDirectoryHandle.requestPermission){
      try{
        permission=await beatDirectoryHandle.requestPermission({mode:"readwrite"});
      }catch{}
    }
    if(permission==="granted")return true;
  }
  return connectBeatDirectory("readwrite");
}

function safeBeatFilename(name){
  let out=String(name||"SCRATCH_BEAT")
    .replace(/\.[^.]+$/," ")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g,"_")
    .replace(/\s+/g," ")
    .trim()
    .replace(/[ .]+$/g,"")
    .slice(0,90);

  // Windows device names remain reserved even with an extension.
  if(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(out))out=`_${out}`;
  return out || "SCRATCH_BEAT";
}
function timestampForFilename(){
  const d=new Date();
  const p=n=>String(n).padStart(2,"0");
  const ms=String(d.getMilliseconds()).padStart(3,"0");
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${ms}`;
}

function setBeatSaveStatus(text,state=""){
  const el=$("beatSaveStatus");
  el.textContent=text;
  el.classList.toggle("error",state==="error");
  el.classList.toggle("ok",state==="ok");
}

function downloadBeatFallback(blob,filename){
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}

async function saveBlobToBeatDirectory(blob,baseName){
  const ok=await ensureBeatDirectoryWriteAccess();
  if(!ok)throw new Error("dossier K:\\beat_scratch non autorisé");

  const filename=`${safeBeatFilename(baseName)}_${timestampForFilename()}.wav`;
  const fileHandle=await beatDirectoryHandle.getFileHandle(filename,{create:true});
  const writable=await fileHandle.createWritable({keepExistingData:false});
  try{
    await writable.write(blob);
    await writable.close();
  }catch(error){
    try{ await writable.abort(); }catch{}
    throw error;
  }

  const savedFile=await fileHandle.getFile();
  if(!savedFile || savedFile.size<44){
    throw new Error("le fichier créé est vide");
  }

  // Cache the just-written beat immediately, then rescan the real folder.
  await cacheBeatDirectoryFile(savedFile);
  await scanBeatDirectory();
  await refreshLibrary(false);

  return {
    filename,
    size:savedFile.size,
    directory:"K:\\beat_scratch"
  };
}

async function importBeatFiles(files){
  const selected=[...(files||[])];
  const items=selected.filter(isAudioFile);
  const loadRequest=++trackLoadSequence;
  const storedRows=await dedupeStoredImportedBeats(await dbAll());
  const importedByIdentity=new Map();
  for(const row of storedRows){
    if(row.source!=="user-import")continue;
    const identity=beatImportIdentity(row);
    if(identity && !importedByIdentity.has(identity))importedByIdentity.set(identity,row);
  }

  let firstImported=null;
  let imported=0;
  let skipped=selected.length-items.length;
  let tooLarge=0;
  let decodeErrors=0;
  let duplicates=0;

  for(const file of items){
    if(file.size>MAX_BEAT_FILE_BYTES){ tooLarge++; continue; }

    const identity=beatImportIdentity(file);
    const existing=identity?importedByIdentity.get(identity):null;
    if(existing){
      duplicates++;
      if(!firstImported){
        try{
          const buffer=await decodeFile(file);
          firstImported={row:existing,buffer};
        }catch(e){
          decodeErrors++;
          console.warn("Import duplicate decode skip",file.name,e);
        }
      }
      continue;
    }

    try{
      const buffer=await decodeFile(file);
      const row={
        id:localId(),
        name:file.name,
        blob:file,
        fileSize:file.size,
        fileLastModified:file.lastModified||0,
        created:Date.now(),
        duration:buffer.duration,
        source:"user-import"
      };
      await dbPut(row);
      imported++;
      if(identity)importedByIdentity.set(identity,row);
      if(!firstImported)firstImported={row,buffer};
    }catch(e){
      decodeErrors++;
      console.warn("Import skip",file.name,e);
    }
  }

  // LOAD -> ready immediately. Re-selecting an existing beat loads it
  // without creating another IndexedDB row.
  if(firstImported && loadRequest===trackLoadSequence){
    if(deckSource)stopDeck();
    commitLoadedTrack(firstImported.row,firstImported.buffer);
  }
  await refreshLibrary(false);
  return {imported,skipped,tooLarge,decodeErrors,duplicates,total:selected.length};
}

function isFolderBeat(row){
  return row.source==="beat-folder"||row.source==="beat-folder-cache";
}

function readBeatCrateKeySet(storageKey){
  try{
    const saved=JSON.parse(localStorage.getItem(storageKey)||"[]");
    return new Set(Array.isArray(saved)?saved.filter(value=>typeof value==="string"):[]);
  }catch{
    return new Set();
  }
}

function persistBeatCrateKeySet(storageKey,keySet){
  try{ localStorage.setItem(storageKey,JSON.stringify([...keySet])); }catch{}
}

function beatCrateKey(row){
  if(isFolderBeat(row))return `library:${String(row.name||"").toLowerCase()}`;
  return `import:${String(row.id||row.name||"")}`;
}

function importedBeatDuplicateGroups(rows,currentId=null){
  const rowsByIdentity=new Map();
  for(const row of rows){
    if(row.source!=="user-import")continue;
    const identity=beatImportIdentity(row);
    if(!identity)continue;
    if(!rowsByIdentity.has(identity))rowsByIdentity.set(identity,[]);
    rowsByIdentity.get(identity).push(row);
  }

  const groups=[];
  for(const members of rowsByIdentity.values()){
    if(members.length<2)continue;
    let keeper=currentId?members.find(row=>row.id===currentId):null;
    if(!keeper){
      keeper=[...members].sort((a,b)=>(a.created||0)-(b.created||0)||String(a.id||"").localeCompare(String(b.id||"")))[0];
    }
    groups.push({keeper,duplicates:members.filter(row=>row.id!==keeper.id)});
  }
  return groups;
}

async function dedupeStoredImportedBeats(rows){
  const groups=importedBeatDuplicateGroups(rows,currentTrack?.id||null);
  if(!groups.length)return rows;

  const duplicateIds=[];
  let favoritesChanged=false;
  let setChanged=false;

  for(const {keeper,duplicates} of groups){
    const members=[keeper,...duplicates];
    const keeperKey=beatCrateKey(keeper);
    const keepFavorite=members.some(row=>beatCrateFavoritesState.has(beatCrateKey(row)));
    const keepSet=members.some(row=>beatCrateSetState.has(beatCrateKey(row)));

    for(const duplicate of duplicates){
      duplicateIds.push(duplicate.id);
      const duplicateKey=beatCrateKey(duplicate);
      if(beatCrateFavoritesState.delete(duplicateKey))favoritesChanged=true;
      if(beatCrateSetState.delete(duplicateKey))setChanged=true;
    }

    if(keepFavorite && !beatCrateFavoritesState.has(keeperKey)){
      beatCrateFavoritesState.add(keeperKey);
      favoritesChanged=true;
    }
    if(keepSet && !beatCrateSetState.has(keeperKey)){
      beatCrateSetState.add(keeperKey);
      setChanged=true;
    }
  }

  if(favoritesChanged)persistBeatCrateKeySet(BEAT_CRATE_FAVORITES_KEY,beatCrateFavoritesState);
  if(setChanged)persistBeatCrateKeySet(BEAT_CRATE_SET_KEY,beatCrateSetState);
  await dbDeleteMany(duplicateIds);

  const removed=new Set(duplicateIds);
  return rows.filter(row=>!removed.has(row.id));
}

function beatCrateTone(row){
  const seed=beatCrateKey(row);
  let hash=0;
  for(let i=0;i<seed.length;i++)hash=(hash*31+seed.charCodeAt(i))>>>0;
  return hash%5;
}

function removeBeatCrateKey(row){
  const key=beatCrateKey(row);
  const favRemoved=beatCrateFavoritesState.delete(key);
  const setRemoved=beatCrateSetState.delete(key);
  if(favRemoved)persistBeatCrateKeySet(BEAT_CRATE_FAVORITES_KEY,beatCrateFavoritesState);
  if(setRemoved)persistBeatCrateKeySet(BEAT_CRATE_SET_KEY,beatCrateSetState);
}

function pruneBeatCrateState(rows){
  const available=new Set(rows.map(beatCrateKey));
  let favChanged=false;
  let setChanged=false;
  // Local-library membership must survive sessions where only part of the
  // folder cache is available before the user reconnects the real directory.
  for(const key of [...beatCrateFavoritesState]){
    if(key.startsWith("import:") && !available.has(key)){ beatCrateFavoritesState.delete(key); favChanged=true; }
  }
  for(const key of [...beatCrateSetState]){
    if(key.startsWith("import:") && !available.has(key)){ beatCrateSetState.delete(key); setChanged=true; }
  }
  if(favChanged)persistBeatCrateKeySet(BEAT_CRATE_FAVORITES_KEY,beatCrateFavoritesState);
  if(setChanged)persistBeatCrateKeySet(BEAT_CRATE_SET_KEY,beatCrateSetState);
}

function setBeatCrateView(view){
  if(!["all","favorites","set"].includes(view))return;
  beatCrateViewState=view;
  void refreshLibrary(false);
}

function toggleBeatCrateFlag(row,flag){
  const key=beatCrateKey(row);
  const keySet=flag==="favorite"?beatCrateFavoritesState:beatCrateSetState;
  const storageKey=flag==="favorite"?BEAT_CRATE_FAVORITES_KEY:BEAT_CRATE_SET_KEY;
  if(keySet.has(key))keySet.delete(key);
  else keySet.add(key);
  persistBeatCrateKeySet(storageKey,keySet);
  void refreshLibrary(false);
}

function updateBeatCrateStatus(text){
  const status=document.querySelector("#looper .crateModeStatus");
  if(status)status.textContent=text;
}

function relativeTrackIndex(rows,currentId,delta){
  if(!rows.length)return -1;
  let currentIndex=rows.findIndex(row=>row.id===currentId);
  if(currentIndex<0)currentIndex=delta>0?-1:0;
  return (currentIndex+delta+rows.length)%rows.length;
}

function mergeLibraryRows(dbRows){
  const cachedRows=dbRows.filter(row=>row.source==="beat-folder-cache");
  const normalRows=dbRows.filter(row=>row.source!=="beat-folder-cache");
  const liveNames=new Set(beatDirectoryRows.map(row=>row.name.toLowerCase()));
  const cachedOnly=cachedRows.filter(row=>!liveNames.has(row.name.toLowerCase()));
  const folderNames=new Set([
    ...beatDirectoryRows.map(row=>row.name.toLowerCase()),
    ...cachedOnly.map(row=>row.name.toLowerCase())
  ]);

  return [
    ...beatDirectoryRows,
    ...cachedOnly,
    ...normalRows.filter(row=>!folderNames.has(row.name.toLowerCase()))
  ];
}

function visibleLibraryRows(rows,query,order){
  const normalizedQuery=String(query||"").trim().toLowerCase();
  return rows
    .filter(row=>{
      if(normalizedQuery && !row.name.toLowerCase().includes(normalizedQuery))return false;
      const key=beatCrateKey(row);
      if(beatCrateViewState==="favorites")return beatCrateFavoritesState.has(key);
      if(beatCrateViewState==="set")return beatCrateSetState.has(key);
      return true;
    })
    .sort((a,b)=>{
      if(order==="recent")return (b.created||0)-(a.created||0);
      return a.name.localeCompare(b.name);
    });
}

function createBeatCrateModeButton(view,label,count){
  const button=document.createElement("button");
  button.type="button";
  button.className="crateModeButton";
  button.dataset.crateView=view;
  button.setAttribute("aria-pressed",beatCrateViewState===view?"true":"false");
  button.textContent=`${label} ${count}`;
  button.onclick=()=>setBeatCrateView(view);
  return button;
}

function createBeatCrateToolbar(allRows){
  const toolbar=document.createElement("div");
  toolbar.className="beatCrateToolbar";

  const modes=document.createElement("div");
  modes.className="crateModeGroup";
  modes.setAttribute("role","group");
  modes.setAttribute("aria-label","Vue de la Beat Crate");
  const favoriteCount=allRows.filter(row=>beatCrateFavoritesState.has(beatCrateKey(row))).length;
  const setCount=allRows.filter(row=>beatCrateSetState.has(beatCrateKey(row))).length;
  modes.append(
    createBeatCrateModeButton("all","ALL",allRows.length),
    createBeatCrateModeButton("favorites","★ FAV",favoriteCount),
    createBeatCrateModeButton("set","SET",setCount)
  );

  const dig=document.createElement("button");
  dig.type="button";
  dig.className="crateDigButton";
  dig.textContent="DIG";
  dig.setAttribute("aria-label","Choisir un beat au hasard dans la vue actuelle");
  dig.onclick=()=>{ void digBeatCrate(); };

  const status=document.createElement("span");
  status.className="crateModeStatus";
  status.setAttribute("aria-live","polite");
  const viewLabel=beatCrateViewState==="favorites"?"FAVORITES":beatCrateViewState==="set"?"SESSION SET":"ALL BEATS";
  status.textContent=`${viewLabel} • ${visibleLibraryRowsState.length}`;

  toolbar.append(modes,dig,status);
  return toolbar;
}

function createCrateBeat(row){
  const key=beatCrateKey(row);
  const folderSource=isFolderBeat(row);
  const favorite=beatCrateFavoritesState.has(key);
  const inSet=beatCrateSetState.has(key);
  const active=!!currentTrack && beatCrateKey(currentTrack)===key;
  const el=document.createElement("article");
  el.className=`crateBeat${active?" active":""}`;
  const tone=beatCrateTone(row);

  const load=document.createElement("button");
  load.className="crateBeatLoad";
  load.type="button";
  load.setAttribute("aria-label",`Charger ${row.label||shortName(row.name)}`);

  const art=document.createElement("span");
  art.className="crateBeatArt";
  art.style.backgroundPosition=`${tone*25}% 50%`;
  art.setAttribute("aria-hidden","true");

  const copy=document.createElement("span");
  copy.className="crateBeatCopy";
  const title=document.createElement("strong");
  title.textContent=row.label||shortName(row.name,28);
  const meta=document.createElement("small");
  meta.textContent=`LOAD • ${folderSource?"LOCAL LIBRARY":"USER IMPORT"} • ${row.duration?row.duration.toFixed(1):"?"} s`;
  copy.append(title,meta);
  load.append(art,copy);

  const actions=document.createElement("div");
  actions.className="crateBeatActions";

  const fav=document.createElement("button");
  fav.type="button";
  fav.className="crateFlag crateFavorite";
  fav.textContent="★";
  fav.setAttribute("aria-pressed",favorite?"true":"false");
  fav.setAttribute("aria-label",`${favorite?"Retirer des":"Ajouter aux"} favoris : ${shortName(row.name)}`);
  fav.onclick=()=>toggleBeatCrateFlag(row,"favorite");

  const set=document.createElement("button");
  set.type="button";
  set.className="crateFlag crateSetFlag";
  set.textContent="SET";
  set.setAttribute("aria-pressed",inSet?"true":"false");
  set.setAttribute("aria-label",`${inSet?"Retirer du":"Ajouter au"} set : ${shortName(row.name)}`);
  set.onclick=()=>toggleBeatCrateFlag(row,"set");

  actions.append(fav,set);

  if(folderSource){
    const source=document.createElement("span");
    source.className="crateBeatSource";
    source.textContent="LIB";
    source.title="Beat protégé de la bibliothèque locale";
    actions.appendChild(source);
  }else{
    const remove=document.createElement("button");
    remove.className="crateBeatDelete";
    remove.type="button";
    remove.textContent="×";
    remove.setAttribute("aria-label",`Supprimer ${shortName(row.name)}`);
    remove.onclick=async()=>{
      const deletingCurrent=!!currentTrack && beatCrateKey(currentTrack)===key;
      if(deletingCurrent){
        stopDeck();
        currentTrack=null;
        deckBuffer=null;
        $("deckTrack").textContent="Aucun beat chargé";
        $("deckInfo").textContent="Importe un WAV/MP3 pour commencer.";
        refreshCassetteUI();
      }
      removeBeatCrateKey(row);
      await dbDelete(row.id);
      await refreshLibrary(false);
    };
    actions.appendChild(remove);
  }

  load.onclick=()=>{
    void switchTrack(row).catch(error=>{
      console.error("Beat load:",error);
      updateBeatFolderStatus(`LOAD ERROR • ${safeErrorMessage(error)}`);
    });
  };
  el.append(load,actions);
  return el;
}

function renderLibraryRows(rows,allRows){
  const box=$("library");
  const grid=document.createElement("div");
  grid.className="beatCrateGrid";

  if(rows.length){
    for(const row of rows)grid.appendChild(createCrateBeat(row));
  }else{
    const empty=document.createElement("div");
    empty.className="crateEmptyState";
    empty.textContent=beatCrateViewState==="favorites"
      ? "AUCUN FAVORI • ★ AJOUTE TES BEATS"
      : beatCrateViewState==="set"
        ? "SET VIDE • AJOUTE DES BEATS"
        : "AUCUN BEAT DANS LA CRATE";
    grid.appendChild(empty);
  }

  box.replaceChildren(createBeatCrateToolbar(allRows),grid);
}

async function refreshLibrary(rescanDirectory=true){
  let dbRows=await dedupeStoredImportedBeats(await dbAll());

  if(rescanDirectory && beatDirectoryHandle && await beatFolderPermission("read")==="granted"){
    await scanBeatDirectory();
    dbRows=await dedupeStoredImportedBeats(await dbAll());
  }

  const mergedRows=mergeLibraryRows(dbRows);
  pruneBeatCrateState(mergedRows);
  visibleLibraryRowsState=visibleLibraryRows(
    mergedRows,
    $("librarySearch").value,
    $("libraryOrder").value
  );
  renderLibraryRows(visibleLibraryRowsState,mergedRows);
}

async function digBeatCrate(){
  if(!visibleLibraryRowsState.length){
    updateBeatCrateStatus("DIG • CRATE VIDE");
    return false;
  }

  const currentKey=currentTrack?beatCrateKey(currentTrack):null;
  let candidates=visibleLibraryRowsState.filter(row=>{
    const key=beatCrateKey(row);
    return key!==currentKey && !beatCrateDigHistory.includes(key);
  });
  if(!candidates.length)candidates=visibleLibraryRowsState.filter(row=>beatCrateKey(row)!==currentKey);
  if(!candidates.length)candidates=[...visibleLibraryRowsState];

  const row=candidates[Math.floor(Math.random()*candidates.length)];
  const key=beatCrateKey(row);
  beatCrateDigHistory.push(key);
  if(beatCrateDigHistory.length>BEAT_CRATE_DIG_HISTORY_LIMIT)beatCrateDigHistory.shift();
  await switchTrack(row);
  updateBeatCrateStatus(`DIG • ${shortName(row.name,24).toUpperCase()}`);
  return true;
}

async function decodeTrackAudio(row){
  if(!row)throw new Error("Beat introuvable");
  await ensureAudio();
  if(!row.blob)throw new Error("Source audio introuvable");
  assertLocalFileSize(row.blob,MAX_BEAT_FILE_BYTES,"beat");
  const bytes=await row.blob.arrayBuffer();
  return await ctx.decodeAudioData(bytes);
}

function commitLoadedTrack(row,decoded){
  currentTrack=row;
  deckBuffer=decoded;
  row.duration=deckBuffer.duration;

  // Every newly loaded beat starts at its original speed and neutral pitch.
  autoLooperSpeedPercent=100;
  looperSpeedRateLevel=0;
  looperPitchPercent=0;
  autoLooperEnabledState=false;
  stopAutoLooperProgress();
  const pitch=$("deckPitch");
  if(pitch)pitch.value="0";
  $("deckTrack").textContent=row.name;
  $("deckInfo").textContent=`${deckBuffer.duration.toFixed(1)} s • original speed`;
  refreshCassetteUI();
}

async function loadTrack(row,{preservePlayback=false}={}){
  const request=++trackLoadSequence;
  const decoded=await decodeTrackAudio(row);
  if(request!==trackLoadSequence)return false;

  // Read the transport state after decoding: a STOP pressed during a slow
  // decode must stay stopped, while an active deck should resume the new beat.
  const resumePlayback=preservePlayback && !!deckSource;
  if(resumePlayback)stopDeck();
  commitLoadedTrack(row,decoded);
  if(resumePlayback)await playDeck();
  await refreshLibrary(false);
  return true;
}

async function switchTrack(row){
  return loadTrack(row,{preservePlayback:true});
}

function deckRate(){
  return (autoLooperSpeedPercent/100)*(1+looperPitchPercent/100);
}

function formatDeckRate(){
  return `${Math.round(deckRate()*100)}%`;
}

function syncDeckPlaybackRate(){
  if(deckSource)deckSource.playbackRate.value=deckRate();
}

function refreshAutoLooperCompact(){
  const btn=$("autoLooperToggle");
  const status=$("autoLooperCompactStatus");
  const deck=$("looperDropzoneBtn");
  const speed=$("deckSpeedReadout");
  const speedEcho=$("deckSpeedEcho");
  const auto=$("deckAutoReadout");
  const autoButton=$("deckAutoToggle");
  const pitchControl=$("deckPitch");
  const pitchReadout=$("deckPitchReadout");
  const pitchModule=$("deckPitchModule");
  if(!btn || !status) return;

  // Compact cassette tape moves at 4.75 cm/s. Keep the visual reels tied to
  // the actual deck playback rate instead of using a decorative fixed spin.
  if(deck){
    const rate=Math.max(.01,deckRate());
    deck.style.setProperty("--supply-reel-cycle",`${(SUPPLY_REEL_CYCLE_SECONDS/rate).toFixed(3)}s`);
    deck.style.setProperty("--takeup-reel-cycle",`${(TAKEUP_REEL_CYCLE_SECONDS/rate).toFixed(3)}s`);
  }

  btn.dataset.speedLevel=String(looperSpeedRateLevel);
  btn.setAttribute("aria-pressed",looperSpeedRateLevel ? "true" : "false");
  btn.setAttribute("aria-label",looperSpeedRateLevel
    ? `Speed Up niveau ${looperSpeedRateLevel}, plus ${looperSpeedRateLevel} pour cent toutes les huit boucles`
    : "Speed Up désactivé"
  );
  if(autoButton)autoButton.setAttribute("aria-pressed",autoLooperEnabledState ? "true" : "false");
  const formattedRate=formatDeckRate();
  if(speed)speed.textContent=formattedRate;
  if(speedEcho)speedEcho.textContent=formattedRate;
  if(auto)auto.textContent=autoLooperEnabledState ? "ON" : "OFF";
  const pitchLabel=`${looperPitchPercent>0?"+":""}${looperPitchPercent.toFixed(1)}%`;
  if(pitchReadout)pitchReadout.textContent=pitchLabel;
  if(pitchControl)pitchControl.setAttribute("aria-valuetext",pitchLabel);
  if(pitchModule){
    const pitchProgress=(looperPitchPercent+8)/16;
    pitchModule.style.setProperty("--pitch-x",`${(18+pitchProgress*58).toFixed(2)}%`);
    pitchModule.style.setProperty("--pitch-y",`${(70-pitchProgress*50).toFixed(2)}%`);
  }

  status.textContent=looperSpeedRateLevel
    ? `+${looperSpeedRateLevel}% • ${autoLooperLoopCount}/${AUTO_LOOP_BATCH}`
    : "OFF";
}

function resetAutoLooperProgress(){
  autoLooperSourceSeconds=0;
  autoLooperLoopCount=0;
  autoLooperLastCtxTime=ctx?.currentTime||0;
  refreshAutoLooperCompact();
}

function stopAutoLooperProgress(){
  if(autoLooperTimer){
    clearInterval(autoLooperTimer);
    autoLooperTimer=null;
  }
  autoLooperLastCtxTime=0;
  autoLooperSourceSeconds=0;
  autoLooperLoopCount=0;
  refreshAutoLooperCompact();
}

function applyAutoLooperIncrement(){
  if(!looperSpeedRateLevel || autoLooperSpeedPercent>=AUTO_SPEED_MAX_PERCENT)return;

  autoLooperSpeedPercent=Math.min(
    AUTO_SPEED_MAX_PERCENT,
    autoLooperSpeedPercent+looperSpeedRateLevel
  );
  syncDeckPlaybackRate();
  refreshAutoLooperCompact();
}

function startAutoLooperProgress(){
  if(autoLooperTimer) clearInterval(autoLooperTimer);
  resetAutoLooperProgress();
  autoLooperTimer=setInterval(()=>{
    if(!deckSource || !deckBuffer || !ctx) return;

    const now=ctx.currentTime;
    const delta=Math.max(0,now-autoLooperLastCtxTime);
    autoLooperLastCtxTime=now;
    autoLooperSourceSeconds += delta * deckRate();

    const dur=Math.max(.01,deckBuffer.duration);
    while(autoLooperSourceSeconds>=dur){
      autoLooperSourceSeconds-=dur;
      autoLooperLoopCount++;

      if(autoLooperLoopCount>=AUTO_LOOP_BATCH){
        autoLooperLoopCount=0;
        if(autoLooperEnabledState){
          applyAutoLooperIncrement();
        }
      }
    }

    refreshAutoLooperCompact();
  },AUTO_PROGRESS_INTERVAL_MS);
}

function toggleAutoLooper(){
  looperSpeedRateLevel=(looperSpeedRateLevel+1)%6;
  autoLooperEnabledState=looperSpeedRateLevel!==0;

  if(autoLooperEnabledState){
    if(deckSource)startAutoLooperProgress();
    else resetAutoLooperProgress();
  }else{
    autoLooperSpeedPercent=100;
    syncDeckPlaybackRate();
    stopAutoLooperProgress();
  }

  refreshAutoLooperCompact();
}

function toggleDeckAuto(){
  if(!looperSpeedRateLevel)looperSpeedRateLevel=1;
  autoLooperEnabledState=!autoLooperEnabledState;
  if(autoLooperEnabledState){
    if(deckSource)startAutoLooperProgress();
    else resetAutoLooperProgress();
  }else{
    stopAutoLooperProgress();
  }
  refreshAutoLooperCompact();
}

function setLooperPitch(value){
  const parsed=Number(value);
  looperPitchPercent=Math.max(-8,Math.min(8,Number.isFinite(parsed)?parsed:0));
  autoLooperEnabledState=false;
  stopAutoLooperProgress();
  syncDeckPlaybackRate();
  refreshCassetteUI();
  refreshAutoLooperCompact();
}

async function playDeck(){
  const request=++deckTransportSequence;
  if(!deckBuffer)return false;

  const buffer=deckBuffer;
  await ensureAudio();
  if(request!==deckTransportSequence || buffer!==deckBuffer)return false;
  stopDeck({cancelPendingPlay:false});

  deckSource=ctx.createBufferSource();
  deckOutputGain=ctx.createGain();
  deckOutputGain.gain.value=1;

  deckSource.buffer=buffer;
  deckSource.loop=true;
  deckSource.playbackRate.value=deckRate();
  deckSource.connect(deckOutputGain);
  deckOutputGain.connect(liveBus);

  deckSource.start(0);
  if(autoLooperEnabledState)startAutoLooperProgress();
  else stopAutoLooperProgress();
  refreshCassetteUI();
  return true;
}

function stopDeck({cancelPendingPlay=true}={}){
  if(cancelPendingPlay)deckTransportSequence++;
  stopAutoLooperProgress();
  if(deckSource){
    try{deckSource.stop()}catch{}
    try{deckSource.disconnect()}catch{}
    deckSource=null;
  }
  if(deckOutputGain){
    try{deckOutputGain.disconnect()}catch{}
    deckOutputGain=null;
  }
  refreshCassetteUI();
}

async function toggleDeckPlayback(){
  if(deckSource){
    stopDeck();
    return false;
  }
  return playDeck();
}


async function selectRelative(delta){
  if(!visibleLibraryRowsState.length)return;
  const idx=relativeTrackIndex(visibleLibraryRowsState,currentTrack?.id,delta);
  await switchTrack(visibleLibraryRowsState[idx]);
}