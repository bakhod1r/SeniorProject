# Lock-Free vs Wait-Free — Junior Level

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
> Focus: "What is the precise difference between lock-free and wait-free? Where do mutexes, CAS loops, and `atomic.Add` sit? When does the distinction actually matter?"

If you have written `atomic.AddInt64`, retried a `CompareAndSwap` in a `for` loop, or read about Go's lock-free `sync.Map`, you have already touched two very different progress guarantees without anyone naming them. The vocabulary was nailed down by Maurice Herlihy in a 1991 paper called *Wait-Free Synchronization*, which still sets the terms researchers and systems engineers use today.

There are four rungs on the ladder. The bottom rung — **blocking** — describes ordinary mutexes: if a thread holding the lock is paused by the scheduler, every other thread waits. The top rung — **wait-free** — describes algorithms in which every thread is guaranteed to finish each operation in a bounded number of its own steps, no matter how badly other threads behave. In between sit **obstruction-free** (very weak) and **lock-free** (the workhorse of practical lock-free programming).

After reading this file you will:

- Be able to state the four definitions in one sentence each
- Place common Go constructs — `mutex`, `atomic.Add`, CAS loops, Treiber stack, channels — on the hierarchy
- Know that "lock-free" is *not* the same as "wait-free," and stop using the words as synonyms
- Understand why wait-free algorithms exist, why they are rare in production, and what they cost
- Recognise that for the overwhelming majority of Go code, the right answer is "mutex" or "lock-free," not "wait-free"
- Know what "starvation" means and why lock-free does not prevent it for individual threads
- Be ready to read the middle and senior files where we build the structures and analyse them

You do not need to be a CAS guru. If you have written one `CompareAndSwap` loop and you understand that a mutex can be held by exactly one goroutine at a time, you are ready.

---

## Prerequisites

- **Required:** Comfort with `sync.Mutex`, `sync.RWMutex`, and the idea that "Lock blocks until the lock is free." If `m.Lock()` and `m.Unlock()` are unfamiliar, finish the mutex section first.
- **Required:** Basic familiarity with `sync/atomic` — at least `atomic.AddInt64`, `atomic.LoadInt64`, `atomic.CompareAndSwap*`. You should know what CAS does at the level of "if the cell still holds the old value, swap it for the new value; otherwise tell me you failed."
- **Required:** A working mental model of OS scheduling: the operating system can pause your goroutine (or the OS thread it runs on) at any instruction boundary, for any length of time, without asking.
- **Helpful:** The earlier subsections in this folder — `01-cas-algorithms`, `02-aba-problem`, `03-lock-free-data-structures`, `04-memory-fences`. None are strictly required to follow the *definitions*, but they make the *examples* concrete.
- **Helpful:** Some exposure to real-time systems (audio, robotics, kernel code) or to fault-tolerant distributed systems. This makes the case for wait-free intuitive rather than academic.

If you can write a CAS loop that increments a counter, and you can explain why `m.Lock(); x++; m.Unlock()` is correct, you have everything you need.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Progress guarantee** | A claim about whether and how quickly threads can complete operations. Each guarantee names what cannot go wrong — for example, "no thread can be permanently blocked by another." |
| **Blocking** | An algorithm in which one thread's progress can depend on another thread being scheduled. Mutexes are blocking: if the lock holder is paused, all waiters wait. |
| **Non-blocking** | The umbrella term for anything that is not blocking. Obstruction-free, lock-free, and wait-free are all non-blocking. |
| **Obstruction-free** | The weakest non-blocking guarantee. If you isolate a single thread (pause all others), it will finish its operation in a bounded number of steps. Says nothing about contention. |
| **Lock-free** | At every point in time, *some* thread in the system is making progress on its operation. Individual threads may starve forever, but the system as a whole never stalls. |
| **Wait-free** | *Every* thread completes each of its operations in a bounded number of its own steps, regardless of what other threads do. No starvation possible. |
| **Starvation** | A thread that is "alive" (not deadlocked) yet never finishes its operation because other threads keep beating it to the punch. Lock-free permits starvation; wait-free forbids it. |
| **CAS loop** | The pattern: read, compute, `CompareAndSwap`, retry if CAS failed. The canonical lock-free building block. |
| **Treiber stack** | A classic lock-free stack: each push and pop is a CAS on the head pointer. Lock-free but not wait-free. |
| **Universal construction** | Herlihy's 1993 result: any object can be made wait-free given a CAS (consensus number infinity). The construction is too slow for practical use, but it proves existence. |
| **Consensus number** | The maximum number of threads for which a primitive can solve consensus. Read/write registers have consensus number 1; CAS has consensus number infinity. |
| **Hard real-time** | A system where missing a deadline is a failure (audio underruns, control loops, anti-lock brakes). The case where wait-free really earns its complexity. |
| **Fault tolerance** | A system that must continue operating when individual threads or processes fail. A frozen thread should not freeze the data structure. |
| **Helping** | A mechanism inside wait-free algorithms in which faster threads complete the announced operations of slower threads, so no one is left behind. |
| **Bounded steps** | A finite, statically determined number — not "eventually," not "fast in practice." The wait-free promise is that you can write down a worst-case integer bound. |

---

## Core Concepts

### The progress hierarchy at a glance

This single table is the most important thing in the entire file. Memorise the rows; the rest of the document expands them.

| Rung | Guarantee | What it survives | What it does NOT survive | Canonical Go example |
|------|-----------|------------------|--------------------------|----------------------|
| **Blocking** | "If the lock holder runs, I make progress." | Nothing — depends on the scheduler. | A paused / crashed / slow lock holder blocks everyone. | `sync.Mutex`, `sync.RWMutex`, channels with full buffers. |
| **Obstruction-free** | "If I run alone, I finish in bounded steps." | A single thread can always make progress *if isolated*. | High contention can livelock every thread forever. | A double-word transactional memory primitive (rare in Go). |
| **Lock-free** | "Some thread is always making progress." | One thread getting stuck — others keep going. | An individual thread starving forever. | A CAS-loop counter; `atomic.Pointer` Treiber stack. |
| **Wait-free** | "Every thread finishes each operation in bounded steps." | Arbitrary delays, suspension, even thread failure. | The complexity of implementing it. | `atomic.AddInt64` on a single counter; Kogan-Petrank queue. |

Read it top to bottom and the guarantees get strictly stronger. Read it left to right and the *cost* of providing them gets higher.

### Definition 1: Blocking

A blocking algorithm allows one thread's progress to depend on whether another thread is running. The canonical example is a mutex.

```go
var mu sync.Mutex
var counter int

func bump() {
    mu.Lock()         // blocks if another goroutine holds it
    counter++
    mu.Unlock()
}
```

If the goroutine that called `Lock()` is descheduled by the OS while holding the mutex, **every other goroutine** that calls `bump()` blocks until the OS reschedules the lock holder. The system as a whole is at the mercy of the scheduler.

Blocking is *fine* for the vast majority of code. CPUs schedule fast, mutexes are cheap, and the scheduler rarely keeps a thread away for long. The pathological cases are rare. But "rare" is not "never," and there are settings (real-time, signal handlers, kernel code) where "rare" is unacceptable.

### Definition 2: Obstruction-free

An algorithm is obstruction-free if a thread running in isolation — that is, all other threads paused — completes its operation in a bounded number of steps.

This is a very weak guarantee. It says nothing about what happens when threads contend. You can have an obstruction-free algorithm in which two threads, running simultaneously, both retry forever and neither ever finishes. (This is **livelock**: nobody is blocked, everybody is busy, nobody makes progress.)

In Go you almost never encounter pure obstruction-free algorithms. They show up in software transactional memory (STM) research and in academic papers. We mention obstruction-free mainly to complete the hierarchy and to clarify that "lock-free" is *strictly stronger*.

### Definition 3: Lock-free

An algorithm is lock-free if, at every moment, at least one thread in the system is making progress on its operation. Equivalently: in any infinite execution, infinitely many operations complete.

The keyword is **system-wide**. The lock-free promise says nothing about *which* thread makes progress, only that some thread does. An unlucky thread can lose every CAS retry forever — the system advances, but that one thread never gets its work done. That is **starvation**, and lock-free permits it.

The CAS-loop counter is the textbook lock-free example:

```go
var counter atomic.Int64

func bump() {
    for {
        old := counter.Load()
        if counter.CompareAndSwap(old, old+1) {
            return
        }
        // CAS failed because someone else changed the value.
        // Loop. Someone else succeeded — system progressed.
    }
}
```

Whenever your CAS fails, the reason is that some *other* goroutine's CAS succeeded. The counter advanced. So the system advanced. That is the lock-free property. But the goroutine whose CAS keeps failing? It could in principle retry forever.

In practice, on real hardware with a finite number of threads, starvation is rare and short-lived. But "rare" is not "impossible," and the difference matters.

### Definition 4: Wait-free

An algorithm is wait-free if every thread completes every operation in a bounded number of its own steps, regardless of what other threads are doing.

"Bounded" is the load-bearing word. It does not mean "fast." It does not mean "soon." It means: there exists an integer `B` such that, no matter how many other threads are running, how many of them are stuck, how many have crashed, your thread will finish in at most `B` of its own instructions.

The bound is usually a function of the number of threads, not of time or other threads' behaviour. The classic Kogan-Petrank wait-free queue has a bound that is `O(N)` in the number of threads.

The simplest wait-free algorithm in Go is the one-instruction atomic:

```go
var counter atomic.Int64

func bump() {
    counter.Add(1) // wait-free: one machine instruction, always succeeds
}
```

`atomic.Add` is implemented (on x86) as a single `LOCK XADD` instruction. There is no loop, no retry, no CAS. The instruction either runs or it does not — and when it runs, it always succeeds. Every thread that calls `bump()` returns in `O(1)` steps. That is wait-free.

### The pivotal insight: CAS loops are not wait-free

This is the question that catches most candidates out, and it is the heart of this entire file.

```go
for {
    old := counter.Load()
    if counter.CompareAndSwap(old, old+1) {
        return
    }
}
```

is **lock-free, not wait-free**, even though the body of the loop uses only atomic operations.

Why? Because the CAS can fail. And if many other goroutines keep beating you to the punch, your CAS keeps failing, and your `for` loop runs again and again. The number of iterations is unbounded — there is no integer `B` you can write down that bounds the worst case. Some other goroutine always makes progress (so the system is lock-free), but *yours* might not.

Meanwhile:

```go
counter.Add(1)
```

is wait-free. The hardware guarantees it completes in one instruction. There is no retry, no loop, no failure mode.

If you remember nothing else from this file, remember this: **`atomic.Add` is wait-free; a CAS loop is lock-free.** Same atomic package, fundamentally different progress guarantees.

### Where common Go constructs sit

| Construct | Progress class | Why |
|-----------|---------------|-----|
| `sync.Mutex` | Blocking | Holder can be paused; waiters stall. |
| `sync.RWMutex` | Blocking | Writer waiting for readers; readers can starve under writers. |
| `sync.WaitGroup` (Add/Done/Wait) | Blocking (Wait); wait-free (Add/Done) | Add and Done are single atomic ops; Wait blocks until counter hits zero. |
| `chan` (buffered, with space) | Lock-free if uncontended; blocking when full | Internally a mutex + condition variable. |
| `chan` (unbuffered) | Blocking | A send waits for a receive. |
| `atomic.AddInt64` | Wait-free | One instruction. |
| `atomic.LoadInt64` / `StoreInt64` | Wait-free | One instruction. |
| `atomic.CompareAndSwapInt64` (single call, no loop) | Wait-free | One instruction. |
| CAS *loop* | Lock-free | Unbounded retries under contention. |
| Treiber stack | Lock-free | Push and pop both CAS-loop the head pointer. |
| Michael-Scott queue | Lock-free | Head and tail both updated via CAS loops. |
| Kogan-Petrank queue | Wait-free | Helping mechanism guarantees per-thread bound. |
| `sync.Map` | Mixed | Read path is lock-free for hot keys; writes can take a mutex. |
| `sync.Pool` | Mixed | Per-P fast path is lock-free; victim cache and global pool use locks. |

Notice how often "lock-free" appears and how rarely "wait-free." That is not an accident. Wait-free is hard to implement and usually slower in steady-state — more on this in the trade-offs section.

### Starvation: the gap between lock-free and wait-free

The simplest way to internalise the lock-free / wait-free gap is to picture a Treiber stack under heavy contention.

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
        top := s.head.Load()
        n.next = top
        if s.head.CompareAndSwap(top, n) {
            return
        }
    }
}
```

Imagine 100 goroutines all calling `Push`. They all read `head` at roughly the same moment, all compute `n.next = top`, all CAS — and exactly one wins. The other 99 retry. They re-read `head`, recompute `n.next`, CAS — and one more wins. Repeat.

There is no rule that says all 100 goroutines eventually win. In an adversarial model, the *same* one could keep losing forever: every time it gets to its CAS, some other goroutine has just succeeded. That goroutine starves. The Treiber stack is lock-free (the system always advances) but not wait-free (any individual operation has no bound).

In practice, on real hardware, the scheduler is fair enough and the contention pattern random enough that starvation is rare. But "rare" is not "impossible," and in a hard-real-time setting "rare" is unacceptable.

### Why wait-free is hard

Three reasons.

First, **helping**. Wait-free algorithms usually require slow threads to "announce" their pending operations, and faster threads must finish those announced operations on the slow threads' behalf. The bookkeeping is intricate — every operation reads other threads' announcements and decides whether to do its own work or help.

Second, **bounded work per operation**. You cannot have a `for` loop with an unbounded number of iterations. Every loop must have a static bound on its iteration count. This rules out the CAS-retry pattern that is the bread and butter of lock-free code.

Third, **memory reclamation**. If thread T1 announces "please help me dequeue this node," and ten other threads see the announcement and start helping, who frees the node? Hazard pointers, epochs, and refcount tricks become extra complicated.

The result is that hand-written wait-free data structures are typically 2x to 10x slower in steady-state than their lock-free counterparts. They are worth it only when you cannot tolerate any thread being delayed, ever.

### The Universal Construction (Herlihy 1993)

A theoretical lifeline: Herlihy proved in 1993 that *any* object — any sequential data structure with any operations — can be made wait-free given a primitive with consensus number infinity. CAS is such a primitive.

The construction works roughly like this. Every operation appends a log entry describing what it wants to do. A wait-free linearisation procedure decides the global order. Each thread applies operations in order, and after `O(N)` operations any pending operation will be applied (because every thread helps).

The construction is correct and wait-free but *brutally* slow — every operation pays `O(N)` per call where `N` is the number of threads. Nobody uses it directly. It is a proof of possibility, not a tool. But it tells you: if your design requires wait-free *something*, you can always have it. The interesting question is how cheap you can make it.

### Why this matters even if you never write wait-free code

Most Go programmers never implement a wait-free algorithm. So why learn the distinction?

1. **Vocabulary.** A senior engineer should not say "lock-free" when they mean "wait-free." It is a sign of imprecision. People who design these systems will assume you do not know what you are talking about.
2. **Choosing the right tool.** Lock-free is the right tool for "we want to be robust against thread suspension." Wait-free is the right tool for "we cannot tolerate any single operation taking more than `B` steps." Picking wait-free when lock-free would do means paying a 5x performance tax for no benefit.
3. **Reading library code.** The Go standard library uses *both*. Understanding which operations are wait-free (Load, Store, Add) versus lock-free (`sync.Map` reads with miss) versus blocking (`Mutex.Lock`) tells you what guarantees the library is offering.
4. **Real-time and safety-critical work.** If you ever cross into kernel, audio, robotics, anti-lock brakes, pacemakers, trading systems with hard deadlines — you will need the vocabulary fast.

---

## Real-World Analogies

### Mutex (blocking) = a single bathroom in a busy office

The first person locks the door. Everyone else waits. If the person inside falls asleep, the queue grows. The throughput depends entirely on how quickly each user finishes. Nobody gets in until the door unlocks. This is the blocking guarantee.

### Lock-free = a buffet line where servers refill the trays

There is always food coming out, somewhere on the line, all the time. The line as a whole is moving. But one unlucky guest in the middle might keep reaching for the tray just after someone else takes the last piece, then waiting for the next refill — over and over. The buffet (system) is making progress; this guest is starving. That is lock-free with thread starvation.

### Wait-free = a vending machine with one slot per person

Every person has their own slot. Pressing your button always dispenses your snack in exactly the time it takes the motor to turn. Other people pressing their buttons does not affect you. Every operation, for every person, finishes in a bounded number of steps. That is wait-free.

### Obstruction-free = a revolving door that jams when too many people push at once

If you are alone, you push and walk through. If three people push at the same time, the door jams and nobody gets in until everyone backs off. Obstruction-free guarantees the single-thread case but allows livelock under contention.

### Helping in wait-free = a kitchen where every cook helps finish each others' orders

Slow cook posts "I need to plate table 5." A faster cook sees the announcement and plates it themselves, so table 5's customer is served on time even if the slow cook has not caught up. Every order finishes in bounded time, but the bookkeeping is intricate — every cook reads every announcement.

---

## Mental Models

### Model 1: "Some" versus "every"

Lock-free says *some* thread always makes progress. Wait-free says *every* thread always makes progress. The English word that changes is the quantifier. Once you internalise this, you can read any paper or proof and immediately classify the guarantee.

### Model 2: "Bounded by what?"

Every progress guarantee is "bounded steps to completion under condition X." Ask: bounded by what? For wait-free, bounded by the algorithm's design (a static integer). For lock-free, no per-thread bound at all; only a system-wide "someone makes progress." For obstruction-free, bounded only if you isolate the thread. For blocking, bounded by external scheduling.

### Model 3: "Replace one thread with a brick"

Imagine pausing one thread forever — replacing it with a brick that holds whatever state it had when paused. Does the system still make progress?

- **Blocking:** If the brick holds the mutex, no.
- **Lock-free:** Yes — other threads keep working.
- **Wait-free:** Yes — every other thread completes its operations in bounded steps.

Then ask: does *every* surviving thread still make progress in bounded steps?

- **Lock-free:** Not guaranteed.
- **Wait-free:** Guaranteed.

This brick-thought-experiment is how Herlihy's paper motivates the definitions.

### Model 4: "What can the adversary do?"

Imagine an adversary who controls thread scheduling. They can pause, resume, reorder, or kill threads at will. What is the worst they can do to your algorithm?

- **Blocking:** Pause one thread holding a lock; the adversary has won — no one else makes progress.
- **Lock-free:** The adversary can starve any single thread of their choosing, but they cannot freeze the whole system.
- **Wait-free:** The adversary cannot delay any single operation past the static bound.

### Model 5: "Hardware versus software"

Most wait-free primitives in practice are hardware-supported (atomic add, atomic exchange, atomic CAS used *once*, not in a loop). Wait-free software-built data structures are rare because the bound becomes a software invariant rather than a hardware property. Asking "is this wait-free?" is closely related to "is there a hardware instruction that does the whole thing?"

---

## Pros & Cons

### Lock-free — Pros

- Robust against thread suspension. A goroutine paused mid-operation cannot block others.
- Often simpler to implement than wait-free.
- Frequently faster than mutex under low-to-moderate contention.
- Composable with the GC in Go (no manual memory reclamation in many cases).

### Lock-free — Cons

- Individual threads can starve.
- High contention degrades throughput as retries multiply.
- Reasoning is harder than with locks; ABA, memory ordering, and reclamation are subtle.
- Performance is fragile to cache-line layout and contention patterns.

### Wait-free — Pros

- Strongest possible progress guarantee.
- Per-thread latency bound is provable, not statistical.
- Tolerant of thread failure (a frozen thread does not stop the world).
- The right answer for hard real-time and safety-critical work.

### Wait-free — Cons

- Hardest to implement correctly.
- Often 2x to 10x slower than lock-free in steady-state, sometimes worse.
- Helping mechanisms add memory traffic and bookkeeping.
- Memory reclamation becomes especially intricate.
- For most application code, the strict guarantee is unnecessary.

### Mutex — Pros

- Simplest to write, simplest to read.
- Fast under low contention (atomic CAS to acquire, atomic store to release).
- Composes with everything (defer Unlock, RAII patterns).
- Easy to reason about: invariants hold "inside the lock."

### Mutex — Cons

- Blocking — any pause of the holder stalls every waiter.
- Priority inversion possible on real-time OS.
- Deadlock if locks are taken out of order.
- A single hot mutex is a scalability ceiling.

---

## Use Cases

| Scenario | Right progress class | Why |
|---|---|---|
| Per-request HTTP handler counter | Wait-free (`atomic.Add`) | One instruction, never contends with itself meaningfully. |
| Shared in-memory cache (read-heavy) | Lock-free for reads, mutex for writes (`sync.Map`) | Optimise hot path; tolerate write cost. |
| Stack of recyclable buffers | Lock-free (Treiber) | Push/pop are infrequent enough that starvation is moot. |
| Real-time audio sample queue | Wait-free | Underrun is unacceptable; bounded per-operation latency required. |
| Kernel-mode log ring | Wait-free | Logger must not block scheduler; deadlocks would freeze the OS. |
| Pacemaker control loop | Wait-free | Missing a tick is a medical event. |
| Database transaction commit | Blocking | Throughput matters more than per-transaction worst case; mutex is fine. |
| Configuration reload | Blocking | Infrequent; mutex is simplest. |
| Goroutine ID allocation | Wait-free (`atomic.Add`) | Trivial counter; no need for anything fancier. |
| HFT trade matching | Wait-free or lock-free | Per-message latency tail is the SLA; mutex tail latency is too long. |

---

## Code Examples

### Example 1: Mutex counter — blocking

```go
package main

import (
    "fmt"
    "sync"
)

type BlockingCounter struct {
    mu sync.Mutex
    n  int64
}

func (c *BlockingCounter) Add(delta int64) {
    c.mu.Lock()
    c.n += delta
    c.mu.Unlock()
}

func (c *BlockingCounter) Load() int64 {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.n
}

func main() {
    var c BlockingCounter
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            c.Add(1)
        }()
    }
    wg.Wait()
    fmt.Println("counter:", c.Load()) // 100
}
```

Correct. Blocking. If any goroutine is paused while holding the mutex, every other waiter pauses too.

### Example 2: CAS-loop counter — lock-free, not wait-free

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type CASCounter struct {
    n atomic.Int64
}

func (c *CASCounter) Add(delta int64) {
    for {
        old := c.n.Load()
        if c.n.CompareAndSwap(old, old+delta) {
            return
        }
    }
}

func (c *CASCounter) Load() int64 {
    return c.n.Load()
}

func main() {
    var c CASCounter
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            c.Add(1)
        }()
    }
    wg.Wait()
    fmt.Println("counter:", c.Load()) // 100
}
```

Lock-free. Some goroutine always wins each CAS round. But any *individual* goroutine could in principle lose every CAS forever — starvation is theoretically possible.

### Example 3: `atomic.Add` counter — wait-free

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type WaitFreeCounter struct {
    n atomic.Int64
}

func (c *WaitFreeCounter) Add(delta int64) {
    c.n.Add(delta) // single hardware instruction
}

func (c *WaitFreeCounter) Load() int64 {
    return c.n.Load()
}

func main() {
    var c WaitFreeCounter
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            c.Add(1)
        }()
    }
    wg.Wait()
    fmt.Println("counter:", c.Load()) // 100
}
```

Wait-free. Every `c.n.Add(1)` returns in O(1) hardware steps. No retry loop.

### Example 4: Side-by-side timing

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

func benchMutex(iters, workers int) time.Duration {
    var mu sync.Mutex
    var n int64
    start := time.Now()
    var wg sync.WaitGroup
    for w := 0; w < workers; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for i := 0; i < iters; i++ {
                mu.Lock()
                n++
                mu.Unlock()
            }
        }()
    }
    wg.Wait()
    _ = n
    return time.Since(start)
}

func benchCAS(iters, workers int) time.Duration {
    var n atomic.Int64
    start := time.Now()
    var wg sync.WaitGroup
    for w := 0; w < workers; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for i := 0; i < iters; i++ {
                for {
                    old := n.Load()
                    if n.CompareAndSwap(old, old+1) {
                        break
                    }
                }
            }
        }()
    }
    wg.Wait()
    return time.Since(start)
}

func benchAtomicAdd(iters, workers int) time.Duration {
    var n atomic.Int64
    start := time.Now()
    var wg sync.WaitGroup
    for w := 0; w < workers; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for i := 0; i < iters; i++ {
                n.Add(1)
            }
        }()
    }
    wg.Wait()
    return time.Since(start)
}

func main() {
    const iters = 100_000
    for _, w := range []int{1, 2, 4, 8, 16} {
        fmt.Printf("workers=%d  mutex=%-12v  cas=%-12v  add=%-12v\n",
            w, benchMutex(iters, w), benchCAS(iters, w), benchAtomicAdd(iters, w))
    }
}
```

On a typical x86 laptop, `atomic.Add` is fastest, the CAS loop is close behind, and the mutex is slower at high contention. Numbers vary, but the trend illustrates the trade-off: the strongest progress guarantee (wait-free) is often *also* the fastest for trivial operations like a counter.

### Example 5: Treiber stack — lock-free

```go
package main

import "sync/atomic"

type node[T any] struct {
    value T
    next  *node[T]
}

type Stack[T any] struct {
    head atomic.Pointer[node[T]]
}

func (s *Stack[T]) Push(v T) {
    n := &node[T]{value: v}
    for {
        top := s.head.Load()
        n.next = top
        if s.head.CompareAndSwap(top, n) {
            return
        }
    }
}

func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    for {
        top := s.head.Load()
        if top == nil {
            return zero, false
        }
        if s.head.CompareAndSwap(top, top.next) {
            return top.value, true
        }
    }
}
```

Lock-free. Push and Pop both use a CAS loop. Under high contention some goroutine's CAS keeps failing — that goroutine could in principle never make progress.

### Example 6: Single-step CAS — wait-free per call

```go
type Flag struct {
    set atomic.Bool
}

func (f *Flag) TrySet() bool {
    return f.set.CompareAndSwap(false, true)
}
```

A single `CompareAndSwap` call (no loop) is wait-free: it executes in one hardware instruction and returns true or false. The *meaning* — "did I set the flag?" — is well-defined whether the CAS succeeded or not. Wait-free does not require success; it requires bounded steps to a *result*.

### Example 7: Showing starvation in a tight CAS loop

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

func main() {
    var n atomic.Int64
    var stop atomic.Bool

    // Many "fast" goroutines that always succeed
    for i := 0; i < 8; i++ {
        go func() {
            for !stop.Load() {
                n.Add(1)
            }
        }()
    }

    // One "slow" goroutine doing a CAS loop with extra work between read and CAS
    var slowProgress atomic.Int64
    go func() {
        for !stop.Load() {
            for {
                old := n.Load()
                // Imagine some work here that the fast goroutines do not do
                for j := 0; j < 100; j++ {
                    _ = j
                }
                if n.CompareAndSwap(old, old+1) {
                    slowProgress.Add(1)
                    break
                }
            }
        }
    }()

    time.Sleep(2 * time.Second)
    stop.Store(true)
    time.Sleep(100 * time.Millisecond)
    fmt.Println("total counter:", n.Load())
    fmt.Println("slow progress:", slowProgress.Load())
    _ = sync.WaitGroup{}
}
```

The slow goroutine makes far fewer iterations than the fast ones, despite running for the same wall-clock time. That gap is the practical face of "lock-free permits starvation." In a real adversarial setting it can be much worse.

### Example 8: Channels as "blocking under the hood"

```go
ch := make(chan int)
go func() { ch <- 42 }()
v := <-ch // blocks until sender arrives
```

A channel is implemented with a mutex and a queue of waiting goroutines. Even though no `sync.Mutex` is visible in user code, the channel is internally blocking. Putting a channel send/receive in your critical path is the same — for progress-class purposes — as taking a mutex.

### Example 9: `sync.Once` is wait-free after the first call

```go
var once sync.Once
var resource *Thing

func get() *Thing {
    once.Do(func() {
        resource = expensiveInit()
    })
    return resource
}
```

The first call into `once.Do` is blocking (it serialises). All subsequent calls return after a single atomic load that sees "already done." Steady-state behaviour is effectively wait-free, even though `sync.Once` is implemented with a mutex internally.

### Example 10: Combining — wait-free fast path, mutex slow path

```go
type Map struct {
    fast atomic.Pointer[map[string]int]
    mu   sync.Mutex
    slow map[string]int
}

func (m *Map) Load(k string) (int, bool) {
    fp := m.fast.Load()
    if fp != nil {
        v, ok := (*fp)[k]
        if ok {
            return v, true // wait-free read
        }
    }
    m.mu.Lock()
    defer m.mu.Unlock()
    v, ok := m.slow[k]
    return v, ok
}
```

`sync.Map` follows this shape (with much more subtlety). The hot read path is wait-free; the cold path takes a lock. The aggregate guarantee is the *weakest* of the paths actually exercised — but the *common* case can be wait-free even when the worst case is blocking.

---

## Coding Patterns

### Pattern 1: Pick the weakest progress class that meets the requirement

You almost always want the simplest, fastest tool that does the job. If a mutex is fine, use a mutex. If a lock-free CAS loop is fine, use one. Only reach for wait-free when the *requirement* (real-time, fault tolerance) actually demands it.

### Pattern 2: Wait-free reads, lock-free or blocking writes

A common shape. The hot path (reads) is wait-free or lock-free; the cold path (writes) can afford a mutex. Examples: `sync.Map`, `atomic.Value` for config swaps, copy-on-write data structures.

### Pattern 3: Use `atomic.Add` and friends as wait-free primitives directly

`atomic.AddInt64`, `atomic.SwapInt64`, `atomic.LoadInt64`, `atomic.StoreInt64`, and a single `atomic.CompareAndSwapInt64` call are all wait-free per call. Reach for these by default before reaching for a CAS loop.

### Pattern 4: Recognise the loop, name the class

Any time you write `for { ... CompareAndSwap ... }`, you have just stepped from wait-free to lock-free. That is fine. But name it in a comment so the reviewer (and future you) does not confuse it.

```go
// Lock-free (not wait-free): retries on contention.
for {
    old := slot.Load()
    next := transform(old)
    if slot.CompareAndSwap(old, next) {
        break
    }
}
```

### Pattern 5: Bound the retry count if you need a hard cap

If you have a real-time constraint, a pure CAS loop is not acceptable. One mitigation: bound the retry count.

```go
const maxRetries = 16
for i := 0; i < maxRetries; i++ {
    old := slot.Load()
    next := transform(old)
    if slot.CompareAndSwap(old, next) {
        return nil
    }
}
return errContended
```

This is not wait-free in the formal sense — but it *is* bounded, and you can shed load if the bound is exceeded. A common compromise in trading systems.

---

## Clean Code

- **Name the progress class.** When you write a concurrent type, put one line at the top: "Wait-free reads, lock-free writes," or "Blocking throughout." Future readers should not have to derive the guarantee.
- **Match guarantee to interface.** If the docs say "wait-free," every operation in the interface must be wait-free. Mixed guarantees confuse callers.
- **Do not pretend a CAS loop is wait-free.** Reviewers will catch it, and you will lose credibility.
- **Reach for `atomic.Add` before CAS loops.** If the operation is `Add`, `Swap`, `Load`, or `Store`, use the dedicated function. CAS loops are for cases that genuinely require read-modify-write logic.
- **When in doubt, use a mutex.** It is the simplest, safest, and almost always fast enough. Optimise only when profiling demands it.

---

## Product Use / Feature

| Product feature | Progress class that fits |
|---|---|
| Per-endpoint request counter | Wait-free (`atomic.Add`) — trivially the right choice. |
| Cache hit/miss metrics | Wait-free per counter. |
| Configuration hot reload | Lock-free read (`atomic.Pointer` swap), mutex-protected reload. |
| Worker pool job queue | Lock-free MPMC queue or channel; blocking is fine if throughput meets target. |
| Real-time game tick loop | Wait-free per tick; allocate everything up front, no mutex in hot path. |
| Audio sample buffer | Wait-free; missing a deadline is an audible glitch. |
| Distributed-system leader election token | Blocking is fine — the operation is infrequent and correctness dominates. |
| GC root counter (in a runtime) | Wait-free — must not stall the world. |

---

## Error Handling

Progress guarantees are about *progress*, not correctness. An operation can fail in the application sense (e.g., `Pop` on an empty stack returns `false`) and still satisfy a wait-free guarantee — because "returns false" is a result, and wait-free promises only that a result is reached in bounded steps.

This subtlety matters when you read papers. A wait-free `Push(v)` may have to be defined as "return success or fail," because under heavy load the algorithm may report `full` rather than block. The guarantee is "you get an answer in bounded steps," not "your value is always inserted."

For Go programs:

- Always return errors / booleans from non-blocking operations so the caller knows the outcome.
- Do not use `panic` to signal contention — bound your retries or return a typed error.
- If you guarantee wait-free, document the conditions under which the operation can return `false` / error.

---

## Security Considerations

- **Denial-of-service via starvation.** A lock-free data structure exposed to untrusted callers can be starved by an adversary who keeps issuing operations on the same hot slot. Mitigation: add backoff, bound retries, fall back to a mutex under high contention, or use a wait-free structure if the threat model demands it.
- **Timing side channels.** Operations whose duration depends on contention pattern leak information. If you process secret material in a lock-free CAS loop, the retry count is observable to a coresident attacker. A wait-free implementation with a fixed-step bound is more side-channel resistant — though still not constant-time without further care.
- **Resource exhaustion in helping schemes.** Wait-free algorithms that allocate "operation descriptors" per call can be DoS'd by issuing many operations from threads that never finish, forcing helpers to allocate without bound. Pool descriptors carefully.

---

## Performance Tips

- For single-counter "add 1" workloads, `atomic.Add` (wait-free) is almost always the fastest *and* the strongest guarantee. There is no trade-off to make.
- For multi-word read-modify-write logic, CAS loops (lock-free) are typically fastest under low to moderate contention. They degrade as contention grows.
- Mutexes are fastest under *low* contention (uncontended `Lock`/`Unlock` is two atomic ops) but worse than CAS under moderate contention.
- Wait-free algorithms built from CAS often pay a 2x-10x steady-state cost compared to lock-free versions. Use them when you need the guarantee, not for speed.
- Cache-line bouncing is the dominant cost for any contended atomic. Pad hot variables to 64 bytes if multiple cores hit them.
- Sharding (per-CPU counters) often beats *both* lock-free and wait-free single-counter designs. The right tool is sometimes "more memory, less contention."

---

## Best Practices

- Default to the simplest tool. Mutex first; reach for lock-free / wait-free only when you can articulate why.
- Use single atomic operations directly. CAS loops are a step down in guarantee — make it deliberate.
- Document the progress class on every concurrent type.
- Bound your retry loops if hard latency matters. An unbounded loop is fine in throughput-optimised code, deadly in latency-sensitive code.
- Measure before declaring victory. Lock-free is not automatically faster.
- Test under contention, not just correctness. A test with one goroutine cannot distinguish blocking, lock-free, and wait-free.

---

## Edge Cases & Pitfalls

- **Empty contention.** With one goroutine, every algorithm looks wait-free — there is nothing to contend. Single-thread benchmarks lie.
- **GC pauses.** A GC pause that suspends all goroutines is technically the kind of "scheduler interference" lock-free is supposed to survive. But Go's GC is short and global; for *user-observable* progress, the GC pause stops everyone equally.
- **`runtime.Gosched()` inside a CAS loop.** Yielding can reduce wasted retries but breaks the wait-free property if anyone thought you had it. Comment intent clearly.
- **Mixed-class data structures.** A type whose read is wait-free and whose write is mutex-blocked has *both* properties — readers are wait-free, writers are blocking. Do not call the whole thing "wait-free."
- **Wait-free at the boundary, blocking inside.** Functions like `sync.Once.Do` look wait-free in steady state but have a blocking inner step. Be precise about which call you mean.
- **Real-time on a non-realtime OS.** Even a formally wait-free algorithm cannot give hard-real-time on a stock Linux kernel — the OS can preempt your thread arbitrarily. Wait-free is a *correctness* tool, not a *latency* tool, in the absence of an RT kernel.

---

## Common Mistakes

1. **Calling a CAS loop "wait-free."** This is the single most common mistake. A `for { ... CompareAndSwap ... }` loop is lock-free, not wait-free. A single `CompareAndSwap` is wait-free.
2. **Treating "lock-free" and "wait-free" as the same word.** They are different guarantees with different costs. Mixing them up in interviews and design docs signals imprecision.
3. **Reaching for wait-free when lock-free suffices.** Wait-free is harder to write and usually slower. Use it only when the requirement demands it.
4. **Forgetting that mutexes are blocking.** "I'm using `atomic.Pointer` everywhere, so I'm lock-free" — except for the one `sync.Mutex` you forgot, which makes the whole interface blocking.
5. **Assuming "lock-free implies fast."** Lock-free is a *robustness* guarantee, not a *speed* guarantee. Often it is slower than a mutex.
6. **Ignoring memory reclamation.** Wait-free and lock-free both have to free unlinked memory. In Go the GC saves you; in C/C++ you need hazard pointers or epochs.
7. **Calling channels "non-blocking."** A channel send to a full unbuffered channel blocks. Channels are blocking primitives.

---

## Common Misconceptions

- **"Lock-free is always faster than mutex."** Often false. Under low contention, mutex is fastest. Under high contention, lock-free is often fastest. Under *extreme* contention, sharding beats both.
- **"Wait-free is the goal; lock-free is just an approximation."** No. They are different guarantees for different requirements. A counter incremented by hundreds of cores is best served by `atomic.Add` (wait-free); a queue with realistic contention is usually best served by Michael-Scott (lock-free).
- **"`sync.Map` is lock-free."** Partially. The read path is mostly lock-free; writes can take a mutex. The aggregate is mixed.
- **"Channels are wait-free."** No. They are blocking primitives implemented with a mutex.
- **"GC pauses violate lock-free."** The progress definitions are about *application threads*, not external system events. A short GC pause is not what the lock-free / wait-free distinction is about.
- **"I can convert any algorithm to wait-free for free with the Universal Construction."** You can — but the construction is too slow to ship. Existence and practicality are different.

---

## Tricky Points

- **A "wait-free per call" operation can still be slow.** Wait-free means bounded steps, not *few* steps. A wait-free queue's `Enqueue` might cost `O(N)` in the number of threads — bounded, but not cheap.
- **Wait-free per call vs wait-free per *some sequence* of calls.** Some constructions are wait-free only when amortised. Read papers carefully.
- **Linearisability is orthogonal to progress.** A wait-free algorithm can be non-linearisable (rare), and a blocking algorithm can be linearisable (common). Do not conflate the two.
- **The bound depends on N.** Most wait-free bounds are `O(N)` or worse in the number of threads. As you scale up, wait-free becomes more expensive. Lock-free is often `O(1)` per operation, ignoring retries.
- **CAS *with bounded retries* is not wait-free in the formal sense.** Even if you cap at 16 retries, the formal wait-free definition requires no failure — bounded steps must lead to success. A "give up after 16 tries" loop returns *something*, which can be classified as wait-free with explicit failure modes, but be careful in formal contexts.
- **Single-threaded execution is always wait-free.** Single-threaded code is trivially wait-free because there is no contention. The progress hierarchy only constrains *multi-threaded* behaviour.

---

## Test

### Basic correctness check

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var n atomic.Int64
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            n.Add(1)
        }()
    }
    wg.Wait()
    if n.Load() != 1000 {
        panic(fmt.Sprintf("expected 1000, got %d", n.Load()))
    }
    fmt.Println("OK:", n.Load())
}
```

Wait-free `Add`. Correct result always, every run.

### Stress test for starvation

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

func main() {
    var counter atomic.Int64
    var perGoroutine [16]int64
    var stop atomic.Bool

    var wg sync.WaitGroup
    for i := 0; i < 16; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            for !stop.Load() {
                for {
                    old := counter.Load()
                    if counter.CompareAndSwap(old, old+1) {
                        perGoroutine[i]++
                        break
                    }
                }
            }
        }()
    }

    time.Sleep(time.Second)
    stop.Store(true)
    wg.Wait()
    for i, n := range perGoroutine {
        fmt.Printf("goroutine %d: %d ops\n", i, n)
    }
}
```

Run this and watch the per-goroutine counts. They should be roughly equal — Go's scheduler is fair under normal conditions. But the spread is non-zero, and the worst-case spread is unbounded in theory. That is what "lock-free permits starvation" means in practice.

---

## Tricky Questions

1. *Is `atomic.Add(1)` wait-free or lock-free?*
   Wait-free. One hardware instruction, no retry.
2. *Is a CAS loop wait-free or lock-free?*
   Lock-free. Retries are unbounded under contention.
3. *Is the Treiber stack wait-free?*
   No. It is lock-free. Push and Pop are CAS loops.
4. *What is the difference between "lock-free" and "wait-free"?*
   Lock-free guarantees the system as a whole makes progress. Wait-free guarantees every thread makes progress in bounded steps.
5. *Can a lock-free algorithm starve a single thread?*
   Yes. That is exactly the gap between lock-free and wait-free.
6. *Is `sync.Map` wait-free?*
   No. The read path is often wait-free in steady state, but writes can take a mutex. The whole type is mixed.
7. *Why bother with wait-free if lock-free is faster?*
   Hard real-time, fault tolerance, and safety-critical contexts require the bounded-per-thread guarantee. Average speed is irrelevant; worst case is everything.
8. *Is a mutex with a bounded waiter queue "wait-free"?*
   No. A mutex is blocking, regardless of the queue's structure, because progress depends on the holder being scheduled.
9. *What is the Universal Construction?*
   Herlihy's 1993 proof that any object can be made wait-free given CAS. The construction is too slow to ship, but it proves existence.
10. *Can wait-free algorithms have failure modes?*
    Yes. A wait-free queue's `Enqueue` can return "full" — still wait-free, because returning a result in bounded steps counts.
11. *In Go, when would you actually choose wait-free over lock-free?*
    When you need bounded per-operation latency: real-time systems, signal handlers, the runtime itself.
12. *What is the consensus number of CAS?*
    Infinity. CAS can solve consensus for any number of threads, which is why it suffices for the Universal Construction.
13. *What is the consensus number of read/write registers?*
    1. Plain reads and writes are insufficient for two-thread consensus.
14. *Is a channel send wait-free?*
    No. A channel is internally a mutex-protected queue, so sends and receives are blocking.

---

## Cheat Sheet

| Operation | Class |
|---|---|
| `atomic.LoadInt64` | Wait-free |
| `atomic.StoreInt64` | Wait-free |
| `atomic.AddInt64` | Wait-free |
| `atomic.SwapInt64` | Wait-free |
| `atomic.CompareAndSwapInt64` (single call) | Wait-free |
| CAS loop (`for { ... CAS ... }`) | Lock-free |
| Treiber stack push/pop | Lock-free |
| Michael-Scott queue enq/deq | Lock-free |
| `sync.Mutex.Lock` / `Unlock` | Blocking |
| `sync.RWMutex.RLock` / `Lock` | Blocking |
| Channel send / receive | Blocking |
| `sync.Once.Do` (after first call) | Wait-free in steady state |
| `sync.Pool.Get` (per-P fast path) | Lock-free; falls back to blocking |
| `sync.Map.Load` (hot key) | Wait-free in steady state |
| Kogan-Petrank queue | Wait-free |

**Rule of thumb:** Single atomic op = wait-free. Loop containing CAS = lock-free. Mutex / channel / cond var = blocking.

---

## Self-Assessment Checklist

- [ ] I can state the four definitions in one sentence each.
- [ ] I can place every common Go construct on the hierarchy.
- [ ] I know `atomic.Add` is wait-free and a CAS loop is lock-free.
- [ ] I can explain starvation and why lock-free permits it.
- [ ] I understand why wait-free is rare in production code.
- [ ] I can cite Herlihy 1991 and 1993 and explain what each paper showed.
- [ ] I can list two settings where wait-free is the right choice.
- [ ] I know what "consensus number" means.
- [ ] I can read `sync.Map`'s docs and identify which paths are wait-free, lock-free, or blocking.
- [ ] I can read a paper that claims "wait-free" and check whether the claim is justified.

If you tick all ten, move on to `middle.md`.

---

## Summary

Lock-free and wait-free are two distinct rungs on a four-level progress hierarchy proposed by Maurice Herlihy in 1991. Blocking algorithms (mutexes) depend on the scheduler; obstruction-free is weakest among non-blocking; lock-free guarantees system-wide progress but allows individual threads to starve; wait-free guarantees every thread completes each operation in bounded steps. Most Go code is mutex-based or lock-free. Wait-free is reserved for hard real-time, fault-tolerant, and safety-critical systems where bounded per-thread latency is mandatory. Single atomic operations (`atomic.Add`, single CAS) are wait-free; CAS loops are lock-free. Herlihy's 1993 Universal Construction proves any object can be made wait-free given CAS, but the construction is too slow to ship — it is a proof of possibility, not a tool.

---

## What You Can Build

- A wait-free per-endpoint request counter using `atomic.Int64.Add` for each metric.
- A lock-free atomic configuration swap using `atomic.Pointer[Config]` with a CAS loop.
- A side-by-side benchmark comparing mutex, CAS-loop, and `atomic.Add` counters under varying contention.
- A documented concurrent type with explicit progress guarantees per method.
- A test harness that detects starvation in a lock-free structure by tracking per-goroutine completion counts.

---

## Further Reading

- Maurice Herlihy, *Wait-Free Synchronization*, ACM TOPLAS 1991. The paper that defined the hierarchy.
- Maurice Herlihy, *A Methodology for Implementing Highly Concurrent Data Objects*, ACM TOPLAS 1993. The Universal Construction.
- Maurice Herlihy and Nir Shavit, *The Art of Multiprocessor Programming*, 2nd ed. Chapters 3 and 5 are the canonical pedagogical treatment.
- Alex Kogan and Erez Petrank, *Wait-Free Queues With Multiple Enqueuers and Dequeuers*, PPoPP 2011. The reference wait-free queue.
- The Go `sync/atomic` package documentation.
- Russ Cox, *Go Memory Model* (golang.org/ref/mem).
- The `01-cas-algorithms`, `02-aba-problem`, `03-lock-free-data-structures`, and `04-memory-fences` subsections in this folder.

---

## Related Topics

- `01-cas-algorithms` — the building block for both lock-free and wait-free designs.
- `02-aba-problem` — a subtle bug pattern that affects lock-free and wait-free alike.
- `03-lock-free-data-structures` — concrete data structures and their classification.
- `04-memory-fences` — what a lock-free or wait-free algorithm assumes about memory ordering.
- `07-concurrency/03-sync-package/07-atomic` — the `sync/atomic` primitives.
- `07-concurrency/04-mutex-and-rwmutex` — the blocking baseline.
- `07-concurrency/13-go-memory-model` — happens-before and visibility.

---

## Diagrams & Visual Aids

### The progress hierarchy

```
Strongest progress guarantee
        ^
        |  Wait-free      "every thread finishes in bounded steps"
        |  Lock-free      "some thread always makes progress"
        |  Obstruction-free  "an isolated thread makes progress"
        |  Blocking       "progress depends on the scheduler"
        v
Weakest progress guarantee
```

### Where Go constructs land

```
Wait-free
  atomic.Add, atomic.Load, atomic.Store, atomic.Swap, single CAS
  sync.Map (hot read)
  sync.Once.Do (after first call)
        |
Lock-free
  CAS loops
  Treiber stack
  Michael-Scott queue
  sync.Pool (per-P fast path)
        |
Blocking
  sync.Mutex, sync.RWMutex
  Channels
  sync.Cond
  sync.WaitGroup.Wait
```

### The "starvation gap"

```
Lock-free: at least one thread always finishes.
+-----------------------------+
|  T1 finishes  T2 finishes   |
|  T3 starves forever         |
+-----------------------------+
        ^
        |  System progress is guaranteed.
        |  Per-thread progress is not.

Wait-free: every thread finishes within bounded steps.
+-----------------------------+
|  T1 finishes <= B steps     |
|  T2 finishes <= B steps     |
|  T3 finishes <= B steps     |
+-----------------------------+
        ^
        |  Per-thread progress is guaranteed.
```

### The Herlihy hierarchy as a Venn-style containment

```
Blocking (any algorithm) ⊃
  Non-blocking ⊃
    Obstruction-free ⊃
      Lock-free ⊃
        Wait-free
```

Every wait-free algorithm is lock-free; every lock-free algorithm is obstruction-free; every obstruction-free algorithm is non-blocking; blocking algorithms are everything else.
