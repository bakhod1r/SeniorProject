# Go Variadic Functions — Middle Level

## 1. Introduction

At the middle level you understand variadic parameters as **slice parameters with sugar at the call site**. You design APIs around them deliberately, recognize when spread aliasing causes subtle mutation bugs, and know when to choose `...T` over `[]T`. You also understand the cost model and the common allocation traps.

---

## 2. Prerequisites
- Junior-level variadic material
- Solid grasp of slices: header, backing array, capacity vs length
- Familiarity with `append`, `copy`
- Comfort with `interface{}` / `any` and boxing

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| Variadic of interface type | `...interface{}` — every arg is boxed |
| Spread aliasing | Caller and callee share the backing array |
| Defensive copy | `append([]T(nil), s...)` to isolate from aliasing |
| Open-ended overload | API design that accepts 0..N values uniformly |
| Implicit slice | The slice the compiler builds for a literal-arg call |
| `errors.Join` | Standard variadic that combines errors (Go 1.20+) |

---

## 4. Core Concepts

### 4.1 `...T` vs `[]T` Parameter

Compare two signatures:

```go
func sumA(xs []int) int     { /* ... */ return 0 }    // takes a slice
func sumB(xs ...int) int    { /* ... */ return 0 }    // variadic
```

| Property | `[]int` param | `...int` param |
|----------|---------------|-----------------|
| Caller passes individual values | `sumA([]int{1,2,3})` | `sumB(1, 2, 3)` |
| Caller passes existing slice | `sumA(s)` | `sumB(s...)` |
| Caller passes nothing | `sumA(nil)` | `sumB()` |
| Slice constructed by compiler? | No | Yes for literal args |
| Aliasing risk | Always (slice is shared) | Only with spread form |

Pick `...T` when callers will most commonly write individual literal values (`min(a, b, c)`); pick `[]T` when callers always have a slice already (`processBatch(items)`).

### 4.2 Spread Aliasing — When and Why It Bites

```go
func reverse(xs ...int) {
    for i, j := 0, len(xs)-1; i < j; i, j = i+1, j-1 {
        xs[i], xs[j] = xs[j], xs[i]
    }
}

s := []int{1, 2, 3, 4}
reverse(s...) // mutates s
fmt.Println(s) // [4 3 2 1]
```

This is *fine* when documented but surprising when not. **Defensive copy** when needed:

```go
func reverseCopy(xs ...int) []int {
    out := append([]int(nil), xs...) // independent backing array
    for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
        out[i], out[j] = out[j], out[i]
    }
    return out
}
```

### 4.3 The Forwarding Pattern

The most common variadic mistake is forwarding without `...`:

```go
func inner(args ...any) { fmt.Println(args) }

func wrong(args ...any) {
    inner(args)    // BUG: passes the []any as ONE argument; inner sees [[a b c]]
}

func correct(args ...any) {
    inner(args...) // forwards each element
}

correct("a", "b", "c") // inner receives 3 args
```

### 4.4 Append Is Variadic

The built-in `append` is variadic in its second parameter:

```go
a := []int{1, 2, 3}
a = append(a, 4)              // single value
a = append(a, 5, 6, 7)        // multiple values
a = append(a, []int{8, 9}...) // spread

// The classic concat:
b := []int{20, 30}
c := append([]int{10}, b...) // [10 20 30]
```

### 4.5 The `...any` (or `...interface{}`) Trap

Variadic of an interface type is what makes `fmt.Printf` magical — and expensive:

```go
func logf(format string, args ...any) {
    fmt.Printf(format+"\n", args...)
}

logf("user %s scored %d", "ada", 42)
// "ada" and 42 are each boxed into interface{} values.
// 42 (int) → small heap allocation (or stack-allocated escape)
```

For high-frequency call sites, prefer typed APIs (see Optimize doc).

### 4.6 Generic Variadics (Go 1.18+)

```go
func Sum[T int | float64 | string](xs ...T) T {
    var total T
    for _, x := range xs {
        total += x
    }
    return total
}

Sum(1, 2, 3)             // int 6
Sum(1.5, 2.5)            // float64 4.0
Sum("Hello, ", "World!") // string "Hello, World!"
```

Type inference makes this clean. The element type is determined from the first argument.

---

## 5. Real-World Analogies

**Buffet plates** (we used this in junior). At middle level, recognize that you bring your own plate (slice) sometimes and they hand you one (literal args) other times — the food (data) is the same, but the plate differs.

**Mailing list**: a function that takes recipients via variadic vs. as a slice. If the caller usually constructs a list anyway (database query, file parse), take `[]T`. If callers naturally write `mail("a", "b", "c")`, take `...T`.

---

## 6. Mental Models

### Model 1 — `...T` is sugar for `[]T` + spread

A variadic call is two macros expanded by the compiler:

```
sum(1, 2, 3)        becomes        sum([]int{1, 2, 3})  // (with stack-allocated array)
sum(s...)           becomes        sum(s)               // (no copy, pass header)
```

### Model 2 — Aliasing is determined by the call form

```
literal call form   →  fresh slice  →  no aliasing
spread call form    →  same slice   →  aliasing
```

---

## 7. Pros & Cons

### Pros
- Clean call sites for "0 or more" semantics
- Forwarding is a single token (`...`)
- Composable with the `append` family
- Generic variadics replace many overload patterns

### Cons
- `...any` is allocation-heavy
- Aliasing is invisible in the function signature
- Cannot mix literal + spread at the same call
- Confusing to new Go programmers (two `...` syntaxes with different meanings)

---

## 8. Use Cases

1. `fmt.Printf`-style logging
2. Middleware chain assembly: `Use(mw1, mw2, mw3)`
3. Aggregators: `min`, `max`, `sum`, `avg`
4. Combinators: `errors.Join(e1, e2, e3)`
5. Functional options: `NewServer(WithAddr(...), WithTimeout(...))`
6. Builder patterns: `NewQuery().Where(...).OrderBy(...)`
7. Concatenation: `append(a, b...)`
8. Spread re-use: `f(reuse...)` to avoid rebuilding

---

## 9. Code Examples

### Example 1 — Aliasing Trap and Defensive Copy
```go
package main

import "fmt"

func capture(items ...string) []string {
    return items // CAUTION: aliases the caller's backing array
}

func captureCopy(items ...string) []string {
    return append([]string(nil), items...)
}

func main() {
    s := []string{"a", "b", "c"}

    held1 := capture(s...)
    held2 := captureCopy(s...)

    s[0] = "X"

    fmt.Println(held1) // [X b c]   — aliased
    fmt.Println(held2) // [a b c]   — independent
}
```

### Example 2 — `fmt.Printf` Wrapper
```go
package main

import "fmt"

func tracef(prefix string, format string, args ...any) {
    fmt.Printf("[%s] "+format+"\n", args...)
}

func main() {
    tracef("DB", "query %q took %dms", "SELECT 1", 12)
}
```

### Example 3 — `errors.Join` Pattern
```go
package main

import (
    "errors"
    "fmt"
)

func combine(errs ...error) error {
    nonNil := errs[:0]
    for _, e := range errs {
        if e != nil {
            nonNil = append(nonNil, e)
        }
    }
    if len(nonNil) == 0 {
        return nil
    }
    return errors.Join(nonNil...)
}

func main() {
    err := combine(nil, fmt.Errorf("disk full"), nil, fmt.Errorf("network down"))
    fmt.Println(err)
}
```

### Example 4 — Functional Options
```go
package main

import (
    "fmt"
    "time"
)

type Server struct {
    Addr    string
    Timeout time.Duration
    MaxConn int
}

type Option func(*Server)

func WithAddr(a string) Option           { return func(s *Server) { s.Addr = a } }
func WithTimeout(d time.Duration) Option { return func(s *Server) { s.Timeout = d } }
func WithMaxConn(n int) Option           { return func(s *Server) { s.MaxConn = n } }

func NewServer(opts ...Option) *Server {
    s := &Server{Addr: ":8080", Timeout: 30 * time.Second, MaxConn: 100}
    for _, opt := range opts {
        opt(s)
    }
    return s
}

func main() {
    s := NewServer(WithAddr(":9000"), WithMaxConn(500))
    fmt.Printf("%+v\n", s)
}
```

### Example 5 — Middleware Composition
```go
package main

import (
    "fmt"
    "net/http"
)

type Middleware func(http.Handler) http.Handler

func Chain(h http.Handler, mws ...Middleware) http.Handler {
    for i := len(mws) - 1; i >= 0; i-- {
        h = mws[i](h)
    }
    return h
}

func logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        fmt.Println(r.Method, r.URL.Path)
        next.ServeHTTP(w, r)
    })
}

func auth(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // ... check auth ...
        next.ServeHTTP(w, r)
    })
}

func main() {
    final := Chain(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, "ok")
    }), logging, auth)
    _ = final
}
```

### Example 6 — Generic Variadic
```go
package main

import "fmt"

type Numeric interface {
    int | int64 | float64
}

func Sum[T Numeric](xs ...T) T {
    var total T
    for _, x := range xs {
        total += x
    }
    return total
}

func main() {
    fmt.Println(Sum(1, 2, 3))           // 6
    fmt.Println(Sum(1.5, 2.5, 3.0))     // 7
    fmt.Println(Sum[int64](100, 200))   // 300
}
```

---

## 10. Coding Patterns

### Pattern 1 — Mandatory + Optional via Variadic
```go
func GetUser(id string, opts ...QueryOpt) (*User, error) { /* ... */ return nil, nil }
```

### Pattern 2 — Builder Style
```go
func Where(q *Query, conds ...Cond) *Query { q.where = append(q.where, conds...); return q }
```

### Pattern 3 — Variadic Constructor With Spread Default
```go
func NewLogger(fields ...Field) *Logger {
    base := []Field{TimestampField()}
    return &Logger{fields: append(base, fields...)}
}
```

### Pattern 4 — Variadic for Heterogeneous Args
```go
type Field interface{}
type StringField struct{ K, V string }
type IntField    struct{ K string; V int }

func log(msg string, fields ...Field) { /* ... */ }
log("login", StringField{"user", "ada"}, IntField{"attempts", 3})
```

This avoids the cost of `...any` boxing — fields are concrete types implementing the `Field` interface.

---

## 11. Clean Code Guidelines

1. **Document aliasing**: if your function may mutate or hold the spread slice, say so.
2. **Prefer typed variadics over `...any`** for safety and performance.
3. **Use a struct param when you have many optional knobs**; variadic of options is fine for 3-7 knobs.
4. **For required + optional**, put required first, variadic last.
5. **Validate length** at function entry if the function semantically requires N args.

```go
func median(xs ...int) (int, error) {
    if len(xs) == 0 {
        return 0, errors.New("median of zero values")
    }
    // ...
    return 0, nil
}
```

---

## 12. Product Use / Feature Example

**A multi-target metric emitter**:

```go
package main

import (
    "fmt"
    "time"
)

type Metric struct {
    Name      string
    Tags      []string
    Timestamp time.Time
}

type Sink interface {
    Emit(Metric)
}

func emit(name string, tags []string, sinks ...Sink) {
    m := Metric{Name: name, Tags: tags, Timestamp: time.Now()}
    for _, s := range sinks {
        s.Emit(m)
    }
}

type stdoutSink struct{}
func (stdoutSink) Emit(m Metric) {
    fmt.Printf("[stdout] %s %v\n", m.Name, m.Tags)
}

func main() {
    emit("login", []string{"user:ada", "ip:127.0.0.1"}, stdoutSink{})
}
```

The `sinks ...Sink` lets the caller fan-out to 1 or N backends.

---

## 13. Error Handling

Wrap and join multiple errors using `errors.Join` (variadic-friendly, Go 1.20+):

```go
package main

import (
    "errors"
    "fmt"
)

func runAll(steps ...func() error) error {
    var errs []error
    for i, step := range steps {
        if err := step(); err != nil {
            errs = append(errs, fmt.Errorf("step %d: %w", i, err))
        }
    }
    return errors.Join(errs...)
}

func main() {
    err := runAll(
        func() error { return nil },
        func() error { return errors.New("oops") },
        func() error { return nil },
        func() error { return errors.New("bad") },
    )
    fmt.Println(err)
}
```

`errors.Join(nil, nil)` returns `nil`. `errors.Join(...)` with all-nil inputs returns `nil` — safe and idiomatic.

---

## 14. Security Considerations

1. **Bound caller-controlled variadics**:
   ```go
   func handle(events ...Event) {
       if len(events) > 1000 {
           events = events[:1000]
       }
       // ...
   }
   ```
2. **Never spread untrusted slices into expensive operations** without size checks.
3. **Beware logging variadic args directly**: `log("got", userInput...)` may print sensitive data. Sanitize.
4. **`...any` allows passing pointers to private state** — be deliberate about what you expose.

---

## 15. Performance Tips

1. **Cost decomposition for variadic call**:
   - Slice header: 24 bytes on the caller's stack.
   - Backing array: stack if it doesn't escape, heap otherwise.
   - Per-arg interface boxing: only for `...any` / `...interface{}` parameters.

2. **Spread is essentially free** — passes the header you already have.

3. **Inline-friendly variadics** — small variadic functions can still be inlined by the compiler (Go 1.21+).

4. **Profile before optimizing** — `fmt`-style functions look expensive but usually aren't a bottleneck.

5. **For very hot paths**, write a non-variadic specialization:
   ```go
   func sum2(a, b int) int { return a + b }
   func sum3(a, b, c int) int { return a + b + c }
   func sum(xs ...int) int { /* general */ return 0 }
   ```

---

## 16. Metrics & Analytics

```go
type Tag struct{ Key, Value string }

func emit(metric string, tags ...Tag) {
    // ... ship to backend ...
    fmt.Println(metric, tags)
}

emit("requests.total", Tag{"path", "/users"}, Tag{"status", "200"})
```

Typed `Tag` struct avoids `...any` boxing.

---

## 17. Best Practices

1. Default to `[]T` parameter when callers naturally have a slice.
2. Prefer `...T` when callers naturally write individual values.
3. Always handle the zero-args case.
4. Document aliasing behavior in the doc comment.
5. Use `append([]T(nil), v...)` for defensive copy.
6. Use generics instead of `...any` where possible (Go 1.18+).
7. Don't use a variadic to fake function overloading — separate functions are clearer.

---

## 18. Edge Cases & Pitfalls

### Pitfall 1 — Spreading a Modified Local Slice
```go
func filter(in ...int) (out []int) {
    for _, v := range in {
        if v > 0 {
            out = append(out, v)
        }
    }
    return
}

s := []int{-1, 2, -3, 4}
out := filter(s...) // no aliasing because filter only reads; out is a fresh slice
```

But:
```go
func reorderInPlace(in ...int) []int {
    sort.Ints(in) // modifies caller's slice via aliasing
    return in
}
```

### Pitfall 2 — Variadic + Goroutines

```go
func startAll(tasks ...func()) {
    for _, t := range tasks {
        go t() // safe: t is fresh per iteration in Go 1.22+ for-range
    }
}
```

### Pitfall 3 — Forwarding Without Spread
Already covered, but worth reiterating: `inner(args)` vs `inner(args...)` are completely different.

### Pitfall 4 — `len(args)` Overflow Bound

```go
func avg(xs ...int) int {
    sum := 0
    for _, x := range xs {
        sum += x // could overflow on huge inputs
    }
    return sum / len(xs)
}
```

Always think about overflow when summing user-provided variadics.

### Pitfall 5 — Spread Inside `Sprintf` Formatting

```go
nums := []int{1, 2, 3}
fmt.Sprintf("%v %v %v", nums) // prints "[1 2 3] %!v(MISSING) %!v(MISSING)"
fmt.Sprintf("%v %v %v", nums[0], nums[1], nums[2]) // works
fmt.Sprintf("%v %v %v", any(nums[0]), any(nums[1]), any(nums[2])) // verbose

// Or convert and spread:
args := make([]any, len(nums))
for i, n := range nums { args[i] = n }
fmt.Sprintf("%v %v %v", args...)
```

You cannot spread a typed slice into an `...any` parameter — Go does NOT auto-convert.

---

## 19. Common Mistakes

| Mistake | Fix |
|---------|-----|
| `inner(args)` instead of `inner(args...)` | Spread when forwarding |
| Spreading `[]int` into `...any` parameter | Manually convert each element to `any` |
| Treating spread as a copy | `append([]T(nil), s...)` |
| Using `...any` everywhere for "flexibility" | Use generics or typed slices |
| Combining literal args with spread | Build a combined slice first |
| Forgetting `len(args) > 0` check | Always handle zero args explicitly |

---

## 20. Common Misconceptions

**Misconception 1**: "Variadic is just syntactic sugar with no runtime difference."
**Truth**: Literal args force the compiler to construct a slice each call. For small lists this is stack-allocated, but `...any` always allocates per arg.

**Misconception 2**: "Spread is just passing arguments separately."
**Truth**: Spread passes the *same* slice — not separate values. The function receives one `[]T`, not N individual args.

**Misconception 3**: "I can spread an array."
**Truth**: Only slices can be spread. Convert with `arr[:]` first.

**Misconception 4**: "Passing too many args slows down `fmt.Println` significantly."
**Truth**: `fmt`'s allocation comes from interface boxing per arg, not from the variadic mechanism itself.

**Misconception 5**: "Variadic and `[]T` parameters are interchangeable in API design."
**Truth**: They have different ergonomics; pick based on the natural call site.

---

## 21. Tricky Points

1. `nil` slice passed via spread is indistinguishable from zero args at the receiver.
2. `[]any{1, "a", true}` cannot be passed via spread to a non-`...any` function.
3. The `errors.Join(nil, nil, nil) == nil` invariant relies on the function checking each arg.
4. Variadic + named results is fine; the slice param doesn't interact with naked returns.
5. The compiler may stack-allocate the implicit slice — this is observable via `-gcflags="-m"`.

---

## 22. Test

```go
package main

import (
    "reflect"
    "testing"
)

func collect(items ...int) []int {
    return append([]int(nil), items...) // defensive copy
}

func TestCollect(t *testing.T) {
    cases := []struct {
        in   []int
        want []int
    }{
        {nil, nil},
        {[]int{}, nil},
        {[]int{5}, []int{5}},
        {[]int{1, 2, 3}, []int{1, 2, 3}},
    }
    for _, c := range cases {
        got := collect(c.in...)
        if !reflect.DeepEqual(got, c.want) {
            t.Errorf("collect(%v) = %v; want %v", c.in, got, c.want)
        }
    }
}

func TestCollect_NoAliasing(t *testing.T) {
    s := []int{1, 2, 3}
    got := collect(s...)
    s[0] = 99
    if got[0] != 1 {
        t.Errorf("got was aliased: %v", got)
    }
}
```

---

## 23. Tricky Questions

**Q1**: What does this print?
```go
func touch(xs ...int) { xs[0] = -1 }

func main() {
    s := []int{1, 2, 3}
    touch(s...)
    touch(s...)
    fmt.Println(s)
}
```
**A**: `[-1 2 3]`. First call sets s[0] = -1; second call also sets s[0] = -1 (same value); s is mutated through aliasing.

**Q2**: Is this legal?
```go
func sum(xs ...int) int { return 0 }
func main() {
    sum(1, []int{2,3}...) // ?
}
```
**A**: **No**. You cannot mix individual args with spread in the same call. Build a combined slice first: `sum(append([]int{1}, []int{2,3}...)...)`.

**Q3**: What does this print?
```go
func describe(args ...any) {
    fmt.Println(len(args))
}

func main() {
    s := []int{1, 2, 3}
    describe(s)     // ?
    describe(s...)  // ?
}
```
**A**: First prints `1` (s is one any-typed argument). Second prints — **compile error**: `cannot use s (type []int) as type []any`. To spread you'd need `[]any{1, 2, 3}`.

---

## 24. Cheat Sheet

```go
// Declare:
func f(args ...T) {}

// Call with values:
f(a, b, c)

// Call with no args:
f()

// Spread an existing slice:
s := []T{...}
f(s...)

// Forward in a wrapper:
func wrap(args ...T) { inner(args...) }

// Defensive copy:
mine := append([]T(nil), args...)

// `errors.Join` style:
return errors.Join(errs...)

// `append` concat:
combined := append(a, b...)

// Generic variadic (Go 1.18+):
func Sum[T Number](xs ...T) T { ... }
```

---

## 25. Self-Assessment Checklist

- [ ] I can choose between `...T` and `[]T` based on caller ergonomics
- [ ] I know spread aliases the caller's backing array
- [ ] I know how to defensively copy (`append([]T(nil), s...)`)
- [ ] I correctly forward variadic args (`inner(args...)`)
- [ ] I avoid `...any` in hot paths
- [ ] I write generic variadics where appropriate
- [ ] I document aliasing and zero-args behavior
- [ ] I can explain why spread of `[]int` into `...any` fails

---

## 26. Summary

A variadic parameter `...T` is a slice parameter with two call-site sugars: literal args (compiler builds a fresh slice) and spread (caller's slice is aliased). Choose `...T` when callers naturally write individual values; choose `[]T` when callers always have a slice. The forwarding pattern `inner(args...)` is required to pass-through; without `...` you wrap the slice as a single argument. Avoid `...any` in hot paths because of per-arg interface boxing. Use generics for typed flexibility.

---

## 27. What You Can Build

- `printf`-style formatters with structured fields
- Functional-option constructors
- Error joiners
- Middleware composers
- Generic aggregators
- Multi-sink emitters

---

## 28. Further Reading

- [Go Spec — Passing arguments to ... parameters](https://go.dev/ref/spec#Passing_arguments_to_..._parameters)
- [`errors.Join` documentation](https://pkg.go.dev/errors#Join)
- [Dave Cheney — Functional options for friendly APIs](https://dave.cheney.net/2014/10/17/functional-options-for-friendly-apis)
- [`fmt` source code](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/fmt/print.go)
- [Generics tutorial](https://go.dev/doc/tutorial/generics)

---

## 29. Related Topics

- 2.6.1 Functions Basics
- 2.6.5 Closures (capture interactions)
- 2.6.7 Call by Value (slice header copy)
- 2.7.3 With Maps & Slices (aliasing details)
- `append` and `copy` built-ins
- `errors.Join`, `slices.Concat`

---

## 30. Diagrams & Visual Aids

### Spread vs Literal aliasing

```
LITERAL CALL:                      SPREAD CALL:
sum(1, 2, 3)                       sum(s...)
                                    
caller stack:                       caller stack:
  [hidden array: 1,2,3]               s = [hdr: ptr→array, len, cap]
       ↑                                       │
       └── slice hdr                            ↓
            ↓                          [array: 1,2,3]
       function receives                       ↑
       []int(local view)              function's xs hdr also points here
       
no aliasing                         FULL aliasing
```

### When to pick `...T` vs `[]T`

```mermaid
flowchart TD
    A[Designing API] --> B{Caller usually<br/>has individual<br/>values?}
    B -->|yes| C[Use ...T]
    B -->|no, has a slice| D[Use []T]
    B -->|either| E{0 args<br/>common?}
    E -->|yes| C
    E -->|no| D
```
