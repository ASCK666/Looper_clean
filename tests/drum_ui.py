from pathlib import Path
import re, sys
try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIP: playwright is not installed')
    sys.exit(0)

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
        assert path.exists(),f'Runtime CSS missing from drum UI fixture: {value}'
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
        assert path.exists(),f'Runtime JS missing from drum UI fixture: {value}'
        return f'<script data-inline-from="{clean}">{path.read_text(encoding="utf-8")}</script>'

    return re.sub(
        r'<script\b[^>]*\bsrc=["\'][^"\']+["\'][^>]*>\s*</script>',
        inline_script,
        html,
        flags=re.I
    )


html=inline_project()


def geometry(page):
    return page.evaluate('''() => {
      const box=s=>document.querySelector(s).getBoundingClientRect().toJSON();
      return {
        resolution:box('#drumEditView'),
        reverb:box('.drumReverbKnob'),
        newDrums:box('#newDrums'),
        clear:box('#clearDrumEdits'),
        quick:box('.drumQuickActions'),
        volume:box('.sampleVolumeKnob'),
        punch:box('.punchKnob'),
        bodyW:document.body.scrollWidth,
        viewportW:innerWidth
      };
    }''')


with sync_playwright() as p:
    browser=p.chromium.launch(
        headless=True,
        executable_path='/usr/bin/chromium',
        args=['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']
    )

    for width,height in [(1440,1500),(820,1500),(520,1700),(390,1800)]:
        page=browser.new_page(viewport={'width':width,'height':height})
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(html,wait_until='load',timeout=20000)
        page.wait_for_function('window.__SP && window.__SP.ready === true',timeout=10000)
        page.add_style_tag(content='*,*::before,*::after{animation:none!important;transition:none!important}')
        page.click('[data-tab="chopper"]')
        page.wait_for_timeout(80)

        # Retired UI paths are physically gone.
        assert page.locator('#drumMode').count()==0
        assert page.locator('#snareReverbOn').count()==0
        assert page.locator('#snareReverbType').count()==0
        assert page.locator('.samplerDrumSection > .snareFx').count()==0
        assert page.locator('.samplerDrumSection > .punchFx').count()==0

        # REVERB is one 0-70 range knob, fixed to PLATE internally.
        reverb=page.locator('#snareReverbMix')
        assert reverb.get_attribute('type')=='range'
        assert reverb.get_attribute('min')=='0'
        assert reverb.get_attribute('max')=='70'
        assert reverb.input_value()=='25'
        assert page.locator('#snareReverbMixReadout').inner_text()=='25%'
        assert page.evaluate('snareReverbSettings().type')=='plate'
        assert page.evaluate('snareReverbSettings().on') is True

        page.fill('#snareReverbMix','0')
        page.dispatch_event('#snareReverbMix','input')
        assert page.locator('#snareReverbMixReadout').inner_text()=='0%'
        assert page.evaluate('snareReverbSettings().on') is False
        page.fill('#snareReverbMix','40')
        page.dispatch_event('#snareReverbMix','input')
        assert page.evaluate('snareReverbSettings().on') is True
        assert abs(page.evaluate('snareReverbSettings().mix')-.40)<1e-9

        # The whole drum toolbar is one hardware group in the requested order.
        same_group=page.evaluate('''() => {
          const q=document.querySelector('.drumQuickActions');
          return ['drumEditView','snareReverbMix','newDrums','clearDrumEdits'].every(id=>document.getElementById(id).closest('.drumQuickActions')===q);
        }''')
        assert same_group
        assert 'drumMode' not in page.evaluate('generateDrumSelection.toString()')

        # PUNCH is the existing four-state master as a discrete range knob.
        punch=page.locator('#punchMode')
        assert punch.get_attribute('type')=='range'
        assert punch.get_attribute('min')=='0'
        assert punch.get_attribute('max')=='3'
        assert punch.get_attribute('step')=='1'
        expected=['OFF','WARM','KNOCK','HARD']
        for value,label in enumerate(expected):
            page.fill('#punchMode',str(value))
            page.dispatch_event('#punchMode','input')
            assert page.locator('#punchDesc').inner_text()==label
            assert page.evaluate('punchSettings().mode')==label.lower()

        # Range-knob bootstrap keeps the rotary position live.
        page.fill('#punchMode','3')
        page.dispatch_event('#punchMode','input')
        punch_pct=float(page.evaluate("getComputedStyle(document.querySelector('.punchKnob')).getPropertyValue('--knob-pct')"))
        page.fill('#snareReverbMix','35')
        page.dispatch_event('#snareReverbMix','input')
        reverb_pct=float(page.evaluate("getComputedStyle(document.querySelector('.drumReverbKnob')).getPropertyValue('--knob-pct')"))
        assert abs(punch_pct-100)<.01
        assert abs(reverb_pct-50)<.01

        g=geometry(page)
        assert g['resolution']['width']<=94,g
        if width>430:
            # Desktop/tablet: one row, with actual air between every control.
            ordered=[g['resolution'],g['reverb'],g['newDrums'],g['clear']]
            assert all(x['top']<ordered[0]['bottom'] and x['bottom']>ordered[0]['top'] for x in ordered),g
            for left,right in zip(ordered,ordered[1:]):
                assert right['left']-left['right']>=14,g
        else:
            # Phone: two clean rows are allowed, but controls must never overlap.
            boxes=[g['resolution'],g['reverb'],g['newDrums'],g['clear']]
            for i,a in enumerate(boxes):
                for b in boxes[i+1:]:
                    overlap_x=min(a['right'],b['right'])-max(a['left'],b['left'])
                    overlap_y=min(a['bottom'],b['bottom'])-max(a['top'],b['top'])
                    assert overlap_x<=0 or overlap_y<=0,g

        assert g['punch']['left'] >= g['volume']['right']-2, g
        assert g['punch']['top'] < g['volume']['bottom'] and g['punch']['bottom'] > g['volume']['top'], g
        assert g['bodyW'] <= g['viewportW']+2, g
        assert not errors, errors
        page.close()

    browser.close()

print('OK: Drum UI — spaced resolution / REVERB / NEW DRUMS / CLEAR toolbar, AUTO grooves and four-step PUNCH')