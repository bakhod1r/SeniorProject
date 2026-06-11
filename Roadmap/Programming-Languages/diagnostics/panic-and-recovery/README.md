# Panic & Recovery Roadmap

> *"An unrecovered panic is the program telling you something is so wrong that it would rather stop than continue lying about its state."*

This roadmap is about **what happens when a program encounters something it cannot handle in normal flow** — Go panics, Java `Error` (not `Exception`), Rust `panic!`, JVM uncaught handlers, Python `SystemExit`, signals, and the discipline of when to *recover* vs when to *let it crash*. It is the half of error handling that lives below the normal `try` / `Result` layer.

> Looking for *normal* error handling (exceptions, `Result`, sentinel errors)? See [Error Handling](../error-handling/).
>
> Looking for *crash reporting* after the process dies (Sentry, Crashlytics)? See [Crash Reporting](../crash-reporting/).

---

## Why a Dedicated Roadmap

Every mainstream language has two error layers, often without saying so:

1. **Expected errors** — files don't exist, networks fail, validation fails. Recoverable. Handled with `try`/`catch`, `Result<T, E>`, `error` returns.
2. **Programmer-mistake / invariant-broken errors** — nil dereference, divide by zero, stack overflow, out-of-memory. *Usually* not recoverable. Handled with panic / fatal / `Error` / signal.

The senior skill is **knowing which layer you're at**, and choosing the right tool. Catch-all `recover()` everywhere = bugs hidden forever. No `recover()` ever = one bad request takes down the whole pool.

| Roadmap | Question it answers |
|---|---|
| [Error Handling](../error-handling/README.md) | How do I express recoverable failures? |
| [Crash Reporting](../crash-reporting/README.md) | How do I get told about the ones that escaped? |
| **Panic & Recovery** (this) | When is it correct to crash, and when to catch the crash? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| 01 | The Two-Layer Model | Recoverable error vs invariant violation; why every modern language has both |
| 02 | Unwinding | Stack unwinding semantics; destructors / `defer` / `finally` during unwind; double-panic |
| 03 | Go `panic` / `recover` / `defer` | The Go model, idiomatic uses, when "let it crash" is right |
| 04 | Rust `panic!` and `catch_unwind` | Aborting vs unwinding panics, FFI safety, `panic = "abort"` profile |
| 05 | JVM `Error` vs `Exception` | Why `OutOfMemoryError` is `Error`, not `Exception`; uncaught exception handlers |
| 06 | Python `SystemExit`, `KeyboardInterrupt`, `BaseException` | The hierarchy that escapes `except Exception`; signal-driven exits |
| 07 | Async / Coroutine Failure Propagation | Lost panics in spawned tasks, structured concurrency to the rescue |
| 08 | Signals | `SIGSEGV`, `SIGABRT`, `SIGPIPE`, `SIGINT`, `SIGTERM`; signal-safe code; the signal/thread interaction |
| 09 | "Let It Crash" Philosophy | Erlang / OTP supervisors; process-per-failure; when the runtime helps |
| 10 | Recover-at-Boundary Pattern | HTTP handler / worker boundary recover; logging the panic, returning 500, continuing the pool |
| 11 | Reporting Panics | Wiring panic → crash-reporting; release tagging, fingerprinting; per-language hooks |
| 12 | Anti-patterns | `recover()` swallowing everything, `except:` catching `SystemExit`, panic-driven control flow, no last-resort handler |

---

## Languages

Examples in **Go** (`panic` / `recover` / `defer`), **Rust** (`panic!`, `catch_unwind`, `panic_hook`), **Java/Kotlin** (`Error` vs `Exception`, `Thread.UncaughtExceptionHandler`), **Python** (`BaseException` hierarchy, signal handlers), **Erlang/Elixir** (the "let it crash" exemplar).

---

## Status

✅ **Content complete** — `junior` · `middle` · `senior` · `professional` · `interview` · `tasks`.

---

## References

- *Erlang and OTP in Action* — Logan, Merritt, Carlsson (the "let it crash" model)
- *Programming Rust, 2nd ed.* — Blandy, Orendorff, Tindall (panic semantics chapter)
- *Effective Go* — `defer`, `panic`, `recover` section
- *Async Rust panic safety* — community RFC discussions

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
