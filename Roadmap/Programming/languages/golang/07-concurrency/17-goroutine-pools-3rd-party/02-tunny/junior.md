---
layout: default
title: Junior
parent: tunny
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/02-tunny/junior/
---

# tunny — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Installing tunny](#installing-tunny)
5. [Your First Pool](#your-first-pool)
6. [The Mental Model](#the-mental-model)
7. [Anatomy of NewFunc](#anatomy-of-newfunc)
8. [Calling Process](#calling-process)
9. [The Return Value](#the-return-value)
10. [Closing the Pool](#closing-the-pool)
11. [Pool Size — Why Not 1000?](#pool-size-why-not-1000)
12. [Concurrent Callers](#concurrent-callers)
13. [Worked Examples](#worked-examples)
14. [Real-World Analogies](#real-world-analogies)
15. [Coding Patterns](#coding-patterns)
16. [Clean Code](#clean-code)
17. [Error Handling](#error-handling)
18. [Performance Tips](#performance-tips)
19. [Best Practices](#best-practices)
20. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
21. [Common Mistakes](#common-mistakes)
22. [Common Misconceptions](#common-misconceptions)
23. [Tricky Points](#tricky-points)
24. [Test Yourself](#test-yourself)
25. [Tricky Questions](#tricky-questions)
26. [Cheat Sheet](#cheat-sheet)
27. [Self-Assessment Checklist](#self-assessment-checklist)
28. [Summary](#summary)
29. [What You Can Build Now](#what-you-can-build-now)
30. [Further Reading](#further-reading)
31. [Related Topics](#related-topics)
32. [Diagrams](#diagrams)

---

## Introduction
> Focus: "How do I create a tunny pool, send work to it, get a result back, and shut it down cleanly?"

This file teaches you the minimum amount of tunny needed to use it productively in a real Go project. By the end you will:

- Know what `tunny.NewFunc` does and what it gives you back
- Know what `Process` actually does to the calling goroutine
- Know how to type-assert the `any` return value safely
- Know why you must `Close` the pool, and when
- Have a feel for choosing the pool size
- Have written at least five small programs using a pool

You do NOT need to know the `Worker` interface yet — that is the middle level. You do not need to know about `ProcessTimed`, `ProcessCtx`, callbacks, or internals. You need to know enough to confidently write a 30-line program that uses a pool for a real CPU-bound task — say, hashing strings or resizing thumbnails.

The single sentence you should leave this file with is:

> A tunny pool is `N` permanent goroutines waiting for payloads. You call `pool.Process(x)`, one of those goroutines wakes up, runs your function with `x`, and you get the answer back on the same line of code. If all `N` are busy, you wait.

That is the entire mental model. Everything else is a refinement.

---

## Prerequisites

Before reading this file you should already be comfortable with:

- **Goroutines and `go` keyword** — you have spawned a goroutine and know that `main` exiting kills them all.
- **Channels at a basic level** — you do not need to know `select` deeply, but you should have used `ch <- x` and `<-ch` at least a few times. Tunny hides channels from you, but they are inside it and influence its behaviour.
- **`sync.WaitGroup`** — to coordinate the examples below, we will sometimes wait for multiple callers.
- **The empty interface `any` (formerly `interface{}`)** — tunny's API uses `any` heavily for the payload and return value. You should be comfortable with a type assertion like `result.(string)`.
- **Go modules** — you should be able to run `go mod init` and `go get` a third-party dependency.
- **The `runtime` package, at least `runtime.NumCPU()`** — most tunny examples size the pool to the number of CPU cores.

If you are missing any of these, take a detour to the relevant chapter before continuing. None of them are large.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Pool** | A `*tunny.Pool` value. The fixed-size collection of worker goroutines. Created with `New`, `NewFunc`, or `NewCallback`. |
| **Worker** | One goroutine inside the pool. A pool of size 8 contains 8 worker goroutines. Each one runs the same logic but processes payloads one at a time. |
| **Payload** | The `any` value you pass into `Process`. Whatever your function expects: an `int`, a `string`, a `[]byte`, a custom struct — anything. |
| **Process** | The synchronous call that submits a payload and waits for the result. `result := pool.Process(payload)`. |
| **Result** | The `any` value returned by `Process`. Whatever your function returned. You must type-assert it before use. |
| **`tunny.NewFunc`** | Helper constructor that wraps a `func(any) any` as a stateless worker. Easiest entry point. |
| **`tunny.New`** | Full constructor that takes a factory of `Worker` interface values. Used at the middle level. |
| **`Close`** | The shutdown method. Stops all workers and prevents further calls to `Process`. |
| **Pool size `n`** | The integer passed to `NewFunc(n, ...)`. The number of payloads that may be in flight at once. |
| **In flight** | A payload that is currently being processed by some worker. A pool of size 8 can have up to 8 in flight at once. |
| **Backpressure** | The blocking behaviour of `Process` when all workers are busy. Callers are forced to wait — this is a feature, not a bug. |
| **Stateless worker** | A worker that holds no per-worker memory between calls. The function passed to `NewFunc` is stateless by default. |
| **`runtime.NumCPU`** | Standard library helper. Returns the number of logical CPU cores. A common default pool size for CPU-bound work. |

---

## Installing tunny

Tunny lives on GitHub at [https://github.com/Jeffail/tunny](https://github.com/Jeffail/tunny). It is a single-file library with no transitive dependencies, which makes it pleasantly cheap to add.

Create a fresh module:

```bash
mkdir tunny-playground && cd tunny-playground
go mod init example.com/tunnyplay
go get github.com/Jeffail/tunny
```

After `go get`, your `go.mod` will look something like:

```text
module example.com/tunnyplay

go 1.22

require github.com/Jeffail/tunny v0.1.4
```

The exact version may differ. The package import path is `github.com/Jeffail/tunny`. The package name inside Go code is `tunny`. So:

```go
import "github.com/Jeffail/tunny"
```

If you are working in an offline environment without `go get`, you can also vendor the file — it is a few hundred lines of Go. But you almost never need to.

---

## Your First Pool

Let us write the smallest program that exercises a tunny pool end-to-end:

```go
package main

import (
    "fmt"

    "github.com/Jeffail/tunny"
)

func main() {
    pool := tunny.NewFunc(4, func(payload any) any {
        n := payload.(int)
        return n * n
    })
    defer pool.Close()

    out := pool.Process(9)
    fmt.Println(out) // 81
}
```

Save as `main.go`, then:

```bash
go run main.go
```

Output:

```
81
```

What just happened, step by step:

1. `tunny.NewFunc(4, ...)` started a goroutine pool with 4 worker goroutines. Each one is sitting on an internal channel waiting for a payload.
2. We arranged with `defer pool.Close()` to shut the pool down when `main` returns.
3. `pool.Process(9)` sent `9` to the pool's internal channel. One of the 4 workers picked it up, called our function with `payload = 9`, computed `9*9 = 81`, and sent it back to the calling goroutine.
4. The call returned `81` as an `any`. We printed it.

You should pause here and play with the code. Try size 1 instead of 4. Try size 100. Try changing the function to print a message:

```go
pool := tunny.NewFunc(4, func(payload any) any {
    fmt.Println("worker received:", payload)
    n := payload.(int)
    return n * n
})
```

Now you can see, for a single call, the worker is in fact a separate function execution.

---

## The Mental Model

Before we go deeper, anchor the picture in your head:

```
                ┌─────────────────────────────────────────┐
                │              tunny.Pool                  │
                │                                          │
  Process(x) ──▶│   internal request channel               │
                │              ▼                           │
                │   ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐    │
                │   │ W1   │ │ W2   │ │ W3   │ │ W4   │    │
                │   └──────┘ └──────┘ └──────┘ └──────┘    │
                │       │       │       │       │         │
                │       ▼       ▼       ▼       ▼         │
                │      f(x)    f(x)    f(x)    f(x)        │
                │       │       │       │       │         │
                │       └───────┴───┬───┴───────┘         │
                │                   ▼                      │
                │       result channel back to caller      │
                └─────────────────────────────────────────┘
```

- The boxes `W1..W4` are goroutines. They were created when you called `NewFunc(4, ...)` and live until you call `Close`.
- The arrows show payloads flowing in from the left and results flowing out at the bottom.
- The pool exposes only two methods at this level: `Process(payload)` and `Close()`. Everything else is internal.

Three properties follow from this picture:

1. **Bounded concurrency.** There are exactly `n` workers, so at most `n` invocations of your function are running at the same time.
2. **Reuse of goroutines.** Each worker survives many calls. There is no goroutine startup cost per payload — only the cost of a channel send and receive.
3. **Backpressure for free.** If you have 4 workers and 1000 callers, 4 of them get served first and 996 of them are blocked inside `Process` on the internal channel until a worker becomes free.

This last property is why people reach for tunny in production: backpressure is automatic. You cannot accidentally spawn 100k goroutines, because there is no `go` keyword in your code.

---

## Anatomy of NewFunc

Let us look at the signature of `tunny.NewFunc` in detail:

```go
func NewFunc(n int, f func(payload interface{}) interface{}) *Pool
```

(`interface{}` and `any` are synonyms in modern Go; the upstream package still uses the older spelling on the function type.)

Three things to notice:

- **`n int`** is the pool size. It must be at least 1. Passing 0 or a negative number panics. If you only need a pool of size 1 you can use tunny — but you might as well just call the function directly. Pools of size 1 do exist in production (rate-limited APIs, single-GPU inference) and they are legal.
- **`f func(any) any`** is the worker function. It is **stateless** — the same function value is used by every worker. If you want per-worker state, use `tunny.New` (middle level).
- **Returns `*Pool`** — a pointer. You will pass this around your program. It is safe to share among goroutines.

A few small constructors to internalise the shape:

```go
// Pool of 1: a queue of CPU-bound jobs that must run one at a time.
p1 := tunny.NewFunc(1, func(payload any) any {
    return "ok"
})

// Pool of NumCPU(): the standard CPU-bound default.
p2 := tunny.NewFunc(runtime.NumCPU(), func(payload any) any {
    return strings.ToUpper(payload.(string))
})

// Pool of 100: rarely useful for CPU-bound, but valid.
p3 := tunny.NewFunc(100, func(payload any) any {
    return nil
})
```

All three are real pools. They are not lazy — those goroutines exist as soon as `NewFunc` returns.

You can verify this with `runtime.NumGoroutine`:

```go
fmt.Println("before:", runtime.NumGoroutine())
pool := tunny.NewFunc(8, func(any) any { return nil })
fmt.Println("after:", runtime.NumGoroutine())
pool.Close()
fmt.Println("closed:", runtime.NumGoroutine())
```

Approximate output:

```
before: 1
after: 9
closed: 1
```

The `+8` you see is the workers. The `-8` after `Close` is them exiting.

---

## Calling Process

```go
func (p *Pool) Process(payload interface{}) interface{}
```

`Process` is the synchronous submission method. Three facts you must internalise:

### Fact 1 — `Process` blocks the caller

The goroutine that calls `Process` is suspended until the worker has finished. From the caller's point of view, this looks exactly like a regular function call:

```go
result := pool.Process("hello")
fmt.Println(result)
```

Only difference: the work is being done in a worker goroutine, not in the caller's. This matters because it means:

- The caller can be inside another goroutine (e.g. an HTTP handler) — multiple HTTP handlers can call `Process` concurrently. The pool will keep at most `n` of them running at any moment.
- The caller can be `main`, and `main` will block. Until `Process` returns, `main` is not doing anything else.

### Fact 2 — `Process` does not return errors

There is no `error` return. If your function panics inside the worker, tunny will not catch and rethrow it nicely. (We will see in the senior file how a panic actually propagates.) For now: encode failures in your return value.

A common pattern:

```go
type Result struct {
    Value string
    Err   error
}

pool := tunny.NewFunc(4, func(payload any) any {
    path := payload.(string)
    data, err := os.ReadFile(path)
    if err != nil {
        return Result{Err: err}
    }
    return Result{Value: string(data)}
})

r := pool.Process("/etc/hostname").(Result)
if r.Err != nil {
    log.Fatal(r.Err)
}
fmt.Println(r.Value)
```

### Fact 3 — the payload type and return type are not constrained

The function declared in `NewFunc` takes `any` and returns `any`. The compiler will not check that your callers pass the right type. If you make a mistake — pass a `string` to a function expecting `int` — the type assertion inside the function will panic at runtime.

A defensive worker:

```go
pool := tunny.NewFunc(4, func(payload any) any {
    n, ok := payload.(int)
    if !ok {
        return fmt.Errorf("expected int, got %T", payload)
    }
    return n * n
})
```

This is a tax you pay for using tunny — type safety is on you, not on the library. We will see ways to mitigate this with generic wrapper functions in later sections.

---

## The Return Value

`Process` returns `any`. You almost always need to assert it before use:

```go
out := pool.Process(9)
n := out.(int)
fmt.Println(n + 1)
```

If the worker actually returned a string, this assertion panics with a runtime error. So either:

1. Trust the worker function entirely (small programs, you wrote both sides).
2. Use the comma-ok form to recover gracefully:

```go
if n, ok := out.(int); ok {
    fmt.Println(n + 1)
} else {
    log.Printf("unexpected result type: %T", out)
}
```

3. Wrap every job in a known result type, as in the `Result` struct above. This is the production pattern.

### Returning multiple values

Go functions can return multiple values, but tunny's worker function cannot — it returns exactly one `any`. To return multiple things, return a struct or a slice:

```go
type DivResult struct {
    Quotient  int
    Remainder int
}

pool := tunny.NewFunc(4, func(payload any) any {
    pair := payload.([2]int)
    return DivResult{
        Quotient:  pair[0] / pair[1],
        Remainder: pair[0] % pair[1],
    }
})

r := pool.Process([2]int{17, 5}).(DivResult)
fmt.Println(r.Quotient, r.Remainder) // 3 2
```

This shape — payload struct in, result struct out — scales well as your worker grows.

### Returning nothing

If you do not need a result, just return `nil`:

```go
pool := tunny.NewFunc(4, func(payload any) any {
    fmt.Println("processed:", payload)
    return nil
})

pool.Process("apple")
pool.Process("banana")
```

You still pay the cost of the round-trip — the caller still blocks until the worker is done. If you wanted to fire and forget, tunny is the wrong tool.

---

## Closing the Pool

```go
func (p *Pool) Close()
```

`Close` shuts the pool down. After it returns:

- All worker goroutines have exited.
- The pool's internal channels are closed.
- Calling `Process` on the closed pool will panic (more on this below).

Standard idiom:

```go
pool := tunny.NewFunc(4, work)
defer pool.Close()
```

This is the most common form. The `defer` runs when the surrounding function returns, which for `main` is at program exit. For test functions, it is at the end of the test.

### Why must I `Close`?

If you never call `Close`, the worker goroutines never exit. They remain alive, parked on the internal channel, until the program ends. For small programs this is harmless — but in long-running services, leaking workers across pool instances is a real memory and goroutine count problem.

Always `Close` what you `New`. The deferred pattern makes this automatic.

### What if I call `Close` twice?

Calling `Close` more than once panics:

```
panic: send on closed channel
```

This is a real footgun. To be safe, only one piece of code should own the lifecycle of a pool. Make a clear owner — the function that called `NewFunc` is the function that calls `Close`.

If you need to share a pool between functions, pass the `*Pool` around but keep the `Close` call in one place.

### What if I call `Process` after `Close`?

You will get a panic. Tunny does not give you a "is this pool open?" predicate. Either:

- Structure your code so `Close` is called only when nobody can possibly call `Process` again. This is the right answer 95% of the time.
- Wrap the pool in your own struct that tracks the open/closed state. We will see this in the middle file.

### Close vs cancellation

`Close` is for **shutdown**. It is not a tool for cancelling individual in-flight calls. If a worker is in the middle of a 5-second computation and you call `Close`, the worker finishes its current job before exiting (because that is how the loop is written internally). To cancel an in-flight call you need `ProcessTimed` or `ProcessCtx` — middle level.

---

## Pool Size — Why Not 1000?

The size you pass to `NewFunc` is one of the few real decisions you must make. The wrong size hurts in two opposite ways:

- **Too small:** workers are idle and `Process` calls queue up. Throughput drops.
- **Too large:** all workers can run at once but they contend for CPU, cache, memory bandwidth. Latency rises, throughput plateaus or falls.

There is no universal right answer. There are good defaults:

### Default: `runtime.NumCPU()` for CPU-bound work

If your worker function is doing computation — hashing, compressing, image transforms, math — match the pool size to the number of logical cores. Once all cores are saturated, more workers do not help; they just fight each other.

```go
pool := tunny.NewFunc(runtime.NumCPU(), workerFn)
```

This is the line you will write most often.

### Default: `2 * runtime.NumCPU()` for mostly-CPU, occasional IO

If your worker does mostly computation but occasionally hits the disk or makes a tiny network call, doubling lets one worker run while another waits.

### Default: much larger for IO-bound work

If your worker is mostly making HTTP calls, 100 or 1000 might be right. But — and this is important — if your work is IO-bound, **tunny is probably the wrong tool**. Pure IO does not need a pool; it just needs goroutines. Tunny shines when each task is non-trivial CPU work that you want to bound.

### Measuring

The honest answer to "what size?" is **measure**. Write a benchmark. Run it with sizes 1, 2, 4, 8, 16, 32. Plot throughput. Pick the smallest size that gets you near the top.

```go
func BenchmarkPoolSize8(b *testing.B) {
    pool := tunny.NewFunc(8, func(any) any {
        return work()
    })
    defer pool.Close()
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            pool.Process(nil)
        }
    })
}
```

We will revisit sizing properly in `optimize.md`. For now: start with `runtime.NumCPU()`, do not exceed it without a reason.

---

## Concurrent Callers

Tunny only shines when you have **more callers than workers**. Otherwise the pool is overkill — just call your function directly.

A typical scenario: an HTTP server with one goroutine per request. Each handler calls `pool.Process(req)`. Many handlers run at once. The pool ensures only `n` of them are actively computing.

Here is a self-contained demonstration:

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"

    "github.com/Jeffail/tunny"
)

func main() {
    pool := tunny.NewFunc(4, func(payload any) any {
        // Simulate 100 ms of CPU-bound work.
        start := time.Now()
        for time.Since(start) < 100*time.Millisecond {
        }
        return payload
    })
    defer pool.Close()

    var wg sync.WaitGroup
    start := time.Now()

    for i := 0; i < 20; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            result := pool.Process(i)
            fmt.Printf("job %v done at %v\n", result, time.Since(start).Round(time.Millisecond))
        }(i)
    }

    wg.Wait()
    fmt.Printf("total: %v\n", time.Since(start).Round(time.Millisecond))
    fmt.Println("goroutines used:", runtime.NumCPU())
}
```

With a pool of 4 and 20 jobs of 100 ms each, the total elapsed time should be roughly `20 / 4 * 100 ms = 500 ms`. The jobs finish in waves of four. If you change the pool size to 1 you should see 2 seconds, and if you change it to 20 you should see about 100 ms (cores permitting).

That is the entire reason to use tunny: turning N jobs into ~N/poolSize wall time.

---

## Worked Examples

### Example 1: Word count over many files

```go
package main

import (
    "fmt"
    "os"
    "path/filepath"
    "runtime"
    "strings"
    "sync"

    "github.com/Jeffail/tunny"
)

func main() {
    paths, err := filepath.Glob("./texts/*.txt")
    if err != nil {
        panic(err)
    }

    pool := tunny.NewFunc(runtime.NumCPU(), func(payload any) any {
        path := payload.(string)
        data, err := os.ReadFile(path)
        if err != nil {
            return -1
        }
        return len(strings.Fields(string(data)))
    })
    defer pool.Close()

    var wg sync.WaitGroup
    results := make(map[string]int)
    var mu sync.Mutex

    for _, p := range paths {
        wg.Add(1)
        go func(p string) {
            defer wg.Done()
            count := pool.Process(p).(int)
            mu.Lock()
            results[p] = count
            mu.Unlock()
        }(p)
    }
    wg.Wait()

    total := 0
    for path, n := range results {
        fmt.Printf("%s: %d words\n", path, n)
        total += n
    }
    fmt.Println("total:", total)
}
```

This is a real-shaped program. Note:

- One goroutine per file, but no more than `NumCPU` are *computing* at once.
- The map is protected by a mutex because many goroutines write to it.
- Errors are encoded by returning -1. In production you would use a result struct.

### Example 2: Parallel SHA-256

```go
package main

import (
    "crypto/sha256"
    "encoding/hex"
    "fmt"
    "runtime"
    "sync"

    "github.com/Jeffail/tunny"
)

func main() {
    pool := tunny.NewFunc(runtime.NumCPU(), func(payload any) any {
        data := payload.([]byte)
        sum := sha256.Sum256(data)
        return hex.EncodeToString(sum[:])
    })
    defer pool.Close()

    inputs := [][]byte{
        []byte("apple"),
        []byte("banana"),
        []byte("cherry"),
        []byte("durian"),
    }

    var wg sync.WaitGroup
    for _, in := range inputs {
        wg.Add(1)
        go func(in []byte) {
            defer wg.Done()
            hash := pool.Process(in).(string)
            fmt.Printf("%s -> %s\n", in, hash)
        }(in)
    }
    wg.Wait()
}
```

Tiny program, but it illustrates a common production shape: hash a batch of buffers in parallel without spawning N goroutines.

### Example 3: Bounded transformation pipeline

```go
package main

import (
    "fmt"
    "runtime"
    "strings"

    "github.com/Jeffail/tunny"
)

func main() {
    pool := tunny.NewFunc(runtime.NumCPU(), func(payload any) any {
        s := payload.(string)
        return strings.ToUpper(s) + "!"
    })
    defer pool.Close()

    lines := []string{"hello", "world", "tunny", "is", "fun"}

    results := make([]string, len(lines))
    done := make(chan struct{}, len(lines))

    for i, line := range lines {
        go func(i int, line string) {
            results[i] = pool.Process(line).(string)
            done <- struct{}{}
        }(i, line)
    }

    for range lines {
        <-done
    }

    for _, r := range results {
        fmt.Println(r)
    }
}
```

Note the `results[i]` pattern — each goroutine writes to its own slot in the slice, so no lock is needed. This is a classic "scatter, write-by-index, gather" shape.

### Example 4: Pool as a singleton inside a service

```go
package work

import (
    "runtime"
    "strings"
    "sync"

    "github.com/Jeffail/tunny"
)

var (
    poolOnce sync.Once
    pool     *tunny.Pool
)

func initPool() {
    pool = tunny.NewFunc(runtime.NumCPU(), func(payload any) any {
        return strings.ToLower(payload.(string))
    })
}

// Lower normalises a string using the package's shared pool.
func Lower(s string) string {
    poolOnce.Do(initPool)
    return pool.Process(s).(string)
}
```

This is how tunny pools usually live in real codebases: as a lazily-initialised singleton inside a small `work` or `internal/pipeline` package.

### Example 5: A read-only HTTP echo on top of a pool

```go
package main

import (
    "fmt"
    "io"
    "net/http"
    "runtime"
    "strings"

    "github.com/Jeffail/tunny"
)

func main() {
    pool := tunny.NewFunc(runtime.NumCPU(), func(payload any) any {
        body := payload.(string)
        return strings.ToUpper(body)
    })
    defer pool.Close()

    http.HandleFunc("/upper", func(w http.ResponseWriter, r *http.Request) {
        body, err := io.ReadAll(r.Body)
        if err != nil {
            http.Error(w, err.Error(), 400)
            return
        }
        result := pool.Process(string(body)).(string)
        fmt.Fprint(w, result)
    })

    if err := http.ListenAndServe(":8080", nil); err != nil {
        panic(err)
    }
}
```

Every incoming HTTP request gets its own goroutine (the standard library does that for you). Each handler calls `Process`. The pool caps the actual CPU-bound work at `NumCPU`, regardless of how many concurrent requests arrive.

Test with:

```bash
curl -d 'hello world' http://localhost:8080/upper
```

You should see `HELLO WORLD`. Under load (`hey`, `wrk`, `k6`), you should see latency climb gracefully rather than the box catching fire.

---

## Real-World Analogies

- **A copy shop with 4 photocopiers.** Customers (callers) walk in with documents (payloads). Each photocopier (worker) handles one document at a time. If 10 customers arrive at once, 4 are served and 6 stand in line. When a copier is free, the next customer steps up. The shop never tries to clone its photocopiers under load — it just makes the queue grow. The customer at the back blocks until it is their turn.
- **A coffee shop with N baristas.** Same shape. Orders are payloads, drinks are results. The customer at the counter does not return to their seat until the drink is in their hand — `Process` is synchronous.
- **A car wash with `n` bays.** Cars are payloads, washed cars are results. The bay is a worker goroutine. The car owner waits at the exit until their car emerges.
- **A bank with `n` tellers.** This is the classic queueing analogy. The teller is the worker, the customer is the calling goroutine.

In every analogy: the pool size is **what limits the world**. You cannot have 9 cars being washed at a 4-bay car wash. You cannot have 9 payloads being processed in a tunny pool of size 4.

---

## Coding Patterns

### Pattern: tiny adapter for type safety

The `any`-in, `any`-out signature is ergonomically painful in larger programs. Wrap it with a typed helper:

```go
type StringPool struct {
    inner *tunny.Pool
}

func NewStringPool(n int, f func(string) string) *StringPool {
    return &StringPool{
        inner: tunny.NewFunc(n, func(payload any) any {
            return f(payload.(string))
        }),
    }
}

func (p *StringPool) Process(s string) string {
    return p.inner.Process(s).(string)
}

func (p *StringPool) Close() {
    p.inner.Close()
}
```

Now the callers cannot pass an `int` by accident — the compiler will refuse to compile.

In modern Go you can generalise this with type parameters:

```go
type TypedPool[In, Out any] struct {
    inner *tunny.Pool
}

func NewTyped[In, Out any](n int, f func(In) Out) *TypedPool[In, Out] {
    return &TypedPool[In, Out]{
        inner: tunny.NewFunc(n, func(payload any) any {
            return f(payload.(In))
        }),
    }
}

func (p *TypedPool[In, Out]) Process(in In) Out {
    return p.inner.Process(in).(Out)
}

func (p *TypedPool[In, Out]) Close() { p.inner.Close() }
```

Usage:

```go
square := NewTyped(4, func(n int) int { return n * n })
defer square.Close()
fmt.Println(square.Process(7)) // 49
```

The compiler now enforces the type at every callsite. This is the recommended shape for any non-trivial use of tunny in a typed Go codebase. We will revisit it in `middle.md` with `ProcessTimed`-aware variants.

### Pattern: result envelope

Always wrap your result in a small struct with an error field. Even if you do not need it today, you almost certainly will tomorrow:

```go
type Job struct {
    URL string
}

type JobResult struct {
    URL    string
    Status int
    Err    error
}

pool := tunny.NewFunc(runtime.NumCPU(), func(payload any) any {
    job := payload.(Job)
    resp, err := http.Get(job.URL)
    if err != nil {
        return JobResult{URL: job.URL, Err: err}
    }
    defer resp.Body.Close()
    return JobResult{URL: job.URL, Status: resp.StatusCode}
})
```

This pattern survives almost any refactor: you can add fields to `JobResult` without changing the pool's signature.

### Pattern: one pool per workload kind

Resist the urge to create a generic pool that handles multiple kinds of work. Tunny is cheap — make a pool per workload. A pool for image resizing, a pool for PDF generation, a pool for JSON validation. Each one has its own sensible size and its own clear ownership.

```go
type Services struct {
    Resize   *tunny.Pool
    Validate *tunny.Pool
    Render   *tunny.Pool
}

func NewServices() *Services {
    return &Services{
        Resize:   tunny.NewFunc(runtime.NumCPU(), resizeFn),
        Validate: tunny.NewFunc(runtime.NumCPU()*2, validateFn),
        Render:   tunny.NewFunc(2, renderFn),
    }
}

func (s *Services) Close() {
    s.Resize.Close()
    s.Validate.Close()
    s.Render.Close()
}
```

This is the production shape. We will see it again in `professional.md`.

---

## Clean Code

A few habits will save you future pain:

- **Always `defer pool.Close()`** immediately after `tunny.NewFunc`. Do not separate them. The pair belongs together like `os.Open` / `f.Close`.
- **Name the variable `pool`** if you have only one, or `<thing>Pool` if you have several. `p` is OK for very short examples; `pool` is better in production code.
- **Keep the worker function short**. If it grows past 20 lines, extract a named function and pass it in:

```go
func resize(payload any) any {
    in := payload.(ResizeReq)
    // ... 100 lines
    return ResizeRes{...}
}

pool := tunny.NewFunc(runtime.NumCPU(), resize)
```

- **Do not capture mutable state in the closure.** If you must, document it and protect it with a mutex.
- **Resist creating a pool inside a frequently-called function.** Pools belong at the top of your service, near the lifetime of the program.
- **Use a typed wrapper** as shown above. The `any` interface is a maintenance liability beyond toy programs.

---

## Error Handling

Tunny's API has no `error` return. That is a deliberate decision: the library is a transport, not a framework. The two channels by which errors reach you:

### 1. Encoded in the return value

This is the recommended pattern, shown several times above. Wrap your result in a struct that has an `Err error` field. Check it at the call site.

### 2. Via panic

If your worker function panics, the panic happens in the worker goroutine. By default, an unrecovered panic in any goroutine crashes the whole process. Inside tunny, the worker is wrapped in a function that does NOT recover panics — so a panic in your worker crashes your program.

If that is unacceptable (it usually is in production), wrap your worker function:

```go
pool := tunny.NewFunc(runtime.NumCPU(), func(payload any) (result any) {
    defer func() {
        if r := recover(); r != nil {
            result = fmt.Errorf("worker panic: %v", r)
        }
    }()
    return riskyWork(payload)
})
```

We will revisit this in `senior.md` — there is some nuance around what happens to the worker after a panic.

---

## Performance Tips

At the junior level the main performance levers are:

1. **Right-size the pool.** Start with `runtime.NumCPU()`. Measure. Adjust.
2. **Avoid per-call allocation in the worker.** If your worker creates a 1 MB buffer on every call, that is the first thing to fix.
3. **Reuse expensive resources via a `sync.Pool`** inside the worker function:

```go
var bufPool = sync.Pool{
    New: func() any { return make([]byte, 0, 64*1024) },
}

pool := tunny.NewFunc(runtime.NumCPU(), func(payload any) any {
    buf := bufPool.Get().([]byte)[:0]
    defer bufPool.Put(buf)
    // ... use buf
    return process(payload, buf)
})
```

(`sync.Pool` and `tunny.Pool` are unrelated despite the name. The first is for object reuse; the second is for goroutine reuse. They compose nicely.)

4. **Do not log inside the worker** unless you must. `log.Printf` takes a mutex that all goroutines share — under load it serialises your pool.
5. **Avoid `Process` recursion** — if the worker calls `Process` on the same pool, you can deadlock if all workers are busy. We will see how in the senior file.

---

## Best Practices

- One pool, one workload. Multiple pools per service is fine; one pool handling 17 different jobs is a code smell.
- Pool size scales with workload kind, not with traffic. Traffic just makes the queue longer; the pool size stays the same.
- The pool is a long-lived object. Created in `main`. Closed in `main`. Used by the whole program.
- If your worker has state, use the middle-level `Worker` interface, not a closure over package-level variables.
- Always test your pool under realistic concurrency. A pool that works fine with 4 callers may show pathological behaviour with 4000 callers.

---

## Edge Cases and Pitfalls

### Pool size of 0 panics

```go
pool := tunny.NewFunc(0, work) // panics
```

Tunny requires `n >= 1`. There is no sensible meaning to a pool of zero workers. Read the size from a config and validate it before construction:

```go
size := cfg.WorkerCount
if size <= 0 {
    size = runtime.NumCPU()
}
pool := tunny.NewFunc(size, work)
```

### Closing twice panics

```go
pool.Close()
pool.Close() // panic
```

This is easy to do accidentally if you have both a `defer pool.Close()` and an explicit `pool.Close()` somewhere. Pick one and remove the other.

### Processing after Close panics

```go
pool.Close()
pool.Process(x) // panic
```

Order your shutdown carefully. The pool should be closed only after every goroutine that might call `Process` has exited.

### Type assertion failures inside the worker crash the program

```go
pool := tunny.NewFunc(4, func(payload any) any {
    n := payload.(int) // panics if payload is not int
    return n * 2
})

pool.Process("oops") // crash
```

Either use the comma-ok form (`n, ok := payload.(int)`) or use a typed wrapper so the compiler enforces the type.

### Worker function is called once per Process — not per pool size

A subtle misconception: people sometimes think `NewFunc(8, f)` means `f` is called 8 times. It does not. `f` is called *once per Process call*, by whichever worker is free.

```go
calls := atomic.Int64{}
pool := tunny.NewFunc(8, func(any) any {
    calls.Add(1)
    return nil
})
pool.Process(nil)
pool.Process(nil)
pool.Process(nil)
fmt.Println(calls.Load()) // 3
pool.Close()
```

Always 3.

### Goroutine count remains elevated until Close

Each call to `tunny.NewFunc(n, ...)` adds `n` goroutines that will not exit until you call `Close`. If you create pools in a loop (a code smell, but it happens), the goroutine count grows linearly.

### `runtime.NumGoroutine` includes worker goroutines

Useful for debugging — if you suspect a leak, log `runtime.NumGoroutine()` before and after operations. A tunny pool of size N adds N to the count.

---

## Common Mistakes

These are mistakes people make on day one of using tunny.

### Mistake 1: forgetting to `Close`

```go
func process(s string) string {
    pool := tunny.NewFunc(4, doWork)
    return pool.Process(s).(string)
}
```

Every call to `process` creates a new pool with 4 worker goroutines and never closes it. Run this in a hot loop and you leak hundreds of goroutines per second.

**Fix:** Pool is a long-lived object. Create it once, in `main` or `init`, and close it once.

### Mistake 2: creating a pool per request

Almost the same as the previous, but inside an HTTP handler:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    pool := tunny.NewFunc(4, work)
    defer pool.Close()
    result := pool.Process(r.Body).(string)
    fmt.Fprint(w, result)
}
```

This creates and destroys a 4-worker pool per request. The whole point of the pool — reusing goroutines — is destroyed. Performance is **worse** than just calling `work` directly.

**Fix:** Create the pool once, share it across handlers via a struct or package variable.

### Mistake 3: trusting an `any` type assertion

```go
result := pool.Process(req)
n := result.(int) // panics if worker returned an error or nil
```

**Fix:** Use the comma-ok form or wrap in a result struct.

### Mistake 4: assuming `Process` returns an error

People newly arrived from Java or Rust assume:

```go
result, err := pool.Process(x) // does not compile
```

It does not. `Process` returns one value. Errors must be inside the result.

### Mistake 5: blocking the worker on an unbuffered channel

```go
out := make(chan int) // unbuffered

pool := tunny.NewFunc(4, func(payload any) any {
    out <- payload.(int) // worker blocks forever if nobody reads
    return nil
})
```

If you push results into a channel from inside the worker, that channel must have somewhere for the value to go. Either buffer it or have a dedicated consumer goroutine running.

### Mistake 6: holding a mutex across `Process`

```go
mu.Lock()
result := pool.Process(x)
mu.Unlock()
```

If `Process` blocks because all workers are busy, `mu` is held during the wait. Other goroutines that try to acquire `mu` are now waiting on the pool too, indirectly. Acquire and release the mutex narrowly; do the pool call outside.

---

## Common Misconceptions

### "Bigger pool = more throughput"

False for CPU-bound work. Once the pool size exceeds the number of cores, you start losing throughput to context switches and cache thrashing.

### "Tunny is just a fancy `go` keyword"

It is the opposite of a fancy `go` keyword. The `go` keyword spawns *one more* goroutine. Tunny refuses to spawn one more — it makes you wait for an existing one.

### "Tunny is async"

It is the opposite of async. From the caller's view, `Process` is synchronous, blocking, and looks like a function call. The asynchrony is internal to the pool.

### "Process is cheap"

`Process` involves at least two channel operations (one send, one receive) plus a goroutine context switch. It is not free. If your function takes 100 ns, the overhead of `Process` may dominate. Tunny is for workloads where each call takes microseconds to milliseconds, not nanoseconds.

### "Tunny manages threads"

Tunny manages goroutines, not threads. Threads are owned by the runtime and the OS. Tunny knows nothing about them.

### "I should use tunny for goroutine reuse"

Goroutine reuse alone is not a strong reason to use tunny. Spawning goroutines is cheap; the runtime can spawn millions per second on a normal laptop. The real reason to use tunny is **bounded concurrency** — limiting the number of in-flight tasks.

---

## Tricky Points

### Process blocks even if your function is fast

A pool of size 4 means at most 4 *concurrent* calls. If your function takes 1 ms and you have 4 callers each calling once a second, you will never block. But if 5 callers arrive at exactly the same millisecond, the 5th waits — even though the wait is only 1 ms. This is correct behaviour, not a bug. Backpressure is the point.

### The pool runs its worker goroutines on the same `GOMAXPROCS` as everything else

Tunny does not pin workers to threads. The Go runtime scheduler decides which OS thread each worker runs on, and that decision can change between calls. If your worker depends on thread-local state — TLS, `runtime.LockOSThread`-style assumptions — you need to take extra care. This rarely comes up at the junior level.

### Process is goroutine-safe

You can call `pool.Process(...)` from any number of goroutines concurrently. Tunny handles the dispatch. This is what makes it useful inside an HTTP server.

### Process is NOT re-entrant safely

If the *worker* function calls `pool.Process` on the same pool, you can deadlock if all other workers are also busy and call back into the pool. The fix: do not call the same pool from within itself.

### Close races with Process

If one goroutine calls `Process` while another calls `Close`, you can hit a panic. The rule: ensure all `Process`-calling goroutines have exited before you call `Close`. In practice this means coordinating with `sync.WaitGroup` or careful ordering.

---

## Test Yourself

Try these without scrolling up.

1. Write the smallest program that creates a pool of 1 worker, sends `"hi"` to it, and prints the result.
2. Modify the program to use a pool of 4. Does the output change?
3. What happens if you forget the `defer pool.Close()`?
4. What happens if you call `pool.Close()` and then `pool.Process(x)`?
5. What is the type of `pool.Process(x)`?
6. How do you get a `string` out of it?
7. How do you size a pool for a CPU-bound workload?
8. How do you size a pool for an IO-bound workload? (Why might tunny be the wrong choice?)
9. Why is `Process` synchronous?
10. Can two goroutines call `Process` at the same time? What happens?

If you stumbled on more than two, re-read the relevant section.

---

## Tricky Questions

These are tricky in the sense that they often catch even mid-level engineers off-guard.

**Q1.** A coworker writes:

```go
pool := tunny.NewFunc(1000, work)
```

…and claims it is faster because there are more workers. Is it?

**A1.** No. If `work` is CPU-bound, throughput is limited by the number of cores, not the number of goroutines. Having 1000 workers means 1000 goroutines fighting for `NumCPU` cores. Throughput stays roughly the same as `NumCPU` workers, but latency variance becomes worse and memory usage grows. For non-CPU work, the answer can be different — but the burden is on the coworker to justify it with a measurement.

**Q2.** What is the difference between `pool.Process(x)` returning `nil` and `Process` itself returning `nil`?

**A2.** They are the same. `Process` always returns whatever your worker function returned. If the worker returns `nil`, you get `nil` back.

**Q3.** A `tunny.NewFunc` worker function is called 5 times. How many goroutines were created?

**A3.** Zero new goroutines per call. The `n` workers were created in `NewFunc`. The 5 calls were dispatched among them.

**Q4.** Can you replace `tunny.NewFunc(4, work)` with `go work(x)` ?

**A4.** Only if you do not care about bounding concurrency. The whole point of `NewFunc` is to limit the in-flight count to 4. `go work(x)` lets you have 100 in-flight at once if 100 callers arrive at once.

**Q5.** What happens if `Process` is called with a closed pool from within another `Process`?

**A5.** Panic. The inner call sends on a closed channel.

**Q6.** A test runs `pool.Close()` at the end. The next test creates a fresh pool. Do these tests interfere?

**A6.** No — they are separate `*Pool` values with separate worker goroutines. As long as each test cleans up its own pool, there is no shared state.

**Q7.** Inside the worker function, can you call `t.Errorf` from a test?

**A7.** Be careful. The worker runs in a separate goroutine; calling `t.Errorf` from a non-test goroutine after the test ends can crash. Use channels to push errors back to the test's main goroutine, then assert there.

---

## Cheat Sheet

```text
Import:    import "github.com/Jeffail/tunny"

Create:    pool := tunny.NewFunc(n, func(payload any) any { ... })
           // n must be >= 1

Use:       result := pool.Process(payload).(MyType)
           // synchronous, blocks until a worker is free and done

Shutdown:  pool.Close()
           // call exactly once, when no Process calls remain

Common n:  runtime.NumCPU() for CPU-bound
           runtime.NumCPU()*2 for mostly-CPU + light IO
           Do not exceed NumCPU without a measurable reason

Pitfalls:  Close twice = panic
           Process after Close = panic
           Pool size 0 = panic
           Worker panics = process crash (recover yourself)
```

---

## Self-Assessment Checklist

By the end of this file you should be able to:

- [ ] Write a 30-line program that uses `tunny.NewFunc` for a real task.
- [ ] Explain why `Process` blocks.
- [ ] Choose a sensible default pool size and justify it.
- [ ] Safely close a pool exactly once.
- [ ] Wrap a tunny pool in a typed helper for compile-time safety.
- [ ] Recover from worker panics so they do not crash the process.
- [ ] Recognise the symptoms of "pool created in a hot path" (goroutine leak).
- [ ] Decide when NOT to use tunny — for pure IO-bound or extremely cheap tasks.
- [ ] Read the source of `NewFunc` once and have it make sense (it is ~10 lines).

If any of these is unclear, re-read the relevant section. The bar for "junior level done" is being able to ship a small piece of code that uses tunny correctly, without fear, and explain it to a peer.

---

## Summary

- `tunny.NewFunc(n, fn)` creates a pool of `n` long-lived worker goroutines, each running the same `fn`.
- `pool.Process(payload)` sends a payload to the pool, blocks until a worker has processed it, returns the worker's `any` return value.
- `pool.Close()` releases all workers. Call it exactly once.
- `n` should be `runtime.NumCPU()` for CPU-bound work. Larger is rarely better.
- The API uses `any` — wrap it for type safety in real codebases.
- `Process` has no `error` return — encode failures in your result struct.
- Worker panics are not caught — recover them yourself.
- A pool is a long-lived object. Create once, use many times, close at shutdown.

You now have the entire shape of tunny in your head. The middle file builds on this with the `Worker` interface, timeouts, and contexts.

---

## What You Can Build Now

With only the material in this file, you can build:

- A parallel batch processor (image resize, text transform, hashing).
- An HTTP service whose CPU-bound work is naturally bounded.
- A throttle in front of an expensive operation (a single-worker pool is a poor-man's mutex with backpressure).
- A test fixture that runs many computations in parallel without spawning unbounded goroutines.
- A small CLI that walks a directory tree and processes each file with a worker pool.

These are real, useful programs. They will not need any feature past `NewFunc`.

---

## Further Reading

- The tunny GitHub README: [https://github.com/Jeffail/tunny](https://github.com/Jeffail/tunny). It is short — read it once end to end.
- Ashley Jeffail's blog posts about tunny (search "tunny goroutine pool"). They explain the design choices.
- The Go standard library `runtime` package, specifically `NumCPU`, `NumGoroutine`, `GOMAXPROCS`.
- `sync.Pool` — different concept, useful inside tunny workers for object reuse.
- The `testing` package's `B.RunParallel` — perfect for benchmarking tunny pools.

---

## Related Topics

- **Goroutines** ([01-goroutines](../../01-goroutines/)) — the underlying primitive.
- **Channels** ([02-channels](../../02-channels/)) — what tunny uses internally.
- **`sync.WaitGroup`** ([03-sync-package](../../03-sync-package/)) — for coordinating callers.
- **ants** ([01-ants](../01-ants/)) — the sibling pool library focused on fan-out.
- **workerpool** ([03-workerpool](../03-workerpool/)) — another pool library, stdlib-feel.
- **When to use which pool** ([04-when-to-use](../04-when-to-use/)) — the comparison page.

---

## Diagrams

### Diagram 1 — pool lifecycle

```
time ─────────────────────────────────────────────▶

NewFunc(4, fn) ───┬───┬───┬───┬─── Close()
                  │   │   │   │
        spawn ▶  W1   W2  W3  W4   exit
                  │   │   │   │
        idle      P   P   P   P    (parked on channel)
                  │   │   │   │
        busy  ───▶f   f   f   f    (calling fn)
                  │   │   │   │
        idle  ◀── P   P   P   P
                  │   │   │   │
                  └─ — — — — ┘
```

`P` = parked, `f` = running the worker function. The workers cycle between these two states for the lifetime of the pool.

### Diagram 2 — what happens during one Process call

```
Caller goroutine                Worker goroutine
───────────────                  ───────────────

Process(x) ─────send x ──▶
                                 receive x
                                 call fn(x)
                                   ...
                                 result := fn(x)
              ◀── send result ── send result
return result
```

Two channel operations and one function call. That is it.

### Diagram 3 — many callers, few workers

```
Caller A ──▶│
Caller B ──▶│
Caller C ──▶│           ┌──── W1 (running)
Caller D ──▶│ chan ────▶├──── W2 (running)
Caller E ──▶│           ├──── W3 (running)
Caller F ──▶│           └──── W4 (running)
Caller G ──▶│  (blocked here until a W finishes)
```

The channel is the queue. The pool size is the parallelism cap. Backpressure is automatic.

### Diagram 4 — pool size effects

```
1 worker          : ──A──┤──B──┤──C──┤   serialised
2 workers         : ──A──┤──C──┤        parallel pairs
                    ──B──┤──D──┤
NumCPU workers    : ──A──┤  ──C──┤      ideal CPU-bound
                    ──B──┤  ──D──┤
NumCPU*4 workers  : thrash, no extra speed for CPU-bound
```

These four diagrams capture every visual intuition you need about a tunny pool at the junior level. Re-draw them on paper a couple of times until they feel obvious. The middle file builds on this picture by replacing the worker function with a `Worker` interface object and adding timeout edges to the diagrams.

---

## Extended Walkthrough — Building a Thumbnail Service

To anchor everything you just read, we will build a small but realistic program: a thumbnail generator that reads JPEG files from a directory and writes resized PNG thumbnails into an output directory. It is the canonical "CPU-bound batch with a pool" use case.

We will write the program in stages. Each stage adds one concept from this file. By the end you will have an idiomatic, complete tunny program of about 80 lines.

### Stage 0 — sequential baseline

Before introducing the pool, write the simplest possible version. This gives us something to compare against:

```go
package main

import (
    "image"
    _ "image/jpeg"
    "image/png"
    "log"
    "os"
    "path/filepath"

    "golang.org/x/image/draw"
)

func resize(inPath, outPath string, w, h int) error {
    f, err := os.Open(inPath)
    if err != nil {
        return err
    }
    defer f.Close()

    src, _, err := image.Decode(f)
    if err != nil {
        return err
    }

    dst := image.NewRGBA(image.Rect(0, 0, w, h))
    draw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Over, nil)

    out, err := os.Create(outPath)
    if err != nil {
        return err
    }
    defer out.Close()
    return png.Encode(out, dst)
}

func main() {
    inputs, err := filepath.Glob("input/*.jpg")
    if err != nil {
        log.Fatal(err)
    }
    if err := os.MkdirAll("output", 0o755); err != nil {
        log.Fatal(err)
    }

    for _, in := range inputs {
        out := filepath.Join("output", filepath.Base(in)+".png")
        if err := resize(in, out, 128, 128); err != nil {
            log.Printf("resize %s: %v", in, err)
        }
    }
}
```

This runs serially. On a 4-core machine with 100 photos, you are using 1 core. Three are idle.

### Stage 1 — naive `go` keyword

The first instinct is "just put `go` in front of `resize`":

```go
for _, in := range inputs {
    in := in // capture
    out := filepath.Join("output", filepath.Base(in)+".png")
    go func() {
        if err := resize(in, out, 128, 128); err != nil {
            log.Printf("resize %s: %v", in, err)
        }
    }()
}
```

Two problems:

1. `main` returns immediately after the loop, so most resizes get killed mid-decode.
2. We spawn 100 goroutines all trying to decode JPEGs at once. Image decoding is memory-hungry; this can blow your RSS.

Add a `WaitGroup` to fix problem 1:

```go
var wg sync.WaitGroup
for _, in := range inputs {
    in := in
    out := filepath.Join("output", filepath.Base(in)+".png")
    wg.Add(1)
    go func() {
        defer wg.Done()
        if err := resize(in, out, 128, 128); err != nil {
            log.Printf("resize %s: %v", in, err)
        }
    }()
}
wg.Wait()
```

Problem 2 remains. With 100 photos at 5 MB each decoded into ~50 MB RGBA buffers, we are looking at 5 GB of peak memory. The process gets OOM-killed in a real workload.

### Stage 2 — tunny

Now use the pool. Pool size is `runtime.NumCPU()`, so we cap concurrent decodes at the core count:

```go
package main

import (
    "image"
    _ "image/jpeg"
    "image/png"
    "log"
    "os"
    "path/filepath"
    "runtime"
    "sync"

    "github.com/Jeffail/tunny"
    "golang.org/x/image/draw"
)

type job struct {
    InPath  string
    OutPath string
    W, H    int
}

func resizeJob(payload any) any {
    j := payload.(job)
    f, err := os.Open(j.InPath)
    if err != nil {
        return err
    }
    defer f.Close()

    src, _, err := image.Decode(f)
    if err != nil {
        return err
    }

    dst := image.NewRGBA(image.Rect(0, 0, j.W, j.H))
    draw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Over, nil)

    out, err := os.Create(j.OutPath)
    if err != nil {
        return err
    }
    defer out.Close()
    return png.Encode(out, dst)
}

func main() {
    inputs, err := filepath.Glob("input/*.jpg")
    if err != nil {
        log.Fatal(err)
    }
    if err := os.MkdirAll("output", 0o755); err != nil {
        log.Fatal(err)
    }

    pool := tunny.NewFunc(runtime.NumCPU(), resizeJob)
    defer pool.Close()

    var wg sync.WaitGroup
    for _, in := range inputs {
        in := in
        out := filepath.Join("output", filepath.Base(in)+".png")
        wg.Add(1)
        go func() {
            defer wg.Done()
            if err := pool.Process(job{InPath: in, OutPath: out, W: 128, H: 128}); err != nil {
                log.Printf("resize %s: %v", in, err)
            }
        }()
    }
    wg.Wait()
}
```

This is the production shape. Notes:

- We still spawn one goroutine per file. They are cheap. But only `NumCPU` of them run `resize` at once.
- The memory peak is now `NumCPU * ~50 MB` instead of `len(inputs) * 50 MB`.
- Throughput is identical to the previous version on a CPU-bound machine. We get the same speedup *without* the memory blowup.

Run it on a directory of 100 photos. On a quad-core laptop with 16 GB RAM, the unbounded version OOMs. The tunny version finishes in a few seconds with a stable ~200 MB resident set.

### Stage 3 — return values

In the version above we returned `error` from the worker. The caller asserts to `error` and handles it. This works but is a bit fragile: if the worker forgets to return an `error` typed value, the assertion fails.

A more robust shape uses a result struct:

```go
type jobResult struct {
    InPath string
    Bytes  int
    Err    error
}

func resizeJob(payload any) any {
    j := payload.(job)
    res := jobResult{InPath: j.InPath}
    f, err := os.Open(j.InPath)
    if err != nil {
        res.Err = err
        return res
    }
    defer f.Close()
    // ... rest of resize, populate res.Bytes on success
    return res
}
```

In the caller:

```go
r := pool.Process(myJob).(jobResult)
if r.Err != nil { ... }
fmt.Printf("%s: %d bytes written\n", r.InPath, r.Bytes)
```

The result struct grows naturally as you need more fields: timings, intermediate hashes, original dimensions. The pool signature stays the same.

### Stage 4 — typed wrapper

For a service that uses this pool everywhere, wrap it once:

```go
type ResizePool struct {
    inner *tunny.Pool
}

func NewResizePool(size int) *ResizePool {
    return &ResizePool{inner: tunny.NewFunc(size, resizeJob)}
}

func (p *ResizePool) Resize(j job) jobResult {
    return p.inner.Process(j).(jobResult)
}

func (p *ResizePool) Close() { p.inner.Close() }
```

Now the surface area is typed. Callers cannot pass an `int`. The compiler refuses to compile a wrong type. The `any` lives only inside the wrapper.

### Stage 5 — using `context.Context`

We will only sketch this at the junior level; the middle file covers it properly.

Tunny exposes `ProcessCtx` for cancellation. To use it, the underlying worker must be able to honour the context — that means moving to the `Worker` interface, which is a middle-level topic. For now, know that:

- `Process` cannot be cancelled mid-flight.
- If you want cancellation, plan to use the middle-level API.

We mention this because in real services you almost always want to attach a request context to your work. The pure `NewFunc` API is a starting point, not an end state.

---

## A Slightly Bigger Program — Parallel CSV Hashing

Another shape: read a directory of CSV files, compute SHA-256 of each file's content, write a manifest. CPU is dominated by SHA-256, IO is fast. Perfect for a CPU-sized pool.

```go
package main

import (
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "io"
    "log"
    "os"
    "path/filepath"
    "runtime"
    "sort"
    "sync"

    "github.com/Jeffail/tunny"
)

type hashResult struct {
    Path string `json:"path"`
    Hash string `json:"hash"`
    Err  string `json:"err,omitempty"`
}

func hashFile(payload any) any {
    path := payload.(string)
    f, err := os.Open(path)
    if err != nil {
        return hashResult{Path: path, Err: err.Error()}
    }
    defer f.Close()

    h := sha256.New()
    if _, err := io.Copy(h, f); err != nil {
        return hashResult{Path: path, Err: err.Error()}
    }
    return hashResult{Path: path, Hash: hex.EncodeToString(h.Sum(nil))}
}

func main() {
    paths, err := filepath.Glob("data/*.csv")
    if err != nil {
        log.Fatal(err)
    }

    pool := tunny.NewFunc(runtime.NumCPU(), hashFile)
    defer pool.Close()

    results := make([]hashResult, len(paths))
    var wg sync.WaitGroup
    for i, p := range paths {
        i, p := i, p
        wg.Add(1)
        go func() {
            defer wg.Done()
            results[i] = pool.Process(p).(hashResult)
        }()
    }
    wg.Wait()

    sort.Slice(results, func(i, j int) bool {
        return results[i].Path < results[j].Path
    })

    if err := json.NewEncoder(os.Stdout).Encode(results); err != nil {
        log.Fatal(err)
    }
}
```

What to notice:

- The `results[i]` pattern. Each goroutine writes to its own slot. No lock needed because no two goroutines write to the same index.
- The result struct has an `Err string` field instead of `Err error`. This is because `error` does not serialise to JSON well; converting to a string at the boundary is friendlier to consumers.
- We sort the results deterministically because goroutine completion order is non-deterministic.
- `pool.Close()` is at the top of `main`, deferred. It runs after `wg.Wait()`.

This program will sustain ~`NumCPU * speed_of_SHA256` MB/s read throughput, which for SHA-256 on modern x86 is on the order of 500 MB/s per core. On an 8-core machine that is 4 GB/s — comfortably IO-bound for any normal disk.

---

## A Slightly Different Program — Pool-as-a-Throttle

Sometimes you do not really want concurrency at all; you want a **rate cap**. A pool of size 1 is the simplest cap.

Use case: you are sending requests to a third-party API that allows at most one in-flight call at a time. Without a pool, you would need a mutex. With tunny, the pool is the mutex:

```go
package main

import (
    "encoding/json"
    "fmt"
    "io"
    "log"
    "net/http"
    "sync"

    "github.com/Jeffail/tunny"
)

func main() {
    pool := tunny.NewFunc(1, func(payload any) any {
        url := payload.(string)
        resp, err := http.Get(url)
        if err != nil {
            return err
        }
        defer resp.Body.Close()
        body, err := io.ReadAll(resp.Body)
        if err != nil {
            return err
        }
        var data map[string]any
        if err := json.Unmarshal(body, &data); err != nil {
            return err
        }
        return data
    })
    defer pool.Close()

    urls := []string{
        "https://httpbin.org/get?id=1",
        "https://httpbin.org/get?id=2",
        "https://httpbin.org/get?id=3",
    }

    var wg sync.WaitGroup
    for _, u := range urls {
        u := u
        wg.Add(1)
        go func() {
            defer wg.Done()
            switch v := pool.Process(u).(type) {
            case error:
                log.Printf("error: %v", v)
            case map[string]any:
                fmt.Printf("%s -> args=%v\n", u, v["args"])
            }
        }()
    }
    wg.Wait()
}
```

The three goroutines run concurrently, but the actual HTTP call is serialised by the pool. The third caller waits for the first and second to finish.

A pool of size 1 is a perfectly legitimate use of tunny. Do not feel like you have wasted the library.

---

## Yet Another Shape — Batching at the Producer

A common refinement on top of a pool: collect inputs into batches before submitting. This amortises the per-call overhead, which can matter when each call is cheap.

```go
package main

import (
    "fmt"
    "runtime"
    "sync"

    "github.com/Jeffail/tunny"
)

func sumBatch(payload any) any {
    batch := payload.([]int)
    total := 0
    for _, n := range batch {
        total += n * n
    }
    return total
}

func main() {
    pool := tunny.NewFunc(runtime.NumCPU(), sumBatch)
    defer pool.Close()

    raw := make([]int, 1000)
    for i := range raw {
        raw[i] = i + 1
    }

    const batchSize = 100
    var wg sync.WaitGroup
    grandTotal := 0
    var mu sync.Mutex

    for i := 0; i < len(raw); i += batchSize {
        end := i + batchSize
        if end > len(raw) {
            end = len(raw)
        }
        batch := raw[i:end]
        wg.Add(1)
        go func() {
            defer wg.Done()
            partial := pool.Process(batch).(int)
            mu.Lock()
            grandTotal += partial
            mu.Unlock()
        }()
    }
    wg.Wait()
    fmt.Println("sum of squares 1..1000 =", grandTotal)
}
```

We submit 10 jobs of 100 numbers each, not 1000 jobs of 1 number each. The pool overhead is paid 10 times, not 1000.

When is batching worthwhile? Rule of thumb: when each individual unit of work is faster than a few microseconds, batch. For work that takes a millisecond or more, batching gives diminishing returns.

This is a bridge to `optimize.md`, which goes into batching at depth.

---

## Common Beginner Q&A

### Q. Can I use tunny without channels?

A. You are using channels — they are inside the pool. You just do not have to touch them yourself. That is the value tunny adds.

### Q. Can I use tunny without a `WaitGroup`?

A. Often yes. If you do not need to wait for all calls to finish (e.g. a long-running HTTP server), there is no need to coordinate completion. But if you want "compute all of these and then exit", you need *some* mechanism — `sync.WaitGroup`, a counter channel, `errgroup`. Tunny does not give you batch completion.

### Q. Why does `Process` return `any` and not a typed value?

A. Because Go did not have generics when tunny was written (and the maintainer has not migrated). Wrap it with your own typed function and forget the `any`.

### Q. Should I use tunny or `errgroup`?

A. They solve different problems. `errgroup` coordinates the lifecycle of a small set of related goroutines and aggregates errors. Tunny limits in-flight concurrency over a long-running stream of work. Use both: an `errgroup` to manage the outer call sites, and a tunny pool inside to throttle the actual CPU work.

### Q. Can I use tunny inside a library, or only in `main`?

A. A library can expose a pool, but should not own the lifecycle silently. Either make the pool a constructor argument or document that the consumer must call `Close`. Hidden lifecycles in libraries are a recipe for leaks.

### Q. What if I want to time-limit a single `Process` call?

A. Middle level — `ProcessTimed` or `ProcessCtx`. Plain `Process` has no timeout.

### Q. What if my worker function is slow to construct (loads a model from disk)?

A. The function passed to `NewFunc` is not a constructor — it runs every time, not once per worker. If you need expensive per-worker state, use the middle-level `Worker` interface with a factory that does the construction once.

### Q. Can I reuse the same pool across different shapes of input?

A. Technically yes, by using a discriminated payload (a struct with a "kind" field). Pragmatically — no. One pool per workload makes the code clearer, the pool size more sensible, and the metrics easier to interpret.

### Q. Does tunny work with `context.Context`?

A. Yes, via `ProcessCtx`. We touch it briefly here; middle file covers it fully.

### Q. Is tunny faster than just using channels myself?

A. No, tunny *is* channels. It will not be faster than a hand-rolled equivalent. Its value is correctness and brevity, not speed. Three lines of `NewFunc` saves you 30 lines of boilerplate that you would otherwise debug.

---

## Recapitulation Exercise — Build It Without Looking

Here is the final junior-level exercise. Without scrolling up, write a Go program that:

1. Imports tunny.
2. Creates a pool of size 4.
3. The worker function takes a payload that is an `int`, computes `payload * payload`, returns the result as `any`.
4. The main function calls `Process` with `5`, then with `10`, then with `15`.
5. Prints each result.
6. Closes the pool.

Time yourself. You should be able to write this in under three minutes. If you cannot, re-read the [Your First Pool](#your-first-pool) and [Calling Process](#calling-process) sections.

Reference solution:

```go
package main

import (
    "fmt"

    "github.com/Jeffail/tunny"
)

func main() {
    pool := tunny.NewFunc(4, func(payload any) any {
        n := payload.(int)
        return n * n
    })
    defer pool.Close()

    for _, n := range []int{5, 10, 15} {
        fmt.Println(pool.Process(n))
    }
}
```

Output:

```
25
100
225
```

That program — and only that program — is the bar for "junior level done". If you can write it from memory, explain why `Process` blocks, and choose a sensible pool size for a CPU-bound workload, you are ready to move on.

---

## Final Notes for the Junior Reader

Three pieces of mindset to carry into the middle file:

1. **A pool is infrastructure, not glue.** It is a long-lived component of your service, on the same level as a database connection pool or an HTTP client. Treat it that way.
2. **Tunny is small on purpose.** If you find yourself wanting features it does not have — dynamic resizing, priority queues, fairness — either build them on top, or use a different library. Tunny does not aspire to be a framework.
3. **The hardest part is sizing.** Everything else is mechanical. Sizing is judgement. Measure.

In the middle file we replace `NewFunc` with the full `Worker` interface, which unlocks per-worker state, timeouts, contexts, and cancellation. The mental model — `N` workers, synchronous `Process`, blocking on full — does not change. We just gain finer control over what each worker can do.

Good luck. Build something small and useful with tunny this week, and the middle level will land more easily.

---

## Appendix A — A Longer Tour of the API Surface (Junior Slice)

This appendix runs through the parts of the tunny API you can productively use without ever leaving the junior level. The middle and senior files add more — but everything here is enough to build real software.

### `tunny.NewFunc`

We have used this throughout. Signature:

```go
func NewFunc(n int, f func(payload any) any) *Pool
```

Notes that did not fit elsewhere:

- The returned `*Pool` is safe to use from any number of goroutines. There is no need for external locking around `Process`.
- The function `f` is invoked from inside worker goroutines. It must therefore be safe to call concurrently with itself — i.e. it must be reentrant on any shared state. Capturing only immutable values, or sharing only `sync/atomic`-protected counters, is the safe default.
- The pool starts ready immediately. There is no `Start` method to call.

### `Pool.Process`

```go
func (p *Pool) Process(payload any) any
```

Synchronous, blocking, returns the worker's `any` return value. We have covered this in depth.

### `Pool.Close`

```go
func (p *Pool) Close()
```

Stop the pool, exit all worker goroutines. Idempotency: not idempotent — calling twice panics.

### `Pool.GetSize` and `Pool.SetSize`

```go
func (p *Pool) GetSize() int
func (p *Pool) SetSize(n int)
```

Two helpers most junior tunny users never touch but should know about:

- `GetSize` returns the current pool size.
- `SetSize` changes the number of workers. Adding workers spawns new goroutines. Removing workers terminates them (after they finish their current jobs).

```go
pool := tunny.NewFunc(4, work)
defer pool.Close()

fmt.Println(pool.GetSize()) // 4
pool.SetSize(8)
fmt.Println(pool.GetSize()) // 8
```

`SetSize` is rarely needed at the junior level — most pools are sized once at startup. Be careful with `SetSize(0)` — that essentially halts the pool.

### `Pool.QueueLength`

```go
func (p *Pool) QueueLength() int64
```

Returns the number of payloads currently *waiting* for a worker — not the number being processed. Useful for monitoring and admission control:

```go
if pool.QueueLength() > 1000 {
    return errors.New("backpressure: queue full")
}
```

You can use this to implement your own backpressure policy on top of tunny.

### What we are NOT covering at the junior level

- `tunny.New` (full constructor)
- `tunny.NewCallback`
- `Pool.ProcessTimed`
- `Pool.ProcessCtx`
- The `Worker` interface

All of these belong to the middle level and will be covered there. If you find yourself reaching for them while you are still learning, **pause**. Build something with just `NewFunc` first. Then graduate.

---

## Appendix B — Performance Numbers to Calibrate Your Expectations

To give you a feel for what kinds of speedups tunny actually delivers, here are approximate numbers from a synthetic benchmark on a 4-core machine. They are not authoritative; they are meant to set rough expectations.

| Pool size | Wall time for 100 CPU-bound jobs of 100 ms each |
|-----------|-------------------------------------------------|
| 1         | 10 s                                             |
| 2         | 5 s                                              |
| 4         | 2.5 s                                            |
| 8         | 2.6 s (no improvement past NumCPU)              |
| 16        | 2.7 s                                            |
| 64        | 3.0 s (slight degradation from contention)      |

Pattern: linear speedup up to `NumCPU`, then flat, then a slow decline. This is the canonical shape and is why `NumCPU` is the default.

| Pool size | Wall time for 100 IO-bound jobs of 100 ms each |
|-----------|------------------------------------------------|
| 1         | 10 s                                            |
| 2         | 5 s                                             |
| 4         | 2.5 s                                           |
| 8         | 1.3 s                                           |
| 16        | 0.7 s                                           |
| 100       | 0.1 s (all concurrent)                          |

Pattern: speedup continues past `NumCPU` because the workers are mostly sleeping. This is also a sign that **tunny is unnecessary for this workload**. If your workers spend 99% of their time on `time.Sleep` or `http.Get`, you do not need a pool — you need goroutines and a semaphore.

The middle file covers semaphores. The junior takeaway: tunny shines for CPU-bound work. For IO-bound, weigh tunny against simpler alternatives.

---

## Appendix C — A Trace of Goroutines During a Pool's Life

If you want to *see* a tunny pool work, sprinkle `runtime.NumGoroutine` calls and run the program with `GOMAXPROCS=1` so the scheduling is more deterministic:

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"

    "github.com/Jeffail/tunny"
)

func main() {
    runtime.GOMAXPROCS(1)
    fmt.Println("at start:", runtime.NumGoroutine())

    pool := tunny.NewFunc(4, func(p any) any {
        time.Sleep(50 * time.Millisecond)
        return p
    })
    fmt.Println("after NewFunc:", runtime.NumGoroutine())

    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            pool.Process(i)
        }(i)
    }

    // Sample while work is in flight.
    time.Sleep(20 * time.Millisecond)
    fmt.Println("during processing:", runtime.NumGoroutine())

    wg.Wait()
    fmt.Println("after wait:", runtime.NumGoroutine())

    pool.Close()
    fmt.Println("after close:", runtime.NumGoroutine())
}
```

Approximate output:

```
at start: 1
after NewFunc: 5
during processing: 15
after wait: 5
after close: 1
```

You see:

- `+4` after `NewFunc` — the four worker goroutines.
- `+10` during processing — one extra goroutine per `go func` caller.
- The caller goroutines exit after `Process` returns. The worker goroutines do not exit until `Close`.

Trace your own program this way the first few times you use tunny. The mental model becomes physical.

---

## Appendix D — Five Worked Mini-Programs

For practice, here are five complete tiny programs you can type in and run.

### Mini-program 1: parallel sum

```go
package main

import (
    "fmt"
    "runtime"
    "sync"

    "github.com/Jeffail/tunny"
)

func main() {
    nums := make([]int, 10_000)
    for i := range nums {
        nums[i] = i + 1
    }

    chunk := 1_000
    pool := tunny.NewFunc(runtime.NumCPU(), func(payload any) any {
        slice := payload.([]int)
        s := 0
        for _, n := range slice {
            s += n
        }
        return s
    })
    defer pool.Close()

    var wg sync.WaitGroup
    total := 0
    var mu sync.Mutex
    for i := 0; i < len(nums); i += chunk {
        end := i + chunk
        if end > len(nums) {
            end = len(nums)
        }
        slice := nums[i:end]
        wg.Add(1)
        go func() {
            defer wg.Done()
            partial := pool.Process(slice).(int)
            mu.Lock()
            total += partial
            mu.Unlock()
        }()
    }
    wg.Wait()
    fmt.Println("sum:", total) // 50005000
}
```

### Mini-program 2: parallel substring count

```go
package main

import (
    "fmt"
    "runtime"
    "strings"
    "sync"

    "github.com/Jeffail/tunny"
)

func main() {
    texts := []string{
        "the quick brown fox",
        "jumps over the lazy dog",
        "the the the",
    }
    needle := "the"

    pool := tunny.NewFunc(runtime.NumCPU(), func(payload any) any {
        s := payload.(string)
        return strings.Count(s, needle)
    })
    defer pool.Close()

    var wg sync.WaitGroup
    total := 0
    var mu sync.Mutex
    for _, t := range texts {
        t := t
        wg.Add(1)
        go func() {
            defer wg.Done()
            n := pool.Process(t).(int)
            mu.Lock()
            total += n
            mu.Unlock()
        }()
    }
    wg.Wait()
    fmt.Printf("total %q: %d\n", needle, total) // 5
}
```

### Mini-program 3: parallel JSON encode

```go
package main

import (
    "encoding/json"
    "fmt"
    "runtime"
    "sync"

    "github.com/Jeffail/tunny"
)

type record struct {
    Name string
    Age  int
}

func main() {
    pool := tunny.NewFunc(runtime.NumCPU(), func(payload any) any {
        r := payload.(record)
        b, err := json.Marshal(r)
        if err != nil {
            return err.Error()
        }
        return string(b)
    })
    defer pool.Close()

    records := []record{
        {"Ada", 36}, {"Linus", 54}, {"Grace", 84},
    }
    var wg sync.WaitGroup
    out := make([]string, len(records))
    for i, r := range records {
        i, r := i, r
        wg.Add(1)
        go func() {
            defer wg.Done()
            out[i] = pool.Process(r).(string)
        }()
    }
    wg.Wait()
    for _, line := range out {
        fmt.Println(line)
    }
}
```

### Mini-program 4: parallel file size

```go
package main

import (
    "fmt"
    "os"
    "path/filepath"
    "runtime"
    "sync"

    "github.com/Jeffail/tunny"
)

func main() {
    paths, err := filepath.Glob("/usr/share/dict/*")
    if err != nil {
        panic(err)
    }
    pool := tunny.NewFunc(runtime.NumCPU(), func(payload any) any {
        info, err := os.Stat(payload.(string))
        if err != nil {
            return int64(-1)
        }
        return info.Size()
    })
    defer pool.Close()

    var wg sync.WaitGroup
    var total int64
    var mu sync.Mutex
    for _, p := range paths {
        p := p
        wg.Add(1)
        go func() {
            defer wg.Done()
            sz := pool.Process(p).(int64)
            if sz < 0 {
                return
            }
            mu.Lock()
            total += sz
            mu.Unlock()
        }()
    }
    wg.Wait()
    fmt.Printf("total bytes: %d\n", total)
}
```

### Mini-program 5: parallel password hashing (bcrypt)

```go
package main

import (
    "fmt"
    "runtime"
    "sync"

    "github.com/Jeffail/tunny"
    "golang.org/x/crypto/bcrypt"
)

func main() {
    pool := tunny.NewFunc(runtime.NumCPU(), func(payload any) any {
        pw := payload.(string)
        h, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
        if err != nil {
            return err.Error()
        }
        return string(h)
    })
    defer pool.Close()

    passwords := []string{"alpha", "bravo", "charlie", "delta", "echo"}
    var wg sync.WaitGroup
    for _, pw := range passwords {
        pw := pw
        wg.Add(1)
        go func() {
            defer wg.Done()
            h := pool.Process(pw).(string)
            fmt.Printf("%s -> %s\n", pw, h)
        }()
    }
    wg.Wait()
}
```

bcrypt is intentionally CPU-expensive. Without a pool, hashing five passwords in parallel can saturate your laptop. With a pool of `NumCPU`, throughput is the best you can get without thermal throttling.

---

## Appendix E — Twenty Tiny Recipes

Quick patterns you can reach for without typing from scratch.

### Recipe 1 — pool literal in `main`

```go
pool := tunny.NewFunc(runtime.NumCPU(), work)
defer pool.Close()
```

### Recipe 2 — pool field on a struct

```go
type Service struct {
    pool *tunny.Pool
}

func NewService() *Service {
    return &Service{pool: tunny.NewFunc(runtime.NumCPU(), work)}
}

func (s *Service) Close() error {
    s.pool.Close()
    return nil
}
```

### Recipe 3 — typed wrapper for one input type

```go
func (s *Service) Hash(input []byte) []byte {
    return s.pool.Process(input).([]byte)
}
```

### Recipe 4 — pool with a result envelope

```go
type res struct {
    Out []byte
    Err error
}

func (s *Service) Hash(input []byte) ([]byte, error) {
    r := s.pool.Process(input).(res)
    return r.Out, r.Err
}
```

### Recipe 5 — pool guarded by `sync.Once`

```go
var (
    poolOnce sync.Once
    pool     *tunny.Pool
)

func getPool() *tunny.Pool {
    poolOnce.Do(func() {
        pool = tunny.NewFunc(runtime.NumCPU(), work)
    })
    return pool
}
```

### Recipe 6 — pool sized from environment variable

```go
size, err := strconv.Atoi(os.Getenv("WORKERS"))
if err != nil || size <= 0 {
    size = runtime.NumCPU()
}
pool := tunny.NewFunc(size, work)
```

### Recipe 7 — recover from worker panics

```go
pool := tunny.NewFunc(n, func(p any) (out any) {
    defer func() {
        if r := recover(); r != nil {
            out = fmt.Errorf("panic: %v", r)
        }
    }()
    return risky(p)
})
```

### Recipe 8 — pool used by HTTP handler

```go
http.HandleFunc("/work", func(w http.ResponseWriter, r *http.Request) {
    out := pool.Process(r.URL.Query().Get("x")).(string)
    fmt.Fprint(w, out)
})
```

### Recipe 9 — fan-out without `sync.WaitGroup` (channel close)

```go
done := make(chan struct{}, len(jobs))
for _, j := range jobs {
    j := j
    go func() { pool.Process(j); done <- struct{}{} }()
}
for range jobs { <-done }
```

### Recipe 10 — collect results into a slice

```go
out := make([]Result, len(jobs))
var wg sync.WaitGroup
for i, j := range jobs {
    i, j := i, j
    wg.Add(1)
    go func() {
        defer wg.Done()
        out[i] = pool.Process(j).(Result)
    }()
}
wg.Wait()
```

### Recipe 11 — abort early on first error

```go
errCh := make(chan error, 1)
for _, j := range jobs {
    j := j
    go func() {
        r := pool.Process(j).(res)
        if r.Err != nil {
            select { case errCh <- r.Err: default: }
        }
    }()
}
```

### Recipe 12 — back off if queue is too long

```go
if pool.QueueLength() > 100 {
    return errors.New("busy")
}
return pool.Process(x), nil
```

### Recipe 13 — sized to half of CPU for low-priority work

```go
size := runtime.NumCPU() / 2
if size < 1 {
    size = 1
}
pool := tunny.NewFunc(size, work)
```

### Recipe 14 — log goroutine count for diagnostics

```go
log.Printf("goroutines: %d", runtime.NumGoroutine())
```

### Recipe 15 — pool factory that wires metrics

```go
func NewMonitored(name string, n int, f func(any) any) *tunny.Pool {
    return tunny.NewFunc(n, func(p any) any {
        timer := metrics.StartTimer(name)
        defer timer.Stop()
        return f(p)
    })
}
```

### Recipe 16 — pool key on context

```go
type poolKey struct{}

func WithPool(ctx context.Context, p *tunny.Pool) context.Context {
    return context.WithValue(ctx, poolKey{}, p)
}

func PoolFrom(ctx context.Context) *tunny.Pool {
    return ctx.Value(poolKey{}).(*tunny.Pool)
}
```

### Recipe 17 — adapt to `func(input) output` for callers

```go
hash := func(in []byte) []byte { return pool.Process(in).([]byte) }
out := hash(buf)
```

### Recipe 18 — use as a `sync.Mutex` of sorts (size 1)

```go
serial := tunny.NewFunc(1, work)
defer serial.Close()
```

### Recipe 19 — track in-flight count

```go
var inflight atomic.Int64
pool := tunny.NewFunc(n, func(p any) any {
    inflight.Add(1)
    defer inflight.Add(-1)
    return work(p)
})
```

### Recipe 20 — graceful shutdown helper

```go
func (s *Service) Shutdown(ctx context.Context) error {
    done := make(chan struct{})
    go func() {
        s.pool.Close()
        close(done)
    }()
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-done:
        return nil
    }
}
```

These twenty recipes cover essentially everything you will reach for at the junior level. Copy them into a snippet file and you will save hours over the next year.

---

## Appendix F — Minimal Test Suite for a Tunny-Backed Function

Production code should have tests. Here is a pattern that works well for tunny-backed functions:

```go
package work

import (
    "runtime"
    "strings"
    "testing"

    "github.com/Jeffail/tunny"
)

func newTestPool(t *testing.T) *tunny.Pool {
    t.Helper()
    p := tunny.NewFunc(runtime.NumCPU(), func(payload any) any {
        return strings.ToUpper(payload.(string))
    })
    t.Cleanup(p.Close)
    return p
}

func TestUpperSingle(t *testing.T) {
    p := newTestPool(t)
    got := p.Process("hello").(string)
    if got != "HELLO" {
        t.Errorf("got %q, want HELLO", got)
    }
}

func TestUpperConcurrent(t *testing.T) {
    p := newTestPool(t)

    inputs := []string{"a", "b", "c", "d", "e"}
    results := make([]string, len(inputs))
    done := make(chan int, len(inputs))
    for i, in := range inputs {
        i, in := i, in
        go func() {
            results[i] = p.Process(in).(string)
            done <- i
        }()
    }
    for range inputs {
        <-done
    }

    for i, r := range results {
        want := strings.ToUpper(inputs[i])
        if r != want {
            t.Errorf("idx %d: got %q want %q", i, r, want)
        }
    }
}
```

Notes:

- `t.Cleanup(p.Close)` is a Go 1.14+ idiom that runs `Close` automatically when the test finishes — pass or fail.
- Each test owns its own pool. Tests do not share pools; that would create state leakage between tests.
- The concurrent test demonstrates the property we actually care about: many callers, correct results.

Run with `go test ./... -race` to catch any unintended data races inside your worker.

---

## Appendix G — Reading the Source

The entire tunny library at the time of writing fits comfortably on one screen of github.com. We will dig into the implementation in `senior.md`. For now, after you finish this file, treat yourself: open the source of `tunny/tunny.go` and read it slowly.

Look for:

- The `Pool` struct fields.
- The `workerWrapper` type — the per-worker goroutine driver.
- The internal `reqChan` channel.
- How `Process`, `ProcessTimed`, and `ProcessCtx` differ.

You do not need to understand every line. You need to see that the library is small. That alone is reassuring: tunny is not a magic black box. It is a few hundred lines of clear Go.

---

## Appendix H — One Last Mental Model

Imagine a hotel with `n` bellhops. Guests arrive at unpredictable times with luggage. Each bellhop takes one bag at a time to the room, comes back, takes the next. If `n+1` guests arrive at once, one of them waits at the desk.

- **Pool** = the hotel.
- **Worker** = a bellhop.
- **Process(bag)** = a guest handing over a bag and waiting at the desk until it has been delivered.
- **Close** = the hotel closing for the night; bellhops finish current deliveries and go home.

Hold this image when you write tunny code. Most of the right design decisions follow directly from it.

You are done with the junior level. Move to `middle.md` when you have shipped at least one program using `tunny.NewFunc`.

---

## Appendix I — Idiomatic Naming for Tunny in Your Codebase

A small but valuable habit: use consistent names. Code review fatigue drops when the team agrees on a few conventions.

Suggested names:

- The pool field on a struct is `pool` (singular) or `<workload>Pool` (e.g. `resizePool`, `hashPool`).
- The worker function is `<verb>Worker`, e.g. `resizeWorker`, `hashWorker`, or just the verb if the context is clear: `resize`, `hash`.
- The payload type is `<Verb>Job`: `ResizeJob`, `HashJob`. The result type is `<Verb>Result`: `ResizeResult`, `HashResult`.
- The owner type that wraps the pool is `<Workload>Service` or `<Workload>er`: `ResizeService`, `Hasher`.

Putting it together:

```go
type Hasher struct {
    pool *tunny.Pool
}

type HashJob struct {
    Data []byte
}

type HashResult struct {
    Sum []byte
    Err error
}

func hashWorker(payload any) any {
    job := payload.(HashJob)
    h := sha256.Sum256(job.Data)
    return HashResult{Sum: h[:]}
}

func NewHasher(size int) *Hasher {
    return &Hasher{pool: tunny.NewFunc(size, hashWorker)}
}

func (h *Hasher) Hash(data []byte) ([]byte, error) {
    r := h.pool.Process(HashJob{Data: data}).(HashResult)
    return r.Sum, r.Err
}

func (h *Hasher) Close() { h.pool.Close() }
```

This is the production shape distilled. Every project that uses tunny eventually converges on something like it.

---

## Appendix J — Closing Thoughts

You have spent a long while in this file. A short reflection:

Concurrency in Go is so cheap that it is tempting to spawn goroutines indiscriminately. That is the right instinct for small programs. For larger programs — and especially for services that must run for weeks — bounded concurrency is the discipline that keeps your service healthy. Tunny is one of the simplest, smallest ways to enforce that discipline.

Tunny is not a silver bullet. It is one of three or four reasonable pool libraries in the Go ecosystem (`ants`, `workerpool`, `pond` are the others). Each picks a different trade-off. Tunny's trade-off is "small, synchronous, worker-as-an-object". When that matches your workload, the code that results is unusually clear. When it does not match — when you want submit-and-forget, or dynamic resize, or priorities — pick a different library and feel no guilt.

In the middle file we will see how the `Worker` interface changes the picture. Until then, build something with `NewFunc`. Type the code. Run it under load. See what happens when the pool is too small. See what happens when it is too large. Numbers in the head are worth a hundred articles read.

---

## Appendix K — Frequently Asked Surface-Level Questions

A long miscellany of questions that come up in real code review and pair programming, none of which deserve a full section but all of which are worth answering.

### Why does `Process` accept `interface{}` and not a generic type parameter?

History. Tunny predates generics. The maintainer has not (yet) introduced a generic variant. You can build your own on top, as shown in `TypedPool[In, Out]` above.

### Is there a `Submit` method like other libraries?

No. The submission method is `Process`. There is no fire-and-forget variant — submitting always blocks until you have a result.

### How do I do fire-and-forget then?

Wrap the call in a goroutine that you do not wait for:

```go
go pool.Process(x)
```

This is legal. It just means you do not get the result. Be careful: if the pool is closed before that goroutine runs, you will panic. So fire-and-forget over a closed pool is a footgun.

### What is the difference between a tunny worker goroutine and a sysmon goroutine?

Tunny worker goroutines are user-level goroutines that you (indirectly) created. Sysmon is a runtime-internal goroutine. They are unrelated.

### Does tunny use `runtime.LockOSThread`?

No. Workers run as ordinary goroutines that the scheduler can move between OS threads. If you need pinning, do it yourself inside the worker function — but think hard about whether you really need it.

### Can tunny workers call `cgo`?

Yes. Workers are just goroutines; cgo works normally. Note that cgo calls bump the thread count momentarily — be aware of `GOMAXPROCS` versus the number of cgo calls in flight.

### Does tunny respect `GOMAXPROCS`?

It does not "respect" or "violate" `GOMAXPROCS` — the runtime scheduler controls that. Tunny just creates goroutines; the scheduler decides how to run them. If `GOMAXPROCS=2` and your pool has 8 workers, at most 2 of them are executing at any instant.

### How does tunny interact with `runtime.GC`?

GC pauses pause every goroutine, including tunny workers, briefly. This is normal and not a tunny concern.

### Can I create a pool of pools?

You can — but ask why. If you find yourself wanting nested pools, you probably want a single pool with a payload that contains a "kind" discriminator. Or you want different specialised pools at the top level.

### Will tunny work in a WASM target?

Probably, but it has not been a focus. WASM has restricted threading; tunny's goroutines should still work as goroutines, but parallelism may be different.

### Is tunny thread-safe?

Tunny is **goroutine-safe**. There are no OS threads in the Go programmer's mental model — goroutines are what you reason about. Any number of goroutines can call `Process` concurrently. Tunny serialises internally as needed.

### What if my worker writes to a shared map?

That is your problem, not tunny's. The Go race detector will catch unsynchronised map writes from multiple goroutines. Use a `sync.Mutex` or `sync.Map`, or design out the shared map entirely.

### Can I `Process(nil)`?

Yes. `nil` is a valid `any` value. Whether your worker handles it depends on the worker function.

### Can the worker call `os.Exit`?

It can. That would terminate the whole program. Almost never the right thing to do.

### Will a long-running worker block the GC?

If your worker is a tight loop with no function calls or backward branches, async preemption (Go 1.14+) will eventually kick in. In practice, this is rarely an issue. The Go runtime handles long-running goroutines without help from you.

### Can I use tunny in a test?

Absolutely. Use `t.Cleanup(pool.Close)` as shown in Appendix F.

### Should the pool size be a constant?

Almost always, no. Read it from config or compute it from `runtime.NumCPU`. Hardcoded sizes age poorly across machines.

### Should I pool a `*tunny.Pool` itself?

This question makes no sense and you should not be asking it. A pool is a long-lived object. Pooling pools is overthinking.

### What is a "stateless" worker?

A worker whose behaviour depends only on the payload, not on any state that persists across calls. The `NewFunc` API gives you stateless workers (the function is the same across calls, and Go does not give the function a place to keep state without globals). For stateful workers — caches, buffers, expensive constructors — use `tunny.New` with the `Worker` interface. Middle file.

### What if my worker needs to talk to a database?

Two patterns. Either:

- Each worker has its own connection. Use the `Worker` interface so each instance gets a connection at construction time.
- All workers share a connection pool (`*sql.DB`). This is the lazy default and is fine for most workloads. The DB pool is itself bounded, so you might double-bound: tunny limits in-flight requests, the DB pool limits in-flight queries.

### Does tunny play with structured logging libraries?

Yes. Inside the worker, log normally. Pass log context via the payload struct — do not capture loggers in the closure that has been built into the pool's worker function.

### What if I see `panic: send on closed channel` from tunny in my logs?

Almost certainly you called `Close` twice, or called `Process` after `Close`. Audit your code for ownership and ordering. This is the #1 production issue with tunny.

### What if I see goroutines pile up in pprof?

Either you are creating pools and not closing them, or your worker goroutines are blocking on something inside `Process`. Use the goroutine profile to find the call site:

```bash
go tool pprof http://localhost:6060/debug/pprof/goroutine
```

Look for stacks ending in `tunny.(*workerWrapper).run` — many of them, parked, mean leaked pools.

### How do I integrate tunny with `errgroup`?

```go
g, ctx := errgroup.WithContext(ctx)
for _, j := range jobs {
    j := j
    g.Go(func() error {
        r := pool.Process(j).(Result)
        if r.Err != nil {
            return r.Err
        }
        return nil
    })
}
return g.Wait()
```

`errgroup` manages the callers, tunny manages the in-flight cap. This composition is common in production code.

### Can I migrate a `chan T`-based pool to tunny without rewriting callers?

Yes. Hide your channel behind a `func(In) Out`. Replace the channel implementation with tunny. The function signature stays the same. This is a low-risk refactor that often improves both code clarity and observability.

### Is tunny still maintained?

As of writing, the repository receives occasional updates. It is a small, stable library that does not need much maintenance. The core API has not changed materially in years.

---

## Appendix L — One-Page Visual Summary

Print this out and tape it next to your monitor.

```
+---------------------------------------------------------------+
|                          TUNNY                                |
|       "bounded queue of identical synchronous workers"        |
+---------------------------------------------------------------+
| pool := tunny.NewFunc(N, func(any) any { return ... })        |
| defer pool.Close()                                            |
| result := pool.Process(payload)                               |
+---------------------------------------------------------------+
| N      = runtime.NumCPU() for CPU-bound work                  |
| Process is synchronous (caller blocks)                        |
| Process is goroutine-safe (any number of callers)             |
| Close is one-shot (calling twice panics)                      |
| no error return -> wrap result in a struct with Err field     |
+---------------------------------------------------------------+
| Avoid: pool per request, pool size 0, close twice,            |
|        process after close, mutex held across process         |
+---------------------------------------------------------------+
| Use when: CPU-bound, expensive stateful workers, need cap     |
| Skip when: cheap IO-bound work, need priorities, need resize  |
+---------------------------------------------------------------+
```

This card captures every junior-level decision. If you can answer "yes" to "do these recipes apply to my problem?", you are using tunny correctly. If not — step back and reconsider.

---

## Appendix M — Reading Roadmap from Here

After this file:

1. Build one small project using `tunny.NewFunc`. Even a 50-line CLI counts.
2. Read [middle.md](middle.md) for the `Worker` interface, timeouts, and contexts.
3. Skim [specification.md](specification.md) for the precise API contract.
4. Try a few exercises from [tasks.md](tasks.md).
5. Glance at [find-bug.md](find-bug.md) to see what production-shape mistakes look like.
6. When you start your first production deployment, read [professional.md](professional.md).

This order respects the order in which the material becomes useful. Do not jump to `senior.md` before you have used `NewFunc` in anger — the internals make more sense once you have a feel for the surface.

Welcome to tunny. Most production Go services that use it have a 30-line file somewhere that looks exactly like the examples above, and that one file is responsible for keeping the service healthy under unpredictable load. You are now equipped to write that file with confidence.

