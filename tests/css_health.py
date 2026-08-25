from pathlib import Path
import re
from css_parser import parse_stylesheet

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_text(encoding='utf-8')
SOURCE='\n'.join(p.read_text(encoding='utf-8',errors='ignore') for p in [ROOT/'index.html',*sorted((ROOT/'js').glob('*.js'))])
TOKENS=set(re.findall(r'[A-Za-z_][A-Za-z0-9_-]*',SOURCE))
SELECTOR_BRANCH_BUDGET=750


def runtime_css_files():
    files=[]
    hrefs=[]
    for tag in re.findall(r'<link\b[^>]*>',HTML,flags=re.I):
        rel=re.search(r'\brel=["\']([^"\']+)["\']',tag,flags=re.I)
        href=re.search(r'\bhref=["\']([^"\']+)["\']',tag,flags=re.I)
        if not rel or not href or 'stylesheet' not in rel.group(1).lower().split():
            continue
        value=href.group(1)
        if value.startswith(('http://','https://','data:')):
            continue
        clean=value.split('?',1)[0].split('#',1)[0]
        path=(ROOT/clean.lstrip('./')).resolve()
        assert path.exists(),f'Runtime CSS missing from index.html: {value}'
        assert path.suffix.lower()=='.css',f'Runtime stylesheet is not CSS: {value}'
        files.append(path)
        hrefs.append('./'+str(path.relative_to(ROOT)).replace('\\','/'))
    assert files,'index.html declares no local runtime stylesheets'
    assert len(files)==len(set(files)),f'duplicate runtime stylesheet links: {hrefs}'
    return files,hrefs


CSS_FILES,RUNTIME_CSS_HREFS=runtime_css_files()


def impossible(selector):
    # Tokens inside :not(...) are exclusions, not requirements for a selector
    # to match. Ignoring them prevents valid selectors from being flagged dead
    # merely because the excluded class/attribute no longer exists.
    required_selector=re.sub(r':not\([^)]*\)','',selector)
    required=(re.findall(r'[#.]([A-Za-z_][\w-]*)',required_selector)
              +re.findall(r'\[\s*([A-Za-z_][\w-]*)',required_selector))
    def known(token):
        if token in TOKENS: return True
        if token.startswith('data-'):
            parts=token[5:].split('-')
            dataset_name=parts[0]+''.join(part.title() for part in parts[1:])
            return dataset_name in TOKENS
        return False
    return any(not known(token) for token in required)


assert not impossible('.trackSource:not(.class-that-does-not-exist)')
assert impossible('.class-that-does-not-exist')

# Preserve the existing inline-fixture safety gate during P1: any test that
# embeds the primary stylesheet must also embed the maintained lean layer. Full
# fixture-manifest migration is a separate regression-safety step; P1's scope is
# making the production manifest and CSS health model truthful.
primary_href=RUNTIME_CSS_HREFS[0]
legacy_required='./css/clean-ui.css'
for test_path in sorted((ROOT/'tests').glob('*.py')):
    test_source=test_path.read_text(encoding='utf-8',errors='ignore')
    if primary_href in test_source:
        assert legacy_required in test_source,(
            f'{test_path.name}: {primary_href} is inlined without {legacy_required}'
        )

total_lines=0
total_selectors=0
for path in CSS_FILES:
    css=path.read_text(encoding='utf-8')
    rules,keyframes=parse_stylesheet(css)
    selectors=[selector for rule in rules for selector in rule.selectors]
    dead=[selector for selector in selectors if impossible(selector)]
    assert not dead,f'{path.name}: unreachable selector branches: {dead[:20]}'
    assert rules,f'{path.name}: no CSS rules parsed'
    total_lines+=len(css.splitlines())
    total_selectors+=len(selectors)

# Formatting is deliberately not a maintenance metric: one-line CSS must not
# score better than readable CSS. Selector branches track cascade growth without
# rewarding minification.
assert total_selectors < SELECTOR_BRANCH_BUDGET,(
    f'CSS selector branches {total_selectors} exceed structural budget '
    f'{SELECTOR_BRANCH_BUDGET}'
)

print(
    f'OK: CSS health — {len(CSS_FILES)} runtime stylesheets from index.html, '
    f'{total_selectors}/{SELECTOR_BRANCH_BUDGET} selector branches, '
    f'{total_lines} informational lines, 0 unreachable selector branches, '
    'legacy inline-fixture cascade guard preserved'
)
