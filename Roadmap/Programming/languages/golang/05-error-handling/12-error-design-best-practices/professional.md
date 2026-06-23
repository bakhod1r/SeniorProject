# Error Design — Best Practices — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Cost Model of Error Construction](#the-cost-model-of-error-construction)
3. [Allocation Patterns of Common Idioms](#allocation-patterns-of-common-idioms)
4. [Designing Error Types for Zero Allocation](#designing-error-types-for-zero-allocation)
5. [The `%w` Verb: What `fmt.Errorf` Actually Does](#the-w-verb-what-fmterrorf-actually-does)
6. [Error Equality and Pointer Identity](#error-equality-and-pointer-identity)
7. [Design Evolution: From Sentinel to Family to Code](#design-evolution-from-sentinel-to-family-to-code)
8. [Cross-Process Error Contracts](#cross-process-error-contracts)
9. [Error Versioning Across Major Releases](#error-versioning-across-major-releases)
10. [Errors and Generics](#errors-and-generics)
11. [Thread-Safety of Error Values](#thread-safety-of-error-values)
12. [Compiler and Inliner Interactions](#compiler-and-inliner-interactions)
13. [Summary](#summary)
14. [Further Reading](#further-reading)

---

## Introduction
> Focus: "What happens under the hood?" and "How do I design errors at the limit?"

Senior level was about systems. Professional level is about the limits: the cost of constructing an error, the ABI implications of typed errors, the ways `errors.Is` actually walks the chain, and the design constraints that show up only at very high request rates or in cross-process protocols.

This file is for engineers who have to defend error design against benchmarks and version-skew matrices.

---

## The Cost Model of Error Construction

Reference: Go 1.21, amd64, modern hardware, no instrumentation.

| Operation | Time | Allocs |
|-----------|------|--------|
| `errors.New("msg")` at package level (init once) | 0/call | 0 |
| `errors.New("msg")` per call | ~30 ns | 1 |
| `fmt.Errorf("ctx: %w", err)` | ~150 ns | 2-3 |
| `fmt.Errorf("ctx: %v", err)` | ~120 ns | 1-2 |
| `fmt.Errorf("a %d b %s: %w", id, name, err)` | ~250 ns | 3-4 |
| Comparing with `==` (sentinel) | < 1 ns | 0 |
| `errors.Is(err, target)` chain depth N | ~5N ns | 0 |
| `errors.As(err, &t)` chain depth N | ~10N ns | 0 |
| Custom struct error (`&MyErr{...}`) | ~30 ns | 1 |
| `errors.Join(a, b, c)` | ~80 ns | 1 (slice) |

The dominant cost in `fmt.Errorf` is the `fmt` machinery: it parses the format string, runs the reflect-based argument formatting, and allocates the result string. The `%w` adds a reference store but is otherwise the same as `%v`.

**Implications:**

- A wrap per layer at typical request rates (1k req/s, 5 layers): ~10 µs/req, ~5k allocs/s. Acceptable.
- A wrap inside a hot loop (parser, validator, 1M calls/s): ~150 ms of CPU, millions of allocations. Not acceptable.
- A sentinel comparison is free. There is no reason to avoid `errors.Is`.

For high-throughput paths, see *Designing Error Types for Zero Allocation* below.

---

## Allocation Patterns of Common Idioms

`errors.New(s)`:
```go
func New(text string) error {
    return &errorString{text}
}
```
- One allocation: the `errorString` struct (`{ s string }`, 16 bytes).
- The string `s` is shared with the caller; no copy.
- At package level, the allocation happens once, in `init`.

`fmt.Errorf("ctx: %w", err)`:
1. Format-string parse and arg processing.
2. A `wrapError{msg, err}` struct (`%w` path) — one allocation.
3. The composed message string — one allocation.
4. Possibly an `[]any` for varargs — escape-analysis dependent, often elided.

So 2-3 allocations per `fmt.Errorf` call.

`fmt.Errorf("ctx: %v", err)`:
- Same as `%w` but produces a plain `errorString`, no `wrapError`.
- 1-2 allocations.

`errors.Is(err, target)`:
- No allocation.
- Walks `Unwrap()` and compares with `==` and `Is` method calls.
- Each step is a virtual call (interface dispatch).

`errors.As(err, &t)`:
- No allocation (the target is a stack pointer the caller supplies).
- Walks `Unwrap()` and tries reflect-based type matching at each step.
- Slightly more expensive than `Is` due to reflection.

---

## Designing Error Types for Zero Allocation

For high-throughput error paths, allocation matters. Two techniques:

### Technique 1: Pre-allocated sentinel

```go
var ErrInvalidUTF8 = errors.New("invalid UTF-8")

func decode(b []byte) (string, error) {
    if !utf8.Valid(b) {
        return "", ErrInvalidUTF8  // no allocation
    }
    // ...
}
```

The error value is allocated once at init; every return reuses the same pointer. Compare with `errors.Is` works perfectly.

The trade-off: the sentinel cannot carry per-call data. If callers need to know *which byte* was invalid, you need a typed error and an allocation per failure.

### Technique 2: Stack-allocated typed errors via interface

A typed error is normally `&MyErr{...}` — a heap allocation because it escapes through the `error` interface. But careful design can keep it stack-bound when possible.

In practice, escape analysis usually causes errors returned across function boundaries to escape. This is one of those cases where the compiler is right and you should not fight it.

A more practical approach: pre-allocate a *pool* of errors:

```go
var validationErrPool = sync.Pool{
    New: func() any { return &ValidationError{} },
}

func newValidation(field, reason string) *ValidationError {
    e := validationErrPool.Get().(*ValidationError)
    e.Field = field
    e.Reason = reason
    return e
}

func releaseValidation(e *ValidationError) {
    e.Field = ""
    e.Reason = ""
    validationErrPool.Put(e)
}
```

Caveat: pooling errors is *only* safe if the consumer reliably releases them. For most code paths, this is fragile and the allocation savings are small. **Do not pool errors unless you have a measured hot path and a clear lifecycle.**

### Technique 3: Skip wrapping on cold paths

If you know the wrap context is rarely useful (e.g., a parser that returns error strings to a user who ignores them), do not wrap:

```go
// hot path: cheap sentinel
if !ok { return ErrInvalid }

// cold path: rich wrap
if err := slowOp(); err != nil {
    return fmt.Errorf("slow op on %s: %w", name, err)
}
```

The compiler cannot make this decision for you. Profile, then prune.

---

## The `%w` Verb: What `fmt.Errorf` Actually Does

`fmt.Errorf` with `%w` produces a `*fmt.wrapError`:

```go
type wrapError struct {
    msg string
    err error
}

func (e *wrapError) Error() string { return e.msg }
func (e *wrapError) Unwrap() error { return e.err }
```

Properties:
- Single wrap (`%w` once): produces `*wrapError` whose `Unwrap()` returns one `error`.
- Multiple wraps in Go 1.20+: produces `*wrapErrors` (note the `s`) whose `Unwrap()` returns `[]error`.
- The `msg` is the formatted text *with* the wrapped error's text already substituted. So `e.Error()` does not call `e.err.Error()` again.

Implication for performance: you pay for the format once at construction, not at every `Error()` call.

```go
err := fmt.Errorf("foo: %w", innerErr)
fmt.Println(err.Error())  // does not call innerErr.Error() again
```

If you want lazy formatting (rare), implement your own type whose `Error()` composes on demand. The standard library does not.

### Deep wraps and the chain

A 5-deep wrap chain produces 5 `*wrapError` values. Each is a tiny allocation (~32 bytes). For 1M requests with 5 wraps each, that is 160 MB of short-lived garbage — significant GC pressure.

For high-volume services, design wraps to be 1-2 layers deep, not 5. The structured error approach (Op/Kind/Path) replaces multiple wraps with one struct.

---

## Error Equality and Pointer Identity

Two `errors.New("x")` calls produce two **different** errors:

```go
a := errors.New("x")
b := errors.New("x")
a == b  // false
errors.Is(a, b)  // false
```

This is intentional. Identity, not message text, defines a sentinel. If you want both calls to produce the "same" error, define a package-level sentinel and reuse it.

This also means typed errors with value receivers and identical fields *are* equal:

```go
type myErr struct{ code int }
func (e myErr) Error() string { return "x" }

a := myErr{code: 1}
b := myErr{code: 1}
a == b  // true (value comparison)

errors.Is(myErr{code: 1}, myErr{code: 1})  // true
```

For pointer-receiver types, the values are compared by pointer:

```go
type myErr struct{ code int }
func (e *myErr) Error() string { return "x" }

a := &myErr{code: 1}
b := &myErr{code: 1}
a == b  // false (different pointers)
errors.Is(a, b)  // false unless one implements Is()
```

The implication for design: pointer-receiver typed errors require an `Is` method if you want them to be matchable across construction sites. Most "family" patterns implement `Is` for exactly this reason.

---

## Design Evolution: From Sentinel to Family to Code

A useful evolution path as your service grows:

### Stage 1: Single sentinel

```go
var ErrNotFound = errors.New("not found")
return ErrNotFound
```

Works for one-or-two call sites. Loses context — you cannot tell *which* thing was not found.

### Stage 2: Wrapped sentinel

```go
return fmt.Errorf("user %d: %w", id, ErrNotFound)
```

Adds context; preserves identity. Good for most cases.

### Stage 3: Typed family

```go
type NotFoundError struct{ Resource, Key string }

func (e *NotFoundError) Error() string  { ... }
func (e *NotFoundError) Is(t error) bool { return t == ErrNotFound }
```

Adds *structured* context (callers can read `Resource` directly). Still matchable.

### Stage 4: Structured Error with Kind enum

```go
type Error struct {
    Op    string
    Kind  Kind
    Path  string
    Err   error
}
```

One type, all kinds. Heavier construction but every error is uniform.

### Stage 5: Cross-process error code

```go
type APIError struct {
    Code string `json:"code"`  // "user.not_found"
    // ...
}
```

The internal `Kind` enum maps to a stable string code at the API boundary. The code is the contract; the kind enum can evolve internally.

You do not have to climb this ladder. Most services live happily at stage 2 or 3. Stage 4 is appropriate when *every* layer needs structured access; stage 5 is required for stable public APIs.

---

## Cross-Process Error Contracts

When errors cross process boundaries (RPC, message queue, HTTP), you cannot send a Go error chain. You send:

- A code (string or enum).
- A message (string).
- Optional structured details.

The receiver reconstructs an internal error. Three patterns:

### Pattern: gRPC `status.Status` with details

```go
st, _ := status.New(codes.NotFound, "user not found").WithDetails(
    &errdetails.ResourceInfo{
        ResourceType: "user",
        ResourceName: fmt.Sprintf("%d", id),
    },
)
return st.Err()
```

The receiver decodes:

```go
s, _ := status.FromError(err)
for _, d := range s.Details() {
    if r, ok := d.(*errdetails.ResourceInfo); ok {
        // structured access
    }
}
```

This is the modern recommended approach for gRPC. The proto definitions live in `google.golang.org/genproto/googleapis/rpc/errdetails`.

### Pattern: HTTP JSON with stable codes

```json
{
  "code": "user.not_found",
  "message": "User not found",
  "details": { "user_id": 42 }
}
```

The `code` is the cross-process contract. Documented, versioned, never changed without a major release.

### Pattern: Message queue with kind

A queue message that fails permanently includes the failure kind in its dead-letter envelope:

```json
{
  "original_message": { ... },
  "failure": {
    "kind": "invalid",
    "message": "schema validation failed",
    "ts": "..."
  }
}
```

The dead-letter consumer can sort by kind and triage.

### Common mistakes

- Sending the raw `err.Error()` text as the cross-process contract — couples remote callers to your internal wording.
- Not versioning error codes — adding `user.not_found_v2` because someone changed the meaning of `user.not_found`.
- Forgetting to translate at the *receiving* end — leaking foreign error sentinels into your domain.

---

## Error Versioning Across Major Releases

Errors are part of your public API. They evolve with semver:

| Change | Semver impact |
|--------|---------------|
| Add a new sentinel | minor (additive) |
| Add a field to typed error | minor (additive) |
| Remove or rename a sentinel | major (breaking) |
| Change semantics of a kind | major (breaking, even if name unchanged) |
| Add a new kind to an enum | minor (callers should have a default branch) |
| Stop returning a documented error in favor of another | major |
| Improve error messages | safe (no semver impact, but mind tests) |

For libraries with strict compatibility guarantees (`golang.org/x/exp` graduating to stdlib, for example), every error addition is reviewed. For application code, a CHANGELOG entry is usually enough.

### Deprecation pattern

```go
// Deprecated: use ErrNotFound instead.
var ErrMissing = ErrNotFound
```

Goimports aliasing keeps both working. After two release cycles, remove `ErrMissing`. Tooling (`staticcheck`'s SA1019) warns callers.

---

## Errors and Generics

Generic functions over types that can fail:

```go
type Result[T any] struct {
    Val T
    Err error
}

func Map[T, U any](s []T, f func(T) (U, error)) ([]U, error) {
    out := make([]U, 0, len(s))
    for i, t := range s {
        u, err := f(t)
        if err != nil {
            return nil, fmt.Errorf("at index %d: %w", i, err)
        }
        out = append(out, u)
    }
    return out, nil
}
```

Two design notes:

1. **`error` is not a type parameter.** It is the same `error` interface everywhere. Generics do not change error design.
2. **Resist `Result[T]`-style monadic types.** Idiomatic Go uses `(T, error)`; introducing `Result` adds friction without adding value. Languages where `Result` shines (Rust, Haskell) have language-level support; Go does not.

Use generics in error design when:
- You write a wrapper that propagates errors (retry helpers, transformation pipelines).
- You build typed error containers (`Map[K]error`, `Set[error]`).
- You build telemetry helpers that operate on any error.

Do not use generics to create an error monad. It is not idiomatic and other Go developers will refactor it out.

---

## Thread-Safety of Error Values

By convention, an `error` value should be safe to read from any goroutine. Implementations should not have state-changing `Error()` methods.

Sentinels are trivially safe (immutable). Typed errors are safe if their fields are immutable after construction. The standard library treats this as a contract: errors flow across goroutines all the time.

If you implement an error type with mutable state (a buffer, a counter), you have a thread-safety bug waiting to happen. Always treat constructed errors as immutable values.

```go
// Bad
type MyErr struct{ Visited int }
func (e *MyErr) Error() string {
    e.Visited++  // mutation in Error()!
    return "..."
}

// Good
type MyErr struct{ Field string }  // immutable post-construction
func (e *MyErr) Error() string { return "..." }
```

---

## Compiler and Inliner Interactions

Three points where the compiler influences error design:

### 1. Escape analysis on returns

When you return `&MyErr{...}`, escape analysis says "this struct escapes via the `error` interface" and heap-allocates it. There is no way around this without changing the interface (`Result[T]` patterns, but see above).

### 2. Inlining of `if err != nil { return err }`

A simple error check inlines without overhead. A wrap (`fmt.Errorf`) is too large to inline; the compiler emits a function call.

`errors.Is` is small enough to be inlined for the common single-step case (`err == target`); deeper walks require the actual function. `errors.As` does not inline (uses reflect).

### 3. Interface devirtualization

When the compiler can prove that an `error` is concretely `*MyErr`, it can devirtualize the call to `Error()`. In practice this is rare because errors usually pass through interface boundaries. Profile-guided optimization (Go 1.20+) can speculatively devirtualize, but the gain on error paths is small.

For maximum performance, avoid the `error` interface in hot paths. A `(T, ok bool)` return is faster when "failure" is binary and the caller does not need a message:

```go
func tryFastPath(b []byte) (Token, bool)  // never allocates
func slowParse(b []byte) (Token, error)   // descriptive error
```

The fast path returns `bool`; only the slow path constructs an error. This pattern is in the standard library — `strconv.ParseInt` returns an error, but `strconv.Atoi` is special-cased and `bytes.Cut` returns a bool.

---

## Summary

At professional level, error design is governed by cost models, ABI commitments, and cross-process contracts. The cheap path is a sentinel comparison or a simple wrap; the expensive path is `fmt.Errorf` in a hot loop. Sentinels are pointer-equal across calls; typed errors with pointer receivers are not — design `Is` methods accordingly. Cross-process contracts use stable codes, not Go pointer chains. Error versioning is part of semver. Generics do not change error design; do not introduce `Result[T]`. The compiler sees errors as just another interface — escape analysis usually heap-allocates them, and that is acceptable except in the hottest loops where you should pre-allocate sentinels and skip wrapping. Most of the discipline at this level is *knowing when not to optimize* — the wrap is fine, the allocation is fine, until a benchmark proves otherwise.

---

## Further Reading

- `$GOROOT/src/errors/errors.go` and `$GOROOT/src/errors/wrap.go` — the entire stdlib error machinery.
- `$GOROOT/src/fmt/errors.go` — `fmt.Errorf` and the `wrapError` type.
- [Go Blog — Error Values, Improved](https://go.dev/blog/go1.13-errors)
- [Russ Cox — Error syntax for Go](https://research.swtch.com/go-errors)
- [google.golang.org/grpc/status](https://pkg.go.dev/google.golang.org/grpc/status) — gRPC status with details
- [google.aip.dev/193](https://google.aip.dev/193) — Google AIP for errors
- `go test -bench=. -benchmem` — measure your own paths
- [github.com/cockroachdb/errors](https://github.com/cockroachdb/errors) — production error library
