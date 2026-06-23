---
layout: default
title: WaitGroups — Tasks
parent: WaitGroups
grand_parent: sync Package
nav_order: 7
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/02-waitgroups/tasks/
---

# WaitGroups — Tasks

← Back to WaitGroups

A graded set of WaitGroup exercises. Solutions are at the bottom of each task. Try the task before peeking.

Run all exercises with the race detector enabled:

```
go run -race main.go
go test -race ./...
```

---

## Task 1 — "hello, goroutines"

Goal: spawn 10 goroutines, each printing its index. Make sure all 10 lines appear before the program exits.

Starting code:

```go
package main

import "fmt"

func main() {
    for i := 0; i < 10; i++ {
        go func(i int) {
            fmt.Println("hello", i)
        }(i)
    }
}
```

**Solution.**

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    wg.Add(10)
    for i := 0; i < 10; i++ {
        go func(i int) {
            defer wg.Done()
            fmt.Println("hello", i)
        }(i)
    }
    wg.Wait()
}
```

---

## Task 2 — concurrent file checksum

Goal: given a list of file paths from `os.Args[1:]`, compute the SHA-256 of each in parallel and print `path  hex`. Use a single WaitGroup.

**Solution.**

```go
package main

import (
    "crypto/sha256"
    "encoding/hex"
    "fmt"
    "io"
    "os"
    "sync"
)

func sum(path string, wg *sync.WaitGroup) {
    defer wg.Done()
    f, err := os.Open(path)
    if err != nil {
        fmt.Printf("%s ERROR: %v\n", path, err)
        return
    }
    defer f.Close()
    h := sha256.New()
    if _, err := io.Copy(h, f); err != nil {
        fmt.Printf("%s ERROR: %v\n", path, err)
        return
    }
    fmt.Printf("%s %s\n", path, hex.EncodeToString(h.Sum(nil)))
}

func main() {
    var wg sync.WaitGroup
    wg.Add(len(os.Args[1:]))
    for _, p := range os.Args[1:] {
        go sum(p, &wg)
    }
    wg.Wait()
}
```

---

## Task 3 — fixed-size worker pool

Goal: process N items with exactly K worker goroutines. K is given by the constant `workers = 4`. Use a job channel and a WaitGroup.

```go
items := []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
const workers = 4
```

**Solution.**

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    items := []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
    const workers = 4

    jobs := make(chan int)
    var wg sync.WaitGroup

    wg.Add(workers)
    for i := 0; i < workers; i++ {
        go func(id int) {
            defer wg.Done()
            for j := range jobs {
                fmt.Printf("worker %d processed %d\n", id, j*j)
            }
        }(i)
    }

    for _, it := range items {
        jobs <- it
    }
    close(jobs)
    wg.Wait()
}
```

---

## Task 4 — fan-out, collect ordered results

Goal: given `xs := []int{1,2,3,4,5}`, compute `f(x) = x*x` for each `x` in parallel, return a slice of results *in the same order as the input*.

**Solution.**

```go
package main

import (
    "fmt"
    "sync"
)

func parallelSquare(xs []int) []int {
    out := make([]int, len(xs))
    var wg sync.WaitGroup
    wg.Add(len(xs))
    for i, x := range xs {
        go func(i, x int) {
            defer wg.Done()
            out[i] = x * x
        }(i, x)
    }
    wg.Wait()
    return out
}

func main() {
    fmt.Println(parallelSquare([]int{1, 2, 3, 4, 5}))
}
```

Note: each goroutine writes to a unique index of `out`, so no mutex is needed.

---

## Task 5 — collect first error

Goal: given functions `f1`, `f2`, `f3` that each return `error`, run them in parallel, return the *first* non-nil error and `nil` if all succeed. Do not use `errgroup`; use raw WaitGroup + channel.

**Solution.**

```go
package main

import (
    "errors"
    "fmt"
    "sync"
)

func runAll(fns ...func() error) error {
    errs := make(chan error, len(fns))
    var wg sync.WaitGroup
    wg.Add(len(fns))
    for _, fn := range fns {
        go func(fn func() error) {
            defer wg.Done()
            if err := fn(); err != nil {
                errs <- err
            }
        }(fn)
    }
    wg.Wait()
    close(errs)
    for err := range errs {
        return err          // first received
    }
    return nil
}

func main() {
    err := runAll(
        func() error { return nil },
        func() error { return errors.New("boom") },
        func() error { return nil },
    )
    fmt.Println(err)
}
```

Note: the buffered channel must hold one entry per worker, otherwise sends could block forever after `Wait` is in progress.

---

## Task 6 — bounded recursive crawler

Goal: starting from `root`, recursively process all reachable items by calling `children(item)`. Each call may discover new items. Use a WaitGroup for termination. Don't worry about cycles for this task.

```go
type Item int
func children(it Item) []Item { /* given */ return nil }
func process(it Item)         { /* given */ }
```

**Solution.**

```go
package main

import "sync"

type Item int

func children(it Item) []Item { return nil }
func process(it Item)         {}

func crawl(root Item) {
    var wg sync.WaitGroup
    var visit func(Item)
    visit = func(it Item) {
        defer wg.Done()
        process(it)
        for _, child := range children(it) {
            wg.Add(1)
            go visit(child)
        }
    }

    wg.Add(1)
    go visit(root)
    wg.Wait()
}
```

`Add(1)` runs *before* the corresponding `go visit(child)`. Each spawned visit eventually calls `wg.Done` via defer.

---

## Task 7 — graceful server shutdown

Goal: a `Server` accepts work via `Submit(task func())`. On `Shutdown(ctx)` it should refuse new tasks, wait for outstanding ones to finish, and return either `nil` or `ctx.Err()` if the grace period expires.

Skeleton:

```go
type Server struct {
    wg       sync.WaitGroup
    stopCh   chan struct{}
    once     sync.Once
}

func (s *Server) Submit(task func()) error { /* ... */ }
func (s *Server) Shutdown(ctx context.Context) error { /* ... */ }
```

**Solution.**

```go
package main

import (
    "context"
    "errors"
    "sync"
)

type Server struct {
    wg     sync.WaitGroup
    stopCh chan struct{}
    once   sync.Once
}

func NewServer() *Server { return &Server{stopCh: make(chan struct{})} }

func (s *Server) Submit(task func()) error {
    select {
    case <-s.stopCh:
        return errors.New("server shutting down")
    default:
    }
    s.wg.Add(1)
    go func() {
        defer s.wg.Done()
        task()
    }()
    return nil
}

func (s *Server) Shutdown(ctx context.Context) error {
    s.once.Do(func() { close(s.stopCh) })
    done := make(chan struct{})
    go func() { s.wg.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

The TOCTOU between the `select` and `wg.Add(1)` is intentional — we accept the race window and round-trip again with `select` if needed in production code. For most servers this is fine; if not, gate the `Add` with a mutex.

---

## Task 8 — test that uses WaitGroup

Goal: write a test for `Server` from Task 7. The test submits 100 tasks, each sleeping 10ms, and asserts that `Shutdown(ctx)` returns `nil` within 5 seconds.

**Solution.**

```go
func TestServerShutdown(t *testing.T) {
    s := NewServer()
    for i := 0; i < 100; i++ {
        if err := s.Submit(func() { time.Sleep(10 * time.Millisecond) }); err != nil {
            t.Fatal(err)
        }
    }
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    if err := s.Shutdown(ctx); err != nil {
        t.Fatalf("Shutdown returned %v, want nil", err)
    }
    if err := s.Submit(func() {}); err == nil {
        t.Fatal("Submit after Shutdown should fail")
    }
}
```

---

## Task 9 — concurrent map build

Goal: given a slice `items []string`, build a `map[string]int` where the value is `len(item)`, in parallel. The map must be safe to read from after the parallel section.

**Solution.**

```go
func buildMap(items []string) map[string]int {
    out := make(map[string]int, len(items))
    var mu sync.Mutex
    var wg sync.WaitGroup
    wg.Add(len(items))
    for _, it := range items {
        go func(it string) {
            defer wg.Done()
            v := len(it)
            mu.Lock()
            out[it] = v
            mu.Unlock()
        }(it)
    }
    wg.Wait()
    return out
}
```

A common mistake here is to skip the mutex because "WaitGroup synchronises". WaitGroup synchronises *between* the goroutines and the consumer after `Wait`, but does *not* synchronise concurrent goroutines writing to the same map. Maps require a mutex.

For higher throughput consider building per-goroutine partial maps and merging, or using `sync.Map`.

---

## Task 10 — cancellable parallel fetch

Goal: given a slice of URLs and a `context.Context`, fetch each in parallel. If any fetch fails, cancel the rest. Do not use `errgroup`; use WaitGroup, a context, and a channel.

**Solution.**

```go
func fetchAll(parent context.Context, urls []string) error {
    ctx, cancel := context.WithCancel(parent)
    defer cancel()

    errs := make(chan error, len(urls))
    var wg sync.WaitGroup
    wg.Add(len(urls))

    for _, u := range urls {
        go func(u string) {
            defer wg.Done()
            req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
            resp, err := http.DefaultClient.Do(req)
            if err != nil {
                errs <- err
                cancel()                 // tell siblings to stop
                return
            }
            resp.Body.Close()
        }(u)
    }

    wg.Wait()
    close(errs)
    for err := range errs {
        return err
    }
    return nil
}
```

This is essentially what `errgroup.WithContext` provides. Using `errgroup` is shorter and clearer in real code.

---

## Task 11 — reusable WaitGroup with rounds

Goal: implement a `Coordinator` that runs `RunRound(items []int)` multiple times, using the *same* WaitGroup across rounds. Each round processes all items in parallel and returns when they finish.

**Solution.**

```go
type Coordinator struct{ wg sync.WaitGroup }

func (c *Coordinator) RunRound(items []int) {
    c.wg.Add(len(items))
    for _, it := range items {
        go func(it int) {
            defer c.wg.Done()
            process(it)
        }(it)
    }
    c.wg.Wait()
}

func process(int) {}
```

This is safe because each `RunRound` call is fully sequenced: `Add` returns before any goroutine starts, and the next `RunRound`'s `Add` cannot happen until the previous `Wait` has returned.

---

## Task 12 — implement `Parallel[T]`

Goal: write a generic helper:

```go
func Parallel[T any](inputs []T, f func(T) T) []T
```

that maps `f` over `inputs` in parallel and returns a result slice in the same order.

**Solution.**

```go
func Parallel[T any](inputs []T, f func(T) T) []T {
    out := make([]T, len(inputs))
    var wg sync.WaitGroup
    wg.Add(len(inputs))
    for i, x := range inputs {
        go func(i int, x T) {
            defer wg.Done()
            out[i] = f(x)
        }(i, x)
    }
    wg.Wait()
    return out
}
```

Test:

```go
fmt.Println(Parallel([]int{1, 2, 3}, func(x int) int { return x * 10 }))
// [10 20 30]
```

---

## Task 13 — timeout on `Wait`

Goal: write a helper that calls `wg.Wait()` but returns false if it doesn't complete within `d`.

```go
func WaitTimeout(wg *sync.WaitGroup, d time.Duration) bool
```

**Solution.**

```go
func WaitTimeout(wg *sync.WaitGroup, d time.Duration) bool {
    done := make(chan struct{})
    go func() {
        wg.Wait()
        close(done)
    }()
    select {
    case <-done:
        return true
    case <-time.After(d):
        return false
    }
}
```

Caveat: if the timeout fires, the wrapper goroutine leaks until the WaitGroup actually drains. Document this.

---

## Task 14 — count completions on a channel

Goal: replace this WaitGroup with a counting channel. Equivalent behaviour, no `sync.WaitGroup`.

```go
var wg sync.WaitGroup
wg.Add(n)
for i := 0; i < n; i++ {
    go func() {
        defer wg.Done()
        work()
    }()
}
wg.Wait()
```

**Solution.**

```go
done := make(chan struct{}, n)
for i := 0; i < n; i++ {
    go func() {
        work()
        done <- struct{}{}
    }()
}
for i := 0; i < n; i++ {
    <-done
}
```

This is verbose but useful when you also want to `select` with a timeout or context.

---

## Task 15 — bug bait

Find and fix all bugs in:

```go
func processAll(items []Item) {
    var wg sync.WaitGroup
    for _, it := range items {
        go func() {
            wg.Add(1)
            defer wg.Done()
            process(it)
        }()
    }
    wg.Wait()
}
```

**Bugs.**

1. `wg.Add(1)` is inside the goroutine — races with `Wait`.
2. `it` is captured from the loop variable; depending on Go version, multiple goroutines may see the last value.

**Fix.**

```go
func processAll(items []Item) {
    var wg sync.WaitGroup
    wg.Add(len(items))
    for _, it := range items {
        go func(it Item) {
            defer wg.Done()
            process(it)
        }(it)
    }
    wg.Wait()
}
```

(In Go 1.22+ the loop-variable capture is fixed at the language level, but explicit parameter passing is still clearer.)

---

## Task 16 — embed safely

Bug:

```go
type Pool struct{ sync.WaitGroup }

func (p Pool) Run(f func()) {
    p.Add(1)
    go func() { defer p.Done(); f() }()
}
```

Fix and explain.

**Solution.**

```go
type Pool struct{ wg sync.WaitGroup }

func (p *Pool) Run(f func()) {
    p.wg.Add(1)
    go func() { defer p.wg.Done(); f() }()
}

func (p *Pool) Wait() { p.wg.Wait() }
```

Two changes:

1. Pointer receiver, so `p.wg` is the shared WaitGroup, not a copy.
2. Stop embedding so `Add`, `Done`, `Wait` aren't accidentally exposed and copied via the type's value methods.

---

## Going further

- [find-bug.md](find-bug.md) for explicit broken-code exercises with discussion.
- [optimize.md](optimize.md) for "this WaitGroup code is too slow" exercises.
- The Go test suite in `src/sync/waitgroup_test.go` is worth reading for the corner cases the standard library itself tests.
