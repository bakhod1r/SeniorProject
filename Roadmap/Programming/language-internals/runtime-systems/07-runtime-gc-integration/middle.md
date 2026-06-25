# Runtime ↔ GC Integration — Middle Level

> **Topic:** [Runtime ↔ GC Integration](README.md)
> **Focus:** The concrete machinery of the interface: how stack maps are encoded, how safepoints are implemented (flag polling vs page-trap polling), what a write barrier actually compiles to, and how a moving collector updates roots. Not how GC *algorithms* work — only how the compiler and runtime *feed* them.

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

> Focus: **The mechanics of the contract.** How does the compiler actually encode "these slots are pointers"? How does a thread actually notice it must stop? What instructions does a write barrier turn into?

At the junior level, the runtime↔GC interface was a hand-shake: maps tell the GC where pointers are, safepoints tell it when it's safe to look, barriers tell it about changes. Now we open each box and see the gears.

This level is where the abstract becomes mechanical. A **stack map** is a real on-disk data structure indexed by program-counter; we'll see how it's keyed and how derived pointers are handled. A **safepoint poll** is real machine code; we'll see the two dominant implementations — an explicit flag load-and-branch, and the cleverer **page-protection trap** that turns a single read instruction into a poll. A **write barrier** is a real instruction sequence; we'll see the **card-marking** barrier of generational collectors and the **deletion/insertion** barriers of concurrent markers, and how the compiler eliminates barriers it can prove are unneeded.

The discipline of this page: we describe the *interface and its implementation*, and treat the collector behind it as a black box that *consumes* roots and *requests* pauses. *Why* a generational collector wants old→young pointers, *why* concurrent marking needs the tri-color invariant — that reasoning is the memory-management topic and is only sketched here in prose to motivate the barrier code.

> 🎓 **Why this matters at the middle level:** This is the level where you can read disassembly and *recognize* the integration: "that `test`/`jne` after the loop body is a safepoint poll," "that store-then-store pair is a card-marking barrier," "that extra load before the field access is a read barrier." Recognizing the integration in generated code is the skill that turns vague GC anxiety into precise performance work.

---

## Prerequisites

- **Required:** Junior level of this topic — roots, precise vs conservative, safepoints, TTSP, the idea of write barriers.
- **Required:** Comfort reading simple assembly (a `mov`, a `test`, a conditional jump) and the idea of a program counter / instruction pointer.
- **Required:** Understanding of virtual memory basics: pages, page permissions (read/write/execute), and page faults.
- **Helpful:** Familiarity with one managed runtime's tooling (JVM `-XX` flags and `-Xlog`, Go's `gctrace`, or .NET's GC config).
- **Helpful:** The concept of JIT compilation and that the same method may be interpreted, then compiled, with different safepoint strategies.

You do **not** need: the internals of any GC algorithm, the math of generational hypotheses, or formal memory-model proofs. We use those only as motivation.

---

## Glossary

| Term | Definition |
|------|-----------|
| **PC / instruction pointer** | The address of the currently executing instruction. Stack maps are keyed by it. |
| **Stack map (keyed by PC)** | A table: given a PC that is a safepoint, which stack offsets and registers hold object references. |
| **Oop map** | HotSpot's name for a stack map. "oop" = ordinary object pointer. There is also the **OopMapSet** per compiled method. |
| **Base pointer** | A pointer to the *start* of an object. |
| **Derived pointer** | A pointer *into the interior* of an object (e.g., `&arr[i]`), or just past it. The GC must track its **base** so it can re-derive it after a move. |
| **Safepoint poll** | The emitted check that lets a thread notice a stop request. |
| **Flag-based poll** | Poll implemented as: load a global byte, branch if nonzero. |
| **Page-trap poll** | Poll implemented as: read a special "polling page"; the runtime makes that page unreadable to force a fault when it wants threads to stop. |
| **Loop strip mining** | Splitting a big counted loop into an inner chunk plus an outer loop, so a safepoint poll lands on the outer back-edge — bounding TTSP without polling every iteration. |
| **Card table** | A byte array, one entry per small region ("card") of the heap, used by generational write barriers to mark "this region has a pointer that may cross generations." |
| **Card-marking barrier** | The write barrier that dirties the card for the modified object. |
| **SATB (snapshot-at-the-beginning)** | A concurrent-marking discipline (used by G1) whose write barrier records the *old* value being overwritten. |
| **Incremental-update barrier** | A concurrent-marking discipline whose barrier records the *new* pointer being installed. |
| **Tri-color invariant** | The marking bookkeeping (white/grey/black) that barriers exist to preserve. Mentioned to motivate barriers; the algorithm itself is GC-internal. |
| **Barrier elimination** | Compiler optimization that omits a barrier it can prove is unnecessary. |
| **Handle** | An indirection (a slot in a table the GC updates) used to hold a reference across code the GC doesn't track (e.g., native calls). |
| **Pinning** | Temporarily forbidding the GC from moving a specific object, so a raw pointer to it stays valid. |

---

## Core Concepts

### 1. Stack Maps: Keyed By PC, One Per Safepoint

A stack map is conceptually a function: `stackMap(pc) → set of locations holding live object references`. The compiler builds it during code generation: at every instruction it designates as a safepoint, it records the liveness and type of every stack slot and register. The result is stored as metadata alongside the compiled method.

When the GC stops a thread, it reads that thread's saved instruction pointer, looks up the matching stack map, and now knows precisely which slots to scan (and, for a moving GC, to update). HotSpot calls this an **oop map**; each compiled method carries an `OopMapSet` indexed by the offsets of its safepoints.

The encoding is compact because it must be — there can be tens of thousands of safepoints in a large program. Typical techniques: bitmaps (one bit per slot: "is this a pointer?"), run-length or delta encoding across nearby safepoints (adjacent PCs have nearly identical maps), and a separate side table mapping PC → map offset. The exact format is engine-specific; the *shape* — PC-indexed, compact, generated by the codegen — is universal.

### 2. Base And Derived Pointers

A subtle but critical wrinkle: the compiler sometimes keeps a pointer *into the middle* of an object rather than to its start. Example: iterating an array, the hot loop may hold `p = &arr[i]` and increment `p`. That `p` is a **derived pointer** — its base object is `arr`. If the GC moves `arr`, it must update `p` to point at the same interior offset of the *new* location. So the stack map records not just "this slot is a pointer" but, for derived pointers, "this is derived from base in *that* slot." After relocation: `new_p = new_base + (old_p - old_base)`. Getting this wrong corrupts memory in the most maddening way — a pointer that's off by an object's displacement. This is one reason precise stack maps for optimized code are hard: the optimizer loves to form derived pointers.

### 3. Safepoint Polling: Two Implementations

A poll must be *cheap* (it runs constantly) yet able to stop a thread promptly. Two designs dominate.

**Flag-based polling.** The runtime keeps a global "please stop" byte. The compiler emits, at each poll site:

```asm
    movb    (poll_flag), %al      ; load the global flag
    testb   %al, %al
    jne     safepoint_handler     ; if set, go park at the safepoint
```

Three instructions, almost always predicted-not-taken, so nearly free in the common case. Simple and portable.

**Page-trap (implicit) polling.** Cleverer: reserve a "polling page." The compiler emits a *single* instruction that reads from that page:

```asm
    test    %eax, (polling_page)  ; a harmless read of the polling page
```

In normal operation the page is readable and the instruction does nothing useful. When the runtime wants threads to stop, it `mprotect`s the page to be *unreadable*. The very next poll instruction faults; the OS delivers a SIGSEGV (or equivalent); the runtime's signal handler recognizes the polling-page address and parks the thread at that safepoint. The win: the common case is *one* instruction with no branch — even cheaper than the flag check — and stopping is forced by hardware. HotSpot has used both; modern HotSpot uses thread-local polling pages so it can stop individual threads.

### 4. Where Polls Go, And The Counted-Loop Problem

Polls are placed where loops and calls can run unboundedly:

- **Loop back-edges** — the jump back to the loop top, so a long loop polls each iteration.
- **Method entries and/or returns** — so a long call chain polls regularly.

But polling *every* iteration of a tight inner loop costs throughput. Optimizers historically *removed* polls from **counted loops** (loops with a statically known integer trip count, presumed short). The failure mode: a counted loop with a huge bound runs for hundreds of milliseconds with no poll, and the whole VM cannot reach a safepoint — pathological TTSP. The modern fix is **loop strip mining**: transform

```text
for (i = 0; i < N; i++) body(i);
```

into

```text
for (outer = 0; outer < N; outer += STRIP) {
    for (i = outer; i < min(outer+STRIP, N); i++) body(i);   // no poll inside
    safepoint_poll();                                         // poll per strip
}
```

so a poll lands every `STRIP` iterations — bounded TTSP, negligible throughput cost. (JVM: `-XX:+UseCountedLoopSafepoints`, strip size via `-XX:LoopStripMiningIter`.)

### 5. Write Barriers, Concretely

A write barrier is code the compiler emits around a pointer store. The *flavor* depends on what the collector needs. Two families matter at this level.

**Card-marking (generational).** Generational collectors collect the young generation frequently without scanning the old generation. But an old object may point to a young object; the collector must find such pointers without walking all of old space. Solution: divide the heap into fixed-size **cards** (e.g., 512 bytes) tracked by a **card table** (one byte per card). The write barrier, on every reference store, marks the card containing the *modified field* as "dirty":

```asm
    mov     %rsrc, (offset)(%robj)        ; the actual store: obj.field = src
    ; --- card-marking barrier ---
    shr     $9, %robj                     ; obj_addr >> 9  (card index, 512B cards)
    movb    $0, (card_table_base)(%robj)  ; dirty the card (0 = dirty in HotSpot)
```

Two extra instructions, unconditional. At young collection, the GC scans only dirty cards for old→young pointers. Cheap and effective; this is the classic SerialGC/ParallelGC barrier.

**Concurrent-marking barriers (SATB vs incremental-update).** A concurrent marker runs while the mutator rewires pointers; the barrier prevents a live object from being missed.

- **SATB (snapshot-at-the-beginning)**, used by **G1**: the barrier records the *previous* value of the field before it is overwritten, pushing it onto a marking queue. Logically: "I'm about to erase a pointer; preserve whatever it used to point at, in case it was the only path to a live object." Pseudocode:

  ```text
  pre_write_barrier(field):
      old = *field
      if marking_active and old != null:
          satb_queue.push(old)     // keep the snapshot alive
      *field = new
  ```

- **Incremental-update**, used by classic CMS-style markers: the barrier records the *new* pointer being stored, so the marker rescans the source object.

The two disciplines fix the same hazard (a missed reachable object) from opposite ends. Which one an engine uses is a collector-design choice; the *integration* fact is that the compiler must emit the chosen barrier at every reference store while marking is active. (G1's full barrier is actually a *combination*: a pre-write SATB barrier plus a post-write card-style barrier for its remembered sets.)

### 6. Conditional Barriers And Fast/Slow Paths

Barriers are usually written as a cheap inline test plus a rare out-of-line slow path:

```text
write_barrier(obj, val):
    if !marking_active:        // cheap, predicted-not-taken
        return                 // most of the time, do nothing
    slow_path(obj, val)        // out-of-line: enqueue, mark, etc.
```

The inline fast path is a few instructions; the slow path (queue maintenance, card scanning prep) is a call kept off the hot path. This keeps the common-case cost low while supporting concurrent collection when it's running. The compiler must lay these out so the predicted path is the fast one.

### 7. Barrier Elimination

The compiler removes barriers it can prove are pointless:

- **Stores into a freshly allocated object** that hasn't escaped: no other thread or root can see it yet, so a card-mark or SATB record is unnecessary on initialization stores.
- **Null stores** sometimes skip certain barriers.
- **Stores known to stay within the young generation** can skip the generational barrier.
- **Repeated stores to the same card** can mark once.

This is why benchmarking barrier cost on micro-examples misleads: the optimizer may have removed exactly the barrier you tried to measure. Disassembly is the ground truth.

### 8. Moving Roots: The Update Step

When a moving/compacting collector relocates an object, it must rewrite *every* reference to it: heap fields (found via the heap walk) and roots (found via stack maps). For each root slot the stack map identifies, the GC reads the old pointer, looks up the object's new address (via a forwarding pointer or relocation table), and writes the new address back into the slot — including reconstructing derived pointers from their bases. This update is *only possible because the map is precise*. It's also why raw pointers can't survive a move unless the GC knows about them: anything outside the map (a pointer stashed in native code) is invisible and becomes a dangling pointer after the move. The cure is **handles** (an indirection the GC updates) or **pinning** (forbid the move for that object).

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Stack map keyed by PC** | A building's emergency manifest indexed by *time of day*: "at 2pm, rooms 3 and 7 are occupied." You consult the manifest for the current time. |
| **Derived pointer** | A bookmark stuck *inside* a book. If the library re-shelves the book, the bookmark must move with it and keep its page offset. |
| **Flag-based poll** | A clock on the wall everyone glances at each lap of the track. |
| **Page-trap poll** | A tripwire across the track that's normally slack; pull it taut and the next runner trips and stops — no glancing required. |
| **Loop strip mining** | Telling a long-distance runner to check the clock once per lap instead of every stride. |
| **Card table** | Sticky notes on filing-cabinet drawers: "something in this drawer changed." You only re-check flagged drawers. |
| **SATB barrier** | Before shredding a document, you photocopy it — just in case it was the last reference to something important. |
| **Barrier elimination** | Skipping the photocopy for a draft that never left your desk. |
| **Handle** | A coat-check ticket. You hold the ticket (stable), not the coat (which staff may move to a different rack). |

---

## Mental Models

### The "PC Is The Key" Model

Everything precise about root scanning hinges on one fact: at a safepoint, the GC knows the thread's PC, and the PC indexes the stack map. Think of the stack map as a giant dictionary the compiler built, where the key is *where in the code we stopped* and the value is *which slots are pointers there*. The entire precise-GC contract is "stop only where the dictionary has an entry."

### The "Barrier Is A Tax Collector At Every Pointer Store" Model

Picture a tollbooth the compiler installs on the road of every `ptr.field = x`. Most of the time the booth waves you through (fast path: marking not active). When the collector is working, the booth charges a small fee (record the old or new pointer). The compiler is constantly trying to *demolish* booths it can prove no one needs (barrier elimination). Your throughput in pointer-heavy code is partly a function of how many booths survived.

### The "Two Maps, Two Phases" Model

Hold two distinct maps in mind. The **stack map** is *static* metadata, generated at compile time, telling the GC where roots are *for a given PC*. The **card table** (and SATB queue) is *dynamic* state, updated at run time by barriers, telling the GC where the *heap* changed since it last looked. Root scanning uses the first; incremental/concurrent heap tracking uses the second. The integration produces and maintains both.

---

## Code Examples

### Recognizing a safepoint poll in JVM disassembly

```java
public class PollDemo {
    static long sink;
    public static long loop(long[] a) {
        long s = 0;
        for (int i = 0; i < a.length; i++) s += a[i];
        return s;
    }
}
```

Compile and dump optimized assembly:

```bash
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintAssembly \
     -XX:CompileCommand=print,PollDemo.loop PollDemo
```

In the output you'll find, near the loop back-edge, an instruction reading the polling page, for example:

```asm
    test   DWORD PTR [rip+...], eax   ; {poll}  <- page-trap safepoint poll
```

The `{poll}` annotation is HotSpot telling you "this is the safepoint poll." With strip mining enabled, the poll appears on the *outer* strip loop, not on every inner iteration.

### Recognizing a card-marking write barrier

```java
public class BarrierDemo {
    static class Box { Object ref; }
    static void store(Box b, Object o) { b.ref = o; }   // reference store
}
```

```bash
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintAssembly \
     -XX:+UseParallelGC -XX:CompileCommand=print,BarrierDemo.store BarrierDemo
```

After the actual store you'll see a shift-and-store-byte pair like:

```asm
    mov    QWORD PTR [rsi+0x10], rdx   ; b.ref = o   (the real store)
    shr    rsi, 0x9                    ; card index (>>9 for 512-byte cards)
    mov    BYTE PTR [r10+rsi], 0x0     ; mark the card dirty
```

Switch the collector (`-XX:+UseG1GC`) and the barrier changes shape — you'll see the SATB pre-write check plus G1's post-write region-crossing logic. Same source line, different emitted barrier: the *collector* dictates the barrier, the *compiler* emits it.

### Seeing the write barrier in Go

```go
package main

type T struct{ p *T }

//go:noinline
func set(a *T, b *T) { a.p = b }

func main() { x := &T{}; y := &T{}; set(x, y); _ = x }
```

```bash
go build -gcflags=-S ./...   # dump assembly
```

In `set`, around the pointer store you'll find a call to `runtime.gcWriteBarrier` (or an inlined buffered-barrier sequence in newer Go). That's the hybrid write barrier the Go runtime requires during concurrent marking. A non-pointer store (`a.x = 5`) shows no such call — concrete evidence that the cost is specific to *pointer* writes.

### A handle table, sketched (why native code can't hold raw pointers)

```text
// The runtime owns a table the GC updates on every move:
handle_table = [ slot0 -> objA, slot1 -> objB, ... ]

// Native code holds an INDEX, never a raw address:
h = create_handle(objA)     // returns slot index, say 0
... call into native code, GC may run and MOVE objA ...
obj = resolve(h)            // reads handle_table[0], which the GC updated
destroy_handle(h)
```

Because the GC rewrites `handle_table[0]` when `objA` moves, the native side always resolves to the current address. A raw pointer would have gone stale. This indirection is the standard answer to "how do I keep a reference alive and valid across code the GC can't see."

### Forcing and observing TTSP (JVM)

```bash
# Log every safepoint with its time-to-safepoint and total duration.
java -Xlog:safepoint -jar yourapp.jar
```

A log line looks like:

```text
Safepoint "G1CollectForAllocation", Time since last: ..., Reaching safepoint: 187 ms, At safepoint: 4 ms, Total: 191 ms
```

`Reaching safepoint: 187 ms` is the TTSP — the time spent waiting for the slowest thread to reach a poll. `At safepoint: 4 ms` is the actual GC work. This single line operationalizes everything above: when "GC is slow," check which number is large.

---

## Pros & Cons

| Mechanism | Pros | Cons |
|-----------|------|------|
| **PC-keyed stack maps** | Exact roots; enables moving GC; compact when delta-encoded. | Codegen complexity; must handle derived pointers; metadata size in huge codebases. |
| **Flag-based polls** | Simple, portable, easy to reason about. | Three instructions per poll site; a branch the predictor must learn. |
| **Page-trap polls** | Single instruction; hardware-forced stop; per-thread with thread-local pages. | Relies on signal/fault machinery; trickier to debug; OS-specific. |
| **Card-marking barrier** | Cheap (2 unconditional instructions); enables generational collection. | Some false dirtying; coarse granularity (whole card rescanned). |
| **SATB barrier** | Stable snapshot; bounded marking termination; good for G1-style. | Records possibly-dead pointers (floating garbage until next cycle); pre-read cost. |
| **Incremental-update barrier** | Tracks exactly the new edges. | Can require re-scanning; marking termination is trickier. |
| **Loop strip mining** | Bounds TTSP without per-iteration poll cost. | Small code-size/throughput overhead; tuning the strip size. |
| **Handles/pinning** | Lets native code coexist with a moving GC. | Indirection cost (handles) or fragmentation/stall risk (pinning). |

---

## Use Cases

- **Diagnosing latency spikes.** `-Xlog:safepoint` or Go's scheduler/GC traces let you attribute a pause to TTSP vs collection — a routine middle-level investigation.
- **Reading hot-path disassembly.** Recognizing polls and barriers in generated code tells you the true cost of a loop or a pointer-heavy data structure.
- **Choosing a collector for a workload.** Knowing that G1 emits SATB + card barriers (more per-store cost, concurrent marking) versus ParallelGC's lean card barrier (STW, higher throughput) is a concrete tradeoff you can reason about.
- **Writing JNI/cgo/P-Invoke correctly.** Understanding handles, pinning, and that long native calls affect safepoints is the difference between correct and crash-prone native glue.
- **Reducing allocation and pointer churn.** Knowing barriers fire on pointer stores motivates value-oriented designs in hot paths.

---

## Coding Patterns

### Pattern 1: Bound TTSP in machine-generated or numeric loops

```java
// If you must run a very long counted loop in numeric code, ensure a
// safepoint can land. A method call per chunk gives one for free.
for (long base = 0; base < N; base += STRIP) {
    long end = Math.min(base + STRIP, N);
    crunch(base, end);          // call boundary -> safepoint poll
}
```

Rely on strip mining where the JIT provides it; add an explicit chunking call where you can't trust it (interpreted code, certain intrinsics).

### Pattern 2: Use handles, never raw pointers, across native boundaries

```text
jobject global = (*env)->NewGlobalRef(env, localObj);  // JNI handle
// ... safe across GCs and object moves ...
(*env)->DeleteGlobalRef(env, global);
```

In Go's cgo, do not pass Go pointers into C and store them; if you must, follow the cgo pointer-passing rules (which exist precisely because of the moving/relocating contract).

### Pattern 3: Minimize pinned/critical windows

```java
// JNI critical region pins arrays so the GC cannot move them.
jbyte* p = (*env)->GetPrimitiveArrayCritical(env, arr, NULL);
// DO THE MINIMUM here — the GC may be blocked/limited while pinned.
(*env)->ReleasePrimitiveArrayCritical(env, arr, p, 0);
```

A long critical section can stall a moving collector. Copy out, release fast.

### Pattern 4: Let escape analysis kill barriers — keep objects local

```java
// A freshly allocated, non-escaping object's init stores often need no barrier
// and may even be scalar-replaced (no allocation). Keep temporaries local.
StringBuilder sb = new StringBuilder();   // may not escape
sb.append(x).append(y);
return sb.toString();
```

Local, non-escaping objects let the compiler eliminate barriers (and sometimes the allocation entirely), shrinking both GC and barrier cost.

---

## Best Practices

- **Always split TTSP from collection time when reading pause data.** They have completely different fixes.
- **Enable loop-safepoint mitigations** for numeric workloads (`-XX:+UseCountedLoopSafepoints` is default in modern JVMs; verify on your version).
- **Treat every native boundary as a GC-interaction site.** Use global/weak handles, keep critical sections tiny, and follow the engine's pointer-passing rules.
- **Verify barrier cost with disassembly, not micro-benchmarks alone** — the optimizer may have eliminated the very barrier you wanted to measure.
- **Pick the collector by its barrier profile** when throughput vs latency matters: lean card barrier + STW for throughput; SATB + concurrent for latency.
- **Don't pin objects longer than necessary.** Pinning fragments the heap and can stall a compacting collector.
- **Prefer value/index storage over pointer storage in genuinely hot, profiled loops** to dodge per-store barriers.

---

## Edge Cases & Pitfalls

- **Derived-pointer bugs.** If the stack map mishandles an interior pointer's base, a compacting move corrupts it by exactly the object's displacement. These are among the hardest GC-integration bugs and a reason aggressive optimizers and moving GCs are hard to combine.
- **Counted-loop TTSP regressions.** A loop the JIT classifies as "counted and short" may lose its poll. A huge bound then produces a multi-hundred-millisecond TTSP. Check `-Xlog:safepoint`.
- **Native call masking.** A thread blocked in native code is often counted as "at a safepoint" so the GC proceeds — but if it returns into managed code mid-GC, the transition must re-check; and a *critical* native region can block a moving GC entirely.
- **Barrier-eliminated benchmarks.** Measuring "the cost of a write barrier" with a loop the compiler optimizes into nothing yields meaningless numbers. Defeat the optimizer (escape the object, use the result) or read the assembly.
- **Card-table false sharing.** The card table is a hot shared array; barriers from many cores writing nearby cards can cause cache-line contention. Some engines use card-table padding or conditional card marking (`-XX:+UseCondCardMark`) to mitigate.
- **SATB floating garbage.** SATB keeps everything alive that was reachable at the snapshot, even if it dies during the cycle — so memory reclamation lags by up to a cycle. Expected, not a leak.
- **Mixing atomic and non-atomic pointer stores.** A pointer store that bypasses the compiler's barrier (e.g., via certain `Unsafe`/`unsafe` operations) can hide an edge from a concurrent marker and cause it to free a live object — a true correctness bug, not just a perf issue.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────────┐
│            RUNTIME ↔ GC INTEGRATION — MECHANICS                       │
├──────────────────────────────────────────────────────────────────────┤
│ STACK MAP  : function PC -> {slots/regs holding pointers}             │
│   compact (bitmaps/deltas); handles BASE + DERIVED pointers          │
│   moving GC rewrites each mapped slot to the new address             │
├──────────────────────────────────────────────────────────────────────┤
│ SAFEPOINT POLLS:                                                      │
│   flag-based  : load global byte; test; jne handler   (3 insns)      │
│   page-trap   : read polling page; mprotect-unread to force fault    │
│   placed at   : loop back-edges, method entry/return                 │
│   strip mining: poll once per STRIP iters (bounds TTSP cheaply)      │
├──────────────────────────────────────────────────────────────────────┤
│ WRITE BARRIERS (compiler-emitted on pointer stores):                 │
│   card mark   : store; (obj>>9); card_table[idx]=dirty  (generational)│
│   SATB        : record OLD value before overwrite        (G1)        │
│   incr-update : record NEW value after store             (CMS-style) │
│   fast/slow   : inline "marking active?" test + out-of-line slow path│
│   elimination : freshly-allocated/non-escaping stores skip barriers  │
├──────────────────────────────────────────────────────────────────────┤
│ MOVING GC needs: precise maps to update roots; handles for native;   │
│                  pinning to opt a single object out of moving        │
├──────────────────────────────────────────────────────────────────────┤
│ DIAGNOSE: -Xlog:safepoint -> "Reaching safepoint"(TTSP) vs           │
│           "At safepoint"(collection). Fix the big one.               │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A **stack map** is concrete metadata keyed by **program counter**: at each safepoint PC, it lists which stack slots and registers hold object references. The GC consults it for the stopped thread's PC.
- Maps must track **derived pointers** (interior pointers) by their **base**, so a moving GC can reconstruct them after relocation. This is a chief source of stack-map complexity in optimized code.
- **Safepoint polls** come in two flavors: **flag-based** (load-test-branch, ~3 instructions) and **page-trap** (a single read of a polling page the runtime `mprotect`s unreadable to force a fault). Polls sit at loop back-edges and method boundaries.
- The **counted-loop** problem (no poll inside a long tight loop) is solved by **loop strip mining**, which polls once per strip — bounding **time-to-safepoint** without per-iteration cost.
- **Write barriers** are compiler-emitted code on pointer stores. **Card-marking** (generational) dirties a card-table byte; **SATB** (G1) records the old value pre-overwrite; **incremental-update** records the new value. All use a cheap inline fast path plus an out-of-line slow path, and the compiler **eliminates** barriers it can prove unneeded.
- A **moving** collector uses precise maps to rewrite each root slot to the object's new address. Pointers the GC can't see (raw pointers in native code) go stale; the cures are **handles** (GC-updated indirection) and **pinning**.
- Operationally, `-Xlog:safepoint` (and Go/.NET equivalents) splits a pause into **TTSP** (reaching safepoint) and **collection** (at safepoint) — the single most useful diagnostic for "GC is slow."

---

## Further Reading

- *The Garbage Collection Handbook* (2nd ed.) — Jones, Hosking, Moss. Chapters on stack maps, safepoints, and barrier design.
- *HotSpot Runtime Overview* and *HotSpot Glossary* — OpenJDK. Oop maps, OopMapSet, safepoint mechanics. https://openjdk.org/groups/hotspot/docs/HotSpotGlossary.html
- *Safepoints: Meaning, Side Effects and Overheads* — Nitsan Wakart (Psychosomatic, Lobotomy, Saw blog). Excellent on TTSP and page-trap polling. https://psy-lob-saw.blogspot.com/
- *Async-profiler wiki* — explains safepoint bias and why some profilers only sample at safepoints.
- *Getting Started with the G1 Garbage Collector* and the G1 papers — for SATB + remembered-set barriers (motivation only).
- *Go's hybrid write barrier* — proposal and runtime comments. https://go.googlesource.com/proposal/+/master/design/17503-eliminate-rescan.md
- *The Z Garbage Collector* wiki — load (colored-pointer) barriers, for contrast with store barriers. https://wiki.openjdk.org/display/zgc/Main
- *Inside the JVM: Safepoints* — various OpenJDK source comments in `safepoint.cpp` and `oopMap.cpp`.

---

## Diagrams & Visual Aids

### Stack Map Lookup At A Safepoint

```text
Thread stopped at PC = 0x4012ab
        │
        ▼
  stackMap(0x4012ab) ──► { slot[2]=ptr(base), slot[5]=ptr,
                           rbx=ptr, r12=derived(base=slot[2]) }
        │
        ├─► scan those slots/regs as roots
        └─► (moving GC) after relocation, rewrite each with new address;
            r12_new = newbase + (r12_old - oldbase)
```

### Two Poll Implementations

```text
FLAG-BASED                          PAGE-TRAP
  movb (poll_flag), al                test eax, (polling_page)   ; 1 insn
  test al, al                         (normal: page readable -> no-op)
  jne  handler                        (stop wanted: mprotect page NO-READ
  (3 insns, branch)                    -> next poll FAULTS -> handler)
```

### Card-Marking Barrier

```text
Heap:   [ ...old object... ] field=──► [ young object ]
store obj.field = young
   │
   ├─ real store
   └─ barrier:  card = (addr(obj) >> 9);  card_table[card] = DIRTY
Young GC later: scan ONLY dirty cards for old->young pointers.
```

### SATB vs Incremental-Update (concurrent marking)

```text
Before:  A.f ──► X        (marker hasn't reached X yet)
Mutator does:  A.f = Y    (overwrites the pointer to X)

SATB barrier:           record OLD = X  ► keep X alive this cycle
Incremental-update:     record NEW = Y  ► rescan A to find Y

Both prevent "X (or Y) silently freed while still reachable."
```

### A Safepoint Log Line, Decoded

```text
Safepoint "G1CollectForAllocation",  Reaching safepoint: 187 ms,  At safepoint: 4 ms
                                       └─ TTSP (a thread wouldn't stop)  └─ actual GC
   ===> the 187 is the bug; the GC itself was fast.
```
