# Go Anonymous Functions — Tasks

## Instructions

Each task includes a description, starter code, expected output, and an evaluation checklist. Use anonymous functions where natural; extract to named functions when bodies grow long.

---

## Task 1 — Sort Comparator

**Difficulty**: Beginner
**Topic**: Anonymous function as `sort.Slice` argument

**Description**: Sort a slice of `Person{Name, Age}` by Age ascending, using `sort.Slice` and an inline comparator.

**Starter Code**:
```go
package main

import (
    "fmt"
    "sort"
)

type Person struct {
    Name string
    Age  int
}

func main() {
    people := []Person{{"Charlie", 30}, {"Alice", 25}, {"Bob", 22}}
    // TODO: sort.Slice with anonymous comparator
    fmt.Println(people)
}
```

**Expected Output**:
```
[{Bob 22} {Alice 25} {Charlie 30}]
```

**Evaluation Checklist**:
- [ ] Uses `sort.Slice`
- [ ] Comparator is anonymous (inline)
- [ ] Returns `people[i].Age < people[j].Age`

---

## Task 2 — IIFE for Scoped Init

**Difficulty**: Beginner
**Topic**: Immediately-Invoked Function Expression

**Description**: Compute the maximum of three integers using an IIFE that returns the result. Don't define a separate function.

**Starter Code**:
```go
package main

import "fmt"

func main() {
    a, b, c := 5, 12, 7
    max := func(x, y, z int) int {
        // TODO: compute max
        return 0
    }(a, b, c)
    fmt.Println(max)
}
```

**Expected Output**:
```
12
```

**Evaluation Checklist**:
- [ ] Uses an IIFE (function literal followed by `()`)
- [ ] Computes max correctly for any 3 ints
- [ ] Result is bound to `max` outside

---

## Task 3 — Defer With Recover

**Difficulty**: Beginner
**Topic**: Anonymous function in defer

**Description**: Write `safeDivide(a, b int) (int, error)` that uses `a/b` inside the function; if a panic occurs, recover and return the panic message as an error.

**Starter Code**:
```go
package main

import "fmt"

func safeDivide(a, b int) (result int, err error) {
    defer func() {
        // TODO: recover and set err
    }()
    return a / b, nil
}

func main() {
    r, err := safeDivide(10, 2)
    fmt.Println(r, err)
    r, err = safeDivide(10, 0)
    fmt.Println(r, err)
}
```

**Expected Output**:
```
5 <nil>
0 recovered: runtime error: integer divide by zero
```

**Evaluation Checklist**:
- [ ] Uses `defer func() {...}()` with `recover()`
- [ ] Sets `err` (named return) when panic occurs
- [ ] Returns `(a/b, nil)` for valid input

---

## Task 4 — Goroutine With Argument

**Difficulty**: Beginner
**Topic**: Pass loop variable as goroutine argument

**Description**: Spawn 5 goroutines that each print their index. Use `sync.WaitGroup` and pass the index as an argument (don't rely on capture).

**Starter Code**:
```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        // TODO: go func(...) { ... }(i)
    }
    wg.Wait()
}
```

**Expected Output** (any order):
```
goroutine 0
goroutine 1
goroutine 2
goroutine 3
goroutine 4
```

**Evaluation Checklist**:
- [ ] Uses `go func(i int) { ... }(i)` form
- [ ] Calls `wg.Done()` (preferably with `defer`)
- [ ] No race condition on `i`
- [ ] `wg.Wait()` blocks until all done

---

## Task 5 — Higher-Order Filter

**Difficulty**: Intermediate
**Topic**: Anonymous predicate

**Description**: Implement `filter[T any](xs []T, keep func(T) bool) []T`. Use it to filter even numbers and short strings.

**Starter Code**:
```go
package main

import "fmt"

func filter[T any](xs []T, keep func(T) bool) []T {
    // TODO
    return nil
}

func main() {
    evens := filter([]int{1, 2, 3, 4, 5, 6}, func(n int) bool {
        return n%2 == 0
    })
    fmt.Println(evens)

    short := filter([]string{"a", "bbb", "cc", "ddd"}, func(s string) bool {
        return len(s) <= 2
    })
    fmt.Println(short)
}
```

**Expected Output**:
```
[2 4 6]
[a cc]
```

**Evaluation Checklist**:
- [ ] Generic over `T`
- [ ] Pre-allocates output slice (efficient)
- [ ] Uses anonymous predicate at call site
- [ ] Works with int and string

---

## Task 6 — Decorator Pattern

**Difficulty**: Intermediate
**Topic**: Function literal returning a wrapped function

**Description**: Implement `timed(label string, fn func()) func()` that returns a function which, when called, runs `fn` and prints how long it took.

**Starter Code**:
```go
package main

import (
    "fmt"
    "time"
)

func timed(label string, fn func()) func() {
    // TODO: return a function that wraps fn with timing
    return nil
}

func main() {
    work := func() {
        time.Sleep(50 * time.Millisecond)
    }
    timedWork := timed("work", work)
    timedWork()
    timedWork()
}
```

**Expected Output** (timings vary):
```
[work] 50ms
[work] 50ms
```

**Evaluation Checklist**:
- [ ] `timed` returns a function
- [ ] The returned function records start, calls fn, prints duration
- [ ] Captures `label` and `fn`
- [ ] Can be called multiple times

---

## Task 7 — Functional Options

**Difficulty**: Intermediate
**Topic**: Anonymous functions as configuration

**Description**: Implement a `Server` config with `Addr`, `Port`, `Timeout`. Provide `WithX` options as functions that mutate `*Server`. The constructor `NewServer(opts ...func(*Server)) *Server` applies them.

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
}

func NewServer(opts ...func(*Server)) *Server {
    s := &Server{Addr: "localhost", Port: 8080, Timeout: 30 * time.Second}
    // TODO
    return s
}

func WithAddr(a string) func(*Server)       { return func(s *Server) { s.Addr = a } }
func WithPort(p int) func(*Server)          { return func(s *Server) { s.Port = p } }
func WithTimeout(d time.Duration) func(*Server) { return func(s *Server) { s.Timeout = d } }

func main() {
    s := NewServer(WithPort(9000), WithTimeout(5*time.Second))
    fmt.Printf("%+v\n", s)
}
```

**Expected Output**:
```
&{Addr:localhost Port:9000 Timeout:5s}
```

**Evaluation Checklist**:
- [ ] Each `WithX` returns a function value
- [ ] Constructor applies opts in order
- [ ] Defaults are applied first
- [ ] Anonymous function used inside each `WithX`

---

## Task 8 — Recursive Anonymous Function

**Difficulty**: Intermediate
**Topic**: The recursion-by-name workaround

**Description**: Compute factorial using a recursive anonymous function (declared via `var ... func`).

**Starter Code**:
```go
package main

import "fmt"

func main() {
    var fact func(int) int
    // TODO: assign fact to a recursive anonymous function

    for i := 0; i <= 6; i++ {
        fmt.Printf("%d! = %d\n", i, fact(i))
    }
}
```

**Expected Output**:
```
0! = 1
1! = 1
2! = 2
3! = 6
4! = 24
5! = 120
6! = 720
```

**Evaluation Checklist**:
- [ ] Uses `var fact func(int) int` then `fact = func(...){...}`
- [ ] Base case: `n <= 1 returns 1`
- [ ] Recursive case: `n * fact(n-1)`

---

## Task 9 — Pipeline of Functions

**Difficulty**: Advanced
**Topic**: Slice of function values

**Description**: Implement `pipeline(input string, steps ...func(string) string) string` that threads input through each step. Define steps as anonymous functions in main.

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
    out := pipeline("  Hello World  ",
        strings.TrimSpace,
        strings.ToLower,
        func(s string) string { return strings.ReplaceAll(s, " ", "-") },
    )
    fmt.Println(out)
}
```

**Expected Output**:
```
hello-world
```

**Evaluation Checklist**:
- [ ] Variadic of `func(string) string`
- [ ] Threads result of each step into next
- [ ] Mixes named (`strings.TrimSpace`) and anonymous functions
- [ ] Empty steps returns input unchanged

---

## Task 10 — Memoization Helper

**Difficulty**: Advanced
**Topic**: Closure with map state

**Description**: Implement `memoize(fn func(int) int) func(int) int` that caches results. Use it on a slow Fibonacci function and verify only one computation happens per unique input.

**Starter Code**:
```go
package main

import "fmt"

var calls int

func slowFib(n int) int {
    calls++
    if n < 2 {
        return n
    }
    return slowFib(n-1) + slowFib(n-2)
}

func memoize(fn func(int) int) func(int) int {
    // TODO: closure with cache
    return nil
}

func main() {
    fast := memoize(slowFib)
    for i := 0; i < 10; i++ {
        _ = fast(i)
    }
    fmt.Println("call count:", calls)

    // Without memoize:
    calls = 0
    for i := 0; i < 10; i++ {
        _ = slowFib(i)
    }
    fmt.Println("non-memoized:", calls)
}
```

**Expected Output** (approximate):
```
call count: 10
non-memoized: 177
```

(Memoization caches each top-level result; slowFib internally still recurses uncached. To memoize the recursion too, you'd need a mutually-recursive structure.)

**Evaluation Checklist**:
- [ ] Captures a `map[int]int` cache
- [ ] On cache hit, returns cached value
- [ ] On miss, calls fn, caches result, returns
- [ ] `memoize` returns a closure of correct signature

---

## Bonus Task — IIFE for Conditional Expression

**Difficulty**: Advanced
**Topic**: IIFE replacing missing ternary

**Description**: Go has no ternary `cond ? a : b`. Write an IIFE that returns `"big"` if `n > 100` else `"small"`. Compare with using a regular `if/else` block.

**Starter Code**:
```go
package main

import "fmt"

func main() {
    n := 42
    // TODO: use IIFE to assign label
    var label string
    label = ""
    fmt.Println(label)
}
```

**Expected Output**:
```
small
```

**Evaluation Checklist**:
- [ ] IIFE returns "big" or "small" based on n
- [ ] No separate named function
- [ ] Result assigned to `label`
- [ ] Discusses (in a comment) why a regular if/else is usually better

```go
// IIFE version:
label := func() string {
    if n > 100 {
        return "big"
    }
    return "small"
}()

// Plain if/else version (preferred for readability):
var label string
if n > 100 {
    label = "big"
} else {
    label = "small"
}
```

The IIFE has the advantage of returning a value (assignable in one expression) but adds a layer of indirection. Use sparingly.
