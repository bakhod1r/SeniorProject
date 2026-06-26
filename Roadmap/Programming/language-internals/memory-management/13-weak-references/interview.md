# Weak References — Interview Questions

> **Topic:** [Weak References](README.md)

---

## Introduction (2-3 sentences)

These questions probe whether you understand weak references as a *lifetime-decoupling tool* rather than a "maybe-pointer" trick. Interviewers look for three things: that you can name the clearing contract of each strength tier, that you can spot the strong reference that secretly defeats a weak one (self-pinning, lapsed-listener), and that you reflexively handle the use-after-check race by capturing into a strong local. Concrete language details (Java tiers, Rust `upgrade()`, Swift `weak`/`unowned`, Python weak dicts, JS/Go non-determinism) separate people who have read about weak refs from people who have shipped them.

## Table of Contents

- [Conceptual](#conceptual)
- [Tool-Specific](#tool-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What is a weak reference, and how does it differ from a strong reference?**

A weak reference names an object without contributing to the garbage collector's "keep alive" decision. The collector computes reachability using the *strongest* reference chain to each object; a strong reference forces the object to survive, while a weak reference does not. If an object is reachable only through weak references, the collector is free to reclaim it and clear those references. The practical consequence: dereferencing a weak reference can yield "nothing" at any time, so every access must be defensive. You use weakness whenever *lifetime should be decided by someone other than the holder of this pointer* — caches, registries, metadata, cycle-free back-pointers.

## Question 2

**Explain Java's four reference tiers and when each clears.**

- **Strong** (a plain reference): never cleared by GC; the object lives while strongly reachable.
- **Soft** (`SoftReference`): cleared at the GC's discretion *under memory pressure*, guaranteed before an `OutOfMemoryError` — intended as a memory-sensitive backstop.
- **Weak** (`WeakReference`): cleared eagerly at the next GC once the referent is only weakly reachable — for canonicalizing maps and metadata.
- **Phantom** (`PhantomReference`): never returns the referent; enqueued *after* the object is finalized/unreachable, for post-mortem cleanup.

The clearing order matters: soft and weak references are cleared *before* finalization, while phantom references are enqueued *after*, which is their entire reason for existing (safe cleanup with no resurrection).

## Question 3

**What is a `ReferenceQueue` and why would you need one?**

A bare weak reference is passive — you only learn the referent is gone when you happen to dereference and get null. A `ReferenceQueue` makes clearing *active*: you register a reference with a queue, and when the GC clears it, the GC enqueues the (now-cleared) reference object. A background thread or an on-access poll drains the queue to run cleanup — evict the dead map slot, free a native handle. This is exactly how `WeakHashMap` purges stale entries and how `Cleaner` runs post-mortem callbacks. Without draining it, referents are freed but the reference objects and map slots pile up — a logical leak with a healthy-looking live set.

## Question 4

**What's the difference between a weak-keyed and a weak-valued map?**

Decide by asking *"whose death should remove the entry?"* A **weak-keyed** map (`WeakHashMap`, `WeakKeyDictionary`) keeps the entry while the *key* is strongly reachable elsewhere — use it for **metadata about an object you don't own**, so the metadata dies with the object. A **weak-valued** map (`WeakValueDictionary`) keeps the entry while the *value* is strongly reachable elsewhere — use it for a **canonicalizing/interning cache of shared instances**, so the entry vanishes when no one else holds the value. Choosing the wrong side silently leaks (entry never clears) or silently loses data (entry vanishes between lookups).

## Question 5

**Why can't reference counting reclaim cycles, and how do weak references fix it?**

In `A → B → A`, each object's count stays at ≥ 1 forever because the other keeps it referenced, so neither is ever freed — a hard leak in `Rc`/`Arc`, Swift ARC, and C++ `shared_ptr` (CPython has a backup cycle collector, but the fast path is refcounting). The fix is to make exactly one edge of every cycle *weak*, oriented consistently. The canonical shape is an ownership tree: parent → child is strong (the parent owns its children), child → parent is weak (navigate up without keeping the parent alive). Break the cycle's one weak edge and the structure collapses cleanly when the root is dropped.

---

## Tool-Specific

## Question 6

**How does Rust's `Weak<T>` work, and why does `upgrade()` return an `Option`?**

`Weak<T>` is produced by `Rc::downgrade` or `Arc::downgrade`. You cannot dereference it directly because the value may already be gone; instead you call `.upgrade()`, which returns `Option<Rc<T>>`: `Some(rc)` — atomically bumping the strong count so the value is safe to use for as long as you hold the `Rc` — if it's still alive, or `None` if the last strong owner has dropped. This makes the use-after-check race *structural*: you can only touch the value through the owning `Rc` that `upgrade()` hands you, so the borrow checker guarantees it stays alive for that scope. The allocation lives until both strong and weak counts reach zero, but the inner `T` is dropped when the strong count hits zero.

## Question 7

**Swift: when do you use `weak` vs `unowned`, and what does `[weak self]` do?**

Use **`weak`** when the referent can legitimately deallocate before you (a delegate, a parent that may outlive *or* predecease the child): it's an `Optional` that ARC auto-nils on deallocation, so you handle nil. Use **`unowned`** when the referent is *guaranteed* to outlive you (a child referencing a parent that owns it): it's non-optional with no zeroing overhead, but touching it after deallocation crashes (`unowned(unsafe)` is UB). `[weak self]` in an escaping closure breaks the retain cycle where `self` stores a closure that captures `self` strongly — you write `{ [weak self] in guard let self else { return }; … }` so the closure holds `self` weakly and treats it as optional. Default to `weak`; reach for `unowned` only when the lifetime guarantee is real.

## Question 8

**Python: what's the difference between `WeakValueDictionary` and `WeakKeyDictionary`, and what can't be weakly referenced?**

`WeakValueDictionary` holds *values* weakly — entries vanish when the value has no other strong references, making it the canonical interning/canonicalization table. `WeakKeyDictionary` holds *keys* weakly (by identity) — entries vanish when the key dies, making it the tool for per-object metadata/side tables. Not every object can be weakly referenced: CPython needs a `__weakref__` slot, so `int`, `str`, tuples, and `__slots__` classes that omit `__weakref__` raise `TypeError` when you call `weakref.ref` on them. `weakref.finalize` provides a cleanup callback that runs when the referent dies.

## Question 9

**JavaScript: how do `WeakRef`, `WeakMap`, and `FinalizationRegistry` differ, and what's the big caveat?**

`WeakMap`/`WeakSet` are weakly-*keyed* collections — they don't keep their keys alive and are deliberately non-iterable (so collection timing can't be observed). `WeakRef` wraps a single object; `.deref()` returns it or `undefined`. `FinalizationRegistry` runs a callback after a registered object is collected. The big caveat, stated loudly in the spec: **timing is non-deterministic and unobservable** — finalization callbacks may fire late, in any order, or *never* (e.g. on page unload, or if the engine declines). So use these as opportunistic backstops only; never build correctness on `FinalizationRegistry` firing.

## Question 10

**Go added weak references in 1.24 — what does the API look like and what did it replace?**

Go historically had no weak references; people abused `runtime.SetFinalizer` for resurrection tricks. Go 1.24 added a real `weak` package with `weak.Pointer[T]`, whose `.Value()` returns the pointer or `nil`, giving first-class support for canonicalizing maps and weak caches. Paired with it is `runtime.AddCleanup`, a safer replacement for `SetFinalizer`: the cleanup function must *not* close over the object being cleaned (capture only the handle), it can be registered multiple times, and it avoids the object-resurrection footguns that made `SetFinalizer` notoriously hard to use correctly.

---

## Tricky / Trap

## Question 11

**What's wrong with `if (ref.get() != null) ref.get().process();`?**

It calls `get()` twice. Between the null-check and the use, the GC can clear the reference (possibly triggered by your own allocation), so the second `get()` can return null and the call NPEs. This is the **use-after-check race**. The fix is to capture once into a strong local, which re-strengthens the referent for the duration of use: `Target t = ref.get(); if (t != null) t.process();`. The rule is universal across languages — Rust's `upgrade()` enforces it structurally, and in Python/JS/Go you capture `obj = ref()` / `ref.deref()` / `wp.Value()` once. Never dereference a weak reference twice for one logical use.

## Question 12

**You put entries in a `WeakHashMap` keyed by an object, but the map never shrinks. Why?**

Almost certainly the **self-pinning trap**: the *value* (or something it transitively reaches) holds a *strong* reference back to the key. The weak key is now strongly reachable through its own value, so the entry never clears and the map grows forever. It's invisible in tests (few keys, short-lived) and only shows up as a heap that grows linearly with traffic over days. The fix is to break the back-edge — the value must not strongly reference the key; store an id or a weak reference instead. (A second, rarer cause: `WeakHashMap` uses `equals`/`hashCode`, not identity, so a key you can no longer construct an equal of stays as a dead slot until pruned.)

## Question 13

**You switched a registry to weak listeners to fix a leak, and now your callback fires a few times then silently stops. What happened?**

The weak registry became the *only* strong reference to the listener. A lambda registered inline (`bus.addWeakListener(e -> handler.handle(e))`) has no other strong referent, so the GC collects it at the next GC and the callback silently dies. A weak registry should be the *safety net* for forgotten deregistration, not the primary lifetime owner. Fix it by giving the listener an explicit strong owner — store it in a field that lives as long as you want the callback active — and let the weak registry auto-drop it only when that owner goes away.

## Question 14

**Is a `Map<K, SoftReference<V>>` a good cache? Why or why not?**

No — soft references are a poor cache *policy*. They have no eviction order (the JVM clears in an implementation-defined order, so your hottest entry can go while cold ones survive), no size bound (a soft cache fills the heap to near-capacity, *raising* GC frequency and pauses), and clear all-at-once under pressure (hit rate drops to 0% in one GC, producing a sawtooth latency profile). A real cache needs an explicit, bounded policy — LRU/LFU with a size/weight/TTL cap and observable hit-rate metrics (Caffeine/Guava). Use soft references only as a coarse last-resort backstop, if at all. Weak *values* are legitimate for canonicalization — a different job from capacity-managed caching.

---

## Design

## Question 15

**Design a thread-safe interning table that guarantees one canonical instance per key without leaking instances.**

A **weak-valued** map: lookups return the same live instance, but the table never prolongs an instance's lifetime past its last external holder. The hazard is the get-or-create race plus the clearing race. Use a `ConcurrentHashMap<K, WeakReference<V>>` and, on lookup, capture `ref.get()` once into a strong local; if it's non-null, return it (re-strengthened). If null/absent, create a fresh instance and install it with `putIfAbsent`/`replace(key, oldDeadRef, newRef)` in a CAS loop so concurrent creators converge on one winner; the losers' instances are GC'd. Dead slots self-prune on access (or drain a `ReferenceQueue`); periodically touch a cold map. In Python this is just `weakref.WeakValueDictionary` (with a lock if you need a hard identity guarantee rather than a best-effort cache).

## Question 16

**Design the cleanup path for an object that owns a native resource (file descriptor / socket). What are the rules?**

Provide a deterministic `close()`/`AutoCloseable`/`Drop` as the primary path — that's how the resource is released promptly. Then register a *post-mortem backstop* (Java `Cleaner`, Go `runtime.AddCleanup`, JS `FinalizationRegistry`) so a forgotten close eventually frees the resource. The cardinal rule: **the cleanup state must not strongly reference the owning object** — capture only the raw handle (the fd/pointer/id). If the cleanup closes over the owner, the owner is kept alive, the backstop never runs, and you leak both. Never use the old finalizer (`finalize()`/`SetFinalizer`) — they have resurrection and ordering hazards and run late. And never rely on the backstop's *timing*: it may fire late or, in JS, never. Promptness comes from the explicit close; the post-mortem hook is only insurance.
