# Effect & Error Execution Models — Professional Level

> **Topic:** [Effect & Error Execution Models](README.md)
> **Focus:** The whole field as one mechanism. Delimited continuations as the substrate; algebraic effects and handlers as the surface; one-shot vs multi-shot; how exceptions, generators, async, and dependency injection collapse into a single primitive — and the operational, performance, and resource-safety consequences of building (or choosing) such a system.

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

> Focus: **There is one control-flow primitive underneath all of it.** Stack unwinding, `yield`, `await`, `recover`, dependency injection, backtracking search, transactional retry — they are the same operation parameterized by *what the handler does with the continuation.* This page builds that primitive from the ground (delimited continuations), shows the surface that exposes it (algebraic effect handlers), and works through the operational, performance, and resource-safety engineering of using it in anger.

By now you can read unwind tables and explain why a throw is slow. This level asks the harder question a language designer or runtime engineer must answer: **what is the most general way to model "a computation that does more than return a value," such that errors, effects, suspension, and resumption all fall out as special cases?** The answer, developed over decades from Scheme's `call/cc` through delimited continuations (`shift`/`reset`) to **algebraic effects and handlers** (Eff, Koka, OCaml 5, Effekt, Frank), is: **reify "the rest of the computation" as a value — a continuation — and let a handler installed up the stack receive each effectful operation together with that continuation and decide its fate.**

From this single primitive:

- An **exception** is an effect whose handler **discards** the continuation (never resumes) — control transfers and the abandoned computation dies.
- A **generator** is an effect (`yield`) whose handler **resumes** the continuation each time the consumer asks for another value.
- **async/await** is an effect (`await`) whose handler **stashes** the continuation in an event loop and resumes it when the awaited result is ready — exactly **one** resume per suspension.
- **Dependency injection / reader** is an effect (`ask`) whose handler **immediately resumes** the continuation with an environment value.
- **Non-deterministic search / backtracking** is an effect (`choose`) whose handler resumes the continuation **multiple times**, once per alternative.
- **Software-transactional retry** is an effect whose handler re-runs (resumes a fresh copy of) the continuation on conflict.

The axis that separates these is **how many times, and with what, the continuation is resumed** — zero (exceptions), one (async, generators-as-pull), or many (backtracking, STM, probabilistic). That axis — **one-shot vs multi-shot** — is also where all the *hard* engineering lives, because resuming a continuation more than once replays everything captured in it, which collides violently with imperative resource management (`defer`, `Drop`, destructors, mutexes).

This page also covers the *operational* end of error design that a staff engineer owns: **errors vs panics vs aborts** as a deliberate taxonomy, **let-it-crash** philosophy with **supervisors** (Erlang/OTP), **error context propagation** as a distributed-systems concern, and the cost model of all of the above on hot paths and at scale.

> 🎓 **Why this matters at this level:** When you evaluate a new language's effect system, design a service's failure taxonomy, build an async runtime, or debug why a backtracking handler corrupted a database, you are reasoning about *continuations and their resumption discipline*. This is the layer where "error handling" and "concurrency" and "control flow" stop being separate topics.

---

## Prerequisites

- **Required:** The senior page: DWARF/LSDA/SEH unwinding, the cost of stack traces, async error reattachment, the "effects as resumable operations" lens.
- **Required:** Solid grasp of at least one async runtime's internals (event loop, poll-based futures, or coroutine suspension).
- **Required:** Comfort with higher-order functions and, ideally, monadic abstraction (`bind`/`>>=`).
- **Helpful:** Prior exposure to `call/cc`, CPS, or a generator/coroutine implementation.
- **Helpful:** Familiarity with Erlang/OTP supervision or a similar fault-isolation model.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Continuation** | A first-class value representing "the rest of the computation" from a point; calling it resumes there. |
| **`call/cc`** | Scheme's "call-with-current-continuation": captures the *entire* rest of the program as an escaping, re-invocable function. Undelimited. |
| **Delimited continuation** | A continuation bounded by a prompt/`reset`; captures only up to the boundary, returns a value, and *composes*. Operators: `shift`/`reset`, `control`/`prompt`, `shift0`. |
| **Prompt / `reset`** | The marker delimiting how far a captured continuation extends. |
| **`shift` / `control`** | Operators that capture the delimited continuation up to the nearest prompt and pass it to a body. |
| **Algebraic effect** | A declared operation (`raise`, `yield`, `await`, `ask`) a computation may *perform*, suspending it and invoking the nearest handler. |
| **Effect handler** | Code that interprets performed effects; receives the operation's argument(s) and the **continuation**, and decides whether/how to resume. |
| **One-shot continuation** | A continuation that may be resumed **at most once** (exceptions, async, pull-generators). Cheap; compatible with linear resources. |
| **Multi-shot continuation** | A continuation that may be resumed **many times** (backtracking, STM, probabilistic). Requires copying captured state; hostile to imperative cleanup. |
| **Effect row / effect signature** | A type-system feature tracking which effects a function may perform (Koka's effect rows, Frank's abilities). |
| **Tail-resumptive handler** | A handler that resumes the continuation exactly once in tail position — optimizable to a plain call (no real capture needed). |
| **Let-it-crash** | A reliability philosophy: don't defensively handle every error; let a process die and a supervisor restart it in a known-good state. |
| **Supervisor** | (Erlang/OTP) a process whose job is to monitor children and restart them per a strategy on failure. |
| **Error context propagation** | Attaching the "what was I doing" chain to an error as it crosses layers (and process/service boundaries). |
| **Stack ripping / CPS** | Manually rewriting code into continuation-passing style — the painful thing effects/async exist to avoid. |

---

## Core Concepts

### 1. Continuations: "The Rest of the Computation" as a Value

In `f(g(x)) + 1`, when you're *inside* `g(x)`, the "rest of the computation" is: *take my result, apply `f`, add 1.* A **continuation** reifies that remainder as a callable value `k`, so `k(v)` means "proceed as if `g(x)` had produced `v`." Every control-flow feature is a statement about continuations:

- A normal `return v` is "call my continuation with `v`."
- A `throw` is "*abandon* my continuation and run a different one (the handler's)."
- A `yield v` is "hand `v` to the consumer and *save* my continuation to resume later."
- An `await p` is "save my continuation, register it as `p`'s callback, and let the scheduler run."

CPS makes this explicit by passing `k` to every function. Languages that don't want you to write CPS by hand provide a primitive to *capture* `k` on demand. That primitive is the heart of this topic.

### 2. Why Delimited, Not `call/cc`

Scheme's `call/cc` captures the **entire** remaining program — an undelimited continuation. It's powerful but pathological: the captured continuation *includes everything*, so it doesn't return a value (it never "ends"), composes poorly, and interacts terribly with resource scoping. **Delimited continuations** fix this by introducing a **prompt** (`reset`): `shift` captures the continuation only *up to the nearest prompt*. The captured piece is a normal function `A -> B` that **returns**, so you can call it, compose it, ignore it, or call it twice. Delimited continuations (`shift`/`reset`) are expressive enough to implement **all** of exceptions, generators, async, state, and non-determinism — they are the canonical substrate. Algebraic effects are, in essence, a typed, ergonomic, multi-prompt packaging of delimited continuations.

### 3. Algebraic Effects and Handlers: The Surface

An **algebraic effect** declares operations without giving them meaning; a **handler** gives them meaning. The shape:

```text
effect Ask : () -> Config            // declare an operation
perform Ask                          // a computation requests it
handle e with
  | Ask () k  -> resume k currentConfig   // handler: resume the continuation with a value
  | return x  -> x
```

When the computation `perform`s `Ask`, control transfers to the nearest enclosing `handle`. The handler receives the operation **and** the delimited continuation `k` (the rest of the computation from the `perform`). The handler then chooses:

- `resume k value` → the computation continues from the `perform` as if it returned `value` (effects-as-DI/reader, state, async).
- *don't* resume `k` → the computation is abandoned (exceptions).
- `resume k` *multiple times* → the computation runs once per resume (non-determinism, backtracking).

This is the unification. **Exceptions, dynamic binding, generators, async, and search are all just handlers that differ in how they treat `k`.** The same source `perform` can mean different things under different handlers — effects *decouple* the operation from its interpretation, which is also why effects double as a dependency-injection and mocking mechanism.

### 4. The Resumption-Count Axis Is Everything

| Resumes of `k` | Control feature | Resource implications |
|----------------|-----------------|------------------------|
| **0 (discard)** | Exception / `panic` / early-exit | Abandoned computation's cleanup must run during unwind (`Drop`/`defer`/destructor). |
| **1 (exactly once)** | async/`await`, pull-generator, reader/DI, state | Linear/affine resources safe; this is the "well-behaved" regime. |
| **0 or 1** | `Option`/`Result` short-circuit, `select` | Safe; the affine regime most type systems can check. |
| **≥0, many** | Backtracking, non-determinism, STM retry, probabilistic | Captured side effects (incl. cleanup) **replay**; hostile to mutexes, I/O, `Drop`. |

The entire difficulty of general effect handlers is the bottom row. A multi-shot handler that resumes `k` twice **re-executes everything in `k`**, including any `defer`/`Drop`/`finally` that was *between* the perform and the next perform. Imperative cleanup assumes "runs once"; multi-shot breaks that assumption. This is why most *practical* effect systems (OCaml 5, most async runtimes) restrict to **one-shot** continuations: they're cheaper to implement (you can move the stack segment instead of copying it) and they preserve linear-resource reasoning.

### 5. Exceptions, Formally, as the Degenerate Case

Place exceptions in this framework precisely: an exception is an effect `Raise : E -> empty` whose handler **never resumes** `k`. Because `k` is discarded, the abandoned stack between the `perform Raise` and the `handle` must still be torn down — which is *exactly* the unwinding-with-cleanup machinery from the middle/senior pages. So:

> Exceptions = effects + (handler discards continuation) + (the runtime guarantees cleanup runs on the discarded segment).

Conversely, an effect handler *generalizes* `try/catch`: `try/catch` is a handler hardwired to "discard continuation, run cleanup." A general handler can also *resume*, which `try/catch` can't — there's no `try`/`catch` that lets the handler say "fix the problem and continue from where you threw," but an effect handler can (this is the long-sought *resumable exception* / *condition system*, which Common Lisp's condition/restart system pioneered decades ago).

### 6. One-Shot Implementation: Stack Segments, Not Copies

A practical one-shot effect runtime (e.g., OCaml 5's fibers) implements continuations as **movable stack segments**. `perform` finds the handler, *slices off* the stack from the `perform` up to the handler's prompt, and hands the handler a token referencing that detached segment. `resume k` splices the segment back on and jumps into it. Because it's one-shot, the segment can be *moved* (not duplicated) — O(1)-ish, no deep copy. This is why OCaml 5 can offer effects with low overhead and why its `async`/scheduler libraries are built directly on them. Multi-shot would require **copying** the segment (and being able to copy or re-run all captured side effects), which is why OCaml's `Effect` is one-shot by default and raises if you resume twice.

### 7. The Operational Side: Errors vs Panics vs Aborts as a Taxonomy

A staff engineer designs failure as a deliberate three-tier taxonomy:

- **Error (recoverable, expected):** the caller can reasonably handle it — bad input, not-found, transient network. Modeled as values (`Result`/`error`) so handling is local and explicit.
- **Panic (recoverable-at-a-boundary, bug):** an invariant was violated; the *current operation* is doomed, but the *process* may survive if a boundary (request handler, supervised worker) contains it. Modeled as `panic!`/unwinding, recovered only at boundaries.
- **Abort (unrecoverable, fatal):** the process state is untrustworthy (OOM, corrupted heap, failed `assert` in release, double-fault). Terminate immediately; do **not** run cleanup that might itself touch corrupt state. `abort()`, `panic = "abort"`, `std::terminate`.

Choosing the wrong tier is a classic production failure: recovering from a panic that signaled corruption (now you serve corrupt data), or aborting on a recoverable error (now you crash on bad input). The tiers map to "how much do I trust the process state after this failure?"

### 8. Let-It-Crash, Supervisors, and Error Context

The Erlang/OTP insight inverts defensive programming: **don't** wrap every operation in error handling. Let a lightweight, isolated process **crash** on unexpected failure, and let a **supervisor** restart it from a known-good state per a restart strategy (`one_for_one`, `one_for_all`, `rest_for_one`, with intensity/period limits). This works because Erlang processes share nothing (a crash can't corrupt a neighbor) and restart is cheap. It's the macro-scale version of the errors/panics/aborts taxonomy: routine failures are values; unexpected failures crash a small unit and get restarted, rather than being heroically handled in place.

Orthogonally, **error context propagation** is how a failure stays diagnosable as it crosses layers and services: each layer wraps with "what I was doing" (Go `%w`, Rust `anyhow`/`thiserror` context, exception chaining, distributed trace/span IDs). At scale, the error's *context chain* and *trace correlation* matter more than its type — you need to reconstruct the causal path across processes, where no single stack ever existed.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Continuation** | A bookmark plus the *entire unread remainder* of the book as a portable object you can hand to someone else to finish. |
| **Delimited continuation** | A bookmark plus only the rest of *this chapter* (up to the prompt) — a self-contained piece you can re-read or skip. |
| **Effect handler** | A genie you summon mid-task: you state your wish (the operation) and give it a "send me back here" portal (the continuation); it grants the wish and may send you back, send you back many times, or not at all. |
| **One-shot vs multi-shot** | A single-use vs reusable return ticket. The reusable ticket is powerful but if your trip had side effects (you spent money, made a mess), using it again repeats all of them. |
| **Exception = discard k** | The genie hears your wish, decides the quest is hopeless, and simply *doesn't* send you back — your old path is abandoned. |
| **Let-it-crash + supervisor** | A factory that doesn't repair jammed robots in place; it powers the robot off and a foreman swaps in a fresh one from a known-good state. |
| **Errors/panics/aborts** | Wrong order at a restaurant (fix it), kitchen fire (evacuate this room, restaurant survives), gas leak in the whole building (evacuate everything, don't stop to tidy up). |
| **Error context chain** | A shipping label that accumulates a stamp at every depot, so when a package is lost you can trace its whole journey. |

---

## Mental Models

### The "Handler Decides the Fate of `k`" Model

Reduce the entire topic to one question at every effectful operation: *what does the handler do with the continuation `k`?* Discard it = exception. Call it once = async/generator/DI/state. Call it many times = search/STM. Every control feature, every error model, every async pattern is a point on this single axis. Internalizing this collapses a dozen "separate" topics into one.

### The "Decouple Operation from Interpretation" Model

A `perform Ask` *requests*; a handler *interprets*. The same program text means "read real config" under one handler and "return a test stub" under another — without changing the code. This is why effects are simultaneously an error model, a concurrency model, a DI framework, and a mocking framework: they all want the same decoupling of "what is requested" from "how it's satisfied."

### The "Trust-After-Failure" Model for the Taxonomy

Don't classify failures by their *cause*; classify them by **how much you trust the process afterward.** Fully trust → recoverable error (handle locally). Distrust this operation but trust the process → panic (contain at a boundary). Distrust the whole process → abort (terminate, don't touch state). This single lens picks the right tier every time.

### The "Cleanup Counts Resumptions" Model

Every piece of cleanup (`defer`/`Drop`/`finally`/destructor) silently assumes the code path it guards runs **exactly once**. The moment a handler can run a continuation zero or multiple times, that assumption is a bug waiting to happen: zero → cleanup may be skipped unless the runtime forces it on discard; many → cleanup re-runs. Always pair an effect system's resumption discipline with its cleanup guarantees.

---

## Code Examples

### Generators from delimited continuations (Racket `shift`/`reset`)

```racket
#lang racket
;; A generator is `yield` as an effect; the handler resumes the saved continuation
;; each time the consumer pulls. This is multi-step suspension via shift/reset.
(define (make-gen producer)
  (define resume #f)
  (define (yield v)
    (shift k (set! resume k) v))     ; capture "rest of producer", hand value out
  (define (next)
    (if resume (resume (void)) (reset (producer yield) 'done)))
  next)

(define g (make-gen (lambda (yield)
                      (yield 1) (yield 2) (yield 3))))
(list (g) (g) (g))   ; => '(1 2 3)
```

`yield` captures the producer's continuation up to the `reset` prompt and stashes it; `next` resumes it. The *same* `shift`/`reset` substrate, with the handler resuming once per pull, *is* a generator. Discard instead of resume and it's an exception.

### Effect handlers: one operation, many interpretations (OCaml 5)

```ocaml
open Effect
open Effect.Deep

type _ Effect.t += Ask : int Effect.t    (* a "reader"/DI effect *)

let program () =
  let x = perform Ask in                 (* request a value from the handler *)
  let y = perform Ask in
  x + y

(* Interpretation 1: dependency injection — resume with a fixed config. *)
let with_value v f =
  match_with f ()
    { retc = (fun r -> r);
      exnc = raise;
      effc = (fun (type a) (e : a Effect.t) -> match e with
        | Ask -> Some (fun (k : (a, _) continuation) -> continue k v)
        | _   -> None) }

let _ = with_value 10 program            (* => 20  : both Asks resumed with 10 *)

(* Interpretation 2: exception-like — DON'T resume, abandon the computation. *)
let abort_on_ask f =
  match_with f ()
    { retc = (fun r -> Some r);
      exnc = raise;
      effc = (fun (type a) (_ : a Effect.t) ->
        Some (fun (_k : (a, _) continuation) -> None)) }  (* discard k => like throw *)
```

The identical `program` is dependency injection under one handler and an exception under another. Only the handler's treatment of `k` (`continue k v` vs discard) differs.

### Async/await is one-shot effect handling (conceptual)

```text
async fn fetch(url):
    body = perform Await(http_get(url))   # suspend: hand k to the scheduler
    return parse(body)

# Scheduler handler:
#   on Await(future):
#       register: when future completes with v, `continue k v`   (resume EXACTLY once)
#       return control to the event loop now
```

`await` is `perform Await`; the runtime's handler stores `k` as the future's completion callback and resumes it **once** when the value arrives. A *rejected* future means the handler resumes `k` with an error (or re-perfoms a `Raise`) — which is precisely why async error propagation reattaches failure to the awaiting continuation.

### Non-determinism: a multi-shot handler (pseudo-effects)

```text
effect Choose : list[a] -> a

# Handler resumes k ONCE PER element -> explores all combinations.
handle program with
  | Choose options k ->
        results = []
        for opt in options:
            results += run(resume k opt)   # MULTI-SHOT: k invoked many times
        return results
  | return x -> [x]

# program: let a = perform Choose([1,2]); let b = perform Choose([10,20]); a+b
# => [11, 21, 12, 22]   (all combinations)
```

Resuming `k` multiple times re-runs the rest of the program once per choice — backtracking search expressed as a handler. Note the hazard: if `program` had opened a file between the two `Choose`s, that open would execute on **every** resumption.

### The errors/panics/aborts taxonomy in Rust

```rust
use std::fs;

// ERROR (recoverable, expected): the caller decides.
fn load(path: &str) -> Result<String, std::io::Error> {
    fs::read_to_string(path)            // Err on missing file — normal, handled by caller
}

// PANIC (bug, contain at a boundary): invariant violated.
fn checked_index(v: &[u8], i: usize) -> u8 {
    assert!(i < v.len(), "internal bug: index {i} out of range");
    v[i]                                 // panics on bug; a worker boundary may catch_unwind
}

// ABORT (unrecoverable): process state is untrustworthy.
fn on_corruption() -> ! {
    eprintln!("heap invariant violated; aborting to avoid serving corrupt data");
    std::process::abort()                // no unwinding, no cleanup that might touch bad state
}
```

Three failures, three mechanisms, chosen by *how much the process can be trusted afterward*.

### Let-it-crash with a supervisor (Erlang/OTP sketch)

```erlang
%% The worker does NOT defensively guard everything; it crashes on the unexpected.
handle(Req) ->
    {ok, Conn} = db:connect(),     %% if this returns {error,_}, the match fails -> crash
    do_work(Conn, Req).            %% supervisor will restart us from a clean state

%% The supervisor restarts crashed children; one_for_one isolates failures.
init([]) ->
    SupFlags = #{strategy => one_for_one, intensity => 5, period => 10},
    Child = #{id => worker, start => {worker, start_link, []}, restart => transient},
    {ok, {SupFlags, [Child]}}.
```

The worker's code is clean because failure isolation and recovery are the *supervisor's* job — the macro-scale analogue of "panic, recover at the boundary."

---

## Pros & Cons

| Dimension | Pros | Cons |
|-----------|------|------|
| **Algebraic effects (general)** | One mechanism for errors/async/generators/DI/state; decouples operation from interpretation; resumable exceptions; superb for testing/mocking. | Conceptually demanding; effect typing adds signature ceremony; immature tooling/ecosystem in most languages. |
| **Delimited continuations** | Maximally expressive substrate; compose; can implement everything above. | Hard to implement efficiently and to reason about; multi-shot fights imperative resources. |
| **One-shot restriction** | Cheap (move stack segment); preserves linear-resource/cleanup reasoning; matches async/generators. | Cannot express backtracking/STM/probabilistic directly. |
| **Multi-shot** | Expresses search, non-determinism, transactional retry elegantly. | Replays captured side effects incl. cleanup; needs copyable state; performance and correctness hazards. |
| **Errors-as-values taxonomy** | Explicit, local, composable, cheap; clear trust boundaries. | Verbose; discipline-dependent; needs context-wrapping conventions. |
| **Let-it-crash / supervisors** | Simple worker code; strong fault isolation; self-healing. | Requires shared-nothing isolation + cheap restart; restart loses in-flight state; not free in shared-memory languages. |

---

## Use Cases

- **Designing/evaluating an effect system** (Koka, OCaml 5, Effekt, Unison abilities, a library like `eff`/`fused-effects`): judge it by its resumption discipline, effect-typing ergonomics, and cleanup guarantees.
- **Building an async runtime or scheduler:** recognize `await` as one-shot continuation capture; choose stackful (fiber/segment) vs stackless (state-machine) representation accordingly.
- **Implementing generators/iterators/coroutines** without manual CPS: delimited continuations or one-shot effects give pull/push iteration directly.
- **Architecting a service's failure taxonomy:** map every failure to error/panic/abort by trust-after-failure; define boundary recovery and abort triggers explicitly.
- **Fault-tolerant systems:** apply let-it-crash + supervision where isolation and cheap restart hold (Erlang/Elixir/BEAM, or actor frameworks emulating it).
- **Distributed error diagnosis:** design error-context chains and trace correlation so a failure is reconstructable across processes where no single stack exists.

### When *not* to reach for general effects

- Hot, simple paths where a plain `Result`/`error` is clearer and faster.
- Teams/ecosystems without effect-system maturity — the cognitive and tooling cost outweighs the elegance.
- Anywhere multi-shot would silently replay I/O or cleanup; restrict to one-shot or avoid.

---

## Coding Patterns

### Pattern 1: Restrict to one-shot unless you can prove resource-safety

Default every handler/continuation to **at most one** resume. Reach for multi-shot only when the captured computation is *pure* (no I/O, no cleanup, no locks between performs), so replay is harmless. Document the discipline at the effect's declaration.

### Pattern 2: Pair every effect with explicit cleanup semantics

When defining an effect, specify what happens to in-flight cleanup if the continuation is discarded (exception-like) or replayed. In one-shot systems, ensure discard still runs `Drop`/`defer`; forbid resource acquisition on a path that might be multi-resumed.

### Pattern 3: Tail-resumptive handlers for performance

If a handler resumes `k` exactly once in tail position (the common DI/reader/state case), the runtime can compile it to an ordinary call — **no continuation capture at all**. Structure handlers to be tail-resumptive where possible; it's the fast path of effect systems.

### Pattern 4: A single failure taxonomy, enforced

Codify error/panic/abort as project policy: which error types exist, where panics are allowed and where they're recovered, what triggers abort. Lint/review for `unwrap`/`panic` on recoverable paths and for `catch`/`recover` of things that signal corruption.

### Pattern 5: Context-rich, correlatable errors at every boundary

Wrap errors with operation context and propagate a correlation/trace ID across process boundaries. The reconstructable *causal chain* is the asset; the error *type* is secondary at scale.

### Pattern 6: Let-it-crash only behind real isolation

Use crash-and-restart only where a crash cannot corrupt neighbors (separate process/actor, shared-nothing) and restart restores a known-good state. In shared-memory languages, simulate it with carefully bounded worker recycling, never by `recover`ing into a corrupted shared structure.

---

## Best Practices

- **Make resumption discipline explicit and conservative.** One-shot by default; multi-shot only for pure computations; never resume a continuation that captured an unreleased lock or open handle more than once.
- **Guarantee cleanup on the discard path.** An exception-like handler (discard `k`) must still tear down the abandoned segment's resources — verify your effect runtime does this, or do it manually.
- **Prefer tail-resumptive handlers** for hot effects (DI/state/reader) so the compiler elides capture.
- **Choose the failure tier by trust, not by cause.** Recoverable → value error; bug-but-process-survivable → panic recovered at a boundary; state-untrustworthy → abort without cleanup.
- **Never recover a failure that signaled corruption.** Recovering past an abort-worthy condition serves corrupt results; that's worse than crashing.
- **Use supervision where isolation is real.** Let-it-crash needs shared-nothing + cheap restart; don't fake it over shared mutable state.
- **Propagate context, correlate across services.** Wrap with "what I was doing"; attach trace IDs; design errors to be diagnosable where no single stack exists.
- **Measure the cost of your control-flow choices.** Effect capture, continuation copying, throw/trace capture, and async suspension all have real costs; profile hot paths and prefer cheap value-based propagation there.

---

## Edge Cases & Pitfalls

- **Resuming a one-shot continuation twice.** OCaml 5 raises `Continuation_already_resumed`; other systems may corrupt the stack. Multi-shot semantics require explicit support — don't assume.
- **Multi-shot replaying side effects.** A handler that resumes `k` N times re-runs every I/O, mutation, and *cleanup* captured in `k`. A `defer`/`Drop`/`finally` between two performs runs N times. This silently double-frees, double-sends, or double-charges.
- **Cleanup skipped on discard.** If the effect runtime *doesn't* run cleanup when a continuation is discarded (some research systems leave this to the programmer), abandoned resources leak. Verify the guarantee.
- **Effect handlers capturing locks across performs.** If `perform` suspends while a mutex is held and the handler runs other code (or another fiber) that wants the mutex → deadlock or non-reentrant violation. Don't hold locks across effect operations.
- **Recovering a panic that meant corruption.** Catching a panic that signaled a broken invariant and "continuing" propagates corrupt state. The taxonomy exists to prevent exactly this.
- **Abort running cleanup that touches bad state.** `abort` deliberately skips destructors; if you instead "gracefully shut down" on heap corruption, the cleanup itself may crash or worsen corruption.
- **Let-it-crash without isolation.** "Just restart it" over shared mutable memory restarts *into* the corruption. Crash-restart is only safe behind shared-nothing isolation.
- **Restart storms.** Supervisors without intensity/period limits can thrash, restarting a deterministically-failing child forever. OTP's intensity/period (and exponential backoff) bound this; design the limits.
- **Effect typing leaking into every signature.** Like checked exceptions, naive effect rows can make every higher-order function generic over effects; ergonomics (effect polymorphism, inference) determine whether the system is usable — the same lesson as checked exceptions.
- **Stackless async can't capture arbitrary continuations.** State-machine-based async (Rust, C# `async`) can only suspend at `await` points the compiler transformed; you can't `await` across an FFI callback or a non-`async` frame. Stackful fibers can, at a memory cost. Know which model you have.
- **Continuation capture vs. destructors in C++-like RAII.** General multi-shot continuations are fundamentally incompatible with RAII's "destroy once" model — a reason C++ has no first-class continuations and uses one-shot unwinding only.

---

## Summary

- There is **one substrate**: the **continuation** — "the rest of the computation" as a value. **Delimited** continuations (`shift`/`reset`, prompts) are the practical, composable form; **algebraic effects and handlers** are their typed, ergonomic surface.
- Every control feature is "**perform an operation, hand the handler the continuation, and let the handler decide its fate**." The deciding axis is **how many times `k` is resumed**: **0** = exceptions/`panic`, **1** = async/generators/DI/state, **many** = backtracking/STM/probabilistic.
- **Exceptions are the degenerate case**: an effect whose handler discards the continuation, with the runtime still guaranteeing the abandoned segment's cleanup runs (the unwinding machinery from earlier levels). General handlers *generalize* `try/catch` by being able to **resume** — true resumable exceptions, as in Lisp's condition/restart.
- **One-shot** continuations are cheap (move a stack segment) and preserve linear-resource/cleanup reasoning; **multi-shot** is expressive but **replays captured side effects and cleanup**, which is the central correctness hazard. Most practical systems (OCaml 5, async runtimes) are one-shot; **tail-resumptive** handlers compile to plain calls.
- The **operational taxonomy** — **error vs panic vs abort** — should be chosen by **trust-after-failure**, not cause: handle locally, contain at a boundary, or terminate without cleanup. Recovering past corruption is worse than crashing.
- **Let-it-crash + supervisors** is the macro-scale version: clean worker code, fault isolation via shared-nothing, cheap restart to a known-good state — valid only where isolation is real, with restart-intensity limits to avoid storms.
- At scale, an error's **context chain and trace correlation** matter more than its type, because failures must be reconstructed across processes where no single stack ever existed.

---

## Further Reading

- Gordon Plotkin & Matija Pretnar, *"Handlers of Algebraic Effects"* — the foundational paper. https://homepages.inf.ed.ac.uk/gdp/publications/Effect_Handlers.pdf
- Daan Leijen, *"Algebraic Effects for Functional Programming"* (Koka) and *"Type Directed Compilation of Row-Typed Algebraic Effects."*
- Matija Pretnar, *"An Introduction to Algebraic Effects and Handlers."* https://www.eff-lang.org/handlers-tutorial.pdf
- *OCaml 5 Effects* — manual and the *"Retrofitting Effect Handlers onto OCaml"* (PLDI 2021) paper on one-shot fiber implementation.
- Oleg Kiselyov & collaborators, *"Delimited Continuations"* and *"Freer Monads, More Extensible Effects."*
- Olivier Danvy & Andrzej Filinski, *"Abstracting Control"* — `shift`/`reset` origins; Filinski, *"Representing Monads."*
- *Structure and Interpretation of Computer Programs* and Friedman/Felleisen on `call/cc` and continuations.
- Joe Armstrong, *"Making Reliable Distributed Systems in the Presence of Software Errors"* (thesis) — let-it-crash and OTP supervision.
- *Common Lisp* condition/restart system (Seibel, *Practical Common Lisp*, ch. 19) — resumable exceptions decades early.
- Effekt, Frank, and Unison documentation — modern effect-typed languages worth studying comparatively.
