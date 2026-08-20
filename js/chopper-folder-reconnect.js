"use strict";

// looper-next: reliable KICK / SNARE / HAT persistence.
//
// FileSystemDirectoryHandle objects can be serialized into IndexedDB, but browser
// read permission commonly falls back to "prompt" after a reload. That makes a
// remembered handle unsuitable as the only source of truth for a drum machine.
// This module therefore keeps the handle as an optional live-directory shortcut
// while also caching a bounded copy of the selected one-shots in IndexedDB. The
// cached File objects need no filesystem permission and are restored immediately
// on the next page load.
(() => {
  const root=document.getElementById("chopper");
  const persistence=globalThis.ChopperFolderPersistence;
  if(!root || !persistence || root.dataset.folderReconnectInstalled==="1")return;
  root.dataset.folderReconnectInstalled="1";

  const DRUM_KEYS=Object.freeze(["kick","snare","hat"]);
  const DB_NAME="scratch-practice-drum-library-cache";
  const DB_VERSION=1;
  const STORE_NAME="libraries";
  const MAX_CACHE_FILES_PER_KIND=1000;
  const MAX_CACHE_BYTES_PER_KIND=128*1024*1024;
  let dbPromise=null;
  let restorePromise=null;
  let pickerGuard=0;

  function drumStatus(text){
    const status=document.getElementById("drumStatus");
    if(status)status.textContent=text;
  }

  function validKind(kind){
    return DRUM_KEYS.includes(kind);
  }

  function openCacheDb(){
    if(dbPromise)return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      if(!globalThis.indexedDB){
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      let request;
      try{request=indexedDB.open(DB_NAME,DB_VERSION);}
      catch(error){reject(error);return;}
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains(STORE_NAME)){
          db.createObjectStore(STORE_NAME,{keyPath:"kind"});
        }
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error("Drum cache open failed"));
      request.onblocked=()=>reject(new Error("Drum cache blocked"));
    });
    dbPromise.catch(()=>{dbPromise=null;});
    return dbPromise;
  }

  async function readLibrary(kind){
    if(!validKind(kind))return null;
    try{
      const db=await openCacheDb();
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_NAME,"readonly");
        const request=tx.objectStore(STORE_NAME).get(kind);
        request.onsuccess=()=>resolve(request.result||null);
        request.onerror=()=>reject(request.error||new Error("Drum cache read failed"));
      });
    }catch(error){
      console.warn(`Drum cache read (${kind}):`,error?.message||error);
      return null;
    }
  }

  async function writeLibrary(record){
    const db=await openCacheDb();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE_NAME,"readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error||new Error("Drum cache write failed"));
      tx.onabort=()=>reject(tx.error||new Error("Drum cache write aborted"));
    });
  }

  async function removeLibrary(kind){
    if(!validKind(kind))return false;
    try{
      const db=await openCacheDb();
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_NAME,"readwrite");
        tx.objectStore(STORE_NAME).delete(kind);
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error||new Error("Drum cache delete failed"));
      });
      return true;
    }catch{return false;}
  }

  function evenlyLimitFiles(files,maxFiles=MAX_CACHE_FILES_PER_KIND){
    const list=[...files].filter(file=>
      file && isAudioFile(file) && Number(file.size)<=MAX_DRUM_FILE_BYTES
    );
    if(list.length<=maxFiles)return list;
    const picked=[];
    const step=list.length/maxFiles;
    for(let i=0;i<maxFiles;i++)picked.push(list[Math.floor(i*step)]);
    return picked;
  }

  function byteLimitFiles(files,maxBytes=MAX_CACHE_BYTES_PER_KIND){
    const out=[];
    let bytes=0;
    for(const file of files){
      const size=Math.max(0,Number(file.size)||0);
      if(size>maxBytes)continue;
      if(bytes+size>maxBytes)continue;
      out.push(file);
      bytes+=size;
    }
    return {files:out,bytes};
  }

  async function tryPersistentStorage(){
    try{
      if(navigator.storage?.persist)await navigator.storage.persist();
    }catch{}
  }

  async function saveLibrary(kind,folderName,files,{sourceCount=null}={}){
    if(!validKind(kind))return null;
    const candidates=evenlyLimitFiles(files);
    let limited=byteLimitFiles(candidates);
    let selected=limited.files;
    let bytes=limited.bytes;
    const total=Number.isFinite(sourceCount)?sourceCount:[...files].length;

    if(!selected.length){
      await removeLibrary(kind);
      return null;
    }

    // Quota varies widely. If a write is too large, halve the snapshot until a
    // useful local library fits instead of losing persistence completely.
    while(selected.length){
      const record={
        kind,
        folderName:String(folderName||kind.toUpperCase()),
        files:selected,
        sourceCount:Math.max(selected.length,Number(total)||selected.length),
        cachedCount:selected.length,
        cachedBytes:bytes,
        savedAt:Date.now()
      };
      try{
        await writeLibrary(record);
        void tryPersistentStorage();
        return record;
      }catch(error){
        if(error?.name!=="QuotaExceededError" && !/quota/i.test(error?.message||""))throw error;
        selected=selected.slice(0,Math.floor(selected.length/2));
        bytes=selected.reduce((sum,file)=>sum+(Number(file.size)||0),0);
      }
    }
    return null;
  }

  function evenlyLimitHandles(handles,maxHandles=MAX_CACHE_FILES_PER_KIND){
    const list=[...handles];
    if(list.length<=maxHandles)return list;
    const picked=[];
    const step=list.length/maxHandles;
    for(let i=0;i<maxHandles;i++)picked.push(list[Math.floor(i*step)]);
    return picked;
  }

  async function filesFromDirectoryEntries(kind){
    const handles=[...(drumDirectoryEntries[kind]||[])];
    if(!handles.length)return {files:[],sourceCount:0};
    const selectedHandles=evenlyLimitHandles(handles);

    const files=[];
    let bytes=0;
    for(const handle of selectedHandles){
      try{
        const file=await handle.getFile();
        if(!isAudioFile(file) || file.size>MAX_DRUM_FILE_BYTES)continue;
        if(bytes+file.size>MAX_CACHE_BYTES_PER_KIND)continue;
        files.push(file);
        bytes+=file.size;
      }catch(error){
        console.warn(`Drum cache file (${kind}/${handle?.name||"?"}):`,error?.message||error);
      }
    }
    return {files,sourceCount:handles.length};
  }

  async function snapshotCurrentLibrary(kind,folderName=null){
    if(!validKind(kind))return null;
    let sourceCount=0;
    let files=[];

    if((drumDirectoryEntries[kind]||[]).length){
      const scanned=await filesFromDirectoryEntries(kind);
      files=scanned.files;
      sourceCount=scanned.sourceCount;
    }else{
      const fallback=[...(drumFolderFiles[kind]||[])];
      files=fallback;
      sourceCount=fallback.length;
    }

    const record=await saveLibrary(
      kind,
      folderName||drumDirectoryHandles[kind]?.name||kind.toUpperCase(),
      files,
      {sourceCount}
    );
    return record;
  }

  function activateCachedLibrary(record){
    if(!record || !validKind(record.kind) || !Array.isArray(record.files) || !record.files.length)return false;
    const kind=record.kind;
    const liveMounted=!!drumDirectoryHandles[kind] && (drumDirectoryEntries[kind]||[]).length>0;
    if(liveMounted)return true;

    // A stale directory handle with zero scanned entries is exactly the state
    // that caused the previous bug. Drop it from the active engine and use the
    // permission-free File snapshot instead.
    drumDirectoryHandles[kind]=null;
    drumDirectoryEntries[kind]=[];
    drumFolderFiles[kind]=record.files;
    return true;
  }

  async function restoreCachedDrumLibraries({silent=false}={}){
    const restored=[];
    const records=await Promise.all(DRUM_KEYS.map(readLibrary));
    for(let i=0;i<DRUM_KEYS.length;i++){
      const kind=DRUM_KEYS[i];
      const record=records[i];
      if(record && activateCachedLibrary(record)){
        restored.push(kind);
        continue;
      }

      // Migration path from the previous handle-only implementation: if the
      // browser still grants the directory right now, snapshot it once so future
      // reloads no longer depend on that permission.
      if((drumDirectoryEntries[kind]||[]).length){
        try{
          const migrated=await snapshotCurrentLibrary(kind,drumDirectoryHandles[kind]?.name);
          if(migrated)restored.push(kind);
        }catch(error){
          console.warn(`Drum cache migrate (${kind}):`,error?.message||error);
        }
      }
    }

    if(!silent && restored.length){
      drumStatus(`DRUM LIBRARIES RESTORED • ${restored.map(x=>x.toUpperCase()).join(" / ")} ✓`);
    }
    return restored;
  }

  async function ensureCacheActive(kind){
    if(!validKind(kind))return;
    if((drumDirectoryEntries[kind]||[]).length)return;
    if((drumFolderFiles[kind]||[]).length){
      drumDirectoryHandles[kind]=null;
      return;
    }
    const record=await readLibrary(kind);
    if(record)activateCachedLibrary(record);
  }

  // The low-level selector is the last gate before audio decoding. Guard it so
  // every drum path (PLAY, NEW DRUMS, SAVE, preview) gets the cached library even
  // if an older async handle-restore finishes after this module boots.
  if(typeof randomAudioFileFromDirectory==="function"){
    const randomAudioFileFromDirectoryBase=randomAudioFileFromDirectory;
    randomAudioFileFromDirectory=async function(kind,...args){
      await restorePromise;
      await ensureCacheActive(kind);
      return await randomAudioFileFromDirectoryBase(kind,...args);
    };
  }

  // A folder-button click now means "choose/change this folder". Go straight
  // to the picker while the click still owns transient user activation; never
  // await IndexedDB or requestPermission first. This bypasses the earlier
  // handle-reconnect wrapper that forced users to re-click each lane.
  chooseDrumFolder=async function(kind){
    if(!validKind(kind))return false;
    const button=document.getElementById(`${kind}FolderBtn`);
    if(button)button.disabled=true;
    try{
      if(window.isSecureContext && typeof window.showDirectoryPicker==="function"){
        try{
          const handle=await window.showDirectoryPicker({id:`scratch-${kind}-folder`,mode:"read"});
          const entries=[];
          for await(const entry of handle.values()){
            if(entry.kind==="file" && audioExt.test(entry.name||"")){
              entries.push(entry);
              if(entries.length>=MAX_DRUM_FOLDER_FILES)break;
            }
          }
          if(!entries.length){
            drumStatus(`${kind.toUpperCase()} • NO COMPATIBLE AUDIO FILE`);
            return false;
          }

          drumDirectoryHandles[kind]=handle;
          drumDirectoryEntries[kind]=entries;
          drumFolderFiles[kind]=[];
          await persistence.saveHandle(kind,handle);
          drumStatus(`${kind.toUpperCase()} • ${handle.name} • ${entries.length} SOUNDS • LOADING…`);
          await refreshDrumsAfterFolderChange(kind,entries.length,handle.name);

          try{
            const record=await snapshotCurrentLibrary(kind,handle.name);
            if(record){
              const partial=record.cachedCount<record.sourceCount;
              drumStatus(
                `${kind.toUpperCase()} • ${record.folderName} • ${record.cachedCount}`+
                `${partial?`/${record.sourceCount}`:""} SOUNDS • SAVED ✓`
              );
            }else{
              drumStatus(`${kind.toUpperCase()} • CACHE FAILED • FOLDER STILL ACTIVE THIS SESSION`);
            }
          }catch(error){
            console.warn(`Drum cache snapshot (${kind}):`,error);
            drumStatus(`${kind.toUpperCase()} • CACHE FAILED • FOLDER STILL ACTIVE THIS SESSION`);
          }
          return true;
        }catch(error){
          if(error?.name==="AbortError")return false;
          console.warn(`Directory picker (${kind}):`,error);
        }
      }

      // Browsers without the File System Access picker use the maintained
      // webkitdirectory input. Its onchange path is wrapped below and cached.
      const input=document.getElementById(`${kind}FolderFallback`);
      if(input){
        input.value="";
        input.click();
      }
      return false;
    }finally{
      if(button)button.disabled=false;
    }
  };

  // webkitdirectory has no reusable external handle, but its File objects are
  // perfectly serializable. Cache them after the maintained fallback has loaded
  // the lane, which makes this path persistent too.
  if(typeof setFallbackDrumFolder==="function"){
    const setFallbackDrumFolderBase=setFallbackDrumFolder;
    setFallbackDrumFolder=async function(kind,fileList){
      const ok=await setFallbackDrumFolderBase(kind,fileList);
      if(!ok || !validKind(kind))return ok;
      await persistence.removeHandle(kind);
      const files=[...(drumFolderFiles[kind]||[])];
      const folderName=(files[0]?.webkitRelativePath||"").split("/")[0]||`${kind.toUpperCase()} LIBRARY`;
      try{
        const record=await saveLibrary(kind,folderName,files,{sourceCount:files.length});
        if(record){
          const partial=record.cachedCount<record.sourceCount;
          drumStatus(
            `${kind.toUpperCase()} • ${record.folderName} • ${record.cachedCount}`+
            `${partial?`/${record.sourceCount}`:""} SOUNDS • SAVED ✓`
          );
        }
      }catch(error){
        console.warn(`Fallback drum cache (${kind}):`,error);
        drumStatus(`${kind.toUpperCase()} • CACHE FAILED • SESSION ONLY`);
      }
      return ok;
    };
  }

  // Keep the public persistence API useful, but stop presenting handle
  // re-authorization as the normal restore mechanism.
  persistence.restoreDrumFolders=restoreCachedDrumLibraries;
  persistence.reconnectDrumFolders=restoreCachedDrumLibraries;
  persistence.drumCacheDbName=DB_NAME;

  restorePromise=restoreCachedDrumLibraries().catch(error=>{
    console.warn("Drum cache startup restore:",error);
    return [];
  });

  globalThis.ChopperDrumCache={
    dbName:DB_NAME,
    kinds:[...DRUM_KEYS],
    maxFilesPerKind:MAX_CACHE_FILES_PER_KIND,
    maxBytesPerKind:MAX_CACHE_BYTES_PER_KIND,
    readLibrary,
    saveLibrary,
    removeLibrary,
    snapshotCurrentLibrary,
    restoreCachedDrumLibraries,
    ensureCacheActive,
    get ready(){return restorePromise;}
  };

  // Preserve the loader's existing feature sentinel for compatibility.
  globalThis.ChopperFolderReconnect={
    restoreRememberedDrumFolders:restoreCachedDrumLibraries,
    reconnectRememberedDrumFolders:restoreCachedDrumLibraries,
    get ready(){return restorePromise;}
  };
})();