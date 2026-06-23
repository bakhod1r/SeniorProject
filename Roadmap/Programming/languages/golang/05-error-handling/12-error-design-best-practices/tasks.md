# Error Design — Best Practices — Tasks

> Hands-on exercises. Each comes with a problem statement, hints, and a reference solution. Difficulty: easy → hard.

---

## Task 1 (Easy) — Fix the message style

Take the following errors and rewrite them in idiomatic Go style.

```go
return errors.New("Error: Could not open file!")
return errors.New("FAILED to read user.")
return fmt.Errorf("Error parsing config: %v", err)
```

**Hints**
- Lowercase first letter.
- No trailing punctuation.
- No "error:" prefix.
- Verb-noun ordering.

**Solution**
```go
return fmt.Errorf("open %s: %w", path, err)
return fmt.Errorf("read user %d: %w", id, err)
return fmt.Errorf("parse config: %w", err)
```

The third change also switches `%v` to `%w` so the chain is preserved.

---

## Task 2 (Easy) — Sentinel + wrapped context

Define `ErrUserNotFound`. Write `GetUser(id int)` that returns `ErrUserNotFound` wrapped with the user ID. Write a caller that checks for the sentinel.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

var ErrUserNotFound = errors.New("user not found")

func GetUser(id int) (string, error) {
    if id != 42 {
        return "", fmt.Errorf("get user %d: %w", id, ErrUserNotFound)
    }
    return "Bakhodir", nil
}

func main() {
    _, err := GetUser(7)
    if errors.Is(err, ErrUserNotFound) {
        fmt.Println("not found")
    }
}
```

---

## Task 3 (Easy) — Distinguish programmer error and operational error

Write two functions: one that panics on a contract violation (nil map), one that returns an error on a failed operation (wrong key).

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

func Set(m map[string]int, k string, v int) {
    if m == nil {
        panic("Set: nil map")
    }
    m[k] = v
}

var ErrKeyMissing = errors.New("key missing")

func Get(m map[string]int, k string) (int, error) {
    if v, ok := m[k]; ok {
        return v, nil
    }
    return 0, fmt.Errorf("get %q: %w", k, ErrKeyMissing)
}

func main() {
    m := map[string]int{"a": 1}
    Set(m, "b", 2)
    _, err := Get(m, "c")
    fmt.Println(err)
}
```

---

## Task 4 (Easy) — Avoid the typed-nil pitfall

The following function sometimes returns a non-nil error from a nil pointer. Find and fix the bug.

```go
type MyErr struct{ Field string }

func (e *MyErr) Error() string { return e.Field + ": bad" }

func validate(s string) error {
    var e *MyErr
    if s == "" {
        e = &MyErr{Field: "name"}
    }
    return e  // bug: returns non-nil interface even if e is nil
}
```

**Solution**
```go
func validate(s string) error {
    if s == "" {
        return &MyErr{Field: "name"}
    }
    return nil  // literal nil, not a typed nil pointer
}
```

---

## Task 5 (Easy) — Use `errors.Is` instead of string match

Rewrite this brittle test:
```go
if !strings.Contains(err.Error(), "not found") {
    t.Fatal(...)
}
```

**Solution**
```go
if !errors.Is(err, ErrNotFound) {
    t.Fatalf("want ErrNotFound, got %v", err)
}
```

The test is now message-independent. Any improvement to wording leaves it green.

---

## Task 6 (Medium) — Typed validation error with field access

Build a `ValidationError` with `Field`, `Reason` fields. Write `parseUser(in)` that returns specific validation errors. The caller uses `errors.As` to access fields.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

type ValidationError struct {
    Field  string
    Reason string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("%s: %s", e.Field, e.Reason)
}

func parseUser(in map[string]string) error {
    if in["name"] == "" {
        return &ValidationError{Field: "name", Reason: "required"}
    }
    if in["age"] == "" {
        return &ValidationError{Field: "age", Reason: "required"}
    }
    return nil
}

func main() {
    err := parseUser(map[string]string{"name": "x"})
    var ve *ValidationError
    if errors.As(err, &ve) {
        fmt.Printf("field=%q reason=%q\n", ve.Field, ve.Reason)
    }
}
```

---

## Task 7 (Medium) — Family sentinel + typed error

Create `*NotFoundError` that carries `Resource` and `Key` fields, and a sentinel `ErrNotFound`. Implement `Is` so `errors.Is(err, ErrNotFound)` matches any `*NotFoundError`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

var ErrNotFound = errors.New("not found")

type NotFoundError struct {
    Resource string
    Key      string
}

func (e *NotFoundError) Error() string {
    return fmt.Sprintf("%s %q not found", e.Resource, e.Key)
}

func (e *NotFoundError) Is(target error) bool {
    return target == ErrNotFound
}

func GetUser(id string) error {
    return &NotFoundError{Resource: "user", Key: id}
}

func main() {
    err := GetUser("42")
    if errors.Is(err, ErrNotFound) {
        fmt.Println("matches family sentinel")
    }
    var nf *NotFoundError
    if errors.As(err, &nf) {
        fmt.Printf("resource=%s key=%s\n", nf.Resource, nf.Key)
    }
}
```

---

## Task 8 (Medium) — Boundary translation

Write a `handler` that calls a `service`, which calls a `repo`. The `repo` returns `sql.ErrNoRows`. Translate it through the layers so `repo` produces `ErrNotFound`, `service` wraps with `get user: %w`, and `handler` returns HTTP 404.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "log"
    "net/http"
    "database/sql"
)

var ErrNotFound = errors.New("not found")

type Repo struct{}

func (r *Repo) Get(id int) (string, error) {
    return "", sql.ErrNoRows
}

func repoGet(id int) (string, error) {
    var r Repo
    s, err := r.Get(id)
    if errors.Is(err, sql.ErrNoRows) {
        return "", fmt.Errorf("user %d: %w", id, ErrNotFound)
    }
    if err != nil {
        return "", fmt.Errorf("query: %w", err)
    }
    return s, nil
}

func service(id int) (string, error) {
    s, err := repoGet(id)
    if err != nil {
        return "", fmt.Errorf("get user: %w", err)
    }
    return s, nil
}

func handler(w http.ResponseWriter, r *http.Request) {
    _, err := service(7)
    switch {
    case errors.Is(err, ErrNotFound):
        http.Error(w, "not found", 404)
    case err != nil:
        log.Println(err)
        http.Error(w, "internal", 500)
    default:
        w.WriteHeader(200)
    }
}

func main() {
    http.HandleFunc("/", handler)
    log.Println("listening on :8080")
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

---

## Task 9 (Medium) — Structured error with `Op`/`Kind`/`Path`

Build the Upspin-style structured error with these fields. The `Error()` method composes them. Write a constructor `E(args ...any)` that accepts any combination of `Op`, `Kind`, `Path`, or wrapped error.

**Solution**
```go
package main

import (
    "fmt"
    "strings"
)

type Op string
type Kind int

const (
    KindUnknown Kind = iota
    KindNotFound
    KindInvalid
)

func (k Kind) String() string {
    return [...]string{"unknown", "not found", "invalid"}[k]
}

type Error struct {
    Op   Op
    Kind Kind
    Path string
    Err  error
}

func (e *Error) Error() string {
    var b strings.Builder
    if e.Op != "" {
        b.WriteString(string(e.Op))
        b.WriteString(": ")
    }
    if e.Path != "" {
        b.WriteString(e.Path)
        b.WriteString(": ")
    }
    if e.Kind != KindUnknown {
        b.WriteString(e.Kind.String())
        b.WriteString(": ")
    }
    if e.Err != nil {
        b.WriteString(e.Err.Error())
    }
    return strings.TrimSuffix(b.String(), ": ")
}

func (e *Error) Unwrap() error { return e.Err }

func E(args ...any) error {
    e := &Error{}
    for _, a := range args {
        switch v := a.(type) {
        case Op:    e.Op = v
        case Kind:  e.Kind = v
        case string: e.Path = v
        case error: e.Err = v
        }
    }
    return e
}

func main() {
    err := E(Op("user.Get"), KindNotFound, "42")
    fmt.Println(err)
}
```

---

## Task 10 (Medium) — `errors.Join` for batch validation

Write `validateAll(inputs []Input)` that returns one error containing all validation failures, joined.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

type Input struct{ Name string; Age int }

func validate(in Input) error {
    if in.Name == "" {
        return errors.New("name required")
    }
    if in.Age < 0 {
        return errors.New("age must be non-negative")
    }
    return nil
}

func validateAll(items []Input) error {
    var errs []error
    for i, in := range items {
        if err := validate(in); err != nil {
            errs = append(errs, fmt.Errorf("item %d: %w", i, err))
        }
    }
    return errors.Join(errs...)
}

func main() {
    err := validateAll([]Input{
        {Name: "", Age: 1},
        {Name: "ok", Age: -5},
    })
    fmt.Println(err)
}
```

---

## Task 11 (Medium) — errgroup for concurrent fan-out

Use `errgroup` to fetch 5 URLs concurrently. Cancel all if any fails.

**Solution**
```go
package main

import (
    "context"
    "fmt"
    "io"
    "net/http"
    "golang.org/x/sync/errgroup"
)

func fetch(ctx context.Context, url string) error {
    req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return fmt.Errorf("get %s: %w", url, err)
    }
    defer resp.Body.Close()
    _, _ = io.Copy(io.Discard, resp.Body)
    return nil
}

func main() {
    urls := []string{
        "https://example.com",
        "https://golang.org",
        "https://invalid-host.example",
    }
    g, ctx := errgroup.WithContext(context.Background())
    for _, u := range urls {
        u := u
        g.Go(func() error { return fetch(ctx, u) })
    }
    if err := g.Wait(); err != nil {
        fmt.Println("at least one failed:", err)
    }
}
```

---

## Task 12 (Medium) — Don't double-log

Take this code:
```go
func a() error {
    if err := b(); err != nil {
        log.Println("a failed:", err)
        return err
    }
    return nil
}

func b() error {
    if err := c(); err != nil {
        log.Println("b failed:", err)
        return err
    }
    return nil
}

func c() error {
    return errors.New("disk full")
}
```

Refactor so logging happens only at the boundary.

**Solution**
```go
func a() error {
    if err := b(); err != nil {
        return fmt.Errorf("a: %w", err)
    }
    return nil
}

func b() error {
    if err := c(); err != nil {
        return fmt.Errorf("b: %w", err)
    }
    return nil
}

func c() error {
    return errors.New("disk full")
}

func main() {
    if err := a(); err != nil {
        log.Println("top:", err)  // single log line: "top: a: b: disk full"
    }
}
```

---

## Task 13 (Hard) — Retryable kind helper

Build `Retryable(err error) bool` that walks the chain looking for `*errs.Error` and asks `kind.Retryable()`. Test it across several wrap depths.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

type Kind int

const (
    KindUnknown Kind = iota
    KindNotFound
    KindTransient
)

func (k Kind) Retryable() bool {
    return k == KindTransient
}

type Error struct {
    Kind Kind
    Err  error
}

func (e *Error) Error() string {
    if e.Err != nil {
        return fmt.Sprintf("%v: %v", e.Kind, e.Err)
    }
    return fmt.Sprintf("%v", e.Kind)
}

func (e *Error) Unwrap() error { return e.Err }

func Retryable(err error) bool {
    var e *Error
    if errors.As(err, &e) {
        return e.Kind.Retryable()
    }
    return false
}

func main() {
    e1 := &Error{Kind: KindTransient}
    e2 := fmt.Errorf("middle: %w", e1)
    e3 := fmt.Errorf("top: %w", e2)
    fmt.Println(Retryable(e3))  // true
}
```

---

## Task 14 (Hard) — Stable API error codes

Build an HTTP handler that returns errors in a stable JSON shape: `{ "code": "...", "message": "...", "request_id": "..." }`. Map internal kinds to public codes.

**Solution**
```go
package main

import (
    "context"
    "encoding/json"
    "errors"
    "log"
    "net/http"
)

var (
    ErrNotFound     = errors.New("not found")
    ErrUnauthorized = errors.New("unauthorized")
)

type APIError struct {
    Code      string `json:"code"`
    Message   string `json:"message"`
    RequestID string `json:"request_id,omitempty"`
}

type ctxKey string

const requestIDKey ctxKey = "rid"

func toAPIError(ctx context.Context, err error) (int, APIError) {
    rid, _ := ctx.Value(requestIDKey).(string)
    switch {
    case errors.Is(err, ErrNotFound):
        return 404, APIError{Code: "user.not_found", Message: "User not found", RequestID: rid}
    case errors.Is(err, ErrUnauthorized):
        return 401, APIError{Code: "auth.unauthorized", Message: "Authentication required", RequestID: rid}
    default:
        return 500, APIError{Code: "internal", Message: "Internal server error", RequestID: rid}
    }
}

func handler(w http.ResponseWriter, r *http.Request) {
    ctx := context.WithValue(r.Context(), requestIDKey, "req-1234")
    err := ErrNotFound
    if err != nil {
        status, body := toAPIError(ctx, err)
        w.Header().Set("Content-Type", "application/json")
        w.WriteHeader(status)
        json.NewEncoder(w).Encode(body)
        return
    }
}

func main() {
    http.HandleFunc("/", handler)
    log.Println("listening on :8080")
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

---

## Task 15 (Hard) — Recover middleware that logs but does not leak

Write an HTTP middleware that recovers from panics, logs the panic + stack, and responds 500 with a sanitized message — without leaking internals to the client.

**Solution**
```go
package main

import (
    "log"
    "net/http"
    "runtime/debug"
)

func recoverMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                log.Printf("panic %s %s: %v\n%s", r.Method, r.URL.Path, rec, debug.Stack())
                http.Error(w, "internal server error", http.StatusInternalServerError)
            }
        }()
        next.ServeHTTP(w, r)
    })
}

func bad(w http.ResponseWriter, r *http.Request) {
    panic("kaboom")
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/", bad)
    log.Fatal(http.ListenAndServe(":8080", recoverMiddleware(mux)))
}
```

The internal log gets the full stack; the user sees only `internal server error`.

---

## Task 16 (Hard) — Migrate pre-1.13 code

Take this old-style code and modernize it.

```go
import "github.com/pkg/errors"

func step() error {
    return errors.Wrap(io.EOF, "step failed")
}

func handle(err error) {
    cause := errors.Cause(err)
    if cause == io.EOF {
        log.Println("clean shutdown")
    }
}
```

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "io"
    "log"
)

func step() error {
    return fmt.Errorf("step: %w", io.EOF)
}

func handle(err error) {
    if errors.Is(err, io.EOF) {
        log.Println("clean shutdown")
    }
}

func main() {
    err := step()
    handle(err)
}
```

`fmt.Errorf("...: %w", err)` replaces `errors.Wrap`; `errors.Is` replaces `errors.Cause`.

---

## Task 17 (Hard) — Test errors with table-driven assertions

Write a table-driven test for `parseAge(s string) (int, error)` that checks identity (`errors.Is`) and structured fields (`errors.As`) for each case.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "strconv"
    "testing"
)

var ErrEmpty = errors.New("empty")

type RangeError struct {
    Min, Max int
    Got      int
}

func (e *RangeError) Error() string {
    return fmt.Sprintf("got %d, want [%d,%d]", e.Got, e.Min, e.Max)
}

func parseAge(s string) (int, error) {
    if s == "" {
        return 0, ErrEmpty
    }
    n, err := strconv.Atoi(s)
    if err != nil {
        return 0, fmt.Errorf("parse %q: %w", s, err)
    }
    if n < 0 || n > 150 {
        return 0, &RangeError{Min: 0, Max: 150, Got: n}
    }
    return n, nil
}

func TestParseAge(t *testing.T) {
    tests := []struct {
        name    string
        in      string
        wantIs  error
        wantAs  any
        wantErr bool
    }{
        {name: "valid", in: "25", wantErr: false},
        {name: "empty", in: "", wantIs: ErrEmpty, wantErr: true},
        {name: "bad number", in: "x", wantIs: strconv.ErrSyntax, wantErr: true},
        {name: "out of range", in: "200", wantAs: &RangeError{}, wantErr: true},
    }
    for _, tc := range tests {
        t.Run(tc.name, func(t *testing.T) {
            _, err := parseAge(tc.in)
            if tc.wantErr && err == nil {
                t.Fatalf("want error, got nil")
            }
            if !tc.wantErr && err != nil {
                t.Fatalf("unexpected: %v", err)
            }
            if tc.wantIs != nil && !errors.Is(err, tc.wantIs) {
                t.Errorf("want Is %v, got %v", tc.wantIs, err)
            }
            if tc.wantAs != nil {
                target := tc.wantAs
                if !errors.As(err, &target) {
                    t.Errorf("want As %T, got %v", tc.wantAs, err)
                }
            }
        })
    }
}

func main() {}
```

---

## Task 18 (Hard) — gRPC error translation

Write a function `toGRPCStatus(err error) error` that maps your internal error kinds to gRPC status codes.

**Solution**
```go
package main

import (
    "errors"
    "fmt"

    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/status"
)

var (
    ErrNotFound     = errors.New("not found")
    ErrInvalid      = errors.New("invalid")
    ErrUnauthorized = errors.New("unauthorized")
    ErrTransient    = errors.New("transient")
)

func toGRPCStatus(err error) error {
    switch {
    case err == nil:
        return nil
    case errors.Is(err, ErrNotFound):
        return status.Error(codes.NotFound, err.Error())
    case errors.Is(err, ErrInvalid):
        return status.Error(codes.InvalidArgument, err.Error())
    case errors.Is(err, ErrUnauthorized):
        return status.Error(codes.Unauthenticated, err.Error())
    case errors.Is(err, ErrTransient):
        return status.Error(codes.Unavailable, err.Error())
    default:
        return status.Error(codes.Internal, "internal error")  // sanitize
    }
}

func main() {
    err := fmt.Errorf("user %d: %w", 42, ErrNotFound)
    fmt.Println(toGRPCStatus(err))
}
```

The default branch deliberately *does not* expose the internal error string.

---

## Task 19 (Hard) — Detect over-wrapping

Write a tool that, given an error, walks the chain and reports if any layer is a "useless wrap" — i.e., a wrap whose message is just `error: %w` or similar.

**Hints**
- Walk `errors.Unwrap` repeatedly.
- For each layer, compare the wrap message to the inner message; flag if the wrap added no new tokens.

**Solution sketch**
```go
package main

import (
    "errors"
    "fmt"
    "strings"
)

func detectUselessWraps(err error) []string {
    var bad []string
    cur := err
    for cur != nil {
        inner := errors.Unwrap(cur)
        if inner == nil { break }
        outer := cur.Error()
        innerStr := inner.Error()
        prefix := strings.TrimSuffix(outer, ": " + innerStr)
        prefix = strings.TrimSpace(prefix)
        if prefix == "" || strings.EqualFold(prefix, "error") {
            bad = append(bad, outer)
        }
        cur = inner
    }
    return bad
}

func main() {
    inner := errors.New("connection refused")
    err := fmt.Errorf("error: %w", inner)
    err = fmt.Errorf("connect: %w", err)
    for _, b := range detectUselessWraps(err) {
        fmt.Println("useless wrap:", b)
    }
}
```

Output: `useless wrap: error: connection refused`. The "connect:" wrap is fine.

---

## Task 20 (Boss-level) — Build a small `errs` package

Build a reusable `errs` package providing:
- `Kind` enum.
- `Error` struct with `Op`, `Kind`, `Path`, `Err`.
- `New(kind, msg)`, `Wrap(err, op)`, `Wrapf(err, format, args...)` constructors.
- `Kind` extractor: `errs.KindOf(err) Kind`.
- HTTP status mapping: `errs.HTTPStatus(err) int`.
- `Is`/`As` integration.

**Solution sketch**
```go
package errs

import (
    "errors"
    "fmt"
    "net/http"
    "strings"
)

type Kind int

const (
    KindUnknown Kind = iota
    KindNotFound
    KindInvalid
    KindUnauthorized
    KindForbidden
    KindConflict
    KindTransient
    KindInternal
)

func (k Kind) String() string {
    switch k {
    case KindNotFound:     return "not found"
    case KindInvalid:      return "invalid"
    case KindUnauthorized: return "unauthorized"
    case KindForbidden:    return "forbidden"
    case KindConflict:     return "conflict"
    case KindTransient:    return "transient"
    case KindInternal:     return "internal"
    }
    return "unknown"
}

type Error struct {
    Op   string
    Kind Kind
    Path string
    Err  error
}

func (e *Error) Error() string {
    var b strings.Builder
    if e.Op != "" { b.WriteString(e.Op + ": ") }
    if e.Path != "" { b.WriteString(e.Path + ": ") }
    if e.Kind != KindUnknown { b.WriteString(e.Kind.String() + ": ") }
    if e.Err != nil { b.WriteString(e.Err.Error()) }
    return strings.TrimSuffix(b.String(), ": ")
}

func (e *Error) Unwrap() error { return e.Err }

func New(kind Kind, msg string) error {
    return &Error{Kind: kind, Err: errors.New(msg)}
}

func Wrap(err error, op string) error {
    if err == nil { return nil }
    return &Error{Op: op, Err: err}
}

func Wrapf(err error, format string, args ...any) error {
    if err == nil { return nil }
    return &Error{Op: fmt.Sprintf(format, args...), Err: err}
}

func KindOf(err error) Kind {
    var e *Error
    for err != nil {
        if errors.As(err, &e) && e.Kind != KindUnknown {
            return e.Kind
        }
        err = errors.Unwrap(err)
    }
    return KindUnknown
}

func HTTPStatus(err error) int {
    switch KindOf(err) {
    case KindNotFound:     return http.StatusNotFound
    case KindInvalid:      return http.StatusBadRequest
    case KindUnauthorized: return http.StatusUnauthorized
    case KindForbidden:    return http.StatusForbidden
    case KindConflict:     return http.StatusConflict
    case KindTransient:    return http.StatusServiceUnavailable
    default:               return http.StatusInternalServerError
    }
}
```

Usage:
```go
return errs.Wrap(errs.New(errs.KindNotFound, "user 42"), "users.Get")
// "users.Get: not found: user 42"

errs.HTTPStatus(err) // 404
```

This is a real-world starter that scales to a 30-service architecture. Add unit tests covering each kind and the chain-walking behavior of `KindOf`.
