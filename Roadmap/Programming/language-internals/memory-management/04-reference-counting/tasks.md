# Reference Counting — Hands-On Tasks

> **Topic:** [Reference Counting](README.md)

A progression of exercises that take you from *watching* a reference count change to *building* a counted pointer, *diagnosing* real cycle leaks, and *measuring* the atomic-count tax. Do them in any language you're comfortable with unless a task names one; Python, Rust, C++, and Swift are all good fits.

Work top-to-bottom: Warm-Up builds intuition, Core builds the mechanism, Advanced builds diagnosis and measurement skills, and the Capstone integrates everything.

---

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Watch a count move

Use a language that exposes the count (Python's `sys.getrefcount`, or Rust's `Rc::strong_count`). Create an object, then make and drop additional references, printing the count at each step. Predict each value *before* you print it.

**Self-check:**

- [ ] I can predict the count after each assignment and `del`/`drop`.
- [ ] I understand why Python's `getrefcount` reads one higher than expected (the argument temporary).
- [ ] I observed the object being freed (e.g. a `__del__`/`Drop` print) at the exact step the count hit zero.

<details>
<summary>Hint</summary>

In Python: `a = []`, then `b = a`, then `del b`. In Rust: `let a = Rc::new(0); let b = a.clone();` and print `Rc::strong_count(&a)` between operations. Add a struct with a `Drop`/`__del__` that prints, to see *when* it dies.

</details>

### Task 2 — Build a cycle and confirm it leaks

Create two objects that reference each other, then drop all external references. Confirm (with a destructor print, a count check, or a memory tool) that they are **not** freed by reference counting alone.

**Self-check:**

- [ ] The two objects are not reclaimed after external references are gone.
- [ ] I can explain, in terms of counts, exactly why each stays at 1.
- [ ] In Python, `gc.collect()` *does* reclaim them — and I understand why that's a *separate* mechanism from refcounting.

<details>
<summary>Hint</summary>

Give each object an `other`/`ref` field. Set `a.other = b; b.other = a`. Put a print in the destructor. Drop `a` and `b`. No print = leak. In Python, call `gc.collect()` afterward and watch the prints finally fire.

</details>

### Task 3 — Break the cycle with a weak reference

Repeat Task 2, but make **one** of the two edges a weak reference (Python `weakref.ref`, Rust `Weak`, C++ `weak_ptr`, Swift `weak`). Confirm both objects are now freed promptly by refcounting alone, with no cycle collector.

**Self-check:**

- [ ] Both destructors run when external references drop, with no `gc.collect()` needed.
- [ ] I made exactly *one* edge weak and can justify which one (the non-owning back-edge).
- [ ] Accessing the object through the weak reference correctly reports "gone" after it's freed.

<details>
<summary>Hint</summary>

Decide which object *owns* the other; the back-link from the owned object is the weak one. To use a weak ref you must "upgrade": `weakref()` call returns `None`, `Weak::upgrade()` returns `Option`, `weak_ptr::lock()` returns a possibly-empty `shared_ptr`.

</details>

---

## Core

### Task 4 — Implement a reference-counted smart pointer

In a language with manual memory management (C, C++ without `shared_ptr`, or Rust with `unsafe`), implement your own counted box: a `retain` that increments, a `release` that decrements and frees at zero, and copy semantics that retain. Store the count inline with the data.

**Self-check:**

- [ ] Copying the handle increments the count; dropping it decrements.
- [ ] The payload is freed exactly once, exactly when the count hits zero.
- [ ] I tested an unbalanced case and saw it leak (too few releases) or double-free (too many).

<details>
<summary>Hint</summary>

Layout: a struct `{ size_t count; T value; }` allocated together. `retain(p)` does `p->count++`. `release(p)` does `if (--p->count == 0) free(p);`. The hard part is copy semantics — every place a handle is duplicated must retain, every place one dies must release.

</details>

### Task 5 — Add weak references to your smart pointer

Extend Task 4 with a separate **weak count** and a `weak_ptr`-style handle that does *not* keep the object alive but can be *upgraded* to a strong handle if the object still exists. You'll need a control block that outlives the payload.

**Self-check:**

- [ ] A weak handle does not prevent the payload from being freed at strong-zero.
- [ ] `upgrade()` succeeds while a strong reference exists and fails after the payload is freed.
- [ ] The control block itself is freed only when *both* strong and weak counts reach zero.

<details>
<summary>Hint</summary>

Split into a control block `{ strong; weak; }` and a separately-tracked payload. Strong-zero runs the destructor and frees the payload but keeps the control block alive until weak-zero — exactly the C++ `shared_ptr`/`weak_ptr` split. `upgrade()` must check `strong > 0` and increment atomically-or-carefully.

</details>

### Task 6 — Make it thread-safe and feel the cost

Convert your Task 4/5 counts to atomic operations so the pointer can be shared across threads. Then write a benchmark: clone-and-drop the pointer in a tight loop, first single-threaded with non-atomic counts, then with atomic counts, then with several threads hammering the *same* pointer.

**Self-check:**

- [ ] My atomic version is correct under concurrent clone/drop (no double-free, no leak).
- [ ] I measured a clear slowdown from non-atomic → atomic even single-threaded.
- [ ] Multiple threads on the *same* count are dramatically slower than threads on *separate* counts — and I can name the cause (cache-line contention).

<details>
<summary>Hint</summary>

Use `std::atomic<size_t>` / Rust `AtomicUsize` with appropriate ordering (relaxed for increment, acq-rel/release+fence for decrement is the standard pattern — read why). Benchmark: `N` iterations of clone+drop. Compare timings. For contention, have `K` threads share one `Arc`/your-pointer vs each holding its own.

</details>

---

## Advanced

### Task 7 — Diagnose a real cycle leak with tools

Write a small Python program that leaks via a cycle (e.g. a cache of objects that hold back-references, or a parent/child graph). Then *find* the leak as you would in production: confirm it's a cycle (not a strong-ref leak) with `gc.collect()`, attribute the allocation site with `tracemalloc`, and draw the retainer graph with `objgraph.show_backrefs`.

**Self-check:**

- [ ] I confirmed it's a cycle by showing `gc.collect()` reclaims the memory.
- [ ] `tracemalloc` pointed me at the source line creating the leaking objects.
- [ ] `objgraph` (or manual `gc.get_referrers`) showed me the exact retainer chain.

<details>
<summary>Hint</summary>

`gc.set_debug(gc.DEBUG_SAVEALL)` then `gc.collect()` puts cyclic garbage in `gc.garbage`. `tracemalloc.start()` + snapshot-compare ranks growth by line. `objgraph.show_growth()` shows which types accumulate; `show_backrefs([obj], max_depth=5)` renders who points at `obj`.

</details>

### Task 8 — Profile and kill atomic-count contention

Take a multithreaded program (Rust `Arc`, C++ `shared_ptr`, or your Task 6 pointer) where many threads clone one hot shared pointer in a loop. Profile it, identify the contention on the count's cache line, then refactor to remove the hot clone (pass by borrow/reference, or clone once per task) and re-measure.

**Self-check:**

- [ ] I located time spent in atomic count ops via a CPU profiler / flame graph.
- [ ] I observed cache-coherence contention (e.g. `perf c2c` HITM events, or high cache-miss counts on the count's address).
- [ ] My refactor measurably reduced both wall-clock time and the contention signal.

<details>
<summary>Hint</summary>

`perf stat -e cache-misses,cache-references` for a quick signal; `perf c2c record/report` to pinpoint cache-to-cache transfers (HITM) on the shared line. The fix: in the inner loop pass `&Arc<T>` instead of `Arc::clone`, or `const shared_ptr&` by reference; clone once outside the loop.

</details>

### Task 9 — Find and fix a closure retain cycle (Swift) or its analogue

In Swift, build a small object that owns a closure capturing `self` (a timer callback, a network completion handler), confirm with Instruments / the Xcode Memory Graph that it leaks, then fix it with `[weak self]`. If you don't have Swift, reproduce the equivalent in Rust/C++: an object whose stored callback `Arc`/`shared_ptr` captures a strong reference back to the object.

**Self-check:**

- [ ] I reproduced the leak and *saw* the retain cycle in a tool (Memory Graph / leak check).
- [ ] `[weak self]` (or a `Weak`/`weak_ptr` capture) broke the cycle and the object now deallocates.
- [ ] I can explain why `unowned`/non-zeroing weak would be faster but riskier here.

<details>
<summary>Hint</summary>

Swift: `self.onDone = { self.cleanup() }` leaks; `self.onDone = { [weak self] in self?.cleanup() }` doesn't. Verify with the Memory Graph Debugger's purple leak badges or Instruments → Leaks → Cycles & Roots. In Rust, store the callback as a `Weak` upgrade-on-call.

</details>

---

## Capstone

### Task 10 — A hybrid allocator: refcounting + cycle detection

Build a miniature managed-object system in a language of your choice that (a) reference-counts objects with inline counts, (b) supports weak references, and (c) includes a simple **cycle detector** that periodically finds and reclaims cyclic garbage the counts can't — i.e. a tiny version of CPython's design. Then write a test suite proving: acyclic objects free promptly via counting, weakly-broken cycles free promptly, and unbroken cycles are reclaimed only by the cycle pass.

**Self-check:**

- [ ] Acyclic graphs are freed immediately at count-zero, *without* invoking the cycle pass.
- [ ] My cycle detector reclaims unreachable cycles and leaves reachable objects alone (it correctly distinguishes "referenced only from within the cycle" from "referenced from outside").
- [ ] Weak references neither keep objects alive nor confuse the cycle detector, and dangling weak refs report "gone."
- [ ] I can articulate, with my own implementation as evidence, why refcounting needs a tracing companion to be complete.

<details>
<summary>Hint</summary>

For the cycle detector, implement the Bacon–Rajan / CPython trick on a set of candidate container objects: copy each candidate's count, **subtract** the references that come from *within* the candidate set, and anything left at zero is reachable *only* through the cycle and is collectable; anything still positive is externally reachable, so mark it and everything it reaches as alive. Restore counts, then free the truly-dead set. Keep the object set small and explicit so the algorithm is easy to inspect.

</details>

---

## Self-Assessment

You've internalized reference counting when you can:

- [ ] Trace a count through a sequence of assignments and predict the exact free point.
- [ ] Explain *in terms of counts* why a cycle leaks, and break it with a weak reference on the correct edge.
- [ ] Implement a counted smart pointer with strong/weak counts and a correct control-block lifetime.
- [ ] State why atomic counting is far costlier than non-atomic, and demonstrate cache-line contention with a benchmark.
- [ ] Diagnose a production cycle leak: distinguish it from a strong-ref leak, attribute the allocation site, and find the retainer chain.
- [ ] Find and kill atomic-count contention by removing hot clones from inner loops.
- [ ] Argue when reference counting beats tracing GC (latency, promptness, footprint, single-owner) and when it loses (throughput, cycles, heavy shared mutation).
- [ ] Describe how CPython, Swift/ARC, Rust, and C++ each implement counting and cycle handling, and why their choices differ.

If every box is checked, you understand reference counting at the depth this topic is meant to convey.
