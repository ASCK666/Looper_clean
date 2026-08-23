from pathlib import Path
import sys

from browser_fixture import inline_runtime_page

try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIP: playwright is not installed')
    sys.exit(0)

ROOT=Path(__file__).resolve().parents[1]
html=inline_runtime_page(
    script_paths=(
        'js/bootstrap.js','js/core.js','js/looper.js','js/chopper.js',
        'js/drums.js','js/events.js','js/chopper-drum-controls.js',
    ),
    append_scripts=('js/chopper-folder-reconnect.js',),
)

with sync_playwright() as p:
    browser=p.chromium.launch(
        headless=True,
        executable_path='/usr/bin/chromium',
        args=['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']
    )
    page=browser.new_page(viewport={'width':1280,'height':900})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html,wait_until='load',timeout=20000)
    page.wait_for_function('window.__SP && window.__SP.ready === true',timeout=10000)
    page.wait_for_function('window.ChopperFolderPersistence && window.ChopperFolderReconnect',timeout=10000)

    passive=page.evaluate('''async () => {
      const keys=['kick','snare','hat'];
      window.__folderTest={requests:0,handles:{}};
      const makeHandle=kind=>{
        let permission='prompt';
        const handle={
          kind:'directory',
          name:`${kind}-saved`,
          async queryPermission(){return permission;},
          async requestPermission(){
            window.__folderTest.requests++;
            permission='granted';
            return permission;
          },
          async *values(){
            yield {kind:'file',name:`${kind}.wav`};
          },
          setPermission(value){permission=value;}
        };
        window.__folderTest.handles[kind]=handle;
        return handle;
      };

      for(const kind of keys){
        await ChopperFolderPersistence.saveHandle(kind,makeHandle(kind));
        drumDirectoryHandles[kind]=null;
        drumDirectoryEntries[kind]=[];
        drumFolderFiles[kind]=[];
      }
      await ChopperFolderReconnect.primeRememberedDrumHandles(true);
      const state=await ChopperFolderReconnect.restoreRememberedDrumFolders({silent:true});
      return {
        state,
        requests:window.__folderTest.requests,
        active:keys.map(kind=>!!drumDirectoryHandles[kind]),
        entries:keys.map(kind=>drumDirectoryEntries[kind].length)
      };
    }''')
    assert passive['state']['pending']==['kick','snare','hat'],passive
    assert passive['requests']==0,passive
    assert passive['active']==[False,False,False],passive
    assert passive['entries']==[0,0,0],passive

    # One reconnect operation requests all remembered handles and mounts their
    # file entries; there is no lane-by-lane picker interaction.
    connected=page.evaluate('''async () => {
      const keys=['kick','snare','hat'];
      const state=await ChopperFolderReconnect.reconnectRememberedDrumFolders({silent:true});
      return {
        state,
        requests:window.__folderTest.requests,
        names:keys.map(kind=>drumDirectoryHandles[kind]?.name||null),
        entries:keys.map(kind=>drumDirectoryEntries[kind].length)
      };
    }''')
    assert connected['state']['pending']==[],connected
    assert connected['state']['restored']==['kick','snare','hat'],connected
    assert connected['requests']==3,connected
    assert connected['names']==['kick-saved','snare-saved','hat-saved'],connected
    assert connected['entries']==[1,1,1],connected

    # Simulate the browser returning all three permissions to PROMPT after a
    # reload. Merely entering the Chopper reconnects all saved lanes again.
    page.evaluate('''async () => {
      const keys=['kick','snare','hat'];
      window.__folderTest.requests=0;
      for(const kind of keys){
        window.__folderTest.handles[kind].setPermission('prompt');
        drumDirectoryHandles[kind]=null;
        drumDirectoryEntries[kind]=[];
      }
      await ChopperFolderReconnect.primeRememberedDrumHandles(true);
    }''')
    page.locator('[data-tab="chopper"]').click(force=True)
    page.wait_for_function('''() =>
      window.__folderTest.requests===3 &&
      ['kick','snare','hat'].every(kind=>(drumDirectoryEntries[kind]||[]).length===1)
    ''',timeout=5000)
    tab_state=page.evaluate('''() => ({
      requests:window.__folderTest.requests,
      entries:['kick','snare','hat'].map(kind=>drumDirectoryEntries[kind].length),
      status:document.getElementById('drumStatus').textContent
    })''')
    assert tab_state['requests']==3,tab_state
    assert tab_state['entries']==[1,1,1],tab_state
    assert 'RECONNECTED' in tab_state['status'],tab_state

    source=(ROOT/'js/chopper-folder-reconnect.js').read_text(encoding='utf-8')
    assert 'SESSION ONLY • FOLDER MEMORY REQUIRES HTTPS/LOCALHOST + CHROMIUM' in source
    assert 'BROWSER DID NOT PERSIST FOLDER ACCESS' in source
    assert not errors,errors
    page.close()
    browser.close()

print('OK: Chopper folder persistence — saved drum handles stay pending until mounted and reconnect together without lane-by-lane clicks')