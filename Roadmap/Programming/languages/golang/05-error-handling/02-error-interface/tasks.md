# error interface — Tasks

> Hands-on exercises focused on the `error` interface itself: building custom error types, choosing receivers, behavioral interfaces, embedding, custom `Is`/`As`, and method-set rules. Difficulty: easy → hard.

---

## Task 1 (Easy) — Implement the simplest custom error

Define a struct `NotFoundError` with a single field `Resource string`. Implement `Error()` so the message is `"not found: <resource>"`. Write a function `Find(name string) (string, error)` that returns `&NotFoundError{Resource: name}` when `name == ""` and `"ok"` otherwise.

**Hints**
- Use a pointer receiver.
- Verify it satisfies `error` by assigning to `var e error`.

**Solution**
```go
package main

import "fmt"

type NotFoundError struct {
    Resource string
}

func (e *NotFoundError) Error() string {
    return "not found: " + e.Resource
}

func Find(name string) (string, error) {
    if name == "" {
        return "", &NotFoundError{Resource: name}
    }
    return "ok", nil
}

func main() {
    _, err := Find("")
    fmt.Println(err)              // "not found: "
    _, err = Find("user")
    fmt.Println(err == nil)       // true
}
```

---

## Task 2 (Easy) — Value receiver for a string-typed error

Define `type ErrCode string` so it satisfies the `error` interface. Define three constants (`ErrInvalid`, `ErrTimeout`, `ErrShutdown`). Write `validate(x int) error` that returns `ErrInvalid` if `x < 0`, `ErrTimeout` if `x > 1000`, `nil` otherwise.

**Hints**
- A named string type can have methods.
- Constants can be of named string types.
- The `Error()` method just returns `string(e)`.

**Solution**
```go
package main

import "fmt"

type ErrCode string

func (e ErrCode) Error() string { return string(e) }

const (
    ErrInvalid  ErrCode = "invalid value"
    ErrTimeout  ErrCode = "timeout"
    ErrShutdown ErrCode = "shutting down"
)

func validate(x int) error {
    switch {
    case x < 0:
        return ErrInvalid
    case x > 1000:
        return ErrTimeout
    }
    return nil
}

func main() {
    fmt.Println(validate(-1))    // invalid value
    fmt.Println(validate(2000))  // timeout
    fmt.Println(validate(50) == nil)  // true
    fmt.Println(validate(-1) == ErrInvalid)  // true (value identity)
}
```

---

## Task 3 (Easy → Medium) — Empty struct error vs sentinel

Define `type ShutdownError struct{}` with an `Error()` method on the *value receiver*. Write a top-level constant-style sentinel `var ErrShutdown = ShutdownError{}`. Write a function `tryStart(running bool) error` that returns `ErrShutdown` when not running. Verify two checks: `err == ErrShutdown` and `errors.Is(err, ErrShutdown)`.

**Hints**
- Empty struct compares equal to itself by value.
- Both checks should pass.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

type ShutdownError struct{}

func (ShutdownError) Error() string { return "system is shutting down" }

var ErrShutdown = ShutdownError{}

func tryStart(running bool) error {
    if !running {
        return ErrShutdown
    }
    return nil
}

func main() {
    err := tryStart(false)
    fmt.Println(err == ErrShutdown)              // true
    fmt.Println(errors.Is(err, ErrShutdown))     // true
}
```

---

## Task 4 (Medium) — Pointer receiver mistake — fix it

The following code does not compile. Identify why and fix it.

```go
package main

import "fmt"

type Foo struct{ Msg string }
func (f *Foo) Error() string { return f.Msg }

func wrap(msg string) error {
    return Foo{Msg: msg}  // ?
}
```

**Hints**
- The `Error()` method has a pointer receiver.
- Method set of value `Foo` does *not* include `Error()`.

**Solution**
```go
package main

import "fmt"

type Foo struct{ Msg string }
func (f *Foo) Error() string { return f.Msg }

func wrap(msg string) error {
    return &Foo{Msg: msg}  // pointer
}

func main() {
    err := wrap("hi")
    fmt.Println(err)
}
```

The fix: return `&Foo{...}`, not `Foo{...}`. Only `*Foo` is in the method set with `Error()`.

---

## Task 5 (Medium) — Embed `error` to add a Field

Write a `ValidationError` type that embeds `error` and adds a `Field string`. Provide a constructor `NewValidationError(field string, cause error) *ValidationError`. Show that the outer struct satisfies `error` automatically (no need to write `Error()` yourself), and show that `errors.Is(ve, cause)` does *not* work without `Unwrap()`. Then add `Unwrap()` and show that it does work.

**Hints**
- Embedding promotes methods.
- `Unwrap()` must be defined explicitly.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

type ValidationError struct {
    error
    Field string
}

func NewValidationError(field string, cause error) *ValidationError {
    return &ValidationError{error: cause, Field: field}
}

// Without this method, errors.Is cannot see through.
func (e *ValidationError) Unwrap() error { return e.error }

var ErrEmpty = errors.New("empty")

func main() {
    ve := NewValidationError("email", ErrEmpty)
    fmt.Println(ve)                          // "empty" (delegated)
    fmt.Println(ve.Field)                    // "email"
    fmt.Println(errors.Is(ve, ErrEmpty))     // true (via Unwrap)
}
```

---

## Task 6 (Medium) — Behavioral interface `Temporary`

Define an interface `Temporary { Temporary() bool }`. Define a custom error `*RateLimitError` with `Error()` and `Temporary()` (returning true). Write `process(err error) string` that returns `"retry"` if the error implements `Temporary` and reports temporary, `"fail"` otherwise.

**Hints**
- Use a type assertion or `errors.As` with a target of interface type.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

type Temporary interface {
    Temporary() bool
}

type RateLimitError struct{ RetryAfter int }

func (e *RateLimitError) Error() string  { return fmt.Sprintf("rate limited, retry after %ds", e.RetryAfter) }
func (e *RateLimitError) Temporary() bool { return true }

func process(err error) string {
    var t Temporary
    if errors.As(err, &t) && t.Temporary() {
        return "retry"
    }
    return "fail"
}

func main() {
    fmt.Println(process(&RateLimitError{RetryAfter: 5}))  // retry
    fmt.Println(process(errors.New("permanent")))         // fail
}
```

---

## Task 7 (Medium) — Custom `Is` for value-equality

Define `*HTTPError` with field `Status int`. Without a custom `Is`, comparing two distinct instances with the same Status yields false (different pointers). Implement a custom `Is(target error) bool` so `errors.Is(e1, e2)` is true when both are `*HTTPError` and have the same `Status`.

**Hints**
- Type-assert the target.
- Compare the relevant field.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

type HTTPError struct {
    Status int
    Msg    string
}

func (e *HTTPError) Error() string { return fmt.Sprintf("http %d: %s", e.Status, e.Msg) }

func (e *HTTPError) Is(target error) bool {
    t, ok := target.(*HTTPError)
    return ok && e.Status == t.Status
}

func main() {
    e1 := &HTTPError{Status: 404, Msg: "not found"}
    e2 := &HTTPError{Status: 404}
    fmt.Println(e1 == e2)                // false  (different pointers)
    fmt.Println(errors.Is(e1, e2))       // true   (custom Is matches)
}
```

---

## Task 8 (Medium) — Compose multiple interfaces

Define `*APIError` with fields `Status int`, `Msg string`, `Cause error`. Implement `Error()`, `Unwrap()`, and `StatusCode() int`. Define an interface `StatusCoder { StatusCode() int }`. Write `httpStatus(err error) int` that returns the status from any error chain that contains a `StatusCoder`, or `500` otherwise.

**Hints**
- Use `errors.As` with a target of interface type `StatusCoder`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

type APIError struct {
    Status int
    Msg    string
    Cause  error
}

func (e *APIError) Error() string {
    if e.Cause != nil {
        return fmt.Sprintf("api %d: %s: %v", e.Status, e.Msg, e.Cause)
    }
    return fmt.Sprintf("api %d: %s", e.Status, e.Msg)
}

func (e *APIError) Unwrap() error  { return e.Cause }
func (e *APIError) StatusCode() int { return e.Status }

type StatusCoder interface {
    StatusCode() int
}

func httpStatus(err error) int {
    var sc StatusCoder
    if errors.As(err, &sc) {
        return sc.StatusCode()
    }
    return 500
}

func main() {
    err := fmt.Errorf("wrapping: %w", &APIError{Status: 404, Msg: "missing"})
    fmt.Println(httpStatus(err))            // 404
    fmt.Println(httpStatus(errors.New("x"))) // 500
}
```

---

## Task 9 (Medium → Hard) — Comparable pitfall

Write a small program that demonstrates the panic when comparing two `error` values whose dynamic type contains a slice. Then fix it by changing to a pointer receiver.

**Hints**
- A slice is not comparable.
- `errors.Is` falls into `==` and panics.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

// Step 1: demonstrate the panic.
type BadErr struct{ Tags []string }
func (BadErr) Error() string { return "bad" }

// Step 2: pointer receiver version is comparable by pointer identity.
type GoodErr struct{ Tags []string }
func (e *GoodErr) Error() string { return "good" }

func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered from BadErr panic:", r)
        }
    }()

    var a error = BadErr{Tags: []string{"x"}}
    var b error = BadErr{Tags: []string{"x"}}
    fmt.Println(errors.Is(a, b))  // panic: comparing uncomparable type

    // Pointer receiver does not panic; identity is by pointer.
    g := &GoodErr{Tags: []string{"x"}}
    fmt.Println(errors.Is(g, g))  // true (same pointer)
}
```

The lesson: error structs containing slices, maps, or functions must use pointer receivers, *or* must avoid `errors.Is`. Standard library types are always comparable.

---

## Task 10 (Hard) — Sealed error interface

Build a package-private "sealed" error interface so that only types in your package can satisfy it. External packages can read the interface but cannot construct it.

**Hints**
- Add an unexported method like `sealed()`.
- Implement it on each internal error type.
- An external package cannot call or implement an unexported method.

**Solution**
```go
package main

import "fmt"

// In a real package, these would be in db/errors.go.

type Error interface {
    error
    Code() string
    sealed()
}

type notFound struct{ Resource string }

func (e *notFound) Error() string { return "not found: " + e.Resource }
func (e *notFound) Code() string  { return "NOT_FOUND" }
func (e *notFound) sealed()       {}

type conflict struct{ Field string }

func (e *conflict) Error() string { return "conflict: " + e.Field }
func (e *conflict) Code() string  { return "CONFLICT" }
func (e *conflict) sealed()       {}

func NewNotFound(r string) Error { return &notFound{Resource: r} }
func NewConflict(f string) Error { return &conflict{Field: f} }

func main() {
    var e Error = NewNotFound("user")
    fmt.Println(e.Error())  // not found: user
    fmt.Println(e.Code())   // NOT_FOUND

    switch e.(type) {
    case *notFound:
        fmt.Println("kind: not found")
    case *conflict:
        fmt.Println("kind: conflict")
    }
}
```

A switch over `Error` is exhaustive in practice because external code cannot add cases. Note: the unexported method makes the interface "external implementations forbidden" — useful for invariants.

---

## Task 11 (Hard) — Wrap-aware FileError with Is and Unwrap

Define `*FileError` carrying `Op string`, `Path string`, `Err error`. Implement `Error()`, `Unwrap()`, *and* a custom `Is(target error) bool` that returns true if `target` is a `*FileError` with the same `Op` and `Path` (regardless of inner cause). Verify all three behaviors:

1. `errors.Is(err, sentinel)` traverses to find the inner sentinel.
2. `errors.Is(e1, e2)` matches by Op+Path.
3. `errors.As(err, &fe)` extracts the `*FileError`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "io/fs"
)

type FileError struct {
    Op   string
    Path string
    Err  error
}

func (e *FileError) Error() string {
    return fmt.Sprintf("%s %q: %v", e.Op, e.Path, e.Err)
}

func (e *FileError) Unwrap() error { return e.Err }

func (e *FileError) Is(target error) bool {
    t, ok := target.(*FileError)
    return ok && e.Op == t.Op && e.Path == t.Path
}

func main() {
    err := &FileError{Op: "open", Path: "/etc/foo", Err: fs.ErrNotExist}

    // 1. wrapped sentinel reachable via Unwrap.
    fmt.Println(errors.Is(err, fs.ErrNotExist))                                // true
    // 2. structural equivalence via custom Is.
    fmt.Println(errors.Is(err, &FileError{Op: "open", Path: "/etc/foo"}))      // true
    // 3. type extraction via errors.As.
    var fe *FileError
    fmt.Println(errors.As(err, &fe), fe.Path)                                  // true /etc/foo
}
```

---

## Task 12 (Hard) — Custom As to expose adapter form

Define `*WrappedDBError` that wraps a `*DBError` with extra metadata. Write a custom `As(target any) bool` so that callers expecting a `*DBError` get the inner one (without writing the wrapper into them).

**Hints**
- Type-assert `target` as `**DBError`.
- Assign `*pp = e.Inner`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

type DBError struct {
    Code string
    Msg  string
}

func (e *DBError) Error() string { return fmt.Sprintf("db %s: %s", e.Code, e.Msg) }

type WrappedDBError struct {
    Inner    *DBError
    TraceID  string
}

func (e *WrappedDBError) Error() string {
    return fmt.Sprintf("trace=%s: %v", e.TraceID, e.Inner)
}
func (e *WrappedDBError) Unwrap() error { return e.Inner }

func (e *WrappedDBError) As(target any) bool {
    if pp, ok := target.(**DBError); ok {
        *pp = e.Inner
        return true
    }
    return false
}

func main() {
    err := &WrappedDBError{Inner: &DBError{Code: "23505", Msg: "unique violation"}, TraceID: "abc123"}

    var dbErr *DBError
    fmt.Println(errors.As(err, &dbErr))  // true
    fmt.Println(dbErr.Code)              // 23505
    fmt.Println(dbErr.Msg)               // unique violation
}
```

The custom `As` hands the caller the *inner* `*DBError`, not the wrapper.

---

## Task 13 (Hard) — Behavioral retry pipeline

Build a retry helper `RetryOnTemporary(attempts int, fn func() error) error`:

- Calls `fn` up to `attempts` times.
- On error, if the error implements `interface { Temporary() bool }` and reports temporary, retry. Otherwise return immediately.
- Return the last error wrapped with attempt count.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "time"
)

type Temporary interface {
    Temporary() bool
}

func RetryOnTemporary(attempts int, fn func() error) error {
    var last error
    for i := 0; i < attempts; i++ {
        err := fn()
        if err == nil {
            return nil
        }
        last = err
        var t Temporary
        if !errors.As(err, &t) || !t.Temporary() {
            return fmt.Errorf("permanent failure on attempt %d: %w", i+1, err)
        }
        time.Sleep(time.Duration(i+1) * 10 * time.Millisecond)
    }
    return fmt.Errorf("exhausted %d attempts: %w", attempts, last)
}

type Flaky struct{ tries int }

func (e *Flaky) Error() string  { return fmt.Sprintf("flaky try %d", e.tries) }
func (e *Flaky) Temporary() bool { return true }

func main() {
    var n int
    err := RetryOnTemporary(3, func() error {
        n++
        if n < 3 {
            return &Flaky{tries: n}
        }
        return nil
    })
    fmt.Println(err)  // <nil>
    fmt.Println(n)    // 3
}
```

---

## Task 14 (Hard) — Build a kind-based error type

Build a single error type `*Error` with a `Kind` enum, an `Op string`, an `Err error` cause. Provide constructors and a custom `Is` that compares only on Kind.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

type Kind int

const (
    KindOther Kind = iota
    KindNotFound
    KindConflict
    KindInvalid
)

func (k Kind) String() string {
    switch k {
    case KindNotFound:
        return "not_found"
    case KindConflict:
        return "conflict"
    case KindInvalid:
        return "invalid"
    }
    return "other"
}

type Error struct {
    Kind Kind
    Op   string
    Err  error
}

func (e *Error) Error() string {
    if e.Err != nil {
        return fmt.Sprintf("%s %s: %v", e.Op, e.Kind, e.Err)
    }
    return fmt.Sprintf("%s %s", e.Op, e.Kind)
}

func (e *Error) Unwrap() error { return e.Err }

func (e *Error) Is(target error) bool {
    t, ok := target.(*Error)
    return ok && e.Kind == t.Kind
}

func New(op string, kind Kind, err error) error {
    return &Error{Op: op, Kind: kind, Err: err}
}

func main() {
    err := New("user.Save", KindConflict, errors.New("duplicate email"))
    fmt.Println(err)

    if errors.Is(err, &Error{Kind: KindConflict}) {
        fmt.Println("matched on Kind")  // matched on Kind
    }
}
```

---

## Task 15 (Hard) — Method-set puzzle

Predict and explain the output:

```go
type S struct{}
func (s S) Error() string  { return "value" }
func (s *S) String() string { return "ptr-string" }

func print(e error) { fmt.Println(e) }

func main() {
    var v S = S{}
    print(v)
    print(&v)
}
```

**Hints**
- Method set of `S` includes `Error()` (value receiver).
- Method set of `*S` includes `Error()` and `String()`.
- `fmt.Println` calls `Error()` on errors.

**Solution**
Both calls satisfy `error` (value or pointer). Both prints invoke `Error()`. Output:
```
value
value
```
The `String()` method on `*S` does not affect the error formatting because `Error()` takes precedence in `fmt`.

If you want different behavior, override `Error()` on `*S` so the pointer form returns a different message.

---

## Task 16 (Boss-level) — Multi-error type with custom Is, Unwrap[]error

Build `*MultiError` that holds a slice of errors. Implement:

- `Error()` joining with `"; "`.
- `Unwrap() []error` returning the slice (the form `errors.Is`/`errors.As` walk into).
- `Is(target error) bool` returning true if *any* contained error matches.

Verify `errors.Is(me, sentinel)` returns true when one of the contained errors is the sentinel.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "strings"
)

type MultiError struct {
    Errs []error
}

func (m *MultiError) Error() string {
    parts := make([]string, len(m.Errs))
    for i, e := range m.Errs {
        parts[i] = e.Error()
    }
    return strings.Join(parts, "; ")
}

func (m *MultiError) Unwrap() []error { return m.Errs }

// With Unwrap() []error defined, errors.Is and errors.As recurse on each.
// A custom Is is therefore optional, but shown here for clarity.
func (m *MultiError) Is(target error) bool {
    for _, e := range m.Errs {
        if errors.Is(e, target) {
            return true
        }
    }
    return false
}

var ErrA = errors.New("a")
var ErrB = errors.New("b")

func main() {
    me := &MultiError{Errs: []error{ErrA, ErrB, errors.New("c")}}
    fmt.Println(me)                        // a; b; c
    fmt.Println(errors.Is(me, ErrA))       // true
    fmt.Println(errors.Is(me, ErrB))       // true
    fmt.Println(errors.Is(me, errors.New("z")))  // false
}
```

This mirrors how `errors.Join` works internally (its `*joinError` type defines `Unwrap() []error`). The standard library since Go 1.20 recognizes this method as a multi-unwrap form.
