# Handle, Don't Just Check — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [The error Interface](#the-error-interface)
3. [The errors Package](#the-errors-package)
4. [The fmt Package and Wrapping](#the-fmt-package-and-wrapping)
5. [Standard-Library Conventions](#standard-library-conventions)
6. [io: EOF and Error Conventions](#io-eof-and-error-conventions)
7. [os and io/fs: PathError, Sentinels](#os-and-iofs-patherror-sentinels)
8. [net and net/http: Error Patterns](#net-and-nethttp-error-patterns)
9. [database/sql: Error Conventions](#databasesql-error-conventions)
10. [context: Cancellation as a Sentinel](#context-cancellation-as-a-sentinel)
11. [Things the Spec Does NOT Define](#things-the-spec-does-not-define)
12. [References](#references)

---

## Introduction

The Go specification defines `error` as a built-in interface and `panic`/`recover` as control-flow primitives. It says nothing about *how* to handle errors — that is convention, distilled from twenty years of Go practice and from Dave Cheney's essays. This document collects the conventions that the standard library *itself* follows: which patterns are blessed by stdlib usage, which sentinels are part of the public contract, and which idioms every Go programmer can rely on.

Reference: [The Go Programming Language Specification](https://go.dev/ref/spec) §Errors and §Panic. The rest is in `go/doc` style across the standard packages.

---

## The error Interface

From the spec:

```go
type error interface {
    Error() string
}
```

That is the entirety of the language definition. Every value that satisfies `Error() string` is an `error`. There is no special exception class, no checked-vs-unchecked distinction, no language-level mapping to anything.

Conventions enforced by the standard library:

- `Error()` returns lowercase, no trailing punctuation, suitable for concatenation.
- Errors are *values*, comparable to `nil` and to each other when they are sentinels.
- `nil` is the only value that means "no error". Returning a non-nil but "fake" error is a bug pattern (the famous typed-nil pitfall — see 5.10).

---

## The errors Package

From `pkg/errors`:

```go
// New returns an error that formats as the given text.
// Each call to New returns a distinct error value even if the text is identical.
func New(text string) error

// Is reports whether any error in err's chain matches target.
//
// The chain consists of err itself followed by the sequence of errors
// obtained by repeatedly calling Unwrap.
//
// An error is considered to match a target if it is equal to that target
// or if it implements a method Is(error) bool such that Is(target) returns true.
func Is(err, target error) bool

// As finds the first error in err's chain that matches target,
// and if one is found, sets target to that error value and returns true.
//
// The chain consists of err itself followed by the sequence of errors
// obtained by repeatedly calling Unwrap.
func As(err error, target any) bool

// Unwrap returns the result of calling the Unwrap method on err,
// if err's type contains an Unwrap method returning error.
// Otherwise, Unwrap returns nil.
//
// Unwrap only calls a method of the form "Unwrap() error".
// In particular Unwrap does not unwrap errors returned by [Join].
func Unwrap(err error) error

// Join returns an error that wraps the given errors. Any nil error values are discarded.
// Join returns nil if every value in errs is nil.
// (Go 1.20+)
func Join(errs ...error) error
```

`errors.Is` and `errors.As` are the *protocol* between layers. A package returns wrapped errors; the caller inspects them without knowing the wrap shape.

Custom `Is` method:

```go
type MyErr struct{ Code int }
func (e *MyErr) Error() string { return ... }
func (e *MyErr) Is(target error) bool {
    var t *MyErr
    if errors.As(target, &t) {
        return e.Code == t.Code
    }
    return false
}
```

This lets the type opt into "matches" by code rather than by identity.

Custom `As`:

```go
func (e *MyErr) As(target any) bool {
    if t, ok := target.(**MyErr); ok {
        *t = e
        return true
    }
    return false
}
```

Rare; `errors.As` walks the chain by default.

---

## The fmt Package and Wrapping

From `pkg/fmt`:

```go
// Errorf formats according to a format specifier and returns the string as a value
// that satisfies error.
//
// If the format specifier includes a %w verb with an error operand,
// the returned error will implement an Unwrap method returning the operand.
// If there is more than one %w verb, the returned error implements an Unwrap
// method returning a []error containing all the %w operands in order. (Go 1.20+)
//
// It is invalid to include more than one %w verb or to supply it with an
// operand that does not implement the error interface.
func Errorf(format string, a ...any) error
```

The `%w` verb is the bridge: it constructs an error whose `Unwrap()` returns the given operand. `errors.Is`/`errors.As` then walk through. `%v` and `%s` format the *string* of the error but do not preserve the chain — useful when you want to *break* the chain.

Conventions:

- The wrap message goes *before* `%w`: `fmt.Errorf("read user %d: %w", id, err)`.
- Lowercase, no trailing punctuation.
- Include the entity ID and operation; do not include sensitive data.

Multi-wrap (Go 1.20+):

```go
err := fmt.Errorf("step1 failed: %w; step2 failed: %w", err1, err2)
```

`errors.Is(err, err1)` returns true; `errors.Is(err, err2)` also true. The chain becomes a tree — flat for most purposes.

---

## Standard-Library Conventions

The stdlib's own usage demonstrates the rules:

| Convention | Example |
|------------|---------|
| Sentinels in package-level vars | `io.EOF`, `sql.ErrNoRows`, `fs.ErrNotExist` |
| Custom types when the error carries data | `*os.PathError`, `*net.OpError`, `*url.Error` |
| Wrap with operation name | `*os.PathError.Op = "open"` |
| Include the relevant entity | `*os.PathError.Path` |
| Lowercase messages | `"file does not exist"` |
| No trailing punctuation | not `"file does not exist."` |
| `errors.Is` for kind | `errors.Is(err, fs.ErrNotExist)` |
| `errors.As` for data | `var pe *fs.PathError; errors.As(err, &pe)` |

These are not enforced by the compiler. They are enforced by code review and by the muscle memory of every Go programmer who learned the patterns from the standard library. Following them lets your code interoperate with everyone else's.

---

## io: EOF and Error Conventions

From `pkg/io`:

```go
// EOF is the error returned by Read when no more input is available.
// (...) Functions should return EOF only to signal a graceful end of input.
// If the EOF occurs unexpectedly in a structured data stream,
// the appropriate error is either ErrUnexpectedEOF or some other error
// giving more detail.
var EOF = errors.New("EOF")

var ErrUnexpectedEOF = errors.New("unexpected EOF")
var ErrShortWrite    = errors.New("short write")
var ErrShortBuffer   = errors.New("short buffer")
var ErrClosedPipe    = errors.New("io: read/write on closed pipe")
```

`io.EOF` is a successful "end of stream" — a sentinel for state, not failure. The handling rule:

```go
n, err := r.Read(buf)
if errors.Is(err, io.EOF) {
    // graceful end
    return
}
if err != nil {
    // real failure
    return fmt.Errorf("read: %w", err)
}
```

Treating `io.EOF` as an error is a classic beginner mistake. The standard library's design teaches: *some sentinels mean "stop", not "failed".*

---

## os and io/fs: PathError, Sentinels

From `pkg/io/fs` (Go 1.16+):

```go
var (
    ErrInvalid    = errors.New("invalid argument")
    ErrPermission = errors.New("permission denied")
    ErrExist      = errors.New("file already exists")
    ErrNotExist   = errors.New("file does not exist")
    ErrClosed     = errors.New("file already closed")
)
```

These sentinels are the *cross-platform* names. `os.IsNotExist`, `os.IsPermission`, etc. exist for backward compatibility and are aliases that walk the chain.

Custom type: `*PathError`

```go
type PathError struct {
    Op   string
    Path string
    Err  error
}

func (e *PathError) Error() string { return e.Op + " " + e.Path + ": " + e.Err.Error() }
func (e *PathError) Unwrap() error { return e.Err }
func (e *PathError) Timeout() bool { ... }
```

Pattern: *every file operation returns a `*PathError`* wrapping the underlying `errno` translated to a sentinel. Callers either:

- Inspect kind: `errors.Is(err, fs.ErrNotExist)`.
- Inspect data: `var pe *fs.PathError; if errors.As(err, &pe) { fmt.Println(pe.Path) }`.

The same shape repeats in `net.OpError`, `net.DNSError`, `url.Error`, etc.

---

## net and net/http: Error Patterns

From `pkg/net`:

```go
type OpError struct {
    Op     string  // "dial", "read", "write", "accept", ...
    Net    string  // "tcp", "udp", ...
    Source Addr
    Addr   Addr
    Err    error
}

func (e *OpError) Error() string { ... }
func (e *OpError) Unwrap() error { return e.Err }
func (e *OpError) Timeout() bool { ... }
func (e *OpError) Temporary() bool { ... }
```

`Timeout()` and `Temporary()` are *de facto* protocol methods — old style, predating `errors.Is`. Many net errors implement them; they survive for compatibility.

Modern: prefer `errors.Is(err, context.DeadlineExceeded)` and similar. `Temporary` was deprecated as ambiguous and is being removed from new errors.

From `pkg/net/http`:

```go
var (
    ErrAbortHandler           = errors.New("net/http: abort Handler")
    ErrBodyReadAfterClose     = errors.New("http: invalid Read on closed Body")
    ErrHandlerTimeout         = errors.New("http: Handler timeout")
    ErrLineTooLong            = errors.New("header line too long")
    ErrMissingBoundary        = errors.New("...")
    ErrNotMultipart           = errors.New("...")
    ErrNotSupported           = errors.New("feature not supported")
    ErrServerClosed           = errors.New("http: Server closed")
    ErrSkipAltProtocol        = errors.New("...")
    ErrUseLastResponse        = errors.New("...")
)
```

Many sentinels for state-like signals. `http.ErrServerClosed` is what `Server.ListenAndServe` returns on graceful shutdown — handle it as success.

---

## database/sql: Error Conventions

From `pkg/database/sql`:

```go
var (
    ErrConnDone = errors.New("sql: connection is already closed")
    ErrNoRows   = errors.New("sql: no rows in result set")
    ErrTxDone   = errors.New("sql: transaction has already been committed or rolled back")
)
```

Pattern: `Row.Scan` returns `sql.ErrNoRows` when zero rows. Callers translate:

```go
var u User
err := db.QueryRowContext(ctx, "SELECT ... WHERE id=?", id).Scan(&u.ID, &u.Name)
if errors.Is(err, sql.ErrNoRows) {
    return User{}, ErrUserNotFound // domain translation
}
if err != nil {
    return User{}, fmt.Errorf("get user %d: %w", id, err)
}
```

The driver layer returns *driver-specific* errors (PG error codes via `pgx`, MySQL codes via `go-sql-driver/mysql`). Translate at the storage adapter to your domain sentinels.

---

## context: Cancellation as a Sentinel

From `pkg/context`:

```go
var (
    Canceled         = errors.New("context canceled")
    DeadlineExceeded = errors.New("context deadline exceeded")
)
```

`context.Canceled` and `context.DeadlineExceeded` are sentinels for "stop", not "fail". Convention:

```go
if err := op(ctx); err != nil {
    if ctx.Err() != nil {
        return ctx.Err() // surface as cancellation, not error
    }
    return fmt.Errorf("op: %w", err)
}
```

Or, when you control the outer signal:

```go
if errors.Is(err, context.Canceled) {
    return nil // we asked for stop; not an error
}
```

A monitoring system that counts errors should *exclude* context errors from its alarm threshold. Otherwise every shutdown looks like a regression.

---

## Things the Spec Does NOT Define

- **The signature of "handle".** There is no `func handle(error)`. Handling is whatever the writer chooses.
- **The decision menu.** Recover/retry/transform/surface/log/abort is convention.
- **The "log or return" rule.** Convention.
- **When to wrap.** Convention.
- **When to use sentinel vs typed error.** Convention.
- **Whether `Error()` may return empty string.** Implementations that do are arguably broken; the spec does not forbid it.
- **What a "transient" error is.** No standard interface. Each driver decides.
- **The order of sentinels in a chain.** `errors.Is` walks via `Unwrap`; multi-error `Join` returns true if *any* in the chain matches. Order is part of the public contract of the function returning the error.
- **Stack traces.** Not part of the error interface; opt-in via custom types.

This is consistent with Go's design: the language defines what an error *is*; convention defines what to *do* with it. Cheney's essay is the most influential codification of that convention; the standard library's source is the practical reference.

---

## References

- [The Go Programming Language Specification — Errors](https://go.dev/ref/spec#Errors)
- [Package errors](https://pkg.go.dev/errors)
- [Package fmt — Errorf](https://pkg.go.dev/fmt#Errorf)
- [Package io](https://pkg.go.dev/io)
- [Package io/fs](https://pkg.go.dev/io/fs)
- [Package os](https://pkg.go.dev/os)
- [Package net](https://pkg.go.dev/net)
- [Package net/http](https://pkg.go.dev/net/http)
- [Package database/sql](https://pkg.go.dev/database/sql)
- [Package context](https://pkg.go.dev/context)
- [Effective Go — Errors](https://go.dev/doc/effective_go#errors)
- [Go Code Review Comments — Errors, Error Strings](https://go.dev/wiki/CodeReviewComments#errors)
- [Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors)
- [Don't just check errors, handle them gracefully — Dave Cheney](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully)
