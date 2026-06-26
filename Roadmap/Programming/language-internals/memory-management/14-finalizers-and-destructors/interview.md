# Finalizers & Destructors — Interview Questions

> **Topic:** [Finalizers & Destructors](README.md)

Interviewers use this topic to probe whether you understand the difference between *deterministic* destruction and *non-deterministic* finalization — and whether you've been burned by treating a finalizer as a real cleanup mechanism. Strong answers name the timing guarantee precisely, distinguish scarce handles from native memory, and reach for the two-tier (explicit-close + backstop) pattern. The questions below run from definitions to language-specific traps to design.

---

## Table of Contents

- [Conceptual](#conceptual)
- [Tool-Specific](#tool-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What is the fundamental difference between a destructor and a finalizer?**

A **destructor** runs at a statically known program point — scope exit, explicit drop, or end of a `using`/`with` block — and is **deterministic**: you can point at the source line where the resource is released. A **finalizer** runs whenever the garbage collector reclaims the object, which may be long after it died or **never** (most runtimes don't run pending finalizers at process exit). The litmus test: if you drop the last reference, does cleanup run before the next statement? Under deterministic destruction, yes; under a tracing GC, the object only becomes *eligible* for collection.

## Question 2

**Why are finalizers non-deterministic, while reference-counted destruction usually isn't?**

A tracing GC keeps no per-object reference count, so it can't know the *instant* an object dies — it discovers death in batches during collection, on its own schedule. Reference counting decrements a counter on every reference drop and, when it hits zero, runs cleanup *immediately* on that thread. So refcounted teardown (Swift `deinit`, CPython `__del__`) feels deterministic — except it leaks on reference cycles, which keep the count above zero forever.

## Question 3

**Why should scarce OS resources never be released in a finalizer?**

OS handles (file descriptors, sockets, locks, DB connections) are hard-capped and scarce; heap memory is abundant and elastic. A finalizer fires under *memory* pressure, but you exhaust the *handle* limit long before the heap fills. The classic incident is `EMFILE` ("too many open files") with gigabytes of free heap — the GC never felt the need to run, so the finalizers releasing the FDs never fired. Scarce handles must be released deterministically.

## Question 4

**What is the "two-tier" cleanup pattern?**

Tier 1 is the deterministic contract — `close()`/`Dispose()`/`defer`/`with`/RAII — which releases scarce handles at a known point. Tier 2 is a finalizer *backstop* that runs only if Tier 1 was skipped; its narrow job is to free native (off-heap) memory the GC can't see and to **log loudly that a close was missed**. The backstop makes leaks visible and reclaims native memory, but it is never the primary mechanism. C#'s `IDisposable` + `~T()` and Java's `AutoCloseable` + `Cleaner` are this pattern.

---

## Tool-Specific

## Question 5

**How does Rust's `Drop` differ from a finalizer, and can you call `drop` directly?**

`Drop::drop` is a deterministic destructor: the compiler emits the call at scope exit, early return, or panic-unwind — no GC involved. You **cannot** call `x.drop()` directly (the compiler rejects it to prevent a double-drop). To drop early you call `std::mem::drop(x)`, which *moves* `x` so its destructor runs exactly once. `ManuallyDrop<T>` opts a value out of automatic dropping; `std::mem::forget` suppresses it entirely. Drop order within a scope is **reverse of declaration**.

## Question 6

**Why was Java's `Object.finalize()` deprecated, and what replaced it?**

`finalize()` has no timing or execution guarantee, runs on a single finalizer thread (one slow finalizer stalls the whole queue and can OOM the heap by retaining queued objects), allows resurrection, swallows exceptions, and costs an extra GC cycle. It was deprecated in Java 9. The replacement is `java.lang.ref.Cleaner`, built on phantom references — you register a cleanup `Runnable` that **must not capture the host object**, and it still sits behind `AutoCloseable`/try-with-resources as a backstop.

## Question 7

**Compare Go's `runtime.SetFinalizer` with `runtime.AddCleanup` (Go 1.24).**

`SetFinalizer` registers one finalizer per object; the object survives at least one extra GC cycle, the finalizer can resurrect it, only one is allowed, and ordering is undefined in cycles. `runtime.AddCleanup` (Go 1.24) is the better-designed replacement: multiple cleanups per object, the cleanup argument is a value that **doesn't keep the object alive** (it can't accidentally resurrect), and it works correctly on cyclic object graphs. For deterministic release you still use `defer` — both are Tier-2 backstops only.

## Question 8

**In Python, when does `__del__` run, and why shouldn't you rely on it?**

In CPython, `__del__` usually runs *promptly* when the reference count hits zero — so it looks deterministic. But you can't rely on it: reference cycles defer it to the cycle collector at an unknown time; non-refcounting implementations (PyPy) use tracing GC; and at interpreter shutdown module globals may already be `None`, so `__del__` can raise or be skipped. The deterministic tool is the context manager — `with` / `__enter__` / `__exit__`.

## Question 9

**Is Swift's `deinit` deterministic?**

Yes — under ARC, `deinit` runs the instant the last strong reference is released, on the thread that released it. The exception is **reference cycles**: two objects with mutual strong references keep each other's count above zero forever, so neither `deinit` ever runs. That's why Swift has `weak` and `unowned` references — to break cycles and restore deterministic teardown.

## Question 10

**What does the C# `Dispose(bool disposing)` pattern do, and why `GC.SuppressFinalize`?**

It's the canonical two-tier implementation. `Dispose()` (Tier 1, called by `using`) passes `disposing: true` to release both managed and unmanaged resources; the finalizer `~T()` (Tier 2) passes `false` to release only unmanaged ones. `Dispose()` then calls `GC.SuppressFinalize(this)` so that, since cleanup already happened deterministically, the object skips the expensive finalizer queue and is collected in a single GC pass.

---

## Tricky / Trap

## Question 11

**What is finalizer resurrection, and why is it dangerous?**

Resurrection is when a finalizer stores `this` into a live data structure, making a "dead" object reachable again and defeating the collection. It's dangerous because the cleanup has already half-run, and the runtime typically **won't finalize the object a second time** (Java) — so when it dies again, its native cleanup never happens. In Go it can cause double-free if combined with an explicit close. Never publish `this` from a finalizer.

## Question 12

**A Java `Cleaner` is registered but its cleanup never runs. What's the most likely bug?**

The cleanup `Runnable` (or lambda) **captures the host object** — typically by closing over it to reach its handle. That keeps the object reachable through the `Cleaner`'s internal state, so it never becomes phantom-reachable and the cleanup never fires. The fix: make the cleanup state a `static` nested class that holds only the raw handle, with no reference back to the host instance.

## Question 13

**Two objects A and B reference each other and both have finalizers. What happens?**

Cycle finalization ordering is **undefined** — the runtime can't decide which to finalize first without risking that one finalizer touches an already-finalized peer, so most runtimes promise no order (and historically could finalize in an order that violates your invariants). The lesson: don't put finalizers on both ends of a cycle. In refcounted languages (Python/Swift) the cycle may prevent the destructor from running at all until the cycle collector intervenes.

## Question 14

**Can a destructor safely throw an exception?**

In C++, a destructor that lets an exception escape **during stack unwinding** calls `std::terminate` — so destructors must be `noexcept` in practice. In Rust, a `panic` inside `Drop` while already unwinding aborts the process. The general rule across languages: teardown code must not propagate exceptions; catch, log, and continue. Finalizers that throw have their exceptions silently swallowed (Java) or crash at shutdown (Python), which hides bugs.

---

## Design

## Question 15

**Design the resource-cleanup strategy for a class wrapping a native (off-heap) buffer plus a file descriptor, in a GC'd language.**

Use the two-tier pattern. **Tier 1:** implement `AutoCloseable`/`IDisposable`/`__exit__`/a `Close()` method that closes the FD *and* frees the native buffer; make it idempotent (guard flag), and have callers use `try-with-resources`/`using`/`with`/`defer`. The FD must be Tier 1 — it's a scarce handle. **Tier 2:** register a finalizer/`Cleaner`/`AddCleanup` whose detached state holds only the raw handle/pointer; it frees the native buffer and logs a missed close. After explicit close, suppress the finalizer (`GC.SuppressFinalize` / clear the registration). Treat any backstop firing as a defect surfaced in CI.

## Question 16

**Your service intermittently runs out of database connections, but heap and GC look healthy. How do you diagnose and fix it?**

Symptom pattern — scarce-handle exhaustion with healthy memory — points straight at connections being released only on finalization rather than deterministically. Diagnose by checking whether the connection wrapper closes in a finalizer/`__del__`/`Cleaner` instead of an explicit `close`/`defer`/`using`, and confirm pool checkouts aren't returned promptly. Fix: move connection return to a deterministic path (`defer conn.Close()`, `using`, `try-with-resources`, context manager), keep the finalizer only as a logging backstop, and add a test/alert that fails when the backstop fires. Never tie a pooled connection's lifetime to GC timing.
