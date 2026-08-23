from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def _local_path(root: Path, value: str) -> tuple[str, Path]:
    clean = value.split('?', 1)[0].split('#', 1)[0]
    path = (root / clean.lstrip('./')).resolve()
    assert path.exists(), f'Runtime fixture dependency is missing: {value}'
    return clean, path


def _inline_script_tag(root: Path, clean: str, path: Path) -> str:
    return f'<script data-inline-from="{clean}">{path.read_text(encoding="utf-8")}</script>'


def inline_runtime_page(
    root: Path = ROOT,
    *,
    script_paths: tuple[str, ...] | None = None,
    append_scripts: tuple[str, ...] = (),
    preload_before: dict[str, tuple[str, ...]] | None = None,
) -> str:
    """Inline index.html runtime dependencies for about:blank Playwright pages.

    CSS always follows the real stylesheet manifest. Tests that intentionally use
    only a subset of application scripts may pass ``script_paths``; tests that can
    serve index.html directly should prefer the real page instead.
    """
    root = Path(root).resolve()
    selected_scripts = None if script_paths is None else {
        value.split('?', 1)[0].split('#', 1)[0].lstrip('./') for value in script_paths
    }
    preload_before = preload_before or {}
    html = (root / 'index.html').read_text(encoding='utf-8')
    html = re.sub(
        r'<link\b[^>]*\brel=["\']manifest["\'][^>]*>',
        '',
        html,
        flags=re.I,
    )

    def inline_stylesheet(match):
        tag = match.group(0)
        rel = re.search(r'\brel=["\']([^"\']+)["\']', tag, flags=re.I)
        href = re.search(r'\bhref=["\']([^"\']+)["\']', tag, flags=re.I)
        if not rel or not href or 'stylesheet' not in rel.group(1).lower().split():
            return tag
        value = href.group(1)
        if value.startswith(('http://', 'https://', 'data:')):
            return tag
        clean, path = _local_path(root, value)
        return f'<style data-inline-from="{clean}">{path.read_text(encoding="utf-8")}</style>'

    html = re.sub(r'<link\b[^>]*>', inline_stylesheet, html, flags=re.I)
    # Inline fixtures test controls/layout, not the heavyweight decorative image
    # surfaces. Real-page browser tests cover those assets separately.
    html = re.sub(r'src="assets/[^"]+"', 'src=""', html)

    def inline_script(match):
        tag = match.group(0)
        src = re.search(r'\bsrc=["\']([^"\']+)["\']', tag, flags=re.I)
        if not src:
            return tag
        value = src.group(1)
        if value.startswith(('http://', 'https://', 'data:')):
            return tag
        clean, path = _local_path(root, value)
        normalized = clean.lstrip('./')
        if selected_scripts is not None and normalized not in selected_scripts:
            return tag
        before = []
        for dependency in preload_before.get(normalized, ()):
            dep_clean, dep_path = _local_path(root, dependency)
            before.append(_inline_script_tag(root, dep_clean, dep_path))
        return ''.join(before) + _inline_script_tag(root, clean, path)

    html = re.sub(
        r'<script\b[^>]*\bsrc=["\'][^"\']+["\'][^>]*>\s*</script>',
        inline_script,
        html,
        flags=re.I,
    )
    if append_scripts:
        appended = []
        for dependency in append_scripts:
            clean, path = _local_path(root, dependency)
            appended.append(_inline_script_tag(root, clean, path))
        html = html.replace('</body>', ''.join(appended) + '</body>')
    return html
