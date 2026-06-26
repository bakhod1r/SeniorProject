# Weak References — Senior Level

> **Topic:** [Weak References](README.md)
> **Focus:** The design space across runtimes — strength tiers, clearing guarantees, and choosing the right tool for caches, registries, and cycle-breaking.

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Reachability Strength Spectrum](#the-reachability-strength-spectrum)
3. [Java's Four Reference Tiers](#javas-four-reference-tiers)
4. [Cross-Language Survey](#cross-language-survey)
5. [Design Patterns That Need Weakness](#design-patterns-that-need-weakness)
6. [Weak-Keyed vs Weak-Valued Maps](#weak-keyed-vs-weak-valued-maps)
7. [Cycle Breaking in Refcounted Systems](#cycle-breaking-in-refcounted-systems)
8. [Pros & Cons](#pros--cons)
9. [Best Practices](#best-practices)
10. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
11. [Summary](#summary)

---

## Introduction

A weak reference is a deliberate hole in the reachability graph: it names an object
without contributing to the "keep alive" decision. At a junior level that is a
curiosity; at a senior level it is a precise design tool you reach for whenever
*lifetime should be decided by someone other than the holder of this pointer* — a cache
whose entries must die when memory is tight, a registry that must not outlive its
subjects, a back-pointer that must not create a cycle. The skill is matching the exact
strength and clearing semantics to the requirement, because "I'll just hold a weak ref"
hides several genuinely different contracts.

---

## The Reachability Strength Spectrum

Garbage collectors classify objects by the *strongest* reference chain that reaches them
from a root. Most runtimes expose at least two strengths; Java exposes four:

- **Strongly reachable** — reachable through a chain of ordinary references. Never
  collected. This is the default.
- **Softly reachable** — reachable only through soft references (plus weaker). Collected
  *at the GC's discretion, under memory pressure*. Intended for memory-sensitive caches.
- **Weakly reachable** — reachable only through weak references (plus weaker). Collected
  *eagerly, at the next GC that notices*. Intended for canonicalizing maps and metadata.
- **Phantom reachable** — finalized, with only phantom references remaining. Used to
  schedule post-mortem cleanup without the hazards of finalizers.

The mental model: the collector computes reachability, then "downgrades" objects whose
only surviving links are weak/soft/phantom, clearing those references according to each
tier's rule.

---

## Java's Four Reference Tiers

Java is the canonical place to study this because it names all four explicitly in
`java.lang.ref`:

| Tier | Class | Cleared when | Typical use |
|---|---|---|---|
| Strong | (plain reference) | never (until unreachable) | normal objects |
| Soft | `SoftReference<T>` | under memory pressure, before OOM | memory-sensitive cache |
| Weak | `WeakReference<T>` | next GC once only-weakly-reachable | canonicalizing map, metadata |
| Phantom | `PhantomReference<T>` | after finalization, never returns referent | native-resource cleanup |

**`ReferenceQueue`** ties it together: you register a reference with a queue, and when
the GC clears it, the reference is *enqueued*. A background thread polls the queue to do
cleanup (evict the now-dead map entry, free a native handle). `WeakHashMap` uses exactly
this — its entries are weakly-keyed and a stale-entry sweep drains the queue on each
access.

**`Cleaner`** (Java 9+) wraps the phantom + queue pattern into a safe API and is the
sanctioned replacement for `finalize()`.

A subtlety seniors must internalize: **`get()` can return `null` at any time**. Between
"I checked it's non-null" and "I used it," nothing — every access must capture the
result into a strong local first (`T v = ref.get(); if (v != null) …`), which
*temporarily re-strengthens* it for the duration of use.

---

## Cross-Language Survey

- **Python** — `weakref.ref(obj)` (call it to deref, returns `None` if dead), `proxy`
  (transparent but raises on dead access), and the collection types
  `WeakValueDictionary` (entries vanish when the *value* dies — the canonical cache),
  `WeakKeyDictionary` (metadata keyed by object identity), `WeakSet`, and
  `weakref.finalize` for cleanup callbacks. Not every object supports weak refs (CPython
  needs a `__weakref__` slot; `int`, `str`, and `__slots__` classes without it cannot be
  weakly referenced).
- **Rust** — `Weak<T>` is produced by `Rc::downgrade`/`Arc::downgrade`. You cannot
  dereference it directly; you call `.upgrade()`, which returns `Option<Rc<T>>` —
  `Some` (atomically bumping the strong count for safe use) if the value is still alive,
  `None` if the last strong owner has dropped. `strong_count`/`weak_count` are
  introspectable. The allocation itself lives until *both* counts hit zero, but the
  inner `T` is dropped when the strong count reaches zero.
- **Swift** — `weak var` auto-nils to an `Optional` when the referent deallocates (ARC
  zeroes it). `unowned` is the non-optional cousin: no nil, no overhead, but a crash
  (or UB in `unowned(unsafe)`) if you touch it after the referent is gone. Choose `weak`
  when the referent can legitimately outlive-or-predecease you, `unowned` when it is
  guaranteed to outlive you (e.g. a child's reference to a parent that owns it).
- **JavaScript** — `WeakRef` (with `.deref()`), `WeakMap`/`WeakSet` (weakly-keyed, not
  iterable by design), and `FinalizationRegistry` for cleanup callbacks — all added late
  and all carrying loud spec warnings that timing is unobservable and non-deterministic.
- **Go** — historically had *no* weak references; people abused `runtime.SetFinalizer`
  for resurrection-based tricks. Go 1.24 introduced a real `weak` package with
  `weak.Pointer[T]` (`.Value()` returns the pointer or nil), which (together with
  `runtime.AddCleanup`) finally gives Go canonicalizing-map and weak-cache patterns
  first-class support.

---

## Design Patterns That Need Weakness

1. **Canonicalizing / interning map** — ensure at most one instance per logical key
   (interned strings, flyweight glyphs, a shared parsed-schema cache). The map must not
   keep instances alive after the program stops using them, so values (or keys) are
   weak. `WeakValueDictionary` / `WeakHashMap` are purpose-built.
2. **Observer / listener registry** — the subject holds listeners weakly so that a
   listener going out of scope is automatically deregistered. This kills the classic
   **lapsed-listener leak**, where forgetting to call `removeListener` pins objects
   forever.
3. **Object-associated metadata** — attach data to objects you do not own (you can't add
   a field). A `WeakKeyDictionary` / `WeakHashMap<Obj, Meta>` lets the metadata die with
   the object.
4. **Parent back-pointers** — in trees/graphs where parents own children strongly,
   children point back weakly so the structure has no cycle.

---

## Weak-Keyed vs Weak-Valued Maps

This distinction trips up even strong engineers:

- **Weak *keys*** (`WeakHashMap`, `WeakKeyDictionary`): the entry lives as long as the
  *key* is strongly reachable elsewhere. Use for *metadata about an object* — when the
  object dies, its metadata should die. **Danger:** if the *value* strongly references
  the key, the entry pins itself forever (a self-referential leak). Values must not point
  back at their keys.
- **Weak *values*** (`WeakValueDictionary`): the entry lives as long as the *value* is
  strongly reachable elsewhere. Use for a *cache of shared instances* — when nobody else
  holds the canonical object, drop the cache slot.

Pick by asking: "what is the thing whose lifetime should drive eviction — the key or the
value?"

---

## Cycle Breaking in Refcounted Systems

Reference counting cannot reclaim cycles: `A → B → A` keeps both counts at ≥1 forever.
The standard fix is to make exactly one edge of every cycle weak. The canonical shape is
a tree:

- **Parent → child: strong** (the parent owns the children; they live as long as it
  does).
- **Child → parent: weak** (the child can navigate up but does not keep the parent
  alive).

In Rust this is `parent: RefCell<Vec<Rc<Node>>>` downward and `parent: RefCell<Weak<Node>>`
upward; the child calls `self.parent.borrow().upgrade()` to reach the parent. Get the
direction wrong (strong up, weak down) and children evaporate while you still hold the
parent. The same principle applies to Swift delegate patterns (`weak var delegate`) and
C++ `shared_ptr`/`weak_ptr` graphs.

---

## Pros & Cons

**Pros**
- Decouples *naming* an object from *keeping it alive* — the core enabler for caches,
  registries, and cycle-free back-pointers.
- Automates deregistration, eliminating whole classes of lifetime leaks.
- Soft references give the runtime a memory-pressure release valve for free.

**Cons**
- Non-determinism: you cannot predict *when* a referent disappears, so every deref is a
  branch you must handle.
- Soft-reference timing is collector-dependent and notoriously unsuitable as a real
  eviction policy (no size or recency control).
- Overhead: weak refs need GC bookkeeping (a registry of weak pointers to clear), and
  upgrade in atomic-refcount systems touches a shared counter.
- Easy to misuse: weak-keyed maps with back-referencing values, racing on upgrade,
  assuming `get()` stays non-null.

---

## Best Practices

- **Always handle the null/`None`/`upgrade()→None` case** at every dereference; capture
  into a strong local before use.
- **Don't use soft references as a cache eviction policy.** Use a real bounded cache
  (LRU + size/TTL); reach for soft refs only as a coarse "give memory back under
  pressure" backstop, if at all.
- **Choose weak-keyed vs weak-valued deliberately**, and ensure values don't strongly
  reference weak keys.
- **Prefer purpose-built collections** (`WeakHashMap`, `WeakValueDictionary`,
  `WeakValueMap` equivalents) over hand-rolled weak-ref bookkeeping.
- **For cleanup, use phantom/`Cleaner`/`AddCleanup`, not `get()`-polling**, so cleanup is
  driven by the queue rather than ad-hoc checks.

---

## Edge Cases & Pitfalls

- **The use-after-check race:** `if (ref.get() != null) ref.get().foo()` can NPE on the
  second `get()`. Capture once.
- **Self-pinning weak-keyed maps:** value → key strong reference defeats the weakness.
- **Resurrection windows:** an object that is weakly reachable may be temporarily
  re-strengthened by a successful `get()`/`upgrade()`, momentarily un-clearing it.
- **Objects that can't be weakly referenced:** Python `__slots__` without `__weakref__`,
  certain interned primitives.
- **Soft-reference heap bloat:** softly-reachable objects survive until pressure, so a
  soft cache can quietly hold the heap near full and *increase* GC frequency.
- **Finalizer interplay:** a referent with a finalizer is reclaimed a cycle later than a
  plain one, shifting when the weak ref clears.

---

## Summary

Weak references let lifetime be decided by something other than the holder, which is
exactly what caches, registries, metadata maps, and cycle-free back-pointers need. Java
formalizes a four-tier strength spectrum (strong/soft/weak/phantom) plus
`ReferenceQueue`; Python, Rust, Swift, JavaScript, and (finally) Go 1.24 each expose a
subset. The senior-level skill is matching the exact tier and clearing semantics to the
requirement — weak-keyed for metadata, weak-valued for shared-instance caches, soft only
as a pressure valve, phantom for cleanup — while treating every dereference as a branch
that may find the referent already gone.
