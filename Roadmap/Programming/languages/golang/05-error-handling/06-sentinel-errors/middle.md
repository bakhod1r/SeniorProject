# Sentinel Errors — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Why the Standard Library Has Sentinels](#why-the-standard-library-has-sentinels)
3. [`==` vs `errors.Is`: The Real Difference](#vs-errorsis-the-real-difference)
4. [Wrapping a Sentinel](#wrapping-a-sentinel)
5. [Sentinel Groupings](#sentinel-groupings)
6. [Choosing Sentinels vs Typed Errors](#choosing-sentinels-vs-typed-errors)
7. [The `io.EOF` Pattern in Detail](#the-ioeof-pattern-in-detail)
8. [Cross-Package Sentinel Sharing](#cross-package-sentinel-sharing)
9. [Sentinels as a Public Vocabulary](#sentinels-as-a-public-vocabulary)
10. [Sentinels and Tests](#sentinels-and-tests)
11. [Sentinels and Migrations](#sentinels-and-migrations)
12. [Common Anti-Patterns](#common-anti-patterns)
13. [Performance at the Middle Tier](#performance-at-the-middle-tier)
14. [Summary](#summary)
15. [Further Reading](#further-reading)

---

## Introduction
> Focus: "Why?" and "When?"

At junior level you learned the *mechanic*: declare with `var ErrFoo = errors.New("foo")`, return it, detect with `errors.Is`. At middle level the question becomes harder: *should I use a sentinel for this, or a typed error, or no special error at all?*

This file is the answer set. We unpack **why** the standard library leans on sentinels for some packages and avoids them in others, **when** to wrap and when not to, **how** sentinels evolve as a public API, and the small ways they go wrong in practice.

---

## Why the Standard Library Has Sentinels

Open any major stdlib package and you find sentinels:

```go
io.EOF
io.ErrUnexpectedEOF
io.ErrShortWrite
io.ErrNoProgress
io.ErrClosedPipe

sql.ErrNoRows
sql.ErrTxDone
sql.ErrConnDone

os.ErrNotExist
os.ErrExist
os.ErrPermission
os.ErrClosed
os.ErrNoDeadline

context.Canceled
context.DeadlineExceeded

bufio.ErrBufferFull
bufio.ErrInvalidUnreadByte
bufio.ErrNegativeCount
```

Why? Each represents a *condition the caller is expected to react to specifically*. End-of-stream is not a system failure — it is the normal way a `Read` loop ends. "No rows" is not an error in the dramatic sense — it is one of two valid outcomes of a query.

The pattern: when a function has a small, fixed set of *interesting* outcomes, sentinels give callers a vocabulary to switch on without parsing strings.

The standard library's design rule, roughly: *use a sentinel when the outcome is expected and binary; use a typed error when the outcome carries data.*

---

## `==` vs `errors.Is`: The Real Difference

Pre-Go-1.13 code looks like this:

```go
if err == io.EOF { ... }
if err == sql.ErrNoRows { ... }
```

This works *only* if the error has not been wrapped. The compiler does a plain interface-equality check: same dynamic type *and* same dynamic value.

Post-Go-1.13 code looks like this:

```go
if errors.Is(err, io.EOF) { ... }
if errors.Is(err, sql.ErrNoRows) { ... }
```

`errors.Is` walks the chain produced by `fmt.Errorf("...: %w", ...)`:

```
err  --Unwrap-->  inner  --Unwrap-->  ErrFoo
                                        ^
                                  matches here
```

Both forms work for the simple case. The reason to always prefer `errors.Is`:

- The error you compare today is bare; the error returned tomorrow may be wrapped.
- A library you depend on may decide to wrap its returns at any point.
- A middle layer you do not own may add `fmt.Errorf("layer X: %w", err)`.

`errors.Is` is *forward-compatible*. `==` is not. Cost is identical when nothing is wrapped (one comparison). Use `errors.Is` always.

```go
// good: forward-compatible
if errors.Is(err, io.EOF) { break }

// bad: works today, breaks tomorrow
if err == io.EOF { break }
```

---

## Wrapping a Sentinel

Sentinels alone often lack context. "Not found" — *what* was not found?

```go
return fmt.Errorf("user %d: %w", id, ErrNotFound)
```

Now the `.Error()` reads `user 7: not found`, but `errors.Is(err, ErrNotFound)` is still true. The wrap is the cleanest way to combine a sentinel's identity with a meaningful message.

Three rules of wrapping a sentinel:

1. **Use `%w`, never `%v`.** `%v` flattens to a string and breaks `errors.Is`.
2. **Put the sentinel last in the format args** by convention, paired with `%w`.
3. **Do not wrap a sentinel twice.** A single layer of context per boundary is enough.

```go
// good
return fmt.Errorf("get user %d: %w", id, ErrNotFound)

// bad: %v loses identity
return fmt.Errorf("get user %d: %v", id, ErrNotFound)

// noisy: triple wrap
return fmt.Errorf("layer A: %w",
    fmt.Errorf("layer B: %w",
        fmt.Errorf("layer C: %w", ErrNotFound)))
```

---

## Sentinel Groupings

The standard library mixes sentinels and typed errors in specific patterns:

### `os.ErrNotExist` vs `*os.PathError`

When you call `os.Open("/nope")`, the returned error is a `*os.PathError` (a typed struct holding the operation, path, and underlying error). But the stdlib has wired its `Is` method so that:

```go
errors.Is(err, os.ErrNotExist)  // true
```

returns true when the underlying error is "not exist". You get *both*:
- A typed error you can `errors.As` and read `Path`, `Op` from.
- A sentinel-style match for the kind of failure.

This is the sweet spot: data when you want it, identity when that is all you care about.

### `io.EOF` and `io.ErrUnexpectedEOF`

`io.EOF`: stream ended cleanly at a record boundary.
`io.ErrUnexpectedEOF`: stream ended in the middle of an expected structure.

Both are sentinels; both are valid outcomes; the caller picks which one to handle. A binary parser typically wraps `io.ErrUnexpectedEOF` and returns it as a real error, while treating `io.EOF` as a clean stop.

### `os.ErrNotExist` and `fs.ErrNotExist`

These are *the same value* — `os.ErrNotExist` is an alias for `fs.ErrNotExist`. Why? When `io/fs` was introduced (Go 1.16), the maintainers wanted the new package to have its own sentinels but did not want to break existing code that compares against `os.ErrNotExist`. The fix: assign the same value in both places. `errors.Is` works against either name.

---

## Choosing Sentinels vs Typed Errors

A senior question, but worth introducing now. The decision matrix:

| Need | Use |
|------|-----|
| Tell caller "this kind of thing happened" — no extra data | Sentinel |
| Carry structured data (path, line, field) | Typed error |
| Many related variants | Typed error with a `Kind` field |
| Outcome is binary and expected | Sentinel |
| Outcome is one of dozens | Typed error or kind enum |
| Need to attach a stack trace | Typed error |

Concrete examples:

- `sql.ErrNoRows`: binary outcome ("no row matched"), no extra data — **sentinel**.
- `*json.SyntaxError`: needs to carry `Offset` so the caller can locate the syntax problem — **typed**.
- `*os.PathError`: needs `Op`, `Path`, and the underlying cause — **typed** (and sentinel-shaped via custom `Is`).

A package can mix both, but pick one pattern for each *kind* of failure. Do not have `ErrNotFound` *and* `*NotFoundError` for the same condition.

---

## The `io.EOF` Pattern in Detail

The reason `io.EOF` is the canonical sentinel is that it codifies a critical convention: *some sentinels are not failures*.

The `io.Reader` contract says:

> `Read` reads up to `len(p)` bytes into `p`. It returns the number of bytes read (`0 <= n <= len(p)`) and any error encountered. Even if `Read` returns `n < len(p)`, it may use all of `p` as scratch space during the call. If some data is available but not `len(p)` bytes, `Read` conventionally returns what is available instead of waiting for more.
>
> When `Read` encounters an error or end-of-file condition after successfully reading `n > 0` bytes, it returns the number of bytes read. It may return the (non-nil) error from the same call or return the error (and `n == 0`) from a subsequent call. An instance of this general case is that a `Reader` returning a non-zero number of bytes at the end of the input stream may return either `err == EOF` or `err == nil`. The next `Read` should return `0, EOF`.

Two specific rules emerge:

1. `io.EOF` may come *with* useful bytes (`n > 0, err = io.EOF`). Always use the bytes first, then handle the EOF.
2. The reader is allowed to return `0, nil` once before `io.EOF`. Code must not loop forever waiting for non-empty data without checking for EOF.

A correct read loop:

```go
buf := make([]byte, 4096)
for {
    n, err := r.Read(buf)
    if n > 0 {
        process(buf[:n])
    }
    if errors.Is(err, io.EOF) {
        break
    }
    if err != nil {
        return fmt.Errorf("read: %w", err)
    }
}
```

This shape — *use what you got, then check EOF, then check real errors* — is one of the most important idioms in Go and is *built around the sentinel*.

---

## Cross-Package Sentinel Sharing

Suppose package `users` defines `ErrNotFound`, and package `orders` also has a "not found" condition. Three options:

### Option A: Each package has its own sentinel

```go
package users
var ErrNotFound = errors.New("user not found")

package orders
var ErrNotFound = errors.New("order not found")
```

Independent. No coupling. Callers must check both — not too bad.

### Option B: A shared `errs` package

```go
package errs
var ErrNotFound = errors.New("not found")

// users and orders both import errs and return errs.ErrNotFound
```

One sentinel for many domains. Callers do `errors.Is(err, errs.ErrNotFound)` once. Trade-off: now `users`, `orders`, `errs`, and *every caller* are coupled to the same package.

### Option C: Translation at the boundary

```go
package httpapi

func toStatus(err error) int {
    switch {
    case errors.Is(err, users.ErrNotFound),
         errors.Is(err, orders.ErrNotFound):
        return 404
    }
}
```

Each domain keeps its own sentinel; the API boundary translates. Most realistic for medium-to-large services.

The middle-level wisdom: *do not introduce a shared error package until you actually have three or four packages that need the same vocabulary*. Premature sharing is just unnecessary coupling.

---

## Sentinels as a Public Vocabulary

Once exported, a sentinel is part of the public API. Implications:

- **Renaming is a breaking change.** `users.ErrNotFound` → `users.ErrUserNotFound` requires a major version bump.
- **Removing is a breaking change.** Even if you never returned it again.
- **Changing the message is *not* a breaking change for `errors.Is`** (it compares pointers), but it *is* a breaking change for any code that string-matches `.Error()`. (That code is wrong, but it exists.)

Treat sentinels with the same care as exported function signatures. Document them. Add new ones cautiously. Removing them is the hardest — usually you keep the variable forever and stop returning it.

```go
// Deprecated: ErrLegacyMode is no longer returned. Kept for compatibility.
var ErrLegacyMode = errors.New("legacy mode")
```

---

## Sentinels and Tests

Three idioms:

### Idiom 1: Assert match with `errors.Is`

```go
err := myFunc(badInput)
if !errors.Is(err, ErrInvalidInput) {
    t.Fatalf("got %v, want ErrInvalidInput", err)
}
```

### Idiom 2: Table-driven tests with sentinels

```go
tests := []struct {
    name    string
    input   string
    wantErr error
}{
    {"empty", "", ErrInvalidInput},
    {"missing", "missing-key", ErrNotFound},
    {"ok", "real-key", nil},
}
for _, tt := range tests {
    t.Run(tt.name, func(t *testing.T) {
        _, err := Lookup(tt.input)
        if !errors.Is(err, tt.wantErr) && tt.wantErr != err {
            t.Fatalf("got %v, want %v", err, tt.wantErr)
        }
    })
}
```

The combined check covers the `nil` case (which `errors.Is(nil, nil)` does *not* match — it returns false, so use `==` for the nil case or treat nil as a special branch).

### Idiom 3: Use `errors.Is` in subtests, not `t.Errorf` on the message

```go
// good
if !errors.Is(err, ErrNotFound) { ... }

// bad: brittle
if err.Error() != "not found" { ... }
```

---

## Sentinels and Migrations

Suppose you ship `users.ErrNotFound`, then realize you really want a typed error to carry the missing user ID. How do you migrate without breaking callers?

### Step 1: Add the typed error

```go
type NotFoundError struct {
    ID int
}
func (e *NotFoundError) Error() string {
    return fmt.Sprintf("user %d: not found", e.ID)
}
```

### Step 2: Make it match the sentinel via `Is`

```go
func (e *NotFoundError) Is(target error) bool {
    return target == ErrNotFound
}
```

Now `errors.Is(err, ErrNotFound)` is still true even when `err` is the new typed error. Existing callers keep working. New callers can do `errors.As(err, &nfErr)` to get the ID.

### Step 3: Switch internal returns to the typed error

```go
return &NotFoundError{ID: id}
```

### Step 4: Document the migration

```go
// ErrNotFound is matched by all not-found errors; new code should use
// errors.As to extract a *NotFoundError when the user ID is needed.
var ErrNotFound = errors.New("not found")
```

This is the *additive evolution* pattern: extend without breaking.

---

## Common Anti-Patterns

1. **String-matching the sentinel's message.**
   ```go
   if err.Error() == "not found" { ... }
   ```
   Brittle, locale-sensitive, breaks on wrap.

2. **Defining a sentinel inside a function.**
   ```go
   func find() error {
       return errors.New("not found")  // new value every call
   }
   ```
   Identity comparison fails. Pull to package level.

3. **Returning a *new* error with the same message.**
   ```go
   return errors.New(ErrNotFound.Error())  // not the sentinel
   ```
   Creates a different value. Match never works.

4. **`%v` instead of `%w` when wrapping.**
   ```go
   return fmt.Errorf("op: %v", ErrNotFound)
   ```
   Loses identity. Use `%w`.

5. **Comparing two sentinels for equality.**
   ```go
   ErrA == ErrB  // always false unless they are the same variable
   ```
   They are different pointers. Different "kinds."

6. **Inventing a sentinel for success.**
   ```go
   var ErrOK = errors.New("ok")
   ```
   Use `nil` for success. Always.

7. **Hundreds of sentinels.**
   200 sentinels = no vocabulary, just noise. Switch to a typed error with a `Kind` enum.

---

## Performance at the Middle Tier

A sentinel is the cheapest error in Go. Specifically:

- Declared once at package init: one allocation total, lives in the data segment for the program's lifetime.
- Returning it from a function: *zero* allocation. Just copies a pointer.
- `errors.Is(err, sentinel)`: pointer comparison, plus walking the wrap chain (one Unwrap per layer). Single-digit nanoseconds for unwrapped errors.

Compared to:
- `errors.New("foo")` inside a function: allocates a new `*errorString` per call (~32 B).
- `fmt.Errorf("op: %w", sentinel)`: allocates a `*fmt.wrapError` plus a formatted string (~80–128 B).

If a hot loop returns the same kind of error a million times per second, sentinels are roughly *zero* in the profile. A loop that does `errors.New("...")` per iteration shows up immediately.

The middle-level optimization rule: *if you find yourself allocating a "common" error per call, promote it to a package-level sentinel*.

---

## Summary

At middle level, sentinels stop being a mechanical answer ("declare `var ErrFoo`") and become a design choice. You weigh sentinel vs typed error per failure mode. You wrap with `%w`, never `%v`. You compare with `errors.Is`, never `==`. You curate the set, knowing that exported sentinels are part of the public API. You match the patterns of the standard library — `io.EOF` for end-of-stream, `sql.ErrNoRows` for missing rows, `os.ErrNotExist` for missing files — because those patterns are how Go programmers read code.

---

## Further Reading

- [Working with Errors in Go 1.13 (golang.org/blog)](https://go.dev/blog/go1.13-errors)
- [Don't just check errors, handle them gracefully (Dave Cheney)](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully)
- [Effective Go — Errors](https://go.dev/doc/effective_go#errors)
- [Package errors documentation](https://pkg.go.dev/errors)
- `$GOROOT/src/io/io.go` — `EOF`, `ErrUnexpectedEOF`, `ErrShortWrite`.
- `$GOROOT/src/database/sql/sql.go` — `ErrNoRows`, `ErrTxDone`.
- `$GOROOT/src/os/error.go` — `ErrNotExist`, `ErrPermission`.
- `$GOROOT/src/io/fs/fs.go` — `ErrNotExist` and the `os` aliases.
