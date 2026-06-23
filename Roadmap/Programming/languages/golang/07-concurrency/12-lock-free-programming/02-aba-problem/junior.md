# The ABA Problem — Junior Level

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
> Focus: "What is the ABA problem? Why does my CAS succeed when the world changed under me?"

You have learned that `CompareAndSwap` is the foundation of lock-free programming. It atomically checks whether memory still holds an old value and, if so, replaces it with a new value. The contract sounds airtight: "If the CAS succeeds, nobody else touched this location while I was thinking." That contract is true in the most literal sense — the value at the memory address really is the same — but it is dangerously narrow. Other threads may have touched that address many times, leaving the value at `A` only by coincidence of timing or memory reuse. Your CAS does not know. It compares bits, not history.

This is the **ABA problem**: a thread reads value `A`, gets descheduled, and resumes later. While it was paused, another thread changed the value to `B` and then back to `A`. The first thread's CAS now sees `A` and assumes nothing happened. Sometimes that assumption is harmless. Often it is catastrophic, because the surrounding world — adjacent nodes in a list, slots in a buffer, counters tied to the same value — moved while the value stood still.

After reading this file you will:

- Know what the letters A, B, A stand for and the exact sequence of events that produces the bug
- Walk through the classic lock-free stack example step by step and see how `head.CompareAndSwap` fools itself
- Understand why C and C++ programs see ABA constantly but Go programs see it less often
- See where ABA can still strike in idiomatic Go: object pools, ring buffers, generation counters
- Recognise the four canonical mitigations by name: tagged pointers, double-word CAS, hazard pointers, epoch-based reclamation
- Have working Go code for a vulnerable stack and a corrected version that uses a generation counter

You do not need to implement hazard pointers from scratch, prove progress guarantees, or argue about memory ordering yet. Those tools appear at middle, senior, and professional levels. This file is about *seeing* ABA happen in code you can run, then understanding what each mitigation does to stop it.

---

## Prerequisites

- **Required:** Comfort with `sync/atomic.CompareAndSwap*` and `atomic.Pointer[T]`. Read `01-cas-algorithms/junior.md` first if these are not familiar.
- **Required:** Basic knowledge of pointers, structs, and linked lists in Go.
- **Required:** Understanding that the Go garbage collector keeps an object alive while any pointer to it exists. You do not need to know how the GC works internally.
- **Helpful:** Some exposure to C or C++, where `malloc` and `free` are explicit. ABA is easier to picture in a language with manual memory management.
- **Helpful:** Any prior experience with a lock-free stack or queue, even a buggy attempt. ABA is the bug you discover when your first lock-free stack starts losing nodes.

If you can write a CAS loop and explain what `atomic.Pointer[Node].CompareAndSwap(old, new)` returns, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **ABA problem** | A class of bug in CAS-based algorithms where a memory location is observed to hold the same value at two points in time, but the surrounding state has changed between those observations. The CAS succeeds when it should fail. |
| **CAS (Compare-and-Swap)** | An atomic instruction that writes a new value into memory only if memory currently holds the expected old value. Returns success or failure. |
| **CAS loop** | The standard lock-free template: read, compute, CAS; retry on failure. Vulnerable to ABA whenever value identity does not imply state identity. |
| **Lock-free stack** | A LIFO data structure that supports `Push` and `Pop` using CAS on the head pointer. The textbook ABA example. |
| **Tagged pointer** | A pointer with a few extra bits — usually low bits or stolen high bits — used as a generation counter that increments on each modification, breaking ABA. |
| **DCAS / DWCAS** | Double-CAS or double-word CAS: an atomic instruction that swaps two adjacent memory words at once. Used to bundle a pointer and a counter. Not exposed by Go's `sync/atomic`. |
| **Hazard pointer** | A per-thread published pointer that says "I am currently using this object; do not free it." A reclamation technique that prevents ABA by ensuring an in-use pointer cannot be recycled. |
| **Epoch-based reclamation** | A coarse-grained alternative to hazard pointers. Threads enter an "epoch" before accessing shared data and leave when done; freed objects are deferred until no thread is in the epoch when they were retired. RCU is a famous instance. |
| **Memory reclamation** | The general problem of safely freeing objects that may still be in use by concurrent readers. ABA is one symptom of getting reclamation wrong. |
| **Garbage collection (GC)** | The Go runtime's automatic memory reclamation. It prevents the most common ABA scenario — pointer reuse after free — but does not prevent all forms of ABA. |
| **Object pool / `sync.Pool`** | A user-managed cache of recycled objects. Bypasses the GC's protection and reintroduces ABA risk. |
| **Generation counter** | A monotonically increasing integer stored alongside a pointer or index, incremented on each modification. The standard tagged-pointer mitigation. |
| **`atomic.Pointer[T]`** | Go's typed atomic pointer (Go 1.19+). Stores a `*T` and supports `Load`, `Store`, `Swap`, `CompareAndSwap`. |

---

## Core Concepts

### What the letters mean

The name "ABA" describes a sequence of three observations of the same memory cell.

1. Thread T1 reads value `A` from memory.
2. T2 (or several threads) changes the value to `B`, possibly bounces through `C`, `D`, and so on, and eventually writes it back to `A`.
3. T1, resuming from its earlier read, attempts a `CompareAndSwap` from `A` to some new value `X`. The CAS sees `A` and succeeds.

T1's logic was built on the assumption "I read `A`, so if the cell still holds `A`, nothing has changed." That assumption is wrong. The cell holds `A` again, not still. Operations performed in between can have invalidated T1's plan.

ABA is not a bug in the CAS instruction. CAS does exactly what it promises: it compares the bits in memory to the bits you supplied and acts accordingly. ABA is a bug in *using* CAS as if it carried more information than it does.

### The classic lock-free stack — set up the structure

The textbook ABA example is a lock-free stack. We will write the simplest possible version in Go, run through a Push/Pop pair without any concurrency, then show how a concurrent pop-pop-push sequence breaks it.

```go
package abastack

import "sync/atomic"

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
        old := s.head.Load()
        n.next = old
        if s.head.CompareAndSwap(old, n) {
            return
        }
    }
}

func (s *Stack) Pop() (int, bool) {
    for {
        old := s.head.Load()
        if old == nil {
            return 0, false
        }
        next := old.next
        if s.head.CompareAndSwap(old, next) {
            return old.value, true
        }
    }
}
```

Two CAS loops. `Push` keeps trying until it links its node before whatever head is currently there. `Pop` keeps trying until it unlinks the current head. Both look right. With Go's GC behind them, this code is in fact correct — but only because of the GC. If we translated the same code to C with `malloc` and `free`, it would corrupt itself constantly. Understanding *why* requires walking through the scenario in detail.

### The classic ABA walkthrough — three nodes and two threads

Set up: the stack currently contains three nodes, with head pointing at A, then B, then C.

```
head --> A --> B --> C --> nil
```

Two threads, T1 and T2, both call `Pop`.

**Step 1.** T1 begins. It executes `old := s.head.Load()` and gets `A`. It executes `next := old.next` and gets `B`. T1 is now committed to: "if head is still A, set head to B."

**Step 2.** Before T1 can run the CAS, the operating system preempts it. T1 freezes with its local variables `old = A`, `next = B`.

**Step 3.** T2 runs to completion. T2 pops A: it sees head = A, computes next = B, CAS succeeds, head is now B. T2 has the integer that was inside A.

```
head --> B --> C --> nil       (A is detached)
```

In Go, A is still alive because T1's local `old` holds a pointer to it. The GC will not collect it. T2 keeps running.

**Step 4.** T2 pops B. CAS succeeds. Head is now C.

```
head --> C --> nil             (A and B are detached, but A is still GC-rooted via T1)
```

**Step 5.** T2 pushes a new node — and here is the trick we need for the ABA scenario. In Go we cannot simply "reuse the same pointer for A" because A has its own address. To stage the textbook ABA we need T2 to obtain a `*Node` with the *same pointer value* as A. There are two ways to engineer this in real systems:

- **Manual reuse (C-style).** In a language with `free`, T2 frees A and then `malloc` returns the same address for a fresh allocation. The new node has the same pointer value as the old.
- **Object pool.** In Go, if A came from `sync.Pool`, T2 can `Put` A back, then `Get` it again. The pool returns the exact same `*Node`. We have reproduced the C case inside Go.

Assume T2 returned A to a pool, then re-acquired A from the pool, set its value to 99 and its `next` to C, and pushed it. The stack now looks like:

```
head --> A (value=99, next=C) --> C --> nil
```

Critically, the pointer value of the head is once again A, the same bit pattern T1 originally read. But the meaning is completely different. A's `next` is no longer B — it is C. B is detached, gone from the structure.

**Step 6.** T1 resumes. It runs `s.head.CompareAndSwap(old, next)` where `old = A` and `next = B`. The CAS compares the current head (`A`) to its expected value (`A`). They match. The CAS succeeds and writes `B` to the head pointer.

```
head --> B --> ???             (B is detached from the structure; the link to C is lost)
```

The stack is now broken. The head points at B, which is not actually in the stack any more. C, the genuine current second element, is no longer reachable. T1's `Pop` returned `value` from A — but A had been re-pushed with `value = 99`, so T1 returned 99, not the original value, and called it a successful pop. In C this leak would be followed by use-after-free on B; in Go the GC keeps B alive but the data structure is corrupt and will continue to return wrong values.

That is the ABA problem in concrete form. CAS asked one question — "is the head still A?" — and got the right answer to the wrong question.

### Why CAS cannot detect this on its own

CAS detects a *single-word* change. It looks at one memory cell. ABA involves changes to *other* memory cells (other nodes, other slots in the pool, other counters). CAS has no way to know those exist.

To reject the ABA scenario, the CAS would need to compare more than the pointer bits. Either:

- **More bits in the compared word.** Pack a generation counter into the same word as the pointer so each modification flips it. Now `A.gen=5` and `A.gen=7` are different bit patterns even though the pointer is the same.
- **More than one word compared at once.** A double-word CAS (DWCAS / DCAS) atomically compares two adjacent words: pointer and a separate counter. Some CPUs support this directly.
- **Defer reuse until no thread can possibly hold the pointer.** Hazard pointers and epoch-based reclamation enforce this externally.

These are the four mitigations. We will introduce them at the conceptual level here and develop them further at the middle, senior, and professional levels.

### Mitigation 1: tagged pointer with a generation counter

Pack a small counter alongside the pointer. Every modification increments the counter. Two different generations of the same pointer compare unequal.

```go
type tagged struct {
    ptr *Node
    gen uint64
}
```

For this to work atomically, the whole `tagged` must be loaded and compared as one unit. On a 64-bit system a `*Node` is 8 bytes, and a `uint64` is another 8 bytes, so we need a 16-byte atomic operation — DWCAS — that Go does not expose. The workaround in Go is to use a wrapper struct stored under a single `atomic.Pointer[tagged]`. The CAS swaps the wrapper, not the fields. This works but allocates one wrapper per modification, costing GC pressure that pure tagged pointers in C would not. We will write code for this at the middle level.

### Mitigation 2: hazard pointers

Each thread publishes the pointers it is currently using to a globally readable slot. Before another thread frees or recycles a pointer, it scans the slots; if any thread is using the pointer, deletion is deferred. This guarantees that as long as T1 has loaded `A` into its local `top`, no other thread can recycle A's storage.

In Go, the GC effectively *is* a hazard-pointer mechanism, because a local variable referencing A keeps A alive. That is why the plain Go lock-free stack above does not actually exhibit ABA — A cannot be recycled while T1 holds a pointer to it. We will see exceptions (pools, indices) where Go's protection fails and explicit hazard pointers are needed at the senior level.

### Mitigation 3: epoch-based reclamation

Threads enter an epoch when they begin a critical section and leave when they finish. A retired object is freed only after no thread remains in the epoch that was current when it was retired. RCU (Read-Copy Update) in the Linux kernel is the canonical example. EBR is coarser than hazard pointers — it batches reclamation — but typically faster on read-heavy workloads.

### Mitigation 4: rely on the garbage collector

For most idiomatic Go code, this is enough. The GC behaves like an over-engineered hazard-pointer scheme: any pointer reachable from any goroutine is retained, period. That eliminates the C-style ABA where a pointer is freed and reallocated. The cost is that you give up control over when memory is reclaimed; in tight latency budgets, this can matter, and at the senior level we will see designs that work around the GC.

### Where Go does *not* save you

The GC protects pointer identity. It does not protect *value* identity. Three common Go situations where ABA can still occur:

1. **`sync.Pool` and custom free lists.** You explicitly recycle the same object, defeating the GC. The pool's reused pointer is a textbook ABA primer.
2. **Integer indices into an array or ring buffer.** An index is a `uint64`, not a pointer. There is no GC. If your CAS compares "head index is 7," another thread can move the index to 12 and back to 7, and your CAS will succeed on stale state.
3. **Counters and version numbers that wrap.** A 32-bit counter at `0xFFFFFFFF` plus one is `0`. A long-running thread that read `0` early and resumes after a wrap-around will CAS successfully on a completely different generation. (In practice, 64-bit counters do not wrap in any human lifetime; 32-bit ones can.)

The rest of this file shows real Go code that exhibits each of these.

### A second concrete example: ring buffer slot reuse

Imagine a single-producer ring buffer indexed by a `uint64` write index. The producer reserves a slot by CAS-incrementing the index:

```go
type Ring struct {
    buf  [16]int64
    head atomic.Uint64
}

func (r *Ring) Reserve() int {
    for {
        i := r.head.Load()
        next := (i + 1) % 16
        // BUGGY: CAS on a 4-bit truncated index — wrap-around triggers ABA
        if r.head.CompareAndSwap(i, next) {
            return int(i % 16)
        }
    }
}
```

If we had truncated `head` to 4 bits, after 16 reservations the index wraps back to 0. A slow consumer that saved `i = 3` and resumed long after the wrap-around would CAS against a head value of 3 and "succeed," even though 16 reservations had occurred in between. Using the full 64-bit `head` avoids this in practice — 2^64 increments at one per nanosecond would take 585 years — but the modulo-trick at the slot level still introduces subtle freshness bugs that bear strong family resemblance to ABA.

This example shows that ABA generalises: any time a CAS compares a quantity that can return to its earlier value, the algorithm must defend against the round trip.

---

## Real-World Analogies

### The parking spot

You park in spot 14 at the airport. You go to your gate and look back through the window: the spot looks empty. You panic, run back, and find an identical-looking car in spot 14. The spot label is the same. The bit pattern of "is spot 14 occupied?" matches "is spot 14 occupied?" But the car is not yours. CAS on the spot would say "still occupied, no change," and you would happily insert your suitcase into the wrong trunk.

### The library shelf

A library has a single hardcover copy of a book on a labelled shelf slot. You write down "the book is on shelf 4B." You leave. Another patron checks out the book, reads it, returns it. By coincidence the librarian re-shelves it in 4B. You return weeks later and look at 4B. The book is there. The slot label is unchanged. But the book has bookmarks, marginalia, a coffee stain on page 60 — the state has shifted. If your only check was "is something on shelf 4B," you missed everything.

### The relay race baton

In a relay race, runners hand off a baton. The baton looks identical at every exchange. Imagine a runner who reads "baton is in lane 3" then naps. While she sleeps, the baton passes through four runners and lands back in lane 3 with a different team. She wakes, sees the baton in lane 3, and concludes "nothing has happened, I am still in the lead." She has been overtaken twice.

### The hotel room key

Hotel rooms recycle keys when guests check out. The physical key is the same. The room number is the same. The pillows are the same. But the lock has been re-keyed and your old key (if you kept one) opens an entirely different room — or no room. The bit pattern of the key card you read matches; the world behind the lock does not.

---

## Mental Models

### CAS checks bits, not history

Memorise this single sentence. Every ABA bug reduces to forgetting it. CAS asks: "Are these bits the same?" It does not ask: "Has the world holding these bits been continuously undisturbed since I looked?" The two questions are different. The CAS instruction has no way to answer the second; you must answer it some other way — with a counter, with a hazard pointer, with the GC.

### The freshness gap

Picture the time interval between your `Load` and your `CompareAndSwap`. Anything can happen in that gap. Other threads can pop, push, free, reuse, reload your address with a new object. CAS protects you only if no possible thing that happened in the gap leaves the bit pattern matching your expectation. If even one possibility produces a "false-positive match," your algorithm has an ABA bug.

### The four locks on the door

The four mitigations correspond to four ways of closing the gap:

1. **Tagged pointer (counter):** turn the door's lock into a combination lock that changes after each use.
2. **Double-word CAS:** put a second lock on the door so both must match.
3. **Hazard pointer:** plant a guard on the door who refuses to let anyone replace the lock while you are inside.
4. **Epoch / GC:** prevent the door from being torn down and rebuilt while any visitor is still inside.

Pick the one whose cost profile matches your workload.

### Pointer identity vs value identity

In Go, two pointer values are equal if and only if they refer to the same allocated object — at least as long as the object lives. The GC is a guarantee that "if any goroutine holds a pointer to X, no other allocation can collide with X's address." That makes pointer identity stable. In C with `malloc` / `free` it is not stable, and that is the deepest reason ABA is rampant in C and rare in Go.

But value identity — the *bit pattern* of an integer or a counter — is independent of the GC. The GC cannot protect a `uint64`. Any algorithm that CAS-compares non-pointer values is fully exposed to ABA and must use one of the four mitigations.

---

## Pros & Cons

ABA itself is a bug, not a feature, so the pros/cons question is really: what are the trade-offs of each mitigation?

| Mitigation | Pros | Cons |
|------------|------|------|
| **Generation counter (wrapper allocation)** | Simple in Go; works with any algorithm | Allocates on every modification → GC pressure |
| **DCAS / DWCAS** | Zero-allocation tagged pointers | Not exposed by Go's `sync/atomic`; requires assembly or `unsafe` tricks |
| **Hazard pointers** | Bounded memory, wait-free reads | Implementation is involved; ~10% throughput cost compared to GC |
| **Epoch-based reclamation** | Cheap reads, batched reclamation | Reclamation can lag arbitrarily under contention |
| **Rely on Go's GC** | Free; idiomatic; covers most cases | Gives up control over reclamation timing; STW pauses |
| **Use a mutex** | Trivially correct; no ABA | Throws away lock-freedom |

---

## Use Cases

You care about ABA whenever you write CAS-based code that could plausibly observe a value, see it again, and conclude it is unchanged. In practice:

- **Lock-free stacks and queues.** The textbook case.
- **Lock-free hash maps and bucket arrays.** Hash bucket reuse and resize operations are ABA hot spots.
- **Object pools with CAS-protected free lists.** `sync.Pool`-style structures need explicit ABA protection or hazard pointers.
- **Ring buffers and lock-free queues with monotonic indices.** Wrap-around is the ABA trigger.
- **Reference counting in concurrent code.** `decRef` operations can race with revivals.
- **Versioned configuration stores.** A config can be set to version 5, mutated, and set back to 5; consumers using CAS on the version see ABA.

In Go, the GC quietly hides most ABA at the pointer level, which is why everyday channel-and-mutex Go code never thinks about it. The moment you reach for `sync/atomic.Pointer`, custom pools, or atomic integer indices, ABA becomes your job.

---

## Code Examples

### Vulnerable lock-free stack with a `sync.Pool`

This Go program reproduces a textbook ABA scenario by routing all allocations through `sync.Pool`. Run it under `-race` and with high concurrency to see corrupted output.

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

var nodePool = sync.Pool{
    New: func() any { return &Node{} },
}

type Stack struct {
    head atomic.Pointer[Node]
}

func (s *Stack) Push(v int) {
    n := nodePool.Get().(*Node)
    n.value = v
    for {
        old := s.head.Load()
        n.next = old
        if s.head.CompareAndSwap(old, n) {
            return
        }
    }
}

// Pop returns the popped node to the pool — this is what creates ABA risk.
func (s *Stack) Pop() (int, bool) {
    for {
        old := s.head.Load()
        if old == nil {
            return 0, false
        }
        next := old.next
        if s.head.CompareAndSwap(old, next) {
            v := old.value
            old.next = nil
            nodePool.Put(old) // <-- gives ABA a foothold
            return v, true
        }
    }
}

func main() {
    s := &Stack{}
    for i := 0; i < 10; i++ {
        s.Push(i)
    }
    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 1000; j++ {
                if v, ok := s.Pop(); ok {
                    s.Push(v)
                }
            }
        }()
    }
    wg.Wait()
    fmt.Println("Done — count any way you like; stack may be corrupt")
}
```

Whether you observe a hang, a crash, or silent corruption depends on scheduling. The bug is real even when the program appears to run.

### Tagged-pointer mitigation in Go

The simplest Go-idiomatic mitigation is to store a wrapper struct holding both the head pointer and a generation counter, then swap wrappers atomically. Each modification allocates one wrapper, so the GC tracks it for us.

```go
package main

import "sync/atomic"

type Node struct {
    value int
    next  *Node
}

type tagged struct {
    head *Node
    gen  uint64
}

type Stack struct {
    state atomic.Pointer[tagged]
}

func (s *Stack) init() {
    s.state.Store(&tagged{})
}

func (s *Stack) Push(v int) {
    n := &Node{value: v}
    for {
        old := s.state.Load()
        n.next = old.head
        next := &tagged{head: n, gen: old.gen + 1}
        if s.state.CompareAndSwap(old, next) {
            return
        }
    }
}

func (s *Stack) Pop() (int, bool) {
    for {
        old := s.state.Load()
        if old.head == nil {
            return 0, false
        }
        next := &tagged{head: old.head.next, gen: old.gen + 1}
        if s.state.CompareAndSwap(old, next) {
            return old.head.value, true
        }
    }
}
```

Now even if two `tagged` snapshots have the same `head`, their `gen` differs, so the CAS on `*tagged` fails. ABA is eliminated at the cost of an allocation per operation. We will benchmark this at the `optimize.md` level.

### Demonstrating that plain pointers in Go are *not* ABA-vulnerable

If we remove the pool and let the GC do its job, the original buggy-looking code is actually safe — because the GC will not recycle a pointer while another goroutine holds it.

```go
package main

import "sync/atomic"

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
        old := s.head.Load()
        n.next = old
        if s.head.CompareAndSwap(old, n) {
            return
        }
    }
}

func (s *Stack) Pop() (int, bool) {
    for {
        old := s.head.Load()
        if old == nil {
            return 0, false
        }
        next := old.next
        if s.head.CompareAndSwap(old, next) {
            return old.value, true
        }
    }
}
```

This program does not exhibit ABA, full stop. The reason is subtle but worth internalising: T1's local variable `old` is a live reference to A, so A cannot be garbage-collected. There is no way for a new allocation to land at A's address. T2 might push a *different* node, but it cannot produce another pointer with the bit pattern of A. The CAS's bit comparison is therefore equivalent to a state comparison.

### Integer-indexed ABA

A `uint64` is not a pointer; the GC cannot protect it. The following snippet shows the ABA shape at the value level.

```go
package main

import "sync/atomic"

type Slot struct {
    epoch atomic.Uint64
}

// publish writes v to the slot and bumps the epoch. If two writers issue the
// same v, they leave the same bit pattern but the epoch changes — without an
// epoch check, a reader using only v cannot tell the difference.
func (s *Slot) publish(v uint64) {
    s.epoch.Store(v)
}
```

A reader who CAS-checks "is the slot still 7?" cannot distinguish "unchanged" from "wrote 9 then wrote 7 again." A separate epoch counter is mandatory to detect the round trip.

---

## Coding Patterns

### Always pair a value with its generation

When you must CAS on something that can reasonably return to an earlier value, attach a counter. Either pack the counter into the same word (if the value is small enough), or store both in a wrapper struct and CAS the wrapper. Increment the counter on every modification, regardless of whether the value changed.

### Drain through a goroutine, not a pool

If the only reason you reach for `sync.Pool` is to reduce allocations in a hot lock-free path, consider whether a simpler design — pass items through a buffered channel, or accumulate in a per-CPU slice — would beat the pool while avoiding ABA. Often it does.

### Treat indices as pointers' poor cousins

Whenever you write `atomic.Uint64` and call it an "index," ask the ABA question: can this index return to an earlier value while the surrounding state has changed? If yes, either widen to 64 bits (so wrap-around is impossible in practice) and pair with an epoch, or rethink the design.

### Document the mitigation in code

When you do ship a tagged-pointer or hazard-pointer design, leave a comment that names the mitigation and the threat. The next person to touch this code will read the comment, recognise the term, and not silently undo the protection by "simplifying" it.

```go
// state holds the head pointer plus a generation counter (ABA mitigation).
// Increment gen on EVERY modification, even if head stays nil.
state atomic.Pointer[tagged]
```

---

## Clean Code

- Name structs that hold a `(pointer, generation)` pair clearly: `tagged`, `versioned`, `stamp`. Avoid the temptation to inline the counter as a magic offset in a `uintptr`.
- Keep the generation type wide. `uint64` is always safe; `uint32` is risky under sustained high churn.
- Encapsulate the CAS loop in a method, not at the call site. Callers should call `Push` and `Pop`, not assemble CAS sequences themselves.
- Write race-detector tests for every lock-free structure, even if you "know" it is correct. The race detector catches more ABA-adjacent bugs than reasoning does.
- Comment any deliberate departure from naive code. "Why is there a counter here?" should be answered in the file, not in the commit history.

---

## Product Use / Feature

In a production service, ABA-mitigated lock-free structures show up in:

- **In-memory analytics rollups.** A counter table that supports concurrent increments and resets without locks.
- **High-frequency telemetry sinks.** Per-CPU ring buffers consumed by a single drain goroutine — the wrap-around case.
- **Connection pools.** A lock-free free list of idle connections; reuse without ABA protection silently hands the same connection to two goroutines.
- **Task scheduler queues.** Work-stealing deques rely on ABA-protected CAS loops.

For a junior engineer the immediate "product" use is: if you are reaching for `sync/atomic.Pointer` to "make it faster than a mutex," and you have anything that recycles objects, you must address ABA. Otherwise stick to the mutex.

---

## Error Handling

ABA bugs do not raise errors. They corrupt the data structure silently and cause crashes, hangs, or wrong answers far away from the original site. Defensive coding:

- Assert structural invariants periodically. For a stack, "node not in the stack twice"; for a queue, "head and tail never equal except when empty"; for a ring buffer, "write index minus read index never exceeds capacity." Cheap, run under `go test -race` and `-tags debug`.
- Track operation counts. If `Push` increments a counter and `Pop` decrements, and the counter does not match the visible length, an ABA-class bug has occurred.
- Use `runtime.SetFinalizer` only as a last resort, but it can detect double-frees in `sync.Pool` reuse scenarios.

---

## Security Considerations

ABA bugs are exploitable when an attacker can influence the timing or the bit patterns. In kernel code and security-sensitive userland code, ABA-induced use-after-free has been turned into remote code execution multiple times. Two general defences:

- Never expose lock-free structures across trust boundaries without explicit ABA mitigation.
- In Go, even though the GC blocks the classic exploit path, an ABA-corrupt data structure can leak information by returning the wrong item to the wrong goroutine. If you use a lock-free queue to route encrypted payloads, a misrouted dequeue may leak the contents to the wrong consumer.

---

## Performance Tips

- The cheapest mitigation is the GC. If you can pay the GC tax, do.
- The second cheapest in Go is the wrapper-allocation tagged pointer. One allocation per modification is acceptable for most workloads.
- Hazard pointers are typically 10–20% slower than the equivalent GC-relying design but offer bounded memory; pick them only when you control reclamation explicitly.
- Epoch-based reclamation is fast under low contention and can stall under sustained contention because retired objects pile up. Profile before deploying.
- For data structures with extreme throughput requirements, consider whether the lock-free approach is necessary at all; sharded mutexes or per-goroutine local state often outperform any lock-free design while sidestepping ABA.

---

## Best Practices

- Identify every CAS in your code and ask the ABA question explicitly.
- Prefer pointer CAS over integer CAS when the GC's protection is acceptable.
- Use `sync.Pool` defensively — never with CAS-protected linked structures.
- Treat `atomic.Uint64` wrap-around as a real threat in long-running services.
- Document mitigations near the CAS. Comments save lives in lock-free code.
- Test under `-race` and under stress with `GOMAXPROCS` set to several values.

---

## Edge Cases & Pitfalls

- **Re-allocated pointer from `sync.Pool`.** The most common Go ABA. Always be explicit.
- **The same struct mutated in place.** Even without ABA on the pointer, if you mutate `node.next` while another goroutine traverses the list, you have a different bug — but the symptoms can look ABA-like.
- **Generation overflow.** A `uint32` generation wrapping in seconds under heavy load reopens the ABA hole. Always `uint64` unless you have a hard reason.
- **`runtime.GC` during a CAS loop.** The GC may move some bits around but does not move pointer values. You do not need to worry about pointers shifting underneath your CAS in Go.
- **Pinned addresses for cgo.** If you have a pointer pinned by cgo and another goroutine recycles it via your own free list, ABA can return.

---

## Common Mistakes

- **Believing "the GC fixes everything."** It fixes pointer ABA, not value ABA. Counters and indices are still exposed.
- **Adding a counter but forgetting to increment it on no-op modifications.** If a `Pop` of an empty stack does not bump the counter, two consecutive pops at different times produce indistinguishable wrapper values. Increment on every successful CAS.
- **Storing the counter in a separate atomic.** Updating two atomics non-atomically reintroduces a race. Either pack them or wrap them together.
- **Using `unsafe.Pointer` to fake DWCAS.** Without an assembly intrinsic, this is not atomic; it just appears to work for a while.
- **Pop returns the value, then `Put`s the node to the pool, but a concurrent reader still has the old node's `value`.** Subtle: between the CAS and the `Put`, the value is fine; after the `Put`, it can be mutated by the next `Get`. Order matters.

---

## Common Misconceptions

- **"Go has no ABA because of channels."** Channels do not eliminate ABA in any direct way; they help by encouraging non-shared state. The moment you reach for `atomic`, ABA is on the table.
- **"DCAS is available on all CPUs."** It is not. x86-64 supports `CMPXCHG16B`; ARMv8.1 supports it; some chips do not. Go does not expose it portably.
- **"Tagged pointers with low bits are free."** Stealing alignment bits is fine for the alignment, but on architectures with strict alignment you must mask before dereferencing. Get it wrong once and you crash.
- **"Hazard pointers are obsolete because we have GC."** They are very much in use in C++ and Rust. In Go, they appear in custom runtime-adjacent code (`runtime/mcache`, etc.).

---

## Tricky Points

- **A successful CAS does not prove your read was current — only that it became current at the moment of the CAS.** If your computation depended on a no-longer-valid invariant of the surrounding state, the CAS is still wrong.
- **Loading the head pointer once is not enough.** In a CAS loop, every iteration must re-load.
- **The tagged-pointer wrapper must be immutable.** Never mutate `tagged.head` after publishing. The CAS protects pointer identity of the wrapper, not the wrapper's interior.
- **Wrap-around safety is per-counter, not per-design.** Even with a 64-bit generation, ensure the counter is in *every* place that consumers compare; missing one is the same as not having it.
- **Visibility vs atomicity.** ABA is an atomicity bug, but visibility bugs can mimic ABA symptoms; under Go's sequentially consistent atomics they generally do not, but in C++ they certainly can.

---

## Test

Write a stress test that reliably exhibits ABA in a buggy design and is silent on a corrected one. Sketch:

```go
package abastack

import (
    "sync"
    "sync/atomic"
    "testing"
)

func TestStackUnderChurn(t *testing.T) {
    s := &PooledStack{}
    const writers = 8
    const ops = 100000
    for i := 0; i < 100; i++ {
        s.Push(i)
    }
    var wg sync.WaitGroup
    var corruption atomic.Int64
    for i := 0; i < writers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < ops; j++ {
                if v, ok := s.Pop(); ok {
                    if v < 0 || v >= 1<<20 {
                        corruption.Add(1)
                    }
                    s.Push(v)
                }
            }
        }()
    }
    wg.Wait()
    if corruption.Load() > 0 {
        t.Fatalf("observed %d corrupt values", corruption.Load())
    }
}
```

The corrupt-value check is a stand-in for the deeper property "the stack contains the items it should." For a thorough test, drain the stack at the end and compare to the expected multiset.

---

## Tricky Questions

1. **Why does the Go GC prevent the classical ABA, even though it does not synchronize with `CompareAndSwap`?**
   Because a local variable is a GC root. While T1 holds `top *Node` in a register or on its stack, the GC marks the node reachable; no other allocation can land at the same address. CAS bit-compares pointer values, and a unique address per live object means equal pointers imply equal objects.

2. **Why doesn't a `uint64` counter benefit from the same protection?**
   The GC tracks references, not values. A `uint64` is not a reference. Two `uint64`s with the same bit pattern are indistinguishable to the runtime.

3. **If I store a `*Node` in `sync.Pool`, what changes?**
   You opt out of GC protection for the lifetime of the pool. The pool can hand the same `*Node` to many users, with mutations in between. CAS comparison no longer implies state equality.

4. **Can ABA happen on `atomic.Bool`?**
   In principle yes — a `true → false → true` round trip. In practice, single-bit ABA rarely matters because there is no associated state. But if your code reads `true` and then conditionally accesses a related shared structure, the round trip can hide the structure's mutation, which is the same logical bug.

5. **What if my stack does not free nodes — every popped node is kept alive forever?**
   Then ABA cannot occur: each push allocates a fresh pointer, and each pointer is used exactly once. You traded memory for safety. Many real systems do exactly this when memory is plentiful.

---

## Cheat Sheet

- ABA = "value back to original, but world has moved on."
- CAS compares bits, not history.
- Classic Go victims: `sync.Pool`, integer indices, generation counters that wrap.
- Classic Go safety: GC keeps pointers alive while any goroutine references them.
- Mitigations: tagged pointer, DCAS, hazard pointer, epoch reclamation.
- In Go, the GC ≈ hazard pointer for free.
- For non-pointer atomics, add a generation counter or design out the round trip.
- Always test under `-race` and stress.
- Document mitigations in code.

---

## Self-Assessment Checklist

- [ ] I can recite the ABA scenario in terms of two threads and a stack.
- [ ] I can explain why Go's GC protects pointer ABA but not value ABA.
- [ ] I can name the four canonical mitigations and at least one trade-off of each.
- [ ] I can write a tagged-pointer Go stack from scratch.
- [ ] I can identify ABA risk in `sync.Pool`-based code on sight.
- [ ] I can write a stress test that reliably exhibits ABA in a buggy design.
- [ ] I know that 32-bit counters wrap and 64-bit ones effectively do not.
- [ ] I can read a CAS loop and ask the ABA question for every `Load → CAS` pair.

---

## Summary

ABA is the cost of trusting bit equality for state equality. CAS will tell you whether the bits match. It cannot tell you whether the world they describe is still the world you knew. In C and C++, ABA strikes constantly because `free` plus `malloc` produces re-used pointer values. In Go, the garbage collector eliminates this scenario for ordinary pointers, which is why so much Go concurrency code never encounters ABA. The moment you opt out of the GC — through `sync.Pool`, custom free lists, or integer-indexed schemes — the bug returns. The four mitigations to know by name are tagged pointers, double-word CAS, hazard pointers, and epoch-based reclamation. For most Go code, GC plus the occasional tagged-pointer wrapper is enough. For everything else, the deeper levels of this subsection will take you to the production-grade techniques.

---

## What You Can Build

- A small lock-free counter that is provably ABA-free, with the generation counter stored alongside.
- A simple LIFO stack in Go that uses a tagged wrapper and that you can stress-test under contention.
- A demonstration program that reliably reproduces ABA when nodes are recycled through `sync.Pool`, and that becomes silent the moment you switch to fresh allocations.
- A small benchmark comparing the throughput of (a) plain GC-based stack, (b) tagged-pointer stack, and (c) `sync.Mutex` stack, illustrating that lock-free is not automatically faster.

---

## Further Reading

- Maurice Herlihy and Nir Shavit, *The Art of Multiprocessor Programming*, chapter on memory reclamation.
- Maged M. Michael, "Hazard Pointers: Safe Memory Reclamation for Lock-Free Objects," IEEE TPDS, 2004.
- Keir Fraser's PhD thesis, *Practical Lock-Freedom*, on epoch-based reclamation.
- The Go memory model document: <https://go.dev/ref/mem>.
- The `sync/atomic` package documentation: <https://pkg.go.dev/sync/atomic>.
- "Lock-Free Programming Techniques" series by Jeff Preshing.

---

## Related Topics

- [01-cas-algorithms](../01-cas-algorithms/) — The CAS primitive ABA exploits.
- [03-lock-free-data-structures](../03-lock-free-data-structures/) — Where ABA mitigations shape design.
- [04-memory-fences](../04-memory-fences/) — Memory ordering and its interaction with reclamation.
- [05-lock-free-vs-wait-free](../05-lock-free-vs-wait-free/) — Progress guarantees and the cost of safety.
- `../../03-sync-package/07-atomic/senior.md` — Senior atomic patterns including ABA.

---

## Diagrams & Visual Aids

### The ABA timeline

```
Time --------------------------------------------------->

T1: Load head = A ......................... CAS(A -> B) success!
                  |
                  | (T1 paused here)
                  v
T2:               Pop A | Pop B | Push A (reused) |
                  head=B  head=C  head=A again
                                       ^
                                       T1 sees A and is fooled
```

### The four mitigations at a glance

```
+----------------------------+--------------------------+
| Mitigation                 | Where it adds bits       |
+----------------------------+--------------------------+
| Tagged pointer             | inside the CAS-ed word   |
| DCAS / DWCAS               | adjacent word, atomic    |
| Hazard pointer             | external published table |
| Epoch / RCU / GC           | external retire schedule |
+----------------------------+--------------------------+
```

### Pointer identity vs value identity (Go)

```
+-------------------+--------------------+-----------------------+
| Quantity          | GC protects?       | ABA-prone in Go?      |
+-------------------+--------------------+-----------------------+
| *T (heap pointer) | yes (while alive)  | no, unless pooled     |
| pool-handed *T    | no                 | yes                   |
| uint64 index      | no                 | yes (especially wrap) |
| interface{} value | yes (via *T inside)| same as *T            |
+-------------------+--------------------+-----------------------+
```

### A successful CAS does not mean what you think

```
Bits at address X:  A           A           A
                    ^                       ^
                    Load (T1)               CAS (T1) — succeeds

In between:         A -> B -> C -> A
                          (other threads churn)

State implied by bits "A":   has shifted, but CAS cannot see it.
```
