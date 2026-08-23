from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def _local_path(root: Path, value: str) -> tuple[str, Path]:
    clean = value.split('?', 1)[0].split('#', 1)[0]
    path = (root / clean.lstrip('./')).resolve()
    assert path.exists(), f'Runtime fixture dependency is missing: {value}'
    return clean, path


def inline_runtime_page(
    root: Path = ROOT,
    *,
    preload_before: dict[str, tuple[str, ...]] | None = None,
) -> str:
    """Inline the real index.html CSS/JS manifest for about:blank Playwright pages.

    Tests that can serve index.html directly should prefer that. This helper exists
    only for fixtures that intentionally use page.set_content().
    """
    root = Path(root).resolve()
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
        before = []
        for dependency in preload_before.get(clean.lstrip('./'), ()):
            dep_clean, dep_path = _local_path(root, dependency)
            before.append(
                f'<script data-inline-from="{dep_clean}">{dep_path.read_text(encoding="utf-8")}</script>'
            )
        body = f'<script data-inline-from="{clean}">{path.read_text(encoding="utf-8")}</script>'
        return ''.join(before) + body

    return re.sub(
        r'<script\b[^>]*\bsrc=["\'][^"\']+["\'][^>]*>\s*</script>',
        inline_script,
        html,
        flags=re.I,
    )
