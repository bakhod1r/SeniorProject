# Compare-and-Swap (CAS) Algorithms — Junior Level

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
> Focus: "What is Compare-and-Swap? Why is it special? How do I use it to update shared state without a mutex?"

**Compare-and-Swap** — usually shortened to **CAS** — is the single most important primitive in lock-free programming. It is one atomic operation that the CPU exposes to software, and it can be summarised in one sentence:

> "If the memory at this address still equals the old value I expected, write the new value and report success. Otherwise leave it alone and report failure."

In Go, you call it like this:

```go
ok := atomic.CompareAndSwapInt64(&counter, oldValue, newValue)
```

The function returns `true` if it managed to write `newValue` (meaning no other goroutine modified `counter` in the meantime), and `false` if it did not (meaning someone else got there first and your read is stale).

This sounds simple. It is. What makes CAS revolutionary is what you can build with it. Almost every lock-free data structure in the world — every wait-free counter, every concurrent queue in a high-frequency trading system, every reference counter in a low-latency kernel — is built from CAS. The Go runtime itself uses CAS extensively inside the scheduler, the garbage collector, and the channel implementation.

After reading this file you will:

- Know what CAS is and why it is atomic
- Be able to read and write the canonical CAS loop pattern
- Know Go's `sync/atomic.CompareAndSwap*` family
- Know Go 1.19+ typed atomics (`atomic.Int64.CompareAndSwap`)
- Have built a lock-free counter and a one-shot flag with CAS
- Understand why a CAS loop can livelock under high contention
- Know roughly when CAS beats a mutex and when it does not
- Be ready for middle-level lock-free data structures

You do not need to know about hazard pointers, epoch-based reclamation, or the ABA problem in depth yet — those come at senior and professional levels. This file is about getting CAS into your hands so you can feel how it works.

---

## Prerequisites

- **Required:** Familiarity with Go basics — variables, functions, structs, pointers.
- **Required:** Familiarity with goroutines and the `go` keyword. If `go f()` is unfamiliar, read `01-goroutines/01-overview/junior.md` first.
- **Required:** Basic experience with the `sync` package — at least `sync.Mutex` and `sync.WaitGroup`.
- **Required:** Basic experience with the `sync/atomic` package — `atomic.AddInt64`, `atomic.LoadInt64`. Read `03-sync-package/07-atomic/junior.md` first.
- **Helpful:** A feel for what "atomic" means at the CPU level. You do not need hardware details yet.
- **Helpful:** Awareness that concurrent writes to the same memory without synchronisation cause data races.

If `atomic.AddInt64(&x, 1)` makes sense to you and you have written code that uses `sync.Mutex`, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **CAS** | Compare-and-Swap. An atomic operation that conditionally writes a new value to memory only if the current value matches an expected old value. Returns success or failure. |
| **Atomic** | Indivisible from the perspective of other threads. Either fully happens or has not happened; no intermediate state is observable. |
| **Lock-free** | A property of an algorithm: at least one thread always makes progress in a bounded number of steps, regardless of what other threads do. CAS loops are the canonical lock-free pattern. |
| **Wait-free** | Stronger than lock-free: *every* thread makes progress in a bounded number of steps. Very few real algorithms achieve this. |
| **CAS loop** | The standard usage pattern for CAS: read, compute, attempt CAS, retry on failure. |
| **Spurious failure** | A CAS failure caused not by another thread but by hardware (e.g., ARM LL/SC monitor cleared by a context switch). Some platforms exhibit this; x86's `CMPXCHG` does not. |
| **Livelock** | A failure mode where threads keep retrying but never make progress because they keep interfering with each other. Lock-free does *not* mean livelock-free. |
| **Contention** | The condition where multiple threads simultaneously try to modify the same memory location. CAS retries multiply with contention. |
| **Sequential consistency** | A memory ordering model where all operations appear to happen in a single global order consistent with each thread's program order. Go atomics are sequentially consistent. |
| **`atomic.CompareAndSwapInt64`** | Go's standalone function form: `CompareAndSwapInt64(addr *int64, old, new int64) bool`. |
| **`atomic.Int64.CompareAndSwap`** | Go 1.19+ method form on the typed atomic. Equivalent semantics, nicer ergonomics. |
| **`atomic.Pointer[T]`** | Go 1.19+ generic typed atomic pointer. Has `Load`, `Store`, `Swap`, `CompareAndSwap` methods. The cornerstone of pointer-based lock-free data structures. |
| **ABA problem** | A classic CAS bug: a value changes from A to B and back to A. CAS succeeds but the world has changed underneath. Covered in detail in `02-aba-problem`. |

---

## Core Concepts

### What CAS really does

Imagine the operation written out as pseudo-code:

```
function CAS(address, old, new):
    if *address == old:
        *address = new
        return true
    else:
        return false
```

That is exactly the semantics. The key insight is the word **atomic**: the read, compare, and write happen as a single indivisible step from the perspective of every other thread on the system. No goroutine can ever observe the state where the comparison succeeded but the write has not yet happened, or where the write happened but the comparison failed. On the hardware, this is one CPU instruction (`LOCK CMPXCHG` on x86, `CAS` or LL/SC on ARM).

Compare this to writing the same logic with a plain `if`:

```go
// NOT atomic — broken
if counter == oldValue {
    counter = newValue
}
```

Between the `==` check and the assignment, any other goroutine can modify `counter`. CAS removes that window.

### The CAS-loop template

The canonical use of CAS is the **CAS loop**. Almost every lock-free algorithm follows this skeleton:

```go
for {
    old := atomic.LoadInt64(&shared)
    new := compute(old)                              // pure function of old
    if atomic.CompareAndSwapInt64(&shared, old, new) {
        break                                         // success — we updated
    }
    // CAS failed — someone else changed shared. Loop and try again.
}
```

Read it slowly. Four steps:

1. **Load** the current value into a local. Now you have a snapshot.
2. **Compute** the desired new value from that snapshot. This is your business logic.
3. **CAS** from snapshot to new. If shared still equals the snapshot, write succeeds.
4. **If failed**, somebody else wrote in between. Discard, loop, try again with their newer value.

The correctness argument: when the CAS succeeds, no one modified `shared` between steps 1 and 3 (because the CAS proved the value was still `old`). So the new value is a valid successor of a value we actually saw.

The cost: under contention, threads waste work computing values that get thrown away.

### The Go API: standalone functions

The package `sync/atomic` provides CAS functions for every supported scalar type:

```go
func CompareAndSwapInt32(addr *int32, old, new int32) (swapped bool)
func CompareAndSwapInt64(addr *int64, old, new int64) (swapped bool)
func CompareAndSwapUint32(addr *uint32, old, new uint32) (swapped bool)
func CompareAndSwapUint64(addr *uint64, old, new uint64) (swapped bool)
func CompareAndSwapUintptr(addr *uintptr, old, new uintptr) (swapped bool)
func CompareAndSwapPointer(addr *unsafe.Pointer, old, new unsafe.Pointer) (swapped bool)
```

There is no CAS for `float32`, `float64`, `string`, or struct values. For those, use `atomic.Value` or `atomic.Pointer[T]`.

### The Go 1.19+ API: typed atomics

Since Go 1.19, the standard library provides typed atomic structs that are safer and more ergonomic:

```go
type Int32   struct{ /* ... */ }
type Int64   struct{ /* ... */ }
type Uint32  struct{ /* ... */ }
type Uint64  struct{ /* ... */ }
type Uintptr struct{ /* ... */ }
type Bool    struct{ /* ... */ }
type Pointer[T any] struct{ /* ... */ }
```

Each provides methods including `Load`, `Store`, `Swap`, `Add` (where applicable), and `CompareAndSwap`:

```go
var counter atomic.Int64

counter.Store(100)
ok := counter.CompareAndSwap(100, 101) // returns true
ok = counter.CompareAndSwap(100, 102)  // returns false (current is 101)
```

The typed forms are recommended for new code:

- No need to remember to take the address.
- No need to worry about 64-bit alignment on 32-bit platforms (the struct enforces it).
- Embedding the atomic in your own struct prevents accidental copy.
- Cleaner reads at the call site.

### Building block 1: lock-free counter

The simplest CAS application is a counter:

```go
type Counter struct {
    v atomic.Int64
}

func (c *Counter) Increment() {
    for {
        old := c.v.Load()
        new := old + 1
        if c.v.CompareAndSwap(old, new) {
            return
        }
    }
}
```

In production you would just write `c.v.Add(1)` — the runtime gives you a single-instruction atomic add. The CAS-loop version is shown here because (a) it illustrates the pattern in its most elementary form, and (b) for any non-trivial computation (max, min, conditional update) you must use CAS because `Add` does not generalise.

### Building block 2: one-shot flag

A flag that flips from `false` to `true` exactly once, no matter how many goroutines try:

```go
type Once struct {
    done atomic.Bool
}

func (o *Once) DoOnce(f func()) {
    if o.done.CompareAndSwap(false, true) {
        f()
    }
}
```

The CAS returns true *exactly* for the first goroutine that gets there. Every subsequent caller sees `done` already `true`, the CAS fails, and `f` does not run. This is the kernel of `sync.Once` (the real version is more careful about memory ordering and waiting).

### Building block 3: conditional update

CAS-protected "set if greater" — useful for tracking maximums:

```go
type MaxTracker struct {
    max atomic.Int64
}

func (m *MaxTracker) Observe(v int64) {
    for {
        old := m.max.Load()
        if v <= old {
            return // not greater — no update needed
        }
        if m.max.CompareAndSwap(old, v) {
            return
        }
        // CAS failed: another goroutine raised max. Re-read and try again.
    }
}
```

This pattern shows the strength of CAS over `Add`: arithmetic operators are not enough. Any condition you can express in `compute(old)` can be made lock-free.

### Building block 4: pointer-swap and head update

For a lock-free linked-list head:

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

Each push reads the current head, links the new node in front of it, and CAS-swaps the head from old to new. If another goroutine pushed in between, the CAS fails and we re-read. This is half of the **Treiber stack** — the simplest non-trivial lock-free data structure.

### Why CAS is so fast

Modern CPUs implement CAS as a single instruction:

- x86: `LOCK CMPXCHG` — typically 5-15 ns under no contention.
- ARMv8+: `CAS` or `LDXR`/`STXR` — comparable on modern chips.

Compare to a `sync.Mutex` lock/unlock pair, which involves at least two atomic ops plus possibly a kernel call. For very short critical sections (incrementing a counter, swapping a pointer), CAS is 5-10x faster.

Under heavy contention this advantage shrinks — sometimes vanishes — because CAS retries multiply. But for uncontended or lightly-contended hot paths, CAS is hard to beat.

### Why CAS can livelock

Lock-free does not mean livelock-free. Imagine ten goroutines all running this code at the same time:

```go
for {
    old := counter.Load()
    if counter.CompareAndSwap(old, old+1) {
        break
    }
}
```

Goroutine A reads `old=5`, computes `6`, attempts CAS. Goroutine B already wrote `6`. A's CAS fails. A re-reads `6`, computes `7`. Meanwhile C wrote `7`. A's CAS fails again. In a steady state at least one goroutine always succeeds (that is the lock-free guarantee), but any individual goroutine can starve for an unbounded time if it keeps being beaten.

For a counter this is not catastrophic — the total work done is fine — but for an algorithm where each goroutine has *different* work, starvation is real. Higher-level techniques (back-off, helping, queueing) address this; covered at senior level.

---

## Real-World Analogies

### CAS is editing a wiki with optimistic locking

You open a wiki page, read its current text (version 47), edit it in your browser, and click Save. The wiki server checks: "Is the latest version still 47?" If yes, your edit is saved and the page becomes version 48. If no — someone else edited it while you were typing — your save is rejected and you must merge their changes and try again. That conflict resolution is the CAS loop in human form.

### CAS is the "Reserve Seat" button on a ticketing site

The system displays seat 14B as available. You click "Reserve." The server tries to atomically change the seat from "available" to "reserved by you." If someone else clicked first, you see "Sorry, that seat is taken" — the CAS failed. You pick a new seat and try again. The seat database never sees a state where two people own the same seat.

### CAS is checking out a library book with a single counter

There is one copy. You walk to the desk and say "I want it." The librarian checks: "Is the copy still on the shelf?" If yes, she hands it to you and updates the record. If no — someone got there first — you leave with nothing. You can try later, but you cannot share the one copy. The librarian's check-and-hand-over is atomic; no half-state where the book is both "available" and "in your hand."

### CAS is the supermarket "last-one-on-the-shelf" race

Two shoppers reach for the last bottle of olive oil. Only one can grab it. The grab is atomic — either you have the bottle or you don't. The other shopper sees an empty shelf and walks away. No way to end up with half a bottle each.

---

## Mental Models

### Model 1: "Optimistic concurrency"

CAS embodies **optimistic concurrency**: you assume no conflict happens, do your work, and only at commit time check that nobody interfered. The opposite is **pessimistic concurrency** (mutex): you assume conflict, lock first, then work, then unlock.

When conflicts are rare, optimism wins — most CAS attempts succeed on the first try and you avoid the cost of locking. When conflicts are common, pessimism wins — locking once is cheaper than retrying many times.

### Model 2: "Snapshot, compute, commit"

Every CAS loop is three phases:

1. **Snapshot** — read the shared state into a local. Now you have something stable to reason about.
2. **Compute** — your business logic, on the snapshot. Pure function. No side effects on the shared state.
3. **Commit** — try to write back. Either it lands (no one changed it) or it bounces (try again).

This is the same shape as database transactions, version control merges, and HTTP If-Match headers. Once you see the pattern, you see it everywhere.

### Model 3: "CAS is the difference between read-then-write and modify"

Plain code:

```go
x = x + 1
```

is logically three operations: load, add, store. Between the load and the store, another goroutine can change `x`. The increment can be lost.

CAS:

```go
for !atomic.CompareAndSwapInt64(&x, atomic.LoadInt64(&x), atomic.LoadInt64(&x)+1) {}
```

ties the load and the store together with a check. If the value changed in between, the store does not happen, and you retry. Nothing is lost.

(In practice, for a simple `+1`, `atomic.AddInt64(&x, 1)` is the right answer — the CPU has a dedicated instruction for atomic add. CAS is for when the computation is more complex.)

### Model 4: "CAS is hardware lock-free, not algorithmic lock-free"

The CPU offers CAS atomicity. That gets you a thread-safe write. **Lock-free as a property of your algorithm** is a different layer — it requires that the entire algorithm guarantees progress. A loop around CAS is lock-free *for that variable*; whether your data structure as a whole is lock-free depends on how all the CAS-protected variables interact.

---

## Pros & Cons

### Pros

- **No locking overhead in the fast path.** When CAS succeeds on the first try, you have done one atomic instruction. No mutex acquisition, no scheduler interaction.
- **No deadlock.** CAS does not hold a lock; there is nothing to deadlock on. (Livelock is still possible — see below.)
- **No priority inversion.** A low-priority thread cannot block a high-priority thread because there is no lock to hold.
- **Wait-free reads on the read side.** Reading the value via `Load` is one instruction. Writers do not block readers.
- **Composable for simple operations.** "Set if greater," "increment if positive," "swap if pointer matches" — all natural CAS loops.
- **Fast under low contention.** A successful CAS is 5-15 nanoseconds. Mutex Lock/Unlock is 25-50 ns.

### Cons

- **Livelock under high contention.** Threads can spin retrying indefinitely without making individual progress.
- **Wasted work on retry.** Each failed CAS discards the computed value. If the computation is expensive, the cost multiplies with contention.
- **Only one word at a time.** CAS operates on one memory location. Updating two coupled variables atomically requires more complex techniques (double-word CAS, transactional memory, or a mutex).
- **ABA problem.** A value can change A → B → A and CAS will succeed even though the world changed. Covered in `02-aba-problem`. Go's GC mitigates this for pointers in most cases, but not for indices, generations, or pooled objects.
- **Harder to reason about correctness.** CAS-based code looks innocent but has many subtle ordering bugs that locks would prevent.
- **Harder to test.** A bug that occurs only at high contention may never appear in unit tests.
- **Limited expressivity.** Any operation that needs to read and atomically update *two* unrelated memory locations cannot be expressed by a single CAS.

---

## Use Cases

| Scenario | Why CAS helps |
|---|---|
| Atomic counter increment | One CAS or `Add` instruction; no mutex needed. |
| Lock-free stack (Treiber stack) | Push and Pop both reduce to CAS on the head pointer. |
| Set-if-greater-than (high watermark) | CAS loop expresses any conditional update. |
| One-shot initialisation flag | Single CAS guarantees "first one wins"; the rest see the flag set. |
| Reference counting | CAS-based increment/decrement of refcount, with conditional logic to free at zero. |
| Read-copy-update style snapshots | Reader uses `Load`; writer creates new version and `CompareAndSwap`s the pointer. |
| Versioned configuration swap | New config pointer atomically replaces old; readers always see a complete version. |
| Lazy initialisation | First thread CAS-wins the "initialised?" flag and does the work; others wait or proceed. |
| Free-list / pool head | Atomically pop a node off a free list with CAS on the head. |

| Scenario | Why CAS does *not* help |
|---|---|
| Long critical sections | CAS shines for ns-scale updates. For ms-scale work, use a mutex. |
| Updating two related fields atomically | One CAS = one word. Two coupled fields need a different design. |
| High contention with expensive `compute(old)` | Retries waste large amounts of work. Mutex or back-off is better. |
| Code that needs blocking semantics | CAS does not "wait" — it succeeds or fails immediately. For "wait for X," use a channel or condition variable. |
| Updating large state (whole struct) | CAS handles up to 64 bits (or one pointer). Bigger state needs a pointer-swap (publish-by-pointer). |

---

## Code Examples

### Example 1: The simplest CAS

```go
package main

import (
    "fmt"
    "sync/atomic"
)

func main() {
    var x int64 = 10

    swapped := atomic.CompareAndSwapInt64(&x, 10, 20)
    fmt.Println(swapped, x) // true 20

    swapped = atomic.CompareAndSwapInt64(&x, 10, 30)
    fmt.Println(swapped, x) // false 20  (current is 20, not 10)
}
```

Output:
```
true 20
false 20
```

The first CAS succeeded because `x` was 10. The second failed because `x` is now 20, not 10.

### Example 2: Typed atomic CAS (Go 1.19+)

```go
package main

import (
    "fmt"
    "sync/atomic"
)

func main() {
    var x atomic.Int64
    x.Store(10)

    fmt.Println(x.CompareAndSwap(10, 20)) // true
    fmt.Println(x.Load())                  // 20
    fmt.Println(x.CompareAndSwap(10, 30)) // false
    fmt.Println(x.Load())                  // 20
}
```

Same semantics, cleaner syntax. New code should prefer this form.

### Example 3: Lock-free counter via CAS loop

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type Counter struct {
    v atomic.Int64
}

func (c *Counter) Inc() {
    for {
        old := c.v.Load()
        if c.v.CompareAndSwap(old, old+1) {
            return
        }
    }
}

func (c *Counter) Value() int64 { return c.v.Load() }

func main() {
    var c Counter
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            c.Inc()
        }()
    }
    wg.Wait()
    fmt.Println(c.Value()) // 1000
}
```

Each of the 1000 goroutines increments concurrently. Every CAS-loop iteration that fails simply retries. Final value is always exactly 1000.

(For the simple `+1` case, `c.v.Add(1)` would be the right call — one CPU instruction, no loop. The CAS-loop version is shown to teach the pattern.)

### Example 4: Set-if-greater (max watermark)

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type Max struct {
    v atomic.Int64
}

func (m *Max) Observe(x int64) {
    for {
        old := m.v.Load()
        if x <= old {
            return // no update needed
        }
        if m.v.CompareAndSwap(old, x) {
            return
        }
        // Lost race — retry
    }
}

func (m *Max) Value() int64 { return m.v.Load() }

func main() {
    var m Max
    var wg sync.WaitGroup
    samples := []int64{5, 12, 3, 18, 7, 9, 22, 14}
    for _, s := range samples {
        s := s
        wg.Add(1)
        go func() {
            defer wg.Done()
            m.Observe(s)
        }()
    }
    wg.Wait()
    fmt.Println(m.Value()) // 22
}
```

Why this needs CAS and not `Add`: there is no "atomic max" instruction on most CPUs. CAS gives you any conditional update.

### Example 5: One-shot flag (kernel of sync.Once)

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type Once struct {
    done atomic.Bool
}

func (o *Once) Do(f func()) {
    if o.done.CompareAndSwap(false, true) {
        f()
    }
}

func main() {
    var o Once
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            o.Do(func() {
                fmt.Println("only printed once, from goroutine", i)
            })
        }(i)
    }
    wg.Wait()
}
```

Only one goroutine's CAS succeeds; only one print. (The real `sync.Once` also ensures that other goroutines *wait* until `f` finishes, not just skip the call. CAS alone gives the "exactly once" part; the "wait" part needs more.)

### Example 6: Lock-free stack push (Treiber stack)

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

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

func (s *Stack) Pop() (int, bool) {
    for {
        top := s.head.Load()
        if top == nil {
            return 0, false
        }
        if s.head.CompareAndSwap(top, top.next) {
            return top.value, true
        }
    }
}

func main() {
    var s Stack
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            s.Push(i)
        }()
    }
    wg.Wait()

    count := 0
    for {
        _, ok := s.Pop()
        if !ok {
            break
        }
        count++
    }
    fmt.Println(count) // 100
}
```

Two CAS-loops, one for `Push` and one for `Pop`. Both share the same head pointer. Many goroutines can push concurrently; each one's CAS settles the contention.

(This is also where the ABA problem hides — see `02-aba-problem`. In pure Go with GC and no pooling, it does not bite.)

### Example 7: CAS returning the actual value on failure

The Go standard CAS returns only a bool. A common upgrade is to return what was actually there:

```go
func cas(addr *atomic.Int64, old, new int64) (actual int64, ok bool) {
    if addr.CompareAndSwap(old, new) {
        return new, true
    }
    return addr.Load(), false
}
```

Useful when retrying — you do not have to re-issue a separate `Load` to see what value is now there.

### Example 8: A counter with a maximum

A counter that never exceeds 100:

```go
type Bounded struct {
    v   atomic.Int64
    max int64
}

func (b *Bounded) Inc() bool {
    for {
        old := b.v.Load()
        if old >= b.max {
            return false
        }
        if b.v.CompareAndSwap(old, old+1) {
            return true
        }
    }
}
```

The early-return guards the upper bound; the CAS guards the increment. Returns `true` if the increment landed, `false` if the counter was already at max.

### Example 9: Comparing CAS-loop vs mutex

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

type MutexCounter struct {
    mu sync.Mutex
    v  int64
}

func (c *MutexCounter) Inc() {
    c.mu.Lock()
    c.v++
    c.mu.Unlock()
}

type CASCounter struct {
    v atomic.Int64
}

func (c *CASCounter) Inc() {
    for {
        old := c.v.Load()
        if c.v.CompareAndSwap(old, old+1) {
            return
        }
    }
}

func bench(name string, inc func()) {
    var wg sync.WaitGroup
    start := time.Now()
    for i := 0; i < 8; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 1_000_000; j++ {
                inc()
            }
        }()
    }
    wg.Wait()
    fmt.Printf("%s: %v\n", name, time.Since(start))
}

func main() {
    var m MutexCounter
    var c CASCounter
    bench("mutex", m.Inc)
    bench("cas",   c.Inc)
}
```

Run this on your machine. Typical results on a modern x86 laptop:

- mutex: 300-500 ms
- cas:   100-200 ms

Numbers vary with contention, core count, and frequency. The take-away: CAS is meaningfully faster than a mutex for a single-word update with several contending goroutines. For 32 contending goroutines, the gap narrows because retries multiply.

### Example 10: A simple ticket dispenser

Each call returns a fresh, unique ticket number:

```go
type Tickets struct {
    next atomic.Int64
}

func (t *Tickets) Take() int64 {
    for {
        n := t.next.Load()
        if t.next.CompareAndSwap(n, n+1) {
            return n
        }
    }
}
```

Each goroutine that calls `Take` gets a distinct integer. No two goroutines can possibly get the same number — the CAS guarantees it.

(For monotonic integers `t.next.Add(1) - 1` would work and is faster. The CAS form generalises to any "pick the next value" function, e.g., skipping reserved IDs.)

---

## Coding Patterns

### Pattern 1: The canonical CAS-loop

```go
for {
    old := shared.Load()
    new := computeNext(old)
    if shared.CompareAndSwap(old, new) {
        break
    }
}
```

Every lock-free algorithm uses this skeleton. Memorise it. Then internalise the variations:

- **Early exit on no-op:** if `new == old`, skip the CAS.
- **Conditional exit:** if `old` is in a terminal state (e.g., already final), return without CAS.
- **Bounded retry:** wrap in `for i := 0; i < maxRetries; i++` and fall back to a mutex if exhausted.

### Pattern 2: CAS-protected publish

```go
type Config struct{ /* immutable fields */ }

var current atomic.Pointer[Config]

func UpdateConfig(newCfg *Config) {
    for {
        old := current.Load()
        // Optionally compute newCfg from old here
        if current.CompareAndSwap(old, newCfg) {
            return
        }
    }
}

func ReadConfig() *Config { return current.Load() }
```

The pointer swap publishes a fully-built immutable struct in one atomic step. Readers see either the old or the new struct, never a half-built one.

### Pattern 3: First-one-wins flag

```go
var done atomic.Bool

func OnFirstSee(f func()) {
    if done.CompareAndSwap(false, true) {
        f()
    }
}
```

The pattern under `sync.Once`, init flags, and "log this warning exactly once" code.

### Pattern 4: Snapshot-then-update

When the new value depends on the old:

```go
for {
    old := state.Load()
    new := transform(old)
    if state.CompareAndSwap(old, new) {
        return
    }
}
```

`transform` must be a pure function — no side effects. If `transform` writes to disk and then the CAS fails, you have written to disk for nothing.

### Pattern 5: Two-step (load, then CAS) under the same loop

For "either succeed or report current value":

```go
for {
    old := state.Load()
    if !ok(old) {
        return old, false
    }
    if state.CompareAndSwap(old, next(old)) {
        return next(old), true
    }
}
```

The `ok` check filters out invalid states without a CAS — saving the round-trip when the answer is "no, you cannot transition."

---

## Clean Code

- **Hide the CAS-loop inside a method.** `counter.Inc()` is what callers see. They should not have to write the loop.
- **Name the loop variable `old`.** Conventionally, the loaded value is `old`, the computed value is `new` (or `next`). Stick to the convention; readers expect it.
- **Always break on success.** A `for { ... }` without a break is a bug. The `if ok { break }` line is the load-bearing escape.
- **Keep `compute(old)` short and pure.** No I/O, no allocation, no calls that take a lock. If the computation is non-trivial, document why.
- **Document the contention assumption.** "This counter is incremented at most 10k/sec, so the CAS-loop will rarely retry." A reader who comes later needs to know.
- **Prefer typed atomics for new code.** `atomic.Int64.CompareAndSwap` is harder to misuse than `atomic.CompareAndSwapInt64(&x, ...)`. The compiler enforces alignment; you cannot copy by mistake.

---

## Product Use / Feature

| Product feature | How CAS delivers it |
|---|---|
| Rate-limited API endpoint | A CAS-protected token bucket can refill atomically without locks. |
| Real-time leaderboard | "Set if greater than" via CAS makes high-watermark updates lock-free. |
| Feature-flag rollout (gradual) | A CAS-protected percentage counter lets goroutines decide "am I in the rollout?" without contention. |
| Initialisation guard | `sync.Once`-style CAS for "init exactly once on first use." |
| Reference-counted shared buffers | CAS-based refcount lets multiple readers share a buffer until the last drops it. |
| Concurrent in-memory cache | CAS-protected entries (or a CAS-managed eviction queue) reduce contention vs a global lock. |
| Connection pool free list | Push and pop on a lock-free stack make pool checkout fast. |
| Background metrics counters | A CAS-loop conditional update (or `Add`) is cheaper than mutex-guarded counters for hot metrics. |

---

## Error Handling

CAS itself does not return an error. It returns a bool: success or failure. The failure means "your old value is stale; try again." It is not an exceptional condition; it is the expected outcome under contention.

What you must handle:

### 1. Loop forever vs bounded retry

```go
for {
    old := state.Load()
    if state.CompareAndSwap(old, next(old)) { return }
}
```

This loops until it succeeds. Under sustained contention with N goroutines, one always wins per cycle, so progress is bounded. But for individual goroutines, no upper bound.

A bounded retry:

```go
const maxRetries = 1000
for i := 0; i < maxRetries; i++ {
    old := state.Load()
    if state.CompareAndSwap(old, next(old)) { return nil }
}
return errors.New("CAS contention too high")
```

Useful when the alternative is hanging a request indefinitely.

### 2. Compute can fail

If `compute(old)` may fail (e.g., it queries something), handle the error before attempting CAS:

```go
for {
    old := state.Load()
    new, err := compute(old)
    if err != nil {
        return err
    }
    if state.CompareAndSwap(old, new) {
        return nil
    }
}
```

The error path exits the loop. The CAS-fail path retries.

### 3. Validate the state before CAS

```go
for {
    old := state.Load()
    if !valid(old) {
        return ErrInvalidState
    }
    if state.CompareAndSwap(old, next(old)) {
        return nil
    }
}
```

A check before the CAS is cheaper than discovering invalidity after a successful CAS.

---

## Security Considerations

- **CAS does not protect against malicious data.** It guarantees atomicity, not correctness. If `compute(old)` is wrong, CAS will faithfully commit the wrong answer.
- **Livelock as DoS.** A pathological workload that intentionally creates high contention can starve a goroutine indefinitely. If your service uses CAS on a hot path that handles untrusted input, audit for adversarial contention.
- **Resource exhaustion under spin.** A bug that turns a CAS-loop into a spin (CAS always failing) pegs a CPU core forever. Always test under contention.
- **Memory disclosure via partial writes.** CAS guarantees no partial writes. Plain non-atomic writes do not. If you mix non-atomic writes and CAS reads on the same word, you can leak partial bytes — typically only relevant in unsafe code with packed structs.
- **ABA in security-sensitive contexts.** A pointer that points to a freed-and-recycled token can pass a CAS check. In Go this is rare (GC pins live pointers), but it matters when implementing custom pools or interop with C.

---

## Performance Tips

- **Prefer `Add` over CAS-loop for simple counters.** `atomic.Int64.Add(1)` is one instruction; CAS loop is at least three plus a conditional.
- **CAS retries are not free.** Each failed attempt re-reads the value and re-runs `compute`. If `compute` is expensive, design for low contention.
- **Cache-line bouncing dominates under contention.** Every successful CAS transfers the cache line. With many cores, the line ping-pongs. Sharding (see `03-sync-package/07-atomic/senior.md`) is the answer.
- **`Load` on an aligned word is essentially free on x86.** Reading the current value before CAS costs nothing meaningful. Always re-load on retry.
- **Avoid CAS in tight loops over the same variable.** Batch updates if possible. Better still, restructure to update local state and CAS-publish at the end.
- **Modern CPU CAS cost.** Uncontended: 5-15 ns. Under contention from 8 cores: 50-200 ns. Way over 100 ns: you have a bigger problem than CAS.
- **Spin yield.** A pure spin-CAS pegs a core. `runtime.Gosched()` after a few failures can help, though `sync.Mutex` is usually a better answer for genuinely contended workloads.

---

## Best Practices

1. Always use the canonical 4-step CAS-loop skeleton. Variations should be deliberate.
2. Prefer typed atomics (`atomic.Int64`, `atomic.Pointer[T]`) over the standalone functions for new code.
3. Keep `compute(old)` pure. No side effects, no allocations (when avoidable), no calls into other concurrency primitives.
4. Break out of the loop on success. Never assume the CAS will succeed without checking.
5. Use `Add` or `Or`/`And` when the operation maps to a dedicated atomic primitive. Reserve CAS for genuinely conditional updates.
6. Document the contention profile and the worst-case retry behaviour.
7. Test with `go test -race` — even though CAS is race-safe by definition, the surrounding code may not be.
8. Benchmark under realistic contention (multiple goroutines hammering the same variable). Uncontended benchmarks are misleading.
9. When in doubt, use a mutex. Lock-free is harder to get right and not always faster.
10. Cross-reference the ABA problem (`02-aba-problem`) when CAS-ing a pointer that can be recycled.

---

## Edge Cases & Pitfalls

### Pitfall 1: Mixing atomic and non-atomic access

```go
var x int64
go func() { x = 5 }()                                     // non-atomic write
go func() { atomic.CompareAndSwapInt64(&x, 5, 10) }()     // atomic CAS
```

The non-atomic write races with the CAS. The race detector flags it. Always use atomic reads/writes for any variable that participates in CAS.

### Pitfall 2: Forgetting the loop

```go
// BUG — only tries once
old := counter.Load()
counter.CompareAndSwap(old, old+1) // may fail silently
```

If the CAS fails, the increment is lost. Always loop until success (or until a bounded retry limit).

### Pitfall 3: Computing the new value before the load inside the loop

```go
// BUG — newVal is computed once, but old changes
newVal := compute(initialOld)
for {
    old := counter.Load()
    if counter.CompareAndSwap(old, newVal) { break }
}
```

`newVal` does not reflect the latest `old`. The result is whatever `newVal` was on the first iteration, regardless of what other goroutines did. Compute new inside the loop, based on the current `old`.

### Pitfall 4: Side effects inside `compute(old)`

```go
for {
    old := counter.Load()
    fmt.Println("attempt:", old) // side effect
    if counter.CompareAndSwap(old, old+1) { break }
}
```

Under contention this prints many times per increment. Side effects belong outside the loop — or you have to accept that they may run multiple times per logical update.

### Pitfall 5: 32-bit alignment of int64

On 32-bit platforms (and some embedded ARM), an unaligned `int64` causes a panic on atomic operations. The fix: use `atomic.Int64` (which forces alignment via the compiler), or place the field at the top of the struct.

```go
type Bad struct {
    flag bool
    v    int64 // may be misaligned on 32-bit
}

type Good struct {
    v    int64 // first; aligned to 8 bytes
    flag bool
}

// Best
type Best struct {
    v atomic.Int64 // alignment handled by the type
    flag bool
}
```

### Pitfall 6: CAS on a copied value

```go
type Counter struct { v atomic.Int64 }

func (c Counter) Inc() { c.v.Add(1) } // BUG — value receiver
```

The receiver is a copy. `c.v.Add(1)` modifies the copy and discards it. Caller's `Counter` is unchanged. `go vet` flags this because `atomic.Int64` has a `noCopy` marker. Use a pointer receiver: `func (c *Counter) Inc()`.

### Pitfall 7: Spurious failure on weak architectures (not Go)

On some architectures (notably older ARM, before the dedicated CAS instruction), CAS is implemented as load-linked / store-conditional and can fail spuriously (the OS preempted the thread between LL and SC). Go's atomics handle this internally — the runtime retries the LL/SC. Your CAS function call still returns a meaningful `true` or `false`. You do not have to handle spurious failure in user code.

---

## Common Mistakes

### Mistake 1: Forgetting that CAS returns a bool

```go
// BUG — ignores the return value
counter.CompareAndSwap(old, old+1)
```

The return tells you whether the swap happened. Ignoring it means losing track of which path you took.

### Mistake 2: Doing I/O inside the CAS loop

```go
for {
    old := state.Load()
    log.Printf("trying to update from %d", old) // every retry logs
    if state.CompareAndSwap(old, old+1) { break }
}
```

Under contention this floods the log. Hoist I/O outside the loop or use a log-once pattern.

### Mistake 3: Confusing CAS with mutex semantics

```go
// BUG — CAS does not "wait" for the lock to be free
ok := flag.CompareAndSwap(true, false)
if !ok {
    // do work assuming we have the lock — WRONG
}
```

CAS does not block. If it returns false, you do not own anything. The correct pattern: spin or back off and retry, *not* assume success.

### Mistake 4: Treating `Load` and `CompareAndSwap` as atomic together

```go
old := counter.Load()              // step 1
new := old + 1                     // step 2
counter.CompareAndSwap(old, new)   // step 3
```

The three steps are individually atomic but the *group* is not. Another goroutine can change `counter` between step 1 and step 3 — that is precisely why CAS reports failure. Atomicity is per-call, not per-block.

### Mistake 5: Using CAS where `Add` suffices

```go
for {
    old := c.Load()
    if c.CompareAndSwap(old, old+1) { break }
}

// vs

c.Add(1)
```

Both are correct. The second is one instruction. The first is at least three plus a retry loop. Reserve CAS for conditional updates that `Add`, `Or`, `And` do not cover.

### Mistake 6: Copying a struct containing an atomic

```go
type Counter struct { v atomic.Int64 }

c := Counter{}
c.v.Add(1)
c2 := c  // copy — c2.v starts at 1, but c and c2 are independent now
c2.v.Add(1)
fmt.Println(c.v.Load(), c2.v.Load()) // 1 2 — surprise
```

Atomics inside structs should generally be untouchable. `go vet` warns. Use pointers when sharing structs containing atomics.

---

## Common Misconceptions

### "CAS is always faster than a mutex"

False. Under heavy contention, the retry cost can exceed the mutex cost. Mutexes also have spinning fast paths internally. Benchmark before claiming a win.

### "Lock-free means fast"

Lock-free is a *progress* guarantee, not a performance guarantee. A correctly-implemented lock-free algorithm can be slower than a mutex-based one. The benefit is robustness against thread suspension and priority inversion, which matters for kernels and real-time systems more than typical Go apps.

### "CAS prevents all races"

CAS prevents races *on the variable it operates on*. If your algorithm reads two variables and writes one, the read of the second variable is not protected unless you also synchronise it.

### "If CAS fails, my data is corrupted"

The opposite. CAS *guarantees* no write happens when it fails. Failure means "no change made; please retry." Your data is exactly as it was.

### "ABA never happens in Go because of GC"

Mostly true for pointer CAS, but false for integer CAS (indices, generation numbers) and for pointer CAS when you bypass the GC with pools. See `02-aba-problem`.

### "CAS works on any data type"

It works on any value that fits in the CPU's natively-atomic word — typically 32 or 64 bits. For larger structs you must wrap them in a pointer and CAS the pointer.

---

## Tricky Points

### Sequential consistency in Go

Every Go atomic op — `Load`, `Store`, `Add`, `CompareAndSwap` — is sequentially consistent. This is stronger than the default in C++ (`memory_order_relaxed`). The cost is mostly invisible on x86 (TSO handles it) and noticeable but acceptable on ARM. The benefit is you do not have to choose memory orderings. Reasoning about ordering is much simpler than in C++.

### Why the "new" must depend on "old"

In a CAS loop you almost always have `new := compute(old)`. This is not just a style choice — it is the correctness argument. The CAS succeeds because `old` is still the current value, so `new` is a valid successor. If `new` is computed without reference to `old`, you are doing an unconditional overwrite — at which point a plain `Store` suffices.

### Loading vs the value passed to CAS

```go
old := counter.Load()
ok := counter.CompareAndSwap(old, old+1)
```

The `old` passed to CAS *must* be exactly what you loaded. If you compute a derived value and pass it as `old`, CAS will fail every time except by coincidence.

### The "old, old+1" idiom for atomic increment

This is so common it deserves a name. It is the building block for any "atomically increment, return the new value" code. For the actual atomic increment (no condition), use `Add`. But the CAS form is the general template for "increment, then publish."

### Why typed atomics need a pointer receiver

`atomic.Int64`, `atomic.Pointer[T]`, etc., embed a `noCopy` marker. They cannot be safely copied because their address might be referenced from elsewhere (CPU's exclusive monitor on ARM, or just other goroutines holding pointers to the same word). A pointer receiver keeps the address stable.

---

## Test

```go
package counter

import (
    "sync"
    "sync/atomic"
    "testing"
)

type Counter struct {
    v atomic.Int64
}

func (c *Counter) Inc() {
    for {
        old := c.v.Load()
        if c.v.CompareAndSwap(old, old+1) {
            return
        }
    }
}

func TestCounter_Sequential(t *testing.T) {
    var c Counter
    for i := 0; i < 1000; i++ {
        c.Inc()
    }
    if got := c.v.Load(); got != 1000 {
        t.Fatalf("got %d, want 1000", got)
    }
}

func TestCounter_Concurrent(t *testing.T) {
    var c Counter
    var wg sync.WaitGroup
    const goroutines = 16
    const perGoroutine = 1000
    for i := 0; i < goroutines; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < perGoroutine; j++ {
                c.Inc()
            }
        }()
    }
    wg.Wait()
    want := int64(goroutines * perGoroutine)
    if got := c.v.Load(); got != want {
        t.Fatalf("got %d, want %d", got, want)
    }
}

func BenchmarkCounter_Inc(b *testing.B) {
    var c Counter
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            c.Inc()
        }
    })
}
```

Run with:

```
go test -race -run . -bench=. -benchmem
```

The race test should pass because every access goes through atomic ops.

---

## Tricky Questions

**Q1: If I write `c.v.Add(1)` and `c.v.CompareAndSwap(old, new)` in the same program, are they synchronised with each other?**

Yes. All Go atomic ops on the same memory location are sequentially consistent. The runtime guarantees `Add` and `CompareAndSwap` observe each other.

**Q2: Can a CAS succeed even though the variable was briefly something else?**

Yes — the ABA problem. The CAS only compares the *current* value to the *old* value. It does not know about intermediate states. In Go, for pointer CAS, the GC mostly prevents this from being exploitable. For integer CAS, it can absolutely happen.

**Q3: Does `atomic.CompareAndSwapPointer` accept any `unsafe.Pointer`?**

Yes, but you must convert your `*T` to `unsafe.Pointer` and back. The Go 1.19+ typed `atomic.Pointer[T]` is far safer — it preserves the type and avoids `unsafe`.

**Q4: What happens if I CAS on a misaligned address?**

On amd64, nothing visible — the hardware handles it (with a performance cost). On 32-bit platforms and some ARM variants, it panics with "unaligned 64-bit atomic operation." Use `atomic.Int64` to avoid the issue entirely.

**Q5: Is the CAS loop wait-free?**

No. It is lock-free but not wait-free. Any single goroutine can fail its CAS arbitrarily many times under contention. The progress guarantee is that *some* goroutine succeeds each round, not every goroutine.

**Q6: Does `CompareAndSwap` count as a memory barrier?**

Yes. Like all Go atomics, it imposes sequential consistency: every memory op before the CAS in program order is observed by every other thread before any op after the CAS. This is true on every architecture Go supports.

**Q7: Can I CAS a struct?**

Not directly. CAS works on a single word. To CAS a struct, wrap it in a pointer and use `atomic.Pointer[T]`. The pointer-swap publishes the entire new struct atomically.

**Q8: How does the typed atomic prevent copies?**

It embeds a zero-sized `noCopy` field. `go vet` and `staticcheck` flag copies. The compiler does not prevent copies, but the linter catches them.

---

## Cheat Sheet

```
// Standalone (legacy, all Go versions)
ok := atomic.CompareAndSwapInt32(&x, old, new)
ok := atomic.CompareAndSwapInt64(&x, old, new)
ok := atomic.CompareAndSwapUint32(&x, old, new)
ok := atomic.CompareAndSwapUint64(&x, old, new)
ok := atomic.CompareAndSwapUintptr(&x, old, new)
ok := atomic.CompareAndSwapPointer(&p, old, new)

// Typed (Go 1.19+, preferred)
var x atomic.Int64
ok := x.CompareAndSwap(old, new)

var p atomic.Pointer[T]
ok := p.CompareAndSwap(oldPtr, newPtr)

// Canonical CAS loop
for {
    old := shared.Load()
    new := compute(old)
    if shared.CompareAndSwap(old, new) {
        break
    }
}

// Conditional CAS (exit if not in valid state)
for {
    old := state.Load()
    if !canTransition(old) { return false }
    if state.CompareAndSwap(old, next(old)) { return true }
}

// One-shot flag
if done.CompareAndSwap(false, true) {
    initialise()
}
```

Approximate timing on a modern x86:

| Operation | Uncontended | Heavily contended (8 cores) |
|---|---|---|
| `Load`              | ~1 ns   | ~1 ns           |
| `Store`             | ~5 ns   | ~50 ns          |
| `Add`               | ~5-10 ns | ~50-200 ns     |
| `CompareAndSwap` (success) | ~5-15 ns | ~50-300 ns |
| `Mutex Lock+Unlock` | ~25 ns  | ~200-2000 ns    |

---

## Self-Assessment Checklist

- [ ] I can explain in one sentence what CAS does.
- [ ] I can write the canonical 4-step CAS loop from memory.
- [ ] I know the difference between `atomic.CompareAndSwapInt64` and `atomic.Int64.CompareAndSwap`.
- [ ] I have written a CAS-based counter and verified it under `-race`.
- [ ] I have written a CAS-based one-shot flag.
- [ ] I have written `Push` and `Pop` on a Treiber stack.
- [ ] I understand why CAS is lock-free but not wait-free.
- [ ] I can explain what livelock is and when it can happen.
- [ ] I know that CAS does not protect against the ABA problem.
- [ ] I know that Go's atomics are sequentially consistent.
- [ ] I know that on 32-bit platforms `int64` must be 8-byte aligned for atomic ops.
- [ ] I prefer `Add` over a CAS-loop for simple increments.
- [ ] I prefer typed atomics for new code.

---

## Summary

CAS is one CPU instruction with one bool return value, and it is the foundation of every non-trivial lock-free algorithm. The canonical pattern is "snapshot, compute, commit; retry on conflict." Go exposes it through `sync/atomic`'s `CompareAndSwap*` family (Go 1.0+) and through typed methods on `atomic.Int64`, `atomic.Pointer[T]`, etc. (Go 1.19+). The latter is preferred for new code.

Three things to remember:

1. **CAS only validates one word at a time.** If you need to atomically update two unrelated variables, CAS alone is not enough.
2. **The loop is the algorithm.** A bare CAS is rarely useful; the CAS loop with `compute(old)` is the building block.
3. **Lock-free is not free of pathologies.** Livelock under contention, ABA, lost retries — all real failure modes. Benchmark, test, and reason about contention before going lock-free.

Once you internalise the CAS loop, lock-free counters, flags, stacks, and pointer swaps fall out as variations. The middle and senior levels add lock-free queues, sharding for contention, and the formal memory model. The professional level descends to the hardware: `LOCK CMPXCHG`, ARMv8 `CAS`, and the cache-coherence cost.

---

## What You Can Build

After mastering CAS at the junior level you can build:

- A thread-safe counter without using a mutex (just `Add` or a CAS-loop).
- A high-watermark / low-watermark tracker.
- A `sync.Once`-like primitive for "exactly once" initialisation.
- A simple lock-free LIFO (Treiber stack) for collecting events from many goroutines.
- A configuration "hot reload" mechanism where readers always see a complete config object.
- A bounded counter (increment if below max) for a rate limiter.
- A reference counter for shared-ownership objects (paired with care; see senior level).
- A "first writer wins" log-once helper.

---

## Further Reading

- The Go source: `src/sync/atomic/doc.go` — terse but authoritative.
- The Go memory model: <https://go.dev/ref/mem> — Section "Synchronization" covers atomic synchronisation rules.
- "The Art of Multiprocessor Programming" by Herlihy and Shavit — the textbook of lock-free algorithms.
- "Lock-Free Programming" tutorial by Preshing — <https://preshing.com/20120612/an-introduction-to-lock-free-programming/>.
- Russ Cox: "Hardware Memory Models" — <https://research.swtch.com/hwmm>.
- Russ Cox: "Programming Language Memory Models" — <https://research.swtch.com/plmm>.
- Documentation for `sync/atomic`: <https://pkg.go.dev/sync/atomic>.

---

## Related Topics

- `02-aba-problem` — The classic CAS bug; required reading after you have CAS in your hands.
- `03-lock-free-data-structures` — Where CAS becomes stacks, queues, hash maps.
- `04-memory-fences` — The ordering semantics that underpin CAS.
- `05-lock-free-vs-wait-free` — Where CAS sits on the progress-guarantee spectrum.
- `07-concurrency/03-sync-package/07-atomic` — The atomic package itself; CAS lives here.
- `07-concurrency/03-sync-package/01-mutex` — The alternative; know when to prefer it.
- `07-concurrency/03-sync-package/06-once` — Real-world CAS-based primitive.

---

## Diagrams & Visual Aids

### The CAS-loop state machine

```
       +--------+
       | start  |
       +--------+
           |
           v
   +---------------+
   | Load old      |
   +---------------+
           |
           v
   +---------------+
   | Compute new   |
   +---------------+
           |
           v
   +---------------+
   | Try CAS       |
   +---------------+
       /       \
   success    failure
      |          |
      v          v
   +-----+   re-loop
   | end |
   +-----+
```

### What CAS does at the memory level

```
Before:   *addr == old   ?
            |             |
           yes            no
            |             |
            v             v
        *addr = new   no change
        return true   return false
```

### CAS vs mutex: the conceptual difference

```
Mutex:    [acquire] -> [work] -> [release]
                |
                v
           blocks other goroutines

CAS:      [read] -> [compute] -> [try-write]
                                     |
                                     v
                              succeeds or retries;
                              never blocks
```

### Lock-free progress under contention

```
Time ->

G1: [read] [compute] [CAS-fail] [read] [compute] [CAS-OK]
G2: [read] [compute] [CAS-OK]
G3:        [read]    [compute]  [CAS-fail] [read] [compute] [CAS-OK]

At each instant, at least one goroutine has just committed.
That is the lock-free guarantee.
```

### CAS loop with side note on the ABA problem

```
G1: top := head.Load()    // top points to A; A.next = B
G1: <descheduled>
G2: Pop A, Pop B, Push A back (A.next now = C)
G1: <resumes>
G1: head.CAS(A, B)       // SUCCEEDS! But B is no longer reachable.
                          // (See 02-aba-problem)
```

---
