# Go Variadic Functions — Junior Level

## 1. Introduction

### What is it?
A **variadic function** accepts a flexible number of arguments — zero, one, or many — for its last parameter. The classic example is `fmt.Println`, which you can call with any number of values:

```go
fmt.Println()
fmt.Println("hi")
fmt.Println("hi", 42, true)
```

### How to use it?
Add `...` before the type of the **last** parameter:

```go
func sum(nums ...int) int {
    total := 0
    for _, n := range nums {
        total += n
    }
    return total
}
```

Now you can call:
```go
sum()              // 0
sum(1)             // 1
sum(1, 2, 3, 4)    // 10
```

---

## 2. Prerequisites
- Functions basics (2.6.1)
- Slices and `range` loop
- Basic understanding of `len()`

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| variadic | Function that takes a variable number of arguments |
| `...` (in declaration) | Marker that turns a parameter into a variadic |
| `...` (at call site) | Spread operator — unpacks a slice into individual args |
| variadic parameter | The last parameter, declared as `name ...T` |
| spread | Passing an existing slice via `s...` |
| element type | The `T` in `...T` — what each individual value is |
| slice argument | The single `[]T` value the function actually receives |

---

## 4. Core Concepts

### 4.1 The Variadic Parameter Becomes a Slice
Inside the function, the variadic parameter is just a `[]T`:

```go
func describe(nums ...int) {
    fmt.Println(len(nums), nums)
}

describe()           // 0 []
describe(1)          // 1 [1]
describe(1, 2, 3)    // 3 [1 2 3]
```

### 4.2 Only the Last Parameter Can Be Variadic
```go
// OK
func logf(level string, args ...any) { }

// COMPILE ERROR
// func bad(args ...any, suffix string) { }
```

### 4.3 Spreading an Existing Slice
If you already have a slice and want to pass it to a variadic function, use `...` at the call site:

```go
nums := []int{1, 2, 3, 4}
fmt.Println(sum(nums...)) // 10
// fmt.Println(sum(nums)) // ERROR: cannot pass []int as int
```

### 4.4 Spread Creates an Alias, Not a Copy
When you spread a slice, the function receives the **same** backing array. Changes inside the function are visible outside:

```go
func zero(xs ...int) {
    for i := range xs {
        xs[i] = 0
    }
}

s := []int{1, 2, 3}
zero(s...)
fmt.Println(s) // [0 0 0] — caller's slice was zeroed!
```

When you pass literal values, a fresh slice is built — no aliasing:

```go
zero(1, 2, 3) // nothing observable to the outside
```

---

## 5. Real-World Analogies

**A grocery checkout**: you may bring 0, 1, or 50 items. The cashier (the function) handles any quantity. You don't have to pre-package them — you put them on the belt one by one (literal args) or hand over your basket (spread `...`).

**A buffet**: pile your plate with 0 or more items. The chef doesn't care how many.

**Variadic = "however many you have"**.

---

## 6. Mental Models

```
Call site:                  Inside the function:
   sum()                    nums = []int(nil)         len 0
   sum(1)                   nums = []int{1}           len 1
   sum(1, 2, 3)             nums = []int{1, 2, 3}     len 3

   s := []int{1,2,3}
   sum(s...)                nums = s  (same backing array)
```

---

## 7. Pros & Cons

### Pros
- Caller-side flexibility: 0, 1, or many args
- Natural API for collections (`min(a, b, c)`, `append(s, 1, 2, 3)`)
- Works seamlessly with the spread operator for forwarding

### Cons
- Slight overhead: a slice is built each call (small, often stack-allocated)
- `...any` parameters force boxing → small allocations
- Easy to confuse the two `...` syntaxes (declaration vs spread)
- Aliasing in spread form can surprise unwary callers

---

## 8. Use Cases

1. Aggregators: `sum`, `max`, `concat`
2. Logging: `printf`-style functions
3. Constructors with optional configuration (functional options)
4. Middleware composition
5. Event emitters with arbitrary payload
6. SQL `IN (?, ?, ?)` clauses with N values

---

## 9. Code Examples

### Example 1 — Sum
```go
package main

import "fmt"

func sum(nums ...int) int {
    total := 0
    for _, n := range nums {
        total += n
    }
    return total
}

func main() {
    fmt.Println(sum())                    // 0
    fmt.Println(sum(10))                  // 10
    fmt.Println(sum(1, 2, 3, 4, 5))       // 15

    nums := []int{100, 200, 300}
    fmt.Println(sum(nums...))             // 600
}
```

### Example 2 — Max of Many
```go
package main

import "fmt"

func max(args ...int) int {
    if len(args) == 0 {
        return 0
    }
    best := args[0]
    for _, a := range args[1:] {
        if a > best {
            best = a
        }
    }
    return best
}

func main() {
    fmt.Println(max())          // 0
    fmt.Println(max(7))         // 7
    fmt.Println(max(3, 9, 2, 8, 5))  // 9
}
```

### Example 3 — Concatenate Strings
```go
package main

import (
    "fmt"
    "strings"
)

func join(parts ...string) string {
    return strings.Join(parts, "-")
}

func main() {
    fmt.Println(join())               // ""
    fmt.Println(join("hello"))        // "hello"
    fmt.Println(join("a", "b", "c"))  // "a-b-c"
}
```

### Example 4 — Required + Variadic
```go
package main

import "fmt"

func event(name string, tags ...string) {
    fmt.Printf("[%s] tags=%v\n", name, tags)
}

func main() {
    event("startup")
    event("login", "auth", "user")
    event("error", "critical", "auth", "db")
}
```

### Example 5 — Forwarding with Spread
```go
package main

import "fmt"

func wrapped(args ...any) {
    fmt.Println("received:", args)
}

func passthrough(args ...any) {
    wrapped(args...) // forward the args along
}

func main() {
    passthrough("a", 1, true)
}
```

### Example 6 — Spread an Existing Slice
```go
package main

import "fmt"

func sum(xs ...int) int {
    total := 0
    for _, x := range xs {
        total += x
    }
    return total
}

func main() {
    data := []int{2, 4, 6, 8, 10}
    fmt.Println(sum(data...)) // 30
}
```

### Example 7 — Append Is Itself Variadic
```go
package main

import "fmt"

func main() {
    a := []int{1, 2, 3}
    b := []int{4, 5, 6}

    a = append(a, 99)        // append literal: [1 2 3 99]
    a = append(a, b...)      // append spread:  [1 2 3 99 4 5 6]
    fmt.Println(a)
}
```

---

## 10. Coding Patterns

### Pattern 1 — Aggregator
```go
func avg(nums ...float64) float64 {
    if len(nums) == 0 {
        return 0
    }
    var total float64
    for _, n := range nums {
        total += n
    }
    return total / float64(len(nums))
}
```

### Pattern 2 — Configuration List (functional options)
```go
type Option func(*Server)

func WithAddr(a string) Option { return func(s *Server) { s.Addr = a } }
func WithPort(p int) Option    { return func(s *Server) { s.Port = p } }

func NewServer(opts ...Option) *Server {
    s := &Server{Addr: "localhost", Port: 8080}
    for _, opt := range opts {
        opt(s)
    }
    return s
}
```

### Pattern 3 — Logging Helper
```go
func debugf(format string, args ...any) {
    if !debugEnabled {
        return
    }
    fmt.Printf("[DEBUG] "+format+"\n", args...)
}
```

### Pattern 4 — SQL `IN` Clause
```go
func placeholders(n int) string {
    if n == 0 {
        return ""
    }
    return strings.Repeat("?,", n-1) + "?"
}

func userByIDs(ids ...int) (*sql.Rows, error) {
    args := make([]any, len(ids))
    for i, id := range ids {
        args[i] = id
    }
    q := "SELECT * FROM users WHERE id IN (" + placeholders(len(ids)) + ")"
    return db.Query(q, args...)
}
```

---

## 11. Clean Code Guidelines

1. **Use a variadic when the natural call site has 0 or many args.** If callers always pass exactly one slice, take a `[]T` instead.
2. **Document the empty-args case** ("returns 0 if called with no args") to avoid surprises.
3. **Avoid `...interface{}` / `...any` in hot paths** — boxing is expensive.
4. **Prefer named parameters** for non-variadic args: `event(name string, tags ...string)`, not `event(args ...string)` where the first is special.
5. **Don't combine** `...` declaration with too many other params; complex signatures hurt readability.

```go
// Good — clear intent:
func sum(nums ...int) int {}

// Bad — caller wonders if more variadic params would help:
func process(name string, base int, extras ...int, factor int) {} // illegal anyway
```

---

## 12. Product Use / Feature Example

**A flexible alerting helper**:

```go
package main

import "fmt"

type Alert struct {
    Title string
    Tags  []string
}

func sendAlert(title string, tags ...string) Alert {
    return Alert{Title: title, Tags: tags}
}

func main() {
    a1 := sendAlert("Disk full")                 // no tags
    a2 := sendAlert("Login failed", "auth")
    a3 := sendAlert("DB error", "critical", "db", "alert")

    fmt.Printf("%+v\n", a1)
    fmt.Printf("%+v\n", a2)
    fmt.Printf("%+v\n", a3)
}
```

The caller can pass as much detail as they have. The function never has to overload or take a slice manually.

---

## 13. Error Handling

A variadic function should still return errors when needed:

```go
func combineErrors(errs ...error) error {
    var msgs []string
    for _, e := range errs {
        if e != nil {
            msgs = append(msgs, e.Error())
        }
    }
    if len(msgs) == 0 {
        return nil
    }
    return fmt.Errorf("multiple errors: %s", strings.Join(msgs, "; "))
}
```

This pattern is used by libraries like `errors.Join` (Go 1.20+).

---

## 14. Security Considerations

1. **Bound the number of variadic args** if the caller is untrusted: a malicious caller could pass millions of values to exhaust memory.
2. **Never spread untrusted slices** without size checks: `f(huge...)` may overflow or thrash GC.
3. **`...any` accepts ANY type** — including `*Password`, `*os.File`, etc. Be explicit about what you log/serialize from variadic args.

```go
const maxTags = 100
func event(name string, tags ...string) {
    if len(tags) > maxTags {
        tags = tags[:maxTags]
    }
    // ...
}
```

---

## 15. Performance Tips

1. **Calling with zero args**: most cases are `nil` slice — no allocation.
2. **Calling with a few args**: the slice is usually built on the stack — near-zero cost.
3. **Calling with many args**: may allocate; consider passing a pre-built slice with `...`.
4. **Avoid `...any` in hot paths**: each non-pointer arg is boxed to interface — small allocations.
5. **Spread (`s...`) doesn't copy** — if you need an isolated copy, do `append([]int(nil), s...)` first.

---

## 16. Metrics & Analytics

```go
import "time"

type Span struct {
    Name string
    Tags []string
    Dur  time.Duration
}

func record(name string, dur time.Duration, tags ...string) Span {
    return Span{Name: name, Dur: dur, Tags: tags}
}
```

---

## 17. Best Practices

1. Always handle the zero-args case explicitly (think about it up front).
2. Use a typed variadic (`...int`, `...string`) instead of `...any` when possible.
3. Document whether the function may modify the spread slice.
4. Forward variadic params with `args...`; never re-build from individual elements.
5. Use `append([]T(nil), s...)` when you need to defensively copy a spread slice.

---

## 18. Edge Cases & Pitfalls

### Pitfall 1 — Confusing the Two `...` Syntaxes
```go
// In declaration: makes function variadic
func f(nums ...int) {}

// At call site: spreads a slice
nums := []int{1, 2, 3}
f(nums...)
```

### Pitfall 2 — Mixing Literal Args With Spread
```go
nums := []int{1, 2, 3}
// f(0, nums...) // COMPILE ERROR — must choose one form
// Workaround:
combined := append([]int{0}, nums...)
f(combined...)
```

### Pitfall 3 — Aliasing in Spread Form
```go
func zero(xs ...int) {
    for i := range xs {
        xs[i] = 0
    }
}

s := []int{1, 2, 3}
zero(s...)
fmt.Println(s) // [0 0 0] — surprising for first-time users
```

### Pitfall 4 — Variadic Parameter is `nil`, Not Empty
```go
func describe(xs ...int) {
    fmt.Println(xs == nil) // true when called with no args
}
describe()
```

### Pitfall 5 — Forgetting to Spread When Forwarding
```go
func inner(args ...any) { fmt.Println(args) }

func outer(args ...any) {
    inner(args)    // BUG: passes a single []any, becomes a one-element slice!
    inner(args...) // CORRECT: forwards each element
}
```

---

## 19. Common Mistakes

| Mistake | Fix |
|---------|-----|
| Variadic not last in param list | Make it last (the only legal place) |
| Mixing `f(0, s...)` | Build a combined slice first |
| Calling with `s` instead of `s...` | Add the spread operator |
| Forgetting `args...` when forwarding | Always forward variadic with `args...` |
| Treating spread as a copy | It's an alias — copy explicitly if needed |

---

## 20. Common Misconceptions

**Misconception 1**: "Variadic args are free / cost the same as regular args."
**Truth**: Each call typically constructs a small slice. For literal args this is often stack-allocated and near-free; for many args it may allocate.

**Misconception 2**: "Spread (`s...`) makes a copy."
**Truth**: Spread shares the same backing array. The callee can mutate the caller's data.

**Misconception 3**: "`...any` works just like overloading."
**Truth**: `...any` boxes every non-pointer value into an interface — small allocation overhead per arg.

**Misconception 4**: "I can have multiple variadic parameters."
**Truth**: Only one, and it must be the last parameter.

**Misconception 5**: "Calling a variadic with no args panics."
**Truth**: It receives a `nil` slice — perfectly valid; `len(nil) == 0`, ranging over it is a no-op.

---

## 21. Tricky Points

1. The variadic parameter's type is `[]T`, not `...T`. Use it like any other slice.
2. `s...` works only with a slice whose element type matches; no implicit conversion.
3. You CANNOT spread a slice into a non-variadic function: `nonVariadic(slice...)` is a compile error.
4. `append(dst, src...)` is the canonical use of spread.
5. Named return values + variadic params interact normally; nothing special.

---

## 22. Test

```go
package main

import "testing"

func sum(nums ...int) int {
    total := 0
    for _, n := range nums {
        total += n
    }
    return total
}

func TestSum(t *testing.T) {
    cases := []struct {
        in   []int
        want int
    }{
        {nil, 0},
        {[]int{}, 0},
        {[]int{5}, 5},
        {[]int{1, 2, 3}, 6},
        {[]int{-1, 1}, 0},
    }
    for _, c := range cases {
        if got := sum(c.in...); got != c.want {
            t.Errorf("sum(%v) = %d; want %d", c.in, got, c.want)
        }
    }
}
```

---

## 23. Tricky Questions

**Q1**: What does this print?
```go
func mod(xs ...int) { xs[0] = 100 }

func main() {
    s := []int{1, 2, 3}
    mod(s...)
    fmt.Println(s)
}
```
**A**: `[100 2 3]`. Spread form aliases the caller's backing array.

**Q2**: What does this print?
```go
func mod(xs ...int) { xs[0] = 100 }

func main() {
    mod(1, 2, 3)
    fmt.Println("done")
}
```
**A**: `done`. Literal args build a fresh slice — no observable side effect.

**Q3**: Why does this fail to compile?
```go
func sum(xs ...int) int { /* ... */ return 0 }
nums := []float64{1.0, 2.0}
sum(nums...) // ?
```
**A**: Spread requires the slice's element type to match exactly. `[]float64` vs `...int` — no implicit conversion.

---

## 24. Cheat Sheet

```go
// Declaration:
func f(args ...T) { } // args is []T inside f

// Call sites:
f()                   // 0 args
f(a)                  // 1 arg
f(a, b, c)            // 3 args

s := []T{a, b, c}
f(s...)               // spread; aliases s

// Forwarding:
func wrap(args ...T) { inner(args...) }

// Mixed required + variadic:
func ev(name string, tags ...string) { }
ev("start", "auth", "user")
```

---

## 25. Self-Assessment Checklist

- [ ] I can declare a variadic function
- [ ] I know the `...` declaration syntax goes BEFORE the type
- [ ] I can call with 0, 1, or many args
- [ ] I can spread a slice with `s...`
- [ ] I understand spread aliases the backing array
- [ ] I know the variadic param is `[]T` inside the function
- [ ] I can forward a variadic with `args...`
- [ ] I know `...any` causes per-arg boxing

---

## 26. Summary

A variadic function declares its last parameter with `...T` and accepts zero or more arguments. Inside the function, that parameter is `[]T`. Callers may pass individual arguments (the function builds a fresh slice) or spread an existing slice with `s...` (the function shares the backing array). Only the last parameter may be variadic, and you cannot mix literal args with `...` at the same call. Patterns include aggregators, format-style helpers, functional options, and forwarders.

---

## 27. What You Can Build

- `printf`-style helpers
- Aggregators (sum, max, average)
- Configurable constructors (functional options)
- Event emitters
- SQL parameterized query helpers
- Middleware chain builders

---

## 28. Further Reading

- [Effective Go — Variadic functions](https://go.dev/doc/effective_go#variadic_functions)
- [Go Spec — Passing arguments to ... parameters](https://go.dev/ref/spec#Passing_arguments_to_..._parameters)
- [Dave Cheney — Functional options](https://dave.cheney.net/2014/10/17/functional-options-for-friendly-apis)
- [`fmt.Println` source](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/fmt/print.go)

---

## 29. Related Topics

- 2.6.1 Functions Basics
- 2.6.4 Anonymous Functions
- 2.7.3 Pointers with Maps & Slices (aliasing details)
- `append` built-in (variadic itself)
- `errors.Join` (Go 1.20+ variadic error joiner)

---

## 30. Diagrams & Visual Aids

### Variadic argument flow

```mermaid
flowchart TD
    A[Caller: f a, b, c] --> B[Compiler builds []T{a, b, c}]
    B --> C[Function receives []T parameter]
    C --> D[Iterate / index like any slice]

    E[Caller: f s...] --> F[Pass s's slice header directly]
    F --> G[Function aliases s's backing array]
    G --> D
```

### `...` two meanings

```
DECLARATION             CALL
   func f(x ...T)          f(s...)
   makes f variadic        spreads slice s as args
```
