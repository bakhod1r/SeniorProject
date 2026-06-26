# Finalizers & Destructors — Hands-On Tasks

> **Topic:** [Finalizers & Destructors](README.md)

These tasks build muscle memory for the one distinction that matters: **deterministic destruction** (you choose when) vs. **non-deterministic finalization** (the GC chooses, or never). You'll observe finalizer timing empirically, build the two-tier explicit-close + backstop pattern in several runtimes, and trigger the classic failure modes on purpose so you recognize them in production. Pick the languages you work in; the patterns transfer.

---

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Observe destructor timing vs. finalizer timing

Write the same "Resource" type twice in one GC'd language (Go, Java, or Python): once releasing in a deterministic path (`defer` / try-with-resources / `with`), once releasing only in a finalizer (`SetFinalizer` / `Cleaner` / `__del__`). Print a timestamped line on construction and on cleanup. Allocate 100 instances in a loop, drop the references, and *don't* force a GC.

**Self-check:**

- [ ] The deterministic version prints cleanup interleaved with the loop, at known points.
- [ ] The finalizer version prints cleanup late, in a burst, or not at all before the program ends.
- [ ] I can articulate why the timestamps differ.

<details><summary>Hint</summary>

In Go, register with `runtime.SetFinalizer` or `runtime.AddCleanup`; in Python use `__del__`; in Java use `Cleaner`. Run the finalizer version without calling `runtime.GC()` / `System.gc()` and watch how many cleanups happen before exit.

</details>

### Task 2 — Prove a finalizer may never run at process exit

Take the finalizer-only version from Task 1, allocate a handful of instances, and let `main` return *without* forcing a collection. Count how many finalizers actually ran.

**Self-check:**

- [ ] At least some finalizers did not run before exit.
- [ ] I understand why "flush my buffer in the finalizer" is unsafe.

<details><summary>Hint</summary>

Most runtimes do not run pending finalizers on a normal exit. This is the empirical reason flushing/closing in a finalizer loses data.

</details>

### Task 3 — Demonstrate Rust's reverse drop order

In Rust, declare three guard structs (each printing its name in `Drop::drop`) in a single scope: `a`, `b`, `c`. Run and observe the order.

**Self-check:**

- [ ] Output is `c`, `b`, `a` — reverse of declaration.
- [ ] I tried `a.drop()` and saw the compiler reject it, then used `std::mem::drop(a)` instead.

<details><summary>Solution sketch</summary>

```rust
struct G(&'static str);
impl Drop for G { fn drop(&mut self) { println!("drop {}", self.0); } }
fn main() {
    let _a = G("a"); let _b = G("b"); let _c = G("c");
} // prints: drop c, drop b, drop a
```

`_a.drop()` → `error: explicit use of destructor method`. Use `std::mem::drop(_a)` to drop early (it moves the value).

</details>

---

## Core

### Task 4 — Implement the two-tier pattern (your main language)

Build a `NativeBuffer` type that allocates off-heap/native memory plus owns a file descriptor. Provide:
- **Tier 1:** an idempotent `close()`/`Dispose()`/`__exit__` that releases both, usable via `defer`/`using`/`with`/try-with-resources.
- **Tier 2:** a finalizer backstop that frees *native memory* and logs `WARNING: closed via backstop — missed explicit close`.

After an explicit close, ensure the backstop is suppressed (so it doesn't double-free or re-log).

**Self-check:**

- [ ] Closing twice is safe (idempotent guard).
- [ ] When I use the deterministic path, the backstop log never appears.
- [ ] When I "forget" to close, the backstop log *does* appear.
- [ ] The backstop frees native memory but never touches the FD as its primary job.

<details><summary>Hint</summary>

Java: `static` `State implements Runnable` + `Cleaner.register(this, state)`, call `cleanable.clean()` in `close()`. Go: `runtime.AddCleanup(b, fn, rawPtr)` + an `atomic.Bool` guard in `Close()`. C#: `Dispose(bool)` + `~T()` + `GC.SuppressFinalize(this)`.

</details>

### Task 5 — Break the backstop by capturing the host object

Take your Task 4 type and *deliberately* make the finalizer/cleaner capture the whole host object (close over `this`/`self`/`b`). Allocate, drop the reference, force GC, and check whether the backstop ever runs.

**Self-check:**

- [ ] The backstop never fires — the object is kept alive by the cleaner.
- [ ] I can explain why capturing the host defeats phantom-reachability (Java) / keeps the object live (Go).
- [ ] I reverted to detached state (raw handle only).

<details><summary>Hint</summary>

This is the #1 `Cleaner` bug. The cleanup state must hold only the raw handle/pointer, never a reference back to the watched object.

</details>

### Task 6 — Exhaust file descriptors with finalizer-only cleanup

Write a loop that opens a file, wraps it in an object that closes the FD **only in a finalizer**, and drops the reference each iteration — *without* forcing GC. Run until it fails.

**Self-check:**

- [ ] You hit `EMFILE` / "too many open files" (or the platform equivalent) with plenty of free heap.
- [ ] Adding deterministic `close`/`defer`/`with` fixes it immediately.
- [ ] I can explain why memory abundance masks handle scarcity.

<details><summary>Hint</summary>

Lower your FD limit first (`ulimit -n 64`) so the failure arrives quickly. This reproduces the canonical production incident.

</details>

### Task 7 — Context manager vs. `__del__` (Python) or `defer` vs. `SetFinalizer` (Go)

Implement a resource both ways and write a test that asserts cleanup happens at a *deterministic* point for the explicit path, and is *not* guaranteed for the finalizer path.

**Self-check:**

- [ ] The `with`/`defer` test asserts cleanup ran before the next statement.
- [ ] The finalizer test cannot make that assertion without forcing a GC.

---

## Advanced

### Task 8 — Reproduce finalizer resurrection and its consequence

In Go (`SetFinalizer`) or Java (`finalize`, on an old JDK target), write a finalizer that stores `this` into a global list (resurrection). Observe that the object survives, then drop it again.

**Self-check:**

- [ ] The object is resurrected the first time.
- [ ] On the second death, the native cleanup does **not** run (Java won't re-finalize; or you get a double-free risk in Go).
- [ ] I understand why resurrection is banned in correct code.

<details><summary>Hint</summary>

Combine resurrection with an explicit `Close()` to see the double-free / use-after-free hazard in Go.

</details>

### Task 9 — Stall the single finalizer thread (Java)

Write a class whose `finalize()` (or `Cleaner` action) sleeps for, say, 50 ms (simulating I/O). Allocate thousands rapidly and watch the finalizer queue back up and the heap grow.

**Self-check:**

- [ ] Heap grows because queued finalizable objects retain everything they reference.
- [ ] Removing the sleep / making cleanup O(1) fixes it.
- [ ] I can explain how a *finalizer-throughput* problem becomes a *memory* leak.

<details><summary>Hint</summary>

Monitor the heap and the finalizer queue. The lesson: finalizers must be O(1) and do no blocking I/O.

</details>

### Task 10 — Migrate `SetFinalizer` → `AddCleanup` (Go 1.24) or `finalize` → `Cleaner` (Java)

Take a legacy finalizer-based type and migrate it to the modern API. Verify the cleanup still frees native memory, the object is no longer artificially kept alive, and the migration works on a cyclic object graph.

**Self-check:**

- [ ] Cleanup argument holds no reference to the watched object.
- [ ] The cyclic-graph case that the old API mishandled now works.
- [ ] Explicit close still suppresses the backstop.

---

## Capstone

### Task 11 — A leak-detecting connection pool

Build a small connection-pool wrapper in a GC'd language where each checked-out connection:
1. Returns to the pool deterministically via `close()`/`defer`/`using`/`with` (Tier 1).
2. Has a finalizer/cleaner backstop (Tier 2) that, if a connection is GC'd while still checked out, **returns it to the pool and logs a leak with the checkout stack trace**.
3. Exposes a metric/counter incremented whenever the backstop fires.

Then write two tests: one well-behaved (backstop counter stays 0), one that "forgets" to close (backstop counter goes up, leak is logged with the originating call site).

**Self-check:**

- [ ] Well-behaved path: zero backstop firings, connections returned at known points.
- [ ] Forgotten-close path: backstop returns the connection *and* logs the leak with a stack trace.
- [ ] Double-close is safe (idempotent).
- [ ] The backstop's captured state does not reference the connection object.
- [ ] A CI assertion fails if the backstop counter is non-zero after the well-behaved test.

<details><summary>Hint</summary>

Capture the checkout stack trace at acquire time into the *detached* cleanup state, so the leak log can point at the offending call site. This is exactly how production pools (e.g. HikariCP's leak detection) surface forgotten closes.

</details>

---

## Self-Assessment

You're done when you can, without notes:

- [ ] State the destructor-vs-finalizer distinction in one sentence (known point vs. GC's schedule / maybe never).
- [ ] Explain why scarce handles (FDs, locks, connections) must be Tier 1 and native memory may be Tier 2.
- [ ] Implement the two-tier pattern correctly in at least one runtime, with an idempotent close and a *detached* backstop.
- [ ] Name and reproduce three finalizer hazards: never-runs-at-exit, captured-host defeats the cleaner, single-thread stall / resurrection.
- [ ] Justify why `Drop::drop` can't be called directly and what `mem::drop` / `ManuallyDrop` do.
- [ ] Diagnose a "handles exhausted, heap healthy" incident and prescribe the deterministic-close fix.
