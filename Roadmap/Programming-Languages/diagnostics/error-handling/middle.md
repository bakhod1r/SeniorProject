# Error Handling — Middle Level

> **Topic:** [Error Handling Roadmap](README.md)
> **Focus:** Wrapping, context, typed errors, sentinels, multi-errors, and the disciplined art of propagating failure across layers without losing the story.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [The Five W's of an Error Message](#the-five-ws-of-an-error-message)
6. [Real-World Analogies](#real-world-analogies)
7. [Mental Models](#mental-models)
8. [Code Examples — The Same Bug Across Four Languages](#code-examples--the-same-bug-across-four-languages)
9. [Sentinel Errors and the `==` Trap](#sentinel-errors-and-the--trap)
10. [Typed Errors](#typed-errors)
11. [Stack Traces and Their Cost](#stack-traces-and-their-cost)
12. [Multi-Error / Error Aggregation](#multi-error--error-aggregation)
13. [Validation Errors — First vs All](#validation-errors--first-vs-all)
14. [`try/except` Discipline](#tryexcept-discipline)
15. [Resource Cleanup on the Error Path](#resource-cleanup-on-the-error-path)
16. [Pros & Cons of Wrapping](#pros--cons-of-wrapping)
17. [Use Cases](#use-cases)
18. [Coding Patterns](#coding-patterns)
19. [Clean Code](#clean-code)
20. [Best Practices](#best-practices)
21. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
22. [Common Mistakes](#common-mistakes)
23. [Tricky Points](#tricky-points)
24. [Test Yourself](#test-yourself)
25. [Tricky Questions](#tricky-questions)
26. [Cheat Sheet](#cheat-sheet)
27. [Summary](#summary)
28. [What You Can Build](#what-you-can-build)
29. [Further Reading](#further-reading)
30. [Related Topics](#related-topics)
31. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **An error that crosses a layer boundary must carry both the original cause and the new context.** Lose either, and you have a bad bug report.

At junior level you learned that errors exist, that languages model them in four broad ways, and that "catch nothing, log everything" is a recipe for pain. That was the *shape* of error handling. This page is about the *substance*: what happens when an error travels from the bottom of your call stack — say, a TCP read that returned `connection reset` — all the way up to the HTTP handler that has to decide whether to return `500` or `503` to a user.

The single hardest skill at this level is **wrapping**: attaching new information to an error as it propagates, without throwing away the original. A junior programmer turns `io.EOF` into `"something went wrong"` and ships it. A middle-level programmer wraps it as `"loading user 42 from cache: reading response body: unexpected EOF"` and ships *that* — because three months later, when production is on fire at 3am, the wrapped version takes five seconds to diagnose and the junior version takes five hours.

Every concept on this page exists to serve one principle: **the error your user sees at the top of the stack should let an engineer find the exact line that caused it without ever needing to reproduce the bug.** Wrapping, typed errors, sentinels, stack traces, multi-errors — these are all tools for the same job.

---

## Prerequisites

You should already know, from `junior.md` and from writing real code:

- The four error models (exceptions / return values / `Result<T,E>` / panic) and the basic syntax of each.
- The difference between a bug and an error.
- Why "swallowing" errors is bad.
- Basic Go `if err != nil`, Python `try/except`, Java `try/catch`, Rust `?`.
- That every function call participates in a *call stack* and errors travel up it.

Helpful but not required: some pain. Specifically — you have at least once had to debug a production issue where the only clue was an error message that read `"failed"`, and you remember how that felt. That memory is the strongest motivator for everything below.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Wrap** | To attach new context to an existing error so the cause is preserved and the new layer is visible. (`%w` in Go, `from e` in Python, `new Exception(msg, cause)` in Java, `.context()` in Rust.) |
| **Unwrap** | To extract the wrapped (inner) error from an outer one. (`errors.Unwrap` in Go, `.__cause__` in Python, `.getCause()` in Java, `.source()` in Rust.) |
| **Sentinel error** | A specific named, exported value used for identity comparison. Examples: `io.EOF`, `sql.ErrNoRows`, `os.ErrNotExist`. |
| **Typed error** | A struct/class/enum whose *type* (not just value) signals a category of failure. Inspected with `errors.As` in Go, `isinstance` in Python, `instanceof` in Java, pattern matching in Rust. |
| **Error chain** | The linked list formed by an outer error pointing to its cause, that cause pointing to *its* cause, all the way down. |
| **`%w` verb** | Go's `fmt.Errorf` directive that creates a wrapping error whose `Unwrap()` returns the wrapped value. |
| **`errors.Is`** | Go: walks the chain testing identity (`==`) against a target. The right way to check for sentinels. |
| **`errors.As`** | Go: walks the chain looking for an error of a given type; assigns into a pointer. The right way to check for typed errors. |
| **`__cause__`** | Python: set by `raise X from Y`. The explicit cause. |
| **`__context__`** | Python: set automatically when an exception is raised inside an `except` block. The implicit context. |
| **Suppressed exception** | Java/Python: a secondary exception attached to a primary one — used when cleanup itself fails. |
| **`ExceptionGroup`** | Python 3.11+: a single exception that contains multiple sub-exceptions, raised together. |
| **Stack trace** | The list of stack frames captured at the moment an error was created (or raised). Costly to capture, invaluable for debugging. |
| **Multi-error** | An aggregate error that wraps several independent errors as one value. (`errors.Join` in Go.) |
| **Boundary** | A layer transition — repository → service → handler. Errors usually need transformation at boundaries. |
| **Cause** | The original, lowest-level error that started the failure chain. |
| **Context** | The information added at each layer about *what was being attempted* when the failure occurred. |

---

## Core Concepts

### 1. Errors Are Layered, Just Like Your Code

Your code is layered: database driver → repository → service → handler. An error born at the bottom must travel up through every layer to reach the user. Each layer knows something the layer below it does *not* — the repository knows *which user* was being loaded; the service knows *which business operation* was running; the handler knows *which endpoint* was hit. None of that information is in the original `connection reset by peer`. Wrapping is how each layer **stitches its knowledge onto the error** without erasing the cause.

### 2. Two Audiences, One Error

An error has two readers: the *machine* and the *human*. The machine needs to ask `"is this the kind of error I should retry?"` — that's what typed errors and sentinels are for. The human needs to read it in a log and instantly know what went wrong — that's what wrapping and message design are for. A good error speaks to both.

### 3. The Chain Is the Data Structure

In modern languages, an error isn't a string. It's the head of a **linked list** where each node is one layer's contribution. `errors.Is`, `errors.As`, `Unwrap`, `__cause__`, `getCause` — these are all just iterators over that list. Once you see the chain, you stop thinking about errors as text and start thinking about them as a graph of *causes*.

### 4. Wrapping Is Cheap, Context Is Free

The single biggest excuse for not wrapping is "it adds boilerplate." That's a lie — it adds *information*. A line of `return fmt.Errorf("loading user %d: %w", id, err)` costs you 60 characters and saves the next engineer an hour of grep. The price-to-value ratio is unbeatable.

### 5. The Original Error Is Sacred

Whatever you wrap, **never throw away the original**. The temptation is real — "I'll just return `errors.New("user not found")` instead of passing the DB error along." Don't. The DB error might contain the actual SQL state, the connection name, the row count — the very things you'll wish you had when debugging. Wrap; don't replace.

### 6. Translation Happens at Boundaries

There is one legitimate place to replace an error rather than wrap it: at a **trust boundary**. The HTTP handler should never leak a database error to the public API. There you *translate* — map the internal error to a public-facing one — but you still **log the original** before doing so. (Senior level goes deep on this; here we just name the principle.)

### 7. A Sentinel Is an Identity, Not a String

`io.EOF` is the same `*errors.errorString` value everywhere in your program. Comparing with `err == io.EOF` works *only if no one has wrapped it*. The moment any layer does `fmt.Errorf("reading: %w", io.EOF)`, the `==` check fails and your code goes down the wrong branch. That's why `errors.Is` exists.

### 8. Stack Traces Are a Tool, Not a Default

Python and Java capture stack traces automatically on every raised exception. Go does not — by design, because it's expensive. Rust's `std::error::Error` doesn't either; you opt in via `anyhow` or `eyre`. There's no universal right answer; just know what your language does and **never assume**.

---

## The Five W's of an Error Message

A good error message answers, at minimum, four of these five questions:

| W | Example fragment |
|---|------------------|
| **What** | `"failed to decode JSON"` |
| **Where** | `"in user repository"` or implied by stack frame |
| **When** | `"during checkout flow"` or `"on attempt 3 of 5"` |
| **While** | `"loading user 42"` (the operation in progress) |
| **Why** | `"unexpected EOF"` (the underlying cause, preserved by wrapping) |

A bad error says `"error occurred"`. A mediocre error says `"json decode failed"`. A good error reads end-to-end like a sentence:

> `"checkout: loading user 42: cache get: decoding response: unexpected EOF"`

You can read that left-to-right and **you already know what to look at**: a checkout call tried to load user 42, hit the cache, got an empty or truncated response. No reproduction needed.

> **Rule of thumb:** Always include the **failing value** — the file path, the user ID, the URL, the key. *Never* include a password, token, API key, or PII. If you're not sure whether a value is safe to log, treat it as unsafe.

---

## Real-World Analogies

| Real-world thing | Error-handling concept |
|------------------|------------------------|
| A package that gets re-labeled at every distribution hub | Error wrapping at each layer |
| The original sender's address on a forwarded letter | The cause preserved through wrapping |
| The "in-reply-to" header of an email thread | `__cause__` / `errors.Unwrap` |
| A medical chart that grows as the patient passes each specialist | An error chain through service layers |
| The "see also" cross-references in a dictionary | `errors.Is` walking the chain |
| Triage tags at a hospital emergency room | Typed errors used for routing |
| A boxer's record of every fight | Stack trace |
| A receipt that lists every individual purchase | Multi-error / `errors.Join` |
| Translating a foreign-language complaint to file the police report | Error translation at a trust boundary |

---

## Mental Models

### The "Sentence" Model

Read an error message left-to-right as a sentence. Each colon is a layer boundary. If the sentence makes sense — *"checkout: loading user 42: cache get: decoding response: unexpected EOF"* — your wrapping is correct. If it reads as gibberish — *"unexpected EOF: error: failed"* — you are duplicating words and missing context. Speak it aloud.

### The "Onion" Model

Imagine the error as an onion. The outermost layer is the user-facing message; the innermost layer is the original cause. Wrapping *adds* a layer to the outside without disturbing the inside. Unwrapping *peels* one layer off. The whole onion is the chain.

### The "Bus Route" Model

An error rides a bus. At each stop (layer), a passenger (context) gets on. By the time the error reaches the terminal (the logger), it's carrying everyone who joined the journey. If you ever throw a passenger off (by re-creating the error from scratch), you lose part of the story permanently.

---

## Code Examples — The Same Bug Across Four Languages

The scenario, identical for all four languages: an HTTP handler calls a `UserService`, which calls a `UserRepository`, which calls a database. The database returns a "not found." Each layer adds its own context, and the handler ultimately inspects the chain to decide what to do.

### Go

```go
package main

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"
)

// ErrUserNotFound is a sentinel returned by the service layer.
var ErrUserNotFound = errors.New("user not found")

type UserRepo struct{ db *sql.DB }

func (r *UserRepo) Get(id int64) (string, error) {
	var name string
	err := r.db.QueryRow("SELECT name FROM users WHERE id = $1", id).Scan(&name)
	if err != nil {
		// Wrap with %w — preserves the original (e.g. sql.ErrNoRows) in the chain.
		return "", fmt.Errorf("user repo: querying id=%d: %w", id, err)
	}
	return name, nil
}

type UserService struct{ repo *UserRepo }

func (s *UserService) Profile(id int64) (string, error) {
	name, err := s.repo.Get(id)
	if err != nil {
		// Translate sql.ErrNoRows into a service-level sentinel,
		// but keep the original error in the chain too.
		if errors.Is(err, sql.ErrNoRows) {
			return "", fmt.Errorf("user service: profile id=%d: %w", id, ErrUserNotFound)
		}
		return "", fmt.Errorf("user service: profile id=%d: %w", id, err)
	}
	return name, nil
}

func handler(svc *UserService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name, err := svc.Profile(42)
		if err != nil {
			// Log the FULL chain — engineers read this.
			log.Printf("GET /profile failed: %v", err)
			if errors.Is(err, ErrUserNotFound) {
				http.Error(w, "user not found", http.StatusNotFound)
				return
			}
			// Public message — users read this.
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		fmt.Fprintln(w, name)
	}
}

func main() {
	log.Println("starting server")
	// http.ListenAndServe(":8080", handler(svc))
}
```

The wrapped error a developer would see in logs:
`user service: profile id=42: user repo: querying id=42: sql: no rows in result set`

### Python

```python
import logging
import sqlite3
from typing import Optional

log = logging.getLogger(__name__)


class UserNotFound(Exception):
    """Service-level: the user with that id does not exist."""


class UserRepoError(Exception):
    """Repository-level wrapper for any DB error."""


class UserRepo:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def get(self, user_id: int) -> str:
        try:
            row = self.conn.execute(
                "SELECT name FROM users WHERE id = ?", (user_id,)
            ).fetchone()
        except sqlite3.DatabaseError as e:
            # `from e` preserves the cause in __cause__.
            raise UserRepoError(f"querying id={user_id}") from e
        if row is None:
            raise UserRepoError(f"no row for id={user_id}")
        return row[0]


class UserService:
    def __init__(self, repo: UserRepo):
        self.repo = repo

    def profile(self, user_id: int) -> str:
        try:
            return self.repo.get(user_id)
        except UserRepoError as e:
            # Translate "no row" into a domain-level error,
            # but keep the cause via `from e`.
            if "no row" in str(e):
                raise UserNotFound(f"profile id={user_id}") from e
            raise


def handle_profile(svc: UserService, user_id: int) -> tuple[int, str]:
    try:
        return 200, svc.profile(user_id)
    except UserNotFound as e:
        log.exception("GET /profile not-found id=%d", user_id)  # full traceback
        return 404, "user not found"
    except Exception as e:
        log.exception("GET /profile failed id=%d", user_id)
        return 500, "internal error"
```

Python's `from e` builds the same chain Go's `%w` does. Inspecting `e.__cause__` walks one step down.

### Java

```java
package errordemo;

import java.sql.SQLException;
import java.util.logging.Level;
import java.util.logging.Logger;

public class UserDemo {

    private static final Logger LOG = Logger.getLogger(UserDemo.class.getName());

    // Domain-level, unchecked: we don't want every caller to declare it.
    public static class UserNotFoundException extends RuntimeException {
        public UserNotFoundException(String msg, Throwable cause) { super(msg, cause); }
    }

    public static class UserRepoException extends RuntimeException {
        public UserRepoException(String msg, Throwable cause) { super(msg, cause); }
    }

    static class UserRepo {
        String get(long id) {
            try {
                // Imagine a JDBC call here:
                throw new SQLException("ERROR: relation \"users\" does not exist");
            } catch (SQLException e) {
                // Preserve the cause — Throwable's second constructor arg.
                throw new UserRepoException("querying id=" + id, e);
            }
        }
    }

    static class UserService {
        private final UserRepo repo;
        UserService(UserRepo r) { this.repo = r; }

        String profile(long id) {
            try {
                return repo.get(id);
            } catch (UserRepoException e) {
                if (e.getMessage().contains("no row")) {
                    throw new UserNotFoundException("profile id=" + id, e);
                }
                throw e;
            }
        }
    }

    public static void handle(UserService svc) {
        try {
            String name = svc.profile(42L);
            System.out.println(name);
        } catch (UserNotFoundException e) {
            LOG.log(Level.INFO, "GET /profile 404", e);
            System.out.println("404 user not found");
        } catch (Exception e) {
            LOG.log(Level.SEVERE, "GET /profile 500", e); // logs full chain
            System.out.println("500 internal error");
        }
    }

    public static void main(String[] args) {
        handle(new UserService(new UserRepo()));
    }
}
```

`Throwable.getCause()` is Java's `Unwrap`. The default logger prints `"Caused by: ..."` lines for every link in the chain.

### Rust

```rust
use std::fmt;

#[derive(Debug)]
enum RepoError {
    NotFound,
    Db(String),
}

impl fmt::Display for RepoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RepoError::NotFound => write!(f, "no rows in result"),
            RepoError::Db(msg) => write!(f, "db: {}", msg),
        }
    }
}
impl std::error::Error for RepoError {}

#[derive(Debug)]
enum ServiceError {
    UserNotFound(u64),
    Repo(RepoError),
}

impl fmt::Display for ServiceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ServiceError::UserNotFound(id) => write!(f, "user not found: id={}", id),
            ServiceError::Repo(e) => write!(f, "repo error: {}", e),
        }
    }
}
impl std::error::Error for ServiceError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            ServiceError::Repo(e) => Some(e),
            _ => None,
        }
    }
}

struct UserRepo;
impl UserRepo {
    fn get(&self, id: u64) -> Result<String, RepoError> {
        if id == 42 { Err(RepoError::NotFound) }
        else        { Ok("Ada".into()) }
    }
}

struct UserService { repo: UserRepo }
impl UserService {
    fn profile(&self, id: u64) -> Result<String, ServiceError> {
        match self.repo.get(id) {
            Ok(n) => Ok(n),
            Err(RepoError::NotFound) => Err(ServiceError::UserNotFound(id)),
            Err(other) => Err(ServiceError::Repo(other)),
        }
    }
}

fn handle(svc: &UserService, id: u64) -> (u16, String) {
    match svc.profile(id) {
        Ok(name) => (200, name),
        Err(ServiceError::UserNotFound(_)) => (404, "user not found".into()),
        Err(e) => {
            // Walk the chain for logging.
            let mut src: Option<&dyn std::error::Error> = Some(&e);
            while let Some(s) = src {
                eprintln!("caused by: {}", s);
                src = s.source();
            }
            (500, "internal error".into())
        }
    }
}

fn main() {
    let svc = UserService { repo: UserRepo };
    let (code, body) = handle(&svc, 42);
    println!("{} {}", code, body);
}
```

In production Rust you would typically use `thiserror` (for typed enums) plus `anyhow::Context` (for ad-hoc wrapping). The above shows the underlying machinery so the magic is visible.

---

### Before-and-After: Why Wrapping Is Worth It

**Without wrapping**, the on-call engineer sees:

```text
2026-05-29T03:14:17Z ERROR sql: no rows in result set
```

They have to: grep for that string across 30 services, find every call site, mentally reproduce which one ran, figure out *which user id* was involved. **30+ minutes**, easy.

**With wrapping**, the same incident shows:

```text
2026-05-29T03:14:17Z ERROR GET /checkout failed: checkout: loading user 42:
  user service: profile id=42: user repo: querying id=42:
  sql: no rows in result set
```

Engineer reads the message, knows the endpoint, the operation, the user id, and the cause **in five seconds**. That is the entire return-on-investment of error wrapping.

---

## Sentinel Errors and the `==` Trap

A **sentinel** is a sentinel because it's *one specific value* you compare by identity:

| Language | Famous sentinels |
|----------|------------------|
| Go | `io.EOF`, `sql.ErrNoRows`, `os.ErrNotExist`, `context.Canceled`, `context.DeadlineExceeded` |
| Python | (less common) `StopIteration` is the closest analog |
| Rust | `std::io::ErrorKind::NotFound`, `UnexpectedEof` (it's a kind, accessed via `e.kind()`) |
| Java | (uncommon — Java uses typed exceptions instead) |

The trap is direct equality:

```go
// WRONG once any layer wraps the error:
if err == io.EOF { ... }

// RIGHT — walks the chain:
if errors.Is(err, io.EOF) { ... }
```

The reason: as soon as any caller does `fmt.Errorf("reading body: %w", io.EOF)`, the result is *not* `io.EOF` anymore — it's a `*fmt.wrapError` whose `Unwrap()` returns `io.EOF`. The `==` check fails silently, your `if` branch is skipped, and your code treats end-of-file as a real error.

> **Rule:** Never compare errors with `==` in Go. Always use `errors.Is`. The compiler does not warn you, so this becomes a habit you have to enforce in code review.

### `errors.Is` vs `errors.As` vs `errors.Unwrap`

| Function | Question it answers | Walks chain? | Typical use |
|----------|---------------------|--------------|-------------|
| `errors.Unwrap(err)` | "What is one layer below?" | No — single step | Manual chain traversal, custom logic |
| `errors.Is(err, target)` | "Does the chain contain *this specific value* (or pass `Is(target)`)?" | Yes | Sentinel checks: `errors.Is(err, io.EOF)` |
| `errors.As(err, &target)` | "Does the chain contain an error of *this type*?" | Yes | Typed-error extraction: `var nfe *NotFoundError; errors.As(err, &nfe)` |

Mnemonic: **Is for identity, As for type.**

---

## Typed Errors

Sentinels are great when there's *one* failure to identify. But when your domain has variations — `BadRequest`, `Unauthorized`, `Conflict`, `RateLimited` — you want **types**, not values.

### Go: structs implementing `error`

```go
type NotFoundError struct {
	Resource string
	ID       string
}

func (e *NotFoundError) Error() string {
	return fmt.Sprintf("%s %s not found", e.Resource, e.ID)
}

// Caller:
var nfe *NotFoundError
if errors.As(err, &nfe) {
	log.Printf("missing %s/%s", nfe.Resource, nfe.ID)
}
```

### Python: exception hierarchies

```python
class AppError(Exception): ...
class NotFoundError(AppError): ...
class UserNotFound(NotFoundError): ...
class OrderNotFound(NotFoundError): ...

try:
    do_thing()
except NotFoundError as e:   # catches both
    return 404
except AppError as e:
    return 500
```

The hierarchy *is* the typing. Order of `except` clauses matters: narrowest first.

### Java: extending `Exception` / `RuntimeException`

```java
class AppException extends RuntimeException { /* ... */ }
class NotFoundException extends AppException { /* ... */ }
class UserNotFoundException extends NotFoundException { /* ... */ }
```

Same idea as Python — the class hierarchy expresses the taxonomy. Caught with `catch (NotFoundException e)`.

### Rust: enums with `thiserror`

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("user {0} not found")]
    UserNotFound(u64),
    #[error("rate limited, retry after {0}s")]
    RateLimited(u64),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}
```

`#[from]` auto-implements `From<sqlx::Error> for AppError::Db`, so `?` "just works." Pattern-matching on the enum at the boundary tells you which arm fired.

> **The rule of thumb:** use **sentinels** for terminal conditions that have no payload (EOF, canceled). Use **typed errors** when the failure carries data (which resource, which ID, what limit). Avoid mixing both for the same condition.

---

## Stack Traces and Their Cost

| Language | Default stack trace? | Cost (rough order) | How to opt in/out |
|----------|---------------------|---------------------|--------------------|
| Python | Yes, on every `raise` | Tens of microseconds | You can't really opt out — they're built into `Exception` |
| Java | Yes, in `Throwable.fillInStackTrace()` | Often the dominant cost of throwing | Override `fillInStackTrace()` to no-op; useful for hot-path "control-flow" exceptions |
| Go | **No** | Zero (until you opt in) | Use `pkg/errors` / `github.com/cockroachdb/errors` / Go 1.21+ `runtime/debug.Stack()` |
| Rust | **No** for `Error` | Zero | `anyhow::Error` captures one if `RUST_BACKTRACE=1`; `std::backtrace::Backtrace` is opt-in |

### Why Go skips them

Go's design philosophy: errors are *values*, returned through normal control flow at potentially every call. If every error captured a stack trace, the hot path would slow measurably. Instead, Go puts the burden on you to wrap with enough context that you can locate the bug without a trace. (When you *do* want one — say, in a panic recovery — `runtime/debug.Stack()` gives it to you on demand.)

### When to capture, when to skip

Capture when:
- The error is truly exceptional and rare (a panic, an unrecoverable invariant break).
- You're at the *boundary* of your service and the error is going to be logged.
- You can't reproduce the bug from the message alone.

Skip when:
- The error is part of normal flow (cache misses, "not found", validation failures).
- You're in a hot loop where the cost is real.
- The wrapped chain already tells you enough.

> **Tradeoff:** Stack traces feel like a free win because in Python/Java they appear automatically. They are not free — they're a constant tax you pay on every exception, paid in CPU cycles. Worth it for the rare error, expensive for control-flow exceptions like `StopIteration`.

---

## Multi-Error / Error Aggregation

Sometimes a single operation can produce **multiple independent errors**, and you want to surface all of them, not just the first.

### Go 1.20+: `errors.Join`

```go
func validateUser(u User) error {
	var errs []error
	if u.Name == "" {
		errs = append(errs, errors.New("name is required"))
	}
	if u.Age < 0 {
		errs = append(errs, errors.New("age must be non-negative"))
	}
	if !strings.Contains(u.Email, "@") {
		errs = append(errs, errors.New("email is invalid"))
	}
	return errors.Join(errs...)  // nil if errs is empty
}
```

The joined error's `Error()` puts each child on its own line. `errors.Is` and `errors.As` both walk the joined error's children — so `errors.Is(joined, target)` returns true if *any* child matches.

### Python 3.11+: `ExceptionGroup`

```python
def validate(u):
    errors = []
    if not u.name:                errors.append(ValueError("name is required"))
    if u.age < 0:                 errors.append(ValueError("age must be non-negative"))
    if "@" not in u.email:        errors.append(ValueError("email is invalid"))
    if errors:
        raise ExceptionGroup("validation failed", errors)
```

The new `except*` syntax lets a handler match *some* exceptions out of the group and leave others to propagate:

```python
try:
    validate(u)
except* ValueError as eg:
    return render_validation_errors(eg.exceptions)
```

### Java: suppressed exceptions

`Throwable.addSuppressed(other)` attaches a secondary exception. Used most famously by try-with-resources: if both the body *and* `close()` throw, the body's exception is primary and the `close()` failure is suppressed.

```java
try (var conn = openConnection()) {
    work(conn);
}  // if work() throws AND close() throws, the latter is suppressed onto the former
```

### Rust: `Vec<E>` and crates

There's no built-in multi-error. Conventional pattern is `Vec<MyError>` for validation, or the `multi-error` crate. `anyhow` does not aggregate.

---

## Validation Errors — First vs All

This is one of the most-debated micro-design questions. Two flavors:

**First error wins:**
```go
if name == "" { return errors.New("name required") }
if age < 0   { return errors.New("age invalid") }
if !valid(email) { return errors.New("email invalid") }
```

**All errors collected:**
```go
var errs []error
if name == "" { errs = append(errs, errors.New("name required")) }
if age < 0   { errs = append(errs, errors.New("age invalid")) }
if !valid(email) { errs = append(errs, errors.New("email invalid")) }
return errors.Join(errs...)
```

| Style | Best for |
|-------|----------|
| First-error | Pipelines where later steps depend on earlier ones (no point reporting later failures if the first one made them inevitable). |
| All-errors | User-facing form validation. If the user has three problems in their form, telling them only the first one means they fix it, resubmit, see the next one, and rage-quit. |

The rule: **on internal pipelines, first-error is fine; on anything that touches a human, collect them all.**

---

## `try/except` Discipline

Even in exception-based languages, a careless `try/except` is worse than no error handling. Discipline rules:

1. **Catch the narrowest class possible.** `except Exception` catches `KeyboardInterrupt` and `SystemExit` in older Python versions and hides bugs everywhere. Prefer `except ValueError` or your own typed class.
2. **Order matters.** Narrower exceptions *first*, broader after. Python and Java both match in source order.
3. **`except (A, B):`** when two unrelated exceptions deserve the same handling — but only when. If you find yourself listing five disparate classes, your `try` block is doing too much.
4. **Never empty `except:`.** This swallows `KeyboardInterrupt`, `MemoryError`, everything. If you mean "any application-level error", say `except Exception`. If you mean "I literally don't care," explain it in a comment, because reviewers won't believe you.
5. **Re-raise unmodified when you can't add value.** A bare `raise` inside `except` re-throws with the original traceback intact. Don't wrap unless you have context to add.

```python
# Bad — swallows everything, no info.
try:
    do()
except:
    pass

# Bad — overly broad, no context.
try:
    do()
except Exception:
    return None

# Good — narrow, contextual, chained.
try:
    do()
except FileNotFoundError as e:
    raise ConfigError(f"missing config at {path}") from e
```

---

## Resource Cleanup on the Error Path

Every language has a "no matter what, clean this up" mechanism. The mistakes show up when **cleanup itself fails**.

| Language | Mechanism | What happens if cleanup throws? |
|----------|-----------|----------------------------------|
| Go | `defer` | A panic in a deferred call can overwrite the in-flight error; common pattern: assign the close error back to a named return only if the primary is `nil`. |
| Python | `try/finally`, `with` | A new exception in `finally` *replaces* the original (use `__context__` to find it). |
| Java | `try-with-resources` | Cleanup exception is *suppressed* onto the primary one — both survive. |
| Rust | `Drop` | `Drop::drop` cannot return an error and **must not panic** — panicking while panicking aborts the process. |

### Go: the named-return idiom

```go
func process(name string) (err error) {
	f, err := os.Open(name)
	if err != nil {
		return fmt.Errorf("open %s: %w", name, err)
	}
	defer func() {
		if cerr := f.Close(); cerr != nil && err == nil {
			err = fmt.Errorf("close %s: %w", name, cerr)
		}
	}()
	return doWork(f)
}
```

The deferred close only sets `err` if no earlier error exists. If `doWork` already returned an error, that wins; the close error is silently dropped (or you can wrap with `errors.Join(err, cerr)` if you want both).

### Java: try-with-resources

```java
try (var in = new FileInputStream(path)) {
    process(in);
}  // close() is called automatically; if both throw, close()'s is addSuppressed onto the primary.
```

### Python: `with`

```python
with open(path) as f:
    process(f)
# __exit__ runs even on exception. If __exit__ raises, the original is preserved in __context__.
```

### Rust: `Drop` discipline

`Drop` runs on scope exit, on success or panic alike. Because `Drop::drop` returns `()`, it **cannot signal failure**. If your cleanup *might* fail meaningfully, expose an explicit `close()` method *and* still implement `Drop` for the lazy case.

---

## Pros & Cons of Wrapping

### Pros

- Preserves the cause: no more "what was the original error?" mystery.
- Adds layer context cheaply: a sentence per layer.
- Enables `errors.Is` / `errors.As` to still find sentinels and types deep in the chain.
- Makes logs self-explanatory: the error message *is* the diagnostic.

### Cons

- Verbose if every layer wraps with no new information ("repo: service: handler: error" tells you nothing).
- Easy to leak internal details into messages that reach end users (mitigated by translation at the boundary).
- Chains can grow long for deep call stacks; log formatting must handle multi-line errors.
- Sentinel checks now require `errors.Is` discipline — `==` becomes a quiet bug.

---

## Use Cases

- **HTTP handlers** translating internal errors to status codes while logging the full chain.
- **Background workers** deciding which errors are transient (retry) vs permanent (dead-letter).
- **Database repositories** translating driver errors (`pq.Error`, `sql.ErrNoRows`) into domain errors.
- **Config loaders** aggregating "this field is missing, this one is invalid" into a single bootstrap-time `ExceptionGroup`/`errors.Join`.
- **CLI tools** showing a user-friendly `"could not open file: X"` while keeping the raw OS error in `--verbose` mode.
- **Validation layers** on API request bodies, where collecting all errors is mandatory for usability.

---

## Coding Patterns

### Pattern: wrap-on-return

Every place you propagate an error from a foreign call, wrap it with the operation and the failing value.

```go
if err := db.QueryRow(...).Scan(&u); err != nil {
    return fmt.Errorf("load user id=%d: %w", id, err)
}
```

### Pattern: typed-error-at-boundary

Define one typed error per *category* you'll dispatch on. Translate to it at the boundary.

```go
type ValidationError struct{ Field, Reason string }
func (v *ValidationError) Error() string { return v.Field + ": " + v.Reason }
```

### Pattern: classify-then-act

At the top of each layer, classify before acting:

```python
try:
    do_thing()
except (Timeout, ConnectionError):
    retry()
except ValidationError:
    return 400
except Exception:
    log.exception(...)
    return 500
```

### Pattern: anyhow + thiserror

In Rust, `thiserror` for library errors (precise, typed); `anyhow` for application code (ad-hoc, with `.context(...)`). Cross the boundary once: `.context()`-wrapped `anyhow::Error` is fine at `main`; in library APIs, return a typed enum.

### Pattern: error sink

For background jobs processing thousands of items, collect failures into a sink rather than aborting:

```go
type Sink struct{ Errors []error }
func (s *Sink) Add(err error) { if err != nil { s.Errors = append(s.Errors, err) } }
// at the end:
if len(s.Errors) > 0 { log.Printf("batch had %d failures: %v", len(s.Errors), errors.Join(s.Errors...)) }
```

---

## Clean Code

- Every wrapped message starts with **what was being attempted**, not what failed. (`"loading user 42"`, not `"got error"`.)
- Include the **failing value** — id, path, key — never secrets.
- Never log *and* return the same error at the same layer. Pick one.
- Don't put the word `"error"` in error messages. Of course it's an error.
- Use lowercase first letters in Go (`fmt.Errorf("loading...")`) so concatenation reads naturally.
- One concept per typed-error class. Don't make `AppError` mean six things via an enum field.

---

## Best Practices

1. **Always wrap with `%w` / `from e` when crossing a layer.** Bare strings break `errors.Is`.
2. **Define typed errors for anything your caller might dispatch on.** Strings are for humans; types are for code.
3. **Use sentinels for terminal conditions with no payload.** EOF, canceled, deadline.
4. **Log the full chain once, at the outermost boundary** — not at every layer.
5. **At public boundaries, translate.** Don't leak `sqlx: column "x" does not exist` to API consumers.
6. **Capture stack traces sparingly** and only when the wrapped chain isn't enough.
7. **Aggregate validation errors;** fail-fast on internal pipelines.
8. **Treat error messages as part of your API.** Once users grep for `"user not found"`, you've promised that string.

---

## Edge Cases & Pitfalls

- **Double-wrapping the same context.** `"loading user: loading user: ..."`. Solved by making each layer add exactly one new piece of information.
- **Mutating wrapped errors.** Don't. If your error type has a mutable field and you reuse the value, the chain ends up mutated everywhere.
- **`errors.Is` against an error that's also a `target` for itself.** A type implementing `Is(target) bool` can return true for many sentinels — be deliberate.
- **`fmt.Errorf("%w: %w", a, b)`** (Go 1.20+) wraps *both* — `errors.Is` walks both branches. Older code that assumed a single `%w` may not.
- **Python's implicit chaining inside `except`.** Any new exception raised inside an `except` block gets `__context__` automatically set, even without `from e`. Use `from None` to suppress it.
- **Java's `addSuppressed` silently dropping** when called on a self-loop or after stack truncation.
- **Rust's `?` only works when the error types convert.** Forgetting a `From` impl turns a clean `?` into a verbose `.map_err(...)`.
- **Empty `errors.Join` returns nil**, which is correct but surprising if you assumed it always returns a non-nil aggregate.

---

## Common Mistakes

1. **`return err` with no wrap.** You just lost the chance to add context. The caller has no idea which operation produced this.
2. **`return fmt.Errorf("%v", err)`** — uses `%v`, not `%w`. The string survives; the chain dies. `errors.Is` will not find anything below.
3. **`if err == io.EOF`** — silently breaks the moment anyone wraps. Use `errors.Is`.
4. **`raise ValueError(str(e))` instead of `raise ValueError("...") from e`.** You destroyed the cause to gain a string.
5. **Catching `Exception` (or `Throwable`) and logging "error".** No info, no narrowing, no recovery. Cargo-cult.
6. **Logging the same error at three layers.** Logs explode. Each unique failure produces three entries. On-call engineers stop trusting the log.
7. **Adding the word `"error"` to error messages.** "error: failed to error" — the `"error"` is implied by the level. Skip it.
8. **Leaking internal errors past a trust boundary.** `"sqlx: invalid syntax for type integer: 'abc'"` in an HTTP 500 response is a security smell *and* useless to the user.
9. **Mixing first-error and all-errors arbitrarily.** Pick a discipline per layer.
10. **Forgetting that a deferred close can fail.** And forgetting to do anything about it.

---

## Tricky Points

- In Go, `errors.Is(nil, nil)` returns `true`. `errors.Is(err, nil)` is `true` iff `err` is nil. Surprising on first read.
- In Go, an `error` interface holding a typed nil pointer is **not nil**. `var e *MyError = nil; var err error = e; err != nil` (true!). Classic interview trap.
- In Python, `raise X from None` is the way to *suppress* chained `During handling of the above exception` noise in tracebacks — useful when the wrapped exception is intentional.
- In Python, `raise X` *inside* `except` block sets `__context__` even without `from`. The traceback will show "During handling..." unless you use `from None`.
- In Java, `Throwable.initCause()` can only be called once. Calling it twice throws `IllegalStateException`. The two-arg constructor is the safer path.
- In Rust, `?` calls `From::from` to convert the error type. If conversion is implicit and lossy, you can lose context silently.
- In Go, `errors.As` requires a *pointer to a pointer* for pointer types: `var pe *PathError; errors.As(err, &pe)`. Forgetting the second `&` is a frequent bug.
- `errors.Join(nil, nil, nil)` returns `nil`, but `errors.Join(nil)` also returns `nil`. There's no "empty multi-error" sentinel.
- Java's `try-with-resources` calls `close()` even if the body returns normally — but if both throw, the body wins as primary and `close()` is suppressed. Swap that order in your head and you'll misread logs.

---

## Test Yourself

Try these without looking. Run them where applicable.

1. Write a Go function that opens a file, reads its contents, returns them — and wraps errors from both `os.Open` and `io.ReadAll` with distinct contexts. Demonstrate `errors.Is(err, os.ErrNotExist)` on the result.
2. In Python, write a custom exception hierarchy with `AppError → NotFoundError → UserNotFound, OrderNotFound`. Show that `except NotFoundError` catches both subclasses.
3. In Rust, define a `thiserror` enum with three variants. Use `?` to convert from `std::io::Error` into one of them.
4. Construct a Go error chain four layers deep, then call `errors.Unwrap` four times and print each level. Verify the fourth `Unwrap` returns `nil`.
5. Aggregate three validation failures using `errors.Join` (Go) or `ExceptionGroup` (Python). Show that `errors.Is` / `except*` matches any of them.
6. In Java, throw and catch a chained exception. Print the full chain by walking `getCause()`.
7. In Go, write a deferred close that both logs its own failure *and* preserves the body's error using a named return.
8. In Python, intentionally raise a new exception inside an `except` block. Inspect `__context__` and `__cause__` of the new exception. Then add `from None` and rerun.

---

## Tricky Questions

1. **In Go, what's the difference between `fmt.Errorf("%v", err)` and `fmt.Errorf("%w", err)`?**
   *`%v` produces a string only — the chain is lost. `%w` produces a wrapping error — `errors.Unwrap` returns the original. Use `%w` unless you specifically want to discard the chain (rare and usually wrong).*
2. **Why does `errors.Is` exist if `==` works?**
   *Because `==` only works when the error has not been wrapped. `errors.Is` walks the chain.*
3. **In Python, what's the difference between `raise X from e` and just `raise X` inside an `except` block?**
   *Both set chained context. `from e` sets `__cause__` (explicit). The implicit form sets `__context__` (automatic). Tracebacks render them slightly differently — "The above exception was the direct cause of..." vs "During handling of the above exception, another exception occurred."*
4. **What does `from None` do?**
   *Suppresses chaining. The new exception's `__cause__` is set to `None` and `__suppress_context__` becomes `True`. The traceback skips the "during handling" link.*
5. **Why might `err != nil` be `true` even when the underlying value is `nil`?**
   *Go: a typed nil pointer assigned to an interface variable produces a non-nil interface. The interface contains `(type, value) = (*MyError, nil)`; only the *value* is nil.*
6. **What's the runtime cost of throwing an exception in Java vs returning an error in Go?**
   *Java: capturing the stack trace dominates — often 10-100x slower than a normal return. Go: roughly free; an error is just a pointer-sized value passed through a register-like return.*
7. **When should you NOT wrap an error?**
   *When the wrap adds no information. `"calling Foo: ..."` where the caller is obviously `Foo` is noise.*
8. **What's the right way to test for `sql.ErrNoRows` if your repository wraps DB errors?**
   *`errors.Is(err, sql.ErrNoRows)`. Direct `==` will fail after wrapping.*
9. **In Rust, what does `?` do beyond just propagating?**
   *It calls `From::from` to convert the inner error type. So `fn f() -> Result<_, MyError>` can `?` on a `Result<_, io::Error>` if `From<io::Error> for MyError` exists.*
10. **You see `"error: failed to do X: error: failed to do Y"` in a log. What went wrong?**
   *Someone wrapped an error with both the literal word "error" and a verb, twice. The fix: strip "error" / "failed to" from inner messages; let the structure of the chain speak.*

---

## Cheat Sheet

```text
┌──────────────────────── ERROR WRAPPING ────────────────────────┐
│                                                                │
│   Go:      fmt.Errorf("loading user %d: %w", id, err)          │
│   Python:  raise UserError("loading user 42") from e           │
│   Java:    throw new UserError("loading user 42", cause)       │
│   Rust:    err.context("loading user 42")?         // anyhow   │
│                                                                │
├─────────────────── INSPECTING THE CHAIN ───────────────────────┤
│                                                                │
│   Go:      errors.Is(err, target)   // identity check          │
│           errors.As(err, &target)  // type check               │
│           errors.Unwrap(err)        // one step down           │
│   Python: e.__cause__   e.__context__                          │
│   Java:   t.getCause()  t.getSuppressed()                      │
│   Rust:   e.source()                                           │
│                                                                │
├──────────────── MULTI-ERROR AGGREGATION ───────────────────────┤
│                                                                │
│   Go:      errors.Join(e1, e2, e3)                             │
│   Python:  raise ExceptionGroup("msg", [e1, e2, e3])           │
│   Java:    t.addSuppressed(other)                              │
│   Rust:    Vec<MyError>  /  anyhow chain                       │
│                                                                │
├────────────────────── SENTINELS ───────────────────────────────┤
│                                                                │
│   Go:    io.EOF, sql.ErrNoRows, os.ErrNotExist,                │
│          context.Canceled, context.DeadlineExceeded            │
│   Rust:  io::ErrorKind::NotFound, UnexpectedEof                │
│                                                                │
├──────────────────── THE FIVE W's ──────────────────────────────┤
│                                                                │
│   WHAT  + WHERE + WHILE + WHY  (and WHEN if it adds value)     │
│   Always include the failing VALUE. Never include SECRETS.     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Wrap, don't replace.** Every layer adds context; the original cause stays in the chain.
- **`%w` / `from e` / `new X(msg, cause)` / `.context()`** — the same idea in four costumes.
- **Inspect chains with `errors.Is`, `errors.As`, `__cause__`, `getCause`, `source`.** Never `==`.
- **Sentinels for identity, types for category.** Use both, deliberately.
- **Stack traces aren't free.** Go skips them; you compensate with good wrapping.
- **Multi-errors matter** for validation and batch processing — `errors.Join`, `ExceptionGroup`, `addSuppressed`.
- **Resource cleanup on the error path** has its own failure mode — handle it with `defer` named-returns, suppressed exceptions, or `try-with-resources`.
- **An error message is a sentence.** Read it left-to-right; if it doesn't make sense, your wrapping is wrong.

---

## What You Can Build

1. **A wrapping linter** that flags `return err` without context in Go projects.
2. **A retry middleware** in any language that uses typed errors to decide retryability (`Retryable` trait/interface).
3. **A validation library** that collects all errors per request and renders them as one structured response.
4. **An "error explainer"** CLI that takes a wrapped error string and pretty-prints the chain with arrows.
5. **A test harness** that intentionally fakes errors at every layer of a stack and asserts the final message contains the expected context.
6. **A log enricher** that walks an error chain at log time and emits a structured `causes: [...]` array.

---

## Further Reading

- Go blog — *Working with Errors in Go 1.13*: <https://go.dev/blog/go1.13-errors>
- Go blog — *Errors are values*: <https://go.dev/blog/errors-are-values>
- *Effective Go — Errors* (official): <https://go.dev/doc/effective_go#errors>
- Dave Cheney — *Don't just check errors, handle them gracefully*: <https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully>
- Python docs — *Exception Chaining* (PEP 3134): <https://peps.python.org/pep-3134/>
- PEP 654 — *Exception Groups and except\**: <https://peps.python.org/pep-0654/>
- Rust book — *Error Handling*: <https://doc.rust-lang.org/book/ch09-00-error-handling.html>
- `anyhow` and `thiserror` docs: <https://docs.rs/anyhow> / <https://docs.rs/thiserror>
- Joshua Bloch — *Effective Java*, items on exceptions (3rd ed., items 69-77).
- Brian Goetz — *Java Concurrency in Practice* on exception handling in concurrent code.

---

## Related Topics

- [Error Handling — Junior](junior.md) — the prerequisite for this page.
- [Error Handling — Senior](senior.md) — boundary translation, error policies, error budgets.
- [Error Handling — Professional](professional.md) — errors as API design, observability integration.
- [Error Handling — Interview](interview.md) — sample questions across all levels.
- [Error Handling — Tasks](tasks.md) — hands-on exercises mirroring this page.
- [Debugging — Junior](../debugging/junior.md) — using errors as the starting point for diagnosis.
- [Logging — Junior](../logging/junior.md) — where wrapped errors are ultimately consumed.
- [Go Error Handling Basics](../../languages/golang/05-error-handling/01-error-handling-basics/junior.md) — language-specific deep dive.

---

## Diagrams & Visual Aids

### The error chain across layers

```text
   ┌──────────────────────────────────────────────────────────┐
   │  HTTP Handler:                                           │
   │  "GET /profile failed: <-- top of chain, logged here     │
   │   ┌──────────────────────────────────────────────────┐   │
   │   │  Service:                                        │   │
   │   │  "user service: profile id=42:                   │   │
   │   │   ┌──────────────────────────────────────────┐   │   │
   │   │   │  Repository:                             │   │   │
   │   │   │  "user repo: querying id=42:             │   │   │
   │   │   │   ┌──────────────────────────────────┐   │   │   │
   │   │   │   │  Driver:                         │   │   │   │
   │   │   │   │  sql: no rows in result set"     │   │   │   │
   │   │   │   └──────────────────────────────────┘   │   │   │
   │   │   └──────────────────────────────────────────┘   │   │
   │   └──────────────────────────────────────────────────┘   │
   └──────────────────────────────────────────────────────────┘
   
   reads top-to-bottom as a sentence — each layer added its line.
```

### `errors.Is` vs `errors.As` flow

```text
  err  ── Unwrap ──►  inner1  ── Unwrap ──►  inner2  ── Unwrap ──►  nil
   │                    │                       │
   ▼                    ▼                       ▼
  Is target? ────────► Is target? ───────────► Is target? ──► return false
       │                    │                       │
      yes                  yes                     yes
       └──── return true ────────────────────────────┘
  
  (errors.As is the same walk but tests "does this node implement type T?")
```

### Cleanup on the error path (Go named-return idiom)

```text
   ┌─────────────────────────────────────────────────────────┐
   │  func process(name string) (err error) {                │
   │      f, err := os.Open(name)                            │
   │      if err != nil { return ...; }    ─── primary err   │
   │                                                         │
   │      defer func() {                                     │
   │          cerr := f.Close()                              │
   │          if cerr != nil && err == nil {                 │
   │              err = wrap(cerr)        ─── close err only │
   │          }                              if primary ok   │
   │      }()                                                │
   │                                                         │
   │      return doWork(f)                  ─── body err     │
   │  }                                                      │
   └─────────────────────────────────────────────────────────┘
```

---
