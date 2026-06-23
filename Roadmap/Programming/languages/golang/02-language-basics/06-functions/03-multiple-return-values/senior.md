# Go Multiple Return Values — Senior Level

## 1. Overview

Senior-level mastery of multiple return values means understanding how the register-based ABI lays out N results, when interface boxing occurs for the `error` slot, the typed-nil-interface gotcha, escape behavior of returned pointers, and the design trade-offs between `(value, error)`, comma-ok, struct returns, and option-style return packages. You also know how to design errors that compose cleanly across package boundaries.

---

## 2. Advanced Semantics

### 2.1 Calling Convention for Multiple Results

Since Go 1.17, results are returned in registers (amd64 ABIInternal):

| Result index | Register (int/ptr) | Register (float) |
|--------------|---------------------|-------------------|
| 0 | AX | X0 |
| 1 | BX | X1 |
| 2 | CX | X2 |
| 3 | DI | X3 |
| 4 | SI | X4 |
| 5 | R8 | X5 |
| 6 | R9 | X6 |
| 7 | R10 | X7 |
| 8 | R11 | X8 |
| 9+ | spill to caller's stack | spill |

For `(int, error)`:
- AX = int
- BX = error.itab (type word)
- CX = error.data (data word)

The error interface is two words wide (itab + data), so it occupies two register slots.

### 2.2 The Typed-Nil-Interface Gotcha

```go
type MyError struct{ Msg string }
func (e *MyError) Error() string { return e.Msg }

func bad() error {
    var p *MyError = nil
    return p // returns non-nil error!
}

func main() {
    err := bad()
    fmt.Println(err == nil)  // false
    fmt.Println(err)         // <nil>  (Error() panics if called)
}
```

The interface value `error` consists of (itab, data). When you return `p`, the interface gets:
- itab: non-nil (`*MyError`'s itab)
- data: nil

`err == nil` checks both words; both must be nil for the interface to be nil. Hence `err != nil` even though `p == nil`.

**Fix** — return literal `nil` when no error:
```go
func good() error {
    if shouldError() {
        return &MyError{Msg: "oops"}
    }
    return nil // literal nil — both words zero
}
```

This is one of the most common production bugs in Go. Static analyzers like `nilness` catch it.

### 2.3 Escape Behavior of Multi-Result Returns

Returning a pointer always forces escape:
```go
func makePtr() *int {
    x := 42
    return &x // x escapes to heap
}
```

Returning a value is stack-allocatable:
```go
func makeVal() int {
    x := 42
    return x // x stays on stack; copied to caller's register
}
```

For `(*T, error)`:
- The `*T` value is a pointer; if it points to a local, that local escapes.
- The `error` value boxes the underlying concrete error type, which may allocate.

Verify with `-gcflags="-m"`.

### 2.4 Error Allocation Cost

Each `errors.New("...")` allocates an `*errorString`. Each `fmt.Errorf("...: %w", err)` allocates an `*wrapError`. In hot paths these add up.

**Strategies**:

1. **Sentinel errors** (allocated once at init):
   ```go
   var ErrNotFound = errors.New("not found")
   ```
   Subsequent `return ErrNotFound` is zero-allocation.

2. **Pre-built typed errors**:
   ```go
   var notFound = &MyError{Code: 404}
   return notFound // shared pointer, no alloc
   ```

3. **Avoid wrapping in tight loops**: wrap once at the function boundary.

### 2.5 Multi-Result Inlining

The Go inliner handles multi-result functions normally. Each return expression counts toward the cost budget. Functions with multiple results inline well as long as they're small.

Example:
```go
func divmod(a, b int) (int, int) { return a / b, a % b }
```

This typically inlines into the caller, with both results going directly into caller registers — zero call overhead.

Verify:
```bash
go build -gcflags="-m -m" 2>&1 | grep "inlining call to divmod"
```

### 2.6 Named Returns and the SSA Pipeline

Named returns are sugar:
```go
func split() (a, b int) {
    a, b = 1, 2
    return
}

// Lowered to:
func split() (int, int) {
    var a, b int = 0, 0 // initialized to zero
    a, b = 1, 2
    return a, b
}
```

The compiled SSA has the same shape as an unnamed-result version. Naked return is purely syntactic.

---

## 3. Production Patterns

### 3.1 Error Granularity

Define sentinel errors at the boundary that callers may legitimately want to handle:

```go
package db

var (
    ErrNotFound          = errors.New("db: not found")
    ErrConnectionLost    = errors.New("db: connection lost")
    ErrConstraintViolation = errors.New("db: constraint violation")
)

func (d *DB) Get(key string) ([]byte, error) {
    // ...
    return nil, fmt.Errorf("Get(%q): %w", key, ErrNotFound)
}
```

Callers:
```go
data, err := db.Get("k")
if errors.Is(err, db.ErrNotFound) {
    // handle gracefully
} else if err != nil {
    // unexpected — log and bubble up
}
```

Don't expose every internal error; pick the few callers actually need.

### 3.2 Returning Struct vs Tuple

```go
// Tuple-style
func parseURL(s string) (scheme, host, path string, err error)

// Struct-style
func parseURL(s string) (URL, error)

type URL struct { Scheme, Host, Path string }
```

For 3+ semantically related results, prefer a struct. Benefits:
- Callers can pass the struct around as one value.
- Easier to evolve (add fields).
- Methods can be defined on it.

### 3.3 Option-Result Pattern (Generics)

For optional results, Go's idiomatic comma-ok still wins, but with generics you can build helper types:

```go
type Result[T any] struct {
    Value T
    Err   error
}

func wrap[T any](v T, err error) Result[T] {
    return Result[T]{Value: v, Err: err}
}
```

Useful for wrapping legacy multi-result APIs in a single value for collections:
```go
results := []Result[int]{
    wrap(parseInt("1")),
    wrap(parseInt("two")),
}
```

Use sparingly — often overengineered for small surfaces.

### 3.4 Closing Over Named Results in Defer

```go
func processFile(path string) (count int, err error) {
    f, err := os.Open(path)
    if err != nil {
        return 0, err
    }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr // capture close error if no other
        }
    }()
    // ... process and count ...
    return count, nil
}
```

The deferred function modifies `err` after the explicit `return`. This is **only** possible with named returns.

### 3.5 Avoid `errors.New` in Hot Paths

Bad:
```go
for i := 0; i < N; i++ {
    if !valid(items[i]) {
        return errors.New("invalid item") // alloc per iteration
    }
}
```

Good:
```go
var errInvalid = errors.New("invalid item") // once, at package level

for i := 0; i < N; i++ {
    if !valid(items[i]) {
        return errInvalid
    }
}
```

For wrapped errors carrying dynamic context, reserve wrapping for the boundary:
```go
for i := 0; i < N; i++ {
    if err := check(items[i]); err != nil {
        return fmt.Errorf("check item[%d]: %w", i, err) // single alloc per error path
    }
}
```

---

## 4. Concurrency Considerations

### 4.1 Multi-Result and Goroutines

Goroutines cannot return values directly. To get a result from a goroutine, use channels:

```go
func compute() (int, error) {
    ch := make(chan struct {
        n   int
        err error
    }, 1)
    go func() {
        n, err := work()
        ch <- struct {
            n   int
            err error
        }{n, err}
    }()
    res := <-ch
    return res.n, res.err
}
```

Or use `errgroup` for parallel multi-result orchestration:

```go
import "golang.org/x/sync/errgroup"

var g errgroup.Group
var a, b string
g.Go(func() error {
    var err error
    a, err = fetchA()
    return err
})
g.Go(func() error {
    var err error
    b, err = fetchB()
    return err
})
if err := g.Wait(); err != nil {
    return err
}
// use a and b
```

### 4.2 Error Aggregation Across Goroutines

```go
import "errors"

func parallel() error {
    var errs []error
    var mu sync.Mutex
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            if err := work(i); err != nil {
                mu.Lock()
                errs = append(errs, err)
                mu.Unlock()
            }
        }(i)
    }
    wg.Wait()
    return errors.Join(errs...)
}
```

`errors.Join` (Go 1.20+) returns nil if all errs are nil.

---

## 5. Memory and GC Interactions

### 5.1 Returning a Pointer Forces Heap Allocation

```go
func newUser(name string) *User {
    return &User{Name: name} // User escapes to heap
}
```

Per call: 1 heap allocation for `User`.

For small types, prefer returning a value:
```go
func newUser(name string) User {
    return User{Name: name} // stays on stack
}
```

Caller can take address afterward if needed: `u := newUser("a"); p := &u`.

### 5.2 Boxing Error in Interface

`return errors.New("...")` does NOT cause additional boxing because `errors.New` already returns `*errorString` and the conversion to `error` interface is just two-word assignment.

`return MyConcreteError{...}` (value receiver) might allocate when boxed into `error`. Pointer-receiver concrete errors avoid this.

### 5.3 Multi-Result Cleanup at Defer

`defer` with closures captures named returns by reference. The deferred call may modify named returns before the actual return happens. Memory-wise this is just an extra closure allocation if the defer escapes (often does, then is freed at function exit).

---

## 6. Production Incidents

### 6.1 Typed Nil Interface

A package returned `(*UserError, error)` where `*UserError` was sometimes intended to be nil. Callers checked `if err != nil` and got false-positive errors. Static analysis (`nilness`, `errcheck`) caught it eventually.

Fix: change return type to `error` directly, or always return `error(nil)` literal.

### 6.2 Discarded Error From `Close`

```go
defer f.Close() // err discarded
```

For network connections and file writes, `Close()` can return an error indicating data was lost. Discarding it caused silent data corruption in a logging pipeline. Fix:

```go
defer func() {
    if cerr := f.Close(); cerr != nil {
        log.Printf("close failed: %v", cerr)
    }
}()
```

Or use named returns to capture:
```go
defer func() {
    if cerr := f.Close(); cerr != nil && err == nil {
        err = cerr
    }
}()
```

### 6.3 Wrapping in a Hot Loop

A retry helper wrapped errors per attempt. With 1k attempts/sec and ~5 retries each, this generated ~5k allocations/sec — small individually but added GC pressure. Fix: wrap only on the final error, keep intermediate errors as-is.

### 6.4 `errors.Is` Misused With Wrapped

Pre-1.13 code used `if err == io.EOF`. After upgrading and starting to wrap, the comparison stopped matching. Fix: migrate all sentinel-checking to `errors.Is(err, sentinel)`.

---

## 7. Best Practices

1. **Always check error first** before any other logic.
2. **Wrap with `%w`** to preserve the chain.
3. **Use sentinel errors at package boundaries** for callers to match.
4. **Return zero value when err != nil**.
5. **Watch the typed-nil-interface gotcha** — return `error(nil)` literal.
6. **Avoid `errors.New` allocations in hot paths**.
7. **Use named returns + defer** to capture cleanup errors.
8. **Don't return more than 3 results** — switch to a struct.
9. **Pre-allocate sentinel errors** at package level.
10. **Use `errgroup`** for parallel multi-result work.

---

## 8. Reading the Compiler Output

```bash
# Inlining and escape:
go build -gcflags="-m -m"

# Generated assembly:
go build -gcflags="-S"

# Look for boxing:
go build -gcflags="-m=2" 2>&1 | grep -E "interface|escape"
```

For `(int, error)` returning code, check that:
- `int` returned via AX register.
- `error` returned via BX (itab) + CX (data).
- No unexpected stack spills.

---

## 9. Self-Assessment Checklist

- [ ] I understand how N results are returned via the register ABI
- [ ] I can spot and fix the typed-nil-interface bug
- [ ] I use sentinel errors and `errors.Is` correctly
- [ ] I wrap with `%w` and inspect with `errors.As`
- [ ] I avoid allocating errors in hot paths
- [ ] I use named returns + defer to handle cleanup errors
- [ ] I prefer struct returns for 3+ related results
- [ ] I use `errgroup` for parallel multi-result work
- [ ] I document each result in function comments
- [ ] I handle nil errors and partial results consistently

---

## 10. Summary

At senior level, multiple return values are a calling-convention feature with predictable cost: register-passed for first ~9 slots, with strict design conventions around `(value, error)` and comma-ok. The typed-nil-interface trap is the most common subtle bug; sentinel errors and proper `%w` wrapping enable composable error chains. Defer with named returns is a powerful pattern for capturing cleanup errors. Always profile error-allocation hot paths and pre-allocate sentinels.

---

## 11. Further Reading

- [Go Blog — Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors)
- [Go Blog — Errors are values](https://go.dev/blog/errors-are-values)
- [Go Internal ABI](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md)
- [`errgroup` package](https://pkg.go.dev/golang.org/x/sync/errgroup)
- [`errors.Join` source](https://cs.opensource.google/go/go/+/refs/tags/go1.20:src/errors/join.go)
- 2.6.1 Functions Basics
- 2.6.6 Named Return Values
