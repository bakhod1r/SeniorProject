# Go Variadic Functions — Senior Level

## 1. Overview

Senior-level mastery of variadic functions means understanding the precise compiler-generated code, the escape analysis decisions for the implicit slice, the cost of `...any` boxing in hot paths, the pitfalls of aliasing in production APIs, and the design trade-offs between `...T` parameters, `[]T` parameters, and structured option types. You also recognize when a variadic API breaks consumers and how to evolve one safely.

---

## 2. Advanced Semantics

### 2.1 Implicit Slice Construction

For a call `f(a, b, c)` to `func f(xs ...T)`, the compiler emits roughly:

```go
{
    var tmp = [3]T{a, b, c}   // backing array
    f(tmp[:])                  // passes slice header
}
```

The backing array's storage class is determined by **escape analysis**:

- If `f` does not store `xs` beyond its own lifetime → backing array on caller's stack (zero allocation).
- If `f` stores `xs` (e.g., into a global, channel, struct field) → backing array escapes to heap.

Verify:
```bash
go build -gcflags="-m=2"
# ./main.go:N:NN: ... does not escape
# OR
# ./main.go:N:NN: []T{...} escapes to heap
```

### 2.2 Spread Form Cost

`f(s...)` is essentially:

```go
f(s) // pass s's slice header (24 bytes on amd64) directly
```

No allocation. No copy. The slice header travels through the register-based ABI — typically in registers.

### 2.3 The `...any` Boxing Cost

Each non-pointer-typed argument to `func f(args ...any)` is boxed:

```go
fmt.Println(1, "hi", true)
// Compiler emits:
//   args := [3]any{
//     any(1),       // boxing: type word + value (8+8 bytes), may heap-allocate
//     any("hi"),    // string already pointer-typed; usually no extra alloc
//     any(true),    // bool boxed; small, possibly stack
//   }
//   fmt.Println(args[:])
```

For an `int`, the runtime needs to pack the value plus its type descriptor. Small ints (typically -5..255) are pre-allocated and shared (`runtime.staticuint64s`); other ints allocate. `string` is already a pointer-and-length pair, so boxing it costs only the type descriptor word.

### 2.4 The `slices.Concat` Pattern

The `slices` package (Go 1.21+) has a variadic `Concat`:

```go
slices.Concat([]int{1, 2}, []int{3, 4}, []int{5, 6}) // [1 2 3 4 5 6]
```

Implemented internally as:

```go
func Concat[S ~[]E, E any](slices ...S) S {
    size := 0
    for _, s := range slices {
        size += len(s)
    }
    out := make(S, 0, size)
    for _, s := range slices {
        out = append(out, s...)
    }
    return out
}
```

This is a textbook variadic-of-generic-slice. Note the size pre-pass to avoid `append` reallocations — a standard senior-level optimization.

### 2.5 Variadic Method Receivers Are Forbidden

A method's receiver list cannot use `...`:
```go
type T struct{}
// func (t ...T) M() {} // error
```
But the parameter list can:
```go
func (t T) M(xs ...int) {} // OK
```

Methods with variadic params behave like any other variadic.

### 2.6 Generic + Variadic Edge Cases

```go
func First[T any](xs ...T) (T, bool) {
    var zero T
    if len(xs) == 0 {
        return zero, false
    }
    return xs[0], true
}

x, ok := First[int]() // explicit type param needed when no args
```

When the variadic is empty, type inference fails because there's no value to derive `T` from. Callers must write `First[int]()` explicitly.

---

## 3. Production Patterns

### 3.1 Defensive Copy in Constructors

If your constructor stores the variadic, copy first:

```go
type Config struct {
    handlers []Handler
}

// BAD: caller can mutate config later
func NewConfig(hs ...Handler) *Config {
    return &Config{handlers: hs}
}

// GOOD: independent storage
func NewConfig(hs ...Handler) *Config {
    return &Config{handlers: append([]Handler(nil), hs...)}
}
```

### 3.2 Capacity-Pre-Pass Pattern

When you need to allocate a result slice based on the total size of variadic inputs, count first:

```go
func Concat[T any](groups ...[]T) []T {
    n := 0
    for _, g := range groups {
        n += len(g)
    }
    out := make([]T, 0, n) // single allocation
    for _, g := range groups {
        out = append(out, g...)
    }
    return out
}
```

This avoids `append`'s amortized growth and is a 2-3× speedup vs naive append-in-a-loop.

### 3.3 Avoiding `...any` Boxing With Structured Logging

```go
// Slow: per-arg boxing
func slow(format string, args ...any) {
    fmt.Printf(format, args...)
}

// Fast: typed Field constructor + variadic of struct
type Field struct {
    Key   string
    Type  fieldType  // enum
    Int   int64
    Str   string
    Float float64
}

func String(k, v string) Field { return Field{Key: k, Type: tStr, Str: v} }
func Int(k string, v int)      Field { return Field{Key: k, Type: tInt, Int: int64(v)} }

func info(msg string, fs ...Field) { /* serialize fs */ }

info("login", String("user", "ada"), Int("attempts", 3))
```

This is the idea behind `zap` and `zerolog`. Eliminates per-arg boxing.

### 3.4 Variadic of Functions for Composition

```go
type Middleware func(http.Handler) http.Handler

func Chain(h http.Handler, mws ...Middleware) http.Handler {
    for i := len(mws) - 1; i >= 0; i-- {
        h = mws[i](h)
    }
    return h
}
```

Production note: middleware order matters — apply from innermost to outermost, which means iterating in reverse.

### 3.5 Variadic vs Builder API

Variadic options work for ~3-7 knobs. Beyond that, a builder API is more readable:

```go
// Variadic options:
NewServer(WithAddr(":9000"), WithTimeout(5*time.Second))

// Builder:
NewServerBuilder().Addr(":9000").Timeout(5 * time.Second).Build()
```

For libraries, variadic options are more idiomatic in Go. For DSLs (query builders, schema builders), method chaining can be clearer.

### 3.6 Avoiding the "Forwarding Forgot Spread" Bug at API Level

If you expose a variadic helper, name it suggestively:
```go
func Logf(format string, args ...any)        // user-facing
func logfPassthrough(format string, args ...any) {
    Logf(format, args...) // CORRECT
}
```

A common pattern in tests and middleware: provide a `WithFields(fs ...Field) Logger` that returns a new logger with combined fields. Inside, use spread.

---

## 4. Concurrency Considerations

### 4.1 Spread Aliasing Across Goroutines

```go
func startBatch(items ...int) {
    go func() {
        for _, x := range items {
            process(x)
        }
    }()
}

s := []int{1, 2, 3}
startBatch(s...) // goroutine sees s's backing array
s[0] = -1        // RACE: goroutine and main both touch s[0]
```

If a variadic spread call hands the slice to a goroutine, you've created an alias visible across goroutines. Either:
- defensively copy in the receiving function,
- document the aliasing,
- use the literal form.

### 4.2 Variadic + sync.Pool

Some logging libraries use a `sync.Pool` for `[]any` slices to reuse the backing array of variadic args. Care: the pool MUST clear the slice contents (set to `nil`) before returning, else captured pointers prevent GC.

```go
var pool = sync.Pool{
    New: func() any { return make([]any, 0, 8) },
}

func acquire() []any  { return pool.Get().([]any) }
func release(s []any) {
    for i := range s {
        s[i] = nil // clear references!
    }
    pool.Put(s[:0])
}
```

---

## 5. Memory and GC Interactions

### 5.1 Implicit Slice on Stack vs Heap

Run an experiment:

```go
package main

import "fmt"

func sumAlias(xs ...int) int {
    s := 0
    for _, v := range xs {
        s += v
    }
    return s
}

var sink []int

func sumEscape(xs ...int) {
    sink = xs
}

func main() {
    _ = sumAlias(1, 2, 3) // implicit slice does not escape; on stack
    sumEscape(1, 2, 3)    // implicit slice escapes via sink; on heap
    fmt.Println(sink)
}
```

`go build -gcflags="-m=2"` shows:
```
./main.go:NN:NN: ([]int){1, 2, 3} does not escape
./main.go:MM:MM: ([]int){1, 2, 3} escapes to heap
```

### 5.2 GC Sees Variadic Slices Like Any Other

A variadic parameter on the stack is rooted by the goroutine's stack scan; on the heap it's a regular allocation tracked by the heap arena. Nothing special.

### 5.3 Per-Call Allocation Profile

A typical `fmt.Printf("user %s scored %d", "ada", 42)` profile:

| Allocation | Size | Notes |
|------------|------|-------|
| Implicit `[]any{...}` slice | 16 B header + 32 B array | Often stack-allocated since fmt does not retain |
| Boxing of `int 42` | 16 B (type word + value) | Small ints from staticuint64s pool: 0 alloc |
| Boxing of `string "ada"` | 16 B (type word + value) | String is already pointer-and-length: pool may reuse |
| Final string buffer | depends on format | Returned to caller; usually heap |

In aggregate, even simple `Printf` calls allocate ~3-5 small objects. For 100k req/s with 3 log lines per request, that's 300k-1.5M allocs/sec — measurable in pprof.

---

## 6. Production Incidents

### 6.1 Forwarding Without Spread

A team's logging wrapper looked correct but tests showed every log line printed `[a b c]` instead of separate fields:

```go
func wrappedLog(args ...any) {
    realLog(args) // BUG — should be args...
}
```

The compiler accepted it because `realLog(args ...any)` has parameter `[]any`, and passing `args` (which is `[]any`) wraps it as a single `any` element of a new variadic slice. `realLog` then saw one arg of type `[]any{a, b, c}`. Fix: spread.

### 6.2 Aliasing Mutation Across Goroutines

A high-throughput pipeline took a variadic `events ...Event` and forwarded the slice to a goroutine for batching. The producer kept reusing the backing array (`events = events[:0]; events = append(events, ...)`). The consumer goroutine read corrupted data — race detector caught it.

Fix: defensive copy at the boundary:
```go
func enqueue(events ...Event) {
    snapshot := append([]Event(nil), events...)
    go process(snapshot...)
}
```

### 6.3 `...any` Boxing Driving GC Pressure

A service emitted ~200k structured log lines per second using `log.Printf(format, args...)`. CPU profile showed 12% in `runtime.convT64` (interface boxing for ints). Switched to a `zap`-style typed-Field API; allocation rate dropped 95%, GC CPU dropped from 8% to <1%.

### 6.4 Empty Variadic Causing nil Panic

Code assumed `args` is always non-empty:

```go
func first(xs ...int) int {
    return xs[0] // panics on first()
}
```

A caller refactor removed the args; tests didn't cover the zero-args case. Fix: explicit length check or change to a different signature.

---

## 7. Best Practices

1. **Always handle the zero-args case** in the function body.
2. **Document aliasing**: "the slice is not retained" or "the function may modify the slice".
3. **Defensively copy** when storing the variadic past the call.
4. **Pre-allocate result capacity** when concatenating variadic inputs.
5. **Use typed variadics** instead of `...any` in performance-sensitive code.
6. **Use generics** to avoid duplicating typed variadics (Go 1.18+).
7. **Always spread** when forwarding (`inner(args...)`).
8. **Validate caller-controlled lengths** to prevent DoS.
9. **Prefer `[]T` parameter** when callers naturally have a slice.
10. **Don't fake function overloading** with variadics.

---

## 8. Reading the Compiler Output for Variadics

```bash
# Where is the implicit slice allocated?
go build -gcflags="-m=2"
# Look for:
#   "args does not escape"  → stack
#   "args escapes to heap"  → heap

# What gets boxed?
go build -gcflags="-m=2"
# Look for:
#   "convT64", "convTstring", "convTslice" calls in disassembly

# Inlining of variadic functions?
go build -gcflags="-m -m" 2>&1 | grep -i "variadic\|inline"
```

---

## 9. API Evolution Hazards

| Change | Source-compatible? |
|--------|---------------------|
| Add a new variadic param (where none existed) | ❌ — signature changed |
| Change `...T` to `[]T` | ❌ — call sites with literal args break |
| Change `[]T` to `...T` | ❌ — call sites with `f(s)` break (must become `f(s...)`) |
| Change `...T1` to `...T2` (different element type) | ❌ |
| Add a non-variadic parameter before the existing variadic | ❌ |
| Rename a variadic param | ✅ |

Once a public API has a variadic parameter, you're committed to that shape. Use it deliberately.

---

## 10. Self-Assessment Checklist

- [ ] I can predict whether the implicit slice for a literal-arg call escapes
- [ ] I know the per-arg cost of `...any` and avoid it in hot paths
- [ ] I always spread when forwarding (`inner(args...)`)
- [ ] I defensively copy when storing variadic input past the call
- [ ] I document aliasing in the function comment
- [ ] I prefer typed variadics or generics over `...any`
- [ ] I bound caller-controlled lengths in security-sensitive code
- [ ] I pre-allocate output capacity when concatenating variadic inputs
- [ ] I can read `-gcflags="-m"` output to verify allocation behavior
- [ ] I know which API changes break consumers

---

## 11. Summary

A variadic parameter is a `[]T` parameter with two call-site conveniences. The compiler builds an implicit slice for literal args (often stack-allocated) and hands the existing slice through for spread calls. Aliasing in spread form is the source of most subtle bugs; defensive copies fix them. `...any` is convenient but expensive (per-arg boxing); typed variadics or generics are preferable in hot paths. API design with variadics commits you to the shape — once published, changes are breaking.

---

## 12. Further Reading

- [Go Spec — Passing arguments to ... parameters](https://go.dev/ref/spec#Passing_arguments_to_..._parameters)
- [`slices.Concat` source](https://cs.opensource.google/go/go/+/refs/tags/go1.21:src/slices/slices.go)
- [`errors.Join` source](https://cs.opensource.google/go/go/+/refs/tags/go1.20:src/errors/join.go)
- [zap structured logger](https://github.com/uber-go/zap) — typed variadic Field API
- [Open-coded defers + variadic interactions](https://github.com/golang/proposal/blob/master/design/34481-opencoded-defers.md)
- 2.6.5 Closures
- 2.7.3 With Maps & Slices
