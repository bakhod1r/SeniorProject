# Custom Error Types — Optimize

Optimisation exercises and concrete techniques for making custom errors *cheap* enough to use freely. Every example includes a baseline, a target, and a verification recipe (benchmark or `-gcflags=-m`).

## Table of Contents
1. [Approach: measure, then change](#approach-measure-then-change)
2. [Optimisation 1 — Avoid `fmt.Sprintf` in `Error()`](#optimisation-1--avoid-fmtsprintf-in-error)
3. [Optimisation 2 — Use enum codes for hot leaf errors](#optimisation-2--use-enum-codes-for-hot-leaf-errors)
4. [Optimisation 3 — Pre-allocate sentinel errors](#optimisation-3--pre-allocate-sentinel-errors)
5. [Optimisation 4 — Lazy stack capture](#optimisation-4--lazy-stack-capture)
6. [Optimisation 5 — Cache the formatted message](#optimisation-5--cache-the-formatted-message)
7. [Optimisation 6 — Replace `errors.As` in hot paths](#optimisation-6--replace-errorsas-in-hot-paths)
8. [Optimisation 7 — Eliminate intermediate wraps](#optimisation-7--eliminate-intermediate-wraps)
9. [Optimisation 8 — Use stack-based PCs](#optimisation-8--use-stack-based-pcs)
10. [Optimisation 9 — Avoid `MarshalJSON` recursion](#optimisation-9--avoid-marshaljson-recursion)
11. [Optimisation 10 — Codegen the error catalog](#optimisation-10--codegen-the-error-catalog)
12. [Wrap-up](#wrap-up)

---

## Approach: measure, then change

Before optimising:

1. Write a benchmark for the *exact* path you suspect.
2. Run with `-benchmem` so you see allocations.
3. Capture a CPU profile if the cost is more than allocations.
4. Apply *one* change. Re-run. Compare.

```bash
go test -bench=. -benchmem -count=10 -run=- ./...
```

```bash
go test -bench=BenchmarkErr -cpuprofile cpu.prof
go tool pprof -http=: cpu.prof
```

Optimisation without measurement is just hopeful editing.

---

## Optimisation 1 — Avoid `fmt.Sprintf` in `Error()`

### Baseline

```go
type E struct {
    Op  string
    Err error
}

func (e *E) Error() string {
    return fmt.Sprintf("%s: %s", e.Op, e.Err.Error())
}
```

`fmt.Sprintf` parses the format string and allocates an intermediate buffer. For a struct that prints 100 000+ times per second, this matters.

### Optimised

```go
func (e *E) Error() string {
    return e.Op + ": " + e.Err.Error()
}
```

String concatenation is faster and (often) inlinable. For a three-field error, prefer `strings.Builder`:

```go
func (e *E) Error() string {
    var b strings.Builder
    b.Grow(len(e.Op) + len(e.Err.Error()) + 2)
    b.WriteString(e.Op)
    b.WriteString(": ")
    b.WriteString(e.Err.Error())
    return b.String()
}
```

### Verify

```go
func BenchmarkErrorSprintf(b *testing.B) {
    e := &E{Op: "Get", Err: errors.New("boom")}
    for i := 0; i < b.N; i++ {
        _ = e.Error()
    }
}
```

You should see allocations drop from 2 to 1 and ns/op fall by half.

---

## Optimisation 2 — Use enum codes for hot leaf errors

### Baseline

A validator that returns an `*ValidationError` per failed field:

```go
type ValidationError struct{ Field, Reason string }
func (e *ValidationError) Error() string { return e.Field + ": " + e.Reason }
```

At 1000 fields/request × 1000 RPS = 1M allocs/sec.

### Optimised

```go
type ValCode uint8

const (
    ValOK ValCode = iota
    ValRequired
    ValTooShort
    ValTooLong
    ValBadEmail
)

var valNames = [...]string{"ok", "required", "too short", "too long", "bad email"}

func (c ValCode) Error() string { return valNames[c] }

func validate(s string) ValCode {
    switch {
    case s == "":   return ValRequired
    case len(s)<3:  return ValTooShort
    }
    return ValOK
}
```

Zero allocations. Caller pattern:

```go
if c := validate(s); c != ValOK {
    return 0, c
}
```

At the *top* of the request, *one* allocation translates the codes into a structured aggregate error that goes back to the user.

### Verify

```go
func BenchmarkValidate(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = validate("ab")
    }
}
```

Allocs/op should be 0.

---

## Optimisation 3 — Pre-allocate sentinel errors

### Baseline

```go
func GetUser(id int) (*User, error) {
    if !exists(id) {
        return nil, fmt.Errorf("user %d not found", id) // allocates every call
    }
    ...
}
```

### Optimised — sentinel + lazy detail

```go
var ErrUserNotFound = errors.New("user not found")

func GetUser(id int) (*User, error) {
    if !exists(id) {
        return nil, ErrUserNotFound
    }
    ...
}
```

Detail (the ID) is added at the layer that *prints* the error, not at the leaf:

```go
err := svc.GetUser(id)
if errors.Is(err, ErrUserNotFound) {
    log.Printf("user %d not found", id)
}
```

If you *must* carry the ID structurally, allocate a struct — but one allocation, not formatted-string allocations:

```go
type UserNotFound struct{ ID int }
func (e *UserNotFound) Error() string { return "user not found: " + strconv.Itoa(e.ID) }
func (e *UserNotFound) Is(t error) bool { return t == ErrUserNotFound }
```

### Verify

```go
func BenchmarkSentinelReturn(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = GetUser(42)
    }
}
```

With the sentinel, allocs/op should be 0 on the failure path.

---

## Optimisation 4 — Lazy stack capture

### Baseline

```go
func New(op Op, err error) *Error {
    e := &Error{Op: op, Err: err}
    e.stack = string(debug.Stack()) // ~50 µs, many allocations
    return e
}
```

### Optimised

```go
func New(op Op, err error) *Error {
    e := &Error{Op: op, Err: err}
    e.npcs = runtime.Callers(2, e.pcs[:]) // ~200 ns, no alloc
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

Capture is cheap. Symbolisation happens only when `%+v` or a logger asks for the stack.

### Verify

```go
func BenchmarkNewError(b *testing.B) {
    inner := errors.New("x")
    for i := 0; i < b.N; i++ {
        _ = New("op", inner)
    }
}
```

The lazy version is ~100× faster than `debug.Stack()`. The cost is paid only when humans read.

---

## Optimisation 5 — Cache the formatted message

For an error that may be formatted *many* times in different log sinks:

```go
type E struct {
    Op   string
    Err  error
    once sync.Once
    msg  string
}

func (e *E) Error() string {
    e.once.Do(func() {
        e.msg = e.Op + ": " + e.Err.Error()
    })
    return e.msg
}
```

Caveat: the `sync.Once` itself is 4 words; the cache only pays off if the error is printed twice or more on average. For one-shot errors, the cache is overhead. Profile first.

A simpler approach: build the message in the constructor:

```go
func New(op string, err error) *E {
    return &E{
        Op:  op,
        Err: err,
        msg: op + ": " + err.Error(),
    }
}
```

But beware: this evaluates the inner `Error()` *eagerly*, which loses the lazy semantics of `Unwrap()`-based chains. Use only if the inner error is a leaf.

---

## Optimisation 6 — Replace `errors.As` in hot paths

`errors.As` uses reflection: ~hundreds of ns per call. Acceptable everywhere except very hot paths.

### Baseline

```go
for _, err := range errs {
    var ne *NotFound
    if errors.As(err, &ne) { /* ... */ }
}
```

### Optimised — manual chain walk

```go
for _, err := range errs {
    for cur := err; cur != nil; cur = errors.Unwrap(cur) {
        if ne, ok := cur.(*NotFound); ok {
            /* ... */
            break
        }
    }
}
```

This is 3–10× faster because it avoids reflection. Use only where profiling justifies it; the standard `errors.As` is preferred for clarity.

### Verify

Benchmark both with `-benchmem`. Expect ns/op to drop and allocs/op to be the same.

---

## Optimisation 7 — Eliminate intermediate wraps

A 5-deep wrap chain costs 5 allocations and 5 layers for `errors.Is` to walk. Many of those layers add nothing.

### Baseline

```go
func a() error { return fmt.Errorf("a: %w", b()) }
func b() error { return fmt.Errorf("b: %w", c()) }
func c() error { return fmt.Errorf("c: %w", d()) }
func d() error { return fmt.Errorf("d: %w", io.EOF) }
```

### Optimised — wrap once at the boundary

```go
func a() error {
    if err := process(); err != nil {
        return fmt.Errorf("a: %w", err)
    }
    return nil
}

func process() error { return io.EOF }
```

If a layer adds nothing — no Op, no Kind, no field — return the inner error unchanged. Every wrap should *carry information*.

### Verify

Walk the chain once, count layers (`for ;; cur = errors.Unwrap(cur)`). A clean codebase has chains of depth 1–3, not 5–10.

---

## Optimisation 8 — Use stack-based PCs

If your error struct has a *fixed-size array* `pcs [16]uintptr` rather than a *slice* `pcs []uintptr`, the call to `runtime.Callers(skip, pcs[:])` does not allocate — the array is part of the struct.

### Baseline

```go
type E struct {
    pcs []uintptr
}

func New(...) *E {
    pcs := make([]uintptr, 32)             // alloc
    n := runtime.Callers(2, pcs)
    return &E{pcs: pcs[:n]}
}
```

### Optimised

```go
type E struct {
    pcs  [16]uintptr
    npcs int
}

func New(...) *E {
    e := &E{}
    e.npcs = runtime.Callers(2, e.pcs[:])  // no allocation
    return e
}
```

The single struct allocation now carries the PCs inline. 16 frames is enough for almost every Go program.

If you really need more frames, allocate dynamically only when 16 is full:

```go
if e.npcs == 16 {
    extra := make([]uintptr, 64)
    n := runtime.Callers(2+16, extra)
    // ...
}
```

### Verify

```go
go build -gcflags="-m" ./... 2>&1 | grep "moved to heap"
```

Should show only the `&E{}` itself, not the PC slice.

---

## Optimisation 9 — Avoid `MarshalJSON` recursion

A naive `MarshalJSON` calls `json.Marshal(e)` on the receiver — infinite recursion or, worse, infinite allocations.

### Baseline (broken)

```go
func (e *E) MarshalJSON() ([]byte, error) {
    return json.Marshal(e) // recurses
}
```

### Optimised

```go
func (e *E) MarshalJSON() ([]byte, error) {
    type alias E // alias has no methods, so no recursion
    return json.Marshal((*alias)(e))
}
```

Or marshal a deliberate DTO:

```go
func (e *E) MarshalJSON() ([]byte, error) {
    return json.Marshal(struct {
        Op   string `json:"op"`
        Code string `json:"code"`
    }{e.Op, e.Code})
}
```

### Verify

A unit test that calls `json.Marshal` on the value and asserts the output shape.

---

## Optimisation 10 — Codegen the error catalog

For a catalog with hundreds of codes, hand-written maps are:
- Error-prone (typos, mismatched HTTP statuses).
- Slow to enrich (every new code is N edits across packages).
- Unclear in CI — no single source of truth.

### Optimised

```yaml
# errors.yaml
- code: USER_NOT_FOUND
  kind: NotExist
  http: 404
  grpc: NOT_FOUND
  message: "user not found"
- code: INVALID_EMAIL
  kind: Invalid
  http: 400
  grpc: INVALID_ARGUMENT
  message: "invalid email"
```

Generate `codes_gen.go` with constants, an HTTP map, a gRPC map, a `String()` method, and a docs table. Wire it via `go:generate`. Adding a code is one YAML edit + `go generate`.

### Verify

CI test:

```go
func TestEveryCodeMapped(t *testing.T) {
    for _, c := range allCodes {
        if codeHTTP[c] == 0 { t.Errorf("no HTTP for %s", c) }
        if codeGRPC[c] == 0 { t.Errorf("no gRPC for %s", c) }
    }
}
```

Drift between YAML and Go is impossible because Go is generated.

---

## Wrap-up

The biggest wins, in order:

1. **Avoid `debug.Stack()`** anywhere errors are common. Use `runtime.Callers` and symbolize lazily.
2. **Use enum codes** for hot leaf errors — zero allocation.
3. **Use sentinels** when the data is constant; only allocate structs when each instance differs.
4. **Don't wrap layers** that add nothing. A wrap should carry information.
5. **Inline PC arrays** so capture does not allocate.
6. **Generate large catalogs** instead of hand-writing them.

Custom errors are essentially free if you separate the rare path (allocate, capture) from the hot path (compare, return). Profile, change *one* thing, re-profile. The combination of these optimisations turns a system that allocates millions of error objects per second into one that allocates only when something genuinely failed.
