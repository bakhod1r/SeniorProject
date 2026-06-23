# errors.New — Tasks

> Hands-on exercises focused on `errors.New`. Each task gives a problem, hints, and a reference solution. Difficulty: easy → hard.

---

## Task 1 (Easy) — Hello, errors.New

Write a program that creates an error with the message `"hello error"` using `errors.New`, then prints both the error itself and the result of calling `Error()` on it.

**Hints**
- Import `errors` and `fmt`.
- `fmt.Println(err)` calls `Error()` automatically.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

func main() {
    err := errors.New("hello error")
    fmt.Println(err)
    fmt.Println(err.Error())
}
```

Both lines print `hello error`.

---

## Task 2 (Easy) — A failing function

Write `MustBePositive(n int) error` that returns `nil` if `n > 0`, otherwise returns an error created with `errors.New` whose message is `"n must be positive"`.

**Hints**
- One `if`, one `errors.New`, one `nil`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

func MustBePositive(n int) error {
    if n <= 0 {
        return errors.New("n must be positive")
    }
    return nil
}

func main() {
    fmt.Println(MustBePositive(5))   // <nil>
    fmt.Println(MustBePositive(-3))  // n must be positive
}
```

---

## Task 3 (Easy) — Declare a sentinel

Define a package-level sentinel `ErrEmptyName` with the message `"name cannot be empty"`. Write `Greet(name string) (string, error)` that returns the greeting `"hello, NAME"` if `name` is non-empty, otherwise the sentinel.

**Hints**
- `var ErrEmptyName = errors.New(...)` outside any function.
- Compare with `errors.Is` in your test code if you write any.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

var ErrEmptyName = errors.New("name cannot be empty")

func Greet(name string) (string, error) {
    if name == "" {
        return "", ErrEmptyName
    }
    return "hello, " + name, nil
}

func main() {
    s, err := Greet("Ada")
    fmt.Println(s, err) // hello, Ada <nil>

    s, err = Greet("")
    fmt.Println(s, err) // (empty) name cannot be empty

    if errors.Is(err, ErrEmptyName) {
        fmt.Println("matched sentinel")
    }
}
```

---

## Task 4 (Easy) — Pointer-identity demo

Write a program that creates two errors with `errors.New("same")` and prints whether they are equal under `==`. Add a comment explaining why.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

func main() {
    a := errors.New("same")
    b := errors.New("same")

    fmt.Println(a == b)                 // false
    fmt.Println(a.Error() == b.Error()) // true

    // Each call to errors.New returns a fresh *errorString pointer.
    // The interface compares by dynamic type AND underlying pointer,
    // so two separate allocations never compare equal even if
    // the message strings are identical.
}
```

---

## Task 5 (Easy) — `errors.Is` with a sentinel

Given `ErrTooLarge = errors.New("too large")`, write `CheckSize(n int) error` that returns `ErrTooLarge` if `n > 100`. In `main`, call it with `200` and use `errors.Is` to detect the sentinel.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

var ErrTooLarge = errors.New("too large")

func CheckSize(n int) error {
    if n > 100 {
        return ErrTooLarge
    }
    return nil
}

func main() {
    err := CheckSize(200)
    if errors.Is(err, ErrTooLarge) {
        fmt.Println("too large detected")
    }
}
```

---

## Task 6 (Medium) — Wrap a sentinel

Define `var ErrTimeout = errors.New("timeout")`. Write `Call() error` that always returns `ErrTimeout` wrapped with the prefix `"Call: "` using `fmt.Errorf` and `%w`. In `main`, verify `errors.Is(err, ErrTimeout)` returns `true`.

**Hints**
- `fmt.Errorf("Call: %w", ErrTimeout)`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

var ErrTimeout = errors.New("timeout")

func Call() error {
    return fmt.Errorf("Call: %w", ErrTimeout)
}

func main() {
    err := Call()
    fmt.Println(err)                       // Call: timeout
    fmt.Println(errors.Is(err, ErrTimeout)) // true
}
```

---

## Task 7 (Medium) — Sentinel set for an in-memory store

Build a small in-memory store with `Get(key string) (string, error)` and `Put(key, value string) error`. Define sentinels `ErrNotFound` and `ErrExists`. `Put` returns `ErrExists` if the key is already present. `Get` returns `ErrNotFound` if the key is missing.

**Hints**
- Use `map[string]string`.
- Two `var Err... = errors.New(...)` declarations.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

var (
    ErrNotFound = errors.New("store: not found")
    ErrExists   = errors.New("store: already exists")
)

type Store struct{ m map[string]string }

func New() *Store { return &Store{m: map[string]string{}} }

func (s *Store) Put(k, v string) error {
    if _, ok := s.m[k]; ok {
        return ErrExists
    }
    s.m[k] = v
    return nil
}

func (s *Store) Get(k string) (string, error) {
    v, ok := s.m[k]
    if !ok {
        return "", ErrNotFound
    }
    return v, nil
}

func main() {
    s := New()
    fmt.Println(s.Put("a", "1"))
    fmt.Println(s.Put("a", "2")) // store: already exists
    v, err := s.Get("b")
    fmt.Println(v, err)          // (empty) store: not found
    fmt.Println(errors.Is(err, ErrNotFound))
}
```

---

## Task 8 (Medium) — `errors.New` vs `fmt.Errorf` benchmark

Write two benchmark functions: one that allocates a fresh `errors.New("nope")` each iteration, one that returns a package-level sentinel. Run them, compare ns/op and B/op.

**Hints**
- Put benchmarks in a `_test.go` file.
- Use `testing.B`.

**Solution**
```go
// file: bench_test.go
package errnew

import (
    "errors"
    "testing"
)

var ErrNope = errors.New("nope")

func BenchmarkPerCall(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = errors.New("nope")
    }
}

func BenchmarkSentinel(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = ErrNope
    }
}
```

Run with `go test -bench=. -benchmem`. Expect ~30 ns/op + 16 B/op for the per-call benchmark, ~0.5 ns/op + 0 B/op for the sentinel benchmark.

---

## Task 9 (Medium) — Parse-or-default with sentinel

Define `var ErrInvalidPort = errors.New("invalid port")`. Write `ParsePort(s string) (int, error)` that returns the parsed integer if it is in `[1, 65535]`, otherwise the sentinel.

**Hints**
- Use `strconv.Atoi`.
- Combine the parse-error and range-error into one sentinel.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "strconv"
)

var ErrInvalidPort = errors.New("invalid port")

func ParsePort(s string) (int, error) {
    n, err := strconv.Atoi(s)
    if err != nil || n < 1 || n > 65535 {
        return 0, ErrInvalidPort
    }
    return n, nil
}

func main() {
    for _, s := range []string{"80", "0", "70000", "abc"} {
        n, err := ParsePort(s)
        if errors.Is(err, ErrInvalidPort) {
            fmt.Printf("%q: invalid\n", s)
        } else {
            fmt.Printf("%q: %d\n", s, n)
        }
    }
}
```

---

## Task 10 (Medium) — Hybrid: sentinel + typed error

Define `ErrValidation = errors.New("validation failed")` and a type:

```go
type ValidationError struct {
    Field, Reason string
}
```

Make `*ValidationError` implement both `error` and `Is(target error) bool` so that `errors.Is(err, ErrValidation)` returns `true` for any `*ValidationError`. Use `errors.As` to extract the field/reason at the call site.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

var ErrValidation = errors.New("validation failed")

type ValidationError struct {
    Field, Reason string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation: %s: %s", e.Field, e.Reason)
}

func (e *ValidationError) Is(target error) bool {
    return target == ErrValidation
}

func validate(age int) error {
    if age < 0 {
        return &ValidationError{Field: "age", Reason: "must be non-negative"}
    }
    return nil
}

func main() {
    err := validate(-1)
    fmt.Println(err)                            // validation: age: must be non-negative
    fmt.Println(errors.Is(err, ErrValidation))  // true

    var v *ValidationError
    if errors.As(err, &v) {
        fmt.Println("field:", v.Field, "reason:", v.Reason)
    }
}
```

---

## Task 11 (Medium) — Detect the per-call mistake

Look at this code. What is wrong? Write a corrected version.

```go
func GetItem(id int) (string, error) {
    if id == 0 {
        return "", errors.New("not found")
    }
    return "item", nil
}

// elsewhere:
err := someCall()
if err == errors.New("not found") {
    // ... handle ...
}
```

**Hints**
- Two issues: pointer identity, and the comparison style.

**Solution**
```go
var ErrNotFound = errors.New("not found")

func GetItem(id int) (string, error) {
    if id == 0 {
        return "", ErrNotFound
    }
    return "item", nil
}

err := someCall()
if errors.Is(err, ErrNotFound) {
    // ... handle ...
}
```

The two fixes:
1. Declare the sentinel at package scope so the *same* pointer is returned every time.
2. Use `errors.Is` (works through wrapping; survives future refactors).

---

## Task 12 (Hard) — Build a typed sentinel registry

Build a small "errors registry" pattern: a struct that holds named errors and lets a package register them at init. Use `errors.New` internally for each registration.

**Hints**
- A `map[string]error` keyed by the error's identifier.
- A `Register` function called from package init.
- A `Get` function returning the registered error.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

type Registry struct {
    m map[string]error
}

func NewRegistry() *Registry { return &Registry{m: map[string]error{}} }

func (r *Registry) Register(name, msg string) error {
    if _, ok := r.m[name]; ok {
        panic("registry: duplicate " + name)
    }
    e := errors.New(msg)
    r.m[name] = e
    return e
}

func (r *Registry) Get(name string) error { return r.m[name] }

var registry = NewRegistry()

var (
    ErrNotFound = registry.Register("not_found", "not found")
    ErrExists   = registry.Register("exists", "already exists")
)

func main() {
    fmt.Println(errors.Is(ErrNotFound, registry.Get("not_found"))) // true
    fmt.Println(ErrExists)                                          // already exists
}
```

This pattern is rarely needed but illustrates the relationship between `errors.New` and identity: each registered error is a single `*errorString` with a stable pointer.

---

## Task 13 (Hard) — Replace per-call allocation

Rewrite this function to avoid per-call allocation in the success path *and* the failure path:

```go
func Validate(s string) error {
    if s == "" {
        return errors.New("empty")
    }
    if len(s) > 100 {
        return errors.New("too long")
    }
    return nil
}
```

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

var (
    ErrEmpty   = errors.New("empty")
    ErrTooLong = errors.New("too long")
)

func Validate(s string) error {
    switch {
    case s == "":
        return ErrEmpty
    case len(s) > 100:
        return ErrTooLong
    default:
        return nil
    }
}

func main() {
    fmt.Println(Validate(""))
    fmt.Println(Validate("ok"))
}
```

Now both failure paths return a sentinel (no allocation per call). The success path returns `nil` (no allocation either).

---

## Task 14 (Hard) — Cross-package sentinel design

You have two packages `users` and `accounts`, and both want to signal "not found." Without breaking either package's API, design a third shared package and refactor.

**Hints**
- Create `errs` package with `ErrNotFound`.
- Both packages return the shared sentinel (or wrap it).

**Solution**

```go
// package errs
package errs

import "errors"

var ErrNotFound = errors.New("errs: not found")
```

```go
// package users
package users

import (
    "fmt"
    "myproj/errs"
)

func Get(id int) error {
    return fmt.Errorf("users.Get(%d): %w", id, errs.ErrNotFound)
}
```

```go
// package accounts
package accounts

import (
    "fmt"
    "myproj/errs"
)

func Get(id int) error {
    return fmt.Errorf("accounts.Get(%d): %w", id, errs.ErrNotFound)
}
```

```go
// caller
err := users.Get(7)
if errors.Is(err, errs.ErrNotFound) { /* 404 */ }

err = accounts.Get(7)
if errors.Is(err, errs.ErrNotFound) { /* 404 */ }
```

Both packages emit errors that match the same shared sentinel.

---

## Task 15 (Hard) — Don't mutate the sentinel

This code has a subtle bug. Find and explain it.

```go
package mypkg

import "errors"

var ErrFoo = errors.New("foo")

func reset() {
    ErrFoo = errors.New("foo") // looks innocent, right?
}
```

**Solution**

The bug: `reset` *replaces* the package-level variable with a brand-new `*errorString`. Any code holding the old pointer (e.g., a handler that captured `ErrFoo` at startup) will no longer match `errors.Is(oldErr, ErrFoo)` because `ErrFoo` now points to a different allocation.

Fix: never reassign sentinels. Treat them as `const`. Remove the `reset` function.

If a real test really needs to exercise some kind of "reset," refactor the package to inject the error rather than reassign a global.

---

## Task 16 (Hard) — Custom `Is` to broaden a sentinel

Define `ErrTransient = errors.New("transient failure")`. Then define a typed error `*NetworkError` that wraps a cause and reports as transient via `Is`. Write a retry helper that retries up to 3 times only when `errors.Is(err, ErrTransient)`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

var ErrTransient = errors.New("transient failure")

type NetworkError struct{ Cause error }

func (e *NetworkError) Error() string { return "network: " + e.Cause.Error() }
func (e *NetworkError) Is(target error) bool {
    return target == ErrTransient
}
func (e *NetworkError) Unwrap() error { return e.Cause }

func retry(fn func() error, n int) error {
    var err error
    for i := 0; i < n; i++ {
        err = fn()
        if err == nil {
            return nil
        }
        if !errors.Is(err, ErrTransient) {
            return err
        }
    }
    return fmt.Errorf("retry: gave up after %d attempts: %w", n, err)
}

func flaky() error { return &NetworkError{Cause: errors.New("connection reset")} }

func main() {
    err := retry(flaky, 3)
    fmt.Println(err)
    fmt.Println(errors.Is(err, ErrTransient)) // true
}
```

The `*NetworkError` reports itself as `ErrTransient`-equivalent without literally wrapping the sentinel. The retry helper makes its decision via `errors.Is`.
