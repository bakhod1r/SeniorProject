# Effect & Error Execution Models — Middle Level

> **Topic:** [Effect & Error Execution Models](README.md)
> **Focus:** How a `throw` *physically* leaves a function. Stack unwinding, landing pads, `finally`/`defer` execution order, and why "zero-cost exceptions" cost nothing — until you throw.

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

> Focus: **When you write `throw new RuntimeException()`, what does the machine actually do?** It does *not* "go to a catch." Catches don't have addresses the throw knows about. Something has to *find* the handler, *unwind* the intervening frames, and *run cleanup* on the way. This page is about that something.

At the junior level, "the exception jumps up the stack to a catch" was a fine story. Now we crack it open. There is no GOTO from a `throw` to a `catch`; the throw site has no idea where the matching catch lives — it might be three frames up, in a different file, in a `main` you didn't write. The runtime has to **search** the call stack for a handler, **unwind** every frame between the throw and that handler (running each frame's cleanup — destructors, `finally` blocks, `defer`s), and finally **transfer control** into the handler with the exception object in hand.

How that search-and-unwind is implemented is one of the more beautiful and under-appreciated pieces of language runtimes. The dominant modern technique is **table-driven, "zero-cost" exceptions**: the compiler emits, off to the side, **metadata tables** describing where every function's cleanup code and handlers live. On the **happy path**, these tables cost *nothing at runtime* — no instructions execute to "set up" a try block. The cost is paid only when an exception is actually thrown, at which point a runtime library walks the tables to unwind. This is why "zero-cost" is a half-truth: **zero cost when you don't throw, expensive when you do.**

This page also covers the explicit-value side at its mechanical level: how Go's `panic`/`recover` actually walks deferred functions, how Rust's `?` *desugars* into a `match` and an early return, and how `finally`/`defer`/`ensure` are scheduled and ordered. Understanding this mechanism changes how you write code: you'll stop treating exceptions as "free try blocks," you'll understand why a hot loop should never throw, and you'll know exactly what runs (and in what order) when control leaves a function the hard way.

> 🎓 **Why this matters at this level:** Two engineers can write the same `try/catch` and get wildly different performance because one throws on the hot path and one doesn't. You can't reason about that — or about resource cleanup ordering, or about why a destructor ran "spontaneously" — without knowing how unwinding works. This is the level where error handling stops being syntax and becomes mechanism.

---

## Prerequisites

- **Required:** Comfort with the junior page: the two families (exceptions vs error values), errors vs panics, what `finally`/`defer` are *for*.
- **Required:** A working picture of the **call stack** and **stack frames** — return addresses, local variables living in a frame.
- **Required:** Basic familiarity with at least one of: C++ RAII/destructors, Go `defer`, Java/Python `finally`.
- **Helpful:** A vague idea of what a *function prologue/epilogue* is and that the compiler generates code you don't see.
- **Helpful:** Knowing that the compiler can lay out code and emit side metadata (debug info, etc.).

You do **not** yet need:

- The DWARF/`.eh_frame` byte format details, two-phase SEH internals, or `setjmp`/`longjmp` mechanics (that's `senior.md`).
- Algebraic effects, delimited continuations, or `call/cc` (that's `senior.md`/`professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Throw site** | The exact instruction that raises the exception. |
| **Handler / catch clause** | The code that catches and processes a thrown exception. |
| **Stack unwinding** | Popping stack frames from the throw site up to the handler, running cleanup in each. |
| **Landing pad** | Compiler-generated code in a function that runs during unwinding: it executes cleanups and/or dispatches to the matching catch. |
| **Cleanup** | Code that must run as a frame is unwound: C++ destructors, Go `defer`s, `finally` blocks. |
| **Two-phase unwinding** | The Itanium/SEH approach: *phase 1* searches for a handler without modifying the stack; *phase 2* actually unwinds and runs cleanup. |
| **Zero-cost exceptions** | An implementation where the happy path executes no extra instructions; the cost is paid only on throw, via side tables. |
| **Unwind tables (`.eh_frame`, LSDA)** | Read-only metadata the compiler emits describing how to unwind each frame and where its handlers/cleanups are. (Detailed in `senior.md`.) |
| **`setjmp`/`longjmp`** | A C mechanism that saves and restores the machine state to jump non-locally — the *old* way to implement exceptions, with a happy-path cost. |
| **Personality routine** | A per-language function the unwinder calls for each frame to ask "do you handle this exception, or do you have cleanup?" |
| **RAII** | "Resource Acquisition Is Initialization": tie a resource's lifetime to an object so its destructor releases it, including during unwinding. |
| **`defer` (Go)** | A statement that schedules a call to run when the surrounding function returns — including during a panic. |
| **`panic` / `recover` (Go)** | Go's unwinding mechanism: `panic` runs deferred calls up the stack; `recover` stops it. |
| **`?` operator (Rust)** | Sugar that, on `Err`/`None`, returns it from the current function; on `Ok`/`Some`, unwraps the value. |
| **`panic = "abort"` vs `"unwind"`** | A Rust compile option: on `panic!`, either run destructors and unwind, or immediately terminate. |
| **`noexcept`** | A C++ specifier promising a function won't throw; lets the compiler omit unwind machinery and call `std::terminate` if it lies. |

---

## Core Concepts

### 1. A `throw` Is a Search, Not a Jump

The single most important correction to the junior mental model: **a `throw` does not jump to a known location.** The throw site has no idea where the catch is. So the runtime performs a **search up the stack**:

```text
   throw here  ──►  does THIS frame catch this type? no → unwind it (run cleanup)
                    does the NEXT frame catch it?    no → unwind it (run cleanup)
                    does the NEXT frame catch it?    YES → stop, run the handler
```

To do this search, the runtime needs to know, for every frame currently on the stack: *what cleanup must run, and is there a catch clause that matches this exception type?* That information is what the compiler precomputes and stashes in tables.

### 2. The Landing Pad: Where Unwinding "Lands" in a Function

When the unwinder decides a particular frame has work to do (cleanup or a catch), it doesn't resume the function at the throw point. It jumps to a special compiler-generated block called a **landing pad**. The landing pad:

1. Runs the cleanups for that frame (call destructors / mark `finally` to run).
2. If this frame has a matching catch, **dispatches** to the catch body.
3. If not, it re-enters the unwinder to continue up to the next frame.

A function with three local objects and a `try/catch` has landing-pad code generated for it — but on the happy path, **none of it runs.** It sits in a cold section of the binary, reached only via the unwinder.

### 3. Two-Phase Unwinding: Search First, Destroy Second

The Itanium C++ ABI (used on Linux/macOS) and Windows SEH both use **two-phase unwinding**:

- **Phase 1 — Search.** Walk *up* the stack asking each frame's **personality routine**, "do you have a handler for this exception?" *Without modifying the stack* — no cleanup runs yet. This phase just *finds* the catching frame (or discovers there is none).
- **Phase 2 — Cleanup/Unwind.** Walk up *again*, this time actually popping frames and running each frame's cleanups, until reaching the frame Phase 1 identified, then transfer into its handler.

Why two phases? Because of `std::terminate` and unhandled-exception semantics: if Phase 1 finds **no** handler at all, the program can `terminate()` **with the stack intact**, so a debugger sees the full original call stack at the throw point. If you destroyed frames eagerly while searching, that context would be gone. (Phase 1's existence is also why a thrown-but-uncaught exception in C++ doesn't run your destructors before aborting — there's no handler, so it terminates after Phase 1.)

### 4. "Zero-Cost" Exceptions vs `setjmp`/`longjmp`

There are two historical ways to implement exceptions, and the trade-off defines the whole topic.

**The old way — `setjmp`/`longjmp` (sjlj).** Entering a `try` calls `setjmp`, which **saves the CPU registers and stack pointer** into a buffer and links it onto a per-thread list of "active try blocks." Throwing calls `longjmp`, restoring the most recent buffer. This **costs on the happy path**: every `try` you enter does real work (save registers, push onto the list) even if nothing ever throws. Cheap to throw, but you pay continuously for the *possibility* of throwing.

**The modern way — table-driven, "zero-cost."** Entering a `try` does **nothing at runtime**. There's no register save, no list push. Instead the compiler emits **side tables** mapping each program-counter range to "what to unwind / which handlers apply." On throw, a runtime unwinder *reads those tables* to figure out how to walk the stack. The happy path executes the *exact same instructions it would without any try block*. The cost is entirely deferred to throw time, where reading and interpreting tables makes a throw **far more expensive** than a `longjmp` would have been.

The name is a slogan: **"zero-cost" = zero cost on the path that doesn't throw.** A thrown exception can cost **hundreds to thousands of nanoseconds** (table walk, personality calls, cleanup) — orders of magnitude more than a normal function return. This is the entire reason "don't use exceptions for control flow" is good advice.

### 5. Cleanup Runs During Unwinding — In Reverse Order

As frames unwind, their cleanup runs **last-acquired-first-released** (LIFO), because that's destruction order:

- **C++:** local objects are destroyed in reverse construction order as each frame unwinds.
- **Go:** `defer`red calls run in **LIFO** order when the function returns or panics.
- **Java/Python:** `finally` blocks run as control leaves their `try`, innermost first.

This LIFO ordering is what makes RAII correct: if you acquire a lock then open a file, unwinding closes the file then releases the lock — the reverse of acquisition, which is exactly what you want.

### 6. Go's `panic`/`recover`: Unwinding via Deferred Functions

Go has no `throw`/`catch`, but `panic` *is* an unwinding mechanism built on `defer`:

1. `panic(v)` stops normal execution of the current function.
2. It runs that function's **deferred** calls, in LIFO order.
3. If none of them `recover()`, the panic propagates to the **caller**, runs *its* deferreds, and so on up the goroutine.
4. If a deferred call invokes `recover()`, the panic **stops**: the panicking value is returned from `recover()`, and the goroutine resumes normally *from the deferred function's return*.
5. If the panic reaches the top of the goroutine uncaught, the program crashes with a stack trace.

So `defer`+`recover` is structurally a try/finally/catch, just spelled with functions. The key difference from exceptions: it's **explicit and value-based**, and idiom restricts it to genuinely exceptional situations.

### 7. Rust's `?` Desugaring and `panic` Strategy

Rust's `?` is pure sugar over `match`. This:

```rust
let x = fallible()?;
```

desugars (roughly) to:

```rust
let x = match fallible() {
    Ok(v)  => v,
    Err(e) => return Err(From::from(e)),  // convert and early-return
};
```

There is **no unwinding** here — `?` is an ordinary early `return`, as cheap as any return. The `From::from` lets a function convert a lower-level error into its own error type automatically.

Separately, Rust's `panic!` *does* unwind by default (running `Drop`s, exactly like C++ destructors), using the same table-driven Itanium machinery. But Rust lets you choose `panic = "abort"` in `Cargo.toml`, which makes `panic!` **immediately terminate** without unwinding — smaller binaries, no unwind tables, and a guarantee that destructors won't run during a panic. Libraries thus can't rely on catching panics for control flow.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Search for a handler** | A fire alarm goes off on floor 7. The building doesn't know in advance who's the fire warden — it pages up the floors until someone responds "I've got this." |
| **Two-phase unwinding** | First, dispatch confirms a warden exists *before* evacuating (Phase 1). Only then does everyone actually file out, locking their offices on the way (Phase 2). |
| **No handler → terminate with stack intact** | If no warden answers, you want the building left exactly as-is for investigators — don't shred the evidence by evacuating. |
| **Landing pad** | The stairwell each floor must pass through — where you turn off your computer (cleanup) before continuing down. |
| **Zero-cost tables** | The evacuation map posted on the wall: free to have, consulted only during an actual fire. |
| **`setjmp`/`longjmp`** | Every employee re-recording their exact desk position every morning *just in case* there's a fire — a daily cost for a rare event. |
| **LIFO cleanup** | You took off your coat, then your shoes; leaving, you put on shoes then coat — reverse order. |
| **`noexcept`** | A sign on a room saying "no fire exits needed here — guaranteed nothing flammable." If it lies and catches fire, the whole building is condemned (`terminate`). |

---

## Mental Models

### The "Two Lists" Model of a Stack Frame

Think of each active stack frame as carrying two precomputed lists (in the side tables, not in the running code): a **cleanup list** ("destroy these objects / run these `finally`s if you unwind through me") and a **handler list** ("I catch exceptions of these types"). The unwinder walks frames consulting these lists. The happy-path code never touches them — that's the "zero cost."

### The "You Pay at the Toll Booth, Not the On-Ramp" Model

`setjmp`/`longjmp` charges a toll at every on-ramp (every `try` entry). Table-driven exceptions charge nothing at on-ramps and a *big* toll only if you actually crash off the road (throw). Choose your road by how often you expect to crash: rare exceptions → table-driven wins big; frequent "exceptions" → you've mis-modeled your control flow.

### The "Unwinder Is an Interpreter" Model

The unwinder is effectively a tiny interpreter whose *program* is the unwind tables and whose *input* is the current stack. It single-steps up the frames, executing table-described actions (restore these registers, run this landing pad). Throwing is slow because you're invoking an interpreter, not executing a branch.

---

## Code Examples

### C++ — RAII cleanup runs during unwinding

```cpp
#include <cstdio>
#include <stdexcept>

struct Guard {
    const char* name;
    explicit Guard(const char* n) : name(n) { printf("acquire %s\n", name); }
    ~Guard() { printf("release %s\n", name); }   // runs even during unwinding
};

void inner() {
    Guard a("lock");
    Guard b("file");
    throw std::runtime_error("boom");   // unwinds: ~file then ~lock, then propagates
}

int main() {
    try {
        inner();
    } catch (const std::exception& e) {
        printf("caught: %s\n", e.what());
    }
}
```

Output:

```text
acquire lock
acquire file
release file      <- LIFO: file released before lock
release lock
caught: boom
```

The destructors of `b` then `a` run as `inner`'s frame unwinds — *before* control reaches the catch in `main`. No `finally` needed; the destructor *is* the cleanup. This is RAII.

### C++ — `noexcept` removes the machinery (and the safety net)

```cpp
void fast(int* p) noexcept {
    *p = 42;            // if this somehow throws, std::terminate() is called immediately
}
```

`noexcept` tells the compiler "no exception leaves here," so it can skip emitting unwind tables for the call and may optimize harder (e.g., `std::vector` uses `noexcept` move constructors to move instead of copy on growth). The contract is enforced: if an exception *does* try to escape a `noexcept` function, the program calls `std::terminate` — no unwinding past it.

### Go — `panic`/`recover` unwinds through deferred functions

```go
package main

import "fmt"

func work() {
    defer fmt.Println("work cleanup")          // runs during the panic, LIFO
    defer fmt.Println("work cleanup (earlier)")
    panic("something broke")
}

func guarded() (err error) {
    defer func() {
        if r := recover(); r != nil {           // catches the panic here
            err = fmt.Errorf("recovered: %v", r)
        }
    }()
    work()
    return nil
}

func main() {
    fmt.Println("err =", guarded())
}
```

Output:

```text
work cleanup
work cleanup (earlier)
err = recovered: something broke
```

The `panic` runs `work`'s deferreds (LIFO), then propagates to `guarded`, whose deferred `recover()` stops it. `recover` only works inside a deferred function — that's where the unwinding gives it a chance to run.

### Rust — `?` is just early return (no unwinding)

```rust
use std::num::ParseIntError;

fn sum_two(a: &str, b: &str) -> Result<i32, ParseIntError> {
    let x: i32 = a.parse()?;   // desugars to: match a.parse() { Ok(v)=>v, Err(e)=>return Err(e.into()) }
    let y: i32 = b.parse()?;
    Ok(x + y)
}

fn main() {
    println!("{:?}", sum_two("2", "3"));      // Ok(5)
    println!("{:?}", sum_two("2", "oops"));   // Err(ParseIntError { .. })
}
```

Each `?` is an ordinary conditional return — no stack search, no tables. This is why Rust's recoverable-error path is as fast as a return, and why Rust reserves the *expensive* unwinding machinery for `panic!` alone.

### Rust — `panic!` unwind vs abort

```rust
fn main() {
    // With default `panic = "unwind"`, Drop impls run as the stack unwinds.
    // With `panic = "abort"` in Cargo.toml, this terminates immediately, no Drops.
    let _g = PrintOnDrop("guard");
    panic!("kaboom");
}

struct PrintOnDrop(&'static str);
impl Drop for PrintOnDrop {
    fn drop(&mut self) { println!("dropping {}", self.0); }
}
```

Under `unwind`, you'll see `dropping guard` before the process exits. Under `abort`, you won't — abort skips destructors. The choice is a real engineering decision: smaller/faster binaries and "panics are always fatal" (abort) vs. running cleanup and being catchable at thread boundaries (unwind).

### Java — `finally` ordering and the "swallowed exception" trap

```java
static int tricky() {
    try {
        throw new RuntimeException("original");
    } finally {
        return 7;   // BUG: this `return` SWALLOWS the exception entirely
    }
}
```

A `return` (or another `throw`) inside `finally` *replaces* the in-flight exception. `tricky()` returns `7` and the `RuntimeException` silently vanishes. Knowing that `finally` runs *during* unwinding — and can hijack it — is exactly the mechanical insight this level gives you.

---

## Pros & Cons

| Mechanism | Pros | Cons |
|-----------|------|------|
| **Table-driven (zero-cost) exceptions** | No happy-path cost; clean code; carries stack trace. | Throwing is very expensive; larger binaries (unwind tables); hard to reason about non-local control. |
| **`setjmp`/`longjmp` exceptions** | Cheap to throw; simple to implement; portable C. | Continuous happy-path cost at every `try`; doesn't run C++ destructors correctly; clobbers non-`volatile` locals. |
| **`?` / error-value propagation** | Cheap (just a return); explicit; no unwinding; easy to follow. | Manual at every layer; verbose without sugar; can't skip many frames at once. |
| **`panic = abort` (Rust)** | Smallest/fastest; no unwind tables; deterministic "fatal". | No cleanup on panic; can't recover at thread boundaries; `Drop` won't run. |
| **`noexcept` / no-throw guarantees** | Enables optimizations; smaller code; documents intent. | A violated promise = instant `terminate`; constrains what the function may call. |

---

## Use Cases

- **Hot inner loops:** never throw inside them. The happy-path cost is zero, but a thrown exception in a tight loop can dominate runtime. Use error values or precondition checks.
- **Library boundaries (C++):** mark functions `noexcept` where you can guarantee it; it unlocks move optimizations in standard containers and signals intent.
- **Recoverable, frequent failures:** prefer `Result`/`error` (no unwinding). Parsing, validation, lookups.
- **Truly exceptional, rare failures:** exceptions or `panic` are fine — the high throw cost is paid rarely and buys clean happy-path code.
- **Embedded / size-constrained binaries (Rust):** `panic = "abort"` removes unwind tables and shrinks the binary; appropriate when a panic should just kill the process anyway.
- **`recover` at goroutine/request boundaries (Go):** wrap a request handler so one panicking request doesn't take down the server — a legitimate use of the unwinding mechanism.

---

## Coding Patterns

### Pattern 1: Recover only at a boundary, then convert to an error

```go
func handle(req Request) (resp Response, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("handler panic: %v", r)  // contain it at the boundary
        }
    }()
    return process(req), nil
}
```

Don't sprinkle `recover` everywhere. Put it at a meaningful boundary (a request, a worker task) and turn the panic back into an error.

### Pattern 2: RAII / scope guards instead of manual cleanup

```cpp
std::lock_guard<std::mutex> lk(m);   // releases on ANY exit, including unwinding
// ... no matter how this scope ends, the lock is released
```

Let destructors do cleanup so it's automatic on the error path. This is strictly better than `try { } finally { unlock(); }`.

### Pattern 3: Keep `finally`/`defer` cleanup non-throwing and side-effect-light

A `finally` that throws, or a `defer` that panics, can mask the original failure. Cleanup should close/release and nothing more. If cleanup *can* fail, log it — don't let it replace the in-flight exception.

### Pattern 4: Use `?` (or `if err != nil { return err }`) to keep propagation cheap

Reserve the expensive unwinding mechanism for the rare and truly exceptional. Route ordinary failures through return-based propagation, which is as cheap as a function return.

### Pattern 5: Don't catch-and-rethrow without adding value

```java
try { risky(); }
catch (IOException e) { throw e; }   // pointless: adds a frame, no information
```

Either add context (`throw new ServiceException("loading X", e)`) or don't catch at all. A bare rethrow just makes the trace noisier.

---

## Best Practices

- **Never throw on the happy path of a hot loop.** "Zero-cost" means zero on the path that doesn't throw — a throw can be 100–1000× a normal return.
- **Use RAII/`defer`/`finally`, not manual cleanup**, so the error path can't leak resources during unwinding.
- **Keep cleanup code simple and non-throwing.** A throwing destructor (C++) during unwinding calls `std::terminate`; a `return`/throw in `finally` swallows the real error.
- **Mark `noexcept` (C++) where true** to enable optimizations — but only when you can actually guarantee it.
- **Pick `unwind` vs `abort` deliberately (Rust).** Abort for size and "panics are fatal"; unwind when you need cleanup or to catch at thread boundaries.
- **Recover/catch at boundaries, not everywhere.** Contain failures at request/task edges; let them propagate within.
- **Prefer return-based errors for frequent, recoverable failures** to avoid the throw cost entirely.
- **Remember unwinding is LIFO.** Acquire in an order whose reverse is the correct release order.

---

## Edge Cases & Pitfalls

- **Throwing during unwinding.** In C++, if a destructor throws *while* the stack is already unwinding from another exception, `std::terminate` is called — you can't have two exceptions in flight. Destructors should be `noexcept`.
- **`return`/`throw` inside `finally`.** It *replaces* the in-flight exception or return value, silently swallowing the original. A notorious bug class in Java/JS.
- **Uncaught C++ exception doesn't run your destructors.** If Phase 1 finds no handler, the program `terminate()`s *with the stack intact* — your local destructors never run. (Tools/tests sometimes assume cleanup happened; it didn't.)
- **`recover` only works in a deferred function.** Calling `recover()` directly in normal code returns `nil` and does nothing — a common Go beginner mistake.
- **`panic = "abort"` skips `Drop`.** Code that relied on a destructor running during `panic!` (e.g., flushing a buffer) silently won't, under abort.
- **Cost of capturing stack traces.** Constructing an exception in Java/Python *fills in the stack trace*, which walks frames and is surprisingly expensive — sometimes the dominant cost of throwing. (More in `senior.md`.) Reusing a preallocated exception or overriding `fillInStackTrace` are tricks for hot throw sites.
- **`setjmp`/`longjmp` and non-`volatile` locals.** After `longjmp`, the values of locals that were modified between `setjmp` and `longjmp` and not declared `volatile` are *indeterminate*. C++ destructors are *not* run by `longjmp` — mixing it with C++ objects is undefined.
- **`longjmp` across a frame with cleanup leaks.** Because `longjmp` doesn't run destructors or `defer`s, jumping over frames that hold resources leaks them. This is precisely why C++/Go/Rust don't use it.
- **Exceptions crossing a language/ABI boundary.** Throwing a C++ exception through a C frame, or across a `extern "C"` boundary, or out of a callback into a C library, is undefined — the C frames have no unwind handlers/personality. Catch before the boundary.
- **`noexcept` lying.** A `noexcept` function that calls something which throws will `terminate` at the boundary, not propagate. Don't mark `noexcept` unless you're sure.

---

## Summary

- A `throw` is a **search**, not a jump: the runtime must *find* a handler up the stack, *unwind* intervening frames running their cleanup, then transfer control.
- Each frame's **cleanups and handlers** are precomputed by the compiler into **side tables**; the running happy-path code never touches them.
- **Two-phase unwinding** searches for a handler first (stack intact, so an unhandled exception can `terminate` with full context), then unwinds and runs cleanup second.
- **"Zero-cost" exceptions** cost nothing on the non-throwing path (table-driven) but make a throw *expensive*; the old **`setjmp`/`longjmp`** approach is the opposite — cheap throw, continuous happy-path cost, and it doesn't run C++/Go cleanup.
- Cleanup during unwinding runs **LIFO**: C++ destructors, Go `defer`s, Java/Python `finally` — reverse of acquisition, which is what makes RAII correct.
- **Go's `panic`/`recover`** is unwinding spelled with deferred functions; **Rust's `?`** is *not* unwinding at all — it desugars to an early `return`, while `panic!` uses the same Itanium unwinding (or `abort`, skipping cleanup).
- Practical consequences: never throw in hot loops; keep cleanup non-throwing; use RAII; recover at boundaries; reserve the expensive mechanism for the genuinely exceptional.

---

## Further Reading

- *Itanium C++ ABI: Exception Handling* — the specification of two-phase unwinding and personality routines. https://itanium-cxx-abi.github.io/cxx-abi/abi-eh.html
- *"Zero-cost exceptions aren't actually zero-cost"* — discussions and benchmarks on throw cost vs. happy-path cost.
- *The Go Blog — "Defer, Panic, and Recover."* https://go.dev/blog/defer-panic-and-recover
- *The Rustonomicon — "Unwinding"* and the `?`/`Try` desugaring. https://doc.rust-lang.org/nomicon/unwinding.html
- *"Exception Handling in LLVM"* — how landing pads and the `invoke`/`landingpad` IR work. https://llvm.org/docs/ExceptionHandling.html
- *C++ Core Guidelines* — sections on exceptions, `noexcept`, and RAII.
- Herb Sutter, *"Exceptional C++"* and the GotW series on exception safety and destructor rules.
