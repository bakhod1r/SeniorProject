---
layout: default
title: Specification
parent: Concurrent Counters
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/06-concurrent-counters/specification/
---

# Concurrent Counters — Specification

This file collects the formal contracts and specification language for the primitives used to build concurrent counters in Go: `sync/atomic`, `expvar`, the Go memory model, and the third-party `hdrhistogram-go`.

## Table of Contents
1. [Go Memory Model — Atomic Operations](#go-memory-model--atomic-operations)
2. [`sync/atomic` Package API](#syncatomic-package-api)
3. [Typed Atomic Wrappers (Go 1.19+)](#typed-atomic-wrappers-go-119)
4. [Alignment Requirements](#alignment-requirements)
5. [`expvar` Package API](#expvar-package-api)
6. [`runtime/metrics` Counter Contract](#runtimemetrics-counter-contract)
7. [HDR Histogram Library Contract](#hdr-histogram-library-contract)
8. [Prometheus Counter Contract](#prometheus-counter-contract)
9. [`go:linkname` Stability Contract](#golinkname-stability-contract)
10. [Race Detector Guarantees](#race-detector-guarantees)
11. [Relevant Go Spec Excerpts](#relevant-go-spec-excerpts)
12. [Operational Semantics Summary](#operational-semantics-summary)

---

## Go Memory Model — Atomic Operations

From <https://go.dev/ref/mem>:

> The APIs in the `sync/atomic` package are collectively "atomic operations" that can be used to synchronize the execution of different goroutines. If the effect of an atomic operation A is observed by atomic operation B, then A is synchronized before B. All the atomic operations executed in a program behave as though executed in some sequentially consistent order.

Key consequences:

- All `sync/atomic` operations on the *same* variable are totally ordered.
- A `Load` that observes the result of a `Store` (or `Add`, `Swap`, etc.) "synchronizes before" — meaning all writes before the Store are visible to all reads after the Load.
- The Go memory model upgrades atomics to sequential consistency; weaker orderings (relaxed, acquire-release-only) are not exposed.

This is stronger than C++ or Rust's atomics, which allow per-operation memory order specification. Go's choice favours simplicity and correctness.

## `sync/atomic` Package API

### Package-level functions (pre-Go 1.19)

For each type `T ∈ {int32, int64, uint32, uint64, uintptr, unsafe.Pointer}`:

```
func AddT(addr *T, delta T) (new T)
func CompareAndSwapT(addr *T, old, new T) (swapped bool)
func LoadT(addr *T) (val T)
func StoreT(addr *T, val T)
func SwapT(addr *T, new T) (old T)
```

For `unsafe.Pointer`, there is no `Add` (no integer addition on pointers).

Contract: each function is one atomic operation as defined by the memory model. There is no separate `LoadAcquire` / `StoreRelease`; all operations are sequentially consistent.

### Type signatures (canonical)

```go
func AddInt32(addr *int32, delta int32) (new int32)
func AddInt64(addr *int64, delta int64) (new int64)
func AddUint32(addr *uint32, delta uint32) (new uint32)
func AddUint64(addr *uint64, delta uint64) (new uint64)
func AddUintptr(addr *uintptr, delta uintptr) (new uintptr)

func CompareAndSwapInt32(addr *int32, old, new int32) (swapped bool)
func CompareAndSwapInt64(addr *int64, old, new int64) (swapped bool)
// ... similar for Uint32, Uint64, Uintptr, Pointer

func LoadInt32(addr *int32) (val int32)
// ... similar for other types

func StoreInt32(addr *int32, val int32)
// ... similar

func SwapInt32(addr *int32, new int32) (old int32)
// ... similar
```

## Typed Atomic Wrappers (Go 1.19+)

```go
type Int32  struct { /* unexported */ }
type Int64  struct { /* unexported */ }
type Uint32 struct { /* unexported */ }
type Uint64 struct { /* unexported */ }
type Uintptr struct { /* unexported */ }
type Bool struct { /* unexported */ }
type Pointer[T any] struct { /* unexported */ }
```

Methods on each (parameterized by T):

```go
func (x *T) Add(delta T) (new T)               // not on Bool, Pointer
func (x *T) CompareAndSwap(old, new T) (bool)
func (x *T) Load() T
func (x *T) Store(val T)
func (x *T) Swap(new T) (old T)
```

`Bool` has `Load`, `Store`, `Swap`, `CompareAndSwap` but no `Add`.

`Pointer[T]` has `Load`, `Store`, `Swap`, `CompareAndSwap` but no `Add`.

`Int32` / `Int64` `Add` accepts a signed delta; negative values subtract.

### Zero values

All typed atomics' zero values are usable. `var x atomic.Int64` is a counter at zero.

### Copy semantics

Typed atomics contain a `noCopy` marker. Copying them is a vet-detected error:

```go
var a atomic.Int64
b := a // go vet: "assignment copies lock value to b: sync/atomic.Int64"
```

The actual contents would be a fresh atomic, so copying does not race — but using both copies as one logical counter would be a bug.

## Alignment Requirements

From the package docs:

> On ARM, 386, and 32-bit MIPS, it is the caller's responsibility to arrange for 64-bit alignment of 64-bit words accessed atomically. The first word in a variable or in an allocated struct, array, or slice can be relied upon to be 64-bit aligned.

This applies to the *function-style* API (`AddInt64`, etc.). The typed wrappers (`atomic.Int64` etc.) handle alignment internally with a hidden alignment-forcing field.

Practical implication: on Go 1.19+ you can put `atomic.Int64` anywhere in a struct on any platform. The old `int64` + `atomic.AddInt64(&x, ...)` pattern requires placing the field at an aligned offset on 32-bit ARM.

## `expvar` Package API

From <https://pkg.go.dev/expvar>:

> Package expvar provides a standardized interface to public variables, such as operation counters in servers. It exposes these variables via HTTP at /debug/vars in JSON format.

### Var interface

```go
type Var interface {
    String() string
}
```

### Concrete types

```go
type Int struct { /* unexported atomic.Int64 */ }
func (v *Int) Value() int64
func (v *Int) String() string
func (v *Int) Add(delta int64)
func (v *Int) Set(value int64)

type Float struct { /* unexported atomic.Uint64 for float64 bits */ }
func (v *Float) Value() float64
func (v *Float) String() string
func (v *Float) Add(delta float64) // CAS loop
func (v *Float) Set(value float64)

type String struct { /* mutex-protected */ }
func (v *String) Value() string
func (v *String) String() string
func (v *String) Set(value string)

type Map struct { /* internal sync.Map + keys slice */ }
func (v *Map) Get(key string) Var
func (v *Map) Set(key string, av Var)
func (v *Map) Add(key string, delta int64)
func (v *Map) AddFloat(key string, delta float64)
func (v *Map) Delete(key string)
func (v *Map) Do(f func(KeyValue))
func (v *Map) Init() *Map
func (v *Map) String() string

type Func func() any
func (f Func) Value() any
func (f Func) String() string
```

### Registration

```go
func NewInt(name string) *Int       // panics if name exists
func NewFloat(name string) *Float
func NewString(name string) *String
func NewMap(name string) *Map
func Publish(name string, v Var)    // panics if name exists
func Get(name string) Var
func Do(f func(KeyValue))           // iterate all registered
```

### HTTP handler

`/debug/vars` is automatically registered on `http.DefaultServeMux` when `expvar` is imported. Returns JSON.

`Handler()` returns the same handler explicitly, for use with custom muxes.

## `runtime/metrics` Counter Contract

From <https://pkg.go.dev/runtime/metrics>:

> Package metrics provides a stable interface to access implementation-defined metrics exported by the Go runtime.

### Types

```go
type Description struct {
    Name        string
    Description string
    Kind        ValueKind
    Cumulative  bool
}

type Sample struct {
    Name  string
    Value Value
}

type Value struct { /* unexported */ }
func (v Value) Kind() ValueKind
func (v Value) Uint64() uint64
func (v Value) Float64() float64
func (v Value) Float64Histogram() *Float64Histogram

type Float64Histogram struct {
    Counts  []uint64
    Buckets []float64
}
```

### Functions

```go
func All() []Description
func Read(samples []Sample)
```

### Stability

Metric names follow the pattern `/path/to/metric:unit`. The runtime may add new metrics; existing metrics may be deprecated but not removed without a major version transition. Metric stability is part of Go's compatibility guarantee.

## HDR Histogram Library Contract

From `github.com/HdrHistogram/hdrhistogram-go`:

```go
type Histogram struct { /* unexported */ }

func New(minValue, maxValue int64, sigDigits int) *Histogram

func (h *Histogram) RecordValue(v int64) error
func (h *Histogram) RecordValueWithExpectedInterval(v, expectedInterval int64) error
func (h *Histogram) RecordValues(v, count int64) error

func (h *Histogram) TotalCount() int64
func (h *Histogram) Min() int64
func (h *Histogram) Max() int64
func (h *Histogram) Mean() float64
func (h *Histogram) StdDev() float64
func (h *Histogram) ValueAtQuantile(q float64) int64
func (h *Histogram) ValueAtPercentile(p float64) int64

func (h *Histogram) Merge(other *Histogram) error
func (h *Histogram) Reset()
func (h *Histogram) Snapshot() *Snapshot
```

### Thread safety

The library is *not* thread-safe for `RecordValue` from multiple goroutines. Wrap with mutex, shard, or perform atomic operations on the internal count slice (advanced).

### Error returns

`RecordValue` returns an error if `v < lowestTrackableValue` or `v > highestTrackableValue`. Most code ignores the error and accepts the implicit clamp.

`Merge` returns an error if the histograms have incompatible parameters.

## Prometheus Counter Contract

From `github.com/prometheus/client_golang/prometheus`:

```go
type Counter interface {
    Metric
    Collector
    Inc()
    Add(float64)
}

type CounterFunc interface {
    Metric
    Collector
}

func NewCounter(opts CounterOpts) Counter
func NewCounterFunc(opts CounterOpts, function func() float64) CounterFunc
func NewCounterVec(opts CounterOpts, labelNames []string) *CounterVec
```

### Contract

- Counters are monotonically increasing.
- `Inc` adds 1; `Add(x)` adds x. `x` must be >= 0; negative panics.
- `Reset()` is not part of the standard interface (Prometheus discourages resets).
- Internally, atomic float64 (via uint64 bits + CAS loop).

### CounterVec

`CounterVec.WithLabelValues(values...)` returns a `Counter` for the given label values. Allocates on first use; cached subsequently.

## `go:linkname` Stability Contract

From the Go authors' historical position:

> `//go:linkname` is intended for use within the standard library and runtime. Third-party use is technically possible but not supported. Functions accessed via linkname may be renamed, removed, or have their behaviour changed in future Go versions.

In practice, several private runtime functions (`runtime.procPin`, `runtime.fastrand`, etc.) are accessed via linkname by widely-used libraries (`sync.Pool`, third-party metric libraries). The Go team has historically maintained these signatures to avoid breaking the ecosystem.

When using linkname for counter sharding:

- Pin your Go version in CI.
- Run integration tests against new Go versions before adopting.
- Have a fallback (non-linkname) path.

## Race Detector Guarantees

From <https://go.dev/doc/articles/race_detector>:

> The race detector is integrated with the Go toolchain. Pass `-race` to `go test`, `go run`, `go build`, or `go install`.

### Sound but not complete

- Every race reported by `-race` is a real race.
- Some races may not be reported if the particular execution did not exercise them.

### Cost

- Memory: ~5-10× increase.
- CPU: ~2-20× slowdown.
- Use in tests and CI, not in production.

### Atomic operations

The race detector treats `sync/atomic` operations as synchronisation points. Non-atomic accesses to a variable that has been accessed atomically by another goroutine are flagged as races.

## Relevant Go Spec Excerpts

From the Go language specification:

### `for` statement (relevant to atomic-in-loop)

> A "for" statement specifies repeated execution of a block. Three forms exist...

CAS loops use the third form (`for { ... }`) with `break` or `return` to exit.

### Pointer indirection

> For an operand x of pointer type *T, the pointer indirection *x denotes the variable of type T pointed to by x.

`atomic.AddInt64(&x, 1)` passes `&x` which is `*int64`; the function indirects to the variable.

### Method receivers

> A method set determines the interfaces that the type implements... The method set of a pointer type *T consists of all methods declared with receiver *T or T.

Atomic methods are pointer-receiver: `func (x *Int64) Add(delta int64) int64`. Calling on a value would be a compile error (you must take the address).

## Operational Semantics Summary

| Operation | Semantics |
|-----------|-----------|
| `c.Add(1)` | Atomic increment by 1; returns new value |
| `c.Add(-1)` | Atomic decrement by 1; returns new value |
| `c.Load()` | Atomic read; returns current value |
| `c.Store(0)` | Atomic write; replaces current value |
| `c.Swap(0)` | Atomic read-and-write; returns previous value |
| `c.CompareAndSwap(old, new)` | If current == old, set to new and return true; else return false |

All operations are sequentially consistent. All atomic operations on the same variable are totally ordered.

Compile-time guarantees:

- `atomic.Int64` cannot be used as a plain `int64` (no `++`, no arithmetic).
- Copying `atomic.Int64` is flagged by `go vet`.
- Alignment is enforced for typed wrappers.

Runtime guarantees:

- No torn reads or writes (atomic ops are indivisible).
- Visibility: every `Load` sees every prior `Store`/`Add`/`Swap` in the global atomic order.
- No memory ordering surprises (all operations are sequentially consistent).

Operational guarantees:

- Atomic operations never block at the goroutine level (no goroutine parking).
- They may stall briefly at the hardware level (cache coherence traffic).
- Throughput per core depends on contention; uncontended is fast, contended bouncing is slow.

This is the contract. The rest of the documentation builds on it.

---

## Appendix: Common Specification Gotchas

### `expvar.Int.Set` is not atomic with `Add`

`Set(x)` is `atomic.Store`; `Add(y)` is `atomic.Add`. Combining them produces ordered-but-not-grouped semantics — two concurrent `Set(0)` and `Add(1)` calls produce either 0 or 1 in the end, not "atomically reset and add".

For "reset and resume", use `Swap(0)` on the underlying `atomic.Int64`.

### `expvar.Map.Get` returns a `Var` interface

The concrete type may be `*Int`, `*Float`, `*String`, etc. Type-assert before using:

```go
if v, ok := m.Get("requests").(*expvar.Int); ok {
    v.Add(1)
}
```

### `atomic.Pointer[T]` can be nil

`Load()` returns the pointer; if never `Store`d, returns nil. Always check:

```go
s := snap.Load()
if s == nil {
    s = &defaultSnapshot
}
```

### `atomic.Uint64.Add` overflow

Adding to a `uint64` near max wraps around. For monotonic counters this is theoretical (~292 years at 1 GHz). For derived calculations (subtraction), wraparound can produce gigantic positive values.

### Histogram bucket boundaries

HDR's bucket layout means bucket boundaries are not at "round" values. `ValueAtQuantile(99)` returns "the smallest value at the bottom of the bucket containing the 99th percentile observation". The true 99th percentile is somewhere inside that bucket, with bounded relative error.

### `runtime/metrics` histogram bucket order

`Float64Histogram.Buckets` is the bucket boundary array. `Counts[i]` is the count in bucket `[Buckets[i], Buckets[i+1])`. The last bucket extends to +Inf.

### `go:linkname` and inlining

The Go compiler may inline `procPin` and `procUnpin`. The linkname-declared function still works, but the runtime can change the inlining strategy without notice. Performance-critical code should benchmark across Go versions.

### `runtime.GOMAXPROCS(0)` is the *current* limit

`runtime.GOMAXPROCS(n)` with `n > 0` sets the limit; with `n == 0` it returns the current value without changing it. For sizing per-P counter arrays, use `GOMAXPROCS(0)` at counter construction time. If the limit changes later, the counter array does not auto-resize.

### `atomic.Int64.Add(0)`

A no-op? Almost — the result is the current value. Useful for a memory fence: synchronises before subsequent atomic operations.

### Compare-and-swap on `atomic.Int64` with equal values

`CompareAndSwap(x, x)` always succeeds (no-op, but spends an atomic operation). Useful for a memory fence.

---

## Appendix: Where to Find Authoritative Sources

- Go memory model: <https://go.dev/ref/mem>
- `sync/atomic` package: <https://pkg.go.dev/sync/atomic>
- `expvar` package: <https://pkg.go.dev/expvar>
- `runtime/metrics`: <https://pkg.go.dev/runtime/metrics>
- HdrHistogram-go: <https://github.com/HdrHistogram/hdrhistogram-go>
- Prometheus client_golang: <https://pkg.go.dev/github.com/prometheus/client_golang/prometheus>
- OpenMetrics specification: <https://openmetrics.io>
- OpenTelemetry metrics SDK: <https://opentelemetry.io/docs/specs/otel/metrics/>

When in doubt, consult these. The Go documentation is the source of truth for the standard library; the third-party docs are the truth for their respective libraries.

---

## Appendix: Specification Changes to Watch

Things that could change in future Go releases:

- New atomic types (e.g., `atomic.Float64`, currently absent).
- Weaker memory ordering options (relaxed, acquire-release-only).
- Built-in cache-line padding type in the standard library.
- Per-P counter primitive in the standard library.
- HDR-style histogram in `runtime/metrics`.

These are speculative. The current contract is stable; assume what is true today is true tomorrow.

---

## Appendix: Beyond Specification — Idiomatic Usage

Specification tells you what is allowed. Idiom tells you what is expected.

- Prefer typed `atomic.Int64` over `atomic.AddInt64(&x, 1)` in new code.
- Prefer `atomic.Pointer[T]` over `atomic.Value` in new code.
- Prefer `expvar.Func` over `expvar.Int` for derived metrics.
- Prefer per-route counters over a single global with route as label, *if* cardinality is unbounded.
- Prefer `math/rand/v2` over `math/rand` for shard selection.

Following idiom makes your code immediately readable to other Go engineers.

---

## End of Specification

The specification is fixed; the idioms evolve.

Build on the specification. Adapt to the idioms.

---

## Appendix: Specification Comparisons Across Languages

For comparison with other languages' counter specifications:

### C++ `std::atomic<int64_t>`

```cpp
std::atomic<int64_t> c;
c.fetch_add(1, std::memory_order_relaxed); // relaxed
c.load(std::memory_order_acquire);          // acquire
c.store(0, std::memory_order_release);      // release
```

Per-operation memory order. More expressive; harder to get right.

### Java `AtomicLong`

```java
AtomicLong c = new AtomicLong();
c.incrementAndGet();   // returns new value
c.get();                // sequentially consistent
c.compareAndSet(old, new);
```

Sequentially consistent by default; lazy variants (`lazySet`) available for advanced use.

### Rust `std::sync::atomic::AtomicI64`

```rust
use std::sync::atomic::{AtomicI64, Ordering};
let c = AtomicI64::new(0);
c.fetch_add(1, Ordering::Relaxed);
c.load(Ordering::Acquire);
c.store(0, Ordering::Release);
```

Like C++, per-operation memory order.

### Go's choice

Sequentially consistent, no per-operation ordering, opinionated for simplicity. This is intentional: most engineers do not need acquire/release-only semantics, and getting them wrong is easy. Go provides the "always safe" option.

When you read C++/Rust counter code, mentally upgrade all the memory orders to `SeqCst`. Then it matches Go.

---

## Appendix: Where Specification Meets Reality

A specification is a contract. Reality is the implementation. Sometimes they differ:

### Spec: `atomic.Int64.Add` is one operation

Reality: on most architectures, yes. On older 32-bit ARM without LSE, it's a load-exclusive / store-exclusive retry loop. The atomicity is preserved; the cost is higher.

### Spec: atomic loads are ordered with prior stores

Reality: on x86-64, atomic loads compile to MOV (free). On ARM, they compile to LDAR (load-acquire). Both satisfy the spec; different costs.

### Spec: `expvar.Func` is evaluated at scrape time

Reality: yes, every scrape. If your `Func` does expensive computation, it dominates scrape time. Cache the result if needed.

### Spec: `runtime/metrics.Read` is "fast"

Reality: for cumulative metrics, near-zero. For histograms, the runtime must walk internal data structures — measurable but typically < 1 ms.

### Spec: HDR `RecordValue` is constant time

Reality: yes, ~30 ns regardless of histogram size. The constant is real.

Knowing where spec and reality diverge helps with performance analysis.

---

## Appendix: Specification Stability Promises

Things that will not change in the foreseeable future:

- `sync/atomic` API signatures (frozen since Go 1.0).
- Go memory model's sequential consistency for atomics (since Go 1.0).
- `expvar` package contract (since Go 1.0).
- `runtime/metrics` metric names (versioned but stable within a major Go release).
- HDR histogram algorithm (specified in research papers; library may refactor).

Things that may evolve:

- `atomic` typed wrappers (added in 1.19; may gain new types).
- `runtime/metrics` may add new metrics (additions are non-breaking).
- `go:linkname`-accessed private functions (no stability guarantee).
- HDR library API (versioned; v1 → v2 already happened in some ports).

When you build production systems, depend on the stable surface. Treat unstable APIs as best-effort.

---

## Specification: End

Engineers who treat the specification with respect produce code that lasts. Engineers who treat it as a suggestion produce code that breaks on every Go release.

Read the spec. Follow it. Internalize it. Then you are free to bend it consciously when needed.

End.


