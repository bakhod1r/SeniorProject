"""MkDocs hook for sibling-page navigation: ordering + per-page metadata.

Two responsibilities, both keyed off the canonical level/mode order below:

1. ``on_nav`` rewrites every page's prev/next links so the footer "next" walks a
   topic folder in canonical order (junior → middle → senior → professional →
   specification → interview → tasks → find-bug → optimize). MkDocs sets
   prev/next in ``get_navigation`` by sorting files with ``file_sort_key``
   (alphabetical), and most leaf folders ship no ``.pages`` file, so "next"
   otherwise jumps interview → junior → middle → professional → senior
   (pedagogically backwards). We keep MkDocs' global page sequence and only
   reorder pages *within* their own directory, then relink. ``awesome-pages``
   collapses the Roadmap nav tree in its own ``on_nav``, so we run last and
   operate directly on the page objects rather than the nav tree.

2. ``on_page_markdown`` attaches a ``sibling_nav`` entry to ``page.meta`` for any
   page whose filename stem is a recognised level/mode. The theme reads it in
   ``partials/nav.html`` (left sidebar) and ``partials/sibling-end.html``
   (end of the article).
"""

from __future__ import annotations

from posixpath import dirname, splitext

from mkdocs.plugins import event_priority
from mkdocs.structure.files import file_sort_key

LEVELS = ("junior", "middle", "senior", "professional")
MODES = ("specification", "interview", "tasks", "find-bug", "optimize")
ORDER = LEVELS + MODES
TRACKED = frozenset(ORDER)
_RANK = {name: i for i, name in enumerate(ORDER)}
_UNTRACKED_RANK = len(ORDER)


def _stem(src_uri: str) -> str:
    return splitext(src_uri.rsplit("/", 1)[-1])[0]


def _siblings_in(directory: str, files):
    found = {}
    for file in files:
        if not file.is_documentation_page():
            continue
        if dirname(file.src_uri) != directory:
            continue
        stem = _stem(file.src_uri)
        if stem in TRACKED:
            found[stem] = file
    return found


def _group(order, found, current_stem):
    items = []
    for name in order:
        file = found.get(name)
        if file is None:
            continue
        items.append(
            {
                "name": name,
                "url": file.url,
                "current": name == current_stem,
            }
        )
    return items


def _file_rank(file) -> int:
    """Intra-directory sort rank: index first, canonical order next, rest last."""
    stem = _stem(file.src_uri)
    if stem in ("index", "README"):
        return -1
    return _RANK.get(stem, _UNTRACKED_RANK)


# Run last: awesome-pages' on_nav collapses the Roadmap nav tree, so we relink
# prev/next on the page objects directly instead of walking the (collapsed) nav.
@event_priority(-100)
def on_nav(nav, config, files):
    # Reproduce MkDocs' global page order (file_sort_key, set in get_navigation),
    # then stable-reorder pages *within* each directory into canonical order.
    docs = sorted(files.documentation_pages(), key=file_sort_key)
    dir_first_seen: dict[str, int] = {}
    for idx, file in enumerate(docs):
        dir_first_seen.setdefault(dirname(file.src_uri), idx)
    docs.sort(key=lambda f: (dir_first_seen[dirname(f.src_uri)], _file_rank(f)))

    pages = [f.page for f in docs if f.page is not None]
    for i, page in enumerate(pages):
        page.previous_page = pages[i - 1] if i > 0 else None
        page.next_page = pages[i + 1] if i + 1 < len(pages) else None
    return nav


def on_page_markdown(markdown, page, config, files):
    src_uri = page.file.src_uri
    stem = _stem(src_uri)
    if stem not in TRACKED:
        return markdown

    directory = dirname(src_uri)
    found = _siblings_in(directory, files)
    if len(found) < 2:
        return markdown

    levels = _group(LEVELS, found, stem)
    modes = _group(MODES, found, stem)

    page.meta["sibling_nav"] = {"levels": levels, "modes": modes}
    return markdown
