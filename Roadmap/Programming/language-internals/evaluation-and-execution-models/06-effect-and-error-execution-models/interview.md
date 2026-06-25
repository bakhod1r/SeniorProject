# Effect & Error Execution Models — Interview Questions

> **Topic:** [Effect & Error Execution Models](README.md)
> **Focus:** Probing whether a candidate understands how languages model "computation that does more than return a value" — errors and effects — as real execution mechanisms, from stack unwinding to algebraic effects.

---

## Introduction

These questions test whether a candidate can reason about the gap between the error-handling *syntax* they write and the *execution mechanism* underneath. A strong candidate distinguishes errors from panics from aborts, explains what a `throw` physically does (a stack search, not a jump), knows why "zero-cost exceptions" are only zero-cost on the happy path, can desugar Rust's `?` and Go's `panic`/`recover`, and — at the senior end — sees that exceptions, generators, async, and dependency injection are all the same continuation-based mechanism. Weak candidates recite "use try/catch" without explaining cost, propagation, or cleanup ordering.

The sections progress: **Conceptual** (the model itself), **Language-Specific** (Java/C++/Go/Rust/Haskell/JS surfaces), **Tricky/Trap** (where the textbook answer is wrong), and **Design** (judgment about failure taxonomies and systems).

## Table of Contents

- [Conceptual](#conceptual)
- [Language-Specific](#language-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What is the difference between an "error" and an "effect," and why does this topic group them together?**

An **error** is a computation that cannot produce its normal result (file not found, invalid input). An **effect** is the broader notion of a computation that *does something to* or *depends on* the world beyond returning a value (I/O, mutation, randomness, reading the clock). They're grouped because both are answers to the same execution question: *how does a language run, and let you control, code that does more than map inputs to an output?* Errors are one kind of effect — specifically a control-flow effect that may abandon the normal path. The modern unification (algebraic effects) treats `raise` as just one effect alongside `await`, `yield`, and `ask`.

## Question 2

**What does a `throw` physically do at runtime? Is it a jump to the catch?**

No. The throw site does not know where the matching catch is. A `throw` triggers a **search up the call stack**: the runtime walks frames asking each "do you have a handler for this exception type?", **unwinds** the frames between the throw and the handler (running their cleanup — destructors, `finally`, `defer`), and finally transfers control into the handler. It's a runtime-driven search-and-unwind, not a direct goto.

## Question 3

**Explain "zero-cost exceptions." What is zero, and what isn't?**

Zero-cost means **zero cost on the happy path** — entering a `try` block emits *no* runtime instructions. The compiler instead emits side metadata (unwind tables, landing pads) consulted only when an exception is actually thrown. The cost is fully deferred to throw time, where walking the tables and running cleanup makes a throw **expensive** — often 100–1000× a normal return. So "zero-cost" is precise: zero on the path that doesn't throw, costly on the path that does. It contrasts with `setjmp`/`longjmp`, which is cheap to throw but charges every `try` entry.

## Question 4

**What is two-phase stack unwinding and why two phases?**

Phase 1 (**search**) walks up the stack to *find* a handler **without modifying the stack** — no cleanup runs. Phase 2 (**unwind/cleanup**) walks up again, actually popping frames and running their cleanups, up to the handler found in Phase 1. Two phases exist so that if **no handler is found**, the program can call `terminate` **with the original stack intact** (so a debugger sees the full backtrace at the throw point). Eagerly destroying frames during the search would erase that context.

## Question 5

**What's the difference between an error and a panic? Give the rule of thumb.**

An **error** is an *expected* failure that's part of normal operation (missing file, bad input) — you handle it. A **panic** (Go) or `panic!` (Rust) signals a *bug* or violated invariant (index out of bounds, nil dereference) where there's no sensible way to continue, so the default is to crash. Rule of thumb: **errors for things that can go wrong; panics for things that mean your code is broken.** Using panic for a missing file, or swallowing a real bug as an error, are both mistakes.

## Question 6

**Why must cleanup run on both the happy path and the error path, and how do languages guarantee it?**

If a file only closes on success, any error path leaks the handle — multiply by thousands of requests and you exhaust resources. Languages provide guaranteed-cleanup mechanisms that run on *every* exit: `finally` (Java/JS/Python), `defer` (Go), `Drop`/destructors (Rust/C++ RAII), `try-with-resources` (Java). They run in **LIFO** order (reverse of acquisition), so a lock taken then a file opened releases the file then the lock — which is what correctness requires.

## Question 7

**Why did most languages decline to copy Java's checked exceptions?**

Checked exceptions put failure in the type system, but they **compose badly**: higher-order functions and lambdas can't easily propagate an arbitrary checked exception (the functional interfaces would need to be generic over thrown types). They're **version-brittle**: adding a failure mode changes the `throws` clause, breaking every caller. And they **push developers toward swallowing** (`catch (Exception e) {}`) or laundering into `RuntimeException`. The lesson isn't "effect typing is bad" — Rust's `Result`/`?` is effect typing that *works* because propagation is one character, error conversion is automatic via `From`, and it's value-based so it composes through generics.

## Question 8

**In one sentence, how do exceptions, generators, async/await, and dependency injection relate?**

They're all the same primitive: **suspend the current computation, hand its continuation to a handler, and let the handler decide whether and how to resume it** — exceptions discard the continuation (never resume), async and generators resume it once, dependency injection resumes it immediately with a value, and backtracking resumes it many times. Algebraic effects expose this directly; the rest are special cases.

---

## Language-Specific

## Question 9

**(Java) What is the difference between checked and unchecked exceptions, mechanically and in design?**

Mechanically, a **checked** exception (subclass of `Exception` but not `RuntimeException`) must be caught or declared in the method's `throws` clause — the compiler enforces it. An **unchecked** exception (`RuntimeException`/`Error` subclasses) imposes no such requirement. Design-wise: checked is meant for *recoverable conditions a caller should handle* (`IOException`), unchecked for *programming errors* (`NullPointerException`, `IllegalArgumentException`) and unrecoverable conditions (`OutOfMemoryError`). In practice, the friction of checked exceptions (especially with lambdas/streams) leads many codebases to prefer unchecked.

## Question 10

**(Java) Why is constructing an exception sometimes the dominant cost, and how do you avoid it?**

`new Exception()` calls `fillInStackTrace()`, which walks the entire stack to record the trace — for a deep stack that walk dominates, far exceeding the unwind/catch cost. Avoid it by suppressing trace capture: use the `Throwable(msg, cause, enableSuppression, writableStackTrace=false)` constructor, preallocate a singleton exception, or override `fillInStackTrace()` to return `this`. The JVM also auto-elides traces under fast-throw of the same exception (`-XX:-OmitStackTraceInFastThrow` disables it), which is why production logs sometimes show a traceless NPE.

## Question 11

**(C++) Explain RAII and how it interacts with exception unwinding. What about `noexcept`?**

RAII ties a resource's lifetime to an object: the constructor acquires, the **destructor releases**. During unwinding, each frame's local objects are destroyed in reverse construction order, so resources are released even when an exception propagates — no `finally` needed. `noexcept` promises a function won't throw, letting the compiler omit unwind machinery and optimize (e.g., `std::vector` move-on-grow). If a `noexcept` function *does* let an exception escape, `std::terminate` is called. Also: a destructor that throws *during* unwinding triggers `std::terminate` (two exceptions can't be in flight), so destructors should be `noexcept`.

## Question 12

**(C++) What is `-fno-exceptions` and when would you use it?**

It disables C++ exceptions: `throw` is forbidden, and the compiler omits unwind tables (LSDA cleanup actions). Used in kernels, embedded systems, and game engines that ban exceptions for **binary size** and **deterministic latency**. The trade-off is you must handle errors with return values / error codes / `std::expected`, and you cannot link against code that throws across your boundary. Note `.eh_frame` CFI may still exist for unwinding-as-backtrace, but exception cleanup machinery is gone.

## Question 13

**(Go) Walk through what `panic` and `recover` actually do.**

`panic(v)` stops normal execution and runs the current function's **deferred** calls in LIFO order, then propagates to the caller, running *its* deferreds, and so on up the goroutine. If a deferred function calls `recover()`, the panic **stops**: `recover()` returns the panic value and the goroutine resumes from that deferred function's return. If the panic reaches the top of the goroutine uncaught, the program crashes with a stack trace. Crucially, `recover()` only does anything **inside a deferred function** — calling it in normal code returns `nil`. Idiomatic Go reserves panic for truly exceptional cases and uses `error` values for normal failures.

## Question 14

**(Go) Why does Go use explicit `error` return values instead of exceptions? What's the cost?**

So that **every failure is visible at the call site** and shows up in code review — you can't accidentally not-see an error path. It also keeps control flow linear (no non-local jumps) and cheap (just a return, no unwinding/trace capture). The cost is **verbosity** (`if err != nil` everywhere) and that Go doesn't *force* you to check the error (you can `_` it away), so the discipline relies on convention, `errcheck`/linters, and review.

## Question 15

**(Rust) Desugar the `?` operator. Does it unwind the stack?**

No unwinding. `let x = f()?;` desugars roughly to:

```rust
let x = match f() {
    Ok(v)  => v,
    Err(e) => return Err(From::from(e)),
};
```

It's an ordinary **early return** — as cheap as any return. `From::from` auto-converts a lower-level error into the function's error type. `?` also works on `Option` (returning `None`). Unwinding in Rust is reserved for `panic!`, a separate, expensive mechanism.

## Question 16

**(Rust) Explain `panic = "unwind"` vs `panic = "abort"`.**

`unwind` (default) makes `panic!` walk the stack running `Drop` impls (like C++ destructors), using the Itanium unwind machinery; it can be caught at thread boundaries via `catch_unwind`. `abort` makes `panic!` **immediately terminate** the process — no unwinding, no `Drop`, no unwind tables (smaller binary). Choose `abort` for size/embedded and a "panics are always fatal" guarantee; `unwind` when you need cleanup to run or want to isolate panics at thread/task boundaries.

## Question 17

**(Haskell) How do `Maybe`/`Either` model failure, and what does monadic sequencing buy you?**

`Maybe a` is `Just a` or `Nothing` ("a value or nothing"); `Either e a` is `Left e` (error) or `Right a` (success). Failure is an **ordinary value** — no throwing. Monadic sequencing (`>>=` / `do`-notation) chains fallible steps so the first failure **short-circuits** the rest without nested `case`s — "railway-oriented programming." The whole pipeline stays linear and fully typed; the type signature documents that the computation can fail. `IO` is the effect monad that sequences side effects similarly.

## Question 18

**(JavaScript) How do synchronous and asynchronous failures differ in propagation?**

A **synchronous** failure `throw`s and travels up the call stack to a `try/catch`. An **asynchronous** failure becomes a **rejected Promise** — it *can't* use the call stack because by the time it fails, the calling stack is gone. The rejection propagates through `.then`/`.catch` chains; `await` re-injects a rejection as a synchronous `throw` at the await point, so `try/catch` works again. A rejected Promise that nobody `await`s or `.catch`es becomes an **unhandled rejection** — a failure with no live stack to land on.

## Question 19

**(JS/general) Why is `await` the seam where async error handling happens?**

Because `await` is where a live continuation exists to receive the result. The off-stack failure (the rejected Promise / failed `Future`) is reattached to **whatever is awaiting it**. Before the await, there's no synchronous stack to throw into; at the await, the runtime resumes the awaiting continuation with either the value or the error. This is why you wrap async failures in `try/catch` *at* the `await`, not deep inside the async operation.

---

## Tricky / Trap

## Question 20

**A `try` block throws, and the `finally` block has a `return 7;`. What does the function return, and where did the exception go?**

It returns **7**, and the exception is **silently swallowed**. A `return` (or another `throw`) inside `finally` *replaces* the in-flight exception or return value. This is a classic bug: cleanup code hijacks control flow and destroys the original failure. The fix: never `return`/`throw` from `finally`; keep cleanup side-effect-light and non-throwing.

## Question 21

**Someone says "I'll just use `recover()` to handle all my errors in Go." What's wrong?**

Two things. First, `recover()` only works inside a **deferred** function — call it in normal code and it returns `nil`. Second, and more importantly, it's **un-idiomatic and dangerous**: panic is for *bugs*, not normal failures. Using `recover` as general error handling means you're catching invariant violations and continuing — potentially serving corrupt state. Normal failures should be `error` values checked with `if err != nil`. Reserve `recover` for boundaries (e.g., a request handler) where you want one bad request not to crash the server.

## Question 22

**A C++ exception is thrown and never caught. Do your local destructors run?**

**Not necessarily — typically no.** In two-phase unwinding, Phase 1 searches for a handler *without* unwinding. If **no** handler is found, the implementation may call `std::terminate` **with the stack intact** (Phase 2 never runs), so your local destructors **do not** execute. Code that assumes "destructors always run, even on uncaught exceptions" is wrong. This is also why throwing an exception that escapes `main` or a thread's top function is treated as a hard error.

## Question 23

**Your error path is tanking p99 latency even though it's rarely taken. What's the likely cause?**

The "rare" path probably **isn't rare**, or each throw is enormously expensive. Two suspects: (1) exceptions used as **control flow** (e.g., throwing to break out of recursion or to signal a cache miss), so they happen far more than "errors" should; (2) **stack-trace capture** cost (Java/Python) — constructing the exception walks the whole stack. Fix by switching hot paths to **error values** (no unwinding, no trace) or, if exceptions are truly cleanest, suppressing trace capture. Profile to confirm the time is in *constructing/throwing*, not the actual handler.

## Question 24

**An effect handler resumes the continuation twice. A file was opened between the two performs. What happens?**

The file is opened **twice** — and any `defer`/`Drop`/`finally` captured in the continuation also runs **twice**. Multi-shot resumption **replays** all side effects captured in the continuation. Imperative cleanup assumes "runs once," so multi-shot can double-open, double-free, double-send, or double-charge. This is *the* core hazard of general effect handlers and why most practical systems (OCaml 5, async runtimes) restrict to **one-shot** continuations, where resuming twice is an error.

## Question 25

**You "recover" from a panic that was actually a heap-corruption / invariant violation and keep serving requests. Why is this worse than crashing?**

Because the panic *signaled that the process state is no longer trustworthy*. Continuing means you now serve results computed from corrupt state — silent data corruption that can propagate to storage and other systems. Crashing is the *safe* failure: it stops the damage and (with a supervisor) restarts from a known-good state. This is the core of the **errors/panics/aborts** taxonomy: classify by **how much you trust the process afterward**, and never recover past an abort-worthy condition.

## Question 26

**Code throws an exception across a C / FFI boundary (or out of a callback into a C library). What happens?**

**Undefined behavior**, typically a crash or `terminate`. The C frames have no personality routine and no unwind handlers/LSDA, so the unwinder can't safely unwind through them. The rule: **catch every exception before it crosses an ABI/`extern "C"`/FFI boundary** and convert it to an error code. The same applies to unwinding through hand-written assembly or a JIT that didn't register unwind info.

## Question 27

**Your code works on x86 but the *async error* gets lost on a particular runtime. A junior says "add a try/catch." Why might that not help?**

If the failure is **asynchronous** (a rejected Promise, a failed `Future`), a synchronous `try/catch` around the *call* won't catch it — the failure arrives later, off the original stack. You must observe it where the continuation lives: `await` it inside the `try`, attach `.catch`, use `.exceptionally`/`.handle`, or check the `Result` the async fn returns. Wrapping the *fire-and-forget* call in `try/catch` catches only the synchronous setup, not the eventual async rejection.

## Question 28

**Is Rust's `?` operator the same mechanism as a `panic!`? A candidate says "they're both error handling."**

No — different mechanisms entirely. `?` is **value-based propagation**: an early `return Err(...)`, cheap, no stack unwinding, for **recoverable** errors via `Result`/`Option`. `panic!` is **unwinding** (or abort): expensive, runs `Drop`s, for **bugs/unrecoverable** conditions. Conflating them is the error-vs-panic confusion. A function's `Result` return is its *recoverable* failure surface; `panic!` is the *"this should never happen"* surface.

---

## Design

## Question 29

**Design a failure taxonomy for a backend service. How do you decide error vs panic vs abort?**

Classify by **trust-after-failure**, not by cause:

- **Error (recoverable):** the caller can reasonably handle it — bad request, not-found, transient downstream failure. Modeled as values (`Result`/`error`), handled locally, surfaced to clients as appropriate status codes.
- **Panic (bug, contain at boundary):** an invariant is violated; the *request* is doomed but the *process* may survive. Allowed in code, **recovered only at the request/worker boundary**, logged with full context, returns a 500.
- **Abort (state untrustworthy):** heap corruption, failed release-mode assert, OOM — terminate the process immediately, no cleanup that might touch bad state; let an orchestrator restart it.

I'd codify this as policy (lint for `unwrap`/`panic` on recoverable paths), define exactly one recovery boundary per request, and ensure abort triggers are explicit.

## Question 30

**Explain let-it-crash and supervisors. When does it work, and when does it fail?**

Let-it-crash: don't defensively handle every error; let an isolated process **crash** on the unexpected and have a **supervisor** restart it from a known-good state per a strategy (`one_for_one`, etc.) with intensity/period limits. It works when (a) processes are **shared-nothing**, so a crash can't corrupt neighbors, and (b) **restart is cheap** and restores clean state — exactly the BEAM/Erlang model. It **fails** when applied over shared mutable memory (you restart *into* the corruption), when restart loses critical in-flight state, or without restart limits (restart storms on a deterministically-failing child). It's the macro-scale version of "panic, recover at a boundary."

## Question 31

**Design error propagation for a distributed system where no single stack spans the failure.**

Since no call stack connects the services, rely on **context chains and trace correlation**: each layer wraps the error with "what I was doing" (Go `%w`, exception chaining, structured fields), and a **trace/correlation ID** flows through every hop so you can reconstruct the causal path across processes. The error's *type* matters less than its *reconstructable chain*. I'd also distinguish retryable vs terminal failures in the wire protocol, propagate deadlines/cancellation (a control-flow effect) so downstream work stops, and ensure every async boundary observes failures (no unhandled rejections, no silently dropped `Future`s).

## Question 32

**You're evaluating a new language's algebraic-effects system. What do you check?**

(1) **Resumption discipline** — one-shot or multi-shot? One-shot is cheap and preserves linear-resource reasoning; multi-shot is powerful but replays side effects and cleanup. (2) **Cleanup guarantees** — does discarding a continuation (exception-like) still run resource cleanup? (3) **Effect typing ergonomics** — does it track effects in signatures, and does effect polymorphism/inference keep it usable, or does it repeat checked exceptions' composition failure? (4) **Performance** — are tail-resumptive handlers compiled to plain calls? What's continuation-capture cost? (5) **Interop** — how do effects coexist with imperative cleanup (RAII/`defer`), locks, and FFI? (6) **Maturity** — tooling, debuggability of effectful stack traces, ecosystem.

## Question 33

**When would you choose exceptions over error values, and vice versa — argue both sides.**

**Exceptions** when: failures are genuinely rare and exceptional, you want the happy path uncluttered, one handler can serve many call sites, and you want a stack trace for free — typical for application logic in Java/Python/C#. Cost: invisible at the call site, expensive to throw, needs RAII/`finally` to avoid leaks. **Error values** when: failures are frequent/expected, you want every error visible and reviewable, you need cheap propagation with no unwinding, and silent swallowing would be catastrophic — typical for systems software, network services, libraries. Cost: verbosity, and (in Go) reliance on discipline to check them. Rust's `Result`/`?` is the synthesis: explicit *and* concise *and* compiler-enforced. The deciding factors are failure frequency, the cost of a missed error, and whether you need the happy path or the error path to be the readable one.

---

## Cheat Sheet

```text
+------------------------------------------------------------------+
| EFFECT & ERROR EXECUTION MODELS — MUST-KNOW                       |
+------------------------------------------------------------------+
| throw = SEARCH up the stack, not a jump (unwind + run cleanup)   |
| zero-cost exceptions = 0 cost on happy path, EXPENSIVE on throw  |
| two-phase unwind: search (stack intact) then cleanup/dispatch    |
| setjmp/longjmp = cheap throw, costs every try; no C++ cleanup    |
| cleanup runs LIFO: destructors / defer / finally / Drop          |
+------------------------------------------------------------------+
| error  = expected failure -> handle (Result / error value)       |
| panic  = bug -> contain at a boundary (recover / catch_unwind)   |
| abort  = state untrustworthy -> terminate, NO cleanup            |
| choose tier by TRUST-AFTER-FAILURE, not by cause                 |
+------------------------------------------------------------------+
| Go    : err values + panic/recover (recover only in defer)       |
| Rust  : Result + ?  (early return, no unwind) ; panic! (unwind)  |
| Java  : checked vs unchecked ; trace capture = main throw cost   |
| C++   : RAII + two-phase ; noexcept ; -fno-exceptions            |
| Haskell: Maybe/Either + monadic short-circuit (railway)          |
| JS    : try/catch (sync) ; rejected Promise (async) ; await=seam |
+------------------------------------------------------------------+
| UNIFYING IDEA: effects = perform op, hand handler the continuation|
|   resume 0x  = exception      resume 1x = async/generator/DI      |
|   resume Nx  = backtracking/STM (REPLAYS side effects + cleanup!) |
+------------------------------------------------------------------+
| TRAPS: return-in-finally swallows; uncaught C++ skips dtors;     |
|   recover() only in defer; throw across FFI = UB; multi-shot     |
|   replays cleanup; recovering past corruption serves bad data    |
+------------------------------------------------------------------+
```

---

## Further Reading

- *Itanium C++ ABI: Exception Handling* — two-phase unwinding and personality routines. https://itanium-cxx-abi.github.io/cxx-abi/abi-eh.html
- *The Go Blog — "Defer, Panic, and Recover."* https://go.dev/blog/defer-panic-and-recover
- *The Rust Book*, ch. 9, and *The Rustonomicon*, "Unwinding."
- *Effective Java* — Bloch, on exception design (checked vs unchecked, fail-fast).
- *Anders Hejlsberg on the trouble with checked exceptions* (interview).
- Daan Leijen, *"Algebraic Effects for Functional Programming"* (Koka); *OCaml 5 Effects* manual.
- Plotkin & Pretnar, *"Handlers of Algebraic Effects."*
- Joe Armstrong, *"Making Reliable Distributed Systems in the Presence of Software Errors"* — let-it-crash and supervision.
- Scott Wlaschin, *"Railway Oriented Programming."* https://fsharpforfunandprofit.com/rop/
