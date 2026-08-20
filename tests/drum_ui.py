from pathlib import Path
import re, sys
try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIP: playwright is not installed')
    sys.exit(0)

ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'index.html').read_text(encoding='utf-8')
html=re.sub(r'<link rel="manifest"[^>]*>','',html)
for rel in ['./css/base.css','./css/clean-ui.css','./css/chopper-drum-controls.css']:
    css=(ROOT/rel[2:]).read_text(encoding='utf-8')
    html=html.replace(f'<link rel="stylesheet" href="{rel}">',f'<style>{css}</style>')
html=re.sub(r'src="assets/[^"]+"','src=""',html)
for rel in ['./js/bootstrap.js','./js/core.js','./js/looper.js','./js/practice.js','./js/chopper.js','./js/drums.js','./js/events.js','./js/chopper-drum-controls.js']:
    js=(ROOT/rel[2:]).read_text(encoding='utf-8')
    html=html.replace(f'<script src="{rel}" defer></script>',f'<script>{js}</script>')
    html=html.replace(f'<script src="{rel}"></script>',f'<script>{js}</script>')


def geometry(page):
    return page.evaluate('''() => {
      const box=s=>document.querySelector(s).getBoundingClientRect().toJSON();
      return {
        resolution:box('#drumEditView'),
        reverb:box('.drumReverbKnob'),
        newDrums:box('#newDrums'),
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

        # Resolution, REVERB and NEW DRUMS share one compact hardware row.
        assert page.evaluate('document.querySelector("#drumEditView").closest(".drumQuickActions") === document.querySelector("#snareReverbMix").closest(".drumQuickActions")')
        assert page.evaluate('document.querySelector("#newDrums").closest(".drumQuickActions") === document.querySelector("#snareReverbMix").closest(".drumQuickActions")')
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
        assert g['resolution']['right'] <= g['reverb']['left']+2, g
        assert g['resolution']['top'] < g['reverb']['bottom'] and g['resolution']['bottom'] > g['reverb']['top'], g
        assert g['newDrums']['left'] >= g['reverb']['right']-2, g
        assert g['newDrums']['top'] < g['reverb']['bottom'] and g['newDrums']['bottom'] > g['reverb']['top'], g
        assert g['punch']['left'] >= g['volume']['right']-2, g
        assert g['punch']['top'] < g['volume']['bottom'] and g['punch']['bottom'] > g['volume']['top'], g
        assert g['bodyW'] <= g['viewportW']+2, g
        assert not errors, errors
        page.close()

    browser.close()

print('OK: Drum UI — 8TH/16TH inline with PLATE reverb + NEW DRUMS, AUTO grooves and four-step PUNCH')