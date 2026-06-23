# sync/atomic — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Go Memory Model and Atomics](#the-go-memory-model-and-atomics)
3. [Sequential Consistency](#sequential-consistency)
4. [Alignment Rules](#alignment-rules)
5. [The Full Operation Catalogue](#the-full-operation-catalogue)
6. [`atomic.Value` in Depth](#atomicvalue-in-depth)
7. [Atomic vs Mutex Decision Matrix](#atomic-vs-mutex-decision-matrix)
8. [CAS Loop Patterns](#cas-loop-patterns)
9. [The `And`/`Or` Operations (Go 1.23+)](#the-andor-operations-go-123)
10. [Benchmarks](#benchmarks)
11. [Race Detector Interaction](#race-detector-interaction)
12. [Common Bugs at the Middle Level](#common-bugs-at-the-middle-level)
13. [Summary](#summary)

---

## Introduction

At the middle level you stop using atomics as "the fast counter primitive" and start treating them as a primitive of the Go memory model. You understand that an atomic store does more than write a value — it establishes a happens-before relationship with subsequent atomic loads. You know which platforms require alignment and why `atomic.Int64` was added as a struct type. You can reason about why a CAS loop is appropriate and when `Add` is the better choice.

This document assumes you have read the junior file and have written atomic code in production. The depth here is "I need to defend this choice in code review."

---

## The Go Memory Model and Atomics

The Go memory model (https://go.dev/ref/mem) defines what reads can observe what writes. Without synchronisation, the rules are loose: a write by goroutine A may never become visible to goroutine B. With synchronisation, a *happens-before* edge is established.

For atomics, the rule (Go 1.19+) is:

> If the effect of an atomic operation A is observed by atomic operation B, then A is *synchronised before* B. Furthermore, all the atomic operations executed in a Go program behave as though executed in some sequentially consistent order.

In plain language:

- Atomic writes are visible to subsequent atomic reads.
- All atomic operations in the program, viewed globally, have a single total order that every goroutine agrees on.
- The total order is consistent with each goroutine's program order — within a single goroutine, atomic ops happen in source-code order.

This is **sequential consistency**, the strongest memory model commonly available. It is the same guarantee Java's `volatile` provides since Java 5, and what C++11's `memory_order_seq_cst` provides.

### What this means in practice

```go
var flag atomic.Bool
var data int

// goroutine A
data = 42
flag.Store(true)

// goroutine B
if flag.Load() {
    use(data) // guaranteed to see 42
}
```

The atomic store to `flag` in A is *synchronised before* the atomic load in B (when the load sees `true`). Everything A did *before* the atomic store, including the non-atomic write to `data`, is visible to B *after* the atomic load. The atomic store acts as a publication barrier.

This is the canonical "publish a value, then signal readiness" idiom. Without an atomic on `flag`, the compiler and CPU could reorder, and B could see `flag == true` but `data == 0`.

### What this does *not* mean

```go
var a, b atomic.Int64

// goroutine A
a.Store(1)
b.Store(1)

// goroutine B
if b.Load() == 1 && a.Load() == 0 {
    // impossible under sequential consistency
}
```

Under sequential consistency, all goroutines agree on the order of atomic ops. If B sees `b == 1`, then A's store to `b` happened, which means A's earlier store to `a` also happened, so B must see `a == 1`. Sequential consistency rules out this kind of "out-of-order observation."

Note: this guarantee is for *atomic* accesses. Non-atomic accesses interleaved with atomics get publication semantics only via the synchronised-before edges.

---

## Sequential Consistency

Pre-Go 1.19, the memory model for atomics was deliberately under-specified. The package documentation said "synchronisation primitives are provided by the `sync/atomic` package" and stopped there. Implementations were sequentially consistent in practice but not guaranteed by spec.

Go 1.19 clarified this: atomics are now guaranteed sequentially consistent. This matches Java and C++ `seq_cst`. It is the most predictable behaviour and the easiest to reason about — but also the most expensive for the hardware to provide.

### Cost of sequential consistency

On x86, sequential consistency is essentially free for stores and loads — x86 already provides total store order. The atomic store compiles to `MOV` with the `LOCK`-prefixed RMW operations as needed.

On ARM and other weak-memory-model platforms, sequential consistency requires explicit memory barriers (e.g., `DMB ISH` on ARM). Each atomic op pays for a barrier instruction. Still cheap (single-digit nanoseconds), but not free.

The Go compiler emits the right barriers per platform. You do not need to think about it — you just need to know that atomic ops are sequentially consistent, regardless of architecture.

### Why this matters for design

Sequential consistency means you can reason about atomic-using code by mentally interleaving operations as if they ran on a single CPU in some total order. This is much easier than the relaxed memory models that some lower-level languages expose (`memory_order_relaxed`, `acquire`, `release`). Go deliberately picks the predictable choice.

The trade-off: you cannot opt down to a cheaper memory ordering. C++ lets you say "this counter only needs relaxed ordering, no barrier needed." Go does not. The performance loss on weak architectures (ARM, POWER) is the price.

---

## Alignment Rules

A 64-bit atomic operation requires the target memory address to be **8-byte aligned** on most platforms. The CPU's atomic instructions cannot operate on misaligned 64-bit values.

On 64-bit platforms (amd64, arm64), the Go compiler automatically 8-byte-aligns all 64-bit values. You never see a problem.

On 32-bit platforms (386, arm, mips), 64-bit values in structs may end up 4-byte aligned. Calling `atomic.AddInt64(&s.field, 1)` on such a misaligned address **crashes the program** with:

```
unaligned 64-bit atomic operation
```

### The historical fix: place 64-bit fields first

```go
type S struct {
    count int64    // first field — always 8-byte aligned
    flag  int32
}
```

By language rules, the first field of a struct is aligned to the alignment of the largest field. Putting the 64-bit field first forces 8-byte alignment for the struct, which propagates if the struct is allocated as a top-level variable.

This works but is fragile. If someone reorders fields ("more readable that way") the program crashes on 32-bit platforms. The reliable fix is the Go 1.19 typed API.

### The Go 1.19 fix: `atomic.Int64` is a struct

```go
type S struct {
    flag  int32
    count atomic.Int64   // works on every platform
}
```

`atomic.Int64` is a struct type. Its definition (in `sync/atomic/types.go`) is:

```go
type Int64 struct {
    _ noCopy
    _ align64
    v int64
}
```

The `align64` marker is a zero-sized type that the compiler uses as a hint to 8-byte-align the containing struct. The result: `atomic.Int64` always has correct alignment, even on 32-bit platforms, even as the second field of a struct.

For new code, this means you never have to think about alignment. Use `atomic.Int64`, `atomic.Uint64`, `atomic.Pointer[T]` — they are aligned for you.

### Why not auto-align the legacy API?

The legacy API takes a `*int64`. The compiler cannot know that the caller intends to use it atomically; it cannot retroactively change alignment. The typed API encapsulates the variable in a struct, which the compiler controls.

### Checking alignment

```go
import (
    "fmt"
    "unsafe"
)

type S struct {
    a int32
    b int64
}

func main() {
    s := &S{}
    fmt.Println("offset of b:", unsafe.Offsetof(s.b)) // 8 on 64-bit, may be 4 on 32-bit
}
```

If `unsafe.Offsetof(s.b)` is not a multiple of 8 on a 32-bit platform, calling `atomic.AddInt64(&s.b, 1)` will crash.

---

## The Full Operation Catalogue

The Go 1.19 typed atomic types are:

| Type | Underlying | Operations |
|---|---|---|
| `atomic.Bool` | uint32 | Load, Store, Swap, CompareAndSwap |
| `atomic.Int32` | int32 | Load, Store, Add, Swap, CompareAndSwap, (And, Or in 1.23+) |
| `atomic.Int64` | int64 | Load, Store, Add, Swap, CompareAndSwap, (And, Or in 1.23+) |
| `atomic.Uint32` | uint32 | Load, Store, Add, Swap, CompareAndSwap, (And, Or in 1.23+) |
| `atomic.Uint64` | uint64 | Load, Store, Add, Swap, CompareAndSwap, (And, Or in 1.23+) |
| `atomic.Uintptr` | uintptr | Load, Store, Add, Swap, CompareAndSwap |
| `atomic.Pointer[T]` | *T | Load, Store, Swap, CompareAndSwap |
| `atomic.Value` | interface{} | Load, Store, Swap, CompareAndSwap |

Note: `Bool`, `Pointer[T]`, and `Value` have no `Add` — addition is not meaningful for those types.

The legacy free-function API mirrors this for `int32`, `int64`, `uint32`, `uint64`, `uintptr`, and `unsafe.Pointer`:

```go
atomic.LoadInt64(&x), atomic.StoreInt64(&x, v),
atomic.AddInt64(&x, delta),
atomic.SwapInt64(&x, v),
atomic.CompareAndSwapInt64(&x, old, new)
```

Plus pointer atomics that take `*unsafe.Pointer`:

```go
atomic.LoadPointer(addr *unsafe.Pointer) unsafe.Pointer
atomic.StorePointer(addr *unsafe.Pointer, val unsafe.Pointer)
atomic.SwapPointer(addr *unsafe.Pointer, new unsafe.Pointer) unsafe.Pointer
atomic.CompareAndSwapPointer(addr *unsafe.Pointer, old, new unsafe.Pointer) bool
```

The legacy pointer API requires `unsafe.Pointer` conversions, which is ugly and unsafe (no pun intended). `atomic.Pointer[T]` is the modern replacement.

---

## `atomic.Value` in Depth

`atomic.Value` predates generics. It is a container for any single Go value, with `Load`/`Store`/`Swap`/`CompareAndSwap` operations. The constraint: every `Store` must use the same concrete type.

```go
var v atomic.Value
v.Store(42)             // first store: type fixed as int
v.Store(99)             // OK — same type
v.Store("hello")        // panic: "store of inconsistently typed value"
```

The runtime enforces type consistency via a tagged interface representation. The first non-nil `Store` records the type. Every subsequent `Store` checks the type and panics on mismatch.

### Copy-on-write configuration

The flagship use case for `atomic.Value` is hot-reloadable immutable configuration:

```go
type Config struct {
    Endpoints []string
    Timeout   time.Duration
    APIKey    string
}

var current atomic.Value // holds Config

func reload(c Config) {
    current.Store(c) // atomic publish
}

func handle() {
    cfg := current.Load().(Config)
    // cfg is a stable snapshot for this handler
    use(cfg.Endpoints, cfg.Timeout)
}
```

Readers never block. Writers replace the entire struct. No mutation after `Store` — always build a new `Config`.

### `atomic.Value.Store(nil)`

```go
v.Store(nil) // panic
```

`atomic.Value` cannot hold a `nil` value directly — the runtime needs a non-nil interface to record the type. Workaround: store a typed `nil` pointer, e.g., `(*Config)(nil)`.

```go
var v atomic.Value
v.Store((*Config)(nil)) // OK — typed nil pointer
```

The Go 1.17+ `CompareAndSwap` method on `atomic.Value` does allow `nil` in CAS arguments under certain conditions, but the safer pattern is to store a typed pointer and use the `nil` sentinel.

### `atomic.Pointer[T]` vs `atomic.Value`

For storing a single typed pointer:

```go
// Generic, type-safe at compile time
var p atomic.Pointer[Config]
p.Store(&Config{...})
c := p.Load() // *Config (or nil)

// Pre-1.19, runtime-checked type
var v atomic.Value
v.Store(&Config{...})
c := v.Load().(*Config)
```

`atomic.Pointer[T]` wins on every axis except API age. Use it for new code unless you specifically need the dynamic type behaviour of `atomic.Value` (e.g., storing different concrete types behind an interface, which the type-safety constraint of `Pointer[T]` would prevent).

---

## Atomic vs Mutex Decision Matrix

| Scenario | Best primitive | Reason |
|---|---|---|
| Single int counter | `atomic.Int64` | One op, fast, no contention overhead. |
| Boolean flag | `atomic.Bool` | One op, fast, type-safe. |
| Pointer to immutable struct, replaced occasionally | `atomic.Pointer[T]` | Readers lock-free; writer builds new struct. |
| Pointer to immutable struct, mixed type interface | `atomic.Value` | When you need runtime-typed flexibility. |
| Two-field update (e.g., count and timestamp together) | `sync.Mutex` | Two atomics cannot be combined. |
| Map keyed access | `sync.RWMutex + map` or `sync.Map` | Map state is many words. |
| Read-mostly cache | `sync.Map` or `atomic.Pointer[T]` to an immutable snapshot | Depends on update frequency and key churn. |
| One-time initialisation | `sync.Once` | Built on atomics; preferred for the standard case. |
| Coordinate "wait for event" | channel or `sync.Cond` | Atomic does not block. |
| Lock-free queue / stack | atomic CAS | Lock-free data structure; senior-level material. |
| Refcounting | `atomic.Int64` | Add/sub; careful with use-after-free at zero. |

### The "two atomics" trap

```go
var n atomic.Int64
var t atomic.Int64 // timestamp of last update

// writer
n.Add(1)
t.Store(time.Now().UnixNano())

// reader
fmt.Printf("count=%d at=%d\n", n.Load(), t.Load())
```

The reader can observe an inconsistent pair: the count after the increment but the timestamp from before. Atomic gives you per-variable atomicity, not transactional consistency. If you need the pair to be coherent, you have three options:

1. **Pack into one variable.** A struct with both fields, stored via `atomic.Pointer[T]`. The reader loads one pointer and sees both fields together.
2. **Mutex.** Lock around both updates and both reads.
3. **Accept the inconsistency.** For metrics, slight skew is usually fine; do not over-engineer.

---

## CAS Loop Patterns

The canonical CAS loop:

```go
for {
    old := x.Load()
    new := f(old)
    if x.CompareAndSwap(old, new) {
        break
    }
    // someone else changed x; loop again
}
```

### When CAS is the right tool

- The update depends non-trivially on the current value (more than just `+delta`).
- You need to atomically update a pointer to a complex structure.
- You are building a lock-free data structure.

### When CAS is the wrong tool

- The update is `+delta`. Use `Add`. It is one instruction; CAS is a loop.
- You only need to overwrite. Use `Store`. CAS that ignores the old value is pointless.
- You can hold a mutex for microseconds without anyone noticing. Use `Mutex`. CAS does not give fairness.

### CAS loop with a bound

Under high contention, a CAS loop can spin for many iterations. A defensive pattern caps retries and falls back:

```go
const maxRetries = 64

for i := 0; i < maxRetries; i++ {
    old := x.Load()
    new := f(old)
    if x.CompareAndSwap(old, new) {
        return nil
    }
    if i > 8 {
        runtime.Gosched()
    }
}
return errors.New("too much contention")
```

Rarely needed in real code. Mention it in code review when contention is observed in profiles.

### CAS loop that updates a slice element

```go
// counters is []atomic.Int64
shard := goroutineShard()
for {
    old := counters[shard].Load()
    if counters[shard].CompareAndSwap(old, old+1) {
        break
    }
}
```

In practice, `counters[shard].Add(1)` is shorter and faster. Use CAS when you have a non-trivial transform.

### The "publish a new linked-list node" CAS pattern

```go
type Node struct {
    value int
    next  *Node
}

type Stack struct {
    head atomic.Pointer[Node]
}

func (s *Stack) Push(v int) {
    n := &Node{value: v}
    for {
        n.next = s.head.Load()
        if s.head.CompareAndSwap(n.next, n) {
            return
        }
    }
}
```

A lock-free stack push. The CAS loop publishes `n` as the new head, taking care that the old head is still what we read. This is the foundation of lock-free data structures. Senior level discusses the ABA problem and why a simple stack pop is subtler than push.

---

## The `And`/`Or` Operations (Go 1.23+)

Go 1.23 added atomic bitwise operations to the typed and free-function APIs:

```go
var flags atomic.Uint32

flags.Or(0x01)    // set bit 0
flags.And(^0x02)  // clear bit 1

// returns old value before the operation
old := flags.Or(0x04)
```

These let you implement bitset flags lock-free:

```go
const (
    FlagReady   = 1 << 0
    FlagStopped = 1 << 1
    FlagDirty   = 1 << 2
)

var state atomic.Uint32

func markReady()   { state.Or(FlagReady) }
func clearDirty()  { state.And(^uint32(FlagDirty)) }
func isReady() bool {
    return state.Load()&FlagReady != 0
}
```

Before Go 1.23, you implemented this with a CAS loop:

```go
for {
    old := state.Load()
    new := old | FlagReady
    if state.CompareAndSwap(old, new) {
        break
    }
}
```

The Go 1.23 `Or` does the same thing in a single CPU instruction (`LOCK OR` on x86) — faster and shorter. Recommend `Or`/`And` for new flag-bitset code if your minimum Go version supports it.

---

## Benchmarks

Approximate numbers on a modern x86-64 laptop (cycle counts from `LOCK XADD` and friends — your hardware will vary):

```
BenchmarkAtomicAddUncontended       2.0 ns/op
BenchmarkAtomicAddContended (4 G)   12 ns/op
BenchmarkAtomicAddContended (16 G)  60 ns/op
BenchmarkMutexLockUnlockUncontended 15 ns/op
BenchmarkMutexLockUnlockContended   200 ns/op (plus parking)
BenchmarkChannelSendRecvBuffered    50 ns/op
BenchmarkChannelSendRecvUnbuffered  120 ns/op
```

Takeaways:

- **Uncontended atomic is ~7-10x faster than uncontended mutex.** For a hot counter, atomic wins big.
- **Contended atomic degrades less gracefully than uncontended.** The cache line bounces between cores; throughput drops.
- **Contended mutex is even worse** because goroutines park. The kernel gets involved.
- **Channels are slow** compared to either. They are not for tight loops; they are for communication.

The headline lesson: pick the primitive that matches the operation. Atomic for one variable, mutex for several, channel for messages.

### A benchmark you should run

```go
func BenchmarkAtomicHot(b *testing.B) {
    var x atomic.Int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            x.Add(1)
        }
    })
}

func BenchmarkAtomicShared(b *testing.B) {
    // 16 separate atomics, one per goroutine, no contention
    shards := make([]atomic.Int64, 16)
    var i atomic.Int32
    b.RunParallel(func(pb *testing.PB) {
        idx := int(i.Add(1)-1) % 16
        for pb.Next() {
            shards[idx].Add(1)
        }
    })
}

func BenchmarkMutexHot(b *testing.B) {
    var mu sync.Mutex
    var x int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            mu.Lock()
            x++
            mu.Unlock()
        }
    })
}
```

Run with `go test -bench=. -cpu=1,4,16`. You will see the contention curve directly.

---

## Race Detector Interaction

The race detector understands atomic operations. It treats an atomic store as a "release" and an atomic load as an "acquire" — establishing happens-before edges that justify subsequent non-atomic accesses.

```go
var ready atomic.Bool
var data int

// writer
data = 42
ready.Store(true)

// reader
if ready.Load() {
    _ = data // no race — synchronised via the atomic
}
```

The race detector recognises the atomic chain and does not flag `data`'s access.

### What it flags

```go
var x int64

// writer
atomic.StoreInt64(&x, 1)

// reader (BUG — non-atomic read of an atomically-written variable)
v := x
```

The race detector flags this. Mixed atomic and non-atomic access on the same variable is a race. The typed API (`atomic.Int64`) prevents this by hiding the underlying field.

### What it does not flag

The race detector finds races that occur during the test run. It cannot prove the absence of races on code paths that did not execute. Always run `go test -race ./...` with realistic concurrent workloads.

### Performance

`-race` adds ~5-10x CPU overhead and ~2-3x memory overhead. Acceptable for CI; not for production. Keep it on in tests, off in builds.

---

## Common Bugs at the Middle Level

### Bug 1: ABI mismatch on 32-bit struct field

```go
type Stats struct {
    started bool   // 1 byte
    count   int64  // misaligned on 32-bit
}
var s Stats
atomic.AddInt64(&s.count, 1) // crashes on 32-bit
```

Fix: use `atomic.Int64` or reorder so 64-bit fields come first.

### Bug 2: `atomic.Value` panic on inconsistent type

```go
var v atomic.Value
v.Store(MyImpl{}) // type: MyImpl
v.Store(other)    // panic if other is a different concrete type
```

Fix: store a pointer to an interface, or use a wrapper struct with a fixed type, or prefer `atomic.Pointer[T]`.

### Bug 3: Mutating a struct after publication

```go
var cfg atomic.Pointer[Config]
c := &Config{Endpoint: "old"}
cfg.Store(c)
// later, somewhere:
c.Endpoint = "new" // RACE — readers may be reading c right now
```

Fix: always allocate a fresh `Config` for each update. Treat the published pointer as immutable.

### Bug 4: Two atomics expected to update together

```go
var min atomic.Int64
var max atomic.Int64
min.Store(v - 10)
max.Store(v + 10)
// reader may see new min but old max
```

Fix: pack into a struct, use `atomic.Pointer[Range]`.

### Bug 5: CAS loop with stale `old`

```go
old := x.Load()
// ... long computation ...
x.CompareAndSwap(old, new) // may fail; needs retry
```

The CAS will fail if `x` changed during the computation. The whole loop must be inside the retry. A common mistake is to do the load once and the CAS later without a retry.

### Bug 6: Confusing `Swap` return value

```go
prev := x.Swap(0)
log.Println("set to 0, was:", prev)
// vs
new := x.Swap(0)
log.Println("now:", new) // wrong: new is the previous value, not the new one
```

`Swap` always returns the *previous* value. Read carefully.

### Bug 7: `atomic.Bool` zero value

```go
var b atomic.Bool
fmt.Println(b.Load()) // false — the zero value
```

The zero value of `atomic.Bool` is `false`. This is usually what you want. But:

```go
type State struct {
    initialised atomic.Bool
}
```

A new `State` has `initialised == false`. Stores must happen before reads can rely on `true`.

### Bug 8: Reading the underlying field of a typed atomic

You cannot. The field is unexported. This is a feature, not a bug. The legacy API allowed it and people abused it.

---

## Summary

At the middle level the picture is sharper:

- **Memory model.** Go's atomics are sequentially consistent (Go 1.19+). Atomic stores act as publication barriers; atomic loads act as acquisition barriers. Non-atomic writes that precede an atomic store are visible to non-atomic reads that follow an atomic load.
- **Alignment.** 64-bit atomic ops require 8-byte alignment. The Go 1.19 typed API handles this; the legacy API needs careful struct layout on 32-bit.
- **API choice.** Typed (`atomic.Int64`, `atomic.Pointer[T]`) for new code. `atomic.Value` for dynamic-type situations; `atomic.Pointer[T]` otherwise.
- **CAS vs Add vs Store.** Use Add for `+delta`; Store for unconditional set; CAS for non-trivial transforms or publishing pointers.
- **Atomic vs Mutex vs Channel.** Atomic for one variable. Mutex for groups of variables and critical sections. Channel for inter-goroutine communication.
- **Go 1.23 And/Or.** Atomic bitwise ops are now first-class — no more CAS loops for setting flag bits.
- **Race detector.** Understands atomics; only flags mixed access. Run in CI.

The senior level pushes deeper: lock-free patterns, the ABA problem, refcounting subtleties, and atomic with interface values. The professional level descends to the CPU: `LOCK CMPXCHG`, cache coherence, load-linked/store-conditional, and how Go's runtime maps the API to hardware.
