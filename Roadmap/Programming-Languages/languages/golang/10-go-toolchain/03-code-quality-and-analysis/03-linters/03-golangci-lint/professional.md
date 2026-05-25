# golangci-lint — Professional

## 1. Project structure

`golangci-lint` is itself a Go module. The interesting pieces:

```
golangci-lint/
├── cmd/golangci-lint/        # CLI entry
├── pkg/golinters/            # one wrapper subpackage per third-party linter
├── pkg/lint/                 # core: runner, loader, cache, output
├── pkg/result/processors/    # filters: nolint, exclude, severity, autogen
├── pkg/config/               # .golangci.yml schema + validation
└── pkg/commands/             # subcommands: run, linters, cache, config
```

Each wrapper in `pkg/golinters/<name>` imports the upstream linter as a normal Go dependency and exposes one or more `*analysis.Analyzer` (or adapts a non-analysis linter into one). That is why the binary statically embeds *every* supported linter — there is no dynamic plugin loading in the default build.

---

## 2. Loading packages once

The loader uses `golang.org/x/tools/go/packages` with `LoadAllSyntax` mode, which yields:

- Parsed AST (`*ast.File`) for each file.
- Full `*types.Info` and `*types.Package`.
- Module/build context resolved.

This load happens **once** per `golangci-lint run` invocation. Every enabled analyzer then receives an `*analysis.Pass` referring to the same `*types.Package` and `[]*ast.File`. Linters that need SSA form (`gosec`, parts of `staticcheck`) request the `buildssa.Analyzer` as a dependency; SSA is also built once and shared.

The package graph is walked in dependency order so that, e.g., `unused` (which needs to know whole-program usage) gets results from upstream analyzers it depends on.

---

## 3. The cache

```
~/.cache/golangci-lint/                       # $GOLANGCI_LINT_CACHE
├── v1.59.1/
│   ├── kvstore.gob                            # mapping cache
│   └── per-package/
│       └── <hash>/                            # analysis results
```

A cache entry key combines:

- `golangci-lint` version.
- Go toolchain version.
- Set of enabled linters and their merged settings.
- Hash of every input source file in the package and its dependencies.
- Build tags.

On a hit, the per-package analyzer results are read straight from disk and merged. On a miss, the loader runs and the new result is persisted. Subcommands:

```bash
golangci-lint cache status     # path + size
golangci-lint cache clean      # blow it away
```

In CI, persisting `~/.cache/golangci-lint` plus `~/.cache/go-build` and `~/go/pkg/mod` cuts a typical lint job from minutes to seconds.

---

## 4. The `go/analysis` adapter

The framework `analysis.Analyzer` has roughly this shape:

```go
type Analyzer struct {
    Name     string
    Doc      string
    Requires []*Analyzer
    Run      func(*Pass) (interface{}, error)
    ResultType reflect.Type
    Flags    flag.FlagSet
}
```

`golangci-lint` instantiates each enabled analyzer, registers it with an internal runner, and supplies a `*Pass` per package. The runner takes care of:

- Topologically sorting analyzers.
- Memoizing `Result` per `(analyzer, package)`.
- Routing `Pass.Report` / `Pass.Reportf` calls into an internal `*result.Issue` stream.
- Applying processors: `nolint` comments, `exclude-rules`, severity mapping, autogen-file detection, max issues per linter, etc.

For non-`go/analysis` upstream tools, a thin wrapper adapts them by collecting their findings and emitting `Issue` records — they still benefit from the cache and exclude pipeline, just not the shared type-check pass.

---

## 5. How `--fix` works

`--fix` asks each linter to provide a textual diff (`analysis.SuggestedFix`) and applies it to disk:

```bash
golangci-lint run --fix ./...
```

Only a subset of linters can fix: `gofmt`, `goimports`, `gofumpt`, `misspell`, parts of `gocritic`, `whitespace`, and a few more. The runner:

1. Collects all `SuggestedFix` records per file.
2. Sorts them by start offset (descending), so applying does not invalidate earlier offsets.
3. Rewrites the file atomically (write to temp, rename).

Conflicting fixes from different linters on the same range are skipped with a warning — you may have to re-run after fixing the conflict manually.

---

## 6. Debug mode

```bash
golangci-lint run -v                              # verbose: which packages, linters, timings
golangci-lint run -v --print-resources-usage      # peak RSS, GC stats per linter
golangci-lint cache status                        # inspect cache
GOLANGCI_LINT_CACHE=/tmp/lc golangci-lint run     # isolate cache for an experiment
```

`-v` prints a per-linter elapsed time table at the end, which is the right starting point when "lint is slow": one linter usually dominates.

```
INFO [runner] Issues before processing: 312, after processing: 14
INFO [runner] processing took 28ms with stages: max_same_issues: 11ms, nolint: 6ms, ...
INFO [runner] linters took 3.2s with stages: staticcheck: 1.8s, gosec: 0.6s, ...
```

---

## 7. Writing a custom linter

Two integration paths:

**Plugin (.so) — v1 model.**

```go
package main

import "golang.org/x/tools/go/analysis"

var Analyzer = &analysis.Analyzer{
    Name: "noprintln",
    Doc:  "disallow fmt.Println in production code",
    Run:  run,
}

func run(pass *analysis.Pass) (any, error) {
    // walk pass.Files, report uses of fmt.Println
    return nil, nil
}

type analyzerPlugin struct{}
func (analyzerPlugin) GetAnalyzers() []*analysis.Analyzer { return []*analysis.Analyzer{Analyzer} }
var AnalyzerPlugin analyzerPlugin
```

Build with `go build -buildmode=plugin -o noprintln.so .` and point the `custom` section at the `.so`. Fragile: must be built with the exact same Go version and architecture as the golangci-lint binary.

**Plugin module — v2 model.**

You declare your analyzers in a Go module and run `golangci-lint custom`, which generates a small main package, compiles it together with the standard linters into a new `golangci-lint` binary. The result is a single static executable with your analyzer baked in — no `.so` headaches, works cross-platform, recommended for CI.

---

## 8. Memory characteristics

A run loads the full type graph of every linted package into one process. Rough numbers on a 500-package monorepo:

| Scenario | Peak RSS |
|----------|----------|
| `go vet` alone | ~600 MB |
| `golangci-lint run` with 8 linters | ~2.5 GB |
| Same, with `unused` enabled (whole-program analysis) | ~4 GB |

`unused` and `gosec` are the usual memory hot-spots — they need cross-package or SSA information. Mitigations:

- Set `run.concurrency` lower; concurrency = peak parallel package analyses, each holding state.
- Split the run by sub-tree in CI (`golangci-lint run ./internal/...` and `./cmd/...` in parallel jobs).
- Disable `unused` on extreme repos and rely on `deadcode` + `unparam` instead (cheaper, narrower).

Watch for OOM-kills in CI containers: a default 1 GB container will not finish a `unused`-enabled run on a large repo.

---

## 9. Summary

Internally, `golangci-lint` is a `go/packages` loader plus a `go/analysis` runner with a disk cache, wrapping each upstream linter as a normal Go dependency. The cache (`~/.cache/golangci-lint`) is keyed on tool/Go versions, enabled linter set and settings, and source hashes. `--fix` works by collecting `SuggestedFix` records and rewriting files atomically; conflicts are skipped. Custom linters integrate via the v1 `.so` plugin or, preferably, the v2 plugin module that emits a custom binary. Memory scales with package count and whether whole-program analyzers (`unused`) are on — plan CI resources accordingly.

---

## Further reading
- Source: https://github.com/golangci/golangci-lint
- `go/packages`: https://pkg.go.dev/golang.org/x/tools/go/packages
- `go/analysis` framework: https://pkg.go.dev/golang.org/x/tools/go/analysis
- Custom linters: https://golangci-lint.run/plugins/
