# Go Closures — Tasks

## Instructions

Each task includes a description, starter code, expected output, and an evaluation checklist. Use closures idiomatically; capture minimum data; synchronize when concurrent.

---

## Task 1 — Counter Factory

**Difficulty**: Beginner
**Topic**: Basic closure factory

**Description**: Implement `newCounter() func() int` that returns a counter starting at 0. Each call increments and returns.

**Starter Code**:
```go
package main

import "fmt"

func newCounter() func() int {
    // TODO
    return nil
}

func main() {
    c := newCounter()
    fmt.Println(c(), c(), c()) // 1 2 3
    c2 := newCounter()
    fmt.Println(c2(), c2()) // 1 2  (independent state)
}
```

**Expected Output**:
```
1 2 3
1 2
```

**Evaluation Checklist**:
- [ ] Captures a local variable `n`
- [ ] Each `newCounter()` call creates independent state
- [ ] Returns a closure of type `func() int`
- [ ] No global state

---

## Task 2 — Adder Family

**Difficulty**: Beginner
**Topic**: Generic closure factory

**Description**: Implement a generic `Adder[T int | float64](by T) func(T) T` that returns a closure adding `by` to its argument.

**Starter Code**:
```go
package main

import "fmt"

func Adder[T int | float64](by T) func(T) T {
    // TODO
    return nil
}

func main() {
    add3 := Adder(3)
    fmt.Println(add3(10), add3(7)) // 13 10
    add1_5 := Adder(1.5)
    fmt.Println(add1_5(2.5)) // 4
}
```

**Expected Output**:
```
13 10
4
```

**Evaluation Checklist**:
- [ ] Generic with `T int | float64`
- [ ] Captures `by`
- [ ] Returns `func(T) T`
- [ ] Works for both int and float64

---

## Task 3 — Snapshot Capture

**Difficulty**: Beginner
**Topic**: Live vs snapshot capture

**Description**: Show the difference between live and snapshot capture by writing two functions: `liveCap()` returning a closure that reads the current value of `x`, and `snapshotCap()` returning a closure that reads the value at creation time.

**Starter Code**:
```go
package main

import "fmt"

func liveCap(xRef *int) func() int {
    // TODO: closure that reads *xRef each call
    return nil
}

func snapshotCap(x int) func() int {
    // TODO: closure that returns the snapshot
    return nil
}

func main() {
    x := 1
    live := liveCap(&x)
    snap := snapshotCap(x)
    x = 99
    fmt.Println(live(), snap()) // 99 1
}
```

**Expected Output**:
```
99 1
```

**Evaluation Checklist**:
- [ ] `liveCap` captures a pointer for live updates
- [ ] `snapshotCap` captures by value (passed as arg)
- [ ] After mutating `x`, live sees 99, snap sees 1

---

## Task 4 — Throttle Helper

**Difficulty**: Intermediate
**Topic**: Closure with mutable captured state

**Description**: Implement `throttle(d time.Duration) func() bool` returning a function that returns `true` if at least `d` has passed since the last `true` return.

**Starter Code**:
```go
package main

import (
    "fmt"
    "time"
)

func throttle(d time.Duration) func() bool {
    // TODO
    return nil
}

func main() {
    canRun := throttle(50 * time.Millisecond)
    for i := 0; i < 5; i++ {
        if canRun() {
            fmt.Println("ok")
        } else {
            fmt.Println("throttled")
        }
        time.Sleep(20 * time.Millisecond)
    }
}
```

**Expected Output** (approximate):
```
ok
throttled
ok
throttled
ok
```

**Evaluation Checklist**:
- [ ] Captures a `last time.Time` variable
- [ ] First call returns true (no previous)
- [ ] Subsequent calls compare elapsed to `d`
- [ ] Updates `last` only on `true` returns

---

## Task 5 — Pair of Closures Sharing State

**Difficulty**: Intermediate
**Topic**: Multiple closures sharing one capture

**Description**: Write `newRegister() (add func(string), list func() []string)`. The `add` and `list` closures share a `[]string` underneath.

**Starter Code**:
```go
package main

import "fmt"

func newRegister() (add func(string), list func() []string) {
    // TODO
    return
}

func main() {
    add, list := newRegister()
    add("a")
    add("b")
    add("c")
    fmt.Println(list()) // [a b c]
}
```

**Expected Output**:
```
[a b c]
```

**Evaluation Checklist**:
- [ ] Both closures share the same captured slice
- [ ] `add` appends to it
- [ ] `list` returns a copy (or the slice itself; document)
- [ ] Independent registers don't interfere

---

## Task 6 — Recursive Closure (Factorial)

**Difficulty**: Intermediate
**Topic**: Recursion-by-name workaround

**Description**: Compute factorial using a recursive anonymous function. Use the `var f func(int) int; f = ...` pattern.

**Starter Code**:
```go
package main

import "fmt"

func main() {
    // TODO: declare and define a recursive closure `fact`
    var fact func(int) int
    fact = nil

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
- [ ] `var fact func(int) int` declared first
- [ ] `fact = func(...)` assigned
- [ ] Recursive case: `n * fact(n-1)`
- [ ] Base case: returns 1 for n ≤ 1

---

## Task 7 — Memoize Generic

**Difficulty**: Intermediate
**Topic**: Closure with map capture, generics

**Description**: Implement `Memoize[K comparable, V any](fn func(K) V) func(K) V` that caches results.

**Starter Code**:
```go
package main

import "fmt"

func Memoize[K comparable, V any](fn func(K) V) func(K) V {
    // TODO: closure capturing a map[K]V cache
    return nil
}

var calls int
func slow(x int) int { calls++; return x * 2 }

func main() {
    fast := Memoize(slow)
    for _, v := range []int{1, 2, 1, 3, 2} {
        fmt.Println(fast(v))
    }
    fmt.Println("calls:", calls) // 3
}
```

**Expected Output**:
```
2
4
2
6
4
calls: 3
```

**Evaluation Checklist**:
- [ ] Generic over K (comparable) and V
- [ ] Captures a `map[K]V`
- [ ] Cache hit returns cached value
- [ ] Cache miss invokes fn, caches result, returns

---

## Task 8 — Decorator: Timing

**Difficulty**: Advanced
**Topic**: Closure decorator wrapping a function

**Description**: Implement `Timed(name string, fn func() error) func() error` that wraps fn to print timing on each call.

**Starter Code**:
```go
package main

import (
    "fmt"
    "time"
)

func Timed(name string, fn func() error) func() error {
    // TODO
    return nil
}

func main() {
    work := Timed("work", func() error {
        time.Sleep(20 * time.Millisecond)
        return nil
    })
    work()
    work()
}
```

**Expected Output** (timings vary):
```
[work] 20ms err=<nil>
[work] 20ms err=<nil>
```

**Evaluation Checklist**:
- [ ] Captures `name` and `fn`
- [ ] Records start; calls fn; prints elapsed
- [ ] Propagates fn's error
- [ ] Can be called multiple times

---

## Task 9 — Concurrent-Safe Counter

**Difficulty**: Advanced
**Topic**: Closure with mutex

**Description**: Implement `newSafeCounter() (incr func(), get func() int)` that's safe for concurrent use. Use `sync.Mutex`.

**Starter Code**:
```go
package main

import (
    "fmt"
    "sync"
)

func newSafeCounter() (incr func(), get func() int) {
    // TODO: mutex + n captured
    return
}

func main() {
    incr, get := newSafeCounter()
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            incr()
        }()
    }
    wg.Wait()
    fmt.Println(get()) // 1000
}
```

**Expected Output**:
```
1000
```

**Evaluation Checklist**:
- [ ] Captures `var mu sync.Mutex` and `n int`
- [ ] Both closures take the lock
- [ ] No data race (test with `-race`)
- [ ] Result is exactly 1000

---

## Task 10 — Pre-1.22 Loop Variable Capture (Educational)

**Difficulty**: Advanced
**Topic**: Pre-1.22 closure pitfall and fix

**Description**: Demonstrate the pre-1.22 capture pitfall with two versions: buggy (captures shared `i`) and fixed (captures via shadow). In Go 1.22+ both behave correctly; in pre-1.22 only the fixed version does.

**Starter Code**:
```go
package main

import "fmt"

func buggy() []func() int {
    fns := []func() int{}
    for i := 0; i < 3; i++ {
        fns = append(fns, func() int { return i })
    }
    return fns
}

func fixed() []func() int {
    fns := []func() int{}
    for i := 0; i < 3; i++ {
        i := i // shadow per iteration (works in all versions)
        fns = append(fns, func() int { return i })
    }
    return fns
}

func main() {
    fmt.Print("buggy: ")
    for _, f := range buggy() {
        fmt.Print(f(), " ")
    }
    fmt.Println()
    fmt.Print("fixed: ")
    for _, f := range fixed() {
        fmt.Print(f(), " ")
    }
    fmt.Println()
}
```

**Expected Output (Go 1.22+ — both work)**:
```
buggy: 0 1 2 
fixed: 0 1 2 
```

**Expected Output (Pre Go 1.22)**:
```
buggy: 3 3 3 
fixed: 0 1 2 
```

**Evaluation Checklist**:
- [ ] `buggy` and `fixed` differ only in the shadow line
- [ ] Output documented for both Go versions
- [ ] Comments explain WHY the shadow fix works

---

## Bonus Task — Iterator With Closures (Pre Go 1.23 Style)

**Difficulty**: Advanced
**Topic**: Closure-based iteration

**Description**: Implement `Range(start, end int) (next func() (int, bool))` returning a closure that yields integers from `start` to `end` (exclusive). Use it to print 5..10.

**Starter Code**:
```go
package main

import "fmt"

func Range(start, end int) func() (int, bool) {
    // TODO
    return nil
}

func main() {
    next := Range(5, 10)
    for v, ok := next(); ok; v, ok = next() {
        fmt.Println(v)
    }
}
```

**Expected Output**:
```
5
6
7
8
9
```

**Evaluation Checklist**:
- [ ] Captures the current position and `end`
- [ ] Returns `(value, true)` when in range
- [ ] Returns `(0, false)` after end
- [ ] Multiple iterators are independent
- [ ] Repeated calls after exhaustion still return false
