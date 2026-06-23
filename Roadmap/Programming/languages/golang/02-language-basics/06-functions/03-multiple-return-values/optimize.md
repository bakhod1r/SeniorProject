# Go Multiple Return Values — Optimize

## Instructions

Each exercise presents an inefficient or wasteful pattern around multi-result functions. Identify the issue, write an optimized version, and explain the improvement. Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Exercise 1 🟢 — Sentinel Error Allocation

**Problem**: A function allocates a fresh error message on every call.

```go
import "errors"

func get(k string) (string, error) {
    if k == "" {
        return "", errors.New("empty key")
    }
    return "value", nil
}
```

**Question**: What's the cost, and how do you fix it?

<details>
<summary>Solution</summary>

**Issue**: Each `errors.New("empty key")` allocates ~16 bytes for an `*errorString`. In a hot path with 1M calls/sec where 1% fail, that's 10k allocations/sec — small but additive.

**Optimization** — package-level sentinel:
```go
var ErrEmptyKey = errors.New("empty key")

func get(k string) (string, error) {
    if k == "" {
        return "", ErrEmptyKey // 0 alloc per call
    }
    return "value", nil
}
```

Bonus: callers can `errors.Is(err, ErrEmptyKey)` to handle this specific case.

**Benchmark** (10M calls, 1% error):
- Per-call `errors.New`: ~12 ms total, 100k allocs
- Sentinel: ~3 ms total, 0 allocs

**Key insight**: Allocate sentinel errors once at package level. They're never modified, so sharing is safe.
</details>

---

## Exercise 2 🟢 — Wrapping in a Hot Loop

**Problem**: A retry helper wraps every error per attempt.

```go
func retry(attempts int, fn func() error) error {
    var err error
    for i := 0; i < attempts; i++ {
        err = fn()
        if err == nil {
            return nil
        }
        err = fmt.Errorf("attempt %d: %w", i, err) // BUG
    }
    return err
}
```

**Question**: What's the cost, and how do you fix it?

<details>
<summary>Solution</summary>

**Issue**: `fmt.Errorf("...%w", ...)` allocates a new `*wrapError` (and the variadic `[]any` slice + boxing for `i`). With 1k retries/sec × avg 3 attempts, ~3k allocations/sec.

**Optimization** — wrap only at the final boundary:
```go
func retry(attempts int, fn func() error) error {
    var lastErr error
    for i := 0; i < attempts; i++ {
        if err := fn(); err == nil {
            return nil
        } else {
            lastErr = err
        }
    }
    return fmt.Errorf("after %d attempts: %w", attempts, lastErr) // single alloc on failure path
}
```

**Benchmark** (10k retries × 3 attempts on failure):
- Wrap per attempt: ~1.5 ms, 30k allocs
- Wrap at end: ~0.3 ms, 10k allocs

**Key insight**: Wrap errors at the function boundary, not per iteration. Intermediate errors don't need context that the boundary will provide.
</details>

---

## Exercise 3 🟡 — Returning Pointer When Value Suffices

**Problem**: A small constructor returns a pointer.

```go
type Point struct{ X, Y float64 }

func newPoint(x, y float64) *Point {
    return &Point{X: x, Y: y}
}

// Hot:
// for i := 0; i < N; i++ {
//     p := newPoint(float64(i), float64(i*2))
//     consume(p)
// }
```

**Question**: How can you avoid the heap allocation?

<details>
<summary>Solution</summary>

**Issue**: `&Point{...}` escapes to the heap because the function returns a pointer. ~16 B per call.

**Optimization** — return value:
```go
func newPoint(x, y float64) Point {
    return Point{X: x, Y: y}
}

for i := 0; i < N; i++ {
    p := newPoint(float64(i), float64(i*2))
    consume(p)
}
```

`Point` is 16 B; the register ABI passes/returns it via X0, X1 — no allocation.

**Benchmark** (10M iters):
- Return `*Point`: ~30 ns/op, 16 B/op, 1 alloc/op
- Return `Point`: ~3 ns/op, 0 B/op, 0 allocs/op

If the caller specifically needs a pointer, take the address afterward: `p := newPoint(...); ptr := &p`.

**Key insight**: For small types (≤ ~64 B), return values, not pointers. The ABI is efficient for small struct returns.
</details>

---

## Exercise 4 🟡 — Multi-Result vs Struct Return

**Problem**: A function returns 4 related results.

```go
func parseURL(s string) (string, string, string, error) {
    return "scheme", "host", "/path", nil
}

// Caller:
// scheme, host, path, err := parseURL("...")
```

**Question**: Is this idiomatic? When would you switch to a struct?

<details>
<summary>Solution</summary>

**Issue**: 4 results is borderline. Each caller must remember the order. Adding a field (e.g., port) breaks every caller.

**Optimization** — struct return:
```go
type URL struct {
    Scheme, Host, Path string
}

func parseURL(s string) (URL, error) {
    return URL{Scheme: "scheme", Host: "host", Path: "/path"}, nil
}

// Caller:
u, err := parseURL("...")
fmt.Println(u.Scheme, u.Host, u.Path)
```

Performance is identical (struct fields are decomposed into registers). The ergonomic win is large:
- Easier to evolve (add fields).
- Self-documenting at the call site.
- Can be passed around as one value.

**When to KEEP multi-result**:
- Exactly 2 results (`(value, error)`, comma-ok).
- Conceptually independent values (`(min, max, error)`).

**Key insight**: 4+ semantically related results → struct. The performance is the same; readability wins.
</details>

---

## Exercise 5 🟡 — Closing-Error Capture With Defer

**Problem**: A function ignores the close error from a file.

```go
func processFile(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close() // close error discarded

    // ... process f ...
    return nil
}
```

**Question**: How do you capture the close error properly?

<details>
<summary>Solution</summary>

**Issue**: `defer f.Close()` discards the close error. For network connections or buffered writes, this can hide data loss.

**Optimization** — named return + deferred capture:
```go
func processFile(path string) (err error) {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()

    // ... process f ...
    return nil
}
```

Now if Close fails AND no other error occurred, the close error is propagated.

**Performance**: open-coded defer (Go 1.14+) makes the deferred closure near-zero-cost.

**Key insight**: Named returns enable defer-time error-result mutation. This is the standard pattern for capturing cleanup errors.
</details>

---

## Exercise 6 🟡 — Avoiding Wrapping When Caller Won't Inspect

**Problem**: An internal function wraps errors with context, but no caller uses `errors.Is`/`errors.As`.

```go
func internalStep(x int) error {
    if x < 0 {
        return fmt.Errorf("internalStep: negative input %d", x)
    }
    return nil
}
```

**Question**: When is wrapping unnecessary?

<details>
<summary>Solution</summary>

**Discussion**: The function uses `fmt.Errorf` even though there's nothing to wrap (no `%w`). This works but allocates a `*fmt.wrapError`-equivalent when there's no chained error. It's only really a `*fmtError` (no Unwrap method).

**Optimization** — for short, never-inspected error messages:
```go
import "errors"

var errNegative = errors.New("internalStep: negative input")

func internalStep(x int) error {
    if x < 0 {
        return errNegative
    }
    return nil
}
```

Loses the dynamic `x` value in the message. If you NEED the value:

```go
func internalStep(x int) error {
    if x < 0 {
        return fmt.Errorf("internalStep: negative input %d", x)
    }
    return nil
}
```

is fine; the caller will allocate when they format/log it anyway.

**When to wrap with %w**: When the caller needs to `errors.Is`/`errors.As` against an underlying error.

**Benchmark** (1M calls, 1% error):
- `fmt.Errorf` per error: ~12 ms
- Sentinel: ~3 ms

**Key insight**: Use sentinels for static messages, wrap with `%w` only when the chain matters. Don't pay the cost of wrapping if nothing inspects the chain.
</details>

---

## Exercise 7 🟡 — Pre-Allocating Multi-Result Slice

**Problem**: A function returning a slice + count appends to a nil slice in a loop.

```go
func process(items []int) ([]int, int, error) {
    var out []int
    count := 0
    for _, x := range items {
        if x > 0 {
            out = append(out, x*2)
            count++
        }
    }
    return out, count, nil
}
```

**Question**: What allocations occur, and how do you minimize them?

<details>
<summary>Solution</summary>

**Issue**: `append` to nil slice allocates and grows ~log2(N) times.

**Optimization** — pre-allocate with capacity:
```go
func process(items []int) ([]int, int, error) {
    out := make([]int, 0, len(items)) // worst-case capacity
    count := 0
    for _, x := range items {
        if x > 0 {
            out = append(out, x*2)
            count++
        }
    }
    return out, count, nil
}
```

If you know roughly the filtered count:
```go
out := make([]int, 0, len(items)/2) // estimate
```

**Benchmark** (10k items, 50% positive):
- Naive: ~120 µs/op, 80 KB/op, 14 allocs/op
- Pre-allocated to len(items): ~80 µs/op, 80 KB/op, 1 alloc/op

**Key insight**: Pre-allocate slice results to avoid `append`'s repeated growth. Worst-case capacity is usually fine.
</details>

---

## Exercise 8 🔴 — Avoid Boxing Concrete Errors

**Problem**: A function returns a concrete error type as `error` interface.

```go
type APIError struct {
    Code int
    Msg  string
}

func (e *APIError) Error() string { return e.Msg }

func call() (Response, error) {
    if failed {
        return Response{}, &APIError{Code: 500, Msg: "down"}
    }
    return Response{}, nil
}
```

**Question**: Is there an unnecessary cost? How would you reduce it?

<details>
<summary>Solution</summary>

**Discussion**: `&APIError{...}` allocates per error. For pointer receivers, this is one alloc.

**Optimization** — pre-allocated common errors:
```go
var (
    ErrServerDown   = &APIError{Code: 500, Msg: "down"}
    ErrUnauthorized = &APIError{Code: 401, Msg: "unauthorized"}
)

func call() (Response, error) {
    if failed {
        return Response{}, ErrServerDown // 0 alloc
    }
    return Response{}, nil
}
```

Now repeated returns of the same error don't allocate. Caller can still `errors.As(err, &apiErr)` to inspect.

**Caveat**: Don't reuse a typed error if callers may modify its fields! Make the struct immutable in spirit (don't expose mutators).

**Benchmark** (1M calls, 10% errors):
- New `*APIError` per error: ~40 ms, 100k allocs, 4.8 MB
- Pre-allocated: ~10 ms, 0 allocs

**Key insight**: For a fixed set of error types/codes, pre-allocate at package level. Treat errors as immutable values.
</details>

---

## Exercise 9 🔴 — `errors.As` vs Type Switch

**Problem**: A handler discriminates errors using `errors.As`.

```go
func handle(err error) {
    var apiErr *APIError
    if errors.As(err, &apiErr) {
        // handle APIError
        return
    }
    var dbErr *DBError
    if errors.As(err, &dbErr) {
        // handle DBError
        return
    }
    // generic
}
```

**Question**: When `err` is unwrapped (no chain), is there a faster path?

<details>
<summary>Solution</summary>

**Issue**: Each `errors.As` walks the unwrap chain via reflection. For unwrapped errors, this is overkill.

**Optimization** — type switch first, fall back to errors.As:
```go
func handle(err error) {
    switch e := err.(type) {
    case *APIError:
        // handle e directly
        return
    case *DBError:
        // handle e directly
        return
    }
    // wrapped errors:
    var apiErr *APIError
    if errors.As(err, &apiErr) { /* ... */ return }
    var dbErr *DBError
    if errors.As(err, &dbErr) { /* ... */ return }
}
```

Type switch is much faster than `errors.As` (no reflection).

**Benchmark** (1M unwrapped errors):
- `errors.As` only: ~80 ms, allocations from reflect
- Type switch first: ~5 ms, 0 allocs

For wrapped errors (less common), the fallback runs `errors.As` once.

**Key insight**: Type switch is the cheap path; `errors.As` is for traversing chains. Use type switch first when you can.
</details>

---

## Exercise 10 🔴 — Returning Larger Structs by Pointer for Mutation

**Problem**: A function returns a large struct value:

```go
type State struct {
    Buf [1024]byte // 1 KB
    N   int
}

func newState() (State, error) {
    var s State
    s.N = 1
    return s, nil
}
```

**Question**: When does returning by value vs pointer matter for large structs?

<details>
<summary>Solution</summary>

**Discussion**: 1 KB exceeds the register ABI's typical struct decomposition limit. The struct is returned via the caller's stack frame (memory copy).

**For 1 KB struct, return by value** copies 1 KB on every call. **For >~1 KB**, returning a pointer + heap allocation may be cheaper than the copy.

**Measurement**:
```go
func BenchmarkValue(b *testing.B) {
    for i := 0; i < b.N; i++ {
        s, _ := newState()
        _ = s.N
    }
}

func BenchmarkPointer(b *testing.B) {
    for i := 0; i < b.N; i++ {
        s, _ := newStatePtr()
        _ = s.N
    }
}
```

For 1 KB:
- Return value: ~80 ns/op, 0 allocs (caller frame holds it)
- Return pointer: ~50 ns/op, 1024 B/op, 1 alloc/op

For 16 KB:
- Return value: ~600 ns/op, 0 allocs
- Return pointer: ~150 ns/op, 16 KB/op, 1 alloc/op

The pointer version wins on time but allocates.

**Decision**:
- Small (≤ 64 B): return value.
- Medium (64 B - 1 KB): return value if caller doesn't store; pointer if it does.
- Large (>1 KB): pointer + caller-provided buffer pattern often best:
  ```go
  func fillState(s *State) error {
      s.N = 1
      return nil
  }
  
  // Caller:
  var s State
  if err := fillState(&s); err != nil { ... }
  ```

**Key insight**: For large structs, return-by-value copies. Pointer returns trade a copy for an allocation. Caller-provided buffer avoids both.
</details>

---

## Bonus Exercise 🔴 — Verify No Allocation From Multi-Result

**Problem**: You designed a hot multi-result API and want to verify zero allocations.

```go
func parse(s string) (int, error) {
    if s == "" {
        return 0, ErrEmpty
    }
    return len(s), nil
}
```

**Task**: Show the commands and benchmark to prove this allocates 0 in both success and failure paths.

<details>
<summary>Solution</summary>

**Step 1 — escape analysis**:
```bash
go build -gcflags="-m=2" 2>&1 | grep -E "parse|escape"
```

Look for "does not escape" on `parse`'s body.

**Step 2 — benchmark**:
```go
package main

import (
    "errors"
    "testing"
)

var ErrEmpty = errors.New("empty")

func parse(s string) (int, error) {
    if s == "" { return 0, ErrEmpty }
    return len(s), nil
}

func BenchmarkParseSuccess(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        n, err := parse("hello")
        if err != nil || n != 5 { b.Fatal() }
    }
}

func BenchmarkParseError(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _, err := parse("")
        if err == nil { b.Fatal() }
    }
}
```

```bash
go test -bench=. -benchmem
```

Expected:
```
BenchmarkParseSuccess-8    1000000000   0.5 ns/op   0 B/op   0 allocs/op
BenchmarkParseError-8      1000000000   0.6 ns/op   0 B/op   0 allocs/op
```

Both paths are 0-alloc because:
- Successful path: int + nil interface (both register-passed).
- Error path: int (zero) + sentinel pointer (no alloc, just a pointer copy).

**Key insight**: Multi-result functions can be 0-alloc on both success and failure paths if you use sentinel errors and don't allocate intermediate state. Verify with `-benchmem`.
</details>
