# error interface — Find the Bug

> Each snippet contains a real bug related to the `error` interface — method sets, receivers, embedding, custom `Is`/`As`, comparable issues, recursion in `Error()`, typed nils. Find it, explain it, fix it.

---

## Bug 1 — Wrong receiver type

```go
type Foo struct{ Msg string }
func (f *Foo) Error() string { return f.Msg }

func wrap(msg string) error {
    return Foo{Msg: msg}
}
```

**Bug:** `Error()` has a pointer receiver, so only `*Foo` satisfies `error`. The function returns a value (`Foo{}`), which does not satisfy the interface. Compile error: `Foo does not implement error (Error method has pointer receiver)`.

**Fix:**
```go
func wrap(msg string) error {
    return &Foo{Msg: msg}
}
```

Or change to a value receiver: `func (f Foo) Error() string`. Pick one based on whether the type has fields and how it will be used.

---

## Bug 2 — Misspelled method name

```go
type MyErr struct{ Msg string }
func (e *MyErr) Errror() string { return e.Msg }

func f() error {
    return &MyErr{Msg: "boom"}
}
```

**Bug:** `Errror` (three r's) does not match the `Error` method required by the interface. `*MyErr` does not satisfy `error`. Compile error mentions a missing `Error` method.

**Fix:** rename the method to `Error`:
```go
func (e *MyErr) Error() string { return e.Msg }
```

The compiler catches typos here. The bug is recognizable, but easy to miss if you stare at the screen too long.

---

## Bug 3 — Recursive `Error()`

```go
type E struct{ Msg string }

func (e *E) Error() string {
    return fmt.Sprintf("error: %v", e)
}
```

**Bug:** `%v` on an `error` value calls `Error()`. So calling `e.Error()` invokes `fmt.Sprintf` which invokes `e.Error()` again — infinite recursion, stack overflow.

**Fix:** format the *fields*, not the whole struct:
```go
func (e *E) Error() string {
    return fmt.Sprintf("error: %s", e.Msg)
}
```

The same bug occurs with `%s` (which also calls `Error()` on errors). Format only the data, never the error itself, inside `Error()`.

---

## Bug 4 — Typed-nil interface from custom error

```go
type ValidationErr struct{ Field string }
func (e *ValidationErr) Error() string { return "invalid: " + e.Field }

func validate(s string) error {
    var e *ValidationErr
    if s == "" {
        e = &ValidationErr{Field: "name"}
    }
    return e
}

func main() {
    if err := validate("ok"); err != nil {
        fmt.Println("got error:", err)
    }
}
```

**Bug:** `validate("ok")` leaves `e` as a nil `*ValidationErr` pointer. The return statement converts it into an `error` interface with a non-nil type word and a nil data word. The `err != nil` check is true and the program prints `got error: <nil>` (or panics in `Error()`).

**Fix:** return an explicit `nil`:
```go
func validate(s string) error {
    if s == "" {
        return &ValidationErr{Field: "name"}
    }
    return nil
}
```

Never funnel a nil typed pointer through an interface.

---

## Bug 5 — `Error()` panics on nil receiver

```go
type Err struct{ Inner error }
func (e *Err) Error() string { return e.Inner.Error() }

func main() {
    var e *Err  // nil pointer
    var err error = e
    fmt.Println(err.Error())
}
```

**Bug:** Two layers:
1. Typed-nil interface — `err != nil` is true.
2. `Error()` dereferences `e.Inner` on a nil receiver — panic.

**Fix:** return `nil` explicitly *and* guard the receiver:
```go
func (e *Err) Error() string {
    if e == nil || e.Inner == nil {
        return "<nil err>"
    }
    return e.Inner.Error()
}
```

The guard is defensive; the *primary* fix is to never assign a typed nil to an interface.

---

## Bug 6 — Embedding without `Unwrap`

```go
type WrapErr struct {
    error
    Field string
}

var ErrEmpty = errors.New("empty")

func main() {
    we := &WrapErr{error: ErrEmpty, Field: "name"}
    fmt.Println(errors.Is(we, ErrEmpty))  // ?
}
```

**Bug:** Output is `false`. Embedding promotes `Error()` but does not auto-promote `Unwrap()`. `errors.Is` cannot reach the inner `ErrEmpty` because no `Unwrap` method walks past the outer `*WrapErr`.

**Fix:** define `Unwrap` explicitly:
```go
func (w *WrapErr) Unwrap() error { return w.error }
```

Now `errors.Is(we, ErrEmpty)` is true.

---

## Bug 7 — Non-comparable error type

```go
type BadErr struct{ Tags []string }
func (BadErr) Error() string { return "bad" }

var sentinel error = BadErr{Tags: []string{"x"}}

func main() {
    err := BadErr{Tags: []string{"x"}}
    fmt.Println(errors.Is(err, sentinel))
}
```

**Bug:** `errors.Is` calls `==` on two `BadErr` values. `BadErr` contains a slice (non-comparable), so the comparison panics: `comparing uncomparable type main.BadErr`.

**Fix:** use a pointer receiver and pointer values:
```go
type BadErr struct{ Tags []string }
func (e *BadErr) Error() string { return "bad" }

var sentinel = &BadErr{Tags: []string{"x"}}
```

Or remove the slice. Standard library error types are always comparable.

---

## Bug 8 — Custom `Is` that breaks identity

```go
type StatusErr struct{ Status int }
func (e *StatusErr) Error() string { return "..." }

func (e *StatusErr) Is(target error) bool {
    return true  // ?
}
```

**Bug:** This `Is` always returns true, so `errors.Is(anything, &StatusErr{...})` is always true regardless of context. Useless at best, dangerous at worst (it short-circuits the chain walk).

**Fix:** check that target is the same type and the relevant field matches:
```go
func (e *StatusErr) Is(target error) bool {
    t, ok := target.(*StatusErr)
    return ok && e.Status == t.Status
}
```

A custom `Is` should be precise; a too-permissive one corrupts every caller's check.

---

## Bug 9 — Custom `As` that silently drops fields

```go
type Wrapper struct{ Inner *DBError; Meta string }
func (w *Wrapper) Error() string { return w.Inner.Error() }

func (w *Wrapper) As(target any) bool {
    if pp, ok := target.(**Wrapper); ok {
        *pp = w
        return true
    }
    return false  // ?
}
```

**Bug:** This `As` only matches when the target is `**Wrapper`. A caller asking for `**DBError` (the inner type) gets `false`, even though the inner field is right there. The wrapper hides the inner error from `errors.As`.

**Fix:** support both target types, or at least the inner one:
```go
func (w *Wrapper) As(target any) bool {
    if pp, ok := target.(**Wrapper); ok {
        *pp = w
        return true
    }
    if pp, ok := target.(**DBError); ok {
        *pp = w.Inner
        return true
    }
    return false
}
```

Or omit the custom `As` entirely and rely on `Unwrap()` to expose the inner error — the default `errors.As` will find it.

---

## Bug 10 — Comparing errors by message string

```go
func handle(err error) {
    if err.Error() == "not found" {
        // ...
    }
}
```

**Bug:** Brittle. The exact string can change with locale, version, or wrapping. `fmt.Errorf("ctx: %w", ErrNotFound)` produces `"ctx: not found"` — the equality fails.

**Fix:** use a sentinel and `errors.Is`:
```go
if errors.Is(err, ErrNotFound) {
    // ...
}
```

`Error()` is for *humans* (logs, debug output). `errors.Is` is for *programs*.

---

## Bug 11 — Returning concrete type as interface, losing details

```go
type APIError struct{ Status int; Msg string }
func (e *APIError) Error() string { return e.Msg }

func work() error {
    return &APIError{Status: 404, Msg: "missing"}
}

func main() {
    err := work()
    apiErr, ok := err.(*APIError)
    fmt.Println(apiErr, ok)
}
```

This pattern is fine. But change `work` to wrap:

```go
func work() error {
    return fmt.Errorf("during work: %w", &APIError{Status: 404, Msg: "missing"})
}

func main() {
    err := work()
    apiErr, ok := err.(*APIError)  // ?
    fmt.Println(apiErr, ok)
}
```

**Bug:** `err.(*APIError)` is a *direct* type assertion — it does not walk the wrap chain. After `fmt.Errorf`, the dynamic type is `*fmt.wrapError`, not `*APIError`. The assertion fails (`ok == false`).

**Fix:** use `errors.As`, which walks the chain:
```go
var apiErr *APIError
if errors.As(err, &apiErr) {
    fmt.Println(apiErr.Status)
}
```

---

## Bug 12 — Embedding two error types causing ambiguity

```go
type A struct{}
func (a *A) Error() string { return "a" }

type B struct{}
func (b *B) Error() string { return "b" }

type Combined struct {
    *A
    *B
}

func main() {
    c := &Combined{A: &A{}, B: &B{}}
    fmt.Println(c.Error())  // ?
}
```

**Bug:** Both `*A` and `*B` provide `Error()` at the same depth. The selector `c.Error` is ambiguous. Compile error: `ambiguous selector c.Error`.

**Fix:** define `Error()` explicitly on `*Combined`:
```go
func (c *Combined) Error() string {
    return c.A.Error() + "; " + c.B.Error()
}
```

Or embed only one error-bearing type and add the other as a named field.

---

## Bug 13 — Forgetting to export struct fields

```go
package db

type queryError struct {
    code string
    msg  string
}

func (e *queryError) Error() string { return e.msg }

// elsewhere
import "db"

func main() {
    err := db.Run()
    var qe *db.queryError
    if errors.As(err, &qe) {
        fmt.Println(qe.code)  // ?
    }
}
```

**Bug:** Two issues at once:
1. `db.queryError` is unexported — external packages cannot name the type.
2. Even if reachable, `qe.code` is unexported and inaccessible.

**Fix:** export the type and the fields you want callers to read:
```go
package db

type QueryError struct {
    Code string
    Msg  string
}

func (e *QueryError) Error() string { return e.Msg }
```

If you want to *prevent* external implementations but allow inspection, export the type and fields but seal the interface (Bug 14 below).

---

## Bug 14 — Sealing forgotten on a new error type

```go
package db

type Error interface {
    error
    sealed()
}

type notFound struct{ Resource string }
func (e *notFound) Error() string { return "..." }
func (e *notFound) sealed()       {}

// New type added later
type conflict struct{ Field string }
func (e *conflict) Error() string { return "..." }
// missing: sealed()
```

**Bug:** The new `*conflict` type does not satisfy `db.Error` because the `sealed()` method is missing. Anywhere code returns `&conflict{...}` as `db.Error`, it fails to compile.

**Fix:** add the unexported method:
```go
func (e *conflict) sealed() {}
```

When sealing, the unexported method becomes a discipline checklist for every new internal type.

---

## Bug 15 — `errors.As` target not a pointer

```go
type APIError struct{ Status int }
func (e *APIError) Error() string { return "..." }

func main() {
    err := &APIError{Status: 404}
    var apiErr *APIError
    errors.As(err, apiErr)  // ?
}
```

**Bug:** `errors.As` requires the *address* of the target so it can write into it. Passing `apiErr` (the variable's value) makes the function panic with "errors: target must be a non-nil pointer".

**Fix:** pass `&apiErr`:
```go
errors.As(err, &apiErr)
```

The signature is `errors.As(err error, target any) bool`. `target` must be a non-nil pointer to either a type that implements `error` or to any interface type.

---

## Bug 16 — Implementing `Stringer` instead of `error`

```go
type MyType struct{ Msg string }

func (m *MyType) String() string { return m.Msg }

func main() {
    var err error = &MyType{Msg: "hi"}  // ?
    fmt.Println(err)
}
```

**Bug:** `MyType` only has `String()`, not `Error()`. It satisfies `fmt.Stringer`, not `error`. Compile error: `*MyType does not implement error (missing Error method)`.

**Fix:** add an `Error()` method (or rename `String` to `Error`). Be intentional about *both* methods if you want different text in different contexts. `fmt` prefers `Error()` over `String()` for values that implement both.

---

## Bug 17 — Using `==` for sentinel comparison after wrapping

```go
var ErrNotFound = errors.New("not found")

func find(id int) error {
    return fmt.Errorf("find %d: %w", id, ErrNotFound)
}

func main() {
    err := find(7)
    if err == ErrNotFound {
        fmt.Println("missing")
    } else {
        fmt.Println("other:", err)
    }
}
```

**Bug:** After `fmt.Errorf("...%w", ErrNotFound)`, `err` is a `*fmt.wrapError`, not `ErrNotFound`. Direct `==` comparison fails.

**Fix:** use `errors.Is`:
```go
if errors.Is(err, ErrNotFound) {
    fmt.Println("missing")
}
```

`errors.Is` walks the wrap chain. `==` checks only the outer error.

---

## Bug 18 — Behavioral interface implemented on the wrong receiver

```go
type Temporary interface {
    Temporary() bool
}

type RateLimit struct{}
func (r RateLimit) Error() string  { return "rate limited" }
func (r *RateLimit) Temporary() bool { return true }

func main() {
    var err error = RateLimit{}  // value, not pointer
    var t Temporary
    if errors.As(err, &t) {
        fmt.Println("retry:", t.Temporary())
    } else {
        fmt.Println("no")
    }
}
```

**Bug:** `Temporary()` is on the pointer receiver. `RateLimit{}` (value) does not have it in its method set, so it does not satisfy `Temporary`. The `errors.As` check fails — but `Error()` is on the value receiver, so `RateLimit{}` *does* satisfy `error`. The asymmetry hides the issue.

**Fix:** be consistent — put both methods on the pointer receiver, and return `&RateLimit{}`:
```go
func (r *RateLimit) Error() string  { return "rate limited" }
func (r *RateLimit) Temporary() bool { return true }

var err error = &RateLimit{}
```

Mixing receiver types on the same struct is a smell that vet will warn about.
