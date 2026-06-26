# Weak References — Middle Level
> **Topic:** [Weak References](README.md)
> **Focus:** The mechanisms — reachability strength, clearing semantics, notification queues, and weak-keyed/weak-valued maps.

---

## Table of Contents
- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
  - [The reachability spectrum](#the-reachability-spectrum)
  - [The clearing lifecycle](#the-clearing-lifecycle)
  - [ReferenceQueue: getting notified](#referencequeue-getting-notified)
  - [Weak-keyed vs weak-valued maps](#weak-keyed-vs-weak-valued-maps)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Coding Patterns](#coding-patterns)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

At the junior level a weak reference was a "maybe-pointer." Now we look at *how* the runtime decides when to clear it, *how* it can tell you that clearing happened, and *how* the standard library packages all of this into ready-made collections (`WeakHashMap`, `WeakValueDictionary`, `WeakMap`). The recurring decision you'll learn to make is **which strength to use** and **which side of a map to make weak** — choosing wrong silently leaks memory or silently loses data.

## Prerequisites

- Junior tier: weak references reference without retaining; you must dereference defensively.
- A working idea of GC *phases*: the collector traces reachable objects from roots, then reclaims the rest.
- Maps/dictionaries and the concept of a key's lifetime vs. a value's lifetime.

## Glossary

| Term | Meaning |
|------|---------|
| **Soft reference** | Cleared only under memory pressure (Java); for memory-sensitive caches. |
| **Weak reference** | Cleared at the next GC once the referent is only weakly reachable. |
| **Phantom reference** | Never returns the object; enqueued *after* the object is finalized, for post-mortem cleanup. |
| **ReferenceQueue** | A queue the GC pushes references onto when it clears them, so you can run cleanup. |
| **Reachability strength** | The "strongest" kind of reference chain that reaches an object; determines its fate. |
| **Weak-keyed map** | Entry dies when the *key* becomes unreachable elsewhere (`WeakHashMap`, `WeakKeyDictionary`). |
| **Weak-valued map** | Entry dies when the *value* becomes unreachable elsewhere (`WeakValueDictionary`). |

## Core Concepts

### The reachability spectrum

Java formalizes a spectrum that is the clearest mental model even if you work in other languages. From strongest to weakest:

| Strength | Survives an ordinary GC? | Cleared when... | Typical use |
|----------|--------------------------|-----------------|-------------|
| **Strong** | Always | never by GC (only when you drop it) | normal references |
| **Soft** | Usually | the JVM is running low on memory | memory-sensitive caches |
| **Weak** | No | next GC where it's only weakly reachable | canonicalizing maps, metadata |
| **Phantom** | No (object already gone) | after finalization, on enqueue | post-mortem resource cleanup |

The GC computes, for each object, the *strongest* reference path that reaches it. An object reachable by *any* strong path is strongly reachable and safe. If the strongest path is soft, it is softly reachable; weak, weakly reachable; phantom, phantom-reachable. The collector then applies the rule for that level.

```
strongest path is:   STRONG   SOFT      WEAK         PHANTOM
                      │        │         │            │
fate:                 keep     keep      clear now    object already
                               unless    (collect)    collected; ready
                               low mem                 for cleanup
```

Crucially, a single strong reference *anywhere* overrides all weaker ones. An object referenced by both a strong and a weak reference is strongly reachable; the weak reference is irrelevant until the strong one disappears.

### The clearing lifecycle

For a weak reference, the runtime performs (conceptually) these steps during collection:

1. **Detect** that the referent is only weakly reachable (no stronger path).
2. **Clear** the weak reference atomically — from now on, dereferencing yields "nothing."
3. **Reclaim** the referent's memory.
4. **(Optionally) enqueue** the now-cleared reference object onto a `ReferenceQueue` so your code can react.

The order matters: *clearing happens before you can observe the object is gone*, so there is never a moment where you can resurrect a weakly-reachable-then-collected object through its weak reference. (Soft and weak are cleared before the referent is finalized; phantom references are enqueued *after* finalization — that's their entire reason to exist.)

### ReferenceQueue: getting notified

A bare weak reference is *passive*: you only learn the referent is gone when you happen to dereference and get nothing. Often you need to be *told*, so you can remove the dead entry from your data structure. That is what a **ReferenceQueue** provides.

You construct a weak/phantom reference *registered with a queue*. When the GC clears the reference, it pushes that reference object onto the queue. A background thread (or a lazy poll at access time) drains the queue and runs cleanup — e.g., "this cache slot's value died, delete the slot."

```
GC clears ref ──▶ ReferenceQueue ──poll()──▶ your cleanup code removes the stale entry
```

This is exactly how `WeakHashMap` purges dead entries and how Java's `Cleaner` (and JavaScript's `FinalizationRegistry`) run post-mortem callbacks.

### Weak-keyed vs weak-valued maps

This is the choice juniors most often get wrong. A map associates keys with values; making one side weak means "let this entry disappear when *that* side is no longer used elsewhere."

- **Weak-keyed map** (Java `WeakHashMap`, Python `WeakKeyDictionary`): the entry is collected when the **key** has no other strong references. Use when the map *annotates* objects: "extra data attached to this key, which should vanish when the key does." Example: caching computed metadata about objects you don't own.

- **Weak-valued map** (Python `WeakValueDictionary`, common via a wrapper in Java): the entry is collected when the **value** has no other strong references. Use for **canonicalizing / interning**: "look objects up by id, but don't keep them alive just because they're in the registry."

A classic trap: putting the **value** in a `WeakHashMap` *keyed by something else* but having the value strongly reference the key — that strong link from value to key keeps the key alive, so the entry never clears. Weak-collection design requires checking that the weak side isn't kept alive through the back door.

## Mental Models

- **"Strength is a max over all paths."** To predict an object's fate, find the *strongest* reference reaching it. Everything weaker is noise until the stronger paths vanish.
- **Soft = "keep until it hurts," Weak = "keep only while convenient," Phantom = "tell me when it's truly dead."**
- **A weak collection is self-pruning, but only as fast as the GC.** Entries don't vanish the instant the referent is unused — they vanish at some GC *after* that, and the slot lingers until the queue is drained.

## Code Examples

**Java — `WeakHashMap` as an annotation map:**
```java
import java.util.WeakHashMap;
import java.util.Map;

// Attach a "render cache" to widgets we do not own.
Map<Widget, RenderData> cache = new WeakHashMap<>();

void render(Widget w) {
    RenderData data = cache.computeIfAbsent(w, Widget::expensiveCompute);
    draw(data);
}
// When a Widget is no longer referenced elsewhere, its cache entry
// is removed automatically at a later GC. No manual eviction needed.
```

**Java — weak reference with a ReferenceQueue:**
```java
import java.lang.ref.*;

ReferenceQueue<Image> queue = new ReferenceQueue<>();
WeakReference<Image> ref = new WeakReference<>(loadImage(), queue);

// Elsewhere, a cleanup loop:
Reference<? extends Image> dead;
while ((dead = queue.poll()) != null) {
    // `dead` was cleared by the GC; dead.get() is now null.
    purgeFromIndex(dead);   // remove the stale bookkeeping
}
```

**Python — `WeakValueDictionary` for interning:**
```python
import weakref

_pool = weakref.WeakValueDictionary()   # id -> object, weakly held

def intern_color(rgb: tuple) -> "Color":
    obj = _pool.get(rgb)
    if obj is None:
        obj = Color(rgb)
        _pool[rgb] = obj        # stored weakly; not kept alive by the pool
    return obj
# Two callers asking for the same rgb get the SAME object — as long as
# someone still holds it. Once all users drop it, it leaves the pool.
```

**JavaScript — `WeakMap` for private/associated data:**
```javascript
const metadata = new WeakMap();   // keys held weakly

function tag(node, info) {
  metadata.set(node, info);       // does not keep `node` alive
}
function read(node) {
  return metadata.get(node);      // undefined if node (and entry) gone
}
// When a DOM node is removed and unreferenced, its metadata entry
// becomes collectible — no manual cleanup, no leak.
```

## Coding Patterns

- **Annotate-don't-own:** use a weak-keyed map to attach data to objects whose lifetime you don't control.
- **Canonicalize-without-pinning:** use a weak-valued map (interning table) so the registry never prolongs lifetimes.
- **Notify-and-purge:** pair weak references with a queue (or `FinalizationRegistry`) to delete stale bookkeeping promptly instead of waiting to stumble on a cleared reference.

## Pros & Cons

**Pros**
- Standard weak collections turn "self-cleaning cache/registry" into a one-liner.
- ReferenceQueues let cleanup be prompt and event-driven instead of polling-by-accident.
- The strength spectrum gives precise control over *how reluctantly* something is kept.

**Cons**
- Choosing the wrong side (key vs value) to weaken silently leaks or silently drops data.
- Queue-draining is your responsibility; forget it and stale slots accumulate (a "logical" leak even though referents are freed).
- Soft references' "under memory pressure" rule is JVM-implementation-defined and unpredictable.

## Use Cases

- **Canonicalizing maps / interning tables** — weak-valued.
- **Per-object metadata / side tables** — weak-keyed.
- **Caches** — soft (Java) or weak depending on whether you want "keep until memory tight" vs "keep only while in active use."
- **Listener registries** — weak references to subscribers, drained via a queue.

## Best Practices

- **Decide key-weak vs value-weak by asking "what should drive eviction?"** If the *annotated object* dying should remove the entry, weaken the key. If the *stored object* being unused should remove it, weaken the value.
- **Drain your ReferenceQueue.** Either run a background thread or piggyback a drain on every map mutation.
- **Don't let the weak side be kept alive through the value/entry.** Audit for accidental strong links (value→key, or the entry object itself referencing the key).
- **Prefer weak over soft for correctness-driven cleanup;** reserve soft for genuine memory-sensitive caches where you tolerate unpredictability.

## Edge Cases & Pitfalls

- **`WeakHashMap` keys with strong values that reference the key.** The value transitively keeps the key alive → the entry never clears. This is the single most common `WeakHashMap` leak.
- **Equality-based weak keys.** `WeakHashMap` uses `equals`/`hashCode`, but identity is what GC tracks. If two distinct objects are `equals`, you may get surprising sharing or premature entry loss.
- **Polling a queue too rarely.** Referents are freed (good) but the map's internal slots and the reference objects themselves pile up until you drain.
- **Assuming a value-weak map keeps your object alive.** It does not — if you stop holding the value, it can vanish from the dictionary between two lookups.

## Summary

The mechanism behind weak references is a **reachability spectrum** — strong, soft, weak, phantom — where the runtime keeps each object according to the *strongest* path that reaches it, and clears weaker references when stronger paths vanish. **ReferenceQueues** turn passive clearing into active notification so you can purge stale bookkeeping. The standard weak collections package this up, but the design choice that matters is **which side to weaken**: weaken the key to annotate objects, weaken the value to canonicalize them. Get that backwards and you leak or lose data — which is exactly the failure mode senior engineers learn to design against.
