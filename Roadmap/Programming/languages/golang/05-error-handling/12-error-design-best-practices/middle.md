# Error Design — Best Practices — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Three Shapes Revisited: Cost and Commitment](#the-three-shapes-revisited-cost-and-commitment)
3. [API Stability: What an Error Promises](#api-stability-what-an-error-promises)
4. [Error Families and `Is`-Based Membership](#error-families-and-is-based-membership)
5. [Wrapping Discipline: When `%w`, When `%v`, When Nothing](#wrapping-discipline-when-w-when-v-when-nothing)
6. [Structured Fields: Op, Path, Args, Code](#structured-fields-op-path-args-code)
7. [Don't Just Check, Handle](#dont-just-check-handle)
8. [Return vs Panic: The Real Boundary](#return-vs-panic-the-real-boundary)
9. [Library Errors vs Application Errors](#library-errors-vs-application-errors)
10. [Internationalization and User-Facing Messages](#internationalization-and-user-facing-messages)
11. [Testing Errors Without Brittle Strings](#testing-errors-without-brittle-strings)
12. [Logging vs Returning: One Owner](#logging-vs-returning-one-owner)
13. [Errors Across Goroutines](#errors-across-goroutines)
14. [Context Cancellation Is Not (Really) an Error](#context-cancellation-is-not-really-an-error)
15. [Migrating Pre-1.13 Code](#migrating-pre-113-code)
16. [Anti-Patterns Catalog](#anti-patterns-catalog)
17. [Summary](#summary)
18. [Further Reading](#further-reading)

---

## Introduction
> Focus: "Why?" and "When?"

Junior level taught style: lowercase messages, `%w` for wrapping, sentinels for kinds. At middle level the questions are different: *which shape do I commit my package to?* *how do callers test my errors without the messages becoming a contract?* *what do I do when the same error is logged in three places?*

This file is a working manual for Go error design at the package and service level. It assumes you know the syntax and want to know the *trade-offs*.

---

## The Three Shapes Revisited: Cost and Commitment

| Shape | Caller's tool | What you commit to | Stability cost |
|-------|---------------|--------------------|--|
| Sentinel | `errors.Is(err, ErrX)` | The *identity* of `ErrX` is permanent | High — never change the value |
| Typed | `errors.As(err, &t)` | The *struct* shape and field names | Medium — fields are public API |
| Opaque | `err.Error()` reading | Nothing — you can change everything | Low |

The corollary: **start opaque**. Promote to a sentinel only when callers genuinely need to branch on the kind. Promote to a typed error only when callers need *fields*, not just the kind.

A useful mental rule from Cheney: *only the immediate consumers of an error should care about its shape*. Errors that travel three layers up before anyone branches on them are opaque the whole way; one wrap with context is enough.

### Counter-example: when sentinels are correct from day one

If you are writing a parser and the *only* meaningful caller behavior is "is this end-of-input?", a sentinel beats anything else:

```go
var ErrEOF = errors.New("end of input")
```

`io.EOF` is the canonical case. The bar is whether the caller's *handling code* differs by kind — not whether the kinds *exist* in the world.

---

## API Stability: What an Error Promises

When a function `F` returns an error, it implicitly promises something to its callers. The strength of the promise depends on shape:

- **Opaque**: "I will return non-nil error on failure." Nothing about kind.
- **Sentinel**: "On *this* failure I will return a value matchable to `ErrX`."
- **Typed**: "On *this* failure I will return an error whose chain contains `*Type` with these fields."

Once a caller depends on a stronger promise, you cannot weaken it without breaking them. Common ways teams break their own contracts:

- Renaming `ErrNotFound` to `ErrMissing` (now `errors.Is(err, ErrNotFound)` fails).
- Changing a typed error's pointer-vs-value receivers.
- Adding a new wrap layer that swaps `%w` for `%v` (chain match breaks).
- Releasing a sentinel as a public API "for now" and removing it later.

### Practical guidance

- Mark sentinels exported only if *you mean it*. Lowercase if internal.
- Document the error contract in the function comment: "Returns `ErrNotFound` if the user does not exist."
- For libraries, treat error contracts like any other public API in semver: breaking changes go in major versions.

```go
// GetUser returns the user identified by id. It returns ErrNotFound
// if no such user exists, and a wrapped database error otherwise.
func GetUser(ctx context.Context, id int64) (*User, error)
```

The doc comment is the contract. CI tools like [`exhaustruct`](https://github.com/GaijinEntertainment/go-exhaustruct), [`errcheck`](https://github.com/kisielk/errcheck), and custom analyzers can keep callers honest, but the comment is what humans read.

---

## Error Families and `Is`-Based Membership

You sometimes want a *family* of errors — many concrete errors that all answer "yes, I'm a not-found." That is exactly what `errors.Is` and the `Is(target error) bool` method support.

```go
type NotFoundError struct {
    Resource string
    Key      string
}

func (e *NotFoundError) Error() string {
    return fmt.Sprintf("%s %q not found", e.Resource, e.Key)
}

// Is matches the family sentinel.
func (e *NotFoundError) Is(target error) bool {
    return target == ErrNotFound
}

var ErrNotFound = errors.New("not found")
```

Now any `*NotFoundError` matches `errors.Is(err, ErrNotFound)` *and* the caller can extract structured fields with `errors.As`. Best of both: kind-based handling and field-based diagnostics.

This pattern is how `cockroachdb/errors` does telemetry kinds, how `gRPC` does status codes, and how you can keep flexibility without exporting many sentinels.

---

## Wrapping Discipline: When `%w`, When `%v`, When Nothing

Three choices at every error-returning call site:

### `%w` — wrap so the chain is walkable

Use when:
- The caller may want to identify the cause via `errors.Is`/`errors.As`.
- The error you are wrapping has structured information you want to preserve.

```go
return fmt.Errorf("read %s: %w", path, err)
```

### `%v` — interpolate the message, hide the chain

Use when:
- You explicitly do *not* want the caller to see the inner cause.
- The inner error is a low-level detail (`syscall.Errno`) the caller should not branch on.
- You are converting an internal error to a user-facing one.

```go
return fmt.Errorf("authentication failed: %v", err)  // do not leak the SQL error
```

### No wrap — propagate as-is

Use when you have nothing to add. `if err != nil { return err }` is correct, normal Go.

```go
n, err := io.ReadFull(r, buf)
if err != nil {
    return err  // ReadFull's message is already clear
}
```

### The wrap-or-not heuristic

For each error you return, ask: *what does this give the next reader that they did not already have?*

- A new operation name? → wrap.
- An identifier (path, ID)? → wrap.
- The same sentence in different words? → do not wrap.

A wrap chain that reads like `process item: handle item: do item: connect: refused` is one too many "handles." Three layers wrap, the inner four are noise.

---

## Structured Fields: Op, Path, Args, Code

For services with many error paths, a single struct that carries the structured fields is more useful than free-form messages. The Upspin error pattern (Rob Pike, Andrew Gerrand) is the canonical example:

```go
type Op string

type Error struct {
    Op    Op       // the operation that failed: "users.Get"
    Kind  Kind     // a kind enum: KindNotFound, KindPermission, etc.
    Path  string   // the resource (file path, URL, ID)
    Err   error    // wrapped cause
}

func (e *Error) Error() string {
    var b strings.Builder
    if e.Op != "" {
        b.WriteString(string(e.Op))
        b.WriteString(": ")
    }
    if e.Path != "" {
        b.WriteString(e.Path)
        b.WriteString(": ")
    }
    if e.Kind != 0 {
        b.WriteString(e.Kind.String())
        b.WriteString(": ")
    }
    if e.Err != nil {
        b.WriteString(e.Err.Error())
    }
    return strings.TrimSuffix(b.String(), ": ")
}

func (e *Error) Unwrap() error { return e.Err }
```

Now wraps add structured fields:

```go
return &Error{Op: "users.Get", Path: id, Kind: KindNotFound}
```

And callers can inspect them:

```go
var e *Error
if errors.As(err, &e) {
    if e.Kind == KindNotFound {
        // structured handling
    }
}
```

Structured logging consumes the fields directly:

```go
slog.Error("operation failed", "op", e.Op, "path", e.Path, "kind", e.Kind)
```

The trade-off: more boilerplate at every error site, but every error becomes inspectable, indexable, and translatable. Most large Go services land here.

---

## Don't Just Check, Handle

The phrase comes from Dave Cheney's 2016 talk. The mistake: writing the same `if err != nil { return err }` everywhere because that is what tutorials show.

**Handling means making a decision.** The decisions, by frequency:

1. **Wrap and return** — most common; add operation context and propagate.
2. **Retry** — for transient errors with bounded attempts.
3. **Fall back** — call an alternate path; log a warning.
4. **Translate** — at the boundary, convert to a user-visible error or HTTP code.
5. **Log and continue** — sometimes appropriate; rarely the right answer below the boundary.
6. **Log and exit** — for `main`/init failures.

If your function does only #1, that is fine. If your function *only* does #1 and that is true of every function up the stack, your code is one giant `return err`. Push more decisions higher up, where you have the context to make them.

```go
// Worse: nothing decided
err := step()
if err != nil { return err }

// Better: decide here, where you know
err := step()
switch {
case errors.Is(err, ErrTransient):
    return retry(ctx)
case errors.Is(err, ErrNotFound):
    return ErrUserDoesNotExist  // translate
case err != nil:
    return fmt.Errorf("step: %w", err)
}
```

---

## Return vs Panic: The Real Boundary

The line is not "return for recoverable, panic for fatal." It is **return for things callers can sensibly handle, panic for things callers cannot**.

| Situation | Why | Action |
|-----------|-----|--------|
| File missing | The caller can show "file not found" or fall back. | Return |
| Network down | The caller can retry, log, fail fast. | Return |
| Malformed input | The caller can reject and respond. | Return |
| Required env var missing at startup | Cannot run; no caller can fix. | `log.Fatal` or panic |
| Library invariant violated by caller (nil where non-nil promised) | Caller has a bug. | Panic with a clear message |
| Index out of range on internal slice | Bug in *this* code. | Will panic anyway; do not "fix" by returning |
| Pre-condition you control violated | Bug. | Panic |

Panic is *also* the right response when continuing would corrupt state — for example, an unrecoverable inconsistency in a transaction. The orchestrator restarts; you do not silently keep going.

A library should:
- Panic for misuse (nil to a `Set` that requires non-nil).
- Return for any operational failure.
- Document which is which.
- Recover at the *top* of public entry points if you absolutely must convert a runtime panic to an error (very rare; usually a sign of internal bugs).

---

## Library Errors vs Application Errors

The same Go error machinery serves two very different consumers:

| Consumer | Cares about |
|----------|-------------|
| **Library callers** | Stable identity, `errors.Is`/`As` compatibility, no internal leaks |
| **Application operators** | Useful logs, metrics labels, traceability |

A library should expose a *small* surface of errors and document them. Internal errors should remain unexported.

```go
// Public surface
var (
    ErrNotFound      = errors.New("not found")
    ErrAlreadyExists = errors.New("already exists")
)

// Internal
var errInvalidState = errors.New("internal: invalid state")
```

`errInvalidState` may bubble up through a public method but it is wrapped or translated before crossing the package boundary. Callers should never *match* on it — and because it is unexported, they can't.

Applications, in turn, often *create* an internal error vocabulary (`ErrInternalRetry`, `ErrPermissionDenied`, `ErrQuotaExceeded`) tied to their domain — independent of what every library beneath them produces. The translation between the two happens at the storage / repository / adapter layer.

---

## Internationalization and User-Facing Messages

Go errors are *not* user-facing. The string returned by `err.Error()` is for developers and operators. End users see a different message in their language.

The pattern:

1. **Internal errors** carry kinds, fields, IDs.
2. **At the boundary**, the kind maps to a user-facing message ID: `error.user.not_found`.
3. **The frontend** (or a translation layer) renders the ID in the user's locale.

```go
// internal
return &Error{Kind: KindNotFound, Path: id}

// HTTP boundary
case errors.Is(err, ErrNotFound):
    writeJSON(w, 404, ErrorResponse{
        Code:    "user.not_found",
        Message: t.Translate(ctx, "user.not_found"),
    })
```

Trying to put localized text in `err.Error()` is wrong on multiple levels: it makes logs harder to read, it couples your error definitions to your translation system, and it commits you to translating every internal error message.

**Rule:** Errors are in English. User-facing text is generated at the edge.

---

## Testing Errors Without Brittle Strings

Three good ways:

### 1. Identity (sentinel)

```go
if !errors.Is(err, ErrNotFound) {
    t.Fatalf("want ErrNotFound, got %v", err)
}
```

Stable across message tweaks.

### 2. Type extraction

```go
var ve *ValidationError
if !errors.As(err, &ve) {
    t.Fatalf("want *ValidationError, got %T", err)
}
if ve.Field != "age" {
    t.Errorf("got field %q, want age", ve.Field)
}
```

Tests the *structure* you contracted to, not the string.

### 3. The `Is` method on a type

```go
type myErr struct{ kind string }
func (e *myErr) Is(target error) bool {
    me, ok := target.(*myErr)
    return ok && me.kind == e.kind
}
```

Custom equality without exposing fields.

### What to avoid

```go
// Bad
if !strings.Contains(err.Error(), "not found") {
    t.Fatal(...)
}
```

This binds the test to the message. The next time someone improves the wording — or adds a wrap that prepends operation context — the test breaks for no reason. String matching is the *fragile* check.

If your test is comparing string output (e.g., a CLI's stderr message), that is a different test: it is asserting on the *user-visible output*. Use a golden file or an exact-match assertion, but keep that separate from "did the right error kind come out of this function."

---

## Logging vs Returning: One Owner

A common pathology in growing codebases:

```
storage.go:    log.Printf("query failed: %v", err); return err
service.go:    log.Printf("get user failed: %v", err); return err
handler.go:    log.Printf("handler failed: %v", err); http.Error(...)
```

One failed query produces three log lines, in unpredictable order, with overlapping content. Operators learn to ignore them.

The fix: **only one place logs**. Below the boundary, every layer wraps and returns. The boundary logs once with full context.

```go
// storage
return fmt.Errorf("query user %d: %w", id, err)

// service
return fmt.Errorf("get user: %w", err)

// handler
if err != nil {
    log.Printf("[%s] %v", reqID, err)  // single source of truth
    http.Error(w, "internal", 500)
}
```

The single log line reads `[req-1234] get user: query user 42: connection refused`. One entry, full chain, easy to correlate.

This rule has a corollary for tests: if your test triggers an error path and the production code logs *and* returns, you may see noise in test output. Move the logging up.

---

## Errors Across Goroutines

A goroutine that fails silently is a bug. The error must reach a caller that owns it.

### Pattern: errgroup

```go
g, ctx := errgroup.WithContext(ctx)

for _, item := range items {
    item := item
    g.Go(func() error {
        return process(ctx, item)
    })
}

if err := g.Wait(); err != nil {
    return fmt.Errorf("batch: %w", err)
}
```

`errgroup` cancels the context on the first error and surfaces it from `Wait`. Standard library for fan-out work.

### Pattern: result channel

```go
errs := make(chan error, n)
for _, item := range items {
    item := item
    go func() { errs <- process(item) }()
}
for i := 0; i < n; i++ {
    if err := <-errs; err != nil {
        return err
    }
}
```

When you need all errors (not just first), collect them and `errors.Join` at the end:

```go
var all []error
for i := 0; i < n; i++ {
    if err := <-errs; err != nil {
        all = append(all, err)
    }
}
return errors.Join(all...)
```

### Anti-patterns

- A goroutine that calls `log.Println(err); return` and then exits — error invisible to the caller.
- A goroutine that writes to a *nil* error channel — deadlock at the receiver.
- A `go` call from a function that owns the error — caller never sees the failure.

The general rule: **never `go func() { ... return err }()` and lose the error**. Either use `errgroup`, route the error through a channel, or rethink the design.

---

## Context Cancellation Is Not (Really) an Error

`context.Canceled` and `context.DeadlineExceeded` are returned by functions that respect context. Strictly they are errors, but they usually mean *the caller asked us to stop* — not a system failure.

Consequences for design:

- **Do not log them as errors.** They are normal flow.
- **Do not page on them.** If your alert fires every time a user closes a connection, your alert is wrong.
- **Translate them at the boundary** — usually to a 499 (client closed request) or simply to nothing, since the client is gone.

```go
err := f(ctx)
switch {
case errors.Is(err, context.Canceled):
    return nil  // not an error from our perspective
case errors.Is(err, context.DeadlineExceeded):
    return fmt.Errorf("deadline: %w", err)
case err != nil:
    return err
}
```

A subtle point: if your *own* timeout fires (a deadline you set), `DeadlineExceeded` *is* an operational error you should log. If the *caller's* deadline fires, it is the caller's problem. Distinguishing them requires care — usually by inspecting which context produced the deadline.

---

## Migrating Pre-1.13 Code

Before Go 1.13, errors had no chain. Common pre-1.13 patterns and their modern replacements:

| Pre-1.13 | Modern |
|----------|--------|
| `pkg/errors.Wrap(err, "ctx")` | `fmt.Errorf("ctx: %w", err)` |
| `pkg/errors.Cause(err)` | `errors.Unwrap` chain (or `errors.As`) |
| `errors.New("x").(*MyErr)` type assertion on outer | `var e *MyErr; errors.As(err, &e)` |
| `if err == ErrFoo` after wrap | `errors.Is(err, ErrFoo)` |
| `pkg/errors.WithStack(err)` | Custom error type with stack (topic 8), or `cockroachdb/errors` |
| Long `if err == X || err == Y` chains | Sentinel families with `Is` method |

### Migration steps

1. Replace `pkg/errors.Wrap` with `fmt.Errorf(... %w ...)`.
2. Replace direct `==` comparison of errors with `errors.Is`.
3. Replace type assertions with `errors.As`.
4. Audit messages: lowercase, no trailing dots, no "error:" prefix.
5. Audit logging: remove duplicate logs.
6. Audit panics: convert operational ones to returns; keep programmer ones.

Tools that help:
- `errcheck` — flag unchecked errors.
- `errorlint` — flag wrong wrap usage, type assertions, comparisons.
- `staticcheck` — many error-related checks (SA1006, SA4006, etc.).

---

## Anti-Patterns Catalog

A non-exhaustive collection. Each is a real thing seen in real code.

### 1. `error: %w` boilerplate

```go
return fmt.Errorf("error: %w", err)  // adds nothing
```

### 2. Capitalized, punctuated messages

```go
return errors.New("Could not find user.")  // composes badly
```

### 3. Hidden side effects in `Error()`

```go
func (e *MyErr) Error() string {
    e.callCount++  // !!!
    return "..."
}
```

`Error()` should be pure. Logging frameworks may call it many times.

### 4. Stringly-typed handling

```go
if strings.Contains(err.Error(), "not found") { ... }
```

Brittle, slow, breaks under wraps.

### 5. Panicking for control flow

```go
defer func() { recover() }()
panic("done")  // used as `goto`
```

Always wrong. Refactor.

### 6. Swallowing

```go
_ = f()  // pretend nothing can go wrong
```

Either the function cannot fail (then change the signature) or you are hiding a bug.

### 7. Silent goroutine errors

```go
go func() { _ = doWork() }()
```

Where does the failure go? Nowhere. This is a leak of bad outcomes.

### 8. Logging twice

```go
log.Printf("step failed: %v", err)
return err  // caller logs again
```

### 9. Sentinels with embedded data

```go
var ErrCannotConnect = fmt.Errorf("cannot connect to %s", host)  // changes per init?
```

Sentinels must be constants of identity. Move data into wrap context.

### 10. Public sentinels for everything

```go
var (
    ErrA, ErrB, ErrC, ErrD, ErrE, ErrF = ...  // 47 of these
)
```

Every export is a commitment. Most of these should be unexported or a single family.

### 11. Mixed wrap verbs

```go
err := fmt.Errorf("a: %w", inner)
err = fmt.Errorf("b: %v", err)  // chain broken
```

Once you `%v`, the chain is dead.

### 12. Returning `nil` typed pointer as `error`

```go
var p *MyErr  // nil
return p      // not nil!
```

Always return literal `nil` when there's no error.

---

## Summary

Middle-level error design is about commitments and consistency. Sentinels lock in identity; typed errors lock in shape; opaque errors commit to nothing — start there and escalate when callers need more. Wrap to add information, not boilerplate. Test on identity and structure, never on string content. Log once at the boundary. Keep panics for programmer mistakes; return everything else. Move pre-1.13 wraps to `%w`, type assertions to `errors.As`, equality checks to `errors.Is`. Errors are part of your API surface — they deserve the same review effort you give a function signature.

---

## Further Reading

- [Dave Cheney — Don't just check errors, handle them gracefully](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully)
- [Rob Pike, Andrew Gerrand — Error handling in Upspin](https://commandcenter.blogspot.com/2017/12/error-handling-in-upspin.html)
- [Go Blog — Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors)
- [Russ Cox — Why Go's error handling is awesome](https://research.swtch.com/go-errors)
- [Failure is your domain](https://middlemost.com/posts/failure-is-your-domain/) — Ben Johnson
- [github.com/cockroachdb/errors](https://github.com/cockroachdb/errors)
- [errcheck](https://github.com/kisielk/errcheck), [errorlint](https://github.com/polyfloyd/go-errorlint), [staticcheck](https://staticcheck.dev/)
