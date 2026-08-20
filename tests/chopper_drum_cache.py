from pathlib import Path
import contextlib, http.server, socketserver, threading, os, sys, tempfile

try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIP: playwright is not installed')
    sys.exit(0)

ROOT=Path(__file__).resolve().parents[1]

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_args):
        pass

with tempfile.TemporaryDirectory() as profile_dir, contextlib.ExitStack() as stack:
    handler=lambda *a,**kw: QuietHandler(*a,directory=str(ROOT),**kw)
    server=socketserver.TCPServer(('127.0.0.1',0),handler)
    stack.callback(server.server_close)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    stack.callback(server.shutdown)
    port=server.server_address[1]
    url=f'http://127.0.0.1:{port}/index.html'

    chromium=os.environ.get('CHROMIUM','/usr/bin/chromium')
    launch=dict(
        headless=True,
        executable_path=chromium,
        args=['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required'],
    )

    with sync_playwright() as p:
        context=p.chromium.launch_persistent_context(profile_dir,**launch)
        page=context.pages[0] if context.pages else context.new_page()
        page.goto(url,wait_until='networkidle',timeout=30000)
        page.wait_for_function('window.ChopperDrumCache !== undefined',timeout=10000)
        page.evaluate('async()=>{ await window.ChopperDrumCache.ready; }')

        page.evaluate('''async()=>{
          const specs=[['kick','KICKS','kick-cache.wav',11],['snare','SNARES','snare-cache.wav',22],['hat','HATS','hat-cache.wav',33]];
          for(const [kind,folder,name,seed] of specs){
            const bytes=new Uint8Array([seed,seed+1,seed+2,seed+3]);
            const file=new File([bytes],name,{type:'audio/wav',lastModified:1700000000000+seed});
            const record=await window.ChopperDrumCache.saveLibrary(kind,folder,[file],{sourceCount:1});
            if(!record || record.cachedCount!==1)throw new Error(`cache write failed: ${kind}`);
          }
        }''')
        context.close()

        # Re-open Chromium with the same profile. This is intentionally stronger
        # than a page.reload(): the external-directory permission may be gone,
        # while IndexedDB's File snapshot must still work without any user click.
        context=p.chromium.launch_persistent_context(profile_dir,**launch)
        page=context.pages[0] if context.pages else context.new_page()
        page.goto(url,wait_until='networkidle',timeout=30000)
        page.wait_for_function('window.ChopperDrumCache !== undefined',timeout=10000)
        page.evaluate('async()=>{ await window.ChopperDrumCache.ready; }')

        state=page.evaluate('''()=>({
          handles:{kick:drumDirectoryHandles.kick,snare:drumDirectoryHandles.snare,hat:drumDirectoryHandles.hat},
          entries:{kick:drumDirectoryEntries.kick.length,snare:drumDirectoryEntries.snare.length,hat:drumDirectoryEntries.hat.length},
          files:{
            kick:drumFolderFiles.kick.map(f=>f.name),
            snare:drumFolderFiles.snare.map(f=>f.name),
            hat:drumFolderFiles.hat.map(f=>f.name)
          }
        })''')
        assert all(state['handles'][kind] is None for kind in ('kick','snare','hat')),state
        assert all(state['entries'][kind]==0 for kind in ('kick','snare','hat')),state
        assert state['files']=={
            'kick':['kick-cache.wav'],
            'snare':['snare-cache.wav'],
            'hat':['hat-cache.wav'],
        },state

        picked=page.evaluate('''async()=>{
          const out={};
          for(const kind of ['kick','snare','hat']){
            const file=await randomAudioFileFromDirectory(kind);
            out[kind]=file?.name||null;
          }
          return out;
        }''')
        assert picked=={
            'kick':'kick-cache.wav',
            'snare':'snare-cache.wav',
            'hat':'hat-cache.wav',
        },picked
        context.close()

print('OK: KICK/SNARE/HAT File cache survives Chromium restart and feeds drums without folder permission/click')