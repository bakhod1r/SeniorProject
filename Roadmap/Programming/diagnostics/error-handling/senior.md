# Error Handling — Senior Level

> **Topic:** [Error Handling Roadmap](README.md)
> **Focus:** System-level error design — boundaries, translation, classification, and the policies that keep production services honest.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Trade-offs](#trade-offs)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Best Practices](#best-practices)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Test Yourself](#test-yourself)
17. [Tricky Questions](#tricky-questions)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [What You Can Build](#what-you-can-build)
21. [Further Reading](#further-reading)
22. [Related Topics](#related-topics)
23. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> 🎓 At the senior level, error handling stops being a feature of *functions* and becomes a feature of *systems*. The question is no longer "how do I report this failure" but "where in the system does this failure become visible, and what does each layer believe about it."

A junior developer learns the syntax of error handling: `try/catch`, `if err != nil`, `Result<T, E>`. A middle developer learns wrapping, typed errors, and stack traces. A **senior** owns the design decisions that every other layer depends on: what counts as an error, who is allowed to translate one, what every HTTP status code in your codebase actually means, when a goroutine is allowed to panic, and how an outage in a downstream service propagates without taking out the whole platform.

This page is about the *policies* of failure. It covers six things every senior must have a firm opinion on: **boundaries** (where domain errors meet protocols), **defensive vs offensive programming** (when to validate, when to trust), **panic policy** (when crashing is correct), **transience classification** (what's retryable and what isn't), **error category systems** (your enum is your API), and **logging discipline** (log once, at the boundary). The next level (`professional.md`) treats errors as a designed product surface; this level is about making them survive contact with production.

If you have ever debugged a system where the same error appeared in the logs fourteen times, where a 500 was returned to the user for a missing record, where retrying a charge created three of them, or where a panic in a request handler killed the entire web server — this page is about preventing those classes of incident.

---

## Prerequisites

- **Required:** Comfortable with `junior.md` and `middle.md` in this folder. You know error wrapping, typed errors, sentinel errors, multi-error aggregation, exception chaining, and stack-trace reading.
- **Required:** You have built or maintained an HTTP service in any language. You know the difference between 4xx and 5xx in principle.
- **Required:** You understand `context.Context` (Go) or `CancellationToken`/`asyncio.CancelledError` in your language of choice.
- **Helpful:** Some exposure to gRPC, GraphQL, or another non-HTTP protocol. You will start seeing the same boundary problem in every protocol once you've seen it twice.
- **Helpful:** A production incident you can mentally point at. This page becomes ten times more useful when you can map each section to a real outage you remember.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Boundary** | A point in the system where one error vocabulary ends and another begins — domain ↔ protocol, internal ↔ external, library ↔ application. |
| **Translation** | Converting one error vocabulary into another at a boundary (e.g. `ErrUserNotFound` → HTTP 404). |
| **Defensive programming** | Validating every input at every layer — useful at trust boundaries, a code smell everywhere else. |
| **Offensive programming** | Trusting your invariants and crashing loudly when they are violated (assertions, panics). |
| **Trust boundary** | A point where data crosses from an untrusted source (user, network) to a trusted one (your domain). Validate here. |
| **Transient error** | A failure that may succeed if retried — timeout, 502, 503, 429, connection reset. |
| **Permanent error** | A failure that will not succeed if retried with the same inputs — 400, 401, 403, 404, 422. |
| **Idempotency** | Property where executing the same request twice has the same effect as executing it once. Required for safe retries. |
| **Error code** | A stable, machine-readable identifier for a class of failure (`USER_NOT_FOUND`, `PAYMENT_DECLINED`). Independent of language or protocol. |
| **Canonical error model** | A finite set of error categories (Google's 16 gRPC codes, Stripe's error types) that every error in the system maps onto. |
| **Error budget** | The amount of error you are *allowed* to ship per quarter under your SLO. The opposite of "zero errors." |
| **Cause chain** | The sequence of wrapped errors from leaf cause to top-level reported error. |
| **Log once** | The principle that a single failure should produce exactly one log entry, at the boundary where it stops propagating. |
| **Panic / abort** | Unrecoverable failure of a goroutine, thread, or process. A bug signal, not an error signal. |
| **Bifurcated error model** | Joe Duffy / Midori's design: bugs and recoverable errors are completely separate concepts with different mechanisms. |

---

## Core Concepts

### 1. The Error Boundary Pattern

The single most important idea at this level: **errors should be translated at exactly one layer, and that layer is the boundary.**

A "boundary" is wherever your code meets something that doesn't speak your error language. The classic examples are:

- **Domain ↔ HTTP** — your `ErrUserNotFound` becomes `HTTP 404 + {"code":"user_not_found"}`
- **Domain ↔ gRPC** — your `ErrPermissionDenied` becomes `codes.PermissionDenied`
- **Domain ↔ GraphQL** — your `ErrValidation` becomes a field in the `errors` array of the response
- **Internal ↔ external** — when you call Stripe and they return their own error vocabulary, you wrap or translate it into yours at the call site

Below the boundary, errors travel as rich domain values (typed, wrapped, with cause chain). At the boundary, they are translated once, deliberately, into the target protocol. Above the boundary, only the protocol's vocabulary exists.

The anti-pattern is *translating early*. A repository function that returns `errors.New("HTTP 404")` has burned a protocol assumption into a layer that has no business knowing one exists. When you decide to expose the same repository over gRPC, you cannot — the error is already pre-translated for HTTP.

### 2. Defensive vs Offensive Programming

Joe Duffy phrases this beautifully: **"You should be defensive at trust boundaries and offensive everywhere else."**

- **Defensive at trust boundaries.** Where data enters from untrusted sources — user input, network requests, file contents, foreign processes — you validate everything. You assume the input is malicious or malformed and prove otherwise. Failures here are *expected* errors and produce 4xx responses.
- **Offensive internally.** Once data is inside your domain, you trust your invariants. If a function takes a `User`, the caller has already validated that the user exists and has a valid email. The function does not re-check. If somehow it receives a `nil` or invalid `User`, that's a bug — and you crash with an assertion, not handle it with a graceful return.

The naive instinct is to defend everywhere. This produces the codebase where every function starts with twelve `if (arg == null) return ...` lines, none of which can actually happen, all of which add cyclomatic complexity, and exactly one of which silently swallows a real bug. Defensive programming as a universal rule is a code smell.

### 3. When to Panic, Abort, or Kill the Process

Tony Hoare called nullable types his "billion-dollar mistake." A related billion-dollar mistake is treating bugs and errors as the same thing. Joe Duffy's work on Midori formalized the difference:

- **Recoverable errors** (file not found, validation failure, network timeout) — *expected*, returned as values, handled with `Result` / `error` / typed exceptions. The caller has a real choice about what to do.
- **Bugs** (null where non-null was promised, off-by-one, invariant violation) — *unexpected*, crash the unit of isolation, never caught. The caller has no useful response; the only honest action is to stop and let supervision restart.

In Go, the typical correct uses of `panic` are:

1. Programmer mistakes detected at runtime (`panic("unreachable")`, `panic("invariant violated")`).
2. `panic`/`recover` in HTTP middleware — to prevent a goroutine panic from killing the entire process — followed by an immediate 500 response and a log.
3. Initialization failures where the program cannot run (`log.Fatal` is morally similar).

In Rust, `panic = "abort"` in release builds is increasingly common — once you crash, you crash hard rather than unwinding, because the process is no longer in a trusted state. Java distinguishes `Error` (OutOfMemoryError, StackOverflowError — do not catch) from `Exception` (recoverable). Python's `BaseException` is the ancestor of `SystemExit` and `KeyboardInterrupt` — which is why catching `Exception` is correct and catching `BaseException` is a bug that hangs your Ctrl-C.

### 4. Transient vs Permanent Errors and Retry Policy

Every error your service emits or consumes can be classified into:

- **Transient** — retry might help. Network timeouts, 502/503/504, 429 rate-limit, `ECONNRESET`, database deadlock retry codes.
- **Permanent** — retry will not help. 400 bad request, 401/403 auth, 404 not found, 422 validation, schema violation.

The classification drives behavior at the calling site: transient errors enter the retry/backoff loop; permanent errors propagate immediately. Retrying a 400 is wasted work and noisy logs; not retrying a 503 is a fragile system.

But classification is not enough. **Retrying non-idempotent operations is dangerous.** If `POST /charges` times out, did the charge succeed or not? You cannot tell from the client. Retrying creates duplicate charges. The fix is *idempotency keys* on the server side — the client sends a key, the server records that key with the result on first execution, and subsequent attempts with the same key return the same response without re-executing.

For the actual mechanics of retry — exponential backoff, jitter, max attempts, max elapsed time — see the [retry-pattern skill](../../../../README.md). For protecting downstream services from retry storms when they're already down, see the [circuit-breaker-pattern skill](../../../../README.md). They are siblings to this topic, not duplicates.

### 5. Error Category Systems

Once you have more than one service, ad-hoc error strings become a liability. You need a **closed set of categories** that everything maps onto.

Two well-known examples:

- **Google's canonical error codes** — sixteen codes (`OK`, `CANCELLED`, `UNKNOWN`, `INVALID_ARGUMENT`, `DEADLINE_EXCEEDED`, `NOT_FOUND`, `ALREADY_EXISTS`, `PERMISSION_DENIED`, `RESOURCE_EXHAUSTED`, `FAILED_PRECONDITION`, `ABORTED`, `OUT_OF_RANGE`, `UNIMPLEMENTED`, `INTERNAL`, `UNAVAILABLE`, `DATA_LOSS`, `UNAUTHENTICATED`). Used by gRPC and Google APIs. Comes with a `Status` proto carrying `code`, `message`, and `details` (typed error payloads).
- **Stripe's error model** — `type` (`api_error`, `card_error`, `invalid_request_error`, etc.) + `code` (`card_declined`, `expired_card`) + `decline_code` for the leaf reason. Plus idempotency keys per request.

Roll your own when needed, but borrow the discipline: **a finite, documented list, mapped to behavior** (retryable? user-facing? log level?). Your error code is part of your API contract — breaking it is a versioning event.

A small monolith does not need this; a multi-service backend dies without it.

### 6. Cancellation and Timeout as Errors

Cancellation is an error category seniors often underestimate. When a request is cancelled — by the client, by a timeout, by a parent goroutine — every downstream call should observe that cancellation and stop. The vocabulary is:

- Go — `context.Canceled` (parent cancelled) and `context.DeadlineExceeded` (timeout expired). Functions accept `ctx context.Context` and check `ctx.Err()`.
- Python — `asyncio.CancelledError`, raised at any `await` when the task is cancelled. *Never* suppress this; re-raise it after cleanup.
- Java — `InterruptedException`, possibly the most misdesigned error in the JDK. You catch it, restore the interrupt flag with `Thread.currentThread().interrupt()`, and propagate.
- Rust (tokio) — `tokio::time::error::Elapsed` from `timeout(...)`, and `JoinError::is_cancelled()` from cancelled tasks.

Cancellation is not "failure" in the usual sense — it is the *correct* response to the caller no longer wanting an answer. Logging it as an error pollutes alerting; logging it at INFO with a correlation id is usually right.

### 7. Error Budgets and SLO Reasoning

If your service has a 99.9% SLO, you are *allowed* 43 minutes of error per month. Not every error should page someone. The job of error handling at this level is partly *triage*: which errors burn budget (real customer impact) and which are noise (cancellation, expected validation, client misbehavior).

The discipline is to classify errors by SLI impact at the moment you log them. Validation failures are not budget burn; database connection exhaustion is. See the [monitoring-alerting skill](../../../../README.md) for the SRE side of this.

### 8. Log Once, at the Boundary

The most common production anti-pattern is **log and propagate**. Each layer catches the error, logs it ("for visibility"), then re-throws. By the time the error reaches the HTTP boundary, it has been logged five times — once by the repository, once by the service, once by the use case, once by the controller, and once by the global error handler. Your logs are unreadable, your log volume is 5x what it should be, and you cannot grep for a unique failure.

The rule: **log exactly once, at the boundary where the error stops propagating**, with the full cause chain and trace id. Below the boundary, errors *propagate*. They do not *log*. The only exception is when adding context that the boundary cannot reconstruct (e.g. the exact query parameters at the repository level might be worth attaching as fields to the wrapped error — but still not logged until the boundary).

---

## Real-World Analogies

| Concept | Real-world analogy |
|---------|--------------------|
| Boundary translation | Customs at an international airport — your domestic ID becomes a passport stamp; you don't issue stamps in the kitchen. |
| Defensive at trust boundary | Airport security screens passengers entering the terminal once, not at every gate inside it. |
| Offensive internally | Pilots trust the pre-flight checklist completed once; they don't re-verify the wheels exist mid-flight. |
| Panic for bugs | Pulling the emergency brake on a train — only when continuing is more dangerous than stopping. |
| Transient vs permanent | "The line is busy, try again" vs "this number is disconnected." |
| Idempotency key | The receipt number you give the deli — "if I already paid for this sandwich, don't charge me again." |
| Canonical error codes | ICD-10 medical codes — a finite shared vocabulary so any doctor anywhere can read the chart. |
| Error budget | A monthly data plan — you have a quota of degradation; spend it where it matters, not on noise. |
| Log once at boundary | One incident report filed by the responding officer, not five reports filed by every witness who passed it on. |

---

## Mental Models

### The Vocabulary Stack

Think of your system as a stack of error vocabularies:

- **Wire vocabulary** — HTTP status codes, gRPC codes, GraphQL `errors[]`. Coarse, protocol-defined.
- **API vocabulary** — your published error codes (`USER_NOT_FOUND`). Documented, versioned, finite.
- **Domain vocabulary** — typed errors inside your code (`ErrUserNotFound`, `PaymentDeclinedError`). Rich, in-process, can be inspected.
- **Infrastructure vocabulary** — driver errors, kernel errors, system call errors. Noisy, low-level.

A request enters at the top (wire), descends through the stack, encounters an error somewhere down low, and translation maps each layer's vocabulary back up. Your job as designer is to draw the translation lines clearly so every error knows which vocabulary it belongs to at every point.

### The "Who Reads This Message" Question

For every error you create, ask three things:

1. **Who is the user-facing audience?** End users get short, calm, non-technical messages ("We couldn't find that page.").
2. **Who is the developer-facing audience?** Other engineers reading the API response get a code + reason ("`USER_NOT_FOUND`, no user with id 42").
3. **Who is the operator-facing audience?** SREs reading your logs get the full cause chain, trace id, request fields, severity.

The same error often produces all three messages, but they are *not the same string*. The user does not need the cause chain; the operator does not need the user-facing message in the log line because it strips signal.

### Errors as Data, Not Events

A senior treats errors as *data structures with stable shape*, not as ephemeral events. The shape includes: code, type, message, cause, context fields, trace id. Treating them this way makes them grep-able, alert-able, version-able, and testable. Treating them as ephemeral strings makes them debuggable only by humans reading log files at 3am.

---

## Code Examples

The same domain error — "the requested user does not exist" — translated identically across four boundary protocols.

### Go: HTTP boundary translation with `net/http` + `log/slog`

```go
package main

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
)

// Domain error — no HTTP knowledge.
var ErrUserNotFound = errors.New("user not found")

type DomainError struct {
	Code    string
	Message string
	Err     error
}

func (e *DomainError) Error() string { return e.Message }
func (e *DomainError) Unwrap() error { return e.Err }

func findUser(id string) (string, error) {
	if id != "42" {
		return "", &DomainError{Code: "USER_NOT_FOUND", Message: "no user with that id", Err: ErrUserNotFound}
	}
	return "Alice", nil
}

// Boundary: translate domain errors to HTTP exactly here.
func userHandler(logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name, err := findUser(r.URL.Query().Get("id"))
		if err != nil {
			writeError(w, logger, r, err)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"name": name})
	}
}

func writeError(w http.ResponseWriter, log *slog.Logger, r *http.Request, err error) {
	var de *DomainError
	switch {
	case errors.As(err, &de) && errors.Is(err, ErrUserNotFound):
		log.InfoContext(r.Context(), "user not found", "code", de.Code, "path", r.URL.Path)
		writeJSON(w, http.StatusNotFound, map[string]string{"code": de.Code, "message": "user not found"})
	default:
		log.ErrorContext(r.Context(), "unhandled error", "err", err, "path", r.URL.Path)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"code": "INTERNAL", "message": "internal error"})
	}
}

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	http.HandleFunc("/user", userHandler(logger))
	_ = http.ListenAndServe(":8080", nil)
}
```

Notice: `findUser` returns a domain error; `writeError` is the only place that knows about HTTP status codes. `log/slog` writes the error once, with structured fields.

### Python: FastAPI boundary translation

```python
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
import logging
import structlog

structlog.configure(processors=[structlog.processors.JSONRenderer()])
log = structlog.get_logger()

class DomainError(Exception):
    code: str
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code

class UserNotFound(DomainError):
    def __init__(self, user_id: str):
        super().__init__("USER_NOT_FOUND", f"no user with id {user_id}")

def find_user(user_id: str) -> str:
    if user_id != "42":
        raise UserNotFound(user_id)
    return "Alice"

app = FastAPI()

# Boundary: one handler translates the whole domain-error family.
@app.exception_handler(DomainError)
async def domain_error_handler(request: Request, exc: DomainError):
    if isinstance(exc, UserNotFound):
        log.info("user_not_found", code=exc.code, path=request.url.path)
        return JSONResponse(status_code=404, content={"code": exc.code, "message": "user not found"})
    log.error("unhandled_domain_error", code=exc.code, path=request.url.path, exc_info=exc)
    return JSONResponse(status_code=500, content={"code": "INTERNAL", "message": "internal error"})

@app.get("/user")
def user_endpoint(id: str):
    name = find_user(id)
    return {"name": name}
```

The handler is a single boundary translator. `find_user` does not import FastAPI; it raises a domain exception and trusts the boundary to do the right thing.

### Java: Spring Boot `@ControllerAdvice` boundary

```java
package demo;

import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.slf4j.*;

import java.util.Map;

@RestController
class UserController {
    @GetMapping("/user")
    public Map<String, String> get(@RequestParam String id) {
        if (!"42".equals(id)) {
            throw new UserNotFoundException(id);
        }
        return Map.of("name", "Alice");
    }
}

class DomainException extends RuntimeException {
    final String code;
    DomainException(String code, String msg) { super(msg); this.code = code; }
}

class UserNotFoundException extends DomainException {
    UserNotFoundException(String id) { super("USER_NOT_FOUND", "no user with id " + id); }
}

@RestControllerAdvice
class ErrorBoundary {
    private static final Logger log = LoggerFactory.getLogger(ErrorBoundary.class);

    @ExceptionHandler(UserNotFoundException.class)
    ResponseEntity<Map<String, String>> notFound(UserNotFoundException ex) {
        log.info("user_not_found code={} ", ex.code);
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
            .body(Map.of("code", ex.code, "message", "user not found"));
    }

    @ExceptionHandler(Throwable.class)
    ResponseEntity<Map<String, String>> internal(Throwable ex) {
        log.error("unhandled", ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(Map.of("code", "INTERNAL", "message", "internal error"));
    }
}
```

The controller throws the domain exception. `@RestControllerAdvice` is the single boundary that maps every exception type to a status code and a body.

### Rust: axum boundary translation

```rust
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, routing::get, Json, Router};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{error, info};

#[derive(Debug, Error)]
enum DomainError {
    #[error("no user with id {0}")]
    UserNotFound(String),
}

#[derive(Serialize)]
struct ApiError { code: &'static str, message: &'static str }

impl IntoResponse for DomainError {
    fn into_response(self) -> Response {
        match &self {
            DomainError::UserNotFound(id) => {
                info!(code = "USER_NOT_FOUND", id = %id, "user not found");
                (StatusCode::NOT_FOUND, Json(ApiError { code: "USER_NOT_FOUND", message: "user not found" })).into_response()
            }
        }
    }
}

#[derive(Deserialize)]
struct UserQuery { id: String }

async fn user(Query(q): Query<UserQuery>) -> Result<Json<serde_json::Value>, DomainError> {
    if q.id != "42" { return Err(DomainError::UserNotFound(q.id)); }
    Ok(Json(serde_json::json!({"name": "Alice"})))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let app = Router::new().route("/user", get(user));
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

`IntoResponse` is the trait that *is* the boundary. The handler returns `Result<_, DomainError>` and Rust's type system enforces the translation at the only correct place.

### Go: gRPC boundary translation

```go
package main

import (
	"context"
	"errors"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

var ErrUserNotFound = errors.New("user not found")

type UserServer struct{}

func (s *UserServer) GetUser(ctx context.Context, req *GetUserRequest) (*GetUserResponse, error) {
	user, err := s.findUser(ctx, req.GetId())
	if err != nil {
		return nil, toGRPCStatus(err) // boundary translation, once.
	}
	return &GetUserResponse{Name: user}, nil
}

func toGRPCStatus(err error) error {
	switch {
	case errors.Is(err, ErrUserNotFound):
		return status.Error(codes.NotFound, "user not found")
	case errors.Is(err, context.Canceled):
		return status.Error(codes.Canceled, "request cancelled")
	case errors.Is(err, context.DeadlineExceeded):
		return status.Error(codes.DeadlineExceeded, "deadline exceeded")
	default:
		return status.Error(codes.Internal, "internal error")
	}
}
```

Same shape, different vocabulary. The domain function does not know about gRPC; `toGRPCStatus` is the single translation point. If you re-expose the same domain over both HTTP and gRPC, you get two boundary translators and zero domain code changes.

---

## Trade-offs

| Decision | Pro | Con |
|----------|-----|-----|
| Translate at boundary only | Domain stays protocol-agnostic; multiple protocols cheap | Slightly more layered code; needs discipline |
| Closed error code enum | Finite, documented, alertable | Schema changes are an API event |
| Open string codes | Cheap to add new errors | Unbounded growth, no compile-time check |
| Panic on invariant violation | Bugs surface immediately, restart restores sanity | Loud incidents; requires good supervision |
| Catch broadly, return 500 | Service stays up | Hides bugs that should crash the process |
| Aggressive retry with backoff | Smooths over transient blips | Amplifies downstream outages; requires idempotency |
| No retries at all | Never doubles a side effect | Customer sees every transient blip |
| Log at every layer | "Maximum visibility" | 5x log volume, unreadable, expensive |
| Log once at boundary | Clean signal, cheap to operate | Requires team discipline + reviews |

---

## Use Cases

- **Payment platforms.** Stripe-style idempotency keys + canonical error codes + structured error responses are mandatory; double-charge incidents are existential.
- **Multi-protocol APIs.** A service exposed over HTTP and gRPC simultaneously cannot afford pre-translated errors in the domain.
- **Background job runners.** Transient vs permanent classification drives retry-vs-dead-letter routing.
- **Event-driven systems.** Boundary translation happens at every consumer; logging discipline matters more because consumers are silent until they fail.
- **High-uptime services.** SLO budgets force error classification at logging time, not at alerting time.
- **Mobile and web clients calling your API.** Stable error codes are the difference between clients shipping fixes vs guessing from message strings.

---

## Coding Patterns

### The Single Error Boundary

One function, decorator, middleware, or trait implementation handles *all* translation for a layer. Examples: Spring's `@ControllerAdvice`, FastAPI's `exception_handler`, axum's `IntoResponse`, Go's HTTP middleware that calls `writeError`. If a second boundary appears, refactor.

### Sentinel + Wrap

Define sentinel errors (`var ErrUserNotFound = errors.New(...)`) at the domain layer. Wrap them with context as they propagate (`fmt.Errorf("loadUser %s: %w", id, err)`). The boundary uses `errors.Is(err, ErrUserNotFound)` to classify and translate.

### Error Code Enum + Map

```go
type Code string
const (
    CodeUserNotFound   Code = "USER_NOT_FOUND"
    CodePaymentDeclined Code = "PAYMENT_DECLINED"
)

var httpStatusByCode = map[Code]int{
    CodeUserNotFound:   404,
    CodePaymentDeclined: 402,
}
```

Now translation is a map lookup, and adding a new error is a single-line table edit.

### Panic-and-Recover Middleware

```go
func Recover(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                slog.ErrorContext(r.Context(), "panic", "value", rec, "stack", debug.Stack())
                http.Error(w, "internal error", 500)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

Pure defense against bugs killing the process. Not a substitute for fixing the panic.

### Idempotency Key Storage

Server receives `Idempotency-Key: <uuid>`; checks a key→result store. If present, return the recorded response; if absent, execute, then record `key → (status, body)`. TTL the records (24h is typical). This makes safe-to-retry-POST a property of the server, not the client.

### Retry With Jitter (sketch — see retry-pattern skill)

```python
import random, time
def retry(call, max_attempts=5, base=0.1, cap=10.0):
    for attempt in range(max_attempts):
        try:
            return call()
        except TransientError:
            if attempt == max_attempts - 1: raise
            sleep = min(cap, base * 2**attempt)
            time.sleep(sleep * (0.5 + random.random()))  # full jitter
```

---

## Clean Code

- Translate errors **once**, at the boundary.
- Log errors **once**, where they stop propagating.
- Domain code imports zero protocol packages.
- Every error has a **code**, a **message**, and a **cause**. Pick a shape and keep it.
- Distinguish **expected errors** (return normally) from **bugs** (panic / abort / assertion).
- Validate at the **trust boundary**. Trust inside.
- Never `catch (Exception)` without re-throwing, logging, or knowing exactly why.
- Never swallow `CancelledError`, `InterruptedException`, `context.Canceled`. Propagate or re-raise.
- Tests should cover the boundary translation table, not just the happy path.
- If an error message ends with `"...: %s"` and a raw downstream string, you have not designed the error — you have leaked it.

---

## Best Practices

1. **Document your error codes as part of your API.** Treat them with the same versioning rigor as your URL paths.
2. **Map every HTTP status used in your codebase to a domain reason.** No surprise 418s; no 500s that are actually 422s.
3. **Use 4xx for "the client is wrong" and 5xx for "we are wrong."** Never use 5xx for validation failure or auth failure.
4. **Reserve 429 for rate-limit responses only.** Return `Retry-After`.
5. **Idempotency keys for every non-idempotent endpoint.** No exceptions for "internal" services — internal callers retry too.
6. **Never retry without classifying the error first.** A retry loop on permanent errors is a denial-of-service on yourself.
7. **Cap retries with both max attempts *and* max elapsed time.** A flat 5 attempts can still take minutes with exponential backoff.
8. **Add jitter to every backoff.** Synchronized retry storms are a classic cascade trigger.
9. **Distinguish operator-facing logs from user-facing messages.** They are different audiences and different strings.
10. **Trace id on every error log.** Without it, you cannot correlate the log line to the request.
11. **One log per failure.** Audit your codebase: grep for `logger.error` and ask each occurrence "why doesn't the boundary do this?"
12. **Cancellation is information, not failure.** Log at INFO, not ERROR.
13. **Crash on invariant violation in production.** A process restart is cheaper than a silent corruption.
14. **Test the error path.** A test suite that only tests success is a test suite that lies about coverage.

---

## Edge Cases & Pitfalls

- **`errors.Is` vs `errors.As` confusion (Go).** `Is` for sentinel identity, `As` for typed extraction. Forgetting `As` for typed wrappers is a common bug.
- **Exception chaining lost in Java/Python.** Catching and re-raising without `cause=e` (Python) or `new X(msg, e)` (Java) loses the cause chain and the stack trace below.
- **Panic in a goroutine you didn't supervise.** Go panics in goroutines you didn't `defer recover()` will kill the whole process — including the HTTP server. Every spawned goroutine needs an owner who recovers.
- **`Future` swallowing errors (Java).** A `CompletableFuture` that fails without anyone calling `get()` or `whenComplete` silently drops the exception. Always attach an exception handler.
- **`asyncio` swallowing errors (Python).** Same problem — a task that fails without anyone awaiting it logs a warning *if you're lucky* and silently disappears otherwise. Use `asyncio.gather(..., return_exceptions=True)` or explicit `task.add_done_callback`.
- **`Result` ignored in Rust.** `#[must_use]` helps but doesn't catch `let _ = fallible();`. Reviewer discipline matters.
- **404 for "I don't have permission to tell you."** Some APIs return 404 instead of 403 to avoid leaking existence — a deliberate design trade-off, document which you do.
- **Treating `context.DeadlineExceeded` as a bug.** It's the *correct* error when the deadline expires. Log it at INFO and propagate it; do not page on it.
- **Catching `KeyboardInterrupt` in Python.** `except Exception:` does not catch it (good); `except BaseException:` does (bad, hangs your Ctrl-C).
- **Retrying with the same idempotency key into a different endpoint.** Idempotency is scoped to the URL + method + key triplet; reusing keys cross-endpoint is a bug.

---

## Common Mistakes

1. **Log-and-throw.** Same error logged at every layer; logs are unreadable; nobody notices the duplicate because each call site looks reasonable in isolation.
2. **Translating to HTTP inside the repository.** Now the repo can't be reused over gRPC, in a CLI, or in a job runner.
3. **Returning 500 for missing records.** The classic; 404 is correct; 500 will page your on-call at 3am.
4. **Catching `Exception` and continuing silently.** "Just to be safe." Now your background job has been failing for three weeks and nobody knew.
5. **Retrying POSTs without idempotency.** Double charges, double sends, double emails. The most expensive class of incident in this list.
6. **Synchronized backoff (no jitter).** A coordinated retry storm hammers a recovering downstream and triggers a fresh outage.
7. **Recovering from `panic` and pretending nothing happened.** Recover, log with stack, return 500, and continue — but the panic is a *bug ticket*, not a feature.
8. **Treating cancellation as failure.** Cancelled requests page the on-call; on-call learns to ignore the alert; real outage is ignored too.
9. **Inventing a new error code per call site.** Eight hundred error codes, all unique, all undocumented. Equivalent to no error codes.
10. **Wrapping every error with `Internal` at every layer.** Erases the original cause; debugging requires reading source code.
11. **Not testing the failure path.** "It works in dev." Yes, because dev never times out.
12. **Mixing user-facing and operator-facing strings.** End user sees a stack trace; SRE sees "An error occurred."

---

## Tricky Points

- **Idempotency is about the *server side*, not the client side.** The client supplying the key is a small part; the server *storing key → result* is the actual mechanism.
- **`PUT` is idempotent by definition; `POST` is not.** Senior reviewers will challenge a retryable `POST` and ask for the idempotency strategy.
- **A 503 with `Retry-After` is a *cooperative* signal.** Clients that respect it smooth the recovery; clients that ignore it cause the outage to last longer.
- **`409 Conflict` vs `422 Unprocessable Entity`.** 409 is "you violated the resource's current state" (concurrent edit); 422 is "your request is syntactically valid but semantically wrong" (validation). Mis-mapping these is a tell of inexperience.
- **`401 Unauthorized` is "we don't know who you are"; `403 Forbidden` is "we know who you are, you can't do this."** Confusing them breaks client retry logic.
- **`grpc.codes.Unavailable` is *retryable*; `codes.FailedPrecondition` is not.** Memorize which codes are retryable per the gRPC spec.
- **GraphQL puts errors in two places.** Transport errors (the request couldn't be parsed) use HTTP status; field-level errors appear in `errors[]` *with the partial data*. Returning a 500 from a GraphQL handler when one field failed is wrong.
- **Logging `err.Error()` loses the cause chain in Go.** Use `slog`'s `err` key with a logger that walks `Unwrap()` (or log the wrapped error and let the formatter do it).
- **Java's `try-with-resources` suppresses secondary exceptions onto the primary.** Use `e.getSuppressed()` to recover them; otherwise you'll debug a `RuntimeException` that's hiding the real `SQLException`.
- **Rust's `?` operator requires `From` impls.** Adding a new error type to a function changes its signature; the type system makes you keep translation consistent.

---

## Test Yourself

1. A junior on your team writes a repository function that returns `errors.New("HTTP 404: user not found")`. Explain in two minutes why that's wrong and what they should do instead.
2. Your service has an endpoint `POST /transfers`. Design the retry + idempotency strategy that prevents double transfers under network failure.
3. Audit a real service you've worked on: how many times is the same error logged on a single failed request? Where would you remove the duplicates?
4. Map every HTTP status code your codebase emits to a domain reason. Are there any 500s that should be 4xx? Any 4xx that should be 500s?
5. Design the error response body for your API: what fields are required, what's optional, what's the JSON shape? Defend each field against "we don't need this."
6. A goroutine you spawned panics. Walk through what happens to the rest of the process, line by line.
7. Your downstream rate-limits you with 429. What does your retry loop do? What is `Retry-After`? What happens if a hundred replicas all retry simultaneously?
8. Pick three real exceptions from your language's standard library and classify each as transient vs permanent vs neither.

---

## Tricky Questions

1. **Q: When is `404` the wrong response for a missing record?**
   When the absence reveals private information. A "this username is taken" check via 404/200 can enumerate accounts. Return a consistent 200 with `{"available": bool}` or require auth.

2. **Q: Why is `log.Fatal` in a library a code smell?**
   `log.Fatal` calls `os.Exit`. A library has no business deciding to terminate the host process. Return an error; let the caller decide.

3. **Q: When is `panic` actually correct in Go production code?**
   For programmer mistakes detected at runtime (`panic("unreachable")`), as a guard in HTTP middleware (`recover` → 500), and at init time when the program cannot run. Not for expected errors.

4. **Q: A request times out at your service. The downstream did not respond. Did the downstream operation succeed?**
   You don't know. That's the whole problem. The fix is server-side idempotency keys so the client can safely retry and the server deduplicates.

5. **Q: Why is `catch (Exception e) { log.error(e); throw e; }` an anti-pattern?**
   Because the boundary will also log it. You have produced two log entries for one failure. Either log here *or* propagate; not both.

6. **Q: gRPC `codes.Aborted` vs `codes.FailedPrecondition` vs `codes.Unavailable` — which is retryable?**
   `Aborted` is retryable at a higher level (transaction retry); `FailedPrecondition` is not (caller must change state first); `Unavailable` is retryable with backoff.

7. **Q: Your endpoint validates input, then calls the database. The DB raises a unique-constraint violation that maps to your validation. 400 or 409?**
   409 Conflict. The request was syntactically valid; the conflict is with current state. 400 implies the request itself is malformed.

8. **Q: You add a new error code. Is that a breaking change?**
   It's a *minor* change for clients that match on known codes and fall through to a default. It's a *breaking* change for clients that exhaustively switch and would compile-fail on the new variant. Document the policy.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                       ERROR TRANSLATION TABLE                                │
├──────────────────────┬──────┬──────────────────────┬──────────┬─────────────┤
│ Domain reason        │ HTTP │ gRPC                 │ Log lvl  │ Retry?      │
├──────────────────────┼──────┼──────────────────────┼──────────┼─────────────┤
│ ValidationFailed     │ 422  │ InvalidArgument      │ INFO     │ No          │
│ Malformed request    │ 400  │ InvalidArgument      │ INFO     │ No          │
│ Unauthenticated      │ 401  │ Unauthenticated      │ INFO     │ No          │
│ Forbidden            │ 403  │ PermissionDenied     │ INFO     │ No          │
│ NotFound             │ 404  │ NotFound             │ INFO     │ No          │
│ Conflict / duplicate │ 409  │ AlreadyExists        │ INFO     │ No          │
│ RateLimited          │ 429  │ ResourceExhausted    │ WARN     │ Yes, after  │
│ Cancelled            │ 499  │ Cancelled            │ INFO     │ No          │
│ DeadlineExceeded     │ 504  │ DeadlineExceeded     │ INFO     │ Maybe       │
│ DownstreamUnavailable│ 503  │ Unavailable          │ WARN     │ Yes+backoff │
│ Bug / unknown        │ 500  │ Internal             │ ERROR    │ No          │
└──────────────────────┴──────┴──────────────────────┴──────────┴─────────────┘

PANIC POLICY                              LOG POLICY
─────────────                             ─────────
Panic for: bugs, invariants               Log: once, at boundary
Recover in: middleware, supervisors       Fields: code, type, cause, trace_id
Never recover from: OOM, stack overflow   Level: see table; cancel = INFO
                                          Never: "log AND propagate"

RETRY POLICY                              IDEMPOTENCY
─────────────                             ───────────
Classify first (transient/permanent)      Per (method, path, key)
Exponential backoff + jitter              Store result for TTL (24h typical)
Cap attempts AND elapsed time             Required for all non-idempotent POSTs
Cooperate with Retry-After                Client retry safe iff server records key
```

---

## Summary

- Errors at the senior level are a **system design problem**, not a syntax problem.
- The **boundary** is the only place you translate between vocabularies — domain ↔ protocol.
- Be **defensive at trust boundaries**, **offensive everywhere else**. Validate input; trust invariants.
- **Bugs** crash the unit of isolation; **errors** propagate as values. The two are not interchangeable.
- Classify every error as **transient or permanent** before deciding to retry.
- Retrying non-idempotent operations needs **server-side idempotency keys**.
- Adopt a **closed error-code enum** as part of your API contract; treat additions as versioning events.
- **Log once, at the boundary**, with code + type + cause + trace id. Never log-and-throw.
- Cancellation and deadlines are **expected events**, not failures. Log at INFO; do not page.
- Map every HTTP status in your codebase to a domain reason. 4xx is *the client*; 5xx is *us*.

---

## What You Can Build

- A **shared error library** for a multi-service backend: typed errors, a closed code enum, HTTP + gRPC translators, structured logging fields. Standardize once, import everywhere.
- An **idempotency-key middleware** that any handler can opt into with a single annotation, backed by Redis with TTL.
- A **retry + circuit-breaker client wrapper** around `http.Client` (or `requests`, or `reqwest`) that classifies, retries, and short-circuits — and emits metrics per error class.
- A **boundary-translator test harness**: given a domain error, assert the HTTP and gRPC translation. Catches regressions when adding new error types.
- A **lint rule or codemod** that flags `log AND return` patterns in your codebase.
- A **synthetic error injection** harness for game-days: deterministically inject 503s, timeouts, and cancellations into a known path and observe the system's behavior.

---

## Further Reading

- Joe Duffy — *The Error Model* (blog post, 2016). The single best long-form essay on bugs vs errors.
- Google — *API Improvement Proposals: Errors* (https://google.aip.dev/193). The canonical error model in detail.
- Stripe — *Error handling* docs and *Idempotent requests* guide. Production-grade reference.
- Tony Hoare — *Null References: The Billion Dollar Mistake* (talk, 2009).
- Andrew Gerrand — *Errors are values* (Go blog, 2015).
- Niko Matsakis — *The `?` operator and From conversions* (Rust blog history).
- Brian Goetz — *Java Concurrency in Practice* — the `InterruptedException` chapter.
- Aleksey Shipilëv — *Stack Walking in the Wild* (JVMLS talk). Stack-trace truths.
- Google SRE Workbook — *Embracing Risk* and *Service Level Objectives* chapters. Why error budgets exist.
- Heroku — *The 12-Factor App: Logs*. One-stream logging discipline.
- IETF RFC 9110 — HTTP Semantics. Authoritative on status-code meaning.
- gRPC docs — *Status codes and their use in gRPC*.

---

## Related Topics

- [Error Handling — Junior](junior.md) — fundamentals: models, syntax, the four families.
- [Error Handling — Middle](middle.md) — wrapping, typed errors, multi-error, sentinel design.
- [Error Handling — Professional](professional.md) — error API as a designed product surface.
- [Error Handling — Interview](interview.md) — questions seniors get asked about this material.
- [Error Handling — Tasks](tasks.md) — exercises that build the senior intuitions.
- [Debugging](../debugging/README.md) — the runtime cousin: when error handling failed, how do you find out why?
- [Logging](../logging/README.md) — the substrate of "log once at the boundary."
- [Clean Code — Error Handling](../../code-craft/clean-code/06-error-handling/README.md) — the chapter-7-of-Clean-Code distillation.

---

## Diagrams & Visual Aids

### The Boundary

```text
                ┌─────────────────────────────────────────────────┐
                │              HTTP / gRPC / GraphQL              │
   client ◄────►│        (wire vocabulary: status codes)          │
                └────────────────────┬────────────────────────────┘
                                     │  TRANSLATION (one place)
                ┌────────────────────▼────────────────────────────┐
                │            BOUNDARY HANDLER / ADVICE            │
                │  - maps DomainError -> wire response            │
                │  - logs once with trace_id + cause chain        │
                └────────────────────┬────────────────────────────┘
                                     │  rich domain errors
                ┌────────────────────▼────────────────────────────┐
                │           Application / Use-case layer          │
                │  - composes domain operations                   │
                │  - may wrap with context                        │
                └────────────────────┬────────────────────────────┘
                                     │
                ┌────────────────────▼────────────────────────────┐
                │            Repository / Infrastructure          │
                │  - returns ErrUserNotFound, ErrDBUnavailable    │
                │  - knows zero protocol details                  │
                └─────────────────────────────────────────────────┘
```

### Request Lifecycle with Retry, Breaker, Boundary

```text
   client                gateway              boundary             domain        downstream
     │                      │                    │                    │              │
     ├──── POST /pay ──────►│                    │                    │              │
     │   Idempotency-Key:K  │                    │                    │              │
     │                      ├────── call ───────►│                    │              │
     │                      │                    ├──── charge() ─────►│              │
     │                      │                    │                    ├──── HTTP ───►│
     │                      │                    │                    │     X TIMEOUT│
     │                      │                    │                    │◄─Transient ──┤
     │                      │                    │                    │              │
     │                      │                    │                    ├── retry (1) ►│
     │                      │                    │                    │  +backoff+ji │
     │                      │                    │                    │◄──── 200 ────┤
     │                      │                    │◄─── ChargeOK ──────┤              │
     │                      │◄── 200 + body ─────┤                    │              │
     │◄─── 200 OK ──────────┤  (1 log entry,     │                    │              │
     │                      │   at boundary)     │                    │              │
     │                      │                    │                    │              │
     │ -- next, downstream stays bad: breaker opens --                │              │
     │                      │                    │                    ├──fail─►OPEN──┤
     │                      │                    │◄── Unavailable ────┤              │
     │                      │◄── 503+Retry-After─┤  (NO call attempted)              │
     │◄─── 503 ─────────────┤   1 log: code=UNA, │                    │              │
     │  client backs off,   │   level=WARN       │                    │              │
     │  retries with K      │                    │                    │              │
     │                      │   (server replays  │                    │              │
     │                      │   recorded result  │                    │              │
     │                      │   for key K — no   │                    │              │
     │                      │   double charge)   │                    │              │
```

### The Log-Once Principle

```text
  WRONG: log-and-throw                       RIGHT: log-once-at-boundary

  controller   ─ catches, logs, throws       controller   ─ throws
       │              [LOG #5]                    │
  service      ─ catches, logs, throws       service      ─ throws
       │              [LOG #4]                    │
  use-case     ─ catches, logs, throws       use-case     ─ throws
       │              [LOG #3]                    │
  repository   ─ catches, logs, throws       repository   ─ throws
       │              [LOG #2]                    │
  driver       ─ raises                      driver       ─ raises
       │              [LOG #1]                    │
                                             boundary    ─ catches, classifies,
                                                          translates, LOGS ONCE
                                                          [LOG #1: the only one]
```
