# Error Handling — Hands-On Tasks

> **Topic:** [Error Handling Roadmap](README.md)
> **Focus:** Practical exercises that take you from "I know what an error is" to "I designed our team's error handling policy" — by writing code, not reading about it.

---

## How to use this file

This file is a graded set of exercises. Each task has a **Problem**, a list of **Constraints**, a set of **Hints**, and a **Self-check** list. Do the task in your editor first — write the code, run it, prove to yourself it behaves the way you wanted — and *then* peek at the hints. The hints are not meant to spoil the exercise; they are meant to unstick you when you have been staring at the screen for fifteen minutes. If you read them before attempting, you steal the lesson from yourself.

Work top-to-bottom. The bands (Warm-Up, Core, Advanced, Capstone) are calibrated to the four roadmap levels: junior, middle, senior, and professional. If a Warm-Up task feels hard, do not skip ahead — go read [`junior.md`](junior.md) first. If a Core task is trivial, you are probably ready for [`senior.md`](senior.md). A handful of tasks include a **Sample Solution** block — only look at it after you have written your own. Comparing two working solutions teaches more than reading one.

---

## Table of Contents

1. [Warm-Up (Junior)](#warm-up-junior)
   - [Task 1: parseAge with sensible errors](#task-1-parseage-with-sensible-errors)
   - [Task 2: Rewrite a bare except](#task-2-rewrite-a-bare-except)
   - [Task 3: Catch IOException only](#task-3-catch-ioexception-only)
   - [Task 4: try/finally to context manager](#task-4-tryfinally-to-context-manager)
   - [Task 5: Bug in the `if err != nil { return nil }` pattern](#task-5-bug-in-the-if-err--nil--return-nil--pattern)
   - [Task 6: Replace a null sentinel return](#task-6-replace-a-null-sentinel-return)
2. [Core (Middle)](#core-middle)
   - [Task 7: Wrap errors with `%w` and pass context up](#task-7-wrap-errors-with-w-and-pass-context-up)
   - [Task 8: `raise ... from e` across 4 layers](#task-8-raise--from-e-across-4-layers)
   - [Task 9: `addSuppressed` in try-with-resources](#task-9-addsuppressed-in-try-with-resources)
   - [Task 10: Sentinel errors to typed errors with `errors.As`](#task-10-sentinel-errors-to-typed-errors-with-errorsas)
   - [Task 11: `errors.Join` for 5-field validation](#task-11-errorsjoin-for-5-field-validation)
   - [Task 12: `ExceptionGroup` for parallel batch](#task-12-exceptiongroup-for-parallel-batch)
   - [Task 13: `thiserror::Error` with 4 variants in Rust](#task-13-thiserrorerror-with-4-variants-in-rust)
   - [Task 14: Retry decorator with exponential backoff](#task-14-retry-decorator-with-exponential-backoff)
3. [Advanced (Senior)](#advanced-senior)
   - [Task 15: HTTP middleware that translates domain errors](#task-15-http-middleware-that-translates-domain-errors)
   - [Task 16: gRPC service with correct `codes.*` mapping](#task-16-grpc-service-with-correct-codes-mapping)
   - [Task 17: Retry plus circuit breaker around an HTTP client](#task-17-retry-plus-circuit-breaker-around-an-http-client)
   - [Task 18: `Result<T, E>` in Java with Vavr](#task-18-resultt-e-in-java-with-vavr)
   - [Task 19: Error aggregation for a parallel job runner](#task-19-error-aggregation-for-a-parallel-job-runner)
   - [Task 20: Remove "log AND re-throw" duplication](#task-20-remove-log-and-re-throw-duplication)
4. [Capstone (Professional)](#capstone-professional)
   - [Task 21: Design an error type system for a payments SDK](#task-21-design-an-error-type-system-for-a-payments-sdk)
   - [Task 22: Refactor a 50-endpoint Spring service that returns 500 for everything](#task-22-refactor-a-50-endpoint-spring-service-that-returns-500-for-everything)
   - [Task 23: Migrate a Python codebase off bare except](#task-23-migrate-a-python-codebase-off-bare-except)
   - [Task 24: Build observability hooks for errors](#task-24-build-observability-hooks-for-errors)
   - [Task 25: Author a team error-handling policy document](#task-25-author-a-team-error-handling-policy-document)
5. [Related Topics](#related-topics)

---

## Warm-Up (Junior)

These are the tasks you should be able to finish in 15-30 minutes each. They check that you have absorbed the [`junior.md`](junior.md) material as muscle memory, not just as facts you can recite.

### Task 1: parseAge with sensible errors

**Problem.** Implement a function `parseAge(s string) (int, error)` in Go and `parse_age(s: str) -> int` in Python. It accepts a string and returns an integer age between 0 and 150 inclusive. Anything outside that range, or a non-integer input, is an error. The error message must say *what* the bad input was and *why* it failed — not just "invalid age".

**Constraints.**
- Go: return a wrapped error using `fmt.Errorf("parseAge: %q: %w", s, err)` for parse failures, and a sentinel `ErrAgeOutOfRange` for range failures.
- Python: raise `ValueError` with a message that includes both the input and the constraint that was violated.
- No `panic` / no `sys.exit`. Return / raise.
- Empty string is an error too.

**Hints (try without these first).**
- In Go, `strconv.Atoi` already returns a wrapped error you can pass to `%w`.
- In Python, you can re-raise with `raise ValueError(...) from e` to preserve the chain.
- "Sensible" means: a human reading the log can fix the bug without rerunning the program.

**Self-check.**
- [ ] Passing `"abc"` produces an error mentioning `"abc"`.
- [ ] Passing `"-5"` produces an error mentioning the range `[0, 150]`.
- [ ] Passing `""` produces an error, not a panic or zero value.
- [ ] In Go, `errors.Is(err, ErrAgeOutOfRange)` returns `true` for the range case.

**Sample Solution (Go).**

```go
package main

import (
	"errors"
	"fmt"
	"strconv"
)

var ErrAgeOutOfRange = errors.New("age out of range [0, 150]")

func parseAge(s string) (int, error) {
	if s == "" {
		return 0, fmt.Errorf("parseAge: empty input")
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, fmt.Errorf("parseAge: %q: %w", s, err)
	}
	if n < 0 || n > 150 {
		return 0, fmt.Errorf("parseAge: %d: %w", n, ErrAgeOutOfRange)
	}
	return n, nil
}

func main() {
	for _, s := range []string{"42", "abc", "-5", "", "999"} {
		age, err := parseAge(s)
		if err != nil {
			fmt.Println("error:", err)
			continue
		}
		fmt.Println("age:", age)
	}
}
```

### Task 2: Rewrite a bare except

**Problem.** You inherit the following Python snippet. Rewrite it so the failure is preserved and recoverable, but the program still continues processing the rest of the items.

```python
def load_all(paths):
    results = []
    for p in paths:
        try:
            results.append(open(p).read())
        except:
            pass
    return results
```

**Constraints.**
- Catch only the exceptions that `open` and `read` can raise — not `KeyboardInterrupt`, not `SystemExit`.
- Log each failed path with the exception type and message.
- Use the `logging` module, not `print`.
- Return both the successful results *and* the list of failures, so the caller can decide what to do.

**Hints (try without these first).**
- `OSError` is the base class for file errors.
- `logging.exception` logs the traceback automatically.
- A `(results, failures)` tuple is a perfectly fine return shape.

**Self-check.**
- [ ] Pressing Ctrl+C during the loop actually interrupts the program.
- [ ] A non-existent file in the list does not stop processing.
- [ ] The traceback for a failure ends up in the log.
- [ ] No use of `except:` or `except Exception:` anywhere.

### Task 3: Catch IOException only

**Problem.** This Java method swallows everything because `Exception` is too broad. Narrow it so only `IOException` is handled here, and everything else propagates.

```java
public String readFirstLine(Path p) {
    try {
        return Files.readAllLines(p).get(0);
    } catch (Exception e) {
        return null;
    }
}
```

**Constraints.**
- Only catch `IOException`. Anything else (e.g. `IndexOutOfBoundsException` from an empty file) must propagate.
- Returning `null` is forbidden. Use `Optional<String>` instead.
- The caller must be able to distinguish "file unreadable" from "file was empty".

**Hints (try without these first).**
- Two failure modes deserve two different signals: an exception for I/O failure, an `Optional.empty()` for empty file.
- `Files.readAllLines` declares `throws IOException`. Let the compiler help you.
- Consider a small `record` for the result if you want more nuance than `Optional`.

**Self-check.**
- [ ] Empty file returns `Optional.empty()`, not `null`.
- [ ] Permission-denied file produces a real `IOException`.
- [ ] A bug elsewhere (e.g. `NullPointerException`) is no longer hidden by this method.

### Task 4: try/finally to context manager

**Problem.** Convert this Python code to use a context manager so the cleanup is automatic and exception-safe.

```python
def write_report(path, data):
    f = open(path, "w")
    try:
        f.write(data)
    finally:
        f.close()
```

**Constraints.**
- Use a `with` statement for the existing file handle.
- Additionally, write a *custom* context manager class `Timer` that prints the elapsed time of the `with` block, even when an exception is raised inside it.
- Use `contextlib.contextmanager` for a second `Timer` implementation as a generator.

**Hints (try without these first).**
- `__enter__` returns the value bound by `as`; `__exit__` receives `(exc_type, exc_value, tb)` and returns a truthy value only if it wants to suppress.
- Suppress nothing in `Timer`. Just measure and re-raise (by returning `False` or `None`).
- The `contextmanager` generator version uses `try / yield / finally`.

**Self-check.**
- [ ] File is closed even when `write` raises.
- [ ] `Timer` prints elapsed time even when the block raises.
- [ ] `Timer` does *not* swallow the exception.
- [ ] Both class-based and generator-based `Timer` produce the same behavior.

### Task 5: Bug in the `if err != nil { return nil }` pattern

**Problem.** Find and fix the bug in this Go snippet. Explain in one sentence what the bug is.

```go
func loadConfig(path string) *Config {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil
    }
    cfg, err := parse(data)
    if err != nil {
        return nil
    }
    return cfg
}
```

**Constraints.**
- Change the signature so the caller cannot ignore the error.
- Do not use a global variable to "stash" the error.
- The caller should be able to tell *which* of the two failures occurred.

**Hints (try without these first).**
- The bug is not in any single line — it is in the signature.
- Returning `nil` on failure means the caller has to guess whether `nil` means "missing" or "broken".
- Wrap each error with context: `read config`, `parse config`.

**Self-check.**
- [ ] Signature is `(*Config, error)`.
- [ ] Each return wraps with `fmt.Errorf("loadConfig: ...: %w", err)`.
- [ ] Calling code uses `if err != nil { return ..., err }`, not a nil check on the pointer.

### Task 6: Replace a null sentinel return

**Problem.** This Java method returns `null` to signal "not found". That overload kills the type system. Replace it with a representation that forces the caller to handle the missing case.

```java
public User findUser(String id) {
    User u = repo.lookup(id);
    if (u == null) return null;
    if (u.isDeleted()) return null;
    return u;
}
```

**Constraints.**
- Use `Optional<User>` for "not found" or "deleted".
- Distinguish "deleted" from "never existed" via a `Result`-like sealed type — `Found(User) | Deleted | NotFound`.
- The caller must use exhaustive switch over the sealed type.

**Hints (try without these first).**
- `sealed interface Lookup permits Found, Deleted, NotFound` in modern Java.
- Pattern-matching switch (`switch (result) { case Found f -> ...; case Deleted d -> ...; }`) gives you exhaustiveness.
- `Optional` is fine for two-state problems, but here you have three states.

**Self-check.**
- [ ] No `null` appears in the return path.
- [ ] Caller code does not contain `if (result == null)`.
- [ ] Adding a fourth state (`Banned`) breaks the switch at compile time until handled.

---

## Core (Middle)

Each Core task takes 30-90 minutes. They map to the skills covered in [`middle.md`](middle.md) — error wrapping, chaining, aggregation, and retry. By the end of this section you should be able to design error types for a small module without thinking too hard about it.

### Task 7: Wrap errors with `%w` and pass context up

**Problem.** Build a Go function `LoadUser(ctx, id)` that calls `db.Query` → `scan` → `decode`, each in a separate function. At every layer, wrap the error so the final message reads like a stack trace in words: `load user 42: scan row: decode profile blob: json: unexpected end of input`.

**Constraints.**
- Use `fmt.Errorf("...: %w", err)` at every layer.
- Use `errors.Is(err, sql.ErrNoRows)` at the top of the call stack to map "not found" to a typed `ErrUserNotFound` error.
- Do not log the error inside `LoadUser`. The caller logs.

**Hints (try without these first).**
- Only the *outermost* `errors.Is`/`errors.As` call walks the whole chain. So you can wrap as many times as you like.
- Use the noun-of-this-layer, not the verb. "scan row" beats "scanning failed".
- A four-layer chain is fine; six layers is a smell.

**Self-check.**
- [ ] The printed error is one line, colon-separated, ordered outer-to-inner.
- [ ] `errors.Is(err, sql.ErrNoRows)` works at the top.
- [ ] `errors.As(err, &decodeErr)` recovers the inner JSON decoder error.

### Task 8: `raise ... from e` across 4 layers

**Problem.** Take a 4-layer Python call chain — `api_handler` → `service` → `repo` → `db_driver` — and rewrite it so the exception chain is preserved correctly. The HTTP layer catches and converts to a 4xx/5xx response; the others re-raise with context.

**Constraints.**
- Use `raise NewError("context") from e` — never `raise NewError("context")` alone.
- Define one custom exception per layer (`ApiError`, `ServiceError`, `RepoError`).
- The driver may raise the standard `sqlite3.OperationalError` or similar.
- The handler must log the full chain with `logging.exception`.

**Hints (try without these first).**
- `raise X from None` if you genuinely want to *break* the chain (you don't, here).
- `__cause__` walks the chain.
- One custom exception per layer is the maximum useful — more becomes noise.

**Self-check.**
- [ ] Printing the final exception shows "The above exception was the direct cause of the following exception:" three times.
- [ ] The handler returns a 503 for `RepoError` caused by `OperationalError`, and a 500 otherwise.
- [ ] No `except:` and no `except Exception:` anywhere.

### Task 9: `addSuppressed` in try-with-resources

**Problem.** Java's try-with-resources will *silently throw away* the close-failure if the body already threw. Show this in a small example, then fix it so the close-failure is attached as a suppressed exception on the body failure.

**Constraints.**
- Implement a custom `AutoCloseable` whose `close()` throws.
- Write a body that throws a *different* exception.
- Use `Throwable.addSuppressed` correctly; do not just catch-and-rethrow.

**Hints (try without these first).**
- Try-with-resources *already* calls `addSuppressed` for you if both happen. Your job is to verify it and to print the suppressed list.
- `Throwable.getSuppressed()` returns the array.
- If you write a manual `try/finally`, you have to call `addSuppressed` yourself.

**Self-check.**
- [ ] Manual `try/finally` version: the close-failure replaces the body failure (the bug).
- [ ] Manual version with `addSuppressed`: the body failure is the primary, close failure is suppressed.
- [ ] Try-with-resources version behaves the same as the fixed manual version — verify it.

### Task 10: Sentinel errors to typed errors with `errors.As`

**Problem.** Refactor a Go package that uses package-level sentinel errors (`ErrConflict`, `ErrTimeout`, `ErrInvalidInput`) and string-matched messages to use typed errors that carry extra fields, accessible via `errors.As`.

**Constraints.**
- Define `type ConflictError struct { Resource string; ID string }` and similar for the others.
- Each type implements `Error() string` and (where useful) `Is(target error) bool` so old `errors.Is(err, ErrConflict)` still works.
- A caller that needs the resource name uses `errors.As`.

**Hints (try without these first).**
- The `Is` method lets you keep sentinel-style API while moving to typed internals — it is a great migration tool.
- `errors.As` walks the chain; you do not need to unwrap manually.
- Keep the sentinel variable around but assign it `&ConflictError{}` so `errors.Is` still works for callers.

**Self-check.**
- [ ] Old callers using `errors.Is(err, ErrConflict)` still work without changes.
- [ ] New callers using `errors.As(err, &confErr)` recover the resource name.
- [ ] String matching of error messages is gone from the package's tests.

### Task 11: `errors.Join` for 5-field validation

**Problem.** Write a Go function `ValidateUser(u User) error` that checks five fields (email, age, country, password, username) and returns *all* failures joined into one error rather than the first one.

**Constraints.**
- Use `errors.Join` (Go 1.20+).
- The returned error must let the caller iterate the individual failures via `errors.Is` checks.
- Wrap each field error with a typed `FieldError{Field, Reason}`.
- A passing user returns `nil`.

**Hints (try without these first).**
- Collect into `var errs []error` first, then `errors.Join(errs...)` at the end.
- `errors.Join` returns `nil` if the slice is empty or all entries are nil — exactly what you want.
- An `Unwrap() []error` method on a custom type does the same thing manually if you need pre-1.20.

**Self-check.**
- [ ] All five failures appear in the joined error's `Error()` output, separated by newlines.
- [ ] `errors.Is(err, &FieldError{Field: "email"})` works for each field via an `Is` method.
- [ ] Passing a valid user returns nil, not an empty join.

### Task 12: `ExceptionGroup` for parallel batch

**Problem.** Build a Python function that runs N HTTP requests in parallel and reports *all* failures as one `ExceptionGroup`, not just the first.

**Constraints.**
- Use `asyncio.TaskGroup` (Python 3.11+) or `asyncio.gather(return_exceptions=True)` and construct the group manually.
- Filter the `ExceptionGroup` so a `KeyboardInterrupt` always propagates immediately, transient errors are reported as a group, and one fatal error type cancels the rest.
- Use `except*` syntax to split the group at the caller.

**Hints (try without these first).**
- `eg.split(predicate)` returns `(matched, rest)`.
- `TaskGroup` cancels siblings if one task raises, which is sometimes what you want and sometimes not.
- For a non-cancelling collector, `gather(..., return_exceptions=True)` is simpler.

**Self-check.**
- [ ] Three concurrent failures appear in one `ExceptionGroup`, not as the first one raised.
- [ ] `except* TransientError as eg:` catches only the transient subgroup.
- [ ] `KeyboardInterrupt` mid-batch ends the program; the group does not eat it.

**Sample Solution (Python).**

```python
import asyncio
import logging
import random

logger = logging.getLogger(__name__)


class TransientError(Exception):
    pass


class FatalError(Exception):
    pass


async def fetch(i: int) -> int:
    await asyncio.sleep(random.uniform(0.01, 0.05))
    r = random.random()
    if r < 0.2:
        raise TransientError(f"timeout on {i}")
    if r < 0.25:
        raise FatalError(f"corrupt response on {i}")
    return i


async def batch(n: int) -> list[int]:
    results: list[int] = []
    errors: list[Exception] = []
    coros = [fetch(i) for i in range(n)]
    for i, res in enumerate(await asyncio.gather(*coros, return_exceptions=True)):
        if isinstance(res, Exception):
            errors.append(res)
        else:
            results.append(res)
    if errors:
        raise ExceptionGroup("batch failed", errors)
    return results


async def main() -> None:
    try:
        out = await batch(20)
        print("ok:", out)
    except* TransientError as eg:
        logger.warning("transient failures: %d", len(eg.exceptions))
    except* FatalError as eg:
        logger.error("fatal failures: %s", [str(e) for e in eg.exceptions])
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
```

### Task 13: `thiserror::Error` with 4 variants in Rust

**Problem.** Define a Rust error enum `OrderError` with four variants — `NotFound { id: u64 }`, `Forbidden { user: String }`, `Validation(String)`, and `Storage(#[from] sqlx::Error)` — using the `thiserror` crate. Use it in a tiny order-service stub.

**Constraints.**
- Use `#[derive(Debug, thiserror::Error)]`.
- Each variant has a `#[error("...")]` format string with the relevant fields.
- The `Storage` variant uses `#[from]` so `?` converts `sqlx::Error` automatically.
- The handler function returns `Result<Order, OrderError>` and uses `?` everywhere.

**Hints (try without these first).**
- `#[from]` and `#[source]` are the two key attributes: `#[from]` also adds an `From` impl, `#[source]` only annotates the chain.
- `thiserror` is zero-runtime — it just generates trait impls.
- For library errors prefer `thiserror`; for application errors (where you want one type that holds anything) use `anyhow`.

**Self-check.**
- [ ] `?` on an `sqlx::Error` compiles inside a function returning `Result<_, OrderError>`.
- [ ] Printing the error shows the formatted message with field values.
- [ ] `Error::source()` walks to the underlying `sqlx::Error`.

### Task 14: Retry decorator with exponential backoff

**Problem.** Write a Python decorator `@retry(...)` that retries the wrapped function on transient errors only, with exponential backoff and jitter. It must *not* retry non-transient errors.

**Constraints.**
- Parameters: `attempts: int = 5`, `base_delay: float = 0.1`, `max_delay: float = 5.0`, `retry_on: tuple[type[Exception], ...] = (TransientError,)`.
- Backoff formula: `min(max_delay, base_delay * 2**(attempt - 1)) + random.uniform(0, 0.1)`.
- Log each retry with the attempt number and the next delay.
- Re-raise the last exception after `attempts` failures.
- Works on both sync and async functions (you can write two decorators if cleaner).

**Hints (try without these first).**
- `functools.wraps` preserves the wrapped function's metadata.
- `inspect.iscoroutinefunction(fn)` lets you branch sync/async if you want one decorator.
- Test it by injecting a function that fails twice then succeeds.

**Self-check.**
- [ ] A function that always raises `TransientError` is called exactly `attempts` times.
- [ ] A function that raises `ValueError` is called exactly once, then re-raises.
- [ ] Logged delays roughly double each attempt, capped at `max_delay`.

---

## Advanced (Senior)

Each Advanced task takes a half day to a day. They map to [`senior.md`](senior.md) — design-level decisions, not just code. Expect to throw away your first attempt at some of these.

### Task 15: HTTP middleware that translates domain errors

**Problem.** Build an HTTP middleware — pick one of Go (`net/http`), Spring (`@RestControllerAdvice`), or FastAPI (`exception_handler`) — that translates domain errors to HTTP status codes and a uniform JSON body. The mapping table is given as input; the middleware must not be coupled to a specific list of errors.

**Constraints.**
- Mapping table (treat as input):

  | Domain error          | HTTP status | Public message              |
  | --------------------- | ----------- | --------------------------- |
  | `NotFoundError`       | 404         | "resource not found"        |
  | `ForbiddenError`      | 403         | "operation not permitted"   |
  | `ValidationError`     | 400         | "invalid request"           |
  | `ConflictError`       | 409         | "resource conflict"         |
  | `RateLimitError`      | 429         | "too many requests"         |
  | `UpstreamTimeout`     | 504         | "upstream timeout"          |
  | `UpstreamUnavailable` | 503         | "upstream unavailable"      |
  | (anything else)       | 500         | "internal error"            |

- The response body is `{"error": {"code": "...", "message": "...", "trace_id": "..."}}`.
- The full error chain (including underlying causes) is logged server-side but never leaked to the client.
- Unmapped errors fall through to 500 *and* trigger a structured log entry at ERROR level with the trace ID.

**Hints (try without these first).**
- A `map[reflect.Type]int` is one way, but a slice of `(predicate func(error) bool, status int, message string)` composes better with `errors.Is`/`errors.As`.
- The trace ID comes from the request context — propagate it through.
- Spring's `@ExceptionHandler` is per-class; `@RestControllerAdvice` makes it global.

**Self-check.**
- [ ] Adding a new error type to the table is a one-line change.
- [ ] An unmapped error logs at ERROR and returns 500 with a generic message.
- [ ] The trace ID in the response matches the trace ID in the log.
- [ ] No stack trace ever appears in the response body.

### Task 16: gRPC service with correct `codes.*` mapping

**Problem.** Design a gRPC service in Go that exposes a `GetOrder(id)` RPC. Map every domain error to the *correct* `codes.*` status: not all failures are `Internal`. Justify each mapping in a comment.

**Constraints.**
- Use `google.golang.org/grpc/status` and `codes`.
- Mappings to implement:
  - "not found" → `codes.NotFound`
  - "auth required" → `codes.Unauthenticated`
  - "lacks permission" → `codes.PermissionDenied`
  - "invalid arg" → `codes.InvalidArgument`
  - "rate limited" → `codes.ResourceExhausted` (with a `RetryInfo` detail)
  - "deadline" → `codes.DeadlineExceeded`
  - "upstream down" → `codes.Unavailable`
  - "concurrent write conflict" → `codes.Aborted`
  - "unexpected internal" → `codes.Internal`
- Use `status.WithDetails(...)` to attach a `RetryInfo` (or a custom `ErrorInfo`) for at least one mapping.
- The client must be able to read those details.

**Hints (try without these first).**
- `codes.Unknown` is almost always wrong if you reach for it. Pick the closest specific code.
- `Aborted` and `FailedPrecondition` are subtly different — `Aborted` implies retry-after-resolution, `FailedPrecondition` does not.
- `status.Errorf` exists but `status.New(...).WithDetails(...).Err()` is what you want when you carry details.

**Self-check.**
- [ ] Every domain error maps to a code that is not `Internal`, unless it really is internal.
- [ ] At least one error carries `RetryInfo`.
- [ ] The client reads details with `status.FromError(err).Details()`.
- [ ] A code review by another senior would not flag any mapping as "wrong".

### Task 17: Retry plus circuit breaker around an HTTP client

**Problem.** Build a wrapper around an outbound HTTP client that combines exponential-backoff retry with a circuit breaker. When the breaker is open, calls fail fast with a typed `BreakerOpen` error and do not even reach the network.

**Constraints.**
- Three breaker states: Closed, Open, Half-Open. After `failure_threshold` failures within `window`, go to Open for `cooldown`. After cooldown, allow one probe (Half-Open) before reverting.
- Retry only on transient errors (5xx, network errors, timeouts) — never on 4xx.
- Retry budget capped at `max_attempts`; each attempt respects the parent `context.Context` deadline (Go) or a passed-in `Deadline` (Python).
- Expose breaker state via a metric (Prometheus counter or your favorite).

**Hints (try without these first).**
- Do not retry inside the breaker's Open state — the whole point is to fail fast.
- Jitter is mandatory; otherwise N clients retry in lockstep and DDoS the upstream when it recovers.
- A circuit breaker is *not* a substitute for a deadline. Keep both.

**Self-check.**
- [ ] A flaky upstream (50% failure) eventually succeeds within the retry budget.
- [ ] A dead upstream trips the breaker within `failure_threshold` calls.
- [ ] When the breaker is Open, calls return immediately with `BreakerOpen`.
- [ ] Cancelling the parent context aborts pending retries.

### Task 18: `Result<T, E>` in Java with Vavr

**Problem.** Take this Java service method that throws four different exceptions and refactor it to return `Either<DomainError, User>` (or `Try<User>`) using Vavr or a similar functional-Java library. The caller must handle every error case explicitly — no rethrow.

```java
public User register(NewUserRequest req) throws ValidationException, ConflictException, RateLimitException, StorageException {
    validate(req);
    if (repo.exists(req.email)) throw new ConflictException(req.email);
    if (limiter.exceeded(req.ip)) throw new RateLimitException(req.ip);
    return repo.save(new User(req));
}
```

**Constraints.**
- Define a sealed `DomainError` hierarchy with four variants.
- Return `Either<DomainError, User>`.
- Caller uses `match(...)` (Vavr's pattern matching) — no `if (either.isLeft())` chains.
- No checked exceptions remain in the signature.

**Hints (try without these first).**
- Java 21+ pattern matching makes Vavr less necessary, but Vavr's `Either` still gives `flatMap`/`map` chains that read well.
- `Either.left(...)` and `Either.right(...)` are your constructors.
- Multiple validations? `flatMap` to short-circuit on the first failure, or build a small applicative to collect all.

**Self-check.**
- [ ] The method signature has no `throws` clause.
- [ ] All four error types are reachable in the `match`.
- [ ] Removing a case from `match` is a compile error.
- [ ] No bare `null` anywhere.

### Task 19: Error aggregation for a parallel job runner

**Problem.** Build a parallel job runner in Go (or Python) that runs N independent jobs concurrently. After all jobs complete, the runner must return an aggregate result that preserves *every* error with its job ID — not just the first.

**Constraints.**
- Job ID + error must both be reachable from the aggregate (via `errors.As` or a typed accessor).
- Partial success is the norm: return successful results *and* the errors.
- One job panicking must not crash the runner — recover and report it as a job error.
- Use `errors.Join` (Go) or `ExceptionGroup` (Python) for the aggregate, but wrap each entry in a typed `JobError{ID, Cause}`.

**Hints (try without these first).**
- A buffered channel of results is the canonical Go shape: `chan jobResult` with `{ id, value, err }`.
- `defer recover()` inside each job goroutine catches panics.
- Do not log inside the worker — let the caller decide.

**Self-check.**
- [ ] Three failing jobs produce three `JobError` entries in the aggregate, in any order.
- [ ] A panic in one job becomes a `JobError` for that ID and does not affect siblings.
- [ ] Cancelling the parent context stops scheduling new jobs (running ones may finish).

### Task 20: Remove "log AND re-throw" duplication

**Problem.** You inherit a codebase where almost every catch block looks like:

```java
} catch (FooException e) {
    log.error("failed in bar", e);
    throw e;
}
```

This means every failure is logged at *every* layer — sometimes 6 times. Refactor the codebase so each error is logged exactly once, at the appropriate layer (typically the request boundary).

**Constraints.**
- Lower layers either *handle* the error or *propagate* it — never both.
- A single boundary layer (HTTP handler, message-bus consumer, CLI entry point) logs.
- The boundary log entry must include the full chain (`getCause()` walk).
- The refactor must be incremental — leave a brief comment explaining the policy near the boundary so the next contributor does not re-introduce the duplication.

**Hints (try without these first).**
- A "policy" comment near the entry point is worth more than a dozen review nits.
- `Throwable.getCause()` plus an iterator gives you the chain in Java; in Python it is `__cause__`/`__context__`.
- A static-analysis lint (Sonar / Checkstyle / Semgrep) can enforce "no log-and-rethrow" going forward.

**Self-check.**
- [ ] A failing request produces exactly one log entry, with the full chain.
- [ ] Lower layers contain no `log.error(...); throw e;` pairs.
- [ ] A Semgrep rule (or equivalent) is in CI to catch regressions.

---

## Capstone (Professional)

Capstone tasks are scoped in days, not hours. They map to [`professional.md`](professional.md). The goal here is not just code that runs — it is design that someone else can extend without breaking.

### Task 21: Design an error type system for a payments SDK

**Problem.** You are designing the public SDK for a payments service that wraps three providers (Stripe, Adyen, Braintree). Design the error type hierarchy that SDK users will catch. The SDK is used by hundreds of teams; once shipped, you cannot rename or reshape these errors without a major version bump.

**Constraints.**
- Decide: thrown exceptions vs `Result<T, E>`? Per language? Justify.
- Errors must be stable across SDK versions — adding a field is OK; renaming or removing is not.
- Provider-specific details (e.g. Stripe's `decline_code`) must be accessible without leaking the provider into the public type name.
- The SDK exposes idiomatic types in Go, Python, Java, and TypeScript. Document the mapping.
- Errors that are *safe to retry* must be distinguishable from errors that are *not* — at the type level, not by parsing strings.

**What 'done' looks like.** A design document plus a working prototype of the public error types in at least two languages. The doc has a hierarchy diagram, a stability policy ("we will never rename a public error type within a major version, we may add fields with sensible defaults"), and a worked example showing how a downstream developer catches a `CardDeclined` versus a `ProviderUnavailable`. A senior engineer from a different team can read the doc and predict the shape of an error they have not seen. Three weeks after shipping, no one has had to grep the SDK source to figure out what to catch.

### Task 22: Refactor a 50-endpoint Spring service that returns 500 for everything

**Problem.** You inherit a Spring service with about fifty endpoints. Every uncaught exception becomes a 500. Customer support is drowning because every 4xx is reported to them as a "server error". Design and execute a plan to introduce proper error mapping with minimum risk.

**Constraints.**
- You may not freeze feature work — the refactor must roll out incrementally.
- Existing clients that hard-code `if (status == 500) retry` must continue to work for at least one release.
- The plan must include observability: a dashboard showing the rate of each error class before and after.
- Establish a "no new 500-for-everything" lint to prevent regression.

**What 'done' looks like.** A documented rollout in three phases. Phase 1: a global `@RestControllerAdvice` maps known domain errors but defaults to 500 for unknown (no behavior change). Phase 2: each module's exceptions are typed into the domain hierarchy, one module per week. Phase 3: the default 500 mapping is replaced by an alert-on-fire policy. A before/after dashboard shows the 4xx rate climbing as the 500 rate drops — meaning real bugs are being surfaced instead of buried. The CI lint blocks new endpoints that throw raw `RuntimeException`. Customer support reports a drop in misclassified tickets within one sprint of phase 3.

### Task 23: Migrate a Python codebase off bare except

**Problem.** A 20k-line Python codebase has 120 `except:` blocks and 80 `except Exception:` blocks. Migrate it to typed exception handling in one focused afternoon (4-6 hours).

**Constraints.**
- You may not touch unrelated code.
- Production must not break — every change is reviewed.
- A bare `except` that catches `KeyboardInterrupt` and `SystemExit` is a real risk; document the cases where the existing code accidentally relied on this and choose explicit handling.
- Use Semgrep or a similar tool to enumerate occurrences first; do not grep blindly.
- Land the changes in batches of 10-20 per PR with reviewers, not one giant PR.

**What 'done' looks like.** A Semgrep rule that fails CI on new bare `except:` blocks. A short policy doc ("we catch specific exceptions; if you genuinely need to catch everything, use `except BaseException` and explain why in a comment"). The 200 existing blocks are reduced to under 10, each remaining one annotated with a justification. A grep for `except:` and `except Exception:` returns only known, blessed cases. The week's on-call ticket count does not spike — proof the migration did not break anything.

**Sample Solution (sketch).**

```python
# tools/migrate_bare_except.py
"""
Phase 1: enumerate.
Phase 2: classify each into one of:
    - genuine cleanup (convert to except Exception with logging.exception + raise)
    - swallows a known-narrow case (convert to that specific type)
    - actually buggy (open a ticket, do not "fix" silently)
Phase 3: land in batches of 10-20 with one reviewer per batch.
"""

import ast
import pathlib
import sys


def find_bare_excepts(root: pathlib.Path) -> list[tuple[pathlib.Path, int]]:
    hits: list[tuple[pathlib.Path, int]] = []
    for path in root.rglob("*.py"):
        try:
            tree = ast.parse(path.read_text(), filename=str(path))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.ExceptHandler) and node.type is None:
                hits.append((path, node.lineno))
    return hits


if __name__ == "__main__":
    for path, line in find_bare_excepts(pathlib.Path(sys.argv[1])):
        print(f"{path}:{line}: bare except")
```

### Task 24: Build observability hooks for errors

**Problem.** Build a small library (Go or Python) that wires error handling into observability. Every error logged through your library must emit a metric, attach an OpenTelemetry span event, and conditionally send a Sentry breadcrumb (only for errors above a configurable severity).

**Constraints.**
- A single `errobs.Capture(ctx, err, opts...)` (or Python equivalent) is the only public entry point.
- It must auto-detect the current OTel span from context and add an event there; if no span is active, create a one-shot span.
- Metrics: `errors_total{kind, severity}` counter.
- Sentry breadcrumbs are off by default; turned on by `opts.SendToSentry = true` or a per-error level threshold.
- No double-counting: if the same error is captured twice (which happens in nested handlers), only the first capture emits a metric.

**What 'done' looks like.** A package with under 500 lines of production code, unit-tested. A README that shows one example of integrating into an HTTP handler. A dashboard in Grafana (or screenshot of one) showing error rate by kind. A working integration test that runs a failing handler, scrapes the metric, queries the OTel collector for the span event, and asserts on both. A senior engineer who has not seen the code can add it to their service in under thirty minutes.

### Task 25: Author a team error-handling policy document

**Problem.** Write the "How we handle errors" policy document for an 8-engineer team that ships a Go + Python stack. The document is what new joiners read on day one and what code reviewers point to during reviews.

**Constraints.**
- One page (about 1000 words) — long enough to be specific, short enough that people actually read it.
- Cover: wrapping vs sentinels, when to log, what to log, what *not* to log (PII), retry policy, transient vs permanent classification, panic policy, error-as-value vs exceptions.
- Include a "what we *don't* do" section: the team's known anti-patterns with one-line reasons.
- Include a one-page code review checklist as an appendix.
- Decide on lint enforcement: which rules are CI-blocking, which are advisory.

**What 'done' looks like.** A document that has been reviewed by at least two other engineers and merged into the team's wiki. New joiners can read it in under fifteen minutes and identify three rules they want to ask about in their first PR. The on-call rotation reports fewer "I don't understand this error" pages within two months. When a code review comment cites the policy, the link to the relevant section is one click. Six months later, the document has been updated at least once based on lessons learned — not abandoned and stale.

---

If you can do all of these, you have the error-handling foundation that a strong senior engineer would expect.

---

## Related Topics

- [`junior.md`](junior.md) — foundations these tasks build on
- [`middle.md`](middle.md) — middle-level reference for Core tasks
- [`senior.md`](senior.md) — design-level reference for Advanced tasks
- [`professional.md`](professional.md) — policy-level reference for Capstone tasks
- [`interview.md`](interview.md) — Q&A drills that pair well with these tasks
- [`README.md`](README.md) — topic overview and index
- Sibling: [`../debugging/README.md`](../debugging/README.md)
- Sibling: [`../logging/README.md`](../logging/README.md)
- Cousin: [`../../code-craft/clean-code/06-error-handling/README.md`](../../code-craft/clean-code/06-error-handling/README.md)
