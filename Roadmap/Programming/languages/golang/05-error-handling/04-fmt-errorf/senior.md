# fmt.Errorf — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [`fmt.Errorf` as Error API Plumbing](#fmterrorf-as-error-api-plumbing)
3. [Wrap Strategy at System Scale](#wrap-strategy-at-system-scale)
4. [Layered Translation with `fmt.Errorf`](#layered-translation-with-fmterrorf)
5. [Information Hiding Across Boundaries](#information-hiding-across-boundaries)
6. [The Wrap Chain as Telemetry](#the-wrap-chain-as-telemetry)
7. [Multi-Wrap and Aggregation Strategy](#multi-wrap-and-aggregation-strategy)
8. [Designing Library Errors with `fmt.Errorf`](#designing-library-errors-with-fmterrorf)
9. [Wrap and Concurrency](#wrap-and-concurrency)
10. [Wrap and Context Cancellation](#wrap-and-context-cancellation)
11. [Wrap and Distributed Systems](#wrap-and-distributed-systems)
12. [Performance at Scale](#performance-at-scale)
13. [Anti-Patterns at Scale](#anti-patterns-at-scale)
14. [Architectural Patterns](#architectural-patterns)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction
> Focus: "How to optimize?" and "How to architect?"

At senior level, `fmt.Errorf` is no longer a function you call ad hoc. It is *plumbing*: the standard way to glue context onto errors as they travel through your service. The decisions around it — when to wrap, what to wrap with, how to translate, how much detail to expose — define the debuggability and operability of an entire system.

This file is about *the architecture of wrapping*: the decisions you make once for a service, then live with for years.

---

## `fmt.Errorf` as Error API Plumbing

In a single function, `fmt.Errorf("op: %w", err)` is just a line. In a 50-package service, the same call appears thousands of times. The cumulative effect is your error API.

Three architectural roles `fmt.Errorf` plays:

1. **Context glue.** Every layer adds *its* operation name. The chain becomes a breadcrumb trail.
2. **Identity preservation.** `%w` keeps the sentinel/typed cause findable for `errors.Is`/`errors.As` at the top.
3. **Translation hinge.** When you swap a sentinel mid-chain (e.g. `sql.ErrNoRows` → `ErrNotFound`), `%w` is the verb that does the translation while keeping the new sentinel visible.

If you treat `fmt.Errorf` as just a logging convenience, you lose all three. The senior view treats it as the contract that lets the rest of the error machinery work.

---

## Wrap Strategy at System Scale

A senior engineer answers four questions for a service:

1. **Who wraps?** — Every public function in every package, on the failure path, with its operation name.
2. **What gets wrapped?** — `%w` always, unless deliberately translating to a domain error.
3. **How deep does context go?** — Stop wrapping when you reach the layer boundary. Inside a layer, wrap; across a layer, translate.
4. **How is the chain read?** — Top-level handler walks `errors.Is`/`errors.As` against a small set of domain sentinels.

Without explicit answers, individual contributors invent local conventions and the codebase ends up with a mix of `%w`, `%v`, raw `err.Error()` interpolation, and `panic(err)`. The chain is broken in random places and `errors.Is` returns false unpredictably.

**With** explicit answers, the codebase is uniform. Every error printed at the top has the same shape:

```
http: signup: parse JSON: line 1: invalid character '}'
```

Each segment is one layer's `fmt.Errorf("layer: %w", err)`.

---

## Layered Translation with `fmt.Errorf`

The four-layer pattern, restated in terms of `fmt.Errorf`:

| Layer | What `fmt.Errorf` does |
|-------|------------------------|
| **Storage** | Translate driver errors to domain sentinels: `fmt.Errorf("user %d: %w", id, ErrNotFound)` (when the underlying was `sql.ErrNoRows`). |
| **Domain** | Wrap with operation name: `fmt.Errorf("CreateOrder: %w", err)`. |
| **Transport** | Wrap with request info, then translate to response: `fmt.Errorf("handle %s %s: %w", method, path, err)`. |
| **Edge** | Almost never wraps. Logs full chain; returns a sanitized status to the client. |

The translation at the storage boundary is the most important one. Done right, the domain layer never imports `database/sql`. Done wrong, every domain function has to know about `sql.ErrNoRows`.

```go
// storage layer
func (r *userRepo) Get(id int) (*User, error) {
    var u User
    err := r.db.QueryRow(`SELECT ... WHERE id=$1`, id).Scan(&u.ID, &u.Name)
    switch {
    case errors.Is(err, sql.ErrNoRows):
        return nil, fmt.Errorf("user %d: %w", id, ErrNotFound)
    case err != nil:
        return nil, fmt.Errorf("user %d: query: %w", id, err)
    }
    return &u, nil
}
```

Notice the *swap* of the wrapped error. The driver's sentinel is replaced by the domain's. The original is *not* preserved — and that is on purpose: the domain does not want to leak the driver.

---

## Information Hiding Across Boundaries

`fmt.Errorf("...: %w", err)` *exposes* the wrapped error's text whenever someone calls `.Error()`. That can leak:

- Database schema names (`pq: relation "users" does not exist`).
- File paths (`open /etc/secret/key.pem: permission denied`).
- Internal IDs (`failed to scan row id=1234 user_id=5678`).
- Hostnames or internal addresses.

If the resulting error reaches an HTTP response or log shipped externally, you have leaked operational data.

Two strategies:

### Strategy A: Always wrap; never expose

```go
func (h *Handler) handle(w http.ResponseWriter, r *http.Request) {
    if err := h.svc.Do(r); err != nil {
        log.Printf("internal: %+v", err) // full chain logged internally
        http.Error(w, "internal error", 500) // bland message externally
    }
}
```

Wrap everywhere; never let `err.Error()` reach a client.

### Strategy B: Public-safe message, private cause

```go
type publicError struct {
    publicMsg string
    cause     error
}

func (e *publicError) Error() string  { return e.publicMsg }
func (e *publicError) Unwrap() error  { return e.cause }
```

Now the handler can do:

```go
http.Error(w, err.Error(), status) // safe to send
log.Printf("internal: %v", err)    // unwrap-aware logger gets full chain
```

`fmt.Errorf` plus this typed wrapper gives you both context and safety.

The key senior insight: **wrapping is not exposing**. You can wrap aggressively for telemetry while exposing nothing to the client.

---

## The Wrap Chain as Telemetry

Each `fmt.Errorf("op: %w", err)` is a record-able event. With a structured logger:

```go
log.Error("operation failed",
    "op", "save_user",
    "user_id", u.ID,
    "err", err,
)
```

The structured log pulls the chain out: each level's text becomes a span tag, each `errors.Is` against a sentinel becomes a metric label.

```go
metrics.Counter("errors_total",
    "op", op,
    "kind", classify(err),
).Inc()

func classify(err error) string {
    switch {
    case errors.Is(err, ErrNotFound): return "not_found"
    case errors.Is(err, ErrConflict): return "conflict"
    case errors.Is(err, context.DeadlineExceeded): return "timeout"
    default: return "internal"
    }
}
```

The wrapping discipline pays off in observability: every error has a kind, every kind has a metric.

---

## Multi-Wrap and Aggregation Strategy

`fmt.Errorf` with multiple `%w` is one of two tools for collecting causes; `errors.Join` is the other. Choosing:

| Use | Tool |
|-----|------|
| A small fixed number of *named* errors | `fmt.Errorf("a: %w; b: %w", a, b)` |
| A variable-length list collected in a loop | `errors.Join(errs...)` |
| Two errors where one is a fallback for the other | `fmt.Errorf("primary: %w; fallback: %w", a, b)` |

Multi-`%w` is not a substitute for `errors.Join` and vice versa. The first lets you compose a sentence; the second is for unstructured aggregation.

A common pattern:

```go
func (s *Service) Commit(tx Tx) error {
    if err := tx.Commit(); err != nil {
        if rerr := tx.Rollback(); rerr != nil {
            return fmt.Errorf("commit: %w; rollback: %w", err, rerr)
        }
        return fmt.Errorf("commit: %w", err)
    }
    return nil
}
```

If both fail, the caller sees both. `errors.Is(err, somethingThatRollbackErrIs)` returns true. `errors.Is` against the commit sentinel also returns true.

---

## Designing Library Errors with `fmt.Errorf`

Three patterns for library authors:

### Pattern 1: Sentinel + wrap

```go
package mypkg

var ErrNotFound = errors.New("mypkg: not found")

func Get(id int) (*X, error) {
    // ...
    return nil, fmt.Errorf("Get %d: %w", id, ErrNotFound)
}
```

Caller: `errors.Is(err, mypkg.ErrNotFound)`.

### Pattern 2: Typed error + wrap

```go
type LookupError struct {
    ID  int
    Err error // underlying cause; may be a sentinel
}

func (e *LookupError) Error() string { return fmt.Sprintf("lookup %d: %v", e.ID, e.Err) }
func (e *LookupError) Unwrap() error { return e.Err }
```

Construct with `&LookupError{ID: id, Err: ErrNotFound}`. Caller can both `errors.Is(err, ErrNotFound)` *and* `errors.As(err, &le)` for the ID.

### Pattern 3: Wrap-only opaque

```go
return fmt.Errorf("Get %d: %w", id, internalErr)
```

If callers do not need to inspect, just give them a chain. The text contains everything; identity is preserved through `Unwrap`.

**Rule:** pick one across a package. Mixing makes callers ask "is this `errors.Is` or `errors.As`-friendly?" with no answer.

---

## Wrap and Concurrency

Errors crossing goroutine boundaries via channels do not lose their wrap chain — the chain is part of the value. But a senior engineer thinks about *which goroutine* added each layer:

```go
g, ctx := errgroup.WithContext(ctx)
for _, j := range jobs {
    j := j
    g.Go(func() error {
        if err := j.Run(ctx); err != nil {
            return fmt.Errorf("job %s: %w", j.Name, err)
        }
        return nil
    })
}
if err := g.Wait(); err != nil {
    return fmt.Errorf("batch: %w", err)
}
```

The job-level wrap happens *inside* the goroutine. The batch-level wrap happens *outside* after `g.Wait`. If you wrap at the wrong place, you get useless context like "batch: failed" with no job name.

Rule of thumb: each goroutine wraps with what it knows; the caller of `Wait` adds its own context.

---

## Wrap and Context Cancellation

`context.Canceled` and `context.DeadlineExceeded` deserve preservation through `%w` so the top-level handler can detect them:

```go
select {
case <-ctx.Done():
    return fmt.Errorf("op interrupted: %w", ctx.Err())
case res := <-ch:
    return process(res)
}
```

Up the chain:

```go
if errors.Is(err, context.Canceled) {
    // user closed connection — not a real error
    return
}
```

If you used `%v` instead of `%w`, the canceled identity is lost and every browser-tab-close looks like an internal error. Wrap context errors religiously.

---

## Wrap and Distributed Systems

Across an RPC boundary, the wrap chain does not survive — RPC serializes the error to a string + status code. Wrap discipline before the call helps with logging on the server; you have to *reconstruct* the wrap on the client side from whatever metadata the protocol carries.

A typical pattern:

```go
// server
if err := svc.Do(ctx, req); err != nil {
    log.Printf("internal: %v", err)
    return nil, status.Errorf(codes.NotFound, "user not found")
}

// client
resp, err := client.Do(ctx, req)
if status.Code(err) == codes.NotFound {
    err = fmt.Errorf("client: %w", domain.ErrNotFound)
}
```

The server's chain is logged but not transmitted. The client *re-wraps* with a domain sentinel based on the status code. The middle is a translation, not a transport.

---

## Performance at Scale

`fmt.Errorf` is allocating: 1 to 3 allocations per call. In a typical web service, 1000 errors/sec × 200 ns/error = 0.02% CPU. In a parser running 1M errors/sec, 20% CPU.

Senior knobs:

- **Wrap at boundaries, not in tight loops.** A function that produces an error per byte should not wrap each byte; it should wrap once at the function's exit.
- **Use `errors.New` for static messages.** `fmt.Errorf("static")` is heavier than `errors.New("static")`.
- **Pre-allocate sentinels.** Compare via `errors.Is`. The sentinel allocates once at init.
- **Avoid repeated wrapping inside `defer`** if the function is hot.
- **For multi-wrap in hot paths**, prefer a single `%w` plus aggregation later.

Profile to confirm. Without numbers, do not optimize.

---

## Anti-Patterns at Scale

1. **Universal `%v` in wraps.** Every layer flattens, top-level cannot dispatch, every error becomes "internal error."
2. **No translation at storage boundary.** Domain code starts importing `database/sql` to compare `sql.ErrNoRows`. Layering breaks.
3. **Wrap-with-no-info.** `fmt.Errorf("error: %w", err)` repeated five times. Reads as "error: error: error: error: ..."
4. **Inline secrets.** `fmt.Errorf("auth %q: %w", token, err)` writes the token into every log line.
5. **Mixed sentinel/typed/opaque** in one package. Callers do not know which API to use.
6. **Multi-wrap as a substitute for `errors.Join`** in loops. Fixed argument count vs variadic; using one for the other gets ugly.
7. **Wrap inside a `defer` that fires on every call**, not just on failure. Wraps `nil` and creates a fake error.
8. **Re-wrapping at every function** without adding new info. The chain is twice as long but no more useful.

---

## Architectural Patterns

### Pattern: Error envelope at the API boundary

A single struct that carries the chain plus metadata: request ID, trace ID, timestamp. The chain is the `Unwrap()` target; the metadata is the public face.

### Pattern: Deferred wrap for uniform context

```go
func (s *service) op(arg string) (err error) {
    defer func() {
        if err != nil {
            err = fmt.Errorf("op(%q): %w", arg, err)
        }
    }()
    // body
}
```

Wraps *only* on the failure path, exactly once, with a uniform prefix. Cleaner than five `fmt.Errorf` calls inside.

### Pattern: Translation table

A small package-level helper that classifies an underlying error and re-wraps with a domain sentinel:

```go
func translate(op string, err error) error {
    switch {
    case errors.Is(err, sql.ErrNoRows):
        return fmt.Errorf("%s: %w", op, ErrNotFound)
    case errors.Is(err, context.DeadlineExceeded):
        return fmt.Errorf("%s: %w", op, ErrTimeout)
    default:
        return fmt.Errorf("%s: %w", op, err)
    }
}
```

Keep the storage layer thin and uniform.

### Pattern: Sanitizing wrap

Wrap the cause but expose only a safe message via a typed error. The inner chain is logged; the outer text is what crosses the wire.

---

## Summary

At senior level, `fmt.Errorf` is the load-bearing function for error context across an entire service. The decisions you make — `%w` always, translate at boundaries, hide sensitive details, integrate with telemetry — define how operable the service is in production. Wrap thoughtfully, classify at the top, never let the wrap chain become noise. The job is not "use `%w` instead of `%v`" but "build an error story your service tells consistently from storage to edge."

---

## Further Reading

- [Working with errors in Go 1.13 (golang.org/blog)](https://go.dev/blog/go1.13-errors)
- [Stamping out errors in Go (Cockroach Labs)](https://www.cockroachlabs.com/blog/error-handling-and-go/)
- [Error handling in Upspin](https://commandcenter.blogspot.com/2017/12/error-handling-in-upspin.html)
- [Don't just check errors, handle them gracefully (Dave Cheney)](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully)
- [Google SRE: Handling Overload](https://sre.google/sre-book/handling-overload/)
