# Finalizers & Destructors — Senior Level

> **Topic:** [Finalizers & Destructors](README.md)
> **Focus:** The design space of object teardown — deterministic destruction vs. non-deterministic finalization — across C++, Rust, Swift, Python, Go, Java, and C#, and the trade-offs each runtime makes.

---

## Table of Contents

- [Introduction](#introduction)
- [Core Concepts](#core-concepts)
  - [The deterministic / non-deterministic split](#the-deterministic--non-deterministic-split)
  - [Destructors: scope-bound teardown](#destructors-scope-bound-teardown)
  - [Finalizers: GC-bound teardown](#finalizers-gc-bound-teardown)
- [Cross-Language Comparison](#cross-language-comparison)
- [Pros & Cons](#pros--cons)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Best Practices](#best-practices)
- [Summary](#summary)

---

## Introduction

Every object that owns a resource — heap memory, a file descriptor, a socket, a mutex, a database connection, a GPU buffer — eventually needs to release it. The language gives you a hook to run code at the end of an object's life. The single most consequential design question is **when** that hook fires, and **whether it fires at all**.

Two answers exist, and they are not interchangeable:

- A **destructor** runs at a *statically known program point* — scope exit, explicit drop, or the end of a `using`/`with` block. The compiler emits the call. It is **deterministic**: you can point at the source line where the resource is released.
- A **finalizer** runs *whenever the garbage collector decides*, possibly long after the object is unreachable, possibly never (e.g. at process exit). It is **non-deterministic**: the timing is a property of the GC's mood, not your code.

Conflating these two is the root of most resource-management bugs in managed languages. This section maps the design space so you can reason about any runtime's teardown model from first principles.

---

## Core Concepts

### The deterministic / non-deterministic split

The split tracks the language's *ownership model*, not its syntax:

| Property | Destructor (deterministic) | Finalizer (non-deterministic) |
|---|---|---|
| Trigger | Scope exit / explicit drop | GC reclaims the object |
| Timing | Statically known, immediate | Unknown; "later or never" |
| Driven by | Compiler-emitted calls / refcount-to-zero | GC reachability analysis |
| Resource fit | Scarce handles (FDs, locks, conns) | Native memory only, as a backstop |
| Examples | C++ `~T()`, Rust `Drop`, Swift `deinit`, C# `Dispose`, Go `defer` | Java `finalize`/`Cleaner`, Go `SetFinalizer`/`AddCleanup`, Python `__del__` |

The litmus test: *if you delete the object's last reference, does the cleanup run before the next statement executes?* Under deterministic destruction (ownership-typed or refcounted), yes. Under a tracing GC, no — the object merely becomes *eligible* for collection.

### Destructors: scope-bound teardown

Deterministic destruction comes in two flavors:

**Ownership-typed / RAII (C++, Rust).** The compiler tracks each value's owning scope and emits the destructor call at the scope's end (or at a `move`/`drop`). No runtime bookkeeping. This is the gold standard: zero-cost, exception-safe, composable.

```rust
struct FileGuard { f: std::fs::File, path: String }

impl Drop for FileGuard {
    fn drop(&mut self) {
        // Runs deterministically at end of scope or on early return/panic.
        let _ = self.f.sync_all();
        eprintln!("closed {}", self.path);
    }
}

fn process() -> std::io::Result<()> {
    let guard = FileGuard { f: std::fs::File::create("/tmp/out")?, path: "/tmp/out".into() };
    write_records(&guard.f)?;   // even if this `?` returns early, `guard` drops.
    Ok(())
}                                // <- drop(guard) emitted here by the compiler
```

Rust adds two important guarantees C++ lacks at the type level:
- **Reverse-declaration drop order** within a scope: the last value declared drops first, so dependencies declared earlier outlive their dependents.
- You **cannot call `drop` explicitly** as a method (`x.drop()` is rejected); you use `std::mem::drop(x)` which *moves* the value so the destructor still runs exactly once. `ManuallyDrop<T>` opts a value *out* of automatic dropping when you need to control teardown manually (e.g. FFI, `union` fields).

**Refcounted (Swift, CPython's primary path).** A reference count reaches zero and the destructor (`deinit` / `__del__`) runs immediately on the thread that dropped the last reference. This *feels* deterministic and usually is — but it is fragile: a reference cycle keeps the count above zero forever, so the destructor never runs (Swift) or runs only via the cycle collector at an unknown time (CPython). Swift's ARC is deterministic *unless you create a strong reference cycle*; that is why `weak`/`unowned` exist.

### Finalizers: GC-bound teardown

A tracing GC does not maintain per-object refcounts, so it cannot know the *instant* an object dies. Instead it discovers death in batches during collection. A finalizer is a callback the GC invokes for objects that registered one, typically on a dedicated thread, after marking them unreachable.

The defining properties — and they are properties, not bugs:

- **No timing guarantee.** Could be milliseconds or hours after the object died; under low allocation pressure the GC may never run.
- **No execution guarantee.** Most runtimes do *not* run pending finalizers at process exit. Resources you intended to flush silently leak.
- **Single-threaded by default.** Java runs all `finalize()` methods on one finalizer thread; one slow finalizer stalls the entire queue.
- **Resurrection.** A finalizer can store `this` into a live data structure, making a "dead" object reachable again — defeating the collection it was part of.
- **Ordering is undefined in cycles.** If A and B reference each other and both have finalizers, the runtime cannot decide which to finalize first, so most don't promise any order.

These are why the entire industry has converged on: *finalizers are a backstop for native memory, never the primary cleanup mechanism for scarce OS resources.*

---

## Cross-Language Comparison

**C++ — `~T()`.** Pure RAII. Deterministic, exception-safe, the model everything else imitates. Caveat: a destructor that throws during stack unwinding calls `std::terminate`; destructors must be `noexcept` in practice. No finalizer concept exists — there is no GC.

**Rust — `Drop`.** RAII with ownership types. Deterministic, panic-safe (drops run during unwind). No finalizers. `Drop::drop` can't be called directly; `mem::drop` moves the value; `ManuallyDrop`/`mem::forget` suppress dropping. Drop order is reverse declaration; struct fields drop in declaration order.

**Swift — `deinit`.** Deterministic *under ARC* — runs the instant the last strong reference goes away. Reference cycles break this; use `weak`/`unowned`. No general finalizer; ARC is the whole model. The closest thing to non-determinism is that an autorelease pool or a cycle defers the `deinit`.

**Python — `__del__` + `with`.** `__del__` runs *promptly* when the refcount hits zero (CPython's dominant case), so it often looks deterministic — but you must not rely on it: PyPy and other implementations use tracing GC with no refcounting, cycles defer it to the cycle collector, and at interpreter shutdown module globals may already be `None`, so `__del__` can crash or be skipped. The deterministic mechanism is the **context manager** (`with`, `__enter__`/`__exit__`).

**Go — `defer` + `runtime.SetFinalizer`/`runtime.AddCleanup`.** `defer` is the deterministic tool: it runs at function return, LIFO, even on panic. `SetFinalizer` is a true GC finalizer with all the hazards (one-GC-cycle delay, not guaranteed at exit, resurrection, undefined order in cycles). Go 1.24 added `runtime.AddCleanup`, a better-designed replacement that allows multiple cleanups per object, doesn't keep the object alive via the cleanup closure, and works on cyclic graphs.

**Java — `finalize()` (deprecated) → `Cleaner`.** `Object.finalize()` was deprecated in Java 9 and removed for new use; it embodies every finalizer hazard. Its replacement is `java.lang.ref.Cleaner`, built on phantom references: you register a *cleanup `Runnable` that must not capture the object* (capturing it would keep it alive forever and defeat the whole mechanism). `Cleaner` is still non-deterministic — it remains a backstop behind `AutoCloseable`/`try-with-resources`.

**C# — `IDisposable` + finalizer.** The canonical *two-tier* design: `Dispose()` is the deterministic path (`using` statement / `using` declaration calls it at scope end), and an optional finalizer (`~T()`) is the GC backstop. The standard `Dispose(bool disposing)` pattern calls `GC.SuppressFinalize(this)` once disposed so the object skips the expensive finalizer queue.

The throughline: **languages with ownership types or refcounting make destruction the default and have no need for finalizers; languages with tracing GC must offer finalizers but treat them as second-class and pair them with an explicit lifecycle interface.**

---

## Pros & Cons

**Deterministic destructors**

- Pros: predictable resource release; no leak window; exception/panic safe; composes (a struct's destructor runs its fields' destructors); zero or near-zero runtime cost.
- Cons: requires a disciplined ownership model; refcounted variants leak on cycles; ties resource lifetime to *lexical* lifetime, which can be awkward for objects with dynamic, graph-shaped lifetimes.

**Non-deterministic finalizers**

- Pros: a true safety net — if a developer forgets to `close()`, native memory is still eventually reclaimed; the only practical way to free memory owned by unmanaged/native code in a GC'd language; requires no caller discipline.
- Cons: no timing or execution guarantee; never safe for scarce handles; resurrection and cycle-ordering hazards; finalizer-thread stalls cascade; swallowed exceptions; measurable GC throughput cost (a finalizable object survives at least one extra GC cycle).

---

## Edge Cases & Pitfalls

- **The finalizer-as-primary anti-pattern.** Releasing a file/socket/lock/DB connection *only* in a finalizer means you exhaust the OS handle table long before the GC feels memory pressure. The pool drains; the heap looks fine. Classic "we ran out of file descriptors but have 4 GB free" incident.
- **Resurrection.** `finalize()`/`__del__` that re-publishes `this` makes the object live again. Java will *not* call `finalize()` a second time, so a resurrected-then-re-collected object never gets its native cleanup. Avoid entirely.
- **Finalizer captures the object (Java `Cleaner`).** If the cleanup `Runnable` closes over the host object, the object is reachable through the cleaner's internal state and *never becomes phantom-reachable*. The cleanup never runs. The state to clean up must be a *separate* object that holds only the raw handle.
- **Cycle ordering.** A↔B both finalizable: no defined order, and in Java prior versions they may be finalized in an order that violates your invariants. Don't put finalizers on both ends of a cycle.
- **Go's one-cycle delay + revival.** A `SetFinalizer` object survives one extra GC; the finalizer can call `SetFinalizer(obj, nil)` and resurrect. Also, the finalizer must not assume the *pointed-to* arena memory is still mapped if you used `unsafe`.
- **Shutdown ordering in Python.** During interpreter teardown, `__del__` may see module-level names rebound to `None`; guard against `AttributeError` or use `try/except` and prefer `with`.
- **Throwing from a destructor (C++).** Throwing during unwinding → `std::terminate`. Destructors must not let exceptions escape.

---

## Best Practices

1. **Make explicit lifecycle the primary mechanism.** `with`/`using`/`defer`/RAII/`Drop` for *every* scarce resource. The finalizer is never the plan-A.
2. **Use the two-tier pattern in GC'd languages.** Public `close()`/`Dispose()` for deterministic release; a finalizer/`Cleaner`/`AddCleanup` backstop that (a) releases native memory and (b) *logs a missed close* so leaks surface in tests and prod.
3. **Make `close()` idempotent and suppress the finalizer once closed** (`GC.SuppressFinalize`, clear the registered cleaner) to avoid double-free and finalizer-queue overhead.
4. **Never put a scarce handle behind a finalizer alone.** FDs, sockets, locks, connections, transactions — deterministic release only.
5. **Keep the cleaner's captured state minimal and detached** from the host object (separate handle-holder struct), especially with Java `Cleaner` and Go `AddCleanup`.
6. **Prefer `Cleaner`/`AddCleanup` over the legacy `finalize`/`SetFinalizer`** where the runtime offers them.

---

## Summary

Destruction and finalization answer the same question — "what runs when this object dies?" — with opposite guarantees. Destructors fire at a known point and are the correct tool for releasing anything scarce. Finalizers fire on the GC's schedule, possibly never, and are correct only as a last-resort safety net for native memory. Every mature runtime reflects this: ownership-typed and refcounted languages lean entirely on deterministic destruction, while tracing-GC languages bolt a deliberately second-class finalizer onto a first-class explicit-lifecycle interface. Design your resource types the same way: explicit close as the contract, finalizer as the alarm that tells you the contract was broken.
