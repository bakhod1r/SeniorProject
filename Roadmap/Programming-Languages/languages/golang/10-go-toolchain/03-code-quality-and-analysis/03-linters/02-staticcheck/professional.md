# staticcheck — Professional

## 1. Package layout of the source tree

Staticcheck lives in the `honnef.co/go/tools` repository. The interesting Go packages:

| Package | Role |
|---------|------|
| `honnef.co/go/tools/staticcheck` | The `SA` family — correctness analyzers |
| `honnef.co/go/tools/simple` | The `S` family — simplifications |
| `honnef.co/go/tools/stylecheck` | The `ST` family — style |
| `honnef.co/go/tools/unused` | The `U` family — dead code |
| `honnef.co/go/tools/quickfix` | The `QF` family — IDE-driven refactorings |
| `honnef.co/go/tools/analysis/...` | Shared infrastructure (facts, helpers, code helpers) |
| `honnef.co/go/tools/cmd/staticcheck` | The CLI entry point |
| `honnef.co/go/tools/cmd/unused` | Standalone unused-code driver |

Each family package exports a `var Analyzers []*lint.Analyzer` that the CLI assembles into a single run. The CLI itself is small — most logic is in the analyzer packages, which is what allows reuse from `golangci-lint`, `gopls`, and `unitchecker`.

---

## 2. The `unused` analyzer's reachability algorithm

The `U` family is implemented differently from the others. Instead of pattern-matching ASTs, `unused` builds a **reachability graph** across the whole program:

1. Start from "always reachable" roots: `func main()`, `func init()`, exported symbols in non-`main` packages, symbols touched by reflection, tests, etc.
2. Walk the program and mark every symbol used transitively from a root.
3. Anything unmarked is reported as unused.

Implications:

- `unused` is **whole-program**, not per-package; it needs every package in the analyzed set.
- Unexported symbols in libraries are correctly flagged.
- Exported symbols in libraries are **not** flagged — the analyzer cannot see what callers exist outside the analyzed scope.
- Reflection (`reflect.ValueOf(x).MethodByName("Foo")`) is invisible to the analyzer; it will flag `Foo` as unused. This is a known limitation, not a bug.

Source: `honnef.co/go/tools/unused/unused.go`.

---

## 3. SSA and fact propagation

The `SA` family relies on `golang.org/x/tools/go/ssa` — a static single-assignment representation of the program. Analyzers walk SSA basic blocks and instructions rather than the raw AST, which makes data-flow checks tractable (e.g., "this assignment is never read", "this function never returns").

Cross-package information uses the `go/analysis` **fact** mechanism. Example: `SA1019` (use of deprecated symbol) needs to know whether a function in another package is deprecated. The framework runs a tiny analyzer that scans every package's exports for `// Deprecated:` doc comments and emits an `IsDeprecated` fact attached to each symbol. Later, when `SA1019` runs on a calling package, it queries the framework for that fact. Facts are serialized to disk in the analysis cache, so cross-package propagation is cached just like compilation.

This is why staticcheck on a warm cache is so much faster than cold: facts about your dependencies are reused.

---

## 4. The analysis cache

Staticcheck maintains its own cache, separate from `GOCACHE`:

```bash
$ go env | grep -i cache
GOCACHE="/Users/me/Library/Caches/go-build"
# staticcheck cache:
$ ls ~/Library/Caches/staticcheck
# or $XDG_CACHE_HOME/staticcheck on Linux
```

Cache key inputs (simplified):

- The exact staticcheck binary version (and analyzer set).
- The Go toolchain version.
- Source content hashes of analyzed packages and their dependencies.
- Build tags / `-go` target / relevant flags.

Change any of these and the affected entries are recomputed. This is why pinning the staticcheck version is also a performance lever: switching versions invalidates the whole cache.

Clear with `staticcheck -debug.unused-graph=...` and friends, or simply `rm -rf $(staticcheck-cache-dir)` if you suspect corruption.

---

## 5. `-explain`: built-in introspection

```bash
$ staticcheck -explain SA4006
SA4006: A value assigned to a variable is never read before being overwritten.

Available since: 2017.1

Online documentation: https://staticcheck.dev/docs/checks#SA4006
```

Every check ships its own short rationale embedded in the binary. `-explain` is the canonical way to look one up from the terminal without leaving the shell. Pair it with the website (`staticcheck.dev/docs/checks/#SA4006`) for richer examples.

Implementation note: rationales are declared in each analyzer's `*lint.Analyzer.Doc` field; the CLI just prints that field for the requested ID.

---

## 6. Writing custom analyzers that plug in

Because staticcheck uses `go/analysis`, you can add your own checks to a private driver without forking. Sketch:

```go
package myanalyzer

import "golang.org/x/tools/go/analysis"

var Analyzer = &analysis.Analyzer{
    Name: "noPanic",
    Doc:  "do not call panic() outside init() or _test files",
    Run:  run,
}

func run(pass *analysis.Pass) (interface{}, error) {
    // inspect pass.Files, report with pass.Reportf
    return nil, nil
}
```

Then build a `unitchecker` binary that includes both your analyzer and the staticcheck analyzers. Teams use this to enforce house rules ("no `time.Now()` in business logic", "no `fmt.Println` outside `main`") alongside staticcheck without maintaining a fork.

---

## 7. Deprecated-API tracking in detail (`SA1019`)

A worked example of fact propagation that comes up constantly:

1. `analyzer/lint/deprecated` scans each package's AST for `// Deprecated:` markers on `FuncDecl`, `GenDecl`, etc.
2. It emits a fact `*IsDeprecated` containing the deprecation message, attached to each marked object.
3. `SA1019.Run` walks call sites; for each referenced object, it calls `pass.ImportObjectFact(obj, fact)`. If a fact is returned, the call site is reported with the original deprecation message.

This is why `SA1019` survives across modules: third-party packages' `// Deprecated:` markers propagate through the fact mechanism even though you do not compile their tests or internals.

---

## 8. Diagnosing performance and false positives

Useful debug flags:

```bash
staticcheck -debug.cpuprofile=cpu.out ./...     # CPU profile of the analyzer run
staticcheck -debug.memprofile=mem.out ./...     # heap profile
staticcheck -debug.max-concurrent-jobs=4 ./... # cap parallelism
staticcheck -debug.no-compile-errors ./...     # ignore compile errors and keep going
staticcheck -debug.measure-analyzers=measure.log ./... # per-analyzer wall time
```

For a suspected false positive, the workflow is:

1. Reproduce with the minimal repro (a few lines, a single package).
2. Confirm the version: `staticcheck -version`.
3. Read `-explain SAXXXX` and the source of the analyzer (`honnef.co/go/tools/staticcheck/sa*.go`).
4. If the analyzer's logic is wrong, file an upstream issue with the repro and `staticcheck -version`.

---

## 9. Source-tree references for deep dives

Maps from "I want to understand X" to "read this file":

| Topic | Path in `honnef.co/go/tools` |
|-------|------------------------------|
| All `SA` analyzers | `staticcheck/*.go` (one file per check or family) |
| Simplifications | `simple/*.go` |
| Style checks | `stylecheck/*.go` |
| Unused reachability | `unused/unused.go`, `unused/runtime.go` |
| Quickfixes (IDE) | `quickfix/*.go` |
| CLI driver | `cmd/staticcheck/staticcheck.go` |
| Lint runtime (analyzer wrapper, facts) | `analysis/lint/lint.go` |
| Code helpers (predicates, matchers) | `analysis/code/code.go` |

Most analyzers are 100–300 lines. Reading three or four gives a good sense of the idioms — match an AST pattern, query SSA, emit a `Diagnostic`.

---

## 10. Summary

Staticcheck's source is organized by check family — `staticcheck` (SA), `simple` (S), `stylecheck` (ST), `unused` (U), `quickfix` (QF) — each shipping a slice of `*lint.Analyzer`. SA checks use SSA from `golang.org/x/tools/go/ssa`; cross-package signal (e.g., deprecations for `SA1019`) flows through `go/analysis` facts cached on disk. `unused` runs a whole-program reachability algorithm and so requires the full package set. `staticcheck -explain SAXXXX` is the built-in introspection; debug flags expose profiles and per-analyzer timing. The same analyzers compose into `unitchecker`, `golangci-lint`, and `gopls`, so adopting custom checks alongside staticcheck is a small `go/analysis` exercise, not a fork.

---

## Further reading
- `go/analysis` design: https://pkg.go.dev/golang.org/x/tools/go/analysis
- SSA package: https://pkg.go.dev/golang.org/x/tools/go/ssa
- Source: https://github.com/dominikh/go-tools
