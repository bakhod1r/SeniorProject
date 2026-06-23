# Panic & Recovery — Professional (Staff / Principal) Level

> **Topic:** [Panic & Recovery Roadmap](README.md)
> **Focus:** The *machinery* and the *frontier*. How stack unwinding actually works (DWARF CFI, landing pads, two-phase EH) and what it costs; why `panic = "abort"` is sometimes the only correct choice in production; why a panic inside a signal handler is undefined behavior; why letting a panic cross an FFI boundary is UB and how the ABI fixed it; poisoned-lock *recovery* (not just detection); building worker pools that survive poison input; and the supervision-tree theory (OTP) that turns "let it crash" into a reliability property — applied to systems that have no actors.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Stack Unwinding Internals](#stack-unwinding-internals)
6. [The Cost of Unwinding — Measured](#the-cost-of-unwinding--measured)
7. [`panic = "abort"` vs Unwind in Production](#panic--abort-vs-unwind-in-production)
8. [Async-Signal-Safety and Panics in Signal Handlers](#async-signal-safety-and-panics-in-signal-handlers)
9. [Unwinding Across FFI — The UB and Its ABI Fix](#unwinding-across-ffi--the-ub-and-its-abi-fix)
10. [Poisoned Locks — Detection, Recovery, and Design-Around](#poisoned-locks--detection-recovery-and-design-around)
11. [Building Resilient Worker Pools](#building-resilient-worker-pools)
12. [Supervision-Tree Design — The OTP Lessons in Depth](#supervision-tree-design--the-otp-lessons-in-depth)
13. [Partial-Failure Containment](#partial-failure-containment)
14. [Designing the Failure Domain](#designing-the-failure-domain)
15. [Code Examples](#code-examples)
16. [Failure Stories From the Field](#failure-stories-from-the-field)
17. [A Worked Walk-through — A Pool That Ate Itself](#a-worked-walk-through--a-pool-that-ate-itself)
18. [Pros & Cons](#pros--cons)
19. [Use Cases](#use-cases)
20. [Coding Patterns](#coding-patterns)
21. [Clean Code](#clean-code)
22. [Best Practices](#best-practices)
23. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
24. [Common Mistakes](#common-mistakes)
25. [Tricky Points](#tricky-points)
26. [Anti-Patterns at Professional Level](#anti-patterns-at-professional-level)
27. [Test Yourself](#test-yourself)
28. [Tricky Questions](#tricky-questions)
29. [Cheat Sheet](#cheat-sheet)
30. [Summary](#summary)
31. [What You Can Build](#what-you-can-build)
32. [Further Reading](#further-reading)
33. [Related Topics](#related-topics)
34. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> 🎓 At the professional level, panic and recovery stop being about *your* code and start being about the *runtime's contract* with the hardware, the linker, and the operating system. The senior page taught you the policy — crash vs. recover, abort vs. unwind, supervision over in-place recovery. This page is about what is physically happening underneath those words, and the places where the abstraction is a lie you must not trust.

The senior decided *whether* to unwind. The staff engineer knows *how* unwinding works — that it is a second, separate execution engine reading DWARF call-frame information to walk the stack frame by frame, running cleanup landing pads, in a two-phase dance with a personality routine — and therefore knows precisely why a panic must never cross into a signal handler, a C frame, a `noexcept` boundary, or a half-mutated lock. These are not style preferences. They are points where the unwinder's assumptions break and the result is undefined behavior: silent corruption, a deadlocked process, or a crash whose stack is a lie.

This is the file where "it's undefined behavior" stops being a scary phrase repeated from a blog post and becomes a mechanism you can explain. Why is `panic!()` inside a `SIGSEGV` handler UB? Because the handler interrupted code that may hold the allocator lock, and the unwinder allocates. Why did letting a Rust panic unwind through a C frame corrupt the heap? Because the C frame has no DWARF cleanup information the unwinder knows how to honor, and the C++ `__cxa_throw` path it falls into doesn't match. Why does `panic = "abort"` produce a *faster* binary, not just a safer one? Because the compiler can delete every landing pad and every unwind table the moment it knows no frame will ever be unwound.

This page is also where the reliability theory gets concrete. "Let it crash + supervision" is the senior headline; here we open Erlang/OTP and read the actual semantics — `max_restarts`/`max_seconds` as a *Poisson failure detector*, the four restart strategies as encodings of state coupling, `transient`/`permanent`/`temporary` child specs, and what it means that a supervisor crash propagates upward as a *normal* event. Then we port those lessons to Go, Rust, Java, and Node — systems with no actor runtime — because the *theory* is portable even when the framework isn't.

> If `junior.md` is "a program should crash," `middle.md` is "recover at the one boundary," and `senior.md` is "set the crash-vs-recover *policy* for the service," then `professional.md` is "**know the machine well enough that the policy is provably correct, and design failure domains so that no single panic can take down more than it must.**"

---

## Prerequisites

- Full command of [`senior.md`](senior.md): the crash-vs-recover matrix, unwind vs. abort as a runtime policy, the panic-propagation matrix per runtime, lock poisoning basics, supervision as restart-from-clean, the written panic policy.
- You can read a stack trace and a disassembly, and you know what a calling convention, a stack frame, and a destructor/`defer`/`finally` actually compile to.
- You have operated a worker pool / consumer fleet in production and seen at least one of: a poison message, a `CrashLoopBackOff`, a wedged consumer, a thread-pool starvation.
- You understand the difference between a process, a thread, an OS signal, and an async task at the level of *what the kernel and runtime each guarantee*.
- Comfort with at least: the Rust panic runtime, the Go runtime's `panic`/`recover`/`fatal error` split, the JVM exception/`Error` tiers, POSIX signals, and one actor/supervision system (OTP, Akka) at least by vocabulary.
- Helpful: you have written FFI bindings (Rust↔C, JNI, cgo, N-API) and felt the unease at the boundary.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Unwinder** | The runtime component that walks the stack on a panic/exception, running cleanup code per frame. On Linux this is `libgcc_s` (`_Unwind_*`) or LLVM's `libunwind`. |
| **DWARF CFI** | Call Frame Information — DWARF debug-format tables (`.eh_frame`/`.eh_frame_hdr`) telling the unwinder how to restore registers and find the return address for each frame. |
| **Landing pad** | Compiler-emitted code at a call site that runs cleanup (destructors / `Drop` / `defer`) when an exception unwinds through that frame; reached via the **personality routine**. |
| **Personality routine** | A per-language function (`__gxx_personality_v0` for C++, `rust_eh_personality` for Rust) the unwinder calls at each frame to decide "does this frame catch or clean up?" |
| **Two-phase unwinding** | The Itanium C++ ABI model: **phase 1 (search)** walks the stack to find a handler *without running cleanup*; **phase 2 (cleanup)** walks again, running landing pads, then transfers to the handler. |
| **Zero-cost exceptions** | The "table-based" EH model where the *happy path* has no runtime cost — all the work is in side tables consulted only when an exception is actually thrown. The cost is paid only on throw. |
| **`panic = "abort"`** | Rust profile setting: a panic calls `abort()` (raises `SIGABRT`) immediately — no unwinding, no landing pads, no `catch_unwind`. Lets the compiler delete all unwind machinery. |
| **Async-signal-safe** | A function guaranteed safe to call from inside a signal handler (POSIX lists ~180 such functions). Anything that takes a lock or allocates is *not* on the list. |
| **`SIGABRT` / `abort()`** | The signal/call used for "die now, dump core." The canonical implementation of "abort." |
| **`extern "C-unwind"`** | (Rust 1.71+, RFC 2945) An ABI that *defines* unwinding across the FFI boundary, so a panic/exception may cross Rust↔C(++) safely. Plain `extern "C"` **aborts** on an unwind reaching the boundary. |
| **Poisoning** | (Rust) Marking a `Mutex`/`RwLock` as tainted when a thread panics while holding it, so later `lock()` returns `Err(PoisonError)`. |
| **Bulkhead** | A resilience pattern (from ship design): isolate resources into compartments so one flooded compartment can't sink the whole vessel. A dedicated thread pool per dependency is a bulkhead. |
| **Failure domain / blast radius** | The set of things that fail *together* when one thing fails. The central design variable of this page. |
| **Supervision tree** | (OTP) A hierarchy where workers are supervised by supervisors, which are themselves supervised, so failures propagate *up* to a unit whose only job is to restart. |
| **Child spec** | (OTP) The declaration of how a supervisor treats a child: `restart` = `permanent` \| `transient` \| `temporary`; `shutdown` timeout; `type`. |
| **Restart intensity** | (OTP) `max_restarts` within `max_seconds`. Exceed it and the *supervisor itself* terminates — the deterministic-failure circuit breaker. |
| **`spawn_link` / `monitor`** | (Erlang) Bidirectional failure propagation (`link`) vs. one-way death notification (`monitor`). The primitives supervision is built from. |
| **Poison message** | An input that *deterministically* crashes whatever processes it. The thing that turns "let it crash" into an infinite restart loop unless contained. |
| **Setjmp/longjmp** | The older, non-table-based unwinding mechanism (`sjlj`). Has happy-path cost (registers a handler at every entry); mostly historical, still seen on some embedded targets. |

---

## Core Concepts

### 1. Unwinding is a *separate execution engine*, not a `goto`

A `return` is a single instruction. An *unwind* is an interpreter: it reads DWARF tables to discover, for each frame, where the saved registers live and which cleanup code to run, calls a per-language personality routine to ask "do you catch here?", and only then transfers control. It is slow, it allocates, and it assumes every frame on the stack was compiled with matching unwind information. The whole professional-tier intuition flows from this one fact: **unwinding works only across frames that were built to be unwound through.** Cross into a frame that wasn't — a C function, a signal handler's interrupted code, a `noexcept` region — and the engine's assumptions are violated. That is the source of nearly every "it's UB" rule on this page.

### 2. The happy path is free; the throw is expensive — by design

Modern (Itanium ABI / "zero-cost") exception handling moves *all* cost to the moment of unwinding. A function that *might* panic but doesn't pays nothing at runtime for that possibility — no per-frame setup, no flag checks. The price is that when a panic *does* fire, the unwinder must consult side tables and walk the stack, costing microseconds-to-milliseconds. **This is why panics are the wrong tool for control flow at scale and the right tool for genuinely exceptional conditions:** you've optimized the no-throw path to zero and the throw path to expensive. Using panics for expected, frequent outcomes inverts the optimization the runtime made for you.

### 3. "Undefined behavior" here means a *concrete* mechanism breaks

At this level, "UB" is never hand-waving. Panic in a signal handler → the handler interrupted code mid-`malloc`, the unwinder calls `malloc`, the allocator lock is already held by the interrupted code → deadlock or corruption. Panic across `extern "C"` → the unwinder reaches a frame with no Rust personality routine / no cleanup table → it falls off the edge of what it knows. Each rule has a named, reproducible failure. A staff engineer can explain the mechanism, which is why they can predict the *new* cases the rules don't list.

### 4. `panic = "abort"` is a compiler optimization as much as a safety choice

Telling the compiler "no frame will ever be unwound" lets it delete landing pads, drop `.eh_frame` cleanup entries, and skip emitting the cleanup code paths entirely. The binary is smaller, the instruction cache is warmer, and the optimizer has fewer control-flow edges to reason around — so the *happy* path can be faster too. The cost is total: no `catch_unwind`, no per-thread/per-task isolation, no graceful destructor cleanup. Choosing abort is choosing a different machine, not just a different error policy.

### 5. Recovery from poisoning is a *correctness* decision the type system can only prompt, not make

Rust poisons a lock when a thread panics holding it — but `into_inner()` lets you take the data anyway. The hard part isn't detecting poison; it's deciding what the data *means* after a mid-mutation panic. The professional move is to make poisoning *impossible to ignore meaningfully* by designing the protected invariant so that "recover" has a defined answer: either the update is transactional (atomic swap → old value intact → safe to continue) or it isn't (→ the only correct recovery is to crash). Poisoning is a prompt; your data structure design is the actual answer.

### 6. A worker pool's reliability is decided by what it does with a *poison input*

Any pool will survive a transient, random failure — that's the easy case. The pool is *defined* by its behavior on the input that crashes every worker that touches it. Without containment, "let it crash" becomes "let it crash forever": the supervisor restarts a worker, it picks up the same poison message, crashes, restarts, crashes — a `CrashLoopBackOff` that also hammers every downstream the worker touches on startup. Resilient pools detect the deterministic crash (a restart budget, a per-message attempt counter) and *quarantine the input* (dead-letter), not the worker.

### 7. The unit of failure isolation is the thing you get to design

Process, thread, goroutine, async task, OS-isolated worker, separate container — each is a *failure domain* with a different blast radius and a different restart cost. Staff-level work is choosing the domain *deliberately* so that the worst-case panic takes down exactly what it must and no more. A poison-prone image decoder in its own subprocess can crash without touching the request handler. The same decoder inline in the handler's goroutine takes down the whole Go process. Same code, same panic — the difference is entirely the failure domain you placed it in.

---

## Stack Unwinding Internals

This is the machinery the senior page treated as a black box labeled "unwind." Opening it is what lets you reason about every UB rule below.

### The Itanium C++ ABI two-phase model (the de-facto standard everyone uses)

Despite the name, the **Itanium C++ ABI** exception model is what Rust, C++, and most native runtimes on Linux/macOS use today. A `throw`/`panic!` does **not** simply jump. It runs in two passes:

```text
   PHASE 1 — SEARCH (no cleanup runs yet)
   ──────────────────────────────────────
   _Unwind_RaiseException starts at the throwing frame and walks UP.
   At each frame it calls that frame's PERSONALITY ROUTINE, asking:
       "Do you have a HANDLER for this exception type?"
   It runs NOTHING — just searches. This is so the handler can be found
   BEFORE any destructors run (matters for std::terminate-on-no-handler).

   PHASE 2 — CLEANUP (destructors run now)
   ───────────────────────────────────────
   The unwinder walks UP AGAIN, from throw site to the found handler.
   At each frame the personality routine returns the LANDING PAD address.
   The unwinder restores registers per DWARF CFI, jumps to the landing pad,
   which runs that frame's destructors / Drop / defer, then resumes unwinding.
   At the handler frame it transfers control to the catch / recover.
```

Two phases exist so that "is there a handler at all?" is answered *before* the stack is torn down. In C++, if phase 1 finds no handler, `std::terminate` runs *with the stack intact* — useful for debugging. (Rust's `panic = "unwind"` is closer to "always has a catch at the thread boundary," but the same two-phase engine drives it.)

### DWARF CFI: how the unwinder finds the next frame

The unwinder doesn't know your stack layout a priori. It reads **DWARF Call Frame Information** from the `.eh_frame` / `.eh_frame_hdr` ELF sections (`__eh_frame` on Mach-O). For each program-counter range, the CFI is a tiny bytecode program describing: where the return address is relative to the canonical frame address (CFA), where each callee-saved register was spilled, and how to compute the caller's CFA. The unwinder *interprets* this to virtually "pop" a frame and reconstruct the caller's register state — without ever having run the caller's epilogue.

```text
   Frame on stack            DWARF CFI says
   ─────────────────         ─────────────────────────────────────────────
   [ locals ]                CFA = rsp + 48
   [ saved rbp ]             rbp saved at CFA-16
   [ return address ] ◄───── return addr at CFA-8  → that's the caller's PC
   [ caller's frame ]        ...repeat with caller's PC to find ITS CFI
```

**Why this matters for UB:** if a frame has *no* CFI (hand-written assembly without `.cfi_*` directives, a JIT region with no registered unwind info, or — critically — a C frame the personality routine doesn't understand), the unwinder cannot reconstruct the caller and the unwind either aborts or, worse, walks into garbage.

### The personality routine and the LSDA

At each frame, the unwinder calls the frame's **personality routine** (`rust_eh_personality`, `__gxx_personality_v0`). The personality routine reads the frame's **LSDA** (Language-Specific Data Area, in `.gcc_except_table`) — a table mapping call-site PC ranges to landing-pad addresses and to which exception types are caught there. This is the indirection that lets C++ `catch (FooException&)` match a type, and lets Rust find the cleanup code for each `Drop`. **A C function compiled with a plain C compiler has no meaningful LSDA for a Rust panic** — which is the heart of the FFI UB.

### Setjmp/longjmp unwinding (the old way, still lurking)

Before table-based EH, compilers used **SjLj** (setjmp/longjmp) unwinding: every frame that needs cleanup registers itself in a thread-local linked list on entry and unregisters on exit. This has *happy-path cost* (the register/unregister on every call), which is exactly what zero-cost EH was invented to remove. You still meet SjLj on some embedded/bare-metal targets and very old toolchains. The practical takeaway: if your platform uses SjLj, "panics are free unless thrown" is *false* — you pay on every guarded call.

### Go does not use this machinery — and that's why goroutines detonate

Go's `panic`/`recover` is **not** DWARF/Itanium unwinding. The Go runtime walks its *own* `defer` chain (a linked list of `_defer` records hung off the goroutine's `g`), running deferred functions, checking each for a `recover()`. It's a runtime-managed mechanism, not a compiler-emitted landing-pad scheme. This is *why* a goroutine panic that isn't recovered calls `fatalpanic` → `exit(2)`: there is no concept of "unwind into the parent goroutine," because the `defer` chain belongs to *one* goroutine and ends at that goroutine's entry. The runtime made a deliberate choice not to build cross-goroutine unwinding — so an unrecovered goroutine panic has nowhere to go but process death.

```text
   NATIVE (Rust/C++)                      GO
   ─────────────────                      ──
   compiler emits landing pads;           runtime maintains a per-goroutine
   unwinder reads DWARF CFI +             _defer linked list; gopanic walks it,
   personality + LSDA per frame           runs deferred fns, looks for recover();
   → cross-thread: thread dies,           no recover by goroutine end → fatalpanic
     join() gets the payload              → exit(2): WHOLE PROCESS
```

---

## The Cost of Unwinding — Measured

"Panics are slow" is true but unhelpful. Here is the shape of the cost, why it has that shape, and the number that actually matters.

### Where the time goes

| Phase | Work | Order of magnitude |
|---|---|---|
| Raise | Allocate the exception object / panic payload | ~allocation cost (can be hundreds of ns) |
| Phase 1 search | Walk every frame to the handler, call personality routines | O(stack depth) — µs for deep stacks |
| DWARF CFI interpretation | Interpret CFI bytecode per frame | the dominant cost; cold tables → cache misses |
| Phase 2 cleanup | Run each landing pad (destructors / `Drop` / `defer`) | depends on what's being dropped |
| Backtrace capture | Symbolize the stack (if `RUST_BACKTRACE`, `debug.Stack()`, exception `fillInStackTrace`) | **often the single biggest cost** — can be ms |

The headline: an unwind through a deep stack with backtrace capture is **microseconds to low milliseconds** — roughly **1,000–100,000× a function return**. A bare `panic` without backtrace and a shallow stack is far cheaper, but still orders of magnitude above a normal return.

### The cost nobody measures: backtrace capture

In the JVM, the expensive part of an exception is `fillInStackTrace()`, which walks and captures the stack at construction. This is why hot-path "exceptions as control flow" code sometimes overrides it:

```java
// A control-flow signal exception that SKIPS stack capture — orders of
// magnitude cheaper. Only legitimate when you truly use exceptions as a
// (rare, but not catastrophic) signaling mechanism and never need the trace.
public final class StopIteration extends RuntimeException {
    public static final StopIteration INSTANCE = new StopIteration();
    private StopIteration() {
        super(null, null, /*enableSuppression*/ false, /*writableStackTrace*/ false);
    }
    // No fillInStackTrace cost; can even be a reusable singleton.
}
```

> The senior lesson restated with numbers: the cost asymmetry (free no-throw, expensive throw) is *intentional*. If you find yourself optimizing panic/exception throughput, you are almost always using the wrong mechanism — the runtime optimized for you under the assumption that throws are rare. Move the frequent case to `Result`/`error`/a sentinel return.

### The second-order cost: optimization barriers

A `try`/landing-pad region is a control-flow edge the optimizer must respect. Code that *can* unwind sometimes inhibits inlining and reordering across the potential-throw point. This is part of why `panic = "abort"` can speed up the *happy* path: removing the unwind edges gives the optimizer more freedom. The effect is usually small, but on hot, tight code it's measurable — and it's a reason performance-critical Rust crates sometimes ship `abort`-only.

---

## `panic = "abort"` vs Unwind in Production

The senior page framed this as a policy choice. Here is the production-grade decision, with the operational consequences the senior framing skipped.

### What actually changes in the binary

```toml
# Cargo.toml
[profile.release]
panic = "abort"
```

Under `abort`, the compiler:

- **Deletes landing pads** and the cleanup code they pointed to.
- **Shrinks `.eh_frame`** (no cleanup CFI needed for unwinding, only for debugging backtraces).
- **Makes `catch_unwind` a no-op** — it compiles, runs the closure, and can never return `Err` for a panic (the panic aborts before returning).
- **Skips `Drop` on panic** — destructors do *not* run on the way down. A `Drop` that flushes a buffer, releases an OS resource, or commits a transaction **will not run** when the process aborts.

That last point is the one teams forget: under `abort`, **RAII cleanup does not happen on panic.** If your design relied on a guard's `Drop` to unlock something external (a file lock, a distributed lock, a "I am the leader" lease), that cleanup is skipped. Usually fine (the process is dying and the OS reclaims most things; leases should have TTLs), but it must be a *known* property, not a surprise.

### The production decision table

| Situation | Choose | Why |
|---|---|---|
| Stateless leaf service, cheap restart, k8s-managed | `abort` | Smaller/faster binary; "corrupt → dead" guarantee; restart is free anyway |
| Security-/correctness-critical (crypto, payments core) | `abort` | A panic means a broken invariant; you want it *dead*, not caught and limped along |
| Heavy C/C++ FFI, no `C-unwind` audit done | `abort` | Never reason about unwinding across the boundary; abort sidesteps the UB entirely |
| In-process worker pool relying on `catch_unwind` for per-job isolation | `unwind` (**required**) | `abort` makes the first panicking job kill the whole pool |
| A library crate | **neither — be correct under both** | The final binary chooses; assuming `abort` and skipping cleanup is a latent bug for downstream `unwind` users |
| A test harness / fuzzer that must survive target panics | `unwind` | `catch_unwind` is the isolation mechanism; abort defeats it |

> **The trap that has shipped to production more than once:** a perf-minded engineer sets `panic = "abort"` for a smaller binary; six months later a *different* engineer adds a `catch_unwind`-based worker pool for "resilience." It compiles. It passes tests (no panics in tests). In production the first malformed request panics one job and **the entire process aborts**, taking down every in-flight request on that instance. The fix is organizational: the panic strategy must be a *documented, reviewed* property, with a comment in `Cargo.toml` stating which design depends on it.

### Other runtimes' equivalent of "abort"

| Runtime | "Abort-class" failure | Recoverable? |
|---|---|---|
| Go | `fatal error:` (concurrent map write, stack overflow, OOM, deadlock) | **No** — `recover()` never catches these |
| Java | `Error` (`OutOfMemoryError`, `StackOverflowError`, `LinkageError`) | Technically catchable, but the JVM may be doomed — treat as abort-class |
| Python | `Fatal Python error:` (interpreter-level), `MemoryError` past a point, a C-extension segfault | Interpreter-fatal ones: no; segfaults: not a Python exception at all |
| Node | post-`uncaughtException` undefined state; `--abort-on-uncaught-exception` flag | The flag literally makes it `abort()` + core dump instead of graceful exit |

Node's `--abort-on-uncaught-exception` is worth knowing: it converts an uncaught exception from "graceful `process.exit`" into a hard `abort()` that **produces a core dump** — the deliberate trade of graceful death for a debuggable corpse. The same trade as Go's `GOTRACEBACK=crash`.

---

## Async-Signal-Safety and Panics in Signal Handlers

This is the most subtle UB on the page and the one that bites hardest in native code. **You must not panic (or throw, or do almost anything) inside a signal handler.**

### Why a signal handler is a hostile execution context

A signal can interrupt your program at *any* instruction — including the middle of `malloc`, in the middle of taking a lock, mid-way through updating a data structure's invariant. The handler then runs *on the same thread*, on top of that interrupted state. POSIX defines a short list (~180) of **async-signal-safe** functions you may call from a handler. The list is short for one reason: anything that **takes a lock or allocates** is unsafe, because the interrupted code may already hold that lock or be mid-allocation.

```text
   Thread is here:  malloc() ──holds allocator lock──► [building free list]
                                      ▲
                              SIGSEGV fires HERE
                                      │
                              handler runs on SAME thread
                                      │
                       handler calls something that calls malloc()
                                      │
                       malloc() tries to take the allocator lock...
                                      │
                       ...which THIS THREAD already holds  → DEADLOCK
```

### Why `panic!()` in a handler is specifically UB

A `panic!` in Rust (or a `throw` in C++) **allocates** the panic payload and **unwinds**, which runs the personality routine and may allocate a backtrace. Both allocate; both may take locks. Inside a signal handler interrupting allocator code, that is the deadlock above — or worse, the unwinder tries to unwind *through the signal frame*, which the OS pushed onto the stack with a layout the DWARF CFI doesn't describe the way the unwinder expects. The result is undefined: a hang, a corrupted unwind, or a crash whose backtrace is fiction.

### What you actually do in a handler

The only safe pattern: the handler does the *minimum* async-signal-safe work — write a byte to a self-pipe, or set a `volatile sig_atomic_t` flag — and a *normal* thread does the real work later.

```rust
// Signal-safe handler: set a flag (async-signal-safe), do NOTHING else.
use std::sync::atomic::{AtomicBool, Ordering};
static SHUTDOWN: AtomicBool = AtomicBool::new(false);

extern "C" fn handle_sigterm(_sig: i32) {
    // Storing to an AtomicBool with Relaxed is async-signal-safe.
    // NO allocation, NO locking, NO panic!, NO println! (that locks stdout).
    SHUTDOWN.store(true, Ordering::SeqCst);
}

// A normal thread polls the flag and does the real, panic-allowed work.
fn main_loop() {
    while !SHUTDOWN.load(Ordering::SeqCst) {
        // ... work; here panics are fine because we are NOT in a handler ...
    }
    graceful_shutdown(); // may allocate, lock, log — safe out here
}
```

The idiomatic high-level wrappers all do exactly this under the hood: Go's `signal.NotifyContext` and `signal.Notify` deliver signals as **values on a channel** consumed by a normal goroutine; Tokio's `signal::unix::signal` turns a signal into an async stream; Node delivers `process.on('SIGTERM')` as a normal event-loop callback. **They convert "interrupt context" into "normal context" before any real work runs.** That conversion is the whole point.

### The crash-handler exception (and how it's done safely)

Crash reporters (Breakpad, Crashpad, Sentry's native handler) *do* run inside fatal-signal handlers (`SIGSEGV`, `SIGABRT`) — because that's the only place to capture the crash. They survive by being **brutally minimal and async-signal-safe**: they often capture state into a pre-allocated buffer, or `fork()` a fresh process to do the unwinding and symbolication *outside* the corrupted address space. They never allocate or lock in the handler. If you ever write a crash handler, you copy this discipline exactly — see [Crash Reporting — Professional](../crash-reporting/professional.md) for the full treatment.

> The portable rule, even in managed languages: **a signal handler / interrupt context is not normal code.** Set a flag, signal a pipe, and get out. Anything else — log, allocate, lock, panic — is a latent deadlock waiting for the wrong instant.

---

## Unwinding Across FFI — The UB and Its ABI Fix

The senior page named this as "historically UB." Here is *why*, and the precise ABI change that fixed it.

### Why it was UB

Consider Rust calling C, and the C code calling a Rust callback that panics:

```text
   Rust frame  ──calls──►  C frame  ──calls──►  Rust callback  ── panic! ──┐
   (has LSDA,               (NO Rust            (wants to unwind)          │
    personality)            personality,                                  │
                            no Rust LSDA)  ◄── unwinder reaches HERE ──────┘
```

The panic unwinds out of the Rust callback and reaches the **C frame**. The C frame was compiled by a C compiler: its DWARF CFI describes the stack layout, but it has **no Rust personality routine** and **no LSDA describing Rust `Drop` cleanups**. The unwinder doesn't know how to honor that frame. Historically the behavior was *undefined*: on some toolchains it happened to limp through (because Rust's unwinder and the C++ unwinder share `libgcc`), on others it corrupted the stack, on others it aborted. "Happens to work in dev, corrupts the heap in prod under a different compiler version" is the worst kind of bug, and this produced it.

### The fix: `extern "C"` aborts, `extern "C-unwind"` defines

[RFC 2945](https://rust-lang.github.io/rfcs/2945-c-unwind-abi.html) (stable since Rust 1.71) made the ABI explicit:

| ABI | What happens when an unwind reaches the boundary |
|---|---|
| `extern "C"` (default) | **Forced abort.** A panic that tries to unwind out of an `extern "C"` function aborts the process. *Safe by default* — no UB, just death. |
| `extern "C-unwind"` | **Defined unwinding.** A panic/foreign exception *may* cross the boundary, with specified semantics. Use when you genuinely need exceptions to propagate across the FFI edge (e.g. a C++ exception through Rust, or a Rust panic a C++ caller will catch). |

```rust
// SAFE default: if `dangerous` panics, the unwind hits the extern "C"
// boundary and ABORTS — no UB, deterministic death. This is what you want
// 95% of the time: catch the panic INSIDE and return an error code.
#[no_mangle]
pub extern "C" fn ffi_process(input: *const u8, len: usize) -> i32 {
    let result = std::panic::catch_unwind(|| {
        // ... real work that might panic ...
        do_work(input, len)
    });
    match result {
        Ok(code) => code,          // normal path: return a C-friendly status
        Err(_) => -1,              // panic CAUGHT here, never reaches the boundary
    }
}

// DELIBERATE cross-boundary unwinding: only when a C++ caller is set up to
// catch, and you've audited that every intervening frame is C-unwind-aware.
#[no_mangle]
pub extern "C-unwind" fn ffi_may_unwind() {
    might_panic(); // a panic here is DEFINED to unwind across the boundary
}
```

### The professional discipline at every FFI edge

1. **Default to catching at the boundary.** Wrap the body in `catch_unwind`, translate a caught panic into an error *code* the foreign side understands. The panic never crosses.
2. **If you must cross, use `extern "C-unwind"`** *and* document that every frame in between is unwind-aware. C frames in the middle still won't run cleanup — there is none to run, but resources they own may leak.
3. **The same rule exists in every FFI system, not just Rust:**
   - **cgo:** a Go panic must not escape into C; recover at the cgo boundary. C `longjmp` through Go is undefined.
   - **JNI:** a Java exception left "pending" when you return to C is checked only at the next JNI call; a C++ exception must never propagate into the JVM. Always `ExceptionCheck`/`ExceptionClear` at the boundary.
   - **Node N-API:** a C++ exception must be converted to a JS exception (`napi_throw`) before returning; never let it unwind into V8.
   - **Python C extensions:** a C++ exception or a `longjmp` through the CPython interpreter is UB; convert to a Python exception (`PyErr_SetString`) and return `NULL`.

> The unifying principle: **an unwinding mechanism is valid only within the language that emitted the frames it walks.** Every FFI boundary is a language change, therefore an unwinding-mechanism change, therefore a place you must *stop* the unwind and re-encode the failure in the other language's error vocabulary.

---

## Poisoned Locks — Detection, Recovery, and Design-Around

The senior page covered detection (Rust poisons locks). The professional question is **recovery**: once you *know* a lock is poisoned, what do you actually do — and how do you design so the question rarely arises?

### The three legitimate responses to a poisoned lock

```rust
use std::sync::Mutex;
let m: Mutex<State> = Mutex::new(State::new());

match m.lock() {
    Ok(guard) => { /* normal */ }
    Err(poisoned) => {
        // A thread panicked while holding this lock. State MAY be inconsistent.
        // You have exactly three honest options:

        // OPTION A — PROPAGATE: the data is untrustworthy; refuse to continue.
        // Re-panic or return an error up to a supervisor that restarts clean.
        return Err(Error::CorruptState);

        // OPTION B — RECOVER THE DATA, having PROVEN it's still valid.
        // Only legitimate if the protected invariant can't be half-broken
        // (e.g. the panic happened before any mutation, or the update is
        // a single atomic field write). You are ASSERTING consistency.
        // let guard = poisoned.into_inner();

        // OPTION C — REPAIR: re-establish the invariant explicitly, then use.
        // let mut guard = poisoned.into_inner();
        // guard.repair();   // e.g. rebuild a derived index from durable state
    }
}
```

The cardinal sin is the *fourth*, illegitimate option: `poisoned.into_inner()` on autopilot, everywhere, without thinking — which is what most code does, reintroducing the exact corruption poisoning exists to flag. (This is precisely the criticism behind `parking_lot::Mutex`, which doesn't poison; the counter-view is that no-poison just makes the dangerous default *silent*.)

### Designing so poisoning can't matter

The deepest move is to make the protected region *un-poisonable in effect* — design the critical section so a panic mid-way leaves no observable half-state:

```rust
// BAD: multi-step mutation under the lock. A panic between the two writes
// leaves balance and ledger inconsistent — genuinely poisoned state.
fn apply_bad(m: &Mutex<Account>, tx: Tx) {
    let mut a = m.lock().unwrap();
    a.balance += tx.amount;          // (1)
    a.ledger.push(tx);               // (2) panic between (1) and (2) → inconsistent
}

// GOOD: build the next value fully OUTSIDE the lock (where a panic harms
// nothing shared), then publish it with a SINGLE move under the lock.
// A panic during construction never touches shared state; the swap is atomic.
fn apply_good(m: &Mutex<Account>, tx: Tx) -> Result<(), TxError> {
    let next = {
        let a = m.lock().unwrap();
        a.with_applied(tx)?          // returns a NEW Account; may fail/ panic safely
    };                               // lock released; `next` is a fully-valid value
    *m.lock().unwrap() = next;       // single assignment: no observable half-state
    Ok(())
}
```

Under this design, the only mutation under the lock is one move; there is no "half-applied" state to poison. Combine with `arc-swap` / `RwLock`-of-`Arc` for read-mostly state and the poison question disappears entirely.

### Manual poisoning in languages without it

Go, Java, Python, Node have **no** automatic poisoning. You implement it as a discipline: detect a panic mid-critical-section and *crash rather than continue*.

```go
// Manual poisoning: a panic mid-mutation under the lock crashes the process
// rather than continuing on a possibly-corrupt structure. This is what Rust's
// poisoning would FORCE; in Go you must choose it.
func (s *Store) Apply(tx Tx) {
    s.mu.Lock()
    defer s.mu.Unlock()
    defer func() {
        if rec := recover(); rec != nil {
            slog.Error("panic mid-mutation; state may be corrupt; aborting",
                "panic", rec, "stack", string(debug.Stack()))
            report.Capture(rec, debug.Stack(), tx)
            // Do NOT swallow: the supervisor / k8s restarts us with clean state.
            os.Exit(2) // or re-panic to a process-level handler that exits
        }
    }()
    s.balance += tx.Amount        // a panic between these lines is the danger
    s.ledger = append(s.ledger, tx)
}
```

> The professional position: **poisoning is not a Rust feature, it's a correctness obligation every language has.** Rust automates the *prompt*; you owe the *answer* everywhere. And the best answer is usually a data-structure design where the question is moot — atomic publish, copy-on-write, transactional update — because human "is this still consistent?" judgment under incident pressure is exactly what you don't want on the critical path.

---

## Building Resilient Worker Pools

A worker pool is where every concept on this page meets reality: isolation domain, panic propagation, poison input, restart budget, backpressure. Here is what a *resilient* one actually requires — beyond the senior page's `Supervise` sketch.

### The five properties of a resilient pool

| Property | What it means | Failure if missing |
|---|---|---|
| **Per-job isolation** | One job's panic must not kill the pool or sibling jobs | One bad input → whole pool down |
| **Poison-input quarantine** | A job that crashes N times is dead-lettered, not retried forever | `CrashLoopBackOff`; downstream hammering |
| **Bounded restart** | The pool/worker restart rate is capped; exceeding it escalates | Restart storm masks a deterministic bug |
| **Backpressure** | The pool signals "full" upstream instead of unbounded queueing | OOM from an unbounded in-memory queue |
| **Drain on shutdown** | In-flight jobs finish (or are re-queued) before exit | Lost work; at-most-once where you needed at-least-once |

Most "resilient" pools have the first and forget the other four. The third and fourth are what separate "survives a demo" from "survives a Monday-morning traffic spike with a poison message in the queue."

### The attempt-counter pattern (poison quarantine)

The single most important addition over the senior sketch: **track attempts per message, not per worker.** A restart budget on the *worker* catches the storm; an attempt counter on the *message* identifies the *poison*.

```go
type Job struct {
    Payload  []byte
    Attempts int
}

const maxAttempts = 3

func (p *Pool) handle(j Job) {
    defer func() {
        if rec := recover(); rec != nil {
            j.Attempts++
            slog.Error("job panicked", "attempts", j.Attempts, "panic", rec,
                "stack", string(debug.Stack()))
            report.Capture(rec, debug.Stack(), j)
            metrics.JobPanics.Inc()

            if j.Attempts >= maxAttempts {
                // DETERMINISTIC failure: this input is POISON. Quarantine it
                // instead of letting it crash workers forever.
                p.deadLetter(j)               // out-of-band: a DLQ, an alert
                metrics.JobDeadLettered.Inc()
                return
            }
            p.requeue(j)                       // transient: give it one more go
        }
    }()
    p.process(j) // a panic here is caught above; the WORKER survives
}
```

This is the lesson that turns "let it crash" from a footgun into a property: **distinguish transient failure (retry helps) from deterministic failure (retry is futile), and quarantine the latter.** Kafka consumers do this with a dead-letter topic; SQS does it with a redrive policy and `maxReceiveCount`; Temporal does it with activity retry policies and non-retryable error types. The pattern is universal.

### Isolation domain selection for a pool

The most consequential design choice is *what* you isolate jobs into. Ordered by blast radius:

| Domain | Isolation strength | Cost | When |
|---|---|---|---|
| Goroutine + `recover` (Go) | Weak — a `fatal error` (concurrent map write) still kills all | Cheapest | Pure-Go work, no unsafe/cgo |
| Thread + `catch_unwind` (Rust) / `UncaughtExceptionHandler` (Java) | Strong for panics; OS-level memory corruption still shared | Cheap | Most CPU work |
| `worker_thread` (Node) / separate thread w/ own heap | Strong; isolates JS-level crashes | Moderate | Node CPU-bound or crash-prone work |
| **Subprocess** (separate address space) | Strongest in-host: a segfault, an OOM, native corruption stays contained | Higher (IPC, spawn cost) | Untrusted input, native decoders, anything that can corrupt memory |
| Separate container / pod | Strongest; also isolates resource limits, kernel state | Highest | Multi-tenant, hostile input, hard resource caps |

The rule: **isolate at the level that contains your *worst* failure, not your typical one.** If a job can segfault a native library (image/PDF/font parsing is the classic), a goroutine `recover` is useless — a segfault isn't a Go panic, it's `SIGSEGV` that kills the process. You need a *subprocess* so the OS contains it. Chrome renders each site in a separate process for exactly this reason; so does any serious media-processing pipeline (ImageMagick policy + subprocess sandbox after the ImageTragick CVEs).

---

## Supervision-Tree Design — The OTP Lessons in Depth

The senior page named the OTP strategies. Here is the *theory* that makes supervision a reliability property, and how to port it to runtimes with no actors.

### `max_restarts` / `max_seconds` is a failure detector, not a retry limit

The deep insight in OTP's restart intensity: it's a **statistical failure classifier.** Transient failures are roughly Poisson-distributed (independent, low-rate); deterministic failures cluster (the same poison message, the same broken dependency, immediately, repeatedly). `max_restarts` within `max_seconds` draws a line: a crash rate *below* the threshold looks transient (restart helps); a rate *above* it looks deterministic (restart is futile). When the rate exceeds the threshold, the supervisor doesn't just stop — **it crashes itself, escalating to *its* supervisor**, which may apply a different (slower, wider) strategy or alert a human.

```text
   crashes/sec
        │
   high │  ╳╳╳╳        ← deterministic failure: clusters above threshold
        │  ╳╳╳╳            → supervisor gives up, escalates UP
  ──────┼───────── max_restarts/max_seconds threshold
        │   ╳   ╳  ╳    ← transient failure: sparse, below threshold
    low │ ╳    ╳    ╳       → restart-from-clean works, keep going
        └──────────────► time
```

This is the same idea as a circuit breaker, but *recursive*: each layer of the tree is a breaker whose tripping is itself an event the layer above handles. That recursion is what makes a deep supervision tree *stable* — failures are absorbed at the lowest layer that can handle them and only escalate when they can't.

### The restart strategies encode state coupling

The four strategies aren't arbitrary; each is the correct choice for a specific *coupling* between children:

| Strategy | Restart… | Encodes the fact that… |
|---|---|---|
| `one_for_one` | only the crashed child | children are **independent** — one's death says nothing about the others |
| `one_for_all` | **all** children | children share **coupled state** — one's death invalidates the siblings' assumptions |
| `rest_for_one` | the crashed child + all started **after** it | children form a **dependency chain** — later ones depend on earlier ones |
| `simple_one_for_one` / `DynamicSupervisor` | dynamically-added identical children | a **pool** of interchangeable workers |

So the strategy choice *is* a declaration of your architecture's coupling. If you can't decide between `one_for_one` and `one_for_all`, you don't yet understand whether your children share state — and that confusion is itself the bug to fix.

### Child specs: `permanent`, `transient`, `temporary`

OTP's `restart` field on each child says *when* to restart it:

- **`permanent`** — always restart (a long-running server that should never stay down).
- **`transient`** — restart only if it terminated *abnormally* (a crash), not on a normal exit (a one-shot job that succeeded and exited cleanly should stay exited).
- **`temporary`** — never restart (fire-and-forget; its death is not the supervisor's concern).

This vocabulary is missing from most ad-hoc supervisors and it matters: a worker that *finished its job and exited 0* should not be restarted (that's `transient`), but most home-grown `for { restart() }` loops restart it anyway, busy-looping. Encode the distinction.

### Links vs. monitors — the primitives

Supervision is built from two lower primitives every distributed-systems engineer should know:

- **`link`** — *bidirectional*. If A is linked to B and B crashes, A receives an exit signal (and by default crashes too, propagating the failure). Supervisors `link` to children so a child crash is *delivered* to the supervisor.
- **`monitor`** — *unidirectional*. A monitors B; if B dies, A gets a message but is *not* itself affected. Used for "tell me if this dies, but its death is not my death."

The senior takeaway is the distinction's purpose: **`link` is for "we live and die together" (a supervisor and its child, or a request and the goroutines it owns); `monitor` is for "notify me, but I'm independent" (a watcher, a health-checker).** Choosing wrong gives you either failures that don't propagate when they should, or a death that cascades when it shouldn't.

### Porting the tree to Go / Rust / Java / Node

You don't have actors, but you have the *shape*:

| OTP concept | Go | Rust | Java | Node |
|---|---|---|---|---|
| Worker | goroutine | task/thread | thread / virtual thread | `worker_thread` / child process |
| Supervisor | a goroutine running a `Supervise` loop | a task owning a `JoinSet`, restarting on `JoinError` | `ThreadPoolExecutor` + `afterExecute` re-submit | a manager watching `'exit'`/`'error'` events |
| `link` (crash propagates up) | `errgroup` (first error cancels ctx) | `JoinSet` (drop cancels siblings) | `CompletableFuture.allOf` short-circuit | `AbortController` fan-out |
| `max_restarts` | restart budget window (senior sketch) | same | a backoff + circuit counter | exponential backoff + cap |
| Tree (escalation) | supervisors returning errors to parent supervisors | nested `JoinSet`s | nested executors | nested managers |
| `one_for_all` | cancel the shared `context` so all siblings stop | cancel the parent token | shutdown the executor | `abortController.abort()` |

The k8s manifest is the *outermost* supervisor in all of them: the liveness probe is `link` (failure → kill), `restartPolicy` is the child spec, and `CrashLoopBackOff` is `max_restarts` exceeded. **Your in-process supervision tree should escalate cleanly into the k8s one** — when your top-level supervisor gives up, it exits non-zero, and k8s (the supervisor of supervisors) takes over with its own budget and its own alert.

---

## Partial-Failure Containment

The whole point of failure domains is **partial failure**: when something breaks, the *minimum* breaks. Here are the patterns that bound the blast radius.

### Bulkheads — isolate the resource, not just the code

A retry/circuit-breaker protects against a *slow* dependency. A **bulkhead** protects against a slow dependency *exhausting a shared resource* (threads, connections, memory) that healthy paths also need. Give each dependency its *own* pool:

```text
   NO BULKHEAD                          BULKHEAD
   ───────────                          ────────
   one shared thread pool (size 50)     pool-A (20) for service A
        │  │  │  │                       pool-B (20) for service B
   A    A  B  B  C   ← service A         pool-C (10) for service C
   slows; its calls hold all 50
   threads; B and C STARVE.             A slows; it exhausts pool-A only.
   ENTIRE service is down.              B and C keep serving. PARTIAL failure.
```

Hystrix made this famous (a thread pool per downstream); resilience4j's `Bulkhead`, Envoy's per-upstream connection pools, and a database connection pool *per* logical workload are all bulkheads. The principle: **a shared resource is a shared failure domain.** Splitting the resource splits the failure.

### Graceful degradation — fail the feature, not the request

When a non-critical dependency fails, the request should *degrade*, not *die*. The recommendations panel can't load → render the page without it. The personalization service is down → serve the generic ranking. This requires the failure to be *contained as a value* (a `Result`/`error`/fallback), not propagated as a panic.

```go
// Degrade, don't detonate: a failing optional dependency yields a fallback,
// not a 500. The recover here is for a genuinely panicking call we don't trust.
func recommendations(ctx context.Context, userID string) []Item {
    items, err := safeCall(ctx, func() ([]Item, error) {
        return recoClient.Get(ctx, userID) // may fail OR panic
    })
    if err != nil {
        metrics.RecoDegraded.Inc()
        return popularItemsFallback(ctx) // degrade: generic, but the page renders
    }
    return items
}
```

### Timeouts and deadlines are containment

A missing timeout is an unbounded failure domain: one stuck downstream call holds a goroutine/thread/connection *forever*, and enough of them starve the whole service. **Every** cross-boundary call (network, disk, IPC, lock acquisition with contention) needs a deadline. A deadline converts "hang forever" (unbounded blast radius) into "fail this one call after N ms" (contained). This is so fundamental that Go threads `context.Context` through every call and gRPC bakes deadlines into the protocol.

### Idempotency makes crash-during-work safe

Crash-only and supervision both *replay* work after a restart. That replay is only safe if operations are **idempotent** — safe to apply twice. An idempotency key on every mutating operation means "the worker crashed mid-charge and the supervisor re-ran the job" doesn't double-charge the customer. Without idempotency, every restart is a correctness risk, and "let it crash" silently becomes "let it double-process." Idempotency is the *precondition* that makes the whole supervision/crash-only edifice safe.

---

## Designing the Failure Domain

Bringing it together: the staff deliverable is a deliberate **failure-domain map** for the system — what fails together, what's isolated, and where the boundaries are.

```text
   ┌───────────────────── FAILURE-DOMAIN MAP: media-service ─────────────────────┐
   │                                                                             │
   │  REQUEST HANDLER (goroutine)         ── recover boundary: one bad request    │
   │      │                                  → 500, server lives                  │
   │      ├── thumbnail decode  ──────────── SUBPROCESS (sandboxed)               │
   │      │     (untrusted image → can      → a segfault dies in the child,       │
   │      │      segfault libjpeg)            handler gets an error, NOT a crash   │
   │      │                                                                       │
   │      ├── metadata DB        ──────────── BULKHEAD: own conn pool (size 20)    │
   │      │                                  → DB slow ⇒ this pool starves only    │
   │      │                                                                       │
   │      └── recommendations    ──────────── DEGRADE: timeout 50ms → fallback     │
   │            (optional)                    → reco down ⇒ page still renders      │
   │                                                                             │
   │  WORKER POOL (transcode)             ── per-job recover + attempt counter     │
   │      │                                  → poison video dead-lettered at N=3   │
   │      └── supervised: max 5 crashes/30s → escalate → process exit → k8s        │
   │                                                                             │
   │  PROCESS                             ── panic policy: stateless ⇒ crash-only  │
   │      │                                  GOTRACEBACK=crash (core dump)         │
   │      └── k8s liveness probe          ── OUTERMOST SUPERVISOR                  │
   │            restartPolicy + backoff      → CrashLoopBackOff alert → on-call    │
   │                                                                             │
   │  RULE: isolate at the level that contains the WORST failure of each unit.    │
   │  Untrusted/native → subprocess. Shared resource → bulkhead. Optional → degrade.│
   └─────────────────────────────────────────────────────────────────────────────┘
```

The map is reviewed like an architecture diagram. The question for every node is: *"when this fails in the worst way it can, what else goes down with it — and is that acceptable?"* If a single panic in an optional, untrusted thumbnail decoder can take down the whole request handler, the domain is wrong, and you fix it by *moving the boundary*, not by adding more `recover`.

---

## Code Examples

### Rust — an FFI-safe, panic-catching boundary with a worker pool that depends on `unwind`

```rust
//! A native library exposing a C ABI, internally running a panic-isolating
//! worker pool. The two facts that MUST agree and be documented:
//!   1. Cargo.toml has `panic = "unwind"` (the pool relies on catch_unwind).
//!   2. Every extern "C" entry point catches panics so none reach the boundary.
use std::panic::{self, AssertUnwindSafe};
use std::sync::mpsc;
use std::thread;

#[repr(C)]
pub struct JobResult { code: i32 }

/// C ABI entry point. A panic inside MUST NOT cross this boundary:
/// `extern "C"` would abort (safe but loud), so we catch and return a code.
#[no_mangle]
pub extern "C" fn process_job(ptr: *const u8, len: usize) -> JobResult {
    let slice = unsafe { std::slice::from_raw_parts(ptr, len) };
    let outcome = panic::catch_unwind(AssertUnwindSafe(|| do_process(slice)));
    match outcome {
        Ok(()) => JobResult { code: 0 },
        Err(payload) => {
            // Panic CAUGHT here — never reaches the C caller as an unwind.
            log_panic(&payload);
            JobResult { code: -1 }
        }
    }
}

/// Internal pool: each worker catches its job's panic so one poison job
/// doesn't kill the pool. This is ONLY correct under panic = "unwind".
struct Pool { tx: mpsc::Sender<Vec<u8>> }

impl Pool {
    fn new(workers: usize) -> Self {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let rx = std::sync::Arc::new(std::sync::Mutex::new(rx));
        for id in 0..workers {
            let rx = rx.clone();
            thread::Builder::new().name(format!("worker-{id}")).spawn(move || loop {
                let job = match rx.lock().unwrap().recv() {
                    Ok(j) => j,
                    Err(_) => break, // channel closed: drain & exit
                };
                // catch_unwind: a panicking job is contained to this iteration.
                let _ = panic::catch_unwind(AssertUnwindSafe(|| do_process(&job)));
                // worker LOOPS — it survives the panic and takes the next job.
            }).expect("spawn worker");
        }
        Pool { tx }
    }
}

fn do_process(_data: &[u8]) { /* real work; may panic on bad input */ }
fn log_panic(_p: &Box<dyn std::any::Any + Send>) { /* downcast + ship to Sentry */ }
```

### Go — a supervised pool with poison-input quarantine and backpressure

```go
package pool

import (
    "context"
    "log/slog"
    "runtime/debug"
    "time"
)

type Job struct {
    Payload  []byte
    Attempts int
}

type Pool struct {
    jobs    chan Job // bounded → BACKPRESSURE: a full channel blocks producers
    dead    chan Job // dead-letter sink
    maxTry  int
}

func New(workers, queue, maxTry int) *Pool {
    p := &Pool{jobs: make(chan Job, queue), dead: make(chan Job, queue), maxTry: maxTry}
    for i := 0; i < workers; i++ {
        go p.worker(i)
    }
    return p
}

// Submit applies backpressure: if the queue is full, the caller blocks (or we
// could select-with-default to shed). Unbounded queues are an OOM waiting to happen.
func (p *Pool) Submit(ctx context.Context, j Job) error {
    select {
    case p.jobs <- j:
        return nil
    case <-ctx.Done():
        return ctx.Err() // shed under deadline pressure instead of queueing forever
    }
}

func (p *Pool) worker(id int) {
    for j := range p.jobs {
        p.handle(j)
    }
}

func (p *Pool) handle(j Job) {
    defer func() {
        if rec := recover(); rec != nil {
            j.Attempts++
            slog.Error("job panicked", "worker_panic", rec, "attempts", j.Attempts,
                "stack", string(debug.Stack()))
            if j.Attempts >= p.maxTry {
                // Deterministic poison: quarantine, do NOT requeue forever.
                p.dead <- j
                return
            }
            // Transient: requeue with a small backoff (non-blocking best-effort).
            go func() { time.Sleep(time.Duration(j.Attempts) * 100 * time.Millisecond); p.jobs <- j }()
        }
    }()
    process(j) // panic here is contained; the worker goroutine survives
}

func process(j Job) { /* real work; bad payload may panic */ }
```

### Node — subprocess isolation for crash-prone native work

```js
// Untrusted media decoding can SEGFAULT a native addon — not a catchable JS
// throw, a process-killing signal. A worker_thread is NOT enough (a native
// crash takes the whole process). Use a CHILD PROCESS: the OS contains it.
const { fork } = require("node:child_process");
const path = require("node:path");

function decodeInSubprocess(buffer, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, "decode-worker.js"), [], {
      // Hard resource caps so a runaway can't take the host with it.
      execArgv: ["--max-old-space-size=256"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");          // contained: kill the child, parent lives
      reject(new Error("decode timeout"));
    }, timeoutMs);

    child.once("message", (msg) => { clearTimeout(timer); child.kill(); resolve(msg); });
    child.once("error",   (err) => { clearTimeout(timer); reject(err); });
    child.once("exit",    (code, signal) => {
      clearTimeout(timer);
      if (signal === "SIGSEGV") {
        // The native decoder SEGFAULTED. The CHILD died; the parent is fine.
        // This is the whole reason we isolated: a segfault is contained to a
        // disposable address space instead of crashing the request handler.
        reject(new Error("decoder crashed (SIGSEGV) on poison input"));
      } else if (code !== 0) {
        reject(new Error(`decoder exited ${code}`));
      }
    });
    child.send(buffer);
  });
}

module.exports = { decodeInSubprocess };
```

### Java — a self-healing executor with bounded restart and dead-lettering

```java
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/** A pool that: surfaces task panics (not swallow into Future), counts crashes,
 *  dead-letters poison work, and trips a circuit when crashes cluster. */
public final class ResilientPool {
    private final ThreadPoolExecutor exec;
    private final BlockingQueue<Runnable> deadLetter = new LinkedBlockingQueue<>();
    private final AtomicInteger crashesInWindow = new AtomicInteger();
    private static final int MAX_CRASHES = 5;

    public ResilientPool(int threads) {
        this.exec = new ThreadPoolExecutor(threads, threads, 0L, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(1000) /* bounded → backpressure */,
                r -> { Thread t = new Thread(r); t.setDaemon(true); return t; },
                new ThreadPoolExecutor.CallerRunsPolicy() /* shed by slowing producer */) {
            @Override protected void afterExecute(Runnable r, Throwable t) {
                super.afterExecute(r, t);
                // execute() surfaces the throwable here; submit() would hide it in a Future.
                if (t != null) {
                    if (crashesInWindow.incrementAndGet() > MAX_CRASHES) {
                        // Crashes are CLUSTERING → deterministic failure → escalate.
                        throw new IllegalStateException("restart budget exceeded; escalating", t);
                    }
                }
            }
        };
        // Decay the crash counter so transient blips don't trip the breaker.
        Executors.newSingleThreadScheduledExecutor()
            .scheduleAtFixedRate(() -> crashesInWindow.set(0), 30, 30, TimeUnit.SECONDS);
    }

    public void submit(PoisonAwareTask task) {
        // Use execute(), NOT submit(): we WANT afterExecute to see the throwable.
        exec.execute(() -> {
            try {
                task.run();
            } catch (RuntimeException e) {
                if (task.attempts() >= 3) deadLetter.add(task);  // quarantine poison
                else exec.execute(task::retry);                  // transient: retry
                throw e; // rethrow so afterExecute counts the crash
            }
        });
    }
}
interface PoisonAwareTask extends Runnable { int attempts(); void retry(); }
```

---

## Failure Stories From the Field

### 1. The `panic = "abort"` + `catch_unwind` mismatch

A Rust service ran a job pool that isolated panics with `catch_unwind`. Months earlier, a different engineer had set `panic = "abort"` in `Cargo.toml` to shave the binary and "make crashes louder." Both changes passed review independently; no test panicked a job. In production, a single malformed job panicked — and because `abort` made `catch_unwind` inert, the *entire process* aborted, dropping ~400 in-flight requests on that pod. The pod restarted, the same malformed job (still in the queue) came back, and it aborted again: a `CrashLoopBackOff` driven by one poison message. **Root cause:** the panic strategy and the isolation design were two independent decisions that *must* be one. **Fix:** `panic = "unwind"` with a comment stating the pool depends on it; a CI check that fails if `abort` and `catch_unwind` coexist; and an attempt-counter dead-letter so the poison message couldn't loop.

### 2. The panic that unwound through C and corrupted the heap

A team wrote a Rust audio codec with a C API, called from a C++ host. A Rust callback, invoked from C, hit a `panic!` on a truncated input. On the developer's machine (one toolchain), it "worked" — the panic limped through the C frame and was swallowed. In the field, on a different LLVM version, the unwind through the `extern "C"` C frame corrupted the stack and the host crashed *much later* with an unrelated, un-debuggable backtrace. **Root cause:** unwinding across a plain FFI boundary was UB; it happened to work in dev. **Fix:** wrap every Rust `extern "C"` entry point in `catch_unwind`, translate panics to a status code; upgrade to a toolchain where `extern "C"` *aborts* on unwind (deterministic death) rather than risking UB. The bug never reproduced again.

### 3. The signal handler that allocated

A C++ service installed a `SIGTERM` handler that did a "graceful" shutdown: log a message, flush metrics, close connections — all of which allocate and lock. Most of the time it worked. Occasionally, a `SIGTERM` arrived while a worker thread was mid-`malloc`; the handler's logging call tried to allocate, hit the allocator lock the interrupted thread held, and **deadlocked the process** — which then took the full `terminationGracePeriodSeconds` before k8s `SIGKILL`ed it. The "graceful" handler made shutdowns *slower and flakier*. **Root cause:** doing non-async-signal-safe work in a signal handler. **Fix:** the handler set a `volatile sig_atomic_t` flag; a normal thread polled it and did the (allocating, locking) graceful shutdown out of interrupt context. Shutdowns went from "occasionally 30s + SIGKILL" to "always sub-second."

### 4. The poison message that DoS'd the database

A Go consumer pool ran `for { msg := next(); go handle(msg) }` with a `recover` in `handle` — textbook per-job isolation. One message had a payload that deterministically panicked the handler *after* it had already opened (and not yet closed) a DB transaction. The `recover` caught the panic and the worker took the *next copy* of the same message (no attempt counter, no dead-letter). Each crash leaked a DB connection (the `defer tx.Rollback()` never ran because the panic was *before* the defer registered). Within minutes the pool exhausted the DB connection pool, and the *whole service*, not just this consumer, started failing on `connection pool exhausted`. **Root cause:** no poison-input quarantine + a resource acquired before its cleanup defer was registered. **Fix:** an attempt counter with a dead-letter at N=3; acquiring the transaction and registering `defer tx.Rollback()` as the *first* two statements so cleanup always runs; and a *bulkhead* — a dedicated, capped connection pool for this consumer so it couldn't starve the rest of the service.

### 5. The supervisor with no restart budget

An Elixir-inexperienced team copied "let it crash" without the supervisor's `max_restarts`. A worker that hit a permanently-bad external API crashed, restarted instantly, hit the same dead API, crashed — thousands of times a second. The restart storm generated so much logging and so many connection attempts that it took down the *logging pipeline* and a shared API gateway. **Root cause:** unbounded "let it crash" — the philosophy without the `max_restarts` half that makes it safe. **Fix:** restart intensity (5 in 10s) so the supervisor escalated to a parent that backed off exponentially and alerted; the lesson that **"let it crash" without a bounded restart is just "crash forever."**

---

## A Worked Walk-through — A Pool That Ate Itself

A realistic incident, narrated to show the concepts interacting. All times UTC.

**09:14** — A new client integration starts sending image-upload requests with occasional malformed PNGs (a truncated chunk a fuzzer would have caught). The service decodes thumbnails *inline*, in the request handler's goroutine, using a cgo wrapper around `libpng`.

**09:14:30** — A truncated PNG hits a `libpng` code path that **segfaults**. This is `SIGSEGV`, **not** a Go panic. The handler's `recover` is useless — a segfault isn't recoverable. The **entire Go process dies.** k8s restarts the pod.

**09:15** — The pod restarts, serves traffic, and within seconds another malformed PNG arrives. Segfault. Process dies. Restart. The pod is now in a `CrashLoopBackOff` *for the whole service* because a single optional feature (thumbnailing) is in the wrong failure domain.

**09:16** — Alert fires: `media-service: CrashLoopBackOff`. On-call (Dana) is paged. The dashboard shows the pod restarting every ~20s, error rate 60%, *all* endpoints affected — not just uploads.

**09:18** — Dana pulls a core dump (`GOTRACEBACK=crash` was set). The stack bottoms out in `libpng` C frames, not Go. **Recognition:** this is a *native* crash, contained by *nothing*, because cgo runs in the same address space as the Go runtime.

**09:20** — **Mitigation (not fix):** Dana flips a feature flag disabling inline thumbnailing. Uploads now skip the decode. The segfaults stop. The pod stabilizes. **Bleeding stopped** — the failure domain was the whole process; removing the offending code from it restored everything else.

**09:35** — Diagnosis. The team confirms: a Go `recover` can never catch a `SIGSEGV` from a C library — the decoder was in the *wrong isolation domain*. A goroutine boundary isolates Go panics; it does *nothing* for native memory corruption. The only domain that contains a segfault is a **separate address space** (subprocess) or the OS (separate container).

**11:00** — Fix shipped: thumbnail decoding moved into a **sandboxed subprocess** with a timeout and resource caps. A malformed PNG now segfaults the *child*; the parent gets an error, degrades (serves a placeholder thumbnail), and the request *succeeds*. The poison input is also dead-lettered for offline analysis.

**Postmortem root causes (plural):**
1. A crash-prone, untrusted-input native decoder ran in the *same* failure domain as the whole service (wrong isolation level).
2. The team assumed a `recover` could contain a native crash — it can't; a segfault isn't a panic.
3. No fuzzing of the image-decode path despite it handling untrusted input.
4. Thumbnailing (an *optional* feature) was a *hard* dependency of the request, not a degradable one.

**Action items:** subprocess-isolate all native decoders ([MEDIA-410]); fuzz the decode path in CI ([MEDIA-411]); make every optional feature degrade rather than fail the request ([MEDIA-412]); document the failure-domain map and review it ([ARCH-77]).

The lesson the whole page exists to teach: **`recover`/`catch_unwind` is not a containment field for everything — it contains *language-level panics only*. Native crashes, OOM-kills, and corruption need an OS-level failure domain. Choosing the domain is the staff-level decision; adding more `recover` is the junior reflex that doesn't help here.**

---

## Pros & Cons

| Decision | Pros | Cons |
|---|---|---|
| **`panic = "abort"`** | Smaller/faster binary; "corrupt → dead" guarantee; FFI-safe; no `catch_unwind` footguns | No per-thread/job isolation; `Drop` skipped on panic; can't use as a test/fuzz harness |
| **`panic = "unwind"`** | Per-job/thread isolation via `catch_unwind`; destructors run; recoverable at boundaries | Larger binary; unwind cost; FFI UB risk; a panic *can* be caught-and-ignored |
| **Subprocess isolation** | Contains segfaults/OOM/native corruption; strongest in-host blast-radius control | IPC + spawn cost; serialization overhead; more moving parts |
| **In-process pool + `recover`** | Cheap; fast; simple | Contains *only* language panics, not native crashes/`fatal error`/OOM |
| **Supervision tree** | Reliability becomes a property; bounded, escalating failure handling | Requires discipline (budgets, child specs); easy to do without the `max_restarts` that makes it safe |
| **Bulkheads** | One slow dependency can't starve the others; partial failure | More pools to size and monitor; capacity fragmentation |
| **Crash-only** | One tested stop/start path; k8s-native | Requires durable state, idempotency, fast boot; degrades to `CrashLoopBackOff` on deterministic crashes |

---

## Use Cases

- **Media / document processing** (image, PDF, font, video decode of untrusted input): subprocess sandboxes — a segfault must not be in the request's domain. The ImageTragick and FreeType CVE classes are exactly this.
- **Plugin / extension hosts** (a CI runner, a serverless function host, a browser): each plugin/tenant in its own process or container — one plugin's crash must not take the host.
- **High-assurance / safety-critical** (avionics, automotive, payments core): `panic = "abort"`, no recover, fail-fast — a broken invariant must *stop*, and certification often forbids the unwind path's nondeterminism.
- **FFI-heavy systems** (Rust↔C, JNI, cgo, native Node addons): the boundary discipline of this page is non-negotiable — catch at the edge, never unwind across plain `extern "C"`.
- **Message consumers / stream processors** (Kafka, SQS, Pub/Sub): poison-input quarantine (dead-letter + attempt counter) and bounded restart are the difference between resilient and self-DoSing.
- **Multi-tenant SaaS**: bulkheads per tenant/dependency so one tenant's bad input or one downstream's slowness is partial, not total, failure.

---

## Coding Patterns

### Pattern: catch at every FFI boundary; never unwind across `extern "C"`

```rust
#[no_mangle]
pub extern "C" fn entry() -> i32 {
    std::panic::catch_unwind(|| real_work()).map_or(-1, |_| 0) // panic → code, not UB
}
```

### Pattern: attempt counter on the *message*, not the worker

```go
j.Attempts++
if j.Attempts >= maxTry { deadLetter(j); return } // quarantine poison
requeue(j)                                         // retry transient
```

### Pattern: signal handler sets a flag; a normal thread does the work

```rust
extern "C" fn on_term(_: i32) { SHUTDOWN.store(true, SeqCst); } // async-signal-safe only
```

### Pattern: publish a fully-built value with one atomic move (no half-state to poison)

```rust
let next = build_next();   // panic here harms nothing shared
shared.store(Arc::new(next)); // single atomic publish
```

### Pattern: bulkhead — a dedicated pool per dependency

```java
ExecutorService poolA = Executors.newFixedThreadPool(20); // service A only
ExecutorService poolB = Executors.newFixedThreadPool(20); // service B only
// A's slowness starves poolA, never poolB.
```

### Pattern: bounded restart that escalates (no infinite let-it-crash)

```go
if crashesInWindow > maxRestarts { return errEscalate } // trip the recursive breaker
```

### Pattern: degrade an optional dependency to a fallback

```go
items, err := safeCall(...); if err != nil { return fallback() } // feature fails, request lives
```

---

## Clean Code

- **The panic strategy is documented at its source.** `Cargo.toml` carries a comment stating which design depends on `unwind`/`abort`; CI fails if `abort` and `catch_unwind` coexist.
- **Every FFI boundary catches.** No `extern "C"` / JNI / cgo / N-API function lets a panic/exception unwind across it; each translates failure into the *other* language's error vocabulary.
- **No real work in signal handlers.** Handlers set a flag or write a self-pipe byte; a normal thread does anything that allocates, locks, logs, or panics.
- **Isolation matches the worst failure.** Native/untrusted/crash-prone work is in a *subprocess or container*, never relying on a `recover` that can't catch a segfault.
- **Poison inputs are quarantined.** An attempt counter + dead-letter on every consumer; restarts are bounded and escalate.
- **Shared resources are bulkheaded.** A pool per dependency; no single slow downstream can starve unrelated paths.
- **Optional dependencies degrade.** A failed non-critical call yields a fallback value, never a panic that fails the whole request.
- **Mutating operations are idempotent.** A crash-and-replay (the basis of crash-only and supervision) can't double-apply.
- **Every cross-boundary call has a deadline.** No unbounded blocking; "hang forever" is converted to "fail this one call."

---

## Best Practices

1. **Know your unwinder.** Be able to explain, for your stack, whether it's table-based (Itanium/DWARF) or SjLj, and therefore whether panics cost on the happy path. This decides whether "panics are free unless thrown" is even true.
2. **Make the panic strategy and isolation design one reviewed decision.** `catch_unwind` ⟺ `unwind`; FFI/leaf ⟺ `abort`. Never let them disagree silently; verify in CI.
3. **Treat every FFI boundary as an unwinding-mechanism boundary.** Catch and re-encode; never unwind across plain `extern "C"` / into the JVM / into V8 / through CPython.
4. **Never do real work in a signal handler.** Flag or self-pipe only; convert interrupt context to normal context before allocating, locking, logging, or panicking.
5. **Recover from poisoning honestly** — propagate, prove-and-recover, or repair — never `into_inner()` on autopilot. Better: design half-state out so the question is moot.
6. **Quarantine poison inputs.** Attempt counter on the message + dead-letter; distinguish transient (retry) from deterministic (quarantine) failure.
7. **Isolate at the level that contains the *worst* failure.** Native/untrusted code → subprocess or container; a `recover` cannot catch a segfault, an OOM-kill, or a Go `fatal error`.
8. **Bulkhead shared resources** — a pool/connection set per dependency — so one slow downstream causes partial, not total, failure.
9. **Bound and escalate restarts.** Copy OTP's `max_restarts`/`max_seconds`; an unbounded "let it crash" is "crash forever" and can DoS your own dependencies.
10. **Make replayed work idempotent and degrade optional features.** These are the preconditions that make crash-only, supervision, and partial-failure containment *safe* rather than merely *available*.

---

## Edge Cases & Pitfalls

- **`Drop`/destructors don't run under `panic = "abort"`.** A guard that releases an external lock on `Drop` won't release it on panic-abort. Don't rely on RAII for cleanup that must happen on a panicking exit; give external resources TTLs.
- **A segfault is not a panic.** `recover`/`catch_unwind`/`try-catch` cannot catch `SIGSEGV`. Native crashes need OS-level isolation (subprocess), not a language-level handler.
- **Go `fatal error:` ignores `recover`.** Concurrent map write, stack overflow, OOM, runtime deadlock — unrecoverable. You can only *prevent* them, not contain them.
- **Backtrace capture dominates panic cost.** The JVM's `fillInStackTrace`, Rust's `RUST_BACKTRACE`, Go's `debug.Stack()` are the expensive part. Disable in genuine hot-path signaling exceptions; never in error paths you'll need to debug.
- **`extern "C"` aborts on unwind (post-RFC-2945); older toolchains were UB.** Know your Rust version: pre-1.71 the behavior was undefined, not a clean abort.
- **JNI pending exceptions are deferred.** A Java exception thrown into native code isn't seen until the next JNI call; you must `ExceptionCheck` explicitly or get bizarre, delayed corruption.
- **`spawn_blocking` panics are captured in Tokio, but a panic in a `Drop` during unwind aborts.** A panic *while already unwinding* (a destructor that panics) is a double-panic → `abort` in Rust, `std::terminate` in C++.
- **Unbounded queues defeat backpressure.** A "resilient" pool with an unbounded in-memory queue just relocates the failure from "downstream slow" to "OOM-killed." Bound the queue.
- **A supervisor without `max_restarts` is a restart bomb.** Deterministic failures loop forever and can take down shared infrastructure (logging, gateways, DBs) through sheer restart volume.
- **Re-panic unwinds over corrupt data; `abort` doesn't.** When you've *detected* corruption, `abort`/`os.Exit` is the cleaner death — re-panicking runs destructors over the bad state, potentially making corruption durable.

---

## Common Mistakes

1. **Relying on `recover`/`catch_unwind` to contain a native crash** — a segfault from a C library isn't catchable; only a separate address space contains it.
2. **`panic = "abort"` while depending on `catch_unwind`** — silent in dev, whole-process abort in prod on the first job panic.
3. **Unwinding a panic/exception across a plain FFI boundary** — UB (pre-fix) or abort (post-fix); always catch and re-encode at the edge.
4. **Doing real work in a signal handler** — allocating/locking/logging/panicking → deadlock when the signal interrupts the allocator.
5. **No poison-input quarantine** — `recover` + immediate requeue = infinite crash loop that hammers downstreams (the connection-pool-exhaustion story).
6. **`into_inner()` on every poisoned lock** — reintroducing the corruption poisoning exists to flag.
7. **Unbounded "let it crash"** — supervision without `max_restarts` is a restart storm that can DoS your own infrastructure.
8. **Sharing one thread/connection pool across all dependencies** — no bulkhead, so one slow downstream starves everything.
9. **Acquiring a resource before registering its cleanup `defer`/`finally`** — a panic in the gap leaks the resource (and the leak compounds under a crash loop).
10. **Treating optional features as hard dependencies** — a failed recommendation call fails the whole request instead of degrading.

---

## Tricky Points

- **"Zero-cost exceptions" are zero-cost only on the *non-throwing* path** — the throw is expensive *by design*; the name describes the happy path, not the failure path.
- **Two-phase unwinding runs the search phase before *any* cleanup** — which is why C++ can run `std::terminate` with the stack intact when no handler exists, a debugging affordance you lose under `abort`.
- **`panic = "abort"` can speed up the *happy* path**, not just the failure path, because removing unwind edges frees the optimizer — it's a legitimate perf choice, not only a correctness one.
- **A panic during unwinding aborts** (double-panic) — a `Drop`/destructor that itself panics turns a recoverable unwind into an unconditional `abort`/`terminate`. Destructors must not panic.
- **Go chose no cross-goroutine unwinding deliberately** — building it would require Itanium-style machinery and would *encourage* the corrupt-state recovery this topic warns against. The detonation-on-unrecovered-panic is the *consequence* of a sound design choice.
- **`extern "C"` aborting on unwind is the *safe* default** — "abort" here is the feature, not the bug; it converts UB into deterministic death.
- **OTP's `max_restarts` is a statistical classifier**, not a retry cap — it distinguishes Poisson-transient from clustered-deterministic failures, which is *why* exceeding it escalates rather than just stops.
- **A bulkhead protects against resource exhaustion; a circuit breaker protects against wasted calls; a timeout protects against unbounded blocking** — they're three different containment tools for three different failure shapes, and you usually need all three.

---

## Anti-Patterns at Professional Level

1. **"We'll just `recover` it"** as the answer to a native crash. A `recover` is a language-panic catcher, not a force field. Wrong tool, wrong domain.
2. **Defensive cleanup in a signal handler.** "Graceful shutdown" code that allocates and locks inside a `SIGTERM` handler — flaky deadlocks that make shutdowns *worse*.
3. **`into_inner()` everywhere.** Treating poison recovery as boilerplate to silence rather than a correctness question to answer.
4. **Unbounded "let it crash."** The Erlang philosophy without the supervisor's restart budget — a crash loop that DoSes your own infrastructure.
5. **One pool to rule them all.** A single shared thread/connection pool across every dependency — no bulkhead, so the slowest downstream owns your availability.
6. **FFI by faith.** Letting panics/exceptions cross `extern "C"`/JNI/cgo boundaries because "it worked on my machine" — UB that ships and corrupts in the field.
7. **The unbounded in-memory queue labeled "resilient."** Backpressure replaced with "queue it all" — relocating the failure to an OOM-kill.
8. **Strategy-by-accident.** `panic = "abort"`/`unwind` chosen for one reason (binary size) without auditing every design that depends on the other.
9. **The destructor that panics.** Cleanup code that can itself fail, turning a recoverable unwind into an unconditional abort.
10. **Optional-as-mandatory.** Wiring a non-critical dependency such that its failure fails the whole request — no degradation path.

---

## Test Yourself

1. Walk through the two phases of Itanium-ABI unwinding. Why does the *search* phase run before any cleanup, and what capability does that preserve?
2. Explain, mechanistically, why `panic!()` inside a `SIGSEGV` handler is undefined behavior. Name the specific resource the deadlock contends on.
3. Why is unwinding across a plain `extern "C"` boundary UB, in terms of DWARF CFI, personality routines, and LSDA? What did RFC 2945 change?
4. Your Rust binary has `panic = "abort"`. A colleague adds a `catch_unwind` worker pool for isolation. Predict the production behavior and give two fixes.
5. A poisoned `Mutex` — give the three honest recovery options and the one illegitimate-but-common one. Then redesign the critical section so poisoning can't matter.
6. A Go consumer with a perfect per-job `recover` still took down the database. Reconstruct the failure chain and the four fixes.
7. Why can't a goroutine `recover` contain a segfault from a cgo library? What isolation domain *can*, and why?
8. Explain OTP's `max_restarts`/`max_seconds` as a failure *detector*. Why does exceeding it escalate (crash the supervisor) rather than just stop?
9. Map the four OTP restart strategies (`one_for_one`, `one_for_all`, `rest_for_one`, `simple_one_for_one`) to the *state coupling* each encodes.
10. Distinguish a bulkhead, a circuit breaker, and a timeout. Give a failure shape each one — and only it — contains.

---

## Tricky Questions

**Q1: Are panics "zero-cost"? My profiler says a throw took 40µs.**

"Zero-cost" describes the *non-throwing* path: a function that *can* panic but doesn't pays nothing at runtime, because all the unwind information lives in side tables consulted only on a throw. The throw itself is expensive *by design* — it allocates the payload, walks the stack interpreting DWARF CFI per frame, runs landing pads, and (usually) captures a backtrace. 40µs is normal for a deep stack with backtrace capture. The lesson: panics are optimized for "rare," so using them for frequent control flow inverts the runtime's optimization. Your 40µs is the runtime telling you this should have been a `Result`.

**Q2: Why exactly is `panic!()` in a signal handler UB, and not just "discouraged"?**

A signal can interrupt your thread mid-`malloc`, while it holds the allocator lock. The handler runs *on that same thread*. `panic!` allocates (the payload) and unwinds (which may allocate a backtrace and calls the personality routine). The allocation tries to take the allocator lock the interrupted code already holds → deadlock. Worse, the unwinder may try to unwind *through the kernel-pushed signal frame*, whose layout the DWARF CFI doesn't describe as the unwinder expects → corrupted unwind. POSIX async-signal-safety exists precisely to forbid this class; `panic`/`throw`/`malloc`/`printf` are all off the safe list. The only safe handler work is a flag store or a self-pipe write.

**Q3: We need a Rust panic to propagate into our C++ host so it can catch it. How?**

Use `extern "C-unwind"` (stable since Rust 1.71, RFC 2945) on the boundary function, which *defines* unwinding across the edge, and ensure every intervening frame is unwind-aware (no plain `extern "C"` C frames in between — those still abort). But the *default and usually correct* answer is the opposite: catch the panic in Rust with `catch_unwind`, translate it to an error code or a C++-thrown exception you construct deliberately, and never let the raw Rust unwind cross. Cross-language unwinding is a sharp tool; reach for it only with the whole call chain audited.

**Q4: A poisoned lock — should I just `into_inner()` and move on?**

Only if you can *prove* the protected data is still consistent — e.g. the panic happened before any mutation, or the update is a single atomic field write. Otherwise `into_inner()` is exactly the corruption-recovery bug poisoning exists to flag. Your three honest options are: propagate (refuse to trust the data, crash/escalate to a supervisor that restarts clean), recover-with-proof (`into_inner` *because* you've shown consistency), or repair (rebuild the invariant from durable state). The best move is upstream: design the critical section so a panic mid-way leaves no observable half-state (build-then-atomically-publish), and the poison question disappears.

**Q5: My Go service has flawless per-request `recover` and still crashed on a bad image. How?**

Because the crash was a `SIGSEGV` from a cgo `libpng` call, not a Go panic — and `recover` only catches Go panics. A segfault in a C library shares the Go process's address space and kills it outright. The fix isn't more `recover`; it's a different *failure domain*: run the native decoder in a *subprocess* so the OS contains the segfault. The child dies, the parent gets an error and degrades. This is the central staff-level point — `recover`/`catch_unwind` contains language panics; native crashes, OOM-kills, and `fatal error`s need OS-level isolation.

**Q6: Is `panic = "abort"` only about safety, or is there a performance angle?**

Both. Safety: it guarantees a panicking (possibly-corrupt) process dies immediately and makes FFI unwinding impossible. Performance: telling the compiler "no frame is ever unwound" lets it delete landing pads, shrink unwind tables, and remove control-flow edges the optimizer otherwise has to respect — so the *happy* path can be smaller and sometimes faster, and the binary is smaller. The cost is total: no `catch_unwind`, no per-job isolation, and `Drop` does not run on panic. It's a different machine, chosen deliberately.

**Q7: How is "let it crash" different from "crash forever," and where's the line?**

The line is the supervisor's `max_restarts`/`max_seconds`. "Let it crash" is reliable *because* a restart-from-clean-state path is exercised constantly — but only when paired with (a) a supervisor that restarts, (b) externalized/checkpointed state, (c) idempotent replay, and crucially (d) a *bounded* restart budget that distinguishes transient failures (restart helps) from deterministic ones (restart is futile). Without (d), a deterministic crash — a poison message, a dead dependency — restarts forever, and the restart volume alone can take down your logging, your gateway, your database. Bounded-and-escalating is "let it crash"; unbounded is "crash forever."

**Q8: When do I reach for a subprocess instead of a thread/goroutine for isolation?**

When the worst failure of the unit can corrupt memory or kill the process: untrusted/native input parsing (images, PDFs, fonts, video), code that can segfault or OOM, or anything where you don't trust the unit not to take the whole address space with it. A thread/goroutine isolates *language-level panics*; only a separate address space (subprocess) isolates segfaults, native corruption, and hard memory caps, and only a separate container isolates kernel/resource state too. Choose the domain that contains the *worst* failure, not the typical one — that's why browsers and media pipelines run risky work in their own processes.

---

## Cheat Sheet

```text
┌────────────────── PANIC & RECOVERY — PROFESSIONAL CHEAT SHEET ──────────────────┐
│                                                                                 │
│  UNWINDING IS AN ENGINE (Itanium ABI, DWARF CFI)                               │
│    two-phase: SEARCH (find handler, no cleanup) → CLEANUP (run landing pads)     │
│    per frame: personality routine reads LSDA → landing pad → destructors/Drop    │
│    valid ONLY across frames built to be unwound through → FFI/signal/asm = UB    │
│    Go does NOT use this: runtime walks per-goroutine _defer chain → exit on miss │
│                                                                                 │
│  COST: free if NOT thrown; throw = µs–ms (DWARF interp + BACKTRACE dominate)     │
│        panics are optimized for RARE → don't use for control flow                │
│                                                                                 │
│  panic = "abort"  vs  "unwind"                                                  │
│    abort  → no landing pads, smaller+faster, Drop SKIPPED, catch_unwind INERT    │
│           → FFI-safe, "corrupt→dead" guarantee; REQUIRED off when pool isolates  │
│    unwind → catchable, Drop runs, per-job isolation; bigger; FFI UB risk         │
│    STRATEGY + ISOLATION DESIGN = ONE reviewed decision (CI-checked)              │
│                                                                                 │
│  SIGNAL HANDLERS: async-signal-safe ONLY. set a flag / self-pipe byte.           │
│    NO alloc, NO lock, NO log, NO panic → else deadlock on the allocator lock     │
│                                                                                 │
│  FFI: catch at EVERY boundary; re-encode in the other lang's errors.            │
│    extern "C" ABORTS on unwind (safe); extern "C-unwind" DEFINES it (rare).       │
│    cgo / JNI / N-API / CPython: never let unwind cross. ExceptionCheck etc.       │
│                                                                                 │
│  POISONED LOCK: propagate | recover-with-PROOF | repair. NEVER into_inner()/auto │
│    design out: build-then-atomic-publish ⇒ no half-state ⇒ poison moot           │
│                                                                                 │
│  RESILIENT POOL = isolation + POISON QUARANTINE (attempt counter+DLQ)            │
│                   + BOUNDED restart (escalate) + BACKPRESSURE (bounded queue)     │
│                   + DRAIN on shutdown                                            │
│                                                                                 │
│  ISOLATION DOMAIN = contain the WORST failure, not the typical:                  │
│    lang panic → goroutine/thread+recover   │   segfault/OOM/native → SUBPROCESS   │
│    multi-tenant/hostile → separate container                                    │
│                                                                                 │
│  SUPERVISION (OTP): max_restarts/max_seconds = failure DETECTOR (Poisson vs      │
│    clustered) → exceed ⇒ supervisor crashes UP. strategies encode STATE COUPLING.│
│    link = die together │ monitor = notify only. k8s = the OUTERMOST supervisor.   │
│                                                                                 │
│  CONTAINMENT: bulkhead (resource) │ circuit breaker (wasted calls) │ timeout      │
│    (unbounded block) │ degrade optional deps │ idempotent replay                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Unwinding is a separate execution engine** — the Itanium ABI's two-phase, DWARF-CFI-driven walk that runs landing pads via per-frame personality routines. It is valid *only* across frames built to be unwound through. Every "it's UB" rule on this page (signal handlers, FFI, `noexcept`) is that one fact applied.
- **The cost is intentional and asymmetric**: free on the non-throwing path, microseconds-to-milliseconds on a throw (backtrace capture dominating). Panics are optimized for *rare* — using them for control flow fights the runtime.
- **`panic = "abort"` is a different machine**, not just a different policy: no landing pads, smaller/faster binary, `Drop` skipped on panic, `catch_unwind` inert, FFI-safe, "corrupt → dead" guaranteed. The strategy and your isolation design are **one** decision and must be verified to agree.
- **A signal handler is hostile context.** Set a flag or write a self-pipe byte; never allocate, lock, log, or panic — the allocator-lock deadlock is real and intermittent. High-level signal APIs all convert interrupt context to normal context for you.
- **Every FFI boundary is an unwinding-mechanism boundary.** Catch and re-encode; `extern "C"` aborts on unwind (safe), `extern "C-unwind"` defines it (rare, audited). The same rule governs cgo, JNI, N-API, and CPython extensions.
- **Poisoning is a prompt, not an answer.** Recover by propagating, proving-then-recovering, or repairing — never `into_inner()` on autopilot. Best of all, design half-state out (build-then-atomically-publish) so the question is moot.
- **Resilient pools quarantine poison inputs** (attempt counter + dead-letter), **bound restarts** (escalate, don't loop), apply **backpressure** (bounded queues), and **drain** on shutdown. Per-job `recover` alone is the easy 20%.
- **Isolate at the level that contains the *worst* failure.** `recover`/`catch_unwind` contains language panics; segfaults, OOM-kills, and `fatal error`s need a subprocess or container. The staff decision is the failure domain, not more `recover`.
- **Supervision turns "let it crash" into reliability** via OTP's restart-intensity failure *detector* and strategies that encode state coupling, escalating up a tree whose outermost node is k8s. Bulkheads, circuit breakers, timeouts, degradation, and idempotency are the containment tools that bound partial failure.

---

## What You Can Build

- An **unwinding-cost benchmark** in Rust/C++/Java/Go: measure a return vs. a panic with and without backtrace capture, deep vs. shallow stack, `unwind` vs. `abort` — and internalize the orders of magnitude and where the time actually goes.
- A **strategy-mismatch detector** for CI: a check that fails the build if a Rust crate has `panic = "abort"` *and* any `catch_unwind` in its dependency graph that the design relies on for isolation — turning the senior page's footgun into a compile-time guard.
- A **signal-safety demo**: a handler that (wrongly) allocates/locks and deadlocks under a stress loop that signals mid-`malloc`, alongside the correct flag/self-pipe version — run both under load and watch one hang.
- An **FFI unwinding harness**: a Rust `extern "C"` boundary that aborts cleanly on panic, an `extern "C-unwind"` one that propagates to a C++ catch, and a (sandboxed) reproduction of the old UB on a pinned old toolchain — to *see* the difference, not just read it.
- A **poison-quarantine consumer**: a Kafka/SQS-style worker pool with an attempt counter, a dead-letter sink, a bounded restart budget that escalates, backpressure via a bounded queue, and a subprocess sandbox for the one native-decode step — then feed it a poison message and watch it dead-letter instead of crash-looping.
- A **failure-domain map** for a real service (the boxed diagram above): every unit labeled with its worst failure and its isolation domain, reviewed like an architecture doc, with the wrong-domain cases (native code in the request goroutine) fixed by moving boundaries.

---

## Further Reading

- **Itanium C++ ABI — Exception Handling** — <https://itanium-cxx-abi.github.io/cxx-abi/abi-eh.html> — the de-facto standard two-phase model; dense but authoritative.
- **Airs / Ian Lance Taylor — ".eh_frame" and the DWARF unwinding series** — <https://www.airs.com/blog/archives/460> — the clearest walk-through of `.eh_frame`, CFI, personality routines, and landing pads.
- **Rustonomicon — "Unwinding" and FFI** — <https://doc.rust-lang.org/nomicon/unwinding.html> and the `catch_unwind` docs — Rust's panic model and the FFI hazards.
- **Rust RFC 2945 — `C-unwind` ABI** — <https://rust-lang.github.io/rfcs/2945-c-unwind-abi.html> — exactly what `extern "C"` vs `extern "C-unwind"` guarantee and why the default aborts.
- **POSIX — Async-Signal-Safety & the safe-function list** — `man 7 signal-safety` — the canonical list of what you may call in a handler, and why it's so short.
- **Go runtime source — `panic.go` (`gopanic`, `fatalpanic`, `_defer`)** — <https://github.com/golang/go/blob/master/src/runtime/panic.go> — how Go's non-Itanium `defer`/`recover` actually works and why a goroutine panic detonates.
- **Erlang/OTP — Supervisor behaviour, restart strategies, restart intensity** — <https://www.erlang.org/doc/design_principles/sup_princ.html> — the source of `max_restarts`, child specs, and the four strategies.
- **Joe Armstrong — "Making reliable distributed systems in the presence of software errors" (PhD thesis, 2003)** — the canonical case for supervision and let-it-crash, with the failure-detector reasoning.
- **Michael Nygard — *Release It!* (2nd ed.)** — bulkheads, circuit breakers, timeouts, and the partial-failure containment patterns, with production war stories.
- **Netflix Hystrix wiki & resilience4j docs** — <https://resilience4j.readme.io/> — the thread-pool-per-dependency bulkhead pattern in practice.
- **Crashpad / Breakpad design docs** — how production crash handlers run in fatal-signal context safely (fork-and-symbolicate, pre-allocated buffers).
- **Node.js — `worker_threads`, `child_process`, and `--abort-on-uncaught-exception`** — <https://nodejs.org/api/process.html> — isolation primitives and the abort-for-core-dump trade.

---

## Related Topics

- **Previous level:** [senior.md](senior.md) — the crash-vs-recover *policy*, unwind-vs-abort as a runtime decision, the propagation matrix, lock-poisoning basics, supervision as restart-from-clean, the written panic policy. This page is the *machinery and frontier* beneath that policy.
- **Middle level:** [middle.md](middle.md) — recover-at-boundary, the four obligations, `catch_unwind` basics.
- **Junior level:** [junior.md](junior.md) — the two-layer model, unwinding, when a program should crash.
- **Interview prep:** [interview.md](interview.md) — staff-level panic/recovery questions.
- **Practice:** [tasks.md](tasks.md) — exercises building the harnesses above.

**Sibling diagnostic topics:**

- [Crash Reporting — Professional](../crash-reporting/professional.md) — how a crash handler runs safely in fatal-signal context, core dumps, symbolication, deduplication — the "design the death" half of this page taken to its conclusion.
- [Error Handling — Professional](../error-handling/professional.md) — the *recoverable* half of the boundary: error taxonomies, propagation, and API-level failure design.
- [Debugging — Professional](../debugging/professional.md) — RCA, blameless postmortems, and incident response for the failures this page tries to make impossible by construction.
- [Observability Engineering](../observability-engineering/README.md) — the correctness alerts (not just liveness) that catch a "healthy" process serving corrupt data, and the telemetry you flush at the moment of death.
- [Post-Mortem Analysis](../post-mortem-analysis/README.md) — writing up the failure-domain and panic-policy failures this page exists to prevent.

**Cross-roadmap links:**

- [Circuit Breaker](../../code-craft/coding-patterns/README.md) and the `circuit-breaker-pattern` skill — the wasted-call half of partial-failure containment; recursive in a supervision tree.
- [Retry Pattern](../../code-craft/coding-patterns/README.md) and the `retry-pattern` skill — jittered backoff and idempotency, the preconditions for safe crash-and-replay.
- [Concurrency Patterns](../../code-craft/coding-patterns/README.md) and the `concurrency-patterns` skill — the spawn/join primitives the propagation matrix and supervision ports are built from.
- [Immutability Patterns](../../code-craft/coding-patterns/README.md) and the `immutability-patterns` skill — build-then-atomically-publish, the design that makes lock poisoning moot.

---

## Diagrams & Visual Aids

### Two-phase unwinding

```text
   throw / panic!
        │
   ┌────▼─────────────────────────────────────────────────────────┐
   │ PHASE 1 — SEARCH (walk UP, run NOTHING)                       │
   │   frame N    → personality: handler here? no                  │
   │   frame N-1  → personality: handler here? no                  │
   │   frame N-2  → personality: handler here? YES → remember it   │
   └────┬─────────────────────────────────────────────────────────┘
        │ handler found (stack still intact)
   ┌────▼─────────────────────────────────────────────────────────┐
   │ PHASE 2 — CLEANUP (walk UP AGAIN, run landing pads)           │
   │   frame N    → restore regs (DWARF CFI) → landing pad: ~Drop  │
   │   frame N-1  → restore regs → landing pad: ~Drop              │
   │   frame N-2  → transfer control to the HANDLER (catch/recover)│
   └──────────────────────────────────────────────────────────────┘
```

### Where unwinding is valid (and where it's UB)

```text
   Rust frame   ✓ (LSDA + personality)        ── unwind VALID
   Rust frame   ✓
   ───────────── extern "C" boundary ─────────  ← unwind hits a C frame:
   C frame      ✗ (no Rust LSDA/personality)      extern "C" → ABORT (safe)
                                                  extern "C-unwind" → defined
   ───────────── signal frame ────────────────  ← kernel-pushed: CFI mismatch
   handler      ✗ (interrupted mid-malloc)        panic here → UB / deadlock
```

### Isolation domains by blast radius

```text
   WEAKEST ─────────────────────────────────────────────► STRONGEST
   goroutine+recover   thread+catch_unwind   worker_thread   SUBPROCESS   container
   ┌──────────────┐    ┌────────────────┐    ┌────────────┐  ┌──────────┐ ┌────────┐
   │ lang panic   │    │ lang panic     │    │ JS crash   │  │ segfault │ │ + rsrc │
   │ only         │    │ only           │    │            │  │ OOM      │ │ + kernel│
   │ (NOT segfault│    │ (NOT segfault) │    │            │  │ native   │ │ state  │
   │  /fatal err) │    │                │    │            │  │ corruptn │ │        │
   └──────────────┘    └────────────────┘    └────────────┘  └──────────┘ └────────┘
   cheapest ───────────────────────────────────────────────────────► most expensive
   RULE: isolate at the level that contains the WORST failure, not the typical one.
```

### Supervision tree with escalation

```text
                         ┌─────────────────┐
                         │  k8s liveness   │  ← OUTERMOST supervisor
                         │  + restartPolicy│    (CrashLoopBackOff = budget exceeded)
                         └────────▲────────┘
                                  │ process exit(non-zero) = escalation
                         ┌────────┴────────┐
                         │ root supervisor │  strategy: one_for_one, max 5/30s
                         └───┬─────────┬───┘
                  escalate ↑ │         │ ↑ escalate
                    ┌────────┴──┐   ┌──┴────────┐
                    │ sup: pool │   │ sup: I/O  │
                    └──┬──┬──┬──┘   └────┬──────┘
                     w  w  w  (workers)  w
                     │
                  PANIC → die → supervisor restarts ONE (one_for_one)
                  too many in window → sup crashes UP → root decides
```

### Poison-input quarantine

```text
   job ──► worker ──┬── success ──► done
                    │
                    └── PANIC ──► attempts++
                                    │
                          attempts < N ? ──yes──► requeue (transient)
                                    │
                                    no ──► DEAD-LETTER (poison)  + alert
                                           └─ worker SURVIVES; pool keeps serving
   without this: PANIC → requeue → same poison → PANIC → ... CrashLoop + downstream DoS
```
