from pathlib import Path


def replace_between(text,start_marker,end_marker,replacement):
    start=text.index(start_marker)
    end=text.index(end_marker,start)
    return text[:start]+replacement+text[end:]


p=Path('js/looper.js')
text=p.read_text()

text=replace_between(
    text,
    'async function dbDelete(id){',
    '\n\nasync function dbAll(){',
    '''async function dbDeleteMany(ids){
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
}'''
)

text=text.replace(
    'function beatCacheId(name){',
    '''function beatImportIdentity(value){
  const blob=value?.blob||value;
  const name=String(value?.name||blob?.name||"").trim().toLowerCase();
  if(!name)return "";
  const size=Number(value?.fileSize??blob?.size??value?.size??0);
  const lastModified=Number(value?.fileLastModified??blob?.lastModified??value?.lastModified??0);
  return `${name}\\u0000${size}\\u0000${lastModified}`;
}

function beatCacheId(name){''',
    1
)

text=replace_between(
    text,
    'async function importBeatFiles(files){',
    '\n\nfunction isFolderBeat(row){',
    '''async function importBeatFiles(files){
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
}'''
)

text=text.replace(
    'function beatCrateTone(row){',
    '''function importedBeatDuplicateGroups(rows,currentId=null){
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

function beatCrateTone(row){''',
    1
)

refresh_start=text.index('async function refreshLibrary(rescanDirectory=true){')
refresh_body_end=text.index('\n\nasync function digBeatCrate(){',refresh_start)
refresh=text[refresh_start:refresh_body_end]
refresh=refresh.replace('let dbRows=await dbAll();','let dbRows=await dedupeStoredImportedBeats(await dbAll());',1)
refresh=refresh.replace('dbRows=await dbAll();','dbRows=await dedupeStoredImportedBeats(await dbAll());',1)
text=text[:refresh_start]+refresh+text[refresh_body_end:]
p.write_text(text)

p=Path('js/events.js')
text=p.read_text()
text=replace_between(
    text,
    'function beatImportSummary(label,result){',
    '\n\nasync function handleBeatImport(files,label){',
    '''function beatImportSummary(label,result){
  const issues=result.tooLarge+result.decodeErrors+result.skipped;
  const duplicates=result.duplicates||0;
  const beatLabel=label==="IMPORT" ? ` beat${result.total>1?"s":""}` : "";
  const duplicateNote=duplicates ? ` • ${duplicates} déjà présent${duplicates>1?"s":""}` : "";
  const ignored=issues ? ` • ${issues} ignoré${issues>1?"s":""}` : "";
  return `${label} • ${result.imported}/${result.total}${beatLabel}${duplicateNote}${ignored}`;
}'''
)
p.write_text(text)

p=Path('tests/core_unit.js')
text=p.read_text()
anchor='assert.equal(evaluate("beatCrateKey({id:\'abc\',name:\'TRACK.WAV\',source:\'user-import\'})"),"import:abc");\n'
assert anchor in text
text=text.replace(
    anchor,
    anchor+
    'assert.equal(evaluate("beatImportIdentity({name:\'TRACK.WAV\',fileSize:10,fileLastModified:20})===beatImportIdentity({name:\'track.wav\',blob:{size:10,lastModified:20}})"),true);\n'
    'assert.equal(evaluate("beatImportIdentity({name:\'TRACK.WAV\',fileSize:10,fileLastModified:20})===beatImportIdentity({name:\'track.wav\',blob:{size:10,lastModified:21}})"),false);\n'
    'assert.equal(evaluate("importedBeatDuplicateGroups([{id:\'old\',name:\'A.wav\',source:\'user-import\',created:1,blob:{size:8,lastModified:9}},{id:\'new\',name:\'A.wav\',source:\'user-import\',created:2,blob:{size:8,lastModified:9}}],\'new\')[0].keeper.id"),"new");\n',
    1
)
p.write_text(text)

p=Path('tests/browser_smoke.py')
text=p.read_text()
anchor="        assert page.locator('#library .crateBeat').count()==1\n        assert not page.locator('#cratePlayBeat').is_disabled()\n"
assert anchor in text
replacement="""        assert page.locator('#library .crateBeat').count()==1
        assert page.evaluate(\"dbAll().then(rows=>rows.filter(row=>row.source==='user-import' && row.name==='test-beat.wav').length)\")==1

        # A legacy duplicate already in IndexedDB is consolidated on refresh,
        # keeping the current beat instead of leaving duplicate crate rows.
        page.evaluate(\"\"\"async()=>{const rows=await dbAll();const row=rows.find(item=>item.source==='user-import'&&item.name==='test-beat.wav');await dbPut({...row,id:'legacy-duplicate',created:(row.created||0)+1});await refreshLibrary(false)}\"\"\")
        assert page.locator('#library .crateBeat').count()==1
        assert page.evaluate(\"dbAll().then(rows=>rows.filter(row=>row.source==='user-import' && row.name==='test-beat.wav').length)\")==1

        # Selecting the same file again loads the existing beat but must not
        # append another persistent row.
        page.set_input_files('#beatFiles',str(beat)); page.wait_for_timeout(250)
        assert page.locator('#library .crateBeat').count()==1
        assert page.evaluate(\"dbAll().then(rows=>rows.filter(row=>row.source==='user-import' && row.name==='test-beat.wav').length)\")==1
        assert not page.locator('#cratePlayBeat').is_disabled()
"""
text=text.replace(anchor,replacement,1)
p.write_text(text)
