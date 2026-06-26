# Runtimes (Language Runtime Support) — Middle Level

> **Topic:** [Runtimes (Language Runtime Support)](README.md)
> **Focus:** The three pillars the compiler emits code against — the **allocator + GC**, the **scheduler** for green threads, and **growable stacks** — plus the startup sequence that wires them up before `main`.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Common Mistakes](#common-mistakes)
14. [Tricky Points](#tricky-points)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [What You Can Build](#what-you-can-build)
19. [Further Reading](#further-reading)
20. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What contract does the compiler sign with the runtime?** For each high-level feature — heap allocation, a goroutine, a deep recursion — the compiler emits specific calls, checks, and metadata so the runtime can do its job. This page makes that contract concrete.

At junior level, the runtime was "the support code that runs with your program." At middle level we open the box and look at the three services the compiler interacts with most, and exactly **what code the compiler emits** to cooperate with each:

1. **Memory management** — the **allocator** (the compiler emits allocation calls) and the **garbage collector** (the compiler emits *write barriers* and arranges for the GC to find roots). The deep mechanics of the GC itself live in the memory-management section; here we focus on the *compiler's side of the bargain*.
2. **The scheduler** — for languages with **green threads / goroutines / async tasks**, the runtime multiplexes many lightweight tasks onto few OS threads. The compiler emits the call to spawn a task and, crucially, **safepoint/preemption checks** so the scheduler can take control.
3. **Stack management** — green threads need **growable stacks**. The compiler emits **stack-growth checks** in function prologues so the runtime can grow (or move) a stack when it's about to overflow.

Around these three, the runtime **bootstraps** at startup: it initializes the heap, the GC, and the scheduler *before* your `main` runs, and runs static initializers along the way. Understanding the contract — what the compiler emits and what the runtime does in response — is the difference between treating the runtime as magic and being able to reason about its costs.

This page stays at the level of *mechanism and cost*. `senior.md` adds the harder topics: write-barrier algorithms, safepoint mechanics, async-to-state-machine lowering, and runtime startup internals. The exact GC algorithms and stack-management internals are covered by the memory-management and runtime-systems sections respectively; here we always look from the compiler outward.

---

## Prerequisites

- **Required:** The junior tier of this topic — what a runtime is, fat vs thin, "the compiler emits calls."
- **Required:** Comfort reading simple Go, Java, or C, and a basic idea of the **call stack** (frames pushed/popped on call/return).
- **Required:** You know what a **heap** and a **stack** are and that allocation comes from the heap.
- **Helpful:** A rough idea of what a **garbage collector** does (traces reachable objects, frees the rest).
- **Helpful:** You've seen **threads** and know an OS thread is a relatively heavy resource.

You do **not** need to know:

- The internals of a specific GC algorithm (tri-color marking, generational collection) — memory-management section.
- The exact assembly of a safepoint poll or write barrier — that's `senior.md`.
- How `async/await` becomes a state machine — that's `senior.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Allocator** | Runtime code that returns a block of heap memory. The compiler emits *calls* to it (e.g. `runtime.mallocgc` in Go, `operator new` / `malloc` in C++/C). |
| **Write barrier** | A small piece of code the compiler emits around pointer writes so a concurrent GC can track changes to the object graph. |
| **GC root** | A starting point for reachability: globals, stack slots holding pointers, registers. The runtime must enumerate these; the compiler emits metadata (stack maps) to help. |
| **Stack map** | Compiler-generated metadata describing which stack slots/registers hold live pointers at a given point, so the GC knows what to trace. |
| **Safepoint** | A point where a thread/goroutine can be safely paused so the runtime (GC or scheduler) can act. The compiler ensures safepoints exist and are reachable. |
| **Safepoint poll / preemption check** | A tiny check the compiler inserts so a running task notices "the runtime wants me to stop" and yields. |
| **Scheduler** | Runtime code that maps lightweight tasks (goroutines, green threads) onto OS threads. |
| **M:N scheduling** | Mapping **M** lightweight tasks onto **N** OS threads (M ≫ N). Go's model. Contrast 1:1 (OS threads only) and N:1 (all on one OS thread). |
| **Work stealing** | A scheduler technique: idle worker threads "steal" runnable tasks from busy workers' queues to balance load. |
| **Goroutine / green thread / fiber** | A lightweight, runtime-managed unit of execution with its own (small, growable) stack. |
| **Growable / segmented / contiguous stack** | A stack the runtime can enlarge when it nears overflow, either by chaining segments or by copying to a bigger contiguous block (Go uses copying). |
| **Stack-growth check / morestack** | A check the compiler emits in a function prologue; if the stack would overflow, it calls the runtime to grow the stack (`runtime.morestack`). |
| **Bootstrap** | The runtime's own startup: initialize heap, GC, scheduler, then run static initializers, then `main`. |
| **Static initializer** | Code run during bootstrap to set up globals (C++ global ctors, Go package `init`, Java static blocks). |
| **`.init_array`** | An ELF section listing functions to run at startup (before `main`); the linker collects static initializers here. |
| **Escape analysis** | A compiler analysis deciding whether a value can live on the stack (cheap, no GC) or must be heap-allocated (a runtime call). |

---

## Core Concepts

### 1. The Memory Contract: Allocation Calls, Write Barriers, and Stack Maps

The compiler's relationship with memory management has three parts.

**(a) Allocation calls.** Whenever a value must live on the heap, the compiler emits a call into the allocator. In Go that's `runtime.mallocgc`; in Java the JIT emits a fast-path bump-pointer allocation with a slow-path call into the runtime; in C++ `new` lowers to `operator new`. **Escape analysis** decides *whether* a value escapes to the heap at all — if a value provably stays local, the compiler keeps it on the stack and emits **no** allocation call, saving both the allocation and the future GC work.

```go
func a() *int { x := 0; return &x } // x ESCAPES -> heap allocation (runtime call)
func b() int  { x := 0; return x  } // x stays on the stack -> no allocation
```

**(b) Write barriers.** A *concurrent* or *generational* garbage collector runs *while your program mutates the object graph*. If your code makes object A point to object B, and the GC has already scanned A but not B, it might wrongly conclude B is garbage. To prevent this, the compiler emits a **write barrier**: a tiny snippet around every pointer-into-heap write that informs the GC "this pointer changed." This is a direct compiler obligation — the GC algorithm only works if the compiler instruments pointer writes correctly.

```text
You write:        obj.field = ptr

Compiler emits:   gcWriteBarrier(&obj.field, ptr)   // when GC is in a phase that needs it
                  obj.field = ptr
```

**(c) Stack maps for roots.** To free garbage, the GC must know what's *reachable*, starting from **roots**: globals, and every pointer currently live on a thread's stack and in registers. The compiler emits **stack maps** — metadata that says, at each safepoint, "slot 3 holds a pointer, slot 4 is an integer." Without stack maps the GC couldn't distinguish a pointer from an integer that happens to look like an address. (This is precisely why *precise* GC requires compiler cooperation, while *conservative* GC — used when no stack maps exist — must guess.)

### 2. The Scheduler Contract: Spawn Calls and Safepoints

For a language with green threads, the compiler's job is twofold.

**(a) Spawn the task.** `go f()` lowers to a runtime call (`runtime.newproc`) that creates a goroutine struct with its own small stack and puts it on a run queue. The runtime's **scheduler** then runs it.

**(b) Make tasks preemptible.** Here's the subtle part. The scheduler must be able to **pause** a running goroutine — to run the GC (which needs all goroutines stopped at safepoints), or to give another goroutine a turn so one goroutine can't hog a thread. But you can't pause a thread at an arbitrary instruction safely (it might be mid-write, holding pointers in registers the GC can't decode). So the compiler arranges **safepoints** — places where pausing is safe — and historically emitted **cooperative preemption checks** (e.g. a check at function entry: "has the scheduler asked me to yield?"). Modern Go (1.14+) added **asynchronous preemption** using signals, but the runtime still needs compiler-provided stack maps to safely stop a goroutine at the signal point.

```text
Function prologue (conceptually):
  if g.stackguard triggered (preempt requested OR stack low):
      call runtime.morestack  // this path also handles preemption/GC requests
  ... function body ...
```

The same prologue check serves *two* runtime needs: **stack growth** and **preemption**. That's an elegant reuse — one check, two jobs.

### 3. M:N Scheduling and Work Stealing

Go's scheduler is the canonical example. It uses three entities, the **G-M-P** model:

- **G** — a goroutine (the task and its stack).
- **M** — a "machine", i.e. an OS thread.
- **P** — a "processor", a scheduling context that owns a local run queue of Gs and must be held by an M to run Go code.

The number of P's defaults to `GOMAXPROCS` (number of CPUs). Each P has a **local run queue** of goroutines; there is also a **global run queue**. When a P's local queue is empty, its M **steals** half the goroutines from another P's queue — **work stealing** — to balance load without a central bottleneck. When a goroutine makes a **blocking syscall**, the runtime can detach the M from the P and hand the P to another M, so the blocking goroutine doesn't freeze a whole CPU's worth of work.

The payoff: goroutines are *cheap* (a few KB of stack, created in nanoseconds) and you can have **millions** of them, because the runtime multiplexes them onto a handful of OS threads. The cost: the runtime must do bookkeeping, and the compiler must emit the safepoints/stack-growth checks that make it all work.

### 4. The Stack Contract: Growable Stacks and Prologue Checks

An OS thread has a large fixed stack (often 1–8 MB). A million goroutines with 1 MB stacks each would need a terabyte of memory — impossible. So green-thread runtimes give each task a **small** stack (Go starts at 8 KB) and **grow it on demand**.

How does the runtime know when to grow? The **compiler** emits a check in (almost) every function's prologue comparing the stack pointer against a guard. If the function's frame would exceed the current stack, the prologue calls `runtime.morestack`, which allocates a **bigger** stack, **copies** the old stack's contents over (Go uses *contiguous, copying* stacks since 1.4; older Go used *segmented* stacks), fixes up pointers into the stack, and resumes. Copying stacks is only possible because the compiler's **stack maps** tell the runtime which slots are pointers that must be relocated.

This is a deep compiler-runtime cooperation: the language's cheap-concurrency superpower (millions of goroutines) depends on the compiler instrumenting *every function* with a stack check. The deep mechanics of stack copying and pointer fixup are covered in the runtime-systems section; the key middle-level fact is **the compiler pays a small per-call tax so the runtime can keep stacks tiny.**

### 5. Bootstrap: What Runs Before `main`

When the OS loads your binary, control goes to the runtime's entry, not `main`:

1. **`_start` / `rt0`** — set up the initial stack, read `argc`/`argv`/`envp`.
2. **Runtime init** — initialize the **heap** and allocator, set up the **GC**, create the initial **P/M/G** (for Go), set `GOMAXPROCS`, parse `GODEBUG`/`GOGC` environment knobs.
3. **Static initializers** — run global constructors / package `init` functions. On ELF these are collected in `.init_array` and run in order; in Go, package-level `var` initializers and `init()` functions run after dependency ordering.
4. **Call `main`** — finally, your code runs.
5. **Exit** — after `main` returns, the runtime tears down and calls `exit`.

A heavy static initializer (e.g. building a big lookup table, opening a connection) runs in step 3 and *delays* the start of your `main` — a real source of startup latency.

---

## Real-World Analogies

**The valet-parking garage (scheduler).** Customers (goroutines) hand their cars to valets (P's), who park them in lots (run queues). There are only a few valets (M's = OS threads), but they handle hundreds of cars by shuffling them efficiently. When one valet's lot is full and another's is empty, cars get redistributed (work stealing). The garage's *rule* that a valet may only move a car when it's safely in neutral (a safepoint) is the cooperation the building (compiler) enforces.

**The expanding suitcase (growable stack).** Each traveler (goroutine) starts with a tiny carry-on (8 KB stack). When they buy too much, the airline (runtime) swaps them into a bigger bag and **moves everything over** (stack copy), updating the luggage tags (pointer fixup) so nothing is lost. The check "is your bag full?" happens at every gate (function prologue).

**The library re-shelving crew (GC + write barrier).** Patrons keep moving books between shelves (mutating pointers). A crew is taking inventory of what's still in use. To avoid declaring a book lost just because a patron moved it mid-inventory, every patron must drop a sticky note whenever they move a book (the write barrier). The crew (GC) reads the notes and adjusts.

---

## Mental Models

**Model 1 — The per-call tax.** Every function call in a green-thread language pays a tiny tax: a stack-growth/preemption check in the prologue. It's invisible in your source but always there. Cheap concurrency is *funded* by this tax.

**Model 2 — Compiler emits, runtime consumes.** Think of it as producer/consumer. The compiler *produces* allocation calls, write barriers, stack maps, safepoints, spawn calls. The runtime *consumes* them to provide GC, scheduling, and stack growth. They must agree on the protocol exactly — that's why a compiler and its runtime are a matched pair.

**Model 3 — Three queues and a thief.** Picture the scheduler as P's each holding a queue of work, plus a global queue, plus the rule "if you're idle, steal half of someone's queue." That single image explains Go's load balancing.

**Model 4 — Reachability needs a map.** The GC can only free what it can prove is garbage, and it can only prove reachability if it can read your stacks. The **stack map** is that reading glasses. No stack map, no precise GC.

---

## Code Examples

### Example 1 — Escape analysis decides allocation (Go)

```go
package main

type Point struct{ X, Y int }

//go:noinline
func makeLocal() int {
    p := Point{1, 2}     // does NOT escape -> stack, no runtime allocation
    return p.X + p.Y
}

//go:noinline
func makeEscaping() *Point {
    p := Point{1, 2}     // address returned -> escapes -> runtime.newobject (heap)
    return &p
}

func main() { _ = makeLocal(); _ = makeEscaping() }
```

Run `go build -gcflags='-m' .` and the compiler tells you: `p escapes to heap` for the second function. The first emits no allocation; the second emits a runtime allocation call and creates future GC work.

### Example 2 — Cheap goroutines vs OS threads

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 1_000_000; i++ { // a MILLION goroutines is fine
        wg.Add(1)
        go func(n int) { defer wg.Done(); _ = n * n }(i)
    }
    wg.Wait()
    fmt.Println("done")
}
```

A million OS threads would exhaust memory and the kernel's thread limits. A million goroutines is routine: each starts with an 8 KB stack the runtime grows only if needed, and the scheduler multiplexes them onto `GOMAXPROCS` OS threads. This is the scheduler + growable-stack contract paying off.

### Example 3 — A goroutine that never yields (pre-1.14 problem)

```go
package main

import "runtime"

func main() {
    runtime.GOMAXPROCS(1)
    go func() {
        for {           // tight loop, no function calls, no allocations
        }               // pre-Go-1.14: this could starve the scheduler forever
    }()
    select {}           // would never run other goroutines before async preemption existed
}
```

Before Go 1.14, preemption was **cooperative** — it only happened at function-call safepoints. A loop with no calls hit no safepoint and could monopolize the only P. Go 1.14 added **asynchronous preemption** (signal-based), so the scheduler can interrupt even a tight loop. This example shows *why* safepoints matter and what happens when a goroutine never reaches one.

### Example 4 — Forcing stack growth (Go)

```go
package main

import "fmt"

func recurse(depth int) int {
    var big [4096]byte // each frame is large; stacks must grow as we recurse
    big[0] = byte(depth)
    if depth == 0 {
        return int(big[0])
    }
    return recurse(depth-1) + int(big[1])
}

func main() {
    fmt.Println(recurse(2000)) // the runtime grows (copies) this goroutine's stack several times
}
```

Each call's prologue checks the stack guard; as the deep recursion with fat frames consumes the 8 KB initial stack, `runtime.morestack` allocates a bigger stack and copies the old one over — transparently, thanks to compiler-emitted prologue checks and stack maps.

### Example 5 — Static initializer runs before `main` (Go)

```go
package main

import "fmt"

var table = buildTable() // runs during bootstrap, BEFORE main

func buildTable() map[int]int {
    fmt.Println("building table (before main!)")
    m := make(map[int]int)
    for i := 0; i < 5; i++ {
        m[i] = i * i
    }
    return m
}

func init() { fmt.Println("init() runs before main too") }

func main() { fmt.Println("main:", table[3]) }
```

Output order proves it: the table build and `init()` print *before* `main`. Heavy work here is paid at startup — a real consideration for short-lived or serverless programs.

---

## Pros & Cons

### Pros

| Benefit | Mechanism |
|---------|-----------|
| **Millions of cheap tasks** | Small growable stacks + M:N scheduler + work stealing. |
| **No manual memory bugs** | Allocator + GC, with write barriers keeping a concurrent GC correct. |
| **Good multicore utilization** | Work stealing balances load across P's without a central lock. |
| **Stack-overflow safety + tiny stacks** | Prologue stack checks grow stacks on demand instead of pre-reserving megabytes. |
| **Blocking syscalls don't freeze the world** | Runtime detaches M from P during blocking calls. |

### Cons

| Cost | Mechanism |
|------|-----------|
| **Per-call overhead** | Every function pays a prologue stack/preemption check. |
| **Write-barrier cost** | Every heap pointer write may run extra instructions during GC phases. |
| **GC pauses** | Even concurrent GCs need brief stop-the-world phases at safepoints. |
| **Allocation pressure** | Escaping values become runtime allocations and feed the GC. |
| **Startup latency** | Bootstrap + static initializers run before `main`. |
| **Less timing control** | The scheduler and GC decide when things run/pause. |

---

## Use Cases

- **High-concurrency network servers:** the scheduler + cheap goroutines let one process handle hundreds of thousands of connections.
- **Pipelines with many short tasks:** spawn a goroutine per item; work stealing balances them.
- **Reducing GC pressure:** use escape analysis output (`-gcflags=-m`) to keep hot values on the stack and cut allocations.
- **Diagnosing latency spikes:** correlate spikes with GC cycles (`GODEBUG=gctrace=1`) or scheduler stalls (`runtime/trace`).
- **Tuning startup-sensitive programs:** move heavy work out of static initializers / `init` to shorten the pre-`main` window.

---

## Coding Patterns

### Pattern 1 — Keep hot allocations on the stack

```go
// Returning a pointer forces a heap allocation (escape).
func newBuf() *[256]byte { var b [256]byte; return &b } // escapes

// Pass a buffer in; it can stay on the caller's stack.
func fill(b *[256]byte) { b[0] = 1 }                     // no new allocation here
```

### Pattern 2 — Pool reusable objects to cut allocator/GC traffic

```go
var bufPool = sync.Pool{New: func() any { return make([]byte, 0, 4096) }}

func handle() {
    buf := bufPool.Get().([]byte)
    defer bufPool.Put(buf[:0])
    // ... use buf without allocating a fresh slice each time ...
}
```

### Pattern 3 — Don't spawn unbounded goroutines; bound concurrency

```go
sem := make(chan struct{}, 100) // at most 100 concurrent tasks
for _, job := range jobs {
    sem <- struct{}{}
    go func(j Job) { defer func() { <-sem }(); process(j) }(job)
}
```

Goroutines are cheap, but each still has a stack and scheduler bookkeeping; unbounded fan-out can still exhaust memory.

### Pattern 4 — Keep `init`/static initializers light

```go
// Prefer lazy initialization over heavy work at startup.
var table map[int]int
var once sync.Once

func getTable() map[int]int {
    once.Do(func() { table = buildExpensiveTable() }) // paid on first use, not at startup
    return table
}
```

---

## Best Practices

1. **Use escape analysis as a guide, not a religion.** Check `-gcflags=-m`, reduce obvious escapes in hot paths, but don't contort code for micro-gains.
2. **Bound your goroutines.** Cheap is not free; use semaphores or worker pools for fan-out.
3. **Watch GC with the runtime's own tools.** `GODEBUG=gctrace=1`, `runtime.ReadMemStats`, pprof's heap profile — measure allocation pressure rather than guessing.
4. **Keep startup work lazy.** Heavy static initializers delay `main`; defer them to first use when possible.
5. **Respect safepoints in tight loops.** On older runtimes (or in other languages with cooperative scheduling), insert a yield in a long compute loop; on modern Go async preemption handles it.
6. **Don't assume goroutine = thread.** Blocking inside a goroutine on a C call or a busy loop has different effects than blocking an OS thread; know your scheduler's behavior.
7. **Tune `GOMAXPROCS`/`GOGC` deliberately** when profiling shows scheduler or GC limits, and document why.

---

## Edge Cases & Pitfalls

- **Tight compute loop with no calls starves other tasks (cooperative schedulers).** Mitigated by async preemption in modern Go, but still a classic trap in green-thread systems.
- **A blocking C call (cgo) pins an OS thread.** The runtime can't preempt code running in C; a long C call holds an M and can reduce effective parallelism. (Foreign-runtime interop is covered in the FFI/interop section.)
- **Escape analysis is conservative.** It heap-allocates when in doubt; a small refactor (avoid returning a pointer, avoid interface boxing) can flip a value back to the stack.
- **Interface boxing allocates.** Assigning a concrete value to an `interface{}` may allocate to store the value — a hidden runtime allocation.
- **Deep recursion triggers repeated stack copies.** Each growth copies the stack; pathological recursion can spend real time in `morestack`.
- **Heavy package `init` ordering bugs.** Initialization order across packages can surprise you; a global depending on another package's not-yet-run `init` is a bug.
- **GC pauses correlate with latency tails.** A request that lands during a stop-the-world phase sees added latency; this is a p99 problem, not an average problem.

---

## Common Mistakes

| Mistake | Reality |
|---------|---------|
| "Goroutines are free." | They're cheap, not free — stack + scheduler bookkeeping per goroutine. |
| "The GC handles everything; allocations don't matter." | Allocations create GC work; reducing them improves throughput and latency. |
| "Spawning a goroutine starts a thread." | It enqueues a task on a P; the scheduler runs it on an existing M. |
| "A `for {}` loop is harmless." | On cooperative schedulers it can starve everything; even modern runtimes only fixed this recently. |
| "Stacks are fixed-size." | Green-thread stacks grow (and Go copies them); the compiler emits the checks. |
| "Static init is part of `main`." | It runs during bootstrap, *before* `main`. |
| "Write barriers are optional optimization." | They're a correctness requirement for concurrent/generational GC; the compiler must emit them. |

---

## Tricky Points

- **One prologue check, two jobs.** The Go function prologue's stack-guard comparison handles *both* stack growth *and* preemption requests (the guard is set to an impossible value to force entry into `morestack`, which then notices a preemption request). Elegant overloading of a single check.
- **Precise vs conservative GC is a compiler question.** Precise GC needs stack maps (compiler-emitted). Languages without that metadata (or C extensions) fall back to conservative scanning, which can keep garbage alive by accident.
- **Work stealing avoids a central scheduler lock.** The genius of per-P local queues + stealing is that the common case (run from your own queue) needs no global synchronization; stealing is the rare, slow path.
- **Async preemption needs cooperation even when it's "asynchronous."** A signal interrupts the goroutine, but the runtime still needs a valid stack map *at the interrupted instruction* to safely stop it — so the compiler still does the heavy lifting.
- **Stacks moving breaks naive pointers-into-stack.** Because Go *copies* stacks, you cannot hold a raw pointer into a goroutine's stack across a potential growth point and expect it to stay valid — the runtime fixes up known pointers, but cgo/unsafe code can be caught off guard.

---

## Test Yourself

1. What three things does the compiler emit to cooperate with the memory manager?
2. Why does a concurrent GC require the compiler to emit write barriers?
3. In Go's G-M-P model, what are G, M, and P, and which one holds the run queue?
4. What is work stealing, and what problem does it solve?
5. What does a function prologue's stack-growth check do, and how does it also serve preemption?
6. Why can a green-thread runtime support millions of tasks when a 1:1 thread model can't?
7. What runs before `main`, and how can it hurt startup latency?
8. Why was a `for {}` loop with no calls a scheduler problem before async preemption?

> Answers: (1) Allocation calls, write barriers around pointer writes, and stack maps (plus reachable safepoints). (2) The GC scans the object graph while your code mutates it; without a barrier, a newly-created pointer could be missed and its target wrongly freed. (3) G = goroutine, M = OS thread, P = scheduling context/processor; the **P** owns the local run queue. (4) Idle P's steal half the goroutines from a busy P's queue; it balances load without a central scheduler bottleneck. (5) It checks whether the current frame would overflow the stack; if so it calls `morestack` to grow/copy the stack — and the same guard is reused to force a yield when preemption is requested. (6) Tiny growable stacks + M:N multiplexing onto few OS threads, versus one large fixed stack per OS thread. (7) The runtime bootstrap (heap/GC/scheduler init) and static initializers / `init` functions; heavy init delays `main`. (8) Cooperative preemption only happened at call safepoints; a loop with no calls reached no safepoint, so the scheduler could never take the P back.

---

## Cheat Sheet

```text
COMPILER -> RUNTIME CONTRACT
  memory:    allocation calls (mallocgc/newobject) + write barriers + stack maps
  scheduler: spawn call (newproc) + safepoints + preemption checks
  stacks:    prologue stack-growth check -> runtime.morestack (grow + copy + fixup)

ESCAPE ANALYSIS: stack (free) vs heap (runtime alloc + future GC). Check: go build -gcflags=-m

GO SCHEDULER (G-M-P), M:N:
  G = goroutine (+ small growable stack, 8KB start)
  M = OS thread
  P = processor / scheduling context (owns local run queue), count = GOMAXPROCS
  load balance via WORK STEALING (idle P steals half of a busy P's queue)
  blocking syscall -> detach M from P so others keep running

STACKS: tiny + growable -> millions of goroutines possible
  growth = copy whole stack to bigger block + fix up pointers (needs stack maps)

BOOTSTRAP (before main):
  _start/rt0 -> runtime init (heap/GC/scheduler) -> static initializers (.init_array / init()) -> main

GOTCHAS: tight no-call loop (pre-async-preempt), cgo pins M, interface boxing allocates,
         heavy init delays main, GC pauses hit p99.
```

---

## Summary

At middle level, the runtime stops being magic and becomes a **contract** the compiler signs. For **memory**, the compiler emits allocation calls (gated by escape analysis), **write barriers** so a concurrent GC stays correct, and **stack maps** so the GC can find live pointers as roots. For **concurrency**, it emits the spawn call and the **safepoints/preemption checks** that let the scheduler take control; the runtime then multiplexes lightweight tasks **M:N** onto OS threads, balancing load with **work stealing** (Go's G-M-P model). For **stacks**, the compiler emits a **prologue stack-growth check** so the runtime can keep each task's stack tiny and **grow (copy)** it on demand — the very thing that makes millions of goroutines affordable. All of this is wired up during **bootstrap**, which runs the heap/GC/scheduler initialization and **static initializers** *before* `main`.

The recurring theme: cheap, safe high-level features are *funded* by small, pervasive obligations the compiler emits into your code. Reducing allocations, bounding goroutines, and keeping startup light are the practical levers that follow directly from understanding the contract. The next tier, `senior.md`, takes these mechanisms to their internals — write-barrier and safepoint implementation, and the big one: how the compiler lowers `async/await` into a poll-able **state machine**.

---

## What You Can Build

- **An escape-analysis report:** annotate a hot function with `-gcflags='-m -m'` and rewrite it to eliminate one heap allocation; verify with a benchmark and `-benchmem`.
- **A goroutine cost meter:** spawn 1, 10k, 100k, and 1M goroutines; measure memory (`runtime.ReadMemStats`) and creation time; chart the per-goroutine cost.
- **A GC-trace dashboard:** run a service with `GODEBUG=gctrace=1` and correlate GC cycles with request latency.
- **A startup profiler:** time the gap between process start and the first line of `main`, then move work out of `init`/static initializers and re-measure.

---

## Further Reading

- The Go runtime source (`runtime` package): `proc.go` (scheduler), `malloc.go` (allocator), `stack.go` (stack growth), `mbarrier.go` (write barriers).
- "Scheduling in Go" articles describing the G-M-P model and work stealing.
- Go blog posts on asynchronous preemption (Go 1.14).
- The memory-management section for GC algorithm internals; the runtime-systems section for stack management internals.

---

## Related Topics

- [Runtimes (Language Runtime Support)](README.md) — the hub for this topic.
- The **memory-management** section: the allocator and GC algorithms whose calls/barriers the compiler emits.
- The **runtime-systems** section: stack management and scheduler internals from the runtime's own perspective.
- The **foreign-function-interface-and-interop** section: how blocking C calls interact with the scheduler.
