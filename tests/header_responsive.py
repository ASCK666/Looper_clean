import sys

from browser_fixture import inline_runtime_page

try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIP: playwright is not installed'); sys.exit(0)

html=inline_runtime_page()
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1440,'height':900})
    page.set_content(html,wait_until='domcontentloaded',timeout=20000)
    page.wait_for_function('window.__SP && window.__SP.ready === true',timeout=10000)
    for width in [1440,1240,1180,1161,1160,1100,1020,981,980,820,620,520,420]:
        page.set_viewport_size({'width':width,'height':900})
        page.wait_for_timeout(20)
        data=page.evaluate('''()=>{
          const compat=document.querySelector('.machine > .compatHidden');
          const compatRect=compat.getBoundingClientRect().toJSON();
          const retired=document.querySelectorAll('.stableTop,.headerActions,#practiceOverlayOpen').length;
          const hidden=['.stableBrand','.headerDeckPill'].map(s=>({s,display:getComputedStyle(document.querySelector(s)).display,r:document.querySelector(s).getBoundingClientRect().toJSON()}));
          return {compatRect,retired,hidden,scroll:document.documentElement.scrollWidth,inner:innerWidth};
        }''')
        assert data['scroll'] <= data['inner']+2,(width,data)
        assert data['retired']==0,(width,data)
        assert data['compatRect']['width']<=1 and data['compatRect']['height']<=1,(width,data)
        for item in data['hidden']:
            assert item['display']=='none' and item['r']['width']==0 and item['r']['height']==0,(width,item,data)
    page.close()
    browser.close()
print('OK: retired Practice/header strip leaves no visible frame from 420px to 1440px')