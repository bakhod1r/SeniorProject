# 8.15 `text/template` and `html/template`

Two packages, one syntax, two very different safety stories. `text/template`
generates free-form text — config files, code, emails, SQL fragments for
non-query use. `html/template` wraps the same engine with **contextual
auto-escaping**: it tracks whether your action lands inside HTML body,
an attribute, a `<script>`, a `<style>`, or a URL, and escapes the value
correctly for that context. That is the entire reason `html/template`
exists. **Use `text/template` for HTML output and you have an XSS bug.**

Reading order:

1. [junior.md](junior.md) — syntax, actions, pipelines, the four parse
   functions, why `html/template` is the default for the web.
2. [middle.md](middle.md) — `define`/`block`/`template`, FuncMaps,
   layout patterns, `embed.FS` via `ParseFS`, `Option("missingkey=error")`.
3. [senior.md](senior.md) — the contextual-escaper internals, trusted
   types (`HTML`, `JS`, `URL`, ...), template sets, `Lookup` mechanics.
4. [professional.md](professional.md) — production patterns: hot-reload,
   precompilation, streaming, content-type discipline.
5. [specification.md](specification.md) — the action grammar, function
   reference, escaping context table.
6. [interview.md](interview.md) — the questions that decide whether you
   actually understand the two-package split.
7. [tasks.md](tasks.md) — exercises.
8. [find-bug.md](find-bug.md) — broken templates and what's wrong.
9. [optimize.md](optimize.md) — parsing once, executing fast, allocation
   discipline.

Cross-links: [`../09-go-embed/`](../09-go-embed/),
[`../14-io-fs/`](../14-io-fs/),
[`../11-net-http-internals/`](../11-net-http-internals/),
[`../01-io-and-file-handling/`](../01-io-and-file-handling/).
