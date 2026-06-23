# Simplifying Method Calls — Middle Level

> Trade-offs, language idioms, the boolean parameter trap, and the discipline of API design.

---

## Table of Contents

1. [The boolean parameter trap](#the-boolean-parameter-trap)
2. [Builder pattern as Long Parameter List cure](#builder-pattern-as-long-parameter-list-cure)
3. [Functional options pattern (Go)](#functional-options-pattern-go)
4. [Named arguments](#named-arguments)
5. [Defaults and overloading vs. parameter objects](#defaults-and-overloading-vs-parameter-objects)
6. [Errors-as-values vs. exceptions](#errors-as-values-vs-exceptions)
7. [Factory methods vs. constructors](#factory-methods-vs-constructors)
8. [Visibility decisions](#visibility-decisions)
9. [API evolution and deprecation](#api-evolution-and-deprecation)
10. [Review questions](#review-questions)

---

## The boolean parameter trap

```java
sendNotification(user, true, false, true);
```

Quick: what does that mean?

A signature like `sendNotification(User u, boolean urgent, boolean silent, boolean retry)` makes call sites unreadable. The call site looks like a row in a truth table.

### Cure: Replace Parameter with Explicit Methods

```java
sendUrgentRetryableNotification(user);
sendStandardNotification(user);
```

Or, if combinations are too many:

### Cure: Enum / Flags

```java
enum NotificationOption { URGENT, SILENT, RETRY }
sendNotification(user, EnumSet.of(URGENT, RETRY));
```

### Cure: Builder

```java
notification(user).urgent().retry().send();
```

### When booleans are OK

- One boolean, named clearly: `setEnabled(true)`.
- A `flag` enum disguised as boolean: `playSound(soundEnabled)`.

### Rule

> Two or more booleans in a parameter list = redesign required.

---

## Builder pattern as Long Parameter List cure

When a constructor has 8+ parameters:

### Before

```java
new HttpRequest("GET", "/api/users", headers, body, timeout, retries, gzip, http2, true);
```

### Builder pattern

```java
HttpRequest.builder()
    .get()
    .url("/api/users")
    .headers(headers)
    .timeout(Duration.ofSeconds(5))
    .retries(3)
    .gzip(true)
    .http2(true)
    .build();
```

### Pros

- Each setting is named.
- Optional fields don't pollute the call.
- Validation can happen at `build()`.

### Cons

- More code (the builder class).
- Lombok `@Builder` annotation can auto-generate.
- For records / data classes with sensible defaults, keyword arguments may suffice.

### When NOT

- 2-3 parameters with sensible types — overkill.
- Hot path construction — builder allocates the builder; profile if it matters.

---

## Functional options pattern (Go)

Go's idiomatic answer to long parameter lists:

```go
type Server struct {
    addr    string
    port    int
    tls     bool
    timeout time.Duration
}

type Option func(*Server)

func WithPort(p int) Option { return func(s *Server) { s.port = p } }
func WithTLS() Option { return func(s *Server) { s.tls = true } }
func WithTimeout(d time.Duration) Option { return func(s *Server) { s.timeout = d } }

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{addr: addr, port: 8080}   // defaults
    for _, opt := range opts { opt(s) }
    return s
}

// Caller:
srv := NewServer("0.0.0.0", WithPort(443), WithTLS())
```

This is Go's combination of "factory + builder + named arguments" without language-level support.

---

## Named arguments

Some languages have first-class named arguments:

| Language | Syntax |
|---|---|
| Python | `f(x=1, y=2)` |
| Kotlin | `f(x = 1, y = 2)` |
| Swift | `f(x: 1, y: 2)` |
| Scala | `f(x = 1, y = 2)` |
| C# | `f(x: 1, y: 2)` |

In these languages, Long Parameter List is less of a problem — call sites are self-documenting.

For positional-only languages (Java, Go), Introduce Parameter Object or Builder fills the gap.

> Java has been considering "named parameters" for years. Records and pattern matching get most of the benefit; explicit named args keep getting deferred.

---

## Defaults and overloading vs. parameter objects

When some parameters are commonly defaulted:

### Java overloading

```java
public Result process(Order o) { return process(o, defaultPolicy()); }
public Result process(Order o, Policy p) { return process(o, p, defaultClock()); }
public Result process(Order o, Policy p, Clock c) { ... }
```

Works but: 2^N overloads for N optional parameters. Not scalable.

### Default values

Kotlin:
```kotlin
fun process(o: Order, p: Policy = defaultPolicy(), c: Clock = defaultClock()) {}
```

Python:
```python
def process(o: Order, p: Policy = default_policy(), c: Clock = default_clock()):
    ...
```

### Parameter object with defaults

```java
record ProcessOptions(Policy policy, Clock clock) {
    public ProcessOptions { policy = policy != null ? policy : defaultPolicy(); ... }
}
public Result process(Order o, ProcessOptions opts) { ... }
```

Works in Java; verbose. Builders are more ergonomic for many optional fields.

---

## Errors-as-values vs. exceptions

### Exception languages (Java, C#, Python)

Exceptions are common. The trade-off:
- Pro: Don't pollute happy-path signatures with error types.
- Pro: Stack trace gives context.
- Con: Hidden control flow.
- Con: Performance cost of stack capture.

### Error-as-value languages (Go, Rust)

```go
result, err := process(input)
if err != nil { return err }
```

```rust
let result = process(input)?;
```

- Pro: Errors are visible in signatures.
- Pro: No hidden control flow.
- Pro: Often faster (no stack capture).
- Con: Verbose (Go especially).

### Senior decision

Within Java, **don't reinvent error-as-value**. Use exceptions for errors, return values for normal flow. Use `Result<T, E>` types only when interfacing with libraries that demand them.

Within Go / Rust, embrace error-as-value. Don't fake exceptions with panics for normal control flow.

### Replace Exception with Test

When an exception is being used like a return value:

```java
// Bad:
try { return cache.get(key); } catch (NotFoundException e) { return null; }
```

vs.

```java
// Better:
return cache.contains(key) ? cache.get(key) : null;
```

Or:
```java
return cache.maybeGet(key).orElse(null);   // method returns Optional
```

---

## Factory methods vs. constructors

### Constructor

- Always returns a new instance of *exactly* its declared type.
- Cannot return null or subtypes.
- One per signature.

### Factory method

- Has a name → can convey intent (`Money.fromCents(100)` vs. `new Money(100, ...)` — what's 100?).
- Can return a cached instance (Flyweight, Singleton).
- Can return a subtype (`Number.parse("3")` returns Integer or Long).
- Can fail with null or Optional.
- Can be sealed/private — restricting how new instances are made.

### When to use a factory method

- Multiple ways to construct (`Color.fromRGB(...)`, `Color.fromHSL(...)`).
- Caching (`Currency.of("USD")` returns the cached singleton).
- Polymorphic creation (`Shape.fromKind(kind, ...)`).
- Validation that may fail (`Email.parse(s) -> Optional<Email>`).

### Naming conventions

- `of(...)` — short and idiomatic in modern Java (`List.of`, `Map.of`).
- `from(...)` — conversion (`Duration.fromMillis(...)`).
- `parse(...)` — string input.
- `valueOf(...)` — legacy convention.
- `create(...)` — neutral.

---

## Visibility decisions

When refactoring a method, default to the **smallest possible** visibility:

| Modifier (Java) | When |
|---|---|
| `private` | Default. Only this class needs it. |
| package-private (no modifier) | Same package; tests; closely-collaborating classes. |
| `protected` | Subclasses extend behavior. |
| `public` | External API — make it deliberate. |

### Why default to private

- Smaller API surface = fewer callers to update.
- Future you can refactor freely.
- Tests might want package-private accessors — that's fine; mark it `@VisibleForTesting`.

### When public is right

- The method is genuinely on the type's public contract.
- The library / module exposes it deliberately.

### Hide Method — the discipline

Run periodic sweeps: which `public` methods have only same-class callers? Hide them.

---

## API evolution and deprecation

When refactoring a method that's already public:

### Step 1: Add the new

```java
public Money totalIncludingTax() { ... }       // new
public Money getCharge() {                     // old, marked deprecated
    return totalIncludingTax();
}
```

### Step 2: Annotate

```java
@Deprecated(since = "5.0", forRemoval = true)
public Money getCharge() {
    return totalIncludingTax();
}
```

### Step 3: Wait

Allow callers to migrate. Time depends on:
- Internal: 1-2 sprints.
- Public library: minor version cycle (3-12 months).

### Step 4: Remove

In the next major version, delete the old.

### Tools

- `@Deprecated` (Java).
- `@deprecated` JSDoc tag.
- `#[deprecated(since = "...", note = "...")]` (Rust).
- `from typing import deprecated` (Python 3.13+).
- Fail builds on usage of deprecated APIs (`-Xlint:all -Werror`).

---

## Review questions

1. What's the boolean parameter trap?
2. When should you use a builder vs. parameter object vs. method overloading?
3. What's the functional options pattern in Go, and why is it idiomatic there?
4. When does Replace Exception with Test apply?
5. When does Replace Error Code with Exception apply?
6. When should you choose factory method over constructor?
7. What's the discipline behind defaulting to private?
8. How long should `@Deprecated` exist before removal?
9. Why do named arguments make Long Parameter List less of a problem?
10. When is Encapsulate Downcast a clean refactoring vs. a hack?
