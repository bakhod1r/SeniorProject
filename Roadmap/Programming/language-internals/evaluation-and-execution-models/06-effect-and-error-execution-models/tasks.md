# Effect & Error Execution Models — Tasks & Exercises

> **Topic:** [Effect & Error Execution Models](README.md)
> **Focus:** Hands-on exercises that turn the mechanism into muscle memory — observe unwinding, measure throw cost, desugar `?` and `panic`, build a generator from continuations, and design a failure taxonomy. Each task has a self-check, a hint, and (for the harder ones) a sparse solution sketch.

---

## How to Use This Page

Work top to bottom; difficulty rises. For each task: attempt it, run it, then compare against the **Self-check**. Open the **Hint** only when stuck, and the **Solution sketch** only after a real attempt. Many tasks ask you to *predict output before running* — do that; the gap between your prediction and reality is where the learning is.

Difficulty key: 🟢 junior · 🔵 middle · 🟣 senior · 🔴 professional.

---

## Part 1 — Observing the Mechanism

### Task 1.1 — Prove cleanup runs on the error path 🟢

Write a program (any language) that opens a "resource", then throws/returns an error *before* an explicit close. Show that:

1. With a guaranteed-cleanup mechanism (`finally`/`defer`/`with`/RAII), the resource is released.
2. Without it (manual close at the bottom), the error path **skips** the close.

**Self-check:** You should see "released" printed on the error path *only* in version (1). If both print it, your "error path" didn't actually skip the manual close — make the error return *before* the manual close line.

<details><summary>Hint</summary>

In Go, put `defer r.Close()` right after opening, then `return errors.New("boom")`. For the broken version, remove the `defer` and put `r.Close()` at the bottom — the early `return` skips it.

</details>

### Task 1.2 — Reverse-order (LIFO) cleanup 🟢

Acquire three resources A, B, C in that order, each printing on acquire and release. Trigger an error after C. Predict the release order, then run it.

**Self-check:** Release order must be **C, B, A** (reverse of acquisition). If you got A, B, C, you released them manually in the wrong order instead of letting the language's scope/`defer`/destructor mechanism do it.

### Task 1.3 — `throw` is a search, not a jump 🔵

Write three functions `a → b → c` where `c` throws and only `a` catches. Add a print in `b` *after* the call to `c` (which should never run) and a print in `b`'s cleanup (which *should* run). Confirm: the post-call print is skipped, the cleanup print runs, and control lands in `a`'s catch.

**Self-check:** Output order should be: c's pre-throw print → b's cleanup print → a's catch print. The "b after call to c" print must **never** appear — proving control didn't return to `b` normally; it unwound through it.

<details><summary>Hint</summary>

In Java/JS/Python use `try { c(); System.out.println("never"); } finally { System.out.println("b cleanup"); }`. The `finally` runs during unwinding; the line after `c()` does not.

</details>

---

## Part 2 — Cost of Exceptions

### Task 2.1 — Measure throw cost vs return cost 🔵

Benchmark, over ~1,000,000 iterations: (a) a function that signals failure by **throwing**, caught by the caller, vs (b) the same function signaling failure by **returning an error value**, checked by the caller. Report the ratio.

**Self-check:** Throwing should be **dramatically** slower (often 10–1000×, language-dependent). If they're equal, you're probably not actually throwing in the loop (check the exception is constructed and propagated each iteration).

### Task 2.2 — Isolate the stack-trace cost (Java/Python) 🟣

In Java (or Python), compare throwing a **normal** exception vs one with stack-trace capture **disabled** (`super(msg, cause, false, false)` in Java; or compare to a sentinel-return baseline in Python). Measure both at a *deep* call stack (e.g., recurse 100 frames before throwing).

**Self-check:** The traceless variant should be several times faster, and the gap should **widen** as stack depth grows — confirming the dominant cost is *capturing the trace* (walking N frames), not unwinding to the handler.

<details><summary>Hint</summary>

Make the throw happen at the bottom of a 100-deep recursion. With trace capture, each throw walks ~100 frames. Without it, throw cost is flat regardless of depth. Plot cost vs depth for both.

</details>

### Task 2.3 — Find the unwind tables 🟣

Compile a small C++ program with a function that has a local object with a destructor and calls another function that may throw. Then:

```bash
g++ -O2 ex.cpp -o ex
readelf -S ex | grep eh_frame        # the DWARF CFI section exists
objdump -d ex                        # the function body has NO "enter try" instructions
```

Recompile with `-fno-exceptions` and compare binary size and the presence of cleanup actions.

**Self-check:** You should find `.eh_frame` present in the normal build and the *function body itself* containing no try-setup instructions (zero-cost on the happy path). With `-fno-exceptions`, the binary shrinks and `throw` no longer compiles.

---

## Part 3 — Error Values & Desugaring

### Task 3.1 — Hand-desugar Rust's `?` 🔵

Take a Rust function using two `?` operators and rewrite it **without** `?`, using explicit `match` and early `return Err(...)`. Confirm it behaves identically.

**Self-check:** Each `?` becomes `match expr { Ok(v) => v, Err(e) => return Err(e.into()) }`. If your rewrite changed behavior, you probably forgot the `.into()`/`From` conversion or returned the wrong type.

<details><summary>Solution sketch</summary>

```rust
// With ?:
fn f(a: &str, b: &str) -> Result<i32, MyErr> {
    let x: i32 = a.parse()?;
    let y: i32 = b.parse()?;
    Ok(x + y)
}
// Desugared:
fn f(a: &str, b: &str) -> Result<i32, MyErr> {
    let x: i32 = match a.parse() { Ok(v) => v, Err(e) => return Err(MyErr::from(e)) };
    let y: i32 = match b.parse() { Ok(v) => v, Err(e) => return Err(MyErr::from(e)) };
    Ok(x + y)
}
```

The key insight: `?` is pure early-return; no unwinding is involved.

</details>

### Task 3.2 — Reimplement `panic`/`recover` semantics in Go 🟣

Write a Go program where `panic` propagates through two functions, each with a `defer` that prints. The outermost has a `defer` that `recover()`s and converts the panic to an `error`. Predict the exact output order, then run.

**Self-check:** Deferred prints run **LIFO**, innermost function first, before the `recover` stops propagation. The recovered error should carry the panic value. If your program crashed instead of recovering, your `recover()` wasn't inside a deferred function on the path the panic travels.

### Task 3.3 — Railway-oriented chaining 🔵

Implement a 3-step pipeline (parse → validate → transform) where any step can fail, using your language's `Result`/`Either`/`Option` and its chaining operator (`?`, `and_then`, `>>=`, `flatMap`). The pipeline must **short-circuit** on the first failure without nested conditionals.

**Self-check:** Feeding bad input that fails at step 2 should never execute step 3, and the returned error should identify step 2. Your code body should read top-to-bottom with no nesting pyramid.

---

## Part 4 — The Unifying Idea

### Task 4.1 — A generator from a continuation 🔴

Using a language with delimited continuations (Racket `shift`/`reset`) or one-shot effects (OCaml 5), implement a generator that yields `1, 2, 3` on successive `next()` calls. Explain, in a comment, which line **captures** the continuation and which **resumes** it.

**Self-check:** Three calls to `next()` return `1`, `2`, `3`; a fourth returns your "done" sentinel. You should be able to point at exactly one capture site (`yield`/`perform`) and one resume site (`next`).

<details><summary>Solution sketch (Racket)</summary>

```racket
#lang racket
(define (make-gen producer)
  (define resume #f)
  (define (yield v) (shift k (set! resume k) v))   ; CAPTURE continuation up to reset
  (define (next)
    (if resume (resume (void))                     ; RESUME it
        (reset (begin (producer yield) 'done))))   ; prompt boundary
  next)
(define g (make-gen (lambda (y) (y 1) (y 2) (y 3))))
(list (g) (g) (g) (g))  ; => '(1 2 3 done)
```

`yield` captures the producer's continuation and stashes it in `resume`; `next` calls it. Discard `resume` instead of calling it, and `yield` becomes an exception.

</details>

### Task 4.2 — One operation, two handlers 🔴

In OCaml 5 (or pseudocode if no compiler), define a single effect `Ask` and a program that performs it twice and sums the results. Then write **two** handlers: one that **resumes** with a fixed value (dependency injection), and one that **discards** the continuation (exception-like). Show the same program produces different outcomes.

**Self-check:** Under the resuming handler you get a sum; under the discarding handler you get an "aborted"/error outcome. The *program text is identical* — only the handler's treatment of the continuation differs. That's the whole unification in one example.

### Task 4.3 — Demonstrate the multi-shot hazard 🔴

Write (or carefully reason about, in pseudocode) a multi-shot handler that resumes a continuation **twice**, where the continuation contains a side effect (e.g., "open file" / "increment counter" / "print"). Show that the side effect happens **twice**.

**Self-check:** The captured side effect must execute once per resume. State explicitly: if that side effect were a `defer`/`Drop`/`finally` (cleanup), it would *also* run twice — the reason imperative cleanup is incompatible with multi-shot continuations.

<details><summary>Hint</summary>

Put a `print "side effect"` between the `perform` and the program's end. A handler that does `resume k; resume k` (or loops over choices) re-runs everything after the `perform` — including that print — once per resume. Now imagine the print were a `file.Close()`.

</details>

---

## Part 5 — Design

### Task 5.1 — Classify failures into error / panic / abort 🟣

For each scenario, decide the tier (**error**, **panic**, or **abort**) and justify by **trust-after-failure**:

1. User submitted an email with no `@`.
2. A function received an index that's out of bounds due to a logic bug.
3. The allocator returned null / heap metadata is detected corrupt.
4. A downstream HTTP call timed out.
5. A release-mode invariant assert (`this list must be sorted here`) failed.

**Self-check:** Expected answers — (1) **error**, (2) **panic**, (3) **abort**, (4) **error**, (5) **panic** (or **abort** if a violated invariant means state is already corrupt). The justification, not the label, is what matters: how much do you trust the process afterward?

### Task 5.2 — Design recovery boundaries for a server 🔴

Sketch where a request-handling server should: (a) check error values, (b) `recover`/`catch_unwind` from panics, (c) `abort`. Specify exactly **one** panic-recovery boundary and explain why sprinkling `recover` everywhere is wrong.

**Self-check:** Your design should: check errors locally throughout; place a *single* panic boundary at the request/worker edge that logs context and returns 500; reserve abort for process-state-corruption signals. The boundary contains one bad request without killing the server; per-call `recover` would mask bugs and risk continuing on corrupt state.

<details><summary>Solution sketch</summary>

```text
[accept request]
   └─ handler wrapped in: defer recover() -> log+context -> 500   (THE one boundary)
        └─ business logic: returns (T, error); check `if err != nil` locally
              └─ on bug/invariant violation: panic (caught by the boundary above)
        └─ on heap corruption / failed release assert: abort (don't try to 500)
```

One boundary = panics from any depth in this request are contained here, converted to a 500 with context, and the server lives. Multiple boundaries fragment context and tempt you to "recover and continue" past real bugs.

</details>

### Task 5.3 — Critique a checked-exceptions design 🟣

A teammate proposes adding "checked errors" to a new language: every function must declare every error it can return, and callers must handle or re-declare. Write a short critique citing the historical reasons most languages declined Java's checked exceptions, and propose what to do instead.

**Self-check:** Strong answers mention: poor composition with higher-order functions/lambdas (can't be generic over thrown error types), version-brittleness (adding an error breaks every caller's signature), and the tendency to swallow or launder errors. Propose Rust's approach instead: value-based errors, one-character propagation (`?`), automatic error-type conversion (`From`), composing through generics.

### Task 5.4 — Design distributed error context 🔴

Design how an error should propagate across three services (A → B → C) where C fails. No single call stack spans them. Specify what metadata travels, how it's correlated, and how an on-call engineer reconstructs the causal chain.

**Self-check:** Your design should include: per-layer **context wrapping** ("what I was doing"), a **trace/correlation ID** propagated through every hop, a retryable-vs-terminal distinction in the error, and **deadline/cancellation** propagation so A's timeout stops work in B and C. The reconstructable chain — not the error type — is the deliverable.

---

## Self-Assessment Checklist

After completing these tasks, you should be able to answer "yes" to:

- [ ] I can demonstrate that cleanup runs on the error path, in LIFO order, and explain *why* via unwinding.
- [ ] I can measure that throwing is far more expensive than returning, and isolate stack-trace capture as a major component (in JVM/Python).
- [ ] I can hand-desugar Rust's `?` into `match` + early return, and explain why it does *not* unwind.
- [ ] I can trace Go's `panic`/`recover` propagation, including the LIFO `defer` order and the "recover only in defer" rule.
- [ ] I can implement a generator from continuations and explain capture vs resume.
- [ ] I can show that the *same* effectful program means different things under a resuming vs discarding handler.
- [ ] I can explain why multi-shot continuations replay side effects and cleanup, and why most systems are one-shot.
- [ ] I can classify any failure as error / panic / abort by trust-after-failure, and design recovery boundaries.
- [ ] I can critique checked exceptions and design error propagation that survives crossing process boundaries.

---

## Further Practice Ideas

- **Build a tiny exception mechanism in C using `setjmp`/`longjmp`**, then explain why it leaks resources C++/Go/Rust would clean up (no destructors/`defer` run by `longjmp`).
- **Implement `Result`/`Either` and a `?`-like macro/operator** in a language that lacks one, including automatic error conversion.
- **Write a single-threaded async runtime** (poll-based or fiber-based) and observe that `await` is one-shot continuation capture and that rejections reattach to the awaiting continuation.
- **Profile a real codebase** for exceptions used as control flow; convert the hottest one to error values and measure the win.
- **Implement a backtracking search** (e.g., N-queens) with a multi-shot effect handler, and deliberately introduce a side effect to witness the replay hazard.
