# Error Handling Basics — Tasks

> Hands-on exercises. Each comes with a problem statement, hints, and a reference solution. Difficulty: easy → hard.

---

## Task 1 (Easy) — Safe division

Write a function `Divide(a, b float64) (float64, error)` that returns `a/b` if `b != 0`, otherwise an error with the message `"division by zero"`.

**Hints**
- Return `0` and an error when `b == 0`.
- Use `errors.New`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

func Divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, errors.New("division by zero")
    }
    return a / b, nil
}

func main() {
    fmt.Println(Divide(10, 2))
    fmt.Println(Divide(10, 0))
}
```

---

## Task 2 (Easy) — Parse a positive integer

Write `ParsePositive(s string) (int, error)` that:
- Returns the parsed integer if `s` is a valid positive number.
- Returns an error if `s` is not a valid number, or if it is negative or zero.

**Hints**
- Use `strconv.Atoi`.
- Compose: parse first, then range-check.

**Solution**
```go
func ParsePositive(s string) (int, error) {
    n, err := strconv.Atoi(s)
    if err != nil {
        return 0, fmt.Errorf("parse %q: %w", s, err)
    }
    if n <= 0 {
        return 0, fmt.Errorf("not positive: %d", n)
    }
    return n, nil
}
```

---

## Task 3 (Easy) — Read a file or default

Write `ReadOrDefault(path, def string) string` that returns the contents of `path`, or `def` if the file cannot be read.

**Hints**
- `os.ReadFile`.
- Convert `[]byte` to `string`.

**Solution**
```go
func ReadOrDefault(path, def string) string {
    data, err := os.ReadFile(path)
    if err != nil {
        return def
    }
    return string(data)
}
```

---

## Task 4 (Easy → Medium) — First success

Write `FirstSuccess(fns ...func() (int, error)) (int, error)` that:
- Calls each function in order.
- Returns the first successful result.
- If all fail, returns `errors.Join` of all errors.

**Hints**
- Loop, accumulate, return on success.

**Solution**
```go
func FirstSuccess(fns ...func() (int, error)) (int, error) {
    var errs []error
    for _, fn := range fns {
        n, err := fn()
        if err == nil {
            return n, nil
        }
        errs = append(errs, err)
    }
    return 0, errors.Join(errs...)
}
```

---

## Task 5 (Medium) — Validation with multiple errors

Write `Validate(name, email string, age int) error` that returns:
- An error with all violated rules joined.
- `nil` if everything is valid.

Rules:
- `name` must be non-empty.
- `email` must contain '@'.
- `age` must be in [0, 150].

**Solution**
```go
func Validate(name, email string, age int) error {
    var errs []error
    if name == "" {
        errs = append(errs, errors.New("name: empty"))
    }
    if !strings.Contains(email, "@") {
        errs = append(errs, errors.New("email: missing @"))
    }
    if age < 0 || age > 150 {
        errs = append(errs, fmt.Errorf("age: out of range %d", age))
    }
    return errors.Join(errs...)
}
```

---

## Task 6 (Medium) — Retry with backoff

Write `Retry(attempts int, fn func() error) error` that:
- Calls `fn` up to `attempts` times.
- Returns nil on first success.
- Sleeps `100ms * 2^i` between attempts.
- Returns the last error wrapped with `"after N attempts: %w"`.

**Solution**
```go
func Retry(attempts int, fn func() error) error {
    var lastErr error
    for i := 0; i < attempts; i++ {
        if err := fn(); err == nil {
            return nil
        } else {
            lastErr = err
            time.Sleep(100 * time.Millisecond << i)
        }
    }
    return fmt.Errorf("after %d attempts: %w", attempts, lastErr)
}
```

---

## Task 7 (Medium) — Sentinel error

Define `var ErrEmpty = errors.New("empty input")` and write `Head(items []int) (int, error)` that returns:
- The first item on success.
- `ErrEmpty` (wrapped) if the slice is empty.

The caller should be able to do `if errors.Is(err, ErrEmpty)`.

**Solution**
```go
var ErrEmpty = errors.New("empty input")

func Head(items []int) (int, error) {
    if len(items) == 0 {
        return 0, fmt.Errorf("Head: %w", ErrEmpty)
    }
    return items[0], nil
}
```

---

## Task 8 (Medium) — Typed error with errors.As

Define `ValidationError` with `Field` and `Message` fields and `Error() string` method. Write `RequireField(name, value string) error` that returns a `*ValidationError` when `value == ""`, nil otherwise.

A caller should be able to do `errors.As(err, &ve)` and then read `ve.Field`.

**Solution**
```go
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation: %s: %s", e.Field, e.Message)
}

func RequireField(name, value string) error {
    if value == "" {
        return &ValidationError{Field: name, Message: "must not be empty"}
    }
    return nil
}
```

---

## Task 9 (Medium → Hard) — Wrap-aware FileError

Define `FileError` carrying `Path` and underlying `Err`. Implement `Error()` and `Unwrap()`. Write `OpenFile(path string) error` that wraps a fake "not found" error.

Verify that `errors.Is(err, fs.ErrNotExist)` works.

**Solution**
```go
import (
    "errors"
    "fmt"
    "io/fs"
)

type FileError struct {
    Path string
    Err  error
}

func (e *FileError) Error() string {
    return fmt.Sprintf("file %q: %v", e.Path, e.Err)
}

func (e *FileError) Unwrap() error { return e.Err }

func OpenFile(path string) error {
    return &FileError{Path: path, Err: fs.ErrNotExist}
}

func main() {
    err := OpenFile("/nope")
    fmt.Println(errors.Is(err, fs.ErrNotExist))  // true
}
```

---

## Task 10 (Hard) — Multi-step pipeline with context propagation

Build `Pipeline(input string) (Output, error)` that runs:
1. `parse(input) (Parsed, error)`
2. `validate(Parsed) error`
3. `transform(Parsed) (Output, error)`

Each error must be wrapped with the step name. Top-level error message must look like:
```
Pipeline: validate: missing field foo
```

**Solution**
```go
type Parsed struct{ /* ... */ }
type Output struct{ /* ... */ }

func Pipeline(input string) (Output, error) {
    p, err := parse(input)
    if err != nil {
        return Output{}, fmt.Errorf("Pipeline: parse: %w", err)
    }
    if err := validate(p); err != nil {
        return Output{}, fmt.Errorf("Pipeline: validate: %w", err)
    }
    out, err := transform(p)
    if err != nil {
        return Output{}, fmt.Errorf("Pipeline: transform: %w", err)
    }
    return out, nil
}
```

---

## Task 11 (Hard) — Concurrent fan-out with errgroup

Given a slice of URLs, fetch all of them in parallel with `golang.org/x/sync/errgroup`. Return a slice of bodies on success, or the first error.

**Solution**
```go
import "golang.org/x/sync/errgroup"

func FetchAll(ctx context.Context, urls []string) ([][]byte, error) {
    bodies := make([][]byte, len(urls))
    g, ctx := errgroup.WithContext(ctx)
    for i, u := range urls {
        i, u := i, u
        g.Go(func() error {
            req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
            if err != nil {
                return fmt.Errorf("build req %d: %w", i, err)
            }
            resp, err := http.DefaultClient.Do(req)
            if err != nil {
                return fmt.Errorf("fetch %s: %w", u, err)
            }
            defer resp.Body.Close()
            b, err := io.ReadAll(resp.Body)
            if err != nil {
                return fmt.Errorf("read %s: %w", u, err)
            }
            bodies[i] = b
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return bodies, nil
}
```

---

## Task 12 (Hard) — Defer-friendly file writer

Write `WriteAll(path string, data []byte) (err error)` that:
- Creates the file.
- Writes all the data.
- Closes the file.
- Returns the *first* error among Create, Write, and Close.

**Solution**
```go
func WriteAll(path string, data []byte) (err error) {
    f, err := os.Create(path)
    if err != nil {
        return fmt.Errorf("create %q: %w", path, err)
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

## Task 13 (Hard) — Custom Is method

Define a typed error `*HTTPError` with `Status int`. Implement an `Is` method so that `errors.Is(err, target)` returns true when `target` is an `*HTTPError` with the same `Status`.

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
    err := &HTTPError{Status: 404, Msg: "not found"}
    target := &HTTPError{Status: 404}
    fmt.Println(errors.Is(err, target))  // true
}
```

---

## Task 14 (Hard) — Test-driven error path

Write a function `LoadConfig(path string) (*Config, error)` and a test suite that covers:
- Success.
- File missing → `errors.Is(err, fs.ErrNotExist)`.
- Invalid JSON → `errors.As(err, &jsonErr)` for `*json.SyntaxError`.

Implement the function with appropriate wrapping.

**Solution**
```go
type Config struct {
    Name string `json:"name"`
}

func LoadConfig(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("read %q: %w", path, err)
    }
    var cfg Config
    if err := json.Unmarshal(data, &cfg); err != nil {
        return nil, fmt.Errorf("parse %q: %w", path, err)
    }
    return &cfg, nil
}

// _test.go
func TestLoadConfig_Missing(t *testing.T) {
    _, err := LoadConfig("/nope.json")
    if !errors.Is(err, fs.ErrNotExist) {
        t.Fatalf("got %v, want fs.ErrNotExist", err)
    }
}
```

---

## Task 15 (Boss-level) — Build an `errors.E` constructor

Modeled after Upspin's design: `E(args ...any) error` accepts any combination of:
- A `string` (treated as the operation),
- A custom `Kind`,
- An `error` (treated as cause),
- A `Path` value,
- etc.

…and returns a `*Error` carrying all of them. Implement it.

**Solution sketch**
```go
type Kind int
const (
    KindOther Kind = iota
    KindNotFound
    KindInvalid
)

type Op string
type Path string

type Error struct {
    Op    Op
    Kind  Kind
    Path  Path
    Err   error
}

func (e *Error) Error() string { /* compose */ }
func (e *Error) Unwrap() error { return e.Err }

func E(args ...any) error {
    e := &Error{}
    for _, a := range args {
        switch v := a.(type) {
        case Op:
            e.Op = v
        case Kind:
            e.Kind = v
        case Path:
            e.Path = v
        case error:
            e.Err = v
        case string:
            e.Op = Op(v)
        }
    }
    return e
}
```

(See [Upspin's errors design](https://commandcenter.blogspot.com/2017/12/error-handling-in-upspin.html) for the full pattern.)
