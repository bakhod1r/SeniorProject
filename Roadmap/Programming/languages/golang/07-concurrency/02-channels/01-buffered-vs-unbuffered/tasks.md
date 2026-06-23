# Buffered vs Unbuffered Channels — Tasks

> A graded set of exercises. Solve each one before moving on. Sample solutions appear at the end of each task. Run with `go run` and `go test -race`.

---

## Task 1 — Hello, channel

Write a program that:

1. Creates an unbuffered channel of strings.
2. Launches a goroutine that sends the string `"hello, world"` on the channel.
3. The main goroutine receives the string and prints it.

### Sample solution

```go
package main

import "fmt"

func main() {
    ch := make(chan string)
    go func() { ch <- "hello, world" }()
    fmt.Println(<-ch)
}
```

### Variation

Add a second send: `"hello again"`. Receive both. Note that if you forget to launch *two* sends or *one* loop on the receiver you deadlock — use that to confirm your mental model.

---

## Task 2 — Buffer behaviour

Write a program that:

1. Creates a buffered channel of integers with capacity 3.
2. Sends `1`, `2`, `3` in a single goroutine without launching any receiver.
3. Prints `len(ch)` and `cap(ch)` after each send.
4. Then receives all three values in a `for` loop and prints them.

### Sample solution

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 3)
    for _, v := range []int{1, 2, 3} {
        ch <- v
        fmt.Printf("after send %d: len=%d cap=%d\n", v, len(ch), cap(ch))
    }
    for i := 0; i < 3; i++ {
        fmt.Println("recv:", <-ch)
    }
}
```

Expected output:
```
after send 1: len=1 cap=3
after send 2: len=2 cap=3
after send 3: len=3 cap=3
recv: 1
recv: 2
recv: 3
```

### Variation

Add a fourth send and observe the deadlock panic. Then add a goroutine that drains the channel and confirm the program now finishes.

---

## Task 3 — Range until close

Write a program that:

1. Has a producer goroutine sending the squares of 1..10 on a channel.
2. The producer closes the channel when finished.
3. The main goroutine ranges over the channel and prints each value.

### Sample solution

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    go func() {
        defer close(ch)
        for i := 1; i <= 10; i++ {
            ch <- i * i
        }
    }()
    for v := range ch {
        fmt.Println(v)
    }
}
```

### Variation

Make the channel buffered (capacity 5). Notice how the program runs identically — `range` does not care about capacity.

---

## Task 4 — Comma-ok and zero values

Write a program that:

1. Sends `42` on a buffered channel of capacity 1.
2. Closes the channel.
3. Receives twice using the comma-ok form, printing `(value, ok)` each time.

### Sample solution

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 1)
    ch <- 42
    close(ch)
    for i := 0; i < 2; i++ {
        v, ok := <-ch
        fmt.Printf("recv: %d, %v\n", v, ok)
    }
}
```

Expected output:
```
recv: 42, true
recv: 0, false
```

---

## Task 5 — The done signal

Write a program that:

1. Spawns a worker goroutine that prints `"working"` and then signals it is done.
2. The main goroutine waits for the signal before printing `"main exiting"`.

Use `chan struct{}` and `close` for the signal.

### Sample solution

```go
package main

import "fmt"

func main() {
    done := make(chan struct{})
    go func() {
        fmt.Println("working")
        close(done)
    }()
    <-done
    fmt.Println("main exiting")
}
```

---

## Task 6 — Multiple receivers, broadcast cancel

Write a program that:

1. Spawns three worker goroutines, each blocked on `<-stop`.
2. The main goroutine sleeps 100 ms and then closes `stop`.
3. All three workers print `"stopped"` and exit.
4. Main waits for all of them to finish (use `sync.WaitGroup`).

### Sample solution

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    stop := make(chan struct{})
    var wg sync.WaitGroup

    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            <-stop
            fmt.Printf("worker %d stopped\n", id)
        }(i)
    }

    time.Sleep(100 * time.Millisecond)
    close(stop)
    wg.Wait()
}
```

---

## Task 7 — Producer-consumer with backpressure

Write a program that:

1. Has one producer that wants to push 100 items as fast as possible.
2. Has one consumer that processes each item with a 5 ms delay.
3. Uses a buffered channel of capacity 10 between them.
4. Prints `"buffer full at i=%d"` whenever a send blocks.

Hint: detect the "would block" condition with `select`+`default` *before* the actual send.

### Sample solution

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int, 10)
    done := make(chan struct{})

    go func() {
        defer close(done)
        for v := range ch {
            time.Sleep(5 * time.Millisecond)
            _ = v
        }
    }()

    for i := 0; i < 100; i++ {
        select {
        case ch <- i:
        default:
            fmt.Printf("buffer full at i=%d\n", i)
            ch <- i // now block until room
        }
    }
    close(ch)
    <-done
}
```

The first ~10 sends fit in the buffer instantly. The 11th onward triggers the "full" branch repeatedly until the consumer drains.

---

## Task 8 — Semaphore

Write a program that:

1. Has a list of 20 URLs.
2. Fetches them concurrently *but at most 4 at a time*.
3. Uses a buffered channel of `struct{}` as the semaphore.

(`fetch(url)` can be a stub that just sleeps a random duration.)

### Sample solution

```go
package main

import (
    "fmt"
    "math/rand"
    "sync"
    "time"
)

func fetch(url string) {
    time.Sleep(time.Duration(rand.Intn(200)) * time.Millisecond)
    fmt.Printf("done %s\n", url)
}

func main() {
    urls := make([]string, 20)
    for i := range urls {
        urls[i] = fmt.Sprintf("https://example.com/%d", i)
    }

    sem := make(chan struct{}, 4)
    var wg sync.WaitGroup
    for _, u := range urls {
        wg.Add(1)
        sem <- struct{}{}
        go func(u string) {
            defer wg.Done()
            defer func() { <-sem }()
            fetch(u)
        }(u)
    }
    wg.Wait()
}
```

Run with `time go run main.go`. Total wall-clock time is roughly `(20/4) × averageSleep` rather than `20 × averageSleep`.

---

## Task 9 — Capacity-tuning experiment

Write a program with a producer that pushes 10,000 integers and a consumer that reads them all. Measure total runtime as a function of the channel capacity: 0, 1, 16, 256, 4096.

Use `time.Now()` and `time.Since()`.

### Sample solution

```go
package main

import (
    "fmt"
    "time"
)

func bench(cap int) time.Duration {
    ch := make(chan int, cap)
    start := time.Now()
    go func() {
        for i := 0; i < 10_000; i++ {
            ch <- i
        }
        close(ch)
    }()
    var sum int
    for v := range ch {
        sum += v
    }
    return time.Since(start)
}

func main() {
    for _, c := range []int{0, 1, 16, 256, 4096} {
        d := bench(c)
        fmt.Printf("cap=%-5d duration=%v\n", c, d)
    }
}
```

You will see that capacity 0 is consistently slowest (every send-receive parks); capacities 1..16 are dramatically faster; from there the difference is small. This reproduces the lesson that buffer capacity is mostly a *small-burst* optimisation, not a "more is better" knob.

---

## Task 10 — Multi-producer, single coordinator close

Write a program where:

1. Three producer goroutines each send 5 integers on a shared channel.
2. None of the producers close the channel (avoid double-close panic).
3. A coordinator goroutine waits for all producers via `sync.WaitGroup` and then closes.
4. The main goroutine ranges over the channel and prints all 15 values.

### Sample solution

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    out := make(chan int, 8)
    var wg sync.WaitGroup
    for p := 0; p < 3; p++ {
        wg.Add(1)
        go func(p int) {
            defer wg.Done()
            for i := 0; i < 5; i++ {
                out <- p*100 + i
            }
        }(p)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    for v := range out {
        fmt.Println(v)
    }
}
```

---

## Task 11 — Convert a busy-wait to a channel pattern

Below is a busy-wait skeleton. Refactor it to use a buffered channel as a queue, eliminating the `time.Sleep`.

```go
var mu sync.Mutex
var queue []int

func produce() {
    for i := 0; ; i++ {
        mu.Lock()
        queue = append(queue, i)
        mu.Unlock()
    }
}

func consume() {
    for {
        mu.Lock()
        if len(queue) == 0 {
            mu.Unlock()
            time.Sleep(10 * time.Millisecond)
            continue
        }
        v := queue[0]
        queue = queue[1:]
        mu.Unlock()
        process(v)
    }
}
```

### Sample solution

```go
ch := make(chan int, 16)

func produce() {
    for i := 0; ; i++ {
        ch <- i
    }
}

func consume() {
    for v := range ch {
        process(v)
    }
}
```

The mutex, the slice, the busy wait, and the polling all collapse. Backpressure becomes automatic.

---

## Task 12 — Avoid the leak

The following code launches a goroutine that may leak. Fix it without changing the function signature.

```go
func first(urls []string) string {
    out := make(chan string)
    for _, u := range urls {
        u := u
        go func() {
            out <- fetch(u)
        }()
    }
    return <-out
}
```

After the first send, the function returns — but the other goroutines are still parked on `out <- fetch(u)`, leaking forever. Fix by giving the channel enough buffer or by using `select` with a cancel.

### Sample solution (buffer fix)

```go
func first(urls []string) string {
    out := make(chan string, len(urls))
    for _, u := range urls {
        u := u
        go func() {
            out <- fetch(u)
        }()
    }
    return <-out
}
```

The buffer is exactly large enough for every goroutine to complete its send; nobody parks; nobody leaks. The "first one wins" semantics are unchanged because the function still returns after the first receive.

### Sample solution (select fix)

```go
func first(urls []string, ctx context.Context) string {
    out := make(chan string)
    for _, u := range urls {
        u := u
        go func() {
            select {
            case out <- fetch(u):
            case <-ctx.Done():
            }
        }()
    }
    return <-out
}
```

The caller cancels the context after using the result; the other goroutines exit via the cancel branch. This requires cooperation from callers — the buffer fix is simpler.

---

## Task 13 — Build a simple rate limiter

Write a `Limiter` type with `Acquire()` and `Release()` methods that limits concurrent operations to `N`. Use a buffered channel under the hood. Add a benchmark that runs 100 goroutines through it with `N=10`.

### Sample solution

```go
type Limiter struct {
    sem chan struct{}
}

func NewLimiter(n int) *Limiter        { return &Limiter{sem: make(chan struct{}, n)} }
func (l *Limiter) Acquire()            { l.sem <- struct{}{} }
func (l *Limiter) Release()            { <-l.sem }

func BenchmarkLimiter(b *testing.B) {
    l := NewLimiter(10)
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            l.Acquire()
            time.Sleep(time.Microsecond)
            l.Release()
        }
    })
}
```

---

## Task 14 — Detect "send to closed" without panicking

You have a function that receives an external `chan int` and may or may not be closed. Write a helper that *attempts* to send `v` on `ch` and returns `false` if the channel was closed, without panicking.

(Hint: this is a trick. Pure send cannot detect closed without panicking. The honest answer is "use a select with a recv-case and accept that you cannot," or "redesign so close coordination is owned by you.")

### Sample solution (acknowledging the trick)

```go
func trySend(ch chan int, v int) (sent bool) {
    defer func() {
        if r := recover(); r != nil {
            sent = false
        }
    }()
    ch <- v
    return true
}
```

`recover` works — but using `panic`/`recover` for control flow is bad style. The right fix is structural: make sure the close is coordinated, so this function is never called against a closed channel in the first place. Use this exercise to *appreciate why* the closing rules matter, not as a pattern to copy.

---

## Task 15 — Channel-based pipeline stages

Build a pipeline of three stages:

1. `numbers()` produces 1..100.
2. `square()` takes a `<-chan int` and returns a `<-chan int` of squared values.
3. `even()` filters to even values only.

Compose them as `even(square(numbers()))` and print all results.

### Sample solution

```go
func numbers() <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 1; i <= 100; i++ {
            out <- i
        }
    }()
    return out
}

func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- v * v
        }
    }()
    return out
}

func even(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            if v%2 == 0 {
                out <- v
            }
        }
    }()
    return out
}

func main() {
    for v := range even(square(numbers())) {
        fmt.Println(v)
    }
}
```

Each stage owns its output channel: it closes when its input closes. The pipeline shuts down naturally end-to-end.

---

## Task 16 — Stretch: bounded concurrent pipeline

Modify Task 15 so that `square` runs across 4 worker goroutines in parallel, with a buffered channel of capacity 16 between stages. Verify with `go test -race` that there are no data races.

### Sample solution sketch

```go
func square(in <-chan int) <-chan int {
    out := make(chan int, 16)
    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for v := range in {
                out <- v * v
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

The output ordering is now non-deterministic — that is the price of fan-out. If your downstream stage cares about ordering, you need a sequence number per item.

---

## Reflection prompts

After finishing the tasks, write down (informally) your answers to:

- Which of these tasks felt awkward without a `select`? Mark them — those are exactly the patterns the next chapter improves.
- For each `make(chan T, N)` in your solutions, justify the `N`. If you cannot, the value is wrong.
- For each goroutine you spawned, name the condition under which it exits. If the answer is "it does not," it leaks.
