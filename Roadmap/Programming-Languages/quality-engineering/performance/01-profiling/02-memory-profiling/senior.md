# Memory Profiling — Senior Level

> **Roadmap:** [Profiling](../README.md) → Memory Profiling
> *The middle page taught you to read a heap snapshot — dominator tree, retention path, the two-snapshot diff. This page is about the substrate underneath those views: how the snapshot is actually captured (and what it silently lies about), why a heap with "no leak" still OOMs, and how to analyze a 40 GB dump that won't fit in your laptop's RAM.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [How Heap Profilers Capture — Sampling vs Full Dump](#how-heap-profilers-capture--sampling-vs-full-dump)
4. [Reading a Sampled Heap Profile Without Lying to Yourself](#reading-a-sampled-heap-profile-without-lying-to-yourself)
5. [The Dominator Tree, Mechanically — Lengauer–Tarjan and Retained Size](#the-dominator-tree-mechanically--lengauertarjan-and-retained-size)
6. [RSS vs Heap vs Live-Set — and the Off-Heap Blind Spot](#rss-vs-heap-vs-live-set--and-the-off-heap-blind-spot)
7. [Native Memory Tracking — Finding the OOM the Heap Dump Can't See](#native-memory-tracking--finding-the-oom-the-heap-dump-cant-see)
8. [Reference Strength — How Weak/Soft/Phantom Change Retention](#reference-strength--how-weaksoftphantom-change-retention)
9. [Analyzing Huge Dumps — MAT Headless, OQL, jhsdb](#analyzing-huge-dumps--mat-headless-oql-jhsdb)
10. [Leak Archetypes at Scale and How Each Looks](#leak-archetypes-at-scale-and-how-each-looks)
11. [Capturing Dumps in Production Safely](#capturing-dumps-in-production-safely)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The internals and hard cases of heap-retention analysis — how the data is captured, what it omits, and how to work at production scale.**

By the middle level you can name the leaking object and the line that holds it. That handles the leaks that *show up in the heap*. The senior cases are the ones that don't, or can't be read naively:

- The profile is **sampled**, not exhaustive — Go records roughly one allocation in every 512 KB and scales the rest up statistically. Read it as ground truth and you'll chase phantom 4 KB "objects" that are really one sample standing in for a megabyte.
- The process is using 6 GB of RSS, the Java heap dump shows 1.2 GB live, and there is **no Java leak** — because the other 4.8 GB is off-heap: `DirectByteBuffer`, a Netty pool, an mmap'd file, a JNI allocation. The heap dump is structurally blind to all of it.
- The dump is **40 GB** and Eclipse MAT's parser needs more memory than the machine has. You can't just "open it."
- The leak is held by a **weak reference** — except it isn't, because something promoted it to a strong one, and the retention path you'd normally trust is misleading.

To handle these you need a layer below "read the dominator tree": the *capture mechanism* (sampling math, STW dump cost, JFR's old-object sampling), the *dominator algorithm* itself (Lengauer–Tarjan and what retained size formally computes), the *memory accounting* that separates heap from RSS, and the *operational craft* of capturing and parsing dumps in production without taking the service down. This page is that layer. It stays strictly on **retention** — what is alive and what holds it. Allocation *rate* (who churns the GC) is [Allocation Profiling](../03-allocation-profiling/senior.md); what to *do* once you know what's retained is [Memory & Allocation Optimization](../../05-memory-and-allocation-profiling/senior.md).

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — dominator tree, retained size, path to GC roots, the two-snapshot diff.
- **Required:** A working model of a tracing GC: roots, reachability, mark phase, and that "live" means "reachable from a root."
- **Helpful:** You've operated a JVM or Go service in production and seen an OOM kill that didn't match what the heap dump showed.
- **Helpful:** Comfort with the idea that virtual memory (what the heap reports) and resident memory (RSS, what the kernel charges you) are different numbers that diverge for real reasons.

---

## How Heap Profilers Capture — Sampling vs Full Dump

There are two fundamentally different capture strategies, and they trade *fidelity* against *overhead* in opposite directions. Knowing which one you're holding changes how you read it.

### Go — the sampled heap profiler

Go does **not** record every allocation. It samples. The runtime maintains `MemProfileRate` (default **524288**, i.e. 512 KB): on average, it records a stack trace once per that many bytes allocated. The sampling is over *bytes*, not *objects* — a 10 MB allocation is far more likely to be sampled than a 16-byte one, and each recorded sample carries a scaling weight so the profiler can reconstruct the true totals.

```go
// runtime sets this; you can change it BEFORE any allocation matters
runtime.MemProfileRate = 512 * 1024 // default: 1 sample per ~512 KB allocated
// 1  → profile EVERY allocation (huge overhead; only for tiny repros)
// 0  → disable heap profiling entirely
```

The profile records four series, and the inuse/alloc split is the one that matters for retention:

- **`inuse_space` / `inuse_objects`** — bytes/objects *currently live* (sampled allocations whose memory the last GC did not reclaim). This is the retention view.
- **`alloc_space` / `alloc_objects`** — *cumulative* bytes/objects ever allocated. This is the rate view ([Allocation Profiling](../03-allocation-profiling/senior.md)).

The reported numbers are **already scaled back up** from the samples. When pprof says `inuse_space` is 195 MB, that is its statistical *estimate* of live bytes, extrapolated from the sampled subset using each sample's weight — not a count of bytes it literally walked. This is why Go heap profiling is cheap enough to leave on in production: the cost is a stack capture every ~512 KB of allocation, not per allocation.

```bash
go tool pprof -inuse_space  http://localhost:6060/debug/pprof/heap   # live, scaled estimate
go tool pprof -sample_index=inuse_objects http://localhost:6060/debug/pprof/heap
```

### Java — the full heap dump

A `.hprof` is the opposite: an **exhaustive, exact** serialization of *every* live object, its fields, and its references. There is no sampling and no estimation. That fidelity has a price:

1. **It stops the world.** `jmap -dump:live` (and `HeapDumpOnOutOfMemoryError`) triggers a **full STW GC first** (so the dump contains only reachable objects), then walks the entire live heap and writes it out. The application is paused for the duration.
2. **The pause scales with live-set size.** Writing 20 GB of live objects to disk is gated by serialization and disk throughput — frequently **tens of seconds**, sometimes minutes, on a large heap. For a latency-sensitive service this is an outage-class pause.
3. **The file is roughly heap-sized.** A 30 GB live heap produces a ~30 GB `.hprof`. Parsing it later (next sections) needs its own large machine.

```bash
jmap -dump:live,format=b,file=/var/tmp/heap.hprof <pid>   # STW GC, then exact dump
jcmd <pid> GC.heap_dump -all=false /var/tmp/heap.hprof    # -all=false ⇒ live only (GC first)
```

### JFR — low-overhead leak detection without the full dump

There is a third option that sits between them: **JDK Flight Recorder's `OldObjectSample` event**. Instead of dumping everything or sampling allocation rate, JFR tracks a bounded set of sampled objects that have *survived* (made it to the old generation) and, crucially, records the **allocation stack trace and the path to GC root** for those survivors — the two things you need to diagnose a leak — at a fraction of a percent overhead, continuously, in production.

```bash
# leak-profile preset: keep OldObjectSample with stack traces + reference chains
java -XX:StartFlightRecording=settings=profile,name=leak,filename=leak.jfr,dumponexit=true ...
jcmd <pid> JFR.dump name=leak filename=leak.jfr
jfr print --events jdk.OldObjectSample leak.jfr     # survivors + alloc site + root path
```

The trade is fidelity for cost: JFR shows you a *sample* of leaked survivors with their retention chains, not the whole heap, but it does so with overhead low enough to run permanently. The full `.hprof` shows you everything but only as an expensive snapshot.

> **Key insight:** Three capture strategies, three trade-offs. **Go sampling** — cheap, statistical, always-on, estimates totals. **`.hprof`** — exact and complete, but STW-pauses the JVM for seconds-to-minutes proportional to live-set and produces a heap-sized file. **JFR `OldObjectSample`** — a sampled middle ground that records survivors *with* their root paths at sub-percent overhead. Match the tool to whether you can afford a pause and whether you need every object or just the leakers.

---

## Reading a Sampled Heap Profile Without Lying to Yourself

Because Go's profile is sampled, several intuitions from "exact" tooling are wrong, and senior engineers get burned by them.

**The numbers are estimates with sampling error.** A site reported as holding 8 MB might truly hold anywhere in a band around it; for *large* retainers the relative error is small (many samples landed in them), but for *small* ones it can be large or the site may not appear at all. A 200 KB live structure might be represented by *zero* samples and be invisible — fine when you're hunting a leak (leaks grow large), dangerous if you conclude "nothing else is live."

**Don't over-read a single object's size.** When `list` annotates a line with `512KB`, that frequently means *one sample* landed there and got scaled to the rate. It is not "this line allocated exactly 512 KB." Trust *aggregates over many samples* (a site that's 80% of the heap across thousands of samples) and distrust precise-looking small numbers.

**For a tiny reproduction, lower the rate.** When you're trying to catch a small leak in a unit test or micro-repro, the default rate samples too coarsely to see it. Set `runtime.MemProfileRate = 1` to record every allocation — exact, but only viable for small programs because the overhead is large.

```go
func TestNoLeak(t *testing.T) {
    old := runtime.MemProfileRate
    runtime.MemProfileRate = 1 // exact accounting for this test
    defer func() { runtime.MemProfileRate = old }()
    // ... run the operation, force GC, WriteHeapProfile, assert no growth ...
}
```

**The diff cancels the bias.** The single most important consequence: when you **diff two sampled profiles** (`-diff_base`), the sampling bias is largely *common to both* and cancels. A site that grew by 40 MB across the two captures grew by ~40 MB regardless of the sampling rate, because both snapshots sampled at the same rate. This is *why* the two-snapshot diff is so reliable on sampled data — you're comparing like with like, and the statistical noise is correlated out.

> **Key insight:** A sampled heap profile is a *statistical estimate*, not a census. Trust large aggregates, distrust precise small numbers, lower `MemProfileRate` for tiny repros, and prefer the **diff** — because sampling bias is shared between the two snapshots and cancels, the *delta* is far more trustworthy than either absolute number alone.

---

## The Dominator Tree, Mechanically — Lengauer–Tarjan and Retained Size

The middle page used the dominator tree as a tool. A senior should know what computes it and why retained size is exact, because that understanding tells you precisely what the number does and does not mean.

**The definition, restated as a graph problem.** Model the heap as a directed graph: nodes are objects, edges are references, plus a single synthetic *root* node with an edge to every GC root. Node **A dominates** node **B** if *every* path from the root to B passes through A. Every node except the root has a unique **immediate dominator** (idom) — its closest strict dominator — and linking each node to its idom yields the **dominator tree**. An object's **retained set** is exactly the set of nodes it dominates (its subtree in the dominator tree); its **retained size** is the total shallow size of that subtree. That is why retained size is *exact and well-defined* even in a cyclic, tangled graph: it's a structural property of the dominator tree, not a heuristic.

**Why the shared-array case falls out for free.** A large array referenced by two independent roots is dominated by *neither* — there's a root-path to it that avoids each one — so in the dominator tree it hangs higher up, under the nearest node common to *all* paths (in the limit, the synthetic root). Killing one referrer frees nothing. The dominator tree encodes this automatically; you don't special-case it.

**The algorithm.** Eclipse MAT (and most heap analyzers) compute dominators with the **Lengauer–Tarjan algorithm**, which runs in near-linear time — `O(E · α(E, V))`, where α is the inverse Ackermann function (effectively constant). This near-linearity is *why MAT can dominator-analyze a graph of hundreds of millions of objects at all*; a naive `O(V·E)` dominator computation would never finish on a real heap. The expensive part of opening a dump is parsing it and building this tree; once built, retained-size queries and "follow the largest retained child" navigation are cheap lookups.

```
Heap graph (→ = reference)              Dominator tree (parent = immediate dominator)
   root → A → C                            root
   root → B → C                            ├── A
                                           ├── B
   C reachable via A AND via B             └── C     ← C's idom is root, not A or B
   ⇒ neither A nor B dominates C           (so C is in NEITHER A's nor B's retained set)
```

> **Key insight:** Retained size is not an estimate or a heuristic — it is the exact total of the subtree an object dominates in the dominator tree, computed by Lengauer–Tarjan in near-linear time. That algorithm's efficiency is the reason heap analyzers can compute retained sizes on hundred-million-object graphs, and its definition is the reason a multiply-referenced object correctly counts toward *no* single referrer's retained set.

---

## RSS vs Heap vs Live-Set — and the Off-Heap Blind Spot

This is the section that separates engineers who can diagnose production OOMs from those who stare at a heap dump that says everything is fine. There are three different numbers, they diverge for real reasons, and **a heap dump only sees one of them.**

- **Live-set** — the bytes of *reachable objects* (what a `.hprof` or `inuse_space` measures). The smallest of the three.
- **Heap** — the memory the *managed allocator* reserves for those objects: live-set **plus** GC slack (free space the collector keeps so it doesn't collect constantly) **plus** fragmentation. The JVM rarely returns this to the OS promptly; Go's runtime returns it lazily via `madvise`. Larger than live-set.
- **RSS (resident set size)** — what the **kernel** charges the process: heap **plus** thread stacks, JIT-compiled code (CodeCache), Metaspace/class metadata, the GC's own bookkeeping, the runtime/binary, **and all off-heap/native allocations**. This is the number the OOM killer and the container cgroup limit watch. The largest of the three, and the one that kills you.

The killer divergence is **off-heap memory** — memory allocated *outside* the managed heap, which the GC neither tracks nor reports, and which **no heap dump will ever show**:

| Off-heap source | What it is | Why the heap dump is blind |
|---|---|---|
| **`DirectByteBuffer`** | `ByteBuffer.allocateDirect` — memory via `Unsafe`/`malloc`, outside the heap | The on-heap object is a tiny ~200-byte shell; the real buffer is native |
| **Netty pooled buffers** | Netty's `PooledByteBufAllocator` arenas (direct memory) | Pools hold large native arenas the GC can't see; only a small Java handle is on-heap |
| **mmap'd files** | `FileChannel.map`, RocksDB/Lucene mmap, etc. | Mapped pages count toward RSS but aren't heap objects |
| **JNI / native libs** | `malloc` inside a C/C++ library called via JNI | Entirely outside the JVM's accounting |
| **cgo (Go)** | C allocations across a cgo boundary | Outside Go's GC; invisible to the Go heap profiler |
| **Thread stacks** | ~1 MB per thread × thousands of threads | Native memory, not heap; a thread-leak inflates RSS with a flat heap |

This is the anatomy of the most confusing production memory incident: **"there's no Java leak but the pod keeps OOM-killing."** The heap dump is clean — live-set 1.2 GB, flat across hours. But RSS climbs to the 6 GB cgroup limit and the kernel kills the container. The leak is real; it's just *off-heap* — a `DirectByteBuffer` whose backing native memory is only freed when its tiny on-heap `Cleaner` shell is collected (and if the heap has plenty of room, that GC may not run for a long time), or a Netty pool growing under load, or a thread leak adding 1 MB of native stack per leaked thread. The heap dump can't see any of it, so you must measure RSS *minus* heap and go looking off-heap.

```bash
# the three numbers, side by side, for a JVM:
jcmd <pid> GC.heap_info          # heap: used (≈ live-set after GC) and committed
ps -o rss= -p <pid>              # RSS in KB — what the kernel/cgroup charges
cat /sys/fs/cgroup/memory.current   # cgroup v2: bytes counted against the container limit
# RSS - heap_committed  ≈  off-heap + metaspace + code cache + stacks  ← the blind spot
```

> **Key insight:** Live-set < heap < RSS, and a heap dump only measures live-set. When RSS grows but the heap dump is flat, the leak is **off-heap** — `DirectByteBuffer`, Netty pools, mmap, JNI, cgo, or thread stacks — and *no amount of heap-dump analysis will ever find it* because the dump is structurally blind to native memory. The first question for any OOM is not "what's in the heap?" but "is RSS−heap large and growing?"

---

## Native Memory Tracking — Finding the OOM the Heap Dump Can't See

When the previous section's `RSS − heap` is large and growing, the JVM's own instrument for the off-heap region is **Native Memory Tracking (NMT)**. It attributes the JVM's *native* (non-heap) allocations to categories, turning "4.8 GB is somewhere off-heap" into "3 GB is in Internal/Other (direct buffers), 800 MB in Thread (stacks), 400 MB in Code."

```bash
java -XX:NativeMemoryTracking=summary ...          # ~5–10% footprint overhead; on at startup
# or 'detail' for call-site granularity (more overhead)
jcmd <pid> VM.native_memory summary                # current breakdown
jcmd <pid> VM.native_memory baseline               # mark a baseline...
# ... run load ...
jcmd <pid> VM.native_memory summary.diff           # ...then DIFF — same two-snapshot logic, off-heap
```

A summary names the categories so you know *which kind* of off-heap memory is growing:

```
Total: reserved=8.1GB, committed=6.2GB
-                 Java Heap (reserved=2.0GB, committed=1.3GB)   ← matches the heap dump
-                    Thread (reserved=2.1GB, committed=2.1GB)   ← ~2000 threads × ~1MB stack!
-                      Code (reserved=240MB, committed=140MB)
-                        GC (reserved=180MB, committed=170MB)
-                  Internal (reserved=3.1GB, committed=3.0GB)   ← direct buffers / Unsafe
```

That `Thread` line — 2.1 GB of native thread stacks — is a **thread leak** that a heap dump shows as, at most, a few thousand small `Thread` objects, easy to overlook. The `Internal` line points at direct-buffer / `Unsafe` growth. NMT is how you localize the off-heap leak to a category; from there you pick the right next tool (a direct-buffer audit, a thread-pool review, a Netty `ResourceLeakDetector`).

Two important caveats: NMT tracks the **JVM's own** native allocations, so it sees `DirectByteBuffer` (allocated through `Unsafe`) and thread stacks, but it does **not** see `malloc` inside a third-party JNI `.so` — those are the library's allocations, not the JVM's, and need `jemalloc`/`tcmalloc` profiling or Valgrind/ASan. And `summary` carries a real (~5–10%) footprint cost, so it's an opt-in flag, typically enabled when you already suspect an off-heap problem rather than left on by default.

> **Key insight:** NMT is the heap dump's complement — it accounts for the *native* memory the dump is blind to, broken out by category (Thread, Internal, Code, GC). `VM.native_memory baseline` + `summary.diff` applies the same two-snapshot-diff discipline to off-heap memory, turning "RSS is growing and the heap is flat" into "the Thread category grew 1.4 GB — it's a thread-stack leak." It won't see allocations *inside* a JNI library, though; that needs a native allocator profiler.

---

## Reference Strength — How Weak/Soft/Phantom Change Retention

Not every reference keeps an object alive. The strength of the reference determines whether it participates in retention at all, and this directly changes what your dominator tree and retention paths mean. Getting this wrong produces both false leaks (chasing a weak path that never retains) and false "all clear" verdicts (a weak cache that got promoted to strong).

The four strengths, from strongest to weakest (Java's model; other GCs have analogues):

- **Strong** — the default. Reachable through a strong reference ⇒ never collected. This is what the dominator tree assumes by default and the only kind that genuinely "retains."
- **Soft (`SoftReference`)** — collected **only under memory pressure**, just before `OutOfMemoryError`. Designed for memory-sensitive caches: the value survives while there's room and is dropped when the heap gets tight. A soft reference *can* retain its target for a long time, which makes soft-referenced caches a classic "looks like a leak until OOM forces a collection" pattern.
- **Weak (`WeakReference`)** — collected at the **next GC** once no strong path remains. The basis of `WeakHashMap` and canonicalizing caches. A weak reference does **not** prevent collection, so a path that traverses one is *not* a real leak.
- **Phantom (`PhantomReference`)** — never returns the referent (`get()` is always `null`); enqueued *after* finalization, used to schedule deterministic native-resource cleanup (the modern replacement for `finalize()`; `Cleaner` is built on it).

The consequence for analysis is concrete and is exactly why **MAT's "Path to GC Roots" has an "exclude weak/soft references" option**: when you compute why an object is alive, you must exclude the reference kinds that *don't actually keep it alive*. Include them and MAT will happily show you a "retention path" through a `WeakHashMap`'s key — a path that the next GC would sever, so it's not the leak. The real retaining path is the strong one.

```
Path to GC Roots (INCLUDING weak — misleading):     Path EXCLUDING weak/soft (the real bug):
  leaked → key of WeakHashMap$Entry                   leaked → value of HashMap$Node
   → ... → some WeakHashMap   ← would die at next GC    → ... → static CACHE   ← genuine strong root
```

The senior trap: a `WeakHashMap` or soft cache is supposed to be self-clearing, but a **strong reference elsewhere pins the same object**, so the weak/soft semantics never get a chance to fire. The object looks like it's in a weak cache (so "not a leak"), but it's actually held strongly by something else, and *that* strong path — found by excluding the weak/soft references — is the bug. Always recompute the path with weak/soft excluded before concluding a weak cache is innocent.

> **Key insight:** Only **strong** references retain. Weak/soft/phantom change the rules — weak dies at the next GC, soft only under memory pressure, phantom never retains. When tracing why an object is alive, **exclude weak and soft references** so the path shows the *strong* chain that actually pins it. The classic bug is a "weak cache" entry that a stray *strong* reference elsewhere keeps alive, defeating the weak semantics entirely.

---

## Analyzing Huge Dumps — MAT Headless, OQL, jhsdb

A 30–40 GB `.hprof` will not open in a GUI on your laptop — MAT must parse the entire graph and build the dominator tree, which needs roughly *as much heap as the dump is large*. The senior workflow runs the parse **headless on a big machine** and ships only the small index/report back.

**MAT headless / batch.** MAT ships a command-line parser that builds the indices and generates the standard reports without ever opening a window. Run it on a host with enough RAM, then download the (small) report:

```bash
# give MAT MORE heap than the dump is large (parsing + dominator tree is memory-hungry)
ParseHeapDump.sh /data/heap.hprof \
  org.eclipse.mat.api:suspects \
  org.eclipse.mat.api:overview \
  org.eclipse.mat.api:top_components
# tune in MemoryAnalyzer.ini:  -Xmx48g   for a ~30 GB dump
# emits heap.hprof.zip (Leak Suspects HTML) + .index files — copy these back, not the 30GB dump
```

This produces the **Leak Suspects** report (the automated "one instance of X retains 62%" clustering) as static HTML, plus the parsed indices you can later open interactively against the same dump if needed.

**OQL — query the heap like a database.** For targeted questions, MAT's **Object Query Language** beats manual clicking. It's SQL-shaped over the object graph:

```sql
-- every HashMap retaining more than 100 MB, biggest first
SELECT x, x.@retainedHeapSize
  FROM java.util.HashMap x
 WHERE x.@retainedHeapSize > 104857600
 ORDER BY x.@retainedHeapSize DESC

-- find the suspiciously large collections by internal size field
SELECT x FROM java.util.ArrayList x WHERE x.size > 1000000
```

OQL is how you answer "show me every `ThreadLocalMap` with more than N entries" or "all instances of *my* cache class and their retained sizes" without scrolling a histogram — essential on a huge dump where the GUI is sluggish.

**jhsdb — when you can't even afford to dump.** The Serviceability Agent (`jhsdb`) attaches to a live process (or a core file) and inspects it *without* writing a full `.hprof`. `jhsdb jmap --heap` gives a generational summary; `jhsdb clhsdb` opens an interactive low-level debugger; and you can drive a heap histogram against a **core dump** taken with `gcore`, which decouples the (fast) core capture from the (slow) analysis:

```bash
gcore -o /var/tmp/core <pid>                 # fast OS-level core dump of the process
jhsdb jmap --heap   --core /var/tmp/core --exe $JAVA_HOME/bin/java   # generational summary
jhsdb jmap --histo  --core /var/tmp/core --exe $JAVA_HOME/bin/java   # class histogram, offline
```

This `gcore` → `jhsdb` path is a senior trick for a wedged or latency-critical process: a core dump is a fast page-level copy the kernel can do quickly, and *all* the expensive analysis happens later, offline, against the core — the live process is paused only for the brief copy, not for a multi-minute `.hprof` serialization.

> **Key insight:** You don't "open" a 40 GB dump — you **parse it headless** on a big-RAM host (give MAT more heap than the dump is large), generate the Leak Suspects report and indices, and ship those small artifacts back. Use **OQL** to query the graph like a database instead of clicking, and **`gcore` + `jhsdb`** to decouple a fast core capture from slow offline analysis when you can't afford the STW of a full `.hprof`.

---

## Leak Archetypes at Scale and How Each Looks

At scale, leaks cluster into a handful of archetypes. Each has a *signature* in the tooling — a place it shows up and a path-to-root that fingerprints it. Recognizing the archetype short-circuits the diagnosis.

**1. The classloader leak (the JVM-specific nightmare).** On every redeploy/hot-reload of an app in a container (Tomcat, an app server, a plugin host), a fresh `ClassLoader` loads the new version's classes. The old classloader — and *every class it loaded*, plus all their static fields, plus everything those statics retain — should become garbage. It doesn't, because one stray strong reference from *outside* the classloader pins it: a `ThreadLocal` set by app code on a *container-owned* thread, a JDBC driver registered in a static registry, a shutdown hook, a running timer thread. Since a class strongly references its `ClassLoader`, one pinned class retains the *entire* old application.

- **Signature:** `Metaspace` (class metadata, off-heap) grows on each redeploy and never recovers; after N redeploys you get `OutOfMemoryError: Metaspace`. In a heap dump, you find **multiple instances of the same application class loaded by *different* classloaders** — the smoking gun.
- **Path to root:** the doomed `WebappClassLoader` → some container thread's `ThreadLocalMap` (or a static driver registry). The fix lives at the leak site (clear the `ThreadLocal`, deregister the driver), but the *diagnosis* is "count classloaders per class."

**2. `ThreadLocal` + a thread pool.** A `ThreadLocal` is rooted in the `Thread` object's `threadLocals` map and lives **as long as the thread does**. With a *pool*, threads live for the whole process — so anything you stash in a `ThreadLocal` and forget to `remove()` is retained forever, accumulating across every task that ran on that thread.

- **Signature:** retained set grows with the *number of pool threads × per-thread accumulation*, flat after the pool stops being exercised. Easy to misread as a small leak because each thread holds "only a little."
- **Path to root:** leaked object → `value` of a `ThreadLocalMap$Entry` → `threadLocals` of a live pooled `Thread` (a GC root). The presence of a **live pooled thread** at the root, plus a `ThreadLocalMap` link, fingerprints it. The fix is `try { ... } finally { tl.remove(); }`.

**3. The growing off-heap cache.** A cache backed by direct buffers, an mmap'd store, or a native library (RocksDB, a Caffeine cache configured for off-heap) grows without bound — but **the heap stays flat** because the bytes are off-heap.

- **Signature:** exactly the [RSS vs heap divergence](#rss-vs-heap-vs-live-set--and-the-off-heap-blind-spot) — RSS and `Internal`/native NMT category climb, heap dump is clean, eventually a *native* OOM or cgroup kill (not a Java `OutOfMemoryError: Java heap space`). The heap dump shows only small handle/shell objects.
- **Path to root:** *not in the heap dump.* You localize it with **NMT** (`Internal` growing) or Netty's `ResourceLeakDetector`, not with MAT. This is the archetype that punishes "the heap dump is fine, so there's no leak."

```
Archetype             Where it shows            Root-path fingerprint
classloader leak      Metaspace ↑ per redeploy  WebappClassLoader → container ThreadLocal/driver
ThreadLocal + pool    heap ↑ slowly, flat idle  value → ThreadLocalMap$Entry → live pooled Thread
off-heap cache        RSS ↑, HEAP FLAT          (none in heap dump) → NMT Internal / Netty detector
```

> **Key insight:** Leaks have *archetypes*, and each has a tell. **Classloader leak** → duplicate classes across classloaders + Metaspace growth, rooted in a container thread's `ThreadLocal` or a static registry. **`ThreadLocal` + pool** → a `ThreadLocalMap$Entry` rooted in a long-lived pooled thread. **Off-heap cache** → RSS climbs while the heap dump stays flat, diagnosable only via NMT, never MAT. Recognizing the archetype tells you *which tool* to even reach for.

---

## Capturing Dumps in Production Safely

The hardest part is often not the analysis but getting a faithful dump *without causing the very outage you're investigating*. The dump itself is expensive: a full STW GC plus serializing the entire live heap, frequently tens of seconds of pause on a large heap.

**`-XX:+HeapDumpOnOutOfMemoryError` — the one flag to always set.** It dumps automatically *at the moment of OOM*, capturing the heap in its failing state — exactly when you most want it and least likely to reproduce on demand. Pair it with an explicit path on a volume with enough room (the file is heap-sized) and, ideally, a path generator so a crash-loop doesn't overwrite the first (most informative) dump:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/dumps/heap-%p.hprof     # %p = pid, avoids clobbering across restarts
-XX:+ExitOnOutOfMemoryError                    # in k8s, die so the orchestrator restarts cleanly
```

Two operational gotchas that bite teams: (1) the dump-on-OOM **also pauses while it writes the heap-sized file**, so the failing pod is unresponsive for that window — size readiness/liveness probe timeouts accordingly or the orchestrator may kill it mid-dump and you lose the file. (2) The volume needs **free space ≥ the heap size**; a 24 GB heap needs 24 GB free, or the dump silently fails and you're left with nothing.

**On-demand capture from a healthy-but-suspicious process** — choose by how much pause you can afford:

```bash
jcmd <pid> GC.heap_dump -all=false /var/dumps/heap.hprof   # live only (STW GC first) — preferred
gcore -o /var/dumps/core <pid>                             # fast page-copy; analyze offline (jhsdb)
```

`gcore` is the low-pause option when you cannot afford a multi-second `.hprof` serialization on a latency-critical instance: the kernel copies pages quickly and you do the slow `.hprof`-equivalent analysis later against the core with `jhsdb`. For Go, the analogue is cheap and online — `net/http/pprof` serves a live heap profile with negligible pause because it's *sampled*, so production Go services typically just expose `/debug/pprof/heap` and skip the heavyweight-dump problem entirely.

**Don't dump the only healthy replica.** Capture from a canary or a replica you can afford to pause, drain it from the load balancer first if the pause would breach SLOs, and never trigger a serial dump across every instance at once (you'll pause the whole fleet simultaneously).

> **Key insight:** Always run with `-XX:+HeapDumpOnOutOfMemoryError` (with a `%p` path on a volume ≥ heap size) so the one dump you can't reproduce — the OOM itself — is captured automatically. For on-demand capture, the cost is a full STW GC plus a heap-sized serialization (tens of seconds): drain the instance first, prefer a canary, and use **`gcore`** when you need a fast page-copy and can defer analysis offline. Go sidesteps most of this because its heap profile is sampled and cheap.

---

## Mental Models

- **The profiler's lens has a resolution.** A Go heap profile is a *sampled estimate* (≈1 per 512 KB); a `.hprof` is an *exact census* bought with a multi-second STW pause; JFR `OldObjectSample` is a *cheap sample of survivors* with their root paths. You are never looking at "the heap" — you're looking at the heap *through one of these lenses*, and each distorts differently.

- **Retained size is a theorem, not a guess.** It's the exact weight of the subtree an object dominates in the dominator tree, computed by Lengauer–Tarjan in near-linear time. That's why a multiply-referenced object counts toward *no* single referrer, and why the number is trustworthy even on a tangled graph.

- **Three numbers, nested, and the dump sees only the innermost.** live-set ⊂ heap ⊂ RSS. The heap dump measures live-set; the OOM killer watches RSS. The gap between them — GC slack, Metaspace, code cache, stacks, and *off-heap* — is invisible to the dump, which is why a clean heap dump and an OOM are perfectly compatible.

- **A reference is only a leak if it's strong.** Weak dies next GC, soft dies under pressure, phantom never retains. Trace retention with weak/soft *excluded* — and beware the weak cache secretly pinned by a stray strong reference.

- **Decouple the expensive capture from the expensive analysis.** A `gcore` is a fast page-copy; the slow part (parsing, dominator tree) happens later, offline, on a big-RAM host. Pausing the process for the copy, not for the analysis, is how you investigate a latency-critical service without making the incident worse.

---

## Common Mistakes

1. **Reading a sampled profile as exact.** A `512KB` annotation often means *one scaled sample*, not a literal allocation. Trust large aggregates, distrust precise small numbers, and lower `MemProfileRate` (→1) only for tiny repros. Prefer the **diff**, where sampling bias cancels.

2. **Concluding "no leak" from a clean heap dump.** The dump sees only live-set. If RSS is climbing while the heap is flat, the leak is **off-heap** (direct buffers, Netty pools, mmap, JNI, cgo, thread stacks) — invisible to MAT by construction. Check `RSS − heap` and reach for NMT.

3. **Forgetting NMT only sees the JVM's own native allocations.** It tracks direct buffers and thread stacks but **not** `malloc` inside a third-party JNI `.so`. A growing native library needs `jemalloc`/`tcmalloc` profiling or ASan, not `VM.native_memory`.

4. **Trusting a retention path that runs through a weak/soft reference.** Those don't retain, so the path isn't the leak. Always recompute **Path to GC Roots with weak/soft excluded** — and check whether a "weak cache" is actually pinned by a stray *strong* reference elsewhere.

5. **Trying to open a 40 GB dump in the GUI.** It needs ~as much heap as the dump is large. Parse it **headless** on a big-RAM host, generate Leak Suspects + indices, and ship the small artifacts back; use **OQL** for targeted queries.

6. **Dumping a latency-critical instance with `jmap` during an incident.** A full `.hprof` is a multi-second-to-minutes STW serialization. Drain the instance first, use a canary, or take a fast **`gcore`** and analyze it offline with `jhsdb`.

7. **Not setting `-XX:+HeapDumpOnOutOfMemoryError`, or pointing it at a too-small volume.** The OOM is the dump you can't reproduce; capture it automatically — but the file is heap-sized, so the volume needs free space ≥ heap or the dump silently fails.

8. **Mistaking a Metaspace OOM for a heap leak.** `OutOfMemoryError: Metaspace` after repeated redeploys is a **classloader leak** (class metadata is off-heap). The diagnosis is "duplicate classes across classloaders," not a heap-object hunt.

---

## Test Yourself

1. Go's heap profiler samples at ~1 per 512 KB and scales the results. Given that, which single number do you trust most — an absolute `inuse_space` total, one object's reported size, or a `-diff_base` delta — and why?
2. A `.hprof` is exact while Go's profile is sampled. Name the two costs of that exactness, and how JFR's `OldObjectSample` splits the difference.
3. Define "A dominates B" via the synthetic-root graph, and explain why an array referenced by two roots is in neither root's retained set. What algorithm computes this, and why does its complexity matter at scale?
4. A pod is OOM-killed at a 6 GB cgroup limit, but the heap dump shows 1.2 GB live and flat. List three off-heap sources that could account for the missing ~4.8 GB, and the tool you'd use to localize it.
5. NMT's `summary.diff` shows the `Thread` category grew 1.4 GB while the heap is flat. What's the bug, and why does it barely register in a heap dump?
6. Why does MAT offer "Path to GC Roots → exclude weak/soft," and what false conclusion do you reach if you forget to use it on a `WeakHashMap`-backed cache?
7. You must analyze a 35 GB `.hprof` and your laptop has 16 GB RAM. Outline the workflow. How would `gcore` + `jhsdb` change your approach if you also couldn't afford the STW to produce the `.hprof` in the first place?
8. Distinguish the three leak archetypes (classloader, `ThreadLocal`+pool, off-heap cache) by where each shows up and the link you'd expect at the GC root.

<details>
<summary>Answers</summary>

1. The **`-diff_base` delta**. Both snapshots sample at the same rate, so the sampling bias is *common to both and cancels* — a 40 MB growth is ~40 MB regardless of rate. A single absolute total is a scaled estimate (good for large retainers, noisy for small), and one object's reported size is often a single scaled sample, the least trustworthy of the three.
2. (a) A **full STW GC + serialization of the entire live heap** — tens of seconds to minutes of pause, scaling with live-set. (b) A **heap-sized file** that then needs a big-RAM host to parse. **JFR `OldObjectSample`** records a *sample* of surviving (old-gen) objects *with* their allocation stack and path to GC root, at sub-percent overhead — the leak-relevant subset, continuously, without the STW dump or the giant file.
3. Add a synthetic root with an edge to every GC root; **A dominates B** if every path from that root to B passes through A. An array referenced by two roots has a root-path avoiding each one individually, so neither dominates it — it hangs under the nearest node common to *all* paths (the synthetic root in the limit), counting toward *neither* referrer's retained set. **Lengauer–Tarjan** computes the dominator tree in near-linear `O(E·α(E,V))`; that near-linearity is what makes dominator analysis tractable on hundred-million-object heaps.
4. Any three of: **`DirectByteBuffer`** backing memory, **Netty pooled (direct) arenas**, **mmap'd files**, **JNI `malloc`**, **cgo** (Go), **thread stacks** (~1 MB each). Localize with **Native Memory Tracking** (`VM.native_memory summary`/`baseline`/`summary.diff`) for JVM-native allocations; for a JNI library specifically, a native allocator profiler (`jemalloc`/`tcmalloc`).
5. A **thread leak** — ~1.4 GB of native thread stacks means ~1400+ leaked threads (≈1 MB stack each), typically an unbounded or never-shutdown executor. A heap dump shows only a few thousand small `Thread` objects (easy to overlook) because the *stacks* are native memory, not heap objects — which is exactly what NMT's `Thread` category measures and the dump can't.
6. Because **weak and soft references don't keep their target alive** (weak dies next GC, soft under pressure), so a retention path through them isn't a real leak. If you forget to exclude them on a `WeakHashMap` cache, you'll "find" a retention path through a weak key and either chase a non-bug or wrongly conclude the cache is the leak — when the real bug is a *strong* reference elsewhere pinning the same object, which only the weak/soft-excluded path reveals.
7. Parse the dump **headless** on a big-RAM host: run MAT's `ParseHeapDump.sh` with `-Xmx` larger than 35 GB (e.g. 48 GB), generate the `suspects`/`overview` reports and `.index` files, and copy those small artifacts back to the laptop (open interactively against the indices if needed); use **OQL** for targeted queries. If you also can't afford the STW to produce the `.hprof`, take a fast **`gcore`** of the process (a quick page-level copy), then run `jhsdb jmap --histo --core core --exe java` offline — decoupling the brief capture pause from the slow analysis.
8. **Classloader leak** → shows in **Metaspace** (grows per redeploy, never recovers; eventual `OOM: Metaspace`); dump has **duplicate classes across different classloaders**; root path is `WebappClassLoader` → a container thread's `ThreadLocal` or a static registry. **`ThreadLocal` + pool** → heap grows slowly, flat when idle; root path is `value` → `ThreadLocalMap$Entry` → a **live pooled `Thread`**. **Off-heap cache** → **RSS climbs while the heap dump stays flat**; *not in the dump at all* — localized via NMT (`Internal`) or Netty's leak detector.

</details>

---

## Cheat Sheet

```
CAPTURE MECHANISMS (match tool to overhead / fidelity)
  Go sampled     MemProfileRate=512KB default; numbers are SCALED estimates; cheap, always-on
                 inuse_space/objects = live (retention);  alloc_* = cumulative (rate)
                 MemProfileRate=1 → exact (tiny repros only);  =0 → off
  Java .hprof    EXACT + complete; STW full-GC then serialize whole live heap (secs–mins); file ≈ heap
  JFR            OldObjectSample = survivors + alloc stack + path-to-root, sub-% overhead, continuous
                 -XX:StartFlightRecording=settings=profile  →  jfr print --events jdk.OldObjectSample

READING SAMPLED DATA
  trust LARGE aggregates;  distrust precise SMALL numbers (often 1 scaled sample)
  prefer -diff_base: sampling bias is shared between snapshots and CANCELS

DOMINATOR TREE (exact, not a guess)
  A dominates B = every (synthetic-root → B) path goes through A;  retained = subtree A dominates
  computed by LENGAUER–TARJAN, ~O(E·α) near-linear → tractable on 10^8 objects
  array referenced by 2 roots ⇒ in NEITHER root's retained set

THREE NUMBERS (dump sees only the first)
  live-set  ⊂  heap (live + GC slack + frag)  ⊂  RSS (heap + metaspace + code + stacks + OFF-HEAP)
  RSS climbs, heap dump FLAT  ⇒  OFF-HEAP leak (dump is blind)
  off-heap: DirectByteBuffer, Netty pools, mmap, JNI, cgo, thread stacks
  jcmd <pid> GC.heap_info ; ps -o rss= -p <pid> ; cat /sys/fs/cgroup/memory.current

NATIVE MEMORY TRACKING (the off-heap instrument)
  -XX:NativeMemoryTracking=summary           (~5–10% footprint; opt-in)
  jcmd <pid> VM.native_memory baseline → run → summary.diff   (two-snapshot diff, off-heap)
  categories: Java Heap | Thread (stacks) | Internal (direct/Unsafe) | Code | GC
  does NOT see malloc inside a JNI .so → use jemalloc/tcmalloc/ASan

REFERENCE STRENGTH (only STRONG retains)
  strong  never collected      | soft  collected under memory pressure (caches)
  weak    collected next GC     | phantom never returns referent (Cleaner / native cleanup)
  MAT: Path to GC Roots → EXCLUDE weak/soft  → shows the real STRONG pin

HUGE DUMPS
  ParseHeapDump.sh heap.hprof org.eclipse.mat.api:suspects   (-Xmx > dump size, headless)
  OQL:  SELECT x, x.@retainedHeapSize FROM <Class> x WHERE x.@retainedHeapSize > N ORDER BY ... DESC
  gcore -o core <pid>  →  jhsdb jmap --histo --core core --exe java   (fast capture, offline analysis)

PROD CAPTURE (safely)
  -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/dumps/heap-%p.hprof   (vol free ≥ heap!)
  on-demand: jcmd <pid> GC.heap_dump -all=false f.hprof   (STW) | gcore (low-pause, defer analysis)
  drain/canary first; never serial-dump the whole fleet at once

LEAK ARCHETYPES (where it shows | root-path tell)
  classloader     Metaspace ↑ per redeploy | dup classes / WebappClassLoader → container ThreadLocal
  ThreadLocal+pool heap ↑ slow, flat idle  | value → ThreadLocalMap$Entry → live pooled Thread
  off-heap cache  RSS ↑, HEAP FLAT         | not in dump → NMT Internal / Netty ResourceLeakDetector
```

---

## Summary

- Heap data arrives through one of three **capture mechanisms**, each with a different fidelity/overhead trade: Go's **sampled** profiler (≈1 per 512 KB, numbers scaled, cheap and always-on), Java's **exact `.hprof`** (complete, but a multi-second STW GC + heap-sized serialization), and **JFR `OldObjectSample`** (a sub-percent-overhead sample of *survivors* with their root paths). You read the heap *through* a lens, never directly.
- A sampled profile is a **statistical estimate** — trust large aggregates, distrust precise small numbers, and prefer the **diff**, because sampling bias is shared across both snapshots and cancels.
- **Retained size** is exact: the weight of the subtree an object dominates in the **dominator tree**, computed by **Lengauer–Tarjan** in near-linear time — which is why it's trustworthy on tangled, hundred-million-object graphs and why a multiply-referenced object counts toward no single referrer.
- **live-set ⊂ heap ⊂ RSS**, and a heap dump only measures live-set. When RSS grows but the heap is flat, the leak is **off-heap** (direct buffers, Netty pools, mmap, JNI, cgo, thread stacks) — *structurally invisible* to the dump. **NMT** is the complementary instrument, with `baseline`/`summary.diff` applying the two-snapshot discipline off-heap (but it can't see `malloc` inside a JNI library).
- Only **strong** references retain; weak/soft/phantom don't. Trace retention with **weak/soft excluded**, and watch for a weak cache secretly pinned by a stray strong reference.
- At production scale: **parse huge dumps headless** (MAT `ParseHeapDump.sh`, more heap than the dump is large) and query with **OQL**; decouple capture from analysis with **`gcore` + `jhsdb`**; always set **`-XX:+HeapDumpOnOutOfMemoryError`** (volume ≥ heap); and recognize the **archetypes** — classloader (Metaspace + duplicate classes), `ThreadLocal`+pool (entry rooted in a live pooled thread), and off-heap cache (RSS up, heap flat) — because each tells you *which tool* to reach for.

You now understand not just how to read a heap snapshot but how it was captured, what it omits, and how to operate it at scale. The next layer — [professional.md](professional.md) — is about institutionalizing this: leak-detection in CI, memory SLOs and budgets, and standing up the capture/analysis pipeline across a fleet.

---

## Further Reading

- *The Garbage Collection Handbook* (Jones, Hosking, Moss) — reachability, tracing, reference strengths, and what "live" formally means across collector designs.
- Lengauer & Tarjan, *A Fast Algorithm for Finding Dominators in a Flowgraph* — the algorithm Eclipse MAT uses to compute the dominator tree and retained sizes.
- *Eclipse MAT documentation* — the headless `ParseHeapDump.sh` parser, OQL reference, dominator tree, and Path to GC Roots (with weak/soft exclusion).
- [JEP 331: Low-Overhead Heap Profiling](https://openjdk.org/jeps/331) and the JFR `OldObjectSample` event docs — sampled, always-on leak detection on the JVM.
- The JVM **Native Memory Tracking** guide (`-XX:NativeMemoryTracking`, `jcmd VM.native_memory`) — accounting for the off-heap memory a heap dump can't see.
- `runtime/pprof` source and the Go diagnostics guide — `MemProfileRate`, the sampling math, and `inuse` vs `alloc`.
- *Java Performance* (Scott Oaks) — heap-dump capture cost, direct buffers, and reading the live set in production.

---

## Related Topics

- [junior.md](junior.md) — capturing a heap snapshot and reading "what's big" in each runtime.
- [middle.md](middle.md) — the dominator tree, retention paths, and the two-snapshot diff as analysis *tools* (this page is their internals).
- [professional.md](professional.md) — institutionalizing leak detection: CI gates, memory SLOs, and fleet-wide capture/analysis pipelines.
- [03 — Allocation Profiling](../03-allocation-profiling/senior.md) — the *rate* side: sampling the allocator and GC pressure (vs. this page's *retained* side).
- [05 — Memory & Allocation Optimization](../../05-memory-and-allocation-profiling/senior.md) — what to *do* once you know what's retained: bounding caches, off-heap tuning, eviction, pooling.
- [Diagnostics → Post-Mortem Analysis](../../../../diagnostics/post-mortem-analysis/README.md) — analyzing heap dumps and cores captured *at crash time*, where capture and analysis are necessarily decoupled.
