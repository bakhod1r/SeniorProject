"""MkDocs hook that gives every page a unique SEO meta description.

Out of ~9,000 pages, almost none carry an explicit ``description`` in their
front matter, so Material falls back to the single global ``site_description``
on all of them. Search engines treat thousands of identical descriptions as
duplicate boilerplate and either rewrite the snippet themselves or suppress
it — either way the curated per-page intent is lost.

This hook derives a concise description from each page's first real prose
paragraph and writes it to ``page.meta["description"]``. From there Material's
``base.html`` renders ``<meta name="description">`` and our ``main.html``
override reuses the same value for ``og:description`` / ``twitter:description``
— so one derivation flows to every snippet a crawler or social card reads.

An explicit front-matter ``description`` always wins; the hook only fills the
gap when one is absent.
"""

from __future__ import annotations

import re

from mkdocs.plugins import event_priority

# Target length for a snippet. Google typically renders ~155–160 chars on
# desktop; we cut at a word boundary just under the ceiling.
MAX_LEN = 160
MIN_PARAGRAPH_LEN = 40  # ignore stub lines ("See also", single words, etc.)

# Lines that are structural noise rather than descriptive prose.
_SKIP_LINE = re.compile(
    r"""^\s*(
        \#          |   # ATX headings
        >           |   # blockquotes (sources, pull-quotes, callouts)
        \|          |   # table rows
        ```         |   # fenced code
        ~~~         |   # fenced code (tilde)
        <           |   # raw HTML / comments
        !\[         |   # standalone images
        \[!\[       |   # badge-style linked images
        [-*+]\s     |   # unordered list items (nav/index hubs, metadata)
        \d+\.\s     |   # ordered list items
        :\w+:\s*$   |   # emoji-only lines
        ---\s*$     |   # thematic breaks / front-matter fences
        ===\s*$         # setext underline
    )""",
    re.VERBOSE,
)

# A bare URL token — descriptions made mostly of a link read as spam.
_URL = re.compile(r"https?://\S+")

# Editorial metadata labels ("Status: …", "Source: …") that some pages lead
# with — accurate but useless as a search snippet.
_META_LABEL = re.compile(
    r"^\s*\*{0,2}(status|source|author|updated|last updated|tags?|"
    r"difficulty|estimated|prerequisites?|reading time)\b[^:]*:",
    re.IGNORECASE,
)

# Inline-markup strippers, applied in order to recover plain prose.
_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")          # [text](url) -> text
_REF_LINK = re.compile(r"\[([^\]]+)\]\[[^\]]*\]")     # [text][ref] -> text
_FOOTNOTE = re.compile(r"\[\^[^\]]+\]")               # [^1]
_ATTR_LIST = re.compile(r"\{[^}]*\}")                 # {#id .class}
_EMOJI = re.compile(r":[a-z0-9_+-]+:")                # :rocket:
_EMPHASIS = re.compile(r"(\*\*|__|\*|_|`|~~)")        # bold/italic/code/strike
_HTML_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def _clean(text: str) -> str:
    text = _IMAGE.sub("", text)
    text = _LINK.sub(r"\1", text)
    text = _REF_LINK.sub(r"\1", text)
    text = _FOOTNOTE.sub("", text)
    text = _ATTR_LIST.sub("", text)
    text = _HTML_TAG.sub("", text)
    text = _URL.sub("", text)
    text = _EMOJI.sub("", text)
    text = _EMPHASIS.sub("", text)
    return _WS.sub(" ", text).strip()


def _first_paragraph(markdown: str) -> str | None:
    """Return the first block of plain descriptive prose, cleaned."""
    in_fence = False
    buffer: list[str] = []

    for raw in markdown.splitlines():
        line = raw.rstrip()

        # Track fenced code so prose inside it is never harvested.
        if line.lstrip().startswith(("```", "~~~")):
            in_fence = not in_fence
            continue
        if in_fence:
            continue

        if not line.strip():
            if buffer:
                break  # paragraph ended
            continue

        if _SKIP_LINE.match(line) or _META_LABEL.match(line):
            if buffer:
                break  # a structural line closes the prose paragraph
            continue  # still searching for the first prose line

        buffer.append(line.strip())

    if not buffer:
        return None

    cleaned = _clean(" ".join(buffer))
    return cleaned or None


def _truncate(text: str, limit: int = MAX_LEN) -> str:
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    if " " in cut:
        cut = cut[: cut.rfind(" ")]
    return cut.rstrip(" ,;:.-") + "…"


# Run late so an explicit front-matter description (and other markdown hooks)
# are already in place; we only fill a missing value.
@event_priority(-50)
def on_page_markdown(markdown, page, config, files):
    meta = page.meta
    if meta.get("description"):
        return markdown

    paragraph = _first_paragraph(markdown)
    if paragraph and len(paragraph) >= MIN_PARAGRAPH_LEN:
        meta["description"] = _truncate(paragraph)

    return markdown
