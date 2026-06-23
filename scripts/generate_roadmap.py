#!/usr/bin/env python3
"""Generate _docs/roadmap.md from the _docs/Roadmap/ folder structure.

Walks the Roadmap tree and emits a Material-for-MkDocs grid-cards block
where every topic is a collapsible `??? note` accordion. Sub-subfolders
appear as bullets inside the accordion (linked to the first .md file
that can be found, or plain text if the folder is empty).

Re-run after adding or renaming folders:

    python3 scripts/generate_roadmap.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS_DIR = ROOT / "_docs"
ROADMAP_DIR = DOCS_DIR / "Roadmap"
OUT_FILE = DOCS_DIR / "roadmap.md"

# Optional manual ordering. Categories listed here appear in this order
# at the top; any remaining categories discovered on disk are appended
# in alphabetical order. Add a new category folder under _docs/Roadmap/
# and it shows up automatically — no edits required here.
CATEGORY_ORDER: list[str] = [
    "AI",
    "Architecture",
    "Backend",
    "Data",
    "DevOps",
    "Frontend",
    "Mobile",
    "Programming",
    "Security",
    "Soft-Skills",
    "Tools-and-Platforms",
]

DEFAULT_ICON = "material-folder-outline"

CATEGORY_ICONS = {
    "AI": "material-robot",
    "Architecture": "material-sitemap",
    "Backend": "material-server-network",
    "Data": "material-chart-line",
    "DevOps": "material-cloud-cog",
    "Frontend": "material-monitor-dashboard",
    "Mobile": "material-cellphone",
    "Programming": "material-code-tags",
    "Security": "material-shield-lock",
    "Soft-Skills": "material-account-group",
    "Tools-and-Platforms": "material-tools",
}

CATEGORY_TITLES = {
    "AI": "AI",
    "Architecture": "Architecture",
    "Backend": "Backend",
    "Data": "Data",
    "DevOps": "DevOps",
    "Frontend": "Frontend",
    "Mobile": "Mobile",
    "Programming": "Programming Languages",
    "Security": "Security",
    "Soft-Skills": "Soft Skills",
    "Tools-and-Platforms": "Tools & Platforms",
}

# Acronyms / brand names that should keep their canonical casing even
# after .title() lowercases them. Applied as whole-word replacements
# (case-insensitive match) after the initial title-casing step.
ACRONYMS = {
    "ai": "AI",
    "api": "API",
    "apis": "APIs",
    "aws": "AWS",
    "bi": "BI",
    "ci": "CI",
    "cd": "CD",
    "crdts": "CRDTs",
    "cap": "CAP",
    "css": "CSS",
    "dapps": "DApps",
    "ddd": "DDD",
    "dsa": "DSA",
    "graphql": "GraphQL",
    "grpc": "gRPC",
    "html": "HTML",
    "http": "HTTP",
    "https": "HTTPS",
    "ide": "IDE",
    "ios": "iOS",
    "json": "JSON",
    "llm": "LLM",
    "llms": "LLMs",
    "md": "MD",
    "mcp": "MCP",
    "mlops": "MLOps",
    "nosql": "NoSQL",
    "oop": "OOP",
    "owasp": "OWASP",
    "pacelc": "PACELC",
    "qa": "QA",
    "rag": "RAG",
    "rfc": "RFC",
    "adr": "ADR",
    "rest": "REST",
    "sdk": "SDK",
    "sdks": "SDKs",
    "sdlc": "SDLC",
    "seo": "SEO",
    "sql": "SQL",
    "ssr": "SSR",
    "tls": "TLS",
    "uml": "UML",
    "url": "URL",
    "ux": "UX",
    "ui": "UI",
}

NAME_OVERRIDES = {
    "ai-agents": "AI Agents",
    "ai-engineer": "AI Engineer",
    "ai-data-scientist": "AI Data Scientist",
    "ai-red-teaming": "AI Red Teaming",
    "adr": "ADR",
    "api-design": "API Design",
    "api-docs": "API Docs",
    "authentication-authorization": "Authentication & Authorization",
    "aws": "AWS",
    "bi-analyst": "BI Analyst",
    "blockchain": "Blockchain",
    "cap-pacelc-theorems": "CAP & PACELC Theorems",
    "claude-code": "Claude Code",
    "cloud-native-go": "Cloud-Native Go",
    "code-craft": "Code Craft",
    "golang": "Go",
    "java": "Java",
    "python": "Python",
    "rust": "Rust",
    "sql": "SQL",
    "code-review": "Code Review",
    "computer-science": "Computer Science",
    "cyber-security": "Cyber Security",
    "datastructures-and-algorithms": "Data Structures & Algorithms",
    "ddd": "DDD",
    "design-system": "Design System",
    "devops": "DevOps",
    "devrel": "DevRel",
    "diagnostics": "Diagnostics",
    "elasticsearch": "Elasticsearch",
    "event-driven": "Event-Driven",
    "full-stack": "Full-Stack",
    "git-github": "Git & GitHub",
    "graphql": "GraphQL",
    "ios": "iOS",
    "language-internals": "Language Internals",
    "languages": "Languages",
    "machine-learning": "Machine Learning",
    "mlops": "MLOps",
    "mongodb": "MongoDB",
    "owasp-top-10": "OWASP Top 10",
    "postgresql-dba": "PostgreSQL (DBA)",
    "prompt-engineering": "Prompt Engineering",
    "qa": "QA",
    "quality-engineering": "Quality Engineering",
    "react": "React",
    "redis": "Redis",
    "rfc": "RFC",
    "secure-sdlc": "Secure SDLC",
    "software-architect": "Software Architect",
    "software-design-architecture": "Software Design & Architecture",
    "system-design": "System Design",
    "technical-writer": "Technical Writer",
    "typescript": "TypeScript",
    "vector-clocks-crdts": "Vector Clocks & CRDTs",
    "vibe-coding": "Vibe Coding",
}

LANGUAGE_DISPLAY = {
    "golang": "Go",
    "java": "Java",
    "python": "Python",
    "rust": "Rust",
    "sql": "SQL",
}

# Folder names that should never appear in the output.
SKIP_FOLDERS = {"__pycache__", ".git", "node_modules", ".obsidian"}

# Files at any depth that should be ignored when picking a landing link.
SKIP_FILES = {"TEMPLATE.md"}


# English minor words that should stay lowercase in title-cased headings,
# *unless* they are the first or last word of the string.
TITLE_MINOR_WORDS = {
    "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into",
    "nor", "of", "on", "or", "the", "to", "vs", "with",
}


def titlize(slug: str) -> str:
    """Human-friendly label for a folder slug.

    Order of precedence:
      1. Exact match in ``NAME_OVERRIDES`` (handles brand names like DDD).
      2. Strip leading ``\\d+-`` prefix, apply title case with English
         minor-word rules, then fix up known acronyms — so
         ``ai-red-teaming`` becomes ``AI Red Teaming`` and
         ``introduction-to-go`` becomes ``Introduction to Go``.
    """
    if slug in NAME_OVERRIDES:
        return NAME_OVERRIDES[slug]
    stripped = re.sub(r"^\d+-", "", slug)
    spaced = stripped.replace("-", " ").replace("_", " ")
    titled = _title_case(spaced)
    return _apply_acronyms(titled)


def _title_case(text: str) -> str:
    words = text.split()
    if not words:
        return text
    out = []
    last = len(words) - 1
    for i, w in enumerate(words):
        lower = w.lower()
        if 0 < i < last and lower in TITLE_MINOR_WORDS:
            out.append(lower)
        else:
            out.append(w[:1].upper() + w[1:].lower())
    return " ".join(out)


def _apply_acronyms(text: str) -> str:
    """Whole-word replace title-cased acronyms with their canonical form."""

    def repl(match: re.Match) -> str:
        word = match.group(0)
        return ACRONYMS.get(word.lower(), word)

    return re.sub(r"\b\w+\b", repl, text)


def list_subdirs(p: Path) -> list[Path]:
    if not p.is_dir():
        return []
    return sorted(
        (c for c in p.iterdir() if c.is_dir() and c.name not in SKIP_FOLDERS),
        key=lambda c: c.name,
    )


def find_landing(p: Path) -> Path | None:
    """Best file to link to when pointing at folder ``p``.

    Prefers a top-level README/index/junior in ``p``, then walks deeper to
    find the first junior/index/README. Returns ``None`` if no candidate.
    """
    if not p.is_dir():
        return None
    for name in ("README.md", "index.md", "junior.md"):
        candidate = p / name
        if candidate.exists():
            return candidate
    for preferred in ("junior.md", "index.md", "README.md"):
        for found in sorted(p.rglob(preferred)):
            if found.name not in SKIP_FILES:
                return found
    for found in sorted(p.rglob("*.md")):
        if found.name not in SKIP_FILES:
            return found
    return None


def rel_from_docs(path: Path) -> str:
    return path.relative_to(DOCS_DIR).as_posix()


def folder_has_content(p: Path) -> bool:
    """A folder counts as published if it has any sub-subfolder OR any
    non-template/non-readme markdown file."""
    if any(c.is_dir() and c.name not in SKIP_FOLDERS for c in p.iterdir()):
        return True
    for f in p.iterdir():
        if f.is_file() and f.suffix == ".md" and f.name not in {"README.md", "TEMPLATE.md"}:
            return True
    return False


def render_topic_accordion(
    topic: Path,
    *,
    indent: int,
    show_subitems: bool = True,
) -> list[str]:
    """Render one accordion block for a topic folder.

    Layout:
        ??? note "[Title](path/to/README.md)"

            - Subitem one
            - Subitem two

    Or, when empty:
        ??? note "[Title](path/to/README.md) · soon"

            Coming soon
    """
    title = titlize(topic.name)
    landing = find_landing(topic)
    head = f"[{title}]({rel_from_docs(landing)})" if landing else title
    pad = " " * indent
    inner_pad = " " * (indent + 4)

    subitems = list_subdirs(topic) if show_subitems else []
    has_subitems = bool(subitems)

    if not has_subitems and not folder_has_content(topic):
        head += " · soon"
        body_lines = [f"{inner_pad}Coming soon"]
    elif has_subitems:
        body_lines = []
        for s in subitems:
            s_title = titlize(s.name)
            s_landing = find_landing(s)
            if s_landing is not None:
                body_lines.append(
                    f"{inner_pad}- [{s_title}]({rel_from_docs(s_landing)})"
                )
            else:
                body_lines.append(f"{inner_pad}- {s_title}")
    else:
        # Folder has content but no sub-subfolders (e.g. only README.md
        # with substantive prose). Treat as "filled" with no inner list.
        body_lines = [f"{inner_pad}See [the full roadmap]({rel_from_docs(landing)})." if landing else f"{inner_pad}Coming soon"]

    block = [f'{pad}??? note "{head}"', ""]
    block.extend(body_lines)
    return block


def render_card(category: str) -> list[str]:
    icon = CATEGORY_ICONS.get(category, DEFAULT_ICON)
    title = CATEGORY_TITLES.get(category, titlize(category))
    cat_path = ROADMAP_DIR / category

    lines: list[str] = []
    lines.append(f"-   :{icon}:{{ .lg .middle }} **{title}**")
    lines.append("")
    lines.append("    ---")
    lines.append("")

    if category == "Programming":
        lines.extend(render_programming_languages(cat_path))
    else:
        for topic in list_subdirs(cat_path):
            lines.extend(render_topic_accordion(topic, indent=4))
            lines.append("")
        if lines and lines[-1] == "":
            lines.pop()
    return lines


def render_programming_languages(cat_path: Path) -> list[str]:
    """Special layout: Languages section + Tracks section."""
    lines: list[str] = []
    languages_dir = cat_path / "languages"
    tracks = [t for t in list_subdirs(cat_path) if t.name != "languages"]

    if languages_dir.is_dir():
        lines.append("    **Languages**")
        lines.append("")
        for lang in list_subdirs(languages_dir):
            lines.extend(render_topic_accordion(lang, indent=4))
            lines.append("")

    if tracks:
        lines.append("    **Tracks**")
        lines.append("")
        for tr in tracks:
            lines.extend(render_topic_accordion(tr, indent=4))
            lines.append("")

    if lines and lines[-1] == "":
        lines.pop()
    return lines


def _discover_categories() -> list[str]:
    """Categories under ``_docs/Roadmap/``, ordered by ``CATEGORY_ORDER``
    when listed there and alphabetically for anything new on disk."""
    on_disk = {p.name for p in ROADMAP_DIR.iterdir()
               if p.is_dir() and p.name not in SKIP_FOLDERS}
    ordered = [c for c in CATEGORY_ORDER if c in on_disk]
    extras = sorted(on_disk - set(ordered))
    return ordered + extras


def build_document() -> str:
    parts: list[str] = []
    parts.append("---")
    parts.append("title: Roadmaps")
    parts.append("hide:")
    parts.append("  - toc")
    parts.append("---")
    parts.append("")
    parts.append("# Roadmaps")
    parts.append("")
    parts.append(
        "> Step-by-step learning paths across the entire stack. "
        "Pick a domain, follow the road from junior to professional."
    )
    parts.append("")
    parts.append("<!-- Auto-generated by scripts/generate_roadmap.py — do not edit by hand. -->")
    parts.append("")
    parts.append('<div class="grid cards" markdown>')
    parts.append("")

    for cat in _discover_categories():
        parts.extend(render_card(cat))
        parts.append("")

    parts.append("</div>")
    parts.append("")
    return "\n".join(parts)


def main() -> int:
    if not ROADMAP_DIR.is_dir():
        print(f"error: {ROADMAP_DIR} not found", file=sys.stderr)
        return 1
    doc = build_document()
    OUT_FILE.write_text(doc, encoding="utf-8")
    print(f"wrote {OUT_FILE.relative_to(ROOT)} "
          f"({len(doc.splitlines())} lines, {len(doc)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
