# Go Variadic Functions — Tasks

## Instructions

Each task includes a description, starter code, expected output, and an evaluation checklist. Use idiomatic variadic patterns; spread when forwarding; defensively copy when storing.

---

## Task 1 — `sumOf` Variadic

**Difficulty**: Beginner
**Topic**: Basic variadic declaration

**Description**: Write `sumOf(nums ...int) int` that returns the sum of its arguments. Must handle the zero-args case.

**Starter Code**:
```go
package main

import "fmt"

func sumOf(nums ...int) int {
    // TODO
    return 0
}

func main() {
    fmt.Println(sumOf())
    fmt.Println(sumOf(5))
    fmt.Println(sumOf(1, 2, 3, 4, 5))
    s := []int{10, 20, 30}
    fmt.Println(sumOf(s...))
}
```

**Expected Output**:
```
0
5
15
60
```

**Evaluation Checklist**:
- [ ] Parameter declared with `...int`
- [ ] Iterates with `range`
- [ ] Zero args returns 0
- [ ] Spread of an existing slice works

---

## Task 2 — `maxOf` With Generics

**Difficulty**: Beginner
**Topic**: Generic variadic (Go 1.18+)

**Description**: Write a generic `MaxOf[T cmp.Ordered](xs ...T) T` that returns the largest element. If called with no args, return the zero value of `T`.

**Starter Code**:
```go
package main

import (
    "cmp"
    "fmt"
)

func MaxOf[T cmp.Ordered](xs ...T) T {
    // TODO
    var zero T
    return zero
}

func main() {
    fmt.Println(MaxOf[int]())                 // 0
    fmt.Println(MaxOf(3, 7, 1, 5))            // 7
    fmt.Println(MaxOf("apple", "cherry", "banana")) // cherry
    fmt.Println(MaxOf(1.5, 2.5, 0.5))         // 2.5
}
```

**Expected Output**:
```
0
7
cherry
2.5
```

**Evaluation Checklist**:
- [ ] Single generic function works for int, string, float
- [ ] Empty args returns zero value
- [ ] Uses `cmp.Ordered` constraint (Go 1.21+)
- [ ] Does not use any external libs

---

## Task 3 — `joinWith` Custom Separator

**Difficulty**: Beginner
**Topic**: Variadic + format function pattern

**Description**: Write `joinWith(sep string, parts ...string) string` that joins `parts` with `sep`. Must work with 0, 1, or many parts. Implement without using `strings.Join`.

**Starter Code**:
```go
package main

import "fmt"

func joinWith(sep string, parts ...string) string {
    // TODO
    return ""
}

func main() {
    fmt.Printf("%q\n", joinWith(", "))
    fmt.Printf("%q\n", joinWith(", ", "alone"))
    fmt.Printf("%q\n", joinWith(", ", "a", "b", "c"))
    fmt.Printf("%q\n", joinWith(" -> ", "start", "middle", "end"))
}
```

**Expected Output**:
```
""
"alone"
"a, b, c"
"start -> middle -> end"
```

**Evaluation Checklist**:
- [ ] Empty `parts` returns empty string
- [ ] Single part returns the part itself (no separator)
- [ ] No trailing separator
- [ ] No use of `strings.Join` (write the logic yourself)

---

## Task 4 — `tracef` Wrapper Around `fmt.Printf`

**Difficulty**: Intermediate
**Topic**: Forwarding variadic with spread

**Description**: Implement `tracef(prefix, format string, args ...any)` that prints `[<prefix>] <formatted>` using `fmt.Printf`. The function must correctly forward `args`.

**Starter Code**:
```go
package main

import "fmt"

func tracef(prefix, format string, args ...any) {
    // TODO: forward args to fmt.Printf correctly
}

func main() {
    tracef("DB", "query %q took %dms\n", "SELECT 1", 12)
    tracef("HTTP", "%s %s -> %d\n", "GET", "/users", 200)
    tracef("INFO", "no args needed\n")
}
```

**Expected Output**:
```
[DB] query "SELECT 1" took 12ms
[HTTP] GET /users -> 200
[INFO] no args needed
```

**Evaluation Checklist**:
- [ ] Uses `args...` to forward (NOT `args`)
- [ ] Prefix appears in brackets at the start
- [ ] Works with zero `args`
- [ ] Format string concatenation correct

---

## Task 5 — `errors.Join` Imitation

**Difficulty**: Intermediate
**Topic**: Variadic of `error`, nil filtering

**Description**: Implement `joinErrors(errs ...error) error` that returns:
- `nil` if all inputs are nil or no inputs.
- The single error if exactly one is non-nil.
- A joined error formatted as `error1; error2; error3` if multiple are non-nil.

**Starter Code**:
```go
package main

import (
    "errors"
    "fmt"
    "strings"
)

func joinErrors(errs ...error) error {
    // TODO
    return nil
}

func main() {
    fmt.Println(joinErrors())
    fmt.Println(joinErrors(nil, nil))
    fmt.Println(joinErrors(errors.New("only one")))
    fmt.Println(joinErrors(nil, errors.New("a"), nil, errors.New("b")))
}
```

**Expected Output**:
```
<nil>
<nil>
only one
a; b
```

**Evaluation Checklist**:
- [ ] All-nil or empty returns nil (not a wrapped nil error)
- [ ] Single non-nil returns it directly (not wrapped in joined format)
- [ ] Multiple non-nil joins with `; ` separator
- [ ] Filters out nil errors before joining
- [ ] Uses `strings.Join` or similar

---

## Task 6 — Spread vs Literal Demonstration

**Difficulty**: Intermediate
**Topic**: Aliasing in spread form

**Description**: Implement two functions: `noAlias(items ...int) []int` returns an independent copy of items; `withAlias(items ...int) []int` returns the slice as-is. In `main`, demonstrate the difference by mutating the original slice and observing both returned slices.

**Starter Code**:
```go
package main

import "fmt"

func noAlias(items ...int) []int {
    // TODO: defensive copy
    return nil
}

func withAlias(items ...int) []int {
    // TODO: just return items
    return items
}

func main() {
    s := []int{1, 2, 3}
    a := noAlias(s...)
    b := withAlias(s...)

    s[0] = 99
    fmt.Println("original:", s)
    fmt.Println("noAlias:", a)
    fmt.Println("withAlias:", b)
}
```

**Expected Output**:
```
original: [99 2 3]
noAlias: [1 2 3]
withAlias: [99 2 3]
```

**Evaluation Checklist**:
- [ ] `noAlias` returns a slice with an independent backing array
- [ ] `withAlias` returns a slice that aliases the caller's
- [ ] `noAlias` uses `append([]int(nil), items...)` or equivalent
- [ ] Mutation of `s` is visible to `b` but not `a`

---

## Task 7 — Functional Options for `Server`

**Difficulty**: Intermediate
**Topic**: Variadic of `Option` functions

**Description**: Implement a `Server` config with `Addr`, `Port`, `Timeout`, `MaxConn` fields. Provide `WithX` options for each, plus a constructor `NewServer(opts ...Option)` with sensible defaults.

**Starter Code**:
```go
package main

import (
    "fmt"
    "time"
)

type Server struct {
    Addr    string
    Port    int
    Timeout time.Duration
    MaxConn int
}

type Option func(*Server)

// TODO: WithAddr, WithPort, WithTimeout, WithMaxConn

func NewServer(opts ...Option) *Server {
    // TODO: defaults + apply opts
    return nil
}

func main() {
    s1 := NewServer()
    s2 := NewServer(WithPort(9000), WithMaxConn(500))
    s3 := NewServer(
        WithAddr("0.0.0.0"),
        WithPort(443),
        WithTimeout(15*time.Second),
        WithMaxConn(1000),
    )
    fmt.Printf("%+v\n", s1)
    fmt.Printf("%+v\n", s2)
    fmt.Printf("%+v\n", s3)
}
```

**Expected Output** (defaults: Addr="localhost", Port=8080, Timeout=30s, MaxConn=100):
```
&{Addr:localhost Port:8080 Timeout:30s MaxConn:100}
&{Addr:localhost Port:9000 Timeout:30s MaxConn:500}
&{Addr:0.0.0.0 Port:443 Timeout:15s MaxConn:1000}
```

**Evaluation Checklist**:
- [ ] Each `WithX` returns an `Option`
- [ ] Defaults applied before opts
- [ ] Opts applied in given order
- [ ] No `Option` mutates anything global

---

## Task 8 — `concat` of Multiple Slices

**Difficulty**: Intermediate
**Topic**: Variadic of slice, capacity pre-allocation

**Description**: Implement `concat(groups ...[]int) []int` that concatenates multiple slices. Must pre-allocate the output slice with the correct total capacity to avoid append reallocations.

**Starter Code**:
```go
package main

import "fmt"

func concat(groups ...[]int) []int {
    // TODO: pre-allocate, then fill
    return nil
}

func main() {
    a := []int{1, 2, 3}
    b := []int{4, 5}
    c := []int{}
    d := []int{6, 7, 8, 9}

    fmt.Println(concat())
    fmt.Println(concat(a))
    fmt.Println(concat(a, b, c, d))
}
```

**Expected Output**:
```
[]
[1 2 3]
[1 2 3 4 5 6 7 8 9]
```

**Evaluation Checklist**:
- [ ] Pre-counts total length first, then allocates
- [ ] Works with zero groups (returns empty slice)
- [ ] Works with single group
- [ ] No more than ONE allocation for the result
- [ ] Result is independent (no aliasing with inputs)

---

## Task 9 — Spread to a `func(...any)`

**Difficulty**: Advanced
**Topic**: Type conversion for spread; `[]int` cannot spread into `...any`

**Description**: Write `printAll(prefix string, args ...any)` that prints each arg on its own line prefixed. Then write a helper `printInts(prefix string, nums []int)` that internally calls `printAll` with the nums spread — the trick is that you cannot spread `[]int` directly into `...any`.

**Starter Code**:
```go
package main

import "fmt"

func printAll(prefix string, args ...any) {
    for _, a := range args {
        fmt.Println(prefix, a)
    }
}

func printInts(prefix string, nums []int) {
    // TODO: convert nums to []any, then spread
}

func main() {
    printInts(">", []int{10, 20, 30})
}
```

**Expected Output**:
```
> 10
> 20
> 30
```

**Evaluation Checklist**:
- [ ] Demonstrates manual conversion `[]int → []any`
- [ ] Uses `printAll(prefix, anys...)` correctly
- [ ] Result matches expected output

---

## Task 10 — Bound Variadic for Safety

**Difficulty**: Advanced
**Topic**: Defensive limits on caller-provided variadic

**Description**: Implement `processSafely(maxItems int, items ...int) []int` that processes up to `maxItems` items (truncating extras) and returns the doubled values. The function should NOT mutate the caller's input.

**Starter Code**:
```go
package main

import "fmt"

func processSafely(maxItems int, items ...int) []int {
    // TODO
    return nil
}

func main() {
    s := []int{1, 2, 3, 4, 5, 6, 7}
    out := processSafely(3, s...)
    fmt.Println("output:", out)
    fmt.Println("input unchanged:", s)
    fmt.Println(processSafely(10))
}
```

**Expected Output**:
```
output: [2 4 6]
input unchanged: [1 2 3 4 5 6 7]
```
(Followed by `[]` from the empty call.)

```
[]
```

**Evaluation Checklist**:
- [ ] Truncates to `maxItems` if `len(items) > maxItems`
- [ ] Result is in a NEW slice (no aliasing)
- [ ] Caller's slice is NOT mutated
- [ ] Returns nil/empty for zero items

---

## Bonus Task — Variadic Pipeline

**Difficulty**: Advanced
**Topic**: Variadic of function values, composition

**Description**: Implement `pipeline(input string, steps ...func(string) string) string` that applies each `step` in order, threading the output of one to the input of the next. Empty steps returns input unchanged.

**Starter Code**:
```go
package main

import (
    "fmt"
    "strings"
)

func pipeline(input string, steps ...func(string) string) string {
    // TODO
    return input
}

func main() {
    upper := func(s string) string { return strings.ToUpper(s) }
    trim  := func(s string) string { return strings.TrimSpace(s) }
    excl  := func(s string) string { return s + "!" }

    fmt.Println(pipeline("  hello world  "))                  // "  hello world  "
    fmt.Println(pipeline("  hello world  ", trim))            // "hello world"
    fmt.Println(pipeline("  hello world  ", trim, upper))     // "HELLO WORLD"
    fmt.Println(pipeline("  hello world  ", trim, upper, excl)) // "HELLO WORLD!"
}
```

**Expected Output**:
```
  hello world  
hello world
HELLO WORLD
HELLO WORLD!
```

**Evaluation Checklist**:
- [ ] Steps are applied in left-to-right order
- [ ] Zero steps returns input unchanged
- [ ] Each step receives the previous step's output
- [ ] No allocations beyond the strings the steps themselves return
