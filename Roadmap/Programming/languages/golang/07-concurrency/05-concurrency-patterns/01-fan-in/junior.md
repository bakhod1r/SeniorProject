# Fan-In — Junior Level

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
> Focus: "I have several channels producing values. How do I join them into one?"

You have written your first goroutines. You have used a channel to pass a value from one goroutine to another. You have probably written a function that returns a `<-chan int` and a loop that drains it. Now imagine you have **two** producers — say, two HTTP scrapers each emitting status codes — and one consumer that wants to print every status code regardless of which scraper produced it.

If you only know `for v := range ch1`, you cannot read both. The loop blocks on `ch1` and ignores `ch2`. You need a way to *merge* the two channels into one.

That merging pattern is called **fan-in**. The name comes from electronics: a logic gate with many inputs and one output. In Go, fan-in means a function that takes N input channels of the same element type and returns a single output channel that yields every value from every input — in arrival order, until every input is closed.

After reading this file you will:
- Understand what fan-in means and when it is needed
- Be able to write a `merge` function for two channels
- Be able to extend it to N channels using a variadic signature
- Know why fan-in needs a `sync.WaitGroup`
- Know who closes the output channel and when
- Recognise the signs of a leaked or stuck fan-in goroutine

You do **not** need generics, `reflect.Select`, or `context.Context` for this file. Those land in the middle and senior levels. Here we work with classic Go: channels, goroutines, and a `WaitGroup`.

---

## Prerequisites

- **Required:** Comfort with goroutines (`go f()`) and basic channel operations (`<-ch`, `ch <- v`, `close(ch)`).
- **Required:** Knowing what `for v := range ch` does and why it stops when the channel is closed.
- **Required:** Understanding of `sync.WaitGroup` (`Add`, `Done`, `Wait`).
- **Helpful:** Having read the channels chapter — especially the "who closes the channel" rule.
- **Helpful:** Having written at least one goroutine bug yourself, so you appreciate why ordering and closing matter.

If you can write a function that spawns one goroutine, sends three values down a channel, closes the channel, and reads them in `main`, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Fan-in** | A pattern that merges N input channels of the same element type into a single output channel. The output yields every value from every input. |
| **Merge** | The conventional name of the function that performs fan-in. Signature: `merge(cs ...<-chan T) <-chan T`. |
| **Producer** | A goroutine that writes to a channel. In fan-in there are N producers. |
| **Consumer** | A goroutine that reads from the merged output channel. There is usually exactly one. |
| **WaitGroup** | A `sync.WaitGroup` is a counter you `Add` to before each goroutine and `Done` from inside each one. `Wait` blocks until the counter reaches zero. Fan-in uses it to know when *all* producers have finished. |
| **Output channel** | The single channel returned by `merge`. The fan-in goroutine closes it when every producer is finished. |
| **Closer goroutine** | A small goroutine inside `merge` that calls `wg.Wait()` then `close(out)`. It is the only place the output channel is closed. |
| **Variadic signature** | A function signature like `merge(cs ...<-chan T)` that accepts any number of input channels. |
| **Drain** | To read from a channel until it is closed and the range loop exits. The consumer of fan-in must drain the output. |
| **Leaked goroutine** | A goroutine that is stuck blocked on a channel forever because the consumer stopped reading. Fan-in can produce these if you are not careful. |

---

## Core Concepts

### One channel cannot listen to two senders by itself

The first concept to internalise is that a channel has exactly one "queue" of values. If two goroutines send to the same channel, that is fine — both their values go into the same queue. But if you have two *different* channels, neither knows about the other. A `for v := range ch1` loop has no way to also pull from `ch2`. You either need:

1. A `select` statement that watches both channels in one goroutine, or
2. A *forwarder* goroutine per input channel, each pushing into one shared output channel.

The second approach is fan-in. Each producer keeps writing to its own input channel. A small forwarder goroutine reads from one input and copies into the merged output. Run N forwarders, one per input, and the consumer sees a single stream.

### The merge function: two-channel version

Here is the simplest possible fan-in. It merges exactly two `<-chan int` into one.

```go
func merge2(a, b <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        for v := range a {
            out <- v
        }
    }()
    go func() {
        for v := range b {
            out <- v
        }
    }()
    return out
}
```

This compiles. It even works if you are willing to leak the output channel forever. But it is wrong in one critical way: **nobody closes `out`**. A consumer using `for v := range merge2(a, b)` will block forever after the last value, because `range` only stops when the channel is closed.

### Adding a WaitGroup to close correctly

To close `out` we must know when *both* forwarder goroutines have finished. A `sync.WaitGroup` is exactly the right tool.

```go
func merge2(a, b <-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(2)

    go func() {
        defer wg.Done()
        for v := range a {
            out <- v
        }
    }()
    go func() {
        defer wg.Done()
        for v := range b {
            out <- v
        }
    }()

    go func() {
        wg.Wait()
        close(out)
    }()

    return out
}
```

Now the rule is:
- One forwarder goroutine **per input channel**, each calling `wg.Done` when its input is drained.
- One **closer goroutine** that waits for all forwarders, then closes the output.
- The consumer ranges over the output and exits when it is closed.

### Generalising to N channels

The variadic version is almost the same, with a `for` loop over the inputs.

```go
func merge(cs ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(cs))

    output := func(c <-chan int) {
        defer wg.Done()
        for v := range c {
            out <- v
        }
    }

    for _, c := range cs {
        go output(c)
    }

    go func() {
        wg.Wait()
        close(out)
    }()

    return out
}
```

This is the canonical fan-in function in Go. Almost every codebase has a copy of it somewhere.

### What fan-in does NOT promise

Fan-in is a *merge*, not a *zip* or a *sort*. It does not promise:
- That values appear in the order they were produced across inputs (the scheduler decides who runs first).
- That the consumer receives values in the same order across runs (it can change every run).
- That the merged values are interleaved fairly (one fast producer can dominate).

Fan-in promises only this: every value sent on every input will eventually appear on the output, and the output will be closed when all inputs are closed.

---

## Real-World Analogies

### A funnel
A funnel has a wide top and a narrow bottom. Liquid poured in from anywhere on the rim flows out through the single spout. Fan-in is a funnel for channel values: many inputs converge on one output.

### A switchboard operator
In old telephone exchanges, several lines came in and one operator routed every call to the same outgoing trunk. Each forwarder goroutine in fan-in is one line; the trunk is the merged output channel.

### A river delta in reverse
A delta has one river and many mouths. Reverse it: many tributaries, one main stream. Fan-in is a tributary collector.

### A buffet line that ends in a single conveyor belt
Several chefs prepare dishes at separate stations. Each plate goes onto a shared conveyor belt that carries them to the customers. The chefs are producers; the conveyor is the merged channel; the customer is the consumer.

### A multi-microphone podcast feed
Each guest has their own microphone (input channel). A mixing console combines them into one audio track (output channel) that listeners hear.

---

## Mental Models

### Model 1: "One forwarder per input"
Every input channel needs its own goroutine. That goroutine has one job: take values out of the input and put them onto the output. When the input closes, the forwarder's `range` loop exits, and the forwarder calls `wg.Done`.

### Model 2: "The closer goroutine is the orchestrator"
The closer goroutine does not produce or consume values. It only counts. It waits for every forwarder to signal "I am done", and only then closes the output. Without it, the output would never be closed.

### Model 3: "The output channel is the contract"
The consumer interacts with exactly one thing: the output channel. It does not need to know how many inputs there are, who produces them, or when they finish. Its loop is `for v := range out { ... }` and that is the entire interface.

### Model 4: "Fan-in is glue, not transformation"
A merge function does not modify values, filter them, or reorder them. It only forwards. If you find yourself adding logic like `if v > 0` inside the forwarder, you are mixing fan-in with another stage; split them.

### Model 5: "Order is sacrificed for parallelism"
Two producers running on two CPUs cannot guarantee any order on the merged stream — the scheduler decides who reaches `out <- v` first. If you need order, fan-in is the wrong pattern; use a single channel or sort downstream.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Simple, well-understood pattern. | Loses cross-channel order. |
| Decouples producers from consumer. | Requires careful close discipline (one closer). |
| Scales to any number of inputs. | One slow consumer blocks every producer. |
| Plays well with `range` on the consumer side. | Spawning N goroutines per merge adds up at scale. |
| Composes with fan-out and pipeline. | Cancellation needs an extra mechanism (ctx). |
| Easy to test (give it 0, 1, N inputs). | Output channel buffer must be tuned per workload. |
| Output channel becomes a uniform interface. | Without WaitGroup, leaks are easy. |

---

## Use Cases

- **Log aggregation** — multiple subsystems each emit log records on their own channel; fan-in merges them into one writer that batches into a file or service.
- **Sensor data merge** — several sensors (temperature, humidity, pressure) push readings on per-sensor channels; one consumer stamps and stores them.
- **Multi-source feeds** — a chat client subscribes to several rooms; each room's incoming messages arrive on its own channel; the UI renders them from one merged channel.
- **Metric collection** — each worker pushes metrics on its own channel; a single exporter writes them to Prometheus.
- **Search aggregator** — query is sent to N backends in parallel; each backend writes results to its own channel; the UI consumes a merged result stream.
- **Multi-region health checks** — workers in different regions send heartbeats; a single watcher consumes the union.

---

## Code Examples

### Example 1: minimum two-channel merge

```go
package main

import (
    "fmt"
    "sync"
)

func merge2(a, b <-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(2)

    go func() {
        defer wg.Done()
        for v := range a {
            out <- v
        }
    }()
    go func() {
        defer wg.Done()
        for v := range b {
            out <- v
        }
    }()

    go func() {
        wg.Wait()
        close(out)
    }()

    return out
}

func main() {
    a := make(chan int)
    b := make(chan int)

    go func() {
        defer close(a)
        for i := 0; i < 3; i++ {
            a <- i
        }
    }()
    go func() {
        defer close(b)
        for i := 100; i < 103; i++ {
            b <- i
        }
    }()

    for v := range merge2(a, b) {
        fmt.Println(v)
    }
}
```

The output is six numbers, but their order is not deterministic.

### Example 2: variadic merge for N channels

```go
func merge[T any](cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))

    output := func(c <-chan T) {
        defer wg.Done()
        for v := range c {
            out <- v
        }
    }

    for _, c := range cs {
        go output(c)
    }

    go func() {
        wg.Wait()
        close(out)
    }()

    return out
}
```

Note: the generic version requires Go 1.18+. The non-generic version replaces `T` with the concrete element type — typically `int`, `string`, or a small struct.

### Example 3: producing test data

```go
func gen(name string, values ...int) <-chan string {
    out := make(chan string)
    go func() {
        defer close(out)
        for _, v := range values {
            out <- fmt.Sprintf("%s=%d", name, v)
        }
    }()
    return out
}

func main() {
    a := gen("A", 1, 2, 3)
    b := gen("B", 10, 20)
    c := gen("C", 100)

    for v := range merge(a, b, c) {
        fmt.Println(v)
    }
}
```

### Example 4: counting messages received

```go
func main() {
    ch := merge(gen("A", 1, 2, 3), gen("B", 10, 20))
    count := 0
    for range ch {
        count++
    }
    fmt.Println("total:", count) // 5
}
```

### Example 5: empty input list

```go
func main() {
    ch := merge[int]() // no inputs
    for range ch {
        // never runs; ch closes immediately
    }
    fmt.Println("ok") // prints, then exits
}
```

A merge of zero channels closes its output immediately because the WaitGroup counter starts at zero.

---

## Coding Patterns

### Pattern: variadic signature
Always accept `...<-chan T`. Fixed-arity merges (`merge2`, `merge3`) duplicate logic and feel un-Go-like.

### Pattern: forwarder goroutine per input
Never share one goroutine between two inputs. The cleanup logic relies on the goroutine ending exactly when its single input closes.

### Pattern: separate closer goroutine
Do not call `close(out)` from inside a forwarder. Only the closer goroutine closes the output, after `wg.Wait`.

### Pattern: receive-only return type
Return `<-chan T`, not `chan T`. The caller must not be able to send into or close the merged channel.

### Pattern: pass channels in by `<-chan T`
Accept inputs as receive-only. Fan-in never sends back to its inputs.

### Pattern: name the closure or extract `output`
Pulling the forwarder closure into a named local function (`output := func(c <-chan T) { ... }`) keeps the loop body short and makes stack traces clearer.

---

## Clean Code

- Keep the merge function tiny — a dozen lines is enough.
- Keep its file dedicated; do not mix domain logic into a `merge.go` utility.
- Name input parameters `cs` (channels) and the helper `output`.
- Buffer the output channel only if you have measured a benefit; default to unbuffered.
- Document the order guarantee (or lack of it) in a comment.
- Avoid generic merges that take `interface{}` — use Go 1.18+ generics or a typed copy.

---

## Product Use / Feature

In a real product, fan-in usually appears at the edge between *many specialised producers* and *one storage or output sink*. A few real scenarios:

- A **log shipper** has one goroutine per log source (stdout, syslog, file tailer). Each emits parsed records on its own channel. A merge produces one stream that an HTTP forwarder ships to a remote collector.
- A **chat client** opens one WebSocket per room. Each WebSocket is a goroutine writing to its own channel. The UI thread reads the merged channel and renders messages.
- A **batch processor** reads from several Kafka partitions in parallel, each on its own channel. A merge presents the partitions as one stream to the deduper.

In all three cases the producers can be added or removed independently without changing the consumer's interface — that is the value of fan-in.

---

## Error Handling

Fan-in itself does not produce errors; it only forwards values. But it can be combined with errors in two ways:

1. **Error type on the channel.** Make the channel element a struct that contains both the value and an error: `type Result struct { V int; Err error }`. The consumer inspects `Err` per value.
2. **Separate error channel.** Each producer writes errors to a separate `<-chan error` and values to its data channel. Two merges run in parallel — one for values, one for errors.

A junior implementation usually goes with option 1. It is simpler and avoids two parallel merges.

```go
type Result struct {
    V   int
    Err error
}

func gen(name string, values ...int) <-chan Result {
    out := make(chan Result)
    go func() {
        defer close(out)
        for _, v := range values {
            if v < 0 {
                out <- Result{Err: fmt.Errorf("%s: negative value %d", name, v)}
                return
            }
            out <- Result{V: v}
        }
    }()
    return out
}
```

---

## Security Considerations

Fan-in is a glue pattern, so most security concerns belong upstream (where the inputs come from). Two notes apply:

- **Untrusted producers.** If any producer is fed from a remote source, an attacker who can flood that producer can flood the merged channel and starve the consumer. Use a buffered output and bound the producer's input rate.
- **Sensitive values.** Do not log raw merged values blindly. The merged stream may contain credentials, PII, or other secrets if even one input carries them. Log lengths or shapes, not contents.

---

## Performance Tips

- Default to an unbuffered output channel and add a buffer only when profiling shows the consumer is the bottleneck.
- Each forwarder is a separate goroutine — do not call `merge` thousands of times per second; it allocates.
- For very high-throughput merges, prefer a `select`-based merge over forwarders if N is small and known at compile time.
- If your producers send tiny values (single ints, single bytes), batch them before sending — every channel send is a synchronisation point.
- Profile with `go test -bench` and `pprof` if fan-in shows up hot in your CPU profile.

---

## Best Practices

1. Always `wg.Add` exactly once per input channel before launching forwarders.
2. Always `defer wg.Done()` at the top of each forwarder.
3. Always return `<-chan T`, not `chan T`.
4. Always close the output exactly once, in the closer goroutine.
5. Always document whether order is preserved (it is not).
6. Always test with 0 and 1 inputs as well as many.
7. Always pair a fan-in with a way to stop the consumer (ctx in middle level).

---

## Edge Cases & Pitfalls

- **No inputs (`merge()`).** WaitGroup counter is zero, closer fires immediately, output closes. Range exits at once. This is correct.
- **One input.** Equivalent to forwarding that channel. Slightly wasteful but harmless.
- **An input is `nil`.** A `range` over a nil channel blocks forever. The forwarder goroutine never exits, the closer never fires, the consumer hangs. Filter nil inputs before calling `merge`.
- **An input is never closed.** Same problem: forwarder hangs forever. Make sure every producer follows the "close when done" rule.
- **The consumer stops reading.** Forwarders block on `out <- v`. Without cancellation they leak. Junior code should always drain to completion; later levels add ctx.
- **Re-using inputs.** If the same channel is passed twice, two forwarders compete for its values. That is rarely what you want.

---

## Common Mistakes

1. Forgetting the closer goroutine — output never closes, consumer hangs.
2. Calling `close(out)` inside a forwarder — panics when the second forwarder closes a closed channel.
3. Calling `wg.Add(len(cs))` *inside* the loop — counter races with closer's `Wait`.
4. Returning `chan T` instead of `<-chan T` — caller can corrupt the channel.
5. Forgetting to drain the output — goroutine leak.
6. Using a slice of channels but iterating with `for i := range cs` and capturing `i` instead of the channel — easy to fix by writing `for _, c := range cs`.
7. Buffering the output by `len(cs)` "to be safe" — this is not how channel buffers work; tune them with profiling.

---

## Common Misconceptions

- "Fan-in preserves order." It does not. The arrival order on the merged channel is non-deterministic.
- "Fan-in needs a select." No. The classic fan-in uses one goroutine per input; `select` is a separate technique.
- "Fan-in works with channels of different element types." No. All inputs must have the same element type. Heterogeneous merging needs an interface or `interface{}`.
- "The output channel must be buffered." No. Unbuffered works fine; buffering is an optimisation, not a correctness requirement.
- "A merge with N=10000 inputs is fine because goroutines are cheap." It is *cheap* but not free. At very high N you want a different design (e.g. a worker pool reading from a shared input).

---

## Tricky Points

- **Goroutine ordering vs value ordering.** Even if producer A starts before producer B, B's first value may appear before A's first value on the merged channel. This is normal.
- **Closing a nil channel panics.** If you accidentally pass `nil` as one of the input channels, the forwarder's `range` blocks; if you accidentally pass a closed channel, the forwarder exits at once. Both cases need to be handled deliberately.
- **`wg.Add` race.** If you call `wg.Add` inside a goroutine after launching the closer, the closer might `Wait` before the `Add`, see zero, and close prematurely. Always `Add` before `go`.
- **`out <- v` blocks if the consumer is gone.** Without cancellation, the producer's `range` loop drains its input, but `out <- v` blocks forever. The producer never reaches `wg.Done`. The closer never closes. The merge leaks all the way down.

---

## Test

Place this in `merge_test.go`:

```go
package main

import (
    "sort"
    "sync"
    "testing"
)

func merge(cs ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func(c <-chan int) {
            defer wg.Done()
            for v := range c {
                out <- v
            }
        }(c)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}

func gen(values ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, v := range values {
            out <- v
        }
    }()
    return out
}

func TestMergeAllValues(t *testing.T) {
    a := gen(1, 2, 3)
    b := gen(10, 20, 30)
    var got []int
    for v := range merge(a, b) {
        got = append(got, v)
    }
    if len(got) != 6 {
        t.Fatalf("expected 6 values, got %d", len(got))
    }
    sort.Ints(got)
    want := []int{1, 2, 3, 10, 20, 30}
    for i, v := range want {
        if got[i] != v {
            t.Fatalf("at %d: want %d, got %d", i, v, got[i])
        }
    }
}

func TestMergeEmpty(t *testing.T) {
    out := merge()
    if _, ok := <-out; ok {
        t.Fatal("expected closed channel")
    }
}

func TestMergeSingle(t *testing.T) {
    out := merge(gen(42))
    if v := <-out; v != 42 {
        t.Fatalf("want 42, got %d", v)
    }
    if _, ok := <-out; ok {
        t.Fatal("expected closed channel")
    }
}
```

Run with `go test -race`. The race detector should report no issues.

---

## Tricky Questions

1. **What happens if one input is never closed?** The forwarder's `range` blocks forever, the WaitGroup never reaches zero, and the closer never closes the output. The consumer hangs. Always close producer channels.
2. **Why must `wg.Add` happen before `go`?** Because if the goroutine finishes before `Add` runs, `wg.Wait` may return early and the closer fires too soon.
3. **Can I close the output from a forwarder when its input is exhausted?** No. Other forwarders may still be writing. Closing a channel a forwarder is sending on causes a panic.
4. **What is the difference between fan-in with goroutines and fan-in with `select`?** Goroutines version handles dynamic N; `select` version needs N known at compile time but uses fewer goroutines.
5. **Is the merged stream stable across runs?** No. It is non-deterministic; do not write tests that depend on it.
6. **Does fan-in work with channels of different types?** No. Use an interface or convert all values to a common type before merging.
7. **What if two inputs send the same value at the same time?** Both values appear on the output. The consumer sees duplicates if duplicates are valid in your domain.
8. **How many goroutines does a fan-in of N inputs use?** N forwarders + 1 closer = N+1 extra goroutines.

---

## Cheat Sheet

```go
// Canonical fan-in (Go 1.18+ generics).
func merge[T any](cs ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func(c <-chan T) {
            defer wg.Done()
            for v := range c {
                out <- v
            }
        }(c)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

| Step | Code |
|------|------|
| Create output | `out := make(chan T)` |
| Count inputs | `wg.Add(len(cs))` |
| Forwarder per input | `go func(c) { defer wg.Done(); for v := range c { out <- v } }(c)` |
| Closer | `go func() { wg.Wait(); close(out) }()` |
| Return | `return out` (as `<-chan T`) |

---

## Self-Assessment Checklist

- [ ] I can write `merge2` from memory.
- [ ] I can extend it to a variadic `merge`.
- [ ] I know why a `WaitGroup` is required.
- [ ] I know who closes the output channel.
- [ ] I can explain why fan-in does not preserve order.
- [ ] I can list two failure modes (nil input, never-closed input, slow consumer).
- [ ] I can write a unit test for `merge` with 0, 1, and N inputs.
- [ ] I can run my test with `-race` and see no warnings.

---

## Summary

Fan-in is the pattern of merging N input channels into one output. Implement it as one forwarder goroutine per input, plus a closer goroutine that waits for them all and closes the output. The pattern is small, idiomatic, and composes with everything else in Go's concurrency toolbox. It does not preserve order, and it depends on producers honestly closing their channels.

---

## What You Can Build

- A toy log aggregator that merges three goroutines, each printing a different message every second.
- A sensor simulator that produces temperature, humidity, and pressure values on three channels and prints them as one stream.
- A search aggregator that fans queries to two mock backends and prints the merged hits.

---

## Further Reading

- The Go Blog: "Go Concurrency Patterns: Pipelines and cancellation" (the canonical introduction to merge).
- Effective Go: "Channels" section.
- Donovan & Kernighan, *The Go Programming Language*, chapter on concurrency.

---

## Related Topics

- Fan-out (the dual pattern).
- Pipeline (fan-in is often the last stage).
- `select` (an alternative for small, fixed N).
- `context.Context` (used in middle.md for cancellation).

---

## Diagrams & Visual Aids

```
producers           merge()                consumer

   c1 ──▶ ┐
          ├──▶  out  ──▶  for v := range out
   c2 ──▶ ┤
          │
   c3 ──▶ ┘

Each c_i has its own forwarder goroutine.
The closer goroutine watches the WaitGroup
and closes `out` when all forwarders exit.
```

```
Goroutine layout:

  forwarder(c1)  ─┐
  forwarder(c2)  ─┼──▶ out ──▶ consumer
  forwarder(c3)  ─┘
       │  wg.Done after range exits
       ▼
     closer:  wg.Wait → close(out)
```
