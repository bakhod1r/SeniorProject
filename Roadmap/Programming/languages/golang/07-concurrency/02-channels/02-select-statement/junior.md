# Select Statement — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "I have several channels. How do I wait on whichever one becomes ready first?"

You have learned about goroutines and channels. You know how to send a value into a channel with `ch <- v` and how to receive one with `v := <-ch`. But the moment you have **two** channels you start asking the obvious next question: how do I wait on either one? If I block on `ch1`, I miss anything coming from `ch2`. If I drain `ch1` in a loop and only then look at `ch2`, I starve `ch2`. I want a way to say "give me whichever is ready first."

That construct is `select`. It is a `switch`-shaped statement whose cases are channel operations. It blocks until at least one of them can proceed, then runs that one case and exits. With `default`, it becomes non-blocking. With `time.After`, it becomes a timeout. With a done channel, it becomes cancellation. Combine the three and you have written 80% of all the production concurrency you will ever write in Go.

After reading this file you will:
- Understand what `select` does and why it exists
- Be able to wait on multiple channels at once
- Know how `default` makes a `select` non-blocking
- Know how to build a timeout with `time.After`
- Know how to wire cancellation through a done channel
- Recognise the for-select loop and when to use it
- Know that `select` randomises among ready cases
- Understand `select{}` (block forever) and why anyone would write that
- Avoid the most common beginner traps

You do **not** need to know about `selectgo` internals, runtime polling order, or memory ordering yet. Those come in middle.md and senior.md. This file is about reading and writing your first `select` statements with confidence.

---

## Prerequisites

- **Required:** A Go installation (1.18 or newer is fine; 1.21+ recommended).
- **Required:** Comfort with goroutines (`go f()`) and channel basics (`make(chan int)`, `<-`, `close`).
- **Required:** The ability to read a `for` loop and a `switch` statement.
- **Helpful:** Having read [Buffered vs Unbuffered](../01-buffered-vs-unbuffered/junior.md). The blocking semantics there explain why `select` is needed.
- **Helpful:** Familiarity with the standard `time` package, especially `time.After`, `time.NewTimer`, and `time.Tick`.

If `go run` works on your machine and the lines `go func() { ch <- 1 }()` followed by `<-ch` make sense to you, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`select`** | A statement that waits on a set of channel operations and runs the case of whichever operation becomes ready first. Like `switch`, but for channels. |
| **case** | One arm of a `select`. Must be a channel send (`ch <- v`), a channel receive (`v := <-ch` or `<-ch`), or `default`. |
| **default case** | The arm that runs immediately if no other case is ready. Makes the entire `select` non-blocking. |
| **ready case** | A case whose channel operation can proceed without blocking right now. |
| **block** | To pause a goroutine until some condition (a send, a receive, a timer) lets it proceed. A `select` without `default` blocks until some case is ready. |
| **for-select loop** | The idiomatic pattern `for { select { ... } }` that repeatedly multiplexes over channels until one of the cases breaks out. |
| **done channel** | A `chan struct{}` (or `<-chan struct{}`) that signals "stop now" by being closed. A receive on a closed channel returns immediately, which makes it ideal as a cancel signal. |
| **timeout case** | A case using `time.After(d)` or a timer's channel that fires after duration `d`, used to give up waiting. |
| **fan-in** | Combining values from several channels into one consumer; commonly implemented with `select`. |
| **nil channel** | A channel variable whose value is `nil`. Sends and receives on a nil channel block forever, which lets you "disable" a case in a `select` dynamically. |
| **`select{}`** | An empty select with zero cases. Blocks forever. Used in `main` to keep a daemon alive. |
| **fairness** | The property that no case is starved when multiple cases are continuously ready. Go's `select` chooses randomly among ready cases, which gives statistical fairness but no ordering guarantee. |

---

## Core Concepts

### `select` is `switch` for channels

A `switch` statement compares a value against constants and runs one branch. A `select` statement looks at a set of channel operations and runs the branch whose operation is ready. The shape is the same — `select { case ...: ...; case ...: ... }` — but the cases are not values, they are channel ops.

```go
select {
case v := <-ch1:
    fmt.Println("got from ch1:", v)
case v := <-ch2:
    fmt.Println("got from ch2:", v)
case ch3 <- 42:
    fmt.Println("sent 42 to ch3")
}
```

The runtime evaluates each case to find which channel operations can proceed right now without blocking. If exactly one is ready, that case runs. If several are ready, one is chosen **at random**. If none are ready, the goroutine blocks until at least one becomes ready.

### `default` makes it non-blocking

Add a `default` and the goroutine never blocks: if no other case is ready at the moment of evaluation, `default` runs.

```go
select {
case v := <-ch:
    fmt.Println("got:", v)
default:
    fmt.Println("nothing waiting")
}
```

This is sometimes called "polling" the channel. Use it when you want to peek without committing to a wait.

### Timeouts are just another case

`time.After(d)` returns a channel that produces a value after `d`. Drop it into a `select` and you have a timeout.

```go
select {
case v := <-ch:
    fmt.Println("got:", v)
case <-time.After(2 * time.Second):
    fmt.Println("timed out")
}
```

If `ch` provides a value within two seconds, the first case wins; otherwise the timer fires and the second case wins. There is no special "timeout" syntax — it is the same select machinery applied to a timer channel.

### Cancellation is also just another case

A "done" channel is a channel you `close()` to mean "stop." Closing a channel makes every receive on it return immediately with the zero value. Putting `<-done` in a `select` lets the goroutine bail out the moment cancellation is requested.

```go
select {
case v := <-ch:
    handle(v)
case <-done:
    return
}
```

Combine timeout and cancellation by adding both cases. This is the core of every well-behaved goroutine in Go.

### The for-select loop

Most real services do not run a single `select`; they run one in a loop. The shape:

```go
for {
    select {
    case v := <-input:
        process(v)
    case <-tick:
        flush()
    case <-done:
        return
    }
}
```

This is the bread and butter of long-running services: process events as they arrive, run periodic work on a tick, exit cleanly on cancellation.

---

## Real-World Analogies

| Scenario | Without `select` | With `select` |
|----------|------------------|----------------|
| Receptionist at a clinic | Watches one door, ignores the phone | Watches the door, the phone, and the buzzer at the same time; greets whichever rings first |
| Bartender | Serves customers strictly in arrival order | Glances at the bar, the door, and the kitchen window; reacts to the first thing that becomes urgent |
| Air-traffic controller | Listens to one runway only | Listens to several runways and the tower; routes attention to the one that needs it |
| Security guard | Watches a single monitor | Sweeps a wall of monitors; reacts to whichever blinks |

`select` turns a goroutine from a single-tasking stenographer into a multi-tasking dispatcher.

---

## Mental Models

### "I am waiting at a crossroads"

Picture your goroutine standing at a crossroads. Each road leads to a channel. The goroutine stands still until traffic comes down one of the roads. As soon as a vehicle (a value, a timer tick, a close signal) appears on any road, the goroutine takes that road and walks down it. It cannot take more than one. It will not wait for the "best" — it takes whichever arrives first.

### "Cases are simultaneous, body is exclusive"

The selection of cases is parallel: every channel is checked at once. The execution of the chosen case is serial: only the body of one case runs. After that body returns, the `select` statement is finished — control falls through to the next statement (or back to the top of the surrounding `for` loop).

### "Random choice, not first-listed wins"

If two cases are ready at the same instant, do not assume the one written first wins. The runtime picks **uniformly at random**. This is intentional: it prevents starvation when one channel is always faster than another. Beginners are sometimes surprised by this and write code that depends on order; do not.

### "`default` = `else`"

Treat `default` as the `else` of `select`. It runs when nothing else is ready. With it, the `select` is non-blocking. Without it, the `select` blocks.

---

## Pros & Cons

### Pros
- **Multiplexing.** Lets one goroutine react to many channels.
- **Composability.** Timeouts, cancellation, polling, and prioritisation are all combinations of the same primitive.
- **No locks needed.** All synchronisation is through the channels themselves.
- **First-class language feature.** The compiler knows about it; no library or framework involved.
- **Statistically fair.** Random choice prevents one always-ready channel from monopolising attention.

### Cons
- **No priority by syntax.** You cannot write "prefer this case" without nesting selects or other tricks.
- **Order-independence is surprising.** Code that worked in one run can fail in another if you accidentally relied on order.
- **Easy to leak.** A goroutine sitting on a `select` with no done case lives forever if its channels never close.
- **`time.After` allocates.** Used inside a tight loop it leaks timer objects until they fire.
- **Cannot express "wait for all."** `select` is "first one wins." For "all of them," you need `sync.WaitGroup` or a counter.

---

## Use Cases

| Use case | Pattern |
|----------|---------|
| Timeout on a network call | `select { case r := <-resp: ...; case <-time.After(2*time.Second): ... }` |
| Graceful shutdown of a worker | `select { case j := <-jobs: ...; case <-ctx.Done(): return }` |
| Combining results from N goroutines | Loop a `select` over their result channels (fan-in) |
| Non-blocking enqueue | `select { case ch <- v: ...; default: drop() }` |
| Heartbeat / periodic flush | `select { case j := <-jobs: ...; case <-tick: flush() }` |
| Block forever (`main` of a daemon) | `select{}` |
| Disable a case dynamically | Set the channel variable to `nil` |

---

## Code Examples

### 1. The minimal select

```go
package main

import "fmt"

func main() {
    ch1 := make(chan string, 1)
    ch2 := make(chan string, 1)
    ch1 <- "from one"

    select {
    case msg := <-ch1:
        fmt.Println(msg)
    case msg := <-ch2:
        fmt.Println(msg)
    }
}
```

`ch1` is ready (it has a buffered value waiting), `ch2` is empty. The first case wins.

### 2. Default — non-blocking receive

```go
package main

import "fmt"

func tryRead(ch chan int) {
    select {
    case v := <-ch:
        fmt.Println("got:", v)
    default:
        fmt.Println("no value yet")
    }
}

func main() {
    ch := make(chan int, 1)
    tryRead(ch)
    ch <- 7
    tryRead(ch)
}
```

Output:
```
no value yet
got: 7
```

### 3. Timeout

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan string)

    go func() {
        time.Sleep(3 * time.Second)
        ch <- "late"
    }()

    select {
    case msg := <-ch:
        fmt.Println(msg)
    case <-time.After(2 * time.Second):
        fmt.Println("timed out")
    }
}
```

The producer takes three seconds; the timeout fires at two. Output: `timed out`.

### 4. Cancellation with a done channel

```go
package main

import (
    "fmt"
    "time"
)

func worker(jobs <-chan int, done <-chan struct{}) {
    for {
        select {
        case j, ok := <-jobs:
            if !ok {
                fmt.Println("jobs closed, exiting")
                return
            }
            fmt.Println("processing", j)
        case <-done:
            fmt.Println("cancelled, exiting")
            return
        }
    }
}

func main() {
    jobs := make(chan int)
    done := make(chan struct{})

    go worker(jobs, done)

    jobs <- 1
    jobs <- 2
    time.Sleep(10 * time.Millisecond)
    close(done)
    time.Sleep(10 * time.Millisecond)
}
```

The worker processes jobs until either the jobs channel closes or the done channel closes — whichever comes first.

### 5. The for-select heartbeat

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    tick := time.Tick(500 * time.Millisecond)
    done := time.After(2 * time.Second)

    for {
        select {
        case t := <-tick:
            fmt.Println("tick at", t.Format("15:04:05.000"))
        case <-done:
            fmt.Println("done")
            return
        }
    }
}
```

Prints a tick every half second for two seconds, then exits.

### 6. Non-blocking send

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 1)
    ch <- 1 // fills the buffer

    select {
    case ch <- 2:
        fmt.Println("sent 2")
    default:
        fmt.Println("buffer full, dropped")
    }
}
```

The buffer is full, so the send case cannot proceed; `default` fires.

### 7. Random selection among ready cases

```go
package main

import "fmt"

func main() {
    a := make(chan string, 1)
    b := make(chan string, 1)
    a <- "A"
    b <- "B"

    counts := map[string]int{}
    for i := 0; i < 1000; i++ {
        a <- "A"
        b <- "B"
        select {
        case v := <-a:
            counts[v]++
            <-b
        case v := <-b:
            counts[v]++
            <-a
        }
    }
    fmt.Println(counts)
}
```

Counts will land near `{A:500, B:500}`. Order of cases in source code does not bias selection.

### 8. Block forever

```go
package main

import "fmt"

func main() {
    fmt.Println("daemon started")
    select {} // park forever
}
```

The empty `select{}` is the canonical "this goroutine is alive forever" expression. Useful in a `main` whose work is done by other goroutines.

### 9. Combining timeout and cancellation

```go
select {
case v := <-data:
    handle(v)
case <-time.After(timeout):
    return errTimeout
case <-ctx.Done():
    return ctx.Err()
}
```

Three exits — value, timeout, cancellation — and you decide what each one does.

### 10. Fan-in two producers

```go
package main

import (
    "fmt"
    "time"
)

func produce(name string, ch chan<- string) {
    for i := 0; ; i++ {
        ch <- fmt.Sprintf("%s-%d", name, i)
        time.Sleep(time.Duration(100+i*10) * time.Millisecond)
    }
}

func main() {
    a := make(chan string)
    b := make(chan string)
    go produce("A", a)
    go produce("B", b)

    timeout := time.After(1 * time.Second)
    for {
        select {
        case msg := <-a:
            fmt.Println(msg)
        case msg := <-b:
            fmt.Println(msg)
        case <-timeout:
            return
        }
    }
}
```

One consumer pulls from two producers without favouring either.

---

## Coding Patterns

### Pattern: timeout-or-result

```go
func fetch(ctx context.Context, url string) (string, error) {
    resCh := make(chan string, 1)
    errCh := make(chan error, 1)
    go func() {
        body, err := httpGet(url)
        if err != nil {
            errCh <- err
            return
        }
        resCh <- body
    }()
    select {
    case body := <-resCh:
        return body, nil
    case err := <-errCh:
        return "", err
    case <-ctx.Done():
        return "", ctx.Err()
    }
}
```

### Pattern: drop-on-full

```go
func tryEnqueue(ch chan<- Event, e Event) bool {
    select {
    case ch <- e:
        return true
    default:
        return false // queue full, dropped
    }
}
```

### Pattern: drain on shutdown

```go
func shutdown(jobs chan Job, done <-chan struct{}) {
    for {
        select {
        case <-done:
            return
        case j := <-jobs:
            process(j)
        }
    }
}
```

### Pattern: heartbeat ticker

```go
ticker := time.NewTicker(5 * time.Second)
defer ticker.Stop()
for {
    select {
    case <-ticker.C:
        sendHeartbeat()
    case <-ctx.Done():
        return
    }
}
```

Use `time.NewTicker` (with `Stop`) inside loops, not `time.Tick` (which leaks if the goroutine exits while the ticker is still alive).

---

## Clean Code

### Name the channels for what they carry

`jobs`, `results`, `errCh`, `done`, `tick` — not `ch1`, `ch2`. A reader of your `select` learns the intent in two seconds.

### One responsibility per for-select

A loop that processes work, ticks a heartbeat, and listens for cancellation is fine. A loop that also responds to four other event channels is a sign the function is doing too much. Split it.

### Always pair `done` (or `ctx.Done()`) with any blocking channel op

Every `case` that could block forever should sit next to a `case <-done:` or `case <-ctx.Done():`. This is how you prove the goroutine cannot leak.

### Move the `select` to the goroutine that owns the channels

Do not pass channels through five layers; the `select` lives where the work happens, and channels are passed in as parameters with appropriate `<-chan` / `chan<-` direction.

---

## Product Use / Feature

A real product that uses `select` everywhere is a payment-gateway sidecar:

- It owns one goroutine per upstream provider connection. Each goroutine has a for-select with cases for new jobs, heartbeat, retries, and shutdown.
- It owns a dispatcher goroutine that fan-in collects results from every provider goroutine into a single result channel.
- It exits cleanly on `SIGTERM` because every for-select includes `case <-ctx.Done(): return`.

The same skeleton — `for { select { jobs / tick / done } }` — appears in HTTP servers, databases, message queue clients, build systems, log shippers, schedulers, supervisors, and load balancers.

---

## Error Handling

`select` does not handle errors — your cases do. Two patterns:

1. **Separate error channel.** `errCh chan error`. The producer goroutine puts errors there; the `select` consumer reads from both `resCh` and `errCh`.
2. **Result type.** Make the value a struct: `type result struct { v Foo; err error }`. One channel, one case, the consumer inspects `r.err`.

Choose (2) when error and value travel together. Choose (1) when an error short-circuits while values continue.

```go
type result struct {
    body string
    err  error
}

resCh := make(chan result, 1)
go func() {
    body, err := httpGet(url)
    resCh <- result{body, err}
}()

select {
case r := <-resCh:
    if r.err != nil {
        return r.err
    }
    use(r.body)
case <-ctx.Done():
    return ctx.Err()
}
```

---

## Security Considerations

- **Unbounded queues are a DoS vector.** A `select` that always accepts new jobs without backpressure (no `default`, no bounded buffer) lets an attacker fill memory.
- **Timeouts are mandatory on any network-facing receive.** Without one, a slow attacker can keep your goroutine parked forever.
- **Do not log channel values without sanitisation.** A `select` case that receives a user-controlled string and logs it raw is a log-injection bug.
- **Beware the `default` busy loop.** A loop that polls with `default` and then `Sleep`s reveals timing side channels and burns CPU. Use timers, not `default + sleep`.

---

## Performance Tips

- **Prefer `time.NewTimer` over `time.After` in loops.** `time.After` leaks a `*Timer` until the duration elapses; in a tight loop this accumulates.
- **Reuse tickers; do not recreate per iteration.** Hoist `time.NewTicker` outside the for-select.
- **Set the unused channel to `nil`.** Receives on a nil channel block forever, so a nil case is "disabled" in select selection — saves the runtime from polling a dead channel.
- **Buffer slightly to absorb bursts.** A `chan T` with capacity 16 lets producers continue while the consumer ticks.
- **Keep case bodies short.** Long work in a case body delays processing of the other channels. Hand it to a worker goroutine.

---

## Best Practices

1. Always pair every blocking case with a cancellation case.
2. Treat `select` order as undefined — never rely on which case wins when several are ready.
3. Use `time.NewTimer`/`time.NewTicker` (with `Stop`) inside loops, not `time.After`/`time.Tick`.
4. Use `chan struct{}` for done signals — zero-byte values, signal carries in close.
5. Close channels from the sender side, never from receivers.
6. Keep selects flat. Nested selects mean you are reaching for priority — there are better ways (see senior.md).
7. Pass channels with direction (`<-chan`, `chan<-`) to make intent and misuse compile-time errors.
8. Small `select` first; build the for-select around it; build the goroutine around that.
9. Document each case with a one-line comment in non-trivial selects.
10. If your select has more than five cases, refactor.

---

## Edge Cases & Pitfalls

### A `select` with no cases blocks forever

```go
select {}
```

Useful in `main`. Anywhere else, almost always a bug.

### A `select` with only a `default` is just the body of `default`

```go
select {
default:
    work()
}
// equivalent to:
work()
```

### Receive from a closed channel always succeeds

A closed channel returns the zero value immediately. Inside a `select`, the case for a closed channel is **always ready**, which can spin a for-select loop into a CPU burn. Detect closure with `v, ok := <-ch` and break out.

### Send to a closed channel panics

There is no "default" or recovery. A send case on a channel that becomes closed will panic the goroutine running the `select`. Coordinate so this cannot happen — usually by having only one writer and closing only when no more sends will occur.

### `nil` channel cases are inert

`var ch chan int = nil; select { case <-ch: ... }` will never fire that case. This is a feature: setting a channel to `nil` disables its case dynamically without restructuring the `select`.

### `default` plus all-blocked = `default` runs

If every other case would block, `default` runs immediately — no waiting at all. That is what makes `default` "non-blocking."

---

## Common Mistakes

| Mistake | What goes wrong | Fix |
|---------|-----------------|-----|
| `case <-time.After(d):` inside a tight for-select | Allocates a new timer each loop iteration, leaking memory until each fires | Use `time.NewTimer`, `Reset`, `Stop` |
| Forgetting `case <-ctx.Done():` | Goroutine leaks when caller cancels | Add the case to every for-select |
| Reading from a `nil` channel hoping it would error | It blocks forever instead | Initialise the channel before use |
| Sending to a `nil` channel | Same — blocks forever | Initialise before use |
| Closing a channel from the receiver | Panics if the sender does another send | Close from the sender |
| Relying on case order | Random selection violates the assumption non-deterministically | Use priority-select pattern explicitly |
| Looping `select` with only a `default` | Burns 100% CPU | Replace with a `time.Ticker` or remove the polling |
| Nesting selects deeply for "priority" | Hard to read, easy to misuse | Use the two-level priority pattern from middle.md |

---

## Common Misconceptions

> **"`select` waits for all cases like `Promise.all`."**
> No. It waits for the **first** ready case. Use `sync.WaitGroup` if you want "all."

> **"Cases run top-to-bottom like `switch`."**
> No. Cases are evaluated together; one ready case is chosen at random.

> **"`default` runs after every case."**
> No. `default` runs only when no other case is ready at the moment of evaluation.

> **"A `select` on a closed channel returns nothing."**
> No. A receive on a closed channel returns the zero value immediately, and the case is considered ready.

> **"`select{}` is a typo."**
> No. It is the explicit, idiomatic way to block forever.

> **"`time.After` is free."**
> No. It allocates a `*Timer` each call and the timer is not collected until it fires.

---

## Tricky Points

- A closed channel makes its receive case **always ready** — a for-select can spin if you do not check `ok` and break out.
- Random selection is per `select` execution, not per process, so two consecutive runs of the same `select` may pick differently.
- `default` competes with the other cases, not with itself: a select with `default` is non-blocking even if many other cases are also ready (in which case one of them runs, not `default`).
- A channel variable being `nil` versus a channel pointing to a closed channel are opposite things in `select`: nil is "this case never fires," closed-receive is "this case always fires."
- Sending and receiving on the same channel from inside one `select` is legal but easy to mis-design — usually a sign you should split into two channels.

---

## Test

```go
package main

import (
    "fmt"
    "testing"
    "time"
)

func TestTimeoutFires(t *testing.T) {
    ch := make(chan int)
    timeout := 50 * time.Millisecond
    start := time.Now()

    select {
    case <-ch:
        t.Fatal("ch should not have fired")
    case <-time.After(timeout):
        elapsed := time.Since(start)
        if elapsed < timeout {
            t.Fatalf("fired early: %v", elapsed)
        }
    }
}

func TestNonBlockingSend(t *testing.T) {
    ch := make(chan int, 1)
    ch <- 1
    select {
    case ch <- 2:
        t.Fatal("should not have accepted")
    default:
        // expected
    }
}

func TestRandomFairness(t *testing.T) {
    a := make(chan int, 1000)
    b := make(chan int, 1000)
    for i := 0; i < 1000; i++ {
        a <- 1
        b <- 1
    }
    counts := map[string]int{"a": 0, "b": 0}
    for i := 0; i < 1000; i++ {
        select {
        case <-a:
            counts["a"]++
        case <-b:
            counts["b"]++
        }
    }
    fmt.Println(counts)
    // Expect each to be near 500, not 1000–0
    if counts["a"] == 0 || counts["b"] == 0 {
        t.Fatal("one channel was starved")
    }
}
```

Run with `go test -v`.

---

## Tricky Questions

1. What does `select{}` do, and where is it idiomatic?
2. If three cases are ready at once, which one runs?
3. Why is `time.After` discouraged inside a tight for-select?
4. What happens if you `select` on a `nil` channel?
5. What happens if you `select` send on a closed channel?
6. What is the difference between `default` and `case <-time.After(0)`?
7. Why would you split error and value into two channels instead of one struct?
8. Can a `select` deadlock even with `default`?
9. How do you "disable" a case at runtime without rewriting the `select`?
10. What goroutine pattern does almost every long-running Go service use?

(Answers in interview.md.)

---

## Cheat Sheet

```go
// 1. Multi-channel receive
select {
case v := <-a:
case v := <-b:
}

// 2. Timeout
select {
case v := <-a:
case <-time.After(d):
}

// 3. Cancellation
select {
case v := <-a:
case <-ctx.Done():
}

// 4. Non-blocking
select {
case v := <-a:
default:
}

// 5. For-select loop
for {
    select {
    case v := <-jobs:
    case <-tick:
    case <-done:
        return
    }
}

// 6. Block forever
select {}

// 7. Disable a case
ch = nil // its case never fires now
```

---

## Self-Assessment Checklist

- [ ] I can explain why `select` exists and what `switch` cannot do that it can.
- [ ] I can write a non-blocking receive using `default`.
- [ ] I can add a timeout with `time.After`.
- [ ] I can wire cancellation through a done channel or `ctx.Done()`.
- [ ] I can describe what happens when several cases are ready.
- [ ] I can explain `select{}`.
- [ ] I know why `time.After` in a loop is a bad idea.
- [ ] I know that a `nil` channel disables its case.
- [ ] I know that a send on a closed channel panics — even inside a `select`.
- [ ] I have written a working for-select loop with at least three cases.

---

## Summary

`select` is Go's way of multiplexing channel operations. It is a `switch`-shaped block whose cases are channel ops; it blocks until at least one is ready and then runs that one. With `default` it is non-blocking. With `time.After` it has a timeout. With a done channel it has cancellation. The for-select loop wraps it into the standard shape of every long-running goroutine in Go.

The rules that surprise beginners are: ready cases are chosen at random (not by source order); a closed channel's receive case is always ready; a `nil` channel's case never fires; sending to a closed channel panics; an empty `select{}` blocks forever. Master those and you have mastered the most-used construct in Go concurrency.

---

## What You Can Build

With just `select` plus goroutines and channels you can build:

- A network client with per-request timeouts and a global cancel signal
- A worker pool that drains gracefully on shutdown
- A periodic flusher that batches incoming events
- A fan-in aggregator that combines many producers into one consumer
- A rate-limited dispatcher that drops on overload
- A heartbeat-driven supervisor that restarts dead workers
- A backpressure-aware queue
- The skeleton of a goroutine-based actor model

Every higher-level Go concurrency primitive (`errgroup`, pipeline stages, supervised pools) is built on `select`.

---

## Further Reading

- The Go Programming Language Specification — *Select statements*
- Effective Go — *Concurrency*
- *Go Concurrency Patterns* (Pike, 2012, Google IO talk and slides)
- *Advanced Go Concurrency Patterns* (Cox, 2013)
- Dave Cheney — *Curious Channels*
- The `runtime/select.go` file in the Go source (for when you are ready)

---

## Related Topics

- [Buffered vs Unbuffered](../01-buffered-vs-unbuffered/junior.md) — channel blocking semantics
- [Worker Pools](../03-worker-pools/junior.md) — applied for-select at scale
- The `context` package — the modern source of `Done()` channels
- `sync.WaitGroup` — for the "wait for all" pattern that `select` cannot express
- `time.Timer` and `time.Ticker` — the engines behind timeout and heartbeat cases

---

## Diagrams & Visual Aids

### One goroutine, three channels

```
                 jobs ───►┐
                          │
                  tick ───┼──►  ┌──────────┐
                          │     │  select  │  ──► run one case body
                  done ───┘     └──────────┘
                                     │
                                     └─► loop back / return
```

### Decision tree of a `select`

```
         ┌──────────────────────┐
         │ Evaluate every case   │
         └──────────────────────┘
                    │
        any case ready?
        ┌────────┴────────┐
       yes                no
        │                 │
   pick random         default present?
   among ready         ┌──────┴──────┐
        │             yes            no
   run that case   run default     block until
        │                          a case becomes ready
        └────────────►─────────────┘
                       │
                  exit select
```

### State of a channel and what its case does

| Channel state | Receive case | Send case |
|---------------|--------------|-----------|
| `nil` | Never ready | Never ready |
| Open, empty | Not ready (blocks) | Ready if buffer free / receiver waiting |
| Open, has values | Ready (returns value) | Ready if buffer free / receiver waiting |
| Closed | **Always ready** (zero value, ok=false) | **Panics** if executed |

### For-select skeleton

```
┌── for ────────────────────────────────────┐
│   select {                                │
│     case j := <-jobs:  process(j)         │
│     case <-tick:       flush()            │
│     case <-ctx.Done(): return             │
│   }                                       │
└───────────────────────────────────────────┘
                    │
                    └─►  loop until ctx.Done() wins
```

You now know enough to read, write, and reason about most `select` code in the wild. Move on to middle.md to learn the patterns experienced Gophers use every day, and senior.md for what is actually happening inside the runtime.
