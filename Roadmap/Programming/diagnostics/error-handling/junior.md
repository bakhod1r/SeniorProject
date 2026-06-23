# Error Handling — Junior Level

> **Topic:** [Error Handling Roadmap](README.md)
> **Focus:** What is an error? Why does it need to be "handled"? The four major language models. Your first instincts.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [The Four Error Models](#the-four-error-models)
8. [Code Examples](#code-examples)
9. [Pros & Cons of Each Model](#pros--cons-of-each-model)
10. [Use Cases](#use-cases)
11. [Coding Patterns](#coding-patterns)
12. [Clean Code](#clean-code)
13. [Best Practices](#best-practices)
14. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
15. [Common Mistakes](#common-mistakes)
16. [Tricky Points](#tricky-points)
17. [Test Yourself](#test-yourself)
18. [Tricky Questions](#tricky-questions)
19. [Cheat Sheet](#cheat-sheet)
20. [Summary](#summary)
21. [What You Can Build](#what-you-can-build)
22. [Further Reading](#further-reading)
23. [Related Topics](#related-topics)
24. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What is an error?** and **How do programs talk about them?**

An **error** is a program's way of saying *"I cannot do what you just asked, and here is why."* Error handling is the design problem of **how that sentence is expressed in code** — and how the caller receives it, understands it, and decides what to do next.

If you imagine code as a series of conversations between functions ("please give me the user with id 42"), then errors are the answers a function gives when the conversation cannot end with a normal result. The question is *never* whether errors happen — disk reads fail, networks drop, users type nonsense, files don't exist — the question is **how cleanly your program can talk about them**.

In one sentence: *"Error handling is the API of failure."*

This page is your first map of the territory. We'll look at what an error actually is, why programmers have spent decades arguing about the right way to represent one, and the four major styles you'll see in the wild: **exceptions**, **return values**, **`Result` types**, and **panics**. The next level (`middle.md`) goes into wrapping, context, and typed errors; `senior.md` covers boundaries and translation; `professional.md` covers error design as API design.

> 🎓 **Why this matters for a junior:** Most "junior" bugs in production code aren't logic bugs — they're errors that the original author **didn't think could happen**, or **caught and silently ignored**. Learning to *think about failure as a first-class concern* is one of the fastest ways to level up.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write a function in at least one language (Go, Python, Java, JavaScript, Rust — any of them).
- **Required:** What a return value is. What a function call looks like in your language.
- **Required:** Basic conditional logic (`if`, `else`).
- **Helpful but not required:** Awareness that a program has a *call stack* — i.e. that `main` called `processOrder`, which called `loadCustomer`, which called `queryDB`. We'll use this to talk about where errors come from.
- **Helpful but not required:** Some exposure to file I/O or HTTP requests — anything that can actually fail.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Error** | A signal from a function that it could not produce its normal result. |
| **Exception** | A specific kind of error that is *thrown* out of a function and propagates up the call stack until something catches it (Java, Python, C#, JS, Ruby). |
| **Throw / Raise** | The act of producing an exception. (`throw` in Java/JS/C#, `raise` in Python/Ruby.) |
| **Catch / Except / Rescue** | The act of receiving an exception and deciding what to do. (`catch` in Java/JS/C#, `except` in Python, `rescue` in Ruby.) |
| **Return value error** | The Go and C style: the function returns *both* a result and an error indicator, side by side. |
| **`Result<T, E>`** | A type used in Rust, Swift (`Result`), Scala/Haskell (`Either`) — an explicit "success-or-failure" wrapper around a return value. |
| **Panic / Abort** | A non-recoverable failure that crashes the program (or goroutine). Used for programmer mistakes ("impossible" states), not for expected errors. |
| **Checked exception** | A Java idea: the compiler forces you to either catch or declare exceptions in your function signature. |
| **Unchecked exception** | An exception that does not have to be declared — anything can throw it (most exceptions in Python, Ruby, JS, C#, and `RuntimeException` in Java). |
| **Bug** | A defect in your code — something that should never have happened. Not the same as an error. |
| **Expected error** | A failure that's part of the normal operating universe — file not found, network timeout, invalid user input. |
| **Stack trace** | A list of the functions that were on the call stack when an error happened. Crucial for debugging. |
| **Swallow** | To catch an error and do nothing with it. Almost always a bug. |

---

## Core Concepts

### 1. Errors Are Communication

When a function fails, the value it returns is just as much "data" as a successful result. Errors are not a side concern — they are part of the **contract** of every function. The function says: *"On success I give you X; on failure I tell you why."*

Whether your language expresses that with exceptions or returned values doesn't change the underlying truth: every function has a happy path and a sad path, and both need a vocabulary.

### 2. Errors Are Not Bugs

This is the single most important distinction in this whole topic, and the one beginners most often miss.

- A **bug** is a defect — your code is wrong. (You tried to read element `100` from a list of size `5`. You divided by zero because you forgot to check.)
- An **error** is a thing the world did to you. (The disk is full. The user typed `"twenty"` into a number field. The remote server timed out.)

A bug means you must **fix the code**. An error means you must **decide what to do about reality**. These two require completely different responses, and mixing them up is the source of most beginner pain.

### 3. Errors Travel Up

In every error model, the error originates somewhere *deep* in your code (a low-level function near the OS, the network, the database) and has to *travel up* to a higher level that knows what to do about it. A function that reads from a file doesn't know if you wanted to show the user a friendly message or retry — but `main()` or your HTTP handler does. Error handling is the *plumbing* between where failure happens and where it can be answered.

### 4. The Caller Decides

A good function does not decide what an error *means* — it just **reports it accurately**. The caller decides whether to retry, log, swallow, escalate, or crash. A function that "helpfully" prints to stderr and returns `nil` has taken away a decision that wasn't its to make.

### 5. Silence is the Enemy

The single most dangerous thing a program can do with an error is **ignore it**. Silent failures are the reason production data is sometimes wrong for months before anyone notices. We will repeat this in every level of this topic, because it is the single most common mistake.

---

## Real-World Analogies

| Concept | Analogy |
|---------|--------|
| **Error** | A waiter coming back to your table saying *"We're out of the salmon."* You ordered, the kitchen tried, the kitchen could not deliver, you now know. |
| **Exception** | An emergency PA announcement in a building — it interrupts whatever you were doing and forces a response. Good for true emergencies, terrible if used for "the coffee is ready". |
| **Return value error** | A delivery driver leaving a note that says *"sorry, we missed you"* on your doorstep, alongside any package they did manage to deliver. The "delivery" still happened; the note is the side channel. |
| **`Result<T, E>`** | A locked box with two compartments — *success* or *failure* — and the recipient must explicitly open one. There's no way to look inside without choosing a side. |
| **Panic / Abort** | A fire alarm. You only pull it when the building is actually on fire, not because you ran out of coffee filters. |
| **Swallowed error** | A waiter who sees the kitchen is on fire and just brings you bread without saying anything. Technically polite. Catastrophically dishonest. |
| **Bug vs error** | A bug is the chef forgetting how to cook. An error is the supplier not delivering the fish. Same outcome for the diner, totally different problems for the restaurant. |

---

## Mental Models

**Mental model 1 — Errors are part of the type.**

When you read a function signature, ask not *"what does this return?"* but *"what are **all** the possible answers this function can give?"* A `getUser(id)` function in real life returns:

- a `User`, *or*
- "I can't find that user", *or*
- "I can't reach the database", *or*
- "you don't have permission".

A well-designed function makes those four answers all reachable. A poorly-designed one returns `User` and *throws* everything else into the void.

**Mental model 2 — The happy path is the lie.**

Junior developers write code that works on the happy path and then "deal with errors later." The truth is: in a mature codebase, **the error paths are more code than the happy path**, because the real world has more ways to go wrong than to go right. Train yourself to start with: *what can fail here?*

**Mental model 3 — Failure is data, not noise.**

Treat an error like a tiny report — it has a *what*, *why*, *where*, and *when*. The richer the report, the easier the debugging. Programmers who treat errors as "ugh, problems" produce systems where every failure looks like every other failure. Programmers who treat errors as data produce systems that diagnose themselves.

**Visualization — error propagation in a call stack:**

```
                              ▲ error bubbles up
                              │ (each layer can: ignore, log, wrap, translate)
        ┌─────────────────────┴─────────────────────┐
        │           main / HTTP handler             │ ◄── decides user-facing reply
        └──────────────────────▲────────────────────┘
                               │
        ┌──────────────────────┴────────────────────┐
        │             OrderService                   │ ◄── wraps with business context
        └──────────────────────▲────────────────────┘
                               │
        ┌──────────────────────┴────────────────────┐
        │             UserRepository                 │ ◄── may translate "not found"
        └──────────────────────▲────────────────────┘
                               │
        ┌──────────────────────┴────────────────────┐
        │              Database driver               │ ◄── raw SQL/timeout error
        └───────────────────────────────────────────┘
                               ▲ error originates here
```

---

## The Four Error Models

Programming languages don't agree on what an error should *look like*. There are four major schools of thought. As a junior, you don't need to take sides — you need to recognize them.

### Model 1 — Exceptions (Java, Python, C#, JavaScript, Ruby, C++)

A function can `throw` (or `raise`) at any point. The exception then **unwinds the call stack** automatically — every function above is skipped — until some function catches it or the program crashes.

The key property: exceptions are *invisible in the type signature* (in most languages). You can't tell by looking at a function whether it throws. You have to read the docs or the body. This is both the strength (you don't pollute every signature) and the weakness (you can be surprised).

### Model 2 — Return Values (Go, C)

Every function that can fail returns an error alongside its result. The caller is *forced* to look at the error variable — there is no "automatic" propagation.

```go
user, err := getUser(42)
if err != nil {
    return err
}
```

The key property: errors are **completely visible**. The cost: you write `if err != nil` a lot. Go programmers do not see this as boilerplate; they see it as *honesty about how often things fail*.

### Model 3 — `Result<T, E>` (Rust, Swift, Scala/Haskell-style)

The return type itself wraps either success or failure. You cannot use the value without explicitly handling both cases. Rust adds a `?` operator that propagates errors with very little syntax noise.

```rust
fn get_user(id: u64) -> Result<User, DbError> { ... }

let user = get_user(42)?;  // returns Err early if it fails
```

The key property: failure is in the **type system**. The compiler will not let you forget.

### Model 4 — Panic / Abort

For *truly* impossible situations — array index out of bounds, integer division by zero, "invariant X must hold and it doesn't" — most languages provide a way to immediately stop. Go has `panic`, Rust has `panic!`, Python has `assert` and direct interpreter crashes, Java has `Error` (separate from `Exception`).

This is **not** an error model for everyday failures. It is the language's way of saying *"this should be impossible; if it happened, the program is corrupt and must not continue."*

---

## Code Examples

We'll write the same trivial function — *"divide a by b, but b might be zero"* — in all four styles.

### Go (Return Value)

```go
package main

import (
    "errors"
    "fmt"
)

// ErrDivByZero is exported so callers can check for it.
var ErrDivByZero = errors.New("division by zero")

func divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, ErrDivByZero
    }
    return a / b, nil
}

func main() {
    result, err := divide(10, 0)
    if err != nil {
        fmt.Println("could not divide:", err)
        return
    }
    fmt.Println("result:", result)
}
```

Two return values. The caller is *physically prevented* from forgetting to look at `err` — well, almost: they can use `_` to discard it, but doing so is conspicuous.

### Python (Exception)

```python
class DivisionByZeroError(ValueError):
    """Raised when divide() is called with b == 0."""
    pass


def divide(a: float, b: float) -> float:
    if b == 0:
        raise DivisionByZeroError("b must not be zero")
    return a / b


if __name__ == "__main__":
    try:
        result = divide(10, 0)
        print("result:", result)
    except DivisionByZeroError as e:
        print("could not divide:", e)
```

Only one return value. The error path is in a *separate channel* — `try` / `except`.

### Java (Checked Exception)

```java
public class DivisionByZeroException extends Exception {
    public DivisionByZeroException(String message) {
        super(message);
    }
}

public class Calculator {

    public double divide(double a, double b) throws DivisionByZeroException {
        if (b == 0) {
            throw new DivisionByZeroException("b must not be zero");
        }
        return a / b;
    }

    public static void main(String[] args) {
        Calculator c = new Calculator();
        try {
            double result = c.divide(10, 0);
            System.out.println("result: " + result);
        } catch (DivisionByZeroException e) {
            System.out.println("could not divide: " + e.getMessage());
        }
    }
}
```

Notice `throws DivisionByZeroException` in the signature — Java forces callers to deal with it. We'll revisit checked vs unchecked exceptions in `middle.md`.

### Rust (`Result<T, E>`)

```rust
#[derive(Debug)]
pub enum MathError {
    DivisionByZero,
}

pub fn divide(a: f64, b: f64) -> Result<f64, MathError> {
    if b == 0.0 {
        return Err(MathError::DivisionByZero);
    }
    Ok(a / b)
}

fn main() {
    match divide(10.0, 0.0) {
        Ok(result) => println!("result: {}", result),
        Err(e) => println!("could not divide: {:?}", e),
    }
}
```

The return type *is* the error contract. There is no way to use the value without handling both branches.

### A fifth — Panic (for completeness, NOT recommended for this case)

```go
func divide(a, b float64) float64 {
    if b == 0 {
        panic("division by zero") // BAD: this is a recoverable expected error
    }
    return a / b
}
```

This is *wrong* for `divide`, because division-by-zero is something the caller can sensibly handle. Reserve `panic` for *truly* impossible situations, not "this might happen if my user is sloppy."

---

## Pros & Cons of Each Model

| Model | Pros | Cons |
|-------|------|------|
| **Exceptions** | Clean happy-path code. Easy to centralize error handling at a high level. Stack traces come for free. | Errors are invisible in signatures. Surprising control flow. Performance cost in some languages. Encourages "catch-all" that hides bugs. |
| **Return values (Go-style)** | Total visibility — you can see every error path. Forces the programmer to think about failure on every call. No hidden control flow. | Verbose. Repetitive `if err != nil` boilerplate. Easy to *forget* to wrap an error (lose context). |
| **`Result<T, E>`** | Type-safe — you literally can't ignore an error. Excellent for refactoring (compiler finds every call site). | Requires sum types / pattern matching, which not all languages have ergonomically. Can be verbose without `?`-style sugar. |
| **Panic / Abort** | Honest: when the program is in an impossible state, crashing is *safer* than continuing. | Misused for ordinary errors leads to crash-on-typo bugs. No graceful recovery without `recover()` / signal handling, which complicates the model. |

There is no "right" model — they reflect different cultural beliefs about *what's important*. Exception languages prioritize **clean call sites**; return-value languages prioritize **honest call sites**; Result-based languages prioritize **compile-time guarantees**.

---

## Use Cases

When you'll see each model in real code:

- **Exceptions** — almost all web frameworks in Java, Python, C#, Ruby. Application-level code where the developer wants to write the happy path and handle failures at a few well-defined boundaries (HTTP handlers, transaction boundaries).
- **Return values** — Go services, Linux system programming, embedded C. Anywhere visibility of failure paths matters more than terseness.
- **`Result<T, E>`** — Rust everywhere. Swift in error-prone APIs (file I/O, decoding). Functional Scala. Anywhere bugs from forgetting to handle a case are unacceptable.
- **Panic** — anywhere you'd say *"if this happens, my assumptions about the world are wrong and I should not continue running."* Index-out-of-bounds, broken invariants, "unreachable" branches.

---

## Coding Patterns

Patterns you'll see repeatedly at junior level — recognize them, use them.

### Pattern 1 — Guard at the boundary

Check for failure *first*, get it out of the way, then write the happy path:

```python
def transfer(from_account, to_account, amount):
    if amount <= 0:
        raise ValueError("amount must be positive")
    if from_account.balance < amount:
        raise InsufficientFundsError(from_account.id)
    # ... happy path
```

This is called "early return" or "guard clause" — it keeps the main flow indented at one level.

### Pattern 2 — Return early on error (Go)

```go
func processOrder(id string) error {
    order, err := fetchOrder(id)
    if err != nil {
        return err
    }

    if err := validate(order); err != nil {
        return err
    }

    if err := charge(order); err != nil {
        return err
    }

    return ship(order)
}
```

A staircase down, with the happy result at the bottom.

### Pattern 3 — Try / catch at the top

In exception languages, the typical layout is: *throw freely deep in the code, catch at one well-defined boundary*:

```python
@app.route("/orders/<id>")
def get_order(id):
    try:
        order = order_service.fetch(id)
        return jsonify(order)
    except OrderNotFound:
        return "not found", 404
    except DatabaseError:
        return "internal error", 500
```

The handler in the framework is the *boundary* where errors get translated into HTTP responses.

### Pattern 4 — Match on Result (Rust)

```rust
match get_user(id) {
    Ok(user) => render(user),
    Err(UserError::NotFound) => render_404(),
    Err(UserError::Db(e)) => render_500(e),
}
```

Every branch is visible; the compiler ensures nothing is forgotten.

---

## Clean Code

A junior who follows these will already be ahead of most production code:

1. **Don't swallow errors.** An empty `except: pass` or `catch (Exception e) {}` is a bug.
2. **Be specific.** Catch *only* the errors you actually know how to handle. Re-throw or propagate the rest.
3. **Don't log and re-throw.** Either log it and handle it, or pass it up. Doing both gives you the same error in five log lines.
4. **Error messages are for humans.** "InvalidStateException" is useless. "Cannot ship order: order is in state CANCELED" is debuggable.
5. **Include context.** "File not found" — *which file?* Never produce an error that doesn't name the thing.
6. **One way to fail.** A function should not sometimes return `null` *and* sometimes throw *and* sometimes return `-1`. Pick one.

---

## Best Practices

1. **Think about failure when you design the function, not after.** If you find yourself thinking *"can I just add a try/except later?"* — no, you can't, not well.
2. **Distinguish bugs from expected errors.** Expected errors get error-handling. Bugs get fixed (and possibly a panic/assert/raise to make them loud).
3. **Fail fast for impossible states.** If something *cannot* happen — assert. The earlier a corrupt state is detected, the cheaper the fix.
4. **Fail soft for expected errors.** A user typed `"twenty"` into an age field — your job is to ask again, not to crash.
5. **Make errors actionable.** What can the caller actually *do* with this error? If the answer is "nothing", you've named it wrong.
6. **Keep the boundaries thin.** Errors should be translated only at the system boundary (HTTP, user, log). Internal code passes them along.
7. **Test the error paths.** Most bugs hide in the error paths because no one tested them.

---

## Edge Cases & Pitfalls

### Pitfall 1 — `null` as "error" (and friends)

In old C and old PHP, the convention was: "on failure, return `null` / `-1` / `false` / empty string." This produces calls like:

```php
$result = doThing();
if ($result === false) { /* error... but which one? */ }
```

There is no information about *what* went wrong, only *that* something did. This style is dead for good reasons.

### Pitfall 2 — Throwing inside destructors / `finally`

In many languages, an exception thrown inside a cleanup block can either be swallowed or mask the original exception, depending on the language. Be very careful in `finally`, `__exit__`, `Drop`, and destructor code — they should be *bulletproof* and re-raise nothing.

### Pitfall 3 — Async/await error swallowing

In async code (JS Promises, Python `asyncio`), an unhandled rejection used to silently disappear. Modern runtimes now warn loudly, but a junior writing `someAsync().then(...)` without a `.catch()` can still produce code that fails invisibly.

### Pitfall 4 — Catching `Exception` (or `Throwable`, or `BaseException`)

```python
try:
    do_thing()
except Exception:
    pass  # NEVER
```

You just swallowed `KeyError`, `MemoryError`, `KeyboardInterrupt` (well, almost), and every future error someone adds. Be specific.

### Pitfall 5 — Mixing error styles in one codebase

Some functions return `(value, err)`; some throw; some return `null`. The caller doesn't know what to expect. Pick a style and apply it consistently within a layer.

### Pitfall 6 — Errors crossing thread boundaries

In a `Thread`, `goroutine`, or `Worker`, exceptions thrown in the child often don't reach the parent automatically. You must explicitly catch and report them — otherwise the failure happens silently.

---

## Common Mistakes

1. **`except: pass`** — swallows all errors, including bugs. The fastest way to hide a critical defect.
2. **Generic catch-all at the wrong level** — converting every error into "internal server error" hides distinguishable cases.
3. **`if err != nil { panic(err) }`** in Go — turning expected errors into crashes is hostile to the caller.
4. **Returning an empty result instead of an error** — `getUser(id)` returning an empty `User{}` instead of an error is silent corruption.
5. **Re-throwing without context** — `throw e` at every layer leaves you a stack trace that points to where the error was caught but not what was happening (we'll fix this in `middle.md` with *wrapping*).
6. **Catching for "robustness"** — wrapping `try/except` around things "just in case" hides real bugs.
7. **Validating already-validated data** — instead of trusting the layer above, every layer re-validates and produces conflicting error messages.
8. **Using exceptions for control flow** — `try/except` as a substitute for `if/else` is slow and confusing.
9. **Discarding the original exception** — `raise NewError("oops")` instead of `raise NewError("oops") from e`. We'll see *chaining* in `middle.md`.
10. **Letting `null` mean two things** — "no result found" vs "an error occurred" — should never be the same value.

---

## Tricky Points

- **A `return error` is not "less safe" than `throw`** — it just makes the error path visible. Go programmers consider this a *feature*, not boilerplate.
- **Stack traces aren't free** — in Java and Python they cost a bit of CPU to capture. In hot loops, throwing thousands of exceptions can be a real performance problem. (More on this in `optimize.md` if you ever go that deep.)
- **Some errors aren't errors** — `EOF` (end of file) is the *normal* way most file reads terminate. Don't treat it as a failure. `database returned 0 rows` is often not an error either.
- **"Recoverable" is not a property of the error — it's a property of the caller.** "File not found" can be a recoverable error (try another path) or a fatal one (no config = die), depending on who's asking.
- **Exception hierarchies do matter** — catching `IOException` will also catch `FileNotFoundException` if it inherits from it. Knowing the hierarchy is half of using exceptions well.
- **`finally` runs even when you `return`** — but **not** when the process is killed. Don't rely on it for permanent cleanup.
- **`panic` in Go can be recovered with `recover()` in a deferred function** — but most idiomatic Go code does not do this. Save it for the very top of a goroutine.

---

## Test Yourself

Try answering these before reading on. Solutions are at the bottom of the file in your head — write the code and run it.

1. Write a Go function `parseAge(s string) (int, error)` that returns an error if `s` is not a number, and an error if the number is negative.
2. Write a Python function `parse_age(s: str) -> int` that *raises* on the same conditions. Define a custom exception class for the "negative age" case.
3. In the same Python function, make sure the original `ValueError` from `int(s)` is preserved as the cause of any custom exception you raise. (Hint: `raise ... from ...`.)
4. In Java, write `divide(int a, int b)` that throws a checked exception on `b == 0`. Then call it from `main` and produce a friendly message.
5. In Rust, write `divide(a: f64, b: f64) -> Result<f64, &'static str>` and call it with the `?` operator from `main` (you'll need `main` to return `Result<(), &'static str>`).
6. Take any of the above and answer: *what should happen if the input is `""`*? Is that the same error class as `"-5"` or a different one?
7. Identify three places in your favorite project where an error is silently swallowed (an empty `catch`, a `_ =`, or a missing check). For each, decide: should it bubble up, be logged, or be handled?

---

## Tricky Questions

These are the kind of questions a senior asks a junior — not to trap you, but to see if you've internalized the distinction between an error and a bug:

1. *Is `KeyError` in Python an error or a bug?* — Depends. If your code did `dict["missing_key"]` and you forgot it might not be there, that's a bug. If `dict` is *user input*, it's an error.
2. *Should `parseInt("abc")` throw or return -1?* — `parseInt` traditionally returns `NaN` in JS — a third "value" that propagates and breaks things later. In Java it throws. In Go you have `strconv.Atoi` which returns `(int, error)`. The Go style is the most honest.
3. *Why is `catch (Exception e)` a code smell?* — It catches things you can't possibly handle correctly (memory errors, programming bugs) and silently smooths over them.
4. *In Go, why does the standard library use `errors.Is(err, io.EOF)` instead of `err == io.EOF`?* — Because intervening layers may have *wrapped* the error. We'll cover this in `middle.md`.
5. *Is `panic` ever appropriate?* — Yes: for invariants you believe cannot be violated. *"Unreachable"*, *"the slice should never be empty here"*, *"map should always contain X"*. Misuse for ordinary errors is the bug.
6. *What's the difference between `throw` and `throw new Exception(e)`?* — One re-throws the same exception; the other creates a new one. The second loses the original stack trace unless you set the *cause*.
7. *Why is "validate at the boundary" a common rule?* — Because once you're inside, you should be able to trust the data. Validating again at every internal call adds noise and inconsistent error messages.
8. *If your function signature returns `error`, is `nil` a valid return?* — Yes — it's how you say "no error". The convention is: `(result, nil)` on success, `(zero-value, error)` on failure.

---

## Cheat Sheet

```text
╔══════════════════════════════════════════════════════════════╗
║                  ERROR HANDLING — JUNIOR                      ║
╠══════════════════════════════════════════════════════════════╣
║ Q: What's the difference between an error and a bug?         ║
║ A: A bug is wrong code. An error is the world saying "no".   ║
║                                                              ║
║ Q: What are the four error models?                           ║
║ A: Exceptions (Java/Python), Return values (Go/C),           ║
║    Result<T,E> (Rust), Panic/Abort (truly unrecoverable).    ║
║                                                              ║
║ Q: What's the worst thing to do with an error?               ║
║ A: Silently swallow it. except: pass / catch(Exception) {}.  ║
║                                                              ║
║ Q: Where should errors be handled?                           ║
║ A: At the boundary — translate them where they meet the user ║
║    (HTTP handler, CLI, UI). Internally, propagate.           ║
║                                                              ║
║ Q: When to panic vs return an error?                         ║
║ A: Panic only if the world is in a state your code believes  ║
║    is impossible. Otherwise, return.                         ║
╚══════════════════════════════════════════════════════════════╝
```

### Quick patterns

| Language | Style | "Error" looks like |
|----------|-------|--------------------|
| Go | Return value | `func F() (T, error)` |
| Python | Exception | `raise ValueError("..."); except ValueError as e:` |
| Java | Checked exception | `throws DBException` in signature |
| Rust | `Result<T, E>` | `fn f() -> Result<T, E> { Err(E::Variant) }` |
| JS | Throw / reject | `throw new Error("...")`, `Promise.reject(e)` |

---

## Summary

- An **error** is a function's way of telling its caller *"the normal result isn't possible, here's why."*
- A **bug** is different from an error. Bugs need code fixes; errors need decisions.
- Programming languages express errors in four major styles: **exceptions**, **return values**, **`Result<T,E>`**, and **panic/abort**.
- **The caller decides what an error means.** Functions report; callers respond.
- **The worst thing is silence** — swallowed errors cause production data corruption that's noticed months later.
- **Errors travel up** — they originate deep and are answered at the boundaries (HTTP, CLI, UI).
- Error handling is not a "second pass" — it is part of the design of every function from day one.

You now have the basic vocabulary. In `middle.md` we go a level deeper: error wrapping, context, stack traces, sentinel errors, typed errors, and the tools each ecosystem gives you for layering richer information into a failure.

---

## What You Can Build

With just the junior-level knowledge above, you can:

- **A CLI that reads a CSV and reports a friendly message** on every kind of failure: file missing, bad row, unreadable column. Try in Go: every failure path has its own `error`; in Python: a custom exception per failure category.
- **An HTTP endpoint that returns the right status code for every kind of failure** — `404` for "not found", `400` for "bad input", `503` for "downstream unavailable", `500` for "I genuinely don't know what just happened". Don't return `500` for everything — be specific.
- **A retry wrapper** that retries on "transient" errors (network timeout) but not on "permanent" ones (bad input). The distinction between transient and permanent is *your* design — and that distinction is itself a junior-to-mid-level skill.
- **A form validator** that collects *all* validation errors at once and returns them as a list, instead of failing on the first.
- **A small JSON parser that produces useful error messages** with line and column numbers, not just *"syntax error"*.

Each of these forces you to confront the difference between "a function failed" and "what should I do about it."

---

## Further Reading

- Joe Duffy — [*The Error Model*](http://joeduffyblog.com/2016/02/07/the-error-model/) (Midori postmortem). A long, deeply rewarding essay on why every model is wrong in some way.
- Dave Cheney — [*Don't just check errors, handle them gracefully*](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully) — Go-specific but the principles travel.
- Joshua Bloch — *Effective Java*, items on exceptions. Old but still mostly right.
- *Programming Rust* (Blandy/Orendorff) — the chapter on `Result` is the cleanest introduction.
- Python docs — [*Errors and Exceptions*](https://docs.python.org/3/tutorial/errors.html). Often the right starting point.
- Raymond Chen — [*Cleaner, more elegant, and harder to recognize*](https://devblogs.microsoft.com/oldnewthing/?p=36693) — on exception-heavy code that *looks* clean but is actually fragile.

---

## Related Topics

- [Error Handling → Middle](middle.md) — wrapping, context, sentinel/typed errors, exception chaining.
- [Error Handling → Senior](senior.md) — boundaries, translation, retries, defensive vs offensive.
- [Error Handling → Professional](professional.md) — errors as API design, anti-patterns, Result-style in OO.
- [Logging](../logging/README.md) — the operator-facing companion: how *systems* record errors.
- [Debugging](../debugging/README.md) — how to track an error backwards to its source.
- [Clean Code → Error Handling](../../code-craft/clean-code/06-error-handling/README.md) — the *code style* chapter.
- [Golang → Error Handling](../../languages/golang/05-error-handling/01-error-handling-basics/junior.md) — Go-specific idioms.

---

## Diagrams & Visual Aids

### Decision tree: should this be an error, a bug, or a panic?

```
Did the program detect a state I believed was impossible?
└─► YES ─► PANIC / ASSERT.
└─► NO
    │
    Is this caused by my code being wrong?
    └─► YES ─► IT'S A BUG. Fix the code; don't add error handling.
    └─► NO ─► IT'S AN ERROR — return / throw / Result it.
```

### The four models at a glance

```
EXCEPTIONS                       RETURN VALUE
function f(x):                   function f(x) -> (T, error):
   if bad: raise E                  if bad: return zero, E
   return result                    return result, nil
caller:                          caller:
   try { f(x) } catch E { ... }     v, err := f(x)
                                    if err != nil { ... }

RESULT<T,E>                      PANIC / ABORT
function f(x) -> Result<T,E>:    function f(x):
   if bad: return Err(E)            if impossible: panic
   return Ok(result)                return result
caller:                          caller:
   match f(x) {                     v := f(x)  // can't fail
     Ok(v) => ...                   // if it does, crash
     Err(e) => ...                  // (recoverable only via
   }                                //  defer+recover in Go)
```

### Error propagation visualization

```
                  USER / EXTERNAL CALLER
                        │
                        ▼
        ┌───────────────────────────────┐
        │ Boundary layer (HTTP / CLI)   │ ← translates → user-facing reply
        └───────────────┬───────────────┘
                        │ catches / examines / responds
                        ▼
        ┌───────────────────────────────┐
        │ Application service           │ ← may wrap with business context
        └───────────────┬───────────────┘
                        │ propagates
                        ▼
        ┌───────────────────────────────┐
        │ Repository / Gateway          │ ← may translate driver errors
        └───────────────┬───────────────┘
                        │ propagates
                        ▼
        ┌───────────────────────────────┐
        │ Driver / OS / Network         │ ← original error originates here
        └───────────────────────────────┘
```

---

> **Next:** [middle.md](middle.md) — error wrapping, sentinel and typed errors, exception chaining, stack traces, and how to keep context all the way up the stack.
