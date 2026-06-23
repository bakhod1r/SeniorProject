# Go Closures — Middle Level

## 1. Introduction

At the middle level, closures become a tool for designing **stateful APIs without classes**, encoding **policy as data**, and building **composable callbacks**. You design closure-based APIs deliberately, recognize when a struct + methods is clearer, and handle the subtleties of capture in concurrent code.

---

## 2. Prerequisites
- Junior-level closure material
- Anonymous functions (2.6.4)
- Goroutines, channels, sync primitives
- Understanding of escape analysis (basic)

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| Closure | Function value with captured environment |
| Capture environment | The set of free variables a closure captures |
| Stateful closure | A closure whose behavior depends on captured mutable state |
| Pure closure | A closure that doesn't capture or only captures immutable values |
| Closure factory | A function that returns a new closure |
| Snapshot capture | Capturing a value, not the live variable (via shadow) |
| Escape | The closure outliving its creating function |

---

## 4. Core Concepts

### 4.1 Closures as Lightweight Objects

A closure with captured state is functionally equivalent to a struct with one method:

```go
// Closure version
func newCounter() func() int {
    n := 0
    return func() int { n++; return n }
}

// Struct version
type Counter struct{ n int }
func (c *Counter) Next() int { c.n++; return c.n }
```

When to use which:
- **Closure**: 1-2 captured values, single method, no need for direct testing.
- **Struct**: 3+ fields, multiple methods, need for serialization, public API.

### 4.2 Closures as Policy

You can encode behavior as a closure that callers pass in:

```go
type Selector func(item Item) bool

func filterAll(items []Item, sel Selector) []Item {
    out := items[:0]
    for _, it := range items {
        if sel(it) {
            out = append(out, it)
        }
    }
    return out
}

threshold := 100
filtered := filterAll(items, func(it Item) bool {
    return it.Score > threshold // captures threshold
})
```

The closure encodes the dynamic policy (`threshold`).

### 4.3 The Snapshot-vs-Live Choice

```go
// Live capture (default):
x := 1
f := func() int { return x }
x = 99
fmt.Println(f()) // 99

// Snapshot capture (via shadow):
x := 1
f := func() int {
    x := x // snapshot when closure was created
    return x
}
x = 99
fmt.Println(f()) // 1
```

Snapshot is also achieved by passing as an argument:
```go
f := func(snapshot int) func() int {
    return func() int { return snapshot }
}(x)
```

### 4.4 Sharing Captures Across Multiple Closures

```go
n := 0
incr := func() { n++ }
get  := func() int { return n }
reset := func() { n = 0 }

incr(); incr(); incr()
fmt.Println(get()) // 3
reset()
fmt.Println(get()) // 0
```

All three closures share `n`. This is a "closure object" pattern — multiple methods on shared state.

### 4.5 Loop Variable Capture (Go 1.22+)

Modern Go (1.22+) creates a fresh iteration variable per iteration:

```go
fns := []func() int{}
for i := 0; i < 3; i++ {
    fns = append(fns, func() int { return i })
}
// Go 1.22+: fns each return 0, 1, 2.
```

For pre-1.22 modules, shadow with `i := i` or pass as argument.

### 4.6 Closures and Generics

Generic functions can return closures:

```go
func Adder[T int | float64](by T) func(T) T {
    return func(x T) T { return x + by }
}

addInt := Adder(3)
addFloat := Adder(1.5)
fmt.Println(addInt(10), addFloat(2.5)) // 13 4.0
```

The type parameter is fixed at instantiation; the closure captures `by` of that type.

---

## 5. Real-World Analogies

**A serial number printer**: a closure that increments a number each call. Multiple printers each have their own counter.

**A subscription**: capture context (URL, auth, config) in a closure that you can call later. The closure carries all the setup.

**A safe-deposit box with multiple keys**: multiple closures sharing state — like multiple keys to one box.

---

## 6. Mental Models

### Model 1 — Closure as Object

A closure with captures is a tiny "object":

```
closure value = {
    method:   compiled body
    fields:   captured variables (shared with enclosing scope)
}
```

### Model 2 — Capture Environment

Think of the captured variables as the closure's "environment":

```
closure → environment {
    x: 5
    y: ptr to outer y
    z: ptr to outer z
}
```

The compiler synthesizes this struct; the runtime accesses it via the closure context register.

---

## 7. Pros & Cons

### Pros
- Encapsulate state without ceremony
- Natural factories, generators, decorators
- Composable callbacks
- Less boilerplate than struct + methods for simple cases

### Cons
- Captures pin memory
- Concurrent capture mutation needs synchronization
- Stack traces show generic names
- Pre-1.22 loop-variable bugs
- Heavy captures may surprise

---

## 8. Use Cases

1. Counters / generators
2. Memoization
3. Throttle / rate limit
4. Decorators (logging, retry, metrics)
5. Iterators using visitor pattern
6. Functional options
7. State machines as closures
8. Event subscriptions with context

---

## 9. Code Examples

### Example 1 — Multi-Closure State Machine

```go
package main

import "fmt"

type State int

const (
    Idle State = iota
    Running
    Stopped
)

func newMachine() (transition func(State), get func() State) {
    state := Idle
    transition = func(to State) { state = to }
    get = func() State { return state }
    return
}

func main() {
    transition, get := newMachine()
    transition(Running)
    fmt.Println(get()) // 1
    transition(Stopped)
    fmt.Println(get()) // 2
}
```

### Example 2 — Throttle With Channel Notify

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func throttler(d time.Duration) (allow func() bool, blocked chan struct{}) {
    var mu sync.Mutex
    var last time.Time
    blocked = make(chan struct{}, 1)
    allow = func() bool {
        mu.Lock()
        defer mu.Unlock()
        now := time.Now()
        if now.Sub(last) < d {
            select { case blocked <- struct{}{}: default: }
            return false
        }
        last = now
        return true
    }
    return
}

func main() {
    allow, blocked := throttler(50 * time.Millisecond)
    for i := 0; i < 5; i++ {
        if allow() { fmt.Println(i, "allowed") } else { fmt.Println(i, "blocked") }
        time.Sleep(20 * time.Millisecond)
    }
    select {
    case <-blocked:
        fmt.Println("at least one blocked")
    default:
    }
}
```

### Example 3 — LRU-Style Cache (simple)

```go
package main

import "fmt"

func cached(fn func(int) int) (call func(int) int, stats func() (int, int)) {
    cache := map[int]int{}
    hits, misses := 0, 0
    call = func(k int) int {
        if v, ok := cache[k]; ok {
            hits++
            return v
        }
        misses++
        v := fn(k)
        cache[k] = v
        return v
    }
    stats = func() (int, int) { return hits, misses }
    return
}

func main() {
    f, stats := cached(func(x int) int { return x * 2 })
    f(1); f(2); f(1); f(3); f(2)
    h, m := stats()
    fmt.Printf("hits=%d misses=%d\n", h, m) // hits=2 misses=3
}
```

### Example 4 — Decorator (Retry)

```go
package main

import (
    "errors"
    "fmt"
    "time"
)

func withRetry(n int, sleep time.Duration, fn func() error) func() error {
    return func() error {
        var err error
        for i := 0; i < n; i++ {
            err = fn()
            if err == nil { return nil }
            time.Sleep(sleep)
        }
        return fmt.Errorf("retried %d: %w", n, err)
    }
}

var calls int
func flakey() error { calls++; if calls < 3 { return errors.New("flake") }; return nil }

func main() {
    r := withRetry(5, 10*time.Millisecond, flakey)
    fmt.Println(r(), calls)
}
```

### Example 5 — Closures + Goroutines + Synchronization

```go
package main

import (
    "fmt"
    "sync"
)

func newSafeCounter() (incr func(), get func() int) {
    var mu sync.Mutex
    n := 0
    incr = func() {
        mu.Lock(); defer mu.Unlock()
        n++
    }
    get = func() int {
        mu.Lock(); defer mu.Unlock()
        return n
    }
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

---

## 10. Coding Patterns

### Pattern 1 — Closure as State Machine
Multiple closures sharing captured state; each closure exposes one operation.

### Pattern 2 — Decorator
```go
func wrap(fn func()) func() {
    return func() { /* before */; fn(); /* after */ }
}
```

### Pattern 3 — Lazy Computation
```go
func lazy[T any](compute func() T) func() T {
    var v T
    var done bool
    return func() T {
        if !done { v = compute(); done = true }
        return v
    }
}
```

### Pattern 4 — Functional Options
```go
type Option func(*Config)
opts := []Option{WithA(...), WithB(...)}
```

### Pattern 5 — Observer Pattern via Captured Channel
```go
func newSubject() (notify func(int), subscribe func() <-chan int) {
    var mu sync.Mutex
    var subs []chan int
    notify = func(v int) {
        mu.Lock(); defer mu.Unlock()
        for _, ch := range subs {
            select { case ch <- v: default: }
        }
    }
    subscribe = func() <-chan int {
        ch := make(chan int, 1)
        mu.Lock(); subs = append(subs, ch); mu.Unlock()
        return ch
    }
    return
}
```

---

## 11. Clean Code Guidelines

1. **Capture only what you need** — extract narrow values.
2. **Document the closure's lifetime** if it escapes.
3. **Synchronize captured mutable state** if accessed concurrently.
4. **Use struct + methods** when state grows or you need testing.
5. **Avoid deep closure nesting** — flatten or use named functions.

---

## 12. Product Use / Feature Example

**A configurable rate-limited HTTP client**:

```go
package main

import (
    "fmt"
    "net/http"
    "sync"
    "time"
)

func rateLimitedClient(rps int) func(req *http.Request) (*http.Response, error) {
    var mu sync.Mutex
    interval := time.Second / time.Duration(rps)
    var next time.Time
    client := http.DefaultClient
    return func(req *http.Request) (*http.Response, error) {
        mu.Lock()
        wait := time.Until(next)
        if wait > 0 {
            time.Sleep(wait)
        }
        next = time.Now().Add(interval)
        mu.Unlock()
        return client.Do(req)
    }
}

func main() {
    do := rateLimitedClient(2) // 2 req/sec
    _ = do
    fmt.Println("client ready")
}
```

The closure encapsulates the limiter state (`next`, `interval`, `mu`).

---

## 13. Error Handling

When a closure may fail, return an `(error)` from it; callers handle as usual:

```go
func validator(min, max int) func(int) error {
    return func(x int) error {
        if x < min || x > max {
            return fmt.Errorf("out of range [%d, %d]: %d", min, max, x)
        }
        return nil
    }
}
```

---

## 14. Security Considerations

1. **Captured secrets pin sensitive data** — wipe after use, ensure closure exits.
2. **Don't pass closures with sensitive captures** to untrusted callers.
3. **Long-lived goroutines pin captures** — design for cancellation.
4. **Avoid capturing privileged state** in closures used by less-privileged code.

---

## 15. Performance Tips

1. **Non-escaping closures** stack-allocate (free).
2. **Escaping closures** heap-allocate (1 alloc per closure value).
3. **Indirect calls through closures** can't inline — use direct calls in hot loops.
4. **Heavy captures** add to closure size; minimize.
5. **Verify with `-gcflags="-m"`**.

---

## 16. Metrics & Analytics

```go
func instrumented(name string, fn func() error) func() error {
    return func() error {
        start := time.Now()
        err := fn()
        // metrics.Record(name, time.Since(start), err)
        fmt.Printf("[%s] dur=%v err=%v\n", name, time.Since(start), err)
        return err
    }
}
```

---

## 17. Best Practices

1. Use closures for state encapsulation when 1-2 fields suffice.
2. Use struct + methods for richer state.
3. Capture minimum data.
4. Synchronize concurrent captures.
5. Document closure lifetime.
6. Use the shadow `x := x` for explicit snapshots.
7. Use generics for typed closure factories.
8. Avoid closures in tight inner loops where possible.

---

## 18. Edge Cases & Pitfalls

### Pitfall 1 — Pre-1.22 Loop Variable
Discussed extensively; pass as arg or shadow.

### Pitfall 2 — Concurrent Capture Mutation
```go
counter := newCounter()
go counter() // race
go counter()
```
Fix: synchronize inside.

### Pitfall 3 — Closure Holding Resources
```go
go func() {
    f, _ := os.Open("...")
    // f never closed; goroutine never exits → fd leak
}()
```

### Pitfall 4 — Capturing Receiver Pointer in a Method
```go
type S struct{ ... }
func (s *S) Action() func() {
    return func() { use(s) } // captures s
}
```
The returned closure pins `s` for its lifetime.

### Pitfall 5 — Reusing Snapshot in Multiple Iterations
```go
for i := 0; i < 3; i++ {
    snap := i
    go func() { use(snap) }() // each closure captures its own snap (Go 1.22+ already does this for i)
}
```

---

## 19. Common Mistakes

| Mistake | Fix |
|---------|-----|
| Capturing loop var without shadow (pre-1.22) | Shadow or pass as arg |
| Sharing captured mutable state across goroutines | Synchronize |
| Heavy captures pinning memory | Extract minimum |
| Recursion without `var` declaration | Declare first, then assign |
| Treating closure as struct alternative for everything | Use struct when state grows |

---

## 20. Common Misconceptions

**Misconception 1**: "Closures are like Java lambdas (immutable captures)."
**Truth**: Go closures capture by reference; captures are mutable.

**Misconception 2**: "Each closure has its own copy of the variable."
**Truth**: Closures share the SAME variable when defined in the same scope. Each closure INSTANCE (from a factory) has its own.

**Misconception 3**: "All captured variables go to the heap."
**Truth**: Only when the closure escapes. Stack capture is preferred when possible.

**Misconception 4**: "Closures are slower than regular functions."
**Truth**: Indirect-call cost is small (~3-5 cycles); allocation cost only when escaping.

**Misconception 5**: "I should use closures for everything stateful."
**Truth**: Structs + methods scale better with state size and complexity.

---

## 21. Tricky Points

1. Capture is by reference; use shadow for snapshots.
2. Pre-1.22 loop variable shared; Go 1.22+ per-iteration.
3. Concurrent captures need synchronization.
4. Recursive closures need `var` declaration.
5. Closure escape is invisible from the call site.

---

## 22. Test

```go
package main

import (
    "sync"
    "testing"
)

func newCounter() func() int {
    n := 0
    return func() int { n++; return n }
}

func TestCounter(t *testing.T) {
    c := newCounter()
    for i := 1; i <= 5; i++ {
        if got := c(); got != i {
            t.Errorf("call %d: got %d, want %d", i, got, i)
        }
    }
}

func TestCounterIndependent(t *testing.T) {
    c1 := newCounter()
    c2 := newCounter()
    c1(); c1()
    if got := c2(); got != 1 {
        t.Errorf("c2 got %d, want 1", got)
    }
}

func TestCounterConcurrent(t *testing.T) {
    // newCounter is NOT thread-safe; this test demonstrates the bug.
    c := newCounter()
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); c() }()
    }
    wg.Wait()
    // c() may not have reached 1000 due to race
}
```

---

## 23. Tricky Questions

**Q1**: What's the output?
```go
counters := []func() int{}
for i := 0; i < 3; i++ {
    counters = append(counters, newCounter())
}
fmt.Println(counters[0](), counters[1](), counters[2]())
```
**A**: `1 1 1`. Each `newCounter()` call creates a separate `n`. Each closure has its own counter.

**Q2**: What's the output (Go 1.22+)?
```go
fns := []func() int{}
for i := 0; i < 3; i++ {
    fns = append(fns, func() int { return i })
}
fmt.Println(fns[0](), fns[1](), fns[2]())
```
**A**: `0 1 2`. Per-iteration capture in Go 1.22+. Pre-1.22 would be `3 3 3`.

**Q3**: Will this print `0` or `99`?
```go
x := 0
defer fmt.Println(x)
defer func() { fmt.Println(x) }()
x = 99
```
**A**: Defer LIFO, so the closure runs first (prints `99`), then the eager-arg defer (prints `0`).

---

## 24. Cheat Sheet

```go
// Counter
n := 0
f := func() int { n++; return n }

// Factory
func make(by int) func(int) int {
    return func(x int) int { return x + by }
}

// Snapshot
x := 1
f := func() int { x := x; return x } // captures 1

// Recursive
var fact func(int) int
fact = func(n int) int { if n <= 1 { return 1 }; return n * fact(n-1) }

// Concurrent-safe
var mu sync.Mutex
n := 0
incr := func() { mu.Lock(); defer mu.Unlock(); n++ }

// Shared state, multiple closures
n := 0
incr := func() { n++ }
get  := func() int { return n }
```

---

## 25. Self-Assessment Checklist

- [ ] I can write a closure factory
- [ ] I can write a multi-closure state machine
- [ ] I know capture is by reference
- [ ] I know how to take snapshots (shadow)
- [ ] I synchronize concurrent captures
- [ ] I extract minimum captures
- [ ] I know the loop-variable change in Go 1.22
- [ ] I can write recursive closures
- [ ] I choose between closure and struct intentionally

---

## 26. Summary

Closures are functions that carry captured state by reference. They're lightweight objects, ideal for 1-2 fields and a single (or few) operations. Each closure instance has its own captures; closures defined in the same scope share. Watch for the loop-variable subtlety (mostly fixed in Go 1.22) and synchronize concurrent capture access. Use the shadow `x := x` for snapshots. Reach for structs + methods when state grows.

---

## 27. What You Can Build

- Counters, generators, ID providers
- Memoization wrappers
- Rate limiters, throttles
- Decorators (logging, retry, timing)
- State machines
- Pluggable policies
- Lazy initialization helpers
- Subscriber/observer abstractions

---

## 28. Further Reading

- [Effective Go — Functions](https://go.dev/doc/effective_go#functions)
- [Go Tour — Closures](https://go.dev/tour/moretypes/25)
- [Go 1.22 release notes — Loop variable change](https://go.dev/doc/go1.22)
- [Dave Cheney — Closures and goroutines](https://dave.cheney.net/2014/03/19/channel-axioms)

---

## 29. Related Topics

- 2.6.4 Anonymous Functions
- 2.6.7 Call by Value
- 2.5 Loops (Go 1.22 semantics)
- Chapter 7 Concurrency
- 2.7 Pointers (capture as pointer-to-cell)

---

## 30. Diagrams & Visual Aids

### Capture sharing across closures

```
       Outer scope:
       ┌───────────┐
       │  n = 0    │  ← captured by reference
       └─┬─────────┘
         │
   ┌─────┴─────┐
   │           │
incr()       get()       ← share n
```

### Per-iteration vs shared loop variable

```
Pre-1.22:                  Go 1.22+:
for i :=0; ...             for i :=0; ...
      │                          │
   shared i                  fresh i per iter
      │                          │
   all closures             each closure
   read SAME i              reads OWN i
```
