"""MkDocs hook that shrinks the Material search index.

The site has ~4,400 documentation pages and ~170,000 Markdown sections, most
of which are programming reference material packed with code blocks. The
default Material search plugin indexed everything verbatim, producing a
128 MB ``search_index.json`` that crashed the browser-side Lunr worker with
~3 GB of allocated heap (Chrome ``Aw, Snap! Out of Memory``).

Two reductions happen here:

1. Every ``<pre>`` block is tagged ``data-search-exclude``. Material's search
   parser skips the element and its children, and strips the attribute back
   out of the rendered HTML before the page is written to disk, so users
   never see it. Source:
   ``site-packages/material/plugins/search/plugin.py`` — handler at the
   ``data-search-exclude`` branch and the post-index ``re.sub`` cleanup.

2. Variant-level pages (junior / middle / professional) and auxiliary mode
   pages (interview, tasks, find-bug, optimize, specification) are flagged
   with ``page.meta["search"]["exclude"]`` so they are skipped entirely. The
   ``senior`` variant remains indexed and represents the topic in search.
   Users still reach the other variants via the sibling-nav widget once they
   land on the topic page.
"""

from __future__ import annotations

import re
from posixpath import splitext

# Filename stems that have a `senior` sibling carrying the same topic.
# `senior` is the canonical entry kept in the search index.
SEARCH_EXCLUDED_STEMS = frozenset((
    "junior",
    "middle",
    "professional",
    "specification",
    "interview",
    "tasks",
    "find-bug",
    "optimize",
))

# Match every <pre> opening tag that isn't already marked. The negative
# lookahead keeps the substitution idempotent if the input is re-processed.
_PRE_RE = re.compile(r'<pre\b(?![^>]*\bdata-search-exclude\b)')


def _stem(src_uri: str) -> str:
    return splitext(src_uri.rsplit("/", 1)[-1])[0]


def on_page_markdown(markdown, page, config, files):
    if _stem(page.file.src_uri) in SEARCH_EXCLUDED_STEMS:
        search_meta = page.meta.get("search") or {}
        search_meta["exclude"] = True
        page.meta["search"] = search_meta
    return markdown


def on_page_content(html, page, config, files):
    return _PRE_RE.sub('<pre data-search-exclude', html)
