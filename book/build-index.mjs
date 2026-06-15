// Render a master library index (catalog) PDF from out/INDEX.md — every book,
// its parts, page counts and the topics each part covers. Run after build-all.
//
// Usage: node build-index.mjs [--profile kindle|a4]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import puppeteer from "puppeteer";
import { OUT_DIR } from "./build.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILES = {
  kindle: { w: 160, h: 213, margin: 12 },
  a4: { w: 210, h: 297, margin: 18 },
};

async function main() {
  const argv = process.argv.slice(2);
  const profKey = argv.includes("--profile") ? argv[argv.indexOf("--profile") + 1] : "kindle";
  const p = PROFILES[profKey] || PROFILES.kindle;

  const indexPath = path.join(OUT_DIR, "INDEX.md");
  if (!fs.existsSync(indexPath)) {
    console.error("out/INDEX.md not found — run build-all.mjs first.");
    process.exit(1);
  }
  const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
  const body = md.render(fs.readFileSync(indexPath, "utf8"));

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${p.w}mm ${p.h}mm; margin: ${p.margin}mm; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Georgia, serif; font-size: 10.5pt; line-height: 1.5; margin: 0; }
.cover { height: ${p.h - p.margin * 2 - 4}mm; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; break-after:page; }
.cover .kicker { font-family:"SF Mono",Menlo,monospace; letter-spacing:3px; text-transform:uppercase; color:#0a5b6b; font-size:12pt; }
.cover h1 { font-family:"Helvetica Neue",Arial,sans-serif; font-size:30pt; margin:.3em 0; }
.cover .rule { width:80px; height:4px; background:#1a1a1a; margin:18px auto; }
.cover .author { margin-top:36px; color:#555; }
h1,h2,h3 { font-family:"Helvetica Neue",Arial,sans-serif; }
h2 { border-bottom:2px solid #1a1a1a; padding-bottom:3px; margin-top:1.3em; font-size:15pt; }
code { font-family:"SF Mono",Menlo,monospace; font-size:8.5pt; background:#f4f4f4; padding:0 3px; border-radius:3px; }
ul { margin:.3em 0; } li { margin:.15em 0; }
a { color:#0a5b6b; text-decoration:none; }
</style></head><body>
<div class="cover"><div class="kicker">The Go Roadmap</div><div class="rule"></div>
<h1>Library Index</h1><div class="author">Bakhodir Yashin Mansur</div></div>
${body}
</body></html>`;

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  const outPath = path.join(OUT_DIR, "Book-00-Library-Index.pdf");
  await page.pdf({
    path: outPath,
    width: `${p.w}mm`,
    height: `${p.h}mm`,
    printBackground: true,
    margin: { top: `${p.margin}mm`, bottom: `${p.margin}mm`, left: `${p.margin}mm`, right: `${p.margin}mm` },
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate: `<div style="width:100%;font-size:7px;color:#888;font-family:Helvetica,Arial;padding:0 ${p.margin}mm;text-align:right;"><span class="pageNumber"></span></div>`,
  });
  await browser.close();
  console.log(`✓ ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
