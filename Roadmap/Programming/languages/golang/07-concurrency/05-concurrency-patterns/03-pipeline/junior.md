# Pipeline — Junior Level

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
> Focus: "I want to do A, then B, then C — each in parallel — like a factory line."

A pipeline in Go is a sequence of *stages* connected by channels. Each stage is a goroutine (or several goroutines) that reads from an input channel, does some work, and writes to an output channel. The output of one stage is the input of the next. The whole thing looks like an assembly line: producer → stage1 → stage2 → consumer.

The big idea: **stages run concurrently**. While stage 1 is parsing item N, stage 2 is filtering item N-1, and stage 3 is writing item N-2 to the database. None of them block waiting for the others; they communicate through channels and the runtime schedules them.

This is the canonical structure for any data-processing program in Go: log enrichment, ETL, image batch processing, search indexing, streaming aggregation, and so on. Once you can write a clean three-stage pipeline, you can build production data systems.

After reading this file you will:
- Understand what a pipeline is and why each stage is a goroutine
- Be able to write a three-stage pipeline (generate → square → print)
- Know the rule of who closes which channel
- Recognise the function signature of a stage: `func(<-chan In) <-chan Out`
- Compose stages into reusable building blocks
- Understand why a pipeline naturally produces backpressure
- Know what happens when one stage is slow or stops reading

You do **not** yet need cancellation, error propagation, or complex shutdown semantics. Those land in the middle and senior levels.

---

## Prerequisites

- **Required:** Goroutines, channels, `range`, `close`.
- **Required:** Comfort returning a `<-chan T` from a function.
- **Helpful:** Having read the Fan-In and Fan-Out pages.
- **Helpful:** Knowing what a buffered channel does.

If you can write a function that returns `<-chan int` from a goroutine, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Pipeline** | A series of stages connected by channels, where each stage transforms or filters values. |
| **Stage** | One step of a pipeline, implemented as one (or several) goroutines that read from an input channel and write to an output channel. |
| **Producer / source** | The first stage. It has no input channel — it generates values from outside (a file, a slice, a request). |
| **Consumer / sink** | The last stage. It has no output channel — it terminates the data flow (writes to disk, prints, returns). |
| **Stage signature** | The conventional function shape: `func(in <-chan In) <-chan Out`. |
| **Channel between stages** | A `chan T` whose sender is one stage and whose receiver is the next stage. |
| **Backpressure** | The natural slow-down felt upstream when a downstream stage cannot keep up — the upstream `ch <- v` blocks. |
| **Buffer** | A non-zero capacity on a channel between stages. Lets the upstream stage temporarily run ahead of the downstream stage. |
| **Closing a stage's output** | Each stage closes its own output channel when it has no more values to send. The next stage's `range` loop then exits. |

---

## Core Concepts

### Stages as functions returning channels

The convention is: each stage is a function that takes a `<-chan In` and returns a `<-chan Out`. Inside, it spawns one goroutine that reads, transforms, writes, and closes its own output.

```go
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
```

Three things to notice:
1. The function returns immediately. The goroutine runs in the background.
2. The output channel is created by the stage. Nobody else creates it.
3. The output channel is closed by the same goroutine that wrote to it, when its input is exhausted (`range` exits).

### A producer has no input channel

The first stage takes its values from outside the pipeline:

```go
func gen(nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, n := range nums {
            out <- n
        }
    }()
    return out
}
```

### A consumer has no output channel

The last stage absorbs the values without producing any. It is usually the caller's `for range` loop, but it can also be a function:

```go
func sum(in <-chan int) int {
    total := 0
    for v := range in {
        total += v
    }
    return total
}
```

### Connecting them

```go
func main() {
    nums := gen(1, 2, 3, 4)
    sq := square(nums)
    fmt.Println(sum(sq)) // 1 + 4 + 9 + 16 = 30
}
```

This is a three-stage pipeline: generate, square, sum. While `gen` is producing 3, `square` may be working on 2, and `sum` may be adding 1 — depending on the scheduler.

### The close protocol

Each stage closes its own output channel. That is the only way the next stage's `range` loop knows to exit. The protocol cascades from producer to consumer:

```
producer drains → close(out1)
stage1's range exits → stage1 returns → close(out2)
stage2's range exits → stage2 returns → close(out3)
consumer's range exits
```

If any stage fails to close its output, the next stage hangs forever.

### Backpressure for free

Channels are bounded (or unbounded if buffered to `cap=infinity`, which is impossible). When the downstream stage is slow, its input channel fills up, and the upstream stage's `out <- v` blocks. The upstream stage stops producing until there is room. This natural slowdown is called **backpressure**, and it is automatic in Go pipelines.

### Concurrency comes from running stages simultaneously

A pipeline of N stages runs N goroutines (or more, if a stage has internal fan-out). They all run concurrently. On a multi-core CPU they often run in parallel. Throughput is dictated by the slowest stage.

---

## Real-World Analogies

### A factory assembly line
A worker installs the engine, the next worker installs the wheels, the next paints. Each station works on a different car at the same time. The slowest station bottlenecks the line.

### A car wash
Soap, scrub, rinse, dry. Every car passes through each station in order. Several cars are in different stations at any moment.

### A kitchen station line
Prep, sauté, plate. The chef chains tasks; the runner picks up plates and delivers them. Each station owns its work and hands off the next item.

### A publishing pipeline
Author writes → editor edits → typesetter formats → printer prints. Each step has its own queue (a stack of paper). Slowdowns at the editor desk cause the author's drafts to pile up — backpressure.

### A river system with water-treatment plants
Source → coarse filter → fine filter → tap. Pipes (channels) carry water from one stage to the next. If a downstream filter clogs (slow stage), the pressure upstream rises.

---

## Mental Models

### Model 1: "Each stage is a function"
A pipeline is built by composing functions. The function body is the goroutine. The return value is the next channel. There is no special framework.

### Model 2: "Channels are the wires"
The data flows along channels. Each channel has exactly one writer (the stage that owns it) and one reader (the next stage). This invariant makes closing simple.

### Model 3: "Closing is propagation"
A close on the producer cascades through every stage automatically. You do not need to send sentinel values or "EOF" markers; the closed channel *is* the EOF.

### Model 4: "The slowest stage sets the pace"
If stage 2 takes twice as long per item as stage 1, stage 1 will spend half its time blocked on `out <- v`. The slowest stage is the bottleneck.

### Model 5: "Pipelines compose"
You can splice fan-out and fan-in into the middle of a pipeline. Stage 2 can be replaced with N parallel workers and a fan-in to merge their outputs back into the main pipe.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Each stage is independently testable. | Cancellation needs careful design (ctx). |
| Stages run concurrently for free. | Buffer sizing requires measurement. |
| Backpressure is automatic. | Long pipelines have higher per-item latency. |
| Composable; stages plug together. | One slow stage caps throughput. |
| Channels make ownership clear. | Errors need an explicit channel design. |
| Idiomatic Go. | Lots of goroutines on long pipelines. |
| Decoupled producers and consumers. | Diagnostics harder than a synchronous loop. |

---

## Use Cases

- **ETL** — extract from DB → transform records → load to warehouse.
- **Log enrichment** — read lines → parse → look up metadata → write to indexer.
- **Image batch processing** — list paths → decode → resize → encode → upload.
- **Search indexing** — fetch docs → tokenise → score → write to index shard.
- **Streaming aggregation** — read events → group by key → compute window stats → emit.
- **Data validation pipelines** — read CSV → validate row → enrich → store.
- **Build systems** — discover files → compile → link → archive.

---

## Code Examples

### Example 1: classic three-stage pipeline

```go
package main

import "fmt"

func gen(nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, n := range nums {
            out <- n
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

func main() {
    for v := range square(gen(1, 2, 3, 4)) {
        fmt.Println(v)
    }
}
```

### Example 2: filter + map + sink

```go
func filter(in <-chan int, pred func(int) bool) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            if pred(v) {
                out <- v
            }
        }
    }()
    return out
}

func main() {
    nums := gen(1, 2, 3, 4, 5, 6)
    even := filter(nums, func(v int) bool { return v%2 == 0 })
    sq := square(even)
    for v := range sq {
        fmt.Println(v) // 4, 16, 36
    }
}
```

### Example 3: stages with side effects

```go
func logEach(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            fmt.Println("seen:", v)
            out <- v
        }
    }()
    return out
}
```

A "tap" stage that observes values without modifying them.

### Example 4: buffered channel for smoother flow

```go
func square(in <-chan int) <-chan int {
    out := make(chan int, 16) // buffer of 16
    go func() {
        defer close(out)
        for v := range in {
            out <- v * v
        }
    }()
    return out
}
```

A small buffer lets `square` run a few items ahead of its downstream stage. Tune by measurement.

### Example 5: reading lines from a file

```go
func readLines(path string) <-chan string {
    out := make(chan string)
    go func() {
        defer close(out)
        f, err := os.Open(path)
        if err != nil {
            return
        }
        defer f.Close()
        s := bufio.NewScanner(f)
        for s.Scan() {
            out <- s.Text()
        }
    }()
    return out
}
```

A producer stage backed by a file. Errors are silently dropped here for brevity; middle.md adds error handling.

---

## Coding Patterns

### Pattern: stage signature
`func name(in <-chan In) <-chan Out`. Producers omit `in`. Consumers omit the return value.

### Pattern: defer close
Every stage that owns its output uses `defer close(out)` at the top of its goroutine. This guarantees close happens once, even on early return.

### Pattern: chain in a single line
`out := stage3(stage2(stage1(source)))`. Reads outside-in like function composition.

### Pattern: small buffers
A buffer of 1-32 between stages smooths jitter without holding much memory. Default unbuffered, increase only when measured.

### Pattern: source from a slice
`func gen(values []T) <-chan T`. The standard way to test a pipeline.

### Pattern: sink to a slice
`func collect(in <-chan T) []T`. The dual.

---

## Clean Code

- Keep each stage in its own function. No anonymous goroutines for stages.
- Name stages by what they *do*: `parse`, `enrich`, `validate`.
- Document the input and output element types in a comment.
- Use a struct as the channel element when stages need many fields.
- Keep stages small. If a stage has more than ~30 lines, split it.
- Prefer pure transformations (no side effects) where possible. Side-effect stages (log, write) at the end.

---

## Product Use / Feature

A real-world pipeline in production might process ad-impression events:

```
read from Kafka → decode JSON → enrich with user profile → filter (drop bots) → write to ClickHouse
```

Each stage is a Go function returning `<-chan T`. The decode stage takes raw bytes; enrich takes a struct, makes an RPC, returns the augmented struct; filter drops events; write batches and inserts. The throughput of the entire pipeline is whatever the slowest stage allows.

A junior implementation should:
- Use one goroutine per stage initially.
- Use small buffers (8-32) between stages.
- Always close stage outputs on `defer`.
- Add fan-out only to a measured bottleneck stage.
- Plan for ctx cancellation (middle level) before going to production.

---

## Error Handling

In a junior pipeline, errors usually flow as part of the data:

```go
type Item struct {
    Value int
    Err   error
}
```

Each stage checks `if it.Err != nil` and forwards without processing, so the error eventually reaches the sink. This avoids parallel error channels but couples the data and error types.

Alternatives (covered later):
- Return `(<-chan Result, <-chan error)` per stage.
- Use `errgroup` for first-error cancellation.
- Use `context.Context` to abort everything.

---

## Security Considerations

- A pipeline reading untrusted input (file, network) must validate at an early stage. Garbage data can crash later stages.
- A pipeline producing data sent to external systems (DB, HTTP) must respect rate limits — use a bounded buffer or a rate-limiter stage.
- A pipeline that logs every value is a logging hazard if values contain secrets. Log shapes, not contents.

---

## Performance Tips

- Default unbuffered channels. Add buffer only after profiling shows backpressure churn.
- Profile with `go test -bench` and `pprof`. Look for `runtime.chansend` and `runtime.chanrecv` time.
- Keep per-item work substantial enough that channel overhead is negligible (>1µs per item).
- Long pipelines cost more per item; combine trivial stages with `func compose(a, b)` if needed.
- Reuse buffers within a stage; pools (sync.Pool) help reduce GC pressure on hot paths.

---

## Best Practices

1. Each stage owns and closes exactly one output channel.
2. Every stage uses `defer close(out)`.
3. Stage signatures are uniform: `(<-chan In) <-chan Out`.
4. Producers close on input exhaustion; consumers drain.
5. Document buffer sizes if they are non-zero.
6. Test stages in isolation, then together.
7. Run `go test -race` always.

---

## Edge Cases & Pitfalls

- **Stage forgets to close output.** Next stage hangs forever.
- **Stage panics.** Output never closes; downstream hangs.
- **Consumer stops reading early.** Upstream stages block on `out <- v` forever (no cancellation in junior code).
- **Empty input.** Pipeline drains and exits cleanly. This should always work.
- **Single-element input.** Should also work cleanly.
- **Cycle.** Connecting the output of stage 3 back to the input of stage 1 is a deadlock waiting to happen. Pipelines are linear (or DAGs), not graphs with cycles.

---

## Common Mistakes

1. Forgetting `defer close(out)` — downstream hangs.
2. Sharing one output channel across two stages — values get split unpredictably.
3. Closing the input from inside a stage — panics in the producer.
4. Returning `chan T` instead of `<-chan T` — leaks ownership.
5. Mixing several side effects into one stage — hard to test.
6. Not handling errors at all — pipeline silently drops bad data.
7. Buffering all channels by 1024 "just in case" — masks backpressure problems.

---

## Common Misconceptions

- "A pipeline must always run forever." Many do (streaming), but batch pipelines drain and terminate cleanly.
- "Each stage must run on a different CPU." It does not have to; the scheduler handles it.
- "Buffers are mandatory." They are not. Unbuffered pipelines work fine.
- "Stages must be pure functions." They can be impure; just isolate side effects in their own stage.
- "Pipelines need a framework." Plain Go channels and goroutines are enough.

---

## Tricky Points

- **Buffer size affects latency.** A buffer of N means the first item can sit in the buffer until N more arrive. For low-latency pipelines, prefer small buffers.
- **Goroutine count is the sum of stage internals.** If each of three stages spawns 4 worker goroutines, you have 12 goroutines, not 3.
- **A stage cannot close the input — only the output.** The previous stage owns the input.
- **The order of `defer close(out)` matters.** It must be the *first* defer in the goroutine so it runs last (LIFO).

---

## Test

```go
package main

import "testing"

func TestPipelineSquare(t *testing.T) {
    nums := gen(1, 2, 3, 4)
    sq := square(nums)
    var got []int
    for v := range sq {
        got = append(got, v)
    }
    want := []int{1, 4, 9, 16}
    if len(got) != len(want) {
        t.Fatalf("len mismatch: got %d want %d", len(got), len(want))
    }
    for i, w := range want {
        if got[i] != w {
            t.Fatalf("at %d: got %d want %d", i, got[i], w)
        }
    }
}

func TestPipelineEmpty(t *testing.T) {
    sq := square(gen())
    for range sq {
        t.Fatal("expected no values")
    }
}
```

Run with `go test -race`.

---

## Tricky Questions

1. **Why must a stage close its output?** So the next stage's `range` loop exits.
2. **Why is `defer close(out)` placed first?** Defers run LIFO, so the first deferred runs last; we want close to be the last action.
3. **What is the difference between a pipeline and a fan-out?** A pipeline is sequential stages; fan-out is parallel workers within one stage. They compose.
4. **Why does backpressure happen automatically?** Because channel sends block when the channel is full and no receiver is ready.
5. **Can two stages share an output channel?** Only with extra coordination — and you almost never want this.
6. **What is the slowest stage of a pipeline called?** The bottleneck.
7. **What happens if a stage panics?** Its goroutine dies, output never closes, downstream hangs.
8. **How do I cancel a pipeline mid-stream?** With `context.Context` — covered in middle.md.

---

## Cheat Sheet

```go
// Stage skeleton.
func stage(in <-chan In) <-chan Out {
    out := make(chan Out)
    go func() {
        defer close(out)
        for v := range in {
            out <- transform(v)
        }
    }()
    return out
}
```

| Element | Form |
|---------|------|
| Producer | `func gen(...) <-chan T` |
| Stage | `func s(in <-chan In) <-chan Out` |
| Consumer | `for v := range pipeline { ... }` |
| Buffer | `make(chan T, N)` (rare) |
| Close | `defer close(out)` |

---

## Self-Assessment Checklist

- [ ] I can write a producer, a transformer, and a consumer stage.
- [ ] I know who closes each channel and when.
- [ ] I can explain what backpressure is and how it arises.
- [ ] I can describe what happens when a stage panics.
- [ ] I can chain three stages into a working pipeline.
- [ ] I can test a pipeline with `-race` and pass.
- [ ] I can explain how a pipeline differs from a fan-out.

---

## Summary

A pipeline is a sequence of stages, each implemented as a goroutine that reads from an input channel and writes to an output channel. Each stage owns its output channel, closes it on completion, and uses a uniform signature. Stages run concurrently, channels enforce backpressure, and `range` plus `close` provide automatic shutdown. Mastery of this pattern unlocks streaming and batch data systems in Go.

---

## What You Can Build

- A line counter that reads a file and counts non-blank lines through three stages.
- A toy ETL: random ints → multiply → keep evens → sum.
- A directory walker that lists, hashes, and deduplicates files.

---

## Further Reading

- The Go Blog: "Go Concurrency Patterns: Pipelines and cancellation".
- Donovan & Kernighan, *The Go Programming Language*, chapter 8.
- Cox-Buday, *Concurrency in Go*, pipeline chapter.

---

## Related Topics

- Fan-in (used to merge parallel branches in a pipeline).
- Fan-out (used to parallelise a single bottleneck stage).
- `context.Context` (used to cancel the whole pipeline).
- `errgroup` (errors and cancellation with first-error semantics).

---

## Diagrams & Visual Aids

```
gen() ──▶ square() ──▶ collect()
  ch1        ch2          (sink)

Each "──▶" is a Go channel.
Each function is a goroutine.
Each closes its own output on EOF.
```

```
With backpressure:

[gen]──▶[chan1, cap=4]──▶[square]──▶[chan2, cap=4]──▶[sink]

If sink is slow:
  chan2 fills up → square's `out <- v` blocks
                → square stops reading chan1 → chan1 fills up
                → gen blocks on `out <- v`
                → entire pipeline pauses naturally.
```
