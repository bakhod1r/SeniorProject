# Double-Checked Locking — Tasks

> Hands-on tasks to internalize Double-Checked Locking, the memory-model bug, the `volatile` fix, and the idioms that replace it. Pair with [junior](junior.md) and [middle](middle.md).

## Table of Contents

1. [Task 1 — Naive DCL and Name the Bug](#task-1)
2. [Task 2 — Correct volatile DCL](#task-2)
3. [Task 3 — Initialization-on-Demand Holder](#task-3)
4. [Task 4 — Enum Singleton](#task-4)
5. [Task 5 — Lazy Instance Field (legit DCL)](#task-5)
6. [Task 6 — Write the Breaking Interleaving](#task-6)
7. [Task 7 — Fast-Path Local Optimization](#task-7)
8. [Task 8 — C++11 call_once and Magic Static](#task-8)
9. [Task 9 — C++11 Atomic Acquire/Release DCL](#task-9)
10. [Task 10 — jcstress Publication Test](#task-10)
11. [How to Practice](#how-to-practice)

---

<a id="task-1"></a>
## Task 1 — Naive DCL and Name the Bug

**Goal:** Write the classic broken DCL and articulate precisely why it's wrong.

**Requirements:** A `static` singleton accessor using DCL with a **non-`volatile`** field. In a comment, name the three sub-operations of `new X()` and which reordering causes the bug.

**Hints:** allocate → construct → publish; the publish can move before construct.

**Solution sketch:**
```java
class Broken {
    private static Broken instance;            // ❌ not volatile
    static Broken get() {
        if (instance == null)
            synchronized (Broken.class) {
                if (instance == null) instance = new Broken(); // publish may precede construct
            }
        return instance;
    }
}
// Bug: a lock-free reader can see a non-null, partially constructed object.
```

<a id="task-2"></a>
## Task 2 — Correct volatile DCL

**Goal:** Fix Task 1 minimally.

**Requirements:** Add `volatile`; keep both checks. State the two guarantees `volatile` gives.

**Solution sketch:**
```java
private static volatile Broken instance; // fix: release on store, acquire on load
```
Guarantees: (1) constructor writes can't be reordered after the publish; (2) a reader seeing the reference also sees the constructed object (happens-before).

<a id="task-3"></a>
## Task 3 — Initialization-on-Demand Holder

**Goal:** Replace DCL with the idiom you should usually prefer.

**Requirements:** Private nested static holder, lazy, no `volatile`, no explicit lock.

**Solution sketch:**
```java
class Config {
    private Config() {}
    private static class H { static final Config I = new Config(); }
    static Config get() { return H.I; }
}
```
Why it's safe: class initialization runs once under the JVM's internal lock; `H` loads only on first `get()`.

<a id="task-4"></a>
## Task 4 — Enum Singleton

**Goal:** Implement the most robust singleton.

**Requirements:** Single-constant enum with a method; note its serialization/reflection resistance and its one downside (eager, can't extend a class).

**Solution sketch:**
```java
enum Config { INSTANCE; void reload() { /* ... */ } }
```

<a id="task-5"></a>
## Task 5 — Lazy Instance Field (legit DCL)

**Goal:** Use DCL where the holder idiom can't — an instance field.

**Requirements:** A `volatile` instance field, a private lock object, expensive `build()`, hot-path read.

**Solution sketch:**
```java
private final Object lock = new Object();
private volatile Index index;
Index index() {
    Index l = index;
    if (l == null) synchronized (lock) {
        l = index;
        if (l == null) index = l = build();
    }
    return l;
}
```

<a id="task-6"></a>
## Task 6 — Write the Breaking Interleaving

**Goal:** Make the bug concrete.

**Requirements:** A step-by-step two-thread trace where Thread B observes a half-built object from a non-volatile DCL.

**Solution sketch:**
```text
A: allocate
A: publish reference (reordered before construct)
B: first check → non-null → return
B: read field → default/garbage 💥
A: run constructor (too late)
```

<a id="task-7"></a>
## Task 7 — Fast-Path Local Optimization

**Goal:** Trim a volatile read off the hot path.

**Requirements:** Read the volatile field into a local once, test the local, return the local.

**Hint:** Without it you do two volatile reads on the fast path (the check and the return).

<a id="task-8"></a>
## Task 8 — C++11 call_once and Magic Static

**Goal:** Implement the idiomatic C++ lazy singletons.

**Solution sketch:**
```cpp
// once_flag
static Singleton& A() {
    static std::once_flag f; static Singleton* p;
    std::call_once(f, []{ p = new Singleton(); });
    return *p;
}
// magic static (preferred)
static Singleton& B() { static Singleton s; return s; }
```

<a id="task-9"></a>
## Task 9 — C++11 Atomic Acquire/Release DCL

**Goal:** Hand-roll a *well-defined* C++ DCL.

**Requirements:** `std::atomic<T*>` with `memory_order_acquire` load and `memory_order_release` store; mutex + relaxed reload inside the lock.

**Solution sketch:**
```cpp
T* p = inst.load(std::memory_order_acquire);
if (!p) { std::lock_guard<std::mutex> g(m);
    p = inst.load(std::memory_order_relaxed);
    if (!p) { p = new T(); inst.store(p, std::memory_order_release); } }
return p;
```

<a id="task-10"></a>
## Task 10 — jcstress Publication Test

**Goal:** Validate publication the only way that works.

**Requirements:** A jcstress `@JCStressTest` where one actor builds-and-publishes via DCL and another reads a field that must never be observed as its default value; mark the default-value outcome as `FORBIDDEN`. Run on ARM if available.

**Hint:** With a non-volatile field the harness should report the forbidden outcome on weak hardware; with `volatile` it never does.

## How to Practice

- Do Tasks 1→2→6 as a unit: write broken, fix, then prove the break with a trace. That cements *why* `volatile` is needed.
- Do Tasks 3 and 4 to build the reflex of reaching for the **holder/enum** before DCL.
- Benchmark Task 2 vs Task 3 with JMH on steady-state reads — observe how close they are.
- For C++, compare Tasks 8 and 9; prefer the magic static unless you specifically need the atomic form.
- Run Task 10 on an ARM machine or CI runner; seeing the forbidden outcome appear (and then vanish after adding `volatile`) is the lesson.
