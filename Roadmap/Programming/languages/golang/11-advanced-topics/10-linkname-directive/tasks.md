## `//go:linkname` Directive — Tasks

A graduated set of hands-on tasks. Work through them in order; each builds on what you learned in the previous one.

---

## Task 1: Read the stdlib's use of `runtime.nanotime`

Open the Go source tree (clone `github.com/golang/go` or browse online):

- `src/time/time.go`
- `src/runtime/time.go`

Find the `//go:linkname` directive that bridges `runtime.nanotime` into the `time` package. Note the file's blank `import _ "unsafe"`.

**Acceptance criteria.** You can answer: which file consumes the linkname, which file publishes the underlying symbol, and what the local function name is on each side.

---

## Task 2: Write your first linkname to `runtime.nanotime`

Create a new module:

```bash
mkdir linkname-demo && cd linkname-demo
go mod init example.com/linkname-demo
```

Write `main.go`:

```go
package main

import (
    "fmt"
    _ "unsafe"
)

//go:linkname nanotime runtime.nanotime
func nanotime() int64

func main() {
    fmt.Println(nanotime())
}
```

Build and run with `go build && ./linkname-demo`.

**Acceptance criteria.** Program prints a large positive integer that increases each time you run it. The build succeeds on your current Go version.

---

## Task 3: Observe what happens without `import _ "unsafe"`

On Go 1.23+, remove the blank import from Task 2 and rebuild.

**Acceptance criteria.** Compilation fails with the message:

```
linkname directive must be used with import "unsafe"
```

Restore the import. Document in a comment why the import is required.

---

## Task 4: Observe what happens with a function body

Add a body to the linkname declaration:

```go
//go:linkname nanotime runtime.nanotime
func nanotime() int64 { return 0 }
```

Rebuild.

**Acceptance criteria.** The build fails with either a compile error or a linker duplicate-symbol error. Remove the body and confirm the original program still works.

---

## Task 5: Break the directive with a blank line

Insert a blank line between the directive and the function:

```go
//go:linkname nanotime runtime.nanotime

func nanotime() int64
```

Rebuild.

**Acceptance criteria.** Build fails with `missing function body` because the directive is silently disregarded when separated by a blank line. Restore the layout.

---

## Task 6: Verify the link with `go tool nm`

After a successful build:

```bash
go tool nm linkname-demo | grep -E '(nanotime|runtimeNano)'
```

**Acceptance criteria.** Two symbols print with **the same address**. One is `runtime.nanotime`; the other is `main.nanotime`. The shared address confirms the link succeeded.

---

## Task 7: Link `runtime.fastrand` (gated by Go version)

Write `fastrand.go` with the directive:

```go
//go:build go1.18 && !go1.22

package main

import _ "unsafe"

//go:linkname fastrand runtime.fastrand
func fastrand() uint32
```

For Go 1.22+, write `fastrand_v2.go`:

```go
//go:build go1.22

package main

import "math/rand/v2"

func fastrand() uint32 { return rand.Uint32() }
```

**Acceptance criteria.** The program builds on Go 1.20, 1.21, 1.22, and any newer release you have available. The linkname version is exercised only on the versions where the runtime symbol exists.

---

## Task 8: Observe what breaks across Go versions

If you have access to multiple Go installations (e.g., via `gvm`, `asdf`, or `go install golang.org/dl/go1.X@latest`), build Task 7 on:

- Go 1.20 (linkname version active)
- Go 1.22 (math/rand/v2 version active)

Now intentionally widen the build tag in `fastrand.go` to `//go:build go1.18` (no upper bound) and build on Go 1.22.

**Acceptance criteria.** The Go 1.22 build now fails with `relocation target runtime.fastrand not defined` (or a similar linker error). This demonstrates why precise version bounds are mandatory. Restore the original tag.

---

## Task 9: Add a regression test

Add `main_test.go`:

```go
package main

import "testing"

func TestNanotimeMonotonic(t *testing.T) {
    a := nanotime()
    b := nanotime()
    if b < a {
        t.Fatalf("nanotime not monotonic: %d → %d", a, b)
    }
}

func TestFastrandNonzero(t *testing.T) {
    // not a strong test, but catches a totally-broken linkname
    seen := map[uint32]bool{}
    for i := 0; i < 8; i++ {
        seen[fastrand()] = true
    }
    if len(seen) < 2 {
        t.Fatalf("fastrand returned only %d unique values in 8 calls", len(seen))
    }
}
```

Run `go test`.

**Acceptance criteria.** Both tests pass. The tests are smoke checks that would fail loudly if a Go upgrade renamed or removed the linked symbols.

---

## Task 10: Compare with the public API

Add benchmarks for the linkname version and the public-API equivalent:

```go
package main

import (
    "testing"
    "time"
    "math/rand/v2"
)

func BenchmarkNanotimeLinkname(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = nanotime()
    }
}

func BenchmarkTimeNow(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = time.Now().UnixNano()
    }
}

func BenchmarkFastrandV2(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = rand.Uint32()
    }
}
```

Run `go test -bench=. -benchmem -run=^$`.

**Acceptance criteria.** You can quote, in nanoseconds, the gap between each linkname version and its public-API alternative. You can defend, in writing, whether the gap justifies the linkname in a specific workload.

---

## Task 11: Remove the linkname and find the alternative

Delete the `//go:linkname nanotime` declaration and the `nanotime()` function entirely. Replace its uses with `time.Now().UnixNano()`.

**Acceptance criteria.** The program builds without `import _ "unsafe"`. Tests still pass (you may need to update the monotonicity test to call `time.Now().UnixNano()` instead). Document in a commit message which public API replaced the linkname and what was lost (probably nothing of value).

---

## Task 12: Audit your real codebase

In any Go project you maintain or contribute to:

```bash
git grep -n '//go:linkname'
```

For each result, fill in the table:

| File | Target symbol | Reason given | Replacement candidate |
|------|---------------|--------------|-----------------------|

If the reason field is empty, add it as a comment in the source. If the replacement column is empty, file an issue.

**Acceptance criteria.** Every active `//go:linkname` in your codebase has a documented rationale and a known migration path. If the project has no `//go:linkname` uses, repeat the search across `go mod download`'d dependencies.

---

## Task 13: Build with `-checklinkname=0` and reason about why not

On Go 1.23+, build a project with `-ldflags="-checklinkname=0"`:

```bash
go build -ldflags="-checklinkname=0" ./...
```

This disables the link-time check on disallowed external linknames.

**Acceptance criteria.** You can explain why this flag is a last-resort escape hatch, what the Go team's stated plan is for the next release, and why a production CI should leave the flag at its default. Write a paragraph explaining when (if ever) you would commit this flag to your build configuration.

---

## Further reading
- `cmd/compile` directives: https://pkg.go.dev/cmd/compile#hdr-Compiler_Directives
- Go 1.23 release notes: https://go.dev/doc/go1.23
- `math/rand/v2`: https://pkg.go.dev/math/rand/v2
- `time` package: https://pkg.go.dev/time
