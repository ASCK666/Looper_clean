"use strict";

// looper-next: make remembered KICK / SNARE / HAT handles actually usable after
// a reload. A browser may keep the FileSystemDirectoryHandle in IndexedDB while
// resetting its read permission to "prompt". In that case we keep the handle as
// remembered state, but never expose it as a mounted drum folder until entries
// have been scanned successfully.
(() => {
  const root=document.getElementById("chopper");
  const persistence=globalThis.ChopperFolderPersistence;
  if(!root || !persistence || root.dataset.folderReconnectInstalled==="1")return;
  if(typeof persistence.readHandle!=="function" || typeof persistence.mountDrumHandle!=="function")return;
  root.dataset.folderReconnectInstalled="1";

  const DRUM_KEYS=Object.freeze(["kick","snare","hat"]);
  const remembered=new Map();
  const DB_NAME=persistence.dbName||"scratch-practice-folder-handles";
  const STORE_NAME="handles";
  let primePromise=null;
  let reconnectPromise=null;
  let drumUseGuard=0;

  function drumStatus(text){
    const status=document.getElementById("drumStatus");
    if(status)status.textContent=text;
  }

  function mounted(kind){
    return !!drumDirectoryHandles[kind] && (drumDirectoryEntries[kind]||[]).length>0;
  }

  function clearStaleMount(kind,handle){
    if((drumDirectoryEntries[kind]||[]).length)return;
    if(!handle || drumDirectoryHandles[kind]===handle)drumDirectoryHandles[kind]=null;
    drumDirectoryEntries[kind]=[];
  }

  async function queryReadPermission(handle){
    if(!handle)return "denied";
    if(typeof handle.queryPermission!=="function")return "granted";
    try{return await handle.queryPermission({mode:"read"});}
    catch{return "denied";}
  }

  async function requestReadPermission(handle){
    let permission=await queryReadPermission(handle);
    if(permission==="granted")return permission;
    if(typeof handle?.requestPermission!=="function")return permission;
    try{return await handle.requestPermission({mode:"read"});}
    catch{return "denied";}
  }

  async function primeRememberedDrumHandles(force=false){
    if(force){
      primePromise=null;
      remembered.clear();
    }
    if(primePromise)return await primePromise;
    primePromise=(async()=>{
      const rows=await Promise.all(DRUM_KEYS.map(async kind=>{
        const handle=await persistence.readHandle(kind);
        return [kind,handle];
      }));
      for(const [kind,handle] of rows){
        if(handle)remembered.set(kind,handle);
      }
      return [...remembered.keys()];
    })();
    try{return await primePromise;}
    catch(error){
      primePromise=null;
      console.warn("Prime remembered drum folders:",error);
      return [];
    }
  }

  function stateSnapshot(restored=[]){
    const pending=DRUM_KEYS.filter(kind=>remembered.has(kind) && !mounted(kind));
    const missing=DRUM_KEYS.filter(kind=>!remembered.has(kind));
    return {restored:[...restored],pending,missing};
  }

  async function restoreRememberedDrumFolders({silent=false}={}){
    await primeRememberedDrumHandles();
    const restored=[];

    for(const kind of DRUM_KEYS){
      const handle=remembered.get(kind);
      if(!handle)continue;
      if(mounted(kind)){
        restored.push(kind);
        continue;
      }

      const permission=await queryReadPermission(handle);
      if(permission!=="granted"){
        // Critical fix: a remembered-but-ungranted handle is not a mounted
        // directory. Leaving it in drumDirectoryHandles with zero entries made
        // the previous implementation look restored while it was not usable.
        clearStaleMount(kind,handle);
        continue;
      }

      if(await persistence.mountDrumHandle(kind,handle))restored.push(kind);
      else clearStaleMount(kind,handle);
    }

    const state=stateSnapshot(restored);
    if(!silent){
      if(state.pending.length){
        drumStatus(`FOLDERS SAVED • RECONNECT ${state.pending.map(x=>x.toUpperCase()).join(" / ")}`);
      }else if(state.restored.length){
        drumStatus(`FOLDERS RESTORED • ${state.restored.map(x=>x.toUpperCase()).join(" / ")} ✓`);
      }
    }
    return state;
  }

  async function reconnectRememberedDrumFolders({silent=false}={}){
    if(reconnectPromise)return await reconnectPromise;

    reconnectPromise=(async()=>{
      await primeRememberedDrumHandles();
      const restored=[];

      for(const kind of DRUM_KEYS){
        const handle=remembered.get(kind);
        if(!handle)continue;
        if(mounted(kind)){
          restored.push(kind);
          continue;
        }

        const permission=await requestReadPermission(handle);
        if(permission!=="granted"){
          clearStaleMount(kind,handle);
          continue;
        }

        if(await persistence.mountDrumHandle(kind,handle))restored.push(kind);
        else clearStaleMount(kind,handle);
      }

      const state=stateSnapshot(restored);
      if(!silent){
        if(state.pending.length){
          drumStatus(`FOLDERS SAVED • ALLOW ${state.pending.map(x=>x.toUpperCase()).join(" / ")} TO RECONNECT`);
        }else if(state.restored.length){
          drumStatus(`FOLDERS RECONNECTED • ${state.restored.map(x=>x.toUpperCase()).join(" / ")} ✓`);
        }
      }
      return state;
    })();

    try{return await reconnectPromise;}
    finally{reconnectPromise=null;}
  }

  async function readPersistedHandle(kind){
    if(!globalThis.indexedDB)return null;
    try{
      const db=await new Promise((resolve,reject)=>{
        const request=indexedDB.open(DB_NAME);
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error||new Error("Folder database open failed"));
      });
      if(!db.objectStoreNames.contains(STORE_NAME))return null;
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_NAME,"readonly");
        const request=tx.objectStore(STORE_NAME).get(kind);
        request.onsuccess=()=>resolve(request.result?.handle||null);
        request.onerror=()=>reject(request.error||new Error("Folder verification failed"));
      });
    }catch{return null;}
  }

  async function verifyPersistedHandle(kind,handle){
    if(!handle)return false;
    const stored=await readPersistedHandle(kind);
    if(!stored)return false;
    if(typeof handle.isSameEntry==="function"){
      try{return await handle.isSameEntry(stored);}
      catch{return false;}
    }
    return stored.kind===handle.kind && stored.name===handle.name;
  }

  async function requireRememberedDrums(){
    const state=await reconnectRememberedDrumFolders({silent:true});
    if(!state.pending.length)return state;
    const names=state.pending.map(x=>x.toUpperCase()).join(" / ");
    const message=`FOLDERS SAVED • ALLOW ${names} TO RECONNECT`;
    drumStatus(message);
    throw new Error(message);
  }

  async function runWithFolderReconnect(base,args){
    if(drumUseGuard || root.dataset.folderPickerBusy==="1")return await base(...args);
    drumUseGuard++;
    try{
      await requireRememberedDrums();
      return await base(...args);
    }finally{
      drumUseGuard--;
    }
  }

  // Every normal drum path now gets one automatic reconnect attempt before it
  // can fall back to synthesized drums. The guard prevents ensureDrumSelection
  // -> generateDrumSelection from requesting the same permission twice.
  if(typeof generateDrumSelection==="function"){
    const generateDrumSelectionBase=generateDrumSelection;
    generateDrumSelection=async function(...args){
      return await runWithFolderReconnect(generateDrumSelectionBase,args);
    };
  }

  if(typeof ensureDrumSelection==="function"){
    const ensureDrumSelectionBase=ensureDrumSelection;
    ensureDrumSelection=async function(...args){
      return await runWithFolderReconnect(ensureDrumSelectionBase,args);
    };
  }

  // Keep intentional folder changes isolated from the automatic reconnect. The
  // maintained picker refreshes drums before it returns, so reconnecting an old
  // remembered handle during that refresh could otherwise overwrite the folder
  // the user just chose.
  if(typeof chooseDrumFolder==="function"){
    const chooseDrumFolderBase=chooseDrumFolder;
    chooseDrumFolder=async function(kind){
      root.dataset.folderPickerBusy="1";
      try{
        const result=await chooseDrumFolderBase(kind);
        await primeRememberedDrumHandles(true);
        const selected=DRUM_KEYS.includes(kind)?drumDirectoryHandles[kind]:null;
        if(selected){
          const persisted=await verifyPersistedHandle(kind,selected);
          if(!persisted){
            drumStatus(`${kind.toUpperCase()} • CONNECTED FOR THIS SESSION • BROWSER DID NOT PERSIST FOLDER ACCESS`);
          }
        }
        return result;
      }finally{
        delete root.dataset.folderPickerBusy;
      }
    };
  }

  // The webkitdirectory fallback can load files, but browsers do not give it a
  // reusable directory handle. Make that limitation explicit instead of making
  // the user think the path was persisted.
  if(typeof setFallbackDrumFolder==="function"){
    const setFallbackDrumFolderBase=setFallbackDrumFolder;
    setFallbackDrumFolder=async function(kind,fileList){
      const ok=await setFallbackDrumFolderBase(kind,fileList);
      if(ok){
        drumStatus(`${kind.toUpperCase()} • SESSION ONLY • FOLDER MEMORY REQUIRES HTTPS/LOCALHOST + CHROMIUM`);
      }
      return ok;
    };
  }

  // Opening the Chopper is already a real user gesture. Use it to reconnect all
  // three saved folders together, so there is no KICK then SNARE then HAT click
  // ritual after each reload.
  const chopperTab=document.querySelector('[data-tab="chopper"]');
  chopperTab?.addEventListener("click",()=>{
    void reconnectRememberedDrumFolders();
  },true);

  const legacyRestore=persistence.restoreDrumFolders;
  persistence.restoreDrumFolders=async()=>{
    const state=await restoreRememberedDrumFolders();
    return state.restored.map(x=>x.toUpperCase());
  };
  persistence.reconnectDrumFolders=reconnectRememberedDrumFolders;
  persistence.primeRememberedDrumHandles=primeRememberedDrumHandles;
  persistence.verifyPersistedHandle=verifyPersistedHandle;
  persistence.folderAccessSupported=!!(
    globalThis.indexedDB && window.isSecureContext && typeof window.showDirectoryPicker==="function"
  );

  globalThis.ChopperFolderReconnect={
    kinds:[...DRUM_KEYS],
    restoreRememberedDrumFolders,
    reconnectRememberedDrumFolders,
    primeRememberedDrumHandles,
    verifyPersistedHandle,
    get state(){return stateSnapshot();},
    legacyRestore
  };

  // Prime IndexedDB before the next user gesture. If permissions are still
  // granted the folders mount immediately; otherwise the handles remain pending
  // and the Chopper-tab/first-drum-action path requests access once.
  void primeRememberedDrumHandles()
    .then(()=>restoreRememberedDrumFolders())
    .catch(error=>console.warn("Remembered drum folder startup restore:",error));
})();