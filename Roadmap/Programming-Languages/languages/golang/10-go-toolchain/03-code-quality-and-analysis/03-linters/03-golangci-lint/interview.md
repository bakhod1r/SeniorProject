# golangci-lint — Interview Q&A

A mix of conceptual and practical questions, labeled by level. Answers are concise; expand with examples in a real interview.

---

## Junior

**Q1. What is golangci-lint?**
A driver binary that runs many Go linters (govet, staticcheck, errcheck, ineffassign, unused, gosimple, and many more) in a single parallel pass, configured by `.golangci.yml`. One command, one config, one shared analysis.

**Q2. Why does the project tell you not to install with `go install`?**
`go install` builds from source with whatever Go toolchain you happen to have. The resulting binary can produce different findings than the official release. Use the install script or a package manager and pin a version.

**Q3. What is the default linter set?**
With no config: `govet`, `staticcheck`, `errcheck`, `ineffassign`, `unused`, `gosimple`. A conservative set chosen to minimize false positives on idiomatic Go.

**Q4. How do you run only one linter quickly?**
`golangci-lint run --enable-only=staticcheck ./...`. Overrides the config and runs just that linter — useful in pre-commit hooks or when bisecting which linter is flagging.

---

## Middle

**Q5. What goes in `.golangci.yml` and why split it into sections?**
Five top-level blocks: `run` (timeout, concurrency), `linters` (which fire), `linters-settings` (their internals), `issues` (filters, excludes), `output` (formats). The split keeps execution, selection, configuration, filtering, and presentation independent.

**Q6. How do you turn on a stricter linter without breaking CI on a legacy repo?**
Run with `--new-from-rev=origin/main`. Only issues introduced by your PR's commits fail the build; pre-existing findings are ignored. Pair with a non-blocking job that lints the whole repo to track debt.

**Q7. Why is running `golangci-lint run` faster than running each linter separately?**
Each standalone tool re-parses and re-type-checks your packages. `golangci-lint` does one `go/packages` load and feeds the resulting AST/types/SSA to every enabled `analysis.Analyzer` in dependency order. On a large repo that is multiples faster.

**Q8. What does `--fix` do, and which linters does it work for?**
For linters that produce `SuggestedFix` records (e.g., `gofmt`, `goimports`, `gofumpt`, `misspell`, parts of `gocritic`, `whitespace`), it rewrites the files in place. Linters with no suggested fix are unaffected. Conflicting fixes on the same range are skipped.

---

## Senior

**Q9. Why must CI pin a specific golangci-lint version?**
Each release usually adds analyzers, bumps bundled linter versions, or changes defaults — any of which creates new findings on previously-passing code. Pinning (`v1.59.1`, not `latest`) keeps lint results deterministic; bump versions in a deliberate PR.

**Q10. Where is the linter cache and what is it keyed on?**
`$GOLANGCI_LINT_CACHE`, default `~/.cache/golangci-lint`. Keys combine the golangci-lint version, Go toolchain version, enabled linter set with settings, build tags, and source hashes (including transitive deps). Persist this directory in CI; a cold cache on a big repo can cost minutes.

**Q11. How do you exclude test files or generated code from selected linters?**
Use `issues.exclude-rules` with `path:` regex and `linters:` list, e.g., exclude `errcheck` and `gosec` in `_test\.go`. Generated files are auto-detected (`// Code generated ... DO NOT EDIT.` header); for non-conforming generators add explicit `exclude-dirs` or `path` rules.

**Q12. What changed between v1 and v2 config schemas?**
Top-level reorg: `linters.enable/disable` simplified with a `default` mode; `linters-settings` moved under `linters.settings`; `issues.exclude-rules` moved under `linters.exclusions.rules`; `output.formats` is now a map. Use `golangci-lint migrate` to rewrite the file, then re-baseline.

---

## Professional

**Q13. How does golangci-lint integrate non-`go/analysis` linters?**
It wraps them in adapters in `pkg/golinters/`. The adapter calls the upstream tool's API and converts its findings into the internal `result.Issue` stream. They go through the same nolint/exclude/severity processors and respect the cache, but they do not share the type-check pass — only true `go/analysis` analyzers do.

**Q14. How do you ship a custom linter for use across all developer machines and CI?**
Two paths. The v1 way is a `-buildmode=plugin` `.so` referenced from `linters-settings.custom` — fragile across Go versions and platforms. The v2 way is the **plugin module**: declare your analyzers in a Go module, run `golangci-lint custom`, and ship the resulting custom golangci-lint binary that bakes the analyzer in statically. Cross-platform, no ABI risk.

**Q15. Lint runs OOM in CI on a large monorepo. What do you do?**
First, `-v --print-resources-usage` to identify the heavy linter — typically `unused` or `gosec`. Then: increase the CI container memory, lower `run.concurrency` so fewer packages are analyzed in parallel, split the run by sub-tree across parallel jobs (`./internal/...` vs `./cmd/...`), or temporarily disable the whole-program analyzer (`unused`) and rely on cheaper alternatives (`deadcode`, `unparam`).

---

## Common traps

- Installing with `go install` instead of the released binary, then chasing finding drift.
- Not pinning the version in CI and being surprised when a new release fails builds.
- Running with `disable-all: false` (the default) — a future release silently enables more linters.
- Forgetting `fetch-depth: 0` in GitHub Actions so `--new-from-rev` has no base to diff against.
- Not persisting `~/.cache/golangci-lint` in CI — 30s lints become 5-minute lints.
- Using `//nolint` without naming the linter (`//nolint:gosec`) — disables everything on the line.
- Bulk-enabling many new linters at once and creating an unmanageable backlog.
- Forgetting that `concurrency` defaults to NumCPU and oversubscribes in CPU-throttled containers.
- Enabling both `gofmt` and `gofumpt` — they fight over the same fixes; pick one.
