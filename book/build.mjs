// Build print-quality PDF books from the Go roadmap markdown content.
//
// Usage:
//   node build.mjs <section-dir> [--book NN] [--title "..."] [--out name.pdf]
//
//   <section-dir> is relative to the golang roadmap root, e.g. "01-introduction-to-go".
//
// One section -> one book. Walks the section tree in roadmap order, renders
// markdown (tables, anchors), highlights code with highlight.js, turns ```mermaid
// fences into real SVG diagrams in a headless Chrome, then prints to PDF with a
// cover, clickable in-page table of contents, a PDF sidebar outline (with page
// numbers), running footer page numbers and book-grade typography.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import hljs from "highlight.js";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROADMAP_ROOT = path.resolve(
  __dirname,
  "../Roadmap/Programming/languages/golang"
);
const OUT_DIR = path.join(__dirname, "out");

// Page geometry profiles. "kindle" matches the Kindle Scribe's ~3:4 screen so a
// page fills the e-ink display with comfortably large text; "a4" is print stock.
const PROFILES = {
  kindle: { w: 160, h: 213, margin: { top: 12, right: 12, bottom: 14, left: 12 }, font: 11 },
  a4: { w: 210, h: 297, margin: { top: 22, right: 18, bottom: 20, left: 18 }, font: 10.5 },
};

// Files that make up a leaf topic, in the order they should appear in the book.
// index.md is intentionally excluded: in this roadmap it is a pure web-navigation
// hub (front matter + "← Back" + a link table), which is noise in a book.
const TIER_ORDER = [
  { file: "junior.md", label: "Junior" },
  { file: "middle.md", label: "Middle" },
  { file: "senior.md", label: "Senior" },
  { file: "professional.md", label: "Professional" },
  { file: "interview.md", label: "Interview Questions" },
];
// A folder counts as a leaf topic if it holds any of these (incl. index.md, so
// nav-only topics are still recognized as leaves rather than treated as groups).
const TIER_FILES = new Set([...TIER_ORDER.map((t) => t.file), "index.md"]);

// Strip web-only cruft so each file reads as book prose:
//  - Jekyll YAML front matter
//  - the leading "# Title" (the book already prints a topic + tier heading)
//  - standalone "← Back" navigation links
//  - the per-file "## Table of Contents" anchor list (the PDF outline replaces it)
function cleanMarkdown(raw) {
  let s = raw.replace(/^﻿/, "");
  s = s.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  s = s.replace(/^\s*#\s+[^\n]*\r?\n/, "");
  s = s.replace(/^[ \t]*\[\s*←[^\]]*\]\([^)]*\)[ \t]*$/gm, "");
  s = s.replace(/^##\s+(Table of Contents|Contents)[ \t]*\r?\n[\s\S]*?(?=^#{1,3}\s)/m, "");
  return s.trim();
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--book") args.book = argv[++i];
    else if (a === "--title") args.title = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--profile") args.profile = argv[++i];
    else if (a === "--include") args.include = argv[++i];
    else if (a === "--part") args.part = argv[++i];
    else if (a === "--bionic") args.bionic = true;
    else args._.push(a);
  }
  return args;
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------
// Content headings are demoted by this amount so the book hierarchy stays clean:
// topic title = h1, tier = h2, and a file's own h1 lands at h3.
const HEADING_OFFSET = 2;

function makeRenderer({ xhtml = false, html = true, linkExternalOnly = false, anchors = true } = {}) {
  const md = new MarkdownIt({
    // EPUB sets html:false so stray markup like `List<T>` is escaped, keeping the
    // output well-formed XHTML; code-highlight and mermaid blocks still emit markup.
    html,
    linkify: true,
    typographer: true,
    breaks: false,
    xhtmlOut: xhtml, // EPUB needs well-formed XHTML (self-closed <br/>, <img/>)
    highlight(code, lang) {
      if (lang === "mermaid") {
        // Defer to client-side mermaid: emit the raw (escaped) source. The
        // browser un-escapes entities into textContent, which mermaid reads.
        return `<pre class="mermaid">${md.utils.escapeHtml(code)}</pre>`;
      }
      if (lang && hljs.getLanguage(lang)) {
        try {
          const out = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
          return `<pre class="hljs"><code class="language-${lang}">${out}</code></pre>`;
        } catch {
          /* fall through */
        }
      }
      const auto = hljs.highlightAuto(code).value;
      return `<pre class="hljs"><code>${auto}</code></pre>`;
    },
  });

  // EPUB skips heading ids: tiers repeat heading names (Introduction, Core
  // Concepts…) within one chapter, which would create duplicate IDs (invalid).
  if (anchors) md.use(anchor, { slugify: (s) => slug(s) });

  // Demote content headings so they sit below the injected chapter/tier headings.
  const openRule = md.renderer.rules.heading_open;
  const closeRule = md.renderer.rules.heading_close;
  md.renderer.rules.heading_open = function (tokens, idx, options, env, self) {
    demote(tokens[idx]);
    return openRule ? openRule(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
  };
  md.renderer.rules.heading_close = function (tokens, idx, options, env, self) {
    demote(tokens[idx]);
    return closeRule ? closeRule(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
  };

  if (linkExternalOnly) {
    // Drop href on internal/relative links (e.g. ../other/junior.md, #anchor) so
    // EPUB validation passes — those targets don't exist inside the container.
    // The link text is kept; only real web links survive.
    const linkOpen = md.renderer.rules.link_open;
    md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
      const href = tokens[idx].attrGet("href") || "";
      if (!/^(https?:|mailto:)/i.test(href)) {
        const ai = tokens[idx].attrIndex("href");
        if (ai >= 0) tokens[idx].attrs.splice(ai, 1);
      }
      return linkOpen ? linkOpen(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
    };
  }
  return md;
}

function demote(token) {
  const level = Math.min(6, parseInt(token.tag.slice(1), 10) + HEADING_OFFSET);
  token.tag = "h" + level;
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function titleCase(name) {
  // "03-setting-up-environment" -> "Setting Up Environment"
  return name
    .replace(/^\d+[-_]?/, "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Content tree
// ---------------------------------------------------------------------------
// A node is either a "topic" (a folder holding tier .md files) or a "group"
// (a folder holding sub-folders). Order follows the numeric folder prefixes.
function numericSort(a, b) {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

function buildTree(dir, idPrefix, depth, rootDir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort(numericSort);
  const hasTierFiles = entries.some((e) => e.isFile() && TIER_FILES.has(e.name));

  const node = {
    dir,
    rel: path.relative(rootDir, dir), // "" for the section root
    id: idPrefix,
    title: titleCase(path.basename(dir)),
    depth,
    files: [],
    children: [],
  };

  if (hasTierFiles) {
    for (const { file, label } of TIER_ORDER) {
      const fp = path.join(dir, file);
      if (fs.existsSync(fp)) node.files.push({ path: fp, label, file });
    }
  }
  for (const name of subdirs) {
    node.children.push(buildTree(path.join(dir, name), `${idPrefix}-${slug(name)}`, depth + 1, rootDir));
  }
  return node;
}

// ---------------------------------------------------------------------------
// HTML assembly
// ---------------------------------------------------------------------------
function renderNode(node, md, toc, isTopLevel, baseDepth = 0) {
  let html = "";
  // Heading level is relative to the render root so a deep unit promoted to a
  // chapter (when an oversized section is split by sub-topic) still reads as h2.
  const relDepth = node.depth - baseDepth;
  const headingLevel = Math.min(6, relDepth + 1);
  const pageBreak = isTopLevel ? ' class="chapter"' : "";

  // Heading for this node (chapter or sub-group).
  html += `<section${pageBreak} id="${node.id}">`;
  html += `<h${headingLevel} class="node-title">${escapeHtml(node.title)}</h${headingLevel}>`;
  toc.push({ id: node.id, title: node.title, depth: relDepth, topLevel: isTopLevel });

  // Tier files for a leaf topic. Every tier after the first starts on a new page
  // so a tier heading (Middle/Senior/…) never sits orphaned at a page bottom.
  let tierIdx = 0;
  for (const f of node.files) {
    const raw = cleanMarkdown(fs.readFileSync(f.path, "utf8"));
    if (!raw) continue;
    if (f.label) {
      tierIdx++;
      const tierId = `${node.id}-${slug(f.label)}`;
      const lvl = Math.min(6, headingLevel + 1);
      // Block wrapper carries the page break (the inline-block badge cannot).
      const brk = tierIdx > 1 ? " tier-break" : "";
      html += `<div class="tier-head${brk}"><h${lvl} class="tier-title" id="${tierId}">${f.label}</h${lvl}></div>`;
    }
    html += `<div class="md">${md.render(raw)}</div>`;
  }

  // Recurse into sub-groups / sub-topics.
  for (const child of node.children) {
    html += renderNode(child, md, toc, false, baseDepth);
  }
  html += `</section>`;
  return html;
}

function buildToc(toc) {
  let html = '<nav class="toc"><h1>Contents</h1><ul>';
  for (const item of toc) {
    if (item.depth > 2) continue; // keep the printed TOC to top two levels
    const cls = item.topLevel ? "toc-l1" : "toc-l2";
    html += `<li class="${cls}"><a href="#${item.id}">${escapeHtml(item.title)}</a></li>`;
  }
  html += "</ul></nav>";
  return html;
}

function bookCss(hljsCss, p) {
  const m = p.margin;
  const coverH = p.h - m.top - m.bottom - 4;
  return `
${hljsCss}
:root { --fg:#1a1a1a; --muted:#555; --accent:#00add8; --code-bg:#f6f8fa; --border:#e1e4e8; }
@page { size: ${p.w}mm ${p.h}mm; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  font-family: "Charter", "Georgia", "Times New Roman", serif;
  color: var(--fg); font-size: ${p.font}pt; line-height: 1.55; margin: 0;
}
h1,h2,h3,h4,h5,h6 { font-family: "Helvetica Neue", Arial, sans-serif; line-height: 1.25; font-weight: 700; }
section.chapter { break-before: page; }
.node-title { color: var(--accent); border-bottom: 2px solid var(--accent); padding-bottom: 6px; margin-top: 0; }
h1.node-title { font-size: 24pt; }
h2.node-title { font-size: 18pt; }
.tier-head { margin-top: 1.4em; break-after: avoid; }
/* Dark badge stays legible on the Kindle Scribe's grayscale e-ink screen
   (the cyan accent would wash out to pale gray). */
.tier-title { padding: 4px 11px; background: #1a1a1a; color: #fff; border-radius: 4px; display: inline-block; font-size: 12pt; margin: 0; letter-spacing: 0.5px; }
.tier-break { break-before: page; margin-top: 0; }
.node-title { break-after: avoid; }
.md h3,.md h4,.md h5,.md h6 { margin-top: 1.1em; }
.md h3 { font-size: 14pt; } .md h4 { font-size: 12pt; } .md h5 { font-size: 11pt; color: var(--muted); }
p, li { orphans: 3; widows: 3; }
/* Book-like justified prose with automatic hyphenation. */
.md p, .md li { text-align: justify; hyphens: auto; -webkit-hyphens: auto; }
a { color: var(--accent); text-decoration: none; }
/* Bionic reading: bolded word-prefixes guide the eye. */
b.bionic { font-weight: 700; }
code { font-family: "SF Mono", "Menlo", "Consolas", monospace; font-size: 9pt; background: var(--code-bg); padding: 1px 4px; border-radius: 3px; }
/* Long code may break across pages (avoiding it strands huge snippets and
   leaves blank pages); keep the box styling on each fragment. */
pre { break-inside: auto; background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px; overflow: hidden; font-size: 8.5pt; line-height: 1.45; }
pre code { background: none; padding: 0; font-size: inherit; white-space: pre-wrap; word-break: break-word; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; break-inside: auto; font-size: 9pt; }
tr { break-inside: avoid; }
thead { display: table-header-group; }
th, td { border: 1px solid var(--border); padding: 6px 9px; text-align: left; vertical-align: top; }
th { background: var(--code-bg); }
blockquote { border-left: 3px solid var(--accent); margin: 1em 0; padding: 2px 14px; color: var(--muted); background: #fafdff; break-inside: avoid; }
img, svg { max-width: 100%; }
/* A diagram stays whole but never taller than a page, so it can't strand a
   blank page before it. */
pre.mermaid { background: none; border: none; text-align: center; padding: 8px 0; break-inside: avoid; }
pre.mermaid svg { max-width: 100%; height: auto; max-height: ${p.h - m.top - m.bottom - 16}mm; }

/* Cover */
.cover { break-after: page; height: ${coverH}mm; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; }
.cover .kicker { font-family: "SF Mono","Menlo",monospace; letter-spacing: 3px; text-transform: uppercase; color: var(--accent); font-size: 12pt; }
.cover .book-no { font-family: "SF Mono","Menlo",monospace; color: var(--muted); margin-top: 8px; font-size: 11pt; }
.cover h1 { font-size: 30pt; margin: 16px 0 8px; max-width: 88%; }
.cover .part { font-family:"SF Mono","Menlo",monospace; color:var(--accent); margin-top:14px; font-size:12pt; }
.cover .sub { color: var(--muted); font-size: 13pt; }
.cover .rule { width: 80px; height: 4px; background: var(--accent); margin: 24px auto; }
.cover .author { margin-top: 40px; font-size: 11pt; color: var(--muted); }

/* TOC */
.toc { break-after: page; }
.toc h1 { font-size: 22pt; color: var(--accent); }
.toc ul { list-style: none; padding: 0; }
.toc li { padding: 3px 0; }
.toc-l1 { font-weight: 700; margin-top: 8px; font-family: "Helvetica Neue",Arial,sans-serif; }
.toc-l2 { padding-left: 20px; font-size: 10pt; }
`;
}

function buildHtml({ bookNo, title, subtitle, tree, md, profile, include, part, bionic }) {
  const toc = [];
  let body = "";
  let roots;
  if (include && include.length) {
    // include entries are section-root-relative dir paths (top-level topics, or
    // deeper sub-topics when an oversized section is split). Render each as a
    // chapter, in the given order.
    const byRel = new Map();
    (function idx(n) { byRel.set(n.rel, n); n.children.forEach(idx); })(tree);
    roots = include.map((r) => byRel.get(r)).filter(Boolean);
  } else {
    roots = tree.children;
  }
  for (const node of roots) {
    body += renderNode(node, md, toc, true, node.depth - 1);
  }

  const hljsCss = fs.readFileSync(
    path.join(__dirname, "node_modules/highlight.js/styles/github.css"),
    "utf8"
  );
  const mermaidJs = fs.readFileSync(
    path.join(__dirname, "node_modules/mermaid/dist/mermaid.min.js"),
    "utf8"
  );

  const cover = `
  <div class="cover">
    <div class="kicker">The Go Roadmap</div>
    ${bookNo ? `<div class="book-no">Book ${bookNo}</div>` : ""}
    <div class="rule"></div>
    <h1>${escapeHtml(title)}</h1>
    ${subtitle ? `<div class="sub">${escapeHtml(subtitle)}</div>` : ""}
    ${part ? `<div class="part">Part ${part}</div>` : ""}
    <div class="author">Bakhodir Yashin Mansur</div>
  </div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${bookCss(hljsCss, profile)}</style>
</head><body>
${cover}
${buildToc(toc)}
${body}
<script>${mermaidJs}</script>
<script>
  // Bionic reading: bold the leading ~40% of each prose word. Runs AFTER mermaid
  // so it never touches SVG text (diagrams live inside <pre>, which is skipped).
  function applyBionic(root) {
    const SKIP = new Set(["PRE","CODE","SCRIPT","STYLE","H1","H2","H3","H4","H5","H6","SVG","TEXT","TSPAN"]);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        for (let p = n.parentElement; p; p = p.parentElement) {
          if (SKIP.has(p.tagName) || (p.classList && (p.classList.contains("tier-title") || p.classList.contains("toc") || p.classList.contains("cover")))) return NodeFilter.FILTER_REJECT;
        }
        return n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes = [];
    while (w.nextNode()) nodes.push(w.currentNode);
    for (const n of nodes) {
      const frag = document.createDocumentFragment();
      for (const part of n.nodeValue.split(/(\s+)/)) {
        if (part === "" || /^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); continue; }
        const letters = part.replace(/[^A-Za-z0-9]/g, "").length;
        const m = Math.max(1, Math.round(letters * 0.4));
        const b = document.createElement("b");
        b.className = "bionic";
        b.textContent = part.slice(0, m);
        frag.appendChild(b);
        frag.appendChild(document.createTextNode(part.slice(m)));
      }
      n.parentNode.replaceChild(frag, n);
    }
  }
  (async () => {
    try {
      mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose" });
      await mermaid.run({ querySelector: "pre.mermaid" });
    } catch (e) { console.error("mermaid", e); }
    ${bionic ? "try { applyBionic(document.body); } catch (e) { console.error('bionic', e); }" : ""}
    window.__mermaidDone = true;
  })();
</script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sectionRel = args._[0];
  if (!sectionRel) {
    console.error('Usage: node build.mjs <section-dir> [--book NN] [--title "..."] [--out name.pdf]');
    process.exit(1);
  }
  const sectionDir = path.join(ROADMAP_ROOT, sectionRel);
  if (!fs.existsSync(sectionDir)) {
    console.error(`Section not found: ${sectionDir}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const profile = PROFILES[args.profile || "kindle"] || PROFILES.kindle;
  const title = args.title || titleCase(path.basename(sectionDir));
  const bookNo = args.book || (path.basename(sectionDir).match(/^(\d+)/) || [])[1] || "";
  const include = args.include ? args.include.split(",").map((s) => s.trim()).filter(Boolean) : null;
  const part = args.part || null;
  const bionic = !!args.bionic;
  const outName = args.out || `Book-${bookNo || "XX"}-${slug(title)}.pdf`;
  const outPath = path.join(OUT_DIR, outName);

  console.log(`Building "${title}"${part ? ` (Part ${part})` : ""} [Book ${bookNo}, ${args.profile || "kindle"}]...`);
  const md = makeRenderer();
  const tree = buildTree(sectionDir, `s${bookNo}`, 0, sectionDir);
  const html = buildHtml({ bookNo, title, subtitle: "Go Roadmap", tree, md, profile, include, part, bionic });

  if (process.env.DEBUG_HTML) {
    fs.writeFileSync(path.join(OUT_DIR, outName.replace(/\.pdf$/, ".html")), html);
  }

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.warn("  [page]", m.text()); });

  // All assets are inlined, so wait only for the DOM (networkidle0 stalls on
  // very large documents). Mermaid is awaited separately below.
  await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 300000 });
  await page.waitForFunction("window.__mermaidDone === true", { timeout: 300000 }).catch(() => {
    console.warn("  mermaid render timed out; continuing");
  });
  await page.emulateMediaType("print");

  const m = profile.margin;
  await page.pdf({
    path: outPath,
    width: `${profile.w}mm`,
    height: `${profile.h}mm`,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: `<div></div>`,
    footerTemplate: `<div style="width:100%; font-size:7px; color:#888; font-family:Helvetica,Arial,sans-serif; padding:0 ${m.left}mm 0 ${m.left}mm; display:flex; justify-content:space-between;">
        <span>${escapeHtml(title)}${part ? ` · Part ${part}` : ""}</span>
        <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>`,
    margin: { top: `${m.top}mm`, bottom: `${m.bottom}mm`, left: `${m.left}mm`, right: `${m.right}mm` },
    outline: true,
    tagged: true,
    timeout: 240000,
  });

  await browser.close();
  const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
  console.log(`✓ ${outPath} (${kb} KB)`);
}

// Reusable helpers for the EPUB builder.
export { ROADMAP_ROOT, OUT_DIR, cleanMarkdown, slug, titleCase, escapeHtml, buildTree, makeRenderer, TIER_ORDER };

// Only run the PDF build when invoked directly (not when imported).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
