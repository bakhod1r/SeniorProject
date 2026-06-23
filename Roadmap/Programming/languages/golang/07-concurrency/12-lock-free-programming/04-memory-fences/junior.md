# Memory Fences — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "Why can two CPUs disagree about the order I wrote my code in? What is a fence, and why does Go almost never make me write one?"

A **memory fence** is a CPU instruction that says: *no memory operation that came before me may move past me, and no memory operation that comes after me may move ahead of me.* It is a barrier in time, applied to loads and stores.

Memory fences exist because both the compiler and the processor reorder memory operations. They do this for performance: it is faster to start a load early or to delay a store while waiting for a cache line. In a single-threaded program these reorderings are invisible — the rules guarantee that the program *appears* to execute in source order. The trouble starts when a second goroutine reads what the first is writing. Now the appearances of the two CPUs may disagree.

The good news for Go programmers: you almost never need to think about fences directly. The Go memory model promises that every operation in `sync/atomic` behaves as if all atomic operations executed in some single, sequentially-consistent order. The compiler and runtime translate that promise into the right hardware instructions on your target — a `LOCK XADDQ` on x86, an `LDAR` / `STLR` pair on ARM64. As long as you reach for `sync/atomic`, `sync.Mutex`, or a channel whenever data is shared between goroutines, fences are handled for you.

The trouble shows up at the edges:

- When you read the source of `runtime`, `sync/atomic`, or a lock-free library and want to know what those instructions do.
- When you bridge to C through Cgo and the C code uses `std::atomic` with `memory_order_relaxed`.
- When you build a lock-free data structure and need to prove its correctness from the rules of the memory model.

This file aims to take you from "I have never heard of a fence" to "I can read a piece of atomic Go code and explain what reorderings it forbids." We will not write any assembly. We will lean heavily on the rule that **a single call into `sync/atomic` is, in practice, a full fence**.

---

## Prerequisites

- **Required:** Go 1.19 or newer. The typed atomic API (`atomic.Int64`, `atomic.Bool`, `atomic.Pointer[T]`) was introduced then; that is what you will see and write.
- **Required:** Comfort with `sync/atomic.Load`, `Store`, `Add`, `CompareAndSwap`. If you have not used them, read the `03-sync-package/07-atomic/junior.md` first; this file builds on that one.
- **Required:** Some exposure to `goroutines`, `channels`, and `sync.Mutex`. You should be able to write a small program that spawns goroutines and waits for them with a `WaitGroup`.
- **Helpful:** Awareness that modern CPUs have multiple cores and per-core caches. We will lean on that picture.
- **Helpful:** A passing knowledge that compilers optimise — they can hoist, sink, and fuse instructions when the result for a single thread looks the same.

If you can compile a small Go program, run it with `-race`, and articulate why `counter++` from two goroutines is broken without atomics, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Memory fence / memory barrier** | A CPU instruction that prevents the hardware (and often the compiler) from reordering memory operations across it. Synonyms in everyday use; "fence" is more common in Go circles, "barrier" in ARM/POWER docs. |
| **Reordering** | The act of executing memory operations in a different order than they appear in the source. Done by the compiler at compile time and by the CPU at runtime. |
| **Memory model** | The contract between a programming language (or a CPU) and the programmer about what reorderings are allowed and what guarantees synchronising operations provide. |
| **Sequential consistency (SC)** | The strongest model. Every operation appears to execute in some single global order that respects each thread's program order. The intuitive "as written" model. |
| **Total Store Order (TSO)** | x86/x86-64's model. Strong, but allows one specific reordering: a store followed by a load of a *different* address may be visible out of order. |
| **Weak memory model** | ARM, ARM64, POWER, RISC-V. Almost any reordering is allowed unless an explicit fence forbids it. |
| **Acquire ordering** | A load with this ordering forbids subsequent loads and stores from being reordered before it. Pairs with release. |
| **Release ordering** | A store with this ordering forbids prior loads and stores from being reordered after it. Pairs with acquire. |
| **Sequentially-consistent ordering (`seq_cst`)** | A load/store with this ordering acts as a full fence. All threads agree on a single global order of `seq_cst` operations. |
| **Relaxed ordering** | Atomic in the sense of "no torn read or write," but with no ordering guarantees relative to other operations. Cheap. Dangerous unless you know what you are doing. |
| **`MFENCE`** | x86's full memory fence instruction. Forbids any reorder of any load/store across it. |
| **`LFENCE` / `SFENCE`** | x86 load fence and store fence. Narrower than `MFENCE`; useful with non-temporal stores and serialising loads. |
| **`DMB` / `DSB` / `ISB`** | ARM's three barrier instructions: Data Memory Barrier, Data Synchronisation Barrier, Instruction Synchronisation Barrier. |
| **`lwsync` / `sync`** | POWER's lightweight and heavyweight synchronisation instructions. |
| **`LOCK` prefix** | An x86 instruction prefix that makes the instruction atomic and behaves as a full memory fence. |
| **Happens-before** | The partial order defined by a memory model that lets us reason about what one thread is guaranteed to see of another's writes. |

---

## Core Concepts

### What is a fence, concretely

A memory fence is an instruction the CPU executes that says, "drain everything you owe before you continue, and do not start anything I have not yet told you to start." On x86 the instruction is `MFENCE`. On ARM it is `DMB ISH`. In Go you almost never name them — they are emitted by the compiler when you call `sync/atomic`.

Pictorially:

```
... earlier loads/stores ...
   ┌─────────────────────────────┐
   │         MEMORY FENCE         │
   └─────────────────────────────┘
... later loads/stores ...
```

The horizontal line is the fence. Earlier operations stay above. Later operations stay below. Neither side may climb past.

### Why reordering exists

Compilers and CPUs reorder for performance. Two examples:

**Compiler example.** The compiler may turn

```go
x = 1
y = 2
z = x + y
```

into something where `x` and `y` are written in a different order, or held in registers and never written to memory if no one else uses them. From the *single-thread* point of view, the result is identical.

**CPU example.** A store sits in the CPU's *store buffer* — a small queue inside the core — for many cycles before reaching the cache. A subsequent load from a *different* address may be served from memory before the buffered store has drained. From the single-CPU point of view, the result is identical.

Both reorderings are invisible to one thread reading its own variables. They become visible the moment a second thread reads the first thread's variables.

### The two layers: compiler and CPU

There are two reorderers, and a fence must address both:

1. **Compiler.** It picks the assembly. It can move instructions around at compile time.
2. **CPU.** It picks the actual execution order at runtime — out-of-order pipelines, store buffers, speculative loads.

A *compile-time* fence (in some languages, an `asm volatile` clobber) stops the compiler. A *hardware* fence stops the CPU. A real memory fence must do both. Go's atomic operations do both, because:

- The compiler treats them as opaque calls whose memory effects are unknown to it, so it cannot reorder loads and stores across them.
- The emitted instruction (`LOCK XADDQ`, `LDAR`, etc.) is a hardware fence.

### Go's promise: atomics are sequentially consistent

The Go memory model contains this single most important sentence for this file:

> All the atomic operations executed in a program behave as though executed in some sequentially consistent order.

That means: take every `Load`, `Store`, `Add`, `Swap`, `CompareAndSwap` in your program; arrange them all on one timeline; every goroutine agrees on that timeline. There is no need to think about acquire or release ordering when you use Go atomics — Go has chosen the strongest setting for you.

So when you write

```go
var ready atomic.Bool
var data int

go func() {
    data = 42
    ready.Store(true)
}()

for !ready.Load() {
    runtime.Gosched()
}
fmt.Println(data) // guaranteed to be 42
```

the `Store(true)` is guaranteed to be observed after `data = 42` by any goroutine that observes the store. The atomic operation acts as a fence; the non-atomic write to `data` cannot float past it.

### Why Go does not expose explicit fences

Other languages — C, C++, Rust — expose `atomic_thread_fence` or `std::atomic_thread_fence`. Go does not. The official reasoning, repeated by Russ Cox and the runtime authors:

1. Every `sync/atomic` operation already implies the appropriate fence.
2. Hand-written fence code is overwhelmingly wrong in the wild. People misuse `memory_order_relaxed` and ship races.
3. Go aims for a *simple* concurrency story. Sequential consistency for atomics is the simplest defensible position.

So instead of writing `atomic_thread_fence(memory_order_acquire)`, you write `atomic.LoadInt64(&ready)`, and Go gives you the same guarantee — and often a slightly stronger one.

### What you still need to know

You still need to know about fences for three reasons:

1. **Reading source.** When you crack open `runtime/internal/atomic/asm_arm64.s` and see `LDAXR` and `STLXR`, you need to know those are acquire and release halves.
2. **FFI.** When you call into C via Cgo, the C code may use weaker orderings. You inherit those weaker guarantees on the C side of the boundary.
3. **Lock-free design.** When you design a new lock-free structure, you reason about which writes must be visible before which reads. Even if Go gives you seq_cst, knowing acquire/release helps you minimise overhead later.

---

## Real-World Analogies

### A fence is an audit checkpoint

Imagine a warehouse where workers move boxes from a backroom to a delivery dock. Each worker can carry several boxes at once and rearrange their order to balance their load. Most of the time this is fine — the boxes arrive at the dock in *some* order, and the customer cares about the contents, not the sequence.

Now insert an auditor at a checkpoint between the backroom and the dock. The auditor says: "Before any of you cross this line, every box from the backroom you have already touched must be on this side. After you cross, you may only carry boxes you pick up from the dock side." The auditor is the fence. The boxes are loads and stores. The reorderings are the load-balancing each worker did.

### A fence is the pause in a relay

Four runners pass a baton. Without coordination, a downstream runner could start before the upstream runner has fully released the baton, and the baton drops. The pause when the baton is firmly in both hands, momentarily, is the fence. Atomic operations are the relay pauses of multi-threaded code.

### A fence is the "send" button in a chat

You can type a long message, edit it, rearrange paragraphs, delete sentences — none of it is visible to the other person until you press send. The send button is the fence. Everyone receives a coherent message that respects the order you finalised. The Go atomic operation is the send button: it commits everything that came before to the shared, ordered timeline.

### A fence is the airlock between two pressure zones

A submarine has an airlock between the high-pressure interior and the open ocean. You cannot move from one side to the other without cycling the lock — without it, the pressure differential would catastrophically equalise. The airlock is the fence; the pressure differential is the difference between one CPU's view of memory and another's.

---

## Mental Models

### Model 1: "Atomic ops are fences with payloads"

Every Go atomic operation does two things: it does the operation (load, store, add, CAS), and it acts as a full memory fence. The payload and the fence are inseparable on Go. You cannot get "just a fence" in Go; you can only get the fence by performing an atomic operation that someone else can observe.

This is why, in lock-free code, you sometimes see what looks like an "unnecessary" `atomic.Load`. Its purpose is the fence, not the value.

### Model 2: "Two timelines, one fence pulls them together"

CPU A and CPU B each have their own ordering of memory operations. Most of the time, those orderings can diverge — A's view of the world and B's view need not agree on the order of unrelated writes.

When A executes a `seq_cst` atomic operation and B executes a `seq_cst` atomic operation, the two timelines briefly synchronise. From that moment on, A knows B has seen everything A had committed up to its fence; B knows A has seen everything B had committed.

### Model 3: "Compile-time prevention plus runtime prevention"

A correct fence has two halves: the compiler does not reorder across it (compile-time half), and the CPU does not reorder across it (runtime half). Both halves matter. A pure compiler barrier without a CPU instruction would let the CPU reorder anyway. A pure CPU instruction without telling the compiler would let the compiler reorder before the instruction ever ran.

Go's `sync/atomic` calls satisfy both halves automatically.

### Model 4: "Sequential consistency is the no-surprises model"

Sequential consistency is what naive programmers expect concurrency to be: each thread executes in order, and there is a single global timeline of memory operations that respects each thread's order. Few CPUs provide it natively; Go provides it for atomic operations. So when you reason with Go atomics, you can use the naive model and it will be correct. That is the whole point of Go's choice.

---

## Pros & Cons

### Pros (of having fences / of Go's seq_cst atomics)

- **Correctness.** Without fences, lock-free algorithms break in non-obvious ways on weak memory models.
- **Portability.** Go atomics behave the same on x86, ARM64, RISC-V. The compiler emits whatever is needed.
- **Simplicity.** With seq_cst, you reason about one global order. Acquire/release/relaxed each require their own discipline.
- **Tooling.** The race detector knows about happens-before via atomics. Mixed atomic and non-atomic access is flagged.
- **Encapsulation.** You can call `atomic.Load` without knowing whether the underlying platform needs a `MOV`, an `LDAR`, or a heavyweight barrier.

### Cons / costs

- **Performance on weak machines.** Sequential consistency on ARM requires explicit barrier instructions on every load and store. On x86 the cost is much smaller.
- **No relaxed atomics.** When you know you do not need ordering (e.g., a statistics counter), Go forces seq_cst overhead.
- **Hidden cost.** Programmers do not see the fences. It is easy to write an `atomic.Add` in a hot loop and discover later that it costs 60 ns under contention.
- **Steep learning curve at the edges.** When you must reason about reordering — designing a lock-free structure or reading C code — Go's silence on fences works against you.

---

## Use Cases

You think about fences directly when you:

- **Read runtime source.** Files like `runtime/internal/atomic/asm_*.s` are full of fence instructions. Knowing what each means saves time.
- **Port a paper or reference implementation.** Academic lock-free papers specify acquire/release/relaxed precisely. Translating to Go means losing some performance (we promote everything to seq_cst) but gaining correctness.
- **Cross the Cgo boundary.** C code may use `memory_order_relaxed`. You must understand what guarantees you do — and do not — inherit.
- **Debug an exotic reordering bug.** Very rare in pure Go because Go's atomics are strong. Common in C/C++ code you might be reviewing.
- **Tune contention.** Knowing that an atomic on x86 is one `LOCK`-prefixed instruction (~10 cycles) while on ARM it is two halves of an LL/SC pair plus barriers (~10-30 cycles) helps you predict performance.

You **do not** think about fences when you:

- Use `sync.Mutex`, channels, or `sync.WaitGroup`. They wrap atomics; the fences are inside.
- Use `sync/atomic` typed values. Same — the fences come for free.
- Use immutable data shared between goroutines once. No ordering question arises.

---

## Code Examples

### Example 1 — The publish/subscribe pattern, fence-guaranteed

```go
package main

import (
    "fmt"
    "runtime"
    "sync/atomic"
)

var (
    data  int
    ready atomic.Bool
)

func main() {
    go func() {
        data = 42         // (1) non-atomic write
        ready.Store(true) // (2) atomic store — acts as release fence
    }()

    for !ready.Load() { // (3) atomic load — acts as acquire fence
        runtime.Gosched()
    }
    fmt.Println(data) // (4) guaranteed to see 42
}
```

The atomic `Store(true)` on line (2) acts as a release fence: every memory operation that came before it — including the non-atomic write to `data` on line (1) — must be globally visible before any goroutine observes the store. The atomic `Load` on line (3) acts as an acquire fence: any operation that happens after it cannot float above it.

Without atomics, line (4) might print 0. With atomics, it prints 42 with full guarantee.

### Example 2 — A second goroutine cannot reorder around a fence

```go
package main

import (
    "fmt"
    "sync/atomic"
)

var (
    x, y int
    a, b atomic.Int64
)

func writer() {
    x = 1       // store to plain memory
    a.Store(1)  // atomic — full fence
    y = 1       // another store to plain memory
    b.Store(1)  // atomic — full fence
}

func reader() {
    for b.Load() != 1 {
    }
    // After this fence, y is guaranteed to be 1.
    // After the same fence, a is guaranteed to be 1.
    // The first fence (a.Store) guarantees x was 1 by then.
    fmt.Println(x, y)
}
```

Both `Store` calls act as fences in the writer. Any reader that observes `b == 1` is guaranteed to also observe `y == 1`, `a == 1`, and `x == 1`. The fence pulls everything before it across the boundary.

### Example 3 — Without the fence: a data race

```go
package main

import (
    "fmt"
    "sync"
)

var (
    data  int
    ready bool // NOT atomic
)

func main() {
    var wg sync.WaitGroup
    wg.Add(1)

    go func() {
        defer wg.Done()
        data = 42
        ready = true
    }()

    for !ready {
        // spin
    }
    fmt.Println(data)
    wg.Wait()
}
```

Running with `go run -race main.go` reports two races: one on `ready`, one on `data`. The compiler is even allowed to hoist `ready = true` above `data = 42`, or to keep `ready` in a register so the reader never sees the true value. Even on x86 — which has TSO and would, in principle, not reorder these stores — the *compiler* can rearrange them at the source level. There is no fence here.

### Example 4 — Mutex's hidden fence

```go
package main

import (
    "fmt"
    "sync"
)

var (
    data int
    mu   sync.Mutex
)

func main() {
    go func() {
        mu.Lock()
        data = 42
        mu.Unlock() // contains a release fence
    }()

    mu.Lock() // contains an acquire fence
    fmt.Println(data)
    mu.Unlock()
}
```

`Mutex.Unlock` is, under the hood, an atomic store that doubles as a release fence. `Mutex.Lock` is, under the hood, an atomic load/CAS that doubles as an acquire fence. Together they sandwich the critical section in fences and make all the writes inside it visible to the next holder of the lock.

### Example 5 — Pointer publication

```go
package main

import (
    "fmt"
    "sync/atomic"
)

type Config struct {
    Hostname string
    Port     int
}

var cfg atomic.Pointer[Config]

func publish() {
    c := &Config{Hostname: "api.example.com", Port: 443}
    cfg.Store(c) // release fence — the Config fields are visible after this
}

func read() {
    c := cfg.Load() // acquire fence
    if c != nil {
        fmt.Println(c.Hostname, c.Port)
    }
}
```

The atomic pointer store acts as a release fence: any writes to the new `Config` value (its `Hostname` and `Port` fields) are visible to any goroutine that loads the pointer. This is the canonical safe-publication pattern in Go.

### Example 6 — A failed CAS is also a fence

```go
package main

import (
    "fmt"
    "sync/atomic"
)

var counter atomic.Int64

func main() {
    counter.Store(10)
    swapped := counter.CompareAndSwap(5, 999) // fails — current is 10, not 5
    fmt.Println(swapped, counter.Load())
}
```

Even though the CAS failed, the operation was still executed as a full fence on every CPU we care about. Hardware does not have a notion of "a CAS that succeeded is a fence, but a CAS that failed is not." Go inherits that — every atomic operation, success or failure, fences.

---

## Coding Patterns

### Pattern: Publish-then-observe

```go
var ready atomic.Bool
var data Payload

// Producer
data = preparePayload()
ready.Store(true)

// Consumer
for !ready.Load() { /* wait */ }
use(data)
```

The atomic store/load are the fences. Anything written before the store is visible after a successful load.

### Pattern: Atomic pointer swap for immutable publication

```go
var current atomic.Pointer[Config]

func reload() {
    next := loadConfig()
    current.Store(next) // safe publication
}

func get() *Config {
    return current.Load()
}
```

The "immutable after publication" rule plus the atomic pointer is enough — no mutex needed for readers.

### Pattern: Double-checked initialisation (use `sync.Once` instead)

```go
// Anti-pattern — do not write this in Go.
var initialized atomic.Bool
var value *Resource

func get() *Resource {
    if !initialized.Load() {
        value = build()
        initialized.Store(true)
    }
    return value
}
```

This is racy: two goroutines can both observe `initialized == false`, both call `build`, and overwrite each other. The fence on `Store` does not help — the *check* and the *initialise* are not one atomic operation. Use `sync.Once`:

```go
var once sync.Once
var value *Resource

func get() *Resource {
    once.Do(func() { value = build() })
    return value
}
```

`sync.Once` is implemented with atomics and a fence; it does the right thing.

### Pattern: Sentinel for "I have finished"

```go
var stop atomic.Bool

go func() {
    for !stop.Load() {
        work()
    }
}()

stop.Store(true) // worker exits within microseconds
```

The fence guarantees the worker observes the new value within the visibility window of the cache-coherence protocol — typically tens of nanoseconds on modern hardware.

---

## Clean Code

### Prefer typed atomics

`atomic.Int64`, `atomic.Bool`, `atomic.Pointer[T]` make the atomic-ness part of the type, prevent accidental non-atomic access, and read more naturally.

```go
var counter atomic.Int64 // good
counter.Add(1)

var counter int64        // worse
atomic.AddInt64(&counter, 1)
counter++ // OH NO — compiler allows it
```

### Group atomic fields together

```go
type Stats struct {
    Requests atomic.Int64
    Errors   atomic.Int64
    // ...
}
```

Padding for cache-line separation is sometimes a step up — see `optimize.md` — but grouping by access pattern is the first move.

### Keep "fences" implicit

Do not comment "atomic — for the fence" everywhere. Trust the language. Comment only where the reordering question is non-obvious — for example, why a particular load must be atomic when you could imagine using a plain read.

### Pair load/store at the same level

If a piece of code stores with an atomic, every read of the same variable should also be atomic. Mixing is a race, even on x86.

---

## Product Use / Feature

### Hot-reloadable configuration

A long-lived server keeps its configuration in an `atomic.Pointer[Config]`. On SIGHUP, a goroutine builds a fresh `Config` and stores the pointer. Every handler reads the pointer once per request and uses the snapshot for the rest of that request. The fence guarantees no handler sees half a config.

### Feature flags

A central goroutine polls a flag service and stores a `*Flags` into an atomic pointer. Every request reads the pointer and consults `flags.IsEnabled("new_path")`. The fence keeps each request consistent.

### Stop signals

A worker loop checks `stop.Load()` between items. A `Stop()` call sets the flag and the goroutine drains. The fence guarantees prompt visibility — typically within one cache-coherence round trip.

### Lock-free statistics

Per-request, every handler does `requests.Add(1)`. The atomic is implicitly fenced; the counter is monotonic; readers see no torn values. Under contention you may shard, but the principle is unchanged.

---

## Error Handling

The atomic operations themselves do not error. The reordering bugs they prevent manifest as wrong values, missing updates, or stuck consumers — not as panics. Most "error handling" in fence-related code is preventative:

- Always use atomic for both writer and reader.
- Use `go vet` and `-race` in CI.
- Treat any data race report as a bug regardless of how rarely it fires; the absence of a fence today is the corruption of tomorrow on a new architecture.

If you must bridge to C and consume a `memory_order_relaxed` value, document it. Treat the boundary as "we lose the seq_cst guarantee here; what is left is acquire/release at best." Wrap the call in a Go function whose comment explains the weakening.

---

## Security Considerations

### Reordering as a side channel

Speculative execution attacks (Spectre, Meltdown) rely on the CPU executing operations the program never officially committed to, and then leaking information through cache timings. Memory fences (`LFENCE` on x86) are part of the mitigation toolkit. Go applications usually run with the OS-level mitigations enabled; the compiler does not insert speculation barriers itself.

For most application code, this is the OS's and CPU vendor's problem. For cryptographic code that operates on secrets, the standard advice is to use the standard library's `crypto/subtle` package, which is hardened against timing variation, rather than to scatter fences yourself.

### Token visibility

When publishing a security-critical token (a JWT, a session ID, a CSRF nonce) via an atomic pointer, the fence guarantees the consumer cannot observe a half-constructed token. The bytes you wrote into the struct's fields are visible by the time the consumer reads the pointer. This is exactly the safe-publication property.

---

## Performance Tips

- **Atomic ops are not free.** On x86, an uncontended `LOCK XADDQ` is about 10 cycles (~3 ns). On ARM64, an `LDAR/STLR` pair is similar. Under contention, both can balloon to hundreds of cycles as cache lines bounce.
- **Reads are far cheaper than writes.** An atomic load on x86 is a plain `MOV` — same speed as a non-atomic read. On ARM, `LDAR` adds a small barrier cost.
- **Group reads and writes.** Do not call `atomic.Load` four times when one load and a local copy will do. Each call is a fence.
- **Pad against false sharing.** When two atomic fields live on the same 64-byte cache line and are written by different cores, every increment pings the other core. Pad with `_ [56]byte` (64-byte line minus 8-byte counter).
- **Shard counters.** For very hot counters, keep one per goroutine or per CPU and sum on read.

We cover these in detail in `optimize.md` and in `professional.md`. At the junior level: trust the atomic, profile, then optimise.

---

## Best Practices

1. **Use the typed atomic API** (`atomic.Int64`, `atomic.Bool`, `atomic.Pointer[T]`) — Go 1.19+.
2. **Treat every atomic access as a fence-emitting operation.** Read the data flow as if a horizontal bar were drawn through your code at every atomic call.
3. **Never mix atomic and non-atomic access** to the same variable. The race detector flags it; the runtime may corrupt.
4. **Reach for `sync.Mutex` or channels first.** Atomic is the lowest-level tool; pick it only when you have one variable and one of the five primitive operations is enough.
5. **Run `-race` in tests.** It catches missing fences immediately.
6. **Avoid `unsafe.Pointer` in atomic code** unless you have read the rules and need cross-type pointer atomics. `atomic.Pointer[T]` is almost always enough.
7. **Document any deliberate use of relaxed semantics through Cgo.** If you accept a relaxed atomic value at the FFI boundary, write a Go-side comment explaining the implications.

---

## Edge Cases & Pitfalls

### The compiler can still hoist non-atomic reads

If you check a non-atomic flag in a loop:

```go
for !done {
}
```

the compiler is allowed to load `done` once, hold it in a register, and never check it again — because *within one goroutine* the value cannot change between iterations. Use `atomic.Bool` and call `Load()`.

### A fence is not free

Tight loops with one atomic operation per iteration scale badly. Each iteration is a synchronisation event. If you find yourself writing such a loop, consider batching.

### Failed CAS is still a fence

Some programmers expect failed CAS to be cheap. It is *cheaper* than success in some implementations, but it still acts as a fence and consumes the cache line. A high-contention CAS loop pays the fence cost on every attempt.

### Mixed-size atomic access is undefined

Writing a value via `atomic.Int64` and reading it via `atomic.Int32` is not safe. Stick to one size per variable.

### 32-bit alignment on 32-bit platforms

`atomic.Int64` is laid out by the compiler with the correct 8-byte alignment automatically. Raw `int64` plus the legacy `atomic.AddInt64` is not — you must put the field first in its struct or align manually. Use the typed API and the problem disappears.

---

## Common Mistakes

### Mistake 1 — Assuming x86 means no fences are needed

Beginners read that x86 has TSO and conclude that they can skip atomics on x86. The compiler still reorders. The atomic call also tells the compiler to keep its hands off. Skip atomics and even on x86 you have a bug.

### Mistake 2 — Treating one atomic operation as protecting two variables

```go
var a, b atomic.Int64
a.Store(1)
b.Store(1) // reader can see b == 1 while a is still 0? On Go, no — both are seq_cst.
```

This is *not* a mistake on Go because Go's atomics are sequentially consistent — every goroutine agrees on the global order of these stores. But beginners coming from C++ who switch to relaxed orderings can lose this guarantee. In Go, you keep it; in C++, you must opt in.

### Mistake 3 — Using `runtime.Gosched` as a "fence"

```go
data = 42
runtime.Gosched()
ready = true // non-atomic
```

`Gosched` yields the scheduler. It is not a memory fence. The compiler may still reorder; the CPU may still reorder. Use an atomic.

### Mistake 4 — Reading once, expecting fresh values

```go
v := flag.Load()
for !v {
    // spin
}
```

This spins on the local copy `v`, which never changes. Call `flag.Load()` *inside* the loop, every iteration.

### Mistake 5 — Mixing `atomic.AddInt64(&x, 1)` and `x++`

The first is atomic. The second is not. Together they race. The race detector flags it; the program is broken on any architecture.

---

## Common Misconceptions

### "Fences are slow on x86 too"

Compared to a plain `MOV`, yes. But the cost is single-digit nanoseconds uncontended. The dominant cost in hot paths is usually cache contention, not the fence itself.

### "Volatile in C and atomic in Go are the same"

They are not. C's `volatile` is about *preventing the compiler from caching the value in a register*. It says nothing about hardware reordering. C's atomic types and Go's `sync/atomic` are real synchronisation primitives.

### "A fence makes memory consistent"

A fence orders memory operations from one CPU's point of view relative to its own and to others'. It does not flush caches or push values to main memory. Cache coherence is the protocol that makes caches agree; fences are how a thread tells the coherence protocol "drain my buffer now."

### "If my code works on x86, it will work on ARM"

It might, and it might not. x86's TSO masks many reordering bugs. ARM's weak model exposes them. Go's atomics paper over the difference; non-atomic shared access does not. Test on ARM too.

### "Go is missing a feature by not having explicit fences"

Go's choice is deliberate. Adding `atomic.Fence()` would invite exactly the bugs Go is trying to prevent. The few cases that need it can use `runtime.Goexit` or hand-rolled assembly — discouraged, but possible.

---

## Tricky Points

### A non-atomic write between two atomic operations

```go
a.Store(1)
x = 5 // non-atomic
b.Store(1)
```

The two atomic stores establish fences. But the non-atomic write to `x` is racy if any other goroutine reads `x`. The fence does not magically make `x = 5` thread-safe; it only orders memory access *visibility*.

If a reader does `b.Load(); if x == 5 { ... }`, the fence chain is: the reader observes `b == 1`, which happens-after the writer's `b.Store(1)`, which happens-after the writer's `x = 5`. By transitivity, the reader is guaranteed to see `x == 5`. *Provided no other goroutine writes to `x` concurrently.*

### Reading what the compiler emits

```bash
go tool compile -S main.go
```

This prints the Go assembly. Look for `LOCK` prefixes (x86) or `LDAXR`/`STLXR` (ARM). Those are your fences. We dive into this in `professional.md`.

### Architecture-specific behaviour you should not depend on

x86 has TSO; you might write code that "works" because TSO is strong. On ARM with the same code, you will see reorderings. The right rule is: assume the weakest model and rely on Go's atomics to bridge the gap.

---

## Test

### A test that proves the fence works

```go
func TestPublishObserve(t *testing.T) {
    const N = 1000
    for i := 0; i < N; i++ {
        var data int
        var ready atomic.Bool

        done := make(chan struct{})
        go func() {
            data = 42
            ready.Store(true)
            close(done)
        }()

        for !ready.Load() {
        }
        if data != 42 {
            t.Fatalf("iter %d: data = %d, want 42", i, data)
        }
        <-done
    }
}
```

The test passes deterministically because of the fence. If you replace `ready` with a non-atomic `bool`, the race detector will scream, and on ARM you may even see a wrong value once in a while.

### A test for the missing fence

```go
//go:build !race
// (deliberately failing test — race detector would catch it)

func TestMissingFenceShows(t *testing.T) {
    const N = 100000
    for i := 0; i < N; i++ {
        var data int
        var ready bool

        go func() {
            data = 42
            ready = true
        }()

        for !ready {
        }
        if data != 42 {
            t.Logf("iter %d: data = %d (expected 42)", i, data)
        }
    }
}
```

On ARM, you may see lines that print "data = 0". Even on x86, the compiler may hoist `ready` into a register and the loop becomes infinite. The right reaction is to never write this code.

---

## Tricky Questions

### Q1. Is `runtime.Gosched()` a memory fence?

**A.** No. It is a scheduling hint. Use an atomic for any cross-goroutine ordering.

### Q2. Why does my counter sometimes read a value that "shouldn't be possible"?

**A.** Almost certainly mixed atomic and non-atomic access. The race detector finds these in seconds.

### Q3. Is a successful CAS more expensive than a failed CAS?

**A.** Slightly more on x86 (success modifies the cache line; failure may not). Both still act as full fences. The dominant cost is the cache-line bounce under contention, not success or failure.

### Q4. Why does Go not expose `atomic.Fence()`?

**A.** Every atomic operation is already a fence; adding a fence without a payload would invite misuse. The Go team prefers the simpler API.

### Q5. If x86 has TSO and ARM is weak, why does Go give me the same guarantees on both?

**A.** Because Go's compiler inserts the right hardware instructions: a `LOCK XADDQ` on x86 versus an `LDAR/STLR` pair on ARM. Both produce sequentially consistent atomic operations. The runtime cost on ARM is slightly higher because the hardware does more work.

### Q6. Can a fence make my non-atomic shared variable safe?

**A.** No. A fence orders visibility; it does not protect against concurrent writes. If two goroutines write to a plain `int` at the same time, you have a race regardless of any fences around it.

---

## Cheat Sheet

```
Memory fence        = barrier across which loads/stores cannot move
Go atomics          = sequentially consistent + full fences
                      (compile-time + runtime)
Hardware fences     = MFENCE / LFENCE / SFENCE (x86)
                      DMB / DSB / ISB (ARM)
                      lwsync / sync (POWER)
x86 memory model    = TSO — strong, one allowed reorder (store→load)
ARM memory model    = weak — almost anything allowed without fence
POWER memory model  = weak — similar to ARM
Acquire ordering    = no later op moves before
Release ordering    = no earlier op moves after
seq_cst             = full fence; global order of seq_cst ops
relaxed             = atomic but no ordering — Go does NOT expose this
sync.Mutex          = built on atomic; Lock = acquire, Unlock = release
sync/atomic call    = always a full fence on Go, on every platform
```

---

## Self-Assessment Checklist

- [ ] I can explain what a memory fence is in one sentence.
- [ ] I know that Go atomics are sequentially consistent.
- [ ] I can write a publish-observe pattern using `atomic.Bool` and `data`.
- [ ] I understand why `runtime.Gosched()` is not a fence.
- [ ] I can name the four ordering modes (relaxed, acquire, release, seq_cst).
- [ ] I know that x86's TSO is strong and ARM's model is weak.
- [ ] I can name `MFENCE` and `DMB` and say which architecture each belongs to.
- [ ] I can articulate why a fence is needed even on x86 — for the compiler if not the CPU.
- [ ] I never mix atomic and non-atomic access to the same variable.
- [ ] I always run my concurrent code with `-race`.

If you check every box, you are ready for `middle.md`.

---

## Summary

A memory fence is the CPU's mechanism for forbidding reorderings of memory operations. Without fences, multi-threaded programs are at the mercy of compiler optimisation and out-of-order execution; with fences, threads can publish state in a way other threads will observe consistently.

Go's design philosophy makes fences invisible. Every operation in `sync/atomic` is sequentially consistent, which is the strongest ordering anyone usually needs, and emits whatever fence instruction the target architecture requires. You write `atomic.Bool.Store(true)` and Go promises that on x86 it compiles to `XCHG`; on ARM it compiles to `STLR`; and on every platform the result is the same — a fence and a store, observable in one global order.

You start to think about fences directly only when the abstractions leak: reading runtime source, bridging to C, or designing a new lock-free structure. For everyday Go code, atomics, mutexes, and channels handle ordering, and the only rule you need is "every shared variable is accessed through one of these three."

---

## What You Can Build

- A hot-reloadable configuration store with `atomic.Pointer[Config]`.
- A stop flag for a worker pool with `atomic.Bool`.
- A feature-flag service backed by an atomic pointer.
- A simple statistics counter (`atomic.Int64`) with no mutex.
- A safe lazy-initialisation pattern using `sync.Once`.
- A producer/consumer ready flag for a pipeline stage.

After `middle.md` and `senior.md` you will be able to design lock-free stacks, ring buffers, and skip lists that rely on fences for correctness.

---

## Further Reading

- The Go memory model — [https://go.dev/ref/mem](https://go.dev/ref/mem)
- "Memory Models: A Case for Rethinking Parallel Languages and Hardware" — Adve & Boehm, 2010
- "A Primer on Memory Consistency and Cache Coherence" — Sorin, Hill, Wood (free PDF)
- "What every programmer should know about memory" — Ulrich Drepper
- Russ Cox's series on memory models — [https://research.swtch.com/mm](https://research.swtch.com/mm)
- Intel® 64 and IA-32 Architectures Software Developer's Manual, Vol. 3A, §8.2 (Memory Ordering)
- ARM Architecture Reference Manual, the chapter "Memory Order"

---

## Related Topics

- [01-cas-algorithms](../01-cas-algorithms/) — CAS is one of the primary fence-emitters
- [02-aba-problem](../02-aba-problem/) — Even with fences, the ABA problem can defeat naive CAS
- [03-lock-free-data-structures](../03-lock-free-data-structures/) — Algorithms whose correctness depends on the ordering established here
- [05-lock-free-vs-wait-free](../05-lock-free-vs-wait-free/) — Progress guarantees built on the same primitives
- [../../00-introduction/04-memory-model](../../00-introduction/04-memory-model/) — Go's language-level memory model in full
- [../../03-sync-package/07-atomic](../../03-sync-package/07-atomic/) — The atomic operations that emit the fences

---

## Diagrams & Visual Aids

### The "fence" as a horizontal line

```
Time
 │
 │  store x = 1      ┐
 │  store y = 2      │  earlier operations
 │  load  z          ┘
 │
 ├──── FENCE ────────────  no operation crosses this line in either direction
 │
 │  load  a          ┐
 │  store b = 3      │  later operations
 │  load  c          ┘
 ▼
```

### x86 TSO vs ARM weak — what may be reordered

```
                       x86 TSO                ARM (weak)
Load  → Load            no                       yes
Load  → Store           no                       yes
Store → Store           no                       yes
Store → Load            YES (store buffer)       yes

Cost of fence on store→load reorder:
  x86:   MFENCE or LOCK-prefix instruction
  ARM:   DMB ISH (full data memory barrier)
```

### Acquire / release pair

```
Writer goroutine                Reader goroutine

   write x = 1                       (waits)
   write y = 2                       (waits)
   ┌─────────────┐                   ┌─────────────┐
   │   release   │  ───── happens ── │   acquire   │
   │  (store r)  │   ───  before ─── │  (load r)   │
   └─────────────┘                   └─────────────┘
                                      read x  → 1 ✓
                                      read y  → 2 ✓
```

### Where the fence lives in a `sync.Mutex`

```
sync.Mutex.Lock()                sync.Mutex.Unlock()
  └─ atomic CAS                    └─ atomic Store
     └─ acquire fence                 └─ release fence
        └─ enters critical               └─ exits critical
           section                          section
```
