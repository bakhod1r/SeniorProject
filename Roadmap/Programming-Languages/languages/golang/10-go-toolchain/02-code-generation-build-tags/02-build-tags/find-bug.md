# Build Tags — Find the Bug

Each scenario shows code or a command that looks fine but misbehaves. Find the defect, explain it, and fix it.

---

## Bug 1 — Constraint becomes a doc comment

```go
//go:build linux
package main             // no blank line!

import "fmt"

func main() { fmt.Println("linux only") }
```

```bash
$ GOOS=darwin go build .
# builds and runs — the "linux only" file is included on every OS
```

**Bug:** the `//go:build linux` line is treated as a doc comment for the `package` declaration because no blank line separates them; the constraint is **ignored**.
**Fix:** add a blank line between the constraint and `package`:

```go
//go:build linux

package main
```

---

## Bug 2 — Constraint below the `package` clause

```go
package main

//go:build linux

import "fmt"

func main() { fmt.Println("not really linux only") }
```

**Bug:** build constraints must appear **above** the `package` clause. Below it, `//go:build` is just an ordinary comment.
**Fix:** move the constraint to the top of the file with a blank line before `package`.

---

## Bug 3 — File-suffix typo

```
mypkg/
  feature.go
  helper_linus.go      // typo: "linus" instead of "linux"
```

```bash
$ GOOS=darwin go list -f '{{.GoFiles}}' ./mypkg
[feature.go helper_linus.go]
```

**Bug:** `linus` is not a recognized `GOOS`, so the suffix imposes **no constraint** — the file is compiled on every platform. There is no warning.
**Fix:** rename to `helper_linux.go`. The Go tool's suffix recognition is case-sensitive and limited to known OS/arch names; typos fail open, not closed.

---

## Bug 4 — `//go:build` and `// +build` disagree

```go
//go:build linux
// +build windows

package mypkg
```

```bash
$ go vet ./...
mypkg/foo.go:1:1: //go:build comment and // +build comment do not match
```

**Bug:** when both forms are present they must agree; a hand-edit broke that. Modern Go refuses to build.
**Fix:** either delete the legacy line (preferred for new code) or run `gofmt -w .` to regenerate it from the modern line:

```go
//go:build linux
// +build linux

package mypkg
```

---

## Bug 5 — Integration tests always run (and are slow)

```go
// integration_test.go — NO constraint at the top
package billing

import "testing"

func TestStripeReal(t *testing.T) { /* 8 seconds */ }
```

```bash
$ go test ./...    # takes 9 seconds because the integration test always runs
```

**Bug:** the file was meant to be opt-in but has no `//go:build integration` line, so it is included in every `go test ./...`.
**Fix:** add the constraint at the top of the file with a blank line after, then run with `-tags=integration` only when you want it:

```go
//go:build integration

package billing
```

---

## Bug 6 — `&&` / `||` precedence confusion

```go
//go:build linux || darwin && amd64
```

The author intended *(linux OR darwin) AND amd64*. The actual evaluation is *linux OR (darwin AND amd64)*, so this file is included on **any** Linux build, including arm64 — usually not what was wanted.

**Bug:** `&&` binds tighter than `||`, just like in Go expressions.
**Fix:** add parentheses to make the intent explicit:

```go
//go:build (linux || darwin) && amd64
```

---

## Bug 7 — Legacy form: space vs comma confusion

```go
// +build !windows linux
```

The author wanted *"NOT (windows OR linux)"*. The legacy form parses **space as OR**, so this means *NOT windows OR linux* → *(!windows) || linux* → true on every Unix AND true on Linux (which is also Unix) → true on every Unix-like and Linux. The Windows exclusion happens but Linux is also explicitly included by the OR, which the author did not realise.

**Bug:** the legacy two-axis grammar trips even experienced developers up. `// +build` uses space=OR, comma=AND, lines=AND.
**Fix:** rewrite as `//go:build`, which uses normal Boolean operators:

```go
//go:build !windows && !linux
```

---

## Bug 8 — Case-sensitive suffix

```
mypkg/
  driver_LINUX.go        // uppercase!
```

```bash
$ GOOS=darwin go list -f '{{.GoFiles}}' ./mypkg
[driver_LINUX.go]
```

**Bug:** the GOOS suffix must be lowercase. `LINUX` is not recognized, so the file has no implicit constraint and is compiled everywhere.
**Fix:** rename to `driver_linux.go`. The Go tool's file-name parser matches against the lowercase `GOOS`/`GOARCH` token list.

---

## Bug 9 — Tag never matches in production

```go
//go:build production

package config

const APIBase = "https://api.example.com"
```

```bash
$ go build .             # forgot -tags=production
./main.go:7:13: undefined: config.APIBase
```

**Bug:** without `-tags=production`, the file is dropped and `APIBase` doesn't exist. The build error is misleading — it looks like a typo, not a missing tag.
**Fix:** either (a) make `production` the default and use `//go:build !development` for the alternate, (b) always pass `-tags=production` in the production build script, or (c) provide a default file without a constraint plus a `//go:build production` override.

The general principle: the default build (no `-tags`) should always succeed and produce a working binary.

---

## Bug 10 — Conditional import causes "imported and not used"

```go
//go:build !windows

package main

import (
    "fmt"
    "syscall"
)

func main() {
    fmt.Println("pid:", syscall.Getpid())
}
```

A teammate adds `//go:build linux` to a file that uses `syscall.Mount`. When building on macOS, only the first file (above) is compiled, and everything works. When building on Linux, both files are compiled. So far so good. But when someone flips the constraint to `//go:build windows` for an experimental Windows port and tries `GOOS=windows go build .`, the first file is excluded — and a separate `main.go` that imported `syscall` "only because" the unix file used it now reports `imported and not used`.

**Bug:** an import lived in a file that was always compiled, but it was only actually *used* by code that disappeared under a tag flip.
**Fix:** keep each file's imports tied to that file's code. If a symbol is used only on Unix, put it in the unix-tagged file along with the import. Don't share imports across files that vary by constraint.

---

## How to approach these
1. Constraint not working? → check the blank line above `package` and that the line starts with exactly `//go:build` (no space).
2. File compiled everywhere when you didn't want it to be? → check the file-name suffix matches a real `GOOS`/`GOARCH`, lowercase.
3. `//go:build` vs `// +build` mismatch? → run `gofmt -w .` once, then delete the legacy line.
4. Wrong files chosen for the current platform? → `go list -f '{{.GoFiles}}' .` shows the truth.
5. Build fails with `undefined: X` after a tag change? → either provide a default-build file that defines `X` or always pass the right `-tags`.
