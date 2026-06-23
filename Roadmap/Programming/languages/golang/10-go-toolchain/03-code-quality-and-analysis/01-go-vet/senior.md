# go vet — Senior

## 1. Where vet sits in the analysis ecosystem

Three layers, ordered by aggressiveness:

| Layer | Tool | Design stance |
|-------|------|---------------|
| Baseline | `go vet` | High-confidence bugs only; zero false positives; bundled |
| Bug-focused linter | `staticcheck` (honnef.co/go/tools) | Bugs + performance + correctness; few false positives |
| Aggregator | `golangci-lint` | Runs many linters in parallel; configurable, opinionated |

The right team policy is **all three**, not "pick one":
- `go vet ./...` — always-on baseline, runs in `go test`.
- `staticcheck ./...` — a separate CI step; broader bug coverage.
- `golangci-lint` — style and codebase-specific rules with a tuned config.

The reason this ladder exists is the **false-positive contract**. Vet refuses to add an analyzer that produces false positives because vet is non-optional (it runs in `go test`). Staticcheck accepts very few. golangci-lint aggregates everything and expects per-repo tuning.

---

## 2. The `go/analysis` framework

Modern vet analyzers are written against `golang.org/x/tools/go/analysis`. The unit of work is an **`Analyzer`**:

```go
package nopanic

import (
    "go/ast"
    "golang.org/x/tools/go/analysis"
    "golang.org/x/tools/go/analysis/passes/inspect"
    "golang.org/x/tools/go/ast/inspector"
)

var Analyzer = &analysis.Analyzer{
    Name:     "nopanic",
    Doc:      "report calls to panic() in non-test code",
    Requires: []*analysis.Analyzer{inspect.Analyzer},
    Run:      run,
}

func run(pass *analysis.Pass) (any, error) {
    insp := pass.ResultOf[inspect.Analyzer].(*inspector.Inspector)
    insp.Preorder([]ast.Node{(*ast.CallExpr)(nil)}, func(n ast.Node) {
        call := n.(*ast.CallExpr)
        if id, ok := call.Fun.(*ast.Ident); ok && id.Name == "panic" {
            pass.Reportf(call.Pos(), "avoid panic in production code")
        }
    })
    return nil, nil
}
```

Key abstractions:

| Concept | Role |
|---------|------|
| `Analyzer` | Metadata + `Run` function |
| `Pass` | One analyzer × one package; gives AST, types, file set, `Report` |
| `Fact` | Information an analyzer exports about a package symbol, consumable by other passes (cross-package) |
| `Diagnostic` | A finding with position, message, optional suggested fix |
| `Requires` | Declares dependencies on other analyzers (e.g., `inspect.Analyzer`) |

Facts are how analyzers reason **across package boundaries** (more in `professional.md`).

---

## 3. Building a runnable tool: `singlechecker` vs `multichecker`

Once you have an `Analyzer`, wrap it in a `main` package to get a binary that behaves like `go vet`:

```go
// cmd/nopanic/main.go
package main

import (
    "example.com/nopanic"
    "golang.org/x/tools/go/analysis/singlechecker"
)

func main() { singlechecker.Main(nopanic.Analyzer) }
```

Build and run:

```bash
go build -o /tmp/nopanic ./cmd/nopanic
/tmp/nopanic ./...
```

For multiple analyzers in one binary, use `multichecker.Main(a1, a2, a3)`. Both wrappers give you flag parsing, package loading, and the same CLI surface as `go vet`.

---

## 4. `unitchecker`: plug your tool into `go vet -vettool=`

The most powerful pattern is **`unitchecker`**. A `unitchecker` binary speaks the same protocol `go vet`'s driver uses internally, so you can hand it to `go vet`:

```go
// cmd/myvet/main.go
package main

import (
    "example.com/nopanic"
    "example.com/fieldorder"
    "golang.org/x/tools/go/analysis/unitchecker"
)

func main() { unitchecker.Main(nopanic.Analyzer, fieldorder.Analyzer) }
```

Then:

```bash
go build -o /tmp/myvet ./cmd/myvet
go vet -vettool=/tmp/myvet ./...
```

Why this matters: `go vet` provides package loading, the build cache, parallel scheduling, and uniform error reporting. Your custom analyzers run with the **same caching and performance** as the built-in ones, instead of you re-implementing a driver. Production-grade linters like `staticcheck` ship a `unitchecker` binary for exactly this reason.

---

## 5. Team policy: vet is non-negotiable in CI

A common senior decision is to codify these in `CONTRIBUTING.md`:

- `go vet ./...` MUST pass before merging.
- `go test -vet=all ./...` for unit tests so the broader vet set runs there.
- A separate CI job runs `staticcheck` and `golangci-lint` for style/perf checks (advisory or required, per team).
- Any `// nolint:` comment requires a justification.

In practice, vet failing is treated like a compile failure — fix the bug, do not silence the analyzer. The zero-false-positive contract is what justifies this stance; if vet starts producing noise, file an issue against the analyzer rather than working around it.

---

## 6. The zero-false-positive design

The Go team explicitly **declines** vet additions that produce occasional false positives. The reasoning:

- Vet runs inside `go test`. A false positive there means tests fail spuriously.
- People learn to ignore noisy tools. A trustworthy tool is a useful tool.
- Style/heuristic checks belong in opt-in linters, not the always-on baseline.

This is why `shadow` is off by default in stock vet (shadowing is sometimes intentional), and why `printf` is conservative about recognizing custom formatter functions. Knowing this stance helps you predict what vet will and will not catch — and tells you when to reach for staticcheck instead.

---

## 7. Caching and performance characteristics

The vet driver hashes the same inputs `go build` does, plus analyzer identity and flags, into a cache key. On a warm cache, vetting an unchanged package is a hash lookup. Things that bust the vet cache:

- Source changes in the package or its dependencies (type info changes).
- Changing analyzer flags (`-printf=false` is a different cache key from `-printf=true`).
- Changing the toolchain or `-vettool` binary.
- Build environment changes (`GOOS`, `GOARCH`, build tags).

Practical implication: `go vet ./...` on a warm cache is typically faster than `go build ./...`, because vet only needs typechecking and the analyzers, not codegen/link.

---

## 8. When vet is the wrong tool

- For **style** rules (`gofmt`, naming): use `gofmt`/`goimports`, `revive`.
- For **dead code** detection across packages: `staticcheck` (`U1000`).
- For **security** checks (SQL injection patterns, weak crypto): `gosec`, `govulncheck`.
- For **dependency vulnerabilities**: `govulncheck`.
- For **performance** (sync allocation, large struct copies): `staticcheck`, `perfsprint`.

Vet's narrow scope is a feature; respect it.

---

## 9. Summary

Vet is the always-on baseline analyzer with a deliberate zero-false-positive contract — that contract is what lets it run inside `go test`. Custom analyzers are built with `golang.org/x/tools/go/analysis`, packaged as `singlechecker`/`multichecker` binaries for standalone use, and as `unitchecker` binaries to plug into `go vet -vettool=` so they inherit caching and package loading. At team scale, vet is required CI, staticcheck and golangci-lint are added on top, and silencing vet diagnostics is treated as fixing a bug, not configuring around it.

---

## Further reading
- `go/analysis` design: https://pkg.go.dev/golang.org/x/tools/go/analysis
- Writing analyzers: https://github.com/golang/tools/blob/master/go/analysis/doc/passes.md
- `unitchecker` docs: https://pkg.go.dev/golang.org/x/tools/go/analysis/unitchecker
- staticcheck: https://staticcheck.dev
