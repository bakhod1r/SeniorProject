# Memory Fences — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Four Memory Orderings](#the-four-memory-orderings)
3. [x86 TSO Compared with ARM Weak Ordering](#x86-tso-compared-with-arm-weak-ordering)
4. [What Go's Atomics Actually Guarantee](#what-gos-atomics-actually-guarantee)
5. [Happens-Before Through Fences](#happens-before-through-fences)
6. [Worked Example: Store Buffer Reordering](#worked-example-store-buffer-reordering)
7. [Worked Example: Dekker's Algorithm](#worked-example-dekkers-algorithm)
8. [Compiler Fences vs Hardware Fences](#compiler-fences-vs-hardware-fences)
9. [The Cost of a Fence](#the-cost-of-a-fence)
10. [Reading Atomic Code with Fences in Mind](#reading-atomic-code-with-fences-in-mind)
11. [Common Patterns and Anti-Patterns](#common-patterns-and-anti-patterns)
12. [Self-Assessment Checklist](#self-assessment-checklist)
13. [Summary](#summary)

---

## Introduction
> Focus: "How do the four ordering modes work? Why do x86 and ARM disagree, and how does Go paper over the difference?"

At junior level we settled on a one-sentence rule: every call into `sync/atomic` acts as a full memory fence. That rule is sufficient for everyday Go code. At middle level we look behind it — we name the four memory orderings used by every modern language and CPU, we examine the two memory models Go runs on most often (x86 TSO and ARM weak), and we walk through two classical examples that show what a fence prevents.

The aim is not to make you re-implement `sync/atomic`. It is to make you fluent enough to read other people's lock-free code, to know which guarantees you can rely on when porting to ARM, and to follow the next two levels (`senior.md` and `professional.md`) without losing the thread.

---

## The Four Memory Orderings

Every memory model in common use names four orderings. C++ exposes them as `std::memory_order` enumerators; Rust as `Ordering`; Java's `VarHandle` as `getAcquire`, `setRelease`, and friends. Go exposes none of them — Go atomics are always the strongest of the four. But understanding what those four are is essential for reading any non-Go lock-free literature.

### 1. Relaxed

A relaxed atomic operation is atomic in the narrow sense — no torn read, no torn write — but imposes no ordering on any surrounding operation. The compiler and the CPU are free to reorder relaxed operations among themselves and around them, as long as program order within one thread is preserved for the same address.

Use case in C++: counters that are read only for monitoring, never used for synchronisation. Example: a packets-received counter that the operator reads once per minute. The fence cost would dominate the increment cost.

Go does not expose relaxed semantics. Every Go atomic is at least seq_cst.

### 2. Acquire

An *acquire* operation is a load that establishes one half of a release/acquire synchronisation. After an acquire load on variable `v`:

- No subsequent load or store may be reordered above the acquire.
- The thread observes every write that happened-before the matching *release* store to `v`.

You can think of acquire as a one-way fence: things from before may move forward across it, but things from after may not move back across it. Pictorially:

```
      ...
      ┌───── acquire load v ─────┐
      │                          │  (operations after stay below)
      ▼                          │
```

### 3. Release

A *release* operation is a store that establishes the other half. Before a release store to `v`:

- No prior load or store may be reordered below the release.
- A thread that observes the released value via an *acquire* load synchronises with this thread.

Acquire and release pair: a release on the writer plus an acquire on the reader produces a happens-before edge from one thread to the other. This is enough to publish a struct safely — the canonical pattern is the one we saw in junior.md as Example 5.

### 4. Sequentially Consistent (seq_cst)

The strongest ordering. Every seq_cst operation participates in a single global total order. Every thread, every CPU agrees on this order. Pictorially: take all seq_cst operations from every thread, line them up on one timeline that respects each thread's program order; all CPUs see that timeline.

Why is seq_cst stronger than acquire/release? Because acquire/release only orders operations on the same variable. seq_cst orders all seq_cst operations across all variables.

Example where seq_cst is needed but acquire/release is not:

```
Thread 1            Thread 2
----                ----
x = 1               y = 1
r1 = y              r2 = x
```

With seq_cst, at least one of `r1`, `r2` must be `1`. With acquire/release on different variables, both can be `0`. This is the IRIW (Independent Reads of Independent Writes) test.

Go's atomics are seq_cst. So all Go programs avoid the "both zero" outcome above when `x`, `y` are `atomic.Int64`.

---

## x86 TSO Compared with ARM Weak Ordering

The two hardware models that matter most for Go programmers running on production servers are x86 (TSO) and ARM64 (weak). Knowing how they differ explains why fence cost is much higher on ARM.

### x86 Total Store Order

Sewell, Sarkar, Owens, and Myreen formalised x86's behaviour in 2010 in their paper "x86-TSO: A Rigorous and Usable Programmer's Model for x86 Multiprocessors." Their model is now the reference description. The core picture:

```
  CPU 0              CPU 1
  │ store buffer │   │ store buffer │
  └──────┬───────┘   └──────┬───────┘
         ▼                  ▼
   ┌──────────────────────────────────┐
   │      shared memory / cache       │
   └──────────────────────────────────┘
```

Each CPU has its own FIFO *store buffer*. Stores are placed in the buffer and drain to memory in the order they were issued. Loads first check the local store buffer, then go to memory. The only reordering TSO allows is that *a load from address A on CPU 0 may be performed before a store to address B on CPU 0 has drained to memory*, where A is a different address than B.

The allowed reorderings on TSO:

| Earlier op | Later op | Allowed? |
|---|---|---|
| Load → Load (same/different address) | No |
| Load → Store | No |
| Store → Store | No |
| Store → Load (different address) | YES — the only TSO reordering |
| Store → Load (same address) | No (store-forwarding via the buffer) |

Why does TSO allow store → load? Because that is exactly what the store buffer enables. The CPU has issued the store; it is in the buffer. The CPU then issues a load. Rather than stall the load while waiting for the store to drain, the CPU may execute the load early. From the outside, a later observer sees the load before the store.

To prevent this, you use `MFENCE` or any `LOCK`-prefixed instruction. Both drain the store buffer.

### ARM Weak Model

ARMv8 allows nearly every reordering. The default ARM ordering rules:

| Earlier op | Later op | Allowed? |
|---|---|---|
| Load → Load | YES (unless data dependency) |
| Load → Store | YES |
| Store → Store | YES |
| Store → Load | YES |

To prevent reordering, ARM provides:

- `DMB ISH` — full data memory barrier. Outer-shareable: applies across the entire system.
- `DMB ISHST` — store-store and load-store barrier (lighter).
- `DMB ISHLD` — load-load and load-store barrier (lighter).
- `DSB` — data synchronisation barrier. Stronger than `DMB`; waits for all prior operations to complete, not just be observed.
- `ISB` — instruction synchronisation barrier. Flushes the pipeline.

ARMv8 also added one-sided ordering primitives, attached to specific load and store instructions:

- `LDAR` — load-acquire. The load itself carries acquire semantics.
- `STLR` — store-release. The store itself carries release semantics.
- `LDAXR` / `STLXR` — exclusive variants used in LL/SC loops for CAS.

A combination of `LDAR` and `STLR` provides release/acquire ordering. To get true seq_cst on ARM you need a stronger barrier, but on ARMv8 the implementation choice for Go is `LDAR`/`STLR` plus an extra fence on the store side or use of the dedicated atomic instructions added in ARMv8.1.

### Why this matters

A program that synchronises only through atomics is correct on both architectures. A program that omits atomics may work on x86 because TSO masks most reordering — and break on ARM where every reordering is allowed. This is the most common "works on my Mac, fails in CI on Graviton" bug pattern.

---

## What Go's Atomics Actually Guarantee

The Go memory model says (in Go 1.19+ wording):

> The APIs in the `sync/atomic` package are collectively "atomic operations" that can be used to synchronise the execution of different goroutines. If the effect of an atomic operation A is observed by atomic operation B, then A is synchronized before B. All the atomic operations executed in a program behave as though executed in some sequentially consistent order.

Three concrete promises from this passage:

1. **Atomic synchronizes-before atomic.** A reader that observes a writer's atomic value receives a happens-before edge from the writer.
2. **A single global order exists for atomic operations.** Every thread agrees on it.
3. **The order respects program order in each goroutine.** No reordering at the language level.

From these, you can derive everything you need for everyday Go concurrency, including:

- A release on one goroutine and an acquire on another synchronise the two threads.
- Non-atomic writes that happen-before a release atomic are visible after an acquire atomic that observes the release.
- The IRIW outcome is forbidden — at least one of `r1`, `r2` must see the update.

Go does not provide weaker orderings. There is no `atomic.LoadRelaxed`. The argument is pragmatic — most programmers cannot reason about relaxed reliably, and the cost savings rarely justify the risk.

---

## Happens-Before Through Fences

The fence in an atomic operation is the mechanism by which happens-before edges form. Concretely:

### Single-variable case

```go
var v atomic.Int64

// Goroutine 1
v.Store(7) // release of value 7

// Goroutine 2
x := v.Load() // acquire; if x == 7, synchronised with Goroutine 1
```

If Goroutine 2's Load returns 7, then everything Goroutine 1 did before `v.Store(7)` is visible to Goroutine 2 after the Load.

### With non-atomic data

```go
var (
    payload [16]byte
    ready   atomic.Bool
)

// Producer
copy(payload[:], data)
ready.Store(true) // release

// Consumer
for !ready.Load() { // acquire
}
process(payload) // safe — sees the producer's writes
```

The pair `Store(true)` / `Load() == true` creates a happens-before edge. The non-atomic `copy` of `payload` happens-before the Store, so it is visible after the matching Load.

### Through several fences

Happens-before is transitive. If A happens-before B and B happens-before C, then A happens-before C. This is how multi-stage pipelines compose:

```
Stage 1: write data, atomic.Store(handoff1, true)
Stage 2: spin on handoff1; transform data; atomic.Store(handoff2, true)
Stage 3: spin on handoff2; consume data
```

Stage 3 observes Stage 1's data because of two release/acquire pairs and transitivity.

---

## Worked Example: Store Buffer Reordering

This is the canonical example that shows TSO is not seq_cst.

```go
// Two goroutines:
var x, y atomic.Int64
var r1, r2 int64

// Goroutine A
x.Store(1)
r1 = y.Load()

// Goroutine B
y.Store(1)
r2 = x.Load()
```

On a sequentially consistent machine, at least one of `r1`, `r2` must be `1`. The reasoning: if `r1 == 0`, then A's Load of `y` happened before B's Store of `y`. By program order on B, B's Store of `y` happens after B's Store of `x`. So A's Load of `y` happens before B's Store of `x`. Yet B's Load of `x` (which would observe A's Store) is after B's Store of `x`. With seq_cst this forces `r2 == 1`.

On TSO without fences, both `r1 == 0` and `r2 == 0` is possible:

1. A issues `Store x=1`; sits in A's store buffer.
2. A issues `Load y`; sees the old `y` (still 0).
3. B issues `Store y=1`; sits in B's store buffer.
4. B issues `Load x`; sees the old `x` (still 0).
5. Both store buffers drain; both stores propagate. Too late — the loads already returned 0.

Because Go's `sync/atomic` is seq_cst, the program above (using `atomic.Int64`) cannot observe `r1 == r2 == 0`. The compiler inserts the fences that prevent it: an `MFENCE` after each store on x86, or `STLR`-style fences on ARM.

If you instead wrote the example without atomics, all bets are off — even on x86 the compiler can reorder, and on ARM the hardware can too. This is the experiment that demonstrates fence necessity most clearly.

---

## Worked Example: Dekker's Algorithm

Dekker's mutual-exclusion algorithm (1962) is the oldest two-thread lock that does not rely on atomic test-and-set. In its simplest form:

```
flag[0] = false
flag[1] = false
turn    = 0

acquire(i):           // i in {0,1}; j = 1-i
    flag[i] = true
    while flag[j]:
        if turn != i:
            flag[i] = false
            while turn != i:
                ;
            flag[i] = true

release(i):
    turn = 1 - i
    flag[i] = false
```

The algorithm's correctness depends on the store-then-load pattern: thread `i` writes `flag[i] = true`, then reads `flag[j]`. If on TSO the read sees the old `flag[j]`, and on the other side the same thing happens, both threads enter the critical section simultaneously. Mutual exclusion is broken.

Below is a Go translation that is correct because of the seq_cst atomics:

```go
package main

import (
    "sync/atomic"
)

var (
    flag [2]atomic.Bool
    turn atomic.Int32
)

func acquire(i int) {
    j := int32(1 - i)
    flag[i].Store(true)
    for flag[j].Load() {
        if turn.Load() != int32(i) {
            flag[i].Store(false)
            for turn.Load() != int32(i) {
            }
            flag[i].Store(true)
        }
    }
}

func release(i int) {
    turn.Store(int32(1 - i))
    flag[i].Store(false)
}
```

Each store and load is seq_cst, so the store-then-load pattern is correctly ordered: no thread reads the other's flag before its own write has been published. On TSO without atomics, this would silently break.

In practice, never write Dekker's algorithm in Go — `sync.Mutex` is faster, simpler, and battle-tested. The point of the example is to show what a fence buys you. Dekker is the textbook proof that the store-then-load reordering is not academic.

---

## Compiler Fences vs Hardware Fences

A complete memory fence has two halves:

| Half | Stops | Implementation |
|---|---|---|
| Compile-time fence | Compiler reordering | A function call the compiler treats as opaque, or a special intrinsic |
| Hardware fence | CPU reordering | An instruction the CPU executes (`MFENCE`, `DMB ISH`, `lwsync`) |

In Go, the call into `sync/atomic` provides both halves. The function is implemented in assembly; the compiler does not look inside; it does not reorder ordinary memory operations across the call. The assembly emits the right hardware instruction for the target architecture.

A pure compiler-only barrier would not suffice on weak hardware. A pure hardware-only barrier would not suffice when the compiler is allowed to reorder code around it. Both halves matter together.

The C/C++ equivalent of "compile-time only" is `asm volatile("" ::: "memory")` — a no-op assembly directive that tells the compiler "I just touched all memory, do not reorder around me." Go does not expose anything similar because it does not expose explicit fences at all.

---

## The Cost of a Fence

Different architectures pay different costs:

- **x86, uncontended `LOCK`-prefixed op:** ~10–20 cycles (3–6 ns at 4 GHz). The local cache line transitions to Modified; the store buffer drains.
- **x86, contended `LOCK`-prefixed op:** 50–500+ cycles depending on the number of competing cores and cache topology. Cache-line ping-pong dominates.
- **ARM64, `LDAR`/`STLR`:** Roughly similar to x86 uncontended. With the ARMv8.1 atomic instructions (`LDADD`, `CASAL`), even closer.
- **ARM64, `DMB ISH` standalone:** 5–30 cycles depending on the chip. The barrier may need to wait for outstanding loads or stores to complete.
- **POWER9, `sync`:** Tens of cycles; one of the heavier barriers on common server hardware.

Two practical observations:

1. **Uncontended fences are cheap.** Sprinkling a few in normal code does not show up in profiles. The performance worry only appears in tight loops with high contention.
2. **The dominant cost in contended hot paths is not the fence — it is the cache line bouncing.** A `LOCK CMPXCHG` that succeeds without contention is fast. The same instruction in a 32-thread CAS spin loop costs hundreds of cycles per iteration because of MESI traffic.

---

## Reading Atomic Code with Fences in Mind

When you read code that uses `sync/atomic`, treat each atomic call as a horizontal bar drawn across the source. Above the bar lives the prior state of the program; below the bar, the new state. Try this on a real example:

```go
type Queue struct {
    head atomic.Pointer[node]
    tail atomic.Pointer[node]
}

type node struct {
    value int
    next  atomic.Pointer[node]
}

func (q *Queue) Enqueue(v int) {
    n := &node{value: v}
    for {
        t := q.tail.Load()              // [fence 1] acquire snapshot
        next := t.next.Load()           // [fence 2] acquire next
        if t == q.tail.Load() {         // [fence 3] re-check the tail is stable
            if next == nil {
                if t.next.CompareAndSwap(next, n) { // [fence 4] CAS
                    q.tail.CompareAndSwap(t, n)     // [fence 5] move tail
                    return
                }
            } else {
                q.tail.CompareAndSwap(t, next)      // help finish
            }
        }
    }
}
```

Each atomic call is a fence. Fence 1 makes the load of `t` synchronise with whatever the last writer did. Fence 4 publishes the new node — all writes the producer made to `n` (the `value` and a zero `next`) become visible to any consumer who later reads through the same pointer with an acquire load. Without fence 4, a consumer could see the pointer but not the data — the classic safe-publication failure.

When you read someone else's lock-free code, training yourself to see each atomic as a fence first and a payload second is the largest single improvement you can make.

---

## Common Patterns and Anti-Patterns

### Pattern: Single writer publishes, many readers consume

```go
var snapshot atomic.Pointer[State]

func update(s *State) { snapshot.Store(s) }
func read() *State    { return snapshot.Load() }
```

Use this when readers must see a consistent snapshot but writers are rare. The fence inside `Store` publishes the entire `State`.

### Pattern: Stop flag with prompt visibility

```go
var stop atomic.Bool

go func() {
    for !stop.Load() {
        work()
    }
}()

stop.Store(true)
```

The worker observes the new value within one cache-coherence round trip — typically tens of nanoseconds. The fence inside `Store` ensures no compiler hoist keeps the worker spinning forever.

### Anti-pattern: Atomic with companion non-atomic

```go
var ready atomic.Bool
var data int // not atomic

go func() {
    data = 42 // non-atomic write — race if any reader reads non-atomically
    ready.Store(true)
}()
```

The `data` write is safe only because every reader reads `data` *after* a successful `ready.Load()`. If any reader reads `data` without that synchronisation, you have a race. Document the protocol; consider wrapping `data` in a struct read through an `atomic.Pointer`.

### Anti-pattern: Mixing atomics and ordinary locks for the same data

```go
var mu sync.Mutex
var counter atomic.Int64

mu.Lock()
counter.Add(1) // safe — also atomic
mu.Unlock()
```

Mostly harmless but always confused: the mutex already serialises. The atomic is redundant — but not wrong. Pick one mechanism per variable.

### Pattern: Double-checked locking with atomics

```go
var initialized atomic.Bool
var mu sync.Mutex
var resource *Resource

func get() *Resource {
    if initialized.Load() {
        return resource
    }
    mu.Lock()
    defer mu.Unlock()
    if !initialized.Load() {
        resource = build()
        initialized.Store(true)
    }
    return resource
}
```

Correct in Go because `Load` is acquire and `Store` is release. Still, prefer `sync.Once` — shorter, idiomatic, and well-tested.

---

## Self-Assessment Checklist

- [ ] I can name the four memory orderings (relaxed, acquire, release, seq_cst) and explain each.
- [ ] I can sketch the x86 TSO reordering table and the ARM weak reordering table.
- [ ] I know that Go atomics are seq_cst on all platforms.
- [ ] I can explain why the store-buffer reorder breaks Dekker's algorithm without fences.
- [ ] I understand that a fence has two halves: compile-time and runtime.
- [ ] I can estimate the cost of an uncontended atomic on x86 and on ARM.
- [ ] I can read a snippet of lock-free Go and label each atomic as a fence.
- [ ] I know that `sync.Mutex` is built on atomics and inherits their fences.

---

## Summary

Memory orderings come in four flavours: relaxed, acquire, release, and seq_cst. Go offers only the last — every atomic in `sync/atomic` is sequentially consistent and acts as a full fence. The cost differs by hardware: x86 has TSO and needs a fence only on the store-then-load boundary; ARM is weak and needs explicit barriers more often. Go's compiler emits whichever is required, so your Go program sees identical semantics on both. When reading lock-free code, treat each atomic call as a fence first and a payload second; the fence is what makes the algorithm correct.
