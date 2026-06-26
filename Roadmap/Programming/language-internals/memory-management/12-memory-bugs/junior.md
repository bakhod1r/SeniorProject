# Memory Bugs — Junior Level

> **Topic:** [Memory Bugs](README.md)
> **Focus:** What a "memory problem" actually is, why managed (GC'd) programs still leak, and how to recognize the symptoms before you can fix anything.

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

Most engineers meet their first memory bug the same way: a service that "works fine" gets paged at 3 a.m. because it ran out of memory and the orchestrator killed it. It restarts, runs fine for another six hours, and dies again. Nothing in the code looks wrong. There's no crash, no stack trace pointing at a bad line — just a slow, relentless climb in memory until the operating system or the runtime gives up.

This topic is the practical, day-to-day version of memory problems: **"my program uses more memory than it should, and I need to find out why."** It is deliberately separate from the *safety* topic (use-after-free, buffer overflows, the CVE-shaped violations). Those are about *corruption*. This topic is about *growth and waste* — the bugs you hit even in Java, Go, Python, C#, and JavaScript, where the garbage collector is supposed to handle memory for you.

The single most important idea for a junior engineer to absorb: **a garbage collector frees memory you can no longer reach, not memory you no longer need.** If your code still holds a reference to an object — in a map, a list, a closure, a static field — the GC sees that object as *alive* and will never reclaim it. A "memory leak" in a managed language is almost always a *reference you forgot you were keeping*.

---

## Prerequisites

- **What the heap is.** The region of memory where objects/allocations live for as long as they're reachable. Contrast with the stack (function-local, automatically reclaimed on return).
- **What a reference (or pointer) is.** A way for one object to "point at" another. As long as a chain of references leads from a live root to an object, that object is reachable.
- **What garbage collection does at a high level.** Periodically, the runtime figures out which objects are still reachable from the program's roots (globals, stacks, registers) and reclaims the rest.
- **Basic command-line comfort.** You'll watch a process's memory with tools like `top`, `htop`, `docker stats`, or your platform's task manager.

You do *not* need to know GC algorithms in detail yet. You need to know that GC reclaims the **unreachable**, and that **reachable-but-useless** is the leak you create.

---

## Glossary

| Term | Meaning |
|---|---|
| **Heap** | Memory where dynamically allocated objects live. |
| **Reachable** | An object the program can still get to by following references from a root. The GC keeps it. |
| **Root** | A starting point for reachability: global variables, static fields, live stack frames, thread-locals. |
| **Live set / live heap** | The total size of all currently-reachable objects. The "real" memory your program needs *right now*. |
| **RSS (Resident Set Size)** | How much physical RAM the OS sees your process using. Includes heap, native allocations, code, etc. |
| **Memory leak** | Memory that stays allocated but is no longer useful — in GC'd languages, an object that's still reachable but will never be used again. |
| **OOM** | Out Of Memory. Either the runtime throws (`OutOfMemoryError`) or the OS kills the process (the Linux "OOM killer"). |
| **Allocation rate / churn** | How fast your program creates new objects. High churn stresses the GC. |
| **Eviction** | Deliberately removing entries from a cache or collection so it doesn't grow forever. |

---

## Core Concepts

### 1. The leak you can have even with a garbage collector

Here is the whole problem in one sentence: **if you put objects into a long-lived collection and never take them out, that collection is a leak.**

```java
// A "cache" that is really a memory leak.
private static final Map<String, User> CACHE = new HashMap<>();

User getUser(String id) {
    return CACHE.computeIfAbsent(id, this::loadFromDb);
}
```

This looks harmless. But `CACHE` is `static`, so it lives for the entire lifetime of the program. Every distinct `id` ever requested adds an entry. Nothing is ever removed. The GC can never collect those `User` objects — they're reachable through `CACHE`, which is reachable through a static field, which is a root. After enough unique requests, the heap fills and you OOM.

The fix isn't "add more RAM." The fix is to **bound** the cache: cap its size, evict old entries, or expire them after a while. We'll return to that.

### 2. Live set versus allocated memory

When you watch memory climb, you need to distinguish two numbers:

- **Live set:** how much your program *genuinely* needs (reachable objects).
- **Allocated / RSS:** how much memory is *currently held* by the process.

A healthy program: live set stays roughly flat over time (it goes up and down with load but returns to a baseline). RSS may sit a bit above the live set — that's normal, the runtime keeps some slack.

A leaking program: the live set climbs steadily and never comes back down. Every GC cycle reclaims less than the program allocated, so the floor rises. That **rising floor** is the signature of a leak.

### 3. The symptoms you'll actually observe

You rarely *see* the leak directly at first. You see one of these:

- **Slow OOM:** runs fine for hours, then crashes. Classic unbounded-growth leak.
- **Memory climbs and plateaus high:** it stops growing but never drops back, even when traffic dies down at night. Could be a leak that hit a natural ceiling, fragmentation, or a cache that filled.
- **Latency spikes / "stuttering":** GC is running constantly trying to keep up with allocation. This is *GC pressure*, often from creating too many short-lived objects (churn), not necessarily a leak.
- **Container gets killed but the app logs nothing:** the OS OOM-killer struck. The app didn't get a chance to throw — RAM simply ran out (often native/off-heap memory the GC doesn't manage).

Learning to map a symptom to a likely cause is half the skill. A junior who can say "memory rises and never falls under steady load — that smells like an unbounded collection" is already ahead.

### 4. Why "it's the GC's fault" is almost always wrong

New engineers blame the garbage collector. In nearly every real case, the GC is doing exactly its job: keeping alive everything that's reachable. The bug is in *your* references. Reframe every memory investigation as a single question:

> **"What is keeping this object alive?"**

Find the reference chain back to a root, and you've found the leak.

---

## Real-World Analogies

- **The garbage collector is a janitor, not a mind reader.** The janitor throws out trash on the floor (unreachable). If you keep stacking boxes in your office and label them "important," the janitor will *never* touch them — even if you'll never open them again. A leak is a room full of boxes you forgot you were keeping.

- **A subscription you forgot to cancel.** You sign up for a magazine (register a listener/callback). You move on with your life, but the magazines keep arriving and piling up because you never canceled (never unregistered). The pile grows forever. This is the "lapsed listener" leak.

- **A guest list with no checkout.** A hotel that logs every guest who checks *in* but never records anyone checking *out* will eventually believe it's full when it's actually empty. An unbounded map that only ever `put`s and never `remove`s is exactly this.

- **A water tank with a slow drip.** Fragmentation and slow leaks both look like a tank that never quite drains. The water level (RSS) creeps up over days even though usage seems steady.

---

## Mental Models

### The reachability graph

Picture every object as a node and every reference as an arrow. The roots (globals, stacks, statics) are the entry points. The GC keeps any node you can reach by following arrows from a root; it deletes the rest.

A leak is a node (or a whole subgraph) you can *still reach* but will *never use again*. The object is "alive" by the GC's definition and "dead" by your program's intent. Closing that gap — making unused objects actually unreachable — is the cure.

### The rising-floor chart

Sketch memory over time. With GC, you get a sawtooth: allocate up, GC down, repeat. Look only at the **bottom of the teeth** (the post-GC low points). If that floor is flat, you're healthy. If the floor trends upward, you're leaking. This one mental image — *watch the floor, not the peaks* — will save you hours.

### Live-set vs. RSS as two thermometers

Keep two numbers in your head: what the program *needs* (live set) and what the process *holds* (RSS). When they track together and stay flat, all is well. When the live set is flat but RSS keeps rising, you're looking at fragmentation or native memory, not a normal heap leak. When both rise, it's a classic reachable-object leak.

---

## Code Examples

### Example 1 — The unbounded map leak (and the fix)

```go
// LEAK: sessions are added but never removed.
var sessions = map[string]*Session{}

func login(id string) {
    sessions[id] = newSession()
}
// Every login grows the map. Logouts that don't delete leak forever.
```

The fix is to make removal part of the lifecycle:

```go
func logout(id string) {
    delete(sessions, id) // now the Session becomes unreachable and collectible
}
```

If sessions should also expire on their own, you add a time-based sweep — but the core lesson is: **every `add` needs a corresponding `remove`, or a bound.**

### Example 2 — The lapsed listener (forgotten callback)

```java
class Button {
    private final List<Listener> listeners = new ArrayList<>();
    void addListener(Listener l) { listeners.add(l); }
    void removeListener(Listener l) { listeners.remove(l); } // must be called!
}
```

If a short-lived screen registers a listener with a long-lived `Button` and never calls `removeListener`, the `Button` holds the screen alive forever. The screen *should* be garbage after you navigate away, but it isn't — it's reachable through the button's listener list. Always pair `add` with `remove`, often in a teardown/dispose method.

### Example 3 — Watching the floor rise

You don't always need fancy tools to *spot* a leak. Logging your own heap usage on a timer is enough to confirm one:

```go
import "runtime"

func logHeap() {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    // HeapAlloc = bytes of allocated, still-reachable heap objects (the live-ish set)
    log.Printf("HeapAlloc = %d MiB", m.HeapAlloc/1024/1024)
}
```

Run this every 30 seconds under steady load. If `HeapAlloc` keeps climbing and never settles, you have a leak. This simple loop is often the first thing you reach for before pulling out a profiler.

---

## Pros & Cons

This section reframes "pros and cons" as **the trade-offs of managed memory that make these bugs possible.**

**What GC gives you (the pros):**

- You don't manually `free`, so you mostly avoid use-after-free and double-free corruption.
- Memory is reclaimed automatically when objects become unreachable.
- It's far harder to crash with a dangling pointer.

**What GC costs you (the cons that create leak bugs):**

- **It's easy to leak by accident.** Keeping a reference is invisible and effortless; a single forgotten entry in a static map leaks.
- **You lose the "this is freed now" signal.** In manual languages, `free` documents intent. With GC, intent and reachability drift apart silently.
- **Diagnosis is indirect.** There's no line of code to blame; you have to reconstruct *why something is still reachable.*
- **GC itself costs CPU and latency.** High allocation rates make the collector work harder, which can hurt performance even with no leak at all.

---

## Use Cases

You'll apply this junior-level knowledge whenever you:

- Own a long-running service (API server, worker, daemon) that must run for days without restart.
- Add a cache, a map, or a list that grows based on incoming data.
- Register any kind of callback, listener, observer, or subscription.
- Get an alert that a container's memory is climbing or it was OOM-killed.
- Review a teammate's PR that introduces a `static`/global collection.

The skill at this level is **recognition**: spotting the patterns that *tend* to leak before they reach production, and reading a memory-over-time graph correctly when they don't.

---

## Best Practices

1. **Bound every collection that grows from external input.** If a map, list, or cache can grow with traffic, give it a maximum size, a TTL, or both. An unbounded cache is a leak with extra steps.
2. **Pair every `add` with a `remove`.** Listeners, sessions, subscriptions, pending requests — if something goes in, design the path for it to come out.
3. **Be suspicious of `static` / global mutable collections.** They live forever, so anything they hold lives forever.
4. **Watch the floor, not the peak.** Judge memory health by the post-GC baseline over time, not by momentary spikes.
5. **Log heap usage on a timer in dev/staging.** A one-line periodic log of live heap turns "I think it's leaking" into "it's definitely leaking, here's the slope."
6. **Don't blame the GC.** Ask "what's keeping this alive?" instead. The answer is a reference chain you control.

---

## Edge Cases & Pitfalls

- **"It's not leaking, it's just slow to free."** Some runtimes return memory to the OS lazily, so RSS can stay high after the live set shrinks. Before declaring a leak, confirm the *live set* (post-GC heap) is actually rising — not just RSS.
- **A cache is not automatically a leak.** A *bounded* cache that hovers at its limit is healthy. The leak is the *unbounded* one. Don't panic at a flat-but-high plateau.
- **The dev box "never leaks."** Leaks need time and traffic. A bug that takes six hours of production load to OOM will look perfectly fine in a five-minute local run. Reproduce under sustained load.
- **Big allocations aren't always leaks.** A program that legitimately loads a 2 GB dataset uses 2 GB. Memory being *high* is only a bug if it's *unboundedly growing* or *far above what the workload needs.*
- **Restarting "fixes" it — and hides it.** Auto-restart on OOM masks slow leaks for months. The metric to watch is *memory slope between restarts*, not just crash frequency.
- **Native memory is invisible to the heap view.** If you're using off-heap buffers, image libraries, or native extensions, your language's heap tool may show nothing while RSS climbs. That's a more advanced case, but know it exists so you don't chase the wrong thing.

---

## Summary

- A **garbage collector frees the unreachable, not the unneeded.** Leaks in managed languages are **references you forgot you were keeping.**
- The classic leak is an **unbounded collection** (static map, growing list, forgotten listener) that only ever grows.
- Read memory health by watching the **post-GC floor over time**: a rising floor under steady load means a leak.
- Distinguish **live set** (what you need) from **RSS** (what the process holds); they diverge in interesting and diagnostic ways.
- The master question for every investigation is **"what is keeping this object alive?"** — follow the reference chain back to a root.
- Prevent leaks by **bounding collections, pairing add/remove, and being wary of globals.** Recognition is the junior-level superpower; deeper diagnosis and systemic patterns come next.
