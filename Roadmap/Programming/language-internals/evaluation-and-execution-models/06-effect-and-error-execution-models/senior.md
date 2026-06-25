# Effect & Error Execution Models — Senior Level

> **Topic:** [Effect & Error Execution Models](README.md)
> **Focus:** The unwind tables themselves (DWARF CFI, `.eh_frame`, LSDA), Windows two-phase SEH, the real cost of stack traces, why checked exceptions failed, and the first glimpse of the unifying idea: effects, async errors, and exceptions are all *control-flow effects* — and continuations are their substrate.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Summary](#summary)
14. [Further Reading](#further-reading)

---

## Introduction

> Focus: **What is physically in the binary that lets a runtime unwind a stack it has never seen before?** And **why do exceptions, generators, async/await, and dependency injection all turn out to be the same mechanism wearing different clothes?**

At the middle level we said the compiler emits "side tables" that the unwinder reads. This page opens those tables. On the SysV/Linux/macOS world they're **DWARF Call Frame Information** in the `.eh_frame` section, plus a per-function **Language-Specific Data Area (LSDA)** describing call sites, cleanups, and catch type filters. On Windows, the mechanism is **Structured Exception Handling (SEH)** with its own two-phase model, `.pdata`/`.xdata` sections, and unwind codes. Understanding these answers practical senior questions: why throwing is slow, why `-fno-exceptions` shrinks binaries, why a missing/corrupt `.eh_frame` makes a crash undebuggable, and why "zero-cost" is precise about *which* cost is zero.

This page also confronts two design-level realities a senior owns. First, **the cost of stack traces**: in Java and Python, the dominant cost of an exception is often not the unwind but the *capture* of the trace at construction time, which walks the entire stack. Second, **Java's checked-exception experiment**: a bold attempt to put failure into the type system that most subsequent languages declined to copy — and *why* they declined is a genuinely instructive story about the ergonomics of effect typing.

Finally, this page plants the seed of the big unifying idea. Exceptions are a *non-local control-flow effect*: a computation that, instead of returning, *transfers control elsewhere*. So is a generator's `yield`. So is `await` suspending a coroutine. So is throwing. So is asking a dependency-injection context for a value. The modern realization — made concrete by **algebraic effects** and grounded in **delimited continuations** — is that *all* of these are the same primitive: **"pause this computation, hand its continuation to a handler, let the handler decide what to do."** `senior.md` introduces this lens; `professional.md` builds the full machine.

> 🎓 **Why this matters at this level:** A senior is the person who explains *why* the build flag, *why* the latency spike on the error path, *why* the new language's `try`/effect system looks the way it does. That requires seeing through the surface syntax to the shared machinery: unwinding, continuations, and the handler-dispatch pattern that exceptions, async, and effects all instantiate.

---

## Prerequisites

- **Required:** The middle page: two-phase unwinding, landing pads, zero-cost vs `setjmp`/`longjmp`, `?` desugaring, `panic`/`recover`.
- **Required:** Comfort reading assembly-adjacent concepts: stack pointer, frame pointer, return address, callee-saved registers.
- **Required:** Familiarity with at least one async model (JS Promises, Rust `Future`, Go goroutines/contexts, Java `CompletableFuture`).
- **Helpful:** Awareness of what a continuation-passing style (CPS) transform is, even vaguely.
- **Helpful:** Some exposure to a functional language with monadic error handling (`Either`, `Result`, `IO`).

You do **not** yet need:

- The full operational semantics of effect handlers or a hand-built one-shot continuation runtime (that's `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **DWARF CFI** | Call Frame Information: a bytecode-like table that, for each PC, says how to restore the caller's registers and find the return address — i.e., how to unwind one frame. |
| **`.eh_frame`** | The ELF section holding DWARF CFI used for exception unwinding (the unwinder's "how to pop a frame" data). |
| **CFA** | Canonical Frame Address: a stable reference point in a frame from which saved registers are located. |
| **LSDA** | Language-Specific Data Area: per-function table of call-site ranges, their landing pads, and the type filters a catch matches. |
| **Personality routine** | Language runtime callback the unwinder invokes per frame; reads the LSDA to decide "handle, clean up, or keep going." |
| **SEH** | Windows Structured Exception Handling: OS-level two-phase exception mechanism shared by hardware and software exceptions. |
| **`.pdata` / `.xdata`** | Windows PE sections holding function tables and unwind codes for table-based unwinding (x64). |
| **Vectored / frame-based handlers** | SEH handler registration kinds; modern x64 SEH is table-based, not the old linked-list `__try` chain of x86. |
| **Stack trace capture** | Recording the chain of frames at the point an exception is created (Java `fillInStackTrace`, Python traceback). Often the dominant throw cost. |
| **Checked exception** | (Java) an exception the compiler forces callers to catch or declare in the signature. |
| **Effect (algebraic)** | An operation a computation can *perform* (raise, ask, yield, await) that suspends it and invokes a handler with its continuation. |
| **Continuation** | "The rest of the computation" from a given point, reified as a value you can call. |
| **Delimited continuation** | A continuation bounded by a marker (`prompt`/`reset`), capturing only up to that boundary — composable, unlike full `call/cc`. |
| **One-shot vs multi-shot** | Whether a captured continuation may be resumed at most once (exceptions, async) or many times (generators-as-streams, backtracking). |
| **Async error propagation** | How failure travels through futures/promises (rejection) rather than the synchronous call stack. |
| **Cancellation** | A control-flow effect that asks an in-flight async computation to stop early. |

---

## Core Concepts

### 1. `.eh_frame` / DWARF CFI: How to Pop One Frame

To unwind, the runtime must turn "I'm at PC `X` with stack pointer `SP`" into "the caller is at return address `R` with its registers restored." It can't hard-code this because every function has a different frame layout, and the layout even *changes within a function* (before vs after the prologue pushes registers). So the compiler emits **DWARF Call Frame Information**: a compact, bytecode-like program, indexed by PC range, that computes:

- the **CFA** (Canonical Frame Address) — typically `SP + offset` or `RBP + offset`,
- where each **callee-saved register** was spilled relative to the CFA,
- where the **return address** lives.

The unwinder *interprets* this CFI to reconstruct the caller's frame, repeatedly, walking up the stack. This is the same data that lets a debugger produce a backtrace and that `libunwind` / `_Unwind_*` use. It lives in `.eh_frame` (and is summarized by `.eh_frame_hdr` for fast lookup). Crucially, it's **read-only metadata** — the happy path never executes any of it, which is the entire "zero-cost" guarantee.

### 2. The LSDA: Where Cleanups and Catches Live

CFI tells you *how to pop a frame*; the **LSDA** tells the **personality routine** *what to do in this frame* for this exception. The LSDA encodes:

- a **call-site table**: for each range of PCs that can throw, where its **landing pad** is (or that there's no action),
- the **action table**: which cleanups run and which catch **type filters** apply,
- a **type table**: the `std::type_info` (or language equivalent) a `catch (T&)` matches against.

In **Phase 1**, the personality routine reads the LSDA to answer "does this frame catch this type?" In **Phase 2**, it reads it again to run cleanups and dispatch. `-fno-exceptions` (C++) omits LSDAs and `.eh_frame` cleanup actions entirely, shrinking the binary and forbidding `throw` — common in kernels, embedded, and game engines that ban exceptions for size/determinism.

### 3. Windows SEH: A Different Two-Phase Machine

Windows uses **Structured Exception Handling**, unifying *hardware* faults (access violation, divide-by-zero) and *software* exceptions (`RaiseException`, and C++ `throw` built atop it) under one OS mechanism. SEH is also **two-phase**:

- **First pass (search/dispatch):** the OS walks the handler chain calling each handler in *exception* mode asking "do you handle this?" — without unwinding.
- **Second pass (unwind):** the OS unwinds, calling handlers in *unwind* mode to run termination/cleanup (`__finally`), up to the handler that claimed the exception.

On x86 SEH used a per-thread *linked list* of registration records (`__try` pushed a node onto `FS:[0]`) — a happy-path cost, like sjlj. On **x64**, SEH is **table-based**: `.pdata` maps PC ranges to `.xdata` unwind info, so there's no per-`try` runtime cost — the modern zero-cost model, just with Microsoft's encoding instead of DWARF. C++ exceptions on MSVC are layered over SEH; this is why `__try/__except` (SEH) and `try/catch` (C++) coexist and why catching hardware faults as C++ exceptions is possible (but ill-advised) via SEH translators.

### 4. The Real Cost of a Throw Is Often the Stack Trace

A senior surprise: in **Java and Python**, the expensive part of an exception is frequently *not* the unwind — it's **capturing the stack trace** at construction. `new Exception()` calls `fillInStackTrace()`, which walks every frame and records it; Python builds a traceback object. For an exception thrown deep in a 100-frame stack, that walk dominates. Consequences:

- Exceptions used as control flow (e.g., to break out of recursion) are *much* slower than they look — the trace capture, not the catch, is the cost.
- The JVM has an optimization: under heavy throwing of the *same* exception, the JIT may elide the stack trace entirely (`-XX:-OmitStackTraceInFastThrow` controls it), so production logs sometimes show a traceless `NullPointerException`.
- Hot-path libraries preallocate a singleton exception or override `fillInStackTrace()` to return `this` (no capture) when the trace isn't needed.

In contrast, C++/Rust exceptions don't capture a trace by default (the unwinder *uses* `.eh_frame` to unwind but doesn't *record* a Java-style trace object), so their throw cost is the table walk and cleanup, not trace capture. This asymmetry explains a lot of cross-language performance folklore.

### 5. Why Checked Exceptions Failed (and What It Teaches)

Java tried to put failure into the type system: a method that can throw `IOException` must declare `throws IOException`, and callers must catch or re-declare. It's effect typing avant la lettre — the signature documents the failure effect. Yet C#, Kotlin, Scala, and essentially every later mainstream language **declined to copy it**. Why?

- **They don't compose across higher-order functions.** A `map`/`Stream`/lambda can't easily propagate an arbitrary checked exception; the functional interfaces would need to be generic over thrown types, which Java's type system can't express. Lambdas + checked exceptions are famously painful.
- **They leak implementation across versions.** Adding a new failure mode to a method changes its `throws` clause — a binary/source-breaking change rippling to every caller.
- **They push developers toward `catch (Exception e) {}`** — the swallow — or toward wrapping everything in unchecked `RuntimeException`, defeating the purpose.
- **The granularity is wrong.** Most callers can't meaningfully handle most checked exceptions; forcing a decision at every layer is friction without benefit.

The lesson isn't "effect typing is bad" — Rust's `Result` *is* effect typing for errors and it works, because (a) `?` makes propagation a single character, (b) error-type conversion is automatic via `From`, and (c) it's value-based and composes through generics. Checked exceptions failed on *ergonomics and composition*, and that critique directly shaped how modern effect systems are designed.

### 6. Async Error Propagation: Failure Off the Call Stack

When a computation is suspended and resumed later (a `Future`/`Promise`/coroutine), its failure **cannot travel up the synchronous call stack** — by the time it fails, the stack that called it is gone. So async failure rides a *different* channel:

- **JS Promises:** a failure becomes a **rejection**; it propagates through `.then`/`.catch` chains, and `await` *re-injects* it as a synchronous `throw` at the await point (so `try/catch` works again). An unobserved rejection becomes an "unhandled rejection" — a failure with no stack to land on.
- **Rust `Future`:** a fallible async fn returns `impl Future<Output = Result<T, E>>`; `?` inside `async` works because the error is in the *return value*, not the stack. The executor never sees the error; the awaiter does.
- **Java `CompletableFuture`:** failure is stored as a completed-exceptionally state; `.exceptionally`/`.handle` observe it; `.get()` re-throws it wrapped in `ExecutionException`.
- **Go:** failure is *still* a value (`error`) flowing through channels/returns; a `panic` in a goroutine that isn't recovered crashes the *whole program*, since there's no parent stack to catch it — a critical operational gotcha.

The unifying view: async error handling reattaches a failure to *whatever continuation is waiting on the result*, because the original call stack is no longer there.

### 7. Cancellation Is a Control-Flow Effect

Cancellation — asking an in-flight async task to stop — is not error handling per se, but it's the same *shape*: an out-of-band signal that changes a computation's control flow.

- **Go:** `context.Context` cancellation; a cancelled `ctx.Done()` channel propagates a stop request; functions return `ctx.Err()`.
- **Rust:** dropping a `Future` cancels it (cancellation = not polling it again); structured via `select!`/`CancellationToken` patterns.
- **JS:** `AbortController`/`AbortSignal`; an aborted fetch *rejects* with an `AbortError`.
- **Kotlin:** cooperative cancellation via `CancellationException` thrown at suspension points.

Notice Kotlin literally *models cancellation as a special exception* thrown at suspend points — making explicit that cancellation, errors, and suspension are all the same machinery: **non-local control transfer at well-defined points.** This is the bridge to effects.

### 8. The Unifying Lens: Effects as Resumable Operations

Step back and look at the family:

| Surface feature | What it really is |
|-----------------|-------------------|
| `throw` / exceptions | Suspend, transfer to a handler, **don't resume** (one-shot, abandons the rest). |
| generator `yield` | Suspend, transfer to consumer, **resume later** at the yield point. |
| `await` / coroutines | Suspend until a value is ready, **resume** with it. |
| dependency injection | Suspend, ask the environment for a value, **resume** with the answer. |

Every one is: *pause the current computation, capture "the rest of it" (its continuation), hand control to a handler, and possibly resume the continuation.* The reified "rest of the computation" is a **continuation**. **Algebraic effects** are the language feature that exposes this directly: you declare an *effect* (an operation), and a *handler* up the stack receives the operation **plus the continuation**, and decides whether to resume it (and with what), resume it many times, or not resume it (which is exactly an exception). `professional.md` builds this; here the takeaway is that **exceptions are the special case of effects where you never resume.**

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **DWARF CFI** | The fold-out structural blueprint of each floor: where the support beams (saved registers) are, so demolition (unwinding) can proceed safely floor by floor. |
| **LSDA** | The per-floor sign listing "fire wardens here handle chemical fires only" and "shut these valves on the way out." |
| **Personality routine** | The fire marshal who reads each floor's sign to decide whether this floor handles *this* kind of fire. |
| **SEH first/second pass** | Same evacuation drill, Microsoft's building code: confirm a warden exists, then evacuate floor by floor. |
| **Stack-trace capture cost** | Pausing the whole evacuation to photograph every floor on the way down — accurate record, but it's what actually slows you down. |
| **Checked exceptions** | A regulation requiring every doorway to be labeled with which fires it can pass — well-intentioned, but soon every door is plastered with labels nobody reads. |
| **Async rejection** | A message sent to whoever is *currently* waiting on your result, since the people who originally asked have long left the building. |
| **Effect handler** | A concierge you can call from any floor: you describe what you need, hand them a "call me back here" card (the continuation), and they decide whether and how to resume you. |

---

## Mental Models

### The "Metadata Interpreter" Model

The happy path is plain machine code with *zero* exception scaffolding. Alongside it lives a separate **program** — the CFI + LSDA — that only an *interpreter* (the unwinder + personality routine) ever runs, and only on throw. Throwing is "switch from executing your code to interpreting your unwind metadata." That framing makes both the zero-cost guarantee and the throw expense obvious.

### The "Where Does the Failure Land?" Model

For any failure, ask: *what stack is alive to receive it?* Synchronous throw → the call stack above. Async failure → whatever continuation is awaiting the result (the original stack is gone). Goroutine panic → nothing, unless `recover` is on *that* goroutine's stack. This single question predicts every async error-handling rule, including why unhandled rejections and uncaught goroutine panics are uniquely dangerous.

### The "Resume Card" Model of Effects

Imagine every suspendable operation hands a handler a **resume card** (the continuation). An exception is the card *torn up* (never resumed). `await` is the card *kept and called once* when data arrives (one-shot). A generator/backtracking search is a card the handler may call *many times* (multi-shot). The whole zoo of control features is "what does the handler do with the resume card?"

---

## Code Examples

### Inspecting unwind metadata (C++ on Linux)

```cpp
// Compile: g++ -O2 ex.cpp -o ex
// Then observe the side tables the compiler emitted (no code runs them on the happy path):
//   readelf -S ex            # lists sections; note .eh_frame and .eh_frame_hdr
//   readelf --debug-dump=frames ex   # decodes the DWARF CFI (CFA rules, saved regs)
//   objdump -dr ex           # the function body has NO try-setup instructions
struct R { ~R(); };           // having a destructor forces a cleanup landing pad
void g();
void f() {
    R r;                      // destructor must run if g() throws
    g();                      // a "call site" recorded in this function's LSDA
}
```

There is no instruction in `f` that "enters a try." The presence of `r`'s destructor causes the compiler to emit a landing pad and an LSDA entry mapping the call to `g()` to that pad — consulted only if `g` throws.

### Measuring the stack-trace cost (Java)

```java
public class ThrowCost {
    // Cheap exception: no stack trace captured.
    static final class Fast extends RuntimeException {
        Fast() { super(null, null, false, false); } // writableStackTrace = false
    }

    public static void main(String[] args) {
        int n = 1_000_000;
        long t0 = System.nanoTime();
        for (int i = 0; i < n; i++) try { throw new RuntimeException(); } catch (Exception e) {}
        long withTrace = System.nanoTime() - t0;

        long t1 = System.nanoTime();
        for (int i = 0; i < n; i++) try { throw new Fast(); } catch (Exception e) {}
        long noTrace = System.nanoTime() - t1;

        System.out.printf("with trace: %d ms%n", withTrace / 1_000_000);
        System.out.printf("no trace:   %d ms%n", noTrace / 1_000_000); // typically several x faster
    }
}
```

The traceless variant is dramatically faster, demonstrating that **trace capture, not unwinding, is the dominant cost** of a Java throw on a deep stack.

### Async error reattachment (JavaScript)

```javascript
async function fetchUser(id) {
  const res = await fetch(`/users/${id}`); // network failure -> rejected promise
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function main() {
  try {
    const u = await fetchUser(7);   // await re-injects the rejection as a throw HERE
    console.log(u);
  } catch (e) {
    console.error("failed:", e.message); // synchronous-looking catch of an async failure
  }
}

// Forgetting to await/catch leaks the failure:
fetchUser(7); // if it rejects -> "UnhandledPromiseRejection": no live stack to catch it
```

`await` is the seam where an off-stack rejection becomes an on-stack `throw`. Drop the `await`/`catch` and the failure has nowhere to land.

### Exceptions ≈ effects with no resume (conceptual, OCaml 5 effects)

```ocaml
(* An exception modeled as an effect whose handler never resumes the continuation. *)
open Effect
open Effect.Deep

type _ Effect.t += Fail : string -> 'a Effect.t   (* declare an effect *)

let run f =
  match_with f ()
    { retc = (fun x -> Ok x);
      exnc = raise;
      effc = fun (type a) (eff : a Effect.t) ->
        match eff with
        | Fail msg ->
            (* We receive the continuation `_k` but DO NOT resume it. *)
            Some (fun (_k : (a, _) continuation) -> Error msg)
        | _ -> None }

let example () = if true then perform (Fail "boom") else 42
(* run example  =>  Error "boom"  -- identical behavior to throw/catch *)
```

The handler gets the continuation `_k` and *chooses not to call it* — that choice is precisely what makes this behave like `throw`/`catch`. Resume the continuation instead, and the very same machinery becomes generators, async, or DI. `professional.md` develops these.

### Functional error sequencing (Haskell `Either` as the "railway")

```haskell
import Text.Read (readMaybe)

-- Each step may fail with a Left message; >>= short-circuits on the first Left.
parsePositive :: String -> Either String Int
parsePositive s = do
  n <- maybe (Left ("not a number: " ++ s)) Right (readMaybe s)
  if n > 0 then Right n else Left ("not positive: " ++ show n)

-- Chaining stays linear; failure exits the "track" without nested ifs.
total :: String -> String -> Either String Int
total a b = do
  x <- parsePositive a
  y <- parsePositive b
  Right (x + y)
```

The `do`-notation/`>>=` short-circuits on the first `Left` — "railway-oriented programming." This is exception-like short-circuiting achieved purely with values and the monad's bind, no unwinding.

---

## Pros & Cons

| Dimension | Insight |
|-----------|---------|
| **DWARF/`.eh_frame` zero-cost** | Pro: no happy-path cost, debuggable backtraces. Con: large read-only tables; corrupt/missing CFI makes crashes unanalyzable; throw is slow. |
| **`-fno-exceptions`** | Pro: smaller, deterministic, no unwind tables. Con: no `throw`; whole codebase + dependencies must avoid exceptions. |
| **Stack-trace capture** | Pro: priceless for debugging. Con: dominant throw cost in JVM/Python; tempts unsafe optimizations (traceless throws). |
| **Checked exceptions** | Pro: failure documented in the type. Con: poor composition with generics/lambdas, version-brittle signatures, encourages swallowing. |
| **Async rejection model** | Pro: lets failure follow the data, not the stack. Con: unobserved failures vanish; debugging across suspension points loses the original stack. |
| **Effects/continuations lens** | Pro: one mechanism unifies exceptions/async/generators/DI. Con: powerful but unfamiliar; multi-shot resumption interacts badly with imperative cleanup (see pitfalls). |

---

## Use Cases

- **Diagnosing throw-cost regressions:** when an "error path" tanks p99 latency, suspect exceptions used as control flow and stack-trace capture; switch hot paths to error values or traceless exceptions.
- **Embedded/kernel/game C++:** adopt `-fno-exceptions` and an error-value discipline (`std::expected`, error codes) for size and determinism.
- **API design across versions:** prefer value-based, convertible error types (`Result`/`error`) over checked exceptions to avoid signature-breakage and enable generic composition.
- **Async service boundaries:** define exactly where rejections/`Future` failures are observed; guarantee no unhandled rejection and no unrecovered goroutine panic escapes a request.
- **Building generators/coroutines/async runtimes:** recognize them as continuation capture; design with one-shot semantics unless you explicitly need multi-shot.
- **Evaluating new languages (Koka, OCaml 5, effect libraries):** assess their effect/handler system as a generalization of the error and async models you already know.

---

## Coding Patterns

### Pattern 1: Traceless exceptions for hot, expected throws

When an exception is genuinely the cleanest control flow but thrown frequently (e.g., a parser's "rollback" signal), suppress trace capture (`super(null, null, false, false)` in Java, a preallocated singleton, or just don't use exceptions). The cost you're killing is the trace walk.

### Pattern 2: Convert async failures at the await seam, not deep inside

Let async failures ride the future/promise; observe and translate them where you `await`/`.get()`/`select`, which is the only place a live continuation exists to handle them. Wrap with context there.

### Pattern 3: One `recover`/catch per concurrency unit

Every goroutine/thread/task gets exactly one boundary handler, because a failure has *no other stack* to land on. An unguarded goroutine panic crashes the process; an unobserved promise rejection is lost.

### Pattern 4: Railway-oriented chaining for multi-step fallible pipelines

Use `Result`/`Either` + `?`/`>>=`/`and_then` to keep a sequence of fallible steps linear and short-circuiting, instead of nested `try`/`if`. The first failure exits the track; no unwinding, fully typed.

### Pattern 5: Treat cancellation as a first-class control effect

Thread a cancellation token/`Context`/`AbortSignal` explicitly and check it at suspension points. Don't bolt cancellation on as an afterthought; it's the same non-local-transfer shape as errors and deserves the same care.

---

## Best Practices

- **Keep `.eh_frame`/unwind info present in production builds** even when stripping other debug data — without CFI, crash backtraces and unwinding break. (Strip `.debug_*`, keep `.eh_frame`.)
- **Decide exceptions vs. error-values per subsystem and stay consistent.** Mixing `-fno-exceptions` libraries with throwing ones is a recipe for UB at the boundary.
- **Never let exceptions cross an ABI/`extern "C"`/FFI boundary.** The foreign frames have no personality/unwind info; catch and convert to an error code first.
- **Avoid exceptions as control flow on hot paths**, primarily because of trace-capture and unwind cost; reserve them for the genuinely exceptional.
- **For public APIs, prefer convertible value errors over checked exceptions** to keep signatures stable and composition with generics/lambdas clean.
- **Guarantee every async failure is observed** — no unhandled rejections, no unrecovered goroutine panics, no swallowed `Future` exceptions.
- **Be cautious with effect handlers/continuations that may resume more than once** — they can re-run cleanup or resource acquisition in ways imperative code never expects.
- **Add context at boundaries, not at every frame** — wrap where it's meaningful (subsystem edges), to keep traces and error chains informative but not noisy.

---

## Edge Cases & Pitfalls

- **Stripped or missing `.eh_frame`.** A throw with no unwind info, or a crash with no CFI, produces a broken backtrace or `terminate` in the wrong place. JITs and hand-written assembly must register/provide unwind info (`__register_frame`) or unwinding *through* them fails.
- **Unwinding through frames without unwind info** (asm, FFI, JIT) → undefined behavior or abrupt `terminate`. This is why throwing across a C boundary is banned.
- **The JVM elides stack traces under fast-throw.** A repeatedly thrown NPE may log with *no stack trace* (`-XX:-OmitStackTraceInFastThrow` to disable). Engineers waste hours hunting a missing trace that the JIT optimized away.
- **`fillInStackTrace` cost dwarfs the catch.** Profiling "exception handling" often reveals the time is in *constructing* the exception, not unwinding to the handler.
- **Async failure with no awaiter.** A rejected promise nobody observes (JS), a `Future` whose result is dropped (Rust), a goroutine panic with no `recover` — the failure has no live stack and either vanishes silently or kills the process.
- **Cancellation that isn't cooperative leaks.** If a task never checks its cancellation token / never gets polled but holds resources, "cancellation" doesn't free anything. Cancellation needs cleanup paths too.
- **Multi-shot continuations re-run effects.** If a handler resumes a captured continuation twice, any side effects (and `finally`/`defer`/`Drop`!) between capture and the next effect can run twice — imperative cleanup assumes one-shot. This is *the* subtle danger of general effect handlers.
- **SEH translating hardware faults into C++ exceptions.** Catching an access violation as a C++ exception (via `_set_se_translator`) lets you "recover" from memory corruption — usually masking a fatal bug you should have crashed on.
- **Checked-to-unchecked laundering.** Wrapping every checked exception in a `RuntimeException` to escape `throws` clauses loses the type-level documentation that was the whole point, while keeping all the throw cost.
- **`panic = "abort"` interacting with `catch_unwind`.** Rust's `catch_unwind` only catches under `unwind`; under `abort` there's nothing to catch, so code relying on it for isolation breaks silently.

---

## Summary

- Unwinding is powered by **read-only metadata**: **DWARF CFI in `.eh_frame`** (how to pop each frame) plus the per-function **LSDA** (which cleanups/catches apply), interpreted by the unwinder and the **personality routine** only when a throw happens — the real meaning of "zero-cost."
- **Windows SEH** is a parallel two-phase machine unifying hardware and software exceptions; modern x64 SEH is table-based (`.pdata`/`.xdata`), like DWARF, while old x86 SEH used a costly per-`try` linked list.
- In **Java/Python the dominant throw cost is capturing the stack trace**, not unwinding — which is why traceless/preallocated exceptions exist and why the JVM sometimes elides traces entirely.
- **Checked exceptions** were effect typing for errors that most languages declined to copy, failing on **composition** (generics/lambdas), **version-brittleness**, and **encouraging swallowing** — a critique that directly shaped Rust's `Result`/`?` and modern effect systems.
- **Async failures ride a different channel** (promise rejection, `Future` error state) because the original call stack is gone; `await` reattaches the failure to the waiting continuation. **Cancellation** is the same non-local-transfer shape.
- The unifying insight: exceptions, generators, `await`, and dependency injection are all **"suspend, hand the continuation to a handler, maybe resume."** **Exceptions are the special case where you never resume.** **Algebraic effects + delimited continuations** make this one mechanism explicit — the subject of `professional.md`.

---

## Further Reading

- *DWARF Debugging Information Format* — the CFI/`.eh_frame` specification. https://dwarfstd.org/
- *Itanium C++ ABI: Exception Handling* (LSDA, personality routines). https://itanium-cxx-abi.github.io/cxx-abi/abi-eh.html
- Nico Brailovsky / Ian Lance Taylor, *"How exception handling works"* / *"Stack unwinding"* blog series — DWARF unwinding walkthroughs.
- *Microsoft Docs — Structured Exception Handling* and *x64 exception handling* (`.pdata`/`.xdata`). https://learn.microsoft.com/en-us/cpp/cpp/structured-exception-handling-c-cpp
- *"The exception model"* and `-XX:-OmitStackTraceInFastThrow` — JVM throw-cost and fast-throw optimization notes.
- Scott Wlaschin, *"Railway Oriented Programming"* — `Result`/`Either` sequencing as a design pattern. https://fsharpforfunandprofit.com/rop/
- *Anders Hejlsberg on why C# omitted checked exceptions* (interview) — the composition/versioning critique firsthand.
- Daan Leijen, *"Algebraic Effects for Functional Programming"* (Koka) — the gateway paper to the effects lens. https://www.microsoft.com/en-us/research/publication/algebraic-effects-for-functional-programming/
- *OCaml 5 Manual — Effect Handlers.* https://ocaml.org/manual/effects.html
