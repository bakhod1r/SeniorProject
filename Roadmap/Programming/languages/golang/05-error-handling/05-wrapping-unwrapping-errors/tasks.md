# Wrapping & Unwrapping Errors — Tasks

> Hands-on exercises. Each comes with a problem statement, hints, and a reference solution. Difficulty: easy → hard.

---

## Task 1 (Easy) — Wrap with context

Write a function `LoadConfig(path string) ([]byte, error)` that reads a file with `os.ReadFile` and returns the bytes. On error, wrap with the message `"load config <path>"` so that `errors.Is(err, fs.ErrNotExist)` still works for missing files.

**Hints**
- Use `fmt.Errorf` with `%w`.
- Always check `if err != nil` first.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "io/fs"
    "os"
)

func LoadConfig(path string) ([]byte, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("load config %q: %w", path, err)
    }
    return data, nil
}

func main() {
    _, err := LoadConfig("/nope.json")
    fmt.Println(err)
    fmt.Println("is ErrNotExist?", errors.Is(err, fs.ErrNotExist))
}
```

---

## Task 2 (Easy) — `errors.Is` through a chain

Given a wrapped error, write code that detects whether `io.EOF` is anywhere in the chain.

**Hints**
- `errors.Is`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "io"
)

func main() {
    wrapped := fmt.Errorf("layer 1: %w", fmt.Errorf("layer 2: %w", io.EOF))

    if errors.Is(wrapped, io.EOF) {
        fmt.Println("end of stream")
    }
}
```

---

## Task 3 (Easy) — Difference between `%v` and `%w`

Demonstrate the difference: write code that wraps `io.EOF` once with `%v` and once with `%w`, and show that `errors.Is(_, io.EOF)` returns true for one and false for the other.

**Hints**
- Two parallel calls.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "io"
)

func main() {
    w := fmt.Errorf("read: %w", io.EOF)
    v := fmt.Errorf("read: %v", io.EOF)

    fmt.Println("with %w:", errors.Is(w, io.EOF))
    fmt.Println("with %v:", errors.Is(v, io.EOF))
}
```

Output:
```
with %w: true
with %v: false
```

---

## Task 4 (Easy → Medium) — Extract a typed error

Given a chain that contains a `*fs.PathError`, use `errors.As` to extract it and print its `Path` field.

**Hints**
- Use `os.Open` on a non-existent file to produce a `*fs.PathError`, then wrap.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "io/fs"
    "os"
)

func main() {
    _, err := os.Open("/nope")
    if err == nil {
        return
    }
    wrapped := fmt.Errorf("opening file: %w", err)

    var pe *fs.PathError
    if errors.As(wrapped, &pe) {
        fmt.Println("path:", pe.Path)
        fmt.Println("op:", pe.Op)
    }
}
```

---

## Task 5 (Medium) — Custom error type with `Unwrap`

Define a `RepoError` type with `Op string`, `Resource string`, and `Err error`. Implement `Error()` and `Unwrap()`. Write a function that returns a `*RepoError` wrapping a sentinel `ErrNotFound`. Show that `errors.Is(returned, ErrNotFound)` is true.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

var ErrNotFound = errors.New("not found")

type RepoError struct {
    Op       string
    Resource string
    Err      error
}

func (e *RepoError) Error() string {
    return fmt.Sprintf("repo %s on %s: %v", e.Op, e.Resource, e.Err)
}

func (e *RepoError) Unwrap() error {
    return e.Err
}

func find(id string) error {
    return &RepoError{Op: "find", Resource: "users", Err: ErrNotFound}
}

func main() {
    err := find("42")
    fmt.Println(err)
    fmt.Println("is ErrNotFound?", errors.Is(err, ErrNotFound))
}
```

---

## Task 6 (Medium) — Custom `Is` method

Define `*HTTPError` with `Status int` and `Msg string`. Implement an `Is` method so that `errors.Is(actual, target)` returns true when both are `*HTTPError` and `Status` matches.

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

func (e *HTTPError) Error() string {
    return fmt.Sprintf("http %d: %s", e.Status, e.Msg)
}

func (e *HTTPError) Is(target error) bool {
    t, ok := target.(*HTTPError)
    return ok && e.Status == t.Status
}

func main() {
    actual := &HTTPError{Status: 404, Msg: "user not found"}
    want := &HTTPError{Status: 404}
    fmt.Println(errors.Is(actual, want)) // true
}
```

---

## Task 7 (Medium) — `errors.Join` for validation

Write `Validate(name string, age int) error` that returns `errors.Join` of all violated rules:
- name must be non-empty,
- age must be in [0, 150].

The caller should be able to detect each rule with `errors.Is`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

var (
    ErrEmptyName = errors.New("name is empty")
    ErrBadAge    = errors.New("age out of range")
)

func Validate(name string, age int) error {
    var errs []error
    if name == "" {
        errs = append(errs, ErrEmptyName)
    }
    if age < 0 || age > 150 {
        errs = append(errs, fmt.Errorf("%w: %d", ErrBadAge, age))
    }
    return errors.Join(errs...)
}

func main() {
    err := Validate("", -1)
    fmt.Println(err)
    fmt.Println("empty name?", errors.Is(err, ErrEmptyName))
    fmt.Println("bad age?", errors.Is(err, ErrBadAge))
}
```

---

## Task 8 (Medium → Hard) — Multi-step pipeline with wrapping

Build `Pipeline(input string) (Output, error)` that runs three steps: `parse`, `validate`, `transform`. Each error must be wrapped with the step name so the message reads:

```
pipeline: validate: missing field foo
```

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

type Output struct{ /* ... */ }

var ErrMissingField = errors.New("missing field foo")

func parse(input string) (string, error)         { return input, nil }
func validate(s string) error                    { return ErrMissingField }
func transform(s string) (Output, error)         { return Output{}, nil }

func Pipeline(input string) (Output, error) {
    p, err := parse(input)
    if err != nil {
        return Output{}, fmt.Errorf("pipeline: parse: %w", err)
    }
    if err := validate(p); err != nil {
        return Output{}, fmt.Errorf("pipeline: validate: %w", err)
    }
    out, err := transform(p)
    if err != nil {
        return Output{}, fmt.Errorf("pipeline: transform: %w", err)
    }
    return out, nil
}

func main() {
    _, err := Pipeline("data")
    fmt.Println(err)
    fmt.Println("is ErrMissingField?", errors.Is(err, ErrMissingField))
}
```

---

## Task 9 (Hard) — Concurrent collect with `errors.Join`

Run `process(int) error` concurrently for ids 1..10. Collect all non-nil errors and return them via `errors.Join`. Wrap each with the id that failed.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "sync"
)

func process(id int) error {
    if id%3 == 0 {
        return fmt.Errorf("bad id %d", id)
    }
    return nil
}

func RunAll() error {
    var (
        wg   sync.WaitGroup
        mu   sync.Mutex
        errs []error
    )
    for i := 1; i <= 10; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            if err := process(id); err != nil {
                mu.Lock()
                errs = append(errs, fmt.Errorf("id=%d: %w", id, err))
                mu.Unlock()
            }
        }(i)
    }
    wg.Wait()
    return errors.Join(errs...)
}

func main() {
    err := RunAll()
    if err != nil {
        fmt.Println(err)
    }
}
```

---

## Task 10 (Hard) — Multiple `%w` (Go 1.20+)

Write `CombineErrors(a, b error) error` that uses `fmt.Errorf` with two `%w` verbs to wrap both errors in one message. Verify that `errors.Is` finds either one.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

var (
    ErrA = errors.New("A")
    ErrB = errors.New("B")
)

func CombineErrors(a, b error) error {
    return fmt.Errorf("combined: %w; %w", a, b)
}

func main() {
    err := CombineErrors(ErrA, ErrB)
    fmt.Println(err)
    fmt.Println("is A?", errors.Is(err, ErrA))
    fmt.Println("is B?", errors.Is(err, ErrB))
}
```

---

## Task 11 (Hard) — Translation at the boundary

Write a repo function that translates `sql.ErrNoRows` to a domain `ErrNotFound`. All other errors should be wrapped with the operation name. Show that callers using `errors.Is(err, ErrNotFound)` get the right answer.

**Solution**
```go
package main

import (
    "database/sql"
    "errors"
    "fmt"
)

var ErrNotFound = errors.New("not found")

type Repo struct{ /* db *sql.DB */ }

func (r *Repo) FindByID(id int) error {
    err := simulateQuery(id) // returns sql.ErrNoRows for some ids
    switch {
    case errors.Is(err, sql.ErrNoRows):
        return fmt.Errorf("repo.FindByID id=%d: %w", id, ErrNotFound)
    case err != nil:
        return fmt.Errorf("repo.FindByID id=%d: %w", id, err)
    }
    return nil
}

func simulateQuery(id int) error {
    if id == 1 {
        return sql.ErrNoRows
    }
    return nil
}

func main() {
    r := &Repo{}
    err := r.FindByID(1)
    fmt.Println(err)
    fmt.Println("is ErrNotFound?", errors.Is(err, ErrNotFound))
}
```

---

## Task 12 (Hard) — Custom `Unwrap() []error` type

Build a `MultiError` type with `Errs []error` field, implement `Error()` (newline-joined) and `Unwrap() []error`. Verify that `errors.Is` finds any of the contained sentinels.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "strings"
)

var (
    ErrX = errors.New("X")
    ErrY = errors.New("Y")
)

type MultiError struct {
    Errs []error
}

func (m *MultiError) Error() string {
    parts := make([]string, len(m.Errs))
    for i, e := range m.Errs {
        parts[i] = e.Error()
    }
    return strings.Join(parts, "\n")
}

func (m *MultiError) Unwrap() []error { return m.Errs }

func main() {
    m := &MultiError{Errs: []error{ErrX, fmt.Errorf("wrapped: %w", ErrY)}}
    fmt.Println(m)
    fmt.Println("is X?", errors.Is(m, ErrX))
    fmt.Println("is Y?", errors.Is(m, ErrY))
}
```

---

## Task 13 (Hard) — Detect non-comparable target

Write code that demonstrates the panic when `errors.Is` is called with a non-comparable target (a struct with a slice field), then fix it by adding a custom `Is` method.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

type ListErr struct {
    Items []string
}

func (e *ListErr) Error() string { return fmt.Sprintf("list: %v", e.Items) }

// Without custom Is, comparing *ListErr values is fine because pointers are
// comparable. But comparing the *value* (ListErr without pointer) crashes.
// Fix: provide custom Is.
func (e *ListErr) Is(target error) bool {
    t, ok := target.(*ListErr)
    if !ok {
        return false
    }
    if len(e.Items) != len(t.Items) {
        return false
    }
    for i := range e.Items {
        if e.Items[i] != t.Items[i] {
            return false
        }
    }
    return true
}

func main() {
    a := &ListErr{Items: []string{"x", "y"}}
    b := &ListErr{Items: []string{"x", "y"}}
    fmt.Println(errors.Is(a, b)) // true via custom Is
}
```

---

## Task 14 (Hard) — Test-driven wrap behavior

Write a test that exercises a `Save` function which can fail with three different sentinel errors (`ErrConflict`, `ErrTimeout`, `ErrInternal`). Use a single function to dispatch on the chain via `errors.Is`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "testing"
)

var (
    ErrConflict = errors.New("conflict")
    ErrTimeout  = errors.New("timeout")
    ErrInternal = errors.New("internal")
)

func Save(state int) error {
    switch state {
    case 1:
        return fmt.Errorf("save: %w", ErrConflict)
    case 2:
        return fmt.Errorf("save: %w", ErrTimeout)
    default:
        return fmt.Errorf("save: %w", ErrInternal)
    }
}

func classify(err error) string {
    switch {
    case errors.Is(err, ErrConflict):
        return "conflict"
    case errors.Is(err, ErrTimeout):
        return "timeout"
    default:
        return "internal"
    }
}

func TestSaveClassification(t *testing.T) {
    cases := []struct {
        state int
        want  string
    }{
        {1, "conflict"},
        {2, "timeout"},
        {3, "internal"},
    }
    for _, c := range cases {
        got := classify(Save(c.state))
        if got != c.want {
            t.Errorf("state=%d: got %q want %q", c.state, got, c.want)
        }
    }
}
```

---

## Task 15 (Boss-level) — Build a full structured error type

Define an `Error` type carrying:
- `Op string` (operation name),
- `Kind string` (a domain category),
- `Err error` (cause).

Implement `Error()`, `Unwrap()`, `Is()` (matches by `Kind`), and `As()`. Also write a constructor `New(op, kind string, cause error) error`. Verify that `errors.Is` matches by kind, and `errors.As` extracts the typed error.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

type Error struct {
    Op   string
    Kind string
    Err  error
}

func New(op, kind string, cause error) error {
    return &Error{Op: op, Kind: kind, Err: cause}
}

func (e *Error) Error() string {
    if e.Err != nil {
        return fmt.Sprintf("%s [%s]: %v", e.Op, e.Kind, e.Err)
    }
    return fmt.Sprintf("%s [%s]", e.Op, e.Kind)
}

func (e *Error) Unwrap() error { return e.Err }

func (e *Error) Is(target error) bool {
    t, ok := target.(*Error)
    if !ok {
        return false
    }
    return e.Kind == t.Kind
}

func (e *Error) As(target any) bool {
    if t, ok := target.(**Error); ok {
        *t = e
        return true
    }
    return false
}

var ErrConflict = &Error{Kind: "conflict"}

func main() {
    err := New("user.Save", "conflict", fmt.Errorf("duplicate email"))
    fmt.Println(err)

    fmt.Println("is conflict?", errors.Is(err, ErrConflict))

    var got *Error
    if errors.As(err, &got) {
        fmt.Println("op:", got.Op)
        fmt.Println("kind:", got.Kind)
    }
}
```

This is the foundation many production codebases use. Add stack capture, optional fields, and a friendlier constructor (variadic `args ...any` Upspin-style) for a complete solution.
