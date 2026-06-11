# Double-Checked Locking — Find the Bug

> Twelve broken snippets around Double-Checked Locking and lazy initialization. Each shows the code, what's wrong, the root cause, and the fix. Pair with [junior](junior.md), [middle](middle.md), [senior](senior.md).

## Table of Contents

1. [Bug 1 — Missing volatile](#bug-1)
2. [Bug 2 — Dropped inner check](#bug-2)
3. [Bug 3 — No lock, only volatile](#bug-3)
4. [Bug 4 — volatile on Java 1.4](#bug-4)
5. [Bug 5 — this-escape in constructor](#bug-5)
6. [Bug 6 — Locking on a boxed/changing object](#bug-6)
7. [Bug 7 — Returning the field, not the local](#bug-7)
8. [Bug 8 — final fields instead of volatile](#bug-8)
9. [Bug 9 — Resettable field](#bug-9)
10. [Bug 10 — C++ volatile for threading](#bug-10)
11. [Bug 11 — C++ relaxed publish](#bug-11)
12. [Bug 12 — Non-atomic two-field publish](#bug-12)
13. [Practice Tips](#practice-tips)

---

<a id="bug-1"></a>
## Bug 1 — Missing volatile

```java
private static Singleton instance;            // not volatile
static Singleton get() {
    if (instance == null)
        synchronized (Singleton.class) {
            if (instance == null) instance = new Singleton();
        }
    return instance;
}
```
**What's wrong:** The unlocked first read can observe a partially constructed object.
**Root cause:** No happens-before edge on the racy read; the publish can be reordered before construction.
**Fix:** `private static volatile Singleton instance;`

<a id="bug-2"></a>
## Bug 2 — Dropped inner check

```java
private static volatile Singleton instance;
static Singleton get() {
    if (instance == null)
        synchronized (Singleton.class) {
            instance = new Singleton();   // no second check
        }
    return instance;
}
```
**What's wrong:** Two threads both pass the outer check, enter serially, and **each** constructs — duplicate objects.
**Root cause:** Missing the inner re-check inside the lock.
**Fix:** Re-add `if (instance == null)` inside `synchronized`.

<a id="bug-3"></a>
## Bug 3 — No lock, only volatile

```java
private static volatile Singleton instance;
static Singleton get() {
    if (instance == null) instance = new Singleton(); // no lock at all
    return instance;
}
```
**What's wrong:** Publication is safe, but construction isn't mutually exclusive — two threads can both build.
**Root cause:** `volatile` gives ordering/visibility, **not** mutual exclusion.
**Fix:** Add the `synchronized` block with the inner check (or use the holder idiom).

<a id="bug-4"></a>
## Bug 4 — volatile on Java 1.4

```java
// Target runtime: Java 1.4
private static volatile Singleton instance;   // volatile does NOT fix DCL here
```
**What's wrong:** On the pre-JSR-133 memory model, `volatile` did not prevent reordering the construct with the publish — DCL is unfixable.
**Root cause:** Old JMM `volatile` semantics are too weak.
**Fix:** Don't use DCL on Java <5; use eager init or a `synchronized` accessor.

<a id="bug-5"></a>
## Bug 5 — this-escape in constructor

```java
private static volatile Service instance;
private Service() {
    Registry.register(this);   // publishes `this` before construction finishes
    this.cache = loadCache();
}
```
**What's wrong:** The object escapes via `Registry.register(this)` before its fields are set, so another thread sees a half-built `Service` — independent of DCL.
**Root cause:** `this`-escape during construction; DCL's `volatile` can't protect a reference published *inside* the constructor.
**Fix:** Don't leak `this` from the constructor; register after construction, or use a factory.

<a id="bug-6"></a>
## Bug 6 — Locking on a boxed/changing object

```java
private final Integer lock = 1000;            // cached? maybe shared!
private volatile Index index;
Index get() {
    if (index == null) synchronized (lock) {  // lock identity is fragile
        if (index == null) index = build();
    }
    return index;
}
```
**What's wrong:** Locking on an `Integer` (or any value that may be interned/shared) risks contending with unrelated code on the same monitor.
**Root cause:** Lock object isn't a private, dedicated, stable identity.
**Fix:** `private final Object lock = new Object();`

<a id="bug-7"></a>
## Bug 7 — Returning the field, not the local

```java
private static volatile Singleton instance;
static Singleton get() {
    Singleton local = instance;
    if (local == null) synchronized (Singleton.class) {
        if (instance == null) instance = new Singleton(); // mixes field & local
    }
    return instance;            // returns field, re-reading volatile
}
```
**What's wrong:** Not a correctness bug, but it defeats the local optimization — and mixing `local`/`instance` is error-prone (here the inner check ignores `local`).
**Root cause:** Inconsistent use of the local snapshot.
**Fix:** Read into `local`, re-read `local = instance` inside the lock, assign and `return local`.

<a id="bug-8"></a>
## Bug 8 — final fields instead of volatile

```java
private static Singleton instance;            // not volatile
static class Box { final int x; Box(int v){ x = v; } }
// belief: "the singleton's final fields make DCL safe"
```
**What's wrong:** `final`-field safe publication applies to the *object's* fields when published through a final field or synchronized path — it does **not** make the racy non-volatile `instance` read safe.
**Root cause:** Conflating final-field publication with the DCL field's own publication.
**Fix:** Make `instance` itself `volatile` (or use the holder idiom).

<a id="bug-9"></a>
## Bug 9 — Resettable field

```java
private static volatile Cache cache;
static Cache get() {
    if (cache == null) synchronized (Lock.class) {
        if (cache == null) cache = new Cache();
    }
    return cache;
}
static void clear() { cache = null; }   // can race with get()
```
**What's wrong:** DCL assumes write-once. `clear()` lets the field flip back to `null`, so `get()` may rebuild while another thread is mid-use, and you can leak multiple live `Cache` objects.
**Root cause:** Using a write-once pattern for a mutable lifecycle.
**Fix:** Use proper synchronization for the reset path, or an `AtomicReference` with explicit lifecycle, or don't allow reset.

<a id="bug-10"></a>
## Bug 10 — C++ volatile for threading

```cpp
static Singleton* volatile instance = nullptr;   // C++ volatile ≠ thread ordering
Singleton* get() {
    if (!instance) { std::lock_guard<std::mutex> g(m);
        if (!instance) instance = new Singleton(); }
    return instance;
}
```
**What's wrong:** C++ `volatile` is for memory-mapped I/O; it provides **no** cross-thread ordering or visibility. The publish can still be seen before construction.
**Root cause:** Misusing `volatile` as a memory barrier.
**Fix:** Use `std::atomic<Singleton*>` with acquire/release, or `std::call_once`, or a function-local `static`.

<a id="bug-11"></a>
## Bug 11 — C++ relaxed publish

```cpp
std::atomic<Singleton*> instance{nullptr};
Singleton* get() {
    Singleton* p = instance.load(std::memory_order_relaxed); // relaxed load
    if (!p) { std::lock_guard<std::mutex> g(m);
        p = instance.load(std::memory_order_relaxed);
        if (!p) { p = new Singleton();
            instance.store(p, std::memory_order_relaxed); }  // relaxed store
    }
    return p;
}
```
**What's wrong:** `relaxed` gives atomicity but **no ordering** — the lock-free reader can see the pointer without the constructor's writes.
**Root cause:** Wrong memory order on the publishing store and the fast-path load.
**Fix:** `memory_order_release` on the store, `memory_order_acquire` on the fast-path load (the inner reload may stay relaxed since the mutex orders it).

<a id="bug-12"></a>
## Bug 12 — Non-atomic two-field publish

```java
private volatile boolean ready;   // flag
private Index index;              // data — NOT volatile
Index get() {
    if (!ready) synchronized (this) {
        if (!ready) { index = build(); ready = true; }
    }
    return index;                 // reads non-volatile data
}
```
**What's wrong:** The `volatile` flag publishes `ready`, but `index` is read without any ordering on the fast path; a reader can see `ready == true` yet a stale `index`.
**Root cause:** Wait — actually the `volatile ready` store *does* create a release that covers the prior `index` write, so a reader that sees `ready==true` via a `volatile` read of `ready` would see `index`. The real bug: the **fast-path read of `ready` is fine, but the code returns `index` even when `!ready` is observed false**, and more importantly relies on `ready` ordering while `index` is plain — correct *only* if `ready` is read before `index` with acquire. The fragile design (separate flag + plain data) is easy to break under refactor.
**Root cause (clean statement):** Split publication across a volatile flag and a plain field is correct but brittle; reordering the reads or making `ready` non-volatile breaks it.
**Fix:** Make `index` itself `volatile` and DCL on `index == null` directly — one field, one guarantee — or use the holder idiom.

## Practice Tips

- For each snippet, classify the failure as **atomicity**, **visibility**, **ordering**, or **mutual exclusion** — that vocabulary is the whole game.
- Remember the two-bugs rule: the **inner check** fixes double-creation; **`volatile`/release-acquire** fixes premature publication. Many snippets break exactly one.
- For C++, treat `volatile` as a red flag for threading and `relaxed` as "atomic but unordered."
- When in doubt, replace the whole thing with the **holder idiom** (Java) or a **function-local static / `call_once`** (C++) — most of these bugs simply can't occur there.
- Validate fixes with **jcstress** (Java) on ARM, not with a passing functional test.
