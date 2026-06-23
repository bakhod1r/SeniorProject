# Memory Profiling — Junior Level

> **Roadmap:** [Profiling](../README.md) → Memory Profiling
> *Your program's memory is a room full of objects. A heap profile is a photograph of that room: who's in it right now, and how much space each one takes. Most "memory bugs" are really one question — why is something still in the photo that should have left?*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — A Heap Profile Is a Snapshot of What's Alive](#core-concept-1--a-heap-profile-is-a-snapshot-of-whats-alive)
5. [Core Concept 2 — "Growing" vs "High": A Leak Is Not the Same as a Big Working Set](#core-concept-2--growing-vs-high-a-leak-is-not-the-same-as-a-big-working-set)
6. [Core Concept 3 — Shallow Size vs Retained Size](#core-concept-3--shallow-size-vs-retained-size)
7. [Core Concept 4 — The Leak-Hunting Move: Snapshot, Work, Snapshot, Diff](#core-concept-4--the-leak-hunting-move-snapshot-work-snapshot-diff)
8. [Core Concept 5 — Your First Real Heap Profile](#core-concept-5--your-first-real-heap-profile)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is a heap profile, and what is it actually telling you?**

Your program asks the operating system for memory while it runs. Some of that memory holds things still in use — the user session you're serving, the cache you're reading from. Some of it holds things that *finished being useful* but haven't been cleaned up yet. A **heap profile** (also called a **heap snapshot**) is a single picture of the heap at one instant: every live object, grouped by what allocated it, with a size next to each group.

That word — *live* — is the whole game. A heap profile does not show you everything your program ever created. It shows you what is **still reachable right now**: objects something else is still pointing at, so the garbage collector can't throw them away. When people say "we have a memory leak," what they almost always mean is "objects are staying reachable that shouldn't be" — and a heap profile is the tool that points at the culprit.

Here is the trap that catches every beginner. They open a monitoring dashboard, see memory at 1.8 GB, and panic: *leak!* But high memory and a leak are different things. A leak is memory that **grows without bound** because nothing ever frees it. High memory might just be a large, *stable* working set — a cache that's supposed to be big — or simply the garbage collector being lazy because it hasn't needed to run yet. Confusing the two sends you hunting a bug that doesn't exist, or worse, "fixing" a healthy cache.

> **The mindset shift:** stop reading the *total memory number* and start reading the *shape over time* and the *retained size of each suspect*. High heap is not a leak; **growing** heap that never comes back down is. And the number that matters per-object is **retained** size (everything that dies with it), not **shallow** size (the object's own bytes). Most wrong conclusions come from reading the wrong one of those two numbers.

This page gives you the vocabulary and one repeatable technique — snapshot, do work, snapshot again, diff — that turns "memory feels wrong" into "*this map* grew by 40 MB and here's why."

---

## Prerequisites

- **Required:** You can write and run a program in at least one language (examples use **Go**, with notes for **Java**, **Python**, and **Node/Chrome**).
- **Required:** You know what an object/struct, a list/array, and a map/dictionary are.
- **Helpful:** You've heard the term **garbage collector (GC)** and know it's "the thing that frees memory you're done with" — we'll sharpen that.
- **Helpful:** You've used a terminal and run a command-line tool before.

You do **not** need to know GC algorithms, allocator internals, or how to *reduce* memory. Reducing memory once you've found the suspect is [Memory & Allocation Optimization](../../05-memory-and-allocation-profiling/junior.md); the *rate* at which objects are created is [Allocation Profiling](../03-allocation-profiling/junior.md). This page is only about reading the snapshot: *what is alive, and what keeps it alive.*

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Heap** | The region of memory where your program's objects live (as opposed to the call stack). |
| **Heap profile / snapshot** | A picture of the heap at one instant: every live object, grouped, with sizes. |
| **Live / reachable** | An object something else still points to, so the GC keeps it. |
| **Garbage / unreachable** | An object nothing points to anymore; the GC is free to delete it. |
| **Garbage collector (GC)** | The runtime component that finds unreachable objects and reclaims their memory. |
| **Shallow size** | The bytes of *one object itself* — its own fields, not what it points to. |
| **Retained size** | The bytes freed *if that object were deleted* — itself **plus** everything only it keeps alive. |
| **Reference / pointer** | One object holding the address of another — the thing that keeps it "alive." |
| **Leak** | Memory that stays reachable (so never freed) and **grows over time** without bound. |
| **Working set** | The memory your program legitimately needs *right now* to do its job. |

---

## Core Concept 1 — A Heap Profile Is a Snapshot of What's Alive

Picture the heap as a room. Every object your program created and still uses is standing in that room. A heap profile walks in, photographs everyone, and hands you a list: *"4,000 `User` objects, 38 MB total. 1 big `[]byte` buffer, 64 MB. 200,000 `string`s, 12 MB."* That list is the snapshot.

Three things to internalize about the photograph:

**It only contains the living.** Objects your program created and then dropped — a temporary slice in a function that already returned — are *not* in the snapshot, because the GC either already collected them or is about to. The profile is not a history of allocation; it's a census of survivors.

**Survival means reachability.** An object stays in the room because something is still pointing at it: a global variable, a field of another live object, a closure captured by a running goroutine. Trace those pointers from the program's roots (globals, stacks) and everything you can reach is "live." Everything you can't is garbage. The snapshot is exactly the reachable set.

**Every language has this same picture, under different names.** The concept is universal; only the file format and tool differ:

| Runtime | How you capture it | What you open it with |
|---|---|---|
| **Go** | `pprof` heap profile (`-inuse_space`) | `go tool pprof` |
| **Java** | a heap dump, `.hprof` | Eclipse **MAT**, VisualVM |
| **Python** | `tracemalloc` snapshot | `tracemalloc` API / `snapshot.statistics()` |
| **Node.js / Chrome** | a `.heapsnapshot` | Chrome DevTools → Memory |

> **Key insight:** A heap profile answers *"what is alive right now and who allocated it,"* not *"what did my program ever allocate."* Allocation rate — how fast objects are born — is a *different* profile (`-alloc_space` in Go), covered in [Allocation Profiling](../03-allocation-profiling/junior.md). When you want to know *why memory is high*, you want the *in-use* (live) profile, every time.

In Go, the live view is the `-inuse_space` profile. It reports the bytes currently held by objects that are still reachable, grouped by the line of code that allocated them.

---

## Core Concept 2 — "Growing" vs "High": A Leak Is Not the Same as a Big Working Set

This is the single most important distinction at this level, and it's the one nobody explains.

Memory being **high** is a *level*. Memory being a **leak** is a *trend*. They look identical in a single screenshot and completely different over time.

Watch what healthy memory does. It saws up and down: it climbs as your program allocates, then drops sharply when the GC runs and reclaims the dead, then climbs again. That sawtooth is *normal*. The peaks can be high and the program is perfectly fine — the GC just hasn't felt enough pressure to run yet, so dead objects are sitting around waiting to be swept. **High peaks are not a leak.**

```
Healthy (sawtooth — GC reclaims):        Leak (ratchet — floor keeps rising):

MB                                       MB
 |      /|    /|    /|                    |              ___/
 |     / |   / |   / |                    |         ___/
 |    /  |  /  | _/  |                    |    ___/
 |   /   |_/   |/    |                    |_ /
 |__/_______________________ time        |________________________ time
   GC drops it back down each cycle         floor never returns to baseline
```

The signature of a real **leak** is that the *floor* rises. After every GC, memory should fall back to roughly the same baseline — the size of what's genuinely still needed. In a leak, the post-GC floor creeps upward run after run, because more objects are surviving every cycle than the cycle before. The GC is doing its job perfectly; the problem is that the objects are *still reachable*, so the GC is *correct* to keep them. The bug is in your code holding the reference, not in the collector.

And there's a third case that masquerades as both: a large but **stable** working set. A service holding a 2 GB in-memory cache will report 2 GB forever and never grow — that's not a leak, that's the feature working. The way you tell these three apart is not by staring at one number; it's by watching the post-GC floor over time, or by the diff technique in Concept 4.

> **Key insight:** Before you debug a "leak," answer one question: *does the post-GC floor keep rising, or is it just high-and-flat?* High-and-flat is a working set (or a lazy GC) — leave it alone or right-size the cache. A **rising floor** is a leak — now go find what's growing. Skipping this question is how engineers spend a day "fixing" memory that was never broken.

To see whether it's the GC just being lazy versus a true growing floor, you can force a collection right before you measure. In Go that's `runtime.GC()` before `runtime.ReadMemStats`; in Java, a heap dump triggers a full GC first, which is exactly why a `.hprof` shows the *reachable* set rather than the inflated pre-GC number.

---

## Core Concept 3 — Shallow Size vs Retained Size

Open any heap tool — MAT, Chrome DevTools, pprof's flame graph — and you'll see two size columns. Reading the wrong one is the most common mistake in memory profiling, so let's make it concrete.

**Shallow size** is the bytes of the object *itself*: its own fields and the pointers it holds — but **not** the things those pointers point to. A struct with two `int` fields and a slice header is small *shallowly*, even if that slice points at a gigabyte.

**Retained size** is the bytes that would be **freed if you deleted this object** — the object itself **plus everything that would become unreachable once it's gone**. It answers the question you actually care about: *"if this thing went away, how much memory do I get back?"*

Consider a `Cache` struct:

```go
type Cache struct {
    name    string             // a few bytes
    entries map[string][]byte  // a header — but it OWNS megabytes of values
}
```

The `Cache` object's **shallow** size is tiny: a string header and a map header, maybe 50 bytes. But its **retained** size could be 500 MB, because the `entries` map — and every `[]byte` value inside it — is kept alive *only* by this one `Cache`. Delete the `Cache`, and all 500 MB becomes collectable. The retained size is 500 MB; the shallow size is 50 bytes.

> **Key insight:** **Shallow size** is "how big is this box?" **Retained size** is "how much falls off the truck if I remove this box?" When you're hunting what's eating memory, you sort by **retained** size — that's what tells you which object, if fixed, actually gives memory back. Sorting by shallow size points you at a thousand small strings and hides the one `Cache` holding them all.

Java's MAT exposes this directly, and adds a beautiful structure called the **dominator tree**: it groups every object under the single object that *exclusively* keeps it alive. The top of the dominator tree, sorted by retained size, is almost always your leak — "this `HashMap` retains 480 MB" is the headline you're looking for. (The dominator tree is a middle-level topic; for now, just know that *retained size* is the number that points at the real offender.)

---

## Core Concept 4 — The Leak-Hunting Move: Snapshot, Work, Snapshot, Diff

Here is the one technique that turns vague suspicion into a named culprit. It works in every language and it is the bread-and-butter move of memory debugging:

1. Let the program reach a steady state (warmed up, caches filled).
2. Take a heap snapshot. Call it **A**.
3. Do a chunk of representative work — serve 10,000 requests, run the import job, replay the user flow.
4. Force a GC, then take a second snapshot. Call it **B**.
5. **Diff B against A.** Whatever *grew* is your suspect.

The logic is airtight. After step 3's work is finished, every *temporary* object it created should be dead and collected — they were needed only during the work. So anything that's *larger in B than in A* is something the work created **and then failed to let go of**. That's the definition of a leak. The diff filters out all the steady, healthy memory and leaves only the things that accumulated.

In Go you capture the two profiles and let `pprof` compute the difference with `-base`:

```bash
# 1. capture a baseline after warm-up (from a running service with net/http/pprof)
go tool pprof -inuse_space -output=A.pb.gz http://localhost:6060/debug/pprof/heap

# 2. ... drive a load of representative traffic against the service ...

# 3. capture again
go tool pprof -inuse_space -output=B.pb.gz http://localhost:6060/debug/pprof/heap

# 4. DIFF: what grew from A to B?
go tool pprof -inuse_space -base=A.pb.gz B.pb.gz
(pprof) top
```

A leaking program produces a diff that screams the answer:

```
      flat  flat%   sum%        cum   cum%
   78.50MB 94.10% 94.10%    78.50MB 94.10%  myapp/cache.(*Store).Put
    2.01MB  2.41% 96.51%     2.01MB  2.41%  myapp/api.decodeRequest
       ...
```

`cache.(*Store).Put` accounts for 78.5 MB of *growth* between the two snapshots — it allocated objects during the work and they're all still alive in B. Your suspect is whatever data structure `Put` is appending to and never trimming.

Every other ecosystem has the identical move:

- **Java:** take two `.hprof` dumps and use MAT's **histogram comparison** (or its leak-suspect report) to see which classes gained instances.
- **Python:** `tracemalloc.take_snapshot()` before and after, then `after.compare_to(before, 'lineno')` — it prints, per source line, exactly how many bytes were added.
- **Node/Chrome:** take two `.heapsnapshot`s and use DevTools' **"Comparison"** view, which lists the delta in objects and size per constructor.

> **Key insight:** A single snapshot tells you what's *big*; a **diff of two snapshots across a unit of work** tells you what's *growing*. Growing-across-work is the fingerprint of a leak, because honest temporary objects die between the snapshots and only the leaked ones survive into the second. When in doubt: snapshot, work, snapshot, diff.

---

## Core Concept 5 — Your First Real Heap Profile

Let's capture and read one end to end in Go. Here is a program with a deliberate, classic leak — a package-level map that records every request and never forgets:

```go
package main

import (
	"os"
	"runtime"
	"runtime/pprof"
	"strconv"
)

// seen is a global, so everything it points to stays reachable FOREVER.
var seen = map[string][]byte{}

func handle(id int) {
	key := strconv.Itoa(id)
	seen[key] = make([]byte, 1024) // 1 KB per request, never removed
}

func main() {
	for i := 0; i < 200_000; i++ { // ~200 MB accumulates in `seen`
		handle(i)
	}

	runtime.GC() // force a collection so the profile shows only LIVE objects
	f, _ := os.Create("heap.pb.gz")
	defer f.Close()
	pprof.WriteHeapProfile(f) // write the in-use (live) heap snapshot
}
```

Run it, then open the live profile:

```bash
go run main.go
go tool pprof -inuse_space heap.pb.gz
```

The `-inuse_space` flag is the one that matters: it asks for **space currently in use by live objects** — exactly the snapshot we want. (Its siblings: `-inuse_objects` counts live *objects*; `-alloc_space` and `-alloc_objects` count *cumulative allocation* — the rate, not the live set.) Inside the interactive prompt:

```
(pprof) top
Showing nodes accounting for 195.31MB, 100% of 195.31MB total
      flat  flat%   sum%        cum   cum%
  195.31MB   100%   100%   195.31MB   100%  main.handle
```

The profile is blunt: `main.handle` is holding 195 MB of live memory. Now ask *where* it's allocated:

```
(pprof) list handle
         .          .     16:func handle(id int) {
         .          .     17:    key := strconv.Itoa(id)
  195.31MB   195.31MB     18:    seen[key] = make([]byte, 1024)
         .          .     19:}
```

Line 18 is your leak, annotated with the exact bytes it retains. The fix is conceptual (forget old entries, bound the map, use a cache with eviction) and belongs to [Memory Optimization](../../05-memory-and-allocation-profiling/junior.md) — but *finding* it took one snapshot and two commands. For a visual version, `go tool pprof -inuse_space -http=:8080 heap.pb.gz` opens a flame graph in your browser where the widest box is the biggest retainer.

> **Key insight:** `-inuse_space` = "what's alive now" (the leak hunt). `-alloc_space` = "what got created total" (the allocation-rate hunt). They answer different questions and will point at different lines. For *"why is memory high/growing,"* reach for `-inuse_space` first.

The same end-to-end story in other runtimes: Java's `jmap -dump:live,format=b,file=heap.hprof <pid>` then open in MAT and read "Leak Suspects"; Python's `tracemalloc.start()` then `snapshot.statistics('lineno')` to rank source lines by live bytes; Node's `--heapsnapshot-near-heap-limit` or a manual DevTools snapshot, sorted by Retained Size. Different buttons, identical picture: *who is alive, and who retains them.*

---

## Real-World Examples

**1. The unbounded cache that "wasn't a cache."** A service kept a `map[string]Result` to "remember recent lookups" — but with no size limit and no expiry. Under steady traffic, memory climbed for days and OOM-killed the pod every Tuesday. A snapshot-work-snapshot diff showed the map's `Put` site growing by ~30 MB per hour while everything else stayed flat. It was a leak dressed as a cache: every distinct key lived forever. (This is the textbook growing-map leak — a global or long-lived collection that only ever *adds*.)

**2. The 1.6 GB that was completely healthy.** A different team panicked at a 1.6 GB resident-memory alert and spent an afternoon hunting a leak. The post-GC floor told the real story: it was *flat* at 1.6 GB across hours — a deliberately large in-memory index, exactly the working set the service was designed to hold. There was no leak. The fix was to the *alert threshold*, not the code. Reading the trend (flat) instead of the level (high) would have saved the afternoon.

**3. The listener that never unsubscribed.** A Node dashboard registered an event listener on every WebSocket reconnect but never removed the old one. Each reconnect captured the previous page's data in a closure that stayed reachable through the listener list. Two `.heapsnapshot`s taken ten minutes apart, compared in DevTools, showed the listener-held `Detached` DOM and closure objects climbing steadily. The retained-size column pointed straight at the closure; the diff proved it was *growing*, not merely present.

---

## Mental Models

- **The snapshot as a census, not a logbook.** A heap profile counts who is *alive in the room right now* — survivors. It is not a history of everyone who ever entered. Allocation profiling is the logbook; memory profiling is the census.

- **High vs growing = altitude vs climb rate.** A plane at 35,000 ft (high) is fine. A plane *climbing and never leveling off* (growing) eventually hits the ceiling. Don't scramble the jets because the altitude is high; scramble them because it won't stop rising. The post-GC floor is your altimeter.

- **Shallow = the suitcase, retained = the suitcase plus everything chained to it.** Remove a small suitcase and a little goes. Remove the suitcase that everything else is handcuffed to, and the whole pile comes with it. Sort by retained size to find that one suitcase.

- **The diff as a sieve.** Steady, healthy memory passes through the before/after sieve unchanged and washes away. Only what *accumulated* during the work stays caught in the mesh. What's left in the sieve is your suspect — by construction.

- **A leak is the GC being right, not wrong.** The collector keeps leaked objects because they are genuinely still reachable. The bug is your code holding a reference it should have dropped. You don't fix a leak by "tuning the GC"; you fix it by cutting the reference.

---

## Common Mistakes

1. **Calling high memory a leak.** A high *level* is not a leak; a rising post-GC *floor* is. Check the trend before you debug. Large-and-flat is usually a working set (or a cache doing its job) — not a bug.

2. **Reading shallow size when you meant retained.** The small struct at the top of a shallow-sorted list is rarely the problem. Sort by **retained** size to find the object that actually holds the memory hostage.

3. **Profiling allocation rate to find a leak.** `-alloc_space` shows what got created over the whole run, including long-dead objects. To find *what's still alive*, use `-inuse_space` (Go) / a heap dump (Java) / a live `tracemalloc` snapshot. Wrong profile, wrong line.

4. **Forgetting to GC before the snapshot.** Without a forced collection, the snapshot includes dead-but-not-yet-swept objects and overstates live memory — making a healthy program look like a leak. Force a GC first (Go's `runtime.GC()`; a Java heap dump does it for you).

5. **Taking only one snapshot when hunting a leak.** A single snapshot shows what's *big*, not what's *growing*. A leak is defined by growth, so you need **two** snapshots across a unit of work and a diff. One snapshot can't distinguish a leak from a large working set.

6. **Profiling during warm-up.** Snapshots taken before caches fill and pools stabilize are noisy — everything looks like it's "growing" because the program is still filling its legitimate working set. Reach steady state first, *then* start the diff.

---

## Test Yourself

1. In one sentence, what does a heap profile show — and what does it *not* show?
2. Your dashboard shows memory steady at 1.2 GB for six hours. Is this a leak? What single signal would tell you for sure?
3. A `Session` struct has a shallow size of 80 bytes and a retained size of 240 MB. Explain how both can be true, and which number you'd sort by to find a memory hog.
4. Describe the four steps of the snapshot-diff leak-hunting technique, and why "what grew" is the suspect.
5. In Go, you want to know *what is currently alive* in the heap. Which `pprof` flag do you use, and how does it differ from `-alloc_space`?
6. Why should you call `runtime.GC()` (or trigger a full GC) *before* capturing a heap snapshot?

<details>
<summary>Answers</summary>

1. It shows the objects that are **alive (still reachable) right now**, grouped by what allocated them, with sizes; it does **not** show objects already freed, nor the full history of everything ever allocated.
2. **Almost certainly not a leak** — a leak's signature is *growth*, and this is flat. The decisive signal is the **post-GC floor over time**: if it stays flat, it's a stable working set; if it ratchets upward, it's a leak. (Flat at 1.2 GB = working set.)
3. **Shallow** = the `Session`'s own 80 bytes (its fields/headers). **Retained** = 240 MB because the `Session` exclusively keeps a large structure (a buffer, a map of messages) alive — deleting the `Session` would free all 240 MB. Sort by **retained** size to find what actually holds memory.
4. (1) Reach steady state and take snapshot **A**; (2) do representative work; (3) force a GC and take snapshot **B**; (4) **diff B against A**. Whatever *grew* is the suspect because honest temporary objects from the work are dead and collected by B, so anything larger in B was created by the work and never released — the definition of a leak.
5. Use **`-inuse_space`** — it reports space held by **live** objects (the snapshot of what's alive). `-alloc_space` reports **cumulative** bytes allocated over the whole run, including long-dead objects, so it measures allocation *rate/total*, not the live set.
6. Without a forced GC, the snapshot includes **dead-but-not-yet-collected** objects, overstating live memory and making a healthy program look like it's leaking. Forcing a GC first ensures the snapshot reflects only what is genuinely still reachable.

</details>

---

## Cheat Sheet

```
WHAT A HEAP PROFILE IS
  a snapshot of LIVE (reachable) objects right now, grouped by allocator, with sizes
  NOT a history of all allocations  → that's allocation profiling (the RATE)

HIGH vs GROWING (the #1 distinction)
  high + FLAT post-GC floor   → working set or lazy GC   → NOT a leak
  rising post-GC FLOOR        → leak (something never frees) → hunt it
  read the TREND, not the single number

SHALLOW vs RETAINED
  shallow  = the object's own bytes                  ("how big is this box?")
  retained = object + all it exclusively keeps alive ("what falls off the truck?")
  → sort by RETAINED to find the real hog

LEAK-HUNT MOVE  (snapshot → work → snapshot → diff)
  1. warm up, snapshot A
  2. do representative work
  3. runtime.GC(); snapshot B
  4. diff B - A  → what GREW is the suspect

GO COMMANDS
  pprof.WriteHeapProfile(f)            # write a live-heap snapshot
  go tool pprof -inuse_space heap.pb.gz   # what's ALIVE now  ← leak hunt
  go tool pprof -alloc_space heap.pb.gz   # total allocated   ← rate, not live
  (pprof) top                          # biggest retainers
  (pprof) list <fn>                    # per-line retained bytes
  go tool pprof -inuse_space -base=A.pb.gz B.pb.gz   # DIFF two snapshots
  go tool pprof -http=:8080 heap.pb.gz # flame graph in browser

SAME PICTURE, OTHER RUNTIMES
  Java   jmap -dump:live,format=b,file=heap.hprof <pid>  → Eclipse MAT (Leak Suspects)
  Python tracemalloc snapshot → after.compare_to(before, 'lineno')
  Node   .heapsnapshot in Chrome DevTools → "Comparison" view, sort by Retained Size
```

---

## Summary

- A **heap profile/snapshot** is a picture of what is **alive (reachable) in the heap right now**, grouped by what allocated it — a census of survivors, not a log of all allocations.
- **High memory is not a leak.** A leak is memory that **grows** because objects stay reachable and never free — its fingerprint is a **rising post-GC floor**, not a high peak. High-and-flat is a working set (or a lazy GC); right-size it or leave it alone.
- **Shallow size** is the object's own bytes; **retained size** is everything that dies with it. Sort by **retained** to find the object that actually holds the memory — the most-misread pair of numbers in any heap tool.
- The universal leak-hunting move is **snapshot → do work → snapshot → diff**: whatever *grew* across the work is the suspect, because honest temporaries are dead by the second snapshot.
- In Go, **`-inuse_space`** is the live snapshot (the leak hunt); **`-alloc_space`** is cumulative allocation (the rate). Java (`.hprof`/MAT), Python (`tracemalloc`), and Node/Chrome (`.heapsnapshot`) all give the *same* picture with different buttons.

You can now read a heap snapshot, tell a leak from a large working set, sort by the number that matters, and diff two snapshots to name a culprit. Next is learning *why* objects survive (reference chains, the dominator tree) and how the GC's behavior shapes what "memory profile" even means.

---

## Further Reading

- [Go Diagnostics — Profiling](https://go.dev/doc/diagnostics#profiling) — the official guide to `pprof`, including the heap profile and `inuse`/`alloc` distinction.
- [`net/http/pprof` package docs](https://pkg.go.dev/net/http/pprof) — how to expose `/debug/pprof/heap` on a running service for live snapshots.
- [Eclipse MAT — Shallow vs. Retained Heap](https://help.eclipse.org/latest/topic/org.eclipse.mat.ui.help/concepts/shallowretainedheap.html) — the clearest written explanation of the two sizes and the dominator tree.
- [Chrome DevTools — Record heap snapshots](https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots) — the diff/comparison workflow in a GUI.
- The [middle.md](middle.md) of this topic, which formalizes reachability, the dominator tree, and reading retention paths.

---

## Related Topics

- [03 — Allocation Profiling](../03-allocation-profiling/junior.md) — the *rate* side: how fast objects are born (`-alloc_space`), often the easier optimization target.
- [Memory & Allocation Optimization](../../05-memory-and-allocation-profiling/junior.md) — what to *do* once you know what's retained (bounding caches, eviction, pooling).
- [Memory Profiling — Middle](middle.md) — reachability, the dominator tree, and reading the full retention path to a leaked object.
- [Diagnostics → Post-Mortem Analysis](../../../../diagnostics/post-mortem-analysis/README.md) — heap dumps captured at crash time, when the snapshot is taken *after* the failure.
