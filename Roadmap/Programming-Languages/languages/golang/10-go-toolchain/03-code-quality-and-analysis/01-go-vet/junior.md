# go vet — Junior

## 1. What is `go vet`?

`go vet` is Go's **built-in static analyzer**. It reads your source code without running it and reports **suspicious constructs that compile but are almost certainly bugs** — like a `fmt.Printf("%d", "hello")` (formatting a string as an integer) or an `unreachable` statement after a `return`.

It ships with the Go toolchain. You do not install anything, you do not need a network, you do not configure a YAML file. You just run it.

```bash
go vet ./...
```

That command vets every package in the current module.

---

## 2. Prerequisites
- Go installed (`go version` shows 1.21 or newer).
- A Go module (`go.mod` present) — or a single file you can vet directly.
- That's it.

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Static analysis** | Inspecting source code without executing it |
| **Analyzer** | A single check `go vet` runs (e.g., `printf`, `shadow`) |
| **Diagnostic** | A reported issue from an analyzer |
| **Linter** | A tool that flags style/quality issues (vet is *not* one) |
| **False positive** | An analyzer warning that is actually fine code |
| **Build cache** | Where Go stores intermediate results to speed re-runs |

---

## 4. A minimal worked example

Create `bad.go`:

```go
package main

import "fmt"

func main() {
    name := "Alice"
    fmt.Printf("count = %d\n", name) // %d expects int, got string
}
```

Run vet:

```bash
$ go vet ./...
./bad.go:7:5: Printf format %d has arg name of wrong type string
```

The program **compiles and runs** (it prints garbage), but vet catches the format mismatch at analysis time. That is the whole pitch: catching bugs the compiler accepts.

---

## 5. The most common invocations

```bash
go vet ./...                # vet every package in the module
go vet .                    # vet the current package
go vet ./internal/auth/...  # vet a subtree
go vet ./cmd/server         # vet one package by path
```

`go vet ./...` is the form you run before pushing or in CI. It is fast and never needs the network.

---

## 6. What it catches out of the box

A non-exhaustive list of common checks:

| Check | Catches |
|-------|---------|
| `printf` | Format-string/argument mismatches in `fmt.Printf`, `log.Printf`, `t.Errorf`, etc. |
| `unreachable` | Statements after `return`, `panic`, infinite loops that can never run |
| `structtag` | Malformed struct tags like `json:user_id` (missing quotes) |
| `shadow` | A variable declaration that hides an outer one (opt-in in newer Go) |
| `nilfunc` | Comparing a function to `nil` always evaluates the same way |
| `assign` | Useless self-assignment (`x = x`) |
| `lostcancel` | A `context.WithCancel` whose `cancel` function is never called |
| `httpresponse` | Using `resp.Body` before checking `err` from `http.Get` |
| `copylocks` | Copying a value that contains a `sync.Mutex` |
| `composites` | Composite literal missing field names where it matters |

Each is conservative — it only fires when the tool is sure it is a real problem.

---

## 7. Why vet is not a linter

A linter (like `golangci-lint`, `staticcheck`, `revive`) flags **style** and **likely improvements**: naming, complexity, unused variables, performance suggestions. Those tools accept some false positives in exchange for catching more issues.

`go vet` deliberately takes the opposite stance: **zero false positives**. If vet complains, your code is almost certainly broken. That is why the Go team is comfortable wiring vet into `go test` automatically (you would not tolerate a linter doing that).

| Tool | Goal | False positives | Bundled with Go? |
|------|------|-----------------|------------------|
| `go vet` | Real bugs only | ~0 | Yes |
| `staticcheck` | Bugs + style + perf | Few | No |
| `golangci-lint` | Aggregator of many linters | Variable | No |

Use vet as a baseline; layer linters on top later.

---

## 8. Vet runs inside `go test`

A surprise for newcomers: `go test` runs **a subset** of vet automatically before executing the tests. So a printf bug in your test file fails the test before any assertion runs:

```bash
$ go test ./...
./foo_test.go:12:5: Errorf format %d has arg s of wrong type string
FAIL    example.com/foo [vet]
```

You can disable it with `go test -vet=off`, but you usually do not want to.

---

## 9. A common beginner moment

```bash
$ go vet ./...
./main.go:42:9: Printf format %s has arg n of wrong type int
```

The fix is almost always: read the message, look at the line, swap the verb (`%d` for ints, `%s` for strings, `%v` for "default format"), or fix the argument. Vet's messages name the file, line, and exact issue — they are short and accurate.

---

## 10. Summary

`go vet` is the static analyzer that comes with Go. It reads your source and reports a small set of high-confidence bugs — printf mismatches, unreachable code, bad struct tags, lost cancel funcs, and more — without ever running your code. Run `go vet ./...` before pushing. It is not a linter (it refuses to flag mere style), and it is reliable enough that `go test` runs a subset of it automatically.

---

## Further reading
- `go doc cmd/vet`
- `go help vet`
- List of analyzers: https://pkg.go.dev/cmd/vet
