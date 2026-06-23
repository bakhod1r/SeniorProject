# Error Handling — Professional (Staff / Principal) Level

> **Topic:** [Error Handling Roadmap](README.md)
> **Focus:** Errors as **API design**, errors as **organizational contract**, errors as a **product surface** — the staff/principal view.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Errors as API Design](#errors-as-api-design)
8. [Versioning Errors Across API Changes](#versioning-errors-across-api-changes)
9. [Result Types in OO Languages](#result-types-in-oo-languages)
10. [Production-Grade Patterns](#production-grade-patterns)
11. [Observability Hooks](#observability-hooks)
12. [Worked Example — Designing a Payments SDK Error Type](#worked-example--designing-a-payments-sdk-error-type)
13. [Java Before/After — Introducing `Result<T,E>` via Vavr](#java-beforeafter--introducing-resultte-via-vavr)
14. [Spring Anti-Pattern Walkthrough — `@ControllerAdvice` Refactor](#spring-anti-pattern-walkthrough--controlleradvice-refactor)
15. [Open vs Closed Enum Trade-Offs (Rust)](#open-vs-closed-enum-trade-offs-rust)
16. [Code Examples](#code-examples)
17. [Anti-Patterns — Full Catalog with Diagnoses](#anti-patterns--full-catalog-with-diagnoses)
18. [Library Author vs Application Author](#library-author-vs-application-author)
19. [Migrating an Existing Codebase](#migrating-an-existing-codebase)
20. [Team & Code-Review Heuristics](#team--code-review-heuristics)
21. [Pros & Cons](#pros--cons)
22. [Use Cases](#use-cases)
23. [Coding Patterns](#coding-patterns)
24. [Clean Code](#clean-code)
25. [Best Practices](#best-practices)
26. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
27. [Common Mistakes](#common-mistakes)
28. [Tricky Points](#tricky-points)
29. [Test Yourself](#test-yourself)
30. [Tricky Questions](#tricky-questions)
31. [Cheat Sheet](#cheat-sheet)
32. [Summary](#summary)
33. [What You Can Build](#what-you-can-build)
34. [Further Reading](#further-reading)
35. [Related Topics](#related-topics)
36. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> 🎓 At this level you stop asking *"how do I handle an error?"* and start asking *"what does my error mean to the people who consume my API, and how does that contract evolve?"*

By the time you've internalized wrapping, boundaries, translation, and retries (`senior.md`), the next horizon is **error handling as an organizational discipline**. Errors stop being a control-flow concern and become **a product surface**: every error code your service emits is a string in someone's runbook, a row in someone's Grafana panel, a clause in someone's SLA, and a key on someone's keyboard at 3 AM.

This page covers four perspectives a staff/principal engineer holds simultaneously:

1. **The API designer.** Errors are part of the public surface, governed by SemVer, documented like fields, identified by stable codes.
2. **The library author.** Errors are opinions. Choose them carefully; once shipped, you cannot easily change their meaning.
3. **The platform owner.** Errors become **events** in a telemetry pipeline — tagged, fingerprinted, routed, budgeted.
4. **The team lead.** Every PR you review asks four questions: *what is the user's experience when this fails? Could we tell from logs alone? Is this retryable? Is this our fault?*

If `junior.md` was *"errors are a vocabulary"*, `middle.md` was *"errors carry context"*, and `senior.md` was *"errors have boundaries"* — this level is **"errors are a contract you ship and own forever."**

---

## Prerequisites

- Fluent in everything covered by `junior.md`, `middle.md`, and `senior.md` of this folder.
- You've shipped at least one library or service whose errors other teams consume.
- You've had to deprecate or rename an error code in production.
- You've read a postmortem where the root cause was *"the error was technically logged but nobody ever looked at it."*
- Familiarity with at least one observability stack (Sentry, Datadog, Honeycomb, OpenTelemetry).
- Practical experience with **SemVer** and the *"is this a breaking change?"* question.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Error code** | A stable, machine-readable identifier for an error (e.g. `ERR_USER_NOT_FOUND`). Searchable, versionable, translatable. |
| **Error variant** | A distinct case in a closed error type (e.g. a Rust enum variant or a Java sealed class case). |
| **Open enum** | An error type that consumers must assume can grow — handle the new variant gracefully. |
| **Closed enum** | An error type that the compiler can prove is exhaustive — adding a variant is a breaking change. |
| **Anti-corruption layer (ACL)** | The DDD boundary that translates external/infrastructure errors into your domain's vocabulary. |
| **Error-as-event** | The discipline of emitting a metric/event for every domain error rather than just logging. |
| **Idempotency key** | A client-supplied identifier that lets a server safely treat retries of the same request as the same operation. |
| **Saga compensation** | The "undo" action a long-running workflow runs when a later step fails. |
| **Error budget** | The SLO-derived allowance of failures a service may emit before deployments are frozen. |
| **Fingerprint** | A Sentry/Rollbar concept: the hash that groups multiple error instances into one issue. |
| **Span status** | An OpenTelemetry attribute marking a span as `OK`, `ERROR`, or `UNSET`. |
| **`@ControllerAdvice`** | Spring's mechanism for catching and translating exceptions across all controllers. |
| **Result-in-OO** | The pattern of using `Result<T, E>` / `Either<L, R>` style types inside a language whose default model is exceptions. |
| **Open exception hierarchy** | Adding a new subclass of `RuntimeException` — usually not a breaking change at the bytecode level, but often a behavioural one. |

---

## Core Concepts

### 1. Errors Are Public Surface

Every type a library returns is part of its public API. Errors are no exception — pun intended. If `paymentsClient.charge()` can return `InsufficientFundsError`, that class name is now a **vocabulary word** in your customers' codebases. Renaming it is a breaking change. Changing its meaning silently is a betrayal.

### 2. SemVer Applies to Errors

- **Patch:** improving a message, adding an internal detail, no behavioural change.
- **Minor:** adding a new error variant — *but only if* the consumer model accommodates new variants (Rust `#[non_exhaustive]`, open exception hierarchies). In closed exhaustive systems, this is a major change.
- **Major:** removing a variant, renaming a code, changing the meaning of a code, changing retryability, changing the HTTP status code mapping.

### 3. Stable Identifiers Beat Strings

A message like *"User does not exist"* is unsearchable, untranslatable, and unsafe to grep. A code like `ERR_USER_NOT_FOUND` is all three. Codes survive translation, refactoring, message changes, and runbooks pointing at them.

### 4. Document Errors Like Fields

Every public function's documentation must answer:
- Which errors can it return?
- What does each error mean?
- Which are retryable?
- What's the recommended caller response?

This is non-negotiable for libraries. For services, the equivalent is the **error catalog**.

### 5. Errors Are Events, Not Just Logs

A logged error is a needle in a haystack. An *emitted event* with a code, severity, and tags is a row in a dashboard. Promote every domain error to a metric so SREs can alert on rate-of-change, not on grep matches.

### 6. The Anti-Corruption Layer

Domain code should never see `SQLException` or `IOException`. The infrastructure layer translates ugly, leaky, vendor-specific errors into the clean vocabulary your domain understands. This is the **ACL** pattern from DDD, applied to failures.

### 7. Error Budgets Are Organizational

Once your service has an SLO, every error counts toward a budget. Suddenly *"should we treat this as an error?"* is no longer a coding question — it's a product question. A 4xx isn't an SLO violation; a 5xx is. That distinction is a contract with the team next door.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| Error code as stable ID | A SKU — the product name on the box may change, but the SKU is forever. |
| Versioning errors | An airline merging two fare classes: every existing ticket must still mean *something*. |
| Open vs closed enums | A vending machine that lets you add new buttons (open) vs one welded shut at the factory (closed). |
| Anti-corruption layer | Customs at a border: every foreign passport gets translated, stamped, and re-issued as a local document. |
| Error-as-event | Air-traffic control: every blip on the radar is a signal, not just a note in the pilot's diary. |
| Error budget | A monthly data plan: spend it however you like, but when it's gone, deployments stop. |
| Saga compensation | Refunding a charge after a shipping failure — the "undo" of a multi-step business transaction. |
| Idempotency key | A coat-check ticket: hand it to the same desk twice, you still get back exactly one coat. |
| Fingerprint | The way Spotify groups duplicate uploads of the same song under one master record. |

---

## Mental Models

### A. "Every Error Has Three Audiences"

Each error you design speaks to three people:

1. **The caller's code** — needs a stable, programmatic identifier (code or type).
2. **The caller's human user** — needs a message they understand and an action they can take.
3. **Your own on-call** — needs context, fingerprint, and correlation IDs to debug.

If your error only serves one of those, you have a leak.

### B. "The Error Catalog is a Product"

Treat the list of all errors your service can emit as a *product surface* — version it, write release notes, deprecate things on a schedule. Stripe's `Errors` page is not documentation, it's *marketing for reliability*.

### C. "Domain vs Infrastructure Has a Wall"

Imagine a brick wall between your business logic and your I/O code. Every error crossing that wall has its passport checked. `SQLException` doesn't get through. `OrderNotFound` does.

```text
┌───────────────── DOMAIN ─────────────────┐
│  OrderNotFound  PaymentDeclined  ...     │
└──────────────────────▲───────────────────┘
                       │ translated by ACL
┌──────────────────────┴───────────────────┐
│  SQLException  IOException  HTTPError    │
└───────────── INFRASTRUCTURE ─────────────┘
```

---

## Errors as API Design

### 1. Every Returned Error Is Public Surface

If your library is `acme/payments`, then `acme.payments.InsufficientFunds` is **just as public** as your method names. Consumers will:

- Match on the type.
- Compare on the code.
- Display the message.
- Document the behaviour in *their* runbooks.

The moment you ship version `1.0.0`, that surface is frozen under SemVer.

### 2. Stable Codes Win Over Stable Messages

Two competing instincts among API designers:

- *"Make the message nice and human-readable so callers can show it to the user."*
- *"Make the code stable so callers can programmatically branch on it."*

Senior teams have learned: **you need both, but the code is the contract.** Messages can change. Codes cannot.

### 3. The Stripe / Twilio / AWS Pattern

A canonical structured error response:

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "parameter_missing",
    "message": "Missing required param: amount.",
    "param": "amount",
    "doc_url": "https://stripe.com/docs/errors#parameter_missing",
    "request_id": "req_a1b2c3"
  }
}
```

What every field does:

| Field | Purpose |
|-------|---------|
| `type` | Coarse-grained category — used to route handling (`invalid_request_error`, `api_error`, `card_error`). |
| `code` | Fine-grained stable ID — what you `switch` on in caller code. |
| `message` | Human-friendly text — change freely between releases, never change in meaning. |
| `param` | Which field caused validation failure — enables precise UI highlighting. |
| `doc_url` | Direct link to error docs — the *runbook in the response*. |
| `request_id` | Correlation key — what you give to support when you ask "what happened to this call?" |

### 4. Documenting Errors Per Language

| Language | Convention |
|----------|------------|
| Java | `@throws ExceptionType` in Javadoc — and checked exceptions force this anyway. |
| Rust | `# Errors` section in rustdoc — what each error variant means. |
| Python | Type-annotated raises in docstring; `Raises:` section in Google/Sphinx style. |
| Go | `// Returns ... or an error wrapping foo.ErrNotFound if ...` convention in comments. |
| TypeScript | TSDoc `@throws` plus discriminated union return types where used. |

If a public function can fail and its failures aren't documented, the function is **half-finished**.

---

## Versioning Errors Across API Changes

### Adding a New Error Variant

- **Open exception hierarchy** (Java `RuntimeException`, Python `Exception`): usually a minor version. Existing `catch (Exception e)` still works.
- **Closed sealed type** (Rust `enum` without `#[non_exhaustive]`, Java sealed interfaces, Kotlin sealed classes): adding is a **breaking change** because exhaustive `match` / `switch` on the consumer side breaks.
- **Mitigation:** use `#[non_exhaustive]` in Rust, `permits` plus a default case in Java, an `_Unknown` variant in TypeScript discriminated unions.

### Renaming or Removing an Error

- Always introduce the new code first.
- Emit **both** the new and the old code for at least one major version.
- Mark the old code `@deprecated` with a removal version.
- Remove only in the next major.

### Changing the Meaning of a Code — NEVER

If `ERR_PAYMENT_FAILED` used to mean "card declined" and now also covers "fraud detected" — every consumer's branching logic just got silently wrong. Add a new code (`ERR_PAYMENT_FRAUD_SUSPECTED`); leave the old one alone.

### The Dual-Code Bridge

For one release, return:

```json
{ "code": "ERR_PAYMENT_DECLINED",
  "legacy_code": "ERR_CHARGE_FAIL",
  "message": "..." }
```

Old consumers branch on `legacy_code`; new ones on `code`. Remove `legacy_code` next major.

### Retryability is Part of the Contract

Adding `retryable: true` is fine. Removing it is breaking. **Changing** it (was `true`, now `false`) is the worst kind of silent break — every retry loop in production now hammers your servers harder.

---

## Result Types in OO Languages

### Java — Vavr's `Try<T>` and `Either<L, R>`

Vavr brings ML-style ergonomics to Java:

```java
import io.vavr.control.Try;

Try<User> userTry = Try.of(() -> userRepo.findById(id));
String greeting = userTry
    .map(User::name)
    .map(name -> "Hello " + name)
    .getOrElse("Hello stranger");
```

For two-sided error info, `Either<DomainError, User>` makes the failure type *explicit at compile time*.

### Java 21 — Sealed Interfaces + Pattern Matching

The modern, library-free approach:

```java
sealed interface ChargeResult permits Success, Declined, InsufficientFunds {}
record Success(String chargeId) implements ChargeResult {}
record Declined(String reason)  implements ChargeResult {}
record InsufficientFunds(long shortfallCents) implements ChargeResult {}

String describe(ChargeResult r) {
    return switch (r) {
        case Success s          -> "Charged: " + s.chargeId();
        case Declined d         -> "Declined: " + d.reason();
        case InsufficientFunds f -> "Short by " + f.shortfallCents();
    };
}
```

Compile-time exhaustiveness for free.

### C# — `OneOf<T0, T1>` and Result Libraries

```csharp
OneOf<User, NotFound, Forbidden> GetUser(string id) { ... }

GetUser(id).Switch(
    user      => Console.WriteLine(user.Name),
    notFound  => Console.WriteLine("404"),
    forbidden => Console.WriteLine("403"));
```

The school of thought: *"exceptions for exceptional, returns for expected."* Sensible — but consistency across the codebase matters more than purity.

### Python — `returns` Library and Gradual Typing

```python
from returns.result import Result, Success, Failure

def parse_age(s: str) -> Result[int, str]:
    try:
        return Success(int(s))
    except ValueError as e:
        return Failure(f"not a number: {e}")
```

With `mypy`, you can prove the failure case was handled. In practice, Python codebases that adopt this *fully* are rare; most use it for a critical core and exceptions for the rest.

### Kotlin — Built-in `Result<T>`

Kotlin ships `kotlin.Result<T>`, but with caveats:

- It's only for `runCatching` blocks — not idiomatic as a return type for public APIs.
- Until Kotlin 1.6, `Result<T>` was forbidden as a return type entirely.

For production work, use **Arrow's `Either<E, A>`** instead — it's the de facto Kotlin functional Result.

### When `Result`-in-OO is Worth It

| Use it when | Don't use it when |
|-------------|-------------------|
| The domain has a small, well-defined set of failure types you want exhaustive. | The team is fluent in exceptions and your project follows the host language's idioms. |
| You're building a pure functional core (e.g. validation, parsing). | Errors are rare and "exceptional" — Result adds ceremony for no benefit. |
| You need compile-time proof that errors are handled. | You're working with frameworks (Spring, Django) that assume exceptions for cross-cutting concerns like transactions. |
| You want to compose error handling with `map`/`flatMap`/`fold`. | The whole rest of your codebase throws — mixing styles is worse than picking one. |

The senior insight: **mimicry of ML-style errors in an OO host language often fights the host.** Choose deliberately.

---

## Production-Grade Patterns

### 1. The Domain-Error / Infrastructure-Error Wall

DDD-style anti-corruption layer applied to errors:

- **Infrastructure layer** speaks in `SQLException`, `IOException`, `HttpStatusException`.
- **ACL** translates each into a domain error: `OrderNotFound`, `PaymentTemporarilyUnavailable`, `InventoryLocked`.
- **Domain layer** never sees infrastructure errors. Ever.

This protects the domain from infrastructure churn (Postgres → CockroachDB shouldn't ripple into `OrderService`) and gives the domain a clean vocabulary.

### 2. Error-as-Event

Every domain error fires a metric **at the moment of creation**, not in the catch block at the top:

```go
func NewPaymentDeclined(reason string) *Error {
    metrics.Counter("payment.declined", "reason", reason).Inc()
    return &Error{Code: "PAYMENT_DECLINED", Reason: reason}
}
```

Now your SRE team can alert on `rate(payment.declined[5m]) > 10` without grepping logs.

### 3. Idempotency Keys and Errors

Idempotency entangles with errors in subtle ways:

- A `409 Conflict` on an idempotency replay means "this key was used for a different request."
- A `200 OK` on an idempotency replay should return the **same response, same errors** as the original.
- A timeout on the *first* try followed by a retry must not double-charge.

The contract: **the idempotency key is the only thing that lets a retry safely cross the network.**

### 4. Saga Compensation

In a long-running workflow (order → reserve inventory → charge card → ship), "error" stops being a local concern:

- Each step has a **compensating action** (release inventory, refund charge, cancel shipment).
- An "error" in step 3 triggers compensations for steps 1 and 2.
- Compensations themselves can fail — so you need a **compensation queue with retries**, not just a try/catch.

This is where errors *as events* really shine: each compensation is just another event in the saga's log.

### 5. Error Budgets at the Team / Org Level

- SLO: 99.9% of requests complete without 5xx.
- That gives you 43 minutes of "error budget" per month.
- Spent? **Deploy freeze** until next budget window.

Errors stop being a coding concern and become a *deployment-velocity* concern. This forces conversations like *"is this error our fault?"* and *"should this even be a 5xx?"*

---

## Observability Hooks

### Sentry / Rollbar / Datadog Tagging

```python
import sentry_sdk

def charge(user_id: str, amount: int) -> None:
    try:
        payments.charge(user_id, amount)
    except PaymentDeclined as e:
        sentry_sdk.set_tag("error_code", e.code)
        sentry_sdk.set_user({"id": user_id})
        sentry_sdk.set_extra("amount_cents", amount)
        sentry_sdk.capture_exception(e)
        raise
```

Key concepts:

- **`fingerprint`** controls grouping. Set it deliberately or one bug becomes 10,000 issues.
- **`extra`** carries debug context — never PII.
- **`user.id`** scopes to the affected user.

### OpenTelemetry Error Semantics

```python
from opentelemetry import trace
from opentelemetry.trace.status import Status, StatusCode

tracer = trace.get_tracer(__name__)

with tracer.start_as_current_span("charge") as span:
    try:
        do_charge()
    except Exception as e:
        span.record_exception(e)
        span.set_status(Status(StatusCode.ERROR, str(e)))
        raise
```

- `record_exception` adds the stack to the span attributes.
- `set_status(ERROR)` marks the span as failed — this is what backends use to compute error rates.
- Setting `OK` explicitly is rarely needed; absence of `ERROR` means OK.

### Logged Error vs Alerted Error

| Logged | Alerted |
|--------|---------|
| Every domain error. | Only the codes that should wake humans. |
| `INFO` or `WARN` level. | `ERROR` level + pager rule. |
| Searchable for debugging. | Routed by code: `ERR_DB_DOWN` pages SRE; `ERR_INVALID_INPUT` does not. |

The mistake juniors make: log everything at `ERROR`. Then alerts based on log level fire constantly and on-call learns to ignore them. **The cure is per-code routing.**

---

## Worked Example — Designing a Payments SDK Error Type

Imagine you're building `acme-payments-sdk`. The public function:

```rust
pub fn charge(req: ChargeRequest) -> Result<ChargeReceipt, PaymentError>;
```

### Step 1 — Enumerate the Failure Modes

Brainstorm in plain English first:

1. The user's card was declined.
2. The user doesn't have enough funds.
3. The card expired.
4. The card number is invalid (validation).
5. The card is suspected of fraud.
6. The merchant account is suspended.
7. The API key is invalid.
8. The rate limit was hit.
9. The payment processor timed out (transient).
10. The amount is below or above limits.
11. Idempotency key was reused with a different request.
12. The API returned something we don't understand (forward-compat).

### Step 2 — Group Into Categories

```rust
#[non_exhaustive]
pub enum PaymentError {
    // Caller's input is wrong — never retry.
    Validation(ValidationError),
    // Caller is unauthorised — fix credentials.
    Authentication(AuthError),
    // The card itself is the problem.
    Card(CardError),
    // Transient infrastructure / processor problem — retry.
    Transient(TransientError),
    // Idempotency conflict.
    Idempotency(IdempotencyError),
    // Future-proofing.
    Unknown { code: String, message: String },
}
```

### Step 3 — Add Stable Codes and Retryability

```rust
pub struct CardError {
    pub code: CardErrorCode,
    pub message: String,
    pub processor_decline_code: Option<String>,
    pub request_id: String,
}

#[non_exhaustive]
pub enum CardErrorCode {
    Declined,          // not retryable
    InsufficientFunds, // not retryable
    Expired,           // not retryable
    FraudSuspected,    // not retryable + alert
}

impl PaymentError {
    pub fn is_retryable(&self) -> bool {
        matches!(self, PaymentError::Transient(_))
    }
    pub fn code(&self) -> &str { /* stable string */ }
}
```

### Step 4 — Document the Contract

```rust
/// Charges a card.
///
/// # Errors
///
/// - [`PaymentError::Validation`] — request is malformed; do **not** retry.
/// - [`PaymentError::Authentication`] — API key invalid; check credentials.
/// - [`PaymentError::Card`] — card-side issue; surface message to user.
/// - [`PaymentError::Transient`] — processor temporarily unavailable; retry
///   with exponential backoff using the same idempotency key.
/// - [`PaymentError::Idempotency`] — key was reused with different payload.
pub fn charge(req: ChargeRequest) -> Result<ChargeReceipt, PaymentError> { ... }
```

### Step 5 — Wire to Observability and the Idempotency Contract

- Every error fires `metrics.counter("payments.error", "code", err.code())`.
- Every error carries `request_id` so support can correlate.
- `Transient` retries reuse the original `idempotency_key`; a `200 OK` on retry returns the original `ChargeReceipt`.

This is the **complete error contract**: type, code, retryability, observability hook, idempotency rule. Ship that as 1.0.

---

## Java Before/After — Introducing `Result<T,E>` via Vavr

### Before — Exception-Driven

```java
public class OrderService {
    public Order placeOrder(NewOrder req) {
        Customer c = customerRepo.find(req.customerId);  // throws CustomerNotFound
        Inventory i = inventory.reserve(req.items);       // throws OutOfStock
        Payment p = payments.charge(c, req.total);        // throws CardDeclined
        return orderRepo.save(new Order(c, i, p));        // throws DbError
    }
}

// Caller
try {
    Order o = orderService.placeOrder(req);
    return Response.ok(o);
} catch (CustomerNotFound e) { return Response.status(404).build(); }
  catch (OutOfStock e)       { return Response.status(409).entity(...).build(); }
  catch (CardDeclined e)     { return Response.status(402).entity(...).build(); }
  catch (DbError e)          { return Response.status(500).build(); }
```

Problems:
- The compiler doesn't enforce that the caller handles each case.
- Mixing `DbError` (infrastructure) and `CustomerNotFound` (domain) at the same level.
- The try/catch cascade obscures the happy path.

### After — Vavr `Either<DomainError, Order>`

```java
public sealed interface DomainError
    permits CustomerNotFound, OutOfStock, CardDeclined {}

public Either<DomainError, Order> placeOrder(NewOrder req) {
    return customerRepo.find(req.customerId)            // Either<DomainError, Customer>
        .flatMap(c -> inventory.reserve(req.items)
            .flatMap(i -> payments.charge(c, req.total)
                .map(p -> new Order(c, i, p))))
        .flatMap(o -> orderRepo.save(o));               // DbError is *infrastructure*,
                                                        // gets translated in the ACL above
}

// Caller
return orderService.placeOrder(req).fold(
    err -> switch (err) {
        case CustomerNotFound c -> Response.status(404).build();
        case OutOfStock o       -> Response.status(409).entity(o).build();
        case CardDeclined d     -> Response.status(402).entity(d).build();
    },
    order -> Response.ok(order)
);
```

What changed:
- The function signature documents the failure set.
- The switch is **exhaustive** — adding a new `DomainError` variant is a compile error.
- Infrastructure errors (`DbError`) never appear at this layer; they're translated below.

What didn't change:
- The infrastructure layer still uses exceptions for `SQLException` because Spring's transaction manager needs them.
- The boundary between exception-style and Result-style is **explicit and documented**.

---

## Spring Anti-Pattern Walkthrough — `@ControllerAdvice` Refactor

### The Anti-Pattern

A common Spring middleware mistake — every exception becomes a 500:

```java
@RestControllerAdvice
public class GlobalErrorHandler {
    @ExceptionHandler(Exception.class)
    public ResponseEntity<String> handle(Exception e) {
        log.error("error", e);
        throw new ResponseStatusException(
            HttpStatus.INTERNAL_SERVER_ERROR, e.getMessage(), e);
    }
}
```

Problems:
- `CustomerNotFound` → 500 (should be 404).
- `Validation` errors → 500 (should be 400).
- `MethodArgumentNotValidException` → 500 (should be 422).
- Every error is alerted, on-call burns out, real issues drown.

### The Refactor — Per-Type Handling

```java
@RestControllerAdvice
public class GlobalErrorHandler {

    @ExceptionHandler(CustomerNotFound.class)
    public ResponseEntity<ErrorBody> handleNotFound(CustomerNotFound e) {
        return ResponseEntity.status(404).body(
            new ErrorBody("ERR_CUSTOMER_NOT_FOUND", e.getMessage(), null));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorBody> handleValidation(MethodArgumentNotValidException e) {
        String param = e.getBindingResult().getFieldError().getField();
        return ResponseEntity.status(422).body(
            new ErrorBody("ERR_VALIDATION", e.getMessage(), param));
    }

    @ExceptionHandler(CardDeclined.class)
    public ResponseEntity<ErrorBody> handleDeclined(CardDeclined e) {
        return ResponseEntity.status(402).body(
            new ErrorBody("ERR_PAYMENT_DECLINED", e.getMessage(), null));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorBody> handleUnknown(Exception e) {
        String correlationId = MDC.get("correlationId");
        log.error("Unhandled error [{}]", correlationId, e);
        sentry.captureException(e);
        return ResponseEntity.status(500).body(
            new ErrorBody("ERR_INTERNAL", "An internal error occurred.", null)
                .withCorrelationId(correlationId));
    }
}

public record ErrorBody(String code, String message, String param) { ... }
```

Improvements:
- Each domain exception maps to a meaningful status code.
- Validation errors include the offending param.
- The fallback `Exception` handler is the *only* one that hits Sentry — fewer false alarms.
- `correlationId` is in the body so support can search by it.
- The response shape is **uniform** — clients have one error format to parse.

---

## Open vs Closed Enum Trade-Offs (Rust)

| Aspect | Open (`#[non_exhaustive]`) | Closed |
|--------|----------------------------|--------|
| Adding a variant | Minor version — consumers forced to use `_ =>` arm. | Major version — every `match` breaks. |
| Compile-time exhaustiveness for consumer | No — they must have a catch-all. | Yes — they handle every case. |
| Compile-time exhaustiveness for author | Yes — internal `match` is still exhaustive. | Yes. |
| Forward-compatibility | Strong — library can grow without breaking callers. | Weak — every growth is breaking. |
| Discoverability | Callers must read docs to find all variants. | Callers see the full list in IDE. |
| Best for | Public library errors. | Internal/private errors, or stable closed protocols. |

### Open Example

```rust
#[non_exhaustive]
pub enum PaymentError {
    Declined,
    InsufficientFunds,
    Expired,
}

// Consumer
match err {
    PaymentError::Declined         => ...,
    PaymentError::InsufficientFunds => ...,
    PaymentError::Expired          => ...,
    _ => log::warn!("unknown payment error"),  // required by non_exhaustive
}
```

### Closed Example

```rust
pub enum InternalState {
    Idle,
    Working,
    Done,
}

// Consumer
match state {
    InternalState::Idle    => ...,
    InternalState::Working => ...,
    InternalState::Done    => ...,
    // no `_ =>` needed; compiler proves exhaustiveness
}
```

The rule of thumb: **public API errors → open. Internal state → closed.**

---

## Code Examples

### Go — Payments SDK Error Type

```go
package payments

import (
    "errors"
    "fmt"
)

type ErrorCode string

const (
    CodeDeclined          ErrorCode = "PAYMENT_DECLINED"
    CodeInsufficientFunds ErrorCode = "PAYMENT_INSUFFICIENT_FUNDS"
    CodeFraudSuspected    ErrorCode = "PAYMENT_FRAUD_SUSPECTED"
    CodeTransient         ErrorCode = "PAYMENT_TRANSIENT"
)

type Error struct {
    Code      ErrorCode
    Message   string
    RequestID string
    Retryable bool
    cause     error
}

func (e *Error) Error() string {
    return fmt.Sprintf("[%s] %s (request_id=%s)", e.Code, e.Message, e.RequestID)
}
func (e *Error) Unwrap() error { return e.cause }
func (e *Error) Is(target error) bool {
    var t *Error
    return errors.As(target, &t) && t.Code == e.Code
}

func newDeclined(reqID, reason string) *Error {
    metricsCounter("payments.error", "code", string(CodeDeclined)).Inc()
    return &Error{
        Code: CodeDeclined, Message: reason, RequestID: reqID, Retryable: false,
    }
}
```

### Python — `returns` Library With Domain Errors

```python
from dataclasses import dataclass
from returns.result import Result, Success, Failure

@dataclass(frozen=True)
class DomainError:
    code: str
    message: str
    retryable: bool

@dataclass(frozen=True)
class Charge:
    id: str
    amount_cents: int

def charge(amount_cents: int) -> Result[Charge, DomainError]:
    if amount_cents <= 0:
        return Failure(DomainError("ERR_INVALID_AMOUNT", "must be positive", False))
    try:
        ext_id = processor.charge(amount_cents)
        return Success(Charge(ext_id, amount_cents))
    except ProcessorTimeout as e:
        return Failure(DomainError("ERR_TRANSIENT", str(e), True))

result = charge(1000)
match result:
    case Success(charge): print("ok", charge.id)
    case Failure(err) if err.retryable: print("retry:", err.code)
    case Failure(err): print("fail:", err.code)
```

### Java — Sealed Domain Errors With `@ControllerAdvice`

```java
public sealed interface DomainError
    permits CustomerNotFound, OutOfStock, CardDeclined, RateLimited {
    String code();
    String message();
}

public record CustomerNotFound(String customerId) implements DomainError {
    public String code()    { return "ERR_CUSTOMER_NOT_FOUND"; }
    public String message() { return "No customer with id " + customerId; }
}

public record CardDeclined(String reason) implements DomainError {
    public String code()    { return "ERR_PAYMENT_DECLINED"; }
    public String message() { return reason; }
}

@RestControllerAdvice
public class DomainErrorAdvice {
    @ExceptionHandler(DomainException.class)
    public ResponseEntity<ErrorBody> handle(DomainException e) {
        DomainError d = e.error();
        int status = switch (d) {
            case CustomerNotFound c -> 404;
            case OutOfStock o       -> 409;
            case CardDeclined cd    -> 402;
            case RateLimited r      -> 429;
        };
        return ResponseEntity.status(status).body(new ErrorBody(d.code(), d.message()));
    }
}
```

### Rust — `#[non_exhaustive]` Public Error

```rust
use thiserror::Error;

#[derive(Error, Debug)]
#[non_exhaustive]
pub enum PaymentError {
    #[error("payment declined: {0}")]
    Declined(String),

    #[error("insufficient funds (shortfall: {shortfall_cents} cents)")]
    InsufficientFunds { shortfall_cents: u64 },

    #[error("transient error: {0}")]
    Transient(#[source] Box<dyn std::error::Error + Send + Sync>),

    #[error("unknown: {code}")]
    Unknown { code: String, message: String },
}

impl PaymentError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Declined(_)             => "PAYMENT_DECLINED",
            Self::InsufficientFunds { .. } => "PAYMENT_INSUFFICIENT_FUNDS",
            Self::Transient(_)            => "PAYMENT_TRANSIENT",
            Self::Unknown { .. }          => "PAYMENT_UNKNOWN",
        }
    }
    pub fn is_retryable(&self) -> bool {
        matches!(self, Self::Transient(_))
    }
}
```

---

## Anti-Patterns — Full Catalog with Diagnoses

### 1. `catch (Exception e) {}` — The Swallow

**Symptom:** errors disappear; bugs reach production silently.
**Diagnosis:** the author treated *handling* as *suppression*.
**Fix:** if you cannot do something with the error, you cannot catch it. Re-throw or propagate.

### 2. Log AND Re-Throw — Duplicated Noise

**Symptom:** the same error appears 5 times in logs at 5 different stack frames.
**Diagnosis:** each layer catches, logs, and re-throws "in case it gets lost."
**Fix:** log **once**, at the boundary that decides the response. Below that, only wrap.

### 3. `throw new RuntimeException(e)` — Laundering

**Symptom:** every error becomes a `RuntimeException`. Caller cannot branch on type.
**Diagnosis:** the author wanted to escape checked exceptions without thinking about the design.
**Fix:** introduce a typed domain exception hierarchy, or use sealed types.

### 4. Error Codes Embedded in Messages — Unsearchable

**Symptom:** `"failed: ERR_USER_42_BANNED for user mrb"` — code lives in a string.
**Diagnosis:** no field for the code, so it gets stuffed into the message.
**Fix:** structured error with a dedicated `code` field; message is for humans.

### 5. The "Every Exception Is a 500" Middleware

**Symptom:** clients see 500 for malformed input, missing resources, declined cards.
**Diagnosis:** single catch-all in middleware, no per-type mapping.
**Fix:** see the `@ControllerAdvice` refactor above.

### 6. Sentinel Comparison via `==`

**Symptom:** `if err == sql.ErrNoRows` fails when the error is wrapped.
**Diagnosis:** Go code that ignores `errors.Is` / `errors.As`.
**Fix:** always `errors.Is(err, sql.ErrNoRows)`.

### 7. Validation in Three Places

**Symptom:** the same check exists in the controller, the service, and the database constraint — and they disagree.
**Diagnosis:** no single source of truth for validation rules.
**Fix:** validate once at the boundary (input validation) and once in the domain (invariants); use the database constraint as a safety net only.

### 8. Panic-on-Impossible Creep

**Symptom:** every `nil` check becomes `panic("should never happen")`.
**Diagnosis:** the author confused "I haven't seen this" with "impossible."
**Fix:** panic only for invariants you've proven cannot fail. For everything else, return an error.

### 9. The Ignored `io.Copy`

**Symptom:** `_, _ = io.Copy(dst, src)` — write failures vanish.
**Diagnosis:** "the linter complained so I assigned to `_`."
**Fix:** check the error. If you can't act on it, at minimum log with context.

### 10. The "OnErrorResumeNext" Mindset

**Symptom:** every operation is wrapped in try/catch with a continue.
**Diagnosis:** the author treats errors as inconveniences.
**Fix:** decide deliberately for each case — recover, retry, propagate, or fail. Never "ignore and continue" by default.

---

## Library Author vs Application Author

| Aspect | Library Author | Application Author |
|--------|----------------|---------------------|
| Error types | Be opinionated; export named types/codes. | Use library types or define app-level wrappers. |
| Logging | **Never** log from library code. | Log at boundaries you own. |
| Panics | Never panic for caller-visible problems. | Panic only for invariant violations. |
| Documentation | Document every `Err` return. Non-negotiable. | Document API responses and error codes. |
| Stability | SemVer applies strictly. Every removal is major. | Internal errors can change freely. |
| Retry policy | Mark retryability; let caller decide. | Encode retry policy once, apply consistently. |
| Observability | Don't bake in Sentry/OTel; expose hooks. | Bake in observability at the app boundary. |

The senior heuristic: **a library that logs is a library that fights its callers.**

---

## Migrating an Existing Codebase

### From `catch (Exception)` to Typed Exceptions

1. Inventory all `catch (Exception)` sites.
2. For each, ask: *what specific exceptions can actually reach here?*
3. Replace with the narrowest catch type that compiles.
4. The general `catch` becomes `catch (Exception)` at the **outermost boundary only**, for unhandled-error logging.

### From Returned Errors to `Result<T, E>` in OO

1. Identify a **bounded module** with a clean external API (validation, parsing, pricing).
2. Convert its public surface to `Result`/`Either`.
3. The integration point with the rest of the system (exception-based) is a `.fold(..., throw)` or `.getOrElseThrow()`.
4. Expand outward only if the experiment pays off.

### From "Every Exception Is 500" to Mapped Boundaries

1. Build a registry of exception → status code → error code mappings.
2. Replace the catch-all with per-type handlers.
3. Add an `unhandled` fallback that still returns 500 — but **logs to Sentry and includes a correlation ID**.
4. Monitor: the rate of "unhandled" should drop steadily as you classify exceptions.

### Boundary-First Migration

Start at the *outermost* boundary (HTTP, CLI, message handler) where errors become responses. Define the shape there. Migrate inward one layer at a time. Never try to rewrite from the bottom up — you'll never finish, and intermediate states are unshippable.

---

## Team & Code-Review Heuristics

The four senior questions you ask on every PR that touches an error path:

1. **What is the user's experience when this fails?**
   - "User sees a 500" is *never* an acceptable answer in 2026.
   - "User sees an actionable message" is the bar.

2. **Could we tell from logs alone?**
   - If the answer is no — what's missing? Correlation ID? Code? Inputs?
   - If you'd need a debugger to understand the failure, the error is incomplete.

3. **Is this error retryable?**
   - If the author can't answer this with certainty, the design isn't done.
   - Document retryability on the error type itself.

4. **Is this error our fault?**
   - 4xx = caller's fault. 5xx = our fault. The distinction drives SLOs, alerts, and budgets.
   - "Both?" is a sign of poor design.

---

## Pros & Cons

| Approach | Pros | Cons |
|----------|------|------|
| Stable codes + structured responses | Searchable, translatable, runbook-friendly. | Disciplined process to add/remove/rename codes. |
| Sealed/closed error types | Compile-time exhaustiveness. | Every new variant is a breaking change. |
| Open/non-exhaustive types | Forward-compatible. | Callers must have a fallback arm. |
| Result-in-OO (Vavr, Arrow) | Functional composition, compile-time proof. | Fights host language; mixed style is worse than either. |
| Domain/infrastructure wall | Stable domain, swappable infrastructure. | One more layer; more code. |
| Error-as-event | First-class observability; alertable. | Discipline + metric cardinality cost. |

---

## Use Cases

- **Public SDK design** — every error is a SemVer contract.
- **Multi-team platform** — error catalog as the cross-team agreement.
- **Long-running workflows / sagas** — errors drive compensation.
- **Payment / financial systems** — retryability + idempotency entanglement.
- **High-SLO services** — error budgets gating deploys.
- **Migrations between error policies** — boundary-first incremental work.
- **Observability stacks** — error events as metric source.

---

## Coding Patterns

### Pattern 1 — Error Type With Code + Retryability

```go
type Error interface {
    error
    Code() string
    Retryable() bool
}
```

Every domain error implements this; observability and retry logic both rely on it.

### Pattern 2 — Centralised Error Catalog

```yaml
# errors.yaml — the team's source of truth
ERR_USER_NOT_FOUND:
  http_status: 404
  message_template: "No user with id {id}"
  retryable: false
  alert_severity: info
ERR_DB_DOWN:
  http_status: 503
  message_template: "Database unavailable"
  retryable: true
  alert_severity: critical
```

Generate code from this — one source, many bindings (Go, TS, Python).

### Pattern 3 — Boundary Logger

```python
def boundary(handler):
    def wrapper(req):
        try:
            return handler(req)
        except DomainError as e:
            metrics.inc("domain.error", code=e.code)
            return error_response(e)
        except Exception as e:
            log.exception("unhandled", correlation_id=req.id)
            sentry.capture(e)
            return error_response(InternalError())
    return wrapper
```

### Pattern 4 — Idempotent Retry

```go
func chargeWithRetry(ctx context.Context, req ChargeReq) (*Receipt, error) {
    key := req.IdempotencyKey
    return retry.Do(ctx, retry.WithMaxAttempts(3), func() (*Receipt, error) {
        r, err := client.Charge(ctx, req.WithIdempotency(key))
        if err == nil {
            return r, nil
        }
        var e *Error
        if errors.As(err, &e) && e.Retryable {
            return nil, retry.Retry(err)
        }
        return nil, retry.Permanent(err)
    })
}
```

---

## Clean Code

- Every public error has a code, a message, a retryability flag, and a correlation ID.
- Library code never logs. Library code never panics for caller-visible problems.
- Domain code never sees infrastructure errors.
- One source of truth for the error catalog. Generate bindings.
- The 500 handler is the *only* handler that goes to Sentry by default.
- Pattern-match on codes/types, never on messages.
- `@deprecated` and a removal version before any error is removed.

---

## Best Practices

- **Treat your error catalog as a product.** Version it. Release-note changes.
- **Mark forward-compatibility intent explicitly** (`#[non_exhaustive]`, default arms, `_Unknown` variants).
- **Emit a metric for every domain error** — promote it to first-class telemetry.
- **Document retryability** on the type, not in prose.
- **Map error codes to HTTP statuses centrally**, never inline.
- **Use correlation IDs everywhere.** They're the cheapest debugging tool you'll ever buy.
- **Per-code alert routing.** Treat `ERR_DB_DOWN` differently from `ERR_INVALID_INPUT`.
- **Migrate from the boundary inward.** Never the other way.
- **Run a quarterly "error catalog review"** — deprecate dead codes, document new ones.

---

## Edge Cases & Pitfalls

- **Cardinality explosion** — emitting metrics tagged with user IDs blows up Prometheus.
- **Sentry fingerprint collapse** — without a fingerprint, every error variant looks like the same bug.
- **Idempotency replay returning the wrong error** — replay must return the *original* response, including errors.
- **Saga compensation idempotency** — compensations themselves must be idempotent.
- **Retryable change in production** — a code that was non-retryable suddenly becoming retryable can DOS your own backend.
- **Error budget burn from a single endpoint** — one buggy endpoint can torch the whole service's budget; need per-endpoint SLOs.
- **Translation locale fallback** — message templates need a default locale; never return the key as the message.
- **`#[non_exhaustive]` viral spread** — once added, every consumer adds catch-all arms; design with that in mind.
- **Cross-language error propagation** — gRPC status codes vs HTTP statuses vs your codes — pick one canonical mapping.
- **Idempotency key + multi-region** — replay across regions requires global key uniqueness.

---

## Common Mistakes

1. Treating error codes as cosmetic instead of contractual.
2. Adding a variant to a closed enum and calling it a minor release.
3. Logging from library code.
4. Letting infrastructure errors bleed into the domain.
5. Making *every* exception 500.
6. Per-error logging at `ERROR` level — exhausting on-call.
7. No correlation IDs — every support ticket needs a bug hunt.
8. Reusing an error code with a new meaning.
9. Inventing a code per occurrence — codes should be enumerable.
10. Using messages as the API and codes as decoration. It's the opposite.
11. Forgetting that errors need translation (i18n) and search (Elastic) hooks.
12. No deprecation path for removing an error code.

---

## Tricky Points

- A library's error type is part of its public surface — *more* stable than its methods, since methods can be added freely but error variants often can't.
- An open exception hierarchy and a non-exhaustive enum solve the same problem (forward-compat) in different languages.
- Result-in-OO is most useful for a *bounded core*, least useful for a whole codebase.
- Idempotency keys turn errors into deterministic responses — replay must return the same error, byte-for-byte.
- An "error budget" reframes errors from a coding concern to a deployment-velocity concern. Suddenly product managers care.
- Sentry's fingerprint is the single most underused tool in error observability — most teams accept defaults and drown in noise.

---

## Test Yourself

1. Design the error type for a "users" service: list every variant, its code, its HTTP status, its retryability.
2. Take a Go library you use. Find one place where it logs internally. Argue whether that's correct.
3. Design the deprecation plan for renaming `ERR_PAYMENT_FAILED` to `ERR_PAYMENT_DECLINED`. What goes in v1, v2, v3?
4. Convert a `try/catch` chain in a Java codebase to a `Result`-style chain using Vavr. Did the code get better? Worse?
5. Find a Spring `@RestControllerAdvice` with a single `Exception.class` handler. Refactor to per-type.
6. Decide whether a new variant `ERR_FRAUD_DETECTED` on your payments enum is a minor or major version. Defend your answer.
7. Wire OpenTelemetry `span.record_exception` and `set_status` correctly in one of your services.
8. Build a one-page "error catalog" for your team's main service. Include code, status, retryability, severity.

---

## Tricky Questions

1. **Q:** Is adding a new variant to a Rust error enum a breaking change?
   **A:** If the enum has `#[non_exhaustive]`, no — consumers were required to add a catch-all. If not, yes — exhaustive `match` arms break.

2. **Q:** Why is `throw new RuntimeException(e)` an anti-pattern even when it compiles?
   **A:** It erases the type information callers could have used to branch. It's the OO equivalent of `return "error"`.

3. **Q:** A retried request hits the server with the same idempotency key but a *different* payload. What's the right error?
   **A:** A specific `ERR_IDEMPOTENCY_CONFLICT` (often 409). Returning the original response is wrong; returning the new one breaks the idempotency contract.

4. **Q:** Why is logging from a library a code smell?
   **A:** The library doesn't know the caller's logging stack, format, or policy. It steals the caller's stdout/stderr and pollutes their observability.

5. **Q:** When is `Result<T, E>` in Java *worse* than exceptions?
   **A:** When 99% of the codebase uses exceptions and `Result` shows up in one corner. Mixed style is worse than either pure style.

6. **Q:** What's the difference between a logged error and an alerted error?
   **A:** Log everything; alert only on codes that should wake a human. Per-code routing is the difference between a useful pager and a tuned-out on-call.

7. **Q:** Can you change `retryable: false` to `retryable: true` on an existing error code?
   **A:** No — it's a contract change. Callers may have built retry loops assuming non-retryable; suddenly retrying multiplies load.

8. **Q:** Why does Stripe include `request_id` in every error response?
   **A:** Because support needs a key to find that exact request in their logs. It's the single most useful field in the whole error body.

---

## Cheat Sheet

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ ERROR HANDLING — PROFESSIONAL / STAFF LEVEL — QUICK REFERENCE              │
├────────────────────────────────────────────────────────────────────────────┤
│ ERRORS ARE                                                                 │
│   • Public API surface — SemVer applies                                    │
│   • Identified by stable CODES, not messages                               │
│   • Documented like fields (@throws, # Errors, Raises:)                    │
│                                                                            │
│ ERROR RESPONSE SHAPE                                                       │
│   { type, code, message, param, doc_url, request_id }                      │
│                                                                            │
│ ADDING A VARIANT                                                           │
│   • Open (non_exhaustive / RuntimeException) → minor                       │
│   • Closed (sealed / plain enum)              → major                      │
│                                                                            │
│ NEVER                                                                      │
│   • Reuse a code with new meaning                                          │
│   • Change retryability of an existing code                                │
│   • Log from library code                                                  │
│   • Let infrastructure errors reach the domain                             │
│                                                                            │
│ OBSERVABILITY                                                              │
│   • Sentry: set tag(error_code), fingerprint, request_id                   │
│   • OTel: span.record_exception + setStatus(ERROR)                         │
│   • Alert on CODES, not on log level                                       │
│                                                                            │
│ SENIOR REVIEW QUESTIONS                                                    │
│   1. What is the user's experience when this fails?                        │
│   2. Could we tell from logs alone?                                        │
│   3. Is this error retryable?                                              │
│   4. Is this error our fault?                                              │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- Errors at this level are **API design**: stable codes, documented variants, SemVer-governed.
- Adding/renaming/changing error codes follows the same discipline as adding/renaming/changing fields.
- The **anti-corruption layer** keeps infrastructure errors out of the domain — a non-negotiable structural rule.
- Result-in-OO is a powerful tool for **bounded cores**; mimicry across a whole OO codebase usually backfires.
- Errors are **events**: every domain error fires a metric, gets a fingerprint, lands on a dashboard.
- The senior reviewer asks four questions on every error-touching PR — internalize them.
- Library authors and application authors have **different** error responsibilities; conflating them is a common career-level mistake.
- Migrations between error policies are **boundary-first**, never bottom-up.

---

## What You Can Build

- An **error-catalog generator**: YAML → Go/TS/Python bindings + Markdown docs.
- A **Spring `@ControllerAdvice` linter** that flags catch-all `Exception.class` handlers.
- A **Sentry fingerprint plugin** for your stack that groups by code rather than message.
- A **migration tool** that finds `catch (Exception)` sites and suggests the narrowest catch type.
- A **payments SDK** with a fully designed error type — codes, retryability, idempotency.
- A **saga framework** where every step has a typed `Compensation` action paired with its error.
- An **error-budget dashboard** that converts your error catalog into SLO consumption per code.

---

## Further Reading

- *"Error Handling Is API Design"* — Ariya Hidayat, blog.
- *Domain-Driven Design* — Eric Evans (anti-corruption layer chapter).
- *Site Reliability Engineering* — Google (error budgets chapter).
- *Functional Programming in Scala* — Chiusano & Bjarnason (error handling chapter).
- Vavr documentation — [https://docs.vavr.io](https://docs.vavr.io)
- Arrow-kt documentation — [https://arrow-kt.io](https://arrow-kt.io)
- `returns` library — [https://returns.readthedocs.io](https://returns.readthedocs.io)
- Stripe API errors — [https://stripe.com/docs/api/errors](https://stripe.com/docs/api/errors)
- Twilio API errors — [https://www.twilio.com/docs/api/errors](https://www.twilio.com/docs/api/errors)
- AWS error response format — [https://docs.aws.amazon.com/AWSEC2/latest/APIReference/errors-overview.html](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/errors-overview.html)
- OpenTelemetry error semantics — [https://opentelemetry.io/docs/specs/otel/trace/exceptions/](https://opentelemetry.io/docs/specs/otel/trace/exceptions/)
- Sentry fingerprinting — [https://docs.sentry.io/concepts/data-management/event-grouping/](https://docs.sentry.io/concepts/data-management/event-grouping/)
- Rust `#[non_exhaustive]` RFC — RFC 2008.

---

## Related Topics

- [Error Handling — Junior](junior.md)
- [Error Handling — Middle](middle.md)
- [Error Handling — Senior](senior.md)
- [Error Handling — Interview](interview.md)
- [Error Handling — Tasks](tasks.md)
- [Debugging — Professional](../debugging/professional.md)
- [Logging — Professional](../logging/professional.md)
- [Clean Code — Error Handling](../../code-craft/clean-code/06-error-handling/README.md)

---

## Diagrams & Visual Aids

### The Error Lifecycle Across an Org

```text
        creation                propagation              boundary             telemetry
┌────────────────────┐   ┌──────────────────────┐   ┌────────────────┐   ┌──────────────┐
│  domain function   │──▶│   wrap with context  │──▶│  translate to  │──▶│  metric +    │
│  produces typed    │   │   (errors.Wrap,      │   │  HTTP / gRPC   │   │  Sentry +    │
│  domain error      │   │   exception chain)   │   │  / message     │   │  OTel span   │
└────────────────────┘   └──────────────────────┘   └────────────────┘   └──────────────┘
                                                              │
                                                              ▼
                                                    ┌────────────────┐
                                                    │  client sees   │
                                                    │  { code,       │
                                                    │    message,    │
                                                    │    request_id }│
                                                    └────────────────┘
```

### The Anti-Corruption Layer for Errors

```text
       ┌────────────────────────────────────────────────────────────────┐
       │                          DOMAIN                                │
       │                                                                │
       │     OrderNotFound       PaymentDeclined       InventoryLocked  │
       │           ▲                   ▲                     ▲          │
       └───────────┼───────────────────┼─────────────────────┼──────────┘
                   │                   │                     │
                   │   translated by ACL (the "wall")        │
                   │                   │                     │
       ┌───────────┴───────────────────┴─────────────────────┴──────────┐
       │                      INFRASTRUCTURE                            │
       │                                                                │
       │     SQLException       HttpStatusException       IOException   │
       │     ProcessorTimeout   GrpcStatus.UNAVAILABLE                  │
       └────────────────────────────────────────────────────────────────┘
```

### Error Code Versioning Timeline

```text
   v1.0           v1.5                  v2.0                  v3.0
    │              │                     │                     │
    ▼              ▼                     ▼                     ▼
 ERR_CHARGE   ERR_CHARGE +          ERR_PAYMENT          ERR_PAYMENT
   _FAIL      ERR_PAYMENT             _DECLINED             _DECLINED
              _DECLINED              + @deprecated         (legacy gone)
              (dual emit)              ERR_CHARGE_FAIL
                                       (still emitted)
```

### Stripe-Style Error Response Layout

```text
┌──────────────────────── ERROR BODY ───────────────────────┐
│  type         "invalid_request_error"   ← coarse routing  │
│  code         "parameter_missing"       ← stable contract │
│  message      "Missing required..."     ← human-facing    │
│  param        "amount"                  ← UI highlighting │
│  doc_url      "https://..."             ← runbook         │
│  request_id   "req_a1b2c3"              ← correlation key │
└───────────────────────────────────────────────────────────┘
```
