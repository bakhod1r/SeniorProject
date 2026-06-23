# `unsafe` Package — Professional

## 1. The production stance

In production code, `unsafe` is a controlled substance. The right discipline:

- Confine `unsafe` to a single package (often a `internal/fastpath/` directory).
- Wrap each use in a small, well-named function.
- Document the invariants in a comment above each function.
- Test layout assumptions via `unsafe.Sizeof`/`Offsetof` compile-time constants.
- Gate the package behind a build tag if it's platform-specific.

Application code calls the wrapper functions; the `unsafe` blast radius stays small.

---

## 2. The interface

For an `unsafe`-using package, design the public API to be safe even if the implementation isn't:

```go
// Package fastbuf provides a high-throughput buffer-pool. Internally uses unsafe;
// the public API is type-safe.
package fastbuf

func Get() *Buffer { ... }
func Put(*Buffer) { ... }

type Buffer struct { ... }
func (b *Buffer) Write(p []byte) (int, error) { ... }
func (b *Buffer) Bytes() []byte { ... }
func (b *Buffer) String() string { ... }
```

Callers never see `unsafe.Pointer`. The package handles all the lifetime, mutation, and aliasing rules.

---

## 3. Documenting invariants

```go
// b2s converts a []byte to a string without copying.
//
// PRECONDITIONS:
//   - The returned string aliases the input slice's underlying memory.
//   - The caller MUST NOT modify b while the returned string is live.
//   - The string MUST NOT be used as a map key or for sentinel comparison
//     unless the caller guarantees the bytes are stable.
//
// Returns "" for nil/empty input.
func b2s(b []byte) string {
    if len(b) == 0 { return "" }
    return unsafe.String(unsafe.SliceData(b), len(b))
}
```

The comment is the contract. Code reviewers should be able to verify each precondition against the call site.

---

## 4. CI checks for `unsafe`

For packages containing `unsafe`:

```bash
# vet (catches most pointer-rule violations)
go vet ./...

# staticcheck (catches more)
go install honnef.co/go/tools/cmd/staticcheck@latest
staticcheck ./...

# race detector on integration tests
go test -race ./...

# layout assertions
go test -run TestLayout
```

Layout test:

```go
func TestLayout(t *testing.T) {
    type expected struct {
        Magic  [4]byte    // offset 0
        Len    uint32     // offset 4
        Crc    uint32     // offset 8
    }
    if got, want := unsafe.Sizeof(Header{}), unsafe.Sizeof(expected{}); got != want {
        t.Fatalf("Header size = %d, want %d", got, want)
    }
}
```

---

## 5. Real-world examples in the standard library

It's instructive to read where the standard library uses `unsafe`:

| Package | Use |
|---------|-----|
| `runtime` | Everywhere; defines layouts of `g`, `m`, `p`, etc. |
| `sync/atomic` | `unsafe.Pointer` operations |
| `reflect` | All field/method dispatch under the hood |
| `os` | File descriptor passing for syscalls |
| `syscall` | Argument passing to kernels |
| `time` | Atomic monotonic clock reads |

When you wonder how a pattern should look, grep `unsafe.Pointer` in `src/`. The standard library is the most-reviewed `unsafe` code in the ecosystem.

---

## 6. Patterns that pay off in production

### 6.1. Pool-backed buffer with no-copy conversions

```go
var pool = sync.Pool{New: func() any { return make([]byte, 0, 4096) }}

func render(w io.Writer, args ...arg) error {
    buf := pool.Get().([]byte)[:0]
    defer func() {
        if cap(buf) < 64<<10 {
            pool.Put(buf)
        }
    }()
    buf = appendArgs(buf, args)
    _, err := w.Write(buf)
    return err
}
```

`buf` never becomes a string; we write the bytes directly. Pure `unsafe`-free code in service of zero-allocation.

### 6.2. Cached field offsets for fast struct access

```go
var emailOffset = unsafe.Offsetof(User{}.Email)

func setEmail(u *User, s string) {
    p := unsafe.Add(unsafe.Pointer(u), emailOffset)
    *(*string)(p) = s
}
```

Used in serialization libraries to avoid `reflect.FieldByName` per call.

### 6.3. Lock-free queue with `atomic.Pointer[T]`

```go
type Queue[T any] struct {
    head, tail atomic.Pointer[node[T]]
}

type node[T any] struct {
    next atomic.Pointer[node[T]]
    val  T
}
```

The Go 1.19 `atomic.Pointer[T]` eliminates most of the `unsafe.Pointer` needed for lock-free queues.

---

## 7. The platform problem

Some `unsafe` patterns work differently across architectures:

| Concern | x86_64 | arm64 | 32-bit ARM |
|---------|--------|-------|------------|
| `uint64` alignment in struct | 8 | 8 | 4 (atomic fails) |
| Memory order | TSO | weaker | weaker |
| Cache line size | 64 | 64 | 32–64 |
| `interface{}` data layout | stable | stable | stable |

For per-platform code, gate with build tags:

```go
//go:build amd64 || arm64

package fastpath
```

For platform-portable code, prefer `atomic.Int64`, `atomic.Uint64`, etc., which guarantee alignment.

---

## 8. Versioning across Go releases

`unsafe` is **excluded** from the Go 1 compatibility promise. Tighter checks may flag previously-clean code. Practical hygiene:

- Run `go vet` after each Go upgrade and inspect new warnings.
- CI matrix-tests against the previous and current Go version.
- Pin a `// go:build go1.20` constraint on packages that use `unsafe.SliceData` / `unsafe.StringData`.

---

## 9. Talking to your team about `unsafe`

A PR that introduces `unsafe` should answer:

1. **Why** — what specific cost is being optimized? Profile evidence required.
2. **Boundary** — which functions can call this, which can't?
3. **Invariants** — what must callers guarantee?
4. **Tests** — unit, layout, race?
5. **Fallback** — can we measure whether the gain is real?

A useful template for the PR description:

> Replaces `[]byte → string` copy in the hot encode path. Benchmark before: 850 ns/op, 2 allocs/op. After: 420 ns/op, 1 alloc/op. Invariant: the buffer is read-only between Encode() and Reset(). Covered by TestNoMutationAfterEncode.

---

## 10. The "we don't allow `unsafe`" stance

Some teams ban `unsafe` outright. This is defensible:

- 99% of code doesn't need it.
- The remaining 1% can usually be solved by `reflect`, generics, or `encoding/binary` with acceptable performance.
- A ban is enforceable via `staticcheck` or a custom linter.

For larger codebases, a ban with a clear escape hatch ("`internal/fastpath/` is the only place `unsafe` is allowed") works well.

---

## 11. When `unsafe` is wrong but tempting

| Temptation | Better answer |
|------------|---------------|
| "Set an unexported field of another package" | Don't. If you need it, ask the package owner. |
| "Cast a slice of struct A to a slice of struct B because they have the same fields" | Use a typed converter; don't trust layout. |
| "Make the code faster by 1%" | The 1% isn't worth the maintenance burden. |
| "Implement a feature C has but Go doesn't" | Often the constraint is Go's design, not a missing primitive. |
| "Marshal a Go struct directly to a binary protocol" | `encoding/binary` first; `unsafe` only if profiles demand. |

---

## 12. Migrating off `unsafe`

Generics replaced some `unsafe`-heavy patterns. Examples:

```go
// Old: unsafe.Pointer-based any-to-any cast
func copy(dst, src any) { /* unsafe internals */ }

// New: generic
func Copy[T any](dst, src []T) int { return copy(dst, src) }
```

```go
// Old: atomic.LoadPointer with unsafe.Pointer
var head unsafe.Pointer
atomic.StorePointer(&head, unsafe.Pointer(node))

// New: typed atomic
var head atomic.Pointer[Node]
head.Store(node)
```

When upgrading a Go version, re-audit your `unsafe` usage to see what can be replaced with the new typed primitives.

---

## 13. Summary

Production `unsafe` is a contained, reviewed, tested resource. Wrap it in safe APIs, document invariants, run vet+staticcheck+race in CI, and re-audit after Go upgrades. Prefer typed alternatives (`atomic.Pointer[T]`, `unsafe.SliceData`/`StringData`, generics) for new code. The blast radius of `unsafe` should be small, the maintenance overhead worth the measured win.

---

## Further reading
- `unsafe` package docs and pointer rules
- `atomic.Pointer[T]` (Go 1.19+)
- `staticcheck`: https://staticcheck.io
- `goccy/go-json`'s `unsafe` strategy: https://github.com/goccy/go-json
