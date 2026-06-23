# Worker Pools — Find the Bug

Each exercise contains a worker-pool implementation with one or more bugs. Read the code, predict what happens, then check the diagnosis. The fix is given last; resist looking until you've identified the bug.

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Exercise 1 — The Hung Pool](#exercise-1-the-hung-pool)
3. [Exercise 2 — The Vanishing Workers](#exercise-2-the-vanishing-workers)
4. [Exercise 3 — Send on Closed Channel](#exercise-3-send-on-closed-channel)
5. [Exercise 4 — The Race Condition](#exercise-4-the-race-condition)
6. [Exercise 5 — The Wait That Never Returns](#exercise-5-the-wait-that-never-returns)
7. [Exercise 6 — The Panic Cascade](#exercise-6-the-panic-cascade)
8. [Exercise 7 — Cancellation That Doesn't](#exercise-7-cancellation-that-doesnt)
9. [Exercise 8 — The Lost Results](#exercise-8-the-lost-results)
10. [Exercise 9 — Double Close](#exercise-9-double-close)
11. [Exercise 10 — Pool of Zero](#exercise-10-pool-of-zero)
12. [Exercise 11 — Deadlock on Full Results](#exercise-11-deadlock-on-full-results)
13. [Exercise 12 — Worker Exits Too Early](#exercise-12-worker-exits-too-early)
14. [Exercise 13 — Counter Off by One](#exercise-13-counter-off-by-one)
15. [Bug Patterns Summary](#bug-patterns-summary)

---

## How to Use This File

1. Read the code carefully. Don't run it yet.
2. Predict: what does this program do? Crash? Hang? Wrong output? Race?
3. Read the **Symptom** section to verify your prediction.
4. Read the **Diagnosis** to understand why.
5. Read the **Fix** only after you've thought about how you'd fix it.

Run each fixed snippet with `go run -race`.

---

## Exercise 1 — The Hung Pool

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    jobs := make(chan int, 10)
    results := make(chan int, 10)
    var wg sync.WaitGroup

    for w := 0; w < 3; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range jobs {
                results <- j * j
            }
        }()
    }

    for i := 1; i <= 5; i++ {
        jobs <- i
    }

    wg.Wait()

    for r := range results {
        fmt.Println(r)
    }
}
```

**Symptom:** The program hangs forever. `wg.Wait()` never returns. Eventually Go reports: `fatal error: all goroutines are asleep - deadlock!`

**Diagnosis:** `close(jobs)` is missing. Workers stay in `for j := range jobs` forever, blocked on receive. `wg.Wait()` waits for workers that will never call `Done()`.

**Fix:** Add `close(jobs)` after sending all jobs:

```go
for i := 1; i <= 5; i++ {
    jobs <- i
}
close(jobs) // ← added

go func() { wg.Wait(); close(results) }() // ← also need this so the consumer's range exits
```

---

## Exercise 2 — The Vanishing Workers

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    jobs := make(chan int)
    var wg sync.WaitGroup

    for w := 0; w < 4; w++ {
        go func() {
            wg.Add(1)
            defer wg.Done()
            for j := range jobs {
                fmt.Println(j)
            }
        }()
    }

    for i := 1; i <= 10; i++ {
        jobs <- i
    }
    close(jobs)
    wg.Wait()
}
```

**Symptom:** Sometimes the program hangs. Sometimes it works. Behaviour depends on goroutine scheduling.

**Diagnosis:** `wg.Add(1)` is *inside* the goroutine. Between `for w := 0; ...` and the moment any goroutine calls Add, `wg.Wait()` could see counter = 0 and return early. Race.

**Fix:** Move `wg.Add(1)` *before* `go func()`:

```go
for w := 0; w < 4; w++ {
    wg.Add(1)            // ← moved out
    go func() {
        defer wg.Done()
        for j := range jobs {
            fmt.Println(j)
        }
    }()
}
```

---

## Exercise 3 — Send on Closed Channel

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    jobs := make(chan int)
    var wg sync.WaitGroup

    for w := 0; w < 4; w++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for j := range jobs {
                fmt.Printf("worker %d got %d\n", id, j)
                if j == 5 {
                    close(jobs) // shouldn't be done from here
                }
            }
        }(w)
    }

    for i := 1; i <= 10; i++ {
        jobs <- i
    }
    close(jobs)
    wg.Wait()
}
```

**Symptom:** Crashes with `panic: send on closed channel`. Sometimes runs to completion if the timing is unlucky.

**Diagnosis:** Two violations: (1) a worker (a receiver) closes the jobs channel, and (2) the main goroutine then tries to close it again. Either the producer's `jobs <- i` panics on a closed channel, or the second `close(jobs)` panics.

**Fix:** Workers never close. The producer is the sole closer:

```go
go func(id int) {
    defer wg.Done()
    for j := range jobs {
        fmt.Printf("worker %d got %d\n", id, j)
        // no close here
    }
}(w)
```

---

## Exercise 4 — The Race Condition

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    jobs := make(chan int, 100)
    var wg sync.WaitGroup
    var counter int

    for w := 0; w < 8; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for range jobs {
                counter++
            }
        }()
    }

    for i := 0; i < 10000; i++ {
        jobs <- i
    }
    close(jobs)
    wg.Wait()

    fmt.Println("counter:", counter)
}
```

**Symptom:** With `go run -race`: data race. Without race detector: counter < 10000 (e.g., 9847).

**Diagnosis:** `counter++` is a read-modify-write across 8 goroutines without synchronisation. Lost increments.

**Fix:** `atomic.Int64`:

```go
import "sync/atomic"

var counter atomic.Int64

go func() {
    defer wg.Done()
    for range jobs {
        counter.Add(1)
    }
}()

fmt.Println("counter:", counter.Load())
```

---

## Exercise 5 — The Wait That Never Returns

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    jobs := make(chan int)
    results := make(chan int)
    var wg sync.WaitGroup

    for w := 0; w < 3; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range jobs {
                results <- j * 2
            }
        }()
    }

    go func() {
        for i := 1; i <= 100; i++ {
            jobs <- i
        }
        close(jobs)
    }()

    go func() { wg.Wait(); close(results) }()

    // forgot to drain results
    fmt.Println("done")
}
```

**Symptom:** Program prints "done" and exits. But run it under `-race` or in production and goroutines linger. With `runtime.NumGoroutine()` you'd see workers blocked.

**Diagnosis:** No consumer for `results`. Workers block on `results <- j * 2`. None of them ever calls `Done()`. The closer goroutine blocks on `wg.Wait()` forever. `main` doesn't notice because `main` doesn't wait on anything.

**Fix:** Always drain results, and make main wait until everything is done:

```go
done := make(chan struct{})
go func() {
    for r := range results {
        _ = r // or process
    }
    close(done)
}()

<-done
fmt.Println("done")
```

---

## Exercise 6 — The Panic Cascade

```go
package main

import (
    "fmt"
    "sync"
)

func process(j int) int {
    if j == 7 {
        panic("seven is bad")
    }
    return j * j
}

func main() {
    jobs := make(chan int, 10)
    results := make(chan int, 10)
    var wg sync.WaitGroup

    for w := 0; w < 3; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range jobs {
                results <- process(j)
            }
        }()
    }

    for i := 1; i <= 10; i++ {
        jobs <- i
    }
    close(jobs)

    go func() { wg.Wait(); close(results) }()

    for r := range results {
        fmt.Println(r)
    }
}
```

**Symptom:** Program crashes: `panic: seven is bad`. Stack shows the worker goroutine.

**Diagnosis:** No `recover` in the worker. One bad job kills the whole program.

**Fix:** Recover at the top of the worker:

```go
go func() {
    defer wg.Done()
    defer func() {
        if r := recover(); r != nil {
            fmt.Printf("worker recovered: %v\n", r)
        }
    }()
    for j := range jobs {
        results <- process(j)
    }
}()
```

Note: a recovered worker exits early. The pool effectively shrinks. To keep the pool size, wrap each *job* in a recover or restart the worker.

---

## Exercise 7 — Cancellation That Doesn't

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    jobs := make(chan int, 100)
    var wg sync.WaitGroup

    for w := 0; w < 3; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range jobs {
                time.Sleep(100 * time.Millisecond)
                fmt.Println("processed", j)
            }
        }()
    }

    for i := 0; i < 100; i++ {
        jobs <- i
    }
    close(jobs)

    time.Sleep(150 * time.Millisecond)
    cancel()

    wg.Wait()
}
```

**Symptom:** All 100 jobs are processed despite `cancel()`. Cancellation has no effect.

**Diagnosis:** Workers never check `ctx.Done()`. The cancel is ignored. (`cancel()` only fires `ctx.Done()`; goroutines must observe it.)

**Fix:** Check ctx inside the worker:

```go
go func() {
    defer wg.Done()
    for {
        select {
        case <-ctx.Done():
            return
        case j, ok := <-jobs:
            if !ok {
                return
            }
            time.Sleep(100 * time.Millisecond)
            fmt.Println("processed", j)
        }
    }
}()
```

Also pass ctx into long-running parts (e.g., `select { case <-time.After(...): case <-ctx.Done(): }` instead of `time.Sleep`).

---

## Exercise 8 — The Lost Results

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    jobs := make(chan int, 5)
    results := make(chan int) // unbuffered
    var wg sync.WaitGroup

    for w := 0; w < 3; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range jobs {
                results <- j * j
            }
        }()
    }

    for i := 1; i <= 5; i++ {
        jobs <- i
    }
    close(jobs)

    // Read only first 3 results, then exit
    for i := 0; i < 3; i++ {
        fmt.Println(<-results)
    }

    wg.Wait() // hangs
}
```

**Symptom:** Prints 3 results, then hangs forever.

**Diagnosis:** Workers process 5 jobs but consumer reads only 3 results. Workers 4 and 5 block on `results <- ...`. They never call `Done()`. `wg.Wait()` hangs.

**Fix:** Always drain all results, *or* use a buffered results channel with capacity ≥ jobs:

```go
results := make(chan int, 5) // or just drain everything

for r := range results {
    fmt.Println(r)
}
```

The right pattern is to range over `results` and have a closer goroutine close it after `wg.Wait()`.

---

## Exercise 9 — Double Close

```go
package main

import (
    "fmt"
    "sync"
)

func produce(jobs chan<- int, items []int, wg *sync.WaitGroup) {
    defer wg.Done()
    defer close(jobs)
    for _, x := range items {
        jobs <- x
    }
}

func main() {
    jobs := make(chan int, 10)
    var pwg sync.WaitGroup

    pwg.Add(2)
    go produce(jobs, []int{1, 2, 3}, &pwg)
    go produce(jobs, []int{4, 5, 6}, &pwg)

    var wwg sync.WaitGroup
    wwg.Add(1)
    go func() {
        defer wwg.Done()
        for j := range jobs {
            fmt.Println(j)
        }
    }()

    pwg.Wait()
    wwg.Wait()
}
```

**Symptom:** Crashes: `panic: close of closed channel`.

**Diagnosis:** Two producers, each calling `defer close(jobs)`. The second close panics.

**Fix:** Use a single closer pattern with `sync.Once`, or have one orchestrator close after both producers finish:

```go
go func() {
    pwg.Wait()
    close(jobs)
}()
```

Remove the `defer close(jobs)` inside `produce`.

---

## Exercise 10 — Pool of Zero

```go
package main

import (
    "fmt"
    "sync"
)

func runPool(n int, items []int) {
    jobs := make(chan int)
    var wg sync.WaitGroup
    for w := 0; w < n; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range jobs {
                fmt.Println(j)
            }
        }()
    }
    for _, x := range items {
        jobs <- x
    }
    close(jobs)
    wg.Wait()
}

func main() {
    n := 0 // bug: came from a config
    runPool(n, []int{1, 2, 3})
}
```

**Symptom:** Hangs forever on `jobs <- 1`.

**Diagnosis:** Pool of size 0. No workers exist to receive from `jobs`. The first send blocks forever.

**Fix:** Validate at the top:

```go
func runPool(n int, items []int) {
    if n < 1 {
        panic("pool size must be >= 1")
        // or: return an error
    }
    // ...
}
```

In production code, default-or-error rather than panic. Never accept "0 workers" as a valid runtime value.

---

## Exercise 11 — Deadlock on Full Results

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    jobs := make(chan int, 10)
    results := make(chan int) // unbuffered
    var wg sync.WaitGroup

    for w := 0; w < 4; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range jobs {
                results <- j * 2
            }
        }()
    }

    for i := 0; i < 10; i++ {
        jobs <- i
    }
    close(jobs)

    go func() { wg.Wait(); close(results) }()

    var sum int
    for r := range results {
        sum += r
    }
    fmt.Println("sum:", sum)
}
```

**Symptom:** Hmm — looks fine at first. But what if the consumer (main) is slow?

**Diagnosis:** This actually works *because* main consumes results in a tight loop. But add any work in the consumer and workers will block on `results <- ...`. With unbuffered results and a slow consumer, the pool throttles to consumer speed. That may be desired (backpressure) or wrong (you wanted parallelism).

**The bug to think about:** if `process` is fast and consumer is slow, throughput equals consumer speed, not pool throughput. Workers are "wasted" most of the time. The fix is either:

- Buffer the results channel: `results := make(chan int, 100)`.
- Speed up the consumer (batch writes, async I/O).
- Drop results that exceed consumer capacity.

Choice depends on whether backpressure is the goal.

---

## Exercise 12 — Worker Exits Too Early

```go
package main

import (
    "context"
    "fmt"
    "sync"
)

func worker(ctx context.Context, jobs <-chan int, results chan<- int, wg *sync.WaitGroup) {
    defer wg.Done()
    for {
        select {
        case <-ctx.Done():
            return
        case j := <-jobs:
            results <- j * 2
        }
    }
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    jobs := make(chan int, 5)
    results := make(chan int, 5)
    var wg sync.WaitGroup

    wg.Add(2)
    go worker(ctx, jobs, results, &wg)
    go worker(ctx, jobs, results, &wg)

    for i := 1; i <= 3; i++ {
        jobs <- i
    }
    close(jobs)

    go func() { wg.Wait(); close(results) }()
    for r := range results {
        fmt.Println(r)
    }
}
```

**Symptom:** Sometimes prints 6, 4, 2 (good). Sometimes prints fewer numbers, or 0 zeros mixed in.

**Diagnosis:** When jobs is closed and drained, `case j := <-jobs` returns the zero value (0) immediately; the worker treats it as a real job. Worse: it loops on the closed channel forever, sending 0s into results until results fills.

**Fix:** Use the comma-ok form:

```go
case j, ok := <-jobs:
    if !ok {
        return
    }
    results <- j * 2
```

---

## Exercise 13 — Counter Off by One

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    jobs := make(chan int, 10)
    var wg sync.WaitGroup

    wg.Add(4)
    for w := 0; w < 5; w++ { // bug: spawning 5, but Add(4)
        go func(id int) {
            defer wg.Done()
            for j := range jobs {
                fmt.Printf("worker %d job %d\n", id, j)
            }
        }(w)
    }

    for i := 0; i < 10; i++ {
        jobs <- i
    }
    close(jobs)

    wg.Wait()
}
```

**Symptom:** `panic: sync: negative WaitGroup counter`.

**Diagnosis:** `Add(4)` but spawned 5 workers. The 5th worker's `Done()` makes the counter -1. Panic.

**Fix:** Add inside the loop, matched 1:1 with each goroutine:

```go
for w := 0; w < 5; w++ {
    wg.Add(1) // moved
    go func(id int) {
        defer wg.Done()
        // ...
    }(w)
}
```

Or compute correctly: `wg.Add(5)`. The single-Add-per-goroutine pattern is more robust.

---

## Bug Patterns Summary

| Pattern | Symptom | Defensive habit |
|---------|--------|-----------------|
| Forgot `close(jobs)` | Hang | `defer close(jobs)` in producer |
| `Add` inside goroutine | Race; intermittent hang | `Add` before `go func()` |
| Worker closes channel | Panic on send | Closers and senders are separate; receivers don't close |
| Multi-producer, multi-close | Panic on second close | Single closer; use sync.Once or orchestrator close |
| No recover in worker | Crash on bad job | `defer recover()` at top |
| No ctx check | Cancel ignored | Select on `ctx.Done()` in worker |
| Slow/missing consumer | Workers block; pool hangs | Always range results; buffered results |
| Add count mismatch | Negative counter panic | One `Add(1)` per `go func()` |
| Pool size 0 | Hang | Validate `n >= 1` at entry |
| `case j := <-jobs:` on closed | Spurious zero values | Use `j, ok := <-jobs; if !ok { return }` |
| Shared counter without sync | Lost updates; race | Atomic or mutex |
| Result channel too small + slow consumer | Worker stuck | Bound queue + reject, or larger buffer |
| Worker that ignores ctx during long compute | Cancellation latency | Pass ctx to all I/O; check periodically in tight loops |

A bug-free worker pool is mostly about *not making any of the 13 mistakes above*. The pattern itself is small; the discipline is what makes it production-ready.
