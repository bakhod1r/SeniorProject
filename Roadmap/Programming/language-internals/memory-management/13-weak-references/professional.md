# Weak References — Professional Level

> **Topic:** [Weak References](README.md)
> **Focus:** Shipping weak references in production — preventing lapsed-listener and self-pinning leaks, designing caches/registries that actually evict, and diagnosing reference-related leaks from a heap dump.

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Production Contract of Each Tier](#the-production-contract-of-each-tier)
3. [Caches: Why Soft References Are a Bad Policy](#caches-why-soft-references-are-a-bad-policy)
4. [Registries and the Lapsed-Listener Leak](#registries-and-the-lapsed-listener-leak)
5. [Canonicalizing and Interning Maps in Production](#canonicalizing-and-interning-maps-in-production)
6. [Weak-Keyed vs Weak-Valued and the Self-Pinning Trap](#weak-keyed-vs-weak-valued-and-the-self-pinning-trap)
7. [Cycle Breaking in Trees and Graphs](#cycle-breaking-in-trees-and-graphs)
8. [The Use-After-Check Race, Across Languages](#the-use-after-check-race-across-languages)
9. [Cleanup: ReferenceQueue, Cleaner, AddCleanup, FinalizationRegistry](#cleanup-referencequeue-cleaner-addcleanup-finalizationregistry)
10. [Diagnosing Reference-Related Leaks](#diagnosing-reference-related-leaks)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [War Stories](#war-stories)
14. [Summary](#summary)

---

## Introduction

In production, weak references are not a curiosity — they are the load-bearing mechanism behind self-cleaning caches, leak-free observer registries, off-object metadata tables, and cycle-free graphs. They are also a reliable source of two opposite failure modes: a weak reference that is *too weak* (your data vanishes between two lookups, your cache hit rate collapses to zero) and a weak reference that is *not actually weak* (a back-door strong reference pins the referent, and you have shipped a slow memory leak that only manifests after days of uptime).

This page is about getting weakness *right under load*: choosing the tier whose clearing contract matches the requirement, auditing for the strong link that defeats the weakness, and — when something leaks anyway — reading a heap dump well enough to find the one reference that should have been weak and wasn't.

---

## The Production Contract of Each Tier

Before designing anything, internalize what each tier *promises* and what it *does not*:

| Tier | Promise | Does **not** promise | Production role |
|---|---|---|---|
| **Strong** | Kept alive while reachable | — | the default; the thing you forget to break |
| **Soft** (Java) | Cleared *before* OutOfMemoryError | *when*, *which one*, or any eviction order | memory backstop, never a cache policy |
| **Weak** | Cleared at the next GC once only-weakly-reachable | promptness; bounded staleness | metadata, canonicalization, weak listeners |
| **Phantom** (Java) | Enqueued *after* the referent is unreachable, never returns it | running before the next GC | deterministic-ish native cleanup |

The single most important production fact: **clearing is tied to the GC, not to your code path.** A weak entry can survive long after the referent is logically dead (if no GC runs) and can vanish surprisingly early (if a GC runs mid-request). Both extremes have shipped outages.

---

## Caches: Why Soft References Are a Bad Policy

The most common misuse in real codebases is `Map<K, SoftReference<V>>` sold as "an automatic cache." It is a trap for three reasons:

1. **No eviction order.** A `SoftReference` cache has no notion of LRU, LFU, recency, or frequency. Under pressure the JVM clears soft references in an implementation-defined order (often roughly oldest-first via `SoftRefLRUPolicyMSPerMB`, but you must not rely on it). Your hottest entry can be evicted while cold entries survive.

2. **No size bound.** Soft references keep entries until memory is *tight*, so a soft cache happily fills the heap to near-capacity. The result is a heap that hovers at 90%+, which *increases* GC frequency and pause times — the cache makes the very pressure it claims to relieve.

3. **All-or-nothing clearing.** When pressure hits, the JVM may clear *all* soft references at once to guarantee it can satisfy the allocation. Your cache hit rate drops to 0% in a single GC, then slowly rebuilds — a sawtooth latency profile that looks like a periodic outage.

The correct production pattern is an **explicitly bounded cache** — Caffeine/Guava in Java, an LRU with a size cap elsewhere — that evicts on *your* policy (size, weight, TTL, access recency). Reach for soft references only as a coarse last-resort backstop, and even then prefer a bounded cache with a hard maximum.

```java
// Production cache: bounded, observable, predictable eviction.
Cache<Key, Value> cache = Caffeine.newBuilder()
    .maximumSize(10_000)          // hard bound — heap stays predictable
    .expireAfterAccess(Duration.ofMinutes(10))
    .recordStats()                // hit rate is now a metric, not a mystery
    .build();
```

Weak *values* are a legitimate caching tool, but for a *different* job: a **canonicalization cache** (one shared instance per key) where the entry should disappear precisely when no one else holds the value. That is correctness, not capacity management — see below.

---

## Registries and the Lapsed-Listener Leak

The **lapsed-listener leak** is the canonical observer-pattern leak: a subject keeps a *strong* list of listeners, a listener is registered and the caller forgets (or fails, on an exception path) to deregister it, and the subject now pins that listener — and everything it transitively references — for the subject's entire lifetime. In a long-lived subject (an event bus, a global config object, a singleton service) this is an unbounded leak that grows with churn.

A **weak listener registry** makes the subject hold listeners weakly, so a listener that goes out of scope is *automatically* dropped from the registry. This is correct, but it has a sharp edge that bites in practice:

```java
// LEAK that looks like a fix: the lambda has no other strong referent,
// so the weak registry drops it at the next GC and the callback silently stops firing.
bus.addWeakListener(event -> handler.onEvent(event));
```

If the *only* strong reference to the listener is the registration site, a weak registry collects it almost immediately and the listener silently stops working — a "my callback fired a few times then died" bug. The fix is to keep an explicit strong reference to the listener for as long as you want it alive, and let the weak registry be the *safety net* for the forgotten-deregister case, not the primary lifetime owner:

```java
// Caller owns the listener's lifetime explicitly; the registry is the backstop.
private final EventListener listener = event -> handler.onEvent(event);
bus.addWeakListener(listener);   // listener field keeps it alive; weak ref auto-drops on shutdown
```

For listeners that are *objects with a natural owner* (a view, a controller), the weak registry is exactly right: the listener lives as long as its owner, and dies — and deregisters — when the owner does. This is also why Swift's delegate pattern uses `weak var delegate`: the delegating object must not keep its delegate alive.

---

## Canonicalizing and Interning Maps in Production

A canonicalizing map guarantees *at most one live instance per logical key* — interned strings, a shared parsed schema per schema-id, one `Currency` object per ISO code, one flyweight glyph per codepoint. The requirement is precise: the map must hand out the *same* instance to concurrent callers, but must **not** keep that instance alive once every caller has let it go.

This is a **weak-valued** map, and the subtlety is concurrency. A naive implementation has a use-after-get race: you look up, see a non-null weak value, and between the check and the use the GC clears it. You must capture into a strong local and re-check:

```java
// Concurrent canonicalizing map, get-or-create with the clearing race handled.
final ConcurrentHashMap<String, WeakReference<Schema>> pool = new ConcurrentHashMap<>();

Schema intern(String id) {
    for (;;) {
        WeakReference<Schema> ref = pool.get(id);
        Schema s = (ref != null) ? ref.get() : null;   // capture once into a strong local
        if (s != null) return s;                        // re-strengthened for the caller's use

        Schema fresh = parse(id);
        WeakReference<Schema> freshRef = new WeakReference<>(fresh);
        if (ref == null) {
            if (pool.putIfAbsent(id, freshRef) == null) return fresh;
        } else {
            if (pool.replace(id, ref, freshRef)) return fresh;   // CAS over the dead ref
        }
        // lost the race; loop and re-read
    }
}
```

Python packages this correctly out of the box:

```python
import weakref

_pool: "weakref.WeakValueDictionary[str, Schema]" = weakref.WeakValueDictionary()

def intern(schema_id: str) -> "Schema":
    s = _pool.get(schema_id)        # captured into a strong local — survives until 's' drops
    if s is None:
        s = parse(schema_id)
        _pool[schema_id] = s        # stored weakly; the pool never prolongs lifetime
    return s
```

Note the still-present (smaller) race: under threading, two callers can both miss and both create. For a canonicalizing *cache* that is usually acceptable (the loser's instance is GC'd); for a canonicalizing *identity guarantee* you need a lock or a CAS loop as in the Java version.

Dead slots accumulate: `WeakValueDictionary` and `WeakHashMap` leave the *key* and the (now-cleared) reference object behind until something prunes them. These collections self-prune on access by draining their internal `ReferenceQueue`, but a write-rarely / read-rarely map can hold thousands of dead slots. For a hot canonicalizing map this is fine; for a cold one, periodically touch it.

---

## Weak-Keyed vs Weak-Valued and the Self-Pinning Trap

Two structurally different tools, chosen by asking *"whose death should remove the entry — the key's or the value's?"*

- **Weak-keyed** (`WeakHashMap`, Python `WeakKeyDictionary`): the entry lives while the *key* is strongly reachable elsewhere. This is for **metadata about an object you do not own** — attach render data to a third-party `Widget`, attach a lock to a domain object, attach a parsed form to a request. When the object dies, its metadata dies with it.

- **Weak-valued** (Python `WeakValueDictionary`, hand-built in Java/Go): the entry lives while the *value* is strongly reachable elsewhere. This is for **shared-instance caches / canonicalization**.

The **self-pinning trap** is the most common `WeakHashMap` leak in production: the *value* (or anything the value transitively reaches) holds a **strong reference back to the key**. The weak key is now strongly reachable through its own value, so the entry never clears, and the map grows forever.

```java
// SELF-PINNING LEAK — entry never clears.
Map<Session, SessionStats> stats = new WeakHashMap<>();
class SessionStats {
    final Session owner;          // <-- strong back-reference to the key
    SessionStats(Session s) { this.owner = s; }
}
stats.put(session, new SessionStats(session));   // value pins the weak key forever
```

The fix is to break the back-edge: the value must not strongly reference the key. If the value genuinely needs the key, hold it weakly, derive it on demand, or store an id instead of the object. This bug is invisible in tests (short-lived, few keys) and only manifests as a heap that grows linearly with traffic over days.

---

## Cycle Breaking in Trees and Graphs

Reference-counted systems (Rust `Rc`/`Arc`, Swift ARC, C++ `shared_ptr`, Python's refcounting fast path) cannot reclaim a cycle: `A → B → A` keeps both counts at ≥ 1 forever. (CPython has a backup cycle collector; Rust and Swift do not — a cycle is a hard leak.) The discipline is: **make exactly one edge of every cycle weak**, and orient it consistently.

The canonical orientation in an ownership tree is **parent owns child strongly, child points to parent weakly**:

```rust
use std::cell::RefCell;
use std::rc::{Rc, Weak};

struct Node {
    parent: RefCell<Weak<Node>>,     // up: weak — does NOT keep parent alive
    children: RefCell<Vec<Rc<Node>>>,// down: strong — parent owns children
    value: i32,
}

fn attach(parent: &Rc<Node>, child: &Rc<Node>) {
    *child.parent.borrow_mut() = Rc::downgrade(parent);
    parent.children.borrow_mut().push(Rc::clone(child));
}

fn walk_up(node: &Rc<Node>) -> Option<i32> {
    // upgrade() returns Option — the parent may already be gone.
    node.parent.borrow().upgrade().map(|p| p.value)
}
```

Get the direction backwards (strong up, weak down) and the children evaporate while you still hold the root, because nothing keeps them alive. Swift's `[weak self]` in escaping closures is the same fix applied to closure capture: a stored closure that captures `self` strongly while `self` stores the closure forms a retain cycle, so you write `{ [weak self] in self?.handle() }` and treat `self` as optional inside.

```swift
final class Downloader {
    var onComplete: (() -> Void)?
    func start() {
        // Without [weak self], self -> closure -> self is a retain cycle.
        fetch { [weak self] in
            guard let self else { return }   // captured strongly only for this scope
            self.handleCompletion()
        }
    }
}
```

Use `unowned` instead of `weak` *only* when the captured object is guaranteed to outlive the closure (e.g. a child capturing a parent that owns it). `unowned` skips the optional and the zeroing overhead, but touching it after deallocation is a crash (or UB with `unowned(unsafe)`). When in doubt, `weak` is the safe default.

---

## The Use-After-Check Race, Across Languages

Every language with weak references shares one hazard: **the gap between checking liveness and using the referent.** A weak reference can be cleared concurrently (or by a GC triggered by your own allocation), so `if alive { use() }` is a bug — the object may die between the two statements. The universal fix is **upgrade once into a strong local**, then use the local.

```java
// WRONG: double get() — the second can return null and NPE.
if (ref.get() != null) ref.get().process();

// RIGHT: capture once; the local keeps it alive for the whole block.
Target t = ref.get();
if (t != null) t.process();
```

```rust
// Rust makes this structural: upgrade() yields an owning Rc you must hold.
if let Some(strong) = weak.upgrade() {
    strong.process();   // 'strong' keeps it alive for this scope
}
```

```python
obj = weak_ref()           # call to deref; capture into a strong local
if obj is not None:
    obj.process()
```

JavaScript and Go have the same shape (`const t = ref.deref(); if (t) …`; `if v := wp.Value(); v != nil { … }`). The rule is mechanical and absolute: **never dereference a weak reference twice for the same logical use.**

---

## Cleanup: ReferenceQueue, Cleaner, AddCleanup, FinalizationRegistry

When a referent dies you often need to run cleanup — free a native handle, close a socket, remove a stale index entry. The wrong way is polling `get()` for null; the right way is a **post-mortem notification** mechanism. Each runtime has one, and each carries a non-determinism warning.

- **Java `Cleaner`** (the sanctioned replacement for `finalize()`): register an object with a cleanup `Runnable` that **must not reference the object** (capturing it would keep it alive and the cleaner would never run). Capture only the resource handle.

```java
static final Cleaner cleaner = Cleaner.create();

static final class Handle implements Runnable {
    private final long fd;                 // the raw resource — NOT the owning object
    Handle(long fd) { this.fd = fd; }
    public void run() { nativeClose(fd); } // runs after the owner is unreachable
}

final class NativeBuffer implements AutoCloseable {
    private final Cleaner.Cleanable cleanable;
    NativeBuffer() {
        long fd = nativeOpen();
        this.cleanable = cleaner.register(this, new Handle(fd)); // state must not close over `this`
    }
    public void close() { cleanable.clean(); }   // prompt, deterministic path
}
```

- **Go 1.24 `runtime.AddCleanup`** (replacing the footgun-laden `SetFinalizer`): same rule — the cleanup must not close over the object being cleaned.

```go
type Buffer struct{ ptr unsafe.Pointer }

func NewBuffer() *Buffer {
    b := &Buffer{ptr: cAlloc()}
    // arg must not reference b; capture only the handle.
    runtime.AddCleanup(b, func(p unsafe.Pointer) { cFree(p) }, b.ptr)
    return b
}
```

- **JavaScript `FinalizationRegistry`**: register an object with a held value; the callback *may* run after collection — or may never run (on page unload, or if the engine simply chooses not to). The spec explicitly says cleanup timing is **not** guaranteed. Use it only as an opportunistic backstop, never for correctness.

```javascript
const registry = new FinalizationRegistry((heldValue) => {
  releaseHandle(heldValue);   // best-effort; may never fire — never rely on it
});
registry.register(obj, handleId);
```

The shared discipline across all four: **cleanup state must never strongly reference the object whose death triggers cleanup**, and **cleanup timing is never deterministic** — provide an explicit `close()`/`Drop` path for promptness and treat the post-mortem hook as the safety net.

---

## Diagnosing Reference-Related Leaks

When memory grows over days, weak references are involved in two distinct ways: a weakness that *failed* (something is pinned that you intended to be collectible) or a registry/queue you *forgot to drain*. A repeatable workflow:

1. **Confirm it's a real leak, not soft-cache bloat.** Force a full GC (`jcmd <pid> GC.run`, or `-XX:+DisableExplicitGC` aside) and watch live-set after GC over time. A rising *post-GC* live set is a leak; a rising heap that *drops* fully after GC is just soft/cache headroom.

2. **Take a heap dump** (`jcmd <pid> GC.heap_dump`, `jmap`, or Eclipse MAT's acquire). Open it in MAT.

3. **Run the Leak Suspects report**, then for the suspect object class compute **"merge shortest paths to GC roots, excluding weak/soft references."** This is the key trick: MAT can *exclude weak references from the dominator path*, so the path it shows you is the **strong** chain actually keeping the object alive. If the only path runs through a weak reference, the object is *not* leaked — it will be collected. If a *strong* path survives the exclusion, that path is your bug.

4. **Look for the textbook shapes:** a `WeakHashMap` whose values strong-reference their keys (self-pinning); an event-bus or listener list whose entries are strong (lapsed-listener); a never-drained `ReferenceQueue` / cleaner backlog (the referents are gone but the reference objects and map slots pile up); thread-locals on a pooled thread.

5. **For native/off-heap leaks** (the referent is collected but the OS resource isn't), the symptom is rising RSS / fd count with a flat Java heap — a cleaner/finalizer that never ran because its state accidentally captured the owner.

In other ecosystems the same logic applies with different tools: Python's `objgraph.show_backrefs` / `gc.get_referrers` to find the unexpected strong referrer; Chrome DevTools heap snapshots with the **Retainers** panel (it marks `WeakMap`/`WeakRef` edges so you can see whether the retainer is strong); Go's `pprof` heap profile plus `runtime.ReadMemStats`.

---

## Best Practices

- **Never use `SoftReference` (or weak refs) as a cache eviction policy.** Use a bounded cache (Caffeine/Guava/LRU) with a size/weight/TTL bound and exported hit-rate metrics. Soft refs are a memory backstop at most.
- **Pick weak-keyed vs weak-valued by asking whose death should evict**, then **audit the value for a strong back-reference to the key** (the self-pinning trap).
- **Give weak listeners an explicit strong owner.** The weak registry is the safety net for forgotten deregistration, not the primary lifetime holder — or your callback silently dies.
- **Capture every deref into a strong local once**, then operate on the local. Never `get()` twice for one use.
- **In refcounted systems, weaken exactly one edge per cycle, oriented consistently** (child→parent weak, parent→child strong). Use `unowned`/`[unowned self]` only when the lifetime guarantee is real.
- **Cleanup state must not reference the object being cleaned** (`Cleaner`, `AddCleanup`, `FinalizationRegistry`), and must be paired with an explicit `close()`/`Drop` for promptness.
- **Drain your `ReferenceQueue`** (or rely on the collection's on-access pruning, and periodically touch cold maps).
- **Make weakness observable:** export cache hit rate, map size, and queue depth so a degraded weakness shows up on a dashboard before it pages you.

---

## Edge Cases & Pitfalls

- **The self-pinning weak-keyed map** (value → key strong) — the #1 `WeakHashMap` leak.
- **A weak registry as the sole owner** — listener collected almost immediately, callback silently stops.
- **Soft-cache sawtooth** — all soft refs cleared at once under pressure; hit rate craters then rebuilds.
- **`WeakHashMap` keyed by `equals`/`hashCode`, not identity** — two `equals` objects collide or a mutated key becomes unfindable while still pinning a slot; for identity semantics use an identity-based map.
- **Never-drained queue / cleaner backlog** — referents freed, but reference objects and slots accumulate (a logical leak with a healthy-looking live set until you count the `Reference` instances).
- **Objects that cannot be weakly referenced** — CPython `__slots__` classes without `__weakref__`, some interned primitives; `weakref.ref` raises `TypeError`.
- **JS/JVM clearing during your own allocation** — a deref that was non-null a line ago is null now because your `new` triggered the GC; this is why capture-once is non-negotiable.
- **`unowned` after deallocation** — a crash in Swift; `unowned(unsafe)` is straight UB. Default to `weak`.

---

## War Stories

- **The session map that grew with traffic.** A `WeakHashMap<Session, SessionContext>` was chosen specifically so contexts would die with sessions. The heap grew linearly with login count and OOM'd after ~4 days. Heap dump with weak-references-excluded showed every `Session` still strongly reachable — through its own `SessionContext`, which held `context.session` for "convenience logging." The back-edge pinned every key. Fix: store `sessionId` (a `String`) in the context, not the `Session`. One field, days of uptime recovered.

- **The cache that became a latency spike generator.** A team replaced an unbounded `HashMap` cache with `Map<K, SoftReference<V>>` to "fix" the leak. Under steady load it worked; under a traffic spike the JVM cleared *all* soft references in one GC to satisfy a large allocation, the cache hit rate dropped from 95% to 0%, and the resulting flood of cache-miss backend calls spiked p99 latency 20×. Replaced with a Caffeine cache (`maximumSize`, `recordStats`); hit rate became flat and observable.

- **The Swift screen that leaked a view controller per navigation.** A view controller stored a closure that captured `self` strongly to update its UI on network completion. The closure outlived the navigation; each push/pop leaked one controller and its whole view hierarchy. Instruments' Allocations + Leaks showed the retain cycle. Fix: `{ [weak self] in self?.update() }`. The team then audited every stored closure for strong `self` capture.

- **The JS dashboard that "sometimes" stopped cleaning up.** A long-lived page used a `FinalizationRegistry` to release WebGL contexts when chart objects were collected. It worked in dev, leaked in production on a wall-mounted dashboard left open for weeks — the engine simply never ran the finalization callbacks under that allocation pattern. The fix was an explicit `chart.dispose()` on removal; the registry was demoted to a best-effort backstop, matching the spec's own warning.

---

## Summary

In production, weak references earn their keep by letting *someone other than the holder* decide lifetime — but only when the weakness is real and the tier matches the contract. The recurring failures are symmetric: a soft cache that bloats the heap and clears all at once (use a bounded cache instead); a weak-keyed map whose value pins its key (break the back-edge); a weak registry that is the sole owner of a listener (give it an explicit strong owner); a cycle whose weak edge points the wrong way; a deref checked then reused across a clearing race (capture once). When memory grows anyway, the diagnostic move is a heap dump with **weak/soft references excluded from the root path** — what survives that exclusion is the strong reference that should have been weak. Master that, and weak references become a precise tool rather than a slow leak waiting for a long-running process to expose it.
