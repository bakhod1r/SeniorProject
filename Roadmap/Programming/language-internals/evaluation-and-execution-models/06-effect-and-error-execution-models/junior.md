# Effect & Error Execution Models — Junior Level

> **Topic:** [Effect & Error Execution Models](README.md)
> **Focus:** A function does not only return a value. It can fail, throw, panic, or reach out and touch the world. How does a language *run* code that does more than compute?

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

> Focus: **What is the difference between "this function returned 7" and "this function failed"?** And **how does the machine actually carry that difference around?**

Most code you write in your first months has a comforting shape: you call a function, it computes something, it gives you a value back. `add(2, 3)` returns `5`. `length("hello")` returns `5`. The call goes in, the answer comes out, nothing else happens.

But real programs are full of computations that do **more than return a value**:

- `openFile("/etc/passwd")` might **fail** — the file may not exist.
- `parseInt("banana")` cannot produce a number — it has to signal **"there is no answer."**
- `divide(10, 0)` is **undefined** — what should it even return?
- `print("hi")` doesn't really "return" anything useful; its whole point is the **side effect** of putting text on the screen.
- `random()` gives a different answer every time — its result depends on something **outside** the function.

These are all examples of what this topic calls **effects and errors**. An *error* is "this computation could not produce its normal result." An *effect* is "this computation does something to the world, or depends on the world, beyond computing a return value." A language has to **decide how to model these** — and, more deeply, how to *execute* code that has them. When `openFile` fails, where does the program go next? Who finds out? What gets cleaned up on the way?

This is the heart of the topic. Different languages made very different choices:

- **C, C++, Java, Python, JavaScript** use **exceptions**: a failing call can `throw`, and execution **jumps** out of the current function, up the call stack, until someone `catch`es it.
- **Go** uses **error values**: failure is just a normal return value (`result, err := doThing()`), and you check it with an `if`.
- **Rust** uses **`Result<T, E>`**: a function that can fail returns a value that is *either* a success *or* an error, and the type system forces you to handle both.
- **Haskell** uses types like **`Maybe`** and **`Either`**: failure is a value, and special sequencing rules let you chain fallible steps cleanly.

In one sentence: **this topic is about how a language represents and runs "computation that might not just hand you back a value" — both failure and side effects — as a real execution mechanism, not just a syntax detail.**

> 🎓 **Why this matters for a junior:** Error handling is not a footnote you bolt on at the end. It *is* the control flow of real software. A program that ignores errors is a program that corrupts data and crashes in production. Learning how your language models failure — and the discipline each model demands — is one of the highest-leverage skills you can build early.

This page covers the everyday surface: what a `throw`/`catch` actually does, what a panic is, why Go makes you write `if err != nil`, what `Result` and `?` mean in Rust, and why `finally`/`defer` exist. The deeper machinery — how stack unwinding *physically* works, "zero-cost" exceptions, algebraic effects — is the subject of `middle.md`, `senior.md`, and `professional.md`.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and call functions in at least one language (C, Java, Python, Go, JavaScript, or Rust).
- **Required:** What "return a value" means and how a `return` statement works.
- **Required:** Basic `if`/`else` and how a `for`/`while` loop runs.
- **Helpful but not required:** A vague picture of the **call stack** — when `a()` calls `b()` calls `c()`, there's a stack of "who is waiting for whom."
- **Helpful but not required:** What a *type* is (`int`, `string`, a struct/class), because some error models are built out of types.

You do **not** need to know:

- How the CPU actually unwinds the stack, or what `.eh_frame` tables are (that's `middle.md`/`senior.md`).
- What a monad, an algebraic effect, or a continuation is (those are later levels).
- Anything about async/await, threads, or cancellation yet.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Return value** | The normal result a function hands back to its caller. |
| **Side effect** | Anything a function does *besides* returning a value: printing, writing a file, mutating a global, sending a network request, reading the clock. |
| **Effect** | The general idea of "this computation interacts with the world or depends on it." Errors are one kind of effect; I/O is another. |
| **Error** | A computation that could not produce its normal result. "File not found", "invalid input", "out of memory." |
| **Exception** | A value (often an object) that is **thrown** to signal an error, interrupting normal flow and jumping up the call stack until **caught**. |
| **Throw / Raise** | To start propagating an exception. `throw` (Java/C++/JS), `raise` (Python). |
| **Catch / Except** | To stop a propagating exception and handle it. `catch` (Java/C++/JS), `except` (Python), `recover` (Go). |
| **Call stack** | The chain of function calls currently in progress: `main` called `a` called `b`. Each entry is a **stack frame**. |
| **Stack unwinding** | The act of "popping" stack frames one by one as an exception travels upward, running cleanup along the way. |
| **Panic** | An unrecoverable-by-default error that aborts the current path. Go's `panic`, Rust's `panic!`. Usually means "a bug happened, not a normal failure." |
| **Recover** | Go's mechanism to *stop* a panic from killing the program and turn it back into a normal value. |
| **Error value** | An error represented as an ordinary return value you check, rather than something thrown. Go's `error`, Rust's `Result`. |
| **`Result<T, E>`** | Rust's type for "either a success of type `T` or an error of type `E`." You must handle both. |
| **`Option` / `Maybe`** | A type meaning "either a value, or nothing." Used for "this might not have an answer." |
| **`Either`** | A type holding one of two things; by convention "left = error, right = success." |
| **`finally` / `defer` / `ensure`** | Code guaranteed to run on the way out of a block, whether it left normally or via an error. Used for cleanup (closing files, releasing locks). |
| **Checked exception** | (Java) An exception the compiler *forces* you to either catch or declare. |
| **Unchecked exception** | An exception the compiler does not force you to handle (most exceptions in most languages). |
| **Happy path** | The execution path where nothing fails. The "everything went fine" route. |

---

## Core Concepts

### 1. A Function Is More Than "Inputs → Output"

The simplest mental model of a function is a box: arguments go in, a value comes out. But that model is a lie for most real code. A real function might:

1. **Return a value** (the happy path).
2. **Fail to return a value** (an error).
3. **Do something to the world** while computing (a side effect).
4. **Depend on the world** to compute (read a file, the clock, randomness).

A language's *effect and error execution model* is its answer to: **"When a function does (2), (3), or (4), how does the program behave, and how does the programmer control it?"**

### 2. Two Big Families: "Jump Out" vs "Return a Marker"

There are two fundamentally different ways to handle failure, and almost every language picks one as its default.

**Family A — Exceptions ("jump out"):** When something fails, you `throw`. Normal execution *stops* and the program *jumps* — not to the next line, but out of the current function, then out of *its* caller, then out of *that* caller — until it finds a `catch` that wants to handle this kind of error. Languages: C++, Java, Python, JavaScript, C#.

```python
def read_config():
    f = open("config.json")   # may throw FileNotFoundError
    return f.read()

try:
    data = read_config()
except FileNotFoundError:
    data = "{}"               # control jumped here
```

**Family B — Error values ("return a marker"):** When something fails, you *return* a special value that says "this failed" alongside (or instead of) the result. The caller *checks* it with an ordinary `if`. Nothing jumps; control flows linearly. Languages: Go (the `error` return), Rust (`Result`), C (return codes).

```go
data, err := readConfig()
if err != nil {
    data = "{}"               // we checked and handled it
}
```

The difference feels small in a tiny example but shapes the entire *feel* of a language. Exceptions make the happy path clean and push errors out of sight. Error values make errors visible and impossible to ignore — at the cost of more `if`s.

### 3. The Call Stack and Why "Jumping Out" Is Meaningful

When `main` calls `a`, `a` calls `b`, and `b` calls `c`, the running program holds a **call stack**:

```text
   c        <- currently running
   b        <- waiting for c
   a        <- waiting for b
   main     <- waiting for a
```

If `c` throws an exception and nobody in `c` catches it, the language **unwinds the stack**: it abandons `c`, then checks `b` for a handler, then `a`, then `main`. Each abandoned frame is "popped." If cleanup code was registered (a `finally`, a destructor, a `defer`), it runs as that frame is popped. This is **stack unwinding**, and it's what makes a `throw` deep inside your program able to be caught far away.

The next levels go deep on *how* this unwinding physically happens. For now, the picture is: **an exception travels up the stack, popping frames, until caught.**

### 4. Errors vs Panics: "Expected Failure" vs "Bug"

A crucial distinction, especially in Go and Rust:

- An **error** is an *expected* failure that's part of normal operation: a file might not exist, user input might be malformed, a network might be down. You *handle* these. They are values.
- A **panic** (Go) or **`panic!`** (Rust) is for situations that should *never happen if the program is correct*: an array index out of bounds, a nil-pointer dereference, an invariant violation. The default behavior is to **crash** (after cleanup), because there's no sensible way to continue.

The rule of thumb juniors should internalize: **use errors for things that can go wrong; use panics for things that mean your code is broken.** Reaching for `panic`/exceptions to handle a missing file is poor style in Go and Rust; quietly ignoring a real bug is dangerous everywhere.

### 5. Cleanup on the Way Out: `finally`, `defer`, `ensure`

When control leaves a block — *whether normally or because of an error* — you often need to run cleanup: close the file, release the lock, free the buffer. Every language has a mechanism:

- **Java / JavaScript / Python:** a `finally` block always runs.
- **Go:** a `defer`red call runs when the function returns, even if it panics.
- **Rust:** a value's **`Drop`** runs automatically when it goes out of scope (this is how files close themselves).
- **C++:** a **destructor** runs when an object leaves scope — the basis of RAII ("Resource Acquisition Is Initialization").

The key insight: **cleanup must run on *both* the happy path and the error path.** If your file only closes on success, an error leaks the file handle. This is one of the most common junior bugs, and the language gives you a tool to fix it.

### 6. The Happy Path Should Be Easy to Read

A good error model lets you read the *intended* logic without drowning in failure handling. Exceptions do this by hiding the error path entirely (it's "somewhere up there in a catch"). Go does it by convention (`if err != nil { return err }` is so common your eyes learn to skim it). Rust's `?` operator does it by *desugaring* a check into a single character:

```rust
let data = read_config()?;   // if it failed, return the error now; else unwrap the value
```

Each model is trying to solve the same tension: **make failure impossible to forget, but don't make the happy path unreadable.** No model perfectly wins.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Return value** | You ask the cook for a sandwich; you get a sandwich. |
| **Error value** | You ask the cook for a sandwich; he hands you a note: "out of bread." You read the note and decide what to do. |
| **Exception (throw)** | You ask the cook for a sandwich; he sets off the fire alarm and everyone evacuates the building until a manager (catch) handles it. |
| **Stack unwinding** | The fire alarm clears the kitchen, then the dining room, then the lobby — floor by floor — until someone with authority stops the evacuation. |
| **Panic** | The building is structurally unsafe. Don't try to keep serving lunch — get out. |
| **`finally` / `defer`** | No matter how you leave the kitchen (sandwich made, or fire alarm), you *always* turn off the stove on the way out. |
| **Checked exception** | A rule that you cannot leave the kitchen without signing a form acknowledging "the oven might catch fire." |
| **`Option` / `Maybe`** | A vending machine slot that is either holding a snack or visibly empty. You look before you reach in. |
| **`Result` / `Either`** | A sealed envelope marked either "PAYMENT" or "REJECTION." You must open it and read which it is before acting. |
| **Side effect** | The cook doesn't just make food — he also dirties dishes, makes noise, and uses up ingredients. That's effect, beyond the sandwich. |

---

## Mental Models

### The "Two Exits" Model

Picture every function as a room with **two doors**: a green door labeled "success — here is your value" and a red door labeled "failure — something went wrong." In single-return languages you only see the green door, and the red door is hidden (it's the exception escaping). In Go and Rust the two doors are right next to each other and *both visible* — the function literally hands you something that says which door you came out of. Whenever you call a function, ask: **which doors does this function have, and am I handling both?**

### The "Marker vs Alarm" Model

There are exactly two ways to tell your caller "this failed":

- **Leave a marker** (error value): put a flag in the return, let the caller find it. Quiet, local, easy to ignore if you're careless.
- **Pull an alarm** (exception): force control to jump until someone responds. Loud, non-local, impossible to ignore but easy to lose track of where it goes.

Languages are arguments about which default is healthier. Carry both pictures; you'll meet both in any career.

### The "Cleanup Is a Promise" Model

When you open a resource, imagine you've signed a contract that says *"I will close this no matter what."* The happy path is the easy half. The error path is where the contract gets broken by sloppy code. `finally`/`defer`/`Drop`/destructors are the language helping you keep the promise automatically, so you don't have to remember to close the file on all seventeen error paths.

---

## Code Examples

We'll solve the same small task across languages: **read an integer from a string, and handle the "it's not a number" failure.** Watch how each language *models* the failure.

### Python — Exceptions

```python
def parse_count(s):
    return int(s)            # raises ValueError if s isn't a number

# Caller handles it by catching:
try:
    n = parse_count("banana")
    print("got", n)
except ValueError:
    print("not a number, using 0")
    n = 0
finally:
    print("done parsing")    # ALWAYS runs, success or failure
```

`int("banana")` *raises* `ValueError`. Control jumps from inside `parse_count` straight to the `except`. The `finally` runs either way. Notice: the function signature gives *no hint* that it can fail — you have to know.

### Java — Exceptions (checked vs unchecked)

```java
import java.io.*;

class Demo {
    // Checked: the compiler FORCES callers to handle or declare IOException.
    static String readFirstLine(String path) throws IOException {
        try (BufferedReader r = new BufferedReader(new FileReader(path))) {
            return r.readLine();   // try-with-resources auto-closes r
        }
    }

    public static void main(String[] args) {
        try {
            System.out.println(readFirstLine("missing.txt"));
        } catch (IOException e) {
            System.out.println("could not read: " + e.getMessage());
        }
    }
}
```

`IOException` is a **checked exception**: Java won't compile `main` unless it catches or declares it. `int x = Integer.parseInt("banana");` throws `NumberFormatException`, which is **unchecked** — the compiler doesn't force you to handle it. The `try (...)` is *try-with-resources*: it closes the reader automatically, the Java version of `defer`.

### Go — Error Values

```go
package main

import (
    "fmt"
    "strconv"
)

func parseCount(s string) (int, error) {
    n, err := strconv.Atoi(s)
    if err != nil {
        return 0, fmt.Errorf("parseCount: %w", err) // wrap with context
    }
    return n, nil
}

func main() {
    n, err := parseCount("banana")
    if err != nil {
        fmt.Println("error:", err)   // we explicitly checked
        n = 0
    }
    fmt.Println("count is", n)
}
```

There is no jumping. `parseCount` *returns* an `error` (which is `nil` on success). The caller checks `if err != nil`. The `%w` verb **wraps** the underlying error so callers can still inspect it. This is the Go way: failure is data, handled in line.

### Go — `panic` and `recover` (for the rare unrecoverable case)

```go
func mustParse(s string) int {
    n, err := strconv.Atoi(s)
    if err != nil {
        panic("mustParse: invalid input " + s) // a bug, not a normal failure
    }
    return n
}

func safeCall() (result int, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered: %v", r) // turn panic back into an error
        }
    }()
    return mustParse("banana"), nil
}
```

`panic` unwinds the goroutine running deferred functions; `recover` (only meaningful inside a `defer`) stops it. Idiomatic Go reserves this for truly exceptional cases, not routine errors.

### Rust — `Result<T, E>` and the `?` Operator

```rust
use std::num::ParseIntError;

fn parse_count(s: &str) -> Result<i32, ParseIntError> {
    let n: i32 = s.parse()?;   // `?`: on Err, return it now; on Ok, unwrap the value
    Ok(n)
}

fn main() {
    match parse_count("banana") {
        Ok(n)  => println!("count is {}", n),
        Err(e) => println!("error: {}", e),
    }
}
```

`s.parse()` returns a `Result`. The `?` operator is shorthand: *"if this is an error, return it from the whole function right now; otherwise give me the success value."* The compiler **forces** you to handle both `Ok` and `Err` in `match` — you cannot accidentally ignore the failure.

### Rust — `panic!` for Bugs

```rust
fn get(v: &[i32], i: usize) -> i32 {
    v[i]   // out-of-bounds index PANICS — this is a bug, not a recoverable error
}
```

Indexing out of bounds doesn't return an error in Rust; it `panic!`s and unwinds (or aborts). Recoverable failures use `Result`; programming bugs use `panic!`. Same split as Go.

### JavaScript — `try/catch` and Promises

```javascript
function parseCount(s) {
  const n = Number(s);
  if (Number.isNaN(n)) throw new Error("not a number: " + s);
  return n;
}

try {
  console.log(parseCount("banana"));
} catch (e) {
  console.log("error:", e.message);
} finally {
  console.log("done");
}

// Async failure travels through a rejected Promise instead of the call stack:
async function load() {
  try {
    const res = await fetch("/data.json"); // a rejected promise throws here
    return await res.json();
  } catch (e) {
    return {};                              // handles the async failure
  }
}
```

Synchronous failures `throw` and are caught with `try/catch`. *Asynchronous* failures (a network error) arrive as a **rejected Promise**; `await` turns that rejection back into a `throw` you can `catch`. Same syntax, different plumbing underneath.

### Haskell — `Maybe` (failure as a value)

```haskell
import Text.Read (readMaybe)

parseCount :: String -> Maybe Int
parseCount s = readMaybe s     -- Just 5  on success, Nothing on failure

main :: IO ()
main =
  case parseCount "banana" of
    Just n  -> putStrLn ("count is " ++ show n)
    Nothing -> putStrLn "not a number"
```

`Maybe Int` is *either* `Just n` *or* `Nothing`. There is no throwing — failure is an ordinary value you pattern-match on. (`Either` is the richer cousin that carries an error message instead of just "nothing.") We'll see in later levels how Haskell chains many such steps without nesting `case`s.

---

## Pros & Cons

| Model | Pros | Cons |
|-------|------|------|
| **Exceptions** | Happy path is clean; errors auto-propagate without manual plumbing; one handler can cover many call sites; carries a stack trace. | Failure is invisible at the call site — you can't tell which calls throw; non-local jumps are hard to follow; easy to leak resources without `finally`/RAII; throwing is slow. |
| **Error values (Go)** | Failure is explicit and impossible to overlook; control flow is linear and easy to trace; cheap (just a return). | Verbose (`if err != nil` everywhere); easy to forget to check (Go won't force you); manual propagation. |
| **`Result` + `?` (Rust)** | Explicit *and* concise; compiler forces handling; type signature documents what can fail; cheap. | More upfront type ceremony; `?` requires compatible error types; a learning curve for the `Result`/`Option` ecosystem. |
| **`Maybe` / `Either` (functional)** | Failure is a value you can compose, map, and chain; totally explicit in the type; no hidden control flow. | Requires understanding monadic chaining to avoid pyramid-of-`case`; less familiar to imperative programmers. |

---

## Use Cases

- **Reach for exceptions** when failures are genuinely exceptional and you want the happy path uncluttered — a deep parsing routine, a script, application-level "this request failed, bubble it to the top" logic in Java/Python/C#.
- **Reach for error values (Go style)** when you want every failure visible and reviewers to *see* error handling in the diff — systems software, network services, anything where silently swallowed errors are catastrophic.
- **Reach for `Result` (Rust style)** when you want the compiler to *guarantee* you handled failures — safety-critical code, libraries with clear fallible operations.
- **Reach for `Option`/`Maybe`** for "this might legitimately have no answer" (a lookup that may miss, a first-element of a possibly-empty list) where "error" is too strong a word.
- **Reach for panic/abort** only for *bugs and broken invariants* — index out of range, "this should be impossible" branches, failed assertions.

---

## Coding Patterns

### Pattern 1: Always pair acquisition with guaranteed cleanup

```python
with open("data.txt") as f:   # Python: __exit__ always closes f
    process(f)
```

```go
f, err := os.Open("data.txt")
if err != nil {
    return err
}
defer f.Close()               // runs no matter how the function returns
process(f)
```

Open and "schedule the close" right next to each other. Never rely on reaching a manual close at the bottom — an error path will skip it.

### Pattern 2: Check the error *immediately* (Go)

```go
n, err := strconv.Atoi(s)
if err != nil {
    return fmt.Errorf("parsing count: %w", err)
}
// from here on, `n` is known-good
```

Handle or return the error on the very next lines. Don't let a known-bad value flow into later code.

### Pattern 3: Add context as the error travels up

Each layer should say *what it was doing* when it wraps an error: `"reading config: open file: no such file"`. In Go use `fmt.Errorf("...: %w", err)`; in Rust use libraries that attach context; in exceptions, chain causes. A bare `"no such file"` with no context is a debugging nightmare.

### Pattern 4: Don't catch what you can't handle

Catch an exception (or check an error) only at a layer that can *do something* about it — retry, substitute a default, report to the user. If you can't handle it here, let it propagate. Catching and swallowing an error you can't fix hides bugs.

### Pattern 5: Errors for the expected, panics for the impossible

```rust
// Recoverable: caller decides what to do.
fn find_user(id: u64) -> Result<User, NotFound> { /* ... */ }

// Unrecoverable: this means our own logic is broken.
fn assert_sorted(v: &[i32]) {
    for w in v.windows(2) {
        if w[0] > w[1] { panic!("internal bug: slice not sorted"); }
    }
}
```

---

## Best Practices

- **Never silently ignore an error.** `_, _ = doThing()` in Go or an empty `catch {}` in Java is how data gets corrupted. At minimum, log it.
- **Handle errors at the right level.** The lowest level *reports*; a higher level *decides*. Don't try to recover where you lack the context to recover.
- **Always run cleanup on every exit path.** Use `with`/`defer`/`try-with-resources`/RAII so you can't forget on an error path.
- **Add context when propagating.** "Failed to charge customer 42: connection refused" beats "connection refused".
- **Use the right tool for the right severity.** Routine failure → error/`Result`. Programming bug → panic/assert. Don't blur these.
- **Make the happy path readable.** If your code is 80% error handling and 20% logic, consider whether a different model (or a helper) would clarify.
- **Don't use exceptions for ordinary control flow.** Throwing to break out of a loop is slow and confusing; exceptions are for exceptional cases.
- **Read the function's signature/docs to learn what can fail.** In exception languages this is the hardest part — you often can't tell, so check the docs.

---

## Edge Cases & Pitfalls

- **The swallowed error.** An empty `catch` or an ignored Go `err` makes a real failure vanish. The program limps onward with bad data. This is the single most common error-handling bug.
- **Leaked resources on the error path.** You open a file, then an error returns *before* you close it. If you didn't use `defer`/`finally`/RAII, the handle leaks. Multiply by thousands of requests → resource exhaustion.
- **Returning a "zero" value with the error.** In Go, `return 0, err` returns *both* a meaningless `0` and the error. If the caller forgets to check `err`, it uses the `0`. Always check first.
- **`finally` that hides the real error.** If your `try` throws *and* your `finally` also throws (or `return`s), the original exception can be lost. Keep cleanup code simple and non-throwing.
- **Catching too broadly.** `except Exception:` or `catch (Throwable)` catches *everything*, including bugs you wanted to crash on (and even `KeyboardInterrupt` in Python). Catch the specific type you can handle.
- **Panicking for routine failures (Go/Rust).** Using `panic`/`unwrap()` because a file might be missing is bad style — that's a normal, recoverable error. Reserve panic for *bugs*.
- **Assuming async errors behave like sync ones.** A rejected JavaScript Promise that nobody `await`s or `.catch`es becomes an "unhandled rejection" that your `try/catch` never sees. Async failure has its own plumbing.
- **`int("banana")` gives no compiler warning.** In exception languages, nothing in the *type* tells you a call can fail. You can call a throwing function and forget to handle it, and it compiles fine. This is why Go and Rust make failure part of the return.
- **Returning early without cleanup in C.** Classic C has no `finally`. The `goto cleanup;` idiom exists exactly because every error path must jump to a single cleanup block, and forgetting one leaks.

---

## Summary

- A function can do **more than return a value**: it can **fail** (an error) or **affect/depend on the world** (an effect). This topic is how a language *models and runs* that.
- There are two great families: **exceptions** ("jump out" up the call stack until caught) and **error values** ("return a marker the caller checks").
- **Exceptions** (C++, Java, Python, JS) keep the happy path clean but hide where failures come from and need `finally`/RAII to avoid leaks.
- **Error values** make failure explicit: **Go** returns an `error` you check with `if err != nil`; **Rust** returns `Result<T, E>` and the compiler forces you to handle it (with `?` as concise sugar).
- **Functional models** (Haskell's `Maybe`/`Either`) treat failure as an ordinary value you pattern-match and chain.
- **Errors vs panics:** errors are *expected* failures you handle; **panics** (Go `panic`, Rust `panic!`) are for *bugs* and crash by default.
- **Stack unwinding** is the mechanism behind exceptions: an uncaught throw pops stack frames upward, running cleanup, until a handler catches it.
- **Cleanup must run on every exit path** — happy or error. `finally`, `defer`, `Drop`, and destructors exist precisely to keep that promise automatically.
- The junior's #1 habit: **never silently ignore a failure, and always make sure cleanup runs even when things go wrong.**

---

## Further Reading

- *Effective Java* — Joshua Bloch. Chapters on exceptions: when to use checked vs unchecked, fail-fast, and exception design.
- *The Go Programming Language* — Donovan & Kernighan. Chapter 5 covers errors, `defer`, `panic`, and `recover` in idiomatic depth.
- *The Rust Programming Language* ("the book") — Chapter 9, "Error Handling," covers `panic!`, `Result`, and `?`. https://doc.rust-lang.org/book/ch09-00-error-handling.html
- *Go by Example: Errors / Panic / Defer / Recover* — short, runnable examples. https://gobyexample.com/errors
- *Python Tutorial — Errors and Exceptions*. https://docs.python.org/3/tutorial/errors.html
- *MDN — Control flow and error handling* (JavaScript `try/catch`, Promises). https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Control_flow_and_error_handling
- *Learn You a Haskell for Great Good* — the chapters on `Maybe` and `Either` for a gentle intro to failure-as-value.
