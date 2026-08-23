from pathlib import Path
from collections import defaultdict
import re
from css_parser import parse_stylesheet

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_text(encoding='utf-8')


def runtime_css_files():
    files=[]
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
    assert files,'index.html declares no local runtime stylesheets'
    assert len(files)==len(set(files)),f'duplicate runtime stylesheet links: {files}'
    return files


CSS_FILES=runtime_css_files()
CSS='\n'.join(path.read_text(encoding='utf-8') for path in CSS_FILES)
PROJECT='\n'.join(p.read_text(encoding='utf-8',errors='ignore') for p in ROOT.rglob('*') if p.is_file() and p.suffix.lower() in {'.css','.html','.js'})
rules,keyframes=parse_stylesheet(CSS)

# Every design token defined by the runtime CSS cascade must have a consumer.
defs=set(re.findall(r'(--[\w-]+)\s*:',CSS))
refs=set(re.findall(r'var\(\s*(--[\w-]+)',PROJECT))
unused_vars=sorted(defs-refs)
assert not unused_vars,f'unused custom properties: {unused_vars}'

# Every keyframe must be referenced outside its definition.
unused_frames=[]
for name,line in keyframes:
    if len(re.findall(r'(?<![\w-])'+re.escape(name)+r'(?![\w-])',PROJECT)) <= 1:
        unused_frames.append((name,line))
assert not unused_frames,f'unused keyframes: {unused_frames}'

# Detect exact-selector declarations that can no longer win in the real runtime
# load order declared by index.html. The check stays conservative: it does not
# try to infer selector overlap like a browser.
occ=defaultdict(list)
for rule_index,rule in enumerate(rules):
    for declaration_index,declaration in enumerate(rule.declarations):
        for branch in rule.selectors:
            occ[(rule.context,branch,declaration.name)].append((rule_index,declaration_index,declaration))

dead=[]
for rule_index,rule in enumerate(rules):
    for declaration_index,declaration in enumerate(rule.declarations):
        shadowed_for_every_branch=all(
            any(
                (later_rule>rule_index or (later_rule==rule_index and later_declaration>declaration_index))
                and (not declaration.important or later.important)
                for later_rule,later_declaration,later in occ[(rule.context,branch,declaration.name)]
            )
            for branch in rule.selectors
        )
        if shadowed_for_every_branch:
            dead.append((rule.line,', '.join(rule.selectors),declaration.name))

assert not dead,f'fully shadowed declarations remain in runtime CSS cascade: {dead[:30]}'
print(
    f'OK: CSS redundancy — {len(CSS_FILES)} runtime stylesheets from index.html, '
    f'{len(defs)} used custom properties, no unused keyframes, '
    'no fully-shadowed declarations across runtime CSS'
)
