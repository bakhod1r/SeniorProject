# Runtime ↔ GC Integration — Junior Level

> **Topic:** [Runtime ↔ GC Integration](README.md)
> **Focus:** The garbage collector cannot work alone. It needs the runtime and the compiler to tell it where the pointers are and when it is safe to look. This page is about that hand-shake — not about how GC algorithms collect garbage.

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
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What does the garbage collector need from the rest of the system in order to do its job at all?**

When you write `new Object()` in Java, `make([]int, n)` in Go, or `{}` in JavaScript, the memory you get back is *managed*: at some later moment, a **garbage collector (GC)** will scan the heap, decide your object is no longer reachable, and reclaim its memory. People usually study GC by learning *how* it decides what is garbage — mark-and-sweep, generational collection, reference counting. That is a different topic (it lives in the memory-management section, and we only mention it in passing here).

This page is about the part nobody draws on the whiteboard: **the GC is not a standalone library that can magically inspect your program.** It is one half of a tightly coupled partnership with the **language runtime** and the **compiler**. The collector can only do its job because the compiler and runtime hand it three things:

1. **A map of where the pointers are.** When the GC pauses your program, your live objects are referenced by pointers sitting in CPU registers and on thread stacks. The GC has no idea which of those bit patterns are pointers and which are just integers — unless the compiler tells it. The compiler emits **stack maps** (also called **oop maps** in the JVM world) that say, for each point in the code, "stack slot 3 and register `rbx` hold object pointers right now."

2. **A safe moment to look.** The GC cannot scan a thread's stack while that thread is in the middle of updating it. The runtime must bring every thread to a **safepoint** — a known, well-defined spot in the code — before the GC may peek. Getting all threads there is its own engineering problem.

3. **Notifications when pointers change.** Many modern collectors run *concurrently* with your program. To keep up with a moving target, the compiler injects tiny snippets of code — **write barriers** and sometimes **read barriers** — around pointer operations, so the collector learns about pointer updates as they happen.

In one sentence: **the GC is a guest in your program's house, and the compiler and runtime are the hosts who must label every door, ring a bell when everyone is seated, and report whenever furniture is moved.** This page teaches that hosting contract.

> 🎓 **Why this matters for a junior:** You will eventually hit a production incident where "the GC paused for 300 ms" or "latency spikes every few minutes." The *cause* is almost never the GC algorithm itself — it is the integration: a thread that took too long to reach a safepoint, a barrier that cost too much in a hot loop, a giant loop with no place to pause. Understanding the *interface* is what lets you read a GC log and know which knob to turn.

This page covers: what a **root** is and why finding roots is hard; **precise vs conservative** scanning; what a **safepoint** is and the **time-to-safepoint** problem; what a **write barrier** does, at a beginner's level; and why a **moving** collector forces the compiler to be careful about raw pointers. The deeper mechanics (oop map formats, SATB vs incremental-update barriers, colored pointers) are in `middle.md`, `senior.md`, and `professional.md`.

---

## Prerequisites

What you should know before reading this:

- **Required:** What a pointer/reference is — a value that holds the address of an object.
- **Required:** That programs run on threads, each with its own **call stack** and **CPU registers**.
- **Required:** A rough idea of what garbage collection is *for* (reclaiming unreachable memory). You do **not** need to know how any specific GC algorithm works.
- **Helpful:** A sense that source code is *compiled* (or JIT-compiled) into machine instructions, and that the compiler is free to keep values in registers.
- **Helpful:** The idea that the heap is shared between threads while the stack is per-thread.

You do **not** need to know:

- The internals of mark-sweep, generational, or concurrent GC algorithms — that is the memory-management topic.
- Cache coherence, memory ordering, or assembly. We stay conceptual here.
- Anything specific to one engine's source code.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Mutator** | The application code — *your* program. Called "mutator" because, from the GC's point of view, it mutates the heap (creates and rewires objects). |
| **Collector** | The garbage collector: the code that finds and reclaims dead objects. |
| **Runtime** | The support machinery shipped with the language (memory allocator, scheduler, GC, exception handling). The host the mutator and collector both live in. |
| **Root** | A pointer that lives *outside* the heap and refers *into* the heap: a local variable on a thread stack, a value in a CPU register, a global/static variable. Reachability starts from the roots. |
| **Root set** | The complete collection of roots at a given instant. The GC must find all of them to avoid freeing live objects. |
| **Reachable / live** | An object you can get to by following pointers starting from the roots. Everything else is garbage. |
| **Stack map / oop map** | Compiler-generated metadata that says, for a specific code location, which stack slots and registers currently hold object pointers. |
| **Precise (exact) scanning** | Using stack maps to know *exactly* which slots are pointers. |
| **Conservative scanning** | Treating *anything that looks like a pointer* as if it might be one, because no map is available. |
| **Safepoint** | A point in the program where a thread's state is fully described by the maps, so the GC may safely inspect or move things. |
| **Stop-the-world (STW)** | A GC phase during which all mutator threads are paused at safepoints. |
| **Time-to-safepoint (TTSP)** | How long it takes from "GC requests a pause" until *every* thread has actually reached a safepoint. A hidden source of latency. |
| **Write barrier** | A small piece of compiler-injected code that runs on every pointer store, so the collector learns the heap changed. |
| **Read barrier** | The same idea, but on pointer *loads* — used by some advanced collectors. |
| **Moving / compacting GC** | A collector that relocates live objects to new addresses (to defragment). Forces every pointer to the moved object to be updated. |
| **Allocation fast path** | The cheap, inlined code that hands you a fresh object when memory is plentiful — usually just bumping a pointer. |
| **TLAB** | Thread-Local Allocation Buffer: a private chunk of the heap a thread allocates from without locking. |

---

## Core Concepts

### 1. The GC's Problem: "Which Of These Bits Are Pointers?"

When the GC starts, it wants to find every live object. Live means reachable from a **root**. The roots live in three places: thread stacks, CPU registers, and globals. Here is the catch. Imagine a thread's stack at the moment of a pause:

```text
stack slot 0:  0x00007f3a9c001020   <- could be a pointer... or an integer
stack slot 1:  0x0000000000000005   <- the number 5? or address 0x5?
stack slot 2:  0x00007f3a9c0010a0   <- a pointer to an object? or random data?
```

The raw bytes give no hint. A 64-bit value that happens to fall inside the heap's address range *might* be a live pointer — or it might be a coincidence: a hash code, a loop counter, a packed timestamp. **The GC cannot tell on its own.** This is the central problem of root finding, and there are two ways to solve it.

### 2. Conservative vs Precise Scanning

**Conservative scanning** says: "If a value *looks* like it could be a pointer into the heap, treat it as one." It scans every word on the stack and in registers, and for each, asks "does this point at a valid object?" If yes, it keeps that object alive — just in case. This needs *no help* from the compiler, which is why it was used by early systems like the Boehm GC (a drop-in collector for C/C++) and early versions of V8.

The downsides of conservative scanning:

- **Floating garbage.** An integer that happens to look like a pointer pins a dead object in memory. The object never gets collected. This is rare per-object but real.
- **You cannot move objects.** If you are not *sure* a value is a pointer, you dare not overwrite it with the object's new address — you might corrupt an innocent integer. So conservative collectors generally cannot **compact**.

**Precise (exact) scanning** says: "I will know *exactly* which slots are pointers, because the compiler told me." The compiler emits **stack maps** (called **oop maps** in HotSpot, where "oop" = ordinary object pointer). At each point where a GC could happen, the map records which stack offsets and which registers hold live object references. Now the GC scans only those, with zero ambiguity.

The benefits: no floating garbage from false pointers, and — crucially — the GC *can* move objects, because it knows precisely which slots to update with the new address. Nearly all modern managed runtimes (JVM, Go, .NET, modern V8) are precise.

### 3. The Catch: Maps Are Only Valid At Certain Points

You cannot ask "where are the pointers?" at a *random* machine instruction. Between two instructions, a value might be half-loaded into a register, or a pointer might be temporarily held in a form the map doesn't describe. Building a correct stack map for *every single instruction* would be enormous and slow.

So the compiler only generates maps at a chosen set of locations called **safepoints** (or **GC-safe points**). A safepoint is a place where the thread's state is clean and fully described. The GC is only allowed to inspect a thread that is sitting *at* a safepoint. This is the second half of the contract: the runtime must get every thread *to* a safepoint before it scans.

### 4. Getting Everyone To A Safepoint

Threads do not stop instantly when the GC asks. The runtime needs a cooperative mechanism. The common one:

- The compiler sprinkles tiny **safepoint polls** into the generated code — typically at **loop back-edges** (the jump back to the top of a loop) and at **method entries and returns**. A poll is a cheap check: "has the runtime asked me to stop?"
- When the GC wants to collect, it flips a global flag (or, cleverly, makes a special memory page unreadable so the next poll traps). The next time each thread executes a poll, it notices, parks itself at that safepoint, and waits.

The total time from "GC raised the flag" to "the *last* thread finally reached a poll and stopped" is the **time-to-safepoint (TTSP)**. In a healthy program this is microseconds. But if one thread is stuck in a giant tight loop with no poll, or blocked in a long native call, everyone else waits for it — and your "GC pause" is actually mostly *TTSP*, not collection.

### 5. Stop-The-World vs Concurrent — What The Runtime Must Promise

A **stop-the-world (STW)** collector pauses all mutators at safepoints, does its work, and resumes them. Simple, but the pause is visible as latency.

A **concurrent** collector runs *alongside* the mutator to shrink pauses. But now there is a problem: while the collector is scanning, the mutator keeps changing pointers. An object the collector already marked "dead" might suddenly become referenced by a fresh pointer the mutator just wrote. If the collector misses that, it frees a live object — a catastrophic bug. To prevent it, the runtime needs the mutator to *report* its pointer writes. That is the job of the **write barrier**.

### 6. Write Barriers, Gently

A **write barrier** is a small piece of code the compiler inserts so that *every* pointer store does a tiny bit of extra bookkeeping. Conceptually:

```text
// what you wrote:
obj.field = other;

// what the compiler actually emits (simplified):
obj.field = other;
write_barrier(obj, other);   // tell the GC "obj now points at other"
```

Different collectors use the barrier for different reasons (generational collectors use it to track old→young pointers via "card marking"; concurrent collectors use it to track marking work). The exact flavors are `middle.md` material. The junior takeaway: **the convenience of GC has a hidden cost — a few extra instructions on every pointer write — and the compiler is the one paying it on your behalf.** In store-heavy code this cost is measurable, and good compilers work hard to *remove* barriers they can prove are unnecessary.

### 7. Moving Collectors And The Register Problem

If the collector **moves** an object to a new address (to defragment the heap), every pointer to that object must be updated to the new address. The compiler's stack maps make the *stack and register* pointers updatable. But there is a subtle rule: the compiler **cannot keep a raw pointer in a register across a safepoint** if the object might move during a GC at that safepoint, *unless* the safepoint's map lets the GC find and rewrite that register. If it kept a stale address that the GC didn't know about, after the move the program would dereference freed or relocated memory. This is why moving GC and the compiler are so tightly bound: the compiler must declare every live pointer at every safepoint so the GC can fix them all up.

### 8. Allocation Is Part Of The Contract Too

The collector reclaims memory; allocation hands it out. To make `new` fast, runtimes give each thread a private slab of heap called a **TLAB** (thread-local allocation buffer). Allocating is then just: bump a pointer forward by the object's size; if it fits, you're done — no locks, just a couple of instructions inlined right into your compiled code (the **allocation fast path**). Only when the TLAB is full does the thread take the **slow path** and ask the runtime for a fresh TLAB (which may trigger a GC). So the runtime and compiler co-design allocation and collection together.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Roots** | The front-door keys hanging on hooks by the entrance. Everything you can reach in the house starts from a key. |
| **Stack map / oop map** | A floor plan that marks which hooks hold real keys and which hold decorative fakes. |
| **Conservative scanning** | A cautious cleaner who refuses to throw away *anything* that might be valuable, just in case — so junk piles up. |
| **Precise scanning** | A cleaner with an exact inventory list — they know precisely what to keep and what to bin. |
| **Safepoint** | A designated "freeze!" line painted on the floor. People can only be inspected while standing on it. |
| **Safepoint poll** | A bell that rings periodically; whenever you hear it, you check whether you should freeze. |
| **Time-to-safepoint** | How long until the *slowest* person in the building finally hears the bell and freezes. One person with headphones holds up everyone. |
| **Write barrier** | A logbook by the door: every time you move a piece of furniture, you must jot it down so the inventory team stays accurate. |
| **Moving GC** | Re-arranging the furniture to free up floor space — but then you must update everyone's map so they still find their desk. |
| **TLAB** | Each worker gets a personal supply shelf, so they don't queue at the central storeroom for every paperclip. |

---

## Mental Models

### The "Label Every Door" Model

The GC is a fire marshal who must, during a drill, account for every person in the building. They cannot do it alone — they rely on the *building designer* (the compiler) to have labeled which doors lead to occupied rooms (which slots hold pointers) and to have painted *freeze lines* (safepoints) where people gather. When the alarm rings (GC requested), everyone walks to the nearest freeze line and stands still until counted. The marshal's job is easy *only because the building was designed to make it easy*. A badly designed building — one long corridor with no freeze line — leaves the marshal waiting forever. That corridor is your giant uninterruptible loop.

### The "Snapshot Must Be Coherent" Model

The GC needs a *coherent snapshot* of the pointer graph. You can't photograph a moving object cleanly. Safepoints are the camera's flash going off only when everyone holds still; write barriers are the way the photographer keeps notes on what moved while the shutter was open (for concurrent collectors). The whole integration exists to turn a constantly-changing program into something the collector can reason about as if it were frozen.

### The "Hidden Tax On Every Pointer Write" Model

Managed memory feels free, but it isn't. Every `x.field = y` may carry a small tax (the write barrier), and every loop iteration may carry a tiny tax (the safepoint poll). You never wrote those instructions — the compiler did, as part of the GC contract. When you profile a hot loop and see mysterious extra instructions, this is often what they are. Understanding the tax helps you write code that minimizes it.

---

## Code Examples

The integration is mostly invisible in source code — that's the point. But we can *see its effects*. These examples are about observing the contract, not implementing it.

### Showing the allocation fast path (Java)

```java
public class AllocBench {
    static class Point { int x, y; }

    public static void main(String[] args) {
        long total = 0;
        for (int i = 0; i < 100_000_000; i++) {
            Point p = new Point();   // <- bump-pointer fast path in the TLAB
            p.x = i;
            total += p.x;            // keep p "used" so it isn't optimized away
        }
        System.out.println(total);
    }
}
```

Most of these `new Point()` calls compile down to a *pointer bump* inside the thread's TLAB — no lock, no call into the runtime. Only occasionally (when the TLAB fills) does a slow path run, possibly triggering a GC. Run with `-Xlog:gc` (modern JVMs) and you'll see GC events; run with `-verbose:gc` on older ones. The point: allocation is cheap *because* the compiler inlined the fast path the runtime designed.

### Provoking a long time-to-safepoint (the shape of the bug)

```java
public class CountedLoop {
    public static void main(String[] args) {
        // A huge "counted loop" over an int range.
        long sum = 0;
        for (int i = 0; i < Integer.MAX_VALUE; i++) {
            sum += i;     // no allocation, no method call inside
        }
        System.out.println(sum);
    }
}
```

Historically, the JVM omitted safepoint polls inside tight *counted* loops like this (loops with a known integer bound) as an optimization. If a GC was requested while this loop ran, *every other thread* could be stuck waiting for this one to finish — a long TTSP. Modern JVMs added "loop strip mining" and other fixes, but the shape of the bug is permanent: **a long-running loop with no safepoint poll can hold the entire program hostage.** You don't see it in source; you see it as a multi-hundred-millisecond pause in a GC log where the actual collection was tiny.

### Watching write barriers exist (Go, conceptually)

```go
package main

type Node struct {
    next *Node
    val  int
}

func link(a, b *Node) {
    a.next = b   // <- the Go compiler may emit a write barrier here
}

func main() {
    a := &Node{val: 1}
    b := &Node{val: 2}
    link(a, b)
    _ = a
}
```

The single line `a.next = b` is a pointer store. When Go's concurrent collector is in its marking phase, the compiler-inserted **write barrier** records that `a` now points at `b`, so the collector won't miss `b`. You wrote one assignment; the runtime contract added bookkeeping around it. You can inspect the generated assembly with `go build -gcflags=-S` and find the barrier call in the output — proof that the "simple" assignment is not so simple under a concurrent GC.

### Conservative vs precise, illustrated in pseudocode

```text
// CONSERVATIVE root scan (no compiler help):
for each word W on the stack and in registers:
    if W looks like an address inside the heap:
        treat the object at W as LIVE   // might be a false positive

// PRECISE root scan (compiler provided a stack map for this safepoint):
map = stackMapFor(currentInstructionPointer)
for each slot S that map marks as "holds a pointer":
    object = read(S)
    treat object as LIVE                // never a false positive
    // and, if moving: after relocation, write the new address back into S
```

The precise version is only possible because the compiler emitted `stackMapFor(...)` data alongside the code. That metadata *is* the runtime↔GC interface.

---

## Pros & Cons

This section weighs the *integration choices*, not GC in general.

| Choice | Pros | Cons |
|--------|------|------|
| **Precise scanning (stack maps)** | No floating garbage; enables moving/compacting GC; tighter heaps. | Compiler must emit and maintain map metadata; metadata takes space; more compiler complexity. |
| **Conservative scanning** | Zero compiler support needed; works for C/C++ via libraries (Boehm); simple to bolt on. | Floating garbage; cannot move objects (no compaction); occasional memory bloat. |
| **Cooperative safepoints (polling)** | Cheap in the common case; threads stop at clean, well-described points. | Bad TTSP if a thread runs long without polling; needs polls inserted everywhere. |
| **Write barriers** | Enable generational and concurrent collection (shorter pauses). | A per-pointer-store cost; complicates the compiler; hurts store-heavy code. |
| **STW collection** | Simple correctness; no barriers needed for the STW phase itself. | Visible pause latency proportional to work. |
| **Concurrent collection** | Tiny pauses, better tail latency. | Requires barriers, more complex runtime/compiler cooperation, some throughput cost. |
| **TLAB fast-path allocation** | Lock-free, near-free allocation; great throughput. | Some wasted space at TLAB ends; tuning needed; slow path still exists. |

---

## Use Cases

You will *use* this knowledge, even as a junior, when:

- **Reading a GC log and seeing a long pause that isn't collection.** A big "time to safepoint" or "stopping threads" number tells you the problem is integration (a thread that wouldn't stop), not the collector.
- **Profiling a hot loop with surprising extra instructions.** Those can be safepoint polls or write barriers the compiler added.
- **Calling native code (JNI, cgo, P/Invoke).** Native sections interact specially with safepoints — a long native call can block the collector or, conversely, must be handled so it doesn't.
- **Choosing or tuning a collector.** Knowing that ZGC and Shenandoah use *barriers* to move objects concurrently (and thus cost a little throughput) versus a simpler STW collector helps you pick for latency vs throughput.
- **Understanding why "just allocate less" helps.** Fewer allocations means fewer GCs *and* fewer pointer writes means fewer barrier executions.

It is **not** something you implement yourself unless you are writing a language runtime — which is exactly when every detail above becomes your daily work.

---

## Coding Patterns

These are application-level habits informed by how the integration works.

### Pattern 1: Reduce pointer churn in hot paths

```go
// Barrier-heavy: rewires pointers every iteration.
for i := range items {
    cache.head = &items[i]   // pointer store -> write barrier each time
}

// Lighter: store indices or values, not pointers, where possible.
for i := range items {
    cache.headIndex = i      // plain integer store -> no write barrier
}
```

A pointer store may carry a write barrier; an integer store does not. In genuinely hot code, preferring value/index storage can shave barrier cost. (Measure — don't contort readable code on a guess.)

### Pattern 2: Don't build pathological uninterruptible loops

```java
// Risky shape historically: a giant tight loop with no calls inside.
for (long i = 0; i < HUGE; i++) { acc += i; }

// Friendlier: chunk the work; method boundaries are safepoints.
for (long start = 0; start < HUGE; start += CHUNK) {
    processChunk(start, Math.min(start + CHUNK, HUGE)); // call = safepoint
}
```

Method entries/returns carry safepoint polls, so chunking gives the runtime regular chances to stop you, improving TTSP for the whole process.

### Pattern 3: Keep native/critical sections short

```text
// In any language with a native boundary (JNI, cgo, P/Invoke):
acquire native critical region
... do the MINIMUM ...
release native critical region
```

While a thread is in a long native call or a "GC-critical" region (where the GC promises not to move objects), the collector may be blocked or forced to back off. Short native sections keep the collector unblocked.

### Pattern 4: Let allocation be cheap — allocate small and local

```text
// Tiny, short-lived objects ride the TLAB fast path and die young.
// Generational GCs reclaim young garbage almost for free.
tmp := small.New()   // fast bump allocation; collected cheaply
use(tmp)
```

Short-lived local allocations are friendly to the integration: fast to allocate, cheap to collect, and they exercise fewer barriers.

---

## Best Practices

- **Read the pause, not just the GC count.** When latency spikes, separate *time-to-safepoint* from *collection time*. A long TTSP points at a thread that wouldn't stop, not at the collector.
- **Be suspicious of giant tight loops.** A loop with no method calls and no allocation may have no safepoint poll. If you have one over millions of iterations, consider chunking it.
- **Keep native calls short.** Long native sections can stall the whole collector. Copy out what you need and return.
- **Don't fight the write barrier with micro-tricks first.** Most code is fine. Reach for index/value storage only in a *profiled* hot path.
- **Prefer many small short-lived objects over a few churned long-lived ones** when it fits — generational integration handles youth death almost for free.
- **Trust the compiler's barrier elimination.** Modern compilers remove provably-unneeded barriers (e.g., stores into a freshly allocated object that nothing else can see yet). Write clear code and let them.
- **Learn your engine's flags.** `-Xlog:gc*`, `-Xlog:safepoint` (JVM), `GODEBUG=gctrace=1` (Go), and .NET's GC events expose exactly the integration behavior described here.

---

## Edge Cases & Pitfalls

- **The "pause" that isn't collection.** A GC log line says the pause was 200 ms but the marking/sweeping took 5 ms. The other 195 ms was *time-to-safepoint*: one thread took forever to reach a poll. Beginners blame the GC algorithm; the real fix is the slow thread.
- **The counted-loop trap.** A loop with a fixed integer bound and no calls inside historically had no safepoint poll. Inside it, the whole VM cannot pause. Even with modern mitigations, machine-generated tight loops can reproduce this.
- **Native calls and the collector.** A thread blocked in a long native call may be treated as "already at a safepoint" (so the GC proceeds) — but a native *critical* section that pins objects can *block* a moving collector until it ends. Both directions matter; both reward short native sections.
- **Conservative scanning pins junk.** If you ever use a conservative collector (e.g., Boehm in C), an integer that looks like a pointer can keep a dead object alive. Memory "leaks" that aren't real leaks.
- **You cannot hold a raw pointer across a safepoint under a moving GC** if the runtime doesn't know about it. In native extension code, you must use **handles** (indirection the GC can update), not raw addresses, across any point where a GC could run.
- **Barriers cost in store-heavy code.** Tight code that rewires many pointers per iteration pays the barrier repeatedly. It's usually fine; occasionally it's a measurable hotspot.
- **"It's just an integer" can be a pointer.** Under conservative scanning, the GC can't tell. Under precise scanning, the compiler *must* get the map right, or the GC frees live memory — a runtime-implementer's nightmare, not yours, but it's why precise maps are so carefully engineered.

---

## Cheat Sheet

```text
┌────────────────────────────────────────────────────────────────────┐
│            RUNTIME ↔ GC INTEGRATION (the hand-shake)               │
├────────────────────────────────────────────────────────────────────┤
│ The GC needs THREE things from the compiler/runtime:               │
│   1. WHERE the pointers are   -> stack maps / oop maps             │
│   2. A SAFE moment to look    -> safepoints                       │
│   3. NOTICE of pointer writes -> write (and sometimes read) barriers│
├────────────────────────────────────────────────────────────────────┤
│ Roots = pointers OUTSIDE the heap pointing IN                      │
│   live on: thread stacks, CPU registers, globals/statics           │
├────────────────────────────────────────────────────────────────────┤
│ Scanning roots:                                                    │
│   CONSERVATIVE  "looks like a pointer? keep it"  (no compiler help)│
│                 -> floating garbage, CANNOT move objects           │
│   PRECISE       "the map says it's a pointer"     (needs maps)     │
│                 -> exact, CAN move/compact objects                 │
├────────────────────────────────────────────────────────────────────┤
│ Safepoints:                                                        │
│   polls at loop back-edges + method entry/return                   │
│   GC raises a flag; threads stop at the next poll                  │
│   TIME-TO-SAFEPOINT (TTSP) = wait for the SLOWEST thread           │
│   long tight loop / long native call = long TTSP = latency spike   │
├────────────────────────────────────────────────────────────────────┤
│ Allocation fast path:                                              │
│   per-thread TLAB; allocate = bump a pointer; no lock              │
│   TLAB full -> slow path -> maybe a GC                            │
├────────────────────────────────────────────────────────────────────┤
│ Debug flags: -Xlog:gc*,safepoint (JVM) | GODEBUG=gctrace=1 (Go)    │
└────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- The **garbage collector cannot operate alone.** It depends on the **compiler** and **runtime** to make the heap legible. This page is about that interface, not about GC algorithms (which live in the memory-management section).
- The GC must find all **roots** — pointers on stacks, in registers, and in globals — but raw bits don't reveal which words are pointers.
- **Conservative scanning** guesses (anything pointer-shaped is kept), needs no compiler help, but produces floating garbage and forbids moving objects. **Precise scanning** uses compiler-emitted **stack maps / oop maps** to know exactly, enabling compaction.
- Maps are only valid at **safepoints**. The runtime brings every thread to a safepoint via **polls** at loop back-edges and method boundaries before scanning.
- **Time-to-safepoint (TTSP)** is the wait for the slowest thread to stop. A long tight loop or a long native call makes TTSP — and thus the visible pause — large, *independent of how fast collection itself is*.
- Concurrent collectors need the mutator to report pointer changes, so the compiler injects **write barriers** (and sometimes read barriers) around pointer operations — a small but real per-store cost.
- A **moving** collector forces the compiler to declare every live pointer at every safepoint so the GC can rewrite them after relocation; raw pointers can't survive a move unless the GC knows about them (hence **handles** in native code).
- Allocation is co-designed: the **TLAB** fast path makes `new` a near-free pointer bump, with a slow path that may trigger collection.
- Junior superpower: when GC "looks slow," check whether the cost is *collection* or *integration* (TTSP, barriers). The fix is usually in the integration.

---

## Further Reading

- *The Garbage Collection Handbook* — Jones, Hosking, Moss. The standard reference; the chapters on stack maps, safepoints, and barriers are exactly this topic.
- *Crafting Interpreters* — Robert Nystrom. The GC chapter builds a precise collector and shows root-finding from first principles. https://craftinginterpreters.com/
- *The Go Memory Management and GC design docs* — Go team. Describes the hybrid write barrier and safepoints. https://go.dev/doc/gc-guide
- *HotSpot Glossary of Terms* — OpenJDK. Defines oop, oop map, safepoint, TLAB. https://openjdk.org/groups/hotspot/docs/HotSpotGlossary.html
- *A Guide to the Go Garbage Collector* — Go team. Accessible explanation of barriers and pacing. https://go.dev/doc/gc-guide
- *Boehm-Demers-Weiser conservative GC* — documentation on why conservative scanning works and its limits. https://www.hboehm.info/gc/
- *The Z Garbage Collector* — Oracle/OpenJDK wiki. Introduces colored pointers and load barriers. https://wiki.openjdk.org/display/zgc/Main

---

## Diagrams & Visual Aids

### The Three-Part Contract

```text
        ┌──────────────┐        stack maps / oop maps        ┌──────────────┐
        │              │  ───────── "pointers are HERE" ───► │              │
        │   COMPILER   │                                     │              │
        │  + RUNTIME   │  ───────── safepoints  ───────────► │      GC      │
        │  (the HOST)  │            "stop HERE"              │ (the GUEST)  │
        │              │  ───────── write barriers ────────► │              │
        └──────────────┘            "this changed"           └──────────────┘
              ▲                                                      │
              │                  resume after collection            │
              └──────────────────────────────────────────────────────┘
```

### Finding Roots: Conservative vs Precise

```text
STACK at the moment of a GC:
   slot0: 0x7f..1020   slot1: 0x000005   slot2: 0x7f..10a0   slot3: 0xdeadbeef

CONSERVATIVE: check each — "does it land in the heap?"
   slot0 -> maybe a ptr -> KEEP   slot1 -> too small -> skip
   slot2 -> maybe a ptr -> KEEP   slot3 -> maybe a ptr -> KEEP (false positive!)

PRECISE (map says: slot0=ptr, slot2=ptr, others=not):
   slot0 -> KEEP    slot2 -> KEEP    (slot3 correctly ignored)
```

### Safepoints and Time-To-Safepoint

```text
GC requests pause ──► flag raised
                       │
Thread A: ...poll✓ STOP                         (stopped quickly)
Thread B: ...poll✓ STOP                         (stopped quickly)
Thread C: [huge tight loop, no poll]......STOP  (stopped LATE)
                       │◄──────── TTSP ────────►│
                       (everyone waits for C; THIS is the pause you feel)
```

### Allocation Fast Path (TLAB Bump)

```text
Thread's TLAB:   [ used | used | FREE ........................ ]
                                 ^top
new(obj):  if top + size <= end:  addr = top; top += size; return addr   (fast)
           else:                  ask runtime for a new TLAB (maybe GC)   (slow)
```
