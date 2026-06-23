# Go Roadmap → e-reader books

Builds books from the Go roadmap markdown content
(`Roadmap/Programming/languages/golang`, 18 sections). Two outputs:

- **EPUB** (current deliverable) — reflowable, ideal for Kindle Scribe → `book/epub/`
- **PDF** — fixed-layout, Kindle-Scribe page geometry → `book/out/`

Both strip web-only cruft (YAML front matter, `← Back` links, per-file Tables of
Contents, `index.md` nav hubs), highlight code, and render ` ```mermaid ` diagrams.

## Install

```bash
cd book && npm install   # puppeteer downloads its own Chromium
```

## EPUB (recommended for Kindle)

```bash
node build-epub.mjs --volumes        # 4 consolidated volumes -> book/epub/
node build-epub.mjs                  # one EPUB per section
node build-epub.mjs --only 07        # a single section
#   flags: --force (rebuild), --no-bionic (disable bionic reading)
```

Per volume: nested nav (volume → section → topic), code highlighting, **bionic
reading** (bold word-prefixes), Mermaid rasterized to **PNG @2x** (Kindle's KFX
converter chokes on SVG). Content is split into ≤ ~500 KB XHTML files per topic so
Kindle never freezes on a giant page. Validate with epubcheck:

```bash
java -jar epubcheck.jar book/epub/Golang-Volume-1-the-go-language.epub
```

### Kindle-validity rules baked into the EPUB builder
- internal/relative links have their `href` stripped (else leak-outside-container errors)
- no heading-id anchors (tiers repeat heading names → duplicate-ID errors)
- diagrams as PNG, not SVG (foreignObject / duplicate-id / colon-id all break KFX)
- flat NCX + OPF `<guide>` + `<span>` section headers (else Kindle Contents popup is blank)
- ≤ ~500 KB per XHTML (else Kindle freezes)

## PDF

```bash
node build-all.mjs                   # all sections, auto Part-splitting -> book/out/
node build.mjs 01-introduction-to-go --title "Introduction to Go"
#   flags: --profile kindle|a4, --force, --plan (preview split), --bionic
node build-index.mjs                 # master catalog PDF from out/INDEX.md
```

PDF uses a Kindle-Scribe page (160×213mm, 11pt), tier-per-page breaks, dark legible
tier badges, and a clickable outline. Oversized sections split into Parts.
