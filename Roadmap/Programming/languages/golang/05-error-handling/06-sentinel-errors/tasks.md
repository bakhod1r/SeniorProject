# Sentinel Errors — Tasks

> Hands-on exercises. Each comes with a problem statement, hints, and a reference solution. Difficulty: easy → hard.

---

## Task 1 (Easy) — Declare a sentinel

Define a package-level sentinel `ErrEmpty` with message `"empty input"`. Write a function `First(items []int) (int, error)` that returns the first item or `ErrEmpty` when the slice is empty.

**Hints**
- `errors.New` at package scope.
- Compare length with `len(items) == 0`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

var ErrEmpty = errors.New("empty input")

func First(items []int) (int, error) {
    if len(items) == 0 {
        return 0, ErrEmpty
    }
    return items[0], nil
}

func main() {
    _, err := First(nil)
    fmt.Println(errors.Is(err, ErrEmpty)) // true
}
```

---

## Task 2 (Easy) — Detect with `errors.Is`

Given a function `lookup(key string) error` that returns `ErrNotFound` for missing keys, write a `MustLookup(key string)` helper that prints `"missing"` for not-found and `"ok"` otherwise.

**Hints**
- Use `errors.Is`, not `==`.

**Solution**
```go
var ErrNotFound = errors.New("not found")

func lookup(key string) error {
    if key == "" {
        return ErrNotFound
    }
    return nil
}

func MustLookup(key string) {
    err := lookup(key)
    switch {
    case errors.Is(err, ErrNotFound):
        fmt.Println("missing")
    case err != nil:
        fmt.Println("error:", err)
    default:
        fmt.Println("ok")
    }
}
```

---

## Task 3 (Easy) — Read until EOF

Write `ReadAllLines(r io.Reader) ([]string, error)` that reads line-delimited text and returns all non-empty lines. End-of-stream (`io.EOF`) is a normal termination, not an error.

**Hints**
- Use `bufio.Scanner` for the easy path, or `bufio.Reader.ReadString('\n')` for the manual loop.
- `errors.Is(err, io.EOF)` to detect end of stream.

**Solution**
```go
func ReadAllLines(r io.Reader) ([]string, error) {
    br := bufio.NewReader(r)
    var lines []string
    for {
        line, err := br.ReadString('\n')
        line = strings.TrimRight(line, "\n")
        if line != "" {
            lines = append(lines, line)
        }
        if errors.Is(err, io.EOF) {
            return lines, nil
        }
        if err != nil {
            return lines, fmt.Errorf("read: %w", err)
        }
    }
}
```

---

## Task 4 (Easy → Medium) — Wrapping a sentinel

Given:
```go
var ErrInvalid = errors.New("invalid")
```

Write `ParseAge(s string) (int, error)` that returns the parsed integer if it is in `[0, 150]`, or wraps `ErrInvalid` with the offending value:

```
parse age "300": invalid
```

**Hints**
- Use `fmt.Errorf("parse age %q: %w", s, ErrInvalid)`.

**Solution**
```go
var ErrInvalid = errors.New("invalid")

func ParseAge(s string) (int, error) {
    n, err := strconv.Atoi(s)
    if err != nil {
        return 0, fmt.Errorf("parse age %q: %w", s, ErrInvalid)
    }
    if n < 0 || n > 150 {
        return 0, fmt.Errorf("parse age %q: %w", s, ErrInvalid)
    }
    return n, nil
}

func main() {
    _, err := ParseAge("300")
    fmt.Println(errors.Is(err, ErrInvalid)) // true
    fmt.Println(err)                         // parse age "300": invalid
}
```

---

## Task 5 (Medium) — Switching on multiple sentinels

Write a single-page HTTP-style handler that maps a domain error to an integer status code:

| Sentinel | Status |
|----------|--------|
| `ErrNotFound`     | 404 |
| `ErrInvalidInput` | 400 |
| `ErrConflict`     | 409 |
| `ErrUnauthorized` | 401 |
| anything else     | 500 |

**Solution**
```go
var (
    ErrNotFound      = errors.New("not found")
    ErrInvalidInput  = errors.New("invalid input")
    ErrConflict      = errors.New("conflict")
    ErrUnauthorized  = errors.New("unauthorized")
)

func StatusFor(err error) int {
    switch {
    case err == nil:
        return 200
    case errors.Is(err, ErrNotFound):
        return 404
    case errors.Is(err, ErrInvalidInput):
        return 400
    case errors.Is(err, ErrConflict):
        return 409
    case errors.Is(err, ErrUnauthorized):
        return 401
    default:
        return 500
    }
}
```

---

## Task 6 (Medium) — Sentinel-driven retry

Write `RetryUntilNotTransient(attempts int, fn func() error) error`. Treat the package sentinel `ErrTransient` (and anything wrapping it) as retryable; everything else is permanent and should return immediately.

**Hints**
- `errors.Is(err, ErrTransient)`.
- Stop early on permanent errors.

**Solution**
```go
var ErrTransient = errors.New("transient")

func RetryUntilNotTransient(attempts int, fn func() error) error {
    var last error
    for i := 0; i < attempts; i++ {
        if err := fn(); err == nil {
            return nil
        } else {
            if !errors.Is(err, ErrTransient) {
                return err
            }
            last = err
        }
    }
    return fmt.Errorf("after %d attempts: %w", attempts, last)
}
```

---

## Task 7 (Medium) — Custom `Is` method

Create a typed error `*HTTPStatusError` carrying `Status int`. Implement an `Is` method so that
`errors.Is(err, target)` returns true whenever `target` is also `*HTTPStatusError` with the *same* status. Then write a sentinel `ErrTooManyRequests = &HTTPStatusError{Status: 429}` and verify a wrapped version still matches.

**Solution**
```go
type HTTPStatusError struct {
    Status int
}

func (e *HTTPStatusError) Error() string {
    return fmt.Sprintf("http %d", e.Status)
}

func (e *HTTPStatusError) Is(target error) bool {
    t, ok := target.(*HTTPStatusError)
    return ok && t.Status == e.Status
}

var ErrTooManyRequests = &HTTPStatusError{Status: 429}

func main() {
    err := fmt.Errorf("api: %w", &HTTPStatusError{Status: 429})
    fmt.Println(errors.Is(err, ErrTooManyRequests)) // true
}
```

---

## Task 8 (Medium → Hard) — Bridging a typed error to a sentinel

You have:
```go
var ErrNotFound = errors.New("not found")
```

Add a typed error `*UserNotFoundError` with field `ID int` and message `"user N: not found"`. Wire its `Is` method so that `errors.Is(err, ErrNotFound)` returns true when `err` is `*UserNotFoundError`.

Write `Lookup(id int) error` that returns `&UserNotFoundError{ID: id}` for `id == 0`, otherwise nil.

**Solution**
```go
var ErrNotFound = errors.New("not found")

type UserNotFoundError struct {
    ID int
}

func (e *UserNotFoundError) Error() string {
    return fmt.Sprintf("user %d: not found", e.ID)
}

func (e *UserNotFoundError) Is(target error) bool {
    return target == ErrNotFound
}

func Lookup(id int) error {
    if id == 0 {
        return &UserNotFoundError{ID: id}
    }
    return nil
}

func main() {
    err := Lookup(0)
    fmt.Println(errors.Is(err, ErrNotFound))         // true
    var ufe *UserNotFoundError
    fmt.Println(errors.As(err, &ufe), ufe.ID)        // true 0
}
```

---

## Task 9 (Hard) — `os.ErrNotExist` round-trip

Write `LoadConfig(path string) ([]byte, error)` that reads a file and returns its contents. The error must satisfy *all* of:

1. `errors.Is(err, fs.ErrNotExist)` for missing files.
2. `errors.As(err, &pathErr)` to recover `*fs.PathError`.
3. The top-level error message starts with `load config: ...`.

**Solution**
```go
import (
    "errors"
    "fmt"
    "io/fs"
    "os"
)

func LoadConfig(path string) ([]byte, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("load config: %w", err)
    }
    return data, nil
}

func main() {
    _, err := LoadConfig("/no-such")
    fmt.Println(errors.Is(err, fs.ErrNotExist)) // true
    var pe *fs.PathError
    fmt.Println(errors.As(err, &pe))            // true
    fmt.Println(err)                            // load config: open /no-such: ...
}
```

---

## Task 10 (Hard) — Build a domain vocabulary

Build a small package `inventory` with sentinels for:

- `ErrSKUNotFound`
- `ErrOutOfStock`
- `ErrInvalidQuantity`

Write `Reserve(sku string, qty int) error` that returns:

- `ErrInvalidQuantity` if `qty <= 0`.
- `ErrSKUNotFound` (wrapped with the SKU) if the SKU is unknown.
- `ErrOutOfStock` (wrapped with the available count) if the requested quantity exceeds stock.
- nil on success.

Provide a small in-memory stock map for testing.

**Solution**
```go
package inventory

import (
    "errors"
    "fmt"
)

var (
    ErrSKUNotFound     = errors.New("sku not found")
    ErrOutOfStock      = errors.New("out of stock")
    ErrInvalidQuantity = errors.New("invalid quantity")
)

var stock = map[string]int{
    "apple":  10,
    "banana": 0,
    "cherry": 3,
}

func Reserve(sku string, qty int) error {
    if qty <= 0 {
        return fmt.Errorf("Reserve %q qty=%d: %w", sku, qty, ErrInvalidQuantity)
    }
    available, ok := stock[sku]
    if !ok {
        return fmt.Errorf("Reserve %q: %w", sku, ErrSKUNotFound)
    }
    if qty > available {
        return fmt.Errorf("Reserve %q qty=%d (have %d): %w", sku, qty, available, ErrOutOfStock)
    }
    stock[sku] = available - qty
    return nil
}
```

---

## Task 11 (Hard) — Cross-package sentinel translation

Define two packages:

- `repo` returns `repo.ErrNoRows` (its own sentinel).
- `service` re-exposes its own `service.ErrNotFound` to callers.

Write `service.Find(id int) error` that calls `repo.Get(id)` and translates `repo.ErrNoRows` into `service.ErrNotFound` (wrapped with context). Other `repo` errors pass through.

**Solution**
```go
package repo

var ErrNoRows = errors.New("no rows")

func Get(id int) error {
    if id == 0 { return ErrNoRows }
    return nil
}

package service

var ErrNotFound = errors.New("not found")

func Find(id int) error {
    err := repo.Get(id)
    if errors.Is(err, repo.ErrNoRows) {
        return fmt.Errorf("Find(%d): %w", id, ErrNotFound)
    }
    if err != nil {
        return fmt.Errorf("Find(%d): %w", id, err)
    }
    return nil
}
```

The translation isolates the `repo` sentinel inside `service`; callers of `service` only depend on `service.ErrNotFound`.

---

## Task 12 (Hard) — Detect a sentinel after `errors.Join`

Write a function `RunAll(jobs []func() error) error` that runs every job, collects all errors, and returns them via `errors.Join`. Then write a caller that detects whether *any* job returned `ErrTimeout`.

**Solution**
```go
var ErrTimeout = errors.New("timeout")

func RunAll(jobs []func() error) error {
    var errs []error
    for _, j := range jobs {
        if err := j(); err != nil {
            errs = append(errs, err)
        }
    }
    return errors.Join(errs...)
}

func main() {
    err := RunAll([]func() error{
        func() error { return ErrTimeout },
        func() error { return errors.New("other") },
    })
    fmt.Println(errors.Is(err, ErrTimeout)) // true
}
```

`errors.Is` traverses joined errors via `Unwrap() []error` (Go 1.20+).

---

## Task 13 (Hard) — Sentinel collision check

Write a tiny test that ensures three sentinels in your package are *not* aliases of each other (i.e., they are three distinct values). Use `==`.

**Solution**
```go
var (
    ErrA = errors.New("a")
    ErrB = errors.New("b")
    ErrC = errors.New("c")
)

func TestSentinelsDistinct(t *testing.T) {
    if ErrA == ErrB || ErrB == ErrC || ErrA == ErrC {
        t.Fatal("sentinels must be distinct values")
    }
}
```

This test catches accidental copy-paste like `var ErrB = ErrA`.

---

## Task 14 (Hard) — Sentinel wire codec

Build a tiny encoder/decoder for sending sentinels across a wire-format boundary. The wire format is a JSON object `{"code": "...", "message": "..."}`. The encoder maps known sentinels to codes; the decoder maps codes back to local sentinels.

**Solution**
```go
var (
    ErrNotFound = errors.New("not found")
    ErrConflict = errors.New("conflict")
)

type wireError struct {
    Code    string `json:"code"`
    Message string `json:"message"`
}

var encodeMap = map[error]string{
    ErrNotFound: "not_found",
    ErrConflict: "conflict",
}

var decodeMap = map[string]error{
    "not_found": ErrNotFound,
    "conflict":  ErrConflict,
}

func Encode(err error) wireError {
    for sentinel, code := range encodeMap {
        if errors.Is(err, sentinel) {
            return wireError{Code: code, Message: err.Error()}
        }
    }
    return wireError{Code: "internal", Message: err.Error()}
}

func Decode(w wireError) error {
    if e, ok := decodeMap[w.Code]; ok {
        return fmt.Errorf("%s: %w", w.Message, e)
    }
    return errors.New(w.Message)
}
```

This is the pattern real RPC frameworks use for cross-process sentinel-like behavior.

---

## Task 15 (Boss-level) — Domain error type with sentinel matching

Combine sentinels and a typed error: build `domain.Error` with fields `{Op, Kind, Err}`. Implement `Error()`, `Unwrap()`, and `Is(target error) bool` so that:

- `errors.Is(err, ErrNotFound)` matches when `Kind == KindNotFound`.
- `errors.As(err, &de)` extracts the `*domain.Error`.
- `Unwrap` returns the cause.

Provide a small constructor `domain.E(op string, kind Kind, err error) error`.

**Solution**
```go
package domain

import (
    "errors"
    "fmt"
)

type Kind int

const (
    KindOther Kind = iota
    KindNotFound
    KindInvalid
    KindConflict
)

var (
    ErrNotFound = &Error{Kind: KindNotFound}
    ErrInvalid  = &Error{Kind: KindInvalid}
    ErrConflict = &Error{Kind: KindConflict}
)

type Error struct {
    Op   string
    Kind Kind
    Err  error
}

func (e *Error) Error() string {
    if e.Op == "" {
        return fmt.Sprintf("kind=%d", e.Kind)
    }
    return fmt.Sprintf("%s: kind=%d: %v", e.Op, e.Kind, e.Err)
}

func (e *Error) Unwrap() error { return e.Err }

func (e *Error) Is(target error) bool {
    t, ok := target.(*Error)
    return ok && t.Kind == e.Kind
}

func E(op string, kind Kind, err error) error {
    return &Error{Op: op, Kind: kind, Err: err}
}

// Usage:
//
//   err := domain.E("Get", domain.KindNotFound, nil)
//   errors.Is(err, domain.ErrNotFound)  // true
//   var de *domain.Error
//   errors.As(err, &de)                  // de.Op == "Get"
```

This is the Upspin / cockroachdb pattern compressed into one struct: typed for fields, sentinel-shaped for matching.
