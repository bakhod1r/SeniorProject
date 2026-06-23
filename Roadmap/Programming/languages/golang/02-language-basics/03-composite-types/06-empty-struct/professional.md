# Go Empty Struct — Professional / Internals Level

## 1. Overview

This document documents how the empty struct pattern lives in real production code: where the Go standard library reaches for `chan struct{}`, where Kubernetes uses `map[T]struct{}` for its `sets.Set` abstraction, how `etcd`, `prometheus`, and other large code bases coordinate on done/quit channels, what the runtime does at allocation time (`zerobase`), and how lint tools sometimes mistake compile-time-only empty struct fields for unused code.

---

## 2. Source-Level Catalog

### 2.1 `runtime/malloc.go` — `zerobase`

The runtime declares a global byte used as the address for every zero-size allocation:

```go
// from src/runtime/malloc.go
// base address for all 0-byte allocations
var zerobase uintptr
```

Inside `mallocgc`:

```go
if size == 0 {
    return unsafe.Pointer(&zerobase)
}
```

Path: `src/runtime/malloc.go`. Relevant in any analysis of pointer identity, escape behaviour, or allocation profiling that involves zero-size types.

### 2.2 `runtime/runtime.go`

`zerobase` is also referenced via `//go:linkname` in tests and tooling:

Path: `src/runtime/runtime.go` (and adjacent files in the runtime package).

### 2.3 `context/context.go` — Done Channels

The `context` package uses `chan struct{}` as the foundational signal:

```go
// from src/context/context.go (cancelCtx)
type cancelCtx struct {
    Context
    mu       sync.Mutex
    done     atomic.Value          // of chan struct{}, created lazily
    children map[canceler]struct{} // a set of children
    err      error
    cause    error
}
```

Two empty-struct idioms appear at once:
- `done` is `chan struct{}` — the cancellation signal.
- `children` is `map[canceler]struct{}` — a set of child contexts.

The `cancel` method calls `close(c.done)` after switching state under the mutex. Receivers on `ctx.Done()` then unblock simultaneously. This is the canonical broadcast-cancellation implementation in Go.

Path: `src/context/context.go`.

### 2.4 `io.Discard`

```go
// from src/io/io.go
type discard struct{}

// discard implements ReaderFrom as an optimization so Copy to
// io.Discard can avoid doing unnecessary work.
var _ ReaderFrom = discard{}

func (discard) Write(p []byte) (int, error)            { return len(p), nil }
func (discard) WriteString(s string) (int, error)      { return len(s), nil }
func (discard) ReadFrom(r Reader) (n int64, err error) { /* ... */ }

var Discard Writer = discard{}
```

`io.Discard` is the textbook example of a method-only empty-struct type used to satisfy `io.Writer`.

Path: `src/io/io.go`.

### 2.5 `runtime/chan.go` — Channel Implementation

The runtime channel header `hchan` includes element size and type metadata:

```go
type hchan struct {
    qcount   uint
    dataqsiz uint
    buf      unsafe.Pointer
    elemsize uint16
    closed   uint32
    elemtype *_type
    /* ... */
}
```

When `elemtype` describes `struct{}`, `elemsize == 0` and the element copy in `chansend`/`chanrecv` short-circuits. Path: `src/runtime/chan.go`.

### 2.6 Standard Library `chan struct{}` Usage

Greppable patterns in `src/`:

- `src/net/http/server.go` — `doneChan chan struct{}` for connection idle/quiesce.
- `src/net/http/transport.go` — `closech chan struct{}` for per-connection close signal.
- `src/sync/cond.go` — internal wait nodes use `chan struct{}` for one-shot wake.
- `src/runtime/sema.go` — semaphore wait nodes coordinate via zero-size signals.
- `src/database/sql/sql.go` — multiple `done chan struct{}` for connection lifecycle.
- `src/os/exec/exec.go` — `Process.done` is `chan struct{}` closed on process exit.

A `grep -nR "chan struct{}" src/` in the Go source returns hundreds of hits.

### 2.7 `crypto/tls` Set Patterns

```go
// from src/crypto/tls (illustrative)
extensions := map[uint16]struct{}{}
```

The TLS handshake uses small allowed-extension sets backed by `map[uint16]struct{}`.

Path: various files under `src/crypto/tls/`.

### 2.8 `cmd/compile` Internal Sets

The compiler itself uses `map[*ir.Name]struct{}` and similar throughout `src/cmd/compile/internal/`. Examples include scope-tracking and reachability analysis.

Path: `src/cmd/compile/internal/escape/` and `src/cmd/compile/internal/inline/`.

---

## 3. Kubernetes — `sets.Set[T]`

Kubernetes ships a generic Set type built on `map[T]struct{}`:

```go
// from k8s.io/apimachinery/pkg/util/sets/set.go
type Set[T comparable] map[T]Empty

type Empty struct{}

func New[T comparable](items ...T) Set[T] {
    ss := make(Set[T], len(items))
    ss.Insert(items...)
    return ss
}

func (s Set[T]) Insert(items ...T) Set[T] {
    for _, item := range items {
        s[item] = Empty{}
    }
    return s
}
```

Path: `staging/src/k8s.io/apimachinery/pkg/util/sets/set.go` in the kubernetes/kubernetes repository.

The `Empty` type is an exported empty struct. By giving it a name the package documents intent ("empty value for a set") and lets other modules reuse the same type. The implementation also defines string/int specialised sets in the same package for older Go versions that lacked generics.

Kubernetes uses `sets.Set[string]` extensively for things like:
- Allowed admission plugin names
- Tracked resource names
- Affinity/anti-affinity selectors
- Valid feature gate names

---

## 4. etcd, Prometheus, and Other Large Bases

### 4.1 etcd

`go.etcd.io/etcd/server/v3/etcdserver` and friends use `chan struct{}` extensively for shutdown:
- `stopc chan struct{}`
- `done chan struct{}`
- `readych chan struct{}`

Sets such as known-member maps appear as `map[types.ID]struct{}` to track active peers without per-entry payload.

### 4.2 Prometheus

`prometheus/prometheus/scrape` and `prometheus/prometheus/discovery` use `chan struct{}` for cancellation signals across the long-running scrape goroutines. Active target tracking uses `map[*Target]struct{}`.

### 4.3 `golang.org/x/tools`

The `go/analysis` framework and the source-code walkers under `golang.org/x/tools/go/ast/inspector` use `map[ast.Node]struct{}` for visited-node tracking and `chan struct{}` for cancellation across analysis passes.

### 4.4 `cockroachdb/cockroach`

CockroachDB's KV layer uses `map[roachpb.RangeID]struct{}` for per-range follower-read sets and `chan struct{}` quit signals on every long-running goroutine.

---

## 5. Review Checklist

When reviewing code that uses the empty struct, verify:

1. **Sets**: is `map[K]struct{}` used where only membership matters? If `bool` shows up, is `false` ever set? If not, switch to `struct{}`.
2. **Signal channels**: is the channel `chan struct{}`? If it carries data, can the data be removed?
3. **Close vs send**: for one-shot broadcast, is `close(ch)` used? Sends on broadcast channels are usually a smell.
4. **Idempotent close**: is `sync.Once` used if multiple paths can close the channel?
5. **Done channel exposure**: is the channel exposed only as `<-chan struct{}` (read-only) so callers cannot close it?
6. **Trailing zero-size field**: scan structs for `_ struct{}` or named empty-struct fields at the end. Either remove or move earlier.
7. **Pointer identity**: any `==` between `*struct{}` values is suspect.
8. **Lint suppression**: are empty-struct fields used purely for compile-time interface assertions exempt from `unused`/`structcheck`?
9. **API design**: does the package export an `Empty struct{}` type, or use anonymous `struct{}`?
10. **Generic Set type**: in a codebase with Go 1.18+, prefer one canonical generic Set rather than a per-element-type map.

---

## 6. Lint Considerations

### 6.1 `unused`/`structcheck` False Positives

Linters like `staticcheck`'s `U1000` and `golangci-lint`'s `structcheck` may flag empty-struct fields used only for interface satisfaction:

```go
type api struct {
    _ struct{} // intentional: forbids comparison and forces named-field initialisation
}
```

This pattern (a leading `_` zero-size field used to disallow positional struct literals) trips linters. Suppress with `//nolint:unused` or by using a non-empty unexported field.

### 6.2 `gocritic` Type-Assertion Warnings

`gocritic` may suggest replacing `map[K]struct{}` with `map[K]bool` for "readability". Configure to ignore this rule in projects where the empty-struct idiom is established.

### 6.3 `go vet`

`go vet` does not flag empty-struct usage. It does flag `chan struct{}` mistakes only when they take a different shape (e.g., copying a Cond by value).

### 6.4 `staticcheck SA1029`

Not directly related — but neighbouring checks like `SA1019` (deprecated APIs) and `SA1029` (composite-literal types) sometimes interact with marker structs used as `context.Value` keys.

---

## 7. API Design Decisions

### 7.1 Exporting an `Empty struct{}` Type

Pros:
- Self-documenting in the API: `sets.Empty` reads better than `struct{}`.
- Reusable across packages.
- Cleaner test code: `sets.Empty{}` instead of `struct{}{}`.

Cons:
- Adds a dependency on a tiny type.
- Breaks the principle "the smallest API is no API".

Kubernetes opted for the named type. The Go standard library opted for anonymous `struct{}` everywhere. Both are defensible.

### 7.2 Hiding Channels Behind Methods

```go
type Cancel struct {
    once sync.Once
    ch   chan struct{}
}

func (c *Cancel) Done() <-chan struct{} { return c.ch }
func (c *Cancel) Fire()                 { c.once.Do(func() { close(c.ch) }) }
```

The struct hides:
- The fact the channel is `chan struct{}`.
- Idempotency of close.
- Ownership of the channel reference.

Callers see a `Done()` method returning `<-chan struct{}` — they cannot close it, only wait on it. This is the API shape Go's `context.Context` exposes.

### 7.3 Generic Set vs Specialised Set

```go
type IntSet map[int]struct{}     // specialised
type Set[T comparable] map[T]struct{} // generic
```

The generic version reduces duplication. The specialised version keeps types simple in pre-generics code. Modern code (Go 1.18+) should prefer the generic version unless a specialised one offers extra methods.

---

## 8. Build, Vet, and Test Notes

### 8.1 `go vet -unreachable`

Code that closes a channel and then sends — only reachable in panic paths — may be flagged. Empty-struct send-after-close is the most common origin.

### 8.2 `go test -race`

Concurrent close paths without `sync.Once` show up as `WARNING: DATA RACE` when multiple goroutines call `close` simultaneously. The race detector covers the overlap; even without overlap, the panic is deterministic.

### 8.3 `go test -bench`

Comparing `map[K]struct{}` against `map[K]bool` in the same benchmark suite reveals 5-10% per-op gains and similar memory savings.

### 8.4 `go build -gcflags="-m"`

Empty-struct values do not show up as escapes because they have no storage. But `chan struct{}` itself, when allocated by `make`, escapes when stored in a long-lived struct.

---

## 9. Operational Considerations

### 9.1 Memory Profiling

`pprof -alloc_objects` and `pprof -inuse_objects` count allocations. Empty-struct values do not show up — they are not allocations from the heap. Map and channel headers do show up.

### 9.2 Goroutine Profiling

A long-lived `chan struct{}` with many blocked readers shows up in goroutine profiles as N goroutines blocked on `runtime.chanrecv`. After `close` they unblock.

### 9.3 Telemetry

Metric labels are often kept in `map[label]struct{}` to dedupe. Cardinality control is the same as for any map.

---

## 10. Migration Patterns

### 10.1 `map[K]bool` → `map[K]struct{}`

Steps:
1. Find all writes setting `false`. If none exist, the type is presence-only.
2. Replace `m[k] = true` with `m[k] = struct{}{}`.
3. Replace `if m[k] { ... }` with `if _, ok := m[k]; ok { ... }`.
4. Verify no caller relied on the bool's value.

If `false` is ever written, leave the bool — its presence carries information beyond membership.

### 10.2 Buffered Capacity-1 → `close`-Broadcast

Steps:
1. Identify the consumer pattern. If it is a single one-shot waiter, the buffered ping is fine but unidiomatic.
2. If multiple consumers wait, switch to `close(chan struct{})` and wrap with `sync.Once`.
3. Remove the buffered notify; consumers now block on `<-done`.

### 10.3 Adding Method-Only Implementation

Steps:
1. Identify an interface with two-three methods used by callers.
2. Create `type X struct{}` and methods that satisfy the interface.
3. Export a single instance (`var Default X`) or rely on `X{}` being the only reasonable value.
4. Document statelessness.

---

## 11. References

- [`runtime/malloc.go` (zerobase)](https://cs.opensource.google/go/go/+/refs/heads/master:src/runtime/malloc.go)
- [`runtime/chan.go` (chan implementation)](https://cs.opensource.google/go/go/+/refs/heads/master:src/runtime/chan.go)
- [`context/context.go` (done channel)](https://cs.opensource.google/go/go/+/refs/heads/master:src/context/context.go)
- [`io/io.go` (`io.Discard`)](https://cs.opensource.google/go/go/+/refs/heads/master:src/io/io.go)
- [Kubernetes `sets.Set`](https://github.com/kubernetes/kubernetes/blob/master/staging/src/k8s.io/apimachinery/pkg/util/sets/set.go)
- [etcd server/v3/etcdserver — done/stopc channels](https://github.com/etcd-io/etcd)
- [Prometheus discovery and scrape — quit channels](https://github.com/prometheus/prometheus)
- [`golang.org/x/tools/go/ast/inspector`](https://pkg.go.dev/golang.org/x/tools/go/ast/inspector)
- [Dave Cheney — The empty struct](https://dave.cheney.net/2014/03/25/the-empty-struct)
- [Go Spec — Size and alignment guarantees](https://go.dev/ref/spec#Size_and_alignment_guarantees)

---

## 12. Self-Assessment Checklist

- [ ] I have read `runtime/malloc.go` and located `zerobase`
- [ ] I can cite `context.cancelCtx` as an example of `chan struct{}` cancellation
- [ ] I can cite `io.Discard` as an example of method-only empty struct
- [ ] I can cite Kubernetes `sets.Set` as the canonical generic-set pattern
- [ ] I review `chan struct{}` channels for `close`-not-`send` correctness
- [ ] I review structs for trailing zero-size fields
- [ ] I configure linters to permit zero-size compile-time-assertion fields
- [ ] I prefer hiding `chan struct{}` behind a named type with `Done()`/`Fire()`
