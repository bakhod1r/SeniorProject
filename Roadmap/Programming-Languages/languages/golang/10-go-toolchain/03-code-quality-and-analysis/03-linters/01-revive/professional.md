# revive — Professional

## 1. Under the hood: AST + types

`revive` is built directly on the Go standard library packages `go/ast`, `go/token`, `go/parser`, and `go/types`, **without** going through `golang.org/x/tools/go/analysis`. The engine:

1. Calls `go list` (via the `golang.org/x/tools/go/packages` driver) to load packages and their dependencies in module-aware mode.
2. For each loaded package, builds an `ast.Package` and runs the configured rules over its files.
3. Each rule either walks the AST itself (`ast.Inspect`) or, for rules needing semantic information, asks for the type-checked package (`*types.Package`) and inspects identifiers, methods, and call sites.
4. Findings are collected, filtered by `confidence`, and handed to the chosen formatter.

There is **no Analyzer dependency graph**, no Facts mechanism, no shared `*types.Info` cache between unrelated rules. Compared to `staticcheck` or `golangci-lint`'s analyzer driver, this is simpler but does redundant type-checking work when many rules want it. For style rules (which dominate `revive`'s catalogue) this is fine; for heavy semantic analysis it is not, which is why the tool stays in its style/conventions niche.

---

## 2. The rule registry

Rules are not discovered dynamically. The engine holds a literal slice of `lint.Rule` values, compiled into the binary:

```go
// Roughly what config/config.go does
var allRules = []lint.Rule{
    &rule.VarNamingRule{},
    &rule.ExportedRule{},
    &rule.PackageCommentsRule{},
    // ...about 80 rules as of v1.5.x
}
```

The TOML config selects from this slice by `Name()`. That has two consequences:

- **Adding a rule requires recompiling `revive`.** There is no `.so` plugin loading at run time. Custom rules ship as a fork or a separate binary that vendors `revive`'s library.
- **Rule names are global.** Two rules cannot share a name; the registry is a flat namespace. When forking, prefix in-house rules (`acme-no-panic`, not `no-panic`) to avoid future collisions with upstream additions.

---

## 3. Parallel execution model

The engine processes files in parallel via a worker pool sized by `GOMAXPROCS`. For each file:

```
spawn worker:
  parse file → *ast.File
  for each enabled rule:
      failures = rule.Apply(file, args)
      send failures on result channel
```

Rules are run **sequentially per file** but files run in parallel. This keeps memory bounded (one AST in flight per worker) and avoids contention on shared state, but it also means a single very large file does not get parallelized internally — the worker handling it processes all rules for it serially.

Practical implication: a 5,000-line generated `.pb.go` file will hold one worker for noticeably longer than your hand-written 200-line files. Exclude generated code from the lint set when wall time matters.

---

## 4. Loading modules: `go/packages` and its costs

`revive ./...` triggers the `packages.Load` flow with `LoadAllSyntax`. That:

- Runs `go list` to enumerate packages and their transitive dependencies.
- Parses every Go file in matched packages.
- Optionally type-checks (when at least one enabled rule needs `*types.Info`).

On a small service this takes milliseconds; on a large monorepo it can be the bulk of wall time. Two professional knobs:

1. **Narrow the package set.** `revive ./cmd/... ./internal/...` instead of `./...` avoids loading vendored or third-party trees.
2. **Use `-exclude`** for paths the policy does not care about: `-exclude vendor/...,./internal/legacy/...`. Excluded paths are still *loaded* (because `go list` is package-level), but their files are not handed to rules.

```bash
revive -config revive.toml -exclude vendor/... ./...
```

For really large repos, drive `revive` from a script that selects only changed packages:

```bash
CHANGED=$(git diff --name-only origin/main...HEAD | grep '\.go$' \
  | xargs -n1 dirname | sort -u | sed 's|^|./|;s|$|/...|')
revive -config revive.toml $CHANGED
```

---

## 5. Where defaults come from

When you pass no `-config`, `revive` falls back to a config compiled into the binary, defined roughly in `config/config.go`:

- A baseline `severity = "warning"`.
- A `confidence = 0.8`.
- The "golint equivalent" rule set listed in `junior.md`.

There is no system-wide `/etc/revive.toml`. There is no `XDG_CONFIG_HOME/revive/revive.toml`. The tool is intentionally configuration-stateless across users; the only config it considers is whatever `-config` points at (or the built-in defaults). This makes builds reproducible: two engineers running the same `revive -config revive.toml ./...` get the same output regardless of their dotfiles.

---

## 6. Comparison with `golangci-lint`'s analyzer driver

`golangci-lint` is a meta-linter that hosts many sub-linters (including `revive` itself) and orchestrates them through the `go/analysis` framework. Key differences:

| Concern | `revive` standalone | `golangci-lint` (with `revive` enabled) |
|---------|---------------------|----------------------------------------|
| Driver | Custom, per-file worker pool | `go/analysis`, sharing `*types.Info` across analyzers |
| Configuration | `revive.toml` | `.golangci.yml` (which embeds `revive` config) |
| Output | revive's formatters | golangci-lint's unified format |
| Speed in big monorepos | Slower (re-loads packages) | Faster (one load shared) |
| Custom rules | Easy (fork / library) | Possible but more ceremony |
| When to pick standalone | You want only `revive`; small scope | — |
| When to pick golangci-lint | You want `revive` + `staticcheck` + `errcheck` + ... in one pass | — |

Many teams run `revive` standalone in development (fast feedback on one tool) and `golangci-lint` in CI (one report, all linters). The `revive.toml` is reused: `golangci-lint` reads it via its `linters-settings.revive` block.

---

## 7. Vendoring custom rules

To ship in-house rules without forking upstream:

```
project/
  cmd/team-lint/        # your CLI
    main.go             # imports github.com/mgechev/revive + local rules
  lint/rules/
    todo_comment.go     # implements lint.Rule
    no_panic.go
```

`cmd/team-lint/main.go` constructs a `lint.Linter`, appends your rules to the catalog, parses the TOML config, and runs the pipeline. The upstream library exposes enough surface (`lint.Linter`, `lint.Config`, `lint.Rule`, formatters) to do this in ~50 lines.

In CI:

```bash
go install ./cmd/team-lint
team-lint -config revive.toml ./...
```

Pros: no fork to maintain, version bumps of upstream are clean (`go get -u github.com/mgechev/revive`).
Cons: one more binary to install on developer machines; CI must build it (cache `GOCACHE`).

A common middle ground: keep `team-lint` as a tiny wrapper, but vendor the upstream binary's CLI flags exactly, so users do not need to learn a new interface.

---

## 8. Output stability for tooling

The default text formatter is **not** a stable interface. Patch releases of `revive` have tweaked exact wording. Anything machine-consuming (CI parsers, IDE plugins, dashboards) should use `-formatter ndjson`, `-formatter json`, `-formatter checkstyle`, or `-formatter sarif`. Those are versioned and stable enough to script against.

A common bug: a CI script greps the default formatter for "error" or "warning" to count issues. A wording change in an upstream release silently breaks counting. `ndjson` plus `wc -l` (or `jq`) is the robust pattern.

```bash
revive -config revive.toml -formatter ndjson ./... \
  | jq -r 'select(.Severity == "error") | "\(.Position.Start.Filename):\(.Position.Start.Line) \(.Failure)"'
```

---

## 9. Summary

Internally, `revive` is a small `go/ast`-based engine: a static rule registry, a per-file worker pool, package loading via `go/packages`. It does not use `go/analysis`, which keeps custom rules easy to write but forfeits shared type-info caching. There is no system config; everything comes from `-config` or the built-in defaults. Ship in-house rules through a thin CLI that vendors `revive` as a library, and always consume machine output through `ndjson`/`json`/`checkstyle`/`sarif` rather than parsing the default text format.

---

## Further reading
- `revive` source: https://github.com/mgechev/revive
- `golang.org/x/tools/go/packages`: https://pkg.go.dev/golang.org/x/tools/go/packages
- `golangci-lint` analyzer driver: https://golangci-lint.run/usage/linters/#revive
