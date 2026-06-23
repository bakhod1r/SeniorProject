# Custom Error Types — Tasks

A graded sequence of exercises. Each task lists what to build, success criteria, and a hint or two. Do them in order; later tasks build on the data structures of earlier ones.

## Table of Contents
1. [Easy (1–6)](#easy-16)
2. [Medium (7–14)](#medium-714)
3. [Hard (15–20)](#hard-1520)
4. [Bonus (21–25)](#bonus-2125)

---

## Easy (1–6)

### Task 1 — Smallest custom error
Define a type `MissingFieldError` with one field `Field string`. Implement `Error() string` so it returns `"missing field: <Field>"`. Write a `main` that creates one and prints it.

**Success:** running the program prints `missing field: name`.
**Hint:** pointer receiver, `fmt.Sprintf`.

### Task 2 — Sentinel detection
Add a sentinel `var ErrMissingField = errors.New("missing field")`. Make `MissingFieldError` implement `Is(target error) bool` so `errors.Is(err, ErrMissingField)` returns true for any `*MissingFieldError`.

**Success:** `errors.Is(&MissingFieldError{Field: "x"}, ErrMissingField)` returns true.

### Task 3 — Constructor
Write `func NewMissingField(field string) error`. Use it everywhere instead of struct literals. Verify with a test that the typed-nil trap does not occur on the success path.

**Success:** all callers go through the constructor; success branches `return nil`.

### Task 4 — Wrap with `Unwrap`
Define `ConfigLoadError` with fields `Path string` and `Err error`. Implement `Error()` and `Unwrap()`. In `main`, simulate a load that fails with `os.ErrNotExist`, wrap it, and verify `errors.Is(err, os.ErrNotExist)` returns true.

**Success:** the wrap is detected via `errors.Is`.
**Hint:** use `os.ErrNotExist` from `package os`.

### Task 5 — `errors.As` extracts fields
Define `ValidationError{Field, Reason string}`. In a function `Register(name, email string) error`, return one for each invalid argument. In `main`, call with bad input, and use `errors.As` to extract `Field` and print it.

**Success:** the program prints "field `name` failed because: empty" or similar.

### Task 6 — Distinguish between sentinel and type
Build a small key-value store with `Get(key string) (string, error)`. On miss return a sentinel `ErrNotFound`. Add a second function `MustGet(key string) (string, error)` that returns `&NotFoundError{Key: key}` on miss. Demonstrate that `errors.Is(err, ErrNotFound)` matches both, but `errors.As(err, &nf)` only succeeds for the second.

**Hint:** add `Is(target error) bool` on `*NotFoundError` returning true for `ErrNotFound`.

---

## Medium (7–14)

### Task 7 — Op label pattern
Define `type Op string` and `type Error struct{ Op Op; Err error }`. Implement `Error()` so messages compose like `outer.Op: inner.Op: leaf`. Build a 3-layer call (HTTP → service → DB) that produces a chain.

**Success:** the printed chain reads `api.GetUser: service.Get: db.Query: connection refused`.

### Task 8 — Kind enum + HTTP mapping
Add `Kind uint8` with values `KindNotExist`, `KindInvalid`, `KindPermission`, `KindInternal`. Write `func httpStatus(err error) int` that uses `errors.As` to get a `*Error` and returns the right status (404/400/403/500). Cover all four with tests.

### Task 9 — Constructor variadic
Implement `func E(args ...any) *Error` accepting `Op`, `Kind`, `string` (path), and `error` in any order. Write two unit tests proving order independence.

### Task 10 — `errors.Is` walks the chain
Take task 7's three-layer setup. At the leaf, return `sql.ErrNoRows`. Verify `errors.Is(err, sql.ErrNoRows)` returns true even though there are two custom-typed wrappers between.

**Hint:** every wrapper must implement `Unwrap`.

### Task 11 — Custom `Format`
Implement `Format(s fmt.State, v rune)` on `*Error`. For `%v`, print one line. For `%+v`, print one line per layer in the chain. Write a test using `fmt.Sprintf("%+v", err)`.

### Task 12 — Stack capture at the leaf
Add fields `pcs [16]uintptr` and `npcs int` to `*Error`. In the constructor at the *leaf* (only when `Err == nil`) call `runtime.Callers(2, e.pcs[:])`. Add a `Stack() string` method using `runtime.CallersFrames`. Wrap layers do *not* capture.

**Success:** printing `%+v` shows exactly one stack, near the leaf.

### Task 13 — JSON marshalling
Implement `MarshalJSON` so the wire shape is `{"code":"...","op":"...","cause":"..."}`. Add a `String` `Code` field. Write a test asserting the JSON shape and that the inner cause is its `Error()` string, not a nested empty object.

### Task 14 — Public DTO
Add `func (e *Error) Public() PublicError` that returns a sanitized copy with no `Op`, no internal cause, and no stack. Use it in an HTTP handler. Use the full `MarshalJSON` for logging.

---

## Hard (15–20)

### Task 15 — Multi-error
Implement `MultiError{Op, Errs}` with `Unwrap() []error`. Use `errors.Join` first to confirm the standard library behavior, then implement your own type that can also marshal to JSON as a list. Add a `Match(predicate func(error) bool) []error` method.

### Task 16 — Behavior interface
Define `interface{ Retryable() bool }`. Make some of your error types implement it. Write `func IsRetryable(err error) bool` using `errors.As` against the interface. Demonstrate that wrapping preserves the property.

### Task 17 — Catalog
Create a `errcat` package with a registry: each `Code` has a `Kind`, HTTP status, gRPC code, and human message. Write a CI test that asserts every code has a non-empty message and a valid HTTP status. Generate a Markdown table from the catalog at build time.

### Task 18 — Migration
Take a small file with 10 `fmt.Errorf` calls scattered across functions. Convert them to typed errors *without* breaking external callers that might be reading messages. Hint: keep messages stable; introduce typed wrappers with `%w`.

### Task 19 — Cross-process roundtrip
Define a wire format `{"code":"USER_NOT_FOUND","detail":"id=42"}`. Implement a server that returns this and a client that parses it back into a `*Error`. Test that `errors.Is(parsed, ErrUserNotFound)` holds in the client.

**Hint:** the client needs an `UnmarshalJSON` and a way to construct sentinels from string codes.

### Task 20 — Generated catalog
Write a small Go program that reads `errors.yaml` and emits Go constants and a `String() string` for each `Code`. Wire it up via `go:generate`. Show that adding a new code is one YAML edit + `go generate`.

---

## Bonus (21–25)

### Task 21 — `Match(template, err) bool`
Implement Upspin-style matching: a "template" `*Error` with some fields set; `Match` returns true if `err` has those same fields (others ignored). Useful in tests.

### Task 22 — Redaction
Add a `Secret` type with `String() string` returning `"<redacted>"`. Use it in an `AuthError{Username, Token Secret}`. Verify that `Error()` and JSON output never contain the token.

### Task 23 — Trace correlation
Add `TraceID string` and `SpanID string` to your error. Write middleware that fills them from the `context.Context`. Write a test that simulates a request with a known trace ID and asserts the error carries it.

### Task 24 — Allocation profile
Use `testing.B` benchmarks to compare:
1. `errors.New("not found")` (sentinel return)
2. `&NotFoundError{ID: id}` (custom struct)
3. `fmt.Errorf("not found: %d", id)` (fmt wrap)

Report ns/op and allocs/op. Identify which is cheapest in a hot validator loop.

### Task 25 — Property-based tests
Use `testing/quick` (or a property test library) to assert invariants on your custom error type:
- For any `*Error e`, `errors.Is(e, e)` is true.
- For any chain built by repeated `E(op, kind, inner)`, `errors.Is(chain, leaf)` is true.
- For any `*Error e`, `e.Error()` does not contain a newline.

---

## Tips for Self-Review

After completing each task, run:

```bash
go vet ./...
go test ./...
```

Use `golangci-lint` if available; many issues with custom error types (mixed receivers, missing `Unwrap`, naked nil-pointer returns) are caught by linters.

For tasks involving `errors.Is`/`errors.As`, write at least *two* tests:
1. Direct: the constructed error matches.
2. Wrapped: the same error inside a `fmt.Errorf("%w", ...)` chain still matches.

For tasks involving JSON, always test the *shape* (key names, types) — not just that marshalling does not error.

For tasks involving stacks, test that `Stack()` is non-empty after construction and that wrapping does not add additional stacks.

---

## Worked Solutions (Selected)

These walk through the more conceptually tricky tasks. Try them yourself first.

### Task 1 — Worked solution

```go
package main

import "fmt"

type MissingFieldError struct {
    Field string
}

func (e *MissingFieldError) Error() string {
    return fmt.Sprintf("missing field: %s", e.Field)
}

func main() {
    var err error = &MissingFieldError{Field: "name"}
    fmt.Println(err) // missing field: name
}
```

Discussion:
- Pointer receiver because the type may grow.
- `var err error = ...` confirms the implementation satisfies `error`.
- A constructor would normally hide the `&`.

### Task 4 — Worked solution

```go
package main

import (
    "errors"
    "fmt"
    "os"
)

type ConfigLoadError struct {
    Path string
    Err  error
}

func (e *ConfigLoadError) Error() string {
    return fmt.Sprintf("config %s: %v", e.Path, e.Err)
}

func (e *ConfigLoadError) Unwrap() error { return e.Err }

func loadConfig(path string) error {
    return &ConfigLoadError{Path: path, Err: os.ErrNotExist}
}

func main() {
    err := loadConfig("/etc/missing.toml")
    fmt.Println(errors.Is(err, os.ErrNotExist)) // true
}
```

Discussion:
- `Unwrap()` is the bridge that lets `errors.Is` see `os.ErrNotExist`.
- Without it, the chain ends at `*ConfigLoadError`.

### Task 9 — Worked solution

```go
package errs

type Op string

type Kind uint8

type Error struct {
    Op   Op
    Kind Kind
    Path string
    Err  error
}

func E(args ...any) *Error {
    e := &Error{}
    for _, a := range args {
        switch v := a.(type) {
        case Op:
            e.Op = v
        case Kind:
            e.Kind = v
        case string:
            e.Path = v
        case *Error:
            cp := *v
            e.Err = &cp
        case error:
            e.Err = v
        }
    }
    return e
}
```

Order independence test:

```go
func TestOrderIndependent(t *testing.T) {
    a := E(Op("get"), KindNotExist, "a.txt", io.EOF)
    b := E(io.EOF, "a.txt", KindNotExist, Op("get"))
    if a.Op != b.Op || a.Kind != b.Kind || a.Path != b.Path { t.Fatal("differ") }
}
```

Discussion:
- The `*Error` case copies the pointed-to value so callers cannot mutate the inner.
- The `error` case is *after* `*Error` in the switch order — this matters because `*Error` would also match `error`. Swap, and the `*Error` arm becomes dead code.

### Task 12 — Worked solution

```go
package errs

import (
    "fmt"
    "runtime"
    "strings"
)

type Error struct {
    Op   string
    Err  error
    pcs  [16]uintptr
    npcs int
}

func New(op string, err error) *Error {
    e := &Error{Op: op, Err: err}
    if err == nil {
        // leaf: capture
        e.npcs = runtime.Callers(2, e.pcs[:])
    }
    return e
}

func (e *Error) Stack() string {
    if e.npcs == 0 { return "" }
    var b strings.Builder
    fr := runtime.CallersFrames(e.pcs[:e.npcs])
    for {
        f, more := fr.Next()
        fmt.Fprintf(&b, "%s\n  %s:%d\n", f.Function, f.File, f.Line)
        if !more { break }
    }
    return b.String()
}
```

Discussion:
- Only the leaf has a stack. Wraps reuse.
- The PC array is on-struct, no extra allocation.

### Task 16 — Worked solution

```go
package retry

import "errors"

type Retryable struct {
    error
}

func (Retryable) Retryable() bool { return true }

func Wrap(err error) error {
    return &Retryable{error: err}
}

type retryable interface {
    Retryable() bool
}

func IsRetryable(err error) bool {
    var r retryable
    return errors.As(err, &r) && r.Retryable()
}
```

Discussion:
- The behavior interface (`retryable`) is the contract; the struct is one possible carrier.
- Any other type that implements `Retryable() bool` participates automatically.
- `errors.As` discovers the interface anywhere in the chain.

### Task 25 — Worked solution

```go
package errs

import (
    "errors"
    "strings"
    "testing"
    "testing/quick"
)

func TestErrorIsItself(t *testing.T) {
    f := func(op string) bool {
        e := &Error{Op: Op(op)}
        return errors.Is(e, e)
    }
    if err := quick.Check(f, nil); err != nil { t.Fatal(err) }
}

func TestErrorNoNewlines(t *testing.T) {
    f := func(op string) bool {
        e := &Error{Op: Op(op)}
        return !strings.ContainsRune(e.Error(), '\n')
    }
    if err := quick.Check(f, nil); err != nil { t.Fatal(err) }
}
```

Discussion:
- Property tests catch invariants you might not even think to assert in example tests.
- "Error message is one line" is a useful invariant for log pipelines.

---

## Stretch Goals

If you finish all 25 tasks, here are open-ended directions to push further:

- **Build a CLI that emits a Markdown table from your error catalog** so docs cannot drift from code.
- **Implement an "error envelope" similar to `google.rpc.Status`** with code, message, and details encoded as `Any`-style protobuf.
- **Write a static analyzer** that flags mixed receivers on error types and missing `Unwrap` on types with an `Err error` field.
- **Build a benchmark suite** comparing `errors.New`, `fmt.Errorf`, custom struct, and enum at the same call site.
- **Design a structured logger** that takes any error, walks the chain with `errors.As`, and emits one JSON record per layer.
- **Wire your error type into OpenTelemetry** so each error becomes a span event with attributes.

Each of these is a small but realistic project. Pick whichever scratches an itch in your day job.

---

## Self-Check Rubric

Before declaring "done", every task should pass:

- [ ] `go vet ./...` clean.
- [ ] `go test ./...` green.
- [ ] No typed-nil pointer returns on success branches.
- [ ] All custom types have a constructor.
- [ ] All custom types have `Unwrap()` if they carry an inner error.
- [ ] All custom types are tested with both `errors.Is` and `errors.As` against a wrapped chain.
- [ ] All exported error types have at least one godoc example.
- [ ] No newlines in `Error()` output.
- [ ] No `debug.Stack()` calls in hot paths.
- [ ] No public-facing `json.Marshal` of an internal error type.

If a task fails any of these, fix it before moving to the next. Building this discipline on small tasks pays off when you write production code under time pressure.
