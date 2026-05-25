# goimports — Find the Bug

Each scenario shows a command or setup that looks fine but misbehaves. Find the defect, explain it, and fix it.

---

## Bug 1 — File appears unchanged after `goimports`

```bash
$ goimports main.go
# output prints to terminal, but `git diff main.go` shows nothing
```

**Bug:** without `-w`, `goimports` writes the formatted result to **stdout**; the file on disk is untouched.
**Fix:** add `-w` to rewrite in place:

```bash
goimports -w main.go
```

---

## Bug 2 — Wrong package picked for ambiguous name

```go
// Intent: use crypto/rand for a token.
token := make([]byte, 16)
rand.Read(token)
```

After `goimports -w`:

```go
import "math/rand"   // ← wrong
```

**Bug:** `rand` is exported by both `math/rand` and `crypto/rand`. `goimports` cannot type-check; its heuristic picks `math/rand`. The code compiles but produces a non-cryptographic random for what was meant to be a security-sensitive use.
**Fix:** import the intended package explicitly **before** running `goimports`:

```go
import cryptorand "crypto/rand"
//...
cryptorand.Read(token)
```

`goimports` will preserve the explicit import.

---

## Bug 3 — Local packages mixed in with third-party

```go
import (
    "fmt"

    "example.com/myorg/internal/db"
    "github.com/google/uuid"
    "go.uber.org/zap"
)
```

**Bug:** `goimports` was run **without** `-local`, so it only produced two groups (stdlib + non-stdlib). The team convention is three groups (stdlib, third-party, local).
**Fix:** run with `-local` set to your org's import prefix:

```bash
goimports -w -local example.com/myorg .
```

Add the flag to your Makefile / editor settings / CI script in one place so every invocation agrees.

---

## Bug 4 — CI fails formatting check that passes locally

```text
CI: goimports -l . prints 47 files; build fails.
Locally: goimports -l . prints nothing.
```

**Bug:** the CI image installs `goimports@latest` while the developer has an older (or newer) version installed. Output differs subtly between releases — quote handling, sort order, group separation — causing the mismatch.
**Fix:** pin the version everywhere:

```bash
go install golang.org/x/tools/cmd/goimports@v0.24.0
```

Put that exact version in `scripts/fmt.sh` and use it both locally (via `make fmt`) and in CI. Same for `gopls` in editors.

---

## Bug 5 — `goimports -w .` takes 45 seconds on every commit

```bash
# pre-commit hook
goimports -w -local example.com/myorg .
```

**Bug:** the pre-commit hook runs `goimports` over the **entire** 5,000-file repo on every commit, even when only one file changed. The candidate-scan and per-file rewrite dominate.
**Fix:** scope the hook to staged Go files:

```bash
files=$(git diff --cached --name-only --diff-filter=ACM | grep '\.go$' || true)
[ -z "$files" ] && exit 0
goimports -w -local example.com/myorg $files
git add $files
```

Keep the full-tree check in CI; keep the hook fast.

---

## Bug 6 — Formatter battle between `goimports` and `gofumpt`

```bash
$ make fmt
goimports -w .
gofumpt -w .

$ goimports -l .
internal/foo/bar.go   # gofumpt changed something goimports wants to undo
```

**Bug:** the two tools enforce overlapping rules and you ran them in an order where each undoes part of the other's work. In practice this happens when `gofumpt`-only style changes (e.g., composite literal layout) sit near imports that `goimports` then re-touches.
**Fix:** pick one canonical order and stop running both, or replace the pair: use `gofumpt + gci` instead of `goimports + gofumpt`. If you keep both, the working order is `goimports` first, then `gofumpt`, and your CI gate runs `gofumpt -l` (the stricter one), not `goimports -l`.

---

## Bug 7 — `goimports` keeps deleting an import you need

```go
package db

import _ "github.com/lib/pq"   // register Postgres driver

func init() { /* nothing references pq directly */ }
```

After `goimports -w`:

```go
package db

func init() { /* ... */ }
```

**Bug:** the import is a **blank import** for its `init()` side effect (driver registration). `goimports` sees no reference to the `pq` package name and deletes it. Blank imports are the textbook case where `goimports` is wrong by design.
**Fix:** `goimports` actually preserves blank imports (`_ "..."`) and dot imports (`. "..."`) — but only when the import spec is **exactly** in that form. If yours is being removed, check that you wrote `_` and not just relied on `init()` registration without the underscore. The correct form:

```go
import _ "github.com/lib/pq"
```

`goimports` leaves this alone.

---

## Bug 8 — Pre-commit hook skips test files

```bash
# pre-commit
goimports -w -local example.com/myorg $(git diff --cached --name-only | grep '\.go$' | grep -v _test.go)
```

**Bug:** the `grep -v _test.go` filter excludes test files from formatting. Tests rot: imports drift, dead imports accumulate, and CI's `goimports -l .` (which does **not** exclude tests) eventually fails.
**Fix:** format test files too:

```bash
files=$(git diff --cached --name-only --diff-filter=ACM | grep '\.go$' || true)
[ -z "$files" ] && exit 0
goimports -w -local example.com/myorg $files
git add $files
```

If you have a real reason to skip a generated file, match on the `// Code generated ... DO NOT EDIT.` header, not on `_test.go`.

---

## Bug 9 — `goimports` cannot find a new dependency

```bash
$ go get github.com/spf13/cobra
$ # editor: write `cobra.NewCommand(...)` and save → import not added
```

**Bug:** the package is in `go.mod` but the **module cache** has not been populated (`go get` updated `go.mod`/`go.sum` but the actual download has not happened, or happened to a different module cache than `goimports` is reading). `goimports`'s candidate scan only sees packages on disk.
**Fix:** force the download and retry:

```bash
go mod download
goimports -w main.go
```

If you use a custom `GOPATH`/`GOMODCACHE`, make sure your editor and shell point at the same one.

---

## Bug 10 — `goimports -w` rewrites `vendor/`

```bash
$ goimports -w -local example.com/myorg .
# diff shows hundreds of vendor/ files changed
```

**Bug:** `.` includes `vendor/`, which contains third-party code you do not own. Rewriting it pollutes your diff and breaks reproducibility against the vendored sources.
**Fix:** exclude `vendor/` (and any other read-only trees) explicitly:

```bash
find . -name '*.go' -not -path './vendor/*' -not -path '*/gen/*' -print0 | \
  xargs -0 goimports -w -local example.com/myorg
```

Or run the formatter from a subdirectory that does not contain `vendor/`.

---

## How to approach these
1. File not changed? → check you used `-w`.
2. Wrong package imported? → ambiguous name; import explicitly first.
3. Groups look wrong? → `-local` missing or inconsistent.
4. CI disagrees with local? → pin the `goimports` binary version.
5. Slow pre-commit? → run on staged files only.
6. Imports keep disappearing? → blank/dot imports need the `_` or `.` prefix.
7. Vendor rewritten? → exclude `vendor/` and generated trees explicitly.
