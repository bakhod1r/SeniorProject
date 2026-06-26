# Weak References — Hands-On Tasks

> **Topic:** [Weak References](README.md)

These tasks build the muscle memory that separates reading about weak references from shipping them: proving clearing actually happens, building self-cleaning collections, reproducing (and then fixing) the self-pinning and lapsed-listener leaks, breaking cycles in a refcounted language, and reading a leak from a heap dump. Pick whichever language each task names; where a language is left open, use one with a real weak-reference API (Java, Python, Rust, Swift, Go 1.24+, or JS).

---

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Prove a weak reference actually clears

Create an object, hold it via a weak reference, drop your strong reference, force a GC, and observe the weak reference go empty. In Java use `WeakReference` + `System.gc()`; in Python `weakref.ref` + `gc.collect()`; in JS `WeakRef` + (if available) `--expose-gc`; in Go 1.24 `weak.Pointer` + `runtime.GC()`.

**Self-check:**
- [ ] The deref returns the object *before* you drop the strong reference.
- [ ] After dropping the strong reference and forcing GC, the deref returns null/`None`/`undefined`/`nil`.
- [ ] You can articulate why holding the result of the deref in a variable would have *prevented* clearing.

*Hint:* If clearing doesn't happen, you still have a strong reference somewhere — a local, a closure, an interactive-shell `_`, or the loop variable. Print your strong/weak counts (Rust `Rc::strong_count`) to confirm.

### Task 2 — Show that strength is a max over all paths

Reference one object with *both* a strong and a weak reference. Force GC and show it survives. Then drop only the strong one, GC again, and show the weak now clears.

**Self-check:**
- [ ] With both references present, GC does not clear the weak reference.
- [ ] You can state the rule: an object is collectible only when *every* path to it is weak-or-weaker.

### Task 3 — Capture-once vs the double-deref bug

Write the buggy version first: `if (ref.get() != null) ref.get().doThing();` (or your language's equivalent). Then rewrite it to capture once into a strong local. Explain in a comment why the buggy form can fail even though the check passed.

**Self-check:**
- [ ] The fixed version dereferences the weak reference exactly once per logical use.
- [ ] Your comment names the hazard (the referent can be cleared between the check and the use).

---

## Core

### Task 4 — Build a self-cleaning weak-valued interning table

Implement `intern(key) -> instance` that returns the *same* live instance for equal keys but never keeps an instance alive after its last external holder drops it. Use a weak-valued structure (Python `WeakValueDictionary`, or Java `ConcurrentHashMap<K, WeakReference<V>>`).

**Self-check:**
- [ ] Two `intern` calls with the same key, while a strong reference is held, return the identical instance.
- [ ] After all external strong references are dropped and GC runs, a later `intern` with the same key creates a *fresh* instance.
- [ ] You capture the deref into a strong local before deciding hit vs miss.

*Hint:* In the Java version, the create path needs `putIfAbsent`/`replace` in a small CAS loop so two concurrent creators converge on one winner. The loser's instance is simply GC'd.

### Task 5 — Build a weak-keyed metadata side table

Attach computed metadata to objects you "don't own" using a weak-keyed map (Java `WeakHashMap`, Python `WeakKeyDictionary`). Show the metadata entry disappears automatically when the keyed object dies.

**Self-check:**
- [ ] Metadata is retrievable while the keyed object is strongly reachable.
- [ ] After the keyed object is dropped and GC runs, the entry is gone (map size shrinks, or the key is no longer present).
- [ ] You verified the *value* does **not** strongly reference the key (no self-pinning).

### Task 6 — ReferenceQueue-driven eviction

Register weak references with a `ReferenceQueue` (Java) or a `FinalizationRegistry` (JS) / `weakref.finalize` (Python). When a referent dies, drain the queue and remove the corresponding bookkeeping entry from a side index. Prove the index shrinks.

**Self-check:**
- [ ] Each cleared reference triggers exactly one cleanup of the matching side-index entry.
- [ ] The cleanup code does **not** capture/strong-reference the dying object.
- [ ] You can explain what accumulates if you *never* drain the queue (reference objects + slots, even though referents are freed).

### Task 7 — Reproduce and fix the self-pinning leak

Build a `WeakHashMap<Key, Value>` where the `Value` deliberately stores a strong reference back to its `Key`. Show the map never shrinks even after all external references to keys are dropped and GC runs. Then fix it (store an id instead of the key, or hold the key weakly) and show the map now self-cleans.

**Self-check:**
- [ ] In the broken version, map size stays constant after dropping keys + GC.
- [ ] In the fixed version, map size drops to zero after dropping keys + GC.
- [ ] You can explain *why* the weak key was still strongly reachable in the broken version.

---

## Advanced

### Task 8 — Weak listener registry without silent death

Build an event bus that stores listeners *weakly* so a listener whose owner is gone is auto-deregistered (no lapsed-listener leak). Then demonstrate the trap: register an inline lambda with no other strong reference and show it stops firing after GC. Finally, fix it by giving the listener an explicit strong owner and show it keeps firing until the owner is dropped.

**Self-check:**
- [ ] An owned listener fires for as long as its owner is alive, then auto-deregisters when the owner dies.
- [ ] The inline-lambda-with-no-owner case demonstrably stops firing after GC (this is the trap).
- [ ] You can state the design rule: the weak registry is a *safety net* for forgotten deregistration, not the primary lifetime owner.

*Hint:* To make the trap reproducible, force a GC between registration and the next event. Without it, the listener may linger long enough to fire and hide the bug.

### Task 9 — Break a cycle in a refcounted language

In Rust (`Rc`/`Weak`) or Swift (ARC), build a parent/child tree where parent → child is strong and child → parent is weak. First build it *wrong* (both directions strong) and observe the leak — destructors never run / strong counts never reach zero. Then orient one edge weak and observe clean teardown.

**Self-check:**
- [ ] In the all-strong version, the nodes' `Drop`/`deinit` never run when the tree goes out of scope.
- [ ] In the parent-strong/child-weak version, dropping the root frees the whole tree (destructors run).
- [ ] Walking up from a child uses `upgrade()` (Rust) / the optional `weak` (Swift) and handles the "parent already gone" case.

*Hint:* Instrument with `Rc::strong_count`/`Rc::weak_count` (Rust) or a print in `deinit` (Swift). The wrong orientation (strong up, weak down) is a different bug: children evaporate while you still hold the root — try it and explain the difference.

### Task 10 — `[weak self]` and `unowned` in closures (Swift, or model it)

Create a type that stores an escaping closure which references the instance. Show that capturing `self` strongly forms a retain cycle (the instance leaks). Fix it with `[weak self]` (guard-let inside). Then identify one case where `unowned` would be correct and justify why the lifetime guarantee holds.

**Self-check:**
- [ ] The strong-capture version leaks the instance (`deinit` never runs).
- [ ] The `[weak self]` version deallocates the instance and the closure safely no-ops after deallocation.
- [ ] You can articulate why your chosen `unowned` case is safe (referent guaranteed to outlive the closure) and what would crash if that guarantee broke.

### Task 11 — Cleaner / AddCleanup for a native-ish resource

Model an object owning an external resource (a counter you must "release", a fake fd). Wire a post-mortem cleanup via Java `Cleaner`, Go `runtime.AddCleanup`, or `weakref.finalize`. Provide an explicit `close()`/`Drop` as the primary path. Prove the backstop runs only when you *forget* to close, and that closing makes the backstop a no-op.

**Self-check:**
- [ ] Calling `close()` releases the resource promptly and exactly once.
- [ ] Forgetting `close()` and dropping the object eventually triggers the backstop after GC.
- [ ] The cleanup state captures only the handle, **not** the owning object — and you can show that capturing the owner would prevent cleanup forever.

---

## Capstone

### Task 12 — Diagnose a reference-related leak from a heap dump

Write a long-running program that leaks via a self-pinning `WeakHashMap` (reuse Task 7's broken version, or an unbounded listener list). Let it grow, then capture a heap dump and find the leak *from the dump alone*.

**Self-check:**
- [ ] You forced a full GC and confirmed the *post-GC* live set rises over time (a real leak, not cache headroom).
- [ ] You captured a heap dump (`jcmd GC.heap_dump`, MAT acquire, Python `objgraph`, or a JS heap snapshot).
- [ ] Using "shortest path to GC roots **excluding weak/soft references**" (MAT) or equivalent, you found the *strong* path keeping the suspect alive.
- [ ] You identified the exact reference that should have been weak (or the queue you forgot to drain) and fixed it.
- [ ] After the fix, the post-GC live set is flat under the same workload.

*Hint:* The whole trick is excluding weak references from the retention path. If the only path to your object runs through a weak reference, it is *not* leaked. What survives the exclusion is your bug. In DevTools, the Retainers panel marks `WeakMap`/`WeakRef` edges so you can tell strong from weak retention.

### Task 13 — Design write-up: choose the right tier for five scenarios

For each scenario, decide strong / soft / weak / phantom (and weak-keyed vs weak-valued where relevant), and justify it in two or three sentences: (a) a flyweight glyph cache shared across a renderer; (b) per-request parsed-form metadata attached to framework `Request` objects you don't control; (c) an in-memory cache of decoded images sized to fit a memory budget; (d) freeing a GPU texture handle when its wrapper object dies; (e) a child node's pointer back to its parent in an ownership tree.

**Self-check:**
- [ ] (a) is weak-*valued* canonicalization; (b) is weak-*keyed* metadata; (c) is a *bounded* cache (LRU + size cap) — **not** soft references; (d) is phantom/`Cleaner`/`AddCleanup`; (e) is a weak back-pointer.
- [ ] For (c) you explicitly rejected `SoftReference`-as-policy and named the eviction policy you'd use instead.
- [ ] Each justification names *whose lifetime drives eviction*.

---

## Self-Assessment

You're ready to move on when you can, without notes:

- [ ] Force a weak reference to clear on demand and explain exactly why it does (or doesn't) clear.
- [ ] State the clearing contract of strong/soft/weak/phantom and the ordering relative to finalization.
- [ ] Choose weak-keyed vs weak-valued by asking *whose death should evict the entry*, and audit the value for a strong back-reference to the key.
- [ ] Reproduce *and* fix the self-pinning `WeakHashMap` leak and the lapsed-listener / weak-registry-sole-owner trap.
- [ ] Break a refcount cycle by weakening exactly one edge, oriented correctly, in Rust or Swift — and explain what breaks if the orientation is reversed.
- [ ] Write `[weak self]` capture correctly and say when `unowned` is justified instead.
- [ ] Always capture a deref into a strong local once, and explain the use-after-check race.
- [ ] Wire post-mortem cleanup whose state never references the dying object, backed by an explicit `close()`/`Drop`.
- [ ] Argue why `SoftReference`-as-cache is a poor policy and name what to use instead.
- [ ] Find a reference-related leak in a heap dump by excluding weak/soft references from the retention path.
