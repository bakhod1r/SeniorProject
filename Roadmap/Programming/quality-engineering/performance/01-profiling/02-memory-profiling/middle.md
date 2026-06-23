# Memory Profiling — Middle Level

> **Roadmap:** [Profiling](../README.md) → [Memory Profiling](README.md) → Middle
> *The junior page taught you to capture a heap snapshot and read "what's big." This page teaches you to read it like a pro: the dominator tree, the retained set, the path to a GC root, and the two-snapshot diff that turns "memory keeps growing" into "this exact map is the leak."*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Shallow vs Retained Size — the Most-Misread Number](#shallow-vs-retained-size--the-most-misread-number)
4. [The Dominator Tree — "If X Were Freed, What Comes With It?"](#the-dominator-tree--if-x-were-freed-what-comes-with-it)
5. [GC Roots and Retention Paths — "What Keeps This Alive?"](#gc-roots-and-retention-paths--what-keeps-this-alive)
6. [inuse_space vs inuse_objects — Few Big or Many Small](#inuse_space-vs-inuse_objects--few-big-or-many-small)
7. [Two Snapshots and a Diff — Isolating Growth](#two-snapshots-and-a-diff--isolating-growth)
8. [Leak, Cache, or GC Just Hasn't Run?](#leak-cache-or-gc-just-hasnt-run)
9. [The Tools and Their Idioms](#the-tools-and-their-idioms)
10. [Worked Example — Diffing Two Snapshots to Find the Growing Retainer](#worked-example--diffing-two-snapshots-to-find-the-growing-retainer)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do I read a heap snapshot well enough to name the object that's leaking — and the line of code that holds it?**

A junior captures a snapshot, sorts by size, and points at the biggest thing. That works for the easy 20% and fails on everything that matters. The biggest *type* is usually `byte[]` or `String` or `map[string]*T` — which tells you nothing, because those are big *everywhere*. The object actually responsible for a leak is rarely large itself; it's a small node that *retains* a large subtree, and the bug is the reference path that keeps that subtree reachable.

Reading a heap snapshot well rests on four ideas the "sort by size" view can't express: **retained size** (what dies *with* an object, not just the object's own bytes), the **dominator tree** (the structure that computes retained size), the **path to a GC root** (the chain of references that is the actual bug), and the **two-snapshot diff** (the only reliable way to separate a leak from a heap that is merely large). This page makes each concrete with real output from `go tool pprof`, Eclipse MAT, Chrome DevTools, and Python `tracemalloc`.

We stay on the **retained / alive** side of the heap. The *rate* of allocation — who churns the GC — is [Allocation Profiling](../03-allocation-profiling/middle.md). What to *do* once you know what's retained — pooling, struct layout, escape — is [Memory & Allocation Optimization](../../05-memory-and-allocation-profiling/middle.md). Here the single question is: **what is alive, and what holds it?**

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can capture a heap snapshot in at least one runtime.
- **Required:** A working model of garbage collection — that an object lives iff it's reachable from a *root*.
- **Helpful:** You've seen a process's RSS climb steadily under steady load and wondered why.
- **Helpful:** Basic comfort with one of: `go tool pprof`, Eclipse MAT, or Chrome DevTools.

---

## Shallow vs Retained Size — the Most-Misread Number

Every heap tool shows two sizes per object, and confusing them is the single most common analysis error.

- **Shallow size** — the bytes of the object *itself*: its header plus its own fields. A `HashMap` with a million entries has a *tiny* shallow size — just the table pointer, the count, a couple of ints. The million entries live in *other* objects.
- **Retained size** — the bytes that would be freed *if this object were garbage-collected*: the object plus everything reachable *only* through it. The same `HashMap`'s retained size is the whole subtree — table, nodes, keys, values — every object that would die when the map dies.

```
Object                    Shallow      Retained
HashMap                        48     1,240,000,000   ← shallow tiny, retained huge
  ├─ Node[]  (table)        262,144     1,239,xxx,xxx
  │    └─ Node × 1,000,000   ...
String[]  (some array)  8,000,000         8,000,000   ← shallow ≈ retained (leaf-ish)
```

Sorting by **shallow** size surfaces big leaves (a giant `byte[]`, an interned-string pool) — occasionally the culprit, usually not. Sorting by **retained** size surfaces the *owners*: the one map, cache, or list whose removal reclaims the most memory. The owner is what you want, because the owner is what a single code change can release.

The catch: an object's retained size depends on *what else points into its subtree*. If two roots both reference a large array, that array belongs to *neither* one's retained set — killing either root frees nothing, because the other still holds it. Retained size is computed against the whole graph, which is exactly what the dominator tree is for.

> **Key insight:** Shallow size answers "how big is this object?" Retained size answers "how much memory does this object *cost me*?" Only the second question matters for a leak — and it's the one beginners never sort by. The leak is almost always a small-shallow, huge-retained node.

---

## The Dominator Tree — "If X Were Freed, What Comes With It?"

Retained size isn't magic; it's read off a structure called the **dominator tree**. Object **A dominates** object **B** if *every* path from a GC root to B passes through A. Equivalently: if A were removed, B becomes unreachable and dies. An object's retained set is exactly the set of objects it dominates, and its retained size is their total bytes.

This is why retained size is well-defined even in a tangled object graph. The array referenced by two roots is dominated by *neither* root individually — there's a path to it that avoids each one — so it sits higher in the dominator tree, under whatever node *all* paths share (in the limit, the synthetic root). That's the formal version of "killing one owner frees nothing if another still points in."

Eclipse MAT's central view is literally called the **Dominator Tree**, sorted by retained size:

```
Class Name                                    Shallow Heap    Retained Heap   Percentage
com.acme.SessionCache                                   48    1,240,184,320       62.4%
  └─ java.util.concurrent.ConcurrentHashMap             64    1,240,180,992       62.4%
       └─ ConcurrentHashMap$Node[]                 4,194,304   1,236,xxx,xxx       62.3%
            └─ com.acme.UserSession × 524,288       ...
com.acme.MetricsBuffer                                  32      198,400,016        9.9%
```

One read of this view tells you: 62% of the live heap is reachable through a single `SessionCache`, and it's a `ConcurrentHashMap` with half a million `UserSession` entries. You haven't proven it's a leak yet — but you've found the one object worth investigating, and you found it in seconds instead of scrolling a histogram of types.

> **Key insight:** The dominator tree turns a tangled reachability graph into a clean ownership tree where each node's subtree is exactly what dies with it. "Find the leak" becomes "walk down the dominator tree following the largest retained child until the bytes stop being justified." That walk is the core skill of heap analysis.

---

## GC Roots and Retention Paths — "What Keeps This Alive?"

Knowing *which* object retains the heap is half the answer. The other half — the half that names the bug — is *why it's still reachable*. An object is alive because there's a chain of references from a **GC root** down to it. That chain is the **retention path** (MAT calls it the **Path to GC Roots**), and the surprising link in it is your bug.

GC roots are the entry points the collector treats as "always alive":

- **Local variables / stack frames** of running threads.
- **Static fields** (Java statics, Go package-level vars) — live for the whole program.
- **Active threads / goroutines** themselves, and anything their stacks reference.
- **JNI / native references**, thread-locals, the system classloader's classes.

A retention path reads from the leaking object *up* to the root:

```
UserSession  @ 0x7f...a0
 └─ value of ConcurrentHashMap$Node
  └─ [1] of ConcurrentHashMap$Node[]
   └─ table of ConcurrentHashMap
    └─ sessions of com.acme.SessionCache
     └─ INSTANCE of com.acme.SessionCache        ← static field = GC ROOT
```

The last line is the diagnosis: a `static INSTANCE` holds a `ConcurrentHashMap` that nobody ever evicts from. The `UserSession` can't die because a static field transitively reaches it. The fix isn't "free the session" — it's "stop the static singleton from holding sessions forever" (bound the map, evict on logout). **The path to the root *is* the bug report.**

In MAT you right-click the object → **Path to GC Roots → exclude weak/soft references** (you exclude weak/soft because those *don't* prevent collection — including them produces paths that aren't real leaks). In Chrome DevTools the **Retainers** panel at the bottom of a heap snapshot shows the same thing: expand it to walk from the object up to a `(GC root)` or a `Window` / global.

> **Key insight:** Retained size says *how much*; the retention path says *why*. You can't fix a leak from retained size alone — you fix it from the path, because the path contains the one reference (a static map, an un-removed listener, a captured closure) that a code change must sever. Always end your analysis on a root, never on "it's big."

---

## inuse_space vs inuse_objects — Few Big or Many Small

Go's heap profile (and the equivalent in every tool) gives you two *in-use* measures, and which one you sort by changes what you find:

- **`inuse_space`** — live **bytes** by allocation site. Surfaces *few big* objects: a 200 MB slice, a cache holding large buffers.
- **`inuse_objects`** — live **object count** by allocation site. Surfaces *many small* objects: ten million 32-byte structs that individually look like nothing but collectively dominate the heap and crush the GC.

A leak can hide in either. A growing `map[string][]byte` of large blobs shows up loudly in `inuse_space`. A growing slice of millions of tiny structs (or a `sync.Map` accumulating tiny entries) may be modest in `inuse_space` but enormous in `inuse_objects` — and the object count is the tell.

```bash
# live bytes by site
go tool pprof -inuse_space  http://localhost:6060/debug/pprof/heap
# live object count by site
go tool pprof -inuse_objects http://localhost:6060/debug/pprof/heap
```

```
(pprof) top
Showing nodes accounting for 1.41GB, 96.2% of 1.46GB total
      flat  flat%   sum%        cum   cum%
    1.18GB 80.8% 80.8%     1.18GB 80.8%  acme/cache.(*Store).Put
    0.21GB 14.4% 95.2%     0.21GB 14.4%  acme/proto.Unmarshal
```

`flat` is bytes allocated *at* that function and still live; `cum` includes its callees. Here `(*Store).Put` holds 1.18 GB of live data by itself — the retainer. Switch to `inuse_objects` and if a *different* site jumps to the top, you have a many-small problem instead.

> **Key insight:** `inuse_space` finds the whale; `inuse_objects` finds the swarm. Always check both — sorting by bytes alone will miss a leak made of millions of tiny objects, and that swarm is often the one quietly destroying GC pause times.

---

## Two Snapshots and a Diff — Isolating Growth

A single snapshot tells you what's big *now*. It cannot tell you what's *leaking*, because a large heap can be perfectly healthy (see the next section). The only robust way to find a leak is to take **two snapshots** around a repeatable workload and look at the **delta**. What *grew* is the suspect; what's merely large but stable is noise.

The protocol — identical across runtimes:

1. Drive the app to steady state, then **force a GC** so you compare *settled* heaps, not garbage-in-flight.
2. Take snapshot **A** (the baseline).
3. Run N iterations of the suspect operation (e.g. 10,000 requests through the endpoint you suspect).
4. **Force a GC again** — this is critical: it collects everything that *should* die, so what remains is genuinely retained.
5. Take snapshot **B**.
6. **Diff B against A.** Objects whose count/bytes rose by ~N (or N×k) are the leak; everything flat is irrelevant.

The diff is what makes a leak *obvious*. A type that gained exactly 10,000 instances after 10,000 requests is not a coincidence — it's an object created per request that nothing releases. The tools expose this directly:

- **MAT:** open both heap dumps, use **Compare Basket** (add A, add B, ▣ compare) → a table of retained-size and instance-count deltas per class.
- **Chrome DevTools:** take snapshot, act, take another; switch the selector to **Comparison** → columns **# New**, **# Deleted**, **# Delta**, **Size Delta** per constructor. Sort by `# Delta`.
- **Go:** `go tool pprof -inuse_space -diff_base=heap_A.pb.gz heap_B.pb.gz` — `top` then shows the *growth* per site, not absolute totals.
- **Python:** `snapshot_b.compare_to(snapshot_a, 'lineno')` returns per-line size *differences*, largest first.

> **Key insight:** One snapshot answers "what's big?"; two snapshots answer "what's *growing*?" — and only the second question identifies a leak. Bracket a repeatable workload with GC-forced snapshots and diff them. The delta names the suspect with almost no judgement required.

---

## Leak, Cache, or GC Just Hasn't Run?

Before you declare a leak, rule out the two impostors. High heap usage is *not* the same as a leak, and acting on a false positive wastes days.

**Impostor 1 — the GC simply hasn't run.** A managed runtime grows its heap on purpose; collecting early is wasted work. A sawtooth — heap climbs, GC fires, heap drops, repeat — is *healthy*, even if the peaks are high. You only suspect a leak when the *floor* of the sawtooth (live size right *after* a collection) trends upward over time. This is exactly why the two-snapshot protocol forces a GC before each capture: you compare *post-collection* floors, not pre-collection peaks. Without that forced GC, you'll "find" megabytes of garbage that the next collection would have reclaimed anyway.

**Impostor 2 — a legitimate cache or buffer.** A bounded LRU cache that fills to its limit and stays there is *retaining memory by design*, not leaking. The distinguishing test is **boundedness**: does the retained set *plateau*, or does it grow without limit?

| Signal | True leak | Healthy cache / buffer |
|---|---|---|
| Post-GC live floor over time | rises monotonically | rises then **plateaus** |
| Retained set after long run | unbounded | bounded by cache capacity |
| Diff after N ops, then N more | grows each round | grows once, then flat |
| Has an eviction policy? | no (or broken) | yes, and it fires |

So the real test is never "is the heap big?" It's "does the *floor* keep rising after GC, without bound, as the workload repeats?" If yes, leak. If it plateaus, you have a cache — possibly mis-sized, but not leaking.

> **Key insight:** A leak is *unbounded post-GC growth*, not high usage. Always compare the live floor *after* a forced collection across time. A high but flat floor is a cache; a rising floor is a leak. Confusing the two sends you optimizing healthy memory and ignoring the real one.

---

## The Tools and Their Idioms

Each runtime has one canonical heap tool and a few idioms worth memorizing.

**Go — `go tool pprof`.** Pull a live heap profile from `net/http/pprof`, sort live bytes, drill to source:

```bash
go tool pprof -inuse_space http://localhost:6060/debug/pprof/heap
(pprof) top                 # live bytes by site
(pprof) list (*Store).Put   # annotate the source line holding the memory
(pprof) web                 # SVG graph; box size ∝ retained bytes
```
`list` overlays live-byte counts on the actual source, pointing at the exact line that allocates the retained data. `web` renders the retention graph where box area tracks bytes — the visual equivalent of a dominator tree.

**Java — Eclipse MAT** on a `.hprof` dump (`jmap -dump:live,format=b,file=heap.hprof <pid>`; the `live` flag forces a GC first):

- **Dominator Tree** — the heap by retained size; your primary view.
- **Path to GC Roots → exclude weak/soft** — why an object is still alive.
- **Leak Suspects report** — MAT's automated first pass: it clusters the dominator tree and names "one instance of X retains 62%." Often points straight at the culprit; always verify the path yourself.
- **Histogram + Compare Basket** — per-class counts, and A-vs-B diffs.

**Chrome / Node — DevTools heap snapshot** (`.heapsnapshot`):

- **Summary** view grouped by constructor; expand to objects.
- **Retainers** panel (bottom) — walk from a selected object up to a `(GC root)`. This is DevTools' "path to root."
- **Comparison** view — diff two snapshots by `# Delta` / `Size Delta`. The classic detached-DOM leak shows as a growing `Detached HTMLDivElement` count here.

**Python — `tracemalloc`** (snapshots of live allocations, attributed to source lines):

```python
import tracemalloc
tracemalloc.start(25)                 # keep 25 frames of traceback per alloc
snap_a = tracemalloc.take_snapshot()
run_workload()
snap_b = tracemalloc.take_snapshot()
for stat in snap_b.compare_to(snap_a, 'lineno')[:10]:
    print(stat)
# cache.py:88: size=412 MiB (+412 MiB), count=1048576 (+1048576)
```
`tracemalloc` ties retained bytes to the *line that allocated them*, and `compare_to` gives you the diff directly — the Python analogue of pprof's `-diff_base`.

> **Key insight:** Every tool exposes the same three primitives under different names — retained size (dominator tree / `inuse_space` / Size), path to root (Path to GC Roots / Retainers), and snapshot diff (Compare Basket / Comparison / `-diff_base` / `compare_to`). Learn the *concepts* and each new tool is just relabeled buttons.

---

## Worked Example — Diffing Two Snapshots to Find the Growing Retainer

**Symptom.** A Go service's RSS climbs ~40 MB/hour under steady traffic and is OOM-killed every two days. CPU and latency are fine. Classic slow leak.

**Step 1 — confirm it's the floor, not the sawtooth.** Grab two heaps an hour apart, each after the GC has run, and diff:

```bash
curl -s localhost:6060/debug/pprof/heap > heap_t0.pb.gz
# ... one hour of steady traffic ...
curl -s localhost:6060/debug/pprof/heap > heap_t1.pb.gz

go tool pprof -inuse_space -diff_base=heap_t0.pb.gz heap_t1.pb.gz
```
```
(pprof) top
Showing nodes accounting for 39.8MB, 99.1% of 40.2MB total
      flat  flat%   sum%        cum   cum%
    39.7MB 98.8% 98.8%     39.7MB 98.8%  acme/events.(*Bus).Subscribe
```
The diff is unambiguous: nearly all *growth* lives at `(*Bus).Subscribe`. Absolute totals would have buried this under steady-state caches; the **delta** isolates it.

**Step 2 — go to the line.**

```bash
(pprof) list (*Bus).Subscribe
```
```
         .          .   41:func (b *Bus) Subscribe(topic string) <-chan Event {
         .          .   42:    ch := make(chan Event, 16)
   39.7MB    39.7MB   43:    b.subs[topic] = append(b.subs[topic], ch)   // <-- grows forever
         .          .   44:    return ch
         .          .   45:}
```
Live bytes are pinned to line 43: every `Subscribe` appends a channel to `b.subs[topic]` and **nothing ever removes it**. There's no `Unsubscribe`, so `b.subs` — reachable from a long-lived `*Bus` — grows without bound. This is the **listener-not-unregistered** retention bug, and `b.subs` is a small-shallow, huge-retained map: the textbook leak shape.

**Step 3 — confirm it's unbounded, not a cache.** Object count over a second hour rises by the same ~40 MB — monotonic, no plateau, no eviction policy. Leak confirmed.

**Step 4 — the cross-check (object count).** Sorting the same diff by `-inuse_objects` shows `(*Bus).Subscribe` topping *both* bytes and count — many channels, each small-ish — confirming a swarm of un-freed subscribers rather than one giant buffer.

**Fix.** Add `Unsubscribe`, remove the channel from the slice on disconnect (swap-and-truncate), and bound retries. **Verify** by repeating the two-snapshot diff after the fix: `(*Bus).Subscribe` no longer appears in `top` — its delta is now ~0. The leak is closed only when the diff says so.

The whole diagnosis — *diff → `list` → confirm unbounded → fix → re-diff* — took four commands and never required guessing. That loop is the entire job.

---

## Mental Models

- **The dominator tree is an ownership tree.** Strip away shared references and what remains is a clean hierarchy where each node *owns* (retains) its subtree. "Find the leak" = "walk down the largest retained child until the bytes are justified."

- **Retained size is a bill, shallow size is a body weight.** A `HashMap` weighs almost nothing itself (shallow) but is *billed* for its entire contents (retained). You pay the bill, so sort by the bill.

- **The path to a GC root is the bug report.** Retained size tells you *how much* leaks; the retention path tells you the *one reference* — a static map, an un-removed listener, a captured closure — that a code change must cut. End every analysis on a root.

- **A leak is a rising floor, not a high tide.** Heap peaks rise and fall by design (the sawtooth). Only the post-GC *floor* trending upward, without bound, is a leak. Compare floors, not peaks.

- **One snapshot describes; two snapshots accuse.** A single heap shows what's big; the *diff* of two shows what *grew*. The delta is the suspect — let it do the accusing.

---

## Common Mistakes

1. **Sorting by shallow size and chasing the biggest type.** The biggest type is `byte[]`/`String`/`map` *everywhere*; it's rarely the leak. Sort by **retained** size to find the *owner* — the small node that holds the big subtree.

2. **Stopping at "it's big" instead of walking to a root.** Retained size finds the *what*; only the **Path to GC Roots** finds the *why* — and you can't write a fix without the why. Always end on a root.

3. **Diffing snapshots without forcing a GC first.** Without a pre-capture collection you compare heaps full of about-to-die garbage and "find" leaks the next GC would reclaim. Force GC, *then* snapshot — both times.

4. **Calling a bounded cache a leak.** A cache that fills to capacity and *plateaus* is working as designed. The test is **unbounded post-GC growth**, not high usage. Check whether the floor plateaus before declaring a leak.

5. **Sorting only by bytes and missing the swarm.** A leak of millions of tiny objects is modest in `inuse_space` but huge in `inuse_objects`. Check *both* — the swarm is often the one wrecking GC pauses.

6. **Including weak/soft references in the retention path.** Weak and soft references don't keep objects alive, so paths through them aren't real leaks. In MAT, **exclude weak/soft** when computing Path to GC Roots, or you'll chase a non-bug.

7. **Trusting "Leak Suspects" without verifying the path.** MAT's automated report is a great first pointer, but it reports the *dominant retainer*, which for a legitimate large cache is a false alarm. Always confirm with the path and the diff.

---

## Test Yourself

1. A `HashMap` shows shallow size 48 bytes and retained size 1.2 GB. Explain the gap, and which number identifies it as worth investigating.
2. Define "A dominates B" in heap terms. Why does a large array referenced by *two* roots belong to neither root's retained set?
3. You've found the object retaining 60% of the heap. What's the *next* thing you look at, and why isn't retained size enough to write a fix?
4. When would `inuse_objects` reveal a leak that `inuse_space` hides?
5. Why must you force a GC *before* each snapshot in a two-snapshot diff? What false conclusion does skipping it produce?
6. The heap sawtooths between 400 MB and 1.2 GB and the peaks aren't growing. Is this a leak? What single measurement decides it?
7. Name three common retention bugs and, for each, the link you'd expect to see in the path to the GC root.

<details>
<summary>Answers</summary>

1. Shallow = the map object's own fields only (table pointer, count); retained = the map plus everything reachable *only* through it (table, nodes, keys, values). The **retained** size (1.2 GB) flags it: freeing this one object would reclaim 1.2 GB, so it's the owner worth investigating.
2. A dominates B if *every* path from a GC root to B passes through A — so removing A makes B unreachable. An array referenced by two roots has a root-path that avoids each one individually, so *neither* dominates it; killing one frees nothing because the other still reaches it. It's dominated by a node *all* paths share (higher up the tree).
3. The **Path to GC Roots** (the retention path). Retained size says *how much* leaks but not *why it's reachable*; the fix requires severing the specific reference in the path (a static field, an un-removed listener, a captured closure), which only the path reveals.
4. When the leak is millions of *small* objects — e.g. a `map`/slice accumulating tiny structs. Total bytes may look unremarkable in `inuse_space`, but the object *count* spikes in `inuse_objects`, exposing the swarm (which also crushes GC pause times).
5. Forcing GC collects everything that *should* die, so the snapshot reflects the genuinely *retained* (post-collection) heap. Skipping it makes you compare heaps full of in-flight garbage, so you "find" megabytes of leaks that the next collection would reclaim — a false positive.
6. **Not a leak** — flat peaks with a healthy sawtooth is normal collection. The deciding measurement is the **post-GC live floor over time**: if the floor (live size right after a collection) is flat/plateauing, it's healthy; only a monotonically rising floor is a leak.
7. (a) **Unbounded cache/map** → a static/long-lived field holding a map with no eviction. (b) **Listener/observer not unregistered** → the subject's listener list/slice holding your object. (c) **Goroutine/thread holding a reference** (or a **ThreadLocal**) → a live thread's stack or thread-local map reaching your object, with the thread/goroutine itself as the root.

</details>

---

## Cheat Sheet

```
THE TWO SIZES (sort by RETAINED, not shallow)
  shallow   = object's own bytes (a giant map is tiny here)
  retained  = object + all it dominates = what dies WITH it  ← the leak's bill

DOMINATOR TREE
  A dominates B  = every root→B path goes through A  (kill A ⇒ B dies)
  retained set   = the subtree A dominates
  drill: follow the largest retained child down until bytes are justified

PATH TO GC ROOTS  (the actual bug report)
  roots: stack locals, statics/package vars, live threads/goroutines, JNI, thread-locals
  read leaking-object → ... → ROOT ; the surprising link IS the bug
  MAT: Path to GC Roots → EXCLUDE weak/soft   (weak/soft don't retain)

GO / FEW-vs-MANY
  inuse_space    live BYTES by site   → few big objects (the whale)
  inuse_objects  live COUNT by site   → many small objects (the swarm) ← check both!

TWO-SNAPSHOT DIFF (the only reliable leak finder)
  GC → snap A → run N ops → GC → snap B → diff(B−A) ; what grew ~N = suspect
  MAT     : Compare Basket (A,B)         columns: Δ retained, Δ instances
  DevTools: Comparison view              columns: #New #Deleted #Delta SizeΔ
  Go      : pprof -diff_base=A.pb.gz B.pb.gz   then `top`, `list`, `web`
  Python  : snapB.compare_to(snapA,'lineno')

LEAK vs CACHE vs "GC HASN'T RUN"
  leak   = post-GC FLOOR rises without bound
  cache  = floor rises then PLATEAUS (bounded, has eviction)
  noise  = high PEAKS but flat floor (healthy sawtooth — force GC, compare floors)
```

---

## Summary

- Heap tools show two sizes; sort by **retained**, not **shallow**. Shallow is the object's own bytes (a million-entry map is tiny); retained is everything that dies *with* it — the leak's true cost. The culprit is almost always a small-shallow, huge-retained node.
- Retained size is read off the **dominator tree**: A dominates B if every root-path to B goes through A, so A's retained set is the subtree it owns. "Find the leak" = walk down the largest retained child until the bytes are justified.
- Retained size says *how much*; the **path to a GC root** says *why* — the chain from the object up to a static field, live thread, or listener list. That path contains the one reference a fix must cut, so always end the analysis on a root.
- Check **both** `inuse_space` (few big — the whale) and `inuse_objects` (many small — the swarm); a leak of millions of tiny objects hides in bytes but screams in count.
- A single snapshot describes; **two snapshots diffed** accuse. Bracket a repeatable workload with **GC-forced** captures and diff them — what grew by ~N is the suspect, with almost no judgement required.
- A leak is **unbounded post-GC floor growth**, not high usage. Rule out the healthy sawtooth (peaks rise and fall) and the bounded cache (floor plateaus) before declaring one.

---

## Further Reading

- *Eclipse MAT documentation* — "Dominator Tree," "Path to GC Roots," and the "Leak Suspects" report; the canonical mental model for retained-heap analysis.
- *Java Performance* (Scott Oaks) — heap dumps, live-set analysis, and reading retained size in practice.
- `runtime/pprof` and `net/http/pprof` package docs — Go's heap profile, `inuse_space` vs `inuse_objects`, and `-diff_base`.
- Chrome DevTools — *Memory* panel docs: heap snapshots, the Retainers panel, and Comparison view (incl. detached-DOM leaks).
- Python `tracemalloc` docs — `take_snapshot`, `compare_to`, and per-line attribution.

---

## Related Topics

- [junior.md](junior.md) — capturing a heap snapshot and reading "what's big" in each runtime.
- [senior.md](senior.md) — production heap-dump capture, automated leak detection, and analyzing dumps at scale.
- [03 — Allocation Profiling](../03-allocation-profiling/middle.md) — the *rate* side: who churns the allocator and the GC (vs. this page's *retained* side).
- [05 — Memory & Allocation Optimization](../../05-memory-and-allocation-profiling/middle.md) — what to *do* once you know what's retained: pooling, layout, escape, bounding caches.
