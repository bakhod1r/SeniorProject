# Runtime ↔ GC Integration — Interview Questions

> **Topic:** [Runtime ↔ GC Integration](README.md)

---

## Introduction

These questions probe whether a candidate understands the *interface* between the language runtime/compiler and the garbage collector — root finding, safepoints, barriers, and moving-GC support — as opposed to how GC *algorithms* reclaim memory (that is a separate topic). A strong candidate distinguishes precise from conservative scanning, can explain why a "GC pause" is often dominated by time-to-safepoint rather than collection, knows what a write barrier compiles to and why a concurrent collector needs one, and can reason about engine-specific choices (HotSpot oop maps and safepoint polling, G1's SATB and card barriers, ZGC's colored-pointer load barrier, Go's hybrid write barrier, V8 and .NET root finding). A weaker candidate conflates the algorithm with the interface, says "use a lock" or "tune the heap" reflexively, and cannot explain what the compiler must emit for the collector to work at all.

The questions are grouped: **Conceptual** (the model), **Engine-Specific** (HotSpot/Go/V8/.NET mechanics), **Tricky / Trap** (where the textbook answer is wrong), and **Design** (build-it scenarios). Each is a flat `## Question N` for easy reference.

## Table of Contents

- [Conceptual](#conceptual)
- [Engine-Specific](#engine-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)
- [Cheat Sheet](#cheat-sheet)
- [Further Reading](#further-reading)

---

## Conceptual

## Question 1

**What is the runtime↔GC interface, and why can't the GC work without it?**

The GC must find every live object and, for a moving collector, update every reference to relocated objects. But the live references sit in CPU registers, on thread stacks, and in globals as raw bit patterns — the collector cannot tell which words are pointers, cannot safely inspect a thread mid-instruction, and cannot learn about pointer changes a concurrent mutator makes. The interface supplies exactly these three things: **stack maps** (which slots/registers hold pointers, per code location), **safepoints** (when it is safe to inspect/move), and **barriers** (notifications of pointer reads/writes). Without compiler- and runtime-emitted support, a precise or moving or concurrent collector is impossible; you'd be limited to a fully conservative, non-moving, stop-the-world design.

## Question 2

**What is a root, and where do roots live?**

A root is a pointer that lives *outside* the heap but refers *into* it; reachability analysis starts from the roots. Roots live in three places: **thread stacks** (local variables, spilled temporaries), **CPU registers** (values the compiler kept in registers at the pause point), and **globals/statics** (and runtime-internal structures like JNI handles, thread-local storage, and the like). Finding all roots precisely is the hard part: stack and register contents are just bits, so the collector needs the compiler's stack map to know which are pointers.

## Question 3

**Explain precise vs conservative root scanning and the consequences of each.**

**Conservative** scanning treats any word that *looks like* a heap pointer as a live reference, requiring no compiler support — used by the Boehm C/C++ collector and early V8. Consequences: false positives pin dead objects (floating garbage), and because you're not *sure* a word is a pointer, you must not overwrite it with a relocated address, so you **cannot move/compact**. **Precise** (exact) scanning uses compiler-emitted **stack maps / oop maps** to know exactly which slots are pointers, so there's no floating garbage from false positives and the collector **can move objects** (it knows precisely which slots to update). Nearly all modern managed runtimes are precise; the cost is the metadata and the codegen complexity to produce it.

## Question 4

**What is a safepoint and why must threads be at one before the GC scans them?**

A safepoint is a point in the program where the thread's state is fully and consistently described by the maps — so the GC may safely read its roots (and, for a moving GC, update them). At arbitrary instructions, a value may be half-computed or held in a form no map describes, so scanning there could miss or misidentify pointers. The runtime therefore brings every mutator thread to a safepoint before scanning. Maps are only generated at safepoints (one per loop back-edge, method entry/return, call site, etc.), not at every instruction, because emitting maps everywhere would be prohibitively large and slow.

## Question 5

**What is time-to-safepoint (TTSP) and why does it dominate some pauses?**

TTSP is the interval from "the GC requests a global pause" to "the *last* thread actually reaches a safepoint and stops." Collection cannot begin until everyone is stopped. If one thread is in a tight poll-free loop or a long native call, every other thread waits for it — so the *visible* pause is mostly TTSP, even if the collection itself is microseconds. This is why splitting a pause into "reaching safepoint" (TTSP) vs "at safepoint" (collection) is the first diagnostic step: the fixes are completely different (eliminate the straggler vs tune the collector).

## Question 6

**What does a write barrier do, and why do concurrent and generational collectors need one?**

A write barrier is compiler-emitted code that runs on every pointer store, recording information the collector needs. **Generational** collectors use it (card marking) to find old→young pointers without scanning all of old space. **Concurrent-marking** collectors use it (SATB or incremental-update) so that pointer rewrites the mutator makes during marking don't cause a live object to be missed and freed. Without the barrier, a concurrent collector could free a reachable object (correctness bug), and a generational collector would have to scan the whole heap on every young collection (defeating the point). The cost is a few extra instructions on each pointer store.

## Question 7

**What is a read/load barrier and when is it needed instead of a write barrier?**

A read/load barrier is compiler-emitted code on a pointer *load* that corrects the loaded reference — typically used by collectors that **move objects concurrently** with the mutator. If an object can be relocated while the program runs, a load might return a stale pointer to the old location; the load barrier detects this and remaps it (and often self-heals the source slot). ZGC and Shenandoah use load barriers for exactly this. Write barriers alone can't support concurrent compaction because a load could still observe a stale pointer; you need the barrier at the *load* to fix it at the point of use.

## Question 8

**Why can't the compiler keep a raw pointer in a register across a safepoint under a moving GC?**

Because the object may move at that safepoint. If the compiler kept a raw address the GC doesn't know about, after relocation the register would point at freed or moved memory. The rule: at every safepoint, every live reference (including derived/interior pointers, with their bases) must be declared in the stack map so the GC can rewrite it to the new address. Anything the GC can't see — a raw pointer stashed in native code, for instance — goes stale after a move. The cures are **handles** (a GC-updated indirection) and **pinning** (forbidding the move for that object).

## Question 9

**What is a derived (interior) pointer and why does it complicate stack maps?**

A derived pointer points *into* an object rather than to its start, e.g. `&arr[i]` in a hot loop. If the GC moves the base object, it must update the derived pointer to the same offset of the new location: `new_p = new_base + (old_p - old_base)`. So the stack map must record not just "this slot is a pointer" but, for derived pointers, "this is derived from the base in *that* slot." Aggressive optimizers create many derived pointers (array iteration, address arithmetic), which is a major reason precise maps for optimized code are hard — and why moving GC and an aggressive JIT are a difficult marriage.

## Question 10

**Why is the allocation fast path part of the runtime↔GC interface?**

Because allocation and collection are co-designed. Each thread gets a **TLAB** (thread-local allocation buffer); allocating is a lock-free **bump-pointer** operation inlined into compiled code (`if top+size<=end { p=top; top+=size }`). When the TLAB fills, the slow path requests a new one and may trigger a GC. The collector relies on the allocator's contiguous arenas (for bump allocation and copying), and the allocator relies on the collector to reclaim space. Allocation rate is the GC's input: it sets GC frequency, which sets pause frequency. So tuning allocation (TLAB size, allocation rate) is GC-integration work.

## Question 11

**How do finalizers and weak references interact with the interface (briefly)?**

Weak references and finalizers add extra root-like classes the collector must handle specially: weak refs are *not* traced as strong roots (so they don't keep objects alive) but must be cleared when their referent dies; finalizable objects must be kept alive for one extra cycle and queued for finalization, then collected on the next. The integration impact is that the runtime maintains special lists and the barrier/scan logic must distinguish strong, weak, soft, and phantom references — extra bookkeeping the compiler/runtime feeds the collector. (The reclamation policy itself is GC-algorithm territory.)

## Question 12

**How do deoptimization and GC root scanning relate?**

Both ask "what is the state of this optimized frame?" and both answer from the same family of safepoint metadata. In HotSpot a compiled method carries an `OopMapSet` (for GC) and debug/scope descriptors (for deopt) at safepoints; deopt rebuilds interpreter frames from that metadata, GC finds/updates roots from it. They are co-tenants: a GC can arrive while a thread is deoptimizing, and rematerializing a scalar-replaced object during deopt may itself allocate and trigger a GC. The interaction is a notorious source of subtle bugs, which is why the metadata and the order of operations are carefully specified.

---

## Engine-Specific

## Question 13

**HotSpot: what is an oop map and how does it relate to a safepoint?**

An **oop map** ("oop" = ordinary object pointer) is HotSpot's stack map: per compiled method, an `OopMapSet` records, for each safepoint offset, which stack slots and registers hold object references (and which are derived pointers, with bases). When the VM stops a thread at a safepoint, it reads the thread's PC, finds the matching oop map, and scans/updates exactly those locations. Safepoints are emitted at loop back-edges, method entries/returns, and call sites; the oop map exists *only* at those points, which is why threads must reach one before being scanned.

## Question 14

**HotSpot: how are threads brought to a safepoint?**

Via cooperative polling. The JIT emits **safepoint polls** that the VM can trigger. Two implementations: a **flag-based** poll (load a global byte, test, branch to the handler) and a **page-trap** poll (a single instruction reads a "polling page"; when the VM wants threads to stop, it `mprotect`s the page unreadable so the next poll faults into a signal handler that parks the thread). Modern HotSpot uses **thread-local** polling pages and **thread-local handshakes** (JEP 312) so it can stop and operate on a single thread without a global STW — essential for concurrent collectors.

## Question 15

**HotSpot G1: what barriers does it emit and why?**

G1 uses a combination. A **pre-write SATB barrier** records the *old* value of a field before it's overwritten (snapshot-at-the-beginning), so concurrent marking won't miss an object whose only reference is being erased. A **post-write barrier** maintains G1's **remembered sets** (card-table-style) to track cross-region references, so G1 can collect a subset of regions without scanning the whole heap. The compiler emits both around reference stores while the relevant phases are active, with cheap inline fast paths and out-of-line slow paths (queue maintenance, region-crossing checks).

## Question 16

**HotSpot ZGC: explain colored pointers and the load barrier.**

ZGC encodes GC state in unused high bits of the pointer (**colored pointers**: marked0/marked1/remapped/finalizable). On (almost) every reference load, the compiler emits a **load barrier**: test the color bits against a "bad mask"; if clean, use the pointer directly (fast path = a load plus a not-taken branch); if not, the slow path relocates/remaps the object, returns the corrected pointer, and **self-heals** the source slot via CAS so future loads are fast. Because color lives in the pointer, ZGC uses **multi-mapping** so all colored views alias the same physical object. This enables concurrent relocation with sub-millisecond pauses, paying a per-load throughput tax.

## Question 17

**HotSpot Shenandoah: what was the Brooks pointer and how did the barrier model evolve?**

Classic Shenandoah gave every object an extra header word — a **Brooks forwarding pointer** — that points to the object's current copy (itself normally, or the new location during relocation). Reads indirect through it, so a stale pointer still reaches the live object, enabling concurrent moving. The cost was an extra word per object and an indirection on reads. Later Shenandoah replaced this with a **load-reference barrier** scheme (closer to ZGC's) that drops the per-object word and instead fixes up references at load time. Both put the integration point at the **load** to support concurrent compaction.

## Question 18

**Go: explain the hybrid write barrier and what property it buys.**

Go's concurrent collector is non-moving but faced expensive stop-the-world stack *re-scans* at the end of marking. The **hybrid write barrier** (Go 1.8) combines a **Yuasa-style deletion barrier** (shade the old pointer being overwritten) and a **Dijkstra-style insertion barrier** (shade the new pointer). The payoff: a goroutine's stack can be scanned **once**, marked black, and **never re-scanned**, because the barrier guarantees the marker won't miss an object even as the goroutine keeps mutating. This eliminates the STW stack re-scan and is the main reason Go pauses are typically well under a millisecond.

## Question 19

**Go: how does Go bound time-to-safepoint in tight loops?**

Originally Go used only cooperative preemption (at function calls), so a tight loop with no calls could resist preemption, producing long TTSP. **Asynchronous preemption** (Go 1.14) fixes this: the runtime sends an OS signal to a running goroutine; the signal handler checks the goroutine's PC against precise stack maps emitted for the preemption point and stops it safely even mid-loop. This is Go choosing signal-based preemption to bound TTSP without inserting a poll on every loop iteration.

## Question 20

**V8: how does V8 find roots given JS plus a C++ heap?**

V8 runs *multiple* root-finding strategies. Compiled JS uses precise scanning where possible; at native (C++) frames it may scan **conservatively**. C++ code holds references into the heap through **handle scopes** (`v8::HandleScope`, `Local<T>`), an indirection the GC can find and update across moves — the same idea as JNI handles. **Oilpan** (cppgc) manages the C++/Blink object heap with its own tracing and barriers. So a single execution mixes precise (managed) and conservative (native) root finding, plus handle scopes — a pragmatic answer to constant managed/native crossing.

## Question 21

**.NET: what is "GC info," and what are fully- vs partially-interruptible methods?**

The CLR JIT emits **GC info** (stack maps) per method describing which registers/slots hold object references at each **GC-safe point**. A **fully-interruptible** method has GC-safe points almost everywhere (larger GC info, finer stop granularity, shorter TTSP); a **partially-interruptible** method has them only at call sites (smaller GC info, longer worst-case TTSP). The JIT chooses per method, trading metadata size against stop granularity. The CLR also tracks **interior pointers** (`byref`) as the derived-pointer case to update after compaction.

## Question 22

**.NET: how does the CLR suspend threads for GC, and what is hijacking?**

The CLR brings threads to GC-safe points using a mix of mechanisms, including **return-address hijacking**: for a thread without a nearby poll, the runtime overwrites its saved return address so that when the current method returns, control traps into the runtime, which then suspends the thread at that safe point. This covers call-free stretches without a poll there. Combined with polling and cooperative checks, it forms the CLR's thread-suspension protocol. For native interop, **GCHandle** (including pinned handles) is the handle/pinning mechanism so native code can hold references across moves.

## Question 23

**Why did generational ZGC re-introduce a write barrier?**

Original (non-generational) ZGC scanned the whole heap each cycle, which is latency-friendly but CPU-costly under high allocation. **Generational ZGC** adds a young generation to collect short-lived objects cheaply — but a young generation needs to track **old→young** pointers, which requires a **write barrier** (in addition to ZGC's load barrier). The lesson for the interface: improving efficiency often means *adding* an interface obligation (another barrier, more metadata), and codegen must absorb it. Choosing a collector is partly choosing which barriers your hot code pays.

---

## Tricky / Trap

## Question 24

**"The GC paused my app for 300 ms." Is the collector necessarily slow?**

No — and assuming so is the trap. Split the pause into **time-to-safepoint** (reaching safepoint) and **collection** (at safepoint). Frequently the 300 ms is almost entirely TTSP: one thread stuck in a poll-free counted loop or a long native call, while everyone else waits at safepoints. The actual collection may be a few milliseconds. The fix is to eliminate the straggler (counted-loop safepoints, strip mining, async preemption, bounded native sections), *not* to retune the heap or switch collectors. Always attribute before tuning.

## Question 25

**A counted loop `for (int i=0;i<N;i++) sum+=a[i];` causes a multi-hundred-ms pause. Why, with N small enough to run fast?**

Historically the JIT removed safepoint polls from **counted loops** (loops with a known integer bound, presumed short) as an optimization. If `N` is actually huge, the loop runs for a long time with *no poll*, so when a GC is requested the whole VM cannot reach a safepoint until this loop finishes — pathological TTSP, even though the loop body is trivial. The modern mitigation is **loop strip mining** (poll once per strip of iterations). The trap is blaming the GC algorithm when the cause is a missing poll in mutator code.

## Question 26

**Does using a "thread-safe"/atomic pointer store skip the write barrier?**

Not safely. The write barrier exists for *GC correctness*, independent of thread-safety. If a pointer store bypasses the compiler's barrier (e.g., via certain low-level `Unsafe`/`unsafe`/raw-memory operations), a concurrent marker may miss the new edge and free a still-reachable object — a true correctness bug, not a performance issue. Atomicity of the store doesn't help the GC learn about the edge. Any code that writes object pointers must go through (or replicate) the barrier the collector expects.

## Question 27

**Conservative scanning "leaked" memory — an object never freed though it's clearly dead. Bug in the GC?**

No, it's an expected consequence of conservative scanning. Some integer on the stack or in a register happened to hold a value that, interpreted as an address, lands inside the dead object — so the conservative collector kept it alive "just in case." This is **floating garbage** from a false-positive root, not a leak in your code or a GC bug. It's exactly why precise collectors (which use stack maps) and moving collectors avoid conservative scanning: you can't get false positives, and you can compact.

## Question 28

**Your service runs fine on x86 but a custom unsafe pointer trick corrupts memory after a GC on ARM. What class of bug?**

Likely a moving-GC/interface bug: you held a raw pointer the GC couldn't see (not in any stack map, not a handle) across a point where the object could move. On x86 the timing/relocation happened not to bite; on ARM (or under a different collector/heap state) the object relocated and your stale raw pointer dereferenced moved/freed memory. The fix is to use a **handle** (GC-updated indirection) or **pin** the object — never stash a raw managed pointer across a GC-possible point in code the runtime doesn't track.

## Question 29

**A long JNI call blocks the whole GC. Why, and how is it different from a poll-free loop?**

It depends on the native section's kind. A thread *in* ordinary native code is usually treated as "already at a safepoint," so the GC can proceed without it. But a **GC-critical** native section (e.g., `GetPrimitiveArrayCritical`) **pins** objects and may *forbid the GC from moving anything*, effectively blocking a moving collector until the section ends — distinct from a poll-free loop, which delays *reaching* a safepoint (TTSP). One blocks relocation; the other blocks the stop. Both reward short native sections; the fix for the critical case is to copy out and release the pin quickly.

## Question 30

**Adding more application threads made GC slower, not faster. Why might the interface be at fault?**

Several interface reasons: (1) more threads → more roots to scan and a higher chance of a TTSP straggler; (2) **card-table or SATB-queue contention** — the shared barrier state structures become a multi-core bottleneck (including false sharing on the card table); (3) higher aggregate allocation rate → more frequent GCs → more pauses and more barrier executions. The collection *algorithm* may be fine; the *integration* (shared barrier structures, root-set size, allocation rate) scaled badly. Diagnose with a flame graph (barrier CPU), safepoint logs (TTSP), and allocation profiling.

## Question 31

**Is "no locks, only atomics, GC is concurrent" enough to guarantee a small pause?**

No. Concurrent collection shrinks pauses only if **pacing** keeps up — the collector must start early enough to finish before the heap fills. Under an allocation-rate spike, the pacer can mispredict and the collector falls back to a **stop-the-world** collection: a sudden latency cliff. Concurrency is necessary but not sufficient; you also need headroom and a well-tuned pacer. "It's concurrent" does not mean "pauses are always small."

## Question 32

**You micro-benchmarked "the cost of a write barrier" and got ~0 ns. Trustworthy?**

Probably not. The optimizer likely **eliminated** the barrier: stores into a freshly-allocated, non-escaping object need no barrier, and a benchmark whose result isn't used may be optimized away entirely. To measure a real barrier you must defeat elision (make the object escape, consume the result) and confirm in **disassembly** that the barrier is actually emitted. Barrier cost is real in pointer-store-heavy code, but it's easy to "measure" a barrier the compiler already removed.

---

## Design

## Question 33

**Design the stack-map / GC-info scheme for a new JIT. What are the key decisions?**

Decide: **granularity** (fully-interruptible — safepoints almost everywhere, small TTSP, big maps; vs partially-interruptible — safepoints at call sites, small maps, longer TTSP) possibly chosen per method; **encoding** (per-slot is-pointer bitmaps, delta-encoding between adjacent safepoints, dictionary dedup of identical maps); **derived-pointer handling** (record each interior pointer's base slot); **PC→map indexing** (a side table). Budget the metadata against code size and code-cache pressure. Provide a stress mode that runs a GC at *every* safepoint to validate map correctness, since map bugs are silent until a moving GC corrupts memory.

## Question 34

**Design the safepoint protocol to meet a p99.9 pause SLO across many threads.**

Pause tails are owned by the **slowest thread**, so design for stragglers. Use **page-trap or signal-based polls** (single-instruction polls; signals stop poll-free loops). Use **per-thread handshakes** so one straggler is local rather than stalling the world (and to let a concurrent collector scan one thread's roots at a time). Define a correct **native-transition state machine** (in-native = safe; the *return* side synchronizes with any in-progress GC). Enforce **no poll-free hot loops** (counted-loop safepoints / strip mining) and **bounded native critical sections**. Monitor the **TTSP distribution** (histogram, not mean) and alert on the tail.

## Question 35

**Design the write-barrier ABI shared by the codegen and GC teams.**

Specify, formally and identically on both sides: **inputs** (which registers hold object, field address, value); **outputs** (none for write; corrected pointer for load barriers); **clobbers** (which registers the barrier may destroy, so codegen saves live values); **allowed operations** (fast path may *not* allocate, safepoint, block, or throw; only the out-of-line slow path may); **out-of-line layout** (inline fast path, stub slow path, predicted-not-taken); and **elision rules** (omit for init stores into non-escaped allocations, null stores, same-region stores). Then **fuzz it**: stress GC at every safepoint, force every slow path, randomize the schedule around native transitions. The failure mode (a dropped barrier freeing a live object) is rare and catastrophic, so it must be manufactured by a harness, not found in production.

## Question 36

**Design the allocation fast path and its handoff to the collector.**

Give each thread a **TLAB**; allocation is an inlined **bump pointer** (`if top+size<=end { p=top; top+=size; return p }`). Size TLABs from telemetry (too small → shared-heap contention and slow-path storms; too big → memory waste and retained slop). On TLAB exhaustion, the slow path requests a new TLAB; if the heap is at the **pacer trigger**, start a concurrent GC (paced to finish before full); if the heap is full, fall back to STW (the cliff — avoid via headroom). Add **allocation-site sampling** as a per-thread byte counter decremented in the fast path (record a stack when it crosses zero, off the hot path, with unbiased intervals). Remember **allocation rate is the GC throttle** — the cheapest tuning is allocating less.

## Question 37

**Design a runbook for a "p99.9 GC pause regression" alert.**

(1) **Split** the pause into TTSP ("reaching safepoint") vs collection ("at safepoint") from safepoint logs. (2) If **TTSP tail** dominates, find the straggler: counted/poll-free loop (enable strip mining / async preempt), long native call or pin (bound it / copy-out), or a descheduled thread (CPU isolation). (3) If **collection** dominates, examine root-set size and whether the **pacer fell back to STW** (add headroom, tune GOGC/heap). (4) If it's actually a **throughput** regression (not a pause), profile **barrier CPU** (flame graph) and **allocation rate** (allocation profiler) and restructure mutations or change collector. Rule: never reach for GC tuning flags before steps 1–2.

## Question 38

**You must call a moving-GC runtime from C/C++ and hold references for a long time. Design the interop.**

Hold long-lived references through **handles** (JNI `NewGlobalRef`, .NET `GCHandle`, V8 `Persistent`/handle scopes) — never raw pointers, because the GC updates the handle table when objects move. Keep **pinning/critical** windows minimal: copy data out (`GetByteArrayRegion`) rather than holding a `GetPrimitiveArrayCritical` pin across heavy work, since pinning can block a moving collector and fragment the heap. Follow the engine's **pointer-passing rules** (e.g., cgo's rules on passing Go pointers to C). Treat the **native-transition** boundary as a synchronization point. Net effect: the GC stays unblocked and can relocate freely while your native code runs.

---

## Cheat Sheet

```text
+----------------------------------------------------------------------------+
| RUNTIME ↔ GC INTEGRATION — INTERVIEW MUST-KNOW                             |
+----------------------------------------------------------------------------+
| The interface gives the GC THREE things:                                   |
|   1. stack maps / oop maps  -> WHERE the pointers are (per PC)             |
|   2. safepoints             -> WHEN it's safe to scan/move                 |
|   3. barriers (write/read)  -> NOTICE of pointer changes / moves          |
+----------------------------------------------------------------------------+
| Precise (maps) -> can MOVE, no floating garbage                            |
| Conservative   -> no maps, CANNOT move, floating garbage                   |
+----------------------------------------------------------------------------+
| Pause = TIME-TO-SAFEPOINT (reach) + COLLECTION (at safepoint)             |
|   long TTSP = poll-free loop / long native call -> straggler              |
+----------------------------------------------------------------------------+
| Write barrier -> per STORE  (card mark / SATB / incr-update)              |
| Read/load barrier -> per LOAD (concurrent COMPACTION: ZGC/Shenandoah)     |
+----------------------------------------------------------------------------+
| HotSpot: oop maps; flag+page-trap polls; G1=SATB+card; ZGC=colored ptr    |
| Go: hybrid write barrier (no STW stack rescan) + async signal preempt     |
| V8: precise(JS)+conservative(native)+handle scopes+Oilpan                 |
| .NET: GC info; full vs partial interruptible; byref interior; hijacking   |
+----------------------------------------------------------------------------+
| Moving GC: raw pointers die across a move -> use HANDLES or PINNING       |
| Allocation: TLAB bump fast path; alloc RATE = the GC throttle             |
| Diagnose: SPLIT TTSP vs collection BEFORE tuning the collector            |
+----------------------------------------------------------------------------+
```

---

## Further Reading

- *The Garbage Collection Handbook* (2nd ed.) — Jones, Hosking, Moss. Stack maps, safepoints, barriers, concurrent coordination.
- *HotSpot Glossary* and OpenJDK source (`oopMap.cpp`, `safepoint.cpp`) — oop maps and safepoint polling. https://openjdk.org/groups/hotspot/docs/HotSpotGlossary.html
- *JEP 312 (thread-local handshakes), JEP 333/439 (ZGC, generational ZGC), JEP 379 (Shenandoah)* — https://openjdk.org/jeps/
- *Go 1.8 hybrid write barrier* proposal and *Go 1.14 async preemption* design. https://go.googlesource.com/proposal/
- *A Guide to the Go Garbage Collector* — pacing, barriers. https://go.dev/doc/gc-guide
- *V8 Oilpan / cppgc* and Orinoco blog posts — precise vs conservative root finding, handles. https://v8.dev/blog
- *.NET Book of the Runtime* — GC info, GC-safe points, thread suspension/hijacking. https://github.com/dotnet/runtime/blob/main/docs/design/coreclr/botr/
- *Safepoints: Meaning, Side Effects and Overheads* — Nitsan Wakart. https://psy-lob-saw.blogspot.com/
