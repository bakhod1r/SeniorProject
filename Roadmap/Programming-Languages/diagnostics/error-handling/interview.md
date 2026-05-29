# Error Handling — Interview Questions

> **Topic:** [Error Handling Roadmap](README.md)
> **Focus:** The questions interviewers actually ask about errors — from "what's an exception" to "design the error type for a payments SDK."

---

## Introduction

Error handling is one of the few topics that **every** interviewer probes, regardless of role. Juniors get the basics ("what's the difference between an error and a bug?"), mid-level engineers get the language-specific traps ("what does `errors.Is` do?"), seniors get design scenarios ("walk me through the error model for our SDK"), and staff candidates get war stories ("tell me about an outage caused by a swallowed error"). Hiring panels use error questions because the answers reveal *how a candidate thinks about failure* — and failure is where production code earns its money.

This page collects the questions you'll actually hear, clustered by category, not by level. A junior question can become a senior question by going one layer deeper, and vice versa. The answers are written to be useful both to interviewers (a reference for what good looks like) and to candidates (a study guide for the topics that come up). When a question has a popular **wrong** answer, that wrong answer is called out — interviewers love the traps that catch fast talkers.

---

## Table of Contents

1. [Conceptual / Foundational](#conceptual--foundational)
2. [Language-Specific Questions](#language-specific-questions)
   - [Go](#go)
   - [Python](#python)
   - [Java](#java)
   - [Rust](#rust)
3. [Tricky / Trap Questions](#tricky--trap-questions)
4. [System / Design Scenarios](#system--design-scenarios)
5. [Coding Questions](#coding-questions)
6. [Behavioral / Experience Questions](#behavioral--experience-questions)
7. ["What I'd Ask a Candidate Now"](#what-id-ask-a-candidate-now)
8. [Cheat Sheet](#cheat-sheet)
9. [Further Reading](#further-reading)
10. [Related Topics](#related-topics)

---

## Conceptual / Foundational

These are the warm-up questions. They sound easy. They aren't. Interviewers use them to filter out candidates who've memorized syntax but don't understand the *why*.

### Q: What's the difference between an error and a bug?

An **error** is a condition the program legitimately expects to encounter: the network drops, a file is missing, a user submits invalid input, a database times out. The code's job is to *handle* errors — translate them, recover from them, surface them to the user.

A **bug** is a defect in the code itself: a null pointer dereference that "can't happen", an off-by-one, a forgotten branch. Bugs are *not* expected. They should not be silently caught and swallowed; they should crash loudly so the engineer notices and fixes the code.

The interview trap: candidates conflate the two and end up wrapping `try/except` around everything, including bugs. A good answer ends with: *"Catch errors. Let bugs crash."*

### Q: Why is `catch (Exception e)` considered a code smell?

Because it catches **everything** — including the things you absolutely don't want to catch. `NullPointerException` (a bug), `OutOfMemoryError` (a JVM crisis), `IllegalStateException` (a programming mistake) — all swallowed. The caller can't tell whether the call failed because the user typed nonsense or because a programmer forgot to initialize a field. The error gets logged and the system limps on, often in a corrupted state.

Worse: it's *contagious*. Once one layer catches `Exception`, the next layer up never sees the real cause, and debugging becomes archaeology. Catch the **narrowest** type you can actually handle. Let everything else fly.

### Q: Why is silent failure dangerous?

A silent failure is when code knows something went wrong and chooses to say nothing — `except: pass` in Python, `if err != nil { return nil }` in Go, an empty `catch` block in Java. The danger isn't the immediate bug; it's that the system continues operating on data that *looks* fine but isn't. Your payment "succeeded" but no row was written. Your cache "hit" but returned stale data. By the time anyone notices, the trail is cold and the corrupted data has spread.

The rule: an error must either be **handled** (you did something meaningful in response) or **propagated** (passed up the stack). "Logged and forgotten" is not handling.

### Q: What's the difference between checked and unchecked exceptions in Java? Why is the consensus that checked exceptions failed?

**Checked exceptions** must be declared (`throws IOException`) or caught locally. **Unchecked** (`RuntimeException` subclasses) don't. Original intent (1990s Java) was to make failure visible and force callers to acknowledge that I/O can fail.

The consensus today: checked exceptions failed because **they don't compose**. As call chains grow, signatures bloat with irrelevant `throws` clauses, or developers wrap everything in `throws Exception`, defeating the purpose. Lambdas (Java 8) made it worse — `Function<T, R>` can't throw checked exceptions, so stream pipelines wrap them into `RuntimeException`. The JDK itself (NIO, Streams) prefers unchecked. Hejlsberg called them a "wart" in 2003; Spring, Hibernate, and Kotlin all dropped them.

### Q: What does `errors.Is(err, target)` do that `==` doesn't? Why does it matter?

`errors.Is` unwraps the error chain. If your code returns `fmt.Errorf("loading user: %w", sql.ErrNoRows)`, the value `err == sql.ErrNoRows` is **false** (different concrete value, the wrapped one), but `errors.Is(err, sql.ErrNoRows)` is **true** because it walks the chain via `Unwrap()`.

It matters because Go's wrapping idiom (`%w`) is only useful if there's a way to *check* the wrapped sentinel. Without `errors.Is`, you either lose context (pass the bare sentinel) or lose the ability to switch on it (pass the wrapped one). `errors.Is` lets you have both.

### Q: What does `raise ... from None` mean in Python?

It **suppresses the implicit exception chain.** When you raise inside an `except` block, Python attaches the original to `__context__` and prints both ("During handling of the above exception..."). `from None` hides it — useful when you caught a low-level `KeyError` and want to raise a clean `ValidationError` for the user.

`raise X from original` explicitly chains via `__cause__` ("The above exception was the direct cause..."). Three options total: bare `raise X` (implicit context), `raise X from y` (explicit cause), `raise X from None` (suppress).

### Q: Why is `panic` discouraged in Go production code? When IS it correct?

Panics break the contract that errors are values. They unwind the stack, skip cleanup unless `defer` covers it, and require `recover()` to handle — which is awkward and easy to forget. In a long-running server, a panic in one goroutine can crash the whole process.

`panic` is correct for **truly impossible states** — the kind where continuing execution would corrupt data. Examples: an unreachable `default` branch in a switch over a closed enum, a programmer error in initialization (a config file the binary refuses to start without), or library code where the caller violated the API in a way that no error return could express (`runtime.GOMAXPROCS(0)` panics rather than silently returning the current value with no signal). It is **not** for "file not found" or "user typed garbage" — those are returns.

### Q: Explain `try-with-resources` in Java and why `addSuppressed` exists.

`try-with-resources` automatically closes any `AutoCloseable` declared in its header, in reverse order, even if the body throws. It eliminates the "leaked resource on exception" footgun of plain `try/finally`.

`addSuppressed` exists because closing a resource can *also* throw. If the body throws `IOException("read failed")` and `close()` throws `IOException("disk full")`, pre-Java 7 the close-exception silently replaced the first and you'd never see the read error. With `addSuppressed`, the primary keeps its identity and the close-exception attaches to it; both appear in the stack trace.

### Q: What is exception chaining and why does it matter?

Exception chaining preserves the **causal history** of an error. When layer N catches a low-level error and re-raises a domain-level one, the original is attached as cause. The stack trace shows both: "UserNotFoundError caused by ConnectionRefusedError caused by socket.error". Without chaining, the operator sees `UserNotFoundError` and has no idea whether the user is missing or the database is down — two completely different incidents.

### Q: What is "fail fast" and when is it the right answer?

Detect an inconsistent state at the earliest moment and stop — null check at the top of a function, config validation at startup, schema check on incoming JSON. Right when continuing would corrupt persistent state, mislead the caller, or destroy debuggability. **Wrong** when failing fast crashes a process handling many independent jobs (a 10k-connection server shouldn't die because one request had a bad header).

### Q: What's the difference between recoverable and unrecoverable errors? Who decides?

Recoverability is **a property of the caller, not the error.** "Network timeout" is recoverable for a background sync (retry later) but unrecoverable for a user-facing checkout (show an error). Same `ConnectionRefused`, different verdicts.

This is why "errors as values" languages (Go, Rust) win long-term: they let the *caller* decide. A library that catches its own errors and decides for you ("don't worry, I retried 3 times!") is taking authority that wasn't given.

### Q: What is the "error boundary" concept?

A layer where errors of one *kind* are translated into errors of another. An HTTP handler converts domain errors to status codes; a DB adapter wraps `pq.Error` into `RepositoryError`; a React error boundary catches render errors and shows a fallback. Boundaries serve two purposes: **leakage prevention** (a `pq.UniqueViolation` shouldn't appear in your HTTP response) and **stability** (the upstream API doesn't change when you swap PostgreSQL for MySQL). Designing boundaries deliberately separates senior from mid-level error handling.

### Q: Why are stack traces important, and when can they hurt you?

Stack traces tell you **where** and **how** the error happened — file, line, call chain. Without them, debugging is guesswork. They can hurt you when (1) leaked to end-users they expose internal paths, code structure, and sometimes secrets; (2) capturing them is expensive — exceptions-as-control-flow can dominate CPU; (3) in distributed systems they show only the local stack, not the cross-service causal chain (that's what distributed tracing is for).

### Q: What's the relationship between logging and error handling?

Complementary, not interchangeable. **Logging** records that something happened for later investigation. **Error handling** decides what the program does *now*. The common mistake is `log.error(e); return null;` — that "handles" nothing. The error was logged but the caller has no idea anything was wrong. Rule: handle the error (retry, fall back, return, fail fast), then log if appropriate, never log *instead* of handling.

### Q: What does it mean for an error to be "actionable"?

An actionable error answers three questions: **what went wrong**, **where**, and **what should I do about it**. "Database error" is not actionable. "Failed to acquire connection from pool 'user-db' after 5s; pool size=10 in-use=10; consider raising pool size or investigating leaks" — actionable. Requires *deliberate design*: what fields, what message format, what level. Not a side-effect of logging.

---

## Language-Specific Questions

### Go

#### Q: How do you wrap errors in Go? What's the difference between `%w` and `%v` in `fmt.Errorf`?

`%w` wraps the error so it stays *reachable* via `errors.Is` and `errors.As`:

```go
return fmt.Errorf("loading user %d: %w", id, err)
```

A caller can then do `errors.Is(returned, sql.ErrNoRows)` and get the right answer. `%v` only formats as a string and discards identity — `errors.Is` returns false. Use `%v` only when you deliberately want to hide the inner error behind a boundary.

#### Q: What are sentinel errors, and when should you use them vs typed errors?

**Sentinel errors** are package-level error variables you compare against: `io.EOF`, `sql.ErrNoRows`, `context.Canceled`. They work well for *condition flags* — "this isn't a problem, just a signal" — where there's no extra payload.

**Typed errors** (`type NotFoundError struct{ ID string }`) work better when you need to attach data, or when you need polymorphism over many similar errors. Use `errors.As(err, &target)` to extract them.

Rule of thumb: sentinels for shared signals across the whole ecosystem (`io.EOF`), typed errors for your domain (`NotFoundError`, `ValidationError`). Avoid creating sentinels in every package — they bloat the API surface and make it hard to add metadata later.

#### Q: What does `errors.As` do that `errors.Is` doesn't?

`errors.Is` checks for **equality with a target value** along the chain. `errors.As` checks for **assignability to a target type** ("is there a `*NotFoundError` anywhere in this chain? Bind it to my variable.").

```go
var nf *NotFoundError
if errors.As(err, &nf) { log.Printf("missing id=%s", nf.ID) }
```

`errors.As` is essential when the error has data you want to read; `errors.Is` is for "did this specific thing happen".

#### Q: When should you use `panic`/`recover` in Go?

`panic` for programmer errors (impossible states, broken invariants at startup). `recover` only at well-defined boundaries — a top-level HTTP handler that converts a panic into a 500, or the top of a long-lived goroutine. Avoid panic/recover as a try/catch substitute; Go reviewers will flag a function that panics on an expected error. The contested exception is parser-style code that uses panic for non-local exits within a package, recovering at the public boundary.

#### Q: How do you combine multiple errors in Go?

Go 1.20+ provides `errors.Join` to combine multiple non-nil errors into one:

```go
var errs []error
for _, s := range services {
    if err := s.Check(); err != nil {
        errs = append(errs, err)
    }
}
return errors.Join(errs...)
```

The joined error implements `Unwrap() []error`, so `errors.Is` and `errors.As` walk all branches. Before 1.20, the multierr package (uber-go/multierr) or hashicorp/go-multierror filled this role.

#### Q: Why is `if err != nil { return err }` not always good enough?

It returns the error **without context** — the caller sees `connection refused` with no clue which call failed. Wrap: `fmt.Errorf("loading user %d for order %d: %w", uid, oid, err)`. The wrap adds "where" and "what was I doing"; `%w` preserves the original for `errors.Is`. Bare `return err` is fine only when context adds nothing (trivial pass-through, top of a goroutine).

### Python

#### Q: How does exception chaining work in Python?

Python automatically chains exceptions raised inside an `except` block — the new exception's `__context__` is set to the active one. Explicit chaining uses `raise NewError from original` (sets `__cause__`). `raise NewError from None` suppresses chaining. Tracebacks distinguish: implicit context prints "During handling of the above exception"; explicit cause prints "The above exception was the direct cause".

#### Q: What's `ExceptionGroup` and when do you use it?

`ExceptionGroup` (Python 3.11) lets you raise multiple exceptions at once — the answer to "ten parallel tasks all failed". The `except*` syntax catches *some* of the inner exceptions and re-raises the rest:

```python
try: do_many_things()
except* ValueError as eg: handle_validation(eg.exceptions)
except* IOError as eg:    handle_io(eg.exceptions)
```

Driven by `asyncio.TaskGroup`, which reports all child failures this way.

#### Q: What's the difference between `BaseException` and `Exception`?

`BaseException` is the root and includes `SystemExit`, `KeyboardInterrupt`, `GeneratorExit` — things you almost never want to catch. `Exception` is the "normal" root user code should derive from. Trap: bare `except:` catches `BaseException` and swallows `KeyboardInterrupt` — Ctrl+C stops working. Always prefer `except Exception:` for catch-all.

#### Q: How do context managers help with error handling?

`with` blocks guarantee cleanup via `__exit__`, Python's equivalent of try-with-resources. `__exit__` can also suppress an exception by returning truthy (rarely the right move). `contextlib.suppress(FileNotFoundError)` is a clean alternative to `try/except: pass` for the deliberate-ignore case.

#### Q: What does bare `raise` do? When is `finally` not run?

Bare `raise` re-raises the **currently active exception**, preserving its traceback — the idiomatic re-raise. `finally` is *not* run on `kill -9`, `os._exit`, segfault, power loss, or when a `daemon=True` thread is killed at interpreter shutdown. It *does* run on `return`, `break`, `continue`, normal exceptions, and `sys.exit` (which raises `SystemExit`).

### Java

#### Q: Is `RuntimeException` always unchecked? Is `Exception` always checked?

`RuntimeException` and its subclasses are **unchecked**. `Error` and its subclasses are also unchecked. Everything else under `Throwable` — including direct subclasses of `Exception` that aren't `RuntimeException` — is **checked**. So `IOException extends Exception` is checked; `IllegalArgumentException extends RuntimeException` is unchecked.

Trap: candidates assume "all exceptions are checked except Runtime ones," forgetting `Error`. `OutOfMemoryError` is unchecked — and you should not catch it.

#### Q: What's `Try<T>` from Vavr and why use it?

`Try<T>` is a functional wrapper from the Vavr library: it's either `Success(value)` or `Failure(throwable)`. It lets you treat exceptions as values, chain operations with `map`/`flatMap`, and avoid `try/catch` clutter:

```java
Try.of(() -> riskyOp())
    .map(this::transform)
    .recover(IOException.class, ex -> fallback)
    .getOrElse(defaultValue);
```

It's useful in functional pipelines (especially with streams) where checked exceptions don't fit cleanly. The trade-off: another dependency, and the codebase fragments between "people who use Try" and "people who don't". Adopt cautiously.

#### Q: When should you catch `Error`?

Essentially never. `Error` is for JVM-level catastrophes: `OutOfMemoryError`, `StackOverflowError`, `LinkageError`. Catching `OutOfMemoryError` and trying to continue is almost always wrong — the JVM is already in a degraded state, and your "recovery" code probably allocates memory.

Two exceptions: (1) top-level frameworks (a thread-pool runnable that wants to log the fatal error before the JVM dies); (2) `AssertionError` in tests, where it's expected. In application code: don't.

#### Q: What's the difference between `throw` and `throws`?

`throw` is the statement (`throw new IOException(...)`) — it actually raises the exception. `throws` is the *declaration* (`void load() throws IOException`) — it tells callers and the compiler that this method may throw certain checked exceptions.

#### Q: How does `try-with-resources` handle multiple resources?

Resources are closed in **reverse order of declaration**. If both the body and a `close()` throw, the body's exception is primary and the close-exception is attached via `addSuppressed`. If two resources both fail to close, the second's close-exception is suppressed onto the first's.

```java
try (Reader r = open(a); Reader s = open(b)) {
    ...
} // s.close() runs first, then r.close(); exceptions chain via addSuppressed
```

### Rust

#### Q: Explain `Result<T, E>` and the `?` operator.

`Result<T, E>` is an enum with `Ok(T)` and `Err(E)`. Every fallible operation returns a `Result` and the caller *must* handle both arms. `?` is sugar for "if `Err`, return early after converting via `From`":

```rust
fn load_user(id: u64) -> Result<User, MyError> {
    let row = db_query(id)?;
    Ok(parse(row)?)
}
```

#### Q: What's the difference between `thiserror` and `anyhow`?

`thiserror` is for **library code** that defines its own error types — a derive macro generating `Display`, `From`, and `Error` impls for your enum. `anyhow` is for **application code** that just wants to bubble errors up — `anyhow::Error` is a type-erased wrapper holding any error. Rule of thumb: libraries use `thiserror`, binaries use `anyhow`, don't mix them in one crate.

#### Q: What does the `From` trait do in Rust error handling?

`?` converts errors via `From::from` before returning. If your function returns `Result<T, MyError>` and you call something returning `Result<T, io::Error>`, you need `impl From<io::Error> for MyError` for `?` to compile. `thiserror` generates these `From` impls when you annotate a variant with `#[from]`.

#### Q: When do you `panic!` vs return `Err`?

`panic!` for **bugs** — broken invariants, out-of-bounds, impossible states. Return `Err` for **expected errors** — file not found, network failure, parse failure. `unwrap()` and `expect()` are panics in disguise: use only in tests, examples, or where failure is genuinely a bug. Prefer `expect` over `unwrap` — even "this should be unreachable because X" beats no message.

#### Q: How do you propagate errors across async boundaries in Rust?

Async functions return `impl Future<Output = Result<T, E>>`. `?` works inside `async fn` the same as sync. The wrinkle: runtimes like Tokio expose `JoinError` when a spawned task panics, distinct from the task's own `Err`. Code that spawns tasks must handle both layers.

---

## Tricky / Trap Questions

These are the questions that catch fast-talkers. Wrong answer is almost always more confident than the right one.

### Q: What's wrong with `if err != nil { return err }` repeated everywhere?

**Wrong answer:** "Nothing — it's idiomatic Go."

**Right answer:** It *loses context*. The error returned to `main` looks like `connection refused` with no idea whether it came from the auth service, the DB, or a metrics call. Wrap with context: `fmt.Errorf("auth check: %w", err)`. The bare-return pattern is fine for trivial pass-throughs, but as a default it produces error messages that are useless in production.

### Q: What happens to the original exception when you do `throw new MyException(e.getMessage())` in Java?

**Wrong answer:** "It's preserved in the message."

**Right answer:** The **stack trace is lost** and the cause chain is broken. `e.getMessage()` is just a string. `MyException` has no idea `e` ever existed. Use `throw new MyException("context", e)` (chained constructor) so the cause is preserved. Otherwise debugging this in prod becomes guesswork.

### Q: In Go, what does `errors.Is(nil, nil)` return?

**Wrong answer:** "false" or "panic".

**Right answer:** `true`. The signature is `errors.Is(err, target error) bool`. If both are nil, they're equal. This sometimes surprises people because it means `if errors.Is(err, target)` doesn't imply `err != nil`. Common bug: code that checks `errors.Is(err, sql.ErrNoRows)` thinking it's also asserting non-nil.

### Q: If a Go function with signature `(T, error)` returns `nil, nil`, what does the caller see?

A nil `T` and a nil error. The caller's nil-check passes ("no error!") but they then dereference the nil `T` and crash. This is one of the most common Go bugs. Functions returning `(T, error)` should treat `(nil, nil)` as an illegal state — either return `(value, nil)` on success or `(nil, err)` on failure.

For typed nil interfaces it's even worse: returning `(*ConcreteError)(nil)` as an `error` makes the error non-nil from the outside but nil when dereferenced. The classic interview gotcha:

```go
func f() error {
    var e *MyError = nil
    return e          // returns a non-nil error interface!
}
```

### Q: What's the difference between `except:` and `except BaseException:` in Python?

**Wrong answer:** "They're the same."

**Right answer:** Bare `except:` catches `BaseException`, which includes `KeyboardInterrupt`, `SystemExit`, and `GeneratorExit`. So does explicit `except BaseException:`. **Neither is what you usually want.** Catching `KeyboardInterrupt` means Ctrl+C stops working. Catching `SystemExit` means `sys.exit()` calls inside the block are swallowed. Use `except Exception:` for a true catch-all of "ordinary" errors.

### Q: When does `finally` NOT run?

- `kill -9` (SIGKILL) — the OS kills the process; no userspace code runs.
- Hard process termination (`os._exit` in Python, `Runtime.halt` in Java, segfaults, power loss).
- Some fatal signals depending on language (SIGABRT, SIGSEGV).
- In Python, daemon threads can have their cleanup skipped when the main thread exits.
- In JavaScript, an infinite loop in the `try` block — `finally` is never reached because the block never completes.

Note: regular `return` or `break` *does* run `finally`. Even `throw` does. The interview point is that `finally` is "language-best-effort cleanup", not "OS-guaranteed".

### Q: Does `return` inside a `finally` block silently override the `try`'s return or exception?

**Yes — and it's almost always a bug.**

```java
int f() {
    try { throw new RuntimeException("boom"); }
    finally { return 42; }  // swallows the exception, returns 42
}
```

The `RuntimeException` is silently swallowed. Same in JavaScript and Python. Linters flag this. Never do it deliberately.

### Q: In Rust, does `?` work on `Option`?

**Yes (since Rust 1.22).** `?` on an `Option<T>` returns early with `None` if it's `None`. So a function returning `Option<T>` can chain `Option`-producing calls with `?`. But you cannot mix `Result` and `Option` with `?` directly — they're different traits (`Try` for each). You'd need `.ok_or(err)?` to convert `Option` to `Result` or `.ok()?` to convert the other way.

### Q: In Java, what happens if both the `try` block and a `finally` block throw?

The `finally` exception **replaces** the original. The `try` exception is lost.

```java
try { throw new IOException("A"); }
finally { throw new IOException("B"); }
// caller sees only B; A is gone
```

This is why `try-with-resources` uses `addSuppressed` — to make sure both are reported. Manual try/finally has this bug by default.

### Q: What's wrong with this Python pattern: `except Exception as e: logger.error(e); raise`

**Wrong answer:** "Nothing."

**Right answer:** Two problems. (1) `logger.error(e)` logs *only the message*; the traceback is gone. Use `logger.exception(e)` (or `logger.error(e, exc_info=True)`) to include it. (2) Re-raising after logging at every layer of the stack means the same error gets logged five times, polluting logs and making the actual root cause hard to find. Log at the boundary, not at every layer.

### Q: Does Go's `defer` run on panic?

**Yes.** Deferred functions run during stack unwinding, including on panic. That's how `recover` works — it's called inside a deferred function and catches the in-flight panic. They do NOT run on `os.Exit`, SIGKILL, or `runtime.Goexit` is its own thing (it *does* run defers but does not unwind further).

### Q: Can you re-throw an exception in Python and lose the traceback?

Yes, if you do it wrong. `raise e` (with argument) replaces the traceback's top frame. Bare `raise` preserves the original traceback. Worse: storing an exception across coroutines and re-raising it later can produce a traceback rooted at the *re-raise site*, hiding the original call chain. This is a common asyncio debugging trap.

### Q: In Rust, what's the difference between `unwrap` and `expect`?

`unwrap()` panics with a generic message ("called `unwrap` on an `Err` value"). `expect(msg)` panics with your custom message. Always prefer `expect` in code that survives review — even if the message is "this should be unreachable because X", future-you will thank present-you.

### Q: In Java, why is throwing `Throwable` legal but caught-but-not-handled `Throwable` dangerous?

`Throwable` includes `Error`, which includes `OutOfMemoryError`, `LinkageError`, and the rest of the JVM's worst news. Catching `Throwable` swallows those, leaving your program limping in an undefined state. Throwing `Throwable` is technically legal (any subclass works), but in practice means downstream catchers have to handle the impossible. Always extend `Exception` or `RuntimeException` for your own errors.

### Q: What does this Go code print?

```go
defer fmt.Println("a")
defer fmt.Println("b")
panic("boom")
```

`b\na\n` then panic message. Defers run in LIFO order, and they run during panic unwinding. Beginners think "panic skips defers" — wrong, that's `os.Exit`.

---

## System / Design Scenarios

The open-ended questions. There's no single right answer; the interviewer is watching how you think.

### Q: Design the error type for a payments SDK.

A payments SDK is a high-stakes integration target. The error model must support **categorization** (`Validation`, `Network`, `RateLimit`, `Idempotency`, `BusinessRule`, `Auth`, `Internal`), **retryability** (a `Retryable() bool` method — network/5xx yes, validation/business no), **idempotency key** surfacing, **user-facing vs operator-facing messages** (one says "Your card was declined", the other says `card_declined: insufficient_funds; charge_id=ch_...`), **stable string error codes** (`payment.card_declined`, never integer enums that churn), a **causal chain** preserving the upstream response, and **request ID + timestamp** for correlation.

```go
type PaymentError struct {
    Code, UserMessage, OpMessage, RequestID, IdempotencyKey string
    Category   Category
    Retryable  bool
    At         time.Time
    Cause      error
}
```

Ship a docs page that lists every code with retry semantics. The error type's identity *is* the API contract.

### Q: Your team's HTTP API returns 500 for everything. Walk me through your refactor plan.

1. **Audit**: sample a day of logs, categorize sources (validation, auth, not-found, business-rule, upstream, real bugs). You'll find 5-7 buckets covering 95%.
2. **Taxonomy**: map each bucket to a status (400/401/403/404/409/422/502/503) and a stable code (`user.not_found`).
3. **Introduce `AppError`** with code/message/status/cause. All handlers return it.
4. **Boundary translation** at the edge: convert to `{code, message, request_id}`. Internal errors wrapped under `internal_error`, never leaked.
5. **Migrate handler-by-handler** with tests, not big-bang.
6. **Logging discipline**: log internal cause at the boundary with request ID, not in the response.
7. **Documentation**: ship the error code table; communicate any breaking changes.

Emphasize: **don't try to fix all of it in one PR.** Incremental, tested, reversible.

### Q: You inherit a Python codebase with bare `except: pass` blocks. How do you fix it without breaking prod?

First, **don't delete them blind.** Some are load-bearing — the system works *because* something is being swallowed. Plan:

1. Grep for every `except: pass` and catalog them.
2. Replace each with `except Exception: logger.exception("swallowed in <function>")` and deploy. You can now *see* what was being swallowed.
3. Watch logs for a week. Three categories emerge: (a) never fires — safe to remove; (b) fires but ignorable — narrow the except with a comment; (c) fires and matters — fix the underlying bug.
4. Add a lint rule (Ruff `BLE001`) to prevent regressions.

Key insight: silent failures are *data*. You need that data before you can responsibly remove them.

### Q: Design an error category system for a microservice with 20 endpoints. HTTP status codes alone, or custom codes?

**Use both.** HTTP status codes are for the *protocol layer* (proxies, retries, CDNs need to dispatch). Custom codes are for the *application layer* (clients need to render different UX for "email taken" vs "name missing", both 400). Status alone is too coarse; custom alone breaks tooling.

Design: a small HTTP status set (400/401/403/404/409/422/429/500/502/503/504), domain-namespaced codes (`users.email_taken`, `orders.payment_required`), response body `{code, message, details, request_id}`, and a published matrix of status × code × retryable × user-actionable.

Anti-pattern to call out: 200 with `{"error": "..."}` in the body — breaks every standard tool's ability to detect failure.

### Q: Your retry logic is causing duplicated payments. What went wrong and how do you fix it?

What went wrong: retry was triggered on a non-idempotent POST. The original succeeded but the response was lost (timeout); the client retried; the server processed it twice. No idempotency key meant the server couldn't recognize the duplicate.

Fix:
- **Idempotency keys**: client generates a UUID per logical operation; server stores `{key → result}` for a retention window (24h is common); retries with the same key return the cached result.
- **Retry only on safe failures**: connection errors, 5xx, 408, 429 with backoff. Never retry 4xx — they're deterministic.
- **State machine** that refuses to re-process completed transactions.
- **Test it**: simulate network drops in staging and assert the second attempt returns the cached result.

End with: idempotency is a *server-side* guarantee. Clients ask for it; servers enforce it.

### Q: How would you migrate a Java codebase from checked exceptions to Result-style errors?

Realistic answer: you probably don't, fully. You introduce `Result<T, E>` at *boundaries* (public service methods, stream pipelines, `CompletableFuture` chains) and let internals continue throwing. Use Vavr's `Try`/`Either` or a hand-rolled sealed interface (Java 17+). Wrap throwing methods at the edges; new code uses `Result`, old code unchanged. Migrate inward over time — no big bang. Accept the seam: the codebase will be mixed for years. That's fine if it's documented.

This is a *style* preference, not a correctness fix. Don't treat the migration as urgent.

### Q: Design a circuit breaker. How does it interact with your error model?

States: `Closed` (normal), `Open` (fail fast without calling), `Half-Open` (probe to see if recovered). Error model interaction: when open, return a typed `CircuitBreakerOpenError` so callers distinguish "dependency failed" from "we didn't even try". Only specific failures trip it (timeouts, 5xx, connection refused) — **not** 4xx, those are deterministic and would deny service on every bad client request. The breaker error is not retryable from the caller's view (it would just keep hitting the open breaker). At the boundary it rolls up as 503.

The interview point: error model and resilience patterns are co-designed. A breaker built without knowing your error categories will misclassify failures.

### Q: How do you handle errors crossing language boundaries (e.g. gRPC service in Go called from Python)?

You can't ship a `*pq.Error` across a wire. Define a **protocol-level error model**: gRPC has `Status` codes (`NOT_FOUND`, `INVALID_ARGUMENT`, etc.) plus `details` for typed payloads. REST has HTTP status + JSON body.

Both sides need to agree on the taxonomy. On the server: translate internal errors to wire errors at the boundary (gRPC interceptor, HTTP middleware). On the client: deserialize wire errors back into typed exceptions or `Result`s in the local language.

Critical points:
- Don't leak internal stack traces into wire responses (security and noise).
- Include a `request_id` so the client and server can correlate.
- Document the wire error contract as carefully as the success contract.

---

## Coding Questions

Small problems with full runnable solutions. Interviewers use these to check that you can actually *write* code, not just talk about it.

### Q: Write a Go function that calls 3 services and combines all errors into one with `errors.Join`.

```go
package main

import (
    "errors"
    "fmt"
)

type Service struct {
    name string
    err  error
}

func (s Service) Check() error {
    if s.err != nil {
        return fmt.Errorf("%s: %w", s.name, s.err)
    }
    return nil
}

func CheckAll(services ...Service) error {
    var errs []error
    for _, s := range services {
        if err := s.Check(); err != nil {
            errs = append(errs, err)
        }
    }
    return errors.Join(errs...) // returns nil if errs is empty
}

func main() {
    err := CheckAll(
        Service{"auth", errors.New("connection refused")},
        Service{"db", nil},
        Service{"cache", errors.New("timeout")},
    )
    if err != nil {
        fmt.Println("checks failed:")
        fmt.Println(err)
    }
}
```

### Q: Write a Python decorator that retries on transient HTTP errors (5xx) with exponential backoff but not on 4xx.

```python
import time
import random
import functools
import requests

def retry_on_5xx(max_attempts=4, base_delay=0.5):
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            for attempt in range(max_attempts):
                try:
                    return fn(*args, **kwargs)
                except requests.HTTPError as e:
                    status = e.response.status_code
                    if 400 <= status < 500:
                        raise  # client error; don't retry
                    if attempt == max_attempts - 1:
                        raise  # out of attempts
                    delay = base_delay * (2 ** attempt) + random.uniform(0, 0.1)
                    time.sleep(delay)
                except (requests.ConnectionError, requests.Timeout):
                    if attempt == max_attempts - 1:
                        raise
                    delay = base_delay * (2 ** attempt) + random.uniform(0, 0.1)
                    time.sleep(delay)
            return None  # unreachable
        return wrapper
    return decorator

@retry_on_5xx()
def fetch(url):
    r = requests.get(url, timeout=5)
    r.raise_for_status()
    return r.json()
```

Note the deliberate decisions: 4xx raises immediately, jitter prevents thundering herd, the final attempt's failure propagates instead of returning None.

### Q: Write a Java method that uses try-with-resources to open two files; ensure both are closed and both close-errors are reported.

```java
import java.io.*;

public class TwoFiles {
    public static String concat(String pathA, String pathB) throws IOException {
        try (BufferedReader a = new BufferedReader(new FileReader(pathA));
             BufferedReader b = new BufferedReader(new FileReader(pathB))) {
            StringBuilder out = new StringBuilder();
            String line;
            while ((line = a.readLine()) != null) out.append(line).append("\n");
            while ((line = b.readLine()) != null) out.append(line).append("\n");
            return out.toString();
        }
    }

    public static void main(String[] args) {
        try {
            System.out.println(concat("a.txt", "b.txt"));
        } catch (IOException e) {
            System.err.println("primary: " + e.getMessage());
            for (Throwable s : e.getSuppressed()) {
                System.err.println("suppressed: " + s.getMessage());
            }
        }
    }
}
```

The interview point: `try-with-resources` handles close-order (reverse) and suppression automatically. A handwritten try/finally would need explicit `addSuppressed` calls.

### Q: Write a Rust function that uses `?` to chain calls returning different error types, using `From` for conversion.

```rust
use std::fs;
use std::io;
use std::num::ParseIntError;

#[derive(Debug)]
enum AppError {
    Io(io::Error),
    Parse(ParseIntError),
}

impl From<io::Error> for AppError {
    fn from(e: io::Error) -> Self { AppError::Io(e) }
}

impl From<ParseIntError> for AppError {
    fn from(e: ParseIntError) -> Self { AppError::Parse(e) }
}

fn read_number(path: &str) -> Result<i64, AppError> {
    let contents = fs::read_to_string(path)?;      // io::Error -> AppError
    let n: i64 = contents.trim().parse()?;         // ParseIntError -> AppError
    Ok(n)
}

fn main() {
    match read_number("number.txt") {
        Ok(n) => println!("read: {}", n),
        Err(e) => eprintln!("error: {:?}", e),
    }
}
```

In real code you'd use `thiserror` to derive these `From` impls.

### Q: Write a function that aggregates form validation errors into a single response.

Python version:

```python
from dataclasses import dataclass, field
from typing import List

@dataclass
class ValidationError(Exception):
    field: str
    code: str
    message: str

@dataclass
class ValidationErrors(Exception):
    errors: List[ValidationError] = field(default_factory=list)

    def add(self, field, code, message):
        self.errors.append(ValidationError(field, code, message))

    def raise_if_any(self):
        if self.errors:
            raise self

def validate_user(payload):
    errs = ValidationErrors()
    if not payload.get("name"):
        errs.add("name", "required", "name is required")
    if "@" not in payload.get("email", ""):
        errs.add("email", "invalid", "email must contain @")
    if payload.get("age", 0) < 0:
        errs.add("age", "negative", "age cannot be negative")
    errs.raise_if_any()
    return payload

if __name__ == "__main__":
    try:
        validate_user({"name": "", "email": "bad", "age": -1})
    except ValidationErrors as ve:
        for e in ve.errors:
            print(f"{e.field}: [{e.code}] {e.message}")
```

The key design point: collect **all** errors, not just the first one. Users hate fixing a form one field at a time.

### Q: Write a Python `try/except/else/finally` example explaining each clause.

```python
def load_config(path):
    f = None
    try:
        f = open(path)
        data = f.read()
    except FileNotFoundError:
        # Specific failure we know how to handle.
        return {}
    except OSError as e:
        # Other I/O problems — re-raise with context, don't swallow.
        raise RuntimeError(f"could not read config {path}") from e
    else:
        # Runs only if try succeeded with no exception.
        return parse(data)
    finally:
        # Always runs, success or failure.
        if f:
            f.close()

def parse(data):
    return {"parsed": data}
```

`else` is the underrated clause: it runs only if the `try` finished cleanly, *before* the `finally`. Use it to keep the `try` block minimal — only the line that can throw goes inside `try`.

---

## Behavioral / Experience Questions

These are for senior and staff candidates. Vague answers fail; concrete stories pass.

### Q: Tell me about a production incident caused by a swallowed error.

A good answer has structure: **what failed, why the error was swallowed, how it was discovered, what the fix was, what changed afterward**.

Example shape: "Our payment service had `except: pass` around a webhook delivery call. For three weeks, webhook delivery to a major customer was silently failing — every retry threw the same exception that was swallowed. We discovered it when the customer escalated. The fix was three lines, but the real fix was a post-mortem rule: bare `except` is a blocker in PR review, and we shipped a Sentry integration so unhandled exceptions paged us."

Interviewers want the *what changed* part — that's where you show you don't just fix bugs, you fix the system that produced them.

### Q: How do you decide which errors should page someone vs which should just log?

The framework: an error pages if (a) it indicates a problem only a human can fix, AND (b) the problem is degrading user experience right now, AND (c) waiting for business hours would make it worse.

So:
- Database down → page (humans needed, users affected now, downtime grows).
- Spike in 4xx from one client → log (humans needed eventually, but it's the client's bug, not yours).
- Transient retry succeeded → log, maybe metric (no human action needed).
- Disk approaching 80% → ticket, not page (human needed but not at 3am).
- 5xx rate above 1% sustained for 5 minutes → page.

The trap: paging on every error produces alert fatigue and the real incident gets missed.

### Q: Describe an error-handling refactor you led. What was the before/after?

Have a concrete one ready. A common shape: "Inherited a Spring service with 30 endpoints, all throwing `Exception` and getting caught by a global handler that returned 500 with stack trace in the body. Refactored to: typed domain errors, a `@ControllerAdvice` mapping each to status+code, body with `{code, message, request_id}`. Took three sprints across five engineers. Result: error-related support tickets dropped 60% because clients could actually distinguish 'user error' from 'our problem'."

### Q: How do you document errors for API consumers?

Three layers:
1. **API reference**: every endpoint lists possible error codes and their meaning.
2. **Error code catalog**: a single page listing all codes across the API, with retry semantics, suggested user message, and link to "how to fix".
3. **Changelog**: when you add or deprecate a code, it goes in the changelog so client teams can plan.

The interview signal: candidates who treat errors as documented-API-surface. Most teams don't, and find out at integration time.

### Q: How do you train your team to handle errors well?

- **PR review checklist**: no bare `except`, no `if err != nil { return err }` without context, no leaking internal errors to users.
- **Linters**: tools enforce what you can't catch in review (Ruff, golangci-lint, SonarQube).
- **Incident post-mortems**: every incident caused by error mis-handling becomes a teaching moment. Share the diff that fixed it.
- **Pair on the hard ones**: error model design (especially at boundaries) is non-obvious and worth two heads.
- **Internal error catalog**: a doc that lists "here are the error patterns we use, here is when to use each."

### Q: How do you balance error-handling rigor against shipping velocity?

You don't actually trade them off long-term. Rigor *enables* velocity: when errors are properly handled, debugging is fast, on-call is rare, and refactors don't break things. The short-term tradeoff is: bad error handling is invisible in a green build but expensive in production.

Practical heuristic: at the API boundary, take the time to design the error model. Inside, lean on language defaults and `return err`-style code. The 80/20 of error rigor is at the boundaries.

### Q: Tell me about an error you discovered only because of an unrelated bug report.

This question probes whether you've ever found a silent failure by accident. Strong answers describe pre-existing data corruption that the user noticed before the system did — and what monitoring you added afterward so it would never be a "user found it first" again.

### Q: What's the biggest disagreement you've had with a teammate about error handling?

Common ones: "should we use checked exceptions" (Java teams), "should `nil` be a valid value" (Go/Kotlin teams), "should we return errors or panic" (Go teams), "should validation errors be separate exceptions" (Python teams). The interview signal isn't who won; it's whether the candidate can articulate both sides and the eventual decision rationale.

---

## "What I'd Ask a Candidate Now"

Meta-questions distilled from production wisdom. These are questions whose answers tell you whether someone has handled real incidents.

### Q: Show me a `catch` block from your last project and tell me why it's there.

Most candidates can talk about error handling in the abstract. Far fewer can defend an actual `catch` block they wrote. This question lands fast and reveals whether they understand the *purpose* of any specific handler — or whether they just paste them in by reflex.

### Q: What's the smallest change you'd make to a codebase to dramatically improve its error handling?

Forces them to pick. Good answers: "add request IDs to every log line" or "add a single boundary error type at the HTTP layer". Weak answers: "rewrite it in Rust".

### Q: When have you deliberately swallowed an error, and why was it OK?

Yes, sometimes it IS OK — closing a connection in a `finally` where the close-error is meaningless, ignoring `os.remove` failing because the file might not exist. The question tests whether they can defend the rare cases without becoming dogmatic.

### Q: Walk me through what happens in your service when its upstream dependency starts returning 503s.

Probes their mental model of cascading failure: do they have retries? Backoff? Breaker? What error does the user see? Do their dashboards light up? Their on-call gets paged or not? This is a system-level error question masquerading as a behavioral one.

### Q: How does your error model handle a database failure during a multi-step business transaction?

Probes transactionality and partial-failure thinking. Good candidates immediately bring up sagas, compensating actions, idempotency. Weak ones say "we use transactions" without considering what happens when the transaction itself fails mid-commit.

### Q: If I gave you 30 minutes to audit a microservice's error handling, what's your checklist?

The candidate is showing you their priorities. A strong list: grep for `except: pass` or `if err != nil { return nil }`; check the HTTP error response shape; check log volume vs incident correlation; check the dependency graph for missing timeouts; check whether the service distinguishes retryable from non-retryable.

### Q: When have you regretted an error-handling decision a year later?

Tests whether they reflect on past choices. Good answers describe a specific decision they'd make differently — e.g. "we used sentinel errors everywhere and now we wish we'd used typed errors so we could attach context." Boring answers ("none") fail.

---

## Cheat Sheet

```
┌──────────────────────────────────────────────────────────────────────┐
│  THE 10 ERROR-HANDLING QUESTIONS MOST LIKELY TO COME UP              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. What's the difference between an error and a bug?                │
│     → errors are expected; bugs are defects. Handle errors, let      │
│       bugs crash.                                                    │
│                                                                      │
│  2. Why is `catch (Exception)` (or bare `except`) bad?               │
│     → catches things you can't handle (NPE, OOM, KeyboardInterrupt). │
│       Hides bugs. Use narrow catches.                                │
│                                                                      │
│  3. Difference between checked and unchecked exceptions in Java?     │
│     → checked must be declared/caught; unchecked propagate freely.   │
│       Modern consensus: checked failed because they don't compose.   │
│                                                                      │
│  4. In Go, what does `errors.Is` do that `==` doesn't?               │
│     → walks the wrap chain. Lets you check sentinels through %w.     │
│                                                                      │
│  5. When is `finally` NOT run?                                       │
│     → kill -9, os._exit, segfault, hard process termination, some    │
│       daemon thread shutdowns.                                       │
│                                                                      │
│  6. What's wrong with `if err != nil { return err }` everywhere?     │
│     → loses context. Wrap with `fmt.Errorf("doing X: %w", err)`.     │
│                                                                      │
│  7. What happens to the original when `throw new MyEx(e.message)`?   │
│     → stack trace lost, cause chain broken. Pass `e` as cause.       │
│                                                                      │
│  8. Why is silent failure dangerous?                                 │
│     → system limps on corrupted state, trail goes cold, debugging    │
│       becomes archaeology.                                           │
│                                                                      │
│  9. When IS `panic` correct in Go?                                   │
│     → truly impossible states, init failures, library API violations │
│       no error return can express.                                   │
│                                                                      │
│ 10. Design an error type for a public SDK — what fields?             │
│     → code, category, retryable, user-message, op-message,           │
│       request-id, idempotency-key, cause.                            │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Further Reading

- **"Errors are values"** — Rob Pike, on the Go blog. The canonical defense of return-value errors.
- **"Working with Errors in Go 1.13"** — Go blog. Introduces `%w`, `errors.Is`, `errors.As`.
- **"Error Handling in Rust"** — *The Rust Book*, ch. 9. The definitive intro to `Result` and `?`.
- **"The Trouble with Checked Exceptions"** — Anders Hejlsberg interview, Artima Developer (2003). Calls checked exceptions a "wart" in Java.
- **"Effective Java"** by Joshua Bloch — Items 69-77 on exceptions are required reading for Java developers.
- **"Python Exceptions Considered an Anti-Pattern"** — collection of critiques and counterpoints; search "Brett Cannon exception chaining" for nuance.
- **"Designing Better Error Messages"** — Stripe engineering blog. Why Stripe's error responses are the gold standard.
- **PEP 654 — Exception Groups and `except*`**.
- **PEP 657 — Fine-grained error locations** (better traceback pointers in Python 3.11+).
- **"Release It!"** by Michael Nygard — chapters on stability patterns, including circuit breakers, bulkheads, and timeouts.

---

## Related Topics

- [Error Handling — Junior](junior.md)
- [Error Handling — Middle](middle.md)
- [Error Handling — Senior](senior.md)
- [Error Handling — Professional](professional.md)
- [Error Handling — Tasks](tasks.md)
- [Debugging — Interview Questions](../debugging/interview.md)
- [Logging — Interview Questions](../logging/interview.md)
