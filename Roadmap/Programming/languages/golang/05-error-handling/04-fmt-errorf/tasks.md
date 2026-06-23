# fmt.Errorf — Tasks

> Hands-on exercises. Each comes with a problem statement, hints, and a reference solution. Difficulty: easy → hard.

---

## Task 1 (Easy) — Format a basic error

Write `OutOfRange(value, lo, hi int) error` that returns an error whose message is `"value <value> not in range [<lo>,<hi>]"`. No wrapping needed.

**Hints**
- Use `fmt.Errorf` with `%d`.

**Solution**
```go
package main

import "fmt"

func OutOfRange(value, lo, hi int) error {
    return fmt.Errorf("value %d not in range [%d,%d]", value, lo, hi)
}

func main() {
    fmt.Println(OutOfRange(7, 1, 5))
}
```

---

## Task 2 (Easy) — Wrap with `%w`

Define a sentinel `var ErrEmpty = errors.New("empty")`. Write `Head(items []int) (int, error)` that returns the first item or wraps `ErrEmpty` with the function name.

A caller should be able to do `errors.Is(err, ErrEmpty)`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

var ErrEmpty = errors.New("empty")

func Head(items []int) (int, error) {
    if len(items) == 0 {
        return 0, fmt.Errorf("Head: %w", ErrEmpty)
    }
    return items[0], nil
}

func main() {
    _, err := Head(nil)
    fmt.Println(err)
    fmt.Println(errors.Is(err, ErrEmpty))
}
```

---

## Task 3 (Easy) — `%v` vs `%w` demonstration

Write a function that returns the same error wrapped two ways: once with `%v` and once with `%w`. Print both, then check `errors.Is` against the original sentinel for each.

**Hints**
- Two functions, one sentinel, one main that prints both checks.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

var ErrSentinel = errors.New("sentinel")

func WithV() error { return fmt.Errorf("ctx: %v", ErrSentinel) }
func WithW() error { return fmt.Errorf("ctx: %w", ErrSentinel) }

func main() {
    a, b := WithV(), WithW()
    fmt.Println(a, "|", errors.Is(a, ErrSentinel)) // false
    fmt.Println(b, "|", errors.Is(b, ErrSentinel)) // true
}
```

---

## Task 4 (Easy → Medium) — Wrap a stdlib error

Write `OpenConfig(path string) ([]byte, error)` that calls `os.ReadFile` and wraps the result with the operation and the path. Make sure the caller can still detect "file not found" via `errors.Is(err, fs.ErrNotExist)`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "io/fs"
    "os"
)

func OpenConfig(path string) ([]byte, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("OpenConfig %q: %w", path, err)
    }
    return data, nil
}

func main() {
    _, err := OpenConfig("/no/such/path")
    fmt.Println(err)
    fmt.Println(errors.Is(err, fs.ErrNotExist))
}
```

---

## Task 5 (Medium) — Sentinel + parameter

Define `var ErrInvalid = errors.New("invalid input")`. Write `Validate(x int) error` that returns:
- `nil` for `0 <= x <= 100`.
- A wrap of `ErrInvalid` for everything else, including the offending value.

The caller should both find `ErrInvalid` via `errors.Is` and find the value `x` in the printed text.

**Solution**
```go
var ErrInvalid = errors.New("invalid input")

func Validate(x int) error {
    if x < 0 || x > 100 {
        return fmt.Errorf("Validate: x=%d: %w", x, ErrInvalid)
    }
    return nil
}
```

---

## Task 6 (Medium) — Per-iteration context

Write `Sum(strs []string) (int, error)` that parses each string with `strconv.Atoi` and sums the results. On the first parse error, return an error that names the failing index and value, wrapping the underlying error with `%w`.

**Solution**
```go
import (
    "fmt"
    "strconv"
)

func Sum(strs []string) (int, error) {
    total := 0
    for i, s := range strs {
        n, err := strconv.Atoi(s)
        if err != nil {
            return 0, fmt.Errorf("Sum: index %d (%q): %w", i, s, err)
        }
        total += n
    }
    return total, nil
}

func main() {
    fmt.Println(Sum([]string{"1", "2", "x", "4"}))
}
```

---

## Task 7 (Medium) — Multi-wrap (Go 1.20+)

Write `CommitOrRollback(commitErr, rollbackErr error) error` that:
- Returns nil if both are nil.
- Returns `commitErr` wrapped with operation name if only commit failed.
- Returns a multi-wrapped error of both if both failed.

The caller should be able to use `errors.Is` to detect either error.

**Solution**
```go
func CommitOrRollback(commitErr, rollbackErr error) error {
    switch {
    case commitErr == nil && rollbackErr == nil:
        return nil
    case rollbackErr == nil:
        return fmt.Errorf("commit: %w", commitErr)
    case commitErr == nil:
        return fmt.Errorf("rollback: %w", rollbackErr)
    default:
        return fmt.Errorf("commit: %w; rollback: %w", commitErr, rollbackErr)
    }
}
```

---

## Task 8 (Medium) — Translate at a layer boundary

Define a domain sentinel `ErrNotFound = errors.New("not found")`. Write `LookupUser(id int, dbErr error) (*User, error)` that simulates a storage layer. If `dbErr` is `sql.ErrNoRows`, translate it to `ErrNotFound` (wrapped with id). Otherwise, wrap `dbErr` directly.

**Solution**
```go
import (
    "database/sql"
    "errors"
    "fmt"
)

type User struct{ ID int }

var ErrNotFound = errors.New("not found")

func LookupUser(id int, dbErr error) (*User, error) {
    if dbErr == nil {
        return &User{ID: id}, nil
    }
    if errors.Is(dbErr, sql.ErrNoRows) {
        return nil, fmt.Errorf("LookupUser %d: %w", id, ErrNotFound)
    }
    return nil, fmt.Errorf("LookupUser %d: %w", id, dbErr)
}

func main() {
    _, err := LookupUser(7, sql.ErrNoRows)
    fmt.Println(err)
    fmt.Println(errors.Is(err, ErrNotFound)) // true
    fmt.Println(errors.Is(err, sql.ErrNoRows)) // false (translated)
}
```

---

## Task 9 (Medium → Hard) — Deferred wrap

Write `Process(name string) (err error)` with three sub-calls: `step1(name)`, `step2(name)`, `step3(name)`, each returning an error. Use a deferred `fmt.Errorf("Process(%q): %w", name, err)` to wrap *only on failure*, eliminating per-step `fmt.Errorf` boilerplate.

**Solution**
```go
func Process(name string) (err error) {
    defer func() {
        if err != nil {
            err = fmt.Errorf("Process(%q): %w", name, err)
        }
    }()
    if err := step1(name); err != nil {
        return err
    }
    if err := step2(name); err != nil {
        return err
    }
    return step3(name)
}
```

The output prefix is added once. The inner steps stay focused on their own errors.

---

## Task 10 (Hard) — Pipeline with per-step wrap

Build `Pipeline(input string) error` that runs three steps:
1. `parse(input) (Parsed, error)`
2. `validate(Parsed) error`
3. `transform(Parsed) error`

Each error must be wrapped with the step name and the function name. The top-level error message should look like:
```
Pipeline: validate: missing field "name"
```

**Solution**
```go
func Pipeline(input string) error {
    p, err := parse(input)
    if err != nil {
        return fmt.Errorf("Pipeline: parse: %w", err)
    }
    if err := validate(p); err != nil {
        return fmt.Errorf("Pipeline: validate: %w", err)
    }
    if err := transform(p); err != nil {
        return fmt.Errorf("Pipeline: transform: %w", err)
    }
    return nil
}
```

---

## Task 11 (Hard) — Custom error type wrapping a cause

Define `LookupError` carrying `Op string`, `ID int`, `Err error`. Implement `Error()` and `Unwrap()`. Write `Find(id int, cause error) error` that returns a `*LookupError`. Verify `errors.Is(err, cause)` works.

**Solution**
```go
type LookupError struct {
    Op  string
    ID  int
    Err error
}

func (e *LookupError) Error() string {
    return fmt.Sprintf("%s id=%d: %v", e.Op, e.ID, e.Err)
}

func (e *LookupError) Unwrap() error { return e.Err }

func Find(id int, cause error) error {
    return &LookupError{Op: "Find", ID: id, Err: cause}
}

func main() {
    base := errors.New("not found")
    err := Find(42, base)
    fmt.Println(err)
    fmt.Println(errors.Is(err, base)) // true
}
```

---

## Task 12 (Hard) — Test wrap chain depth

Write a function `WrapN(n int, base error) error` that wraps `base` `n` times with `fmt.Errorf("layer %d: %w", i, ...)`. Then write a test that verifies `errors.Is(result, base)` returns true regardless of `n`, and that `errors.Unwrap` walked exactly `n` times reaches `base`.

**Solution**
```go
func WrapN(n int, base error) error {
    err := base
    for i := 0; i < n; i++ {
        err = fmt.Errorf("layer %d: %w", i, err)
    }
    return err
}

func TestWrapN(t *testing.T) {
    base := errors.New("base")
    for _, n := range []int{0, 1, 5, 100} {
        err := WrapN(n, base)
        if !errors.Is(err, base) {
            t.Fatalf("n=%d: errors.Is failed", n)
        }
        cur := err
        for i := 0; i < n; i++ {
            cur = errors.Unwrap(cur)
            if cur == nil {
                t.Fatalf("n=%d: chain too short at step %d", n, i)
            }
        }
        if cur != base {
            t.Fatalf("n=%d: bottom not base", n)
        }
    }
}
```

---

## Task 13 (Hard) — Defer-friendly file write with wrap

Write `WriteFile(path string, data []byte) (err error)` that:
- Creates the file (wrap on error).
- Writes the data (wrap on error).
- Closes the file (wrap on error, but only if no earlier error).

All wraps include the path with `%q`.

**Solution**
```go
func WriteFile(path string, data []byte) (err error) {
    f, ferr := os.Create(path)
    if ferr != nil {
        return fmt.Errorf("create %q: %w", path, ferr)
    }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = fmt.Errorf("close %q: %w", path, cerr)
        }
    }()
    if _, werr := f.Write(data); werr != nil {
        return fmt.Errorf("write %q: %w", path, werr)
    }
    return nil
}
```

---

## Task 14 (Hard) — `errors.As` with wrapping

Define a typed error `*ParseError` with `Line int` and `Col int`. Write `parse(s string) error` that returns `&ParseError{Line:1, Col:5}` when the input is invalid, then wraps it with `fmt.Errorf("parse %q: %w", s, err)`. A caller should be able to extract the original `ParseError` via `errors.As`.

**Solution**
```go
type ParseError struct {
    Line, Col int
}

func (e *ParseError) Error() string {
    return fmt.Sprintf("parse error at %d:%d", e.Line, e.Col)
}

func parse(s string) error {
    if s == "" {
        inner := &ParseError{Line: 1, Col: 5}
        return fmt.Errorf("parse %q: %w", s, inner)
    }
    return nil
}

func main() {
    err := parse("")
    var pe *ParseError
    if errors.As(err, &pe) {
        fmt.Printf("found ParseError at %d:%d\n", pe.Line, pe.Col)
    }
}
```

---

## Task 15 (Hard) — Aggregate errors with multi-`%w` (Go 1.20+)

Write `ValidateAll(name, email string, age int) error` that runs three checks:
- `name != ""`
- `strings.Contains(email, "@")`
- `0 <= age <= 150`

Return a single `fmt.Errorf("invalid: %w; %w; %w", a, b, c)` if all three fail; a single wrap if one or two fail; nil otherwise.

**Hints**
- Build a slice of named errors first, then format conditionally.

**Solution sketch**
```go
import (
    "errors"
    "fmt"
    "strings"
)

var (
    ErrName  = errors.New("name empty")
    ErrEmail = errors.New("email missing @")
    ErrAge   = errors.New("age out of range")
)

func ValidateAll(name, email string, age int) error {
    var errs []error
    if name == "" { errs = append(errs, ErrName) }
    if !strings.Contains(email, "@") { errs = append(errs, ErrEmail) }
    if age < 0 || age > 150 { errs = append(errs, ErrAge) }
    switch len(errs) {
    case 0:
        return nil
    case 1:
        return fmt.Errorf("invalid: %w", errs[0])
    case 2:
        return fmt.Errorf("invalid: %w; %w", errs[0], errs[1])
    default:
        return fmt.Errorf("invalid: %w; %w; %w", errs[0], errs[1], errs[2])
    }
}
```

A more general approach uses `errors.Join`:

```go
return fmt.Errorf("invalid: %w", errors.Join(errs...))
```

But `Join` produces a `*joinError` with its own multi-line format; `fmt.Errorf` with explicit `%w`s gives you sentence-shaped output.

---

## Task 16 (Boss-level) — `Wrap` helper that captures op name

Build a small helper `func Wrap(op string, err error) error` that:
- Returns nil if `err == nil` (do not wrap nil!).
- Returns `fmt.Errorf("%s: %w", op, err)` otherwise.

Then add a `Wrapf(op string, err error, format string, args ...any) error` variant that injects formatted context:

```go
return Wrapf("LookupUser", err, "id=%d", id)
// produces: "LookupUser id=42: <err>"
```

Implement both with proper handling for nil input.

**Solution**
```go
package wrap

import "fmt"

func Wrap(op string, err error) error {
    if err == nil {
        return nil
    }
    return fmt.Errorf("%s: %w", op, err)
}

func Wrapf(op string, err error, format string, args ...any) error {
    if err == nil {
        return nil
    }
    return fmt.Errorf("%s "+format+": %w", append(append([]any{op}, args...), err)...)
}
```

The variadic argument-construction is fiddly. A cleaner alternative builds the prefix first:

```go
func Wrapf(op string, err error, format string, args ...any) error {
    if err == nil {
        return nil
    }
    detail := fmt.Sprintf(format, args...)
    return fmt.Errorf("%s %s: %w", op, detail, err)
}
```

Two `Sprintf`-style allocations vs the inline version's one. Choose based on whether you care.

---

## Task 17 (Boss-level) — Custom Is method on a wrap-friendly error

Define `*HTTPError` with a `Status int`. Implement `Is(target error) bool` so that `errors.Is(err, &HTTPError{Status: 404})` returns true for any `*HTTPError` with `Status=404`. Then wrap a 404 error inside another `fmt.Errorf` and verify the `Is` match still works.

**Solution**
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
    return ok && e.Status == t.Status
}

func main() {
    inner := &HTTPError{Status: 404, Msg: "missing"}
    outer := fmt.Errorf("fetch /users: %w", inner)
    target := &HTTPError{Status: 404}
    fmt.Println(errors.Is(outer, target)) // true
}
```

Walking through: `errors.Is(outer, target)` first compares `outer == target` (false), unwraps to `inner`, then because `inner` has an `Is` method, calls `inner.Is(target)` which returns true.
