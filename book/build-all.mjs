// Build every Go-roadmap section into Kindle-Scribe PDF books.
//
// One section -> one book, but a section larger than the page budget is split
// into Parts at top-level topic boundaries (a topic is never split). Renders run
// sequentially (reliable; heavy parallel waves trip socket errors), each in its
// own `build.mjs` child process so memory is released between books. The run is
// resumable: a part whose PDF already exists is skipped.
//
// Usage: node build-all.mjs [--profile kindle|a4] [--target-words N] [--only NN]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROADMAP_ROOT = path.resolve(__dirname, "../Roadmap/Programming-Languages/languages/golang");
const OUT_DIR = path.join(__dirname, "out");

// ~174 words/page (Kindle profile, measured on Book 01). A part targets ~600
// pages so each PDF stays snappy on a Kindle Scribe.
const DEFAULT_TARGET_WORDS = 104000;

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

const TIER_FILES = new Set(["junior.md", "middle.md", "senior.md", "professional.md", "interview.md"]);

function parseArgs(argv) {
  const a = { profile: "kindle", targetWords: DEFAULT_TARGET_WORDS, only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--profile") a.profile = argv[++i];
    else if (argv[i] === "--target-words") a.targetWords = parseInt(argv[++i], 10);
    else if (argv[i] === "--only") a.only = argv[++i];
    else if (argv[i] === "--plan") a.plan = true;
    else if (argv[i] === "--force") a.force = true;
    else if (argv[i] === "--no-bionic") a.noBionic = true;
  }
  return a;
}

function numericSort(a, b) {
  const na = parseInt(a, 10), nb = parseInt(b, 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

function slug(s) {
  return String(s).toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
}

// Word count of all tier files under a directory (estimate; front matter etc.
// is a small constant overhead and does not affect packing materially).
function countWords(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += countWords(p);
    else if (TIER_FILES.has(e.name)) n += (fs.readFileSync(p, "utf8").match(/\S+/g) || []).length;
  }
  return n;
}

// Build the ordered list of render units for a directory. A unit is normally a
// top-level topic; but a topic bigger than the budget is split into its own
// children (recursively), so no single part is gigantic. Each unit is a
// {rel, words} where rel is the section-root-relative dir path.
// Only break a topic apart when it is genuinely oversized (~1.4x the pack
// target, ≈ 835 pp). Moderately large topics stay whole as a single part — this
// fixes the rare 1000+ page part without fragmenting the library.
const SPLIT_FACTOR = 1.4;
function unitsFor(dir, rel, sectionDir, targetWords) {
  const words = countWords(dir);
  const subdirs = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(numericSort);
  if (words <= targetWords * SPLIT_FACTOR || subdirs.length === 0) return [{ rel, words }];
  let out = [];
  for (const name of subdirs) {
    out = out.concat(unitsFor(path.join(dir, name), rel ? `${rel}/${name}` : name, sectionDir, targetWords));
  }
  return out;
}

// Greedily pack units into parts of <= targetWords.
function planParts(sectionDir, targetWords) {
  const topLevel = fs
    .readdirSync(sectionDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(numericSort);

  let units = [];
  for (const name of topLevel) units = units.concat(unitsFor(path.join(sectionDir, name), name, sectionDir, targetWords));
  const total = units.reduce((s, u) => s + u.words, 0);

  const parts = [];
  let cur = [];
  let curWords = 0;
  for (const u of units) {
    if (cur.length && curWords + u.words > targetWords) {
      parts.push(cur);
      cur = [];
      curWords = 0;
    }
    cur.push(u);
    curWords += u.words;
  }
  if (cur.length) parts.push(cur);
  return { parts, total };
}

function pageCount(pdfPath) {
  try {
    const d = fs.readFileSync(pdfPath);
    const m = d.toString("latin1").match(/\/Type\s*\/Page[^s]/g);
    return m ? m.length : 0;
  } catch {
    return 0;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const sections = Object.keys(TITLES)
    .filter((s) => fs.existsSync(path.join(ROADMAP_ROOT, s)))
    .filter((s) => !args.only || s.startsWith(args.only));

  if (args.plan) {
    let totalParts = 0, totalWords = 0;
    const wpp = 174;
    for (const section of sections) {
      const { parts, total } = planParts(path.join(ROADMAP_ROOT, section), args.targetWords);
      totalParts += parts.length;
      totalWords += total;
      console.log(`Book ${section.match(/^(\d+)/)[1]} ${TITLES[section].padEnd(40)} ${total.toLocaleString().padStart(12)} w  ~${Math.round(total / wpp).toLocaleString().padStart(7)} pp  -> ${parts.length} part(s)`);
    }
    console.log(`\nTOTAL: ${totalParts} PDFs, ${totalWords.toLocaleString()} words, ~${Math.round(totalWords / wpp).toLocaleString()} pages`);
    return;
  }

  const manifest = [];
  for (const section of sections) {
    const sectionDir = path.join(ROADMAP_ROOT, section);
    const bookNo = section.match(/^(\d+)/)[1];
    const title = TITLES[section];
    const { parts, total } = planParts(sectionDir, args.targetWords);
    console.log(`\n=== Book ${bookNo}: ${title} — ${total.toLocaleString()} words -> ${parts.length} part(s) ===`);

    parts.forEach((part, i) => {
      const partNo = i + 1;
      const multi = parts.length > 1;
      const partLabel = multi ? `${partNo}/${parts.length}` : null;
      const outName = multi
        ? `Book-${bookNo}-${slug(title)}-Part-${String(partNo).padStart(2, "0")}.pdf`
        : `Book-${bookNo}-${slug(title)}.pdf`;
      const outPath = path.join(OUT_DIR, outName);

      const topics = part.map((u) => u.rel);

      if (!args.force && fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
        console.log(`  skip (exists): ${outName} [${pageCount(outPath)} pp]`);
        manifest.push({ bookNo, title, part: partLabel, outName, pages: pageCount(outPath), topics });
        return;
      }

      const cliArgs = [
        "build.mjs", section,
        "--book", bookNo,
        "--title", title,
        "--profile", args.profile,
        "--include", topics.join(","),
        "--out", outName,
      ];
      if (partLabel) cliArgs.push("--part", partLabel);
      if (!args.noBionic) cliArgs.push("--bionic");

      try {
        execFileSync("node", cliArgs, { cwd: __dirname, stdio: "inherit" });
        manifest.push({ bookNo, title, part: partLabel, outName, pages: pageCount(outPath), topics });
      } catch (e) {
        console.error(`  FAILED: ${outName} — ${e.message}`);
        manifest.push({ bookNo, title, part: partLabel, outName, pages: 0, failed: true, topics });
      }
    });
  }

  // Write INDEX.md
  let idx = "# The Go Roadmap — PDF Library\n\n";
  let curBook = null;
  for (const e of manifest) {
    if (e.bookNo !== curBook) {
      idx += `\n## Book ${e.bookNo}: ${e.title}\n\n`;
      curBook = e.bookNo;
    }
    const status = e.failed ? " ⚠️ FAILED" : ` — ${e.pages} pp`;
    idx += `- ${e.part ? `Part ${e.part}` : "Full"}: \`${e.outName}\`${status}\n`;
    idx += `  - topics: ${e.topics.join(", ")}\n`;
  }
  const totalPages = manifest.reduce((s, e) => s + (e.pages || 0), 0);
  const failed = manifest.filter((e) => e.failed).length;
  idx += `\n---\n\nTotal: ${manifest.length} PDF(s), ${totalPages.toLocaleString()} pages` + (failed ? `, ${failed} FAILED` : "") + ".\n";
  fs.writeFileSync(path.join(OUT_DIR, "INDEX.md"), idx);

  console.log(`\nDone. ${manifest.length} PDF(s), ${totalPages.toLocaleString()} pages${failed ? `, ${failed} FAILED` : ""}.`);
  console.log(`Index: ${path.join(OUT_DIR, "INDEX.md")}`);
}

main();
