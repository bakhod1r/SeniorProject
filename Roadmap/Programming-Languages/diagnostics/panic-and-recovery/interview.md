# Panic & Recovery — Interview Questions

> **Topic:** [Panic & Recovery Roadmap](README.md)
> **Focus:** Questions an interviewer can actually ask about panic vs error vs exception, `defer`/`recover`, Rust `panic!`/`catch_unwind`/`panic=abort`, recover-at-the-boundary, fail-fast vs resilience, unwinding, supervision, and poisoned locks.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Conceptual / Foundational](#conceptual--foundational)
3. [Language-Specific](#language-specific)
4. [Tricky / Trap Questions](#tricky--trap-questions)
5. [System / Design Scenarios](#system--design-scenarios)
6. [Live Coding / Whiteboard](#live-coding--whiteboard)
7. [Behavioral / Experience](#behavioral--experience)
8. [What I'd Ask a Candidate Now](#what-id-ask-a-candidate-now)
9. [Cheat Sheet](#cheat-sheet)
10. [Further Reading](#further-reading)
11. [Related Topics](#related-topics)

---

## Introduction

Panic-and-recovery interviews probe one thing above all: **do you know when a program should die and when it should keep running?** The junior answer is a binary — "errors you handle, panics you let crash." The senior answer is a system: a two-layer model (recoverable failures vs programmer bugs), a single legitimate recovery point (the boundary), and a clear-eyed view of the trade-off between availability and correctness. The staff answer adds the runtime mechanics — unwinding vs abort, stack growth, signal-safety, poisoned locks, supervision trees — and the judgement to say "this service should crash" out loud in a design review and defend it.

This file is the question bank, graduated junior → staff. Each question gets a crisp model answer plus what-if/follow-up probes, because in a real interview the follow-up is where candidates separate. The trap section explains *why* the obvious instinct is wrong — defensive recovery, swallowed panics, and "but the server stayed up" are the expensive instincts. The design section is where senior and staff candidates earn their level: given a service, they decide whether it recovers or crashes, and they can justify the blast radius either way.

A note on vocabulary. Languages disagree: Go has `panic`/`recover`, Rust has `panic!`/`catch_unwind`, Java/Python/JS have exceptions with no hard panic/error split. A strong candidate maps the *concept* (unrecoverable programmer-bug failure vs recoverable expected failure) across all of them rather than reciting one language's keywords.

---

## Conceptual / Foundational

### Q: What's the difference between a panic and an error? (junior)

An **error** is an *expected, recoverable* failure that the calling code is supposed to handle — a file not found, a network timeout, invalid user input. It's a value: Go's `error`, Rust's `Result::Err`, a checked exception. The contract says "this can fail; deal with it."

A **panic** is an *unexpected, unrecoverable* condition that means a bug or a broken invariant — a nil dereference, an out-of-bounds index, "this should never happen." It's not a value you thread through your API; it unwinds the stack looking for the edge of the world.

The mental model is two layers. **Layer 1 (errors)** is the normal control flow of failure: predictable, handled locally, part of the function signature. **Layer 2 (panics)** is the "something is fundamentally wrong" channel: it bypasses normal flow and heads for a crash. The skill is knowing which layer a given failure belongs to — and most failures belong to Layer 1.

**What if the interviewer asks: "Give me a failure that could be either?"**
A division by zero. If the divisor comes from untrusted user input, it's an *error* — validate it and return "invalid input." If the divisor is a constant you computed and it's somehow zero, that's a *bug* — a panic is appropriate, because your own logic is broken. Same operation, different layer, decided by *whose mistake it is*.

**What if they ask: "So is a panic just an exception?"**
Mechanically similar (both unwind a stack), but the *intent* differs. In Go and Rust, panic is reserved for bugs and unrecoverable states; you're discouraged from using it for ordinary control flow. In Java/Python, exceptions *are* the ordinary error channel — `FileNotFoundException` is routine. So "panic == exception" is true at the runtime level and false at the design level.

### Q: When should a program crash instead of recovering? (junior)

When continuing would be *less safe than stopping*. Concretely: when an invariant the rest of the code depends on is broken, when state may be corrupted, or when the failure indicates a bug rather than a handleable condition. A crash is a clean, loud, debuggable failure with a stack trace and an exit code. Limping on past a broken invariant is a silent, slow failure that corrupts data and surfaces hours later somewhere unrelated.

The default at junior level is exactly this: **let it crash; don't recover defensively.** A crash today is a fix tomorrow. A swallowed panic is a data-corruption incident next month.

**What if they ask: "Isn't crashing bad for users?"**
A crash on *one process* is bad. But the alternative — running on corrupt state — is usually worse, because it produces wrong answers that users *trust*. The right move isn't "never crash," it's "crash at the right granularity": fail the one request, not the whole server; restart the one process, not lose the cluster. That's the boundary pattern, and it's how you get availability *and* fail-fast.

**What if they push: "Give me a case where you should NOT crash."**
At a boundary around isolated work — an HTTP request, a queue job. One bad request shouldn't kill thousands of healthy in-flight requests. There you recover, log, report, and fail *that unit only*. That's the one routinely-correct recovery point.

### Q: What is stack unwinding? (junior→middle)

When a panic (or exception) is raised, the runtime walks *back up* the call stack frame by frame, running cleanup as it goes — `defer`s in Go, destructors in Rust/C++, `finally` blocks in Java, `__exit__` in Python. This is **unwinding**: tearing down the stack in reverse order, releasing resources, until either something catches it (a `recover`/`catch`/`catch_unwind`) or it reaches the top of the stack and the program terminates.

Unwinding is what makes cleanup-on-failure possible: a deferred `file.Close()` or a `Drop` impl still runs even though the function is dying. It's also why a panic isn't an instant `kill` — there's machinery between "panic raised" and "process gone."

**What if they ask: "What's the alternative to unwinding?"**
**Abort.** Instead of walking the stack and running cleanup, the runtime calls something like `abort()` and the process dies *immediately* — no destructors, no `defer`, no `finally`. Rust offers this with `panic = "abort"`. It's faster and produces smaller binaries (no unwinding tables), but you lose all cleanup and you can't catch the panic. C's `assert` failure is effectively an abort.

**What if they ask: "Does unwinding always run cleanup correctly?"**
Not always safely. If a destructor *itself* panics during unwinding, you get a double-panic, which in Rust aborts the process and in C++ calls `std::terminate`. And cleanup that runs on a half-mutated structure can make corruption worse. Unwinding is "best effort cleanup," not "guaranteed safe rollback."

### Q: Explain Go's `defer`, `panic`, and `recover`. (junior→middle)

- **`defer`** schedules a function call to run when the surrounding function returns — *including* when it returns because of a panic unwinding through it. Deferred calls run in LIFO order. It's the cleanup hook.
- **`panic`** stops normal execution of the current function, runs its deferred calls, then unwinds to the caller, runs *its* deferreds, and so on up the stack.
- **`recover`** stops that unwinding. It only does anything when called *directly inside a deferred function during an active panic*. It returns the value passed to `panic` and resumes normal execution from the deferred function's caller.

The canonical idiom:

```go
defer func() {
    if r := recover(); r != nil {
        // handle: log, report, contain
    }
}()
```

**What if they ask: "Why must `recover` be inside a `defer`?"**
Because `recover` only has an effect while the stack is unwinding, and the only code that runs during unwinding is deferred functions. Call `recover()` on the normal happy path and it returns `nil` and does nothing — there's no panic in flight to recover from. Call it in a deferred function during a panic and it catches.

**What if they ask: "Does `recover` work if called from a helper the defer calls?"**
No — it must be called *directly* by the deferred function, not by a function that function calls. `defer func() { helperThatCallsRecover() }()` does **not** recover. This trips people up constantly.

### Q: What does it mean to "recover at the boundary"? (middle)

Install exactly **one** recovery point per *isolated unit of work* — per HTTP request, per queue job, per cron task, per gRPC call — at the infrastructure layer (middleware, the worker loop, an interceptor). A panic anywhere inside that unit unwinds to the boundary, which catches it, logs it with a stack, reports it (metric + crash reporter), and contains it by failing *only that unit* (return 500, dead-letter the job, mark the task failed). The server, pool, and loop survive.

It's safe *only* because the units are independent — one request shares no mutable state with another, so discarding a failed one doesn't poison the rest. Inside the boundary, business code stays fail-fast: no `recover` in handlers. The boundary is the single translation gate that converts a Layer-2 panic back into a Layer-1 "this request failed" at the edge of the system.

**What if they ask: "What are the obligations of a boundary recover?"**
Four, skip none: **catch**, **log** (error level, with the stack), **report** (metric for alerting + crash reporter for ticketing), **contain** (fail this unit only). Do catch+contain but skip log+report and you've built a *silent swallower* — worse than no boundary, because the bug now hides behind a living server forever.

**What if they ask: "Why one boundary and not recover in each handler?"**
DRY and discipline. One recover in infrastructure means every route gets identical, correct handling that you can't forget a step of. `recover()` scattered through business logic means every bug is independently hidden and the boundary discipline is destroyed. If you see `recover()` in a handler, it's almost certainly wrong.

### Q: Recovery buys you availability or correctness — which? (middle)

**Availability, not correctness.** Catching a panic does not fix the bug that caused it. The handler still has the nil-deref; tomorrow's identical request panics again. What you bought is: the server lived, and one request failed instead of all of them. You still owe the fix. Treating "the server stayed up" as "the problem is solved" is the cardinal mid-level error — recovery is a containment mechanism, not a repair.

**What if they ask: "So when is recovery genuinely the wrong trade?"**
When the unit *isn't* actually isolated. If the panic happened mid-mutation of shared state or while holding a lock, you've bought availability by keeping a *corrupted* process alive — which is negative value. There the correct move is to re-panic: crash clean.

### Q: What's the difference between fail-fast and resilience? Aren't they opposites? (middle→senior)

They operate at different scopes, and good systems use both.

**Fail-fast** is local: the moment a component detects a broken invariant, it stops *immediately* rather than continuing on bad state. A nil check that panics, an assertion, a `must`-style helper. The benefit is a clean, debuggable failure close to the cause.

**Resilience** is global: the *system* keeps serving despite individual failures. Retries, circuit breakers, supervision, restarts.

The reconciliation: **fail fast at the component, recover at the boundary, restart at the process.** Each unit fails fast (loud, clean, near the cause). The boundary contains that failure to one request/job. Supervision restarts the failed worker/process. You get debuggable local failures *and* a system that stays up — by choosing the right granularity for each.

**What if they ask: "Give me the crash-only design pitch."**
Crash-only software treats *crashing* and *starting* as the only two operations — there's no separate "clean shutdown" path to get wrong. If the only way to stop is to crash, and the only way to start is to recover from a crash, then your recovery path is exercised constantly and is therefore reliable. Erlang/OTP is the canonical example: "let it crash," and a supervisor restarts you into a known-good state.

### Q: What is supervision / a supervision tree? (senior)

A structural pattern (from Erlang/OTP, echoed in actor frameworks like Akka) where processes are arranged in a tree: **supervisors** whose only job is to start, monitor, and restart **workers**. Workers do the actual work and are allowed — encouraged — to crash on any unexpected failure. When a worker dies, its supervisor applies a restart strategy (restart just that child, restart all siblings, escalate to *its* supervisor) to return the subtree to a known-good state.

The philosophy is "let it crash": don't write defensive recovery in workers, because a fresh restart from clean state is more reliable than trying to patch up corrupted state in place. The supervisor *is* the resilience layer; the worker *is* the fail-fast layer.

**What if they ask: "How does this map to a Go service or a Kubernetes deployment?"**
Loosely but usefully. A Go worker pool with per-job recovery + dead-lettering is a flat one-level supervision. Kubernetes is a supervisor: a crashed pod (failed liveness probe / non-zero exit) is restarted by the kubelet, and a Deployment maintains the replica count. "Let it crash + let the orchestrator restart" is supervision at the infrastructure layer. The difference from OTP is granularity — OTP restarts a lightweight process in microseconds; K8s restarts a whole container in seconds.

**What if they ask: "What's the danger of restart-on-crash?"**
**Crash loops.** If the cause is deterministic (a poison message, a bad config), restart just re-crashes immediately, burning CPU and spamming alerts. Supervisors guard against this with restart *intensity limits* ("if a child restarts more than N times in T seconds, give up and escalate"). Kubernetes uses `CrashLoopBackOff` exponential backoff for the same reason. Restart is for *transient* failures; a deterministic crash loop needs a human or a dead-letter, not infinite retries.

### Q: What is a poisoned lock? (senior→staff)

When a thread panics *while holding a lock*, the data the lock protects may be left in a half-mutated, invariant-broken state. The question is what happens to the *next* thread that wants that lock.

In **Rust**, `Mutex` is *poison-aware*: if a thread panics while holding the lock, the mutex is marked **poisoned**, and subsequent `lock()` calls return `Err(PoisonError)`. This is a deliberate safety feature — it forces the next thread to acknowledge "the data behind this lock might be corrupt" rather than blindly reading it. You can `into_inner()` to access the data anyway if you've decided it's salvageable, but you have to do so explicitly.

In **Go** and most others, mutexes are *not* poison-aware. If you panic holding a `sync.Mutex` and recover, the lock is simply... still held (or released by a deferred `Unlock`), and the next acquirer reads whatever state was left — no warning. This is one reason Go's advice is to re-panic when you've recovered a panic that held a lock: the runtime won't protect you, so you must protect yourself.

**What if they ask: "Is lock poisoning good or bad?"**
It's a *correctness-over-availability* default. Good: it surfaces corruption instead of hiding it. Annoying: it propagates failure — one panicking thread "infects" every future user of that mutex, which can cascade. Many Rust codebases find poison handling noisy and either `.unwrap()` the poison (accepting the propagation) or use a non-poisoning mutex like `parking_lot::Mutex` when they've reasoned that a panic can't leave the data invalid. The point is it's a *deliberate trade-off*, not an accident.

**What if they ask: "When would you `into_inner()` past a poison?"**
When the data behind the lock is *replaced wholesale* rather than mutated in place, so a panic mid-operation can't leave a torn value — or when you're recovering a cache that's safe to rebuild. You're asserting "I've reasoned that this state is still usable." If you can't make that assertion honestly, propagate the poison (crash).

### Q: Why does `panic = "abort"` exist, and what do you lose with it? (senior→staff)

`panic = "abort"` (a Rust `Cargo.toml` profile setting) makes a panic call `abort()` immediately instead of unwinding the stack.

**What you gain:** smaller binaries (no unwinding tables / landing-pad code generated), slightly faster non-panic code paths, and simpler semantics for embedded / `no_std` contexts where unwinding isn't available. It also sidesteps a class of FFI undefined behavior — unwinding *across* an FFI boundary into C is UB, and abort can't unwind.

**What you lose:** destructors don't run (no `Drop`, no cleanup), and crucially **`catch_unwind` becomes inert** — there's no unwind to catch, so any boundary-recovery code silently does nothing. A worker pool that relies on `catch_unwind` to isolate panicking jobs will, under `panic = "abort"`, take the whole process down on the first panic.

**What if they ask: "How would you architect around abort if you still need isolation?"**
Process-level isolation instead of thread-level. If you can't catch panics in-process, you isolate units of work in *separate processes* (or OS threads you're willing to lose) and supervise them externally — the crash takes one worker process, and a supervisor restarts it. You move the boundary from "catch_unwind around a job" to "a subprocess per risky unit." This is also the only safe answer when the panic might come from `unsafe`/FFI code where even unwind-based recovery is suspect.

### Q: Is recovering from a panic ever appropriate *outside* a request/worker boundary? (staff)

A few legitimate cases beyond the canonical boundary:

1. **FFI / language edges.** You *must not* let a Rust panic (or a C++ exception) unwind across an FFI boundary into C — it's undefined behavior. So you wrap every `extern "C"` entry point's Rust body in `catch_unwind` and convert a panic into an error code. Here the recover isn't about availability; it's about *not invoking UB*.
2. **Test harnesses.** A test runner catches panics so one failing test reports as a failure rather than aborting the whole suite. Go's `testing` and Rust's test harness both do this.
3. **Plugin / sandbox hosts.** A host loading untrusted or third-party code wraps each plugin invocation so a buggy plugin fails its call instead of the host.
4. **Graceful top-level shutdown.** A last-resort top-level recover that flushes logs / closes connections before exiting — but it should *re-panic or exit non-zero*, not resume.

The common thread: every one is a **boundary** in the general sense — an edge between independent units or between languages/trust-domains. None of them is "recover so my business logic can continue past a bug."

**What if they ask: "What's the rule that ties these together?"**
Recover only at an *edge*, only to *contain or translate*, never to *continue computing on the broken state*. If after recovering you're going to keep running the same logical operation as if nothing happened, you're doing it wrong.

---

## Language-Specific

### Go

#### Q: How do you correctly recover a panic in Go and capture a useful stack? (middle)

```go
defer func() {
    if r := recover(); r != nil {
        stack := debug.Stack()          // capture HERE, at recover time
        slog.Error("recovered panic", "panic", r, "stack", string(stack))
        report.Capture(r, stack)
        // contain: e.g. w.WriteHeader(500)
    }
}()
```

The non-obvious part: **capture `debug.Stack()` inside the deferred function**, while the panic is still in flight. By the time control returns to the caller, the panicking stack has already unwound — a `debug.Stack()` called later shows the *recovery* site, not the *crash* site. Also note `recover()` alone gives you only the panic *value* (`panic("boom")` → the string `"boom"`); the stack is a separate thing you must grab yourself.

**What if they ask: "Does the standard `net/http` server already do this?"**
Yes — partially. `net/http` recovers panics *per connection* so a handler panic doesn't kill the process. But it doesn't log a clean stack, doesn't return a proper 500 (it aborts the response mid-stream), and doesn't report. So you still write your own middleware — not to *enable* recovery, but to do it *properly* (clean response, stack log, metric, reporter).

#### Q: A panic in one goroutine took down the whole process despite my recovery middleware. Why? (middle→senior)

Because **`recover` only catches panics in its own goroutine.** Your middleware's `defer recover()` protects the *request* goroutine. If the handler spawned a *new* goroutine (`go doWork()`) and that one panicked, it has its own stack — the middleware's recover can't see it. An uncaught panic in any goroutine unwinds to the top of *that* goroutine and crashes the *entire process*. There's no parent goroutine to catch it; goroutines aren't a tree with exception propagation.

The fix: every spawned goroutine needs its *own* recover. Wrap it so you can't forget:

```go
func SafeGo(fn func()) {
    go func() {
        defer func() {
            if r := recover(); r != nil {
                slog.Error("panic in goroutine", "panic", r, "stack", string(debug.Stack()))
                report.Capture(r, debug.Stack())
            }
        }()
        fn()
    }()
}
```

Then ban raw `go fn()` for panic-prone work in code review.

**What if they ask: "Why didn't Go's designers make goroutine panics propagate to the spawner?"**
Because there's no meaningful "spawner" to propagate to — the spawning goroutine may have already returned, and goroutines are deliberately *not* a parent/child hierarchy (that's a feature: no implicit lifetime coupling). Propagation would require a structured-concurrency model Go's primitives don't impose. The trade-off is explicitness: you own every goroutine's failure handling. (`errgroup` and structured-concurrency libraries add this back voluntarily.)

#### Q: Where exactly does `recover` go in a worker pool — around the loop or around the job? (middle)

Around the **job**, *inside* the loop:

```go
for job := range jobs {
    func() {
        defer func() {
            if r := recover(); r != nil {
                slog.Error("panic in job", "job", job.ID, "panic", r)
                job.DeadLetter()
            }
        }()
        handle(job)
    }()
}
```

If you put `defer recover()` at the *top of the loop function* instead, the first panic unwinds *past* the `for range` — the loop is gone, the deferred recover runs once, and the worker stops consuming **forever** (silently, which is the cruel part). Per-job recovery lets the loop survive each poison message.

**What if they ask: "How would you catch this bug in review?"**
A `defer recover()` whose enclosing function *contains* a `for range <channel>` loop is a red flag — the recover is at worker-lifetime scope. The recover must be in a function called *once per iteration*, inside the loop body. A CI grep for `recover()` not wrapped in a per-iteration closure can flag candidates.

#### Q: What's the difference between `panic(err)` and `return err` in Go, and when is each idiomatic? (middle)

`return err` is the normal Layer-1 channel: the failure is expected, the caller handles it, it's in the signature. This is the default for ~all error handling in idiomatic Go.

`panic(err)` is for *unrecoverable* situations: a programmer bug, a violated invariant, or an init-time failure where there's no sane way to continue (`regexp.MustCompile` panics on a bad pattern *because a bad regex literal is a bug, not a runtime condition*). Idiomatic panic use is narrow: `MustXxx` constructors fed compile-time-constant input, truly-impossible default branches, and the *internals* of a package that recovers at its own boundary and converts back to an error (the parser pattern).

**What if they ask: "What's the parser pattern?"**
A recursive-descent parser deep in the stack uses `panic` to bail out of deeply nested code instead of threading an error through twenty return statements. The *public* function recovers at its boundary and converts that panic back into a returned `error`. The panic never escapes the package; externally it's a normal error-returning API. It's an internal control-flow optimization, justified only because it's fully contained.

### Rust

#### Q: Explain `panic!`, `Result`, and when each is the right tool. (middle)

`Result<T, E>` is Rust's Layer-1: recoverable, expected failures, propagated with `?`, part of the type signature. The compiler *forces* you to handle it. This is the default for anything that can fail in normal operation — IO, parsing, validation.

`panic!` is Layer-2: unrecoverable bugs and broken invariants. `.unwrap()`/`.expect()` panic on `None`/`Err`; array indexing panics on out-of-bounds; `assert!` panics on a false invariant; integer overflow panics in debug builds. You reach for panic when continuing is *wrong*, not merely *failed*.

The dividing question: **"Is this failure a normal possibility the caller should handle, or a bug in my own logic?"** Normal possibility → `Result`. Bug → `panic!`.

**What if they ask: "Is `.unwrap()` always bad?"**
No — it's *honest* in the right places. In a `main` or a prototype, `.unwrap()` says "I'm asserting this can't fail and I accept a crash if I'm wrong." On a `Mutex::lock()` it propagates poison. After a check that logically guarantees `Some` (though `if let`/`match` is usually cleaner). It's bad when it's a lazy substitute for handling a genuinely-possible error — `.unwrap()` on a network call is a latent crash. Senior reviewers ask "is the invariant being asserted actually true?" not "is there an unwrap?"

#### Q: How does `catch_unwind` work, and what are its two big caveats? (senior)

`std::panic::catch_unwind(f)` runs `f` and returns `Result<T, Box<dyn Any + Send>>` — `Ok` if `f` completed, `Err(payload)` if it panicked. It's Rust's boundary-recovery tool: stop a panic from unwinding out of a thread/worker/FFI edge and tearing down more than the one unit.

Two caveats every candidate must know:

1. **It requires `UnwindSafe`.** The closure's captures must implement `UnwindSafe` — a compile-time signal that a panic crossing the boundary won't leave shared data observably half-mutated. `AssertUnwindSafe(...)` overrides the check; reaching for it without reasoning about it is how you reintroduce a corruption bug.
2. **It's inert under `panic = "abort"`.** With abort there's no unwind, so `catch_unwind` never fires — the process dies on the first panic. A worker pool relying on it for isolation is silently unprotected under that profile.

The panic payload is *type-erased* (`Box<dyn Any>`), so to read the message you `downcast_ref::<&str>()` / `::<String>()`, and often that's all you get.

**What if they ask: "Why isn't `catch_unwind` used like a try/catch?"**
Because Rust's design says recoverable failures use `Result`/`?` — that's the ergonomic, type-checked, exhaustive path. `catch_unwind` is for *boundaries* (FFI, threads, test harnesses), not control flow. Using it to "handle" a `None` is fighting the language; use `match`/`?`. The community treats panic-as-control-flow as a smell.

#### Q: What does `panic = "abort"` change, and why would a team choose it? (senior→staff)

It replaces stack-unwinding-on-panic with an immediate `abort()`. Teams choose it for: smaller binaries (no unwind tables), embedded/`no_std` targets where unwinding is unavailable, avoiding unwind-across-FFI UB, and simpler "a bug = the process dies, full stop" semantics. The cost: no destructors run on panic (cleanup is skipped), and `catch_unwind`-based isolation stops working. Many CLI tools and some servers ship abort deliberately — if your resilience strategy is "the supervisor restarts the process," you don't need in-process unwinding anyway.

**What if they ask: "How do you get isolation under abort?"**
Move the boundary out of the process: run risky units in subprocesses (or accept losing an OS thread) and supervise them externally. Crash-only + external restart, instead of catch-and-continue.

### Java / Python / JS

#### Q: Java and Python don't have `panic`/`recover` — so how does this topic map? (middle)

The *concept* maps even though the keywords don't. The two-layer split becomes:

- **Layer 1 (errors):** checked exceptions / ordinary `Exception`s you're expected to catch — `IOException`, `KeyError`, a rejected promise. Routine failures.
- **Layer 2 (panics):** `Error`/`RuntimeException` subtypes that signal bugs — `NullPointerException`, `IndexOutOfBoundsException`, `OutOfMemoryError`, `AssertionError`; in Python `AssertionError`, `SystemExit`; in JS a thrown `TypeError`. You generally *don't* catch these per-call; you let them hit a boundary.

The boundary pattern is identical: a global exception handler (`@RestControllerAdvice` in Spring, `@app.errorhandler(Exception)` in Flask, Express error middleware) catches the uncaught Layer-2 throwable at the request edge, logs+reports it, and returns a 500 — failing one request, not the JVM/process.

**What if they ask: "What's the catch-`Exception`-not-`BaseException` rule about?"**
In Python, `BaseException` includes `KeyboardInterrupt` and `SystemExit` — the "abort layer." Catching `Exception` (its subclass) handles bugs while letting Ctrl-C and `sys.exit()` propagate correctly. `except BaseException: pass` would swallow shutdown signals — the same way `catch (Throwable)` in Java swallows `OutOfMemoryError` (where a 500 is a polite lie; the JVM may be doomed regardless). At a boundary, catch the *request-layer* type.

#### Q: A thread panicked in Java/Python but the process didn't die. Why — and is that good? (middle→senior)

An uncaught exception in a *non-main* thread (Java `Thread`, Python `threading.Thread`) kills *that thread* and prints a stack trace, but by default does **not** propagate to the main thread or terminate the process. So unlike a Go goroutine panic (which kills the process), a thread death in Java/Python is silently local.

Is it good? It's *safer for availability* but *dangerous for observability*: a worker thread can die unnoticed, and now you have a pool that's silently down a worker, or a background task that simply stopped. The fix is to centralize reporting: Java's `Thread.setDefaultUncaughtExceptionHandler` / per-thread `setUncaughtExceptionHandler`, Python's `threading.excepthook` (3.8+). Wire those so a dead thread becomes a logged, reported, alertable event rather than a silent gap.

**What if they ask: "So which is the better default — Go's process-crash or Java's thread-local death?"**
Neither is universally better; they trade observability for blast radius. Go's "any goroutine panic kills the process" is brutally loud — you *cannot* ignore it, but the blast radius is the whole process. Java's "thread dies quietly" has a small blast radius but invites silent degradation. The correct answer is the same in both worlds: **install explicit per-thread/per-goroutine handling** so failures are neither process-fatal-by-accident nor silently-lost.

#### Q: Why do async handlers bypass Express's error middleware? (middle)

Express error-handling middleware only catches *synchronous* throws and errors passed via `next(err)`. An `async` route handler that rejects produces an unhandled promise rejection that Express never sees — it becomes a process-level `unhandledRejection`, which in modern Node *crashes the process*. This is the JS version of "goroutine panics escape your boundary": the async task is a separate execution context the middleware doesn't wrap.

Fix: `express-async-errors` (which patches routing to forward rejections), or wrap every async route in `try/catch` and call `next(err)`, or an `asyncHandler(fn)` wrapper.

**What if they ask: "What's the worst-case if you ignore this?"**
A single rejected promise in one request handler crashes the entire Node process, dropping every other in-flight request — the exact "one bad request kills the server" blast radius the boundary pattern is supposed to prevent, sneaking back in through the async gap.

---

## Tricky / Trap Questions

### Q: "I wrapped everything in `try/catch` so my service never crashes." What's wrong with that?

Wrong instinct: "never crashing == robust." It's the opposite.

A blanket `catch` that swallows everything converts *loud bugs* into *silent corruption*. The nil-deref still happened; you just hid it. Now the process runs on broken state, returns wrong answers users trust, and the bug surfaces weeks later in an unrelated place with no stack trace. "Never crashes" usually means "never tells you it's broken."

The correct shape isn't *no* crashing — it's *contained* crashing: fail the one request at the boundary (with log+report), keep the server up, and let the bug be *visible* so it gets fixed. Robustness is "fails at the right granularity, loudly enough to fix," not "swallows everything."

### Q: You recover a panic, log it, and return 500. Tomorrow the same request panics again. Did your recovery fail?

Wrong instinct: "the recover didn't work." It worked perfectly — and that's the point being tested.

Recovery buys **availability, not correctness.** It contained the blast radius (one request, not the server) and made the bug *visible* (log + report + metric). It was never going to *fix* the nil-deref — that's a code change. The recovery did its entire job: keep the service alive and hand you a ticket. If the same request panics tomorrow, that means *nobody read the ticket*, which is a process failure, not a recovery failure.

The trap is candidates who think a boundary recover is a substitute for fixing bugs. It's a containment layer that *surfaces* bugs faster, not slower.

### Q: A deferred `recover()` with nothing in the body — `defer func(){ recover() }()`. What does it do and why is it dangerous?

It **silently swallows every panic** in the function. The panic is caught, no value inspected, nothing logged, nothing reported — the function just returns as if nothing happened, on whatever broken state caused the panic.

It's the single most dangerous line in this whole topic. Without it, a panic crashes the process → you find out immediately → you fix it. With it, the process survives on corrupt state → you *never* find out → the bug quietly corrupts data for weeks. Surviving-and-hidden is strictly worse than crashing-and-visible.

**What if they ask: "When is a bare `recover()` ever acceptable?"**
Effectively never in production code. The closest legitimate case is a *test/benchmark harness* that recovers to report a failure and immediately surfaces it (logs/marks failed) — so it's not actually silent. The rule: *if you recover, you log and report. If you won't log and report, don't recover.*

### Q: Your worker pool stopped processing jobs after a few hours, with no crash and no error. Hypothesis?

Wrong instinct: "the queue is empty" or "the process died." The process is alive; it just stopped consuming.

Top hypothesis: **a `defer recover()` at worker-lifetime scope instead of per-job.** A poison message panicked, the recover fired *once*, but it was above the `for range jobs` loop — so the loop unwound away and the worker silently exited its consume loop while the goroutine/thread itself stayed alive (blocked or returned). No crash, no log (if the recover was also silent), just a worker that quietly stopped. Multiply across the pool over hours and throughput drops to zero.

Diagnosis: goroutine dump (`SIGQUIT` / pprof). Workers that should be in `chan receive` are instead *gone* or parked elsewhere. Fix: recover *per job*, inside the loop, with log+report so the poison message is visible.

**Other suspects:** deadlock (all workers blocked on a lock — dump shows `semacquire`); a panicking *spawned* goroutine that killed the consume goroutine's children; backpressure where the dead-letter path itself blocks.

### Q: Under `panic = "abort"`, your `catch_unwind`-based job isolation does nothing. The same code worked in dev. Why?

Wrong instinct: "the recovery code is broken." The code is fine — the *profile* changed.

`catch_unwind` can only catch an *unwinding* panic. Dev builds (or a release profile without the abort setting) unwind by default, so the catch fires and isolation works. If the *release* profile sets `panic = "abort"` (for smaller binaries / no unwind tables), a panic calls `abort()` immediately — there's no unwind, `catch_unwind` never runs, and the first panicking job takes down the whole process.

Check `Cargo.toml`:
```toml
[profile.release]
panic = "abort"   # ← this makes catch_unwind inert in release only
```

This is a classic "works in dev, dies in prod" trap because the two builds have different panic strategies. Fix: either use `panic = "unwind"` if you need in-process isolation, or move isolation to separate processes and rely on external supervision.

### Q: In Rust, the second thread to take a mutex got `Err(PoisonError)`, but the first thread "handled" its panic. What happened?

Wrong instinct: "the mutex is buggy" or "poison is a spurious error." It's working exactly as designed.

The first thread panicked *while holding the lock*. Rust marks the mutex **poisoned** to warn that the protected data may have been left mid-mutation, in a broken state. The next `lock()` returns `Err(PoisonError)` to *force* the caller to acknowledge "this data might be corrupt" rather than blindly reading torn state. The first thread "handling" its panic elsewhere doesn't un-poison the lock — the *data* is what's suspect, and that suspicion outlives the panic.

Options: propagate (`.unwrap()` the poison → crash, the safe default if you can't reason about the data), or `into_inner()` past the poison if you've *honestly determined* the data is still valid (e.g. it's replaced wholesale, not mutated in place), or use a non-poisoning mutex (`parking_lot`) when you've proven a panic can't leave it invalid.

**What if they ask: "Why doesn't Go do this?"**
Go's `sync.Mutex` isn't poison-aware — it has no concept of "the data behind me might be corrupt." That's *why* Go's guidance is to re-panic after recovering a panic that held a lock: the runtime won't flag the danger, so you must. Rust encodes the discipline in the type; Go leaves it to you.

### Q: "Should we add a top-level `recover()` in `main` so the service never goes down?" What do you say?

Wrong instinct: "yes, max uptime." A top-level recover that *resumes* is a disaster.

A recover at `main` that catches and continues means the process keeps running after a panic with no isolation guarantees — you have no idea what state the panic left, and you've removed the one mechanism (a crash) that would have restarted you clean. You've maximized uptime of a *possibly-corrupt* process, which is negative value.

What's defensible: a top-level handler that recovers *only to flush logs, emit a final crash report, and exit non-zero* — i.e., it improves the *crash*, it doesn't *prevent* it. The supervisor (systemd/K8s) then restarts you into clean state. "Never go down" is the wrong goal; "go down cleanly and come back fast" is the right one.

### Q: You see "fatal error: concurrent map writes" and it crashed despite your recovery middleware. Why couldn't you recover it?

Wrong instinct: "add another recover." You *can't* recover it.

Some Go runtime failures are **fatal errors, not panics** — concurrent map read/write, stack overflow, out-of-memory, and a deadlock detected by the runtime. These bypass `recover` entirely and terminate the process immediately, by design: the runtime has decided the program is in an unsafe state where continuing is meaningless. `recover()` only catches `panic`; it does nothing for a `throw`-class fatal error.

The "fix" isn't recovery — it's eliminating the *concurrent map write* (add a mutex or use `sync.Map`). The runtime is deliberately refusing to let you paper over a data race with a recover, because the corrupted map could produce arbitrary wrong behavior.

**What if they ask: "What else can't be recovered?"**
Stack overflow, OOM, and an all-goroutines-deadlocked detection — all fatal, all uncatchable. The principle: the runtime reserves the right to die uncatchably when the program is unambiguously broken.

### Q: A panic happened during stack unwinding (in a deferred call / destructor). What's the result?

Wrong instinct: "the second panic gets caught too." It usually doesn't — it escalates.

If a *second* panic is raised while the first is still unwinding (a `defer` that panics, a `Drop`/destructor that panics), most runtimes treat it as unrecoverable: Rust **aborts** the process (a panic during unwinding → `abort`), C++ calls `std::terminate`. Go is more forgiving — a panic in a deferred function *replaces* the in-flight panic and can still be recovered — but the original panic's information may be lost or chained.

The lesson: **cleanup code must not panic.** A destructor or deferred function that can fail should handle its own errors, because a failure during unwinding can turn a recoverable panic into an unconditional process abort.

---

## System / Design Scenarios

### Q: Design the panic-handling strategy for a high-throughput HTTP API. Walk me through it.

**Boundary.** One recovery middleware wrapping the whole router. A panic in any handler unwinds to it; it logs (error level, with stack captured at recover time), increments a `panics_total` counter, sends to the crash reporter (deduped by fingerprint), and returns a generic 500 — never the stack trace, to avoid information disclosure. One bad request fails; the other in-flight requests are untouched.

**Inside is fail-fast.** Handlers contain no `recover`. Bugs surface; the boundary contains them.

**Spawned work.** Any goroutine/thread a handler launches gets its *own* recover via a `SafeGo`-style wrapper — the middleware can't reach it, and an unguarded spawn is a process-wide blast radius. Banned in review: raw `go fn()` for panic-prone work.

**Alerting.** Alert on `panics_total` *rate*, not absolute count — a steady trickle is one broken endpoint; a spike is a new deploy or an attack. Per-route panic labels point at the culprit.

**Supervision.** The process itself is supervised (K8s liveness probe / systemd). For *fatal* errors the runtime won't let you recover (OOM, concurrent map write), the supervisor restarts the pod with backoff.

**What if they ask: "Should the middleware ever NOT return 500 and instead crash?"**
If the panic indicates *process-wide* corruption rather than request-local — e.g. you detect a held global lock or a poisoned shared structure — re-panic for a clean restart. But the default for request-isolated panics is contain-and-500.

### Q: A payments service: a panic happens mid-transaction. Should it recover and return 500, or crash? Defend your choice.

This is the question the whole topic builds toward, and the answer is **"it depends on what the panic touched, and you must reason about state."**

If the panic happened *before* any side effect — during validation, before the DB write, before calling the issuer — then it's request-local: recover at the boundary, return 500, the customer retries, no harm. Contain it.

If the panic happened *mid-mutation* — between debiting and crediting, while holding a ledger lock, after sending to the issuer but before recording it — then the process may be holding a *half-completed financial operation*. Here recovering-and-continuing is dangerous: the next request could read a torn ledger. The correct move is **re-panic for a clean crash**, and rely on the *transaction* (DB rollback) + *idempotency keys* to make the retried request safe. Better one restart than a double-charge.

The deeper answer: in a payments system you don't lean on in-process recovery for correctness at all — you make operations **idempotent and transactional** so that *any* failure mode (panic, crash, network drop) is safe to retry. The panic strategy is a containment layer *on top of* a system that's already crash-safe.

**What if they ask: "So when is it ever OK to just 500 mid-transaction?"**
When the transaction boundary guarantees atomicity — the DB transaction wasn't committed, so the panic rolled it back, and the idempotency key makes the retry a no-op-or-complete. Then a 500 is safe because *the durable state was never half-written* even though the in-memory operation was interrupted. The safety comes from the transaction, and the 500 just tells the client to retry.

### Q: Design panic isolation for a worker pool that processes untrusted user-submitted code.

Untrusted code raises the stakes: it can panic *deliberately*, loop forever, exhaust memory, or corrupt shared state. In-process `recover`/`catch_unwind` is **not enough** because (a) it can't stop OOM/stack-overflow/infinite-loops, and (b) untrusted code could leave shared in-process state corrupt even if you catch its panic.

The right design is **process-level (or stronger) isolation**:

1. **Run each unit in a separate process** (or a sandbox: gVisor, Firecracker microVM, WASM runtime with no shared memory). A crash, OOM, or panic takes down *that* sandbox, not the host.
2. **The host supervises**: spawn → run with resource limits (CPU/mem/time via cgroups) → on crash/timeout, kill and dead-letter the job, restart the worker.
3. **No shared mutable state** between host and sandbox — communication is message-passing only, so there's nothing for a panicking unit to corrupt.
4. **Crash-loop protection**: a unit that crashes repeatedly is quarantined, not retried infinitely.

**What if they ask: "Why not just `catch_unwind` each job?"**
Because `catch_unwind` only handles *unwinding panics*. Untrusted code can OOM the process, overflow the stack, spin forever, or (in `unsafe`/FFI) corrupt memory — none of which `catch_unwind` touches. And even a caught panic might leave a shared allocator or global in a bad state. Trust boundaries require *isolation* boundaries (separate address space + resource limits), not just *recovery* boundaries.

### Q: Your team debates "let it crash" (supervised restarts) vs "defensive recovery." How do you decide?

I frame it by *where the failure is isolated and how fast restart is*:

**Favor "let it crash" when:** restart is cheap and fast (Erlang process: µs; a stateless pod: seconds), state is easily reconstructible, and failures are likely *transient* (a flaky dependency, a rare race). Crash-only is more reliable here because the recovery path is simple and constantly exercised, and you avoid the bug-hiding risk of in-place recovery.

**Favor recovery-at-boundary when:** the unit is cleanly isolated (HTTP request, queue job), restart of the *whole* process would be disproportionate (drop thousands of healthy requests to handle one bad one), and you can *contain* the failure to the unit with log+report.

**Reject "defensive recovery" (recover scattered in business logic) always** — it hides bugs and buys nothing.

The synthesis is usually *both*: recover-at-boundary to contain one unit, let-it-crash + supervise for failures the boundary can't safely contain (held locks, fatal errors, corruption).

**What if they ask: "What's the failure mode of 'let it crash'?"**
Crash loops on *deterministic* failures: a poison message or bad config makes restart re-crash instantly, burning resources and alerting fatigue. Guard with restart-intensity limits / `CrashLoopBackOff` and dead-lettering, so deterministic failures escalate to a human rather than looping forever.

### Q: You're adding observability for recovered panics. What do you instrument and alert on?

Three signals per recovered panic, every time:

- **Log** (error level, *with the stack captured at recover time*) — for incident forensics. Include request/job ID, route/job type for correlation. Never log PII or leak the stack to the client.
- **Metric** (`panics_total`, labeled by route/job type and ideally by panic fingerprint) — so you can *alert on rate*. A counter, not a gauge.
- **Crash reporter** (Sentry/Rollbar) capture, deduped by **fingerprint** (file:line + type) — so each unique panic becomes one ticket with a stack, not 10,000 duplicate alerts.

**Alerts:** panic *rate* exceeding baseline (a spike = new deploy or attack); a *new* fingerprint appearing (a regression just shipped); dead-letter rate climbing (poison messages); a worker pool's active-worker count dropping (silent worker death). Alert on rate and novelty, not raw count.

**What if they ask: "Why fingerprint-dedup matter so much?"**
Without it, one broken hot endpoint emits a panic per request — millions of identical reports that bury the *other* bugs and train everyone to ignore the alert channel. Fingerprinting collapses "this same bug, 4M times" into one ticket with a count, keeping the signal usable.

---

## Live Coding / Whiteboard

### Q: Write a correct Go HTTP recovery middleware. Then I'll ask you to break it.

```go
func Recover(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                stack := debug.Stack()                 // capture at recover time
                slog.Error("panic recovered",
                    "panic", rec, "method", r.Method, "path", r.URL.Path,
                    "stack", string(stack))
                panicsTotal.Inc()                      // metric
                report.Capture(rec, stack, r)          // crash reporter
                w.WriteHeader(http.StatusInternalServerError)
                _, _ = w.Write([]byte("internal server error\n"))
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

All four obligations: catch, log (with stack), report (metric + reporter), contain (500). Wrap once around the whole mux.

**Follow-up: "Now break it — show me a panic this middleware won't catch."**
```go
func handler(w http.ResponseWriter, r *http.Request) {
    go func() { panic("boom") }()   // new goroutine — middleware can't see it → process dies
    w.Write([]byte("accepted"))
}
```
The spawned goroutine has its own stack; the middleware's `recover` only catches its own goroutine. Fix: `SafeGo(func(){ ... })` with its own recover.

**Follow-up: "Anything wrong if I already wrote `w.WriteHeader(200)` before the panic?"**
Yes — you can't *un-send* a status. If the handler wrote a 200 and partial body, then panicked, calling `w.WriteHeader(500)` logs `superfluous WriteHeader` and the client gets a 200 with a truncated body. Robust middleware buffers the response (or uses a wrapper that tracks whether headers were sent) so it can still send a clean 500 — or at least detects the case and aborts the connection.

### Q: This worker loop dies after the first bad job. Fix it.

Before:
```go
func (w *Worker) Run(jobs <-chan Job) {
    defer func() { recover() }()          // BUG: recover at loop scope, and silent
    for job := range jobs {
        w.handle(job)                      // first panic → unwinds past the loop → worker dead
    }
}
```

After:
```go
func (w *Worker) Run(jobs <-chan Job) {
    for job := range jobs {
        w.processOne(job)                  // recover INSIDE, per job
    }
}

func (w *Worker) processOne(job Job) {
    defer func() {
        if rec := recover(); rec != nil {
            slog.Error("panic in job", "job", job.ID, "panic", rec,
                "stack", string(debug.Stack()))
            report.Capture(rec, debug.Stack(), job)
            job.DeadLetter()               // contain: poison aside, loop survives
        }
    }()
    w.handle(job)
}
```

Two fixes: recover **per job** (so the `for range` survives), and it's no longer **silent** (logs + reports + dead-letters). Talking point: the original had *both* canonical bugs — wrong scope and silent swallow.

### Q: Write a Rust `catch_unwind` boundary for a worker, and tell me when it silently does nothing.

```rust
use std::panic::{self, AssertUnwindSafe};

fn run_job(job: Job) {
    let result = panic::catch_unwind(AssertUnwindSafe(|| process(job)));
    match result {
        Ok(()) => {}
        Err(payload) => {
            let msg = payload.downcast_ref::<&str>().map(|s| s.to_string())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "non-string panic".into());
            tracing::error!(panic = %msg, "recovered panic in job");
            dead_letter(job);              // contain
        }
    }
}
```

It silently does nothing under `panic = "abort"` — no unwind, so `catch_unwind` never fires and the first panic aborts the whole process. Check `Cargo.toml`'s `[profile.release] panic` setting.

**Follow-up: "Why `AssertUnwindSafe` here, and what risk does it carry?"**
Because the closure captures `job`, which may not be `UnwindSafe`. `AssertUnwindSafe` overrides the compiler's check — I'm asserting "a panic crossing this boundary won't leave observable corrupt state," which is true because I *discard* the job (dead-letter it) on panic and don't reuse partially-mutated captures. The risk: if I were mutating *shared* state through that closure and panicked mid-way, `AssertUnwindSafe` would silence the very warning that's trying to stop me from recovering into corruption.

### Q: Show me a re-panic: recover, decide the state is unsafe, crash clean.

```go
defer func() {
    if rec := recover(); rec != nil {
        // capture & log the ORIGINAL stack before re-panicking — re-panic loses it
        slog.Error("panic while holding ledger lock",
            "panic", rec, "stack", string(debug.Stack()))
        report.Capture(rec, debug.Stack(), nil)
        // We panicked mid-mutation under a lock. Shared ledger may be half-written.
        // Availability is NOT worth corrupt money. Crash clean for a fresh restart.
        panic(rec)                         // re-panic
    }
}()
mutateLedgerUnderLock()
```

Talking points: recovering gives a *decision point*, not an obligation to continue. When isolation is an illusion (held lock, half-mutated shared state), the correct move is log + report + **re-panic**. Note re-panic preserves the *value* but resets the *stack* to the re-panic site — so log the original `debug.Stack()` *before* re-panicking.

### Q: Classify these as Layer-1 error or Layer-2 panic, and justify.

```
a) os.Open("/tmp/x.txt") returns ErrNotExist
b) arr[10] on a length-3 slice
c) JSON from an external API fails to parse
d) a config value you computed is nil when your own code requires it non-nil
e) Mutex::lock() returns PoisonError in Rust
f) integer overflow in a financial calculation
```

- **(a) Layer-1 error.** File-not-found is an expected, handleable runtime condition. Return it.
- **(b) Layer-2 panic.** Out-of-bounds is a bug — your indexing logic is wrong. Crash.
- **(c) Layer-1 error.** External data is untrusted; malformed input is *expected*. Return a 4xx/parse error, don't panic.
- **(d) Layer-2 panic.** *Your own* invariant is violated — that's a bug, panic (or `must`-style). (Contrast with (a): the difference is whose mistake it is.)
- **(e) Layer-1-ish, surfaced as `Result`.** Poison is a *recoverable* signal you must handle — but it *indicates* a prior Layer-2 panic. Usually you propagate (crash) or `into_inner()` after reasoning about the data.
- **(f) Depends on intent.** In money, overflow is a serious bug — fail loudly (Rust panics on overflow in debug; use checked arithmetic and treat overflow as Layer-2). Silently wrapping is the dangerous wrong answer.

Talking point: the recurring discriminator is **"is this a normal possibility the caller should handle (error) or a bug / broken invariant (panic)?"** — and for the same operation, the answer flips based on *whose mistake* the failure represents.

---

## Behavioral / Experience

### Q: Tell me about a time a panic/exception took down more than it should have.

The interviewer wants blast-radius reasoning and the fix, not "we had a bug."

Example skeleton:
- **Symptom.** Our Go API would fully restart a few times a day — every pod, brief 502 spikes affecting all users.
- **Investigation.** Crash logs showed a panic, but our request middleware recovered panics — so why a process death? The stack's top frame was a goroutine spawned inside a handler (`go publishMetrics(...)`), not the request goroutine.
- **Root cause.** That goroutine occasionally dereferenced a nil response. The middleware's recover couldn't see it; it unwound to the top of *its own* goroutine and killed the process.
- **Fix.** A `SafeGo` wrapper (recover + log + report) for every spawned goroutine, plus a lint banning raw `go` for fallible work.
- **Lesson.** "We have recovery middleware" is a false sense of safety — recover only catches its own goroutine. Every concurrency primitive needs its own boundary.

Tell *one* incident with concrete blast radius (how many users, how often).

### Q: Describe a time you chose to let something crash instead of recovering — and defended it.

"A data-import pipeline hit occasional corrupt records that violated an invariant our downstream aggregation relied on. The team wanted a `try/except: continue` to 'keep the import running.' I pushed back: silently skipping corrupt records meant our aggregates would be *quietly wrong*, and nobody would know which numbers to distrust. We made the importer fail-fast on an invariant violation, dead-letter the bad record with full context, and alert. The import 'failed' more often — but every failure was a *real* data problem we could see and fix, instead of silent under-counting. Lesson: 'keeps running' is not a virtue if it runs on bad data; visibility beats uptime for anything that produces trusted numbers."

### Q: Tell me about a poisoned-lock or shared-state-corruption bug.

"A Rust service started returning `PoisonError` on a shared cache mutex after deploying a new code path. The new path mutated the cache in place and could panic mid-mutation (an `.unwrap()` on a map lookup). The *first* panic poisoned the mutex; every subsequent request failed to acquire it. The naive 'fix' someone proposed was `.lock().unwrap_or_else(|e| e.into_inner())` to ignore the poison — but the cache really *was* half-mutated, so that would have served corrupt data. The real fix was to make the mutation *atomic*: build the new cache value fully, then swap it in one assignment, so a panic mid-build can't leave a torn cache. Lesson: poison isn't the problem; it's the *messenger*. Suppressing it just hides the corruption it's warning you about."

### Q: When did "the service never crashes" turn out to be a problem?

"Inherited a Python service wrapped head-to-toe in `try/except Exception: logger.warning(...)`. It had 99.99% uptime and a reputation for reliability — and a backlog of 'mysterious data inconsistencies' nobody could reproduce. The two facts were the same fact. The blanket catches were swallowing real bugs (a `KeyError` here, a `None` there) and continuing on partial state, producing subtly wrong writes. I replaced the catch-all with a *boundary* handler at the request edge (log+report+500) and removed the inner swallows so bugs surfaced. Uptime dropped slightly; the 'mysterious inconsistencies' stopped — because now the bugs crashed visibly and got fixed. Lesson: a suspiciously reliable service that also has unexplained data weirdness is often hiding its bugs, not lacking them."

### Q: Describe a crash loop you had to diagnose.

"A worker deployment went into `CrashLoopBackOff` right after a deploy. The instinct was 'roll back the code,' but the code was fine — a malformed message had landed on the queue, and our worker fail-fast-crashed on it (correctly). The problem: the message was *redelivered* on restart, so we re-crashed on it forever — a deterministic crash loop. The fix had two parts: short-term, dead-letter the poison message so the queue stopped redelivering it; long-term, add a redelivery-count threshold that dead-letters after N attempts, so a single bad message can never crash-loop the pool. Lesson: fail-fast + auto-restart is only safe with *crash-loop protection* — for deterministic failures, infinite restart is a denial-of-service against yourself."

### Q: Tell me about choosing the panic strategy for a service from scratch.

"Greenfield Go gRPC service. I set it up as: recovery interceptor at the boundary (catch → log with stack → metric → reporter → `codes.Internal`), fail-fast everywhere inside, `SafeGo` for the handful of background goroutines, and `GOTRACEBACK=crash` so any *uncatchable* fatal error (concurrent map write, etc.) produces a full core-dumpable trace instead of a terse message. Then I deliberately added a `/debug/panic` admin endpoint (auth-gated) that panics on demand, and load-tested it to *prove* one panicking request returned `Internal` while concurrent requests succeeded — verifying the boundary actually isolated, rather than assuming. Lesson: design the boundary, then *test the blast radius on purpose* before you trust it in prod."

---

## What I'd Ask a Candidate Now

Questions that separate "knows the keywords" from "understands the model."

### Q: What's the one place it's routinely correct to recover, and what are the four things you must do there?

Listening for: **the boundary** (per isolated unit of work) and **catch / log-with-stack / report / contain** — *and* the insight that skipping log+report makes it a silent swallower, worse than no boundary. A candidate who says "wrap everything in try/catch" has failed the question.

### Q: A recover, a returned error, and a 500 to the client — what should differ between them and what shouldn't?

Strong answer: to the *client*, a recovered panic and a returned server error look identical (both 500, generic message, no stack leaked). What differs is *internal*: the recovered panic indicates a *bug* (gets a crash-reporter ticket and a fingerprint), while a returned error may be an *expected* failure. The skill is keeping the client view uniform while preserving the internal distinction.

### Q: Walk me through why a goroutine/thread panic behaves differently in Go vs Java, and what that means for your design.

Reveals depth. Go: any goroutine's uncaught panic kills the *process* (loud, big blast radius). Java/Python: a non-main thread's uncaught exception kills *that thread* silently (small blast radius, poor observability). Design consequence: in Go you must guard every spawn or risk process death; in Java/Python you must wire `UncaughtExceptionHandler`/`threading.excepthook` or risk silent worker death. Same goal — explicit per-unit handling — opposite default failure mode.

### Q: When is `AssertUnwindSafe` (Rust) or re-panicking (Go) the right call, and when is it a footgun?

Listening for state reasoning. `AssertUnwindSafe`: right when you provably discard the closure's state on panic; footgun when it silences a real corruption warning about *shared* mutation. Re-panic: right when isolation is an illusion (held lock, half-mutated shared state) and a clean crash beats limping on; footgun if used reflexively so you lose the boundary's availability benefit for genuinely-isolated failures. Both are tools for "I've decided continuing is unsafe" — the answer hinges on whether the candidate *reasons about state* or applies a rule blindly.

### Q: "This service should crash here." Convince me.

A senior candidate can *advocate* for a crash in a design review. Strong answer: "Continuing past this point runs on a broken invariant / corrupt state / a bug. A crash gives us a stack trace, a clean restart from known-good state via the supervisor, and a *visible* failure that gets fixed — versus a silent wrong answer that erodes trust and surfaces later somewhere unrelated. The blast radius is one supervised process; the alternative blast radius is corrupted data across the system." Bad sign: treating "crash" as always-bad or being unable to name the corruption being avoided.

### Q: What can you NOT recover from, in your language of choice, and why is that deliberate?

Reveals runtime depth. Go: fatal errors — concurrent map write, stack overflow, OOM, runtime-detected deadlock — bypass `recover` and terminate. Rust: a panic *during* unwinding aborts; under `panic = "abort"` nothing is catchable. The *why* is the key: the runtime deliberately refuses to let you paper over states where the program is unambiguously unsafe, because recovering into a corrupt map or an exhausted heap produces arbitrary wrong behavior. A candidate who thinks `recover()` catches *everything* has a dangerous mental model.

### Q: What's the worst panic-handling habit you've broken?

Self-aware answers: "reaching for `try/catch` to make a crash go away instead of asking *why* it panicked," "putting `recover()` in business logic," "treating 'the server stayed up' as 'the bug is fixed'," "`AssertUnwindSafe` everywhere to make the compiler stop complaining." The story of *why* it was wrong (a hidden data-corruption incident) is more revealing than the habit itself.

---

## Cheat Sheet

Top-10 must-know questions for any panic-and-recovery interview:

```
┌──────────────────────────────────────────────────────────────────────┐
│ MUST-KNOW PANIC & RECOVERY QUESTIONS                                 │
├──────────────────────────────────────────────────────────────────────┤
│  1. Panic vs error?                                                  │
│       → Error: expected, recoverable, a value you handle.            │
│       → Panic: bug / broken invariant, unwinds toward a crash.       │
│                                                                      │
│  2. When should a program crash?                                     │
│       → When continuing on broken state is less safe than stopping.  │
│       → Default: let it crash; recover only at the boundary.         │
│                                                                      │
│  3. Recover-at-boundary — what & where?                              │
│       → One recover per isolated unit (request/job), in infra.       │
│       → Catch, LOG (w/ stack), REPORT (metric+reporter), CONTAIN.    │
│                                                                      │
│  4. Availability or correctness — which does recovery buy?           │
│       → Availability. The bug is still there. You still owe a fix.   │
│                                                                      │
│  5. A goroutine panic killed the whole process despite middleware?   │
│       → recover catches only its OWN goroutine. Guard every spawn.   │
│                                                                      │
│  6. Recover per job or per worker?                                   │
│       → Per job, inside the loop. Per-loop recover kills the loop.   │
│                                                                      │
│  7. catch_unwind caveats (Rust)?                                     │
│       → Needs UnwindSafe; INERT under panic = "abort".               │
│                                                                      │
│  8. Poisoned lock?                                                   │
│       → Panic-while-holding-lock marks Rust Mutex poisoned;          │
│         next lock() = Err. Warns data may be corrupt. Go: re-panic.  │
│                                                                      │
│  9. Silent recover — why is it the worst outcome?                    │
│       → Bug hides behind a living server, corrupts data for weeks.   │
│       → If you won't log+report, don't recover.                      │
│                                                                      │
│ 10. Fail-fast vs resilience — opposites?                             │
│       → No. Fail fast at the component, recover at the boundary,     │
│         restart at the process (supervision). Use all three.         │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Further Reading

- **The Go Blog — "Defer, Panic, and Recover"** — <https://go.dev/blog/defer-panic-and-recover>. The canonical explanation of the three primitives.
- **Rust Book — "To panic! or Not to panic!"** — <https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html>. The Layer-1/Layer-2 decision in Rust terms.
- **Rust std — `std::panic::catch_unwind`** and **`UnwindSafe`** — <https://doc.rust-lang.org/std/panic/fn.catch_unwind.html>. Boundary recovery and the unwind-safety marker.
- **Joe Armstrong — "Making reliable distributed systems in the presence of software errors"** (Erlang thesis) — the origin of "let it crash" and supervision trees.
- **"Crash-Only Software"** — Candea & Fox, HotOS 2003 — <https://www.usenix.org/legacy/events/hotos03/tech/candea.html>. Why crashing and restarting beats clean shutdown.
- **Google SRE Book, Ch. 22 — "Addressing Cascading Failures"** — how local fail-fast and resilience interact at system scale.
- **Andrew Gerrand / Go team — error handling conventions** — when `panic` is and isn't idiomatic in Go (the `MustXxx` / parser patterns).
- **Akka docs — Fault Tolerance & Supervision** — supervision strategies (restart/resume/stop/escalate) made concrete.

---

## Related Topics

- [Panic & Recovery — Junior](junior.md) — the two-layer model, unwinding, `defer`/`recover` basics, when to crash.
- [Panic & Recovery — Middle](middle.md) — recover-at-boundary, per-worker isolation, goroutine panics, `catch_unwind`, never-swallow.
- [Panic & Recovery — Senior](senior.md) — fail-fast vs resilience, abort vs unwind, crash-only design, supervision, propagation across goroutines/threads/async.
- [Panic & Recovery — Professional](professional.md) — unwinding internals & cost, `panic = "abort"`, async-signal-safety, FFI/unwind UB, poisoned locks, resilient pools.
- [Panic & Recovery — Tasks](tasks.md)
- [Error Handling — Interview](../error-handling/interview.md) — the Layer-1 channel the boundary translates panics back into.
- [Crash Reporting — Interview](../crash-reporting/interview.md) — the "report" obligation: fingerprinting and deduping recovered panics.
- [Debugging — Interview](../debugging/interview.md) — reading the stack a recovered panic captured.
- [Logging — Interview](../logging/interview.md) — structured error-level logging for the "log" obligation.
