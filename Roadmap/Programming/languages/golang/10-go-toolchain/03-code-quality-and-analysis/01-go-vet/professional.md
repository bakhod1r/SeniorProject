# go vet — Professional

## 1. Under the hood: `cmd/vet` is a thin wrapper

In modern Go (1.20+), `cmd/vet` in the standard distribution is essentially a **shim** that delegates to the vet implementation living inside the compiler toolchain (`cmd/compile/internal/vet` and the `go/analysis` framework). The standard analyzers are registered in one place, packaged as a `unitchecker`-compatible binary, and invoked by the `go` command.

Why this matters: it means `go vet` and any **third-party** `unitchecker` (`staticcheck`, a custom in-house tool) speak the same protocol. The `go` command knows how to drive them, hash inputs into the build cache, and report uniformly. The reference source trees:

- `src/cmd/vet/` — the shim and entrypoint.
- `golang.org/x/tools/go/analysis/` — the framework (Analyzer, Pass, Fact, Diagnostic).
- `golang.org/x/tools/go/analysis/passes/` — the individual analyzers (printf, shadow, structtag, ...).
- `golang.org/x/tools/go/analysis/unitchecker/` — the protocol that lets `-vettool=` work.

Reading `passes/printf` is one of the best ways to learn the framework.

---

## 2. The `Pass` lifecycle

For every (analyzer × package) the driver creates a `Pass` and supplies:

```go
type Pass struct {
    Analyzer  *Analyzer
    Fset      *token.FileSet
    Files     []*ast.File
    Pkg       *types.Package
    TypesInfo *types.Info
    ResultOf  map[*Analyzer]any   // outputs of analyzers this one Requires
    Report    func(Diagnostic)
    ImportObjectFact func(types.Object, Fact) bool
    ExportObjectFact func(types.Object, Fact)
    ImportPackageFact func(*types.Package, Fact) bool
    ExportPackageFact func(Fact)
    // ...
}
```

The driver topologically sorts packages and analyzers, runs them in parallel respecting `Requires`, and threads results through `ResultOf`. Analyzers that need cross-package data export **Facts**; the driver serializes them and re-imports them when the importer package is vetted.

---

## 3. Facts and cross-package reasoning

The classic example: `printf` recognizes user-defined printf-like functions across packages.

```go
// In package "log":
func Infof(format string, args ...any) { ... }
```

```go
// In your package:
log.Infof("count=%d", "oops")   // vet flags this
```

For this to work, `printf` must know `log.Infof` is printf-like. It records that as a **Fact** attached to the `Infof` object in package `log`. When `printf` runs on your package, the driver imports the Fact from disk and the analyzer behaves the same way as for `fmt.Printf`.

Two kinds of facts:

- **Object facts** — attached to a `types.Object` (function, variable, type) inside a specific package.
- **Package facts** — attached to a whole `types.Package`.

Facts are gob-encoded, cached, and propagate through the import graph. This is how vet scales: each package is analyzed once and its facts are reused by every dependent package.

---

## 4. SSA-based analyzers

A few advanced analyzers (and many in `staticcheck`) operate on **SSA** form rather than the AST. `golang.org/x/tools/go/analysis/passes/buildssa` produces an SSA representation per function; downstream analyzers consume it via `ResultOf`:

```go
var Analyzer = &analysis.Analyzer{
    Name:     "nilness",
    Requires: []*analysis.Analyzer{buildssa.Analyzer},
    Run:      run,
}

func run(pass *analysis.Pass) (any, error) {
    s := pass.ResultOf[buildssa.Analyzer].(*buildssa.SSA)
    for _, fn := range s.SrcFuncs {
        analyzeNilness(pass, fn)
    }
    return nil, nil
}
```

SSA enables control-flow reasoning (e.g., "this pointer is provably nil on this path"). The cost is higher CPU and memory per package, which is why vet's standard set leans AST-based and saves SSA for opt-in analyzers (`nilness`, `lostcancel` partially).

---

## 5. Build-cache integration

The vet driver computes a cache key for each (analyzer × package) tuple from:

- Source content of the package (already hashed by `go build`).
- Type signatures of all dependencies (so an unrelated dep change does not invalidate vet results).
- Imported facts from dependencies.
- Analyzer identity (binary path + version for `-vettool`).
- Analyzer flags.

Lookup hits return the cached diagnostics directly. Misses run the analyzer and store the (diagnostics + exported facts) into `GOCACHE` under the same hashing scheme as compiled archives. Practical implications:

- `go vet ./...` on a warm cache is dominated by cache lookups and printing.
- A change to one file invalidates that package and any dependent that imported its facts.
- Switching `-vettool` binaries triggers a full revet (different analyzer identity).
- `GOCACHE=off` disables the cache and forces full re-analysis (useful for debugging cache bugs).

---

## 6. How `go test` invokes vet

`go test` calls into the same vet machinery before running tests. The selection of analyzers is controlled by:

```
go test [-vet list] packages
```

| Value | Meaning |
|-------|---------|
| `-vet=off` | Skip vet entirely |
| `-vet=all` | Run **all** analyzers in the default vet binary |
| `-vet=a,b,c` | Run only the listed analyzers |
| (default) | The "test" set: a vetted-for-tests subset chosen by the Go team |

The default test set is intentionally **smaller** than the full vet set: only analyzers the team considers cheap and essential during testing (printf, atomic, bool, buildtag, directive, errorsas, ifaceassert, nilfunc, stringintconv, ...). Test failures from this subset show as `FAIL pkg [vet]`. Override with `go test -vet=all` in CI for stricter checking.

---

## 7. Debugging vet behavior

Useful tricks:

```bash
go vet -x ./...                 # print the underlying tool invocations
go vet -json ./...              # machine-readable diagnostics output
go tool vet help                # list all analyzers built into the vet binary
go tool vet help printf         # detailed help for one analyzer
go vet -vettool=$(which staticcheck) ./...   # confirm vettool wiring works
```

To inspect an analyzer's facts during development, run your `unitchecker` binary with `-fact=true` (depending on framework version) or set the analyzer's own debug flag. Many analyzers (`printf`, `shadow`) accept analyzer-specific flags exposed via the `-NAME.FLAG` convention.

---

## 8. Performance at scale

For monorepos with thousands of packages:

- Persist `GOCACHE` across CI runs (the same recipe used for build/test caching applies).
- Vet only changed packages on PR builds: derive the set from `git diff --name-only` and feed it as explicit import paths (`go vet ./pkg/changed/... ./pkg/also_changed/...`). Use `go vet ./...` on `main` post-merge for full coverage.
- For very large repos, set `-p` to match the actual CPU quota; analyzer scheduling parallelizes by package.
- A `unitchecker` that bundles vet + staticcheck + custom analyzers in one process avoids loading the package set multiple times — the loader is the expensive part. Tools like `golangci-lint` exploit this directly.

---

## 9. Where the source lives (reading list)

- `src/cmd/vet/main.go` — shim entrypoint.
- `golang.org/x/tools/go/analysis/analysis.go` — `Analyzer`, `Pass`, `Diagnostic`, `Fact`.
- `golang.org/x/tools/go/analysis/unitchecker/unitchecker.go` — the protocol that makes `-vettool` work.
- `golang.org/x/tools/go/analysis/singlechecker/` and `multichecker/` — wrappers for standalone binaries.
- `golang.org/x/tools/go/analysis/passes/printf/` — best example of a real analyzer with fact propagation.
- `golang.org/x/tools/go/analysis/passes/lostcancel/` — example of an SSA-using analyzer.

---

## 10. Summary

`go vet` is a thin shim over the `go/analysis` framework. Analyzers receive a `Pass` per package, can `Require` other analyzers, exchange cross-package data via gob-encoded `Fact`s, and emit `Diagnostic`s that the driver caches alongside compiled archives in `GOCACHE`. Some analyzers use SSA (`buildssa`) for control-flow reasoning. `go test` calls into the same machinery with a smaller default analyzer set, overridable with `-vet=...`. At scale, persist `GOCACHE`, vet only changed packages on PRs, and bundle analyzers into a single `unitchecker` binary to amortize the cost of package loading.

---

## Further reading
- `golang.org/x/tools/go/analysis` package docs: https://pkg.go.dev/golang.org/x/tools/go/analysis
- "Analyzers" design doc: https://github.com/golang/tools/blob/master/go/analysis/doc/passes.md
- `cmd/vet` source: https://github.com/golang/go/tree/master/src/cmd/vet
- Build/test caching internals: https://pkg.go.dev/cmd/go#hdr-Build_and_test_caching
