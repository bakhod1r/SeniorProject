# Panic & Recovery — Junior Level

> **Topic:** [Panic & Recovery Roadmap](README.md)
> **Focus:** The two layers of failure. Panic vs error vs exception. What stack unwinding is. Go `defer`/`panic`/`recover` basics. And the most important judgment a junior can learn early — **when a program *should* crash.**

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [The Two-Layer Model](#the-two-layer-model)
8. [What Stack Unwinding Is](#what-stack-unwinding-is)
9. [Code Examples](#code-examples)
10. [Panic vs Error vs Exception — Per Language](#panic-vs-error-vs-exception--per-language)
11. [When a Program SHOULD Crash](#when-a-program-should-crash)
12. [Pros & Cons of Crashing vs Recovering](#pros--cons-of-crashing-vs-recovering)
13. [Use Cases](#use-cases)
14. [Coding Patterns](#coding-patterns)
15. [Clean Code](#clean-code)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Tricky Points](#tricky-points)
20. [Test Yourself](#test-yourself)
21. [Tricky Questions](#tricky-questions)
22. [Cheat Sheet](#cheat-sheet)
23. [Summary](#summary)
24. [What You Can Build](#what-you-can-build)
25. [Further Reading](#further-reading)
26. [Related Topics](#related-topics)
27. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What is a panic, really?** and **How does a beginner decide whether to catch a failure or let it kill the program?**

There are two kinds of bad things that happen at runtime, and beginners almost always conflate them.

The first kind is **expected failure**: the file isn't there, the network dropped, the user typed letters where you wanted a number. These are normal. Your program should *handle* them — apologize, retry, return an error, show a message. This is the world of [error handling](../error-handling/junior.md).

The second kind is **a broken assumption inside your own program**: you indexed past the end of an array, you dereferenced a `nil` pointer, you divided by zero, you ran out of memory. These are not "the world being difficult." These are **your program discovering that its own model of reality is wrong**. Continuing to run after that is like a surgeon who nicked an artery and keeps operating because "the patient is still breathing." The right move is usually to **stop** — loudly, immediately, with a stack trace — before the corruption spreads.

That stop has a name in each language. In Go it's a **panic**. In Rust it's `panic!`. In Java it's an `Error` (the scary cousin of `Exception`) or an uncaught `RuntimeException`. In Python it can be an uncaught exception or a `SystemExit`. The unifying idea: a panic is the program saying *"I would rather die than keep lying about my state."*

This page teaches you to tell the two layers apart, to understand what "unwinding the stack" means, to use Go's `defer`/`panic`/`recover` correctly, and — most importantly — to develop the instinct for **when crashing is the right answer**. That instinct is worth more than any tool.

> 🎓 **Why this matters for a junior:** The most expensive bug a junior can write is a `try/except: pass` or a `recover()` that swallows a panic and "keeps going." It turns a clean, debuggable crash into silent data corruption that surfaces three weeks later in a customer's account balance. Learning *not* to catch things is a senior skill you can start practicing today.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and run a small program in at least one of Go, Rust, Java, Python, or Node.
- **Required:** What a function call and a return value are.
- **Required:** What a **call stack** is — `main` calls `process`, which calls `loadUser`, which calls `query`. (If this is fuzzy, read the [Debugging — Junior](../debugging/junior.md) section on stack traces first.)
- **Required:** Basic error handling: returning errors in Go, `try/except` in Python, `try/catch` in Java/JS, `Result` in Rust. See [Error Handling — Junior](../error-handling/junior.md).
- **Helpful:** You've seen a stack trace and know it lists the active function calls at the moment of failure.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Error (recoverable)** | An expected, handle-able failure: file not found, network timeout, bad input. The program is *supposed* to deal with it. |
| **Panic** | (Go/Rust term) An abrupt, abnormal stop triggered by a broken invariant — nil deref, index out of range, explicit `panic()`. |
| **Exception** | (Java/Python/JS term) An object thrown up the call stack. Some are recoverable (`IOException`), some really aren't (`OutOfMemoryError`). |
| **Invariant** | A condition your code *assumes* is always true (e.g. "this list is never empty here"). A panic means an invariant was violated. |
| **Stack unwinding** | The process of walking back up the call stack after a panic/throw, running cleanup (`defer`/`finally`/destructors) at each frame, until something catches it or the program dies. |
| **`defer`** | (Go) Schedules a function call to run when the surrounding function returns *or panics*. Used for cleanup. |
| **`recover`** | (Go) Stops a panic mid-unwind and lets the program continue. Only works inside a `defer`. |
| **`finally`** | (Java/Python/JS) A block that runs whether or not an exception was thrown — for cleanup. |
| **Fail-fast** | The discipline of crashing *immediately* when something is wrong, rather than limping on with bad state. |
| **Abort** | The process terminates instantly, without unwinding or cleanup. Often via the `SIGABRT` signal. |
| **Stack trace** | The list of function calls active when the panic fired — your map to the cause. |
| **Goroutine / thread** | A unit of concurrent execution. A panic in one can take down the *whole process* if not handled. |
| **Signal** | An OS-level interrupt (`SIGSEGV` for a bad memory access, `SIGINT` for Ctrl-C). The lowest layer of "something went wrong." |

---

## Core Concepts

### 1. There Are Two Layers of Failure, Not One

Every mature language has split error handling into two layers — even if nobody told you. Layer one is for failures you expect and handle. Layer two is for failures that mean *the program itself is broken*. Mixing them up is the root of most bad error handling. A network timeout is **not** a panic. A nil-pointer dereference **is**.

### 2. A Panic Is a Bug Report From Your Program to You

When you see `panic: runtime error: index out of range [3] with length 3`, the program is not being dramatic. It found that *you* assumed a slice had at least 4 elements and it didn't. The panic is a free, precise, machine-generated bug report. Suppressing it deletes the report and keeps the bug.

### 3. Crashing Is Often the *Safe* Choice

Beginners think a crash is the worst outcome. It usually isn't. The worst outcome is **continuing with corrupt state**: charging a card twice, writing garbage to the database, returning the wrong user's data. A crash is loud, contained, and recoverable (the process restarts). Silent corruption is none of those things. **A clean crash beats a quiet lie.**

### 4. Unwinding Runs Your Cleanup On the Way Out

When a panic or exception travels up the stack, the language runs your cleanup hooks at each level — Go's `defer`, Java/Python's `finally`, Rust/C++ destructors. This is *why* you can still close files and release locks even when things go wrong. Understanding unwinding is understanding *what runs after the bad thing happens*.

### 5. `recover` Is a Scalpel, Not a Blanket

Go's `recover` (and `try/catch` of broad types) is sometimes correct — at a *boundary*, to stop one bad request from killing a whole server. But used everywhere, it becomes the panic equivalent of `except: pass`: it hides bugs forever. The rule for now: **don't recover unless you can name exactly why.** (The middle level teaches the one pattern where you should.)

### 6. The Default Should Be to Let It Crash

When in doubt, do nothing — let the panic propagate, let the exception bubble up, let the process die with a stack trace. This is not laziness; it is the [fail-fast](../error-handling/middle.md) principle. You add recovery deliberately, at one place, for one reason. You don't sprinkle it defensively.

---

## Real-World Analogies

| Concept | Real-World Analogy |
|---|---|
| **Recoverable error** | A "we're out of oat milk" sign at the café — annoying, expected, handled (order something else). |
| **Panic / unrecoverable** | The café's gas line is leaking — you *evacuate*, you don't keep making lattes. |
| **Fail-fast** | A circuit breaker that trips the instant it senses a short, before the wiring catches fire. |
| **Swallowing a panic** | Taping over the smoke-detector because the beeping is annoying. |
| **Stack unwinding** | Evacuating a building floor by floor, grabbing your coat (cleanup) on the way out of each room. |
| **`defer` / `finally`** | The "turn off the stove before you leave" note you stick to the door — it runs no matter how you exit. |
| **Abort (SIGABRT)** | Pulling the fire alarm and the building's emergency power-cut at once — instant stop, no tidying. |
| **Recover-at-boundary** | A restaurant where one burnt dish is thrown out and remade, without closing the whole kitchen. |
| **Signal (SIGSEGV)** | The hardware itself slamming on the brakes — the CPU caught you touching memory you don't own. |
| **Goroutine crash taking down the process** | One passenger opening the emergency door mid-flight grounds the *entire* plane. |

---

## Mental Models

### 1. The "Two Boxes" Model

Picture two boxes for every failure. **Box A: "the world misbehaved"** — bad input, missing file, flaky network. **Box B: "my code is broken"** — nil deref, bad index, impossible state. Before reacting to any failure, ask *which box?* Box A → handle it (return an error, show a message). Box B → usually let it crash. Ninety percent of clean error-handling code comes from sorting failures into the right box.

### 2. A Panic Is a Falling Elevator With Floors That Can Catch It

The panic starts at the top floor (where it fired) and falls down the call stack. At each floor, the language runs cleanup (`defer`/`finally`). If a floor has a *net* (`recover`/`catch`), the fall stops there. If no floor has a net, the elevator hits the ground floor (`main`) and the process dies. Most floors should *not* have a net — only the one designed to catch.

### 3. The Blast Radius

Every failure has a **blast radius** — how much it takes down. A returned error has a blast radius of one function call. An unrecovered panic in a simple program has a blast radius of the *whole process*. A panic in one goroutine of a web server, if unhandled, *also* has a blast radius of the whole process (this surprises everyone). The senior skill is controlling blast radius: making one bad request fail one request, not the server. The junior skill is *understanding* it.

### 4. Crashing Is a State Reset

A crashed process that restarts comes back in a known-good, clean state. A process that caught a panic and limped on is in an *unknown* state — half a transaction applied, a lock maybe held, a buffer maybe corrupt. "Turn it off and on again" works because the reboot *guarantees* a clean slate, which catching-and-continuing never can.

---

## The Two-Layer Model

This is the single most important idea on this page. Memorize the table.

| | **Layer 1: Recoverable Error** | **Layer 2: Panic / Unrecoverable** |
|---|---|---|
| **Cause** | The world: bad input, missing file, network down | Your code: nil deref, bad index, broken invariant |
| **Examples** | `ENOENT`, timeout, validation failure, 404 | index out of range, nil pointer, divide by zero, OOM |
| **Right response** | Handle it: return error, retry, show message | Usually: crash with a stack trace |
| **Go** | `return err` | `panic(...)` / runtime panic |
| **Rust** | `Result<T, E>` / `?` | `panic!` / `.unwrap()` on `None` |
| **Java** | checked / runtime `Exception` you catch | `Error` (e.g. `OutOfMemoryError`), unchecked bugs |
| **Python** | `except ValueError:` you handle | uncaught exception, `AssertionError`, `SystemExit` |
| **Node** | rejected promise you `.catch()` | uncaught exception, `throw` of a programmer bug |
| **Frequency** | Common; part of normal operation | Should be *rare*; each one is a bug to fix |

The trap: treating a Layer-2 failure like a Layer-1 one. When you wrap a nil-deref in `try/except: pass`, you've taken a bug your program detected for free and **hidden it**. The bug is still there; you just blinded yourself to it.

The opposite trap exists too — treating a Layer-1 failure like a Layer-2 one. If you `panic()` every time a network call fails, your server dies on the first flaky connection. Network failures are *expected*; they belong in Layer 1.

---

## What Stack Unwinding Is

When a function calls a function calls a function, the runtime keeps a **call stack** — one frame per active call, with each frame holding that call's local variables.

```text
   main()              ← frame 0  (bottom of stack)
     process()         ← frame 1
       loadUser()      ← frame 2
         parseRow()    ← frame 3  ← PANIC fires here
```

When `parseRow` panics, the program doesn't just vanish. It **unwinds**: it walks back up — frame 3, then 2, then 1, then 0 — and at *each* frame it runs that frame's cleanup code (`defer` in Go, `finally` in Python/Java, destructors in Rust/C++). This is how files get closed and locks get released even during a failure.

```text
   PANIC at parseRow (frame 3)
        │  run parseRow's deferred cleanup
        ▼
   unwind to loadUser (frame 2)
        │  run loadUser's deferred cleanup
        ▼
   unwind to process (frame 1)
        │  run process's deferred cleanup
        ▼
   unwind to main (frame 0)
        │  no recover anywhere → process dies, prints stack trace
        ▼
   PROCESS EXITS (non-zero status)
```

If somewhere along the way a frame has a `recover()` (Go) or a `catch`/`except` (others), the unwinding **stops there** and normal execution resumes from that point. That's the difference between a panic that kills the process and one that's contained.

> Two flavors worth naming now: **unwinding** (walk up, run cleanup) vs **aborting** (stop instantly, run *nothing*). Go and Java unwind. Rust can do either depending on config. A raw `SIGABRT`/`SIGSEGV` typically aborts. You'll go deep on this at the senior and professional levels; for now, just know cleanup runs during *unwinding* but not during an *abort*.

---

## Code Examples

### Example 1 — A panic vs a returned error in Go

```go
package main

import (
	"errors"
	"fmt"
)

// LAYER 1: the world might not have this user. Return an error — caller decides.
func findUser(id int, users map[int]string) (string, error) {
	name, ok := users[id]
	if !ok {
		return "", fmt.Errorf("user %d not found", id) // expected, recoverable
	}
	return name, nil
}

// LAYER 2: this index access PANICS if the slice is too short.
// That's a *bug* (someone built the slice wrong), not a recoverable error.
func thirdElement(s []int) int {
	return s[2] // panics with "index out of range" if len(s) < 3
}

func main() {
	users := map[int]string{1: "Ada"}

	// Layer 1: handled gracefully.
	if name, err := findUser(99, users); err != nil {
		fmt.Println("handled:", err) // handled: user 99 not found
	} else {
		fmt.Println("found:", name)
	}

	// Layer 2: this will crash the program with a stack trace — and that's correct.
	fmt.Println(thirdElement([]int{10, 20})) // panic: runtime error: index out of range [2] with length 2
	_ = errors.New                            // (silence unused import in this trimmed example)
}
```

The lesson: `findUser` returns an `error` because "no such user" is a normal fact about the world. `thirdElement` panics because being handed a too-short slice means *the calling code is broken*. Don't try to "handle" the second one — fix the caller.

### Example 2 — Go `defer`, `panic`, and `recover`

```go
package main

import "fmt"

func cleanup() {
	fmt.Println("cleanup ran (defer always runs, even on panic)")
}

func risky() {
	defer cleanup() // runs on normal return AND on panic
	fmt.Println("about to panic")
	panic("something broke")
	// unreachable
}

func main() {
	// recover MUST be inside a deferred function to work.
	defer func() {
		if r := recover(); r != nil {
			fmt.Println("recovered from:", r) // we caught the panic here
		}
	}()

	risky()
	fmt.Println("this line is NOT reached — risky() panicked") // never printed
}
```

Output:

```text
about to panic
cleanup ran (defer always runs, even on panic)
recovered from: something broke
```

Read the order carefully. `panic` fires → unwinding begins → `risky`'s `defer cleanup()` runs → unwinding continues to `main` → `main`'s deferred `recover()` catches it. The line after `risky()` in `main` is *not* reached, because we caught at `main`, not in the middle. **`recover` only works inside a `defer`, and only catches panics from the same goroutine.**

### Example 3 — The same idea in Python, Java, and Node

#### Python

```python
# Layer 1: expected. Handle it.
def load_config(path: str) -> dict:
    try:
        with open(path) as f:
            return json.loads(f.read())
    except FileNotFoundError as e:
        raise RuntimeError(f"config missing at {path}") from e  # turn into a clear error

# Layer 2: a bug. Let it crash with a real traceback.
def average(nums: list[float]) -> float:
    return sum(nums) / len(nums)  # ZeroDivisionError on empty list — that's a bug upstream

# The 'finally' equivalent of Go's defer:
def with_lock(lock):
    lock.acquire()
    try:
        do_work()
    finally:
        lock.release()  # runs whether do_work() returns or raises
```

#### Java

```java
// Exception (Layer 1) — recoverable, you catch it.
try {
    var data = Files.readString(Path.of("config.json"));
} catch (IOException e) {
    log.warn("config unreadable, using defaults", e); // handle
}

// Error (Layer 2) — you do NOT catch OutOfMemoryError to "keep going".
// Letting it propagate and crash the process is the correct behavior.

// finally is Java's cleanup hook (or try-with-resources, which is better):
Lock lock = ...;
lock.lock();
try {
    doWork();
} finally {
    lock.unlock(); // always runs, even if doWork() throws
}
```

#### Node.js

```js
// Layer 1: a rejected promise you handle.
try {
  const data = await fs.readFile("config.json", "utf8");
} catch (err) {
  console.warn("config unreadable, using defaults:", err.message);
}

// Layer 2: a programmer bug thrown synchronously.
function third(arr) {
  if (!Array.isArray(arr)) throw new TypeError("expected an array"); // assertion-style
  return arr[2];
}
// An uncaught throw crashes the Node process — by default, and usually correctly.
```

---

## Panic vs Error vs Exception — Per Language

| Language | "Recoverable" mechanism | "Panic" mechanism | Default if uncaught |
|---|---|---|---|
| **Go** | `return err` (explicit) | `panic(...)`, runtime panics | Process exits, prints stack of the panicking goroutine |
| **Rust** | `Result<T, E>`, `Option<T>`, `?` | `panic!`, `.unwrap()`, `.expect()` | Unwinds (default) or aborts; thread dies, often the process |
| **Java** | `Exception` (checked/unchecked) you catch | `Error` (e.g. `OutOfMemoryError`), uncaught `RuntimeException` | Thread's `UncaughtExceptionHandler`; main thread death → JVM exits |
| **Python** | `except SomeError:` | uncaught exception, `AssertionError` | Prints traceback, exits non-zero |
| **Node/JS** | `try/catch`, `.catch()` on promises | uncaught `throw`, unhandled rejection | `uncaughtException` handler or process exit |

Two subtleties that trip beginners:

1. **In Java, `Error` and `Exception` are siblings under `Throwable`.** You *can* technically `catch (Throwable t)` and catch an `OutOfMemoryError` — but you almost never should. `Error` exists precisely to say "this is the panic layer; don't catch me."
2. **In Python, not everything is an `Exception`.** `SystemExit`, `KeyboardInterrupt`, and `GeneratorExit` inherit from `BaseException`, *not* `Exception`. So a bare `except Exception:` correctly lets Ctrl-C and `sys.exit()` through. A bare `except:` (no type) catches *everything* including those — which is a bug. **Never write `except:` with no type.**

---

## When a Program SHOULD Crash

This is the judgment that separates good engineers from defensive-programming cargo cultists. Crash (or let it crash) when:

- **An invariant your code relies on is violated.** "This map always has this key by now." "This slice is never empty here." If it is, your mental model is wrong, and continuing means operating on false assumptions.
- **Continuing would corrupt data.** A half-applied transaction, a partial write, a double charge. Better to die clean than commit garbage.
- **You cannot construct a sane fallback.** If there's no meaningful "default" or "retry," and the only options are "crash" or "pretend nothing happened," crash.
- **It's startup configuration.** A missing required env var or malformed config at boot should crash *immediately* and loudly. Don't start a server that's misconfigured — fail before you accept a single request.
- **A programmer-error assertion fails.** `assert balance >= 0`. If that's ever false, you have a bug that *must* be found, not hidden.

Do **not** crash when:

- The failure is expected and you have a real response (return an error, show a 404, retry the call).
- You're at a request/worker **boundary** and can contain the blast radius to one request (the middle-level pattern).
- The failure is in optional, non-critical work (a metrics push failing shouldn't kill the request).

> The heuristic: **crash on broken invariants, handle on bad input.** If you can't tell which one you're looking at, that confusion *is* the bug — go find out which it is before writing a single `catch`.

---

## Pros & Cons of Crashing vs Recovering

| Approach | Pros | Cons |
|---|---|---|
| **Let it crash (fail-fast)** | Loud, immediate, debuggable. Clean state on restart. Bug can't spread or corrupt data. Stack trace points right at it. | One bug can take down a whole process. Needs a supervisor/restart to be resilient. Bad UX if it's user-facing and unguarded. |
| **Recover at a boundary** | Contains blast radius to one request/worker. Server survives a bad input. Can log + report the panic cleanly. | Only safe if state really is isolated per request. Easy to get wrong (leaked locks, shared corrupt state). |
| **Recover-and-continue everywhere** | Feels "robust" to beginners. Nothing ever crashes. | Almost always a bug. Hides defects forever. Continues on corrupt state. The classic `except: pass` disease. |
| **Convert to a returned error** | Right answer for Layer-1 failures. Caller decides what to do. | Wrong (and noisy) if applied to genuine bugs — you'd be "handling" something unhandleable. |

The honest rule: **default to crashing; recover only at deliberate boundaries; never recover-and-continue blindly.**

---

## Use Cases

| Situation | Right move |
|---|---|
| File the user asked for doesn't exist | Layer 1 — return/raise a clear error, let the caller respond. |
| Required config env var missing at startup | Crash immediately and loudly. Don't start. |
| `nil` pointer dereference deep in your code | Let it panic. It's a bug. Fix the cause, don't catch the symptom. |
| One bad HTTP request triggers a panic in your handler | Recover *at the handler boundary*, log it, return 500, keep serving others (middle level). |
| Network call to a flaky third party fails | Layer 1 — retry with backoff or return an error. Never panic. |
| Out of memory | Let it crash. You cannot reliably recover; the process should die and restart. |
| An `assert` that "can't happen" happens | Crash. That's the assertion doing its job — finding a bug. |
| Background metrics push fails | Log and continue. It's non-critical; don't let it affect the main path. |

---

## Coding Patterns

### Pattern 1 — The Startup Assertion (Crash Early)

```go
func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		// Crash at startup. A misconfigured server should never accept traffic.
		log.Fatalf("required env var %s is not set", key)
	}
	return v
}

dbURL := mustEnv("DATABASE_URL") // if missing, process dies here, before serving
```

The `Must`/`mustX` naming convention (Go) signals "this panics/exits on failure, by design." It's appropriate for *startup* and *programmer-supplied* inputs, not for runtime user input.

### Pattern 2 — `defer` for Guaranteed Cleanup

```go
func process(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err // Layer 1: file might not exist
	}
	defer f.Close() // runs on normal return AND on panic — file always closes

	return doWork(f)
}
```

### Pattern 3 — Let It Propagate (the "do nothing" pattern)

```python
def parse_order(raw: dict) -> Order:
    # If raw is missing required keys, KeyError propagates. Good.
    # Do NOT wrap this in try/except: pass — a malformed order is a bug to surface.
    return Order(id=raw["id"], total=raw["total"])
```

Sometimes the most correct code is the code you *don't* write. No `try`. No `recover`. Let the failure travel to where someone can actually decide.

### Pattern 4 — The Sanity Assertion

```go
if len(items) == 0 {
	panic("invariant violated: items must be non-empty at this point")
}
```

If your assumption holds, this is invisible. If it's wrong, you get an immediate, loud crash *at the exact line the assumption broke* — a free, precise diagnostic. (See the same idea in [Debugging — Junior](../debugging/junior.md#coding-patterns).)

---

## Clean Code

- **Never write `except:` (Python) or `catch (Throwable)` (Java) without a very specific reason.** They swallow Ctrl-C, `SystemExit`, and `OutOfMemoryError` — things you must let through.
- **Never write `recover()` (Go) just to "be safe."** Recover only at a boundary you can name, for a reason you can articulate.
- **Don't convert bugs into errors to make them "go away."** A `nil` deref turned into a returned `nil, nil` is a landmine for the next caller.
- **Name panic-on-failure functions clearly** — `MustParse`, `mustEnv` — so readers know they crash by design.
- **Put cleanup in `defer`/`finally`/`with`, not in the happy path** — so it runs even when things blow up.
- **Crash on startup misconfiguration.** A server that boots with bad config is worse than one that refuses to boot.

---

## Best Practices

1. **Sort every failure into Layer 1 or Layer 2 before reacting.** The category dictates the response.
2. **Default to letting it crash.** Add recovery deliberately, never defensively.
3. **Read the panic message and stack trace.** They tell you exactly which invariant broke and where.
4. **Use `defer`/`finally` for cleanup**, so locks and files release during unwinding.
5. **Fail fast at startup** for any missing or invalid required configuration.
6. **Never use a bare `except:` or catch the panic-layer types** (`Error`, `BaseException`) without a deliberate, documented reason.
7. **Fix the cause of a panic, not the symptom.** Catching it is treating the smoke; fixing the invariant is putting out the fire.
8. **When you must recover, log the panic and the stack** so the bug isn't lost. (Detail at the middle level and in [Crash Reporting](../crash-reporting/README.md).)

---

## Edge Cases & Pitfalls

- **A panic in a goroutine/thread can crash the *whole* process**, even though the rest of the program looks fine. In Go, a panic in a goroutine with no `recover` in *that goroutine* takes down everything. You cannot catch it from the parent.
- **`recover()` only works in a deferred function, and only in the same goroutine.** Calling `recover()` directly (not via `defer`) does nothing. Calling it from a different goroutine does nothing.
- **`finally`/`defer` can swallow the original exception** if *they* throw or return. A `finally` that `return`s discards the in-flight exception. Be careful what you do in cleanup.
- **Python's bare `except:` catches `KeyboardInterrupt` and `SystemExit`.** Now Ctrl-C doesn't work and `sys.exit()` is ignored. Always catch a specific type, or at least `except Exception:`.
- **A divide-by-zero is not the same across languages.** Integer `1/0` panics/throws in Go, Java, Python. But *floating-point* `1.0/0.0` gives `+Inf`/`NaN` silently — no crash, just poison data downstream. (See [Debugging — Junior](../debugging/junior.md).)
- **Catching too broadly hides new bugs.** A `catch (Exception e)` around a big block will silently catch the `NullPointerException` you introduce next month.

---

## Common Mistakes

1. **`try/except: pass` (or Go's `_ = err`, or empty `catch {}`).** The single most damaging beginner habit. It turns a detected failure into silent wrong behavior.
2. **Treating a bug as an error.** Wrapping a nil-deref in error-handling instead of fixing the nil. The bug stays; you just stopped seeing it.
3. **Treating an error as a bug.** Panicking on a network timeout. Now a flaky connection crashes your server.
4. **Using `recover()` everywhere "to be safe."** Defensive recovery hides every bug in the program.
5. **Catching `Throwable` / using bare `except:`.** Swallows the things you must never swallow (OOM, Ctrl-C, exit).
6. **Assuming a goroutine/thread panic is contained.** It isn't, by default. An unhandled goroutine panic kills the whole process.
7. **Doing meaningful work in `finally`/`defer` that can itself fail**, masking the original failure.
8. **Not reading the stack trace.** The panic told you exactly where and why. Read it before you "fix" anything.
9. **Crashing the request path on optional work** (a failed metrics emit shouldn't 500 the user).
10. **Starting a server with invalid config** instead of crashing at boot.

---

## Tricky Points

1. **`recover()` returns `nil` when there's no panic** — so `if r := recover(); r != nil` is the idiom. A `recover()` that's never reached during a panic does nothing.
2. **`defer` evaluates its arguments immediately, but runs the call at the end.** `defer fmt.Println(x)` captures `x`'s value *now*, not at return time. Subtle source of "wrong value logged" bugs.
3. **The panic-layer types are deliberately separate.** Java's `Error`, Python's `BaseException` (above `Exception`), Go's runtime panics — the language *designers* drew the line so you'd know not to catch them.
4. **An exception thrown inside a `finally` replaces the original.** The first failure is lost; you only see the second. Java even has "suppressed exceptions" to partially address this.
5. **Re-panicking after recover** is sometimes correct: you recover at a boundary, log it, then decide the state is too corrupt and `panic` again to crash. Recovering doesn't *commit* you to continuing.
6. **Floating-point division by zero doesn't panic** — it yields `Inf`/`NaN`. The "safe-looking" math is the dangerous one because there's no crash to alert you.
7. **`os.Exit()` (Go) / `System.exit()` (Java) skip `defer`/`finally` entirely.** They terminate *now*, with no unwinding. Don't expect cleanup to run after them.

---

## Test Yourself

Work through these honestly — no answer key, they're for self-assessment.

1. For each of these, say Layer 1 or Layer 2: (a) user submits an empty form, (b) you index `arr[5]` on a 3-element array, (c) the database connection drops, (d) a required env var is missing at startup, (e) `nil.foo()`.
2. Write a Go program with a `defer`, a `panic`, and a `recover` in `main`. Predict the exact output order, then run it and check.
3. Take a function you've written that has a `try/except: pass` (or empty `catch`). Decide: is it hiding a Layer-2 bug? Replace it with either real handling or "let it propagate."
4. Explain, in one sentence each, why catching `OutOfMemoryError` in Java and writing bare `except:` in Python are both bugs.
5. In a language of your choice, deliberately trigger a divide-by-zero with *integers*, then with *floats*. Note which crashes and which silently produces poison.
6. Draw the unwinding path for a panic three frames deep, marking where each frame's cleanup runs and where the process dies if nothing recovers.
7. Name three situations where crashing is the *safe* choice and explain the blast radius of each.

---

## Tricky Questions

**Q1: Is a crash always bad?**

No — often it's the *safe* outcome. The truly bad outcome is continuing with corrupt state: double charges, garbage writes, wrong data returned. A crash is loud, contained, and recoverable (restart → clean state). Prefer a clean crash to a silent lie.

**Q2: What's the difference between a panic and an error?**

An **error** is an expected failure from the world (bad input, missing file) that your program is *supposed* to handle. A **panic** signals a broken assumption *inside your code* (nil deref, bad index) — usually a bug you should fix, not catch. Different layers, different responses.

**Q3: Why is `try/except: pass` (or empty `catch`) almost always wrong?**

Because it converts an unknown failure into a wrong-looking success. The program keeps running on bad state, the symptom shows up later somewhere unrelated, and the original cause is gone. Either handle the specific error meaningfully or let it propagate.

**Q4: Does `recover()` in Go let you "ignore" any panic?**

Mechanically it stops the panic — but using it that way is a bug. `recover` is for *boundaries* (one HTTP handler shouldn't crash the whole server), where you log the panic, return an error, and contain the damage. It is not a license to ignore bugs. And it only works inside a `defer`, in the *same* goroutine.

**Q5: A panic happens in a goroutine. Can I catch it in `main`?**

No. A panic only unwinds *its own* goroutine's stack. If that goroutine has no `recover`, the whole process dies — `main` can't catch it. You must `recover` *inside the goroutine itself*. This surprises almost everyone the first time.

**Q6: When should I let a program crash on purpose?**

On a violated invariant ("this can't be empty here" but it is), when continuing would corrupt data, when there's no sane fallback, or on missing/invalid startup config. Crash early and loud — before bad state spreads.

**Q7: Does cleanup always run when a program fails?**

During **unwinding** (Go panic, Java/Python exception), yes — `defer`/`finally`/destructors run. During an **abort** (`SIGABRT`, `os.Exit`, `System.exit`, a hard segfault), **no** — the process stops instantly with no cleanup. Know which path you're on.

---

## Cheat Sheet

```text
┌────────────────────────── PANIC & RECOVERY — JUNIOR CHEAT SHEET ──────────────────────────┐
│                                                                                           │
│  THE TWO LAYERS (sort EVERY failure into one)                                             │
│    LAYER 1  recoverable error   the world misbehaved   → HANDLE (return/raise, retry)     │
│    LAYER 2  panic / unrecover.  your code is broken    → usually CRASH (let it die)       │
│                                                                                           │
│  WHO SAYS WHAT                                                                            │
│    Go      return err          |  panic(...)        | recover() in a defer                │
│    Rust    Result / ? / Option |  panic! / .unwrap()| catch_unwind (rarely)               │
│    Java    Exception (catch)   |  Error (don't)     | UncaughtExceptionHandler            │
│    Python  except SomeError    |  uncaught exc.     | BaseException > Exception            │
│    Node    try/catch, .catch() |  uncaught throw    | uncaughtException                    │
│                                                                                           │
│  UNWINDING                                                                                │
│    panic → walk up the stack → run defer/finally/destructors at each frame                │
│           → recover/catch stops it, OR process dies at main                               │
│    ABORT (SIGABRT, os.Exit, System.exit) = stop NOW, NO cleanup                           │
│                                                                                           │
│  CRASH ON PURPOSE WHEN                                                                    │
│    • broken invariant   • would corrupt data   • no sane fallback                         │
│    • bad startup config • a "can't happen" assertion happens                              │
│                                                                                           │
│  RED FLAGS                                                                                │
│    except: pass            → swallows everything, incl. Ctrl-C / exit                     │
│    recover() everywhere    → hides every bug                                              │
│    catch (Throwable)       → catches OutOfMemoryError                                     │
│    panic on a timeout      → wrong layer; crashes server on flaky net                     │
│                                                                                           │
│  GOLDEN RULES                                                                             │
│    • A clean crash beats a quiet lie.                                                     │
│    • Default to letting it crash; recover only at deliberate boundaries.                 │
│    • Crash on broken invariants, handle on bad input.                                     │
│    • A goroutine/thread panic can kill the WHOLE process.                                 │
│    • recover() only works inside a defer, same goroutine.                                 │
│                                                                                           │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- There are **two layers of failure**: recoverable errors (the world misbehaved → handle) and panics/unrecoverable failures (your code is broken → usually crash).
- A **panic** is your program telling you an invariant broke. It's a free, precise bug report — don't delete it by swallowing it.
- **Crashing is often the safe choice.** Silent corruption is worse than a clean, loud, debuggable crash that restarts into a clean state.
- **Stack unwinding** walks back up the call stack after a panic, running cleanup (`defer`/`finally`/destructors) at each frame, until something catches it or the process dies.
- **Aborting** (`SIGABRT`, `os.Exit`, `System.exit`) stops instantly with *no* cleanup — different from unwinding.
- Go's **`recover()` only works inside a `defer`, in the same goroutine**, and should only be used at deliberate boundaries — never sprinkled defensively.
- **Never write bare `except:` or catch `Throwable`/`Error`/`BaseException`** — they swallow Ctrl-C, exit, and OOM, which you must let through.
- **Sort every failure into a layer before reacting.** Crash on broken invariants, handle on bad input. When you can't tell which, *that confusion is the bug.*
- A **goroutine/thread panic can take down the whole process** — it's not automatically contained.
- The default is **let it crash**; you add recovery deliberately, at one place, for one nameable reason.

---

## What You Can Build

- A **"layer classifier" worksheet**: list 30 real failures from a project you've worked on and sort each into Layer 1 or Layer 2. Notice which ones you've been handling at the wrong layer.
- A **`Must`-style helper library** in Go and Python: `mustEnv`, `mustParseInt`, `mustOpen` — functions that crash loudly on failure, for use at startup only. Document clearly that they panic by design.
- A **deliberately-crashing demo app** with one example of each: a swallowed-bug (`except: pass` hiding a real defect), a correctly-handled Layer-1 error, and a correct fail-fast on bad config. Show how the first one corrupts data silently while the others don't.
- A **`defer`/`finally` order quiz** for friends: small snippets where they predict the exact output order of cleanup vs panic vs recover, then run to check.
- A **"divide by zero" tour**: a tiny program in Go/Python/Java showing that integer `/0` crashes but float `/0` silently yields `Inf`/`NaN` — the dangerous-because-quiet case.

---

## Further Reading

- **Effective Go — `defer`, `panic`, `recover`** — the canonical short explanation. <https://go.dev/doc/effective_go#defer>
- **The Go Blog — "Defer, Panic, and Recover"** — <https://go.dev/blog/defer-panic-and-recover>
- **Rust Book — "To `panic!` or Not to `panic!`"** — when to use `Result` vs `panic!`. <https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html>
- **Python docs — Built-in Exceptions hierarchy** — see how `BaseException` sits above `Exception`. <https://docs.python.org/3/library/exceptions.html>
- **Java — `Error` vs `Exception`** — why `OutOfMemoryError` is an `Error`. <https://docs.oracle.com/javase/8/docs/api/java/lang/Error.html>
- *The Pragmatic Programmer* — Hunt & Thomas — "Crash Early" and "Design by Contract."

---

## Related Topics

- **Next level up:** [middle.md](middle.md) — the recover-at-boundary pattern, per-request/per-worker isolation, logging and reporting a panic, Rust `catch_unwind`.
- **Senior level:** [senior.md](senior.md) — fail-fast vs resilience, abort vs unwind, crash-only design, supervision, panic across goroutines/threads/async.
- **Professional level:** [professional.md](professional.md) — unwinding internals, `panic = "abort"` in prod, FFI/unwind UB, poisoned locks, resilient worker pools.
- **Interview prep:** [interview.md](interview.md) — graduated Q&A on panic, recover, and failure design.
- **Practice:** [tasks.md](tasks.md) — hands-on labs at each level.

**Sibling diagnostic topics:**

- [Error Handling — Junior](../error-handling/junior.md) — the *recoverable* half of failure: how to express and handle Layer-1 errors well.
- [Crash Reporting — Junior](../crash-reporting/junior.md) — once a panic escapes, how you find out it happened (Sentry, Crashlytics).
- [Debugging — Junior](../debugging/junior.md) — reading the stack trace a panic gives you for free.

**Cross-roadmap links:**

- [Clean Code — Error Handling](../../code-craft/clean-code/06-error-handling/README.md) — error-handling discipline that keeps the two layers separate.

---

## Diagrams & Visual Aids

### The Two Layers

```text
   ┌──────────────────────── A FAILURE HAPPENS ────────────────────────┐
   │                                                                   │
   │            Which box?                                             │
   │      ┌──────────────────┐         ┌──────────────────────┐        │
   │      │  LAYER 1          │         │  LAYER 2              │        │
   │      │  "world misbehaved"│        │  "my code is broken" │        │
   │      │  bad input, 404,  │         │  nil deref, bad index│        │
   │      │  timeout, no file │         │  divide by zero, OOM │        │
   │      └────────┬─────────┘         └──────────┬───────────┘        │
   │               │                              │                    │
   │               ▼                              ▼                    │
   │        HANDLE IT                      usually CRASH               │
   │   return/raise error,             let it panic, fix the          │
   │   retry, show message             invariant — don't catch        │
   └───────────────────────────────────────────────────────────────────┘
```

### A Panic Unwinding the Stack

```text
   parseRow()   ── PANIC! ──┐         ← invariant broke here
        │  run defer/finally │
        ▼                    │
   loadUser()                │  unwinding
        │  run defer/finally │  (cleanup runs at each frame)
        ▼                    │
   process()                 │
        │  run defer/finally │
        ▼                    ▼
   main()   ── recover? ── NO → process DIES, prints stack trace
                         └ YES → caught; execution resumes here
```

### Blast Radius

```text
   returned error        →  ▣                    (1 function call)
   recovered-at-boundary →  ▣▣▣                  (1 request, server lives)
   unrecovered panic     →  ▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣  (the WHOLE process)

   The job: shrink the blast radius on purpose — don't let one bad
   input take the whole server down, and don't catch a bug so quietly
   that it corrupts everything.
```
