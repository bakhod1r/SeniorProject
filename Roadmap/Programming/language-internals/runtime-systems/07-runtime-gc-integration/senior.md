# Runtime ↔ GC Integration — Senior Level

> **Topic:** [Runtime ↔ GC Integration](README.md)
> **Focus:** The hard cases of the interface across real engines: precise stack maps for aggressively optimized code, deopt × GC interaction, Go's hybrid write barrier, ZGC/Shenandoah load (colored-pointer) barriers, read-barrier vs write-barrier tradeoffs, and engineering long-TTSP and barrier-cost incidents. Still the *interface*, not the collection algorithm.

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

> Focus: **Where the interface gets genuinely hard** — and how four production engines (HotSpot, Go, V8, .NET) actually solve it.

By now the contract is clear: precise stack maps for roots, safepoints for timing, barriers for change tracking, handles/pinning for moving GC. The senior level is about the places where these are *hard to get right and expensive to get wrong*:

- **Precise maps for optimized code.** A naive interpreter has easy stack maps. An aggressive JIT does register allocation, inlining, scalar replacement, loop transformations, and creates *derived* and *temporarily-untyped* values. Producing a correct, precise map at every safepoint of *that* code is a deep co-design problem. Get it wrong and a moving GC corrupts memory.
- **Deoptimization × GC.** Deopt rewrites a thread's optimized frame back into interpreter frames. Deopt points and safepoints overlap; the GC and the deoptimizer share the same metadata machinery (maps describing the frame). Their interaction is a classic source of subtle bugs.
- **Read barriers and colored pointers.** Concurrent *compaction* (ZGC, Shenandoah) needs the mutator to be corrected *when it loads a possibly-moved pointer* — a **load/read barrier**, often implemented with metadata bits stored *in the pointer itself* (colored pointers / Brooks forwarding). This shifts cost from stores to loads, a fundamentally different integration point.
- **Go's hybrid write barrier.** A specific, elegant solution that lets Go avoid a stop-the-world stack re-scan, by combining deletion and insertion barriers.

The senior brief: you must be able to reason about *why* an engine put its barrier on the load instead of the store, *what* metadata the JIT must preserve so a moving GC stays correct, and *how* to debug a 500 ms tail-latency incident down to "a counted loop with no poll" or "a write-barrier storm in a graph mutation." We keep the focus on the *interface*; the collection algorithms themselves remain in the memory-management topic and are referenced only to motivate integration decisions.

> 🎓 **Why this matters at the senior level:** This is the level where you own the latency SLO of a managed service, or you contribute to a runtime. Both require treating GC pauses as *integration artifacts you can attribute and fix*, and treating barrier cost as a *codegen decision you can reason about*, not as fate.

---

## Prerequisites

- **Required:** Middle level — stack maps keyed by PC, derived pointers, flag/page-trap polls, card/SATB/incremental-update barriers, handles, pinning.
- **Required:** Solid grasp of JIT compilation: inlining, register allocation, escape analysis/scalar replacement, on-stack-replacement (OSR), deoptimization.
- **Required:** Virtual-memory fluency: multi-mapping, `mprotect`, and the idea of using high pointer bits as metadata.
- **Helpful:** Familiarity with at least two of HotSpot (G1/ZGC/Shenandoah), Go's runtime, V8, and the .NET CLR.
- **Helpful:** Experience reading flame graphs and GC/safepoint logs from a production latency incident.

You do **not** need to be able to implement a collector. You **do** need to reason about the contract a collector imposes on codegen.

---

## Glossary

| Term | Definition |
|------|-----------|
| **OSR (on-stack replacement)** | Swapping a running interpreted/lower-tier frame for a compiled one mid-execution (e.g., a hot loop). The new code needs maps consistent with the in-flight state. |
| **Deoptimization** | Reverting an optimized frame to interpreter frames (e.g., when a speculative assumption fails). Uses frame-description metadata akin to stack maps. |
| **Scalar replacement** | Optimization that explodes a non-escaping object into registers/stack slots, removing the allocation. Those slots must still be mappable if they hold references. |
| **Load barrier / read barrier** | Compiler-emitted code on a *pointer load* that fixes up the loaded reference (e.g., self-heals a stale pointer to a moved object). |
| **Colored pointer** | A pointer with metadata encoded in unused bits (e.g., ZGC uses bits to mark/remap state). The load barrier tests these bits. |
| **Brooks pointer / forwarding pointer** | An extra word per object pointing to the object's current location; reads indirect through it during relocation (classic Shenandoah). |
| **Self-healing barrier** | A load barrier that, on encountering a stale pointer, rewrites the source slot with the corrected pointer so future loads are cheap. |
| **Hybrid write barrier (Go)** | Go's barrier = deletion (Yuasa-style, shade the old) + insertion (Dijkstra-style, shade the new), enabling no STW stack re-scan. |
| **Stack scanning (Go)** | Go scans goroutine stacks at safepoints; the hybrid barrier lets stacks be scanned once and marked black without re-scan. |
| **GC-safe region / preemptible point** | Go's asynchronous preemption inserts safepoints so even tight loops can be stopped (signal-based since Go 1.14). |
| **Frame descriptor** | Metadata describing a stack frame's layout, shared by exception handling, deopt, and GC root scanning. |
| **Remembered set** | Per-region record of incoming cross-region pointers (G1), maintained by the post-write barrier. (Algorithm-adjacent; here as barrier consumer.) |
| **Multi-mapping** | Mapping the same physical memory at several virtual addresses so colored-pointer variants alias to one object (ZGC technique). |

---

## Core Concepts

### 1. Precise Stack Maps Under Aggressive Optimization

The interpreter's stack maps are trivial: the operand stack and locals have known types. The JIT destroys that simplicity:

- **Register allocation** spreads a single logical reference across registers and spill slots over its lifetime. The map at each safepoint must name *wherever it currently lives*.
- **Inlining** collapses many source frames into one machine frame; the map must still allow reconstructing per-inlined-method liveness (for deopt) while listing all live oops (for GC).
- **Scalar replacement** turns an object into loose slots; if any slot holds a reference, the map must mark it — otherwise the GC misses a root.
- **Derived/interior pointers** proliferate (array iteration, field-address arithmetic); each needs a base recorded.
- **Speculative/uncommon-trap points** must also be safepoints, so the deoptimizer can rebuild frames.

The senior insight: **the precision of root scanning is bounded by the precision of the compiler's liveness and type tracking.** A bug here is silent until a moving GC relocates and the program dereferences a slot the GC didn't update (or updated wrongly). This is why moving collectors and aggressive optimizers are a hard marriage, and why engines invest enormous test effort (stress GC at every safepoint) to validate maps.

### 2. Deoptimization Shares The GC's Metadata

Deopt and GC root scanning both ask "what is the state of this optimized frame?" — and both answer with the same family of metadata. In HotSpot, a compiled method carries both an `OopMapSet` (for GC) and **debug info / scope descriptors** (for deopt) at safepoints. The interactions:

- A safepoint may be reached *because* of a GC, *or* because a speculative assumption failed and we must deopt. The runtime must handle "GC arrives while a thread is mid-deopt" and "deopt arrives at a GC safepoint."
- During deopt, the frame is being rewritten; a GC scanning that frame must see a consistent view. Engines serialize these or define a precise order (deopt completes to a known state that the GC map describes).
- Scalar-replaced objects must be **rematerialized** on deopt (re-allocated, possibly triggering GC) — a deopt that itself allocates and may provoke a collection. The metadata must let the deoptimizer reconstruct the object *and* let any triggered GC find roots in the half-built frame.

Seniors should know: deopt is not GC, but they are *co-tenants of the safepoint metadata*. Many "impossible" crashes live at their intersection.

### 3. Read/Load Barriers And Colored Pointers (ZGC, Shenandoah)

Generational/STW collectors mostly need **write barriers** (track stores). Concurrent **compaction** — moving objects while the mutator runs — needs the mutator to never observe a *stale* pointer to a moved object. The natural place to enforce that is the **load**: when the mutator loads a reference, a **load barrier** checks whether the object has moved and, if so, corrects the pointer.

**ZGC** encodes state in the pointer itself — a **colored pointer**. On a 64-bit address, ZGC uses several high bits as color (marked0/marked1/remapped/finalizable). The load barrier is, in the fast path, a test of those bits:

```asm
    mov    rax, (obj_field)        ; load the (colored) reference
    test   rax, (bad_color_mask)   ; are any "bad" color bits set?
    jnz    zgc_load_barrier_slow   ; rare: relocate/remap, self-heal the slot
```

The fast path is a load plus a test-and-not-taken-branch. The slow path relocates the object if needed, remaps the pointer to the new address, **self-heals** by writing the corrected pointer back into the source slot, and returns the good pointer. Because the color is *in the pointer*, the same physical object can be addressed through different colored pointers; ZGC uses **multi-mapping** so all colors alias the same memory. The payoff: concurrent relocation with sub-millisecond pauses, at the cost of a barrier on (almost) every load.

**Shenandoah** historically used a **Brooks forwarding pointer**: every object has an extra header word that points to itself, or to its new copy during relocation. Reads indirect through it (`obj = *(obj->fwd)`), so a stale pointer still reaches the current object. Later Shenandoah versions moved to a load-reference-barrier scheme closer to ZGC's to reduce the per-object word overhead. Either way: **the integration point moved from the store to the load**, which is the defining senior-level distinction between these collectors and generational ones.

### 4. Write-Barrier vs Read-Barrier Economics

The choice is an engineering tradeoff in *where you pay*:

- **Write barriers** tax pointer **stores**. Most programs load far more than they store, so write barriers are cheap on average — but they can't, by themselves, support concurrent *relocation* (a load could still see a stale pointer).
- **Read/load barriers** tax pointer **loads** (far more frequent) but enable concurrent compaction and self-healing. They make pauses tiny and independent of heap size — ZGC and Shenandoah target sub-millisecond pauses on huge heaps — at a throughput cost (often a few percent to low-double-digits depending on workload).

So: throughput-sensitive batch workload with tolerable pauses → write-barrier collector (ParallelGC, G1). Latency-critical service with large heaps → load-barrier collector (ZGC, Shenandoah). This is a *codegen-cost* decision dressed as a "GC choice."

### 5. Go's Hybrid Write Barrier

Go's concurrent mark-sweep is *non-moving*, so it needs only write barriers — but it has a special problem: goroutine **stacks** can be huge and numerous, and re-scanning all stacks stop-the-world at the end of marking was a major pause source pre-Go-1.8. The fix is the **hybrid write barrier** (Go 1.8), which combines:

- a **Yuasa-style deletion barrier**: shade (mark grey) the *old* pointer being overwritten, and
- a **Dijkstra-style insertion barrier**: shade the *new* pointer being written.

```text
writePointer(slot, ptr):
    shade(*slot)        // deletion part: keep what we're erasing
    if current_stack_is_grey:
        shade(ptr)      // insertion part
    *slot = ptr
```

The key consequence: a goroutine's stack can be scanned **once**, marked black, and **never re-scanned**, because the barrier guarantees the marker won't miss an object even as the goroutine keeps mutating. This eliminates the STW stack re-scan and is the main reason Go's pauses are typically well under a millisecond. It's a textbook example of *the barrier design buying a pause-time property*.

Go also solved its own counted-loop/TTSP problem differently: **asynchronous preemption** (Go 1.14) uses an OS signal to stop a goroutine even inside a tight loop with no explicit poll. The signal handler checks the goroutine's PC against precise stack maps emitted for *every instruction that could be a preemption point*, so it can stop and scan safely. This is Go choosing signal-based preemption over cooperative-only polling to bound TTSP.

### 6. V8's Integration

V8 (JavaScript) is an instructive contrast:

- **Early V8 was conservative** on the stack (Crankshaft era), scanning the stack pessimistically. Modern V8 (Orinoco/Oilpan) moved toward precise scanning where possible, but JS's dynamic nature and the C++ heap (Blink DOM objects, managed by **Oilpan**) make root finding heterogeneous: precise stack maps for compiled JS, plus conservative stack scanning at the C++ boundary, plus handle scopes for C++ references into the heap.
- V8 uses **handle scopes** (`v8::HandleScope`, `Local<T>`) so C++ code holds references the GC can find and update across moves — the same handle pattern as JNI, by a different name.
- V8's **incremental and concurrent marking** uses write barriers; its **scavenger** (young-gen) moves objects, so the compiler/runtime must keep roots precise enough to update them.
- The lesson: a real engine often runs *multiple* root-finding strategies at once (precise for managed code, conservative at native frames), because the program crosses managed/native boundaries constantly.

### 7. .NET CLR Integration

The CLR is a precise, moving (compacting) collector and shows the contract cleanly:

- The JIT emits **GC info** (stack maps) per method, describing which registers/slots hold object references at each **GC-safe point**. There are two regimes: **fully-interruptible** code (safepoints almost everywhere, larger maps) and **partially-interruptible** code (safepoints only at call sites, smaller maps) — a size/latency tradeoff the JIT chooses per method.
- The CLR distinguishes **managed pointers** (`byref`, interior pointers) from object references; interior pointers are the derived-pointer case and the GC tracks them to update after compaction.
- **GCHandle** (and pinned handles) is the .NET handle/pinning mechanism for interop with native code, exactly the "raw pointers can't survive a move" cure.
- The CLR coordinates threads to GC-safe points via **hijacking** (rewriting a thread's return address so it traps into the runtime on return) in addition to polling — a third safepoint mechanism beyond flag and page-trap.

Across HotSpot, Go, V8, and .NET you see the *same contract* solved with different mechanisms: cooperative polls vs page-traps vs signals vs return-address hijacking; write barriers vs load barriers; precise vs hybrid-with-conservative-edges.

### 8. Engineering The Incidents

Two canonical senior incidents:

**Long TTSP.** Symptom: pause logs show large "time to safepoint," small collection time. Causes: a counted loop with no poll (pre-mitigation JVM, or machine-generated code), a thread stuck in a long JNI/native call (which may pin and block a moving GC), or a runaway loop the optimizer stripped of polls. Fixes: enable counted-loop safepoints / strip mining; bound native sections; in Go, ensure async preemption is active; sometimes restructure the hot loop. The diagnostic discipline: *attribute the pause to integration before touching GC tuning flags*.

**Write-barrier storm.** Symptom: a graph/tree mutation workload spends a surprising fraction of CPU in barrier code; throughput drops under a concurrent collector. Cause: many pointer stores per unit work, each paying the barrier; possibly card-table false sharing across cores. Fixes: batch mutations, prefer value/index representations in hot structures, enable conditional card marking, pad hot card-table regions, or choose a collector whose barrier is cheaper for the workload. The senior move: *read the disassembly, confirm the barrier shape, and measure barrier CPU directly* (perf annotate / flame graph) rather than guessing.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Precise map under optimization** | A choreographer's notes for a chaotic dance: even as dancers swap places (registers) and merge routines (inlining), the notes must always say exactly who is where at each beat (safepoint). |
| **Deopt × GC co-tenancy** | Two crews sharing one blueprint — one renovating a frame (deopt), one inventorying it (GC). They must never read the blueprint mid-edit. |
| **Colored pointer** | A passport whose stamps (color bits) encode your visa status; the border agent (load barrier) glances at the stamps and waves you through or sends you to processing. |
| **Self-healing load barrier** | A GPS that, when it notices a road moved, both reroutes you *and* updates your saved address so next time is instant. |
| **Brooks forwarding pointer** | A "we've moved" sticker on the old shop door pointing to the new address; customers always get redirected. |
| **Go hybrid barrier** | Photographing a room once and trusting that anyone who later removes or adds furniture signs a logbook, so you never re-photograph. |
| **Return-address hijacking (.NET)** | Swapping the exit sign so that when a worker leaves the room, they're routed through the inspector's office. |

---

## Mental Models

### The "Where Do You Pay?" Model

Every GC integration is a decision about *where the mutator pays the coordination tax*. Write-barrier collectors charge at the store (rare-ish, cheap, but can't move concurrently). Load-barrier collectors charge at the load (frequent, but unlock concurrent compaction and tiny pauses). Conservative scanning charges *nothing at runtime* but pays in floating garbage and no compaction. When you compare collectors, translate their marketing into "what does my code pay, per load and per store, and what pause property do I buy with it?"

### The "Maps Are A Shared Contract, Not Just A GC Thing" Model

Stack maps / GC info are consumed by *three* subsystems: the GC (find/update roots), the deoptimizer (rebuild frames), and exception handling/stack unwinding (find handlers and live state). Think of the map as a *single source of truth about frame layout at safepoints*, with several readers. Bugs often appear at the seams between readers (a GC during a deopt of a scalar-replaced object). Holding all three readers in mind explains otherwise-baffling crashes.

### The "Pause Time Is Decoupled From Heap Size — At A Price" Model

ZGC/Shenandoah's pitch is "pause time independent of heap size." The mechanism is *concurrent everything*, enabled by load barriers and colored pointers. The price is throughput: every load may test a color bit. Internalize the duality — you don't get small pauses on big heaps for free; you trade per-load CPU for it. Decide based on whether your SLO is throughput or tail latency.

---

## Code Examples

### Recognizing a ZGC load barrier

```java
public class LoadBarrier {
    static class Node { Node next; }
    static Node follow(Node n) { return n.next; }   // a pointer LOAD
}
```

```bash
java -XX:+UseZGC -XX:+UnlockDiagnosticVMOptions -XX:+PrintAssembly \
     -XX:CompileCommand=print,LoadBarrier.follow LoadBarrier
```

Around the load of `n.next` you'll see a load followed by a test against a "bad mask" and a branch to a stub — the colored-pointer load barrier. Compare with a non-pointer-returning method, which has no such test. This is the senior-level "the barrier is on the *load* now" made concrete. (On ParallelGC the same method has *no* barrier on the load at all.)

### Go: hybrid write barrier and async preemption, observed

```go
package main

import "runtime"

type N struct{ next *N }

//go:noinline
func mutate(a, b *N) { a.next = b } // hybrid write barrier when marking

func spin() {
    // A tight loop with no function calls. Pre-Go-1.14 this could resist
    // preemption (bad TTSP). With async preemption, a signal can stop it.
    x := 0
    for i := 0; i < 1_000_000_000; i++ {
        x ^= i
    }
    _ = x
}

func main() {
    runtime.GC()
    a, b := &N{}, &N{}
    mutate(a, b)
    spin()
}
```

```bash
go build -gcflags=-S ./...                 # find runtime.gcWriteBarrier around a.next=b
GODEBUG=gctrace=1,asyncpreemptoff=0 go run .   # observe GC + preemption behavior
```

`go tool objdump` on `mutate` shows the write-barrier call; toggling `GODEBUG=asyncpreemptoff=1` and watching pause behavior demonstrates how signal-based preemption bounds TTSP for `spin`.

### Diagnosing TTSP vs collection (JVM)

```bash
# Separate "reaching safepoint" (TTSP) from "at safepoint" (collection).
java -Xlog:safepoint:stdout:tags,time \
     -XX:+UnlockDiagnosticVMOptions -XX:+PrintGCApplicationStoppedTime \
     -jar service.jar
```

If `Reaching safepoint` dominates, hunt for a non-yielding thread (counted loop, native call). If `At safepoint` dominates, it's genuine collection work — *now* GC tuning (heap size, collector choice, generation sizing) is the lever. A senior never tunes the collector before splitting these.

### A self-healing load barrier, in pseudocode

```text
load_barrier(slot):
    ref = *slot
    if color_is_good(ref):
        return ref                       // fast path: just a bit test
    // slow path:
    obj = remap(ref)                     // find current location (relocate if needed)
    good = recolor(obj)                  // pointer with current/good color
    CAS(slot, ref, good)                 // SELF-HEAL: fix the source slot
    return good
```

The self-heal means the *first* load through a stale slot pays; subsequent loads are fast. This is why ZGC's amortized load-barrier cost is lower than "a slow path on every load" would suggest.

### Why scalar replacement needs a precise map (deopt + GC)

```java
// If 'p' is scalar-replaced, its fields live in registers/slots. At a safepoint
// inside compute(), the map must still mark the slot holding 'p.ref' as an oop,
// AND the deopt metadata must be able to REMATERIALIZE 'p' (re-allocate it).
static Object compute(boolean cond, Object x) {
    var p = new Object[]{ x };     // may be scalar-replaced (non-escaping)
    if (cond) heavyCallThatMayDeopt();   // safepoint; possible deopt -> rematerialize p
    return p[0];
}
```

If the map omits the slot holding `x`, a moving GC frees or fails to update it. If the deopt metadata can't rebuild `p`, deopt corrupts the frame. Both consume the same safepoint metadata — the senior point about co-tenancy.

---

## Pros & Cons

| Mechanism / choice | Pros | Cons |
|--------------------|------|------|
| **Precise maps under JIT** | Exact roots even in optimized code; enables moving GC. | Hard to produce correctly; large test surface; derived-pointer and inlining complexity. |
| **Shared safepoint metadata (GC+deopt+unwind)** | One source of truth; less duplication. | Tight coupling; intersection bugs (GC during deopt). |
| **Load/colored-pointer barriers (ZGC)** | Concurrent compaction; pauses independent of heap size; self-healing amortizes cost. | Per-load throughput tax; multi-mapping complexity; 64-bit address-bit pressure. |
| **Brooks forwarding (early Shenandoah)** | Simple read indirection; concurrent moving. | Extra header word per object; an indirection on reads. |
| **Go hybrid write barrier** | No STW stack re-scan; sub-ms pauses; non-moving simplicity. | Barrier on every pointer store during marking; still write-only (no compaction). |
| **Async (signal) preemption (Go)** | Bounds TTSP even in tight loops. | Needs per-PC stack maps; signal-handling complexity; some platforms harder. |
| **Return-address hijacking (.NET)** | Stops threads at returns without a poll there. | Subtle; interacts with exception handling and tail calls. |
| **Partially-interruptible code (.NET)** | Smaller GC info; safepoints only at calls. | Coarser stop granularity; longer TTSP in call-free stretches. |

---

## Use Cases

- **Owning a managed-service latency SLO.** Attribute pauses to TTSP vs collection vs barriers; pick ZGC/Shenandoah vs G1 by translating the barrier economics to your load.
- **Contributing to or embedding a runtime.** Producing/validating precise maps, wiring safepoints into your codegen, choosing a barrier discipline.
- **Native interop at scale.** Designing handle lifetimes, pinning windows, and critical sections so a moving GC stays unblocked and correct.
- **Performance forensics.** Reading disassembly to confirm a load barrier, a write barrier, or a missing poll is the cause of a regression.
- **Choosing data representations.** Deciding pointer-heavy vs value/index layouts in hot structures based on barrier cost under the chosen collector.

---

## Coding Patterns

### Pattern 1: Attribute before you tune

```text
1. Pull pause data with TTSP vs collection split (-Xlog:safepoint / gctrace).
2. If TTSP dominates -> find the non-yielding thread (loop/native), fix it.
3. If collection dominates -> consider collector choice / heap sizing.
4. If barrier CPU dominates (flame graph) -> restructure mutations / pick collector.
Never skip to step 3 or 4.
```

### Pattern 2: Keep native interop GC-friendly

```c
/* JNI: hold references via handles; keep critical (pinning) regions tiny. */
jobject g = (*env)->NewGlobalRef(env, obj);     /* survives moves */
/* ... long-lived use ... */
{
    jbyte* p = (*env)->GetPrimitiveArrayCritical(env, arr, 0); /* PINS, may block moving GC */
    memcpy(dst, p, n);                                          /* minimal work */
    (*env)->ReleasePrimitiveArrayCritical(env, arr, p, 0);
}
(*env)->DeleteGlobalRef(env, g);
```

### Pattern 3: Reduce load-barrier pressure under ZGC/Shenandoah

```text
// Loads of references pay the barrier; loads of primitives don't.
// In hot loops, hoist a reference load out of the loop where the algorithm allows,
// or iterate over primitive/value arrays rather than arrays of references.
ref = obj.field;          // pay the load barrier ONCE
for (i...) use(ref, i);   // not once per iteration
```

### Pattern 4: Make hot objects non-escaping to delete barriers and allocations

```java
// Escape analysis can scalar-replace this; no allocation, no barriers on its stores.
double dist(double x1, double y1, double x2, double y2) {
    var p = new double[]{x2 - x1, y2 - y1};   // likely scalar-replaced
    return Math.hypot(p[0], p[1]);
}
```

---

## Best Practices

- **Split TTSP from collection time in every pause investigation.** It is the single highest-leverage habit; it routes you to integration vs algorithm fixes.
- **Choose the collector by its barrier economics relative to your SLO**, not by reputation: write-barrier/throughput (ParallelGC, G1) vs load-barrier/latency (ZGC, Shenandoah).
- **Keep native critical/pinning windows minimal**, and prefer handles to raw pointers across any boundary where a GC can run.
- **Validate barrier and poll presence in disassembly** when chasing regressions; the optimizer's choices (elimination, strip mining) change the picture per method and per collector.
- **Respect deopt × GC co-tenancy** when writing intrinsics or runtime glue: anything that allocates during deopt (rematerialization) can trigger a GC mid-frame-rebuild.
- **Ensure preemptibility of generated/numeric loops** (counted-loop safepoints on the JVM; rely on Go's async preemption; avoid hand-rolled poll-free assembly).
- **Treat per-load/per-store cost as a design input** for hot data structures under concurrent-moving collectors.

---

## Edge Cases & Pitfalls

- **GC during deopt of scalar-replaced objects.** Rematerialization allocates; if that triggers a GC, the partially-rebuilt frame must still be root-scannable. A classic intersection bug; rare but catastrophic.
- **Stale colored pointers leaking past a barrier.** If any pointer load bypasses the load barrier (a hand-written intrinsic, a missed codegen path), the mutator can dereference a pre-move address under ZGC/Shenandoah — memory corruption. Engines audit every load path for this reason.
- **Address-bit exhaustion for colored pointers.** ZGC consumes high virtual-address bits for color; this constrains usable address space and interacts with ASLR, large pages, and certain platforms (and motivated generational ZGC's redesign).
- **Go pointer-passing rule violations.** Passing a Go pointer to C and retaining it across a GC can leave C holding a moved/invalid pointer; the cgo rules exist precisely because of the moving/scanning contract.
- **Hijacking vs tail calls / exception unwinding (.NET).** Return-address hijacking must cooperate with frames that don't return normally; mishandling corrupts control flow.
- **Conservative edges keeping garbage alive (V8/Oilpan, native frames).** Where an engine falls back to conservative stack scanning at native frames, integer-shaped values can pin objects — intermittent retention that looks like a leak.
- **Card-table / SATB-queue contention.** Under heavy multi-core mutation, the *shared* barrier state structures become the bottleneck, not the GC algorithm. False sharing on the card table is a real, measurable senior-level problem.
- **Partially-interruptible code lengthening TTSP (.NET).** Methods with safepoints only at call sites can have long call-free stretches that delay reaching a GC-safe point.

---

## Cheat Sheet

```text
┌───────────────────────────────────────────────────────────────────────────┐
│        RUNTIME ↔ GC INTEGRATION — SENIOR (engine-specific)                 │
├───────────────────────────────────────────────────────────────────────────┤
│ WHERE YOU PAY:                                                            │
│   write barrier  -> per STORE  (generational/concurrent-mark; no compaction)│
│   load barrier   -> per LOAD   (concurrent COMPACTION; tiny pauses)        │
│   conservative   -> nothing at runtime (no compaction; floating garbage)  │
├───────────────────────────────────────────────────────────────────────────┤
│ HotSpot : oop maps; flag+page-trap polls; G1=SATB+card; ZGC=colored ptr    │
│           load barrier+multimap; Shenandoah=Brooks fwd / load-ref barrier  │
│ Go      : hybrid write barrier (deletion+insertion) -> no STW stack rescan; │
│           async (signal) preemption bounds TTSP; non-moving               │
│ V8      : precise(JS)+conservative(native frames); handle scopes; Oilpan;  │
│           write barriers for incremental/concurrent marking; scavenger moves│
│ .NET    : per-method GC info; fully vs partially interruptible;           │
│           interior(byref) pointers; GCHandle/pinning; return-addr hijack    │
├───────────────────────────────────────────────────────────────────────────┤
│ SHARED METADATA readers: GC roots  |  deoptimizer  |  stack unwinder        │
│   intersection bug zone: GC during deopt of scalar-replaced objects        │
├───────────────────────────────────────────────────────────────────────────┤
│ INCIDENT PLAYBOOK:                                                        │
│   pause big? -> split TTSP vs collection FIRST                             │
│   TTSP big   -> non-yielding loop / long native call -> fix preemption     │
│   barrier CPU-> flame graph; restructure mutations / change collector      │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Precise stack maps under aggressive optimization** are the hard core of the interface: register allocation, inlining, scalar replacement, and derived pointers all must remain mappable at every safepoint, or a moving GC corrupts memory.
- **Deopt, GC root scanning, and stack unwinding share safepoint metadata.** Their intersection (e.g., GC during rematerialization of scalar-replaced objects on deopt) is a fertile bug zone.
- **Load/read barriers** shift the integration point from the store to the **load**, enabling concurrent compaction. **ZGC** uses **colored pointers** (state in high address bits) plus **multi-mapping** and **self-healing**; **Shenandoah** used **Brooks forwarding pointers**, later a load-reference barrier. You buy heap-size-independent pause times with a per-load throughput tax.
- **Write-barrier vs read-barrier** is fundamentally a "where do you pay?" decision: stores (cheap on average, no concurrent compaction) vs loads (frequent, but tiny pauses).
- **Go's hybrid write barrier** (deletion + insertion) lets stacks be scanned once and never re-scanned, eliminating the STW stack re-scan; **async signal preemption** bounds Go's TTSP even in poll-free loops.
- **V8** runs mixed precise/conservative root finding (managed vs native frames) with handle scopes and Oilpan; **.NET** uses per-method GC info with fully/partially-interruptible regimes, interior pointers, GCHandle/pinning, and return-address hijacking.
- **Engineering discipline:** for any pause, **split TTSP from collection** before tuning; for any throughput regression, **confirm the barrier/poll in disassembly and measure its CPU** before guessing. The interface, not the algorithm, is usually where the incident lives.

---

## Further Reading

- *The Garbage Collection Handbook* (2nd ed.) — Jones, Hosking, Moss. Barriers, concurrent collection coordination, safepoint design.
- *ZGC: A Scalable Low-Latency Garbage Collector* and the OpenJDK ZGC wiki — colored pointers, load barriers, multi-mapping. https://wiki.openjdk.org/display/zgc/Main
- *Shenandoah GC* documentation and Brooks-pointer / load-reference-barrier papers (Flood, Kennke et al.). https://wiki.openjdk.org/display/shenandoah/Main
- *Go 1.8 hybrid write barrier* proposal (Austin Clements). https://go.googlesource.com/proposal/+/master/design/17503-eliminate-rescan.md
- *Go scheduler async preemption* (Go 1.14) design and runtime source. https://github.com/golang/go/issues/24543
- *HotSpot deoptimization and OopMaps* — OpenJDK source (`deoptimization.cpp`, `oopMap.cpp`, `safepoint.cpp`).
- *V8 Oilpan / cppgc* and *Orinoco* blog posts — precise vs conservative root finding, handle scopes. https://v8.dev/blog
- *.NET GC design* — `coreclr` docs and the BOTR (Book of the Runtime) chapters on the GC info, GC-safe points, and stackwalking. https://github.com/dotnet/runtime/tree/main/docs/design/coreclr
- *A Unified Theory of Garbage Collection* — Bacon, Cheng, Rajan. For the tracing/refcounting duality that shapes barrier choices.

---

## Diagrams & Visual Aids

### Write Barrier vs Load Barrier — Where You Pay

```text
WRITE-BARRIER COLLECTOR (G1, ParallelGC)          LOAD-BARRIER COLLECTOR (ZGC, Shenandoah)
   store ptr ──► [barrier: record change]            load ptr ──► [barrier: test color/fwd]
   loads are FREE                                     stores are (mostly) free
   ✗ cannot relocate concurrently                     ✓ relocates concurrently, tiny pauses
   cheap on average (loads >> stores)                 taxes the frequent op (loads)
```

### ZGC Colored Pointer + Self-Healing Load Barrier

```text
 63                          0
 [ color bits | object address ]   <- the pointer carries state

 load_barrier(slot):
   ref = *slot
   if (ref & BAD_MASK) == 0: return ref            ; fast: 1 test, not-taken
   obj  = remap/relocate(ref)
   good = recolor(obj)
   CAS(slot, ref, good)                            ; SELF-HEAL the source slot
   return good
```

### Go Hybrid Write Barrier

```text
writePointer(slot, new):
    shade(*slot)                 ; DELETION: preserve old target (Yuasa)
    if writing-thread stack is grey:
        shade(new)               ; INSERTION: preserve new target (Dijkstra)
    *slot = new
  ===> stacks scanned ONCE, marked black, never re-scanned ===> sub-ms pauses
```

### Shared Safepoint Metadata, Three Readers

```text
                ┌──────────────── safepoint metadata at PC ───────────────┐
                │  oop map (which slots are refs) + frame/scope descriptors│
                └───────┬───────────────┬────────────────────┬────────────┘
                        ▼               ▼                     ▼
                  GC root scan      deoptimizer        stack unwinder
                 (find/update)   (rebuild frames)   (exceptions/walk)
                        └────────── intersection = subtle bugs ──────────┘
```

### Incident Decision Tree

```text
GC pause too long?
   │
   ├─ split: TTSP ("reaching safepoint") vs collection ("at safepoint")
   │
   ├─ TTSP big? ──► non-yielding loop / long native call
   │                fix: counted-loop safepoints, strip mining, async preempt,
   │                short native critical sections
   │
   └─ collection big? ──► algorithm/heap: collector choice, heap size, gen sizing
                          (barrier CPU big in flame graph? -> restructure mutations
                           or pick a cheaper-barrier collector)
```
