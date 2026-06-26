# Tracing Garbage Collection — Hands-On Tasks

> **Topic:** [Tracing Garbage Collection](README.md)

These tasks build from implementing the core algorithms to observing and tuning real collectors in production-like conditions. Do them in order; each Self-check is a concrete, verifiable outcome. Solutions are sparse on purpose — the value is in the doing.

---

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Reachability by hand

On paper, draw a heap of 8 objects (A–H) with arbitrary pointers between them, and mark roots = {A, C}. Make sure to include one **cycle** that is *not* reachable from any root, and one cycle that *is*.

By hand, run the trace from the roots and list which objects are live and which are garbage.

**Self-check:**
- [ ] I identified the live set as exactly "reachable from A or C by following pointers."
- [ ] The unreachable cycle is correctly marked as garbage (proving tracing handles cycles).
- [ ] The reachable cycle's members are all live.
- [ ] I can state in one sentence why an object reachable from a root but never used again is still kept.

*Hint:* a cycle is garbage if and only if no edge enters it from outside the cycle's reachable component.

### Task 2 — Predict refcount vs tracing

Take the same graph. Add reference counts to each object (count incoming edges). Now imagine the program drops the root edge to C.

Write down, for each object, whether **reference counting** would free it and whether **tracing** would. Identify at least one object where they disagree.

**Self-check:**
- [ ] I found an object that tracing collects but refcounting leaks (it's in an unreachable cycle).
- [ ] I can explain why refcounting can't free that object.
- [ ] I noted that tracing's "already-marked" check is what makes cycles safe.

---

## Core

### Task 3 — Implement mark-sweep

In a language of your choice, model objects as a struct with a `marked` bool and a list of child pointers. Maintain a global `roots` list and a global `heap` list of all allocated objects. Implement:

- `mark()` — iterative (worklist, not recursion) trace from roots.
- `sweep()` — free unmarked objects, reset mark bits on survivors.
- `collect()` — mark then sweep, returning the count of objects reclaimed.

Build a test graph that includes a cycle and some garbage, run `collect()`, and assert the survivor set equals the reachable set.

**Self-check:**
- [ ] `mark()` uses an explicit worklist and terminates on cyclic graphs.
- [ ] After `collect()`, every survivor is reachable and every reclaimed object was not.
- [ ] Mark bits are cleared so a second `collect()` with no changes reclaims zero objects.
- [ ] I handle nil/null pointers in child lists without crashing.

*Hint:* the only thing preventing infinite loops on cycles is the `if obj.marked { continue }` guard — write a test with A↔B to prove it.

### Task 4 — Implement Cheney's copying collector

Extend Task 3 (or start fresh) with a **semispace** layout: two equal buffers, allocate by bumping a pointer in from-space. Implement Cheney's algorithm:

- A `copyObj` that evacuates an object to to-space, leaving a **forwarding pointer**, and returns the new address (or follows an existing forwarding pointer).
- A `collect` that copies roots, then scans to-space with the `scan`/`free` pointers until they meet, then swaps the spaces.

Verify that after collection, shared objects (two parents pointing at one child) are **not** duplicated.

**Self-check:**
- [ ] Allocation in from-space is a pointer bump, not a free-list search.
- [ ] A shared child copied once: I assert object identity is preserved (one copy, two updated parents).
- [ ] Garbage costs nothing — I never iterate over dead objects.
- [ ] After collection, `scan == free` and from-space is fully reusable.

*Hint:* the region between `scan` and `free` *is* the grey set — print its size each iteration and watch it rise then drain to zero.

### Task 5 — Add a generational nursery

Combine Tasks 3 and 4: a small **copying nursery** (Task 4) and a **mark-sweep old generation** (Task 3). Promote an object to the old gen after it survives N minor GCs. Implement a **remembered set** and a **write barrier** that records old→young pointers.

Allocate many short-lived objects plus a few that survive, and confirm a **minor GC** correctly keeps a young object that's only referenced from an old object.

**Self-check:**
- [ ] A minor GC scans roots **plus** the remembered set, not the whole old gen.
- [ ] Without the write barrier, I can produce a bug where a young object referenced only from the old gen is wrongly collected — then the barrier fixes it.
- [ ] Promotion happens after N survivals and moves the object out of the nursery.
- [ ] Most allocated objects are reclaimed by minor GC and never reach the old gen.

*Hint:* deliberately comment out the write barrier first and write the failing test — *seeing* the bug is the point of this task.

### Task 6 — Tri-color marking with a simulated mutator

Implement marking with explicit white/grey/black states and a grey worklist. Then simulate a concurrent mutator that, *mid-mark*, (a) stores a pointer to a white object into a black object and (b) deletes the grey path to that white object. Show that naive concurrent marking **loses** the object.

Now add a **Dijkstra insertion barrier** (shade the target grey on writes into black) and show the object survives.

**Self-check:**
- [ ] I reproduced the lost-object bug: a live white object stays white and gets collected.
- [ ] The insertion barrier restores the strong invariant (no black→white) and the object survives.
- [ ] I can also describe how a **deletion (SATB)** barrier would have saved it instead.
- [ ] I can state which invariant (strong/weak) each barrier maintains.

---

## Advanced

### Task 7 — Measure allocation's effect on Go GC

Write a Go program with a tunable allocation rate (e.g., allocating slices in a loop with adjustable size/frequency). Run it under `GODEBUG=gctrace=1` and capture the GC trace lines. Then vary `GOGC` (e.g., 50, 100, 400) and `GOMEMLIMIT`.

Tabulate, for each setting: GC frequency, pause times, and peak heap size.

**Self-check:**
- [ ] I can read a `gctrace` line (wall/CPU time, heap-before/after, goal).
- [ ] Higher `GOGC` → fewer collections but larger peak heap (throughput↑, memory↑).
- [ ] Lower `GOGC` → more frequent collections, smaller heap (memory↓, CPU↑).
- [ ] `GOMEMLIMIT` makes the pacer more aggressive as the heap approaches the limit, regardless of `GOGC`.

*Hint:* keep one variable fixed at a time; the relationship between allocation rate, `GOGC`, and pause count is nonlinear.

### Task 8 — Find and fix a retention leak

Write a program (Go or JVM) with a deliberate leak: an unbounded map/cache that's never cleared, or a slice that aliases a huge backing array (`s = bigSlice[:1]`), or a closure capturing a large object. Watch RSS/heap grow.

Use a heap profiler (Go `pprof` `inuse_space`, or a JVM heap dump + analyzer) to find the **retention path**. Fix it (delete entries, copy out the small slice, drop the capture) and confirm the heap stabilizes.

**Self-check:**
- [ ] The profiler shows the *path* keeping the objects reachable, not just their type.
- [ ] I can articulate why this is a leak *despite* the GC working correctly (reachable ≠ needed).
- [ ] After the fix, the live set stops growing monotonically under sustained load.
- [ ] I distinguished "objects retained" from "pages not returned to the OS" (RSS may lag heap).

### Task 9 — Compare JVM collectors on the same workload

Take an allocation-heavy JVM workload (or a benchmark like a simple in-memory cache under load). Run it under `-XX:+UseParallelGC`, `-XX:+UseG1GC`, and `-XX:+UseZGC`, with GC logging enabled (`-Xlog:gc*`). Keep `-Xmx` fixed.

Compare pause-time distribution (p50/p99/max), throughput, and peak footprint across the three.

**Self-check:**
- [ ] Parallel shows the best throughput but the longest worst-case pauses.
- [ ] ZGC shows sub-millisecond pauses largely independent of heap size, at some throughput/footprint cost.
- [ ] G1 sits between them and roughly respects its pause goal.
- [ ] I compared at the **tail** (p99/max), not just averages.

*Hint:* feed the logs to GCeasy/GCViewer to get pause histograms quickly.

### Task 10 — Provoke a fallback STW

Configure a concurrent collector with **too little headroom** (small heap relative to allocation rate) and a high allocation rate, so the mutator out-allocates the collector. Trigger a fallback: a JVM **evacuation failure / full GC**, or observe heavy **GC assist** in Go.

Then fix it by raising headroom (bigger `-Xmx`/higher `GOMEMLIMIT`) or cutting allocation, and confirm the outliers disappear.

**Self-check:**
- [ ] I produced a multi-X latency outlier traced to a concurrent-mode fallback (or sustained GC assist).
- [ ] Increasing headroom or reducing allocation eliminates the outlier.
- [ ] I can explain why "more concurrency" needs "more memory" to actually deliver low pauses.

---

## Capstone

### Task 11 — Build a configurable mini-runtime and benchmark the trade-offs

Combine your earlier collectors into one small runtime that can be configured at startup as: (a) STW mark-sweep, (b) STW copying, (c) generational (copying nursery + mark-sweep old gen). Add counters for: total pause time, bytes copied/swept, peak memory, and number of collections.

Run an identical synthetic workload — a mix of short-lived and long-lived allocations following the weak generational hypothesis — under all three configurations and produce a comparison table across **pause, throughput (work done / total time), and peak memory**.

**Self-check:**
- [ ] The generational config does the least total work on a young-death-heavy workload.
- [ ] The copying config wastes ~half the heap (visible in peak memory) but never touches garbage.
- [ ] Mark-sweep shows fragmentation/free-list cost on a long run; I can measure or demonstrate it.
- [ ] My table makes the **throughput/latency/memory trinity** concrete: no config wins on all three.
- [ ] I can explain, from my own numbers, why generational GC is the throughput default and why low-latency systems still reach for concurrent collectors.

*Hint:* you don't need true concurrency for the capstone — STW variants suffice to expose the algorithmic trade-offs. Concurrency would add barrier overhead, which is a separate axis.

---

## Self-Assessment

You have mastered this topic if you can:

- [ ] Define liveness as reachability from roots and explain why it's safe and why reachable ≠ needed.
- [ ] Implement mark-sweep, Cheney copying, and a generational collector from scratch, including a write barrier and remembered set.
- [ ] Reproduce the concurrent lost-object bug and fix it with an insertion (or deletion/SATB) write barrier, naming the invariant each preserves.
- [ ] Explain the throughput/latency/memory trinity and place Go, G1, ZGC, and CPython on those axes.
- [ ] Read a Go `gctrace` or a JVM GC log and decompose a pause into time-to-safepoint, root scan, and concurrent phases.
- [ ] Distinguish a true retention leak from a tuning problem, and diagnose it with a heap profiler.
- [ ] Tune `GOGC`/`GOMEMLIMIT` or JVM collector/heap settings to a stated latency or footprint SLO, validating at the tail.
- [ ] Articulate why a concurrent collector needs headroom and what happens (fallback STW / GC assist) when it's starved.
