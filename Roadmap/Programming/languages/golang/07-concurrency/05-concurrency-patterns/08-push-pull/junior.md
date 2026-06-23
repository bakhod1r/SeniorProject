# Push-Pull — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros--cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use--feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
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
29. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction
> Focus: "One goroutine makes work; another consumes it. They run at different speeds. How do they cooperate without the fast one burying the slow one?"

A producer goroutine generates items. A consumer goroutine processes them. In Go you connect them with a channel: the producer **pushes** with `ch <- item`, and the consumer **pulls** with `item := <-ch`. That much is the first thing every Go tutorial shows you. The interesting part is what happens when their *speeds differ*:

- If the producer is faster, where do the extra items go?
- If the consumer is faster, what does it do while waiting?

The elegant answer Go gives you for free is **backpressure**. A channel has a fixed buffer (possibly zero). When the buffer is full, the next `ch <- item` *blocks* — the producer is forced to wait until the consumer pulls something out. The slow side automatically throttles the fast side. No item is lost, and memory cannot grow without bound (the buffer size caps it). This is the heart of the push-pull pattern.

The opposite, dangerous design is an **unbounded queue**: keep accepting pushes no matter what, storing them in an ever-growing slice. The producer never blocks, but if the consumer can't keep up, the queue grows until you run out of memory. We will see why bounded channels are the safe default.

After this file you should be able to:

- Explain push, pull, and backpressure.
- Connect a producer and consumer with an unbuffered or small-buffered channel.
- Explain why a full channel blocking the producer is a *feature*.
- Close a channel correctly so the consumer's `range` loop ends.
- Recognise the OOM danger of an unbounded queue.

Fan-out to many consumers, context cancellation, and the distributed analogue come at middle and senior.

---

## Prerequisites

- **Required:** Go 1.18+ (1.21+ recommended).
- **Required:** Start a goroutine (`go f()`), send/receive on channels (`ch <- v`, `v := <-ch`).
- **Required:** `for v := range ch { ... }` and what `close(ch)` does to it.
- **Required:** `sync.WaitGroup` to wait for goroutines.
- **Helpful:** Buffered vs unbuffered channels (`make(chan T)` vs `make(chan T, n)`).

If you can write a program where one goroutine sends three numbers and another prints them, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Producer** | The goroutine that creates work items and **pushes** them onto a channel. |
| **Consumer** | The goroutine that **pulls** items off the channel and processes them. |
| **Push** | The send operation, `ch <- item`. Producer-driven: the producer initiates delivery. |
| **Pull** | The receive operation, `item := <-ch`. Consumer-driven: the consumer initiates retrieval. |
| **Backpressure** | The automatic slowing of the producer when the channel is full. Flow control for free. |
| **Buffer / capacity** | The number of items a channel can hold before a send blocks. `make(chan T, n)` → capacity `n`. |
| **Unbuffered channel** | Capacity 0. A send blocks until a receiver is ready (a *rendezvous*). |
| **Bounded queue** | A queue with a fixed maximum size (a buffered channel). Blocks the producer when full. |
| **Unbounded queue** | A queue with no size limit (e.g., an ever-growing slice). Risks OOM under load. |
| **Drain** | To pull and process remaining items after the producer has stopped, before shutting down. |

---

## Core Concepts

### Push and pull are just send and receive

```go
ch := make(chan int)
go func() { ch <- 42 }() // push (producer)
v := <-ch                // pull (consumer)
```

"Push" and "pull" are names for the two ends. The producer pushes; the consumer pulls. The channel is the meeting point. Nothing exotic — but framing it this way makes the *rate* relationship visible.

### Backpressure: a full channel blocks the producer

This is the key idea. Make a channel with a small buffer and a slow consumer:

```go
ch := make(chan int, 2) // capacity 2
go func() {
    for i := 0; ; i++ {
        ch <- i               // blocks once the buffer (2) is full
        fmt.Println("pushed", i)
    }
}()

for v := range ch {
    time.Sleep(time.Second)   // slow consumer
    fmt.Println("pulled", v)
}
```

The producer races ahead, fills the 2-slot buffer, and then *blocks* on `ch <- i` until the consumer pulls one out. The producer can never be more than 2 items ahead. The slow consumer governs the pace. That blocking is backpressure: the system self-regulates, and memory is capped at 2 buffered items.

If you instead stored pushes in an unbounded slice, the producer would run flat-out, the slice would grow forever, and you would eventually crash with out-of-memory. **A bounded channel makes overload a slowdown instead of a crash.**

### Unbuffered = rendezvous (tightest coupling)

```go
ch := make(chan int) // capacity 0
```

An unbuffered channel forces a *handshake*: the send `ch <- v` does not complete until a receiver is executing `<-ch`. Producer and consumer meet in lockstep. This is the strongest backpressure (the producer can be at most "one item in flight"), and it is the right default when you want producer and consumer tightly synchronised.

### Closing the channel ends the consumer's loop

The producer signals "no more items" by closing the channel. The consumer's `range` loop then exits naturally:

```go
go func() {
    defer close(ch) // producer owns close
    for i := 0; i < 5; i++ {
        ch <- i
    }
}()

for v := range ch { // ends when ch is closed AND drained
    fmt.Println(v)
}
```

Rule: **the producer (sender) closes the channel; the consumer never does.** Sending on a closed channel panics, so only the side that sends may close.

---

## Real-World Analogies

- **A conveyor belt with a fixed number of slots.** The worker placing items (producer) must wait when all slots are taken until the worker at the end (consumer) removes one. The belt length is the buffer.
- **A coffee shop counter.** The barista (producer) makes drinks and puts them on a counter that holds a few cups (buffer). If the counter is full, the barista pauses (backpressure) until customers (consumers) take their drinks.
- **A water pipe.** Push too much water in and pressure builds at the inlet — the pipe pushes back. That is literal backpressure.
- **A mailbox with limited slots.** The postman can only deliver if there is room; otherwise they hold the mail (the producer blocks).

The common thread: a *bounded* holding area between two parties of different speed, where "full" means "slow down," not "drop" or "grow forever."

---

## Mental Models

### "The channel is a bounded waiting room"

The channel buffer is a waiting room with N chairs. The producer seats people; the consumer calls them in. When all chairs are taken, the producer must wait at the door — that wait is backpressure.

### "Push is producer-driven; pull is consumer-driven"

In a pure push system the producer decides when work happens. In a pure pull system the consumer decides. A Go channel is *both at once*: the producer pushes, the consumer pulls, and the channel buffer plus blocking semantics negotiate the rate between them.

### "Full channel = a polite 'wait your turn'"

A blocked send is not an error. It is the channel saying "I'm full, hold on." The producer parks, the scheduler runs the consumer, the consumer pulls, the producer resumes. The Go runtime does the negotiation.

---

## Pros & Cons

### Pros
- **Free flow control.** Backpressure comes built into channels; no manual rate limiting needed.
- **Bounded memory.** A buffered channel caps how far ahead the producer can get.
- **Decoupled rates.** Producer and consumer can run at different speeds and still cooperate.
- **Simple and idiomatic.** It is *the* basic Go concurrency shape; one channel, two goroutines.
- **Composable.** Chain push-pull pairs into a pipeline; fan out to many pullers.

### Cons
- **A slow consumer slows the producer.** Usually desirable, but if the producer *must not* block (e.g., it is reading from a real-time source), you need a different strategy (drop, spill, scale consumers).
- **Deadlock if nobody pulls.** A push with no consumer blocks forever.
- **Lost work on careless shutdown.** Stopping without draining can drop buffered items.
- **Unbounded variant is an OOM trap.** Removing the bound to "never block the producer" trades a slowdown for a crash.

---

## Use Cases

- **File/stream ingestion.** Reader pushes records; processor pulls. The processor's speed caps memory use.
- **Job queue.** Dispatcher pushes jobs; a worker pulls and runs them.
- **Producer/consumer buffering.** A burst-y source feeds a steady consumer through a small buffer that absorbs bursts.
- **Pipeline stages.** Each stage pulls from the previous stage's channel and pushes to the next.
- **Logging / metrics.** App pushes events onto a bounded channel; a writer pulls and flushes to disk, backpressuring the app if disk is slow.

---

## Code Examples

### Example 1 — Minimal push-pull with backpressure

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    ch := make(chan int, 2) // bounded buffer of 2
    var wg sync.WaitGroup

    // Producer: pushes 0..4, blocks when the buffer is full.
    wg.Add(1)
    go func() {
        defer wg.Done()
        defer close(ch) // producer owns close
        for i := 0; i < 5; i++ {
            ch <- i
            fmt.Println("pushed", i)
        }
    }()

    // Consumer: pulls slowly, creating backpressure.
    wg.Add(1)
    go func() {
        defer wg.Done()
        for v := range ch {
            time.Sleep(200 * time.Millisecond)
            fmt.Println("  pulled", v)
        }
    }()

    wg.Wait()
}
```

Watch the interleaving: the producer pushes 0, 1, 2 quickly (filling the buffer), then stalls on `pushed 3` until the consumer has pulled enough to free a slot. The producer never gets more than ~2 ahead. That is backpressure doing its job.

### Example 2 — Unbuffered rendezvous

```go
package main

import "fmt"

func main() {
    ch := make(chan string) // unbuffered
    done := make(chan struct{})

    go func() {
        for s := range ch {
            fmt.Println("got", s)
        }
        close(done)
    }()

    // Each send blocks until the consumer is ready to receive.
    ch <- "a"
    ch <- "b"
    ch <- "c"
    close(ch)
    <-done
}
```

With capacity 0 there is no slack: every push waits for a pull. Producer and consumer move in lockstep. This is the tightest backpressure possible.

### Example 3 — The unbounded-queue trap (do NOT do this)

```go
// ANTI-PATTERN: unbounded queue, no backpressure.
type UnboundedQueue struct {
    mu    sync.Mutex
    items []int // grows without limit
}

func (q *UnboundedQueue) Push(v int) {
    q.mu.Lock()
    q.items = append(q.items, v) // never blocks the producer
    q.mu.Unlock()
}
```

If the producer outruns the consumer, `items` grows until the process is killed by the OOM killer. The "benefit" — the producer never waits — is exactly the danger. A bounded channel (`make(chan int, N)`) gives you the slowdown instead of the crash. Prefer the channel.

### Example 4 — Producer signals completion by closing

```go
package main

import "fmt"

func produce(n int) <-chan int {
    ch := make(chan int)
    go func() {
        defer close(ch) // tell the consumer "no more"
        for i := 0; i < n; i++ {
            ch <- i * i
        }
    }()
    return ch
}

func main() {
    for v := range produce(5) { // loop ends when produce closes ch
        fmt.Println(v)
    }
}
```

Returning a *receive-only* channel (`<-chan int`) from the producer is idiomatic: the caller can only pull, never push or close. The producer owns the channel and closes it.

---

## Coding Patterns

### Pattern: producer returns a receive-only channel

```go
func source() <-chan Item {
    out := make(chan Item)
    go func() {
        defer close(out)
        for /* ... */ {
            out <- next()
        }
    }()
    return out
}
```

Encapsulates the goroutine and the close. Callers just `range` over the result.

### Pattern: bounded buffer to absorb bursts

```go
ch := make(chan Event, 64) // small buffer smooths short bursts
```

A small buffer lets a burst-y producer get a little ahead without blocking on every item, while still bounding memory. Start small (8–128) and tune.

### Pattern: producer owns close, consumer ranges

```go
go func() { defer close(ch); produce(ch) }() // producer closes
for v := range ch { consume(v) }             // consumer ranges, never closes
```

---

## Clean Code

- Name the channel after what it carries: `jobs`, `events`, `lines` — not `ch1`.
- Type producer outputs as `<-chan T` (receive-only) so callers cannot push or close.
- Document who closes the channel. The rule is **the sender closes**.
- Keep the producer goroutine's `close` in a `defer` right after `go func() {` so it cannot be forgotten.
- Pick a buffer size deliberately and comment why (e.g., `// 64: absorbs one network read's worth of records`).

---

## Product Use / Feature

- **Upload processing.** The HTTP handler pushes uploaded chunks onto a bounded channel; a worker pulls and writes to storage. If storage is slow, the handler backpressures (the client upload slows) instead of buffering the whole file in RAM.
- **Activity feed.** App pushes events onto a bounded channel; a flusher pulls and batches them to the database.
- **Image thumbnailing.** A scanner pushes file paths; a worker pulls and generates thumbnails at its own pace.

The product-level benefit is always the same: the slow stage governs the pace, and memory stays bounded under load spikes.

---

## Error Handling

- **The producer hits an error.** Decide: stop and close the channel (consumer's `range` ends), or push an error value alongside data. A common idiom is a `Result` struct carrying `Value` and `Err`:
  ```go
  type Result struct {
      Value int
      Err   error
  }
  ```
- **The consumer hits an error.** It can stop pulling, but then the producer blocks forever on the next push. Pair with cancellation (middle.md) so the producer learns to stop. At junior level: ensure the consumer drains until the channel closes, or the producer deadlocks.
- **Deadlock detection.** If every goroutine is blocked, the runtime panics with `all goroutines are asleep - deadlock!`. This usually means a push with no puller, or a consumer that stopped while the producer kept pushing.

---

## Security Considerations

- **Denial of service via backpressure inversion.** If a remote client is your *consumer* and stops pulling, your producer blocks and holds resources. Bound how long a push may block, or drop, so a malicious slow consumer cannot pin your goroutines.
- **Memory exhaustion via unbounded queues.** Never use an unbounded queue for data whose rate you do not control. An attacker who can push faster than you pull will OOM you. Always bound.
- **Fairness.** A single producer feeding untrusted consumers should bound per-consumer work so one cannot starve the rest (more in middle.md fan-out).

The recurring security theme is: *bound everything*. Bounded buffers and bounded blocking turn attacks from crashes into mere slowdowns.

---

## Performance Tips

- **An unbuffered channel synchronises on every item** — highest coordination overhead. A small buffer (8–64) amortises that and often improves throughput.
- **Do not over-buffer.** A huge buffer hides backpressure (you discover overload late) and wastes memory. The right buffer is "enough to smooth bursts," not "enough to hold everything."
- **Batch where possible.** Pushing `[]Item` instead of one `Item` at a time reduces per-item channel overhead (senior/optimize files).
- **One channel, one purpose.** Do not multiplex unrelated data through one channel to "save" a channel; channels are cheap.

---

## Best Practices

1. **Bound the buffer.** Use `make(chan T, n)`; never an unbounded queue for uncontrolled input.
2. **Sender closes; receiver ranges.** Never close from the consumer.
3. **Return receive-only channels** from producers.
4. **Let backpressure work** — a blocked producer is usually correct, not a bug to "fix" with a bigger buffer.
5. **Drain before shutdown** so buffered work is not lost.
6. **Test with `-race`** and with a slow consumer to confirm backpressure behaves.

---

## Edge Cases & Pitfalls

- **Push with no consumer → deadlock.** A send on a channel nobody receives from blocks forever.
- **Consumer stops, producer keeps pushing → producer blocks forever** (and may leak). Pair with cancellation.
- **Closing from the consumer → panic** when the producer next sends.
- **Closing twice → panic.**
- **Ranging over a channel that is never closed → the loop never ends.**
- **Over-large buffer hides overload** until memory is gone — the bound is supposed to be felt.
- **Sending on a `nil` channel blocks forever** (a trick used to disable a select case, but a bug if accidental).

---

## Common Mistakes

- Using an unbounded slice/queue to "avoid blocking the producer" — invites OOM.
- Closing the channel from the consumer (panic).
- Forgetting to close, so the consumer's `range` never ends.
- A buffer so large it defeats backpressure.
- Stopping the consumer without telling the producer, deadlocking the producer.
- Treating a blocked producer as a bug and removing the bound instead of scaling the consumer.

---

## Common Misconceptions

- **"Backpressure is a problem to eliminate."** No — it is the safety mechanism. Removing it (unbounded queue) trades a slowdown for a crash.
- **"Bigger buffers are always better."** No. A big buffer delays the moment you feel overload and wastes memory. Small and deliberate is better.
- **"The consumer should close the channel when it's done."** No. The sender closes. The consumer just stops ranging.
- **"Push and pull are different patterns."** In Go they are the two ends of one channel; the channel does both at once.

---

## Tricky Points

- A **blocked send is cooperative**, not a spin: the producer goroutine parks and uses no CPU until a slot frees.
- **Unbuffered channels** give the *tightest* coupling: the send completes only when a receive is in progress (a happens-before handshake).
- **Closing communicates "done," not a value.** After close, pulls return `(zero, false)` once the buffer drains.
- **Buffer capacity is the entire backpressure tuning knob** at this level — capacity 0 (lockstep) to capacity N (N items of slack).
- A **receive-only return type** (`<-chan T`) is how you hand out a pull-end without exposing push/close.

---

## Test

```go
package main

import (
    "sync"
    "testing"
    "time"
)

// Backpressure: with a buffer of 1 and a blocked consumer, the producer
// can be at most 2 items ahead (1 buffered + 1 in-flight).
func TestBackpressureBoundsProducer(t *testing.T) {
    ch := make(chan int, 1)
    release := make(chan struct{})
    var pushed int
    var mu sync.Mutex

    go func() {
        for i := 0; i < 5; i++ {
            ch <- i
            mu.Lock()
            pushed++
            mu.Unlock()
        }
        close(ch)
    }()

    time.Sleep(50 * time.Millisecond) // let the producer get as far as it can
    mu.Lock()
    p := pushed
    mu.Unlock()
    if p > 2 {
        t.Fatalf("producer ran ahead by %d; backpressure failed", p)
    }

    // Now drain.
    go func() {
        for range ch {
        }
        close(release)
    }()
    <-release
}
```

Run with `go test -race`.

---

## Tricky Questions

**Q1.** What is backpressure?
> The automatic blocking of the producer when the channel buffer is full, which throttles a fast producer to a slow consumer's pace and bounds memory. In Go you get it for free from buffered/unbuffered channels.

**Q2.** Why is blocking the producer a *good* thing?
> Because the alternative — accepting every push into an unbounded queue — risks running out of memory. Blocking turns overload into a slowdown instead of a crash.

**Q3.** Who closes the channel, and why?
> The sender (producer). Sending on a closed channel panics, so only the side that sends may safely close. The consumer just stops ranging.

**Q4.** What does an unbuffered channel give you that a buffered one does not?
> A rendezvous: the send completes only when a receive is happening. Producer and consumer move in lockstep — the tightest possible backpressure.

**Q5.** What goes wrong with an unbounded queue under load?
> The producer never blocks, the queue grows without limit, and the process is eventually killed by the OOM killer. You lose the safety of backpressure.

**Q6.** What happens if the consumer stops but the producer keeps pushing?
> The producer blocks on the next full-buffer send and stays parked forever (a leak / deadlock). You need cancellation so the producer learns to stop (middle.md).

---

## Cheat Sheet

```go
ch := make(chan T, n)   // bounded buffer: backpressure when full
ch := make(chan T)      // unbuffered: rendezvous (tightest backpressure)

go func() {             // producer
    defer close(ch)     // sender closes
    for ... { ch <- v } // push; blocks when full
}()

for v := range ch {     // consumer; loop ends on close
    consume(v)          // pull
}
```

| Need | Tool |
|------|------|
| Decouple producer/consumer rate | buffered channel |
| Lockstep handshake | unbuffered channel |
| Cap memory under load | bounded buffer (never unbounded) |
| Signal "no more items" | `close(ch)` by the sender |
| Hand out a pull-end only | return `<-chan T` |

---

## Self-Assessment Checklist

- [ ] I can explain push, pull, and backpressure.
- [ ] I can connect a producer and consumer with a bounded channel.
- [ ] I can explain why a blocked producer is a feature, not a bug.
- [ ] I know who closes the channel and why.
- [ ] I can explain the OOM danger of an unbounded queue.
- [ ] I know what an unbuffered channel's rendezvous means.
- [ ] I can write a test that shows backpressure bounding the producer.

---

## Summary

Push-pull is the most fundamental Go concurrency shape: a producer pushes onto a channel, a consumer pulls off it, and the channel's bounded buffer negotiates their differing rates through **backpressure**. A full channel blocks the producer — and that is the whole point, because it turns overload into a controlled slowdown and bounds memory, whereas an unbounded queue trades the slowdown for an out-of-memory crash. Use an unbuffered channel for a lockstep rendezvous, a small buffer to absorb bursts. The sender always closes the channel; the consumer ranges until close. Master this, and pipelines, worker pools, and fan-out (the next levels) are just compositions of it.

---

## What You Can Build

- A file ingester that backpressures the reader to the parser's speed.
- A bounded log/metrics buffer that throttles the app when the writer is slow.
- A simple single-worker job queue.
- A two-stage pipeline (read → transform) connected by a channel.
- A burst-absorbing buffer in front of a steady consumer.

---

## Further Reading

- "Go Concurrency Patterns: Pipelines and cancellation" — the Go blog.
- Effective Go — channels and `select`.
- The Go Memory Model — channel send/receive happens-before rules.
- Rob Pike, "Go Concurrency Patterns" (2012).
- ZeroMQ Guide — the PUSH/PULL socket chapter (the distributed analogue; conceptual reading).

---

## Related Topics

- **Channels** — the in-process push-pull mechanism itself.
- **Pipeline** — chained push-pull stages.
- **Fan-out / fan-in** — N consumers pulling from one channel.
- **Worker pool** — push-pull with many pullers.
- **`context`** — cancellation and draining (middle.md).

---

## Diagrams & Visual Aids

### Push-pull with backpressure

```
   producer --push--> [ buffer: ##__ ] --pull--> consumer
                          (cap 4)
   when buffer full:  producer BLOCKS here  <-- backpressure
```

### Unbuffered rendezvous

```
   producer:  ch <- v  ----+
                           |  (both complete together)
   consumer:  v := <-ch ---+
```

### Bounded vs unbounded

```
   bounded (channel):     full -> producer waits -> memory capped -> OK
   unbounded (slice):     never waits -> memory grows -> OOM crash  -> BAD
```
