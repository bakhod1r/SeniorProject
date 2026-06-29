// Build reflowable EPUB books from the Data-Structures-&-Algorithms roadmap.
//
// Mirrors build-epub.mjs (the Go pipeline) but targets the DSA content tree and
// its 6-file leaf set (junior/middle/senior/professional/interview + tasks).
// One section -> one EPUB by default; --volumes groups sections into 6 volumes.
//
// Usage: node build-epub-dsa.mjs [--only NN] [--volumes] [--force] [--no-bionic]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer";
import {
  cleanMarkdown, slug, titleCase, escapeHtml, makeRenderer,
} from "./build.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DSA content root (separate from the Go ROADMAP_ROOT in build.mjs).
const ROADMAP_ROOT = path.resolve(
  __dirname,
  "../Roadmap/Data/datastructures-and-algorithms"
);

// DSA leaf = these 6 tiers (Go has no tasks.md; DSA does). index/README excluded:
// they are pure web-nav hubs, noise in a book.
const TIER_ORDER = [
  { file: "junior.md", label: "Junior" },
  { file: "middle.md", label: "Middle" },
  { file: "senior.md", label: "Senior" },
  { file: "professional.md", label: "Professional" },
  { file: "interview.md", label: "Interview Questions" },
  { file: "tasks.md", label: "Practice Tasks" },
];
// A folder is a leaf topic if it holds any of these (README included so a
// README-only folder is still recognized as a leaf, not a group).
const TIER_FILES = new Set([...TIER_ORDER.map((t) => t.file), "README.md", "index.md"]);

const TITLES = {
  "01-introduction-to-dsa": "Introduction to DSA",
  "02-programming-fundamentals": "Programming Fundamentals",
  "03-what-are-data-structures": "What Are Data Structures",
  "04-why-are-data-structures-important": "Why Data Structures Matter",
  "05-basic-data-structures": "Basic Data Structures",
  "06-algorithmic-complexity": "Algorithmic Complexity",
  "07-sorting-algorithms": "Sorting Algorithms",
  "08-search-algorithms": "Search Algorithms",
  "09-trees": "Trees",
  "10-heaps": "Heaps",
  "11-graphs": "Graphs",
  "12-disjoint-set": "Disjoint Set",
  "13-dynamic-programming": "Dynamic Programming",
  "14-greedy-algorithms": "Greedy Algorithms",
  "15-divide-and-conquer": "Divide and Conquer",
  "16-backtracking": "Backtracking",
  "17-string-algorithms": "String Algorithms",
  "18-bit-manipulation": "Bit Manipulation",
  "19-number-theory": "Number Theory",
  "20-computational-geometry": "Computational Geometry",
  "21-advanced-structures": "Advanced Data Structures",
  "22-randomized-algorithms": "Randomized Algorithms",
  "23-parallel-algorithms": "Parallel Algorithms",
  "24-external-memory-and-cache-aware": "External Memory & Cache-Aware Algorithms",
  "25-online-algorithms": "Online Algorithms",
  "26-distributed-data-structures": "Distributed Data Structures",
};

// Consolidated volumes: 6 reflowable EPUBs grouping related sections (nav nests
// volume -> section -> chapter). Built with --volumes.
const VOLUMES = [
  { no: 1, title: "Foundations & Complexity", sections: ["01-introduction-to-dsa", "02-programming-fundamentals", "03-what-are-data-structures", "04-why-are-data-structures-important", "05-basic-data-structures", "06-algorithmic-complexity"] },
  { no: 2, title: "Sorting & Searching", sections: ["07-sorting-algorithms", "08-search-algorithms"] },
  { no: 3, title: "Trees, Heaps, Graphs & Disjoint Sets", sections: ["09-trees", "10-heaps", "11-graphs", "12-disjoint-set"] },
  { no: 4, title: "Algorithm Design Paradigms", sections: ["13-dynamic-programming", "14-greedy-algorithms", "15-divide-and-conquer", "16-backtracking"] },
  { no: 5, title: "Strings, Bits, Numbers & Geometry", sections: ["17-string-algorithms", "18-bit-manipulation", "19-number-theory", "20-computational-geometry"] },
  { no: 6, title: "Advanced, Parallel & Distributed", sections: ["21-advanced-structures", "22-randomized-algorithms", "23-parallel-algorithms", "24-external-memory-and-cache-aware", "25-online-algorithms", "26-distributed-data-structures"] },
];

// ---------------------------------------------------------------------------
// Topic tree (own copy so the DSA tier set incl. tasks.md is used, leaving the
// shared build.mjs / Go pipeline untouched).
// ---------------------------------------------------------------------------
function numericSort(a, b) {
  const na = parseInt(a.match(/^(\d+)/)?.[1] ?? "", 10);
  const nb = parseInt(b.match(/^(\d+)/)?.[1] ?? "", 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

function buildTree(dir, idPrefix, depth, rootDir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort(numericSort);
  const hasTierFiles = entries.some((e) => e.isFile() && TIER_FILES.has(e.name));

  const node = {
    dir,
    rel: path.relative(rootDir, dir),
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
// (Below mirrors build-epub.mjs — generic EPUB assembly.)
// ---------------------------------------------------------------------------
const unescapeHtml = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

const MERMAID_RE = /<pre class="mermaid">([\s\S]*?)<\/pre>/g;

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

function relTitle(rel) {
  return rel.split("/").map((seg) => titleCase(seg)).join(" · ");
}

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
      out.push(`<pre class="code">${codes[i]}</pre>`);
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
    <dc:identifier id="bookid">dsa-roadmap-${id}</dc:identifier>
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
  <head><meta name="dtb:uid" content="dsa-roadmap-${id}"/></head>
  <docTitle><text>${escapeHtml(title)}</text></docTitle>
  <navMap>
    ${points}
  </navMap>
</ncx>`;
}

const EPUB_DIR = path.join(__dirname, "epub");
let bionicEnabled = true;
const CHUNK_LIMIT = 440_000;

async function newMermaidPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><html><body style="background:#fff"></body></html>`);
  await page.addScriptTag({ path: path.join(__dirname, "node_modules/mermaid/dist/mermaid.min.js") });
  await page.evaluate(() =>
    mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose", htmlLabels: false, flowchart: { htmlLabels: false }, class: { htmlLabels: false } })
  );
  return page;
}

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

  if (topicFilter) leaves = leaves.filter((n) => topicFilter(n.rel.split("/")[0]));

  const docs = [];
  const navChapters = [];
  let li = 0;
  for (const leaf of leaves) {
    li++;
    const dispTitle = relTitle(leaf.rel);

    const blocks = [];
    for (const f of leaf.files) {
      const raw = cleanMarkdown(fs.readFileSync(f.path, "utf8"));
      if (!raw) continue;
      const rendered = bionicEnabled ? bionicHtml(md.render(raw)) : md.render(raw);
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

function navXhtmlVolume(title, groups) {
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
  let order = 0;
  const points = groups
    .flatMap((g) => g.chapters)
    .map((c) => `<navPoint id="${c.id}" playOrder="${++order}"><navLabel><text>${escapeHtml(c.title)}</text></navLabel><content src="${c.file}"/></navPoint>`)
    .join("\n    ");
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="dsa-roadmap-${id}"/></head>
  <docTitle><text>${escapeHtml(title)}</text></docTitle>
  <navMap>
    ${points}
  </navMap>
</ncx>`;
}

async function buildVolume(vol, browser, hljsCss, force) {
  const id = `vol${vol.no}-${slug(vol.title)}`;
  const epubPath = path.join(EPUB_DIR, `DSA-Volume-${vol.no}-${slug(vol.title)}.epub`);
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
    if (!fs.existsSync(path.join(ROADMAP_ROOT, section))) continue;
    const { title: secTitle, navChapters, docs } = await renderSectionChapters(section, md, page, oebps, imgDir, svgManifest, vol.topicFilter);
    groups.push({ title: secTitle, chapters: navChapters });
    allDocs.push(...docs);
  }
  await page.close();

  packageEpub(stage, oebps, epubPath, hljsCss, {
    title: vol.title,
    id,
    chapters: allDocs,
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
  const epubPath = path.join(EPUB_DIR, `DSA-Book-${bookNo}-${id}.epub`);
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
  if (argv.includes("--no-bionic")) bionicEnabled = false;
  fs.mkdirSync(EPUB_DIR, { recursive: true });

  const hljsCss = fs.readFileSync(path.join(__dirname, "node_modules/highlight.js/styles/github.css"), "utf8");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });

  if (volumes) {
    for (const vol of VOLUMES) {
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
  console.log("\nDSA EPUB build done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
