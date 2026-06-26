# Reference Counting — Professional Level

> **Topic:** [Reference Counting](README.md)
> **Focus:** Production diagnosis — finding leaks and cycles, profiling count overhead and contention, and the free-threaded-Python / ARC realities you ship against.

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Diagnosing Cycle Leaks in Production](#diagnosing-cycle-leaks-in-production)
- [Profiling Refcount Overhead and Contention](#profiling-refcount-overhead-and-contention)
- [Free-Threaded Python: What Changes for You](#free-threaded-python-what-changes-for-you)
- [Production War Stories & Patterns](#production-war-stories--patterns)
- [Tooling Reference](#tooling-reference)
- [Coding Patterns](#coding-patterns)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

In production, reference counting fails in two characteristic ways and is slow in one characteristic way. It **leaks** (a cycle or a forgotten strong reference keeps memory alive), it **double-frees / use-after-frees** (an unbalanced count, mostly in manual or FFI code), and it **costs CPU** (atomic count contention on hot shared objects). This page is about catching all three with real tools, and about the two production realities you actually ship against today: free-threaded Python's refcount story and Swift/ARC's retain-cycle diagnosis.

The professional skill is not knowing that cycles leak — it's being handed a memory graph at 3 a.m. and finding *which* cycle, *which* retainer, and *whether* the regression is a leak or just delayed reclamation.

## Prerequisites

- Senior-tier material: the cost model, optimizations, and cross-language implementations.
- Comfort reading a heap dump / retainer graph.
- Familiarity with a profiler (perf, Instruments, py-spy, or equivalent).

## Diagnosing Cycle Leaks in Production

### Python: `gc`, `tracemalloc`, and `objgraph`

The first question is always **"is it a true leak or a cycle the collector hasn't run on yet?"** Force a collection and re-measure:

```python
import gc
gc.collect()
# if memory drops, it was reclaimable cyclic garbage (collector cadence issue,
# or you disabled gc). If it doesn't, it's a real leak: a live strong reference.
```

Then find *what* is uncollectable and *who* retains it:

```python
import gc, objgraph

gc.set_debug(gc.DEBUG_SAVEALL)   # keep unreachable objects in gc.garbage
gc.collect()
print(len(gc.garbage))           # objects in cycles the collector found

# What types are growing over time?
objgraph.show_growth(limit=20)

# Who is keeping THIS object alive? (the retainer chain — the real answer)
objgraph.show_backrefs([suspect], max_depth=5, filename="backrefs.png")
```

For allocation-site attribution, `tracemalloc` snapshots tell you *where* leaking objects were created:

```python
import tracemalloc
tracemalloc.start(25)            # keep 25 frames of traceback per alloc
snap1 = tracemalloc.take_snapshot()
# ... run workload ...
snap2 = tracemalloc.take_snapshot()
for stat in snap2.compare_to(snap1, "lineno")[:10]:
    print(stat)                  # top growth by source line
```

**Key production heuristics:**

- Memory grows but `gc.collect()` reclaims it → cycles forming faster than the collector runs, *or* someone called `gc.disable()`. Re-enable, or tune thresholds, or break the cycle with `weakref`.
- `gc.collect()` reclaims *nothing* → a true strong-reference leak: a module-level cache, a registry, a logging handler, a closure captured in an event loop, or an exception traceback holding frames (the classic `except: ... e` that keeps the traceback and every local alive).
- Objects with `__del__` historically blocked cycle collection (`gc.garbage`); avoid finalizers on objects that participate in cycles.

### Swift / Objective-C: Instruments and the memory graph

ARC retain cycles are the dominant iOS/macOS leak. The tools:

- **Xcode Memory Graph Debugger** — pause the app, click the memory-graph icon, and Xcode draws the object graph; cycles show as purple "!" leak badges with the exact retain chain.
- **Instruments → Leaks** — flags allocations with no path from a root; the **Cycles & Roots** view draws the retain cycle directly.
- **Allocations instrument** — track live-byte growth over time to spot accumulation.

The fix is almost always a capture list (`[weak self]` / `[unowned self]`) on a closure, or a `weak`/`unowned` property on a back-reference (delegate, parent, observer).

### Rust and C++: leaks are quieter

`Rc`/`Arc` cycles leak *silently* — no collector, no crash, just unfreed memory. Detection is via general heap profilers:

- **Rust:** `valgrind --leak-check=full`, `heaptrack`, or instrument with a counting global allocator; `Rc::strong_count`/`weak_count` for targeted assertions in tests.
- **C++:** `valgrind`, AddressSanitizer's leak detector (LSan), `heaptrack`; a `weak_ptr` that should have expired but `.lock()` still succeeds reveals a lingering owner.

## Profiling Refcount Overhead and Contention

The CPU side. Refcount overhead hides in `retain`/`release`/`Arc::clone`/`Py_INCREF` — not in the allocator, so allocator profilers miss it.

**What to look for in a CPU profile:**

- High self-time in `swift_retain`/`swift_release`, `std::__shared_count` atomics, `Arc::clone`/`drop`, or CPython's `_Py_INCREF`/`_Py_DECREF` paths.
- On a **perf** flame graph, atomic refcount contention shows as cores stalling on the cache line of a hot count — look for `lock`-prefixed instructions and high `cache-misses` / `MESI` invalidations on a specific address.

**Detecting cache-line contention (false sharing on a hot count):**

```bash
# Linux perf: watch for cache-coherence stalls
perf stat -e cache-misses,cache-references,L1-dcache-load-misses ./app
perf c2c record ./app && perf c2c report   # cache-to-cache (HITM) on shared lines
```

`perf c2c` specifically surfaces "HITM" (hit-modified) events — one core reading a line another core just wrote — which is exactly the signature of many threads hammering one shared `Arc`/`shared_ptr` count.

**Remedies once found:**

- **Stop cloning in the hot path.** Pass `&Arc<T>` (a borrow) instead of `Arc::clone`; pass `const shared_ptr&` by reference, not by value, into functions.
- **Reduce sharing.** Give each thread its own `Arc` clone *once* outside the loop, or split the work so the hot object is thread-local.
- **Immortalize/leak true singletons** so they carry no count traffic.
- **Consider a different strategy** for that object — arena allocation, a lock-free structure, or epoch-based reclamation — when the count *is* the bottleneck.

## Free-Threaded Python: What Changes for You

This is the most consequential current development in production refcounting. CPython 3.13+ ships an optional **free-threaded build** (PEP 703) that removes the GIL — and the GIL was, in large part, what made CPython's non-atomic refcount safe and cheap.

What you ship against:

- **Refcount updates become contention-sensitive.** Without the GIL serializing bytecode, two threads incrementing the same object's count race. CPython's answer is **biased reference counting** (owner-thread non-atomic, others atomic) plus **immortal objects** (PEP 683 — `None`, `True`, `False`, small ints, interned strings, type objects get frozen, never-decremented counts so they don't become global contention points), plus **deferred** counting for some interpreter-internal references.
- **Single-threaded code can be slower.** Even unshared objects pay for the more complex counting machinery; early free-threaded builds showed measurable single-thread overhead, narrowing over releases.
- **Shared-object hotspots are real.** A module-level dict, a shared cache, or a logger touched by every worker thread becomes a refcount contention point. The mitigation is the same as for `Arc`: minimize cross-thread sharing of hot Python objects, or make them immortal/module-level constants.
- **C extensions must opt in.** Extensions declare free-threaded support; ones relying on the GIL for implicit refcount safety can crash or corrupt counts under the free-threaded build.

The practical takeaway: free-threaded Python doesn't make your code automatically faster — it removes the GIL ceiling on parallelism while moving the cost onto refcount management. Profile for atomic-count contention exactly as you would for `Arc`.

## Production War Stories & Patterns

- **The exception-traceback leak (Python).** A long-running task does `except Exception as e:` and stashes `e` (or logs `repr(e)` lazily). The traceback holds every frame, and every frame holds every local — a giant retained graph. Fix: don't store exception objects; extract what you need and let them drop. Python 3 even deletes the `e` binding at block exit for this reason.
- **The delegate cycle (Swift/Obj-C).** A view controller strongly holds a child whose `delegate` property is a *strong* back-reference to the controller. Classic cycle; `delegate` must be `weak`. This is why Cocoa delegates are `weak` by convention.
- **The closure-capture cycle (Swift).** `self.timer = Timer(...) { self.tick() }` — the timer retains the closure, the closure retains `self`, `self` retains the timer. `[weak self]` breaks it. `Timer` is a notorious offender because it also retains its target.
- **The `make_shared` + observer `weak_ptr` pin (C++).** Object's destructor ran (strong count hit 0), but memory stayed allocated because a fused control block kept a `weak_ptr` alive in an observer list that never cleaned up. Live bytes don't drop until the weak count also hits zero.
- **The `Arc::clone` loop (Rust).** A config `Arc` cloned once per request *inside* a per-item loop across a thread pool turned an atomic increment into a multi-core contention storm; switching to passing `&Arc` (or cloning once per task) removed it.

## Tooling Reference

| Language | Leak / cycle | CPU / contention |
|---|---|---|
| Python | `gc` (`set_debug`, `garbage`, `collect`), `tracemalloc`, `objgraph`, `weakref` | `py-spy`, `perf`, `cProfile`, contention via free-threaded profiling |
| Swift/Obj-C | Xcode Memory Graph, Instruments **Leaks** / **Cycles & Roots**, **Allocations** | Instruments **Time Profiler**, retain/release in trace |
| Rust | `valgrind`, `heaptrack`, custom counting allocator, `strong_count`/`weak_count` asserts | `perf` (+`perf c2c`), `cargo flamegraph` |
| C++ | `valgrind`/Memcheck, ASan+LSan, `heaptrack`, `weak_ptr` expiry checks | `perf c2c`, VTune, atomic-op counters |

## Coding Patterns

- **Assert counts in tests.** `assert_eq!(Rc::strong_count(&x), 1)` after a scope, or `XCTAssertNil(weakRef)` after releasing the owner, turns silent leaks into failing tests.
- **`weakref.finalize` / `weakref.ref` callbacks** in Python to observe and react to collection without creating strong references.
- **Scope-guard the strong reference.** In C++, take a local `shared_ptr` copy only for the duration you truly need it; prefer `weak_ptr` for caches and observer registries so they don't pin entries.
- **Capture-list discipline (Swift).** Default to `[weak self]` in escaping closures stored on long-lived objects; reach for `[unowned self]` only when you can *prove* the closure cannot outlive `self`.

## Best Practices

- **Distinguish leak from latency before fixing.** Force a collection (Python), or check whether memory is bounded-but-high vs unbounded-growing. Delayed reclamation is a tuning problem; unbounded growth is a leak.
- **Profile count traffic separately from allocation.** Different tools, different signatures. A throughput regression with flat allocation counts points at count overhead.
- **Make hot, widely-shared objects immortal or thread-local.** Whether it's a Python module global under free-threading or a Rust config `Arc`, the cure for count contention is to stop sharing the hot count.
- **Keep finalizers off cyclic objects.** Destructor/`__del__` semantics interact badly with cycle collection and ordering; if a destructor must run, don't bury it in a cycle.
- **Audit FFI boundaries.** The most dangerous unbalanced counts live where managed refcounting meets manual C: missing `Py_DECREF` (leak) or extra `Py_DECREF` (use-after-free/crash). Use `Py_NewRef`/`Py_XDECREF` carefully and check the borrowed-vs-owned reference contract of every C-API call.

## Edge Cases & Pitfalls

- **`gc.disable()` left on in production.** Cycles then leak unboundedly because nothing collects them. Some teams disable `gc` for latency and forget the cycle consequence.
- **Borrowed vs owned references in the C-API.** CPython functions return either a *new* reference (you must `Py_DECREF`) or a *borrowed* one (you must not). Getting this wrong is the #1 C-extension memory bug.
- **Atomic count ≠ thread-safe object.** `Arc<T>`/`shared_ptr<T>` make *sharing* safe, not the *contents*. Concurrent mutation still needs a lock; this is a frequent data-race source.
- **Resurrection in finalizers.** A `__del__`/destructor that re-publishes the dying object can defeat reclamation and cause subtle double-finalization.
- **Weak references aren't free.** Zeroing weak references (Swift `weak`, Python `weakref`) maintain side structures; very large numbers of them have their own overhead and teardown cost.
- **Stack overflow on deep frees.** Dropping the head of a million-node `Rc`/`shared_ptr` linked list can recurse a million deep. Production data structures flatten destruction into an explicit loop.

## Summary

- Production refcounting fails as **leaks** (cycles or forgotten strong refs), **use-after-free/double-free** (unbalanced counts, mostly at FFI boundaries), and **CPU cost** (atomic count contention).
- **Diagnose leaks** with `gc`/`tracemalloc`/`objgraph` (Python), Xcode Memory Graph / Instruments (Swift), and `valgrind`/`heaptrack`/ASan (Rust, C++) — always separating "true leak" from "delayed reclamation."
- **Diagnose count overhead** with CPU profilers and `perf c2c`, looking for hot `retain`/`release`/`clone`/`INCREF` self-time and cache-line HITM contention on shared counts.
- **Free-threaded Python** is the current frontier: removing the GIL turns refcount updates into contention points, mitigated by biased counting, immortal objects, and deferred counting — profile it like you'd profile `Arc`.
- The durable fixes are **architectural**: break cycles with weak references, stop cloning/sharing hot counts in inner loops, immortalize true singletons, and keep finalizers out of cycles.
