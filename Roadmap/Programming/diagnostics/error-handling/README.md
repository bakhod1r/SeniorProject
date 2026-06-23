# Error Handling Roadmap

> *"The most important property of a program is whether it accomplishes the intention of its user."* — C.A.R. Hoare

This roadmap is about **how a program tells the truth to its caller when something goes wrong** — the design problem of expressing failure in code: exceptions vs return values vs `Result<T,E>`, wrapping, sentinels, panics, retries, and the boundaries where domain errors get translated into protocol errors.

> Looking for the *operator-facing side* (structured logs, log levels, correlation IDs, sampling)? See the sibling roadmap: [Logging](../logging/README.md). Error handling answers "how does my code report failure?" — logging answers "how does my system record it?"
>
> Looking for the *Clean Code chapter angle*? See [Clean Code → Error Handling](../../code-craft/clean-code/06-error-handling/README.md).
>
> Looking for *language-specific* idioms? See [Golang → Error Handling](../../languages/golang/05-error-handling/01-error-handling-basics/junior.md).
>
> Looking for *retry / circuit breaker / backoff*? Those are resilience patterns — see the `retry-pattern`, `circuit-breaker-pattern`, and `error-handling-patterns` skills.

---

## Why a Dedicated Roadmap

Languages disagree on errors more than on almost any other feature — exceptions (Java, Python), values (Go), `Result` / `Option` (Rust), `Either` (Haskell/Scala) — and most teams pick a style by accident. This roadmap treats error design as a **first-class API problem**, separated cleanly from operational logging.

| Roadmap | Question it answers |
|---|---|
| [Testing](../../quality-engineering/testing/README.md) | Does the happy path work? |
| [Debugging](../debugging/README.md) | Why didn't it work? |
| **Error Handling** (this) | How should my code express that something went wrong? |
| [Logging](../logging/README.md) | How should my system record that something went wrong? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| 01 | The Taxonomy of Failure | Bugs, expected errors, panics/aborts, partial failures, retryable vs terminal |
| 02 | Error Models Across Languages | Exceptions (Java, Python), returns (Go), `Result` / `Option` (Rust), `Either` (Haskell/Scala) |
| 03 | Error Wrapping & Context | `errors.Wrap`, `%w`, exception chaining, stack traces, the "five W's" of an error |
| 04 | Sentinel vs Typed Errors | When equality matters, when type matters, when neither does |
| 05 | Boundaries & Translation | Mapping domain errors to HTTP / gRPC / user-facing messages |
| 06 | Defensive vs Offensive | Fail loud at boundaries, fail fast inside; when to panic |
| 07 | Retries & Idempotency | What's safe to retry, exponential backoff, the `retry-pattern` skill |
| 08 | Error Design as API Design | Error types as part of your public surface; versioning errors; documenting them |
| 09 | Anti-Patterns | Swallowed exceptions, `catch (Exception e)`, error codes leaking through layers, panic-as-control-flow |
| 10 | Result Types in OO Languages | Bringing `Result<T,E>` ergonomics to Java / C# / Python without ML-style pattern matching |

---

## Languages

Examples in **Go** (errors as values), **Java** (checked + unchecked exceptions), **Python** (exceptions, context managers), and **Rust** (`Result` / `?` operator) — to highlight that the *design questions* are the same even when the *syntax* isn't.

---

## Status

⏳ **Structure defined; content pending.**

---

## References

- *Release It!* — Michael Nygard (production-grade error handling patterns)
- Dave Cheney — ["Don't just check errors, handle them gracefully"](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully)
- Joe Duffy — *The Error Model* (Midori postmortem, 2016)
- *Effective Java* (Bloch) — items on exceptions

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
