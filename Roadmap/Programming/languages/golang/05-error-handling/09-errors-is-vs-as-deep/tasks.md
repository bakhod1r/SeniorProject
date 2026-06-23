# errors.Is vs errors.As — Tasks

> Hands-on exercises. Each comes with a problem statement, hints, and a reference solution. Difficulty: easy → hard.

---

## Task 1 (Easy) — Match a wrapped sentinel

Write a function that wraps `io.EOF` with `fmt.Errorf` and a context message, then verifies the wrapped value is still recognizable via `errors.Is`.

**Hints**
- Use `%w`, not `%v`.
- `errors.Is(err, io.EOF)` should be true.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "io"
)

func main() {
    inner := io.EOF
    err := fmt.Errorf("read header: %w", inner)

    fmt.Println(err == io.EOF)         // false (the wrapper is not io.EOF)
    fmt.Println(errors.Is(err, io.EOF)) // true (chain walk finds it)
}
```

---

## Task 2 (Easy) — Extract `*os.PathError`

Write a program that opens a non-existent file and uses `errors.As` to extract the `*os.PathError`, then prints the path that failed.

**Hints**
- `os.Open` returns `*os.PathError` for I/O failures.
- Declare the variable as `var pe *os.PathError`, not `var pe os.PathError`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "os"
)

func main() {
    _, err := os.Open("/no/such/file")
    var pe *os.PathError
    if errors.As(err, &pe) {
        fmt.Printf("op=%s path=%s\n", pe.Op, pe.Path)
    } else {
        fmt.Println("no PathError in chain")
    }
}
```

---

## Task 3 (Easy) — Define your own sentinel

Define a package-level sentinel `ErrInsufficientFunds` and a function `withdraw(balance, amount int)` that returns it when the amount exceeds the balance. In `main`, wrap the result with a context and recover the sentinel via `errors.Is`.

**Hints**
- Use `errors.New` for the sentinel.
- Wrap the return value in `main` with `fmt.Errorf("transfer failed: %w", err)`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

var ErrInsufficientFunds = errors.New("insufficient funds")

func withdraw(balance, amount int) error {
    if amount > balance {
        return ErrInsufficientFunds
    }
    return nil
}

func main() {
    err := withdraw(50, 100)
    err = fmt.Errorf("transfer: %w", err)

    if errors.Is(err, ErrInsufficientFunds) {
        fmt.Println("declined: not enough money")
    }
}
```

---

## Task 4 (Easy) — Define a typed error and extract it

Define a `*ValidationError` with fields `Field` and `Message`. Write a `validate(name, email string)` function that returns one. Wrap the result twice with `fmt.Errorf` and recover it with `errors.As`.

**Hints**
- Implement `Error()` on the pointer receiver.
- Variable target: `var ve *ValidationError`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("invalid %s: %s", e.Field, e.Message)
}

func validate(name, email string) error {
    if name == "" {
        return &ValidationError{Field: "name", Message: "required"}
    }
    if email == "" {
        return &ValidationError{Field: "email", Message: "required"}
    }
    return nil
}

func main() {
    err := validate("", "x@x")
    err = fmt.Errorf("user create: %w", err)
    err = fmt.Errorf("api request: %w", err)

    var ve *ValidationError
    if errors.As(err, &ve) {
        fmt.Printf("validation: field=%s msg=%s\n", ve.Field, ve.Message)
    }
}
```

---

## Task 5 (Easy) — Walk the chain manually

Write a function `printChain(err error)` that uses `errors.Unwrap` to print every error in a chain, one per line.

**Hints**
- Stop when `errors.Unwrap` returns nil.
- Print the outer error first.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "io"
)

func printChain(err error) {
    for err != nil {
        fmt.Println(err)
        err = errors.Unwrap(err)
    }
}

func main() {
    e := fmt.Errorf("a: %w", fmt.Errorf("b: %w", io.EOF))
    printChain(e)
}
```

---

## Task 6 (Medium) — Custom `Is` for kind matching

Define a typed error with a `Kind` field. Implement an `Is` method so that `errors.Is(err, MyKind)` returns true when `err.Kind == MyKind`. Test it with two different kind sentinels.

**Hints**
- The receiver compares `target` against its own kind.
- Define both kinds as package-level errors.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

var (
    KindNotFound  = errors.New("not_found")
    KindForbidden = errors.New("forbidden")
)

type AppErr struct {
    Kind error
    Op   string
    Err  error
}

func (e *AppErr) Error() string  { return fmt.Sprintf("%s: %v", e.Op, e.Err) }
func (e *AppErr) Unwrap() error  { return e.Err }
func (e *AppErr) Is(target error) bool { return target == e.Kind }

func main() {
    err := &AppErr{Kind: KindNotFound, Op: "get-user", Err: errors.New("no row")}

    fmt.Println(errors.Is(err, KindNotFound))  // true
    fmt.Println(errors.Is(err, KindForbidden)) // false
}
```

---

## Task 7 (Medium) — `errors.Join` and detection

Combine three errors with `errors.Join` and write asserts that `errors.Is` finds each individual one.

**Hints**
- Define each as a sentinel.
- Use `errors.Is(joined, X)` for each X.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

var (
    ErrA = errors.New("A failed")
    ErrB = errors.New("B failed")
    ErrC = errors.New("C failed")
)

func main() {
    joined := errors.Join(ErrA, ErrB, ErrC)

    fmt.Println(errors.Is(joined, ErrA)) // true
    fmt.Println(errors.Is(joined, ErrB)) // true
    fmt.Println(errors.Is(joined, ErrC)) // true
    fmt.Println(errors.Is(joined, errors.New("X"))) // false (different pointer)
}
```

---

## Task 8 (Medium) — Custom `As` to extract a code

Define a typed error with an `int` code. Implement an `As` method that, when given a `*int` target, writes the code into it.

**Hints**
- The `As` method uses a type switch on `target`.
- For non-matching types, return false; do not write.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

type CodedErr struct {
    Code int
    Msg  string
}

func (e *CodedErr) Error() string { return e.Msg }

func (e *CodedErr) As(target any) bool {
    if t, ok := target.(*int); ok {
        *t = e.Code
        return true
    }
    return false
}

func main() {
    err := &CodedErr{Code: 42, Msg: "boom"}
    err2 := fmt.Errorf("op: %w", err)

    var code int
    if errors.As(err2, &code) {
        fmt.Println("code:", code)
    }

    var ce *CodedErr
    if errors.As(err2, &ce) {
        fmt.Println("msg:", ce.Msg)
    }
}
```

---

## Task 9 (Medium) — Translate at a boundary

Two packages: `repo` returns `repo.ErrNotFound`. The `svc` package wraps `repo` and returns `svc.ErrNotFound`. Make `errors.Is(err, svc.ErrNotFound)` work for any caller of `svc`, but only when `repo` returned `repo.ErrNotFound`.

**Hints**
- Use a type switch to translate at the boundary.
- Wrap with `%w` to preserve the chain.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

// repo
var ErrRepoNotFound = errors.New("repo: not found")

func repoGet(id int) error {
    return ErrRepoNotFound
}

// svc
var ErrSvcNotFound = errors.New("svc: not found")

func svcGet(id int) error {
    err := repoGet(id)
    if errors.Is(err, ErrRepoNotFound) {
        return fmt.Errorf("%w (cause: %v)", ErrSvcNotFound, err)
    }
    return err
}

func main() {
    err := svcGet(7)
    fmt.Println(errors.Is(err, ErrSvcNotFound))  // true
    fmt.Println(errors.Is(err, ErrRepoNotFound)) // false (wrapped only the svc sentinel)
}
```

---

## Task 10 (Medium) — Round-trip an error type

Write a function that produces an `error` chain four levels deep ending in a typed `*MyErr`. Recover it with `errors.As`. Confirm that `errors.Is` matches a sentinel kind defined inside `*MyErr`'s `Is` method.

**Hints**
- Combine the patterns from Tasks 6 and 4.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

var KindBoom = errors.New("kind_boom")

type MyErr struct {
    Kind error
    Note string
}

func (e *MyErr) Error() string         { return e.Note }
func (e *MyErr) Is(target error) bool  { return target == e.Kind }

func deepFail() error {
    return &MyErr{Kind: KindBoom, Note: "the deep one"}
}

func wrap(err error, msg string) error {
    return fmt.Errorf("%s: %w", msg, err)
}

func main() {
    err := wrap(wrap(wrap(wrap(deepFail(), "lvl4"), "lvl3"), "lvl2"), "lvl1")

    fmt.Println(errors.Is(err, KindBoom)) // true

    var me *MyErr
    if errors.As(err, &me) {
        fmt.Println(me.Note) // "the deep one"
    }
}
```

---

## Task 11 (Hard) — Write a category-aware HTTP middleware

Define kind sentinels `KindNotFound`, `KindBadInput`, `KindInternal`. Define an `AppErr` type with custom `Is`. Write an HTTP handler middleware that translates these kinds to status codes 404/400/500.

**Hints**
- Use `errors.Is(err, KindX)` in a switch.
- Default case: 500.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "net/http"
)

var (
    KindNotFound = errors.New("not_found")
    KindBadInput = errors.New("bad_input")
    KindInternal = errors.New("internal")
)

type AppErr struct {
    Kind error
    Op   string
    Err  error
}

func (e *AppErr) Error() string         { return fmt.Sprintf("%s: %v", e.Op, e.Err) }
func (e *AppErr) Unwrap() error         { return e.Err }
func (e *AppErr) Is(target error) bool  { return target == e.Kind }

func httpStatus(err error) int {
    switch {
    case errors.Is(err, KindNotFound):
        return http.StatusNotFound
    case errors.Is(err, KindBadInput):
        return http.StatusBadRequest
    default:
        return http.StatusInternalServerError
    }
}

type appHandler func(http.ResponseWriter, *http.Request) error

func (h appHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    if err := h(w, r); err != nil {
        http.Error(w, err.Error(), httpStatus(err))
    }
}

func main() {
    h := appHandler(func(w http.ResponseWriter, r *http.Request) error {
        return &AppErr{Kind: KindNotFound, Op: "get-user", Err: errors.New("user 7 not found")}
    })

    mux := http.NewServeMux()
    mux.Handle("/", h)

    fmt.Println("would listen on :8080 (skipped)")
    _ = mux
}
```

---

## Task 12 (Hard) — Build a multi-error walker

Write a function `walk(err error, fn func(error))` that calls `fn` on every error in the chain, including each leaf of multi-error trees. Use it on the result of `errors.Join`.

**Hints**
- Type-assert `interface{ Unwrap() []error }` and `interface{ Unwrap() error }`.
- Recurse into each child.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

func walk(err error, fn func(error)) {
    if err == nil {
        return
    }
    fn(err)
    switch x := err.(type) {
    case interface{ Unwrap() error }:
        walk(x.Unwrap(), fn)
    case interface{ Unwrap() []error }:
        for _, c := range x.Unwrap() {
            walk(c, fn)
        }
    }
}

func main() {
    e := errors.Join(
        fmt.Errorf("step1: %w", errors.New("a")),
        fmt.Errorf("step2: %w", errors.New("b")),
        errors.New("c"),
    )

    count := 0
    walk(e, func(err error) {
        count++
        fmt.Println(count, "->", err)
    })
}
```

---

## Task 13 (Hard) — Detect a cycle without crashing

Write a `safeIs` function that behaves like `errors.Is` but detects cycles in `Unwrap` and returns false instead of looping forever.

**Hints**
- Track visited nodes in a `map[error]struct{}`.
- Use `==` to compare visited entries (works on interface values).

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

func safeIs(err, target error) bool {
    visited := make(map[error]struct{})
    for err != nil {
        if _, ok := visited[err]; ok {
            return false
        }
        visited[err] = struct{}{}
        if err == target {
            return true
        }
        if x, ok := err.(interface{ Is(error) bool }); ok && x.Is(target) {
            return true
        }
        u, ok := err.(interface{ Unwrap() error })
        if !ok {
            return false
        }
        err = u.Unwrap()
    }
    return false
}

type cyclic struct{ n int }
func (c *cyclic) Error() string { return fmt.Sprintf("c%d", c.n) }
func (c *cyclic) Unwrap() error { return c }

func main() {
    c := &cyclic{n: 1}
    fmt.Println(safeIs(c, errors.New("x"))) // false (would have hung with errors.Is)
}
```

(Note: avoid actually running `errors.Is(c, ...)` — it loops.)

---

## Task 14 (Hard) — Re-implement `errors.As` with generics

Write `AsT[T error](err error) (T, bool)` that returns the first error of type `T` in the chain.

**Hints**
- Use a generic type parameter constrained by `error`.
- Use the existing `errors.As` internally.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "os"
)

func AsT[T error](err error) (T, bool) {
    var t T
    if errors.As(err, &t) {
        return t, true
    }
    return t, false
}

func main() {
    _, err := os.Open("/no/such/file")
    if pe, ok := AsT[*os.PathError](err); ok {
        fmt.Println("path:", pe.Path)
    }
}
```

The generic shim is more ergonomic but does not work for pointer-to-interface targets without further work (interface types do not satisfy the `error` constraint).

---

## Task 15 (Hard) — Build a kind-counting test helper

Write a helper `CountKinds(err error, kinds ...error) map[error]int` that returns how many times each kind appears anywhere in `err`'s chain (using `errors.Is` semantics on each subtree node).

**Hints**
- Use the `walk` function from Task 12.
- Increment the map only for nodes that match each kind.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

var KindA = errors.New("kindA")
var KindB = errors.New("kindB")

type ke struct{ kind error }
func (e *ke) Error() string         { return e.kind.Error() }
func (e *ke) Is(target error) bool  { return target == e.kind }

func walk(err error, fn func(error)) {
    if err == nil {
        return
    }
    fn(err)
    switch x := err.(type) {
    case interface{ Unwrap() error }:
        walk(x.Unwrap(), fn)
    case interface{ Unwrap() []error }:
        for _, c := range x.Unwrap() {
            walk(c, fn)
        }
    }
}

func CountKinds(err error, kinds ...error) map[error]int {
    out := make(map[error]int)
    walk(err, func(e error) {
        for _, k := range kinds {
            if errors.Is(e, k) {
                out[k]++
            }
        }
    })
    return out
}

func main() {
    j := errors.Join(
        &ke{kind: KindA},
        &ke{kind: KindB},
        &ke{kind: KindA},
    )
    counts := CountKinds(j, KindA, KindB)
    fmt.Println(counts)
}
```

---
