from pathlib import Path
import re, sys
try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIP: playwright is not installed'); sys.exit(0)
ROOT=Path(__file__).resolve().parents[1]


def inline_project():
    html=(ROOT/'index.html').read_text(encoding='utf-8')
    html=re.sub(r'<link\b[^>]*\brel=["\']manifest["\'][^>]*>','',html,flags=re.I)

    def inline_stylesheet(match):
        tag=match.group(0)
        rel=re.search(r'\brel=["\']([^"\']+)["\']',tag,flags=re.I)
        href=re.search(r'\bhref=["\']([^"\']+)["\']',tag,flags=re.I)
        if not rel or not href or 'stylesheet' not in rel.group(1).lower().split():
            return tag
        value=href.group(1)
        if value.startswith(('http://','https://','data:')):
            return tag
        clean=value.split('?',1)[0].split('#',1)[0]
        path=(ROOT/clean.lstrip('./')).resolve()
        assert path.exists(),f'Runtime CSS missing from header responsive fixture: {value}'
        return f'<style data-inline-from="{clean}">{path.read_text(encoding="utf-8")}</style>'

    html=re.sub(r'<link\b[^>]*>',inline_stylesheet,html,flags=re.I)
    html=re.sub(r'src="assets/[^"]+"','src=""',html)

    def inline_script(match):
        tag=match.group(0)
        src=re.search(r'\bsrc=["\']([^"\']+)["\']',tag,flags=re.I)
        if not src:
            return tag
        value=src.group(1)
        if value.startswith(('http://','https://','data:')):
            return tag
        clean=value.split('?',1)[0].split('#',1)[0]
        path=(ROOT/clean.lstrip('./')).resolve()
        assert path.exists(),f'Runtime JS missing from header responsive fixture: {value}'
        return f'<script data-inline-from="{clean}">{path.read_text(encoding="utf-8")}</script>'

    return re.sub(
        r'<script\b[^>]*\bsrc=["\'][^"\']+["\'][^>]*>\s*</script>',
        inline_script,
        html,
        flags=re.I
    )


html=inline_project()
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