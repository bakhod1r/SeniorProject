# GC Tuning in Production — Junior Level
> **Topic:** [GC Tuning in Production](README.md)
> **Focus:** The mental model — what a garbage collector costs you, and the three things you can trade.

---

## Table of Contents
- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [Real-World Analogies](#real-world-analogies)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

A garbage collector (GC) is the part of a managed runtime — the JVM, the Go runtime, the .NET CLR, V8 — that automatically reclaims memory you are no longer using. You allocate objects; you never call `free`. The GC figures out which objects are dead and recycles their memory.

This is wonderful for productivity and a constant source of production surprises. The GC is not free. It runs on the same CPU your application runs on, and sometimes it must *pause your program* to do its work. When that pause lands in the middle of serving a request, the user waits. When it lands during a trading decision or a video frame, something visibly breaks.

"GC tuning" is the practice of shaping that cost: making pauses shorter, rarer, or moving the cost from latency to memory. You do not eliminate the GC. You decide *which* cost you are willing to pay.

The single most important idea in this whole topic: **GC tuning is not about magic flags. It is about understanding a three-way trade-off and measuring before you touch anything.**

## Prerequisites

- You know what heap memory is: where dynamically allocated objects live (as opposed to the stack, which holds local variables and call frames).
- You understand "allocation" — asking the runtime for memory for a new object (`new Foo()`, `make([]byte, n)`, `[]int{...}`).
- You have a rough sense of what a "reference" or "pointer" is: a way one object reaches another.
- You can run a program and read its standard error / log output.

You do **not** need to know how a specific collector works internally yet. That is the middle and senior tiers. Here we build intuition.

## Glossary

- **Heap** — the region of memory where allocated objects live. The GC manages this.
- **Allocation rate** — how many bytes per second your program allocates. A firehose of short-lived objects is a *high allocation rate*.
- **Garbage** — allocated memory that is no longer reachable from your program. The GC's job is to find and reclaim it.
- **Live set / live heap** — the bytes that *are* still reachable and in use right now. The GC must keep these.
- **GC pause (STW, "stop-the-world")** — a window where the runtime suspends your application threads so the GC can safely do part of its work.
- **Throughput** — the fraction of total CPU time spent doing *your* work rather than GC work. High throughput = GC overhead is small.
- **Latency** — how long an individual operation takes. GC pauses inflate latency, especially the slow ones (the tail).
- **Footprint** — how much memory the process uses. A bigger heap usually buys lower GC frequency.
- **Collection / GC cycle** — one round of the collector finding and reclaiming garbage.

## Core Concepts

### Why the GC pauses at all

To safely reclaim memory, the collector needs a consistent view of which objects are alive. The simplest way to get that is to freeze the application for a moment so nothing moves while the GC looks. That freeze is the **stop-the-world (STW) pause**.

Modern collectors do most of their work *concurrently* — alongside your running program — and only freeze for tiny windows. But "tiny" is relative, and the freeze never fully disappears.

### The GC tuning triangle (the one diagram to remember)

There are three things a GC trades against each other:

```
                 LATENCY
                (short pauses)
                    /\
                   /  \
                  /    \
                 /      \
                /        \
   THROUGHPUT  /__________\  MEMORY FOOTPRINT
 (less GC CPU)             (small heap)
```

You can usually get **two** of these, not all three:

- Want **short pauses** *and* **high throughput**? You will need a **bigger heap** (more memory).
- Want **short pauses** *and* **a small heap**? The GC has to work harder and more often — **throughput drops**.
- Want **high throughput** *and* **a small heap**? You accept **longer/occasional pauses**.

Every tuning decision is a move inside this triangle. There is no setting that wins all three.

### The "bigger heap = better GC" surprise

This is counterintuitive for beginners. Giving the GC *more* memory often makes it run *less* and feel smoother. Why?

Think of the heap as a room and garbage as trash. If the room is tiny, it fills up constantly and you must take out the trash every few minutes. If the room is large, trash accumulates slowly and you take it out rarely. Each trip costs the same, but you make far fewer trips.

A bigger heap means more *headroom* between collections, which means **lower GC frequency**. Fewer collections, fewer pauses.

### The allocation-rate lever (the one you control in code)

The GC's workload is driven by how much garbage you create. If you allocate less, the GC has less to do. This is the lever that lives entirely in *your* code, not in flags:

- Reuse buffers instead of allocating a new one per request.
- Avoid creating millions of tiny temporary objects in a hot loop.
- Don't build a huge intermediate list just to throw it away.

**Reducing allocation is almost always the first and best tuning move**, because it shrinks the problem rather than rearranging who pays for it.

### Why the average pause is a lie

Suppose your service handles 10,000 requests and 9,990 of them respond in 5 ms, but 10 of them hit a GC pause and take 200 ms. The *average* looks fine (~5.2 ms). But 1 in 1,000 of your users waited 40× longer.

The numbers that matter are **percentiles**: p99 ("99th percentile" — the slowest 1%) and p999 (slowest 0.1%). GC pauses live in the tail. Averages hide them. This is why people say *"latency is a tail problem"* — and the tail is where the GC shows up.

## Real-World Analogies

- **Taking out the trash.** You allocate garbage all day. Eventually someone has to bag it and carry it out. A small trash can fills fast (frequent trips); a dumpster fills slowly (rare trips). The GC is the person doing the carrying — and sometimes they ask you to stop working while they do.

- **A restaurant kitchen during service.** Throughput is how many plates leave the pass. Cleaning the station (GC) is necessary but stops plating. You can clean constantly (smooth but slow service) or let it pile up and do a big clean (fast service, then a noticeable stall). A bigger kitchen lets you clean less often.

- **A library cart.** Returned books (garbage) pile on a cart. Reshelving (collection) interrupts the librarian's other work. A bigger cart means rarer-but-larger reshelving sessions.

## Mental Models

**Model 1: "The GC is a tax, not a fee."** You can't opt out, but you can choose *how* it's levied — as small frequent payments (latency), as a lump sum (throughput-style pauses), or by holding more reserve cash (memory).

**Model 2: "Allocation is the input, GC is the output."** The GC's behavior is downstream of how much you allocate. Fix the input first.

**Model 3: "Measure the tail, not the mean."** When reasoning about GC impact on users, always think p99/p999. The mean is for capacity planning, not latency.

## Code Examples

You rarely "call" the GC in production code, but two things are worth seeing.

**High vs. low allocation (the lever you own).** This Java snippet allocates a fresh array on every iteration — a classic allocation storm:

```java
// High allocation: a new buffer every call -> lots of garbage
public int sumLines(List<String> lines) {
    int total = 0;
    for (String line : lines) {
        byte[] buf = new byte[1024];   // allocated, used briefly, thrown away
        total += process(line, buf);
    }
    return total;
}
```

Reusing the buffer turns thousands of allocations into one:

```java
// Low allocation: reuse one buffer
public int sumLines(List<String> lines) {
    int total = 0;
    byte[] buf = new byte[1024];        // allocated once
    for (String line : lines) {
        total += process(line, buf);
    }
    return total;
}
```

**Asking the runtime to print what the GC is doing.** You don't tune blind. In Go, one environment variable makes the runtime narrate every collection:

```bash
GODEBUG=gctrace=1 ./myserver
```

In the JVM, a logging flag does the same:

```bash
java -Xlog:gc ./MyApp.jar
```

At this tier you are not expected to decode every field — just to know these switches exist and that **the first step of tuning is turning on visibility.**

## Pros & Cons

**Pros of automatic GC (why we accept the cost):**
- No manual `free`, so no use-after-free, double-free, or most leaks-by-forgetting.
- Faster development and far fewer memory-safety security bugs.
- The runtime can compact memory and improve cache locality for you.

**Cons (the costs you tune against):**
- Pauses inflate tail latency.
- GC consumes CPU you'd rather spend on requests (throughput cost).
- It needs headroom, so a managed process uses more memory than a hand-tuned C program.
- Behavior is partly non-deterministic and load-dependent, which makes incidents harder to reproduce.

## Use Cases

- **Latency-sensitive services** (APIs, ad bidding, trading): you tune for short pauses.
- **Batch / data pipelines** (ETL, report generation): you tune for throughput; nobody cares about a 1-second pause.
- **Memory-constrained environments** (small containers, edge devices): you tune to fit the footprint and accept the trade-offs.

The "right" tuning depends entirely on which of these you are.

## Best Practices

- **Measure before you tune.** Turn on GC logging first. Never change a flag based on a blog post alone.
- **Reduce allocation first.** It is the cheapest, most durable win and the only lever fully in your control.
- **Change one thing at a time.** GC behavior is interacting and subtle; batched changes are un-diagnosable.
- **Think in percentiles.** Track p99/p999 latency, not just the average.
- **Right-size the heap before reaching for exotic collectors.** Often "give it more memory" is the whole fix.

## Edge Cases & Pitfalls

- **Confusing a memory leak with a GC problem.** If memory only ever climbs and the GC can't reclaim it, you have a leak — the objects are still reachable. No GC flag fixes a leak. (Senior tier covers this.)
- **Cargo-culting flags.** Copying a stranger's JVM flag set "because it's fast" usually makes things worse; their workload isn't yours.
- **Tuning the average away while the tail gets worse.** Some changes lower mean latency but increase the worst pauses. Watch p999.
- **Forgetting the container limit.** Inside Kubernetes, your process can think it has the whole machine's RAM while the container limit is far lower — leading to the orchestrator killing it (OOMKilled). This is a top-3 production GC failure and the higher tiers dig into it.

## Summary

The garbage collector reclaims memory automatically, but it costs CPU and occasional pauses. You can't remove that cost — you can only **shape** it along three axes that form a triangle: **latency (short pauses), throughput (less GC CPU), and footprint (small heap)** — pick about two. The most powerful and underused lever is **reducing allocation in your own code**. The second is **giving the GC more heap headroom**, which paradoxically makes it run less often. And always judge GC impact by the **tail (p99/p999)**, because the average hides the pauses that hurt real users. Above all: **measure first, change one thing, re-measure.**
