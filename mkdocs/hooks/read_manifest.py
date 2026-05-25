"""MkDocs hook that builds the read-progress section manifest.

Walks the build's documentation files, groups each page by its top-level
section, and writes the result to ``<site_dir>/sp-read-manifest.json``.

The client-side reading-comfort pack (`reading.js`) fetches this file once
per origin (HTTP-cached), so per-section read counts can be computed without
inlining the full manifest into every HTML page.

Section keys:
  * Pages under ``Roadmap/<X>/...`` group by ``<X>`` (AI, Backend, Data, ...).
  * Pages under ``Leetcode/...`` group as ``Leetcode``.
  * Pages under ``System Design/...`` group as ``System Design``.
  * Everything else (root landing pages, assets) is skipped.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone

TOP_LEVEL_SECTIONS = {"Leetcode", "System Design"}
ROADMAP_TOP = "Roadmap"
SKIP_LEAF_FILES = {"index.md", "TEMPLATE.md"}
MANIFEST_FILENAME = "sp-read-manifest.json"


def _section_key(src_uri: str) -> str | None:
    parts = src_uri.split("/")
    if not parts:
        return None
    top = parts[0]
    if top == "assets":
        return None
    if len(parts) == 1:
        return None
    if parts[-1] in SKIP_LEAF_FILES:
        return None
    if top == ROADMAP_TOP:
        return parts[1] if len(parts) >= 3 else None
    if top in TOP_LEVEL_SECTIONS:
        return top
    return None


def _normalised_url(page_url: str) -> str:
    u = page_url if page_url.startswith("/") else "/" + page_url
    if not u.endswith("/"):
        u += "/"
    while "//" in u:
        u = u.replace("//", "/")
    return u


def _label_for(key: str) -> str:
    return key.replace("-", " ")


def _build_manifest(files) -> dict:
    sections: dict[str, list[str]] = {}
    for f in files:
        if not f.is_documentation_page():
            continue
        key = _section_key(f.src_uri)
        if key is None:
            continue
        sections.setdefault(key, []).append(_normalised_url(f.url))

    manifest_sections = []
    for key in sorted(sections):
        manifest_sections.append({
            "key": key,
            "label": _label_for(key),
            "paths": sorted(sections[key]),
        })

    return {
        "generated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "sections": manifest_sections,
    }


_manifest_cache: dict | None = None


def on_files(files, config):
    global _manifest_cache
    _manifest_cache = _build_manifest(files)
    return files


def on_post_build(config):
    if not _manifest_cache:
        return
    out_path = os.path.join(config["site_dir"], MANIFEST_FILENAME)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(_manifest_cache, fh, separators=(",", ":"), ensure_ascii=False)
