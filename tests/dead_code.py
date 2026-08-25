from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_DIRS = (ROOT / "js", ROOT / "css")
RUNTIME_SUFFIXES = {".js", ".css"}
problems = []

# index.html is the root runtime manifest. Runtime JS may then load additional
# local JS/CSS modules dynamically; follow that dependency graph recursively so
# a real loader can own feature modules without weakening the orphan-file rule.
html = (ROOT / "index.html").read_text(encoding="utf-8")
referenced = set()
js_queue = []
scanned_js = set()


def add_runtime_reference(source_name, value):
    if value.startswith(("http://", "https://", "data:", "#", "mailto:", "blob:")):
        return
    clean = value.split("#", 1)[0].split("?", 1)[0]
    target = (ROOT / clean.lstrip("./")).resolve()
    if target.suffix not in RUNTIME_SUFFIXES:
        return
    referenced.add(target)
    if not target.exists():
        problems.append(f"Runtime reference missing from {source_name}: {value}")
        return
    if target.suffix == ".js" and target not in scanned_js:
        js_queue.append(target)


for value in re.findall(r'\b(?:src|href)=["\']([^"\']+)["\']', html):
    add_runtime_reference("index.html", value)

while js_queue:
    script = js_queue.pop(0)
    if script in scanned_js:
        continue
    scanned_js.add(script)
    text = script.read_text(encoding="utf-8")
    source_name = str(script.relative_to(ROOT))
    for value in re.findall(r'["\'](\./[^"\']+)["\']', text):
        add_runtime_reference(source_name, value)

runtime_files = {
    path.resolve()
    for directory in RUNTIME_DIRS
    for path in directory.rglob("*")
    if path.is_file() and path.suffix in RUNTIME_SUFFIXES
}

for orphan in sorted(runtime_files - referenced):
    problems.append(
        f"Dead runtime file: {orphan.relative_to(ROOT)} is not reachable from index.html runtime dependencies; "
        "delete replaced code in the same update"
    )

# Runtime CSS is maintained directly. The current maintainer documentation must
# not advertise the retired generator/source layout either. Historical review
# notes are intentionally excluded because they describe past versions.
css_contract_files = [
    *sorted((ROOT / "css").rglob("*.css")),
    ROOT / "README.txt",
    ROOT / "docs" / "ARCHITECTURE.md",
    ROOT / "docs" / "CSS_WORKFLOW.md",
]
for contract_file in css_contract_files:
    text = contract_file.read_text(encoding="utf-8")
    for stale_path in ("css/src/", "tools/build_css.py"):
        if stale_path in text:
            problems.append(
                f"Stale CSS generation path {stale_path!r} found in {contract_file.relative_to(ROOT)}"
            )

# Retired mechanisms must stay retired globally, not only in the file where a
# previous regression happened. sw.js remains at the project root intentionally
# as a retirement worker for old clients, but application JS must never register it.
for script in sorted((ROOT / "js").rglob("*.js")):
    text = script.read_text(encoding="utf-8")
    if "serviceWorker.register" in text:
        problems.append(
            f"Retired service worker registration found in {script.relative_to(ROOT)}"
        )

assert not problems, "\n".join(problems)
print("OK: runtime JS/CSS dependency graph is explicit, current docs reject retired CSS generation paths and retired update paths stay removed")
