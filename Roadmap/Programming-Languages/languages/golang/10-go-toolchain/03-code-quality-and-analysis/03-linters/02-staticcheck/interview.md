# staticcheck — Interview Q&A

A mix of conceptual and practical questions, labeled by level. Answers are concise; expand with examples in a real interview.

---

## Junior

**Q1. What is staticcheck and how does it differ from `go vet`?**
Staticcheck is a deep third-party static analyzer for Go. `go vet` ships with the toolchain and is intentionally conservative (no false positives); staticcheck adds hundreds of checks that catch real bugs vet skips. Run both — they overlap a little, each finds things the other misses.

**Q2. How do you install and run it?**
`go install honnef.co/go/tools/cmd/staticcheck@latest` (pin in CI), then `staticcheck ./...` to analyze the whole module.

**Q3. What does a check ID like `SA1006` mean?**
Two-letter prefix + number. `SA` = correctness bug, `S` = simplification, `ST` = style, `U` = unused code, `QF` = quickfix (IDE). The number is stable across releases — you can rely on `SA1006` always meaning the same rule.

**Q4. You see `(SA1006)` after a finding. How do you learn what it means?**
`staticcheck -explain SA1006` prints the rationale in the terminal. Or read the docs at `staticcheck.dev/docs/checks/#SA1006`.

---

## Middle

**Q5. How do you suppress one staticcheck finding without disabling the check globally?**
Add `//lint:ignore SA1234 reason for ignoring` on the line above the flagged statement. For a whole file: `//lint:file-ignore SA1234 reason` at the top. The reason after the ID is conventionally mandatory.

**Q6. How do you make CI fail when staticcheck reports any finding?**
Pass `-set_exit_status`: `staticcheck -set_exit_status ./...`. Without it, staticcheck exits 0 even when it prints findings.

**Q7. How do you select only a subset of checks?**
`-checks=SA*` runs only the SA family. `-checks=all,-ST1000` runs everything except one ID. Or commit a `staticcheck.conf` with `checks = ["all", "-ST1000"]` so contributors get the same set automatically.

**Q8. What does `staticcheck.conf` do and where does it go?**
A TOML file at the module root (or a subtree) that sets defaults like `checks`, `initialisms`, `dot_import_whitelist`, `http_status_code_whitelist`. Nested configs override parent ones, useful for relaxing rules in legacy subtrees.

**Q9. Name three high-signal checks you would always keep enabled.**
`SA1019` (deprecated API use), `SA4006` (assigned value never used), `SA1029` (inappropriate `context.WithValue` key type). All catch real bugs in real code regularly.

---

## Senior

**Q10. How would you roll out staticcheck on a 200k-LOC legacy codebase?**
Stage by family: `SA*` first (real bugs), then `U1000` (delete dead code), then `S*` (simplifications), `ST*` last (style debates). Use a baseline (diff against `main`, or `reviewdog`) to block only **new** findings during the rollout, not the existing backlog.

**Q11. Why pin the staticcheck version in CI instead of using `@latest`?**
Staticcheck releases routinely add checks, fix false positives, and refine analyses — the same code can produce different findings across versions. Pinning `@v0.5.1` makes results reproducible across engineers and CI, and treats upgrades as deliberate PRs.

**Q12. Run staticcheck standalone or via `golangci-lint`?**
Standalone gives you the full, latest check set and `-explain`. `golangci-lint` is convenient if you already aggregate many linters and want one cache and one config; it sometimes lags staticcheck releases. Many teams run both: `golangci-lint` for the bulk of linters, staticcheck standalone for the freshest version of its checks.

**Q13. What is the architectural difference between SA checks and the `unused` (U) checks?**
SA checks operate per-package using SSA and AST patterns plus `go/analysis` facts. `unused` is whole-program: it builds a reachability graph from roots (main, init, exported symbols, tests) and reports anything unreachable. That is why `unused` cannot judge exported symbols in libraries — it cannot see external callers.

**Q14. How does `SA1019` know that a symbol in another package is deprecated?**
Through `go/analysis` facts. A small analyzer scans every package's AST for `// Deprecated:` doc comments and emits an `IsDeprecated` fact on the symbol. When `SA1019` runs on a calling package, it queries the framework for that fact via `ImportObjectFact`. Facts are cached on disk so cross-package signal is fast on warm runs.

---

## Professional

**Q15. How do you enforce house-specific rules alongside staticcheck without forking it?**
Write your own `*analysis.Analyzer`s using `golang.org/x/tools/go/analysis`, build a single binary that registers them together with the staticcheck analyzers via `unitchecker`, and invoke through `go vet -vettool=...` or as a `golangci-lint` plugin. No fork needed — staticcheck's analyzers are reusable building blocks.

---

## Common traps

- Running `staticcheck main.go` instead of `staticcheck ./...` — single-file analysis misses cross-package signal.
- Forgetting `-set_exit_status` and wondering why CI is green despite findings.
- Using `@latest` in CI — non-reproducible across days.
- Bare `//lint:ignore SA1234` with no reason — reviewers should reject these.
- Expecting `unused` to flag exported library symbols — it cannot see outside callers.
- Setting `-go 1.18` when `go.mod` says `go 1.22` — staticcheck targets the wrong version and reports stale or missing checks.
- Assuming staticcheck supersedes `go vet` — they are complementary, run both.
- Mixing `golangci-lint`'s staticcheck version and a standalone install — two sources of truth, drift inevitable.
