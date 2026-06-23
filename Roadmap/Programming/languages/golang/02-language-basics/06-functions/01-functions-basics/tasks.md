# Go Functions Basics — Tasks

## Instructions

Each task includes a description, starter code, expected output, and an evaluation checklist. Implement the solution as a regular Go function unless the task specifies otherwise.

---

## Task 1 — Greeting

**Difficulty**: Beginner
**Topic**: Function declaration, single param, single return

**Description**: Write `greet(name string) string` that returns the string `"Hello, <name>!"`.

**Starter Code**:
```go
package main

import "fmt"

func greet(name string) string {
    // TODO
    return ""
}

func main() {
    fmt.Println(greet("Ada"))
    fmt.Println(greet("Linus"))
}
```

**Expected Output**:
```
Hello, Ada!
Hello, Linus!
```

**Evaluation Checklist**:
- [ ] Function signature matches `func greet(name string) string`
- [ ] Uses string concatenation or `fmt.Sprintf`
- [ ] Returns the exact format `"Hello, <name>!"`

---

## Task 2 — Min of Three

**Difficulty**: Beginner
**Topic**: Multiple parameters, conditional logic, single return

**Description**: Write `min3(a, b, c int) int` that returns the smallest of three integers.

**Starter Code**:
```go
package main

import "fmt"

func min3(a, b, c int) int {
    // TODO
    return 0
}

func main() {
    fmt.Println(min3(5, 2, 8))   // 2
    fmt.Println(min3(-1, -3, 0)) // -3
    fmt.Println(min3(7, 7, 7))   // 7
}
```

**Expected Output**:
```
2
-3
7
```

**Evaluation Checklist**:
- [ ] Correct for all-positive, all-negative, and equal-value inputs
- [ ] Does not import external libraries
- [ ] Returns an `int`, not a different numeric type

---

## Task 3 — Boolean Predicate: `isPalindrome`

**Difficulty**: Beginner
**Topic**: Functions returning bool, basic loop, string handling

**Description**: Write `isPalindrome(s string) bool` that returns true if `s` reads the same forward and backward (treat empty string as a palindrome).

**Starter Code**:
```go
package main

import "fmt"

func isPalindrome(s string) bool {
    // TODO
    return false
}

func main() {
    fmt.Println(isPalindrome(""))         // true
    fmt.Println(isPalindrome("a"))        // true
    fmt.Println(isPalindrome("racecar"))  // true
    fmt.Println(isPalindrome("hello"))    // false
    fmt.Println(isPalindrome("madam"))    // true
}
```

**Expected Output**:
```
true
true
true
false
true
```

**Evaluation Checklist**:
- [ ] Handles the empty string and single-character strings
- [ ] Works on ASCII (extra credit: handle Unicode by converting to `[]rune` first)
- [ ] No allocation beyond what `[]rune(s)` requires

---

## Task 4 — Function Used as Argument: `applyTwice`

**Difficulty**: Beginner
**Topic**: Higher-order function, function value as parameter

**Description**: Write `applyTwice(fn func(int) int, x int) int` that returns `fn(fn(x))`.

**Starter Code**:
```go
package main

import "fmt"

func applyTwice(fn func(int) int, x int) int {
    // TODO
    return 0
}

func main() {
    inc := func(n int) int { return n + 1 }
    sq  := func(n int) int { return n * n }
    fmt.Println(applyTwice(inc, 5)) // 7
    fmt.Println(applyTwice(sq, 3))  // 81
}
```

**Expected Output**:
```
7
81
```

**Evaluation Checklist**:
- [ ] Calls `fn` exactly twice
- [ ] Works with any `func(int) int` value
- [ ] Returns the second application's result

---

## Task 5 — Build a Lookup Table of Operations

**Difficulty**: Intermediate
**Topic**: Function values stored in a map, registry pattern

**Description**: Build a map `ops` from operator strings (`"+"`, `"-"`, `"*"`, `"/"`) to functions of type `func(int, int) int`. Then write `calc(op string, a, b int) (int, error)` that looks up `op`, returns the result, or an error if `op` is unknown or division by zero.

**Starter Code**:
```go
package main

import (
    "errors"
    "fmt"
)

var ops = map[string]func(int, int) int{
    // TODO: fill in +, -, *, /
}

func calc(op string, a, b int) (int, error) {
    // TODO
    return 0, errors.New("not implemented")
}

func main() {
    for _, op := range []string{"+", "-", "*", "/", "%"} {
        if r, err := calc(op, 12, 4); err != nil {
            fmt.Printf("%s -> error: %v\n", op, err)
        } else {
            fmt.Printf("12 %s 4 = %d\n", op, r)
        }
    }
    if _, err := calc("/", 10, 0); err != nil {
        fmt.Println("divide by zero:", err)
    }
}
```

**Expected Output**:
```
12 + 4 = 16
12 - 4 = 8
12 * 4 = 48
12 / 4 = 3
% -> error: unknown op "%"
divide by zero: division by zero
```

**Evaluation Checklist**:
- [ ] Map has exactly four entries
- [ ] `calc` returns a clear error for unknown operators
- [ ] `calc` returns a separate error for division by zero, BEFORE calling the division function
- [ ] No panics on any input

---

## Task 6 — Functional Options Pattern

**Difficulty**: Intermediate
**Topic**: Variadic function-typed parameters, configuration pattern

**Description**: Implement a `Server` configuration constructor using the functional options pattern. Provide three options: `WithAddr(string)`, `WithTimeout(time.Duration)`, and `WithMaxConn(int)`. Defaults: addr=":8080", timeout=30s, maxConn=100.

**Starter Code**:
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

// TODO: WithAddr, WithTimeout, WithMaxConn

func NewServer(opts ...Option) *Server {
    // TODO: defaults + apply opts
    return nil
}

func main() {
    s1 := NewServer()
    s2 := NewServer(WithAddr(":9000"))
    s3 := NewServer(WithAddr(":7000"), WithTimeout(5*time.Second), WithMaxConn(500))
    fmt.Printf("s1: %+v\n", s1)
    fmt.Printf("s2: %+v\n", s2)
    fmt.Printf("s3: %+v\n", s3)
}
```

**Expected Output**:
```
s1: &{Addr::8080 Timeout:30s MaxConn:100}
s2: &{Addr::9000 Timeout:30s MaxConn:100}
s3: &{Addr::7000 Timeout:5s MaxConn:500}
```

**Evaluation Checklist**:
- [ ] Each `WithX` returns an `Option` value
- [ ] Defaults applied before any option
- [ ] Options are applied in the order they are passed
- [ ] No options → all defaults

---

## Task 7 — Method Value vs Method Expression

**Difficulty**: Intermediate
**Topic**: Method binding, closures over receivers

**Description**: Given the `Counter` type below, demonstrate the difference between a method value and a method expression by writing two helpers: `bumpN(c *Counter, n int)` using a method value, and `bumpExprN(n int)` returning a function that bumps any `*Counter` n times using a method expression.

**Starter Code**:
```go
package main

import "fmt"

type Counter struct{ n int }

func (c *Counter) Inc() { c.n++ }

func bumpN(c *Counter, n int) {
    // TODO: use a method VALUE bound to c
}

func bumpExprN(n int) func(*Counter) {
    // TODO: use a method EXPRESSION
    return nil
}

func main() {
    c1 := &Counter{}
    bumpN(c1, 5)
    fmt.Println(c1.n) // 5

    bump3 := bumpExprN(3)
    c2 := &Counter{}
    bump3(c2)
    fmt.Println(c2.n) // 3
}
```

**Expected Output**:
```
5
3
```

**Evaluation Checklist**:
- [ ] `bumpN` uses `c.Inc` as a method value
- [ ] `bumpExprN` uses `(*Counter).Inc` as a method expression
- [ ] Both behave correctly for n=0
- [ ] No global state

---

## Task 8 — Retry Helper

**Difficulty**: Intermediate
**Topic**: Higher-order function, errors, backoff

**Description**: Implement `retry(attempts int, sleep time.Duration, fn func() error) error` that calls `fn`. On error, sleeps and retries up to `attempts` times. Returns the LAST error wrapped via `fmt.Errorf("after %d attempts: %w", attempts, err)`. Returns nil on first success.

**Starter Code**:
```go
package main

import (
    "errors"
    "fmt"
    "time"
)

func retry(attempts int, sleep time.Duration, fn func() error) error {
    // TODO
    return nil
}

var calls int
func flakey() error {
    calls++
    if calls < 3 {
        return errors.New("flake")
    }
    return nil
}

func main() {
    err := retry(5, 5*time.Millisecond, flakey)
    fmt.Println("err:", err, "calls:", calls)
}
```

**Expected Output**:
```
err: <nil> calls: 3
```

**Evaluation Checklist**:
- [ ] Calls `fn` at most `attempts` times
- [ ] Returns nil immediately on success (no extra calls)
- [ ] Wraps the last error with `%w` so `errors.Is` works
- [ ] Sleeps between attempts, not after the final one (extra credit)

---

## Task 9 — Compose Functions

**Difficulty**: Intermediate
**Topic**: Function composition, returning functions

**Description**: Write `compose(fs ...func(int) int) func(int) int` that returns a function applying each `f` in order: `compose(f, g, h)(x)` should return `h(g(f(x)))`.

**Starter Code**:
```go
package main

import "fmt"

func compose(fs ...func(int) int) func(int) int {
    // TODO
    return nil
}

func main() {
    inc := func(n int) int { return n + 1 }
    dbl := func(n int) int { return n * 2 }
    sq  := func(n int) int { return n * n }

    pipeline := compose(inc, dbl, sq)
    fmt.Println(pipeline(3))  // ((3+1)*2)^2 = 64
}
```

**Expected Output**:
```
64
```

**Evaluation Checklist**:
- [ ] `compose()` (zero args) returns the identity function
- [ ] Functions applied in left-to-right order
- [ ] Returned function works for any number of integers
- [ ] No allocations beyond the closure itself per `compose` call

---

## Task 10 — Test-Doubles via Function Fields

**Difficulty**: Advanced
**Topic**: Function-typed struct fields, dependency injection for tests

**Description**: Build a `RateLimiter` struct that has a `Now func() time.Time` field. The default `New()` constructor sets `Now = time.Now`. Implement `Allow() bool` that returns `true` only if at least 100 ms have elapsed since the previous `true` return. In `main`, simulate two scenarios: production (`time.Now`) and tests (`Now` returns advancing fixed times).

**Starter Code**:
```go
package main

import (
    "fmt"
    "time"
)

type RateLimiter struct {
    Now      func() time.Time
    lastPass time.Time
}

func New() *RateLimiter {
    // TODO
    return nil
}

func (r *RateLimiter) Allow() bool {
    // TODO
    return false
}

func main() {
    // Production scenario
    rl := New()
    fmt.Println(rl.Allow())  // true (first call)
    fmt.Println(rl.Allow())  // false (no sleep)
    time.Sleep(120 * time.Millisecond)
    fmt.Println(rl.Allow())  // true

    // Test scenario with fake clock
    fake := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
    rl2 := &RateLimiter{Now: func() time.Time { return fake }}
    fmt.Println(rl2.Allow())  // true
    fake = fake.Add(50 * time.Millisecond)
    fmt.Println(rl2.Allow())  // false
    fake = fake.Add(60 * time.Millisecond)
    fmt.Println(rl2.Allow())  // true (50+60=110ms ≥ 100ms)
}
```

**Expected Output**:
```
true
false
true
true
false
true
```

**Evaluation Checklist**:
- [ ] First call to `Allow` always returns true
- [ ] Subsequent calls compare `Now()` to `lastPass`
- [ ] When the test overrides `Now`, the limiter uses the fake clock
- [ ] No reliance on real time in the test scenario
- [ ] `Allow` updates `lastPass` only on success

---

## Bonus Task — Build Your Own `defer` (Conceptually)

**Difficulty**: Advanced
**Topic**: Function values, slices of functions, LIFO execution

**Description**: Implement a `Cleanup` type that mimics `defer` semantics. It accumulates cleanup functions and runs them in LIFO order on `.Run()`. Useful when you want defer-like behavior but the cleanup must happen at a specific moment, not at function exit.

**Starter Code**:
```go
package main

import "fmt"

type Cleanup struct {
    fns []func()
}

func (c *Cleanup) Add(fn func()) {
    // TODO
}

func (c *Cleanup) Run() {
    // TODO: LIFO
}

func main() {
    var c Cleanup
    c.Add(func() { fmt.Println("first added") })
    c.Add(func() { fmt.Println("second added") })
    c.Add(func() { fmt.Println("third added") })
    c.Run()
}
```

**Expected Output**:
```
third added
second added
first added
```

**Evaluation Checklist**:
- [ ] `Add` appends to the slice
- [ ] `Run` calls in reverse order
- [ ] Calling `Run` twice runs functions only once (clear the slice after Run)
- [ ] Safe when `fns` is nil (no panic)
