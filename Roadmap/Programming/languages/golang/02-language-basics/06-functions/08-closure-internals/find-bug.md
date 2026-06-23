# Closure Internals — Find the Bug

Author: Bakhodir Yashin Mansur

Each exercise follows the same shape:

1. Buggy code
2. Hint
3. Identifying the bug and its cause
4. Fixed code

Every bug here exercises a real closure internal: capture-by-reference, the funcval shape, escape analysis, method-value vs. method-expression, `defer` interaction, or the pre-1.22 loop-variable rule.

---

## Bug 1 — Pre-Go 1.22 loop-variable capture

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    items := []string{"a", "b", "c", "d"}
    for i := 0; i < len(items); i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            fmt.Println(items[i])
        }()
    }
    wg.Wait()
}
```

**Hint**: read your `go.mod`. What does the `go` directive say?

**Bug**: if `go.mod` declares `go 1.21` or earlier, `i` is a single variable across all iterations. The goroutines start before the loop completes assigning `i`; by execution time `i` equals `len(items)` (i.e., 4) and `items[i]` panics with index out of range. If you guarded with `i < len(items)` inside the closure, you'd silently print `items[3]` four times.

**Fix (compatible with pre-1.22)**:

```go
for i := 0; i < len(items); i++ {
    i := i // shadow
    wg.Add(1)
    go func() {
        defer wg.Done()
        fmt.Println(items[i])
    }()
}
```

**Fix (upgrade)**: change `go 1.21` to `go 1.22` in `go.mod`. The original code becomes correct.

---

## Bug 2 — `defer` inside a loop sharing a captured variable

```go
package main

import (
    "fmt"
    "os"
)

func process(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil { return err }
        defer func() { fmt.Println("closed", p); f.Close() }()
        // do work with f
    }
    return nil
}
```

**Hint**: how many "closed" messages do you expect, and which `p` and `f` do they reference?

**Bug**: on Go 1.21 and earlier, `p` is a shared variable. All deferred closures print the last value of `p`. The `f.Close()` part *seems* fine — `f` is redeclared each iteration with `:=`, so each closure captures a distinct `f`. But the captured `p` is wrong. On Go 1.22+ both `p` and `f` are per-iteration and the closure behaves correctly.

Additionally: even when the captures are right, `defer` inside a loop accumulates calls until the function returns. For 1000 files, all 1000 stay open until `process` ends.

**Fix**:

```go
func process(paths []string) error {
    for _, p := range paths {
        if err := func(p string) error {
            f, err := os.Open(p)
            if err != nil { return err }
            defer func() { fmt.Println("closed", p); f.Close() }()
            // do work with f
            return nil
        }(p); err != nil {
            return err
        }
    }
    return nil
}
```

Each iteration runs an anonymous function whose `defer` fires immediately on return.

---

## Bug 3 — Mutating a captured pointer instead of replacing it

```go
package main

import (
    "fmt"
    "sync/atomic"
)

type Config struct{ Tier string }

var current *Config

func MakeHandler() func() string {
    return func() string {
        return current.Tier
    }
}

func main() {
    current = &Config{Tier: "free"}
    h := MakeHandler()
    fmt.Println(h()) // free

    // upgrade
    newCfg := &Config{Tier: "pro"}
    atomic.StorePointer((*unsafe.Pointer)(unsafe.Pointer(&current)), unsafe.Pointer(newCfg))
    fmt.Println(h()) // ?
}
```

**Hint**: package-level variable + atomic store — what is the closure actually reading?

**Bug**: the closure references the package-level `current`. There is no atomic load inside the closure; on most architectures the read may see the new value, but it's a data race per the Go memory model. `go run -race` flags it. The `atomic.StorePointer`/`unsafe` dance also bypasses Go's typed atomic API and is error-prone.

**Fix**: use `atomic.Pointer[Config]`:

```go
var current atomic.Pointer[Config]

func MakeHandler() func() string {
    return func() string {
        return current.Load().Tier
    }
}

func main() {
    current.Store(&Config{Tier: "free"})
    h := MakeHandler()
    fmt.Println(h()) // free
    current.Store(&Config{Tier: "pro"})
    fmt.Println(h()) // pro
}
```

The closure captures nothing (it references the package-level), but it interacts safely with concurrent updates.

---

## Bug 4 — Leaked goroutine via closed channel

```go
package main

import (
    "fmt"
    "time"
)

func runWorker(jobs <-chan int) {
    go func() {
        for j := range jobs {
            fmt.Println("job", j)
        }
        fmt.Println("worker done")
    }()
}

func main() {
    jobs := make(chan int, 3)
    jobs <- 1; jobs <- 2; jobs <- 3
    runWorker(jobs)
    time.Sleep(100 * time.Millisecond)
    // jobs goes out of scope here
}
```

**Hint**: when does `range jobs` terminate?

**Bug**: the closure captures `jobs`. The channel is never closed; `range` blocks forever waiting for the next send. The goroutine leaks. `jobs` "going out of scope" doesn't matter — the goroutine still holds a reference, keeping the channel alive.

**Fix**: close the channel when no more sends are coming:

```go
jobs <- 1; jobs <- 2; jobs <- 3
close(jobs)
runWorker(jobs)
time.Sleep(100 * time.Millisecond)
```

Or pass a cancellation context:

```go
func runWorker(ctx context.Context, jobs <-chan int) {
    go func() {
        for {
            select {
            case <-ctx.Done():
                return
            case j, ok := <-jobs:
                if !ok { return }
                fmt.Println("job", j)
            }
        }
    }()
}
```

---

## Bug 5 — Method value with value receiver containing a mutex

```go
package main

import "sync"

type Counter struct {
    mu sync.Mutex
    n  int
}

func (c Counter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}

func main() {
    c := &Counter{}
    incr := c.Inc       // method value
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); incr() }()
    }
    wg.Wait()
    println(c.n)
}
```

**Hint**: what does `c.Inc` capture given the value receiver?

**Bug**: `Inc` has a value receiver. `c.Inc` copies `*c` into the funcval's env — including the `sync.Mutex`. Every call to `incr` locks the *copied* mutex (and mutates the copied `n`). The shared `c.n` is never touched. `go vet` warns: `func passes lock by value`. Result: `c.n == 0`.

**Fix**: pointer receiver.

```go
func (c *Counter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}
```

Now `c.Inc` captures `c` (the pointer), and all calls mutate the same underlying counter.

---

## Bug 6 — Closure escapes silently due to interface conversion

```go
package main

import "fmt"

type Greeter interface{ Greet() string }

type funcGreeter func() string
func (f funcGreeter) Greet() string { return f() }

func makeGreeter(name string) Greeter {
    return funcGreeter(func() string { return "hi, " + name })
}

func main() {
    for i := 0; i < 1_000_000; i++ {
        g := makeGreeter(fmt.Sprintf("user%d", i))
        _ = g.Greet()
    }
}
```

**Hint**: profile heap allocations. What's surprising?

**Bug**: each iteration allocates:
1. The string `"userN"` (one heap allocation).
2. The closure capturing `name` (env of one string header — one heap allocation).
3. The `funcGreeter` conversion to `Greeter` (in older Go versions, an additional allocation).

Plus the call goes through the interface table, blocking inlining. For a million iterations, this is millions of allocations.

**Fix**: if the work is hot, avoid the closure/interface chain:

```go
type Greeter struct{ Name string }
func (g Greeter) Greet() string { return "hi, " + g.Name }

func main() {
    for i := 0; i < 1_000_000; i++ {
        g := Greeter{Name: fmt.Sprintf("user%d", i)}
        _ = g.Greet()
    }
}
```

The struct is still allocated (string field), but no funcval, no interface wrapper. The `Greet` method can inline.

---

## Bug 7 — Captured slice header vs. captured slice contents

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3}
    f := func() { fmt.Println(s) }
    s = []int{4, 5, 6}
    f()  // prints what?
}
```

**Hint**: the closure captures the *variable* `s`, not the slice header it held at literal time.

**Bug**: many programmers expect `f` to print `[1 2 3]` because the slice value was captured. In fact `f` captures the **variable** `s`. By the time `f` runs, `s` has been reassigned to `[4 5 6]`. Output: `[4 5 6]`.

This is not a bug if intentional, but it's a common misreading.

**Fix (when you want the original snapshot)**: capture by value via a helper:

```go
s := []int{1, 2, 3}
f := func(s []int) func() {
    return func() { fmt.Println(s) }
}(s)
s = []int{4, 5, 6}
f()  // prints [1 2 3]
```

The inner `s` is a fresh parameter, not the outer variable.

---

## Bug 8 — Recursive closure with the wrong binding pattern

```go
package main

import "fmt"

func main() {
    fact := func(n int) int {
        if n <= 1 { return 1 }
        return n * fact(n-1) // compile error
    }
    fmt.Println(fact(5))
}
```

**Hint**: what is bound to `fact` while the literal is being evaluated?

**Bug**: at the moment the function literal is being evaluated, `fact` is not yet declared (the `:=` creates `fact` *with* the value of the literal). Inside the literal, `fact` is unknown. Compile error: `undefined: fact`.

**Fix**: declare the variable first, then assign.

```go
var fact func(int) int
fact = func(n int) int {
    if n <= 1 { return 1 }
    return n * fact(n-1)
}
fmt.Println(fact(5))
```

Now `fact` is in scope by the time the literal is evaluated. The closure captures `fact` (the variable) by reference; reading `fact` inside the body yields the function itself.

---

## Bug 9 — Goroutine sees stale named return via `defer`

```go
package main

import "fmt"

func compute() (result int) {
    defer func(r int) {
        fmt.Println("result:", r)
    }(result)
    result = 42
    return
}

func main() { compute() }
```

**Hint**: which `result` does the deferred function see?

**Bug**: the deferred call passes `result` as an argument — evaluated at defer time, when `result` is the zero value `0`. The print shows `result: 0`. The author probably wanted to log the final value.

**Fix**: capture the named return by reference (no argument).

```go
defer func() { fmt.Println("result:", result) }()
```

Now the closure references `result` and reads it at deferred-call time, after `result = 42` has executed. Output: `result: 42`.

---

## Bug 10 — `errgroup` losing tasks because of capture

```go
package main

import (
    "context"
    "fmt"
    "golang.org/x/sync/errgroup"
)

func main() {
    g, _ := errgroup.WithContext(context.Background())
    items := []string{"a", "b", "c"}
    for i := 0; i < len(items); i++ {
        g.Go(func() error {
            fmt.Println("processing", items[i])
            return nil
        })
    }
    _ = g.Wait()
}
```

**Hint**: same pattern as Bug 1.

**Bug**: pre-1.22, `i` is shared. All three goroutines may print `items[2]` (or panic with index out of range if `i` reaches 3). Even worse, `errgroup` may silently complete because the goroutines didn't actually call your intended task.

**Fix (compatible)**:

```go
for i := 0; i < len(items); i++ {
    i := i
    g.Go(func() error {
        fmt.Println("processing", items[i])
        return nil
    })
}
```

**Fix (1.22+)**: just set `go 1.22` in `go.mod`; the original is correct.

---

## Bug 11 — `defer cancel()` cancels too late

```go
package main

import (
    "context"
    "time"
)

func processAll(items []string) {
    for _, it := range items {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()
        go process(ctx, it)
    }
    // long work outside the loop...
    time.Sleep(time.Hour)
}

func process(ctx context.Context, item string) { /* ... */ }
```

**Hint**: when does `defer cancel()` actually run?

**Bug**: `defer cancel()` runs when `processAll` returns, not when each iteration finishes. The contexts are not cancelled per-item; they all live until `processAll` ends — defeating the 5-second timeout. Additionally, defer registrations accumulate (N items = N pending `cancel` calls on the defer stack). Memory grows; some contexts may leak goroutines from `context.WithTimeout`.

**Fix**: do the per-item work inside an inner function or move `cancel` to the goroutine.

```go
for _, it := range items {
    it := it
    go func() {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()
        process(ctx, it)
    }()
}
```

Now each goroutine owns its own context and cancellation runs at goroutine exit.

---

## Bug 12 — Sharing a captured `bytes.Buffer` across goroutines

```go
package main

import (
    "bytes"
    "fmt"
    "sync"
)

func main() {
    buf := &bytes.Buffer{}
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            fmt.Fprintf(buf, "msg %d\n", i)
        }()
    }
    wg.Wait()
    fmt.Println(buf.String())
}
```

**Hint**: is `bytes.Buffer` safe for concurrent use?

**Bug**: every goroutine captures the same `*bytes.Buffer`. `bytes.Buffer` is **not** safe for concurrent writes. Output is interleaved or truncated; in release builds, internal slice growth may corrupt the buffer. `go run -race` catches it.

**Fix A** (synchronise):

```go
var mu sync.Mutex
go func() {
    defer wg.Done()
    mu.Lock()
    fmt.Fprintf(buf, "msg %d\n", i)
    mu.Unlock()
}()
```

**Fix B** (channel):

```go
ch := make(chan string, 100)
for i := 0; i < 100; i++ {
    i := i
    wg.Add(1)
    go func() {
        defer wg.Done()
        ch <- fmt.Sprintf("msg %d", i)
    }()
}
go func() { wg.Wait(); close(ch) }()
for s := range ch {
    fmt.Fprintln(buf, s)
}
```

The closures still capture `ch` and `wg`, but the shared mutable state (`buf`) is no longer touched concurrently.

---

## Summary

Every bug above looks innocuous at first glance. Each is rooted in a closure internal:

- Bugs 1, 2, 10 — pre-1.22 loop-variable capture.
- Bug 3 — race conditions when captured variables alias package-level state.
- Bug 4 — goroutine leak via captured channel without termination path.
- Bug 5 — method value with value receiver copying mutexes.
- Bug 6 — silent escape and allocation via interface wrapping.
- Bug 7 — capture-by-reference misunderstood as snapshot.
- Bug 8 — recursive closure binding order.
- Bug 9 — defer argument evaluated at defer-time, not at exit-time.
- Bug 11 — `defer cancel()` accumulating inside a loop.
- Bug 12 — concurrent writes to a captured non-thread-safe value.

Run every fixed snippet with `go run -race` and `go vet` to confirm. See [optimize.md](optimize.md) for performance-oriented refactors.

---

## Further reading

- [middle.md](middle.md), [professional.md](professional.md)
- `go vet`'s `loopclosure` check: https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/loopclosure
- Race detector: https://go.dev/doc/articles/race_detector
- Go memory model: https://go.dev/ref/mem
