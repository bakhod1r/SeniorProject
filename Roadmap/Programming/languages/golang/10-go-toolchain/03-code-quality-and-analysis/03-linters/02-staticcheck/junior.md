# staticcheck — Junior

## 1. What is staticcheck?

`staticcheck` is a **state-of-the-art static analyzer** for Go, written by Dominik Honnef. It reads your code without running it and reports likely bugs, dead code, and simplification opportunities. It is deeper and stricter than `go vet`: `go vet` deliberately limits itself to checks with **zero false positives**, while staticcheck includes hundreds of checks that find real problems vet misses.

Think of it as the linter you run **in addition to** `go vet`, not instead of it.

```bash
staticcheck ./...
```

That one command analyzes every package in your module and prints findings.

---

## 2. Install

```bash
go install honnef.co/go/tools/cmd/staticcheck@latest
```

After this, `staticcheck` is on your `PATH` (assuming `$(go env GOPATH)/bin` is in `PATH`). Verify:

```bash
staticcheck -version
# staticcheck 2024.x.x (vX.Y.Z)
```

For one-off runs without installing, you can use `go run`:

```bash
go run honnef.co/go/tools/cmd/staticcheck@latest ./...
```

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Check** | A single analysis rule, identified by a stable ID like `SA1006` |
| **Check ID** | Two-letter prefix + number; the prefix names the family |
| **SA** | "Static Analysis" — likely bugs and correctness issues |
| **S** | "Simple" — code that can be simplified without changing meaning |
| **ST** | "Style" — stylistic conventions (capitalization, naming, etc.) |
| **U** | "Unused" — dead code (unused functions, fields, constants) |
| **QF** | "Quickfix" — refactoring suggestions usable from `gopls` |
| **`go vet`** | Standard library's conservative analyzer; ships with the Go toolchain |
| **False positive** | A reported issue that is intentional or wrong |

---

## 4. Your first run

Create a file with an obvious bug:

```go
package main

import "fmt"

func main() {
    name := "Ada"
    fmt.Printf("%d\n", name) // wrong verb for a string
}
```

```bash
$ staticcheck .
./main.go:7:5: Printf format %d has arg name of wrong type string (SA1006)
```

The output format is `file:line:col: message (CheckID)`. The ID at the end is your handle for that rule — you can look it up, ignore it, or read its rationale.

---

## 5. Issues staticcheck typically catches

A small sampler of real, common findings:

```go
// SA1006: Printf verb mismatch
fmt.Printf("%d\n", "hello")

// SA4006: this value of x is never used
x := compute()
x = recompute() // first compute() result thrown away

// S1000: should use 'for range ch' instead of 'for { select { ... } }'
for {
    select {
    case v := <-ch:
        use(v)
    }
}

// ST1005: error strings should not be capitalized
return errors.New("Something went wrong")

// U1000: function 'unused' is unused
func unused() {}
```

Each has a stable ID so you can talk about them, suppress them, or document team policy around them.

---

## 6. How it complements `go vet`

`go vet` is shipped with Go and runs automatically as part of `go test`. It is intentionally conservative — no false positives, narrow scope (printf format, copy of mutex, unreachable code). Staticcheck adds the broader, opinionated checks that catch many more real bugs but may occasionally flag something intentional.

The standard project layout:

```bash
go vet ./...       # always-on, no false positives
staticcheck ./...  # deeper analysis, occasionally needs a //lint:ignore
```

Run both in CI. They overlap a little but each finds things the other misses.

---

## 7. The check ID system

Every finding ends with a code like `SA1006` or `ST1005`. The two-letter prefix tells you the **family**:

| Prefix | Family | Example |
|--------|--------|---------|
| `SA` | Likely bugs (correctness) | `SA1006` printf misuse |
| `S` | Simplifications | `S1005` redundant `_` in `for _, _ := range` |
| `ST` | Style | `ST1005` capitalized error string |
| `U` | Unused code | `U1000` unused unexported function |
| `QF` | Quickfixes (gopls-driven) | `QF1003` convert if/else-if to switch |

The number is stable across releases. Knowing the family lets you decide quickly: an `SA` finding is almost always worth fixing; an `ST` finding may be a team-style decision.

---

## 8. Looking up what a check means

If a code looks cryptic, ask staticcheck:

```bash
staticcheck -explain SA1006
```

This prints the description, motivation, and an example. Use it when you see a new ID and want to understand it before silencing or fixing it.

---

## 9. A common beginner mistake

Running staticcheck on a single file:

```bash
$ staticcheck main.go
# may miss cross-file/cross-package issues
```

Like the rest of the Go toolchain, staticcheck wants **packages**, not files. Use:

```bash
staticcheck ./...   # the whole module
staticcheck ./...   # or a specific package: staticcheck ./internal/auth
```

Single-file invocation works but limits the analysis surface.

---

## 10. Summary

`staticcheck` is the deep Go linter: install with `go install honnef.co/go/tools/cmd/staticcheck@latest`, run with `staticcheck ./...`, read findings as `file:line: msg (ID)`. The family prefix — `SA` (bugs), `S` (simplify), `ST` (style), `U` (unused), `QF` (quickfix) — tells you how seriously to treat a finding. Pair it with `go vet`: vet catches the conservative core, staticcheck catches everything else worth catching.

---

## Further reading
- Project homepage: https://staticcheck.dev
- Check list with descriptions: https://staticcheck.dev/docs/checks/
- `staticcheck -help`, `staticcheck -explain <ID>`
