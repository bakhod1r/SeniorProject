# Double-Checked Locking — Optimize

> Ten before/after walkthroughs that turn correct-but-suboptimal lazy-initialization code into cleaner, faster, or safer forms. Pair with [middle](middle.md), [senior](senior.md), [professional](professional.md).

## Table of Contents

1. [Lock-on-every-access → DCL](#opt-1)
2. [Two volatile reads → one local](#opt-2)
3. [DCL on a static → holder idiom](#opt-3)
4. [Hand-rolled singleton → enum](#opt-4)
5. [Volatile read on hot path → eager final](#opt-5)
6. [Lock on `this` → private lock object](#opt-6)
7. [Broken DCL → VarHandle acquire/release](#opt-7)
8. [C++ mutex-every-call → call_once](#opt-8)
9. [C++ call_once → magic static](#opt-9)
10. [Split flag+data → single volatile field](#opt-10)
11. [Optimization Tips](#optimization-tips)

---

<a id="opt-1"></a>
## 1. Lock-on-every-access → DCL

**Before**
```java
static synchronized Conn get() { if (c == null) c = new Conn(); return c; }
```
**Problem:** Every read acquires the monitor, forever, though init happens once.
**After**
```java
private static volatile Conn c;
static Conn get() {
    Conn l = c;
    if (l == null) synchronized (Conn.class) { l = c; if (l == null) c = l = new Conn(); }
    return l;
}
```
**Why:** Removes the lock from the post-init fast path; only the one-time build is synchronized.
**Trade-off:** Adds the famous correctness burden (`volatile`, two checks). Often the holder idiom (Opt 3) is a better target.

<a id="opt-2"></a>
## 2. Two volatile reads → one local

**Before**
```java
if (instance == null) { ... }
return instance;          // second volatile read on the fast path
```
**Problem:** The hot path reads the volatile field twice (check + return), each an acquire load.
**After**
```java
Singleton l = instance;   // one volatile read
if (l == null) { ... l = instance; ... }
return l;
```
**Why:** Halves volatile reads on the common path; on weak ISAs that's a real fence saved.
**Trade-off:** None meaningful; standard idiom. Keep the local consistent inside the lock too.

<a id="opt-3"></a>
## 3. DCL on a static → holder idiom

**Before:** A correct `volatile` DCL guarding a *static* singleton.
**After**
```java
private static class H { static final Singleton I = new Singleton(); }
static Singleton get() { return H.I; }
```
**Why:** Lazy + thread-safe by the JLS, **no `volatile`**, and the fast path is a **plain read** (no acquire fence) — strictly cheaper than DCL.
**Trade-off:** Statics only; can't be used for instance fields.

<a id="opt-4"></a>
## 4. Hand-rolled singleton → enum

**Before:** DCL or holder singleton needing serialization/reflection hardening.
**After**
```java
enum Singleton { INSTANCE; }
```
**Why:** JVM guarantees single, thread-safe init; immune to reflection and serialization duplication.
**Trade-off:** Eager at class-load; can't extend a class.

<a id="opt-5"></a>
## 5. Volatile read on hot path → eager final

**Before:** `volatile` DCL where construction is actually cheap.
**After**
```java
private static final Singleton INSTANCE = new Singleton(); // plain read, no fence
```
**Why:** If laziness buys nothing, eager `static final` is trivially correct and the fast path is a plain read.
**Trade-off:** Loses laziness — only valid when early construction is acceptable.

<a id="opt-6"></a>
## 6. Lock on `this` → private lock object

**Before**
```java
synchronized (this) { ... }   // external code can contend on your monitor
```
**After**
```java
private final Object lock = new Object();
synchronized (lock) { ... }
```
**Why:** Encapsulates the monitor so unrelated `synchronized(yourObject)` elsewhere can't deadlock or contend with your init.
**Trade-off:** One extra field; negligible.

<a id="opt-7"></a>
## 7. Broken DCL → VarHandle acquire/release

**Before:** Non-volatile DCL (broken) where you want explicit, documented ordering.
**After**
```java
T l = (T) VH.getAcquire(this);
if (l == null) synchronized (lock) {
    l = (T) VH.getAcquire(this);
    if (l == null) { l = build(); VH.setRelease(this, l); }
}
return l;
```
**Why:** Expresses *exactly* the needed acquire/release ordering; correct on all ISAs.
**Trade-off:** More verbose than `volatile`, which the JIT compiles to the same fences — prefer plain `volatile` unless you specifically need explicit modes.

<a id="opt-8"></a>
## 8. C++ mutex-every-call → call_once

**Before**
```cpp
Singleton& get() { std::lock_guard<std::mutex> g(m); static Singleton* p; if(!p) p=new Singleton(); return *p; }
```
**Problem:** Locks the mutex on every call.
**After**
```cpp
Singleton& get() { std::call_once(flag, []{ p = new Singleton(); }); return *p; }
```
**Why:** `call_once` runs the init once with correct publication and a cheap fast path after.
**Trade-off:** Still slightly heavier than a magic static (Opt 9).

<a id="opt-9"></a>
## 9. C++ call_once → magic static

**Before:** `std::call_once` + `once_flag` + pointer.
**After**
```cpp
Singleton& get() { static Singleton s; return s; } // thread-safe since C++11
```
**Why:** The compiler emits a fast already-initialized check (an internal DCL) and handles ordering; simplest correct form, no manual flag/pointer, no heap leak.
**Trade-off:** Init order across translation units is less explicit than `call_once`; fine for most cases.

<a id="opt-10"></a>
## 10. Split flag+data → single volatile field

**Before**
```java
private volatile boolean ready;
private Index index;            // plain
```
**Problem:** Correctness depends on read-ordering between two fields; brittle under refactor.
**After**
```java
private volatile Index index;  // DCL on index == null directly
```
**Why:** One field, one happens-before guarantee — fewer moving parts, harder to break.
**Trade-off:** None; this is strictly simpler and safer.

## Optimization Tips

- The biggest "optimization" is usually **replacing DCL with the holder idiom** — it's simpler *and* has a plain-read fast path. Measure before assuming DCL is faster.
- On the hot path, a **plain read beats a volatile read** on weak ISAs; prefer designs (holder, eager final) whose steady state is a plain read.
- Always snapshot the volatile field into a **local** to avoid a second acquire load.
- Don't optimize laziness you don't need — **eager final** is the cheapest correct thing when early init is acceptable.
- Benchmark steady-state reads with **JMH / Google Benchmark**, on the **target ISA**, with the result blackholed — naive loops mislead.
- In C++, prefer **magic static**; reach for atomics-DCL only when you must, and never use `volatile` for threading.
