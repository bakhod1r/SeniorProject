# Wrapping & Unwrapping Errors — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [How `%w` Actually Works](#how-w-actually-works)
3. [The Walk Algorithm of `errors.Is` and `errors.As`](#the-walk-algorithm-of-errorsis-and-errorsas)
4. [Custom Error Types with `Unwrap`](#custom-error-types-with-unwrap)
5. [Custom `Is` and `As` Methods](#custom-is-and-as-methods)
6. [`errors.Join` and `Unwrap() []error`](#errorsjoin-and-unwrap-error)
7. [Designing a Wrap Chain on Purpose](#designing-a-wrap-chain-on-purpose)
8. [Wrap vs Re-Wrap vs Translate](#wrap-vs-re-wrap-vs-translate)
9. [Patterns Across Layers](#patterns-across-layers)
10. [Wrap-Aware Logging](#wrap-aware-logging)
11. [Wrap and Concurrency](#wrap-and-concurrency)
12. [Backward Compatibility with Go < 1.13](#backward-compatibility-with-go-113)
13. [Testing Wrapped Errors](#testing-wrapped-errors)
14. [Common Anti-Patterns](#common-anti-patterns)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction
> Focus: "How does the chain actually work, and how do I design one?"

At junior level you learned the rules: use `%w`, walk with `errors.Is`/`errors.As`, custom types implement `Unwrap`. At middle level the question becomes: *how does the machinery work, and how do I shape a wrap chain so that callers downstream can do their job?*

This file unpacks the algorithm, the standard library types, and the patterns that real codebases use when their errors flow across packages, layers, and goroutines.

---

## How `%w` Actually Works

`fmt.Errorf` parses the format string. When it sees `%w` it remembers the index of the corresponding argument. After it builds the formatted message, it constructs a wrapper struct.

In `$GOROOT/src/fmt/errors.go` (simplified):

```go
type wrapError struct {
    msg string
    err error
}

func (e *wrapError) Error() string  { return e.msg }
func (e *wrapError) Unwrap() error  { return e.err }
```

So `fmt.Errorf("loading %q: %w", path, err)` returns a `*wrapError` with:
- `msg = "loading 'a.json': no such file or directory"`
- `err = the original error`

Two key properties:
1. **The string already contains the cause's text.** `%w` substitutes the error's `.Error()` into the format string just like `%v` does. The string is not changed by the wrap; it is the *Unwrap link* that is.
2. **`Unwrap` returns the wrapped error.** That is the entire purpose of the type — make the cause reachable.

For multiple `%w` (Go 1.20+), the type is `*fmt.wrapErrors` (with an s):

```go
type wrapErrors struct {
    msg  string
    errs []error
}

func (e *wrapErrors) Error() string    { return e.msg }
func (e *wrapErrors) Unwrap() []error  { return e.errs }
```

The chain becomes a tree. `errors.Is`/`errors.As` walk all branches.

---

## The Walk Algorithm of `errors.Is` and `errors.As`

In `$GOROOT/src/errors/wrap.go` (simplified):

```go
func Is(err, target error) bool {
    if target == nil {
        return err == target
    }
    isComparable := reflectlite.TypeOf(target).Comparable()
    for {
        if isComparable && err == target {
            return true
        }
        if x, ok := err.(interface{ Is(error) bool }); ok && x.Is(target) {
            return true
        }
        switch x := err.(type) {
        case interface{ Unwrap() error }:
            err = x.Unwrap()
            if err == nil { return false }
        case interface{ Unwrap() []error }:
            for _, e := range x.Unwrap() {
                if Is(e, target) { return true }
            }
            return false
        default:
            return false
        }
    }
}
```

What this tells us:

1. **Direct compare first.** If `err == target` (and `target` is comparable), done.
2. **Custom `Is` next.** If the current layer has an `Is(target error) bool` method, call it. This lets a custom type say "I match these targets even though I am not equal to them."
3. **Then unwrap.** If the layer has `Unwrap() error`, descend one level. If `Unwrap() []error`, recurse over each branch.
4. **`nil` ends the walk.** Either explicit `nil` from `Unwrap` or a non-wrapping error.

`errors.As` follows the same skeleton, but instead of `err == target` it checks `reflect.TypeOf(err)` against `target`'s element type. If a layer has an `As(target any) bool` method, it can override.

The walk is **linear in chain length** for single-`Unwrap` chains, **linear in number of nodes** for tree chains. For most code chains are 2–4 deep — both are fast.

---

## Custom Error Types with `Unwrap`

Adding `Unwrap() error` to your own error type makes it part of the chain protocol:

```go
type DBError struct {
    Op    string
    Table string
    Err   error
}

func (e *DBError) Error() string {
    return fmt.Sprintf("db %s on %s: %v", e.Op, e.Table, e.Err)
}

func (e *DBError) Unwrap() error {
    return e.Err
}
```

Now:

```go
err := &DBError{Op: "select", Table: "users", Err: sql.ErrNoRows}

errors.Is(err, sql.ErrNoRows)  // true
```

Without `Unwrap`, the same `errors.Is` would return false — `*DBError` and `sql.ErrNoRows` are different values, and the chain ends at the first node.

**Convention:** name the field `Err`, the method `Unwrap`. Standard library types like `*os.PathError` and `*net.OpError` follow this convention; your code blending in is a nicety.

---

## Custom `Is` and `As` Methods

You can override `errors.Is` and `errors.As` behavior for your own type by implementing the optional methods.

### Custom `Is`

```go
type HTTPError struct {
    Status int
    Msg    string
}

func (e *HTTPError) Error() string {
    return fmt.Sprintf("http %d: %s", e.Status, e.Msg)
}

func (e *HTTPError) Is(target error) bool {
    t, ok := target.(*HTTPError)
    if !ok {
        return false
    }
    return e.Status == t.Status
}
```

Now you can compare two `*HTTPError` values by status alone:

```go
got := &HTTPError{Status: 404, Msg: "user not found"}
want := &HTTPError{Status: 404}
errors.Is(got, want)  // true (because Is matched on Status)
```

Without the custom `Is`, equality would compare *all* fields, and the messages differ. The custom `Is` says "for my type, match by Status."

### Custom `As`

```go
type kindedError struct {
    kind string
    msg  string
}

func (e *kindedError) Error() string { return e.msg }

func (e *kindedError) As(target any) bool {
    if s, ok := target.(*string); ok {
        *s = e.kind
        return true
    }
    return false
}
```

Now `errors.As(err, &someString)` extracts the kind directly. (Most code does not need this — `errors.As` for a typed pointer is enough — but the hook exists for unusual cases.)

**Important rule:** the override is a *positive* override. If your custom `Is` returns false, `errors.Is` continues walking; it does not give up. Same for `As`. So the methods can match more loosely than equality, but they do not block the walk.

---

## `errors.Join` and `Unwrap() []error`

Go 1.20 added `errors.Join`:

```go
err := errors.Join(err1, err2, err3)
```

The return value implements `Unwrap() []error`. `errors.Is` and `errors.As` walk all branches.

Properties:

- Nil arguments are filtered. `errors.Join(nil, err1, nil) == err1` (single non-nil → returned as-is? actually no — it returns a joinError holding [err1]. The behavior is that calling Join on all nils returns `nil`).
- The `.Error()` string is the joined errors' messages separated by newlines.
- The chain is now a tree, not a list. `errors.Is(joined, target)` returns true if any branch contains target.

Example:

```go
package main

import (
    "errors"
    "fmt"
)

var (
    ErrA = errors.New("a")
    ErrB = errors.New("b")
)

func main() {
    err := errors.Join(ErrA, ErrB)
    fmt.Println(err)
    fmt.Println("is A?", errors.Is(err, ErrA))
    fmt.Println("is B?", errors.Is(err, ErrB))
}
```

Use `errors.Join` when the operation has *multiple independent failures* you want to surface — validation that collects all rule violations, fan-out where every goroutine had its own problem, etc.

You can also implement `Unwrap() []error` on your own type if you have a natural multi-cause shape:

```go
type ValidationError struct {
    Field    string
    Failures []error
}

func (v *ValidationError) Error() string  { /* ... */ }
func (v *ValidationError) Unwrap() []error { return v.Failures }
```

Now `errors.Is(verr, ErrTooLong)` searches all your failures.

---

## Designing a Wrap Chain on Purpose

A good wrap chain is one where each layer adds *new* information. Mediocre wrapping just nests.

Bad:
```
"do: do_inner: do_innermost: file does not exist"
```

Each layer just says "the next layer failed." Nothing the reader could not have inferred.

Good:
```
"send notification id=42: render template welcome.html: open templates/welcome.html: no such file or directory"
```

Each layer adds *what it was doing*: the operation, the input, the resource. Reading top-down tells the story.

**Rule of thumb:** ask "if this is the only line in the log, can the reader figure out *what failed* and *which input/resource was involved*?" If not, the wrap is too thin.

---

## Wrap vs Re-Wrap vs Translate

Three actions you can take when receiving an error:

### Wrap
Add context, keep identity:
```go
return fmt.Errorf("send to user %d: %w", id, err)
```
Use for ordinary propagation.

### Re-wrap (rewrap)
Replace the chain with a new error of your own type, but keep a link to the old chain:
```go
return &MyServiceError{Op: "send", Cause: err}
```
Use when you want callers to switch on your own error type while still being able to drill down with `errors.Unwrap`.

### Translate
Drop the cause, return a fresh error from your domain:
```go
if errors.Is(err, sql.ErrNoRows) {
    return ErrNotFound
}
return ErrInternal
```
Use at API boundaries where the caller should not see the underlying source. Internal logs still get the chain via separate logging.

The three differ in what the caller can do:

| Action  | Caller can `errors.Is` original? | Caller can read original message? | Use |
|---------|----------------------------------|------------------------------------|-----|
| Wrap     | Yes | Yes | propagation |
| Re-wrap  | Yes (via Unwrap) | Yes | typed error API |
| Translate| No  | No  | API boundary, security |

---

## Patterns Across Layers

Real services use wrap chains that look like this:

```
HTTP handler:                      |
   wraps with "request <id>"       |
                                   |
   service layer:                  |
      wraps with "user.create"     |
                                   |
      repo layer:                  |
         wraps with "INSERT users" |
                                   |
         db driver returns:        v
            pq: duplicate key value violates unique constraint "users_email_key"
```

The handler's log line becomes:

```
request abc123: user.create: INSERT users: pq: duplicate key value...
```

A reader sees, in order: which request, which operation, which SQL, which DB error. The handler also calls `errors.Is(err, ErrConflict)` to map this whole chain to HTTP 409.

The pattern that produces this:

```go
// repo
func (r *Repo) Insert(u User) error {
    _, err := r.db.Exec("INSERT ...", u.Email)
    if err != nil {
        if isPgUniqueViolation(err) {
            return fmt.Errorf("INSERT users: %w", ErrConflict)
        }
        return fmt.Errorf("INSERT users: %w", err)
    }
    return nil
}

// service
func (s *Service) Create(u User) error {
    if err := s.repo.Insert(u); err != nil {
        return fmt.Errorf("user.create: %w", err)
    }
    return nil
}

// handler
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
    if err := h.svc.Create(...); err != nil {
        log.Printf("request %s: %v", reqID, err)
        switch {
        case errors.Is(err, ErrConflict):
            http.Error(w, "already exists", 409)
        default:
            http.Error(w, "internal", 500)
        }
        return
    }
    w.WriteHeader(201)
}
```

Three layers, three wraps. The repo also did *translation* (Postgres-specific error → domain `ErrConflict`).

---

## Wrap-Aware Logging

Modern structured loggers like `log/slog` understand wrapped errors:

```go
slog.Error("failed", "err", err)
```

Some loggers print the chain on multiple lines or as a list of cause objects. You can implement a `slog.LogValuer` on your error type to control rendering:

```go
func (e *MyErr) LogValue() slog.Value {
    return slog.GroupValue(
        slog.String("op", e.Op),
        slog.String("path", e.Path),
        slog.Any("cause", e.Err),
    )
}
```

Important: log the wrapped error *once*, at the boundary. The chain itself is the log.

---

## Wrap and Concurrency

When you fan out work to goroutines and collect results, wrap each goroutine's error with what it was doing:

```go
g, ctx := errgroup.WithContext(ctx)
for _, id := range ids {
    id := id
    g.Go(func() error {
        if err := process(ctx, id); err != nil {
            return fmt.Errorf("processing id=%d: %w", id, err)
        }
        return nil
    })
}
if err := g.Wait(); err != nil {
    return err
}
```

Without the wrap, the `errgroup` returns the first failure with no context — you cannot tell which `id` blew up.

For "collect all" rather than "first wins," use `errors.Join`:

```go
var (
    errs []error
    mu   sync.Mutex
    wg   sync.WaitGroup
)
for _, id := range ids {
    wg.Add(1)
    go func(id int) {
        defer wg.Done()
        if err := process(id); err != nil {
            mu.Lock()
            errs = append(errs, fmt.Errorf("id=%d: %w", id, err))
            mu.Unlock()
        }
    }(id)
}
wg.Wait()
return errors.Join(errs...)
```

The combined error chains every per-id error. The caller can `errors.Is` to check whether *any* branch matches a known sentinel.

---

## Backward Compatibility with Go < 1.13

If your code must build on Go 1.12 or older (rare in 2024+), `%w` is not available. Two options:

1. **Use `github.com/pkg/errors`.** Its `Wrap` and `Cause` predate stdlib wrapping and offer similar mechanics.
2. **Define your own minimal wrapper.** A struct with `Error` and `Unwrap` methods works back to whatever version had method-on-error support.

For modern code (Go 1.20+), use the stdlib features unconditionally. The third-party packages still exist for historical reasons but are not needed.

---

## Testing Wrapped Errors

A test for a function that returns a wrapped error must check both:

1. **Identity through the chain.** `errors.Is(err, ExpectedSentinel)`.
2. **Optionally, the message contains key context.** `strings.Contains(err.Error(), "op name")`.

Avoid asserting on the *exact* error string — too brittle, breaks on any wording change.

```go
func TestLoadConfig_FileMissing(t *testing.T) {
    _, err := LoadConfig("/nope.json")
    if err == nil {
        t.Fatal("expected error")
    }
    if !errors.Is(err, fs.ErrNotExist) {
        t.Fatalf("expected fs.ErrNotExist, got %v", err)
    }
    if !strings.Contains(err.Error(), "load config") {
        t.Fatalf("expected wrap context 'load config' in message: %v", err)
    }
}
```

For typed errors:

```go
func TestParse_InvalidJSON(t *testing.T) {
    _, err := Parse([]byte("{"))
    var se *json.SyntaxError
    if !errors.As(err, &se) {
        t.Fatalf("expected *json.SyntaxError in chain: %v", err)
    }
    if se.Offset == 0 {
        t.Errorf("expected non-zero offset, got %d", se.Offset)
    }
}
```

---

## Common Anti-Patterns

1. **Re-wrap with no new context.** `fmt.Errorf("%w", err)` is a pure pass-through that allocates. Just `return err` instead.
2. **Wrap and then immediately log.** Pick one. If you wrap, the caller should log; if you log, you do not need to wrap.
3. **Wrap with `%v` on a chain you own.** The downstream caller's `errors.Is` silently fails.
4. **Custom error type without `Unwrap`.** Looks fine, but blocks the chain.
5. **Custom `Is` that always returns true.** Subtle bug — every `errors.Is` against any target matches your error.
6. **`errors.Join` of `nil` arguments.** Not wrong (Join filters nils) but suggests you didn't think about the path.
7. **Wrapping inside a hot loop with no error.** `fmt.Errorf("X: %w", nil)` returns a non-nil error. Always guard `if err != nil` first.
8. **Stringly comparing wrap messages.** `strings.Contains(err.Error(), "not found")` is brittle. Use `errors.Is`.

---

## Summary

At middle level, you understand wrapping as a *protocol*: `%w` plus `Unwrap`/`Is`/`As` define a chain that the standard library's helpers walk. Custom types opt in by implementing the optional methods. Real codebases use multi-layer chains where each layer adds *new* context (operation, input, resource), translation at boundaries to keep callers decoupled, and `errors.Join` for multi-cause situations. The middle-level test of a wrap chain: can the on-call engineer reading the log line at 3 AM tell, in one sentence, what was being done, with what input, and what failed?

---

## Further Reading

- [Working with Errors in Go 1.13 (Damien Neil and Jonathan Amsterdam)](https://go.dev/blog/go1.13-errors)
- [Go 1.20 Release Notes — `errors.Join` and multiple `%w`](https://go.dev/doc/go1.20#errors)
- [Package errors](https://pkg.go.dev/errors)
- [Don't just check errors, handle them gracefully (Dave Cheney)](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully)
- `$GOROOT/src/errors/wrap.go` — read the standard library implementation.
- `$GOROOT/src/fmt/errors.go` — `Errorf` and the wrap types.
