# go vet — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.21+.

---

## Task 1: First vet pass

Initialize a fresh module and run vet against the empty tree.

```bash
mkdir vet-demo && cd vet-demo
go mod init example.com/vetdemo
```

**Acceptance criteria**
- [ ] `go vet ./...` exits with status 0 and prints nothing.
- [ ] You can explain in one sentence what `./...` means.

---

## Task 2: Catch a printf bug

Create `main.go`:

```go
package main

import "fmt"

func main() {
    name := "Alice"
    fmt.Printf("count = %d\n", name)
}
```

**Acceptance criteria**
- [ ] `go run .` compiles and runs (printing nonsense).
- [ ] `go vet ./...` reports `Printf format %d has arg name of wrong type string`.
- [ ] You fix it by changing `%d` to `%s` (or the arg type) and vet exits 0.

---

## Task 3: Trigger the structtag analyzer

Introduce a malformed struct tag:

```go
type User struct {
    ID   int    `json:id`           // missing quotes
    Name string `json:"name"`
}
```

**Acceptance criteria**
- [ ] `go vet ./...` reports the structtag diagnostic on the `ID` field.
- [ ] Fixing it to `json:"id"` makes vet exit 0.
- [ ] You can describe one other thing structtag catches (e.g., duplicate keys).

---

## Task 4: Run a single analyzer

Using `go tool vet` directly, run only `printf` against a package.

**Acceptance criteria**
- [ ] `go tool vet help` lists all built-in analyzers.
- [ ] `go vet -printf=false ./...` skips printf checks; reintroducing the bug from Task 2 produces **no** diagnostic.
- [ ] You can show that omitting `-printf=false` restores the diagnostic.

---

## Task 5: Write a tiny custom analyzer with `singlechecker`

Create `cmd/nopanic/main.go` and a small `nopanic` package with an `Analyzer` that reports any call to `panic()` in production code (non-test files).

```go
package nopanic

import (
    "go/ast"
    "strings"
    "golang.org/x/tools/go/analysis"
    "golang.org/x/tools/go/analysis/passes/inspect"
    "golang.org/x/tools/go/ast/inspector"
)

var Analyzer = &analysis.Analyzer{
    Name:     "nopanic",
    Doc:      "report calls to panic() outside _test.go files",
    Requires: []*analysis.Analyzer{inspect.Analyzer},
    Run:      run,
}

func run(pass *analysis.Pass) (any, error) {
    insp := pass.ResultOf[inspect.Analyzer].(*inspector.Inspector)
    insp.Preorder([]ast.Node{(*ast.CallExpr)(nil)}, func(n ast.Node) {
        call := n.(*ast.CallExpr)
        if id, ok := call.Fun.(*ast.Ident); ok && id.Name == "panic" {
            f := pass.Fset.Position(call.Pos()).Filename
            if !strings.HasSuffix(f, "_test.go") {
                pass.Reportf(call.Pos(), "avoid panic() in production code")
            }
        }
    })
    return nil, nil
}
```

```go
// cmd/nopanic/main.go
package main
import (
    "example.com/x/nopanic"
    "golang.org/x/tools/go/analysis/singlechecker"
)
func main() { singlechecker.Main(nopanic.Analyzer) }
```

**Acceptance criteria**
- [ ] `go build -o /tmp/nopanic ./cmd/nopanic` succeeds.
- [ ] `/tmp/nopanic ./...` reports `panic()` calls in non-test files.
- [ ] `go vet -vettool=/tmp/nopanic ./...` produces the same diagnostics via the vet driver.

---

## Task 6: Wire vet into CI as a required step

Add `go vet ./...` to your CI workflow.

**Acceptance criteria**
- [ ] A CI step runs `go vet ./...` after `go build` and before `go test`.
- [ ] Pushing a commit that introduces a printf bug makes the CI job fail.
- [ ] Fixing the bug makes the job pass on the next push.

---

## Task 7: Use `go test -vet=all` for stricter checking

Change your CI test step to enable the full vet set during tests.

**Acceptance criteria**
- [ ] `go test -vet=all ./...` is used in CI instead of plain `go test ./...`.
- [ ] You introduce a bug caught only by an analyzer **outside** the default test set (e.g., `copylocks`) and observe CI failing under `-vet=all` but passing under the default.
- [ ] You document in `CONTRIBUTING.md` why `-vet=all` is used.

---

## Task 8: Confirm vet cache reuse

Measure cache behavior to internalize that vet is cheap on a warm cache.

**Acceptance criteria**
- [ ] `go clean -cache && time go vet ./...` (cold) takes noticeably longer than the same command repeated immediately (`time go vet ./...`, warm).
- [ ] You can name two things that bust the vet cache (source change, analyzer flag change, toolchain version, environment).

---

## Task 9: Reject a `-vettool` shortcut in review

Imagine a teammate adds `// nolint:vet` style comments around a printf diagnostic instead of fixing it.

**Acceptance criteria**
- [ ] You write a 2–3 sentence PR comment explaining why suppressing vet is the wrong fix (zero-false-positive contract; the diagnostic is a real bug).
- [ ] You provide a corrected diff that fixes the underlying bug instead of silencing the analyzer.
