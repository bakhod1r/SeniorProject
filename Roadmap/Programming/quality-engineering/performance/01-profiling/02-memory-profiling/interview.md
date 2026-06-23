# Memory Profiling — Interview Questions

> **Roadmap:** [Profiling](../README.md) → Memory Profiling
> *A memory interview rarely asks "what is a heap." It says "the pod got OOMKilled but the heap dump looks healthy — where do you look next," and then watches whether you can separate retained from allocated, RSS from heap, and a leak from a working set that simply hasn't been collected yet.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Memory vs Allocation Profiling](#theme-1--memory-vs-allocation-profiling)
3. [Theme 2 — Reading a Heap](#theme-2--reading-a-heap)
4. [Theme 3 — Leak vs Not-a-Leak](#theme-3--leak-vs-not-a-leak)
5. [Theme 4 — Capture Internals](#theme-4--capture-internals)
6. [Theme 5 — RSS vs Heap and Off-Heap Blind Spots](#theme-5--rss-vs-heap-and-off-heap-blind-spots)
7. [Theme 6 — Scenario and Debugging](#theme-6--scenario-and-debugging)
8. [Theme 7 — Design and Judgment](#theme-7--design-and-judgment)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **retained vs allocated** (what is alive now vs how much churned through)
- **shallow vs retained size** (an object's own bytes vs everything that dies with it)
- **high heap vs a leak** (a big working set is not unbounded growth)
- **RSS vs heap** (what the OS accounts vs what the runtime accounts)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction*, then reach for a snapshot diff or a dominator tree — not the ones who immediately say "we have a leak."

---

## Theme 1 — Memory vs Allocation Profiling

### Q1.1 — What is the difference between a memory profile and an allocation profile?

> **Testing:** Whether you know the two most-confused profilers measure different physical quantities.

**A.** They answer different questions about different points in time. A **memory (heap) profile** is a *census of the live heap*: what objects exist right now and how many bytes they hold — the inventory. An **allocation profile** is a *flow rate*: how many bytes were *allocated* over some window, attributed to the call sites that allocated them, regardless of whether those objects are still alive. The first is a level (bytes resident); the second is a velocity (bytes per second of churn).

The practical consequence: you debug a **leak** with the memory profile, because a leak is "live bytes that should have died but didn't." You debug **GC pressure / latency** with the allocation profile, because a tight loop allocating short-lived garbage shows up as a huge *allocation rate* while contributing almost nothing to *live* heap (it's all collected). Reaching for the wrong one is the classic error: people stare at allocation counts hunting a leak and find the busiest hot loop, which is innocent — it allocates a lot but retains nothing.

### Q1.2 — In Go's pprof, what is the difference between `inuse_space` and `alloc_space`?

> **Testing:** Whether you can map the abstract distinction onto the concrete tool everyone uses.

**A.** They are two views of the *same* sampled heap profile. `inuse_space` (and `inuse_objects`) reports bytes/objects **currently live** at the moment you captured — the memory view, what you use to find a leak. `alloc_space` (and `alloc_objects`) reports the **cumulative** bytes/objects allocated since the process started — the allocation/rate view, what you use to find GC pressure. `go tool pprof -inuse_space` vs `-alloc_space` flips between them.

The tell of a leak is `inuse_space` *climbing across successive captures* concentrated at one call stack. The tell of GC pressure is a call site dominating `alloc_space` while contributing nearly nothing to `inuse_space` — it churns hard but everything it makes is collected. (Allocation rate has its own dedicated treatment in the sibling topic; here we care about `inuse`.)

### Q1.3 — A teammate says "our allocation profile shows `json.Unmarshal` allocating gigabytes — that's our leak." Are they right?

> **Testing:** Whether you catch the rate-for-retention confusion in the wild.

**A.** Almost certainly not, and the wording is the giveaway. `alloc_space` showing gigabytes through `Unmarshal` means a lot of memory *passed through* that call over the program's life — it's cumulative churn, not residency. If those decoded objects are handed off, used, and dropped, they're collected and contribute *zero* to live heap. A high `alloc_space` with a flat `inuse_space` is the signature of *healthy, busy* code, not a leak — though it may be worth optimizing for GC cost. To actually test for a leak, switch to `inuse_space` and capture twice with the suspected workload in between: if live bytes attributed to that retention path *grow and don't come back down after a GC*, that's the leak. The number to trust for "is it a leak" is always *live*, never *allocated*.

---

## Theme 2 — Reading a Heap

### Q2.1 — Explain shallow size versus retained size. Why is retained size the number that matters?

> **Testing:** The single most-misread number in any heap tool.

**A.** **Shallow size** is the memory an object occupies *by itself* — its own header and fields, the bytes of just that one object. **Retained size** is the total memory that would be **freed if that object were collected** — its shallow size *plus* the shallow sizes of every object reachable *only* through it (objects that would become unreachable once it's gone).

Retained size is the one that matters because it answers the actionable question: "if I fix this one reference, how much do I get back?" A `HashMap` instance has a tiny shallow size — it's a few fields and an array pointer — but if it holds a million entries that nothing else references, its *retained* size is enormous. Sorting a heap dump by shallow size shows you small, boring objects; sorting by retained size puts the real offender — the one container quietly holding the world — at the top. Candidates who only know shallow size chase millions of identical small objects instead of the one root that retains them all.

### Q2.2 — What is a dominator tree and why is it the right structure for leak hunting?

> **Testing:** Whether you understand *how* retained size is computed and navigated.

**A.** Object X **dominates** object Y if *every* path from a GC root to Y passes through X — meaning if X dies, Y necessarily dies with it. The **dominator tree** is the tree formed by these relationships; an object's retained size is exactly the sum of shallow sizes in its dominator subtree. It's the right structure because leak hunting is fundamentally the question "what single object, if released, frees the most?" — and that is precisely "find the dominator with the largest retained subtree."

In Eclipse MAT this is the *Dominator Tree* view; you expand from the top and walk down the heaviest subtree until you reach the container or cache that owns the bulk of the heap. It collapses "a million leaked objects" into "this one map dominates them all," turning an overwhelming object graph into a single actionable node. Without it you'd be staring at a flat list of instances with no sense of ownership.

### Q2.3 — You've found a suspicious object holding 800 MB. What's the very next thing you look at, and why?

> **Testing:** Whether you know that *who keeps it alive* is the actual deliverable, not *what is big*.

**A.** The **path to GC roots** — specifically the *shortest path*, and in MAT, "merge shortest paths to GC roots, excluding weak/soft references." Knowing an object is big tells you *what* leaked; the retention path tells you *why it can't be collected*, which is the only thing you can actually fix in code. The path names the chain of strong references from a live root (a thread stack local, a static field, a JNI global) down to the offender. The fix is always "break one link in that chain" — clear the static collection, remove the listener, evict the cache entry — and you can't break a link you can't see.

The discipline: big object → retained size confirms it's worth it → **path to GC roots** to find the strong reference keeping it alive → identify which link is the bug. Stopping at "it's big" is stopping one step short of the answer.

### Q2.4 — What is a GC root? Name a few kinds and why it matters which kind retains your object.

> **Testing:** Whether "reachable" is a concrete, enumerable concept for you or hand-waving.

**A.** A **GC root** is a reference the collector treats as inherently alive — the starting set for reachability; anything transitively reachable from a root survives, anything not is collectible. The common kinds: **thread stack locals and active method parameters**, **static fields** of loaded classes, **JNI / native global references**, **active monitors** (objects being synchronized on), and (JVM) **interned strings** and **class loaders** themselves.

It matters *which* kind because it tells you the fix and the lifetime. A **static field** root means the object lives for the life of its class loader — the classic "static `Map` that's never cleared" leak, and a frequent cause of leaks across web-app redeploys (the class loader can't be unloaded because something static still pins it). A **thread-local** root means the object dies when the thread does — but thread pools reuse threads forever, so a forgotten `ThreadLocal` entry leaks for the life of the pool. A **JNI global** root means native code is holding it and the Java GC can't touch it at all. The root kind converts "it's reachable" into "here's the specific construct to go fix."

---

## Theme 3 — Leak vs Not-a-Leak

### Q3.1 — Heap usage is at 6 GB out of an 8 GB limit. Is that a leak?

> **Testing:** The core fallacy of the whole topic — high heap is not a leak.

**A.** Not necessarily, and "it's high" is not evidence either way. High heap usage can be a perfectly healthy **working set**: large caches sized on purpose, a big in-memory index, connection/buffer pools, or simply a generational GC that *hasn't bothered to run a full collection yet* because it isn't under pressure. A managed runtime will happily let the heap drift up toward its limit and only do expensive full GCs when it needs the space — so a high number can just mean "GC hasn't been provoked," not "memory is lost."

A **leak** is a specific shape: **unbounded growth of live memory that survives collection** — memory the program can no longer reach or will never use again, accumulating without bound. The way you distinguish them is not the absolute level but the **trend after GC**: force (or wait for) a full GC and look at the *live* heap floor. If the floor is stable across time and load, 6 GB is just your working set. If the floor keeps climbing collection after collection, *that* is the leak. The number alone is noise; the post-GC slope is the signal.

### Q3.2 — How does a snapshot diff isolate a real leak that a single snapshot can't?

> **Testing:** The most important practical technique in leak hunting.

**A.** A single snapshot shows everything that's live — including your entire legitimate working set, which is usually most of the heap and drowns the leak in noise. A **diff** between two snapshots, taken before and after a representative workload (or simply spaced over time under steady load), cancels out the stable baseline and surfaces only what *grew*. You compare object *counts* and *retained sizes* per type/class between the two and sort by the delta.

The signature of the leak is a type whose instance count climbs monotonically with each cycle and never comes back down — 10,000 more `Session` objects after 10,000 requests that should have ended. The stable working set has a delta near zero and falls away; the growing collection stands out precisely because *only it changed*. This is why "capture two and subtract" beats "capture one and stare" — the subtraction does the noise filtering for you. In MAT it's the histogram comparison; in Chrome DevTools the "Comparison" view between two heap snapshots; in Go, two `inuse_space` profiles diffed with `pprof -base`.

### Q3.3 — Memory grew steadily for an hour and then flattened out. Leak or not a leak?

> **Testing:** Whether you understand that *bounded* growth that stabilizes is not a leak.

**A.** Almost certainly **not a leak** — a leak doesn't flatten, it grows until OOM. Growth that rises and then plateaus is the signature of a **warming working set reaching steady state**: a cache filling to its configured capacity and then evicting at the rate it admits; connection or thread pools growing to their max and stopping; lazy-loaded data structures populating once. The defining property of a leak is *unbounded* growth; a curve that finds a ceiling on its own has, by definition, a bound.

The honest caveat: "flattened" must be verified over a long-enough window relative to the growth rate, and the plateau must be *stable*, not just a temporary pause before climbing again (you can get a step function from a leak that's gated on some periodic event). But the textbook answer is: rises-then-flattens is a working set settling; rises-without-bound is a leak. The shape of the tail is the diagnosis.

### Q3.4 — Give a concrete example of memory that *looks* leaked in a tool but is working as intended.

> **Testing:** Whether you can name false positives, the mark of someone who's actually hunted leaks.

**A.** A bounded **LRU cache** is the canonical one: in a snapshot it shows a large `Map` retaining thousands of entries and a big retained size — it *looks* exactly like a leaking collection. But it's capped; it evicts on insert, so its live size is bounded and stable across time. The diff gives it away — its count stops growing once warm, whereas a true leak's count never stops.

Other honest false positives: **memory the allocator has freed back to its own free lists but not returned to the OS** (so RSS stays high while the runtime considers it available — Go's `HeapIdle`, glibc malloc arenas, the JVM not shrinking its committed heap); **soft-referenced caches** that the JVM *will* clear under pressure but hasn't yet, so they look retained until memory gets tight; and a **generational heap that simply hasn't run a full GC**, so dead-but-uncollected objects still appear live in a naive view. The senior move is to *force a full GC before trusting a snapshot* (or use a tool that triggers one), so what you measure is genuinely live, not merely uncollected.

---

## Theme 4 — Capture Internals

### Q4.1 — Go's heap profiler is *sampled*. What does `runtime.MemProfileRate` control, and what's the tradeoff?

> **Testing:** Whether you know your heap numbers are statistical, not exact, and why.

**A.** Go doesn't record every allocation — it would be ruinously slow. It **samples**: on average one allocation per `runtime.MemProfileRate` bytes allocated (default **512 KiB**) is recorded with its stack, and the profiler scales the samples back up to estimate totals. `MemProfileRate` is that average byte interval. Lower it (e.g. to 1) and you record *every* allocation — exact, but with real CPU and memory overhead; raise it and you sample more sparsely and cheaply.

The tradeoffs you must state: (1) the numbers are **statistical estimates**, accurate for *aggregate* hot spots but not to the byte, and small or rare allocations may be missed entirely; (2) it must be set **early** (before allocations happen, typically at program start) because changing it mid-run gives inconsistent results; (3) the default is deliberately tuned so the heap profiler is cheap enough to leave on in production — that's the whole point of sampling. So when you read `inuse_space`, you're reading a scaled-up estimate, and you should trust the *shape* (which call stacks dominate) more than the exact byte counts.

### Q4.2 — What actually happens when you capture a Java `.hprof` heap dump, and what's the cost in production?

> **Testing:** Whether you know a full heap dump is a stop-the-world event, not a free read.

**A.** A full `.hprof` dump (via `jmap -dump:live`, `jcmd GC.heap_dump`, or `-XX:+HeapDumpOnOutOfMemoryError`) serializes the **entire live object graph** — every object, its class, its fields, and the references between them — to a file. To get a consistent graph it **stops the world**: the JVM pauses all application threads for the duration so the object graph doesn't mutate mid-walk. The file is roughly the size of the live heap, so a 30 GB heap produces a ~30 GB file and a pause measured in *seconds to tens of seconds*.

The production cost is therefore brutal and twofold: a long STW pause that looks like an outage to callers (blown timeouts, failed health checks, possible cascading failure), and a huge file you then have to move and load into a tool with enough RAM to analyze it (MAT often needs heap comparable to the dump). Specifying `:live` triggers a full GC first so you dump only reachable objects — smaller and more accurate, but the GC adds to the pause. The senior implications: never casually `jmap` a large heap in prod during peak; prefer capturing on a canary or a node you've drained; and budget the analysis machine's RAM before you capture a giant dump you then can't open.

### Q4.3 — How does JFR's old-object sample give you leak information *without* a full heap dump?

> **Testing:** Whether you know the low-overhead, production-safe alternative to STW dumps.

**A.** Java Flight Recorder takes a fundamentally different, **sampling** approach. With `OldObjectSample` enabled, the JVM tracks a bounded sample of allocations that **survive long enough to be promoted** (objects that outlive young-gen collections — exactly the population a leak lives in), and for each it retains the **allocation stack trace** and can compute the **reference chain to a GC root** at recording time. So instead of serializing 30 GB, you carry a small, fixed-size sample of "old objects and what keeps them alive."

This is the production-safe leak tool: overhead is low and continuous, there's no multi-second STW pause, and the output directly answers the two questions that matter — *where was the leaking object allocated* (the stack) and *what's retaining it* (the path to root). It trades completeness for survivability: you don't get every object like an `.hprof`, but you get a representative sample of the *survivors*, which is precisely the set a leak hides in. The pattern is "leave JFR running, dump the recording when memory climbs," versus "induce an outage with `jmap` after the fact."

### Q4.4 — When you take a heap snapshot, are you seeing *all* objects or *reachable* objects? Why does the answer matter?

> **Testing:** Whether you understand that "snapshot" can mean two different populations.

**A.** It depends on whether a GC ran first, and conflating the two leads to false leaks. A snapshot of **reachable (live) objects** — what you get from `jmap -dump:live`, MAT after it discards unreachables, or any tool that forces/assumes a full GC — shows only objects still referenced: the true picture of what's retained. A snapshot of **all objects** (no preceding GC) includes **dead-but-not-yet-collected** garbage that's still sitting in the heap because the collector hasn't run — these look "present" but are *already collectible* and would vanish on the next GC.

It matters because the dead-but-uncollected set is a giant false positive: you'll "find" megabytes of objects that aren't actually leaked, just not-yet-swept. That's why the disciplined workflow is **force a full GC, then snapshot** (and why MAT, by default, computes retained sizes over the reachable set only). The question you're really answering is "what survives collection," so you must measure *after* collection — otherwise you're measuring the runtime's laziness, not your program's leaks.

---

## Theme 5 — RSS vs Heap and Off-Heap Blind Spots

### Q5.1 — Your Java pod is OOMKilled by Kubernetes, but the heap dump shows the heap is healthy and well under `-Xmx`. Where do you look?

> **Testing:** The flagship scenario — RSS is bigger than the heap, and the heap profiler can't see the rest.

**A.** The OOMKill is driven by **RSS** (total resident memory the kernel accounts to the process), and the Java heap is only *one* contributor to RSS. If the heap is healthy under `-Xmx` but RSS exceeded the cgroup limit, the growth is **off-heap / native** memory, which the heap dump *cannot see by construction*. The places to look, roughly in order:

- **Thread stacks** — each thread costs ~512 KB–1 MB of native stack; thousands of threads (an unbounded pool) is hundreds of MB the heap never shows.
- **Metaspace / class metadata** — native memory for loaded classes; leaks here come from classloader leaks or runaway dynamic class/proxy generation.
- **Direct byte buffers** (`DirectByteBuffer` / `ByteBuffer.allocateDirect`) — heap holds only a tiny wrapper object; the actual buffer is *native* memory, common in NIO, Netty, gRPC, and serialization libraries.
- **Native libraries** (JNI) — anything `malloc`-ing in C: compression (zlib), crypto, image/DB drivers.
- **JVM overhead itself** — JIT code cache, GC structures, the JVM's own bookkeeping.

The tool that *does* see this is **Native Memory Tracking** (`-XX:NativeMemoryTracking=summary`, then `jcmd <pid> VM.native_memory summary`), which breaks RSS into Java heap, thread, code, GC, internal, etc. The lesson to state: a heap dump answers "is the *heap* the problem," and when the answer is no, you stop looking at the heap and start looking at RSS minus heap.

### Q5.2 — Why is `-Xmx` not a memory limit for a container, and how do you size the cgroup limit correctly?

> **Testing:** Whether you understand the JVM's total footprint, not just the heap knob.

**A.** `-Xmx` caps **only the Java heap** — but a JVM's RSS is *heap + Metaspace + thread stacks + code cache + direct buffers + GC structures + native libs + JVM overhead*. So a process with `-Xmx4g` routinely uses well over 4 GB resident. If you set the container memory limit to `-Xmx` (or only slightly above), the kernel OOMKills the process for the *non-heap* memory even though the heap never breached `-Xmx`. The classic misconfiguration is "`-Xmx` equals the pod limit."

Correct sizing: the cgroup limit must be `-Xmx` **plus** a realistic headroom for everything off-heap — often **25–50%** more, depending on thread count, direct-buffer usage, and Metaspace. Better, let the JVM be cgroup-aware: modern JVMs honor container limits, and `-XX:MaxRAMPercentage` sizes the heap as a *fraction* of the detected container memory (e.g. 75%), deliberately leaving the rest for off-heap. Bound the other consumers too (`-XX:MaxMetaspaceSize`, `-XX:MaxDirectMemorySize`, a capped thread pool) so the total is predictable. The principle: size the limit to the *whole process*, then size the heap as a fraction *inside* it.

### Q5.3 — What's a `DirectByteBuffer` leak, and why is it invisible in an ordinary heap dump?

> **Testing:** The most common specific off-heap leak, and why standard tooling misses it.

**A.** `ByteBuffer.allocateDirect(n)` allocates `n` bytes of **native (off-heap)** memory and returns a small *on-heap* `DirectByteBuffer` wrapper object that points at it. The native bytes are freed not by the GC directly but by a **`Cleaner`** that runs when the tiny wrapper becomes unreachable. The leak happens when those wrapper objects stay reachable (pooled, cached, referenced by a long-lived structure) so the `Cleaner` never fires — or when allocation outpaces GC so cleaners lag — and native memory balloons.

It's invisible in an ordinary heap dump because the dump accounts only the **wrapper's shallow size (a few dozen bytes)**, not the megabytes of native buffer behind it. So the heap looks fine while RSS climbs, producing exactly the "OOMKilled but heap healthy" picture. You find it with **NMT** (the "Internal" or direct-buffer growth), by monitoring the `java.nio:type=BufferPool` JMX MBean (count and `MemoryUsed` for direct buffers), and by bounding it with `-XX:MaxDirectMemorySize` so it fails loudly with `OutOfMemoryError: Direct buffer memory` instead of silently driving an OOMKill. Netty's pooled allocators are a frequent home for this.

### Q5.4 — For a Go service whose RSS keeps climbing while pprof's `inuse_space` is flat, what's going on?

> **Testing:** The Go-flavored RSS-vs-heap gap — the runtime holds memory the profiler considers free.

**A.** Several non-leak explanations, and you should name them before concluding "leak." First, **pprof's `inuse_space` measures Go-heap live bytes**, but RSS also includes the **runtime's own retained-but-idle memory**: Go's allocator may have freed objects back to its free lists (`HeapIdle`) without returning the pages to the OS, so RSS stays high while `inuse_space` is flat — entirely expected, not a leak. `runtime.ReadMemStats` (`HeapInuse`, `HeapIdle`, `HeapReleased`, and especially `Sys`) shows this gap directly, and historically the scavenger's lazy return (and `MADV_FREE` vs `MADV_DONTNEED`) means the kernel may not reclaim pages until under pressure, inflating RSS.

Second, RSS includes things the Go heap profiler doesn't track at all: **goroutine stacks** (an unbounded goroutine leak is the classic culprit — each stack is real memory, and they grow), **cgo / C allocations** (anything via cgo `malloc`s outside the Go heap and is invisible to pprof), and `mmap`'d files or off-heap buffers. So the triage is: confirm `inuse_space` is genuinely flat (rule out a heap leak), check `runtime.NumGoroutine()` for goroutine growth, check `ReadMemStats` to see whether the gap is just idle/unreleased heap, and suspect cgo if the binary uses it. RSS climbing with a flat Go heap is "look outside the Go heap," same lesson as the JVM case.

---

## Theme 6 — Scenario and Debugging

### Q6.1 — A heap-usage graph shows a sawtooth (GC drops it, it climbs back) but the *lower* points are slowly rising over days. What is it?

> **Testing:** Whether you can read the post-GC floor through the sawtooth, the canonical leak signature.

**A.** That rising **floor under the sawtooth is a leak** — and it's the textbook signature, so the answer is to read the *troughs*, not the peaks. The sawtooth itself is normal generational GC: allocation pushes the heap up, a collection drops it back down, repeat. What matters is where each *trough* lands — the live set that *survived* collection. If the troughs were flat, you'd have a healthy steady state (the working set is constant, GC reclaims all the transient garbage). Troughs that creep upward day over day mean each GC is leaving slightly more behind than the last: live memory that survives collection and accumulates without bound — a leak, by definition.

So you ignore the dramatic up-and-down (that's just churn) and fit a line to the *minima*. A non-zero upward slope on the post-GC minima is the alarm. This is also exactly what you should *alert on* in production — heap-after-GC, not raw heap usage — because raw usage sawtooths harmlessly and would page you constantly, while the post-GC floor only rises when something is genuinely accumulating.

### Q6.2 — Memory grew quickly after deploy, then flattened and has been stable for two days. The on-call paged you. Real incident?

> **Testing:** Whether you can confidently call a *non*-leak and explain why, resisting alert-driven panic.

**A.** Most likely **not a real incident** — this is a working set warming to steady state, not a leak, and the alert was probably on the wrong metric (raw usage, not post-GC floor). Fast growth after deploy that then *flattens and stays flat for two days* is the shape of caches filling to capacity, pools reaching their max, and lazy structures populating once — all of which have a built-in ceiling. A leak does not flatten; it keeps climbing until OOM. Two days of genuine stability is strong evidence of a bound.

I'd confirm rather than assume: pull the **post-GC heap floor** over the two days — if *that* is flat (not just raw usage), it's settled and healthy. I'd also check the diff against the pre-deploy baseline to confirm the higher plateau is explained (a new cache, a bumped pool size, a new feature holding state). If both check out, the action is to *fix the alert*, not the app: alert on the *slope of the post-GC floor*, not on absolute usage or growth, so a one-time warm-up to a higher steady state doesn't page anyone. The judgment being tested is the discipline to say "high and stable is fine" with evidence.

### Q6.3 — A container is OOMKilled in Kubernetes, but the heap dump you captured is healthy. Walk me through where you go next.

> **Testing:** Calm, structured triage of the RSS-minus-heap space instead of re-staring at the heap.

**A.** First, **classify**: the kill is on **RSS** vs the cgroup limit, and a healthy heap dump means the heap is *not* the cause — so I stop analyzing the heap and start partitioning RSS. The triage:

1. **Establish RSS over time** from container metrics (`container_memory_working_set_bytes`) — confirm it's RSS, not heap, that breached, and whether it climbs steadily (leak-shaped) or spikes (load-shaped).
2. **Break RSS down by region.** For the JVM, enable **NMT** (`-XX:NativeMemoryTracking=summary`) and `jcmd VM.native_memory summary` — this splits RSS into Java heap, threads, code, GC, Metaspace, internal, so I can see which region is oversized. For a non-JVM process, `pmap -x <pid>` and `/proc/<pid>/smaps_rollup`.
3. **Chase the largest off-heap consumer.** Thread count exploding (unbounded pool) → bounded executor. Metaspace climbing → classloader leak / dynamic-proxy churn. Direct buffers → `BufferPool` JMX MBean and `-XX:MaxDirectMemorySize`. Native lib → the JNI caller.
4. **Right-size the limit** as a parallel track: if everything is legitimately accounted for, the **container limit was too close to `-Xmx`** with no off-heap headroom — raise the limit or lower `MaxRAMPercentage`.

The throughline: a healthy heap dump is a *result*, not a dead end — it tells me the answer is in RSS-minus-heap, and NMT is the instrument that sees there.

### Q6.4 — You diff two heap snapshots and the top grower by count is `char[]` (or `[]byte`). Is that the leak?

> **Testing:** Whether you know primitive-array growth is a *symptom*, and you must follow retention to the real owner.

**A.** `char[]`/`byte[]`/`String` being the top grower is almost always a **symptom, not the cause** — these primitive arrays are what *everything* is ultimately made of (every `String` is backed by a `char[]`/`byte[]`), so they bubble to the top of any count-based diff. Stopping there tells you "lots of strings leaked" without telling you *which structure* is holding them, which is the only fixable thing.

The move is to pivot from "what is big" to "what *retains* it": list the **incoming references** / **path to GC roots** for those arrays and walk *up* the dominator tree to the common owner — you'll typically find one `HashMap`, `ArrayList`, or cache that dominates the lot. In MAT that's "merge shortest paths to GC roots" on the `char[]` set; the chain converges on the real container. The leak is that container and the code that keeps adding to it without removing — not the `char[]` itself, which is innocent. The senior instinct on seeing a primitive array at the top is reflexively "show me what dominates these," never "we're leaking strings."

### Q6.5 — A service's heap is fine, but after running for a week it spends 30% of CPU in GC and latency p99 is awful. What's the likely shape, and which profiler do you reach for?

> **Testing:** Whether you correctly route a *GC-pressure* symptom to the allocation profiler, not the heap profiler.

**A.** A *healthy heap* with *high GC CPU* points to **allocation rate**, not retention — so the right tool is the **allocation profiler** (`alloc_space`/`alloc_objects` in Go, JFR allocation events or async-profiler `-e alloc` in Java), not the heap/`inuse` profiler. The shape is high *churn*: code allocating large volumes of short-lived objects in a hot path, all promptly collected (so live heap stays flat — that's why the *heap* looks fine) but forcing the GC to run constantly to keep up, which burns CPU and injects pause-driven p99 latency. Live bytes being stable is exactly why the heap profile is the wrong lens here; the cost is in the *flow*, not the *level*.

I'd capture an allocation profile, find the call site dominating `alloc_space`, and reduce the churn — reuse buffers (`sync.Pool`), avoid per-request allocations, fix accidental boxing or defensive copies. (This is squarely the sibling topic's territory — allocation *rate* — which is why the distinction in Theme 1 matters: a memory-profiling reflex would have me hunting a leak that isn't there.) The diagnostic chain is: heap fine + GC hot + latency bad ⇒ rate problem ⇒ allocation profiler.

---

## Theme 7 — Design and Judgment

### Q7.1 — Design a production heap-capture playbook for a fleet of JVM services. What do you put in place *before* an incident?

> **Testing:** Whether you've thought about capturing memory data *safely* and *ahead of time*, not improvising during an outage.

**A.** The goal is to never be in the position of `jmap`-ing a 30 GB heap during peak and inducing an outage. So, before any incident:

- **Always-on low-overhead sampling.** Run **JFR continuously** with `OldObjectSample` (and allocation events), so survivor stacks and retention paths are already being recorded — dump the recording when memory climbs, no STW dump required.
- **Automatic dump on OOM, scoped safely.** `-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=<persistent-volume>` so a real OOM leaves forensic evidence — but ensure the path has room and the node can tolerate the write.
- **Capture on a drained / canary node.** When a full `.hprof` is truly needed, take it from an instance pulled out of the load balancer (or a canary), never a hot one — the multi-second STW is then harmless.
- **NMT enabled** (`summary`) fleet-wide so RSS can be partitioned the moment a pod is OOMKilled without a redeploy.
- **The right alerts** (see Q7.3) and **enough analysis RAM** provisioned — a box that can actually open a dump the size of your largest heap.

The principle is *capture cheaply and continuously; reserve the expensive STW dump for nodes where the pause can't hurt anyone.*

### Q7.2 — How do you soak-test for memory leaks, and what exactly do you measure?

> **Testing:** Whether you know leaks are found by *sustained load over time*, measured against the post-GC floor.

**A.** A leak is *unbounded growth over time*, so you must run **representative load for a long, sustained period** — hours to days — long enough for any leak to outgrow the noise of warm-up and the working set. A short load test misses leaks entirely because the working set is still warming; the curve hasn't separated from a leak's curve yet. So: realistic traffic mix, steady rate, long duration, with the workload exercising the suspected paths (session create/destroy, cache churn, connection cycling).

What I measure is the **post-GC live heap floor over time**, not raw usage — force or observe full GCs and fit a line to the troughs (Q6.1). A flat floor after the working set warms ⇒ no leak. A floor with a persistent positive slope ⇒ leak, and the slope estimates the rate. I'd pair this with periodic **snapshot diffs** at intervals (e.g. hour 1 vs hour 6) so I get not just "it's growing" but *which type* is growing, ready to hand to the dominator-tree analysis. The deliverable is a trend line on the post-GC floor plus a histogram delta — "leak or not" *and* "what's leaking."

### Q7.3 — You can alert on one memory metric. Which one, and why not just "heap usage > 90%"?

> **Testing:** The single most important production-memory design choice — what to page on.

**A.** Alert on the **slope of the heap *after* a full GC** (the post-GC live floor trending up), not on raw heap usage. Raw "heap > 90%" is a bad alert because a healthy generational heap *sawtooths up to its limit by design* — it'll cross 90% constantly right before a GC drops it, paging on-call for normal behavior (alert fatigue) while telling you nothing about whether memory is actually being lost. The peak is noise; the post-GC floor is signal.

The post-GC floor only rises when live memory genuinely accumulates — exactly a leak — so an upward slope there is both *sensitive* (catches real leaks early, before OOM) and *specific* (doesn't fire on normal churn or a one-time warm-up to a higher steady state). Concretely: sample live heap immediately after each full GC, compute the trend over a window, and page when the slope is positive and sustained. I'd complement it with an **RSS-vs-limit** alert (to catch the off-heap OOMKill the heap metric can't see, per Theme 5) and an OOM-event alert — but if I get one signal, it's the post-GC slope, because it's the one that distinguishes a leak from a working set.

### Q7.4 — When are weak or soft references the right tool, and how can they *cause* a leak?

> **Testing:** Whether you understand reference strength as a leak-control mechanism with its own failure modes.

**A.** They're the right tool when you want to **cache or associate data without keeping it alive yourself** — let the GC reclaim it under pressure. A **soft reference** is "keep this as long as memory is comfortable, but reclaim it before OOM" — a memory-sensitive cache. A **weak reference** is "don't keep this alive *at all*; reclaim as soon as nothing strong points to it" — ideal for canonicalizing maps and for keys in a `WeakHashMap` so an entry disappears when its key is no longer referenced elsewhere. Used right, they prevent a class of leaks: a listener registry or cache that would otherwise pin objects forever instead lets them go.

But they cause leaks (and bugs) through misuse: **`WeakHashMap` weakly references the *key* but strongly references the *value*** — if a value (directly or transitively) references its own key, the key never becomes weakly reachable and the entry never clears, leaking exactly what you tried to avoid. **Soft references defeat your cache's own eviction policy** — they accumulate until the JVM hits memory pressure and then clears them *en masse*, causing a latency cliff, so they're a poor substitute for a properly sized bounded cache. And **a stale-but-still-strongly-reachable entry** in a weak cache (e.g. something holds a strong ref you forgot) silently keeps the whole entry alive. The judgment: reference strength is a precise tool for *who owns the lifetime* — use weak/soft to *cede* ownership deliberately, but know that a stray strong reference anywhere in the chain reinstates the leak.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Memory profile vs allocation profile?** A: Memory = live heap census (find leaks); allocation = cumulative churn rate (find GC pressure).
- **Q: Shallow vs retained size?** A: Shallow = the object's own bytes; retained = everything freed if it's collected (its dominator subtree).
- **Q: What's a dominator tree?** A: X dominates Y if every root path to Y goes through X; retained size is the sum over the dominator subtree.
- **Q: `inuse_space` vs `alloc_space` in Go?** A: `inuse` = currently live (leak hunting); `alloc` = cumulative allocated (rate/GC pressure).
- **Q: Is high heap usage a leak?** A: No — could be a working set or GC not having run; a leak is *unbounded growth of the post-GC floor*.
- **Q: One-line definition of a leak?** A: Live memory that survives collection and grows without bound.
- **Q: How do you isolate a leak from the working set?** A: Diff two snapshots and look at what *grew*; the baseline cancels out.
- **Q: Why force a GC before a snapshot?** A: So you measure *live* objects, not dead-but-uncollected garbage (false positives).
- **Q: `MemProfileRate` default?** A: ~512 KiB — one sampled allocation per that many bytes; set 1 for exact, at a cost.
- **Q: Why is a `.hprof` dump expensive?** A: It serializes the whole live heap under a stop-the-world pause; file ≈ heap size.
- **Q: What does JFR `OldObjectSample` give you?** A: A low-overhead sample of *surviving* objects with allocation stacks and retention paths — no STW dump.
- **Q: Heap fine but pod OOMKilled — first tool?** A: NMT (`VM.native_memory`) to partition RSS — the leak is off-heap.
- **Q: Why isn't `-Xmx` a container memory limit?** A: It caps only the heap; RSS also has threads, Metaspace, code cache, direct buffers.
- **Q: `DirectByteBuffer` leak — why invisible in a heap dump?** A: The dump sees only the tiny on-heap wrapper, not the native bytes behind it.
- **Q: RSS climbs but Go `inuse_space` is flat — first suspects?** A: Unreleased idle heap (`HeapIdle`), goroutine-stack leak, or cgo allocations.
- **Q: Which one metric do you alert on?** A: Slope of heap *after* full GC — not raw usage, which sawtooths by design.
- **Q: `WeakHashMap` leak cause?** A: It weak-references keys but *strong*-references values; a value referencing its key pins the entry forever.
- **Q: Top grower in a diff is `char[]` — the leak?** A: No — a symptom; follow retention up to the container that dominates them.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Equating "high heap" with "leak" — no mention of the post-GC floor or working set.
- Sorting a heap dump by *shallow* size and chasing millions of small objects.
- Using the *allocation* profile to hunt a leak (or calling high `alloc_space` "the leak").
- Stopping at "this object is big" without the *path to GC roots*.
- Concluding "leak" from a *single* snapshot instead of a diff.
- Assuming the Java heap *is* the process memory — no concept of RSS, off-heap, or NMT.
- Casually proposing `jmap` on a large production heap with no mention of the STW pause.
- Naming `char[]`/`byte[]` as "the leak" instead of following retention to the owner.

**Green flags:**
- Naming the *distinction* (retained vs allocated, shallow vs retained, RSS vs heap) before reaching for a tool.
- Reading the **post-GC floor** through a sawtooth, and alerting on its *slope*.
- Reaching for a **snapshot diff** to cancel the working set, and for the **dominator tree + path to roots** to find the owner.
- Forcing a full GC before trusting a snapshot.
- Treating "OOMKilled but heap healthy" as a signal to look at **RSS minus heap** (NMT, thread stacks, direct buffers).
- Knowing heap numbers are *sampled* (Go) and dumps are *stop-the-world* (Java), and choosing JFR for production-safe capture.
- Confidently calling a *non*-leak ("high and stable is fine") with evidence, not just suspicion.

---

## Summary

- The bank reduces to four distinctions in costumes: **retained vs allocated**, **shallow vs retained size**, **high heap vs a leak**, **RSS vs heap**. Name the distinction first; the tool follows.
- **Memory vs allocation:** a memory profile is the live-heap census (find leaks); an allocation profile is cumulative churn (find GC pressure). In Go, `inuse_space` vs `alloc_space`. High `alloc_space` with flat `inuse_space` is healthy busy code, not a leak.
- **Reading a heap:** retained size (the dominator subtree), not shallow size, is the actionable number; the dominator tree finds the object that frees the most, and the **path to GC roots** tells you *why* it's retained and which link to break.
- **Leak vs not-a-leak:** high heap is not a leak — read the **post-GC floor**. A **snapshot diff** cancels the working set and surfaces only what grew. Rises-then-flattens is a working set settling; rises-without-bound is a leak. Bounded LRU caches and idle-but-unreturned memory are honest false positives.
- **Capture internals:** Go heap numbers are *sampled* (`MemProfileRate`, ~512 KiB) — estimates, trust the shape. Java `.hprof` is a *stop-the-world* full serialization ≈ heap size; JFR `OldObjectSample` is the low-overhead, production-safe alternative. Force a GC so you measure *live*, not *uncollected*.
- **RSS vs heap:** `-Xmx` caps only the heap; RSS adds threads, Metaspace, code cache, **direct buffers**, and native libs — the source of "OOMKilled but heap healthy." **NMT** partitions RSS; `DirectByteBuffer` leaks hide behind tiny on-heap wrappers; in Go, suspect idle heap, goroutine stacks, or cgo.
- **Design:** capture continuously and cheaply (JFR), reserve STW dumps for drained nodes, soak-test over hours against the post-GC floor, and **alert on the post-GC slope**, not raw usage. Weak/soft references cede lifetime ownership deliberately — but a stray strong reference anywhere reinstates the leak.

---

## Further Reading

- *Java Performance* (Scott Oaks) — heap analysis, GC behavior, and native memory; the practical reference for the JVM side.
- Eclipse MAT documentation — the dominator tree, retained size, and "path to GC roots" as implemented in the tool everyone uses.
- The Go [Diagnostics](https://go.dev/doc/diagnostics) guide and `runtime/pprof` docs — `inuse_space` vs `alloc_space`, `MemProfileRate`, and `ReadMemStats`.
- JDK **Native Memory Tracking** and **JFR** documentation — partitioning RSS and low-overhead old-object sampling.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [03 — Allocation Profiling](../03-allocation-profiling/interview.md) — the *rate* side: `alloc_space`, GC pressure, and reducing churn (the sibling distinction this page keeps deferring to).
- [Memory Optimization](../../05-memory-and-allocation-profiling/) — what to do once you know what's retained.
- [Diagnostics → Post-Mortem Analysis](../../../../diagnostics/post-mortem-analysis/README.md) — heap dumps captured at crash time.
- [Profiling README](../README.md) — where memory profiling sits among the profiler family.
