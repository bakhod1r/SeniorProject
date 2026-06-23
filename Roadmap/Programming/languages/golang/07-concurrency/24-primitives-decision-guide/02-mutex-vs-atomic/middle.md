---
layout: default
title: Mutex vs Atomic — Middle
parent: Mutex vs Atomic
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/02-mutex-vs-atomic/middle/
---

# Mutex vs Atomic — Middle

[← Back](../)

## Table of Contents
1. [What this file assumes](#what-this-file-assumes)
2. [The decision rule, restated precisely](#the-decision-rule-restated-precisely)
3. [Compound invariants: the dividing line](#compound-invariants-the-dividing-line)
4. [Compare-and-swap loops](#compare-and-swap-loops)
5. [atomic.Pointer for lock-free snapshots](#atomicpointer-for-lock-free-snapshots)
6. [The seqlock pattern](#the-seqlock-pattern)
7. [Memory ordering and the Go memory model](#memory-ordering-and-the-go-memory-model)
8. [False sharing and cache lines](#false-sharing-and-cache-lines)
9. [Measuring contention](#measuring-contention)
10. [Common middle-level mistakes](#common-middle-level-mistakes)
11. [Cheat sheet](#cheat-sheet)
12. [Self-assessment checklist](#self-assessment-checklist)
13. [Summary](#summary)
14. [Further reading](#further-reading)

---

## What this file assumes
You can:
- Write a correct `atomic.Int64` counter and a `sync.Mutex`-protected struct.
- Run `-race` and read its output.
- Explain why `n++` from two goroutines is a data race.

You will learn here:
- The exact rule for when atomic is *insufficient* and a mutex is required.
- CAS loops, `atomic.Pointer[T]` snapshots, and the seqlock pattern.
- How the Go memory model defines what atomics guarantee.
- How false sharing silently destroys atomic performance.

---

## The decision rule, restated precisely

> Use `sync/atomic` when, and only when, every operation touches **exactly one machine word** and there is **no invariant that spans two or more words**. The moment you must keep two pieces of state consistent with each other, you need a mutex.

"One word" means one `int32`, `int64`, `uint32`, `uint64`, `uintptr`, `unsafe.Pointer`, or a typed atomic wrapping one of those (`atomic.Int64`, `atomic.Bool`, `atomic.Pointer[T]`). A struct with two fields is two words; you cannot update both atomically.

---

## Compound invariants: the dividing line

A **compound invariant** is a relationship that must hold across multiple variables. Atomics cannot protect one.

```go
// BROKEN: balance and lastTxn must agree, but two atomics can't update together.
type Account struct {
    balance  atomic.Int64
    lastTxn  atomic.Int64 // timestamp
}

func (a *Account) Deposit(amount, ts int64) {
    a.balance.Add(amount) // another goroutine can observe
    a.lastTxn.Store(ts)   // balance updated but lastTxn not yet
}
```

Between the two atomic calls, a reader sees the new balance with the old timestamp. The invariant "balance and lastTxn describe the same transaction" is violated. This needs a mutex:

```go
type Account struct {
    mu      sync.Mutex
    balance int64
    lastTxn int64
}

func (a *Account) Deposit(amount, ts int64) {
    a.mu.Lock()
    defer a.mu.Unlock()
    a.balance += amount
    a.lastTxn = ts
}
```

The test is mechanical: **count the words that must change together.** One word → atomic is a candidate. Two or more → mutex.

---

## Compare-and-swap loops

When the new value depends on the old value AND you want to stay lock-free, use a CAS loop. `CompareAndSwap` writes only if the current value still matches what you read.

```go
// Atomically clamp a maximum: store v only if it's larger than current.
func storeMax(m *atomic.Int64, v int64) {
    for {
        old := m.Load()
        if v <= old {
            return // already at least v
        }
        if m.CompareAndSwap(old, v) {
            return // won the race
        }
        // another goroutine changed it; retry with fresh old
    }
}
```

The loop retries when a competing goroutine modifies the value between `Load` and `CompareAndSwap`. Under low contention it iterates once. Under heavy contention it can spin — at which point a mutex (which parks the goroutine) may actually be cheaper. CAS loops are for *short* computations on a single word.

---

## atomic.Pointer for lock-free snapshots

The most valuable middle-level pattern: read-mostly state behind `atomic.Pointer[T]`, treating the pointed-to value as immutable.

```go
type Config struct {
    Timeout time.Duration
    Hosts   []string
}

type Server struct {
    cfg atomic.Pointer[Config]
}

func (s *Server) Config() *Config { return s.cfg.Load() } // 1 instruction

func (s *Server) Reload(c *Config) { s.cfg.Store(c) }      // swap whole snapshot
```

Readers never block and never coordinate. The writer builds a *new* `Config` and swaps the pointer in one atomic store. This sidesteps the compound-invariant problem: `Timeout` and `Hosts` are multiple words, but they live behind a single pointer that flips atomically. The price is that you must never mutate a published `Config` — copy-on-write only.

---

## The seqlock pattern

When you need lock-free reads of multi-word data that changes occasionally and you can't afford the allocation of a fresh snapshot per write, a seqlock is the advanced tool. A version counter is incremented before and after each write; readers retry if they observe an odd (write-in-progress) or changed version.

```go
type Seqlock struct {
    seq  atomic.Uint64
    x, y int64 // protected, written only by the single writer
}

func (s *Seqlock) Write(x, y int64) {
    s.seq.Add(1)   // becomes odd: write in progress
    s.x, s.y = x, y
    s.seq.Add(1)   // becomes even: write done
}

func (s *Seqlock) Read() (int64, int64) {
    for {
        before := s.seq.Load()
        if before&1 != 0 {
            continue // writer active
        }
        x, y := s.x, s.y
        if s.seq.Load() == before {
            return x, y // no write occurred during read
        }
    }
}
```

Seqlocks favor reads heavily and assume a single writer. They are rare in application code — but they appear in the runtime and high-performance libraries, so recognize one when you see it. Note: the raw-field reads here technically need atomic loads to be race-free under the Go memory model; production seqlocks use `atomic` for the data fields too.

---

## Memory ordering and the Go memory model

Atomics in Go are **sequentially consistent**: all goroutines observe atomic operations in a single total order. This is stronger (and simpler) than C/C++'s relaxed/acquire/release menu. The Go memory model (https://go.dev/ref/mem) states that a particular atomic read observes a particular atomic write, and this establishes happens-before edges just like channel operations and mutex Lock/Unlock.

Practical consequences:
- An `atomic.Bool` flag set by goroutine A and observed `true` by goroutine B means everything A did *before* the store is visible to B *after* the load — but only for data the flag is documented to "publish".
- You cannot mix atomic and non-atomic access to the *same* variable. If one goroutine writes `x` with `atomic.StoreInt64` and another reads it with a plain `x`, that is a data race.

---

## False sharing and cache lines

Atomics are fast until two of them share a CPU cache line (64 bytes on most hardware). Then each write by one core invalidates the other core's cached copy, and "independent" counters serialize.

```go
// BAD: both counters in one cache line → false sharing
type Counters struct {
    a atomic.Int64 // bytes 0-7
    b atomic.Int64 // bytes 8-15 — same 64-byte line
}

// GOOD: pad to separate cache lines
type Counters struct {
    a atomic.Int64
    _ [56]byte // padding to push b to the next line
    b atomic.Int64
}
```

If a benchmark shows atomic counters scaling *worse* than expected as you add cores, suspect false sharing before anything else.

---

## Measuring contention

Use `go test -bench` with rising `-cpu` counts and `runtime/pprof`'s mutex/block profiles.

```go
func BenchmarkAtomic(b *testing.B) {
    var n atomic.Int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            n.Add(1)
        }
    })
}
```

Run with `go test -bench=. -cpu=1,2,4,8`. A primitive that scales linearly with cores is uncontended; one that flatlines is contended. Enable the mutex profile (`runtime.SetMutexProfileFraction(1)`) to find which lock is the bottleneck.

---

## Common middle-level mistakes
1. **Two atomics for one invariant.** If two fields must agree, a mutex is mandatory — no exceptions.
2. **Mixing atomic and plain access** to the same variable. Always atomic, or always under a lock — never both.
3. **CAS loop on a contended word** that does heavy work per iteration. Spinning burns CPU; a mutex parks the goroutine.
4. **Mutating a published `atomic.Pointer` target.** Snapshots must be immutable after `Store`.
5. **Ignoring false sharing** in hot per-core counters.
6. **Using `atomic` for a `map` or `slice` header.** These are multi-word; protect with a mutex or swap whole via `atomic.Pointer`.
7. **`atomic.AddInt64` on a misaligned field** (32-bit platforms). Typed atomics (`atomic.Int64`) guarantee alignment; the old function API on a struct field does not.

---

## Cheat sheet

| Scenario | Choice |
|---|---|
| Single counter | `atomic.Int64` |
| Single boolean flag | `atomic.Bool` |
| New value depends on old, lock-free | CAS loop |
| Read-mostly multi-field config | `atomic.Pointer[T]` + copy-on-write |
| Two+ fields must change together | `sync.Mutex` |
| Map or slice contents | `sync.Mutex` / `sync.RWMutex` |
| Per-core hot counters | padded `atomic.Int64` |
| Occasional multi-word write, hot reads | seqlock (rare) |

---

## Self-assessment checklist
- [ ] I can state the one-word rule and apply it to a struct.
- [ ] I can write a correct `storeMax` CAS loop.
- [ ] I can build a lock-free config reload with `atomic.Pointer[T]`.
- [ ] I know why mixing atomic and plain access is a race.
- [ ] I can recognize and fix false sharing with padding.
- [ ] I know when a CAS loop is worse than a mutex.

---

## Summary
Atomics protect exactly one word; mutexes protect invariants spanning many. Use CAS loops when the new value depends on the old and the work is tiny. Use `atomic.Pointer[T]` with immutable snapshots to give readers lock-free access to multi-field state. Respect the Go memory model's sequential consistency, never mix atomic and plain access, and watch for false sharing in hot counters. When two fields must agree, stop reaching for atomics and take the lock.

In `senior.md` we turn these rules into refactors and production decisions: migrating a hot mutex to an atomic snapshot, justifying the change with measurements, and designing APIs that don't leak their synchronization choice.

---

## Further reading
- The Go Memory Model — https://go.dev/ref/mem
- `sync/atomic` package docs — https://pkg.go.dev/sync/atomic
- "Go 1.19 atomic types" release notes — https://go.dev/doc/go1.19#atomic_types
- Dmitry Vyukov, "False sharing" notes (1024cores)

---

[← Back](../)
