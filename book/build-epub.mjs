// Build reflowable EPUB books from the Go roadmap markdown content.
//
// One section -> one EPUB (reflow handles length, so no page-based part split).
// On a Kindle Scribe an EPUB reflows: adjustable font size, no pinch-zoom.
// Mermaid diagrams are pre-rendered to SVG files; code is highlighted; the book
// gets an EPUB3 nav + an NCX fallback (which Kindle uses).
//
// Usage: node build-epub.mjs [--only NN] [--force]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer";
import {
  ROADMAP_ROOT, OUT_DIR, cleanMarkdown, slug, titleCase, escapeHtml, buildTree, makeRenderer,
} from "./build.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TITLES = {
  "01-introduction-to-go": "Introduction to Go",
  "02-language-basics": "Language Basics",
  "03-methods-and-interfaces": "Methods and Interfaces",
  "04-generics": "Generics",
  "05-error-handling": "Error Handling",
  "06-code-organization": "Code Organization",
  "07-concurrency": "Concurrency",
  "08-standard-library": "The Standard Library",
  "09-testing-and-benchmarking": "Testing and Benchmarking",
  "10-go-toolchain": "The Go Toolchain",
  "11-advanced-topics": "Advanced Topics",
  "12-performance-engineering": "Performance Engineering",
  "13-design-patterns-in-go": "Design Patterns in Go",
  "14-runtime-and-internals": "Runtime and Internals",
  "15-go-source-reading": "Reading the Go Source",
  "16-webassembly-and-alternative-targets": "WebAssembly and Alternative Targets",
  "17-observability-and-runtime-introspection": "Observability and Runtime Introspection",
  "18-modern-language-features": "Modern Language Features",
};

// Consolidated volumes: fewer files, each a reflowable EPUB grouping several
// sections (nav nests volume -> section -> chapter). Concurrency stands alone
// because it is over half the entire corpus.
const VOLUMES = [
  { no: 1, title: "The Go Language", sections: ["01-introduction-to-go", "02-language-basics", "03-methods-and-interfaces", "04-generics", "05-error-handling", "06-code-organization"] },
  { no: 2, title: "Concurrency in Go", sections: ["07-concurrency"] },
  { no: 3, title: "Library, Testing, Tooling & Performance", sections: ["08-standard-library", "09-testing-and-benchmarking", "10-go-toolchain", "11-advanced-topics", "12-performance-engineering"] },
  { no: 4, title: "Patterns, Internals & Modern Go", sections: ["13-design-patterns-in-go", "14-runtime-and-internals", "15-go-source-reading", "16-webassembly-and-alternative-targets", "17-observability-and-runtime-introspection", "18-modern-language-features"] },
];

// Volume 2 (07-concurrency, ~half the corpus) is too large for Send-to-Kindle's
// KFX conversion as a single 341-spine / 16 MB EPUB ("Failed. Please retry").
// Split it at the topic-16 boundary into two balanced parts (~170 spine / ~8 MB
// each — matching Volume 1's known-good profile). Built via --split-vol2.
const topicNum = (dir) => parseInt(dir.match(/^(\d+)/)?.[1] ?? "999", 10);
const VOLUMES_SPLIT2 = [
  { no: "2A", title: "Concurrency in Go, Part 1 — Foundations", sections: ["07-concurrency"], topicFilter: (d) => topicNum(d) <= 16 },
  { no: "2B", title: "Concurrency in Go, Part 2 — Advanced & Production", sections: ["07-concurrency"], topicFilter: (d) => topicNum(d) >= 17 },
];

const unescapeHtml = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

const MERMAID_RE = /<pre class="mermaid">([\s\S]*?)<\/pre>/g;

// Bionic reading: bold the leading ~40% of each word. Server-side over rendered
// HTML — operate only on text between tags, skip code/pre/headings, and never
// split inside an HTML entity (so &amp; etc. stay intact).
function bionicText(text) {
  return text
    .split(/(&[a-zA-Z#0-9]+;)/)
    .map((seg, i) =>
      i % 2 === 1
        ? seg
        : seg.replace(/[A-Za-z]{2,}/g, (w) => {
            const n = Math.max(1, Math.round(w.length * 0.4));
            return `<b class="bionic">${w.slice(0, n)}</b>${w.slice(n)}`;
          })
    )
    .join("");
}

// Split a sequence of top-level block elements into chunks <= limit, cutting only
// at depth-0 element boundaries (never mid-element), so each piece stays valid.
function splitHtml(html, limit) {
  const re = /<[^>]+>|[^<]+/g;
  let depth = 0, buf = "", m;
  const chunks = [];
  while ((m = re.exec(html))) {
    const tok = m[0];
    buf += tok;
    if (tok[0] === "<" && tok[1] !== "/" && tok[1] !== "!" && !/\/>\s*$/.test(tok)) depth++;
    else if (tok.startsWith("</")) {
      depth--;
      if (depth === 0 && buf.length >= limit) { chunks.push(buf); buf = ""; }
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function bionicHtml(html) {
  const SKIP = /^(pre|code|h[1-6]|style|script|figure)$/i;
  let out = "";
  let skip = 0;
  const re = /(<[^>]+>)|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) {
      const tag = m[1];
      const name = (tag.match(/^<\/?\s*([a-zA-Z0-9]+)/) || [, ""])[1].toLowerCase();
      if (SKIP.test(name)) {
        if (tag[1] === "/") skip = Math.max(0, skip - 1);
        else if (!/\/>\s*$/.test(tag)) skip++;
      }
      out += tag;
    } else {
      out += skip > 0 ? m[2] : bionicText(m[2]);
    }
  }
  return out;
}

// One XHTML file per LEAF topic (its tier files only) — keeps each document small
// (~150-500 KB) so Kindle doesn't freeze on a single giant page. Section-relative
// breadcrumb gives the leaf context, e.g. "Time-Based Concurrency · Ticker".
function relTitle(rel) {
  return rel.split("/").map((seg) => titleCase(seg)).join(" · ");
}

function leafBody(node, md, dispTitle) {
  let out = `<h1 class="topic">${escapeHtml(dispTitle)}</h1>`;
  for (const f of node.files) {
    const raw = cleanMarkdown(fs.readFileSync(f.path, "utf8"));
    if (!raw) continue;
    if (f.label) out += `<h2 class="tier">${escapeHtml(f.label)}</h2>`;
    out += `<div class="md">${md.render(raw)}</div>`;
  }
  return out;
}

// Replace ```mermaid blocks with <img> referencing pre-rendered PNG files.
// PNG (rasterized from mermaid's SVG via a headless-Chrome screenshot) sidesteps
// the SVG-validity pitfalls the Kindle converter chokes on (foreignObject,
// duplicate ids, ids with colons). Rendered at 2x for crisp e-ink output.
async function inlineMermaid(page, html, imgDir, prefix, imgManifest) {
  const codes = [];
  html.replace(MERMAID_RE, (m, c) => (codes.push(c), m));
  if (!codes.length) return html;
  const out = [];
  for (let i = 0; i < codes.length; i++) {
    const code = unescapeHtml(codes[i]);
    try {
      await page.evaluate(async (c, id) => {
        const { svg } = await mermaid.render(id, c);
        let host = document.getElementById("host");
        if (!host) { host = document.createElement("div"); host.id = "host"; host.style.display = "inline-block"; host.style.background = "#fff"; document.body.appendChild(host); }
        host.innerHTML = svg;
      }, code, `${prefix}m${i}`);
      const el = await page.$("#host svg");
      if (!el) throw new Error("no svg");
      const name = `${prefix}-${i}.png`;
      await el.screenshot({ path: path.join(imgDir, name), omitBackground: false });
      imgManifest.push(name);
      out.push(`<div class="figure"><img src="img/${name}" alt="diagram"/></div>`);
    } catch {
      out.push(`<pre class="code">${codes[i]}</pre>`); // fallback: show the source
    }
  }
  let i = 0;
  return html.replace(MERMAID_RE, () => out[i++]);
}

function xhtmlDoc(title, bodyInner) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="utf-8"/><title>${escapeHtml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>${bodyInner}</body></html>`;
}

function styleCss(hljsCss) {
  return `${hljsCss}
html { font-family: Georgia, "Times New Roman", serif; line-height: 1.5; }
body { margin: 0 1em; }
h1, h2, h3, h4, h5, h6 { font-family: "Helvetica Neue", Arial, sans-serif; line-height: 1.25; page-break-after: avoid; }
h1.topic { font-size: 1.7em; border-bottom: 2px solid #444; padding-bottom: .2em; }
h2.tier { display: inline-block; background: #1a1a1a; color: #fff; padding: .15em .55em; border-radius: 3px; font-size: 1em; }
code { font-family: "Courier New", monospace; font-size: .9em; background: #f4f4f4; padding: 0 .2em; }
pre { background: #f6f8fa; border: 1px solid #ddd; border-radius: 4px; padding: .7em; overflow-x: auto; font-size: .8em; white-space: pre-wrap; word-wrap: break-word; }
pre code { background: none; }
table { border-collapse: collapse; width: 100%; font-size: .85em; }
th, td { border: 1px solid #ccc; padding: .35em .5em; text-align: left; }
th { background: #f0f0f0; }
blockquote { border-left: 3px solid #888; margin: 1em 0; padding: .2em 1em; color: #444; }
.crumb { color: #777; font-size: .8em; margin: 0 0 .4em; font-family: "Helvetica Neue", Arial, sans-serif; }
.figure { text-align: center; margin: 1em 0; }
.figure img { max-width: 100%; }
a { color: #0a5; }
b.bionic { font-weight: 700; }`;
}

function opf(title, id, chapters, svgs) {
  const date = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const manifestItems = [
    `<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="css" href="style.css" media-type="text/css"/>`,
    ...chapters.map((c) => `<item id="${c.id}" href="${c.file}" media-type="application/xhtml+xml"/>`),
    ...svgs.map((s, i) => `<item id="img${i}" href="img/${s}" media-type="${s.endsWith(".png") ? "image/png" : "image/svg+xml"}"/>`),
  ].join("\n    ");
  const spine = chapters.map((c) => `<itemref idref="${c.id}"/>`).join("\n    ");
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">go-roadmap-${id}</dc:identifier>
    <dc:title>${escapeHtml(title)}</dc:title>
    <dc:creator>Bakhodir Yashin Mansur</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${date}</meta>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine toc="ncx">
    ${spine}
  </spine>
  <guide>
    <reference type="toc" title="Contents" href="nav.xhtml"/>
  </guide>
</package>`;
}

function navXhtml(title, chapters) {
  const items = chapters.map((c) => `<li><a href="${c.file}">${escapeHtml(c.title)}</a></li>`).join("\n      ");
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="utf-8"/><title>Contents</title></head>
<body>
  <nav epub:type="toc" id="toc"><h1>Contents</h1>
    <ol>
      ${items}
    </ol>
  </nav>
  <nav epub:type="landmarks" id="landmarks" hidden="hidden">
    <ol><li><a epub:type="bodymatter" href="${chapters[0] ? chapters[0].file : "#"}">Start</a></li></ol>
  </nav>
</body></html>`;
}

function ncx(title, id, chapters) {
  const points = chapters
    .map((c, i) => `<navPoint id="np${i}" playOrder="${i + 1}"><navLabel><text>${escapeHtml(c.title)}</text></navLabel><content src="${c.file}"/></navPoint>`)
    .join("\n    ");
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="go-roadmap-${id}"/></head>
  <docTitle><text>${escapeHtml(title)}</text></docTitle>
  <navMap>
    ${points}
  </navMap>
</ncx>`;
}

// EPUBs live in their own folder, separate from the PDFs in out/.
const EPUB_DIR = path.join(__dirname, "epub");
let bionicEnabled = true; // bold word-prefixes; disable with --no-bionic
const CHUNK_LIMIT = 440_000; // ~500 KB max per XHTML doc incl. wrapper (Kindle responsive)

async function newMermaidPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 }); // 2x => crisp PNGs
  await page.setContent(`<!doctype html><html><body style="background:#fff"></body></html>`);
  await page.addScriptTag({ path: path.join(__dirname, "node_modules/mermaid/dist/mermaid.min.js") });
  // htmlLabels:false -> labels render as SVG <text>, not <foreignObject>, which the
  // Kindle (KFX) converter cannot handle.
  await page.evaluate(() =>
    mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose", htmlLabels: false, flowchart: { htmlLabels: false }, class: { htmlLabels: false } })
  );
  return page;
}

// Write one small XHTML per TIER file of each leaf topic (so no single document
// is large enough to freeze Kindle). Returns:
//   docs        — every tier xhtml, in reading/spine order
//   navChapters — one entry per leaf topic (-> its first tier file); tiers within
//                 a leaf flow by swiping, keeping the TOC at topic granularity.
async function renderSectionChapters(section, md, page, oebps, imgDir, imgManifest, topicFilter) {
  const sectionDir = path.join(ROADMAP_ROOT, section);
  const bookNo = section.match(/^(\d+)/)[1];
  const prefix = `s${bookNo}`;
  const tree = buildTree(sectionDir, prefix, 0, sectionDir);

  let leaves = [];
  (function walk(n) {
    if (n.files && n.files.length) leaves.push(n);
    for (const c of n.children) walk(c);
  })(tree);

  // Optional split: keep only leaves whose top-level topic dir passes the filter.
  // Used to halve an oversized section (e.g. 07-concurrency) into two EPUBs that
  // stay within Send-to-Kindle's KFX conversion limits.
  if (topicFilter) leaves = leaves.filter((n) => topicFilter(n.rel.split("/")[0]));

  const docs = [];
  const navChapters = [];
  let li = 0;
  for (const leaf of leaves) {
    li++;
    const dispTitle = relTitle(leaf.rel);

    // Build one HTML block per tier, then pack consecutive tiers into chunks of
    // <= ~500 KB so each XHTML stays small (no Kindle freeze) without splitting
    // every tier into its own tiny file.
    const blocks = [];
    for (const f of leaf.files) {
      const raw = cleanMarkdown(fs.readFileSync(f.path, "utf8"));
      if (!raw) continue;
      const rendered = bionicEnabled ? bionicHtml(md.render(raw)) : md.render(raw);
      // A single tier can exceed the limit (esp. bionic ~doubles size), so split
      // its content at block boundaries too.
      const pieces = splitHtml(rendered, CHUNK_LIMIT);
      pieces.forEach((p, idx) => {
        let b = idx === 0 && f.label ? `<h2 class="tier">${escapeHtml(f.label)}</h2>` : "";
        b += `<div class="md">${p}</div>`;
        blocks.push(b);
      });
    }
    if (!blocks.length) continue;

    const chunks = [];
    let cur = "";
    for (const b of blocks) {
      if (cur && cur.length + b.length > CHUNK_LIMIT) { chunks.push(cur); cur = ""; }
      cur += b;
    }
    if (cur) chunks.push(cur);

    let ci = 0;
    for (const chunk of chunks) {
      ci++;
      const cid = `${prefix}l${String(li).padStart(4, "0")}c${ci}`;
      const file = `${cid}.xhtml`;
      let inner = ci === 1
        ? `<h1 class="topic">${escapeHtml(dispTitle)}</h1>`
        : `<p class="crumb">${escapeHtml(dispTitle)} (cont.)</p>`;
      inner += chunk;
      inner = await inlineMermaid(page, inner, imgDir, cid, imgManifest);
      fs.writeFileSync(path.join(oebps, file), xhtmlDoc(dispTitle, inner));
      docs.push({ id: cid, file });
      if (ci === 1) navChapters.push({ id: cid, file, title: dispTitle });
    }
  }
  return { title: TITLES[section], navChapters, docs };
}

function stageDirs(stage) {
  fs.rmSync(stage, { recursive: true, force: true });
  const oebps = path.join(stage, "OEBPS");
  const imgDir = path.join(oebps, "img");
  fs.mkdirSync(imgDir, { recursive: true });
  fs.mkdirSync(path.join(stage, "META-INF"), { recursive: true });
  return { oebps, imgDir };
}

function packageEpub(stage, oebps, epubPath, hljsCss, { title, id, chapters, svgManifest, navHtml, ncxXml }) {
  fs.writeFileSync(path.join(stage, "mimetype"), "application/epub+zip");
  fs.writeFileSync(
    path.join(stage, "META-INF", "container.xml"),
    `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
  );
  fs.writeFileSync(path.join(oebps, "style.css"), styleCss(hljsCss));
  fs.writeFileSync(path.join(oebps, "content.opf"), opf(title, id, chapters, svgManifest));
  fs.writeFileSync(path.join(oebps, "nav.xhtml"), navHtml);
  fs.writeFileSync(path.join(oebps, "toc.ncx"), ncxXml);

  fs.rmSync(epubPath, { force: true });
  execFileSync("zip", ["-X", "-0", epubPath, "mimetype"], { cwd: stage, stdio: "ignore" });
  execFileSync("zip", ["-X", "-r", "-9", "-D", epubPath, "META-INF", "OEBPS"], { cwd: stage, stdio: "ignore" });
  fs.rmSync(stage, { recursive: true, force: true });
}

// Nested nav/ncx for a multi-section volume.
function navXhtmlVolume(title, groups) {
  // Section header is a <span> (not a link) so it doesn't duplicate the first
  // chapter's href — duplicate hrefs make Kindle's Contents popup render blank.
  const lis = groups
    .map((g) => {
      const inner = g.chapters.map((c) => `<li><a href="${c.file}">${escapeHtml(c.title)}</a></li>`).join("\n          ");
      return `<li><span>${escapeHtml(g.title)}</span>\n        <ol>\n          ${inner}\n        </ol></li>`;
    })
    .join("\n      ");
  const first = groups[0] && groups[0].chapters[0] ? groups[0].chapters[0].file : "#";
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="utf-8"/><title>Contents</title></head>
<body>
  <nav epub:type="toc" id="toc"><h1>${escapeHtml(title)}</h1>
    <ol>
      ${lis}
    </ol>
  </nav>
  <nav epub:type="landmarks" id="landmarks" hidden="hidden">
    <ol><li><a epub:type="bodymatter" href="${first}">Start</a></li></ol>
  </nav>
</body></html>`;
}

function ncxVolume(title, id, groups) {
  // Flat NCX (one navPoint per chapter, unique target/playOrder) — Kindle's
  // Contents popup renders flat NCX most reliably; nested navPoints sharing a
  // content src can make it appear blank. Section grouping is kept in nav.xhtml.
  let order = 0;
  const points = groups
    .flatMap((g) => g.chapters)
    .map((c) => `<navPoint id="${c.id}" playOrder="${++order}"><navLabel><text>${escapeHtml(c.title)}</text></navLabel><content src="${c.file}"/></navPoint>`)
    .join("\n    ");
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="go-roadmap-${id}"/></head>
  <docTitle><text>${escapeHtml(title)}</text></docTitle>
  <navMap>
    ${points}
  </navMap>
</ncx>`;
}

async function buildVolume(vol, browser, hljsCss, force) {
  const id = `vol${vol.no}-${slug(vol.title)}`;
  const epubPath = path.join(EPUB_DIR, `Golang-Volume-${vol.no}-${slug(vol.title)}.epub`);
  if (!force && fs.existsSync(epubPath) && fs.statSync(epubPath).size > 0) {
    console.log(`  skip (exists): ${path.basename(epubPath)}`);
    return;
  }
  const stage = path.join(EPUB_DIR, ".stage", id);
  const { oebps, imgDir } = stageDirs(stage);
  const md = makeRenderer({ xhtml: true, html: false, linkExternalOnly: true, anchors: false });
  const page = await newMermaidPage(browser);

  const svgManifest = [];
  const groups = [];
  const allDocs = [];
  for (const section of vol.sections) {
    const { title: secTitle, navChapters, docs } = await renderSectionChapters(section, md, page, oebps, imgDir, svgManifest, vol.topicFilter);
    groups.push({ title: secTitle, chapters: navChapters });
    allDocs.push(...docs);
  }
  await page.close();

  packageEpub(stage, oebps, epubPath, hljsCss, {
    title: vol.title,
    id,
    chapters: allDocs, // spine = every tier file
    svgManifest,
    navHtml: navXhtmlVolume(vol.title, groups),
    ncxXml: ncxVolume(vol.title, id, groups),
  });
  const navCount = groups.reduce((s, g) => s + g.chapters.length, 0);
  const kb = (fs.statSync(epubPath).size / 1024).toFixed(0);
  console.log(`  ✓ ${path.basename(epubPath)} (${groups.length} sections, ${navCount} topics, ${allDocs.length} pages, ${svgManifest.length} diagrams, ${kb} KB)`);
}

async function buildSection(section, browser, hljsCss, force) {
  const bookNo = section.match(/^(\d+)/)[1];
  const title = TITLES[section];
  const id = slug(title);
  const epubPath = path.join(EPUB_DIR, `Golang-Book-${bookNo}-${id}.epub`);
  if (!force && fs.existsSync(epubPath) && fs.statSync(epubPath).size > 0) {
    console.log(`  skip (exists): ${path.basename(epubPath)}`);
    return;
  }
  const stage = path.join(EPUB_DIR, ".stage", id);
  const { oebps, imgDir } = stageDirs(stage);
  const md = makeRenderer({ xhtml: true, html: false, linkExternalOnly: true, anchors: false });
  const page = await newMermaidPage(browser);
  const svgManifest = [];
  const { navChapters, docs } = await renderSectionChapters(section, md, page, oebps, imgDir, svgManifest);
  await page.close();

  packageEpub(stage, oebps, epubPath, hljsCss, {
    title, id, chapters: docs, svgManifest,
    navHtml: navXhtml(title, navChapters),
    ncxXml: ncx(title, id, navChapters),
  });
  const kb = (fs.statSync(epubPath).size / 1024).toFixed(0);
  console.log(`  ✓ ${path.basename(epubPath)} (${navChapters.length} topics, ${docs.length} pages, ${svgManifest.length} diagrams, ${kb} KB)`);
}

async function main() {
  const argv = process.argv.slice(2);
  const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
  const force = argv.includes("--force");
  const volumes = argv.includes("--volumes");
  const splitVol2 = argv.includes("--split-vol2");
  fs.mkdirSync(EPUB_DIR, { recursive: true });

  const hljsCss = fs.readFileSync(path.join(__dirname, "node_modules/highlight.js/styles/github.css"), "utf8");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });

  if (volumes || splitVol2) {
    const list = splitVol2 ? VOLUMES_SPLIT2 : VOLUMES;
    for (const vol of list) {
      console.log(`\nVolume ${vol.no}: ${vol.title}`);
      try { await buildVolume(vol, browser, hljsCss, force); }
      catch (e) { console.error(`  FAILED: Volume ${vol.no} — ${e.message}`); }
    }
  } else {
    const sections = Object.keys(TITLES)
      .filter((s) => fs.existsSync(path.join(ROADMAP_ROOT, s)))
      .filter((s) => !only || s.startsWith(only));
    for (const section of sections) {
      console.log(`\nBook ${section.match(/^(\d+)/)[1]}: ${TITLES[section]}`);
      try { await buildSection(section, browser, hljsCss, force); }
      catch (e) { console.error(`  FAILED: ${section} — ${e.message}`); }
    }
  }
  await browser.close();
  console.log("\nEPUB build done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
