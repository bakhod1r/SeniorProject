---
layout: default
title: Mutex vs Atomic — Junior
parent: Mutex vs Atomic
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/02-mutex-vs-atomic/junior/
---

# Mutex vs Atomic — Junior

[← Back](../)

This page introduces atomic operations the way you should learn them: starting from why a plain `n++` from multiple goroutines is broken, what an atomic instruction does at the CPU level, and when atomic is the right answer instead of `sync.Mutex`. By the end you should be able to read a snippet and decide "this is one word, one operation, use atomic" or "this is a compound operation, use a mutex" without hesitation.

We start with the problem, build atomic counters and flags, walk through each operation in `sync/atomic`, switch to the modern typed atomics from Go 1.19, and finish with a checklist of when to reach for each tool.

---

## Table of Contents

1. [Why `n++` is broken](#why-n-is-broken)
2. [What an atomic operation actually is](#what-an-atomic-operation-actually-is)
3. [The atomic-or-protected rule](#the-atomic-or-protected-rule)
4. [`sync/atomic` — the function-based API](#syncatomic--the-function-based-api)
5. [The five operations](#the-five-operations)
6. [Single-word vs multi-field invariants](#single-word-vs-multi-field-invariants)
7. [The Go 1.19 typed atomics](#the-go-119-typed-atomics)
8. [`atomic.Pointer[T]` — typed pointer publish](#atomicpointert--typed-pointer-publish)
9. [`atomic.Value` — the older, weirder cousin](#atomicvalue--the-older-weirder-cousin)
10. [Worked example — atomic counter](#worked-example--atomic-counter)
11. [Worked example — atomic flag](#worked-example--atomic-flag)
12. [Worked example — atomic snapshot publish](#worked-example--atomic-snapshot-publish)
13. [When to use mutex instead](#when-to-use-mutex-instead)
14. [The decision flowchart](#the-decision-flowchart)
15. [Common mistakes](#common-mistakes)
16. [What to remember](#what-to-remember)

---

## Why `n++` is broken

Start with the simplest concurrent program:

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var n int64
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 1000; j++ {
                n++
            }
        }()
    }
    wg.Wait()
    fmt.Println(n)
}
```

You expect `1000000`. Run it: you get a different number every time, sometimes `987654`, sometimes `923000`, sometimes (rarely) `1000000`. Why?

Because `n++` is not one instruction. It compiles to roughly:

```
MOV  RAX, [n]   ; load n into register
INC  RAX        ; add 1
MOV  [n], RAX   ; store back
```

Three steps. If goroutine A loads `n=42`, then goroutine B loads `n=42`, both increment their register to `43`, both store `43` back, you got two increments but `n` only moved by one. This is a **lost update**.

The race detector finds it instantly:

```
$ go run -race main.go
==================
WARNING: DATA RACE
Read at 0x000000123456 by goroutine 7:
  main.main.func1()
      main.go:14 +0x44
Previous write at 0x000000123456 by goroutine 6:
  main.main.func1()
      main.go:14 +0x55
==================
```

There are two ways to fix this:

1. Protect every `n++` with a `sync.Mutex`. Correct, but heavy if `n++` is in a hot loop.
2. Replace `n++` with an atomic instruction that does load-add-store in one indivisible step. Lock-free, cheaper, but only works when the operation fits in one word.

This page is about option (2).

---

## What an atomic operation actually is

An atomic operation is a CPU instruction (or sequence) that completes without interruption from any other CPU's perspective. Another way to say it: while the operation runs, no other goroutine can observe the memory in a half-finished state.

On amd64 the magic comes from the `LOCK` prefix. `LOCK XADD` (locked exchange-and-add) does load-add-store atomically. While it runs, the CPU asserts a bus lock (on older CPUs) or holds the cache line in exclusive state (on modern CPUs), preventing any other core from touching the address.

```
   amd64                Go function
   ─────                ───────────
   LOCK XADD [n], 1     atomic.AddInt64(&n, 1)
   LOCK CMPXCHG [n], r  atomic.CompareAndSwapInt64(&n, old, new)
   XCHG [n], r          atomic.SwapInt64(&n, new)   (XCHG is implicitly locked)
   MOV r, [n]           atomic.LoadInt64(&n)        (loads are SC on x86)
   XCHG [n], r          atomic.StoreInt64(&n, v)    (need XCHG, not MOV, for SC store)
```

On ARM64 the equivalent uses `LDAXR`/`STLXR` (load-acquire-exclusive / store-release-exclusive) in a CAS loop, with explicit memory barriers (`DMB ISH`). Different instructions, same semantics: indivisible from every other CPU's perspective, with sequential consistency.

You do not write the assembly. You call `sync/atomic` functions and Go emits the right instruction for the target architecture.

### Cost in cycles

- `MOV` (plain load/store): ~1 cycle (or 4 on a cache miss).
- `LOCK XADD`: ~20-30 cycles. The `LOCK` prefix is what costs — it forces the cache coherency protocol to serialise.
- `sync.Mutex.Lock` uncontended: ~50-80 cycles (one CAS + Unlock atomic store).
- `sync.Mutex.Lock` contended: ~1000-3000 cycles (futex syscall + goroutine park).

So atomic is roughly 2-3x faster than uncontended mutex and 50-100x faster than contended mutex.

---

## The atomic-or-protected rule

Here is the most important rule on this page:

> **A memory location may be accessed atomically OR protected by a mutex. Never mix.**

This is from the Go memory model. If you read a word with `atomic.LoadInt64` anywhere in the program, every other access to that word — read or write, in any goroutine — must also go through `sync/atomic`. Otherwise the result is undefined.

```go
var n int64

func add()  { atomic.AddInt64(&n, 1) }     // OK
func read() { return n }                     // BUG — plain load mixed with atomic add
```

Why? Because the compiler is free to re-order, hoist, register-cache, or coalesce plain loads. Without the atomic instruction, your read might see stale memory, torn values (half-updated bytes), or get optimised away entirely.

The race detector (since Go 1.19) flags mixed access:

```
WARNING: DATA RACE
Atomic read at 0x... by goroutine 7
Previous non-atomic write at 0x... by goroutine 6
```

The fix is to make every access atomic:

```go
func read() int64 { return atomic.LoadInt64(&n) }
```

Or, even better, use the typed atomic which makes plain access impossible (no exported field):

```go
var n atomic.Int64
// n.Add(1), n.Load() — no plain access possible
```

---

## `sync/atomic` — the function-based API

The original API in `sync/atomic` is a flat list of free functions. For every supported type (`int32`, `int64`, `uint32`, `uint64`, `uintptr`, `unsafe.Pointer`) there are five operations:

| Function | What it does |
|---|---|
| `LoadInt64(addr *int64) int64` | Atomic read |
| `StoreInt64(addr *int64, val int64)` | Atomic write |
| `AddInt64(addr *int64, delta int64) int64` | Atomic add, returns new value |
| `SwapInt64(addr *int64, new int64) int64` | Atomic swap, returns old value |
| `CompareAndSwapInt64(addr *int64, old, new int64) bool` | Atomic CAS |

Replace `Int64` with `Int32`, `Uint32`, `Uint64`, or `Uintptr` for the other types.

For pointers there is `atomic.LoadPointer`, `atomic.StorePointer`, etc., but they take `*unsafe.Pointer` and require manual casting. In Go 1.19+ you should prefer `atomic.Pointer[T]` (typed).

### Why these five and no more?

These are the only operations that map directly to a single CPU instruction (on amd64; on ARM they map to a short instruction sequence with a memory barrier). Anything more complex would not be lock-free. There is no `atomic.MaxInt64` because there is no `LOCK MAX` instruction; if you need max, write a CAS loop.

---

## The five operations

### Load

```go
v := atomic.LoadInt64(&counter)
```

Reads the value at `&counter` atomically. The value you receive is some value that was stored by some goroutine at some point — never a torn read.

On amd64, plain loads of aligned `int64` are already atomic at the hardware level. But you still must use `atomic.LoadInt64` because:
- The compiler does not know about the contract. It may move plain loads around.
- Only `atomic.LoadInt64` establishes happens-before with prior atomic stores.
- The race detector flags plain reads of words written atomically elsewhere.

### Store

```go
atomic.StoreInt64(&counter, 42)
```

Writes 42 atomically. On amd64 this compiles to `XCHG` (which is implicitly locked) to ensure sequential consistency — a plain `MOV` is not enough because reads on other cores might be reordered around it.

### Add

```go
newValue := atomic.AddInt64(&counter, 1)        // increment
newValue := atomic.AddInt64(&counter, -1)       // decrement (delta can be negative for signed types)
newValue := atomic.AddInt64(&counter, 7)        // add 7
```

Returns the NEW value after the add. This is unusual — many languages return the old value — but Go made the choice and it has been consistent since Go 1.0.

`AddUint64` works the same way but with unsigned wraparound; to subtract from a `uint64`, use the two's-complement trick: `atomic.AddUint64(&n, ^uint64(delta-1))`.

There is no `AddUintptr` for `unsafe.Pointer` (you cannot add a delta to a pointer atomically; you would need CAS).

### Swap

```go
old := atomic.SwapInt64(&counter, 0) // returns old value, stores 0
```

Atomically replace the value and return what was there. Useful for "drain and reset" patterns:

```go
// Read accumulated count and reset to zero, atomically.
total := atomic.SwapInt64(&counter, 0)
log.Printf("processed %d items", total)
```

A plain `Load` followed by `Store(0)` is NOT equivalent — another goroutine could increment between the Load and Store, and that increment would be lost.

### CompareAndSwap (CAS)

```go
ok := atomic.CompareAndSwapInt64(&counter, expected, desired)
```

Atomically: if `counter == expected`, set it to `desired` and return true. Otherwise leave it alone and return false.

CAS is the building block for everything else lock-free can do. When `Add`/`Swap` are not expressive enough, you write a CAS loop:

```go
// Increment counter only if it is currently less than max.
for {
    old := atomic.LoadInt64(&counter)
    if old >= max {
        return false
    }
    if atomic.CompareAndSwapInt64(&counter, old, old+1) {
        return true
    }
    // CAS failed: another goroutine got there first. Retry.
}
```

The pattern: load, compute, CAS-on-old-value. If CAS succeeds, done. If it fails, the value changed under you — loop and re-read.

---

## Single-word vs multi-field invariants

This is the rule of thumb that decides mutex-vs-atomic in 90% of cases.

### Single-word invariant — atomic wins

```go
var requestCount atomic.Int64

func handle() {
    requestCount.Add(1)
    // ... handle request
}
```

The invariant is "the count is some valid number". It is one word, one operation. Atomic is right.

### Multi-field invariant — mutex wins

```go
type Account struct {
    mu      sync.Mutex
    balance int64
    history []Tx
}

func (a *Account) Debit(amt int64, tx Tx) {
    a.mu.Lock()
    defer a.mu.Unlock()
    a.balance -= amt
    a.history = append(a.history, tx)
}
```

The invariant is "every debit appears in both `balance` AND `history`, atomically". Two fields. You cannot do this with `atomic` — you would have a window between updating one field and the other where readers see balance reduced but no matching transaction.

### The "compound operation" rule — mutex wins even on one field

```go
type Capped struct {
    mu sync.Mutex
    n  int64
    max int64
}

func (c *Capped) Inc() bool {
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.n < c.max {
        c.n++
        return true
    }
    return false
}
```

This is one field but the operation is compound: "if n < max, then increment." A naive `atomic.Add` overshoots the cap. You can rewrite with a CAS loop, but for many people the mutex is clearer.

---

## The Go 1.19 typed atomics

Go 1.19 (August 2022) introduced typed atomic types in `sync/atomic`. They wrap the function-based API and add three benefits:

1. **Compile-time safety.** The wrapped field is unexported, so you cannot accidentally write `x.v = 1` (skipping the atomic).
2. **Self-documenting.** A field of type `atomic.Int64` shouts "this is shared, mutate with atomics." A plain `int64` does not.
3. **Free 32-bit alignment.** The runtime puts `align64` (an internal magic type) inside `atomic.Int64` and `atomic.Uint64`, which the compiler recognises and uses to force 8-byte alignment on 32-bit platforms. No more "put 64-bit fields first" tricks.

### The list

```go
type Bool struct { ... }       // wraps uint32; one byte conceptually
type Int32 struct { ... }      // wraps int32
type Int64 struct { ... }      // wraps int64, with align64
type Uint32 struct { ... }     // wraps uint32
type Uint64 struct { ... }     // wraps uint64, with align64
type Uintptr struct { ... }    // wraps uintptr
type Pointer[T any] struct { ... }  // typed pointer
type Value struct { ... }      // pre-existing: stores interface{}
```

Each has methods: `Load`, `Store`, and where it makes sense, `Add`, `Swap`, `CompareAndSwap`.

### Example: `atomic.Int64`

```go
type Counter struct {
    n atomic.Int64
}

func (c *Counter) Inc() {
    c.n.Add(1)
}

func (c *Counter) Get() int64 {
    return c.n.Load()
}
```

Compare with the old API:

```go
type Counter struct {
    n int64
}

func (c *Counter) Inc() {
    atomic.AddInt64(&c.n, 1)
}

func (c *Counter) Get() int64 {
    return atomic.LoadInt64(&c.n)
}
```

Same machine code. Different readability. Use the typed version in new code.

### `atomic.Bool`

```go
var ready atomic.Bool

func setup() {
    // ... configure
    ready.Store(true)
}

func isReady() bool {
    return ready.Load()
}
```

The internal representation is `uint32` (Go has no machine instruction for atomic byte operations on every platform). `atomic.Bool` exposes only `Load`, `Store`, `Swap`, and `CompareAndSwap` — no `Add`, since adding to a bool is meaningless.

### `noCopy`

Every typed atomic embeds a `noCopy` marker. `go vet` flags any copy:

```go
func bad(c atomic.Int64) { ... } // vet: passes atomic.Int64 by value
```

Always pass `*atomic.Int64` instead, or embed the atomic in a struct that you also pass by pointer.

---

## `atomic.Pointer[T]` — typed pointer publish

`atomic.Pointer[T]` is the killer feature of the Go 1.19 typed API. It is generic over the pointee type, type-checked at compile time, and the cleanest way to publish a fresh value to many readers.

```go
type Config struct {
    Endpoints []string
    Timeout   time.Duration
}

var cfg atomic.Pointer[Config]

func init() {
    cfg.Store(&Config{Endpoints: []string{"a", "b"}, Timeout: time.Second})
}

func current() *Config { return cfg.Load() }

func reload(c *Config) { cfg.Store(c) }
```

`current()` is lock-free. Every goroutine sees either the old `*Config` or the new one, never a mix. The reader's discipline: once you load a `*Config`, treat it as immutable. Do not mutate fields after the store, because other goroutines may have loaded the same pointer.

This is the foundation of **RCU (read-copy-update)**: build a new structure, swap the pointer, let the old structure be garbage-collected when no goroutine still holds it. Go's GC makes RCU trivial — in C/C++ you would need explicit grace periods.

### Without `atomic.Pointer[T]` (older code)

```go
var cfg unsafe.Pointer // *Config under the hood

func current() *Config {
    return (*Config)(atomic.LoadPointer(&cfg))
}

func reload(c *Config) {
    atomic.StorePointer(&cfg, unsafe.Pointer(c))
}
```

Three unsafe casts and a comment explaining "this is really `*Config`." Old code in the Go stdlib looks like this; new code should not.

---

## `atomic.Value` — the older, weirder cousin

Before Go had generics (Go 1.18 was the first), `atomic.Value` filled the gap for typed atomic storage:

```go
var cfg atomic.Value // stores *Config (or any interface{})

func init() {
    cfg.Store(&Config{Timeout: time.Second})
}

func current() *Config {
    return cfg.Load().(*Config) // type assertion every read
}

func reload(c *Config) {
    cfg.Store(c)
}
```

Quirks of `atomic.Value`:

1. **Once-typed.** The first `Store` fixes the dynamic type. Storing a value of a different type panics. This catches type errors but only at runtime.
2. **Allocations.** Every `Store` may allocate (the value is boxed into `interface{}`).
3. **Reads include a type assertion.** Not free, though usually negligible.
4. **No `Swap` or `CompareAndSwap`.** Go 1.17 added `Swap` and `CompareAndSwap` to `atomic.Value`, but they are clunky compared to `atomic.Pointer[T]`.

When to use `atomic.Value` in new code? Almost never. The only edge case is when you need to atomically publish a non-pointer value (a struct by value), and even then `atomic.Pointer[T]` to an immutable struct is usually clearer.

---

## Worked example — atomic counter

The simplest non-trivial use of atomic. A request counter shared by all handlers:

```go
package metrics

import "sync/atomic"

type RequestCounter struct {
    total  atomic.Int64
    errors atomic.Int64
}

func (rc *RequestCounter) Record(failed bool) {
    rc.total.Add(1)
    if failed {
        rc.errors.Add(1)
    }
}

func (rc *RequestCounter) Snapshot() (total, errors int64) {
    return rc.total.Load(), rc.errors.Load()
}
```

Notes:
- `Record` is lock-free. Hot path stays out of the kernel.
- `Snapshot` reads each field atomically but the two reads are not jointly atomic. If the metrics endpoint reads `total=100, errors=5`, but between the two loads another request arrives and fails (making it `total=101, errors=6`), Snapshot returns `total=100, errors=6` — internally inconsistent. For metrics this is usually fine; for billing it would not be.
- Two adjacent atomics share a cache line. For very hot counters this causes false sharing (see `optimize.md`).

---

## Worked example — atomic flag

A one-shot boolean. Many goroutines may call `Set`, but only the first wins:

```go
type Once struct {
    done atomic.Bool
}

// Set returns true if this call flipped the flag from false to true.
// All subsequent callers (and concurrent losers) get false.
func (o *Once) Set() bool {
    return o.done.CompareAndSwap(false, true)
}

func (o *Once) IsSet() bool {
    return o.done.Load()
}
```

`CompareAndSwap(false, true)` is the perfect tool: exactly one goroutine succeeds (returns true), the rest fail and learn the flag is already set.

This is the building block of `sync.Once`, but `sync.Once` also handles re-entrancy and ensures the initialiser runs to completion before late callers see it as "done."

### What NOT to write

```go
func (o *Once) BAD_Set() bool {
    if o.done.Load() {
        return false
    }
    o.done.Store(true)
    return true
}
```

This is broken. Two goroutines may both pass the `Load() == false` check, both store true, both think they won. `CompareAndSwap` is the only correct primitive.

---

## Worked example — atomic snapshot publish

The route table: many readers, occasional writer.

```go
type Router struct {
    routes atomic.Pointer[map[string]http.Handler]
}

func NewRouter() *Router {
    r := &Router{}
    m := map[string]http.Handler{}
    r.routes.Store(&m)
    return r
}

// Lookup is the hot path: no locking, one atomic load.
func (r *Router) Lookup(path string) (http.Handler, bool) {
    m := *r.routes.Load()
    h, ok := m[path]
    return h, ok
}

// Update is the cold path: rebuild and swap.
func (r *Router) Update(path string, h http.Handler) {
    for {
        oldPtr := r.routes.Load()
        old := *oldPtr
        newMap := make(map[string]http.Handler, len(old)+1)
        for k, v := range old {
            newMap[k] = v
        }
        newMap[path] = h
        if r.routes.CompareAndSwap(oldPtr, &newMap) {
            return
        }
    }
}
```

The pattern:
- Lookup: one atomic load + plain map read. No lock.
- Update: load old, copy, swap. If another writer raced, retry.
- The old map remains alive until every reader's `Load` call returns. Go's GC handles it.

This is the RCU pattern. Trade-off: every update is O(n) in the map size. For a route table that updates rarely (config reload), this is fine. For something that updates often, you would use a different structure.

---

## When to use mutex instead

Use `sync.Mutex` when:

1. **Multiple fields must update together.** No atomic can update two fields. A mutex can.
2. **The operation is compound.** "Read field, decide, write field" with intermediate logic. Even on one field, a CAS loop is cleaner than `if/atomic`/error-retry.
3. **The critical section is large.** If you hold for 100 lines and 1ms, the mutex cost is invisible.
4. **You need RWMutex's read-mostly optimisation AND the structure is complex.** For simple snapshots, `atomic.Pointer[T]` beats `RWMutex`.
5. **The team is junior.** A `sync.Mutex` is universally understood; CAS loops less so.

Use `sync/atomic` when:

1. **The invariant is one machine word.**
2. **The operation is one read-modify-write.**
3. **It is a hot path** (profiling shows the mutex in the top of `pprof`).
4. **You can articulate the atomic-or-protected discipline** to future readers.

If both seem plausible, write the mutex version first. Switch to atomic only after profiling proves the mutex is a bottleneck.

---

## The decision flowchart

```
                  ┌───────────────────────────────┐
                  │ Need to coordinate goroutines │
                  └───────────────────────────────┘
                                  │
                                  ▼
                  ┌───────────────────────────────┐
                  │ How big is the shared state?  │
                  └───────────────────────────────┘
                                  │
                ┌─────────────────┴─────────────────┐
                ▼                                   ▼
       One machine word                   Multiple fields
       (counter, flag, pointer)           (state machine, struct)
                │                                   │
                ▼                                   ▼
       ┌─────────────────┐                ┌─────────────────┐
       │ Is the op a     │                │     sync.Mutex  │
       │ single RMW?     │                │  (or RWMutex)   │
       └─────────────────┘                └─────────────────┘
                │
        ┌───────┴───────┐
        ▼               ▼
       YES             NO (compound op, decision)
        │               │
        ▼               ▼
    sync/atomic       CAS loop OR sync.Mutex
    (Add, Load,       (try CAS; if hard, mutex)
     Store, Swap)
```

---

## Common mistakes

### Forgetting the atomic prefix on some accesses

```go
var n atomic.Int64
// ...
n.Add(1)        // OK
something(n)    // BUG — passes the struct by value, copies the field
```

Pass `*atomic.Int64`, never `atomic.Int64` by value.

### Using `atomic.Bool` as a TryLock

```go
var locked atomic.Bool
if !locked.Load() {
    locked.Store(true) // BUG — two goroutines can both pass the check
}
```

Use `CompareAndSwap(false, true)` for try-lock semantics. Better: use `sync.Mutex.TryLock()` which integrates with the scheduler.

### Treating atomic snapshots as joint snapshots

```go
total := rc.total.Load()
errors := rc.errors.Load()
// total and errors may not correspond to the same instant
```

Each `Load` is individually atomic. The pair is not. If you need a consistent snapshot, use a single `atomic.Pointer` to a struct, or take a mutex.

### Mutating a published value

```go
cfg := configPtr.Load()
cfg.Timeout = time.Second // BUG — other goroutines see the mutation racing
```

Published values are immutable from the moment they are stored. To "update", build a new value and call `Store` again.

### Padding for false sharing only after measuring

Junior code often adds padding "for safety". Padding has a real memory cost. Add it only when profiling shows the cache line is hot.

---

## A deeper look at each atomic operation

### `Load` — read without tearing

A 64-bit `int64` on amd64 fits in one machine register. A plain `=` already does a 64-bit move (`MOVQ`). So why is `atomic.LoadInt64` different?

Three reasons:

**1. Compiler ordering.** Without the atomic call, the compiler may reorder the read against other operations in the same goroutine. The atomic acts as a compiler fence.

**2. CPU ordering.** On weakly ordered architectures (ARM64, RISC-V), the CPU may speculate reads early or late. The atomic ensures the read happens at the right point in the program order, with the right memory barrier semantics.

**3. Race detector.** The detector tags atomic and non-atomic accesses separately. Plain reads of a word written atomically elsewhere are flagged.

In Go's implementation on amd64, `atomic.LoadInt64` compiles to a plain `MOVQ` (because amd64 loads of aligned 8-byte values are already SC), but the compiler treats it as a barrier and emits the right surrounding code.

### `Store` — write without tearing

Symmetric to `Load`. On amd64 it compiles to `XCHG` (which is implicitly locked, providing the SC store barrier). On ARM64, `STLR` (store-release).

A plain `=` write is broken because:

- Compiler may delay or merge writes.
- Other goroutines may see stale values.
- The race detector flags it.

### `Add` — load-modify-store in one instruction

```
LOCK XADD [n], 1
```

On amd64 this is one instruction. The `LOCK` prefix asserts cache-line exclusivity for the duration. While the instruction runs, no other CPU can read or write the same cache line.

Returns the value AFTER the add (in Go's convention; this differs from `XADD`'s own semantic, which returns OLD; Go does the subtraction internally).

`AddInt64` handles negative deltas correctly via two's complement. `AddUint64` wraps:

```go
var n uint64
atomic.StoreUint64(&n, 5)
result := atomic.AddUint64(&n, ^uint64(0)) // adds -1 in two's complement; wraps
// result is 4
```

The `^uint64(0)` trick is the way to "subtract 1" from a `uint64` atomic. `atomic.AddUint64(&n, -1)` does not compile (cannot pass -1 to a uint64 parameter).

### `Swap` — atomic exchange

```
XCHG [n], r
```

`XCHG` is implicitly locked on amd64. Returns the OLD value, writes the NEW value.

Common idiom: drain-and-reset.

```go
type Drainer struct {
    accumulated atomic.Int64
}

func (d *Drainer) Accumulate(v int64) {
    d.accumulated.Add(v)
}

func (d *Drainer) Drain() int64 {
    return d.accumulated.Swap(0)
}
```

`Drain` returns whatever has accumulated since the last drain. Atomically. A `Load` followed by `Store(0)` would lose any concurrent `Add`s that happen between the two operations.

### `CompareAndSwap` — the universal building block

```
LOCK CMPXCHG [n], r
```

`CMPXCHG` (compare-and-exchange) on amd64. Takes the comparand in `RAX`, the new value in `r`. If `*addr == RAX`, write `r` and set ZF=1. If not, write `*addr` to `RAX` (so you have the actual value) and set ZF=0.

Go's wrapper hides the RAX dance and returns a clean `bool`.

CAS is the foundation of every lock-free algorithm. Any operation expressible as "if the state is what I expect, atomically transition to a new state" maps to CAS.

#### CAS-loop template

```go
for {
    old := x.Load()
    new := computeNew(old) // pure function, no side effects
    if x.CompareAndSwap(old, new) {
        // We won the race; new is published.
        return new
    }
    // We lost; another goroutine changed x. Retry with the new value.
}
```

The retry rarely happens in practice. Under contention it may retry once or twice. If it retries 100 times, you have a contention problem worth a redesign.

---

## Hands-on practice — write these yourself

Before reading the solutions, try these:

**Exercise 1.** Write a `Counter` with `Inc`, `Dec`, `Get`, `Reset` (sets to 0) using only `sync/atomic`.

```go
type Counter struct {
    n atomic.Int64
}

func (c *Counter) Inc()        { c.n.Add(1) }
func (c *Counter) Dec()        { c.n.Add(-1) }
func (c *Counter) Get() int64  { return c.n.Load() }
func (c *Counter) Reset()      { c.n.Store(0) }
```

**Exercise 2.** Write a `Once` (one-shot flag) where the first `Set()` returns true and subsequent return false. All goroutines may call `Set()` concurrently.

```go
type Once struct {
    done atomic.Bool
}

func (o *Once) Set() bool {
    return o.done.CompareAndSwap(false, true)
}

func (o *Once) IsSet() bool {
    return o.done.Load()
}
```

**Exercise 3.** Write a "current max" tracker — `Observe(v int64)` updates the recorded max if `v` is larger, lock-free.

```go
type MaxTracker struct {
    m atomic.Int64
}

func (mt *MaxTracker) Observe(v int64) {
    for {
        old := mt.m.Load()
        if v <= old {
            return
        }
        if mt.m.CompareAndSwap(old, v) {
            return
        }
    }
}

func (mt *MaxTracker) Max() int64 { return mt.m.Load() }
```

**Exercise 4.** Write a function `SetConfig` that publishes a `*Config` lock-free, plus `GetConfig` that retrieves it.

```go
var configP atomic.Pointer[Config]

func SetConfig(c *Config) {
    configP.Store(c)
}

func GetConfig() *Config {
    return configP.Load()
}
```

**Exercise 5.** Without using `Add`, write `Increment(x *atomic.Int64)` using CAS.

```go
func Increment(x *atomic.Int64) int64 {
    for {
        old := x.Load()
        if x.CompareAndSwap(old, old+1) {
            return old + 1
        }
    }
}
```

This is what `Add` does internally on platforms without `LOCK XADD` — but `Add` is one instruction on amd64, so prefer it when possible.

---

## Comparing the same operation in three styles

### Counter with `sync.Mutex`

```go
type Counter struct {
    mu sync.Mutex
    n  int64
}

func (c *Counter) Inc()       { c.mu.Lock(); c.n++; c.mu.Unlock() }
func (c *Counter) Get() int64 { c.mu.Lock(); defer c.mu.Unlock(); return c.n }
```

Pros: easy to read. Pros: easy to extend (add fields under the same lock).
Cons: 2 atomic operations per Inc (Lock + Unlock). Under contention, futex park.

### Counter with `sync/atomic` (function-based)

```go
type Counter struct {
    n int64
}

func (c *Counter) Inc()       { atomic.AddInt64(&c.n, 1) }
func (c *Counter) Get() int64 { return atomic.LoadInt64(&c.n) }
```

Pros: 1 atomic operation per Inc. Lock-free.
Cons: must remember to use `atomic.*` everywhere — `c.n = 0` would race. The race detector catches it but it is a footgun.

### Counter with `atomic.Int64` (typed)

```go
type Counter struct {
    n atomic.Int64
}

func (c *Counter) Inc()       { c.n.Add(1) }
func (c *Counter) Get() int64 { return c.n.Load() }
```

Pros: same machine code as the function-based version, no footgun (no exported field to access plainly), 32-bit alignment handled automatically.

Use this style in new code.

---

## When you SHOULD use a mutex

Sometimes the atomic enthusiasm overrides judgement. Here are cases where mutex is right:

### 1. Compound invariant

```go
type Account struct {
    mu      sync.Mutex
    balance int64
    history []Tx
}

func (a *Account) Debit(amt int64, tx Tx) {
    a.mu.Lock()
    defer a.mu.Unlock()
    a.balance -= amt
    a.history = append(a.history, tx)
}
```

Two fields. One operation. Mutex.

### 2. Large critical section

```go
func (s *Service) Process(input []byte) Result {
    s.mu.Lock()
    defer s.mu.Unlock()
    // ... 50 lines of business logic ...
    return result
}
```

The mutex overhead is 50ns. The critical section is 500us. The mutex overhead is 0.01%. Atomic refactoring buys nothing here.

### 3. Read-modify-write with branches

```go
func (q *Queue) PushIfNotFull(v int) bool {
    q.mu.Lock()
    defer q.mu.Unlock()
    if q.len >= q.cap {
        return false
    }
    q.items[q.len] = v
    q.len++
    return true
}
```

This MIGHT be rewritten as CAS-loop, but the readability suffers and the gain is small. Keep the mutex.

### 4. When you might add more state later

If the field is currently one word but you anticipate the struct growing, start with a mutex. Refactoring atomic-to-mutex later is annoying because every call site changes.

### 5. When the team is unfamiliar with atomic semantics

A `sync.Mutex` is universally understood. `atomic.CompareAndSwap` and CAS loops are not. If you ship the atomic version and a maintainer adds `c.n = 0` somewhere "to reset", they have introduced a race. The mutex makes the intent clear.

---

## A practical decision worksheet

When you face "mutex or atomic?" answer these in order:

1. **What is the type of the shared state?**
   - One field, one word, simple type → atomic candidate.
   - Multiple fields, struct, slice, map → mutex.

2. **What is the operation?**
   - Single read, single write → atomic Load/Store.
   - Increment, decrement → atomic Add.
   - Compare-and-set (one-shot flag) → atomic CompareAndSwap.
   - Compare with branching (cap, min, max) → CAS loop.
   - Multi-field update → mutex.
   - Read-modify-write with side effects → mutex.

3. **Is it on the hot path?**
   - No → use whatever is clearer (usually mutex).
   - Yes → profile first; consider atomic if the mutex shows up in pprof.

4. **Can you state the atomic-or-protected discipline clearly?**
   - Yes → atomic.
   - No → mutex; or learn the discipline first.

5. **Is the platform 32-bit?**
   - If yes and you use `int64` atomic → use `atomic.Int64` (typed), which handles alignment.
   - If yes and you use raw `int64` → put 64-bit fields first in the struct.
   - On 64-bit only → ignore the alignment issue.

---

## Glossary

**Atomic operation** — A read, write, or read-modify-write that completes indivisibly from the perspective of other goroutines.

**CAS (compare-and-swap)** — Atomic conditional update: if value matches expected, replace with new; else fail.

**Cache line** — The unit of memory transfer between CPU and RAM. Typically 64 bytes on amd64 and ARM64.

**False sharing** — Two atomic variables on the same cache line ping-pong between cores even though they are logically independent.

**Happens-before** — A partial ordering of operations such that if A happens-before B, then writes done by A are visible to reads done by B.

**Lock-free** — A concurrent algorithm where at least one goroutine always makes progress even if others stall.

**Memory barrier** — A CPU instruction that prevents reordering of memory operations across it. `MFENCE` on amd64, `DMB ISH` on ARM64.

**Mixed access** — Accessing the same memory location with both atomic and non-atomic operations. Undefined in the Go memory model.

**RCU (read-copy-update)** — A pattern where writers copy-modify-publish a new version, readers see either old or new atomically, old versions are reclaimed when no reader holds them.

**Sequential consistency (SC)** — A memory model where all operations appear to execute in some global order consistent with each thread's program order.

**Tearing** — A read or write that observes/produces a half-completed value because the operation was not atomic.

---

## What to remember

- A plain `n++` from multiple goroutines races. Fix it with atomic (one word) or mutex (compound state).
- An atomic operation is a single indivisible CPU instruction (or short sequence with a barrier on ARM).
- The atomic-or-protected rule: never mix atomic and non-atomic access to the same word. The race detector enforces this since Go 1.19.
- Five operations: `Load`, `Store`, `Add`, `Swap`, `CompareAndSwap`. Anything more complex is a CAS loop.
- Use the typed atomics: `atomic.Int64`, `atomic.Bool`, `atomic.Pointer[T]`. They are clearer, type-safe, and self-align on 32-bit platforms.
- `atomic.Value` is legacy; prefer `atomic.Pointer[T]` for new code.
- Single-word, single-op invariants → atomic. Multi-field or compound → mutex.
- Lock-free does not mean free. Atomics still cost ~20-30 cycles each, and adjacent atomics cause false sharing.

Master these and you can debate "mutex or atomic?" in any code review.

## Further reading

- The Go Memory Model — https://go.dev/ref/mem
- `sync/atomic` package documentation — https://pkg.go.dev/sync/atomic
- Proposal #50860 (Go 1.19 typed atomics) — https://github.com/golang/go/issues/50860
- Russ Cox, "Updating the Go Memory Model" — https://research.swtch.com/gomm
- Dmitry Vyukov, "Go's work-stealing scheduler" — for context on goroutine scheduling and why spinning is bad

Move on to `professional.md` for production patterns (Prometheus, RCU, sharded counters, cache-line padding), or to `find-bug.md` to test your understanding by spotting bugs.

---

## Appendix A — Reading the assembly

For the curious. On amd64, `atomic.AddInt64` compiles to roughly:

```
0x0044  MOVQ    AX, 0x10(SP)
0x0049  LOCK
0x004a  XADDQ   AX, 0(BX)
```

The `LOCK` prefix is the magic. Without it, `XADDQ` would do load-add-store but other CPUs could interleave. With it, the CPU holds the cache line in exclusive state for the duration.

For `atomic.CompareAndSwapInt64`:

```
0x00c4  MOVQ    AX, AX
0x00c7  LOCK
0x00c8  CMPXCHGQ  CX, 0(BX)
0x00cd  SETEQ   AL
```

`CMPXCHGQ` (compare-and-exchange, quadword): if `RAX == [BX]`, set `[BX] = CX` and ZF=1. Else, load `[BX]` into `RAX` and ZF=0. `SETEQ` reads ZF into the low byte of `RAX` for Go's `bool` return.

For `atomic.LoadInt64`:

```
0x0123  MOVQ    0(BX), AX
```

Just a plain `MOVQ`. On amd64, aligned 8-byte loads are already sequentially consistent at the hardware level. The compiler treats the call as a barrier — it does not reorder around it — but no extra instruction is needed.

For `atomic.StoreInt64`:

```
0x0234  XCHGQ   AX, 0(BX)
```

`XCHG` is implicitly locked on amd64. A plain `MOVQ` would NOT provide SC store semantics; `XCHG` does. (`MFENCE` after `MOVQ` would also work, but `XCHG` is cheaper.)

You can inspect Go's atomic compilations yourself:

```bash
go build -gcflags='-S' yourfile.go 2>&1 | less
```

Or use `objdump`:

```bash
go build -o bin yourfile.go
go tool objdump -s 'YourFunc' bin
```

---

## Appendix B — Stack vs heap allocation of atomics

A common question: where does my `atomic.Int64` live?

```go
func makeCounter() *atomic.Int64 {
    var n atomic.Int64
    return &n // escapes to heap (caller holds the pointer)
}

func usesCounter() {
    var n atomic.Int64
    n.Add(1)
    // n stays on the stack
}
```

The Go escape analyser decides. If the address of `n` is taken and stored somewhere that outlives the function, it escapes to the heap. Otherwise it stays on the stack.

For atomics this rarely matters — the cost is the same — but it matters for alignment on 32-bit platforms. Heap-allocated structs are guaranteed 8-byte aligned (the allocator guarantees this). Stack-allocated structs are aligned to 8 on goroutine stacks since the runtime maintains 8-byte stack alignment.

Where alignment can break: an `int64` field NESTED inside a struct on the stack, where the struct's layout puts the field at an odd offset. The `atomic.Int64` typed atomic (Go 1.19+) carries `align64` which the compiler recognises and uses to insert padding before the field. Without `atomic.Int64`, you must arrange the layout yourself.

---

## Appendix C — The `sync.Once.Do` implementation

`sync.Once.Do` is a useful case study because it combines an atomic and a mutex:

```go
type Once struct {
    done atomic.Uint32
    m    sync.Mutex
}

func (o *Once) Do(f func()) {
    if o.done.Load() == 0 {
        o.doSlow(f)
    }
}

func (o *Once) doSlow(f func()) {
    o.m.Lock()
    defer o.m.Unlock()
    if o.done.Load() == 0 {
        defer o.done.Store(1)
        f()
    }
}
```

Fast path: one atomic load. If `done` is 1, return immediately. This is the common case (after the first call).

Slow path: take the mutex, double-check (because another goroutine might have finished `f` between our atomic load and our Lock), run `f`, mark done.

The pattern is "atomic load for fast path, mutex for slow path." This minimises the cost of the common case (no Lock) while keeping the slow path correct (only one goroutine ever runs `f`).

Notice the `done.Store(1)` is deferred. That ensures `f`'s side effects are visible to any goroutine that observes `done == 1`, because the Store (a sequentially-consistent operation) happens after `f` completes.

This is the "double-checked locking" pattern, which is famously broken in Java (without `volatile`) and C++ (without atomics with the right memory ordering). In Go, with the SC atomic, it works correctly.

---

## Appendix D — Why `Add` exists when CAS could do everything

Theoretically, every atomic operation can be implemented as a CAS loop:

```go
func myAdd(x *atomic.Int64, delta int64) int64 {
    for {
        old := x.Load()
        new := old + delta
        if x.CompareAndSwap(old, new) {
            return new
        }
    }
}
```

So why does `Add` exist as a separate operation?

**Performance.** On amd64, `LOCK XADD` is one instruction. The CAS loop is `LOAD` + `LOCK CMPXCHG`, which is two instructions plus a branch, and retries under contention. `Add` is faster.

**Semantic clarity.** `x.Add(1)` says "add 1, atomically." `for { old := x.Load(); ... x.CompareAndSwap(...) }` says "I want to do something more complex." Reaching for CAS signals "this operation is non-trivial."

**Wait-freedom.** `Add` is wait-free: every goroutine makes progress in O(1). The CAS loop is lock-free but not wait-free (under contention, a goroutine may retry many times).

So: use `Add` when the operation is additive. Use CAS when it is not.

---

## Appendix E — A small CAS loop visualisation

Imagine three goroutines (G1, G2, G3) all trying to set a counter to "old + 1" via CAS loop:

```
Time   x value  G1                G2                G3
0      5        Load -> 5
1      5                          Load -> 5
2      5                                            Load -> 5
3      5        CAS(5,6) -> true
4      6
5      6                          CAS(5,6) -> false (x is 6, not 5)
6      6                          Load -> 6
7      6                                            CAS(5,6) -> false
8      6                          CAS(6,7) -> true
9      7                                            Load -> 7
10     7                                            CAS(7,8) -> true
11     8
```

All three goroutines incremented. The final value is 8. No goroutine ever lost its update; the CAS loop guarantees that.

The "wasted" work is the CAS calls that returned false (G2 and G3's first attempts). Under heavy contention this wasted work can dominate; that is why for additive operations, `Add` (one instruction, no loop) wins.

---

## Appendix F — Atomic operation cost table

Approximate cycles on a modern amd64 CPU. Numbers vary by CPU generation, contention, and cache state.

| Operation | Cycles (uncontended) | Cycles (contended) | Notes |
|---|---|---|---|
| Plain `int64 = 5` | 1 | 1 | Compile-time; no synchronisation |
| `atomic.LoadInt64` | 1 | 1 | Plain MOVQ on amd64 |
| `atomic.StoreInt64` | 20-30 | 30-50 | XCHG, implicitly locked |
| `atomic.AddInt64(&x, 1)` | 20-30 | 50-200 | LOCK XADD |
| `atomic.CompareAndSwapInt64` | 20-30 | 50-200 | LOCK CMPXCHG, may retry |
| `sync.Mutex.Lock` (uncontended) | 50-80 | — | One CAS + housekeeping |
| `sync.Mutex.Lock` (contended) | — | 1000-3000 | Futex park, context switch |
| `sync.Mutex.Unlock` (uncontended) | 20-30 | — | Just an atomic store |
| `sync.Mutex.Unlock` (with waiter) | — | 500-1500 | Futex wake |
| Channel send/recv (unbuffered) | — | 100-200 | Goroutine handoff |

The takeaway: atomic is 2-3x faster than uncontended mutex, and 50-100x faster than contended mutex. Channels are slower than both, even uncontended.

---

## Appendix G — Cross-platform atomic alignment

Quick reference for 64-bit atomic alignment requirements on each platform:

| Platform | 64-bit atomic alignment | Notes |
|---|---|---|
| amd64 | 8 bytes (automatic) | All `int64` are naturally aligned |
| arm64 | 8 bytes (automatic) | Same |
| ppc64 | 8 bytes (automatic) | Same |
| riscv64 | 8 bytes (automatic) | Same |
| 386 | 8 bytes (MANUAL) | First field in struct or use `atomic.Int64` |
| arm (32-bit) | 8 bytes (MANUAL) | Same — this is the famous gotcha |
| mips32 | 8 bytes (MANUAL) | Same |

If your code might run on 32-bit ARM (Raspberry Pi, embedded devices, older Android), always use `atomic.Int64`/`atomic.Uint64` (Go 1.19+) or arrange your struct layout manually.

---

## Final thoughts

The first time you reach for `atomic`, you will write something subtly wrong. The race detector will catch it. You will fix it. You will write something else subtly wrong. The race detector will catch that too. After a dozen iterations, the patterns will click.

The mental model that works:

- Every shared word has ONE access mode: atomic or mutex-protected. Never both.
- An atomic operation is a CPU instruction. Anything more complex is a CAS loop.
- A CAS loop has no side effects in its body.
- The atomic-or-protected rule is enforced by the race detector — use it on every test.
- Performance gains from atomic are real but measured in nanoseconds. They matter on hot paths and only on hot paths.

These rules will carry you through 95% of concurrent Go code. The remaining 5% (lock-free data structures, hand-rolled synchronisation primitives, custom memory ordering) is the realm of Go runtime developers and a small handful of library authors. You do not need to live there.

---

## Appendix H — Walking through `atomic.Int64` step by step

Let us trace what happens when you call `c.n.Add(1)` where `c.n` is an `atomic.Int64`.

```go
type Counter struct {
    n atomic.Int64
}

func (c *Counter) Inc() {
    c.n.Add(1)
}
```

### Step 1: Method dispatch

`c.n.Add(1)` resolves to `(*atomic.Int64).Add`. The method is defined in `src/sync/atomic/type.go`:

```go
func (x *Int64) Add(delta int64) (new int64) {
    return AddInt64(&x.v, delta)
}
```

So `c.n.Add(1)` is a thin wrapper around `AddInt64(&c.n.v, 1)`. The wrapper exists for type safety (no plain `int64` access) and to give a more readable API.

### Step 2: `AddInt64` is intrinsic

`AddInt64` is declared in `src/sync/atomic/doc.go` as:

```go
func AddInt64(addr *int64, delta int64) (new int64)
```

with no Go body. The implementation is provided by the runtime via assembly. The compiler recognises `sync/atomic` functions as intrinsics and inlines the appropriate assembly.

### Step 3: amd64 assembly

The compiler emits:

```
MOVQ    $1, AX              // delta into AX
LOCK
XADDQ   AX, 0(BX)           // atomic add: *BX += AX, AX gets old value
ADDQ    $1, AX              // compute new value: old + delta
```

(In recent Go versions the implementation may be more sophisticated, but the principle is the same.)

The `LOCK XADDQ` is the atomic part. While it executes, no other CPU can access the cache line containing `c.n.v`.

### Step 4: Memory ordering

After the `LOCK XADDQ`, the new value is visible to every other CPU. Any goroutine that subsequently does `c.n.Load()` will see at least the new value. (It may see a value modified by a later `Add` on yet another goroutine, but never a value older than the most recent `Add` it observed.)

### Step 5: Returning

The new value is returned in `AX` (Go's amd64 calling convention). The caller can use it or ignore it.

### Total cost

On a modern amd64 CPU:
- Without contention: ~20 cycles for the `LOCK XADDQ`, plus a few cycles for the return.
- With contention: the same instruction takes longer because the cache coherency protocol has to migrate the cache line between cores.

For comparison, a mutex `Lock`/`Unlock` pair is ~50-80 cycles uncontended.

---

## Appendix I — Common variants explained

### `atomic.LoadInt64` vs `atomic.Int64.Load`

Identical machine code. The first takes `*int64`, the second is a method on `*atomic.Int64`. Prefer the typed version in new code.

### `atomic.AddInt64` vs `atomic.Int64.Add`

Same.

### `atomic.StorePointer` vs `atomic.Pointer[T].Store`

The first takes `*unsafe.Pointer`, requires manual casts. The second is typed and includes the GC write barrier. Always prefer the second.

### `atomic.Value.Store` vs `atomic.Pointer[T].Store`

`atomic.Value` accepts any interface{}, checks type at runtime, boxes the value. `atomic.Pointer[T]` accepts only `*T`, checks at compile time, stores the raw pointer. The typed version is faster and clearer; use it.

### `atomic.LoadUint32` vs `atomic.Bool.Load`

`atomic.Bool` is implemented as `uint32` internally but exposes a `bool` interface. The compile-time type difference helps catch mistakes (`if b.Load() == 1` does not compile).

---

## Appendix J — Putting it all together — a small library

Here is a complete small library that exercises many of the patterns from this page:

```go
package metrics

import (
    "sync/atomic"
    "time"
)

// Counter is a lock-free counter.
type Counter struct {
    v atomic.Int64
}

func (c *Counter) Inc()         { c.v.Add(1) }
func (c *Counter) Add(n int64)  { c.v.Add(n) }
func (c *Counter) Get() int64   { return c.v.Load() }
func (c *Counter) Reset() int64 { return c.v.Swap(0) }

// MaxTracker records the largest value observed.
type MaxTracker struct {
    v atomic.Int64
}

func (m *MaxTracker) Observe(v int64) {
    for {
        old := m.v.Load()
        if v <= old {
            return
        }
        if m.v.CompareAndSwap(old, v) {
            return
        }
    }
}

func (m *MaxTracker) Max() int64 { return m.v.Load() }

// LastTime records the last time an event happened, atomically.
type LastTime struct {
    nanos atomic.Int64
}

func (lt *LastTime) Touch()              { lt.nanos.Store(time.Now().UnixNano()) }
func (lt *LastTime) Get() time.Time      { return time.Unix(0, lt.nanos.Load()) }
func (lt *LastTime) Since() time.Duration { return time.Since(lt.Get()) }

// Flag is a one-shot boolean.
type Flag struct {
    v atomic.Bool
}

func (f *Flag) Set() bool   { return f.v.CompareAndSwap(false, true) }
func (f *Flag) IsSet() bool { return f.v.Load() }

// ConfigStore publishes a *Config atomically (RCU-style).
type Config struct {
    Endpoints []string
    Timeout   time.Duration
}

type ConfigStore struct {
    p atomic.Pointer[Config]
}

func NewConfigStore(initial *Config) *ConfigStore {
    cs := &ConfigStore{}
    cs.p.Store(initial)
    return cs
}

func (cs *ConfigStore) Get() *Config { return cs.p.Load() }
func (cs *ConfigStore) Set(c *Config) { cs.p.Store(c) }
```

Every type in this library is:
- Safe under `go test -race`.
- Lock-free (no mutex anywhere).
- Backed by typed atomics for clarity and 32-bit safety.
- One word, one operation per method (except `MaxTracker.Observe`, which has a CAS loop).

This is the surface area of "atomic" you will use in production. Anything more complex deserves a mutex or a custom design.

---

## Appendix K — Comparison with C++ and Rust

For engineers coming from C++ or Rust, a few notes on what is different in Go:

### C++ `std::atomic<T>`

C++'s `std::atomic` is more powerful and more dangerous:
- Many memory orderings: `relaxed`, `consume`, `acquire`, `release`, `acq_rel`, `seq_cst`.
- Default is `seq_cst` (matching Go).
- Supports atomic on arbitrary trivially-copyable types via lock-free hash (on platforms that support it).
- Has `compare_exchange_strong` (matches Go's CAS) and `compare_exchange_weak` (allows spurious failure, for CAS loops on architectures like ARM).

Go has only sequentially consistent atomics. No relaxed mode. No weak CAS. The simplicity is a feature.

### Rust `std::sync::atomic`

Similar to C++. Has the `Ordering` enum: `Relaxed`, `Acquire`, `Release`, `AcqRel`, `SeqCst`. Most methods take an `Ordering` parameter.

```rust
let x = AtomicI64::new(0);
x.fetch_add(1, Ordering::SeqCst); // equivalent to Go's atomic.Int64.Add(1)
x.fetch_add(1, Ordering::Relaxed); // Go has no equivalent
```

Rust's `Relaxed` is the same as C++'s `relaxed`. It is faster on weakly ordered architectures (no barriers) but harder to reason about. The Go team chose to not expose this.

### Java `volatile` and `AtomicReference`

Java's `volatile` is per-variable acquire-release ordering (weaker than Go's SC atomic). Java's `AtomicReference<T>` is closer to Go's `atomic.Pointer[T]`, with SC ordering and `compareAndSet` semantics.

Java has had typed atomics since the beginning (`AtomicInteger`, `AtomicLong`, `AtomicReference<T>`). Go caught up in 1.19.

### Why Go's design is simpler

Go optimises for code-correctness over peak performance. Sequential consistency is the strongest guarantee, and the easiest to reason about. The cost on weakly ordered architectures (ARM64 mostly) is a memory barrier on each atomic — measurable but rarely the bottleneck in real applications.

If you are coming from C++ and looking for `memory_order_relaxed`, the answer is: you cannot have it in Go. Use atomic anyway; the cost is small.

---

## Quick reference card

A printable summary for your desk:

```
ATOMIC OPERATIONS (sync/atomic)
═══════════════════════════════════════
LOAD:     v := x.Load()
STORE:    x.Store(v)
ADD:      v := x.Add(delta)        // returns NEW value
SWAP:     old := x.Swap(new)
CAS:      ok := x.CompareAndSwap(old, new)

TYPED ATOMICS (Go 1.19+)
═══════════════════════════════════════
atomic.Int32, atomic.Int64
atomic.Uint32, atomic.Uint64
atomic.Uintptr
atomic.Bool
atomic.Pointer[T]
atomic.Value  (legacy; prefer Pointer[T])

THE ATOMIC-OR-PROTECTED RULE
═══════════════════════════════════════
Once a word is accessed atomically anywhere,
ALL accesses must be atomic. The race detector
catches mixed access since Go 1.19.

WHEN TO USE
═══════════════════════════════════════
Single word + single operation  →  atomic
Multiple fields                  →  mutex
Compound operation (cap, etc.)   →  CAS loop or mutex
Hot path?                        →  profile, then decide

ALIGNMENT (32-bit ARM/386/MIPS)
═══════════════════════════════════════
atomic.Int64 / Uint64 have align64 magic
   → safe to use anywhere
Raw int64 with atomic.AddInt64
   → must be first field in struct, or panic

FALSE SHARING
═══════════════════════════════════════
Two atomics on the same 64-byte cache line
ping-pong between cores. Pad with [56]byte
to put each atomic on its own cache line.
ONLY if profiling justifies it.

CAS LOOP TEMPLATE
═══════════════════════════════════════
for {
    old := x.Load()
    new := compute(old)
    if x.CompareAndSwap(old, new) {
        return
    }
}
```
